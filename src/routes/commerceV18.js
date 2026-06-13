const router = require('express').Router();
const multer = require('multer');
const { ok, fail } = require('../utils/respond');
const ah = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { one, many, exec, slugify } = require('../utils/db');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 8 } });
const colCache = new Map();

function text(v, fallback = '') { return String(v ?? fallback).trim(); }
function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function bool(v, fallback = false) {
  if (v === undefined || v === null || v === '') return fallback;
  if (Buffer.isBuffer(v)) return v[0] === 1;
  if (typeof v === 'object' && Array.isArray(v.data)) return Number(v.data[0]) === 1;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  return ['1', 'true', 'yes', 'on', 'active', 'enabled', 'available', 'visible'].includes(String(v).toLowerCase());
}
function first(...values) { for (const v of values) if (v !== undefined && v !== null && String(v).trim() !== '') return v; return undefined; }
function toJson(v) { try { return JSON.stringify(v ?? {}); } catch { return '{}'; } }
function parseJson(v) { if (!v) return {}; if (typeof v === 'object') return v; try { return JSON.parse(String(v)); } catch { return {}; } }
async function safeOne(sql, params = {}) { try { return await one(sql, params); } catch (e) { console.error('[v18 one]', e.message, sql); return null; } }
async function safeMany(sql, params = {}) { try { return await many(sql, params); } catch (e) { console.error('[v18 many]', e.message, sql); return []; } }
async function safeExec(sql, params = {}) { try { return await exec(sql, params); } catch (e) { console.error('[v18 exec]', e.message, sql); return { insertId: null, affectedRows: 0, error: e }; } }
async function columns(table) {
  if (colCache.has(table)) return colCache.get(table);
  const rows = await safeMany(`SHOW COLUMNS FROM ${table}`);
  const set = new Set(rows.map(r => r.Field));
  colCache.set(table, set);
  return set;
}
async function insertDynamic(table, values) {
  const cols = await columns(table);
  const entries = Object.entries(values).filter(([k, v]) => cols.has(k) && v !== undefined);
  if (!entries.length) throw new Error(`No matching columns for ${table}`);
  const names = entries.map(([k]) => k);
  const params = Object.fromEntries(entries);
  const placeholders = names.map(k => `:${k}`);
  return exec(`INSERT INTO ${table}(${names.join(',')}) VALUES(${placeholders.join(',')})`, params);
}
async function updateDynamic(table, id, values) {
  const cols = await columns(table);
  const entries = Object.entries(values).filter(([k, v]) => cols.has(k) && v !== undefined);
  if (!entries.length) return { affectedRows: 0 };
  const params = Object.fromEntries(entries);
  params.id = id;
  return exec(`UPDATE ${table} SET ${entries.map(([k]) => `${k}=:${k}`).join(',')} WHERE id=:id`, params);
}

async function ensureV18() {
  // Add optional compatibility columns only. Do not change Razorpay/payment create-order logic.
  for (const q of [
    `ALTER TABLE cart_items ADD COLUMN customizations_json LONGTEXT NULL`,
    `ALTER TABLE cart_items ADD COLUMN selected_size VARCHAR(80) NULL`,
    `ALTER TABLE cart_items ADD COLUMN custom_weight_kg DECIMAL(10,2) NULL`,
    `ALTER TABLE order_items ADD COLUMN customizations_json LONGTEXT NULL`,
    `ALTER TABLE order_items ADD COLUMN selected_size VARCHAR(80) NULL`,
    `ALTER TABLE order_items ADD COLUMN custom_weight_kg DECIMAL(10,2) NULL`,
  ]) await safeExec(q);
}

