import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { leafHash, merkleProof, merkleRoot, nodeHash, verifyProof } from '../src/merkle.js';

const h = (s) => createHash('sha256').update(s).digest('hex');

test('single leaf root equals the domain-separated leaf hash', () => {
  const leaves = [h('one')];
  assert.equal(merkleRoot(leaves), leafHash(leaves[0]));
});

test('root changes when any leaf changes', () => {
  const a = [h('a'), h('b'), h('c')];
  const b = [h('a'), h('b'), h('c!')];
  assert.notEqual(merkleRoot(a), merkleRoot(b));
});

test('leaf and node hashing use different domains', () => {
  const x = h('x');
  assert.notEqual(leafHash(x), nodeHash(x, x));
});

test('proofs verify for every index, at every tree size 1..17', () => {
  for (let size = 1; size <= 17; size += 1) {
    const leaves = Array.from({ length: size }, (_, i) => h(`leaf-${size}-${i}`));
    const root = merkleRoot(leaves);
    for (let i = 0; i < size; i += 1) {
      const proof = merkleProof(leaves, i);
      assert.equal(verifyProof(leaves[i], proof, root), true, `size ${size} index ${i}`);
    }
  }
});

test('a proof for the wrong leaf does not verify', () => {
  const leaves = [h('a'), h('b'), h('c'), h('d')];
  const root = merkleRoot(leaves);
  const proof = merkleProof(leaves, 1);
  assert.equal(verifyProof(h('not-in-tree'), proof, root), false);
});

test('a tampered proof step does not verify', () => {
  const leaves = [h('a'), h('b'), h('c'), h('d')];
  const root = merkleRoot(leaves);
  const proof = merkleProof(leaves, 0);
  proof[0].sibling = h('evil');
  assert.equal(verifyProof(leaves[0], proof, root), false);
});

test('rejects malformed digests and empty trees', () => {
  assert.throws(() => merkleRoot([]), RangeError);
  assert.throws(() => leafHash('nothex'), TypeError);
  assert.throws(() => merkleProof([h('a')], 5), RangeError);
});
