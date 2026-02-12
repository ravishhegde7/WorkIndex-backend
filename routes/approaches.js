const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const Approach = require('../models/Approach');
const Request = require('../models/Request');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

// ⭐ Create new approach
router.post('/', protect, authorize('expert'), async (req, res) => {
  try {
    const { requestId, message, quote } = req.body;
    
    const request = await Request.findById(requestId).populate('client');
    if (!request) {
      return res.status(404).json({ 
        success: false, 
        message: 'Request not found' 
      });
    }
    
    // Check if already approached
    const existingApproach = await Approach.findOne({ 
      request: requestId, 
      expert: req.user.id 
    });
    
    if (existingApproach) {
      return res.status(400).json({ 
        success: false, 
        message: 'Already approached this request' 
      });
    }
    
    const expert = await User.findById(req.user.id);
    
    if (expert.credits < request.credits) {
      return res.status(400).json({ 
        success: false, 
        message: 'Insufficient credits', 
        required: request.credits, 
        available: expert.credits 
      });
    }
    
    // Deduct credits
    expert.credits -= request.credits;
    await expert.save();
    
    // Create approach
    const approach = await Approach.create({
      request: requestId,
      expert: req.user.id,
      message,
      quote,
      creditsSpent: request.credits,
      unlocked: true,
      clientEmail: request.client.email,
      clientPhone: request.client.phone
    });
    
    // Create transaction
    await Transaction.create({
      user: req.user.id,
      type: 'approach_sent',
      amount: 0,
      credits: -request.credits,
      relatedApproach: approach._id,
      paymentStatus: 'success',
      description: `Unlocked request: ${request.title}`
    });
    
    // Update request
    request.responseCount += 1;
    if (request.status === 'pending') request.status = 'active';
    await request.save();
    
    await approach.populate('expert', 'name specialization rating reviewCount profilePhoto');
    
    res.status(201).json({ 
      success: true, 
      approach, 
      remainingCredits: expert.credits 
    });
    
  } catch (error) {
    console.error('Create approach error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error creating approach' 
    });
  }
});

// ⭐ Get my approaches (for experts)
router.get('/my-approaches', protect, authorize('expert'), async (req, res) => {
  try {
    const { status } = req.query;
    
    const query = { expert: req.user.id };
    if (status) query.status = status;
    
    const approaches = await Approach.find(query)
      .populate('request', 'title service location budget timeline status')
      .sort('-createdAt')
      .lean();
    
    res.json({ 
      success: true, 
      count: approaches.length, 
      approaches: approaches.map(a => ({
        _id: a._id,
        requestId: a.request?._id,
        requestTitle: a.request?.title || 'Request',
        service: a.request?.service,
        message: a.message,
        quote: a.quote,
        status: a.status,
        creditsSpent: a.creditsSpent,
        documentAccessGranted: a.documentAccessGranted,
        isWorkCompleted: a.isWorkCompleted,
        hasBeenRated: a.hasBeenRated,
        createdAt: a.createdAt
      }))
    });
    
  } catch (error) {
    console.error('Get approaches error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching approaches' 
    });
  }
});

// Get all approaches (kept for backward compatibility)
router.get('/', protect, authorize('expert'), async (req, res) => {
  try {
    const approaches = await Approach.find({ expert: req.user.id })
      .populate('request', 'title service location budget timeline status')
      .sort('-createdAt');
    
    res.json({ 
      success: true, 
      count: approaches.length, 
      approaches 
    });
    
  } catch (error) {
    console.error('Get approaches error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching approaches' 
    });
  }
});

// ⭐ Get single approach
router.get('/:id', protect, async (req, res) => {
  try {
    const approach = await Approach.findById(req.params.id)
      .populate('request')
      .populate('expert', 'name specialization rating reviewCount profilePhoto bio');
    
    if (!approach) {
      return res.status(404).json({ 
        success: false, 
        message: 'Approach not found' 
      });
    }
    
    // Check authorization
    const isExpert = approach.expert._id.toString() === req.user.id;
    const isClient = approach.request.client.toString() === req.user.id;
    
    if (!isExpert && !isClient) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized' 
      });
    }
    
    res.json({ 
      success: true, 
      approach 
    });
    
  } catch (error) {
    console.error('Get approach error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching approach' 
    });
  }
});

// ⭐ Update approach status (client accepts/rejects)
router.put('/:id/status', protect, authorize('client'), async (req, res) => {
  try {
    const { status } = req.body;
    
    const approach = await Approach.findById(req.params.id)
      .populate('request');
    
    if (!approach) {
      return res.status(404).json({ 
        success: false, 
        message: 'Approach not found' 
      });
    }
    
    if (approach.request.client.toString() !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized' 
      });
    }
    
    approach.status = status;
    approach.respondedAt = Date.now();
    
    // If accepted, update request
    if (status === 'accepted') {
      approach.request.acceptedExpert = approach.expert;
      approach.request.status = 'active';
      await approach.request.save();
    }
    
    await approach.save();
    
    res.json({ 
      success: true, 
      approach 
    });
    
  } catch (error) {
    console.error('Update approach status error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error updating approach status' 
    });
  }
});

// ⭐ NEW: Request document access
router.post('/:id/request-document-access', protect, authorize('expert'), async (req, res) => {
  try {
    const approach = await Approach.findById(req.params.id);
    
    if (!approach) {
      return res.status(404).json({ 
        success: false, 
        message: 'Approach not found' 
      });
    }
    
    if (approach.expert.toString() !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized' 
      });
    }
    
    if (approach.documentAccessRequested) {
      return res.status(400).json({ 
        success: false, 
        message: 'Access already requested' 
      });
    }
    
    approach.documentAccessRequested = true;
    approach.documentAccessRequestedAt = Date.now();
    await approach.save();
    
    res.json({ 
      success: true, 
      message: 'Document access requested',
      approach 
    });
    
  } catch (error) {
    console.error('Request document access error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error requesting document access' 
    });
  }
});

// ⭐ NEW: Grant document access (client approves)
router.post('/:id/grant-document-access', protect, authorize('client'), async (req, res) => {
  try {
    const approach = await Approach.findById(req.params.id)
      .populate('request');
    
    if (!approach) {
      return res.status(404).json({ 
        success: false, 
        message: 'Approach not found' 
      });
    }
    
    if (approach.request.client.toString() !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized' 
      });
    }
    
    approach.documentAccessGranted = true;
    approach.documentAccessGrantedAt = Date.now();
    await approach.save();
    
    res.json({ 
      success: true, 
      message: 'Document access granted',
      approach 
    });
    
  } catch (error) {
    console.error('Grant document access error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error granting document access' 
    });
  }
});

// ⭐ NEW: Mark work as completed
router.post('/:id/complete', protect, authorize('expert'), async (req, res) => {
  try {
    const approach = await Approach.findById(req.params.id);
    
    if (!approach) {
      return res.status(404).json({ 
        success: false, 
        message: 'Approach not found' 
      });
    }
    
    if (approach.expert.toString() !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized' 
      });
    }
    
    approach.isWorkCompleted = true;
    approach.completedAt = Date.now();
    await approach.save();
    
    res.json({ 
      success: true, 
      message: 'Work marked as completed',
      approach 
    });
    
  } catch (error) {
    console.error('Complete work error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error marking work as completed' 
    });
  }
});

module.exports = router;
