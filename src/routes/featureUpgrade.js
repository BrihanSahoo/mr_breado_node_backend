const router = require('express').Router();
const multer = require('multer');
const { ok, fail } = require('../utils/respond');
const ah = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { many, one, exec, slugify } = require('../utils/db');

const MAX_FILE_SIZE = Number(process.env.VERIFICATION_FILE_MAX_BYTES || 5 * 1024 * 1024);
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'application/pdf'
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 8 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('Only JPG, PNG, WEBP, HEIC, HEIF and PDF documents are allowed.'));
    }
    cb(null, true);
  }
});

function bitBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (Buffer.isBuffer(value)) return value.length > 0 && value[0] === 1;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'object' && Array.isArray(value.data)) return value.data.length > 0 && Number(value.data[0]) === 1;
  const v = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on', 'active', 'enabled', 'visible'].includes(v);
}
function cleanText(value, fallback = '') {
  return String(value ?? fallback).trim();
}
function toJson(value) {
  try { return JSON.stringify(value || {}); } catch (_) { return '{}'; }
}
async function safeExec(sql, params = {}) {
  try { return await exec(sql, params); }
  catch (error) { console.error('FEATURE-UPGRADE EXEC FAILED:', error.message); return { insertId: null, affectedRows: 0 }; }
}
async function safeMany(sql, params = {}) {
  try { return await many(sql, params); }
  catch (error) { console.error('FEATURE-UPGRADE QUERY FAILED:', error.message); return []; }
}
async function safeOne(sql, params = {}) {
  try { return await one(sql, params); }
  catch (error) { console.error('FEATURE-UPGRADE QUERY FAILED:', error.message); return null; }
}

