require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Health check (before routes)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Routes - with error handling
try {
  const authRoutes = require('./routes/auth');
  const usersRoutes = require('./routes/users');
  const requestsRoutes = require('./routes/requests');
  const approachesRoutes = require('./routes/approaches');
  const creditsRoutes = require('./routes/credits');
  const paymentsRoutes = require('./routes/payments');

  app.use('/api/auth', authRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/requests', requestsRoutes);
  app.use('/api/approaches', approachesRoutes);
  app.use('/api/credits', creditsRoutes);
  app.use('/api/payments', paymentsRoutes);
} catch (error) {
  console.error('Error loading routes:', error);
}

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Database connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/workindex';

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    // Don't exit - let Railway restart
  });

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received');
  mongoose.connection.close(false, () => {
    console.log('MongoDB connection closed');
    process.exit(0);
  });
});
