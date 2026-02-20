/**
 * End-to-end integration test: XRPL x402 payment flow via serve402.com
 *
 * Flow:
 *   1. Load test wallet from ~/.serve402_test_wallet
 *   2. Check wallet XRP balance before payment
 *   3. Make POST /xrpl/fetch without payment → expect 402
 *   4. Parse 402 payment requirements (amount, payTo, network, asset, invoiceId)
 *   5. Use x402Fetch to automatically sign + retry → expect 200
 *   6. Verify response body contains real content
 *   7. Check wallet balance after to confirm payment deducted
 *   8. Write full results to data/test-results.log
 *
 * Usage:
 *   npx tsx scripts/test-xrpl-payment.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client, Wallet } from 'xrpl';
import {
  x402Fetch,
  decodePaymentRequiredHeader,
  HEADER_PAYMENT_REQUIRED,
} from 'x402-xrpl';

// ─── Config ──────────────────────────────────────────────────────────────────

const GATEWAY_URL = 'https://serve402.com/xrpl/fetch';
const TARGET_URL = 'https://example.com';
const XRPL_WS_URL = 'ws://xrpl.carbonvibe.com:6006'; // local node, no rate limits
const NETWORK_FILTER = 'xrpl:0';                      // XRPL mainnet
const SCHEME_FILTER = 'exact';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(__dirname, '..', 'data', 'test-results.log');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

const lines: string[] = [];

function log(...args: unknown[]): void {
  const msg = `[${now()}] ${args.map(String).join(' ')}`;
  console.log(msg);
  lines.push(msg);
}

function logSection(title: string): void {
  const bar = '═'.repeat(60);
  const msg = `\n${bar}\n  ${title}\n${bar}`;
  console.log(msg);
  lines.push(msg);
}

function saveLog(): void {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LOG_FILE, lines.join('\n') + '\n', 'utf-8');
  console.log(`\n📄 Full results saved → ${LOG_FILE}`);
}

/** Parse KEY=VALUE dotenv file, return a record. */
function parseDotenv(filePath: string): Record<string, string> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    result[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return result;
}

