const crypto = require('crypto');
const { one, many, exec } = require('../utils/db');
const { razorpay, jwtSecret } = require('../config/env');

function bitBool(value, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  if (Buffer.isBuffer(value)) return value.length > 0 && value[0] === 1;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return ['1', 'true', 'yes', 'active', 'enabled', 'on', 'live', 'test'].includes(v);
  }
  if (typeof value === 'object' && Array.isArray(value.data)) return value.data.length > 0 && Number(value.data[0]) === 1;
  return Boolean(value);
}

function numberValue(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function encryptionKey() {
  return crypto.createHash('sha256').update(String(jwtSecret || 'mr-breado-dev-secret')).digest();
}

function encryptSecret(secret) {
  if (!secret || !String(secret).trim()) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(secret).trim(), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(value) {
  if (!value || !String(value).trim()) return '';
  const text = String(value).trim();
  if (!text.startsWith('v1:')) return text; // backward compatibility with older plain/base64 storage
  try {
    const [, ivB64, tagB64, encB64] = text.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]).toString('utf8');
  } catch (error) {
    console.error('RAZORPAY SECRET DECRYPT FAILED:', error.message);
    return '';
  }
}

function normalizeMode(mode) {
  return String(mode || 'TEST').toUpperCase() === 'LIVE' ? 'LIVE' : 'TEST';
}

function normalizeKeyId(value) {
  return String(value || '').trim();
}

async function ensurePaymentTables() {
  await exec(`CREATE TABLE IF NOT EXISTS payment_settings (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    cod_enabled BIT(1) NOT NULL DEFAULT b'1',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    online_payment_enabled BIT(1) NOT NULL DEFAULT b'0',
    razorpay_key_id VARCHAR(255) NULL,
    razorpay_key_secret_encrypted TEXT NULL,
    razorpay_mode VARCHAR(20) NOT NULL DEFAULT 'TEST',
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_by BIGINT NULL
  )`);

  await exec(`CREATE TABLE IF NOT EXISTS platform_settings (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    business_address TEXT NULL,
    business_latitude DECIMAL(10,7) NULL,
    business_longitude DECIMAL(10,7) NULL,
    cod_enabled BIT(1) NOT NULL DEFAULT b'1',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    delivery_charge_per_km DECIMAL(10,2) NOT NULL DEFAULT 8.00,
    maximum_delivery_charge DECIMAL(10,2) NOT NULL DEFAULT 120.00,
    minimum_delivery_charge DECIMAL(10,2) NOT NULL DEFAULT 25.00,
    mr_breado_takeaway_enabled BIT(1) NOT NULL DEFAULT b'1',
    online_payment_enabled BIT(1) NOT NULL DEFAULT b'0',
    razorpay_key_id VARCHAR(120) NULL,
    razorpay_key_secret_encrypted TEXT NULL,
    razorpay_mode VARCHAR(20) NOT NULL DEFAULT 'TEST',
    support_email VARCHAR(120) NULL,
    support_phone VARCHAR(20) NULL,
    takeaway_booking_fee_percent DECIMAL(5,2) NOT NULL DEFAULT 20.00,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_by BIGINT NULL,
    rider_delivery_pay_per_km DECIMAL(10,2) NOT NULL DEFAULT 6.00,
    minimum_rider_delivery_pay DECIMAL(10,2) NOT NULL DEFAULT 20.00,
    google_distance_enabled BIT(1) NOT NULL DEFAULT b'0',
    google_maps_api_key_encrypted TEXT NULL
  )`);

  await exec(`CREATE TABLE IF NOT EXISTS payment_transactions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    failed_at DATETIME(6) NULL,
    failure_reason VARCHAR(600) NULL,
    paid_at DATETIME(6) NULL,
    provider VARCHAR(40) NOT NULL DEFAULT 'RAZORPAY',
    provider_order_id VARCHAR(120) NULL,
    provider_payment_id VARCHAR(120) NULL,
    provider_response LONGTEXT NULL,
    provider_signature VARCHAR(500) NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'CREATED',
    updated_at DATETIME(6) NULL,
    order_id BIGINT NULL,
    user_id BIGINT NULL
  )`);
  await exec(`CREATE TABLE IF NOT EXISTS payment_settings_history (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    payment_settings_id BIGINT NULL,
    cod_enabled BIT(1) NOT NULL DEFAULT b'1',
    online_payment_enabled BIT(1) NOT NULL DEFAULT b'0',
    razorpay_key_id VARCHAR(255) NULL,
    razorpay_mode VARCHAR(20) NOT NULL DEFAULT 'TEST',
    secret_changed BIT(1) NOT NULL DEFAULT b'0',
    changed_by BIGINT NULL,
    change_note VARCHAR(500) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
  )`);

  await exec(`CREATE TABLE IF NOT EXISTS payment_gateway_audit_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    provider VARCHAR(40) NOT NULL DEFAULT 'RAZORPAY',
    action VARCHAR(80) NOT NULL,
    user_id BIGINT NULL,
    order_id BIGINT NULL,
    restaurant_id BIGINT NULL,
    seller_id BIGINT NULL,
    payment_transaction_id BIGINT NULL,
    provider_order_id VARCHAR(120) NULL,
    provider_payment_id VARCHAR(120) NULL,
    amount DECIMAL(12,2) NULL,
    status VARCHAR(40) NULL,
    message VARCHAR(700) NULL,
    raw_payload LONGTEXT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
  )`);
}

