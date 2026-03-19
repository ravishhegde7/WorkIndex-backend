const express = require('express');
const router  = express.Router();
const fetch   = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const Visit   = require('../models/Visit');
const { protect, authorize } = require('../middleware/auth');

// ═══════════════════════════════════════════════════════════
// POST /api/visits/track  — PUBLIC, no auth
// Called from frontend on every page load
// ═══════════════════════════════════════════════════════════
router.post('/track', async (req, res) => {
  try {
    const { page = '/', sessionId = '' } = req.body;

    // Get real IP (works behind Vercel / Railway / Cloudflare proxies)
    const ip =
      req.headers['cf-connecting-ip'] ||       // Cloudflare
      req.headers['x-forwarded-for']?.split(',')[0].trim() ||
      req.headers['x-real-ip'] ||
      req.socket.remoteAddress ||
      'unknown';

    // Skip localhost / internal IPs during development
    const isLocal = ['::1', '127.0.0.1', 'unknown'].includes(ip) ||
                    ip.startsWith('192.168') ||
                    ip.startsWith('10.');

    // Prevent double-counting same session
    if (sessionId) {
      const existing = await Visit.findOne({ sessionId });
      if (existing) {
        return res.json({ success: true, message: 'Already tracked' });
      }
    }

    let state   = 'Unknown';
    let city    = 'Unknown';
    let country = 'India';

    // Geo-lookup only for real IPs
    if (!isLocal && ip !== 'unknown') {
      try {
        const geoRes  = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,regionName,city`, { timeout: 3000 });
        const geoData = await geoRes.json();
        if (geoData.status === 'success') {
          country = geoData.country    || 'India';
          state   = geoData.regionName || 'Unknown';
          city    = geoData.city       || 'Unknown';
        }
      } catch (geoErr) {
        // Silent fail — geo is best-effort
        console.log('Geo lookup failed:', geoErr.message);
      }
    } else {
      // Local dev — use placeholder
      state   = 'Karnataka';
      city    = 'Bengaluru';
      country = 'India';
    }

    await Visit.create({
      ip,
      country,
      state,
      city,
      page,
      sessionId,
      userAgent: req.headers['user-agent'] || '',
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Visit track error:', error);
    res.json({ success: false }); // Never throw — don't break the frontend
  }
});

// ═══════════════════════════════════════════════════════════
// GET /api/visits/stats  — ADMIN ONLY
// Returns total + today + week + month + state breakdown
// ═══════════════════════════════════════════════════════════
router.get('/stats', protect, authorize('admin'), async (req, res) => {
  try {
    const now   = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const week  = new Date(today); week.setDate(week.getDate() - 7);
    const month = new Date(today); month.setDate(month.getDate() - 30);

    const [total, todayCount, weekCount, monthCount, stateBreakdown, cityBreakdown, recentVisits] = await Promise.all([
      // Total all time
      Visit.countDocuments(),

      // Today
      Visit.countDocuments({ createdAt: { $gte: today } }),

      // Last 7 days
      Visit.countDocuments({ createdAt: { $gte: week } }),

      // Last 30 days
      Visit.countDocuments({ createdAt: { $gte: month } }),

      // State breakdown (top 20)
      Visit.aggregate([
        { $group: { _id: '$state', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 }
      ]),

      // City breakdown (top 10)
      Visit.aggregate([
        { $group: { _id: '$city', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),

      // Last 10 visits
      Visit.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .select('state city page createdAt')
        .lean()
    ]);

    // Daily chart — last 14 days
    const dailyData = await Visit.aggregate([
      { $match: { createdAt: { $gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) } } },
      {
        $group: {
          _id: {
            year:  { $year:  '$createdAt' },
            month: { $month: '$createdAt' },
            day:   { $dayOfMonth: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    res.json({
      success: true,
      stats: {
        total,
        today:   todayCount,
        week:    weekCount,
        month:   monthCount,
        states:  stateBreakdown.map(s => ({ state: s._id || 'Unknown', count: s.count })),
        cities:  cityBreakdown.map(c => ({ city: c._id  || 'Unknown', count: c.count })),
        daily:   dailyData.map(d => ({
          date:  `${d._id.day}/${d._id.month}`,
          count: d.count
        })),
        recent:  recentVisits
      }
    });
  } catch (error) {
    console.error('Visit stats error:', error);
    res.status(500).json({ success: false, message: 'Error fetching visit stats' });
  }
});

module.exports = router;
