import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { paymentMiddleware } from '@x402/express';
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { registerExactEvmScheme } from '@x402/evm/exact/server';
import {
  bazaarResourceServerExtension,
  declareDiscoveryExtension,
} from '@x402/extensions/bazaar';
import { createFacilitatorConfig } from '@coinbase/x402';
import { requirePayment as requireXrplPayment } from 'x402-xrpl/express';
import { config } from './config.js';
import { fetchContent } from './services/fetch.js';
import { executeCode } from './services/execute.js';
import { takeScreenshot } from './services/screenshot.js';
import { generatePdf } from './services/pdf.js';
import { searchWeb } from './services/search.js';
import { queryXrpl } from './services/xrpl-query.js';
import { queryDns } from './services/dns.js';
import { inspectHeaders } from './services/headers.js';
import { initDb, logRequest, getStats, getMarketplace } from './services/logger.js';

// ─── Init DB ─────────────────────────────────────────────────────────────────
initDb();

const app = express();
app.use(cors());
app.use(express.json());

// ─── Landing page (if src/public exists) ─────────────────────────────────
// In production, the serve402 platform layer provides the landing page.
// For self-hosted instances, create src/public/index.html to serve a custom page.
import { existsSync } from 'fs';
if (existsSync('src/public')) {
  app.use(express.static('src/public'));
  app.get('/', (_req, res) => {
    res.sendFile('index.html', { root: 'src/public' });
  });
}

// Rate limiting: 10 requests per minute per IP on paid endpoints
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Use CDP facilitator for mainnet, x402.org for testnet
const isMainnet = config.network === "eip155:8453";
const facilitatorClient = isMainnet
  ? new HTTPFacilitatorClient(createFacilitatorConfig(config.cdpApiKeyId, config.cdpApiKeySecret))
  : new HTTPFacilitatorClient({ url: config.facilitatorUrl });

// Create resource server and register EVM scheme + Bazaar extension
const server = new x402ResourceServer(facilitatorClient);
registerExactEvmScheme(server);
server.registerExtension(bazaarResourceServerExtension);

const payTo = config.walletAddress;

// ─── Request logging middleware ───────────────────────────────────────────────
// Attach a finish listener early so we can log all paid request outcomes.
// Prices are fixed per endpoint, so we derive amount deterministically.

const PAID_ENDPOINTS = new Set([
  '/fetch', '/execute', '/screenshot', '/pdf', '/search', '/xrpl-query', '/dns', '/headers',
  '/xrpl/fetch', '/xrpl/execute', '/xrpl/screenshot', '/xrpl/pdf',
  '/xrpl/search', '/xrpl/xrpl-query', '/xrpl/dns', '/xrpl/headers',
]);

function amountForEndpoint(path: string, chain: 'base' | 'xrpl'): string {
  const base = path.replace(/^\/xrpl/, '');
  if (base === '/fetch' || base === '/execute') {
    return chain === 'xrpl' ? '2500' : '0.005000';
  }
  if (base === '/search') {
    return chain === 'xrpl' ? '2000' : '0.004000';
  }
  if (base === '/xrpl-query') {
    return chain === 'xrpl' ? '1000' : '0.002000';
  }
  if (base === '/dns' || base === '/headers') {
    return chain === 'xrpl' ? '500' : '0.001000';
  }
  // screenshot / pdf
  return chain === 'xrpl' ? '1500' : '0.003000';
}

app.use((req, res, next) => {
  res.on('finish', () => {
    if (!PAID_ENDPOINTS.has(req.path)) return;

    // Only log when payment was accepted (2xx)
    if (res.statusCode < 200 || res.statusCode >= 300) return;

    const chain: 'base' | 'xrpl' = req.path.startsWith('/xrpl/') ? 'xrpl' : 'base';

    // x402-xrpl and @x402/express both set res.locals.x402 with payer
    const x402 = (res.locals as Record<string, any>).x402 as
      | { payer?: string | null; paymentRequirements?: { amount?: string } }
      | undefined;

    const wallet =
      x402?.payer ??
      (req.headers['payment-signature'] as string | undefined) ??
      'unknown';

    // Use the amount from payment requirements if available, else derive from endpoint
    const amount =
      (x402?.paymentRequirements?.amount) ??
      amountForEndpoint(req.path, chain);

    logRequest({
      timestamp: new Date().toISOString(),
      endpoint: req.path,
      chain,
      wallet,
      amount,
      status: res.statusCode,
    });
  });

  next();
});

