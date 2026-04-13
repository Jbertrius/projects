const academyState = {
  rawData: {
    classes: [],
    students: [],
    attendance: [],
    unregistered: [],
    meta: {}
  },
  charts: {},
  filters: {
    classId: "all",
    studentId: "all",
    status: "all",
    rangePreset: "all",
    startDate: "",
    endDate: ""
  },
  entry: {
    isSaving: false,
    isOpen: false,
    selectedLessonId: "",
    selectedLessonMeta: null
  },
  studentRows: [],
  isLoading: false
};

function showFeedback(message, tone = "info") {
  const feedback = document.getElementById("app-feedback");
  if (!feedback) {
    return;
  }

  feedback.textContent = message;
  feedback.className = `app-feedback is-${tone}`;
  feedback.hidden = false;

  window.clearTimeout(showFeedback.timeoutId);
  showFeedback.timeoutId = window.setTimeout(() => {
    feedback.hidden = true;
  }, 5000);
}

function parseDateValue(value) {
  const parsed = new Date(value || "");
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isoDate(value) {
  const date = parseDateValue(value);
  return date ? date.toISOString().slice(0, 10) : "";
}

function formatDateLabel(value) {
  const date = parseDateValue(value);
  return date ? date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : value || "-";
}

function formatFullDate(value) {
  const date = parseDateValue(value);
  return date ? date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : value || "-";
}

function normalizeClassKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeStudentKey(value) {
  return normalizeClassKey(value);
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// Classes with a church_name are mission centres hosted in partner churches.
// They appear in the Developpement / Centres page, not in the Academie page.
function isMissionCentre(cls) {
  return Boolean(String(cls.church_name || "").trim());
}

function normalizeAcademyDataset(payload) {
  const classes = Array.isArray(payload?.classes) ? payload.classes : [];
  const students = Array.isArray(payload?.students) ? payload.students : [];
  const attendance = Array.isArray(payload?.attendance) ? payload.attendance : [];
  const unregistered = Array.isArray(payload?.unregistered) ? payload.unregistered : [];
  const classesByKey = new Map();
  const classAliases = new Map();

  classes.forEach((academyClass) => {
    const key = normalizeClassKey(academyClass.name || academyClass.class_code || academyClass.id);
    if (!key) {
      classAliases.set(String(academyClass.id), String(academyClass.id));
      return;
    }

    if (!classesByKey.has(key)) {
      classesByKey.set(key, { ...academyClass });
    } else {
      const canonical = classesByKey.get(key);
      canonical.student_ids = Array.from(
        new Set([...(canonical.student_ids || []), ...(academyClass.student_ids || [])].filter(Boolean))
      );
      canonical.evaluator_names = Array.from(
        new Set([...(canonical.evaluator_names || []), ...(academyClass.evaluator_names || [])].filter(Boolean))
      );
      if (!canonical.instructor_name && academyClass.instructor_name) {
        canonical.instructor_name = academyClass.instructor_name;
      }
    }

    classAliases.set(String(academyClass.id), String(classesByKey.get(key).id));
  });

  const normalizedClasses = Array.from(classesByKey.values());

  const classesById = new Map(normalizedClasses.map((item) => [String(item.id), item]));
  const studentsByKey = new Map();
  const studentAliases = new Map();

  students.forEach((student) => {
    const rawStudentId = String(student.id || "").trim();
    const nextClassId = classAliases.get(String(student.class_id || student.class_name)) || String(student.class_id || "");
    const canonicalClass = classesById.get(String(nextClassId));
    const studentName = String(student.name || "").trim();
    const studentNameKey = normalizeStudentKey(studentName);
    const fallbackId = rawStudentId || `${nextClassId || "unknown"}_stu_${studentNameKey || "unknown"}`;
    const dedupeKey = nextClassId && studentNameKey ? `${nextClassId}::${studentNameKey}` : `id::${fallbackId}`;
    const existing = studentsByKey.get(dedupeKey);

    if (!existing) {
      const canonicalStudent = {
        ...student,
        id: fallbackId,
        class_id: nextClassId,
        class_name: canonicalClass?.name || student.class_name || student.class_id || "",
        source_ids: [fallbackId]
      };
      studentsByKey.set(dedupeKey, canonicalStudent);
      if (rawStudentId) {
        studentAliases.set(rawStudentId, fallbackId);
      }
      return;
    }

    existing.source_ids = Array.from(new Set([...(existing.source_ids || []), fallbackId]));
    if (!String(existing.subgroup || "").trim() && String(student.subgroup || "").trim()) {
      existing.subgroup = student.subgroup;
    }
    if (String(existing.status || "").toLowerCase() !== "actif" && String(student.status || "").trim()) {
      existing.status = student.status;
    }
    if (!String(existing.class_name || "").trim()) {
      existing.class_name = canonicalClass?.name || student.class_name || student.class_id || "";
    }
    if (rawStudentId) {
      studentAliases.set(rawStudentId, existing.id);
    }
  });

  const normalizedStudents = Array.from(studentsByKey.values()).map((student) => ({
    ...student,
    source_ids: Array.from(new Set(student.source_ids || [String(student.id || "")].filter(Boolean)))
  }));
  const studentsByClassAndName = new Map(
    normalizedStudents
      .map((student) => {
        const key = `${String(student.class_id || "")}::${normalizeStudentKey(student.name || "")}`;
        return key ? [key, student] : null;
      })
      .filter(Boolean)
  );

  const normalizedAttendance = attendance.map((row) => {
    const nextClassId = classAliases.get(String(row.class_id || row.class_name)) || String(row.class_id || "");
    const canonicalClass = classesById.get(String(nextClassId));
    const aliasStudentId = studentAliases.get(String(row.student_id || "").trim()) || "";
    const studentByName = studentsByClassAndName.get(
      `${nextClassId}::${normalizeStudentKey(row.student_name || "")}`
    );
    const nextStudentId = aliasStudentId || studentByName?.id || String(row.student_id || "");
    return {
      ...row,
      student_id: nextStudentId,
      student_name: studentByName?.name || row.student_name || "",
      class_id: nextClassId,
      class_name: canonicalClass?.name || row.class_name || row.class_id || ""
    };
  });

  const normalizedUnregistered = unregistered.map((row) => {
    const nextClassId = classAliases.get(String(row.class_id || row.class_name)) || String(row.class_id || "");
    const canonicalClass = normalizedClasses.find((item) => String(item.id) === String(nextClassId));
    return {
      ...row,
      class_id: nextClassId,
      class_name: canonicalClass?.name || row.class_name || row.class_id || ""
    };
  });

  return {
    ...payload,
    classes: normalizedClasses,
    students: normalizedStudents,
    attendance: normalizedAttendance,
    unregistered: normalizedUnregistered,
    classAliases
  };
}

function buildSparseLabels(items) {
  if (!items.length) {
    return [];
  }

  const targetVisibleLabels = 7;
  const step = items.length <= targetVisibleLabels ? 1 : Math.ceil(items.length / targetVisibleLabels);

  return items.map((item, index) => {
    const isFirst = index === 0;
    const isLast = index === items.length - 1;
    return isFirst || isLast || index % step === 0 ? item.label : "";
  });
}

function buildLessonLibrary() {
  const classesById = new Map(academyState.rawData.classes.map((item) => [String(item.id), item]));
  const missionClassIds = new Set(
    academyState.rawData.classes.filter(isMissionCentre).map((cls) => String(cls.id))
  );
  const lessons = new Map();

  academyState.rawData.attendance.forEach((row) => {
    if (missionClassIds.has(String(row.class_id || ""))) return;
    const lessonId = String(row.lesson_id || "").trim();
    if (!lessonId) {
      return;
    }

      const existing = lessons.get(lessonId) || {
        id: lessonId,
        classId: String(row.class_id || ""),
        className: row.class_name || classesById.get(String(row.class_id || ""))?.name || "-",
        churchName: classesById.get(String(row.class_id || ""))?.church_name || "",
        title: row.lesson_title || "Lecon sans titre",
        date: isoDate(row.session_date),
        instructorName: classesById.get(String(row.class_id || ""))?.instructor_name || "-",
        attendanceCount: 0,
        presentCount: 0
    };

    existing.attendanceCount += 1;
    if (row.status === "present") {
      existing.presentCount += 1;
    }
    lessons.set(lessonId, existing);
  });

  return Array.from(lessons.values()).sort((left, right) => {
    return (right.date || "").localeCompare(left.date || "") || left.title.localeCompare(right.title, "fr");
  });
}

function formatInstructorLine(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }
  return /^(pst|pasteur|ev|instructeur)\b/iu.test(trimmed) ? trimmed : `Pst ${trimmed}`;
}

function getSubgroupHeader(groupName, count) {
  const normalized = String(groupName || "").trim().toUpperCase();
  if (!normalized || normalized === "SANS GROUPE") {
    return "";
  }

  const icon = normalized === "DMD" ? "⛪️" : "🕊";
  return `${icon}${normalized} (/${count})`;
}

function buildLessonTemplate(lesson) {
  const lessonRows = academyState.rawData.attendance
    .filter((row) => String(row.lesson_id || "") === String(lesson.id))
    .sort((left, right) => {
      const subgroupDelta = String(left.subgroup || "").localeCompare(String(right.subgroup || ""), "fr");
      if (subgroupDelta !== 0) {
        return subgroupDelta;
      }
      return String(left.student_name || "").localeCompare(String(right.student_name || ""), "fr");
    });
  const unregisteredRows = (academyState.rawData.unregistered || [])
    .filter((row) => String(row.lesson_id || "") === String(lesson.id))
    .sort((left, right) => {
      return String(left.student_name || "").localeCompare(String(right.student_name || ""), "fr");
    });
  const total = lessonRows.length;
  const presentCount = lessonRows.filter((row) => row.status === "present").length;
  const groups = new Map();

  lessonRows.forEach((row) => {
    const key = String(row.subgroup || "").trim() || "Sans groupe";
    const bucket = groups.get(key) || [];
    bucket.push(row);
    groups.set(key, bucket);
  });

  let runningIndex = 1;
  const groupBlocks = Array.from(groups.entries()).map(([groupName, rows]) => {
    const header = getSubgroupHeader(groupName, rows.length);
    const lines = rows.map((row) => {
      const prefix = row.status === "absent" ? "✖️" : "👍";
      const note = String(row.evaluation_note || "").trim();
      const line = `${prefix}${runningIndex}- ${row.student_name}${note ? ` (${note})` : ""}`;
      runningIndex += 1;
      return line;
    });

    if (!header) {
      return lines.join("\n");
    }

    return [header, ...lines].join("\n");
  });

  const unregisteredBlock = unregisteredRows.length
    ? [
        "▫️Non inscrit",
        ...unregisteredRows.map((row, index) => {
          const note = String(row.note || row.evaluation_note || "").trim();
          return `👍${index + 1}- ${row.student_name}${note ? ` (${note})` : ""}`;
        })
      ].join("\n")
    : "";

  return [
    `🔰Classe Ouverte - ${lesson.className} - ${lesson.churchName || "Centre academie"}`,
    `👩‍🏫${formatInstructorLine(lesson.instructorName)}`,
    `📝Titre de la leçon : ${lesson.title}`,
    `📆${lesson.date || ""}`,
    "",
    "✅ Confirmé",
    "👍 Présent",
    "❌ Absent",
    "",
    `Total :${presentCount}/${total}`,
    "",
    ...groupBlocks,
    unregisteredBlock ? "" : null,
    unregisteredBlock || null
  ]
    .filter((line) => line !== null)
    .filter((line, index, array) => !(line === "" && array[index - 1] === ""))
    .join("\n");
}

function createKpiCard(kpi) {
  return `
    <article class="card kpi-card">
      <p class="section-label">${kpi.label}</p>
      <div class="kpi-value">${kpi.value}</div>
      <div class="kpi-delta tone-${kpi.tone}">${kpi.delta}</div>
    </article>
  `;
}

function getChartBaseOptions() {
  return {
    chart: {
      fontFamily: "Instrument Sans, sans-serif",
      toolbar: { show: false },
      zoom: { enabled: false },
      animations: { easing: "easeinout", speed: 420 }
    },
    dataLabels: { enabled: false },
    grid: {
      borderColor: "rgba(37, 137, 200, 0.12)",
      strokeDashArray: 4
    },
    tooltip: { theme: "light" }
  };
}

function destroyChart(key) {
  if (academyState.charts[key]) {
    academyState.charts[key].destroy();
    delete academyState.charts[key];
  }
}

async function mountChart(key, elementId, options) {
  const element = document.getElementById(elementId);
  if (!element) {
    return;
  }

  if (typeof ApexCharts === "undefined") {
    element.innerHTML = `<div class="empty-state">Les graphiques ne sont pas disponibles.</div>`;
    return;
  }

  destroyChart(key);
  element.innerHTML = "";
  const chart = new ApexCharts(element, options);
  academyState.charts[key] = chart;
  await chart.render();
}

function renderEmptyChart(key, elementId, message) {
  destroyChart(key);
  const element = document.getElementById(elementId);
  if (element) {
    element.innerHTML = `<div class="empty-state">${message}</div>`;
  }
}

function updateRefreshButton() {
  const button = document.getElementById("academy-refresh");
  if (button) {
    button.disabled = academyState.isLoading;
    button.textContent = academyState.isLoading ? "Actualisation..." : "Actualiser";
  }

  const saveButton = document.getElementById("academy-save-entry");
  const replaceExisting = Boolean(document.getElementById("academy-entry-replace")?.checked);
  if (saveButton) {
    saveButton.disabled = academyState.entry.isSaving;
    saveButton.textContent = academyState.entry.isSaving
      ? (replaceExisting ? "Mise a jour..." : "Enregistrement...")
      : (replaceExisting ? "Mettre a jour la lecon" : "Enregistrer la lecon");
  }

  const deleteButton = document.getElementById("academy-delete-entry");
  if (deleteButton) {
    deleteButton.disabled = academyState.entry.isSaving;
    deleteButton.textContent = academyState.entry.isSaving ? "Suppression..." : "Supprimer la lecon";
  }
}

function setEntryOpen(isOpen) {
  academyState.entry.isOpen = Boolean(isOpen);
  const body = document.getElementById("academy-entry-body");
  const toggle = document.getElementById("academy-toggle-entry");
  const openButton = document.getElementById("academy-open-entry");

  if (body) {
    body.hidden = !academyState.entry.isOpen;
  }
  if (toggle) {
    toggle.setAttribute("aria-expanded", academyState.entry.isOpen ? "true" : "false");
    toggle.textContent = academyState.entry.isOpen ? "Masquer le formulaire" : "Afficher le formulaire";
  }
  if (openButton) {
    openButton.textContent = academyState.entry.isOpen ? "Lecon ouverte" : "Nouvelle lecon";
  }
}

function getDataDateBounds() {
  const dates = academyState.rawData.attendance
    .map((row) => isoDate(row.session_date))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  return {
    min: dates[0] || "",
    max: dates[dates.length - 1] || ""
  };
}

function syncRangeInputs() {
  const startInput = document.getElementById("academy-start-date");
  const endInput = document.getElementById("academy-end-date");
  if (startInput) {
    startInput.value = academyState.filters.startDate || "";
  }
  if (endInput) {
    endInput.value = academyState.filters.endDate || "";
  }

  document.querySelectorAll("[data-range-preset]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.rangePreset === academyState.filters.rangePreset);
  });
}

