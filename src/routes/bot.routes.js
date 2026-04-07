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
const { appCache } = require("../utils/cache");
const { AppError } = require("../middleware/errorHandler");
const { validate, required } = require("../utils/validate");
const { hasFirestoreConfig } = require("../../lib/firestore");
const { getAccessToken, fetchJson, getEnv } = require("../../lib/google-auth");

const router = Router();

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
    if (!hasFirestoreConfig()) {
      throw new AppError(503, "La base academie n'est pas configuree.");
    }

    const errors = validate(req.body, {
      classCode: [required()],
      date: [required()],
      title: [required()],
      instructor: [required()]
    });
    if (errors) {
      return res.status(400).json({ ok: false, error: errors[0], errors });
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

    const result = await academyRepo.recordLesson(parsed, { mode, lessonId, classId });
    appCache.invalidate("academy");

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
    if (!hasFirestoreConfig()) {
      throw new AppError(503, "La base de donnees n'est pas configuree.");
    }

    const errors = validate(req.body, {
      summary: [required()],
      date: [required()]
    });
    if (errors) {
      return res.status(400).json({ ok: false, error: errors[0], errors });
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

    const meetingId = `MTG_${String(date).replace(/-/g, "")}_${slugify(summary)}`;
    const doc = {
      fields: {
        summary: { stringValue: String(summary).trim() },
        meetingDate: { stringValue: String(date).trim() },
        meetingTime: { stringValue: String(time || "").trim() },
        location: { stringValue: String(location || "").trim() },
        description: { stringValue: String(description || "").trim() },
        participantNames: {
          arrayValue: {
            values: participants.map((p) => ({ stringValue: String(p).trim() }))
          }
        },
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

    res.json({
      ok: true,
      source: req.botIdentity?.name || "api",
      meetingId,
      summary: { summary, date, participants: participants.length }
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
    const memberRepo = require("../repositories/member.repository");
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
