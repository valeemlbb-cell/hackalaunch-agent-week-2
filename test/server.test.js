import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from '../src/ledger.js';
import { startServer } from '../src/server.js';

async function withServer(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'agentproof-srv-'));
  const ledger = new Ledger(dir);
  ledger.init();
  const handle = await startServer({ dir, port: 0 });
  const base = `http://127.0.0.1:${handle.port}`;
  try {
    await fn({ ledger, base });
  } finally {
    await handle.close();
  }
}

test('GET /api/state reports an empty but valid ledger', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/state`);
    const state = await res.json();
    assert.equal(res.status, 200);
    assert.equal(state.ok, true);
    assert.equal(state.stats.events, 0);
    assert.deepEqual(state.pending, []);
  });
});

test('the dashboard page is served', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /agentproof/);
  });
});

test('POST /api/decision appends an approval and unblocks execution', async () => {
  await withServer(async ({ ledger, base }) => {
    const intent = ledger.recordIntent({ agent: 'a', run: 'r', kind: 'outbound', action: 'send_dm' });

    const res = await fetch(`${base}/api/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intentHash: intent.hash, decision: 'approve', approver: 'henggar' }),
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.event.kind, 'approval');
    assert.equal(body.state.stats.pending, 0);
    assert.doesNotThrow(() => ledger.execute({ intentHash: intent.hash }));
  });
});

test('POST /api/decision rejects malformed input', async () => {
  await withServer(async ({ base }) => {
    const cases = [
      { intentHash: 'nope', decision: 'approve', approver: 'x' },
      { intentHash: 'a'.repeat(64), decision: 'delete', approver: 'x' },
      { intentHash: 'a'.repeat(64), decision: 'approve', approver: '  ' },
    ];
    for (const body of cases) {
      const res = await fetch(`${base}/api/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });
});

test('unknown static paths 404 and do not escape the web dir', async () => {
  await withServer(async ({ base }) => {
    assert.equal((await fetch(`${base}/nope.html`)).status, 404);

    // Traversal attempts must never return file contents; either rejected (400)
    // or simply not found (404) is acceptable.
    for (const path of ['/..%2f..%2fpackage.json', '/../package.json', '/web/../../package.json']) {
      const res = await fetch(`${base}${path}`);
      assert.ok(res.status === 400 || res.status === 404, `${path} returned ${res.status}`);
      assert.ok(!(await res.text()).includes('"dependencies"'), `${path} leaked a file`);
    }
  });
});

test('GET /api/prove reports when an event has no anchor yet', async () => {
  await withServer(async ({ ledger, base }) => {
    ledger.recordIntent({ agent: 'a', run: 'r', kind: 'tool_call', action: 'x' });
    const res = await fetch(`${base}/api/prove/0`);
    assert.equal(res.status, 404);
    assert.match((await res.json()).error, /not covered by any anchor/);
  });
});
