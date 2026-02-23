// routes/admin.js
const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');
const mongoose = require('mongoose');
const Admin    = require('../models/Admin');

const protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization && req.headers.authorization.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.isAdmin) return res.status(403).json({ success: false, message: 'Not admin' });
    req.admin = await Admin.findById(decoded.id);
    if (!req.admin || !req.admin.isActive) return res.status(403).json({ success: false, message: 'Admin not found' });
    next();
  } catch (e) { res.status(401).json({ success: false, message: 'Invalid token' }); }
};

function addDateFilter(query, field, from, to) {
  if (from || to) {
    query[field] = {};
    if (from) query[field].$gte = new Date(from);
    if (to)   query[field].$lte = new Date(new Date(to).setHours(23,59,59,999));
  }
  return query;
}

function safeModel(name) {
  try { return mongoose.models[name] || null; } catch(e) { return null; }
}

function safeReq(path) {
  try { return require(path); } catch(e) { return null; }
}

// LOGIN
router.post('/login', async (req, res) => {
  try {
    var adminId = req.body.adminId, password = req.body.password;
    if (!adminId || !password) return res.status(400).json({ success: false, message: 'Required' });
    var admin = await Admin.findOne({ adminId: adminId }).select('+password');
    if (!admin || !admin.isActive) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    var match = await admin.matchPassword(password);
    if (!match) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    admin.lastLogin = new Date(); await admin.save();
    var token = jwt.sign({ id: admin._id, isAdmin: true, role: admin.role }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ success: true, token: token, admin: { id: admin._id, name: admin.name, adminId: admin.adminId, role: admin.role } });
  } catch (err) { res.status(500).json({ success: false, message: 'Login failed' }); }
});

// STATS
router.get('/stats', protect, async (req, res) => {
  try {
    var from = req.query.from, to = req.query.to;
    var User = mongoose.model('User');
    var Request = mongoose.model('Request');
    var Approach = safeReq('../models/Approach');
    var Ticket = safeModel('SupportTicket');
    var Rating = safeModel('Rating');
    var CreditTx = safeReq('../models/CreditTransaction');
    var dateQ = {};
    if (from || to) {
      dateQ.createdAt = {};
      if (from) dateQ.createdAt.$gte = new Date(from);
      if (to)   dateQ.createdAt.$lte = new Date(new Date(to).setHours(23,59,59,999));
    }
    var totalClients    = await User.countDocuments(Object.assign({ role: 'client' }, dateQ));
    var totalExperts    = await User.countDocuments(Object.assign({ role: 'expert' }, dateQ));
    var totalRequests   = await Request.countDocuments(dateQ);
    var totalApproaches = Approach ? await Approach.countDocuments(dateQ) : 0;
    var openApproaches  = Approach ? await Approach.countDocuments(Object.assign({ status: 'pending' }, dateQ)) : 0;
    var closedApproaches = totalApproaches - openApproaches;
    var pendingRefunds  = Ticket ? await Ticket.countDocuments({ status: 'pending_review' }) : 0;
    var totalReviews    = Rating ? await Rating.countDocuments(dateQ) : 0;
    var recentUsers     = await User.find(dateQ).sort({ createdAt: -1 }).limit(5).select('name email role createdAt credits');
    var credits = { totalPurchased: 0, totalSpent: 0, totalRefunded: 0 };
    if (CreditTx) {
      var agg = await CreditTx.aggregate([{ $match: dateQ }, { $group: { _id: '$type', total: { $sum: '$amount' } } }]);
      agg.forEach(function(a) {
        if (a._id === 'purchase') credits.totalPurchased = a.total;
        if (a._id === 'spent')    credits.totalSpent = Math.abs(a.total);
        if (a._id === 'refund')   credits.totalRefunded = a.total;
      });
    }
    res.json({ success: true, stats: { totalClients: totalClients, totalExperts: totalExperts, totalRequests: totalRequests, totalApproaches: totalApproaches, openApproaches: openApproaches, closedApproaches: closedApproaches, pendingRefunds: pendingRefunds, totalReviews: totalReviews, credits: credits }, recentUsers: recentUsers });
  } catch (err) { console.error('Stats error:', err); res.status(500).json({ success: false }); }
});

// ALL USERS
router.get('/users', protect, async (req, res) => {
  try {
    var User = mongoose.model('User');
    var role = req.query.role, search = req.query.search, from = req.query.from, to = req.query.to;
    var limit = parseInt(req.query.limit) || 100, skip = parseInt(req.query.skip) || 0;
    var query = {};
    if (role && role !== 'all') query.role = role;
    if (search) query.$or = [{ name: { $regex: search, $options: 'i' } }, { email: { $regex: search, $options: 'i' } }, { phone: { $regex: search, $options: 'i' } }];
    addDateFilter(query, 'createdAt', from, to);
    var users = await User.find(query).select('name email phone role credits createdAt lastLogin isFlagged isBanned warnings rating reviewCount profile').sort({ createdAt: -1 }).skip(skip).limit(limit);
    var total = await User.countDocuments(query);
    res.json({ success: true, users: users, total: total });
  } catch (err) { res.status(500).json({ success: false }); }
});

