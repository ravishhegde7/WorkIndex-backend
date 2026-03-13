const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  actor:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  actorRole:  { type: String, enum: ['client','expert','admin'], default: 'client' },
  actorName:  { type: String, default: '' },
  action:     { type: String, required: true },
  targetType: { type: String, default: '' },
  targetId:   { type: mongoose.Schema.Types.ObjectId, default: null },
  targetName: { type: String, default: '' },
  metadata:   { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt:  { type: Date, default: Date.now }
});

auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ targetId: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
