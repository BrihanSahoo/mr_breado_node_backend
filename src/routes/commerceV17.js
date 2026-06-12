const router = require('express').Router();
const multer = require('multer');
const { ok, fail } = require('../utils/respond');
const ah = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { one, many, exec, slugify } = require('../utils/db');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024, files: 4 } });
const colCache = new Map();

function text(v, fallback = '') { return String(v ?? fallback).trim(); }
function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function bool(v, fallback = false) {
  if (v === undefined || v === null || v === '') return fallback;
  if (Buffer.isBuffer(v)) return v[0] === 1;
  if (typeof v === 'object' && Array.isArray(v.data)) return Number(v.data[0]) === 1;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  return ['1','true','yes','on','active','enabled','available','visible'].includes(String(v).toLowerCase());
}
function first(...values) { for (const v of values) if (v !== undefined && v !== null && String(v).trim() !== '') return v; return undefined; }
function json(v) { try { return JSON.stringify(v ?? {}); } catch { return '{}'; } }
function parseJson(v) { if (!v) return {}; if (typeof v === 'object') return v; try { return JSON.parse(String(v)); } catch { return {}; } }
async function safeOne(sql, params={}) { try { return await one(sql, params); } catch(e) { console.error('[v17 one]', e.message); return null; } }
async function safeMany(sql, params={}) { try { return await many(sql, params); } catch(e) { console.error('[v17 many]', e.message); return []; } }
async function safeExec(sql, params={}) { try { return await exec(sql, params); } catch(e) { console.error('[v17 exec]', e.message); return {insertId:null, affectedRows:0}; } }
async function columns(table) {
  if (colCache.has(table)) return colCache.get(table);
  const rows = await safeMany(`SHOW COLUMNS FROM ${table}`);
  const set = new Set(rows.map(r => r.Field));
  colCache.set(table, set);
  return set;
}
async function insertDynamic(table, values) {
  const cols = await columns(table);
  const entries = Object.entries(values).filter(([k,v]) => cols.has(k) && v !== undefined);
  if (!entries.length) throw new Error(`No matching columns for ${table}`);
  const names = entries.map(([k]) => k);
  const params = Object.fromEntries(entries);
  const placeholders = names.map(k => `:${k}`);
  return exec(`INSERT INTO ${table}(${names.join(',')}) VALUES(${placeholders.join(',')})`, params);
}
async function updateDynamic(table, id, values) {
  const cols = await columns(table);
  const entries = Object.entries(values).filter(([k,v]) => cols.has(k) && v !== undefined);
  if (!entries.length) return {affectedRows:0};
  const params = Object.fromEntries(entries);
  params.id = id;
  return exec(`UPDATE ${table} SET ${entries.map(([k]) => `${k}=:${k}`).join(',')} WHERE id=:id`, params);
}
async function ensureCommerce() {
  await safeExec(`CREATE TABLE IF NOT EXISTS product_customization_groups (id BIGINT PRIMARY KEY AUTO_INCREMENT, product_id BIGINT NOT NULL, name VARCHAR(120), selection_type VARCHAR(30) DEFAULT 'SINGLE', min_select INT DEFAULT 0, max_select INT DEFAULT 1, sort_order INT DEFAULT 0, created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6))`);
  await safeExec(`CREATE TABLE IF NOT EXISTS product_customization_options (id BIGINT PRIMARY KEY AUTO_INCREMENT, group_id BIGINT NOT NULL, name VARCHAR(120), price DECIMAL(10,2) DEFAULT 0, active BIT(1) DEFAULT b'1', sort_order INT DEFAULT 0, created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6))`);
  await safeExec(`CREATE TABLE IF NOT EXISTS cart_item_customizations (id BIGINT PRIMARY KEY AUTO_INCREMENT, cart_item_id BIGINT NOT NULL, customization_option_id BIGINT NULL, group_name VARCHAR(160) NULL, option_name VARCHAR(160) NULL, price DECIMAL(10,2) DEFAULT 0, created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6))`);
  await safeExec(`CREATE TABLE IF NOT EXISTS delivery_locations (id BIGINT PRIMARY KEY AUTO_INCREMENT, order_id BIGINT NULL, driver_id BIGINT NULL, latitude DECIMAL(10,7), longitude DECIMAL(10,7), heading DECIMAL(10,2), created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6))`);
  for (const q of [
    `ALTER TABLE cart_items ADD COLUMN customizations_json LONGTEXT NULL`,
    `ALTER TABLE cart_items ADD COLUMN selected_size VARCHAR(80) NULL`,
    `ALTER TABLE cart_items ADD COLUMN selected_weight VARCHAR(80) NULL`,
    `ALTER TABLE cart_items ADD COLUMN custom_weight_kg DECIMAL(10,2) NULL`,
    `ALTER TABLE order_items ADD COLUMN customizations_json LONGTEXT NULL`,
    `ALTER TABLE order_items ADD COLUMN selected_size VARCHAR(80) NULL`,
    `ALTER TABLE order_items ADD COLUMN selected_weight VARCHAR(80) NULL`,
    `ALTER TABLE order_items ADD COLUMN custom_weight_kg DECIMAL(10,2) NULL`,
  ]) await safeExec(q);
}
async function mrBreadoRestaurant() {
  let r = await safeOne(`SELECT * FROM restaurants WHERE LOWER(slug)='mr-breado' OR LOWER(name) LIKE '%mr breado%' ORDER BY id LIMIT 1`);
  if (!r) {
    const ins = await insertDynamic('restaurants', { name:'Mr Breado', slug:'mr-breado', description:'Official Mr Breado store', verification_status:'APPROVED', visibility_status:'VISIBLE', status:'APPROVED', created_at:new Date() });
    r = await safeOne('SELECT * FROM restaurants WHERE id=:id', {id:ins.insertId});
  }
  return r || {id:1, name:'Mr Breado', slug:'mr-breado'};
}
function categoryFromBody(b) { return first(b.category, b.categoryName, b.category_name, b.foodType, b.food_type, 'Food'); }
function isPizza(b) { return String(categoryFromBody(b) + ' ' + first(b.name,b.title,'')).toLowerCase().includes('pizza'); }
function isCake(b) { return String(categoryFromBody(b) + ' ' + first(b.name,b.title,'')).toLowerCase().includes('cake'); }
function basePriceFromBody(b) {
  if (isPizza(b)) return num(first(b.smallSizePrice,b.small_size_price,b.price), 0);
  if (isCake(b)) return num(first(b.cakeBasePrice,b.cake_base_price,b.price), 0);
  return num(first(b.discountPrice,b.discount_price,b.price), 0);
}
function imageFromReq(req) {
  const f = (req.files || []).find(x => x.fieldname === 'image' || x.fieldname === 'photo' || x.fieldname === 'file') || (req.files || [])[0];
  if (!f) return first(req.body?.imageUrl, req.body?.image_url, req.body?.image, '');
  return `data:${f.mimetype};base64,${f.buffer.toString('base64')}`;
}
async function categoryIdFor(name) {
  const slug = slugify(name || 'food');
  let c = await safeOne(`SELECT id FROM food_categories WHERE slug=:slug OR LOWER(name)=LOWER(:name) OR LOWER(title)=LOWER(:name) ORDER BY id LIMIT 1`, {slug, name});
  if (!c) c = await safeOne(`SELECT id FROM categories WHERE slug=:slug OR LOWER(name)=LOWER(:name) ORDER BY id LIMIT 1`, {slug,name});
  return c?.id || null;
}
async function saveProductCustomizations(productId, b) {
  await ensureCommerce();
  await safeExec(`DELETE co FROM product_customization_options co JOIN product_customization_groups cg ON cg.id=co.group_id WHERE cg.product_id=:id`, {id:productId});
  await safeExec(`DELETE FROM product_customization_groups WHERE product_id=:id`, {id:productId});
  const base = basePriceFromBody(b);
  if (isPizza(b)) {
    const small = num(first(b.smallSizePrice,b.small_size_price,base), base);
    const medium = num(first(b.mediumSizePrice,b.medium_size_price,small), small);
    const large = num(first(b.largeSizePrice,b.large_size_price,medium), medium);
    const g = await insertDynamic('product_customization_groups', {product_id:productId,name:'Pizza Size',selection_type:'SINGLE',min_select:1,max_select:1,sort_order:1,created_at:new Date()});
    const gid = g.insertId;
    await insertDynamic('product_customization_options', {group_id:gid,name:'Small',price:Math.max(0, small-base),active:1,sort_order:1,created_at:new Date()});
    await insertDynamic('product_customization_options', {group_id:gid,name:'Medium',price:Math.max(0, medium-base),active:1,sort_order:2,created_at:new Date()});
    await insertDynamic('product_customization_options', {group_id:gid,name:'Large',price:Math.max(0, large-base),active:1,sort_order:3,created_at:new Date()});
  }
  if (isCake(b)) {
    const extra = num(first(b.cakeExtraHalfKgPrice,b.cake_extra_half_kg_price), 0);
    const maxKg = num(first(b.cakeMaxWeightKg,b.cake_max_weight_kg), 5);
    const g = await insertDynamic('product_customization_groups', {product_id:productId,name:'Cake Weight',selection_type:'SINGLE',min_select:1,max_select:1,sort_order:1,created_at:new Date()});
    const gid = g.insertId;
    const weights = [0.5,1,1.5,2].filter(w => w <= maxKg);
    for (let idx=0; idx<weights.length; idx++) {
      const w = weights[idx];
      await insertDynamic('product_customization_options', {group_id:gid,name:`${w} kg`,price:Math.max(0, Math.round(((w-0.5)/0.5)*extra*100)/100),active:1,sort_order:idx+1,created_at:new Date()});
    }
    if (bool(first(b.customWeightEnabled,b.custom_weight_enabled), false)) await insertDynamic('product_customization_options', {group_id:gid,name:'Custom weight',price:0,active:1,sort_order:99,created_at:new Date()});
  }
}
async function groupsForProduct(productId) {
  await ensureCommerce();
  const groups = await safeMany(`SELECT id, product_id productId, name, name title, selection_type selectionType, selection_type, min_select minSelect, max_select maxSelect, sort_order sortOrder FROM product_customization_groups WHERE product_id=:id ORDER BY sort_order,id`, {id:productId});
  for (const g of groups) {
    const opts = await safeMany(`SELECT id, group_id groupId, name, name title, price, active, sort_order sortOrder FROM product_customization_options WHERE group_id=:id AND COALESCE(active,1)=1 ORDER BY sort_order,id`, {id:g.id});
    g.options = opts.map(o => ({...o, enabled: bool(o.active, true), available: bool(o.active, true)}));
  }
  return groups;
}
function mapProduct(p, groups=[]) {
  const name = first(p.name,p.title,p.product_name,'Food Item');
  return {...p,id:p.id,name,title:name,price:num(p.price,0),discountPrice:p.discount_price,discount_price:p.discount_price,imageUrl:first(p.imageUrl,p.image_url,p.image,''),restaurantId:p.restaurant_id,restaurantName:p.restaurantName||p.restaurant_name,restaurantSlug:p.restaurantSlug||p.restaurant_slug,categoryName:first(p.categoryName,p.category_name,p.foodCategoryName,p.menuCategoryName,p.category,''),category:first(p.category,p.categoryName,p.category_name,p.foodCategoryName,p.menuCategoryName,''),customization_groups:groups,customizationGroups:groups,customizations:groups};
}
const productSelect = `SELECT p.*, COALESCE(NULLIF(p.name,''),p.title) name, COALESCE(p.image_url,p.image) imageUrl, r.name restaurantName, r.slug restaurantSlug, fc.title foodCategoryName, fc.name categoryName, mc.title menuCategoryName FROM products p LEFT JOIN restaurants r ON r.id=p.restaurant_id LEFT JOIN food_categories fc ON fc.id=p.food_category_id LEFT JOIN menu_categories mc ON mc.id=p.menu_category_id`;
async function productBySlug(slug) { const p = await safeOne(productSelect + ` WHERE p.slug=:slug OR p.id=:slug`, {slug}); if (!p) return null; return mapProduct(p, await groupsForProduct(p.id)); }

