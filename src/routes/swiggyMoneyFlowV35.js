const router = require('express').Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { pool } = require('../utils/db');
const { ok, fail } = require('../utils/respond');
const ah = require('../utils/asyncHandler');
const { optionalAuth } = require('../middleware/auth');
const { cloudinary: cfg, limits } = require('../config/env');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: (limits && limits.imageBytes) || 8 * 1024 * 1024, files: 8 } });
if (cfg && cfg.cloudName) cloudinary.config({ cloud_name: cfg.cloudName, api_key: cfg.apiKey, api_secret: cfg.apiSecret });

router.use(optionalAuth);

const colCache = new Map();
async function cols(table){
  if(colCache.has(table)) return colCache.get(table);
  try{ const [r]=await pool.execute(`SHOW COLUMNS FROM \`${table}\``); const s=new Set(r.map(x=>x.Field)); colCache.set(table,s); return s; }
  catch(e){ const s=new Set(); colCache.set(table,s); return s; }
}
async function exists(table){ return (await cols(table)).size>0; }
async function q(sql, params=[]){ const [r]=await pool.execute(sql, params); return r; }
async function safeQ(sql, params=[]){ try{ return await q(sql,params); }catch(e){ console.error('[v35 query]',e.message,sql); return []; } }
async function first(sql, params=[]){ const r=await safeQ(sql,params); return r[0]||null; }
async function safeExec(sql, params=[]){ try{ const [r]=await pool.execute(sql,params); return r; }catch(e){ console.error('[v35 exec]',e.message,sql); return null; } }
function n(v,d=0){ const x=Number(v); return Number.isFinite(x)?x:d; }
function s(v,d=''){ return v===undefined||v===null?d:String(v); }
function bool(v,d=false){ if(v===undefined||v===null||v==='') return d; if(Buffer.isBuffer(v)) return v[0]===1; if(typeof v==='boolean') return v; if(typeof v==='number') return v===1; if(v&&Array.isArray(v.data)) return Number(v.data[0])===1; const t=String(v).trim().toLowerCase(); return ['1','true','yes','active','available','open'].includes(t); }
function slug(x='item'){ return String(x).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || `item-${Date.now()}`; }
function val(obj, keys, d=null){ for(const k of keys){ if(obj && obj[k]!==undefined && obj[k]!==null && obj[k] !== '') return obj[k]; } return d; }
function parseBody(body){ const out={...(body||{})}; for(const k of Object.keys(out)){ if(typeof out[k]==='string'){ const t=out[k].trim(); if((t.startsWith('{')&&t.endsWith('}'))||(t.startsWith('[')&&t.endsWith(']'))){ try{ out[k]=JSON.parse(t); }catch{} } } } return out; }
async function insertDynamic(table, data){ const c=await cols(table); const d={}; for(const [k,v] of Object.entries(data)){ if(c.has(k) && v!==undefined) d[k]=v; } if(!Object.keys(d).length) throw new Error(`No columns matched for ${table}`); const ks=Object.keys(d); const [r]=await pool.execute(`INSERT INTO \`${table}\` (${ks.map(k=>`\`${k}\``).join(',')}) VALUES (${ks.map(()=>'?').join(',')})`, Object.values(d)); return r.insertId; }
async function updateDynamic(table, id, data){ const c=await cols(table); const d={}; for(const [k,v] of Object.entries(data)){ if(c.has(k) && v!==undefined) d[k]=v; } if(!Object.keys(d).length) return 0; const ks=Object.keys(d); const [r]=await pool.execute(`UPDATE \`${table}\` SET ${ks.map(k=>`\`${k}\`=?`).join(',')} WHERE id=?`, [...Object.values(d), id]); return r.affectedRows; }
async function uploadImage(file){
  if(!file) return null;
  if(!(cfg && cfg.cloudName)) return `/uploads/${file.originalname}`;
  const dataUri = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
  const up = await cloudinary.uploader.upload(dataUri, { folder:'mr-breado/products', resource_type:'image' });
  return up.secure_url;
}
async function initV35(){
  await safeExec(`CREATE TABLE IF NOT EXISTS restaurant_payout_ledgers (id BIGINT PRIMARY KEY AUTO_INCREMENT, order_id BIGINT NULL, restaurant_id BIGINT NULL, seller_id BIGINT NULL, gross_food_amount DECIMAL(12,2) DEFAULT 0, packaging_charge DECIMAL(12,2) DEFAULT 0, commission_percent DECIMAL(6,2) DEFAULT 15, commission_amount DECIMAL(12,2) DEFAULT 0, restaurant_discount DECIMAL(12,2) DEFAULT 0, net_payable DECIMAL(12,2) DEFAULT 0, settlement_status VARCHAR(32) DEFAULT 'PENDING', settlement_reference VARCHAR(120) NULL, settled_at DATETIME NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await safeExec(`CREATE TABLE IF NOT EXISTS rider_earning_ledgers (id BIGINT PRIMARY KEY AUTO_INCREMENT, order_id BIGINT NULL, rider_id BIGINT NULL, distance_km DECIMAL(10,2) DEFAULT 0, base_pay DECIMAL(12,2) DEFAULT 0, distance_pay DECIMAL(12,2) DEFAULT 0, incentive DECIMAL(12,2) DEFAULT 0, tip DECIMAL(12,2) DEFAULT 0, total_earning DECIMAL(12,2) DEFAULT 0, cash_collected DECIMAL(12,2) DEFAULT 0, cash_deposit_required DECIMAL(12,2) DEFAULT 0, settlement_status VARCHAR(32) DEFAULT 'PENDING', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await safeExec(`CREATE TABLE IF NOT EXISTS admin_revenue_ledgers (id BIGINT PRIMARY KEY AUTO_INCREMENT, order_id BIGINT NULL, restaurant_id BIGINT NULL, seller_id BIGINT NULL, commission_amount DECIMAL(12,2) DEFAULT 0, platform_fee DECIMAL(12,2) DEFAULT 0, delivery_fee_collected DECIMAL(12,2) DEFAULT 0, rider_cost DECIMAL(12,2) DEFAULT 0, delivery_margin DECIMAL(12,2) DEFAULT 0, net_admin_revenue DECIMAL(12,2) DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await safeExec(`CREATE TABLE IF NOT EXISTS order_money_snapshots (id BIGINT PRIMARY KEY AUTO_INCREMENT, order_id BIGINT NULL, subtotal DECIMAL(12,2) DEFAULT 0, restaurant_charge DECIMAL(12,2) DEFAULT 0, delivery_fee DECIMAL(12,2) DEFAULT 0, platform_fee DECIMAL(12,2) DEFAULT 0, tax DECIMAL(12,2) DEFAULT 0, discount DECIMAL(12,2) DEFAULT 0, grand_total DECIMAL(12,2) DEFAULT 0, commission_percent DECIMAL(6,2) DEFAULT 15, seller_payable DECIMAL(12,2) DEFAULT 0, rider_payable DECIMAL(12,2) DEFAULT 0, admin_revenue DECIMAL(12,2) DEFAULT 0, payment_method VARCHAR(32), payment_status VARCHAR(32), created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await safeExec(`CREATE TABLE IF NOT EXISTS product_pricing_rules (id BIGINT PRIMARY KEY AUTO_INCREMENT, product_id BIGINT NOT NULL, pricing_type VARCHAR(32) DEFAULT 'FIXED', small_price DECIMAL(12,2) NULL, medium_price DECIMAL(12,2) NULL, large_price DECIMAL(12,2) NULL, cake_500gm_price DECIMAL(12,2) NULL, cake_extra_half_kg_price DECIMAL(12,2) NULL, cake_min_kg DECIMAL(8,2) DEFAULT 0.5, cake_max_kg DECIMAL(8,2) DEFAULT 5, allow_custom_weight BIT(1) DEFAULT b'0', allow_cake_message BIT(1) DEFAULT b'0', cake_message_charge DECIMAL(12,2) DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY ux_product_pricing(product_id))`);
  await safeExec(`ALTER TABLE order_items ADD COLUMN selected_size VARCHAR(50) NULL`);
  await safeExec(`ALTER TABLE order_items ADD COLUMN selected_weight DECIMAL(8,2) NULL`);
  await safeExec(`ALTER TABLE order_items ADD COLUMN customization_snapshot LONGTEXT NULL`);
}
let inited=false; async function ensure(){ if(!inited){ await initV35(); inited=true; } }
async function mrBreadoRestaurant(){ return await first(`SELECT * FROM restaurants WHERE LOWER(COALESCE(slug,''))='mr-breado' OR LOWER(COALESCE(name,'')) LIKE '%mr breado%' ORDER BY id LIMIT 1`); }
function categoryNameFromBody(b){ return String(val(b,['categoryName','category_name','category','foodType','food_type'],'')).trim(); }
async function categoryNameById(id){ if(!id) return ''; const c=await first('SELECT * FROM categories WHERE id=? LIMIT 1',[id]); return c?.name || c?.title || ''; }
async function savePricingRules(productId, body, categoryName){
  await ensure();
  const cat=String(categoryName||categoryNameFromBody(body)).toLowerCase();
  const isPizza = cat.includes('pizza') || ['pizza'].includes(String(body.foodType||body.type||'').toLowerCase());
  const isCake = cat.includes('cake') || ['cake'].includes(String(body.foodType||body.type||'').toLowerCase());
  const small=n(val(body,['smallSizePrice','small_size_price','smallPrice','small_price','smallSizeExtra','small_size_extra']),0);
  const medium=n(val(body,['mediumSizePrice','medium_size_price','mediumPrice','medium_price','mediumSizeExtra','medium_size_extra']),0);
  const large=n(val(body,['largeSizePrice','large_size_price','largePrice','large_price','largeSizeExtra','large_size_extra']),0);
  const c500=n(val(body,['cakeBasePrice','cake_base_price','cake500gmPrice','cake_500gm_price','base500gmPrice','price']),0);
  const cExtra=n(val(body,['cakeExtraHalfKgPrice','cake_extra_half_kg_price','extraHalfKgPrice','cake500gmExtra']),0);
  const minKg=n(val(body,['cakeMinWeightKg','cake_min_weight_kg','minKg'],0.5),0.5);
  const maxKg=n(val(body,['cakeMaxWeightKg','cake_max_weight_kg','maxKg'],5),5);
  const messageCharge=n(val(body,['cakeMessageCharge','cake_message_charge'],0),0);
  const allowMsg=bool(val(body,['cakeMessageEnabled','cake_message_enabled','allowCakeMessage','allow_cake_message'],false));
  const allowCustom=bool(val(body,['customWeightEnabled','custom_weight_enabled','allowCustomWeight','allow_custom_weight'],false));
  await safeExec('DELETE FROM product_pricing_rules WHERE product_id=?',[productId]);
  await insertDynamic('product_pricing_rules',{product_id:productId, pricing_type:isPizza?'PIZZA_SIZE':isCake?'CAKE_WEIGHT':'FIXED', small_price:small||null, medium_price:medium||null, large_price:large||null, cake_500gm_price:c500||null, cake_extra_half_kg_price:cExtra||null, cake_min_kg:minKg, cake_max_kg:maxKg, allow_custom_weight:allowCustom?1:0, allow_cake_message:allowMsg?1:0, cake_message_charge:messageCharge, created_at:new Date(), updated_at:new Date()});

  const gc=await cols('product_customization_groups'), oc=await cols('product_customization_options');
  if(!gc.size||!oc.size) return;
  await safeExec('DELETE FROM product_customization_options WHERE group_id IN (SELECT id FROM product_customization_groups WHERE product_id=?)',[productId]);
  await safeExec('DELETE FROM product_customization_groups WHERE product_id=?',[productId]);
  const gTitle=gc.has('title')?'title':(gc.has('name')?'name':'group_name'); const gType=gc.has('type')?'type':(gc.has('selection_type')?'selection_type':'type');
  const oTitle=oc.has('title')?'title':(oc.has('name')?'name':'option_name'); const oPrice=oc.has('price')?'price':(oc.has('additional_price')?'additional_price':'extra_price');
  async function addGroup(name, opts){
    const gd={product_id:productId,[gTitle]:name,[gType]:'SINGLE',required:1,min_select:1,max_select:1,sort_order:1,priority:1,created_at:new Date(),updated_at:new Date()};
    const gid=await insertDynamic('product_customization_groups',gd);
    let i=1; for(const [title,price,meta] of opts){ await insertDynamic('product_customization_options',{group_id:gid,[oTitle]:title,[oPrice]:n(price),active:1,enabled:1,available:1,sort_order:i,priority:i,meta_json:meta?JSON.stringify(meta):undefined,created_at:new Date(),updated_at:new Date()}); i++; }
  }
  if(isPizza){ const base=small||n(body.price,0); await addGroup('Choose Size',[['Small',Math.max(0,(small||base)-base),{size:'Small',finalPrice:small||base}],['Medium',Math.max(0,(medium||base)-base),{size:'Medium',finalPrice:medium||base}],['Large',Math.max(0,(large||base)-base),{size:'Large',finalPrice:large||base}]]); }
  if(isCake){
    const base=c500||n(body.price,0); const opts=[]; const max=Math.min(Math.max(maxKg,0.5),10);
    for(let kg=0.5; kg<=max+0.001; kg+=0.5){ const price=kg===0.5?base:base+((kg-0.5)/0.5)*cExtra; opts.push([kg===0.5?'500 gm':`${kg} kg`,Math.max(0,Math.round((price-base)*100)/100),{weightKg:kg,finalPrice:price}]); }
    await addGroup('Choose Weight',opts); if(allowMsg) await addGroup('Cake Message',[['Write name/message',messageCharge,{messageAllowed:true}]]);
  }
}
async function upsertProduct(req,res,id=null,mrBreado=false){
  await ensure(); const body=parseBody(req.body); const pc=await cols('products'); if(!pc.size) return fail(res,'products table missing',500);
  const title=s(val(body,['title','name','productName','product_name'],'Food item')).trim();
  let requestedCatId=val(body,['categoryId','category_id','foodCategoryId','food_category_id','menuCategoryId','menu_category_id'],null);
  let categoryName=categoryNameFromBody(body) || await categoryNameById(requestedCatId);
  if(!requestedCatId && categoryName){ const cat=await first("SELECT id,name FROM categories WHERE LOWER(name)=LOWER(?) OR LOWER(COALESCE(slug,''))=LOWER(?) LIMIT 1",[categoryName, categoryName]); if(cat) requestedCatId=cat.id; }
  const isPizza=categoryName.toLowerCase().includes('pizza'); const isCake=categoryName.toLowerCase().includes('cake');
  const price = isPizza ? n(val(body,['smallSizePrice','smallPrice','price'],0),0) : isCake ? n(val(body,['cakeBasePrice','cake500gmPrice','base500gmPrice','price'],0),0) : n(val(body,['price','sellingPrice','basePrice'],0),0);
  const img=await uploadImage((req.files||[]).find(f=>['image','file','photo'].includes(f.fieldname))) || val(body,['imageUrl','image_url','image','thumbnailUrl'],null);
  let restaurantId=val(body,['restaurantId','restaurant_id','storeId'],null);
  if(mrBreado && !restaurantId){ const r=await mrBreadoRestaurant(); restaurantId=r?.id || null; }
  const data={ name:title, title, product_name:title, slug:slug(title), description:val(body,['description','subtitle','details'],''), subtitle:val(body,['subtitle'],''), price, base_price:price, selling_price:price, regular_price:price, discount_price:val(body,['discountPrice','discount_price'],null), restaurant_id:restaurantId, store_id:restaurantId, category_id:requestedCatId, food_category_id:requestedCatId, menu_category_id:requestedCatId, image_url:img, image:img, thumbnail_url:img, veg:bool(val(body,['veg','isVeg'],true))?1:0, available:bool(val(body,['available','isAvailable'],true))?1:0, active:bool(val(body,['active'],true))?1:0, visible:bool(val(body,['visible'],true))?1:0, featured:mrBreado||bool(val(body,['featured','bestseller'],false))?1:0, stock_quantity:n(val(body,['stockQuantity','stock_quantity','stock'],0),0), updated_at:new Date(), created_at:new Date() };
  let productId=id?Number(id):null;
  if(productId){ await updateDynamic('products',productId,data); } else productId=await insertDynamic('products',data);
  await savePricingRules(productId, body, categoryName);
  const row=await productDetail(productId);
  ok(res,row,id?'Product updated':'Product created',id?200:201);
}
async function productDetail(id){
  const p=await first(`SELECT p.*, c.name categoryName, r.name restaurantName, pr.* FROM products p LEFT JOIN categories c ON c.id=COALESCE(p.category_id,p.food_category_id,p.menu_category_id) LEFT JOIN restaurants r ON r.id=p.restaurant_id LEFT JOIN product_pricing_rules pr ON pr.product_id=p.id WHERE p.id=? LIMIT 1`,[id]);
  if(!p) return null; const groups=await safeQ(`SELECT g.id,g.name,g.title,g.selection_type,g.type,g.min_select,g.max_select FROM product_customization_groups g WHERE g.product_id=? ORDER BY COALESCE(g.sort_order,g.priority,0),g.id`,[id]);
  for(const g of groups){ g.options=await safeQ(`SELECT id,name,title,price,additional_price,extra_price FROM product_customization_options WHERE group_id=? ORDER BY COALESCE(sort_order,priority,0),id`,[g.id]); }
  const priceRules={ pricingType:p.pricing_type||'FIXED', smallSizePrice:p.small_price, mediumSizePrice:p.medium_price, largeSizePrice:p.large_price, cake500gmPrice:p.cake_500gm_price, cakeExtraHalfKgPrice:p.cake_extra_half_kg_price, cakeMinKg:p.cake_min_kg, cakeMaxKg:p.cake_max_kg, allowCustomWeight:bool(p.allow_custom_weight), allowCakeMessage:bool(p.allow_cake_message), cakeMessageCharge:p.cake_message_charge };
  return {...p, id:p.id, title:p.name||p.title, name:p.name||p.title, imageUrl:p.image_url||p.image, priceRules, customizationGroups:groups, customization_groups:groups, available:bool(p.available,true), isAvailable:bool(p.available,true)};
}

router.post(['/seller/products','/admin/products','/admin/foods','/admin/mr-breado/products','/admin/mr-breado/foods'], upload.any(), ah((req,res)=>upsertProduct(req,res,null,req.path.includes('mr-breado'))));
router.put(['/seller/products/:id','/admin/products/:id','/admin/foods/:id','/admin/mr-breado/products/:id','/admin/mr-breado/foods/:id'], upload.any(), ah((req,res)=>upsertProduct(req,res,req.params.id,req.path.includes('mr-breado'))));
router.get(['/products/:id/pricing','/admin/products/:id/pricing','/seller/products/:id/pricing'], ah(async(req,res)=>ok(res, await productDetail(req.params.id), 'Product pricing loaded')));
router.get(['/admin/money/restaurant-payouts','/admin/restaurant-payout-ledgers','/admin/restaurant-settlements-v35'], ah(async(req,res)=>{ await ensure(); const rows=await safeQ(`SELECT l.*, r.name restaurantName, u.name sellerName FROM restaurant_payout_ledgers l LEFT JOIN restaurants r ON r.id=l.restaurant_id LEFT JOIN users u ON u.id=l.seller_id ORDER BY l.id DESC LIMIT 500`); ok(res,{items:rows,data:rows,total:rows.length,content:rows},'Restaurant payout ledgers loaded'); }));
router.get(['/admin/money/rider-payouts','/admin/rider-earning-ledgers'], ah(async(req,res)=>{ await ensure(); const rows=await safeQ(`SELECT l.*, u.name riderName, u.phone riderPhone FROM rider_earning_ledgers l LEFT JOIN users u ON u.id=l.rider_id ORDER BY l.id DESC LIMIT 500`); ok(res,{items:rows,data:rows,total:rows.length,content:rows},'Rider earning ledgers loaded'); }));
router.get(['/admin/money/admin-revenue','/admin/revenue-ledgers'], ah(async(req,res)=>{ await ensure(); const rows=await safeQ(`SELECT l.*, r.name restaurantName, u.name sellerName FROM admin_revenue_ledgers l LEFT JOIN restaurants r ON r.id=l.restaurant_id LEFT JOIN users u ON u.id=l.seller_id ORDER BY l.id DESC LIMIT 500`); ok(res,{items:rows,data:rows,total:rows.length,content:rows},'Admin revenue ledgers loaded'); }));
router.post(['/admin/money/rebuild-ledgers','/admin/rebuild-payout-ledgers'], ah(async(req,res)=>{ await ensure(); const orders=await safeQ(`SELECT * FROM orders ORDER BY id DESC LIMIT 500`); let count=0; for(const o of orders){ await rebuildLedgerForOrder(o.id); count++; } ok(res,{count},'Money ledgers rebuilt'); }));
async function rebuildLedgerForOrder(orderId){
  await ensure(); const o=await first('SELECT * FROM orders WHERE id=?',[orderId]); if(!o) return;
  const subtotal=n(o.subtotal||o.sub_total||o.item_total||o.food_total||o.grand_total||o.total_amount||0); const delivery=n(o.delivery_charge||o.delivery_fee||0); const platform=n(o.platform_fee||5); const tax=n(o.tax||o.tax_amount||0); const discount=n(o.discount||o.discount_amount||0); const grand=n(o.grand_total||o.total_amount||subtotal+delivery+platform+tax-discount); const commissionPercent=n(o.commission_percent,15); const commission=Math.round(subtotal*commissionPercent)/100; const sellerPayable=Math.max(0,subtotal-commission); const riderPay=n(o.rider_pay||Math.max(30,n(o.delivery_distance_km||o.distance_km,0)*30)); const adminRevenue=commission+platform+delivery-riderPay;
  await safeExec('DELETE FROM restaurant_payout_ledgers WHERE order_id=?',[orderId]); await safeExec('DELETE FROM rider_earning_ledgers WHERE order_id=?',[orderId]); await safeExec('DELETE FROM admin_revenue_ledgers WHERE order_id=?',[orderId]); await safeExec('DELETE FROM order_money_snapshots WHERE order_id=?',[orderId]);
  await insertDynamic('restaurant_payout_ledgers',{order_id:orderId,restaurant_id:o.restaurant_id,seller_id:o.seller_id||o.restaurant_owner_id,gross_food_amount:subtotal,packaging_charge:n(o.restaurant_charge||0),commission_percent:commissionPercent,commission_amount:commission,restaurant_discount:0,net_payable:sellerPayable,settlement_status:'PENDING',created_at:new Date()});
  await insertDynamic('rider_earning_ledgers',{order_id:orderId,rider_id:o.rider_id||o.delivery_partner_id,distance_km:n(o.delivery_distance_km||o.distance_km,0),base_pay:30,distance_pay:Math.max(0,riderPay-30),total_earning:riderPay,cash_collected:String(o.payment_method||o.payment_type||'').toUpperCase().includes('COD')?grand:0,cash_deposit_required:String(o.payment_method||o.payment_type||'').toUpperCase().includes('COD')?Math.max(0,grand-riderPay):0,settlement_status:'PENDING',created_at:new Date()});
  await insertDynamic('admin_revenue_ledgers',{order_id:orderId,restaurant_id:o.restaurant_id,seller_id:o.seller_id||o.restaurant_owner_id,commission_amount:commission,platform_fee:platform,delivery_fee_collected:delivery,rider_cost:riderPay,delivery_margin:delivery-riderPay,net_admin_revenue:adminRevenue,created_at:new Date()});
  await insertDynamic('order_money_snapshots',{order_id:orderId,subtotal,restaurant_charge:n(o.restaurant_charge||0),delivery_fee:delivery,platform_fee:platform,tax,discount,grand_total:grand,commission_percent:commissionPercent,seller_payable:sellerPayable,rider_payable:riderPay,admin_revenue:adminRevenue,payment_method:o.payment_method||o.payment_type,payment_status:o.payment_status,created_at:new Date()});
}
router.post(['/orders/:id/rebuild-ledger','/admin/orders/:id/rebuild-ledger'], ah(async(req,res)=>{ await rebuildLedgerForOrder(req.params.id); ok(res,{orderId:req.params.id},'Order ledger rebuilt'); }));
module.exports = router;
