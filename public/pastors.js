const pastorState = {
  pastors: [],
  academyClassOptions: [],
  filtered: [],
  selectedId: "",
  source: "sheets",
  memberOptions: [],
  isLoading: false,
  filters: {
    search: "",
    review: "all",
    title: "all",
    member: "all"
  }
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
  }, 4000);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getSelectedPastor() {
  return pastorState.pastors.find((pastor) => pastor.id === pastorState.selectedId) || null;
}

function buildCanonicalSuggestion(firstName, lastName) {
  return [String(firstName || "").trim(), String(lastName || "").trim()].filter(Boolean).join(" ").trim();
}

function updateRefreshButton() {
  const refreshButton = document.getElementById("refresh-pastors");
  if (!refreshButton) {
    return;
  }

  refreshButton.disabled = pastorState.isLoading;
  refreshButton.textContent = pastorState.isLoading ? "Actualisation..." : "Actualiser";
}

function applyFilters() {
  const search = normalizeText(pastorState.filters.search);
  const review = pastorState.filters.review;
  const title = normalizeText(pastorState.filters.title);
  const member = normalizeText(pastorState.filters.member);

  pastorState.filtered = pastorState.pastors.filter((pastor) => {
    const haystack = normalizeText(
      [
        pastor.name,
        pastor.first_name,
        pastor.last_name,
        pastor.title,
        pastor.aliases,
        pastor.church_name,
        pastor.city,
        pastor.source_variants,
        pastor.notes
      ].join(" ")
    );
    const pastorMembers = Array.isArray(pastor.member_names) ? pastor.member_names.map(normalizeText) : [];

    const searchOk = !search || haystack.includes(search);
    const reviewOk =
      review === "all" ||
      (review === "review" && String(pastor.needs_review).toLowerCase() === "true") ||
      (review === "clean" && String(pastor.needs_review).toLowerCase() !== "true");
    const titleOk = title === "all" || normalizeText(pastor.title) === title;
    const memberOk = member === "all" || pastorMembers.includes(member);
    return searchOk && reviewOk && titleOk && memberOk;
  });
}

function renderPastorList() {
  const container = document.getElementById("pastor-list");
  const summary = document.getElementById("review-summary");
  const count = document.getElementById("pastors-count");

  summary.textContent = `${pastorState.filtered.length} fiches visibles`;
  count.textContent = `${pastorState.pastors.length} pasteurs detectes`;

  if (!pastorState.filtered.length) {
    container.innerHTML = `<div class="empty-state">Aucune fiche ne correspond aux filtres actuels.</div>`;
    return;
  }

  container.innerHTML = pastorState.filtered
    .map((pastor) => {
      const isReview = String(pastor.needs_review).toLowerCase() === "true";
      const isActive = pastor.id === pastorState.selectedId;
      const summitStatus = pastor.gmcs_summit_status || "";
      const summitBadge = summitStatus
        ? `<span class="status-pill status-pill-summit-${summitStatus}" title="GMCS Summit">${{ verbal: "Summit: verbal", inscrit: "Summit: inscrit", paiement: "Summit: payé" }[summitStatus] || summitStatus}</span>`
        : "";
      const levelBadge = pastor.pastor_level
        ? `<span class="status-pill" title="${pastor.niveau || "Pastor Center"}" style="background:rgba(30,90,200,0.12);color:#1a4a8a">${pastor.pastor_level}${pastor.porte_les_fruits ? " ✅" : ""}</span>`
        : "";
      return `
        <button class="pastor-row ${isActive ? "is-active" : ""}" type="button" data-pastor-id="${pastor.id}">
          <div class="pastor-row-main">
            <strong>${pastor.name || "Nom a corriger"}</strong>
            <span>${pastor.title || "Sans titre"}${pastor.city ? ` - ${pastor.city}` : ""}</span>
          </div>
          <div class="pastor-row-side">
            <span>${pastor.meeting_count || 0} rencontres</span>
            ${levelBadge}
            ${summitBadge}
            <span class="status-pill ${isReview ? "status-pill-warning" : ""}">${isReview ? "A revoir" : "Valide"}</span>
          </div>
        </button>
      `;
    })
    .join("");

  container.querySelectorAll("[data-pastor-id]").forEach((button) => {
    button.addEventListener("click", () => {
      pastorState.selectedId = button.dataset.pastorId;
      renderPastorList();
      renderEditor();
    });
  });
}

