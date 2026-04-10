const academyStudentState = {
  students: [],
  filtered: [],
  selectedId: "",
  classOptions: [],
  isLoading: false,
  filters: {
    search: "",
    classId: "all",
    status: "all"
  }
};

function showFeedback(message, tone = "info") {
  const feedback = document.getElementById("app-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = `app-feedback is-${tone}`;
  feedback.hidden = false;
  window.clearTimeout(showFeedback.timeoutId);
  showFeedback.timeoutId = window.setTimeout(() => {
    feedback.hidden = true;
  }, 4000);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeSummitStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "verbal") return "verbal";
  if (normalized === "inscrit") return "inscrit";
  if (["paiement", "paiement recu", "paiement reçu"].includes(normalized)) return "paiement";
  return "";
}

function getSelectedStudent() {
  return academyStudentState.students.find((student) => student.id === academyStudentState.selectedId) || null;
}

function buildCanonicalName(firstName, lastName, fallback) {
  return [String(firstName || "").trim(), String(lastName || "").trim()].filter(Boolean).join(" ").trim() || String(fallback || "").trim();
}

function updateRefreshButton() {
  const button = document.getElementById("academy-students-refresh");
  if (!button) return;
  button.disabled = academyStudentState.isLoading;
  button.textContent = academyStudentState.isLoading ? "Actualisation..." : "Actualiser";
}

function populateClassFilter() {
  const classFilter = document.getElementById("academy-student-records-class");
  if (!classFilter) return;
  classFilter.innerHTML = [
    `<option value="all">Toutes les classes</option>`,
    ...academyStudentState.classOptions.map((item) => `<option value="${item.id}">${item.name}</option>`)
  ].join("");
  classFilter.value = academyStudentState.filters.classId;
}

function applyFilters() {
  const search = normalizeText(academyStudentState.filters.search);
  const classId = academyStudentState.filters.classId;
  const status = normalizeText(academyStudentState.filters.status);

  academyStudentState.filtered = academyStudentState.students.filter((student) => {
    const haystack = normalizeText([
      student.name,
      student.first_name,
      student.last_name,
      student.class_name,
      student.instructor_name,
      student.church_name,
      student.subgroup,
      student.notes
    ].join(" "));
    const searchOk = !search || haystack.includes(search);
    const classOk = classId === "all" || String(student.class_id || "") === classId;
    const statusOk = status === "all" || normalizeText(student.status) === status;
    return searchOk && classOk && statusOk;
  });
}

function renderStudentList() {
  const container = document.getElementById("academy-student-records-list");
  const summary = document.getElementById("academy-student-records-visible");
  const count = document.getElementById("academy-students-summary");
  if (!container || !summary || !count) return;

  summary.textContent = `${academyStudentState.filtered.length} fiches visibles`;
  count.textContent = `${academyStudentState.students.length} etudiants`;

  if (!academyStudentState.filtered.length) {
    container.innerHTML = `<div class="empty-state">Aucune fiche ne correspond aux filtres actuels.</div>`;
    return;
  }

  container.innerHTML = academyStudentState.filtered.map((student) => {
    const active = academyStudentState.selectedId === student.id;
    const statusClass = normalizeText(student.status) === "non inscrit" ? "status-pill-warning" : "";
    return `
      <button class="pastor-row ${active ? "is-active" : ""}" type="button" data-student-id="${student.id}">
        <div class="pastor-row-main">
          <strong>${student.name || "Nom a completer"}</strong>
          <span>${student.class_name || "-"}${student.instructor_name ? ` · ${student.instructor_name}` : ""}</span>
        </div>
        <div class="pastor-row-side">
          <span>${student.present_count || 0} presences</span>
          <span class="status-pill ${statusClass}">${student.status || "Inscrit"}</span>
        </div>
      </button>
    `;
  }).join("");

  container.querySelectorAll("[data-student-id]").forEach((button) => {
    button.addEventListener("click", () => {
      academyStudentState.selectedId = button.dataset.studentId;
      renderStudentList();
      renderEditor();
    });
  });
}

function renderActivityPills(student) {
  const target = document.getElementById("academy-student-activity-pills");
  if (!target) return;
  const pills = [
    `${student.lesson_count || 0} lecons`,
    `${student.present_count || 0} presences`,
    `${student.absent_count || 0} absences`,
    `${student.unregistered_lesson_count || 0} non inscrit`
  ];
  target.innerHTML = pills.map((item) => `<span class="academy-data-pill">${item}</span>`).join("");
}

