const { fetchJson, getAccessToken, getEnv } = require("./google-auth");

const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const GOOGLE_CALENDAR_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar";
const GOOGLE_CALENDAR_BASE_URL = "https://www.googleapis.com/calendar/v3";

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

async function deleteCalendarEvent(eventId) {
  const id = String(eventId || "").trim();
  if (!id) throw new Error("eventId is required");
  const accessToken = await getAccessToken([GOOGLE_CALENDAR_WRITE_SCOPE]);
  const calendarId = encodeURIComponent(getCalendarId());
  const url = `${GOOGLE_CALENDAR_BASE_URL}/calendars/${calendarId}/events/${encodeURIComponent(id)}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  // 204 = success, 404 = already gone — both are acceptable
  if (!response.ok && response.status !== 404) {
    const message = await response.text().catch(() => "");
    throw new Error(`Google Calendar DELETE ${response.status}: ${message}`);
  }
}

module.exports = {
  deleteCalendarEvent,
  listAccessibleCalendars,
  listCalendarEvents
};
