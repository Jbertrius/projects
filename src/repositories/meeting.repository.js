const {
  hasFirestoreConfig,
  loadDashboardDataFromFirestore
} = require("../../lib/firestore");
const { hasGoogleSheetsConfig, loadGoogleSheetsData } = require("../../lib/sheets");

/**
 * Return all meetings from whichever source is configured.
 * @returns {Promise<Array>}
 */
async function findAll() {
  if (hasFirestoreConfig()) {
    const data = await loadDashboardDataFromFirestore();
    return data.meetings || [];
  }
  if (hasGoogleSheetsConfig()) {
    const data = await loadGoogleSheetsData();
    return data.meetings || [];
  }
  return [];
}

module.exports = { findAll };