async function ensureVerificationTables() {
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
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
  )`);
  await exec(`CREATE TABLE IF NOT EXISTS app_verification_documents (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    request_id BIGINT NOT NULL,
    document_type VARCHAR(80) NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(120) NOT NULL,
    file_size BIGINT NOT NULL,
    file_blob LONGBLOB NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    INDEX idx_app_verification_documents_request (request_id)
  )`);
}

async function ensureCategoryColumns() {
  await exec(`CREATE TABLE IF NOT EXISTS food_categories (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(160) NULL,
    name VARCHAR(160) NULL,
    slug VARCHAR(200) NULL,
    description TEXT NULL,
    image_url TEXT NULL,
    image TEXT NULL,
    icon TEXT NULL,
    enabled BIT(1) NOT NULL DEFAULT b'1',
    active BIT(1) NOT NULL DEFAULT b'1',
    deleted BIT(1) NOT NULL DEFAULT b'0',
    show_on_home BIT(1) NOT NULL DEFAULT b'1',
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
  )`);
  const alters = [
    `ALTER TABLE food_categories ADD COLUMN name VARCHAR(160) NULL`,
    `ALTER TABLE food_categories ADD COLUMN title VARCHAR(160) NULL`,
    `ALTER TABLE food_categories ADD COLUMN slug VARCHAR(200) NULL`,
    `ALTER TABLE food_categories ADD COLUMN description TEXT NULL`,
    `ALTER TABLE food_categories ADD COLUMN image_url TEXT NULL`,
    `ALTER TABLE food_categories ADD COLUMN image TEXT NULL`,
    `ALTER TABLE food_categories ADD COLUMN icon TEXT NULL`,
    `ALTER TABLE food_categories ADD COLUMN enabled BIT(1) NOT NULL DEFAULT b'1'`,
    `ALTER TABLE food_categories ADD COLUMN active BIT(1) NOT NULL DEFAULT b'1'`,
    `ALTER TABLE food_categories ADD COLUMN deleted BIT(1) NOT NULL DEFAULT b'0'`,
    `ALTER TABLE food_categories ADD COLUMN show_on_home BIT(1) NOT NULL DEFAULT b'1'`,
    `ALTER TABLE food_categories ADD COLUMN sort_order INT NOT NULL DEFAULT 0`,
    `ALTER TABLE food_categories ADD COLUMN created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)`,
    `ALTER TABLE food_categories ADD COLUMN updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)`
  ];
  for (const sql of alters) await safeExec(sql);
}

async function ensureStoryTables() {
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

async function ensurePaymentReadColumns() {
  await safeExec(`ALTER TABLE payment_transactions ADD COLUMN restaurant_id BIGINT NULL`);
  await safeExec(`ALTER TABLE payment_transactions ADD COLUMN seller_id BIGINT NULL`);
  await safeExec(`ALTER TABLE payment_transactions ADD COLUMN receipt_number VARCHAR(80) NULL`);
}

async function ensureAll() {
  await ensureVerificationTables();
  await ensureCategoryColumns();
  await ensureStoryTables();
  await ensurePaymentReadColumns();
}

function mapCategory(row = {}) {
  const name = row.name || row.title || 'Category';
  return {
    ...row,
    name,
    title: row.title || name,
    slug: row.slug || slugify(name),
    imageUrl: row.imageUrl || row.image_url || row.image || row.icon || '',
    active: bitBool(row.active, bitBool(row.enabled, true)) && !bitBool(row.deleted, false),
    enabled: bitBool(row.enabled, true),
    showOnHome: bitBool(row.show_on_home, true),
    sortOrder: row.sort_order || 0,
  };
}
function mapStory(row = {}) {
  return {
    ...row,
    mediaUrl: row.media_url || row.mediaUrl || '',
    thumbnailUrl: row.thumbnail_url || row.thumbnailUrl || row.media_url || '',
    actionType: row.action_type || row.actionType || '',
    actionValue: row.action_value || row.actionValue || '',
    active: bitBool(row.active, true),
    sortOrder: row.sort_order || 0,
  };
}

function parsePayload(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch (_) { return {}; }
}
function pickPayload(payload, keys, fallback = '') {
  for (const key of keys) {
    const value = payload?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return fallback;
}
function absoluteUrl(req, path) {
  const base = `${req.protocol}://${req.get('host')}`;
  return `${base}${path}`;
}
async function verificationWithDocs(row, req = null) {
  if (!row) return null;
  const payload = parsePayload(row.submitted_payload || row.submittedPayload);
  const docs = await safeMany(`SELECT id, request_id requestId, document_type documentType, original_name originalName,
      mime_type mimeType, file_size fileSize, created_at createdAt
    FROM app_verification_documents WHERE request_id=:id ORDER BY id`, { id: row.id });
  const documents = docs.map(d => {
    const viewPath = `/api/admin/verifications/${row.id}/documents/${d.id}/view`;
    const downloadPath = `/api/admin/verifications/${row.id}/documents/${d.id}/download`;
    return {
      ...d,
      name: d.originalName || d.documentType || `Document ${d.id}`,
      type: d.documentType || d.mimeType || 'DOCUMENT',
      url: req ? absoluteUrl(req, viewPath) : viewPath,
      fileUrl: req ? absoluteUrl(req, viewPath) : viewPath,
      viewUrl: req ? absoluteUrl(req, viewPath) : viewPath,
      downloadUrl: req ? absoluteUrl(req, downloadPath) : downloadPath,
    };
  });

  const requesterType = String(row.requester_type || row.requesterType || '').toUpperCase();
  const userName = row.userName || row.user_name || '';
  const userMobile = row.userMobile || row.user_mobile || row.mobile || '';
  const userEmail = row.userEmail || row.user_email || '';
  const ownerName = row.owner_name || row.ownerName || '';
  const businessName = row.business_name || row.businessName || '';

  const fullName = pickPayload(payload, ['fullName', 'name', 'applicantName', 'riderName', 'driverName', 'ownerName'], ownerName || userName);
  const mobile = pickPayload(payload, ['mobile', 'phone', 'phoneNumber', 'contactMobile'], row.phone || userMobile);
  const email = pickPayload(payload, ['email'], row.email || userEmail);
  const address = pickPayload(payload, ['address', 'fullAddress', 'residentialAddress', 'staffAddress', 'restaurantAddress', 'businessAddress'], row.notes || '');

  return {
    ...row,
    id: row.id,
    requestId: row.id,
    requesterType,
    entityType: requesterType,
    requestType: requesterType,
    source: requesterType,
    status: row.status || 'PENDING',
    restaurantId: row.restaurant_id || row.restaurantId || null,
    riderId: row.rider_id || row.riderId || null,
    applicantName: fullName || businessName || 'Verification request',
    ownerName: ownerName || fullName,
    fullName,
    riderName: requesterType === 'RIDER' ? fullName : '',
    driverName: requesterType === 'RIDER' ? fullName : '',
    businessName: businessName || pickPayload(payload, ['businessName', 'restaurantName', 'storeName'], row.restaurantName || ''),
    restaurantName: row.restaurantName || row.restaurant_name || pickPayload(payload, ['restaurantName', 'businessName', 'storeName'], businessName),
    mobile,
    contactMobile: mobile,
    phone: mobile,
    email,
    aadhaarNumber: pickPayload(payload, ['aadhaarNumber', 'aadharNumber', 'aadhaarNo', 'aadharNo']),
    panNumber: pickPayload(payload, ['panNumber', 'pan', 'panCardNo']),
    gstin: pickPayload(payload, ['gstin', 'gstNumber', 'gst']),
    fssaiNumber: pickPayload(payload, ['fssaiNumber', 'fssaiLicense', 'fssai']),
    drivingLicenseNumber: pickPayload(payload, ['drivingLicenseNumber', 'drivingLicense', 'licenseNumber', 'dlNumber']),
    vehicleRegistrationNumber: pickPayload(payload, ['vehicleRegistrationNumber', 'vehicleRcNumber', 'vehicleRc', 'vehicleNumber', 'rcNumber']),
    vehicleNumber: pickPayload(payload, ['vehicleNumber', 'vehicleRegistrationNumber', 'vehicleRcNumber', 'rcNumber']),
    address,
    note: row.notes || pickPayload(payload, ['notes', 'note', 'message']),
    rejectionReason: row.rejection_reason || row.rejectionReason || '',
    submittedPayload: payload,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
    documents,
    documentCount: documents.length,
  };
}

