const { Router } = require("express");
const { requireAuth } = require("../middleware/auth");
const { buildDashboard } = require("../../lib/dashboard");
const { hasFirestoreConfig, loadDashboardDataFromFirestore } = require("../../lib/firestore");
const { hasGoogleSheetsConfig, loadGoogleSheetsData } = require("../../lib/sheets");
const fs = require("fs");
const path = require("path");

const router = Router();

const DATA_FILE = path.join(__dirname, "..", "..", "data", "dashboard.json");

router.get("/", requireAuth, async (req, res, next) => {
  try {
    if (hasFirestoreConfig()) {
      return res.json(buildDashboard(await loadDashboardDataFromFirestore()));
    }

    if (hasGoogleSheetsConfig()) {
      return res.json(buildDashboard(await loadGoogleSheetsData()));
    }

    res.json(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
