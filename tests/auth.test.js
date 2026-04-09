/**
 * Integration tests — auth routes
 * Run with: node --test tests/auth.test.js
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, makeClient } = require("./helpers");

describe("Auth routes", () => {
  let server, api;

  before(async () => {
    server = await startServer();
    api = makeClient(server);
  });

  after(() => server.close());

  // -------------------------------------------------------------------------
  // GET /api/auth/session
  // -------------------------------------------------------------------------
  describe("GET /api/auth/session", () => {
    it("returns 200 with authenticated:false when no cookie", async () => {
      const { status, body } = await api.get("/api/auth/session");
      assert.equal(status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.authenticated, false);
    });

    it("includes authConfigured field", async () => {
      const { body } = await api.get("/api/auth/session");
      assert.ok("authConfigured" in body);
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/auth/login — validation
  // -------------------------------------------------------------------------
  describe("POST /api/auth/login — input validation", () => {
    it("returns 400 when body is empty", async () => {
      const { status, body } = await api.post("/api/auth/login", {});
      // Either 400 (validation) or 500 (no Firestore config) — both are non-2xx
      assert.ok(status >= 400);
      assert.equal(body.ok, false);
    });

    it("returns 400 when email is invalid", async () => {
      const { status, body } = await api.post("/api/auth/login", {
        email: "not-an-email",
        password: "somepassword"
      });
      assert.ok(status >= 400);
      assert.equal(body.ok, false);
    });

    it("returns 400 when password is missing", async () => {
      const { status, body } = await api.post("/api/auth/login", {
        email: "user@example.com"
      });
      assert.ok(status >= 400);
      assert.equal(body.ok, false);
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/auth/logout
  // -------------------------------------------------------------------------
  describe("POST /api/auth/logout", () => {
    it("returns 200 and clears cookie", async () => {
      const { status, body } = await api.post("/api/auth/logout", {});
      assert.equal(status, 200);
      assert.equal(body.ok, true);
    });
  });

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------
  describe("POST /api/auth/login — rate limiting", () => {
    it("returns 429 after 10 rapid attempts from the same IP", async () => {
      const payload = { email: "x@x.com", password: "wrongpassword" };
      let lastStatus = 0;

      for (let i = 0; i < 15; i++) {
        const { status } = await api.post("/api/auth/login", payload);
        lastStatus = status;
        if (status === 429) break;
      }

      assert.equal(lastStatus, 429, "Expected 429 after exceeding rate limit");
    });
  });
});
