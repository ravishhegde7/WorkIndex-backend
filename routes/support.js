// routes/support.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// ─── CREDIT TRANSACTION MODEL (optional — safe load) ───
let CreditTransaction = null;
try {
  CreditTransaction = require('../models/CreditTransaction');
} catch (e) {
  console.log('CreditTransaction model not found — using Approach fallback');
}

// ─── SUPPORT TICKET MODEL ───
const supportTicketSchema = new mongoose.Schema({
  user:            { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  userType:        { type: String, enum: ['customer', 'expert', 'anonymous'] },
  issueType:       { type: String },
  subIssue:        { type: String },
  clientCount:     { type: Number },
  decision:        { type: String, enum: ['PENDING_ADMIN_REVIEW', 'CLOSE_CHAT', 'ESCALATE_CALL', 'RESOLVED', 'PENDING', 'REFUND_APPROVED', 'REFUND_REJECTED'] },
  creditsRefunded: { type: Number, default: 0 },
  inactiveCount:   { type: Number, default: 0 },
  eligibleCredits: { type: Number, default: 0 }, // ✅ Credits pending admin approval
  // ✅ Full per-approach breakdown stored in ticket
  transactionBreakdown: [{
    transactionId:      mongoose.Schema.Types.ObjectId,
    requestTitle:       String,
    clientName:         String,
    clientCity:         String,
    creditsSpent:       Number,
    approachedAt:       Date,
    clientLastLogin:    Date,
    daysSinceApproach:  Number,
    daysSinceLogin:     Number,
    clientHasResponded: Boolean,
    clientResponseType: String,
    clientRespondedAt:  Date,
    eligible:           Boolean,
    reason:             String
  }],
  conversationLog: [{ role: String, message: String, timestamp: Date }],
  status:          { type: String, enum: ['open', 'resolved', 'escalated', 'pending_review'], default: 'open' },
  adminNote:       { type: String }, // ✅ Admin can add notes when reviewing
  scheduledCallback: { type: String },
  createdAt:       { type: Date, default: Date.now },
  resolvedAt:      { type: Date }
});

const SupportTicket = mongoose.models.SupportTicket ||
  mongoose.model('SupportTicket', supportTicketSchema);

// ─── OPTIONAL AUTH ───
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await mongoose.model('User').findById(decoded.id).select('-password');
    }
  } catch (e) {
    // No auth — continue anyway
  }
  next();
};

