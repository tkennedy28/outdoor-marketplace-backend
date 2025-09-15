// backend/models/Product.js

const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  // Basic Information
  title: { 
    type: String, 
    required: true,
    trim: true,
    maxLength: 200
  },
  description: { 
    type: String, 
    required: true,
    maxLength: 2000
  },
  
  // Seller Information
  seller: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    required: true
  },
  
  // Shoe Details
  brand: {
    type: String,
    required: true,
    enum: ['La Sportiva', 'Scarpa', 'Five Ten', 'Evolv', 'Black Diamond', 
           'Butora', 'Mad Rock', 'Tenaya', 'Ocun', 'Red Chili', 'So iLL', 
           'Unparallel', 'Other']
  },
  model: {
    type: String,
    trim: true
  },
  
  // Sizing
  size: String, // Deprecated - use sizeUS/sizeEU
  sizeUS: {
    type: String,
    required: true
  },
  sizeEU: String,
  
  // Condition & Type
  condition: {
    type: String,
    required: true,
    enum: ['new', 'likenew', 'excellent', 'good', 'need to resole'],
    default: 'good'
  },
  type: {
    type: String,
    enum: ['aggressive', 'moderate', 'neutral', 'approach', 'kids']
  },
  gender: {
    type: String,
    enum: ['mens', 'womens', 'unisex'],
    default: 'unisex'
  },
  category: {
    type: String,
    enum: ['Sport Climbing', 'Bouldering', 'Traditional', 'All-Around', 'Approach']
  },
  
  // Pricing
  price: { 
    type: Number, 
    required: true,
    min: 0
  },
  originalPrice: Number, // Original retail price for reference
  
  // Offers Feature
  acceptsOffers: { 
    type: Boolean, 
    default: false 
  },
  minimumOffer: { 
    type: Number,
    validate: {
      validator: function(value) {
        return !value || value < this.price;
      },
      message: 'Minimum offer must be less than listing price'
    }
  },
  autoAcceptPrice: { 
    type: Number,
    validate: {
      validator: function(value) {
        return !value || value <= this.price;
      },
      message: 'Auto-accept price cannot be higher than listing price'
    }
  },
  
  // Images (Cloudinary integration)
  images: [{
    url: {
      type: String,
      required: true
    },
    publicId: String // Cloudinary public ID for deletion
  }],
  
  // Location & Shipping
  location: {
    type: String,
    required: true
  },
  shippingAvailable: {
    type: Boolean,
    default: false
  },
  shippingPrice: {
    type: Number,
    min: 0
  },
  localPickup: {
    type: Boolean,
    default: true
  },
  
  // Status & Tracking
  status: {
    type: String,
    enum: ['available', 'pending', 'sold', 'inactive', 'removed'],
    default: 'available',
    index: true
  },
  
  // Sale Information
  soldTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  soldPrice: Number,
  soldAt: Date,
  
  // Analytics
  views: {
    type: Number,
    default: 0
  },
  favorites: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  // Search & Discovery
  tags: [String],
  featured: {
    type: Boolean,
    default: false
  },
  
  // Moderation
  flagged: {
    type: Boolean,
    default: false
  },
  flagReason: String,
  verified: {
    type: Boolean,
    default: false
  }
  
}, { 
  timestamps: true // Adds createdAt and updatedAt
});

// Indexes for better query performance
productSchema.index({ seller: 1, status: 1 });
productSchema.index({ brand: 1, condition: 1, status: 1 });
productSchema.index({ price: 1, status: 1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ 
  title: 'text', 
  description: 'text', 
  brand: 'text', 
  model: 'text' 
}); // Text search index

// Virtual for formatted price
productSchema.virtual('formattedPrice').get(function() {
  return `$${this.price.toFixed(2)}`;
});

// Virtual for discount percentage
productSchema.virtual('discountPercentage').get(function() {
  if (this.originalPrice && this.originalPrice > this.price) {
    return Math.round((1 - this.price / this.originalPrice) * 100);
  }
  return 0;
});

