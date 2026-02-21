// ═══════════════════════════════════════════════════════════
//  WORKINDEX SUPPORT CHATBOT - Backend Route
//  File: routes/support.js
//  Add to server.js: app.use('/api/support', require('./routes/support'));
// ═══════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// ─── SUPPORT TICKET MODEL (inline, or move to models/SupportTicket.js) ───
const supportTicketSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  userType: { type: String, enum: ['customer', 'expert', 'anonymous'] },
  issueType: { type: String },
  subIssue: { type: String },
  clientCount: { type: Number },
  decision: { type: String, enum: ['AUTO_REFUND', 'CLOSE_CHAT', 'ESCALATE_CALL', 'RESOLVED', 'PENDING'] },
  creditsRefunded: { type: Number, default: 0 },
  inactiveCount: { type: Number, default: 0 },
  conversationLog: [{ role: String, message: String, timestamp: Date }],
  status: { type: String, enum: ['open', 'resolved', 'escalated'], default: 'open' },
  scheduledCallback: { type: String },
  createdAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date }
});

const SupportTicket = mongoose.models.SupportTicket || mongoose.model('SupportTicket', supportTicketSchema);

// ─── AUTH MIDDLEWARE (optional - works with or without login) ───
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await mongoose.model('User').findById(decoded.id).select('-password');
    }
  } catch (e) {
    // No auth - continue anyway (public support)
  }
  next();
};

// ═══════════════════════════════════════════════════════════
//  POST /api/support/evaluate
//  Main evaluation endpoint - heart of the chatbot logic
// ═══════════════════════════════════════════════════════════
router.post('/evaluate', optionalAuth, async (req, res) => {
  try {
    const { userId, issueType, clientCount } = req.body;
    const user = req.user;

    // If user not logged in, always escalate
    if (!user && !userId) {
      const ticket = await SupportTicket.create({
        userType: 'anonymous',
        issueType,
        decision: 'ESCALATE_CALL',
        status: 'escalated'
      });
      return res.json({ success: true, decision: 'ESCALATE_CALL', ticketId: ticket._id });
    }

    const targetUserId = user?._id || userId;

    // ─── RUN ALL CHECKS IN PARALLEL ───
    const [
      recentApproaches,
      pastComplaints,
      userRecord
    ] = await Promise.all([
      // Check approaches in last 30 days
      getRecentApproaches(targetUserId),
      // Check complaint history
      SupportTicket.countDocuments({
        user: targetUserId,
        issueType: 'no_response',
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      }),
      // Get user details
      mongoose.model('User').findById(targetUserId).select('credits createdAt isVerified isFlagged')
    ]);

    // ─── EVALUATE INACTIVE CLIENTS ───
    const inactiveApproaches = recentApproaches.filter(approach => {
      const client = approach.request?.client;
      if (!client) return false;
      const daysSinceLogin = client.lastLogin
        ? (Date.now() - new Date(client.lastLogin)) / (1000 * 60 * 60 * 24)
        : 999;
      return daysSinceLogin > 5; // Client inactive for 5+ days
    });

    const inactiveCount = Math.min(inactiveApproaches.length, clientCount || 1);
    const creditsToRefund = inactiveCount * 20; // Refund 20 credits per inactive client

    // ─── DECISION LOGIC ───
    let decision;
    let reason;

    if (userRecord?.isFlagged) {
      // Flagged accounts - close chat
      decision = 'CLOSE_CHAT';
      reason = 'account_flagged';

    } else if (pastComplaints >= 3) {
      // Too many complaints in 30 days - suspicious
      decision = 'CLOSE_CHAT';
      reason = 'excessive_complaints';

    } else if (pastComplaints >= 2) {
      // Multiple complaints - needs human review
      decision = 'ESCALATE_CALL';
      reason = 'multiple_complaints';

    } else if (inactiveCount >= 1 && pastComplaints === 0) {
      // Genuine case - auto refund
      decision = 'AUTO_REFUND';
      reason = 'genuine_inactive_clients';

    } else if (inactiveCount >= 1 && pastComplaints === 1) {
      // Second time - give benefit of doubt but escalate
      decision = 'ESCALATE_CALL';
      reason = 'second_complaint_with_evidence';

    } else {
      // Clients were actually active - no refund warranted
      decision = 'CLOSE_CHAT';
      reason = 'clients_were_active';
    }

    // ─── EXECUTE AUTO REFUND ───
    if (decision === 'AUTO_REFUND' && creditsToRefund > 0) {
      await mongoose.model('User').findByIdAndUpdate(targetUserId, {
        $inc: { credits: creditsToRefund }
      });
    }

    // ─── CREATE SUPPORT TICKET ───
    const ticket = await SupportTicket.create({
      user: targetUserId,
      userType: 'expert',
      issueType: 'no_response',
      clientCount,
      decision,
      creditsRefunded: decision === 'AUTO_REFUND' ? creditsToRefund : 0,
      inactiveCount,
      status: decision === 'AUTO_REFUND' ? 'resolved' :
              decision === 'CLOSE_CHAT' ? 'resolved' : 'escalated',
      resolvedAt: decision !== 'ESCALATE_CALL' ? new Date() : undefined
    });

    return res.json({
      success: true,
      decision,
      reason,
      ticketId: ticket._id,
      creditsToRefund: decision === 'AUTO_REFUND' ? creditsToRefund : 0,
      inactiveCount,
      message: getDecisionMessage(decision, creditsToRefund)
    });

  } catch (error) {
    console.error('Support evaluate error:', error);
    res.json({
      success: true,
      decision: 'ESCALATE_CALL',
      ticketId: null,
      message: 'Something went wrong. Connecting you with our team.'
    });
  }
});

