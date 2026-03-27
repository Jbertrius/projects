const { fetchJson, getAccessToken, getEnv } = require("./google-auth");
const { clearSheetRange, ensureGoogleSheetsStructure, fetchSheetRange, updateSheetValues } = require("./sheets");
const { buildMemberDirectory, resolveMeetingMembers } = require("./member-matching");
const { buildPastorsSheetRows, resolvePastorBatch } = require("./pastor-normalization");

const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const GOOGLE_CALENDAR_BASE_URL = "https://www.googleapis.com/calendar/v3";
const DEFAULT_MEETINGS_RANGE = "meetings!A1:Z";
const MEETINGS_HEADERS = [
  "id",
  "member_id",
  "member_name",
  "member_name_raw",
  "member_ids",
  "member_names_canonical",
  "member_match_status",
  "member_unmatched_names",
  "pastor_name_raw",
  "pastor_name",
  "pastor_title",
  "pastor_id",
  "pastor_resolution_method",
  "pastor_needs_review",
  "meeting_date",
  "report_date",
  "month",
  "zone",
  "calendar_logged",
  "event_summary",
  "event_description",
  "event_location",
  "source"
];
const PASTORS_HEADERS = [
  "id",
  "name",
  "first_name",
  "last_name",
  "title",
  "aliases",
  "church_name",
  "city",
  "phone",
  "email",
  "notes",
  "source_variants",
  "meeting_count",
  "first_meeting_date",
  "last_meeting_date",
  "source",
  "needs_review",
  "last_reviewed_at"
];

function toColumnLetter(index) {
  let dividend = index;
  let columnName = "";

  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    columnName = String.fromCharCode(65 + modulo) + columnName;
    dividend = Math.floor((dividend - modulo) / 26);
  }

  return columnName;
}

function getCalendarId() {
  return getEnv("GOOGLE_CALENDAR_ID", "primary");
}

function getTimeWindow() {
  const pastDays = Number(getEnv("GOOGLE_CALENDAR_PAST_DAYS", "180")) || 180;
  const futureDays = Number(getEnv("GOOGLE_CALENDAR_FUTURE_DAYS", "30")) || 30;
  const now = new Date();
  const timeMin = new Date(now);
  const timeMax = new Date(now);
  timeMin.setDate(now.getDate() - pastDays);
  timeMax.setDate(now.getDate() + futureDays);
  return {
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString()
  };
}

function extractTaggedValue(text, labels) {
  const normalizedText = String(text || "");
  for (const label of labels) {
    const regex = new RegExp(`${label}\\s*[:=-]\\s*(.+)`, "i");
    const match = normalizedText.match(regex);
    if (match && match[1]) {
      return match[1].split(/\r?\n/)[0].trim();
    }
  }
  return "";
}

function parseEventDate(event) {
  return event.start?.dateTime || event.start?.date || event.created || "";
}

function formatMonth(value) {
  if (!value) {
    return "";
  }
  return new Date(value).toLocaleDateString("fr-FR", { month: "short", year: "numeric" });
}

function mapCalendarEventToMeetingRow(event) {
  const description = event.description || "";
  const summary = event.summary || "";
  const organizerName = event.organizer?.displayName || event.organizer?.email || "";
  const startValue = parseEventDate(event);

  const memberId = extractTaggedValue(description, ["member_id", "membre_id", "member id"]);
  const memberName =
    extractTaggedValue(description, [
      "mannamjas?",
      "member_name",
      "membre",
      "reported_by",
      "evangeliste"
    ]) || organizerName;
  const pastorName =
    extractTaggedValue(description, ["pastor_name", "pasteur", "pastor"]) || summary || "Rencontre";
  const zone = extractTaggedValue(description, ["zone", "ville"]) || event.location || "";

  return {
    id: event.id || "",
    member_id: memberId,
    member_name: memberName,
    member_name_raw: memberName,
    member_ids: "",
    member_names_canonical: "",
    member_match_status: "",
    member_unmatched_names: "",
    pastor_name_raw: pastorName,
    pastor_name: pastorName,
    pastor_title: "",
    pastor_id: "",
    pastor_resolution_method: "",
    pastor_needs_review: "false",
    meeting_date: startValue,
    report_date: event.updated || event.created || "",
    month: formatMonth(startValue),
    zone,
    calendar_logged: "true",
    event_summary: summary,
    event_description: description,
    event_location: event.location || "",
    source: "google_calendar"
  };
}

function enrichMeetingRowsWithMembers(rows, members) {
  const directory = buildMemberDirectory(members);

  return rows.map((row) => {
    const resolution = resolveMeetingMembers(row.member_name_raw || row.member_name || "", directory);
    const matchedIds = resolution.matched.map((item) => item.id).join(", ");
    const matchedNames = resolution.matched.map((item) => item.name).join(", ");
    const unmatchedNames = resolution.unmatched.join(", ");

    return {
      ...row,
      member_id: resolution.matched.length === 1 ? resolution.matched[0].id : row.member_id || "",
      member_name: matchedNames || row.member_name || row.member_name_raw || "",
      member_ids: matchedIds,
      member_names_canonical: matchedNames,
      member_match_status: resolution.status,
      member_unmatched_names: unmatchedNames
    };
  });
}

