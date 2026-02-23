// routes/admin.js — Full featured admin backend
const express  = require(‘express’);
const router   = express.Router();
const jwt      = require(‘jsonwebtoken’);
const mongoose = require(‘mongoose’);
const Admin    = require(’../models/Admin’);

// ─── ADMIN AUTH MIDDLEWARE ───
const adminProtect = async (req, res, next) => {
try {
const token = req.headers.authorization?.replace(’Bearer ’, ‘’);
if (!token) return res.status(401).json({ success: false, message: ‘No token’ });
const decoded = jwt.verify(token, process.env.JWT_SECRET);
if (!decoded.isAdmin) return res.status(403).json({ success: false, message: ‘Not admin’ });
req.admin = await Admin.findById(decoded.id);
if (!req.admin || !req.admin.isActive) return res.status(403).json({ success: false, message: ‘Admin not found’ });
next();
} catch (e) {
res.status(401).json({ success: false, message: ‘Invalid token’ });
}
};

// ─── HELPERS ───
function dateFilter(query, field, from, to) {
if (from || to) {
query[field] = {};
if (from) query[field].$gte = new Date(from);
if (to)   query[field].$lte = new Date(new Date(to).setHours(23,59,59,999));
}
return query;
}

// ═══════════════════════════════════════════════════════════
//  POST /api/admin/login
// ═══════════════════════════════════════════════════════════
router.post(’/login’, async (req, res) => {
try {
const { adminId, password } = req.body;
if (!adminId || !password)
return res.status(400).json({ success: false, message: ‘Admin ID and password required’ });

```
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
  success: true, token,
  admin: { id: admin._id, name: admin.name, adminId: admin.adminId, role: admin.role }
});
```

} catch (err) {
res.status(500).json({ success: false, message: ‘Login failed’ });
}
});

// ═══════════════════════════════════════════════════════════
//  GET /api/admin/stats — Full dashboard stats with date filter
// ═══════════════════════════════════════════════════════════
router.get(’/stats’, adminProtect, async (req, res) => {
try {
const { from, to } = req.query;
const User     = mongoose.model(‘User’);
const Request  = mongoose.model(‘Request’);
const Approach = require(’../models/Approach’);

```
let CreditTransaction = null, SupportTicket = null;
try { CreditTransaction = require('../models/CreditTransaction'); } catch(e) {}
try { SupportTicket = mongoose.models.SupportTicket; } catch(e) {}

const dateQ = {};
if (from || to) {
  dateQ.createdAt = {};
  if (from) dateQ.createdAt.$gte = new Date(from);
  if (to)   dateQ.createdAt.$lte = new Date(new Date(to).setHours(23,59,59,999));
}

const [
  totalClients, totalExperts, totalRequests, totalApproaches,
  openApproaches, closedApproaches, pendingRefunds,
  totalReviews, recentUsers
] = await Promise.all([
  User.countDocuments({ role: 'client', ...dateQ }),
  User.countDocuments({ role: 'expert', ...dateQ }),
  Request.countDocuments({ ...dateQ }),
  Approach.countDocuments({ ...dateQ }),
  Approach.countDocuments({ status: 'pending', ...dateQ }),
  Approach.countDocuments({ status: { $in: ['accepted','rejected'] }, ...dateQ }),
  SupportTicket ? SupportTicket.countDocuments({ status: 'pending_review' }) : 0,
  mongoose.models.Rating ? mongoose.models.Rating.countDocuments({ ...dateQ }) : 0,
  User.find({ ...dateQ }).sort({ createdAt: -1 }).limit(5)
    .select('name email role createdAt credits')
]);

// Credit stats
let creditStats = { totalPurchased: 0, totalSpent: 0, totalRefunded: 0, totalRevenue: 0 };
if (CreditTransaction) {
  const txQ = { ...dateQ };
  const agg = await CreditTransaction.aggregate([
    { $match: txQ },
    { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } }
  ]);
  agg.forEach(a => {
    if (a._id === 'purchase') { creditStats.totalPurchased = a.total; creditStats.purchaseCount = a.count; }
    if (a._id === 'spent')    { creditStats.totalSpent = Math.abs(a.total); creditStats.spentCount = a.count; }
    if (a._id === 'refund')   { creditStats.totalRefunded = a.total; creditStats.refundCount = a.count; }
  });
  // Estimate revenue: each credit = ₹1 (adjust as needed)
  creditStats.totalRevenue = creditStats.totalPurchased;
}

res.json({
  success: true,
  stats: {
    totalClients, totalExperts, totalRequests,
    totalApproaches, openApproaches, closedApproaches,
    pendingRefunds, totalReviews, credits: creditStats
  },
  recentUsers
});
```

} catch (err) {
console.error(‘Stats error:’, err);
res.status(500).json({ success: false });
}
});

