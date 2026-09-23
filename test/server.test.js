import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { Ledger } from '../src/ledger.js';
import { startServer } from '../src/server.js';

async function withServer(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'agentproof-srv-'));
  const ledger = new Ledger(dir);
  ledger.init();
  const handle = await startServer({ dir, port: 0, token: 'a'.repeat(48) });
  const base = `http://127.0.0.1:${handle.port}`;
  const token = handle.token;
  const decide = (body, headers = {}) =>
    fetch(`${base}/api/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agentproof-token': token, ...headers },
      body: JSON.stringify(body),
    });
  try {
    await fn({ ledger, base, token, decide });
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
  await withServer(async ({ ledger, decide }) => {
    const intent = ledger.recordIntent({ agent: 'a', run: 'r', kind: 'outbound', action: 'send_dm' });

    const res = await decide({ intentHash: intent.hash, decision: 'approve', approver: 'henggar' });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.event.kind, 'approval');
    assert.equal(body.state.stats.pending, 0);
    assert.doesNotThrow(() => ledger.execute({ intentHash: intent.hash }));
  });
});

test('POST /api/decision rejects malformed input', async () => {
  await withServer(async ({ decide }) => {
    const cases = [
      { intentHash: 'nope', decision: 'approve', approver: 'x' },
      { intentHash: 'a'.repeat(64), decision: 'delete', approver: 'x' },
      { intentHash: 'a'.repeat(64), decision: 'approve', approver: '  ' },
    ];
    for (const body of cases) {
      const res = await decide(body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });
});

test('an approval without the session token is refused and appends nothing', async () => {
  await withServer(async ({ ledger, base }) => {
    const intent = ledger.recordIntent({ agent: 'a', run: 'r', kind: 'spend', action: 'rent_gpu_hour' });
    const before = ledger.events().length;

    // This is exactly the attack: a process on the same box curling its own
    // approval into the chain.
    const res = await fetch(`${base}/api/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intentHash: intent.hash, decision: 'approve', approver: 'henggar' }),
    });

    assert.equal(res.status, 401);
    assert.equal(ledger.events().length, before, 'no event may be appended');
    assert.throws(() => ledger.execute({ intentHash: intent.hash }), /approval/i);
  });
});

test('a wrong session token is refused', async () => {
  await withServer(async ({ ledger, decide }) => {
    const intent = ledger.recordIntent({ agent: 'a', run: 'r', kind: 'spend', action: 'rent_gpu_hour' });
    for (const bad of ['b'.repeat(48), 'a'.repeat(47), '', 'a'.repeat(49)]) {
      const res = await decide(
        { intentHash: intent.hash, decision: 'approve', approver: 'henggar' },
        { 'x-agentproof-token': bad },
      );
      assert.equal(res.status, 401, `token ${bad.length} chars`);
    }
    assert.equal(ledger.pendingApprovals().length, 1);
  });
});

test('requests from another origin are refused even with the token', async () => {
  await withServer(async ({ ledger, decide }) => {
    const intent = ledger.recordIntent({ agent: 'a', run: 'r', kind: 'publish', action: 'post_clip_to_x' });
    const res = await decide(
      { intentHash: intent.hash, decision: 'approve', approver: 'henggar' },
      { origin: 'https://evil.example' },
    );
    assert.equal(res.status, 403);
    assert.equal(ledger.pendingApprovals().length, 1);
  });
});

test('a non-loopback Host header is refused (DNS rebinding)', async () => {
  await withServer(async ({ base }) => {
    // fetch() will not let us forge Host, so speak HTTP directly.
    const port = Number(new URL(base).port);
    const status = await new Promise((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port, path: '/api/state', method: 'GET', headers: { host: 'agentproof.example' } },
        (res) => { res.resume(); resolve(res.statusCode); },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 403);
  });
});

test('the token is generated per session when none is supplied', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentproof-tok-'));
  new Ledger(dir).init();
  const previous = process.env.AGENTPROOF_TOKEN;
  delete process.env.AGENTPROOF_TOKEN;
  const a = await startServer({ dir, port: 0 });
  const b = await startServer({ dir, port: 0 });
  try {
    assert.match(a.token, /^[0-9a-f]{48}$/);
    assert.notEqual(a.token, b.token);
  } finally {
    await a.close();
    await b.close();
    if (previous !== undefined) process.env.AGENTPROOF_TOKEN = previous;
  }
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
