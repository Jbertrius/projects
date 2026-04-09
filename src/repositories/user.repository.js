/**
 * Thin re-export so routes import from repositories, not directly from lib/auth.
 * Keeps the source of Firestore user operations in one place.
 */
const {
  authenticateUser,
  createUser,
  deleteUser,
  listUsers,
  syncMembersToUsers,
  updateUser
} = require("../../lib/auth");

module.exports = {
  authenticate: authenticateUser,
  create: createUser,
  remove: deleteUser,
  findAll: listUsers,
  syncFromMembers: syncMembersToUsers,
  update: updateUser
};
