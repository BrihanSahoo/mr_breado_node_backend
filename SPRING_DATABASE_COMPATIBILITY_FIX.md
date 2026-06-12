# Spring Database Compatibility Fix

If you point this Node backend at the existing Spring Boot Aiven database, some tables may already exist but with different columns. `CREATE TABLE IF NOT EXISTS` does not alter existing tables. Therefore, the database initializer now checks and adds the Node compatibility columns needed by the API routes.

Run:

```bash
rm -rf node_modules package-lock.json
npm install
npm run db:init
npm run dev
```

If you do not want the existing Spring tables altered, create a separate Aiven database and use that database name in `DB_URL` before running `npm run db:init`.