async function submitVerification(req, res, type, explicitId = null) {
  await ensureVerificationTables();
  const b = req.body || {};
  const files = req.files || [];
  if (!files.length) return fail(res, 'At least one verification document image/PDF is required.', 400);
  const requesterType = type === 'RIDER' ? 'RIDER' : 'RESTAURANT';
  const restaurantId = requesterType === 'RESTAURANT' ? (explicitId || b.restaurantId || b.restaurant_id || null) : null;
  const riderId = requesterType === 'RIDER' ? (explicitId || b.riderId || b.rider_id || req.user.id) : null;
  const businessName = cleanText(b.businessName || b.restaurantName || b.storeName || b.name);
  const ownerName = cleanText(b.ownerName || b.fullName || b.applicantName || b.driverName || b.riderName || req.user.name);
  const phone = cleanText(b.phone || b.mobile || b.phoneNumber || b.contactMobile);
  const email = cleanText(b.email);
  const notes = cleanText(b.notes || b.message || b.address || b.fullAddress || b.residentialAddress || b.restaurantAddress);
  const existing = await safeOne(`SELECT id FROM app_verification_requests
    WHERE user_id=:uid AND requester_type=:type AND COALESCE(restaurant_id,0)=COALESCE(:restaurantId,0) AND COALESCE(rider_id,0)=COALESCE(:riderId,0)
    ORDER BY id DESC LIMIT 1`, { uid: req.user.id, type: requesterType, restaurantId, riderId });
  let requestId;
  if (existing?.id) {
    requestId = existing.id;
    await exec(`UPDATE app_verification_requests
      SET status='PENDING', business_name=:businessName, owner_name=:ownerName, phone=:phone, email=:email,
          notes=:notes, submitted_payload=:payload, rejection_reason=NULL, updated_at=NOW(6)
      WHERE id=:id`, { id: requestId, businessName, ownerName, phone, email, notes, payload: toJson(b) });
    await safeExec('DELETE FROM app_verification_documents WHERE request_id=:requestId', { requestId });
  } else {
    const r = await exec(`INSERT INTO app_verification_requests
      (user_id, requester_type, restaurant_id, rider_id, status, business_name, owner_name, phone, email, notes, submitted_payload, created_at, updated_at)
      VALUES (:uid,:type,:restaurantId,:riderId,'PENDING',:businessName,:ownerName,:phone,:email,:notes,:payload,NOW(6),NOW(6))`, {
      uid: req.user.id,
      type: requesterType,
      restaurantId,
      riderId,
      businessName,
      ownerName,
      phone,
      email,
      notes,
      payload: toJson(b),
    });
    requestId = r.insertId;
  }
  for (let i = 0; i < files.length; i += 1) {
    const f = files[i];
    await exec(`INSERT INTO app_verification_documents
      (request_id, document_type, original_name, mime_type, file_size, file_blob, created_at)
      VALUES (:requestId,:documentType,:originalName,:mimeType,:fileSize,:fileBlob,NOW(6))`, {
      requestId,
      documentType: cleanText(b.documentType || b[`documentType${i}`] || f.fieldname || 'DOCUMENT'),
      originalName: cleanText(f.originalname || `document-${i + 1}`),
      mimeType: f.mimetype,
      fileSize: f.size,
      fileBlob: f.buffer,
    });
  }
  await safeExec(`INSERT INTO notifications(role,title,message,type,is_read,created_at)
    VALUES('ADMIN',:title,:message,'VERIFICATION_REQUEST',0,NOW())`, {
    title: `${requesterType} verification request`,
    message: `${requesterType} verification request submitted by user #${req.user.id}`,
  });
  ok(res, await verificationWithDocs(await one('SELECT * FROM app_verification_requests WHERE id=:id', { id: requestId }), req), 'Verification request submitted', 201);
}

