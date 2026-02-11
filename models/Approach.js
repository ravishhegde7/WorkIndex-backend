const mongoose = require(‘mongoose’);

const approachSchema = new mongoose.Schema({
request: {
type: mongoose.Schema.Types.ObjectId,
ref: ‘Request’,
required: true
},
expert: {
type: mongoose.Schema.Types.ObjectId,
ref: ‘User’,
required: true
},
message: {
type: String,
required: true
},
quote: String,
status: {
type: String,
enum: [‘sent’, ‘viewed’, ‘accepted’, ‘rejected’],
default: ‘sent’
},
unlocked: {
type: Boolean,
default: true
},
creditsSpent: {
type: Number,
required: true
},
clientEmail: {
type: String,
default: null  // ✅ Explicit default for better null handling
},
clientPhone: {
type: String,
default: null  // ✅ Explicit default for better null handling
},
viewedAt: Date,
respondedAt: Date
}, {
timestamps: true
});

// ✅ Indexes for faster queries
approachSchema.index({ expert: 1, createdAt: -1 }); // Already exists - good!
approachSchema.index({ request: 1 }); // For checking existing approaches

module.exports = mongoose.model(‘Approach’, approachSchema);
