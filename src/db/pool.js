const mysql = require('mysql2/promise');
const { db, pool: poolCfg } = require('../config/env');
const pool = mysql.createPool({
  ...db,
  waitForConnections: true,
  connectionLimit: poolCfg.max,
  queueLimit: 0,
  namedPlaceholders: true,
  timezone: '+05:30',
  decimalNumbers: true,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});
module.exports = pool;
