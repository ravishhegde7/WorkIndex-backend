// routes/admin.js
const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
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

// ===========================================================
// LOGIN
// ===========================================================
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

// ===========================================================
// STATS
// ===========================================================
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
    var openTickets     = Ticket ? await Ticket.countDocuments({ status: 'open' }) : 0;
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
    res.json({ success: true, stats: { totalClients, totalExperts, totalRequests, totalApproaches, openApproaches, closedApproaches, pendingRefunds, openTickets, totalReviews, credits }, recentUsers });
  } catch (err) { console.error('Stats error:', err); res.status(500).json({ success: false }); }
});

// ===========================================================
// ALL USERS  (search by name/email/phone)
// ===========================================================
router.get('/users', protect, async (req, res) => {
  try {
    var User = mongoose.model('User');
    var role = req.query.role, search = req.query.search, from = req.query.from, to = req.query.to;
    var limit = parseInt(req.query.limit) || 100, skip = parseInt(req.query.skip) || 0;
    var query = {};
    if (role && role !== 'all') query.role = role;
    if (search) query.$or = [
      { name:  { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } }
    ];
    addDateFilter(query, 'createdAt', from, to);
    var users = await User.find(query)
      .select('name email phone role credits createdAt lastLogin isFlagged isBanned isApproved isRejected warnings rating reviewCount profile specialization')
      .sort({ createdAt: -1 }).skip(skip).limit(limit);
    var total = await User.countDocuments(query);
    res.json({ success: true, users, total });
  } catch (err) { res.status(500).json({ success: false }); }
});

// ===========================================================
// USER BY ID
// ===========================================================
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
    res.json({ success: true, user, approaches, requests, transactions, tickets, creditSummary });
  } catch (err) { console.error('Get user error:', err); res.status(500).json({ success: false }); }
});

// ===========================================================
// NEW: ADJUST USER CREDITS
// ===========================================================
router.post('/users/:id/credits', protect, async (req, res) => {
  try {
    var User = mongoose.model('User');
    var CreditTx = safeReq('../models/CreditTransaction');
    var { action, amount, reason, type: reqType } = req.body;
    amount = parseInt(amount);
    if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'Invalid amount' });

    var user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    var oldBalance = user.credits || 0;
    var newBalance;
    var txAmount;
    // Use explicit type from frontend if provided; otherwise infer from action
    var txType = reqType || (action === 'add' ? 'refund' : 'adjustment');

    if (action === 'add') {
      newBalance = oldBalance + amount;
      txAmount = amount;
      // Override inferred type only if not explicitly set
      if (!reqType) txType = 'refund';
    } else if (action === 'deduct') {
      newBalance = Math.max(0, oldBalance - amount);
      txAmount = -(amount);
      if (!reqType) txType = 'adjustment';
    } else if (action === 'set') {
      txAmount = amount - oldBalance;
      newBalance = amount;
      if (!reqType) txType = 'adjustment';
    } else {
      return res.status(400).json({ success: false, message: 'Invalid action' });
    }

    user.credits = newBalance;
    await user.save();

    // Log transaction if CreditTransaction model exists
    if (CreditTx) {
      await CreditTx.create({
        user: user._id,
        type: txType,
        amount: txAmount,
        balanceBefore: oldBalance,
        balanceAfter: newBalance,
        description: reason || ('Admin ' + txType + ': ' + (txAmount > 0 ? '+' : '') + txAmount + ' credits'),
        createdBy: 'admin'
      });
    }

    res.json({ success: true, message: 'Credits updated', oldBalance, newBalance });
  } catch (err) { console.error('Credit adjust error:', err); res.status(500).json({ success: false, message: err.message }); }
});

// ===========================================================
// NEW: RESET USER PASSWORD
// ===========================================================
router.post('/users/:id/reset-password', protect, async (req, res) => {
  try {
    var User = mongoose.model('User');
    var { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });

    var user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    var hashed = await bcrypt.hash(newPassword, 12);
    await User.findByIdAndUpdate(req.params.id, { password: hashed });

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) { console.error('Reset PW error:', err); res.status(500).json({ success: false, message: err.message }); }
});

