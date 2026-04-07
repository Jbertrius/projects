const { Router } = require("express");
const { requireAuth, requireContentManager } = require("../middleware/auth");
const academyRepo = require("../repositories/academy.repository");
const { hasFirestoreConfig } = require("../../lib/firestore");
const { normalizeIsoDate, parseAttendanceBlock } = require("../../lib/academy-parser");
const { AppError } = require("../middleware/errorHandler");
const { appCache } = require("../utils/cache");

const router = Router();

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
    const data = await academyRepo.findAll();
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
