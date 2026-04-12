const { fetchJson, getAccessToken, getEnv } = require("./google-auth");
const { loadGoogleSheetsData } = require("./sheets");
const { loadPastorsSheet } = require("./pastors");
const { loadAcademySheetData } = require("./academy-sheets");
const { normalizeMeetingRecord } = require("./meeting-normalization");

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
  const normalized = normalizeMeetingRecord(meeting);
  return {
    fields: {
      memberId: stringValue(normalized.member_id || ""),
      memberIds: arrayStringValue(
        String(normalized.member_ids || normalized.member_id || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      ),
      memberName: stringValue(normalized.member_name || ""),
      memberNameRaw: stringValue(normalized.member_name_raw || ""),
      memberNamesCanonical: arrayStringValue(
        String(normalized.member_names_canonical || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      ),
      memberMatchStatus: stringValue(normalized.member_match_status || ""),
      memberUnmatchedNames: arrayStringValue(
        String(normalized.member_unmatched_names || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      ),
      pastorName: stringValue(normalized.pastor_name || ""),
      meetingDate: stringValue(normalized.meeting_date || ""),
      reportDate: stringValue(normalized.report_date || ""),
      month: stringValue(normalized.month || ""),
      zone: stringValue(normalized.zone || ""),
      calendarLogged: booleanValue(String(normalized.calendar_logged || "").toLowerCase() === "true"),
      source: stringValue(normalized.source || ""),
      eventSummary: stringValue(normalized.event_summary || ""),
      eventDescription: stringValue(normalized.event_description || ""),
      eventLocation: stringValue(normalized.event_location || "")
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
      academyClass: stringValue(pastor.academy_class || ""),
      classNumber: stringValue(pastor.class_number || ""),
      cellNumber: stringValue(pastor.cell_number || ""),
      currentMission: stringValue(pastor.current_mission || ""),
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
      lastReviewedAt: stringValue(pastor.last_reviewed_at || ""),
      gmcsSummitStatus: stringValue(pastor.gmcs_summit_status || ""),
      gmcsSummitNote: stringValue(pastor.gmcs_summit_note || "")
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
      studentIds: arrayStringValue(academyClass.student_ids || [])
    }
  };
}

function toAcademyStudentDocument(student) {
  return {
    fields: {
      name: stringValue(student.name || ""),
      firstName: stringValue(student.first_name || ""),
      lastName: stringValue(student.last_name || ""),
      classId: stringValue(student.class_id || ""),
      className: stringValue(student.class_name || ""),
      instructorName: stringValue(student.instructor_name || ""),
      churchName: stringValue(student.church_name || ""),
      subgroup: stringValue(student.subgroup || ""),
      notes: stringValue(student.notes || ""),
      isRegistered: booleanValue(Boolean(student.is_registered)),
      status: stringValue(student.status || (student.is_registered ? "Inscrit" : "Non inscrit")),
      gmcsSummitStatus: stringValue(student.gmcs_summit_status || ""),
      gmcsSummitNote: stringValue(student.gmcs_summit_note || "")
    }
  };
}

function mapStudentStatusToRegistered(status, fallback = null) {
  const normalized = String(status || "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["non inscrit", "non-inscrit", "visiteur", "ponctuel"].includes(normalized)) {
    return false;
  }
  if (["inscrit", "actif"].includes(normalized)) {
    return true;
  }
  return fallback;
}

function normalizeSummitStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "verbal") return "verbal";
  if (normalized === "inscrit") return "inscrit";
  if (["paiement", "paiement recu", "paiement reçu"].includes(normalized)) return "paiement";
  return "";
}

function toAcademyAttendanceDocument(entry) {
  return {
    fields: {
      studentId: stringValue(entry.student_id || ""),
      studentName: stringValue(entry.student_name || ""),
      classId: stringValue(entry.class_id || ""),
      className: stringValue(entry.class_name || ""),
      lessonDate: stringValue(entry.session_date || ""),  // canonical: lessonDate (matches academyLessons)
      status: stringValue(entry.status || ""),
      lessonId: stringValue(entry.lesson_id || ""),
      lessonTitle: stringValue(entry.lesson_title || ""),
      subgroup: stringValue(entry.subgroup || ""),
      timestamp: stringValue(entry.timestamp || "")
    }
  };
}

function toAcademyUnregisteredDocument(entry) {
  return {
    fields: {
      studentName: stringValue(entry.student_name || ""),
      classId: stringValue(entry.class_id || ""),
      className: stringValue(entry.class_name || ""),
      lessonDate: stringValue(entry.session_date || ""),  // canonical: lessonDate (matches academyLessons)
      lessonId: stringValue(entry.lesson_id || ""),
      lessonTitle: stringValue(entry.lesson_title || ""),
      note: stringValue(entry.note || ""),
      timestamp: stringValue(entry.timestamp || "")
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
    academy_class: firestoreValueToJs(fields.academyClass),
    class_number: firestoreValueToJs(fields.classNumber),
    cell_number: firestoreValueToJs(fields.cellNumber),
    current_mission: firestoreValueToJs(fields.currentMission),
    notes: firestoreValueToJs(fields.notes),
    source_variants: (firestoreValueToJs(fields.sourceVariants) || []).join(" | "),
    meeting_count: firestoreValueToJs(fields.meetingCount) || "0",
    first_meeting_date: firestoreValueToJs(fields.firstMeetingDate),
    last_meeting_date: firestoreValueToJs(fields.lastMeetingDate),
    source: firestoreValueToJs(fields.source),
    needs_review: String(Boolean(firestoreValueToJs(fields.needsReview))),
    last_reviewed_at: firestoreValueToJs(fields.lastReviewedAt),
    gmcs_summit_status: firestoreValueToJs(fields.gmcsSummitStatus) || "",
    gmcs_summit_note: firestoreValueToJs(fields.gmcsSummitNote) || ""
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
    // memberNamesCanonical is the canonical array field; fall back to legacy "participantNames" written by early bot versions
    member_names_canonical:
      (firstDefined(
        firestoreValueToJs(fields.memberNamesCanonical),
        firestoreValueToJs(fields.participantNames)
      ) || []).join(", "),
    member_match_status: firestoreValueToJs(fields.memberMatchStatus),
    member_unmatched_names: (firestoreValueToJs(fields.memberUnmatchedNames) || []).join(", "),
    pastor_name: firestoreValueToJs(fields.pastorName),
    meeting_date: firestoreValueToJs(fields.meetingDate),
    report_date: firestoreValueToJs(fields.reportDate),
    month: firestoreValueToJs(fields.month),
    zone: firestoreValueToJs(fields.zone),
    calendar_logged: String(Boolean(firestoreValueToJs(fields.calendarLogged))),
    source: firestoreValueToJs(fields.source),
    // eventSummary is the canonical name; fall back to legacy "summary" written by early bot versions
    event_summary:
      firstDefined(
        firestoreValueToJs(fields.eventSummary),
        firestoreValueToJs(fields.summary)
      ) || "",
    event_description:
      firstDefined(
        firestoreValueToJs(fields.eventDescription),
        firestoreValueToJs(fields.description)
      ) || "",
    event_location:
      firstDefined(
        firestoreValueToJs(fields.eventLocation),
        firestoreValueToJs(fields.location)
      ) || "",
    cooperation_status: firestoreValueToJs(fields.cooperationStatus) || "none",
    follow_up_note: firestoreValueToJs(fields.followUpNote) || "",
    updated_at: firestoreValueToJs(fields.updatedAt) || "",
    calendar_event_id: firestoreValueToJs(fields.calendarEventId) || ""
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

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function utcTimestamp() {
  return new Date().toISOString();
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
    church_name:
      firstDefined(
        firestoreValueToJs(fields.churchName),
        firestoreValueToJs(fields.church_name)
      ) || "",
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
  const isRegistered = firstDefined(
    firestoreValueToJs(fields.isRegistered),
    firestoreValueToJs(fields.is_registered)
  );
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
    instructor_name:
      firstDefined(
        firestoreValueToJs(fields.instructorName),
        firestoreValueToJs(fields.teacherName),
        firestoreValueToJs(fields.instructor_name)
      ) || "",
    church_name:
      firstDefined(
        firestoreValueToJs(fields.churchName),
        firestoreValueToJs(fields.church_name)
      ) || "",
    subgroup:
      firstDefined(
        firestoreValueToJs(fields.subgroup),
        firestoreValueToJs(fields.groupName)
      ) || "",
    is_registered: Boolean(isRegistered),
    status: firstDefined(firestoreValueToJs(fields.status), firestoreValueToJs(fields.studentStatus)) || "Actif",
    notes:
      firstDefined(
        firestoreValueToJs(fields.notes),
        firestoreValueToJs(fields.note)
      ) || "",
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
      ) || parsed.id,
    gmcs_summit_status:
      firstDefined(
        firestoreValueToJs(fields.gmcsSummitStatus),
        firestoreValueToJs(fields.gmcs_summit_status)
      ) || "",
    gmcs_summit_note:
      firstDefined(
        firestoreValueToJs(fields.gmcsSummitNote),
        firestoreValueToJs(fields.gmcs_summit_note)
      ) || ""
  };
}

function isAcademyStudentDeletedDocument(doc) {
  const { fields } = parseFirestoreDocument(doc);
  const deletedAt = firstDefined(
    firestoreValueToJs(fields.deletedAt),
    firestoreValueToJs(fields.deleted_at)
  );
  const status = String(
    firstDefined(
      firestoreValueToJs(fields.status),
      firestoreValueToJs(fields.studentStatus)
    ) || ""
  )
    .trim()
    .toLowerCase();

  return Boolean(deletedAt) || status === "supprime" || status === "supprimé";
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
        firestoreValueToJs(fields.lessonDate),  // canonical name written by new code
        firestoreValueToJs(fields.sessionDate), // backward compat: old documents used sessionDate
        firestoreValueToJs(fields.date),
        firestoreValueToJs(fields.createdAt)
      ) || "",
    lesson_id:
      firstDefined(
        firestoreValueToJs(fields.lessonId),
        firestoreValueToJs(fields.lesson_id)
      ) || "",
    lesson_title:
      firstDefined(
        firestoreValueToJs(fields.lessonTitle),
        firestoreValueToJs(fields.lesson_title)
      ) || "",
    subgroup:
      firstDefined(
        firestoreValueToJs(fields.subgroup),
        firestoreValueToJs(fields.groupName)
      ) || "",
    status: String(status || "present").toLowerCase(),
    evaluation_score: Number(
      firstDefined(
        firestoreValueToJs(fields.evaluationScore),
        firestoreValueToJs(fields.score),
        0
      ) || 0
    ),
    timestamp:
      firstDefined(
        firestoreValueToJs(fields.timestamp),
        firestoreValueToJs(fields.createdAt)
      ) || "",
    evaluation_note:
      firstDefined(
        firestoreValueToJs(fields.evaluationNote),
        firestoreValueToJs(fields.note),
        firestoreValueToJs(fields.notes)
      ) || ""
  };
}