async function mrBreadoRestaurant() {
  let r = await safeOne(`SELECT * FROM restaurants WHERE LOWER(slug)='mr-breado' OR LOWER(name) LIKE '%mr breado%' ORDER BY id LIMIT 1`);
  if (!r) {
    const now = new Date();
    const ins = await insertDynamic('restaurants', {
      name: 'Mr Breado', slug: 'mr-breado', address: '', city: 'Kolkata', state: 'West Bengal', country: 'India', zipcode: '700012',
      contact_number: '', contact_email: '', latitude: 0, longitude: 0, open: 1, is_open: 1, status: 'ONLINE', verification_status: 'VERIFIED', visibility_status: 'VISIBLE',
      min_delivery_time: 30, max_delivery_time: 45, order_preparation_time: 20, price_for_two: 200, product_count: 0, promoted: 0, featured: 1, rating: 4.8, total_reviews: 0, deleted: 0,
      created_at: now, updated_at: now,
    });
    r = await safeOne('SELECT * FROM restaurants WHERE id=:id', { id: ins.insertId });
  }
  return r;
}
function categoryFromBody(b) { return first(b.category, b.categoryName, b.category_name, b.foodType, b.food_type, 'Food'); }
function isPizzaLike(b) { return String(categoryFromBody(b) + ' ' + first(b.name, b.title, '')).toLowerCase().includes('pizza'); }
function isCakeLike(b) { return String(categoryFromBody(b) + ' ' + first(b.name, b.title, '')).toLowerCase().includes('cake'); }
function basePriceFromBody(b) {
  if (isPizzaLike(b)) return num(first(b.smallSizePrice, b.small_size_price, b.smallPrice, b.small_price, b.price), 0);
  if (isCakeLike(b)) return num(first(b.cakeBasePrice, b.cake_base_price, b.basePrice500gm, b.price), 0);
  return num(first(b.discountPrice, b.discount_price, b.price), 0);
}
function imageFromReq(req) {
  const f = (req.files || []).find(x => ['image', 'photo', 'file', 'imageFile'].includes(x.fieldname)) || (req.files || [])[0];
  if (!f) return first(req.body?.imageUrl, req.body?.image_url, req.body?.image, '');
  return `data:${f.mimetype};base64,${f.buffer.toString('base64')}`;
}
async function categoryIdFor(name) {
  const slug = slugify(name || 'food');
  let c = await safeOne(`SELECT id FROM food_categories WHERE slug=:slug OR LOWER(title)=LOWER(:name) OR LOWER(COALESCE(category_name,''))=LOWER(:name) ORDER BY id LIMIT 1`, { slug, name });
  if (!c) c = await safeOne(`SELECT id FROM categories WHERE slug=:slug OR LOWER(name)=LOWER(:name) ORDER BY id LIMIT 1`, { slug, name });
  return c?.id || null;
}
async function insertCustomizationGroup(productId, title, priority = 1) {
  return insertDynamic('product_customization_groups', {
    product_id: productId,
    title,
    name: title,
    type: 'SINGLE',
    selection_type: 'SINGLE',
    required: 1,
    min_select: 1,
    max_select: 1,
    priority,
    sort_order: priority,
    created_at: new Date(),
    updated_at: new Date(),
  });
}
async function insertCustomizationOption(groupId, title, price, sort = 1) {
  return insertDynamic('product_customization_options', {
    group_id: groupId,
    title,
    name: title,
    price: num(price, 0),
    enabled: 1,
    active: 1,
    available: 1,
    priority: sort,
    sort_order: sort,
    created_at: new Date(),
    updated_at: new Date(),
  });
}
async function saveProductCustomizations(productId, b) {
  await ensureV18();
  await safeExec(`DELETE co FROM product_customization_options co JOIN product_customization_groups cg ON cg.id=co.group_id WHERE cg.product_id=:id`, { id: productId });
  await safeExec(`DELETE FROM product_customization_groups WHERE product_id=:id`, { id: productId });

  const base = basePriceFromBody(b);
  if (isPizzaLike(b)) {
    const small = num(first(b.smallSizePrice, b.small_size_price, b.smallPrice, b.small_price, base), base);
    const medium = num(first(b.mediumSizePrice, b.medium_size_price, b.mediumPrice, b.medium_price, small), small);
    const large = num(first(b.largeSizePrice, b.large_size_price, b.largePrice, b.large_price, medium), medium);
    const g = await insertCustomizationGroup(productId, 'Pizza Size', 1);
    await insertCustomizationOption(g.insertId, 'Small', Math.max(0, small - base), 1);
    await insertCustomizationOption(g.insertId, 'Medium', Math.max(0, medium - base), 2);
    await insertCustomizationOption(g.insertId, 'Large', Math.max(0, large - base), 3);
  }

  if (isCakeLike(b)) {
    const extra = num(first(b.cakeExtraHalfKgPrice, b.cake_extra_half_kg_price, b.extraHalfKgPrice, b.extra_half_kg_price), 0);
    const maxKg = num(first(b.cakeMaxWeightKg, b.cake_max_weight_kg, b.maxKg, b.max_kg), 5);
    const g = await insertCustomizationGroup(productId, 'Cake Weight', 1);
    const weights = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5].filter(w => w <= maxKg);
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i];
      await insertCustomizationOption(g.insertId, `${w} kg`, Math.max(0, Math.round(((w - 0.5) / 0.5) * extra * 100) / 100), i + 1);
    }
    if (bool(first(b.customWeightEnabled, b.custom_weight_enabled, b.allowCustomWeight), false)) {
      await insertCustomizationOption(g.insertId, 'Custom weight', 0, 99);
    }
  }
}
async function groupsForProduct(productId) {
  const groups = await safeMany(`SELECT id, product_id productId, COALESCE(title,name) name, COALESCE(title,name) title, COALESCE(type,selection_type,'SINGLE') selectionType, COALESCE(type,selection_type,'SINGLE') selection_type, min_select minSelect, max_select maxSelect, COALESCE(priority,sort_order,0) sortOrder FROM product_customization_groups WHERE product_id=:id ORDER BY COALESCE(priority,sort_order,0),id`, { id: productId });
  for (const g of groups) {
    const opts = await safeMany(`SELECT id, group_id groupId, COALESCE(title,name) name, COALESCE(title,name) title, price, COALESCE(enabled,available,active,1) active, COALESCE(priority,sort_order,0) sortOrder FROM product_customization_options WHERE group_id=:id AND COALESCE(enabled,available,active,1)=1 ORDER BY COALESCE(priority,sort_order,0),id`, { id: g.id });
    g.options = opts.map(o => ({ ...o, enabled: bool(o.active, true), available: bool(o.active, true) }));
  }
  return groups;
}
function mapProduct(p, groups = []) {
  const name = first(p.name, p.title, p.product_name, 'Food Item');
  return {
    ...p,
    id: p.id,
    name,
    title: name,
    price: num(p.price, 0),
    discountPrice: p.discount_price,
    discount_price: p.discount_price,
    imageUrl: first(p.imageUrl, p.image_url, p.image, ''),
    restaurantId: p.restaurant_id,
    restaurantName: p.restaurantName || p.restaurant_name,
    restaurantSlug: p.restaurantSlug || p.restaurant_slug,
    categoryName: first(p.categoryName, p.category_name, p.foodCategoryName, p.menuCategoryName, p.category, ''),
    category: first(p.category, p.categoryName, p.category_name, p.foodCategoryName, p.menuCategoryName, ''),
    customization_groups: groups,
    customizationGroups: groups,
    customizations: groups,
  };
}
const productSelect = `SELECT p.*, COALESCE(NULLIF(p.name,''),p.title) name, COALESCE(p.image_url,p.image) imageUrl, r.name restaurantName, r.slug restaurantSlug, fc.title foodCategoryName, fc.title categoryName, mc.title menuCategoryName FROM products p LEFT JOIN restaurants r ON r.id=p.restaurant_id LEFT JOIN food_categories fc ON fc.id=p.food_category_id LEFT JOIN menu_categories mc ON mc.id=p.menu_category_id`;
async function productBySlug(slug) {
  const p = await safeOne(productSelect + ` WHERE p.slug=:slug OR p.id=:slug`, { slug });
  if (!p) return null;
  return mapProduct(p, await groupsForProduct(p.id));
}

