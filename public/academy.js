const academyState = {
  rawData: {
    classes: [],
    students: [],
    attendance: [],
    meta: {}
  },
  charts: {},
  filters: {
    classId: "all",
    studentId: "all",
    status: "all"
  },
  entry: {
    isSaving: false
  },
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

function formatDateLabel(value) {
  const date = parseDateValue(value);
  return date ? date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : value || "-";
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
  if (saveButton) {
    saveButton.disabled = academyState.entry.isSaving;
    saveButton.textContent = academyState.entry.isSaving ? "Enregistrement..." : "Enregistrer la lecon";
  }
}

function buildView() {
  const classFilter = academyState.filters.classId;
  const studentFilter = academyState.filters.studentId;
  const statusFilter = academyState.filters.status;

  const classesById = new Map(academyState.rawData.classes.map((item) => [String(item.id), item]));
  const students = academyState.rawData.students.filter((student) => {
    const classOk = classFilter === "all" || String(student.class_id || student.class_name) === classFilter;
    const studentOk = studentFilter === "all" || String(student.id) === studentFilter;
    return classOk && studentOk;
  });

  const studentIds = new Set(students.map((student) => String(student.id)));
  const attendance = academyState.rawData.attendance.filter((row) => {
    const belongsToStudent = studentIds.size === 0 ? false : studentIds.has(String(row.student_id));
    const classOk =
      classFilter === "all" ||
      String(row.class_id || row.class_name) === classFilter ||
      students.some((student) => String(student.id) === String(row.student_id));
    const statusOk = statusFilter === "all" || String(row.status) === statusFilter;
    return belongsToStudent && classOk && statusOk;
  });

  const presenceByDate = new Map();
  const statusCounts = { present: 0, absent: 0, late: 0, excused: 0, unknown: 0 };
  const studentStats = new Map();

  attendance.forEach((row) => {
    const dateKey = String(row.session_date || "").slice(0, 10);
    if (dateKey) {
      const bucket = presenceByDate.get(dateKey) || { present: 0, total: 0 };
      bucket.total += 1;
      if (row.status === "present") {
        bucket.present += 1;
      }
      presenceByDate.set(dateKey, bucket);
    }

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
    .map((academyClass) => {
      const classStudents = academyState.rawData.students.filter(
        (student) => String(student.class_id || student.class_name) === String(academyClass.id)
      );
      if (classFilter !== "all" && String(academyClass.id) !== classFilter) {
        return null;
      }

      const classStudentIds = new Set(classStudents.map((student) => String(student.id)));
      const classAttendance = academyState.rawData.attendance.filter((row) => classStudentIds.has(String(row.student_id)));
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

  const trajectory = Array.from(presenceByDate.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, values]) => ({
      label: formatDateLabel(date),
      value: values.present,
      total: values.total
    }));

  const totalAttendance = attendance.length;
  const presentCount = statusCounts.present || 0;
  const absenceCount = statusCounts.absent || 0;
  const presenceRate = totalAttendance ? Math.round((presentCount / totalAttendance) * 100) : 0;
  const lateCount = statusCounts.late || 0;

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
        delta: `${presentCount} presences enregistrees`,
        tone: presenceRate >= 80 ? "positive" : "warning"
      },
      {
        label: "Absences",
        value: absenceCount,
        delta: `${lateCount} retards sur la periode`,
        tone: absenceCount > 0 ? "warning" : "positive"
      },
      {
        label: "Evaluations",
        value: studentRows.filter((student) => student.averageScore > 0).length,
        delta: "etudiants avec note moyenne",
        tone: "neutral"
      }
    ],
    trajectory,
    classesSummary,
    studentRows,
    statusCounts
  };
}

function renderStudentsTable(rows) {
  const tbody = document.getElementById("academy-students-table");
  if (!tbody) {
    return;
  }

  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-table">Aucune donnee academie ne correspond aux filtres actuels.</td>
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

async function renderPresenceChart(items) {
  if (!items.length) {
    renderEmptyChart("academyPresence", "academy-presence-chart", "Aucune presence disponible pour le moment.");
    return;
  }

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
    xaxis: { categories: items.map((item) => item.label) },
    yaxis: { min: 0, forceNiceScale: true }
  });
}

