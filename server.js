const app = require("./src/app");
const config = require("./src/config");
const { log } = require("./src/middleware/logger");
const { resolveMeetingMembersJob } = require("./src/jobs/resolve-meeting-members");
const { linkPastorsToStudentsJob } = require("./src/jobs/link-pastors-to-students");
const { hasFirestoreConfig } = require("./lib/firestore");

// Validate environment before accepting traffic
config.validate();

const server = app.listen(config.PORT, () => {
  log("info", `server started on port ${config.PORT}`, { port: config.PORT });
});

// ---------------------------------------------------------------------------
// Background jobs
// ---------------------------------------------------------------------------
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

function scheduleJob(name, fn, intervalMs) {
  if (!hasFirestoreConfig()) return;

  // First run: wait 60 s after boot so the server is fully ready.
  const firstRun = setTimeout(() => {
    fn().catch((err) => log("error", `${name}: first run failed`, { error: err.message }));
  }, 60_000);
  firstRun.unref();

  const recurring = setInterval(() => {
    fn().catch((err) => log("error", `${name}: run failed`, { error: err.message }));
  }, intervalMs);
  recurring.unref();
}

scheduleJob("resolve-meeting-members", resolveMeetingMembersJob, EIGHT_HOURS_MS);
scheduleJob("link-pastors-to-students", linkPastorsToStudentsJob, EIGHT_HOURS_MS);

// ---------------------------------------------------------------------------
// Graceful shutdown — Cloud Run sends SIGTERM before killing the container.
// We stop accepting new connections, let in-flight requests finish (up to
// 10 s), then exit cleanly so the platform can route traffic elsewhere.
// ---------------------------------------------------------------------------
function shutdown(signal) {
  log("info", `${signal} received — shutting down gracefully`);

  server.close((err) => {
    if (err) {
      log("error", "error during shutdown", { error: err.message });
      process.exit(1);
    }
    log("info", "server closed — process exiting");
    process.exit(0);
  });

  // Force-exit if requests do not drain within 10 seconds
  setTimeout(() => {
    log("warn", "shutdown timeout exceeded — forcing exit");
    process.exit(1);
  }, 10_000).unref(); // .unref() so this timer doesn't keep the loop alive
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