async function activeSettings() {
  await ensurePaymentTables();
  let payment = await one('SELECT * FROM payment_settings ORDER BY id DESC LIMIT 1');
  let platform = await one('SELECT * FROM platform_settings ORDER BY id DESC LIMIT 1');

  if (!payment) {
    const encrypted = razorpay.keySecret ? encryptSecret(razorpay.keySecret) : null;
    const r = await exec(`INSERT INTO payment_settings
      (cod_enabled, online_payment_enabled, razorpay_key_id, razorpay_key_secret_encrypted, razorpay_mode, created_at, updated_at)
      VALUES (:cod, :online, :keyId, :secret, :mode, NOW(6), NOW(6))`, {
      cod: 1,
      online: razorpay.keyId && razorpay.keySecret ? 1 : 0,
      keyId: razorpay.keyId || null,
      secret: encrypted,
      mode: process.env.RAZORPAY_MODE || 'TEST',
    });
    payment = await one('SELECT * FROM payment_settings WHERE id=:id', { id: r.insertId });
  }

  if (!platform) {
    const encrypted = razorpay.keySecret ? encryptSecret(razorpay.keySecret) : null;
    const r = await exec(`INSERT INTO platform_settings
      (cod_enabled, online_payment_enabled, razorpay_key_id, razorpay_key_secret_encrypted, razorpay_mode,
       mr_breado_takeaway_enabled, takeaway_booking_fee_percent, delivery_charge_per_km, minimum_delivery_charge,
       maximum_delivery_charge, rider_delivery_pay_per_km, minimum_rider_delivery_pay, google_distance_enabled, created_at, updated_at)
      VALUES (:cod, :online, :keyId, :secret, :mode, 1, 20, 8, 25, 120, 6, 20, 0, NOW(6), NOW(6))`, {
      cod: bitBool(payment.cod_enabled, true) ? 1 : 0,
      online: bitBool(payment.online_payment_enabled, false) ? 1 : 0,
      keyId: payment.razorpay_key_id || razorpay.keyId || null,
      secret: payment.razorpay_key_secret_encrypted || encrypted,
      mode: payment.razorpay_mode || process.env.RAZORPAY_MODE || 'TEST',
    });
    platform = await one('SELECT * FROM platform_settings WHERE id=:id', { id: r.insertId });
  }

  const keyId = normalizeKeyId(payment?.razorpay_key_id || platform?.razorpay_key_id || razorpay.keyId);
  const secret = decryptSecret(payment?.razorpay_key_secret_encrypted || platform?.razorpay_key_secret_encrypted || '') || razorpay.keySecret || '';
  const mode = normalizeMode(payment?.razorpay_mode || platform?.razorpay_mode || process.env.RAZORPAY_MODE);
  const codEnabled = bitBool(payment?.cod_enabled, bitBool(platform?.cod_enabled, true));
  const onlineRequested = bitBool(payment?.online_payment_enabled, bitBool(platform?.online_payment_enabled, false));
  const configured = Boolean(keyId && secret && keyId.startsWith('rzp_'));

  return { payment, platform, keyId, secret, mode, codEnabled, onlineRequested, onlineEnabled: onlineRequested && configured, configured };
}