// Method to check if user can edit
productSchema.methods.canEdit = function(userId) {
  return this.seller.toString() === userId.toString() && this.status === 'available';
};

// Method to mark as sold
productSchema.methods.markAsSold = async function(buyerId, salePrice) {
  this.status = 'sold';
  this.soldTo = buyerId;
  this.soldPrice = salePrice || this.price;
  this.soldAt = new Date();
  return this.save();
};

// Method to increment views
productSchema.methods.incrementViews = async function() {
  this.views += 1;
  return this.save();
};

// Method to toggle favorite
productSchema.methods.toggleFavorite = async function(userId) {
  const index = this.favorites.indexOf(userId);
  if (index > -1) {
    this.favorites.splice(index, 1);
  } else {
    this.favorites.push(userId);
  }
  return this.save();
};

// Pre-save middleware to validate images
productSchema.pre('save', function(next) {
  if (this.images && this.images.length === 0) {
    return next(new Error('At least one image is required'));
  }
  if (this.images && this.images.length > 8) {
    return next(new Error('Maximum 8 images allowed'));
  }
  next();
});

// Static method to get featured products
productSchema.statics.getFeatured = function(limit = 6) {
  return this.find({ 
    status: 'available', 
    featured: true 
  })
  .limit(limit)
  .populate('seller', 'username rating')
  .sort('-createdAt');
};

// Static method to get similar products
productSchema.statics.getSimilar = function(product, limit = 4) {
  return this.find({
    _id: { $ne: product._id },
    status: 'available',
    brand: product.brand,
    $or: [
      { type: product.type },
      { category: product.category },
      { condition: product.condition }
    ]
  })
  .limit(limit)
  .populate('seller', 'username rating')
  .sort('-views');
};

// Static method for advanced search
productSchema.statics.searchProducts = async function(filters) {
  const query = { status: 'available' };
  
  // Text search
  if (filters.search) {
    query.$text = { $search: filters.search };
  }
  
  // Brand filter
  if (filters.brand) {
    query.brand = filters.brand;
  }
  
  // Size filters
  if (filters.sizeUS) {
    query.sizeUS = filters.sizeUS;
  }
  if (filters.sizeEU) {
    query.sizeEU = filters.sizeEU;
  }
  
  // Condition filter
  if (filters.condition) {
    query.condition = filters.condition;
  }
  
  // Type filter
  if (filters.type) {
    query.type = filters.type;
  }
  
  // Gender filter
  if (filters.gender) {
    query.gender = filters.gender;
  }
  
  // Category filter
  if (filters.category) {
    query.category = filters.category;
  }
  
  // Price range
  if (filters.minPrice || filters.maxPrice) {
    query.price = {};
    if (filters.minPrice) query.price.$gte = Number(filters.minPrice);
    if (filters.maxPrice) query.price.$lte = Number(filters.maxPrice);
  }
  
  // Location filter
  if (filters.location) {
    query.location = new RegExp(filters.location, 'i');
  }
  
  // Shipping filter
  if (filters.shippingAvailable !== undefined) {
    query.shippingAvailable = filters.shippingAvailable === 'true';
  }
  
  // Accepts offers filter
  if (filters.acceptsOffers !== undefined) {
    query.acceptsOffers = filters.acceptsOffers === 'true';
  }
  
  // Build sort
  let sort = {};
  switch (filters.sortBy) {
    case 'price_low':
      sort = { price: 1 };
      break;
    case 'price_high':
      sort = { price: -1 };
      break;
    case 'newest':
      sort = { createdAt: -1 };
      break;
    case 'popular':
      sort = { views: -1 };
      break;
    default:
      sort = { createdAt: -1 };
  }
  
  return this.find(query)
    .sort(sort)
    .populate('seller', 'username rating reviewCount verified');
};

module.exports = mongoose.model('Product', productSchema);