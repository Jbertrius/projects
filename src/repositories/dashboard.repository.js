const { hasFirestoreConfig, loadDashboardDataFromFirestore, readDashboardAggregate } = require("../../lib/firestore");
const { hasGoogleSheetsConfig, loadGoogleSheetsData } = require("../../lib/sheets");
const { buildDashboard } = require("../../lib/dashboard");
const fs = require("fs");
const path = require("path");

const LOCAL_DATA_FILE = path.join(__dirname, "..", "..", "data", "dashboard.json");

/**
 * Load raw source data (members + meetings + training) from best available source.
 * @returns {Promise<object>} Raw source object passed to buildDashboard()
 */
async function loadSourceData() {
  if (hasFirestoreConfig()) {
    return loadDashboardDataFromFirestore();
  }
  if (hasGoogleSheetsConfig()) {
    return loadGoogleSheetsData();
  }
  return JSON.parse(fs.readFileSync(LOCAL_DATA_FILE, "utf8"));
}

/**
 * Return the built dashboard payload, ready to send to the frontend.
 *
 * Fast path: reads the pre-computed `aggregates/dashboard` document (1 read).
 * Slow path: falls back to full collection scan when the aggregate is absent.
 * @returns {Promise<object>}
 */
async function getDashboard() {
  // Attempt to read pre-computed aggregate (1 Firestore read)
  if (hasFirestoreConfig()) {
    const agg = await readDashboardAggregate();
    if (agg) {
      return {
        ok: true,
        _source: "aggregate",
        totalMembers: agg.totalMembers,
        totalMeetings: agg.totalMeetings,
        totalLessons: agg.totalLessons,
        lastUpdated: agg.lastUpdated
      };
    }
  }

  // Fallback: full scan (first load or aggregate not yet written)
  const source = await loadSourceData();
  if (!hasFirestoreConfig() && !hasGoogleSheetsConfig()) {
    return source;
  }
  return buildDashboard(source);
}

module.exports = { loadSourceData, getDashboard };
