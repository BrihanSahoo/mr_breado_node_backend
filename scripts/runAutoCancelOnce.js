// Run from one cron/worker process only. Example: every minute with a platform scheduler.
const router = require('../src/routes/singleBrandEnterpriseV62');
const { pool } = require('../src/utils/db');

Promise.resolve(router.cancelExpiredOrders())
  .then(() => console.log('Auto-cancellation scan completed'))
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => pool.end());
