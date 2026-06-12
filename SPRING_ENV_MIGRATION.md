# Spring Boot env -> Node.js env compatibility

This backend now reads your existing Spring Boot environment variables directly where practical.

## Supported Spring env names

| Spring Boot env | Node backend behavior |
|---|---|
| `SERVER_PORT` | Used as `PORT` fallback |
| `SERVER_SERVLET_CONTEXT_PATH` | Used as `API_PREFIX` fallback |
| `DB_URL=jdbc:mysql://...` | Parsed automatically into host, port, database and SSL |
| `DB_USERNAME` | Used as database user fallback |
| `DB_PASSWORD` | Used directly |
| `DB_POOL_MAX_SIZE` | Used as MySQL pool connection limit |
| `DB_POOL_MIN_IDLE` | Accepted for compatibility |
| `DDL_AUTO` | Accepted in env but not used; use `npm run db:init` for schema |
| `JWT_SECRET` | Used directly |
| `JWT_EXPIRATION_MS` | Used as token expiry fallback if `JWT_EXPIRES_IN` is missing |
| `RAZORPAY_KEY_ID` | Used directly |
| `RAZORPAY_KEY_SECRET` | Used directly |
| `RAZORPAY_WEBHOOK_SECRET` | Used directly |
| `CLOUDINARY_CLOUD_NAME` | Used directly |
| `CLOUDINARY_API_KEY` | Used directly |
| `CLOUDINARY_API_SECRET` | Used directly |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | Read and preserved for cache/jobs modules |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` | Read and preserved for mail modules |
| `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_SENDER_ID` | Read and preserved for SMS modules |
| `FIREBASE_PROJECT_ID`, `FIREBASE_SERVER_KEY` | Read and preserved for push notification modules |
| `GOOGLE_MAPS_API_KEY` | Read and preserved for map/distance modules |
| `MAX_FILE_SIZE`, `MAX_IMAGE_SIZE_BYTES`, `MAX_REQUEST_SIZE` | Used for request/upload limits |

## Database safety

Do not point this Node backend at your old Spring production database first. Use the same Aiven MySQL service, but create a separate database such as:

```sql
CREATE DATABASE mr_breado_node_staging;
```

Then use:

```env
DB_URL=jdbc:mysql://YOUR_AIVEN_HOST:YOUR_AIVEN_PORT/mr_breado_node_staging?ssl-mode=REQUIRED
DB_USERNAME=avnadmin
DB_PASSWORD=YOUR_PASSWORD
DB_SSL=true
```

Run:

```bash
npm run db:init
npm run dev
```

After all app flows pass, plan a proper data migration from Spring tables to the Node schema.
