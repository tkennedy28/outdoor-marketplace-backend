const express = require('express');
const router = express.Router();
const { upload, cloudinary } = require('../config/cloudinary');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');
const User = require('../models/User');

// Upload multiple images (up to 8) - for products
router.post('/upload', auth, upload.array('images', 8), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images uploaded' });
    }
    // Return URLs of uploaded images
    const imageUrls = req.files.map(file => ({
      url: file.path,
      publicId: file.filename
    }));
    res.json({
      success: true,
      images: imageUrls,
      message: `${imageUrls.length} images uploaded successfully`
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload images' });
  }
});

// Upload profile photo - NEW ENDPOINT
router.post('/profile-photo', auth, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a photo'
      });
    }

    const user = await User.findById(req.user.id);
    
    if (!user) {
      // Delete uploaded file from Cloudinary if user not found
      if (req.file.filename) {
        await cloudinary.uploader.destroy(req.file.filename);
      }
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Delete old profile photo from Cloudinary if it exists and is not the default
    if (user.avatar && !user.avatar.includes('ui-avatars.com')) {
      // Extract publicId from the old avatar URL if it's a Cloudinary URL
      const oldPublicId = user.avatarPublicId || extractPublicId(user.avatar);
      if (oldPublicId) {
        try {
          await cloudinary.uploader.destroy(oldPublicId);
        } catch (err) {
          console.error('Error deleting old avatar:', err);
        }
      }
    }

    // Update user avatar with new Cloudinary URL
    user.avatar = req.file.path; // Cloudinary URL
    user.avatarPublicId = req.file.filename; // Store publicId for future deletion
    await user.save();

    res.json({
      success: true,
      message: 'Profile photo updated successfully',
      photoUrl: user.avatar,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        avatar: user.avatar
      }
    });

  } catch (error) {
    // Delete uploaded file from Cloudinary if error occurs
    if (req.file && req.file.filename) {
      try {
        await cloudinary.uploader.destroy(req.file.filename);
      } catch (err) {
        console.error('Error cleaning up uploaded file:', err);
      }
    }
    
    console.error('Profile photo upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading profile photo',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Delete/Remove profile photo - NEW ENDPOINT
router.delete('/profile-photo', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Delete current profile photo from Cloudinary if it exists
    if (user.avatarPublicId) {
      try {
        await cloudinary.uploader.destroy(user.avatarPublicId);
      } catch (err) {
        console.error('Error deleting avatar from Cloudinary:', err);
      }
    }

    // Set back to default avatar
    user.avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.username)}&background=random`;
    user.avatarPublicId = undefined; // Clear the publicId
    await user.save();

    res.json({
      success: true,
      message: 'Profile photo removed',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        avatar: user.avatar
      }
    });

  } catch (error) {
    console.error('Remove profile photo error:', error);
    res.status(500).json({
      success: false,
      message: 'Error removing profile photo',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Delete an image (general purpose) - EXISTING ENDPOINT
router.delete('/upload/:publicId', auth, async (req, res) => {
  try {
    const { publicId } = req.params;
   
    await cloudinary.uploader.destroy(publicId);
   
    res.json({ success: true, message: 'Image deleted successfully' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// Helper function to extract publicId from Cloudinary URL
function extractPublicId(url) {
  try {
    // Example URL: https://res.cloudinary.com/demo/image/upload/v1234567890/sample.jpg
    // We want to extract: sample
    const parts = url.split('/');
    const filename = parts[parts.length - 1];
    const publicId = filename.split('.')[0];
    return publicId;
  } catch (err) {
    return null;
  }
}

module.exports = router;