async function loadAcademyDataFromFirestore() {
  const [classesDocs, studentsDocs, attendanceDocs, unregisteredDocs] = await Promise.all([
    listCollectionDocuments("academyClasses"),
    listCollectionDocuments("academyStudents"),
    listCollectionDocuments("academyAttendance", 2000),
    listCollectionDocuments("academyLessonUnregistered", 2000)
  ]);

  return {
    classes: classesDocs.map(mapAcademyClassDocument),
    students: studentsDocs
      .filter((doc) => !isAcademyStudentDeletedDocument(doc))
      .map(mapAcademyStudentDocument),
    attendance: attendanceDocs.map(mapAcademyAttendanceDocument),
    unregistered: unregisteredDocs.map(mapAcademyUnregisteredDocument)
  };
}

function mapAcademyUnregisteredDocument(doc) {
  const parsed = parseFirestoreDocument(doc);
  const fields = parsed.fields;
  return {
    id: parsed.id,
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
        firestoreValueToJs(fields.lessonDate),  // canonical name written by new code
        firestoreValueToJs(fields.sessionDate), // backward compat: old documents used sessionDate
        firestoreValueToJs(fields.date)
      ) || "",
    lesson_id:
      firstDefined(
        firestoreValueToJs(fields.lessonId),
        firestoreValueToJs(fields.lesson_id)
      ) || "",
    lesson_title:
      firstDefined(
        firestoreValueToJs(fields.lessonTitle),
        firestoreValueToJs(fields.lesson_title)
      ) || "",
    note:
      firstDefined(
        firestoreValueToJs(fields.note),
        firestoreValueToJs(fields.notes)
      ) || "",
    timestamp:
      firstDefined(
        firestoreValueToJs(fields.timestamp),
        firestoreValueToJs(fields.createdAt)
      ) || ""
  };
}

function buildAcademyClassId(classCode) {
  return `CLS_${slugify(classCode)}`;
}

function buildAcademyStudentId(classId, studentName) {
  return `${classId}_STU_${slugify(studentName)}`;
}

function buildAcademyLessonId(classId, lessonDate, lessonTitle) {
  return `${classId}_LSN_${lessonDate}_${slugify(lessonTitle)}`;
}

function buildAcademyAttendanceId(lessonId, studentName) {
  return `${lessonId}_ATT_${slugify(studentName)}`;
}

function buildAcademyUnregisteredId(lessonId, studentName) {
  return `${lessonId}_UNR_${slugify(studentName)}`;
}

function normalizeStudentKey(value) {
  return slugify(String(value || "").trim());
}

/**
 * Read registration state from an existing student document.
 * Returns the doc's own isRegistered/regStatus so lesson recording never overwrites
 * admin-set classification for an already-known student.
 * Uses distinct field names (is_registered, reg_status) to avoid collision with
 * the attendance-presence "status" field ("present"/"absent"/"late").
 *
 * @param {object|null} existingDoc  Raw Firestore document (or null for new students)
 * @param {{ is_registered: boolean, reg_status: string }} defaults  Fallback for new students
 */
function getExistingStudentRegistration(existingDoc, defaults) {
  if (!existingDoc) return defaults;
  const fields = parseFirestoreDocument(existingDoc).fields;
  const isRegistered = firestoreValueToJs(fields.isRegistered);
  const regStatus = firestoreValueToJs(fields.status);
  return {
    is_registered: typeof isRegistered === "boolean" ? isRegistered : defaults.is_registered,
    reg_status: String(regStatus || defaults.reg_status)
  };
}

function resolveAcademyStudentIdentity(classId, studentName, existingStudentDocs = []) {
  const classKey = String(classId || "").trim();
  const nameKey = normalizeStudentKey(studentName);
  const matches = existingStudentDocs
    .map((doc) => ({ parsed: parseFirestoreDocument(doc), doc }))
    .filter(({ parsed }) => {
      const fields = parsed.fields;
      const existingClassId = firstDefined(
        firestoreValueToJs(fields.classId),
        firestoreValueToJs(fields.class_id)
      );
      const existingName = firstDefined(
        firestoreValueToJs(fields.name),
        [
          firestoreValueToJs(fields.firstName),
          firestoreValueToJs(fields.lastName)
        ].filter(Boolean).join(" ").trim()
      );
      return String(existingClassId || "").trim() === classKey && normalizeStudentKey(existingName) === nameKey;
    })
    .sort((left, right) => {
      const leftRegistered = Boolean(firestoreValueToJs(left.parsed.fields.isRegistered));
      const rightRegistered = Boolean(firestoreValueToJs(right.parsed.fields.isRegistered));
      if (leftRegistered !== rightRegistered) {
        return leftRegistered ? -1 : 1;
      }
      const leftId = String(left.parsed.id || "");
      const rightId = String(right.parsed.id || "");
      const leftLegacy = /^STU/i.test(leftId);
      const rightLegacy = /^STU/i.test(rightId);
      if (leftLegacy !== rightLegacy) {
        return leftLegacy ? -1 : 1;
      }
      return leftId.localeCompare(rightId);
    });

  if (matches.length) {
    return {
      studentId: matches[0].parsed.id,
      existingDoc: matches[0].doc
    };
  }

  return {
    studentId: buildAcademyStudentId(classId, studentName),
    existingDoc: null
  };
}

