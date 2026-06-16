const express = require('express');
const router = express.Router();
const ah = require('../utils/asyncHandler');
const { ok } = require('../utils/respond');
const { one, many, exec } = require('../utils/db');

async function tryExec(sql, params = {}) { try { return await exec(sql, params); } catch (e) { console.error('[v53 tryExec]', e.message); return null; } }
async function tryOne(sql, params = {}) { try { return await one(sql, params); } catch (e) { console.error('[v53 tryOne]', e.message); return null; } }
async function tryMany(sql, params = {}) { try { return await many(sql, params); } catch (e) { console.error('[v53 tryMany]', e.message); return []; } }
const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
const s = (v, d = '') => (v === undefined || v === null ? d : String(v));
function slugify(v) { return s(v, 'category').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `cat-${Date.now()}`; }
function bool(v, d = true) { if (v === undefined || v === null || v === '') return d; if (Buffer.isBuffer(v)) return v[0] === 1; if (typeof v === 'boolean') return v; if (typeof v === 'number') return v !== 0; return !['0','false','no','inactive','disabled'].includes(String(v).toLowerCase()); }
async function cols(table) { const rows = await tryMany(`SHOW COLUMNS FROM ${table}`); return new Set(rows.map(r => r.Field)); }
function pick(set, names) { return names.find(x => set.has(x)); }
function expr(set, names, fallback = "''") { const valid = names.filter(x => set.has(x)).map(x => `NULLIF(${x},'')`); return valid.length ? `COALESCE(${valid.join(',')}, ${fallback})` : fallback; }
function idCol(set) { return pick(set, ['id','_id']) || 'id'; }
function dateOrNull(v) { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0,10); }

