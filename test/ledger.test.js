import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger, ApprovalRequiredError } from '../src/ledger.js';
import { sealEvent } from '../src/hashchain.js';

function freshLedger() {
  const dir = mkdtempSync(join(tmpdir(), 'agentproof-'));
  const ledger = new Ledger(dir);
  ledger.init();
  return ledger;
}

const RUN = { agent: 'warung-clip-agent', run: 'run-test' };

test('an open action can be executed without approval', () => {
  const ledger = freshLedger();
  const intent = ledger.recordIntent({ ...RUN, kind: 'tool_call', action: 'render_clip' });
  assert.equal(intent.requiresApproval, false);

  const exec = ledger.execute({ intentHash: intent.hash, result: { file: 'clip.mp4' } });
  assert.equal(exec.kind, 'execution');
  assert.equal(ledger.audit().ok, true);
});

test('a gated action is blocked until a human approves', () => {
  const ledger = freshLedger();
  const intent = ledger.recordIntent({ ...RUN, kind: 'outbound', action: 'email_prospect', payload: { to: 'someone@example.com' } });
  assert.equal(intent.requiresApproval, true);

  assert.throws(() => ledger.execute({ intentHash: intent.hash }), ApprovalRequiredError);

  ledger.approve({ intentHash: intent.hash, approver: 'henggar' });
  const exec = ledger.execute({ intentHash: intent.hash });
  assert.equal(exec.kind, 'execution');
  assert.equal(ledger.audit().ok, true);
});

test('a refused action stays blocked even though it was reviewed', () => {
  const ledger = freshLedger();
  const intent = ledger.recordIntent({ ...RUN, kind: 'spend', action: 'buy_ads' });
  ledger.reject({ intentHash: intent.hash, approver: 'henggar', note: 'no budget' });

  assert.throws(() => ledger.execute({ intentHash: intent.hash }), ApprovalRequiredError);
});

test('the same intent cannot be executed twice', () => {
  const ledger = freshLedger();
  const intent = ledger.recordIntent({ ...RUN, kind: 'tool_call', action: 'render_clip' });
  ledger.execute({ intentHash: intent.hash });
  assert.throws(() => ledger.execute({ intentHash: intent.hash }), /already executed/);
});

test('pendingApprovals lists only undecided gated intents', () => {
  const ledger = freshLedger();
  const open = ledger.recordIntent({ ...RUN, kind: 'tool_call', action: 'read_inbox' });
  const gatedA = ledger.recordIntent({ ...RUN, kind: 'outbound', action: 'send_a' });
  const gatedB = ledger.recordIntent({ ...RUN, kind: 'outbound', action: 'send_b' });
  ledger.approve({ intentHash: gatedA.hash, approver: 'henggar' });

  const pending = ledger.pendingApprovals().map((e) => e.hash);
  assert.deepEqual(pending, [gatedB.hash]);
  assert.ok(!pending.includes(open.hash));
});

test('audit catches an execution forged straight into the file (runtime guard bypassed)', () => {
  const ledger = freshLedger();
  const intent = ledger.recordIntent({ ...RUN, kind: 'outbound', action: 'email_everyone' });

  // A compromised agent appends the execution itself, never asking a human.
  const forged = sealEvent(
    {
      seq: 1,
      ts: new Date().toISOString(),
      agent: RUN.agent,
      run: RUN.run,
      kind: 'execution',
      action: 'email_everyone',
      requiresApproval: false,
      payload: { intentHash: intent.hash, result: { sent: 4000 } },
    },
    intent.hash,
  );
  appendFileSync(ledger.ledgerPath, `${JSON.stringify(forged)}\n`, 'utf8');

  const report = ledger.audit();
  assert.equal(report.chain.ok, true, 'the chain itself is still well-formed');
  assert.equal(report.ok, false);
  assert.ok(report.violations.some((v) => v.type === 'ungated_execution'));
});

test('audit catches a rewritten past event', () => {
  const ledger = freshLedger();
  const intent = ledger.recordIntent({ ...RUN, kind: 'spend', action: 'pay', payload: { amountUsd: 5 } });
  ledger.approve({ intentHash: intent.hash, approver: 'henggar' });
  ledger.execute({ intentHash: intent.hash });

  const lines = readFileSync(ledger.ledgerPath, 'utf8').trim().split('\n');
  const first = JSON.parse(lines[0]);
  first.payload.amountUsd = 5000;
  lines[0] = JSON.stringify(first);
  writeFileSync(ledger.ledgerPath, `${lines.join('\n')}\n`, 'utf8');

  const report = ledger.audit();
  assert.equal(report.ok, false);
  assert.ok(report.chain.errors.some((e) => e.reason.includes('tampered')));
});

test('pendingBatch covers exactly the unanchored tail', () => {
  const ledger = freshLedger();
  ledger.recordIntent({ ...RUN, kind: 'tool_call', action: 'a' });
  ledger.recordIntent({ ...RUN, kind: 'tool_call', action: 'b' });

  const batch = ledger.pendingBatch();
  assert.deepEqual([batch.firstSeq, batch.lastSeq, batch.count], [0, 1, 2]);

  ledger.recordAnchor({ ...batch, signature: 'sig-1', cluster: 'devnet', at: new Date().toISOString() });
  assert.equal(ledger.pendingBatch(), null);

  ledger.recordIntent({ ...RUN, kind: 'tool_call', action: 'c' });
  const next = ledger.pendingBatch();
  assert.deepEqual([next.firstSeq, next.lastSeq, next.count], [2, 2, 1]);
});

test('proveEvent returns a valid inclusion proof against the anchored root', () => {
  const ledger = freshLedger();
  for (const action of ['a', 'b', 'c', 'd', 'e']) {
    ledger.recordIntent({ ...RUN, kind: 'tool_call', action });
  }
  const batch = ledger.pendingBatch();
  ledger.recordAnchor({ ...batch, signature: 'sig-1', cluster: 'devnet', at: new Date().toISOString() });

  for (let seq = 0; seq < 5; seq += 1) {
    const proof = ledger.proveEvent(seq);
    assert.equal(proof.valid, true, `seq ${seq}`);
    assert.equal(proof.root, batch.root);
  }
  assert.throws(() => ledger.proveEvent(99), /not covered by any anchor/);
});

test('recomputeRoot diverges from the anchored root once history is edited', () => {
  const ledger = freshLedger();
  ledger.recordIntent({ ...RUN, kind: 'spend', action: 'pay', payload: { amountUsd: 5 } });
  ledger.recordIntent({ ...RUN, kind: 'tool_call', action: 'log' });
  const batch = ledger.pendingBatch();
  const anchor = { ...batch, signature: 'sig-1', cluster: 'devnet', at: new Date().toISOString() };
  ledger.recordAnchor(anchor);

  assert.equal(ledger.recomputeRoot(anchor), anchor.root, 'untouched ledger re-derives the same root');

  const lines = readFileSync(ledger.ledgerPath, 'utf8').trim().split('\n');
  const first = JSON.parse(lines[0]);
  first.payload.amountUsd = 5000;
  lines[0] = JSON.stringify(first);
  writeFileSync(ledger.ledgerPath, `${lines.join('\n')}\n`, 'utf8');

  assert.notEqual(ledger.recomputeRoot(anchor), anchor.root, 'edited ledger no longer matches what was anchored');
});

test('recordIntent validates its inputs', () => {
  const ledger = freshLedger();
  assert.throws(() => ledger.recordIntent({ agent: 'a' }), TypeError);
});
