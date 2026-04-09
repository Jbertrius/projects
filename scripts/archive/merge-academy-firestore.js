const { loadLocalEnv } = require("../lib/env");
const { fetchJson, getAccessToken, getEnv } = require("../lib/google-auth");

const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    apply: args.has("--apply"),
    verbose: args.has("--verbose")
  };
}

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getFirestoreBaseUrl() {
  const projectId = getEnv("FIRESTORE_PROJECT_ID");
  const databaseId = getEnv("FIRESTORE_DATABASE_ID", "(default)");
  if (!projectId) {
    throw new Error("Missing FIRESTORE_PROJECT_ID.");
  }
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents`;
}

function strValue(value) {
  return { stringValue: String(value ?? "") };
}

function boolValue(value) {
  return { booleanValue: Boolean(value) };
}

function arrayStringValue(values) {
  return {
    arrayValue: {
      values: (values || []).filter(Boolean).map((item) => strValue(item))
    }
  };
}

function firestoreValueToJs(value) {
  if (!value || typeof value !== "object") {
    return "";
  }
  if ("stringValue" in value) {
    return value.stringValue;
  }
  if ("booleanValue" in value) {
    return value.booleanValue;
  }
  if ("integerValue" in value) {
    return value.integerValue;
  }
  if ("doubleValue" in value) {
    return value.doubleValue;
  }
  if ("arrayValue" in value) {
    return (value.arrayValue.values || []).map(firestoreValueToJs);
  }
  return "";
}

function parseDoc(doc) {
  const name = String(doc.name || "");
  const id = decodeURIComponent(name.split("/").pop() || "");
  return { id, fields: doc.fields || {} };
}

function firstNonEmpty(values) {
  return values.find((item) => String(item || "").trim()) || "";
}

function chooseCanonicalClassId(items) {
  const sorted = [...items].sort((a, b) => {
    const aLegacy = /^CLS\d+$/i.test(String(a.id));
    const bLegacy = /^CLS\d+$/i.test(String(b.id));
    if (aLegacy !== bLegacy) {
      return aLegacy ? -1 : 1;
    }
    const lenDelta = String(a.id).length - String(b.id).length;
    if (lenDelta !== 0) {
      return lenDelta;
    }
    return String(a.id).localeCompare(String(b.id), "en");
  });

  return sorted[0]?.id || "";
}

function chooseCanonicalStudentId(items, attendanceRefCountByStudentId) {
  const sorted = [...items].sort((a, b) => {
    const aRefs = attendanceRefCountByStudentId.get(String(a.id)) || 0;
    const bRefs = attendanceRefCountByStudentId.get(String(b.id)) || 0;
    if (aRefs !== bRefs) {
      return bRefs - aRefs;
    }

    const aLegacy = /^STU\d+$/i.test(String(a.id));
    const bLegacy = /^STU\d+$/i.test(String(b.id));
    if (aLegacy !== bLegacy) {
      return aLegacy ? -1 : 1;
    }

    const lenDelta = String(a.id).length - String(b.id).length;
    if (lenDelta !== 0) {
      return lenDelta;
    }

    return String(a.id).localeCompare(String(b.id), "en");
  });

  return sorted[0]?.id || "";
}

async function listCollectionDocuments(baseUrl, collection, accessToken, pageSize = 500) {
  const docs = [];
  let pageToken = "";

  do {
    const query = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageToken) {
      query.set("pageToken", pageToken);
    }

    const url = `${baseUrl}/${collection}?${query.toString()}`;
    const payload = await fetchJson(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    docs.push(...(payload.documents || []));
    pageToken = payload.nextPageToken || "";
  } while (pageToken);

  return docs;
}

async function writeDocument(baseUrl, collection, id, fields, accessToken) {
  const url = `${baseUrl}/${collection}/${encodeURIComponent(id)}`;
  await fetchJson(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ fields })
  });
}

async function deleteDocument(baseUrl, collection, id, accessToken) {
  const url = `${baseUrl}/${collection}/${encodeURIComponent(id)}`;
  await fetchJson(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

function mapClassDoc(doc) {
  const parsed = parseDoc(doc);
  const f = parsed.fields;
  return {
    id: parsed.id,
    rawFields: f,
    name: firstNonEmpty([firestoreValueToJs(f.name), firestoreValueToJs(f.className), parsed.id]),
    classCode: firstNonEmpty([firestoreValueToJs(f.classCode), firestoreValueToJs(f.name), firestoreValueToJs(f.className)]),
    churchName: firstNonEmpty([firestoreValueToJs(f.churchName), firestoreValueToJs(f.church_name)]),
    instructorName: firstNonEmpty([
      firestoreValueToJs(f.instructorName),
      firestoreValueToJs(f.instructor),
      firestoreValueToJs(f.teacherName)
    ]),
    sheetTab: firestoreValueToJs(f.sheetTab),
    studentIds: (firestoreValueToJs(f.studentIds) || []).filter(Boolean)
  };
}

function mapStudentDoc(doc) {
  const parsed = parseDoc(doc);
  const f = parsed.fields;
  const firstName = firstNonEmpty([firestoreValueToJs(f.firstName), firestoreValueToJs(f.first_name)]);
  const lastName = firstNonEmpty([firestoreValueToJs(f.lastName), firestoreValueToJs(f.last_name)]);
  const computedName = `${firstName} ${lastName}`.trim();
  return {
    id: parsed.id,
    rawFields: f,
    name: firstNonEmpty([firestoreValueToJs(f.name), computedName, parsed.id]),
    classId: firstNonEmpty([firestoreValueToJs(f.classId), firestoreValueToJs(f.class_id), firestoreValueToJs(f.className)]),
    className: firstNonEmpty([firestoreValueToJs(f.className), firestoreValueToJs(f.class_name), firestoreValueToJs(f.classId)]),
    instructorName: firstNonEmpty([firestoreValueToJs(f.instructorName), firestoreValueToJs(f.instructor_name)]),
    churchName: firstNonEmpty([firestoreValueToJs(f.churchName), firestoreValueToJs(f.church_name)]),
    subgroup: firstNonEmpty([firestoreValueToJs(f.subgroup), firestoreValueToJs(f.groupName)]),
    isRegistered: Boolean(firstNonEmpty([firestoreValueToJs(f.isRegistered), firestoreValueToJs(f.is_registered)]))
  };
}

function mapAttendanceDoc(doc) {
  const parsed = parseDoc(doc);
  const f = parsed.fields;
  return {
    id: parsed.id,
    rawFields: f,
    studentId: firstNonEmpty([firestoreValueToJs(f.studentId), firestoreValueToJs(f.student_id)]),
    studentName: firstNonEmpty([firestoreValueToJs(f.studentName), firestoreValueToJs(f.student_name)]),
    classId: firstNonEmpty([firestoreValueToJs(f.classId), firestoreValueToJs(f.class_id)]),
    className: firstNonEmpty([firestoreValueToJs(f.className), firestoreValueToJs(f.class_name), firestoreValueToJs(f.classId)]),
    lessonId: firstNonEmpty([firestoreValueToJs(f.lessonId), firestoreValueToJs(f.lesson_id)]),
    lessonTitle: firstNonEmpty([firestoreValueToJs(f.lessonTitle), firestoreValueToJs(f.lesson_title)]),
    status: String(firstNonEmpty([firestoreValueToJs(f.status), firestoreValueToJs(f.attendanceStatus), "present"]))
      .toLowerCase()
      .trim(),
    sessionDate: firstNonEmpty([firestoreValueToJs(f.sessionDate), firestoreValueToJs(f.date), firestoreValueToJs(f.createdAt)])
  };
}

function mapLessonDoc(doc) {
  const parsed = parseDoc(doc);
  const f = parsed.fields;
  return {
    id: parsed.id,
    rawFields: f,
    classId: firstNonEmpty([firestoreValueToJs(f.classId), firestoreValueToJs(f.class_id)]),
    className: firstNonEmpty([firestoreValueToJs(f.className), firestoreValueToJs(f.class_name), firestoreValueToJs(f.classId)])
  };
}

function mapUnregisteredDoc(doc) {
  const parsed = parseDoc(doc);
  const f = parsed.fields;
  return {
    id: parsed.id,
    rawFields: f,
    classId: firstNonEmpty([firestoreValueToJs(f.classId), firestoreValueToJs(f.class_id)]),
    className: firstNonEmpty([firestoreValueToJs(f.className), firestoreValueToJs(f.class_name), firestoreValueToJs(f.classId)]),
    studentName: firstNonEmpty([firestoreValueToJs(f.studentName), firestoreValueToJs(f.student_name)])
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const dryRun = !args.apply;

  loadLocalEnv();
  const baseUrl = getFirestoreBaseUrl();
  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);

  const [classDocsRaw, studentDocsRaw, attendanceDocsRaw, lessonDocsRaw, unregisteredDocsRaw] = await Promise.all([
    listCollectionDocuments(baseUrl, "academyClasses", accessToken, 500),
    listCollectionDocuments(baseUrl, "academyStudents", accessToken, 4000),
    listCollectionDocuments(baseUrl, "academyAttendance", accessToken, 6000),
    listCollectionDocuments(baseUrl, "academyLessons", accessToken, 4000),
    listCollectionDocuments(baseUrl, "academyLessonUnregistered", accessToken, 4000)
  ]);

  const classes = classDocsRaw.map(mapClassDoc);
  const students = studentDocsRaw.map(mapStudentDoc);
  const attendance = attendanceDocsRaw.map(mapAttendanceDoc);
  const lessons = lessonDocsRaw.map(mapLessonDoc);
  const unregistered = unregisteredDocsRaw.map(mapUnregisteredDoc);

  const classGroups = new Map();
  for (const academyClass of classes) {
    const key = normalizeKey(academyClass.name || academyClass.classCode || academyClass.id);
    if (!classGroups.has(key)) {
      classGroups.set(key, []);
    }
    classGroups.get(key).push(academyClass);
  }

  const classAliasMap = new Map();
  const aliasClassIdsToDelete = [];
  const canonicalClassById = new Map();

  for (const [, group] of classGroups.entries()) {
    const canonicalId = chooseCanonicalClassId(group);
    const canonicalClass = group.find((item) => item.id === canonicalId) || group[0];
    canonicalClassById.set(canonicalId, canonicalClass);

    for (const academyClass of group) {
      classAliasMap.set(academyClass.id, canonicalId);
      if (academyClass.id !== canonicalId) {
        aliasClassIdsToDelete.push(academyClass.id);
      }
    }
  }

  const attendanceRefCountByStudentId = new Map();
  for (const row of attendance) {
    const key = String(row.studentId || "").trim();
    if (!key) {
      continue;
    }
    attendanceRefCountByStudentId.set(key, (attendanceRefCountByStudentId.get(key) || 0) + 1);
  }

  const studentsByCanonicalKey = new Map();
  for (const student of students) {
    const mappedClassId = classAliasMap.get(student.classId) || student.classId;
    const dedupeKey = `${mappedClassId}::${normalizeKey(student.name)}`;
    if (!studentsByCanonicalKey.has(dedupeKey)) {
      studentsByCanonicalKey.set(dedupeKey, []);
    }
    studentsByCanonicalKey.get(dedupeKey).push({ ...student, mappedClassId });
  }

  const studentAliasMap = new Map();
  const duplicateStudentIdsToDelete = [];
  const canonicalStudentById = new Map();

  for (const [, group] of studentsByCanonicalKey.entries()) {
    const canonicalStudentId = chooseCanonicalStudentId(group, attendanceRefCountByStudentId);
    const canonical = group.find((item) => item.id === canonicalStudentId) || group[0];

    const mergedSubgroup = firstNonEmpty(group.map((item) => item.subgroup));
    const mergedRegistered = group.some((item) => item.isRegistered);
    const classData = canonicalClassById.get(canonical.mappedClassId);

    const mergedCanonical = {
      ...canonical,
      classId: canonical.mappedClassId,
      className: firstNonEmpty([classData?.name, canonical.className]),
      instructorName: firstNonEmpty([classData?.instructorName, canonical.instructorName]),
      churchName: firstNonEmpty([classData?.churchName, canonical.churchName]),
      subgroup: mergedSubgroup,
      isRegistered: mergedRegistered
    };

    canonicalStudentById.set(canonicalStudentId, mergedCanonical);

    for (const student of group) {
      studentAliasMap.set(student.id, canonicalStudentId);
      if (student.id !== canonicalStudentId) {
        duplicateStudentIdsToDelete.push(student.id);
      }
    }
  }

  const canonicalStudentIdByClassAndName = new Map();
  for (const student of canonicalStudentById.values()) {
    const key = `${student.classId}::${normalizeKey(student.name)}`;
    if (key !== "::") {
      canonicalStudentIdByClassAndName.set(key, student.id);
    }
  }

  const classUpdates = [];
  const studentUpdates = [];
  const attendanceUpdates = [];
  const lessonUpdates = [];
  const unregisteredUpdates = [];

  for (const [canonicalClassId, canonicalClass] of canonicalClassById.entries()) {
    const groupedClasses = classes.filter((item) => (classAliasMap.get(item.id) || item.id) === canonicalClassId);
    const classStudentIds = new Set();

    for (const student of canonicalStudentById.values()) {
      if (student.classId === canonicalClassId) {
        classStudentIds.add(student.id);
      }
    }

    for (const grouped of groupedClasses) {
      for (const studentId of grouped.studentIds || []) {
        const mapped = studentAliasMap.get(studentId) || studentId;
        if (mapped) {
          classStudentIds.add(mapped);
        }
      }
    }

    const mergedClass = {
      ...canonicalClass,
      classCode: firstNonEmpty(groupedClasses.map((item) => item.classCode)),
      name: firstNonEmpty(groupedClasses.map((item) => item.name)),
      churchName: firstNonEmpty(groupedClasses.map((item) => item.churchName)),
      instructorName: firstNonEmpty(groupedClasses.map((item) => item.instructorName)),
      sheetTab: firstNonEmpty(groupedClasses.map((item) => item.sheetTab)),
      studentIds: [...classStudentIds].sort((a, b) => a.localeCompare(b, "en"))
    };

    classUpdates.push({
      id: canonicalClassId,
      fields: {
        ...canonicalClass.rawFields,
        name: strValue(mergedClass.name),
        classCode: strValue(mergedClass.classCode),
        churchName: strValue(mergedClass.churchName),
        instructorName: strValue(mergedClass.instructorName),
        sheetTab: strValue(mergedClass.sheetTab),
        studentIds: arrayStringValue(mergedClass.studentIds)
      }
    });
  }

  for (const student of students) {
    const mappedClassId = classAliasMap.get(student.classId) || student.classId;
    const classData = canonicalClassById.get(mappedClassId);
    const aliasResolvedId = studentAliasMap.get(student.id) || student.id;
    const key = `${mappedClassId}::${normalizeKey(student.name)}`;
    const fallbackCanonicalId = canonicalStudentIdByClassAndName.get(key);
    const canonicalId = fallbackCanonicalId || aliasResolvedId;

    if (student.id !== canonicalId) {
      continue;
    }

    const canonicalStudent = canonicalStudentById.get(canonicalId) || {
      ...student,
      classId: mappedClassId,
      className: classData?.name || student.className
    };

    studentUpdates.push({
      id: canonicalId,
      fields: {
        ...student.rawFields,
        name: strValue(canonicalStudent.name),
        classId: strValue(canonicalStudent.classId),
        className: strValue(firstNonEmpty([canonicalStudent.className, classData?.name, student.className])),
        instructorName: strValue(firstNonEmpty([canonicalStudent.instructorName, classData?.instructorName, student.instructorName])),
        churchName: strValue(firstNonEmpty([canonicalStudent.churchName, classData?.churchName, student.churchName])),
        subgroup: strValue(canonicalStudent.subgroup),
        isRegistered: boolValue(canonicalStudent.isRegistered)
      }
    });
  }

  for (const row of attendance) {
    const mappedClassId = classAliasMap.get(row.classId) || row.classId;
    const classData = canonicalClassById.get(mappedClassId);
    const keyByName = `${mappedClassId}::${normalizeKey(row.studentName)}`;
    const canonicalStudentId =
      studentAliasMap.get(row.studentId) ||
      canonicalStudentIdByClassAndName.get(keyByName) ||
      row.studentId;
    const canonicalStudent = canonicalStudentById.get(canonicalStudentId);

    const nextClassName = firstNonEmpty([classData?.name, row.className]);
    const nextStudentName = firstNonEmpty([canonicalStudent?.name, row.studentName]);

    if (
      mappedClassId === row.classId &&
      canonicalStudentId === row.studentId &&
      nextClassName === row.className &&
      nextStudentName === row.studentName
    ) {
      continue;
    }

    attendanceUpdates.push({
      id: row.id,
      fields: {
        ...row.rawFields,
        studentId: strValue(canonicalStudentId),
        studentName: strValue(nextStudentName),
        classId: strValue(mappedClassId),
        className: strValue(nextClassName)
      }
    });
  }

  for (const lesson of lessons) {
    const mappedClassId = classAliasMap.get(lesson.classId) || lesson.classId;
    const classData = canonicalClassById.get(mappedClassId);
    const nextClassName = firstNonEmpty([classData?.name, lesson.className]);

    if (mappedClassId === lesson.classId && nextClassName === lesson.className) {
      continue;
    }

    lessonUpdates.push({
      id: lesson.id,
      fields: {
        ...lesson.rawFields,
        classId: strValue(mappedClassId),
        className: strValue(nextClassName)
      }
    });
  }

  for (const row of unregistered) {
    const mappedClassId = classAliasMap.get(row.classId) || row.classId;
    const classData = canonicalClassById.get(mappedClassId);
    const nextClassName = firstNonEmpty([classData?.name, row.className]);

    if (mappedClassId === row.classId && nextClassName === row.className) {
      continue;
    }

    unregisteredUpdates.push({
      id: row.id,
      fields: {
        ...row.rawFields,
        classId: strValue(mappedClassId),
        className: strValue(nextClassName)
      }
    });
  }

  const report = {
    mode: dryRun ? "dry-run" : "apply",
    countsBefore: {
      classes: classes.length,
      students: students.length,
      attendance: attendance.length,
      lessons: lessons.length,
      unregistered: unregistered.length
    },
    plan: {
      classesToUpdate: classUpdates.length,
      aliasClassesToDelete: aliasClassIdsToDelete.length,
      studentsToUpdate: studentUpdates.length,
      duplicateStudentsToDelete: duplicateStudentIdsToDelete.length,
      attendanceToUpdate: attendanceUpdates.length,
      lessonsToUpdate: lessonUpdates.length,
      unregisteredToUpdate: unregisteredUpdates.length
    },
    samples: {
      aliasClassesToDelete: aliasClassIdsToDelete.slice(0, 20),
      duplicateStudentsToDelete: duplicateStudentIdsToDelete.slice(0, 20),
      classUpdates: classUpdates.slice(0, 5).map((item) => item.id),
      studentUpdates: studentUpdates.slice(0, 5).map((item) => item.id),
      attendanceUpdates: attendanceUpdates.slice(0, 5).map((item) => item.id)
    }
  };

  console.log(JSON.stringify(report, null, 2));

  if (dryRun) {
    return;
  }

  for (const item of classUpdates) {
    await writeDocument(baseUrl, "academyClasses", item.id, item.fields, accessToken);
  }
  for (const item of studentUpdates) {
    await writeDocument(baseUrl, "academyStudents", item.id, item.fields, accessToken);
  }
  for (const item of attendanceUpdates) {
    await writeDocument(baseUrl, "academyAttendance", item.id, item.fields, accessToken);
  }
  for (const item of lessonUpdates) {
    await writeDocument(baseUrl, "academyLessons", item.id, item.fields, accessToken);
  }
  for (const item of unregisteredUpdates) {
    await writeDocument(baseUrl, "academyLessonUnregistered", item.id, item.fields, accessToken);
  }

  const uniqueStudentDeletes = [...new Set(duplicateStudentIdsToDelete)];
  for (const id of uniqueStudentDeletes) {
    await deleteDocument(baseUrl, "academyStudents", id, accessToken);
  }

  const uniqueClassDeletes = [...new Set(aliasClassIdsToDelete)];
  for (const id of uniqueClassDeletes) {
    await deleteDocument(baseUrl, "academyClasses", id, accessToken);
  }

  const finalReport = {
    ...report,
    executed: {
      classesUpdated: classUpdates.length,
      studentsUpdated: studentUpdates.length,
      attendanceUpdated: attendanceUpdates.length,
      lessonsUpdated: lessonUpdates.length,
      unregisteredUpdated: unregisteredUpdates.length,
      studentsDeleted: uniqueStudentDeletes.length,
      classesDeleted: uniqueClassDeletes.length
    }
  };

  console.log(JSON.stringify(finalReport, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
