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
  clientEmail: String,
  clientPhone: String,
  viewedAt: Date,
  respondedAt: Date
}, {
  timestamps: true
});

approachSchema.index({ expert: 1, createdAt: -1 });
approachSchema.index({ request: 1, expert: 1 }, { unique: true });

module.exports = mongoose.model('Approach', approachSchema);
