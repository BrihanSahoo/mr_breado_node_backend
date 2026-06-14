const router = require('express').Router();
const { ok, fail } = require('../utils/respond');
const ah = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { many, one, exec } = require('../utils/db');

function bool(v, fallback = false) {
  if (v === undefined || v === null) return fallback;
  if (Buffer.isBuffer(v)) return v[0] === 1;
  if (typeof v === 'object' && Array.isArray(v.data)) return Number(v.data[0]) === 1;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  return ['1','true','yes','on','active','enabled','visible','approved','verified'].includes(String(v).trim().toLowerCase());
}
function n(v, fallback = 0) { const x = Number(v); return Number.isFinite(x) ? x : fallback; }
function first(...values) { for (const v of values) if (v !== undefined && v !== null && String(v).trim() !== '') return v; return undefined; }
function text(v, fallback = '') { return String(v ?? fallback).trim(); }
function tryJson(v) { if (!v) return {}; if (typeof v === 'object') return v; try { return JSON.parse(String(v)); } catch { return {}; } }
function absolute(req, path) { return `${req.protocol}://${req.get('host')}${path}`; }
async function safeMany(sql, params={}) { try { return await many(sql, params); } catch(e) { console.error('[v31 query]', e.message); return []; } }
async function safeOne(sql, params={}) { try { return await one(sql, params); } catch(e) { console.error('[v31 one]', e.message); return null; } }
async function safeExec(sql, params={}) { try { return await exec(sql, params); } catch(e) { console.error('[v31 exec]', e.message); return { affectedRows:0, insertId:null }; } }

