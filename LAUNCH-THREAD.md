# X Launch Thread — @justinnevins

---

**1/6**
Would you give your AI agent your credit card number?

I built a gateway this weekend that lets agents pay for services with crypto instead. $0.001 per request. No accounts. No API keys. No trusting a bot with your Visa.

---

**2/6**
The agent payment problem is getting a lot of attention right now, and x402 by @CoinbaseDev is the most elegant solution I've seen. HTTP 402 status code + USDC on @base. Agent hits an endpoint, gets a price, signs a payment, gets access. One round trip.

---

**3/6**
My gateway has two endpoints today:

/fetch — give it a URL, get clean extracted content back
/execute — give it Python or JS code, get the output

Both cost a tenth of a penny. Running on Base mainnet. Real money, real transactions.

---

**4/6**
The whole thing runs on a $6/mo VPS. Built it in a day with @OpenClawAI — my AI handled the code, Docker setup, deployment, and CDP integration while I focused on architecture decisions and getting the business logic right.

That's the part that doesn't get talked about enough. AI doesn't replace the builder. It lets you ship 10x faster.

---

**5/6**
Why give this away at $0.001/request?

The protocol is brand new. Maybe 135 projects in the whole x402 ecosystem. Being early and being useful matters more than margin right now.

---

**6/6**
It's open source. If you're building AI agents that need to pay for services — or building services agents should pay for — check it out.

serve402.com
github.com/justinnevins/x402-gateway

@CoinbaseDev @jessepollak
