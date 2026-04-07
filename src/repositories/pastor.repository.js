const {
  hasFirestoreConfig,
  loadPastorsFromFirestore,
  updatePastorInFirestore
} = require("../../lib/firestore");
const { loadPastorsSheet, updatePastorRecord } = require("../../lib/pastors");

/**
 * Return all pastors, sorted by meeting count desc.
 * @returns {Promise<Array>}
 */
async function findAll() {
  if (hasFirestoreConfig()) {
    return loadPastorsFromFirestore();
  }
  return loadPastorsSheet();
}

/**
 * Persist a pastor update.
 * @param {object} input - Pastor fields (must include id)
 * @returns {Promise<object>}
 */
async function update(input) {
  if (hasFirestoreConfig()) {
    return updatePastorInFirestore(input);
  }
  return updatePastorRecord(input);
}

module.exports = { findAll, update };
