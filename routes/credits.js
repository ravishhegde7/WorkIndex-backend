const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

// ⭐ UPDATED: Credit packs with better pricing
const CREDIT_PACKS = [
  { 
    id: 'starter',
    credits: 20, 
    price: 600,
    pricePerCredit: 30,
    savings: 0,
    popular: false
  },
  { 
    id: 'basic',
    credits: 50, 
    price: 1500,
    pricePerCredit: 30,
    savings: 0,
    popular: false
  },
  { 
    id: 'popular',
    credits: 100, 
    price: 2700,
    pricePerCredit: 27,
    savings: 10,
    popular: true
  },
  { 
    id: 'pro',
    credits: 200, 
    price: 4800,
    pricePerCredit: 24,
    savings: 20,
    popular: false
  }
];

// Get credit balance
router.get('/balance', protect, authorize('expert'), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json({ 
      success: true, 
      credits: user.credits 
    });
  } catch (error) {
    console.error('Get balance error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching balance' 
    });
  }
});

// Get available credit packs
router.get('/packs', (req, res) => {
  res.json({ 
    success: true, 
    packs: CREDIT_PACKS 
  });
});

// Get transaction history
router.get('/transactions', protect, authorize('expert'), async (req, res) => {
  try {
    const { 
      type,
      page = 1,
      limit = 50
    } = req.query;
    
    const query = { user: req.user.id };
    if (type) query.type = type;
    
    const skip = (page - 1) * limit;
    
    const transactions = await Transaction.find(query)
      .sort('-createdAt')
      .skip(skip)
      .limit(parseInt(limit))
      .populate('relatedApproach')
      .lean();
    
    const total = await Transaction.countDocuments(query);
    
    res.json({ 
      success: true, 
      count: transactions.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      transactions 
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching transactions' 
    });
  }
});

// ⭐ NEW: Initiate payment for credits (UPI mockup)
router.post('/purchase/initiate', protect, authorize('expert'), async (req, res) => {
  try {
    const { packId } = req.body;
    
    const pack = CREDIT_PACKS.find(p => p.id === packId);
    if (!pack) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid pack selected' 
      });
    }
    
    // Create pending transaction
    const transaction = await Transaction.create({
      user: req.user.id,
      type: 'credit_purchase',
      amount: pack.price,
      credits: pack.credits,
      paymentStatus: 'pending',
      paymentMethod: 'upi',
      description: `Purchase of ${pack.credits} credits`,
      metadata: {
        packId: pack.id,
        pricePerCredit: pack.pricePerCredit
      }
    });
    
    // ⭐ Mockup: Generate fake UPI payment link
    const mockupUpiLink = `upi://pay?pa=workindex@upi&pn=WorkIndex&am=${pack.price}&tn=Purchase${pack.credits}Credits&cu=INR`;
    
    res.json({
      success: true,
      message: 'Payment initiated',
      transaction: {
        id: transaction._id,
        amount: pack.price,
        credits: pack.credits,
        status: 'pending'
      },
      payment: {
        method: 'upi',
        qrCode: mockupUpiLink, // In real app, generate QR code image
        upiLink: mockupUpiLink,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
      }
    });
  } catch (error) {
    console.error('Initiate payment error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error initiating payment' 
    });
  }
});

// ⭐ NEW: Verify payment (mockup - auto-approve for demo)
router.post('/purchase/verify', protect, authorize('expert'), async (req, res) => {
  try {
    const { transactionId } = req.body;
    
    const transaction = await Transaction.findById(transactionId);
    
    if (!transaction) {
      return res.status(404).json({ 
        success: false, 
        message: 'Transaction not found' 
      });
    }
    
    if (transaction.user.toString() !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized' 
      });
    }
    
    if (transaction.paymentStatus === 'success') {
      return res.status(400).json({ 
        success: false, 
        message: 'Payment already verified' 
      });
    }
    
    // ⭐ MOCKUP: Auto-approve (in production, verify with payment gateway)
    transaction.paymentStatus = 'success';
    transaction.paymentVerifiedAt = Date.now();
    await transaction.save();
    
    // Add credits to user
    const user = await User.findById(req.user.id);
    user.credits += transaction.credits;
    await user.save();
    
    res.json({
      success: true,
      message: `${transaction.credits} credits added successfully!`,
      newBalance: user.credits,
      transaction: {
        id: transaction._id,
        credits: transaction.credits,
        amount: transaction.amount,
        status: 'success'
      }
    });
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error verifying payment' 
    });
  }
});

// ⭐ UPDATED: Manual credit addition (for testing/admin)
router.post('/add', protect, authorize('expert'), async (req, res) => {
  try {
    const { credits } = req.body;
    
    if (!credits || credits <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid credit amount' 
      });
    }
    
    const user = await User.findById(req.user.id);
    user.credits += credits;
    await user.save();
    
    await Transaction.create({
      user: req.user.id,
      type: 'credit_purchase',
      amount: 0,
      credits: credits,
      paymentStatus: 'success',
      paymentMethod: 'manual',
      description: 'Manual credit addition (test/demo)'
    });
    
    res.json({ 
      success: true, 
      message: `${credits} credits added`, 
      newBalance: user.credits 
    });
  } catch (error) {
    console.error('Add credits error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error adding credits' 
    });
  }
});

// ⭐ NEW: Deduct credits (used when expert sends approach)
router.post('/deduct', protect, authorize('expert'), async (req, res) => {
  try {
    const { credits, approachId, description } = req.body;
    
    if (!credits || credits <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid credit amount' 
      });
    }
    
    const user = await User.findById(req.user.id);
    
    if (user.credits < credits) {
      return res.status(400).json({ 
        success: false, 
        message: 'Insufficient credits' 
      });
    }
    
    user.credits -= credits;
    await user.save();
    
    await Transaction.create({
      user: req.user.id,
      type: 'approach_sent',
      amount: 0,
      credits: -credits,
      paymentStatus: 'success',
      description: description || 'Credits spent on approach',
      relatedApproach: approachId
    });
    
    res.json({ 
      success: true, 
      message: `${credits} credits deducted`, 
      newBalance: user.credits 
    });
  } catch (error) {
    console.error('Deduct credits error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error deducting credits' 
    });
  }
});

// ⭐ NEW: Get credit statistics
router.get('/stats', protect, authorize('expert'), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    const transactions = await Transaction.find({ user: req.user.id });
    
    const stats = {
      currentBalance: user.credits,
      totalPurchased: 0,
      totalSpent: 0,
      totalTransactions: transactions.length
    };
    
    transactions.forEach(t => {
      if (t.type === 'credit_purchase' && t.paymentStatus === 'success') {
        stats.totalPurchased += t.credits;
      } else if (t.type === 'approach_sent') {
        stats.totalSpent += Math.abs(t.credits);
      }
    });
    
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching statistics' 
    });
  }
});

module.exports = router;
