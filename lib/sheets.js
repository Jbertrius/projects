const {
  fetchJson,
  getAccessToken,
  getEnv
} = require("./google-auth");

const GOOGLE_OAUTH_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const GOOGLE_SHEETS_BASE_URL = "https://sheets.googleapis.com/v4/spreadsheets";
const DEFAULT_MEMBERS_RANGE = "members!A1:Z";
const DEFAULT_MEETINGS_RANGE = "meetings!A1:Z";
const DEFAULT_TRAINING_RANGE = "training!A1:Z";

const EXPECTED_SHEETS = [
  {
    title: "members",
    headers: ["id", "name", "zone", "department_role", "status", "aliases"]
  },
  {
    title: "meetings",
    headers: [
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
    ]
  },
  {
    title: "pastors",
    headers: [
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
    ]
  },
  {
    title: "training",
    headers: [
      "id",
      "member_id",
      "member_name",
      "cohort",
      "week",
      "attendance",
      "completed",
      "completion_score",
      "enrolled"
    ]
  }
];

function csvToRows(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  const [headers, ...rows] = values;
  return rows.map((row) =>
    headers.reduce((acc, header, index) => {
      acc[String(header || "").trim()] = row[index] ?? "";
      return acc;
    }, {})
  );
}

async function fetchSheetRange(spreadsheetId, range, accessToken) {
  if (!range) {
    return [];
  }

  const encodedRange = encodeURIComponent(range);
  const url = `${GOOGLE_SHEETS_BASE_URL}/${spreadsheetId}/values/${encodedRange}`;

  const payload = await fetchJson(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  return csvToRows(payload.values || []);
}

async function updateSheetValues(spreadsheetId, range, values, accessToken) {
  const encodedRange = encodeURIComponent(range);
  const url = `${GOOGLE_SHEETS_BASE_URL}/${spreadsheetId}/values/${encodedRange}?valueInputOption=RAW`;

  return fetchJson(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ values })
  });
}

async function clearSheetRange(spreadsheetId, range, accessToken) {
  const encodedRange = encodeURIComponent(range);
  const url = `${GOOGLE_SHEETS_BASE_URL}/${spreadsheetId}/values/${encodedRange}:clear`;

  return fetchJson(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });
}

async function batchUpdateSpreadsheet(spreadsheetId, requests, accessToken) {
  const url = `${GOOGLE_SHEETS_BASE_URL}/${spreadsheetId}:batchUpdate`;

  return fetchJson(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ requests })
  });
}

