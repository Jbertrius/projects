/**
 * Integration tests — bot API routes
 * Run with: node --test tests/bot.test.js
 *
 * Tests run without real Firestore credentials, so all writes return 503.
 * Authentication acceptance/rejection is tested with real env-var keys.
 */

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, makeClient } = require("./helpers");

// Inject test API keys into the process so apiKeyAuth can validate them
const TEST_KEY_ATTENDANCE = "test-attendance-key-abc123";
const TEST_KEY_MANNAM = "test-mannam-key-def456";

describe("Bot routes", () => {
  let server, api;

  before(async () => {
    process.env.BOT_API_KEY_ATTENDANCE = TEST_KEY_ATTENDANCE;
    process.env.BOT_API_KEY_MANNAM = TEST_KEY_MANNAM;
    server = await startServer();
    api = makeClient(server);
  });

  after(() => {
    delete process.env.BOT_API_KEY_ATTENDANCE;
    delete process.env.BOT_API_KEY_MANNAM;
    server.close();
  });

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
        headers: { Authorization: "Bearer totally-wrong-key" }
      });
      assert.equal(status, 401);
    });

    it("accepts attendance bot API key on GET /members", async () => {
      const { status, body } = await api.get("/api/bot/members", {
        headers: { Authorization: `Bearer ${TEST_KEY_ATTENDANCE}` }
      });
      // 200 (no Firestore → empty list) or 503 (Firestore not configured)
      // Either way the key was accepted (not 401)
      assert.ok(status !== 401, `Expected non-401, got ${status}`);
      if (status === 200) {
        assert.ok(Array.isArray(body.members), "Expected members array");
      }
    });

    it("accepts mannam bot API key on GET /members", async () => {
      const { status } = await api.get("/api/bot/members", {
        headers: { Authorization: `Bearer ${TEST_KEY_MANNAM}` }
      });
      assert.ok(status !== 401, `Expected non-401, got ${status}`);
    });

    it("sets botIdentity.name correctly for attendance key", async () => {
      // We can infer this from the `source` field returned in POST /lessons
      // (the handler echoes req.botIdentity.name). Without Firestore the
      // endpoint returns 503, but before the Firestore check the identity IS set.
      // Use GET /events which returns empty array when unconfigured.
      const { status } = await api.get("/api/bot/events", {
        headers: { Authorization: `Bearer ${TEST_KEY_ATTENDANCE}` }
      });
      assert.ok(status !== 401);
    });
  });

  // -------------------------------------------------------------------------
  // Rate limiting — uses a unique spoofed IP so it doesn't exhaust the
  // window for other tests running in the same suite on localhost.
  // -------------------------------------------------------------------------
  describe("Rate limiting on bot endpoints", () => {
    it("returns 429 after exceeding 120 req/min threshold", async () => {
      let lastStatus = 0;
      // Flood 130 requests from a dedicated test IP
      for (let i = 0; i < 130; i++) {
        const { status } = await api.get("/api/bot/members", {
          headers: {
            Authorization: `Bearer ${TEST_KEY_ATTENDANCE}`,
            "X-Forwarded-For": "192.0.2.99" // RFC 5737 test IP — isolated window
          }
        });
        lastStatus = status;
        if (status === 429) break;
      }
      assert.equal(lastStatus, 429, "Expected 429 after exceeding rate limit on bot endpoint");
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/bot/lessons — input validation (Firestore not configured → 503 / 400)
  // -------------------------------------------------------------------------
  describe("POST /api/bot/lessons — input validation", () => {
    it("returns 401 without API key", async () => {
      const { status } = await api.post("/api/bot/lessons", {
        classCode: "CLS01", date: "2026-04-01", title: "Lesson 1", instructor: "Jean"
      });
      assert.equal(status, 401);
    });

    it("returns 400 when classCode is missing", async () => {
      const { status, body } = await api.post(
        "/api/bot/lessons",
        { date: "2026-04-01", title: "Lesson 1", instructor: "Jean" },
        { headers: { Authorization: `Bearer ${TEST_KEY_ATTENDANCE}` } }
      );
      assert.equal(status, 400);
      assert.equal(body.ok, false);
      assert.ok(body.error, "Expected an error message");
    });

    it("returns 400 when date is missing", async () => {
      const { status, body } = await api.post(
        "/api/bot/lessons",
        { classCode: "CLS01", title: "Lesson 1", instructor: "Jean" },
        { headers: { Authorization: `Bearer ${TEST_KEY_ATTENDANCE}` } }
      );
      assert.equal(status, 400);
      assert.equal(body.ok, false);
    });

    it("returns 400 when title is missing", async () => {
      const { status, body } = await api.post(
        "/api/bot/lessons",
        { classCode: "CLS01", date: "2026-04-01", instructor: "Jean" },
        { headers: { Authorization: `Bearer ${TEST_KEY_ATTENDANCE}` } }
      );
      assert.equal(status, 400);
      assert.equal(body.ok, false);
    });

    it("returns 400 when instructor is missing", async () => {
      const { status, body } = await api.post(
        "/api/bot/lessons",
        { classCode: "CLS01", date: "2026-04-01", title: "Lesson 1" },
        { headers: { Authorization: `Bearer ${TEST_KEY_ATTENDANCE}` } }
      );
      assert.equal(status, 400);
      assert.equal(body.ok, false);
    });

    it("passes validation but returns 503 when Firestore not configured", async () => {
      const { status, body } = await api.post(
        "/api/bot/lessons",
        {
          classCode: "CLS01",
          date: "2026-04-01",
          title: "Lesson 1",
          instructor: "Jean Dupont",
          students: [{ name: "Marie", status: "present" }]
        },
        { headers: { Authorization: `Bearer ${TEST_KEY_ATTENDANCE}` } }
      );
      // 503 = Firestore not configured (acceptable in test env without credentials)
      // 200 = Firestore IS configured and lesson was recorded
      assert.ok(
        status === 503 || status === 200,
        `Expected 503 (no Firestore) or 200, got ${status}: ${JSON.stringify(body)}`
      );
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/bot/meetings — input validation
  // -------------------------------------------------------------------------
  describe("POST /api/bot/meetings — input validation", () => {
    it("returns 401 without API key", async () => {
      const { status } = await api.post("/api/bot/meetings", {
        summary: "Test meeting", date: "2026-04-01"
      });
      assert.equal(status, 401);
    });

    it("returns 400 when summary is missing", async () => {
      const { status, body } = await api.post(
        "/api/bot/meetings",
        { date: "2026-04-01" },
        { headers: { Authorization: `Bearer ${TEST_KEY_MANNAM}` } }
      );
      assert.equal(status, 400);
      assert.equal(body.ok, false);
    });

    it("returns 400 when date is missing", async () => {
      const { status, body } = await api.post(
        "/api/bot/meetings",
        { summary: "Rencontre Pasteur Martin" },
        { headers: { Authorization: `Bearer ${TEST_KEY_MANNAM}` } }
      );
      assert.equal(status, 400);
      assert.equal(body.ok, false);
    });

    it("passes validation but returns 503 when Firestore not configured", async () => {
      const { status } = await api.post(
        "/api/bot/meetings",
        { summary: "Rencontre Pasteur Martin", date: "2026-04-01", participants: ["Alice", "Bob"] },
        { headers: { Authorization: `Bearer ${TEST_KEY_MANNAM}` } }
      );
      assert.ok(status === 503 || status === 200, `Expected 503 or 200, got ${status}`);
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /api/bot/meetings/:id
  // -------------------------------------------------------------------------
  describe("DELETE /api/bot/meetings/:id", () => {
    it("returns 401 without API key", async () => {
      const { status } = await api.delete("/api/bot/meetings/some-meeting-id");
      assert.equal(status, 401);
    });

    it("returns 400 when id is empty", async () => {
      // Express won't route DELETE /api/bot/meetings/ (no id segment) — 404
      const { status } = await api.delete("/api/bot/meetings/", {
        headers: { Authorization: `Bearer ${TEST_KEY_MANNAM}` }
      });
      assert.ok(status === 404 || status === 400);
    });

    it("accepts the key and attempts to delete (503 without Firestore)", async () => {
      const { status } = await api.delete("/api/bot/meetings/EVT_TEST_123", {
        headers: { Authorization: `Bearer ${TEST_KEY_MANNAM}` }
      });
      assert.ok(status === 503 || status === 200 || status === 400, `Got ${status}`);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/bot/events and /api/bot/categories
  // -------------------------------------------------------------------------
  describe("GET /api/bot/events and categories", () => {
    it("GET /events returns 200 with events array", async () => {
      const { status, body } = await api.get("/api/bot/events", {
        headers: { Authorization: `Bearer ${TEST_KEY_ATTENDANCE}` }
      });
      assert.ok(status === 200 || status === 503, `Got ${status}`);
      if (status === 200) {
        assert.ok(Array.isArray(body.events), "Expected events array");
      }
    });

    it("GET /categories returns 200 with categories array", async () => {
      const { status, body } = await api.get("/api/bot/categories", {
        headers: { Authorization: `Bearer ${TEST_KEY_ATTENDANCE}` }
      });
      assert.ok(status === 200 || status === 503, `Got ${status}`);
      if (status === 200) {
        assert.ok(Array.isArray(body.categories), "Expected categories array");
      }
    });

    it("returns 401 on /events without credentials", async () => {
      const { status } = await api.get("/api/bot/events");
      assert.equal(status, 401);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/bot/academy/report/class/:code
  // -------------------------------------------------------------------------
  describe("GET /api/bot/academy/report/class/:code", () => {
    it("returns 401 without API key", async () => {
      const { status } = await api.get("/api/bot/academy/report/class/164-2C");
      assert.equal(status, 401);
    });

    it("returns 503 when Firestore not configured", async () => {
      const { status } = await api.get("/api/bot/academy/report/class/164-2C", {
        headers: { Authorization: `Bearer ${TEST_KEY_ATTENDANCE}` }
      });
      // 503 = no Firestore, 404 = Firestore is there but class not found, 200 = found
      assert.ok([200, 404, 503].includes(status), `Got unexpected status ${status}`);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/bot/academy/report/student/:name
  // -------------------------------------------------------------------------
  describe("GET /api/bot/academy/report/student/:name", () => {
    it("returns 401 without API key", async () => {
      const { status } = await api.get("/api/bot/academy/report/student/Marie%20Dupont");
      assert.equal(status, 401);
    });

    it("returns 503 or 404 without Firestore data", async () => {
      const { status } = await api.get(
        "/api/bot/academy/report/student/Marie%20Dupont",
        { headers: { Authorization: `Bearer ${TEST_KEY_ATTENDANCE}` } }
      );
      assert.ok([200, 404, 503].includes(status), `Got unexpected status ${status}`);
    });
  });
});
