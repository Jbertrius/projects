const { loadLocalEnv } = require("../lib/env");
const { loadDashboardDataFromFirestore } = require("../lib/firestore");
const { getAccessToken, fetchJson, getEnv } = require("../lib/google-auth");
const { normalizeMeetingRecord, buildExactMeetingKey } = require("../lib/meeting-normalization");

const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";

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

function arrayStringValue(values) {
  return {
    arrayValue: {
      values: (values || []).map((value) => stringValue(value))
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
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
}

function scoreMeetingQuality(meeting) {
  let score = 0;
  if (String(meeting.pastor_name || "").trim()) score += 4;
  if (String(meeting.member_name || "").trim()) score += 3;
  if (String(meeting.member_names_canonical || "").trim()) score += 2;
  if (String(meeting.member_match_status || "").trim()) score += 1;
  if (String(meeting.event_description || "").trim()) score += 1;
  if (String(meeting.event_location || "").trim()) score += 1;
  return score;
}

function chooseCanonicalMeeting(group) {
  return [...group].sort((left, right) => {
    const scoreDelta = scoreMeetingQuality(right) - scoreMeetingQuality(left);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    const sourceDelta = String(left.source || "").localeCompare(String(right.source || ""));
    if (sourceDelta !== 0) {
      return sourceDelta;
    }
    return String(left.id || "").localeCompare(String(right.id || ""));
  })[0];
}

async function main() {
  loadLocalEnv();
  const baseUrl = getFirestoreBaseUrl();
  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const data = await loadDashboardDataFromFirestore();
  const meetings = data.meetings || [];

  const normalizedMeetings = meetings.map((meeting) => normalizeMeetingRecord(meeting));

  const byKey = new Map();
  for (const meeting of normalizedMeetings) {
    const key = buildExactMeetingKey(meeting);
    const bucket = byKey.get(key) || [];
    bucket.push(meeting);
    byKey.set(key, bucket);
  }

  const duplicateGroups = [...byKey.values()].filter((group) => group.length > 1);
  const duplicateIdsToDelete = [];
  for (const group of duplicateGroups) {
    const canonical = chooseCanonicalMeeting(group);
    for (const meeting of group) {
      if (meeting.id !== canonical.id) {
        duplicateIdsToDelete.push(meeting.id);
      }
    }
  }

  const updates = [];
  for (const meeting of normalizedMeetings) {
    if (duplicateIdsToDelete.includes(meeting.id)) {
      continue;
    }
    const original = meetings.find((row) => row.id === meeting.id) || {};
    const changed =
      String(original.meeting_date || "") !== String(meeting.meeting_date || "") ||
      String(original.report_date || "") !== String(meeting.report_date || "") ||
      String(original.month || "") !== String(meeting.month || "") ||
      String(original.pastor_name || "") !== String(meeting.pastor_name || "");

    if (changed) {
      updates.push(meeting);
    }
  }

  for (const meeting of updates) {
    await writeDocument(baseUrl, "meetings", meeting.id, toMeetingDocument(meeting), accessToken);
  }

  for (const id of duplicateIdsToDelete) {
    await deleteDocument(baseUrl, "meetings", id, accessToken);
  }

  const futureMeetings = normalizedMeetings
    .filter((meeting) => /^\d{4}-\d{2}-\d{2}$/.test(String(meeting.meeting_date || "")))
    .filter((meeting) => String(meeting.meeting_date) > "2026-04-10")
    .map((meeting) => ({
      id: meeting.id,
      meeting_date: meeting.meeting_date,
      event_summary: meeting.event_summary,
      member_name: meeting.member_name,
      pastor_name: meeting.pastor_name,
      source: meeting.source
    }));

  console.log(JSON.stringify({
    ok: true,
    totalMeetings: meetings.length,
    updates: updates.length,
    duplicateGroups: duplicateGroups.length,
    deletedDuplicates: duplicateIdsToDelete.length,
    futureMeetingsCount: futureMeetings.length,
    futureMeetings
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, stack: error.stack }, null, 2));
  process.exitCode = 1;
});
