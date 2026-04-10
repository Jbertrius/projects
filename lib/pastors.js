const { getAccessToken, getEnv } = require("./google-auth");
const { clearSheetRange, ensureGoogleSheetsStructure, fetchSheetRange, updateSheetValues } = require("./sheets");

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
  "academy_class",
  "class_number",
  "cell_number",
  "current_mission",
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

async function loadPastorsSheet() {
  const spreadsheetId = getEnv("GOOGLE_SPREADSHEET_ID");
  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SPREADSHEET_ID.");
  }

  const accessToken = await getAccessToken(["https://www.googleapis.com/auth/spreadsheets"]);
  await ensureGoogleSheetsStructure();
  const rows = await fetchSheetRange(spreadsheetId, "pastors!A1:Z", accessToken);

  return rows.sort((a, b) => {
    const meetingDelta = Number(b.meeting_count || 0) - Number(a.meeting_count || 0);
    if (meetingDelta !== 0) {
      return meetingDelta;
    }
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

async function savePastorsSheet(rows) {
  const spreadsheetId = getEnv("GOOGLE_SPREADSHEET_ID");
  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SPREADSHEET_ID.");
  }

  const accessToken = await getAccessToken(["https://www.googleapis.com/auth/spreadsheets"]);
  await ensureGoogleSheetsStructure();

  const values = [
    PASTORS_HEADERS,
    ...rows.map((row) => PASTORS_HEADERS.map((header) => row[header] ?? ""))
  ];

  await clearSheetRange(spreadsheetId, "pastors!A:Z", accessToken);
  await updateSheetValues(
    spreadsheetId,
    `pastors!A1:${toColumnLetter(PASTORS_HEADERS.length)}${values.length}`,
    values,
    accessToken
  );
}

async function updatePastorRecord(input) {
  const pastors = await loadPastorsSheet();
  const pastorId = String(input.id || "").trim();
  if (!pastorId) {
    throw new Error("Missing pastor id.");
  }

  const index = pastors.findIndex((row) => String(row.id || "").trim() === pastorId);
  if (index === -1) {
    throw new Error(`Pastor "${pastorId}" not found.`);
  }

  const current = pastors[index];
  pastors[index] = {
    ...current,
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
    needs_review: String(Boolean(input.needs_review ?? String(current.needs_review).toLowerCase() === "true")),
    last_reviewed_at: new Date().toISOString()
  };

  await savePastorsSheet(pastors);
  return pastors[index];
}

module.exports = {
  loadPastorsSheet,
  updatePastorRecord
};