// ═══════════════════════════════════════════════════════════
//  GET /api/admin/users — All users with filters
// ═══════════════════════════════════════════════════════════
router.get(’/users’, adminProtect, async (req, res) => {
try {
const User = mongoose.model(‘User’);
const { role, search, from, to, limit = 100, skip = 0 } = req.query;
const query = {};
if (role && role !== ‘all’) query.role = role;
if (search) {
query.$or = [
{ name:  { $regex: search, $options: ‘i’ } },
{ email: { $regex: search, $options: ‘i’ } },
{ phone: { $regex: search, $options: ‘i’ } }
];
}
dateFilter(query, ‘createdAt’, from, to);

```
const [users, total] = await Promise.all([
  User.find(query)
    .select('name email phone role credits createdAt lastLogin isFlagged isBanned isVerified location profile rating reviewCount')
    .sort({ createdAt: -1 })
    .skip(parseInt(skip)).limit(parseInt(limit)),
  User.countDocuments(query)
]);
res.json({ success: true, users, total });
```

} catch (err) {
res.status(500).json({ success: false });
}
});

// ═══════════════════════════════════════════════════════════
//  GET /api/admin/users/:id — Full user profile drill-down
// ═══════════════════════════════════════════════════════════
router.get(’/users/:id’, adminProtect, async (req, res) => {
try {
const User     = mongoose.model(‘User’);
const Approach = require(’../models/Approach’);
const Request  = mongoose.model(‘Request’);
let CreditTransaction = null, SupportTicket = null, Chat = null, Rating = null;
try { CreditTransaction = require(’../models/CreditTransaction’); } catch(e) {}
try { SupportTicket = mongoose.models.SupportTicket; } catch(e) {}
try { Chat = mongoose.models.Chat; } catch(e) {}
try { Rating = mongoose.models.Rating; } catch(e) {}

```
const userId = req.params.id;
const { from, to } = req.query;
const dateQ = {};
if (from || to) {
  dateQ.createdAt = {};
  if (from) dateQ.createdAt.$gte = new Date(from);
  if (to)   dateQ.createdAt.$lte = new Date(new Date(to).setHours(23,59,59,999));
}

const [user, approaches, requests, tickets, ratings] = await Promise.all([
  User.findById(userId).select('-password'),
  Approach.find({ expert: userId, ...dateQ })
    .populate('request', 'title service createdAt status')
    .populate('client',  'name email phone')
    .sort({ createdAt: -1 }).limit(50),
  Request.find({ client: userId, ...dateQ }).sort({ createdAt: -1 }).limit(30),
  SupportTicket ? SupportTicket.find({ user: userId }).sort({ createdAt: -1 }).limit(20) : [],
  Rating ? Rating.find({ $or: [{ expert: userId }, { client: userId }] })
    .populate('client', 'name').populate('expert', 'name')
    .sort({ createdAt: -1 }).limit(20) : []
]);

if (!user) return res.status(404).json({ success: false, message: 'User not found' });

// Credit transactions
let transactions = [];
if (CreditTransaction) {
  const txQ = { user: userId, ...dateQ };
  transactions = await CreditTransaction.find(txQ)
    .populate('relatedRequest', 'title')
    .populate('relatedClient',  'name')
    .sort({ createdAt: -1 }).limit(50);
}

// Credit summary for expert
let creditSummary = null;
if (user.role === 'expert' && CreditTransaction) {
  const agg = await CreditTransaction.aggregate([
    { $match: { user: new mongoose.Types.ObjectId(userId) } },
    { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } }
  ]);
  creditSummary = { purchased: 0, spent: 0, refunded: 0, bonus: 0 };
  agg.forEach(a => {
    if (a._id === 'purchase') creditSummary.purchased = a.total;
    if (a._id === 'spent')    creditSummary.spent     = Math.abs(a.total);
    if (a._id === 'refund')   creditSummary.refunded  = a.total;
    if (a._id === 'bonus')    creditSummary.bonus     = a.total;
  });
  creditSummary.closing = (user.credits || 0);
  creditSummary.opening = creditSummary.purchased + creditSummary.bonus - creditSummary.spent + creditSummary.refunded - creditSummary.closing;
}

res.json({ success: true, user, approaches, requests, transactions, tickets, ratings, creditSummary });
```

} catch (err) {
console.error(‘Get user error:’, err);
res.status(500).json({ success: false });
}
});

