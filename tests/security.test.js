/**
 * Integration tests — security headers and hardening
 * Run with: node --test tests/security.test.js
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, makeClient } = require("./helpers");

describe("Security headers", () => {
  let server, api;

  before(async () => {
    server = await startServer();
    api = makeClient(server);
  });

  after(() => server.close());

  async function headers(path = "/health") {
    const { headers } = await api.get(path);
    return headers;
  }

  it("sets X-Content-Type-Options: nosniff", async () => {
    const h = await headers();
    assert.equal(h.get("x-content-type-options"), "nosniff");
  });

  it("sets X-Frame-Options: DENY", async () => {
    const h = await headers();
    assert.equal(h.get("x-frame-options"), "DENY");
  });

  it("sets X-XSS-Protection", async () => {
    const h = await headers();
    assert.ok(h.get("x-xss-protection"));
  });

  it("sets Referrer-Policy", async () => {
    const h = await headers();
    assert.ok(h.get("referrer-policy"));
  });

  it("sets Content-Security-Policy", async () => {
    const h = await headers();
    const csp = h.get("content-security-policy");
    assert.ok(csp, "CSP header is present");
    assert.ok(csp.includes("default-src"), "CSP contains default-src");
    assert.ok(csp.includes("frame-ancestors"), "CSP blocks framing");
  });

  it("sets Permissions-Policy", async () => {
    const h = await headers();
    assert.ok(h.get("permissions-policy"));
  });

  it("does not set HSTS outside production", async () => {
    // In test env NODE_ENV is not 'production', so HSTS must be absent
    const h = await headers();
    assert.equal(
      h.get("strict-transport-security"),
      null,
      "HSTS must not be set outside production"
    );
  });

  it("applies headers to API routes", async () => {
    const h = await headers("/api/auth/session");
    assert.equal(h.get("x-content-type-options"), "nosniff");
  });

  it("applies headers to unknown routes", async () => {
    const h = await headers("/api/does-not-exist");
    assert.equal(h.get("x-frame-options"), "DENY");
  });
});

describe("Config validation", () => {
  it("config module loads without throwing", () => {
    assert.doesNotThrow(() => require("../src/config"));
  });

  it("exports PORT as a number", () => {
    const config = require("../src/config");
    assert.equal(typeof config.PORT, "number");
    assert.ok(config.PORT > 0);
  });

  it("exports hasFirestore as a function", () => {
    const config = require("../src/config");
    assert.equal(typeof config.hasFirestore, "function");
    // Returns false in test env (no FIRESTORE_PROJECT_ID set)
    assert.equal(config.hasFirestore(), false);
  });
});
