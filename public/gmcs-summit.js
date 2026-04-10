// ─────────────────────────────────────────────────────────────────────────────
// gmcs-summit.js — GMCS-EU Summit 2e Edition dashboard
// ─────────────────────────────────────────────────────────────────────────────

const summitState = {
  // All people (pastors + academy students) merged into one list
  // Each entry: { _type: "pastor"|"student", id, name, title, church_name, city,
  //               gmcs_summit_status, gmcs_summit_note, ...source fields }
  people: [],
  filtered: [],
  filter: "all",  // "all" | "verbal" | "inscrit" | "paiement"
  search: "",
  charts: {},
  chartGranularity: "monthly",
  chartMode: "cumulative"
};

const SUMMIT_LABELS = { verbal: "Accord verbal", inscrit: "Inscrit", paiement: "Paiement reçu" };
const SUMMIT_LEVELS = ["verbal", "inscrit", "paiement"];

// ─── Utilities ────────────────────────────────────────────────────────────────

function showFeedback(message, tone = "info") {
  const el = document.getElementById("app-feedback");
  if (!el) return;
  el.textContent = message;
  el.className = `app-feedback is-${tone}`;
  el.hidden = false;
  clearTimeout(showFeedback._t);
  showFeedback._t = setTimeout(() => { el.hidden = true; }, 4000);
}