function applyRangePreset(preset) {
  const { min, max } = getDataDateBounds();
  academyState.filters.rangePreset = preset;

  if (!max) {
    academyState.filters.startDate = "";
    academyState.filters.endDate = "";
    syncRangeInputs();
    return;
  }

  if (preset === "all") {
    academyState.filters.startDate = min;
    academyState.filters.endDate = max;
    syncRangeInputs();
    return;
  }

  const maxDate = parseDateValue(max);
  if (!maxDate) {
    academyState.filters.startDate = "";
    academyState.filters.endDate = "";
    syncRangeInputs();
    return;
  }

  const days = preset === "7d" ? 6 : 29;
  const startDate = new Date(maxDate);
  startDate.setDate(startDate.getDate() - days);

  academyState.filters.startDate = startDate.toISOString().slice(0, 10);
  academyState.filters.endDate = max;
  syncRangeInputs();
}

function buildView() {
  const classFilter = academyState.filters.classId;
  const studentFilter = academyState.filters.studentId;
  const statusFilter = academyState.filters.status;
  const startDate = academyState.filters.startDate;
  const endDate = academyState.filters.endDate;

  const classesById = new Map(academyState.rawData.classes.map((item) => [String(item.id), item]));
  const missionClassIds = new Set(
    academyState.rawData.classes.filter(isMissionCentre).map((cls) => String(cls.id))
  );
  const registeredStudents = academyState.rawData.students.filter(
    (student) => student.is_registered !== false && !missionClassIds.has(String(student.class_id || ""))
  );
  const students = registeredStudents.filter((student) => {
    const classOk = classFilter === "all" || String(student.class_id || student.class_name) === classFilter;
    const studentOk = studentFilter === "all" || String(student.id) === studentFilter;
    return classOk && studentOk;
  });

  const studentIds = new Set(students.map((student) => String(student.id)));
  const attendance = academyState.rawData.attendance.filter((row) => {
    const rowDate = isoDate(row.session_date);
    const belongsToStudent = studentIds.size > 0 && studentIds.has(String(row.student_id));
    const classOk =
      classFilter === "all" ||
      String(row.class_id || row.class_name) === classFilter ||
      students.some((student) => String(student.id) === String(row.student_id));
    const statusOk = statusFilter === "all" || String(row.status) === statusFilter;
    const startOk = !startDate || (rowDate && rowDate >= startDate);
    const endOk = !endDate || (rowDate && rowDate <= endDate);
    return belongsToStudent && classOk && statusOk && startOk && endOk;
  });

  const presenceByLesson = new Map();
  const statusCounts = { present: 0, absent: 0, late: 0, excused: 0, unknown: 0 };
  const studentStats = new Map();

  attendance.forEach((row) => {
    const lessonKey = String(row.lesson_id || `${row.session_date || ""}-${row.lesson_title || ""}`).trim();
    const bucket = presenceByLesson.get(lessonKey) || {
      key: lessonKey,
      lessonTitle: row.lesson_title || "Lecon sans titre",
      date: isoDate(row.session_date),
      present: 0,
      total: 0
    };
    bucket.total += 1;
    if (row.status === "present") {
      bucket.present += 1;
    }
    presenceByLesson.set(lessonKey, bucket);

    statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;

    const studentKey = String(row.student_id || "");
    const current = studentStats.get(studentKey) || {
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
      unknown: 0,
      scoreTotal: 0,
      scoreCount: 0
    };
    current[row.status] = (current[row.status] || 0) + 1;
    if (Number.isFinite(Number(row.evaluation_score)) && Number(row.evaluation_score) > 0) {
      current.scoreTotal += Number(row.evaluation_score);
      current.scoreCount += 1;
    }
    studentStats.set(studentKey, current);
  });

  const studentRows = students
    .map((student) => {
      const stats = studentStats.get(String(student.id)) || {
        present: 0,
        absent: 0,
        late: 0,
        excused: 0,
        unknown: 0,
        scoreTotal: 0,
        scoreCount: 0
      };
      const academyClass = classesById.get(String(student.class_id || student.class_name));
      const averageScore = stats.scoreCount ? Math.round((stats.scoreTotal / stats.scoreCount) * 10) / 10 : 0;
      return {
        ...student,
        class_label: student.class_name || academyClass?.name || student.class_id || "-",
        instructor_name: academyClass?.instructor_name || "-",
        present: stats.present || 0,
        absent: stats.absent || 0,
        late: stats.late || 0,
        excused: stats.excused || 0,
        unknown: stats.unknown || 0,
        averageScore
      };
    })
    .sort((a, b) => b.present - a.present || a.name.localeCompare(b.name, "fr"));

  const classesSummary = academyState.rawData.classes
    .filter((cls) => !isMissionCentre(cls))
    .map((academyClass) => {
      const classStudents = academyState.rawData.students.filter(
        (student) => student.is_registered !== false && String(student.class_id || student.class_name) === String(academyClass.id)
      );
      if (classFilter !== "all" && String(academyClass.id) !== classFilter) {
        return null;
      }

      const classStudentIds = new Set(classStudents.map((student) => String(student.id)));
      const classAttendance = attendance.filter((row) => classStudentIds.has(String(row.student_id)));
      const presentCount = classAttendance.filter((row) => row.status === "present").length;
      const rate = classAttendance.length ? Math.round((presentCount / classAttendance.length) * 100) : 0;
      return {
        id: academyClass.id,
        name: academyClass.name,
        instructor_name: academyClass.instructor_name || "-",
        rate
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name, "fr"));

  const trajectory = Array.from(presenceByLesson.values())
    .sort((left, right) => {
      const leftDate = left.date || "";
      const rightDate = right.date || "";
      return leftDate.localeCompare(rightDate) || left.lessonTitle.localeCompare(right.lessonTitle, "fr");
    })
    .map((item) => ({
      key: item.key,
      label: item.date ? `${formatDateLabel(item.date)}` : item.lessonTitle,
      value: item.present,
      total: item.total,
      lessonTitle: item.lessonTitle,
      date: item.date
    }));

  const totalAttendance = attendance.length;
  const presentCount = statusCounts.present || 0;
  const absenceCount = statusCounts.absent || 0;
  const presenceRate = totalAttendance ? Math.round((presentCount / totalAttendance) * 100) : 0;
  const lateCount = statusCounts.late || 0;
  const rangeDescription =
    academyState.filters.rangePreset === "all"
      ? "toute la periode"
      : `${academyState.filters.startDate || "-"} au ${academyState.filters.endDate || "-"}`;

  return {
    kpis: [
      {
        label: "Classes actives",
        value: classesSummary.length,
        delta: `${students.length} etudiants visibles`,
        tone: "neutral"
      },
      {
        label: "Taux de presence",
        value: `${presenceRate}%`,
        delta: `${presentCount} presences sur ${rangeDescription}`,
        tone: presenceRate >= 80 ? "positive" : "warning"
      },
      {
        label: "Absences",
        value: absenceCount,
        delta: `${lateCount} retards sur la plage`,
        tone: absenceCount > 0 ? "warning" : "positive"
      },
      {
        label: "Lecons visibles",
        value: trajectory.length,
        delta: trajectory.length ? trajectory[trajectory.length - 1].lessonTitle : "Aucune lecon",
        tone: "neutral"
      }
    ],
    trajectory,
    classesSummary,
    studentRows,
    statusCounts
  };
}

function getFilteredAndSortedStudentRows() {
  const rows = Array.isArray(academyState.studentRows) ? [...academyState.studentRows] : [];
  const searchValue = normalizeSearchText(document.getElementById("academy-students-search")?.value || "");
  const presenceFilter = String(document.getElementById("academy-students-presence-filter")?.value || "all");
  const sortMode = String(document.getElementById("academy-students-sort")?.value || "present_desc");

  const filtered = rows.filter((student) => {
    if (presenceFilter === "absent" && Number(student.absent || 0) <= 0) {
      return false;
    }
    if (presenceFilter === "perfect" && Number(student.absent || 0) > 0) {
      return false;
    }

    if (!searchValue) {
      return true;
    }

    const haystack = normalizeSearchText([student.name, student.class_label, student.instructor_name].join(" "));
    return haystack.includes(searchValue);
  });

  filtered.sort((a, b) => {
    if (sortMode === "name_asc") {
      return String(a.name || "").localeCompare(String(b.name || ""), "fr");
    }
    if (sortMode === "name_desc") {
      return String(b.name || "").localeCompare(String(a.name || ""), "fr");
    }
    if (sortMode === "class_asc") {
      return String(a.class_label || "").localeCompare(String(b.class_label || ""), "fr")
        || String(a.name || "").localeCompare(String(b.name || ""), "fr");
    }
    if (sortMode === "absent_desc") {
      return Number(b.absent || 0) - Number(a.absent || 0)
        || Number(b.present || 0) - Number(a.present || 0)
        || String(a.name || "").localeCompare(String(b.name || ""), "fr");
    }
    if (sortMode === "score_desc") {
      return Number(b.averageScore || 0) - Number(a.averageScore || 0)
        || Number(b.present || 0) - Number(a.present || 0)
        || String(a.name || "").localeCompare(String(b.name || ""), "fr");
    }

    return Number(b.present || 0) - Number(a.present || 0)
      || Number(a.absent || 0) - Number(b.absent || 0)
      || String(a.name || "").localeCompare(String(b.name || ""), "fr");
  });

  return filtered;
}

function renderStudentsTable() {
  const tbody = document.getElementById("academy-students-table");
  if (!tbody) {
    return;
  }

  const rows = getFilteredAndSortedStudentRows();

  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-table">Aucune donnee ne correspond au filtre ou au tri selectionne.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rows
    .map(
      (student) => `
        <tr>
          <td>${student.name}</td>
          <td>${student.class_label}</td>
          <td>${student.instructor_name}</td>
          <td>${student.present}</td>
          <td>${student.absent}</td>
          <td>${student.averageScore || "-"}</td>
        </tr>
      `
    )
    .join("");
}

function attachStudentsTableHandlers() {
  const rerender = () => renderStudentsTable();
  document.getElementById("academy-students-search")?.addEventListener("input", rerender);
  document.getElementById("academy-students-presence-filter")?.addEventListener("change", rerender);
  document.getElementById("academy-students-sort")?.addEventListener("change", rerender);
}

function renderLessonLibrary() {
  const listElement = document.getElementById("academy-lesson-list");
  const classFilter = document.getElementById("academy-lesson-class-filter");
  const searchInput = document.getElementById("academy-lesson-search");
  if (!listElement || !classFilter || !searchInput) {
    return;
  }

  const lessons = buildLessonLibrary();
  const academyOnlyClasses = academyState.rawData.classes.filter((cls) => !isMissionCentre(cls));
  const previousClassValue = classFilter.value || "all";
  classFilter.innerHTML = [
    `<option value="all">Toutes les classes</option>`,
    ...academyOnlyClasses.map((academyClass) => `<option value="${academyClass.id}">${academyClass.name}</option>`)
  ].join("");
  classFilter.value = academyOnlyClasses.some((academyClass) => String(academyClass.id) === previousClassValue)
    ? previousClassValue
    : "all";

  if (!classFilter.dataset.bound) {
    classFilter.addEventListener("change", renderLessonLibrary);
    classFilter.dataset.bound = "true";
  }
  if (!searchInput.dataset.bound) {
    searchInput.addEventListener("input", renderLessonLibrary);
    searchInput.dataset.bound = "true";
  }

  const searchTerm = String(searchInput.value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  const selectedClass = classFilter.value || "all";
  const filteredLessons = lessons.filter((lesson) => {
    const classOk = selectedClass === "all" || String(lesson.classId) === selectedClass;
    if (!classOk) {
      return false;
    }
    if (!searchTerm) {
      return true;
    }
    const haystack = [lesson.title, lesson.className, lesson.date, lesson.instructorName]
      .join(" ")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return haystack.includes(searchTerm);
  });

  if (!filteredLessons.length) {
    listElement.innerHTML = `<div class="empty-state">Aucune lecon ne correspond a la recherche.</div>`;
    return;
  }

  listElement.innerHTML = filteredLessons
    .map((lesson) => {
      const isSelected = academyState.entry.selectedLessonId === lesson.id;
      return `
        <article class="academy-lesson-item${isSelected ? " is-selected" : ""}">
          <div class="academy-lesson-row">
            <div>
              <h4 class="academy-lesson-title">${lesson.title}</h4>
              <div class="academy-lesson-meta">
                <span class="academy-lesson-chip">${lesson.className}</span>
                <span class="academy-lesson-chip">${formatFullDate(lesson.date)}</span>
                <span class="academy-lesson-chip">${lesson.presentCount}/${lesson.attendanceCount} presents</span>
              </div>
            </div>
            <span class="academy-lesson-chip">${lesson.instructorName || "-"}</span>
          </div>
          <div class="academy-lesson-actions">
            <button class="secondary-action compact-action" type="button" data-lesson-load="${lesson.id}">Charger</button>
            <button class="secondary-action compact-action" type="button" data-lesson-delete="${lesson.id}">Supprimer</button>
          </div>
        </article>
      `;
    })
    .join("");

  listElement.querySelectorAll("[data-lesson-load]").forEach((button) => {
    button.addEventListener("click", () => {
      const lesson = lessons.find((item) => item.id === button.dataset.lessonLoad);
      if (!lesson) {
        return;
      }
      academyState.entry.selectedLessonId = lesson.id;
      academyState.entry.selectedLessonMeta = {
        lessonId: lesson.id,
        classId: lesson.classId,
        classCode: lesson.className,
        lessonTitle: lesson.title,
        teacherName: lesson.instructorName
      };
      const textarea = document.getElementById("academy-entry-text");
      const dateInput = document.getElementById("academy-entry-date");
      const replaceInput = document.getElementById("academy-entry-replace");
      if (textarea) {
        textarea.value = buildLessonTemplate(lesson);
      }
      if (dateInput) {
        dateInput.value = lesson.date || "";
      }
      if (replaceInput) {
        replaceInput.checked = true;
      }
      setEntryOpen(true);
      updateRefreshButton();
      renderLessonLibrary();
      renderEntryValidation(
        validateEntry(textarea?.value || "", dateInput?.value || "")
      );
      showFeedback(`Lecon chargee: ${lesson.title}. Tu peux maintenant la mettre a jour ou la supprimer.`, "success");
      document.getElementById("academy-entry-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  listElement.querySelectorAll("[data-lesson-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const lesson = lessons.find((item) => item.id === button.dataset.lessonDelete);
      if (!lesson) {
        return;
      }
      const confirmed = window.confirm(
        `Supprimer la lecon "${lesson.title}" du ${lesson.date} pour la classe ${lesson.className} ?`
      );
      if (!confirmed) {
        return;
      }

      academyState.entry.isSaving = true;
      updateRefreshButton();
        try {
          const response = await fetch("/api/academy/record-lesson", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              rawText: buildLessonTemplate(lesson),
              lessonDate: lesson.date,
              lessonId: lesson.id,
              classId: lesson.classId,
              classCode: lesson.className,
              lessonTitle: lesson.title,
              teacherName: lesson.instructorName,
              deleteExisting: true,
              replaceExisting: false
            })
          });
        const payload = await response.json();
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error || "Impossible de supprimer la lecon.");
        }
        academyState.entry.selectedLessonId = "";
        academyState.entry.selectedLessonMeta = null;
        showFeedback(`Lecon supprimee: ${lesson.title}.`, "success");
        await loadAcademy();
      } catch (error) {
        showFeedback(error.message, "error");
      } finally {
        academyState.entry.isSaving = false;
        updateRefreshButton();
      }
    });
  });
}

