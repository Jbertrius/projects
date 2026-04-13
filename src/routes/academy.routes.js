const { Router } = require("express");
const { requireAuth, requireContentManager } = require("../middleware/auth");
const academyRepo = require("../repositories/academy.repository");
const { hasFirestoreConfig, patchStudentSummitStatus, clearAcademyClassChurchName, deleteAcademyStudent, mergeAcademyStudents, deleteEmptyAcademyClasses } = require("../../lib/firestore");
const { normalizeIsoDate } = require("../../lib/academy-parser");
const { parseAttendanceBlockSmart } = require("../../lib/gemini-parser");
const { AppError } = require("../middleware/errorHandler");
const { appCache } = require("../utils/cache");
const { log } = require("../middleware/logger");
const { inspectAcademyPayload } = require("../utils/academyGuard");

const router = Router();

const ACADEMY_TTL_MS = 3 * 60 * 1000; // 3 minutes — attendance changes frequently

function normalizeLookupValue(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isDeletedStudent(student) {
  const status = String(student?.status || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  return Boolean(student?.deleted_at || student?.deletedAt) || status === "supprime";
}

function parseDeclaredAttendanceTotals(rawText) {
  const normalizedLines = String(rawText || "")
    .split("\n")
    .map((line) =>
      String(line || "")
        .normalize("NFKC")
        .replace(/\u00a0/g, " ")
        .replace(/[\u200B-\u200D\uFE0F]/g, "")
        .trim()
    )
    .filter(Boolean);

  let totalLine = null;
  const sectionTotals = [];

  for (const line of normalizedLines) {
    const totalMatch = line.match(/\bTOTAL\b\s*[:=]\s*(\d+)\s*\/\s*(\d+)/iu);
    if (totalMatch) {
      totalLine = { present: Number(totalMatch[1]), expected: Number(totalMatch[2]) };
      continue;
    }
    const sectionMatch = line.match(/\b(CEP|DMD)\b\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)/iu);
    if (sectionMatch) {
      sectionTotals.push({
        section: String(sectionMatch[1] || "").toUpperCase(),
        present: Number(sectionMatch[2]),
        expected: Number(sectionMatch[3])
      });
    }
  }

  const hasCep = sectionTotals.some((item) => item.section === "CEP");
  const hasDmd = sectionTotals.some((item) => item.section === "DMD");

  if (hasCep && hasDmd) {
    return {
      source: "sections-both",
      present: sectionTotals.reduce((sum, item) => sum + item.present, 0),
      expected: sectionTotals.reduce((sum, item) => sum + item.expected, 0)
    };
  }
  if (totalLine) {
    return { source: "total", present: totalLine.present, expected: totalLine.expected };
  }
  if (sectionTotals.length) {
    return {
      source: "sections-partial",
      present: sectionTotals.reduce((sum, item) => sum + item.present, 0),
      expected: sectionTotals.reduce((sum, item) => sum + item.expected, 0)
    };
  }
  return null;
}

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const data = await appCache.get("academy", ACADEMY_TTL_MS, () => academyRepo.findAll());
    const isEmpty = !hasFirestoreConfig();
    res.json({
      ok: true,
      ...data,
      meta: {
        refreshLabel: isEmpty
          ? "Aucune base academie connectee"
          : "Donnees academie synchronisees"
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get("/students", requireAuth, async (req, res, next) => {
  try {
    const data = await appCache.get("academy", ACADEMY_TTL_MS, () => academyRepo.findAll());
    const classesById = new Map((data.classes || []).map((item) => [String(item.id), item]));
    const attendanceByStudentId = new Map();
    const unregisteredByStudentName = new Map();

    (data.attendance || []).forEach((row) => {
      const key = String(row.student_id || "").trim();
      const bucket = attendanceByStudentId.get(key) || [];
      bucket.push(row);
      attendanceByStudentId.set(key, bucket);
    });

    (data.unregistered || []).forEach((row) => {
      const key = `${String(row.class_id || "").trim()}::${normalizeLookupValue(row.student_name || "")}`;
      const bucket = unregisteredByStudentName.get(key) || [];
      bucket.push(row);
      unregisteredByStudentName.set(key, bucket);
    });

    const students = (data.students || [])
      .filter((student) => !isDeletedStudent(student))
      .map((student) => {
        const studentId = String(student.id || "").trim();
        const classId = String(student.class_id || "").trim();
        const statsRows = attendanceByStudentId.get(studentId) || [];
        const unregisteredRows = unregisteredByStudentName.get(
          `${classId}::${normalizeLookupValue(student.name || "")}`
        ) || [];
        const presentCount = statsRows.filter((row) => row.status === "present").length;
        const absentCount = statsRows.filter((row) => row.status === "absent").length;
        const lateCount = statsRows.filter((row) => row.status === "late").length;
        const lessonCount = statsRows.length + unregisteredRows.length;
        const academyClass = classesById.get(classId) || {};
        return {
          ...student,
          class_name: student.class_name || academyClass.name || classId,
          instructor_name: student.instructor_name || academyClass.instructor_name || "",
          church_name: student.church_name || academyClass.church_name || "",
          attendance_count: statsRows.length,
          unregistered_lesson_count: unregisteredRows.length,
          lesson_count: lessonCount,
          present_count: presentCount,
          absent_count: absentCount,
          late_count: lateCount,
          last_lesson_date: statsRows
            .map((row) => String(row.session_date || ""))
            .filter(Boolean)
            .sort()
            .slice(-1)[0] || unregisteredRows
            .map((row) => String(row.session_date || ""))
            .filter(Boolean)
            .sort()
            .slice(-1)[0] || "",
          notes: student.notes || "",
          status: student.status || (student.is_registered === false ? "Non inscrit" : "Inscrit")
        };
      })
      .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "fr"));

    const classOptions = (data.classes || [])
      .map((academyClass) => ({
        id: academyClass.id,
        name: academyClass.name
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "fr"));

    res.json({
      ok: true,
      students,
      classOptions,
      meta: {
        refreshLabel: hasFirestoreConfig() ? "Fiches etudiants synchronisees" : "Aucune base academie connectee"
      }
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/academy/classes/:id
// Full class report: students + lessons + attendance, enriched with per-lesson
// and per-student stats. Used by classe.html.
// ---------------------------------------------------------------------------
router.get("/classes/:id", requireAuth, async (req, res, next) => {
  try {
    const classId = String(req.params.id || "").trim();
    if (!classId) return res.status(400).json({ ok: false, error: "classId is required" });

    const report = await academyRepo.getClassReportById(classId);
    if (!report) return res.status(404).json({ ok: false, error: "Classe introuvable." });

    const { cls, lessons, students, attendanceRows, allClasses } = report;

    // Index attendance by student_id + lesson_id for O(1) lookup.
    const attByKey = new Map();
    for (const row of attendanceRows) {
      attByKey.set(`${row.lesson_id}__${row.student_id}`, row);
    }

    // Enrich students: compute per-lesson attendance stats.
    const enrichedStudents = students.map((student) => {
      const lessonCount = lessons.length;
      let presentCount = 0, absentCount = 0, lateCount = 0, excusedCount = 0;
      for (const lesson of lessons) {
        const row = attByKey.get(`${lesson.lesson_id}__${student.id}`);
        const status = row ? row.status : "absent";
        if (status === "present")       presentCount++;
        else if (status === "late")     lateCount++;
        else if (status === "excused")  excusedCount++;
        else                            absentCount++;
      }
      return {
        ...student,
        lesson_count:   lessonCount,
        present_count:  presentCount,
        absent_count:   absentCount,
        late_count:     lateCount,
        excused_count:  excusedCount,
        presence_rate:  lessonCount > 0 ? Math.round((presentCount / lessonCount) * 100) : 0
      };
    });

    // Enrich lessons: count present students per lesson + include per-student attendance detail.
    const enrichedLessons = lessons.map((lesson) => {
      const lessonAttRows = attendanceRows.filter((r) => r.lesson_id === lesson.lesson_id);
      const presentCount = lessonAttRows.filter((r) => r.status === "present").length;
      const totalStudents = students.length;
      // Build per-student attendance array for block reconstruction on the client.
      const attendance = students.map((s) => {
        const row = attByKey.get(`${lesson.lesson_id}__${s.id}`);
        return { student_id: s.id, student_name: s.name || s.id, status: row ? row.status : "absent" };
      });
      return {
        ...lesson,
        present_count:  presentCount,
        total_students: totalStudents,
        presence_rate:  totalStudents > 0 ? Math.round((presentCount / totalStudents) * 100) : 0,
        attendance
      };
    });

    const avgPresenceRate = enrichedLessons.length > 0
      ? Math.round(enrichedLessons.reduce((sum, l) => sum + l.presence_rate, 0) / enrichedLessons.length)
      : 0;

    const allClassesSorted = allClasses
      .map((c) => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));

    res.json({
      ok: true,
      class:      cls,
      students:   enrichedStudents,
      lessons:    enrichedLessons,
      stats: {
        student_count:      students.length,
        lesson_count:       lessons.length,
        avg_presence_rate:  avgPresenceRate,
        total_absences:     enrichedStudents.reduce((sum, s) => sum + s.absent_count, 0)
      },
      all_classes: allClassesSorted
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/academy/students/:id/summit
// Quick update of GMCS summit status for a student.
// Body: { status: ""| "verbal"|"inscrit"|"paiement", note?: string }
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// DELETE /api/academy/classes/:id/church
// Remove the church_name from a class, moving it back to core academy.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// DELETE /api/academy/classes/empty
// Permanently remove all academy class documents that have no students.
// ---------------------------------------------------------------------------
router.delete("/classes/empty", requireContentManager, async (req, res, next) => {
  try {
    if (!hasFirestoreConfig()) throw new AppError(503, "Firestore n'est pas configure.");
    const result = await deleteEmptyAcademyClasses();
    appCache.invalidate("academy");
    res.json({ ok: true, ...result });
  } catch (error) {
    if (!error.status) error.status = 400;
    next(error);
  }
});

router.delete("/classes/:id/church", requireContentManager, async (req, res, next) => {
  try {
    if (!hasFirestoreConfig()) throw new AppError(503, "Firestore n'est pas configure.");
    const classId = String(req.params.id || "").trim();
    if (!classId) return res.status(400).json({ ok: false, error: "classId is required" });
    await clearAcademyClassChurchName(classId);
    appCache.invalidate("academy");
    res.json({ ok: true, classId });
  } catch (error) {
    if (!error.status) error.status = 400;
    next(error);
  }
});

const VALID_SUMMIT_STATUSES = ["", "verbal", "inscrit", "paiement"];
router.patch("/students/:id/summit", requireContentManager, async (req, res, next) => {
  try {
    if (!hasFirestoreConfig()) throw new AppError(503, "Firestore n'est pas configure.");
    const studentId = String(req.params.id || "").trim();
    if (!studentId) return res.status(400).json({ ok: false, error: "studentId is required" });
    const status = String(req.body.status ?? "").trim();
    if (!VALID_SUMMIT_STATUSES.includes(status)) {
      return res.status(400).json({ ok: false, error: `status must be one of: ${VALID_SUMMIT_STATUSES.join(", ")}` });
    }
    const note = String(req.body.note ?? "").trim();
    await patchStudentSummitStatus(studentId, status, note);
    appCache.invalidate("academy");
    res.json({ ok: true, studentId, status, note });
  } catch (error) {
    if (!error.status) error.status = 400;
    next(error);
  }
});

router.post("/students/update", requireContentManager, async (req, res, next) => {
  try {
    if (!hasFirestoreConfig()) {
      throw new AppError(400, "La base academie n'est pas configuree.");
    }
    const payload = req.body || {};
    if (!String(payload.id || "").trim()) {
      throw new AppError(400, "Identifiant etudiant manquant.");
    }
    if (!String(payload.name || "").trim()) {
      throw new AppError(400, "Le nom de l'etudiant est requis.");
    }

    const student = await academyRepo.updateStudent(payload);
    appCache.invalidate("academy");
    res.json({ ok: true, student });
  } catch (error) {
    if (!error.status) error.status = 400;
    next(error);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/academy/students/:id
// Permanently remove a student document from Firestore.
// ---------------------------------------------------------------------------
router.delete("/students/:id", requireContentManager, async (req, res, next) => {
  try {
    if (!hasFirestoreConfig()) throw new AppError(503, "Firestore n'est pas configure.");
    const studentId = String(req.params.id || "").trim();
    if (!studentId) return res.status(400).json({ ok: false, error: "studentId is required" });
    await deleteAcademyStudent(studentId);
    appCache.invalidate("academy");
    res.json({ ok: true, studentId });
  } catch (error) {
    if (!error.status) error.status = 400;
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/academy/students/merge
// Merge two student records: transfer all attendance from secondary to primary,
// then soft-delete the secondary student.
// Body: { primaryId: string, secondaryId: string }
// ---------------------------------------------------------------------------
router.post("/students/merge", requireContentManager, async (req, res, next) => {
  try {
    if (!hasFirestoreConfig()) throw new AppError(503, "Firestore n'est pas configure.");
    const { primaryId, secondaryId } = req.body || {};
    if (!primaryId || !secondaryId) {
      return res.status(400).json({ ok: false, error: "primaryId and secondaryId are required" });
    }
    const result = await mergeAcademyStudents(primaryId, secondaryId);
    appCache.invalidate("academy");
    res.json({ ok: true, ...result });
  } catch (error) {
    if (!error.status) error.status = 400;
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/academy/verify
// Parse a raw attendance block (via Gemini if available) and return the
// structured result for preview — does NOT write anything.
// ---------------------------------------------------------------------------
router.post("/verify", requireContentManager, async (req, res, next) => {
  try {
    const rawText = String(req.body.rawText || "").trim();
    const lessonDate = normalizeIsoDate(req.body.lessonDate || "");
    if (!rawText) return res.status(400).json({ ok: false, error: "rawText is required" });

    const parsed = await parseAttendanceBlockSmart(rawText, lessonDate);

    const issues = [];
    if (!parsed.class_code)   issues.push("La ligne de classe est manquante.");
    if (!parsed.lesson_title) issues.push("Le titre de la lecon est manquant.");
    if (!parsed.teacher_name) issues.push("L'instructeur est manquant.");
    if (!parsed.registered_students.length) issues.push("Aucun etudiant inscrit detecte.");

    res.json({ ok: true, parsed, issues, valid: issues.length === 0 });
  } catch (error) {
    next(error);
  }
});

router.post("/record-lesson", requireContentManager, async (req, res, next) => {
  try {
    if (!hasFirestoreConfig()) {
      throw new AppError(400, "La base academie n'est pas configuree.");
    }

    const payload = req.body;

    // Fast-path: delete by ID
    if (payload.deleteExisting && payload.lessonId) {
      const result = await academyRepo.recordLesson(
        {
          lesson_id: payload.lessonId,
          class_id: payload.classId,
          class_code: String(payload.classCode || "").trim(),
          lesson_title: String(payload.lessonTitle || "").trim(),
          lesson_date: normalizeIsoDate(payload.lessonDate || "") || String(payload.lessonDate || "").trim()
        },
        { mode: "delete-by-id", lessonId: payload.lessonId, classId: payload.classId }
      );
      appCache.invalidate("academy");
      return res.json({ ok: true, parsed: null, result });
    }

    // Parse the raw attendance block (Gemini if available, regex fallback)
    const parsed = await parseAttendanceBlockSmart(
      String(payload.rawText || "").trim(),
      normalizeIsoDate(payload.lessonDate || "")
    );
    if (payload.classCode && !parsed.class_code)   parsed.class_code   = String(payload.classCode   || "").trim();
    if (payload.lessonTitle && !parsed.lesson_title) parsed.lesson_title = String(payload.lessonTitle || "").trim();
    if (payload.lessonDate && !parsed.lesson_date) {
      parsed.lesson_date = normalizeIsoDate(payload.lessonDate || "") || String(payload.lessonDate || "").trim();
    }
    if (payload.teacherName && !parsed.teacher_name) parsed.teacher_name = String(payload.teacherName || "").trim();

    const guard = inspectAcademyPayload({
      classCode: parsed.class_code,
      lessonTitle: parsed.lesson_title,
      instructor: parsed.teacher_name
    });

    if (guard.shouldReject) {
      log("warn", "academy_test_payload_rejected", {
        route: "/api/academy/record-lesson",
        source: String(payload.source || req.botIdentity?.name || req.sessionUser?.email || "unknown"),
        actorType: req.botIdentity ? "bot" : "user",
        reasons: guard.reasons,
        classCode: guard.fingerprint.classCode,
        lessonTitle: guard.fingerprint.lessonTitle,
        instructor: guard.fingerprint.instructor
      });
      throw new AppError(400, "Cette entree ressemble a une donnee de test et a ete rejetee.");
    }

    // Validate required fields
    const issues = [];
    if (!parsed.class_code)   issues.push("La ligne de classe est requise.");
    if (!parsed.lesson_title) issues.push("Le titre de la lecon est requis.");
    if (!parsed.lesson_date)  issues.push("La date de la lecon est requise.");
    if (!payload.deleteExisting && !parsed.teacher_name) issues.push("Le nom de l'instructeur est requis.");
    if (!payload.deleteExisting && !parsed.registered_students.length) {
      issues.push("Au moins un etudiant inscrit doit etre detecte.");
    }

    // Cross-check against declared totals — warning only, never blocks save
    let totalsWarning = null;
    if (!payload.deleteExisting && parsed.registered_students.length) {
      const declaredTotals = parseDeclaredAttendanceTotals(payload.rawText);
      if (declaredTotals) {
        const parsedTotal   = parsed.registered_students.length;
        const parsedPresent = parsed.registered_students.filter(([, s]) => s === "present").length;
        if (parsedTotal !== declaredTotals.expected || parsedPresent !== declaredTotals.present) {
          const sourceLabel = declaredTotals.source.startsWith("sections") ? "sections" : "TOTAL";
          totalsWarning = `Totaux declares (${sourceLabel}: ${declaredTotals.present}/${declaredTotals.expected}) differents du parse (${parsedPresent}/${parsedTotal}) — enregistrement force.`;
        }
      }
    }

    if (issues.length) {
      throw new AppError(400, "Validation impossible.", { issues, parsed });
    }

    const mode = payload.deleteExisting ? "delete" : payload.replaceExisting ? "replace" : "create";
    const result = await academyRepo.recordLesson(parsed, {
      mode,
      lessonId: payload.lessonId,
      classId: payload.classId
    });

    appCache.invalidate("academy");
    res.json({ ok: true, parsed, result, warning: totalsWarning || undefined });
  } catch (error) {
    if (!error.status) error.status = 400;
    next(error);
  }
});

module.exports = router;