function publicPayload(settings) {
  const p = settings.platform || {};
  return {
    codEnabled: settings.codEnabled,
    onlineEnabled: settings.onlineEnabled,
    onlinePaymentEnabled: settings.onlineEnabled,
    razorpayEnabled: settings.onlineEnabled,
    razorpayConfigured: settings.configured,
    razorpaySecretConfigured: Boolean(settings.secret),
    razorpayKeyId: settings.keyId || '',
    razorpayMode: settings.mode,
    currency: 'INR',
    mrBreadoTakeawayEnabled: bitBool(p.mr_breado_takeaway_enabled, true),
    takeawayOnlineRequired: false,
    takeawayBookingFeePercent: numberValue(p.takeaway_booking_fee_percent, 20),
    deliveryChargePerKm: numberValue(p.delivery_charge_per_km, 8),
    minimumDeliveryCharge: numberValue(p.minimum_delivery_charge, 25),
    maximumDeliveryCharge: numberValue(p.maximum_delivery_charge, 120),
    riderDeliveryPayPerKm: numberValue(p.rider_delivery_pay_per_km, 6),
    minimumRiderDeliveryPay: numberValue(p.minimum_rider_delivery_pay, 20),
    googleDistanceEnabled: bitBool(p.google_distance_enabled, false),
    googleMapsApiKeyConfigured: Boolean(p.google_maps_api_key_encrypted),
    supportEmail: p.support_email || '',
    supportPhone: p.support_phone || '',
    businessAddress: p.business_address || '',
    businessLatitude: p.business_latitude,
    businessLongitude: p.business_longitude,
    platformFee: 5,
    deliveryBaseFee: numberValue(p.minimum_delivery_charge, 30),
    autoCancelMinutes: 60,
  };
}

async function getPublicSettings() {
  return publicPayload(await activeSettings());
}

async function getAdminSettings() {
  const settings = await activeSettings();
  return {
    ...publicPayload(settings),
    onlinePaymentRequested: settings.onlineRequested,
    paymentSettingsId: settings.payment?.id || null,
    platformSettingsId: settings.platform?.id || null,
    razorpayKeySecret: '',
    razorpaySecretConfigured: Boolean(settings.secret),
  };
}

