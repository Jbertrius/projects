const classeState = {
  classId: "",
  data: null,       // full API response
  charts: {},
  studentsSort: "name_asc",
  studentsSearch: "",
  entry: {
    isSaving: false,
    isOpen: false,
    selectedLessonId: "",
    selectedLessonTitle: "",
    selectedClassId: ""
  }
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function showFeedback(message, tone = "info") {
  const el = document.getElementById("app-feedback");
  if (!el) return;
  el.textContent = message;
  el.className = `app-feedback is-${tone}`;
  el.hidden = false;
  clearTimeout(showFeedback._t);
  showFeedback._t = setTimeout(() => { el.hidden = true; }, 5000);
}

function parseDateValue(value) {
  const d = new Date(value || "");
  return isNaN(d.getTime()) ? null : d;
}

function formatDateLabel(value) {
  const d = parseDateValue(value);
  return d ? d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : value || "-";
}

function formatFullDate(value) {
  const d = parseDateValue(value);
  return d ? d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : value || "-";
}

function rateColor(rate) {
  if (rate >= 80) return "var(--color-success, #22c55e)";
  if (rate >= 60) return "var(--color-warning, #f59e0b)";
  return "var(--color-danger, #ef4444)";
}

function rateBadge(rate) {
  const cls = rate >= 80 ? "badge-approved" : rate >= 60 ? "badge-pending" : "badge-rejected";
  return `<span class="suggestion-badge ${cls}">${rate}%</span>`;
}

function getDefaultInstructorName() {
  return String(classeState.data?.class?.instructor_name || "").trim();
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

function getClassIdFromUrl() {
  return new URLSearchParams(window.location.search).get("id") || "";
}

function setClassIdInUrl(classId) {
  const url = new URL(window.location.href);
  if (classId) url.searchParams.set("id", classId);
  else url.searchParams.delete("id");
  history.replaceState(null, "", url.toString());
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadClassData(classId) {
  const label = document.getElementById("classe-refresh-label");
  const title = document.getElementById("classe-title");
  if (label) label.textContent = "Chargement...";
  if (title) title.textContent = "Chargement...";

  const res = await fetch(`/api/academy/classes/${encodeURIComponent(classId)}?ts=${Date.now()}`, {
    cache: "no-store"
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error || "Erreur de chargement");
  return data;
}

// ---------------------------------------------------------------------------
// Class selector
// ---------------------------------------------------------------------------

function populateClassSelector(allClasses, selectedId) {
  const sel = document.getElementById("classe-selector");
  if (!sel) return;
  sel.innerHTML = [
    `<option value="">-- Choisir une classe --</option>`,
    ...allClasses.map((c) =>
      `<option value="${c.id}" ${c.id === selectedId ? "selected" : ""}>${c.name}</option>`
    )
  ].join("");
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

function renderKPIs(stats) {
  const grid = document.getElementById("classe-kpis");
  if (!grid) return;

  const tone = stats.avg_presence_rate >= 80 ? "positive" : stats.avg_presence_rate >= 60 ? "warning" : "neutral";

  const items = [
    { label: "Etudiants inscrits",     value: stats.student_count,        delta: "dans la classe",         tone: "neutral" },
    { label: "Lecons effectuees",       value: stats.lesson_count,         delta: "seances enregistrees",   tone: "neutral" },
    { label: "Taux de presence moyen", value: `${stats.avg_presence_rate}%`, delta: "sur toutes les lecons", tone },
    { label: "Total absences",         value: stats.total_absences,        delta: "sur l'ensemble des lecons", tone: stats.total_absences > 0 ? "warning" : "positive" }
  ];

  grid.innerHTML = items.map((item) => `
    <article class="card kpi-card">
      <p class="section-label">${item.label}</p>
      <div class="kpi-value">${item.value}</div>
      <div class="kpi-delta tone-${item.tone}">${item.delta}</div>
    </article>
  `).join("");
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

function destroyChart(key) {
  if (classeState.charts[key]) {
    classeState.charts[key].destroy();
    delete classeState.charts[key];
  }
}

async function mountChart(key, elementId, options) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (typeof ApexCharts === "undefined") {
    el.innerHTML = `<div class="empty-state">Graphiques non disponibles.</div>`;
    return;
  }
  destroyChart(key);
  el.innerHTML = "";
  const chart = new ApexCharts(el, options);
  classeState.charts[key] = chart;
  await chart.render();
}

function baseChartOptions() {
  return {
    chart: {
      fontFamily: "Instrument Sans, sans-serif",
      toolbar: { show: false },
      zoom: { enabled: false },
      animations: { easing: "easeinout", speed: 420 }
    },
    dataLabels: { enabled: false },
    grid: { borderColor: "rgba(37,137,200,0.12)", strokeDashArray: 4 },
    tooltip: { theme: "light" }
  };
}

async function renderPresenceChart(lessons, studentCount) {
  if (!lessons.length) {
    destroyChart("presence");
    const el = document.getElementById("classe-presence-chart");
    if (el) el.innerHTML = `<div class="empty-state">Aucune lecon enregistree.</div>`;
    return;
  }

  const labels = lessons.map((l) => formatDateLabel(l.lesson_date));
  const values = lessons.map((l) => l.present_count);

  await mountChart("presence", "classe-presence-chart", {
    ...baseChartOptions(),
    chart: { ...baseChartOptions().chart, type: "bar", height: 220 },
    series: [{ name: "Presents", data: values }],
    xaxis: { categories: labels, labels: { style: { fontSize: "11px" } } },
    yaxis: {
      min: 0,
      max: studentCount || undefined,
      tickAmount: Math.min(studentCount || 5, 5),
      labels: { formatter: (v) => Math.round(v) }
    },
    colors: ["#2589c8"],
    annotations: studentCount > 0 ? {
      yaxis: [{
        y: studentCount,
        borderColor: "#94a3b8",
        strokeDashArray: 4,
        label: { text: `Total: ${studentCount}`, style: { fontSize: "11px" } }
      }]
    } : {},
    tooltip: {
      theme: "light",
      y: { formatter: (v) => `${v} / ${studentCount}` }
    }
  });
}

async function renderStatusChart(students) {
  const totals = { present: 0, absent: 0, late: 0, excused: 0 };
  for (const s of students) {
    totals.present  += s.present_count;
    totals.absent   += s.absent_count;
    totals.late     += s.late_count;
    totals.excused  += s.excused_count;
  }

  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  if (!total) {
    destroyChart("status");
    const el = document.getElementById("classe-status-chart");
    if (el) el.innerHTML = `<div class="empty-state">Aucune presence enregistree.</div>`;
    return;
  }

  await mountChart("status", "classe-status-chart", {
    ...baseChartOptions(),
    chart: { ...baseChartOptions().chart, type: "donut", height: 220 },
    series: [totals.present, totals.absent, totals.late, totals.excused],
    labels: ["Presents", "Absents", "Retards", "Excuses"],
    colors: ["#22c55e", "#ef4444", "#f59e0b", "#94a3b8"],
    legend: { position: "bottom", fontSize: "12px" },
    plotOptions: { pie: { donut: { size: "60%" } } }
  });
}

// ---------------------------------------------------------------------------
// Students table
// ---------------------------------------------------------------------------

function sortStudents(students, sortKey, search) {
  let list = students;
  if (search) {
    const q = search.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    list = list.filter((s) =>
      (s.name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(q)
    );
  }
  return [...list].sort((a, b) => {
    switch (sortKey) {
      case "present_desc": return b.present_count - a.present_count;
      case "absent_desc":  return b.absent_count  - a.absent_count;
      case "rate_desc":    return b.presence_rate  - a.presence_rate;
      default:             return (a.name || "").localeCompare(b.name || "", "fr");
    }
  });
}

function renderStudentsTable(students) {
  const tbody = document.getElementById("classe-students-table");
  if (!tbody) return;

  const sorted = sortStudents(students, classeState.studentsSort, classeState.studentsSearch);

  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Aucun etudiant.</td></tr>`;
    return;
  }

  tbody.innerHTML = sorted.map((s) => {
    const statusLabel = s.is_registered ? "Inscrit" : "Non inscrit";
    const statusCls = s.is_registered ? "badge-approved" : "badge-pending";
    const ficheUrl = `/academy-students.html?search=${encodeURIComponent(s.name || s.id)}&class=${encodeURIComponent(classeState.classId)}`;
    return `
      <tr>
        <td><a href="${ficheUrl}" class="table-student-link"><strong>${s.name || s.id}</strong></a></td>
        <td><span class="suggestion-badge ${statusCls}">${statusLabel}</span></td>
        <td class="text-right">${s.present_count}</td>
        <td class="text-right">${s.absent_count}</td>
        <td class="text-right">${s.late_count}</td>
        <td class="text-right">${rateBadge(s.presence_rate)}</td>
      </tr>`;
  }).join("");
}

// ---------------------------------------------------------------------------
// Lessons table
// ---------------------------------------------------------------------------

function renderLessonsTable(lessons) {
  const tbody = document.getElementById("classe-lessons-table");
  const countEl = document.getElementById("classe-lessons-count");
  if (!tbody) return;

  if (countEl) countEl.textContent = `${lessons.length} lecon${lessons.length !== 1 ? "s" : ""}`;

  if (!lessons.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Aucune lecon enregistree.</td></tr>`;
    return;
  }

  // Show most recent first
  const sorted = [...lessons].sort((a, b) => b.lesson_date.localeCompare(a.lesson_date));

  tbody.innerHTML = sorted.map((l) => `
    <tr>
      <td>${formatFullDate(l.lesson_date)}</td>
      <td>${l.lesson_title || "-"}</td>
      <td>${l.instructor_name || getDefaultInstructorName() || "-"}</td>
      <td class="text-right">${l.present_count} / ${l.total_students}</td>
      <td class="text-right">${rateBadge(l.presence_rate)}</td>
    </tr>`
  ).join("");
}

// ---------------------------------------------------------------------------
// Lesson library (inside entry panel)
// ---------------------------------------------------------------------------

function renderLessonLibrary(lessons) {
  const container = document.getElementById("classe-lesson-library");
  if (!container) return;

  if (!lessons.length) {
    container.innerHTML = `<div class="empty-state">Aucune lecon pour cette classe.</div>`;
    return;
  }

  const sorted = [...lessons].sort((a, b) => b.lesson_date.localeCompare(a.lesson_date));

  container.innerHTML = sorted.map((l) => `
    <article class="academy-lesson-item">
      <div class="academy-lesson-row">
        <div>
          <h4 class="academy-lesson-title">${l.lesson_title || "Sans titre"}</h4>
          <div class="academy-lesson-meta">
            <span class="academy-lesson-chip">${formatFullDate(l.lesson_date)}</span>
            <span class="academy-lesson-chip">${l.present_count}/${l.total_students} presents</span>
          </div>
        </div>
      </div>
      <div class="academy-lesson-actions">
        <button class="secondary-action compact-action" type="button"
          data-lesson-id="${l.lesson_id}"
          data-lesson-title="${(l.lesson_title || "").replace(/"/g, "&quot;")}"
          data-lesson-date="${l.lesson_date || ""}">Charger</button>
      </div>
    </article>`
  ).join("");

  container.querySelectorAll("[data-lesson-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      loadLessonForEdit(btn.dataset.lessonId, btn.dataset.lessonTitle, btn.dataset.lessonDate)
        .catch((err) => showFeedback(err.message, "error"));
    });
  });
}

function buildAttendanceBlock(lesson, cls) {
  const classCode   = cls.class_code || cls.name || classeState.classId;
  const instructor  = lesson.instructor_name || cls.instructor_name || "";
  const date        = lesson.lesson_date || "";
  const title       = lesson.lesson_title || "";
  const attendance  = lesson.attendance || [];

  const present = attendance.filter((a) => a.status === "present");
  const total   = `${present.length}/${attendance.length}`;

  const statusEmoji = (status) => {
    if (status === "present") return "👍";
    if (status === "late")    return "⏰";
    if (status === "excused") return "🛡️";
    return "✖";
  };

  const lines = [
    `📋 ATTENDANCE - ${classCode}`,
    date ? `📅 ${date}${instructor ? ` - ${instructor}` : ""}` : (instructor ? `📅 ${instructor}` : ""),
    title ? `📌 Titre de la leçon : ${title}` : "",
    "",
    `🧮 TOTAL ${total}`,
    "",
    ...attendance.map((a, i) => `${i + 1}- ${statusEmoji(a.status)} ${a.student_name}`)
  ].filter((l, i) => i < 3 ? l !== "" : true);  // keep blank lines only in body

  return lines.join("\n");
}

async function loadLessonForEdit(lessonId, lessonTitle, lessonDate) {
  classeState.entry.selectedLessonId    = lessonId;
  classeState.entry.selectedLessonTitle = lessonTitle;

  const dateInput = document.getElementById("classe-entry-date");
  if (dateInput && lessonDate) dateInput.value = lessonDate;

  const replaceCheck = document.getElementById("classe-entry-replace");
  if (replaceCheck) replaceCheck.checked = true;

  const saveBtn = document.getElementById("classe-save-entry");
  if (saveBtn) saveBtn.textContent = "Mettre a jour la lecon";

  // If the in-memory lesson doesn't have attendance detail yet (stale data loaded
  // before the route started returning it), refresh silently first.
  const existingLesson = (classeState.data?.lessons || []).find((l) => l.lesson_id === lessonId);
  if (!existingLesson?.attendance?.length) {
    await refresh();
  }

  // Pre-fill the textarea with the reconstructed attendance block.
  const textarea = document.getElementById("classe-entry-text");
  if (textarea && classeState.data) {
    const lesson = (classeState.data.lessons || []).find((l) => l.lesson_id === lessonId);
    const cls    = classeState.data.class || {};
    if (lesson) {
      textarea.value = buildAttendanceBlock(lesson, cls);
    }
  }

  // Open the form and bring it into view so the user sees the result.
  setEntryOpen(true);
  document.getElementById("classe-entry-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  textarea?.focus();

  showFeedback(`Lecon chargee : « ${lessonTitle || lessonId} ». Modifiez le bloc si necessaire puis cliquez Enregistrer.`, "info");
}

// ---------------------------------------------------------------------------
// Lesson entry form
// ---------------------------------------------------------------------------

function setEntryOpen(isOpen) {
  classeState.entry.isOpen = Boolean(isOpen);
  const body   = document.getElementById("classe-entry-body");
  const toggle = document.getElementById("classe-toggle-entry");
  const openBtn = document.getElementById("classe-open-entry");
  if (body)   body.hidden = !classeState.entry.isOpen;
  if (toggle) {
    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    toggle.textContent = isOpen ? "Masquer le formulaire" : "Afficher le formulaire";
  }
  if (openBtn) openBtn.textContent = isOpen ? "Lecon ouverte" : "Nouvelle lecon";
}

function renderValidation(parsed, issues) {
  const el = document.getElementById("classe-entry-validation");
  if (!el) return;
  if (!parsed && !issues) { el.innerHTML = ""; return; }

  const issueHtml = (issues || []).map((i) => `<li class="validation-issue">${i}</li>`).join("");
  const infoHtml = parsed ? `
    <ul class="validation-info">
      <li><strong>Classe :</strong> ${parsed.class_code || "-"}</li>
      <li><strong>Lecon :</strong> ${parsed.lesson_title || "-"}</li>
      <li><strong>Date :</strong> ${parsed.lesson_date || "-"}</li>
      <li><strong>Instructeur :</strong> ${parsed.teacher_name || "-"}</li>
      <li><strong>Etudiants :</strong> ${(parsed.registered_students || []).length}</li>
    </ul>` : "";

  el.innerHTML = `${issueHtml ? `<ul class="validation-issues">${issueHtml}</ul>` : ""}${infoHtml}`;
}

async function verifyEntry() {
  const rawText = document.getElementById("classe-entry-text")?.value || "";
  const lessonDate = document.getElementById("classe-entry-date")?.value || "";
  const teacherName = getDefaultInstructorName();
  if (!rawText.trim()) { showFeedback("Le bloc de presence est vide.", "error"); return; }

  try {
    const res = await fetch("/api/academy/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawText, lessonDate, teacherName })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur de verification");
    renderValidation(data.parsed, data.issues);
    if (data.valid) showFeedback("Verification reussie — vous pouvez enregistrer.", "success");
    else showFeedback(`${data.issues.length} probleme(s) detecte(s).`, "error");
  } catch (err) {
    showFeedback(err.message, "error");
  }
}

async function saveEntry() {
  const rawText = document.getElementById("classe-entry-text")?.value || "";
  const lessonDate = document.getElementById("classe-entry-date")?.value || "";
  const replaceExisting = Boolean(document.getElementById("classe-entry-replace")?.checked);
  const teacherName = getDefaultInstructorName();
  if (!rawText.trim()) { showFeedback("Le bloc de presence est vide.", "error"); return; }

  classeState.entry.isSaving = true;
  updateEntryButtons();

  try {
    const body = {
      rawText,
      lessonDate,
      replaceExisting,
      classId: classeState.classId,
      teacherName
    };
    if (replaceExisting && classeState.entry.selectedLessonId) {
      body.lessonId = classeState.entry.selectedLessonId;
    }

    const res = await fetch("/api/academy/record-lesson", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.error || "Erreur serveur");

    showFeedback(
      data.warning
        ? `Enregistre avec avertissement : ${data.warning}`
        : "Lecon enregistree avec succes.",
      data.warning ? "info" : "success"
    );

    clearEntryForm();
    await refresh();
  } catch (err) {
    showFeedback(err.message, "error");
  } finally {
    classeState.entry.isSaving = false;
    updateEntryButtons();
  }
}

async function deleteEntry() {
  if (!classeState.entry.selectedLessonId) {
    showFeedback("Chargez d'abord une lecon depuis la liste pour la supprimer.", "info");
    return;
  }
  if (!confirm(`Supprimer la lecon « ${classeState.entry.selectedLessonTitle} » ?`)) return;

  classeState.entry.isSaving = true;
  updateEntryButtons();

  try {
    const res = await fetch("/api/academy/record-lesson", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deleteExisting: true,
        lessonId: classeState.entry.selectedLessonId,
        classId: classeState.classId
      })
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.error || "Erreur serveur");
    showFeedback("Lecon supprimee.", "success");
    clearEntryForm();
    await refresh();
  } catch (err) {
    showFeedback(err.message, "error");
  } finally {
    classeState.entry.isSaving = false;
    updateEntryButtons();
  }
}

function clearEntryForm() {
  const text = document.getElementById("classe-entry-text");
  const date = document.getElementById("classe-entry-date");
  const rep  = document.getElementById("classe-entry-replace");
  if (text) text.value = "";
  if (date) date.value = "";
  if (rep)  rep.checked = false;
  classeState.entry.selectedLessonId   = "";
  classeState.entry.selectedLessonTitle = "";
  renderValidation(null, null);
  const saveBtn = document.getElementById("classe-save-entry");
  if (saveBtn) saveBtn.textContent = "Enregistrer";
}

function updateEntryButtons() {
  const save = document.getElementById("classe-save-entry");
  const del  = document.getElementById("classe-delete-entry");
  const busy = classeState.entry.isSaving;
  if (save) save.disabled = busy;
  if (del)  del.disabled  = busy;
}

// ---------------------------------------------------------------------------
// Full render
// ---------------------------------------------------------------------------

function renderCategorySection(cls) {
  const section = document.getElementById("classe-category-section");
  if (!section) return;

  const checkbox = document.getElementById("classe-is-missionary");
  const text = document.getElementById("classe-is-missionary-text");
  const fields = document.getElementById("classe-category-fields");
  const churchInput = document.getElementById("classe-church-name");
  const pastorInput = document.getElementById("classe-church-pastor");
  const instructorInput = document.getElementById("classe-instructor-name");
  const feedback = document.getElementById("classe-category-feedback");

  if (!checkbox) return;

  checkbox.checked = Boolean(cls.is_missionary);
  text.textContent = cls.is_missionary ? "Oui" : "Non";
  fields.hidden = !cls.is_missionary;
  if (instructorInput) instructorInput.value = cls.instructor_name || "";
  if (churchInput) churchInput.value = cls.church_name || "";
  if (pastorInput) pastorInput.value = cls.church_pastor_name || "";
  if (feedback) feedback.hidden = true;

  section.hidden = false;
}

async function renderAll(data) {
  classeState.data = data;

  const title = document.getElementById("classe-title");
  const subtitle = document.getElementById("classe-chart-subtitle");
  const label = document.getElementById("classe-refresh-label");

  const cls = data.class;
  if (title) title.textContent = cls.name + (cls.instructor_name ? ` — ${cls.instructor_name}` : "");
  if (subtitle) subtitle.textContent = `${data.stats.student_count} etudiants · ${data.stats.lesson_count} lecons`;
  if (label) label.textContent = `${data.stats.student_count} etudiants, ${data.stats.lesson_count} lecons`;

  document.title = `${cls.name} — Academie DMD`;

  populateClassSelector(data.all_classes, classeState.classId);
  renderKPIs(data.stats);
  renderCategorySection(cls);

  await Promise.all([
    renderPresenceChart(data.lessons, data.stats.student_count),
    renderStatusChart(data.students)
  ]);

  renderStudentsTable(data.students);
  renderLessonsTable(data.lessons);
  renderLessonLibrary(data.lessons);
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

async function refresh() {
  if (!classeState.classId) return;
  const btn = document.getElementById("classe-refresh");
  if (btn) { btn.disabled = true; btn.textContent = "Actualisation..."; }
  try {
    const data = await loadClassData(classeState.classId);
    await renderAll(data);
  } catch (err) {
    showFeedback(err.message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Actualiser"; }
  }
}

// ---------------------------------------------------------------------------
// Class change
// ---------------------------------------------------------------------------

async function switchClass(classId) {
  if (!classId) return;
  classeState.classId = classId;
  setClassIdInUrl(classId);
  await refresh();
}

// ---------------------------------------------------------------------------
// First load: when no class is selected, show selector only
// ---------------------------------------------------------------------------

async function loadClassList() {
  // Use the full academy endpoint just for the class list
  const res = await fetch(`/api/academy?ts=${Date.now()}`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error || "Impossible de charger les classes");
  return (data.classes || [])
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

function attachEvents() {
  document.getElementById("classe-selector")?.addEventListener("change", (e) => {
    if (e.target.value) switchClass(e.target.value);
  });

  document.getElementById("classe-refresh")?.addEventListener("click", () => refresh());

  document.getElementById("classe-open-entry")?.addEventListener("click", () => {
    clearEntryForm();
    setEntryOpen(true);
    document.getElementById("classe-entry-panel")?.scrollIntoView({ behavior: "smooth" });
  });

  document.getElementById("classe-toggle-entry")?.addEventListener("click", () => {
    setEntryOpen(!classeState.entry.isOpen);
  });

  // Category toggle
  document.getElementById("classe-is-missionary")?.addEventListener("change", (e) => {
    const checked = e.target.checked;
    const text = document.getElementById("classe-is-missionary-text");
    const fields = document.getElementById("classe-category-fields");
    if (text) text.textContent = checked ? "Oui" : "Non";
    if (fields) fields.hidden = !checked;
  });

  document.getElementById("classe-category-save")?.addEventListener("click", async () => {
    if (!classeState.classId) return;
    const isMissionary = Boolean(document.getElementById("classe-is-missionary")?.checked);
    const churchName = String(document.getElementById("classe-church-name")?.value || "").trim();
    const churchPastor = String(document.getElementById("classe-church-pastor")?.value || "").trim();
    const instructorName = String(document.getElementById("classe-instructor-name")?.value || "").trim();
    const btn = document.getElementById("classe-category-save");
    const feedback = document.getElementById("classe-category-feedback");

    if (isMissionary && !churchName) {
      if (feedback) { feedback.textContent = "Le nom de l'eglise est requis."; feedback.style.color = "#ef4444"; feedback.hidden = false; }
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = "Enregistrement..."; }
    if (feedback) feedback.hidden = true;

    const payload = isMissionary
      ? { is_missionary: true, church_name: churchName, church_pastor_name: churchPastor, instructor_name: instructorName }
      : { is_missionary: false, church_name: "", church_pastor_name: "", instructor_name: instructorName };

    try {
      const res = await fetch(`/api/academy/classes/${encodeURIComponent(classeState.classId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error || "Erreur serveur");

      if (classeState.data?.class) {
        classeState.data.class.is_missionary = isMissionary;
        classeState.data.class.church_name = isMissionary ? churchName : "";
        classeState.data.class.church_pastor_name = isMissionary ? churchPastor : "";
        classeState.data.class.instructor_name = instructorName;
      }

      await renderAll(classeState.data);
      if (feedback) { feedback.textContent = "Configuration de la classe mise a jour."; feedback.style.color = "#147964"; feedback.hidden = false; }
    } catch (err) {
      if (feedback) { feedback.textContent = err.message; feedback.style.color = "#ef4444"; feedback.hidden = false; }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Enregistrer"; }
    }
  });

  document.getElementById("classe-validate-entry")?.addEventListener("click", () => verifyEntry());
  document.getElementById("classe-save-entry")?.addEventListener("click", () => saveEntry());
  document.getElementById("classe-delete-entry")?.addEventListener("click", () => deleteEntry());
  document.getElementById("classe-clear-entry")?.addEventListener("click", () => clearEntryForm());

  // Students sort & search
  document.getElementById("classe-students-sort")?.addEventListener("change", (e) => {
    classeState.studentsSort = e.target.value;
    if (classeState.data) renderStudentsTable(classeState.data.students);
  });

  document.getElementById("classe-students-search")?.addEventListener("input", (e) => {
    classeState.studentsSearch = e.target.value;
    if (classeState.data) renderStudentsTable(classeState.data.students);
  });

  // Sidebar scroll-to nav buttons
  document.querySelectorAll("[data-target]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.target);
      if (target) target.scrollIntoView({ behavior: "smooth" });
    });
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  await window.AppAuth.requireAuth();
  attachEvents();

  const classId = getClassIdFromUrl();

  if (classId) {
    classeState.classId = classId;
    try {
      const data = await loadClassData(classId);
      await renderAll(data);
    } catch (err) {
      showFeedback(err.message, "error");
      // Still try to show the selector
      try {
        const classes = await loadClassList();
        populateClassSelector(classes, "");
      } catch {}
    }
  } else {
    // No class in URL — just populate the selector and wait
    const title = document.getElementById("classe-title");
    const label = document.getElementById("classe-refresh-label");
    if (title) title.textContent = "Selectionnez une classe";
    if (label) label.textContent = "Aucune classe selectionnee";
    try {
      const classes = await loadClassList();
      populateClassSelector(classes, "");
    } catch (err) {
      showFeedback(err.message, "error");
    }
  }
}

boot().catch((err) => showFeedback(err.message, "error"));
