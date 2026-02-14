# x402 Agent Gateway — Architecture Spec

**Version:** 0.1.0 (Draft)
**Date:** 2026-02-14
**Status:** Pre-build

---

## Overview

A multi-service x402 payment gateway for AI agents. One API surface, one payment model, multiple backend capabilities. Agents pay per request with USDC on Base. No accounts, no API keys, no SDKs required.

## Name Candidates

- AgentGate
- x402hub
- PayGate
- agent402
- GateKeep

*(Decision needed before launch)*

---

## Architecture

```
                    ┌─────────────────────────┐
                    │      AI Agent            │
                    │  (Claude, GPT, Custom)   │
                    └──────────┬──────────────┘
                               │ HTTP + x402 payment
                               ▼
                    ┌─────────────────────────┐
                    │    x402 Gateway Server   │
                    │    (Express + x402 MW)   │
                    │                         │
                    │  ┌───────────────────┐  │
                    │  │ Payment Middleware │  │
                    │  │ (verify + settle) │  │
                    │  └────────┬──────────┘  │
                    │           │              │
                    │  ┌────────▼──────────┐  │
                    │  │  Service Router   │  │
                    │  └────────┬──────────┘  │
                    └───────────┼──────────────┘
                    ┌───────────┼──────────────┐
                    │           │              │
              ┌─────▼──┐  ┌────▼───┐  ┌──────▼────┐
              │ E2B    │  │ Pup-   │  │ Twilio/   │
              │ (code) │  │ peteer │  │ SendGrid  │
              └────────┘  │ (fetch)│  └───────────┘
                          └────────┘
```

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Runtime | Node.js 22 + Express | x402 SDK is TypeScript-first. Best support. |
| x402 | `@x402/express`, `@x402/core`, `@x402/evm` | Official Coinbase SDK |
| Code execution | E2B API (`@e2b/code-interpreter`) | Managed sandbox, free tier, no security burden |
| Web extraction | Puppeteer (self-hosted) | No external dependency, full control |
| Notifications | Twilio (SMS) + SendGrid (email) | Pay-as-go, industry standard |
| Doc conversion | pdf-parse + Tesseract.js | Self-hosted, no API dependency |
| Temp storage | SQLite or in-memory Map | Simple KV with TTL, no external DB |
| TLS | Caddy | Auto-TLS, reverse proxy, zero config |
| Hosting | VPS (DigitalOcean/Hetzner) | $10-20/mo, Docker-ready |

## API Surface

### Service Discovery

```
GET /services
```

Returns available services + pricing. No payment required. Agents use this to discover capabilities.

```json
{
  "services": [
    {
      "endpoint": "POST /execute",
      "description": "Run Python/JS/bash code in an isolated sandbox",
      "price": "$0.001",
      "accepts": [{ "scheme": "exact", "network": "eip155:8453", "asset": "USDC" }]
    },
    {
      "endpoint": "POST /fetch",
      "description": "Extract readable content from any URL",
      "price": "$0.001",
      "accepts": [{ "scheme": "exact", "network": "eip155:8453", "asset": "USDC" }]
    }
  ],
  "version": "0.1.0"
}
```

### POST /execute

Run code in an isolated sandbox. Returns stdout, stderr, exit code.

**Request:**
```json
{
  "language": "python",
  "code": "import math\nprint(math.pi)",
  "timeout": 10
}
```

**Response:**
```json
{
  "stdout": "3.141592653589793\n",
  "stderr": "",
  "exitCode": 0,
  "executionTime": 0.34
}
```

**Constraints:**
- Languages: `python`, `javascript`, `bash`
- Max timeout: 30 seconds
- Max output: 1MB
- No network access inside sandbox
- No persistent state between calls

**Backend:** E2B Code Interpreter API

### POST /fetch

Extract readable content from a URL. Returns clean markdown/text.

**Request:**
```json
{
  "url": "https://example.com/article",
  "format": "markdown",
  "maxChars": 50000
}
```

**Response:**
```json
{
  "url": "https://example.com/article",
  "title": "Example Article",
  "content": "# Article Title\n\nArticle body in markdown...",
  "contentLength": 2847,
  "fetchedAt": "2026-02-14T15:00:00Z"
}
```

**Constraints:**
- Max content: 50,000 chars (configurable per request)
- Formats: `markdown`, `text`
- Timeout: 15 seconds
- Respects robots.txt

**Backend:** Puppeteer + @mozilla/readability (self-hosted)

### POST /notify

Send a notification to any channel.

