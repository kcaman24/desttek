const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

function parseCookieToken(header) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === 'dt_token') {
      return part.slice(idx + 1).trim() || null;
    }
  }
  return null;
}

function requireAuth(req, res, next) {
  try {
    const token = parseCookieToken(req.headers.cookie);

    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'desttek',
    });

    req.admin = { id: payload.sub, username: payload.username };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    logger.error('Auth middleware error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { requireAuth };
