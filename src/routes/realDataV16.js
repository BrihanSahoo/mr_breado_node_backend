const router = require('express').Router();
const multer = require('multer');
const { ok, fail } = require('../utils/respond');
const ah = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { many, one, exec, slugify } = require('../utils/db');

const MAX_FILE_SIZE = Number(process.env.VERIFICATION_FILE_MAX_BYTES || 8 * 1024 * 1024);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 12 },
  fileFilter: (req, file, cb) => {
    const okTypes = new Set(['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']);
    if (!okTypes.has(file.mimetype)) return cb(new Error('Only JPG, PNG, WEBP, HEIC, HEIF and PDF files are allowed.'));
    cb(null, true);
  },
});

function bool(v, fallback = false) {
  if (v === undefined || v === null) return fallback;
  if (Buffer.isBuffer(v)) return v[0] === 1;
  if (typeof v === 'object' && Array.isArray(v.data)) return Number(v.data[0]) === 1;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  return ['1','true','yes','on','active','enabled','visible','approved','verified'].includes(String(v).toLowerCase());
}
function text(v, fallback = '') { return String(v ?? fallback).trim(); }
function n(v, fallback = 0) { const x = Number(v); return Number.isFinite(x) ? x : fallback; }
function tryJson(v) { if (!v) return {}; if (typeof v === 'object') return v; try { return JSON.parse(String(v)); } catch { return {}; } }
function json(v) { try { return JSON.stringify(v || {}); } catch { return '{}'; } }
function first(...values) { for (const v of values) if (v !== undefined && v !== null && String(v).trim() !== '') return v; return undefined; }
function absolute(req, path) { return `${req.protocol}://${req.get('host')}${path}`; }
async function safeMany(sql, params={}) { try { return await many(sql, params); } catch(e) { console.error('[v16 query]', e.message); return []; } }
async function safeOne(sql, params={}) { try { return await one(sql, params); } catch(e) { console.error('[v16 one]', e.message); return null; } }
async function safeExec(sql, params={}) { try { return await exec(sql, params); } catch(e) { console.error('[v16 exec]', e.message); return { insertId:null, affectedRows:0 }; } }
async function ensure() {
  await exec(`CREATE TABLE IF NOT EXISTS app_verification_requests (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NULL,
    requester_type VARCHAR(30) NOT NULL,
    restaurant_id BIGINT NULL,
    rider_id BIGINT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    business_name VARCHAR(180) NULL,
    owner_name VARCHAR(180) NULL,
    phone VARCHAR(40) NULL,
    email VARCHAR(180) NULL,
    notes TEXT NULL,
    rejection_reason TEXT NULL,
    admin_id BIGINT NULL,
    submitted_payload LONGTEXT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    INDEX idx_avr_user_type (user_id, requester_type),
    INDEX idx_avr_status (status)
  )`);
  await exec(`CREATE TABLE IF NOT EXISTS app_verification_documents (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    request_id BIGINT NOT NULL,
    document_type VARCHAR(120) NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(120) NOT NULL,
    file_size BIGINT NOT NULL,
    file_blob LONGBLOB NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    INDEX idx_avd_request (request_id)
  )`);
  await exec(`CREATE TABLE IF NOT EXISTS bite_stories (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(180) NOT NULL,
    subtitle VARCHAR(255) NULL,
    description TEXT NULL,
    media_url TEXT NULL,
    thumbnail_url TEXT NULL,
    action_type VARCHAR(60) NULL,
    action_value VARCHAR(255) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    active BIT(1) NOT NULL DEFAULT b'1',
    starts_at DATETIME(6) NULL,
    ends_at DATETIME(6) NULL,
    created_by BIGINT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
  )`);
}

