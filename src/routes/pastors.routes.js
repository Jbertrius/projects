const { Router } = require("express");
const { requireAuth, requireContentManager } = require("../middleware/auth");
const pastorRepo = require("../repositories/pastor.repository");
const dashboardRepo = require("../repositories/dashboard.repository");
const { appCache } = require("../utils/cache");

const router = Router();

const PASTORS_TTL_MS = 10 * 60 * 1000; // 10 minutes

function normalizeLookupValue(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function splitList(value, separators = /[|,;]/) {
  return String(value || "")
    .split(separators)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildPastorMemberContext(pastors, meetings, members) {
  const pastorsById = new Map();
  const pastorsByName = new Map();
  const officialMembers = new Map();

  (members || []).forEach((member) => {
    const canonicalName = String(member.name || "").trim();
    if (!canonicalName) return;
    const lookupValues = new Set([canonicalName, ...splitList(member.aliases, /[|;,]/)]);
    lookupValues.forEach((value) => {
      const normalized = normalizeLookupValue(value);
      if (normalized) officialMembers.set(normalized, canonicalName);
    });
  });

  pastors.forEach((pastor) => {
    const pastorId = String(pastor.id || "").trim();
    const lookupValues = new Set([
      pastor.name,
      ...splitList(pastor.aliases, /[|;,]/),
      ...splitList(pastor.source_variants, /\|/)
    ]);
    if (pastorId) pastorsById.set(pastorId, pastor);
    lookupValues.forEach((value) => {
      const normalized = normalizeLookupValue(value);
      if (normalized) pastorsByName.set(normalized, pastor);
    });
  });

  const memberOptions = new Set();
  const membersByPastorId = new Map();

  meetings.forEach((meeting) => {
    const meetingMembers = splitList(
      meeting.member_names_canonical || meeting.member_name || "",
      /[,;|]/
    )
      .map((name) => officialMembers.get(normalizeLookupValue(name.trim())) || "")
      .filter(Boolean);
    const uniqueMeetingMembers = Array.from(new Set(meetingMembers));
    if (!uniqueMeetingMembers.length) return;

    let pastor = null;
    const pastorId = String(meeting.pastor_id || "").trim();
    if (pastorId && pastorsById.has(pastorId)) pastor = pastorsById.get(pastorId);
    if (!pastor) {
      const pastorName = normalizeLookupValue(meeting.pastor_name || meeting.pastor_name_raw || "");
      pastor = pastorsByName.get(pastorName) || null;
    }
    if (!pastor) return;

    const bucket = membersByPastorId.get(pastor.id) || new Set();
    uniqueMeetingMembers.forEach((memberName) => {
      bucket.add(memberName);
      memberOptions.add(memberName);
    });
    membersByPastorId.set(pastor.id, bucket);
  });

  return {
    pastors: pastors.map((pastor) => ({
      ...pastor,
      member_names: Array.from(membersByPastorId.get(pastor.id) || []).sort((a, b) =>
        a.localeCompare(b, "fr")
      )
    })),
    memberOptions: Array.from(memberOptions).sort((a, b) => a.localeCompare(b, "fr"))
  };
}

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const [pastors, sourceData] = await Promise.all([
      appCache.get("pastors", PASTORS_TTL_MS, () => pastorRepo.findAll()),
      appCache.get("dashboard:source", PASTORS_TTL_MS, () => dashboardRepo.loadSourceData())
    ]);
    const context = buildPastorMemberContext(
      pastors,
      sourceData.meetings || [],
      sourceData.members || []
    );
    res.json({ ok: true, pastors: context.pastors, memberOptions: context.memberOptions });
  } catch (error) {
    next(error);
  }
});

router.post("/update", requireContentManager, async (req, res, next) => {
  try {
    const pastor = await pastorRepo.update(req.body);
    // Invalidate so next read reflects the change
    appCache.invalidate("pastors");
    res.json({ ok: true, pastor });
  } catch (error) {
    error.status = 400;
    next(error);
  }
});

module.exports = router;
