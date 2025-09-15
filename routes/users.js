// backend/routes/users.js

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');

// @route   GET /api/users/:id
// @desc    Get user by ID (public profile)
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -resetPasswordToken -resetPasswordExpires -stripeAccountId');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        avatar: user.avatar,
        bio: user.bio,
        location: user.location,
        rating: user.rating,
        reviewCount: user.reviewCount,
        totalSales: user.totalSales,
        verified: user.verified,
        memberSince: user.memberSince,
        following: user.following.length,
        followers: user.followers.length
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/users/:id/listings
// @desc    Get user's active listings
router.get('/:id/listings', async (req, res) => {
  try {
    const Product = require('../models/Product');
    
    const listings = await Product.find({
      seller: req.params.id,
      status: 'available'
    })
    .sort('-createdAt')
    .populate('seller', 'username avatar rating');

    res.json({
      success: true,
      listings,
      count: listings.length
    });
  } catch (error) {
    console.error('Get user listings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching listings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/users/:id/reviews
// @desc    Get user's reviews
router.get('/:id/reviews', async (req, res) => {
  try {
    // TODO: Implement when you have a Review model
    res.json({
      success: true,
      reviews: [],
      message: 'Reviews feature coming soon'
    });
  } catch (error) {
    console.error('Get reviews error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching reviews'
    });
  }
});

// @route   POST /api/users/:id/follow
// @desc    Follow a user (requires auth)
router.post('/:id/follow', auth, async (req, res) => {
  try {
    if (req.user.id === req.params.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot follow yourself'
      });
    }

    const userToFollow = await User.findById(req.params.id);
    if (!userToFollow) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const currentUser = await User.findById(req.user.id);
    
    // Check if already following
    if (currentUser.following.includes(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'You are already following this user'
      });
    }

    // Use the model method if it exists
    if (currentUser.follow) {
      await currentUser.follow(req.params.id);
    } else {
      // Manual follow
      currentUser.following.push(req.params.id);
      await currentUser.save();
      
      userToFollow.followers.push(req.user.id);
      await userToFollow.save();
    }

    res.json({
      success: true,
      message: 'Successfully followed user'
    });
  } catch (error) {
    console.error('Follow error:', error);
    res.status(500).json({
      success: false,
      message: 'Error following user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   DELETE /api/users/:id/follow
// @desc    Unfollow a user (requires auth)
router.delete('/:id/follow', auth, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id);
    
    if (!currentUser.following.includes(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'You are not following this user'
      });
    }

    // Use the model method if it exists
    if (currentUser.unfollow) {
      await currentUser.unfollow(req.params.id);
    } else {
      // Manual unfollow
      currentUser.following = currentUser.following.filter(
        id => id.toString() !== req.params.id
      );
      await currentUser.save();
      
      await User.findByIdAndUpdate(req.params.id, {
        $pull: { followers: req.user.id }
      });
    }

    res.json({
      success: true,
      message: 'Successfully unfollowed user'
    });
  } catch (error) {
    console.error('Unfollow error:', error);
    res.status(500).json({
      success: false,
      message: 'Error unfollowing user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/users/search
// @desc    Search users
router.get('/search', async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    
    if (!q) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const users = await User.find({
      $or: [
        { username: new RegExp(q, 'i') },
        { email: new RegExp(q, 'i') },
        { firstName: new RegExp(q, 'i') },
        { lastName: new RegExp(q, 'i') }
      ],
      status: 'active'
    })
    .select('username avatar bio rating verified')
    .limit(parseInt(limit));

    res.json({
      success: true,
      users,
      count: users.length
    });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({
      success: false,
      message: 'Error searching users',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/users/top-sellers
// @desc    Get top sellers
router.get('/top-sellers', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    
    const topSellers = await User.find({
      status: 'active',
      totalSales: { $gt: 0 }
    })
    .select('username avatar bio rating totalSales verified')
    .sort('-totalSales -rating')
    .limit(parseInt(limit));

    res.json({
      success: true,
      sellers: topSellers
    });
  } catch (error) {
    console.error('Get top sellers error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching top sellers',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   PUT /api/users/preferences
// @desc    Update user preferences (requires auth)
router.put('/preferences', auth, async (req, res) => {
  try {
    const allowedUpdates = [
      'emailNotifications',
      'smsNotifications',
      'marketingEmails',
      'climbingStyle',
      'shoeSize',
      'preferredBrands'
    ];
    
    const updates = {};
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Preferences updated successfully',
      user
    });
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating preferences',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/users/report
// @desc    Report a user (requires auth)
router.post('/:id/report', auth, async (req, res) => {
  try {
    const { reason, description } = req.body;
    
    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Report reason is required'
      });
    }

    // TODO: Implement reporting system
    // For now, just log it
    console.log('User report:', {
      reportedUser: req.params.id,
      reportedBy: req.user.id,
      reason,
      description
    });

    res.json({
      success: true,
      message: 'User reported successfully. Our team will review this report.'
    });
  } catch (error) {
    console.error('Report user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error reporting user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;