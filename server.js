const http = require("http");
const fs = require("fs");
const path = require("path");
const { buildDashboard } = require("./lib/dashboard");
const { hasGoogleSheetsConfig, loadGoogleSheetsData } = require("./lib/sheets");

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
