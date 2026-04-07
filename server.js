const app = require("./src/app");
const config = require("./src/config");
const { log } = require("./src/middleware/logger");

// Validate environment before accepting traffic
config.validate();

const server = app.listen(config.PORT, () => {
  log("info", `server started on port ${config.PORT}`, { port: config.PORT });
});

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
