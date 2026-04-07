const { Router } = require("express");
const { requireAuth } = require("../middleware/auth");
const dashboardRepo = require("../repositories/dashboard.repository");
const { appCache } = require("../utils/cache");

const router = Router();

const DASHBOARD_TTL_MS = 5 * 60 * 1000; // 5 minutes

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const data = await appCache.get("dashboard", DASHBOARD_TTL_MS, () =>
      dashboardRepo.getDashboard()
    );
    res.json(data);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