router.get('/products/:slug', ah(async(req,res)=>{ const p = await productBySlug(req.params.slug); if (!p) return fail(res,'Product not found',404); ok(res,p); }));
router.get('/products', ah(async(req,res)=>{ const rows = await safeMany(productSelect + ` WHERE COALESCE(p.deleted,0)=0 AND COALESCE(p.available,1)=1 ORDER BY p.id DESC LIMIT 100`); ok(res, rows.map(r => mapProduct(r, []))); }));

async function createOrUpdateProduct(req, res, productId = null, forceMrBreado = false) {
  await ensureCommerce();
  const b = req.body || {};
  const title = first(b.name,b.title,'Food Item');
  const restaurant = forceMrBreado ? await mrBreadoRestaurant() : null;
  const catName = categoryFromBody(b);
  const catId = first(b.categoryId,b.category_id,b.foodCategoryId,b.food_category_id, await categoryIdFor(catName));
  const price = basePriceFromBody(b);
  const discount = first(b.discountPrice,b.discount_price,null);
  const image = imageFromReq(req);
  const values = {restaurant_id:first(b.restaurantId,b.restaurant_id,restaurant?.id,null),category_id:catId,food_category_id:catId,menu_category_id:first(b.menuCategoryId,b.menu_category_id,null),name:title,title,slug: productId ? undefined : `${slugify(first(b.slug,title))}-${Date.now()}`,subtitle:b.subtitle,description:first(b.description,''),image_url:image,image,price,discount_price:discount,currency:first(b.currency,'INR'),veg:bool(b.veg,true)?1:0,available:bool(b.available,true)?1:0,stock:first(b.stock,b.stockQuantity,b.stock_quantity,100),stock_quantity:first(b.stockQuantity,b.stock_quantity,b.stock,100),featured:bool(b.featured,false)?1:0,bestseller:bool(b.bestseller,false)?1:0,category_name:catName,created_at:new Date(),updated_at:new Date()};
  let id = productId;
  if (id) await updateDynamic('products', id, values); else { const ins = await insertDynamic('products', values); id = ins.insertId; }
  await saveProductCustomizations(id, b);
  ok(res, await productBySlug(id), productId ? 'Product updated' : 'Product created', productId ? 200 : 201);
}
router.post(['/admin/mr-breado/products','/admin/products'], requireAuth, upload.any(), ah((req,res)=>createOrUpdateProduct(req,res,null,true)));
router.put(['/admin/mr-breado/products/:id','/admin/products/:id'], requireAuth, upload.any(), ah((req,res)=>createOrUpdateProduct(req,res,req.params.id,true)));
router.get(['/admin/products','/admin/mr-breado/products'], requireAuth, ah(async(req,res)=>{ const rows=await safeMany(productSelect+` WHERE COALESCE(p.deleted,0)=0 ORDER BY p.id DESC LIMIT 500`); ok(res,{items:rows.map(r=>mapProduct(r,[])), total:rows.length, page:1, per_page:rows.length||20, total_pages:1}); }));

