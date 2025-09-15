// backend/routes/products.js
const express = require('express');
const router = express.Router();

const Product = require('../models/Product');
const auth = require('../middleware/auth');           // your auth middleware
const upload = require('../middleware/upload');       // multer / cloudinary adaptor

// -------------------------------
// helpers
// -------------------------------
const parseBool = (v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1');
const parseNum = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v));
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

// -------------------------------
// ROUTE ORDER: specific -> generic
// -------------------------------

// GET /api/products/featured - featured products
router.get('/featured', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 6;
    const products = await Product.getFeatured(limit);
    res.json({ success: true, products });
  } catch (error) {
    console.error('Error fetching featured products:', error);
    res.status(500).json({ success: false, message: 'Error fetching featured products', error: error.message });
  }
});

// GET /api/products/discount-eligible - products that accept promo codes (optional convenience)
router.get('/discount-eligible', async (req, res) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 12;
    const skip  = (page - 1) * limit;

    const q = { acceptsPromotionalDiscounts: true, status: { $ne: 'removed' } };
    const [items, total] = await Promise.all([
      Product.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Product.countDocuments(q),
    ]);

    res.json({
      success: true,
      products: items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    console.error('Error fetching discount-eligible products:', error);
    res.status(500).json({ success: false, message: 'Error fetching discount-eligible products', error: error.message });
  }
});

// GET /api/products/user/:userId - products by user
router.get('/user/:userId', async (req, res) => {
  try {
    const products = await Product.find({
      seller: req.params.userId,
      status: { $in: ['available', 'pending', 'sold'] }
    })
      .populate('seller', 'username rating')
      .sort('-createdAt');

    res.json({ success: true, products });
  } catch (error) {
    console.error('Error fetching user products:', error);
    res.status(500).json({ success: false, message: 'Error fetching user products', error: error.message });
  }
});

// GET /api/products - list with filters + pagination
router.get('/', async (req, res) => {
  try {
    const filters = req.query;
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 12;
    const skip  = (page - 1) * limit;

    // Prefer model static if available; fall back to basic find
    let products;
    if (typeof Product.searchProducts === 'function') {
      products = await Product.searchProducts(filters);
    } else {
      const q = { status: { $ne: 'removed' } };
      if (filters.brand) q.brand = filters.brand;
      if (filters.size)  q.size  = filters.size;
      if (filters.minPrice || filters.maxPrice) {
        q.price = {};
        if (filters.minPrice) q.price.$gte = Number(filters.minPrice);
        if (filters.maxPrice) q.price.$lte = Number(filters.maxPrice);
      }
      products = await Product.find(q).sort({ createdAt: -1 });
    }

    const total = products.length;
    const pageItems = products.slice(skip, skip + limit);

    res.json({
      success: true,
      products: pageItems,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ success: false, message: 'Error fetching products', error: error.message });
  }
});

// GET /api/products/:id/similar - similar products
router.get('/:id/similar', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    const limit = parseInt(req.query.limit) || 4;
    const similarProducts = await Product.getSimilar(product, limit);

    res.json({ success: true, products: similarProducts });
  } catch (error) {
    console.error('Error fetching similar products:', error);
    res.status(500).json({ success: false, message: 'Error fetching similar products', error: error.message });
  }
});

// GET /api/products/:id - single product
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('seller', 'username email rating reviewCount location verified')
      .populate('favorites', 'username');

    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    // Increment views (skip if seller is viewer)
    if (!req.user || req.user.id !== String(product.seller?._id)) {
      if (typeof product.incrementViews === 'function') await product.incrementViews();
    }

    res.json({ success: true, product });
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ success: false, message: 'Error fetching product', error: error.message });
  }
});

