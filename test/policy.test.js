import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY, normalizePolicy, resolve } from '../src/policy.js';

test('gated kinds require approval', () => {
  assert.equal(resolve('outbound', 'send_dm'), true);
  assert.equal(resolve('spend', 'pay_invoice'), true);
  assert.equal(resolve('publish', 'post_tweet'), true);
});

test('open kinds do not require approval', () => {
  assert.equal(resolve('tool_call', 'read_file'), false);
  assert.equal(resolve('draft', 'write_draft'), false);
});

test('an unknown kind fails closed', () => {
  assert.equal(resolve('exfiltrate', 'whatever'), true);
});

test('per-action overrides win over kind rules', () => {
  const policy = { ...DEFAULT_POLICY, overrides: { send_test_email_to_self: false, read_file: true } };
  assert.equal(resolve('outbound', 'send_test_email_to_self', policy), false);
  assert.equal(resolve('tool_call', 'read_file', policy), true);
});

test('normalizePolicy tolerates garbage input', () => {
  const p = normalizePolicy(null);
  assert.ok(Array.isArray(p.gatedKinds));
  assert.deepEqual(p.overrides, {});
});