// Apply payment middleware — protects routes listed here
app.use(
  paymentMiddleware(
    {
      'POST /fetch': {
        accepts: [
          {
            scheme: 'exact',
            price: '$0.005',
            network: config.network as `${string}:${string}`,
            payTo,
          },
        ],
        description: 'Extract readable content from any URL using headless browser',
        mimeType: 'application/json',
        extensions: {
          ...declareDiscoveryExtension({
            input: {
              url: 'https://example.com',
              format: 'markdown',
              maxChars: 50000,
            },
            inputSchema: {
              properties: {
                url: { type: 'string', description: 'URL to fetch and extract content from' },
                format: { type: 'string', enum: ['markdown', 'text'], description: 'Output format' },
                maxChars: { type: 'number', description: 'Maximum characters to return' },
              },
              required: ['url'],
            },
            bodyType: 'json',
            output: {
              example: {
                url: 'https://example.com',
                title: 'Example Domain',
                content: '# Example\n\nThis is an example page.',
                contentLength: 35,
                fetchedAt: '2026-02-14T15:00:00Z',
              },
              schema: {
                properties: {
                  url: { type: 'string' },
                  title: { type: 'string' },
                  content: { type: 'string' },
                  contentLength: { type: 'number' },
                  fetchedAt: { type: 'string' },
                },
                required: ['url', 'title', 'content', 'contentLength', 'fetchedAt'],
              },
            },
          }),
        },
      },
      'POST /execute': {
        accepts: [
          {
            scheme: 'exact',
            price: '$0.005',
            network: config.network as `${string}:${string}`,
            payTo,
          },
        ],
        description: 'Run Python or JavaScript code in an isolated sandbox',
        mimeType: 'application/json',
        extensions: {
          ...declareDiscoveryExtension({
            input: {
              language: 'python',
              code: 'print("hello")',
              timeout: 10,
            },
            inputSchema: {
              properties: {
                language: { type: 'string', enum: ['python', 'javascript'], description: 'Programming language' },
                code: { type: 'string', description: 'Code to execute' },
                timeout: { type: 'number', description: 'Max execution time in seconds (max 30)' },
              },
              required: ['language', 'code'],
            },
            bodyType: 'json',
            output: {
              example: {
                stdout: 'hello\n',
                stderr: '',
                exitCode: 0,
                executionTime: 0.34,
              },
              schema: {
                properties: {
                  stdout: { type: 'string' },
                  stderr: { type: 'string' },
                  exitCode: { type: 'number' },
                  executionTime: { type: 'number' },
                },
                required: ['stdout', 'stderr', 'exitCode', 'executionTime'],
              },
            },
          }),
        },
      },
      'POST /screenshot': {
        accepts: [
          {
            scheme: 'exact',
            price: '$0.003',
            network: config.network as `${string}:${string}`,
            payTo,
          },
        ],
        description: 'Take a screenshot of any URL as PNG or JPEG',
        mimeType: 'image/png',
        extensions: {
          ...declareDiscoveryExtension({
            input: {
              url: 'https://example.com',
              fullPage: false,
              width: 1280,
              height: 720,
              format: 'png',
            },
            inputSchema: {
              properties: {
                url: { type: 'string', description: 'URL to screenshot' },
                fullPage: { type: 'boolean', description: 'Capture full scrollable page (default: false)' },
                width: { type: 'number', description: 'Viewport width in pixels (max 1920, default: 1280)' },
                height: { type: 'number', description: 'Viewport height in pixels (max 1080, default: 720)' },
                format: { type: 'string', enum: ['png', 'jpeg'], description: 'Image format (default: png)' },
              },
              required: ['url'],
            },
            bodyType: 'json',
            output: {
              example: 'Binary PNG/JPEG image data',
              schema: {
                properties: {
                  binary: { type: 'string', description: 'Binary image data returned with appropriate content-type header' },
                },
              },
            },
          }),
        },
      },
      'POST /pdf': {
        accepts: [
          {
            scheme: 'exact',
            price: '$0.003',
            network: config.network as `${string}:${string}`,
            payTo,
          },
        ],
        description: 'Generate a PDF from any URL',
        mimeType: 'application/pdf',
        extensions: {
          ...declareDiscoveryExtension({
            input: {
              url: 'https://example.com',
              format: 'A4',
              landscape: false,
            },
            inputSchema: {
              properties: {
                url: { type: 'string', description: 'URL to convert to PDF' },
                format: { type: 'string', enum: ['A4', 'Letter', 'Legal'], description: 'Paper format (default: A4)' },
                landscape: { type: 'boolean', description: 'Landscape orientation (default: false)' },
              },
              required: ['url'],
            },
            bodyType: 'json',
            output: {
              example: 'Binary PDF data',
              schema: {
                properties: {
                  binary: { type: 'string', description: 'Binary PDF data returned with application/pdf content-type' },
                },
              },
            },
          }),
        },
      },
      'POST /search': {
        accepts: [
          {
            scheme: 'exact',
            price: '$0.004',
            network: config.network as `${string}:${string}`,
            payTo,
          },
        ],
        description: 'Search the web using Brave Search API',
        mimeType: 'application/json',
        extensions: {
          ...declareDiscoveryExtension({
            input: {
              query: 'latest AI research',
              count: 5,
              freshness: 'week',
            },
            inputSchema: {
              properties: {
                query: { type: 'string', description: 'Search query string' },
                count: { type: 'number', description: 'Number of results to return (max 20, default 5)' },
                freshness: { type: 'string', enum: ['day', 'week', 'month', 'year'], description: 'Filter results by age' },
              },
              required: ['query'],
            },
            bodyType: 'json',
            output: {
              example: {
                results: [{ title: 'Example Result', url: 'https://example.com', snippet: 'A web result.', publishedDate: '2 days ago' }],
                query: 'latest AI research',
                count: 1,
              },
              schema: {
                properties: {
                  results: {
                    type: 'array',
                    items: {
                      properties: {
                        title: { type: 'string' },
                        url: { type: 'string' },
                        snippet: { type: 'string' },
                        publishedDate: { type: 'string' },
                      },
                      required: ['title', 'url', 'snippet'],
                    },
                  },
                  query: { type: 'string' },
                  count: { type: 'number' },
                },
                required: ['results', 'query', 'count'],
              },
            },
          }),
        },
      },
      'POST /xrpl-query': {
        accepts: [
          {
            scheme: 'exact',
            price: '$0.002',
            network: config.network as `${string}:${string}`,
            payTo,
          },
        ],
        description: 'Query the XRPL ledger via a local node (read-only)',
        mimeType: 'application/json',
        extensions: {
          ...declareDiscoveryExtension({
            input: {
              command: 'account_info',
              params: { account: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh' },
            },
            inputSchema: {
              properties: {
                command: {
                  type: 'string',
                  enum: ['account_info', 'tx', 'ledger', 'account_lines', 'account_offers', 'book_offers', 'gateway_balances', 'account_tx'],
                  description: 'XRPL read-only command',
                },
                params: { type: 'object', description: 'Command parameters (merged into request body)' },
              },
              required: ['command'],
            },
            bodyType: 'json',
            output: {
              example: { result: { account_data: {}, status: 'success', validated: true } },
              schema: {
                properties: {
                  result: { type: 'object', description: 'Raw XRPL node response' },
                },
              },
            },
          }),
        },
      },
      'POST /dns': {
        accepts: [
          {
            scheme: 'exact',
            price: '$0.001',
            network: config.network as `${string}:${string}`,
            payTo,
          },
        ],
        description: 'DNS record lookup for any domain',
        mimeType: 'application/json',
        extensions: {
          ...declareDiscoveryExtension({
            input: {
              domain: 'example.com',
              type: 'A',
            },
            inputSchema: {
              properties: {
                domain: { type: 'string', description: 'Domain name to look up' },
                type: { type: 'string', enum: ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'SRV', 'PTR'], description: 'DNS record type (default: A)' },
              },
              required: ['domain'],
            },
            bodyType: 'json',
            output: {
              example: {
                domain: 'example.com',
                type: 'A',
                records: [{ address: '93.184.216.34', ttl: 3600 }],
                queriedAt: '2026-02-20T09:00:00Z',
              },
              schema: {
                properties: {
                  domain: { type: 'string' },
                  type: { type: 'string' },
                  records: { type: 'array' },
                  queriedAt: { type: 'string' },
                },
                required: ['domain', 'type', 'records', 'queriedAt'],
              },
            },
          }),
        },
      },
      'POST /headers': {
        accepts: [
          {
            scheme: 'exact',
            price: '$0.001',
            network: config.network as `${string}:${string}`,
            payTo,
          },
        ],
        description: 'Inspect HTTP response headers with security analysis and redirect tracking',
        mimeType: 'application/json',
        extensions: {
          ...declareDiscoveryExtension({
            input: {
              url: 'https://example.com',
              method: 'HEAD',
              followRedirects: true,
            },
            inputSchema: {
              properties: {
                url: { type: 'string', description: 'URL to inspect' },
                method: { type: 'string', enum: ['GET', 'HEAD'], description: 'HTTP method (default: HEAD)' },
                followRedirects: { type: 'boolean', description: 'Follow redirects and capture chain (default: true)' },
              },
              required: ['url'],
            },
            bodyType: 'json',
            output: {
              example: {
                url: 'https://example.com',
                finalUrl: 'https://example.com',
                statusCode: 200,
                headers: { 'content-type': 'text/html', 'strict-transport-security': 'max-age=31536000' },
                redirectChain: [],
                security: { hsts: true, csp: false, xFrameOptions: 'DENY', xContentTypeOptions: true, referrerPolicy: 'strict-origin', permissionsPolicy: false },
                server: 'ECS (dcb/7F84)',
              },
              schema: {
                properties: {
                  url: { type: 'string' },
                  finalUrl: { type: 'string' },
                  statusCode: { type: 'number' },
                  headers: { type: 'object' },
                  redirectChain: { type: 'array' },
                  security: { type: 'object' },
                  server: { type: 'string' },
                  contentType: { type: 'string' },
                  inspectedAt: { type: 'string' },
                },
                required: ['url', 'finalUrl', 'statusCode', 'headers', 'security', 'inspectedAt'],
              },
            },
          }),
        },
      },
    },
    server,
  ),
);

