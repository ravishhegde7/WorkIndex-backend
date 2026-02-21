const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const Approach = require('../models/Approach');
const Request = require('../models/Request');
const User = require('../models/User');

// ─── CREATE NEW APPROACH (EXPERT ONLY) ───
router.post('/', protect, authorize('expert'), async (req, res) => {
  try {
    const { request: requestId, message } = req.body;
    
    console.log('💼 Expert approaching request:');
    console.log('  Expert:', req.user.id);
    console.log('  Request:', requestId);
    console.log('  Message:', message);
    
    const request = await Request.findById(requestId);
    
    if (!request) {
      console.log('❌ Request not found:', requestId);
      return res.status(404).json({ 
        success: false, 
        message: 'Request not found' 
      });
    }
    
    const approachCount = await Approach.countDocuments({ request: requestId });
    
    if (approachCount >= 5) {
      console.log('❌ Request already has maximum approaches:', approachCount);
      return res.status(400).json({ 
        success: false, 
        message: 'This request has already received the maximum number of approaches (5)' 
      });
    }
    
    const existingApproach = await Approach.findOne({
      request: requestId,
      expert: req.user.id
    });
    
    if (existingApproach) {
      return res.status(400).json({ 
        success: false, 
        message: 'You have already approached this request' 
      });
    }
    
    const expert = await User.findById(req.user.id);
    const creditsRequired = request.credits || 20;
    
    if (!expert.credits || expert.credits < creditsRequired) {
      return res.status(400).json({ 
        success: false, 
        message: 'Insufficient credits. Please purchase credits to approach this request.' 
      });
    }
    
    const balanceBefore = expert.credits;
    expert.credits -= creditsRequired;
    await expert.save();
    
    console.log('  💰 Credits deducted. New balance:', expert.credits);
    
    const approach = await Approach.create({
      request: requestId,
      expert: req.user.id,
      client: request.client,
      message: message || 'I am interested in helping with your request.',
      creditsSpent: creditsRequired,
      status: 'pending',
      contactUnlocked: true
    });
    
    // ✅ Log credit transaction
    try {
      const CreditTransaction = require('../models/CreditTransaction');
      const clientUser = await User.findById(request.client).select('name location');
      await CreditTransaction.log({
        user:          req.user.id,
        type:          'spent',
        amount:        -creditsRequired,
        balanceBefore,
        balanceAfter:  expert.credits,
        description:   `Approached: "${request.title}"`,
        relatedRequest:  request._id,
        relatedApproach: approach._id,
        relatedClient:   request.client,
        initiatedBy:   'user',
        approachDetails: {
          requestTitle:       request.title,
          requestService:     request.service || '',
          clientName:         clientUser?.name || '',
          clientCity:         clientUser?.location?.city || '',
          creditsSpent:       creditsRequired,
          approachStatus:     'pending',
          clientHasResponded: false,
          clientResponseType: null
        }
      });
    } catch (logErr) {
      console.log('CreditTransaction log skipped:', logErr.message);
    }
    
    request.approachCount = (request.approachCount || 0) + 1;
    request.responseCount = (request.responseCount || 0) + 1;
    await request.save();
    
    console.log('✅ Approach created successfully!');
    
    res.status(201).json({ 
      success: true, 
      approach,
      remainingCredits: expert.credits
    });
    
  } catch (error) {
    console.error('❌ Create approach error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Error creating approach' 
    });
  }
});

// ─── GET ALL APPROACHES ───
router.get('/', protect, async (req, res) => {
  try {
    let query = {};
    
    if (req.user.role === 'expert') {
      query.expert = req.user.id;
    } else if (req.user.role === 'client') {
      query.client = req.user.id;
    }
    
    const approaches = await Approach.find(query)
      .populate('request', 'title service description budget location')
      .populate('expert', 'name specialization rating reviewCount profilePhoto')
      .populate('client', 'name email phone')
      .sort('-createdAt')
      .limit(100);
    
    res.json({ 
      success: true, 
      count: approaches.length, 
      approaches 
    });
    
  } catch (error) {
    console.error('❌ Get approaches error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching approaches' 
    });
  }
});

// ─── GET SINGLE APPROACH ───
router.get('/:id', protect, async (req, res) => {
  try {
    const approach = await Approach.findById(req.params.id)
      .populate('request', 'title service description budget location answers')
      .populate('expert', 'name specialization rating reviewCount profilePhoto email phone')
      .populate('client', 'name email phone');
    
    if (!approach) {
      return res.status(404).json({ 
        success: false, 
        message: 'Approach not found' 
      });
    }
    
    if (approach.expert._id.toString() !== req.user.id && approach.client._id.toString() !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized' 
      });
    }
    
    res.json({ success: true, approach });
    
  } catch (error) {
    console.error('❌ Get approach error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching approach' 
    });
  }
});