function mapPage(items, page=1, perPage=20, total=null) {
  const count = total ?? items.length;
  const pages = Math.max(1, Math.ceil(count / Math.max(1, perPage)));
  return { items, content: items, records: items, page, currentPage: page, perPage, per_page: perPage, total: count, totalItems: count, total_pages: pages, totalPages: pages, last: page >= pages };
}
function mapProduct(p={}) {
  const name = first(p.name, p.title, 'Food item');
  return {
    ...p,
    id: p.id,
    name,
    title: first(p.title, name),
    imageUrl: first(p.imageUrl, p.image_url, p.image, p.thumbnail, ''),
    restaurantName: first(p.restaurantName, p.restaurant_name, p.restaurant, ''),
    restaurantId: p.restaurant_id ?? p.restaurantId,
    price: n(first(p.price, p.base_price, p.mrp), 0),
    discountPrice: p.discount_price ?? p.discountPrice,
    available: bool(first(p.available, p.is_available, p.enabled, p.active), true),
    inStock: bool(first(p.stock, p.stock_quantity, p.in_stock), true),
  };
}
function mapDriver(u={}) {
  const status = String(first(u.verification_status, u.verificationStatus, u.profile_verification_status, u.status, 'PENDING')).toUpperCase();
  return {
    ...u,
    id: u.id,
    userId: u.user_id ?? u.userId ?? u.id,
    driverId: u.profile_id ?? u.profileId ?? u.id,
    name: first(u.name, u.full_name, u.fullName, u.driverName, 'Delivery Partner'),
    mobile: first(u.mobile, u.phone, u.phone_number, u.phoneNumber, ''),
    phone: first(u.phone, u.mobile, u.phone_number, ''),
    email: first(u.email, ''),
    status: bool(u.blocked, false) ? 'BLOCKED' : (bool(u.enabled, true) ? 'ACTIVE' : 'INACTIVE'),
    verificationStatus: status,
    deliveries: n(first(u.deliveries, u.total_deliveries, u.delivery_count), 0),
    earnings: n(first(u.earnings, u.total_earnings), 0),
    cashInHand: n(first(u.cash_in_hand, u.cashInHand, u.pending_cash), 0),
  };
}
function mapCategory(c={}) {
  const name = first(c.name, c.title, 'Category');
  return { ...c, id:c.id, name, title:first(c.title,name), slug:first(c.slug, slugify(name)), imageUrl:first(c.imageUrl,c.image_url,c.image,c.icon,''), active: bool(first(c.active,c.enabled), true) && !bool(c.deleted,false), enabled: bool(c.enabled,true), showOnHome: bool(c.show_on_home,true), sortOrder:n(c.sort_order,0) };
}
function mapStory(s={}) {
  return { ...s, id:s.id, mediaUrl:first(s.mediaUrl,s.media_url,''), thumbnailUrl:first(s.thumbnailUrl,s.thumbnail_url,s.media_url,''), actionType:first(s.actionType,s.action_type,''), actionValue:first(s.actionValue,s.action_value,''), active:bool(s.active,true), sortOrder:n(s.sort_order,0) };
}
async function docsFor(row, req) {
  const docs = await safeMany(`SELECT id, request_id requestId, document_type documentType, original_name originalName, mime_type mimeType, file_size fileSize, created_at createdAt FROM app_verification_documents WHERE request_id=:id ORDER BY id`, { id: row.id });
  return docs.map(d => {
    const view = `/api/admin/verifications/${row.id}/documents/${d.id}/view`;
    const down = `/api/admin/verifications/${row.id}/documents/${d.id}/download`;
    return { ...d, name:first(d.originalName,d.documentType,`Document ${d.id}`), type:first(d.documentType,d.mimeType,'DOCUMENT'), url:absolute(req,view), fileUrl:absolute(req,view), viewUrl:absolute(req,view), downloadUrl:absolute(req,down) };
  });
}
async function mapVerification(row={}, req) {
  const payload = tryJson(row.submitted_payload ?? row.submittedPayload ?? row.payload);
  const type = String(first(row.requester_type, row.requesterType, row.request_type, row.entityType, 'RIDER')).toUpperCase();
  const docs = await docsFor(row, req);
  const applicant = first(row.owner_name, row.ownerName, row.userName, row.user_name, row.name, payload.fullName, payload.name, payload.driverName, payload.riderName, payload.ownerName, payload.applicantName, 'Verification request');
  const business = first(row.business_name, row.businessName, row.restaurantName, row.restaurant_name, payload.businessName, payload.restaurantName, payload.storeName, type === 'RESTAURANT' ? applicant : '');
  const mobile = first(row.phone, row.mobile, row.userMobile, row.user_mobile, row.phone_number, payload.mobile, payload.phone, payload.phoneNumber, payload.contactMobile, '');
  const address = first(row.notes, row.address, payload.address, payload.fullAddress, payload.residentialAddress, payload.staffAddress, payload.restaurantAddress, payload.businessAddress, payload.ownerAddress, '');
  return {
    ...row,
    id: row.id,
    requestId: row.id,
    requesterType: type,
    entityType: type,
    requestType: type,
    source: type,
    status: String(first(row.status, row.verification_status, 'PENDING')).toUpperCase(),
    restaurantId: row.restaurant_id ?? row.restaurantId,
    riderId: row.rider_id ?? row.riderId ?? row.user_id,
    userId: row.user_id ?? row.userId,
    applicantName: applicant,
    fullName: applicant,
    ownerName: first(row.owner_name, payload.ownerName, applicant),
    businessName: business,
    restaurantName: first(row.restaurantName, row.restaurant_name, business),
    riderName: type === 'RIDER' ? applicant : undefined,
    driverName: type === 'RIDER' ? applicant : undefined,
    contactMobile: mobile,
    mobile,
    phone: mobile,
    email: first(row.email, row.userEmail, row.user_email, payload.email, ''),
    address,
    note: first(row.notes, payload.notes, payload.note, ''),
    gstin: first(payload.gstin, payload.gstNumber, payload.gst, row.gstin, ''),
    panNumber: first(payload.panNumber, payload.pan, payload.panCardNo, row.panNumber, ''),
    fssaiNumber: first(payload.fssaiNumber, payload.fssaiLicense, payload.fssai, row.fssaiNumber, ''),
    aadhaarNumber: first(payload.aadhaarNumber, payload.aadharNumber, payload.aadhaarNo, payload.aadharNo, row.aadhaarNumber, ''),
    drivingLicenseNumber: first(payload.drivingLicenseNumber, payload.drivingLicense, payload.licenseNumber, payload.dlNumber, row.drivingLicenseNumber, ''),
    vehicleRegistrationNumber: first(payload.vehicleRegistrationNumber, payload.vehicleRcNumber, payload.vehicleRc, payload.vehicleNumber, payload.rcNumber, row.vehicleRegistrationNumber, ''),
    documents: docs,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
    submittedPayload: payload,
  };
}
async function verificationRows(req) {
  await ensure();
  const appRows = await safeMany(`SELECT vr.*, u.name userName, u.email userEmail, u.mobile userMobile, u.phone_number userPhone, r.name restaurantName, r.slug restaurantSlug
    FROM app_verification_requests vr
    LEFT JOIN users u ON u.id=vr.user_id
    LEFT JOIN restaurants r ON r.id=vr.restaurant_id
    ORDER BY vr.updated_at DESC, vr.id DESC LIMIT 500`);
  const legacy = await safeMany(`SELECT *, target_type requester_type, target_id restaurant_id, created_at, updated_at FROM verification_requests ORDER BY id DESC LIMIT 500`);
  const mapped = [];
  for (const row of [...appRows, ...legacy]) mapped.push(await mapVerification(row, req));
  const unique = new Map();
  for (const item of mapped) {
    const key = `${item.userId ?? ''}:${item.requesterType}:${item.restaurantId ?? ''}:${item.riderId ?? ''}:${item.contactMobile ?? ''}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return Array.from(unique.values());
}

router.get('/admin/dashboard', requireAuth, ah(async(req,res)=>{
  const users = (await safeOne('SELECT COUNT(*) c FROM users WHERE COALESCE(deleted,0)=0'))?.c || 0;
  const customers = (await safeOne(`SELECT COUNT(*) c FROM users WHERE UPPER(role) IN ('CUSTOMER','USER') AND COALESCE(deleted,0)=0`))?.c || 0;
  const drivers = (await safeOne(`SELECT COUNT(*) c FROM users WHERE UPPER(role) IN ('DELIVERY_PARTNER','RIDER','DRIVER','DELIVERY') AND COALESCE(deleted,0)=0`))?.c || 0;
  const restaurants = (await safeOne('SELECT COUNT(*) c FROM restaurants WHERE COALESCE(deleted,0)=0'))?.c || 0;
  const products = (await safeOne('SELECT COUNT(*) c FROM products WHERE COALESCE(deleted,0)=0'))?.c || 0;
  const orders = await safeOne('SELECT COUNT(*) c, COALESCE(SUM(grand_total),0) revenue FROM orders') || {c:0,revenue:0};
  const online = await safeOne(`SELECT COALESCE(SUM(amount),0) total, COUNT(*) c FROM payment_transactions WHERE UPPER(status) IN ('SUCCESS','CAPTURED','PAID','VERIFIED')`) || {total:0,c:0};
  ok(res,{users,totalUsers:users,customers,totalCustomers:customers,drivers,deliveryBoys:drivers,restaurants,totalRestaurants:restaurants,products,totalProducts:products,orders:orders.c,totalOrders:orders.c,revenue:orders.revenue,totalRevenue:orders.revenue,onlineRevenue:online.total,onlineTransactions:online.c,adminCommission:0,restaurantPayable:0});
}));
router.get('/admin/drivers', requireAuth, ah(async(req,res)=>{
  const rows = await safeMany(`SELECT u.id, u.name, u.email, u.mobile, u.phone_number, u.role, u.enabled, u.blocked, u.deleted, u.created_at, dp.id profile_id, dp.verification_status, dp.vehicle_number, dp.driving_license_number, dp.cash_in_hand, dp.total_deliveries, dp.total_earnings
    FROM users u LEFT JOIN delivery_partner_profiles dp ON dp.user_id=u.id
    WHERE UPPER(u.role) IN ('DELIVERY_PARTNER','RIDER','DRIVER','DELIVERY') AND COALESCE(u.deleted,0)=0
    ORDER BY u.id DESC LIMIT 500`);
  ok(res, mapPage(rows.map(mapDriver), n(req.query.page,1), n(req.query.perPage||req.query.per_page||req.query.limit,20)));
}));
router.get('/admin/products', requireAuth, ah(async(req,res)=>{
  const rows = await safeMany(`SELECT p.*, r.name restaurantName, r.slug restaurantSlug, COALESCE(NULLIF(p.name,''),p.title) name, COALESCE(p.image_url,p.image) imageUrl
    FROM products p LEFT JOIN restaurants r ON r.id=p.restaurant_id
    WHERE COALESCE(p.deleted,0)=0 ORDER BY p.id DESC LIMIT 500`);
  ok(res, mapPage(rows.map(mapProduct), n(req.query.page,1), n(req.query.perPage||req.query.per_page||req.query.limit,20)));
}));
router.get('/admin/mr-breado/products', requireAuth, ah(async(req,res)=>{
  const store = await safeOne(`SELECT id FROM restaurants WHERE LOWER(slug)='mr-breado' OR LOWER(name) LIKE '%mr breado%' ORDER BY id LIMIT 1`);
  const rows = await safeMany(`SELECT p.*, r.name restaurantName, r.slug restaurantSlug, COALESCE(NULLIF(p.name,''),p.title) name, COALESCE(p.image_url,p.image) imageUrl
    FROM products p LEFT JOIN restaurants r ON r.id=p.restaurant_id
    WHERE COALESCE(p.deleted,0)=0 AND (:rid IS NULL OR p.restaurant_id=:rid) ORDER BY p.id DESC LIMIT 500`, { rid: store?.id || null });
  ok(res, mapPage(rows.map(mapProduct), n(req.query.page,1), n(req.query.perPage||req.query.per_page||req.query.limit,20)));
}));
router.get('/categories', ah(async(req,res)=>{
  const rows = await safeMany(`SELECT * FROM food_categories WHERE COALESCE(deleted,0)=0 AND COALESCE(enabled,active,1)=1 ORDER BY sort_order,id`);
  ok(res, rows.map(mapCategory));
}));
router.get('/stories', ah(async(req,res)=>{
  await ensure();
  const rows = await safeMany(`SELECT * FROM bite_stories WHERE COALESCE(active,1)=1 AND (starts_at IS NULL OR starts_at<=NOW()) AND (ends_at IS NULL OR ends_at>=NOW()) ORDER BY sort_order,id DESC LIMIT 50`);
  ok(res, {items: rows.map(mapStory), stories: rows.map(mapStory)});
}));

async function submitVerification(req,res,forcedType){
  await ensure();
  const b = req.body || {};
  const role = String(req.user?.role || '').toUpperCase();
  const path = req.path.toLowerCase();
  const type = String(first(forcedType, b.requesterType, b.requester_type, b.type, path.includes('restaurant') || role.includes('SELLER') ? 'RESTAURANT' : 'RIDER')).toUpperCase().includes('RESTAURANT') ? 'RESTAURANT' : 'RIDER';
  const uid = req.user?.id || b.userId || b.user_id || null;
  const restaurantId = type === 'RESTAURANT' ? first(req.params.restaurantId, req.params.id, b.restaurantId, b.restaurant_id, null) : null;
  const riderId = type === 'RIDER' ? first(req.params.riderId, req.params.id, b.riderId, b.driverId, b.rider_id, b.driver_id, uid, null) : null;
  const payload = { ...b };
  const businessName = first(b.businessName, b.business_name, b.restaurantName, b.storeName, b.name, req.user?.name, '');
  const ownerName = first(b.ownerName, b.fullName, b.name, b.driverName, b.riderName, req.user?.name, '');
  const phone = first(b.mobile, b.phone, b.phoneNumber, req.user?.mobile, req.user?.phone, '');
  const email = first(b.email, req.user?.email, '');
  const notes = first(b.notes, b.note, b.address, b.fullAddress, b.residentialAddress, b.restaurantAddress, '');
  const existing = await safeOne(`SELECT id FROM app_verification_requests WHERE COALESCE(user_id,0)=COALESCE(:uid,0) AND requester_type=:type ORDER BY id DESC LIMIT 1`, {uid, type});
  let id = existing?.id;
  if (id) {
    await exec(`UPDATE app_verification_requests SET restaurant_id=:restaurantId, rider_id=:riderId, status='PENDING', business_name=:businessName, owner_name=:ownerName, phone=:phone, email=:email, notes=:notes, rejection_reason=NULL, submitted_payload=:payload, updated_at=NOW(6) WHERE id=:id`, {id, restaurantId, riderId, businessName, ownerName, phone, email, notes, payload:json(payload)});
    if ((req.files||[]).length) await safeExec('DELETE FROM app_verification_documents WHERE request_id=:id', {id});
  } else {
    const r = await exec(`INSERT INTO app_verification_requests(user_id, requester_type, restaurant_id, rider_id, status, business_name, owner_name, phone, email, notes, submitted_payload, created_at, updated_at) VALUES(:uid,:type,:restaurantId,:riderId,'PENDING',:businessName,:ownerName,:phone,:email,:notes,:payload,NOW(6),NOW(6))`, {uid,type,restaurantId,riderId,businessName,ownerName,phone,email,notes,payload:json(payload)});
    id = r.insertId;
  }
  for (const file of (req.files || [])) {
    await exec(`INSERT INTO app_verification_documents(request_id, document_type, original_name, mime_type, file_size, file_blob, created_at) VALUES(:id,:documentType,:originalName,:mimeType,:fileSize,:blob,NOW(6))`, {id, documentType:file.fieldname, originalName:file.originalname, mimeType:file.mimetype, fileSize:file.size, blob:file.buffer});
  }
  ok(res, await mapVerification(await one('SELECT * FROM app_verification_requests WHERE id=:id',{id}), req), 'Verification request submitted', 201);
}
const verificationSubmitPaths = [
  '/verification','/verification/submit','/verifications','/verification/request',
  '/seller/verification','/seller/verification/restaurant','/seller/verification/restaurant/:restaurantId',
  '/restaurant/verification','/restaurant/verification/:restaurantId','/restaurants/:restaurantId/verification',
  '/rider/verification','/rider/verification/:riderId','/driver/verification','/driver/verification/:riderId',
  '/delivery/verification','/delivery-partner/verification','/delivery-partners/verification'
];
router.post(verificationSubmitPaths, requireAuth, upload.any(), ah((req,res)=>submitVerification(req,res)));
router.get(['/rider/verification','/rider/verification/:riderId','/driver/verification','/delivery/verification','/seller/verification/status'], requireAuth, ah(async(req,res)=>{
  await ensure();
  const type = req.path.includes('seller') ? 'RESTAURANT' : 'RIDER';
  const row = await safeOne(`SELECT * FROM app_verification_requests WHERE user_id=:uid AND requester_type=:type ORDER BY id DESC LIMIT 1`, {uid:req.user.id,type});
  ok(res, row ? await mapVerification(row, req) : {status:'NOT_SUBMITTED'});
}));
router.get(['/admin/verifications','/admin/verification-requests','/admin/verifications/all','/admin/service-area-verifications','/admin/drivers/verification-requests'], requireAuth, ah(async(req,res)=>{
  const status = text(req.query.status).toUpperCase();
  const type = text(req.query.targetType || req.query.target_type || req.query.type).toUpperCase();
  let items = await verificationRows(req);
  if (status) items = items.filter(x => String(x.status).toUpperCase() === status);
  if (type && type !== 'ALL') items = items.filter(x => String(x.requesterType).toUpperCase() === type || (type === 'DRIVER' && x.requesterType === 'RIDER'));
  ok(res, {items, requests:items, verifications:items, total:items.length});
}));
router.get('/admin/verifications/:id', requireAuth, ah(async(req,res)=>{
  const row = await safeOne('SELECT * FROM app_verification_requests WHERE id=:id', {id:req.params.id});
  if (!row) return fail(res,'Verification request not found',404);
  ok(res, await mapVerification(row,req));
}));
async function streamDoc(req,res,disp){
  await ensure();
  const doc = await one('SELECT * FROM app_verification_documents WHERE id=:docId AND request_id=:requestId', {docId:req.params.documentId || req.params.docId, requestId:req.params.id || req.params.requestId});
  if (!doc) return fail(res,'Document not found',404);
  res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${disp}; filename="${String(doc.original_name || 'document').replace(/"/g,'')}"`);
  res.end(doc.file_blob);
}
router.get('/admin/verifications/:id/documents/:documentId/view', ah((req,res)=>streamDoc(req,res,'inline')));
router.get('/admin/verifications/:id/documents/:documentId/download', ah((req,res)=>streamDoc(req,res,'attachment')));
router.get('/admin/verification-documents/:requestId/:docId', ah((req,res)=>streamDoc(req,res,'inline')));
async function setStatus(req,res,status){
  await ensure();
  const row = await safeOne('SELECT * FROM app_verification_requests WHERE id=:id', {id:req.params.id});
  if(!row) return fail(res,'Verification request not found',404);
  const reason = text(req.body?.reason || req.body?.note || req.body?.message);
  await exec('UPDATE app_verification_requests SET status=:status, rejection_reason=:reason, admin_id=:adminId, updated_at=NOW(6) WHERE id=:id', {id:row.id,status,reason,adminId:req.user?.id||null});
  if(row.requester_type === 'RIDER') {
    await safeExec(`UPDATE delivery_partner_profiles SET verification_status=:v, verified=:verified, updated_at=NOW(6) WHERE user_id=:uid OR id=:rid`, {v:status==='APPROVED'?'VERIFIED':'REJECTED', verified:status==='APPROVED'?1:0, uid:row.user_id, rid:row.rider_id||row.user_id});
    await safeExec(`UPDATE users SET enabled=1, blocked=0 WHERE id=:uid`, {uid:row.user_id});
  }
  if(row.requester_type === 'RESTAURANT' && row.restaurant_id) await safeExec(`UPDATE restaurants SET verification_status=:v, verified=:verified, updated_at=NOW(6) WHERE id=:id`, {id:row.restaurant_id, v:status==='APPROVED'?'APPROVED':'REJECTED', verified:status==='APPROVED'?1:0});
  ok(res, await mapVerification(await one('SELECT * FROM app_verification_requests WHERE id=:id',{id:row.id}), req), `Verification ${status.toLowerCase()}`);
}
router.post('/admin/verifications/:id/approve', requireAuth, ah((req,res)=>setStatus(req,res,'APPROVED')));
router.post('/admin/verifications/:id/reject', requireAuth, ah((req,res)=>setStatus(req,res,'REJECTED')));
router.patch('/admin/verifications/:id/status', requireAuth, ah((req,res)=>setStatus(req,res,String(req.body?.status || req.query.status || 'PENDING').toUpperCase())));

module.exports = router;