function renderEditor() {
  const pastor = getSelectedPastor();
  const title = document.getElementById("editor-title");
  const status = document.getElementById("editor-status");

  if (!pastor) {
    title.textContent = "Selectionner une fiche";
    status.textContent = "Aucune selection";
    document.getElementById("pastor-form").reset();
    populateAcademyClassOptions("");
    document.getElementById("pastor-id").value = "";
    document.getElementById("pastor-source-variants").textContent = "-";
    document.getElementById("pastor-history").textContent = "-";
    return;
  }

  title.textContent = pastor.name || "Fiche a corriger";
  status.textContent = String(pastor.needs_review).toLowerCase() === "true" ? "A revoir" : "Valide";
  document.getElementById("pastor-id").value = pastor.id || "";
  document.getElementById("pastor-name").value =
    buildCanonicalSuggestion(pastor.first_name, pastor.last_name) || pastor.name || "";
  document.getElementById("pastor-first-name").value = pastor.first_name || "";
  document.getElementById("pastor-last-name").value = pastor.last_name || "";
  document.getElementById("pastor-title").value = pastor.title || "";
  document.getElementById("pastor-church").value = pastor.church_name || "";
  document.getElementById("pastor-city").value = pastor.city || "";
  document.getElementById("pastor-phone").value = pastor.phone || "";
  document.getElementById("pastor-email").value = pastor.email || "";
  const isLinked = Boolean(pastor.student_id);
  const classSelect   = document.getElementById("pastor-class");
  const classReadonly = document.getElementById("pastor-class-readonly");
  if (isLinked) {
    classSelect.hidden   = true;
    classReadonly.hidden = false;
    classReadonly.value  = pastor.academy_class || "";
  } else {
    classSelect.hidden   = false;
    classReadonly.hidden = true;
    populateAcademyClassOptions(pastor.academy_class || "");
  }
  document.getElementById("pastor-cell-number").value = pastor.cell_number || "";
  document.getElementById("pastor-current-mission").value = pastor.current_mission || "";
  document.getElementById("pastor-aliases").value = pastor.aliases || "";
  document.getElementById("pastor-notes").value = pastor.notes || "";
  document.getElementById("pastor-summit-status").value = pastor.gmcs_summit_status || "";
  document.getElementById("pastor-summit-note").value = pastor.gmcs_summit_note || "";
  document.getElementById("pastor-needs-review").checked = String(pastor.needs_review).toLowerCase() === "true";
  document.getElementById("pastor-niveau").value = pastor.niveau || "";
  document.getElementById("pastor-level").value = pastor.pastor_level || "";
  document.getElementById("pastor-porte-les-fruits").checked = Boolean(pastor.porte_les_fruits);
  document.getElementById("pastor-center-num").textContent = pastor.pastor_center_num || "-";
  document.getElementById("pastor-source-variants").textContent = pastor.source_variants || "-";
  document.getElementById("pastor-history").textContent =
    `${pastor.meeting_count || 0} rencontres - ${pastor.first_meeting_date || "-"} -> ${pastor.last_meeting_date || "-"}`;
}

function populateTitleFilter() {
  const titleFilter = document.getElementById("title-filter");
  const titles = Array.from(new Set(pastorState.pastors.map((pastor) => pastor.title).filter(Boolean))).sort();
  titleFilter.innerHTML = [
    `<option value="all">Tous</option>`,
    ...titles.map((title) => `<option value="${title}">${title}</option>`)
  ].join("");
  titleFilter.value = pastorState.filters.title;
}

