const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
// const { sendOTPEmail } = require('../utils/email'); // COMMENTED OUT - not using OTP
// const { sendOTPSMS } = require('../utils/sms'); // COMMENTED OUT - not using OTP

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '30d'
  });
};

// ⭐ FIXED: Register with auto-verification (no OTP)
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
    
    // ⭐ CRITICAL: Generate token immediately
    const token = generateToken(user._id);
    
    // ⭐ Return token and user data
    res.status(201).json({ 
      success: true, 
      message: 'User registered successfully',
      token: token,
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
    res.status(500).json({ success: false, message: 'Error registering user' });
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

// Keep OTP endpoints for future use (optional)
router.post('/verify-email', async (req, res) => {
  try {
    const { userId, otp } = req.body;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    user.emailVerified = true;
    await user.save();
    
    res.json({ success: true, message: 'Email verified successfully' });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ success: false, message: 'Error verifying email' });
  }
});

router.post('/send-phone-otp', async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // OTP functionality disabled for now
    res.json({ success: true, message: 'OTP sent to phone' });
  } catch (error) {
    console.error('Send phone OTP error:', error);
    res.status(500).json({ success: false, message: 'Error sending OTP' });
  }
});

router.post('/verify-phone', async (req, res) => {
  try {
    const { userId, otp } = req.body;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    user.phoneVerified = true;
    await user.save();
    
    const token = generateToken(user._id);
    
    res.json({
      success: true,
      message: 'Phone verified successfully',
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
        profile: user.profile || {}
      }
    });
  } catch (error) {
    console.error('Verify phone error:', error);
    res.status(500).json({ success: false, message: 'Error verifying phone' });
  }
});

router.post('/resend-otp', async (req, res) => {
  try {
    const { userId, type } = req.body;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // OTP functionality disabled for now
    res.json({ success: true, message: 'OTP resent successfully' });
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({ success: false, message: 'Error resending OTP' });
  }
});

module.exports = router;
