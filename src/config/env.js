require('dotenv').config();

function parseJdbcUrl(value) {
  if (!value) return {};
  let raw = value.trim();
  if (raw.startsWith('jdbc:mysql://')) raw = raw.replace('jdbc:mysql://', 'mysql://');
  if (!raw.startsWith('mysql://')) return {};
  try {
    const u = new URL(raw);
    return {
      host: u.hostname,
      port: Number(u.port || 3306),
      database: (u.pathname || '').replace(/^\//, '') || undefined,
      user: decodeURIComponent(u.username || ''),
      password: decodeURIComponent(u.password || ''),
      ssl: /ssl-mode=REQUIRED|useSSL=true|requireSSL=true/i.test(u.search),
    };
  } catch (_) { return {}; }
}
function bool(v, def=false) {
  if (v === undefined || v === null || v === '') return def;
  return ['true','1','yes','y','required'].includes(String(v).toLowerCase());
}
function parseSize(value, fallback='25mb') {
  return value || process.env.MAX_REQUEST_SIZE || fallback;
}
const jdbc = parseJdbcUrl(process.env.DB_URL || process.env.DATABASE_URL || process.env.MYSQL_URL);
const dbName = process.env.DB_NAME || process.env.MYSQL_DATABASE || jdbc.database || 'mr_breado_node';
const sslEnabled = bool(process.env.DB_SSL, jdbc.ssl || /aivencloud\.com/i.test(jdbc.host || process.env.DB_HOST || ''));

module.exports = {
  port: Number(process.env.PORT || process.env.SERVER_PORT || 8080),
  apiPrefix: process.env.API_PREFIX || process.env.SERVER_SERVLET_CONTEXT_PATH || '/api',
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || process.env.PUBLIC_BASE_URL || '*',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
  jwtSecret: process.env.JWT_SECRET || 'dev_only_change_this_secret_for_production_please_64_chars',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || process.env.JWT_EXPIRATION_MS || process.env.JWT_EXPIRATION || '30d',
  limits: {
    json: parseSize(process.env.MAX_REQUEST_SIZE, '25mb'),
    file: process.env.MAX_FILE_SIZE || '20mb',
    imageBytes: Number(process.env.MAX_IMAGE_SIZE_BYTES || 5 * 1024 * 1024),
  },
  db: {
    host: process.env.DB_HOST || jdbc.host || 'localhost',
    port: Number(process.env.DB_PORT || jdbc.port || 3306),
    database: dbName,
    user: process.env.DB_USER || process.env.DB_USERNAME || process.env.MYSQL_USER || jdbc.user || 'root',
    password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || jdbc.password || '',
    ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
  },
  dbName,
  dbSsl: sslEnabled,
  pool: {
    max: Number(process.env.DB_POOL_MAX_SIZE || process.env.DB_POOL_MAX || 10),
    minIdle: Number(process.env.DB_POOL_MIN_IDLE || 0),
  },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
    productFolder: process.env.CLOUDINARY_PRODUCT_FOLDER || 'mr_breado/products',
    restaurantFolder: process.env.CLOUDINARY_RESTAURANT_FOLDER || 'mr_breado/restaurants',
    offerFolder: process.env.CLOUDINARY_OFFER_FOLDER || 'mr_breado/offers',
    userFolder: process.env.CLOUDINARY_USER_FOLDER || 'mr_breado/users',
  },
  redis: {
    host: process.env.REDIS_HOST || '', port: Number(process.env.REDIS_PORT || 6379), password: process.env.REDIS_PASSWORD || '', tls: bool(process.env.REDIS_TLS, /rediss/i.test(process.env.REDIS_URL || '')),
  },
  smtp: {
    host: process.env.SMTP_HOST || '', port: Number(process.env.SMTP_PORT || 587), username: process.env.SMTP_USERNAME || '', password: process.env.SMTP_PASSWORD || '', from: process.env.SMTP_FROM || process.env.SMTP_USERNAME || '',
  },
  sms: { provider: process.env.SMS_PROVIDER || '', apiKey: process.env.SMS_API_KEY || '', senderId: process.env.SMS_SENDER_ID || '' },
  firebase: { projectId: process.env.FIREBASE_PROJECT_ID || '', serverKey: process.env.FIREBASE_SERVER_KEY || '' },
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
};