async function renderPresenceChart(items) {
  if (!items.length) {
    renderEmptyChart("academyPresence", "academy-presence-chart", "Aucune presence disponible pour le moment.");
    return;
  }

  const sparseLabels = buildSparseLabels(items);

  await mountChart("academyPresence", "academy-presence-chart", {
    ...getChartBaseOptions(),
    chart: { ...getChartBaseOptions().chart, type: "area", height: 320 },
    colors: ["#0e7d3a"],
    stroke: { curve: "smooth", width: 4 },
    fill: {
      type: "gradient",
      gradient: { opacityFrom: 0.28, opacityTo: 0.04, stops: [0, 90, 100] }
    },
    series: [{ name: "Presences", data: items.map((item) => item.value) }],
    xaxis: {
      categories: sparseLabels,
      labels: {
        rotate: -22,
        trim: true,
        hideOverlappingLabels: true
      },
      tooltip: {
        enabled: false
      }
    },
    yaxis: { min: 0, forceNiceScale: true },
    tooltip: {
      theme: "light",
      custom: ({ dataPointIndex }) => {
        const meta = items[dataPointIndex] || {};
        return `
          <div class="academy-tooltip">
            <div class="academy-tooltip-title">${meta.lessonTitle || "Lecon sans titre"}</div>
            <div class="academy-tooltip-row"><span>Date</span><strong>${formatFullDate(meta.date)}</strong></div>
            <div class="academy-tooltip-row"><span>Presence</span><strong>${meta.value ?? 0}</strong></div>
            <div class="academy-tooltip-row"><span>Pointages</span><strong>${meta.total || 0}</strong></div>
          </div>
        `;
      }
    }
  });
}

