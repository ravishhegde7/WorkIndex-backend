require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const app = express();

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Database Models
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  phone: { type: String, unique: true },
  password: { type: String, select: false },
  role: String,
  credits: { type: Number, default: 50 },
  emailVerified: { type: Boolean, default: false },
  phoneVerified: { type: Boolean, default: false },
  emailOTP: String,
  phoneOTP: String,
  otpExpiry: Date
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function(pass) {
  return await bcrypt.compare(pass, this.password);
};

userSchema.methods.generateOTP = function() {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  this.otpExpiry = Date.now() + 10 * 60 * 1000;
  return otp;
};

const User = mongoose.model('User', userSchema);

const requestSchema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  title: String,
  service: String,
  description: String,
  answers: Object,
  timeline: String,
  budget: String,
  location: String,
  credits: Number,
  status: { type: String, default: 'pending' },
  responseCount: { type: Number, default: 0 }
}, { timestamps: true });

const Request = mongoose.model('Request', requestSchema);

const approachSchema = new mongoose.Schema({
  request: { type: mongoose.Schema.Types.ObjectId, ref: 'Request' },
  expert: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  message: String,
  creditsSpent: Number,
  clientEmail: String,
  clientPhone: String,
  status: { type: String, default: 'sent' }
}, { timestamps: true });

const Approach = mongoose.model('Approach', approachSchema);

const transactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  type: String,
  credits: Number,
  amount: Number,
  description: String
}, { timestamps: true });

const Transaction = mongoose.model('Transaction', transactionSchema);

// Auth Middleware
const protect = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token) return res.status(401).json({ success: false, message: 'Not authorized' });
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id);
    if (!req.user) return res.status(401).json({ success: false, message: 'User not found' });
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Not authorized' });
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }
  next();
};

// Email helper
const sendEmail = async (email, subject, html) => {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
    await transporter.sendMail({
      from: `WorkIndex <${process.env.EMAIL_USER}>`,
      to: email,
      subject,
      html
    });
    return true;
  } catch (error) {
    console.error('Email error:', error);
    return false;
  }
};

// Routes
const generateToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

// Auth Routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, phone, password, role } = req.body;
    const existing = await User.findOne({ $or: [{ email }, { phone }] });
    if (existing) return res.status(400).json({ success: false, message: 'User exists' });
    
    const user = await User.create({ name, email, phone, password, role });
    const otp = user.generateOTP();
    user.emailOTP = otp;
    await user.save();
    
    await sendEmail(email, 'WorkIndex - Verification Code', `<h2>Your code: ${otp}</h2>`);
    res.json({ success: true, userId: user._id });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    const token = generateToken(user._id);
    res.json({ success: true, token, user: { id: user._id, name: user.name, email: user.email, role: user.role, credits: user.credits } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/auth/verify-email', async (req, res) => {
  try {
    const { userId, otp } = req.body;
    const user = await User.findById(userId);
    if (!user || user.emailOTP !== otp || user.otpExpiry < Date.now()) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }
    user.emailVerified = true;
    user.emailOTP = undefined;
    await user.save();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/auth/send-phone-otp', async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findById(userId);
    const otp = user.generateOTP();
    user.phoneOTP = otp;
    await user.save();
    console.log(`📱 Phone OTP for ${user.phone}: ${otp}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/auth/verify-phone', async (req, res) => {
  try {
    const { userId, otp } = req.body;
    const user = await User.findById(userId);
    if (!user || user.phoneOTP !== otp || user.otpExpiry < Date.now()) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }
    user.phoneVerified = true;
    user.phoneOTP = undefined;
    await user.save();
    const token = generateToken(user._id);
    res.json({ success: true, token, user: { id: user._id, name: user.name, email: user.email, role: user.role, credits: user.credits } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Request Routes
app.post('/api/requests', protect, authorize('client'), async (req, res) => {
  try {
    const { service, title, description, answers, timeline, budget, location } = req.body;
    const credits = { itr: 15, gst: 20, accounting: 25, audit: 30, photography: 18, development: 35 }[service] || 20;
    const request = await Request.create({ client: req.user.id, service, title, description, answers, timeline, budget, location, credits });
    res.json({ success: true, request });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/requests', protect, async (req, res) => {
  try {
    const query = req.user.role === 'client' ? { client: req.user.id } : { status: { $in: ['pending', 'active'] } };
    if (req.query.service && req.query.service !== 'all') query.service = req.query.service;
    const requests = await Request.find(query).sort('-createdAt').populate('client', 'name email phone');
    res.json({ success: true, requests });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/requests/:id/approaches', protect, authorize('client'), async (req, res) => {
  try {
    const approaches = await Approach.find({ request: req.params.id }).populate('expert', 'name');
    res.json({ success: true, approaches });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Approach Routes
app.post('/api/approaches', protect, authorize('expert'), async (req, res) => {
  try {
    const { requestId, message } = req.body;
    const request = await Request.findById(requestId).populate('client');
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    
    const expert = await User.findById(req.user.id);
    if (expert.credits < request.credits) {
      return res.status(400).json({ success: false, message: 'Insufficient credits' });
    }
    
    expert.credits -= request.credits;
    await expert.save();
    
    const approach = await Approach.create({
      request: requestId,
      expert: req.user.id,
      message,
      creditsSpent: request.credits,
      clientEmail: request.client.email,
      clientPhone: request.client.phone
    });
    
    request.responseCount += 1;
    request.status = 'active';
    await request.save();
    
    await Transaction.create({
      user: req.user.id,
      type: 'credit_spend',
      credits: -request.credits,
      amount: 0,
      description: `Unlocked: ${request.title}`
    });
    
    res.json({ success: true, approach, remainingCredits: expert.credits });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/approaches', protect, authorize('expert'), async (req, res) => {
  try {
    const approaches = await Approach.find({ expert: req.user.id }).populate('request').sort('-createdAt');
    res.json({ success: true, approaches });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Credit Routes
app.get('/api/credits/balance', protect, authorize('expert'), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json({ success: true, credits: user.credits });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/credits/add', protect, authorize('expert'), async (req, res) => {
  try {
    const { credits } = req.body;
    const user = await User.findById(req.user.id);
    user.credits += credits;
    await user.save();
    res.json({ success: true, newBalance: user.credits });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// User Routes
app.get('/api/users/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Connect to MongoDB and start server
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch(err => console.error('❌ MongoDB error:', err));