// POST /api/products - create (auth) + uploads
router.post('/', auth, upload.array('images', 8), async (req, res) => {
  try {
    const images = Array.isArray(req.files) && req.files.length
      ? req.files.map(f => ({ url: f.path || f.url, publicId: f.filename || f.public_id }))
      : [];

    const data = {
      // core
      title: req.body.title,
      price: parseNum(req.body.price),
      description: req.body.description,
      images,
      condition: req.body.condition,
      size: req.body.size,
      brand: req.body.brand,
      seller: req.user.id,

      // selling prefs
      acceptsOffers: parseBool(req.body.acceptsOffers),
      shippingAvailable: parseBool(req.body.shippingAvailable),
      localPickup: parseBool(req.body.localPickup),

      // numbers
      originalPrice: parseNum(req.body.originalPrice),
      shippingPrice: parseNum(req.body.shippingPrice),
      minimumOffer: parseNum(req.body.minimumOffer),
      autoAcceptPrice: parseNum(req.body.autoAcceptPrice),

      // discounts (NEW)
      acceptsPromotionalDiscounts: parseBool(req.body.acceptsPromotionalDiscounts),
      maxDiscountPercent: clamp(parseNum(req.body.maxDiscountPercent) ?? 10, 0, 50),
      eligiblePromotions: req.body.eligiblePromotions
        ? Array.isArray(req.body.eligiblePromotions)
          ? req.body.eligiblePromotions
          : String(req.body.eligiblePromotions).split(',').map(s => s.trim()).filter(Boolean)
        : [],
    };

    if (!data.title)  return res.status(400).json({ success: false, message: 'Title is required' });
    if (!data.price || isNaN(data.price) || data.price <= 0) {
      return res.status(400).json({ success: false, message: 'Valid price is required' });
    }

    const product = await Product.create(data);
    const populated = await Product.findById(product._id).populate('seller', 'username email rating');

    res.status(201).json({ success: true, message: 'Product created successfully', product: populated });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(400).json({ success: false, message: 'Error creating product', error: error.message });
  }
});

// PUT /api/products/:id - update (auth + ownership) + image merging/replacing
router.put('/:id', auth, upload.array('newImages', 8), async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    // ownership
    if (typeof product.canEdit === 'function') {
      if (!product.canEdit(req.user.id)) {
        return res.status(403).json({ success: false, message: 'You can only edit your own products' });
      }
    } else if (String(product.seller) !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You can only edit your own products' });
    }

    // incoming images
    let images = product.images || [];
    if (req.files && req.files.length > 0) {
      const newImages = req.files.map(f => ({ url: f.path || f.url, publicId: f.filename || f.public_id }));
      images = req.body.replaceImages === 'true' ? newImages : [...images, ...newImages];
    }

    // build update
    const update = {
      // core (if provided)
      ...(req.body.title !== undefined && { title: req.body.title }),
      ...(req.body.description !== undefined && { description: req.body.description }),
      ...(req.body.condition !== undefined && { condition: req.body.condition }),
      ...(req.body.size !== undefined && { size: req.body.size }),
      ...(req.body.brand !== undefined && { brand: req.body.brand }),
      images,

      // selling prefs
      ...(req.body.acceptsOffers !== undefined && { acceptsOffers: parseBool(req.body.acceptsOffers) }),
      ...(req.body.shippingAvailable !== undefined && { shippingAvailable: parseBool(req.body.shippingAvailable) }),
      ...(req.body.localPickup !== undefined && { localPickup: parseBool(req.body.localPickup) }),

      // numbers
      ...(req.body.price !== undefined && { price: parseNum(req.body.price) }),
      ...(req.body.originalPrice !== undefined && { originalPrice: parseNum(req.body.originalPrice) }),
      ...(req.body.shippingPrice !== undefined && { shippingPrice: parseNum(req.body.shippingPrice) }),
      ...(req.body.minimumOffer !== undefined && { minimumOffer: parseNum(req.body.minimumOffer) }),
      ...(req.body.autoAcceptPrice !== undefined && { autoAcceptPrice: parseNum(req.body.autoAcceptPrice) }),

      // discounts (NEW)
      ...(req.body.acceptsPromotionalDiscounts !== undefined && {
        acceptsPromotionalDiscounts: parseBool(req.body.acceptsPromotionalDiscounts),
      }),
      ...(req.body.maxDiscountPercent !== undefined && {
        maxDiscountPercent: clamp(parseNum(req.body.maxDiscountPercent) ?? 10, 0, 50),
      }),
      ...(req.body.eligiblePromotions !== undefined && {
        eligiblePromotions: Array.isArray(req.body.eligiblePromotions)
          ? req.body.eligiblePromotions
          : String(req.body.eligiblePromotions).split(',').map(s => s.trim()).filter(Boolean),
      }),
    };

    // simple validation
    if (update.price !== undefined && (isNaN(update.price) || update.price <= 0)) {
      return res.status(400).json({ success: false, message: 'Price must be a positive number' });
    }

    Object.assign(product, update);
    await product.save();

    const updated = await Product.findById(product._id).populate('seller', 'username email rating');
    res.json({ success: true, message: 'Product updated successfully', product: updated });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(400).json({ success: false, message: 'Error updating product', error: error.message });
  }
});

