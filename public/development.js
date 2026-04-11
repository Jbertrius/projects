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
  `).join("") || `<tr><td colspan="6" class="muted">Aucune lecon enregistree.</td></tr>`;

  const studentStats = buildStudentStats(rows).slice(0, 8);
  const studentCards = studentStats.map((student) => `
    <div style="padding:10px 12px;border-radius:12px;background:rgba(16,51,71,0.05);border:1px solid rgba(16,51,71,0.08)">
      <div style="font-weight:700;color:#12314a">${student.name}</div>
      <div style="font-size:0.8rem;color:var(--muted);margin-top:2px">${student.present}/${student.total} presences (${student.rate}%)</div>
    </div>
  `).join("") || `<p class="muted">Aucune statistique etudiant disponible.</p>`;

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:14px">
      <div>
        <p class="section-label">Dashboard centre</p>
        <h3 style="font-family:'Sora',sans-serif;font-size:1.22rem;font-weight:800;letter-spacing:-0.03em;color:#12314a;margin:0">${centre.name || "Centre"}</h3>
        <p class="muted" style="margin-top:4px">${centre.church_name || ""}${centre.instructor_name ? ` • ${centre.instructor_name}` : ""}</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="secondary-action compact-action" href="/mission-lessons.html?class=${encodeURIComponent(centre.id || "")}">CRUD lecons/attendances</a>
        <a class="secondary-action compact-action" href="/academy-students.html?class=${encodeURIComponent(centre.id || "")}">Ouvrir fiches etudiants</a>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px">
      <div style="padding:10px 12px;border-radius:12px;background:rgba(20,121,100,0.08)"><div style="font-size:1.2rem;font-weight:800;color:#0c5949">${registeredStudents.length}</div><div style="font-size:0.76rem;color:#0c5949">Etudiants inscrits</div></div>
      <div style="padding:10px 12px;border-radius:12px;background:rgba(81,183,234,0.11)"><div style="font-size:1.2rem;font-weight:800;color:#1e5f8a">${centre.lessonCount}</div><div style="font-size:0.76rem;color:#1e5f8a">Lecons</div></div>
      <div style="padding:10px 12px;border-radius:12px;background:rgba(20,121,100,0.08)"><div style="font-size:1.2rem;font-weight:800;color:#0c5949">${present}</div><div style="font-size:0.76rem;color:#0c5949">Presences</div></div>
      <div style="padding:10px 12px;border-radius:12px;background:rgba(245,195,44,0.17)"><div style="font-size:1.2rem;font-weight:800;color:#7a5c00">${late}</div><div style="font-size:0.76rem;color:#7a5c00">Retards</div></div>
      <div style="padding:10px 12px;border-radius:12px;background:rgba(220,38,38,0.11)"><div style="font-size:1.2rem;font-weight:800;color:#9f1239">${absent}</div><div style="font-size:0.76rem;color:#9f1239">Absences</div></div>
      <div style="padding:10px 12px;border-radius:12px;background:rgba(16,51,71,0.08)"><div style="font-size:1.2rem;font-weight:800;color:#12314a">${presenceRate}%</div><div style="font-size:0.76rem;color:#12314a">Taux presence</div></div>
    </div>

    <div style="display:grid;grid-template-columns:1.15fr 1fr;gap:14px">
      <div style="padding:12px;border-radius:12px;border:1px solid rgba(16,51,71,0.08);background:rgba(255,255,255,0.9)">
        <p class="section-label" style="margin-bottom:8px">Dernieres lecons</p>
        <div style="overflow:auto">
          <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
            <thead>
              <tr style="text-align:left;color:var(--muted);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.08em">
                <th style="padding:6px 4px">Lecon</th><th style="padding:6px 4px">Date</th><th style="padding:6px 4px">P</th><th style="padding:6px 4px">A</th><th style="padding:6px 4px">R</th><th style="padding:6px 4px">Tot</th>
              </tr>
            </thead>
            <tbody>${lessonsRows}</tbody>
          </table>
        </div>
      </div>
      <div style="padding:12px;border-radius:12px;border:1px solid rgba(16,51,71,0.08);background:rgba(255,255,255,0.9)">
        <p class="section-label" style="margin-bottom:8px">Top etudiants (presence)</p>
        <div style="display:grid;gap:8px">${studentCards}</div>
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
  if (grid) { grid.hidden = false; grid.style.display = "grid"; }

  grid.innerHTML = centres.map((centre) => {
    const registeredStudents = centre.students.filter((s) => s.is_registered !== false);
    const studentList = registeredStudents.slice(0, 6).map((s) =>
      `<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;background:rgba(16,51,71,0.06);font-size:0.78rem;font-weight:600">
        <span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:rgba(20,121,100,0.15);color:#0c5949;font-size:0.65rem;font-weight:800">${getInitials(s.name)}</span>
        ${s.name}
      </span>`
    ).join("");
    const more = registeredStudents.length > 6
      ? `<span style="padding:4px 10px;border-radius:999px;background:rgba(16,51,71,0.06);font-size:0.78rem;color:var(--muted)">+${registeredStudents.length - 6} autres</span>`
      : "";

    return `
      <article class="centre-card" data-class-id="${centre.id}" style="border-radius:20px;border:1px solid rgba(255,255,255,0.7);background:rgba(255,255,255,0.92);box-shadow:0 12px 36px rgba(17,59,84,0.08);overflow:hidden;cursor:pointer">
        <div style="padding:20px 22px 16px;background:linear-gradient(135deg,rgba(20,121,100,0.07),rgba(255,255,255,0))">
          <div style="display:flex;justify-content:space-between;align-items:start;gap:10px;margin-bottom:10px">
            <div>
              <p style="font-size:0.72rem;font-weight:800;text-transform:uppercase;letter-spacing:0.12em;color:var(--muted);margin-bottom:4px">Centre missionnaire</p>
              <h3 style="font-family:'Sora',sans-serif;font-size:1.05rem;font-weight:800;letter-spacing:-0.03em;color:#12314a;margin:0">${centre.name || "—"}</h3>
            </div>
            <span style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:14px;background:rgba(20,121,100,0.1);flex-shrink:0">
              <span class="material-symbols-rounded" style="font-size:1.2rem;color:#0c5949">church</span>
            </span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;font-size:0.85rem;color:#0c5949;font-weight:600">
            <span class="material-symbols-rounded" style="font-size:1rem">location_on</span>
            ${centre.church_name}
          </div>
          ${centre.instructor_name ? `<div style="margin-top:6px;font-size:0.82rem;color:var(--muted)"><span class="material-symbols-rounded" style="font-size:0.9rem;vertical-align:-3px">person</span> ${centre.instructor_name}</div>` : ""}
        </div>

        <div style="padding:14px 22px;border-top:1px solid rgba(16,51,71,0.07);display:flex;gap:18px">
          <div style="text-align:center">
            <div style="font-family:'Sora',sans-serif;font-size:1.35rem;font-weight:800;letter-spacing:-0.05em;color:#12314a">${registeredStudents.length}</div>
            <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted)">etudiants</div>
          </div>
          <div style="text-align:center">
            <div style="font-family:'Sora',sans-serif;font-size:1.35rem;font-weight:800;letter-spacing:-0.05em;color:#12314a">${centre.lessonCount}</div>
            <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted)">lecons</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:0.88rem;font-weight:600;color:#12314a">${formatDate(centre.lastLessonDate)}</div>
            <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted)">derniere lecon</div>
          </div>
        </div>

        ${registeredStudents.length ? `
        <div style="padding:14px 22px 18px;border-top:1px solid rgba(16,51,71,0.07)">
          <p style="font-size:0.72rem;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted);margin-bottom:10px">Etudiants</p>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${studentList}${more}</div>
        </div>` : ""}
        <div style="padding:12px 22px 16px;border-top:1px solid rgba(16,51,71,0.07);display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap">
          <a class="centre-card-action secondary-action compact-action" href="/mission-lessons.html?class=${encodeURIComponent(centre.id || "")}" style="font-size:0.78rem;text-decoration:none">
            <span class="material-symbols-rounded" aria-hidden="true" style="font-size:0.9rem">edit_note</span>
            CRUD lecons
          </a>
        </div>
      </article>`;
  }).join("");

  grid.querySelectorAll(".centre-card").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest(".centre-card-action")) return;
      const classId = card.dataset.classId;
      const centre = centres.find((item) => String(item.id) === String(classId));
      developmentState.selectedClassId = classId || "";
      renderCentreDetail(centre || null);
      grid.querySelectorAll(".centre-card").forEach((item) => {
        item.style.outline = "none";
        item.style.boxShadow = "0 12px 36px rgba(17,59,84,0.08)";
      });
      card.style.boxShadow = "0 0 0 2px rgba(20,121,100,0.32), 0 16px 40px rgba(17,59,84,0.1)";
    });
  });

  const selected = centres.find((item) => String(item.id) === String(developmentState.selectedClassId)) || centres[0];
  if (selected) {
    developmentState.selectedClassId = String(selected.id || "");
    renderCentreDetail(selected);
    const selectedCard = grid.querySelector(`.centre-card[data-class-id="${CSS.escape(String(selected.id || ""))}"]`);
    if (selectedCard) {
      selectedCard.style.boxShadow = "0 0 0 2px rgba(20,121,100,0.32), 0 16px 40px rgba(17,59,84,0.1)";
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
