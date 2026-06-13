const router = require('express').Router();
const { ok, fail } = require('../utils/respond');
const ah = require('../utils/asyncHandler');
const { optionalAuth } = require('../middleware/auth');
const { pool } = require('../utils/db');

router.use(optionalAuth);

const colCache = new Map();
async function cols(table){
  if(colCache.has(table)) return colCache.get(table);
  try{ const [r]=await pool.execute(`SHOW COLUMNS FROM \`${table}\``); const s=new Set(r.map(x=>x.Field)); colCache.set(table,s); return s; }catch(e){ const s=new Set(); colCache.set(table,s); return s; }
}
async function tableExists(table){ return (await cols(table)).size>0; }
function pick(cands,c,def=null){ for(const x of cands) if(c.has(x)) return x; return def; }
function n(v,d=0){ const x=Number(v); return Number.isFinite(x)?x:d; }
function str(v,d=''){ return v===undefined||v===null?d:String(v); }
function bool(v){ if(Buffer.isBuffer(v)) return v[0]===1; if(typeof v==='boolean') return v; if(typeof v==='number') return v===1; if(v&&Array.isArray(v.data)) return Number(v.data[0])===1; return String(v||'').toLowerCase()==='true'||String(v)==='1'; }
function slugify(s='item'){return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'')||'item';}
async function query(sql,params=[]){ try{ const [r]=await pool.execute(sql,params); return r; }catch(e){ console.error('[v22 query]',e.message,sql); return []; } }
async function exec(sql,params=[]){ try{ const [r]=await pool.execute(sql,params); return r; }catch(e){ console.error('[v22 exec]',e.message,sql); throw e; } }
async function one(sql,params=[]){ const r=await query(sql,params); return r[0]||null; }
async function settingNumber(key,def){
  try{
    const s=await one('SELECT setting_value FROM settings WHERE setting_key=? LIMIT 1',[key]);
    if(!s) return def; let v=s.setting_value; if(Buffer.isBuffer(v)) v=v.toString();
    if(typeof v==='string'){ try{v=JSON.parse(v)}catch{} }
    return n(v?.value ?? v, def);
  }catch{return def;}
}
function distanceKm(aLat,aLng,bLat,bLng){
  const R=6371, dLat=(bLat-aLat)*Math.PI/180, dLng=(bLng-aLng)*Math.PI/180;
  const aa=Math.sin(dLat/2)**2+Math.cos(aLat*Math.PI/180)*Math.cos(bLat*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(aa),Math.sqrt(1-aa));
}
async function mrBreadoRestaurant(){
  const c=await cols('restaurants'); if(!c.size) return null;
  const slug=pick(['slug'],c), name=pick(['name','restaurant_name'],c);
  const where=[]; const params=[];
  if(slug){where.push(`LOWER(${slug})='mr-breado'`)}
  if(name){where.push(`LOWER(${name}) LIKE '%mr breado%'`)}
  return await one(`SELECT * FROM restaurants WHERE ${where.length?where.join(' OR '):'1=1'} ORDER BY id LIMIT 1`,params);
}
async function restaurantForUser(req){
  if(String(req.user?.role||'').toUpperCase()==='ADMIN') return await mrBreadoRestaurant();
  const uid=req.user?.id||0; const c=await cols('restaurants'); const owner=pick(['owner_id','seller_id','user_id'],c);
  if(owner&&uid) return await one(`SELECT * FROM restaurants WHERE ${owner}=? ORDER BY id LIMIT 1`,[uid]);
  return await mrBreadoRestaurant();
}
function pageResult(items, req){ const page=Math.max(1,n(req.query.page,1)); const perPage=Math.max(1,n(req.query.limit||req.query.perPage||req.query.per_page,items.length||20)); return {items,content:items,data:items,orders:items,total:items.length,totalElements:items.length,total_items:items.length,page,currentPage:page,perPage,per_page:perPage,totalPages:1,total_pages:1,last:true}; }
async function normalizeProduct(p){
  if(!p) return null;
  const price=n(p.price ?? p.base_price ?? p.regular_price ?? p.selling_price,0);
  return {...p,id:p.id, name:p.name||p.title||p.product_name, title:p.name||p.title||p.product_name, slug:p.slug||String(p.id), price, sellingPrice:price, imageUrl:p.image_url||p.image||p.thumbnail_url||p.primary_image_url, restaurantId:p.restaurant_id, restaurantName:p.restaurant_name, categoryId:p.category_id, categoryName:p.category_name, available:!('available' in p)||bool(p.available), visible:!(p.visibility_status&&String(p.visibility_status).toUpperCase()==='HIDDEN')};
}
async function productRows(where='1=1',params=[]){
  const pc=await cols('products'), rc=await cols('restaurants'), cc=await cols('categories');
  if(!pc.size) return [];
  const pName=pick(['name','title','product_name'],pc,'name'); const pSlug=pick(['slug'],pc,'slug'); const pPrice=pick(['price','base_price','selling_price','regular_price'],pc,'price');
  const pImg=pick(['image_url','image','thumbnail_url','primary_image_url'],pc); const pRest=pick(['restaurant_id','store_id'],pc); const pCat=pick(['category_id','food_category_id','menu_category_id'],pc);
  const rName=pick(['name','restaurant_name'],rc,'name'); const cName=pick(['name','title'],cc,'name');
  const fields=[`p.*`, `p.${pName} AS name`, pSlug?`p.${pSlug} AS slug`:`p.id AS slug`, `p.${pPrice} AS price`];
  if(pImg) fields.push(`p.${pImg} AS image_url`); if(pRest) fields.push(`p.${pRest} AS restaurant_id`); if(pCat) fields.push(`p.${pCat} AS category_id`);
  if(pRest&&rc.size) fields.push(`r.${rName} AS restaurant_name`); if(pCat&&cc.size) fields.push(`c.${cName} AS category_name`);
  let join=''; if(pRest&&rc.size) join+=` LEFT JOIN restaurants r ON r.id=p.${pRest}`; if(pCat&&cc.size) join+=` LEFT JOIN categories c ON c.id=p.${pCat}`;
  const del=pc.has('deleted')?' AND COALESCE(p.deleted,0)=0':'';
  const rows=await query(`SELECT ${fields.join(', ')} FROM products p ${join} WHERE ${where}${del} ORDER BY p.id DESC LIMIT 500`,params);
  return Promise.all(rows.map(normalizeProduct));
}
async function attachCustomizations(product){
  if(!product) return product;
  const gc=await cols('product_customization_groups'), oc=await cols('product_customization_options');
  if(!gc.size||!oc.size){ product.customizationGroups=[]; product.customization_groups=[]; product.customizations=[]; return product; }
  const gName=pick(['title','name','group_name'],gc,'title'); const gType=pick(['type','selection_type'],gc,'type');
  const oName=pick(['title','name','option_name'],oc,'title'); const oPrice=pick(['price','additional_price','extra_price'],oc,'price');
  const groups=await query(`SELECT * , ${gName} AS title, ${gType} AS type FROM product_customization_groups WHERE product_id=? ORDER BY COALESCE(priority,0), id`,[product.id]);
  for(const g of groups){
    g.options=await query(`SELECT * , ${oName} AS title, ${oPrice} AS price FROM product_customization_options WHERE group_id=? ORDER BY COALESCE(priority,sort_order,0), id`,[g.id]);
    g.name=g.title; g.selectionType=g.type; g.minSelect=g.min_select||g.minSelect||0; g.maxSelect=g.max_select||g.maxSelect||1;
  }
  product.customizationGroups=groups; product.customization_groups=groups; product.customizations=groups; return product;
}
async function orderRows(req, onlyRestaurant=false){
  const oc=await cols('orders'), rc=await cols('restaurants'), uc=await cols('users'); if(!oc.size) return [];
  const restCol=pick(['restaurant_id','store_id'],oc); const userCol=pick(['user_id','customer_id'],oc);
  const totalCol=pick(['grand_total','total','total_amount','payable_amount'],oc,'total'); const orderNo=pick(['order_number','slug','invoice_number'],oc,'id');
  const statusCol=pick(['status','order_status'],oc,'status'); const payType=pick(['payment_type','payment_method'],oc,'payment_type'); const payStatus=pick(['payment_status'],oc,'payment_status');
  const created=pick(['created_at','createdAt','order_date'],oc,'id');
  const where=[]; const params=[];
  const st=req.query.status||req.query.orderStatus; if(st&&String(st).toUpperCase()!=='ALL'){where.push(`UPPER(o.${statusCol})=?`); params.push(String(st).toUpperCase());}
  if(onlyRestaurant&&restCol){ const rest=await restaurantForUser(req); if(rest?.id){where.push(`o.${restCol}=?`);params.push(rest.id);} }
  const fields=[`o.*`, `o.${totalCol} AS total`, `o.${totalCol} AS grandTotal`, `o.${orderNo} AS orderNumber`, `o.${statusCol} AS status`, `o.${payType} AS paymentType`, `o.${payStatus} AS paymentStatus`, `o.${created} AS createdAt`];
  let join=''; if(restCol&&rc.size){ const rn=pick(['name','restaurant_name'],rc,'name'); join+=` LEFT JOIN restaurants r ON r.id=o.${restCol}`; fields.push(`r.${rn} AS restaurantName`); }
  if(userCol&&uc.size){ const un=pick(['name','full_name'],uc,'name'), um=pick(['mobile','phone'],uc), ue=pick(['email'],uc); join+=` LEFT JOIN users u ON u.id=o.${userCol}`; fields.push(`u.${un} AS customerName`); if(um)fields.push(`u.${um} AS customerMobile`); if(ue)fields.push(`u.${ue} AS customerEmail`); }
  const rows=await query(`SELECT ${fields.join(', ')} FROM orders o ${join} WHERE ${where.length?where.join(' AND '):'1=1'} ORDER BY o.id DESC LIMIT 500`,params);
  await attachOrderItems(rows);
  return rows;
}
async function attachOrderItems(rows){
  const ic=await cols('order_items'); if(!ic.size) return rows;
  const oid=pick(['order_id'],ic,'order_id'), title=pick(['title','name','product_name'],ic,'name'), unit=pick(['unit_price','price'],ic,'unit_price'), total=pick(['total_price','total'],ic,'total');
  for(const o of rows){ const items=await query(`SELECT *, ${title} AS productName, ${unit} AS unitPrice, ${total} AS totalPrice FROM order_items WHERE ${oid}=? ORDER BY id`,[o.id]); o.items=items; o.orderItems=items; }
  return rows;
}
async function upsertProduct(req,res,id=null){
  const pc=await cols('products'); if(!pc.size) return fail(res,'products table not found',500);
  const b=req.body||{}; const rest=await restaurantForUser(req); const name=str(b.name||b.title||b.productName,'Food item'); const slugBase=slugify(b.slug||name); const price=n(b.price||b.basePrice||b.smallPrice||b.base500gmPrice||b.base_price,0);
  const data={};
  function set(cands,val){ const c=pick(cands,pc); if(c&&val!==undefined) data[c]=val; }
  set(['name','title','product_name'],name); set(['slug'], id?undefined:`${slugBase}-${Date.now()}`); set(['description'],b.description||b.details||''); set(['restaurant_id','store_id'],b.restaurantId||b.restaurant_id||rest?.id||1); set(['category_id','food_category_id','menu_category_id'],b.categoryId||b.category_id||b.foodCategoryId||b.menuCategoryId||1); set(['brand_id'],b.brandId||b.brand_id||null); set(['price','base_price','selling_price','regular_price'],price); set(['discount_price','offer_price'],b.discountPrice||b.discount_price||null); set(['image_url','image','thumbnail_url','primary_image_url'],b.imageUrl||b.image_url||b.image||'');
  for(const [key,val] of [['available',1],['deleted',0],['veg',b.veg??1],['featured',b.featured??0],['bestseller',b.bestseller??0],['tax_included',b.taxIncluded??0],['stock_quantity',b.stockQuantity??b.stock??100],['stock',b.stock??100],['preparation_time',b.preparationTime??30],['rating',0],['total_reviews',0],['currency','INR'],['visibility_status',b.visibilityStatus||'VISIBLE']]) if(pc.has(key)&&val!==undefined) data[key]=val;
  if(id){ const sets=Object.keys(data).map(k=>`\`${k}\`=?`).join(', '); await exec(`UPDATE products SET ${sets}${pc.has('updated_at')?', updated_at=NOW()':''} WHERE id=?`,[...Object.values(data),id]); } else { const ks=Object.keys(data); await exec(`INSERT INTO products (${ks.map(k=>`\`${k}\``).join(',')}) VALUES (${ks.map(()=>'?').join(',')})`,Object.values(data)); id=(await one('SELECT LAST_INSERT_ID() id')).id; }
  await savePricingOptions(id,b,name);
  const p=(await productRows('p.id=?',[id]))[0]; ok(res, await attachCustomizations(p), id?'Product updated':'Product created', id?200:201);
}
async function savePricingOptions(productId,b,name){
  const gc=await cols('product_customization_groups'), oc=await cols('product_customization_options'); if(!gc.size||!oc.size) return;
  await exec('DELETE FROM product_customization_options WHERE group_id IN (SELECT id FROM product_customization_groups WHERE product_id=?)',[productId]); await exec('DELETE FROM product_customization_groups WHERE product_id=?',[productId]);
  const isPizza=String(b.categoryName||b.category||name).toLowerCase().includes('pizza')||b.smallPrice||b.mediumPrice||b.largePrice;
  const isCake=String(b.categoryName||b.category||name).toLowerCase().includes('cake')||b.base500gmPrice||b.extraHalfKgPrice;
  const groups=[];
  if(isPizza){ groups.push({title:'Choose Size',type:'SINGLE',required:1,min:1,max:1,options:[['Small',b.smallPrice||b.price],['Medium',b.mediumPrice||b.price],['Large',b.largePrice||b.price]].filter(x=>x[1]!=null)}); }
  if(isCake){ const base=n(b.base500gmPrice||b.price,0), extra=n(b.extraHalfKgPrice||b.extra500gmPrice||0,0); groups.push({title:'Choose Weight',type:'SINGLE',required:1,min:1,max:1,options:[[ '0.5 kg',base ],[ '1 kg',base+extra ],[ '1.5 kg',base+extra*2 ],[ '2 kg',base+extra*3 ]]}); }
  if(Array.isArray(b.customizationGroups)) for(const g of b.customizationGroups) groups.push({title:g.title||g.name,type:g.type||g.selectionType||'SINGLE',required:g.required?1:0,min:g.minSelect||0,max:g.maxSelect||1,options:(g.options||[]).map(o=>[o.title||o.name,n(o.price,0)])});
  const gTitle=pick(['title','name','group_name'],gc,'title'), gType=pick(['type','selection_type'],gc,'type');
  const oTitle=pick(['title','name','option_name'],oc,'title'), oPrice=pick(['price','additional_price','extra_price'],oc,'price');
  for(const g of groups){
    const gd={product_id:productId}; gd[gTitle]=g.title; gd[gType]=g.type; if(gc.has('required'))gd.required=g.required; if(gc.has('min_select'))gd.min_select=g.min; if(gc.has('max_select'))gd.max_select=g.max; if(gc.has('priority'))gd.priority=0;
    const ks=Object.keys(gd); await exec(`INSERT INTO product_customization_groups (${ks.map(k=>`\`${k}\``).join(',')}) VALUES (${ks.map(()=>'?').join(',')})`,Object.values(gd)); const gid=(await one('SELECT LAST_INSERT_ID() id')).id;
    let idx=0; for(const [title,price] of g.options){ const od={group_id:gid}; od[oTitle]=title; od[oPrice]=n(price,0); if(oc.has('enabled'))od.enabled=1; if(oc.has('available'))od.available=1; if(oc.has('active'))od.active=1; if(oc.has('sort_order'))od.sort_order=idx; if(oc.has('priority'))od.priority=idx; const oks=Object.keys(od); await exec(`INSERT INTO product_customization_options (${oks.map(k=>`\`${k}\``).join(',')}) VALUES (${oks.map(()=>'?').join(',')})`,Object.values(od)); idx++; }
  }
}

router.get(['/version-v22','/feature-version-v22'],(req,res)=>ok(res,{version:'spring-real-flow-v22',razorpay:'unchanged'},'V22 active'));
router.get(['/admin/dashboard','/dashboard','/admin/summary'],ah(async(req,res)=>{
  const users=await one('SELECT COUNT(*) c FROM users').catch(()=>({c:0}))||{c:0}; const drivers=await one("SELECT COUNT(*) c FROM users WHERE UPPER(role) IN ('RIDER','DELIVERY_PARTNER','DRIVER')").catch(()=>({c:0}))||{c:0}; const rests=await one('SELECT COUNT(*) c FROM restaurants').catch(()=>({c:0}))||{c:0}; const prods=await one('SELECT COUNT(*) c FROM products').catch(()=>({c:0}))||{c:0}; const orders=await one('SELECT COUNT(*) c, COALESCE(SUM(COALESCE(grand_total,total,total_amount,0)),0) revenue FROM orders').catch(()=>({c:0,revenue:0}))||{c:0,revenue:0};
  ok(res,{users:users.c,totalUsers:users.c,customers:users.c,deliveryBoys:drivers.c,drivers:drivers.c,restaurants:rests.c,products:prods.c,totalOrders:orders.c,orders:orders.c,totalRevenue:orders.revenue,revenue:orders.revenue,adminCommission:0,restaurantPayable:orders.revenue},'Dashboard loaded');
}));
router.get(['/admin/restaurants','/restaurants/admin'],ah(async(req,res)=>ok(res,pageResult(await query('SELECT * FROM restaurants ORDER BY id DESC LIMIT 500'),req),'Restaurants loaded')));
router.get(['/admin/drivers','/admin/delivery-boys','/delivery-boys','/admin/riders'],ah(async(req,res)=>ok(res,pageResult(await query("SELECT u.*, p.* FROM users u LEFT JOIN delivery_partner_profiles p ON p.user_id=u.id WHERE UPPER(u.role) IN ('RIDER','DELIVERY_PARTNER','DRIVER') ORDER BY u.id DESC LIMIT 500"),req),'Drivers loaded')));
router.get(['/admin/users','/admin/customers','/customers'],ah(async(req,res)=>ok(res,pageResult(await query("SELECT * FROM users WHERE UPPER(role) IN ('USER','CUSTOMER') ORDER BY id DESC LIMIT 500"),req),'Users loaded')));
router.get(['/admin/products','/admin/foods','/foods','/admin/mr-breado/products','/admin/mr-breado/foods','/seller/products','/seller/foods'],ah(async(req,res)=>ok(res,pageResult(await productRows('1=1',[]),req),'Products loaded')));
router.post(['/admin/products','/admin/foods','/admin/mr-breado/products','/seller/products','/seller/foods'],ah(upsertProduct));
router.put(['/admin/products/:id','/admin/foods/:id','/admin/mr-breado/products/:id','/seller/products/:id','/seller/foods/:id'],ah((req,res)=>upsertProduct(req,res,req.params.id)));
router.get(['/products/:id','/foods/:id'],ah(async(req,res)=>{ const rows=await productRows('p.id=? OR p.slug=?',[req.params.id,req.params.id]); const p=await attachCustomizations(rows[0]); if(!p)return fail(res,'Product not found',404); ok(res,p,'Product loaded',{product:p,data:p}); }));
router.get(['/admin/orders','/admin/mr-breado/orders','/admin/mr-breado/live-orders','/admin/orders/live','/seller/orders','/seller/live-orders'],ah(async(req,res)=>ok(res,pageResult(await orderRows(req,req.path.includes('/seller')||req.path.includes('mr-breado')),req),'Orders loaded')));
router.get(['/seller/orders/:id','/admin/orders/:id','/admin/mr-breado/orders/:id'],ah(async(req,res)=>{ const rows=await orderRows({...req,query:{...req.query,limit:500}},false); const o=rows.find(x=>String(x.id)===String(req.params.id)||String(x.orderNumber)===String(req.params.id)||String(x.slug)===String(req.params.id)); if(!o)return fail(res,'Order not found',404); ok(res,o,'Order loaded',{order:o}); }));
router.post(['/seller/orders/:id/accept','/admin/orders/:id/accept','/admin/mr-breado/orders/:id/accept'],ah(async(req,res)=>{await exec('UPDATE orders SET status=? WHERE id=?',['ACCEPTED',req.params.id]); ok(res,{id:req.params.id,status:'ACCEPTED'},'Order accepted')}));
router.post(['/seller/orders/:id/reject','/admin/orders/:id/reject','/admin/mr-breado/orders/:id/reject'],ah(async(req,res)=>{await exec('UPDATE orders SET status=?, cancel_reason=? WHERE id=?',['CANCELLED',req.body?.reason||'',req.params.id]); ok(res,{id:req.params.id,status:'CANCELLED'},'Order rejected')}));
router.post(['/seller/orders/:id/preparing','/admin/orders/:id/preparing','/admin/mr-breado/orders/:id/preparing'],ah(async(req,res)=>{await exec('UPDATE orders SET status=? WHERE id=?',['PREPARING',req.params.id]); ok(res,{id:req.params.id,status:'PREPARING'},'Order preparing')}));
router.post(['/seller/orders/:id/ready','/admin/orders/:id/ready','/admin/mr-breado/orders/:id/ready'],ah(async(req,res)=>{await exec('UPDATE orders SET status=? WHERE id=?',['READY_FOR_PICKUP',req.params.id]); ok(res,{id:req.params.id,status:'READY_FOR_PICKUP'},'Order ready')}));
router.get(['/seller/dashboard','/admin/mr-breado/dashboard'],ah(async(req,res)=>{ const rows=await orderRows(req,true); const prods=await productRows('1=1',[]); ok(res,{products:prods.length,total_products:prods.length,live_foods:prods.filter(p=>p.available).length,orders:rows.length,total_orders:rows.length,pending_orders:rows.filter(o=>['PLACED','PENDING','ACCEPTED'].includes(String(o.status).toUpperCase())).length,revenue:rows.reduce((a,o)=>a+n(o.total||o.grandTotal),0),payable:rows.reduce((a,o)=>a+n(o.total||o.grandTotal),0)},'Seller dashboard loaded'); }));
router.get(['/orders/:id/tracking','/user/orders/:id/tracking','/tracking/orders/:id'],ah(async(req,res)=>{ const o=(await orderRows({...req,query:{limit:500}},false)).find(x=>String(x.id)===String(req.params.id)||String(x.orderNumber)===String(req.params.id)); const locs=await query('SELECT * FROM delivery_locations WHERE order_id=? ORDER BY id DESC LIMIT 50',[o?.id||req.params.id]); ok(res,{order:o,latestLocation:locs[0]||null,locations:locs,driver:o?.driver_id?{id:o.driver_id}:null,status:o?.status},'Tracking loaded'); }));
router.get(['/delivery/validate','/distance/validate','/restaurants/:id/delivery-check'],ah(async(req,res)=>{ const lat=n(req.query.lat||req.query.latitude||req.query.userLat), lng=n(req.query.lng||req.query.longitude||req.query.userLng); const rest=req.params.id?await one('SELECT * FROM restaurants WHERE id=?',[req.params.id]):await mrBreadoRestaurant(); const rlat=n(rest?.latitude), rlng=n(rest?.longitude); const km=(lat&&lng&&rlat&&rlng)?distanceKm(lat,lng,rlat,rlng):0; const max=n(rest?.delivery_radius_km||await settingNumber('delivery_radius_km',8),8); ok(res,{available:!km||km<=max,distanceKm:Math.round(km*100)/100,maxDistanceKm:max,restaurant:rest},'Distance checked'); }));
router.get(['/admin/online-transactions','/admin/payments/online','/admin/payment-transactions'],ah(async(req,res)=>{ const c=await cols('payment_transactions'); if(!c.size) return ok(res,pageResult([],req),'Transactions loaded'); const rows=await query(`SELECT pt.*, o.order_number AS orderNumber, o.restaurant_id AS restaurantId, o.user_id AS customerId, r.owner_id AS sellerId, r.name AS restaurantName, u.name AS customerName FROM payment_transactions pt LEFT JOIN orders o ON o.id=pt.order_id LEFT JOIN restaurants r ON r.id=o.restaurant_id LEFT JOIN users u ON u.id=pt.user_id ORDER BY pt.id DESC LIMIT 500`); ok(res,pageResult(rows,req),'Transactions loaded'); }));

module.exports=router;
