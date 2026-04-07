const {
  createAcademyLessonRecord,
  deleteAcademyLessonRecord,
  deleteAcademyLessonRecordById,
  hasFirestoreConfig,
  loadAcademyDataFromFirestore,
  replaceAcademyLessonRecord,
  syncAcademySheetToFirestore,
  getAcademyClassByCode,
  listAcademyLessonsForClass,
  listAcademyStudentsForClass,
  listAcademyAttendanceForClass,
  listAcademyAttendanceForStudent
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

/**
 * Build a full class attendance report for a given class code or instructor name.
 *
 * @param {string} code  Class code (e.g. "164-2C") or instructor name fragment.
 * @returns {Promise<{cls, lessons, students, att_lookup}|null>}
 *   null when the class is not found.
 */
async function getClassReport(code) {
  if (!hasFirestoreConfig()) return null;

  const cls = await getAcademyClassByCode(code);
  if (!cls) return null;

  const [lessons, students, attendanceRows] = await Promise.all([
    listAcademyLessonsForClass(cls.id),
    listAcademyStudentsForClass(cls.id),
    listAcademyAttendanceForClass(cls.id)
  ]);

  // att_lookup: { [lessonId_studentNameLower]: status }
  const att_lookup = {};
  for (const row of attendanceRows) {
    const key = `${row.lesson_id}__${row.student_name.toLowerCase()}`;
    att_lookup[key] = row.status;
  }

  return { cls, lessons, students, att_lookup };
}

/**
 * Build per-lesson attendance history for a single student.
 *
 * @param {string} studentName
 * @returns {Promise<Array<{lesson_title, lesson_date, class_code, teacher_name, status}>>}
 */
async function getStudentReport(studentName) {
  if (!hasFirestoreConfig()) return [];

  const rows = await listAcademyAttendanceForStudent(studentName);

  // Enrich with class info where available (class_name is stored on the attendance doc)
  return rows.map((r) => ({
    lesson_title: r.lesson_title || "",
    lesson_date: r.session_date || "",
    class_code: r.class_name || r.class_id || "",
    status: r.status || ""
  }));
}

/**
 * Return absent students grouped by lesson for a given class code.
 *
 * @param {string} code           Class code or instructor name fragment.
 * @param {string} [lessonFilter] Optional string that must appear in the lesson title.
 * @returns {Promise<{cls, lessons, att_by_lesson}|null>}
 *   null when the class is not found.
 */
async function getAbsentees(code, lessonFilter = "") {
  if (!hasFirestoreConfig()) return null;

  const cls = await getAcademyClassByCode(code);
  if (!cls) return null;

  let [lessons, attendanceRows] = await Promise.all([
    listAcademyLessonsForClass(cls.id),
    listAcademyAttendanceForClass(cls.id)
  ]);

  if (lessonFilter) {
    const f = lessonFilter.toLowerCase();
    lessons = lessons.filter((l) => l.lesson_title.toLowerCase().includes(f));
  }

  // att_by_lesson: { [lessonId]: [absentStudentName, ...] }
  const att_by_lesson = {};
  for (const row of attendanceRows) {
    if (row.status === "absent") {
      (att_by_lesson[row.lesson_id] = att_by_lesson[row.lesson_id] || []).push(row.student_name);
    }
  }

  return { cls, lessons, att_by_lesson };
}

module.exports = {
  findAll,
  recordLesson,
  syncFromSheet,
  getClassReport,
  getStudentReport,
  getAbsentees
};
