const {
  loadDashboardDataFromFirestore
} = require("../../lib/firestore");
const { loadGoogleSheetsData } = require("../../lib/sheets");
const { hasFirestoreConfig } = require("../../lib/firestore");
const { hasGoogleSheetsConfig } = require("../../lib/sheets");

/**
 * Return all members from whichever source is configured.
 * @returns {Promise<Array>}
 */
async function findAll() {
  if (hasFirestoreConfig()) {
    const data = await loadDashboardDataFromFirestore();
    return data.members || [];
  }
  if (hasGoogleSheetsConfig()) {
    const data = await loadGoogleSheetsData();
    return data.members || [];
  }
  return [];
}

module.exports = { findAll };