async function renderClassesChart(items) {
  if (!items.length) {
    renderEmptyChart("academyClasses", "academy-classes-chart", "Aucune classe disponible.");
    return;
  }

  await mountChart("academyClasses", "academy-classes-chart", {
    ...getChartBaseOptions(),
    chart: { ...getChartBaseOptions().chart, type: "bar", height: 320 },
    series: [{ name: "Presence", data: items.map((item) => item.rate) }],
    plotOptions: { bar: { horizontal: true, borderRadius: 8, barHeight: "52%" } },
    colors: ["#2589c8"],
    xaxis: { categories: items.map((item) => item.name), max: 100 },
    tooltip: { theme: "light", y: { formatter: (value) => `${value}% de presence` } },
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

  classFilter.innerHTML = [
    `<option value="all">Toutes les classes</option>`,
    ...academyState.rawData.classes.map((academyClass) => `<option value="${academyClass.id}">${academyClass.name}</option>`)
  ].join("");

  const visibleStudents = academyState.filters.classId === "all"
    ? academyState.rawData.students
    : academyState.rawData.students.filter(
        (student) => String(student.class_id || student.class_name) === academyState.filters.classId
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
}

async function renderAcademy() {
  populateFilters();
  const view = buildView();
  document.getElementById("academy-kpis").innerHTML = view.kpis.map(createKpiCard).join("");
  renderStudentsTable(view.studentRows);
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

    academyState.rawData = payload;
    document.getElementById("academy-refresh-label").textContent = payload.meta?.refreshLabel || "Donnees academie";
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

function parseStudentLine(line) {
  const markerFirst = line.match(/^(✅|👍|✖️|✖|❌|X)\s*(\d*)\s*[-.\s]\s*(.*)$/u);
  const numberFirst = line.match(/^(\d+)\s*[-. ]\s*(.*)$/u);

  let name = "";
  let status = "unknown";

  if (markerFirst) {
    name = markerFirst[3].trim();
    status = ["✅", "👍"].includes(markerFirst[1]) ? "present" : "absent";
  } else if (numberFirst) {
    const rest = numberFirst[2].trim();
    const inner = rest.match(/^(✅|👍|✖️|✖|❌)\s*(.*)$/u);
    if (inner) {
      status = ["✅", "👍"].includes(inner[1]) ? "present" : "absent";
      name = inner[2].trim();
    } else {
      name = rest;
    }
  }

  if (!name) {
    return null;
  }

  const reasonMatch = name.match(/\s*\(([^)]+)\)\s*$/);
  return {
    name: reasonMatch ? name.slice(0, reasonMatch.index).trim() : name,
    status
  };
}

function validateEntry(rawText, rawDate) {
  const lines = String(rawText || "")
    .split("\n")
    .map((line) => line.trim())
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

  for (const line of lines) {
    if (line.includes("🔰")) {
      const parts = line.split(" - ");
      if (parts.length >= 3) {
        parsed.classCode = parts[1].trim();
      }
      inNonRegistered = false;
      continue;
    }

    if (line.includes("👩")) {
      parsed.instructor = line.replace(/^[^\w]+/u, "").trim();
      inNonRegistered = false;
      continue;
    }

    if (line.includes("📝")) {
      const titleMatch = line.match(/:\s*(.+)$/);
      if (titleMatch) {
        parsed.lessonTitle = titleMatch[1].trim();
      }
      inNonRegistered = false;
      continue;
    }

    const orgDate = line.match(/📆(\d{6})/u);
    if (orgDate) {
      const code = orgDate[1];
      parsed.lessonDate = `${1983 + Number(code.slice(0, 2))}-${code.slice(2, 4)}-${code.slice(4, 6)}`;
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

  const summary = validation.ok
    ? `<div class="academy-validation-summary is-success">Bloc valide: ${validation.parsed.registeredCount} inscrit(s), ${validation.parsed.unregisteredCount} non inscrit(s), classe ${validation.parsed.classCode}.</div>`
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
  return {
    rawText: document.getElementById("academy-entry-text")?.value || "",
    lessonDate: document.getElementById("academy-entry-date")?.value || ""
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

  document.getElementById("academy-reset-filters")?.addEventListener("click", async () => {
    academyState.filters = { classId: "all", studentId: "all", status: "all" };
    document.getElementById("academy-status-filter").value = "all";
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
  const validate = () => {
    const payload = getEntryPayload();
    const result = validateEntry(payload.rawText, payload.lessonDate);
    renderEntryValidation(result);
    return result;
  };

  document.getElementById("academy-entry-text")?.addEventListener("input", validate);
  document.getElementById("academy-entry-date")?.addEventListener("change", validate);

  document.getElementById("academy-validate-entry")?.addEventListener("click", () => {
    const result = validate();
    showFeedback(result.ok ? "Bloc valide. Tu peux enregistrer la lecon." : "Bloc incomplet ou invalide.", result.ok ? "success" : "warning");
  });

  document.getElementById("academy-clear-entry")?.addEventListener("click", () => {
    document.getElementById("academy-entry-text").value = "";
    document.getElementById("academy-entry-date").value = "";
    renderEntryValidation(null);
  });

  document.getElementById("academy-save-entry")?.addEventListener("click", async () => {
    const validation = validate();
    if (!validation.ok) {
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

      showFeedback(`Lecon enregistree pour ${payload.result.classCode} le ${payload.result.lessonDate}.`, "success");
      document.getElementById("academy-entry-text").value = "";
      document.getElementById("academy-entry-date").value = "";
      renderEntryValidation(null);
      await loadAcademy();
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      academyState.entry.isSaving = false;
      updateRefreshButton();
    }
  });
}

async function boot() {
  attachNavigationHandlers();
  attachFilterHandlers();
  attachEntryHandlers();
  await loadAcademy();
}

boot().catch((error) => showFeedback(error.message, "error"));
