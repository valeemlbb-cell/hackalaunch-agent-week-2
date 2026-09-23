# RUN.md — what the owner has to do

Everything below needs a human: the agent that built this repo is not allowed
to authenticate to GitHub, push, connect a wallet, or submit on a platform.

## 1. Push the repo to GitHub

The repo is already initialised and committed locally (one clean commit).
`gh` is installed but **not authenticated** in this environment, so run this
yourself, from the repo directory:

```bash
gh auth login                 # once, if you are not already signed in
gh repo create warung-ops/agentproof --public --source=. --push
```

If the `warung-ops` org does not exist, use your own account instead:

```bash
gh repo create agentproof --public --source=. --push
```

Then put the resulting URL into the submission text (step 3).

## 2. Optional but worth 5 minutes — get a real devnet anchor

The README says plainly that no devnet signature is included, because the
faucet was returning HTTP 429 all night. If you want one before the deadline:

1. Fund this devnet pubkey at <https://faucet.solana.com> (captcha — has to be
   a human): **`FRFQ4EJD9GjirLBaEqFncZ2R6hudbwjMkrH7vijTqgtg`**
   The matching keypair already exists on the build machine, in the local
   Solana config directory as `agentproof-devnet.json` — **outside** the repo.
   `.gitignore` blocks `*keypair*.json`, so it cannot be committed by accident.
   0.05 SOL is plenty; one anchor costs ~0.000005 SOL.
2. Then:

```bash
export AGENTPROOF_KEYPAIR="$HOME/.config/solana/agentproof-devnet.json"
export AGENTPROOF_RPC_URL="https://api.devnet.solana.com"
node src/cli.js anchor --dir examples/sample-ledger
node src/cli.js verify --dir examples/sample-ledger --online
```

3. That writes `examples/sample-ledger/anchors.jsonl` with a real devnet
   signature. Commit it and edit the "Verification status" section of the
   README to say the devnet anchor is now included, with the explorer link.

## 3. Submit on HackaLaunch

Go to <https://hackalaunch.com/h/agent-week-2/submit> and paste the submission
text from [`SUBMISSION.md`](SUBMISSION.md), with the GitHub URL from step 1 and
the demo video.

The dashboard at `D:\warung-ops\actions.json` has a one-click button for this:
**"$81 · Agent Week — submit agentproof"** (`hacka-agent-week-2`). It opens the
submit page and copies the description to your clipboard.

Deadline: **Sep 30, 12:59 AM UTC**. Voting runs the 24 hours after that.

## 4. Payout address

Winner payouts go to the wallet you register on HackaLaunch. Ours:
`7W31iaCmjerN1jkpEnmZevn74SZxv83yEQvLsnc4PS7Q`. Check it is set on the profile
before submitting — the agent cannot connect or verify a wallet.

## Local checks (no network, no keys)

```bash
npm install
npm test                                   # 43 passing
node examples/warung-agent-demo.js --dir .agentproof --reset
node src/cli.js serve --dir .agentproof    # http://127.0.0.1:4319
```