async function ensureV53Schema() {
  await tryExec(`CREATE TABLE IF NOT EXISTS food_categories (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(160) NOT NULL,
    title VARCHAR(160) NULL,
    slug VARCHAR(180) NULL,
    description TEXT NULL,
    image_url LONGTEXT NULL,
    image LONGTEXT NULL,
    icon LONGTEXT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    active TINYINT(1) NOT NULL DEFAULT 1,
    show_on_home TINYINT(1) NOT NULL DEFAULT 1,
    deleted TINYINT(1) NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY food_categories_slug_unique(slug)
  )`);
  for (const alter of [
    'MODIFY COLUMN image_url LONGTEXT NULL','MODIFY COLUMN image LONGTEXT NULL','MODIFY COLUMN icon LONGTEXT NULL',
    'ADD COLUMN title VARCHAR(160) NULL','ADD COLUMN description TEXT NULL','ADD COLUMN enabled TINYINT(1) NOT NULL DEFAULT 1','ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1','ADD COLUMN show_on_home TINYINT(1) NOT NULL DEFAULT 1','ADD COLUMN deleted TINYINT(1) NOT NULL DEFAULT 0','ADD COLUMN sort_order INT NOT NULL DEFAULT 0','ADD COLUMN updated_at DATETIME NULL'
  ]) await tryExec(`ALTER TABLE food_categories ${alter}`);

  await tryExec(`CREATE TABLE IF NOT EXISTS platform_business_settings (
    id TINYINT PRIMARY KEY DEFAULT 1,
    google_maps_api_key LONGTEXT NULL,
    distance_provider VARCHAR(20) NOT NULL DEFAULT 'HAVERSINE',
    base_delivery_charge DECIMAL(12,2) NOT NULL DEFAULT 20,
    delivery_charge_per_km DECIMAL(12,2) NOT NULL DEFAULT 8,
    rider_base_pay DECIMAL(12,2) NOT NULL DEFAULT 25,
    rider_pay_per_km DECIMAL(12,2) NOT NULL DEFAULT 7,
    monthly_settlement_day INT NOT NULL DEFAULT 1,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);
  await tryExec(`INSERT IGNORE INTO platform_business_settings(id) VALUES(1)`);
  for (const alter of [
    'ADD COLUMN google_maps_api_key LONGTEXT NULL','ADD COLUMN distance_provider VARCHAR(20) NOT NULL DEFAULT \'HAVERSINE\'','ADD COLUMN base_delivery_charge DECIMAL(12,2) NOT NULL DEFAULT 20','ADD COLUMN delivery_charge_per_km DECIMAL(12,2) NOT NULL DEFAULT 8','ADD COLUMN rider_base_pay DECIMAL(12,2) NOT NULL DEFAULT 25','ADD COLUMN rider_pay_per_km DECIMAL(12,2) NOT NULL DEFAULT 7','ADD COLUMN monthly_settlement_day INT NOT NULL DEFAULT 1'
  ]) await tryExec(`ALTER TABLE platform_business_settings ${alter}`);

  await tryExec(`CREATE TABLE IF NOT EXISTS outlet_daily_sales_cache (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL,
    sale_date DATE NOT NULL,
    online_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
    cod_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
    offline_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
    orders_count INT NOT NULL DEFAULT 0,
    UNIQUE KEY outlet_date_unique(outlet_id,sale_date)
  )`);
  await tryExec(`CREATE TABLE IF NOT EXISTS rider_order_earnings (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    rider_id BIGINT NOT NULL,
    order_id BIGINT NOT NULL,
    outlet_id BIGINT NULL,
    distance_km DECIMAL(10,2) NOT NULL DEFAULT 0,
    base_pay DECIMAL(12,2) NOT NULL DEFAULT 0,
    per_km_pay DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_earning DECIMAL(12,2) NOT NULL DEFAULT 0,
    cash_collected DECIMAL(12,2) NOT NULL DEFAULT 0,
    status VARCHAR(40) NOT NULL DEFAULT 'PENDING',
    delivered_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY rider_order_unique(rider_id,order_id)
  )`);
}
function mapCategory(r) {
  return {
    id: r.id,
    name: r.name || r.title || '',
    title: r.title || r.name || '',
    slug: r.slug || slugify(r.name || r.title || r.id),
    image: r.image_url || r.image || r.icon || '',
    imageUrl: r.image_url || r.image || r.icon || '',
    icon: r.icon || r.image_url || r.image || '',
    enabled: bool(r.enabled, true),
    active: bool(r.active, true),
    status: bool(r.enabled, true) && bool(r.active, true) ? 'ACTIVE' : 'INACTIVE',
    productCount: Number(r.productCount || 0),
    subCategoryCount: Number(r.subCategoryCount || 0),
  };
}
async function listCategories() {
  await ensureV53Schema();
  const rows = await tryMany(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE COALESCE(p.food_category_id,p.category_id,p.menu_category_id)=c.id) productCount FROM food_categories c WHERE COALESCE(c.deleted,0)=0 ORDER BY COALESCE(c.sort_order,0), c.id`);
  return rows.map(mapCategory);
}
async function uniqueSlug(base, ignoreId = null) {
  let candidate = slugify(base); let i = 1;
  while (true) {
    const existing = await tryOne(`SELECT id FROM food_categories WHERE slug=:slug AND (:ignoreId IS NULL OR id<>:ignoreId) LIMIT 1`, { slug: candidate, ignoreId });
    if (!existing) return candidate;
    candidate = `${slugify(base)}-${++i}`;
  }
}

router.get('/single-brand/v53/version', (req, res) => ok(res, { version: 'single-brand-enterprise-v53', fixes: ['category-create-no-server-error','google-map-settings-save','robust-food-prefill','outlet-dashboard-analytics-api'], razorpay: 'v22/v26 locked unchanged' }, 'v53 active'));
router.post('/admin/outlets/ensure-enterprise-v53-schema', ah(async (req, res) => { await ensureV53Schema(); ok(res, { ready: true }, 'v53 schema ready'); }));

