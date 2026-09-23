/**
 * Binary Merkle tree over event hashes, with domain-separated leaf/node
 * prefixes (0x00 for leaves, 0x01 for internal nodes) so a leaf digest can
 * never be replayed as an internal node.
 *
 * Why batches: anchoring every single agent event on-chain would be wasteful.
 * We anchor one Merkle root per batch and can still prove that any individual
 * event was part of that batch with a log2(n) proof.
 */
import { createHash } from 'node:crypto';

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

function toBuf(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new TypeError(`expected 32-byte hex digest, got ${String(hex).slice(0, 32)}`);
  }
  return Buffer.from(hex, 'hex');
}

function digest(...parts) {
  const h = createHash('sha256');
  for (const part of parts) h.update(part);
  return h.digest();
}

export function leafHash(eventHashHex) {
  return digest(LEAF_PREFIX, toBuf(eventHashHex)).toString('hex');
}

export function nodeHash(leftHex, rightHex) {
  return digest(NODE_PREFIX, toBuf(leftHex), toBuf(rightHex)).toString('hex');
}

function buildLevels(eventHashes) {
  if (eventHashes.length === 0) throw new RangeError('cannot build a Merkle tree over zero leaves');
  const levels = [eventHashes.map(leafHash)];
  while (levels[levels.length - 1].length > 1) {
    const current = levels[levels.length - 1];
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      // Odd node at the end is promoted unchanged rather than duplicated,
      // which avoids the classic CVE-2012-2459 style duplicate-leaf ambiguity.
      next.push(i + 1 < current.length ? nodeHash(current[i], current[i + 1]) : current[i]);
    }
    levels.push(next);
  }
  return levels;
}

export function merkleRoot(eventHashes) {
  const levels = buildLevels(eventHashes);
  return levels[levels.length - 1][0];
}

/** @returns {Array<{sibling:string, side:'left'|'right'}>} */
export function merkleProof(eventHashes, index) {
  if (!Number.isInteger(index) || index < 0 || index >= eventHashes.length) {
    throw new RangeError(`leaf index ${index} out of range`);
  }
  const levels = buildLevels(eventHashes);
  const proof = [];
  let idx = index;
  for (let level = 0; level < levels.length - 1; level += 1) {
    const nodes = levels[level];
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;
    if (siblingIdx < nodes.length) {
      proof.push({ sibling: nodes[siblingIdx], side: isRight ? 'left' : 'right' });
    }
    idx = Math.floor(idx / 2);
  }
  return proof;
}

export function verifyProof(eventHashHex, proof, rootHex) {
  let node = leafHash(eventHashHex);
  for (const step of proof) {
    node = step.side === 'left' ? nodeHash(step.sibling, node) : nodeHash(node, step.sibling);
  }
  return node === rootHex;
}
