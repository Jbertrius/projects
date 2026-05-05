const { loadLocalEnv } = require("../lib/env");
const { listCalendarEvents } = require("../lib/calendar");
const { loadDashboardDataFromFirestore } = require("../lib/firestore");
const { getAccessToken, fetchJson, getEnv } = require("../lib/google-auth");

const GOOGLE_CALENDAR_BASE_URL = "https://www.googleapis.com/calendar/v3";
const CAL_SCOPE = "https://www.googleapis.com/auth/calendar";
const FS_SCOPE = "https://www.googleapis.com/auth/datastore";

function parseAndClean(description = "") {
  const lines = String(description || "").split(/\r?\n/);
  let section = "";
  let mannam = "";
  const kept = [];

  for (const raw of lines) {
    const line = raw.trim();

    const sec = line.match(/^Section\s*:\s*(.*)$/i);
    if (sec) {
      const value = (sec[1] || "").trim();
      if (!section && value) {
        section = value;
      }
      continue;
    }

    const mm = line.match(/^Mannamjas\s*:\s*(.*)$/i);
    if (mm) {
      const value = (mm[1] || "").trim();
      if (!mannam && value && !/^section\s*:/i.test(value)) {
        mannam = value;
      }
      continue;
    }

    kept.push(raw);
  }

  const base = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  const rebuiltParts = [];
  if (base) rebuiltParts.push(base);
  if (mannam) rebuiltParts.push(`Mannamjas: ${mannam}`);
  if (section) rebuiltParts.push(`Section: ${section}`);
  const rebuilt = rebuiltParts.join("\n");

  const original = String(description || "");
  const sectionCount = (original.match(/^\s*Section\s*:/gim) || []).length;
  const mannamCount = (original.match(/^\s*Mannamjas\s*:/gim) || []).length;
  const malformed = /^\s*Mannamjas\s*:\s*Section\s*:/im.test(original);
  const emptyMannam = /^\s*Mannamjas\s*:\s*$/im.test(original);
  const needsCleanup = sectionCount > 1 || mannamCount > 1 || malformed || emptyMannam;

  return { rebuilt, section, needsCleanup };
}

function stringValue(value) {
  return { stringValue: String(value ?? "") };
}

function cleanCoreDescription(description) {
  return String(description || "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(Mannamjas|Section)\s*:/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function main() {
  loadLocalEnv();

  const calendarId = encodeURIComponent(getEnv("GOOGLE_CALENDAR_ID", "primary"));
  const calToken = await getAccessToken([CAL_SCOPE]);
  const fsToken = await getAccessToken([FS_SCOPE]);

  const projectId = getEnv("FIRESTORE_PROJECT_ID");
  const databaseId = getEnv("FIRESTORE_DATABASE_ID", "(default)");
  if (!projectId) {
    throw new Error("Missing FIRESTORE_PROJECT_ID.");
  }
  const fsBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents`;

  const cal = await listCalendarEvents();
  const calUpdates = [];

  for (const event of cal.items || []) {
    const before = String(event.description || "");
    const cleaned = parseAndClean(before);

    if (!(cleaned.needsCleanup && before !== cleaned.rebuilt)) {
      continue;
    }

    const url = `${GOOGLE_CALENDAR_BASE_URL}/calendars/${calendarId}/events/${encodeURIComponent(event.id)}`;
    await fetchJson(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${calToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ description: cleaned.rebuilt })
    });

    calUpdates.push({
      id: event.id,
      summary: event.summary || "",
      start: event.start?.dateTime || event.start?.date || ""
    });
  }

  const data = await loadDashboardDataFromFirestore();
  const fsUpdates = [];

  for (const meeting of data.meetings || []) {
    const before = String(meeting.event_description || "");
    const cleaned = parseAndClean(before);

    if (!(cleaned.needsCleanup && before !== cleaned.rebuilt)) {
      continue;
    }

    const docUrl = `${fsBase}/meetings/${encodeURIComponent(meeting.id)}`;
    const updateFields = {
      eventDescription: stringValue(cleanCoreDescription(cleaned.rebuilt)),
      meetingSection: stringValue(cleaned.section || ""),
      updatedAt: stringValue(new Date().toISOString())
    };

    const updateMask = Object.keys(updateFields)
      .map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`)
      .join("&");

    await fetchJson(`${docUrl}?${updateMask}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${fsToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fields: updateFields })
    });

    fsUpdates.push({
      id: meeting.id,
      calendar_event_id: meeting.calendar_event_id || "",
      summary: meeting.event_summary || "",
      date: meeting.meeting_date || "",
      section: cleaned.section || ""
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        calendarUpdated: calUpdates.length,
        firestoreUpdated: fsUpdates.length,
        calendarUpdates: calUpdates,
        firestoreUpdates: fsUpdates
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error.message,
        stack: error.stack
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
