const plState = {
  suggestions: [],
  filter: "pending"
};

function showFeedback(message, tone = "info") {
  const el = document.getElementById("app-feedback");
  if (!el) return;
  el.textContent = message;
  el.className = `app-feedback is-${tone}`;
  el.hidden = false;
  clearTimeout(showFeedback._t);
  showFeedback._t = setTimeout(() => { el.hidden = true; }, 4500);
}

function confidenceBadge(confidence) {
  const cls = confidence === "exact" ? "badge-exact" : "badge-prefix";
  const label = confidence === "exact" ? "Exacte" : "Approchee";
  return `<span class="suggestion-badge ${cls}">${label}</span>`;
}

function statusBadge(status) {
  const map = { pending: ["badge-pending", "En attente"], approved: ["badge-approved", "Approuve"], rejected: ["badge-rejected", "Rejete"] };
  const [cls, label] = map[status] || ["badge-pending", status];
  return `<span class="suggestion-badge ${cls}">${label}</span>`;
}

function updateSummaryMetrics() {
  const total = plState.suggestions.length;
  const pending = plState.suggestions.filter((item) => item.status === "pending").length;
  const approved = plState.suggestions.filter((item) => item.status === "approved").length;
  const rejected = plState.suggestions.filter((item) => item.status === "rejected").length;

  const metricTotal = document.getElementById("metric-total");
  const metricPending = document.getElementById("metric-pending");
  const metricApproved = document.getElementById("metric-approved");
  const metricRejected = document.getElementById("metric-rejected");
  const heroActiveFilter = document.getElementById("hero-active-filter");

  if (metricTotal) metricTotal.textContent = String(total);
  if (metricPending) metricPending.textContent = String(pending);
  if (metricApproved) metricApproved.textContent = String(approved);
  if (metricRejected) metricRejected.textContent = String(rejected);

  if (heroActiveFilter) {
    const labels = {
      pending: "En attente",
      approved: "Approuvees",
      rejected: "Rejetees",
      "": "Toutes"
    };
    heroActiveFilter.textContent = labels[plState.filter] || "En attente";
  }
}

function renderSuggestions() {
  const list = document.getElementById("suggestions-list");
  const count = document.getElementById("suggestions-count");
  const visible = plState.filter
    ? plState.suggestions.filter((s) => s.status === plState.filter)
    : plState.suggestions;

  updateSummaryMetrics();

  count.textContent = `${visible.length} suggestion${visible.length !== 1 ? "s" : ""} visibles`;

  if (!visible.length) {
    list.innerHTML = `<div class="empty-state">Aucune suggestion${plState.filter ? " dans cette categorie" : ""}.</div>`;
    return;
  }

  list.innerHTML = visible.map((s) => {
    const isPending = s.status === "pending";
    const cardClass = s.status !== "pending" ? `is-${s.status}` : "";
    const actions = isPending
      ? `<div class="suggestion-actions">
           <button class="btn-approve" data-id="${s.id}" data-action="approve">Approuver</button>
           <button class="btn-reject"  data-id="${s.id}" data-action="reject">Rejeter</button>
         </div>`
      : `<div class="suggestion-status-wrap"><span class="suggestion-id">Decision enregistree</span></div>`;

    return `
      <article class="suggestion-card ${cardClass}">
        <div class="suggestion-fiche">
          <span class="suggestion-fiche-label">Fiche pasteur</span>
          <strong class="suggestion-name">${s.pastor_name || "-"}</strong>
          <div class="suggestion-meta">
            ${confidenceBadge(s.confidence)}
            <span class="suggestion-id">${s.pastor_id}</span>
          </div>
        </div>
        <div class="connector"><span class="connector-pill">↔</span></div>
        <div class="suggestion-fiche">
          <span class="suggestion-fiche-label">Fiche etudiant</span>
          <strong class="suggestion-name">${s.student_name || "-"}</strong>
          <div class="suggestion-meta">
            ${statusBadge(s.status)}
            <span class="suggestion-id">${s.student_id}</span>
          </div>
        </div>
        ${actions}
      </article>`;
  }).join("");

  list.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => handleDecision(btn.dataset.id, btn.dataset.action));
  });
}

async function handleDecision(suggestionId, action) {
  const card = document.querySelector(`[data-id="${suggestionId}"]`)?.closest(".suggestion-card");
  if (card) card.style.opacity = "0.5";
  try {
    const res = await fetch(`/api/personality-links/${encodeURIComponent(suggestionId)}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.error || "Erreur serveur");
    const label = action === "approve" ? "Lien confirme." : "Suggestion rejetee.";
    showFeedback(label, action === "approve" ? "success" : "info");
    const suggestion = plState.suggestions.find((s) => s.id === suggestionId);
    if (suggestion) suggestion.status = action === "approve" ? "approved" : "rejected";
    renderSuggestions();
  } catch (err) {
    if (card) card.style.opacity = "1";
    showFeedback(err.message, "error");
  }
}

async function loadSuggestions() {
  try {
    const res = await fetch(`/api/personality-links?ts=${Date.now()}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.error || "Impossible de charger les suggestions.");
    plState.suggestions = data.suggestions || [];
    renderSuggestions();
  } catch (err) {
    showFeedback(err.message, "error");
    document.getElementById("suggestions-list").innerHTML = `<div class="empty-state">${err.message}</div>`;
  }
}

async function runJob() {
  const btn = document.getElementById("btn-run-job");
  btn.disabled = true;
  btn.textContent = "Detection en cours...";
  try {
    const res = await fetch("/api/personality-links/run-job", { method: "POST" });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.error || "Erreur serveur");
    showFeedback(`Detection terminee : ${data.suggested} nouvelle(s) suggestion(s).`, "success");
    await loadSuggestions();
  } catch (err) {
    showFeedback(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Lancer la detection";
  }
}

function attachFilters() {
  document.getElementById("status-filters").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (!btn) return;
    plState.filter = btn.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    renderSuggestions();
  });

  document.getElementById("btn-run-job").addEventListener("click", () => {
    runJob().catch((err) => showFeedback(err.message, "error"));
  });
}

async function boot() {
  await window.AppAuth.requireAuth();
  attachFilters();
  await loadSuggestions();
}

boot().catch((err) => showFeedback(err.message, "error"));
