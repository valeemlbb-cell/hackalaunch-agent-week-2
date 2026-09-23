/* Dashboard client. No framework, no build step, no innerHTML with data. */

const $ = (id) => document.getElementById(id);
const APPROVER_KEY = 'agentproof.approver';
const TOKEN_KEY = 'agentproof.token';

let polling = null;

/**
 * The approval token arrives in the URL fragment (`#t=…`) of the link that
 * `agentproof serve` prints. A fragment is never sent to the server and never
 * leaks into a Referer, so we take it once, keep it for this tab only, and
 * scrub it out of the address bar.
 */
function captureToken() {
  const match = /[#&]t=([0-9a-f]{16,128})/i.exec(window.location.hash || '');
  if (match) {
    try { sessionStorage.setItem(TOKEN_KEY, match[1]); } catch { /* private mode */ }
    history.replaceState(null, '', window.location.pathname + window.location.search);
    return match[1];
  }
  try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

function sessionToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function short(hash, n = 10) {
  return typeof hash === 'string' ? `${hash.slice(0, n)}…` : '';
}

function setVerdict(state, text) {
  const box = $('verdict');
  box.dataset.state = state;
  $('verdict-text').textContent = text;
}

function renderStats(stats) {
  $('s-events').textContent = stats.events;
  $('s-gated').textContent = stats.gated;
  $('s-approved').textContent = stats.approvals;
  $('s-rejected').textContent = stats.rejections;
  $('s-pending').textContent = stats.pending;
}

function renderQueue(pending) {
  const list = $('queue');
  list.replaceChildren();
  $('queue-empty').hidden = pending.length > 0;

  for (const intent of pending) {
    const card = el('li', 'card');
    card.append(el('div', 'action', intent.action));

    const payload = { ...intent.payload };
    const kind = payload.actionKind ?? 'unknown';
    delete payload.actionKind;

    card.append(el('div', 'meta', `${intent.agent} · run ${intent.run} · ${kind} · ${short(intent.hash, 16)}`));
    if (Object.keys(payload).length > 0) {
      card.append(el('pre', null, JSON.stringify(payload, null, 2)));
    }

    const row = el('div', 'row');
    const approve = el('button', 'btn approve', 'Approve');
    const reject = el('button', 'btn reject', 'Refuse');
    approve.type = 'button';
    reject.type = 'button';
    approve.addEventListener('click', () => decide(intent.hash, 'approve', [approve, reject]));
    reject.addEventListener('click', () => decide(intent.hash, 'reject', [approve, reject]));
    row.append(approve, reject);
    card.append(row);
    list.append(card);
  }
}

function renderEvents(events) {
  const list = $('events');
  list.replaceChildren();
  for (const event of events.slice().reverse()) {
    const item = el('li', 'ev');
    item.dataset.kind = event.kind;
    item.append(el('span', 'seq', `#${String(event.seq).padStart(3, '0')}`));

    const body = el('span');
    body.append(el('span', 'kind', event.kind));
    const txt = el('span', 'txt');
    const strong = el('b', null, ` ${event.action}`);
    txt.append(strong);
    if (event.kind === 'intent' && event.requiresApproval) txt.append(document.createTextNode(' · gated'));
    if (event.payload?.approver) txt.append(document.createTextNode(` · by ${event.payload.approver}`));
    txt.append(el('span', 'h', ` · ${short(event.hash, 8)}`));
    body.append(txt);
    item.append(body);
    list.append(item);
  }
}

function renderAnchors(anchors, statuses) {
  const box = $('anchors');
  box.replaceChildren();
  $('anchors-empty').hidden = anchors.length > 0;

  for (const anchor of anchors) {
    const status = statuses?.find((s) => s.signature === anchor.signature);
    const row = el('div', 'anchor');
    row.dataset.status = status?.status ?? 'LOCAL';
    row.append(el('span', 'badge', status?.status ?? 'local'));

    const mid = el('span', 'root');
    mid.textContent = `events ${anchor.firstSeq}–${anchor.lastSeq} · root ${short(anchor.root, 24)}`;
    row.append(mid);

    const link = el('a', null, `tx ${short(anchor.signature, 12)}`);
    link.href = anchor.url;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    row.append(link);
    box.append(row);
  }
}

function clusterLabel(url) {
  if (!url) return 'solana';
  if (/devnet/i.test(url)) return 'solana devnet';
  if (/testnet/i.test(url)) return 'solana testnet';
  if (/localhost|127\.0\.0\.1/.test(url)) return 'local validator';
  return url;
}

function applyState(state, anchorStatuses) {
  $('cluster').textContent = clusterLabel(state.cluster);
  renderStats(state.stats);
  renderQueue(state.pending);
  renderEvents(state.events);
  renderAnchors(state.anchors, anchorStatuses);

  if (!state.chainOk || state.violations.length > 0) {
    setVerdict('bad', state.chainOk ? 'gate violation' : 'chain broken');
  } else if (state.stats.pending > 0) {
    setVerdict('wait', `${state.stats.pending} waiting on you`);
  } else {
    setVerdict('ok', 'chain intact');
  }
}

async function refresh() {
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error(`state ${res.status}`);
  applyState(await res.json());
}

async function decide(intentHash, decision, buttons) {
  const approver = $('approver').value.trim();
  if (!approver) {
    $('approver').focus();
    setVerdict('wait', 'name required to sign');
    return;
  }
  localStorage.setItem(APPROVER_KEY, approver);
  buttons.forEach((b) => { b.disabled = true; });
  try {
    const res = await fetch('/api/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agentproof-token': sessionToken() },
      body: JSON.stringify({ intentHash, decision, approver }),
    });
    const data = await res.json();
    if (res.status === 401) {
      throw new Error('no session token — reopen the dashboard using the link printed by `agentproof serve`');
    }
    if (!res.ok) throw new Error(data.error || `decision ${res.status}`);
    applyState(data.state);
  } catch (err) {
    setVerdict('bad', err.message);
    buttons.forEach((b) => { b.disabled = false; });
  }
}

async function recheck() {
  const btn = $('recheck');
  btn.disabled = true;
  btn.textContent = 'Reading chain…';
  try {
    const [verify, state] = await Promise.all([
      fetch('/api/verify?online=1').then((r) => r.json()),
      fetch('/api/state').then((r) => r.json()),
    ]);
    applyState(state, verify.anchors);
    const bad = verify.anchors.filter((a) => a.status !== 'MATCH').length;
    if (verify.anchors.length === 0) setVerdict(verify.ok ? 'ok' : 'bad', 'no anchors yet');
    else setVerdict(bad === 0 && verify.ok ? 'ok' : 'bad', bad === 0 ? 'verified on-chain' : `${bad} anchor mismatch`);
  } catch (err) {
    setVerdict('bad', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Re-verify on-chain';
  }
}

function boot() {
  const token = captureToken();
  if (!token) {
    setVerdict('wait', 'read-only — reopen with the link printed by `agentproof serve` to approve');
  }
  const saved = localStorage.getItem(APPROVER_KEY);
  if (saved) $('approver').value = saved;
  $('recheck').addEventListener('click', recheck);
  refresh().catch((err) => setVerdict('bad', err.message));
  polling = setInterval(() => refresh().catch(() => {}), 2500);
  window.addEventListener('beforeunload', () => clearInterval(polling));
}

boot();
