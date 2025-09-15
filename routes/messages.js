// backend/routes/messages.js

const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const Product = require('../models/Product'); // Adjust to your model name
const auth = require('../middleware/auth');

// SEND MESSAGE
// POST /api/messages
router.post('/', auth, async (req, res) => {
  try {
    const { receiverId, listingId, message } = req.body;
    const senderId = req.user.id;

    // Validate receiver exists
    const receiver = await User.findById(receiverId);
    if (!receiver) {
      return res.status(404).json({ error: 'Receiver not found' });
    }

    // Validate listing exists
    const listing = await Product.findById(listingId);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    // Prevent self-messaging
    if (senderId === receiverId) {
      return res.status(400).json({ error: 'Cannot send message to yourself' });
    }

    // Find or create conversation
    const conversation = await Conversation.findOrCreate(
      [senderId, receiverId],
      listingId
    );

    // Create message
    const newMessage = await Message.create({
      conversation: conversation._id,
      sender: senderId,
      receiver: receiverId,
      listing: listingId,
      message
    });

    // Update conversation
    conversation.lastMessage = newMessage._id;
    conversation.lastMessageAt = new Date();
    await conversation.incrementUnread(receiverId);

    // Populate sender info
    await newMessage.populate('sender', 'username email avatar');
    await newMessage.populate('receiver', 'username email');
    await newMessage.populate('listing', 'title price images');

    res.status(201).json({
      success: true,
      message: newMessage
    });

  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// GET CONVERSATIONS LIST
// GET /api/messages/conversations
router.get('/conversations', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const conversations = await Conversation.find({
      participants: userId,
      status: { $ne: 'archived' }
    })
    .populate('participants', 'username email avatar')
    .populate('listing', 'title price images status')
    .populate('lastMessage')
    .sort({ lastMessageAt: -1 });

    // Format conversations with unread counts
    const formattedConversations = conversations.map(conv => {
      const otherParticipant = conv.participants.find(
        p => p._id.toString() !== userId
      );
      
      return {
        _id: conv._id,
        otherUser: otherParticipant,
        listing: conv.listing,
        lastMessage: conv.lastMessage,
        lastMessageAt: conv.lastMessageAt,
        unreadCount: conv.unreadCount.get(userId) || 0,
        resultedInSale: conv.resultedInSale
      };
    });

    res.json({
      success: true,
      conversations: formattedConversations
    });

  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Failed to get conversations' });
  }
});

// GET MESSAGES IN CONVERSATION
// GET /api/messages/conversation/:conversationId
router.get('/conversation/:conversationId', auth, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;
    const { page = 1, limit = 50 } = req.query;

    // Verify user is participant
    const conversation = await Conversation.findById(conversationId)
      .populate('participants', 'username email avatar')
      .populate('listing', 'title price images status seller');

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const isParticipant = conversation.participants.some(
      p => p._id.toString() === userId
    );

    if (!isParticipant) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Get messages with pagination
    const messages = await Message.find({
      conversation: conversationId,
      deleted: false
    })
    .populate('sender', 'username email avatar')
    .populate('receiver', 'username email')
    .populate('offerDetails.offerId')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

    // Mark messages as read
    await Message.updateMany(
      {
        conversation: conversationId,
        receiver: userId,
        read: false
      },
      {
        read: true,
        readAt: new Date()
      }
    );

    // Reset unread count for this user
    await conversation.resetUnread(userId);

    res.json({
      success: true,
      conversation: {
        _id: conversation._id,
        participants: conversation.participants,
        listing: conversation.listing,
        resultedInSale: conversation.resultedInSale
      },
      messages: messages.reverse(), // Return in chronological order
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: messages.length === limit
      }
    });

  } catch (error) {
    console.error('Get conversation messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// MARK MESSAGE AS READ
// PUT /api/messages/:id/read
router.put('/:id/read', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Verify receiver
    if (message.receiver.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await message.markAsRead();

    // Update conversation unread count
    const conversation = await Conversation.findById(message.conversation);
    const currentUnread = conversation.unreadCount.get(req.user.id) || 0;
    if (currentUnread > 0) {
      conversation.unreadCount.set(req.user.id, currentUnread - 1);
      await conversation.save();
    }

    res.json({
      success: true,
      message: 'Message marked as read'
    });

  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark message as read' });
  }
});

// MARK ALL MESSAGES IN CONVERSATION AS READ
// PUT /api/messages/conversation/:conversationId/read-all
router.put('/conversation/:conversationId/read-all', auth, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    // Verify user is participant
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const isParticipant = conversation.participants.some(
      p => p.toString() === userId
    );

    if (!isParticipant) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Mark all messages as read
    await Message.updateMany(
      {
        conversation: conversationId,
        receiver: userId,
        read: false
      },
      {
        read: true,
        readAt: new Date()
      }
    );

    // Reset unread count
    await conversation.resetUnread(userId);

    res.json({
      success: true,
      message: 'All messages marked as read'
    });

  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

// DELETE/ARCHIVE CONVERSATION
// DELETE /api/messages/conversation/:conversationId
router.delete('/conversation/:conversationId', auth, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const isParticipant = conversation.participants.some(
      p => p.toString() === userId
    );

    if (!isParticipant) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Archive conversation (soft delete)
    conversation.status = 'archived';
    await conversation.save();

    res.json({
      success: true,
      message: 'Conversation archived'
    });

  } catch (error) {
    console.error('Archive conversation error:', error);
    res.status(500).json({ error: 'Failed to archive conversation' });
  }
});

// GET UNREAD MESSAGE COUNT
// GET /api/messages/unread-count
router.get('/unread-count', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const conversations = await Conversation.find({
      participants: userId,
      status: { $ne: 'archived' }
    });

    let totalUnread = 0;
    conversations.forEach(conv => {
      totalUnread += conv.unreadCount.get(userId) || 0;
    });

    res.json({
      success: true,
      unreadCount: totalUnread,
      conversationsWithUnread: conversations.filter(
        c => (c.unreadCount.get(userId) || 0) > 0
      ).length
    });

  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// BLOCK USER IN CONVERSATION
// PUT /api/messages/conversation/:conversationId/block
router.put('/conversation/:conversationId/block', auth, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const isParticipant = conversation.participants.some(
      p => p.toString() === userId
    );

    if (!isParticipant) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    conversation.status = 'blocked';
    conversation.blockedBy = userId;
    await conversation.save();

    res.json({
      success: true,
      message: 'User blocked'
    });

  } catch (error) {
    console.error('Block user error:', error);
    res.status(500).json({ error: 'Failed to block user' });
  }
});

// SEARCH MESSAGES
// GET /api/messages/search
router.get('/search', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { query, conversationId } = req.query;

    if (!query) {
      return res.status(400).json({ error: 'Search query required' });
    }

    const searchQuery = {
      $or: [
        { sender: userId },
        { receiver: userId }
      ],
      message: { $regex: query, $options: 'i' },
      deleted: false
    };

    if (conversationId) {
      searchQuery.conversation = conversationId;
    }

    const messages = await Message.find(searchQuery)
      .populate('sender', 'username')
      .populate('receiver', 'username')
      .populate('listing', 'title')
      .populate('conversation')
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({
      success: true,
      messages,
      count: messages.length
    });

  } catch (error) {
    console.error('Search messages error:', error);
    res.status(500).json({ error: 'Failed to search messages' });
  }
});

module.exports = router;