**Request:**
```json
{
  "channel": "email",
  "to": "user@example.com",
  "subject": "Alert from Agent",
  "body": "Your task is complete."
}
```

**Response:**
```json
{
  "status": "sent",
  "channel": "email",
  "messageId": "msg_abc123"
}
```

**Channels:**
- `email` — via SendGrid ($0.005/msg)
- `sms` — via Twilio ($0.02/msg, US only initially)

**Constraints:**
- Rate limit: 10/min per wallet address
- No bulk sending
- Anti-spam: reject if body matches known spam patterns

**Backend:** SendGrid API, Twilio API

### POST /convert

Convert documents to text/markdown.

**Request (multipart):**
```
Content-Type: multipart/form-data
file: [binary PDF/DOCX/image]
format: "markdown"
```

**Response:**
```json
{
  "content": "# Document Title\n\nExtracted text...",
  "contentLength": 5421,
  "sourceType": "application/pdf",
  "pages": 3
}
```

**Supported formats:**
- PDF → text/markdown (pdf-parse)
- Images → text (Tesseract.js OCR)
- DOCX → text (mammoth)

**Constraints:**
- Max file size: 10MB
- Timeout: 30 seconds

**Backend:** pdf-parse, Tesseract.js, mammoth (all self-hosted)

### POST /store

Temporary encrypted key-value storage with TTL.

**Request:**
```json
{
  "action": "set",
  "key": "agent-result-abc",
  "value": "any string or JSON blob",
  "ttl": 3600
}
```

**Response:**
```json
{
  "status": "stored",
  "key": "agent-result-abc",
  "expiresAt": "2026-02-14T16:00:00Z"
}
```

**Retrieval:**
```json
{
  "action": "get",
  "key": "agent-result-abc"
}
```

**Constraints:**
- Max value size: 100KB
- Max TTL: 24 hours
- Auto-deleted on expiry
- Set = paid, Get = free (incentivizes storage, not retrieval)

**Backend:** SQLite with TTL cleanup cron

---

## Pricing Strategy

### Phase 1: Free / Near-Free (Weeks 1-4)

All services free. Goal: transaction volume and ecosystem positioning.

