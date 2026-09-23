# REVIEW_2 — deliverables checklist audit (judge 2)

Hackathon page re-read 2026-09-24: the "Rules" block on hackalaunch.com/h/agent-week-2
is placeholder text; the only hard facts are close Sep 30 12:59 AM UTC, 24h holder
vote after, pool 0.7136 SOL, future claims forwarded to the winner. So the checklist
is the platform default: public GitHub repo + demo video <= 3 min + description +
payout wallet.

## Checklist

| Item | State |
|---|---|
| Public repo | NOT YET — local git only, 2 clean commits, 30 tracked files, node_modules untracked. RUN.md has the gh line (human step, correct). |
| Repo name consistency | FAIL — RUN.md says `gh repo create warung-ops/agentproof`, SUBMISSION.md + README link `github.com/valeemlbb-cell/hackalaunch-agent-week-2`. Two different URLs; one is wrong. |
| Demo video <= 3 min | Files OK: demo.mp4 120.9 s / 10.6 MB, demo_small.mp4 120.9 s / 3.4 MB. But NO public link yet — SUBMISSION.md still has `<DEMO_URL>`. RUN.md never gives the upload step its own numbered slot. |
| Description | Present, paste-ready, honest. |
| Payout wallet | 7W31iaCmjerN1jkpEnmZevn74SZxv83yEQvLsnc4PS7Q in SUBMISSION.md + RUN.md §4. |
| Tests run and pass | VERIFIED — `npm test` -> 43 pass / 0 fail, 535 ms, no network. `node src/cli.js verify --dir examples/sample-ledger` -> VERIFIED, exit 0. |
| README setup/networks/program IDs | Strong — quick start, CLI table, exit codes, explicit "Networks, program IDs, mints" (devnet only, SPL Memo MemoSq4…fcHr, no programs deployed, no mints). |
| Pre-hackathon work marked | Yes, explicit section; example only imitates the in-house pipeline, imports nothing. |
| Secrets | Clean — `.env.example` only, `.gitignore` blocks `*keypair*.json`/`id.json`/`*.pem`/`*.key`/`.env`; no key material in tracked files. |
| Admin backdoor | None found; gate is re-checked offline by `audit()`. |
| Licence | MIT, LICENSE at root, only runtime dep @solana/web3.js. |

## Weak points

1. **No devnet signature.** Round trip was proven on `solana-test-validator`, not
   devnet (faucet 429). Disclosed honestly and the transcript is committed, but a
   Solana-flavoured hackathon vote will notice "no on-chain link".
2. Repo URL contradiction (above) — a voter clicking the README link before the
   push lands hits a 404.
3. `SUBMISSION.md` with a literal `<DEMO_URL>` ships inside the public repo.
4. `examples/sample-ledger/anchors.jsonl` deliberately absent, so a visitor
   following the README cannot reproduce `verify --online` or `prove` without
   funding a key. Handled gracefully by the code, but it is the one claim a
   reader cannot check themselves.
5. Demo content (real dashboard, real validator) is asserted; I could not watch
   the video, so that claim is unverified by this audit.
6. No CI workflow — a green Actions badge is cheap trust for a 24h holder vote.

## Concrete fixes (ranked)

1. Pick ONE repo name and make RUN.md, README, SUBMISSION.md agree.
2. Add RUN.md step "upload demo_small.mp4, paste the URL into SUBMISSION.md and
   README" as its own numbered action before submit.
3. Fund FRFQ4EJD…Tqgtg, run anchor+verify on devnet, commit anchors.jsonl and put
   the explorer link at the top of README — biggest single score gain.
4. Add `.github/workflows/ci.yml` running `npm test` on node 20/22.
5. Move `SUBMISSION.md` out of the repo (or strip placeholders) before push.
6. Put the one-line pitch + demo link in the GitHub repo description/About.

**Score: 86/100.** Not disqualifying. Deliverables are all buildable in minutes;
the only real gap is that the two artefacts the platform actually checks (public
repo URL, public video URL) do not exist yet, and both are human-only steps.
