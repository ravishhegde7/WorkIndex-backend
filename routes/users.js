const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const mongoose = require('mongoose');
const { protect, authorize } = require('../middleware/auth');
const User = require('../models/User');
const Rating = require('../models/Rating');

// ✅ FIXED: Use memory storage instead of disk storage
const storage = multer.memoryStorage();

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
    
    if (name) updateData.name = name;
    if (bio) updateData.bio = bio;
    
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

// ✅ FIXED: Upload profile photo with base64 storage
router.post('/profile-photo', protect, upload.single('profilePhoto'), async (req, res) => {
  try {
    if (!req.file) {
      console.log('❌ No file in request');
      return res.status(400).json({ 
        success: false, 
        message: 'No file uploaded' 
      });
    }
    
    console.log('📸 Uploading profile photo:');
    console.log('  User:', req.user.id);
    console.log('  Filename:', req.file.originalname);
    console.log('  Size:', req.file.size);
    
    // Convert to base64
    const base64Image = req.file.buffer.toString('base64');
    const dataURI = `data:${req.file.mimetype};base64,${base64Image}`;
    
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { profilePhoto: dataURI },
      { new: true }
    );
    
    console.log('✅ Profile photo uploaded successfully');
    
    res.json({
      success: true,
      message: 'Profile photo uploaded successfully',
      profilePhoto: dataURI
    });
  } catch (error) {
    console.error('❌ Upload photo error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error uploading photo' 
    });
  }
});

// Update user preferences
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
// POST /api/users/tickets - Create support ticket
router.post('/tickets', protect, async (req, res) => {
  try {
    var SupportTicket = mongoose.models['SupportTicket'];
    if (!SupportTicket) {
      try { SupportTicket = require('../models/SupportTicket'); } catch(e) {}
    }
    if (!SupportTicket) {
      return res.status(503).json({ success: false, message: 'Ticket system not available' });
    }

    var { subject, description, priority, issueType } = req.body;
    if (!subject) return res.status(400).json({ success: false, message: 'Subject required' });

    var ticketData = {
      user: req.user._id,
      issueType: issueType || subject,
      subject: subject,
      description: description || subject,
      priority: priority || 'medium',
      status: 'open'
    };

    if (req.user.role === 'expert') ticketData.expert = req.user._id;

    var ticket = await SupportTicket.create(ticketData);
    res.status(201).json({ success: true, message: 'Ticket created', ticket });
  } catch (err) {
    console.error('Create ticket error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/users/tickets - Get user's own tickets
router.get('/tickets', protect, async (req, res) => {
  try {
    var SupportTicket = mongoose.models['SupportTicket'];
    if (!SupportTicket) {
      try { SupportTicket = require('../models/SupportTicket'); } catch(e) {}
    }
    if (!SupportTicket) return res.json({ success: true, tickets: [] });

    var tickets = await SupportTicket.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(20);
    res.json({ success: true, tickets });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Add to portfolio (for experts)
router.post('/portfolio', protect, authorize('expert'), upload.single('image'), async (req, res) => {
  try {
    const { title, description, completedAt } = req.body;
    
    const portfolioItem = {
      title,
      description,
      completedAt: completedAt || Date.now()
    };
    
    if (req.file) {
      const base64Image = req.file.buffer.toString('base64');
      portfolioItem.image = `data:${req.file.mimetype};base64,${base64Image}`;
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

// Update profile data (for expert questionnaire)
router.put('/profile', protect, async (req, res) => {
  try {
    const { profile } = req.body;

    // Build location update from all possible sources
    const locationUpdate = {};

    // Expert: saves city, state, pincode directly in profile
    if (profile.city)    locationUpdate['location.city']    = profile.city;
    if (profile.state)   locationUpdate['location.state']   = profile.state;
    if (profile.pincode) locationUpdate['location.pincode'] = profile.pincode;

    // Client (in-person): saves inside profile.fullAddress
    if (profile.fullAddress) {
      if (profile.fullAddress.city)    locationUpdate['location.city']    = profile.fullAddress.city;
      if (profile.fullAddress.state)   locationUpdate['location.state']   = profile.fullAddress.state;
      if (profile.fullAddress.pincode) locationUpdate['location.pincode'] = profile.fullAddress.pincode;
    }

    // Client (online): saves inside profile.clientLocation
    if (profile.clientLocation) {
      if (profile.clientLocation.city)    locationUpdate['location.city']    = profile.clientLocation.city;
      if (profile.clientLocation.state)   locationUpdate['location.state']   = profile.clientLocation.state;
      if (profile.clientLocation.pincode) locationUpdate['location.pincode'] = profile.clientLocation.pincode;
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { 
        profile: profile,
        ...locationUpdate
      },
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

// Add qualification
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

// Get all experts
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
    
    const query = { role: 'expert' };  // ← removed isActive filter

// Service filter
if (service && service !== 'all') {
  query.$or = [
    { servicesOffered: service },
    { 'profile.servicesOffered': service }
  ];
}

// Search by name, city or pincode
if (location) {
  const searchRegex = new RegExp(location, 'i');
  const locationConditions = [
    { name: searchRegex },
    { 'location.city': searchRegex },
    { 'location.pincode': searchRegex },
    { 'profile.city': searchRegex },
    { 'profile.pincode': searchRegex }
  ];

  // If service filter also exists, combine with AND logic
  if (query.$or) {
    const serviceConditions = query.$or;
    delete query.$or;
    query.$and = [
      { $or: serviceConditions },
      { $or: locationConditions }
    ];
  } else {
    query.$or = locationConditions;
  }
}

if (minRating) {
  query.rating = { $gte: parseFloat(minRating) };
}
    
    let sort = '-rating';
    if (sortBy === 'newest') sort = '-createdAt';
    if (sortBy === 'reviews') sort = '-reviewCount';
    if (sortBy === 'name') sort = 'name';
    
    const skip = (page - 1) * limit;
    
    const experts = await User.find(query)
      .select('name profilePhoto specialization bio location rating reviewCount servicesOffered certifications companyName yearsOfExperience createdAt profile')
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

// Get single expert public profile
router.get('/expert/:id', async (req, res) => {
  try {
    // ✅ Filter by role directly in DB query instead of checking after fetch
    const expert = await User.findOne({ 
      _id: req.params.id, 
      role: 'expert'
    })
    .select('name profilePhoto specialization qualifications rating reviewCount bio portfolio location companyName servicesOffered certifications yearsOfExperience createdAt profile')
    .lean();
    
    if (!expert) {
      return res.status(404).json({ 
        success: false, 
        message: 'Expert not found' 
      });
    }
    
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