// ═══════════════════════════════════════════════════════════
//  GET /api/admin/approaches — All approaches with filters
// ═══════════════════════════════════════════════════════════
router.get(’/approaches’, adminProtect, async (req, res) => {
try {
const Approach = require(’../models/Approach’);
const { status, from, to, limit = 100, skip = 0 } = req.query;
const query = {};
if (status && status !== ‘all’) query.status = status;
dateFilter(query, ‘createdAt’, from, to);

```
const [approaches, total] = await Promise.all([
  Approach.find(query)
    .populate('expert',  'name email phone')
    .populate('client',  'name email')
    .populate('request', 'title service')
    .sort({ createdAt: -1 })
    .skip(parseInt(skip)).limit(parseInt(limit)),
  Approach.countDocuments(query)
]);
res.json({ success: true, approaches, total });
```

} catch (err) {
res.status(500).json({ success: false });
}
});

// ═══════════════════════════════════════════════════════════
//  GET /api/admin/chats — All chats
// ═══════════════════════════════════════════════════════════
router.get(’/chats’, adminProtect, async (req, res) => {
try {
const Chat = mongoose.models.Chat;
if (!Chat) return res.json({ success: true, chats: [] });
const { from, to, limit = 100, skip = 0 } = req.query;
const query = {};
dateFilter(query, ‘createdAt’, from, to);

```
const chats = await Chat.find(query)
  .populate('expert',  'name email')
  .populate('client',  'name email')
  .populate('request', 'title service')
  .sort({ updatedAt: -1 })
  .skip(parseInt(skip)).limit(parseInt(limit));

res.json({ success: true, chats, total: chats.length });
```

} catch (err) {
res.status(500).json({ success: false });
}
});

// ═══════════════════════════════════════════════════════════
//  GET /api/admin/chats/:id/messages — Messages in a chat
// ═══════════════════════════════════════════════════════════
router.get(’/chats/:id/messages’, adminProtect, async (req, res) => {
try {
const Message = mongoose.models.Message;
if (!Message) return res.json({ success: true, messages: [] });
const messages = await Message.find({ chat: req.params.id })
.populate(‘sender’, ‘name role’)
.sort({ createdAt: 1 })
.limit(200);
res.json({ success: true, messages });
} catch (err) {
res.status(500).json({ success: false });
}
});

// ═══════════════════════════════════════════════════════════
//  GET /api/admin/credits — Credit transactions with date filter
// ═══════════════════════════════════════════════════════════
router.get(’/credits’, adminProtect, async (req, res) => {
try {
let CreditTransaction = null;
try { CreditTransaction = require(’../models/CreditTransaction’); } catch(e) {}
if (!CreditTransaction) return res.json({ success: true, transactions: [], total: 0 });

```
const { type, from, to, expertId, limit = 100, skip = 0 } = req.query;
const query = {};
if (type && type !== 'all') query.type = type;
if (expertId) query.user = expertId;
dateFilter(query, 'createdAt', from, to);

const [transactions, total] = await Promise.all([
  CreditTransaction.find(query)
    .populate('user',           'name email role')
    .populate('relatedRequest', 'title service')
    .populate('relatedClient',  'name')
    .sort({ createdAt: -1 })
    .skip(parseInt(skip)).limit(parseInt(limit)),
  CreditTransaction.countDocuments(query)
]);
res.json({ success: true, transactions, total });
```

} catch (err) {
res.status(500).json({ success: false });
}
});

// ═══════════════════════════════════════════════════════════
//  GET /api/admin/credits/expert/:id — Expert credit ledger
// ═══════════════════════════════════════════════════════════
router.get(’/credits/expert/:id’, adminProtect, async (req, res) => {
try {
const User = mongoose.model(‘User’);
let CreditTransaction = null;
try { CreditTransaction = require(’../models/CreditTransaction’); } catch(e) {}

```
const user = await User.findById(req.params.id).select('name email credits');
if (!user) return res.status(404).json({ success: false });

let transactions = [], summary = { purchased: 0, spent: 0, refunded: 0, bonus: 0 };
if (CreditTransaction) {
  const { from, to } = req.query;
  const query = { user: req.params.id };
  dateFilter(query, 'createdAt', from, to);
  transactions = await CreditTransaction.find(query)
    .populate('relatedRequest', 'title service')
    .populate('relatedClient',  'name')
    .sort({ createdAt: -1 });

  transactions.forEach(tx => {
    if (tx.type === 'purchase') summary.purchased += tx.amount;
    if (tx.type === 'spent')    summary.spent     += Math.abs(tx.amount);
    if (tx.type === 'refund')   summary.refunded  += tx.amount;
    if (tx.type === 'bonus')    summary.bonus     += tx.amount;
  });
}
summary.closing = user.credits || 0;

res.json({ success: true, user, transactions, summary });
```

} catch (err) {
res.status(500).json({ success: false });
}
});