router.get('/products/:slug', ah(async (req, res) => { const p = await productBySlug(req.params.slug); if (!p) return fail(res, 'Product not found', 404); ok(res, p); }));
router.get('/products', ah(async (req, res) => { const rows = await safeMany(productSelect + ` WHERE COALESCE(p.deleted,0)=0 AND COALESCE(p.available,1)=1 ORDER BY p.id DESC LIMIT 200`); ok(res, rows.map(r => mapProduct(r, []))); }));

async function createOrUpdateProduct(req, res, productId = null, forceMrBreado = false) {
  await ensureV18();
  const b = req.body || {};
  const title = first(b.name, b.title, 'Food Item');
  const restaurant = forceMrBreado ? await mrBreadoRestaurant() : null;
  const restaurantId = first(b.restaurantId, b.restaurant_id, restaurant?.id, null);
  if (!restaurantId) return fail(res, 'Restaurant is required', 400);
  const catName = categoryFromBody(b);
  const catId = first(b.categoryId, b.category_id, b.foodCategoryId, b.food_category_id, await categoryIdFor(catName));
  const price = basePriceFromBody(b);
  const image = imageFromReq(req);
  const now = new Date();
  const values = {
    restaurant_id: restaurantId,
    category_id: catId,
    food_category_id: catId,
    menu_category_id: first(b.menuCategoryId, b.menu_category_id, null),
    name: title,
    title,
    slug: productId ? undefined : `${slugify(first(b.slug, title))}-${Date.now()}`,
    subtitle: first(b.subtitle, b.shortDescription, ''),
    description: first(b.description, b.subtitle, ''),
    image_url: image,
    image,
    price,
    discount_price: first(b.discountPrice, b.discount_price, null),
    currency: first(b.currency, 'INR'),
    veg: bool(b.veg, true) ? 1 : 0,
    available: bool(b.available, true) ? 1 : 0,
    stock: first(b.stock, b.stockQuantity, b.stock_quantity, 100),
    stock_quantity: first(b.stockQuantity, b.stock_quantity, b.stock, 100),
    stock_tracking_enabled: bool(b.stockTrackingEnabled, false) ? 1 : 0,
    featured: bool(b.featured, false) ? 1 : 0,
    bestseller: bool(b.bestseller, false) ? 1 : 0,
    deleted: 0,
    preparation_time: num(first(b.preparationTime, b.preparation_time), 20),
    rating: num(b.rating, 0),
    total_reviews: num(b.totalReviews, 0),
    tax_included: bool(b.taxIncluded, true) ? 1 : 0,
    category_name: catName,
    food_type: catName,
    tags: first(b.tags, ''),
    created_at: productId ? undefined : now,
    updated_at: now,
  };
  let id = productId;
  if (id) await updateDynamic('products', id, values); else { const ins = await insertDynamic('products', values); id = ins.insertId; }
  await saveProductCustomizations(id, b);
  ok(res, await productBySlug(id), productId ? 'Product updated' : 'Product created', productId ? 200 : 201);
}
router.post(['/admin/mr-breado/products', '/admin/products', '/seller/products', '/products'], requireAuth, upload.any(), ah((req, res) => createOrUpdateProduct(req, res, null, true)));
router.put(['/admin/mr-breado/products/:id', '/admin/products/:id', '/seller/products/:id', '/products/:id'], requireAuth, upload.any(), ah((req, res) => createOrUpdateProduct(req, res, req.params.id, true)));
router.get(['/admin/products', '/admin/mr-breado/products', '/seller/products'], requireAuth, ah(async (req, res) => {
  const rows = await safeMany(productSelect + ` WHERE COALESCE(p.deleted,0)=0 ORDER BY p.id DESC LIMIT 500`);
  ok(res, { items: rows.map(r => mapProduct(r, [])), products: rows.map(r => mapProduct(r, [])), total: rows.length, page: 1, per_page: rows.length || 20, total_pages: 1 });
}));

