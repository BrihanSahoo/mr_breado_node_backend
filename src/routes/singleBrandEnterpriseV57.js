const express = require('express');
const multer = require('multer');
const router = express.Router();
const ah = require('../utils/asyncHandler');
const { ok } = require('../utils/respond');
const { one, many, exec } = require('../utils/db');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

async function tryOne(sql, params = {}) { try { return await one(sql, params); } catch (e) { return null; } }
async function tryMany(sql, params = {}) { try { return await many(sql, params); } catch (e) { return []; } }
async function tryExec(sql, params = {}) { try { return await exec(sql, params); } catch (e) { return null; } }
function s(v, d = '') { return v === undefined || v === null ? d : String(v); }
function n(v, d = 0) { const x = Number(v); return Number.isFinite(x) ? x : d; }
function bool(v, d = true) { if (v === undefined || v === null || v === '') return d; if (Buffer.isBuffer(v)) return v[0] === 1; if (typeof v === 'boolean') return v; if (typeof v === 'number') return v !== 0; return !['0','false','no','inactive','disabled','deleted'].includes(String(v).toLowerCase()); }
function q(col) { return '`' + String(col).replace(/`/g, '``') + '`'; }
async function cols(table) {
  const rows = await tryMany(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table`, { table });
  return new Set(rows.map(r => r.COLUMN_NAME || r.column_name));
}
function pick(set, names) { return names.find(x => set.has(x)); }
function coalesce(set, names, fallbackSql) {
  const parts = names.filter(x => set.has(x)).map(x => `NULLIF(p.${q(x)}, '')`);
  if (!parts.length) return fallbackSql;
  return `COALESCE(${parts.join(', ')}, ${fallbackSql})`;
}
function normalizeBody(req) {
  const body = { ...(req.body || {}) };
  // FormData booleans/numbers arrive as strings; keep them string-safe for DB.
  const file = (req.files || [])[0];
  if (file && file.buffer) {
    const dataUrl = `data:${file.mimetype || 'image/jpeg'};base64,${file.buffer.toString('base64')}`;
    body.image = dataUrl;
    body.imageUrl = dataUrl;
    body.image_url = dataUrl;
  }
  return body;
}
async function productSelect(where = '1=1', params = {}) {
  const pc = await cols('products');
  if (!pc.size) return [];
  const id = pick(pc, ['id','product_id']) || 'id';
  const title = coalesce(pc, ['name','title','product_name','food_name','item_name','display_name'], `CONCAT('Food #', p.${q(id)})`);
  const subtitle = coalesce(pc, ['subtitle','short_description'], `''`);
  const description = coalesce(pc, ['description','details','long_description','subtitle'], `''`);
  const image = coalesce(pc, ['image_url','image','photo_url','thumbnail_url','primary_image_url','imageUrl'], `''`);
  const priceCol = pick(pc, ['price','base_price','selling_price','amount','mrp']);
  const discountCol = pick(pc, ['discount_price','discounted_price','effective_price','offer_price','sale_price']);
  const stockCol = pick(pc, ['stock_quantity','stock','quantity','available_stock']);
  const availableCol = pick(pc, ['available','is_available','active','enabled','visibility_status']);
  const featuredCol = pick(pc, ['featured','is_featured','bestseller','is_bestseller']);
  const vegCol = pick(pc, ['veg','is_veg','vegetarian']);
  const categoryIdCol = pick(pc, ['food_category_id','category_id','menu_category_id']);
  const typeExpr = coalesce(pc, ['food_type','type','category_name'], `''`);
  const slugExpr = coalesce(pc, ['slug','product_slug'], `CONCAT('food-', p.${q(id)})`);
  const deletedFilter = pc.has('deleted') ? `COALESCE(p.${q('deleted')},0)=0` : '1=1';
  const fc = await cols('food_categories');
  const catId = fc.size ? (pick(fc, ['id','category_id']) || 'id') : null;
  const catName = fc.size ? (pick(fc, ['name','title','category_name']) || null) : null;
  const catJoin = categoryIdCol && catId ? `LEFT JOIN food_categories c ON c.${q(catId)} = p.${q(categoryIdCol)}` : '';
  const catExpr = catName ? `COALESCE(NULLIF(c.${q(catName)}, ''), ${typeExpr})` : typeExpr;

  const sql = `SELECT
    p.${q(id)} AS id,
    ${title} AS title,
    ${title} AS name,
    ${title} AS productName,
    ${subtitle} AS subtitle,
    ${description} AS description,
    ${image} AS imageUrl,
    ${image} AS image,
    ${priceCol ? `COALESCE(p.${q(priceCol)},0)` : '0'} AS price,
    ${discountCol ? `p.${q(discountCol)}` : 'NULL'} AS discountPrice,
    ${discountCol ? `COALESCE(NULLIF(p.${q(discountCol)},0), ${priceCol ? `p.${q(priceCol)}` : '0'}, 0)` : `${priceCol ? `COALESCE(p.${q(priceCol)},0)` : '0'}`} AS effectivePrice,
    ${stockCol ? `COALESCE(p.${q(stockCol)},0)` : '0'} AS stockQuantity,
    ${availableCol ? `p.${q(availableCol)}` : '1'} AS isAvailableRaw,
    ${featuredCol ? `p.${q(featuredCol)}` : '0'} AS isFeaturedRaw,
    ${vegCol ? `p.${q(vegCol)}` : '1'} AS isVegRaw,
    ${categoryIdCol ? `p.${q(categoryIdCol)}` : 'NULL'} AS categoryId,
    ${catExpr} AS categoryName,
    ${typeExpr} AS foodType,
    ${slugExpr} AS slug,
    'Mr Breado' AS restaurantName
    FROM products p ${catJoin}
    WHERE ${deletedFilter} AND (${where})
    ORDER BY p.${q(id)} DESC
    LIMIT 1000`;
  const rows = await tryMany(sql, params);
  return rows.map(r => ({
    ...r,
    price: n(r.price),
    discountPrice: r.discountPrice == null ? null : n(r.discountPrice),
    effectivePrice: n(r.effectivePrice || r.price),
    stockQuantity: n(r.stockQuantity),
    isAvailable: bool(r.isAvailableRaw, true),
    available: bool(r.isAvailableRaw, true),
    isFeatured: bool(r.isFeaturedRaw, false),
    featured: bool(r.isFeaturedRaw, false),
    isVeg: bool(r.isVegRaw, true),
    veg: bool(r.isVegRaw, true),
    productId: r.id,
  }));
}
async function productById(id) {
  const rows = await productSelect(`p.id = :id`, { id });
  return rows[0] || null;
}
function assignIfHas(out, set, col, value) { if (set.has(col) && value !== undefined) out[col] = value; }
async function upsertProduct(req, id = null) {
  const pc = await cols('products');
  const body = normalizeBody(req);
  const data = {};
  const title = body.title ?? body.name ?? body.productName ?? body.product_name ?? body.foodName;
  assignIfHas(data, pc, 'name', title);
  assignIfHas(data, pc, 'title', title);
  assignIfHas(data, pc, 'product_name', title);
  assignIfHas(data, pc, 'subtitle', body.subtitle);
  assignIfHas(data, pc, 'description', body.description);
  assignIfHas(data, pc, 'price', body.price ?? body.basePrice ?? body.base_price);
  assignIfHas(data, pc, 'base_price', body.price ?? body.basePrice ?? body.base_price);
  assignIfHas(data, pc, 'discount_price', body.discountPrice ?? body.discount_price ?? body.discountedPrice);
  assignIfHas(data, pc, 'discounted_price', body.discountPrice ?? body.discount_price ?? body.discountedPrice);
  assignIfHas(data, pc, 'stock_quantity', body.stockQuantity ?? body.stock_quantity ?? body.stock ?? body.quantity);
  assignIfHas(data, pc, 'stock', body.stockQuantity ?? body.stock_quantity ?? body.stock ?? body.quantity);
  assignIfHas(data, pc, 'food_type', body.foodType ?? body.food_type ?? body.categoryName);
  assignIfHas(data, pc, 'type', body.foodType ?? body.food_type ?? body.categoryName);
  assignIfHas(data, pc, 'image_url', body.imageUrl ?? body.image_url ?? body.image);
  assignIfHas(data, pc, 'image', body.image ?? body.imageUrl ?? body.image_url);
  assignIfHas(data, pc, 'slug', body.slug || (title ? String(title).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') : undefined));
  assignIfHas(data, pc, 'available', body.isAvailable ?? body.available ?? 1);
  assignIfHas(data, pc, 'is_available', body.isAvailable ?? body.available ?? 1);
  assignIfHas(data, pc, 'featured', body.isFeatured ?? body.featured ?? body.bestseller ?? 0);
  assignIfHas(data, pc, 'is_featured', body.isFeatured ?? body.featured ?? body.bestseller ?? 0);
  assignIfHas(data, pc, 'bestseller', body.isBestseller ?? body.bestseller ?? body.isFeatured ?? 0);
  assignIfHas(data, pc, 'is_bestseller', body.isBestseller ?? body.bestseller ?? body.isFeatured ?? 0);
  assignIfHas(data, pc, 'veg', body.isVeg ?? body.veg ?? 1);
  assignIfHas(data, pc, 'is_veg', body.isVeg ?? body.veg ?? 1);
  const categoryId = body.categoryId ?? body.category_id ?? body.foodCategoryId ?? body.food_category_id;
  assignIfHas(data, pc, 'category_id', categoryId);
  assignIfHas(data, pc, 'food_category_id', categoryId);
  assignIfHas(data, pc, 'menu_category_id', categoryId);
  assignIfHas(data, pc, 'updated_at', new Date());
  if (!Object.keys(data).length) throw new Error('No product fields were provided');
  if (id) {
    const sets = Object.keys(data).map(k => `${q(k)}=:${k}`).join(', ');
    await exec(`UPDATE products SET ${sets} WHERE id=:id`, { ...data, id });
    return await productById(id);
  }
  assignIfHas(data, pc, 'created_at', new Date());
  const keys = Object.keys(data);
  const result = await exec(`INSERT INTO products (${keys.map(q).join(', ')}) VALUES (${keys.map(k => ':' + k).join(', ')})`, data);
  return await productById(result?.insertId) || { id: result?.insertId, ...data };
}

router.get('/single-brand/v57/version', (req, res) => ok(res, { version: 'single-brand-enterprise-v57', fix: 'admin-food-catalog-real-products', razorpay: 'v22/v26 locked unchanged' }, 'v57 active'));
router.get(['/admin/products','/admin/foods','/admin/mr-breado/products','/admin/mr-breado/foods','/admin/products/catalog'], ah(async (req, res) => {
  const items = await productSelect('1=1');
  ok(res, { items, products: items, all: items, total: items.length, page: 1, perPage: items.length || 20, total_pages: 1 }, 'Admin foods fetched');
}));
router.get(['/admin/products/:id','/admin/foods/:id','/admin/products/:id/details','/admin/mr-breado/products/:id','/admin/mr-breado/foods/:id'], ah(async (req, res) => {
  const item = await productById(req.params.id);
  if (!item) return res.status(404).json({ success: false, message: 'Food item not found' });
  ok(res, item, 'Food details fetched');
}));
router.post(['/admin/products','/admin/foods','/admin/mr-breado/products','/admin/mr-breado/foods'], upload.any(), ah(async (req, res) => ok(res, await upsertProduct(req), 'Food item created', 201)));
router.put(['/admin/products/:id','/admin/foods/:id','/admin/mr-breado/products/:id','/admin/mr-breado/foods/:id'], upload.any(), ah(async (req, res) => ok(res, await upsertProduct(req, req.params.id), 'Food item updated')));
router.patch(['/admin/products/:id/availability','/admin/foods/:id/availability','/admin/mr-breado/products/:id/availability'], ah(async (req, res) => {
  const pc = await cols('products');
  const val = req.body?.isAvailable ?? req.body?.available ?? req.body?.active ?? 1;
  const data = {};
  assignIfHas(data, pc, 'available', val ? 1 : 0);
  assignIfHas(data, pc, 'is_available', val ? 1 : 0);
  assignIfHas(data, pc, 'active', val ? 1 : 0);
  if (Object.keys(data).length) await exec(`UPDATE products SET ${Object.keys(data).map(k => `${q(k)}=:${k}`).join(', ')} WHERE id=:id`, { ...data, id: req.params.id });
  ok(res, await productById(req.params.id), 'Food availability updated');
}));
router.delete(['/admin/products/:id','/admin/foods/:id','/admin/mr-breado/products/:id','/admin/mr-breado/foods/:id'], ah(async (req, res) => {
  const pc = await cols('products');
  if (pc.has('deleted')) await exec(`UPDATE products SET deleted=1 WHERE id=:id`, { id: req.params.id });
  else await exec(`DELETE FROM products WHERE id=:id`, { id: req.params.id });
  ok(res, { id: req.params.id }, 'Food item deleted');
}));
router.get('/admin/outlets/:id/available-products', ah(async (req, res) => {
  const assigned = await tryMany(`SELECT s.*, s.product_id productId, s.stock_qty stockQuantity FROM outlet_product_stock s WHERE s.outlet_id=:id`, { id: req.params.id });
  const ids = new Set(assigned.map(x => String(x.productId || x.product_id)));
  const all = await productSelect('1=1');
  ok(res, { assigned, unassigned: all.filter(x => !ids.has(String(x.id))), all }, 'Outlet assignable foods fetched');
}));

router.use(require('./singleBrandEnterpriseV54'));
module.exports = router;
