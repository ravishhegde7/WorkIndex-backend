const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const Approach = require('../models/Approach');
const Request = require('../models/Request');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

router.post('/', protect, authorize('expert'), async (req, res) => {
  try {
    const { requestId, message, quote } = req.body;
    const request = await Request.findById(requestId).populate('client');
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    const existingApproach = await Approach.findOne({ request: requestId, expert: req.user.id });
    if (existingApproach) {
      return res.status(400).json({ success: false, message: 'Already approached this request' });
    }
    const expert = await User.findById(req.user.id);
    if (expert.credits < request.credits) {
      return res.status(400).json({ success: false, message: 'Insufficient credits', required: request.credits, available: expert.credits });
    }
    expert.credits -= request.credits;
    await expert.save();
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
    await Transaction.create({
      user: req.user.id,
      type: 'credit_spend',
      amount: 0,
      credits: -request.credits,
      relatedApproach: approach._id,
      paymentStatus: 'success',
      description: `Unlocked request: ${request.title}`
    });
    request.responseCount += 1;
    if (request.status === 'pending') request.status = 'active';
    await request.save();
    await approach.populate('expert', 'name specialization rating reviewCount');
    res.status(201).json({ success: true, approach, remainingCredits: expert.credits });
  } catch (error) {
    console.error('Create approach error:', error);
    res.status(500).json({ success: false, message: 'Error creating approach' });
  }
});

router.get('/', protect, authorize('expert'), async (req, res) => {
  try {
    const approaches = await Approach.find({ expert: req.user.id }).populate('request', 'title service location budget timeline status').sort('-createdAt');
    res.json({ success: true, count: approaches.length, approaches });
  } catch (error) {
    console.error('Get approaches error:', error);
    res.status(500).json({ success: false, message: 'Error fetching approaches' });
  }
});

router.get('/:id', protect, async (req, res) => {
  try {
    const approach = await Approach.findById(req.params.id).populate('request').populate('expert', 'name specialization rating reviewCount');
    if (!approach) {
      return res.status(404).json({ success: false, message: 'Approach not found' });
    }
    if (approach.expert._id.toString() !== req.user.id && approach.request.client.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    res.json({ success: true, approach });
  } catch (error) {
    console.error('Get approach error:', error);
    res.status(500).json({ success: false, message: 'Error fetching approach' });
  }
});

router.put('/:id/status', protect, authorize('client'), async (req, res) => {
  try {
    const { status } = req.body;
    const approach = await Approach.findById(req.params.id).populate('request');
    if (!approach) {
      return res.status(404).json({ success: false, message: 'Approach not found' });
    }
    if (approach.request.client.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    approach.status = status;
    approach.respondedAt = Date.now();
    await approach.save();
    res.json({ success: true, approach });
  } catch (error) {
    console.error('Update approach status error:', error);
    res.status(500).json({ success: false, message: 'Error updating approach status' });
  }
});

module.exports = router;
