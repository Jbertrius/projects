/**
 * Structured request logger.
 *
 * Emits JSON to stdout so Cloud Run / Cloud Logging picks it up automatically.
 * Format: { level, msg, method, path, status, durationMs, ts }
 */

function log(level, msg, fields = {}) {
  console.log(
    JSON.stringify({
      level,
      msg,
      ...fields,
      ts: new Date().toISOString()
    })
  );
}

function requestLogger(req, res, next) {
  const start = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    log(level, "request", {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs
    });
  });

  next();
}

module.exports = { log, requestLogger };
