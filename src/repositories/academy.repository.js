const {
  createAcademyLessonRecord,
  deleteAcademyLessonRecord,
  deleteAcademyLessonRecordById,
  hasFirestoreConfig,
  loadAcademyDataFromFirestore,
  replaceAcademyLessonRecord,
  syncAcademySheetToFirestore
} = require("../../lib/firestore");

/**
 * Load all academy data (classes, students, attendance, unregistered).
 * Returns empty arrays when Firestore is not configured.
 * @returns {Promise<{classes, students, attendance, unregistered}>}
 */
async function findAll() {
  if (!hasFirestoreConfig()) {
    return { classes: [], students: [], attendance: [], unregistered: [] };
  }
  return loadAcademyDataFromFirestore();
}

/**
 * Record a new lesson (create, replace, or delete).
 * @param {object} parsed     - Parsed attendance block
 * @param {object} [options]  - { mode: "create"|"replace"|"delete", lessonId, classId }
 */
async function recordLesson(parsed, options = {}) {
  const { mode = "create", lessonId, classId } = options;

  if (mode === "delete-by-id") {
    return deleteAcademyLessonRecordById({ lesson_id: lessonId, class_id: classId, ...parsed });
  }
  if (mode === "delete") {
    return deleteAcademyLessonRecord(parsed);
  }
  if (mode === "replace") {
    return replaceAcademyLessonRecord(parsed, { lessonId, classId });
  }
  return createAcademyLessonRecord(parsed);
}

/**
 * Sync the academy Google Sheet to Firestore.
 */
async function syncFromSheet() {
  return syncAcademySheetToFirestore();
}

module.exports = { findAll, recordLesson, syncFromSheet };
