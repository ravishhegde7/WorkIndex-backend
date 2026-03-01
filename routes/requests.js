const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const Request = require('../models/Request');
const Approach = require('../models/Approach');

const calculateCredits = (service, answers) => {
  const base = { itr: 15, gst: 20, accounting: 25, audit: 30, photography: 18, development: 35 };
  let credits = base[service] || 20;
  
  if (service === 'itr' && answers) {
    if (answers.itrAnnualIncome === 'above20') credits = 25;
    if (answers.itrIncomeSources && answers.itrIncomeSources.includes('business')) credits += 5;
  }
  
  if (service === 'gst' && answers) {
    if (answers.gstTurnover === 'above50') credits = 30;
  }
  
  if (service === 'accounting' && answers) {
    if (answers.accountingTransactions === 'above2000') credits = 35;
  }
  
  return credits;
};

// ─── GET AVAILABLE REQUESTS FOR EXPERTS (NOT YET APPROACHED) ───
router.get('/available', protect, authorize('expert'), async (req, res) => {
  try {
    const myApproaches = await Approach.find({ 
      expert: req.user.id 
    }).select('request');
    
    const approachedRequestIds = myApproaches.map(a => a.request.toString());

    const requests = await Request.find({
  _id: { $nin: approachedRequestIds },
  status: { $in: ['pending', 'active'] }
})
.sort('-createdAt')
.limit(50)
.populate('client', 'name')
.lean();

    // ✅ NEW: Get approach counts for all requests
    const requestIds = requests.map(r => r._id);
    
    const approachCounts = await Approach.aggregate([
      { $match: { request: { $in: requestIds } } },
      { $group: { _id: '$request', count: { $sum: 1 } } }
    ]);
    
    // Create a map for quick lookup
    const countMap = {};
    approachCounts.forEach(item => {
      countMap[item._id.toString()] = item.count;
    });
    
    console.log('📊 Approach counts:', countMap);

    // ✅ NEW: Add approach counts to each request and filter out full ones
    const requestsWithCounts = requests.map(r => ({
      _id: r._id,
      title: r.title,
      description: r.description,
      service: r.service,
      client: r.client,
      timeline: r.timeline,
      location: r.location,
      budget: r.budget,
      credits: r.credits || 20,
      answers: r.answers || {},
      createdAt: r.createdAt,
      status: r.status,
      viewCount: r.viewCount || 0,
      // ✅ NEW: Approach counter fields
      currentApproaches: countMap[r._id.toString()] || 0,
      maxApproaches: 5,
      isFull: (countMap[r._id.toString()] || 0) >= 5
    }));
    
    // ✅ NEW: Filter out requests that already have 5 approaches
    const availableRequests = requestsWithCounts.filter(r => !r.isFull);

    console.log(`✅ Found ${availableRequests.length} available requests for expert ${req.user.id}`);
    console.log(`   (Filtered out ${requestsWithCounts.length - availableRequests.length} full requests)`);

    res.json({ 
      success: true, 
      count: availableRequests.length, 
      requests: availableRequests 
    });

  } catch (error) {
    console.error('❌ Get available requests error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching available requests' 
    });
  }
});

// ─── CREATE NEW REQUEST (CLIENT ONLY) ───
router.post('/', protect, authorize('client'), async (req, res) => {
  try {
    const { service, title, description, answers, timeline, budget, location } = req.body;
    
    console.log('📝 Creating request:');
    console.log('  Client:', req.user.id);
    console.log('  Service:', service);
    console.log('  Title:', title);
    console.log('  Timeline:', timeline);
    console.log('  Budget:', budget);
    console.log('  Location:', location);
    console.log('  Answers keys:', answers ? Object.keys(answers).join(', ') : 'none');
    
    // Validate required fields
    if (!service) {
      console.log('❌ Validation failed: service is required');
      return res.status(400).json({ 
        success: false, 
        message: 'Service is required' 
      });
    }
    
    if (!title) {
      console.log('❌ Validation failed: title is required');
      return res.status(400).json({ 
        success: false, 
        message: 'Title is required' 
      });
    }
    
    if (!description) {
      console.log('❌ Validation failed: description is required');
      return res.status(400).json({ 
        success: false, 
        message: 'Description is required' 
      });
    }
    
    if (!location) {
      console.log('❌ Validation failed: location is required');
      return res.status(400).json({ 
        success: false, 
        message: 'Location is required' 
      });
    }
    
    // Calculate credits
    const credits = calculateCredits(service, answers);
    console.log('  💰 Calculated credits:', credits);
    
    // Create request
    const request = await Request.create({
      client: req.user.id,
      service,
      title,
      description,
      answers: answers || {},
      timeline: timeline || 'flexible',
      budget: budget || '0',
      location,
      credits,
      status: 'pending',
      viewCount: 0,
      responseCount: 0
    });
    
    console.log('✅ Request created successfully!');
    console.log('  ID:', request._id);
    console.log('  Service:', request.service);
    console.log('  Credits:', request.credits);
    
    res.status(201).json({ 
      success: true, 
      request 
    });
    
  } catch (error) {
    console.error('❌ Create request error:', error.message);
    console.error('Error stack:', error.stack);
    
    // More detailed error response
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Error creating request',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ─── GET ALL REQUESTS ───
router.get('/', protect, async (req, res) => {
  try {
    let query = {};
    
    if (req.user.role === 'client') {
      query.client = req.user.id;
    } else {
      query.status = { $in: ['pending', 'active'] };
      if (req.query.service && req.query.service !== 'all') {
        query.service = req.query.service;
      }
    }
    
    const requests = await Request.find(query)
      .sort('-createdAt')
      .limit(50)
      .populate('client', 'name email phone')
      .lean();
    
    console.log(`✅ Found ${requests.length} requests for ${req.user.role} ${req.user.id}`);
    
    res.json({ 
      success: true, 
      count: requests.length, 
      requests 
    });
    
  } catch (error) {
    console.error('❌ Get requests error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching requests' 
    });
  }
});

// ─── GET SINGLE REQUEST BY ID ───
router.get('/:id', protect, async (req, res) => {
  try {
    const request = await Request.findById(req.params.id)
      .populate('client', 'name email phone');
    
    if (!request) {
      return res.status(404).json({ 
        success: false, 
        message: 'Request not found' 
      });
    }
    
    // Increment view count
    request.viewCount = (request.viewCount || 0) + 1;
    await request.save();
    
    console.log(`✅ Request ${req.params.id} viewed (count: ${request.viewCount})`);
    
    res.json({ success: true, request });
    
  } catch (error) {
    console.error('❌ Get request error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching request' 
    });
  }
});

// ─── GET APPROACHES FOR A REQUEST (CLIENT ONLY) ───
router.get('/:id/approaches', protect, authorize('client'), async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);
    
    if (!request) {
      return res.status(404).json({ 
        success: false, 
        message: 'Request not found' 
      });
    }
    
    if (request.client.toString() !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized' 
      });
    }
    
    const approaches = await Approach.find({ request: req.params.id })
      .populate('expert', 'name specialization rating reviewCount profilePhoto')
      .sort('-createdAt');
    
    console.log(`✅ Found ${approaches.length} approaches for request ${req.params.id}`);
    
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