// --- XRPL Payment Routes ---
// XRP prices in drops (1 XRP = 1,000,000 drops)
// ~$0.005 ≈ 2500 drops, ~$0.003 ≈ 1500 drops at ~$2/XRP
const xrplPayTo = config.xrplWalletAddress;
const xrplCommonOpts = {
  network: config.xrplNetwork,
  asset: config.xrplAsset,
  facilitatorUrl: config.xrplFacilitatorUrl,
  payToAddress: xrplPayTo,
};

if (xrplPayTo) {
  // XRPL-protected routes (same endpoints, XRPL payments)
  app.use(requireXrplPayment({ ...xrplCommonOpts, path: '/xrpl/fetch', price: '2500', resource: 'serve402:fetch', description: 'Extract readable content from any URL' }));
  app.use(requireXrplPayment({ ...xrplCommonOpts, path: '/xrpl/execute', price: '2500', resource: 'serve402:execute', description: 'Run code in an isolated sandbox' }));
  app.use(requireXrplPayment({ ...xrplCommonOpts, path: '/xrpl/screenshot', price: '1500', resource: 'serve402:screenshot', description: 'Take a screenshot of any URL' }));
  app.use(requireXrplPayment({ ...xrplCommonOpts, path: '/xrpl/pdf', price: '1500', resource: 'serve402:pdf', description: 'Generate a PDF from any URL' }));
  app.use(requireXrplPayment({ ...xrplCommonOpts, path: '/xrpl/search', price: '2000', resource: 'serve402:search', description: 'Search the web using Brave Search API' }));
  app.use(requireXrplPayment({ ...xrplCommonOpts, path: '/xrpl/xrpl-query', price: '1000', resource: 'serve402:xrpl-query', description: 'Query the XRPL ledger via a local node (read-only)' }));
  app.use(requireXrplPayment({ ...xrplCommonOpts, path: '/xrpl/dns', price: '500', resource: 'serve402:dns', description: 'DNS record lookup' }));
  app.use(requireXrplPayment({ ...xrplCommonOpts, path: '/xrpl/headers', price: '500', resource: 'serve402:headers', description: 'Inspect HTTP response headers' }));

  // Wire XRPL routes to the same service handlers
  app.post('/xrpl/fetch', apiLimiter, async (req, res) => {
    try { res.json(await fetchContent(req.body)); }
    catch (err: any) { res.status(400).json({ error: err.message }); }
  });
  app.post('/xrpl/execute', apiLimiter, async (req, res) => {
    try { res.json(await executeCode(req.body)); }
    catch (err: any) { res.status(400).json({ error: err.message }); }
  });
  app.post('/xrpl/screenshot', apiLimiter, async (req, res) => {
    try {
      const format = req.body?.format === 'jpeg' ? 'jpeg' : 'png';
      const buffer = await takeScreenshot(req.body);
      res.set('Content-Type', format === 'jpeg' ? 'image/jpeg' : 'image/png');
      res.set('Content-Length', String(buffer.length));
      res.send(buffer);
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });
  app.post('/xrpl/pdf', apiLimiter, async (req, res) => {
    try {
      const buffer = await generatePdf(req.body);
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Length', String(buffer.length));
      res.send(buffer);
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });
  app.post('/xrpl/search', apiLimiter, async (req, res) => {
    try {
      res.json(await searchWeb(req.body));
    } catch (err: any) {
      if ((err as any).code === 'SEARCH_NOT_CONFIGURED') {
        return res.status(503).json({ error: 'search endpoint not configured' });
      }
      res.status(400).json({ error: err.message });
    }
  });
  app.post('/xrpl/xrpl-query', apiLimiter, async (req, res) => {
    try { res.json(await queryXrpl(req.body)); }
    catch (err: any) { res.status(400).json({ error: err.message }); }
  });
  app.post('/xrpl/dns', apiLimiter, async (req, res) => {
    try { res.json(await queryDns(req.body)); }
    catch (err: any) { res.status(400).json({ error: err.message }); }
  });
  app.post('/xrpl/headers', apiLimiter, async (req, res) => {
    try { res.json(await inspectHeaders(req.body)); }
    catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  console.log('XRPL payments enabled on /xrpl/* routes');
}

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: config.version });
});

