const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

test('direct Razorpay aliases require authentication and pass authenticated user', () => {
  const app = fs.readFileSync('src/app.js','utf8');
  assert.match(app,/app\.post\(Array\.from\(razorpayCreatePaths\), requireAuth/);
  assert.match(app,/app\.post\(Array\.from\(razorpayVerifyPaths\), requireAuth/);
  assert.match(app,/payment\.verify\(req\.body \|\| \{\}, req\.user\)/);
});

test('payment create no longer trusts request amount', () => {
  const app = fs.readFileSync('src/app.js','utf8');
  const service = fs.readFileSync('src/services/paymentService.js','utf8');
  assert.doesNotMatch(app,/amount:\s*body\.amount/);
  assert.match(service,/resolveAuthoritativeAmount/);
  assert.doesNotMatch(service,/ensurePaymentTransactionsNullable/);
});

test('runtime payment schema mutation removed', () => {
  const service = fs.readFileSync('src/services/paymentService.js','utf8');
  assert.doesNotMatch(service,/ALTER TABLE payment_transactions/);
});
