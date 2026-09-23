import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, eventHash, sealEvent, verifyChain, ZERO_HASH } from '../src/hashchain.js';

test('canonicalize is independent of key insertion order', () => {
  // Arrange
  const a = { b: 1, a: { d: [3, 2], c: 'x' } };
  const b = { a: { c: 'x', d: [3, 2] }, b: 1 };

  // Act + Assert
  assert.equal(canonicalize(a), canonicalize(b));
  assert.equal(canonicalize(a), '{"a":{"c":"x","d":[3,2]},"b":1}');
});

test('canonicalize preserves array order', () => {
  assert.notEqual(canonicalize([1, 2]), canonicalize([2, 1]));
});

test('canonicalize rejects non-finite numbers', () => {
  assert.throws(() => canonicalize({ x: Number.NaN }), TypeError);
});

test('sealEvent links to the previous hash and is deterministic', () => {
  const draft = { seq: 0, ts: '2026-09-24T00:00:00.000Z', agent: 'a', run: 'r', kind: 'intent', action: 'x', payload: {}, requiresApproval: true };
  const first = sealEvent(draft, null);
  const again = sealEvent(draft, null);

  assert.equal(first.prev, ZERO_HASH);
  assert.equal(first.hash, again.hash);
  assert.match(first.hash, /^[0-9a-f]{64}$/);
});

test('hash ignores fields that are not part of the commitment', () => {
  const draft = { seq: 0, ts: '2026-09-24T00:00:00.000Z', agent: 'a', run: 'r', kind: 'intent', action: 'x', payload: {}, requiresApproval: false, prev: ZERO_HASH };
  assert.equal(eventHash(draft), eventHash({ ...draft, uiColour: 'red' }));
});

test('verifyChain accepts an untouched chain', () => {
  const base = { ts: '2026-09-24T00:00:00.000Z', agent: 'a', run: 'r', kind: 'intent', action: 'x', payload: {}, requiresApproval: false };
  const e0 = sealEvent({ ...base, seq: 0 }, null);
  const e1 = sealEvent({ ...base, seq: 1, action: 'y' }, e0.hash);

  const result = verifyChain([e0, e1]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('verifyChain detects an edited payload', () => {
  const base = { ts: '2026-09-24T00:00:00.000Z', agent: 'a', run: 'r', kind: 'intent', payload: {}, requiresApproval: false };
  const e0 = sealEvent({ ...base, seq: 0, action: 'send 1 SOL' }, null);
  const e1 = sealEvent({ ...base, seq: 1, action: 'log' }, e0.hash);

  const tampered = [{ ...e0, action: 'send 1000 SOL' }, e1];
  const result = verifyChain(tampered);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.reason.includes('tampered')));
});

test('verifyChain detects a deleted event', () => {
  const base = { ts: '2026-09-24T00:00:00.000Z', agent: 'a', run: 'r', kind: 'intent', payload: {}, requiresApproval: false };
  const e0 = sealEvent({ ...base, seq: 0, action: 'a' }, null);
  const e1 = sealEvent({ ...base, seq: 1, action: 'b' }, e0.hash);
  const e2 = sealEvent({ ...base, seq: 2, action: 'c' }, e1.hash);

  const result = verifyChain([e0, e2]);
  assert.equal(result.ok, false);
});
