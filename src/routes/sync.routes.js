const { Router } = require("express");
const { requireContentManager } = require("../middleware/auth");
const {
  getFirestoreConfigSummary,
  hasFirestoreConfig,
  syncAcademySheetToFirestore,
  syncSheetsToFirestore
} = require("../../lib/firestore");
const { syncCalendarToMeetingsSheet } = require("../../lib/calendar");

const router = Router();

router.post("/calendar-to-sheets", requireContentManager, async (req, res, next) => {
  try {
    const result = await syncCalendarToMeetingsSheet();
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

router.get("/full", requireContentManager, async (req, res, next) => {
  let calendarResult = null;
  try {
    calendarResult = await syncCalendarToMeetingsSheet();
    const firestoreResult = await syncSheetsToFirestore();
    res.json({
      ok: true,
      steps: { calendarToSheets: calendarResult, sheetsToFirestore: firestoreResult }
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
      steps: { calendarToSheets: calendarResult }
    });
  }
});

router.post("/firestore", requireContentManager, async (req, res, next) => {
  try {
    const result = await syncSheetsToFirestore();
    res.json({ ok: true, config: getFirestoreConfigSummary(), ...result });
  } catch (error) {
    next(error);
  }
});

router.post("/academy-sheet", requireContentManager, async (req, res, next) => {
  try {
    const result = await syncAcademySheetToFirestore();
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