async function ensureTables() {
  await safeExec(`CREATE TABLE IF NOT EXISTS app_verification_requests (
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
  await safeExec(`CREATE TABLE IF NOT EXISTS app_verification_documents (
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
}

async function documentsFor(row, req) {
  await ensureTables();
  const docs = await safeMany(`SELECT id, request_id requestId, document_type documentType, original_name originalName, mime_type mimeType, file_size fileSize, created_at createdAt FROM app_verification_documents WHERE request_id=:id ORDER BY id`, { id: row.id });
  return docs.map((d) => {
    const view = `/api/admin/verifications/${row.id}/documents/${d.id}/view`;
    const down = `/api/admin/verifications/${row.id}/documents/${d.id}/download`;
    return {
      ...d,
      id: d.id,
      name: first(d.originalName, d.documentType, `Document ${d.id}`),
      fileName: first(d.originalName, `document-${d.id}`),
      type: first(d.documentType, d.mimeType, 'DOCUMENT'),
      url: absolute(req, view),
      fileUrl: absolute(req, view),
      viewUrl: absolute(req, view),
      downloadUrl: absolute(req, down),
    };
  });
}

async function mapVerification(row, req) {
  const payload = tryJson(row.submitted_payload ?? row.submittedPayload ?? row.payload);
  const requesterType = String(first(row.requester_type, row.requesterType, row.request_type, row.entityType, row.target_type, payload.requesterType, payload.type, 'RIDER')).toUpperCase().includes('RESTAURANT') ? 'RESTAURANT' : 'RIDER';
  const docs = await documentsFor(row, req);
  const applicant = first(row.owner_name, row.ownerName, row.userName, row.user_name, row.name, payload.fullName, payload.name, payload.driverName, payload.riderName, payload.ownerName, payload.applicantName, requesterType === 'RESTAURANT' ? payload.restaurantName : undefined, 'Verification request');
  const business = first(row.business_name, row.businessName, row.restaurantName, row.restaurant_name, payload.businessName, payload.restaurantName, payload.storeName, requesterType === 'RESTAURANT' ? applicant : '');
  const mobile = first(row.phone, row.mobile, row.userMobile, row.user_mobile, row.phone_number, row.userPhone, payload.mobile, payload.phone, payload.phoneNumber, payload.contactMobile, '');
  const email = first(row.email, row.userEmail, row.user_email, payload.email, '');
  const address = first(row.notes, row.address, payload.address, payload.fullAddress, payload.residentialAddress, payload.staffAddress, payload.restaurantAddress, payload.businessAddress, payload.ownerAddress, '');
  return {
    ...row,
    id: row.id,
    requestId: row.id,
    requesterType,
    entityType: requesterType,
    requestType: requesterType,
    source: requesterType,
    status: String(first(row.status, row.verification_status, 'PENDING')).toUpperCase(),
    restaurantId: row.restaurant_id ?? row.restaurantId,
    riderId: row.rider_id ?? row.riderId ?? row.user_id,
    driverId: row.rider_id ?? row.riderId ?? row.user_id,
    userId: row.user_id ?? row.userId,
    applicantName: applicant,
    fullName: applicant,
    ownerName: first(row.owner_name, payload.ownerName, applicant),
    businessName: business,
    restaurantName: first(row.restaurantName, row.restaurant_name, business),
    riderName: requesterType === 'RIDER' ? applicant : undefined,
    driverName: requesterType === 'RIDER' ? applicant : undefined,
    contactMobile: mobile,
    mobile,
    phone: mobile,
    email,
    address,
    note: first(row.notes, payload.notes, payload.note, address, ''),
    gstin: first(payload.gstin, payload.gstNumber, payload.gst, row.gstin, ''),
    panNumber: first(payload.panNumber, payload.pan, payload.panCardNo, row.panNumber, ''),
    fssaiNumber: first(payload.fssaiNumber, payload.fssaiLicense, payload.fssai, row.fssaiNumber, ''),
    aadhaarNumber: first(payload.aadhaarNumber, payload.aadharNumber, payload.aadhaarNo, payload.aadharNo, row.aadhaarNumber, ''),
    drivingLicenseNumber: first(payload.drivingLicenseNumber, payload.drivingLicense, payload.licenseNumber, payload.dlNumber, row.driving_license_number, ''),
    vehicleRegistrationNumber: first(payload.vehicleRegistrationNumber, payload.vehicleRcNumber, payload.vehicleRc, payload.vehicleNumber, payload.rcNumber, row.vehicle_number, ''),
    rejectionReason: row.rejection_reason ?? row.rejectionReason,
    documents: docs,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
    submittedPayload: payload,
  };
}

function pageResult(items, req) {
  const page = Math.max(1, n(req.query.page, 1));
  const perPage = Math.max(1, n(req.query.perPage || req.query.per_page || req.query.limit, items.length || 20));
  return { items, content: items, records: items, data: items, page, currentPage: page, perPage, per_page: perPage, total: items.length, totalItems: items.length, total_pages: Math.max(1, Math.ceil(items.length / perPage)), totalPages: Math.max(1, Math.ceil(items.length / perPage)), last: true };
}

function mapDriver(row = {}) {
  const userId = row.user_id ?? row.userId ?? row.id;
  const driverId = row.profile_id ?? row.profileId ?? row.driver_id ?? row.driverId ?? row.id;
  const pending = String(row.pending_request_status || '').toUpperCase() === 'PENDING';
  const verificationStatus = pending ? 'PENDING' : String(first(row.profile_verification_status, row.verification_status, row.verificationStatus, row.status, row.verified ? 'VERIFIED' : 'UNVERIFIED')).toUpperCase();
  const driverName = first(row.user_name, row.name, row.full_name, row.fullName, row.driver_name, row.driverName, row.rider_name, row.owner_name, `Rider #${userId}`);
  const driverMobile = first(row.user_mobile, row.mobile, row.phone, row.phone_number, row.driver_mobile, row.driverMobile, '—');
  const driverEmail = first(row.user_email, row.email, row.driver_email, row.driverEmail, '');
  const cashInHand = n(first(row.cash_in_hand, row.cashInHand, row.pending_cash, row.total_cash_collected), 0);
  const cashLimit = n(first(row.cash_limit, row.cashLimit, row.cash_limit_amount), 2000);
  return {
    ...row,
    id: userId,
    userId,
    profileId: driverId,
    driverId: driverId || userId,
    driverName,
    name: driverName,
    driverMobile,
    mobile: driverMobile,
    phone: driverMobile,
    driverEmail,
    email: driverEmail,
    online: bool(first(row.online, row.is_online, row.available), false),
    available: bool(first(row.available, row.online, row.is_online), false),
    blocked: bool(row.blocked, false),
    enabled: bool(row.enabled, true),
    verified: ['VERIFIED','APPROVED'].includes(verificationStatus),
    verificationStatus,
    pendingVerification: pending,
    verificationRequestId: row.pending_request_id || null,
    totalDeliveries: n(first(row.total_deliveries, row.deliveries, row.delivery_count), 0),
    totalEarnings: n(first(row.total_earnings, row.earnings), 0),
    cashInHand,
    cashLimit,
    remainingLimit: Math.max(0, cashLimit - cashInHand),
    rating: n(first(row.rating, row.average_rating), 0),
    vehicleNumber: first(row.vehicle_number, row.vehicleRegistrationNumber, row.vehicle_number, ''),
    drivingLicenseNumber: first(row.driving_license_number, row.drivingLicenseNumber, ''),
    createdAt: row.created_at ?? row.createdAt,
  };
}

router.get('/notifications', requireAuth, ah(async (req, res) => {
  const role = String(req.user?.role || '').toUpperCase();
  const isCustomer = role === 'USER' || role === 'CUSTOMER' || !role;
  const rows = await safeMany(`
    SELECT * FROM notifications
    WHERE (
      user_id=:uid
      OR UPPER(COALESCE(role,'')) IN (:role, :dbRole)
      OR (user_id IS NULL AND COALESCE(role,'')='')
    )
    ${isCustomer ? `AND NOT (
      UPPER(COALESCE(type,'')) LIKE '%VERIFICATION%'
      OR UPPER(COALESCE(title,'')) LIKE '%VERIFICATION REQUEST%'
      OR UPPER(COALESCE(message,'')) LIKE '%VERIFICATION REQUEST%'
      OR UPPER(COALESCE(title,'')) LIKE '%RIDER VERIFICATION%'
      OR UPPER(COALESCE(title,'')) LIKE '%RESTAURANT VERIFICATION%'
    )` : ''}
    ORDER BY created_at DESC, id DESC LIMIT 100`, { uid: req.user.id, role, dbRole: role === 'USER' ? 'CUSTOMER' : role });
  ok(res, { items: rows, notifications: rows, total: rows.length }, 'Notifications loaded');
}));

router.patch(['/notifications/read-all','/notifications/:id/read'], requireAuth, ah(async(req,res)=>{
  if (req.params.id) await safeExec('UPDATE notifications SET is_read=1 WHERE id=:id AND (user_id=:uid OR user_id IS NULL)', { id:req.params.id, uid:req.user.id });
  else await safeExec('UPDATE notifications SET is_read=1 WHERE user_id=:uid OR role=:role', { uid:req.user.id, role:req.user.role });
  ok(res, { read:true }, 'Notification updated');
}));

router.get(['/admin/drivers','/admin/delivery-boys','/delivery-boys','/admin/riders'], requireAuth, ah(async(req,res)=>{
  const search = text(req.query.search).toLowerCase();
  let rows = await safeMany(`
    SELECT
      u.id, u.name user_name, u.email user_email, u.mobile user_mobile, u.phone_number, u.role, u.enabled, u.blocked, u.deleted, u.created_at,
      dp.id profile_id, dp.verification_status profile_verification_status, dp.vehicle_number, dp.driving_license_number, dp.cash_in_hand, dp.total_deliveries, dp.total_earnings, dp.online, dp.available, dp.rating, dp.cash_limit,
      vr.id pending_request_id, vr.status pending_request_status, vr.updated_at pending_request_updated_at
    FROM users u
    LEFT JOIN delivery_partner_profiles dp ON dp.user_id=u.id
    LEFT JOIN app_verification_requests vr ON vr.user_id=u.id AND vr.requester_type='RIDER' AND UPPER(vr.status)='PENDING'
    WHERE UPPER(u.role) IN ('DELIVERY_PARTNER','RIDER','DRIVER','DELIVERY') AND COALESCE(u.deleted,0)=0
    ORDER BY CASE WHEN vr.id IS NULL THEN 1 ELSE 0 END, vr.updated_at DESC, u.id DESC
    LIMIT 500`);
  const mapped = rows.map(mapDriver).filter((r) => !search || String(`${r.driverName} ${r.driverMobile} ${r.driverEmail} ${r.driverId}`).toLowerCase().includes(search));
  ok(res, pageResult(mapped, req), 'Drivers loaded');
}));

router.get(['/admin/drivers/:id','/admin/drivers/:id/verification-details'], requireAuth, ah(async(req,res)=>{
  const row = await safeOne(`
    SELECT
      u.id, u.name user_name, u.email user_email, u.mobile user_mobile, u.phone_number, u.role, u.enabled, u.blocked, u.deleted, u.created_at,
      dp.id profile_id, dp.verification_status profile_verification_status, dp.vehicle_number, dp.driving_license_number, dp.cash_in_hand, dp.total_deliveries, dp.total_earnings, dp.online, dp.available, dp.rating, dp.cash_limit,
      vr.id pending_request_id, vr.status pending_request_status, vr.updated_at pending_request_updated_at
    FROM users u
    LEFT JOIN delivery_partner_profiles dp ON dp.user_id=u.id
    LEFT JOIN app_verification_requests vr ON vr.user_id=u.id AND vr.requester_type='RIDER' AND UPPER(vr.status)='PENDING'
    WHERE u.id=:id OR dp.id=:id LIMIT 1`, { id:req.params.id });
  if (!row) return fail(res, 'Driver not found', 404);
  ok(res, mapDriver(row), 'Driver loaded');
}));

router.patch(['/admin/verifications/riders/:id/status','/admin/drivers/:id/verification'], requireAuth, ah(async(req,res)=>{
  const statusRaw = String(req.query.status || req.body?.status || 'VERIFIED').toUpperCase();
  const status = ['VERIFIED','APPROVED'].includes(statusRaw) ? 'VERIFIED' : statusRaw === 'REJECTED' ? 'REJECTED' : 'UNVERIFIED';
  await safeExec(`UPDATE delivery_partner_profiles SET verification_status=:status, verified=:verified, updated_at=NOW(6) WHERE user_id=:id OR id=:id`, { id:req.params.id, status, verified:status==='VERIFIED'?1:0 });
  await safeExec(`UPDATE app_verification_requests SET status=:requestStatus, admin_id=:adminId, updated_at=NOW(6) WHERE requester_type='RIDER' AND (user_id=:id OR rider_id=:id) AND UPPER(status)='PENDING'`, { id:req.params.id, requestStatus:status==='VERIFIED'?'APPROVED':status, adminId:req.user?.id||null });
  ok(res, { id:req.params.id, verificationStatus:status, verified:status==='VERIFIED' }, 'Driver verification updated');
}));
router.post('/admin/drivers/:id/approve', requireAuth, ah(async(req,res)=>{
  await safeExec(`UPDATE delivery_partner_profiles SET verification_status='VERIFIED', verified=1, updated_at=NOW(6) WHERE user_id=:id OR id=:id`, { id:req.params.id });
  await safeExec(`UPDATE app_verification_requests SET status='APPROVED', admin_id=:adminId, updated_at=NOW(6) WHERE requester_type='RIDER' AND (user_id=:id OR rider_id=:id) AND UPPER(status)='PENDING'`, { id:req.params.id, adminId:req.user?.id||null });
  ok(res, { id:req.params.id, verificationStatus:'VERIFIED', verified:true }, 'Driver approved');
}));
router.post('/admin/drivers/:id/reject', requireAuth, ah(async(req,res)=>{
  await safeExec(`UPDATE delivery_partner_profiles SET verification_status='REJECTED', verified=0, updated_at=NOW(6) WHERE user_id=:id OR id=:id`, { id:req.params.id });
  await safeExec(`UPDATE app_verification_requests SET status='REJECTED', rejection_reason=:reason, admin_id=:adminId, updated_at=NOW(6) WHERE requester_type='RIDER' AND (user_id=:id OR rider_id=:id) AND UPPER(status)='PENDING'`, { id:req.params.id, reason:text(req.body?.reason || req.body?.note || 'Rejected by admin'), adminId:req.user?.id||null });
  ok(res, { id:req.params.id, verificationStatus:'REJECTED', verified:false }, 'Driver rejected');
}));

async function verificationRows(req) {
  await ensureTables();
  let appRows = await safeMany(`
    SELECT vr.*, u.name userName, u.email userEmail, u.mobile userMobile, u.phone_number userPhone, r.name restaurantName, r.slug restaurantSlug
    FROM app_verification_requests vr
    LEFT JOIN users u ON u.id=vr.user_id
    LEFT JOIN restaurants r ON r.id=vr.restaurant_id
    ORDER BY vr.updated_at DESC, vr.id DESC LIMIT 500`);
  const out = [];
  const seen = new Set();
  for (const row of appRows) {
    const mapped = await mapVerification(row, req);
    const key = `${mapped.userId || ''}:${mapped.requesterType}:${mapped.restaurantId || ''}:${mapped.riderId || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mapped);
  }
  return out;
}

router.get(['/admin/verifications','/admin/verification-requests','/admin/verifications/all','/admin/service-area-verifications','/admin/drivers/verification-requests'], requireAuth, ah(async(req,res)=>{
  const statusParam = text(req.query.status).toUpperCase();
  const includeAll = ['1','true','yes'].includes(text(req.query.includeAll || req.query.all).toLowerCase());
  const targetType = text(req.query.targetType || req.query.target_type || req.query.type).toUpperCase();
  let items = await verificationRows(req);
  const status = statusParam || (includeAll ? '' : 'PENDING');
  if (status) items = items.filter((x) => String(x.status).toUpperCase() === status || (status === 'VERIFIED' && String(x.status).toUpperCase() === 'APPROVED'));
  if (targetType && targetType !== 'ALL') items = items.filter((x) => String(x.requesterType).toUpperCase() === targetType || (targetType === 'DRIVER' && x.requesterType === 'RIDER'));
  ok(res, { items, requests:items, verifications:items, total:items.length }, 'Verification requests loaded');
}));

router.get('/admin/verifications/:id', requireAuth, ah(async(req,res)=>{
  await ensureTables();
  const row = await safeOne(`SELECT vr.*, u.name userName, u.email userEmail, u.mobile userMobile, u.phone_number userPhone, r.name restaurantName, r.slug restaurantSlug
    FROM app_verification_requests vr
    LEFT JOIN users u ON u.id=vr.user_id
    LEFT JOIN restaurants r ON r.id=vr.restaurant_id
    WHERE vr.id=:id`, { id:req.params.id });
  if (!row) return fail(res,'Verification request not found',404);
  ok(res, await mapVerification(row, req), 'Verification request loaded');
}));

async function streamDoc(req,res,disposition) {
  await ensureTables();
  const doc = await safeOne('SELECT * FROM app_verification_documents WHERE id=:docId AND request_id=:requestId', { docId:req.params.documentId || req.params.docId, requestId:req.params.id || req.params.requestId });
  if (!doc) return fail(res, 'Document not found', 404);
  const filename = String(doc.original_name || `document-${doc.id}`).replace(/["\r\n]/g, '');
  res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.end(doc.file_blob);
}
router.get('/admin/verifications/:id/documents/:documentId/view', ah((req,res)=>streamDoc(req,res,'inline')));
router.get('/admin/verifications/:id/documents/:documentId/download', ah((req,res)=>streamDoc(req,res,'attachment')));
router.get('/admin/verification-documents/:requestId/:docId', ah((req,res)=>streamDoc(req,res,'inline')));

async function updateVerification(req,res,status) {
  await ensureTables();
  const row = await safeOne('SELECT * FROM app_verification_requests WHERE id=:id', { id:req.params.id });
  if (!row) return fail(res,'Verification request not found',404);
  const reason = text(req.body?.reason || req.body?.note || req.body?.message);
  const requesterType = String(row.requester_type).toUpperCase();
  await safeExec('UPDATE app_verification_requests SET status=:status, rejection_reason=:reason, admin_id=:adminId, updated_at=NOW(6) WHERE id=:id', { id:row.id, status, reason, adminId:req.user?.id||null });
  if (requesterType === 'RIDER') {
    await safeExec(`UPDATE delivery_partner_profiles SET verification_status=:driverStatus, verified=:verified, updated_at=NOW(6) WHERE user_id=:uid OR id=:rid`, { uid:row.user_id, rid:row.rider_id||row.user_id, driverStatus:status==='APPROVED'?'VERIFIED':'REJECTED', verified:status==='APPROVED'?1:0 });
    await safeExec(`UPDATE users SET enabled=1, blocked=0 WHERE id=:uid`, { uid:row.user_id });
  }
  if (requesterType === 'RESTAURANT') {
    await safeExec(`UPDATE restaurants SET verification_status=:restaurantStatus, visibility_status=CASE WHEN :approved=1 THEN 'VISIBLE' ELSE visibility_status END, verified=:verified, updated_at=NOW(6) WHERE id=:rid OR owner_id=:uid`, { rid:row.restaurant_id||0, uid:row.user_id||0, restaurantStatus:status==='APPROVED'?'APPROVED':'REJECTED', approved:status==='APPROVED'?1:0, verified:status==='APPROVED'?1:0 });
  }
  ok(res, await mapVerification(await safeOne('SELECT * FROM app_verification_requests WHERE id=:id', { id:row.id }), req), `Verification ${status.toLowerCase()}`);
}
router.post('/admin/verifications/:id/approve', requireAuth, ah((req,res)=>updateVerification(req,res,'APPROVED')));
router.post('/admin/verifications/:id/reject', requireAuth, ah((req,res)=>updateVerification(req,res,'REJECTED')));
router.patch('/admin/verifications/:id/status', requireAuth, ah((req,res)=>updateVerification(req,res, String(req.body?.status || req.query.status || 'PENDING').toUpperCase())));

module.exports = router;
