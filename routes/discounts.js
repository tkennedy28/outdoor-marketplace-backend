// routes/discounts.js
const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const PromotionCode = require('../models/PromotionCode');

// POST /api/discounts/apply
router.post('/apply', async (req, res) => {
  try {
    const { code, listingId } = req.body;
    const now = new Date();

    const promotion = await PromotionCode.findOne({
      code: String(code || '').toUpperCase(),
      active: true,
      validFrom: { $lte: now },
      validUntil: { $gte: now }
    });

    if (!promotion) return res.status(400).json({ success: false, message: 'Invalid or expired discount code' });

    if (promotion.usageLimit && promotion.timesUsed >= promotion.usageLimit) {
      return res.status(400).json({ success: false, message: 'This discount code has reached its usage limit' });
    }

    const listing = await Product.findById(listingId);
    if (!listing) return res.status(404).json({ success: false, message: 'Listing not found' });

    if (!listing.acceptsPromotionalDiscounts) {
      return res.status(400).json({ success: false, message: 'This listing does not accept discount codes' });
    }

    if (listing.price < promotion.minOrderAmount) {
      return res.status(400).json({ success: false, message: `Minimum order amount of $${promotion.minOrderAmount} required for this discount` });
    }

    const effectiveDiscountPercent = Math.min(promotion.discountPercent, listing.maxDiscountPercent);
    const discountAmount = Math.round((listing.price * effectiveDiscountPercent / 100) * 100) / 100;
    const finalPrice = Math.max(0, Math.round((listing.price - discountAmount) * 100) / 100);

    // NOTE: Do NOT increment usage here. Do it after payment succeeds (see payments confirm).
    return res.json({
      success: true,
      data: {
        promotionId: promotion._id,
        promotionName: promotion.name,
        discountPercent: effectiveDiscountPercent,
        discountAmount,
        originalPrice: listing.price,
        finalPrice
      }
    });
  } catch (err) {
    console.error('apply discount error', err);
    res.status(500).json({ success: false, message: 'Error applying discount code' });
  }
});

// POST /api/discounts/validate
router.post('/validate', async (req, res) => {
  try {
    const { code, listingId } = req.body;
    const now = new Date();

    const [promotion, listing] = await Promise.all([
      PromotionCode.findOne({
        code: String(code || '').toUpperCase(),
        active: true,
        validFrom: { $lte: now },
        validUntil: { $gte: now }
      }),
      Product.findById(listingId)
    ]);

    if (!promotion || !listing) return res.json({ valid: false, message: 'Invalid code or listing' });
    if (!listing.acceptsPromotionalDiscounts) return res.json({ valid: false, message: 'Listing does not accept discount codes' });
    if (promotion.usageLimit && promotion.timesUsed >= promotion.usageLimit) return res.json({ valid: false, message: 'Code usage limit reached' });
    if (listing.price < promotion.minOrderAmount) return res.json({ valid: false, message: `Minimum order of $${promotion.minOrderAmount} required` });

    const effectiveDiscountPercent = Math.min(promotion.discountPercent, listing.maxDiscountPercent);
    const discountAmount = Math.round((listing.price * effectiveDiscountPercent / 100) * 100) / 100;

    return res.json({
      valid: true,
      promotionId: promotion._id,
      discountPercent: effectiveDiscountPercent,
      discountAmount,
      finalPrice: Math.round((listing.price - discountAmount) * 100) / 100
    });
  } catch (err) {
    return res.json({ valid: false, message: 'Error validating code' });
  }
});

module.exports = router;
