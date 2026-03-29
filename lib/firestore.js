const { fetchJson, getAccessToken, getEnv } = require("./google-auth");
const { loadGoogleSheetsData } = require("./sheets");
const { loadPastorsSheet } = require("./pastors");

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

function toPastorDocument(pastor) {
  return {
    fields: {
      name: stringValue(pastor.name || ""),
      firstName: stringValue(pastor.first_name || ""),
      lastName: stringValue(pastor.last_name || ""),
      title: stringValue(pastor.title || ""),
      aliases: arrayStringValue(
        String(pastor.aliases || "")
          .split(/[|;,]/)
          .map((item) => item.trim())
          .filter(Boolean)
      ),
      churchName: stringValue(pastor.church_name || ""),
      city: stringValue(pastor.city || ""),
      phone: stringValue(pastor.phone || ""),
      email: stringValue(pastor.email || ""),
      notes: stringValue(pastor.notes || ""),
      sourceVariants: arrayStringValue(
        String(pastor.source_variants || "")
          .split("|")
          .map((item) => item.trim())
          .filter(Boolean)
      ),
      meetingCount: integerValue(pastor.meeting_count || 0),
      firstMeetingDate: stringValue(pastor.first_meeting_date || ""),
      lastMeetingDate: stringValue(pastor.last_meeting_date || ""),
      source: stringValue(pastor.source || ""),
      needsReview: booleanValue(String(pastor.needs_review || "").toLowerCase() === "true"),
      lastReviewedAt: stringValue(pastor.last_reviewed_at || "")
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
  if ("integerValue" in value) {
    return value.integerValue;
  }
  if ("booleanValue" in value) {
    return value.booleanValue;
  }
  if ("arrayValue" in value) {
    return (value.arrayValue.values || []).map(firestoreValueToJs);
  }
  if ("doubleValue" in value) {
    return value.doubleValue;
  }
  return "";
}

function parseFirestoreDocument(doc) {
  const name = String(doc.name || "");
  const id = decodeURIComponent(name.split("/").pop() || "");
  return { id, fields: doc.fields || {} };
}

function mapPastorDocument(doc) {
  const parsed = parseFirestoreDocument(doc);
  const fields = parsed.fields;
  return {
    id: parsed.id,
    name: firestoreValueToJs(fields.name),
    first_name: firestoreValueToJs(fields.firstName),
    last_name: firestoreValueToJs(fields.lastName),
    title: firestoreValueToJs(fields.title),
    aliases: (firestoreValueToJs(fields.aliases) || []).join(" | "),
    church_name: firestoreValueToJs(fields.churchName),
    city: firestoreValueToJs(fields.city),
    phone: firestoreValueToJs(fields.phone),
    email: firestoreValueToJs(fields.email),
    notes: firestoreValueToJs(fields.notes),
    source_variants: (firestoreValueToJs(fields.sourceVariants) || []).join(" | "),
    meeting_count: firestoreValueToJs(fields.meetingCount) || "0",
    first_meeting_date: firestoreValueToJs(fields.firstMeetingDate),
    last_meeting_date: firestoreValueToJs(fields.lastMeetingDate),
    source: firestoreValueToJs(fields.source),
    needs_review: String(Boolean(firestoreValueToJs(fields.needsReview))),
    last_reviewed_at: firestoreValueToJs(fields.lastReviewedAt)
  };
}

function mapMemberDocument(doc) {
  const parsed = parseFirestoreDocument(doc);
  const fields = parsed.fields;
  return {
    id: parsed.id,
    name: firestoreValueToJs(fields.name),
    zone: firestoreValueToJs(fields.zone),
    department_role: firestoreValueToJs(fields.departmentRole),
    status: firestoreValueToJs(fields.status),
    aliases: (firestoreValueToJs(fields.aliases) || []).join(" | ")
  };
}

function mapMeetingDocument(doc) {
  const parsed = parseFirestoreDocument(doc);
  const fields = parsed.fields;
  return {
    id: parsed.id,
    member_id: firestoreValueToJs(fields.memberId),
    member_ids: (firestoreValueToJs(fields.memberIds) || []).join(", "),
    member_name: firestoreValueToJs(fields.memberName),
    member_name_raw: firestoreValueToJs(fields.memberNameRaw),
    member_names_canonical: (firestoreValueToJs(fields.memberNamesCanonical) || []).join(", "),
    member_match_status: firestoreValueToJs(fields.memberMatchStatus),
    member_unmatched_names: (firestoreValueToJs(fields.memberUnmatchedNames) || []).join(", "),
    pastor_name: firestoreValueToJs(fields.pastorName),
    meeting_date: firestoreValueToJs(fields.meetingDate),
    report_date: firestoreValueToJs(fields.reportDate),
    month: firestoreValueToJs(fields.month),
    zone: firestoreValueToJs(fields.zone),
    calendar_logged: String(Boolean(firestoreValueToJs(fields.calendarLogged))),
    source: firestoreValueToJs(fields.source),
    event_summary: firestoreValueToJs(fields.eventSummary),
    event_description: firestoreValueToJs(fields.eventDescription),
    event_location: firestoreValueToJs(fields.eventLocation)
  };
}

function mapTrainingDocument(doc) {
  const parsed = parseFirestoreDocument(doc);
  const fields = parsed.fields;
  return {
    id: parsed.id,
    member_id: firestoreValueToJs(fields.memberId),
    member_name: firestoreValueToJs(fields.memberName),
    cohort: firestoreValueToJs(fields.cohort),
    week: firestoreValueToJs(fields.week),
    attendance: firestoreValueToJs(fields.attendance) || "0",
    completed: firestoreValueToJs(fields.completed) || "0",
    completion_score: firestoreValueToJs(fields.completionScore) || "0",
    enrolled: String(Boolean(firestoreValueToJs(fields.enrolled)))
  };
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  return String(value || "")
    .split(/[|,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function mapAcademyClassDocument(doc) {
  const parsed = parseFirestoreDocument(doc);
  const fields = parsed.fields;
  return {
    id: parsed.id,
    name: firstDefined(firestoreValueToJs(fields.name), firestoreValueToJs(fields.className), parsed.id) || parsed.id,
    instructor_name:
      firstDefined(
        firestoreValueToJs(fields.instructorName),
        firestoreValueToJs(fields.instructor),
        firestoreValueToJs(fields.teacherName)
      ) || "",
    evaluator_names: toArray(
      firstDefined(
        firestoreValueToJs(fields.evaluatorNames),
        firestoreValueToJs(fields.evaluators),
        firestoreValueToJs(fields.staffEvaluators)
      )
    ),
    student_ids: toArray(
      firstDefined(firestoreValueToJs(fields.studentIds), firestoreValueToJs(fields.students))
    )
  };
}

function mapAcademyStudentDocument(doc) {
  const parsed = parseFirestoreDocument(doc);
  const fields = parsed.fields;
  return {
    id: parsed.id,
    first_name: firstDefined(firestoreValueToJs(fields.firstName), firestoreValueToJs(fields.first_name)) || "",
    last_name: firstDefined(firestoreValueToJs(fields.lastName), firestoreValueToJs(fields.last_name)) || "",
    name:
      firstDefined(
        firestoreValueToJs(fields.name),
        [
          firestoreValueToJs(fields.firstName),
          firestoreValueToJs(fields.lastName)
        ]
          .filter(Boolean)
          .join(" ")
          .trim()
      ) || parsed.id,
    class_id:
      firstDefined(
        firestoreValueToJs(fields.classId),
        firestoreValueToJs(fields.class_id),
        firestoreValueToJs(fields.className)
      ) || "",
    class_name:
      firstDefined(
        firestoreValueToJs(fields.className),
        firestoreValueToJs(fields.class_name),
        firestoreValueToJs(fields.classId)
      ) || "",
    status: firstDefined(firestoreValueToJs(fields.status), firestoreValueToJs(fields.studentStatus)) || "Actif",
    pastor_name:
      firstDefined(
        firestoreValueToJs(fields.pastorName),
        firestoreValueToJs(fields.name),
        [
          firestoreValueToJs(fields.firstName),
          firestoreValueToJs(fields.lastName)
        ]
          .filter(Boolean)
          .join(" ")
          .trim()
      ) || parsed.id
  };
}

function mapAcademyAttendanceDocument(doc) {
  const parsed = parseFirestoreDocument(doc);
  const fields = parsed.fields;
  const status = firstDefined(
    firestoreValueToJs(fields.status),
    firestoreValueToJs(fields.attendanceStatus),
    firestoreValueToJs(fields.presence)
  );

  return {
    id: parsed.id,
    student_id:
      firstDefined(
        firestoreValueToJs(fields.studentId),
        firestoreValueToJs(fields.student_id)
      ) || "",
    student_name:
      firstDefined(
        firestoreValueToJs(fields.studentName),
        firestoreValueToJs(fields.student_name)
      ) || "",
    class_id:
      firstDefined(
        firestoreValueToJs(fields.classId),
        firestoreValueToJs(fields.class_id)
      ) || "",
    class_name:
      firstDefined(
        firestoreValueToJs(fields.className),
        firestoreValueToJs(fields.class_name),
        firestoreValueToJs(fields.classId)
      ) || "",
    session_date:
      firstDefined(
        firestoreValueToJs(fields.sessionDate),
        firestoreValueToJs(fields.date),
        firestoreValueToJs(fields.createdAt)
      ) || "",
    status: String(status || "present").toLowerCase(),
    evaluation_score: Number(
      firstDefined(
        firestoreValueToJs(fields.evaluationScore),
        firestoreValueToJs(fields.score),
        0
      ) || 0
    ),
    evaluation_note:
      firstDefined(
        firestoreValueToJs(fields.evaluationNote),
        firestoreValueToJs(fields.note),
        firestoreValueToJs(fields.notes)
      ) || ""
  };
}

async function loadAcademyDataFromFirestore() {
  const [classesDocs, studentsDocs, attendanceDocs] = await Promise.all([
    listCollectionDocuments("academyClasses"),
    listCollectionDocuments("academyStudents"),
    listCollectionDocuments("academyAttendance", 2000)
  ]);

  return {
    classes: classesDocs.map(mapAcademyClassDocument),
    students: studentsDocs.map(mapAcademyStudentDocument),
    attendance: attendanceDocs.map(mapAcademyAttendanceDocument)
  };
}

async function buildFirestoreDocuments(data) {
  const pastors = await loadPastorsSheet();
  return {
    members: (data.members || []).map((member) => ({ id: String(member.id || ""), doc: toMemberDocument(member) })),
    meetings: (data.meetings || []).map((meeting) => ({ id: String(meeting.id || ""), doc: toMeetingDocument(meeting) })),
    trainingSessions: (data.trainingSessions || []).map((training) => ({
      id: String(training.id || ""),
      doc: toTrainingDocument(training)
    })),
    pastors: pastors.map((pastor) => ({ id: String(pastor.id || ""), doc: toPastorDocument(pastor) }))
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

async function listCollectionDocuments(collection, pageSize = 500) {
  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();
  const url = `${baseUrl}/${collection}?pageSize=${pageSize}`;
  const result = await fetchJson(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return result.documents || [];
}

async function loadPastorsFromFirestore() {
  const docs = await listCollectionDocuments("pastors");
  return docs.map(mapPastorDocument).sort((a, b) => {
    const delta = Number(b.meeting_count || 0) - Number(a.meeting_count || 0);
    if (delta !== 0) {
      return delta;
    }
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

async function loadDashboardDataFromFirestore() {
  const [membersDocs, meetingsDocs, trainingDocs] = await Promise.all([
    listCollectionDocuments("members"),
    listCollectionDocuments("meetings"),
    listCollectionDocuments("trainingSessions")
  ]);

  return {
    meta: {
      policyName: "Evolution des membres",
      period: new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
      refreshLabel: "Donnees consolidees"
    },
    members: membersDocs.map(mapMemberDocument),
    meetings: meetingsDocs.map(mapMeetingDocument),
    trainingSessions: trainingDocs.map(mapTrainingDocument)
  };
}

async function updatePastorInFirestore(input) {
  const pastorId = String(input.id || "").trim();
  if (!pastorId) {
    throw new Error("Missing pastor id.");
  }

  const payload = {
    id: pastorId,
    name: String(input.name || "").trim(),
    first_name: String(input.first_name || "").trim(),
    last_name: String(input.last_name || "").trim(),
    title: String(input.title || "").trim(),
    aliases: String(input.aliases || "").trim(),
    church_name: String(input.church_name || "").trim(),
    city: String(input.city || "").trim(),
    phone: String(input.phone || "").trim(),
    email: String(input.email || "").trim(),
    notes: String(input.notes || "").trim(),
    source_variants: String(input.source_variants || "").trim(),
    meeting_count: String(input.meeting_count || "0").trim(),
    first_meeting_date: String(input.first_meeting_date || "").trim(),
    last_meeting_date: String(input.last_meeting_date || "").trim(),
    source: String(input.source || "google_calendar").trim(),
    needs_review: String(Boolean(input.needs_review)),
    last_reviewed_at: new Date().toISOString()
  };

  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();
  await writeDocument(baseUrl, "pastors", pastorId, toPastorDocument(payload), accessToken);
  return payload;
}

async function syncSheetsToFirestore() {
  const data = await loadGoogleSheetsData();
  const payload = await buildFirestoreDocuments(data);
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

  for (const item of payload.pastors) {
    if (item.id) {
      await writeDocument(baseUrl, "pastors", item.id, item.doc, accessToken);
    }
  }

  return {
    members: payload.members.length,
    meetings: payload.meetings.length,
    trainingSessions: payload.trainingSessions.length,
    pastors: payload.pastors.length
  };
}

module.exports = {
  buildFirestoreDocuments,
  getFirestoreConfigSummary,
  hasFirestoreConfig,
  loadAcademyDataFromFirestore,
  loadDashboardDataFromFirestore,
  loadPastorsFromFirestore,
  syncSheetsToFirestore,
  testFirestoreConnection,
  updatePastorInFirestore
};

