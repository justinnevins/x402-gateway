#!/usr/bin/env node
/**
 * serve402 MCP Server
 *
 * Exposes serve402.com's pay-per-use AI agent tools as MCP tools.
 * Each tool call automatically handles the x402 payment flow —
 * no API keys, no subscriptions, just pay per request.
 *
 * Tools:
 *   serve402_fetch       — Extract readable content from any URL
 *   serve402_search      — Web search with structured results
 *   serve402_execute     — Run Python or JS code in a sandbox
 *   serve402_screenshot  — Capture a webpage as PNG/JPEG (base64)
 *   serve402_pdf         — Generate a PDF from a URL (base64)
 *   serve402_xrpl_query  — Query the XRP Ledger
 *
 * Pricing (paid automatically via x402):
 *   /fetch, /execute  — $0.005 USDC or 2500 drops XRP
 *   /search           — $0.009 USDC or 4500 drops XRP
 *   /screenshot, /pdf — $0.003 USDC or 1500 drops XRP
 *   /xrpl-query       — $0.002 USDC or 1000 drops XRP
 *
 * Configuration via environment variables:
 *   SERVE402_BASE_URL          — API base URL (default: https://serve402.com)
 *   SERVE402_PAYMENT_NETWORK   — "base" | "xrpl" (default: base)
 *   SERVE402_WALLET_PRIVATE_KEY — EVM wallet private key (for Base/USDC payments)
 *   SERVE402_XRPL_SEED         — XRPL wallet seed (for XRP payments)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createPaymentClient } from "./payment.js";
import { TOOLS } from "./tools.js";

// ─── Config ──────────────────────────────────────────────────────────────────

const BASE_URL = process.env.SERVE402_BASE_URL?.replace(/\/$/, "") ?? "https://serve402.com";
const PAYMENT_NETWORK = (process.env.SERVE402_PAYMENT_NETWORK ?? "base") as "base" | "xrpl";

// ─── Payment client ───────────────────────────────────────────────────────────

const paymentFetch = createPaymentClient({
  network: PAYMENT_NETWORK,
  walletPrivateKey: process.env.SERVE402_WALLET_PRIVATE_KEY,
  xrplSeed: process.env.SERVE402_XRPL_SEED,
  baseUrl: BASE_URL,
});

// ─── Tool handlers ────────────────────────────────────────────────────────────

async function callServe402(endpoint: string, body: Record<string, unknown>) {
  const url =
    PAYMENT_NETWORK === "xrpl"
      ? `${BASE_URL}/xrpl${endpoint}`
      : `${BASE_URL}${endpoint}`;

  const response = await paymentFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    let errMsg: string;
    try {
      errMsg = JSON.parse(errText).error ?? errText;
    } catch {
      errMsg = errText;
    }
    throw new McpError(
      ErrorCode.InternalError,
      `serve402 ${endpoint} failed (${response.status}): ${errMsg}`
    );
  }

  return response;
}

// ─── Tool input schemas (Zod) ─────────────────────────────────────────────────

const FetchInput = z.object({
  url: z.string().url(),
  format: z.enum(["markdown", "text"]).optional().default("markdown"),
  maxChars: z.number().int().positive().max(200000).optional().default(50000),
});

const SearchInput = z.object({
  query: z.string().min(1),
  count: z.number().int().min(1).max(20).optional().default(5),
  freshness: z.enum(["day", "week", "month", "year"]).optional(),
});

const ExecuteInput = z.object({
  language: z.enum(["python", "javascript"]),
  code: z.string().min(1),
  timeout: z.number().int().min(1).max(30).optional().default(10),
});

const ScreenshotInput = z.object({
  url: z.string().url(),
  format: z.enum(["png", "jpeg"]).optional().default("png"),
  fullPage: z.boolean().optional().default(false),
});

const PdfInput = z.object({
  url: z.string().url(),
  format: z.enum(["A4", "Letter", "Legal"]).optional().default("A4"),
});

const XrplQueryInput = z.object({
  command: z.enum([
    "account_info",
    "tx",
    "ledger",
    "account_lines",
    "account_offers",
    "book_offers",
    "gateway_balances",
    "account_tx",
  ]),
  params: z.record(z.unknown()).optional().default({}),
});

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new Server(
  {
    name: "serve402",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// Call tool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    // ── serve402_fetch ──────────────────────────────────────────────────────
    case "serve402_fetch": {
      const input = FetchInput.parse(args);
      const res = await callServe402("/fetch", input);
      const data = await res.json() as {
        url: string;
        title: string;
        content: string;
        contentLength: number;
        fetchedAt: string;
      };

      return {
        content: [
          {
            type: "text" as const,
            text: `# ${data.title}\n\n**URL:** ${data.url}\n**Fetched:** ${data.fetchedAt}\n**Length:** ${data.contentLength} chars\n\n---\n\n${data.content}`,
          },
        ],
      };
    }

    // ── serve402_search ─────────────────────────────────────────────────────
    case "serve402_search": {
      const input = SearchInput.parse(args);
      const res = await callServe402("/search", input);
      const data = await res.json() as {
        query: string;
        count: number;
        results: Array<{
          title: string;
          url: string;
          snippet: string;
          publishedDate?: string;
        }>;
      };

      const formatted = data.results
        .map(
          (r, i) =>
            `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}${r.publishedDate ? `\n   *${r.publishedDate}*` : ""}`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `## Search Results for "${data.query}"\n\n${formatted}`,
          },
        ],
      };
    }

    // ── serve402_execute ────────────────────────────────────────────────────
    case "serve402_execute": {
      const input = ExecuteInput.parse(args);
      const res = await callServe402("/execute", input);
      const data = await res.json() as {
        stdout: string;
        stderr: string;
        exitCode: number;
        executionTime: number;
      };

      const parts: string[] = [
        `**Language:** ${input.language}`,
        `**Exit code:** ${data.exitCode}`,
        `**Execution time:** ${data.executionTime.toFixed(2)}s`,
      ];
      if (data.stdout) parts.push(`\n**stdout:**\n\`\`\`\n${data.stdout}\n\`\`\``);
      if (data.stderr) parts.push(`\n**stderr:**\n\`\`\`\n${data.stderr}\n\`\`\``);

      return {
        content: [
          {
            type: "text" as const,
            text: parts.join("\n"),
          },
        ],
        isError: data.exitCode !== 0,
      };
    }

    // ── serve402_screenshot ─────────────────────────────────────────────────
    case "serve402_screenshot": {
      const input = ScreenshotInput.parse(args);
      const res = await callServe402("/screenshot", input);
      const buffer = await res.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      const mimeType = input.format === "jpeg" ? "image/jpeg" : "image/png";

      return {
        content: [
          {
            type: "image" as const,
            data: base64,
            mimeType,
          },
          {
            type: "text" as const,
            text: `Screenshot of ${input.url} (${input.format ?? "png"}, ${(buffer.byteLength / 1024).toFixed(1)} KB)`,
          },
        ],
      };
    }

    // ── serve402_pdf ────────────────────────────────────────────────────────
    case "serve402_pdf": {
      const input = PdfInput.parse(args);
      const res = await callServe402("/pdf", input);
      const buffer = await res.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");

      return {
        content: [
          {
            type: "resource" as const,
            resource: {
              uri: `data:application/pdf;base64,${base64}`,
              mimeType: "application/pdf",
              blob: base64,
            },
          },
          {
            type: "text" as const,
            text: `PDF generated from ${input.url} (${(buffer.byteLength / 1024).toFixed(1)} KB, format: ${input.format ?? "A4"})`,
          },
        ],
      };
    }

    // ── serve402_xrpl_query ─────────────────────────────────────────────────
    case "serve402_xrpl_query": {
      const input = XrplQueryInput.parse(args);
      const body = { command: input.command, params: input.params };
      const res = await callServe402("/xrpl-query", body);
      const data = await res.json() as unknown;

      return {
        content: [
          {
            type: "text" as const,
            text: `## XRPL Query: ${input.command}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``,
          },
        ],
      };
    }

    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  // Validate required config
  if (PAYMENT_NETWORK === "base" && !process.env.SERVE402_WALLET_PRIVATE_KEY) {
    console.error(
      "[serve402-mcp] ⚠️  SERVE402_WALLET_PRIVATE_KEY not set.\n" +
      "  Set it to an EVM wallet private key with USDC on Base mainnet.\n" +
      "  Or set SERVE402_PAYMENT_NETWORK=xrpl and SERVE402_XRPL_SEED for XRP payments."
    );
    process.exit(1);
  }

  if (PAYMENT_NETWORK === "xrpl" && !process.env.SERVE402_XRPL_SEED) {
    console.error(
      "[serve402-mcp] ⚠️  SERVE402_XRPL_SEED not set.\n" +
      "  Set it to your XRPL wallet family seed (s...) with XRP balance."
    );
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[serve402-mcp] MCP server running on stdio");
}

main().catch((err) => {
  console.error("[serve402-mcp] Fatal error:", err);
  process.exit(1);
});
