const pastorState = {
  pastors: [],
  filtered: [],
  selectedId: "",
  canonicalTouchedManually: false,
  source: "sheets",
  filters: {
    search: "",
    review: "all",
    title: "all"
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

function applyFilters() {
  const search = normalizeText(pastorState.filters.search);
  const review = pastorState.filters.review;
  const title = normalizeText(pastorState.filters.title);

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

    const searchOk = !search || haystack.includes(search);
    const reviewOk =
      review === "all" ||
      (review === "review" && String(pastor.needs_review).toLowerCase() === "true") ||
      (review === "clean" && String(pastor.needs_review).toLowerCase() !== "true");
    const titleOk = title === "all" || normalizeText(pastor.title) === title;
    return searchOk && reviewOk && titleOk;
  });
}

function renderPastorList() {
  const container = document.getElementById("pastor-list");
  const summary = document.getElementById("review-summary");
  const count = document.getElementById("pastors-count");

  summary.textContent = `${pastorState.filtered.length} fiches visibles`;
  count.textContent = `${pastorState.pastors.length} pasteurs • ${pastorState.source}`;

  if (!pastorState.filtered.length) {
    container.innerHTML = `<div class="empty-state">Aucune fiche ne correspond aux filtres actuels.</div>`;
    return;
  }

  container.innerHTML = pastorState.filtered
    .map((pastor) => {
      const isReview = String(pastor.needs_review).toLowerCase() === "true";
      const isActive = pastor.id === pastorState.selectedId;
      return `
        <button class="pastor-row ${isActive ? "is-active" : ""}" type="button" data-pastor-id="${pastor.id}">
          <div class="pastor-row-main">
            <strong>${pastor.name || "Nom a corriger"}</strong>
            <span>${pastor.title || "Sans titre"}${pastor.city ? ` • ${pastor.city}` : ""}</span>
          </div>
          <div class="pastor-row-side">
            <span>${pastor.meeting_count || 0} rencontres</span>
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
    document.getElementById("pastor-id").value = "";
    document.getElementById("pastor-source-variants").textContent = "-";
    document.getElementById("pastor-history").textContent = "-";
    return;
  }

  title.textContent = pastor.name || "Fiche a corriger";
  status.textContent = String(pastor.needs_review).toLowerCase() === "true" ? "A revoir" : "Valide";
  pastorState.canonicalTouchedManually = false;
  document.getElementById("pastor-id").value = pastor.id || "";
  document.getElementById("pastor-name").value = pastor.name || "";
  document.getElementById("pastor-first-name").value = pastor.first_name || "";
  document.getElementById("pastor-last-name").value = pastor.last_name || "";
  document.getElementById("pastor-title").value = pastor.title || "";
  document.getElementById("pastor-church").value = pastor.church_name || "";
  document.getElementById("pastor-city").value = pastor.city || "";
  document.getElementById("pastor-phone").value = pastor.phone || "";
  document.getElementById("pastor-email").value = pastor.email || "";
  document.getElementById("pastor-aliases").value = pastor.aliases || "";
  document.getElementById("pastor-notes").value = pastor.notes || "";
  document.getElementById("pastor-needs-review").checked = String(pastor.needs_review).toLowerCase() === "true";
  document.getElementById("pastor-source-variants").textContent = pastor.source_variants || "-";
  document.getElementById("pastor-history").textContent =
    `${pastor.meeting_count || 0} rencontres • ${pastor.first_meeting_date || "-"} -> ${pastor.last_meeting_date || "-"}`;
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

async function loadPastors() {
  const response = await fetch("/api/pastors");
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || "Impossible de charger les pasteurs.");
  }

  pastorState.pastors = payload.pastors || [];
  pastorState.source = payload.source || "sheets";
  if (!pastorState.selectedId && pastorState.pastors.length) {
    pastorState.selectedId = pastorState.pastors[0].id;
  }
  if (!pastorState.pastors.some((pastor) => pastor.id === pastorState.selectedId)) {
    pastorState.selectedId = pastorState.pastors[0]?.id || "";
  }

  populateTitleFilter();
  applyFilters();
  renderPastorList();
  renderEditor();
}

async function savePastor(event) {
  event.preventDefault();
  const pastorId = document.getElementById("pastor-id").value;
  if (!pastorId) {
    showFeedback("Selectionne d'abord une fiche.", "error");
    return;
  }

  const payload = {
    id: pastorId,
    name: document.getElementById("pastor-name").value,
    first_name: document.getElementById("pastor-first-name").value,
    last_name: document.getElementById("pastor-last-name").value,
    title: document.getElementById("pastor-title").value,
    church_name: document.getElementById("pastor-church").value,
    city: document.getElementById("pastor-city").value,
    phone: document.getElementById("pastor-phone").value,
    email: document.getElementById("pastor-email").value,
    aliases: document.getElementById("pastor-aliases").value,
    notes: document.getElementById("pastor-notes").value,
    needs_review: document.getElementById("pastor-needs-review").checked
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

  document.getElementById("reset-pastor-filters")?.addEventListener("click", () => {
    pastorState.filters = { search: "", review: "all", title: "all" };
    document.getElementById("pastor-search").value = "";
    document.getElementById("review-filter").value = "all";
    populateTitleFilter();
    applyFilters();
    renderPastorList();
  });

  document.getElementById("refresh-pastors")?.addEventListener("click", () => {
    loadPastors().catch((error) => showFeedback(error.message, "error"));
  });

  document.getElementById("pastor-form")?.addEventListener("submit", (event) => {
    savePastor(event).catch((error) => showFeedback(error.message, "error"));
  });

  const canonicalInput = document.getElementById("pastor-name");
  const firstNameInput = document.getElementById("pastor-first-name");
  const lastNameInput = document.getElementById("pastor-last-name");

  canonicalInput?.addEventListener("input", () => {
    const suggested = buildCanonicalSuggestion(firstNameInput?.value, lastNameInput?.value);
    pastorState.canonicalTouchedManually = normalizeText(canonicalInput.value) !== normalizeText(suggested);
  });

  function syncCanonicalFromSplitName() {
    const suggested = buildCanonicalSuggestion(firstNameInput?.value, lastNameInput?.value);
    if (!canonicalInput) {
      return;
    }

    const current = String(canonicalInput.value || "").trim();
    const shouldReplace =
      !pastorState.canonicalTouchedManually ||
      !current ||
      normalizeText(current) === normalizeText(suggested);

    if (shouldReplace) {
      canonicalInput.value = suggested;
      pastorState.canonicalTouchedManually = false;
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

async function boot() {
  attachNavigationHandlers();
  attachFilters();
  await loadPastors();
}

boot().catch((error) => showFeedback(error.message, "error"));
