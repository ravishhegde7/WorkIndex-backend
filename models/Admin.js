const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const permissionSchema = new mongoose.Schema({
  read:   { type: Boolean, default: false },
  write:  { type: Boolean, default: false },
  delete: { type: Boolean, default: false }
}, { _id: false });

const adminSchema = new mongoose.Schema({
  adminId:   { type: String, required: true, unique: true },
  name:      { type: String, required: true },
  email:     { type: String, default: '' },
  password:  { type: String, required: true, select: false },
  role:      { type: String, enum: ['super_admin', 'admin', 'readonly'], default: 'admin' },
  permissions: {
    users:        { type: permissionSchema, default: {} },
    experts:      { type: permissionSchema, default: {} },
    requests:     { type: permissionSchema, default: {} },
    tickets:      { type: permissionSchema, default: {} },
    credits:      { type: permissionSchema, default: {} },
    chats:        { type: permissionSchema, default: {} },
    reports:      { type: permissionSchema, default: {} },
    kyc:          { type: permissionSchema, default: {} },
    settings:     { type: permissionSchema, default: {} },
    admins:       { type: permissionSchema, default: {} }
  },
  allowedTabs: { type: [String], default: [] },
  createdBy:  { type: String, default: 'system' },
  lastLogin:  { type: Date },
  isActive:   { type: Boolean, default: true }
}, { timestamps: true });

// ── Permission templates ──
adminSchema.statics.TEMPLATES = {
  super_admin: {
    allowedTabs: [], // empty = all tabs
    permissions: {
      users:    { read: true, write: true, delete: true },
      experts:  { read: true, write: true, delete: true },
      requests: { read: true, write: true, delete: true },
      tickets:  { read: true, write: true, delete: true },
      credits:  { read: true, write: true, delete: true },
      chats:    { read: true, write: true, delete: true },
      reports:  { read: true, write: true, delete: true },
      kyc:      { read: true, write: true, delete: true },
      settings: { read: true, write: true, delete: true },
      admins:   { read: true, write: true, delete: true }
    }
  },
  readonly: {
    allowedTabs: ['dashboard','experts','clients','approaches','chats','credits','tickets','posts','reviews','registrations','kyc'],
    permissions: {
      users:    { read: true, write: false, delete: false },
      experts:  { read: true, write: false, delete: false },
      requests: { read: true, write: false, delete: false },
      tickets:  { read: true, write: false, delete: false },
      credits:  { read: true, write: false, delete: false },
      chats:    { read: true, write: false, delete: false },
      reports:  { read: true, write: false, delete: false },
      kyc:      { read: true, write: false, delete: false },
      settings: { read: false, write: false, delete: false },
      admins:   { read: false, write: false, delete: false }
    }
  },
  support: {
    allowedTabs: ['dashboard','experts','clients','tickets','refunds','actions','registrations','kyc','reports'],
    permissions: {
      users:    { read: true, write: true, delete: false },
      experts:  { read: true, write: true, delete: false },
      requests: { read: true, write: false, delete: false },
      tickets:  { read: true, write: true, delete: false },
      credits:  { read: true, write: false, delete: false },
      chats:    { read: true, write: false, delete: false },
      reports:  { read: true, write: false, delete: false },
      kyc:      { read: true, write: true, delete: false },
      settings: { read: false, write: false, delete: false },
      admins:   { read: false, write: false, delete: false }
    }
  },
  finance: {
    allowedTabs: ['dashboard','credits','refunds','payments','revenue'],
    permissions: {
      users:    { read: true, write: false, delete: false },
      experts:  { read: true, write: false, delete: false },
      requests: { read: true, write: false, delete: false },
      tickets:  { read: true, write: true, delete: false },
      credits:  { read: true, write: true, delete: false },
      chats:    { read: false, write: false, delete: false },
      reports:  { read: true, write: false, delete: false },
      kyc:      { read: false, write: false, delete: false },
      settings: { read: false, write: false, delete: false },
      admins:   { read: false, write: false, delete: false }
    }
  },
  moderator: {
    allowedTabs: ['dashboard','experts','clients','posts','reviews','reports','suspReq','registrations','kyc','actions'],
    permissions: {
      users:    { read: true, write: true, delete: false },
      experts:  { read: true, write: true, delete: false },
      requests: { read: true, write: true, delete: true },
      tickets:  { read: true, write: true, delete: false },
      credits:  { read: true, write: false, delete: false },
      chats:    { read: true, write: false, delete: false },
      reports:  { read: true, write: true, delete: false },
      kyc:      { read: true, write: true, delete: false },
      settings: { read: false, write: false, delete: false },
      admins:   { read: false, write: false, delete: false }
    }
  }
};

adminSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

adminSchema.methods.matchPassword = async function(entered) {
  return await bcrypt.compare(entered, this.password);
};

// Check a single permission — bypasses all checks for super_admin
adminSchema.methods.can = function(module, action) {
  if (this.role === 'super_admin') return true;
  return !!(this.permissions && this.permissions[module] && this.permissions[module][action]);
};

module.exports = mongoose.models.Admin || mongoose.model('Admin', adminSchema);
