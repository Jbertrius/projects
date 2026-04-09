#!/usr/bin/env node
/**
 * Firestore schema integrity checker and migrator.
 *
 * Scans all key collections for documents that use legacy field names and
 * optionally patches them to the current canonical schema.
 *
 * Usage:
 *   node scripts/check-firestore-schema.js            # dry-run (report only)
 *   node scripts/check-firestore-schema.js --fix      # apply patches
 *   node scripts/check-firestore-schema.js --fix --collection meetings
 *
 * Environment:
 *   FIRESTORE_PROJECT_ID, FIRESTORE_DATABASE_ID, GOOGLE_SERVICE_ACCOUNT_KEY
 *   (same variables used by the main app)
 *
 * Exit codes:
 *   0 — no issues found (or all patched successfully)
 *   1 — issues found in dry-run mode
 *   2 — one or more patches failed
 */

"use strict";

try { require("dotenv").config(); } catch (_) { /* dotenv optional */ }

const { getAccessToken, fetchJson, getEnv } = require("../lib/google-auth");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const FIX_MODE = process.argv.includes("--fix");
const COLLECTION_FILTER = (() => {
  const idx = process.argv.indexOf("--collection");
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";

function getBaseUrl() {
  const projectId = getEnv("FIRESTORE_PROJECT_ID");
  const databaseId = getEnv("FIRESTORE_DATABASE_ID", "(default)");
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents`;
}

// ---------------------------------------------------------------------------
// Known field migrations: { collection, oldField, newField, transform? }
// transform(oldValue) → newValue — defaults to identity (same value, new key)
// ---------------------------------------------------------------------------
const MIGRATIONS = [
  // meetings: bot used to write summary/location/description instead of eventSummary/etc.
  {
    collection: "meetings",
    checks: [
      { oldField: "summary",          newField: "eventSummary" },
      { oldField: "location",         newField: "eventLocation" },
      { oldField: "description",      newField: "eventDescription" },
      { oldField: "participantNames", newField: "memberNamesCanonical" }
    ],
    // A meeting doc needs migration if it has ANY old field AND is missing the new field
    needsMigration: (fields) =>
      (fields.summary && !fields.eventSummary) ||
      (fields.location && !fields.eventLocation) ||
      (fields.description && !fields.eventDescription) ||
      (fields.participantNames && !fields.memberNamesCanonical),
    buildPatch: (fields) => {
      const patch = {};
      if (fields.summary && !fields.eventSummary) {
        patch.eventSummary = fields.summary;
      }
      if (fields.location && !fields.eventLocation) {
        patch.eventLocation = fields.location;
      }
      if (fields.description && !fields.eventDescription) {
        patch.eventDescription = fields.description;
      }
      if (fields.participantNames && !fields.memberNamesCanonical) {
        patch.memberNamesCanonical = fields.participantNames;
      }
      // Derive month from meetingDate if missing
      if (!fields.month && fields.meetingDate) {
        const dateStr = String(fields.meetingDate.stringValue || "").trim();
        if (dateStr.length >= 7) {
          patch.month = { stringValue: dateStr.slice(0, 7) };
        }
      }
      return patch;
    }
  },
  // academyAttendance: old code wrote sessionDate; new code writes lessonDate
  {
    collection: "academyAttendance",
    checks: [
      { oldField: "sessionDate", newField: "lessonDate" }
    ],
    needsMigration: (fields) => fields.sessionDate && !fields.lessonDate,
    buildPatch: (fields) => ({
      lessonDate: fields.sessionDate
    })
  },
  // academyLessonUnregistered: same sessionDate → lessonDate migration
  {
    collection: "academyLessonUnregistered",
    checks: [
      { oldField: "sessionDate", newField: "lessonDate" }
    ],
    needsMigration: (fields) => fields.sessionDate && !fields.lessonDate,
    buildPatch: (fields) => ({
      lessonDate: fields.sessionDate
    })
  }
];

// ---------------------------------------------------------------------------
// Firestore REST helpers
// ---------------------------------------------------------------------------
async function listAll(baseUrl, collection, accessToken) {
  const docs = [];
  let pageToken = "";
  let guard = 0;
  while (guard < 50) {
    const url = `${baseUrl}/${collection}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const result = await fetchJson(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    docs.push(...(result.documents || []));
    pageToken = String(result.nextPageToken || "").trim();
    if (!pageToken) break;
    guard++;
  }
  return docs;
}

async function patchDocument(docName, fieldPatches, accessToken) {
  // Use the PATCH endpoint with updateMask to add/overwrite only the specified fields
  const fieldPaths = Object.keys(fieldPatches).map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join("&");
  const url = `https://firestore.googleapis.com/v1/${docName}?${fieldPaths}`;
  await fetchJson(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ fields: fieldPatches })
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const baseUrl = getBaseUrl();
  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);

  let totalIssues = 0;
  let totalPatched = 0;
  let totalFailed = 0;

  for (const migration of MIGRATIONS) {
    if (COLLECTION_FILTER && migration.collection !== COLLECTION_FILTER) continue;

    console.log(`\n── ${migration.collection} ──────────────────────────────`);
    let docs;
    try {
      docs = await listAll(baseUrl, migration.collection, accessToken);
    } catch (err) {
      console.error(`  ERROR: could not list ${migration.collection}: ${err.message}`);
      continue;
    }

    console.log(`  Scanned ${docs.length} document(s)`);

    const stale = docs.filter((doc) => {
      const fields = doc.fields || {};
      return migration.needsMigration(fields);
    });

    if (stale.length === 0) {
      console.log("  ✓ No schema issues found");
      continue;
    }

    totalIssues += stale.length;
    console.log(`  ⚠ ${stale.length} document(s) with legacy field names:`);

    for (const doc of stale) {
      const shortName = doc.name.split("/").pop();
      const fields = doc.fields || {};
      const legacyFields = migration.checks
        .filter((c) => fields[c.oldField] && !fields[c.newField])
        .map((c) => `${c.oldField} → ${c.newField}`)
        .join(", ");

      if (FIX_MODE) {
        const patch = migration.buildPatch(fields);
        try {
          await patchDocument(doc.name, patch, accessToken);
          console.log(`    PATCHED  ${shortName}  [${legacyFields}]`);
          totalPatched++;
        } catch (err) {
          console.error(`    FAILED   ${shortName}  ${err.message}`);
          totalFailed++;
        }
      } else {
        console.log(`    DRY-RUN  ${shortName}  [${legacyFields}]`);
      }
    }
  }

  console.log("\n══════════════════════════════════════════");
  if (FIX_MODE) {
    console.log(`Summary: ${totalIssues} issues found, ${totalPatched} patched, ${totalFailed} failed`);
  } else {
    console.log(`Summary (dry-run): ${totalIssues} document(s) with legacy field names`);
    if (totalIssues > 0) {
      console.log("Run with --fix to apply patches.");
    }
  }
  console.log("══════════════════════════════════════════\n");

  if (totalFailed > 0) process.exit(2);
  if (!FIX_MODE && totalIssues > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err.message || err);
  process.exit(2);
});
