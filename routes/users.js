const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const User = require('../models/User');

// Get current user profile
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        credits: user.credits,
        specialization: user.specialization,
        qualifications: user.qualifications,
        rating: user.rating,
        reviewCount: user.reviewCount,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
        profile: user.profile || {},  // ⭐ ADDED: Include profile data
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ success: false, message: 'Error fetching profile' });
  }
});

// Update basic user info
router.put('/me', protect, async (req, res) => {
  try {
    const { name, specialization } = req.body;
    const updateData = {};
    if (name) updateData.name = name;
    if (specialization && req.user.role === 'expert') updateData.specialization = specialization;
    
    const user = await User.findByIdAndUpdate(req.user.id, updateData, { new: true, runValidators: true });
    
    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        credits: user.credits,
        specialization: user.specialization,
        profile: user.profile || {}  // ⭐ ADDED: Include profile
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ success: false, message: 'Error updating profile' });
  }
});

// ⭐ NEW: Update user profile (questionnaire data)
router.put('/profile', protect, async (req, res) => {
  try {
    const { profile } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { profile: profile },
      { new: true, runValidators: false }
    ).select('-password');

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        credits: user.credits,
        profile: user.profile || {},
        specialization: user.specialization
      }
    });

  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ 
      success: false,
      message: error.message 
    });
  }
});

// Add qualification (experts only)
router.post('/qualifications', protect, authorize('expert'), async (req, res) => {
  try {
    const { title, description } = req.body;
    const user = await User.findById(req.user.id);
    user.qualifications.push({ title, description });
    await user.save();
    res.json({ success: true, qualifications: user.qualifications });
  } catch (error) {
    console.error('Add qualification error:', error);
    res.status(500).json({ success: false, message: 'Error adding qualification' });
  }
});

// Get expert public profile
router.get('/expert/:id', async (req, res) => {
  try {
    const expert = await User.findById(req.params.id).select('name specialization qualifications rating reviewCount createdAt');
    if (!expert || expert.role !== 'expert') {
      return res.status(404).json({ success: false, message: 'Expert not found' });
    }
    res.json({ success: true, expert });
  } catch (error) {
    console.error('Get expert error:', error);
    res.status(500).json({ success: false, message: 'Error fetching expert' });
  }
});

module.exports = router;
