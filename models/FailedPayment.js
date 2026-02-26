// models/FailedPayment.js
const mongoose = require('mongoose');

const failedPaymentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'INR'
  },
  gateway: {
    type: String,
    enum: ['razorpay', 'stripe', 'payu', 'cashfree', 'other'],
    default: 'razorpay'
  },
  gatewayOrderId: String,
  gatewayPaymentId: String,
  failureReason: {
    type: String,
    default: 'Unknown'
  },
  failureCode: String,
  // The thing they were trying to buy
  purchaseType: {
    type: String,
    enum: ['credits', 'subscription', 'other'],
    default: 'credits'
  },
  creditsAttempted: Number,
  retried: {
    type: Boolean,
    default: false
  },
  retriedAt: Date,
  metadata: {
    type: Object,
    default: {}
  }
}, {
  timestamps: true
});

failedPaymentSchema.index({ user: 1 });
failedPaymentSchema.index({ createdAt: -1 });
failedPaymentSchema.index({ gateway: 1 });

module.exports = mongoose.models.FailedPayment ||
  mongoose.model('FailedPayment', failedPaymentSchema);
