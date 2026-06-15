# Mr Breado Single Brand Enterprise Outlet System v40

This build converts the business model to a dedicated Mr Breado multi-outlet system.

## Locked payment rule
The Razorpay v22/v26 public create-order route is intentionally kept before all routers in `src/app.js`.
Do not move it below any auth middleware.

## Business model
- No marketplace restaurants.
- No public seller registration.
- No restaurant payout module.
- No restaurant approval flow.
- Admin/head office creates outlets.
- Admin creates outlet login credentials.
- Outlet manager logs in and operates assigned outlet only.
- User can find nearest outlet or manually choose another outlet.
- Rider/delivery boy is assigned internally to an outlet.

## New backend route
`src/routes/singleBrandEnterpriseV40.js`

## Important endpoints

### Schema
POST `/api/admin/outlets/ensure-enterprise-schema`

### Admin business dashboard
GET `/api/admin/business/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD`

### Outlets
GET `/api/admin/outlets`
POST `/api/admin/outlets`
PUT `/api/admin/outlets/:id`

### Outlet login credentials
POST `/api/admin/outlets/:id/credentials`
Body:
```json
{
  "name":"Outlet Manager",
  "phone":"9999999999",
  "email":"manager@mrbreado.com",
  "username":"barasat-outlet",
  "password":"ChangeMe123"
}
```

### Outlet login
POST `/api/outlet/auth/login`
Body:
```json
{
  "username":"barasat-outlet",
  "password":"ChangeMe123"
}
```

### User outlet discovery
GET `/api/outlets/nearest?lat=22.5726&lng=88.3639`
GET `/api/outlets/:id/menu`
GET `/api/menu/nearest?lat=22.5726&lng=88.3639`

### Outlet manager operations
GET `/api/outlet-manager/me`
GET `/api/outlet-manager/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD`
POST `/api/outlet-manager/stock`
POST `/api/outlet-manager/close-day`

### Admin outlet analytics
GET `/api/admin/outlets/:id/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD`
GET `/api/admin/outlets/:id/performance?from=YYYY-MM-DD&to=YYYY-MM-DD`
GET `/api/admin/reports/accounting-export.csv?from=YYYY-MM-DD&to=YYYY-MM-DD`

## Database tables
- `outlets`
- `outlet_manager_accounts`
- `outlet_product_stock`
- `outlet_stock_movements`
- `outlet_daily_closings`
- `outlet_product_daily_stats`
- `outlet_delivery_boys`
- `outlet_order_assignments`
- `accounting_export_logs`

## Daily outlet close flow
1. Outlet manager closes outlet.
2. Backend calculates online/COD order sales for the date.
3. Outlet manager submits offline sales manually.
4. `outlet_daily_closings` stores the business ledger for that day.
5. Admin can view it calendar-wise and export CSV for accounting/EzoBooks.

## Admin business view
Admin can track:
- Daily outlet sales.
- Online/COD/offline sales.
- Outlet stock.
- Best-selling foods by outlet.
- Slow-selling foods by outlet.
- Low-stock foods.
- Outlet manager credentials.
- Delivery boy assignment.
