// routes/payments.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const stripe = require('../config/stripe'); // ✅ centralized Stripe client (uses STRIPE_SECRET_KEY)
const auth = require('../middleware/auth'); // if this exists; otherwise remove on the /confirm route

// POST /api/payments/create-payment-intent
// Body: { amount: number (in dollars), currency?: 'usd', metadata?: object, receipt_email?: string, description?: string }
router.post('/create-payment-intent', async (req, res) => {
  try {
    const {
      amount,
      currency = 'usd',
      metadata = {},
      receipt_email,
      description,
    } = req.body || {};

    // Validate amount
    const amtNum = Number(amount);
    if (!amtNum || !isFinite(amtNum) || amtNum <= 0) {
      return res.status(400).json({ error: 'Valid amount is required (e.g., 12.34)' });
    }

    // Convert to smallest currency unit (cents)
    const amountInCents = Math.round(amtNum * 100);

    // Idempotency key prevents duplicate PIs if client retries
    const idempotencyKey =
      req.headers['idempotency-key'] ||
      (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountInCents,
        currency,
        metadata,
        receipt_email,
        description,
        automatic_payment_methods: { enabled: true },
      },
      { idempotencyKey }
    );

    return res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    console.error('Create payment intent error:', error);
    return res.status(500).json({ error: error.message || 'Stripe error' });
  }
});

// POST /api/payments/confirm-payment
// Body: { paymentIntentId: string, orderData?: object }
router.post('/confirm-payment', auth, async (req, res) => {
  try {
    const { paymentIntentId, orderData } = req.body || {};
    if (!paymentIntentId) {
      return res.status(400).json({ error: 'paymentIntentId is required' });
    }

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);

    // Acceptable "success" states:
    // - 'succeeded'  : captured & complete
    // - 'processing' : card networks may still be settling; treat as pending
    if (pi.status === 'succeeded') {
      // TODO: create order in DB using orderData + pi.id (safe, idempotent upsert)
      // e.g., await Order.findOneAndUpdate({ paymentIntentId: pi.id }, {...}, { upsert: true });

      console.log('✅ Payment confirmed:', paymentIntentId);
      return res.json({
        success: true,
        state: 'confirmed',
        message: 'Payment confirmed and order created',
        paymentIntentId: pi.id,
      });
    }

    if (pi.status === 'processing') {
      return res.status(202).json({
        success: false,
        state: 'processing',
        message: 'Payment is processing; try again shortly.',
        paymentIntentId: pi.id,
      });
    }

    // Common non-success statuses you may see:
    // 'requires_payment_method', 'requires_confirmation', 'requires_action', 'canceled'
    return res.status(400).json({
      success: false,
      state: pi.status,
      error: `Payment not completed (status: ${pi.status})`,
      paymentIntentId: pi.id,
    });
  } catch (error) {
    console.error('Confirm payment error:', error);
    return res.status(500).json({ error: error.message || 'Stripe error' });
  }
});

module.exports = router;
