# serve402 MCP Server

MCP ([Model Context Protocol](https://modelcontextprotocol.io)) server for [serve402.com](https://serve402.com) — pay-per-use AI agent tools powered by the [x402 payment protocol](https://x402.org).

Expose serve402's full capability suite as MCP tools to Claude Desktop, Cursor, Windsurf, and any other MCP-compatible host — with zero API keys or subscriptions.  Agents pay per request using USDC on Base or XRP drops, handled automatically.

---

## Tools

| Tool | Description | Price |
|------|-------------|-------|
| `serve402_fetch` | Extract readable content from any URL | $0.005 |
| `serve402_search` | Web search with structured results (Brave) | $0.009 |
| `serve402_execute` | Run Python or JavaScript in a secure sandbox | $0.005 |
| `serve402_screenshot` | Capture a webpage as PNG or JPEG | $0.003 |
| `serve402_pdf` | Generate a PDF from any URL | $0.003 |
| `serve402_xrpl_query` | Query the XRP Ledger blockchain | $0.002 |

Prices are per request, paid automatically via x402. No API keys, no subscriptions, no rate limits beyond what your wallet balance allows.

---

## Prerequisites

- **Node.js 20+**
- **A funded wallet** — choose one:
  - **Base (USDC):** An EVM wallet private key with USDC on Base mainnet. Get USDC at [Coinbase](https://coinbase.com) or bridge from Ethereum. [Fund a wallet with USDC on Base →](https://docs.x402.org/getting-started)
  - **XRPL (XRP):** An XRPL wallet family seed (starts with `s`) with XRP balance.

---

## Installation

### Option A: npx (no install)

```bash
npx @serve402/mcp-server
```

### Option B: Global install

```bash
npm install -g @serve402/mcp-server
serve402-mcp
```

### Option C: Clone and build

```bash
git clone https://github.com/justinnevins/x402-gateway
cd x402-gateway/mcp-server
npm install
npm run build
node dist/index.js
```

---

## Configuration

Set environment variables before starting the server.

### Base (USDC) — recommended

```bash
export SERVE402_WALLET_PRIVATE_KEY="0xYourPrivateKey"
# Optional:
export SERVE402_PAYMENT_NETWORK="base"   # default
```

### XRPL (XRP drops)

```bash
export SERVE402_PAYMENT_NETWORK="xrpl"
export SERVE402_XRPL_SEED="sYourXrplSeed"
```

### All environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SERVE402_WALLET_PRIVATE_KEY` | Yes (Base) | — | EVM private key (0x...) with USDC on Base |
| `SERVE402_PAYMENT_NETWORK` | No | `base` | `base` (USDC) or `xrpl` (XRP) |
| `SERVE402_XRPL_SEED` | Yes (XRPL) | — | XRPL wallet seed (s...) |
| `SERVE402_BASE_URL` | No | `https://serve402.com` | API base URL (for self-hosting) |

---

## Claude Desktop Setup

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "serve402": {
      "command": "npx",
      "args": ["-y", "@serve402/mcp-server"],
      "env": {
        "SERVE402_WALLET_PRIVATE_KEY": "0xYourPrivateKeyHere"
      }
    }
  }
}
```

Restart Claude Desktop. The serve402 tools will appear automatically.

---

## Cursor Setup

Add to `.cursor/mcp.json` in your project or `~/.cursor/mcp.json` globally:

```json
{
  "mcpServers": {
    "serve402": {
      "command": "npx",
      "args": ["-y", "@serve402/mcp-server"],
      "env": {
        "SERVE402_WALLET_PRIVATE_KEY": "0xYourPrivateKeyHere"
      }
    }
  }
}
```

---

## Windsurf Setup

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "serve402": {
      "command": "npx",
      "args": ["-y", "@serve402/mcp-server"],
      "env": {
        "SERVE402_WALLET_PRIVATE_KEY": "0xYourPrivateKeyHere"
      }
    }
  }
}
```

---

## Using XRPL Payments

For XRPL/XRP payments, also install the `x402-xrpl` package for full signing support:

```bash
npm install -g @serve402/mcp-server x402-xrpl
```

Then configure with your XRPL seed:

```json
{
  "mcpServers": {
    "serve402": {
      "command": "npx",
      "args": ["-y", "@serve402/mcp-server"],
      "env": {
        "SERVE402_PAYMENT_NETWORK": "xrpl",
        "SERVE402_XRPL_SEED": "sYourXrplFamilySeed"
      }
    }
  }
}
```

XRPL routes use the `/xrpl/*` prefix on serve402.com (e.g. `/xrpl/fetch`, `/xrpl/xrpl-query`).

---

## Tool Reference

### `serve402_fetch`

Extract readable content from any URL using a headless browser.

```json
{
  "url": "https://example.com/article",
  "format": "markdown",
  "maxChars": 50000
}
```

**Returns:** Title, URL, fetch timestamp, and extracted content.

### `serve402_search`

Web search powered by Brave Search.

```json
{
  "query": "x402 payment protocol",
  "count": 10,
  "freshness": "week"
}
```

**Returns:** Array of results with title, URL, snippet, and optional publish date.

### `serve402_execute`

Run Python or JavaScript in an isolated E2B cloud sandbox.

```json
{
  "language": "python",
  "code": "import math\nprint(math.pi)",
  "timeout": 10
}
```

**Returns:** stdout, stderr, exit code, execution time.

### `serve402_screenshot`

Capture a webpage screenshot.

```json
{
  "url": "https://serve402.com",
  "format": "png",
  "fullPage": false
}
```

**Returns:** Image (PNG or JPEG) displayed inline in the MCP client.

### `serve402_pdf`

Generate a PDF from a URL.

```json
{
  "url": "https://serve402.com/docs",
  "format": "A4"
}
```

**Returns:** PDF as a base64-encoded resource.

### `serve402_xrpl_query`

Query the XRP Ledger.

```json
{
  "command": "account_info",
  "params": { "account": "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe" }
}
```

**Available commands:** `account_info`, `tx`, `ledger`, `account_lines`, `account_offers`, `book_offers`, `gateway_balances`, `account_tx`

**Returns:** Raw XRPL response as formatted JSON.

---

## How x402 Payments Work

1. The MCP server makes a normal HTTP request to serve402.com
2. serve402 responds with **HTTP 402 Payment Required** + payment details in the `X-Payment-Required` header
3. The MCP server signs the payment using your configured wallet and submits it via the x402 facilitator (Coinbase CDP for Base, or t54.ai for XRPL)
4. The facilitator verifies the payment and returns a payment proof
5. The MCP server retries the request with the `X-Payment` header
6. serve402 verifies the payment proof and returns the result

This entire flow is transparent to the AI agent. From the agent's perspective, it just calls a tool and gets a result.

---

## Security

⚠️ **Never commit your private key or XRPL seed to version control.**

Use environment variables, a secrets manager, or your OS keychain. The MCP config files (e.g., `claude_desktop_config.json`) should have restrictive file permissions (`chmod 600`).

For production use, consider using a dedicated wallet with only enough balance for expected usage, not your main wallet.

---

## Self-Hosting

To run the MCP server against a self-hosted serve402 instance:

```json
{
  "env": {
    "SERVE402_BASE_URL": "https://your-instance.example.com",
    "SERVE402_WALLET_PRIVATE_KEY": "0x..."
  }
}
```

See the [x402-gateway README](../README.md) for self-hosting instructions.

---

## License

MIT — see [LICENSE](../LICENSE) for details.

Powered by [serve402.com](https://serve402.com) and the [x402 protocol](https://x402.org).
