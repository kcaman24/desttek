require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const path = require('path');

const { initDB } = require('./db');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const logger = require('./utils/logger');

// ── Validate required env vars ─────────────────────────────────
const REQUIRED_ENV = ['JWT_SECRET', 'ADMIN_USERNAME', 'ADMIN_PASSWORD'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  logger.error('Missing required environment variables', { missing });
  process.exit(1);
}

if (
  process.env.JWT_SECRET === 'CHANGE_THIS_TO_A_LONG_RANDOM_SECRET_MIN_64_CHARS' ||
  process.env.JWT_SECRET.length < 64
) {
  logger.error('JWT_SECRET is insecure. Generate with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
  process.exit(1);
}

// ── Init DB ────────────────────────────────────────────────────
initDB();

// ── App ────────────────────────────────────────────────────────
const app = express();

// Trust proxy (needed for correct IP behind Render/nginx)
app.set('trust proxy', 1);

// ── Security headers (Helmet) ──────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Remove X-Powered-By
app.disable('x-powered-by');

// ── CORS ───────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow server-to-server
    if (allowedOrigins.includes(origin)) return cb(null, true);
    logger.warn('CORS blocked', { origin });
    cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,
}));

// ── Body parsing ───────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

// ── Compression ───────────────────────────────────────────────
app.use(compression());

// ── Request logging ───────────────────────────────────────────
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
  skip: (req) => req.path === '/health',
}));

// ── Rate limiting ─────────────────────────────────────────────
const publicLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_PUBLIC) || 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' },
});

const adminLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_ADMIN) || 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_AUTH) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  skipSuccessfulRequests: true,
});

// ── Routes ────────────────────────────────────────────────────
app.use('/api', publicLimiter, apiRoutes);
app.use('/admin/auth', authLimiter, adminRoutes);
app.use('/admin', adminLimiter, adminRoutes);

// ── Static files ───────────────────────────────────────────────
// Public site
app.use('/', express.static(path.join(__dirname, '../../frontend'), {
  etag: true,
  lastModified: true,
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
}));

// Admin panel — served at /panel
app.use('/panel', express.static(path.join(__dirname, '../../admin'), {
  etag: true,
  lastModified: true,
}));

// ── Health check ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    app: process.env.APP_NAME || 'DESTTEK',
    uptime: Math.floor(process.uptime()),
  });
});

// ── 404 ────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, _next) => {
  // Don't leak stack traces in production
  logger.error('Unhandled error', { error: err.message, stack: err.stack, path: req.path });
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// ── Start ─────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 3000;
const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(`${process.env.APP_NAME || 'DESTTEK'} running`, {
    port: PORT,
    env: process.env.NODE_ENV,
    panel: `http://localhost:${PORT}/panel`,
    api:   `http://localhost:${PORT}/api`,
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
});

module.exports = app;
