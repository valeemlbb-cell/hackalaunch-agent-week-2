# REVIEW_1 — hostile judge audit of `agent-week-2` (agentproof)

Reviewer: Judge 1. Date: 2026-09-24 03:4x WIB. Scope: read-only audit of
`D:\warung-ops\hacka\agent-week-2` + re-read of https://hackalaunch.com/h/agent-week-2.

## Rules re-read (live page)

The page carries no explicit rules block ("Rules" section renders only the title
repeated). Concrete facts: closes **Sep 30, 12:59 AM UTC**; voting Sep 30 → Oct 1
12:59 AM UTC, token-holder weighted; pool ~0.71 SOL (~$81); 90% of claims to the
pool, 10% to $HACKA buybacks; every future claim forwarded to the winner's wallet.
Platform default therefore applies: public repo + README, demo video ≤ 3 min,
description. The page already lists one submission named **agentproof** — confirm
whether that is ours (someone submitted already) or a name collision by another
team; if it is a collision it is a serious positioning problem for the vote.

## Disqualifier hunt — result: NO DISQUALIFIER FOUND

| Check | Verdict | Evidence |
|---|---|---|
| Secrets / keys in repo | CLEAN | `git ls-files` = 29 files, no `.env`, no keypair, no PEM. Regex sweep for private keys / 64-int arrays / api keys: only hit is `mainnet-beta` inside `test/anchor.test.js` as the *blocked* URL. `.gitignore` blocks `.env`, `*keypair*.json`, `id.json`, `*.pem`, `*.key`. |
| `.env.example` present | PASS | Present, documented, no real values; keypair path explicitly "outside this repo". |
| Mainnet money | CLEAN | `assertNonMainnet` + `MainnetBlockedError`, test-covered. No mint, no deployed program, SPL Memo only. |
| Demo functional / not faked | PASS with a caveat | `npm test` re-run by me: **43/43 pass, 453 ms, no network**. Video is a real recording. Caveat below (no devnet signature). |
| Video length | PASS | ffprobe: `demo.mp4` 120.92 s, `demo_small.mp4` 120.93 s → 2:01, under the 3:00 cap with 59 s of margin. 3.4 MB fits X's limit. |
| Unlicensed assets | CLEAN | MIT LICENSE at root. One runtime dep (`@solana/web3.js`, Apache-2.0). No bundled fonts/art; dashboard uses system stacks + CSS marks. |
| Plagiarism / pre-hackathon code | CLEAN as stated | README + SUBMISSION both mark pre-hackathon work and state nothing is imported. `examples/warung-agent-demo.js` is standalone. Nothing in `src/` resembles vendored code. |
| Admin backdoor | NO backdoor in the chain, but see F3 | No path marks an intent approved without appending an attributable `approval` event; `audit()` re-checks the gate from the raw file, producing `ungated_execution`. |
| Human-approval gate | PASS | Gated kinds `spend/outbound/publish/credential/destructive`; unknown kind fails closed; `execute()` throws `ApprovalRequiredError`; exit code 3. |
| PII | CLEAN | Only `creator@example.com` / `someone@example.com` in fixtures. |
| Repo public | PASS | https://github.com/valeemlbb-cell/hackalaunch-agent-week-2 is live, public, MIT, README rendering, 2 commits. |

Nothing here justifies a DQ. What follows is what costs votes.

## Findings (ordered by damage)

**F1 — BLOCKING DELIVERABLE: the demo video has no public URL.**
`SUBMISSION.md` still carries the literal placeholder `<DEMO_URL>` in both the
field table and the paste-ready description. A submission pasted as-is ships a
broken deliverable and is the one thing on this list that *can* be read as
"missing demo video". Fix: upload `demo_small.mp4` to YouTube (unlisted is
usually accepted; public is safer) or X @issue0x, then replace both occurrences.
Owner-only step — agents must not post.

