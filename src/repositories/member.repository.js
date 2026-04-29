const { listMemberDocuments, hasFirestoreConfig } = require("../../lib/firestore");

/**
 * Return all members from Firestore.
 * @returns {Promise<Array>}
 */
async function findAll() {
  if (!hasFirestoreConfig()) return [];
  return listMemberDocuments();
}

module.exports = { findAll };
