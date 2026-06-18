# Outlet inventory and category fix

## Corrected endpoints
- `GET /api/admin/categories`
- `POST /api/admin/categories`
- `PUT /api/admin/categories/:id`
- `PATCH /api/admin/categories/:id/status`
- `DELETE /api/admin/categories/:id`
- `GET /api/admin/outlets/:id/available-products`
- `POST /api/admin/outlets/:id/stock`
- `GET /api/admin/outlets/:id/full-dashboard`

## Required deployment step
Run `npm run migrate` before restarting the backend.

## Verification
- JavaScript syntax checks passed.
- 11 backend tests passed.
- Admin client and SSR production builds passed.
