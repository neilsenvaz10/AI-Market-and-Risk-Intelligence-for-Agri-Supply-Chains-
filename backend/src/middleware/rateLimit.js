/**
 * Small in-memory fixed-window rate limiter (single backend instance).
 * Applied before authentication so token verification cannot be used to flood
 * the server. Responds 429 with Retry-After.
 */
export function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 5, keyFn = (req) => req.ip || 'unknown', code = 'RATE_LIMITED' } = {}) {
  const hits = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, windowMs);
  sweep.unref?.();

  function rateLimit(req, res, next) {
    const now = Date.now();
    const key = keyFn(req);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ status: 'error', code, message: 'Too many requests. Please try again later.' });
    }
    return next();
  }
  rateLimit.reset = () => hits.clear();
  return rateLimit;
}

export default createRateLimiter;
