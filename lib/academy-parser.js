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
    .replace(/[\u2012\u2013\u2014\u2015\u2212]/g, "-")
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
    if (parts.length === 2) {
      return {
        classCode: normalizeText(parts[1]),
        churchName: ""
      };
    }
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
  return /(?:^|\s)total\b(?:\s*[:=])?(?:\s*\d+\s*\/\s*\d+)?/iu.test(normalizeText(line));
}

function isNonRegisteredHeader(line) {
  const normalized = normalizeText(line).toLowerCase();
  return normalized.includes("non inscrit") || normalized.includes("non-inscrit");
}

function isHashtagLine(line) {
  return /^#\S+/u.test(normalizeText(line));
}

function parseGroupHeader(line) {
  const normalized = normalizeText(line);
  const tokenMatch = normalized.match(/\b(?<label>CEP|DMD|R[ÉE]{2}COUTE|REECOUTE)\b/iu);
  if (!tokenMatch?.groups?.label) {
    return "";
  }

  const label = normalizeText(tokenMatch.groups.label);
  if (!label || /\b(attendance|titre|total|instructeur|present|absent|confirme)\b/iu.test(label)) {
    return "";
  }

  return label.toUpperCase();
}

function normalizeSectionLabel(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function isSupervisorHeader(line) {
  const normalized = normalizeText(line);
  return /^[^\p{L}\p{N}]*(?:[A-Za-zÀ-ÿ' -]{2,})\s*\(\d+\s*\/\s*\d+\)$/u.test(normalized);
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
  if (!normalized || isLegendLine(normalized) || isTotalLine(normalized) || isHashtagLine(normalized)) {
    return { name: "", status: "", reason: "" };
  }

  // Indexed format: [prefix][number][.-)] name  e.g. "✅ 1. Mane Massoly"
  const indexedMatch = normalized.match(/^(?<prefix>.*?)(?<index>\d+)\s*[-.)]\s*(?<rest>.+)$/u);
  if (indexedMatch?.groups?.rest) {
    const prefix = normalizeText(indexedMatch.groups.prefix);
    const rawRest = indexedMatch.groups.rest.trim();
    const restPrefixMatch = rawRest.match(/^(?<symbols>[^\p{L}\p{N}]+)\s*(?<name>.+)$/u);
    const restPrefix = restPrefixMatch?.groups?.symbols ? normalizeText(restPrefixMatch.groups.symbols) : "";
    const rest = restPrefixMatch?.groups?.name ? restPrefixMatch.groups.name.trim() : rawRest;
    if (!rest || /^(?:\/?\d+|[A-Za-z]{1,5})$/u.test(rest)) {
      return { name: "", status: "", reason: "" };
    }
    const stripped = stripWrappingNote(rest);
    return {
      name: stripped.value,
      status: detectStatus(`${prefix} ${restPrefix}`),
      reason: stripped.note
    };
  }

  // Non-indexed format: emoji/symbol prefix + name  e.g. "👍Mane Massoly" or "👍 Mane Massoly"
  const nonIndexedMatch = normalized.match(/^(?<prefix>[^\p{L}\p{N}]+)\s*(?<rest>\p{L}.+)$/u);
  if (nonIndexedMatch?.groups?.rest) {
    const prefix = normalizeText(nonIndexedMatch.groups.prefix);
    const rest = nonIndexedMatch.groups.rest.trim();
    if (isHashtagLine(rest)) {
      return { name: "", status: "", reason: "" };
    }
    const stripped = stripWrappingNote(rest);
    if (!stripped.value || stripped.value.length < 3) {
      return { name: "", status: "", reason: "" };
    }
    return {
      name: stripped.value,
      status: detectStatus(prefix),
      reason: stripped.note
    };
  }

  return { name: "", status: "", reason: "" };
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
  let skipSection = false;

  for (const rawLine of String(text || "").split("\n")) {
    const line = normalizeText(rawLine);
    const isIndexedEntryLine = /^[^\p{L}\p{N}]*(?:[Xx]\s*)?\d+\s*[-.)]\s*.+$/u.test(line);
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

    if (
      !isIndexedEntryLine &&
      /^(?:[^\p{L}\p{N}]*)?(?:date\s*:|lundi\b|mardi\b|mercredi\b|jeudi\b|vendredi\b|samedi\b|dimanche\b|\d{1,2}\s+[A-Za-zÀ-ÿ]+)/iu.test(line)
    ) {
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
      skipSection = false;
      continue;
    }

    const detectedGroup = parseGroupHeader(line);
    if (detectedGroup) {
      if (normalizeSectionLabel(detectedGroup) === "REECOUTE") {
        skipSection = true;
        inNonRegistered = false;
        currentGroup = "";
        continue;
      }

      skipSection = false;
      currentGroup = detectedGroup;
      inNonRegistered = false;
      continue;
    }

    if (skipSection || isSupervisorHeader(line)) {
      continue;
    }

    // Standalone teacher line: symbol-prefixed name with no separator or index
    // e.g. 👩‍🏫Eyram GSN  or  📌Jean PAUL
    if (!parsed.teacher_name) {
      const strippedLine = line.replace(/^[^\p{L}]+/u, "").trim();
      if (strippedLine && strippedLine !== line && strippedLine.includes(" ") && !/\d/.test(strippedLine)) {
        parsed.teacher_name = stripWrappingNote(strippedLine).value;
        continue;
      }
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
