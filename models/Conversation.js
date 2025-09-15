// backend/models/Conversation.js

const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  lastMessageAt: Date,
  unreadCount: {
    type: Map,
    of: Number,
    default: new Map()
  },
  status: {
    type: String,
    enum: ['active', 'archived', 'blocked'],
    default: 'active'
  },
  // Track if item was sold through this conversation
  resultedInSale: {
    type: Boolean,
    default: false
  },
  salePrice: Number,
  soldAt: Date
}, {
  timestamps: true
});

// Indexes
conversationSchema.index({ participants: 1, listing: 1 });
conversationSchema.index({ lastMessageAt: -1 });

// Get or create conversation
conversationSchema.statics.findOrCreate = async function(participantIds, listingId) {
  let conversation = await this.findOne({
    participants: { $all: participantIds },
    listing: listingId
  });
  
  if (!conversation) {
    conversation = await this.create({
      participants: participantIds,
      listing: listingId,
      unreadCount: new Map(participantIds.map(id => [id.toString(), 0]))
    });
  }
  
  return conversation;
};

// Update unread count
conversationSchema.methods.incrementUnread = function(userId) {
  const currentCount = this.unreadCount.get(userId.toString()) || 0;
  this.unreadCount.set(userId.toString(), currentCount + 1);
  return this.save();
};

conversationSchema.methods.resetUnread = function(userId) {
  this.unreadCount.set(userId.toString(), 0);
  return this.save();
};

module.exports = mongoose.model('Conversation', conversationSchema);