async function getCart(userId) {
  let c = await safeOne('SELECT * FROM carts WHERE user_id=:userId', { userId });
  if (!c) {
    const r = await insertDynamic('carts', { user_id: userId, created_at: new Date(), updated_at: new Date() });
    c = await safeOne('SELECT * FROM carts WHERE id=:id', { id: r.insertId });
  }
  return c;
}
async function pricedOptions(optionIds = []) {
  const ids = (Array.isArray(optionIds) ? optionIds : []).map(x => Number(x)).filter(x => x > 0);
  if (!ids.length) return [];
  const rows = await safeMany(`SELECT co.id, COALESCE(co.title,co.name) optionName, co.price, COALESCE(cg.title,cg.name) groupName FROM product_customization_options co JOIN product_customization_groups cg ON cg.id=co.group_id WHERE co.id IN (${ids.map((_, i) => `:id${i}`).join(',')})`, Object.fromEntries(ids.map((id, i) => [`id${i}`, id])));
  return rows;
}
async function cartData(userId) {
  const c = await getCart(userId);
  const rows = await safeMany(`SELECT ci.*, ci.id cartItemId, COALESCE(NULLIF(p.name,''),p.title) name, COALESCE(p.image_url,p.image) imageUrl, p.slug, p.restaurant_id restaurantId, p.price productPrice, p.discount_price discountPrice, r.name restaurantName, r.slug restaurantSlug FROM cart_items ci LEFT JOIN products p ON p.id=ci.product_id LEFT JOIN restaurants r ON r.id=p.restaurant_id WHERE ci.cart_id=:cid ORDER BY ci.id DESC`, { cid: c.id });
  const items = rows.map(r => ({
    ...r,
    customizations: parseJson(r.customizations_json || r.customizations),
    unitPrice: num(first(r.unit_price, r.productPrice), 0),
    price: num(first(r.unit_price, r.productPrice), 0),
    totalPrice: num(first(r.unit_price, r.productPrice), 0) * num(r.quantity, 1),
  }));
  const subtotal = items.reduce((s, i) => s + num(first(i.unit_price, i.price), 0) * num(i.quantity, 1), 0);
  return { id: c.id, items, cartItems: items, subtotal, total: subtotal, restaurant: items[0] ? { id: items[0].restaurantId, name: items[0].restaurantName, slug: items[0].restaurantSlug } : null };
}
router.get('/cart', requireAuth, ah(async (req, res) => ok(res, await cartData(req.user.id))));
router.post('/cart/items', requireAuth, ah(async (req, res) => {
  await ensureV18();
  const cart = await getCart(req.user.id);
  const b = req.body || {};
  const productId = first(b.productId, b.product_id, b.id);
  const qty = Math.max(1, num(b.quantity, 1));
  const p = await productBySlug(productId);
  if (!p) return fail(res, 'Product not found', 404);
  const optionIds = Array.isArray(b.customizationOptionIds) ? b.customizationOptionIds : Array.isArray(b.customization_option_ids) ? b.customization_option_ids : [];
  const opts = await pricedOptions(optionIds);
  const extra = opts.reduce((s, o) => s + num(o.price, 0), 0);
  const customWeightKg = num(first(b.customWeightKg, b.custom_weight_kg), 0);
  const unitPrice = num(p.price, 0) + extra;
  const custom = { selectedSize: first(b.selectedSize, b.selected_size, null), selectedWeight: first(b.selectedWeight, b.selected_weight, null), customWeightKg: customWeightKg || null, cakeMessage: first(b.cakeMessage, b.cake_message, null), options: opts };
  const ins = await insertDynamic('cart_items', { cart_id: cart.id, product_id: p.id, quantity: qty, unit_price: unitPrice, customization_total: extra, customizations_json: toJson(custom), selected_size: custom.selectedSize, selected_weight: custom.selectedWeight, custom_weight_kg: custom.customWeightKg, cake_message: custom.cakeMessage, special_instruction: first(b.specialInstruction, b.special_instruction, ''), created_at: new Date(), updated_at: new Date() });
  for (const o of opts) await insertDynamic('cart_item_customizations', { cart_item_id: ins.insertId, option_id: o.id, customization_option_id: o.id, title: o.optionName, price: o.price, created_at: new Date() }).catch(() => {});
  ok(res, await cartData(req.user.id), 'Item added', 201);
}));
router.delete('/cart/items/:id', requireAuth, ah(async (req, res) => { await safeExec('DELETE FROM cart_item_customizations WHERE cart_item_id=:id', { id: req.params.id }); await safeExec('DELETE FROM cart_items WHERE id=:id AND cart_id IN (SELECT id FROM carts WHERE user_id=:uid)', { id: req.params.id, uid: req.user.id }); ok(res, await cartData(req.user.id), 'Item removed'); }));
router.delete(['/cart', '/cart/clear'], requireAuth, ah(async (req, res) => { const c = await getCart(req.user.id); await safeExec('DELETE FROM cart_item_customizations WHERE cart_item_id IN (SELECT id FROM cart_items WHERE cart_id=:id)', { id: c.id }); await safeExec('DELETE FROM cart_items WHERE cart_id=:id', { id: c.id }); ok(res, await cartData(req.user.id), 'Cart cleared'); }));

