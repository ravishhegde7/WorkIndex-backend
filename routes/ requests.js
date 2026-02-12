const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const Request = require('../models/Request');
const Approach = require('../models/Approach');

const calculateCredits = (service, answers) => {
  const base = { itr: 15, gst: 20, accounting: 25, audit: 30, photography: 18, development: 35 };
  let credits = base[service] || 20;
  if (service === 'itr') {
    if (answers.incomeBracket === '25+') credits = 25;
    if (answers.incomeSource && answers.incomeSource.includes('business')) credits = 30;
  }
  if (service === 'gst' && answers.turnover === '20cr+') credits = 30;
  if (service === 'accounting' && answers.employees && parseInt(answers.employees) > 50) credits = 35;
  return credits;
};

// ⭐ NEW: Get available requests for experts (not yet approached)
router.get('/available', protect, authorize('expert'), async (req, res) => {
  try {
    // Get all requests this expert has already approached
    const myApproaches = await Approach.find({ 
      expert: req.user.id 
    }).select('request');
    
    const approachedRequestIds = myApproaches.map(a => a.request.toString());

    // Get requests that haven't been approached yet
    const requests = await Request.find({
      _id: { $nin: approachedRequestIds },
      status: { $in: ['pending', 'active'] }
    })
    .sort('-createdAt')
    .limit(50)
    .lean();

    // Return requests with questionnaire data
    const sanitizedRequests = requests.map(r => ({
      _id: r._id,
      title: r.title,
      description: r.description,
      service: r.service,
      timeline: r.timeline,
      location: r.location,
      budget: r.budget,
      credits: r.credits || 20,
      answers: r.answers || {},  // ⭐ Include questionnaire answers
      createdAt: r.createdAt,
      status: r.status
    }));

    res.json({ 
      success: true, 
      count: sanitizedRequests.length, 
      requests: sanitizedRequests 
    });

  } catch (error) {
    console.error('Get available requests error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching available requests' 
    });
  }
});

router.post('/', protect, authorize('client'), async (req, res) => {
  try {
    const { service, title, description, answers, timeline, budget, location } = req.body;
    const credits = calculateCredits(service, answers);
    
    const request = await Request.create({
      client: req.user.id,
      service,
      title,
      description,
      answers,
      timeline,
      budget,
      location,
      credits,
      status: 'pending'
    });
    
    res.status(201).json({ success: true, request });
    
  } catch (error) {
    console.error('Create request error:', error);
    res.status(500).json({ success: false, message: 'Error creating request' });
  }
});

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
    
    res.json({ success: true, count: requests.length, requests });
    
  } catch (error) {
    console.error('Get requests error:', error);
    res.status(500).json({ success: false, message: 'Error fetching requests' });
  }
});

router.get('/:id', protect, async (req, res) => {
  try {
    const request = await Request.findById(req.params.id)
      .populate('client', 'name email phone');
    
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    
    request.viewCount = (request.viewCount || 0) + 1;
    await request.save();
    
    res.json({ success: true, request });
    
  } catch (error) {
    console.error('Get request error:', error);
    res.status(500).json({ success: false, message: 'Error fetching request' });
  }
});

router.get('/:id/approaches', protect, authorize('client'), async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);
    
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    
    if (request.client.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    
    const approaches = await Approach.find({ request: req.params.id })
      .populate('expert', 'name specialization rating reviewCount profilePhoto')
      .sort('-createdAt');
    
    res.json({ success: true, count: approaches.length, approaches });
    
  } catch (error) {
    console.error('Get approaches error:', error);
    res.status(500).json({ success: false, message: 'Error fetching approaches' });
  }
});

router.put('/:id/status', protect, authorize('client'), async (req, res) => {
  try {
    const { status } = req.body;
    
    const request = await Request.findById(req.params.id);
    
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    
    if (request.client.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    
    request.status = status;
    await request.save();
    
    res.json({ success: true, request });
    
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ success: false, message: 'Error updating status' });
  }
});

router.delete('/:id', protect, authorize('client'), async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);
    
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    
    if (request.client.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    
    await request.deleteOne();
    
    res.json({ success: true, message: 'Request deleted' });
    
  } catch (error) {
    console.error('Delete request error:', error);
    res.status(500).json({ success: false, message: 'Error deleting request' });
  }
});

module.exports = router;
