const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true },
  readAt: { type: Date, default: null }
}, { timestamps: true });

const chatSchema = new mongoose.Schema({
    request: { type: mongoose.Schema.Types.ObjectId, ref: 'Request', default: null },
  expert: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  messages: [messageSchema],
  lastMessage: { type: String, default: '' },
  lastMessageAt: { type: Date, default: Date.now }
}, { timestamps: true });

// One chat per expert-client-request combination
chatSchema.index({ request: 1, expert: 1, client: 1 }, { unique: true });

module.exports = mongoose.model('Chat', chatSchema);
