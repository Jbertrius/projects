const academyClassesState = {
  classes: [],
  students: [],
  pastors: [],
  filtered: [],
  selectedId: "",
  isLoading: false,
  isSaving: false,
  filters: {
    search: "",
    type: "all",
    sort: "name_asc"
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

function formatDateLabel(value) {
  if (!value) return "-";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

function getSelectedClass() {
  return academyClassesState.classes.find((item) => item.id === academyClassesState.selectedId) || null;
}

function updateLocalClass(updated) {
  academyClassesState.classes = academyClassesState.classes.map((item) =>
    item.id === updated.id ? { ...item, ...updated } : item
  );
}

function getMovableStudents(targetClassId) {
  return academyClassesState.students
    .filter((student) => String(student.class_id || "") !== String(targetClassId || ""))
    .filter((student) => Number(student.lesson_count || 0) === 0 && Number(student.unregistered_lesson_count || 0) === 0)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "fr"));
}

function getUnlinkedPastorsForClass(className) {
  const target = normalizeText(className);
  return academyClassesState.pastors
    .filter((pastor) => normalizeText(pastor.academy_class) === target)
    .filter((pastor) => !String(pastor.student_id || "").trim())
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "fr"));
}

function updateRefreshButton() {
  const button = document.getElementById("academy-classes-refresh");
  if (!button) return;
  button.disabled = academyClassesState.isLoading;
  button.textContent = academyClassesState.isLoading ? "Actualisation..." : "Actualiser";
}

function buildClassData(classes, students, attendance) {
  const attendanceByClass = new Map();
  const lessonIdsByClass = new Map();
  const lastLessonByClass = new Map();

  (attendance || []).forEach((row) => {
    const classId = String(row.class_id || "").trim();
    if (!classId) return;
    const rows = attendanceByClass.get(classId) || [];
    rows.push(row);
    attendanceByClass.set(classId, rows);

    const lessonIds = lessonIdsByClass.get(classId) || new Set();
    const lessonId = String(row.lesson_id || row.lesson_title || "").trim();
    if (lessonId) lessonIds.add(lessonId);
    lessonIdsByClass.set(classId, lessonIds);

    const lessonDate = String(row.session_date || "").slice(0, 10);
    const currentDate = lastLessonByClass.get(classId) || "";
    if (lessonDate && lessonDate > currentDate) lastLessonByClass.set(classId, lessonDate);
  });

  return (classes || []).map((academyClass) => {
    const classId = String(academyClass.id || "").trim();
    const classStudents = (students || [])
      .filter((student) => String(student.class_id || student.class_name || "").trim() === classId)
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "fr"));
    const classPastors = getUnlinkedPastorsForClass(academyClass.name || academyClass.class_code || academyClass.id);
    const registeredStudents = classStudents.filter((student) => student.is_registered !== false);
    return {
      ...academyClass,
      students: classStudents,
      pastors: classPastors,
      registered_count: registeredStudents.length,
      student_count: classStudents.length,
      pastor_count: classPastors.length,
      member_count: classStudents.length + classPastors.length,
      lesson_count: (lessonIdsByClass.get(classId) || new Set()).size,
      last_lesson_date: lastLessonByClass.get(classId) || "",
      attendance_rows: attendanceByClass.get(classId) || []
    };
  });
}

function applyFilters() {
  const search = normalizeText(academyClassesState.filters.search);
  const type = academyClassesState.filters.type;
  const sort = academyClassesState.filters.sort;

  let list = academyClassesState.classes.filter((academyClass) => {
    const typeOk =
      type === "all" ||
      (type === "mission" && Boolean(academyClass.is_missionary || academyClass.church_name)) ||
      (type === "academy" && !Boolean(academyClass.is_missionary || academyClass.church_name));

    if (!typeOk) return false;

    if (!search) return true;
    const haystack = normalizeText([
      academyClass.name,
      academyClass.instructor_name,
      academyClass.church_name,
      academyClass.church_pastor_name,
      ...(academyClass.students || []).map((student) => student.name),
      ...(academyClass.pastors || []).map((pastor) => pastor.name)
    ].join(" "));
    return haystack.includes(search);
  });

  list = [...list].sort((left, right) => {
    if (sort === "students_desc") return right.member_count - left.member_count || String(left.name || "").localeCompare(String(right.name || ""), "fr");
    if (sort === "lessons_desc") return right.lesson_count - left.lesson_count || String(left.name || "").localeCompare(String(right.name || ""), "fr");
    return String(left.name || "").localeCompare(String(right.name || ""), "fr");
  });

  academyClassesState.filtered = list;
  if (!list.some((item) => item.id === academyClassesState.selectedId)) {
    academyClassesState.selectedId = list[0]?.id || "";
  }
}