function renderEditor() {
  const student = getSelectedStudent();
  const title = document.getElementById("academy-student-editor-title");
  const status = document.getElementById("academy-student-editor-status");
  const form = document.getElementById("academy-student-form");
  if (!title || !status || !form) return;

  if (!student) {
    title.textContent = "Selectionner un etudiant";
    status.textContent = "Aucune selection";
    form.reset();
    document.getElementById("academy-student-id").value = "";
    document.getElementById("academy-student-activity-pills").innerHTML = "";
    document.getElementById("academy-student-last-lesson").textContent = "-";
    return;
  }

  title.textContent = student.name || "Fiche etudiant";
  status.textContent = student.status || (student.is_registered === false ? "Non inscrit" : "Inscrit");
  status.className = `status-pill ${normalizeText(status.textContent) === "non inscrit" ? "status-pill-warning" : ""}`;
  document.getElementById("academy-student-id").value = student.id || "";
  document.getElementById("academy-student-name").value = student.name || "";
  document.getElementById("academy-student-first-name").value = student.first_name || "";
  document.getElementById("academy-student-last-name").value = student.last_name || "";
  document.getElementById("academy-student-status").value = student.status || (student.is_registered === false ? "Non inscrit" : "Inscrit");
  document.getElementById("academy-student-class").value = student.class_name || "";
  document.getElementById("academy-student-instructor").value = student.instructor_name || "";
  document.getElementById("academy-student-church").value = student.church_name || "";
  document.getElementById("academy-student-subgroup").value = student.subgroup || "";
  document.getElementById("academy-student-notes").value = student.notes || "";
  document.getElementById("academy-student-summit-status").value = student.gmcs_summit_status || "";
  document.getElementById("academy-student-summit-note").value = student.gmcs_summit_note || "";
  document.getElementById("academy-student-last-lesson").textContent = student.last_lesson_date || "-";
  renderActivityPills(student);
}

async function loadStudents() {
  academyStudentState.isLoading = true;
  updateRefreshButton();
  try {
    const response = await fetch(`/api/academy/students?ts=${Date.now()}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "Impossible de charger les fiches etudiants.");
    }

    academyStudentState.students = payload.students || [];
    academyStudentState.classOptions = payload.classOptions || [];
    if (!academyStudentState.selectedId && academyStudentState.students.length) {
      academyStudentState.selectedId = academyStudentState.students[0].id;
    }
    if (!academyStudentState.students.some((student) => student.id === academyStudentState.selectedId)) {
      academyStudentState.selectedId = academyStudentState.students[0]?.id || "";
    }

    populateClassFilter();
    applyFilters();
    renderStudentList();
    renderEditor();
  } finally {
    academyStudentState.isLoading = false;
    updateRefreshButton();
  }
}

async function saveStudent(event) {
  event.preventDefault();
  const studentId = document.getElementById("academy-student-id").value;
  if (!studentId) {
    showFeedback("Selectionne d'abord un etudiant.", "warning");
    return;
  }

  const canonicalName = buildCanonicalName(
    document.getElementById("academy-student-first-name").value,
    document.getElementById("academy-student-last-name").value,
    document.getElementById("academy-student-name").value
  );
  document.getElementById("academy-student-name").value = canonicalName;

  const selected = getSelectedStudent() || {};
  const summitStatus = normalizeSummitStatus(document.getElementById("academy-student-summit-status").value);
  const payload = {
    id: studentId,
    name: canonicalName,
    first_name: document.getElementById("academy-student-first-name").value,
    last_name: document.getElementById("academy-student-last-name").value,
    status: document.getElementById("academy-student-status").value,
    subgroup: document.getElementById("academy-student-subgroup").value,
    notes: document.getElementById("academy-student-notes").value,
    gmcs_summit_status: summitStatus,
    gmcs_summit_note: document.getElementById("academy-student-summit-note").value,
    class_id: selected.class_id,
    class_name: selected.class_name,
    instructor_name: selected.instructor_name,
    church_name: selected.church_name
  };

  const response = await fetch("/api/academy/students/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok || result.ok === false) {
    throw new Error(result.error || "Impossible d'enregistrer la fiche etudiant.");
  }

  showFeedback("Fiche etudiant enregistree.", "success");
  await loadStudents();
}

function attachFilters() {
  document.getElementById("academy-student-records-search")?.addEventListener("input", (event) => {
    academyStudentState.filters.search = event.target.value;
    applyFilters();
    renderStudentList();
  });

  document.getElementById("academy-student-records-class")?.addEventListener("change", (event) => {
    academyStudentState.filters.classId = event.target.value;
    applyFilters();
    renderStudentList();
  });

  document.getElementById("academy-student-records-status")?.addEventListener("change", (event) => {
    academyStudentState.filters.status = event.target.value;
    applyFilters();
    renderStudentList();
  });

  document.getElementById("academy-student-records-reset")?.addEventListener("click", () => {
    academyStudentState.filters = { search: "", classId: "all", status: "all" };
    document.getElementById("academy-student-records-search").value = "";
    document.getElementById("academy-student-records-status").value = "all";
    populateClassFilter();
    applyFilters();
    renderStudentList();
  });

  document.getElementById("academy-students-refresh")?.addEventListener("click", async () => {
    try {
      await loadStudents();
      showFeedback("Fiches etudiants actualisees.", "success");
    } catch (error) {
      showFeedback(error.message, "error");
    }
  });
}

function attachEditor() {
  document.getElementById("academy-student-form")?.addEventListener("submit", (event) => {
    saveStudent(event).catch((error) => showFeedback(error.message, "error"));
  });

  const nameInput = document.getElementById("academy-student-name");
  const firstNameInput = document.getElementById("academy-student-first-name");
  const lastNameInput = document.getElementById("academy-student-last-name");

  function syncCanonical() {
    const suggested = buildCanonicalName(firstNameInput?.value, lastNameInput?.value, nameInput?.value);
    if (suggested) {
      nameInput.value = suggested;
    }
  }

  firstNameInput?.addEventListener("input", syncCanonical);
  lastNameInput?.addEventListener("input", syncCanonical);
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

async function boot() {
  await window.AppAuth.requireAuth();
  attachNavigationHandlers();
  attachFilters();
  attachEditor();
  await loadStudents();
}

boot().catch((error) => showFeedback(error.message, "error"));
