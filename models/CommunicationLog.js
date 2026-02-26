// models/CommunicationLog.js
const mongoose = require('mongoose');

const communicationLogSchema = new mongoose.Schema({
  subject: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  target: {
    type: String,
    enum: ['all', 'experts', 'clients', 'custom'],
    default: 'all'
  },
  recipientCount: {
    type: Number,
    default: 0
  },
  recipientEmails: [{
    type: String
  }],
  sentBy: {
    type: String  // admin ID
  },
  status: {
    type: String,
    enum: ['sent', 'failed', 'pending'],
    default: 'sent'
  }
}, {
  timestamps: true
});

module.exports = mongoose.models.CommunicationLog ||
  mongoose.model('CommunicationLog', communicationLogSchema);
