const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { ok, fail } = require('../utils/respond');
const { one, exec, many } = require('../utils/db');
const ah = require('../utils/asyncHandler');

const router = express.Router();

async function columns(table) {
  try {
    const rows = await many(`SHOW COLUMNS FROM ${table}`);
    return new Set(rows.map((r) => r.Field));
  } catch (_) {
    return new Set();
  }
}

function normStatus(value) {
  return String(value || '').trim().toUpperCase();
}

async function findOrder(orderId, userId) {
  return one(
    `SELECT id, order_number, slug, status, restaurant_id, user_id
     FROM orders
     WHERE id=:orderId AND user_id=:userId
     LIMIT 1`,
    { orderId, userId }
  );
}

async function reviewExists(orderId, userId) {
  const reviewCols = await columns('reviews');
  if (!reviewCols.size || !reviewCols.has('order_id')) return false;
  const deletedWhere = reviewCols.has('deleted') ? 'AND COALESCE(deleted,0)=0' : '';
  const row = await one(
    `SELECT id FROM reviews WHERE order_id=:orderId AND user_id=:userId ${deletedWhere} LIMIT 1`,
    { orderId, userId }
  );
  return !!row;
}

router.get('/reviews/order/:id/eligibility', requireAuth, ah(async (req, res) => {
  const orderId = Number(req.params.id);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    return fail(res, 'Invalid order id.', 400);
  }

  const order = await findOrder(orderId, req.user.id);
  if (!order) {
    return ok(res, {
      order_id: orderId,
      orderId,
      can_review: false,
      canReview: false,
      already_reviewed: false,
      alreadyReviewed: false,
      reason: 'Order not found for this user.',
    }, 'Review eligibility loaded');
  }

  const already = await reviewExists(orderId, req.user.id);
  const delivered = ['DELIVERED', 'COMPLETED'].includes(normStatus(order.status));
  const can = delivered && !already;

  return ok(res, {
    order_id: order.id,
    orderId: order.id,
    order_number: order.order_number || order.slug || `MBR-${order.id}`,
    orderNumber: order.order_number || order.slug || `MBR-${order.id}`,
    can_review: can,
    canReview: can,
    eligible: can,
    already_reviewed: already,
    alreadyReviewed: already,
    has_review: already,
    hasReview: already,
    reason: can ? '' : already ? 'This order is already reviewed.' : 'Review is available only after delivery.',
  }, 'Review eligibility loaded');
}));

router.post('/reviews/order/:id', requireAuth, ah(async (req, res) => {
  const orderId = Number(req.params.id);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    return fail(res, 'Invalid order id.', 400);
  }

  const order = await findOrder(orderId, req.user.id);
  if (!order) return fail(res, 'Order not found for this user.', 404);

  const status = normStatus(order.status);
  if (!['DELIVERED', 'COMPLETED'].includes(status)) {
    return fail(res, 'Review is available only after delivery.', 400);
  }

  if (await reviewExists(orderId, req.user.id)) {
    return fail(res, 'This order is already reviewed.', 409);
  }

  const reviewCols = await columns('reviews');
  if (!reviewCols.size) return fail(res, 'Review table is not available.', 500);

  const rating = Number(req.body.restaurant_rating || req.body.restaurantRating || req.body.rating || 5);
  const driverRating = Number(req.body.driver_rating || req.body.driverRating || req.body.delivery_partner_rating || rating || 5);
  const comment = String(req.body.restaurant_comment || req.body.restaurantComment || req.body.comment || '').trim();
  const driverComment = String(req.body.driver_comment || req.body.driverComment || '').trim();

  const data = {};
  if (reviewCols.has('user_id')) data.user_id = req.user.id;
  if (reviewCols.has('order_id')) data.order_id = orderId;
  if (reviewCols.has('restaurant_id')) data.restaurant_id = order.restaurant_id || null;
  if (reviewCols.has('rating')) data.rating = Math.max(1, Math.min(5, rating || 5));
  if (reviewCols.has('restaurant_rating')) data.restaurant_rating = Math.max(1, Math.min(5, rating || 5));
  if (reviewCols.has('driver_rating')) data.driver_rating = Math.max(1, Math.min(5, driverRating || rating || 5));
  if (reviewCols.has('delivery_partner_rating')) data.delivery_partner_rating = Math.max(1, Math.min(5, driverRating || rating || 5));
  if (reviewCols.has('comment')) data.comment = comment || driverComment || 'Reviewed';
  if (reviewCols.has('restaurant_comment')) data.restaurant_comment = comment;
  if (reviewCols.has('driver_comment')) data.driver_comment = driverComment;
  if (reviewCols.has('type')) data.type = 'ORDER';
  if (reviewCols.has('approved')) data.approved = 1;
  if (reviewCols.has('deleted')) data.deleted = 0;
  if (reviewCols.has('created_at')) data.created_at = new Date();
  if (reviewCols.has('updated_at')) data.updated_at = new Date();

  const keys = Object.keys(data);
  const sql = `INSERT INTO reviews (${keys.join(',')}) VALUES (${keys.map(k => ':' + k).join(',')})`;
  const result = await exec(sql, data);

  return ok(res, {
    id: result.insertId,
    order_id: orderId,
    orderId,
    order_number: order.order_number || order.slug || `MBR-${order.id}`,
    orderNumber: order.order_number || order.slug || `MBR-${order.id}`,
    already_reviewed: true,
    alreadyReviewed: true,
    reviewed: true,
    restaurant_rating: Math.max(1, Math.min(5, rating || 5)),
    driver_rating: Math.max(1, Math.min(5, driverRating || rating || 5)),
    restaurant_comment: comment,
    driver_comment: driverComment,
    created_at: new Date().toISOString(),
  }, 'Review submitted successfully', 201);
}));

module.exports = router;
