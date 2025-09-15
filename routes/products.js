// backend/routes/products.js

const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const auth = require('../middleware/auth'); // You'll need authentication middleware
const upload = require('../middleware/upload'); // For image uploads (multer/cloudinary)

// GET /api/products - Get all products with filters
router.get('/', async (req, res) => {
  try {
    const filters = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    const skip = (page - 1) * limit;

    // Use the static search method from your model
    let products = await Product.searchProducts(filters);
    
    // Apply pagination
    const total = products.length;
    products = products.slice(skip, skip + limit);

    res.json({
      success: true,
      products,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching products',
      error: error.message 
    });
  }
});

// GET /api/products/featured - Get featured products
router.get('/featured', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 6;
    const products = await Product.getFeatured(limit);
    
    res.json({
      success: true,
      products
    });
  } catch (error) {
    console.error('Error fetching featured products:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching featured products',
      error: error.message 
    });
  }
});

// GET /api/products/:id - Get single product
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('seller', 'username email rating reviewCount location verified')
      .populate('favorites', 'username');

    if (!product) {
      return res.status(404).json({ 
        success: false, 
        message: 'Product not found' 
      });
    }

    // Increment views (consider implementing view throttling)
    if (!req.user || req.user.id !== product.seller._id.toString()) {
      await product.incrementViews();
    }

    res.json({
      success: true,
      product
    });
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching product',
      error: error.message 
    });
  }
});

// GET /api/products/:id/similar - Get similar products
router.get('/:id/similar', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({ 
        success: false, 
        message: 'Product not found' 
      });
    }

    const limit = parseInt(req.query.limit) || 4;
    const similarProducts = await Product.getSimilar(product, limit);

    res.json({
      success: true,
      products: similarProducts
    });
  } catch (error) {
    console.error('Error fetching similar products:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching similar products',
      error: error.message 
    });
  }
});

// POST /api/products - Create new product (requires auth)
router.post('/', auth, upload.array('images', 8), async (req, res) => {
  try {
    const productData = {
      ...req.body,
      seller: req.user.id,
      images: [] // Process uploaded images
    };

    // Process uploaded images (assuming Cloudinary integration)
    if (req.files && req.files.length > 0) {
      productData.images = req.files.map(file => ({
        url: file.path || file.url,
        publicId: file.filename || file.public_id
      }));
    }

    // Parse boolean fields
    if (req.body.acceptsOffers) {
      productData.acceptsOffers = req.body.acceptsOffers === 'true';
    }
    if (req.body.shippingAvailable) {
      productData.shippingAvailable = req.body.shippingAvailable === 'true';
    }
    if (req.body.localPickup) {
      productData.localPickup = req.body.localPickup === 'true';
    }

    // Parse numeric fields
    if (req.body.price) {
      productData.price = parseFloat(req.body.price);
    }
    if (req.body.originalPrice) {
      productData.originalPrice = parseFloat(req.body.originalPrice);
    }
    if (req.body.shippingPrice) {
      productData.shippingPrice = parseFloat(req.body.shippingPrice);
    }
    if (req.body.minimumOffer) {
      productData.minimumOffer = parseFloat(req.body.minimumOffer);
    }
    if (req.body.autoAcceptPrice) {
      productData.autoAcceptPrice = parseFloat(req.body.autoAcceptPrice);
    }

    const product = new Product(productData);
    await product.save();

    const populatedProduct = await Product.findById(product._id)
      .populate('seller', 'username email rating');

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      product: populatedProduct
    });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(400).json({ 
      success: false, 
      message: 'Error creating product',
      error: error.message 
    });
  }
});

// PUT /api/products/:id - Update product (requires auth & ownership)
router.put('/:id', auth, upload.array('newImages', 8), async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ 
        success: false, 
        message: 'Product not found' 
      });
    }

    // Check if user can edit
    if (!product.canEdit(req.user.id)) {
      return res.status(403).json({ 
        success: false, 
        message: 'You can only edit your own products' 
      });
    }

    // Handle image updates
    if (req.files && req.files.length > 0) {
      const newImages = req.files.map(file => ({
        url: file.path || file.url,
        publicId: file.filename || file.public_id
      }));
      
      // Keep existing images or replace based on your logic
      if (req.body.replaceImages === 'true') {
        req.body.images = newImages;
      } else {
        req.body.images = [...product.images, ...newImages];
      }
    }

    // Parse boolean and numeric fields
    const updateData = { ...req.body };
    
    // Parse booleans
    ['acceptsOffers', 'shippingAvailable', 'localPickup'].forEach(field => {
      if (updateData[field] !== undefined) {
        updateData[field] = updateData[field] === 'true';
      }
    });

    // Parse numbers
    ['price', 'originalPrice', 'shippingPrice', 'minimumOffer', 'autoAcceptPrice'].forEach(field => {
      if (updateData[field] !== undefined) {
        updateData[field] = parseFloat(updateData[field]);
      }
    });

    // Update product
    Object.assign(product, updateData);
    await product.save();

    const updatedProduct = await Product.findById(product._id)
      .populate('seller', 'username email rating');

    res.json({
      success: true,
      message: 'Product updated successfully',
      product: updatedProduct
    });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(400).json({ 
      success: false, 
      message: 'Error updating product',
      error: error.message 
    });
  }
});

