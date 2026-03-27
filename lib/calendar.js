const { fetchJson, getAccessToken, getEnv } = require("./google-auth");
const { fetchSheetRange, updateSheetValues } = require("./sheets");
const { buildMemberDirectory, resolveMeetingMembers } = require("./member-matching");

const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const GOOGLE_CALENDAR_BASE_URL = "https://www.googleapis.com/calendar/v3";
const DEFAULT_MEETINGS_RANGE = "meetings!A1:Z";

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
    pastor_name: pastorName,
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

  const accessToken = await getAccessToken([
    "https://www.googleapis.com/auth/spreadsheets",
    GOOGLE_CALENDAR_SCOPE
  ]);

  const { items } = await listCalendarEvents();
  const mappedRows = items.map(mapCalendarEventToMeetingRow).filter((row) => row.id);

  const existingRows = await fetchSheetRange(
    spreadsheetId,
    getEnv("GOOGLE_SHEET_MEETINGS_RANGE", DEFAULT_MEETINGS_RANGE),
    accessToken
  );
  const membersRows = await fetchSheetRange(
    spreadsheetId,
    getEnv("GOOGLE_SHEET_MEMBERS_RANGE", "members!A1:Z"),
    accessToken
  );

  const existingById = new Map(existingRows.map((row) => [row.id, row]));
  for (const row of mappedRows) {
    existingById.set(row.id, { ...(existingById.get(row.id) || {}), ...row });
  }

  const headers = [
    "id",
    "member_id",
    "member_name",
    "member_name_raw",
    "member_ids",
    "member_names_canonical",
    "member_match_status",
    "member_unmatched_names",
    "pastor_name",
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

  const mergedRows = enrichMeetingRowsWithMembers(Array.from(existingById.values()), membersRows).sort((a, b) =>
    String(b.meeting_date || "").localeCompare(String(a.meeting_date || ""))
  );

  const values = [
    headers,
    ...mergedRows.map((row) => headers.map((header) => row[header] ?? ""))
  ];

  await updateSheetValues(
    spreadsheetId,
    `meetings!A1:R${values.length}`,
    values,
    accessToken
  );

  return {
    calendarId: getCalendarId(),
    importedEvents: mappedRows.length,
    totalMeetingsRows: mergedRows.length,
    matchedRows: mergedRows.filter((row) => ["exact", "fuzzy", "partial"].includes(row.member_match_status)).length,
    unmatchedRows: mergedRows.filter((row) => row.member_match_status === "unmatched").length
  };
}

module.exports = {
  listAccessibleCalendars,
  listCalendarEvents,
  syncCalendarToMeetingsSheet
};
