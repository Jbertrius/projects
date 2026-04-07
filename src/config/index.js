/**
 * Configuration validation — runs once at startup.
 *
 * Prints clear diagnostics about which integrations are enabled and which
 * required variables are missing, then hard-exits on fatal misconfiguration
 * so the container restarts instead of silently serving broken responses.
 *
 * Usage:
 *   const config = require("./src/config");
 *   config.validate();           // call before app.listen()
 *   const port = config.PORT;    // typed accessors
 */

const { getEnv } = require("../../lib/google-auth");
const { log } = require("../middleware/logger");

// ---------------------------------------------------------------------------
// Typed accessors (avoids process.env string lookups everywhere)
// ---------------------------------------------------------------------------
const PORT        = Number(process.env.PORT) || 8080;
const NODE_ENV    = process.env.NODE_ENV || "development";
const IS_PROD     = NODE_ENV === "production";

// ---------------------------------------------------------------------------
// Feature flags derived from env
// ---------------------------------------------------------------------------
function hasFirestore()    { return Boolean(getEnv("FIRESTORE_PROJECT_ID")); }
function hasSheets()       { return Boolean(getEnv("GOOGLE_SPREADSHEET_ID")); }
function hasCalendar()     { return Boolean(getEnv("GOOGLE_CALENDAR_ID")); }
function hasServiceAcct()  {
  return Boolean(
    getEnv("GOOGLE_SERVICE_ACCOUNT_JSON") ||
    getEnv("GOOGLE_SERVICE_ACCOUNT_JSON_PATH") ||
    (getEnv("GOOGLE_CLIENT_EMAIL") && getEnv("GOOGLE_PRIVATE_KEY"))
  );
}

// ---------------------------------------------------------------------------
// Validation rules
// ---------------------------------------------------------------------------
const RULES = [
  {
    name:    "APP_SESSION_SECRET",
    check:   () => Boolean(getEnv("APP_SESSION_SECRET")),
    level:   "warn",
    message: "APP_SESSION_SECRET not set — session signing will fall back to service account key material."
  },
  {
    name:    "Google service account",
    check:   () => hasServiceAcct() || IS_PROD === false,
    level:   "warn",
    message: "No Google service account credentials found. Firestore and Sheets will not work."
  },
  {
    name:    "Data source",
    check:   () => hasFirestore() || hasSheets(),
    level:   "warn",
    message: "Neither FIRESTORE_PROJECT_ID nor GOOGLE_SPREADSHEET_ID is set. Dashboard will use local JSON fallback."
  },
  {
    name:    "Auth store",
    check:   () => hasFirestore(),
    level:   "warn",
    message: "FIRESTORE_PROJECT_ID not set — user authentication is disabled."
  }
];

// ---------------------------------------------------------------------------
// validate() — call once before app.listen()
// ---------------------------------------------------------------------------
function validate() {
  log("info", "config", {
    env:             NODE_ENV,
    port:            PORT,
    firestoreEnabled: hasFirestore(),
    sheetsEnabled:    hasSheets(),
    calendarEnabled:  hasCalendar(),
    serviceAcct:      hasServiceAcct()
  });

  let warnings = 0;
  for (const rule of RULES) {
    if (!rule.check()) {
      log(rule.level, rule.message);
      if (rule.level === "error") {
        process.exit(1);
      }
      warnings++;
    }
  }

  if (warnings === 0) {
    log("info", "config: all checks passed");
  }
}

module.exports = { validate, PORT, IS_PROD, hasFirestore, hasSheets, hasCalendar };
