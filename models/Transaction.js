const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  // User who made the transaction
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Transaction type
  type: {
    type: String,
    required: true,
    enum: [
      'credit_purchase',    // Buying credits
      'approach_sent',      // Spending credits on approach
      'credit_refund',      // Refund credits
      'manual_adjustment'   // Admin adjustment
    ]
  },
  
  // Amount in rupees (for purchases)
  amount: {
    type: Number,
    default: 0
  },
  
  // Credits involved (positive for purchase, negative for spend)
  credits: {
    type: Number,
    required: true
  },
  
  // Payment details (for purchases)
  paymentMethod: {
    type: String,
    enum: ['upi', 'card', 'netbanking', 'wallet', 'manual', null],
    default: null
  },
  
  paymentStatus: {
    type: String,
    enum: ['pending', 'success', 'failed', 'refunded'],
    default: 'pending'
  },
  
  paymentId: String,        // Payment gateway transaction ID
  paymentVerifiedAt: Date,
  
  // Related entities
  relatedApproach: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Approach',
    default: null
  },
  
  // Description
  description: {
    type: String,
    required: true
  },
  
  // Metadata (flexible field for additional data)
  metadata: {
    type: Object,
    default: {}
  },
  
  // Balance after transaction
  balanceAfter: Number
  
}, {
  timestamps: true
});

// Indexes
transactionSchema.index({ user: 1, createdAt: -1 });
transactionSchema.index({ type: 1 });
transactionSchema.index({ paymentStatus: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
