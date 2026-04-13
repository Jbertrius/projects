// ─────────────────────────────────────────────────────────────────────────────
// development.js — Centres missionnaires section
// Loads academy data and renders only classes that have a church_name set
// (i.e. classes hosted in a partner church — mission centres).
// ─────────────────────────────────────────────────────────────────────────────

const developmentState = {
  centres: [],
  selectedClassId: ""
};

function isMissionCentre(cls) {
  return Boolean(String(cls.church_name || "").trim());
}

function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value + "T12:00:00");
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

function getInitials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("") || "?";
}

function buildLessonStats(rows) {
  const byLesson = new Map();
  rows.forEach((row) => {
    const key = String(row.lesson_id || row.lesson_title || "").trim();
    if (!key) return;
    const bucket = byLesson.get(key) || {
      lesson_id: String(row.lesson_id || "").trim(),
      lesson_title: String(row.lesson_title || "").trim() || "Lecon",
      session_date: String(row.session_date || "").slice(0, 10),
      present: 0,
      absent: 0,
      late: 0,
      total: 0
    };
    const status = normalizeText(row.status);
    if (status === "present") bucket.present += 1;
    else if (status === "absent") bucket.absent += 1;
    else if (status === "late") bucket.late += 1;
    bucket.total += 1;
    if (String(row.session_date || "").slice(0, 10) > String(bucket.session_date || "")) {
      bucket.session_date = String(row.session_date || "").slice(0, 10);
    }
    byLesson.set(key, bucket);
  });

  return Array.from(byLesson.values()).sort((a, b) => String(b.session_date || "").localeCompare(String(a.session_date || "")));
}

function buildStudentStats(rows) {
  const byStudent = new Map();
  rows.forEach((row) => {
    const name = String(row.student_name || "").trim();
    if (!name) return;
    const bucket = byStudent.get(name) || { name, present: 0, absent: 0, late: 0, total: 0 };
    const status = normalizeText(row.status);
    if (status === "present") bucket.present += 1;
    else if (status === "absent") bucket.absent += 1;
    else if (status === "late") bucket.late += 1;
    bucket.total += 1;
    byStudent.set(name, bucket);
  });

  return Array.from(byStudent.values())
    .map((item) => ({ ...item, rate: item.total ? Math.round((item.present / item.total) * 100) : 0 }))
    .sort((a, b) => b.total - a.total || b.rate - a.rate || a.name.localeCompare(b.name, "fr"));
}

function renderCentreDetail(centre) {
  const section = document.getElementById("centre-detail");
  const container = document.getElementById("centre-detail-content");
  if (!section || !container) return;

  if (!centre) {
    section.hidden = true;
    container.innerHTML = "";
    return;
  }

  const registeredStudents = centre.students.filter((s) => s.is_registered !== false);
  const rows = centre.attendanceRows || [];
  const present = rows.filter((r) => normalizeText(r.status) === "present").length;
  const absent = rows.filter((r) => normalizeText(r.status) === "absent").length;
  const late = rows.filter((r) => normalizeText(r.status) === "late").length;
  const tracked = present + absent + late;
  const presenceRate = tracked ? Math.round((present / tracked) * 100) : 0;

  const lessons = centre.lessonStats || [];
  const lessonsRows = lessons.slice(0, 6).map((lesson) => `
    <tr>
      <td>${lesson.lesson_title || "Lecon"}</td>
      <td>${formatDate(lesson.session_date)}</td>
      <td>${lesson.present}</td>
      <td>${lesson.absent}</td>
      <td>${lesson.late}</td>
      <td>${lesson.total}</td>
    </tr>
  `).join("") || `<tr><td colspan="6">Aucune lecon enregistree.</td></tr>`;

  const studentStats = buildStudentStats(rows).slice(0, 8);
  const studentCards = studentStats.map((student) => `
    <div class="centre-student-stat">
      <div class="centre-student-stat-name">${student.name}</div>
      <div class="centre-student-stat-detail">${student.present}/${student.total} presences (${student.rate}%)</div>
    </div>
  `).join("") || `<p class="muted">Aucune statistique etudiant disponible.</p>`;

  container.innerHTML = `
    <div class="centre-detail-header">
      <div class="centre-detail-title">
        <p class="centre-detail-label">Dashboard centre</p>
        <h3 class="centre-detail-name">${centre.name || "Centre"}</h3>
        <p class="centre-detail-church">${centre.church_name || ""}${centre.instructor_name ? ` • ${centre.instructor_name}` : ""}</p>
      </div>
      <div class="centre-detail-actions">
        <a class="secondary-action compact-action" href="/mission-lessons.html?class=${encodeURIComponent(centre.id || "")}">
          <span class="material-symbols-rounded">edit_note</span> CRUD lecons
        </a>
        <a class="secondary-action compact-action" href="/academy-students.html?class=${encodeURIComponent(centre.id || "")}">
          <span class="material-symbols-rounded">group</span> Fiches etudiants
        </a>
      </div>
    </div>

    <div class="centre-detail-kpis">
      <div class="centre-detail-kpi">
        <span class="centre-detail-kpi-value">${registeredStudents.length}</span>
        <span class="centre-detail-kpi-label">Etudiants inscrits</span>
      </div>
      <div class="centre-detail-kpi">
        <span class="centre-detail-kpi-value">${centre.lessonCount}</span>
        <span class="centre-detail-kpi-label">Lecons</span>
      </div>
      <div class="centre-detail-kpi">
        <span class="centre-detail-kpi-value">${present}</span>
        <span class="centre-detail-kpi-label">Presences</span>
      </div>
      <div class="centre-detail-kpi">
        <span class="centre-detail-kpi-value">${late}</span>
        <span class="centre-detail-kpi-label">Retards</span>
      </div>
      <div class="centre-detail-kpi">
        <span class="centre-detail-kpi-value">${absent}</span>
        <span class="centre-detail-kpi-label">Absences</span>
      </div>
      <div class="centre-detail-kpi">
        <span class="centre-detail-kpi-value">${presenceRate}%</span>
        <span class="centre-detail-kpi-label">Taux presence</span>
      </div>
    </div>

    <div class="centre-detail-section">
      <div class="centre-detail-subsection">
        <p class="centre-detail-subsection-label">Dernieres lecons</p>
        <div style="overflow-x:auto">
          <table class="centre-detail-table">
            <thead>
              <tr>
                <th>Lecon</th><th>Date</th><th>P</th><th>A</th><th>R</th><th>Tot</th>
              </tr>
            </thead>
            <tbody>${lessonsRows}</tbody>
          </table>
        </div>
      </div>
      <div class="centre-detail-subsection">
        <p class="centre-detail-subsection-label">Top etudiants (presence)</p>
        <div class="centre-student-stats">${studentCards}</div>
      </div>
    </div>
  `;

  section.hidden = false;
}

