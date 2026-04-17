const {
  hasFirestoreConfig,
  loadPastorsFromFirestore,
  updatePastorInFirestore
} = require("../../lib/firestore");

/**
 * Return all pastors, sorted by meeting count desc.
 * @returns {Promise<Array>}
 */
async function findAll() {
  if (!hasFirestoreConfig()) return [];
  return loadPastorsFromFirestore();
}

/**
 * Persist a pastor update.
 * @param {object} input - Pastor fields (must include id)
 * @returns {Promise<object>}
 */
async function update(input) {
  if (!hasFirestoreConfig()) {
    throw new Error("Firestore n'est pas configure.");
  }
  return updatePastorInFirestore(input);
}

module.exports = { findAll, update };
