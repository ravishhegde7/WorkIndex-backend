const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

const CREDIT_PACKS = [
  { credits: 20, price: 600, savings: 0 },
  { credits: 50, price: 1500, savings: 0 },
  { credits: 100, price: 2700, savings: 10 },
  { credits: 200, price: 4800, savings: 20 }
];

router.get('/balance', protect, authorize('expert'), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json({ success: true, credits: user.credits });
  } catch (error) {
    console.error('Get balance error:', error);
    res.status(500).json({ success: false, message: 'Error fetching balance' });
  }
});

router.get('/packs', (req, res) => {
  res.json({ success: true, packs: CREDIT_PACKS });
});

router.get('/transactions', protect, authorize('expert'), async (req, res) => {
  try {
    const transactions = await Transaction.find({ user: req.user.id }).sort('-createdAt').limit(50).populate('relatedApproach');
    res.json({ success: true, count: transactions.length, transactions });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ success: false, message: 'Error fetching transactions' });
  }
});

router.post('/add', protect, authorize('expert'), async (req, res) => {
  try {
    const { credits } = req.body;
    if (!credits || credits <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid credit amount' });
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
      description: 'Manual credit addition'
    });
    res.json({ success: true, message: `${credits} credits added`, newBalance: user.credits });
  } catch (error) {
    console.error('Add credits error:', error);
    res.status(500).json({ success: false, message: 'Error adding credits' });
  }
});

module.exports = router;
