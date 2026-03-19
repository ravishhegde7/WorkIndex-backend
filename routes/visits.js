const express = require('express');
const router  = express.Router();
const Visit   = require('../models/Visit');
const jwt     = require('jsonwebtoken');

// ─── Admin auth — checks isAdmin: true (matches admin login JWT) ─────────────
function adminAuth(req, res, next) {
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Admin JWT contains { id, isAdmin: true, role: ... }  (see admin login route)
    if (!decoded.isAdmin && decoded.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

// ═══════════════════════════════════════════════════════════
// POST /api/visits/track  — PUBLIC, no auth
// ═══════════════════════════════════════════════════════════
router.post('/track', async (req, res) => {
  try {
    const { page = '/', sessionId = '' } = req.body;

    const ip =
      req.headers['cf-connecting-ip'] ||
      req.headers['x-forwarded-for']?.split(',')[0].trim() ||
      req.headers['x-real-ip'] ||
      req.socket.remoteAddress ||
      'unknown';

    const isLocal = ['::1', '127.0.0.1', 'unknown'].includes(ip) ||
                    ip.startsWith('192.168') ||
                    ip.startsWith('10.');

    if (sessionId) {
      const existing = await Visit.findOne({ sessionId });
      if (existing) return res.json({ success: true, message: 'Already tracked' });
    }

    let state   = 'Unknown';
    let city    = 'Unknown';
    let country = 'India';

    if (!isLocal && ip !== 'unknown') {
      try {
        const geoRes  = await fetch(
          `http://ip-api.com/json/${ip}?fields=status,country,regionName,city`
        );
        const geoData = await geoRes.json();
        if (geoData.status === 'success') {
          country = geoData.country    || 'India';
          state   = geoData.regionName || 'Unknown';
          city    = geoData.city       || 'Unknown';
        }
      } catch (geoErr) {
        console.log('Geo lookup failed:', geoErr.message);
      }
    } else {
      state   = 'Karnataka';
      city    = 'Bengaluru';
      country = 'India';
    }

    await Visit.create({ ip, country, state, city, page, sessionId, userAgent: req.headers['user-agent'] || '' });
    res.json({ success: true });
  } catch (error) {
    console.error('Visit track error:', error);
    res.json({ success: false });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /api/visits/stats  — ADMIN ONLY
// ═══════════════════════════════════════════════════════════
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const now   = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const week  = new Date(today); week.setDate(week.getDate() - 7);
    const month = new Date(today); month.setDate(month.getDate() - 30);

    const [total, todayCount, weekCount, monthCount, stateBreakdown, cityBreakdown, recentVisits] = await Promise.all([
      Visit.countDocuments(),
      Visit.countDocuments({ createdAt: { $gte: today } }),
      Visit.countDocuments({ createdAt: { $gte: week } }),
      Visit.countDocuments({ createdAt: { $gte: month } }),

      Visit.aggregate([
        { $match: { state: { $ne: 'Unknown' } } },
        { $group: { _id: '$state', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 }
      ]),

      Visit.aggregate([
        { $match: { city: { $ne: 'Unknown' } } },
        { $group: { _id: '$city', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),

      Visit.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .select('state city page createdAt')
        .lean()
    ]);

    const dailyData = await Visit.aggregate([
      { $match: { createdAt: { $gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) } } },
      {
        $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' }, day: { $dayOfMonth: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    res.json({
      success: true,
      stats: {
        total,
        today:  todayCount,
        week:   weekCount,
        month:  monthCount,
        states: stateBreakdown.map(s => ({ state: s._id || 'Unknown', count: s.count })),
        cities: cityBreakdown.map(c => ({ city:  c._id  || 'Unknown', count: c.count })),
        daily:  dailyData.map(d => ({ date: `${d._id.day}/${d._id.month}`, count: d.count })),
        recent: recentVisits
      }
    });
  } catch (error) {
    console.error('Visit stats error:', error);
    res.status(500).json({ success: false, message: 'Error fetching visit stats' });
  }
});

module.exports = router;
