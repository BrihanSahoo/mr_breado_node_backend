const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { ok, fail } = require('../utils/respond');
const { one, many, exec } = require('../utils/db');
const ah = require('../utils/asyncHandler');

const router = express.Router();

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}
function t(v, fallback = '-') {
  const s = v == null ? '' : String(v);
  return s.trim() || fallback;
}
function money(v) { return `INR ${n(v).toFixed(2)}`; }
function isSuccess(status) {
  return ['SUCCESS', 'PAID', 'CAPTURED', 'COMPLETED', 'VERIFIED'].includes(String(status || '').toUpperCase());
}
function escapePdf(value) {
  return String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[\r\n]+/g, ' ');
}
function page(items, req) {
  const pageNo = Math.max(1, Number(req.query.page || 1));
  const perPage = Math.max(1, Math.min(100, Number(req.query.perPage || req.query.per_page || req.query.limit || 20)));
  const start = (pageNo - 1) * perPage;
  const sliced = items.slice(start, start + perPage);
  return { items: sliced, content: sliced, transactions: sliced, page: pageNo, per_page: perPage, total: items.length, total_pages: Math.max(1, Math.ceil(items.length / perPage)), last: start + perPage >= items.length };
}

async function cols(table) {
  try {
    const rows = await many(`SHOW COLUMNS FROM ${table}`);
    return new Set(rows.map(r => r.Field));
  } catch (_) { return new Set(); }
}

async function ensureReceiptColumns() {
  const c = await cols('payment_transactions');
  if (!c.size) return;
  if (!c.has('receipt_number')) {
    try { await exec('ALTER TABLE payment_transactions ADD COLUMN receipt_number VARCHAR(80) NULL'); } catch (_) {}
  }
  if (!c.has('receipt_url')) {
    try { await exec('ALTER TABLE payment_transactions ADD COLUMN receipt_url VARCHAR(255) NULL'); } catch (_) {}
  }
}

async function transactionRows(where = '', params = {}) {
  await ensureReceiptColumns();
  return many(`
    SELECT
      pt.id,
      pt.id AS transactionId,
      pt.order_id AS orderId,
      pt.user_id AS transactionUserId,
      pt.provider,
      pt.provider_order_id AS razorpayOrderId,
      pt.provider_payment_id AS razorpayPaymentId,
      pt.provider_signature AS razorpaySignature,
      pt.amount,
      pt.currency,
      pt.status,
      pt.paid_at AS paidAt,
      pt.created_at AS createdAt,
      pt.updated_at AS updatedAt,
      o.id AS linkedOrderId,
      COALESCE(o.order_number, o.slug, o.invoice_number, CONCAT('MBR-', o.id)) AS orderNumber,
      o.status AS orderStatus,
      o.payment_type AS paymentType,
      o.payment_status AS paymentStatus,
      COALESCE(o.grand_total, o.total, o.total_amount, pt.amount) AS orderTotal,
      o.restaurant_id AS restaurantId,
      COALESCE(o.user_id, pt.user_id) AS customerId,
      r.name AS restaurantName,
      r.owner_id AS sellerId,
      seller.name AS sellerName,
      seller.email AS sellerEmail,
      seller.mobile AS sellerMobile,
      u.name AS customerName,
      u.email AS customerEmail,
      COALESCE(u.mobile, u.phone) AS customerMobile
    FROM payment_transactions pt
    LEFT JOIN orders o ON o.id = pt.order_id
    LEFT JOIN restaurants r ON r.id = o.restaurant_id
    LEFT JOIN users seller ON seller.id = r.owner_id
    LEFT JOIN users u ON u.id = COALESCE(o.user_id, pt.user_id)
    ${where}
    ORDER BY pt.id DESC
    LIMIT 1000`, params);
}

