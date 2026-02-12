const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema({
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true
  },
  service: {
    type: String,
    required: true,
    enum: ['itr', 'gst', 'accounting', 'audit', 'photography', 'development']
  },
  category: String,
  description: {
    type: String,
    required: true
  },
  answers: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  timeline: {
    type: String,
    enum: ['immediate', 'week', 'month', 'flexible'],
    default: 'flexible'
  },
  budget: String,
  location: {
    type: String,
    required: true
  },
  
  // ⭐ NEW: Attached Documents
  documents: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document'
  }],
  
  credits: {
    type: Number,
    required: true,
    min: 1
  },
  status: {
    type: String,
    enum: ['pending', 'active', 'closed', 'cancelled'],
    default: 'pending'
  },
  
  // ⭐ NEW: Accepted Expert
  acceptedExpert: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  
  // ⭐ NEW: Completion Status
  isCompleted: {
    type: Boolean,
    default: false
  },
  
  completedAt: Date,
  
  responseCount: {
    type: Number,
    default: 0
  },
  viewCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Indexes
requestSchema.index({ client: 1, createdAt: -1 });
requestSchema.index({ service: 1, status: 1 });
requestSchema.index({ status: 1, createdAt: -1 });
requestSchema.index({ location: 1 });

module.exports = mongoose.model('Request', requestSchema);