async function renderClassesChart(items) {
  if (!items.length) {
    renderEmptyChart("academyClasses", "academy-classes-chart", "Aucune classe disponible.");
    return;
  }

  await mountChart("academyClasses", "academy-classes-chart", {
    ...getChartBaseOptions(),
    chart: {
      ...getChartBaseOptions().chart,
      type: "bar",
      height: 320,
      cursor: "pointer",
      events: {
        dataPointSelection: (_e, _ctx, config) => {
          const item = items[config.dataPointIndex];
          if (item?.id) window.location.href = `/classe.html?id=${encodeURIComponent(item.id)}`;
        }
      }
    },
    series: [{ name: "Presence", data: items.map((item) => item.rate) }],
    plotOptions: { bar: { horizontal: true, borderRadius: 8, barHeight: "52%" } },
    colors: ["#2589c8"],
    xaxis: { categories: items.map((item) => item.name), max: 100 },
    tooltip: { theme: "light", y: { formatter: (value) => `${value}% — cliquer pour details` } },
    legend: { show: false }
  });
}

async function renderStatusChart(statusCounts) {
  const labels = [
    ["Present", statusCounts.present || 0],
    ["Absent", statusCounts.absent || 0],
    ["Retard", statusCounts.late || 0],
    ["Excuse", statusCounts.excused || 0],
    ["Inconnu", statusCounts.unknown || 0]
  ].filter(([, value]) => value > 0);

  if (!labels.length) {
    renderEmptyChart("academyStatus", "academy-status-chart", "Aucun statut disponible.");
    return;
  }

  await mountChart("academyStatus", "academy-status-chart", {
    ...getChartBaseOptions(),
    chart: { ...getChartBaseOptions().chart, type: "donut", height: 320 },
    labels: labels.map(([label]) => label),
    series: labels.map(([, value]) => value),
    colors: ["#0e7d3a", "#f5c32c", "#51b7ea", "#8ab8d0", "#95a7bd"],
    legend: { position: "bottom" },
    plotOptions: {
      pie: {
        donut: {
          size: "68%",
          labels: {
            show: true,
            total: {
              show: true,
              label: "Pointages",
              formatter: () => String(labels.reduce((sum, [, value]) => sum + value, 0))
            }
          }
        }
      }
    }
  });
}