function normalizeChurchKey(value) {
  return slugify(
    String(value || "")
      .replace(/[’`´]/g, "'")
      .trim()
  );
}

function resolveAcademyClassIdentity(parsed, existingClassDocs = []) {
  const classCode = String(parsed.class_code || "").trim();
  const normalizedClassCode = slugify(classCode);
  const churchName = normalizeChurchKey(parsed.church_name);

  const matchingDoc = existingClassDocs.find((doc) => {
    const parsedDoc = parseFirestoreDocument(doc);
    const fields = parsedDoc.fields;
    const existingCode = firstDefined(
      firestoreValueToJs(fields.classCode),
      firestoreValueToJs(fields.name),
      firestoreValueToJs(fields.className)
    );
    const existingChurch = normalizeChurchKey(firestoreValueToJs(fields.churchName) || "");

    if (slugify(existingCode) !== normalizedClassCode) {
      return false;
    }

    if (!churchName || !existingChurch) {
      return true;
    }

    return churchName === existingChurch;
  });

  if (matchingDoc) {
    return {
      classId: parseFirestoreDocument(matchingDoc).id,
      existingClassDoc: matchingDoc
    };
  }

  return {
    classId: buildAcademyClassId(classCode),
    existingClassDoc: null
  };
}

async function academyLessonExists(classId, lessonTitle, lessonDate) {
  const lessons = await listCollectionDocuments("academyLessons", 2000);
  const titleKey = slugify(lessonTitle);
  return lessons.some((doc) => {
    const parsed = parseFirestoreDocument(doc);
    const fields = parsed.fields;
    return (
      firestoreValueToJs(fields.classId) === classId &&
      slugify(firestoreValueToJs(fields.lessonTitle)) === titleKey &&
      firestoreValueToJs(fields.lessonDate) === lessonDate
    );
  });
}

async function findAcademyLessonDocument(classId, lessonTitle, lessonDate) {
  const lessons = await listCollectionDocuments("academyLessons", 2000);
  const titleKey = slugify(lessonTitle);
  return lessons.find((doc) => {
    const parsed = parseFirestoreDocument(doc);
    const fields = parsed.fields;
    return (
      firestoreValueToJs(fields.classId) === classId &&
      slugify(firestoreValueToJs(fields.lessonTitle)) === titleKey &&
      firestoreValueToJs(fields.lessonDate) === lessonDate
    );
  }) || null;
}

async function createAcademyLessonRecord(parsed) {
  const [existingClassDocs, existingStudentDocs] = await Promise.all([
    listCollectionDocuments("academyClasses", 500),
    listCollectionDocuments("academyStudents", 3000)
  ]);
  const { classId, existingClassDoc } = resolveAcademyClassIdentity(parsed, existingClassDocs);
  const lessonId = buildAcademyLessonId(classId, parsed.lesson_date, parsed.lesson_title);
  if (await academyLessonExists(classId, parsed.lesson_title, parsed.lesson_date)) {
    throw new Error(
      `La lecon "${parsed.lesson_title}" du ${parsed.lesson_date} existe deja pour la classe ${parsed.class_code}.`
    );
  }

  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();
  const sheetTab = `${String(parsed.teacher_name || parsed.class_code).split(" ")[0] || parsed.class_code} Class`;
  const registeredStudents = (parsed.registered_students || [])
    .map(([name, status, subgroup]) => ({
      name: String(name || "").trim(),
      status: String(status || "").trim().toLowerCase(),
      subgroup: String(subgroup || "").trim()
    }))
    .filter((item) => item.name);
  const unregisteredStudents = (parsed.unregistered_students || [])
    .map((name) => String(name || "").trim())
    .filter(Boolean);

  const registeredStudentRefs = registeredStudents.map((item) => ({
    ...item,
    ...resolveAcademyStudentIdentity(classId, item.name, existingStudentDocs)
  }));
  const unregisteredStudentRefs = unregisteredStudents.map((name) => ({
    name,
    ...resolveAcademyStudentIdentity(classId, name, existingStudentDocs)
  }));
  // Preserve admin-set registration status for existing students; only default for new ones.
  const registeredStudentRefsWithReg = registeredStudentRefs.map((item) => ({
    ...item,
    ...getExistingStudentRegistration(item.existingDoc, { is_registered: true, reg_status: "Inscrit" })
  }));
  // Students whose fiche is soft-deleted (isRegistered=false): do not recreate their student doc
  // or add them to classStudentIds, but still write an attendance record for them.
  const activeRegisteredStudents = registeredStudentRefsWithReg.filter((item) => item.is_registered);
  const softDeletedStudents = registeredStudentRefsWithReg.filter((item) => !item.is_registered);
  if (softDeletedStudents.length) {
    const names = softDeletedStudents.map((s) => s.name).join(", ");
    console.warn(`[createAcademyLessonRecord] Soft-deleted students (attendance only): ${names}`);
  }
  // Only include a student in the class's studentIds if they are (or default to) registered.
  const classStudentIds = activeRegisteredStudents.map((item) => item.studentId);
  const existingStudentIds = existingClassDoc
    ? firestoreValueToJs(parseFirestoreDocument(existingClassDoc).fields.studentIds) || []
    : [];
  const mergedStudentIds = Array.from(new Set([...(existingStudentIds || []), ...classStudentIds]));

  await writeDocument(
    baseUrl,
    "academyClasses",
    classId,
    toAcademyClassDocument({
      id: classId,
      name: parsed.class_code,
      class_code: parsed.class_code,
      church_name: parsed.church_name,
      instructor_name: parsed.teacher_name,
      sheet_tab: sheetTab,
      student_ids: mergedStudentIds
    }),
    accessToken
  );

  await writeDocument(
    baseUrl,
    "academyLessons",
    lessonId,
    {
      fields: {
        classId: stringValue(classId),
        className: stringValue(parsed.class_code),
        lessonTitle: stringValue(parsed.lesson_title),
        lessonDate: stringValue(parsed.lesson_date),
        instructorName: stringValue(parsed.teacher_name),
        createdAt: stringValue(utcTimestamp())
      }
    },
    accessToken
  );

  for (const student of activeRegisteredStudents) {
    const studentId = student.studentId;
    await writeDocument(
      baseUrl,
      "academyStudents",
      studentId,
      toAcademyStudentDocument({
        id: studentId,
        name: student.name,
        class_id: classId,
        class_name: parsed.class_code,
        instructor_name: parsed.teacher_name,
        church_name: parsed.church_name,
        subgroup: student.subgroup,
        is_registered: student.is_registered,
        status: student.reg_status   // registration label, not attendance presence
      }),
      accessToken
    );

    await writeDocument(
      baseUrl,
      "academyAttendance",
      buildAcademyAttendanceId(lessonId, student.name),
      toAcademyAttendanceDocument({
        id: buildAcademyAttendanceId(lessonId, student.name),
        student_id: studentId,
        student_name: student.name,
        class_id: classId,
        class_name: parsed.class_code,
        session_date: parsed.lesson_date,
        status: student.status || "unknown",  // attendance presence: present/absent/late
        lesson_id: lessonId,
        lesson_title: parsed.lesson_title,
        subgroup: student.subgroup,
        timestamp: utcTimestamp()
      }),
      accessToken
    );
  }

  // Write attendance-only records for soft-deleted students (no student doc update).
  for (const student of softDeletedStudents) {
    await writeDocument(
      baseUrl,
      "academyAttendance",
      buildAcademyAttendanceId(lessonId, student.name),
      toAcademyAttendanceDocument({
        id: buildAcademyAttendanceId(lessonId, student.name),
        student_id: student.studentId,
        student_name: student.name,
        class_id: classId,
        class_name: parsed.class_code,
        session_date: parsed.lesson_date,
        status: student.status || "unknown",
        lesson_id: lessonId,
        lesson_title: parsed.lesson_title,
        subgroup: student.subgroup,
        timestamp: utcTimestamp()
      }),
      accessToken
    );
  }

  const unregisteredStudentRefsWithReg = unregisteredStudentRefs.map((item) => ({
    ...item,
    ...getExistingStudentRegistration(item.existingDoc, { is_registered: false, reg_status: "Non inscrit" })
  }));

  for (const student of unregisteredStudentRefsWithReg) {
    const studentId = student.studentId;
    await writeDocument(
      baseUrl,
      "academyStudents",
      studentId,
      toAcademyStudentDocument({
        id: studentId,
        name: student.name,
        class_id: classId,
        class_name: parsed.class_code,
        instructor_name: parsed.teacher_name,
        church_name: parsed.church_name,
        is_registered: student.is_registered,
        status: student.reg_status   // registration label
      }),
      accessToken
    );

    await writeDocument(
      baseUrl,
      "academyLessonUnregistered",
      buildAcademyUnregisteredId(lessonId, student.name),
      toAcademyUnregisteredDocument({
        id: buildAcademyUnregisteredId(lessonId, student.name),
        student_name: student.name,
        class_id: classId,
        class_name: parsed.class_code,
        session_date: parsed.lesson_date,
        lesson_id: lessonId,
        lesson_title: parsed.lesson_title,
        note: String(parsed.absence_notes?.[student.name] || "").trim(),
        timestamp: utcTimestamp()
      }),
      accessToken
    );
  }

  return {
    classId,
    lessonId,
    classCode: parsed.class_code,
    lessonTitle: parsed.lesson_title,
    lessonDate: parsed.lesson_date,
    registeredCount: registeredStudents.length,
    unregisteredCount: unregisteredStudents.length
  };
}

async function replaceAcademyLessonRecord(parsed, options = {}) {
  const [existingClassDocs, attendanceDocs, existingStudentDocs] = await Promise.all([
        listCollectionDocuments("academyClasses", 500),
        listCollectionDocuments("academyAttendance", 3000),
        listCollectionDocuments("academyStudents", 3000)
      ]);
  const fallbackIdentity = resolveAcademyClassIdentity(parsed, existingClassDocs);
  const classId = String(options.classId || "").trim() || fallbackIdentity.classId;
  const existingClassDoc = existingClassDocs.find((doc) => parseFirestoreDocument(doc).id === classId) || fallbackIdentity.existingClassDoc;
  const matchedLessonDoc = !options.lessonId
    ? await findAcademyLessonDocument(classId, parsed.lesson_title, parsed.lesson_date)
    : null;
  const lessonId =
    String(options.lessonId || "").trim() ||
    (matchedLessonDoc ? parseFirestoreDocument(matchedLessonDoc).id : "") ||
    buildAcademyLessonId(classId, parsed.lesson_date, parsed.lesson_title);
  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();
  const sheetTab = `${String(parsed.teacher_name || parsed.class_code).split(" ")[0] || parsed.class_code} Class`;
  const unregisteredDocs = await listCollectionDocuments("academyLessonUnregistered", 3000);
  const existingAttendanceDocs = attendanceDocs.filter((doc) => {
    const fields = parseFirestoreDocument(doc).fields;
    return firestoreValueToJs(fields.lessonId) === lessonId;
  });
  const existingUnregisteredDocs = unregisteredDocs.filter((doc) => {
    const fields = parseFirestoreDocument(doc).fields;
    return firestoreValueToJs(fields.lessonId) === lessonId;
  });

  const registeredStudents = (parsed.registered_students || [])
    .map(([name, status, subgroup]) => ({
      name: String(name || "").trim(),
      status: String(status || "").trim().toLowerCase(),
      subgroup: String(subgroup || "").trim()
    }))
    .filter((item) => item.name);
  const unregisteredStudents = (parsed.unregistered_students || [])
    .map((name) => String(name || "").trim())
    .filter(Boolean);

  const registeredStudentRefs = registeredStudents.map((item) => ({
    ...item,
    ...resolveAcademyStudentIdentity(classId, item.name, existingStudentDocs)
  }));
  const unregisteredStudentRefs = unregisteredStudents.map((name) => ({
    name,
    ...resolveAcademyStudentIdentity(classId, name, existingStudentDocs)
  }));
  // Preserve admin-set registration status for existing students.
  const registeredStudentRefsWithReg = registeredStudentRefs.map((item) => ({
    ...item,
    ...getExistingStudentRegistration(item.existingDoc, { is_registered: true, reg_status: "Inscrit" })
  }));
  const unregisteredStudentRefsWithReg = unregisteredStudentRefs.map((item) => ({
    ...item,
    ...getExistingStudentRegistration(item.existingDoc, { is_registered: false, reg_status: "Non inscrit" })
  }));
  // Skip soft-deleted students — they appear in the block but must not be re-created.
  const activeRegisteredStudents = registeredStudentRefsWithReg.filter((item) => item.is_registered);
  if (activeRegisteredStudents.length < registeredStudentRefsWithReg.length) {
    const skipped = registeredStudentRefsWithReg.filter((s) => !s.is_registered).map((s) => s.name).join(", ");
    console.warn(`[replaceAcademyLessonRecord] Skipping deactivated students: ${skipped}`);
  }
  // Only include in studentIds those who are (or remain) registered.
  const classStudentIds = activeRegisteredStudents.map((item) => item.studentId);
  const existingStudentIds = existingClassDoc
    ? firestoreValueToJs(parseFirestoreDocument(existingClassDoc).fields.studentIds) || []
    : [];
  const mergedStudentIds = Array.from(new Set([...(existingStudentIds || []), ...classStudentIds]));

  await writeDocument(
    baseUrl,
    "academyClasses",
    classId,
    toAcademyClassDocument({
      id: classId,
      name: parsed.class_code,
      class_code: parsed.class_code,
      church_name: parsed.church_name,
      instructor_name: parsed.teacher_name,
      sheet_tab: sheetTab,
      student_ids: mergedStudentIds
    }),
    accessToken
  );

  await writeDocument(
    baseUrl,
    "academyLessons",
    lessonId,
    {
      fields: {
        classId: stringValue(classId),
        className: stringValue(parsed.class_code),
        lessonTitle: stringValue(parsed.lesson_title),
        lessonDate: stringValue(parsed.lesson_date),
        instructorName: stringValue(parsed.teacher_name),
        createdAt: stringValue(utcTimestamp())
      }
    },
    accessToken
  );

  for (const doc of existingAttendanceDocs) {
    await deleteDocument(baseUrl, "academyAttendance", parseFirestoreDocument(doc).id, accessToken);
  }
  for (const doc of existingUnregisteredDocs) {
    await deleteDocument(baseUrl, "academyLessonUnregistered", parseFirestoreDocument(doc).id, accessToken);
  }

  for (const student of activeRegisteredStudents) {
    const studentId = student.studentId;
    await writeDocument(
      baseUrl,
      "academyStudents",
      studentId,
      toAcademyStudentDocument({
        id: studentId,
        name: student.name,
        class_id: classId,
        class_name: parsed.class_code,
        instructor_name: parsed.teacher_name,
        church_name: parsed.church_name,
        subgroup: student.subgroup,
        is_registered: student.is_registered,
        status: student.reg_status   // registration label, not attendance presence
      }),
      accessToken
    );

    await writeDocument(
      baseUrl,
      "academyAttendance",
      buildAcademyAttendanceId(lessonId, student.name),
      toAcademyAttendanceDocument({
        id: buildAcademyAttendanceId(lessonId, student.name),
        student_id: studentId,
        student_name: student.name,
        class_id: classId,
        class_name: parsed.class_code,
        session_date: parsed.lesson_date,
        status: student.status || "unknown",  // attendance presence: present/absent/late
        lesson_id: lessonId,
        lesson_title: parsed.lesson_title,
        subgroup: student.subgroup,
        timestamp: utcTimestamp()
      }),
      accessToken
    );
  }

  for (const student of unregisteredStudentRefsWithReg) {
    const studentId = student.studentId;
    await writeDocument(
      baseUrl,
      "academyStudents",
      studentId,
      toAcademyStudentDocument({
        id: studentId,
        name: student.name,
        class_id: classId,
        class_name: parsed.class_code,
        instructor_name: parsed.teacher_name,
        church_name: parsed.church_name,
        is_registered: student.is_registered,
        status: student.reg_status   // registration label
      }),
      accessToken
    );

    await writeDocument(
      baseUrl,
      "academyLessonUnregistered",
      buildAcademyUnregisteredId(lessonId, student.name),
      toAcademyUnregisteredDocument({
        id: buildAcademyUnregisteredId(lessonId, student.name),
        student_name: student.name,
        class_id: classId,
        class_name: parsed.class_code,
        session_date: parsed.lesson_date,
        lesson_id: lessonId,
        lesson_title: parsed.lesson_title,
        note: String(parsed.absence_notes?.[student.name] || "").trim(),
        timestamp: utcTimestamp()
      }),
      accessToken
    );
  }

  return {
    classId,
    lessonId,
    classCode: parsed.class_code,
    lessonTitle: parsed.lesson_title,
    lessonDate: parsed.lesson_date,
    registeredCount: registeredStudents.length,
    unregisteredCount: unregisteredStudents.length,
    replacedAttendanceCount: existingAttendanceDocs.length
  };
}

async function deleteAcademyLessonRecord(parsed) {
  const existingClassDocs = await listCollectionDocuments("academyClasses", 500);
  const { classId } = resolveAcademyClassIdentity(parsed, existingClassDocs);
  const lessonId = buildAcademyLessonId(classId, parsed.lesson_date, parsed.lesson_title);
  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();
  const attendanceDocs = await listCollectionDocuments("academyAttendance", 3000);
  const unregisteredDocs = await listCollectionDocuments("academyLessonUnregistered", 3000);
  const existingAttendanceDocs = attendanceDocs.filter((doc) => {
    const fields = parseFirestoreDocument(doc).fields;
    return firestoreValueToJs(fields.lessonId) === lessonId;
  });
  const existingUnregisteredDocs = unregisteredDocs.filter((doc) => {
    const fields = parseFirestoreDocument(doc).fields;
    return firestoreValueToJs(fields.lessonId) === lessonId;
  });

  for (const doc of existingAttendanceDocs) {
    await deleteDocument(baseUrl, "academyAttendance", parseFirestoreDocument(doc).id, accessToken);
  }
  for (const doc of existingUnregisteredDocs) {
    await deleteDocument(baseUrl, "academyLessonUnregistered", parseFirestoreDocument(doc).id, accessToken);
  }

  await deleteDocument(baseUrl, "academyLessons", lessonId, accessToken);

  return {
    classId,
    lessonId,
    classCode: parsed.class_code,
    lessonTitle: parsed.lesson_title,
    lessonDate: parsed.lesson_date,
    deletedAttendanceCount: existingAttendanceDocs.length
  };
}

async function deleteAcademyLessonRecordById(input) {
  const lessonId = String(input.lesson_id || "").trim();
  const classId = String(input.class_id || "").trim();
  if (!lessonId) {
    throw new Error("Missing lesson id.");
  }

  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();
  const attendanceDocs = await listCollectionDocuments("academyAttendance", 3000);
  const unregisteredDocs = await listCollectionDocuments("academyLessonUnregistered", 3000);
  const existingAttendanceDocs = attendanceDocs.filter((doc) => {
    const fields = parseFirestoreDocument(doc).fields;
    return firestoreValueToJs(fields.lessonId) === lessonId;
  });
  const existingUnregisteredDocs = unregisteredDocs.filter((doc) => {
    const fields = parseFirestoreDocument(doc).fields;
    return firestoreValueToJs(fields.lessonId) === lessonId;
  });

  for (const doc of existingAttendanceDocs) {
    await deleteDocument(baseUrl, "academyAttendance", parseFirestoreDocument(doc).id, accessToken);
  }
  for (const doc of existingUnregisteredDocs) {
    await deleteDocument(baseUrl, "academyLessonUnregistered", parseFirestoreDocument(doc).id, accessToken);
  }

  await deleteDocument(baseUrl, "academyLessons", lessonId, accessToken);

  return {
    classId,
    lessonId,
    classCode: String(input.class_code || "").trim(),
    lessonTitle: String(input.lesson_title || "").trim(),
    lessonDate: String(input.lesson_date || "").trim(),
    deletedAttendanceCount: existingAttendanceDocs.length
  };
}

async function deleteEmptyAcademyClasses() {
  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();

  const [classDocs, studentDocs] = await Promise.all([
    listCollectionDocuments("academyClasses"),
    listCollectionDocuments("academyStudents", 3000)
  ]);

  const classIdsWithStudents = new Set(
    studentDocs
      .filter((doc) => !isAcademyStudentDeletedDocument(doc))
      .map((doc) => {
        const fields = parseFirestoreDocument(doc).fields;
        return String(
          firestoreValueToJs(fields.classId) ||
          firestoreValueToJs(fields.class_id) ||
          firestoreValueToJs(fields.className) ||
          ""
        ).trim();
      })
      .filter(Boolean)
  );

  const emptyClasses = classDocs.filter((doc) => {
    const id = parseFirestoreDocument(doc).id;
    return !classIdsWithStudents.has(id);
  });

  for (const doc of emptyClasses) {
    const id = parseFirestoreDocument(doc).id;
    await deleteDocument(baseUrl, "academyClasses", id, accessToken);
  }

  return { deleted: emptyClasses.map((doc) => parseFirestoreDocument(doc).id) };
}

async function deleteAcademyStudent(studentId) {
  const id = String(studentId || "").trim();
  if (!id) throw new Error("Missing student id.");
  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();
  // Soft-delete: mark as deactivated instead of physically removing the document.
  // This prevents the student from being re-created the next time a lesson block
  // containing their name is submitted.
  const url = `${baseUrl}/academyStudents/${encodeURIComponent(id)}?updateMask.fieldPaths=isRegistered&updateMask.fieldPaths=status&updateMask.fieldPaths=deletedAt`;
  await fetchJson(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        isRegistered: booleanValue(false),
        status: stringValue("Supprimé"),
        deletedAt: stringValue(utcTimestamp())
      }
    })
  });
}

/**
 * Merge two academy student records:
 * - Transfers all attendance records from secondary to primary
 * - Soft-deletes the secondary student
 * - Primary student keeps all their original data + inherited attendance
 *
 * @param {string} primaryId   - Student ID to keep (receives attendance records)
 * @param {string} secondaryId - Student ID to merge into primary (will be soft-deleted)
 * @returns {Promise<{ok: boolean, merged: number, primary: any, secondary: any}>}
 */
async function mergeAcademyStudents(primaryId, secondaryId) {
  const pid = String(primaryId || "").trim();
  const sid = String(secondaryId || "").trim();
  
  if (!pid) throw new Error("Missing primary student id.");
  if (!sid) throw new Error("Missing secondary student id.");
  if (pid === sid) throw new Error("Cannot merge a student with themselves.");

  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();

  // Load all data in parallel
  const [studentDocs, attendanceDocs] = await Promise.all([
    listCollectionDocuments("academyStudents", 3000),
    listCollectionDocuments("academyAttendance", 3000)
  ]);

  // Find both students
  const primaryDoc = studentDocs.find((doc) => parseFirestoreDocument(doc).id === pid);
  const secondaryDoc = studentDocs.find((doc) => parseFirestoreDocument(doc).id === sid);
  
  if (!primaryDoc) throw new Error(`Primary student not found: ${pid}`);
  if (!secondaryDoc) throw new Error(`Secondary student not found: ${sid}`);

  const primaryStudent = mapAcademyStudentDocument(primaryDoc);
  const secondaryStudent = mapAcademyStudentDocument(secondaryDoc);

  // Find all attendance records for the secondary student
  const secondaryAttendanceRecords = attendanceDocs.filter((doc) => {
    const mapped = mapAcademyAttendanceDocument(doc);
    return String(mapped.student_id || "").trim() === sid;
  });

  // Update each attendance record to point to primary student
  let mergedCount = 0;
  for (const doc of secondaryAttendanceRecords) {
    const attendanceId = parseFirestoreDocument(doc).id;
    const attendanceData = mapAcademyAttendanceDocument(doc);
    
    const mask = "updateMask.fieldPaths=studentId";
    const url = `${baseUrl}/academyAttendance/${encodeURIComponent(attendanceId)}?${mask}`;
    
    await fetchJson(url, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          studentId: stringValue(pid)
        }
      })
    });
    
    mergedCount++;
  }

  // Soft-delete the secondary student
  const deleteUrl = `${baseUrl}/academyStudents/${encodeURIComponent(sid)}?updateMask.fieldPaths=isRegistered&updateMask.fieldPaths=status&updateMask.fieldPaths=deletedAt`;
  await fetchJson(deleteUrl, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        isRegistered: booleanValue(false),
        status: stringValue("Supprimé"),
        deletedAt: stringValue(utcTimestamp())
      }
    })
  });

  return {
    ok: true,
    merged: mergedCount,
    primary: {
      id: primaryStudent.id,
      name: primaryStudent.name
    },
    secondary: {
      id: secondaryStudent.id,
      name: secondaryStudent.name
    }
  };
}

async function updateAcademyStudent(input) {
  const studentId = String(input.id || "").trim();
  if (!studentId) {
    throw new Error("Missing student id.");
  }

  const [studentDocs, classDocs, attendanceDocs, unregisteredDocs] = await Promise.all([
    listCollectionDocuments("academyStudents", 3000),
    listCollectionDocuments("academyClasses", 500),
    listCollectionDocuments("academyAttendance", 3000),
    listCollectionDocuments("academyLessonUnregistered", 3000)
  ]);

  const existingDoc = studentDocs.find((doc) => parseFirestoreDocument(doc).id === studentId);
  if (!existingDoc) {
    throw new Error("Student not found.");
  }

  const existing = mapAcademyStudentDocument(existingDoc);
  const classId = String(existing.class_id || input.class_id || "").trim();
  const academyClass = classDocs.find((doc) => parseFirestoreDocument(doc).id === classId);
  const classFields = academyClass ? parseFirestoreDocument(academyClass).fields : {};
  const existingStudentIds = academyClass ? firestoreValueToJs(classFields.studentIds) || [] : [];

  const status = String(input.status || existing.status || (existing.is_registered ? "Inscrit" : "Non inscrit")).trim();
  const isRegistered = mapStudentStatusToRegistered(status, existing.is_registered !== false);

  const payload = {
    id: studentId,
    name: String(input.name ?? existing.name ?? "").trim(),
    class_id: classId,
    class_name: String(input.class_name ?? existing.class_name ?? existing.class_id ?? "").trim(),
    instructor_name: String(input.instructor_name ?? existing.instructor_name ?? "").trim(),
    church_name: String(input.church_name ?? existing.church_name ?? "").trim(),
    subgroup: String(input.subgroup ?? existing.subgroup ?? "").trim(),
    first_name: String(input.first_name ?? existing.first_name ?? "").trim(),
    last_name: String(input.last_name ?? existing.last_name ?? "").trim(),
    notes: String(input.notes ?? existing.notes ?? "").trim(),
    is_registered: Boolean(isRegistered),
    status,
    gmcs_summit_status: normalizeSummitStatus(input.gmcs_summit_status ?? existing.gmcs_summit_status ?? ""),
    gmcs_summit_note: String(input.gmcs_summit_note ?? existing.gmcs_summit_note ?? "").trim()
  };

  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();

  await writeDocument(baseUrl, "academyStudents", studentId, toAcademyStudentDocument(payload), accessToken);

  const oldName = String(existing.name || "").trim();
  const newName = payload.name;
  if (oldName !== newName) {
    const relatedAttendance = attendanceDocs
      .map((doc) => mapAcademyAttendanceDocument(doc))
      .filter((row) => String(row.student_id || "") === studentId);
    for (const row of relatedAttendance) {
      await writeDocument(
        baseUrl,
        "academyAttendance",
        row.id,
        toAcademyAttendanceDocument({
          ...row,
          student_id: studentId,
          student_name: newName
        }),
        accessToken
      );
    }

    const relatedUnregistered = unregisteredDocs
      .map((doc) => mapAcademyUnregisteredDocument(doc))
      .filter((row) => String(row.class_id || "") === classId && String(row.student_name || "").trim() === oldName);
    for (const row of relatedUnregistered) {
      const nextId = buildAcademyUnregisteredId(String(row.lesson_id || ""), newName);
      await writeDocument(
        baseUrl,
        "academyLessonUnregistered",
        nextId,
        toAcademyUnregisteredDocument({
          ...row,
          id: nextId,
          student_name: newName
        }),
        accessToken
      );
      if (nextId !== row.id) {
        await deleteDocument(baseUrl, "academyLessonUnregistered", row.id, accessToken);
      }
    }
  }

  if (academyClass) {
    const nextStudentIds = payload.is_registered
      ? Array.from(new Set([...(existingStudentIds || []), studentId]))
      : (existingStudentIds || []).filter((id) => String(id) !== studentId);

    await writeDocument(
      baseUrl,
      "academyClasses",
      classId,
      toAcademyClassDocument({
        id: classId,
        name: firstDefined(firestoreValueToJs(classFields.name), firestoreValueToJs(classFields.classCode), payload.class_name),
        class_code: firstDefined(firestoreValueToJs(classFields.classCode), firestoreValueToJs(classFields.name), payload.class_name),
        church_name: firstDefined(firestoreValueToJs(classFields.churchName), payload.church_name),
        instructor_name: firstDefined(firestoreValueToJs(classFields.instructorName), payload.instructor_name),
        sheet_tab: firestoreValueToJs(classFields.sheetTab),
        student_ids: nextStudentIds
      }),
      accessToken
    );
  }

  return payload;
}

async function syncAcademySheetToFirestore() {
  const source = await loadAcademySheetData();
  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();
  const existingStudentDocs = await listCollectionDocuments("academyStudents", 3000);
  const existingSummitByStudentId = new Map(
    existingStudentDocs
      .map(mapAcademyStudentDocument)
      .map((student) => [
        String(student.id || "").trim(),
        {
          gmcs_summit_status: normalizeSummitStatus(student.gmcs_summit_status),
          gmcs_summit_note: String(student.gmcs_summit_note || "").trim()
        }
      ])
      .filter(([id]) => Boolean(id))
  );

  const lessonsById = new Map(
    source.lessons.map((lesson) => [
      String(lesson.lesson_id || "").trim(),
      lesson
    ])
  );
  const classesById = new Map(
    source.classes.map((academyClass) => [
      String(academyClass.class_id || "").trim(),
      academyClass
    ])
  );
  const studentByClassAndName = new Map();

  source.students.forEach((student) => {
    const classId = String(student.class_id || "").trim();
    const studentName = String(student.student_name || "").trim().toLowerCase();
    if (!classId || !studentName) {
      return;
    }
    studentByClassAndName.set(`${classId}::${studentName}`, student);
  });

  const academyClasses = source.classes.map((academyClass) => ({
    id: String(academyClass.class_id || "").trim(),
    name: String(academyClass.class_code || academyClass.class_id || "").trim(),
    class_code: String(academyClass.class_code || "").trim(),
    church_name: String(academyClass.church_name || "").trim(),
    instructor_name: String(academyClass.teacher_name || "").trim(),
    sheet_tab: String(academyClass.sheet_tab || "").trim(),
    student_ids: source.students
      .filter((student) => String(student.class_id || "").trim() === String(academyClass.class_id || "").trim())
      .map((student) => String(student.student_id || "").trim())
      .filter(Boolean)
  }));

  const academyStudents = source.students.map((student) => {
    const classId = String(student.class_id || "").trim();
    const academyClass = classesById.get(classId) || {};
    const isRegistered = String(student.is_registered || "").trim().toUpperCase() === "TRUE";
    const studentId = String(student.student_id || "").trim();
    const existingSummit = existingSummitByStudentId.get(studentId) || {};
    return {
      id: studentId,
      name: String(student.student_name || "").trim(),
      class_id: classId,
      class_name: String(academyClass.class_code || classId).trim(),
      instructor_name: String(academyClass.teacher_name || "").trim(),
      church_name: String(academyClass.church_name || "").trim(),
      is_registered: isRegistered,
      status: isRegistered ? "Inscrit" : "Non inscrit",
      gmcs_summit_status: normalizeSummitStatus(existingSummit.gmcs_summit_status),
      gmcs_summit_note: String(existingSummit.gmcs_summit_note || "").trim()
    };
  });

  const academyAttendance = source.attendance.map((entry) => {
    const classId = String(entry.class_id || "").trim();
    const studentName = String(entry.student_name || "").trim();
    const student = studentByClassAndName.get(`${classId}::${studentName.toLowerCase()}`) || {};
    const lesson = lessonsById.get(String(entry.lesson_id || "").trim()) || {};
    const academyClass = classesById.get(classId) || {};
    const docId = String(entry.id || `${entry.lesson_id}_${studentName}` )
      .replace(/\s+/g, "_");

    return {
      id: docId,
      student_id: String(student.student_id || "").trim(),
      student_name: studentName,
      class_id: classId,
      class_name: String(academyClass.class_code || classId).trim(),
      session_date: String(lesson.lesson_date || "").trim(),
      status: String(entry.status || "").trim().toLowerCase(),
      lesson_id: String(entry.lesson_id || "").trim(),
      lesson_title: String(lesson.lesson_title || "").trim(),
      timestamp: String(entry.timestamp || "").trim()
    };
  });

  for (const academyClass of academyClasses) {
    if (academyClass.id) {
      await writeDocument(baseUrl, "academyClasses", academyClass.id, toAcademyClassDocument(academyClass), accessToken);
    }
  }

  for (const student of academyStudents) {
    if (student.id) {
      await writeDocument(baseUrl, "academyStudents", student.id, toAcademyStudentDocument(student), accessToken);
    }
  }

  for (const entry of academyAttendance) {
    if (entry.id) {
      await writeDocument(baseUrl, "academyAttendance", entry.id, toAcademyAttendanceDocument(entry), accessToken);
    }
  }

  return {
    spreadsheetId: source.spreadsheetId,
    classes: academyClasses.length,
    students: academyStudents.length,
    attendanceRows: academyAttendance.length
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

async function deleteDocument(baseUrl, collection, id, accessToken) {
  const url = `${baseUrl}/${collection}/${encodeURIComponent(id)}`;
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

async function listCollectionDocuments(collection, pageSize = 500) {
  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();
  const documents = [];
  let pageToken = "";
  let guard = 0;

  while (guard < 1000) {
    const pageTokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
    const url = `${baseUrl}/${collection}?pageSize=${pageSize}${pageTokenParam}`;
    const result = await fetchJson(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    documents.push(...(result.documents || []));
    pageToken = String(result.nextPageToken || "").trim();
    if (!pageToken) {
      break;
    }

    guard += 1;
  }

  return documents;
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

  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();
  const url = `${baseUrl}/pastors/${encodeURIComponent(pastorId)}`;

  let current = {};
  const existingResponse = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (existingResponse.ok) {
    const existingDoc = await existingResponse.json();
    current = mapPastorDocument(existingDoc);
  } else if (existingResponse.status !== 404) {
    const errorText = await existingResponse.text();
    throw new Error(`Unable to load pastor before update (HTTP ${existingResponse.status}): ${errorText}`);
  }

  const currentNeedsReview = String(current.needs_review || "").toLowerCase() === "true";

  const payload = {
    id: pastorId,
    name: String(input.name ?? current.name ?? "").trim(),
    first_name: String(input.first_name ?? current.first_name ?? "").trim(),
    last_name: String(input.last_name ?? current.last_name ?? "").trim(),
    title: String(input.title ?? current.title ?? "").trim(),
    aliases: String(input.aliases ?? current.aliases ?? "").trim(),
    church_name: String(input.church_name ?? current.church_name ?? "").trim(),
    city: String(input.city ?? current.city ?? "").trim(),
    phone: String(input.phone ?? current.phone ?? "").trim(),
    email: String(input.email ?? current.email ?? "").trim(),
    academy_class: String(input.academy_class ?? current.academy_class ?? "").trim(),
    class_number: String(input.class_number ?? current.class_number ?? "").trim(),
    cell_number: String(input.cell_number ?? current.cell_number ?? "").trim(),
    current_mission: String(input.current_mission ?? current.current_mission ?? "").trim(),
    notes: String(input.notes ?? current.notes ?? "").trim(),
    source_variants: String(input.source_variants ?? current.source_variants ?? "").trim(),
    meeting_count: String(input.meeting_count ?? current.meeting_count ?? "0").trim(),
    first_meeting_date: String(input.first_meeting_date ?? current.first_meeting_date ?? "").trim(),
    last_meeting_date: String(input.last_meeting_date ?? current.last_meeting_date ?? "").trim(),
    source: String(input.source ?? current.source ?? "google_calendar").trim(),
    needs_review: String(Boolean(input.needs_review ?? currentNeedsReview)),
    last_reviewed_at: new Date().toISOString(),
    gmcs_summit_status: String(input.gmcs_summit_status ?? current.gmcs_summit_status ?? "").trim(),
    gmcs_summit_note: String(input.gmcs_summit_note ?? current.gmcs_summit_note ?? "").trim()
  };

  await writeDocument(baseUrl, "pastors", pastorId, toPastorDocument(payload), accessToken);
  return payload;
}

/**
 * Patch only the GMCS summit fields on a pastor document (no other fields touched).
 */
async function patchPastorSummitStatus(pastorId, status, note) {
  const id = String(pastorId || "").trim();
  if (!id) throw new Error("Missing pastor id.");
  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();
  const mask = "updateMask.fieldPaths=gmcsSummitStatus&updateMask.fieldPaths=gmcsSummitNote";
  const url = `${baseUrl}/pastors/${encodeURIComponent(id)}?${mask}`;
  return fetchJson(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        gmcsSummitStatus: stringValue(String(status || "")),
        gmcsSummitNote: stringValue(String(note || ""))
      }
    })
  });
}

/**
 * Clear the churchName field on an academy class document (moves it back to core academy).
 */
async function clearAcademyClassChurchName(classId) {
  const id = String(classId || "").trim();
  if (!id) throw new Error("Missing class id.");
  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();

  async function patchChurchNameByDocId(docId) {
    // currentDocument.exists=true avoids creating accidental documents when docId is not canonical.
    const mask = "updateMask.fieldPaths=churchName&currentDocument.exists=true";
    const url = `${baseUrl}/academyClasses/${encodeURIComponent(docId)}?${mask}`;
    return fetchJson(url, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { churchName: stringValue("") } })
    });
  }

  // Fallback: classId may be sent as class code or class name from UI/source data.
  const key = String(id)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  const classDocs = await listCollectionDocuments("academyClasses", 500);
  const matchingClasses = classDocs
    .map(mapAcademyClassDocument)
    .filter((academyClass) => {
      const candidates = [academyClass.id, academyClass.class_code, academyClass.name]
        .map((value) =>
          String(value || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .trim()
        )
        .filter(Boolean);
      return candidates.includes(key);
    });

  const resolvedClass = matchingClasses.sort((left, right) => {
    const leftHasChurch = Boolean(String(left.church_name || "").trim());
    const rightHasChurch = Boolean(String(right.church_name || "").trim());
    if (leftHasChurch !== rightHasChurch) return rightHasChurch ? 1 : -1;
    const leftCanonical = /^cls_/i.test(String(left.id || ""));
    const rightCanonical = /^cls_/i.test(String(right.id || ""));
    if (leftCanonical !== rightCanonical) return rightCanonical ? 1 : -1;
    return String(left.id || "").localeCompare(String(right.id || ""), "fr");
  })[0];

  if (!resolvedClass?.id) {
    throw new Error(`Academy class not found for identifier: ${id}`);
  }

  return patchChurchNameByDocId(resolvedClass.id);
}

/**
 * Patch only the GMCS summit fields on a student document.
 */
async function patchStudentSummitStatus(studentId, status, note) {
  const id = String(studentId || "").trim();
  if (!id) throw new Error("Missing student id.");
  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();
  const mask = "updateMask.fieldPaths=gmcsSummitStatus&updateMask.fieldPaths=gmcsSummitNote";
  const url = `${baseUrl}/academyStudents/${encodeURIComponent(id)}?${mask}`;
  return fetchJson(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        gmcsSummitStatus: stringValue(String(status || "")),
        gmcsSummitNote: stringValue(String(note || ""))
      }
    })
  });
}

/**
 * Create a minimal pastor document if no pastor with that name already exists.
 * Used by the bot when recording a meeting to ensure the pastor has a fiche.
 *
 * @param {string} pastorName   - Canonical pastor name inferred from the meeting
 * @param {string} meetingDate  - YYYY-MM-DD date of the meeting
 */
async function upsertPastorIfMissing(pastorName, meetingDate) {
  const name = String(pastorName || "").trim();
  if (!name) return;

  const pastorId = "pastor_" + name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();
  const url = `${baseUrl}/pastors/${encodeURIComponent(pastorId)}`;

  // Check if this pastor document already exists
  const existing = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (existing.status !== 404) {
    // Already exists (or an unexpected error) — leave it untouched
    return { created: false };
  }

  // Create a minimal stub — all non-name fields left blank; needs_review = true
  // so the team knows to complete the fiche.
  const stub = {
    id: pastorId,
    name,
    first_name: "",
    last_name: "",
    title: "",
    aliases: "",
    church_name: "",
    city: "",
    phone: "",
    email: "",
    academy_class: "",
    class_number: "",
    cell_number: "",
    current_mission: "",
    notes: "",
    source_variants: "",
    meeting_count: "1",
    first_meeting_date: String(meetingDate || ""),
    last_meeting_date: String(meetingDate || ""),
    source: "mannam_bot",
    needs_review: "true",
    last_reviewed_at: ""
  };

  await writeDocument(baseUrl, "pastors", pastorId, toPastorDocument(stub), accessToken);
  return { created: true, pastorId };
}

// Fields that are managed manually (via patchMeetingDocument or the bot) and
// must NOT be overwritten when re-syncing a meeting that already exists.
const MEETING_PROTECTED_FIELDS = [
  "memberIds",
  "memberNamesCanonical",
  "memberMatchStatus",
  "memberUnmatchedNames",
  "pastorName",
  "cooperationStatus",
  "followUpNote",
  "updatedAt",
  "calendarEventId"
];

// Fields written by the calendar/sheet sync — always safe to overwrite.
const MEETING_SYNC_FIELDS = [
  "memberId",
  "memberName",
  "memberNameRaw",
  "meetingDate",
  "reportDate",
  "month",
  "zone",
  "calendarLogged",
  "source",
  "eventSummary",
  "eventDescription",
  "eventLocation"
];

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

  // Load existing Firestore meetings once to decide per-meeting write strategy.
  const existingMeetingDocs = await listCollectionDocuments("meetings");
  const existingMeetingsById = new Map();
  for (const doc of existingMeetingDocs) {
    const parsed = parseFirestoreDocument(doc);
    existingMeetingsById.set(parsed.id, parsed.fields);
  }

  const incomingIds = new Set(payload.meetings.map((item) => item.id).filter(Boolean));

  for (const item of payload.meetings) {
    if (!item.id) continue;

    const existingFields = existingMeetingsById.get(item.id);

    if (!existingFields) {
      // New meeting — write everything.
      await writeDocument(baseUrl, "meetings", item.id, item.doc, accessToken);
      continue;
    }

    // Existing meeting — check whether any protected field is already populated.
    const hasProtectedData = MEETING_PROTECTED_FIELDS.some((fieldName) => {
      const val = firestoreValueToJs(existingFields[fieldName]);
      if (Array.isArray(val)) return val.length > 0;
      return Boolean(val);
    });

    if (!hasProtectedData) {
      // No protected data yet — safe to replace entirely.
      await writeDocument(baseUrl, "meetings", item.id, item.doc, accessToken);
      continue;
    }

    // Protected data exists — only update the "calendar/sheet" fields.
    const partialFields = {};
    for (const fieldName of MEETING_SYNC_FIELDS) {
      if (item.doc.fields[fieldName] !== undefined) {
        partialFields[fieldName] = item.doc.fields[fieldName];
      }
    }
    const maskParams = MEETING_SYNC_FIELDS
      .filter((f) => partialFields[f] !== undefined)
      .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
      .join("&");
    const url = `${baseUrl}/meetings/${encodeURIComponent(item.id)}?${maskParams}`;
    await fetchJson(url, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: partialFields })
    });
  }

  // Delete orphan calendar meetings — those that were synced from the calendar
  // previously but no longer appear in the current calendar export.
  let deletedMeetings = 0;
  for (const [id, fields] of existingMeetingsById) {
    if (incomingIds.has(id)) continue;
    const source = String(firestoreValueToJs(fields.source) || "").trim();
    const calendarLogged = firestoreValueToJs(fields.calendarLogged);
    if (source === "google_calendar" || calendarLogged === true) {
      await deleteDocument(baseUrl, "meetings", id, accessToken);
      deletedMeetings += 1;
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
    deletedOrphanMeetings: deletedMeetings,
    trainingSessions: payload.trainingSessions.length,
    pastors: payload.pastors.length
  };
}

// ---------------------------------------------------------------------------
// Attendance events (attendanceEvents / attendanceCategories / attendanceParticipants)
// ---------------------------------------------------------------------------

async function listAttendanceEvents() {
  const docs = await listCollectionDocuments("attendanceEvents", 500);
  return docs
    .map((doc) => {
      const { id, fields } = parseFirestoreDocument(doc);
      return {
        event_id: id,
        event_name: String(firestoreValueToJs(fields.eventName) || "").trim(),
        date: String(firestoreValueToJs(fields.date) || "").trim(),
        description: String(firestoreValueToJs(fields.description) || "").trim()
      };
    })
    .filter((e) => e.event_name)
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function listAttendanceCategories() {
  const DEFAULT_CATEGORIES = ["Staff", "Guest", "Member", "Pastor"];
  const docs = await listCollectionDocuments("attendanceCategories", 200);
  if (!docs.length) {
    return DEFAULT_CATEGORIES.map((name) => ({ category_id: slugify(name), category_name: name }));
  }
  return docs
    .map((doc) => {
      const { id, fields } = parseFirestoreDocument(doc);
      return {
        category_id: id,
        category_name: String(firestoreValueToJs(fields.name) || "").trim()
      };
    })
    .filter((c) => c.category_name)
    .sort((a, b) => a.category_name.localeCompare(b.category_name));
}

async function listEventAttendance(eventName) {
  const target = String(eventName || "").trim().toLowerCase();
  const docs = await listCollectionDocuments("attendanceParticipants", 2000);
  return docs
    .map((doc) => {
      const { fields } = parseFirestoreDocument(doc);
      return {
        event_name: String(firestoreValueToJs(fields.eventName) || "").trim(),
        participant_name: String(firestoreValueToJs(fields.participantName) || "").trim(),
        category: String(firestoreValueToJs(fields.category) || "").trim(),
        timestamp: String(firestoreValueToJs(fields.timestamp) || "").trim()
      };
    })
    .filter((row) => row.event_name.toLowerCase() === target && row.participant_name)
    .sort((a, b) => a.participant_name.toLowerCase().localeCompare(b.participant_name.toLowerCase()));
}

async function addAttendanceParticipants(eventName, participants, category) {
  const existing = await listEventAttendance(eventName);
  const existingNames = new Set(existing.map((r) => r.participant_name.toLowerCase()));
  const baseUrl = getFirestoreBaseUrl();
  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const added = [];
  for (const name of participants) {
    const clean = String(name || "").trim();
    if (!clean || existingNames.has(clean.toLowerCase())) continue;
    const docId = `${slugify(eventName)}__${slugify(clean)}`;
    await writeDocument(baseUrl, "attendanceParticipants", docId, {
      fields: {
        eventName: { stringValue: String(eventName).trim() },
        participantName: { stringValue: clean },
        category: { stringValue: String(category || "Guest").trim() },
        timestamp: { stringValue: utcTimestamp() }
      }
    }, accessToken);
    added.push(clean);
    existingNames.add(clean.toLowerCase());
  }
  return added;
}

async function removeAttendanceParticipant(eventName, participantName) {
  const docId = `${slugify(eventName)}__${slugify(participantName)}`;
  const baseUrl = getFirestoreBaseUrl();
  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  try {
    await deleteDocument(baseUrl, "attendanceParticipants", docId, accessToken);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Academy read queries (filtered by classId / studentName)
// ---------------------------------------------------------------------------

async function getAcademyClassByCode(code) {
  const query = String(code || "").trim().toLowerCase();
  const docs = await listCollectionDocuments("academyClasses", 500);
  for (const doc of docs) {
    const cls = mapAcademyClassDocument(doc);
    const codeMatch =
      String(cls.name || "").toLowerCase() === query ||
      String(cls.class_code || "").toLowerCase() === query ||
      String(cls.instructor_name || "").toLowerCase().includes(query);
    if (codeMatch) return cls;
  }
  return null;
}

// ---------------------------------------------------------------------------
// runQuery — Firestore structured query (server-side filter).
// Much cheaper than listCollectionDocuments + JS filter for large collections.
// ---------------------------------------------------------------------------

async function runQuery(collectionId, where) {
  const projectId = getEnv("FIRESTORE_PROJECT_ID");
  const databaseId = getEnv("FIRESTORE_DATABASE_ID", "(default)");
  const url =
    `https://firestore.googleapis.com/v1/projects/${projectId}` +
    `/databases/${databaseId}/documents:runQuery`;

  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const body = {
    structuredQuery: {
      from: [{ collectionId }],
      where: {
        fieldFilter: {
          field: { fieldPath: where.field },
          op: where.op || "EQUAL",
          value: { stringValue: String(where.value) }
        }
      },
      limit: where.limit || 3000
    }
  };

  const results = await fetchJson(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  // runQuery returns an array; each element has a `document` key (or empty if no match)
  return (Array.isArray(results) ? results : [])
    .map((r) => r.document)
    .filter(Boolean);
}

async function listAcademyLessonsForClass(classId) {
  const cid = String(classId || "").trim();
  const docs = await runQuery("academyLessons", { field: "classId", value: cid });
  return docs
    .map((doc) => {
      const { id, fields } = parseFirestoreDocument(doc);
      return {
        lesson_id: id,
        class_id: String(firestoreValueToJs(fields.classId) || "").trim(),
        lesson_title: String(firestoreValueToJs(fields.lessonTitle) || "").trim(),
        lesson_date: String(
          firestoreValueToJs(fields.lessonDate) ||
          firestoreValueToJs(fields.sessionDate) || ""
        ).trim(),
        created_at: String(firestoreValueToJs(fields.createdAt) || "").trim()
      };
    })
    .sort((a, b) => a.lesson_date.localeCompare(b.lesson_date));
}

async function listAcademyStudentsForClass(classId) {
  const cid = String(classId || "").trim();
  const docs = await runQuery("academyStudents", { field: "classId", value: cid });
  return docs
    .filter((doc) => !isAcademyStudentDeletedDocument(doc))
    .map(mapAcademyStudentDocument)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function listAcademyAttendanceForClass(classId) {
  const cid = String(classId || "").trim();
  const docs = await runQuery("academyAttendance", { field: "classId", value: cid });
  return docs.map(mapAcademyAttendanceDocument);
}

async function listAcademyAttendanceForStudent(studentName) {
  const name = String(studentName || "").trim();
  const docs = await runQuery("academyAttendance", { field: "studentName", value: name });
  return docs
    .map(mapAcademyAttendanceDocument)
    .sort((a, b) => a.session_date.localeCompare(b.session_date));
}

// ---------------------------------------------------------------------------
// Meeting list + patch
// ---------------------------------------------------------------------------

async function listMeetingDocuments() {
  const docs = await listCollectionDocuments("meetings", 2000);
  return docs.map(mapMeetingDocument);
}

async function patchMeetingDocument(meetingId, patch) {
  const id = String(meetingId || "").trim();
  if (!id) throw new Error("meetingId is required");

  // Build a partial Firestore document — only the fields being patched
  const fields = {};

  if (patch.member_ids !== undefined) {
    const ids = Array.isArray(patch.member_ids) ? patch.member_ids : String(patch.member_ids || "").split(",").map((s) => s.trim()).filter(Boolean);
    fields.memberIds = arrayStringValue(ids);
  }
  if (patch.member_names_canonical !== undefined) {
    const names = Array.isArray(patch.member_names_canonical) ? patch.member_names_canonical : String(patch.member_names_canonical || "").split(",").map((s) => s.trim()).filter(Boolean);
    fields.memberNamesCanonical = arrayStringValue(names);
  }
  if (patch.member_match_status !== undefined) {
    fields.memberMatchStatus = stringValue(patch.member_match_status);
  }
  if (patch.member_unmatched_names !== undefined) {
    const unmatched = Array.isArray(patch.member_unmatched_names) ? patch.member_unmatched_names : String(patch.member_unmatched_names || "").split(",").map((s) => s.trim()).filter(Boolean);
    fields.memberUnmatchedNames = arrayStringValue(unmatched);
  }
  if (patch.cooperation_status !== undefined) {
    fields.cooperationStatus = stringValue(patch.cooperation_status);
  }
  if (patch.follow_up_note !== undefined) {
    fields.followUpNote = stringValue(patch.follow_up_note);
  }
  if (patch.pastor_name !== undefined) {
    fields.pastorName = stringValue(patch.pastor_name);
  }

  fields.updatedAt = stringValue(utcTimestamp());

  // Build updateMask so Firestore only touches these fields — all other
  // fields on the document are preserved (true partial update).
  const fieldPaths = Object.keys(fields);
  const maskParams = fieldPaths.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join("&");

  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();
  const url = `${baseUrl}/meetings/${encodeURIComponent(id)}?${maskParams}`;
  await fetchJson(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ fields })
  });
}

// ---------------------------------------------------------------------------
// Meeting delete
// ---------------------------------------------------------------------------

async function deleteMeetingDocument(meetingId) {
  const id = String(meetingId || "").trim();
  if (!id) throw new Error("meetingId is required");
  const baseUrl = getFirestoreBaseUrl();
  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  await deleteDocument(baseUrl, "meetings", id, accessToken);
}

async function deleteMeetingByCalendarEventId(calendarEventId) {
  const id = String(calendarEventId || "").trim();
  if (!id) throw new Error("calendarEventId is required");

  const baseUrl = getFirestoreBaseUrl();
  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);

  const result = await fetchJson(`${baseUrl}:runQuery`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "meetings" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "calendarEventId" },
            op: "EQUAL",
            value: { stringValue: id }
          }
        },
        limit: 1
      }
    })
  });

  const match = Array.isArray(result) ? result.find((r) => r.document) : null;
  if (!match) return; // aucun document trouvé — rien à supprimer

  // name = "projects/.../documents/meetings/{docId}"
  const docId = match.document.name.split("/").pop();
  await deleteDocument(baseUrl, "meetings", docId, accessToken);
}

