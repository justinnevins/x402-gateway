/**
 * x402 payment client for serve402 MCP server.
 *
 * Creates a fetch-compatible function that automatically handles x402 402 Payment Required
 * responses using the x402-fetch library with a viem wallet client.
 *
 * x402 payment flow:
 *   1. Send request normally
 *   2. Server returns HTTP 402 + payment requirements in header
 *   3. x402-fetch parses requirements, signs EIP-712 message with wallet
 *   4. Retry request with X-Payment header containing signed payment
 *   5. Server verifies via CDP facilitator → returns 200 with result
 *
 * Supported payment networks:
 *   base  — USDC on Base mainnet (EVM private key required)
 *   xrpl  — XRP drops on XRPL mainnet (XRPL seed required)
 */

import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { wrapFetchWithPayment } from "x402-fetch";

export interface PaymentClientConfig {
  network: "base" | "xrpl";
  walletPrivateKey?: string;
  xrplSeed?: string;
  baseUrl: string;
}

/**
 * Returns a fetch-compatible function that automatically handles x402 payments.
 *
 * For Base (USDC): creates a viem wallet client and wraps fetch with x402-fetch.
 * For XRPL (XRP):  uses x402-xrpl payment scheme (requires x402-xrpl package).
 *
 * @example
 * ```typescript
 * const paymentFetch = createPaymentClient({
 *   network: 'base',
 *   walletPrivateKey: process.env.SERVE402_WALLET_PRIVATE_KEY,
 *   baseUrl: 'https://serve402.com'
 * });
 *
 * const response = await paymentFetch('https://serve402.com/fetch', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ url: 'https://example.com' })
 * });
 * ```
 */
export function createPaymentClient(
  config: PaymentClientConfig
): (input: RequestInfo, init?: RequestInit) => Promise<Response> {
  const { network, walletPrivateKey, xrplSeed } = config;

  if (network === "base") {
    if (!walletPrivateKey) {
      throw new Error(
        "SERVE402_WALLET_PRIVATE_KEY is required for Base/USDC payments"
      );
    }

    // Create a viem wallet client for EVM signing
    const account = privateKeyToAccount(walletPrivateKey as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      transport: http(),
      chain: base,
    });

    // x402-fetch wraps native fetch and handles 402 → pay → retry automatically
    // maxValue set to $1.00 USDC (1_000_000 base units) — sufficient for all serve402 endpoints
    const maxValue = 1_000_000n; // 1 USDC max per request
    return wrapFetchWithPayment(fetch, walletClient, maxValue);
  }

  // XRPL payment network
  if (!xrplSeed) {
    throw new Error(
      "SERVE402_XRPL_SEED is required for XRPL/XRP payments"
    );
  }

  return createXrplPaymentFetch(xrplSeed);
}

/**
 * Creates an x402-aware fetch for XRPL payments.
 *
 * Attempts to use the x402-xrpl package if installed.
 * Falls back to a manual implementation using the xrpl package directly.
 *
 * For production XRPL payments, install x402-xrpl:
 *   npm install x402-xrpl
 */
function createXrplPaymentFetch(
  seed: string
): (input: RequestInfo, init?: RequestInit) => Promise<Response> {
  return async function xrplPaymentFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    // First attempt — may return 402
    const res = await fetch(input, init);
    if (res.status !== 402) return res;

    // Parse payment requirements from 402 response
    const paymentRequired = res.headers.get("X-Payment-Required");
    if (!paymentRequired) {
      throw new Error("402 response missing X-Payment-Required header");
    }

    let requirements: PaymentRequirements;
    try {
      const decoded = Buffer.from(paymentRequired, "base64").toString("utf-8");
      requirements = JSON.parse(decoded) as PaymentRequirements;
    } catch {
      throw new Error(`Cannot parse X-Payment-Required header: ${paymentRequired}`);
    }

    // Find the XRPL payment requirement
    const xrplReqs = (requirements.paymentRequirements ?? []).filter(
      (r) => r.scheme === "xrpl-exact" || r.network?.startsWith("xrpl:")
    );

    if (xrplReqs.length === 0) {
      throw new Error(
        "No XRPL payment requirement found in 402 response. " +
        "Check that you are using the /xrpl/* route prefix for XRPL payments."
      );
    }

    const req = xrplReqs[0]!;

    // Build and submit XRPL payment
    const paymentHeader = await signAndSubmitXrplPayment(seed, req);

    // Retry with payment proof
    const retryInit: RequestInit = {
      ...(init ?? {}),
      headers: {
        ...(init?.headers ?? {}),
        "X-Payment": paymentHeader,
      },
    };

    return fetch(input, retryInit);
  };
}

