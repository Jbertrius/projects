const { hasFirestoreConfig, loadDashboardDataFromFirestore } = require("../../lib/firestore");
const { buildDashboard } = require("../../lib/dashboard");
const fs = require("fs");
const path = require("path");

const LOCAL_DATA_FILE = path.join(__dirname, "..", "..", "data", "dashboard.json");

/**
 * Load raw source data (members + meetings + training) from Firestore or local fallback.
 * @returns {Promise<object>}
 */
async function loadSourceData() {
  if (hasFirestoreConfig()) {
    return loadDashboardDataFromFirestore();
  }
  return JSON.parse(fs.readFileSync(LOCAL_DATA_FILE, "utf8"));
}

/**
 * Return the built dashboard payload, ready to send to the frontend.
 * @returns {Promise<object>}
 */
async function getDashboard() {
  const source = await loadSourceData();
  if (!hasFirestoreConfig()) {
    return source;
  }
  return buildDashboard(source);
}

module.exports = { loadSourceData, getDashboard };