function populateFilters() {
  const classFilter = document.getElementById("academy-class-filter");
  const studentFilter = document.getElementById("academy-student-filter");
  if (!classFilter || !studentFilter) {
    return;
  }

  const academyClasses = academyState.rawData.classes.filter((cls) => !isMissionCentre(cls));
  const missionClassIds = new Set(
    academyState.rawData.classes.filter(isMissionCentre).map((cls) => String(cls.id))
  );
  classFilter.innerHTML = [
    `<option value="all">Toutes les classes</option>`,
    ...academyClasses.map((academyClass) => `<option value="${academyClass.id}">${academyClass.name}</option>`)
  ].join("");

  const visibleStudents = academyState.filters.classId === "all"
    ? academyState.rawData.students.filter((student) => student.is_registered !== false && !missionClassIds.has(String(student.class_id || "")))
    : academyState.rawData.students.filter(
        (student) => student.is_registered !== false && !missionClassIds.has(String(student.class_id || "")) && String(student.class_id || student.class_name) === academyState.filters.classId
      );

  studentFilter.innerHTML = [
    `<option value="all">Tous les etudiants</option>`,
    ...visibleStudents.map((student) => `<option value="${student.id}">${student.name}</option>`)
  ].join("");

  classFilter.value = academyState.filters.classId;
  studentFilter.value = visibleStudents.some((student) => String(student.id) === academyState.filters.studentId)
    ? academyState.filters.studentId
    : "all";
  academyState.filters.studentId = studentFilter.value;
  syncRangeInputs();
}

async function renderAcademy() {
  populateFilters();
  const view = buildView();
  academyState.studentRows = view.studentRows;
  document.getElementById("academy-kpis").innerHTML = view.kpis.map(createKpiCard).join("");
  renderStudentsTable();
  renderLessonLibrary();
  await Promise.all([
    renderPresenceChart(view.trajectory),
    renderClassesChart(view.classesSummary),
    renderStatusChart(view.statusCounts)
  ]);
}