// Verification submit routes. Keep these before old compatibility placeholders.
router.post('/seller/verification/restaurant/:restaurantId', requireAuth, upload.any(), ah((req, res) => submitVerification(req, res, 'RESTAURANT', req.params.restaurantId)));
router.post('/seller/verification/restaurant', requireAuth, upload.any(), ah((req, res) => submitVerification(req, res, 'RESTAURANT')));
router.post('/restaurant/verification/:restaurantId', requireAuth, upload.any(), ah((req, res) => submitVerification(req, res, 'RESTAURANT', req.params.restaurantId)));
router.post('/restaurants/:restaurantId/verification', requireAuth, upload.any(), ah((req, res) => submitVerification(req, res, 'RESTAURANT', req.params.restaurantId)));
router.post('/rider/verification/:riderId', requireAuth, upload.any(), ah((req, res) => submitVerification(req, res, 'RIDER', req.params.riderId)));
router.post('/rider/verification', requireAuth, upload.any(), ah((req, res) => submitVerification(req, res, 'RIDER')));
router.post('/delivery/verification', requireAuth, upload.any(), ah((req, res) => submitVerification(req, res, 'RIDER')));

router.get('/seller/verification/status', requireAuth, ah(async (req, res) => {
  await ensureVerificationTables();
  const row = await safeOne('SELECT * FROM app_verification_requests WHERE user_id=:uid AND requester_type="RESTAURANT" ORDER BY id DESC LIMIT 1', { uid: req.user.id });
  ok(res, row ? await verificationWithDocs(row, req) : { status: 'NOT_SUBMITTED' });
}));
router.get(['/rider/verification/:riderId', '/rider/verification'], requireAuth, ah(async (req, res) => {
  await ensureVerificationTables();
  const row = await safeOne('SELECT * FROM app_verification_requests WHERE user_id=:uid AND requester_type="RIDER" ORDER BY id DESC LIMIT 1', { uid: req.user.id });
  ok(res, row ? await verificationWithDocs(row, req) : { status: 'NOT_SUBMITTED' });
}));

// Admin verification queue and document viewing.
router.get(['/admin/verifications', '/admin/verification-requests', '/admin/verifications/all', '/admin/service-area-verifications'], requireAuth, ah(async (req, res) => {
  await ensureVerificationTables();
  const wantedStatus = cleanText(req.query.status).toUpperCase();
  const wantedType = cleanText(req.query.targetType || req.query.target_type || req.query.type).toUpperCase();
  const rows = await safeMany(`SELECT vr.*, u.name userName, u.email userEmail, u.mobile userMobile, u.phone userPhone,
      r.name restaurantName, r.slug restaurantSlug
    FROM app_verification_requests vr
    INNER JOIN (
      SELECT MAX(id) id
      FROM app_verification_requests
      GROUP BY COALESCE(user_id,0), requester_type, COALESCE(restaurant_id,0), COALESCE(rider_id,0)
    ) latest ON latest.id=vr.id
    LEFT JOIN users u ON u.id=vr.user_id
    LEFT JOIN restaurants r ON r.id=vr.restaurant_id
    WHERE (:status='' OR UPPER(vr.status)=:status)
      AND (:type='' OR UPPER(vr.requester_type)=:type OR (:type='DRIVER' AND UPPER(vr.requester_type)='RIDER'))
    ORDER BY vr.id DESC LIMIT 300`, { status: wantedStatus, type: wantedType });
  const items = await Promise.all(rows.map(row => verificationWithDocs(row, req)));
  ok(res, { items, requests: items, verifications: items, total: items.length });
}));
router.get('/admin/verifications/:id', requireAuth, ah(async (req, res) => {
  await ensureVerificationTables();
  const row = await safeOne(`SELECT vr.*, u.name userName, u.email userEmail, u.mobile userMobile,
      r.name restaurantName, r.slug restaurantSlug
    FROM app_verification_requests vr
    LEFT JOIN users u ON u.id=vr.user_id
    LEFT JOIN restaurants r ON r.id=vr.restaurant_id
    WHERE vr.id=:id`, { id: req.params.id });
  if (!row) return fail(res, 'Verification request not found', 404);
  ok(res, await verificationWithDocs(row, req));
}));
async function streamVerificationDocument(req, res, disposition) {
  await ensureVerificationTables();
  const doc = await one('SELECT * FROM app_verification_documents WHERE id=:docId AND request_id=:requestId', { docId: req.params.documentId || req.params.docId, requestId: req.params.id || req.params.requestId });
  if (!doc) return fail(res, 'Document not found', 404);
  res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
  res.setHeader('Content-Length', doc.file_size || doc.file_blob.length);
  res.setHeader('Content-Disposition', `${disposition}; filename="${String(doc.original_name || 'document').replace(/"/g, '')}"`);
  return res.end(doc.file_blob);
}
router.get('/admin/verifications/:id/documents/:documentId/view', ah((req, res) => streamVerificationDocument(req, res, 'inline')));
router.get('/admin/verifications/:id/documents/:documentId/download', ah((req, res) => streamVerificationDocument(req, res, 'attachment')));
router.get('/admin/verification-documents/:requestId/:docId', ah((req, res) => streamVerificationDocument(req, res, 'inline')));
async function setVerificationStatus(req, res, status) {
  await ensureVerificationTables();
  const reason = cleanText(req.body?.reason || req.body?.message || req.body?.rejectionReason);
  const row = await safeOne('SELECT * FROM app_verification_requests WHERE id=:id', { id: req.params.id });
  if (!row) return fail(res, 'Verification request not found', 404);
  await exec(`UPDATE app_verification_requests SET status=:status, rejection_reason=:reason, admin_id=:adminId, updated_at=NOW(6) WHERE id=:id`, { id: row.id, status, reason, adminId: req.user.id });
  if (row.requester_type === 'RESTAURANT' && row.restaurant_id) {
    await safeExec('UPDATE restaurants SET verification_status=:status, verified=:verified, updated_at=NOW(6) WHERE id=:id', { id: row.restaurant_id, status: status === 'APPROVED' ? 'APPROVED' : 'REJECTED', verified: status === 'APPROVED' ? 1 : 0 });
  }
  if (row.requester_type === 'RIDER') {
    await safeExec('UPDATE delivery_partner_profiles SET verification_status=:status, verified=:verified, updated_at=NOW(6) WHERE user_id=:id OR id=:rid', { id: row.user_id, rid: row.rider_id || row.user_id, status: status === 'APPROVED' ? 'APPROVED' : 'REJECTED', verified: status === 'APPROVED' ? 1 : 0 });
    if (status === 'APPROVED') await safeExec('UPDATE users SET enabled=1, blocked=0 WHERE id=:id', { id: row.user_id });
  }
  ok(res, await verificationWithDocs(await one('SELECT * FROM app_verification_requests WHERE id=:id', { id: row.id }), req), `Verification ${status.toLowerCase()}`);
}
router.post('/admin/verifications/:id/approve', requireAuth, ah((req, res) => setVerificationStatus(req, res, 'APPROVED')));
router.post('/admin/verifications/:id/reject', requireAuth, ah((req, res) => setVerificationStatus(req, res, 'REJECTED')));
router.patch('/admin/verifications/:id/status', requireAuth, ah((req, res) => setVerificationStatus(req, res, String(req.body.status || 'PENDING').toUpperCase())));

