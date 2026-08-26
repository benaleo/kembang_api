import { Context, Next } from 'hono';
import { Bindings, Variables } from '../types';
import { safeEqual } from '../lib/safe-compare';

// ---------------------------------------------------------------------------
// Rate limiter (in-memory fixed window per isolate)
//
// NOTE: pada Cloudflare Workers map ini hidup per-isolate dan bisa reset,
// jadi ini bukan pengganti WAF/rate limiting rule di dashboard — tapi tetap
// efektif memperlambat brute force dari satu IP yang kena isolate yang sama.
// ---------------------------------------------------------------------------

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
let lastPrune = 0;

function prune(now: number) {
  if (now - lastPrune < 60_000) return;
  lastPrune = now;
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
}

type RateLimitOptions = {
  /** Nama bucket biar limiter berbeda tidak saling menimpa */
  name: string;
  /** Window dalam ms */
  windowMs: number;
  /** Max request per window */
  max: number;
};

export function rateLimit(options: RateLimitOptions) {
  return async (c: Context<{ Bindings: Bindings; Variables: Variables }>, next: Next) => {
    const ip =
      c.req.header('CF-Connecting-IP') ||
      c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
      'unknown';
    const key = `${options.name}:${c.req.path}:${ip}`;
    const now = Date.now();

    prune(now);

    let bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    if (bucket.count > options.max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      return c.json({ error: 'Terlalu banyak permintaan, coba lagi nanti' }, 429);
    }

    await next();
  };
}

// ---------------------------------------------------------------------------
// Basic auth untuk melindungi dokumentasi Swagger
// ---------------------------------------------------------------------------

export function swaggerBasicAuth() {
  return async (
    c: Context<{ Bindings: Bindings; Variables: Variables }>,
    next: Next,
  ) => {
    const username = c.env.SWAGGER_USERNAME;
    const password = c.env.SWAGGER_PASSWORD;

    // Kredensial belum dikonfigurasi — jangan expose docs sama sekali
    if (!username || !password) {
      return c.text('Not Found', 404);
    }

    const header = c.req.header('Authorization') || '';
    if (header.startsWith('Basic ')) {
      try {
        const decoded = atob(header.slice(6));
        const separator = decoded.indexOf(':');
        const user = separator >= 0 ? decoded.slice(0, separator) : '';
        const pass = separator >= 0 ? decoded.slice(separator + 1) : '';
        if (safeEqual(user, username) && safeEqual(pass, password)) {
          await next();
          return;
        }
      } catch {
        // fallthrough ke 401
      }
    }

    c.header('WWW-Authenticate', 'Basic realm="Kembang API Docs", charset="UTF-8"');
    return c.text('Unauthorized', 401);
  };
}

// ---------------------------------------------------------------------------
// Secure headers dasar
// ---------------------------------------------------------------------------

export async function secureHeaders(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  next: Next,
) {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
}