async function loadAcademy() {
  academyState.isLoading = true;
  updateRefreshButton();

  try {
    const response = await fetch(`/api/academy?ts=${Date.now()}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "Impossible de charger les donnees academie.");
    }

      const normalizedPayload = normalizeAcademyDataset(payload);
      academyState.rawData = normalizedPayload;
      if (academyState.filters.classId !== "all") {
        academyState.filters.classId =
          normalizedPayload.classAliases?.get(String(academyState.filters.classId)) || academyState.filters.classId;
      }
      document.getElementById("academy-refresh-label").textContent = payload.meta?.refreshLabel || "Donnees academie";
    if (!academyState.filters.startDate && !academyState.filters.endDate) {
      applyRangePreset(academyState.filters.rangePreset || "all");
    } else {
      syncRangeInputs();
    }
    await renderAcademy();
  } finally {
    academyState.isLoading = false;
    updateRefreshButton();
  }
}

function normalizeIsoDate(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const dmyMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return dmyMatch ? `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}` : "";
}

function normalizeEntryLine(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\u200B-\u200D\uFE0F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTrailingNote(value) {
  const normalized = normalizeEntryLine(value);
  const noteMatch = normalized.match(/\s*\(([^)]+)\)\s*$/);
  if (!noteMatch) {
    return { value: normalized, note: "" };
  }
  return {
    value: normalized.slice(0, noteMatch.index).trim(),
    note: noteMatch[1].trim()
  };
}

function isHashtagLine(line) {
  return /^#\S+/u.test(normalizeEntryLine(line));
}

function detectEntryStatus(prefix) {
  const rawPrefix = normalizeEntryLine(prefix);
  if (!rawPrefix) {
    return "unknown";
  }
  if (/[\u{274C}\u{2716}X]/u.test(rawPrefix) || /\b(absent|absence)\b/iu.test(rawPrefix)) {
    return "absent";
  }
  if (
    /[\u{2705}\u{1F44D}\u{1F3A5}]/u.test(rawPrefix) ||
    /\b(present|présent|confirme|confirmé)\b/iu.test(rawPrefix) ||
    /[^\p{L}\p{N}\s]/u.test(rawPrefix)
  ) {
    return "present";
  }
  return "unknown";
}

function parseStudentLine(line) {
  const normalized = normalizeEntryLine(line);
  if (!normalized || parseLegendLine(normalized) || isTotalEntryLine(normalized) || isHashtagLine(normalized)) {
    return null;
  }

  const indexedMatch = normalized.match(/^(?<prefix>.*?)(?<index>\d+)\s*[-.)]\s*(?<rest>.+)$/u);
  if (indexedMatch?.groups?.rest) {
    const rawRest = indexedMatch.groups.rest.trim();
    const restPrefixMatch = rawRest.match(/^(?<symbols>[^\p{L}\p{N}]+)\s*(?<name>.+)$/u);
    const restPrefix = restPrefixMatch?.groups?.symbols ? normalizeEntryLine(restPrefixMatch.groups.symbols) : "";
    const restName = restPrefixMatch?.groups?.name ? restPrefixMatch.groups.name.trim() : rawRest;
    return {
      name: stripTrailingNote(restName).value,
      status: detectEntryStatus(`${indexedMatch.groups.prefix} ${restPrefix}`)
    };
  }

  const nonIndexedMatch = normalized.match(/^(?<prefix>[^\p{L}\p{N}]+)\s*(?<rest>\p{L}.+)$/u);
  if (!nonIndexedMatch?.groups?.rest || isHashtagLine(nonIndexedMatch.groups.rest)) {
    return null;
  }

  const stripped = stripTrailingNote(nonIndexedMatch.groups.rest.trim()).value;
  if (!stripped || stripped.length < 3) {
    return null;
  }

  return {
    name: stripped,
    status: detectEntryStatus(nonIndexedMatch.groups.prefix)
  };
}

function parseLegendLine(line) {
  const normalized = normalizeEntryLine(line).toLowerCase();
  return (
    normalized.includes("confirme") ||
    normalized.includes("présent") ||
    normalized.includes("present") ||
    normalized.includes("caméra") ||
    normalized.includes("camera") ||
    normalized.includes("absent")
  );
}

function isTotalEntryLine(line) {
  return /(?:^|\s)total\b(?:\s*[:=])?(?:\s*\d+\s*\/\s*\d+)?/iu.test(normalizeEntryLine(line));
}

function parseFrenchInlineDate(line) {
  const normalized = normalizeEntryLine(line);
  const monthMap = {
    janvier: "01",
    fevrier: "02",
    février: "02",
    mars: "03",
    avril: "04",
    mai: "05",
    juin: "06",
    juillet: "07",
    aout: "08",
    août: "08",
    septembre: "09",
    octobre: "10",
    novembre: "11",
    decembre: "12",
    décembre: "12"
  };
  const match = normalized.match(/(\d{1,2})\s+([A-Za-zÀ-ÿ?]+)/iu);
  if (!match) {
    return "";
  }
  const month = monthMap[String(match[2]).toLowerCase()];
  if (!month) {
    return "";
  }
  const day = String(match[1]).padStart(2, "0");
  return `${new Date().getFullYear()}-${month}-${day}`;
}

function parseGroupHeader(line) {
  const normalized = normalizeEntryLine(line);
  const match = normalized.match(/\b(?<label>CEP|DMD|R[ÉE]{2}COUTE|REECOUTE)\b/iu);
  if (!match?.groups?.label) {
    return "";
  }
  const label = String(match.groups.label || "").trim().toUpperCase();
  if (!label || /\b(ATTENDANCE|TITRE|TOTAL|INSTRUCTEUR|PRESENT|ABSENT|CONFIRME)\b/u.test(label)) {
    return "";
  }
  return label;
}

function normalizeSectionLabel(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function isSupervisorHeader(line) {
  const normalized = normalizeEntryLine(line);
  return /^[^\p{L}\p{N}]*(?:[A-Za-zÀ-ÿ' -]{2,})\s*\(\d+\s*\/\s*\d+\)$/u.test(normalized);
}

function validateEntry(rawText, rawDate) {
  const lines = String(rawText || "")
    .split("\n")
    .map((line) => normalizeEntryLine(line))
    .filter(Boolean);

  const issues = [];
  const parsed = {
    classCode: "",
    instructor: "",
    lessonTitle: "",
    lessonDate: normalizeIsoDate(rawDate),
    registeredCount: 0,
    unregisteredCount: 0
  };

  let inNonRegistered = false;
  let hasStudentLine = false;
  let skipSection = false;

  for (const line of lines) {
    const isIndexedEntryLine = /^[^\p{L}\p{N}]*(?:[Xx]\s*)?\d+\s*[-.)]\s*.+$/u.test(line);
    const classMatch = line.match(/(?:attendance|classe\s+ouverte)\s*-\s*(.+)$/iu);
    if (classMatch) {
      const parts = line.split(/\s+-\s+/);
      if (parts.length >= 3) {
        parsed.classCode = parts[1].trim();
      } else if (parts.length === 2) {
        parsed.classCode = parts[1].trim();
      }
      inNonRegistered = false;
      continue;
    }

    const directTeacherMatch = line.match(/^(?:[^\p{L}\p{N}]*)?(?:pst|pasteur|ev|instructeur)\.?\s+(.+)$/iu);
    if (directTeacherMatch) {
      parsed.instructor = stripTrailingNote(directTeacherMatch[1]).value.trim();
      inNonRegistered = false;
      continue;
    }

    if (
      !isIndexedEntryLine &&
      /^(?:[^\p{L}\p{N}]*)?(?:date\s*:|lundi\b|mardi\b|mercredi\b|jeudi\b|vendredi\b|samedi\b|dimanche\b|\d{1,2}\s+[A-Za-zÀ-ÿ?]+)/iu.test(line)
    ) {
      const inferredDate = parseFrenchInlineDate(line);
      if (inferredDate) {
        parsed.lessonDate = inferredDate;
      }
      const teacherMatch = line.match(/-\s*(.+)$/);
      if (teacherMatch) {
        parsed.instructor = stripTrailingNote(teacherMatch[1]).value.replace(/\bInstructeur\b/iu, "").trim();
      }
      continue;
    }

    if (/titre[^:]*:/iu.test(line)) {
      const titleMatch = line.match(/:\s*(.+)$/);
      if (titleMatch) {
        parsed.lessonTitle = titleMatch[1].trim();
      }
      inNonRegistered = false;
      continue;
    }

    const isoDateMatch = line.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    if (isoDateMatch) {
      parsed.lessonDate = isoDateMatch[1];
      continue;
    }

    const orgDate = line.match(/\b(\d{6})\b/u);
    if (orgDate) {
      const code = orgDate[1];
      parsed.lessonDate = `${1983 + Number(code.slice(0, 2))}-${code.slice(2, 4)}-${code.slice(4, 6)}`;
      continue;
    }

    if (parseLegendLine(line) || isTotalEntryLine(line) || parseGroupHeader(line)) {
      const detectedGroup = parseGroupHeader(line);
      if (detectedGroup && normalizeSectionLabel(detectedGroup) === "REECOUTE") {
        skipSection = true;
        inNonRegistered = false;
      } else if (detectedGroup) {
        skipSection = false;
      }
      continue;
    }

    if (/non[- ]inscrit/iu.test(line)) {
      inNonRegistered = true;
      skipSection = false;
      continue;
    }

    if (skipSection || isSupervisorHeader(line)) {
      continue;
    }

    if (isTotalEntryLine(line)) {
      continue;
    }

    // Standalone teacher line: symbol-prefixed name with no separator or index
    // e.g. 👩‍🏫Eyram GSN  or  📌Jean PAUL
    if (!parsed.instructor) {
      const strippedLine = line.replace(/^[^\p{L}]+/u, "").trim();
      if (strippedLine && strippedLine !== line && strippedLine.includes(" ") && !/\d/.test(strippedLine)) {
        parsed.instructor = stripTrailingNote(strippedLine).value;
        continue;
      }
    }

    const student = parseStudentLine(line);
    if (student) {
      hasStudentLine = true;
      if (inNonRegistered) {
        parsed.unregisteredCount += 1;
      } else {
        parsed.registeredCount += 1;
      }
    }
  }

  if (!parsed.classCode) {
    issues.push("La ligne de classe est manquante.");
  }
  if (!parsed.instructor) {
    issues.push("La ligne instructeur est manquante.");
  }
  if (!parsed.lessonTitle) {
    issues.push("Le titre de la lecon est manquant.");
  }
  if (!hasStudentLine || parsed.registeredCount === 0) {
    issues.push("Ajoute au moins un etudiant inscrit avec son statut.");
  }

  if (!parsed.lessonDate) {
    parsed.lessonDate = new Date().toISOString().slice(0, 10);
  }

  return { ok: issues.length === 0, issues, parsed };
}

function renderEntryValidation(validation) {
  const element = document.getElementById("academy-entry-validation");
  if (!element) {
    return;
  }

  if (!validation) {
    element.innerHTML = "";
    return;
  }

  const parserLabel = validation.parsed._by === "gemini" ? " · via Gemini ✓" : "";
  const summary = validation.ok
    ? `<div class="academy-validation-summary is-success">Bloc valide: ${validation.parsed.registeredCount} inscrit(s), ${validation.parsed.unregisteredCount} non inscrit(s), classe ${validation.parsed.classCode}${parserLabel}.</div>`
    : `<div class="academy-validation-summary is-error">Le bloc doit etre corrige avant enregistrement.</div>`;

  const details = validation.ok
    ? [
        `Instructeur: ${validation.parsed.instructor || "-"}`,
        `Lecon: ${validation.parsed.lessonTitle || "-"}`,
        `Date: ${validation.parsed.lessonDate || "-"}`
      ]
    : validation.issues;

  element.innerHTML = `
    ${summary}
    <ul class="academy-validation-list">
      ${details.map((item) => `<li>${item}</li>`).join("")}
    </ul>
  `;
}

function getEntryPayload() {
  const selected = academyState.entry.selectedLessonMeta || null;
  return {
    rawText: document.getElementById("academy-entry-text")?.value || "",
    lessonDate: document.getElementById("academy-entry-date")?.value || "",
    lessonId: selected?.lessonId || "",
    classId: selected?.classId || "",
    classCode: selected?.classCode || "",
    lessonTitle: selected?.lessonTitle || "",
    teacherName: selected?.teacherName || "",
    replaceExisting: Boolean(document.getElementById("academy-entry-replace")?.checked),
    deleteExisting: false
  };
}

function attachNavigationHandlers() {
  const navItems = Array.from(document.querySelectorAll(".nav-item[data-target]"));
  navItems.forEach((button) => {
    button.addEventListener("click", () => {
      navItems.forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      const target = document.getElementById(button.dataset.target);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function attachFilterHandlers() {
  document.getElementById("academy-class-filter")?.addEventListener("change", async (event) => {
    academyState.filters.classId = event.target.value;
    academyState.filters.studentId = "all";
    await renderAcademy();
  });

  document.getElementById("academy-student-filter")?.addEventListener("change", async (event) => {
    academyState.filters.studentId = event.target.value;
    await renderAcademy();
  });

  document.getElementById("academy-status-filter")?.addEventListener("change", async (event) => {
    academyState.filters.status = event.target.value;
    await renderAcademy();
  });

  document.getElementById("academy-start-date")?.addEventListener("change", async (event) => {
    academyState.filters.startDate = event.target.value || "";
    academyState.filters.rangePreset = "custom";
    syncRangeInputs();
    await renderAcademy();
  });

  document.getElementById("academy-end-date")?.addEventListener("change", async (event) => {
    academyState.filters.endDate = event.target.value || "";
    academyState.filters.rangePreset = "custom";
    syncRangeInputs();
    await renderAcademy();
  });

  document.querySelectorAll("[data-range-preset]").forEach((button) => {
    button.addEventListener("click", async () => {
      applyRangePreset(button.dataset.rangePreset);
      await renderAcademy();
    });
  });

  document.getElementById("academy-reset-filters")?.addEventListener("click", async () => {
    academyState.filters.classId = "all";
    academyState.filters.studentId = "all";
    academyState.filters.status = "all";
    academyState.filters.rangePreset = "all";
    document.getElementById("academy-status-filter").value = "all";
    applyRangePreset("all");
    await renderAcademy();
  });

  document.getElementById("academy-refresh")?.addEventListener("click", async () => {
    try {
      await loadAcademy();
      showFeedback("Suivi academie actualise.", "success");
    } catch (error) {
      showFeedback(error.message, "error");
    }
  });
}

function attachEntryHandlers() {
  // Lightweight local check on input — just clears stale validation
  const validate = () => {
    const payload = getEntryPayload();
    if (!payload.rawText.trim()) {
      renderEntryValidation(null);
    }
    // Full validation done via API on "Vérifier" click
  };

  // Full server-side parse (Gemini) on demand
  const verifyViaApi = async () => {
    const payload = getEntryPayload();
    if (!payload.rawText.trim()) {
      renderEntryValidation({ ok: false, issues: ["Le bloc est vide."], parsed: {} });
      return null;
    }
    const btn = document.getElementById("academy-validate-entry");
    if (btn) { btn.disabled = true; btn.textContent = "Analyse…"; }
    try {
      const resp = await fetch("/api/academy/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: payload.rawText, lessonDate: payload.lessonDate })
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(text.includes("<!") ? `Erreur serveur ${resp.status} — redemarrez le serveur.` : (text || `Erreur ${resp.status}`));
      }
      const data = await resp.json();
      const result = {
        ok: data.valid,
        issues: data.issues || [],
        parsed: {
          classCode: data.parsed.class_code,
          instructor: data.parsed.teacher_name,
          lessonTitle: data.parsed.lesson_title,
          lessonDate: data.parsed.lesson_date,
          registeredCount: data.parsed.registered_students?.length || 0,
          unregisteredCount: data.parsed.unregistered_students?.length || 0,
          _by: data.parsed._parsed_by || "regex"
        }
      };
      renderEntryValidation(result);
      return result;
    } catch (err) {
      renderEntryValidation({ ok: false, issues: [err.message], parsed: {} });
      return null;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Verifier"; }
    }
  };

  const openEntry = () => {
    setEntryOpen(true);
    document.getElementById("academy-entry-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  document.getElementById("academy-open-entry")?.addEventListener("click", openEntry);
  document.getElementById("academy-toggle-entry")?.addEventListener("click", () => {
    const nextState = !academyState.entry.isOpen;
    setEntryOpen(nextState);
    if (nextState) {
      document.getElementById("academy-entry-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  document.getElementById("academy-entry-text")?.addEventListener("input", validate);
  document.getElementById("academy-entry-date")?.addEventListener("change", validate);
  document.getElementById("academy-entry-replace")?.addEventListener("change", () => {
    updateRefreshButton();
  });

  document.getElementById("academy-validate-entry")?.addEventListener("click", async () => {
    const result = await verifyViaApi();
    if (result) {
      showFeedback(
        result.ok ? "Bloc valide. Tu peux enregistrer la lecon." : "Bloc incomplet ou invalide.",
        result.ok ? "success" : "warning"
      );
    }
  });

  document.getElementById("academy-clear-entry")?.addEventListener("click", () => {
    document.getElementById("academy-entry-text").value = "";
    document.getElementById("academy-entry-date").value = "";
    const replaceInput = document.getElementById("academy-entry-replace");
    if (replaceInput) {
      replaceInput.checked = false;
    }
    academyState.entry.selectedLessonId = "";
    academyState.entry.selectedLessonMeta = null;
    renderEntryValidation(null);
    updateRefreshButton();
    renderLessonLibrary();
  });

  document.getElementById("academy-save-entry")?.addEventListener("click", async () => {
    const validation = await verifyViaApi();
    if (!validation || !validation.ok) {
      showFeedback("Corrige les elements signales avant l'enregistrement.", "warning");
      return;
    }

    academyState.entry.isSaving = true;
    updateRefreshButton();

    try {
      const response = await fetch("/api/academy/record-lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(getEntryPayload())
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) {
        const issues = payload.issues?.length ? ` ${payload.issues.join(" ")}` : "";
        throw new Error((payload.error || "Impossible d'enregistrer la lecon.") + issues);
      }

      const actionLabel = getEntryPayload().replaceExisting ? "Lecon mise a jour" : "Lecon enregistree";
      const warningNote = payload.warning ? ` ⚠ ${payload.warning}` : "";
      showFeedback(`${actionLabel} pour ${payload.result.classCode} le ${payload.result.lessonDate}.${warningNote}`, warningNote ? "warning" : "success");
      document.getElementById("academy-entry-text").value = "";
      document.getElementById("academy-entry-date").value = "";
      const replaceInput = document.getElementById("academy-entry-replace");
      if (replaceInput) {
        replaceInput.checked = false;
      }
      academyState.entry.selectedLessonId = "";
      academyState.entry.selectedLessonMeta = null;
      renderEntryValidation(null);
      setEntryOpen(false);
      await loadAcademy();
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      academyState.entry.isSaving = false;
      updateRefreshButton();
    }
  });

  document.getElementById("academy-delete-entry")?.addEventListener("click", async () => {
    const validation = validate();
    const metadataIssues = [];
    if (!validation.parsed.classCode) metadataIssues.push("la classe");
    if (!validation.parsed.lessonTitle) metadataIssues.push("le titre");
    if (!validation.parsed.lessonDate) metadataIssues.push("la date");

    if (metadataIssues.length) {
      showFeedback(`Pour supprimer, il faut au minimum ${metadataIssues.join(", ")}.`, "warning");
      return;
    }

    const confirmed = window.confirm(
      `Supprimer la lecon "${validation.parsed.lessonTitle}" du ${validation.parsed.lessonDate} pour la classe ${validation.parsed.classCode} ?`
    );
    if (!confirmed) {
      return;
    }

    academyState.entry.isSaving = true;
    updateRefreshButton();

    try {
      const payloadToSend = {
        ...getEntryPayload(),
        deleteExisting: true,
        replaceExisting: false
      };
      const response = await fetch("/api/academy/record-lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadToSend)
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) {
        const issues = payload.issues?.length ? ` ${payload.issues.join(" ")}` : "";
        throw new Error((payload.error || "Impossible de supprimer la lecon.") + issues);
      }

      showFeedback(
        `Lecon supprimee pour ${payload.result.classCode} le ${payload.result.lessonDate}.`,
        "success"
      );
      document.getElementById("academy-entry-text").value = "";
      document.getElementById("academy-entry-date").value = "";
      const replaceInput = document.getElementById("academy-entry-replace");
      if (replaceInput) {
        replaceInput.checked = false;
      }
      academyState.entry.selectedLessonId = "";
      academyState.entry.selectedLessonMeta = null;
      renderEntryValidation(null);
      setEntryOpen(false);
      await loadAcademy();
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      academyState.entry.isSaving = false;
      updateRefreshButton();
    }
  });
}

function initializeEntryTextareaPlaceholder() {
  const textarea = document.getElementById("academy-entry-text");
  if (!textarea) {
    return;
  }

  textarea.placeholder = `🔰 ATTENDANCE - 165P - CLASSE DE MARS
📝Titre de la lecon : La vraie Fondation
📅 Jeudi 02 avril a 19:45 - Seojune JGSN (Instructeur)

🧮 TOTAL : 33/40

🕊CEP (27/33)
▪️Aera JJDSN (13/17)
👍🎥⭕️1. BONHEUR Kenson
❌2. NOM Prenom

⛪️DMD (5/5)
▪️Heejeong (2/2)
👍🎥1. NOM Prenom

🛎Reecoute (2/2)`;
}

function buildEntryDraftForClass(academyClass) {
  const classCode = String(academyClass?.name || academyClass?.class_code || academyClass?.id || "").trim();
  const church = String(academyClass?.church_name || "Centre academie").trim();
  const instructor = formatInstructorLine(academyClass?.instructor_name || "");
  const today = new Date().toISOString().slice(0, 10);

  return [
    `🔰Classe Ouverte - ${classCode} - ${church}`,
    `👩‍🏫${instructor || "Pst Instructeur"}`,
    "📝Titre de la leçon : ",
    `📆${today}`,
    "",
    "✅ Confirmé",
    "👍 Présent",
    "❌ Absent",
    "",
    "Total :0/0"
  ].join("\n");
}

function applyEntryPrefillFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const shouldOpen = ["1", "true", "yes"].includes(String(params.get("openEntry") || "").trim().toLowerCase());
  const entryClass = String(params.get("entryClass") || params.get("class") || "").trim();

  if (!entryClass && !shouldOpen) {
    return;
  }

  if (shouldOpen) {
    setEntryOpen(true);
  }

  if (!entryClass) {
    return;
  }

  const classFilter = document.getElementById("academy-lesson-class-filter");
  const academyClass = academyState.rawData.classes.find((item) => String(item.id) === entryClass);
  if (classFilter && academyClass) {
    classFilter.value = String(academyClass.id);
    renderLessonLibrary();
  }

  const textArea = document.getElementById("academy-entry-text");
  const dateInput = document.getElementById("academy-entry-date");
  if (academyClass && textArea && !String(textArea.value || "").trim()) {
    textArea.value = buildEntryDraftForClass(academyClass);
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().slice(0, 10);
    }
    renderEntryValidation(validateEntry(textArea.value, dateInput?.value || ""));
  }
}

async function boot() {
  await window.AppAuth.requireAuth();
  initializeEntryTextareaPlaceholder();
  attachNavigationHandlers();
  attachFilterHandlers();
  attachStudentsTableHandlers();
  attachEntryHandlers();
  setEntryOpen(false);
  await loadAcademy();
  applyEntryPrefillFromUrl();
}

boot().catch((error) => showFeedback(error.message, "error"));
