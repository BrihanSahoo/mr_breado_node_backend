const router = require('express').Router();
const { ok, fail } = require('../utils/respond');
const ah = require('../utils/asyncHandler');
const { optionalAuth } = require('../middleware/auth');
const { pool } = require('../utils/db');

router.use(optionalAuth);

const colCache = new Map();
async function cols(table){
  if(colCache.has(table)) return colCache.get(table);
  try{ const [r]=await pool.execute(`SHOW COLUMNS FROM \`${table}\``); const s=new Set(r.map(x=>x.Field)); colCache.set(table,s); return s; }
  catch{ const s=new Set(); colCache.set(table,s); return s; }
}
async function hasTable(table){ return (await cols(table)).size > 0; }
async function q(sql,params=[]){ try{ const [r]=await pool.execute(sql,params); return r; }catch(e){ console.error('[singleBrandV38 query]',e.message,sql); return []; } }
async function x(sql,params=[]){ const [r]=await pool.execute(sql,params); return r; }
async function one(sql,params=[]){ const r=await q(sql,params); return r[0]||null; }
function n(v,d=0){ const z=Number(v); return Number.isFinite(z)?z:d; }
function s(v,d=''){ return v===undefined||v===null?d:String(v); }
function bit(v,d=false){ if(v===undefined||v===null)return d; if(Buffer.isBuffer(v))return v[0]===1; if(v&&Array.isArray(v.data))return Number(v.data[0])===1; if(typeof v==='boolean')return v; if(typeof v==='number')return v===1; return ['1','true','yes','active','open','verified'].includes(String(v).toLowerCase()); }
function slugify(v='mr-breado'){ return String(v).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'mr-breado'; }
function pick(names,c,def=null){ for(const k of names) if(c.has(k)) return k; return def; }
function distanceKm(aLat,aLng,bLat,bLng){ const R=6371, toRad=v=>v*Math.PI/180; const dLat=toRad(bLat-aLat), dLng=toRad(bLng-aLng); const A=Math.sin(dLat/2)**2+Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLng/2)**2; return R*2*Math.atan2(Math.sqrt(A),Math.sqrt(1-A)); }
function page(items,req){ const p=Math.max(1,n(req.query.page||req.query.currentPage,1)); const pp=Math.max(1,n(req.query.limit||req.query.perPage||req.query.per_page,items.length||20)); return {items,content:items,data:items,total:items.length,totalElements:items.length,total_items:items.length,page:p,currentPage:p,perPage:pp,per_page:pp,totalPages:1,total_pages:1,last:true}; }
async function setting(key,def){ try{ const r=await one('SELECT setting_value FROM settings WHERE setting_key=? LIMIT 1',[key]); if(!r) return def; let v=r.setting_value; if(Buffer.isBuffer(v)) v=v.toString(); try{ v=JSON.parse(v); }catch{} return v?.value ?? v ?? def; }catch{return def;} }

