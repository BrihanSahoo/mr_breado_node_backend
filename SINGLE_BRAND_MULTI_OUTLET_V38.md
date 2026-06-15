# Mr Breado v38 - Single Brand Multi Outlet Upgrade

This update changes the business model from marketplace restaurants to a single-brand multi-outlet system.

## Locked Razorpay rule
The working v22/v26 Razorpay create-order route is kept before every other router. Do not move it.

## New backend endpoints

- `POST /api/admin/outlets/ensure-schema`
- `GET /api/outlets`
- `GET /api/admin/outlets`
- `POST /api/admin/outlets`
- `PUT /api/admin/outlets/:id`
- `GET /api/outlets/nearest?lat=&lng=`
- `GET /api/menu/nearest?lat=&lng=`
- `GET /api/outlets/:id/menu`
- `POST /api/admin/outlets/:id/stock`
- `GET /api/admin/outlet-dashboard`
- `GET /api/admin/head-office/dashboard`
- `GET /api/admin/delivery-boys`
- `POST /api/admin/outlets/:outletId/delivery-boys/:userId`
- `GET /api/admin/reports/outlet-sales?from=YYYY-MM-DD&to=YYYY-MM-DD`

## Tables created automatically

- `outlets`
- `outlet_product_stock`
- `outlet_delivery_boys`
- `outlet_sales_daily`
- `accounting_export_logs`
- `admin_action_logs`

## App/web required mapping

- Admin web: Restaurants menu should become Outlets/Branches.
- Seller app: should become Outlet Manager app. Do not show seller registration for marketplace sellers.
- User app: detect user latitude/longitude, call `/api/outlets/nearest`, then load `/api/menu/nearest`.
- Rider app: delivery boys must be assigned to an outlet using `outlet_delivery_boys`.

## First deployment command

Use once on Render/local after deploying this build:

```bash
curl -X POST "https://mr-breado-node-backend.onrender.com/api/admin/outlets/ensure-schema"
```

Then verify:

```bash
curl "https://mr-breado-node-backend.onrender.com/api/single-brand/version"
curl "https://mr-breado-node-backend.onrender.com/api/admin/outlets"
```
