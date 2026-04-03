const { loadLocalEnv } = require("../lib/env");
const { loadAcademyDataFromFirestore } = require("../lib/firestore");

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function take(items, max = 10) {
  return items.slice(0, max);
}

async function main() {
  loadLocalEnv();
  const data = await loadAcademyDataFromFirestore();

  const classes = Array.isArray(data.classes) ? data.classes : [];
  const students = Array.isArray(data.students) ? data.students : [];
  const attendance = Array.isArray(data.attendance) ? data.attendance : [];
  const unregistered = Array.isArray(data.unregistered) ? data.unregistered : [];

  const classesByKey = new Map();
  for (const academyClass of classes) {
    const key = normalizeKey(academyClass.name || academyClass.class_code || academyClass.id);
    if (!classesByKey.has(key)) {
      classesByKey.set(key, []);
    }
    classesByKey.get(key).push(academyClass);
  }

  const duplicateClassGroups = [...classesByKey.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key, items]) => ({
      key,
      ids: items.map((item) => item.id),
      names: [...new Set(items.map((item) => item.name).filter(Boolean))]
    }));

  const classAliasMap = new Map();
  for (const [, items] of classesByKey.entries()) {
    const canonicalId = String(items[0]?.id || "");
    for (const item of items) {
      classAliasMap.set(String(item.id), canonicalId);
    }
  }

  const studentsByClassAndName = new Map();
  for (const student of students) {
    const mappedClassId = classAliasMap.get(String(student.class_id || student.class_name)) || String(student.class_id || "");
    const key = `${mappedClassId}::${normalizeKey(student.name)}`;
    if (!studentsByClassAndName.has(key)) {
      studentsByClassAndName.set(key, []);
    }
    studentsByClassAndName.get(key).push(student);
  }

  const duplicateStudents = [...studentsByClassAndName.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key, items]) => ({
      key,
      ids: items.map((item) => item.id),
      classIds: [...new Set(items.map((item) => item.class_id).filter(Boolean))],
      names: [...new Set(items.map((item) => item.name).filter(Boolean))]
    }));

  const attendanceByClassStudentLesson = new Map();
  for (const row of attendance) {
    const mappedClassId = classAliasMap.get(String(row.class_id || row.class_name)) || String(row.class_id || "");
    const studentKey = normalizeKey(row.student_name || row.student_id);
    const lessonKey = String(row.lesson_id || `${row.session_date || ""}-${row.lesson_title || ""}`);
    const key = `${mappedClassId}::${studentKey}::${lessonKey}`;
    if (!attendanceByClassStudentLesson.has(key)) {
      attendanceByClassStudentLesson.set(key, []);
    }
    attendanceByClassStudentLesson.get(key).push(row);
  }

  const duplicateAttendance = [...attendanceByClassStudentLesson.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key, items]) => ({
      key,
      ids: items.map((item) => item.id),
      studentIds: [...new Set(items.map((item) => item.student_id).filter(Boolean))],
      lessonIds: [...new Set(items.map((item) => item.lesson_id).filter(Boolean))],
      statuses: [...new Set(items.map((item) => item.status).filter(Boolean))]
    }));

  const unregisteredByClassStudentLesson = new Map();
  for (const row of unregistered) {
    const mappedClassId = classAliasMap.get(String(row.class_id || row.class_name)) || String(row.class_id || "");
    const studentKey = normalizeKey(row.student_name);
    const lessonKey = String(row.lesson_id || `${row.session_date || ""}-${row.lesson_title || ""}`);
    const key = `${mappedClassId}::${studentKey}::${lessonKey}`;
    if (!unregisteredByClassStudentLesson.has(key)) {
      unregisteredByClassStudentLesson.set(key, []);
    }
    unregisteredByClassStudentLesson.get(key).push(row);
  }

  const duplicateUnregistered = [...unregisteredByClassStudentLesson.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key, items]) => ({
      key,
      ids: items.map((item) => item.id),
      lessonIds: [...new Set(items.map((item) => item.lesson_id).filter(Boolean))]
    }));

  const report = {
    counts: {
      classes: classes.length,
      students: students.length,
      attendance: attendance.length,
      unregistered: unregistered.length
    },
    duplicateClassGroupsCount: duplicateClassGroups.length,
    duplicateStudentsCount: duplicateStudents.length,
    duplicateAttendanceRowsSameStudentLessonCount: duplicateAttendance.length,
    duplicateUnregisteredRowsSameStudentLessonCount: duplicateUnregistered.length,
    sampleDuplicateClasses: take(duplicateClassGroups, 12),
    sampleDuplicateStudents: take(duplicateStudents, 12),
    sampleDuplicateAttendance: take(duplicateAttendance, 12),
    sampleDuplicateUnregistered: take(duplicateUnregistered, 12)
  };

  const classIds = new Set(classes.map((item) => String(item.id || "")).filter(Boolean));
  const studentIds = new Set(students.map((item) => String(item.id || "")).filter(Boolean));

  const studentsWithUnknownClass = students.filter((student) => {
    const classId = String(student.class_id || "");
    return classId && !classIds.has(classId);
  });

  const attendanceWithUnknownClass = attendance.filter((row) => {
    const classId = String(row.class_id || "");
    return classId && !classIds.has(classId);
  });

  const attendanceWithUnknownStudent = attendance.filter((row) => {
    const studentId = String(row.student_id || "");
    return studentId && !studentIds.has(studentId);
  });

  report.integrity = {
    studentsWithUnknownClassCount: studentsWithUnknownClass.length,
    attendanceWithUnknownClassCount: attendanceWithUnknownClass.length,
    attendanceWithUnknownStudentCount: attendanceWithUnknownStudent.length,
    sampleStudentsWithUnknownClass: take(
      studentsWithUnknownClass.map((student) => ({ id: student.id, name: student.name, class_id: student.class_id })),
      12
    ),
    sampleAttendanceWithUnknownClass: take(
      attendanceWithUnknownClass.map((row) => ({
        id: row.id,
        student_id: row.student_id,
        student_name: row.student_name,
        class_id: row.class_id,
        lesson_id: row.lesson_id
      })),
      12
    ),
    sampleAttendanceWithUnknownStudent: take(
      attendanceWithUnknownStudent.map((row) => ({
        id: row.id,
        student_id: row.student_id,
        student_name: row.student_name,
        class_id: row.class_id,
        lesson_id: row.lesson_id
      })),
      12
    )
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
