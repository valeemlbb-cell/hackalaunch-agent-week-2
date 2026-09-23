#!/usr/bin/env node
/**
 * agentproof CLI.
 *
 * Every command is a thin shell over src/ledger.js and src/anchor.js so the
 * same behaviour is available to a human at a terminal and to an agent calling
 * the library directly.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ledger, ApprovalRequiredError } from './ledger.js';
import {
  connect,
  buildMemo,
  explorerUrl,
  fetchAnchor,
  loadKeypair,
  sendAnchor,
} from './anchor.js';
import { startServer } from './server.js';

const DEFAULT_DIR = process.env.AGENTPROOF_DIR || '.agentproof';

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
    } else {
      positional.push(token);
    }
  }
  return { command, flags, positional };
}

function parseJsonFlag(value, name) {
  if (value === undefined) return {};
  if (typeof value !== 'string') return {};
  try {
    return JSON.parse(value);
  } catch (err) {
    throw new Error(`--${name} must be valid JSON: ${err.message}`);
  }
}

const USAGE = `agentproof — tamper-evident receipts + human-approval gate for AI agents (Solana devnet)

Usage: agentproof <command> [--flags]

  init                                     create ledger dir and default policy
  record   --agent A --run R --kind K --action X [--payload '{...}']
  pending                                  list intents waiting on a human
  approve  --intent <hash> --approver NAME [--note "..."]
  reject   --intent <hash> --approver NAME [--note "..."]
  execute  --intent <hash> [--result '{...}']
  anchor   [--agent A]                     anchor unanchored events on devnet
  verify   [--online]                      audit the chain (and anchors on devnet)
  prove    --seq N                         Merkle inclusion proof for one event
  serve    [--port 4319]                   read + approve dashboard on localhost

Common flags: --dir <path> (default ${DEFAULT_DIR}), --json
Env: AGENTPROOF_DIR, AGENTPROOF_RPC_URL, AGENTPROOF_KEYPAIR
`;

function out(flags, human, data) {
  if (flags.json) console.log(JSON.stringify(data, null, 2));
  else console.log(human);
}

export async function run(argv) {
  const { command, flags } = parseArgs(argv);
  const ledger = new Ledger(flags.dir || DEFAULT_DIR);

  switch (command) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(USAGE);
      return 0;

    case 'init': {
      const dir = ledger.init();
      out(flags, `initialised agentproof ledger at ${dir}`, { dir });
      return 0;
    }

    case 'record': {
      ledger.init();
      const event = ledger.recordIntent({
        agent: flags.agent,
        run: flags.run,
        kind: flags.kind,
        action: flags.action,
        payload: parseJsonFlag(flags.payload, 'payload'),
      });
      out(
        flags,
        `intent #${event.seq} ${event.hash}\n  action: ${event.action}\n  gate:   ${event.requiresApproval ? 'HUMAN APPROVAL REQUIRED' : 'open'}`,
        event,
      );
      return 0;
    }

    case 'pending': {
      const pending = ledger.pendingApprovals();
      out(
        flags,
        pending.length === 0
          ? 'nothing waiting on a human'
          : pending.map((e) => `#${e.seq} ${e.hash.slice(0, 16)}…  ${e.action}`).join('\n'),
        pending,
      );
      return 0;
    }

    case 'approve':
    case 'reject': {
      const fn = command === 'approve' ? 'approve' : 'reject';
      const event = ledger[fn]({
        intentHash: String(flags.intent),
        approver: String(flags.approver || 'unknown'),
        note: typeof flags.note === 'string' ? flags.note : '',
      });
      out(flags, `${command}d intent ${String(flags.intent).slice(0, 16)}… (event #${event.seq})`, event);
      return 0;
    }

    case 'execute': {
      try {
        const event = ledger.execute({
          intentHash: String(flags.intent),
          result: parseJsonFlag(flags.result, 'result'),
        });
        out(flags, `executed intent ${String(flags.intent).slice(0, 16)}… (event #${event.seq})`, event);
        return 0;
      } catch (err) {
        if (err instanceof ApprovalRequiredError) {
          console.error(`BLOCKED  ${err.message}`);
          return 3;
        }
        throw err;
      }
    }

    case 'anchor': {
      const batch = ledger.pendingBatch();
      if (!batch) {
        out(flags, 'nothing to anchor — every event is already covered', { anchored: false });
        return 0;
      }
      const agent = flags.agent || ledger.events()[batch.firstSeq]?.agent || 'agent';
      const memo = buildMemo({ ...batch, agent });
      const connection = connect(flags.rpc);
      const payer = loadKeypair(flags.keypair);
      const signature = await sendAnchor(connection, payer, memo);
      const record = {
        ...batch,
        agent,
        signature,
        cluster: connection.rpcEndpoint,
        payer: payer.publicKey.toBase58(),
        at: new Date().toISOString(),
      };
      ledger.recordAnchor(record);
      out(
        flags,
        `anchored ${batch.count} event(s) [${batch.firstSeq}..${batch.lastSeq}]\n  root: ${batch.root}\n  tx:   ${signature}\n  ${explorerUrl(signature, connection.rpcEndpoint)}`,
        record,
      );
      return 0;
    }

    case 'verify': {
      const report = ledger.audit();
      const anchorReports = [];
      if (flags.online) {
        const connection = connect(flags.rpc);
        for (const anchor of ledger.anchors()) {
          const onChain = await fetchAnchor(connection, anchor.signature);
          // Compare the on-chain root against a root re-derived from the file
          // on disk right now, not against the root we wrote down earlier.
          const recomputedRoot = ledger.recomputeRoot(anchor);
          const status = !onChain.found
            ? 'NOT_FOUND'
            : onChain.decoded?.root === recomputedRoot
              ? 'MATCH'
              : 'MISMATCH';
          anchorReports.push({
            signature: anchor.signature,
            status,
            slot: onChain.slot ?? null,
            recomputedRoot,
            onChainRoot: onChain.decoded?.root ?? null,
            url: explorerUrl(anchor.signature, anchor.cluster),
          });
        }
      }
      const ok = report.ok && anchorReports.every((a) => a.status === 'MATCH');
      const lines = [
        `chain:      ${report.chain.ok ? 'INTACT' : 'BROKEN'} (${report.stats.events} events)`,
        `gate:       ${report.violations.length === 0 ? 'no violations' : `${report.violations.length} VIOLATION(S)`}`,
        `approvals:  ${report.stats.approvals} approved, ${report.stats.rejections} rejected, ${report.stats.pending} pending`,
        ...report.chain.errors.map((e) => `  ! seq ${e.seq}: ${e.reason}`),
        ...report.violations.map((v) => `  ! seq ${v.seq}: [${v.type}] ${v.detail}`),
        ...anchorReports.map((a) => `anchor ${a.signature.slice(0, 16)}…  ${a.status}  slot ${a.slot ?? '-'}`),
        ok ? 'RESULT: VERIFIED' : 'RESULT: FAILED',
      ];
      out(flags, lines.join('\n'), { ok, ...report, anchors: anchorReports });
      return ok ? 0 : 4;
    }

    case 'prove': {
      const proof = ledger.proveEvent(Number(flags.seq));
      out(
        flags,
        `event #${proof.seq} (${proof.action})\n  leaf:  ${proof.eventHash}\n  steps: ${proof.proof.length}\n  root:  ${proof.root}\n  tx:    ${proof.anchor.signature}\n  ${proof.valid ? 'INCLUDED in the anchored batch' : 'NOT INCLUDED'}`,
        proof,
      );
      return proof.valid ? 0 : 5;
    }

    case 'serve': {
      const port = Number(flags.port || process.env.AGENTPROOF_PORT || 4319);
      const server = await startServer({ dir: ledger.dir, port });
      console.log(`agentproof dashboard on http://127.0.0.1:${server.port} (ledger: ${ledger.dir})`);
      return null; // keep running
    }

    default:
      console.error(`unknown command "${command}"\n\n${USAGE}`);
      return 1;
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  run(process.argv.slice(2))
    .then((code) => {
      if (code !== null && code !== undefined) process.exit(code);
    })
    .catch((err) => {
      console.error(`error: ${err.message}`);
      process.exit(2);
    });
}
