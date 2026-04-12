/**
 * Background job: resolve member identities for bot-submitted meetings.
 *
 * The Mannam bot stores participant names as free-text strings. This job
 * finds meetings whose member resolution is absent or incomplete, runs the
 * name-matching logic against the current member directory, and patches the
 * Firestore document with the resolved IDs and canonical names.
 *
 * Targeted meetings: those where memberMatchStatus is empty, "unmatched", or
 * "partial" AND where at least one raw name exists to attempt.
 *
 * Safe to run repeatedly — already-resolved meetings (status "exact" or
 * "fuzzy" with non-empty memberIds) are skipped.
 */

const { loadDashboardDataFromFirestore, patchMeetingDocument } = require("../../lib/firestore");
const { buildMemberDirectory, resolveMeetingMembers } = require("../../lib/member-matching");
const { log } = require("../middleware/logger");

const JOB_NAME = "resolve-meeting-members";

/**
 * Run one resolution pass over all unresolved/partially-resolved meetings.
 * @returns {Promise<{ scanned: number, updated: number, skipped: number }>}
 */
async function resolveMeetingMembersJob() {
  log("info", `${JOB_NAME}: starting`);

  const data = await loadDashboardDataFromFirestore();
  const directory = buildMemberDirectory(data.members || []);
  const meetings = data.meetings || [];

  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  for (const meeting of meetings) {
    scanned += 1;

    const currentStatus = String(meeting.member_match_status || "").trim();
    const currentIds = String(meeting.member_ids || "").split(",").map((s) => s.trim()).filter(Boolean);

    // Skip meetings already fully resolved.
    if (
      currentIds.length > 0 &&
      (currentStatus === "exact" || currentStatus === "fuzzy")
    ) {
      skipped += 1;
      continue;
    }

    // Build the raw name string: prefer member_name_raw, fall back to
    // member_names_canonical, then member_name.
    const rawName = String(
      meeting.member_name_raw ||
      meeting.member_names_canonical ||
      meeting.member_name ||
      ""
    ).trim();

    if (!rawName) {
      skipped += 1;
      continue;
    }

    const resolution = resolveMeetingMembers(rawName, directory);

    // No improvement — skip to avoid pointless writes.
    if (resolution.matched.length === 0 && currentStatus === "unmatched") {
      skipped += 1;
      continue;
    }

    try {
      await patchMeetingDocument(meeting.id, {
        member_ids:             resolution.matched.map((m) => m.id),
        member_names_canonical: resolution.matched.map((m) => m.name),
        member_match_status:    resolution.status,
        member_unmatched_names: resolution.unmatched
      });
      updated += 1;
    } catch (err) {
      log("warn", `${JOB_NAME}: failed to patch ${meeting.id}`, { error: err.message });
    }
  }

  log("info", `${JOB_NAME}: done`, { scanned, updated, skipped });
  return { scanned, updated, skipped };
}

module.exports = { resolveMeetingMembersJob };