// ─── Stats endpoint (free) ───────────────────────────────────────────────────
app.get('/stats', (_req, res) => {
  try {
    res.json(getStats());
  } catch (err: any) {
    console.error('Stats error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve stats' });
  }
});

// ─── Marketplace endpoint (free) ─────────────────────────────────────────────
app.get('/marketplace', (_req, res) => {
  const networks: Record<string, any> = {
    base: {
      network: config.network,
      payTo,
      asset: 'USDC',
      facilitator: isMainnet ? 'CDP (Coinbase)' : config.facilitatorUrl,
      routePrefix: '/',
    },
  };
  if (xrplPayTo) {
    networks.xrpl = {
      network: config.xrplNetwork,
      payTo: xrplPayTo,
      asset: config.xrplAsset,
      facilitator: config.xrplFacilitatorUrl,
      routePrefix: '/xrpl/',
    };
  }

  const services = getMarketplace({ network: config.network, xrplNetwork: config.xrplNetwork });

  res.json({
    version: config.version,
    services,
    networks,
    totalServices: services.length,
    docs: 'https://serve402.com/docs',
  });
});

// Service discovery — free, not in payment middleware config
app.get('/services', (_req, res) => {
  const networks: Record<string, any> = {
    base: {
      network: config.network,
      payTo,
      asset: 'USDC',
      facilitator: isMainnet ? 'CDP (Coinbase)' : config.facilitatorUrl,
      routePrefix: '/',
    },
  };
  if (xrplPayTo) {
    networks.xrpl = {
      network: config.xrplNetwork,
      payTo: xrplPayTo,
      asset: config.xrplAsset,
      facilitator: config.xrplFacilitatorUrl,
      routePrefix: '/xrpl/',
    };
  }
  res.json({
    services: config.services,
    version: config.version,
    networks,
  });
});