Actually scratch that — x402 requires payment to function (that's the whole point). Instead:

**Phase 1 pricing: $0.001 per request (all services)**

This is the minimum that demonstrates x402 works. One-tenth of a cent. An agent with $1 in USDC gets 1,000 requests. Effectively free but proves the payment rail.

### Phase 2: Differentiated (Month 2+)

| Service | Price |
|---------|-------|
| /execute | $0.005 |
| /fetch | $0.002 |
| /notify (email) | $0.005 |
| /notify (sms) | $0.02 |
| /convert | $0.005 |
| /store (set) | $0.001 |
| /store (get) | free |

### Phase 3: Marketplace (Month 3+)

Third-party services set their own prices. We take 15% platform fee.

---

## x402 Payment Flow

```
1. Agent: GET /services (free, discovers pricing)
2. Agent: POST /execute (no payment header)
3. Gateway: 402 Payment Required
   → Response includes: price, network, asset, payTo address
4. Agent: Signs USDC payment with wallet
5. Agent: POST /execute + X-PAYMENT header
6. Gateway middleware: Calls facilitator /verify
7. Facilitator: Confirms payment is valid
8. Gateway: Executes request, returns result
9. Gateway middleware: Calls facilitator /settle
10. USDC settles to our wallet on Base
```

**Facilitator:** `https://x402.org/facilitator` (testnet)
→ Production: self-hosted or Coinbase CDP facilitator

**Network:** Base (eip155:8453) — low fees, Coinbase-native
**Asset:** USDC

---

## Wallet Setup

**Receiving wallet:** A Base wallet controlled by Justin
- Option A: Coinbase account (easiest offramp to bank)
- Option B: MetaMask/Rainbow (more control)
- Needs USDC on Base to be the `payTo` address

**Client testing wallet:** Separate wallet with small USDC balance for testing

---

## Infrastructure

### VPS Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 1 GB | 2 GB |
| Disk | 20 GB | 40 GB |
| OS | Ubuntu 24.04 | Ubuntu 24.04 |
| Docker | Yes | Yes |

**Estimated cost:** $6-20/mo (Hetzner CX22 = €4.50/mo, DigitalOcean = $12/mo)

### Services Running

| Service | Port | Notes |
|---------|------|-------|
| Caddy (reverse proxy) | 80, 443 | Auto-TLS |
| Gateway (Express) | 3402 | Main application |
| Puppeteer | (internal) | Used by /fetch |

### Docker Compose

```yaml
version: "3.8"
services:
  gateway:
    build: .
    ports:
      - "3402:3402"
    environment:
      - E2B_API_KEY=${E2B_API_KEY}
      - TWILIO_SID=${TWILIO_SID}
      - TWILIO_AUTH=${TWILIO_AUTH}
      - SENDGRID_KEY=${SENDGRID_KEY}
      - WALLET_ADDRESS=${WALLET_ADDRESS}
      - FACILITATOR_URL=${FACILITATOR_URL}
    volumes:
      - ./data:/app/data
    restart: unless-stopped

  caddy:
    image: caddy:2
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    restart: unless-stopped

volumes:
  caddy_data:
```

---

## Project Structure

```
x402-gateway/
├── package.json
├── docker-compose.yml
├── Dockerfile
├── Caddyfile
├── .env.example
├── src/
│   ├── index.ts              # Express app + x402 middleware
│   ├── config.ts             # Environment + pricing config
│   ├── services/
│   │   ├── execute.ts        # E2B code execution
│   │   ├── fetch.ts          # Puppeteer web extraction
│   │   ├── notify.ts         # Twilio + SendGrid
│   │   ├── convert.ts        # PDF/OCR/DOCX conversion
│   │   └── store.ts          # Temp KV storage
│   ├── middleware/
│   │   ├── rateLimit.ts      # Per-wallet rate limiting
│   │   ├── abuse.ts          # Anti-abuse detection
│   │   └── logging.ts        # Request/response logging
│   └── utils/
│       ├── metrics.ts        # Transaction counting, revenue tracking
│       └── health.ts         # Backend health checks
├── test/
│   ├── execute.test.ts
│   ├── fetch.test.ts
│   └── payment.test.ts
└── docs/
    ├── API.md                # Full API documentation
    ├── INTEGRATION.md        # How to integrate as an agent
    └── CONTRIBUTING.md       # How to add a backend service
```

---

## MVP Scope (Weekend Build)

### Must Have (v0.1)
- [ ] Express server with x402 payment middleware
- [ ] `GET /services` — service discovery (free)
- [ ] `POST /execute` — code execution via E2B
- [ ] `POST /fetch` — web extraction via Puppeteer
- [ ] Basic request logging + metrics
- [ ] Docker + Caddy deployment
- [ ] README + API docs

### Nice to Have (v0.2)
- [ ] `POST /notify` — email via SendGrid
- [ ] `POST /convert` — PDF extraction
- [ ] `POST /store` — temp KV storage
- [ ] Per-wallet rate limiting
- [ ] Health check dashboard

### Phase 2 (Week 2-4)
- [ ] MCP tool wrappers
- [ ] npm client SDK (`@agentgateway/client`)
- [ ] Python client SDK (`pip install agentgateway`)
- [ ] Apply for x402 ecosystem listing
- [ ] Apply for x402 Foundation grant
- [ ] "How to add x402 to your AI agent" tutorial

### Phase 3 (Month 2-3)
- [ ] Third-party service registration
- [ ] Service marketplace with platform fee
- [ ] Analytics dashboard
- [ ] Multi-facilitator support

---

## Open Questions

1. **Name?** Need to pick before creating repo/domain
2. **Base mainnet vs testnet first?** Testnet for dev, but mainnet for real ecosystem cred
3. **Open source from day 1 or after MVP?** Recommendation: day 1 (builds trust)
4. **GitHub org:** `justinnevins/x402-gateway` or new org?
5. **Wallet setup:** Coinbase account or standalone wallet?

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| E2B API changes/breaks | Abstract behind service interface, swap to Modal/Fly fallback |
| Low demand | Phase 1 costs only $10-20/mo. Cut losses trivially. |
| Abuse/spam via /notify | Rate limit per wallet (10/min), content scanning |
| Coinbase builds competing gateway | Our open-source standard + existing integrations = switching cost |
| VPS downtime | Health checks + alerts. Caddy handles TLS renewal. |

---

## Success Metrics

| Metric | Month 1 | Month 3 | Month 6 |
|--------|---------|---------|---------|
| Daily transactions | 50 | 500 | 5,000 |
| Unique agent wallets | 10 | 100 | 1,000 |
| Services available | 2 | 5 | 15+ (incl marketplace) |
| Monthly revenue | $0 | $100 | $1,000+ |
| Ecosystem listings | 1 | 3 | 5+ |
