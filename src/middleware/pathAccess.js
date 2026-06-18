const { requireAuth, role } = require('./auth');

const PUBLIC_AUTH_SUFFIXES = [
  '/admin/login',
  '/admin/auth/login',
  '/outlet/auth/login',
  '/outlet-manager/login',
  '/seller/outlet-login',
];

function isPublicAuth(req) {
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  return PUBLIC_AUTH_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

function authUnlessPublic(req, res, next) {
  return isPublicAuth(req) ? next() : requireAuth(req, res, next);
}

function rolesUnlessPublic(...roles) {
  const guard = role(...roles);
  return (req, res, next) => isPublicAuth(req) ? next() : guard(req, res, next);
}

module.exports = function applyPathAccess(app, apiPrefix) {
  app.use(`${apiPrefix}/admin`, authUnlessPublic, rolesUnlessPublic('ADMIN'));
  app.use(`${apiPrefix}/seller`, authUnlessPublic, rolesUnlessPublic('ADMIN', 'SELLER', 'OUTLET_MANAGER'));
  app.use(`${apiPrefix}/outlet-manager`, authUnlessPublic, rolesUnlessPublic('ADMIN', 'SELLER', 'OUTLET_MANAGER'));
  app.use(`${apiPrefix}/rider`, requireAuth, role('ADMIN', 'RIDER'));
  app.use(`${apiPrefix}/delivery`, requireAuth, role('ADMIN', 'RIDER'));
};

module.exports.isPublicAuth = isPublicAuth;
