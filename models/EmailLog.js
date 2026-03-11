// models/EmailLog.js
const mongoose = require('mongoose');

const emailLogSchema = new mongoose.Schema({
  to:        { type: String, required: true },
  toName:    { type: String, default: '' },
  subject:   { type: String, required: true },
  type:      { type: String, required: true }, // e.g. 'client_welcome', 'expert_banned'
  category:  { type: String, required: true }, // 'client' | 'expert' | 'admin'
  reason:    { type: String, default: '' },    // human-readable trigger
  status:    { type: String, enum: ['sent', 'failed'], default: 'sent' },
  error:     { type: String, default: '' },
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

emailLogSchema.index({ createdAt: -1 });
emailLogSchema.index({ type: 1 });
emailLogSchema.index({ status: 1 });

module.exports = mongoose.model('EmailLog', emailLogSchema);