function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function parseDateValue(value) {
  if (!value) return null;
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;
  const french = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!french) return null;
  const [, day, month, year] = french;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfWeek(date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function toBucketKey(date, granularity) {
  if (granularity === "weekly") {
    const monday = startOfWeek(date);
    return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthKey(key) {
  const date = parseDateValue(`${key}-01`);
  return date
    ? date.toLocaleDateString("fr-FR", { month: "short", year: "numeric" })
    : key;
}

function formatWeekKey(key) {
  const date = parseDateValue(key);
  return date
    ? `Sem. du ${date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`
    : key;
}

function getActivityDate(person) {
  if (person._type === "student") {
    return String(person.last_lesson_date || "").slice(0, 10);
  }
  return String(person.last_meeting_date || person.first_meeting_date || "").slice(0, 10);
}

function buildEvolutionSeries() {
  const byMonth = new Map();
  summitState.people.forEach((person) => {
    const status = String(person.gmcs_summit_status || "").trim();
    if (!SUMMIT_LEVELS.includes(status)) return;
    const rawDate = getActivityDate(person);
    const parsedDate = parseDateValue(rawDate);
    if (!parsedDate) return;
    const bucketKey = toBucketKey(parsedDate, summitState.chartGranularity);
    const current = byMonth.get(bucketKey) || { total: 0, verbal: 0, inscrit: 0, paiement: 0 };
    current.total += 1;
    current[status] += 1;
    byMonth.set(bucketKey, current);
  });

  const keys = Array.from(byMonth.keys()).sort((a, b) => a.localeCompare(b));
  const labels = keys.map((key) => (summitState.chartGranularity === "weekly" ? formatWeekKey(key) : formatMonthKey(key)));
  const seriesLevels = ["total", ...SUMMIT_LEVELS];
  const cumulative = { total: 0, verbal: 0, inscrit: 0, paiement: 0 };
  const seriesBuckets = { total: [], verbal: [], inscrit: [], paiement: [] };

  keys.forEach((key) => {
    const delta = byMonth.get(key);
    seriesLevels.forEach((level) => {
      const value = Number(delta[level] || 0);
      if (summitState.chartMode === "cumulative") {
        cumulative[level] += value;
        seriesBuckets[level].push(cumulative[level]);
      } else {
        seriesBuckets[level].push(value);
      }
    });
  });

  return {
    labels,
    series: [
      { name: "Total", data: seriesBuckets.total },
      { name: "Accord verbal", data: seriesBuckets.verbal },
      { name: "Inscrit", data: seriesBuckets.inscrit },
      { name: "Paiement recu", data: seriesBuckets.paiement }
    ]
  };
}

async function renderEvolutionChart() {
  const target = document.getElementById("summit-evolution-chart");
  if (!target) return;

  if (summitState.charts.evolution) {
    await summitState.charts.evolution.destroy();
    summitState.charts.evolution = null;
  }

  const chartData = buildEvolutionSeries();
  const caption = document.getElementById("summit-evolution-caption");
  if (caption) {
    caption.textContent = `Vue ${summitState.chartGranularity === "weekly" ? "hebdomadaire" : "mensuelle"} ${summitState.chartMode === "cumulative" ? "cumulée" : "non cumulée"}`;
  }
  if (!chartData.labels.length) {
    target.innerHTML = `<div class="summit-table-empty" style="padding:24px">Pas assez de dates d'activite pour tracer la courbe.</div>`;
    return;
  }

  if (typeof ApexCharts === "undefined") {
    target.innerHTML = `<div class="summit-table-empty" style="padding:24px">Module graphique indisponible.</div>`;
    return;
  }

  target.innerHTML = "";
  summitState.charts.evolution = new ApexCharts(target, {
    chart: {
      type: "line",
      height: 320,
      fontFamily: "Instrument Sans, sans-serif",
      toolbar: { show: false },
      zoom: { enabled: false }
    },
    series: chartData.series,
    stroke: { width: 3, curve: "smooth" },
    colors: ["#f5c32c", "#d97706", "#147964", "#1d4ed8"],
    xaxis: {
      categories: chartData.labels,
      labels: {
        style: { colors: "#5f7891", fontSize: "12px" }
      }
    },
    yaxis: {
      min: 0,
      forceNiceScale: true,
      labels: {
        style: { colors: "#5f7891", fontSize: "12px" }
      }
    },
    grid: {
      borderColor: "rgba(37, 137, 200, 0.12)",
      strokeDashArray: 4
    },
    legend: {
      position: "top",
      horizontalAlign: "right",
      labels: { colors: "#35556f" }
    },
    tooltip: {
      y: {
        formatter: (value) => `${value} personne${value > 1 ? "s" : ""}`
      }
    }
  });

  await summitState.charts.evolution.render();
}

function updateChartControlStates() {
  document.querySelectorAll("[data-chart-granularity]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.chartGranularity === summitState.chartGranularity);
  });
  document.querySelectorAll("[data-chart-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.chartMode === summitState.chartMode);
  });
}

// Derive origin tags for a person
function getPersonSources(person) {
  if (person._type === "student") {
    return ["academie"];
  }
  const sources = [];
  const meetings = Number(person.meeting_count || 0);
  if (meetings > 0) sources.push("mannam");
  if (String(person.academy_class || "").trim()) sources.push("academie");
  if (String(person.cell_number || "").trim()) sources.push("cellule");
  return sources;
}

// ─── Filter ───────────────────────────────────────────────────────────────────

function applyFilter() {
  const q = normalizeText(summitState.search);
  const level = summitState.filter;

  summitState.filtered = summitState.people
    .filter((p) => {
      const status = p.gmcs_summit_status || "";
      if (!status) return false; // only show flagged pastors
      if (level !== "all" && status !== level) return false;
      if (q) {
        const hay = normalizeText([p.name, p.title, p.church_name, p.city, p.class_name, p.gmcs_summit_note].join(" "));
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      // paiement > inscrit > verbal
      const order = { paiement: 0, inscrit: 1, verbal: 2 };
      const diff = (order[a.gmcs_summit_status] ?? 9) - (order[b.gmcs_summit_status] ?? 9);
      if (diff !== 0) return diff;
      return String(a.name || "").localeCompare(String(b.name || ""), "fr");
    });
}

// ─── Render stats ──────────────────────────────────────────────────────────────

function renderStats() {
  const registered = summitState.people.filter((p) => p.gmcs_summit_status);
  const byLevel = { verbal: 0, inscrit: 0, paiement: 0 };
  registered.forEach((p) => { if (byLevel[p.gmcs_summit_status] !== undefined) byLevel[p.gmcs_summit_status]++; });

  const total = registered.length;
  setText("hero-total", total);
  setText("stat-all", total);
  setText("stat-all-sub", `sur ${summitState.people.length} personnes au total`);
  setText("stat-verbal", byLevel.verbal);
  setText("stat-inscrit", byLevel.inscrit);
  setText("stat-paiement", byLevel.paiement);

  const sidebar = document.getElementById("sidebar-summit-stats");
  if (sidebar) {
    sidebar.innerHTML = `
      <span style="color:#92400e">${byLevel.verbal} verbal</span>
      <span style="color:#065f46">${byLevel.inscrit} inscrits</span>
      <span style="color:#1e3a8a">${byLevel.paiement} paiements</span>
      <span class="muted" style="margin-top:2px">${total} total</span>`;
  }
}

// ─── Render table ─────────────────────────────────────────────────────────────

function renderTable() {
  const tbody = document.getElementById("summit-tbody");
  const countEl = document.getElementById("summit-count");
  if (!tbody) return;

  const list = summitState.filtered;
  setText("summit-count", `${list.length} résultat${list.length > 1 ? "s" : ""}`);

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="summit-table-empty">Aucun pasteur inscrit pour ce filtre.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map((p) => {
    const status = p.gmcs_summit_status || "";
    const sources = getPersonSources(p);
    const sourceChips = sources.map((s) =>
      `<span class="summit-source-chip is-${s}">${{ mannam: "Mannam", academie: "Academie", cellule: "Cellule" }[s]}</span>`
    ).join("") || `<span class="summit-source-chip">—</span>`;
    const isStudent = p._type === "student";
    const typeBadge = isStudent
      ? `<span class="summit-source-chip is-academie" style="margin-bottom:4px">Etudiant</span>`
      : `<span class="summit-source-chip" style="margin-bottom:4px">Pasteur</span>`;
    const context = isStudent
      ? (p.class_name || "")
      : [p.church_name, p.city].filter(Boolean).join(" · ");
    const note = p.gmcs_summit_note ? `<span title="${p.gmcs_summit_note}">${p.gmcs_summit_note}</span>` : `<span class="muted">—</span>`;
    const searchParam = encodeURIComponent(p.name || "");
    const ficheUrl = isStudent ? `/academy-students.html?search=${searchParam}` : `/pastors.html?search=${searchParam}`;
    const patchEndpoint = isStudent
      ? `/api/academy/students/${encodeURIComponent(p.id)}/summit`
      : `/api/pastors/${encodeURIComponent(p.id)}/summit`;

    return `<tr data-person-id="${p.id}" data-person-type="${p._type}">
      <td>
        <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-bottom:2px">${typeBadge}</div>
        <div class="summit-pastor-name">${p.name || "Inconnu"}</div>
        <div class="summit-pastor-meta">${p.title || (isStudent ? (p.class_name || "") : "Sans titre")}</div>
      </td>
      <td><span style="font-size:0.85rem">${context || "—"}</span></td>
      <td><div class="summit-source-chips">${sourceChips}</div></td>
      <td>
        <select class="summit-status-select is-${status}" data-id="${p.id}" data-endpoint="${patchEndpoint}" data-note="${(p.gmcs_summit_note || "").replace(/"/g, "&quot;")}">
          <option value="" ${!status ? "selected" : ""}>Non inscrit</option>
          <option value="verbal" ${status === "verbal" ? "selected" : ""}>Accord verbal</option>
          <option value="inscrit" ${status === "inscrit" ? "selected" : ""}>Inscrit</option>
          <option value="paiement" ${status === "paiement" ? "selected" : ""}>Paiement reçu</option>
        </select>
      </td>
      <td class="summit-note-cell">${note}</td>
      <td class="summit-actions-cell">
        <a href="${ficheUrl}" class="secondary-action compact-action" style="font-size:0.78rem;padding:6px 12px;text-decoration:none">
          <span class="material-symbols-rounded" style="font-size:0.9rem">open_in_new</span>
          Fiche
        </a>
      </td>
    </tr>`;
  }).join("");

  // Wire status selects
  tbody.querySelectorAll(".summit-status-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const personId = sel.dataset.id;
      const endpoint = sel.dataset.endpoint;
      const newStatus = sel.value;
      const note = sel.dataset.note || "";
      sel.className = `summit-status-select is-${newStatus}`;
      try {
        const resp = await fetch(endpoint, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus, note })
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) throw new Error(data.error || "Erreur");

        // Update local state
        const person = summitState.people.find((p) => p.id === personId);
        if (person) person.gmcs_summit_status = newStatus;
        renderStats();
        applyFilter();
        if (!newStatus && summitState.filter !== "all") {
          renderTable();
        }
        showFeedback("Statut mis à jour.", "success");
      } catch (err) {
        showFeedback(err.message, "error");
        const person = summitState.people.find((p) => p.id === personId);
        if (person) sel.value = person.gmcs_summit_status || "";
      }
    });
  });
}