// ═══════════════════════════════════════════════════════════
//  POST /api/support/ticket
//  Create a general support ticket
// ═══════════════════════════════════════════════════════════
router.post('/ticket', optionalAuth, async (req, res) => {
  try {
    const { issueType, description, scheduledCallback, conversationLog } = req.body;

    const ticket = await SupportTicket.create({
      user: req.user?._id,
      userType: req.user?.role || 'anonymous',
      issueType,
      decision: 'PENDING',
      status: 'open',
      scheduledCallback,
      conversationLog: conversationLog || []
    });

    res.json({ success: true, ticketId: ticket._id });
  } catch (error) {
    console.error('Create ticket error:', error);
    res.status(500).json({ success: false, message: 'Failed to create ticket' });
  }
});

// ═══════════════════════════════════════════════════════════
//  GET /api/support/tickets (admin view)
// ═══════════════════════════════════════════════════════════
router.get('/tickets', optionalAuth, async (req, res) => {
  try {
    // Only admins should see all tickets
    // Add your admin check here if needed
    const tickets = await SupportTicket.find()
      .populate('user', 'name email phone')
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({ success: true, tickets });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// ─── HELPER: Get recent approaches with client data ───
async function getRecentApproaches(userId) {
  try {
    const Approach = mongoose.model('Approach');
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

   const approaches = await Approach.find({
  expert: userId,
  createdAt: { $gte: thirtyDaysAgo }
})
.populate('client', 'lastLogin name')  // ✅ Direct client field
.populate('request', 'title')
.limit(20);

    return approaches;
  } catch (err) {
    console.error('Get approaches error:', err);
    return [];
  }
}

// ─── HELPER: Decision messages ───
function getDecisionMessage(decision, credits) {
  const messages = {
    AUTO_REFUND: `Refunding ${credits} credits to your account within 24 hours.`,
    CLOSE_CHAT: 'Our team will review your account and contact you via email within 48 hours.',
    ESCALATE_CALL: 'Connecting you with our support team for immediate assistance.'
  };
  return messages[decision] || 'Your case is being reviewed.';
}

module.exports = router;
