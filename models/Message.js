// backend/models/Message.js

const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversation: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Conversation', 
    required: true 
  },
  sender: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  receiver: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  listing: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Product' 
  },
  message: { 
    type: String, 
    required: true,
    maxLength: 1000 
  },
  isOffer: { 
    type: Boolean, 
    default: false 
  },
  offerDetails: {
    offerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer' },
    amount: Number,
    action: String // 'created', 'accepted', 'declined', 'countered'
  },
  read: { 
    type: Boolean, 
    default: false 
  },
  readAt: Date,
  edited: { 
    type: Boolean, 
    default: false 
  },
  editedAt: Date,
  deleted: { 
    type: Boolean, 
    default: false 
  }
}, { 
  timestamps: true 
});

// Indexes
messageSchema.index({ conversation: 1, createdAt: -1 });
messageSchema.index({ sender: 1, receiver: 1 });
messageSchema.index({ read: 1, receiver: 1 });

// Mark message as read
messageSchema.methods.markAsRead = function() {
  if (!this.read) {
    this.read = true;
    this.readAt = new Date();
    return this.save();
  }
  return Promise.resolve(this);
};

module.exports = mongoose.model('Message', messageSchema);
