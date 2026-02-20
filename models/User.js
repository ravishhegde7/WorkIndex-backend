const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    select: false
  },
  role: {
    type: String,
    enum: ['client', 'expert'],
    required: true
  },
  
  // ⭐ NEW: Profile Photo
  profilePhoto: {
    type: String,
    default: null // URL to uploaded photo
  },
  
  credits: {
    type: Number,
    default: 50
  },
  
  // ⭐ UPDATED: Expert Profile Fields
  profile: {
    type: Object,
    default: {}
  },
  
  specialization: String,
  
  qualifications: [{
    title: String,
    description: String
  }],
  
  // ⭐ NEW: Location (for experts and clients)
  location: {
    city: String,
    state: String,
    pincode: String,
    country: { type: String, default: 'India' },
    coordinates: {
      latitude: Number,
      longitude: Number
    },
    address: String
  },
  
  // ⭐ NEW: Portfolio/Description (for experts)
  bio: {
    type: String,
    maxlength: 1000
  },
  
  portfolio: [{
    title: String,
    description: String,
    image: String, // URL to image
    completedAt: Date
  }],
  
  // ⭐ NEW: Company Details (for experts)
  companyName: String,
  companySize: String,
  hasWebsite: Boolean,
  websiteUrl: String,
  yearsOfExperience: String,
  
  // ⭐ NEW: Services Offered (for experts)
  servicesOffered: [{
    type: String
  }],
  
  // ⭐ NEW: Certifications (for experts)
  certifications: [{
    type: String
  }],
  
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  
  reviewCount: {
    type: Number,
    default: 0
  },
  
  // ⭐ NEW: Total rating sum (for calculating average)
  totalRatingSum: {
    type: Number,
    default: 0
  },
  
  emailVerified: {
    type: Boolean,
    default: false
  },
  
  phoneVerified: {
    type: Boolean,
    default: false
  },
  
  emailOTP: String,
  phoneOTP: String,
  otpExpiry: Date,
  
  isActive: {
    type: Boolean,
    default: true
  },
  
  // ⭐ NEW: User Preferences
  preferences: {
    darkMode: {
      type: Boolean,
      default: false
    },
    notifications: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false }
    }
  },
  
  lastLogin: Date
}, {
  timestamps: true
});

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ role: 1 });
userSchema.index({ 'location.city': 1, 'location.state': 1 });
userSchema.index({ rating: -1 });

// Pre-save middleware for password hashing
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Generate OTP
userSchema.methods.generateOTP = function() {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  this.otpExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes
  return otp;
};

// ⭐ NEW: Calculate average rating
userSchema.methods.updateRating = function(newRating) {
  this.totalRatingSum += newRating;
  this.reviewCount += 1;
  this.rating = (this.totalRatingSum / this.reviewCount).toFixed(2);
};

// ⭐ NEW: Get initials for avatar placeholder
userSchema.methods.getInitials = function() {
  return this.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
};

module.exports = mongoose.model('User', userSchema);
