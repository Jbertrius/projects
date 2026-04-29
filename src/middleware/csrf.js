/**
 * CSRF protection — double-submit cookie pattern.
 *
 * How it works:
 *  1. On GET /api/auth/session (and on login), the server generates a random
 *     CSRF token and returns it in the response body as `csrfToken`.
 *  2. The browser JS reads this token and includes it as the `X-CSRF-Token`
 *     header on every state-changing request (POST / PATCH / DELETE).
 *  3. This middleware validates that header against a value derived from the
 *     session. Requests with a valid API key (bots) are exempt.
 *
 * Enforcement:
 *  - Only active when APP_CSRF_ENABLED=true (or IS_PROD=true in production).
 *  - Requests authenticated via API key (req.botIdentity) are always exempt.
 *  - Safe methods (GET, HEAD, OPTIONS) are always exempt.
 *
 * Frontend integration (required for full protection):
 *  1. After login, or on page load, call GET /api/auth/session.
 *  2. Store `body.csrfToken` in memory (never localStorage).
 *  3. Add `X-CSRF-Token: <token>` to all POST/PATCH/DELETE fetch() calls.
 */

const crypto = require("crypto");
const { readStableSecretMaterial } = require("../../lib/auth");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Generate a deterministic CSRF token from a session identifier and the app secret.
 * Using HMAC means we don't need to store the token server-side.
 */
function generateCsrfToken(sessionId, secret) {
  return crypto
    .createHmac("sha256", String(secret || "dev-csrf-secret"))
    .update(String(sessionId || "anonymous"))
    .digest("hex");
}

/**
 * Middleware: validate X-CSRF-Token on state-changing requests.
 *
 * Attach this AFTER sessionAuth and apiKeyAuth so req.sessionUser and
 * req.botIdentity are already set.
 */
function csrfProtection(req, res, next) {
  // Always exempt safe HTTP methods
  if (SAFE_METHODS.has(req.method)) return next();

  // Always exempt bot API key requests
  if (req.botIdentity) return next();

  // Only enforce when explicitly enabled (set APP_CSRF_ENABLED=true in prod)
  const enabled =
    process.env.APP_CSRF_ENABLED === "true" ||
    (process.env.NODE_ENV === "production" && process.env.APP_CSRF_ENABLED !== "false");

  if (!enabled) return next();

  // No session → let requireAuth handle the 401
  if (!req.sessionUser) return next();

  const provided = String(req.headers["x-csrf-token"] || "").trim();
  const expected = generateCsrfToken(req.sessionUser.id, readStableSecretMaterial());

  if (!provided || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
    return res.status(403).json({ ok: false, error: "CSRF token invalide ou manquant." });
  }

  next();
}

/**
 * Helper: get the CSRF token for a given session user.
 * Call this in auth routes to include the token in responses.
 */
function getCsrfToken(sessionUser) {
  if (!sessionUser) return null;
  return generateCsrfToken(sessionUser.id, readStableSecretMaterial());
}

module.exports = { csrfProtection, getCsrfToken };