router.get(['/categories','/user/categories','/food-categories','/admin/categories','/admin/food-categories'], ah(async (req, res) => {
  const items = await listCategories();
  ok(res, { items, categories: items, total: items.length, totalItems: items.length, page: 1, perPage: items.length || 50 }, 'Categories fetched');
}));
router.get('/admin/categories/summary', ah(async (req, res) => { const items = await listCategories(); ok(res, { totalCategories: items.length, activeCategories: items.filter(x => x.status === 'ACTIVE').length, inactiveCategories: items.filter(x => x.status !== 'ACTIVE').length, totalSubCategories: 0 }, 'Category summary fetched'); }));
router.post(['/admin/categories','/admin/food-categories'], ah(async (req, res) => {
  await ensureV53Schema();
  const b = req.body || {};
  const name = s(b.name || b.title).trim();
  if (!name) return res.status(400).json({ success: false, message: 'Category name is required' });
  const status = s(b.status || (b.enabled === false || b.active === false ? 'INACTIVE' : 'ACTIVE')).toUpperCase();
  const enabled = status === 'INACTIVE' ? 0 : 1;
  const image = s(b.image || b.imageUrl || b.image_url || b.icon || b.dataUrl || b.data_url || b.fallbackImage || '');
  const slug = await uniqueSlug(b.slug || name);
  const result = await exec(`INSERT INTO food_categories(name,title,slug,description,image_url,image,icon,enabled,active,show_on_home,sort_order) VALUES(:name,:name,:slug,:description,:image,:image,:image,:enabled,:enabled,1,:sortOrder)`, { name, slug, description: s(b.description), image, enabled, sortOrder: n(b.sortOrder ?? b.sort_order, 0) });
  ok(res, mapCategory(await tryOne(`SELECT * FROM food_categories WHERE id=:id`, { id: result.insertId }) || { id: result.insertId, name, slug, image_url: image, enabled }), 'Category created', 201);
}));
router.put(['/admin/categories/:id','/admin/food-categories/:id'], ah(async (req, res) => {
  await ensureV53Schema();
  const b = req.body || {}; const id = req.params.id;
  const current = await tryOne(`SELECT * FROM food_categories WHERE id=:id`, { id });
  if (!current) return res.status(404).json({ success: false, message: 'Category not found' });
  const name = s(b.name || b.title || current.name || current.title).trim();
  const status = s(b.status || (b.enabled === false || b.active === false ? 'INACTIVE' : 'ACTIVE')).toUpperCase();
  const enabled = status === 'INACTIVE' ? 0 : 1;
  const image = s(b.image || b.imageUrl || b.image_url || b.icon || b.dataUrl || b.data_url || current.image_url || current.image || current.icon || '');
  const slug = await uniqueSlug(b.slug || current.slug || name, id);
  await exec(`UPDATE food_categories SET name=:name,title=:name,slug=:slug,description=:description,image_url=:image,image=:image,icon=:image,enabled=:enabled,active=:enabled,updated_at=NOW() WHERE id=:id`, { id, name, slug, description: s(b.description ?? current.description ?? ''), image, enabled });
  ok(res, mapCategory(await tryOne(`SELECT * FROM food_categories WHERE id=:id`, { id })), 'Category updated');
}));
router.patch(['/admin/categories/:id/status','/admin/food-categories/:id/status'], ah(async (req, res) => { await ensureV53Schema(); const enabled = (req.body?.status === 'INACTIVE' || req.body?.enabled === false || req.body?.active === false) ? 0 : 1; await exec(`UPDATE food_categories SET enabled=:enabled,active=:enabled WHERE id=:id`, { id: req.params.id, enabled }); ok(res, mapCategory(await tryOne(`SELECT * FROM food_categories WHERE id=:id`, { id: req.params.id })), 'Category status updated'); }));
router.delete(['/admin/categories/:id','/admin/food-categories/:id'], ah(async (req, res) => { await ensureV53Schema(); await exec(`UPDATE food_categories SET deleted=1,enabled=0,active=0 WHERE id=:id`, { id: req.params.id }); ok(res, { id: req.params.id }, 'Category deleted'); }));

