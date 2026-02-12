const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { protect, authorize } = require('../middleware/auth');
const User = require('../models/User');
const Rating = require('../models/Rating');

// ⭐ Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/profiles/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

// Get current user profile
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json({
      success: true,
      user: {
        _id: user._id,
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        credits: user.credits,
        profilePhoto: user.profilePhoto,
        profile: user.profile,
        specialization: user.specialization,
        qualifications: user.qualifications,
        location: user.location,
        bio: user.bio,
        portfolio: user.portfolio,
        companyName: user.companyName,
        companySize: user.companySize,
        hasWebsite: user.hasWebsite,
        websiteUrl: user.websiteUrl,
        yearsOfExperience: user.yearsOfExperience,
        servicesOffered: user.servicesOffered,
        certifications: user.certifications,
        rating: user.rating,
        reviewCount: user.reviewCount,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
        preferences: user.preferences,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ success: false, message: 'Error fetching profile' });
  }
});

// Update user profile
router.put('/me', protect, async (req, res) => {
  try {
    const { 
      name, 
      specialization, 
      bio,
      companyName,
      companySize,
      hasWebsite,
      websiteUrl,
      yearsOfExperience,
      servicesOffered,
      certifications,
      location
    } = req.body;
    
    const updateData = {};
    
    // Basic fields
    if (name) updateData.name = name;
    if (bio) updateData.bio = bio;
    
    // Expert-specific fields
    if (req.user.role === 'expert') {
      if (specialization) updateData.specialization = specialization;
      if (companyName) updateData.companyName = companyName;
      if (companySize) updateData.companySize = companySize;
      if (hasWebsite !== undefined) updateData.hasWebsite = hasWebsite;
      if (websiteUrl) updateData.websiteUrl = websiteUrl;
      if (yearsOfExperience) updateData.yearsOfExperience = yearsOfExperience;
      if (servicesOffered) updateData.servicesOffered = servicesOffered;
      if (certifications) updateData.certifications = certifications;
    }
    
    // Location (for both client and expert)
    if (location) updateData.location = location;
    
    const user = await User.findByIdAndUpdate(
      req.user.id, 
      updateData, 
      { new: true, runValidators: true }
    );
    
    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        _id: user._id,
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        credits: user.credits,
        profilePhoto: user.profilePhoto,
        specialization: user.specialization,
        bio: user.bio,
        location: user.location,
        companyName: user.companyName,
        servicesOffered: user.servicesOffered,
        certifications: user.certifications
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ success: false, message: 'Error updating profile' });
  }
});

// ⭐ NEW: Upload profile photo
router.post('/profile-photo', protect, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No file uploaded' 
      });
    }
    
    const photoUrl = '/uploads/profiles/' + req.file.filename;
    
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { profilePhoto: photoUrl },
      { new: true }
    );
    
    res.json({
      success: true,
      message: 'Profile photo uploaded successfully',
      profilePhoto: photoUrl
    });
  } catch (error) {
    console.error('Upload photo error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error uploading photo' 
    });
  }
});

// ⭐ NEW: Update user preferences (dark mode, notifications)
router.put('/preferences', protect, async (req, res) => {
  try {
    const { darkMode, notifications } = req.body;
    
    const updateData = {};
    if (darkMode !== undefined) updateData['preferences.darkMode'] = darkMode;
    if (notifications) updateData['preferences.notifications'] = notifications;
    
    const user = await User.findByIdAndUpdate(
      req.user.id,
      updateData,
      { new: true }
    );
    
    res.json({
      success: true,
      message: 'Preferences updated',
      preferences: user.preferences
    });
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error updating preferences' 
    });
  }
});

// ⭐ UPDATED: Add to portfolio (for experts)
router.post('/portfolio', protect, authorize('expert'), upload.single('image'), async (req, res) => {
  try {
    const { title, description, completedAt } = req.body;
    
    const portfolioItem = {
      title,
      description,
      completedAt: completedAt || Date.now()
    };
    
    if (req.file) {
      portfolioItem.image = '/uploads/profiles/' + req.file.filename;
    }
    
    const user = await User.findById(req.user.id);
    if (!user.portfolio) user.portfolio = [];
    user.portfolio.push(portfolioItem);
    await user.save();
    
    res.json({ 
      success: true, 
      message: 'Portfolio item added',
      portfolio: user.portfolio 
    });
  } catch (error) {
    console.error('Add portfolio error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error adding portfolio item' 
    });
  }
});

// ⭐ UPDATED: Update profile data (for expert questionnaire)
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
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        credits: user.credits,
        profile: user.profile
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

// Add qualification (existing)
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

// ⭐ NEW: Get all experts (for "Find Professionals" page)
router.get('/experts', async (req, res) => {
  try {
    const { 
      service, 
      location, 
      minRating, 
      sortBy,
      page = 1,
      limit = 20
    } = req.query;
    
    const query = { role: 'expert', isActive: true };
    
    // Filter by service
    if (service && service !== 'all') {
      query.servicesOffered = service;
    }
    
    // Filter by location
    if (location) {
      query['location.city'] = new RegExp(location, 'i');
    }
    
    // Filter by minimum rating
    if (minRating) {
      query.rating = { $gte: parseFloat(minRating) };
    }
    
    // Sorting
    let sort = '-rating'; // Default: highest rated first
    if (sortBy === 'newest') sort = '-createdAt';
    if (sortBy === 'reviews') sort = '-reviewCount';
    if (sortBy === 'name') sort = 'name';
    
    const skip = (page - 1) * limit;
    
    const experts = await User.find(query)
      .select('name profilePhoto specialization bio location rating reviewCount servicesOffered certifications companyName yearsOfExperience createdAt')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    const total = await User.countDocuments(query);
    
    res.json({
      success: true,
      count: experts.length,
      total: total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      experts
    });
  } catch (error) {
    console.error('Get experts error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching experts' 
    });
  }
});

// ⭐ NEW: Get nearby experts (by location)
router.get('/experts/nearby', async (req, res) => {
  try {
    const { latitude, longitude, maxDistance = 50 } = req.query; // maxDistance in km
    
    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }
    
    // Note: For production, you'd use MongoDB geospatial queries
    // This is a simplified version
    const experts = await User.find({ 
      role: 'expert', 
      isActive: true,
      'location.coordinates.latitude': { $exists: true }
    })
    .select('name profilePhoto specialization bio location rating reviewCount servicesOffered')
    .limit(20)
    .lean();
    
    res.json({
      success: true,
      count: experts.length,
      experts
    });
  } catch (error) {
    console.error('Get nearby experts error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching nearby experts' 
    });
  }
});

// Get single expert public profile
router.get('/expert/:id', async (req, res) => {
  try {
    const expert = await User.findById(req.params.id)
      .select('name profilePhoto specialization qualifications rating reviewCount bio portfolio location companyName servicesOffered certifications yearsOfExperience createdAt');
    
    if (!expert || expert.role !== 'expert') {
      return res.status(404).json({ 
        success: false, 
        message: 'Expert not found' 
      });
    }
    
    // ⭐ Get ratings for this expert
    const ratings = await Rating.find({ 
      expert: req.params.id, 
      isPublic: true,
      isFlagged: false
    })
    .populate('client', 'name profilePhoto')
    .sort('-createdAt')
    .limit(10)
    .lean();
    
    res.json({ 
      success: true, 
      expert,
      ratings
    });
  } catch (error) {
    console.error('Get expert error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching expert' 
    });
  }
});

module.exports = router;
