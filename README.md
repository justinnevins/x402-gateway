# serve402

An x402 payment gateway for AI agents. Pay-per-request with USDC on Base — no accounts, no API keys, no SDKs. Just HTTP + crypto micropayments. Built on the [x402 protocol](https://www.x402.org/) by Coinbase.

**Live at [serve402.com](https://serve402.com)**

## Endpoints

### `GET /services` — Service Discovery (free)

```bash
curl https://serve402.com/services
```

Returns available endpoints, pricing, and payment info.

### `POST /fetch` — Web Content Extraction ($0.005)

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

### `POST /execute` — Code Execution ($0.005)

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

### `POST /screenshot` — Screenshot Capture ($0.003)

Take a screenshot of any URL as PNG or JPEG.

```bash
curl -X POST https://serve402.com/screenshot \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "fullPage": false, "width": 1280, "height": 720, "format": "png"}'
```

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | ✅ | URL to screenshot |
| `fullPage` | boolean | | Capture full scrollable page (default: false) |
| `width` | number | | Viewport width in pixels, max 1920 (default: 1280) |
| `height` | number | | Viewport height in pixels, max 1080 (default: 720) |
| `format` | string | | `png` (default) or `jpeg` |

**Response:** Binary image data with `Content-Type: image/png` or `image/jpeg`.

### `POST /pdf` — PDF Generation ($0.003)

Generate a PDF from any URL.

```bash
curl -X POST https://serve402.com/pdf \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "format": "A4", "landscape": false}'
```

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | ✅ | URL to convert to PDF |
| `format` | string | | Paper format: `A4` (default), `Letter`, or `Legal` |
| `landscape` | boolean | | Landscape orientation (default: false) |

**Response:** Binary PDF data with `Content-Type: application/pdf`.

## How Payment Works

serve402 uses the [x402 protocol](https://www.x402.org/) — HTTP 402 Payment Required, done right.

1. **Request without payment** → server returns `402` with payment requirements (price, network, wallet)
2. **Agent signs a USDC payment** using its wallet
3. **Request with `X-PAYMENT` header** → server verifies payment via facilitator, executes request, settles payment

No accounts. No API keys. Just a wallet with USDC on Base.

Compatible with any x402 client SDK: [`@x402/fetch`](https://www.npmjs.com/package/@x402/fetch), [`x402-fetch`](https://pypi.org/project/x402-fetch/), or roll your own.

## Pricing

| Endpoint | Price | Backend |
|----------|-------|---------|
| `POST /fetch` | $0.005 | Puppeteer + Readability |
| `POST /execute` | $0.005 | E2B Code Interpreter |
| `POST /screenshot` | $0.003 | Puppeteer |
| `POST /pdf` | $0.003 | Puppeteer |
| `GET /services` | Free | — |
| `GET /health` | Free | — |

All prices in USDC on Base (L2). Facilitator: CDP (Coinbase) — 1,000 free transactions/month.

**Rate limiting:** 10 requests per minute per IP on all paid endpoints.

## Self-Hosting

### Prerequisites

- Node.js 22+
- Docker & Docker Compose
- A domain pointed to your server
- A wallet address to receive USDC payments
- An [E2B](https://e2b.dev) API key (free tier available)

### Setup

```bash
git clone https://github.com/justinnevins/x402-gateway.git
cd x402-gateway

cp .env.example .env
# Edit .env with your values:
#   WALLET_ADDRESS=0xYour...
#   E2B_API_KEY=your_key
#   CDP_API_KEY_ID=organizations/... (from https://cdp.coinbase.com)

# Add your CDP PEM key (MUST be PKCS8 format):
# openssl pkcs8 -topk8 -nocrypt -in your_key.pem -out cdp_key.pem
cp your_key.pem cdp_key.pem

# Update Caddyfile with your domain
# Then:
docker compose up -d --build
```

### Development

```bash
npm install
npm run dev   # runs with tsx (hot reload)
```

## Architecture

```
Client → Caddy (TLS) → Express + x402 middleware → Service backends
                                                     ├── Puppeteer (/fetch, /screenshot, /pdf)
                                                     └── E2B API (/execute)
```

- **x402 middleware** handles payment verification and settlement automatically
- **Bazaar extension** makes endpoints discoverable via the facilitator's `/discovery/resources` API
- **Caddy** handles automatic TLS certificates
- **Rate limiting** via express-rate-limit (10 req/min per IP)

## License

MIT
