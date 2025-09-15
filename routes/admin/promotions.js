// routes/admin/promotions.js
const express = require('express');
const router = express.Router();
const PromotionCode = require('../../models/PromotionCode');
const { admin: authenticateAdmin } = require('../../middleware/auth'); // adjust to your auth

// Create
router.post('/', authenticateAdmin, async (req, res) => {
  try {
    const { code, name, discountPercent, type, validFrom, validUntil, usageLimit, minOrderAmount } = req.body;
    const promo = await PromotionCode.create({
      code: String(code || '').toUpperCase(),
      name, discountPercent, type,
      validFrom: new Date(validFrom),
      validUntil: new Date(validUntil),
      usageLimit: usageLimit ?? null,
      minOrderAmount: minOrderAmount || 0,
      createdBy: req.user._id
    });
    res.json({ success: true, data: promo });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ success: false, message: 'Promotion code already exists' });
    res.status(500).json({ success: false, message: 'Error creating promotion code' });
  }
});

// List
router.get('/', authenticateAdmin, async (_req, res) => {
  try {
    const promos = await PromotionCode.find().populate('createdBy', 'username email').sort({ createdAt: -1 });
    res.json({ success: true, data: promos });
  } catch {
    res.status(500).json({ success: false, message: 'Error fetching promotions' });
  }
});

module.exports = router;
