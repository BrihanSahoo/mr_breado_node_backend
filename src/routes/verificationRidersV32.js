const router = require('express').Router();
const { ok, fail } = require('../utils/respond');
const ah = require('../utils/asyncHandler');
const { optionalAuth } = require('../middleware/auth');
const { pool } = require('../utils/db');

const colCache = new Map();
async function cols(table) {
  if (colCache.has(table)) return colCache.get(table);
  try {
    const [rows] = await pool.execute(`SHOW COLUMNS FROM \`${table}\``);
    const set = new Set(rows.map((r) => r.Field));
    colCache.set(table, set);
    return set;
  } catch (e) {
    const set = new Set();
    colCache.set(table, set);
    return set;
  }
}
async function tableExists(table) { return (await cols(table)).size > 0; }
async function q(sql, params = []) { try { const [rows] = await pool.execute(sql, params); return rows; } catch (e) { console.error('[v32 query]', e.message, sql); return []; } }
async function one(sql, params = []) { const rows = await q(sql, params); return rows[0] || null; }
async function run(sql, params = []) { try { const [r] = await pool.execute(sql, params); return r; } catch (e) { console.error('[v32 exec]', e.message, sql); return { affectedRows: 0, insertId: null }; } }
function bit(v, fallback = false) { if (v == null) return fallback; if (Buffer.isBuffer(v)) return v[0] === 1; if (typeof v === 'object' && Array.isArray(v.data)) return Number(v.data[0]) === 1; if (typeof v === 'boolean') return v; if (typeof v === 'number') return v === 1; return ['1','true','yes','on','verified','approved','online','available','enabled'].includes(String(v).trim().toLowerCase()); }
function n(v, d = 0) { const x = Number(v); return Number.isFinite(x) ? x : d; }
function first(...vals) { for (const v of vals) if (v !== undefined && v !== null && String(v).trim() !== '') return v; return undefined; }
function s(v, d = '') { return String(v ?? d).trim(); }
function abs(req, path) { if (!path) return ''; if (/^https?:\/\//i.test(path)) return path; return `${req.protocol}://${req.get('host')}${path.startsWith('/') ? path : `/${path}`}`; }
function page(items, req) { const p = Math.max(1, n(req.query.page, 1)); const per = Math.max(1, n(req.query.perPage || req.query.per_page || req.query.limit, items.length || 20)); return { items, data: items, content: items, records: items, drivers: items, requests: items, verifications: items, total: items.length, totalItems: items.length, totalElements: items.length, page: p, currentPage: p, perPage: per, per_page: per, totalPages: Math.max(1, Math.ceil(items.length / per)), total_pages: Math.max(1, Math.ceil(items.length / per)), last: true }; }
function parseJson(v) { if (!v) return {}; if (typeof v === 'object') return v; try { return JSON.parse(String(v)); } catch { return {}; } }

async function nativeVerificationDocs(req, requestId) {
  if (!(await tableExists('verification_documents'))) return [];
  const rows = await q(`SELECT id, request_id, document_type, original_filename, file_url, content_type, size_bytes, uploaded_at FROM verification_documents WHERE request_id=? ORDER BY id`, [requestId]);
  return rows.map((d) => ({
    id: d.id,
    requestId: d.request_id,
    documentType: first(d.document_type, d.content_type, 'DOCUMENT'),
    type: first(d.document_type, d.content_type, 'DOCUMENT'),
    originalName: first(d.original_filename, `document-${d.id}`),
    originalFilename: first(d.original_filename, `document-${d.id}`),
    name: first(d.original_filename, d.document_type, `Document ${d.id}`),
    fileName: first(d.original_filename, `document-${d.id}`),
    mimeType: first(d.content_type, 'application/octet-stream'),
    fileSize: n(d.size_bytes, 0),
    uploadedAt: d.uploaded_at,
    url: d.file_url ? abs(req, d.file_url) : abs(req, `/api/admin/native-verifications/${requestId}/documents/${d.id}/view`),
    fileUrl: d.file_url ? abs(req, d.file_url) : abs(req, `/api/admin/native-verifications/${requestId}/documents/${d.id}/view`),
    viewUrl: d.file_url ? abs(req, d.file_url) : abs(req, `/api/admin/native-verifications/${requestId}/documents/${d.id}/view`),
    downloadUrl: d.file_url ? abs(req, d.file_url) : abs(req, `/api/admin/native-verifications/${requestId}/documents/${d.id}/download`),
  }));
}
async function appVerificationDocs(req, requestId) {
  if (!(await tableExists('app_verification_documents'))) return [];
  const rows = await q(`SELECT id, request_id, document_type, original_name, mime_type, file_size, created_at FROM app_verification_documents WHERE request_id=? ORDER BY id`, [requestId]);
  return rows.map((d) => ({
    id: d.id,
    requestId: d.request_id,
    documentType: first(d.document_type, d.mime_type, 'DOCUMENT'),
    type: first(d.document_type, d.mime_type, 'DOCUMENT'),
    originalName: first(d.original_name, `document-${d.id}`),
    originalFilename: first(d.original_name, `document-${d.id}`),
    name: first(d.original_name, d.document_type, `Document ${d.id}`),
    fileName: first(d.original_name, `document-${d.id}`),
    mimeType: first(d.mime_type, 'application/octet-stream'),
    fileSize: n(d.file_size, 0),
    uploadedAt: d.created_at,
    url: abs(req, `/api/admin/verifications/${requestId}/documents/${d.id}/view`),
    fileUrl: abs(req, `/api/admin/verifications/${requestId}/documents/${d.id}/view`),
    viewUrl: abs(req, `/api/admin/verifications/${requestId}/documents/${d.id}/view`),
    downloadUrl: abs(req, `/api/admin/verifications/${requestId}/documents/${d.id}/download`),
  }));
}

function mapNativeVerification(row, docs) {
  const type = String(row.target_type || 'RIDER').toUpperCase();
  const applicant = first(row.applicant_name, row.user_name, row.restaurant_name, row.business_name, type === 'RIDER' ? `Rider #${row.target_id}` : `Restaurant #${row.target_id}`);
  return {
    ...row,
    id: `native-${row.id}`,
    numericId: row.id,
    requestId: `native-${row.id}`,
    nativeRequestId: row.id,
    sourceTable: 'verification_requests',
    requesterType: type,
    entityType: type,
    requestType: type,
    status: String(row.status || 'PENDING').toUpperCase(),
    userId: row.user_id || row.owner_id || row.rider_user_id || null,
    riderId: type === 'RIDER' ? row.target_id : null,
    driverId: type === 'RIDER' ? row.target_id : null,
    restaurantId: type === 'RESTAURANT' ? row.target_id : null,
    applicantName: applicant,
    fullName: applicant,
    ownerName: first(row.owner_name, row.user_name, applicant),
    businessName: first(row.business_name, row.restaurant_name, ''),
    restaurantName: first(row.restaurant_name, row.business_name, type === 'RESTAURANT' ? applicant : ''),
    riderName: type === 'RIDER' ? applicant : undefined,
    driverName: type === 'RIDER' ? applicant : undefined,
    contactMobile: first(row.contact_mobile, row.user_mobile, row.mobile, row.phone_number, ''),
    mobile: first(row.contact_mobile, row.user_mobile, row.mobile, row.phone_number, ''),
    phone: first(row.contact_mobile, row.user_mobile, row.mobile, row.phone_number, ''),
    email: first(row.user_email, row.email, ''),
    address: first(row.address, row.applicant_note, ''),
    note: first(row.applicant_note, row.address, ''),
    gstin: first(row.gstin, ''),
    panNumber: first(row.pan_number, ''),
    fssaiNumber: first(row.fssai_number, ''),
    aadhaarNumber: first(row.aadhaar_number, ''),
    drivingLicenseNumber: first(row.driving_license_number, row.license_number, ''),
    vehicleRegistrationNumber: first(row.vehicle_registration_number, row.vehicle_number, ''),
    rejectionReason: first(row.admin_remark, ''),
    documents: docs,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function mapAppVerification(row, docs) {
  const payload = parseJson(row.submitted_payload);
  const type = String(first(row.requester_type, payload.requesterType, payload.type, 'RIDER')).toUpperCase().includes('RESTAURANT') ? 'RESTAURANT' : 'RIDER';
  const applicant = first(row.owner_name, row.user_name, payload.fullName, payload.name, payload.driverName, payload.riderName, payload.ownerName, payload.applicantName, type === 'RESTAURANT' ? row.restaurant_name : undefined, 'Verification request');
  return {
    ...row,
    id: `app-${row.id}`,
    numericId: row.id,
    requestId: `app-${row.id}`,
    appRequestId: row.id,
    sourceTable: 'app_verification_requests',
    requesterType: type,
    entityType: type,
    requestType: type,
    status: String(row.status || 'PENDING').toUpperCase(),
    userId: row.user_id,
    riderId: row.rider_id || row.user_id,
    driverId: row.rider_id || row.user_id,
    restaurantId: row.restaurant_id,
    applicantName: applicant,
    fullName: applicant,
    ownerName: first(row.owner_name, payload.ownerName, applicant),
    businessName: first(row.business_name, row.restaurant_name, payload.businessName, payload.restaurantName, ''),
    restaurantName: first(row.restaurant_name, row.business_name, payload.restaurantName, ''),
    riderName: type === 'RIDER' ? applicant : undefined,
    driverName: type === 'RIDER' ? applicant : undefined,
    contactMobile: first(row.phone, row.user_mobile, payload.mobile, payload.phone, payload.phoneNumber, ''),
    mobile: first(row.phone, row.user_mobile, payload.mobile, payload.phone, payload.phoneNumber, ''),
    phone: first(row.phone, row.user_mobile, payload.mobile, payload.phone, payload.phoneNumber, ''),
    email: first(row.email, row.user_email, payload.email, ''),
    address: first(row.notes, payload.address, payload.fullAddress, payload.residentialAddress, payload.restaurantAddress, ''),
    note: first(row.notes, payload.notes, payload.note, ''),
    gstin: first(payload.gstin, payload.gstNumber, ''),
    panNumber: first(payload.panNumber, payload.pan, ''),
    fssaiNumber: first(payload.fssaiNumber, payload.fssai, ''),
    aadhaarNumber: first(payload.aadhaarNumber, payload.aadharNumber, payload.aadhaarNo, payload.aadharNo, ''),
    drivingLicenseNumber: first(payload.drivingLicenseNumber, payload.drivingLicense, payload.licenseNumber, payload.dlNumber, ''),
    vehicleRegistrationNumber: first(payload.vehicleRegistrationNumber, payload.vehicleRcNumber, payload.vehicleNumber, payload.rcNumber, ''),
    rejectionReason: row.rejection_reason,
    documents: docs,
    submittedPayload: payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadVerificationRequests(req) {
  const out = [];
  if (await tableExists('verification_requests')) {
    const rows = await q(`
      SELECT vr.*, u.name user_name, u.email user_email, u.mobile user_mobile, u.phone_number, dp.user_id rider_user_id, dp.license_number, dp.vehicle_number, r.name restaurant_name, r.owner_id
      FROM verification_requests vr
      LEFT JOIN delivery_partner_profiles dp ON vr.target_type='RIDER' AND (dp.id=vr.target_id OR dp.user_id=vr.target_id)
      LEFT JOIN restaurants r ON vr.target_type='RESTAURANT' AND r.id=vr.target_id
      LEFT JOIN users u ON u.id=COALESCE(dp.user_id, r.owner_id)
      ORDER BY vr.updated_at DESC, vr.created_at DESC, vr.id DESC LIMIT 500`);
    for (const row of rows) out.push(mapNativeVerification(row, await nativeVerificationDocs(req, row.id)));
  }
  if (await tableExists('app_verification_requests')) {
    const rows = await q(`
      SELECT vr.*, u.name user_name, u.email user_email, u.mobile user_mobile, u.phone_number, r.name restaurant_name
      FROM app_verification_requests vr
      LEFT JOIN users u ON u.id=vr.user_id
      LEFT JOIN restaurants r ON r.id=vr.restaurant_id
      ORDER BY vr.updated_at DESC, vr.created_at DESC, vr.id DESC LIMIT 500`);
    for (const row of rows) out.push(mapAppVerification(row, await appVerificationDocs(req, row.id)));
  }
  const seen = new Set();
  return out.filter((x) => { const key = `${x.sourceTable}:${x.numericId}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

function mapDriver(row = {}) {
  const userId = first(row.user_id, row.userId, row.id);
  const profileId = first(row.profile_id, row.profileId, row.driver_id, row.driverId, row.id);
  const pending = String(first(row.pending_request_status, row.native_pending_status, row.app_pending_status, '')).toUpperCase() === 'PENDING';
  const rawStatus = String(first(row.profile_verification_status, row.verification_status, row.verificationStatus, row.status, row.verified ? 'VERIFIED' : 'UNVERIFIED')).toUpperCase();
  const verificationStatus = pending ? 'PENDING' : (rawStatus === 'APPROVED' ? 'VERIFIED' : rawStatus);
  const driverName = first(row.user_name, row.name, row.full_name, row.driver_name, row.rider_name, `Rider #${userId}`);
  const driverMobile = first(row.user_mobile, row.mobile, row.phone, row.phone_number, '—');
  const driverEmail = first(row.user_email, row.email, '');
  const cashInHand = n(first(row.cash_in_hand, row.pending_cash, row.total_cash_collected), 0);
  const cashLimit = n(first(row.cash_limit, row.cash_limit_amount), 2000);
  return {
    ...row,
    id: userId,
    userId,
    profileId,
    driverId: profileId || userId,
    driverName,
    name: driverName,
    driverMobile,
    mobile: driverMobile,
    phone: driverMobile,
    driverEmail,
    email: driverEmail,
    online: bit(first(row.online, row.available, row.status === 'ONLINE'), false),
    available: bit(first(row.available, row.online, row.status === 'ONLINE'), false),
    blocked: bit(row.blocked, false),
    enabled: bit(row.enabled, true),
    verified: ['VERIFIED','APPROVED'].includes(verificationStatus),
    verificationStatus,
    pendingVerification: pending,
    verificationRequestId: first(row.pending_request_id, row.native_pending_id, row.app_pending_id, null),
    totalDeliveries: n(first(row.total_deliveries, row.deliveries, row.delivery_count), 0),
    totalEarnings: n(first(row.total_earnings, row.earnings), 0),
    cashInHand,
    cashLimit,
    remainingLimit: Math.max(0, cashLimit - cashInHand),
    rating: n(first(row.rating, row.average_rating), 0),
    vehicleNumber: first(row.vehicle_number, row.vehicleRegistrationNumber, ''),
    drivingLicenseNumber: first(row.license_number, row.driving_license_number, row.drivingLicenseNumber, ''),
    createdAt: row.created_at,
  };
}

router.use(optionalAuth);

router.get(['/admin/drivers','/admin/delivery-boys','/delivery-boys','/admin/riders'], ah(async (req, res) => {
  const search = s(req.query.search).toLowerCase();
  let rows = [];
  if (await tableExists('delivery_partner_profiles')) {
    rows = rows.concat(await q(`
      SELECT dp.id profile_id, dp.*, u.id user_id, u.name user_name, u.email user_email, u.mobile user_mobile, u.phone_number, u.enabled, u.blocked, u.deleted, u.role,
             nvr.id native_pending_id, nvr.status native_pending_status,
             avr.id app_pending_id, avr.status app_pending_status,
             COALESCE(nvr.id, avr.id) pending_request_id,
             COALESCE(nvr.status, avr.status) pending_request_status
      FROM delivery_partner_profiles dp
      LEFT JOIN users u ON u.id=dp.user_id
      LEFT JOIN verification_requests nvr ON nvr.target_type='RIDER' AND UPPER(nvr.status)='PENDING' AND (nvr.target_id=dp.id OR nvr.target_id=dp.user_id)
      LEFT JOIN app_verification_requests avr ON avr.requester_type='RIDER' AND UPPER(avr.status)='PENDING' AND (avr.user_id=dp.user_id OR avr.rider_id=dp.id)
      WHERE COALESCE(dp.deleted,0)=0 AND COALESCE(u.deleted,0)=0
      ORDER BY CASE WHEN COALESCE(nvr.id, avr.id) IS NULL THEN 1 ELSE 0 END, dp.id DESC LIMIT 500`));
  }
  if (!rows.length && await tableExists('users')) {
    rows = rows.concat(await q(`
      SELECT u.id user_id, u.name user_name, u.email user_email, u.mobile user_mobile, u.phone_number, u.enabled, u.blocked, u.deleted, u.role,
             avr.id app_pending_id, avr.status app_pending_status, avr.id pending_request_id, avr.status pending_request_status
      FROM users u
      LEFT JOIN app_verification_requests avr ON avr.requester_type='RIDER' AND UPPER(avr.status)='PENDING' AND avr.user_id=u.id
      WHERE (UPPER(u.role) IN ('DELIVERY_PARTNER','RIDER','DRIVER','DELIVERY','DELIVERY_BOY') OR UPPER(u.role) LIKE '%DELIVERY%') AND COALESCE(u.deleted,0)=0
      ORDER BY CASE WHEN avr.id IS NULL THEN 1 ELSE 0 END, u.id DESC LIMIT 500`));
  }
  let items = rows.map(mapDriver);
  if (search) items = items.filter((r) => `${r.driverName} ${r.driverMobile} ${r.driverEmail} ${r.driverId} ${r.userId}`.toLowerCase().includes(search));
  ok(res, page(items, req), 'Drivers loaded');
}));

router.get(['/admin/verifications','/admin/verification-requests','/admin/verifications/all','/admin/service-area-verifications','/admin/drivers/verification-requests'], ah(async (req, res) => {
  const statusParam = s(req.query.status || '').toUpperCase();
  const includeAll = ['1','true','yes'].includes(s(req.query.includeAll || req.query.all).toLowerCase());
  const targetType = s(req.query.targetType || req.query.target_type || req.query.type || '').toUpperCase();
  let items = await loadVerificationRequests(req);
  const status = statusParam || (includeAll ? '' : 'PENDING');
  if (status) items = items.filter((x) => String(x.status).toUpperCase() === status || (status === 'APPROVED' && String(x.status).toUpperCase() === 'VERIFIED'));
  if (targetType && targetType !== 'ALL') items = items.filter((x) => String(x.requesterType).toUpperCase() === targetType || (targetType === 'DRIVER' && x.requesterType === 'RIDER'));
  ok(res, page(items, req), 'Verification requests loaded');
}));

router.get('/admin/verifications/:id', ah(async (req, res) => {
  const id = String(req.params.id);
  const items = await loadVerificationRequests(req);
  const item = items.find((x) => String(x.id) === id || String(x.numericId) === id || String(x.requestId) === id);
  if (!item) return fail(res, 'Verification request not found', 404);
  ok(res, item, 'Verification request loaded');
}));

async function approveReject(req, res, status) {
  const rawId = String(req.params.id);
  const isNative = rawId.startsWith('native-');
  const isApp = rawId.startsWith('app-');
  const numeric = Number(rawId.replace(/^(native-|app-)/, ''));
  if (!Number.isFinite(numeric)) return fail(res, 'Invalid verification request id', 400);
  if (isNative || (!isApp && await one('SELECT id FROM verification_requests WHERE id=? LIMIT 1', [numeric]))) {
    const row = await one('SELECT * FROM verification_requests WHERE id=? LIMIT 1', [numeric]);
    if (!row) return fail(res, 'Verification request not found', 404);
    const newStatus = status === 'APPROVED' ? 'VERIFIED' : 'REJECTED';
    await run('UPDATE verification_requests SET status=?, admin_remark=?, reviewed_at=NOW(6), updated_at=NOW(6) WHERE id=?', [newStatus, s(req.body?.reason || req.body?.note || ''), numeric]);
    if (String(row.target_type).toUpperCase() === 'RIDER') {
      await run("UPDATE delivery_partner_profiles SET verification_status=?, verified=?, verified_at=CASE WHEN ?=1 THEN NOW(6) ELSE verified_at END, updated_at=NOW(6) WHERE id=? OR user_id=?", [newStatus, newStatus === 'VERIFIED' ? 1 : 0, newStatus === 'VERIFIED' ? 1 : 0, row.target_id, row.target_id]);
    } else {
      await run("UPDATE restaurants SET verification_status=?, verified=?, visibility_status=CASE WHEN ?=1 THEN 'VISIBLE' ELSE visibility_status END, updated_at=NOW(6) WHERE id=?", [newStatus === 'VERIFIED' ? 'APPROVED' : 'REJECTED', newStatus === 'VERIFIED' ? 1 : 0, newStatus === 'VERIFIED' ? 1 : 0, row.target_id]);
    }
    return ok(res, { id: rawId, status: newStatus }, `Verification ${newStatus.toLowerCase()}`);
  }
  const row = await one('SELECT * FROM app_verification_requests WHERE id=? LIMIT 1', [numeric]);
  if (!row) return fail(res, 'Verification request not found', 404);
  await run('UPDATE app_verification_requests SET status=?, rejection_reason=?, updated_at=NOW(6) WHERE id=?', [status, s(req.body?.reason || req.body?.note || ''), numeric]);
  if (String(row.requester_type).toUpperCase() === 'RIDER') {
    await run("UPDATE delivery_partner_profiles SET verification_status=?, verified=?, updated_at=NOW(6) WHERE user_id=? OR id=?", [status === 'APPROVED' ? 'VERIFIED' : 'REJECTED', status === 'APPROVED' ? 1 : 0, row.user_id, row.rider_id || row.user_id]);
  } else {
    await run("UPDATE restaurants SET verification_status=?, verified=?, visibility_status=CASE WHEN ?=1 THEN 'VISIBLE' ELSE visibility_status END, updated_at=NOW(6) WHERE id=? OR owner_id=?", [status === 'APPROVED' ? 'APPROVED' : 'REJECTED', status === 'APPROVED' ? 1 : 0, status === 'APPROVED' ? 1 : 0, row.restaurant_id || 0, row.user_id || 0]);
  }
  ok(res, { id: rawId, status }, `Verification ${status.toLowerCase()}`);
}
router.post('/admin/verifications/:id/approve', ah((req, res) => approveReject(req, res, 'APPROVED')));
router.post('/admin/verifications/:id/reject', ah((req, res) => approveReject(req, res, 'REJECTED')));
router.patch('/admin/verifications/:id/status', ah((req, res) => approveReject(req, res, String(req.body?.status || req.query.status || 'APPROVED').toUpperCase())));

router.get('/admin/verifications/:id/documents/:documentId/view', ah(async (req, res) => {
  const rawId = String(req.params.id);
  const numeric = Number(rawId.replace(/^(native-|app-)/, ''));
  const docId = Number(req.params.documentId);
  if (rawId.startsWith('native-') || await one('SELECT id FROM verification_documents WHERE id=? AND request_id=? LIMIT 1', [docId, numeric])) {
    const doc = await one('SELECT * FROM verification_documents WHERE id=? AND request_id=? LIMIT 1', [docId, numeric]);
    if (!doc) return fail(res, 'Document not found', 404);
    if (doc.file_url) return res.redirect(abs(req, doc.file_url));
    return fail(res, 'Document file is not available', 404);
  }
  const doc = await one('SELECT * FROM app_verification_documents WHERE id=? AND request_id=? LIMIT 1', [docId, numeric]);
  if (!doc) return fail(res, 'Document not found', 404);
  res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${String(doc.original_name || `document-${doc.id}`).replace(/["\r\n]/g, '')}"`);
  res.end(doc.file_blob);
}));
router.get('/admin/verifications/:id/documents/:documentId/download', ah(async (req, res) => {
  const rawId = String(req.params.id);
  const numeric = Number(rawId.replace(/^(native-|app-)/, ''));
  const docId = Number(req.params.documentId);
  const doc = await one('SELECT * FROM verification_documents WHERE id=? AND request_id=? LIMIT 1', [docId, numeric]);
  if (doc?.file_url) return res.redirect(abs(req, doc.file_url));
  const appDoc = await one('SELECT * FROM app_verification_documents WHERE id=? AND request_id=? LIMIT 1', [docId, numeric]);
  if (!appDoc) return fail(res, 'Document not found', 404);
  res.setHeader('Content-Type', appDoc.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${String(appDoc.original_name || `document-${appDoc.id}`).replace(/["\r\n]/g, '')}"`);
  res.end(appDoc.file_blob);
}));

module.exports = router;