function mapSettingsRow(r = {}) { return { googleMapKey: s(r.google_maps_api_key), googleMapsApiKey: s(r.google_maps_api_key), provider: s(r.distance_provider, 'HAVERSINE') === 'GOOGLE' ? 'GOOGLE' : 'OSM', distanceProvider: s(r.distance_provider, 'HAVERSINE'), baseDeliveryCharge: n(r.base_delivery_charge, 20), deliveryChargePerKm: n(r.delivery_charge_per_km, 8), riderBasePay: n(r.rider_base_pay, 25), riderPayPerKm: n(r.rider_pay_per_km, 7), monthlySettlementDay: n(r.monthly_settlement_day, 1) }; }
router.get(['/admin/settings/map','/admin/business/settings'], ah(async (req, res) => { await ensureV53Schema(); ok(res, mapSettingsRow(await tryOne(`SELECT * FROM platform_business_settings WHERE id=1`) || {}), 'Map/business settings fetched'); }));
router.put(['/admin/settings/map','/admin/business/settings'], ah(async (req, res) => { await ensureV53Schema(); const b = req.body || {}; const key = b.googleMapKey ?? b.googleMapsApiKey ?? b.google_maps_api_key ?? ''; const providerRaw = s(b.provider || b.distanceProvider || b.distance_provider || 'HAVERSINE').toUpperCase(); const provider = providerRaw === 'GOOGLE' ? 'GOOGLE' : 'HAVERSINE'; await exec(`UPDATE platform_business_settings SET google_maps_api_key=:key,distance_provider=:provider,base_delivery_charge=:base,delivery_charge_per_km=:deliveryKm,rider_base_pay=:riderBase,rider_pay_per_km=:riderKm,monthly_settlement_day=:day WHERE id=1`, { key, provider, base: n(b.baseDeliveryCharge ?? b.base_delivery_charge, 20), deliveryKm: n(b.deliveryChargePerKm ?? b.delivery_charge_per_km, 8), riderBase: n(b.riderBasePay ?? b.rider_base_pay, 25), riderKm: n(b.riderPayPerKm ?? b.rider_pay_per_km, 7), day: n(b.monthlySettlementDay ?? b.monthly_settlement_day, 1) }); ok(res, mapSettingsRow(await tryOne(`SELECT * FROM platform_business_settings WHERE id=1`) || {}), 'Map/business settings saved'); }));

async function productsList() {
  const c = await cols('products'); if (!c.size) return [];
  const id = idCol(c); const name = expr(c, ['name','title','product_name','food_name','item_name','display_name','subtitle'], `CONCAT('Food #',${id})`); const subtitle = expr(c, ['subtitle','short_description','description'], "''"); const description = expr(c, ['description','details','subtitle'], "''"); const image = expr(c, ['image_url','image','photo_url','thumbnail_url','primary_image_url','imageUrl'], "''"); const price = pick(c, ['price','base_price','selling_price','amount']) || null; const discount = pick(c, ['discount_price','discounted_price','effective_price','offer_price']) || null; const stock = pick(c, ['stock_quantity','stock','quantity']) || null; const available = pick(c, ['available','is_available','enabled','active']) || null; const veg = pick(c, ['veg','is_veg','vegetarian']) || null; const categoryId = pick(c, ['food_category_id','category_id','menu_category_id']) || null; const type = expr(c, ['food_type','type','category_name'], "''");
  let join = ''; let catName = "''";
  if (categoryId) { join = ' LEFT JOIN food_categories fc ON fc.id=p.' + categoryId; catName = 'COALESCE(NULLIF(fc.name,\'\'),NULLIF(fc.title,\'\'),\'\')'; }
  const rows = await tryMany(`SELECT p.${id} id, ${name} name, ${name} title, ${subtitle} subtitle, ${description} description, ${image} imageUrl, ${price ? `p.${price}` : '0'} price, ${discount ? `p.${discount}` : 'NULL'} discountPrice, ${stock ? `p.${stock}` : '0'} stockQuantity, ${available ? `p.${available}` : '1'} isAvailable, ${veg ? `p.${veg}` : '1'} isVeg, ${categoryId ? `p.${categoryId}` : 'NULL'} categoryId, ${catName} categoryName, ${type} foodType, 'Mr Breado' restaurantName FROM products p ${join} WHERE COALESCE(${available ? `p.${available}` : '1'},1)=1 ORDER BY p.${id} DESC LIMIT 500`);
  return rows.map(r => ({ ...r, productName: r.name, image: r.imageUrl, effectivePrice: n(r.discountPrice || r.price), price: n(r.price), stockQuantity: n(r.stockQuantity), isAvailable: bool(r.isAvailable, true), isVeg: bool(r.isVeg, true), categoryName: r.categoryName || r.foodType || '' }));
}
router.get(['/admin/products','/admin/mr-breado/products','/admin/products/catalog'], ah(async (req, res) => { const items = await productsList(); ok(res, { items, products: items, total: items.length, page: 1, perPage: items.length || 20, total_pages: 1 }, 'Products fetched'); }));
router.get(['/admin/products/:id','/admin/products/:id/details','/admin/mr-breado/products/:id'], ah(async (req, res) => { const items = await productsList(); const item = items.find(x => String(x.id) === String(req.params.id)); if (!item) return res.status(404).json({ success: false, message: 'Product not found' }); ok(res, item, 'Product details fetched'); }));

