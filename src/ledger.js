/**
 * Append-only agent ledger.
 *
 * Storage is a JSONL file: one sealed event per line, never rewritten. The
 * three event kinds that matter structurally are:
 *
 *   intent    - the agent says what it wants to do
 *   approval  - a human signs off on a specific intent hash
 *   execution - the agent reports that it did the thing
 *
 * The rule the whole project exists to enforce: an `execution` whose intent
 * was gated by policy is only valid if an `approval` for that intent hash
 * appears EARLIER in the chain. That is checked twice - once at runtime by
 * `execute()`, and again offline by `audit()` over the raw file, so a
 * compromised or patched agent binary cannot hide the violation.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { eventHash, sealEvent, verifyChain, ZERO_HASH } from './hashchain.js';
import { merkleProof, merkleRoot, verifyProof } from './merkle.js';
import { DEFAULT_POLICY, normalizePolicy, resolve as policyResolve } from './policy.js';

export const LEDGER_FILE = 'ledger.jsonl';
export const ANCHORS_FILE = 'anchors.jsonl';
export const POLICY_FILE = 'policy.json';

export class ApprovalRequiredError extends Error {
  constructor(intentHash, action) {
    super(`execution blocked: intent ${intentHash.slice(0, 12)}… (${action}) requires human approval`);
    this.name = 'ApprovalRequiredError';
    this.intentHash = intentHash;
  }
}

function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new SyntaxError(`${file}: line ${i + 1} is not valid JSON: ${err.message}`);
      }
    });
}

function appendJsonl(file, obj) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(obj)}\n`, 'utf8');
}

export class Ledger {
  /** @param {string} dir directory holding ledger.jsonl / anchors.jsonl / policy.json */
  constructor(dir) {
    this.dir = resolvePath(dir);
    this.ledgerPath = join(this.dir, LEDGER_FILE);
    this.anchorsPath = join(this.dir, ANCHORS_FILE);
    this.policyPath = join(this.dir, POLICY_FILE);
  }

  init() {
    mkdirSync(this.dir, { recursive: true });
    if (!existsSync(this.policyPath)) {
      writeFileSync(this.policyPath, `${JSON.stringify(DEFAULT_POLICY, null, 2)}\n`, 'utf8');
    }
    if (!existsSync(this.ledgerPath)) writeFileSync(this.ledgerPath, '', 'utf8');
    return this.dir;
  }

  policy() {
    if (!existsSync(this.policyPath)) return normalizePolicy(DEFAULT_POLICY);
    return normalizePolicy(JSON.parse(readFileSync(this.policyPath, 'utf8')));
  }

  events() {
    return readJsonl(this.ledgerPath);
  }

  anchors() {
    return readJsonl(this.anchorsPath);
  }

  #append(draft) {
    const events = this.events();
    const prev = events.length ? events[events.length - 1].hash : ZERO_HASH;
    const sealed = sealEvent({ ...draft, seq: events.length, ts: draft.ts ?? new Date().toISOString() }, prev);
    appendJsonl(this.ledgerPath, sealed);
    return sealed;
  }

  /** Record what the agent intends to do. Returns the sealed intent event. */
  recordIntent({ agent, run, kind, action, payload = {}, ts }) {
    if (!agent || !run || !kind || !action) {
      throw new TypeError('recordIntent requires agent, run, kind and action');
    }
    const requiresApproval = policyResolve(kind, action, this.policy());
    return this.#append({ agent, run, kind: 'intent', action, ts, requiresApproval, payload: { ...payload, actionKind: kind } });
  }

  /** A human approves a specific intent hash. */
  approve({ intentHash, approver, note = '', ts }) {
    const intent = this.events().find((e) => e.hash === intentHash && e.kind === 'intent');
    if (!intent) throw new Error(`no intent found with hash ${intentHash}`);
    return this.#append({
      agent: intent.agent,
      run: intent.run,
      kind: 'approval',
      action: intent.action,
      ts,
      requiresApproval: false,
      payload: { intentHash, approver, note },
    });
  }

  /** A human explicitly refuses an intent. Recorded so refusals are auditable too. */
  reject({ intentHash, approver, note = '', ts }) {
    const intent = this.events().find((e) => e.hash === intentHash && e.kind === 'intent');
    if (!intent) throw new Error(`no intent found with hash ${intentHash}`);
    return this.#append({
      agent: intent.agent,
      run: intent.run,
      kind: 'rejection',
      action: intent.action,
      ts,
      requiresApproval: false,
      payload: { intentHash, approver, note },
    });
  }

  /** The agent reports execution. Throws if the gate was not satisfied. */
  execute({ intentHash, result = {}, ts }) {
    const events = this.events();
    const intent = events.find((e) => e.hash === intentHash && e.kind === 'intent');
    if (!intent) throw new Error(`no intent found with hash ${intentHash}`);
    const rejected = events.some((e) => e.kind === 'rejection' && e.payload?.intentHash === intentHash);
    if (rejected) throw new ApprovalRequiredError(intentHash, `${intent.action} (rejected by human)`);
    if (intent.requiresApproval) {
      const approved = events.some((e) => e.kind === 'approval' && e.payload?.intentHash === intentHash);
      if (!approved) throw new ApprovalRequiredError(intentHash, intent.action);
    }
    const already = events.some((e) => e.kind === 'execution' && e.payload?.intentHash === intentHash);
    if (already) throw new Error(`intent ${intentHash.slice(0, 12)}… already executed`);
    return this.#append({
      agent: intent.agent,
      run: intent.run,
      kind: 'execution',
      action: intent.action,
      ts,
      requiresApproval: false,
      payload: { intentHash, result },
    });
  }

  /** Intents that are gated and neither approved nor rejected yet. */
  pendingApprovals() {
    const events = this.events();
    const decided = new Set(
      events.filter((e) => e.kind === 'approval' || e.kind === 'rejection').map((e) => e.payload?.intentHash),
    );
    return events.filter((e) => e.kind === 'intent' && e.requiresApproval && !decided.has(e.hash));
  }

  /**
   * Offline audit over the raw file. Independent of the runtime guard.
   * @returns {{ok:boolean, chain:object, violations:Array, stats:object}}
   */
  audit() {
    const events = this.events();
    const chain = verifyChain(events);
    const violations = [];
    const policy = this.policy();
    const seen = new Map();

    for (const event of events) {
      if (event.kind === 'intent') {
        seen.set(event.hash, { intent: event, approvedAt: null, rejectedAt: null, executedAt: null });
        const shouldGate = policyResolve(event.payload?.actionKind ?? 'unknown', event.action, policy);
        if (shouldGate && event.requiresApproval === false) {
          violations.push({
            seq: event.seq,
            type: 'policy_drift',
            detail: `intent "${event.action}" was recorded as ungated but current policy gates it`,
          });
        }
        continue;
      }
      const target = event.payload?.intentHash ? seen.get(event.payload.intentHash) : null;
      if (event.kind === 'approval' || event.kind === 'rejection' || event.kind === 'execution') {
        if (!target) {
          violations.push({ seq: event.seq, type: 'orphan_event', detail: `${event.kind} references an unknown intent` });
          continue;
        }
      }
      if (event.kind === 'approval') target.approvedAt = event.seq;
      if (event.kind === 'rejection') target.rejectedAt = event.seq;
      if (event.kind === 'execution') {
        if (target.executedAt !== null) {
          violations.push({ seq: event.seq, type: 'double_execution', detail: `"${event.action}" executed twice` });
        }
        target.executedAt = event.seq;
        if (target.rejectedAt !== null && target.rejectedAt < event.seq) {
          violations.push({ seq: event.seq, type: 'executed_after_rejection', detail: `"${event.action}" was refused by a human but executed anyway` });
        }
        if (target.intent.requiresApproval && (target.approvedAt === null || target.approvedAt > event.seq)) {
          violations.push({ seq: event.seq, type: 'ungated_execution', detail: `"${event.action}" executed without a prior human approval` });
        }
      }
    }

    const stats = {
      events: events.length,
      intents: events.filter((e) => e.kind === 'intent').length,
      gated: events.filter((e) => e.kind === 'intent' && e.requiresApproval).length,
      approvals: events.filter((e) => e.kind === 'approval').length,
      rejections: events.filter((e) => e.kind === 'rejection').length,
      executions: events.filter((e) => e.kind === 'execution').length,
      pending: this.pendingApprovals().length,
    };
    return { ok: chain.ok && violations.length === 0, chain, violations, stats };
  }

  /**
   * Event hashes for a half-open [from, to) seq range.
   *
   * The digest is RECOMPUTED from each event's contents rather than read from
   * its `hash` field. That matters: a Merkle root built from self-reported
   * hashes would survive someone editing a payload and leaving the old hash in
   * place, so the root has to commit to what the line actually says.
   */
  rangeHashes(from, to) {
    return this.events()
      .filter((e) => e.seq >= from && e.seq < to)
      .map((e) => eventHash(e));
  }

  /** Merkle root over every event not yet covered by an anchor. */
  pendingBatch() {
    const anchors = this.anchors();
    const from = anchors.length ? anchors[anchors.length - 1].lastSeq + 1 : 0;
    const events = this.events();
    const to = events.length;
    if (to <= from) return null;
    const hashes = this.rangeHashes(from, to);
    return { firstSeq: from, lastSeq: to - 1, count: hashes.length, root: merkleRoot(hashes) };
  }

  /**
   * Re-derive the Merkle root for an anchor's range from the CURRENT ledger
   * file. If anyone edited history, this no longer equals the root that is
   * already on chain — which is the whole point of anchoring.
   */
  recomputeRoot(anchor) {
    const hashes = this.rangeHashes(anchor.firstSeq, anchor.lastSeq + 1);
    if (hashes.length !== anchor.count) return null;
    return merkleRoot(hashes);
  }

  recordAnchor(anchor) {
    appendJsonl(this.anchorsPath, anchor);
    return anchor;
  }

  /** Inclusion proof for one event against the anchor batch that covers it. */
  proveEvent(seq) {
    const anchor = this.anchors().find((a) => seq >= a.firstSeq && seq <= a.lastSeq);
    if (!anchor) throw new Error(`event ${seq} is not covered by any anchor yet`);
    const hashes = this.rangeHashes(anchor.firstSeq, anchor.lastSeq + 1);
    const index = seq - anchor.firstSeq;
    const event = this.events().find((e) => e.seq === seq);
    const proof = merkleProof(hashes, index);
    return {
      seq,
      action: event?.action ?? null,
      eventHash: hashes[index],
      proof,
      root: anchor.root,
      valid: verifyProof(hashes[index], proof, anchor.root),
      anchor,
    };
  }
}