// Admin category CRUD. Public /categories already reads food_categories, so user app receives these exact rows.
router.get('/admin/categories', requireAuth, ah(async (req, res) => {
  await ensureCategoryColumns();
  const rows = await safeMany('SELECT * FROM food_categories WHERE COALESCE(deleted,0)=0 ORDER BY sort_order,id');
  ok(res, rows.map(mapCategory));
}));
router.post(['/admin/categories', '/admin/food-categories'], requireAuth, upload.single('file'), ah(async (req, res) => {
  await ensureCategoryColumns();
  const b = req.body || {};
  const name = cleanText(b.name || b.title);
  if (!name) return fail(res, 'Category name is required.', 400);
  const imageUrl = cleanText(b.imageUrl || b.image_url || b.image || b.icon || (req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : ''));
  const slug = slugify(b.slug || name);
  const r = await exec(`INSERT INTO food_categories
    (name,title,slug,description,image_url,image,icon,enabled,active,deleted,show_on_home,sort_order,created_at,updated_at)
    VALUES(:name,:title,:slug,:description,:imageUrl,:imageUrl,:imageUrl,:enabled,:enabled,0,:showOnHome,:sortOrder,NOW(6),NOW(6))`, {
    name, title: cleanText(b.title || name), slug, description: cleanText(b.description), imageUrl,
    enabled: bitBool(b.enabled ?? b.active, true) ? 1 : 0,
    showOnHome: bitBool(b.showOnHome ?? b.show_on_home, true) ? 1 : 0,
    sortOrder: Number(b.sortOrder ?? b.sort_order ?? 0) || 0,
  });
  ok(res, mapCategory(await one('SELECT * FROM food_categories WHERE id=:id', { id: r.insertId })), 'Category created', 201);
}));
router.put(['/admin/categories/:id', '/admin/food-categories/:id'], requireAuth, upload.single('file'), ah(async (req, res) => {
  await ensureCategoryColumns();
  const b = req.body || {};
  const current = await safeOne('SELECT * FROM food_categories WHERE id=:id', { id: req.params.id });
  if (!current) return fail(res, 'Category not found', 404);
  const name = cleanText(b.name || b.title || current.name || current.title);
  const imageUrl = cleanText(b.imageUrl || b.image_url || b.image || b.icon || (req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : (current.image_url || current.image || current.icon || '')));
  await exec(`UPDATE food_categories SET name=:name,title=:title,slug=:slug,description=:description,image_url=:imageUrl,image=:imageUrl,icon=:imageUrl,
    enabled=:enabled,active=:enabled,show_on_home=:showOnHome,sort_order=:sortOrder,updated_at=NOW(6) WHERE id=:id`, {
    id: req.params.id, name, title: cleanText(b.title || name), slug: slugify(b.slug || current.slug || name), description: cleanText(b.description ?? current.description), imageUrl,
    enabled: bitBool(b.enabled ?? b.active, bitBool(current.enabled, true)) ? 1 : 0,
    showOnHome: bitBool(b.showOnHome ?? b.show_on_home, bitBool(current.show_on_home, true)) ? 1 : 0,
    sortOrder: Number(b.sortOrder ?? b.sort_order ?? current.sort_order ?? 0) || 0,
  });
  ok(res, mapCategory(await one('SELECT * FROM food_categories WHERE id=:id', { id: req.params.id })), 'Category updated');
}));
router.put(['/admin/categories/:id/status', '/admin/food-categories/:id/status'], requireAuth, ah(async (req, res) => {
  await ensureCategoryColumns();
  const enabled = bitBool(req.body.enabled ?? req.body.active ?? req.body.status === 'ACTIVE', true) ? 1 : 0;
  await exec('UPDATE food_categories SET enabled=:enabled, active=:enabled, updated_at=NOW(6) WHERE id=:id', { id: req.params.id, enabled });
  ok(res, mapCategory(await one('SELECT * FROM food_categories WHERE id=:id', { id: req.params.id })), 'Category status updated');
}));
router.patch(['/admin/categories/:id/status', '/admin/food-categories/:id/status'], requireAuth, ah(async (req, res) => {
  req.body.enabled = req.body.enabled ?? req.body.active ?? req.body.status === 'ACTIVE';
  const enabled = bitBool(req.body.enabled, true) ? 1 : 0;
  await ensureCategoryColumns();
  await exec('UPDATE food_categories SET enabled=:enabled, active=:enabled, updated_at=NOW(6) WHERE id=:id', { id: req.params.id, enabled });
  ok(res, mapCategory(await one('SELECT * FROM food_categories WHERE id=:id', { id: req.params.id })), 'Category status updated');
}));
router.delete(['/admin/categories/:id', '/admin/food-categories/:id'], requireAuth, ah(async (req, res) => {
  await ensureCategoryColumns();
  await exec('UPDATE food_categories SET deleted=1, enabled=0, active=0, updated_at=NOW(6) WHERE id=:id', { id: req.params.id });
  ok(res, null, 'Category deleted');
}));

