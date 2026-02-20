/**
 * MCP tool definitions for serve402.com
 *
 * Each tool maps to a serve402 HTTP endpoint.
 * Descriptions are written to be semantic and action-oriented so LLMs
 * can correctly decide when and how to invoke each tool.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const TOOLS: Tool[] = [
  // ── serve402_fetch ──────────────────────────────────────────────────────────
  {
    name: "serve402_fetch",
    description:
      "Fetch and extract readable content from any URL using a headless browser. " +
      "Returns clean text or markdown extracted from the page via Mozilla Readability. " +
      "Use this when you need to read the content of a specific web page, article, or document URL. " +
      "Costs $0.005 USDC (Base) or 2500 XRP drops per request, paid automatically via x402.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          format: "uri",
          description: "The URL to fetch content from (must be http:// or https://)",
        },
        format: {
          type: "string",
          enum: ["markdown", "text"],
          default: "markdown",
          description: "Output format: 'markdown' (default) preserves basic formatting, 'text' is plain text",
        },
        maxChars: {
          type: "number",
          minimum: 100,
          maximum: 200000,
          default: 50000,
          description: "Maximum characters to return (default 50000, max 200000). Content is truncated with '[truncated]' marker.",
        },
      },
      required: ["url"],
    },
  },

  // ── serve402_search ─────────────────────────────────────────────────────────
  {
    name: "serve402_search",
    description:
      "Search the web and return structured results with titles, URLs, and snippets. " +
      "Powered by Brave Search. Use this when you need to find current information, " +
      "research a topic, or discover relevant URLs for a query. " +
      "Returns up to 20 results with title, URL, snippet, and optional publish date. " +
      "Costs $0.009 USDC (Base) or 4500 XRP drops per request, paid automatically via x402.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query string",
        },
        count: {
          type: "number",
          minimum: 1,
          maximum: 20,
          default: 5,
          description: "Number of results to return (default 5, max 20)",
        },
        freshness: {
          type: "string",
          enum: ["day", "week", "month", "year"],
          description: "Filter results by recency: 'day' (last 24h), 'week', 'month', 'year'. Omit for all-time.",
        },
      },
      required: ["query"],
    },
  },

  // ── serve402_execute ────────────────────────────────────────────────────────
  {
    name: "serve402_execute",
    description:
      "Execute Python or JavaScript code in an isolated cloud sandbox and return stdout, stderr, and exit code. " +
      "The sandbox has access to common libraries (numpy, pandas, requests for Python; node built-ins for JS). " +
      "Use this when you need to run calculations, process data, test code, or perform computations. " +
      "Maximum timeout is 30 seconds. " +
      "Costs $0.005 USDC (Base) or 2500 XRP drops per request, paid automatically via x402.",
    inputSchema: {
      type: "object",
      properties: {
        language: {
          type: "string",
          enum: ["python", "javascript"],
          description: "Programming language to execute ('python' or 'javascript')",
        },
        code: {
          type: "string",
          description: "The code to execute",
        },
        timeout: {
          type: "number",
          minimum: 1,
          maximum: 30,
          default: 10,
          description: "Execution timeout in seconds (default 10, max 30)",
        },
      },
      required: ["language", "code"],
    },
  },

  // ── serve402_screenshot ─────────────────────────────────────────────────────
  {
    name: "serve402_screenshot",
    description:
      "Capture a screenshot of any web page using a headless browser and return it as an image. " +
      "Use this when you need to see how a page looks, verify its visual content, or capture a UI. " +
      "Returns a PNG or JPEG image. Supports full-page screenshots. " +
      "Costs $0.003 USDC (Base) or 1500 XRP drops per request, paid automatically via x402.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          format: "uri",
          description: "The URL to screenshot (must be http:// or https://)",
        },
        format: {
          type: "string",
          enum: ["png", "jpeg"],
          default: "png",
          description: "Image format: 'png' (default, lossless) or 'jpeg' (smaller file size)",
        },
        fullPage: {
          type: "boolean",
          default: false,
          description: "Capture the full scrollable page (true) or just the viewport (false, default)",
        },
      },
      required: ["url"],
    },
  },

  // ── serve402_pdf ────────────────────────────────────────────────────────────
  {
    name: "serve402_pdf",
    description:
      "Generate a PDF document from any web page URL. " +
      "Use this when you need to convert a web page to PDF for archiving, sharing, or reading offline. " +
      "Returns the PDF as a base64-encoded resource. " +
      "Costs $0.003 USDC (Base) or 1500 XRP drops per request, paid automatically via x402.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          format: "uri",
          description: "The URL to convert to PDF (must be http:// or https://)",
        },
        format: {
          type: "string",
          enum: ["A4", "Letter", "Legal"],
          default: "A4",
          description: "Page format: 'A4' (default, international), 'Letter' (US), or 'Legal' (US legal)",
        },
      },
      required: ["url"],
    },
  },

  // ── serve402_xrpl_query ─────────────────────────────────────────────────────
  {
    name: "serve402_xrpl_query",
    description:
      "Query the XRP Ledger blockchain for account information, transactions, balances, DEX orders, and more. " +
      "All queries are read-only (no write operations). " +
      "Use this when you need to look up XRPL account data, transaction history, token balances, or DEX order books. " +
      "Costs $0.002 USDC (Base) or 1000 XRP drops per request, paid automatically via x402.\n\n" +
      "Available commands:\n" +
      "  account_info    — Account balance and sequence number\n" +
      "  tx              — Transaction details by hash\n" +
      "  ledger          — Ledger details by index or hash\n" +
      "  account_lines   — Trust lines and token balances\n" +
      "  account_offers  — Open DEX offers for an account\n" +
      "  book_offers     — DEX order book between two currencies\n" +
      "  gateway_balances — Issued currency balances for a gateway\n" +
      "  account_tx      — Transaction history for an account",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          enum: [
            "account_info",
            "tx",
            "ledger",
            "account_lines",
            "account_offers",
            "book_offers",
            "gateway_balances",
            "account_tx",
          ],
          description: "XRPL API command to execute",
        },
        params: {
          type: "object",
          description:
            "Command parameters (merged with command for XRPL protocol). Examples:\n" +
            "  account_info: { account: 'r...' }\n" +
            "  tx: { transaction: 'HASH...' }\n" +
            "  ledger: { ledger_index: 'validated' }\n" +
            "  account_lines: { account: 'r...', peer: 'r...' (optional) }\n" +
            "  account_offers: { account: 'r...' }\n" +
            "  book_offers: { taker_gets: { currency: 'XRP' }, taker_pays: { currency: 'USD', issuer: 'r...' } }\n" +
            "  gateway_balances: { account: 'r...', hotwallet: ['r...'] }\n" +
            "  account_tx: { account: 'r...', limit: 10 }",
          additionalProperties: true,
        },
      },
      required: ["command"],
    },
  },
];
