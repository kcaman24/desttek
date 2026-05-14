const winston = require('winston');
const path = require('path');

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

const devFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}]: ${stack || message}`;
});

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    json()
  ),
  defaultMeta: { service: process.env.APP_NAME || 'DESTTEK' },
  transports: [
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production'
        ? combine(timestamp(), json())
        : combine(colorize(), timestamp({ format: 'HH:mm:ss' }), devFormat)
    })
  ]
});

// Never log sensitive fields
const REDACT = ['password', 'token', 'secret', 'authorization', 'cookie'];
logger.redact = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  const clean = { ...obj };
  REDACT.forEach(k => { if (clean[k]) clean[k] = '[REDACTED]'; });
  return clean;
};

module.exports = logger;
