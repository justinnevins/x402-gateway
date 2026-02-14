# What Justin Needs To Do (30 min total)

## Before I Can Build

### 1. Pick a name (2 min)
Candidates: AgentGate, x402hub, PayGate, agent402, GateKeep
Or suggest your own. I'll check domain availability.

### 2. Provision a VPS (10 min)
- Hetzner CX22: €4.51/mo (best value) — https://hetzner.cloud
- DigitalOcean: $12/mo — https://digitalocean.com
- Ubuntu 24.04, 2 vCPU, 2GB RAM, 40GB disk
- Add your SSH key, give me the IP + root password (or SSH key in Bitwarden)

### 3. Register a domain (5 min)
- Point it at the VPS IP (A record)
- Namecheap, Cloudflare, or wherever you buy domains

### 4. Create a Base wallet (5 min)
- Coinbase account → receive USDC on Base
- OR MetaMask → add Base network → note the address
- Fund with ~$5 USDC on Base for testing (testnet is free but mainnet = real ecosystem cred)

### 5. Sign up for E2B (5 min)
- https://e2b.dev → sign up → grab API key
- Free tier = $100 in credits (thousands of executions)
- Drop key in Bitwarden: "Frank - E2B API Key"

### 6. (Optional) Twilio + SendGrid
- Only needed for /notify service (Phase 2)
- Can skip for MVP

## After That, I Handle Everything
- Repo setup, code, Docker, Caddy config
- x402 middleware integration
- Backend service wiring
- Deployment, testing, monitoring
- Docs, API spec, ecosystem listing applications
