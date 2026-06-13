const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');

function normalizeRole(role) {
  const raw = String(role || '').trim().toUpperCase();
  if (raw === 'CUSTOMER') return 'USER';
  if (raw === 'DELIVERY_PARTNER') return 'RIDER';
  if (raw === 'DRIVER') return 'RIDER';
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


function isPublicPaymentRoute(req) {
  const path = String(req.originalUrl || req.url || '').split('?')[0].toLowerCase();
  const method = String(req.method || '').toUpperCase();
  if (method !== 'POST') return false;
  return path.endsWith('/payments/create-order') ||
    path.endsWith('/payment/create-order') ||
    path.endsWith('/razorpay/create-order') ||
    path.endsWith('/payments/razorpay/create-order') ||
    path.endsWith('/checkout/razorpay/create-order') ||
    path.endsWith('/checkout/payment/create-order') ||
    path.endsWith('/payments/verify') ||
    path.endsWith('/payment/verify') ||
    path.endsWith('/razorpay/verify') ||
    path.endsWith('/payments/razorpay/verify') ||
    path.endsWith('/checkout/razorpay/verify') ||
    path.endsWith('/checkout/payment/verify');
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
    req.query.token ||
    null
  );
}

function auth(optional = false) {
  return (req, res, next) => {
    // Razorpay create-order/verify must stay compatible with the previously working v22 flow.
    // Some legacy routers still wrap these URLs with requireAuth before the direct route is reached;
    // this hard bypass prevents any stale/expired/missing token from blocking Razorpay checkout.
    if (isPublicPaymentRoute(req)) {
      req.user = null;
      return next();
    }

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