// USER BY ID
router.get('/users/:id', protect, async (req, res) => {
  try {
    var User = mongoose.model('User');
    var Approach = safeReq('../models/Approach');
    var Request = mongoose.model('Request');
    var Ticket = safeModel('SupportTicket');
    var CreditTx = safeReq('../models/CreditTransaction');
    var from = req.query.from, to = req.query.to;
    var dateQ = {};
    if (from || to) {
      dateQ.createdAt = {};
      if (from) dateQ.createdAt.$gte = new Date(from);
      if (to)   dateQ.createdAt.$lte = new Date(new Date(to).setHours(23,59,59,999));
    }
    var uid = req.params.id;
    var user = await User.findById(uid).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    var approaches = Approach ? await Approach.find(Object.assign({ expert: uid }, dateQ)).populate('request', 'title service status').populate('client', 'name email').sort({ createdAt: -1 }).limit(50) : [];
    var requests   = await Request.find(Object.assign({ client: uid }, dateQ)).sort({ createdAt: -1 }).limit(30);
    var tickets    = Ticket ? await Ticket.find({ user: uid }).sort({ createdAt: -1 }).limit(20) : [];
    var transactions = CreditTx ? await CreditTx.find(Object.assign({ user: uid }, dateQ)).populate('relatedRequest', 'title').populate('relatedClient', 'name').sort({ createdAt: -1 }).limit(50) : [];
    var creditSummary = null;
    if (user.role === 'expert' && CreditTx) {
      var agg2 = await CreditTx.aggregate([{ $match: { user: new mongoose.Types.ObjectId(uid) } }, { $group: { _id: '$type', total: { $sum: '$amount' } } }]);
      creditSummary = { purchased: 0, spent: 0, refunded: 0, closing: user.credits || 0 };
      agg2.forEach(function(a) {
        if (a._id === 'purchase') creditSummary.purchased = a.total;
        if (a._id === 'spent')    creditSummary.spent = Math.abs(a.total);
        if (a._id === 'refund')   creditSummary.refunded = a.total;
      });
      creditSummary.opening = creditSummary.purchased + creditSummary.refunded - creditSummary.spent - creditSummary.closing;
    }
    res.json({ success: true, user: user, approaches: approaches, requests: requests, transactions: transactions, tickets: tickets, creditSummary: creditSummary });
  } catch (err) { console.error('Get user error:', err); res.status(500).json({ success: false }); }
});

// APPROACHES
router.get('/approaches', protect, async (req, res) => {
  try {
    var Approach = safeReq('../models/Approach');
    if (!Approach) return res.json({ success: true, approaches: [], total: 0 });
    var status = req.query.status, from = req.query.from, to = req.query.to;
    var limit = parseInt(req.query.limit) || 100, skip = parseInt(req.query.skip) || 0;
    var query = {};
    if (status && status !== 'all') query.status = status;
    addDateFilter(query, 'createdAt', from, to);
    var approaches = await Approach.find(query).populate('expert', 'name email phone').populate('client', 'name email').populate('request', 'title service').sort({ createdAt: -1 }).skip(skip).limit(limit);
    var total = await Approach.countDocuments(query);
    res.json({ success: true, approaches: approaches, total: total });
  } catch (err) { res.status(500).json({ success: false }); }
});

// ALL CHATS
router.get('/chats', protect, async (req, res) => {
  try {
    var Chat = safeModel('Chat');
    if (!Chat) return res.json({ success: true, chats: [] });
    var from = req.query.from, to = req.query.to;
    var limit = parseInt(req.query.limit) || 100;
    var query = {};
    addDateFilter(query, 'createdAt', from, to);
    var chats = await Chat.find(query).populate('expert', 'name email').populate('client', 'name email').populate('request', 'title service').sort({ updatedAt: -1 }).limit(limit);
    res.json({ success: true, chats: chats, total: chats.length });
  } catch (err) { res.status(500).json({ success: false }); }
});

// CHAT MESSAGES
router.get('/chats/:id/messages', protect, async (req, res) => {
  try {
    var Message = safeModel('Message');
    if (!Message) return res.json({ success: true, messages: [] });
    var messages = await Message.find({ chat: req.params.id }).populate('sender', 'name role').sort({ createdAt: 1 }).limit(200);
    res.json({ success: true, messages: messages });
  } catch (err) { res.status(500).json({ success: false }); }
});

// CREDIT TRANSACTIONS
router.get('/credits', protect, async (req, res) => {
  try {
    var CreditTx = safeReq('../models/CreditTransaction');
    if (!CreditTx) return res.json({ success: true, transactions: [], total: 0 });
    var type = req.query.type, from = req.query.from, to = req.query.to;
    var limit = parseInt(req.query.limit) || 100, skip = parseInt(req.query.skip) || 0;
    var query = {};
    if (type && type !== 'all') query.type = type;
    addDateFilter(query, 'createdAt', from, to);
    var transactions = await CreditTx.find(query).populate('user', 'name email role').populate('relatedRequest', 'title service').populate('relatedClient', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit);
    var total = await CreditTx.countDocuments(query);
    res.json({ success: true, transactions: transactions, total: total });
  } catch (err) { res.status(500).json({ success: false }); }
});