// Bite stories. Admin controls; user app reads exact active stories.
router.get(['/stories', '/bite-stories', '/user/stories'], ah(async (req, res) => {
  await ensureStoryTables();
  const rows = await safeMany(`SELECT * FROM bite_stories WHERE COALESCE(active,1)=1
    AND (starts_at IS NULL OR starts_at<=NOW(6)) AND (ends_at IS NULL OR ends_at>=NOW(6))
    ORDER BY sort_order,id DESC LIMIT 100`);
  ok(res, rows.map(mapStory));
}));
router.get('/admin/stories', requireAuth, ah(async (req, res) => {
  await ensureStoryTables();
  ok(res, (await safeMany('SELECT * FROM bite_stories ORDER BY sort_order,id DESC LIMIT 200')).map(mapStory));
}));
router.post('/admin/stories', requireAuth, upload.single('file'), ah(async (req, res) => {
  await ensureStoryTables();
  const b = req.body || {};
  const title = cleanText(b.title);
  if (!title) return fail(res, 'Story title is required.', 400);
  const mediaUrl = cleanText(b.mediaUrl || b.media_url || b.imageUrl || b.image_url || (req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : ''));
  const r = await exec(`INSERT INTO bite_stories
    (title,subtitle,description,media_url,thumbnail_url,action_type,action_value,sort_order,active,starts_at,ends_at,created_by,created_at,updated_at)
    VALUES(:title,:subtitle,:description,:mediaUrl,:thumbnailUrl,:actionType,:actionValue,:sortOrder,:active,:startsAt,:endsAt,:uid,NOW(6),NOW(6))`, {
    title, subtitle: cleanText(b.subtitle), description: cleanText(b.description), mediaUrl,
    thumbnailUrl: cleanText(b.thumbnailUrl || b.thumbnail_url || mediaUrl), actionType: cleanText(b.actionType || b.action_type), actionValue: cleanText(b.actionValue || b.action_value),
    sortOrder: Number(b.sortOrder ?? b.sort_order ?? 0) || 0, active: bitBool(b.active, true) ? 1 : 0,
    startsAt: b.startsAt || b.starts_at || null, endsAt: b.endsAt || b.ends_at || null, uid: req.user.id,
  });
  ok(res, mapStory(await one('SELECT * FROM bite_stories WHERE id=:id', { id: r.insertId })), 'Story created', 201);
}));
router.put('/admin/stories/:id', requireAuth, upload.single('file'), ah(async (req, res) => {
  await ensureStoryTables();
  const b = req.body || {};
  const current = await safeOne('SELECT * FROM bite_stories WHERE id=:id', { id: req.params.id });
  if (!current) return fail(res, 'Story not found', 404);
  const mediaUrl = cleanText(b.mediaUrl || b.media_url || b.imageUrl || b.image_url || (req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : current.media_url));
  await exec(`UPDATE bite_stories SET title=:title,subtitle=:subtitle,description=:description,media_url=:mediaUrl,thumbnail_url=:thumbnailUrl,
    action_type=:actionType,action_value=:actionValue,sort_order=:sortOrder,active=:active,starts_at=:startsAt,ends_at=:endsAt,updated_at=NOW(6) WHERE id=:id`, {
    id: req.params.id, title: cleanText(b.title || current.title), subtitle: cleanText(b.subtitle ?? current.subtitle), description: cleanText(b.description ?? current.description), mediaUrl,
    thumbnailUrl: cleanText(b.thumbnailUrl || b.thumbnail_url || mediaUrl || current.thumbnail_url), actionType: cleanText(b.actionType || b.action_type || current.action_type), actionValue: cleanText(b.actionValue || b.action_value || current.action_value),
    sortOrder: Number(b.sortOrder ?? b.sort_order ?? current.sort_order ?? 0) || 0, active: bitBool(b.active, bitBool(current.active, true)) ? 1 : 0,
    startsAt: b.startsAt || b.starts_at || current.starts_at || null, endsAt: b.endsAt || b.ends_at || current.ends_at || null,
  });
  ok(res, mapStory(await one('SELECT * FROM bite_stories WHERE id=:id', { id: req.params.id })), 'Story updated');
}));
router.patch('/admin/stories/:id/status', requireAuth, ah(async (req, res) => {
  await ensureStoryTables();
  const active = bitBool(req.body.active ?? req.body.enabled ?? req.body.status === 'ACTIVE', true) ? 1 : 0;
  await exec('UPDATE bite_stories SET active=:active, updated_at=NOW(6) WHERE id=:id', { id: req.params.id, active });
  ok(res, mapStory(await one('SELECT * FROM bite_stories WHERE id=:id', { id: req.params.id })), 'Story status updated');
}));
router.delete('/admin/stories/:id', requireAuth, ah(async (req, res) => {
  await ensureStoryTables();
  await exec('UPDATE bite_stories SET active=0, updated_at=NOW(6) WHERE id=:id', { id: req.params.id });
  ok(res, null, 'Story deleted');
}));