function renderClassList() {
  const container = document.getElementById("academy-classes-list-content");
  const visible = document.getElementById("academy-classes-visible");
  const summary = document.getElementById("academy-classes-summary");
  if (!container || !visible || !summary) return;

  visible.textContent = `${academyClassesState.filtered.length} classes visibles`;
  summary.textContent = `${academyClassesState.classes.length} classes · ${academyClassesState.classes.reduce((sum, item) => sum + item.member_count, 0)} membres`;

  if (!academyClassesState.filtered.length) {
    container.innerHTML = `<div class="empty-state">Aucune classe ne correspond aux filtres actuels.</div>`;
    return;
  }

  container.innerHTML = academyClassesState.filtered.map((academyClass) => {
    const active = academyClass.id === academyClassesState.selectedId;
    return `
      <button class="class-row ${active ? "is-active" : ""}" type="button" data-class-id="${academyClass.id}">
        <div class="class-row-main">
          <div>
            <h4 class="class-row-title">${academyClass.name || academyClass.id}</h4>
            <div class="class-row-line">${academyClass.instructor_name || "Instructeur non renseigne"}</div>
          </div>
          <span class="class-badge">${academyClass.member_count} membre${academyClass.member_count > 1 ? "s" : ""}</span>
        </div>
        <div class="class-row-meta">
          <span class="class-badge">${academyClass.student_count} etudiant${academyClass.student_count > 1 ? "s" : ""}</span>
          ${academyClass.pastor_count ? `<span class="class-badge">${academyClass.pastor_count} pasteur${academyClass.pastor_count > 1 ? "s" : ""}</span>` : ""}
          <span class="class-badge">${academyClass.lesson_count} lecon${academyClass.lesson_count > 1 ? "s" : ""}</span>
          ${academyClass.is_missionary || academyClass.church_name ? `<span class="class-badge">Missionnaire</span>` : `<span class="class-badge">Academie</span>`}
        </div>
        <div class="class-row-line">${academyClass.church_name || "Aucune eglise rattachee"}${academyClass.last_lesson_date ? ` · Derniere lecon ${formatDateLabel(academyClass.last_lesson_date)}` : " · Aucune lecon encore enregistree"}</div>
      </button>
    `;
  }).join("");

  container.querySelectorAll("[data-class-id]").forEach((button) => {
    button.addEventListener("click", () => {
      academyClassesState.selectedId = button.dataset.classId;
      renderClassList();
      renderClassDetail();
    });
  });
}