async function orderItems(orderId) {
  if (!orderId) return [];
  const itemCols = await cols('order_items');
  if (!itemCols.size) return [];
  const productJoin = itemCols.has('product_id') ? 'LEFT JOIN products p ON p.id = oi.product_id' : 'LEFT JOIN products p ON 1=0';
  const productName = itemCols.has('product_name') ? 'oi.product_name' : 'p.name';
  const qty = itemCols.has('quantity') ? 'oi.quantity' : '1';
  const price = itemCols.has('price') ? 'oi.price' : (itemCols.has('unit_price') ? 'oi.unit_price' : '0');
  const total = itemCols.has('total_price') ? 'oi.total_price' : (itemCols.has('price') && itemCols.has('quantity') ? 'oi.price * oi.quantity' : price);
  const selectedSize = itemCols.has('selected_size') ? 'oi.selected_size' : 'NULL';
  const selectedWeight = itemCols.has('selected_weight') ? 'oi.selected_weight' : 'NULL';
  const custom = itemCols.has('customization_snapshot') ? 'oi.customization_snapshot' : (itemCols.has('customizations_json') ? 'oi.customizations_json' : 'NULL');
  return many(`SELECT oi.id, ${productName} AS productName, ${qty} AS quantity, ${price} AS unitPrice, ${total} AS totalPrice, ${selectedSize} AS selectedSize, ${selectedWeight} AS selectedWeight, ${custom} AS customizations FROM order_items oi ${productJoin} WHERE oi.order_id = :orderId ORDER BY oi.id ASC`, { orderId });
}

async function transactionDetail(id, userId = null) {
  const where = userId ? 'WHERE pt.id = :id AND COALESCE(o.user_id, pt.user_id) = :userId' : 'WHERE pt.id = :id';
  const tx = (await transactionRows(where, { id, userId }))[0] || null;
  if (!tx) return null;
  tx.items = await orderItems(tx.linkedOrderId || tx.orderId);
  tx.receiptNumber = `MBR-RCP-${String(tx.id).padStart(6, '0')}`;
  tx.receiptUrl = `/api/payments/${tx.id}/receipt.pdf`;
  tx.adminReceiptUrl = `/api/admin/online-transactions/${tx.id}/receipt.pdf`;
  tx.userReceiptUrl = `/api/user/payments/${tx.id}/receipt.pdf`;
  return tx;
}

