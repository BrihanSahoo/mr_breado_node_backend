# Backend Current State

The backend remains a compatibility-oriented Express application with historical v16-v62 routers. Security-sensitive payment and order-lifecycle endpoints are now mounted before legacy routers. Runtime schema creation still exists in historical modules and is disabled by default where supported; production deployments must run versioned migrations before startup.

Canonical controls added:
- authenticated Razorpay aliases with server-side amount resolution;
- centralized path-level RBAC;
- canonical order status transition service with immutable events;
- explicit seller-to-outlet assignment model;
- production encryption-key requirement;
- query-string JWT disabled by default.
