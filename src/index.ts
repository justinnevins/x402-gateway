import express from 'express';
import cors from 'cors';
import { paymentMiddleware } from '@x402/express';
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { registerExactEvmScheme } from '@x402/evm/exact/server';
import {
  bazaarResourceServerExtension,
  declareDiscoveryExtension,
} from '@x402/extensions/bazaar';
import { createFacilitatorConfig } from '@coinbase/x402';
import { config } from './config.js';
import { fetchContent } from './services/fetch.js';
import { executeCode } from './services/execute.js';

const app = express();
app.use(cors());
app.use(express.json());

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
            price: '$0.001',
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
            price: '$0.001',
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
    },
    server,
  ),
);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: config.version });
});

// Service discovery — free, not in payment middleware config
app.get('/services', (_req, res) => {
  res.json({
    services: config.services,
    version: config.version,
    payTo,
    network: config.network,
    facilitator: isMainnet ? 'CDP (Coinbase)' : config.facilitatorUrl,
  });
});

// POST /fetch — web content extraction (payment-gated)
app.post('/fetch', async (req, res) => {
  try {
    const result = await fetchContent(req.body);
    res.json(result);
  } catch (err: any) {
    console.error('Fetch error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// POST /execute — code execution (payment-gated)
app.post('/execute', async (req, res) => {
  try {
    const result = await executeCode(req.body);
    res.json(result);
  } catch (err: any) {
    console.error('Execute error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`x402 Gateway listening on port ${config.port}`);
  console.log(`Network: ${config.network}`);
  console.log(`Facilitator: ${isMainnet ? 'CDP (Coinbase)' : config.facilitatorUrl}`);
  console.log(`Wallet: ${payTo.substring(0, 10)}...`);
});
