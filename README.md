# serve402

An x402 payment gateway for AI agents. Pay-per-request with **USDC on Base** or **XRP on the XRP Ledger** — no accounts, no API keys, no SDKs. Just HTTP + crypto micropayments. Built on the [x402 protocol](https://www.x402.org/).

**Live at [serve402.com](https://serve402.com)**

## Supported Networks

| Network | Chain | Asset | Facilitator | Routes |
|---------|-------|-------|-------------|--------|
| `eip155:8453` | Base (L2) | USDC | CDP (Coinbase) | `POST /fetch`, `/execute`, `/screenshot`, `/pdf`, `/search`, `/xrpl-query`, `/dns`, `/headers` |
| `xrpl:0` | XRP Ledger | XRP | [t54.ai](https://xrpl-x402.t54.ai/) | `POST /xrpl/fetch`, `/xrpl/execute`, `/xrpl/screenshot`, `/xrpl/pdf`, `/xrpl/search`, `/xrpl/xrpl-query`, `/xrpl/dns`, `/xrpl/headers` |

Agents choose which chain to pay on. Same endpoints, same functionality — just different payment rails.

## Endpoints

### `GET /services` — Service Discovery (free)

```bash
curl https://serve402.com/services
```

Returns available endpoints, pricing, payment info, and supported networks.

### `POST /fetch` or `POST /xrpl/fetch` — Web Content Extraction

Extract readable content from any URL using a headless browser.

```bash
curl -X POST https://serve402.com/fetch \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "format": "markdown"}'
```

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | ✅ | URL to fetch |
| `format` | string | | `markdown` (default) or `text` |
| `maxChars` | number | | Max output length (default 50000) |

**Response:**
```json
{
  "url": "https://example.com",
  "title": "Example Domain",
  "content": "# Example Domain\n\nThis domain is for use in illustrative examples...",
  "contentLength": 1256,
  "fetchedAt": "2026-02-14T15:00:00Z"
}
```

### `POST /execute` or `POST /xrpl/execute` — Code Execution

Run Python or JavaScript in an isolated sandbox via [E2B](https://e2b.dev).

```bash
curl -X POST https://serve402.com/execute \
  -H "Content-Type: application/json" \
  -d '{"language": "python", "code": "import math; print(math.pi)"}'
```

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `language` | string | ✅ | `python` or `javascript` |
| `code` | string | ✅ | Code to execute |
| `timeout` | number | | Max seconds (default 10, max 30) |

**Response:**
```json
{
  "stdout": "3.141592653589793\n",
  "stderr": "",
  "exitCode": 0,
  "executionTime": 0.34
}
```

### `POST /screenshot` or `POST /xrpl/screenshot` — Screenshot Capture

Take a screenshot of any URL as PNG or JPEG.

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | ✅ | URL to screenshot |
| `fullPage` | boolean | | Capture full scrollable page (default: false) |
| `width` | number | | Viewport width in pixels, max 1920 (default: 1280) |
| `height` | number | | Viewport height in pixels, max 1080 (default: 720) |
| `format` | string | | `png` (default) or `jpeg` |

**Response:** Binary image data with `Content-Type: image/png` or `image/jpeg`.

### `POST /pdf` or `POST /xrpl/pdf` — PDF Generation

Generate a PDF from any URL.

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | ✅ | URL to convert to PDF |
| `format` | string | | Paper format: `A4` (default), `Letter`, or `Legal` |
| `landscape` | boolean | | Landscape orientation (default: false) |

**Response:** Binary PDF data with `Content-Type: application/pdf`.

### `POST /dns` or `POST /xrpl/dns` — DNS Record Lookup

Query DNS records for any domain.

```bash
curl -X POST https://serve402.com/dns \
  -H "Content-Type: application/json" \
  -d '{"domain": "example.com", "type": "MX"}'
```

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `domain` | string | ✅ | Domain name to look up |
| `type` | string | | Record type: `A` (default), `AAAA`, `MX`, `TXT`, `NS`, `CNAME`, `SOA`, `SRV`, `PTR` |

**Response:**
```json
{
  "domain": "example.com",
  "type": "MX",
  "records": [{ "exchange": "mail.example.com", "priority": 10 }],
  "queriedAt": "2026-02-20T09:00:00Z"
}
```

### `POST /headers` or `POST /xrpl/headers` — HTTP Header Inspection

Inspect HTTP response headers with security analysis and redirect chain tracking.

```bash
curl -X POST https://serve402.com/headers \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | ✅ | URL to inspect |
| `method` | string | | `HEAD` (default) or `GET` |
| `followRedirects` | boolean | | Follow redirects and capture chain (default: true) |

**Response:**
```json
{
  "url": "https://example.com",
  "finalUrl": "https://example.com",
  "statusCode": 200,
  "headers": { "content-type": "text/html", "strict-transport-security": "max-age=31536000" },
  "redirectChain": [],
  "security": {
    "hsts": true, "csp": false, "xFrameOptions": "DENY",
    "xContentTypeOptions": true, "referrerPolicy": "strict-origin", "permissionsPolicy": false
  },
  "server": "ECS (dcb/7F84)",
  "inspectedAt": "2026-02-20T09:00:00Z"
}
```

## How Payment Works

serve402 uses the [x402 protocol](https://www.x402.org/) — HTTP 402 Payment Required, done right.

1. **Request without payment** → server returns `402` with payment requirements (price, network, wallet)
2. **Agent signs a payment** using its wallet (USDC on Base or XRP on XRPL)
3. **Request with `PAYMENT-SIGNATURE` header** → server verifies payment via facilitator, executes request, settles payment

No accounts. No API keys. Just a wallet.

### Client SDKs

- **Base/EVM:** [`@x402/fetch`](https://www.npmjs.com/package/@x402/fetch), [`x402-fetch`](https://pypi.org/project/x402-fetch/)
- **XRPL:** [`x402-xrpl`](https://www.npmjs.com/package/x402-xrpl) (includes `x402Fetch` client)

## Pricing

| Endpoint | USD Price | Base (USDC) | XRPL (XRP drops) |
|----------|-----------|-------------|-------------------|
| `/fetch` | ~$0.005 | 0.005 USDC | 2,500 drops |
| `/execute` | ~$0.005 | 0.005 USDC | 2,500 drops |
| `/search` | ~$0.004 | 0.004 USDC | 2,000 drops |
| `/screenshot` | ~$0.003 | 0.003 USDC | 1,500 drops |
| `/pdf` | ~$0.003 | 0.003 USDC | 1,500 drops |
| `/xrpl-query` | ~$0.002 | 0.002 USDC | 1,000 drops |
| `/dns` | ~$0.001 | 0.001 USDC | 500 drops |
| `/headers` | ~$0.001 | 0.001 USDC | 500 drops |
| `/services` | Free | — | — |
| `/stats` | Free | — | — |
| `/marketplace` | Free | — | — |
| `/health` | Free | — | — |

**Rate limiting:** 10 requests per minute per IP on all paid endpoints.

## Self-Hosting

### Prerequisites

- Node.js 22+
- Docker & Docker Compose
- A domain pointed to your server
- Wallet addresses (EVM for Base, XRPL for XRP)
- An [E2B](https://e2b.dev) API key (free tier available)

### Setup

```bash
git clone https://github.com/justinnevins/x402-gateway.git
cd x402-gateway

cp .env.example .env
# Edit .env with your values

# For Base payments:
#   WALLET_ADDRESS=0xYour...
#   CDP_API_KEY_ID=organizations/... (from https://cdp.coinbase.com)
#   openssl pkcs8 -topk8 -nocrypt -in your_key.pem -out cdp_key.pem

# For XRPL payments:
#   XRPL_WALLET_ADDRESS=rYour...
#   (no API keys needed — uses t54.ai facilitator)

docker compose up -d --build
```

### Development

```bash
npm install
npm run dev   # runs with tsx (hot reload)
```

## Architecture

```
Client → Caddy (TLS) → Express → Payment Middleware → Service Backends
                          │                              ├── Puppeteer (/fetch, /screenshot, /pdf)
                          │                              ├── E2B API (/execute)
                          │                              ├── Brave API (/search)
                          │                              ├── XRPL Node (/xrpl-query)
                          │                              ├── Node dns/promises (/dns)
                          │                              └── Native fetch (/headers)
                          ├── @x402/express (Base/EVM routes)
                          │     └── CDP Facilitator (verify + settle)
                          └── x402-xrpl/express (XRPL routes)
                                └── t54.ai Facilitator (verify + settle)
```

- **Dual payment middleware** — Base and XRPL handled independently
- **Bazaar extension** makes Base endpoints discoverable via CDP's `/discovery/resources` API
- **Caddy** handles automatic TLS certificates
- **Rate limiting** via express-rate-limit (10 req/min per IP)

## License

MIT
