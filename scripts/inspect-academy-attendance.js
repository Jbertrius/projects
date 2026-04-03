const { loadLocalEnv } = require("../lib/env");
const { fetchJson, getAccessToken, getEnv } = require("../lib/google-auth");

const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";

function getFirestoreBaseUrl() {
  const projectId = getEnv("FIRESTORE_PROJECT_ID");
  const databaseId = getEnv("FIRESTORE_DATABASE_ID", "(default)");
  if (!projectId) {
    throw new Error("Missing FIRESTORE_PROJECT_ID.");
  }
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents`;
}

function parseValue(value) {
  if (!value || typeof value !== "object") return "";
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return value.integerValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(parseValue);
  return "";
}

async function main() {
  loadLocalEnv();
  const ids = process.argv.slice(2).filter(Boolean);
  if (!ids.length) {
    throw new Error("Usage: node scripts/inspect-academy-attendance.js <id> [id2 ...]");
  }

  const token = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();

  for (const id of ids) {
    const payload = await fetchJson(`${baseUrl}/academyAttendance/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const fields = payload.fields || {};
    const result = {
      id,
      student_id: parseValue(fields.studentId) || parseValue(fields.student_id),
      student_name: parseValue(fields.studentName) || parseValue(fields.student_name),
      class_id: parseValue(fields.classId) || parseValue(fields.class_id),
      class_name: parseValue(fields.className) || parseValue(fields.class_name),
      lesson_id: parseValue(fields.lessonId) || parseValue(fields.lesson_id),
      lesson_title: parseValue(fields.lessonTitle) || parseValue(fields.lesson_title),
      session_date: parseValue(fields.sessionDate) || parseValue(fields.date),
      status: parseValue(fields.status),
      timestamp: parseValue(fields.timestamp) || parseValue(fields.createdAt)
    };

    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
