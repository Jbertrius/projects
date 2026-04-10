const { Router } = require("express");
const { requireAuth, requireContentManager } = require("../middleware/auth");
const pastorRepo = require("../repositories/pastor.repository");
const dashboardRepo = require("../repositories/dashboard.repository");
const { appCache } = require("../utils/cache");
const { hasFirestoreConfig, upsertPastorIfMissing, patchPastorSummitStatus } = require("../../lib/firestore");
const { AppError } = require("../middleware/errorHandler");

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

// ---------------------------------------------------------------------------
// POST /api/pastors/stub
// Create a minimal pastor fiche if none exists yet.
// Body: { name: string, date?: string }
// ---------------------------------------------------------------------------
router.post("/stub", requireContentManager, async (req, res, next) => {
  try {
    if (!hasFirestoreConfig()) {
      throw new AppError(503, "Firestore n'est pas configure.");
    }
    const name = String(req.body.name || "").trim();
    if (!name) {
      return res.status(400).json({ ok: false, error: "name is required" });
    }
    const date = String(req.body.date || "").trim();
    const result = await upsertPastorIfMissing(name, date);
    if (!result || !result.created) {
      return res.json({ ok: true, created: false, message: "La fiche pasteur existe deja." });
    }
    appCache.invalidate("pastors");
    res.json({ ok: true, created: true, pastorId: result.pastorId });
  } catch (error) {
    if (!error.status) error.status = 400;
    next(error);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/pastors/:id/summit
// Quick update of GMCS summit status from the dashboard.
// Body: { status: ""| "verbal"|"inscrit"|"paiement", note?: string }
// ---------------------------------------------------------------------------
const VALID_SUMMIT_STATUSES = ["", "verbal", "inscrit", "paiement"];
router.patch("/:id/summit", requireContentManager, async (req, res, next) => {
  try {
    if (!hasFirestoreConfig()) throw new AppError(503, "Firestore n'est pas configure.");
    const pastorId = String(req.params.id || "").trim();
    if (!pastorId) return res.status(400).json({ ok: false, error: "pastorId is required" });
    const status = String(req.body.status ?? "").trim();
    if (!VALID_SUMMIT_STATUSES.includes(status)) {
      return res.status(400).json({ ok: false, error: `status must be one of: ${VALID_SUMMIT_STATUSES.join(", ")}` });
    }
    const note = String(req.body.note ?? "").trim();
    await patchPastorSummitStatus(pastorId, status, note);
    appCache.invalidate("pastors");
    res.json({ ok: true, pastorId, status, note });
  } catch (error) {
    if (!error.status) error.status = 400;
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
