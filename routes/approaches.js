// routes/approaches.js - Complete file

const express = require('express');
const router = express.Router();
const Approach = require('../models/Approach');
const User = require('../models/User');
const Request = require('../models/Request');
const { authenticate } = require('../middleware/auth');

// Create new approach
router.post('/', authenticate, async (req, res) => {
  try {
    const { requestId, message } = req.body;
    const expertId = req.user.userId;

    // Validate
    if (!requestId || !message) {
      return res.status(400).json({ 
        message: 'Request ID and message are required' 
      });
    }

    // Get request
    const request = await Request.findById(requestId);
    if (!request) {
      return res.status(404).json({ 
        message: 'Request not found' 
      });
    }

    // Check if already approached
    const existingApproach = await Approach.findOne({ 
      expertId, 
      requestId 
    });
    
    if (existingApproach) {
      return res.status(400).json({ 
        message: 'You have already approached this request' 
      });
    }

    // Get expert and check credits
    const expert = await User.findById(expertId);
    const creditsNeeded = request.credits || 20;

    if (expert.credits < creditsNeeded) {
      return res.status(400).json({ 
        message: 'Insufficient credits. You need ' + creditsNeeded + ' credits.' 
      });
    }

    // Deduct credits
    expert.credits -= creditsNeeded;
    await expert.save();

    // Create approach
    const approach = await Approach.create({
      expertId,
      requestId,
      message,
      status: 'pending',
      creditsSpent: creditsNeeded
    });

    res.status(201).json({
      success: true,
      message: 'Approach sent successfully',
      approachId: approach._id,
      creditsRemaining: expert.credits
    });

  } catch (error) {
    console.error('Error creating approach:', error);
    res.status(500).json({ 
      message: error.message 
    });
  }
});

// Get expert's approaches
router.get('/my-approaches', authenticate, async (req, res) => {
  try {
    const approaches = await Approach.find({ 
      expertId: req.user.userId 
    }).populate('requestId', 'title description service')
      .sort('-createdAt');

    res.json({
      success: true,
      approaches: approaches.map(a => ({
        _id: a._id,
        requestId: a.requestId?._id,
        requestTitle: a.requestId?.title || 'Request',
        message: a.message,
        status: a.status,
        creditsSpent: a.creditsSpent,
        createdAt: a.createdAt
      }))
    });

  } catch (error) {
    console.error('Error fetching approaches:', error);
    res.status(500).json({ 
      message: error.message 
    });
  }
});

module.exports = router;
