const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');

function normalizeRole(role) {
  const raw = String(role || '').trim().toUpperCase();
  if (raw === 'CUSTOMER') return 'USER';
  if (['DELIVERY_PARTNER','DRIVER','DELIVERY','DELIVERY_BOY'].includes(raw)) return 'RIDER';
  if (['OWNER','RESTAURANT_OWNER','RESTAURANT','MERCHANT'].includes(raw)) return 'SELLER';
  return raw || 'USER';
}

function normalizeUser(payload = {}) {
  const id = payload.id || payload.userId || payload.user_id || payload.sub;
  return {
    ...payload,
    id,
    userId: id,
    role: normalizeRole(payload.role || payload.dbRole),
    dbRole: payload.dbRole || payload.role,
  };
}

function extractToken(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return (
    req.headers['x-auth-token'] ||
    req.headers['x-access-token'] ||
    req.headers.token ||
    (process.env.ALLOW_QUERY_AUTH_TOKEN === 'true' ? req.query.token : null) ||
    null
  );
}

function auth(optional = false) {
  return (req, res, next) => {
    const token = extractToken(req);

    if (!token) {
      if (optional) {
        req.user = null;
        return next();
      }
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    try {
      const decoded = jwt.verify(token, jwtSecret);
      req.user = normalizeUser(decoded);
      return next();
    } catch (error) {
      if (optional) {
        req.user = null;
        req.authError = error.message;
        return next();
      }
      return res.status(401).json({ success: false, message: 'Authentication failed' });
    }
  };
}

const requireAuth = auth(false);
const optionalAuth = auth(true);

const role = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const allowed = roles.map(normalizeRole);
  const actual = normalizeRole(req.user.role || req.user.dbRole);

  if (allowed.length && !allowed.includes(actual)) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  next();
};

module.exports = { auth, requireAuth, optionalAuth, role, normalizeRole };
