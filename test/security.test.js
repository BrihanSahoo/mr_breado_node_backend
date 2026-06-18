const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { requireAuth, role, normalizeRole } = require('../src/middleware/auth');
const { isPublicAuth } = require('../src/middleware/pathAccess');
const { jwtSecret } = require('../src/config/env');

function response() {
  return { statusCode: 200, body: null, status(code){ this.statusCode=code; return this; }, json(body){ this.body=body; return this; } };
}

test('payment and protected APIs reject missing authentication', () => {
  const req = { headers:{}, query:{}, header(){ return null; } };
  const res = response();
  let nextCalled = false;
  requireAuth(req,res,()=>{nextCalled=true;});
  assert.equal(nextCalled,false);
  assert.equal(res.statusCode,401);
});

test('role aliases normalize consistently', () => {
  assert.equal(normalizeRole('DELIVERY_PARTNER'),'RIDER');
  assert.equal(normalizeRole('RESTAURANT_OWNER'),'SELLER');
  assert.equal(normalizeRole('OUTLET_MANAGER'),'OUTLET_MANAGER');
});

test('admin role guard rejects seller token', () => {
  const token = jwt.sign({id:1,role:'SELLER'},jwtSecret,{expiresIn:'1m'});
  const req = { headers:{authorization:`Bearer ${token}`}, query:{}, header(){return null;} };
  const res = response();
  requireAuth(req,res,()=>{});
  let nextCalled=false;
  role('ADMIN')(req,res,()=>{nextCalled=true;});
  assert.equal(nextCalled,false);
  assert.equal(res.statusCode,403);
});

test('only intended login aliases bypass path-level access', () => {
  assert.equal(isPublicAuth({originalUrl:'/api/admin/login'}),true);
  assert.equal(isPublicAuth({originalUrl:'/api/seller/outlet-login'}),true);
  assert.equal(isPublicAuth({originalUrl:'/api/admin/orders'}),false);
  assert.equal(isPublicAuth({originalUrl:'/api/seller/orders'}),false);
});
