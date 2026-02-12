const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '30d'
  });
};

// ⭐ UPDATED: Register with auto-verification (no OTP)
router.post('/register', [
  body('name').trim().notEmpty(),
  body('email').isEmail().normalizeEmail(),
  body('phone').matches(/^[0-9]{10}$/),
  body('password').isLength({ min: 6 }),
  body('role').isIn(['client', 'expert'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    
    const { name, email, phone, password, role } = req.body;
    
    const existingUser = await User.findOne({ $or: [{ email }, { phone }] });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }
    
    // ⭐ Create user with auto-verification
    const user = await User.create({ 
      name, 
      email, 
      phone, 
      password, 
      role,
      emailVerified: true,  // Auto-verify
      phoneVerified: true   // Auto-verify
    });
    
    // ⭐ CRITICAL FIX: Generate token immediately
    const token = generateToken(user._id);
    
    res.status(201).json({ 
      success: true, 
      message: 'User registered successfully',
      token: token,              // ← Frontend needs this!
      user: {
        _id: user._id,
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        credits: user.credits,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
        profile: user.profile || {}
      },
      userId: user._id
    });
    
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Error registering user' 
    });
  }
});

router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    
    const { email, password } = req.body;
    
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    user.lastLogin = Date.now();
    await user.save();
    
    const token = generateToken(user._id);
    
    res.json({
      success: true,
      token,
      user: {
        _id: user._id,
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        credits: user.credits,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
        profile: user.profile || {},
        profilePhoto: user.profilePhoto,
        location: user.location,
        preferences: user.preferences
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Error logging in' });
  }
});

// Kept for backward compatibility (not used)
router.post('/verify-email', async (req, res) => {
  res.json({ success: true, message: 'Email verified successfully' });
});

router.post('/send-phone-otp', async (req, res) => {
  res.json({ success: true, message: 'OTP sent to phone' });
});

router.post('/verify-phone', async (req, res) => {
  res.json({ success: true, message: 'Phone verified successfully' });
});

router.post('/resend-otp', async (req, res) => {
  res.json({ success: true, message: 'OTP resent successfully' });
});

module.exports = router;