// ═══════════════════════════════════════════════════════════
//  GET /api/admin/tickets — Support tickets
// ═══════════════════════════════════════════════════════════
router.get(’/tickets’, adminProtect, async (req, res) => {
try {
const SupportTicket = mongoose.models.SupportTicket;
if (!SupportTicket) return res.json({ success: true, tickets: [] });
const { status, from, to, limit = 100 } = req.query;
const query = status && status !== ‘all’ ? { status } : {};
dateFilter(query, ‘createdAt’, from, to);

```
const tickets = await SupportTicket.find(query)
  .populate('user', 'name email phone credits')
  .sort({ createdAt: -1 }).limit(parseInt(limit));
res.json({ success: true, tickets, total: tickets.length });
```

} catch (err) {
res.status(500).json({ success: false });
}
});

// ═══════════════════════════════════════════════════════════
//  POST /api/admin/tickets/:id/approve
// ═══════════════════════════════════════════════════════════
router.post(’/tickets/:id/approve’, adminProtect, async (req, res) => {
try {
const { note } = req.body;
const SupportTicket = mongoose.models.SupportTicket;
const User = mongoose.model(‘User’);
const ticket = await SupportTicket.findById(req.params.id).populate(‘user’);
if (!ticket) return res.status(404).json({ success: false });
if (ticket.status !== ‘pending_review’)
return res.status(400).json({ success: false, message: ‘Already processed’ });

```
const creditsToAdd = ticket.eligibleCredits || 0;
await User.findByIdAndUpdate(ticket.user._id, { $inc: { credits: creditsToAdd } });

ticket.status = 'resolved'; ticket.decision = 'REFUND_APPROVED';
ticket.creditsRefunded = creditsToAdd; ticket.adminNote = note || '';
ticket.resolvedAt = new Date();
await ticket.save();

res.json({ success: true, message: `Refund of ${creditsToAdd} credits approved`, creditsAdded: creditsToAdd });
```

} catch (err) {
res.status(500).json({ success: false, message: err.message });
}
});

// ═══════════════════════════════════════════════════════════
//  POST /api/admin/tickets/:id/reject
// ═══════════════════════════════════════════════════════════
router.post(’/tickets/:id/reject’, adminProtect, async (req, res) => {
try {
const { note } = req.body;
const SupportTicket = mongoose.models.SupportTicket;
const ticket = await SupportTicket.findById(req.params.id);
if (!ticket) return res.status(404).json({ success: false });
ticket.status = ‘resolved’; ticket.decision = ‘REFUND_REJECTED’;
ticket.adminNote = note || ‘’; ticket.resolvedAt = new Date();
await ticket.save();
res.json({ success: true });
} catch (err) {
res.status(500).json({ success: false });
}
});

// ═══════════════════════════════════════════════════════════
//  POST /api/admin/users/:id/action — Ban/warn/unflag/unban
// ═══════════════════════════════════════════════════════════
router.post(’/users/:id/action’, adminProtect, async (req, res) => {
try {
const User = mongoose.model(‘User’);
const { action, reason } = req.body;
const user = await User.findById(req.params.id);
if (!user) return res.status(404).json({ success: false });

```
let msg = '';
switch (action) {
  case 'ban':    user.isBanned  = true;  user.isFlagged = true;  msg = 'User banned'; break;
  case 'unban':  user.isBanned  = false; user.isFlagged = false; msg = 'User unbanned'; break;
  case 'flag':   user.isFlagged = true;  msg = 'User flagged'; break;
  case 'unflag': user.isFlagged = false; msg = 'User unflagged'; break;
  case 'warn':
    user.warnings = (user.warnings || 0) + 1;
    user.lastWarning = { reason, date: new Date(), by: req.admin.adminId };
    msg = 'Warning issued'; break;
  default: return res.status(400).json({ success: false, message: 'Unknown action' });
}
await user.save();
res.json({ success: true, message: msg, user: { isBanned: user.isBanned, isFlagged: user.isFlagged, warnings: user.warnings } });
```

} catch (err) {
res.status(500).json({ success: false });
}
});

// ═══════════════════════════════════════════════════════════
//  POST /api/admin/seed — Create admin (run once)
// ═══════════════════════════════════════════════════════════
router.post(’/seed’, async (req, res) => {
try {
const existing = await Admin.findOne({ adminId: ‘admin_workindex’ });
if (existing) return res.json({ success: false, message: ‘Admin already exists’ });
const admin = await Admin.create({ adminId: ‘admin_workindex’, name: ‘WorkIndex Admin’, password: ‘Admin@1234’, role: ‘superadmin’ });
res.json({ success: true, message: ‘Admin created’, adminId: admin.adminId });
} catch (err) {
res.status(500).json({ success: false, message: err.message });
}
});

module.exports = router;
