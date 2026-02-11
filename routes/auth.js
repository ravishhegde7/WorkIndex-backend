const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { sendOTPEmail } = require('../utils/email');
const { sendOTPSMS } = require('../utils/sms');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '30d'
  });
};

// ⭐ UPDATED: Register with immediate token return
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
    
    // Create user with auto-verification (for smooth signup flow)
    const user = await User.create({ 
      name, 
      email, 
      phone, 
      password, 
      role,
      emailVerified: true,  // ⭐ Auto-verify for immediate access
      phoneVerified: true   // ⭐ Auto-verify for immediate access
    });
    
    // ⭐ CRITICAL FIX: Generate token immediately on registration
    const token = generateToken(user._id);
    
    // Send OTPs in background (optional - for future verification if needed)
    try {
      const emailOTP = user.generateOTP();
      user.emailOTP = emailOTP;
      await user.save();
      await sendOTPEmail(email, emailOTP);
    } catch (otpError) {
      console.log('OTP send failed (non-critical):', otpError.message);
    }
    
    // ⭐ CRITICAL: Return token and user data immediately
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
        profile: user.profile || {}
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Error logging in' });
  }
});

router.post('/verify-email', async (req, res) => {
  try {
    const { userId, otp } = req.body;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    if (user.emailOTP !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }
    
    if (user.otpExpiry < Date.now()) {
      return res.status(400).json({ success: false, message: 'OTP expired' });
    }
    
    user.emailVerified = true;
    user.emailOTP = undefined;
    user.otpExpiry = undefined;
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
    
    const phoneOTP = user.generateOTP();
    user.phoneOTP = phoneOTP;
    await user.save();
    
    await sendOTPSMS(user.phone, phoneOTP);
    
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
    
    if (user.phoneOTP !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }
    
    if (user.otpExpiry < Date.now()) {
      return res.status(400).json({ success: false, message: 'OTP expired' });
    }
    
    user.phoneVerified = true;
    user.phoneOTP = undefined;
    user.otpExpiry = undefined;
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
    
    const otp = user.generateOTP();
    
    if (type === 'email') {
      user.emailOTP = otp;
      await user.save();
      await sendOTPEmail(user.email, otp);
    } else if (type === 'phone') {
      user.phoneOTP = otp;
      await user.save();
      await sendOTPSMS(user.phone, otp);
    }
    
    res.json({ success: true, message: 'OTP resent successfully' });
    
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({ success: false, message: 'Error resending OTP' });
  }
});

module.exports = router;