async function ensureSingleBrandTables(){
  await x(`CREATE TABLE IF NOT EXISTS outlets (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_code VARCHAR(80) UNIQUE,
    name VARCHAR(255) NOT NULL,
    address VARCHAR(700), city VARCHAR(120), state VARCHAR(120), pincode VARCHAR(20),
    latitude DECIMAL(12,8), longitude DECIMAL(12,8), service_radius_km DECIMAL(8,2) DEFAULT 5,
    manager_name VARCHAR(255), manager_phone VARCHAR(40), manager_email VARCHAR(255),
    is_open BIT(1) NOT NULL DEFAULT b'1', is_active BIT(1) NOT NULL DEFAULT b'1',
    takeaway_enabled BIT(1) NOT NULL DEFAULT b'1', delivery_enabled BIT(1) NOT NULL DEFAULT b'1',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_product_stock (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    stock_quantity INT NOT NULL DEFAULT 0,
    low_stock_alert INT NOT NULL DEFAULT 5,
    is_available BIT(1) NOT NULL DEFAULT b'1',
    preparation_minutes INT DEFAULT 15,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_outlet_product_stock (outlet_id, product_id)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_delivery_boys (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    assigned_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    is_active BIT(1) NOT NULL DEFAULT b'1',
    UNIQUE KEY uq_outlet_delivery_boy (outlet_id, user_id)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_sales_daily (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL,
    report_date DATE NOT NULL,
    order_count INT NOT NULL DEFAULT 0,
    gross_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
    online_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
    cod_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
    delivery_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
    cancelled_count INT NOT NULL DEFAULT 0,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_outlet_day (outlet_id, report_date)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS accounting_export_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    export_type VARCHAR(80) NOT NULL,
    outlet_id BIGINT NULL,
    from_date DATE NULL,
    to_date DATE NULL,
    file_url VARCHAR(1000) NULL,
    created_by BIGINT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS admin_action_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    actor_id BIGINT NULL,
    action VARCHAR(120) NOT NULL,
    target_type VARCHAR(80),
    target_id BIGINT,
    note VARCHAR(1000),
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
  )`);
  const rest = await hasTable('restaurants');
  if(rest){
    const rc=await cols('restaurants');
    const name=pick(['name','restaurant_name'],rc,'name');
    const addr=pick(['address','full_address'],rc);
    const city=pick(['city'],rc); const state=pick(['state'],rc); const pin=pick(['pincode','pin_code'],rc);
    const lat=pick(['latitude','lat'],rc); const lng=pick(['longitude','lng'],rc);
    const open=pick(['is_open','open'],rc); const active=pick(['is_active','active'],rc);
    const rows=await q(`SELECT * FROM restaurants WHERE LOWER(${name}) LIKE '%mr breado%' OR LOWER(${name}) LIKE '%mr.breado%' ORDER BY id LIMIT 100`);
    for(const r of rows){
      const code='OUTLET-'+r.id;
      await q(`INSERT IGNORE INTO outlets (outlet_code,name,address,city,state,pincode,latitude,longitude,is_open,is_active) VALUES (?,?,?,?,?,?,?,?,?,?)`,[
        code, r[name]||`Mr Breado Outlet ${r.id}`, addr?r[addr]:null, city?r[city]:null, state?r[state]:null, pin?r[pin]:null, lat?r[lat]:null, lng?r[lng]:null, open?Number(bit(r[open],true)):1, active?Number(bit(r[active],true)):1
      ]);
    }
  }
}

