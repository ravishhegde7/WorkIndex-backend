const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  // Owner of the document
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Related request (optional - can be attached to specific request)
  request: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Request',
    default: null
  },
  
  // File details
  fileName: {
    type: String,
    required: true
  },
  
  originalFileName: {
    type: String,
    required: true
  },
  
  fileType: {
    type: String,
    required: true,
    enum: ['pdf', 'excel', 'image', 'word', 'other']
  },
  
  mimeType: {
    type: String,
    required: true
  },
  
  fileSize: {
    type: Number, // in bytes
    required: true
  },
  
  fileUrl: {
    type: String,
    required: true
  },
  
  // Document metadata
  description: {
    type: String,
    maxlength: 500
  },
  
  category: {
    type: String,
    enum: ['tax', 'financial', 'legal', 'identity', 'other'],
    default: 'other'
  },
  
  // Access control
  isPublic: {
    type: Boolean,
    default: false
  },
  
  // Experts who have been granted access
  grantedAccess: [{
    expert: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    grantedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Download tracking
  downloadCount: {
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
documentSchema.index({ owner: 1, createdAt: -1 });
documentSchema.index({ request: 1 });
documentSchema.index({ fileType: 1 });

module.exports = mongoose.model('Document', documentSchema);
