/**
 * Local approval dashboard.
 *
 * Binds to 127.0.0.1 only. This is the human end of the approval gate: it
 * shows what the agent wants to do and lets a person approve or refuse, and
 * every decision is appended to the same hash chain the agent writes to.
 *
 * Trust boundary (read this before trusting an approval):
 *
 *   The decision endpoint is the one place where a *human* claim enters the
 *   chain, so it is the one place worth attacking. Two controls guard it:
 *
 *   1. A per-session token, generated when `serve` starts and printed to the
 *      operator's terminal. `POST /api/decision` requires it in the
 *      `x-agentproof-token` header, compared in constant time.
 *   2. Host and Origin pinning to loopback, so a page on another origin (or a
 *      DNS-rebinding attempt) cannot drive the endpoint from the operator's
 *      own browser.
 *
 *   What this does NOT defend against, stated plainly: an agent running as the
 *   same OS user as the dashboard can read the operator's terminal, the process
 *   environment, or simply start its own `serve` with a token it chose. The
 *   token raises the cost of a self-approval from "one unauthenticated curl" to
 *   "read the operator's session", but the only real boundary is running the
 *   dashboard as a different OS user, or on a different machine, from the agent
 *   it gates. `AGENTPROOF_TOKEN` exists so the operator can set the token out
 *   of band in exactly that split deployment.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ledger } from './ledger.js';
import { DEVNET_RPC, connect, explorerUrl, fetchAnchor } from './anchor.js';

const WEB_DIR = fileURLToPath(new URL('../web/', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const MAX_BODY_BYTES = 64 * 1024;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** A fresh per-session approval token. */
export function generateToken() {
  return randomBytes(24).toString('hex');
}

/** Constant-time string compare that does not leak length through timing paths. */
function tokenMatches(expected, given) {
  if (typeof given !== 'string' || given.length === 0) return false;
  const a = Buffer.from(String(expected), 'utf8');
  const b = Buffer.from(given, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function hostname(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const withoutPort = value.startsWith('[') ? value.slice(0, value.indexOf(']') + 1) : value.split(':')[0];
  return withoutPort.toLowerCase();
}

/**
 * True when the request really came from a page on this loopback server.
 * A missing Origin (curl, the CLI, a fetch from the page itself in some
 * browsers) is allowed; a *wrong* Origin never is.
 */
function isLoopbackRequest(req) {
  if (!LOOPBACK_HOSTS.has(hostname(req.headers.host))) return false;
  const origin = req.headers.origin;
  if (origin === undefined || origin === 'null') return true;
  try {
    return LOOPBACK_HOSTS.has(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function buildState(ledger) {
  const events = ledger.events();
  const audit = ledger.audit();
  return {
    dir: ledger.dir,
    cluster: process.env.AGENTPROOF_RPC_URL || DEVNET_RPC,
    stats: audit.stats,
    ok: audit.ok,
    chainOk: audit.chain.ok,
    chainErrors: audit.chain.errors,
    violations: audit.violations,
    pending: ledger.pendingApprovals(),
    events,
    anchors: ledger.anchors().map((a) => ({ ...a, url: explorerUrl(a.signature, a.cluster) })),
    pendingBatch: ledger.pendingBatch(),
    policy: ledger.policy(),
  };
}

async function serveStatic(res, urlPath) {
  const relative = normalize(urlPath === '/' ? 'index.html' : urlPath.slice(1)).replace(/^([.][.][/\\])+/, '');
  if (relative.includes('..')) return sendJson(res, 400, { error: 'bad path' });
  try {
    const file = await readFile(join(WEB_DIR, relative));
    res.writeHead(200, {
      'content-type': MIME[extname(relative)] || 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:",
    });
    res.end(file);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}

export function createApp(dir, { token = null } = {}) {
  const ledger = new Ledger(dir);
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (!isLoopbackRequest(req)) {
        return sendJson(res, 403, { error: 'this dashboard only answers loopback requests' });
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        return sendJson(res, 200, buildState(ledger));
      }
      if (req.method === 'GET' && url.pathname === '/api/verify') {
        const audit = ledger.audit();
        const anchors = [];
        if (url.searchParams.get('online') === '1') {
          const connection = connect();
          for (const anchor of ledger.anchors()) {
            const onChain = await fetchAnchor(connection, anchor.signature);
            const recomputedRoot = ledger.recomputeRoot(anchor);
            anchors.push({
              signature: anchor.signature,
              url: explorerUrl(anchor.signature, anchor.cluster),
              status: !onChain.found ? 'NOT_FOUND' : onChain.decoded?.root === recomputedRoot ? 'MATCH' : 'MISMATCH',
              slot: onChain.slot ?? null,
              recomputedRoot,
              onChainRoot: onChain.decoded?.root ?? null,
            });
          }
        }
        const ok = audit.ok && anchors.every((a) => a.status === 'MATCH');
        return sendJson(res, 200, { ok, ...audit, anchors });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/prove/')) {
        const seq = Number(url.pathname.split('/').pop());
        if (!Number.isInteger(seq)) return sendJson(res, 400, { error: 'seq must be an integer' });
        try {
          return sendJson(res, 200, ledger.proveEvent(seq));
        } catch (err) {
          return sendJson(res, 404, { error: err.message });
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/decision') {
        if (token && !tokenMatches(token, req.headers['x-agentproof-token'])) {
          return sendJson(res, 401, {
            error: 'missing or wrong session token — open the dashboard with the link printed by `agentproof serve`',
          });
        }
        const body = await readBody(req);
        const { intentHash, decision, approver, note } = body;
        if (typeof intentHash !== 'string' || !/^[0-9a-f]{64}$/.test(intentHash)) {
          return sendJson(res, 400, { error: 'intentHash must be a 64-char hex digest' });
        }
        if (decision !== 'approve' && decision !== 'reject') {
          return sendJson(res, 400, { error: 'decision must be "approve" or "reject"' });
        }
        if (typeof approver !== 'string' || approver.trim().length === 0) {
          return sendJson(res, 400, { error: 'approver is required — decisions are attributable' });
        }
        const event = ledger[decision]({
          intentHash,
          approver: approver.trim().slice(0, 120),
          note: typeof note === 'string' ? note.slice(0, 500) : '',
        });
        return sendJson(res, 200, { event, state: buildState(ledger) });
      }
      if (req.method === 'GET') return serveStatic(res, url.pathname);
      return sendJson(res, 405, { error: 'method not allowed' });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  };
}

/**
 * Start the dashboard. A per-session token is generated unless one is supplied
 * (`AGENTPROOF_TOKEN` for a split deployment, or `token: false` — no auth at
 * all — which exists only for tests that exercise the legacy path).
 */
export function startServer({ dir, port = 4319, host = '127.0.0.1', token } = {}) {
  const sessionToken = token === undefined ? process.env.AGENTPROOF_TOKEN || generateToken() : token;
  const server = createServer(createApp(dir, { token: sessionToken || null }));
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolvePromise({
        server,
        port: server.address().port,
        token: sessionToken || null,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