async function loadCentres() {
  const [academyResp, studentResp] = await Promise.all([
    fetch(`/api/academy?ts=${Date.now()}`, { cache: "no-store" }),
    fetch(`/api/academy/students?ts=${Date.now()}`, { cache: "no-store" })
  ]);

  if (!academyResp.ok || !studentResp.ok) throw new Error("Impossible de charger les donnees academie.");

  const academyData = await academyResp.json();
  const studentData = await studentResp.json();

  const classes = (academyData.classes || []).filter(isMissionCentre);
  const allStudents = studentData.students || [];
  const allAttendance = academyData.attendance || [];

  // Build per-class stats
  const classeById = new Map(classes.map((c) => [String(c.id), c]));

  // Count lessons per class
  const lessonsByClass = new Map();
  allAttendance.forEach((row) => {
    const classId = String(row.class_id || "");
    if (!classeById.has(classId)) return;
    const lessonId = String(row.lesson_id || row.lesson_title || "");
    if (!lessonId) return;
    const bucket = lessonsByClass.get(classId) || new Set();
    bucket.add(lessonId);
    lessonsByClass.set(classId, bucket);
  });

  // Get last lesson date per class
  const lastDateByClass = new Map();
  allAttendance.forEach((row) => {
    const classId = String(row.class_id || "");
    if (!classeById.has(classId)) return;
    const date = String(row.session_date || "").slice(0, 10);
    if (!date) return;
    const current = lastDateByClass.get(classId) || "";
    if (date > current) lastDateByClass.set(classId, date);
  });

  // Students per class
  const studentsByClass = new Map();
  allStudents.forEach((student) => {
    const classId = String(student.class_id || "");
    if (!classeById.has(classId)) return;
    const bucket = studentsByClass.get(classId) || [];
    bucket.push(student);
    studentsByClass.set(classId, bucket);
  });

  const attendanceByClass = new Map();
  allAttendance.forEach((row) => {
    const classId = String(row.class_id || "");
    if (!classeById.has(classId)) return;
    const bucket = attendanceByClass.get(classId) || [];
    bucket.push(row);
    attendanceByClass.set(classId, bucket);
  });

  return classes.map((cls) => {
    const rows = attendanceByClass.get(String(cls.id)) || [];
    return {
      ...cls,
      students: studentsByClass.get(String(cls.id)) || [],
      lessonCount: (lessonsByClass.get(String(cls.id)) || new Set()).size,
      lastLessonDate: lastDateByClass.get(String(cls.id)) || "",
      attendanceRows: rows,
      lessonStats: buildLessonStats(rows)
    };
  }).sort((a, b) => String(a.church_name || "").localeCompare(String(b.church_name || ""), "fr") || String(a.name || "").localeCompare(String(b.name || ""), "fr"));
}