function renderClassDetail() {
  const container = document.getElementById("academy-classes-detail-content");
  if (!container) return;

  const academyClass = getSelectedClass();
  if (!academyClass) {
    container.className = "empty-state";
    container.innerHTML = "Selectionnez une classe pour voir ses membres, meme sans aucune lecon.";
    return;
  }

  const students = academyClass.students || [];
  const pastors = academyClass.pastors || [];
  const movableStudents = getMovableStudents(academyClass.id);
  const memberCards = [
    ...students.map((student) => `
      <div class="student-card">
        <strong>${student.name || student.id || "Etudiant"}</strong>
        <div class="member-badges">
          <span class="member-badge is-student">Etudiant academique</span>
          <span class="member-badge is-status">${student.status || (student.is_registered === false ? "Non inscrit" : "Inscrit")}</span>
        </div>
        <span>${student.subgroup ? `Sous-groupe: ${student.subgroup}` : "Membre academique rattache a la classe"}</span>
        <div class="student-card-actions">
          <a class="secondary-action compact-action" href="/academy-students.html?search=${encodeURIComponent(student.name || student.id || "")}&class=${encodeURIComponent(academyClass.id || "")}">Ouvrir la fiche</a>
          ${Number(student.lesson_count || 0) === 0 && Number(student.unregistered_lesson_count || 0) === 0
            ? `<button class="secondary-action compact-action" type="button" data-remove-student-id="${student.id}">Retirer de la classe</button>`
            : ""}
        </div>
      </div>
    `),
    ...pastors.map((pastor) => `
      <div class="student-card">
        <strong>${pastor.name || "Pasteur"}</strong>
        <div class="member-badges">
          <span class="member-badge is-pastor">Pasteur non lie</span>
          ${pastor.pastor_level ? `<span class="member-badge is-status">${pastor.pastor_level}</span>` : ""}
        </div>
        <span>${pastor.title ? `${pastor.title} · ` : ""}Rattache par correspondance de classe (sans fiche etudiant)</span>
        <div class="student-card-actions">
          <a class="secondary-action compact-action" href="/pastors.html?search=${encodeURIComponent(pastor.name || pastor.id || "")}">Ouvrir la fiche</a>
        </div>
      </div>
    `)
  ].join("");

  container.className = "";
  container.innerHTML = `
    <div class="class-detail-hero">
      <div class="class-detail-head">
        <div>
          <p class="section-label">${academyClass.is_missionary || academyClass.church_name ? "Centre missionnaire" : "Classe academie"}</p>
          <h3>${academyClass.name || academyClass.id}</h3>
          <p class="class-detail-subtitle">${academyClass.instructor_name || "Instructeur non renseigne"}${academyClass.church_name ? ` · ${academyClass.church_name}` : ""}${academyClass.church_pastor_name ? ` · Pst. ${academyClass.church_pastor_name}` : ""}</p>
        </div>
        <div class="detail-actions">
          <a class="secondary-action compact-action" href="/classe.html?id=${encodeURIComponent(academyClass.id || "")}">Ouvrir la classe</a>
          <a class="secondary-action compact-action" href="/academy-students.html?class=${encodeURIComponent(academyClass.id || "")}">Voir les fiches</a>
        </div>
      </div>

      <div class="class-detail-stats">
        <div class="class-stat"><strong>${academyClass.member_count}</strong><span>Membres</span></div>
        <div class="class-stat"><strong>${academyClass.student_count}</strong><span>Etudiants</span></div>
        <div class="class-stat"><strong>${academyClass.pastor_count}</strong><span>Pasteurs</span></div>
        <div class="class-stat"><strong>${academyClass.registered_count}</strong><span>Inscrits</span></div>
        <div class="class-stat"><strong>${academyClass.lesson_count}</strong><span>Lecons</span></div>
        <div class="class-stat"><strong>${academyClass.last_lesson_date ? formatDateLabel(academyClass.last_lesson_date) : "-"}</strong><span>Derniere lecon</span></div>
      </div>

      <section class="admin-panel">
        <div class="card-head" style="margin-bottom:12px">
          <div>
            <p class="section-label">Administration</p>
            <h3>Configuration de la classe</h3>
          </div>
          <p class="muted">Modifiez l'instructeur par defaut et le rattachement missionnaire sans quitter cette page.</p>
        </div>

        <div class="admin-grid">
          <label class="admin-field is-span-2">
            <span class="admin-label">Instructeur par defaut</span>
            <input id="academy-class-instructor" class="filter-control" type="text" value="${academyClass.instructor_name || ""}" placeholder="Ex: Pasteur Jean Dupont" />
            <p class="admin-help">Une lecon peut avoir un autre instructeur, mais cette valeur sert de reference par defaut.</p>
          </label>

          <div class="admin-field is-span-2">
            <div class="admin-toggle-row">
              <div class="admin-toggle-copy">
                <strong>Classe missionnaire</strong>
                <span>Activez si cette classe est rattachee a une eglise partenaire.</span>
              </div>
              <label class="toggle-switch" for="academy-class-is-missionary">
                <input type="checkbox" id="academy-class-is-missionary" ${academyClass.is_missionary || academyClass.church_name ? "checked" : ""} />
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </label>
            </div>
          </div>

          <label class="admin-field">
            <span class="admin-label">Nom de l'eglise</span>
            <input id="academy-class-church-name" class="filter-control" type="text" value="${academyClass.church_name || ""}" placeholder="Ex: Eglise de la Grace" />
          </label>

          <label class="admin-field">
            <span class="admin-label">Pasteur de l'eglise</span>
            <input id="academy-class-church-pastor" class="filter-control" type="text" value="${academyClass.church_pastor_name || ""}" placeholder="Ex: Jean Dupont" />
          </label>
        </div>

        <div class="admin-actions" style="margin-top:16px">
          <button class="primary-action compact-action" type="button" id="academy-class-save">Enregistrer</button>
          <button class="secondary-action compact-action" type="button" id="academy-class-delete">Supprimer la classe vide</button>
          <p class="admin-feedback" id="academy-class-feedback" hidden></p>
        </div>
      </section>

      <section class="admin-panel">
        <div class="card-head" style="margin-bottom:12px">
          <div>
            <p class="section-label">Etudiants</p>
            <h3>Ajouter ou retirer</h3>
          </div>
          <p class="muted">Par securite, seuls les etudiants sans historique de lecons peuvent etre deplaces ici.</p>
        </div>
        <div class="admin-grid">
          <label class="admin-field is-span-2">
            <span class="admin-label">Ajouter un etudiant existant</span>
            <select id="academy-class-add-student" class="filter-control">
              <option value="">Choisir un etudiant...</option>
              ${movableStudents.map((student) => `<option value="${student.id}">${student.name}${student.class_name ? ` · ${student.class_name}` : ""}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="admin-actions" style="margin-top:16px">
          <button class="primary-action compact-action" type="button" id="academy-class-add-student-save">Ajouter a cette classe</button>
        </div>
      </section>

      <div>
        <div class="card-head" style="margin-bottom:12px">
          <div>
            <p class="section-label">Membres</p>
            <h3>Membres de classe</h3>
          </div>
          <p class="muted">${academyClass.member_count ? "Vue fusionnee: etudiants academiques + pasteurs non lies, avec badges de type." : "Classe sans membre pour le moment."}</p>
        </div>
        <div class="students-grid">${memberCards || `<div class="empty-state">Aucun membre rattache a cette classe pour le moment.</div>`}</div>
      </div>
    </div>
  `;

  const toggle = document.getElementById("academy-class-is-missionary");
  const churchNameInput = document.getElementById("academy-class-church-name");
  const churchPastorInput = document.getElementById("academy-class-church-pastor");
  const saveButton = document.getElementById("academy-class-save");
  const deleteButton = document.getElementById("academy-class-delete");
  const feedback = document.getElementById("academy-class-feedback");
  const addStudentButton = document.getElementById("academy-class-add-student-save");
  const addStudentSelect = document.getElementById("academy-class-add-student");

  function syncMissionaryFields() {
    const isMissionary = Boolean(toggle?.checked);
    if (churchNameInput) churchNameInput.disabled = !isMissionary;
    if (churchPastorInput) churchPastorInput.disabled = !isMissionary;
  }

  toggle?.addEventListener("change", syncMissionaryFields);
  syncMissionaryFields();

  saveButton?.addEventListener("click", async () => {
    const instructorName = String(document.getElementById("academy-class-instructor")?.value || "").trim();
    const isMissionary = Boolean(toggle?.checked);
    const churchName = String(churchNameInput?.value || "").trim();
    const churchPastorName = String(churchPastorInput?.value || "").trim();

    if (isMissionary && !churchName) {
      if (feedback) {
        feedback.textContent = "Le nom de l'eglise est requis pour une classe missionnaire.";
        feedback.style.color = "#ef4444";
        feedback.hidden = false;
      }
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = "Enregistrement...";
    if (feedback) feedback.hidden = true;

    try {
      const response = await fetch(`/api/academy/classes/${encodeURIComponent(academyClass.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instructor_name: instructorName,
          is_missionary: isMissionary,
          church_name: isMissionary ? churchName : "",
          church_pastor_name: isMissionary ? churchPastorName : ""
        })
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "Erreur serveur");

      updateLocalClass({
        id: academyClass.id,
        instructor_name: instructorName,
        is_missionary: isMissionary,
        church_name: isMissionary ? churchName : "",
        church_pastor_name: isMissionary ? churchPastorName : ""
      });
      applyFilters();
      renderClassList();
      renderClassDetail();

      if (feedback) {
        feedback.textContent = "Classe mise a jour.";
        feedback.style.color = "#147964";
        feedback.hidden = false;
      }
      showFeedback("Configuration de la classe enregistree.", "success");
    } catch (error) {
      if (feedback) {
        feedback.textContent = error.message;
        feedback.style.color = "#ef4444";
        feedback.hidden = false;
      }
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = "Enregistrer";
    }
  });

  deleteButton?.addEventListener("click", async () => {
    if (academyClass.student_count > 0 || academyClass.lesson_count > 0 || academyClass.pastor_count > 0) {
      if (feedback) {
        feedback.textContent = "La classe doit etre vide et sans historique pour etre supprimee.";
        feedback.style.color = "#ef4444";
        feedback.hidden = false;
      }
      return;
    }
    const confirmed = window.confirm(`Supprimer definitivement la classe ${academyClass.name || academyClass.id} ?`);
    if (!confirmed) return;

    deleteButton.disabled = true;
    deleteButton.textContent = "Suppression...";
    if (feedback) feedback.hidden = true;
    try {
      const response = await fetch(`/api/academy/classes/${encodeURIComponent(academyClass.id)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "Erreur serveur");
      academyClassesState.classes = academyClassesState.classes.filter((item) => item.id !== academyClass.id);
      applyFilters();
      renderClassList();
      renderClassDetail();
      showFeedback("Classe supprimee.", "success");
    } catch (error) {
      if (feedback) {
        feedback.textContent = error.message;
        feedback.style.color = "#ef4444";
        feedback.hidden = false;
      }
    } finally {
      deleteButton.disabled = false;
      deleteButton.textContent = "Supprimer la classe vide";
    }
  });

  addStudentButton?.addEventListener("click", async () => {
    const studentId = String(addStudentSelect?.value || "").trim();
    if (!studentId) {
      showFeedback("Selectionnez d'abord un etudiant a rattacher.", "info");
      return;
    }
    const student = academyClassesState.students.find((item) => item.id === studentId);
    if (!student) return;

    addStudentButton.disabled = true;
    addStudentButton.textContent = "Ajout...";
    try {
      const response = await fetch("/api/academy/students/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...student,
          class_id: academyClass.id
        })
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "Erreur serveur");
      await loadData();
      academyClassesState.selectedId = academyClass.id;
      applyFilters();
      renderClassList();
      renderClassDetail();
      showFeedback("Etudiant rattache a la classe.", "success");
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      addStudentButton.disabled = false;
      addStudentButton.textContent = "Ajouter a cette classe";
    }
  });

  container.querySelectorAll("[data-remove-student-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const studentId = button.dataset.removeStudentId;
      const student = academyClassesState.students.find((item) => item.id === studentId);
      if (!student) return;
      button.disabled = true;
      button.textContent = "Retrait...";
      try {
        const response = await fetch("/api/academy/students/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...student,
            class_id: ""
          })
        });
        const payload = await response.json();
        if (!response.ok || payload.ok === false) throw new Error(payload.error || "Erreur serveur");
        await loadData();
        academyClassesState.selectedId = academyClass.id;
        applyFilters();
        renderClassList();
        renderClassDetail();
        showFeedback("Etudiant retire de la classe.", "success");
      } catch (error) {
        showFeedback(error.message, "error");
      } finally {
        button.disabled = false;
        button.textContent = "Retirer de la classe";
      }
    });
  });
}

async function loadData() {
  academyClassesState.isLoading = true;
  updateRefreshButton();
  try {
    const [academyResponse, studentResponse, pastorResponse] = await Promise.all([
      fetch(`/api/academy?ts=${Date.now()}`, { cache: "no-store" }),
      fetch(`/api/academy/students?ts=${Date.now()}`, { cache: "no-store" }),
      fetch(`/api/pastors?ts=${Date.now()}`, { cache: "no-store" })
    ]);
    const academyPayload = await academyResponse.json();
    const studentPayload = await studentResponse.json();
    const pastorPayload = await pastorResponse.json();
    if (!academyResponse.ok || academyPayload.ok === false) throw new Error(academyPayload.error || "Impossible de charger les classes.");
    if (!studentResponse.ok || studentPayload.ok === false) throw new Error(studentPayload.error || "Impossible de charger les etudiants.");
    if (!pastorResponse.ok || pastorPayload.ok === false) throw new Error(pastorPayload.error || "Impossible de charger les pasteurs.");

    academyClassesState.students = studentPayload.students || [];
    academyClassesState.pastors = pastorPayload.pastors || [];
    academyClassesState.classes = buildClassData(academyPayload.classes || [], academyClassesState.students, academyPayload.attendance || []);
    applyFilters();
    renderClassList();
    renderClassDetail();
  } catch (error) {
    showFeedback(error.message, "error");
  } finally {
    academyClassesState.isLoading = false;
    updateRefreshButton();
  }
}

function attachEvents() {
  document.getElementById("academy-classes-search")?.addEventListener("input", (event) => {
    academyClassesState.filters.search = event.target.value;
    applyFilters();
    renderClassList();
    renderClassDetail();
  });

  document.getElementById("academy-classes-type")?.addEventListener("change", (event) => {
    academyClassesState.filters.type = event.target.value;
    applyFilters();
    renderClassList();
    renderClassDetail();
  });

  document.getElementById("academy-classes-sort")?.addEventListener("change", (event) => {
    academyClassesState.filters.sort = event.target.value;
    applyFilters();
    renderClassList();
    renderClassDetail();
  });

  document.getElementById("academy-classes-reset")?.addEventListener("click", () => {
    academyClassesState.filters = { search: "", type: "all", sort: "name_asc" };
    document.getElementById("academy-classes-search").value = "";
    document.getElementById("academy-classes-type").value = "all";
    document.getElementById("academy-classes-sort").value = "name_asc";
    applyFilters();
    renderClassList();
    renderClassDetail();
  });

  document.getElementById("academy-classes-refresh")?.addEventListener("click", async () => {
    await loadData();
    showFeedback("Classes academie actualisees.", "success");
  });

  document.getElementById("academy-class-create-save")?.addEventListener("click", async () => {
    const name = String(document.getElementById("academy-class-create-name")?.value || "").trim();
    const instructor = String(document.getElementById("academy-class-create-instructor")?.value || "").trim();
    const church = String(document.getElementById("academy-class-create-church")?.value || "").trim();
    const pastor = String(document.getElementById("academy-class-create-pastor")?.value || "").trim();
    const feedback = document.getElementById("academy-class-create-feedback");
    const button = document.getElementById("academy-class-create-save");
    if (!name) {
      if (feedback) {
        feedback.textContent = "Le nom de la classe est requis.";
        feedback.style.color = "#ef4444";
        feedback.hidden = false;
      }
      return;
    }
    if (button) {
      button.disabled = true;
      button.textContent = "Creation...";
    }
    if (feedback) feedback.hidden = true;
    try {
      const response = await fetch("/api/academy/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          class_code: name,
          instructor_name: instructor,
          is_missionary: Boolean(church),
          church_name: church,
          church_pastor_name: pastor
        })
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "Erreur serveur");
      document.getElementById("academy-class-create-name").value = "";
      document.getElementById("academy-class-create-instructor").value = "";
      document.getElementById("academy-class-create-church").value = "";
      document.getElementById("academy-class-create-pastor").value = "";
      await loadData();
      academyClassesState.selectedId = payload.class.id;
      applyFilters();
      renderClassList();
      renderClassDetail();
      if (feedback) {
        feedback.textContent = "Classe creee.";
        feedback.style.color = "#147964";
        feedback.hidden = false;
      }
    } catch (error) {
      if (feedback) {
        feedback.textContent = error.message;
        feedback.style.color = "#ef4444";
        feedback.hidden = false;
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Creer la classe";
      }
    }
  });

  document.querySelectorAll("[data-target]").forEach((button) => {
    button.addEventListener("click", () => {
      document.getElementById(button.dataset.target)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

async function boot() {
  await window.AppAuth.requireAuth();
  attachEvents();
  await loadData();
}

boot().catch((error) => showFeedback(error.message, "error"));
