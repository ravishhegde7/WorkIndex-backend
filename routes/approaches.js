// routes/approaches.js - Complete file UPDATED
const express = require(‘express’);
const router = express.Router();
const Approach = require(’../models/Approach’);
const User = require(’../models/User’);
const Request = require(’../models/Request’);
const { authenticate } = require(’../middleware/auth’);

// Create new approach
router.post(’/’, authenticate, async (req, res) => {
try {
const { requestId, message } = req.body;
const expertId = req.user.userId;

```
// Validate
if (!requestId || !message) {
  return res.status(400).json({ 
    success: false,
    message: 'Request ID and message are required' 
  });
}

// Get request with populated client data
const request = await Request.findById(requestId).populate('client', 'email phone');
if (!request) {
  return res.status(404).json({ 
    success: false,
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
    success: false,
    message: 'You have already approached this request' 
  });
}

// Get expert and check credits
const expert = await User.findById(expertId);

if (!expert) {
  return res.status(404).json({ 
    success: false,
    message: 'Expert not found' 
  });
}

// ⭐ DEFENSIVE FIX: Handle null/undefined credits from old requests
let creditsNeeded;
if (request.credits === null || request.credits === undefined) {
  // Old request without credits - use default
  creditsNeeded = 20;
  console.log(`⚠️ Request ${requestId} had null/undefined credits, using default: ${creditsNeeded}`);
  // Update the request with credits for future use
  request.credits = creditsNeeded;
  await request.save();
} else {
  creditsNeeded = request.credits;
}

if (expert.credits < creditsNeeded) {
  return res.status(400).json({ 
    success: false,
    message: `Insufficient credits. You need ${creditsNeeded} credits.` 
  });
}

// Deduct credits
expert.credits -= creditsNeeded;
await expert.save();

// Create approach with client contact details
const approach = await Approach.create({
  expertId,
  requestId,
  message,
  status: 'sent',
  creditsSpent: creditsNeeded,
  clientEmail: request.client?.email || null,
  clientPhone: request.client?.phone || null
});

// Update request response count
request.responseCount = (request.responseCount || 0) + 1;
request.status = 'active';
await request.save();

// ⭐ CRITICAL: Return this exact structure
res.status(201).json({
  success: true,
  message: 'Approach sent successfully',
  approachId: approach._id,
  creditsRemaining: expert.credits,
  clientEmail: request.client?.email || null,
  clientPhone: request.client?.phone || null
});
```

} catch (error) {
console.error(‘Error creating approach:’, error);
res.status(500).json({
success: false,
message: error.message
});
}
});

// Get expert’s approaches
router.get(’/my-approaches’, authenticate, async (req, res) => {
try {
const approaches = await Approach.find({
expertId: req.user.userId
}).populate(‘requestId’, ‘title description service’)
.sort(’-createdAt’);

```
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
```

} catch (error) {
console.error(‘Error fetching approaches:’, error);
res.status(500).json({
success: false,
message: error.message
});
}
});

module.exports = router;
