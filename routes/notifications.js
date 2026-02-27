const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const mongoose = require('mongoose');

function safeModel(name) {
  try { return mongoose.models[name] || null; } catch(e) { return null; }
}

router.get('/', protect, async (req, res) => {
  try {
    const Notification = safeModel('Notification');
    if (!Notification) return res.json({ success: true, notifications: [] });
    const notifications = await Notification.find({ user: req.user.id })
      .sort({ createdAt: -1 }).limit(30);
    res.json({ success: true, notifications });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/mark-read', protect, async (req, res) => {
  try {
    const Notification = safeModel('Notification');
    if (!Notification) return res.json({ success: true });
    await Notification.updateMany(
      { user: req.user.id, isRead: false },
      { isRead: true, readAt: new Date() }
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
