const { loadLocalEnv } = require("../lib/env");
const { loadAcademyDataFromFirestore } = require("../lib/firestore");
const { fetchJson, getAccessToken, getEnv } = require("../lib/google-auth");

loadLocalEnv();

const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeName(value) {
  return slugify(value).replace(/_/g, " ");
}

function stringValue(value) {
  return { stringValue: String(value ?? "") };
}

function booleanValue(value) {
  return { booleanValue: Boolean(value) };
}

function getFirestoreBaseUrl() {
  const projectId = getEnv("FIRESTORE_PROJECT_ID");
  const databaseId = getEnv("FIRESTORE_DATABASE_ID", "(default)");
  if (!projectId) {
    throw new Error("Missing FIRESTORE_PROJECT_ID.");
  }
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents`;
}

function toAcademyStudentDocument(student) {
  return {
    fields: {
      name: stringValue(student.name || ""),
      classId: stringValue(student.class_id || ""),
      className: stringValue(student.class_name || ""),
      instructorName: stringValue(student.instructor_name || ""),
      churchName: stringValue(student.church_name || ""),
      subgroup: stringValue(student.subgroup || ""),
      isRegistered: booleanValue(Boolean(student.is_registered)),
      status: stringValue(student.status || (student.is_registered ? "Inscrit" : "Non inscrit"))
    }
  };
}

function toAcademyClassDocument(academyClass) {
  return {
    fields: {
      name: stringValue(academyClass.name || ""),
      classCode: stringValue(academyClass.class_code || ""),
      churchName: stringValue(academyClass.church_name || ""),
      instructorName: stringValue(academyClass.instructor_name || ""),
      sheetTab: stringValue(academyClass.sheet_tab || ""),
      studentIds: {
        arrayValue: {
          values: (academyClass.student_ids || []).map((value) => stringValue(value))
        }
      }
    }
  };
}

function toAcademyAttendancePatch(row) {
  return {
    fields: {
      studentId: stringValue(row.student_id || ""),
      studentName: stringValue(row.student_name || ""),
      classId: stringValue(row.class_id || ""),
      className: stringValue(row.class_name || ""),
      lessonDate: stringValue(row.session_date || ""),
      status: stringValue(row.status || ""),
      lessonId: stringValue(row.lesson_id || ""),
      lessonTitle: stringValue(row.lesson_title || ""),
      subgroup: stringValue(row.subgroup || ""),
      timestamp: stringValue(row.timestamp || "")
    }
  };
}

async function writeDocument(baseUrl, collection, id, doc, accessToken) {
  const url = `${baseUrl}/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`;
  return fetchJson(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(doc)
  });
}

async function deleteDocument(baseUrl, collection, id, accessToken) {
  const url = `${baseUrl}/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok && response.status !== 404) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }
}

function chooseCanonicalStudent(students) {
  return [...students].sort((left, right) => {
    const leftRegistered = Boolean(left.is_registered);
    const rightRegistered = Boolean(right.is_registered);
    if (leftRegistered !== rightRegistered) {
      return leftRegistered ? -1 : 1;
    }
    const leftLegacy = /^STU/i.test(String(left.id || ""));
    const rightLegacy = /^STU/i.test(String(right.id || ""));
    if (leftLegacy !== rightLegacy) {
      return leftLegacy ? -1 : 1;
    }
    return String(left.id || "").localeCompare(String(right.id || ""));
  })[0];
}

