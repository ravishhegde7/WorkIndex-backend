// routes/support.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// ─── CREDIT TRANSACTION MODEL ───
const CreditTransaction = require('../models/CreditTransaction');

// ─── SUPPORT TICKET MODEL ───
const supportTicketSchema = new mongoose.Schema({
  user:            { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  userType:        { type: String, enum: ['customer', 'expert', 'anonymous'] },
  issueType:       { type: String },
  subIssue:        { type: String },
  clientCount:     { type: Number },
  decision:        { type: String, enum: ['AUTO_REFUND', 'CLOSE_CHAT', 'ESCALATE_CALL', 'RESOLVED', 'PENDING'] },
  creditsRefunded: { type: Number, default: 0 },
  inactiveCount:   { type: Number, default: 0 },
  // ✅ NEW: Full per-transaction breakdown stored in ticket
  transactionBreakdown: [{
    transactionId:   mongoose.Schema.Types.ObjectId,
    requestTitle:    String,
    clientName:      String,
    clientCity:      String,
    creditsSpent:    Number,
    approachedAt:    Date,
    clientLastLogin: Date,
    daysSinceLogin:  Number,
    eligible:        Boolean,
    reason:          String
  }],
  conversationLog: [{ role: String, message: String, timestamp: Date }],
  status:          { type: String, enum: ['open', 'resolved', 'escalated'], default: 'open' },
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
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      }),
      mongoose.model('User').findById(targetUserId)
        .select('credits createdAt isVerified isFlagged name email')
    ]);

    console.log(`✅ Approaches found: ${recentApproaches.length}, Past complaints: ${pastComplaints}`);

    // ─── BUILD PER-APPROACH BREAKDOWN ───
    // Try CreditTransaction first (richer data), fall back to Approach data
    let transactionBreakdown = [];

    try {
      const txns = await CreditTransaction.find({
        user: targetUserId,
        type: 'spent',
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      })
      .populate('relatedClient', 'name lastLogin location')
      .populate('relatedRequest', 'title service')
      .sort({ createdAt: -1 })
      .limit(20);

      if (txns.length > 0) {
        // Use CreditTransaction data (richer)
        transactionBreakdown = txns.map(tx => {
          const client = tx.relatedClient;
          const daysSinceLogin = client?.lastLogin
            ? Math.floor((Date.now() - new Date(client.lastLogin)) / (1000 * 60 * 60 * 24))
            : 999;
          const eligible = daysSinceLogin > 5 && pastComplaints === 0;
          return {
            transactionId:   tx._id,
            requestTitle:    tx.approachDetails?.requestTitle || tx.relatedRequest?.title || 'Unknown',
            requestService:  tx.approachDetails?.requestService || tx.relatedRequest?.service || '',
            clientName:      client?.name || tx.approachDetails?.clientName || 'Unknown',
            clientCity:      client?.location?.city || tx.approachDetails?.clientCity || '',
            clientLastLogin: client?.lastLogin || null,
            daysSinceLogin,
            creditsSpent:    Math.abs(tx.amount),
            approachedAt:    tx.createdAt,
            eligible,
            reason: !client ? 'client_not_found'
              : daysSinceLogin <= 5 ? `client_active_${daysSinceLogin}_days_ago`
              : pastComplaints > 0  ? 'previous_complaint_exists'
              : 'client_inactive'
          };
        });
      } else {
        // Fall back to Approach model data
        transactionBreakdown = recentApproaches.map(approach => {
          const client = approach.client;
          const daysSinceLogin = client?.lastLogin
            ? Math.floor((Date.now() - new Date(client.lastLogin)) / (1000 * 60 * 60 * 24))
            : 999;
          const eligible = daysSinceLogin > 5 && pastComplaints === 0;
          return {
            requestTitle:    approach.request?.title || 'Unknown Request',
            clientName:      client?.name || 'Unknown Client',
            clientLastLogin: client?.lastLogin || null,
            daysSinceLogin,
            creditsSpent:    approach.creditsSpent || 20,
            approachedAt:    approach.createdAt,
            eligible,
            reason: daysSinceLogin <= 5
              ? `client_active_${daysSinceLogin}_days_ago`
              : 'client_inactive'
          };
        });
      }
    } catch (txErr) {
      // CreditTransaction model not yet in use — fall back gracefully
      console.log('CreditTransaction not available yet, using Approach data');
      transactionBreakdown = recentApproaches.map(approach => {
        const client = approach.client;
        const daysSinceLogin = client?.lastLogin
          ? Math.floor((Date.now() - new Date(client.lastLogin)) / (1000 * 60 * 60 * 24))
          : 999;
        const eligible = daysSinceLogin > 5 && pastComplaints === 0;
        return {
          requestTitle:    approach.request?.title || 'Unknown Request',
          clientName:      client?.name || 'Unknown Client',
          clientLastLogin: client?.lastLogin || null,
          daysSinceLogin,
          creditsSpent:    approach.creditsSpent || 20,
          approachedAt:    approach.createdAt,
          eligible,
          reason: daysSinceLogin <= 5
            ? `client_active_${daysSinceLogin}_days_ago`
            : 'client_inactive'
        };
      });
    }

    // ─── ELIGIBLE TRANSACTIONS ───
    const eligibleTransactions = transactionBreakdown.filter(t => t.eligible);
    const inactiveCount   = Math.min(eligibleTransactions.length, clientCount || 99);
    const creditsToRefund = eligibleTransactions
      .slice(0, inactiveCount)
      .reduce((sum, t) => sum + (t.creditsSpent || 20), 0);

    // ─── DECISION LOGIC (same as before) ───
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
      decision = 'AUTO_REFUND';
      reason   = 'genuine_inactive_clients';
    } else if (inactiveCount >= 1 && pastComplaints === 1) {
      decision = 'ESCALATE_CALL';
      reason   = 'second_complaint_with_evidence';
    } else {
      decision = 'CLOSE_CHAT';
      reason   = 'clients_were_active';
    }

    // ─── EXECUTE AUTO REFUND ───
    let newBalance = userRecord?.credits || 0;
    if (decision === 'AUTO_REFUND' && creditsToRefund > 0) {
      const balanceBefore = userRecord.credits;
      newBalance = balanceBefore + creditsToRefund;

      await mongoose.model('User').findByIdAndUpdate(targetUserId, {
        $inc: { credits: creditsToRefund }
      });

      // ✅ Log refund in CreditTransaction if model available
      try {
        for (const t of eligibleTransactions.slice(0, inactiveCount)) {
          await CreditTransaction.log({
            user:          targetUserId,
            type:          'refund',
            amount:        t.creditsSpent,
            balanceBefore,
            balanceAfter:  newBalance,
            description:   `Goodwill refund — client inactive (${t.daysSinceLogin} days) on "${t.requestTitle}"`,
            initiatedBy:   'chatbot',
            refundDetails: {
              reason:               'client_inactive',
              approvedBy:           'chatbot_auto',
              clientLastLogin:      t.clientLastLogin,
              daysSinceClientLogin: t.daysSinceLogin
            }
          });
        }
      } catch (logErr) {
        // CreditTransaction logging failed — don't block refund
        console.log('CreditTransaction log skipped:', logErr.message);
      }
    }

    // ─── CREATE SUPPORT TICKET ───
    const ticket = await SupportTicket.create({
      user:         targetUserId,
      userType:     'expert',
      issueType:    'no_response',
      clientCount,
      decision,
      creditsRefunded:      decision === 'AUTO_REFUND' ? creditsToRefund : 0,
      inactiveCount:        eligibleTransactions.length,
      transactionBreakdown: transactionBreakdown.slice(0, 10),
      status:               decision === 'ESCALATE_CALL' ? 'escalated' : 'resolved',
      resolvedAt:           decision !== 'ESCALATE_CALL' ? new Date() : undefined
    });

    return res.json({
      success:         true,
      decision,
      reason,
      ticketId:        ticket._id,
      creditsToRefund: decision === 'AUTO_REFUND' ? creditsToRefund : 0,
      inactiveCount:   eligibleTransactions.length,
      breakdown:       transactionBreakdown,   // ✅ Full breakdown to frontend
      newBalance,
      message:         getDecisionMessage(decision, creditsToRefund)
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
    AUTO_REFUND:   `Refunded ${credits} credits to your account.`,
    CLOSE_CHAT:    'Our team will review and contact you via email within 48 hours.',
    ESCALATE_CALL: 'Connecting you with our support team for immediate assistance.'
  };
  return messages[decision] || 'Your case is being reviewed.';
}

module.exports = router;