**F2 — The headline claim is not proven on the network the title names.**
Title and description say "anchored on Solana devnet"; the repo contains no
devnet signature and no `anchors.jsonl`, only a localnet transcript authored by
us. A hostile judge reads that as: the Solana part was never run on the stated
cluster, and the sole evidence is a text file we wrote. The honesty section is
the right call and should stay, but the gap is fixable in 5 minutes. Fix: fund
`FRFQ4EJD9GjirLBaEqFncZ2R6hudbwjMkrH7vijTqgtg` at faucet.solana.com (human,
captcha), run `node src/cli.js anchor --dir examples/sample-ledger` then
`verify --online`, commit `anchors.jsonl`, and put the explorer link in the
README's first paragraph plus the submission description. If the faucet still
429s by Sep 29, alternatives: Alchemy/Helius devnet faucet, or a devnet SOL
transfer from any funded devnet key. Failing that, rewrite the verification
section to lead with "verified against a real validator (localnet); devnet
signature pending" rather than burying it.

**F3 — The approval gate is bypassable by the very agent it gates (local, no auth).**
`src/server.js` binds 127.0.0.1 and `POST /api/decision` accepts any
`approver` string with no token, no origin check, no CSRF token. The threat
model in the README is "operator can't quietly edit the log" — but the agent
runs on the same host, so an agent that can spawn a process can `curl -X POST
127.0.0.1:4319/api/decision -d '{"decision":"approve","approver":"henggar",...}'`
and open its own gate, leaving a chain entry that is cryptographically perfect
and attributively false. That is the single strongest attack a judge who reads
the code will raise, and "localhost only" is not an answer when the adversary is
local. Fix (small): `serve` prints a random per-session token to the operator's
terminal, requires it as a header on `/api/decision`, and the README states
plainly that the token is the out-of-band channel and that a compromised host
with terminal access defeats it. Even documenting the boundary honestly ("the
gate assumes the agent cannot read the operator's terminal") is worth more than
silence. Also add `Origin`/`Host` validation so a page in the operator's browser
cannot drive the endpoint.

**F4 — Inconsistent repo URL across the packet.**
`RUN.md` tells the owner to create `warung-ops/agentproof` (and still says "push
it yourself"), while `SUBMISSION.md`, `PUSHED.json` and reality all say
`valeemlbb-cell/hackalaunch-agent-week-2` — already pushed at 03:19. A judge who
follows RUN.md lands nowhere. Fix: rewrite RUN.md step 1 to "already pushed,
URL = …", keep the `gh repo create` line only as provenance.

**F5 — Repo name and account advertise a 12-hackathon spray.**
`hackalaunch-agent-week-2` under `valeemlbb-cell` sits next to eleven sibling
repos all named `hackalaunch-*`, all pushed inside 90 seconds (`PUSHED.json`).
Voters are token holders who will click the profile. Nothing dishonest, but it
reframes a serious project as one of twelve lottery tickets. Fix: rename this
repo to `agentproof` (GitHub redirects the old URL, so the pushed link keeps
working), and consider staggering or making the others less uniform.

**F6 — Two copies of the video inflate the clone.**
`demo.mp4` (10.6 MB) + `demo_small.mp4` (3.4 MB) = 14 MB of the repo. Once the
video has a public URL (F1), drop `demo.mp4` from the repo and link it, or keep
only the 720p file. Minor, but `git clone` time is a first impression.

**F7 — The localnet transcript is unreproducible.**
`examples/localnet-transcript.md` is pasted output. Add the exact commands as a
runnable `examples/localnet-roundtrip.sh` (start `solana-test-validator`, init,
demo, anchor, verify, tamper, verify → MISMATCH) so a judge can reproduce the
claim in one command instead of trusting our paste.

**F8 — Nothing in the repo tells a voter what to click.**
No live link and no 30-second "try it" path beyond `npm install`. This
hackathon's page lists no such requirement (two sibling hackathons do), but a
voter with 20 submissions open will not clone. Fix: a 6-line "See it in 30
seconds" block at the very top of the README — `npx agentproof` quick path, plus
the demo link once F1 lands.

## Score

**84 / 100.** No disqualifier, real working code, honest disclosure, tests
verified by me rather than claimed. Points off for: the placeholder demo URL
(−6, it is a missing deliverable until fixed), the unproven devnet anchor
against a title that asserts it (−5), the un-authenticated approval endpoint in
a project whose entire pitch is a gate (−3), and packet inconsistency /
presentation (−2).

Fix F1 and F3 and this is a 93.
