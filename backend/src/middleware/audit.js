const { queries } = require('../db');
const logger = require('../utils/logger');

function audit(action, getTarget) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      // Only audit successful mutating operations
      if (res.statusCode < 400) {
        try {
          const target = getTarget ? getTarget(req, body) : null;
          const ip = req.ip || req.connection?.remoteAddress || 'unknown';
          const ua = req.headers['user-agent']?.substring(0, 200) || '';
          queries.insertAudit(req.admin?.id || null, action, target, ip, ua);
        } catch (e) {
          logger.warn('Audit log failed', { error: e.message });
        }
      }
      return originalJson(body);
    };
    next();
  };
}

module.exports = { audit };
