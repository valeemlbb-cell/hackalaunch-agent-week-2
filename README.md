# agentproof

**Tamper-evident receipts and a human-approval gate for autonomous AI agents, anchored on Solana.**

Submitted to [Agent Week](https://hackalaunch.com/h/agent-week-2) on HackaLaunch.

## See it in 30 seconds

* **Watch:** demo video, 2:01 — `<DEMO_URL>` *(public link goes here at submission; the same recording is committed as [`demo_small.mp4`](demo_small.mp4), 3.4 MB)* — the gate stopping an agent mid-run, then the anchor and the tamper check.
* **Run the whole claim yourself:** `bash examples/localnet-roundtrip.sh` — starts a validator, hits the gate, anchors on chain, reads it back, tampers with the log and shows it caught. About a minute, no faucet, no keys of yours.
* **Just the tests:** `npm install && npm test` → 48 passing, no network.
* **The one-line pitch:** an agent's own log proves nothing; this makes the log unforgeable and puts a human in front of anything that spends, sends, publishes or deletes.
* **Honest status:** verified end to end on a real Solana validator (localnet — the public devnet faucet was 429 all build window). Details under [Verification status](#verification-status--read-this-honestly).
* **Files worth opening first:** [`src/ledger.js`](src/ledger.js) (the gate + the offline audit), [`src/anchor.js`](src/anchor.js) (Memo anchoring, mainnet refused).

---

## The problem

An agent that can spend money, send email and post publicly produces a log that
the agent itself writes. If the agent is buggy, jailbroken or simply lying, the
log is worthless: it is a text file the agent can rewrite.

Two things are missing, and `agentproof` supplies both:

1. **A gate.** Some actions must stop and wait for a human. Not a prompt that
   says "please ask first" — a refusal in the execution path.
2. **A receipt nobody can quietly edit afterwards.** Including the operator.

## How it works

```
  agent                       ledger.jsonl                   Solana devnet
    │                      (append-only chain)
    ├─ recordIntent ──────▶ #08 intent  rent_gpu_hour  [GATED]
    │                             │
    ├─ execute ─────────── ✗ ApprovalRequiredError
    │                             │
  human (dashboard/CLI)           │
    ├─ approve ───────────▶ #11 approval  by henggar
    │                             │
    ├─ execute ───────────▶ #12 execution  invoiceUsd 0.74
    │                             │
    └─ anchor ──── merkle root of #00..#12 ──▶ SPL Memo tx  ──▶ signature
```

* Every line is sealed with `sha256` over a canonical encoding of its contents
  **and** the hash of the line above it. Editing or deleting any past line
  breaks every hash after it.
* Batches of events are summarised by a Merkle root, and that root is written
  to Solana as an SPL Memo instruction. The transaction signature is a public,
  timestamped commitment to the log as it stood at that slot.
* `agentproof verify --online` re-derives the Merkle root **from the file on
  disk right now** and compares it to what is on chain. A ledger that was
  edited after anchoring reports `MISMATCH`, even if the edit was internally
  consistent.
* The gate is checked twice: once at runtime by `execute()`, and again offline
  by `audit()` reading the raw file — so an agent that was patched to skip the
  runtime check still leaves a provable `ungated_execution` violation.

### Why the Memo program and not a custom program

The trust model only needs one claim: *this 32-byte root existed at this slot.*
SPL Memo gives exactly that, with no deploy step, no upgrade authority to
trust, and no program account anyone has to keep rent-exempt. A custom Anchor
program would add surface area without adding a guarantee.

---

## Quick start

```bash
npm install
npm test                       # 48 tests, no network needed
node examples/warung-agent-demo.js --dir .agentproof --reset
npx agentproof serve --dir .agentproof     # prints the dashboard link + session token
```

The demo runs a seven-step agent pipeline. Four steps run freely; three
(`rent_gpu_hour`, `email_creator_with_clips`, `post_clip_to_x`) hit the gate
and stop. Open the dashboard and approve or refuse them.

### Anchoring on devnet

```bash
cp .env.example .env            # then edit it
solana-keygen new --outfile ~/.config/solana/agentproof-devnet.json
# fund that pubkey at https://faucet.solana.com (devnet)

export AGENTPROOF_KEYPAIR=~/.config/solana/agentproof-devnet.json
export AGENTPROOF_RPC_URL=https://api.devnet.solana.com

npx agentproof anchor --dir .agentproof
npx agentproof verify --dir .agentproof --online
npx agentproof prove  --dir .agentproof --seq 8
```

### CLI

| command | what it does |
| --- | --- |
| `init` | create the ledger directory and a default policy |
| `record --agent A --run R --kind K --action X [--payload '{…}']` | record an intent |
| `pending` | list intents waiting on a human |
| `approve` / `reject` `--intent <hash> --approver NAME` | a human decides |
| `execute --intent <hash>` | agent reports execution; exits `3` if gated |
| `anchor` | Merkle-root the unanchored tail and write it to devnet |
| `verify [--online]` | audit the chain, and check anchors against the chain |
| `prove --seq N` | Merkle inclusion proof for one event |
| `serve` | local approval dashboard on `127.0.0.1` |

Exit codes: `0` ok, `1` bad usage, `2` error, `3` blocked by the gate,
`4` verification failed, `5` event not included in its anchored batch.

### Policy

`policy.json` in the ledger directory decides what is gated. It is data, so it
can be reviewed and diffed:

```json
{
  "gatedKinds": ["outbound", "spend", "credential", "publish", "destructive"],
  "openKinds":  ["tool_call", "note", "observation", "draft"],
  "overrides":  { "send_test_email_to_self": false }
}
```

An unknown action kind **fails closed** — an agent cannot dodge the gate by
inventing a new kind. If the policy is loosened after the fact, `audit()`
reports `policy_drift` for intents that were recorded as ungated but would be
gated under the current policy.

---

## Networks, program IDs, mints

| | |
| --- | --- |
| Cluster | **Solana devnet only** (testnet and localnet also allowed) |
| Program used | SPL Memo — `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` |
| Programs deployed by this project | **none** |
| Tokens / mints created | **none** |
| Cost per anchor | one memo transaction, ~0.000005 SOL of devnet SOL |

`src/anchor.js` hard-refuses any RPC endpoint that does not look like devnet,
testnet or localnet (`MainnetBlockedError`). This is covered by tests. There is
no code path in this repository that can touch mainnet.

---

## Verification status — read this honestly

**Verified on a real validator; devnet signature pending.** The complete round
trip — build batch → send SPL Memo transaction → read the transaction back off
chain → compare the re-derived Merkle root → tamper with a past line and watch
it fail — runs against a real Solana validator, including the negative case.
You do not have to take our word for any of it:

```bash
bash examples/localnet-roundtrip.sh          # ~1 minute, no faucet, no captcha
# add RPC_PORT=8999 FAUCET_PORT=9999 if you already have a validator running
```

The script starts `solana-test-validator`, funds an anchor key **at genesis**
(so no faucet can rate-limit it), runs the agent into the gate, approves one
intent, anchors, verifies online (`RESULT: VERIFIED`, exit `0`), proves one
event's inclusion, then rewrites a past cost and shows both detections fire —
chain `BROKEN` *and* anchor `MISMATCH`, exit `4`. A captured run of the same
sequence is in [`examples/localnet-transcript.md`](examples/localnet-transcript.md).

**What is not in this repo: a devnet transaction signature.** The public devnet
faucet returned HTTP 429 ("airdrop limit reached / faucet has run dry") for the
whole build window, and `faucet.solana.com` needs a human to pass a captcha,
which the agent that built this is not allowed to do. The code path is
identical — only the RPC URL differs, and `src/anchor.js` accepts devnet,
testnet and localnet alike. We are not going to paste a devnet signature we did
not produce: `examples/sample-ledger/anchors.jsonl` is deliberately absent
rather than faked. Fund the key, run `npx agentproof anchor`, and the same
transcript appears with a link an explorer will resolve.

**What is simulated:** `examples/warung-agent-demo.js` replays a real pipeline's
shape (fetch episode → transcribe → rank clips → caption → pay for GPU → email
creator → post clip) with fixed data. It does not transcribe anything. The
point of the example is the ledger, not the media work.

---

## Pre-hackathon work (disclosure)

HackaLaunch requires existing work to be marked. To be precise:

* **Everything in this repository was written during Agent Week** (September
  2026) for this hackathon. `src/`, `test/`, `web/`, `examples/` — all new.
* The *problem* comes from pre-hackathon work: Warung Ops runs an in-house clip
  pipeline and an outreach queue with a human-approval step. **None of that code
  is in this repo.** The demo example imitates its shape so the ledger has
  something realistic to record; it imports nothing from it.
* Dependencies: `@solana/web3.js` (Apache-2.0) is the only runtime dependency.
  Tests use Node's built-in `node:test`. No fonts, images or third-party art are
  bundled — the dashboard uses system font stacks and CSS-drawn marks only.

## AI usage disclosure

This project was built by a human operator (Warung Ops) working with Claude
(Anthropic) as a coding agent inside Claude Code. The agent wrote most of the
implementation and tests; the architecture, the threat model, the decision to
use SPL Memo over a custom program, and every claim in the "Verification
status" section above were reviewed by the operator. Test results quoted in
this README were produced by actually running `npm test` and the CLI, not
estimated.

Fitting, given the subject: the first thing this tool is useful for is keeping
agents like the one that wrote it honest.

## Trust boundary — who can approve

The approval endpoint is the one place a *human* claim enters the chain, so it
is the one place worth attacking. An unauthenticated localhost endpoint would
mean the agent being gated could `curl` its own approval and produce a
cryptographically perfect but attributively false chain entry. Two controls
guard it:

1. **A per-session token.** `agentproof serve` generates one at start and
   prints it, along with a ready-made link that carries it in the URL
   *fragment* (so it is never sent to the server, logged, or put in a
   `Referer`). `POST /api/decision` requires it in `x-agentproof-token` and
   compares it in constant time. Without it: `401`, and nothing is appended.
2. **Loopback pinning.** `Host` must be loopback and any `Origin` present must
   be loopback too, so neither a page on another site nor a DNS-rebinding
   attempt can drive the endpoint from the operator's own browser. Otherwise:
   `403`.

**What this does not defend against, stated plainly:** an agent running as the
same OS user can read the operator's terminal, read the process environment, or
start its own `serve` with a token it chose. The token turns a self-approval
from "one unauthenticated request" into "compromise the operator's session" —
it does not make it impossible. The only real boundary is running the dashboard
as a **different OS user, or on a different machine**, from the agent it gates;
`AGENTPROOF_TOKEN` exists so the operator can set the token out of band in
exactly that deployment. Five tests cover the refusals
([`test/server.test.js`](test/server.test.js)).

Note what does *not* change under any of this: the gate is also re-checked
offline by `audit()`, so even a fully compromised runtime cannot produce a
ledger that passes verification without an attributable approval event.

## Security notes

* No private keys, seed phrases or API keys are in this repository. The anchor
  keypair is loaded from a path given by `AGENTPROOF_KEYPAIR` at runtime and
  must live outside the repo; `.gitignore` blocks `*keypair*.json` anyway.
* The dashboard binds `127.0.0.1` only and is not intended to be exposed. It
  exposes no endpoint that can execute an agent action — only approve/reject,
  which is the human side of the gate, and that one is token-gated (above).
* Request bodies are capped at 64 KiB, the approval endpoint validates the
  intent hash shape, the approver name and the decision verb, and static file
  serving refuses path traversal (covered by tests).
* There is no admin backdoor: there is no way to mark an intent approved
  without appending an attributable `approval` event to the same chain.

## Layout

```
src/hashchain.js   canonical JSON, sha256, chain sealing and verification
src/merkle.js      domain-separated Merkle tree, proofs
src/policy.js      what needs a human (pure, data-driven, fails closed)
src/ledger.js      append-only store, the gate, the offline audit
src/anchor.js      SPL Memo anchoring + read-back; refuses mainnet
src/server.js      localhost approval dashboard (API + static)
src/cli.js         agentproof CLI
web/               dashboard — no framework, no build step
examples/          demo agent run + committed sample ledger + transcript
test/              48 tests (node:test)
```

## Licence

MIT — see [LICENSE](LICENSE).
