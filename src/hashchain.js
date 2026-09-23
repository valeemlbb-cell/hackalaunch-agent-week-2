/**
 * Canonical serialization + SHA-256 hash chain primitives.
 *
 * Every agent event is hashed over a canonical (key-sorted) JSON encoding so
 * that two independent implementations produce the same digest for the same
 * logical record. Each event also commits to the hash of the previous event,
 * which makes the log tamper-evident: editing or deleting any past event
 * invalidates every hash after it.
 */
import { createHash } from 'node:crypto';

export const ZERO_HASH = '0'.repeat(64);

/** Fields that are covered by an event's hash, in canonical order. */
export const HASHED_FIELDS = Object.freeze([
  'seq',
  'ts',
  'agent',
  'run',
  'kind',
  'action',
  'payload',
  'requiresApproval',
  'prev',
]);

/**
 * Deterministic JSON encoding: object keys sorted, no insignificant whitespace.
 * Arrays keep their order. Undefined values are dropped (same as JSON.stringify).
 */
export function canonicalize(value) {
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('cannot canonicalize non-finite number');
    return JSON.stringify(value);
  }
  if (type === 'boolean' || type === 'string') return JSON.stringify(value);
  if (type === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item ?? null)).join(',')}]`;
  if (type === 'object') {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    const body = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',');
    return `{${body}}`;
  }
  throw new TypeError(`cannot canonicalize value of type ${type}`);
}

export function sha256Hex(input) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return createHash('sha256').update(buf).digest('hex');
}

/** Pick only the hashed fields, so extra bookkeeping fields never affect the digest. */
export function hashablePart(event) {
  const picked = {};
  for (const field of HASHED_FIELDS) picked[field] = event[field] ?? null;
  return picked;
}

export function eventHash(event) {
  return sha256Hex(canonicalize(hashablePart(event)));
}

/**
 * Attach `prev` and `hash` to a draft event.
 * @param {object} draft event without prev/hash
 * @param {string|null} prevHash hash of the preceding event, or null for genesis
 */
export function sealEvent(draft, prevHash) {
  const sealed = { ...draft, prev: prevHash ?? ZERO_HASH };
  return { ...sealed, hash: eventHash(sealed) };
}

/**
 * Verify chain integrity.
 * @returns {{ok: boolean, errors: Array<{seq:number, reason:string}>}}
 */
export function verifyChain(events) {
  const errors = [];
  let expectedPrev = ZERO_HASH;
  events.forEach((event, index) => {
    if (event.seq !== index) {
      errors.push({ seq: event.seq ?? index, reason: `seq out of order (expected ${index}, got ${event.seq})` });
    }
    if (event.prev !== expectedPrev) {
      errors.push({ seq: event.seq ?? index, reason: 'prev hash does not match preceding event' });
    }
    const recomputed = eventHash(event);
    if (recomputed !== event.hash) {
      errors.push({ seq: event.seq ?? index, reason: 'event hash does not match its contents (tampered)' });
    }
    expectedPrev = event.hash;
  });
  return { ok: errors.length === 0, errors };
}
