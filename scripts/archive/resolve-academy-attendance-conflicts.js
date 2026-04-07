const { loadLocalEnv } = require("../lib/env");
const { fetchJson, getAccessToken, getEnv } = require("../lib/google-auth");

const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    apply: args.has("--apply")
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

async function deleteDocument(baseUrl, collection, id, accessToken) {
  const url = `${baseUrl}/${collection}/${encodeURIComponent(id)}`;
  await fetchJson(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

function chooseDocToKeep(rows) {
  const presentRows = rows.filter((row) => row.status === "present");
  const pool = presentRows.length ? presentRows : rows;

  return [...pool].sort((a, b) => {
    const aId = Number(a.id);
    const bId = Number(b.id);
    if (Number.isFinite(aId) && Number.isFinite(bId) && aId !== bId) {
      return bId - aId;
    }
    return String(b.id).localeCompare(String(a.id), "en");
  })[0];
}

async function main() {
  loadLocalEnv();
  const { apply } = parseArgs(process.argv);

  const baseUrl = getFirestoreBaseUrl();
  const token = await getAccessToken([FIRESTORE_SCOPE]);
  const attendanceDocs = await listCollectionDocuments(baseUrl, "academyAttendance", token, 6000);

  const rows = attendanceDocs.map((doc) => {
    const parsed = parseDoc(doc);
    const f = parsed.fields;
    const classId = parseValue(f.classId) || parseValue(f.class_id) || "";
    const studentId = parseValue(f.studentId) || parseValue(f.student_id) || "";
    const studentName = parseValue(f.studentName) || parseValue(f.student_name) || "";
    const lessonId = parseValue(f.lessonId) || parseValue(f.lesson_id) || "";
    const lessonTitle = parseValue(f.lessonTitle) || parseValue(f.lesson_title) || "";
    const sessionDate = parseValue(f.sessionDate) || parseValue(f.date) || "";
    return {
      id: parsed.id,
      classId,
      studentId,
      studentName,
      lessonId,
      lessonTitle,
      sessionDate,
      status: String(parseValue(f.status) || "").toLowerCase().trim()
    };
  });

  const groups = new Map();
  for (const row of rows) {
    const studentKey = row.studentId || normalizeKey(row.studentName);
    const lessonKey = row.lessonId || `${row.sessionDate}::${normalizeKey(row.lessonTitle)}`;
    const key = `${row.classId}::${studentKey}::${lessonKey}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(row);
  }

  const conflicts = [...groups.entries()].filter(([, items]) => items.length > 1);
  const resolutionPlan = conflicts.map(([key, items]) => {
    const keep = chooseDocToKeep(items);
    const remove = items.filter((item) => item.id !== keep.id);
    return {
      key,
      keep,
      remove,
      statuses: [...new Set(items.map((item) => item.status))]
    };
  });

  const report = {
    mode: apply ? "apply" : "dry-run",
    conflictCount: resolutionPlan.length,
    removableRowsCount: resolutionPlan.reduce((sum, item) => sum + item.remove.length, 0),
    samples: resolutionPlan.slice(0, 10).map((item) => ({
      key: item.key,
      keepId: item.keep.id,
      keepStatus: item.keep.status,
      removeIds: item.remove.map((row) => row.id),
      statuses: item.statuses
    }))
  };

  console.log(JSON.stringify(report, null, 2));

  if (!apply) {
    return;
  }

  for (const conflict of resolutionPlan) {
    for (const row of conflict.remove) {
      await deleteDocument(baseUrl, "academyAttendance", row.id, token);
    }
  }

  console.log(
    JSON.stringify(
      {
        ...report,
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
