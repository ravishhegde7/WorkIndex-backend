// models/Approach.js - Create this file if it doesn't exist

const mongoose = require('mongoose');

const approachSchema = new mongoose.Schema({
  expertId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  requestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Request',
    required: true
  },
  message: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected'],
    default: 'pending'
  },
  creditsSpent: {
    type: Number,
    default: 20
  }
}, {
  timestamps: true
});

// Prevent duplicate approaches
approachSchema.index({ expertId: 1, requestId: 1 }, { unique: true });

module.exports = mongoose.Model('Approach', approachSchema);
