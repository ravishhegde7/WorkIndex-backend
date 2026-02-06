const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

router.post('/create-order', protect, authorize('expert'), async (req, res) => {
  try {
    const { credits, amount } = req.body;
    const mockOrder = {
      id: `order_${Date.now()}`,
      amount: amount * 100,
      currency: 'INR',
      credits: credits
    };
    res.json({ success: true, order: mockOrder, key: process.env.RAZORPAY_KEY_ID || 'mock_key' });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ success: false, message: 'Error creating payment order' });
  }
});

router.post('/verify', protect, authorize('expert'), async (req, res) => {
  try {
    const { orderId, paymentId, signature, credits, amount } = req.body;
    const user = await User.findById(req.user.id);
    user.credits += credits;
    await user.save();
    await Transaction.create({
      user: req.user.id,
      type: 'credit_purchase',
      amount: amount,
      credits: credits,
      paymentId: paymentId,
      paymentMethod: 'razorpay',
      paymentStatus: 'success',
      description: `Purchased ${credits} credits`
    });
    res.json({ success: true, message: 'Payment successful', newBalance: user.credits });
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({ success: false, message: 'Error verifying payment' });
  }
});