function normalizeAddress(addr = {}, reqBody = {}, user = {}) {
  return {
    name: first(addr.name, reqBody.deliveryName, reqBody.name, user.name, 'Customer'),
    mobile: first(addr.mobile, addr.phone, reqBody.deliveryMobile, reqBody.mobile, user.mobile, user.phone_number, '0000000000'),
    address: first(addr.address, addr.street, addr.addressLine1, reqBody.addressLine, reqBody.deliveryAddress, 'Customer address'),
    city: first(addr.city, reqBody.city, 'Kolkata'),
    state: first(addr.state, reqBody.state, 'West Bengal'),
    country: first(addr.country, reqBody.country, 'India'),
    zipcode: first(addr.pincode, addr.zipcode, addr.zip, reqBody.pincode, reqBody.zipcode, '700000'),
    landmark: first(addr.landmark, reqBody.landmark, ''),
    latitude: first(addr.latitude, reqBody.userLatitude, reqBody.user_latitude, 0),
    longitude: first(addr.longitude, reqBody.userLongitude, reqBody.user_longitude, 0),
  };
}
async function linkPaymentToOrder(orderId, reqBody, userId) {
  const providerOrderId = first(reqBody.razorpayOrderId, reqBody.razorpay_order_id, reqBody.providerOrderId, reqBody.provider_order_id, null);
  const providerPaymentId = first(reqBody.razorpayPaymentId, reqBody.razorpay_payment_id, reqBody.providerPaymentId, reqBody.provider_payment_id, null);
  if (!providerOrderId && !providerPaymentId) return;
  await safeExec(`UPDATE payment_transactions SET order_id=:orderId, user_id=COALESCE(user_id,:userId), provider_payment_id=COALESCE(provider_payment_id,:pid), status=CASE WHEN status IN ('CREATED','PENDING') THEN 'SUCCESS' ELSE status END, paid_at=COALESCE(paid_at,NOW(6)), updated_at=NOW(6) WHERE provider_order_id=:poid OR provider_payment_id=:pid`, { orderId, userId, poid: providerOrderId, pid: providerPaymentId });
}
async function createDeliveryOffers(orderId, deliveryFee, totalDistanceKm) {
  const riders = await safeMany(`SELECT u.id FROM users u LEFT JOIN delivery_partner_profiles dpp ON dpp.user_id=u.id WHERE u.role='DELIVERY_PARTNER' AND COALESCE(u.deleted,0)=0 AND COALESCE(u.blocked,0)=0 AND COALESCE(u.enabled,1)=1 AND COALESCE(dpp.verified,1)=1 ORDER BY COALESCE(dpp.online,0) DESC, u.id ASC LIMIT 10`);
  for (const r of riders) {
    await insertDynamic('delivery_offers', { order_id: orderId, driver_id: r.id, status: 'PENDING', delivery_fee: deliveryFee, estimated_minutes: 35, pickup_distance_km: 0, total_distance_km: totalDistanceKm, rider_delivery_pay: Math.max(30, totalDistanceKm * 30), rider_delivery_pay_per_km: 30, expires_at: new Date(Date.now() + 10 * 60 * 1000), created_at: new Date(), updated_at: new Date() }).catch(() => {});
  }
}
async function addPaymentLedger(orderId, restaurantId, userId, total, platformFee, paymentType) {
  await insertDynamic('payment_ledger_entries', { type: 'CUSTOMER_PAYMENT', amount: total, currency: 'INR', note: paymentType === 'ONLINE' ? 'Customer paid online. Rider only delivers.' : 'COD order. Rider must collect cash.', reference: `ORDER-${orderId}`, order_id: orderId, restaurant_id: restaurantId, user_id: userId, created_at: new Date() }).catch(() => {});
  await insertDynamic('payment_ledger_entries', { type: 'ADMIN_COMMISSION', amount: platformFee, currency: 'INR', note: 'Platform fee/admin commission', reference: `ORDER-${orderId}`, order_id: orderId, restaurant_id: restaurantId, user_id: userId, created_at: new Date() }).catch(() => {});
  await insertDynamic('payment_ledger_entries', { type: 'RESTAURANT_PAYABLE', amount: Math.max(0, total - platformFee), currency: 'INR', note: 'Seller payable based on seller-set product prices', reference: `ORDER-${orderId}`, order_id: orderId, restaurant_id: restaurantId, user_id: userId, created_at: new Date() }).catch(() => {});
}
router.post(['/checkout/summary'], requireAuth, ah(async (req, res) => { const cart = await cartData(req.user.id); const deliveryFee = num(first(req.body.deliveryFee, req.body.delivery_fee), 30), platformFee = num(first(req.body.platformFee, req.body.platform_fee), 5), discount = num(req.body.discount, 0); ok(res, { ...cart, deliveryFee, platformFee, discount, total: Math.max(cart.subtotal + deliveryFee + platformFee - discount, 0), payableAmount: Math.max(cart.subtotal + deliveryFee + platformFee - discount, 0) }); }));
router.post(['/user/orders', '/orders', '/orders/place'], requireAuth, ah(async (req, res) => {
  await ensureV18();
  const cart = await cartData(req.user.id);
  const bodyItems = Array.isArray(req.body?.items) && req.body.items.length ? req.body.items : [];
  const items = bodyItems.length ? bodyItems : cart.items;
  if (!items.length) return fail(res, 'Cart is empty', 400);
  const paymentType = String(first(req.body.paymentType, req.body.payment_type, req.body.paymentMethod, 'COD')).toUpperCase().includes('ONLINE') ? 'ONLINE' : 'COD';
  const orderType = String(first(req.body.orderType, req.body.order_type, 'DELIVERY')).toUpperCase().includes('TAKE') ? 'TAKEAWAY' : 'DELIVERY';
  const subtotal = items.reduce((s, i) => s + num(first(i.unit_price, i.unitPrice, i.price), 0) * num(i.quantity, 1), 0);
  const deliveryFee = orderType === 'TAKEAWAY' ? 0 : num(first(req.body.deliveryFee, req.body.delivery_fee), 30);
  const platformFee = num(first(req.body.platformFee, req.body.platform_fee), 5);
  const discount = num(req.body.discount, 0);
  const total = Math.max(subtotal + deliveryFee + platformFee - discount, 0);
  const restaurantId = first(req.body.restaurantId, req.body.restaurant_id, cart.restaurant?.id, items[0]?.restaurantId, items[0]?.restaurant_id, null);
  if (!restaurantId) return fail(res, 'Restaurant not found for this cart', 400);
  const addr = normalizeAddress(req.body.address || req.body.deliveryAddress || {}, req.body, req.user);
  const orderNo = `MBR-${Date.now()}`;
  const now = new Date();
  const paymentStatus = paymentType === 'ONLINE' ? 'PAID' : 'PENDING';
  const status = orderType === 'TAKEAWAY' ? 'TAKEAWAY_PENDING_PICKUP' : 'PLACED';
  const ins = await insertDynamic('orders', {
    user_id: req.user.id,
    restaurant_id: restaurantId,
    slug: orderNo,
    order_number: orderNo,
    status,
    payment_type: paymentType,
    payment_status: paymentStatus,
    items_total: subtotal,
    subtotal,
    delivery_fee: deliveryFee,
    platform_fee: platformFee,
    restaurant_charges: 0,
    tax: 0,
    discount,
    wallet_used: 0,
    grand_total: total,
    total,
    payable_now: paymentType === 'ONLINE' ? total : 0,
    payable_later: paymentType === 'COD' ? total : 0,
    order_type: orderType,
    takeaway_booking_fee: 0,
    takeaway_booking_fee_percent: 0,
    distance_km: num(first(req.body.distanceKm, req.body.distance_km), 0),
    estimated_delivery_minutes: 45,
    delivery_address: addr.address,
    delivery_city: addr.city,
    delivery_state: addr.state,
    delivery_country: addr.country,
    delivery_zipcode: addr.zipcode,
    delivery_mobile: addr.mobile,
    delivery_name: addr.name,
    delivery_landmark: addr.landmark,
    delivery_latitude: addr.latitude,
    delivery_longitude: addr.longitude,
    order_note: first(req.body.deliveryInstruction, req.body.orderNote, req.body.order_note, ''),
    razorpay_order_id: first(req.body.razorpayOrderId, req.body.razorpay_order_id, null),
    razorpay_payment_id: first(req.body.razorpayPaymentId, req.body.razorpay_payment_id, null),
    razorpay_signature: first(req.body.razorpaySignature, req.body.razorpay_signature, null),
    cash_collected: 0,
    reviewed: 0,
    rush_delivery: 0,
    seller_accepted: 0,
    seller_response_deadline: new Date(Date.now() + 60 * 60 * 1000),
    created_at: now,
    updated_at: now,
  });
  const orderId = ins.insertId;
  for (const i of items) {
    const unit = num(first(i.unit_price, i.unitPrice, i.price), 0);
    const qty = num(i.quantity, 1);
    const custom = typeof i.customizations === 'object' ? i.customizations : parseJson(i.customizations_json || i.customizations);
    await insertDynamic('order_items', {
      order_id: orderId,
      product_id: first(i.product_id, i.productId, null),
      product_id_snapshot: first(i.product_id, i.productId, 0),
      name: first(i.name, i.title, 'Item'),
      title: first(i.name, i.title, 'Item'),
      image: first(i.imageUrl, i.image_url, i.image, ''),
      quantity: qty,
      unit_price: unit,
      total: unit * qty,
      total_price: unit * qty,
      customization_total: num(first(i.customization_total, i.customizationTotal), 0),
      customizations_json: toJson(custom),
      selected_size: first(i.selected_size, i.selectedSize, custom.selectedSize, null),
      selected_weight: first(i.selected_weight, i.selectedWeight, custom.selectedWeight, null),
      custom_weight_kg: first(i.custom_weight_kg, i.customWeightKg, custom.customWeightKg, null),
      cake_message: first(i.cake_message, i.cakeMessage, custom.cakeMessage, null),
      special_instruction: first(i.special_instruction, i.specialInstruction, ''),
      created_at: now,
    });
  }
  await linkPaymentToOrder(orderId, req.body, req.user.id);
  await addPaymentLedger(orderId, restaurantId, req.user.id, total, platformFee, paymentType);
  if (orderType === 'DELIVERY') await createDeliveryOffers(orderId, deliveryFee, num(first(req.body.distanceKm, req.body.distance_km), 0));
  await safeExec('DELETE FROM cart_item_customizations WHERE cart_item_id IN (SELECT id FROM cart_items WHERE cart_id=:id)', { id: cart.id });
  await safeExec('DELETE FROM cart_items WHERE cart_id=:id', { id: cart.id });
  const created = await safeOne('SELECT *, grand_total total FROM orders WHERE id=:id', { id: orderId });
  ok(res, { order: created, ...created }, paymentType === 'ONLINE' ? 'Online paid order placed' : 'COD order placed', 201);
}));

