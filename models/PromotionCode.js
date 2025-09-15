// backend/models/PromotionCode.js
const mongoose = require('mongoose');

const promotionCodeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,  // <-- single source of truth
      uppercase: true,
      index: true
    },
    name: { type: String, required: true },
    discountPercent: { type: Number, required: true, min: 1, max: 50 },
    type: { type: String, enum: ['holiday', 'student', 'military', 'group', 'flash_sale'], required: true },
    active: { type: Boolean, default: true },
    validFrom: { type: Date, required: true },
    validUntil: { type: Date, required: true },
    usageLimit: { type: Number, default: null },
    timesUsed: { type: Number, default: 0 },
    eligibleCategories: [String],
    minOrderAmount: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

// IMPORTANT: remove any duplicate schema.index({ code: 1 }, { unique: true }) calls.

module.exports =
  mongoose.models.PromotionCode ||
  mongoose.model('PromotionCode', promotionCodeSchema);
