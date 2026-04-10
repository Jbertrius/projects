/**
 * Bot-facing API endpoints.
 *
 * These are the only write paths for the Telegram bots. Bots should call these
 * instead of writing to Firestore directly. Authentication is via API key
 * (Authorization: Bearer <BOT_API_KEY_*> header), handled by apiKeyAuth middleware
 * which sets req.botIdentity before these handlers run.
 *
 * POST /api/bot/lessons       — Attendance bot: record a lesson
 * POST /api/bot/meetings      — Mannam bot: record an evangelism meeting
 * GET  /api/bot/members       — Both bots: resolve member names
 */

const { Router } = require("express");
const { requireBotOrAuth } = require("../middleware/apiKey");
const academyRepo = require("../repositories/academy.repository");
const attendanceRepo = require("../repositories/attendance.repository");
const memberRepo = require("../repositories/member.repository");
const { appCache } = require("../utils/cache");
const { AppError } = require("../middleware/errorHandler");
const { validate, required } = require("../utils/validate");
const { hasFirestoreConfig, deleteMeetingDocument, refreshDashboardAggregate, upsertPastorIfMissing } = require("../../lib/firestore");
const { getAccessToken, fetchJson, getEnv } = require("../../lib/google-auth");
const { rateLimit } = require("../middleware/rateLimit");
const { log } = require("../middleware/logger");
const { inspectAcademyPayload } = require("../utils/academyGuard");
const { normalizeMeetingDate, meetingMonthFromDate, inferPastorName } = require("../../lib/meeting-normalization");

const router = Router();

// Rate limit: 120 requests per minute per IP — generous for legitimate bots
// (a single lesson submit = 1 req), restrictive for scripted abuse.
router.use(rateLimit({ windowMs: 60_000, max: 120, message: "Trop de requetes bot. Veuillez reessayer dans une minute." }));

// All bot routes require either an API key or a logged-in session
router.use(requireBotOrAuth);

