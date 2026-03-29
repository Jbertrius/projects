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

function parseStudentLine(line) {
  const markerFirst = line.match(/^(✅|👍|✖️|✖|❌|X)\s*(\d*)\s*[-.\s]\s*(.*)$/u);
  const numberFirst = line.match(/^(\d+)\s*[-. ]\s*(.*)$/u);

  let namePart = "";
  let status = "unknown";

  if (markerFirst) {
    namePart = markerFirst[3].trim();
    status = ["✅", "👍"].includes(markerFirst[1]) ? "present" : "absent";
  } else if (numberFirst) {
    const rest = numberFirst[2].trim();
    const inner = rest.match(/^(✅|👍|✖️|✖|❌)\s*(.*)$/u);
    if (inner) {
      status = ["✅", "👍"].includes(inner[1]) ? "present" : "absent";
      namePart = inner[2].trim();
    } else {
      namePart = rest;
    }
  } else {
    return { name: "", status: "", reason: "" };
  }

  let reason = "";
  const reasonMatch = namePart.match(/\s*\(([^)]+)\)\s*$/);
  if (reasonMatch) {
    reason = reasonMatch[1].trim();
    namePart = namePart.slice(0, reasonMatch.index).trim();
  }

  return {
    name: namePart,
    status,
    reason
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

  for (const rawLine of String(text || "").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (line.includes("🔰")) {
      const parts = line.split(" - ");
      if (parts.length >= 3) {
        parsed.class_code = parts[1].trim();
        parsed.church_name = parts.slice(2).join(" - ").trim();
      }
      inNonRegistered = false;
      continue;
    }

    if (line.includes("👩")) {
      parsed.teacher_name = line.replace(/^[^\w]+/u, "").trim();
      inNonRegistered = false;
      continue;
    }

    if (line.includes("📝")) {
      const titleMatch = line.match(/:\s*(.+)$/);
      if (titleMatch) {
        parsed.lesson_title = titleMatch[1].trim();
      }
      inNonRegistered = false;
      continue;
    }

    const orgDate = line.match(/📆(\d{6})/u);
    if (orgDate) {
      const code = orgDate[1];
      parsed.lesson_date = `${1983 + Number(code.slice(0, 2))}-${code.slice(2, 4)}-${code.slice(4, 6)}`;
      inNonRegistered = false;
      continue;
    }

    if (line.includes("▫️") && line.toLowerCase().includes("non")) {
      inNonRegistered = true;
      continue;
    }

    if (/^total\s*:/i.test(line)) {
      continue;
    }

    const student = parseStudentLine(line);
    if (!student.name) {
      continue;
    }

    if (inNonRegistered) {
      parsed.unregistered_students.push(student.name);
    } else {
      parsed.registered_students.push([student.name, student.status]);
      if (student.reason) {
        parsed.absence_notes[student.name] = student.reason;
      }
    }
  }

  return parsed;
}

module.exports = {
  normalizeIsoDate,
  parseAttendanceBlock,
  parseStudentLine
};
