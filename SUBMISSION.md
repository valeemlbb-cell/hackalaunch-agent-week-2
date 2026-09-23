# SUBMISSION — Agent Week (hackalaunch.com/h/agent-week-2)

## Form fields

| Field | Value |
|---|---|
| Project name | **agentproof** |
| Public GitHub repository | `https://github.com/valeemlbb-cell/hackalaunch-agent-week-2` |
| Demo video (public link) | **`<DEMO_URL>` — NOT YET SET.** Upload `demo_small.mp4` (720p, 3.4 MB, 2:01) to X @issue0x or YouTube, paste the link here and in the description below. `grep -rn '<DEMO_URL>' README.md SUBMISSION.md` must return nothing before you submit. |
| Short description | the block under **Description** below |
| Solana payout address | `7W31iaCmjerN1jkpEnmZevn74SZxv83yEQvLsnc4PS7Q` |

Local artefacts: `demo_small.mp4` (720p, 3.4 MB, 2:01) is committed and is the
file to upload — under X's size limit, and its 121 s runtime is under the
2 min 20 s non-premium cap. The 1080p master `demo.mp4` (10.6 MB) stays on the
build machine at `D:\warung-ops\hacka\agent-week-2\demo.mp4` and is no longer
tracked in git: 14 MB of video was most of the clone.

## One-paragraph description

agentproof gives an AI agent two things its own log can never give it: a gate
that a human has to open before the agent spends money, sends mail, publishes,
touches credentials or deletes anything, and a receipt of what it actually did
that nobody — including the operator — can quietly edit afterwards. Every
intent, approval, refusal and execution is sealed into an append-only hash
chain; batches are summarised by a Merkle root and that root is written to
Solana as an SPL Memo, so re-deriving the root from the file on disk and
comparing it with the chain turns "trust my log" into a check anyone can run.

## Built during the hackathon vs before

**During Agent Week (everything in the repo):** the hash-chain ledger, the
canonical event encoding, the Merkle tree and inclusion proofs, the policy
engine and approval gate, the offline auditor, the Solana anchor/verify path,
the CLI, the localhost approval dashboard, 48 tests, README, and the demo.

**Before the hackathon (NOT in the repo, not imported):** our in-house clip
pipeline at `D:\warung-ops`, which is only the *story* behind
`examples/warung-agent-demo.js` — that example is a small standalone script
written during the hackathon that mimics the pipeline's seven steps. No
pre-hackathon code, assets or dependencies were copied in.

## Requirements, point by point

| Requirement | How it is met |
|---|---|
| Public GitHub repository | `https://github.com/valeemlbb-cell/hackalaunch-agent-week-2`, MIT licence, README at root |
| Demo video ≤ 3 minutes | 2:01, English voice-over, real terminal + real dashboard, no slides; `demo_small.mp4` (720p) committed, 1080p master held locally |
| Description | above |
| An agent-related build | the project exists only to make agent actions gateable and auditable; the demo drives a seven-step agent run |
| Solana | anchoring writes a Merkle root to Solana via SPL Memo (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`); `verify --online` reads it back |
| Devnet only, no mainnet money | the RPC endpoint is checked and any non-devnet/testnet/localnet URL is refused; a test covers the refusal |
| No secrets in the repo | `.env.example` only; `.gitignore` blocks `*keypair*.json`, `id.json`, `*.pem`, `*.key`, `.env` |
| No admin backdoor | there is no override path around the gate; the offline auditor re-checks the gate from the raw file, so a patched runtime still leaves a provable `ungated_execution` violation |
| Human approval on anything outbound | `spend`, `outbound`, `publish`, `credential`, `destructive` are gated by default and unknown kinds fail closed; the approval endpoint itself needs a per-session token printed to the operator's terminal, so the gated agent cannot approve itself over loopback |
| Licensing | MIT; no bundled fonts or art |
| AI disclosure | stated in the README and in the description |

## Description (paste this into the form)

Replace `<DEMO_URL>` with the public video link before pasting.

---

**agentproof — tamper-evident receipts and a human-approval gate for AI agents, anchored on Solana devnet**

Repo: https://github.com/valeemlbb-cell/hackalaunch-agent-week-2
Demo: <DEMO_URL> (2:01)
Payout: 7W31iaCmjerN1jkpEnmZevn74SZxv83yEQvLsnc4PS7Q
Licence: MIT

An agent that can spend money, send email and post publicly writes its own log
— so the log proves nothing. agentproof adds the two pieces that are missing.

**1. A gate, not a suggestion.** Actions are classified by a reviewable
`policy.json`. Gated kinds (`spend`, `outbound`, `publish`, `credential`,
`destructive`) cannot execute until a named human approves them; `execute()`
throws, and the refusal is written into the log. An unknown action kind fails
closed, so an agent cannot dodge the gate by inventing a new kind.

**2. A receipt nobody can quietly edit — including the operator.** Every event
is sealed with SHA-256 over a canonical encoding of its contents plus the hash
of the previous event. Batches are summarised by a Merkle root, and that root
is written to Solana as an SPL Memo transaction. `verify --online` re-derives
the root *from the file on disk right now* and compares it to what is on chain,
so a ledger edited after anchoring reports MISMATCH even when the edit is
internally consistent. `prove --seq N` gives a Merkle inclusion proof for any
single event.

The gate is checked twice — at runtime, and again offline by an auditor reading
the raw file — so an agent patched to skip the runtime check still leaves a
provable `ungated_execution` violation.

**What is in the repo:** a CLI, a library, and a localhost-only approval
dashboard (no framework, no build step). 48 tests, all passing, no network
needed to run them. MIT licence, no fonts or art bundled.

**The gate defends against the agent it gates.** Approving requires a
per-session token that `serve` prints to the operator's terminal, and the
endpoint pins Host and Origin to loopback — otherwise an agent that can spawn a
process could curl its own approval and leave a cryptographically perfect but
attributively false entry. The README states plainly what that does and does
not buy: the only real boundary is running the dashboard as a different OS user
than the agent.

**Solana:** devnet only. No program deployed, no mints; anchoring uses SPL Memo
(`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`) because the only claim needed
is "this root existed at this slot". The code hard-refuses any RPC endpoint
that is not devnet/testnet/localnet, and that refusal is covered by a test.

**Honesty, since this is a hackathon and the README says it too:** the full
round trip — anchor, read back off chain, match, and the negative case where an
edited ledger fails — was verified against a real Solana validator, but a
*local* one: the public devnet faucet returned HTTP 429 for the entire build
window, so the anchor key could not be funded and its captcha needs a human.
Same code path, one RPC URL apart. We did not fabricate a devnet signature.
Rather than ask you to trust a paste, the run is a script:
`bash examples/localnet-roundtrip.sh` boots a validator, funds the key at
genesis, drives the gate, anchors, verifies (exit 0), then tampers with a past
line and exits 4. About a minute, no faucet involved.

**AI disclosure:** built by a human operator working with Claude as a coding
agent. Architecture, threat model and every factual claim above were reviewed
by the operator; the test counts and terminal output come from actually running
the thing. All code in the repo was written during Agent Week — the in-house
clip pipeline that inspired the example is pre-hackathon work and is **not**
included or imported.
