import BetterSqlite3 from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Resolve data directory relative to project root (two levels up from src/services/)
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../../data');
const DB_PATH = resolve(DATA_DIR, 'requests.db');

export interface RequestLogEntry {
  timestamp: string;   // ISO 8601
  endpoint: string;    // e.g. "/fetch", "/xrpl/screenshot"
  chain: 'base' | 'xrpl';
  wallet: string;      // payer wallet address
  amount: string;      // native units: USDC string or drops integer string
  status: number;      // HTTP response status code
}

export interface StatsResult {
  totalRequests: number;
  totalVolume: { xrp_drops: string; usdc: string };
  uniqueWallets: number;
  last24h: { requests: number; volume: { xrp_drops: string; usdc: string } };
  topEndpoints: Array<{ endpoint: string; count: number }>;
  since: string;
}

let db: BetterSqlite3.Database | null = null;

export function initDb(): void {
  // Ensure data directory exists
  mkdirSync(DATA_DIR, { recursive: true });

  db = new BetterSqlite3(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT    NOT NULL,
      endpoint  TEXT    NOT NULL,
      chain     TEXT    NOT NULL,
      wallet    TEXT    NOT NULL,
      amount    TEXT    NOT NULL,
      status    INTEGER NOT NULL
    )
  `);

  // Index for time-range queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests (timestamp);
    CREATE INDEX IF NOT EXISTS idx_requests_chain     ON requests (chain);
    CREATE INDEX IF NOT EXISTS idx_requests_endpoint  ON requests (endpoint);
  `);

  console.log(`[logger] SQLite DB initialized at ${DB_PATH}`);
}

export function logRequest(entry: RequestLogEntry): void {
  if (!db) return;
  try {
    db.prepare(`
      INSERT INTO requests (timestamp, endpoint, chain, wallet, amount, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(entry.timestamp, entry.endpoint, entry.chain, entry.wallet, entry.amount, entry.status);
  } catch (err) {
    console.error('[logger] Failed to log request:', err);
  }
}

// ─── Stats queries ────────────────────────────────────────────────────────────

export function getStats(): StatsResult {
  if (!db) {
    const now = new Date().toISOString();
    return {
      totalRequests: 0,
      totalVolume: { xrp_drops: '0', usdc: '0.000000' },
      uniqueWallets: 0,
      last24h: { requests: 0, volume: { xrp_drops: '0', usdc: '0.000000' } },
      topEndpoints: [],
      since: now,
    };
  }

  const totalRequests = (db.prepare(
    'SELECT COUNT(*) AS count FROM requests'
  ).get() as { count: number }).count;

  const xrpDrops = (db.prepare(
    "SELECT COALESCE(SUM(CAST(amount AS INTEGER)), 0) AS total FROM requests WHERE chain = 'xrpl'"
  ).get() as { total: number }).total;

  const usdcTotal = (db.prepare(
    "SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) AS total FROM requests WHERE chain = 'base'"
  ).get() as { total: number }).total;

  const uniqueWallets = (db.prepare(
    'SELECT COUNT(DISTINCT wallet) AS count FROM requests'
  ).get() as { count: number }).count;

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const last24hRequests = (db.prepare(
    'SELECT COUNT(*) AS count FROM requests WHERE timestamp >= ?'
  ).get(since24h) as { count: number }).count;

  const last24hXrp = (db.prepare(
    "SELECT COALESCE(SUM(CAST(amount AS INTEGER)), 0) AS total FROM requests WHERE chain = 'xrpl' AND timestamp >= ?"
  ).get(since24h) as { total: number }).total;

  const last24hUsdc = (db.prepare(
    "SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) AS total FROM requests WHERE chain = 'base' AND timestamp >= ?"
  ).get(since24h) as { total: number }).total;

  const topEndpoints = db.prepare(`
    SELECT endpoint, COUNT(*) AS count
    FROM   requests
    GROUP  BY endpoint
    ORDER  BY count DESC
    LIMIT  10
  `).all() as Array<{ endpoint: string; count: number }>;

  const sinceRow = db.prepare(
    'SELECT MIN(timestamp) AS first FROM requests'
  ).get() as { first: string | null };

  return {
    totalRequests,
    totalVolume: {
      xrp_drops: String(xrpDrops),
      usdc: usdcTotal.toFixed(6),
    },
    uniqueWallets,
    last24h: {
      requests: last24hRequests,
      volume: {
        xrp_drops: String(last24hXrp),
        usdc: last24hUsdc.toFixed(6),
      },
    },
    topEndpoints,
    since: sinceRow.first ?? new Date().toISOString(),
  };
}
