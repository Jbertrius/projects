function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Erreur interne du serveur.";

  if (status >= 500) {
    console.error(JSON.stringify({
      level: "error",
      msg: message,
      stack: err.stack,
      path: req.path,
      method: req.method,
      ts: new Date().toISOString()
    }));
  }

  res.status(status).json({
    ok: false,
    error: message,
    ...(err.issues ? { issues: err.issues } : {}),
    ...(err.parsed ? { parsed: err.parsed } : {})
  });
}

class AppError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.issues = extra.issues || null;
    this.parsed = extra.parsed || null;
  }
}

module.exports = { errorHandler, AppError };
