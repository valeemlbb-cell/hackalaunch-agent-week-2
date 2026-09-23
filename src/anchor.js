/**
 * Solana anchoring.
 *
 * A batch of agent events is summarised by one Merkle root, and that root is
 * written to Solana as an SPL Memo instruction. The transaction signature then
 * acts as a public, timestamped commitment: the agent operator cannot later
 * rewrite history, because the root of the old history is already on chain.
 *
 * We deliberately use the Memo program rather than a custom on-chain program:
 * the trust model only needs "this 32-byte root existed at this slot", and the
 * Memo program provides exactly that with no deploy step and no upgrade
 * authority to trust.
 *
 * SAFETY: this module refuses to talk to Solana mainnet. Devnet / testnet /
 * localnet only.
 */
import { readFileSync } from 'node:fs';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
export const MEMO_PREFIX = 'agentproof/v1 ';
export const DEVNET_RPC = 'https://api.devnet.solana.com';
/** SPL Memo caps a memo at 566 bytes; ours is far smaller, but check anyway. */
export const MAX_MEMO_BYTES = 566;

const ALLOWED_HOST_PATTERNS = [/devnet/i, /testnet/i, /localhost/i, /127\.0\.0\.1/, /\blocalnet\b/i];

export class MainnetBlockedError extends Error {
  constructor(endpoint) {
    super(`refusing to anchor against "${endpoint}": agentproof is devnet-only by design`);
    this.name = 'MainnetBlockedError';
  }
}

export function assertNonMainnet(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length === 0) throw new MainnetBlockedError(String(endpoint));
  if (!ALLOWED_HOST_PATTERNS.some((re) => re.test(endpoint))) throw new MainnetBlockedError(endpoint);
  return true;
}

export function connect(endpoint = process.env.AGENTPROOF_RPC_URL || DEVNET_RPC) {
  assertNonMainnet(endpoint);
  return new Connection(endpoint, 'confirmed');
}

/**
 * Load the fee payer from a Solana CLI keypair file (array of 64 bytes).
 * The path comes from the environment; no key material ever lives in this repo.
 */
export function loadKeypair(path = process.env.AGENTPROOF_KEYPAIR) {
  if (!path) {
    throw new Error('AGENTPROOF_KEYPAIR is not set — point it at a devnet keypair JSON file outside this repo');
  }
  const secret = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(secret)) throw new Error(`${path} is not a Solana keypair JSON array`);
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

/** Build the memo payload for a batch. Deterministic and small. */
export function buildMemo({ root, firstSeq, lastSeq, count, agent }) {
  const body = { r: root, f: firstSeq, l: lastSeq, n: count, a: agent };
  const memo = MEMO_PREFIX + JSON.stringify(body);
  const size = Buffer.byteLength(memo, 'utf8');
  if (size > MAX_MEMO_BYTES) throw new RangeError(`memo is ${size} bytes, max is ${MAX_MEMO_BYTES}`);
  return memo;
}

/** Inverse of buildMemo. Returns null when the string is not one of ours. */
export function parseMemo(memo) {
  if (typeof memo !== 'string') return null;
  const start = memo.indexOf(MEMO_PREFIX);
  if (start === -1) return null;
  try {
    const body = JSON.parse(memo.slice(start + MEMO_PREFIX.length));
    if (typeof body.r !== 'string') return null;
    return { root: body.r, firstSeq: body.f, lastSeq: body.l, count: body.n, agent: body.a };
  } catch {
    return null;
  }
}

export function memoInstruction(memo, signer) {
  return new TransactionInstruction({
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memo, 'utf8'),
  });
}

/** Send one anchor transaction. Returns the signature. */
export async function sendAnchor(connection, payer, memo) {
  assertNonMainnet(connection.rpcEndpoint);
  const tx = new Transaction().add(memoInstruction(memo, payer.publicKey));
  return sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' });
}

/** Read an anchor back off chain and decode it. */
export async function fetchAnchor(connection, signature) {
  assertNonMainnet(connection.rpcEndpoint);
  const tx = await connection.getParsedTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) return { found: false, signature };
  const instructions = tx.transaction.message.instructions ?? [];
  let memo = null;
  for (const ix of instructions) {
    if (ix.program === 'spl-memo' && typeof ix.parsed === 'string') memo = ix.parsed;
    else if (ix.programId?.toBase58?.() === MEMO_PROGRAM_ID.toBase58() && ix.data) {
      // Unparsed fallback: instruction data is base58-encoded utf8.
      memo = Buffer.from(ix.data, 'utf8').toString('utf8');
    }
  }
  if (!memo) {
    const logLine = (tx.meta?.logMessages ?? []).find((l) => l.includes('Memo'));
    const match = logLine?.match(/"(.*)"$/s);
    if (match) memo = match[1];
  }
  return {
    found: true,
    signature,
    slot: tx.slot,
    blockTime: tx.blockTime ?? null,
    memo,
    decoded: parseMemo(memo),
  };
}

/**
 * Explorer link for a signature. The cluster is derived from the endpoint the
 * anchor was actually sent to, so a localnet transaction never gets labelled
 * as a devnet one.
 */
export function explorerUrl(signature, endpoint = process.env.AGENTPROOF_RPC_URL || DEVNET_RPC) {
  const base = `https://explorer.solana.com/tx/${signature}`;
  if (/testnet/i.test(endpoint)) return `${base}?cluster=testnet`;
  if (/localhost|127\.0\.0\.1|localnet/i.test(endpoint)) {
    return `${base}?cluster=custom&customUrl=${encodeURIComponent(endpoint)}`;
  }
  return `${base}?cluster=devnet`;
}