// ═══════════════════════════════════════════════════════════
//  POST /api/support/evaluate
// ═══════════════════════════════════════════════════════════
router.post('/evaluate', optionalAuth, async (req, res) => {
  try {
    const { userId, issueType, clientCount } = req.body;
    const user = req.user;

    // Not logged in — always escalate
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
    const [recentApproaches, pastComplaints, userRecord] = await Promise.all([
      getRecentApproaches(targetUserId),
      SupportTicket.countDocuments({
  user: targetUserId,
  issueType: 'no_response',
  status: { $in: ['escalated', 'open'] }, // ✅ Don't count already resolved ones
  createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
}),
      mongoose.model('User').findById(targetUserId)
        .select('credits createdAt isVerified isFlagged name email')
    ]);

    console.log(`✅ Approaches found: ${recentApproaches.length}, Past complaints: ${pastComplaints}`);

    // ─── BUILD PER-APPROACH BREAKDOWN ───
    // Uses Approach model directly (CreditTransaction optional for richer data later)
    let transactionBreakdown = [];

    try {
      const txns = CreditTransaction ? await CreditTransaction.find({
        user: targetUserId,
        type: 'spent',
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      })
      .populate('relatedClient', 'name lastLogin location')
      .populate('relatedRequest', 'title service')
      .sort({ createdAt: -1 })
      .limit(20) : [];

      if (txns.length > 0) {
        // Use CreditTransaction data (richer)
        transactionBreakdown = txns.map(tx => {
          const client = tx.relatedClient;
          const daysSinceLogin = client?.lastLogin
            ? Math.floor((Date.now() - new Date(client.lastLogin)) / (1000 * 60 * 60 * 24))
            : 999;
          // ✅ Check days since APPROACH was made
          const daysSinceApproach = Math.floor(
            (Date.now() - new Date(tx.createdAt)) / (1000 * 60 * 60 * 24)
          );
          // ✅ Check if client responded via any of the 4 tracked actions
          const clientHasResponded = !!tx.relatedApproach?.clientRespondedAt;
          const clientResponseType = tx.relatedApproach?.clientResponseType || null;
          const clientRespondedAt  = tx.relatedApproach?.clientRespondedAt  || null;

          const eligible = daysSinceApproach >= 7
            && !clientHasResponded
            && pastComplaints === 0;

          return {
            transactionId:      tx._id,
            requestTitle:       tx.approachDetails?.requestTitle || tx.relatedRequest?.title || 'Unknown',
            requestService:     tx.approachDetails?.requestService || tx.relatedRequest?.service || '',
            clientName:         client?.name || tx.approachDetails?.clientName || 'Unknown',
            clientCity:         client?.location?.city || tx.approachDetails?.clientCity || '',
            clientLastLogin:    client?.lastLogin || null,
            daysSinceLogin,
            daysSinceApproach,
            clientHasResponded,
            clientResponseType,
            clientRespondedAt,
            creditsSpent:       Math.abs(tx.amount),
            approachedAt:       tx.createdAt,
            eligible,
            reason: clientHasResponded
              ? `Client responded (${(clientResponseType || '').replace(/_/g, ' ')}) on ${new Date(clientRespondedAt).toLocaleDateString('en-IN')}`
              : daysSinceApproach < 7
                ? `Only ${daysSinceApproach} day${daysSinceApproach !== 1 ? 's' : ''} since approach — wait until 7 days`
                : pastComplaints > 0
                  ? 'Previous complaint exists'
                  : 'Client never responded'
          };
        });
      } else {
        // ✅ Fall back to Approach model data (primary path until CreditTransaction is wired in)
        transactionBreakdown = recentApproaches.map(approach => {
          const client = approach.client;
          const daysSinceLogin = client?.lastLogin
            ? Math.floor((Date.now() - new Date(client.lastLogin)) / (1000 * 60 * 60 * 24))
            : 999;
          // ✅ Check days since APPROACH was made
          const daysSinceApproach = Math.floor(
            (Date.now() - new Date(approach.createdAt)) / (1000 * 60 * 60 * 24)
          );
          // ✅ Check if client responded via any of the 4 tracked actions
          const clientHasResponded = !!approach.clientRespondedAt;
          const clientResponseType = approach.clientResponseType || null;
          const clientRespondedAt  = approach.clientRespondedAt  || null;

          const eligible = daysSinceApproach >= 7
            && !clientHasResponded
            && pastComplaints === 0;

          return {
            requestTitle:       approach.request?.title || 'Unknown Request',
            clientName:         client?.name || 'Unknown Client',
            clientLastLogin:    client?.lastLogin || null,
            daysSinceLogin,
            daysSinceApproach,
            clientHasResponded,
            clientResponseType,
            clientRespondedAt,
            creditsSpent:       approach.creditsSpent || 20,
            approachedAt:       approach.createdAt,
            eligible,
            reason: clientHasResponded
              ? `Client responded (${(clientResponseType || '').replace(/_/g, ' ')}) on ${new Date(clientRespondedAt).toLocaleDateString('en-IN')}`
              : daysSinceApproach < 7
                ? `Only ${daysSinceApproach} day${daysSinceApproach !== 1 ? 's' : ''} since approach — wait until 7 days`
                : 'Client never responded'
          };
        });
      }
    } catch (txErr) {
      console.log('Breakdown error, using basic Approach data:', txErr.message);
      transactionBreakdown = recentApproaches.map(approach => {
        const client = approach.client;
        const daysSinceLogin = client?.lastLogin
          ? Math.floor((Date.now() - new Date(client.lastLogin)) / (1000 * 60 * 60 * 24))
          : 999;
        const daysSinceApproach = Math.floor(
          (Date.now() - new Date(approach.createdAt)) / (1000 * 60 * 60 * 24)
        );
        const clientHasResponded = !!approach.clientRespondedAt;
        const eligible = daysSinceApproach >= 7 && !clientHasResponded && pastComplaints === 0;
        return {
          requestTitle:       approach.request?.title || 'Unknown Request',
          clientName:         client?.name || 'Unknown Client',
          clientLastLogin:    client?.lastLogin || null,
          daysSinceLogin,
          daysSinceApproach,
          clientHasResponded,
          clientResponseType: approach.clientResponseType || null,
          clientRespondedAt:  approach.clientRespondedAt  || null,
          creditsSpent:       approach.creditsSpent || 20,
          approachedAt:       approach.createdAt,
          eligible,
          reason: clientHasResponded
            ? `Client responded (${(approach.clientResponseType || '').replace(/_/g, ' ')})`
            : daysSinceApproach < 7
              ? `Only ${daysSinceApproach} day${daysSinceApproach !== 1 ? 's' : ''} since approach — wait until 7 days`
              : 'Client never responded'
        };
      });
    }

    // ─── ELIGIBLE TRANSACTIONS ───
    const eligibleTransactions = transactionBreakdown.filter(t => t.eligible);
    const inactiveCount   = eligibleTransactions.length;
    const eligibleCredits = eligibleTransactions.reduce((sum, t) => sum + (t.creditsSpent || 20), 0);

    // ─── DECISION LOGIC ───
    // ✅ NO AUTO REFUND — eligible cases go to admin for review
    let decision, reason;

    if (userRecord?.isFlagged) {
      decision = 'CLOSE_CHAT';
      reason   = 'account_flagged';
    } else if (pastComplaints >= 3) {
      decision = 'CLOSE_CHAT';
      reason   = 'excessive_complaints';
    } else if (pastComplaints >= 2) {
      decision = 'ESCALATE_CALL';
      reason   = 'multiple_complaints';
    } else if (inactiveCount >= 1 && pastComplaints === 0) {
      decision = 'PENDING_ADMIN_REVIEW'; // ✅ Was AUTO_REFUND — now goes to admin
      reason   = 'eligible_for_review';
    } else if (inactiveCount >= 1 && pastComplaints === 1) {
      decision = 'ESCALATE_CALL';
      reason   = 'second_complaint_with_evidence';
    } else {
      decision = 'CLOSE_CHAT';
      reason   = 'client_responded_or_too_early';
    }

    // ✅ NO AUTOMATIC CREDIT ADDITION — admin will approve via separate endpoint later
    const newBalance = userRecord?.credits || 0;

    // ─── CREATE SUPPORT TICKET ───
    const ticket = await SupportTicket.create({
      user:         targetUserId,
      userType:     'expert',
      issueType:    'no_response',
      clientCount,
      decision,
      creditsRefunded:      0, // ✅ 0 until admin approves
      eligibleCredits,         // ✅ Amount pending admin review
      inactiveCount,
      transactionBreakdown: transactionBreakdown.slice(0, 10),
      status:               decision === 'PENDING_ADMIN_REVIEW' ? 'pending_review'
                          : decision === 'ESCALATE_CALL'        ? 'escalated'
                          : 'resolved',
      resolvedAt: ['CLOSE_CHAT'].includes(decision) ? new Date() : undefined
    });

    return res.json({
      success:        true,
      decision,
      reason,
      ticketId:       ticket._id,
      eligibleCredits,         // ✅ Shown in chatbot message
      inactiveCount,
      breakdown:      transactionBreakdown,
      newBalance,
      message:        getDecisionMessage(decision, eligibleCredits)
    });

  } catch (error) {
    console.error('Support evaluate error:', error);
    res.json({
      success:  true,
      decision: 'ESCALATE_CALL',
      ticketId: null,
      message:  'Something went wrong. Connecting you with our team.'
    });
  }
});

