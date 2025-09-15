// backend/models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const userSchema = new mongoose.Schema(
  {
    // Authentication
    username: {
      type: String,
      required: true,
      unique: true,     // single source of truth (no duplicate schema.index)
      index: true,
      trim: true,
      lowercase: true,
      minLength: 3,
      maxLength: 30
    },
    email: {
      type: String,
      required: true,
      unique: true,     // single source of truth (no duplicate schema.index)
      index: true,
      lowercase: true,
      trim: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,})+$/, 'Please enter a valid email']
    },
    password: {
      type: String,
      required: true,
      minLength: 6,
      select: false
    },

    // Profile Information
    firstName: String,
    lastName: String,
    avatar: String,
    avatarPublicId: String, // Cloudinary public ID for avatar
    bio: { type: String, maxLength: 500 },
    location: String,
    phoneNumber: String,

    // Seller Information
    rating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0 },
    totalSales: { type: Number, default: 0 },
    totalPurchases: { type: Number, default: 0 },

    // Verification & Status
    verified: { type: Boolean, default: false },
    verificationToken: String,
    verificationExpires: Date,
    emailVerified: { type: Boolean, default: false },

    // Account Status
    status: {
      type: String,
      enum: ['active', 'inactive', 'suspended', 'banned'],
      default: 'active'
    },
    role: {
      type: String,
      enum: ['user', 'admin', 'moderator'],
      default: 'user'
    },

    // Preferences
    emailNotifications: { type: Boolean, default: true },
    smsNotifications: { type: Boolean, default: false },
    marketingEmails: { type: Boolean, default: false },

    // Climbing Preferences
    climbingStyle: { type: String, enum: ['sport', 'trad', 'boulder', 'alpine', 'all'] },
    shoeSize: {
      us: String,
      eu: String
    },
    preferredBrands: [String],

    // Favorites & Saved Searches
    favoriteListings: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    }],
    savedSearches: [{
      name: String,
      filters: Object,
      createdAt: { type: Date, default: Date.now }
    }],

    // Following/Followers
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // Stripe Integration
    stripeCustomerId: String,
    stripeAccountId: String,
    paymentMethods: [{
      id: String,
      brand: String,
      last4: String,
      isDefault: Boolean
    }],

    // Security
    resetPasswordToken: String,
    resetPasswordExpires: Date,
    loginAttempts: { type: Number, default: 0 },
    lockUntil: Date,
    twoFactorSecret: String,
    twoFactorEnabled: { type: Boolean, default: false },

    // Activity Tracking
    lastLogin: Date,
    lastActive: Date,
    ipAddress: String,

    // Shipping Addresses
    addresses: [{
      label: String,
      street1: String,
      street2: String,
      city: String,
      state: String,
      zipCode: String,
      country: String,
      isDefault: Boolean
    }],

    // Stats for 1% for Climbing
    totalContributed: { type: Number, default: 0 }
  },
  { timestamps: true }
);

/* ------------------------------------------------------------------ */
/* Indexes — keep only non-duplicate ones (email/username are inline) */
/* ------------------------------------------------------------------ */
userSchema.index({ status: 1 });
userSchema.index({ createdAt: -1 });

/* --------------------------- Virtuals ---------------------------------- */
userSchema.virtual('fullName').get(function () {
  return (this.firstName && this.lastName) ? `${this.firstName} ${this.lastName}` : this.username;
});

userSchema.virtual('memberSince').get(function () {
  return this.createdAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
});

/* --------------------------- Hooks ------------------------------------- */
// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    return next();
  } catch (err) {
    return next(err);
  }
});

/* --------------------------- Methods ----------------------------------- */
userSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.generateAuthToken = function () {
  return jwt.sign(
    { id: this._id, email: this.email, username: this.username, role: this.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

userSchema.methods.generatePasswordResetToken = function () {
  const resetToken = crypto.randomBytes(20).toString('hex');
  this.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  this.resetPasswordExpires = Date.now() + (30 * 60 * 1000); // 30 minutes
  return resetToken;
};

userSchema.methods.isLocked = function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

userSchema.methods.incLoginAttempts = function () {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({ $set: { loginAttempts: 1 }, $unset: { lockUntil: 1 } });
  }
  const updates = { $inc: { loginAttempts: 1 } };
  const maxAttempts = 5;
  const lockTime = 2 * 60 * 60 * 1000; // 2 hours
  if (this.loginAttempts + 1 >= maxAttempts && !this.isLocked()) {
    updates.$set = { lockUntil: Date.now() + lockTime };
  }
  return this.updateOne(updates);
};

userSchema.methods.resetLoginAttempts = function () {
  return this.updateOne({ $set: { loginAttempts: 0 }, $unset: { lockUntil: 1 } });
};

userSchema.methods.updateRating = async function (newRating) {
  const totalRating = this.rating * this.reviewCount + newRating;
  this.reviewCount += 1;
  this.rating = totalRating / this.reviewCount;
  return this.save();
};

userSchema.methods.addToFavorites = async function (productId) {
  if (!this.favoriteListings.includes(productId)) {
    this.favoriteListings.push(productId);
    return this.save();
  }
  return this;
};

userSchema.methods.removeFromFavorites = async function (productId) {
  this.favoriteListings = this.favoriteListings.filter(id => id.toString() !== productId.toString());
  return this.save();
};

userSchema.methods.follow = async function (userId) {
  if (!this.following.includes(userId)) {
    this.following.push(userId);
    await mongoose.model('User').findByIdAndUpdate(userId, { $addToSet: { followers: this._id } });
    return this.save();
  }
  return this;
};

userSchema.methods.unfollow = async function (userId) {
  this.following = this.following.filter(id => id.toString() !== userId.toString());
  await mongoose.model('User').findByIdAndUpdate(userId, { $pull: { followers: this._id } });
  return this.save();
};

/* --------------------------- Statics ----------------------------------- */
userSchema.statics.findByCredentials = async function (email, password) {
  const user = await this.findOne({ email }).select('+password');
  if (!user) throw new Error('Invalid login credentials');
  if (user.isLocked()) throw new Error('Account is locked due to too many failed login attempts');

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    await user.incLoginAttempts();
    throw new Error('Invalid login credentials');
  }
  if (user.status !== 'active') throw new Error(`Account is ${user.status}`);

  await user.resetLoginAttempts();
  user.lastLogin = Date.now();
  await user.save();

  return user;
};

/* --------------------------- Serialization ----------------------------- */
userSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.password;
  delete user.resetPasswordToken;
  delete user.resetPasswordExpires;
  delete user.verificationToken;
  delete user.twoFactorSecret;
  delete user.stripeAccountId;
  delete user.loginAttempts;
  delete user.lockUntil;
  delete user.__v;
  return user;
};

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