/** Get XRP balance for an address via the already-connected Client. */
async function getXrpBalance(client: Client, address: string): Promise<number> {
  const resp = await client.request({
    command: 'account_info',
    account: address,
    ledger_index: 'validated',
  });
  const drops = BigInt(resp.result.account_data.Balance);
  return Number(drops) / 1_000_000; // convert drops → XRP
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logSection('serve402.com — XRPL x402 Integration Test');
  log('Test started');

  // ── 1. Load test wallet ──────────────────────────────────────────────────

  logSection('Step 1: Load Test Wallet');
  const walletFile = path.join(os.homedir(), '.serve402_test_wallet');
  if (!fs.existsSync(walletFile)) {
    throw new Error(`Test wallet file not found: ${walletFile}`);
  }
  const env = parseDotenv(walletFile);
  const seed = env['XRPL_TEST_SEED'];
  const expectedAddress = env['XRPL_TEST_ADDRESS'];
  if (!seed) throw new Error('XRPL_TEST_SEED not found in wallet file');

  const wallet = Wallet.fromSeed(seed);
  log(`Wallet address:    ${wallet.address}`);
  log(`Expected address:  ${expectedAddress}`);
  if (wallet.address !== expectedAddress) {
    throw new Error(
      `Address mismatch! Derived ${wallet.address} but expected ${expectedAddress}`,
    );
  }
  log('✅ Wallet verified');

  // ── 2. Check balance before ───────────────────────────────────────────────

  logSection('Step 2: Pre-payment Balance');
  log(`Connecting to XRPL node: ${XRPL_WS_URL}`);
  const client = new Client(XRPL_WS_URL);
  await client.connect();
  log('Connected to XRPL node');

  let balanceBefore: number;
  try {
    balanceBefore = await getXrpBalance(client, wallet.address);
    log(`Balance before: ${balanceBefore.toFixed(6)} XRP`);
  } catch (err) {
    throw new Error(`Failed to fetch balance: ${err}`);
  }

  // ── 3. Manual 402 probe (no payment header) ───────────────────────────────

  logSection('Step 3: Probe — Expect 402 Payment Required');
  log(`POST ${GATEWAY_URL}  body: {"url":"${TARGET_URL}"}`);

  const probeResp = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: TARGET_URL }),
  });

  log(`Response status: ${probeResp.status} ${probeResp.statusText}`);
  if (probeResp.status !== 402) {
    const body = await probeResp.text();
    throw new Error(
      `Expected 402 but got ${probeResp.status}. Body: ${body.slice(0, 500)}`,
    );
  }
  log('✅ Got 402 Payment Required — good!');

  // ── 4. Parse payment requirements ─────────────────────────────────────────

  logSection('Step 4: Parse Payment Requirements');

  const paymentRequiredHeader = probeResp.headers.get(HEADER_PAYMENT_REQUIRED);
  if (!paymentRequiredHeader) {
    // Try lowercase variants
    const raw =
      probeResp.headers.get('payment-required') ??
      probeResp.headers.get('x-payment-required');

    if (!raw) {
      // Dump all headers so we can debug
      log('All response headers:');
      probeResp.headers.forEach((v, k) => log(`  ${k}: ${v}`));
      throw new Error('No payment-required header found in 402 response');
    }
    log(`Found payment header under alternate key`);
    const paymentRequired = decodePaymentRequiredHeader(raw);
    log(`Payment required (decoded):`, JSON.stringify(paymentRequired, null, 2));
  } else {
    const paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader);
    log(`Raw header: ${HEADER_PAYMENT_REQUIRED}: ${paymentRequiredHeader.slice(0, 80)}…`);
    log(`\nDecoded payment requirements:`);
    log(JSON.stringify(paymentRequired, null, 2));

    const accepts = paymentRequired.accepts ?? [];
    log(`\nPayment options count: ${accepts.length}`);
    for (const [i, req] of accepts.entries()) {
      log(`\n  Option [${i}]:`);
      log(`    network:  ${req.network ?? 'n/a'}`);
      log(`    scheme:   ${req.scheme ?? 'n/a'}`);
      log(`    asset:    ${req.asset ?? 'n/a'}`);
      log(`    amount:   ${req.maxAmountRequired ?? req.amount ?? 'n/a'}`);
      log(`    payTo:    ${req.payTo ?? req.pay_to ?? 'n/a'}`);
      if (req.extra && typeof req.extra === 'object') {
        const extra = req.extra as Record<string, unknown>;
        log(`    invoiceId: ${extra['invoiceId'] ?? extra['invoice_id'] ?? 'n/a'}`);
      }
    }
  }

  // ── 5. x402Fetch — automatic sign + retry ─────────────────────────────────

  logSection('Step 5: x402Fetch — Signed Payment + Retry');
  log('Building x402Fetch client...');
  log(`  wsUrl:         ${XRPL_WS_URL}`);
  log(`  networkFilter: ${NETWORK_FILTER}`);
  log(`  schemeFilter:  ${SCHEME_FILTER}`);

  const fetchPaid = x402Fetch({
    wallet,
    wsUrl: XRPL_WS_URL,
    networkFilter: NETWORK_FILTER,
    schemeFilter: SCHEME_FILTER,
  });

  log('Sending paid request...');
  const paidResp = await fetchPaid(GATEWAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: TARGET_URL }),
  });

  log(`\nPaid response status: ${paidResp.status} ${paidResp.statusText}`);

  // ── 6. Verify 200 + body ──────────────────────────────────────────────────

  logSection('Step 6: Verify Response');

  const responseBody = await paidResp.text();
  log(`Response body length: ${responseBody.length} chars`);
  log(`Body preview (first 500 chars):\n${responseBody.slice(0, 500)}`);

  if (paidResp.status !== 200) {
    throw new Error(
      `Expected 200 but got ${paidResp.status}. Body: ${responseBody.slice(0, 500)}`,
    );
  }
  if (responseBody.length < 50) {
    throw new Error(`Response body suspiciously short (${responseBody.length} chars) — payment may have failed`);
  }

  log('\n✅ Got 200 with real content — payment accepted!');

  // Log payment-response header if present
  const paymentResponseHeader =
    paidResp.headers.get('PAYMENT-RESPONSE') ??
    paidResp.headers.get('payment-response');
  if (paymentResponseHeader) {
    log(`\nPAYMENT-RESPONSE header: ${paymentResponseHeader.slice(0, 200)}…`);
  }

  // ── 7. Check balance after ────────────────────────────────────────────────

  logSection('Step 7: Post-payment Balance');

  // Brief delay to let ledger close
  log('Waiting 5 seconds for ledger to close...');
  await new Promise(r => setTimeout(r, 5000));

  const balanceAfter = await getXrpBalance(client, wallet.address);
  log(`Balance before: ${balanceBefore.toFixed(6)} XRP`);
  log(`Balance after:  ${balanceAfter.toFixed(6)} XRP`);

  const deltaDrops = Math.round((balanceBefore - balanceAfter) * 1_000_000);
  const deltaXrp = (balanceBefore - balanceAfter).toFixed(6);

  if (deltaDrops > 0) {
    log(`\n✅ Payment confirmed: ${deltaDrops} drops (${deltaXrp} XRP) deducted`);
  } else if (deltaDrops === 0) {
    log('\n⚠️  Balance unchanged — ledger may not have closed yet (check manually)');
  } else {
    log(`\n⚠️  Balance actually INCREASED by ${Math.abs(deltaDrops)} drops (unexpected)`);
  }

  await client.disconnect();
  log('Disconnected from XRPL node');

  // ── 8. Summary ───────────────────────────────────────────────────────────

  logSection('Test Summary');
  log('RESULT: ✅ PASS');
  log(`Target URL:     ${TARGET_URL}`);
  log(`Gateway URL:    ${GATEWAY_URL}`);
  log(`Wallet:         ${wallet.address}`);
  log(`Balance before: ${balanceBefore.toFixed(6)} XRP`);
  log(`Balance after:  ${balanceAfter.toFixed(6)} XRP`);
  log(`Drops paid:     ${deltaDrops > 0 ? deltaDrops : 'unknown (ledger pending)'}`);
  log(`Content size:   ${responseBody.length} chars`);
  log('Test completed successfully 🎉');

  saveLog();
}

main().catch(err => {
  log(`\n❌ TEST FAILED: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) {
    log(err.stack);
  }
  saveLog();
  process.exit(1);
});
