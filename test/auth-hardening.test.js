const test = require('node:test');
const assert = require('node:assert/strict');
const { requireAuth } = require('../src/middleware/auth');
function response(){return{statusCode:200,status(c){this.statusCode=c;return this},json(v){this.body=v;return this}}}
test('query tokens are rejected by default',()=>{
  delete process.env.ALLOW_QUERY_AUTH_TOKEN;
  const req={headers:{},query:{token:'abc'}}; const res=response(); let called=false;
  requireAuth(req,res,()=>called=true); assert.equal(called,false); assert.equal(res.statusCode,401);
});
