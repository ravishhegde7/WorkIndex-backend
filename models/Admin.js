// models/Admin.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
  adminId:      { type: String, required: true, unique: true }, // e.g. "admin_workindex"
  name:         { type: String, required: true },
  password:     { type: String, required: true, select: false },
  role:         { type: String, enum: ['superadmin', 'support'], default: 'support' },
  lastLogin:    { type: Date },
  isActive:     { type: Boolean, default: true }
}, { timestamps: true });

// Hash password before saving
adminSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password
adminSchema.methods.matchPassword = async function(entered) {
  return await bcrypt.compare(entered, this.password);
};

module.exports = mongoose.models.Admin || mongoose.model('Admin', adminSchema);
