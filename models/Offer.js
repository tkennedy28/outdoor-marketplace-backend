// backend/models/Offer.js

const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema({
  listing: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Product', // or 'Listing' depending on your model name
    required: true 
  },
  buyer: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  seller: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  offerAmount: { 
    type: Number, 
    required: true,
    min: 1 
  },
  originalPrice: { 
    type: Number, 
    required: true 
  },
  message: { 
    type: String, 
    maxLength: 500 
  },
  status: { 
    type: String, 
    enum: ['pending', 'accepted', 'declined', 'countered', 'expired', 'withdrawn'],
    default: 'pending'
  },
  counterOffer: {
    amount: Number,
    message: String,
    timestamp: Date
  },
  expiresAt: { 
    type: Date, 
    default: () => new Date(+new Date() + 48*60*60*1000) // 48 hours from now
  },
  acceptedAt: Date,
  declinedAt: Date,
  
  // Auto-accept/decline settings (copied from listing at time of offer)
  autoAcceptPrice: Number,
  minimumOffer: Number,
  
  // Track offer history
  history: [{
    action: {
      type: String,
      enum: ['created', 'countered', 'accepted', 'declined', 'expired', 'withdrawn']
    },
    amount: Number,
    message: String,
    timestamp: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }]
}, { 
  timestamps: true 
});

// Indexes for performance
offerSchema.index({ listing: 1, status: 1 });
offerSchema.index({ buyer: 1, status: 1 });
offerSchema.index({ seller: 1, status: 1 });
offerSchema.index({ expiresAt: 1 });

// Check if offer should auto-accept or auto-decline
offerSchema.methods.checkAutoResponse = function() {
  if (this.status !== 'pending') return null;
  
  if (this.autoAcceptPrice && this.offerAmount >= this.autoAcceptPrice) {
    return 'accept';
  }
  
  if (this.minimumOffer && this.offerAmount < this.minimumOffer) {
    return 'decline';
  }
  
  return null;
};

// Check if offer has expired
offerSchema.methods.isExpired = function() {
  return this.status === 'pending' && new Date() > this.expiresAt;
};

// Add to history when status changes
offerSchema.pre('save', function(next) {
  if (this.isModified('status')) {
    this.history.push({
      action: this.status,
      amount: this.status === 'countered' ? this.counterOffer?.amount : this.offerAmount,
      message: this.status === 'countered' ? this.counterOffer?.message : this.message,
      by: this.status === 'countered' ? this.seller : this.buyer
    });
  }
  next();
});

module.exports = mongoose.model('Offer', offerSchema);
