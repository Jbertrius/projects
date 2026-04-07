const { hasFirestoreConfig, loadDashboardDataFromFirestore } = require("../../lib/firestore");
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
 * @returns {Promise<object>}
 */
async function getDashboard() {
  const source = await loadSourceData();
  // Local JSON fallback already contains a pre-built dashboard shape
  if (!hasFirestoreConfig() && !hasGoogleSheetsConfig()) {
    return source;
  }
  return buildDashboard(source);
}

module.exports = { loadSourceData, getDashboard };
