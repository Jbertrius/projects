/**
 * Integration tests — health check and static routing
 * Run with: node --test tests/health.test.js
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, makeClient } = require("./helpers");

describe("Health & routing", () => {
  let server, api;

  before(async () => {
    server = await startServer();
    api = makeClient(server);
  });

  after(() => server.close());

  it("GET /health returns 200 with ok:true", async () => {
    const { status, body } = await api.get("/health");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(typeof body.uptime === "number");
  });

  it("GET /api/unknown returns 404", async () => {
    const { status } = await api.get("/api/this-does-not-exist");
    assert.equal(status, 404);
  });

  it("GET /api/dashboard returns 401 without auth", async () => {
    const { status, body } = await api.get("/api/dashboard");
    assert.equal(status, 401);
    assert.equal(body.ok, false);
  });

  it("GET /api/academy returns 401 without auth", async () => {
    const { status } = await api.get("/api/academy");
    assert.equal(status, 401);
  });

  it("GET /api/pastors returns 401 without auth", async () => {
    const { status } = await api.get("/api/pastors");
    assert.equal(status, 401);
  });

  it("GET /api/bot/members returns 401 without auth or API key", async () => {
    const { status } = await api.get("/api/bot/members");
    assert.equal(status, 401);
  });

  it("GET / redirects to /login.html without auth", async () => {
    const res = await fetch(`http://localhost:${server.address().port}/`, {
      redirect: "manual"
    });
    assert.equal(res.status, 302);
    assert.ok(res.headers.get("location")?.includes("login.html"));
  });
});
