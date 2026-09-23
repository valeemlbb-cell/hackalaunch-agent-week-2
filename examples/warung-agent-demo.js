#!/usr/bin/env node
/**
 * A realistic agent run, recorded through agentproof.
 *
 * This mirrors a real pipeline we run in-house (podcast episode in, short
 * vertical clips out, creator gets an email). The clip pipeline itself is
 * pre-hackathon work and is NOT part of this repo — what is new here is that
 * every step the agent takes is now a signed line in a hash chain, and the
 * three steps that touch money, a mailbox or a public timeline stop dead until
 * a human clears them.
 *
 * Run:  node examples/warung-agent-demo.js [--dir .agentproof] [--reset]
 */
import { rmSync } from 'node:fs';
import { Ledger, ApprovalRequiredError } from '../src/ledger.js';

const args = process.argv.slice(2);
const dirFlag = args.indexOf('--dir');
const DIR = dirFlag !== -1 ? args[dirFlag + 1] : process.env.AGENTPROOF_DIR || '.agentproof';
const RESET = args.includes('--reset');

const AGENT = 'warung-clip-agent';
const RUN = `run-${new Date().toISOString().slice(0, 10)}-01`;

/** What the agent "did" this run. `kind` drives the approval policy. */
const STEPS = [
  { kind: 'tool_call', action: 'fetch_episode', payload: { source: 'rss', episode: 'ep-214', durationSec: 3480 }, result: { bytes: 68_214_512 } },
  { kind: 'tool_call', action: 'transcribe_episode', payload: { model: 'local-whisper-small', episode: 'ep-214' }, result: { words: 9412, language: 'en' } },
  { kind: 'tool_call', action: 'rank_clip_candidates', payload: { episode: 'ep-214', windowSec: 45 }, result: { candidates: 12, kept: 3 } },
  { kind: 'draft', action: 'write_clip_captions', payload: { clips: 3, style: 'karaoke' }, result: { captionFiles: 3 } },
  { kind: 'spend', action: 'rent_gpu_hour', payload: { vendor: 'runpod', hours: 1, estimatedUsd: 0.74, reason: 'burn captions into 3 clips' } },
  { kind: 'outbound', action: 'email_creator_with_clips', payload: { to: 'creator@example.com', subject: '3 clips from ep-214', attachments: 3 } },
  { kind: 'publish', action: 'post_clip_to_x', payload: { account: '@issue0x', clip: 'ep-214-clip-1.mp4', copy: 'the 40-second version of ep 214' } },
];

function line(text = '') {
  process.stdout.write(`${text}\n`);
}

function main() {
  if (RESET) rmSync(DIR, { recursive: true, force: true });
  const ledger = new Ledger(DIR);
  ledger.init();

  line(`agentproof demo — ledger at ${ledger.dir}`);
  line('');

  const gatedIntents = [];

  for (const step of STEPS) {
    const intent = ledger.recordIntent({ agent: AGENT, run: RUN, kind: step.kind, action: step.action, payload: step.payload });
    const gate = intent.requiresApproval ? 'GATED' : 'open ';
    line(`  [${gate}] #${String(intent.seq).padStart(2, '0')} ${step.action}  ${intent.hash.slice(0, 16)}…`);

    try {
      ledger.execute({ intentHash: intent.hash, result: step.result ?? {} });
      line(`           executed`);
    } catch (err) {
      if (!(err instanceof ApprovalRequiredError)) throw err;
      gatedIntents.push(intent);
      line(`           BLOCKED — waiting on a human`);
    }
  }

  const report = ledger.audit();
  line('');
  line(`  chain: ${report.chain.ok ? 'INTACT' : 'BROKEN'} · ${report.stats.events} events · ${report.stats.pending} waiting on a human`);
  line('');
  line('Next:');
  line(`  npx agentproof serve --dir ${DIR}       # approve or refuse in the dashboard`);
  line(`  npx agentproof anchor --dir ${DIR}      # commit the batch root to Solana devnet`);
  line(`  npx agentproof verify --dir ${DIR} --online`);
  if (gatedIntents.length > 0) {
    line('');
    line('Or from the terminal:');
    line(`  npx agentproof approve --dir ${DIR} --intent ${gatedIntents[0].hash} --approver "your name"`);
  }
}

main();
