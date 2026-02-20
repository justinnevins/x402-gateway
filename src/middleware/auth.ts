import { Request, Response, NextFunction } from 'express';
import {
  validateApiKey,
  checkRateLimit,
  recordUsage,
  ApiKeyRow,
  RateLimitResult,
} from '../services/apikeys.js';

// Augment Express locals so TypeScript is happy
declare global {
  namespace Express {
    interface Locals {
      /** Set when a valid API key was used to authenticate this request. */
      apiKeyAuth?: {
        keyRow: ApiKeyRow;
        rateLimit: RateLimitResult;
      };
    }
  }
}

/**
 * API key authentication middleware.
 *
 * Strategy:
 *  - If `Authorization: Bearer sk_live_...` is present:
 *      - Valid key + quota remaining → attach to res.locals and call next()
 *      - Valid key + quota exhausted → 429
 *      - Invalid / inactive key     → 401
 *  - If header is absent → call next() immediately (fall through to x402)
 *
 * The x402 payment middleware MUST be wrapped to check `res.locals.apiKeyAuth`
 * and skip itself when it's set (see index.ts).
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];

  // No auth header → not an API key request, fall through to x402
  if (!authHeader) {
    return next();
  }

  // Must be "Bearer sk_live_..."
  const match = authHeader.match(/^Bearer (sk_live_[0-9a-f]{32})$/);
  if (!match) {
    // Header present but doesn't look like our key format → let x402 handle it
    // (some x402 clients may use Authorization header differently)
    return next();
  }

  const rawKey = match[1];
  const keyRow = validateApiKey(rawKey);

  if (!keyRow) {
    res.status(401).json({
      error: 'Invalid or inactive API key',
      hint: 'Sign up at https://serve402.com to get a key',
    });
    return;
  }

  const rateLimit = checkRateLimit(keyRow);

  // Always set the rate limit headers so clients can introspect their quota
  const limitHeader  = rateLimit.limit === -1 ? 'unlimited' : String(rateLimit.limit);
  const remainHeader = rateLimit.remaining === -1 ? 'unlimited' : String(rateLimit.remaining);

  res.setHeader('X-RateLimit-Limit',     limitHeader);
  res.setHeader('X-RateLimit-Remaining', remainHeader);
  res.setHeader('X-RateLimit-Reset',     String(Math.floor(rateLimit.resetAt.getTime() / 1000)));
  res.setHeader('X-RateLimit-Tier',      keyRow.tier);

  if (!rateLimit.allowed) {
    res.status(429).json({
      error: 'Monthly request quota exceeded',
      tier: keyRow.tier,
      limit: rateLimit.limit,
      used: rateLimit.used,
      resetAt: rateLimit.resetAt.toISOString(),
      hint: 'Upgrade your plan at https://serve402.com',
    });
    return;
  }

  // Valid key with remaining quota — record usage now (before handler runs)
  recordUsage(keyRow.id, req.path);

  // Attach auth context for downstream middleware / handlers
  res.locals.apiKeyAuth = { keyRow, rateLimit };

  next();
}

/**
 * Wraps an existing Express middleware so it is skipped when the request
 * was already authenticated via API key.
 *
 * Usage:
 *   app.use(skipIfApiKey(paymentMiddleware(...)));
 */
export function skipIfApiKey(
  middleware: (req: Request, res: Response, next: NextFunction) => void
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    if (res.locals.apiKeyAuth) {
      // API key already authenticated → skip this middleware entirely
      return next();
    }
    return middleware(req, res, next);
  };
}

/**
 * Middleware that requires a valid API key (for /api/* management endpoints).
 * Does NOT fall through to x402.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    res.status(401).json({
      error: 'API key required',
      hint: 'Pass your key as: Authorization: Bearer sk_live_...',
    });
    return;
  }

  const match = authHeader.match(/^Bearer (sk_live_[0-9a-f]{32})$/);
  if (!match) {
    res.status(401).json({ error: 'Invalid Authorization header format' });
    return;
  }

  const keyRow = validateApiKey(match[1]);
  if (!keyRow) {
    res.status(401).json({ error: 'Invalid or inactive API key' });
    return;
  }

  res.locals.apiKeyAuth = {
    keyRow,
    rateLimit: checkRateLimit(keyRow),
  };

  next();
}