async function transactionRows(whereSql = '', params = {}) {
  await ensurePaymentReadColumns();
  return safeMany(`SELECT pt.id, pt.order_id orderId, pt.user_id customerId,
      COALESCE(pt.restaurant_id, o.restaurant_id, ga.restaurant_id) restaurantId,
      COALESCE(pt.seller_id, r.owner_id, ga.seller_id) sellerId,
      pt.provider, pt.provider_order_id razorpayOrderId, pt.provider_payment_id razorpayPaymentId,
      pt.amount, pt.currency, pt.status, pt.created_at createdAt, pt.paid_at paidAt,
      o.order_number orderNumber, o.slug orderSlug, o.payment_type paymentType, o.payment_status paymentStatus,
      u.name customerName, u.email customerEmail, u.mobile customerMobile,
      r.name restaurantName, s.name sellerName,
      pt.provider_response providerResponse
    FROM payment_transactions pt
    LEFT JOIN orders o ON o.id=pt.order_id
    LEFT JOIN users u ON u.id=COALESCE(pt.user_id,o.user_id)
    LEFT JOIN restaurants r ON r.id=COALESCE(pt.restaurant_id,o.restaurant_id)
    LEFT JOIN users s ON s.id=COALESCE(pt.seller_id,r.owner_id)
    LEFT JOIN payment_gateway_audit_logs ga ON ga.provider_order_id=pt.provider_order_id
    ${whereSql}
    GROUP BY pt.id
    ORDER BY pt.id DESC LIMIT 500`, params);
}
async function transactionDetail(id, userId = null) {
  const where = userId ? 'WHERE pt.id=:id AND (pt.user_id=:userId OR o.user_id=:userId)' : 'WHERE pt.id=:id';
  const rows = await transactionRows(where, { id, userId });
  return rows[0] || null;
}
function receiptNumber(tx) { return `MBR-RCPT-${String(tx.id || '0').padStart(6, '0')}`; }
function receiptLines(tx) {
  return [
    'MR BREADO ONLINE PAYMENT RECEIPT',
    `Receipt No: ${receiptNumber(tx)}`,
    `Transaction ID: ${tx.id}`,
    `Order ID: ${tx.orderId || tx.orderNumber || tx.orderSlug || '-'}`,
    `Razorpay Order ID: ${tx.razorpayOrderId || '-'}`,
    `Razorpay Payment ID: ${tx.razorpayPaymentId || '-'}`,
    `Customer ID: ${tx.customerId || '-'}`,
    `Customer: ${tx.customerName || '-'}`,
    `Seller ID: ${tx.sellerId || '-'}`,
    `Seller: ${tx.sellerName || '-'}`,
    `Restaurant ID: ${tx.restaurantId || '-'}`,
    `Restaurant: ${tx.restaurantName || '-'}`,
    `Amount: ${tx.currency || 'INR'} ${Number(tx.amount || 0).toFixed(2)}`,
    `Status: ${tx.status || '-'}`,
    `Paid At: ${tx.paidAt || tx.createdAt || '-'}`,
  ];
}
function pdfEscape(text) { return String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
function makeSimplePdf(lines) {
  const content = ['BT', '/F1 12 Tf', '50 790 Td', ...lines.map((line, idx) => `${idx ? '0 -18 Td ' : ''}(${pdfEscape(line)}) Tj`), 'ET'].join('\n');
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    `5 0 obj << /Length ${Buffer.byteLength(content)} >> stream\n${content}\nendstream endobj`,
  ];
  let pdf = '%PDF-1.4\n';
  const xref = [0];
  for (const obj of objects) { xref.push(Buffer.byteLength(pdf)); pdf += obj + '\n'; }
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < xref.length; i += 1) pdf += String(xref[i]).padStart(10, '0') + ' 00000 n \n';
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(pdf);
}
async function sendReceipt(req, res, userScoped = false) {
  const tx = await transactionDetail(req.params.id, userScoped ? req.user.id : null);
  if (!tx) return fail(res, 'Online transaction receipt not found.', 404);
  if (String(tx.status).toUpperCase() !== 'SUCCESS') return fail(res, 'Receipt is available only after successful online payment.', 400);
  const lines = receiptLines(tx);
  if (req.path.endsWith('.pdf')) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${receiptNumber(tx)}.pdf"`);
    return res.end(makeSimplePdf(lines));
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.end(`<!doctype html><html><head><title>${receiptNumber(tx)}</title></head><body><pre>${lines.map(l => String(l).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))).join('\n')}</pre></body></html>`);
}

