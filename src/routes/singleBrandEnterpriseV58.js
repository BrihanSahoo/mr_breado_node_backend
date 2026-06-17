const express = require('express');
const router = express.Router();
const ah = require('../utils/asyncHandler');
const { ok } = require('../utils/respond');
const { one, many, exec } = require('../utils/db');

async function tryMany(sql, params = {}) { try { return await many(sql, params); } catch (_) { return []; } }
async function tryOne(sql, params = {}) { try { return await one(sql, params); } catch (_) { return null; } }
async function tryExec(sql, params = {}) { try { return await exec(sql, params); } catch (_) { return null; } }
function n(v, d = 0) { const x = Number(v); return Number.isFinite(x) ? x : d; }
function b(v, d = true) { if (v === undefined || v === null || v === '') return d; if (Buffer.isBuffer(v)) return v[0] === 1; if (typeof v === 'boolean') return v; if (typeof v === 'number') return v !== 0; return !['0','false','no','inactive','disabled'].includes(String(v).toLowerCase()); }
function q(v) { return '`' + String(v).replace(/`/g, '``') + '`'; }
async function cols(table) { const rows = await tryMany(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table`, { table }); return new Set(rows.map(r => r.COLUMN_NAME || r.column_name)); }
function pick(set, names) { return names.find(x => set.has(x)); }

async function ensureSchema() {
  await tryExec(`CREATE TABLE IF NOT EXISTS outlet_product_stock (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    stock_qty DECIMAL(12,2) NOT NULL DEFAULT 0,
    min_stock_qty DECIMAL(12,2) NOT NULL DEFAULT 5,
    prep_time_minutes INT NOT NULL DEFAULT 15,
    is_available TINYINT(1) NOT NULL DEFAULT 1,
    unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
    selling_price DECIMAL(12,2) NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_outlet_product(outlet_id, product_id)
  )`);
  for (const col of [
    'stock_qty DECIMAL(12,2) NOT NULL DEFAULT 0',
    'min_stock_qty DECIMAL(12,2) NOT NULL DEFAULT 5',
    'prep_time_minutes INT NOT NULL DEFAULT 15',
    'is_available TINYINT(1) NOT NULL DEFAULT 1',
    'unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0',
    'selling_price DECIMAL(12,2) NOT NULL DEFAULT 0'
  ]) await tryExec(`ALTER TABLE outlet_product_stock ADD COLUMN ${col}`);
}

async function productCatalog() {
  const pc = await cols('products');
  if (!pc.size) return [];
  const idCol = pick(pc, ['id','product_id']) || 'id';
  const nameParts = ['name','title','product_name','food_name','item_name'].filter(x => pc.has(x)).map(x => `NULLIF(p.${q(x)},'')`);
  const imageParts = ['image_url','image','photo_url','thumbnail_url'].filter(x => pc.has(x)).map(x => `NULLIF(p.${q(x)},'')`);
  const priceCol = pick(pc, ['price','base_price','selling_price','amount','mrp']);
  const vegCol = pick(pc, ['is_veg','veg','vegetarian']);
  const catIdCol = pick(pc, ['food_category_id','category_id','menu_category_id']);
  const foodTypeCol = pick(pc, ['food_type','type','category_name']);
  const availableCol = pick(pc, ['is_available','available','active','enabled']);
  const deletedCol = pick(pc, ['deleted','is_deleted']);
  const fc = await cols('food_categories');
  const catPk = pick(fc, ['id','category_id']);
  const catNameCol = pick(fc, ['name','title','category_name']);
  const join = catIdCol && catPk ? `LEFT JOIN food_categories c ON c.${q(catPk)}=p.${q(catIdCol)}` : '';
  const catExpr = catNameCol ? `COALESCE(NULLIF(c.${q(catNameCol)},''), ${foodTypeCol ? `NULLIF(p.${q(foodTypeCol)},'')` : "'Other'"}, 'Other')` : (foodTypeCol ? `COALESCE(NULLIF(p.${q(foodTypeCol)},''),'Other')` : `'Other'`);
  const sql = `SELECT p.${q(idCol)} id,
    ${nameParts.length ? `COALESCE(${nameParts.join(',')},CONCAT('Food #',p.${q(idCol)}))` : `CONCAT('Food #',p.${q(idCol)})`} productName,
    ${imageParts.length ? `COALESCE(${imageParts.join(',')},'')` : `''`} imageUrl,
    ${priceCol ? `COALESCE(p.${q(priceCol)},0)` : '0'} price,
    ${vegCol ? `p.${q(vegCol)}` : '1'} isVegRaw,
    ${catIdCol ? `p.${q(catIdCol)}` : 'NULL'} categoryId,
    ${catExpr} categoryName,
    ${availableCol ? `p.${q(availableCol)}` : '1'} availableRaw
    FROM products p ${join}
    WHERE ${deletedCol ? `COALESCE(p.${q(deletedCol)},0)=0` : '1=1'}
    ORDER BY p.${q(idCol)} DESC LIMIT 1000`;
  const rows = await tryMany(sql);
  return rows.map(x => ({
    id: x.id,
    productId: x.id,
    productName: x.productName,
    name: x.productName,
    title: x.productName,
    imageUrl: x.imageUrl || '',
    image: x.imageUrl || '',
    price: n(x.price),
    isVeg: b(x.isVegRaw, true),
    veg: b(x.isVegRaw, true),
    categoryId: x.categoryId,
    categoryName: x.categoryName || 'Other',
    isAvailable: b(x.availableRaw, true),
  }));
}

async function stockRows(outletId) {
  await ensureSchema();
  const sc = await cols('outlet_product_stock');
  const stockCol = pick(sc, ['stock_qty','stock_quantity','quantity']) || 'stock_qty';
  const lowCol = pick(sc, ['min_stock_qty','low_stock_alert']) || 'min_stock_qty';
  const prepCol = pick(sc, ['prep_time_minutes','preparation_minutes']) || 'prep_time_minutes';
  const availCol = pick(sc, ['is_available','available']) || 'is_available';
  const costCol = pick(sc, ['unit_cost','cost_price']) || 'unit_cost';
  const sellCol = pick(sc, ['selling_price','price']) || 'selling_price';
  return await tryMany(`SELECT s.*, s.product_id productId,
    s.${q(stockCol)} stockQuantity,
    s.${q(lowCol)} lowStockAlert,
    s.${q(prepCol)} preparationMinutes,
    s.${q(availCol)} isAvailable,
    s.${q(costCol)} unitCost,
    s.${q(sellCol)} sellingPrice
    FROM outlet_product_stock s WHERE s.outlet_id=:outletId`, { outletId });
}

router.get('/single-brand/v58/version', (req, res) => ok(res, { version: 'single-brand-enterprise-v58', focus: 'outlet-inventory-and-user-menu-filters', razorpay: 'v22/v26 unchanged' }, 'v58 active'));

router.get('/admin/outlets/:id/available-products', ah(async (req, res) => {
  const all = await productCatalog();
  const assigned = await stockRows(req.params.id);
  const assignedMap = new Map(assigned.map(x => [String(x.productId || x.product_id), x]));
  const merged = all.map(product => ({ ...product, ...(assignedMap.get(String(product.productId)) || {}) }));
  ok(res, { all: merged, assigned: merged.filter(x => assignedMap.has(String(x.productId))), unassigned: merged.filter(x => !assignedMap.has(String(x.productId))) }, 'Outlet inventory catalogue fetched');
}));

router.post('/admin/outlets/:id/stock', ah(async (req, res) => {
  await ensureSchema();
  const outletId = req.params.id;
  const items = Array.isArray(req.body?.items) ? req.body.items : [req.body || {}];
  const saved = [];
  for (const item of items) {
    const productId = item.productId || item.product_id || item.id;
    if (!productId) continue;
    const quantity = Math.max(0, n(item.stockQuantity ?? item.stock_quantity ?? item.stock_qty ?? item.quantity, 0));
    const low = Math.max(0, n(item.lowStockAlert ?? item.low_stock_alert ?? item.min_stock_qty, 5));
    const prep = Math.max(1, n(item.preparationMinutes ?? item.preparation_minutes ?? item.prep_time_minutes, 15));
    const selling = Math.max(0, n(item.sellingPrice ?? item.selling_price ?? item.price, 0));
    const cost = Math.max(0, n(item.unitCost ?? item.unit_cost, 0));
    const available = item.isAvailable === false || item.available === false ? 0 : 1;
    await exec(`INSERT INTO outlet_product_stock(outlet_id,product_id,stock_qty,min_stock_qty,prep_time_minutes,is_available,unit_cost,selling_price)
      VALUES(:outletId,:productId,:quantity,:low,:prep,:available,:cost,:selling)
      ON DUPLICATE KEY UPDATE stock_qty=:quantity,min_stock_qty=:low,prep_time_minutes=:prep,is_available=:available,unit_cost=:cost,selling_price=:selling`,
      { outletId, productId, quantity, low, prep, available, cost, selling });
    saved.push({ productId: n(productId), stockQuantity: quantity, lowStockAlert: low, preparationMinutes: prep, isAvailable: !!available, unitCost: cost, sellingPrice: selling });
  }
  ok(res, { outletId: n(outletId), items: saved, count: saved.length }, 'Outlet inventory saved');
}));

router.get(['/outlets/:id/menu','/user/outlets/:id/menu'], ah(async (req, res) => {
  const outlet = await tryOne(`SELECT * FROM outlets WHERE id=:id`, { id: req.params.id }) || {};
  const catalog = await productCatalog();
  const productsById = new Map(catalog.map(x => [String(x.productId), x]));
  const stock = await stockRows(req.params.id);
  const items = stock
    .filter(x => b(x.isAvailable, true) && n(x.stockQuantity) > 0)
    .map(x => {
      const p = productsById.get(String(x.productId || x.product_id)) || {};
      return {
        ...p,
        ...x,
        id: p.id || x.productId || x.product_id,
        productId: p.productId || x.productId || x.product_id,
        title: p.productName || p.title || p.name,
        name: p.productName || p.name || p.title,
        productName: p.productName || p.name || p.title,
        imageUrl: p.imageUrl || p.image || '',
        image: p.imageUrl || p.image || '',
        price: n(x.sellingPrice || p.price),
        categoryName: p.categoryName || 'Other',
        isVeg: p.isVeg !== false,
        veg: p.isVeg !== false,
      };
    });
  ok(res, { outlet, items, menu: items, foods: items, products: items, total: items.length }, 'Outlet available foods fetched');
}));

router.use(require('./singleBrandEnterpriseV57'));
module.exports = router;
