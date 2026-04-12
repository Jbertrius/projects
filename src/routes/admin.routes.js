const { Router } = require("express");
const { requireAdmin } = require("../middleware/auth");
const {
  buildFirestoreDocuments,
  getFirestoreConfigSummary,
  hasFirestoreConfig,
  testFirestoreConnection,
  listPersonalityLinkSuggestions,
  resolvePersonalityLinkSuggestion
} = require("../../lib/firestore");
const { linkPastorsToStudentsJob } = require("../jobs/link-pastors-to-students");
const { AppError } = require("../middleware/errorHandler");
const { appCache } = require("../utils/cache");
const {
  getGoogleSheetsConfigSummary,
  hasGoogleSheetsConfig,
  loadGoogleSheetsData
} = require("../../lib/sheets");
const { listAccessibleCalendars, listCalendarEvents } = require("../../lib/calendar");

const router = Router();

router.get("/connection-status", requireAdmin, (req, res) => {
  res.json({
    googleSheetsConfigured: hasGoogleSheetsConfig(),
    firestoreConfigured: hasFirestoreConfig(),
    config: {
      sheets: getGoogleSheetsConfigSummary(),
      firestore: getFirestoreConfigSummary()
    }
  });
});

router.get("/test/google-sheets", requireAdmin, async (req, res, next) => {
  try {
    if (!hasGoogleSheetsConfig()) {
      return res.status(400).json({
        ok: false,
        error: "Google Sheets is not configured.",
        config: getGoogleSheetsConfigSummary()
      });
    }
    const sheetsData = await loadGoogleSheetsData();
    res.json({
      ok: true,
      config: getGoogleSheetsConfigSummary(),
      counts: {
        members: sheetsData.members.length,
        meetings: sheetsData.meetings.length,
        trainingSessions: sheetsData.trainingSessions.length
      },
      sample: {
        member: sheetsData.members[0] || null,
        meeting: sheetsData.meetings[0] || null,
        trainingSession: sheetsData.trainingSessions[0] || null
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message, config: getGoogleSheetsConfigSummary() });
  }
});

router.get("/test/google-calendar", requireAdmin, async (req, res, next) => {
  try {
    const payload = await listCalendarEvents();
    res.json({ ok: true, calendarId: payload.calendarId, count: payload.items.length, sample: payload.items[0] || null });
  } catch (error) {
    next(error);
  }
});

router.get("/test/google-calendar-list", requireAdmin, async (req, res, next) => {
  try {
    const calendars = await listAccessibleCalendars();
    res.json({ ok: true, calendars });
  } catch (error) {
    next(error);
  }
});

router.get("/test/firestore", requireAdmin, async (req, res, next) => {
  try {
    if (!hasFirestoreConfig()) {
      return res.status(400).json({ ok: false, error: "Firestore is not configured.", config: getFirestoreConfigSummary() });
    }
    const result = await testFirestoreConnection();
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message, config: getFirestoreConfigSummary() });
  }
});

router.get("/preview/firestore", requireAdmin, async (req, res, next) => {
  try {
    const sheetsData = await loadGoogleSheetsData();
    const preview = await buildFirestoreDocuments(sheetsData);
    res.json({
      ok: true,
      config: getFirestoreConfigSummary(),
      counts: {
        members: preview.members.length,
        meetings: preview.meetings.length,
        trainingSessions: preview.trainingSessions.length
      },
      sample: {
        member: preview.members[0] || null,
        meeting: preview.meetings[0] || null,
        trainingSession: preview.trainingSessions[0] || null
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message, config: getFirestoreConfigSummary() });
  }
});

// ---------------------------------------------------------------------------
// Personality link suggestions — pastor ↔ academy student
// ---------------------------------------------------------------------------

router.get("/personality-links", requireAdmin, async (req, res, next) => {
  try {
    if (!hasFirestoreConfig()) throw new AppError(503, "Firestore n'est pas configure.");
    const status = req.query.status || null; // "pending" | "approved" | "rejected" | null = all
    const suggestions = await listPersonalityLinkSuggestions(status);
    res.json({ ok: true, suggestions });
  } catch (error) {
    next(error);
  }
});

router.post("/personality-links/run-job", requireAdmin, async (req, res, next) => {
  try {
    if (!hasFirestoreConfig()) throw new AppError(503, "Firestore n'est pas configure.");
    const result = await linkPastorsToStudentsJob();
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

router.post("/personality-links/:id/approve", requireAdmin, async (req, res, next) => {
  try {
    if (!hasFirestoreConfig()) throw new AppError(503, "Firestore n'est pas configure.");
    const result = await resolvePersonalityLinkSuggestion(
      req.params.id,
      "approved",
      req.sessionUser?.email || ""
    );
    appCache.invalidate("academy");
    res.json({ ok: true, ...result });
  } catch (error) {
    if (!error.status) error.status = 400;
    next(error);
  }
});

router.post("/personality-links/:id/reject", requireAdmin, async (req, res, next) => {
  try {
    if (!hasFirestoreConfig()) throw new AppError(503, "Firestore n'est pas configure.");
    const result = await resolvePersonalityLinkSuggestion(
      req.params.id,
      "rejected",
      req.sessionUser?.email || ""
    );
    res.json({ ok: true, ...result });
  } catch (error) {
    if (!error.status) error.status = 400;
    next(error);
  }
});

module.exports = router;