function enrichMeetingRowsWithPastors(rows, pastorResolutions) {
  return rows.map((row) => {
    const resolution = pastorResolutions.get(row.pastor_name_raw || row.pastor_name || "") || {};
    return {
      ...row,
      pastor_name: resolution.canonicalName || "",
      pastor_title: resolution.title || "",
      pastor_id: resolution.pastorId || "",
      pastor_resolution_method: resolution.method || "unresolved",
      pastor_needs_review: String(Boolean(resolution.needsReview || !resolution.canonicalName))
    };
  });
}

async function listCalendarEvents() {
  const accessToken = await getAccessToken([GOOGLE_CALENDAR_SCOPE]);
  const calendarId = encodeURIComponent(getCalendarId());
  const { timeMin, timeMax } = getTimeWindow();
  const url =
    `${GOOGLE_CALENDAR_BASE_URL}/calendars/${calendarId}/events` +
    `?singleEvents=true&orderBy=startTime&maxResults=2500&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`;

  const payload = await fetchJson(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  return {
    calendarId: getCalendarId(),
    items: payload.items || []
  };
}

async function listAccessibleCalendars() {
  const accessToken = await getAccessToken([GOOGLE_CALENDAR_SCOPE]);
  const url = `${GOOGLE_CALENDAR_BASE_URL}/users/me/calendarList`;
  const payload = await fetchJson(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  return (payload.items || []).map((item) => ({
    id: item.id,
    summary: item.summary,
    description: item.description || "",
    primary: Boolean(item.primary),
    accessRole: item.accessRole || ""
  }));
}

async function syncCalendarToMeetingsSheet() {
  const spreadsheetId = getEnv("GOOGLE_SPREADSHEET_ID");
  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SPREADSHEET_ID.");
  }

  await ensureGoogleSheetsStructure();

  const accessToken = await getAccessToken([
    "https://www.googleapis.com/auth/spreadsheets",
    GOOGLE_CALENDAR_SCOPE
  ]);

  const { items } = await listCalendarEvents();
  const mappedRows = items.map(mapCalendarEventToMeetingRow).filter((row) => row.id);
  const membersRows = await fetchSheetRange(
    spreadsheetId,
    getEnv("GOOGLE_SHEET_MEMBERS_RANGE", "members!A1:Z"),
    accessToken
  );
  const existingPastors = await fetchSheetRange(spreadsheetId, "pastors!A1:Z", accessToken);
  const memberEnrichedRows = enrichMeetingRowsWithMembers(mappedRows, membersRows);
  const pastorResolutions = await resolvePastorBatch(
    memberEnrichedRows.map((row) => row.pastor_name_raw || row.pastor_name || ""),
    existingPastors
  );
  const mergedRows = enrichMeetingRowsWithPastors(memberEnrichedRows, pastorResolutions).sort((a, b) =>
    String(b.meeting_date || "").localeCompare(String(a.meeting_date || ""))
  );
  const pastorsRows = buildPastorsSheetRows(mergedRows, existingPastors);

  const values = [
    MEETINGS_HEADERS,
    ...mergedRows.map((row) => MEETINGS_HEADERS.map((header) => row[header] ?? ""))
  ];
  const pastorsValues = [
    PASTORS_HEADERS,
    ...pastorsRows.map((row) => PASTORS_HEADERS.map((header) => row[header] ?? ""))
  ];

  await clearSheetRange(spreadsheetId, "meetings!A:Z", accessToken);
  await updateSheetValues(
    spreadsheetId,
    `meetings!A1:${toColumnLetter(MEETINGS_HEADERS.length)}${values.length}`,
    values,
    accessToken
  );
  await clearSheetRange(spreadsheetId, "pastors!A:Z", accessToken);
  await updateSheetValues(
    spreadsheetId,
    `pastors!A1:${toColumnLetter(PASTORS_HEADERS.length)}${pastorsValues.length}`,
    pastorsValues,
    accessToken
  );

  return {
    calendarId: getCalendarId(),
    importedEvents: mappedRows.length,
    totalMeetingsRows: mergedRows.length,
    deducedPastors: pastorsRows.length,
    matchedRows: mergedRows.filter((row) => ["exact", "fuzzy", "partial"].includes(row.member_match_status)).length,
    unmatchedRows: mergedRows.filter((row) => row.member_match_status === "unmatched").length,
    pastorReviewRows: mergedRows.filter((row) => row.pastor_needs_review === "true").length
  };
}

module.exports = {
  listAccessibleCalendars,
  listCalendarEvents,
  syncCalendarToMeetingsSheet
};
