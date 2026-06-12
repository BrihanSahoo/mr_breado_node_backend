const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { db, dbName } = require('../config/env');

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    'SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
    [table]
  );
  return rows[0].c > 0;
}

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    'SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    [table, column]
  );
  return rows[0].c > 0;
}

async function addColumnIfMissing(conn, table, column, definition) {
  const hasTable = await tableExists(conn, table);
  if (!hasTable) return;
  const hasColumn = await columnExists(conn, table, column);
  if (!hasColumn) {
    console.log(`Adding missing column ${table}.${column}`);
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}

async function runStatements(conn, sql) {
  const statements = sql
    .split(/;\s*(?:\n|$)/)
    .map(s => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    try {
      await conn.query(statement);
    } catch (error) {
      // Existing Spring tables may not match the Node schema. CREATE IF NOT EXISTS is safe,
      // but seed inserts can fail until compatibility columns are added below.
      if (/INSERT IGNORE INTO/i.test(statement)) {
        console.warn(`Seed skipped before compatibility migration: ${error.message}`);
      } else {
        throw error;
      }
    }
  }
}

async function applyCompatibilityMigration(conn) {
  await addColumnIfMissing(conn, 'restaurants', 'owner_id', 'BIGINT NULL');
  await addColumnIfMissing(conn, 'restaurants', 'slug', 'VARCHAR(220) NULL');
  await addColumnIfMissing(conn, 'restaurants', 'description', 'TEXT NULL');
  await addColumnIfMissing(conn, 'restaurants', 'image_url', 'TEXT NULL');
  await addColumnIfMissing(conn, 'restaurants', 'address', 'TEXT NULL');
  await addColumnIfMissing(conn, 'restaurants', 'latitude', 'DECIMAL(10,7) NULL');
  await addColumnIfMissing(conn, 'restaurants', 'longitude', 'DECIMAL(10,7) NULL');
  await addColumnIfMissing(conn, 'restaurants', 'rating', 'DECIMAL(3,2) DEFAULT 4.5');
  await addColumnIfMissing(conn, 'restaurants', 'delivery_radius_km', 'DECIMAL(8,2) DEFAULT 8');
  await addColumnIfMissing(conn, 'restaurants', 'minimum_order', 'DECIMAL(10,2) DEFAULT 99');
  await addColumnIfMissing(conn, 'restaurants', 'is_open', 'BOOLEAN DEFAULT TRUE');
  await addColumnIfMissing(conn, 'restaurants', 'verification_status', "VARCHAR(40) DEFAULT 'PENDING'");
  await addColumnIfMissing(conn, 'restaurants', 'visibility_status', "VARCHAR(40) DEFAULT 'VISIBLE'");
  await addColumnIfMissing(conn, 'restaurants', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
  await addColumnIfMissing(conn, 'restaurants', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

  await addColumnIfMissing(conn, 'products', 'restaurant_id', 'BIGINT NULL');
  await addColumnIfMissing(conn, 'products', 'name', "VARCHAR(180) NOT NULL DEFAULT ''");
  await addColumnIfMissing(conn, 'products', 'category_id', 'BIGINT NULL');
  await addColumnIfMissing(conn, 'products', 'brand_id', 'BIGINT NULL');
  await addColumnIfMissing(conn, 'products', 'slug', 'VARCHAR(220) NULL');
  await addColumnIfMissing(conn, 'products', 'description', 'TEXT NULL');
  await addColumnIfMissing(conn, 'products', 'image_url', 'TEXT NULL');
  await addColumnIfMissing(conn, 'products', 'price', 'DECIMAL(10,2) NOT NULL DEFAULT 0');
  await addColumnIfMissing(conn, 'products', 'discount_price', 'DECIMAL(10,2) NULL');
  await addColumnIfMissing(conn, 'products', 'veg', 'BOOLEAN DEFAULT TRUE');
  await addColumnIfMissing(conn, 'products', 'available', 'BOOLEAN DEFAULT TRUE');
  await addColumnIfMissing(conn, 'products', 'rating', 'DECIMAL(3,2) DEFAULT 4.4');
  await addColumnIfMissing(conn, 'products', 'stock', 'INT DEFAULT 100');
  await addColumnIfMissing(conn, 'products', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
  await addColumnIfMissing(conn, 'products', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

  await addColumnIfMissing(conn, 'categories', 'name', "VARCHAR(120) NOT NULL DEFAULT ''");
  await addColumnIfMissing(conn, 'categories', 'slug', 'VARCHAR(160) NULL');
  await addColumnIfMissing(conn, 'categories', 'image_url', 'TEXT NULL');
  await addColumnIfMissing(conn, 'categories', 'parent_id', 'BIGINT NULL');
  await addColumnIfMissing(conn, 'categories', 'active', 'BOOLEAN DEFAULT TRUE');
  await addColumnIfMissing(conn, 'categories', 'sort_order', 'INT DEFAULT 0');

  await addColumnIfMissing(conn, 'brands', 'name', "VARCHAR(120) NOT NULL DEFAULT ''");
  await addColumnIfMissing(conn, 'brands', 'slug', 'VARCHAR(160) NULL');
  await addColumnIfMissing(conn, 'brands', 'image_url', 'TEXT NULL');
  await addColumnIfMissing(conn, 'brands', 'active', 'BOOLEAN DEFAULT TRUE');

  await addColumnIfMissing(conn, 'offers', 'title', 'VARCHAR(180) NULL');
  await addColumnIfMissing(conn, 'offers', 'code', 'VARCHAR(60) NULL');
  await addColumnIfMissing(conn, 'offers', 'type', 'VARCHAR(60) NULL');
  await addColumnIfMissing(conn, 'offers', 'discount_type', "VARCHAR(40) DEFAULT 'FLAT'");
  await addColumnIfMissing(conn, 'offers', 'discount_value', 'DECIMAL(10,2) DEFAULT 0');
  await addColumnIfMissing(conn, 'offers', 'min_order', 'DECIMAL(10,2) DEFAULT 0');
  await addColumnIfMissing(conn, 'offers', 'image_url', 'TEXT NULL');
  await addColumnIfMissing(conn, 'offers', 'active', 'BOOLEAN DEFAULT TRUE');
  await addColumnIfMissing(conn, 'offers', 'starts_at', 'DATETIME NULL');
  await addColumnIfMissing(conn, 'offers', 'ends_at', 'DATETIME NULL');
}



async function applyPaymentCompatibilityMigration(conn) {
  await conn.query(`CREATE TABLE IF NOT EXISTS payment_settings (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    cod_enabled BIT(1) NOT NULL DEFAULT b'1',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    online_payment_enabled BIT(1) NOT NULL DEFAULT b'0',
    razorpay_key_id VARCHAR(255) NULL,
    razorpay_key_secret_encrypted TEXT NULL,
    razorpay_mode VARCHAR(20) NOT NULL DEFAULT 'TEST',
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_by BIGINT NULL
  )`);

  await conn.query(`CREATE TABLE IF NOT EXISTS platform_settings (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    business_address TEXT NULL,
    business_latitude DECIMAL(10,7) NULL,
    business_longitude DECIMAL(10,7) NULL,
    cod_enabled BIT(1) NOT NULL DEFAULT b'1',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    delivery_charge_per_km DECIMAL(10,2) NOT NULL DEFAULT 8.00,
    maximum_delivery_charge DECIMAL(10,2) NOT NULL DEFAULT 120.00,
    minimum_delivery_charge DECIMAL(10,2) NOT NULL DEFAULT 25.00,
    mr_breado_takeaway_enabled BIT(1) NOT NULL DEFAULT b'1',
    online_payment_enabled BIT(1) NOT NULL DEFAULT b'0',
    razorpay_key_id VARCHAR(120) NULL,
    razorpay_key_secret_encrypted TEXT NULL,
    razorpay_mode VARCHAR(20) NOT NULL DEFAULT 'TEST',
    support_email VARCHAR(120) NULL,
    support_phone VARCHAR(20) NULL,
    takeaway_booking_fee_percent DECIMAL(5,2) NOT NULL DEFAULT 20.00,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_by BIGINT NULL,
    rider_delivery_pay_per_km DECIMAL(10,2) NOT NULL DEFAULT 6.00,
    minimum_rider_delivery_pay DECIMAL(10,2) NOT NULL DEFAULT 20.00,
    google_distance_enabled BIT(1) NOT NULL DEFAULT b'0',
    google_maps_api_key_encrypted TEXT NULL
  )`);

  await conn.query(`CREATE TABLE IF NOT EXISTS payment_transactions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    failed_at DATETIME(6) NULL,
    failure_reason VARCHAR(600) NULL,
    paid_at DATETIME(6) NULL,
    provider VARCHAR(40) NOT NULL DEFAULT 'RAZORPAY',
    provider_order_id VARCHAR(120) NULL,
    provider_payment_id VARCHAR(120) NULL,
    provider_response LONGTEXT NULL,
    provider_signature VARCHAR(500) NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'CREATED',
    updated_at DATETIME(6) NULL,
    order_id BIGINT NULL,
    user_id BIGINT NULL
  )`);

  await conn.query(`CREATE TABLE IF NOT EXISTS payment_settings_history (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    payment_settings_id BIGINT NULL,
    cod_enabled BIT(1) NOT NULL DEFAULT b'1',
    online_payment_enabled BIT(1) NOT NULL DEFAULT b'0',
    razorpay_key_id VARCHAR(255) NULL,
    razorpay_mode VARCHAR(20) NOT NULL DEFAULT 'TEST',
    secret_changed BIT(1) NOT NULL DEFAULT b'0',
    changed_by BIGINT NULL,
    change_note VARCHAR(500) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
  )`);

  await conn.query(`CREATE TABLE IF NOT EXISTS payment_gateway_audit_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    provider VARCHAR(40) NOT NULL DEFAULT 'RAZORPAY',
    action VARCHAR(80) NOT NULL,
    user_id BIGINT NULL,
    order_id BIGINT NULL,
    restaurant_id BIGINT NULL,
    seller_id BIGINT NULL,
    payment_transaction_id BIGINT NULL,
    provider_order_id VARCHAR(120) NULL,
    provider_payment_id VARCHAR(120) NULL,
    amount DECIMAL(12,2) NULL,
    status VARCHAR(40) NULL,
    message VARCHAR(700) NULL,
    raw_payload LONGTEXT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
  )`);

  await addColumnIfMissing(conn, 'payment_transactions', 'failed_at', 'DATETIME(6) NULL');
  await addColumnIfMissing(conn, 'payment_transactions', 'failure_reason', 'VARCHAR(600) NULL');
  await addColumnIfMissing(conn, 'payment_transactions', 'paid_at', 'DATETIME(6) NULL');
  await addColumnIfMissing(conn, 'payment_transactions', 'updated_at', 'DATETIME(6) NULL');
  await addColumnIfMissing(conn, 'payment_transactions', 'provider_response', 'LONGTEXT NULL');
  try { await conn.query('ALTER TABLE payment_transactions MODIFY COLUMN user_id BIGINT NULL'); } catch (_) {}
  try { await conn.query('ALTER TABLE payment_transactions MODIFY COLUMN order_id BIGINT NULL'); } catch (_) {}

  const [settingsRows] = await conn.query('SELECT COUNT(*) c FROM payment_settings');
  if (settingsRows[0].c === 0) {
    await conn.query(`INSERT INTO payment_settings
      (cod_enabled, online_payment_enabled, razorpay_key_id, razorpay_key_secret_encrypted, razorpay_mode, created_at, updated_at)
      VALUES (b'1', b'0', NULL, NULL, 'TEST', NOW(6), NOW(6))`);
  }
}

async function seed(conn) {
  const seedStatements = [
    "INSERT IGNORE INTO categories(id,name,slug,image_url) VALUES (1,'Pizza','pizza',''),(2,'Burger','burger',''),(3,'Cake','cake',''),(4,'Biryani','biryani','')",
    "INSERT IGNORE INTO restaurants(id,name,slug,description,rating,is_open,verification_status,visibility_status) VALUES (1,'Mr Breado','mr-breado','Official Mr Breado kitchen',4.7,true,'APPROVED','VISIBLE')",
    "INSERT IGNORE INTO products(id,restaurant_id,category_id,name,slug,description,price,discount_price,veg,rating) VALUES (1,1,1,'Cheese Burst Pizza','cheese-burst-pizza','Freshly baked pizza',249,199,true,4.5),(2,1,2,'Crispy Burger','crispy-burger','Loaded burger',149,129,true,4.4),(3,1,3,'Chocolate Cake','chocolate-cake','Premium cake slice',99,89,true,4.6)",
    "INSERT IGNORE INTO coupons(code,discount_type,discount_value,min_order,max_discount,active) VALUES ('WELCOME50','FLAT',50,199,50,true),('BREADO10','PERCENT',10,299,80,true)"
  ];

  for (const statement of seedStatements) {
    try {
      await conn.query(statement);
    } catch (error) {
      console.warn(`Seed statement skipped after compatibility migration: ${error.message}`);
    }
  }
}

(async () => {
  const conn = await mysql.createConnection({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    ssl: db.ssl,
    multipleStatements: true,
  });
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
  await conn.query(`USE \`${dbName}\``);
  await runStatements(conn, fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  await applyCompatibilityMigration(conn);
  await applyPaymentCompatibilityMigration(conn);
  await seed(conn);
  await conn.end();
  console.log(`Database initialized and Spring-schema compatibility migration applied: ${dbName}`);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
