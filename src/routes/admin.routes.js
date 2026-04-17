const { Router } = require("express");
const { requireAdmin } = require("../middleware/auth");
const {
  getFirestoreConfigSummary,
  hasFirestoreConfig,
  testFirestoreConnection,
  listPersonalityLinkSuggestions,
  resolvePersonalityLinkSuggestion
} = require("../../lib/firestore");
const { linkPastorsToStudentsJob } = require("../jobs/link-pastors-to-students");
const { AppError } = require("../middleware/errorHandler");
const { appCache } = require("../utils/cache");
const { listAccessibleCalendars, listCalendarEvents } = require("../../lib/calendar");

const router = Router();

router.get("/connection-status", requireAdmin, (req, res) => {
  res.json({
    firestoreConfigured: hasFirestoreConfig(),
    config: {
      firestore: getFirestoreConfigSummary()
    }
  });
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

// ---------------------------------------------------------------------------
// Personality link suggestions — pastor ↔ academy student
// ---------------------------------------------------------------------------

router.get("/personality-links", requireAdmin, async (req, res, next) => {
  try {
    if (!hasFirestoreConfig()) throw new AppError(503, "Firestore n'est pas configure.");
    const status = req.query.status || null;
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
