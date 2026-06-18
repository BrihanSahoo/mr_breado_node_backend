const fs = require('fs');
const path = require('path');
const pool = require('../src/db/pool');

const IGNORABLE = new Set([1060, 1061, 1091, 1826]); // duplicate column/index/FK names

function statements(sql) {
  return sql.split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean).filter((s) => !s.startsWith('--'));
}

async function main() {
  const dir = path.join(__dirname, '..', 'src', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const connection = await pool.getConnection();
  try {
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      migration_name VARCHAR(190) NOT NULL UNIQUE,
      applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    )`);
    for (const file of files) {
      const [already] = await connection.execute('SELECT 1 FROM schema_migrations WHERE migration_name=?', [file]);
      if (already.length) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const statement of statements(sql)) {
        try { await connection.query(statement); }
        catch (error) {
          if (!IGNORABLE.has(Number(error.errno))) throw error;
          console.warn(`[migration:${file}] compatibility skip: ${error.message}`);
        }
      }
      await connection.execute('INSERT INTO schema_migrations(migration_name) VALUES(?)', [file]);
      console.log(`Applied ${file}`);
    }
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
