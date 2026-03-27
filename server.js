const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadLocalEnv } = require("./lib/env");
const { buildDashboard } = require("./lib/dashboard");
const {
  hasGoogleSheetsConfig,
  loadGoogleSheetsData,
  getGoogleSheetsConfigSummary
} = require("./lib/sheets");
const {
  buildFirestoreDocuments,
  getFirestoreConfigSummary,
  hasFirestoreConfig,
  syncSheetsToFirestore,
  testFirestoreConnection
} = require("./lib/firestore");
const {
  listAccessibleCalendars,
  listCalendarEvents,
  syncCalendarToMeetingsSheet
} = require("./lib/calendar");

loadLocalEnv();

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_FILE = path.join(__dirname, "data", "dashboard.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": MIME_TYPES[".json"] });
  res.end(JSON.stringify(payload));
}

function readLocalDashboard() {
  const content = fs.readFileSync(DATA_FILE, "utf8");
  return JSON.parse(content);
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(res, 500, { error: "Unable to read file." });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(content);
  });
}

async function handleApi(req, res) {
  if (req.url === "/api/connection-status") {
    sendJson(res, 200, {
      googleSheetsConfigured: hasGoogleSheetsConfig(),
      firestoreConfigured: hasFirestoreConfig(),
      config: {
        sheets: getGoogleSheetsConfigSummary(),
        firestore: getFirestoreConfigSummary()
      }
    });
    return;
  }

  if (req.url === "/api/test/google-sheets") {
    try {
      if (!hasGoogleSheetsConfig()) {
        sendJson(res, 400, {
          ok: false,
          error: "Google Sheets is not configured.",
          config: getGoogleSheetsConfigSummary()
        });
        return;
      }

      const sheetsData = await loadGoogleSheetsData();
      sendJson(res, 200, {
        ok: true,
        config: getGoogleSheetsConfigSummary(),
        counts: {
          members: sheetsData.members.length,
          meetings: sheetsData.meetings.length,
          trainingSessions: sheetsData.trainingSessions.length
        },
        sample: {
          member: sheetsData.members[0] || null,
          meeting: sheetsData.meetings[0] || null,
          trainingSession: sheetsData.trainingSessions[0] || null
        }
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error.message,
        config: getGoogleSheetsConfigSummary()
      });
    }
    return;
  }

  if (req.url === "/api/test/google-calendar") {
    try {
      const payload = await listCalendarEvents();
      sendJson(res, 200, {
        ok: true,
        calendarId: payload.calendarId,
        count: payload.items.length,
        sample: payload.items[0] || null
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error.message
      });
    }
    return;
  }

  if (req.url === "/api/test/google-calendar-list") {
    try {
      const calendars = await listAccessibleCalendars();
      sendJson(res, 200, {
        ok: true,
        calendars
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error.message
      });
    }
    return;
  }

  if (req.url === "/api/sync/calendar-to-sheets") {
    try {
      const result = await syncCalendarToMeetingsSheet();
      sendJson(res, 200, {
        ok: true,
        ...result
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error.message
      });
    }
    return;
  }

  if (req.url === "/api/test/firestore") {
    try {
      if (!hasFirestoreConfig()) {
        sendJson(res, 400, {
          ok: false,
          error: "Firestore is not configured.",
          config: getFirestoreConfigSummary()
        });
        return;
      }

      const result = await testFirestoreConnection();
      sendJson(res, 200, {
        ok: true,
        ...result
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error.message,
        config: getFirestoreConfigSummary()
      });
    }
    return;
  }

  if (req.url === "/api/preview/firestore") {
    try {
      const sheetsData = await loadGoogleSheetsData();
      const preview = buildFirestoreDocuments(sheetsData);
      sendJson(res, 200, {
        ok: true,
        config: getFirestoreConfigSummary(),
        counts: {
          members: preview.members.length,
          meetings: preview.meetings.length,
          trainingSessions: preview.trainingSessions.length
        },
        sample: {
          member: preview.members[0] || null,
          meeting: preview.meetings[0] || null,
          trainingSession: preview.trainingSessions[0] || null
        }
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error.message,
        config: getFirestoreConfigSummary()
      });
    }
    return;
  }

  if (req.url === "/api/sync/firestore") {
    try {
      const result = await syncSheetsToFirestore();
      sendJson(res, 200, {
        ok: true,
        config: getFirestoreConfigSummary(),
        ...result
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error.message,
        config: getFirestoreConfigSummary()
      });
    }
    return;
  }

  if (req.url !== "/api/dashboard") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  try {
    if (hasGoogleSheetsConfig()) {
      const sheetsData = await loadGoogleSheetsData();
      sendJson(res, 200, buildDashboard(sheetsData));
      return;
    }

    sendJson(res, 200, readLocalDashboard());
  } catch (error) {
    sendJson(res, 500, {
      error: "Unable to load dashboard data.",
      details: error.message
    });
  }
}

function handleStatic(req, res) {
  const requestedPath = req.url === "/" ? "/index.html" : req.url;
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    serveFile(res, filePath);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/")) {
    await handleApi(req, res);
    return;
  }

  handleStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