// ═══════════════════════════════════════════════════════════
//  GET /api/support/ledger  — Expert's full credit history
// ═══════════════════════════════════════════════════════════
router.get('/ledger', optionalAuth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Login required' });

    const { type, startDate, endDate, clientId, limit = 50, skip = 0 } = req.query;

    const result = await CreditTransaction.getUserLedger(req.user._id, {
      type, startDate, endDate, clientId,
      limit: parseInt(limit),
      skip:  parseInt(skip)
    });

    const summaryMap = {};
    result.summary.forEach(s => { summaryMap[s._id] = { total: s.total, count: s.count }; });

    res.json({
      success:      true,
      transactions: result.transactions,
      total:        result.total,
      summary: {
        totalPurchased: summaryMap.purchase?.total || 0,
        totalSpent:     Math.abs(summaryMap.spent?.total   || 0),
        totalRefunded:  summaryMap.refund?.total  || 0,
        totalBonus:     summaryMap.bonus?.total   || 0,
        purchaseCount:  summaryMap.purchase?.count || 0,
        spentCount:     summaryMap.spent?.count   || 0,
        refundCount:    summaryMap.refund?.count  || 0
      }
    });
  } catch (error) {
    console.error('Ledger error:', error);
    res.status(500).json({ success: false });
  }
});

