const { getEnv } = require("../../lib/google-auth");

const API_KEYS = {
  attendance_bot: () => getEnv("BOT_API_KEY_ATTENDANCE"),
  mannam_bot: () => getEnv("BOT_API_KEY_MANNAM")
};

function apiKeyAuth(req, res, next) {
  const authHeader = String(req.headers.authorization || "");
  if (!authHeader.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return next();
  }

  for (const [botName, getKey] of Object.entries(API_KEYS)) {
    const key = getKey();
    if (key && token === key) {
      req.botIdentity = { name: botName };
      return next();
    }
  }

  next();
}

function requireBotOrAuth(req, res, next) {
  if (req.botIdentity || req.sessionUser) {
    return next();
  }
  return res.status(401).json({ ok: false, error: "Authentification requise." });
}

module.exports = { apiKeyAuth, requireBotOrAuth };
