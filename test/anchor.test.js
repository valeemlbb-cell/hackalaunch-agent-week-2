import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  MainnetBlockedError,
  MAX_MEMO_BYTES,
  assertNonMainnet,
  buildMemo,
  explorerUrl,
  parseMemo,
} from '../src/anchor.js';

const root = createHash('sha256').update('root').digest('hex');

test('memo round-trips', () => {
  const memo = buildMemo({ root, firstSeq: 0, lastSeq: 41, count: 42, agent: 'warung-clip-agent' });
  const decoded = parseMemo(memo);
  assert.deepEqual(decoded, { root, firstSeq: 0, lastSeq: 41, count: 42, agent: 'warung-clip-agent' });
});

test('memo stays well under the SPL memo size limit', () => {
  const memo = buildMemo({ root, firstSeq: 0, lastSeq: 999999, count: 1000000, agent: 'a'.repeat(64) });
  assert.ok(Buffer.byteLength(memo, 'utf8') < MAX_MEMO_BYTES);
});

test('parseMemo ignores memos that are not ours', () => {
  assert.equal(parseMemo('gm'), null);
  assert.equal(parseMemo(null), null);
  assert.equal(parseMemo('agentproof/v1 {not json'), null);
});

test('mainnet endpoints are refused', () => {
  assert.throws(() => assertNonMainnet('https://api.mainnet-beta.solana.com'), MainnetBlockedError);
  assert.throws(() => assertNonMainnet('https://my-private-rpc.example.com'), MainnetBlockedError);
  assert.throws(() => assertNonMainnet(''), MainnetBlockedError);
});

test('devnet, testnet and localnet endpoints are allowed', () => {
  assert.equal(assertNonMainnet('https://api.devnet.solana.com'), true);
  assert.equal(assertNonMainnet('https://api.testnet.solana.com'), true);
  assert.equal(assertNonMainnet('http://127.0.0.1:8899'), true);
});

test('explorer url reflects the cluster the anchor was sent to', () => {
  assert.equal(explorerUrl('SIG', 'https://api.devnet.solana.com'), 'https://explorer.solana.com/tx/SIG?cluster=devnet');
  assert.equal(explorerUrl('SIG', 'https://api.testnet.solana.com'), 'https://explorer.solana.com/tx/SIG?cluster=testnet');
  assert.match(explorerUrl('SIG', 'http://127.0.0.1:8899'), /cluster=custom&customUrl=http%3A%2F%2F127\.0\.0\.1%3A8899$/);
});
