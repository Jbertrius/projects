/**
 * Background job: suggest pastor ↔ academy student cross-links.
 *
 * Instead of writing links directly, this job creates "suggestions" in the
 * `personalityLinkSuggestions` collection. An admin reviews them on the
 * dedicated validation page before any link is actually written.
 *
 * A suggestion is skipped when:
 *   - The pair already has an approved/rejected suggestion
 *   - The pastor already has a confirmed studentId
 *   - The student already has a confirmed pastorId
 *
 * Matching strategy (in order of confidence):
 *   1. "exact"  — normalized names are identical
 *   2. "prefix" — one sorted-token set is a leading subset of the other
 *                 (handles "Jean DUPONT" vs "Jean Paul DUPONT")
 */

const {
  loadAcademyDataFromFirestore,
  loadPastorsFromFirestore,
  createPersonalityLinkSuggestion
} = require("../../lib/firestore");
const { normalizeName } = require("../../lib/member-matching");
const { log } = require("../middleware/logger");

const JOB_NAME = "link-pastors-to-students";

function nameKey(value) {
  return normalizeName(value).split(/\s+/).sort().join(" ");
}

function matchType(a, b) {
  if (!a || !b) return null;
  const ka = nameKey(a);
  const kb = nameKey(b);
  if (!ka || !kb) return null;
  if (ka === kb) return "exact";
  const shorter = ka.length <= kb.length ? ka : kb;
  const longer  = ka.length <= kb.length ? kb : ka;
  if (longer.startsWith(shorter + " ")) return "prefix";
  return null;
}

async function linkPastorsToStudentsJob() {
  log("info", `${JOB_NAME}: starting`);

  const [pastors, academyData] = await Promise.all([
    loadPastorsFromFirestore(),
    loadAcademyDataFromFirestore()
  ]);

  const students = (academyData.students || []).filter((s) => !s.deleted_at && !s.deletedAt);

  let scanned = 0;
  let suggested = 0;
  let skipped = 0;

  for (const pastor of pastors) {
    scanned += 1;

    // Already confirmed — skip.
    if (pastor.student_id) { skipped += 1; continue; }

    const pastorNorm = normalizeName(pastor.name || "");
    if (!pastorNorm) { skipped += 1; continue; }

    let matchedStudent = null;
    let confidence = null;

    for (const student of students) {
      if (student.pastor_id) continue; // already linked to another pastor
      const type = matchType(pastor.name, student.name);
      if (type) {
        matchedStudent = student;
        confidence = type;
        break;
      }
    }

    if (!matchedStudent) { skipped += 1; continue; }

    try {
      await createPersonalityLinkSuggestion({
        pastorId:    pastor.id,
        pastorName:  pastor.name,
        studentId:   matchedStudent.id,
        studentName: matchedStudent.name,
        confidence
      });
      suggested += 1;
      log("info", `${JOB_NAME}: suggested "${pastor.name}" ↔ "${matchedStudent.name}" (${confidence})`);
    } catch (err) {
      // Duplicate key = suggestion already exists — silently skip.
      if (!String(err.message || "").includes("already exists")) {
        log("warn", `${JOB_NAME}: could not create suggestion`, { error: err.message });
      } else {
        skipped += 1;
      }
    }
  }

  log("info", `${JOB_NAME}: done`, { scanned, suggested, skipped });
  return { scanned, suggested, skipped };
}

module.exports = { linkPastorsToStudentsJob };
