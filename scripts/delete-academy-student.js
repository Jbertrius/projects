const { loadLocalEnv } = require("../lib/env");
const { fetchJson, getAccessToken, getEnv } = require("../lib/google-auth");

const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    classCode: "",
    studentName: "",
    apply: false
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--class" && args[i + 1]) {
      options.classCode = args[i + 1];
      i += 1;
      continue;
    }
    if (token === "--name" && args[i + 1]) {
      options.studentName = args[i + 1];
      i += 1;
      continue;
    }
    if (token === "--apply") {
      options.apply = true;
    }
  }

  return options;
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseDoc(doc) {
  const name = String(doc.name || "");
  const id = decodeURIComponent(name.split("/").pop() || "");
  return { id, fields: doc.fields || {} };
}

function parseValue(value) {
  if (!value || typeof value !== "object") return "";
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return value.integerValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(parseValue);
  return "";
}

function strValue(value) {
  return { stringValue: String(value ?? "") };
}

function arrayStringValue(values) {
  return {
    arrayValue: {
      values: (values || []).filter(Boolean).map((item) => strValue(item))
    }
  };
}

function getFirestoreBaseUrl() {
  const projectId = getEnv("FIRESTORE_PROJECT_ID");
  const databaseId = getEnv("FIRESTORE_DATABASE_ID", "(default)");
  if (!projectId) {
    throw new Error("Missing FIRESTORE_PROJECT_ID.");
  }
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents`;
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

async function main() {
  loadLocalEnv();
  const { classCode, studentName, apply } = parseArgs(process.argv);

  if (!classCode || !studentName) {
    throw new Error("Usage: node scripts/delete-academy-student.js --class <classCode> --name <studentName> [--apply]");
  }

  const baseUrl = getFirestoreBaseUrl();
  const token = await getAccessToken([FIRESTORE_SCOPE]);

  const [classDocsRaw, studentDocsRaw, attendanceDocsRaw, unregisteredDocsRaw] = await Promise.all([
    listCollectionDocuments(baseUrl, "academyClasses", token, 500),
    listCollectionDocuments(baseUrl, "academyStudents", token, 4000),
    listCollectionDocuments(baseUrl, "academyAttendance", token, 6000),
    listCollectionDocuments(baseUrl, "academyLessonUnregistered", token, 4000)
  ]);

  const classes = classDocsRaw.map((doc) => {
    const parsed = parseDoc(doc);
    const f = parsed.fields;
    return {
      id: parsed.id,
      rawFields: f,
      classCode: parseValue(f.classCode) || parseValue(f.name) || parseValue(f.className) || parsed.id,
      name: parseValue(f.name) || parseValue(f.className) || parsed.id,
      studentIds: (parseValue(f.studentIds) || []).filter(Boolean)
    };
  });

  const targetClass = classes.find((item) => normalize(item.classCode) === normalize(classCode) || normalize(item.name) === normalize(classCode));
  if (!targetClass) {
    throw new Error(`Classe introuvable pour code/nom: ${classCode}`);
  }

  const students = studentDocsRaw.map((doc) => {
    const parsed = parseDoc(doc);
    const f = parsed.fields;
    return {
      id: parsed.id,
      classId: parseValue(f.classId) || parseValue(f.class_id) || "",
      name: parseValue(f.name) || "",
      rawFields: f
    };
  });

  const targetStudents = students.filter(
    (student) =>
      String(student.classId) === String(targetClass.id) &&
      normalize(student.name) === normalize(studentName)
  );

  if (!targetStudents.length) {
    console.log(
      JSON.stringify(
        {
          mode: apply ? "apply" : "dry-run",
          classId: targetClass.id,
          className: targetClass.name,
          studentName,
          found: false,
          message: "Aucun etudiant correspondant dans cette classe."
        },
        null,
        2
      )
    );
    return;
  }

  const targetStudentIds = new Set(targetStudents.map((item) => item.id));
  const attendanceToDelete = attendanceDocsRaw
    .map((doc) => {
      const parsed = parseDoc(doc);
      const f = parsed.fields;
      return {
        id: parsed.id,
        studentId: parseValue(f.studentId) || parseValue(f.student_id) || "",
        classId: parseValue(f.classId) || parseValue(f.class_id) || ""
      };
    })
    .filter((row) => targetStudentIds.has(row.studentId) && String(row.classId) === String(targetClass.id));

  const unregisteredToDelete = unregisteredDocsRaw
    .map((doc) => {
      const parsed = parseDoc(doc);
      const f = parsed.fields;
      return {
        id: parsed.id,
        studentName: parseValue(f.studentName) || parseValue(f.student_name) || "",
        classId: parseValue(f.classId) || parseValue(f.class_id) || ""
      };
    })
    .filter((row) => normalize(row.studentName) === normalize(studentName) && String(row.classId) === String(targetClass.id));

  const nextClassStudentIds = targetClass.studentIds.filter((id) => !targetStudentIds.has(id));

  const plan = {
    mode: apply ? "apply" : "dry-run",
    classId: targetClass.id,
    className: targetClass.name,
    classCode: targetClass.classCode,
    studentName,
    studentDocsToDelete: [...targetStudentIds],
    attendanceDocsToDelete: attendanceToDelete.map((item) => item.id),
    unregisteredDocsToDelete: unregisteredToDelete.map((item) => item.id),
    classStudentIdsBefore: targetClass.studentIds.length,
    classStudentIdsAfter: nextClassStudentIds.length
  };

  console.log(JSON.stringify(plan, null, 2));

  if (!apply) {
    return;
  }

  await writeDocument(
    baseUrl,
    "academyClasses",
    targetClass.id,
    {
      ...targetClass.rawFields,
      studentIds: arrayStringValue(nextClassStudentIds)
    },
    token
  );

  for (const studentId of targetStudentIds) {
    await deleteDocument(baseUrl, "academyStudents", studentId, token);
  }

  for (const row of attendanceToDelete) {
    await deleteDocument(baseUrl, "academyAttendance", row.id, token);
  }

  for (const row of unregisteredToDelete) {
    await deleteDocument(baseUrl, "academyLessonUnregistered", row.id, token);
  }

  console.log(
    JSON.stringify(
      {
        ...plan,
        executed: true
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