// ─── Data load ────────────────────────────────────────────────────────────────

async function loadData() {
  const [pastorResp, studentResp] = await Promise.all([
    fetch(`/api/pastors?ts=${Date.now()}`, { cache: "no-store" }),
    fetch(`/api/academy/students?ts=${Date.now()}`, { cache: "no-store" })
  ]);
  if (!pastorResp.ok) throw new Error("Impossible de charger les pasteurs.");
  if (!studentResp.ok) throw new Error("Impossible de charger les etudiants academie.");

  const pastorData = await pastorResp.json();
  const studentData = await studentResp.json();

  const pastors = (pastorData.pastors || []).map((p) => ({ ...p, _type: "pastor" }));
  const students = (studentData.students || [])
    .filter((s) => s.is_registered !== false) // only registered students
    .map((s) => ({ ...s, _type: "student" }));

  summitState.people = [...pastors, ...students];
}

// ─── Filter button wiring ─────────────────────────────────────────────────────

function attachHandlers() {
  document.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      summitState.filter = btn.dataset.filter;
      document.querySelectorAll("[data-filter]").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      applyFilter();
      renderTable();
    });
  });

  document.getElementById("summit-search")?.addEventListener("input", (e) => {
    summitState.search = e.target.value;
    applyFilter();
    renderTable();
  });

  document.querySelectorAll("[data-chart-granularity]").forEach((button) => {
    button.addEventListener("click", async () => {
      summitState.chartGranularity = button.dataset.chartGranularity;
      updateChartControlStates();
      await renderEvolutionChart();
    });
  });

  document.querySelectorAll("[data-chart-mode]").forEach((button) => {
    button.addEventListener("click", async () => {
      summitState.chartMode = button.dataset.chartMode;
      updateChartControlStates();
      await renderEvolutionChart();
    });
  });

  document.getElementById("btn-refresh-summit")?.addEventListener("click", async () => {
    try {
      await loadData();
      applyFilter();
      renderStats();
      renderTable();
      await renderEvolutionChart();
      showFeedback(`Données actualisées (${summitState.people.length} personnes).`, "success");
    } catch (err) {
      showFeedback(err.message, "error");
    }
  });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap() {
  if (window.AppAuth?.requireAuth) await window.AppAuth.requireAuth();
  if (window.AppAuth?.canManageUsers?.()) {
    document.querySelectorAll("[data-manage-users-link]").forEach((el) => { el.hidden = false; });
  }

  attachHandlers();
  updateChartControlStates();

  try {
    await loadData();
    applyFilter();
    renderStats();
    renderTable();
    await renderEvolutionChart();
  } catch (err) {
    showFeedback(err.message, "error");
    const tbody = document.getElementById("summit-tbody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="summit-table-empty">${err.message}</td></tr>`;
  }
}

document.addEventListener("DOMContentLoaded", bootstrap);
