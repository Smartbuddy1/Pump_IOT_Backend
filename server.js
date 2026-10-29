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
const jwt = require('jsonwebtoken');
const db = require('./config/db');

// Enable trusting reverse proxy (Nginx) for express-rate-limit and client IP tracking
app.set('trust proxy', 1);
const server = http.createServer(app);

const ALLOWED_ORIGINS = [
  'https://aaryainnovtech.com',
  'http://13.232.110.133',
  'https://13.232.110.133',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175',
  'http://127.0.0.1:5000',
];
if (process.env.CLIENT_URL && !ALLOWED_ORIGINS.includes(process.env.CLIENT_URL)) {
  ALLOWED_ORIGINS.push(process.env.CLIENT_URL);
}

const corsOriginChecker = (origin, callback) => {
  // Allow requests with no origin (e.g. mobile apps, curl, Postman, internal services)
  if (!origin) return callback(null, true);
  if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
  try {
    const url = new URL(origin);
    if (
      url.hostname === 'aaryainnovtech.com' || 
      url.hostname === '13.232.110.133' || 
      url.hostname.endsWith('.aaryainnovtech.com') ||
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname.startsWith('192.168.') ||
      url.hostname.startsWith('10.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(url.hostname)
    ) {
      return callback(null, true);
    }
  } catch (e) {}
  return callback(new Error(`CORS blocked: Origin ${origin} not allowed`));
};

const io = new Server(server, {
  cors: {
    origin: corsOriginChecker,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
  }
});
const port = process.env.PORT || 5000;

// Expose io to routes if needed
app.set('io', io);

// ── Socket.IO JWT Authentication Middleware ───────────────────────
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token ||
      (socket.handshake.headers?.authorization && socket.handshake.headers.authorization.split(' ')[1]);

    if (!token) {
      socket.user = null;
      return next(); // Allow guest/public sockets with null user
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userResult = await db.query(
      'SELECT id, username, role, omc_id, ro_id FROM users WHERE id = $1',
      [decoded.id]
    );

    if (userResult.rows.length === 0) {
      socket.user = null;
      return next();
    }

    const user = userResult.rows[0];
    socket.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      omcId: user.omc_id,
      roId: user.ro_id
    };
    next();
  } catch (err) {
    logger.warn(`Socket.IO authentication verification failed: ${err.message}`);
    socket.user = null;
    next();
  }
});

io.on('connection', (socket) => {
  logger.info(`Client connected to WebSockets: ${socket.id} (User: ${socket.user?.username || 'Guest'})`);

  // Secure automatic room assignment based on verified database record
  if (socket.user) {
    const { role, omcId, roId } = socket.user;
    if (role === 'Super Admin') {
      socket.join('super_admin');
      logger.info(`Socket ${socket.id} auto-joined super_admin room`);
    }
    if (omcId) {
      socket.join(`omc_${omcId}`);
      logger.info(`Socket ${socket.id} auto-joined omc_${omcId} room`);
    }
    if (roId) {
      socket.join(`ro_${roId}`);
      logger.info(`Socket ${socket.id} auto-joined ro_${roId} room`);
    }
  }

  // Prevent client from spoofing tenant rooms; verify against authenticated socket.user
  socket.on('join_tenant', () => {
    if (!socket.user) {
      logger.warn(`Unauthenticated socket ${socket.id} attempted to join_tenant. Ignored.`);
      return;
    }
    const { role, omcId, roId } = socket.user;
    if (role === 'Super Admin') socket.join('super_admin');
    if (omcId) socket.join(`omc_${omcId}`);
    if (roId) socket.join(`ro_${roId}`);
  });

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Middleware
app.use(helmet()); // Enterprise Level Security Headers
app.use(cors({
  origin: corsOriginChecker,
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

// Rate Limiting - 500 per 15 min per IP is enough for dashboard polling
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000, // relaxed for multi-user office NAT and dashboard polling
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

// Root & Health Check Routes
app.get('/', (req, res) => {
  res.status(200).json({ success: true, message: 'Petroleum IoT Backend API is running smoothly! 🚀' });
});

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

  // Automated Telemetry Retention Pruning (runs 1 min after startup, then every 24 hours)
  const pruneTelemetry = async () => {
    try {
      const days = parseInt(process.env.TELEMETRY_RETENTION_DAYS, 10) || 60;
      const pruneRes = await db.query(
        "DELETE FROM telemetry_history WHERE created_at < NOW() - (INTERVAL '1 day' * $1)",
        [days]
      );
      if (pruneRes.rowCount > 0) {
        logger.info(`[Retention] Pruned ${pruneRes.rowCount} telemetry records older than ${days} days.`);
      }
    } catch (e) {
      logger.error(`[Retention] Failed to prune telemetry: ${e.message}`);
    }
  };
  setTimeout(pruneTelemetry, 60 * 1000);
  setInterval(pruneTelemetry, 24 * 60 * 60 * 1000);
});

// ── Graceful Shutdown & Process Monitoring ────────────────────────


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