function renderCentres(centres) {
  const grid = document.getElementById("centres-grid");
  const empty = document.getElementById("centres-empty");
  const loading = document.getElementById("centres-loading");

  if (loading) loading.hidden = true;

  if (!centres.length) {
    if (grid) grid.hidden = true;
    if (empty) empty.hidden = false;
    renderCentreDetail(null);
    return;
  }

  if (empty) empty.hidden = true;
  if (grid) grid.hidden = false;

  grid.innerHTML = centres.map((centre) => {
    const registeredStudents = centre.students.filter((s) => s.is_registered !== false);
    const studentList = registeredStudents.slice(0, 6).map((s) =>
      `<span class="centre-student-badge">
        <span class="centre-student-avatar">${getInitials(s.name)}</span>
        ${s.name}
      </span>`
    ).join("");
    const more = registeredStudents.length > 6
      ? `<span class="centre-student-badge"><span style="flex:1">${registeredStudents.length - 6} autres</span></span>`
      : "";

    return `
      <article class="centre-card" data-class-id="${centre.id}">
        <div class="centre-card-header">
          <div class="centre-card-title-wrap">
            <div class="centre-card-title">
              <span class="centre-card-label">Centre missionnaire</span>
              <h3 class="centre-card-name">${centre.name || "—"}</h3>
            </div>
            <span class="centre-card-icon">
              <span class="material-symbols-rounded">church</span>
            </span>
          </div>
          <div class="centre-card-meta">
            <span class="material-symbols-rounded">location_on</span>
            ${centre.church_name}
          </div>
          ${centre.instructor_name ? `<div class="centre-card-instructor"><span><span class="material-symbols-rounded">person</span> ${centre.instructor_name}</span></div>` : ""}
        </div>

        <div class="centre-card-stats">
          <div class="centre-card-stat">
            <span class="centre-card-stat-value">${registeredStudents.length}</span>
            <span class="centre-card-stat-label">Etudiants</span>
          </div>
          <div class="centre-card-stat">
            <span class="centre-card-stat-value">${centre.lessonCount}</span>
            <span class="centre-card-stat-label">Lecons</span>
          </div>
          <div class="centre-card-stat">
            <span class="centre-card-stat-value">${formatDate(centre.lastLessonDate)}</span>
            <span class="centre-card-stat-label">Derniere</span>
          </div>
        </div>

        ${registeredStudents.length ? `
        <div class="centre-card-students">
          <p class="centre-card-students-label">Etudiants</p>
          <div class="centre-card-students-list">${studentList}${more}</div>
        </div>` : ""}
        
        <div class="centre-card-actions">
          <a class="centre-card-action" href="/mission-lessons.html?class=${encodeURIComponent(centre.id || "")}">
            <span class="material-symbols-rounded">edit_note</span>
            CRUD lecons
          </a>
        </div>
      </article>`;
  }).join("");

  // Handle card selection
  grid.querySelectorAll(".centre-card").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest(".centre-card-action")) return;
      const classId = card.dataset.classId;
      const centre = centres.find((item) => String(item.id) === String(classId));
      developmentState.selectedClassId = classId || "";
      renderCentreDetail(centre || null);
      // Reset all card highlights
      grid.querySelectorAll(".centre-card").forEach((item) => {
        item.style.outline = "none";
        item.style.boxShadow = "var(--dev-card-shadow)";
      });
      // Highlight selected card
      card.style.boxShadow = "0 0 0 2px rgba(20, 121, 100, 0.32), 0 16px 40px rgba(17, 59, 84, 0.1)";
    });
  });

  // Pre-select first or last selected centre
  const selected = centres.find((item) => String(item.id) === String(developmentState.selectedClassId)) || centres[0];
  if (selected) {
    developmentState.selectedClassId = String(selected.id || "");
    renderCentreDetail(selected);
    const selectedCard = grid.querySelector(`.centre-card[data-class-id="${CSS.escape(String(selected.id || ""))}"]`);
    if (selectedCard) {
      selectedCard.style.boxShadow = "0 0 0 2px rgba(20, 121, 100, 0.32), 0 16px 40px rgba(17, 59, 84, 0.1)";
    }
  }
}

async function bootstrap() {
  if (window.AppAuth?.requireAuth) await window.AppAuth.requireAuth();
  if (window.AppAuth?.canManageUsers?.()) {
    document.querySelectorAll("[data-manage-users-link]").forEach((el) => { el.hidden = false; });
  }

  async function refresh() {
    try {
      const centres = await loadCentres();
      developmentState.centres = centres;
      renderCentres(centres);
    } catch (err) {
      const loading = document.getElementById("centres-loading");
      if (loading) { loading.hidden = false; loading.textContent = err.message; }
    }
  }

  document.getElementById("btn-refresh-centres")?.addEventListener("click", refresh);
  await refresh();
}

document.addEventListener("DOMContentLoaded", bootstrap);
