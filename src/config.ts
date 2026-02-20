import { readFileSync } from "fs";

const network = process.env.NETWORK || "eip155:84532";
const xrplNetwork = process.env.XRPL_NETWORK || "xrpl:0";

// Read CDP PEM key from file (multi-line PEM cant go in .env)
let cdpSecret = "";
try {
  cdpSecret = readFileSync("/app/cdp_key.pem", "utf-8").trim();
} catch {
  // No PEM file = testnet mode, no CDP auth needed
}

export const config = {
  port: parseInt(process.env.PORT || "3402"),
  walletAddress: process.env.WALLET_ADDRESS || "",
  xrplWalletAddress: process.env.XRPL_WALLET_ADDRESS || "",
  xrplFacilitatorUrl: process.env.XRPL_FACILITATOR_URL || "https://xrpl-facilitator-mainnet.t54.ai",
  xrplNetwork,
  xrplAsset: process.env.XRPL_ASSET || "XRP",
  facilitatorUrl: process.env.FACILITATOR_URL || "https://x402.org/facilitator",
  network,
  e2bApiKey: process.env.E2B_API_KEY || "",
  cdpApiKeyId: process.env.CDP_API_KEY_ID || "",
  cdpApiKeySecret: cdpSecret,
  version: "0.8.0",
  services: [
    {
      endpoint: "POST /fetch",
      description: "Extract readable content from any URL using headless browser",
      price: "$0.005",
      accepts: [
        { scheme: "exact", network, asset: "USDC" },
        { scheme: "exact", network: xrplNetwork, asset: "XRP" },
      ],
    },
    {
      endpoint: "POST /execute",
      description: "Run Python or JavaScript code in an isolated sandbox",
      price: "$0.005",
      accepts: [
        { scheme: "exact", network, asset: "USDC" },
        { scheme: "exact", network: xrplNetwork, asset: "XRP" },
      ],
    },
    {
      endpoint: "POST /screenshot",
      description: "Take a screenshot of any URL as PNG or JPEG",
      price: "$0.003",
      accepts: [
        { scheme: "exact", network, asset: "USDC" },
        { scheme: "exact", network: xrplNetwork, asset: "XRP" },
      ],
    },
    {
      endpoint: "POST /pdf",
      description: "Generate a PDF from any URL",
      price: "$0.003",
      accepts: [
        { scheme: "exact", network, asset: "USDC" },
        { scheme: "exact", network: xrplNetwork, asset: "XRP" },
      ],
    },
    {
      endpoint: "POST /search",
      description: "Search the web using Brave Search API",
      price: "$0.009",
      accepts: [
        { scheme: "exact", network, asset: "USDC" },
        { scheme: "exact", network: xrplNetwork, asset: "XRP" },
      ],
    },
    {
      endpoint: "POST /xrpl-query",
      description: "Query the XRPL ledger via a local node (read-only)",
      price: "$0.002",
      accepts: [
        { scheme: "exact", network, asset: "USDC" },
        { scheme: "exact", network: xrplNetwork, asset: "XRP" },
      ],
    },
    {
      endpoint: "POST /dns",
      description: "DNS record lookup (A, AAAA, MX, TXT, NS, CNAME, SOA, SRV, PTR)",
      price: "$0.002",
      accepts: [
        { scheme: "exact", network, asset: "USDC" },
        { scheme: "exact", network: xrplNetwork, asset: "XRP" },
      ],
    },
    {
      endpoint: "POST /headers",
      description: "Inspect HTTP response headers with security analysis and redirect chain tracking",
      price: "$0.002",
      accepts: [
        { scheme: "exact", network, asset: "USDC" },
        { scheme: "exact", network: xrplNetwork, asset: "XRP" },
      ],
    },
  ],
};
