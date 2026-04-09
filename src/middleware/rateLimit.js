/**
 * Minimal in-process rate limiter — no external dep needed at this scale.
 *
 * Tracks hits per IP using a sliding window. Stale windows are pruned on
 * every request so memory stays bounded.
 *
 * Usage:
 *   app.use("/api/auth/login", rateLimit({ windowMs: 60_000, max: 10 }));
 */

function rateLimit({ windowMs = 60_000, max = 20, message } = {}) {
  const hits = new Map(); // ip -> [timestamp, ...]

  return function rateLimitMiddleware(req, res, next) {
    const ip =
      String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.socket.remoteAddress ||
      "unknown";

    const now = Date.now();
    const windowStart = now - windowMs;

    // Prune stale entries for this IP
    const timestamps = (hits.get(ip) || []).filter((ts) => ts > windowStart);
    timestamps.push(now);
    hits.set(ip, timestamps);

    // Prune IPs that haven't been seen recently (keep memory bounded)
    if (hits.size > 10_000) {
      for (const [key, ts] of hits.entries()) {
        if (ts[ts.length - 1] < windowStart) hits.delete(key);
      }
    }

    if (timestamps.length > max) {
      res.set("Retry-After", Math.ceil(windowMs / 1000));
      return res.status(429).json({
        ok: false,
        error: message || "Trop de tentatives. Veuillez reessayer plus tard."
      });
    }

    next();
  };
}

module.exports = { rateLimit };
