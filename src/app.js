const express = require("express");
const path = require("path");
const { loadLocalEnv } = require("../lib/env");
const { sessionAuth } = require("./middleware/auth");
const { apiKeyAuth } = require("./middleware/apiKey");
const { csrfProtection } = require("./middleware/csrf");
const { errorHandler } = require("./middleware/errorHandler");
const { requestLogger } = require("./middleware/logger");
const { securityHeaders } = require("./middleware/securityHeaders");
const { canManageUsers } = require("../lib/auth");

// Routes
const authRoutes = require("./routes/auth.routes");
const usersRoutes = require("./routes/users.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const pastorsRoutes = require("./routes/pastors.routes");
const academyRoutes = require("./routes/academy.routes");
const adminRoutes = require("./routes/admin.routes");
const botRoutes = require("./routes/bot.routes");
const meetingsRoutes = require("./routes/meetings.routes");

loadLocalEnv();

const app = express();
const PUBLIC_DIR = path.join(__dirname, "..", "public");

// ---------------------------------------------------------------------------
// Core middleware
// ---------------------------------------------------------------------------
app.use(securityHeaders);
app.use(requestLogger);
app.use(express.json({ limit: "1mb" }));
app.use(sessionAuth);
app.use(apiKeyAuth);
app.use(csrfProtection);

// Disable HTTP caching for all API responses
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// ---------------------------------------------------------------------------
// Health check — no auth, no logging overhead, probed by Cloud Run
// ---------------------------------------------------------------------------
app.get("/health", (req, res) => {
  res.json({ ok: true, uptime: Math.floor(process.uptime()) });
});

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/pastors", pastorsRoutes);
app.use("/api/academy", academyRoutes);
app.use("/api/bot", botRoutes);
app.use("/api/meetings", meetingsRoutes);
app.use("/api", adminRoutes);

// Catch-all for unknown API routes
app.all("/api/{*splat}", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ---------------------------------------------------------------------------
// Static file serving with auth guards
// ---------------------------------------------------------------------------

// Auth guard for HTML pages
app.use((req, res, next) => {
  if (!req.path.endsWith(".html") && req.path !== "/") {
    return next();
  }

  const requestedPath = req.path === "/" ? "/index.html" : req.path;
  const sessionUser = req.sessionUser;

  // Redirect logged-in users away from login
  if (requestedPath === "/login.html" && sessionUser) {
    return res.redirect(302, "/");
  }

  // Require auth for all pages except login
  if (requestedPath !== "/login.html" && !sessionUser) {
    return res.redirect(302, "/login.html");
  }

  // Restrict users page and personality-links to managers+
  if (
    (requestedPath === "/users.html" || requestedPath === "/personality-links.html") &&
    sessionUser && !canManageUsers(sessionUser)
  ) {
    return res.redirect(302, "/");
  }

  next();
});

// Static assets
app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, filePath) {
    res.set("Cache-Control", "no-store");
  }
}));

// ---------------------------------------------------------------------------
// Error handler (must be last)
// ---------------------------------------------------------------------------
app.use(errorHandler);

module.exports = app;
