const { listMeetingDocuments, patchMeetingDocument, deleteMeetingDocument, hasFirestoreConfig, loadDashboardDataFromFirestore } = require("../../lib/firestore");
const { buildMemberDirectory, resolveMeetingMembers } = require("../../lib/member-matching");

/**
 * Return all meeting records enriched with full member resolution context.
 */
async function findAll() {
  if (!hasFirestoreConfig()) return [];

  const [meetingDocs, dashboardData] = await Promise.all([
    listMeetingDocuments(),
    loadDashboardDataFromFirestore()
  ]);
  const meetings = meetingDocs;
  const members = dashboardData.members || [];

  const directory = buildMemberDirectory(members);
  const memberById = new Map(members.map((m) => [String(m.id), m]));

  const enriched = meetings.map((meeting) => {
    const matchedIds = String(meeting.member_ids || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const resolvedMembers = matchedIds
      .map((id) => memberById.get(id))
      .filter(Boolean)
      .map((m) => ({ id: m.id, name: m.name, zone: m.zone || "" }));

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

  return enriched.sort((a, b) => String(b.meeting_date || "").localeCompare(String(a.meeting_date || "")));
}

async function patch(meetingId, fields) {
  if (!hasFirestoreConfig()) {
    throw new Error("Firestore n'est pas configure.");
  }
  await patchMeetingDocument(meetingId, fields);
}

async function remove(meetingId) {
  if (!hasFirestoreConfig()) {
    throw new Error("Firestore n'est pas configure.");
  }
  await deleteMeetingDocument(meetingId);
}

module.exports = { findAll, patch, remove };
