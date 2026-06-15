# Mr Breado Single Brand Enterprise V41

V41 converts the system toward the client-requested real-world single-brand outlet ERP:

- No marketplace restaurant concept in core business flow.
- Mr Breado head office manages outlets/branches.
- Admin sets outlet exact latitude/longitude/radius for distance calculation.
- Users can see all outlets, choose any outlet, or use current location to find the nearest outlet.
- Outlet detail exposes contact, map, timings, booking support, and outlet menu.
- Admin can drill into every outlet with a separate business dashboard.
- Outlet dashboard covers sales, online/COD/offline sales, average order value, daily closing calendar, current stock, low stock, stock movements, best foods, slow foods, manager/contact data, bookings, and export.
- Outlet manager closes day with offline sales/expenses while online sales are calculated from backend orders.
- Rider assignment is outlet-aware.

Important: Razorpay v22/v26 public create-order route is unchanged and still mounted before all business routers.

## Main endpoints

- `GET /api/single-brand/v41/version`
- `POST /api/admin/outlets/ensure-enterprise-v41-schema`
- `GET /api/admin/business/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/admin/outlets`
- `POST /api/admin/outlets`
- `PUT /api/admin/outlets/{id}`
- `POST /api/admin/outlets/{id}/set-location`
- `GET /api/admin/outlets/{id}/full-dashboard?from=&to=`
- `GET /api/admin/outlets/{id}/stock-ledger`
- `POST /api/admin/outlets/{id}/stock`
- `POST /api/outlet-manager/day-close`
- `GET /api/outlets/nearest?lat=&lng=`
- `GET /api/menu/nearest?lat=&lng=`
- `GET /api/outlets/{id}/menu`
- `GET /api/outlets/{id}/contact`
- `POST /api/outlets/{id}/bookings`
- `GET /api/admin/reports/outlet-accounting.csv?outletId=&from=&to=`
