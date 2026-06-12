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
  await seed(conn);
  await conn.end();
  console.log(`Database initialized and Spring-schema compatibility migration applied: ${dbName}`);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
