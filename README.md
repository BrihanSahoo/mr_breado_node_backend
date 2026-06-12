# Mr Breado Node.js Backend

Express + MySQL backend created as a route-compatible replacement for the uploaded Spring Boot backend. Base path is `/api`, matching the existing Flutter apps and admin web.

## Main fixes included

- Same endpoint paths for current client, seller, rider and admin apps.
- Compatibility aliases for app routes missing/inconsistent in Spring, including `/auth/me`, `/auth/update-profile`, `/delivery/orders/:id/location`, `/notifications/settings`, and public payment/platform settings.
- Razorpay order creation and HMAC signature verification implemented correctly. If Razorpay keys are absent, create-order returns a safe mock order for local development only.
- Consistent response shape: `{ success, message, data }`.
- JWT auth, bcrypt password hashing, rate limiting, Helmet, CORS, compression.
- MySQL schema + seed data included.
- Cloudinary upload support with local fallback response if env keys are absent.

## Run locally

```bash
cp .env.example .env
npm install
npm run db:init
npm run dev
```

## Production

Set strong `JWT_SECRET`, MySQL credentials, Razorpay keys, Cloudinary keys, and `NODE_ENV=production`.

```bash
npm ci --omit=dev
npm run db:init
npm start
```

## Important files

- `src/db/schema.sql` — complete initial MySQL schema and seed rows.
- `src/routes/*` — all API route modules.
- `src/services/paymentService.js` — Razorpay create/verify logic.
- `.env.example` — required environment variables.

## Notes

This backend preserves the route contract and implements production-ready foundations. Some admin/reporting endpoints intentionally return compatible empty/default datasets until real business data is created through the app. The database schema is intentionally simpler than the Spring JPA model but includes the entities required by the apps: users, restaurants, categories, brands, products, cart, addresses, orders, payments, offers, coupons, notifications, reviews, support tickets and live delivery locations.


V10: payment create-order direct public route before auth routers.