function premiumPdfBuffer({ title, subtitle, meta = [], rows = [], totals = [], footer = [] }) {
  const commands = [];
  function rect(x, y, w, h, color) {
    commands.push(`${color} rg ${x} ${y} ${w} ${h} re f`);
  }
  function strokeRect(x, y, w, h, color = '0.88 0.88 0.88') {
    commands.push(`${color} RG ${x} ${y} ${w} ${h} re S`);
  }
  function text(x, y, size, value, color = '0.08 0.06 0.05', font = 'F1') {
    commands.push(`BT /${font} ${size} Tf ${color} rg ${x} ${y} Td (${escapePdf(value)}) Tj ET`);
  }
  rect(0, 0, 595, 842, '1 0.985 0.965');
  rect(0, 742, 595, 100, '1 0.29 0.02');
  rect(38, 758, 78, 54, '1 0.9 0.75');
  text(54, 786, 22, 'MB', '0.2 0.05 0.0', 'F2');
  text(130, 792, 24, 'Mr Breado', '1 1 1', 'F2');
  text(130, 770, 10, 'Premium Food Delivery Receipt & Invoice', '1 0.93 0.86');
  text(390, 790, 18, title, '1 1 1', 'F2');
  if (subtitle) text(390, 770, 10, subtitle, '1 0.93 0.86');

  let y = 710;
  rect(38, y - 18, 519, 42, '1 1 1');
  strokeRect(38, y - 18, 519, 42);
  text(54, y + 4, 10, 'Issued by Mr Breado', '0.45 0.36 0.32', 'F2');
  text(54, y - 12, 9, `Generated: ${new Date().toLocaleString('en-IN')}`, '0.45 0.36 0.32');
  y -= 56;

  meta.forEach((m, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = col === 0 ? 38 : 306;
    const yy = y - row * 44;
    rect(x, yy - 20, 251, 34, '1 1 1');
    strokeRect(x, yy - 20, 251, 34, '0.92 0.88 0.84');
    text(x + 12, yy + 2, 8, m.label.toUpperCase(), '0.55 0.48 0.44', 'F2');
    text(x + 12, yy - 12, 10, m.value, '0.08 0.06 0.05');
  });
  y -= Math.ceil(meta.length / 2) * 44 + 12;

  text(38, y, 13, 'Order Items', '0.08 0.06 0.05', 'F2');
  y -= 22;
  rect(38, y - 6, 519, 24, '0.13 0.08 0.05');
  text(52, y + 2, 9, 'Item', '1 1 1', 'F2');
  text(330, y + 2, 9, 'Qty', '1 1 1', 'F2');
  text(385, y + 2, 9, 'Price', '1 1 1', 'F2');
  text(480, y + 2, 9, 'Total', '1 1 1', 'F2');
  y -= 25;
  if (!rows.length) rows = [{ item: 'Food order', qty: 1, price: '-', total: '-' }];
  rows.slice(0, 16).forEach((r, idx) => {
    if (idx % 2 === 0) rect(38, y - 8, 519, 22, '1 0.99 0.98');
    text(52, y, 9, r.item, '0.12 0.09 0.08');
    text(330, y, 9, r.qty, '0.12 0.09 0.08');
    text(385, y, 9, r.price, '0.12 0.09 0.08');
    text(480, y, 9, r.total, '0.12 0.09 0.08');
    y -= 24;
  });
  y -= 8;
  totals.forEach((r, idx) => {
    const bold = idx === totals.length - 1;
    text(365, y, bold ? 12 : 10, r.label, bold ? '0.08 0.06 0.05' : '0.45 0.36 0.32', bold ? 'F2' : 'F1');
    text(480, y, bold ? 12 : 10, r.value, bold ? '1 0.29 0.02' : '0.08 0.06 0.05', bold ? 'F2' : 'F1');
    y -= 20;
  });

  rect(38, 64, 519, 52, '1 0.96 0.91');
  strokeRect(38, 64, 519, 52, '1 0.76 0.58');
  text(54, 96, 9, 'Payment note', '0.8 0.22 0.02', 'F2');
  text(54, 80, 9, footer.join('  |  '), '0.35 0.28 0.24');
  text(38, 30, 8, 'This is a system-generated premium PDF from Mr Breado. Thank you for ordering.', '0.5 0.44 0.4');

  const stream = commands.join('\n');
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >> endobj',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj',
    `6 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj`,
  ];
  let pdf = '%PDF-1.4\n'; const xref = [0];
  for (const obj of objects) { xref.push(Buffer.byteLength(pdf)); pdf += `${obj}\n`; }
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < xref.length; i++) pdf += String(xref[i]).padStart(10, '0') + ' 00000 n \n';
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(pdf);
}

function receiptPayload(tx) {
  const rows = (tx.items || []).map(it => {
    const option = [it.selectedSize, it.selectedWeight].filter(Boolean).join(' / ');
    return {
      item: `${t(it.productName, 'Food item')}${option ? ` (${option})` : ''}`,
      qty: t(it.quantity, '1'),
      price: money(it.unitPrice),
      total: money(it.totalPrice),
    };
  });
  return {
    title: 'Payment Receipt',
    subtitle: `#${tx.receiptNumber}`,
    meta: [
      { label: 'Receipt No', value: tx.receiptNumber },
      { label: 'Order', value: t(tx.orderNumber || tx.orderId) },
      { label: 'Customer', value: `${t(tx.customerName)} (${t(tx.customerMobile)})` },
      { label: 'Customer ID', value: t(tx.customerId) },
      { label: 'Seller', value: `${t(tx.sellerName)} (#${t(tx.sellerId)})` },
      { label: 'Restaurant', value: `${t(tx.restaurantName)} (#${t(tx.restaurantId)})` },
      { label: 'Razorpay Order ID', value: t(tx.razorpayOrderId) },
      { label: 'Razorpay Payment ID', value: t(tx.razorpayPaymentId) },
      { label: 'Payment Status', value: t(tx.status) },
      { label: 'Paid At', value: t(tx.paidAt || tx.createdAt) },
    ],
    rows,
    totals: [
      { label: 'Paid using Razorpay', value: money(tx.amount) },
      { label: 'Grand Total', value: money(tx.amount) },
    ],
    footer: [`Payment captured by Razorpay`, `Status: ${t(tx.status)}`, `Txn #${tx.id}`],
  };
}