// DELETE /api/products/:id - Delete product (requires auth & ownership)
router.delete('/:id', auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ 
        success: false, 
        message: 'Product not found' 
      });
    }

    // Check ownership
    if (product.seller.toString() !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'You can only delete your own products' 
      });
    }

    // Soft delete by changing status
    product.status = 'removed';
    await product.save();

    // Or hard delete
    // await product.remove();

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error deleting product',
      error: error.message 
    });
  }
});

// POST /api/products/:id/favorite - Toggle favorite (requires auth)
router.post('/:id/favorite', auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ 
        success: false, 
        message: 'Product not found' 
      });
    }

    await product.toggleFavorite(req.user.id);

    res.json({
      success: true,
      message: 'Favorite toggled',
      isFavorited: product.favorites.includes(req.user.id)
    });
  } catch (error) {
    console.error('Error toggling favorite:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error toggling favorite',
      error: error.message 
    });
  }
});

// POST /api/products/:id/offer - Make an offer (requires auth)
router.post('/:id/offer', auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('seller', 'username email');

    if (!product) {
      return res.status(404).json({ 
        success: false, 
        message: 'Product not found' 
      });
    }

    if (!product.acceptsOffers) {
      return res.status(400).json({ 
        success: false, 
        message: 'This product does not accept offers' 
      });
    }

    const offerAmount = parseFloat(req.body.amount);

    if (product.minimumOffer && offerAmount < product.minimumOffer) {
      return res.status(400).json({ 
        success: false, 
        message: `Offer must be at least $${product.minimumOffer}` 
      });
    }

    // Auto-accept if meets auto-accept price
    if (product.autoAcceptPrice && offerAmount >= product.autoAcceptPrice) {
      // Implement auto-accept logic
      // This would typically create an order/transaction
      return res.json({
        success: true,
        message: 'Offer auto-accepted!',
        autoAccepted: true
      });
    }

    // Create offer record (you'll need an Offer model)
    // const offer = new Offer({
    //   product: product._id,
    //   buyer: req.user.id,
    //   amount: offerAmount,
    //   message: req.body.message
    // });
    // await offer.save();

    res.json({
      success: true,
      message: 'Offer submitted successfully',
      autoAccepted: false
    });
  } catch (error) {
    console.error('Error making offer:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error making offer',
      error: error.message 
    });
  }
});

// POST /api/products/:id/sold - Mark as sold (requires auth & ownership)
router.post('/:id/sold', auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ 
        success: false, 
        message: 'Product not found' 
      });
    }

    if (product.seller.toString() !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'You can only mark your own products as sold' 
      });
    }

    const { buyerId, salePrice } = req.body;
    await product.markAsSold(buyerId, salePrice);

    res.json({
      success: true,
      message: 'Product marked as sold',
      product
    });
  } catch (error) {
    console.error('Error marking as sold:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error marking product as sold',
      error: error.message 
    });
  }
});

// GET /api/products/user/:userId - Get products by user
router.get('/user/:userId', async (req, res) => {
  try {
    const products = await Product.find({ 
      seller: req.params.userId,
      status: { $in: ['available', 'pending', 'sold'] }
    })
    .populate('seller', 'username rating')
    .sort('-createdAt');

    res.json({
      success: true,
      products
    });
  } catch (error) {
    console.error('Error fetching user products:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching user products',
      error: error.message 
    });
  }
});

// POST /api/products/:id/report - Report/flag a product (requires auth)
router.post('/:id/report', auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ 
        success: false, 
        message: 'Product not found' 
      });
    }

    product.flagged = true;
    product.flagReason = req.body.reason;
    await product.save();

    res.json({
      success: true,
      message: 'Product reported successfully'
    });
  } catch (error) {
    console.error('Error reporting product:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error reporting product',
      error: error.message 
    });
  }
});

module.exports = router;