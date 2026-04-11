const missionState = {
  classes: [],
  attendance: [],
  selectedClassId: "",
  selectedLesson: null,
  isSaving: false
};

function showFeedback(message, tone = "info") {
  const feedback = document.getElementById("app-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = `app-feedback is-${tone}`;
  feedback.hidden = false;
  clearTimeout(showFeedback.timeoutId);
  showFeedback.timeoutId = setTimeout(() => {
    feedback.hidden = true;
  }, 5000);
}

function isMissionCentre(cls) {
  return Boolean(String(cls?.church_name || "").trim());
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function parseDateValue(value) {
  const parsed = new Date(value || "");
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatFullDate(value) {
  const date = parseDateValue(value);
  return date ? date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : value || "-";
}

function formatInstructorLine(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return /^(pst|pasteur|ev|instructeur)\b/iu.test(trimmed) ? trimmed : `Pst ${trimmed}`;
}

function getSubgroupHeader(groupName, count) {
  const normalized = String(groupName || "").trim().toUpperCase();
  if (!normalized || normalized === "SANS GROUPE") return "";
  const icon = normalized === "DMD" ? "⛪️" : "🕊";
  return `${icon}${normalized} (/${count})`;
}

function buildLessonTemplate(lesson, attendanceRows) {
  const rows = attendanceRows
    .filter((row) => String(row.lesson_id || "") === String(lesson.id))
    .sort((a, b) => String(a.student_name || "").localeCompare(String(b.student_name || ""), "fr"));

  const total = rows.length;
  const presentCount = rows.filter((row) => normalizeText(row.status) === "present").length;
  const groups = new Map();

  rows.forEach((row) => {
    const key = String(row.subgroup || "").trim() || "Sans groupe";
    const bucket = groups.get(key) || [];
    bucket.push(row);
    groups.set(key, bucket);
  });

  let runningIndex = 1;
  const groupBlocks = Array.from(groups.entries()).map(([groupName, groupRows]) => {
    const header = getSubgroupHeader(groupName, groupRows.length);
    const lines = groupRows.map((row) => {
      const prefix = normalizeText(row.status) === "absent" ? "✖️" : "👍";
      const line = `${prefix}${runningIndex}- ${row.student_name}`;
      runningIndex += 1;
      return line;
    });
    return header ? [header, ...lines].join("\n") : lines.join("\n");
  });

  return [
    `🔰Classe Ouverte - ${lesson.className} - ${lesson.churchName || "Centre missionnaire"}`,
    `👩‍🏫${formatInstructorLine(lesson.instructorName) || "Pst Instructeur"}`,
    `📝Titre de la leçon : ${lesson.title}`,
    `📆${lesson.date || ""}`,
    "",
    "✅ Confirmé",
    "👍 Présent",
    "❌ Absent",
    "",
    `Total :${presentCount}/${total}`,
    "",
    ...groupBlocks
  ].join("\n");
}

function buildLessonLibrary() {
  const classesById = new Map(missionState.classes.map((item) => [String(item.id), item]));
  const lessons = new Map();

  missionState.attendance.forEach((row) => {
    const classId = String(row.class_id || "");
    if (!classesById.has(classId)) return;
    const lessonId = String(row.lesson_id || "").trim();
    if (!lessonId) return;

    const existing = lessons.get(lessonId) || {
      id: lessonId,
      classId,
      className: row.class_name || classesById.get(classId)?.name || "-",
      churchName: classesById.get(classId)?.church_name || "",
      title: row.lesson_title || "Lecon sans titre",
      date: String(row.session_date || "").slice(0, 10),
      instructorName: classesById.get(classId)?.instructor_name || "-",
      attendanceCount: 0,
      presentCount: 0
    };

    existing.attendanceCount += 1;
    if (normalizeText(row.status) === "present") existing.presentCount += 1;
    lessons.set(lessonId, existing);
  });

  return Array.from(lessons.values()).sort((a, b) => (b.date || "").localeCompare(a.date || "") || String(a.title).localeCompare(String(b.title), "fr"));
}

function buildDraftForClass(academyClass) {
  const classCode = String(academyClass?.name || academyClass?.id || "").trim();
  const church = String(academyClass?.church_name || "Centre missionnaire").trim();
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

function updateButtons() {
  const save = document.getElementById("mission-save");
  const del = document.getElementById("mission-delete");
  if (save) {
    save.disabled = missionState.isSaving;
    save.textContent = missionState.isSaving ? "Enregistrement..." : "Enregistrer la lecon";
  }
  if (del) {
    del.disabled = missionState.isSaving || !missionState.selectedLesson;
  }
}

function getSelectedClassIdForExport() {
  return String(document.getElementById("mission-class-filter")?.value || "all");
}

function getAttendanceRowsForExport() {
  const selectedClassId = getSelectedClassIdForExport();
  const classesById = new Map(missionState.classes.map((item) => [String(item.id), item]));
  return missionState.attendance
    .filter((row) => {
      if (selectedClassId === "all") return true;
      return String(row.class_id || "") === selectedClassId;
    })
    .map((row) => {
      const classMeta = classesById.get(String(row.class_id || "")) || {};
      return {
        class_id: String(row.class_id || ""),
        class_name: row.class_name || classMeta.name || "-",
        church_name: classMeta.church_name || "-",
        instructor_name: classMeta.instructor_name || "-",
        lesson_id: String(row.lesson_id || ""),
        lesson_title: String(row.lesson_title || ""),
        session_date: String(row.session_date || "").slice(0, 10),
        student_name: String(row.student_name || ""),
        subgroup: String(row.subgroup || ""),
        status: String(row.status || "")
      };
    })
    .sort((a, b) => String(b.session_date || "").localeCompare(String(a.session_date || "")) || String(a.class_name || "").localeCompare(String(b.class_name || ""), "fr") || String(a.student_name || "").localeCompare(String(b.student_name || ""), "fr"));
}

function downloadTextFile(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n;]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function exportCsv() {
  const rows = getAttendanceRowsForExport();
  if (!rows.length) {
    showFeedback("Aucune presence a exporter pour ce centre.", "warning");
    return;
  }

  const headers = [
    "class_id",
    "class_name",
    "church_name",
    "instructor_name",
    "lesson_id",
    "lesson_title",
    "session_date",
    "student_name",
    "subgroup",
    "status"
  ];

  const lines = [
    headers.join(";"),
    ...rows.map((row) => headers.map((key) => csvEscape(row[key])).join(";"))
  ];

  const selectedClassId = getSelectedClassIdForExport();
  const suffix = selectedClassId === "all" ? "all-centres" : selectedClassId;
  const fileName = `mission-presences-${suffix}-${new Date().toISOString().slice(0, 10)}.csv`;
  downloadTextFile(lines.join("\n"), fileName, "text/csv;charset=utf-8;");
  showFeedback("Export CSV genere.", "success");
}

function exportPdf() {
  const rows = getAttendanceRowsForExport();
  if (!rows.length) {
    showFeedback("Aucune presence a exporter pour ce centre.", "warning");
    return;
  }

  const selectedClassId = getSelectedClassIdForExport();
  const selectedClass = missionState.classes.find((item) => String(item.id) === selectedClassId);
  const scopeLabel = selectedClass ? `${selectedClass.name} - ${selectedClass.church_name || "Centre"}` : "Tous les centres missionnaires";
  const generatedAt = new Date().toLocaleString("fr-FR");

  const htmlRows = rows
    .map(
      (row) => `
      <tr>
        <td>${row.class_name}</td>
        <td>${row.lesson_title || "-"}</td>
        <td>${row.session_date || "-"}</td>
        <td>${row.student_name || "-"}</td>
        <td>${row.subgroup || "-"}</td>
        <td>${row.status || "-"}</td>
      </tr>`
    )
    .join("");

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    showFeedback("Impossible d'ouvrir la fenetre d'impression PDF.", "error");
    return;
  }

  printWindow.document.write(`
    <html>
      <head>
        <title>Export PDF presences missionnaires</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; color: #1f2937; }
          h1 { margin: 0 0 6px; font-size: 20px; }
          p { margin: 0 0 10px; font-size: 12px; color: #4b5563; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
          th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; }
          th { background: #f3f4f6; }
        </style>
      </head>
      <body>
        <h1>Presences missionnaires</h1>
        <p><strong>Centre:</strong> ${scopeLabel}</p>
        <p><strong>Genere le:</strong> ${generatedAt}</p>
        <p><strong>Total lignes:</strong> ${rows.length}</p>
        <table>
          <thead>
            <tr>
              <th>Classe</th>
              <th>Lecon</th>
              <th>Date</th>
              <th>Etudiant</th>
              <th>Sous-groupe</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>${htmlRows}</tbody>
        </table>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  showFeedback("Export PDF pret (boite d'impression ouverte).", "success");
}

function renderLessonList() {
  const container = document.getElementById("mission-lesson-list");
  if (!container) return;

  const search = normalizeText(document.getElementById("mission-lesson-search")?.value || "");
  const selectedClass = String(document.getElementById("mission-class-filter")?.value || "all");

  const lessons = buildLessonLibrary().filter((lesson) => {
    if (selectedClass !== "all" && String(lesson.classId) !== selectedClass) return false;
    if (!search) return true;
    return normalizeText([lesson.title, lesson.className, lesson.date, lesson.instructorName].join(" ")).includes(search);
  });

  if (!lessons.length) {
    container.innerHTML = `<div class="empty-state">Aucune lecon missionnaire pour ce filtre.</div>`;
    return;
  }

  container.innerHTML = lessons.map((lesson) => {
    const selected = missionState.selectedLesson?.id === lesson.id;
    return `
      <article class="academy-lesson-item${selected ? " is-selected" : ""}">
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
        </div>
      </article>
    `;
  }).join("");

  container.querySelectorAll("[data-lesson-load]").forEach((button) => {
    button.addEventListener("click", () => {
      const lesson = buildLessonLibrary().find((item) => item.id === button.dataset.lessonLoad);
      if (!lesson) return;
      missionState.selectedLesson = lesson;
      const textarea = document.getElementById("mission-entry-text");
      const dateInput = document.getElementById("mission-lesson-date");
      const replaceInput = document.getElementById("mission-replace-existing");
      if (textarea) textarea.value = buildLessonTemplate(lesson, missionState.attendance);
      if (dateInput) dateInput.value = lesson.date || "";
      if (replaceInput) replaceInput.checked = true;
      const classFilter = document.getElementById("mission-class-filter");
      if (classFilter) classFilter.value = String(lesson.classId);
      renderLessonList();
      updateButtons();
      showFeedback(`Lecon chargee: ${lesson.title}`, "success");
    });
  });
}

function populateClassFilter(prefillClassId = "") {
  const classFilter = document.getElementById("mission-class-filter");
  if (!classFilter) return;
  classFilter.innerHTML = [
    `<option value="all">Toutes les classes missionnaires</option>`,
    ...missionState.classes.map((item) => `<option value="${item.id}">${item.name}</option>`)
  ].join("");

  const hasPrefill = missionState.classes.some((item) => String(item.id) === String(prefillClassId));
  classFilter.value = hasPrefill ? String(prefillClassId) : "all";
}

function getPayloadForSave() {
  const classFilter = document.getElementById("mission-class-filter");
  const selectedClass = missionState.classes.find((item) => String(item.id) === String(classFilter?.value || ""));
  const lessonDate = document.getElementById("mission-lesson-date")?.value || "";
  const rawText = document.getElementById("mission-entry-text")?.value || "";
  const replaceExisting = Boolean(document.getElementById("mission-replace-existing")?.checked);

  return {
    rawText,
    lessonDate,
    replaceExisting,
    deleteExisting: false,
    lessonId: missionState.selectedLesson?.id || "",
    classId: selectedClass?.id || missionState.selectedLesson?.classId || "",
    classCode: selectedClass?.name || missionState.selectedLesson?.className || "",
    lessonTitle: missionState.selectedLesson?.title || "",
    teacherName: selectedClass?.instructor_name || missionState.selectedLesson?.instructorName || ""
  };
}

async function loadData() {
  const response = await fetch(`/api/academy?ts=${Date.now()}`, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || "Impossible de charger les donnees missionnaires.");
  }

  missionState.classes = (payload.classes || []).filter(isMissionCentre);
  const missionClassIds = new Set(missionState.classes.map((item) => String(item.id)));
  missionState.attendance = (payload.attendance || []).filter((row) => missionClassIds.has(String(row.class_id || "")));
  const label = document.getElementById("mission-refresh-label");
  if (label) label.textContent = `${missionState.classes.length} classes missionnaires`;
}

function attachHandlers() {
  document.querySelectorAll(".nav-item[data-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.getElementById(button.dataset.target);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  document.getElementById("mission-lesson-search")?.addEventListener("input", renderLessonList);

  document.getElementById("mission-class-filter")?.addEventListener("change", () => {
    missionState.selectedClassId = String(document.getElementById("mission-class-filter")?.value || "");
    const selectedClass = missionState.classes.find((item) => String(item.id) === missionState.selectedClassId);
    const textarea = document.getElementById("mission-entry-text");
    if (selectedClass && textarea && !String(textarea.value || "").trim()) {
      textarea.value = buildDraftForClass(selectedClass);
    }
    renderLessonList();
  });

  document.getElementById("mission-clear")?.addEventListener("click", () => {
    missionState.selectedLesson = null;
    const textarea = document.getElementById("mission-entry-text");
    const dateInput = document.getElementById("mission-lesson-date");
    const replaceInput = document.getElementById("mission-replace-existing");
    if (textarea) textarea.value = "";
    if (dateInput) dateInput.value = "";
    if (replaceInput) replaceInput.checked = false;
    updateButtons();
    renderLessonList();
  });

  document.getElementById("mission-refresh")?.addEventListener("click", async () => {
    try {
      await loadData();
      renderLessonList();
      showFeedback("Donnees missionnaires actualisees.", "success");
    } catch (error) {
      showFeedback(error.message, "error");
    }
  });

  document.getElementById("mission-export-csv")?.addEventListener("click", exportCsv);
  document.getElementById("mission-export-pdf")?.addEventListener("click", exportPdf);

  document.getElementById("mission-save")?.addEventListener("click", async () => {
    const payload = getPayloadForSave();
    if (!String(payload.rawText || "").trim()) {
      showFeedback("Le bloc de presence est requis.", "warning");
      return;
    }

    missionState.isSaving = true;
    updateButtons();
    try {
      const response = await fetch("/api/academy/record-lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) {
        const issues = data.issues?.length ? ` ${data.issues.join(" ")}` : "";
        throw new Error((data.error || "Impossible d'enregistrer la lecon.") + issues);
      }

      missionState.selectedLesson = null;
      await loadData();
      renderLessonList();
      showFeedback(`Lecon enregistree pour ${data.result.classCode} (${data.result.lessonDate}).`, "success");
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      missionState.isSaving = false;
      updateButtons();
    }
  });

  document.getElementById("mission-delete")?.addEventListener("click", async () => {
    if (!missionState.selectedLesson) {
      showFeedback("Charge d'abord une lecon a supprimer.", "warning");
      return;
    }

    const confirmed = window.confirm(`Supprimer la lecon \"${missionState.selectedLesson.title}\" (${missionState.selectedLesson.date}) ?`);
    if (!confirmed) return;

    missionState.isSaving = true;
    updateButtons();
    try {
      const payload = {
        deleteExisting: true,
        lessonId: missionState.selectedLesson.id,
        classId: missionState.selectedLesson.classId,
        classCode: missionState.selectedLesson.className,
        lessonTitle: missionState.selectedLesson.title,
        lessonDate: missionState.selectedLesson.date,
        rawText: ""
      };

      const response = await fetch("/api/academy/record-lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Impossible de supprimer la lecon.");
      }

      missionState.selectedLesson = null;
      await loadData();
      renderLessonList();
      showFeedback("Lecon supprimee.", "success");
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      missionState.isSaving = false;
      updateButtons();
    }
  });
}

async function boot() {
  await window.AppAuth.requireAuth();
  if (window.AppAuth?.canManageUsers?.()) {
    document.querySelectorAll("[data-manage-users-link]").forEach((el) => {
      el.hidden = false;
    });
  }

  const params = new URLSearchParams(window.location.search);
  const prefillClass = String(params.get("class") || "").trim();

  attachHandlers();
  await loadData();
  populateClassFilter(prefillClass);

  const selectedClass = missionState.classes.find((item) => String(item.id) === String(prefillClass));
  const textarea = document.getElementById("mission-entry-text");
  if (selectedClass && textarea) {
    textarea.value = buildDraftForClass(selectedClass);
  }

  renderLessonList();
  updateButtons();
}

document.addEventListener("DOMContentLoaded", () => {
  boot().catch((error) => showFeedback(error.message, "error"));
});