// DELETE /api/products/:id - soft delete (auth + ownership)
router.delete('/:id', auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    if (String(product.seller) !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You can only delete your own products' });
    }

    product.status = 'removed';
    await product.save();

    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ success: false, message: 'Error deleting product', error: error.message });
  }
});

// POST /api/products/:id/favorite - toggle favorite
router.post('/:id/favorite', auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    if (typeof product.toggleFavorite === 'function') {
      await product.toggleFavorite(req.user.id);
      const isFav = product.favorites?.some?.(u => String(u) === req.user.id);
      return res.json({ success: true, message: 'Favorite toggled', isFavorited: !!isFav });
    }

    // simple fallback toggle if method not implemented
    const idx = (product.favorites || []).findIndex(u => String(u) === req.user.id);
    if (idx >= 0) product.favorites.splice(idx, 1);
    else (product.favorites = product.favorites || []).push(req.user.id);

    await product.save();
    const isFavorited = product.favorites.some(u => String(u) === req.user.id);
    res.json({ success: true, message: 'Favorite toggled', isFavorited });
  } catch (error) {
    console.error('Error toggling favorite:', error);
    res.status(500).json({ success: false, message: 'Error toggling favorite', error: error.message });
  }
});

// POST /api/products/:id/offer - submit offer
router.post('/:id/offer', auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate('seller', 'username email');
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    if (!product.acceptsOffers) {
      return res.status(400).json({ success: false, message: 'This product does not accept offers' });
    }

    const offerAmount = parseNum(req.body.amount);
    if (!offerAmount || offerAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Offer must be a positive number' });
    }

    if (product.minimumOffer && offerAmount < product.minimumOffer) {
      return res.status(400).json({ success: false, message: `Offer must be at least $${product.minimumOffer}` });
    }

    if (product.autoAcceptPrice && offerAmount >= product.autoAcceptPrice) {
      // TODO: create order/transaction
      return res.json({ success: true, message: 'Offer auto-accepted!', autoAccepted: true });
    }

    // TODO: create Offer record here
    // await Offer.create({ product: product._id, buyer: req.user.id, amount: offerAmount, message: req.body.message });

    res.json({ success: true, message: 'Offer submitted successfully', autoAccepted: false });
  } catch (error) {
    console.error('Error making offer:', error);
    res.status(500).json({ success: false, message: 'Error making offer', error: error.message });
  }
});

// POST /api/products/:id/sold - mark as sold
router.post('/:id/sold', auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    if (String(product.seller) !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You can only mark your own products as sold' });
    }

    const { buyerId, salePrice } = req.body;
    if (typeof product.markAsSold === 'function') {
      await product.markAsSold(buyerId, parseNum(salePrice));
    } else {
      product.status = 'sold';
      product.salePrice = parseNum(salePrice);
      product.buyer = buyerId;
      await product.save();
    }

    res.json({ success: true, message: 'Product marked as sold', product });
  } catch (error) {
    console.error('Error marking as sold:', error);
    res.status(500).json({ success: false, message: 'Error marking product as sold', error: error.message });
  }
});

module.exports = router;