// ---------------------------------------------------------------------------
// Pre-computed aggregates (aggregates/dashboard)
//
// Instead of scanning all collections on every dashboard load (O(N) reads),
// we maintain a single pre-computed document `aggregates/dashboard` that is
// updated whenever a write occurs.  Dashboard reads this first; falls back to
// full scan only when the aggregate doc is absent.
//
// Schema:
//   totalMembers   integerValue
//   totalMeetings  integerValue
//   totalLessons   integerValue
//   lastUpdated    stringValue  (ISO timestamp)
// ---------------------------------------------------------------------------

async function readDashboardAggregate() {
  if (!hasFirestoreConfig()) return null;
  try {
    const baseUrl = getFirestoreBaseUrl();
    const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
    const url = `${baseUrl}/aggregates/dashboard`;
    const result = await fetchJson(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!result || !result.fields) return null;
    const { fields } = result;
    return {
      totalMembers: Number(firestoreValueToJs(fields.totalMembers) || 0),
      totalMeetings: Number(firestoreValueToJs(fields.totalMeetings) || 0),
      totalLessons: Number(firestoreValueToJs(fields.totalLessons) || 0),
      lastUpdated: String(firestoreValueToJs(fields.lastUpdated) || "")
    };
  } catch {
    return null; // aggregate doc may not exist yet — caller falls back to full scan
  }
}

