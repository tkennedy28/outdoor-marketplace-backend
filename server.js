// server.js  — CommonJS, single DB connect, single middleware stack, single listener
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const path = require('path');

/* ------------------------- ENV & REQUIRED CONFIG ------------------------- */
const {
  NODE_ENV = 'production',
  PORT = 3000,                          // Railway will override with process.env.PORT
  MONGODB_URI,
  STRIPE_SECRET_KEY,
  ENABLE_WEBSOCKET = 'false',
  ALLOWED_ORIGINS,                      // comma-separated list in prod
  DB_NAME = 'app'
} = process.env;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not set');
  process.exit(1);
}
if (!STRIPE_SECRET_KEY) {
  console.error('❌ STRIPE_SECRET_KEY is not set');
  process.exit(1);
}
const stripe = require('./config/stripe');

/* ------------------------------- APP SETUP ------------------------------- */
const app = express();
app.disable('x-powered-by');

// Security & CORS
app.use(helmet());

const defaultOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000'
];
const allowedOrigins = (ALLOWED_ORIGINS ? ALLOWED_ORIGINS.split(',') : defaultOrigins)
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // allow curl/mobile or same-origin server-to-server
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','x-auth-token'],
  exposedHeaders: ['x-auth-token']
}));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files (uploads)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

/* ----------------------------- RATE LIMITING ----------------------------- */
// General API limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300
});
app.use('/api/', apiLimiter);

// Stricter limits for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/signup', authLimiter);

/* --------------------------------- ROUTES -------------------------------- */
// Mount routers (make sure these files export an Express Router)
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const productRoutes = require('./routes/products');
const uploadRoutes = require('./routes/upload');
const offerRoutes = require('./routes/offers');
const messageRoutes = require('./routes/messages');
const paymentRoutes = require('./routes/payments');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/offers', offerRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/payments', paymentRoutes);

// Test payment (dynamic amount) — keeps your original functionality
app.post('/api/test-payment', async (req, res) => {
  try {
    const { amount, metadata } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // cents
      currency: 'usd',
      metadata: metadata || { source: 'climbing-gear-marketplace' },
      automatic_payment_methods: { enabled: true }
    });
    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      message: '✅ Payment intent created'
    });
  } catch (err) {
    console.error('❌ Stripe error:', err);
    res.status(500).json({ error: err.message || 'Stripe error' });
  }
});

/* ------------------------------ HEALTH/STATS ----------------------------- */
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'OK',
    env: NODE_ENV,
    mongodb: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
    timestamp: new Date().toISOString()
  });
});

// Statistics endpoint (preserves your counts)
app.get('/api/stats/overview', async (_req, res) => {
  try {
    const Offer = require('./models/Offer');
    const Message = require('./models/Message');
    const Conversation = require('./models/Conversation');
    const Product = require('./models/Product');

    const [
      totalOffers,
      activeOffers,
      totalMessages,
      activeConversations,
      totalListings
    ] = await Promise.all([
      Offer.countDocuments(),
      Offer.countDocuments({ status: 'pending' }),
      Message.countDocuments(),
      Conversation.countDocuments({ status: 'active' }),
      Product.countDocuments({ status: 'available' })
    ]);

    res.json({
      offers: { total: totalOffers, active: activeOffers },
      messages: { total: totalMessages, activeConversations },
      listings: { available: totalListings }
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

// Basic root route
app.get('/', (_req, res) => {
  res.json({ message: 'Outdoor Marketplace API is running!' });
});

/* ------------------------------ CRON JOBS ------------------------------- */
function initializeCronJobs() {
  // Expired offers (hourly)
  cron.schedule('0 * * * *', async () => {
    try {
      console.log('⏰ Running expired offers check...');
      const Offer = require('./models/Offer');
      const Message = require('./models/Message');
      const Conversation = require('./models/Conversation');

      const expiredOffers = await Offer.find({
        status: 'pending',
        expiresAt: { $lt: new Date() }
      }).populate('buyer seller listing');

      for (const offer of expiredOffers) {
        offer.status = 'expired';
        await offer.save();

        const conversation = await Conversation.findOrCreate(
          [offer.buyer._id, offer.seller._id],
          offer.listing._id
        );

        await Message.create({
          conversation: conversation._id,
          sender: offer.seller._id,
          receiver: offer.buyer._id,
          listing: offer.listing._id,
          message: `Your offer of $${offer.offerAmount} has expired. Feel free to make a new offer if you're still interested.`,
          isOffer: true,
          offerDetails: {
            offerId: offer._id,
            amount: offer.offerAmount,
            action: 'expired'
          }
        });
      }

      if (expiredOffers.length > 0) {
        console.log(`✅ Processed ${expiredOffers.length} expired offers`);
      }
    } catch (error) {
      console.error('❌ Error processing expired offers:', error);
    }
  });

  // Cleanup read+deleted messages older than 90 days (2 AM daily)
  cron.schedule('0 2 * * *', async () => {
    try {
      console.log('⏰ Running message cleanup...');
      const Message = require('./models/Message');
      const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const result = await Message.deleteMany({
        read: true,
        deleted: true,
        createdAt: { $lt: cutoff }
      });
      console.log(`✅ Cleaned up ${result.deletedCount} old messages`);
    } catch (error) {
      console.error('❌ Error cleaning up messages:', error);
    }
  });

  console.log('✅ Cron jobs initialized');
}

/* --------------------------- ERROR HANDLERS ----------------------------- */
// Centralized error handler (one instance)
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(NODE_ENV !== 'production' && { stack: err.stack })
  });
});

// 404 handler (after routes)
app.use((_req, res) => res.status(404).json({ message: 'Route not found' }));

/* ----------------------- DB CONNECT & START SERVER ---------------------- */
(async () => {
  try {
    await mongoose.connect(MONGODB_URI, { dbName: DB_NAME });
    console.log('✅ MongoDB connected');

    // Ensure models are loaded
    require('./models/Offer');
    require('./models/Message');
    require('./models/Conversation');
    require('./models/Product');
    require('./models/User');

    // Start cron jobs after DB connect
    initializeCronJobs();

    const listenPort = process.env.PORT || PORT;

    if (ENABLE_WEBSOCKET === 'true') {
      const http = require('http');
      const { Server } = require('socket.io');
      const server = http.createServer(app);
      const io = new Server(server, {
        cors: { origin: allowedOrigins, credentials: true }
      });

      // Optional: only if this file exists
      try {
        const setupWebSocket = require('./websocket/messageSocket');
        setupWebSocket(io);
        console.log('✅ WebSocket server initialized');
      } catch {
        console.warn('ℹ️ WebSocket module not found: ./websocket/messageSocket (skipping)');
      }

      server.listen(listenPort, () => {
        console.log(`🚀 Server + WS listening on ${listenPort}`);
        console.log(`📍 Health:        /api/health`);
        console.log(`💳 Test Payment:  /api/test-payment`);
        console.log(`💬 Messages API:  /api/messages`);
        console.log(`🤝 Offers API:    /api/offers`);
      });
      module.exports = { app, io, server };
    } else {
      app.listen(listenPort, () => {
        console.log(`🚀 Server listening on ${listenPort}`);
        console.log(`📍 Health:        /api/health`);
        console.log(`💳 Test Payment:  /api/test-payment`);
        console.log(`💬 Messages API:  /api/messages`);
        console.log(`🤝 Offers API:    /api/offers`);
      });
      module.exports = app;
    }
  } catch (err) {
    console.error('❌ Startup error:', err);
    process.exit(1);
  }
})();
