# Submission text — Agent Week (hackalaunch.com/h/agent-week-2)

Paste the block below into the submission description. Replace
`<GITHUB_URL>` with the URL from `gh repo create` (see RUN.md).

---

**agentproof — tamper-evident receipts and a human-approval gate for AI agents, anchored on Solana devnet**

Repo: <GITHUB_URL>
Demo: 2:01, `demo.mp4` in the repo root
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
dashboard (no framework, no build step). 43 tests, all passing, no network
needed to run them. MIT licence, no fonts or art bundled.

**Solana:** devnet only. No program deployed, no mints; anchoring uses SPL Memo
(`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`) because the only claim needed
is "this root existed at this slot". The code hard-refuses any RPC endpoint
that is not devnet/testnet/localnet, and that refusal is covered by a test.

**Honesty, since this is a hackathon and the README says it too:** the full
round trip — anchor, read back off chain, match, and the negative case where an
edited ledger fails — was verified against a real Solana validator, but a
*local* one: the public devnet faucet returned HTTP 429 for the entire build
window, so the anchor key could not be funded. Same code path, one RPC URL
apart. We did not fabricate a devnet signature; the transcript is in
`examples/localnet-transcript.md`.

**AI disclosure:** built by a human operator working with Claude as a coding
agent. Architecture, threat model and every factual claim above were reviewed
by the operator; the test counts and terminal output come from actually running
the thing. All code in the repo was written during Agent Week — the in-house
clip pipeline that inspired the example is pre-hackathon work and is **not**
included or imported.