async function fullDashboard(outletId) {
  const outlet = await tryOne(`SELECT * FROM outlets WHERE id=:id`, { id: outletId }) || { id: outletId, name: 'Mr Breado' };
  const closing = await tryMany(`SELECT *, (COALESCE(online_sales,0)+COALESCE(cod_sales,0)+COALESCE(offline_sales,0)) total_sales FROM outlet_daily_closings WHERE outlet_id=:id ORDER BY closing_date DESC LIMIT 370`, { id: outletId });
  const salesByDay = closing.slice().reverse().map(x => ({ date: String(x.closing_date).slice(0,10), totalSales: n(x.total_sales), onlineSales: n(x.online_sales), offlineSales: n(x.offline_sales), codSales: n(x.cod_sales), orders: n(x.orders_count) }));
  const stock = await tryMany(`SELECT s.*, s.stock_qty stockQuantity, s.min_stock_qty lowStockAlert, s.selling_price price, COALESCE(NULLIF(p.name,''),p.title,p.product_name,CONCAT('Food #',p.id)) productName, COALESCE(p.image_url,p.image,p.photo_url) imageUrl FROM outlet_product_stock s LEFT JOIN products p ON p.id=s.product_id WHERE s.outlet_id=:id ORDER BY productName`, { id: outletId });
  const best = await tryMany(`SELECT oi.product_id productId, COALESCE(NULLIF(p.name,''),p.title,p.product_name,CONCAT('Food #',p.id)) productName, SUM(COALESCE(oi.quantity,1)) soldQuantity, SUM(COALESCE(oi.total_price, oi.price*oi.quantity,0)) grossSales FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id LEFT JOIN orders o ON o.id=oi.order_id WHERE COALESCE(o.outlet_id,o.restaurant_id)=:id GROUP BY oi.product_id,productName ORDER BY soldQuantity DESC LIMIT 10`, { id: outletId });
  const slow = stock.filter(x => !best.some(b => String(b.productId) === String(x.product_id))).slice(0, 10);
  const movements = await tryMany(`SELECT m.*, COALESCE(NULLIF(p.name,''),p.title,p.product_name,CONCAT('Food #',p.id)) productName FROM outlet_stock_movements m LEFT JOIN products p ON p.id=m.product_id WHERE m.outlet_id=:id ORDER BY m.created_at DESC LIMIT 100`, { id: outletId });
  const summary = salesByDay.reduce((a,x) => { a.totalSales += x.totalSales; a.onlineSales += x.onlineSales; a.offlineSales += x.offlineSales; a.codSales += x.codSales; a.orders += x.orders; return a; }, { totalSales:0, onlineSales:0, offlineSales:0, codSales:0, orders:0 });
  const stockSummary = { stockItems: stock.length, availableProducts: stock.filter(x => bool(x.is_available,true)&&n(x.stockQuantity)>0).length, outOfStock: stock.filter(x => n(x.stockQuantity)<=0).length, lowStock: stock.filter(x => n(x.stockQuantity)<=n(x.lowStockAlert,5)).length, stockValue: stock.reduce((sum,x)=>sum+n(x.stockQuantity)*n(x.unit_cost || x.price),0) };
  const now = new Date(); const thisMonth = now.toISOString().slice(0,7); const thisYear = now.getFullYear();
  return { outlet, summary: { ...summary, ...stockSummary, averageOrderValue: summary.orders ? summary.totalSales / summary.orders : 0, todaySales: salesByDay.filter(x => x.date === new Date().toISOString().slice(0,10)).reduce((a,x)=>a+x.totalSales,0), weekSales: summary.totalSales, monthSales: salesByDay.filter(x => x.date.startsWith(thisMonth)).reduce((a,x)=>a+x.totalSales,0), yearSales: salesByDay.filter(x => x.date.startsWith(String(thisYear))).reduce((a,x)=>a+x.totalSales,0), bookings: 0 }, salesByDay, stock, stockMovements: movements, movements, bestFoods: best, bestSelling: best, slowFoods: slow, slowSelling: slow, closingCalendar: closing, dailyClosing: closing[0] || {} };
}
router.get(['/admin/outlets/:id/full-dashboard','/admin/business/outlets/:id/dashboard'], ah(async (req, res) => ok(res, await fullDashboard(req.params.id), 'Outlet dashboard fetched')));

router.use(require('./singleBrandEnterpriseV52'));
module.exports = router;
