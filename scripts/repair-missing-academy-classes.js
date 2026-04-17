/**
 * Scan all Firestore collections (academyStudents, academyLessons, academyAttendance)
 * for class IDs that have no corresponding document in academyClasses, then create them.
 *
 * Usage:
 *   node scripts/repair-missing-academy-classes.js            # dry-run (report only)
 *   node scripts/repair-missing-academy-classes.js --fix      # create missing class docs
 */

"use strict";

const { loadLocalEnv } = require("../lib/env");
const { getAccessToken, fetchJson, getEnv } = require("../lib/google-auth");

loadLocalEnv();

const FIX_MODE = process.argv.includes("--fix");
const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";

function getBaseUrl() {
  const projectId = getEnv("FIRESTORE_PROJECT_ID");
  const databaseId = getEnv("FIRESTORE_DATABASE_ID") || "(default)";
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents`;
}

async function listAll(baseUrl, collection, accessToken, pageSize = 500) {
  const docs = [];
  let pageToken = "";
  let guard = 0;
  while (guard < 1000) {
    const url = `${baseUrl}/${collection}?pageSize=${pageSize}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const result = await fetchJson(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    docs.push(...(result.documents || []));
    pageToken = String(result.nextPageToken || "").trim();
    if (!pageToken) break;
    guard++;
  }
  return docs;
}

function strVal(v) {
  if (!v) return "";
  if (typeof v === "object" && v.stringValue !== undefined) return String(v.stringValue || "");
  if (typeof v === "object" && v.integerValue !== undefined) return String(v.integerValue || "");
  return String(v || "");
}

function docId(doc) {
  return (doc.name || "").split("/").pop();
}

function stringValue(s) {
  return { stringValue: String(s || "") };
}

function booleanValue(b) {
  return { booleanValue: Boolean(b) };
}

function arrayStringValue(arr) {
  return { arrayValue: { values: (arr || []).map((s) => ({ stringValue: String(s) })) } };
}

function buildClassDocument(classId, name) {
  return {
    fields: {
      name: stringValue(name || classId),
      classCode: stringValue(name || classId),
      churchName: stringValue(""),
      churchPastorName: stringValue(""),
      isMissionary: booleanValue(false),
      instructorName: stringValue(""),
      sheetTab: stringValue(""),
      studentIds: arrayStringValue([])
    }
  };
}

async function main() {
  const baseUrl = getBaseUrl();
  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);

  console.log("Chargement des collections Firestore...\n");

  const [classDocs, studentDocs, lessonDocs, attendanceDocs] = await Promise.all([
    listAll(baseUrl, "academyClasses", accessToken),
    listAll(baseUrl, "academyStudents", accessToken, 3000),
    listAll(baseUrl, "academyLessons", accessToken, 2000),
    listAll(baseUrl, "academyAttendance", accessToken, 2000)
  ]);

  console.log(`academyClasses   : ${classDocs.length} documents`);
  console.log(`academyStudents  : ${studentDocs.length} documents`);
  console.log(`academyLessons   : ${lessonDocs.length} documents`);
  console.log(`academyAttendance: ${attendanceDocs.length} documents\n`);

  // Build set of existing class document IDs
  const existingClassIds = new Set(classDocs.map(docId));

  // Collect all referenced class IDs with the best display name we can find
  // Map: classId → best name string
  const referencedClasses = new Map();

  for (const doc of studentDocs) {
    const fields = doc.fields || {};
    const cid = strVal(fields.classId || fields.class_id);
    if (!cid) continue;
    const name = strVal(fields.className || fields.class_name || fields.classId || fields.class_id);
    if (!referencedClasses.has(cid) || name) {
      referencedClasses.set(cid, name || cid);
    }
  }

  for (const doc of lessonDocs) {
    const fields = doc.fields || {};
    const cid = strVal(fields.classId || fields.class_id);
    if (!cid) continue;
    const name = strVal(fields.className || fields.class_name || fields.classCode || fields.class_code || fields.classId);
    if (!referencedClasses.has(cid) && name) {
      referencedClasses.set(cid, name || cid);
    }
  }

  for (const doc of attendanceDocs) {
    const fields = doc.fields || {};
    const cid = strVal(fields.classId || fields.class_id);
    if (!cid) continue;
    const name = strVal(fields.className || fields.class_name || fields.classId);
    if (!referencedClasses.has(cid) && name) {
      referencedClasses.set(cid, name || cid);
    }
  }

  // Find orphaned class IDs
  const missing = [];
  for (const [cid, name] of referencedClasses) {
    if (!existingClassIds.has(cid)) {
      missing.push({ id: cid, name });
    }
  }

  if (!missing.length) {
    console.log("✓ Tous les class IDs references ont un document academyClasses correspondant.");
    console.log("\nClasses existantes :");
    [...existingClassIds].sort().forEach((id) => {
      const doc = classDocs.find((d) => docId(d) === id);
      const name = doc ? strVal((doc.fields || {}).name) : id;
      console.log(`  ${id}  →  ${name}`);
    });
    return;
  }

  console.log(`⚠  ${missing.length} class ID(s) references mais sans document academyClasses :\n`);
  missing.sort((a, b) => a.id.localeCompare(b.id)).forEach(({ id, name }) => {
    console.log(`  ${id}  →  nom derive: "${name}"`);
  });

  if (!FIX_MODE) {
    console.log("\n[DRY-RUN] Aucun document cree. Relancez avec --fix pour creer les classes manquantes.");
    return;
  }

  console.log("\nCreation des documents manquants...");
  let created = 0;
  let failed = 0;

  for (const { id, name } of missing) {
    const url = `${baseUrl}/academyClasses/${encodeURIComponent(id)}`;
    try {
      await fetchJson(url, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildClassDocument(id, name))
      });
      console.log(`  ✓ Cree : ${id}  (nom: "${name}")`);
      created++;
    } catch (err) {
      console.error(`  ✗ Echec : ${id}  →  ${err.message}`);
      failed++;
    }
  }

  console.log(`\nTermine : ${created} cree(s), ${failed} echec(s).`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Erreur fatale :", err.message || err);
  process.exit(1);
});