// ═══════════════════════════════════════════════════════════
//  GET /api/support/ledger/client/:clientId
// ═══════════════════════════════════════════════════════════
router.get('/ledger/client/:clientId', optionalAuth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false });

    const transactions = await CreditTransaction.find({
      user:          req.user._id,
      relatedClient: req.params.clientId
    })
    .populate('relatedRequest',  'title service status')
    .populate('relatedApproach', 'status')
    .sort({ createdAt: -1 });

    const client = await mongoose.model('User')
      .findById(req.params.clientId)
      .select('name email lastLogin location');

    res.json({ success: true, client, transactions });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// ═══════════════════════════════════════════════════════════
//  POST /api/support/ticket
// ═══════════════════════════════════════════════════════════
router.post('/ticket', optionalAuth, async (req, res) => {
  try {
    const { issueType, description, scheduledCallback, conversationLog } = req.body;
    const ticket = await SupportTicket.create({
      user:     req.user?._id,
      userType: req.user?.role || 'anonymous',
      issueType,
      decision: 'PENDING',
      status:   'open',
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
//  GET /api/support/tickets  — Admin view
// ═══════════════════════════════════════════════════════════
router.get('/tickets', optionalAuth, async (req, res) => {
  try {
    const tickets = await SupportTicket.find()
      .populate('user', 'name email phone')
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({ success: true, tickets });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// ─── HELPER: Get recent approaches ───
async function getRecentApproaches(userId) {
  try {
    const Approach = require('../models/Approach');
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const approaches = await Approach.find({
      expert:    userId,
      createdAt: { $gte: thirtyDaysAgo }
    })
    .populate('client',  'lastLogin name location')  // ✅ Direct client field
    .populate('request', 'title service')
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
    PENDING_ADMIN_REVIEW: `Your case looks eligible for ${credits} credits back. Our admin will review and confirm within 24 hours.`,
    CLOSE_CHAT:           'Our team will review and contact you via email within 48 hours.',
    ESCALATE_CALL:        'Connecting you with our support team for immediate assistance.',
    REFUND_APPROVED:      `${credits} credits have been added to your account.`,
    REFUND_REJECTED:      'After review, this case was not eligible for a refund.'
  };
  return messages[decision] || 'Your case is being reviewed.';
}

module.exports = router;
