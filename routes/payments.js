// routes/payments.js
const express = require('express');
const router = express.Router();

const stripe = require('../config/stripe');                 // configured client
const Product = require('../models/Product');               // your Product model
const PromotionCode = require('../models/PromotionCode');   // promo model
const auth = require('../middleware/auth');                 // user auth

// Helper: compute promo application against a listing
async function computePromotion({ code, listing }) {
  if (!code) return { applied: false, finalPrice: listing.price, discountAmount: 0, percent: 0, promotion: null };

  const now = new Date();
  const promotion = await PromotionCode.findOne({
    code: String(code).toUpperCase(),
    active: true,
    validFrom: { $lte: now },
    validUntil: { $gte: now },
  });

  if (!promotion) {
    return { applied: false, reason: 'Invalid or expired code', finalPrice: listing.price, discountAmount: 0, percent: 0, promotion: null };
  }

  if (promotion.usageLimit && promotion.timesUsed >= promotion.usageLimit) {
    return { applied: false, reason: 'Code usage limit reached', finalPrice: listing.price, discountAmount: 0, percent: 0, promotion };
  }

  if (!listing.acceptsPromotionalDiscounts) {
    return { applied: false, reason: 'Listing does not accept discounts', finalPrice: listing.price, discountAmount: 0, percent: 0, promotion };
  }

  if (listing.price < (promotion.minOrderAmount || 0)) {
    return { applied: false, reason: `Minimum order of $${promotion.minOrderAmount} required`, finalPrice: listing.price, discountAmount: 0, percent: 0, promotion };
  }

  const effectivePercent = Math.min(promotion.discountPercent, listing.maxDiscountPercent || 10);
  const discountAmount = Math.round(listing.price * (effectivePercent / 100) * 100) / 100;
  const finalPrice = Math.max(0, Math.round((listing.price - discountAmount) * 100) / 100);

  return { applied: true, finalPrice, discountAmount, percent: effectivePercent, promotion };
}

/**
 * POST /api/payments/create-payment-intent
 * Body:
 *  - listingId (preferred)
 *  - code (optional promo code)
 *  - currency? default 'usd'
 *  - amount? (fallback only if no listingId; expects dollars)
 */
router.post('/create-payment-intent', async (req, res) => {
  try {
    const { listingId, code, currency = 'usd', amount } = req.body;

    let baseAmount;
    let listing = null;
    let promoResult = { applied: false, finalPrice: 0, discountAmount: 0, percent: 0, promotion: null };

    if (listingId) {
      listing = await Product.findById(listingId);
      if (!listing) return res.status(404).json({ error: 'Listing not found' });
      if (listing.status && !['available', 'pending'].includes(listing.status)) {
        return res.status(400).json({ error: 'Listing not available for purchase' });
      }

      promoResult = await computePromotion({ code, listing });
      baseAmount = promoResult.finalPrice;
    } else {
      // fallback direct amount path (no listing)
      if (!amount || amount <= 0) return res.status(400).json({ error: 'Valid amount is required' });
      baseAmount = Number(amount);
    }

    const amountInCents = Math.max(0, Math.round(baseAmount * 100));

    const pi = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency,
      automatic_payment_methods: { enabled: true },
      metadata: {
        ...(listing ? { listingId: String(listing._id) } : {}),
        ...(promoResult.applied && promoResult.promotion
          ? {
              promoId: String(promoResult.promotion._id),
              promoCode: promoResult.promotion.code,
              promoPercent: String(promoResult.percent),
              promoDiscount: String(promoResult.discountAmount),
            }
          : {}),
        source: 'summit-soles',
      },
    });

    res.json({
      clientSecret: pi.client_secret,
      paymentIntentId: pi.id,
      currency,
      amount: listing ? listing.price : baseAmount,
      finalAmount: amountInCents / 100,
      appliedPromotion: promoResult.applied
        ? {
            code: promoResult.promotion.code,
            name: promoResult.promotion.name,
            percent: promoResult.percent,
            discount: promoResult.discountAmount,
          }
        : null,
      message: '✅ Payment intent created',
    });
  } catch (err) {
    console.error('Create PI error:', err);
    res.status(500).json({ error: err.message || 'Stripe error' });
  }
});

/**
 * POST /api/payments/confirm-payment
 * Body:
 *  - paymentIntentId
 * Notes:
 *  - Requires auth, verifies Stripe status, bumps promo + listing stats if present
 */
router.post('/confirm-payment', auth, async (req, res) => {
  try {
    const { paymentIntentId } = req.body;
    if (!paymentIntentId) return res.status(400).json({ error: 'paymentIntentId is required' });

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (!pi) return res.status(404).json({ error: 'PaymentIntent not found' });

    // You can also confirm server-side if you want, but client usually confirms
    if (pi.status !== 'succeeded') {
      return res.status(400).json({ error: `Payment not complete (status: ${pi.status})` });
    }

    const { promoId, promoDiscount, listingId } = pi.metadata || {};

    // bump promo usage if present
    if (promoId) {
      const promo = await PromotionCode.findById(promoId);
      if (promo) {
        // guard usageLimit
        if (!promo.usageLimit || promo.timesUsed < promo.usageLimit) {
          promo.timesUsed += 1;
          await promo.save();
        }
      }
    }

    // bump listing discount stats if present
    if (listingId) {
      const listing = await Product.findById(listingId);
      if (listing) {
        const discountVal = Number(promoDiscount || 0);
        listing.discountStats = listing.discountStats || {};
        listing.discountStats.timesDiscountApplied = (listing.discountStats.timesDiscountApplied || 0) + (discountVal > 0 ? 1 : 0);
        listing.discountStats.totalDiscountValue = (listing.discountStats.totalDiscountValue || 0) + discountVal;
        listing.discountStats.lastDiscountUsed = new Date();
        await listing.save();
      }
    }

    // TODO: create Order record here if/when you add an Order model

    res.json({
      success: true,
      message: 'Payment confirmed',
      paymentIntentId,
    });
  } catch (err) {
    console.error('Confirm PI error:', err);
    res.status(500).json({ error: err.message || 'Stripe error' });
  }
});

module.exports = router;
