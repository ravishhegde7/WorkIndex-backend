const mongoose = require('mongoose');

const approachSchema = new mongoose.Schema({
  request: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Request',
    required: [true, 'Request is required']
  },
  expert: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Expert is required']
  },
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Client is required']
  },
  message: {
    type: String,
    required: [true, 'Message is required'],
    trim: true
  },
  creditsSpent: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected'],
    default: 'pending'
  },
  contactUnlocked: {
    type: Boolean,
    default: true  // True when expert spends credits
  },
  acceptedAt: Date,
  rejectedAt: Date
}, {
  timestamps: true
});

// Indexes for faster queries
approachSchema.index({ request: 1, expert: 1 }, { unique: true }); // One approach per expert per request
approachSchema.index({ expert: 1, createdAt: -1 });
approachSchema.index({ client: 1, status: 1 });
approachSchema.index({ request: 1, createdAt: -1 });

module.exports = mongoose.model('Approach', approachSchema);