async function getCart(userId){ let c=await safeOne('SELECT * FROM carts WHERE user_id=:userId',{userId}); if(!c){const r=await insertDynamic('carts',{user_id:userId,created_at:new Date(),updated_at:new Date()}); c=await safeOne('SELECT * FROM carts WHERE id=:id',{id:r.insertId});} return c; }
async function pricedOptions(optionIds=[]) {
  await ensureCommerce();
  const ids = (Array.isArray(optionIds)?optionIds:[]).map(x=>Number(x)).filter(x=>x>0);
  if (!ids.length) return [];
  const rows = await safeMany(`SELECT co.id, co.name optionName, co.price, cg.name groupName FROM product_customization_options co JOIN product_customization_groups cg ON cg.id=co.group_id WHERE co.id IN (${ids.map((_,i)=>`:id${i}`).join(',')})`, Object.fromEntries(ids.map((id,i)=>[`id${i}`,id])));
  return rows;
}
async function cartData(userId){
  const c=await getCart(userId);
  const rows=await safeMany(`SELECT ci.*, ci.id cartItemId, COALESCE(NULLIF(p.name,''),p.title) name, COALESCE(p.image_url,p.image) imageUrl, p.slug, p.restaurant_id restaurantId, p.price productPrice, p.discount_price discountPrice, r.name restaurantName, r.slug restaurantSlug FROM cart_items ci LEFT JOIN products p ON p.id=ci.product_id LEFT JOIN restaurants r ON r.id=p.restaurant_id WHERE ci.cart_id=:cid ORDER BY ci.id DESC`,{cid:c.id});
  const items = rows.map(r => ({...r, customizations:parseJson(r.customizations_json || r.customizations), unitPrice:num(first(r.unit_price,r.productPrice),0), price:num(first(r.unit_price,r.productPrice),0), totalPrice:num(first(r.unit_price,r.productPrice),0)*num(r.quantity,1)}));
  const subtotal=items.reduce((s,i)=>s+num(first(i.unit_price,i.price),0)*num(i.quantity,1),0);
  return {id:c.id,items,cartItems:items,subtotal,total:subtotal,restaurant:items[0]?{id:items[0].restaurantId,name:items[0].restaurantName,slug:items[0].restaurantSlug}:null};
}
router.get('/cart', requireAuth, ah(async(req,res)=>ok(res,await cartData(req.user.id))));
router.post('/cart/items', requireAuth, ah(async(req,res)=>{
  const cart=await getCart(req.user.id); const b=req.body||{}; const productId=first(b.productId,b.product_id,b.id); const qty=Math.max(1, num(b.quantity,1));
  const p=await productBySlug(productId); if(!p) return fail(res,'Product not found',404);
  const optionIds = Array.isArray(b.customizationOptionIds) ? b.customizationOptionIds : Array.isArray(b.customization_option_ids) ? b.customization_option_ids : [];
  const opts=await pricedOptions(optionIds);
  let extra=opts.reduce((s,o)=>s+num(o.price,0),0);
  const selectedSizeText = String(first(b.selectedSize,b.selected_size,'')).toLowerCase();
  const selectedWeightText = String(first(b.selectedWeight,b.selected_weight,'')).toLowerCase();
  const baseProductPrice = num(p.price,0);
  // If frontend uses generated local option ids, calculate from stored product pricing columns.
  if (!opts.length && selectedSizeText) {
    const small = num(first(p.smallSizePrice,p.small_size_price,p.small_price,baseProductPrice),baseProductPrice);
    const medium = num(first(p.mediumSizePrice,p.medium_size_price,p.medium_price,small),small);
    const large = num(first(p.largeSizePrice,p.large_size_price,p.large_price,medium),medium);
    const selectedActual = selectedSizeText.includes('large') ? large : selectedSizeText.includes('medium') ? medium : small;
    extra = Math.max(0, selectedActual - baseProductPrice);
  }
  if (!opts.length && selectedWeightText && !selectedWeightText.includes('custom')) {
    const extraHalf = num(first(p.cakeExtraHalfKgPrice,p.cake_extra_half_kg_price,p.extra_half_kg_price),0);
    const match = selectedWeightText.match(/([0-9.]+)/);
    const kg = match ? num(match[1],0.5) : 0.5;
    extra = Math.max(0, ((kg-0.5)/0.5)*extraHalf);
  }
  let customWeightExtra=0; const customWeightKg = num(first(b.customWeightKg,b.custom_weight_kg),0);
  if (customWeightKg > 0 && selectedWeightText.includes('custom')) {
    const groups=await groupsForProduct(p.id); const weightGroup=groups.find(g=>String(g.name).toLowerCase().includes('weight')); const halfKgOpt=(weightGroup?.options||[]).find(o=>String(o.name).startsWith('1 kg')); const halfExtra = num(first(halfKgOpt?.price,p.cakeExtraHalfKgPrice,p.cake_extra_half_kg_price),0); customWeightExtra = Math.max(0, ((customWeightKg-0.5)/0.5)*halfExtra);
  }
  const unitPrice = baseProductPrice+extra+customWeightExtra;
  const custom = {selectedSize:first(b.selectedSize,b.selected_size,null),selectedWeight:first(b.selectedWeight,b.selected_weight,null),customWeightKg:customWeightKg||null,cakeMessage:first(b.cakeMessage,b.cake_message,null),options:opts};
  const ins = await insertDynamic('cart_items',{cart_id:cart.id,product_id:p.id,quantity:qty,unit_price:unitPrice,customization_total:extra+customWeightExtra,customizations:json(custom),customizations_json:json(custom),selected_size:custom.selectedSize,selected_weight:custom.selectedWeight,custom_weight_kg:custom.customWeightKg,special_instruction:first(b.specialInstruction,b.special_instruction,''),created_at:new Date(),updated_at:new Date()});
  for (const o of opts) await insertDynamic('cart_item_customizations',{cart_item_id:ins.insertId,customization_option_id:o.id,group_name:o.groupName,option_name:o.optionName,price:o.price,created_at:new Date()}).catch(()=>{});
  ok(res,await cartData(req.user.id),'Item added',201);
}));
router.delete('/cart/items/:id', requireAuth, ah(async(req,res)=>{ await safeExec('DELETE FROM cart_item_customizations WHERE cart_item_id=:id',{id:req.params.id}); await safeExec('DELETE FROM cart_items WHERE id=:id AND cart_id IN (SELECT id FROM carts WHERE user_id=:uid)',{id:req.params.id,uid:req.user.id}); ok(res,await cartData(req.user.id),'Item removed'); }));
router.delete(['/cart','/cart/clear'], requireAuth, ah(async(req,res)=>{ const c=await getCart(req.user.id); await safeExec('DELETE FROM cart_item_customizations WHERE cart_item_id IN (SELECT id FROM cart_items WHERE cart_id=:id)',{id:c.id}); await safeExec('DELETE FROM cart_items WHERE cart_id=:id',{id:c.id}); ok(res,await cartData(req.user.id),'Cart cleared'); }));
router.post('/checkout/summary', requireAuth, ah(async(req,res)=>{ const cart=await cartData(req.user.id); const deliveryFee=num(first(req.body.deliveryFee,req.body.delivery_fee),30), platformFee=num(first(req.body.platformFee,req.body.platform_fee),5), discount=num(req.body.discount,0); ok(res,{...cart,deliveryFee,platformFee,discount,total:Math.max(cart.subtotal+deliveryFee+platformFee-discount,0),payableAmount:Math.max(cart.subtotal+deliveryFee+platformFee-discount,0)}); }));
router.post('/user/orders', requireAuth, ah(async(req,res)=>{
  const cart=await cartData(req.user.id); const items=Array.isArray(req.body?.items)&&req.body.items.length?req.body.items:cart.items; if(!items.length) return fail(res,'Cart is empty',400);
  const paymentType=String(first(req.body.paymentType,req.body.payment_type,req.body.paymentMethod,'COD')).toUpperCase();
  const subtotal=items.reduce((s,i)=>s+num(first(i.unit_price,i.unitPrice,i.price),0)*num(i.quantity,1),0); const deliveryFee=num(first(req.body.deliveryFee,req.body.delivery_fee),30), platformFee=num(first(req.body.platformFee,req.body.platform_fee),5), discount=num(req.body.discount,0); const total=Math.max(subtotal+deliveryFee+platformFee-discount,0); const addr=req.body.address||{};
  const orderNo=`ORD-${Date.now()}`;
  const ins = await insertDynamic('orders',{user_id:req.user.id,restaurant_id:first(req.body.restaurantId,req.body.restaurant_id,items[0]?.restaurantId,items[0]?.restaurant_id,null),slug:orderNo,order_number:orderNo,status:'PLACED',payment_type:paymentType,payment_status:paymentType==='ONLINE'?'PAID':'PENDING',items_total:subtotal,subtotal,delivery_fee:deliveryFee,platform_fee:platformFee,discount,grand_total:total,total,delivery_address:first(addr.address,addr.addressLine1,req.body.addressLine,''),delivery_city:first(addr.city,req.body.city,''),delivery_state:first(addr.state,req.body.state,''),delivery_country:first(addr.country,req.body.country,'India'),delivery_zipcode:first(addr.pincode,addr.zipcode,req.body.pincode,req.body.zipcode,''),delivery_mobile:first(addr.mobile,addr.phone,req.body.mobile,''),delivery_name:first(addr.name,req.user.name,''),delivery_latitude:first(addr.latitude,req.body.userLatitude,req.body.user_latitude,null),delivery_longitude:first(addr.longitude,req.body.userLongitude,req.body.user_longitude,null),order_note:first(req.body.deliveryInstruction,req.body.orderNote,req.body.order_note,''),address_snapshot:json(addr),razorpay_order_id:first(req.body.razorpayOrderId,req.body.razorpay_order_id,null),razorpay_payment_id:first(req.body.razorpayPaymentId,req.body.razorpay_payment_id,null),razorpay_signature:first(req.body.razorpaySignature,req.body.razorpay_signature,null),created_at:new Date(),updated_at:new Date()});
  const orderId=ins.insertId;
  for (const i of items) { const unit=num(first(i.unit_price,i.unitPrice,i.price),0); const qty=num(i.quantity,1); const custom = typeof i.customizations === 'object' ? i.customizations : parseJson(i.customizations_json || i.customizations); await insertDynamic('order_items',{order_id:orderId,product_id:first(i.product_id,i.productId,null),name:first(i.name,i.title,'Item'),title:first(i.name,i.title,'Item'),quantity:qty,unit_price:unit,total:unit*qty,total_price:unit*qty,customization_total:num(i.customization_total,0),customizations:json(custom),customizations_json:json(custom),selected_size:first(i.selected_size,i.selectedSize,custom.selectedSize,null),selected_weight:first(i.selected_weight,i.selectedWeight,custom.selectedWeight,null),custom_weight_kg:first(i.custom_weight_kg,i.customWeightKg,custom.customWeightKg,null),created_at:new Date()}); }
  await safeExec('DELETE FROM cart_item_customizations WHERE cart_item_id IN (SELECT id FROM cart_items WHERE cart_id=:id)',{id:cart.id}); await safeExec('DELETE FROM cart_items WHERE cart_id=:id',{id:cart.id});
  ok(res, await safeOne('SELECT *, grand_total total FROM orders WHERE id=:id',{id:orderId}), 'Order placed', 201);
}));
router.get('/user/orders/:id/tracking', requireAuth, ah(async(req,res)=>{ const order=await safeOne('SELECT *, grand_total total FROM orders WHERE id=:id OR slug=:id OR order_number=:id',{id:req.params.id}); const locations=await safeMany('SELECT * FROM delivery_locations WHERE order_id=:id ORDER BY id DESC LIMIT 50',{id:order?.id||req.params.id}); const assignment=await safeOne('SELECT da.*, u.name driverName, u.mobile driverMobile, u.phone_number driverPhone FROM delivery_assignments da LEFT JOIN users u ON u.id=da.driver_id WHERE da.order_id=:id ORDER BY da.id DESC LIMIT 1',{id:order?.id||req.params.id}); ok(res,{order,locations,latestLocation:locations[0]||null,assignment,driver:assignment}); }));
module.exports = router;