// ─── UPDATE APPROACH STATUS (CLIENT ONLY) ───
router.put('/:id/status', protect, authorize('client'), async (req, res) => {
  try {
    const { status } = req.body;
    
    const approach = await Approach.findById(req.params.id);
    
    if (!approach) {
      return res.status(404).json({ 
        success: false, 
        message: 'Approach not found' 
      });
    }
    
    if (approach.client.toString() !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized' 
      });
    }
    
    approach.status = status;
    
    if (status === 'accepted') {
      approach.acceptedAt = new Date();
      
      // ✅ Track client response — accepted = client responded
      if (!approach.clientRespondedAt) {
        approach.clientRespondedAt  = new Date();
        approach.clientResponseType = 'contact_viewed';
      }
      
      const request = await Request.findById(approach.request);
      if (request) {
        request.acceptedExpert = approach.expert;
        request.status = 'active';
        await request.save();
      }
    }

    if (status === 'rejected') {
      approach.rejectedAt = new Date();

      // ✅ Track client response — rejected = client responded
      if (!approach.clientRespondedAt) {
        approach.clientRespondedAt  = new Date();
        approach.clientResponseType = 'contact_viewed';
      }
    }
    
    await approach.save();
    
    console.log(`✅ Approach ${req.params.id} status updated to ${status}`);
    
    res.json({ success: true, approach });
    
  } catch (error) {
    console.error('❌ Update approach status error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error updating approach status' 
    });
  }
});

// ─── MARK VIEW PROFILE (CLIENT CLICKED VIEW PROFILE) ───
// Called when client clicks "View Profile" on an expert's approach
router.put('/:id/view-profile', protect, authorize('client'), async (req, res) => {
  try {
    const approach = await Approach.findById(req.params.id);

    if (!approach) {
      return res.status(404).json({ success: false, message: 'Approach not found' });
    }

    if (approach.client.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    // Only record first response
    if (!approach.clientRespondedAt) {
      approach.clientRespondedAt  = new Date();
      approach.clientResponseType = 'contact_viewed';
      await approach.save();
      console.log(`✅ Client viewed profile on approach ${approach._id}`);
    }

    res.json({ success: true, approach });

  } catch (error) {
    console.error('❌ View profile track error:', error);
    res.status(500).json({ success: false, message: 'Error tracking view' });
  }
});

// ─── MARK CONTACT SENT (CLIENT CLICKED CONTACT BUTTON) ───
// Called when client clicks "Contact" button to message expert
router.put('/:id/contact-sent', protect, authorize('client'), async (req, res) => {
  try {
    const approach = await Approach.findById(req.params.id);

    if (!approach) {
      return res.status(404).json({ success: false, message: 'Approach not found' });
    }

    if (approach.client.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    // Only record first response
    if (!approach.clientRespondedAt) {
      approach.clientRespondedAt  = new Date();
      approach.clientResponseType = 'contact_sent';
      await approach.save();
      console.log(`✅ Client sent contact on approach ${approach._id}`);
    }

    res.json({ success: true, approach });

  } catch (error) {
    console.error('❌ Contact sent track error:', error);
    res.status(500).json({ success: false, message: 'Error tracking contact' });
  }
});

// ─── MARK SERVICE RECEIVED (CLIENT CLICKED SERVICE RECEIVED) ───
router.put('/:id/service-received', protect, authorize('client'), async (req, res) => {
  try {
    const approach = await Approach.findById(req.params.id);

    if (!approach) {
      return res.status(404).json({ success: false, message: 'Approach not found' });
    }

    if (approach.client.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    approach.isWorkCompleted    = true;
    approach.workCompletedAt    = new Date();
    approach.clientRespondedAt  = approach.clientRespondedAt || new Date();
    approach.clientResponseType = approach.clientResponseType || 'service_marked';
    await approach.save();

    console.log(`✅ Service marked as received on approach ${approach._id}`);

    res.json({ success: true, approach });

  } catch (error) {
    console.error('❌ Service received error:', error);
    res.status(500).json({ success: false, message: 'Error marking service received' });
  }
});

// ─── DELETE APPROACH ───
router.delete('/:id', protect, async (req, res) => {
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
    
    await approach.deleteOne();
    
    res.json({ 
      success: true, 
      message: 'Approach deleted' 
    });
    
  } catch (error) {
    console.error('❌ Delete approach error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error deleting approach' 
    });
  }
});

module.exports = router;