async function refreshDashboardAggregate() {
  if (!hasFirestoreConfig()) return;
  try {
    const [memberDocs, meetingDocs, lessonDocs] = await Promise.all([
      listCollectionDocuments("members", 2000),
      listCollectionDocuments("meetings", 2000),
      listCollectionDocuments("academyLessons", 2000)
    ]);
    const baseUrl = getFirestoreBaseUrl();
    const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
    await writeDocument(
      baseUrl,
      "aggregates",
      "dashboard",
      {
        fields: {
          totalMembers: { integerValue: String(memberDocs.length) },
          totalMeetings: { integerValue: String(meetingDocs.length) },
          totalLessons: { integerValue: String(lessonDocs.length) },
          lastUpdated: { stringValue: utcTimestamp() }
        }
      },
      accessToken
    );
  } catch (err) {
    // Non-critical: log but don't fail the write that triggered this
    console.error("[firestore] refreshDashboardAggregate failed:", err.message || err);
  }
}

module.exports = {
  buildFirestoreDocuments,
  getFirestoreConfigSummary,
  hasFirestoreConfig,
  loadAcademyDataFromFirestore,
  createAcademyLessonRecord,
  deleteAcademyLessonRecordById,
  deleteAcademyLessonRecord,
  replaceAcademyLessonRecord,
  updateAcademyStudent,
  loadDashboardDataFromFirestore,
  loadPastorsFromFirestore,
  syncAcademySheetToFirestore,
  syncSheetsToFirestore,
  testFirestoreConnection,
  updatePastorInFirestore,
  clearAcademyClassChurchName,
  patchPastorSummitStatus,
  patchStudentSummitStatus,
  upsertPastorIfMissing,
  // Attendance events
  listAttendanceEvents,
  listAttendanceCategories,
  listEventAttendance,
  addAttendanceParticipants,
  removeAttendanceParticipant,
  // Academy reads
  getAcademyClassByCode,
  listAcademyLessonsForClass,
  listAcademyStudentsForClass,
  listAcademyAttendanceForClass,
  listAcademyAttendanceForStudent,
  // Meeting list + patch + delete
  listMeetingDocuments,
  patchMeetingDocument,
  deleteMeetingDocument,
  deleteMeetingByCalendarEventId,
  deleteAcademyStudent,
  mergeAcademyStudents,
  deleteEmptyAcademyClasses,
  // Aggregates
  readDashboardAggregate,
  refreshDashboardAggregate
};

