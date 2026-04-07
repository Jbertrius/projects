/**
 * attendance.repository.js
 *
 * Persistence layer for attendance events (attendanceEvents, attendanceCategories,
 * attendanceParticipants Firestore collections).
 *
 * These collections are owned by the attendance Telegram bot and track presence
 * at church events (different from academy classes).
 */

const {
  hasFirestoreConfig,
  listAttendanceEvents,
  listAttendanceCategories,
  listEventAttendance,
  addAttendanceParticipants,
  removeAttendanceParticipant
} = require("../../lib/firestore");

/**
 * Return all attendance events sorted by date ascending.
 * @returns {Promise<Array<{event_id, event_name, date, description}>>}
 */
async function findAllEvents() {
  if (!hasFirestoreConfig()) return [];
  return listAttendanceEvents();
}

/**
 * Return all attendance categories.
 * Falls back to a hard-coded list when the collection is empty.
 * @returns {Promise<Array<{category_id, category_name}>>}
 */
async function findAllCategories() {
  if (!hasFirestoreConfig()) {
    return ["Staff", "Guest", "Member", "Pastor"].map((n) => ({
      category_id: n.toLowerCase(),
      category_name: n
    }));
  }
  return listAttendanceCategories();
}

/**
 * Return all participants recorded for a given event, sorted by name.
 * @param {string} eventName
 * @returns {Promise<Array<{event_name, participant_name, category, timestamp}>>}
 */
async function findAttendanceForEvent(eventName) {
  if (!hasFirestoreConfig()) return [];
  return listEventAttendance(eventName);
}

/**
 * Add participants to an event (skips duplicates).
 * @param {string} eventName
 * @param {string[]} participants
 * @param {string} category
 * @returns {Promise<string[]>} Names that were actually added.
 */
async function addParticipants(eventName, participants, category) {
  if (!hasFirestoreConfig()) return [];
  return addAttendanceParticipants(eventName, participants, category);
}

/**
 * Remove a single participant from an event.
 * @param {string} eventName
 * @param {string} participantName
 * @returns {Promise<boolean>} true if the document was deleted.
 */
async function removeParticipant(eventName, participantName) {
  if (!hasFirestoreConfig()) return false;
  return removeAttendanceParticipant(eventName, participantName);
}

module.exports = {
  findAllEvents,
  findAllCategories,
  findAttendanceForEvent,
  addParticipants,
  removeParticipant
};
