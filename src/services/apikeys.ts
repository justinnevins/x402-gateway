import BetterSqlite3 from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Resolve data directory — same pattern as logger.ts
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../../data');
const DB_PATH = resolve(DATA_DIR, 'apikeys.db');

// ─── Tier definitions ─────────────────────────────────────────────────────────

export type Tier = 'free' | 'starter' | 'growth' | 'unlimited';

export const TIER_LIMITS: Record<Tier, number> = {
  free:      50,
  starter:   5_000,
  growth:    25_000,
  unlimited: Infinity,
};

export const STRIPE_PRICE_IDS: Partial<Record<Tier, string>> = {
  starter: process.env.STRIPE_PRICE_STARTER || 'price_1T2hkOJAhyrigMe5pcuJL3re',
  growth:  process.env.STRIPE_PRICE_GROWTH  || 'price_1T2hllJAhyrigMe5yFkiTZTs',
};

// ─── DB row types ─────────────────────────────────────────────────────────────

export interface ApiKeyRow {
  id: number;
  key: string;
  email: string;
  tier: Tier;
  stripe_customer_id: string | null;
  created_at: string;
  active: number; // 0 or 1 (SQLite has no boolean)
}

export interface ApiUsageRow {
  id: number;
  api_key_id: number;
  endpoint: string;
  timestamp: string;
}

// ─── Module-level DB handle ───────────────────────────────────────────────────

let db: BetterSqlite3.Database | null = null;

export function initApiKeyDb(): void {
  mkdirSync(DATA_DIR, { recursive: true });

  db = new BetterSqlite3(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      key                TEXT    NOT NULL UNIQUE,
      email              TEXT    NOT NULL,
      tier               TEXT    NOT NULL DEFAULT 'free',
      stripe_customer_id TEXT,
      created_at         TEXT    NOT NULL,
      active             INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_api_keys_key    ON api_keys (key);
    CREATE INDEX IF NOT EXISTS idx_api_keys_email  ON api_keys (email);

    CREATE TABLE IF NOT EXISTS api_usage (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key_id  INTEGER NOT NULL,
      endpoint    TEXT    NOT NULL,
      timestamp   TEXT    NOT NULL,
      FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
    );

    CREATE INDEX IF NOT EXISTS idx_api_usage_key_ts
      ON api_usage (api_key_id, timestamp);
  `);

  console.log(`[apikeys] SQLite DB initialized at ${DB_PATH}`);
}

// ─── Key generation ───────────────────────────────────────────────────────────

export function generateApiKey(): string {
  return `sk_live_${randomBytes(16).toString('hex')}`;
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function createApiKey(email: string, tier: Tier = 'free', stripeCustomerId?: string): string {
  if (!db) throw new Error('API key DB not initialized');

  const key = generateApiKey();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO api_keys (key, email, tier, stripe_customer_id, created_at, active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(key, email.toLowerCase().trim(), tier, stripeCustomerId ?? null, now);

  return key;
}

export function validateApiKey(key: string): ApiKeyRow | null {
  if (!db) return null;
  if (!key.startsWith('sk_live_')) return null;

  const row = db.prepare(
    'SELECT * FROM api_keys WHERE key = ? AND active = 1'
  ).get(key) as ApiKeyRow | undefined;

  return row ?? null;
}

export function getApiKeyByEmail(email: string): ApiKeyRow | null {
  if (!db) return null;

  const row = db.prepare(
    'SELECT * FROM api_keys WHERE email = ? AND active = 1 LIMIT 1'
  ).get(email.toLowerCase().trim()) as ApiKeyRow | undefined;

  return row ?? null;
}

export function getApiKeyByStripeCustomer(stripeCustomerId: string): ApiKeyRow | null {
  if (!db) return null;

  const row = db.prepare(
    'SELECT * FROM api_keys WHERE stripe_customer_id = ? AND active = 1 LIMIT 1'
  ).get(stripeCustomerId) as ApiKeyRow | undefined;

  return row ?? null;
}

export function upgradeTier(keyId: number, tier: Tier, stripeCustomerId?: string): void {
  if (!db) return;

  if (stripeCustomerId) {
    db.prepare(
      'UPDATE api_keys SET tier = ?, stripe_customer_id = ? WHERE id = ?'
    ).run(tier, stripeCustomerId, keyId);
  } else {
    db.prepare(
      'UPDATE api_keys SET tier = ? WHERE id = ?'
    ).run(tier, keyId);
  }
}

export function deactivateApiKey(keyId: number): void {
  if (!db) return;
  db.prepare('UPDATE api_keys SET active = 0 WHERE id = ?').run(keyId);
}

// ─── Usage tracking ───────────────────────────────────────────────────────────

export function recordUsage(apiKeyId: number, endpoint: string): void {
  if (!db) return;

  db.prepare(
    'INSERT INTO api_usage (api_key_id, endpoint, timestamp) VALUES (?, ?, ?)'
  ).run(apiKeyId, endpoint, new Date().toISOString());
}

/** Returns the number of requests this calendar month. */
export function getMonthlyUsageCount(apiKeyId: number): number {
  if (!db) return 0;

  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const startIso = start.toISOString();

  const row = db.prepare(
    'SELECT COUNT(*) AS count FROM api_usage WHERE api_key_id = ? AND timestamp >= ?'
  ).get(apiKeyId, startIso) as { count: number };

  return row.count;
}

export interface UsageStats {
  tier: Tier;
  monthlyLimit: number | 'unlimited';
  usedThisMonth: number;
  remainingThisMonth: number | 'unlimited';
  periodStart: string;
  periodEnd: string;
}

export function getUsage(key: string): UsageStats | null {
  const keyRow = validateApiKey(key);
  if (!keyRow) return null;

  const used = getMonthlyUsageCount(keyRow.id);
  const limit = TIER_LIMITS[keyRow.tier];

  // Compute billing period (calendar month)
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return {
    tier: keyRow.tier,
    monthlyLimit: limit === Infinity ? 'unlimited' : limit,
    usedThisMonth: used,
    remainingThisMonth: limit === Infinity ? 'unlimited' : Math.max(0, limit - used),
    periodStart: start.toISOString(),
    periodEnd:   end.toISOString(),
  };
}

// ─── Rate limit check ────────────────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean;
  limit: number;        // -1 = unlimited
  used: number;
  remaining: number;    // -1 = unlimited
  resetAt: Date;        // start of next calendar month
}

export function checkRateLimit(keyRow: ApiKeyRow): RateLimitResult {
  const limit = TIER_LIMITS[keyRow.tier];
  const used  = getMonthlyUsageCount(keyRow.id);

  const now   = new Date();
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  if (limit === Infinity) {
    return { allowed: true, limit: -1, used, remaining: -1, resetAt: reset };
  }

  const remaining = Math.max(0, limit - used);
  return {
    allowed: remaining > 0,
    limit,
    used,
    remaining,
    resetAt: reset,
  };
}
