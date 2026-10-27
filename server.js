const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
require('dotenv').config();
const errorHandler = require('./middlewares/errorHandler');
const morgan = require('morgan');
const logger = require('./utils/logger');
// Database connection is managed via config/db.js

// Route Files
const authRoutes = require('./routes/authRoutes');
const omcRoutes = require('./routes/omcRoutes');
const roRoutes = require('./routes/roRoutes');
const machineRoutes = require('./routes/machineRoutes');
const alertRoutes = require('./routes/alertRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const feedbackRoutes = require('./routes/feedbackRoutes');
const initMqtt = require('./services/mqttService');

const app = express();
// Enable trusting reverse proxy (Nginx) for express-rate-limit and client IP tracking
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // For enterprise, restrict this to frontend URL later
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});
const port = process.env.PORT || 5000;

// Expose io to routes if needed
app.set('io', io);

io.on('connection', (socket) => {
  logger.info(`New client connected to WebSockets: ${socket.id}`);

  // Multi-tenant room isolation
  socket.on('join_tenant', (tenantData) => {
    try {
      if (!tenantData) return;
      const { role, omcId, roId } = tenantData;
      if (role === 'Super Admin') {
        socket.join('super_admin');
        logger.info(`Socket ${socket.id} joined super_admin room`);
      }
      if (omcId) {
        socket.join(`omc_${omcId}`);
        logger.info(`Socket ${socket.id} joined omc_${omcId} room`);
      }
      if (roId) {
        socket.join(`ro_${roId}`);
        logger.info(`Socket ${socket.id} joined ro_${roId} room`);
      }
    } catch (roomErr) {
      logger.error(`Error joining tenant room: ${roomErr.message}`);
    }
  });

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Middleware
app.use(helmet()); // Enterprise Level Security Headers
app.use(cors({
  origin: function(origin, callback) {
    return callback(null, true);
  },
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Morgan Middleware for HTTP logging
const morganMiddleware = morgan(
  ':method :url :status :res[content-length] - :response-time ms',
  {
    stream: {
      write: (message) => logger.http(message.trim()),
    },
  }
);
app.use(morganMiddleware);

// Rate Limiting - relaxed for development & real-time telemetry polling
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50000, // relaxed limit to avoid blocking dashboard polling & local development
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { success: false, message: 'Too many requests, please try again later' }
});
app.use('/api', limiter);

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/omc', omcRoutes);
app.use('/api/v1/ro', roRoutes);
app.use('/api/v1/machines', machineRoutes);
app.use('/api/v1/machine', machineRoutes);
app.use('/api/v1/alerts', alertRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/feedback', feedbackRoutes);

// Health Check Route
app.get('/api/health', (req, res) => {
  res.status(200).json({ success: true, message: 'Backend is running smoothly! 🚀' });
});

// Handle undefined routes (404)
app.use((req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
});

// Global Error Handler Middleware
app.use(errorHandler);

// Start Server
const runningServer = server.listen(port, () => {
  logger.info(`Server is running on http://localhost:${port} 🚀`);
  
  // Initialize MQTT Client to listen for hardware data
  initMqtt(io);
});

// ── Graceful Shutdown & Process Monitoring ────────────────────────
const db = require('./config/db');

const shutdown = async (signal) => {
  logger.info(`Received ${signal}. Gracefully shutting down...`);
  runningServer.close(async () => {
    logger.info('HTTP server closed.');
    try {
      if (db.pool) {
        await db.pool.end();
        logger.info('PostgreSQL pool drained.');
      }
    } catch (e) {
      logger.error(`Error during DB pool drain: ${e.message}`);
    }
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forcefully shutting down due to timeout.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`, { stack: err.stack });
});
