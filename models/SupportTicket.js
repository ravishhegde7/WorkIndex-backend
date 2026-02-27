const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema({
  user:          { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  expert:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  issueType:     { type: String, required: true },
  subject:       { type: String },
  description:   { type: String },
  priority:      { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  status:        { type: String, enum: ['open', 'pending_review', 'resolved', 'closed'], default: 'open' },
  decision:      { type: String },
  adminNote:     { type: String },
  eligibleCredits:  { type: Number, default: 0 },
  creditsRefunded:  { type: Number, default: 0 },
  createdByAdmin:   { type: Boolean, default: false },
  createdBy:        { type: String },
  resolvedAt:       { type: Date },
  transactionBreakdown: [{ type: mongoose.Schema.Types.Mixed }]
}, { timestamps: true });

module.exports = mongoose.models.SupportTicket || mongoose.model('SupportTicket', supportTicketSchema);