// ===========================================================
// APPROACHES
// ===========================================================
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
    res.json({ success: true, approaches, total });
  } catch (err) { res.status(500).json({ success: false }); }
});

// ===========================================================
// ALL CHATS
// ===========================================================
router.get('/chats', protect, async (req, res) => {
  try {
    var Chat = safeModel('Chat');
    if (!Chat) return res.json({ success: true, chats: [] });
    var from = req.query.from, to = req.query.to;
    var limit = parseInt(req.query.limit) || 100;
    var query = {};
    addDateFilter(query, 'createdAt', from, to);
    var chats = await Chat.find(query).populate('expert', 'name email').populate('client', 'name email').populate('request', 'title service').sort({ updatedAt: -1 }).limit(limit);
    res.json({ success: true, chats, total: chats.length });
  } catch (err) { res.status(500).json({ success: false }); }
});

// CHAT MESSAGES - tries Message collection first, then embedded array
router.get('/chats/:id/messages', protect, async (req, res) => {
  try {
    var Chat = safeModel('Chat');
    var Message = safeModel('Message');
    var messages = [];
    var chatMeta = null;

    // Always fetch chat for metadata (expert/client names)
    if (Chat) {
      try {
        chatMeta = await Chat.findById(req.params.id)
          .populate('expert', 'name role')
          .populate('client', 'name role')
          .populate('request', 'title')
          .lean();
      } catch(e) {}
    }

    // Try Message collection first (separate docs pattern)
    if (Message) {
      try {
        messages = await Message.find({ chat: req.params.id })
          .populate('sender', 'name role profilePhoto')
          .sort({ createdAt: 1 })
          .limit(500);
        messages = messages.map(function(m) { return m.toObject ? m.toObject() : m; });
      } catch(e) {}
    }

    // If no messages found, try embedded messages array in Chat doc
    if (!messages.length && chatMeta && chatMeta.messages && chatMeta.messages.length) {
      // Try to populate embedded sender ObjectIds via User model
      var User = null;
      try { User = mongoose.model('User'); } catch(e) {}

      var senderIds = [];
      chatMeta.messages.forEach(function(m) {
        if (m.sender && typeof m.sender !== 'object') senderIds.push(String(m.sender));
      });

      var senderMap = {};
      if (User && senderIds.length) {
        try {
          var senders = await User.find({ _id: { $in: senderIds } }).select('name role').lean();
          senders.forEach(function(s) { senderMap[String(s._id)] = s; });
        } catch(e) {}
      }

      // Also map expert/client by _id for fallback
      if (chatMeta.expert) senderMap[String(chatMeta.expert._id || chatMeta.expert)] = chatMeta.expert;
      if (chatMeta.client) senderMap[String(chatMeta.client._id || chatMeta.client)] = chatMeta.client;

      messages = chatMeta.messages.map(function(m) {
        var senderId = m.sender ? String(m.sender._id || m.sender) : null;
        var populated = senderId ? (senderMap[senderId] || null) : null;
        return Object.assign({}, m, {
          sender: populated || m.sender,
          senderName: populated ? populated.name : (m.senderName || ''),
          senderRole: populated ? populated.role : (m.senderRole || m.role || '')
        });
      });
    }

    var meta = chatMeta ? {
      expert: chatMeta.expert,
      client: chatMeta.client,
      request: chatMeta.request,
      expertId: chatMeta.expert ? String(chatMeta.expert._id || chatMeta.expert) : null,
      clientId: chatMeta.client ? String(chatMeta.client._id || chatMeta.client) : null
    } : {};

    res.json({ success: true, messages: messages, chat: meta });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET single chat (for fallback)
router.get('/chats/:id', protect, async (req, res) => {
  try {
    var Chat = safeModel('Chat');
    if (!Chat) return res.status(404).json({ success: false });
    var chat = await Chat.findById(req.params.id)
      .populate('expert', 'name role profilePhoto')
      .populate('client', 'name role profilePhoto')
      .populate('request', 'title service')
      .lean();
    if (!chat) return res.status(404).json({ success: false, message: 'Chat not found' });
    res.json({ success: true, chat, messages: chat.messages || [] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ===========================================================
// CREDIT TRANSACTIONS
// ===========================================================
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
    res.json({ success: true, transactions, total });
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
    res.json({ success: true, user, transactions, summary });
  } catch (err) { res.status(500).json({ success: false }); }
});

// ===========================================================
// TICKETS - GET ALL
// ===========================================================
router.get('/tickets', protect, async (req, res) => {
  try {
    var Ticket = safeModel('SupportTicket');
    if (!Ticket) return res.json({ success: true, tickets: [] });
    var status = req.query.status, from = req.query.from, to = req.query.to;
    var limit = parseInt(req.query.limit) || 100;
    var query = (status && status !== 'all') ? { status: status } : {};
    addDateFilter(query, 'createdAt', from, to);
    var tickets = await Ticket.find(query).populate('user', 'name email phone credits').sort({ createdAt: -1 }).limit(limit);
    res.json({ success: true, tickets, total: tickets.length });
  } catch (err) { res.status(500).json({ success: false }); }
});

// ===========================================================
// NEW: TICKET BY ID
// ===========================================================
router.get('/tickets/:id', protect, async (req, res) => {
  try {
    var Ticket = safeModel('SupportTicket');
    if (!Ticket) return res.status(404).json({ success: false, message: 'Ticket model not found' });
    var ticket = await Ticket.findById(req.params.id).populate('user', 'name email phone credits');
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });
    res.json({ success: true, ticket });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// APPROVE REFUND (existing)
router.post('/tickets/:id/approve', protect, async (req, res) => {
  try {
    var Ticket = safeModel('SupportTicket');
    var User = mongoose.model('User');
    var CreditTx = safeReq('../models/CreditTransaction');
    if (!Ticket) return res.status(404).json({ success: false });
    var ticket = await Ticket.findById(req.params.id).populate('user');
    if (!ticket) return res.status(404).json({ success: false });
    if (ticket.status !== 'pending_review') return res.status(400).json({ success: false, message: 'Already processed' });
    var creditsToAdd = ticket.eligibleCredits || 0;
    var user = await User.findById(ticket.user._id);
    user.credits = (user.credits || 0) + creditsToAdd;
    await user.save();
    // Log credit transaction
    if (CreditTx) {
      await CreditTx.create({
        user: user._id,
        type: 'refund',
        amount: creditsToAdd,
        balanceBefore: user.credits - creditsToAdd,
        balanceAfter: user.credits,
        description: 'Admin approved refund for ticket #' + ticket._id
      });
    }
    ticket.status = 'resolved'; ticket.decision = 'REFUND_APPROVED';
    ticket.creditsRefunded = creditsToAdd; ticket.adminNote = req.body.note || ''; ticket.resolvedAt = new Date();
    await ticket.save();
    res.json({ success: true, message: 'Refund approved', creditsAdded: creditsToAdd });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// REJECT REFUND (existing)
router.post('/tickets/:id/reject', protect, async (req, res) => {
  try {
    var Ticket = safeModel('SupportTicket');
    if (!Ticket) return res.status(404).json({ success: false });
    var ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false });
    ticket.status = 'resolved'; ticket.decision = 'REFUND_REJECTED';
    ticket.adminNote = req.body.note || ''; ticket.resolvedAt = new Date();
    await ticket.save();
    res.json({ success: true, message: 'Refund rejected' });
  } catch (err) { res.status(500).json({ success: false }); }
});

// ===========================================================
// NEW: RESOLVE TICKET (non-refund tickets)
// ===========================================================
router.post('/tickets/:id/resolve', protect, async (req, res) => {
  try {
    var Ticket = safeModel('SupportTicket');
    if (!Ticket) return res.status(404).json({ success: false });
    var ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false });
    ticket.status = 'resolved';
    ticket.decision = 'RESOLVED_BY_ADMIN';
    ticket.adminNote = req.body.note || '';
    ticket.resolvedAt = new Date();
    await ticket.save();
    res.json({ success: true, message: 'Ticket resolved' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ===========================================================
// USER ACTION (existing + approve/reject for registrations)
// ===========================================================
router.post('/users/:id/action', protect, async (req, res) => {
  try {
    var User = mongoose.model('User');
    var action = req.body.action, reason = req.body.reason;
    var user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false });
    var msg = '';
    if      (action === 'ban')     { user.isBanned = true;  user.isFlagged = true;   msg = 'User banned'; }
    else if (action === 'unban')   { user.isBanned = false; user.isFlagged = false;  msg = 'User unbanned'; }
    else if (action === 'flag')    { user.isFlagged = true;  msg = 'User flagged'; }
    else if (action === 'unflag')  { user.isFlagged = false; msg = 'User unflagged'; }
    else if (action === 'warn')    { user.warnings = (user.warnings || 0) + 1; user.lastWarning = { reason: reason, date: new Date(), by: req.admin.adminId }; msg = 'Warning issued'; }
    else if (action === 'approve') { user.isApproved = true; user.isRejected = false; msg = 'Expert approved'; }
    else if (action === 'reject')  { user.isRejected = true; user.isApproved = false; msg = 'Expert rejected'; }
    else return res.status(400).json({ success: false, message: 'Unknown action' });
    await user.save();
    res.json({ success: true, message: msg, user: { isBanned: user.isBanned, isFlagged: user.isFlagged, warnings: user.warnings, isApproved: user.isApproved } });
  } catch (err) { res.status(500).json({ success: false }); }
});

// ===========================================================
// NEW: RATINGS / REVIEWS
// ===========================================================
router.get('/ratings', protect, async (req, res) => {
  try {
    var Rating = safeModel('Rating');
    if (!Rating) return res.json({ success: true, ratings: [] });
    var search = req.query.search, from = req.query.from, to = req.query.to;
    var limit = parseInt(req.query.limit) || 100;
    var query = {};
    addDateFilter(query, 'createdAt', from, to);
    var ratings = await Rating.find(query)
      .populate('expert', 'name email')
      .populate('client', 'name email')
      .sort({ createdAt: -1 }).limit(limit);
    // filter by expert name if search
    if (search) {
      search = search.toLowerCase();
      ratings = ratings.filter(function(r) {
        return r.expert && (r.expert.name || '').toLowerCase().includes(search);
      });
    }
    res.json({ success: true, ratings, total: ratings.length });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/ratings/:id', protect, async (req, res) => {
  try {
    var Rating = safeModel('Rating');
    if (!Rating) return res.status(404).json({ success: false });
    var rating = await Rating.findById(req.params.id);
    if (!rating) return res.status(404).json({ success: false, message: 'Review not found' });

    // Update expert's rating average
    if (rating.expert) {
      var User = mongoose.model('User');
      var expert = await User.findById(rating.expert);
      if (expert && expert.reviewCount > 0) {
        expert.totalRatingSum = Math.max(0, (expert.totalRatingSum || 0) - rating.rating);
        expert.reviewCount = Math.max(0, expert.reviewCount - 1);
        expert.rating = expert.reviewCount > 0 ? (expert.totalRatingSum / expert.reviewCount).toFixed(2) : 0;
        await expert.save();
      }
    }

    await Rating.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Review deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ===========================================================
// NEW: POSTS / REQUESTS - EDIT & DELETE
// ===========================================================
router.get('/requests', protect, async (req, res) => {
  try {
    var Request = mongoose.model('Request');
    var search = req.query.search, status = req.query.status, from = req.query.from, to = req.query.to;
    var limit = parseInt(req.query.limit) || 100, skip = parseInt(req.query.skip) || 0;
    var query = {};
    if (status && status !== 'all') query.status = status;
    if (search) query.$or = [
      { title:   { $regex: search, $options: 'i' } },
      { service: { $regex: search, $options: 'i' } }
    ];
    addDateFilter(query, 'createdAt', from, to);
    var requests = await Request.find(query)
      .populate('client', 'name email')
      .sort({ createdAt: -1 }).skip(skip).limit(limit);
    var total = await Request.countDocuments(query);
    // Enrich with credits from accepted/completed approaches
    try {
      var Approach = safeModel('Approach');
      if (Approach) {
        var reqIds = requests.map(function(r) { return r._id; });
        var approaches = await Approach.find({ request: { $in: reqIds } })
          .select('request creditsSpent status').lean();
        var approachMap = {};
        approaches.forEach(function(a) {
          var rid = String(a.request);
          if (a.creditsSpent && (!approachMap[rid] || a.creditsSpent > approachMap[rid])) {
            approachMap[rid] = a.creditsSpent;
          }
        });
                requests = requests.map(function(r) {
          var ro = r.toObject ? r.toObject() : Object.assign({}, r);
          if (!ro.credits && approachMap[String(ro._id)]) ro.credits = approachMap[String(ro._id)];
          return ro;
        });
      }
    } catch(enrichErr) { /* non-fatal */ }
    res.json({ success: true, requests, total });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/requests/:id', protect, async (req, res) => {
  try {
    var Request = mongoose.model('Request');
    var request = await Request.findById(req.params.id).populate('client', 'name email');
    if (!request) return res.status(404).json({ success: false, message: 'Post not found' });
    res.json({ success: true, request });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/requests/:id', protect, async (req, res) => {
  try {
    var Request = mongoose.model('Request');
    var { title, description, status, creditsRequired } = req.body;
    // Only update fields that were explicitly sent ? prevents accidental status override
    var updateFields = {};
    if (title       !== undefined) updateFields.title           = title;
    if (description !== undefined) updateFields.description     = description;
    if (status      !== undefined && status !== '') updateFields.status = status;
        if (creditsRequired !== undefined && creditsRequired !== null) updateFields.credits = parseInt(creditsRequired) || 0;
    var request = await Request.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true }
    );
    if (!request) return res.status(404).json({ success: false, message: 'Post not found' });
    res.json({ success: true, message: 'Post updated', request });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/requests/:id', protect, async (req, res) => {
  try {
    var Request = mongoose.model('Request');
    var request = await Request.findByIdAndDelete(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: 'Post not found' });
    res.json({ success: true, message: 'Post deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ===========================================================
// NEW: FAILED PAYMENTS
// ===========================================================
router.get('/payments/failed', protect, async (req, res) => {
  try {
    var FailedPayment = safeModel('FailedPayment');
    if (!FailedPayment) return res.json({ success: true, payments: [], message: 'FailedPayment model not loaded yet' });
    var from = req.query.from, to = req.query.to;
    var limit = parseInt(req.query.limit) || 100;
    var query = {};
    addDateFilter(query, 'createdAt', from, to);
    var payments = await FailedPayment.find(query).populate('user', 'name email phone').sort({ createdAt: -1 }).limit(limit);
    res.json({ success: true, payments, total: payments.length });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ===========================================================
// NEW: COMMUNICATIONS - BULK EMAIL / HISTORY
// ===========================================================
router.post('/communications/send', protect, async (req, res) => {
  try {
    var User = mongoose.model('User');
    var CommLog = safeModel('CommunicationLog');
    var { subject, message, target, emails } = req.body;
    if (!subject || !message) return res.status(400).json({ success: false, message: 'Subject and message required' });

    var recipients = [];
    if (target === 'all') {
      recipients = await User.find({ isActive: true }).select('email name');
    } else if (target === 'experts') {
      recipients = await User.find({ role: 'expert', isActive: true }).select('email name');
    } else if (target === 'clients') {
      recipients = await User.find({ role: 'client', isActive: true }).select('email name');
    } else if (target === 'custom' && emails && emails.length) {
      recipients = emails.map(function(e) { return { email: e, name: e }; });
    }

    // Log the communication
    if (CommLog) {
      await CommLog.create({
        subject,
        message,
        target,
        recipientCount: recipients.length,
        sentBy: req.admin.adminId,
        recipientEmails: recipients.slice(0, 50).map(function(r) { return r.email; }) // store first 50
      });
    }

    // NOTE: Plug in your email provider here (Nodemailer / SendGrid / AWS SES)
    // For now we return success with recipient count
    // Example with nodemailer (add to your setup):
    // const transporter = nodemailer.createTransporter({...});
    // for (const r of recipients) { await transporter.sendMail({ to: r.email, subject, html: message }); }

    res.json({ success: true, message: 'Communication logged. Connect email provider to send.', recipientCount: recipients.length });
  } catch (err) { console.error('Comm error:', err); res.status(500).json({ success: false, message: err.message }); }
});

router.get('/communications/history', protect, async (req, res) => {
  try {
    var CommLog = safeModel('CommunicationLog');
    if (!CommLog) return res.json({ success: true, logs: [] });
    var logs = await CommLog.find({}).sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, logs });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ===========================================================
// NEW: DIRECT MESSAGE (admin ? user inbox)
// ===========================================================
router.post('/users/:id/dm', protect, async (req, res) => {
  try {
    var User = mongoose.model('User');
    var Notification = safeModel('Notification');
    var CommLog = safeModel('CommunicationLog');
    var { message } = req.body;
    if (!message) return res.status(400).json({ success: false, message: 'Message required' });

    var user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (Notification) {
      await Notification.create({
        user: user._id,
        title: 'Message from WorkIndex Admin',
        message: message,
        type: 'admin_dm',
        isRead: false,
        sentBy: 'admin'
      });
    }

    if (CommLog) {
      await CommLog.create({
        type: 'dm',
        subject: 'Direct Message',
        message: message,
        target: 'custom',
        recipientCount: 1,
        recipientEmails: [user.email],
        sentBy: req.admin.adminId
      });
    }

    res.json({ success: true, message: 'Message sent to ' + user.name });
  } catch (err) {
    console.error('DM error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});


// ===========================================================
// NEW: ANNOUNCEMENTS (bell notification to users)
// ===========================================================
router.post('/communications/announce', protect, async (req, res) => {
  try {
    var User = mongoose.model('User');
    var CommLog = safeModel('CommunicationLog');
    var Notification = safeModel('Notification');
    var { target, title, message } = req.body;
    if (!title || !message) return res.status(400).json({ success: false, message: 'Title and message required' });

    var query = { isActive: true };
    if (target === 'experts') query.role = 'expert';
    else if (target === 'clients') query.role = 'client';
    var recipients = await User.find(query).select('_id email name');

    // Create a Notification document for each user (if model exists)
    if (Notification) {
      var notifications = recipients.map(function(u) {
        return { user: u._id, title: title, message: message, type: 'announcement', isRead: false, sentBy: 'admin' };
      });
      // Insert in batches of 500
      for (var i = 0; i < notifications.length; i += 500) {
        await Notification.insertMany(notifications.slice(i, i + 500), { ordered: false });
      }
    }

    // Log it
    if (CommLog) {
      await CommLog.create({
        type: 'announcement',
        subject: title,
        message: message,
        target: target || 'all',
        recipientCount: recipients.length,
        sentBy: req.admin.adminId
      });
    }

    res.json({ success: true, message: 'Announcement sent', recipientCount: recipients.length });
  } catch (err) { console.error('Announce error:', err); res.status(500).json({ success: false, message: err.message }); }
});


// ===========================================================
// APPROACHES ? UPDATE STATUS & DELETE
// ===========================================================
router.put('/approaches/:id', protect, async (req, res) => {
  try {
    var Approach = safeModel('Approach');
    if (!Approach) return res.status(503).json({ success: false, message: 'Approach model not available' });
    var { status } = req.body;
    var validStatuses = ['pending', 'accepted', 'rejected', 'completed'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status: ' + status });
    }
    var approach = await Approach.findByIdAndUpdate(
      req.params.id,
      { $set: { status: status } },
      { new: true }
    ).populate('expert', 'name').populate('client', 'name').lean();
    if (!approach) return res.status(404).json({ success: false, message: 'Approach not found' });
    res.json({ success: true, message: 'Approach updated to ' + status, approach });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/approaches/:id', protect, async (req, res) => {
  try {
    var Approach = safeModel('Approach');
    if (!Approach) return res.status(503).json({ success: false, message: 'Approach model not available' });
    var approach = await Approach.findByIdAndDelete(req.params.id);
    if (!approach) return res.status(404).json({ success: false, message: 'Approach not found' });
    res.json({ success: true, message: 'Approach deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


router.get('/chats/:id/messages', protect, async (req, res) => {
  try {
    var Chat = safeModel('Chat');
    var Message = safeModel('Message');
    if (!Chat) return res.json({ success: true, messages: [] });

    var chat = await Chat.findById(req.params.id)
      .populate({ path: 'expert', select: 'name profilePhoto role' })
      .populate({ path: 'client', select: 'name profilePhoto role' })
      .populate({ path: 'request', select: 'title service' })
      .lean();

    if (!chat) return res.status(404).json({ success: false, message: 'Chat not found' });

    var messages = [];

    // Pattern 1: messages are embedded array in Chat doc
    if (chat.messages && chat.messages.length > 0) {
      // Populate sender refs if they are ObjectIds
      var populatedChat = await Chat.findById(req.params.id)
        .populate({ path: 'messages.sender', select: 'name role profilePhoto' })
        .lean();
      messages = populatedChat.messages || [];
    }

    // Pattern 2: messages are in separate Message collection
    if (messages.length === 0 && Message) {
      try {
        messages = await Message.find({ chat: req.params.id })
          .populate('sender', 'name role profilePhoto')
          .sort('createdAt')
          .lean();
      } catch (e) { /* Message model not found */ }
    }

    res.json({ success: true, messages: messages, chat: chat });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ===========================================================
// TICKETS ? CREATE ON BEHALF OF USER (admin action)
// ===========================================================
router.post('/tickets/create-for-user', protect, async (req, res) => {
  try {
    var Ticket = safeModel('SupportTicket') || safeReq('../models/SupportTicket') || safeReq('../models/Ticket');
if (!Ticket) return res.status(503).json({ success: false, message: 'Ticket model not found - check model filename' });
    var User = mongoose.model('User');
    var { userId, subject, description, priority, adminNote } = req.body;
    if (!userId || !subject) {
      return res.status(400).json({ success: false, message: 'userId and subject are required' });
    }
    var user = await User.findById(userId).lean();
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    var ticketData = {
      issueType: subject,
      subject: subject,
      description: description || subject,
      priority: priority || 'medium',
      status: 'open',
      createdByAdmin: true,
      adminNote: adminNote || '',
      createdBy: req.admin.adminId
    };
    // Always set user field; also set expert field if expert
    ticketData.user = userId;
    if (user.role === 'expert') ticketData.expert = userId;

    var ticket = await Ticket.create(ticketData);
    res.status(201).json({ success: true, message: 'Ticket created', ticket });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ===========================================================
// SETTINGS ? Password change + Danger zone + Stats
// ===========================================================
router.post('/settings/change-password', protect, async (req, res) => {
  try {
    var { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Both passwords required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters' });
    }
    var admin = await Admin.findById(req.admin._id).select('+password');
    var match = await admin.matchPassword(currentPassword);
    if (!match) return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    admin.password = await bcrypt.hash(newPassword, 12);
    await admin.save();
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/settings/danger/:action', protect, async (req, res) => {
  try {
    var action = req.params.action;
    var CommLog = safeModel('CommunicationLog');
    var FailedPayment = safeModel('FailedPayment');
    var deleted = 0;

    if (action === 'clearLogs' && CommLog) {
      var cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      var result = await CommLog.deleteMany({ createdAt: { $lt: cutoff } });
      deleted = result.deletedCount;
      res.json({ success: true, message: 'Cleared ' + deleted + ' communication logs older than 90 days' });
    } else if (action === 'clearFailedPayments' && FailedPayment) {
      var result2 = await FailedPayment.deleteMany({});
      deleted = result2.deletedCount;
      res.json({ success: true, message: 'Cleared ' + deleted + ' failed payment records' });
    } else {
      res.status(400).json({ success: false, message: 'Unknown action or model unavailable: ' + action });
    }
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
