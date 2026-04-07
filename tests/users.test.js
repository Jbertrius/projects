/**
 * Integration tests — users route input validation
 * Run with: node --test tests/users.test.js
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, makeClient } = require("./helpers");

describe("Users route — input validation", () => {
  let server, api;

  before(async () => {
    server = await startServer();
    api = makeClient(server);
  });

  after(() => server.close());

  it("POST /api/users returns 401 without auth", async () => {
    const { status } = await api.post("/api/users", {
      email: "new@example.com",
      display_name: "Test",
      password: "password123"
    });
    assert.equal(status, 401);
  });

  it("PATCH /api/users/:id returns 401 without auth", async () => {
    const { status } = await api.patch("/api/users/some-id", { display_name: "New Name" });
    assert.equal(status, 401);
  });

  it("DELETE /api/users/:id returns 401 without auth", async () => {
    const { status } = await api.delete("/api/users/some-id");
    assert.equal(status, 401);
  });

  it("GET /api/users returns 401 without auth", async () => {
    const { status } = await api.get("/api/users");
    assert.equal(status, 401);
  });
});
