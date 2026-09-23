#!/usr/bin/env bash
#
# Reproduce the whole claim on your own machine, end to end, in about a minute.
#
#   bash examples/localnet-roundtrip.sh
#
# It starts a local Solana validator, runs the demo agent, hits the approval
# gate, approves one intent as a human would, anchors the batch on chain, reads
# it back, proves one event's inclusion, then tampers with a past line and
# shows both detections firing. Nothing here touches devnet or mainnet, and no
# faucet or captcha is involved — that is the point of having it.
#
# Requires: node >= 20, solana-test-validator + solana-keygen (Agave 2.x).
# Everything it writes lives under a temp dir that is removed on exit.
set -euo pipefail

# Ports are overridable so this never fights an already-running validator:
#   RPC_PORT=8999 FAUCET_PORT=9999 bash examples/localnet-roundtrip.sh
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC_PORT="${RPC_PORT:-8899}"
FAUCET_PORT="${FAUCET_PORT:-9900}"
RPC="http://127.0.0.1:${RPC_PORT}"
# Made with node so the path is native on every platform: git-bash's own /tmp
# is not the same directory the Windows `node.exe` and `solana.exe` resolve.
WORK="$(node -e "const os=require('os'),fs=require('fs'),p=require('path');process.stdout.write(fs.mkdtempSync(p.join(os.tmpdir(),'agentproof-roundtrip-')).split(p.sep).join('/'))")"
LEDGER="$WORK/ledger"
VALIDATOR_PID=""

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

cleanup() {
  [ -n "$VALIDATOR_PID" ] && kill "$VALIDATOR_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
}
trap cleanup EXIT

for binary in node solana-test-validator solana-keygen; do
  command -v "$binary" >/dev/null 2>&1 || { echo "missing: $binary" >&2; exit 127; }
done

cd "$REPO"

say "0. tests (no network)"
npm test 2>&1 | tail -n 8

say "1. make an anchor key (outside the repo, as the README insists)"
KEYPAIR="$WORK/anchor-key.json"
solana-keygen new --no-bip39-passphrase --silent --outfile "$KEYPAIR"
PUBKEY="$(solana-keygen pubkey "$KEYPAIR")"
echo "anchor key: $PUBKEY"

say "2. start a local validator that funds that key at genesis"
# --mint gives the key its balance in the genesis block, so there is no faucet
# to rate-limit us and no captcha to solve. That is the whole reason this
# reproduction exists: the public devnet faucet is not always available.
solana-test-validator   --ledger "$WORK/validator" --reset --quiet   --rpc-port "$RPC_PORT" --faucet-port "$FAUCET_PORT"   --mint "$PUBKEY"   >"$WORK/validator.log" 2>&1 &
VALIDATOR_PID=$!
READY=""
for _ in $(seq 1 90); do
  if node -e "
    const {Connection}=require('@solana/web3.js');
    new Connection('$RPC','confirmed').getVersion().then(()=>process.exit(0),()=>process.exit(1));
  " 2>/dev/null; then READY=1; break; fi
  sleep 1
done
if [ -z "$READY" ]; then
  echo "validator never came up — its log follows:" >&2
  tail -n 20 "$WORK/validator.log" >&2
  echo "if a validator is already running, retry with e.g. RPC_PORT=8999 FAUCET_PORT=9999" >&2
  exit 1
fi
echo "validator up (pid $VALIDATOR_PID), balance: $(solana balance --keypair "$KEYPAIR" --url "$RPC" 2>/dev/null || echo 'see below')"

export AGENTPROOF_KEYPAIR="$KEYPAIR"
export AGENTPROOF_RPC_URL="$RPC"

say "3. the agent runs and is stopped by the gate"
node examples/warung-agent-demo.js --dir "$LEDGER" --reset

say "4. a human approves exactly one intent"
INTENT="$(node src/cli.js pending --dir "$LEDGER" --json | node -e "
  let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{
    const p=JSON.parse(s); const hit=(p.pending??p).find(i=>i.action==='rent_gpu_hour');
    if(!hit){console.error('no gated rent_gpu_hour intent found');process.exit(1);}
    console.log(hit.hash);
  });")"
node src/cli.js approve --dir "$LEDGER" --intent "$INTENT" --approver "roundtrip-script"
node src/cli.js execute --dir "$LEDGER" --intent "$INTENT" --result '{"invoiceUsd":0.74}'

say "5. anchor the batch on chain"
node src/cli.js anchor --dir "$LEDGER"

say "6. read it back off chain"
node src/cli.js verify --dir "$LEDGER" --online
echo "verify exit code: $?  (0 = VERIFIED)"

say "7. prove one event was in the anchored batch"
node src/cli.js prove --dir "$LEDGER" --seq 8

say "8. the negative case — edit history and get caught"
LEDGER="$LEDGER" node -e "
  const fs=require('fs'), p=process.env.LEDGER+'/ledger.jsonl';
  const lines=fs.readFileSync(p,'utf8').split('\n');
  const i=lines.findIndex(l=>l.includes('rent_gpu_hour'));
  if(i<0){console.error('nothing to tamper with');process.exit(1);}
  lines[i]=lines[i].replace(/0\.74/, '999.99').replace(/\"estimatedUsd\":[0-9.]+/, '\"estimatedUsd\":999.99');
  fs.writeFileSync(p, lines.join('\n'));
  console.log('tampered line', i, '(a past cost was rewritten)');
"
set +e
node src/cli.js verify --dir "$LEDGER" --online
CODE=$?
set -e
echo "verify exit code: $CODE  (4 = FAILED, which is the expected result here)"
[ "$CODE" -eq 4 ] || { echo "EXPECTED exit 4 after tampering, got $CODE" >&2; exit 1; }

say "done — chain break and on-chain root MISMATCH both fired"