async function saveAdminSettings(body = {}, adminUserId = null) {
  await ensurePaymentTables();
  const current = await activeSettings();
  const currentPayment = current.payment || {};
  const currentPlatform = current.platform || {};

  const keyId = normalizeKeyId(body.razorpayKeyId ?? body.razorpay_key_id ?? current.keyId);
  const incomingSecret = String(body.razorpayKeySecret ?? body.razorpay_key_secret ?? '').trim();
  const secretChanged = incomingSecret.length > 0;
  const encryptedSecret = secretChanged ? encryptSecret(incomingSecret) : (currentPayment.razorpay_key_secret_encrypted || currentPlatform.razorpay_key_secret_encrypted || null);
  const mode = normalizeMode(body.razorpayMode ?? body.razorpay_mode ?? current.mode);
  const codEnabled = bitBool(body.codEnabled ?? body.cod_enabled, current.codEnabled);
  const onlineRequested = bitBool(body.onlinePaymentEnabled ?? body.online_payment_enabled ?? body.onlineEnabled, current.onlineRequested);

  if (!codEnabled && !onlineRequested) {
    const err = new Error('At least one payment method must stay enabled.');
    err.status = 400;
    throw err;
  }
  if (onlineRequested && (!keyId || (!secretChanged && !current.secret))) {
    const err = new Error('Razorpay Key ID and Secret Key are required before enabling online payment.');
    err.status = 400;
    throw err;
  }
  if (keyId && !keyId.startsWith('rzp_')) {
    const err = new Error('Invalid Razorpay Key ID. It must start with rzp_test_ or rzp_live_.');
    err.status = 400;
    throw err;
  }

  let paymentId = currentPayment.id;
  if (paymentId) {
    await exec(`UPDATE payment_settings SET
      cod_enabled=:cod, online_payment_enabled=:online, razorpay_key_id=:keyId,
      razorpay_key_secret_encrypted=:secret, razorpay_mode=:mode, updated_by=:updatedBy, updated_at=NOW(6)
      WHERE id=:id`, { id: paymentId, cod: codEnabled ? 1 : 0, online: onlineRequested ? 1 : 0, keyId: keyId || null, secret: encryptedSecret, mode, updatedBy: adminUserId });
  } else {
    const r = await exec(`INSERT INTO payment_settings
      (cod_enabled, online_payment_enabled, razorpay_key_id, razorpay_key_secret_encrypted, razorpay_mode, updated_by, created_at, updated_at)
      VALUES (:cod, :online, :keyId, :secret, :mode, :updatedBy, NOW(6), NOW(6))`, { cod: codEnabled ? 1 : 0, online: onlineRequested ? 1 : 0, keyId: keyId || null, secret: encryptedSecret, mode, updatedBy: adminUserId });
    paymentId = r.insertId;
  }

  let platformId = currentPlatform.id;
  const platformParams = {
    cod: codEnabled ? 1 : 0,
    online: onlineRequested ? 1 : 0,
    keyId: keyId || null,
    secret: encryptedSecret,
    mode,
    takeaway: bitBool(body.mrBreadoTakeawayEnabled ?? body.mr_breado_takeaway_enabled, bitBool(currentPlatform.mr_breado_takeaway_enabled, true)) ? 1 : 0,
    takeawayFee: numberValue(body.takeawayBookingFeePercent ?? body.takeaway_booking_fee_percent, numberValue(currentPlatform.takeaway_booking_fee_percent, 20)),
    deliveryPerKm: numberValue(body.deliveryChargePerKm ?? body.delivery_charge_per_km, numberValue(currentPlatform.delivery_charge_per_km, 8)),
    minDelivery: numberValue(body.minimumDeliveryCharge ?? body.minimum_delivery_charge, numberValue(currentPlatform.minimum_delivery_charge, 25)),
    maxDelivery: numberValue(body.maximumDeliveryCharge ?? body.maximum_delivery_charge, numberValue(currentPlatform.maximum_delivery_charge, 120)),
    riderPerKm: numberValue(body.riderDeliveryPayPerKm ?? body.rider_delivery_pay_per_km, numberValue(currentPlatform.rider_delivery_pay_per_km, 6)),
    minRider: numberValue(body.minimumRiderDeliveryPay ?? body.minimum_rider_delivery_pay, numberValue(currentPlatform.minimum_rider_delivery_pay, 20)),
    supportEmail: body.supportEmail ?? body.support_email ?? currentPlatform.support_email ?? null,
    supportPhone: body.supportPhone ?? body.support_phone ?? currentPlatform.support_phone ?? null,
    businessAddress: body.businessAddress ?? body.business_address ?? currentPlatform.business_address ?? null,
    businessLat: body.businessLatitude ?? body.business_latitude ?? currentPlatform.business_latitude ?? null,
    businessLng: body.businessLongitude ?? body.business_longitude ?? currentPlatform.business_longitude ?? null,
    googleDistance: bitBool(body.googleDistanceEnabled ?? body.google_distance_enabled, bitBool(currentPlatform.google_distance_enabled, false)) ? 1 : 0,
    updatedBy: adminUserId,
  };
  if (platformId) {
    await exec(`UPDATE platform_settings SET
      cod_enabled=:cod, online_payment_enabled=:online, razorpay_key_id=:keyId, razorpay_key_secret_encrypted=:secret,
      razorpay_mode=:mode, mr_breado_takeaway_enabled=:takeaway, takeaway_booking_fee_percent=:takeawayFee,
      delivery_charge_per_km=:deliveryPerKm, minimum_delivery_charge=:minDelivery, maximum_delivery_charge=:maxDelivery,
      rider_delivery_pay_per_km=:riderPerKm, minimum_rider_delivery_pay=:minRider, support_email=:supportEmail,
      support_phone=:supportPhone, business_address=:businessAddress, business_latitude=:businessLat, business_longitude=:businessLng,
      google_distance_enabled=:googleDistance, updated_by=:updatedBy, updated_at=NOW(6)
      WHERE id=:id`, { ...platformParams, id: platformId });
  } else {
    const r = await exec(`INSERT INTO platform_settings
      (cod_enabled, online_payment_enabled, razorpay_key_id, razorpay_key_secret_encrypted, razorpay_mode, mr_breado_takeaway_enabled,
       takeaway_booking_fee_percent, delivery_charge_per_km, minimum_delivery_charge, maximum_delivery_charge, rider_delivery_pay_per_km,
       minimum_rider_delivery_pay, support_email, support_phone, business_address, business_latitude, business_longitude, google_distance_enabled, updated_by, created_at, updated_at)
      VALUES (:cod, :online, :keyId, :secret, :mode, :takeaway, :takeawayFee, :deliveryPerKm, :minDelivery, :maxDelivery,
       :riderPerKm, :minRider, :supportEmail, :supportPhone, :businessAddress, :businessLat, :businessLng, :googleDistance, :updatedBy, NOW(6), NOW(6))`, platformParams);
    platformId = r.insertId;
  }

  await exec(`INSERT INTO payment_settings_history
    (payment_settings_id, cod_enabled, online_payment_enabled, razorpay_key_id, razorpay_mode, secret_changed, changed_by, change_note, created_at)
    VALUES (:paymentId, :cod, :online, :keyId, :mode, :secretChanged, :changedBy, :note, NOW(6))`, {
    paymentId, cod: codEnabled ? 1 : 0, online: onlineRequested ? 1 : 0, keyId: keyId || null, mode, secretChanged: secretChanged ? 1 : 0, changedBy: adminUserId, note: body.changeNote || body.note || 'Admin payment settings update'
  });

  return getAdminSettings();
}

