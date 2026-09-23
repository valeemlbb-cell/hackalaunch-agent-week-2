# End-to-end transcript (real run, local Solana validator)

**You do not have to trust this paste.** The same sequence is a script:

```bash
bash examples/localnet-roundtrip.sh
# RPC_PORT=8999 FAUCET_PORT=9999 bash examples/localnet-roundtrip.sh   # if a validator is already up
```

It funds the anchor key at genesis rather than through a faucet, so it runs
offline and cannot be rate-limited, and it exits non-zero unless the tamper
case really produces `RESULT: FAILED`. Hashes and signatures below differ from
run to run — the *shape* is what is being shown.

Captured while building agentproof. Environment:

```
solana-cli / solana-test-validator 2.1.5 (src:4da190bd; client:Agave)
node v24.19.0
AGENTPROOF_RPC_URL=http://127.0.0.1:8899
```

Localnet is used here only because the public devnet faucet was returning
HTTP 429 for the whole build window (see README → "Verification status").
The code path is byte-for-byte the same; `src/anchor.js` accepts devnet,
testnet and localnet and refuses everything else.

---

## 1. The agent runs and is stopped three times

```
$ node examples/warung-agent-demo.js --dir $E2E

agentproof demo — ledger at ...\e2e

  [open ] #00 fetch_episode  718b48d11fc672ab…
           executed
  [open ] #02 transcribe_episode  c0f8189b94064fce…
           executed
  [open ] #04 rank_clip_candidates  34bdad7e5f5a9622…
           executed
  [open ] #06 write_clip_captions  7cfcc78f2e541b56…
           executed
  [GATED] #08 rent_gpu_hour  65efb7b28f2cddb6…
           BLOCKED — waiting on a human
  [GATED] #09 email_creator_with_clips  633275061e4b25a9…
           BLOCKED — waiting on a human
  [GATED] #10 post_clip_to_x  ceb84ef599468ae4…
           BLOCKED — waiting on a human

  chain: INTACT · 11 events · 3 waiting on a human
```

## 2. A human clears one of them, and only then does it run

```
$ node src/cli.js approve --intent 49c343fc… --approver "henggar"
approved intent 49c343fc5e9263bc… (event #11)

$ node src/cli.js execute --intent 49c343fc… --result '{"invoiceUsd":0.74}'
executed intent 49c343fc5e9263bc… (event #12)
```

## 3. Anchor the batch on chain

```
$ node src/cli.js anchor
anchored 13 event(s) [0..12]
  root: 974c3c6d146fe2c4f043ccd0d4322de4f2a5eb762d1b8efc3e2a93dc3e295535
  tx:   5yqWYZm3V6Qx1oRvhxYMzejWghU9ug4BeXi1ELUHx6Sj3JjJSdNvxXw9Y8GatQHmh8wNQThGj6Y8xG54YYpeHUHg
```

(That signature is on the local validator, not devnet — it will not resolve in
a public explorer. That is exactly why it is labelled here instead of being
committed as `anchors.jsonl`.)

## 4. Read it back off chain and verify

```
$ node src/cli.js verify --online
chain:      INTACT (13 events)
gate:       no violations
approvals:  1 approved, 0 rejected, 2 pending
anchor 5yqWYZm3V6Qx1oRv…  MATCH  slot 174
RESULT: VERIFIED
```

## 5. Prove one specific event was in the anchored batch

```
$ node src/cli.js prove --seq 8
event #8 (rent_gpu_hour)
  leaf:  49c343fc5e9263bc9b795fba71d1ae840d9d24229b7fa2cc1b2cd867e063da53
  steps: 4
  root:  974c3c6d146fe2c4f043ccd0d4322de4f2a5eb762d1b8efc3e2a93dc3e295535
  tx:    5yqWYZm3V6Qx1oRvhxYMzejWghU9ug4BeXi1ELUHx6Sj3JjJSdNvxXw9Y8GatQHmh8wNQThGj6Y8xG54YYpeHUHg
  INCLUDED in the anchored batch
```

## 6. The negative case — edit history and get caught

Change one number in a past line (`estimatedUsd: 0.74` → `999.99`) and re-verify:

```
$ node src/cli.js verify --online
chain:      BROKEN (13 events)
gate:       no violations
approvals:  1 approved, 0 rejected, 2 pending
  ! seq 8: event hash does not match its contents (tampered)
anchor 5yqWYZm3V6Qx1oRv…  MISMATCH  slot 174
RESULT: FAILED
$ echo $?
4
```

Two independent detections fire: the local hash chain no longer validates, and
the Merkle root re-derived from the edited file no longer equals the root that
is already on chain. Restoring the original line returns `RESULT: VERIFIED`.

## 7. Test suite

```
$ npm test
ℹ tests 48
ℹ pass 48
ℹ fail 0
```
