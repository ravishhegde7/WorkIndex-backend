// models/Notification.js
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['announcement', 'system', 'refund', 'approach', 'chat', 'admin_dm'],
    default: 'system'
  },
  isRead: {
    type: Boolean,
    default: false
  },
  readAt: Date,
  sentBy: {
    type: String, // 'admin' or user ID
    default: 'system'
  },
  link: String // optional deep link in app
}, {
  timestamps: true
});

notificationSchema.index({ user: 1, isRead: 1 });
notificationSchema.index({ createdAt: -1 });

module.exports = mongoose.models.Notification ||
  mongoose.model('Notification', notificationSchema);
