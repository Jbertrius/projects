const { loadDashboardDataFromFirestore, hasFirestoreConfig } = require("../../lib/firestore");

/**
 * Return all members from Firestore.
 * @returns {Promise<Array>}
 */
async function findAll() {
  if (!hasFirestoreConfig()) return [];
  const data = await loadDashboardDataFromFirestore();
  return data.members || [];
}

module.exports = { findAll };
