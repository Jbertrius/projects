const { loadLocalEnv } = require("../lib/env");
const pastorRepo = require("../src/repositories/pastor.repository");
const meetingsRepo = require("../src/repositories/meetings.repository");

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function splitAliases(value) {
  return String(value || "")
    .split(/[|,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

async function main() {
  loadLocalEnv();

  const [pastors, meetings] = await Promise.all([
    pastorRepo.findAll(),
    meetingsRepo.findAll()
  ]);

  const byLookup = new Map();
  const byId = new Map();

  for (const pastor of pastors) {
    const id = String(pastor.id || "").trim();
    if (!id) continue;
    byId.set(id, pastor);

    const values = [pastor.name, ...splitAliases(pastor.aliases), ...splitAliases(pastor.source_variants)];
    for (const value of values) {
      const key = normalize(value);
      if (key && !byLookup.has(key)) {
        byLookup.set(key, id);
      }
    }
  }

  const stats = new Map();
  let unresolvedMeetings = 0;

  for (const meeting of meetings) {
    const pastorName = String(meeting.pastor_name || "").trim();
    const meetingDate = String(meeting.meeting_date || "").trim();
    const pastorId = byLookup.get(normalize(pastorName));

    if (!pastorId) {
      unresolvedMeetings += 1;
      continue;
    }

    const current = stats.get(pastorId) || { count: 0, first: "", last: "" };
    current.count += 1;

    if (isIsoDate(meetingDate)) {
      if (!current.first || meetingDate < current.first) current.first = meetingDate;
      if (!current.last || meetingDate > current.last) current.last = meetingDate;
    }

    stats.set(pastorId, current);
  }

  let updated = 0;
  for (const [pastorId, pastor] of byId.entries()) {
    const stat = stats.get(pastorId) || { count: 0, first: "", last: "" };
    const currentCount = Number(pastor.meeting_count || 0);
    const currentFirst = String(pastor.first_meeting_date || "").trim();
    const currentLast = String(pastor.last_meeting_date || "").trim();

    if (
      currentCount === stat.count &&
      currentFirst === stat.first &&
      currentLast === stat.last
    ) {
      continue;
    }

    await pastorRepo.update({
      id: pastorId,
      meeting_count: String(stat.count),
      first_meeting_date: stat.first,
      last_meeting_date: stat.last
    });
    updated += 1;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        pastorsTotal: pastors.length,
        meetingsTotal: meetings.length,
        pastorsUpdated: updated,
        meetingsUnresolvedPastor: unresolvedMeetings
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error.message
      },
      null,
      2
    )
  );
  process.exit(1);
});
