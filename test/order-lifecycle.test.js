const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalStatus, canTransition } = require('../src/services/orderLifecycleService');

test('legacy order statuses normalize to canonical values', () => {
  assert.equal(canonicalStatus('PLACED'),'RECEIVED');
  assert.equal(canonicalStatus('OUT_FOR_DELIVERY'),'PICKED_UP');
  assert.equal(canonicalStatus('completed'),'DELIVERED');
});

test('valid transitions pass and terminal transitions fail', () => {
  assert.equal(canTransition('RECEIVED','ACCEPTED'),true);
  assert.equal(canTransition('PREPARING','READY'),true);
  assert.equal(canTransition('DELIVERED','CANCELLED'),false);
  assert.equal(canTransition('CANCELLED','PREPARING'),false);
});

test('takeaway cannot enter rider workflow', () => {
  assert.equal(canTransition('READY','RIDER_ASSIGNED',{takeaway:true}),false);
  assert.equal(canTransition('READY','DELIVERED',{takeaway:true}),true);
});