async function restaurantOutlets(){
  const rc=await cols('restaurants'); if(!rc.size) return [];
  const name=pick(['name','restaurant_name'],rc,'name'); const addr=pick(['address','full_address'],rc); const city=pick(['city'],rc); const pin=pick(['pincode','pin_code'],rc);
  const lat=pick(['latitude','lat'],rc); const lng=pick(['longitude','lng'],rc); const open=pick(['is_open','open'],rc); const active=pick(['is_active','active'],rc); const rating=pick(['rating'],rc);
  const rows=await q(`SELECT * FROM restaurants ORDER BY id DESC LIMIT 500`);
  return rows.map(r=>({
    id:r.id, outletId:r.id, source:'restaurants', outletCode:`REST-${r.id}`, name:r[name]||'Mr Breado Outlet', address:addr?r[addr]:'', city:city?r[city]:'', pincode:pin?r[pin]:'',
    latitude:lat?n(r[lat],null):null, longitude:lng?n(r[lng],null):null, serviceRadiusKm:n(r.service_radius_km||r.delivery_radius_km, n(r.deliveryRadiusKm, 5)),
    isOpen:open?bit(r[open],true):true, isActive:active?bit(r[active],true):true, rating:rating?n(r[rating],0):0,
    raw:r
  }));
}
async function outletRows(){
  await ensureSingleBrandTables();
  const native=(await q('SELECT * FROM outlets ORDER BY id DESC LIMIT 500')).map(r=>({
    id:r.id,outletId:r.id,source:'outlets',outletCode:r.outlet_code,name:r.name,address:r.address||'',city:r.city||'',pincode:r.pincode||'',latitude:n(r.latitude,null),longitude:n(r.longitude,null),serviceRadiusKm:n(r.service_radius_km,5),isOpen:bit(r.is_open,true),isActive:bit(r.is_active,true),takeawayEnabled:bit(r.takeaway_enabled,true),deliveryEnabled:bit(r.delivery_enabled,true),raw:r
  }));
  if(native.length) return native;
  return restaurantOutlets();
}
async function nearestOutlet(lat,lng){
  const outlets=(await outletRows()).filter(o=>o.isActive && o.latitude && o.longitude);
  if(!outlets.length) return null;
  let best=null;
  for(const o of outlets){ const km=distanceKm(n(lat),n(lng),n(o.latitude),n(o.longitude)); const item={...o,distanceKm:Math.round(km*100)/100,isServiceable:km<=n(o.serviceRadiusKm,5)}; if(!best||item.distanceKm<best.distanceKm) best=item; }
  return best;
}
async function productsForOutlet(outletId){
  const pc=await cols('products'); if(!pc.size) return [];
  const rc=await cols('restaurants'), cc=await cols('categories'), ops=await cols('outlet_product_stock');
  const name=pick(['name','title','product_name'],pc,'name'); const slug=pick(['slug'],pc); const price=pick(['price','base_price','selling_price','regular_price'],pc,'price');
  const img=pick(['image_url','image','thumbnail_url','primary_image_url'],pc); const rest=pick(['restaurant_id','store_id'],pc); const cat=pick(['category_id','food_category_id','menu_category_id'],pc);
  let join='', fields=[`p.*`,`p.${name} AS name`,`p.${price} AS price`];
  if(slug) fields.push(`p.${slug} AS slug`); if(img) fields.push(`p.${img} AS imageUrl`); if(cat) fields.push(`p.${cat} AS categoryId`);
  if(rest&&rc.size){ const rn=pick(['name','restaurant_name'],rc,'name'); join+=` LEFT JOIN restaurants r ON r.id=p.${rest}`; fields.push(`r.${rn} AS outletName`); }
  if(cat&&cc.size){ const cn=pick(['name','title'],cc,'name'); join+=` LEFT JOIN categories c ON c.id=p.${cat}`; fields.push(`c.${cn} AS categoryName`); }
  if(ops.size){ join+=` LEFT JOIN outlet_product_stock ops ON ops.product_id=p.id AND ops.outlet_id=?`; fields.push('ops.stock_quantity AS stockQuantity','ops.preparation_minutes AS preparationMinutes','ops.is_available AS outletAvailable'); }
  const where=[]; const params=[]; if(ops.size) params.push(outletId);
  if(rest){ where.push(`(p.${rest}=? OR p.${rest} IS NULL)`); params.push(outletId); }
  if(pc.has('deleted')) where.push('COALESCE(p.deleted,0)=0');
  if(pc.has('visibility_status')) where.push("UPPER(COALESCE(p.visibility_status,'VISIBLE')) <> 'HIDDEN'");
  if(pc.has('available')) where.push('COALESCE(p.available,1)=1');
  const rows=await q(`SELECT ${fields.join(', ')} FROM products p ${join} WHERE ${where.length?where.join(' AND '):'1=1'} ORDER BY p.id DESC LIMIT 500`,params);
  return rows.map(r=>({
    ...r, title:r.name, sellingPrice:n(r.price,0), outletId, restaurantId:outletId,
    imageUrl:r.imageUrl||r.image_url||r.image||r.thumbnail_url||r.primary_image_url,
    stockQuantity:n(r.stockQuantity ?? r.stock_quantity ?? r.stock, 999),
    available: bit(r.outletAvailable, true) && n(r.stockQuantity ?? r.stock_quantity ?? r.stock, 1) !== 0,
    preparationMinutes:n(r.preparationMinutes ?? r.preparation_minutes,15)
  }));
}
async function usersByRole(roleSql){
  const uc=await cols('users'); if(!uc.size) return [];
  const name=pick(['name','full_name'],uc,'name'), phone=pick(['mobile','phone','phone_number'],uc), email=pick(['email'],uc), active=pick(['enabled','is_active','active'],uc), blocked=pick(['blocked'],uc), del=pick(['deleted','is_deleted'],uc);
  const fields=[`u.*`,`u.${name} AS displayName`]; if(phone)fields.push(`u.${phone} AS mobile`); if(email)fields.push(`u.${email} AS email`);
  const where=[roleSql]; if(del)where.push(`COALESCE(u.${del},0)=0`); if(blocked)where.push(`COALESCE(u.${blocked},0)=0`);
  const rows=await q(`SELECT ${fields.join(', ')} FROM users u WHERE ${where.join(' AND ')} ORDER BY u.id DESC LIMIT 500`);
  return rows.map(r=>({...r,name:r.displayName||r.name,phone:r.mobile||r.phone,status: active?(bit(r[active],true)?'Active':'Inactive'):'Active'}));
}

