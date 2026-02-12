const mongoose = require('mongoose');

const approachSchema = new mongoose.Schema({
  request: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Request',
    required: true
  },
  expert: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  message: {
    type: String,
    required: true
  },
  quote: String,
  status: {
    type: String,
    enum: ['sent', 'viewed', 'accepted', 'rejected'],
    default: 'sent'
  },
  unlocked: {
    type: Boolean,
    default: true
  },
  creditsSpent: {
    type: Number,
    required: true
  },
  
  // ⭐ NEW: Document Access Status
  documentAccessRequested: {
    type: Boolean,
    default: false
  },
  
  documentAccessGranted: {
    type: Boolean,
    default: false
  },
  
  documentAccessRequestedAt: Date,
  documentAccessGrantedAt: Date,
  
  clientEmail: String,
  clientPhone: String,
  viewedAt: Date,
  respondedAt: Date,
  
  // ⭐ NEW: Work Completion Status
  isWorkCompleted: {
    type: Boolean,
    default: false
  },
  
  completedAt: Date,
  
  // ⭐ NEW: Rating Reference (after work completion)
  rating: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rating',
    default: null
  },
  
  hasBeenRated: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Indexes
approachSchema.index({ expert: 1, createdAt: -1 });
approachSchema.index({ request: 1, expert: 1 }, { unique: true });
approachSchema.index({ status: 1 });

module.exports = mongoose.model('Approach', approachSchema);