// ─── UPDATE REQUEST STATUS (CLIENT ONLY) ───
router.put('/:id/status', protect, authorize('client'), async (req, res) => {
  try {
    const { status } = req.body;
    
    const request = await Request.findById(req.params.id);
    
    if (!request) {
      return res.status(404).json({ 
        success: false, 
        message: 'Request not found' 
      });
    }
    
    if (request.client.toString() !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized' 
      });
    }
    
    request.status = status;
    await request.save();
    
    console.log(`✅ Request ${req.params.id} status updated to ${status}`);
    
    res.json({ success: true, request });
    
  } catch (error) {
    console.error('❌ Update status error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error updating status' 
    });
  }
});

// ─── DELETE REQUEST (CLIENT ONLY) ───
router.delete('/:id', protect, authorize('client'), async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);
    
    if (!request) {
      return res.status(404).json({ 
        success: false, 
        message: 'Request not found' 
      });
    }
    
    if (request.client.toString() !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized' 
      });
    }
    
    await request.deleteOne();
    
    console.log(`✅ Request ${req.params.id} deleted`);
    
    res.json({ 
      success: true, 
      message: 'Request deleted' 
    });
    
  } catch (error) {
    console.error('❌ Delete request error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error deleting request' 
    });
  }
});
// ─── MARK REQUEST AS COMPLETED (CLIENT ONLY) ───
router.post('/:id/complete', protect, authorize('client'), async (req, res) => {
  try {
    const { expertId } = req.body;
    
    console.log('🔍 Completing request:', req.params.id);
    console.log('   Expert ID from body:', expertId);
    
    const request = await Request.findById(req.params.id);
    
    if (!request) {
      return res.status(404).json({ 
        success: false, 
        message: 'Request not found' 
      });
    }
    
    if (request.client.toString() !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized' 
      });
    }
    
    // Update request status
    request.status = 'completed';
    request.completedAt = Date.now();
    if (expertId) {
      request.completedBy = expertId;
    }
    await request.save();
    
    console.log('✅ Request status updated to completed');
    
    // Mark the approach as work completed
    if (expertId) {
      console.log('🔍 Looking for approach:', { expert: expertId, request: req.params.id });
      
      const allApproaches = await Approach.find({ request: req.params.id }).lean();
      console.log('📋 All approaches for this request:', allApproaches.length);
      allApproaches.forEach((a, i) => {
        console.log(`   Approach ${i+1}: expert=${a.expert.toString()}, match=${a.expert.toString() === expertId}`);
      });
      
      const approach = await Approach.findOneAndUpdate(
        { expert: expertId, request: req.params.id },
        { 
          isWorkCompleted: true,
          workCompletedAt: Date.now()
        },
        { new: true }
      );
      
      if (approach) {
        console.log('✅ Approach found and updated! isWorkCompleted:', approach.isWorkCompleted);
      } else {
        console.log('❌ NO APPROACH FOUND with that expert+request combination');
      }
    } else {
      console.log('⚠️ No expertId provided in request body');
    }
    
    res.json({ 
      success: true, 
      message: 'Request marked as completed',
      request 
    });
    
  } catch (error) {
    console.error('❌ Complete request error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error completing request' 
    });
  }
});
// ─── TRACK EXPERT VIEW ON REQUEST ───
router.post('/:id/view', protect, authorize('expert'), async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false });

    const alreadyViewed = (request.viewedBy || []).some(
      id => id.toString() === req.user._id.toString()
    );

    if (!alreadyViewed) {
      await Request.findByIdAndUpdate(req.params.id, {
        $inc: { viewCount: 1 },
        $addToSet: { viewedBy: req.user._id }
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('View track error:', err);
    res.status(500).json({ success: false });
  }
});

router.get('/test-approach-update', protect, async (req, res) => {
  res.json({ 
    message: 'Approach update code is deployed',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