// ---------------------------------------------------------------------------
// POST /api/bot/lessons
// Attendance bot submits a parsed lesson block.
//
// Expected body:
//   classCode    string  required
//   date         string  required  YYYY-MM-DD
//   title        string  required
//   instructor   string  required
//   students     Array<{ name: string, status: "present"|"absent", note?: string }>
//   mode         string  optional  "create" (default) | "replace" | "delete"
//   lessonId     string  optional  required when mode = "replace" | "delete-by-id"
//   classId      string  optional  used together with lessonId for replace/delete-by-id
//   source       string  optional  e.g. "telegram_bot"
// ---------------------------------------------------------------------------
router.post("/lessons", async (req, res, next) => {
  try {
    // Validate input first so callers get 400, not 503, for missing fields
    const errors = validate(req.body, {
      classCode: [required()],
      date: [required()],
      title: [required()],
      instructor: [required()]
    });
    if (errors) {
      return res.status(400).json({ ok: false, error: errors[0], errors });
    }

    if (!hasFirestoreConfig()) {
      throw new AppError(503, "La base academie n'est pas configuree.");
    }

    const {
      classCode,
      date,
      title,
      instructor,
      students = [],
      mode = "create",
      lessonId,
      classId
    } = req.body;

    // Translate the simplified bot payload into the shape academy.repository expects
    const parsed = {
      class_code: String(classCode).trim(),
      lesson_date: String(date).trim(),
      lesson_title: String(title).trim(),
      teacher_name: String(instructor).trim(),
      registered_students: students
        .filter((s) => s && s.name)
        .map((s) => [
          String(s.name).trim(),
          String(s.status || "present").toLowerCase(),
          String(s.subgroup || "").trim()
        ]),
      unregistered_students: [],
      absence_notes: students.reduce((acc, s) => {
        if (s.note) acc[String(s.name).trim()] = s.note;
        return acc;
      }, {})
    };

    const guard = inspectAcademyPayload({
      classCode: parsed.class_code,
      lessonTitle: parsed.lesson_title,
      instructor: parsed.teacher_name
    });

    if (guard.shouldReject) {
      log("warn", "academy_test_payload_rejected", {
        route: "/api/bot/lessons",
        source: String(req.body.source || req.botIdentity?.name || "unknown"),
        actorType: req.botIdentity ? "bot" : "user",
        botIdentity: req.botIdentity?.name || "",
        reasons: guard.reasons,
        classCode: guard.fingerprint.classCode,
        lessonTitle: guard.fingerprint.lessonTitle,
        instructor: guard.fingerprint.instructor
      });
      return res.status(400).json({
        ok: false,
        error: "Cette entree ressemble a une donnee de test et a ete rejetee.",
        reasons: guard.reasons
      });
    }

    const result = await academyRepo.recordLesson(parsed, { mode, lessonId, classId });
    appCache.invalidate("academy");
    // Fire-and-forget: keep aggregate in sync without blocking the response
    refreshDashboardAggregate().catch(() => {});

    res.json({
      ok: true,
      source: req.botIdentity?.name || "api",
      summary: {
        classCode: parsed.class_code,
        date: parsed.lesson_date,
        title: parsed.lesson_title,
        present: parsed.registered_students.filter(([, s]) => s === "present").length,
        absent: parsed.registered_students.filter(([, s]) => s === "absent").length
      },
      result
    });
  } catch (error) {
    if (!error.status) error.status = 400;
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/bot/meetings
// Mannam bot submits a parsed meeting record.
//
// Expected body:
//   summary        string    required
//   date           string    required  YYYY-MM-DD
//   time           string    optional  HH:MM
//   location       string    optional
//   description    string    optional
//   participants   string[]  optional  names of members who attended
//   calendarEventId string   optional  Google Calendar event ID
//   source         string    optional  e.g. "mannam_bot"
// ---------------------------------------------------------------------------
router.post("/meetings", async (req, res, next) => {
  try {
    // Validate input first so callers get 400, not 503, for missing fields
    const errors = validate(req.body, {
      summary: [required()],
      date: [required()]
    });
    if (errors) {
      return res.status(400).json({ ok: false, error: errors[0], errors });
    }

    if (!hasFirestoreConfig()) {
      throw new AppError(503, "La base de donnees n'est pas configuree.");
    }

    const {
      summary,
      date,
      time,
      location,
      description,
      participants = [],
      calendarEventId,
      source = "mannam_bot"
    } = req.body;

    const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
    const projectId = getEnv("FIRESTORE_PROJECT_ID");
    const databaseId = getEnv("FIRESTORE_DATABASE_ID", "(default)");
    const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents`;

    const normalizedMeetingDate = normalizeMeetingDate(date);
    const meetingId = `MTG_${String(normalizedMeetingDate || date).replace(/-/g, "")}_${slugify(summary)}`;
    const month = meetingMonthFromDate(normalizedMeetingDate || date);
    const participantList = participants.map((p) => String(p).trim()).filter(Boolean);
    const inferredPastor = inferPastorName({
      pastorName: "",
      eventSummary: summary,
      eventDescription: description
    });

    const doc = {
      fields: {
        // Dashboard-compatible fields — must match what mapMeetingDocument reads
        eventSummary: { stringValue: String(summary).trim() },
        eventLocation: { stringValue: String(location || "").trim() },
        eventDescription: { stringValue: String(description || "").trim() },
        meetingDate: { stringValue: String(normalizedMeetingDate || date).trim() },
        reportDate: { stringValue: String(normalizedMeetingDate || date).trim() },
        month: { stringValue: month },
        calendarLogged: { booleanValue: Boolean(calendarEventId) },
        pastorName: { stringValue: String(inferredPastor.pastor_name || "").trim() },
        memberNamesCanonical: {
          arrayValue: {
            values: participantList.map((p) => ({ stringValue: p }))
          }
        },
        memberName: { stringValue: participantList[0] || "" },
        memberNameRaw: { stringValue: participantList[0] || "" },
        // Extended bot fields preserved for auditing
        meetingTime: { stringValue: String(time || "").trim() },
        calendarEventId: { stringValue: String(calendarEventId || "").trim() },
        source: { stringValue: String(source).trim() },
        createdAt: { stringValue: new Date().toISOString() }
      }
    };

    const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
    await fetchJson(`${baseUrl}/meetings/${encodeURIComponent(meetingId)}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(doc)
    });

    appCache.invalidate("dashboard");
    appCache.invalidate("dashboard:source");
    refreshDashboardAggregate().catch(() => {});

    // Fire-and-forget: ensure the pastor has a fiche (creates a stub if missing)
    if (inferredPastor.pastor_name) {
      upsertPastorIfMissing(inferredPastor.pastor_name, normalizedMeetingDate || date).catch(() => {});
    }

    res.json({
      ok: true,
      source: req.botIdentity?.name || "api",
      meetingId,
      summary: { summary, date: normalizedMeetingDate || date, participants: participants.length }
    });
  } catch (error) {
    if (!error.status) error.status = 400;
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/bot/members
// Bots use this to resolve names before submitting.
// Returns { members: [{ id, name, aliases, zone }] }
// ---------------------------------------------------------------------------
router.get("/members", async (req, res, next) => {
  try {
    const members = await appCache.get("members", 10 * 60 * 1000, () => memberRepo.findAll());
    res.json({
      ok: true,
      members: members.map((m) => ({
        id: m.id,
        name: m.name,
        aliases: m.aliases || "",
        zone: m.zone || ""
      }))
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/bot/meetings/:id
// Mannam bot deletes a meeting (e.g. when the Calendar event is removed).
// ---------------------------------------------------------------------------
router.delete("/meetings/:id", async (req, res, next) => {
  try {
    if (!hasFirestoreConfig()) {
      throw new AppError(503, "La base de donnees n'est pas configuree.");
    }
    const meetingId = String(req.params.id || "").trim();
    if (!meetingId) {
      return res.status(400).json({ ok: false, error: "meetingId is required" });
    }
    await deleteMeetingDocument(meetingId);
    appCache.invalidate("dashboard");
    appCache.invalidate("dashboard:source");
    res.json({ ok: true, meetingId });
  } catch (error) {
    if (!error.status) error.status = 400;
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/bot/events
// Attendance bot fetches all attendance events (sorted by date).
// Returns { events: [{ event_id, event_name, date, description }] }
// ---------------------------------------------------------------------------
router.get("/events", async (req, res, next) => {
  try {
    const events = await appCache.get(
      "attendanceEvents",
      5 * 60 * 1000,
      () => attendanceRepo.findAllEvents()
    );
    res.json({ ok: true, events });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/bot/categories
// Attendance bot fetches all attendance categories.
// Returns { categories: [{ category_id, category_name }] }
// ---------------------------------------------------------------------------
router.get("/categories", async (req, res, next) => {
  try {
    const categories = await appCache.get(
      "attendanceCategories",
      10 * 60 * 1000,
      () => attendanceRepo.findAllCategories()
    );
    res.json({ ok: true, categories });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/bot/events/:eventName/attendance
// Returns all participants recorded for one event.
// Returns { event_name, rows: [{ participant_name, category, timestamp }] }
// ---------------------------------------------------------------------------
router.get("/events/:eventName/attendance", async (req, res, next) => {
  try {
    const eventName = decodeURIComponent(String(req.params.eventName || "").trim());
    if (!eventName) {
      return res.status(400).json({ ok: false, error: "eventName is required" });
    }
    const rows = await attendanceRepo.findAttendanceForEvent(eventName);
    res.json({ ok: true, event_name: eventName, rows });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/bot/events/:eventName/participants
// Add one or more participants to an attendance event.
//
// Body: { participants: string[], category: string }
// Returns { ok, added: string[], skipped: string[] }
// ---------------------------------------------------------------------------
router.post("/events/:eventName/participants", async (req, res, next) => {
  try {
    if (!hasFirestoreConfig()) {
      throw new AppError(503, "La base de donnees n'est pas configuree.");
    }
    const eventName = decodeURIComponent(String(req.params.eventName || "").trim());
    if (!eventName) {
      return res.status(400).json({ ok: false, error: "eventName is required" });
    }
    const participants = Array.isArray(req.body.participants) ? req.body.participants : [];
    const category = String(req.body.category || "Guest").trim();
    if (!participants.length) {
      return res.status(400).json({ ok: false, error: "participants array is required" });
    }
    const added = await attendanceRepo.addParticipants(eventName, participants, category);
    const skipped = participants.filter((p) => !added.includes(p));
    appCache.invalidate("attendanceEvents");
    res.json({ ok: true, event_name: eventName, added, skipped });
  } catch (error) {
    if (!error.status) error.status = 400;
    next(error);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/bot/events/:eventName/participants/:participantName
// Remove a single participant from an attendance event.
// ---------------------------------------------------------------------------
router.delete("/events/:eventName/participants/:participantName", async (req, res, next) => {
  try {
    if (!hasFirestoreConfig()) {
      throw new AppError(503, "La base de donnees n'est pas configuree.");
    }
    const eventName = decodeURIComponent(String(req.params.eventName || "").trim());
    const participantName = decodeURIComponent(String(req.params.participantName || "").trim());
    if (!eventName || !participantName) {
      return res.status(400).json({ ok: false, error: "eventName and participantName are required" });
    }
    const removed = await attendanceRepo.removeParticipant(eventName, participantName);
    appCache.invalidate("attendanceEvents");
    res.json({ ok: true, event_name: eventName, participant_name: participantName, removed });
  } catch (error) {
    if (!error.status) error.status = 400;
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/bot/academy/report/class/:code
// Full attendance report for one academy class.
// Returns { cls, lessons, students, att_lookup }
// ---------------------------------------------------------------------------
router.get("/academy/report/class/:code", async (req, res, next) => {
  try {
    if (!hasFirestoreConfig()) {
      throw new AppError(503, "La base academie n'est pas configuree.");
    }
    const code = decodeURIComponent(String(req.params.code || "").trim());
    if (!code) {
      return res.status(400).json({ ok: false, error: "class code is required" });
    }
    const data = await academyRepo.getClassReport(code);
    if (!data) {
      return res.status(404).json({
        ok: false,
        error: `Classe *${code}* introuvable.`
      });
    }
    res.json({ ok: true, ...data });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/bot/academy/report/student/:name
// Attendance history for a single student (URL-encoded name).
// Returns { student_name, records: [...] }
// ---------------------------------------------------------------------------
router.get("/academy/report/student/:name", async (req, res, next) => {
  try {
    if (!hasFirestoreConfig()) {
      throw new AppError(503, "La base academie n'est pas configuree.");
    }
    const name = decodeURIComponent(String(req.params.name || "").trim());
    if (!name) {
      return res.status(400).json({ ok: false, error: "student name is required" });
    }
    const records = await academyRepo.getStudentReport(name);
    if (!records.length) {
      return res.status(404).json({
        ok: false,
        error: `Aucune donnee trouvee pour *${name}*.`
      });
    }
    res.json({ ok: true, student_name: name, records });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/bot/academy/report/absentees/:code[?lesson=<filter>]
// List absent students grouped by lesson for a given class.
// Returns { cls, lessons, att_by_lesson }
// ---------------------------------------------------------------------------
router.get("/academy/report/absentees/:code", async (req, res, next) => {
  try {
    if (!hasFirestoreConfig()) {
      throw new AppError(503, "La base academie n'est pas configuree.");
    }
    const code = decodeURIComponent(String(req.params.code || "").trim());
    const lessonFilter = String(req.query.lesson || "").trim();
    if (!code) {
      return res.status(400).json({ ok: false, error: "class code is required" });
    }
    const data = await academyRepo.getAbsentees(code, lessonFilter);
    if (!data) {
      return res.status(404).json({
        ok: false,
        error: `Classe *${code}* introuvable.`
      });
    }
    res.json({ ok: true, ...data });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

module.exports = router;