router.get('/seller/orders', requireAuth, ah(async (req, res) => {
  const rows = await safeMany(`SELECT o.*, r.name restaurantName, u.name customerName, u.mobile customerMobile FROM orders o LEFT JOIN restaurants r ON r.id=o.restaurant_id LEFT JOIN users u ON u.id=o.user_id WHERE r.owner_id=:uid OR :role='ADMIN' ORDER BY o.id DESC LIMIT 200`, { uid: req.user.id, role: req.user.role });
  for (const o of rows) {
    o.items = await safeMany(`SELECT id,title,quantity,selected_size selectedSize,selected_weight selectedWeight,custom_weight_kg customWeightKg,cake_message cakeMessage,customizations_json customizations FROM order_items WHERE order_id=:id`, { id: o.id });
    // Seller display intentionally hides money fields from item rows.
    o.items = o.items.map(i => ({ ...i, unit_price: undefined, unitPrice: undefined, price: undefined, total_price: undefined, totalPrice: undefined }));
  }
  ok(res, { items: rows, orders: rows, total: rows.length });
}));
router.get('/user/orders/:id/tracking', requireAuth, ah(async (req, res) => {
  const order = await safeOne('SELECT *, grand_total total FROM orders WHERE id=:id OR slug=:id OR order_number=:id', { id: req.params.id });
  const orderId = order?.id || req.params.id;
  const locations = await safeMany('SELECT * FROM delivery_locations WHERE order_id=:id ORDER BY id DESC LIMIT 50', { id: orderId });
  const assignment = await safeOne('SELECT da.*, u.name driverName, u.mobile driverMobile, u.phone_number driverPhone, dpp.current_latitude currentLatitude, dpp.current_longitude currentLongitude FROM delivery_assignments da LEFT JOIN users u ON u.id=da.driver_id LEFT JOIN delivery_partner_profiles dpp ON dpp.user_id=da.driver_id WHERE da.order_id=:id ORDER BY da.id DESC LIMIT 1', { id: orderId });
  ok(res, { order, locations, latestLocation: locations[0] || (assignment?.currentLatitude ? { latitude: assignment.currentLatitude, longitude: assignment.currentLongitude } : null), assignment, driver: assignment });
}));

module.exports = router;
