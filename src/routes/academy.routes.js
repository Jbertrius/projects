const { Router } = require("express");
const { requireAuth, requireContentManager } = require("../middleware/auth");
const academyRepo = require("../repositories/academy.repository");
const { hasFirestoreConfig } = require("../../lib/firestore");
const { normalizeIsoDate, parseAttendanceBlock } = require("../../lib/academy-parser");
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
    const totalMatch = line.match(/\bTOTAL\b\s*:\s*(\d+)\s*\/\s*(\d+)/iu);
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

    // Parse the raw attendance block
    const parsed = parseAttendanceBlock(
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

    // Cross-check against declared totals
    if (!payload.deleteExisting && parsed.registered_students.length) {
      const declaredTotals = parseDeclaredAttendanceTotals(payload.rawText);
      if (declaredTotals) {
        const parsedTotal   = parsed.registered_students.length;
        const parsedPresent = parsed.registered_students.filter(([, s]) => s === "present").length;
        if (parsedTotal !== declaredTotals.expected || parsedPresent !== declaredTotals.present) {
          const sourceLabel = declaredTotals.source.startsWith("sections") ? "sections" : "TOTAL";
          issues.push(
            `Incoherence detectee avec ${sourceLabel}: parse=${parsedPresent}/${parsedTotal}, declare=${declaredTotals.present}/${declaredTotals.expected}.`
          );
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
    res.json({ ok: true, parsed, result });
  } catch (error) {
    if (!error.status) error.status = 400;
    next(error);
  }
});

module.exports = router;
