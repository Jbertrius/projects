/**
 * Integration tests — bot API routes
 * Run with: node --test tests/bot.test.js
 */

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, makeClient } = require("./helpers");

describe("Bot routes", () => {
  let server, api;

  before(async () => {
    server = await startServer();
    api = makeClient(server);
  });

  after(() => server.close());

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------
  describe("Authentication", () => {
    it("returns 401 with no credentials", async () => {
      const { status } = await api.get("/api/bot/members");
      assert.equal(status, 401);
    });

    it("returns 401 with wrong API key", async () => {
      const { status } = await api.get("/api/bot/members", {
        headers: { Authorization: "Bearer wrong-key-value" }
      });
      assert.equal(status, 401);
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/bot/lessons — validation (no key set in test env, expect 401)
  // -------------------------------------------------------------------------
  describe("POST /api/bot/lessons — input validation", () => {
    it("returns 401 with missing API key", async () => {
      const { status } = await api.post("/api/bot/lessons", {
        classCode: "CLS01",
        date: "2026-04-01",
        title: "Lesson 1",
        instructor: "Jean Dupont",
        students: [{ name: "Marie", status: "present" }]
      });
      assert.equal(status, 401);
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/bot/meetings — validation (no key set in test env, expect 401)
  // -------------------------------------------------------------------------
  describe("POST /api/bot/meetings", () => {
    it("returns 401 with missing API key", async () => {
      const { status } = await api.post("/api/bot/meetings", {
        summary: "Rencontre Pasteur Martin",
        date: "2026-04-01"
      });
      assert.equal(status, 401);
    });
  });
});