async function sendReceipt(req, res, userScoped = false) {
  const tx = await transactionDetail(req.params.id, userScoped ? req.user.id : null);
  if (!tx) return fail(res, 'Online transaction receipt not found.', 404);
  if (!isSuccess(tx.status)) return fail(res, 'Receipt is available only after successful Razorpay payment.', 400);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${tx.receiptNumber}.pdf"`);
  res.send(premiumPdfBuffer(receiptPayload(tx)));
}

async function sendInvoice(req, res, userScoped = false) {
  const id = req.params.id;
  const userClause = userScoped ? 'AND o.user_id = :userId' : '';
  const order = await one(`SELECT o.*, COALESCE(o.order_number,o.slug,o.invoice_number,CONCAT('MBR-',o.id)) orderNumber, u.id customerId, u.name customerName, COALESCE(u.mobile,u.phone) customerMobile, u.email customerEmail, r.id restaurantId, r.name restaurantName, r.owner_id sellerId, seller.name sellerName FROM orders o LEFT JOIN users u ON u.id=o.user_id LEFT JOIN restaurants r ON r.id=o.restaurant_id LEFT JOIN users seller ON seller.id=r.owner_id WHERE (o.id=:id OR o.slug=:id OR o.order_number=:id) ${userClause} LIMIT 1`, { id, userId: req.user?.id });
  if (!order) return fail(res, 'Order not found.', 404);
  const items = await orderItems(order.id);
  const paymentStatus = t(order.payment_status || order.paymentStatus || (order.razorpay_payment_id ? 'PAID' : 'PENDING'));
  const paymentType = t(order.payment_type || order.paymentType || (order.razorpay_payment_id ? 'ONLINE' : 'COD'));
  const payload = {
    title: 'Order Invoice',
    subtitle: t(order.orderNumber),
    meta: [
      { label: 'Order No', value: t(order.orderNumber) },
      { label: 'Order Status', value: t(order.status) },
      { label: 'Customer', value: `${t(order.customerName)} (${t(order.customerMobile)})` },
      { label: 'Customer ID', value: t(order.customerId) },
      { label: 'Seller', value: `${t(order.sellerName)} (#${t(order.sellerId)})` },
      { label: 'Restaurant', value: `${t(order.restaurantName)} (#${t(order.restaurantId)})` },
      { label: 'Payment Type', value: paymentType },
      { label: 'Payment Status', value: paymentStatus },
      { label: 'Razorpay Payment ID', value: t(order.razorpay_payment_id || '-') },
      { label: 'Created At', value: t(order.created_at || order.createdAt) },
    ],
    rows: items.map(it => ({ item: t(it.productName), qty: t(it.quantity), price: money(it.unitPrice), total: money(it.totalPrice) })),
    totals: [
      { label: 'Subtotal', value: money(order.subtotal) },
      { label: 'Delivery Fee', value: money(order.delivery_fee) },
      { label: 'Platform Fee', value: money(order.platform_fee) },
      { label: 'Discount', value: money(order.discount) },
      { label: 'Grand Total', value: money(order.grand_total || order.total || order.total_amount) },
    ],
    footer: [paymentType.toUpperCase().includes('ONLINE') ? 'Paid using Razorpay' : 'Payment pending / COD', `Order: ${t(order.orderNumber)}`],
  };
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${t(order.orderNumber, order.id)}_invoice.pdf"`);
  res.send(premiumPdfBuffer(payload));
}