async function getSpreadsheetMetadata(spreadsheetId, accessToken) {
  const url = `${GOOGLE_SHEETS_BASE_URL}/${spreadsheetId}?fields=sheets.properties`;
  return fetchJson(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

function hasGoogleSheetsConfig() {
  return Boolean(
    getEnv("GOOGLE_SPREADSHEET_ID") &&
      (
        (getEnv("GOOGLE_CLIENT_EMAIL") && getEnv("GOOGLE_PRIVATE_KEY")) ||
        getEnv("GOOGLE_SERVICE_ACCOUNT_JSON") ||
        getEnv("GOOGLE_SERVICE_ACCOUNT_JSON_PATH")
      )
  );
}

function getGoogleSheetsConfigSummary() {
  return {
    spreadsheetId: Boolean(getEnv("GOOGLE_SPREADSHEET_ID")),
    clientEmail: Boolean(getEnv("GOOGLE_CLIENT_EMAIL")),
    privateKey: Boolean(getEnv("GOOGLE_PRIVATE_KEY")),
    serviceAccountJson: Boolean(getEnv("GOOGLE_SERVICE_ACCOUNT_JSON")),
    serviceAccountJsonPath: Boolean(getEnv("GOOGLE_SERVICE_ACCOUNT_JSON_PATH")),
    membersRange: getEnv("GOOGLE_SHEET_MEMBERS_RANGE", DEFAULT_MEMBERS_RANGE),
    meetingsRange: getEnv("GOOGLE_SHEET_MEETINGS_RANGE", DEFAULT_MEETINGS_RANGE),
    trainingRange: getEnv("GOOGLE_SHEET_TRAINING_RANGE", "")
  };
}

async function loadGoogleSheetsData() {
  const spreadsheetId = getEnv("GOOGLE_SPREADSHEET_ID");
  const membersRange = getEnv("GOOGLE_SHEET_MEMBERS_RANGE", DEFAULT_MEMBERS_RANGE);
  const meetingsRange = getEnv("GOOGLE_SHEET_MEETINGS_RANGE", DEFAULT_MEETINGS_RANGE);
  const trainingRange = getEnv("GOOGLE_SHEET_TRAINING_RANGE", "");

  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SPREADSHEET_ID.");
  }

  const accessToken = await getAccessToken([GOOGLE_OAUTH_SCOPE]);
  let members;
  let meetings;
  let trainingSessions;

  try {
    [members, meetings, trainingSessions] = await Promise.all([
      fetchSheetRange(spreadsheetId, membersRange, accessToken),
      fetchSheetRange(spreadsheetId, meetingsRange, accessToken),
      fetchSheetRange(spreadsheetId, trainingRange, accessToken)
    ]);
  } catch (error) {
    if (trainingRange && error.message.includes(`Unable to parse range: ${trainingRange}`)) {
      throw new Error(
        `The training sheet range "${trainingRange}" does not exist. Set GOOGLE_SHEET_TRAINING_RANGE to an existing tab like "formation!A1:Z", or leave it empty for now.`
      );
    }

    if (membersRange && error.message.includes(`Unable to parse range: ${membersRange}`)) {
      throw new Error(
        `The members sheet range "${membersRange}" does not exist. Update GOOGLE_SHEET_MEMBERS_RANGE to the real tab name in your spreadsheet.`
      );
    }

    if (meetingsRange && error.message.includes(`Unable to parse range: ${meetingsRange}`)) {
      throw new Error(
        `The meetings sheet range "${meetingsRange}" does not exist. Update GOOGLE_SHEET_MEETINGS_RANGE to the real tab name in your spreadsheet.`
      );
    }

    throw error;
  }

  return {
    meta: {
      policyName: "Evolution des membres",
      period: new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
      refreshLabel: "Synchronisé depuis Google Sheets"
    },
    members,
    meetings,
    trainingSessions
  };
}

async function ensureGoogleSheetsStructure() {
  const spreadsheetId = getEnv("GOOGLE_SPREADSHEET_ID");

  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SPREADSHEET_ID.");
  }

  const accessToken = await getAccessToken([GOOGLE_OAUTH_SCOPE]);
  const metadata = await getSpreadsheetMetadata(spreadsheetId, accessToken);
  const existingTitles = new Set((metadata.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean));

  const missingSheets = EXPECTED_SHEETS.filter((sheet) => !existingTitles.has(sheet.title));

  if (missingSheets.length > 0) {
    await batchUpdateSpreadsheet(
      spreadsheetId,
      missingSheets.map((sheet) => ({
        addSheet: {
          properties: {
            title: sheet.title
          }
        }
      })),
      accessToken
    );
  }

  await Promise.all(
    EXPECTED_SHEETS.map((sheet) =>
      updateSheetValues(
        spreadsheetId,
        `${sheet.title}!A1:${String.fromCharCode(64 + sheet.headers.length)}1`,
        [sheet.headers],
        accessToken
      )
    )
  );

  return {
    spreadsheetId,
    createdSheets: missingSheets.map((sheet) => sheet.title),
    ensuredSheets: EXPECTED_SHEETS.map((sheet) => sheet.title)
  };
}

module.exports = {
  hasGoogleSheetsConfig,
  loadGoogleSheetsData,
  getGoogleSheetsConfigSummary,
  ensureGoogleSheetsStructure,
  fetchSheetRange,
  updateSheetValues,
  clearSheetRange
};
