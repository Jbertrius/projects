/**
 * Security headers — no external dependency.
 *
 * Applied to every response. Covers the most impactful headers without
 * over-engineering (no full Helmet needed at this scale).
 *
 * What each header does:
 *   X-Content-Type-Options    — prevents MIME-type sniffing
 *   X-Frame-Options           — blocks clickjacking via <iframe>
 *   X-XSS-Protection          — legacy browser XSS filter (belt-and-suspenders)
 *   Referrer-Policy           — don't leak URLs to third parties
 *   Permissions-Policy        — disable browser features not used by this app
 *   Strict-Transport-Security — force HTTPS on repeat visits (prod only)
 *   Content-Security-Policy   — restrict resource loading origins
 */

const IS_PROD = process.env.NODE_ENV === "production";

// CSP that allows our own inline scripts/styles (needed for vanilla JS dashboard)
// and the CDN sources used by the frontend (ApexCharts, Material Symbols).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' cdn.jsdelivr.net",  // ApexCharts from CDN
  "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
  "font-src 'self' fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' fonts.googleapis.com fonts.gstatic.com cdn.jsdelivr.net",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join("; ");

function securityHeaders(req, res, next) {
  res.set("X-Content-Type-Options",  "nosniff");
  res.set("X-Frame-Options",         "DENY");
  res.set("X-XSS-Protection",        "1; mode=block");
  res.set("Referrer-Policy",         "strict-origin-when-cross-origin");
  res.set("Permissions-Policy",      "camera=(), microphone=(), geolocation=()");
  res.set("Content-Security-Policy", CSP);

  // HSTS only makes sense over HTTPS — skip in dev to avoid breaking local HTTP
  if (IS_PROD) {
    res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  next();
}

module.exports = { securityHeaders };
