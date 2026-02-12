const mongoose = require('mongoose');

const accessRequestSchema = new mongoose.Schema({
  // The document being requested
  document: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document',
    required: true
  },
  
  // The expert requesting access
  expert: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // The client who owns the document
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Related approach (the expert's approach to the request)
  approach: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Approach',
    required: true
  },
  
  // Request details
  message: {
    type: String,
    required: true,
    maxlength: 500
  },
  
  // Status
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  
  // Response from client
  responseMessage: {
    type: String,
    maxlength: 500
  },
  
  // Timestamps for status changes
  requestedAt: {
    type: Date,
    default: Date.now
  },
  
  respondedAt: Date,
  
  // Expiry (optional - access can expire after certain time)
  expiresAt: Date
}, {
  timestamps: true
});

// Indexes
accessRequestSchema.index({ expert: 1, status: 1 });
accessRequestSchema.index({ client: 1, status: 1 });
accessRequestSchema.index({ document: 1 });
accessRequestSchema.index({ approach: 1 });

// Ensure expert can't request same document multiple times
accessRequestSchema.index({ document: 1, expert: 1 }, { unique: true });

module.exports = mongoose.model('AccessRequest', accessRequestSchema);