router.get(['/admin/online-transactions', '/admin/payments', '/admin/payment-transactions'], requireAuth, ah(async (req, res) => ok(res, await transactionRows('WHERE UPPER(pt.provider)=\'RAZORPAY\' AND UPPER(COALESCE(o.payment_type,\'ONLINE\'))=\'ONLINE\''))));
router.get(['/admin/online-transactions/:id', '/admin/payments/:id'], requireAuth, ah(async (req, res) => {
  const tx = await transactionDetail(req.params.id);
  if (!tx) return fail(res, 'Transaction not found', 404);
  ok(res, { ...tx, receiptNumber: receiptNumber(tx), receiptUrl: `/api/admin/online-transactions/${tx.id}/receipt`, receiptPdfUrl: `/api/admin/online-transactions/${tx.id}/receipt.pdf` });
}));
router.get('/admin/online-transactions/:id/receipt', requireAuth, ah((req, res) => sendReceipt(req, res, false)));
router.get('/admin/online-transactions/:id/receipt.pdf', requireAuth, ah((req, res) => sendReceipt(req, res, false)));
router.get('/user/payments/:id/receipt', requireAuth, ah((req, res) => sendReceipt(req, res, true)));
router.get('/user/payments/:id/receipt.pdf', requireAuth, ah((req, res) => sendReceipt(req, res, true)));
router.get('/user/orders/:id/transaction-receipt.pdf', requireAuth, ah(async (req, res) => {
  const tx = await safeOne(`SELECT pt.id FROM payment_transactions pt LEFT JOIN orders o ON o.id=pt.order_id WHERE (o.id=:id OR o.slug=:id OR o.order_number=:id) AND o.user_id=:uid AND UPPER(pt.status)='SUCCESS' ORDER BY pt.id DESC LIMIT 1`, { id: req.params.id, uid: req.user.id });
  if (!tx) return fail(res, 'Receipt is available only for successful online payment.', 404);
  req.params.id = tx.id;
  return sendReceipt(req, res, true);
}));

// Lightweight boot/migration endpoint for Render verification.
router.get('/feature-version', ah(async (req, res) => {
  await ensureAll();
  ok(res, { version: 'feature-upgrade-v15-verification-fix', modules: ['verification-documents', 'admin-categories', 'online-transaction-receipts', 'bite-stories'] });
}));

module.exports = router;
