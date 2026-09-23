/**
 * Approval policy: which agent actions a human must sign off on before the
 * agent is allowed to execute them.
 *
 * The policy is data, not code, so it can be committed, reviewed and diffed.
 * `resolve()` is pure; the ledger calls it at record time and the verifier
 * calls it again at audit time, which means a policy that was loosened after
 * the fact is detectable (the recorded flag and the current policy disagree).
 */

export const DEFAULT_POLICY = Object.freeze({
  version: 1,
  // Action kinds that always need a human approval event before execution.
  gatedKinds: Object.freeze(['outbound', 'spend', 'credential', 'publish', 'destructive']),
  // Kinds that are free to execute (read-only / local work).
  openKinds: Object.freeze(['tool_call', 'note', 'observation', 'draft']),
  // Optional per-action overrides, e.g. { "send_test_email_to_self": false }.
  overrides: Object.freeze({}),
});

export function normalizePolicy(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_POLICY, overrides: {} };
  return {
    version: Number.isInteger(raw.version) ? raw.version : DEFAULT_POLICY.version,
    gatedKinds: Array.isArray(raw.gatedKinds) ? [...raw.gatedKinds] : [...DEFAULT_POLICY.gatedKinds],
    openKinds: Array.isArray(raw.openKinds) ? [...raw.openKinds] : [...DEFAULT_POLICY.openKinds],
    overrides: raw.overrides && typeof raw.overrides === 'object' ? { ...raw.overrides } : {},
  };
}

/**
 * @returns {boolean} true when a human approval event is required.
 */
export function resolve(kind, action, policy = DEFAULT_POLICY) {
  const p = normalizePolicy(policy);
  if (Object.prototype.hasOwnProperty.call(p.overrides, action)) {
    return Boolean(p.overrides[action]);
  }
  if (p.gatedKinds.includes(kind)) return true;
  if (p.openKinds.includes(kind)) return false;
  // Unknown kind: fail closed. An agent should not be able to dodge the gate
  // by inventing a new action kind.
  return true;
}
