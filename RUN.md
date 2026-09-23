# RUN.md — what the owner has to do

Everything below needs a human: the agent that built this repo is not allowed
to authenticate to GitHub, push, connect a wallet, post on social, or submit on
a platform.

Two of these are **blocking** for the submission (1 and 2). The rest are
improvements, in order of how much a token-holder voter will care.

---

## 0. The repo is already public — no push needed

**<https://github.com/valeemlbb-cell/hackalaunch-agent-week-2>** — pushed,
public, MIT, README rendering. Use that URL in the submission form.

For provenance, the line that created it was:

```bash
gh repo create valeemlbb-cell/hackalaunch-agent-week-2 --public --source=. --push
```

To push later work (the fixes in this round included), from the repo directory:

```bash
git push
```

## 1. BLOCKING — host the demo video and replace `<DEMO_URL>`

Upload **`demo_small.mp4`** (720p, 3.4 MB, 2:01 — under X's size limit and
under its 2:20 non-premium runtime cap) to X as @issue0x, or to YouTube as
unlisted/public. An agent must not post on your behalf, so this is yours.

Then replace the placeholder in **three** places:

| File | Where |
|---|---|
| `SUBMISSION.md` | the "Demo video" row of the form-fields table |
| `SUBMISSION.md` | the `Demo:` line inside the paste-ready description |
| `README.md` | the first bullet of "See it in 30 seconds" |

```bash
grep -rn '<DEMO_URL>' README.md SUBMISSION.md     # should return nothing when done
git commit -am "docs: public demo link" && git push
```

## 2. BLOCKING for the "devnet" claim — get a real devnet anchor (~5 min)

The README currently says, honestly, that the round trip was proven on a local
validator because the public devnet faucet returned 429 all night. A clickable
devnet signature is the single biggest upgrade left.

1. Fund this devnet pubkey — the faucet has a captcha, so it has to be you:
   **`FRFQ4EJD9GjirLBaEqFncZ2R6hudbwjMkrH7vijTqgtg`** at
   <https://faucet.solana.com>. 0.05 SOL is plenty; one anchor costs about
   0.000005 SOL. The matching keypair is already on the build machine in the
   Solana config directory as `agentproof-devnet.json` — **outside** the repo,
   and `.gitignore` blocks `*keypair*.json` so it cannot be committed by
   accident.
   *If the faucet keeps 429ing:* an Alchemy or Helius devnet faucet works, or
   send a little devnet SOL from any funded devnet key you already have.
2. Then:

```bash
export AGENTPROOF_KEYPAIR="$HOME/.config/solana/agentproof-devnet.json"
export AGENTPROOF_RPC_URL="https://api.devnet.solana.com"
node src/cli.js anchor --dir examples/sample-ledger
node src/cli.js verify --dir examples/sample-ledger --online   # expect RESULT: VERIFIED
```

3. That writes `examples/sample-ledger/anchors.jsonl` with a real devnet
   signature. Commit it, then put the explorer link in **two** places: the
   first paragraph of the README's "See it in 30 seconds", and the description
   in `SUBMISSION.md`. Replace the "devnet signature pending" wording in the
   README's Verification status section with the link.

**If you cannot get devnet SOL before the deadline, do nothing** — the current
wording already leads with "verified on a real validator (localnet), devnet
signature pending" and ships a script anyone can run:

```bash
bash examples/localnet-roundtrip.sh     # proves the whole claim locally, no faucet
```

## 3. Worth doing — rename the repo to `agentproof`

`hackalaunch-agent-week-2` sits next to eleven identically named sibling repos
all pushed within ninety seconds of each other. To a voter that reads as one of
twelve lottery tickets rather than a project. GitHub redirects the old URL, so
the link already in `SUBMISSION.md` keeps working:

```bash
gh repo rename agentproof --repo valeemlbb-cell/hackalaunch-agent-week-2
```

Then update the URL in `README.md` and `SUBMISSION.md` (cosmetic — the redirect
covers it either way).

## 4. Submit on HackaLaunch

Go to <https://hackalaunch.com/h/agent-week-2/submit> and paste the description
block from [`SUBMISSION.md`](SUBMISSION.md), with the repo URL from step 0 and
the video URL from step 1.

The dashboard at `D:\warung-ops\actions.json` has one-click buttons for this
(`hacka-agent-week-2-*`): they open the page and copy the text.

Deadline: **Sep 30, 12:59 AM UTC**. Voting runs the 24 hours after that.

Note from the QA pass: the live hackathon page already lists a submission named
**"agentproof"** — check whether that is ours (a duplicate from an earlier
attempt) or a name collision with another team, before submitting a second one.

## 5. Payout address

Winner payouts go to the wallet registered on HackaLaunch. Ours:
`7W31iaCmjerN1jkpEnmZevn74SZxv83yEQvLsnc4PS7Q`. Confirm it is set on the
profile before submitting — an agent cannot connect or verify a wallet.

---

## Local checks (no network, no keys)

```bash
npm install
npm test                                   # 48 passing
node examples/warung-agent-demo.js --dir .agentproof --reset
node src/cli.js serve --dir .agentproof    # prints the dashboard URL + session token
```

`serve` now prints a one-time approval token and a link that carries it.
Approvals without that token are refused — see README → "Trust boundary".

Full on-chain round trip, locally, in about a minute:

```bash
bash examples/localnet-roundtrip.sh
```