// EXPERT CREDIT LEDGER
router.get('/credits/expert/:id', protect, async (req, res) => {
  try {
    var User = mongoose.model('User');
    var CreditTx = safeReq('../models/CreditTransaction');
    var user = await User.findById(req.params.id).select('name email credits');
    if (!user) return res.status(404).json({ success: false });
    var transactions = [], summary = { purchased: 0, spent: 0, refunded: 0, bonus: 0, closing: user.credits || 0 };
    if (CreditTx) {
      var from = req.query.from, to = req.query.to;
      var query = { user: req.params.id };
      addDateFilter(query, 'createdAt', from, to);
      transactions = await CreditTx.find(query).populate('relatedRequest', 'title service').populate('relatedClient', 'name').sort({ createdAt: -1 });
      transactions.forEach(function(tx) {
        if (tx.type === 'purchase') summary.purchased += tx.amount;
        if (tx.type === 'spent')    summary.spent += Math.abs(tx.amount);
        if (tx.type === 'refund')   summary.refunded += tx.amount;
        if (tx.type === 'bonus')    summary.bonus += tx.amount;
      });
      summary.opening = summary.purchased + summary.refunded + summary.bonus - summary.spent - summary.closing;
    }
    res.json({ success: true, user: user, transactions: transactions, summary: summary });
  } catch (err) { res.status(500).json({ success: false }); }
});

// TICKETS
router.get('/tickets', protect, async (req, res) => {
  try {
    var Ticket = safeModel('SupportTicket');
    if (!Ticket) return res.json({ success: true, tickets: [] });
    var status = req.query.status, from = req.query.from, to = req.query.to;
    var limit = parseInt(req.query.limit) || 100;
    var query = (status && status !== 'all') ? { status: status } : {};
    addDateFilter(query, 'createdAt', from, to);
    var tickets = await Ticket.find(query).populate('user', 'name email phone credits').sort({ createdAt: -1 }).limit(limit);
    res.json({ success: true, tickets: tickets, total: tickets.length });
  } catch (err) { res.status(500).json({ success: false }); }
});

// APPROVE REFUND
router.post('/tickets/:id/approve', protect, async (req, res) => {
  try {
    var Ticket = safeModel('SupportTicket');
    var User = mongoose.model('User');
    if (!Ticket) return res.status(404).json({ success: false });
    var ticket = await Ticket.findById(req.params.id).populate('user');
    if (!ticket) return res.status(404).json({ success: false });
    if (ticket.status !== 'pending_review') return res.status(400).json({ success: false, message: 'Already processed' });
    var creditsToAdd = ticket.eligibleCredits || 0;
    await User.findByIdAndUpdate(ticket.user._id, { $inc: { credits: creditsToAdd } });
    ticket.status = 'resolved'; ticket.decision = 'REFUND_APPROVED';
    ticket.creditsRefunded = creditsToAdd; ticket.adminNote = req.body.note || ''; ticket.resolvedAt = new Date();
    await ticket.save();
    res.json({ success: true, message: 'Refund approved', creditsAdded: creditsToAdd });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// REJECT REFUND
router.post('/tickets/:id/reject', protect, async (req, res) => {
  try {
    var Ticket = safeModel('SupportTicket');
    if (!Ticket) return res.status(404).json({ success: false });
    var ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false });
    ticket.status = 'resolved'; ticket.decision = 'REFUND_REJECTED';
    ticket.adminNote = req.body.note || ''; ticket.resolvedAt = new Date();
    await ticket.save();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false }); }
});

// USER ACTION
router.post('/users/:id/action', protect, async (req, res) => {
  try {
    var User = mongoose.model('User');
    var action = req.body.action, reason = req.body.reason;
    var user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false });
    var msg = '';
    if      (action === 'ban')    { user.isBanned = true;  user.isFlagged = true;  msg = 'User banned'; }
    else if (action === 'unban')  { user.isBanned = false; user.isFlagged = false; msg = 'User unbanned'; }
    else if (action === 'flag')   { user.isFlagged = true;  msg = 'User flagged'; }
    else if (action === 'unflag') { user.isFlagged = false; msg = 'User unflagged'; }
    else if (action === 'warn')   { user.warnings = (user.warnings || 0) + 1; user.lastWarning = { reason: reason, date: new Date(), by: req.admin.adminId }; msg = 'Warning issued'; }
    else return res.status(400).json({ success: false, message: 'Unknown action' });
    await user.save();
    res.json({ success: true, message: msg, user: { isBanned: user.isBanned, isFlagged: user.isFlagged, warnings: user.warnings } });
  } catch (err) { res.status(500).json({ success: false }); }
});

module.exports = router;