// POST /fetch — web content extraction (payment-gated)
app.post('/fetch', apiLimiter, async (req, res) => {
  try {
    const result = await fetchContent(req.body);
    res.json(result);
  } catch (err: any) {
    console.error('Fetch error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// POST /execute — code execution (payment-gated)
app.post('/execute', apiLimiter, async (req, res) => {
  try {
    const result = await executeCode(req.body);
    res.json(result);
  } catch (err: any) {
    console.error('Execute error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// POST /screenshot — screenshot capture (payment-gated)
app.post('/screenshot', apiLimiter, async (req, res) => {
  try {
    const format = req.body?.format === 'jpeg' ? 'jpeg' : 'png';
    const contentType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const buffer = await takeScreenshot(req.body);
    res.set('Content-Type', contentType);
    res.set('Content-Length', String(buffer.length));
    res.send(buffer);
  } catch (err: any) {
    console.error('Screenshot error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// POST /pdf — PDF generation (payment-gated)
app.post('/pdf', apiLimiter, async (req, res) => {
  try {
    const buffer = await generatePdf(req.body);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Length', String(buffer.length));
    res.send(buffer);
  } catch (err: any) {
    console.error('PDF error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// POST /search — web search via Brave (payment-gated)
app.post('/search', apiLimiter, async (req, res) => {
  try {
    const result = await searchWeb(req.body);
    res.json(result);
  } catch (err: any) {
    console.error('Search error:', err.message);
    if ((err as any).code === 'SEARCH_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'search endpoint not configured' });
    }
    res.status(400).json({ error: err.message });
  }
});

// POST /xrpl-query — XRPL ledger query (payment-gated)
app.post('/xrpl-query', apiLimiter, async (req, res) => {
  try {
    const result = await queryXrpl(req.body);
    res.json(result);
  } catch (err: any) {
    console.error('XRPL query error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// POST /dns — DNS record lookup (payment-gated)
app.post('/dns', apiLimiter, async (req, res) => {
  try {
    const result = await queryDns(req.body);
    res.json(result);
  } catch (err: any) {
    console.error('DNS error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// POST /headers — HTTP header inspection (payment-gated)
app.post('/headers', apiLimiter, async (req, res) => {
  try {
    const result = await inspectHeaders(req.body);
    res.json(result);
  } catch (err: any) {
    console.error('Headers error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`x402 Gateway v${config.version} listening on port ${config.port}`);
  console.log(`[Base]  Network: ${config.network} | Facilitator: ${isMainnet ? 'CDP (Coinbase)' : config.facilitatorUrl} | Wallet: ${payTo.substring(0, 10)}...`);
  if (xrplPayTo) {
    console.log(`[XRPL] Network: ${config.xrplNetwork} | Facilitator: ${config.xrplFacilitatorUrl} | Wallet: ${xrplPayTo.substring(0, 10)}...`);
  }
});
