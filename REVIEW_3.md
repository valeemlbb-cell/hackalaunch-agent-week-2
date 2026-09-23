# REVIEW_3 — token-holder vote audit (agent-week-2 / agentproof)

Reviewer: Judge 3. Date 2026-09-24. Lens: a $HACKA token holder deciding where
the 0.7136 SOL (~$81) pool goes in the 24h vote after close (Sep 30 12:59 UTC →
Oct 1 12:59 UTC). Pool = 0.5 SOL sponsor + 0.2128 SOL fees; 90% to pool, 10% to
$HACKA buybacks.

**Score: 76 / 100.** Yes, I would vote for this over a typical submission —
but on repo substance, not on the submission as it currently presents.

## What I verified myself
- `npm test` → **43 pass, 0 fail** (0.5 s, no network). Claim is true.
- Repo is live and **public**: `git ls-remote` succeeds unauthenticated on
  `https://github.com/valeemlbb-cell/hackalaunch-agent-week-2`, at the same
  commit as local `main` (`12a1c7e`). RUN.md step 1 is stale.
- The hackathon page already lists **agentproof as submitted** (by
  @lowkeyyyy999, one submission total at time of check). So the live submission
  exists — edits, not a fresh submit, are what is needed.
- `demo_small.mp4`: 1280x720 h264 + aac, **120.9 s** (under 3 min), 3.44 MB,
  mean volume −22.2 dB / max −3.3 dB (audible, not clipped). Fine to upload.
- Source is small and readable (2,198 lines incl. web + tests), one runtime dep
  (`@solana/web3.js`), MIT, `.env.example` only, `.gitignore` blocks
  `*keypair*.json` / `id.json` / `*.pem` / `*.key` / `.env`. No secrets found.
- Hard rules: devnet-only guard present and test-covered; no program deployed;
  no admin backdoor path around the gate; human approval is the product itself.
  All clean.

## The single change that would most raise its odds
**Get a real devnet anchor signature and put the Solana Explorer link in the
first three lines of the README, the description, and the video thumbnail.**

This is a *Solana* hackathon judged by token holders who skim. Right now the
most prominent honest sentence in the packet is "What is not in this repo: a
devnet transaction signature." A voter who reads nothing else concludes
"library, not a Solana project." The fix is ~5 minutes of human time (faucet
captcha for `FRFQ4EJD9GjirLBaEqFncZ2R6hudbwjMkrH7vijTqgtg`, then
`anchor` + `verify --online`), already documented in RUN.md step 2. Nothing
else on this list moves votes nearly as much.

## Concrete fixes, ranked

1. **CRITICAL — no public demo video URL.** `SUBMISSION.md` still carries the
   literal `<DEMO_URL>` placeholder and `demo_small.mp4` is only inside the
   repo. If the live submission's video field is empty or a GitHub blob link,
   the "demo video ≤ 3 min" requirement reads as unmet to a voter who will not
   click through to raw MP4. Upload `demo_small.mp4` to YouTube (unlisted is
   fine, public is better) or X @issue0x, then edit the live submission and
   `SUBMISSION.md` with the real URL.
2. **HIGH — devnet signature.** As above. Then rewrite "Verification status" so
   it opens with the devnet explorer link and keeps the localnet transcript as
   supporting evidence, not as the headline.
3. **HIGH — README opens with prose, not proof.** First screenful should be:
   one-line pitch, a dashboard screenshot (PNG, ~200 KB) showing three gated
   intents waiting, the explorer link, and the `npm test → 43 passing` line.
   The ASCII flow diagram is good and should stay, but move it below the
   screenshot. Voters decide in ~15 seconds on a GitHub page.
4. **MEDIUM — RUN.md is out of date and risks a duplicate submission.** Step 1
   tells the owner to `gh repo create ... --push`, but the repo is already
   pushed; step 3 tells them to submit, but the submission is already live.
   Rewrite both as "already done — verify only", and add a step 0: "confirm the
   payout wallet `7W31iaCmjerN1jkpEnmZevn74SZxv83yEQvLsnc4PS7Q` is set on the
   HackaLaunch profile." A second submit attempt would look sloppy to voters.
5. **MEDIUM — reframe the honesty section without losing it.** The candour is a
   genuine asset and should not be deleted; it is currently just mispositioned
   and over-long (three paragraphs of caveat vs. one of proof). Target: one
   bold line of what was proven, one line of what was not, link to transcript.
6. **MEDIUM — nothing lets a voter try it in one command.** Add a single
   copy-paste line near the top:
   `npx github:valeemlbb-cell/hackalaunch-agent-week-2 serve` (or publish to
   npm as `agentproof`). A voter who runs it once is far likelier to vote.
7. **LOW — add a GitHub Actions workflow running `npm test` on push**, and the
   green badge at the top of the README. Cheap, and "43 passing" becomes a
   verified claim rather than an assertion.
8. **LOW — no vote-drive asset in the packet.** The winner is chosen by a
   token-holder vote, so reach matters as much as quality. There is a
   `promo-agent-week-2` dashboard action, but no drafted X thread file in the
   repo folder. Prepare `PROMO.md` with a 4-post thread (hook: "your agent
   writes its own log — so it proves nothing"), the 720p clip attached, and a
   pinned-reply link to the submission, for the owner to post manually.
9. **LOW — `examples/sample-ledger/anchors.jsonl` is absent by design.** Once
   fix 2 lands, commit it; a committed real anchor file is a stronger artifact
   than the README paragraph explaining why it is missing.

## Scoring breakdown
| Dimension | Weight | Score | Note |
|---|---|---|---|
| Obviously useful | 25 | 21 | Real, current problem; narrow but sharp scope |
| Actually works | 20 | 18 | 43 tests pass; full round trip proven on localnet |
| Solana-ness | 15 | 8 | No devnet tx in the repo; Memo-only by design |
| Presentation | 20 | 13 | Strong writing, weak first screenful, no public video |
| Trust / honesty | 10 | 10 | Best-in-class disclosure; no backdoor; no secrets |
| Rule compliance | 10 | 6 | Video link unresolved; everything else clean |
| **Total** | **100** | **76** | |

Fixing items 1 and 2 alone moves this to roughly **88**.