interface PaymentRequirements {
  paymentRequirements?: XrplRequirement[];
}

interface XrplPaymentTx {
  TransactionType: "Payment";
  Account: string;
  Destination: string;
  Amount: string;
  Fee: string;
  Sequence: number;
  Flags: number;
}

interface XrplRequirement {
  scheme: string;
  network?: string;
  maxAmountRequired: string;
  resource: string;
  payTo: string;
  asset?: string;
  extra?: {
    facilitatorUrl?: string;
    name?: string;
    version?: string;
  };
}

/** Minimal local XRPL Payment tx shape — avoids requiring the xrpl package at compile time. */
interface XrplPaymentTx {
  TransactionType: "Payment";
  Account: string;
  Destination: string;
  Amount: string;
  Fee: string;
  Sequence: number;
  Flags: number;
}

/**
 * Signs and submits an XRP payment, returning the x402 X-Payment header value.
 *
 * Uses the xrpl package for transaction signing (transitive dependency via x402-xrpl).
 * For production use, prefer installing x402-xrpl which handles this more robustly.
 */
async function signAndSubmitXrplPayment(
  seed: string,
  req: XrplRequirement
): Promise<string> {
  // Dynamic import — xrpl may be available as transitive dep
  let xrpl: typeof import("xrpl");
  try {
    xrpl = await import("xrpl");
  } catch {
    throw new Error(
      "XRPL payment requires the 'xrpl' package. Install it:\n  npm install xrpl\n" +
      "Or use Base/USDC payments instead (set SERVE402_PAYMENT_NETWORK=base)."
    );
  }

  const facilitatorUrl =
    req.extra?.facilitatorUrl ??
    process.env.XRPL_FACILITATOR_URL ??
    "https://xrpl-facilitator-mainnet.t54.ai";

  const wallet = xrpl.Wallet.fromSeed(seed);
  const client = new xrpl.Client("wss://xrplcluster.com");

  try {
    await client.connect();

    const accountInfo = await client.request({
      command: "account_info",
      account: wallet.address,
      ledger_index: "current",
    });

    const sequence = accountInfo.result.account_data.Sequence;

    const tx: XrplPaymentTx = {
      TransactionType: "Payment",
      Account: wallet.address,
      Destination: req.payTo,
      Amount: req.maxAmountRequired, // drops of XRP as string
      Fee: "12",
      Sequence: sequence,
      Flags: 0,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const signed = wallet.sign(tx as any);

    // Submit to x402 XRPL facilitator for verification + relay
    const facilitatorRes = await fetch(`${facilitatorUrl}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        txBlob: signed.tx_blob,
        resource: req.resource,
      }),
    });

    if (!facilitatorRes.ok) {
      const errText = await facilitatorRes.text();
      throw new Error(`XRPL facilitator rejected payment (${facilitatorRes.status}): ${errText}`);
    }

    const result = await facilitatorRes.json() as { paymentHeader?: string; header?: string };
    const header = result.paymentHeader ?? result.header;

    if (!header) {
      throw new Error("XRPL facilitator did not return a payment header");
    }

    return header;
  } finally {
    await client.disconnect();
  }
}