function populateMemberFilter() {
  const memberFilter = document.getElementById("member-filter");
  if (!memberFilter) {
    return;
  }

  memberFilter.innerHTML = [
    `<option value="all">Tous</option>`,
    ...pastorState.memberOptions.map((memberName) => `<option value="${memberName}">${memberName}</option>`)
  ].join("");
  memberFilter.value = pastorState.filters.member;
}

function populateAcademyClassOptions(selectedValue = "") {
  const classSelect = document.getElementById("pastor-class");
  if (!classSelect) {
    return;
  }

  const normalizedSelected = String(selectedValue || "").trim();
  const options = [
    `<option value="">-- Choisir une classe --</option>`,
    ...pastorState.academyClassOptions.map((className) => `<option value="${className}">${className}</option>`)
  ];

  if (
    normalizedSelected &&
    !pastorState.academyClassOptions.some((className) => String(className).trim() === normalizedSelected)
  ) {
    options.push(`<option value="${normalizedSelected}">${normalizedSelected} (hors liste)</option>`);
  }

  classSelect.innerHTML = options.join("");
  classSelect.value = normalizedSelected;
}

async function loadPastors() {
  pastorState.isLoading = true;
  updateRefreshButton();

  try {
    const response = await fetch(`/api/pastors?ts=${Date.now()}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "Impossible de charger les pasteurs.");
    }

    let academyClassOptions = [];
    try {
      const academyResponse = await fetch(`/api/academy/students?ts=${Date.now()}`, { cache: "no-store" });
      if (academyResponse.ok) {
        const academyPayload = await academyResponse.json();
        academyClassOptions = (academyPayload.classOptions || [])
          .map((item) => String(item.name || "").trim())
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, "fr"));
      }
    } catch {
      academyClassOptions = [];
    }

    pastorState.pastors = payload.pastors || [];
    pastorState.source = payload.source || "sheets";
    pastorState.memberOptions = payload.memberOptions || [];
    pastorState.academyClassOptions = academyClassOptions;
    if (!pastorState.selectedId && pastorState.pastors.length) {
      pastorState.selectedId = pastorState.pastors[0].id;
    }
    if (!pastorState.pastors.some((pastor) => pastor.id === pastorState.selectedId)) {
      pastorState.selectedId = pastorState.pastors[0]?.id || "";
    }

    populateTitleFilter();
    populateMemberFilter();
  populateAcademyClassOptions();
    applyFilters();
    renderPastorList();
    renderEditor();
  } finally {
    pastorState.isLoading = false;
    updateRefreshButton();
  }
}

async function savePastor(event) {
  event.preventDefault();
  const pastorId = document.getElementById("pastor-id").value;
  if (!pastorId) {
    showFeedback("Selectionne d'abord une fiche.", "error");
    return;
  }

  const existingName = document.getElementById("pastor-name").value;
  const canonicalName = buildCanonicalSuggestion(
    document.getElementById("pastor-first-name").value,
    document.getElementById("pastor-last-name").value
  ) || existingName;
  document.getElementById("pastor-name").value = canonicalName;

  const current = getSelectedPastor();
  const payload = {
    id: pastorId,
    name: canonicalName,
    first_name: document.getElementById("pastor-first-name").value,
    last_name: document.getElementById("pastor-last-name").value,
    title: document.getElementById("pastor-title").value,
    church_name: document.getElementById("pastor-church").value,
    city: document.getElementById("pastor-city").value,
    phone: document.getElementById("pastor-phone").value,
    email: document.getElementById("pastor-email").value,
    // When the pastor is linked to an academy student, class comes from the academy — never overwrite it.
    academy_class: current?.student_id ? (current.academy_class || "") : document.getElementById("pastor-class").value,
    cell_number: document.getElementById("pastor-cell-number").value,
    current_mission: document.getElementById("pastor-current-mission").value,
    aliases: document.getElementById("pastor-aliases").value,
    notes: document.getElementById("pastor-notes").value,
    gmcs_summit_status: document.getElementById("pastor-summit-status").value,
    gmcs_summit_note: document.getElementById("pastor-summit-note").value,
    needs_review: document.getElementById("pastor-needs-review").checked,
    niveau: document.getElementById("pastor-niveau").value,
    pastor_level: document.getElementById("pastor-level").value,
    porte_les_fruits: document.getElementById("pastor-porte-les-fruits").checked,
    // Preserve read-only fields that are not in the form
    pastor_center_num: current?.pastor_center_num ?? 0,
    meeting_count: current?.meeting_count ?? "0",
    first_meeting_date: current?.first_meeting_date ?? "",
    last_meeting_date: current?.last_meeting_date ?? "",
    source: current?.source ?? "",
    source_variants: current?.source_variants ?? ""
  };

  const response = await fetch("/api/pastors/update", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok || result.ok === false) {
    throw new Error(result.error || "Impossible d'enregistrer la fiche.");
  }

  showFeedback("Fiche pasteur enregistree.", "success");
  await loadPastors();
}

function attachFilters() {
  document.getElementById("pastor-search")?.addEventListener("input", (event) => {
    pastorState.filters.search = event.target.value;
    applyFilters();
    renderPastorList();
  });

  document.getElementById("review-filter")?.addEventListener("change", (event) => {
    pastorState.filters.review = event.target.value;
    applyFilters();
    renderPastorList();
  });

  document.getElementById("title-filter")?.addEventListener("change", (event) => {
    pastorState.filters.title = event.target.value;
    applyFilters();
    renderPastorList();
  });

  document.getElementById("member-filter")?.addEventListener("change", (event) => {
    pastorState.filters.member = event.target.value;
    applyFilters();
    renderPastorList();
  });

  document.getElementById("reset-pastor-filters")?.addEventListener("click", () => {
    pastorState.filters = { search: "", review: "all", title: "all", member: "all" };
    document.getElementById("pastor-search").value = "";
    document.getElementById("review-filter").value = "all";
    populateTitleFilter();
    populateMemberFilter();
    applyFilters();
    renderPastorList();
  });

  document.getElementById("refresh-pastors")?.addEventListener("click", async () => {
    try {
      await loadPastors();
      showFeedback("Liste pasteurs actualisee.", "success");
    } catch (error) {
      showFeedback(error.message, "error");
    }
  });

  document.getElementById("pastor-form")?.addEventListener("submit", (event) => {
    savePastor(event).catch((error) => showFeedback(error.message, "error"));
  });

  const canonicalInput = document.getElementById("pastor-name");
  const firstNameInput = document.getElementById("pastor-first-name");
  const lastNameInput = document.getElementById("pastor-last-name");

  function syncCanonicalFromSplitName() {
    const suggested = buildCanonicalSuggestion(firstNameInput?.value, lastNameInput?.value);
    if (canonicalInput) {
      canonicalInput.value = suggested;
    }
  }

  firstNameInput?.addEventListener("input", syncCanonicalFromSplitName);
  lastNameInput?.addEventListener("input", syncCanonicalFromSplitName);
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

function applySearchPrefillFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const searchValue = String(params.get("search") || "").trim();
  if (!searchValue) {
    return;
  }

  pastorState.filters.search = searchValue;
  const searchInput = document.getElementById("pastor-search");
  if (searchInput) {
    searchInput.value = searchValue;
  }

  applyFilters();
  if (pastorState.filtered.length) {
    pastorState.selectedId = pastorState.filtered[0].id;
  }
  renderPastorList();
  renderEditor();
}

async function boot() {
  await window.AppAuth.requireAuth();
  attachNavigationHandlers();
  attachFilters();
  updateRefreshButton();
  await loadPastors();
  applySearchPrefillFromUrl();
}

boot().catch((error) => showFeedback(error.message, "error"));
