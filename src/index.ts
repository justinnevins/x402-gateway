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

const app = express();
app.use(cors());
app.use(express.json());

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

  console.log('XRPL payments enabled on /xrpl/* routes');
}

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: config.version });
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

app.listen(config.port, '0.0.0.0', () => {
  console.log(`x402 Gateway v${config.version} listening on port ${config.port}`);
  console.log(`[Base]  Network: ${config.network} | Facilitator: ${isMainnet ? 'CDP (Coinbase)' : config.facilitatorUrl} | Wallet: ${payTo.substring(0, 10)}...`);
  if (xrplPayTo) {
    console.log(`[XRPL] Network: ${config.xrplNetwork} | Facilitator: ${config.xrplFacilitatorUrl} | Wallet: ${xrplPayTo.substring(0, 10)}...`);
  }
});
