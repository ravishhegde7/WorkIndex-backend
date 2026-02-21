// models/CreditTransaction.js
const mongoose = require('mongoose');

const creditTransactionSchema = new mongoose.Schema({
  // ─── WHO ───
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },

  // ─── WHAT KIND ───
  type: { 
    type: String, 
    enum: [
      'purchase',    // Expert bought credits
      'spent',       // Expert spent credits approaching
      'refund',      // Chatbot/admin refunded
      'bonus',       // Platform gave bonus credits
      'penalty',     // Admin deducted credits
      'expired'      // Credits expired (future use)
    ],
    required: true 
  },

  // ─── AMOUNT ───
  amount: { 
    type: Number, 
    required: true 
    // Positive = credits added, Negative = credits deducted
  },
  balanceBefore: { type: Number, required: true },
  balanceAfter:  { type: Number, required: true },

  // ─── DESCRIPTION ───
  description: { type: String },

  // ─── LINKED DATA ───
  relatedRequest: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Request' 
  },
  relatedApproach: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Approach' 
  },
  relatedClient: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User'   // The client who was approached
  },

  // ─── PURCHASE DETAILS ───
  purchaseDetails: {
    packageSize: Number,       // 20, 100, 200
    amountPaid: Number,        // ₹600, ₹2700, ₹4800
    paymentMethod: String,     // 'upi', 'card', etc.
    transactionId: String      // Payment gateway ref
  },

  // ─── REFUND DETAILS ───
  refundDetails: {
    reason: String,            // 'client_inactive', 'manual_admin', etc.
    approvedBy: String,        // 'chatbot_auto', 'admin_manual'
    ticketId: mongoose.Schema.Types.ObjectId,
    clientLastLogin: Date,     // Snapshot at time of refund
    daysSinceClientLogin: Number
  },

  // ─── APPROACH DETAILS (when type = 'spent') ───
  approachDetails: {
    requestTitle: String,
    requestService: String,    // 'itr', 'gst', etc.
    clientName: String,
    clientCity: String,
    creditsSpent: Number,
    approachStatus: String     // 'pending', 'accepted', 'rejected'
  },

  // ─── STATUS ───
  status: {
    type: String,
    enum: ['completed', 'pending', 'failed', 'reversed'],
    default: 'completed'
  },

  // ─── METADATA ───
  initiatedBy: {
    type: String,
    enum: ['user', 'chatbot', 'admin', 'system'],
    default: 'system'
  },
  ipAddress: String,
  notes: String,              // Admin notes

}, { timestamps: true });

// ─── INDEXES FOR FAST QUERIES ───
creditTransactionSchema.index({ user: 1, createdAt: -1 });
creditTransactionSchema.index({ user: 1, type: 1 });
creditTransactionSchema.index({ relatedClient: 1 });
creditTransactionSchema.index({ relatedRequest: 1 });
creditTransactionSchema.index({ createdAt: -1 });
creditTransactionSchema.index({ type: 1, createdAt: -1 });

// ─── STATIC: Log a transaction ───
creditTransactionSchema.statics.log = async function(data) {
  try {
    return await this.create(data);
  } catch (err) {
    console.error('Failed to log credit transaction:', err);
    // Don't throw — transaction logging should never break main flow
  }
};

// ─── STATIC: Get user ledger ───
creditTransactionSchema.statics.getUserLedger = async function(userId, options = {}) {
  const { 
    limit = 50, 
    skip = 0, 
    type = null,
    startDate = null,
    endDate = null,
    clientId = null
  } = options;

  const query = { user: userId };
  if (type) query.type = type;
  if (clientId) query.relatedClient = clientId;
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  const [transactions, total, summary] = await Promise.all([
    this.find(query)
      .populate('relatedRequest', 'title service')
      .populate('relatedClient', 'name email phone location')
      .populate('relatedApproach', 'status creditsSpent')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),

    this.countDocuments(query),

    // Summary stats
    this.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(userId) } },
      { $group: {
        _id: '$type',
        total: { $sum: '$amount' },
        count: { $sum: 1 }
      }}
    ])
  ]);

  return { transactions, total, summary };
};

module.exports = mongoose.model('CreditTransaction', creditTransactionSchema);
