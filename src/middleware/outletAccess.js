const { one } = require('../utils/db');
const { normalizeRole } = require('./auth');

function requestedOutletId(req) {
  return Number(req.params?.outletId || req.params?.outlet_id || req.query?.outletId || req.query?.outlet_id ||
    req.body?.outletId || req.body?.outlet_id || req.body?.restaurantId || req.body?.restaurant_id || 0) || null;
}

async function sellerHasOutlet(userId, outletId) {
  if (!userId || !outletId) return false;
  const row = await one(`SELECT 1 ok FROM outlet_seller_assignments
    WHERE outlet_id=:outletId AND seller_id=:userId AND COALESCE(is_active,1)=1 LIMIT 1`, { outletId, userId });
  return Boolean(row);
}

function requireOutletAccess({ allowAdmin = true } = {}) {
  return async (req, res, next) => {
    try {
      const role = normalizeRole(req.user?.role || req.user?.dbRole);
      const outletId = requestedOutletId(req);
      if (!outletId) return res.status(400).json({ success:false, message:'Outlet is required', code:'OUTLET_REQUIRED' });
      if (allowAdmin && role === 'ADMIN') { req.authorizedOutletId = outletId; return next(); }
      if (role !== 'SELLER' && role !== 'OUTLET_MANAGER') return res.status(403).json({ success:false, message:'Outlet access denied' });
      if (!(await sellerHasOutlet(req.user.id, outletId))) return res.status(403).json({ success:false, message:'Outlet access denied' });
      req.authorizedOutletId = outletId; return next();
    } catch (error) { next(error); }
  };
}

module.exports = { requestedOutletId, sellerHasOutlet, requireOutletAccess };