async function main() {
  const data = await loadAcademyDataFromFirestore();
  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();
  const classesById = new Map((data.classes || []).map((item) => [String(item.id), item]));
  const attendanceByClassAndName = new Map();
  const unregisteredByClassAndName = new Map();

  for (const row of data.attendance || []) {
    const key = `${row.class_id}::${normalizeName(row.student_name)}`;
    const bucket = attendanceByClassAndName.get(key) || [];
    bucket.push(row);
    attendanceByClassAndName.set(key, bucket);
  }

  for (const row of data.unregistered || []) {
    const key = `${row.class_id}::${normalizeName(row.student_name)}`;
    const bucket = unregisteredByClassAndName.get(key) || [];
    bucket.push(row);
    unregisteredByClassAndName.set(key, bucket);
  }

  const studentsByClassAndName = new Map();
  for (const student of data.students || []) {
    const key = `${student.class_id}::${normalizeName(student.name)}`;
    const bucket = studentsByClassAndName.get(key) || [];
    bucket.push(student);
    studentsByClassAndName.set(key, bucket);
  }

  let duplicateGroups = 0;
  let deletedStudents = 0;
  let patchedAttendance = 0;
  let patchedStudents = 0;
  let patchedClasses = 0;

  for (const [key, group] of studentsByClassAndName.entries()) {
    const [classId, normalizedStudentName] = key.split("::");
    const attendanceRows = attendanceByClassAndName.get(key) || [];
    const unregisteredRows = unregisteredByClassAndName.get(key) || [];
    const canonical = chooseCanonicalStudent(group);
    const hasRegisteredAttendance = attendanceRows.length > 0;
    const hasUnregisteredOnly = !hasRegisteredAttendance && unregisteredRows.length > 0;
    const mergedSubgroup = group.map((item) => String(item.subgroup || "").trim()).find(Boolean) || "";
    const classDoc = classesById.get(classId) || {};
    const finalStudent = {
      ...canonical,
      class_id: classId,
      class_name: canonical.class_name || classDoc.name || classId,
      instructor_name: canonical.instructor_name || classDoc.instructor_name || "",
      church_name: canonical.church_name || classDoc.church_name || "",
      subgroup: mergedSubgroup,
      is_registered: hasRegisteredAttendance || group.some((item) => item.is_registered),
      status: hasUnregisteredOnly ? "Non inscrit" : "Inscrit"
    };

    await writeDocument(baseUrl, "academyStudents", canonical.id, toAcademyStudentDocument(finalStudent), accessToken);
    patchedStudents += 1;

    for (const row of attendanceRows) {
      if (String(row.student_id || "") === String(canonical.id)) {
        continue;
      }
      await writeDocument(
        baseUrl,
        "academyAttendance",
        row.id,
        toAcademyAttendancePatch({
          ...row,
          student_id: canonical.id,
          subgroup: row.subgroup || mergedSubgroup
        }),
        accessToken
      );
      patchedAttendance += 1;
    }

    const duplicates = group.filter((item) => String(item.id) !== String(canonical.id));
    if (duplicates.length) {
      duplicateGroups += 1;
    }
    for (const duplicate of duplicates) {
      await deleteDocument(baseUrl, "academyStudents", duplicate.id, accessToken);
      deletedStudents += 1;
    }
  }

  for (const academyClass of data.classes || []) {
    const studentIds = [];
    for (const student of data.students || []) {
      if (String(student.class_id) !== String(academyClass.id)) {
        continue;
      }
      const key = `${academyClass.id}::${normalizeName(student.name)}`;
      const group = studentsByClassAndName.get(key) || [];
      if (!group.length) {
        continue;
      }
      const canonical = chooseCanonicalStudent(group);
      const attendanceRows = attendanceByClassAndName.get(key) || [];
      const isRegistered = attendanceRows.length > 0 || group.some((item) => item.is_registered);
      if (isRegistered) {
        studentIds.push(canonical.id);
      }
    }

    const dedupedStudentIds = Array.from(new Set(studentIds)).sort((a, b) => String(a).localeCompare(String(b)));
    await writeDocument(
      baseUrl,
      "academyClasses",
      academyClass.id,
      toAcademyClassDocument({
        id: academyClass.id,
        name: academyClass.name,
        class_code: academyClass.name,
        church_name: academyClass.church_name || "",
        instructor_name: academyClass.instructor_name || "",
        sheet_tab: academyClass.sheet_tab || "",
        student_ids: dedupedStudentIds
      }),
      accessToken
    );
    patchedClasses += 1;
  }

  console.log(JSON.stringify({
    ok: true,
    duplicateGroups,
    patchedStudents,
    patchedAttendance,
    deletedStudents,
    patchedClasses
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
