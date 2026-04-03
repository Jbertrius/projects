function normalizeIsoDate(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const dmyMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
  }

  return "";
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\uFE0F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripWrappingNote(value) {
  const normalized = normalizeText(value);
  const noteMatch = normalized.match(/\s*\(([^)]+)\)\s*$/);
  if (!noteMatch) {
    return { value: normalized, note: "" };
  }

  return {
    value: normalized.slice(0, noteMatch.index).trim(),
    note: noteMatch[1].trim()
  };
}

function cleanChurchName(value) {
  return normalizeText(value)
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[’`´]/gu, "'")
    .replace(/[^\p{L}\p{N}\s'-]/gu, "")
    .trim();
}

function parseClassHeader(line) {
  const normalized = normalizeText(line);
  if (/attendance\s*-/iu.test(normalized) || /classe\s+ouverte\s*-/iu.test(normalized)) {
    const parts = normalized.split(/\s+-\s+/);
    if (parts.length >= 3) {
      return {
        classCode: normalizeText(parts[1]),
        churchName: cleanChurchName(parts.slice(2).join(" - "))
      };
    }
  }

  const attendanceMatch = normalized.match(/attendance\s*-\s*(.+)$/iu);
  if (attendanceMatch) {
    return {
      classCode: "",
      churchName: cleanChurchName(attendanceMatch[1])
    };
  }

  return null;
}

function parseLessonTitle(line) {
  const normalized = normalizeText(line);
  const match = normalized.match(/titre[^:]*:\s*(.+)$/iu);
  return match ? match[1].trim() : "";
}

function parseTeacherLine(line) {
  const normalized = normalizeText(line);
  const directTeacherMatch = normalized.match(/^(?:[^\p{L}\p{N}]*)?(?:pst|pasteur|ev|instructeur)\.?\s+(.+)$/iu);
  if (directTeacherMatch) {
    return stripWrappingNote(directTeacherMatch[1]).value.trim();
  }

  const parts = normalized.split(/\s+-\s+/);
  if (parts.length < 2) {
    return "";
  }

  const rawTeacher = parts[parts.length - 1];
  const withoutNote = stripWrappingNote(rawTeacher).value;
  return normalizeText(
    withoutNote
      .replace(/\bInstructeur\b/giu, "")
      .replace(/\bInstructor\b/giu, "")
      .trim()
  );
}

function parseOrgDateCode(line) {
  const normalized = normalizeText(line);
  const isoMatch = normalized.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    return isoMatch[1];
  }

  const match = normalized.match(/\b(\d{6})\b/);
  if (!match) {
    return "";
  }

  const code = match[1];
  const year = 1983 + Number(code.slice(0, 2));
  return `${year}-${code.slice(2, 4)}-${code.slice(4, 6)}`;
}

function parseFrenchInlineDate(line) {
  const normalized = normalizeText(line);
  const monthMap = {
    janvier: "01",
    fevrier: "02",
    "février": "02",
    mars: "03",
    avril: "04",
    mai: "05",
    juin: "06",
    juillet: "07",
    aout: "08",
    "août": "08",
    septembre: "09",
    octobre: "10",
    novembre: "11",
    decembre: "12",
    "décembre": "12"
  };

  const match = normalized.match(/(\d{1,2})\s+([A-Za-zÀ-ÿ]+)/u);
  if (!match) {
    return "";
  }

  const day = String(match[1]).padStart(2, "0");
  const month = monthMap[String(match[2]).toLowerCase()];
  if (!month) {
    return "";
  }

  const yearMatch = normalized.match(/\b(20\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : String(new Date().getFullYear());
  return `${year}-${month}-${day}`;
}

function isLegendLine(line) {
  const normalized = normalizeText(line).toLowerCase();
  return (
    normalized.includes("confirme") ||
    normalized.includes("présent") ||
    normalized.includes("present") ||
    normalized.includes("caméra") ||
    normalized.includes("camera") ||
    normalized.includes("absent")
  );
}

function isTotalLine(line) {
  return /(?:^| )total\s*:/iu.test(normalizeText(line));
}

function isNonRegisteredHeader(line) {
  const normalized = normalizeText(line).toLowerCase();
  return normalized.includes("non inscrit") || normalized.includes("non-inscrit");
}

function parseGroupHeader(line) {
  const normalized = normalizeText(line);
  const match = normalized.match(/^[^\p{L}\p{N}]*(?<label>[A-Za-z][A-Za-z0-9 ]{1,30}?)(?:\s*\(\/?\d+\))?$/u);
  if (!match?.groups?.label) {
    return "";
  }

  const label = normalizeText(match.groups.label);
  if (!label || /\b(attendance|titre|total|instructeur|present|absent|confirme)\b/iu.test(label)) {
    return "";
  }

  return label.toUpperCase();
}

function detectStatus(prefix) {
  const rawPrefix = normalizeText(prefix);
  if (!rawPrefix) {
    return "unknown";
  }

  if (
    /[\u{274C}\u{2716}X]/u.test(rawPrefix) ||
    /(âŒ|âœ–ï¸|âœ–)/u.test(rawPrefix) ||
    /\b(absent|absence)\b/iu.test(rawPrefix)
  ) {
    return "absent";
  }

  if (
    /[\u{2705}\u{1F44D}\u{1F3A5}]/u.test(rawPrefix) ||
    /(âœ…|ðŸ‘|ðŸŽ¥)/u.test(rawPrefix) ||
    /\b(present|présent|confirme|confirmé)\b/iu.test(rawPrefix)
  ) {
    return "present";
  }

  if (/[^\p{L}\p{N}\s]/u.test(rawPrefix)) {
    return "present";
  }

  return "unknown";
}

function parseStudentLine(line) {
  const normalized = normalizeText(line);
  if (!normalized || isLegendLine(normalized) || isTotalLine(normalized)) {
    return { name: "", status: "", reason: "" };
  }

  const indexedMatch = normalized.match(/^(?<prefix>.*?)(?<index>\d+)\s*[-.)]\s*(?<rest>.+)$/u);
  if (!indexedMatch?.groups?.rest) {
    return { name: "", status: "", reason: "" };
  }

  const prefix = normalizeText(indexedMatch.groups.prefix);
  const rest = indexedMatch.groups.rest.trim();
  if (!rest || /^(?:\/?\d+|[A-Za-z]{1,5})$/u.test(rest)) {
    return { name: "", status: "", reason: "" };
  }

  const stripped = stripWrappingNote(rest);
  return {
    name: stripped.value,
    status: detectStatus(prefix),
    reason: stripped.note
  };
}

function parseAttendanceBlock(text, lessonDate = "") {
  const today = new Date().toISOString().slice(0, 10);
  const parsed = {
    class_code: "",
    church_name: "",
    teacher_name: "",
    lesson_title: "",
    lesson_date: normalizeIsoDate(lessonDate) || today,
    registered_students: [],
    unregistered_students: [],
    absence_notes: {},
    raw_text: text
  };

  let inNonRegistered = false;
  let currentGroup = "";

  for (const rawLine of String(text || "").split("\n")) {
    const line = normalizeText(rawLine);
    if (!line) {
      continue;
    }

    const classHeader = parseClassHeader(line);
    if (classHeader) {
      parsed.class_code = classHeader.classCode;
      parsed.church_name = classHeader.churchName;
      inNonRegistered = false;
      currentGroup = "";
      continue;
    }

    const lessonTitle = parseLessonTitle(line);
    if (lessonTitle) {
      parsed.lesson_title = lessonTitle;
      inNonRegistered = false;
      currentGroup = "";
      continue;
    }

    const directTeacher = parseTeacherLine(line);
    if (directTeacher && /^(?:[^\p{L}\p{N}]*)?(?:pst|pasteur|ev|instructeur)\.?\s+/iu.test(line)) {
      parsed.teacher_name = directTeacher;
      inNonRegistered = false;
      currentGroup = "";
      continue;
    }

    if (/\b(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/iu.test(line) || /(\d{1,2})\s+[A-Za-zÀ-ÿ]+/u.test(line)) {
      const inferredDate = parseFrenchInlineDate(line);
      if (inferredDate) {
        parsed.lesson_date = inferredDate;
      }

      const teacherName = parseTeacherLine(line);
      if (teacherName) {
        parsed.teacher_name = teacherName;
      }
      continue;
    }

    const orgDate = parseOrgDateCode(line);
    if (orgDate) {
      parsed.lesson_date = orgDate;
      if (directTeacher) {
        parsed.teacher_name = directTeacher;
      }
      continue;
    }

    if (isLegendLine(line) || isTotalLine(line)) {
      continue;
    }

    if (isNonRegisteredHeader(line)) {
      inNonRegistered = true;
      currentGroup = "";
      continue;
    }

    const detectedGroup = parseGroupHeader(line);
    if (detectedGroup) {
      currentGroup = detectedGroup;
      inNonRegistered = false;
      continue;
    }

    const student = parseStudentLine(line);
    if (!student.name) {
      continue;
    }

    if (inNonRegistered) {
      parsed.unregistered_students.push(student.name);
      if (student.reason) {
        parsed.absence_notes[student.name] = student.reason;
      }
      continue;
    }

    parsed.registered_students.push([student.name, student.status || "unknown", currentGroup]);
    if (student.reason) {
      parsed.absence_notes[student.name] = student.reason;
    }
  }

  return parsed;
}

module.exports = {
  normalizeIsoDate,
  parseAttendanceBlock,
  parseStudentLine
};