async function history() {
  await ensurePaymentTables();
  return many('SELECT * FROM payment_settings_history ORDER BY id DESC LIMIT 100');
}

async function audit(action, payload = {}) {
  try {
    await ensurePaymentTables();
    await exec(`INSERT INTO payment_gateway_audit_logs
      (provider, action, user_id, order_id, restaurant_id, seller_id, payment_transaction_id, provider_order_id, provider_payment_id, amount, status, message, raw_payload, created_at)
      VALUES ('RAZORPAY', :action, :userId, :orderId, :restaurantId, :sellerId, :txId, :providerOrderId, :providerPaymentId, :amount, :status, :message, :raw, NOW(6))`, {
      action,
      userId: payload.userId || null,
      orderId: payload.orderId || null,
      restaurantId: payload.restaurantId || null,
      sellerId: payload.sellerId || null,
      txId: payload.paymentTransactionId || null,
      providerOrderId: payload.providerOrderId || payload.razorpayOrderId || null,
      providerPaymentId: payload.providerPaymentId || payload.razorpayPaymentId || null,
      amount: payload.amount || null,
      status: payload.status || null,
      message: payload.message || null,
      raw: JSON.stringify(payload.raw || payload),
    });
  } catch (error) {
    console.error('PAYMENT AUDIT LOG FAILED:', error.message);
  }
}

module.exports = {
  bitBool,
  encryptSecret,
  decryptSecret,
  activeSettings,
  getPublicSettings,
  getAdminSettings,
  saveAdminSettings,
  history,
  audit,
};