router.get(['/single-brand/version','/outlet-system/version'],(req,res)=>ok(res,{version:'single-brand-outlet-v38',model:'Mr Breado single-brand multi-outlet',razorpay:'v22/v26 locked create-order kept unchanged'},'Single brand outlet system active'));
router.post(['/admin/outlets/ensure-schema','/outlets/ensure-schema'],ah(async(req,res)=>{ await ensureSingleBrandTables(); ok(res,{tables:['outlets','outlet_product_stock','outlet_delivery_boys','outlet_sales_daily','accounting_export_logs']},'Single brand tables are ready'); }));
router.get(['/outlets','/admin/outlets','/branches','/admin/branches'],ah(async(req,res)=>ok(res,page(await outletRows(),req),'Outlets loaded')));
router.post(['/admin/outlets','/admin/branches'],ah(async(req,res)=>{ await ensureSingleBrandTables(); const b=req.body||{}; const code=s(b.outletCode||b.outlet_code||slugify(b.name||'outlet')+'-'+Date.now()).toUpperCase(); const result=await x(`INSERT INTO outlets (outlet_code,name,address,city,state,pincode,latitude,longitude,service_radius_km,manager_name,manager_phone,manager_email,is_open,is_active,takeaway_enabled,delivery_enabled) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[code,s(b.name||b.outletName,'Mr Breado Outlet'),s(b.address,''),s(b.city,''),s(b.state,''),s(b.pincode,''),b.latitude||b.lat||null,b.longitude||b.lng||null,n(b.serviceRadiusKm||b.service_radius_km,5),s(b.managerName,''),s(b.managerPhone,''),s(b.managerEmail,''),bit(b.isOpen,true)?1:0,bit(b.isActive,true)?1:0,bit(b.takeawayEnabled,true)?1:0,bit(b.deliveryEnabled,true)?1:0]); ok(res,{id:result.insertId,outletCode:code},'Outlet created',201); }));
router.put(['/admin/outlets/:id','/admin/branches/:id'],ah(async(req,res)=>{ await ensureSingleBrandTables(); const b=req.body||{}; await x(`UPDATE outlets SET name=COALESCE(?,name), address=COALESCE(?,address), city=COALESCE(?,city), state=COALESCE(?,state), pincode=COALESCE(?,pincode), latitude=COALESCE(?,latitude), longitude=COALESCE(?,longitude), service_radius_km=COALESCE(?,service_radius_km), manager_name=COALESCE(?,manager_name), manager_phone=COALESCE(?,manager_phone), manager_email=COALESCE(?,manager_email), is_open=?, is_active=? WHERE id=?`,[b.name||b.outletName||null,b.address||null,b.city||null,b.state||null,b.pincode||null,b.latitude||b.lat||null,b.longitude||b.lng||null,b.serviceRadiusKm||b.service_radius_km||null,b.managerName||null,b.managerPhone||null,b.managerEmail||null,bit(b.isOpen??b.open,true)?1:0,bit(b.isActive??b.active,true)?1:0,req.params.id]); ok(res,{id:req.params.id},'Outlet updated'); }));
router.get(['/outlets/nearest','/branches/nearest'],ah(async(req,res)=>{ const lat=req.query.lat||req.query.latitude; const lng=req.query.lng||req.query.longitude; if(!lat||!lng) return fail(res,'lat and lng are required',400); const o=await nearestOutlet(lat,lng); if(!o) return fail(res,'No Mr Breado outlet configured near this location',404); ok(res,o,o.isServiceable?'Nearest outlet found':'Nearest outlet is outside service range'); }));
router.get(['/outlets/:id/menu','/branches/:id/menu','/menu/outlet/:id'],ah(async(req,res)=>ok(res,{outletId:req.params.id,items:await productsForOutlet(req.params.id),products:await productsForOutlet(req.params.id)},'Outlet menu loaded')));
router.get(['/menu/nearest','/products/nearest'],ah(async(req,res)=>{ const lat=req.query.lat||req.query.latitude; const lng=req.query.lng||req.query.longitude; if(!lat||!lng) return fail(res,'lat and lng are required',400); const outlet=await nearestOutlet(lat,lng); if(!outlet) return fail(res,'No serviceable Mr Breado outlet found',404); if(!outlet.isServiceable) return fail(res,'Sorry, Mr Breado is not delivering to your location yet.',400,{outlet}); const items=await productsForOutlet(outlet.id); ok(res,{outlet,items,products:items},'Nearest outlet menu loaded'); }));
router.post(['/admin/outlets/:id/stock','/admin/branches/:id/stock','/outlets/:id/stock'],ah(async(req,res)=>{ await ensureSingleBrandTables(); const items=Array.isArray(req.body?.items)?req.body.items:[req.body]; for(const it of items){ await x(`INSERT INTO outlet_product_stock (outlet_id,product_id,stock_quantity,low_stock_alert,is_available,preparation_minutes) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE stock_quantity=VALUES(stock_quantity), low_stock_alert=VALUES(low_stock_alert), is_available=VALUES(is_available), preparation_minutes=VALUES(preparation_minutes)`,[req.params.id,it.productId||it.product_id,n(it.stockQuantity||it.stock_quantity||it.stock,0),n(it.lowStockAlert||it.low_stock_alert,5),bit(it.isAvailable??it.available,true)?1:0,n(it.preparationMinutes||it.preparation_minutes,15)]); } ok(res,{outletId:req.params.id,count:items.length},'Outlet stock updated'); }));
router.get(['/admin/outlet-dashboard','/admin/head-office/dashboard','/admin/outlets/dashboard'],ah(async(req,res)=>{ const outlets=await outletRows(); const orders=await q(`SELECT restaurant_id outletId, COUNT(*) orders, COALESCE(SUM(COALESCE(grand_total,total,total_amount,0)),0) sales, SUM(CASE WHEN UPPER(COALESCE(status,''))='CANCELLED' THEN 1 ELSE 0 END) cancelled FROM orders GROUP BY restaurant_id`).catch(()=>[]); const by=new Map(orders.map(o=>[String(o.outletId),o])); const outletStats=outlets.map(o=>({ ...o, orderCount:n(by.get(String(o.id))?.orders,0), grossSales:n(by.get(String(o.id))?.sales,0), cancelledCount:n(by.get(String(o.id))?.cancelled,0)})); ok(res,{model:'SINGLE_BRAND_MULTI_OUTLET',brand:'Mr Breado',totalOutlets:outlets.length,totalOrders:outletStats.reduce((a,o)=>a+o.orderCount,0),totalRevenue:outletStats.reduce((a,o)=>a+o.grossSales,0),outlets:outletStats,topOutlet:outletStats.slice().sort((a,b)=>b.grossSales-a.grossSales)[0]||null},'Head office dashboard loaded'); }));
router.get(['/admin/delivery-boys','/admin/riders','/delivery-boys'],ah(async(req,res)=>{ await ensureSingleBrandTables(); const riders=await usersByRole("UPPER(u.role) IN ('RIDER','DRIVER','DELIVERY_PARTNER')"); const profileTable=await hasTable('delivery_partner_profiles'); let profiles=[]; if(profileTable) profiles=await q('SELECT * FROM delivery_partner_profiles'); const map=new Map(profiles.map(p=>[String(p.user_id),p])); const assigned=await q('SELECT * FROM outlet_delivery_boys WHERE is_active=1'); const byUser=new Map(assigned.map(a=>[String(a.user_id),a.outlet_id])); const outlets=await outletRows(); const outletMap=new Map(outlets.map(o=>[String(o.id),o])); const items=riders.map(r=>({ ...r, riderId:r.id, profile:map.get(String(r.id))||null, verificationStatus:(map.get(String(r.id))?.verification_status||map.get(String(r.id))?.verificationStatus||r.verification_status||'UNVERIFIED'), assignedOutletId:byUser.get(String(r.id))||null, assignedOutlet:outletMap.get(String(byUser.get(String(r.id))))||null })); ok(res,page(items,req),'Delivery boys loaded'); }));
router.post(['/admin/outlets/:outletId/delivery-boys/:userId','/admin/branches/:outletId/delivery-boys/:userId'],ah(async(req,res)=>{ await ensureSingleBrandTables(); await x(`INSERT INTO outlet_delivery_boys (outlet_id,user_id,is_active) VALUES (?,?,1) ON DUPLICATE KEY UPDATE outlet_id=VALUES(outlet_id), is_active=1`,[req.params.outletId,req.params.userId]); ok(res,{outletId:req.params.outletId,userId:req.params.userId},'Delivery boy assigned to outlet'); }));
router.get(['/admin/reports/sales','/admin/reports/outlet-sales'],ah(async(req,res)=>{ const from=req.query.from||'1970-01-01'; const to=req.query.to||'2999-12-31'; const rows=await q(`SELECT COALESCE(o.restaurant_id,0) outletId, DATE(o.created_at) reportDate, COUNT(*) orderCount, COALESCE(SUM(COALESCE(o.grand_total,o.total,o.total_amount,0)),0) grossSales, SUM(CASE WHEN UPPER(COALESCE(o.payment_type,o.payment_method,''))='ONLINE' THEN COALESCE(o.grand_total,o.total,o.total_amount,0) ELSE 0 END) onlineSales, SUM(CASE WHEN UPPER(COALESCE(o.payment_type,o.payment_method,''))='COD' THEN COALESCE(o.grand_total,o.total,o.total_amount,0) ELSE 0 END) codSales FROM orders o WHERE DATE(o.created_at) BETWEEN ? AND ? GROUP BY COALESCE(o.restaurant_id,0), DATE(o.created_at) ORDER BY reportDate DESC`,[from,to]); ok(res,page(rows,req),'Outlet sales report loaded'); }));

module.exports = router;