router.get(['/admin/online-transactions', '/admin/payment-transactions', '/admin/payments/online'], requireAuth, ah(async (req, res) => {
  const rows = await transactionRows(`WHERE UPPER(pt.provider)='RAZORPAY'`);
  const enriched = [];
  for (const row of rows) {
    const detail = { ...row, items: await orderItems(row.linkedOrderId || row.orderId) };
    enriched.push({
      ...detail,
      receiptNumber: `MBR-RCP-${String(row.id).padStart(6, '0')}`,
      receiptPdfUrl: `/api/admin/online-transactions/${row.id}/receipt.pdf`,
      adminReceiptUrl: `/api/admin/online-transactions/${row.id}/receipt.pdf`,
      paymentLabel: isSuccess(row.status) ? 'Paid using Razorpay' : 'Razorpay order created',
    });
  }
  ok(res, page(enriched, req), 'Online transactions loaded');
}));

router.get(['/admin/online-transactions/:id', '/admin/payment-transactions/:id', '/admin/payments/:id'], requireAuth, ah(async (req, res) => {
  const tx = await transactionDetail(req.params.id);
  if (!tx) return fail(res, 'Transaction not found.', 404);
  ok(res, { ...tx, paymentLabel: isSuccess(tx.status) ? 'Paid using Razorpay' : 'Razorpay order created' }, 'Transaction loaded');
}));

router.get(['/user/online-transactions', '/user/payments', '/user/payment-transactions'], requireAuth, ah(async (req, res) => {
  const rows = await transactionRows(`WHERE UPPER(pt.provider)='RAZORPAY' AND COALESCE(o.user_id, pt.user_id)=:userId AND UPPER(pt.status) IN ('SUCCESS','PAID','CAPTURED','COMPLETED','VERIFIED')`, { userId: req.user.id });
  const data = rows.map(row => ({ ...row, receiptNumber: `MBR-RCP-${String(row.id).padStart(6, '0')}`, receiptPdfUrl: `/api/user/payments/${row.id}/receipt.pdf`, paymentLabel: 'Paid using Razorpay' }));
  ok(res, page(data, req), 'Online payment receipts loaded');
}));

router.get(['/admin/online-transactions/:id/receipt.pdf', '/admin/payments/:id/receipt.pdf', '/admin/payment-transactions/:id/receipt.pdf'], requireAuth, ah((req, res) => sendReceipt(req, res, false)));
router.get(['/user/payments/:id/receipt.pdf', '/user/online-transactions/:id/receipt.pdf', '/payments/:id/receipt.pdf'], requireAuth, ah((req, res) => sendReceipt(req, res, req.path.includes('/user/'))));
router.get(['/user/orders/:id/transaction-receipt.pdf'], requireAuth, ah(async (req, res) => {
  const tx = await one(`SELECT pt.id FROM payment_transactions pt LEFT JOIN orders o ON o.id=pt.order_id WHERE (o.id=:id OR o.slug=:id OR o.order_number=:id) AND COALESCE(o.user_id, pt.user_id)=:userId AND UPPER(pt.status) IN ('SUCCESS','PAID','CAPTURED','COMPLETED','VERIFIED') ORDER BY pt.id DESC LIMIT 1`, { id: req.params.id, userId: req.user.id });
  if (!tx) return fail(res, 'Receipt is available only after successful Razorpay payment.', 404);
  req.params.id = tx.id;
  return sendReceipt(req, res, true);
}));

router.get(['/admin/orders/:id/invoice.pdf', '/admin/mr-breado/orders/:id/invoice.pdf', '/seller/orders/:id/invoice.pdf'], requireAuth, ah((req, res) => sendInvoice(req, res, false)));
router.get(['/user/orders/:id/invoice.pdf', '/orders/:id/invoice.pdf'], requireAuth, ah((req, res) => sendInvoice(req, res, true)));

router.get(['/feature-version-v30', '/version-v30'], (req, res) => ok(res, {
  version: 'premium-receipts-invoices-v30',
  razorpay: 'v22 locked - unchanged',
  receipts: 'premium-pdf-success-only',
  invoices: 'premium-pdf-user-admin',
}, 'v27 active'));

module.exports = router;
