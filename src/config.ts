import { readFileSync } from "fs";

const network = process.env.NETWORK || "eip155:84532";

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
  facilitatorUrl: process.env.FACILITATOR_URL || "https://x402.org/facilitator",
  network,
  e2bApiKey: process.env.E2B_API_KEY || "",
  cdpApiKeyId: process.env.CDP_API_KEY_ID || "",
  cdpApiKeySecret: cdpSecret,
  version: "0.4.0",
  services: [
    {
      endpoint: "POST /fetch",
      description: "Extract readable content from any URL using headless browser",
      price: "$0.005",
      accepts: [{ scheme: "exact", network, asset: "USDC" }],
    },
    {
      endpoint: "POST /execute",
      description: "Run Python or JavaScript code in an isolated sandbox",
      price: "$0.005",
      accepts: [{ scheme: "exact", network, asset: "USDC" }],
    },
    {
      endpoint: "POST /screenshot",
      description: "Take a screenshot of any URL as PNG or JPEG",
      price: "$0.003",
      accepts: [{ scheme: "exact", network, asset: "USDC" }],
    },
    {
      endpoint: "POST /pdf",
      description: "Generate a PDF from any URL",
      price: "$0.003",
      accepts: [{ scheme: "exact", network, asset: "USDC" }],
    },
  ],
};
