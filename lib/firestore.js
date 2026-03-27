const { fetchJson, getAccessToken, getEnv } = require("./google-auth");
const { loadGoogleSheetsData } = require("./sheets");

const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";

function hasFirestoreConfig() {
  return Boolean(getEnv("FIRESTORE_PROJECT_ID"));
}

function getFirestoreConfigSummary() {
  return {
    projectId: Boolean(getEnv("FIRESTORE_PROJECT_ID")),
    databaseId: getEnv("FIRESTORE_DATABASE_ID", "(default)")
  };
}

async function testFirestoreConnection() {
  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();
  const url = `${baseUrl}/members?pageSize=1`;
  const result = await fetchJson(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return {
    config: getFirestoreConfigSummary(),
    documents: result.documents ? result.documents.length : 0
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

function stringValue(value) {
  return { stringValue: String(value ?? "") };
}

function booleanValue(value) {
  return { booleanValue: Boolean(value) };
}

function integerValue(value) {
  return { integerValue: String(Number(value || 0)) };
}

function arrayStringValue(values) {
  return {
    arrayValue: {
      values: (values || []).map((value) => stringValue(value))
    }
  };
}

function toMemberDocument(member) {
  return {
    fields: {
      name: stringValue(member.name),
      zone: stringValue(member.zone),
      departmentRole: stringValue(member.department_role || member.role || ""),
      status: stringValue(member.status || ""),
      aliases: arrayStringValue(
        String(member.aliases || member.alias_names || "")
          .split(/[;,|]/)
          .map((item) => item.trim())
          .filter(Boolean)
      )
    }
  };
}

function toMeetingDocument(meeting) {
  return {
    fields: {
      memberId: stringValue(meeting.member_id || ""),
      memberIds: arrayStringValue(
        String(meeting.member_ids || meeting.member_id || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      ),
      memberName: stringValue(meeting.member_name || ""),
      memberNameRaw: stringValue(meeting.member_name_raw || ""),
      memberNamesCanonical: arrayStringValue(
        String(meeting.member_names_canonical || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      ),
      memberMatchStatus: stringValue(meeting.member_match_status || ""),
      memberUnmatchedNames: arrayStringValue(
        String(meeting.member_unmatched_names || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      ),
      pastorName: stringValue(meeting.pastor_name || ""),
      meetingDate: stringValue(meeting.meeting_date || ""),
      reportDate: stringValue(meeting.report_date || ""),
      month: stringValue(meeting.month || ""),
      zone: stringValue(meeting.zone || ""),
      calendarLogged: booleanValue(String(meeting.calendar_logged || "").toLowerCase() === "true"),
      source: stringValue(meeting.source || ""),
      eventSummary: stringValue(meeting.event_summary || ""),
      eventDescription: stringValue(meeting.event_description || ""),
      eventLocation: stringValue(meeting.event_location || "")
    }
  };
}

function toTrainingDocument(training) {
  return {
    fields: {
      memberId: stringValue(training.member_id || ""),
      memberName: stringValue(training.member_name || ""),
      cohort: stringValue(training.cohort || ""),
      week: stringValue(training.week || ""),
      attendance: integerValue(training.attendance || 0),
      completed: integerValue(training.completed || 0),
      completionScore: integerValue(training.completion_score || 0),
      enrolled: booleanValue(String(training.enrolled || "").toLowerCase() === "true")
    }
  };
}

function buildFirestoreDocuments(data) {
  return {
    members: (data.members || []).map((member) => ({ id: String(member.id || ""), doc: toMemberDocument(member) })),
    meetings: (data.meetings || []).map((meeting) => ({ id: String(meeting.id || ""), doc: toMeetingDocument(meeting) })),
    trainingSessions: (data.trainingSessions || []).map((training) => ({
      id: String(training.id || ""),
      doc: toTrainingDocument(training)
    }))
  };
}

async function writeDocument(baseUrl, collection, id, doc, accessToken) {
  const url = `${baseUrl}/${collection}/${encodeURIComponent(id)}`;
  return fetchJson(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(doc)
  });
}

async function syncSheetsToFirestore() {
  const data = await loadGoogleSheetsData();
  const payload = buildFirestoreDocuments(data);
  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();

  for (const item of payload.members) {
    if (item.id) {
      await writeDocument(baseUrl, "members", item.id, item.doc, accessToken);
    }
  }

  for (const item of payload.meetings) {
    if (item.id) {
      await writeDocument(baseUrl, "meetings", item.id, item.doc, accessToken);
    }
  }

  for (const item of payload.trainingSessions) {
    if (item.id) {
      await writeDocument(baseUrl, "trainingSessions", item.id, item.doc, accessToken);
    }
  }

  return {
    members: payload.members.length,
    meetings: payload.meetings.length,
    trainingSessions: payload.trainingSessions.length
  };
}

module.exports = {
  buildFirestoreDocuments,
  getFirestoreConfigSummary,
  hasFirestoreConfig,
  syncSheetsToFirestore,
  testFirestoreConnection
};
