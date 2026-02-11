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
if (!requestId || !message) {
  return res.status(400).json({
    success: false,
    message: 'Request ID and message are required'
  });
}

const request = await Request.findById(requestId).populate('client', 'email phone');
if (!request) {
  return res.status(404).json({
    success: false,
    message: 'Request not found'
  });
}

const existingApproach = await Approach.findOne({ expert: expertId, request: requestId });
if (existingApproach) {
  return res.status(400).json({
    success: false,
    message: 'You have already approached this request'
  });
}

const expert = await User.findById(expertId);
if (!expert) {
  return res.status(404).json({
    success: false,
    message: 'Expert not found'
  });
}

let creditsNeeded;
if (request.credits === null || request.credits === undefined) {
  creditsNeeded = 20;
  console.log('Request ' + requestId + ' had null/undefined credits, using default: ' + creditsNeeded);
  request.credits = creditsNeeded;
  await request.save();
} else {
  creditsNeeded = request.credits;
}

if (expert.credits < creditsNeeded) {
  return res.status(400).json({
    success: false,
    message: 'Insufficient credits. You need ' + creditsNeeded + ' credits.'
  });
}

expert.credits -= creditsNeeded;
await expert.save();

const approach = await Approach.create({
  expert: expertId,
  request: requestId,
  message: message,
  status: 'sent',
  creditsSpent: creditsNeeded,
  clientEmail: request.client ? request.client.email : null,
  clientPhone: request.client ? request.client.phone : null
});

request.responseCount = (request.responseCount || 0) + 1;
request.status = 'active';
await request.save();

res.status(201).json({
  success: true,
  message: 'Approach sent successfully',
  approachId: approach._id,
  creditsRemaining: expert.credits,
  clientEmail: request.client ? request.client.email : null,
  clientPhone: request.client ? request.client.phone : null
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
expert: req.user.userId
}).populate(‘request’, ‘title description service’)
.sort(’-createdAt’);

```
res.json({
  success: true,
  approaches: approaches.map(function(a) {
    return {
      _id: a._id,
      requestId: a.request ? a.request._id : null,
      requestTitle: a.request ? (a.request.title || 'Request') : 'Request',
      message: a.message,
      status: a.status,
      creditsSpent: a.creditsSpent,
      createdAt: a.createdAt
    };
  })
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
