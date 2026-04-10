const { listMeetingDocuments, patchMeetingDocument, hasFirestoreConfig } = require("../../lib/firestore");
const { loadDashboardDataFromFirestore } = require("../../lib/firestore");
const { loadGoogleSheetsData } = require("../../lib/sheets");
const { hasGoogleSheetsConfig } = require("../../lib/sheets");
const { buildMemberDirectory, resolveMeetingMembers } = require("../../lib/member-matching");

/**
 * Return all meeting records enriched with full member resolution context.
 * Each meeting gets:
 *   - resolved member objects (id, name, zone) for matched member_ids
 *   - suggestions for unmatched names (fuzzy candidates from member directory)
 */
async function findAll() {
  let meetings = [];
  let members = [];

  if (hasFirestoreConfig()) {
    const [meetingDocs, dashboardData] = await Promise.all([
      listMeetingDocuments(),
      loadDashboardDataFromFirestore()
    ]);
    meetings = meetingDocs;
    members = dashboardData.members || [];
  } else if (hasGoogleSheetsConfig()) {
    const data = await loadGoogleSheetsData();
    meetings = data.meetings || [];
    members = data.members || [];
  }

  const directory = buildMemberDirectory(members);
  const memberById = new Map(members.map((m) => [String(m.id), m]));

  const enriched = meetings.map((meeting) => {
    // Resolve already-matched member ids to full objects
    const matchedIds = String(meeting.member_ids || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const resolvedMembers = matchedIds
      .map((id) => memberById.get(id))
      .filter(Boolean)
      .map((m) => ({ id: m.id, name: m.name, zone: m.zone || "" }));

    // For unmatched names suggest candidates from directory
    const unmatchedNames = String(meeting.member_unmatched_names || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const suggestions = unmatchedNames.map((rawName) => {
      const resolved = resolveMeetingMembers(rawName, directory);
      return {
        rawName,
        candidates: resolved.matched.map((m) => ({ id: m.id, name: m.name, confidence: m.confidence }))
      };
    });

    return {
      ...meeting,
      resolvedMembers,
      unmatchedSuggestions: suggestions
    };
  });

  // Sort: newest first
  return enriched.sort((a, b) => String(b.meeting_date || "").localeCompare(String(a.meeting_date || "")));
}

/**
 * Patch a meeting document.
 * Supported patch fields:
 *   member_ids, member_names_canonical, member_match_status, member_unmatched_names,
 *   cooperation_status, follow_up_note, pastor_name
 */
async function patch(meetingId, fields) {
  if (!hasFirestoreConfig()) {
    throw new Error("Firestore n'est pas configure.");
  }
  await patchMeetingDocument(meetingId, fields);
}

module.exports = { findAll, patch };
