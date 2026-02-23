// routes/admin.js
const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');
const mongoose = require('mongoose');
const Admin    = require('../models/Admin');

// ─── ADMIN AUTH MIDDLEWARE ───
const adminProtect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.isAdmin) return res.status(403).json({ success: false, message: 'Not admin' });
    req.admin = await Admin.findById(decoded.id);
    if (!req.admin || !req.admin.isActive) return res.status(403).json({ success: false, message: 'Admin not found' });
    next();
  } catch (e) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// ═══════════════════════════════════════════════════════════
//  POST /api/admin/login
// ═══════════════════════════════════════════════════════════
router.post('/login', async (req, res) => {
  try {
    const { adminId, password } = req.body;
    if (!adminId || !password)
      return res.status(400).json({ success: false, message: 'Admin ID and password required' });

    const admin = await Admin.findOne({ adminId }).select('+password');
    if (!admin || !admin.isActive)
      return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const match = await admin.matchPassword(password);
    if (!match)
      return res.status(401).json({ success: false, message: 'Invalid credentials' });

    admin.lastLogin = new Date();
    await admin.save();

    const token = jwt.sign(
      { id: admin._id, isAdmin: true, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      success: true,
      token,
      admin: { id: admin._id, name: admin.name, adminId: admin.adminId, role: admin.role }
    });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// ═══════════════════════════════════════════════════════════
//  GET /api/admin/stats  — Dashboard overview
// ═══════════════════════════════════════════════════════════
router.get('/stats', adminProtect, async (req, res) => {
  try {
    const User    = mongoose.model('User');
    const Request = mongoose.model('Request');
    const Approach = require('../models/Approach');

    // Safe load optional models
    let CreditTransaction = null, SupportTicket = null;
    try { CreditTransaction = require('../models/CreditTransaction'); } catch(e) {}
    try { SupportTicket = mongoose.models.SupportTicket; } catch(e) {}

    const [
      totalClients, totalExperts, totalRequests, totalApproaches,
      pendingRefunds, recentUsers
    ] = await Promise.all([
      User.countDocuments({ role: 'client' }),
      User.countDocuments({ role: 'expert' }),
      Request.countDocuments(),
      Approach.countDocuments(),
      SupportTicket ? SupportTicket.countDocuments({ status: 'pending_review' }) : 0,
      User.find().sort({ createdAt: -1 }).limit(5).select('name email role createdAt')
    ]);

    // Credit stats
    let creditStats = { totalSold: 0, totalSpent: 0, totalRefunded: 0 };
    if (CreditTransaction) {
      const agg = await CreditTransaction.aggregate([
        { $group: { _id: '$type', total: { $sum: '$amount' } } }
      ]);
      agg.forEach(a => {
        if (a._id === 'purchase') creditStats.totalSold    = a.total;
        if (a._id === 'spent')    creditStats.totalSpent   = Math.abs(a.total);
        if (a._id === 'refund')   creditStats.totalRefunded = a.total;
      });
    }

    res.json({
      success: true,
      stats: {
        totalClients, totalExperts, totalRequests,
        totalApproaches, pendingRefunds,
        credits: creditStats
      },
      recentUsers
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ success: false });
  }
});

// ═══════════════════════════════════════════════════════════
//  GET /api/admin/users  — All users with filters
// ═══════════════════════════════════════════════════════════
router.get('/users', adminProtect, async (req, res) => {
  try {
    const User = mongoose.model('User');
    const { role, search, limit = 50, skip = 0 } = req.query;

    const query = {};
    if (role && role !== 'all') query.role = role;
    if (search) {
      query.$or = [
        { name:  { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .select('name email phone role credits createdAt lastLogin isFlagged isVerified location profile rating reviewCount')
        .sort({ createdAt: -1 })
        .skip(parseInt(skip))
        .limit(parseInt(limit)),
      User.countDocuments(query)
    ]);

    res.json({ success: true, users, total });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ═══════════════════════════════════════════════════════════
//  GET /api/admin/users/:id  — Full user profile
// ═══════════════════════════════════════════════════════════
router.get('/users/:id', adminProtect, async (req, res) => {
  try {
    const User    = mongoose.model('User');
    const Approach = require('../models/Approach');
    const Request  = mongoose.model('Request');

    let CreditTransaction = null, SupportTicket = null;
    try { CreditTransaction = require('../models/CreditTransaction'); } catch(e) {}
    try { SupportTicket = mongoose.models.SupportTicket; } catch(e) {}

    const userId = req.params.id;

    const [user, approaches, requests, tickets] = await Promise.all([
      User.findById(userId).select('-password'),
      Approach.find({ expert: userId })
        .populate('request', 'title service createdAt')
        .populate('client',  'name email')
        .sort({ createdAt: -1 })
        .limit(20),
      Request.find({ client: userId }).sort({ createdAt: -1 }).limit(20),
      SupportTicket
        ? SupportTicket.find({ user: userId }).sort({ createdAt: -1 }).limit(10)
        : []
    ]);

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Credit transactions if available
    let transactions = [];
    if (CreditTransaction) {
      transactions = await CreditTransaction.find({ user: userId })
        .populate('relatedRequest', 'title')
        .populate('relatedClient',  'name')
        .sort({ createdAt: -1 })
        .limit(30);
    }

    res.json({ success: true, user, approaches, requests, transactions, tickets });
  } catch (err) {
    console.error('Admin get user error:', err);
    res.status(500).json({ success: false });
  }
});

// ═══════════════════════════════════════════════════════════
//  GET /api/admin/tickets  — Support tickets (pending review)
// ═══════════════════════════════════════════════════════════
router.get('/tickets', adminProtect, async (req, res) => {
  try {
    const SupportTicket = mongoose.models.SupportTicket;
    if (!SupportTicket) return res.json({ success: true, tickets: [] });

    const { status = 'pending_review', limit = 50 } = req.query;
    const query = status === 'all' ? {} : { status };

    const tickets = await SupportTicket.find(query)
      .populate('user', 'name email phone credits')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.json({ success: true, tickets, total: tickets.length });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ═══════════════════════════════════════════════════════════
//  POST /api/admin/tickets/:id/approve  — Approve refund
// ═══════════════════════════════════════════════════════════
router.post('/tickets/:id/approve', adminProtect, async (req, res) => {
  try {
    const { note } = req.body;
    const SupportTicket = mongoose.models.SupportTicket;
    const User = mongoose.model('User');

    const ticket = await SupportTicket.findById(req.params.id).populate('user', 'credits name email');
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });
    if (ticket.status !== 'pending_review')
      return res.status(400).json({ success: false, message: 'Ticket already processed' });

    const creditsToAdd = ticket.eligibleCredits || 0;

    // Add credits to user
    await User.findByIdAndUpdate(ticket.user._id, { $inc: { credits: creditsToAdd } });

    // Log in CreditTransaction if available
    let CreditTransaction = null;
    try { CreditTransaction = require('../models/CreditTransaction'); } catch(e) {}
    if (CreditTransaction && creditsToAdd > 0) {
      const freshUser = await User.findById(ticket.user._id);
      await CreditTransaction.log({
        user:          ticket.user._id,
        type:          'refund',
        amount:        creditsToAdd,
        balanceBefore: (freshUser.credits - creditsToAdd),
        balanceAfter:  freshUser.credits,
        description:   `Admin approved refund — Ticket #${ticket._id}`,
        initiatedBy:   'admin',
        refundDetails: {
          reason:     'admin_approved',
          approvedBy: `admin:${req.admin.adminId}`,
          ticketId:   ticket._id
        }
      });
    }

    // Update ticket
    ticket.status          = 'resolved';
    ticket.decision        = 'REFUND_APPROVED';
    ticket.creditsRefunded = creditsToAdd;
    ticket.adminNote       = note || '';
    ticket.resolvedAt      = new Date();
    await ticket.save();

    res.json({
      success: true,
      message: `Refund of ${creditsToAdd} credits approved`,
      creditsAdded: creditsToAdd
    });
  } catch (err) {
    console.error('Admin approve error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  POST /api/admin/tickets/:id/reject  — Reject refund
// ═══════════════════════════════════════════════════════════
router.post('/tickets/:id/reject', adminProtect, async (req, res) => {
  try {
    const { note } = req.body;
    const SupportTicket = mongoose.models.SupportTicket;

    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });
    if (ticket.status !== 'pending_review')
      return res.status(400).json({ success: false, message: 'Ticket already processed' });

    ticket.status     = 'resolved';
    ticket.decision   = 'REFUND_REJECTED';
    ticket.adminNote  = note || '';
    ticket.resolvedAt = new Date();
    await ticket.save();

    res.json({ success: true, message: 'Refund rejected' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  POST /api/admin/users/:id/flag  — Flag/unflag a user
// ═══════════════════════════════════════════════════════════
router.post('/users/:id/flag', adminProtect, async (req, res) => {
  try {
    const User = mongoose.model('User');
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false });
    user.isFlagged = !user.isFlagged;
    await user.save();
    res.json({ success: true, isFlagged: user.isFlagged });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ═══════════════════════════════════════════════════════════
//  POST /api/admin/seed  — Create first admin (run once)
//  DELETE THIS ROUTE after first use in production!
// ═══════════════════════════════════════════════════════════
router.post('/seed', async (req, res) => {
  try {
    const existing = await Admin.findOne({ adminId: 'admin_workindex' });
    if (existing) return res.json({ success: false, message: 'Admin already exists' });

    const admin = await Admin.create({
      adminId:  'admin_workindex',
      name:     'WorkIndex Admin',
      password: 'Admin@1234',   // ← CHANGE THIS after first login
      role:     'superadmin'
    });

    res.json({ success: true, message: 'Admin created', adminId: admin.adminId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
