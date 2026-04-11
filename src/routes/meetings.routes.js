/**
 * Mannam meeting management endpoints.
 *
 * GET  /api/meetings          — Full list enriched with member resolution context
 * PATCH /api/meetings/:id     — Patch a meeting (members, cooperation status, note)
 */

const { Router } = require("express");
const { requireAuth, requireContentManager } = require("../middleware/auth");
const { appCache } = require("../utils/cache");
const { AppError } = require("../middleware/errorHandler");
const { hasFirestoreConfig, refreshDashboardAggregate } = require("../../lib/firestore");
const { deleteCalendarEvent } = require("../../lib/calendar");
const meetingsRepo = require("../repositories/meetings.repository");
const pastorRepo = require("../repositories/pastor.repository");

const router = Router();

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function hasAcademyClass(pastor) {
  return Boolean(String(pastor?.academy_class || "").trim());
}

// All meeting management routes require a logged-in session
router.use(requireAuth);

// ---------------------------------------------------------------------------
// GET /api/meetings
// Returns all meetings enriched with resolved members + unmatched suggestions.
// ---------------------------------------------------------------------------
router.get("/", async (req, res, next) => {
  try {
    const meetings = await appCache.get("mannams:list", 2 * 60 * 1000, () => meetingsRepo.findAll());
    res.json({ ok: true, meetings });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/meetings/members
// Returns member list for the name-correction dropdown.
// ---------------------------------------------------------------------------
const memberRepo = require("../repositories/member.repository");
router.get("/members", async (req, res, next) => {
  try {
    const members = await appCache.get("members", 10 * 60 * 1000, () => memberRepo.findAll());
    res.json({
      ok: true,
      members: members.map((m) => ({ id: m.id, name: m.name, zone: m.zone || "", aliases: m.aliases || "" }))
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/meetings/:id
// Patch fields: member_ids, member_names_canonical, member_match_status,
//               member_unmatched_names, cooperation_status, follow_up_note,
//               pastor_name
// Requires ContentManager role.
// ---------------------------------------------------------------------------
router.patch("/:id", requireContentManager, async (req, res, next) => {
  try {
    if (!hasFirestoreConfig()) {
      throw new AppError(503, "Firestore n'est pas configure.");
    }

    const meetingId = String(req.params.id || "").trim();
    if (!meetingId) {
      return res.status(400).json({ ok: false, error: "meetingId is required" });
    }

    const allowed = [
      "member_ids",
      "member_names_canonical",
      "member_match_status",
      "member_unmatched_names",
      "cooperation_status",
      "follow_up_note",
      "pastor_name"
    ];

    const patch = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        patch[key] = req.body[key];
      }
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ ok: false, error: "No patchable fields provided." });
    }

    // Validate cooperation_status if provided
    const validCoopStatuses = ["none", "interested", "agreed", "enrolled", "church", "joined"];
    if (patch.cooperation_status && !validCoopStatuses.includes(patch.cooperation_status)) {
      return res.status(400).json({ ok: false, error: `cooperation_status must be one of: ${validCoopStatuses.join(", ")}` });
    }

    // Business rule: cannot set "enrolled" if the linked pastor has no class configured.
    if (patch.cooperation_status === "enrolled") {
      const meetings = await meetingsRepo.findAll();
      const targetMeeting = meetings.find((m) => String(m.id) === meetingId);
      if (!targetMeeting) {
        return res.status(404).json({ ok: false, error: "Meeting introuvable." });
      }

      const pastorName = normalizeName(patch.pastor_name || targetMeeting.pastor_name);
      const pastors = await pastorRepo.findAll();
      const linkedPastor = pastors.find((pastor) => {
        const byName = normalizeName(pastor.name) === pastorName;
        if (byName) return true;

        const aliases = String(pastor.aliases || "")
          .split(/[|,;]/)
          .map((alias) => normalizeName(alias))
          .filter(Boolean);
        return aliases.includes(pastorName);
      });

      if (!hasAcademyClass(linkedPastor)) {
        return res.status(400).json({
          ok: false,
          error: "Impossible de passer a 'Inscrit (academie)' tant que la fiche pasteur n'a pas de classe renseignee."
        });
      }
    }

    await meetingsRepo.patch(meetingId, patch);
    appCache.invalidate("mannams:list");
    appCache.invalidate("dashboard");
    appCache.invalidate("dashboard:source");
    refreshDashboardAggregate().catch(() => {});

    res.json({ ok: true, meetingId, patched: Object.keys(patch) });
  } catch (error) {
    if (!error.status) error.status = 400;
    next(error);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/meetings/:id
// Removes the meeting from Firestore AND from Google Calendar.
// Requires ContentManager role.
// ---------------------------------------------------------------------------
router.delete("/:id", requireContentManager, async (req, res, next) => {
  try {
    if (!hasFirestoreConfig()) {
      throw new AppError(503, "Firestore n'est pas configure.");
    }

    const meetingId = String(req.params.id || "").trim();
    if (!meetingId) {
      return res.status(400).json({ ok: false, error: "meetingId is required" });
    }

    // Fetch meeting to get the actual calendar event ID (different from Firestore doc ID)
    const meetings = await meetingsRepo.findAll();
    const target = meetings.find((m) => String(m.id) === meetingId);

    // Delete from Firestore
    await meetingsRepo.remove(meetingId);

    // Best-effort delete from Google Calendar using the stored calendarEventId
    const calendarEventId = target?.calendar_event_id || "";
    if (calendarEventId) {
      deleteCalendarEvent(calendarEventId).catch(() => {});
    }

    appCache.invalidate("mannams:list");
    appCache.invalidate("dashboard");
    appCache.invalidate("dashboard:source");
    refreshDashboardAggregate().catch(() => {});

    res.json({ ok: true, meetingId });
  } catch (error) {
    if (!error.status) error.status = 400;
    next(error);
  }
});

module.exports = router;
