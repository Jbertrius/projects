const state = {
  rawData: null,
  filteredMembers: [],
  filters: {
    period: "all",
    zone: "all",
    status: "all"
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

function parseMonthKey(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  const monthMap = {
    janv: "2026-01",
    janvier: "2026-01",
    fev: "2026-02",
    fevr: "2026-02",
    fevrier: "2026-02",
    mars: "2026-03",
    avr: "2026-04",
    avril: "2026-04",
    mai: "2026-05",
    juin: "2026-06",
    juil: "2026-07",
    juillet: "2026-07",
    aout: "2026-08",
    sep: "2026-09",
    sept: "2026-09",
    septembre: "2026-09",
    oct: "2026-10",
    octobre: "2026-10",
    nov: "2026-11",
    novembre: "2026-11",
    dec: "2026-12",
    decembre: "2026-12"
  };

  const token = Object.keys(monthMap).find((key) => normalized.startsWith(key));
  return token ? monthMap[token] : normalized;
}

function createKpiCard(kpi) {
  return `
    <article class="card kpi-card">
      <p class="section-label">${kpi.label}</p>
      <div class="kpi-value">${kpi.value}</div>
      <div class="kpi-delta tone-${kpi.tone}">${kpi.delta}</div>
    </article>
  `;
}

function createTrendChart(items) {
  if (!items.length) {
    return `<div class="empty-state">Aucune rencontre pour les filtres actuels.</div>`;
  }

  const max = Math.max(...items.map((item) => item.value), 1);
  const width = 640;
  const height = 220;
  const stepX = width / Math.max(items.length - 1, 1);
  const points = items.map((item, index) => {
    const x = index * stepX;
    const y = height - (item.value / max) * (height - 18) - 10;
    return { x, y, label: item.month, value: item.value };
  });
  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;

  return `
    <div class="trend-grid">${Array.from({ length: 5 }, () => "<span></span>").join("")}</div>
    <svg class="trend-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="trendGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#51b7ea"></stop>
          <stop offset="55%" stop-color="#f5c32c"></stop>
          <stop offset="100%" stop-color="#0e7d3a"></stop>
        </linearGradient>
      </defs>
      <path class="trend-fill" d="${areaPath}"></path>
      <path class="trend-line" d="${linePath}"></path>
      ${points
        .map(
          (point) =>
            `<circle class="trend-point" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="7"></circle>`
        )
        .join("")}
    </svg>
    <div class="trend-labels">
      ${points.map((point) => `<span>${point.label}<br /><strong>${point.value}</strong></span>`).join("")}
    </div>
  `;
}

function createActivityChart(items) {
  const topMembers = [...items].sort((a, b) => b.meetings - a.meetings).slice(0, 5);
  const max = Math.max(...topMembers.map((item) => item.meetings), 1);

  if (!topMembers.length) {
    return `<div class="empty-state">Aucun membre pour les filtres actuels.</div>`;
  }

  return topMembers
    .map(
      (member) => `
        <div class="activity-row">
          <div class="activity-meta">
            <span class="activity-name">${member.name}</span>
            <span>${member.meetings} rencontres</span>
          </div>
          <div class="activity-track">
            <div class="activity-fill" style="width: ${(member.meetings / max) * 100}%"></div>
          </div>
        </div>
      `
    )
    .join("");
}

function createPipeline(items) {
  return items
    .map(
      (item) => `
        <div class="pipeline-item">
          <span>${item.label}</span>
          <strong>${item.value}</strong>
        </div>
      `
    )
    .join("");
}

function createMembersRows(items) {
  if (!items.length) {
    return `
      <tr>
        <td colspan="6" class="empty-table">Aucun membre ne correspond aux filtres actuels.</td>
      </tr>
    `;
  }

  return items
    .map(
      (member) => `
        <tr>
          <td>${member.name}</td>
          <td>${member.zone}</td>
          <td>${member.meetings}</td>
          <td>${member.pastors}</td>
          <td>${member.formation}%</td>
          <td><span class="status-pill">${member.status}</span></td>
        </tr>
      `
    )
    .join("");
}

function createProgressChart(items) {
  if (!items.length) {
    return `<div class="empty-state">Aucune progression formation disponible.</div>`;
  }

  const max = Math.max(...items.map((item) => Math.max(item.attendance, item.completed)), 1);

  return items
    .map(
      (item) => `
        <div class="progress-row">
          <div class="progress-meta">
            <span class="progress-name">${item.week}</span>
            <span>${item.attendance} presents / ${item.completed} valides</span>
          </div>
          <div class="progress-track">
            <div class="progress-attendance" style="width: ${(item.attendance / max) * 100}%"></div>
            <div class="progress-completed" style="width: ${(item.completed / max) * 100}%"></div>
          </div>
        </div>
      `
    )
    .join("");
}

function createStatusChart(items) {
  const counts = items.reduce((acc, member) => {
    acc[member.status] = (acc[member.status] || 0) + 1;
    return acc;
  }, {});
  const max = Math.max(...Object.values(counts), 1);
  const colors = {
    "Très active": "linear-gradient(90deg, #0e7d3a, #39b36a)",
    "Tres active": "linear-gradient(90deg, #0e7d3a, #39b36a)",
    Active: "linear-gradient(90deg, #51b7ea, #2589c8)",
    "En progression": "linear-gradient(90deg, #f5c32c, #d9a719)",
    "A relancer": "linear-gradient(90deg, #f0c25a, #b87b00)",
    "À relancer": "linear-gradient(90deg, #f0c25a, #b87b00)",
    "À suivre": "linear-gradient(90deg, #8ab8d0, #5f7891)"
  };

  if (!Object.keys(counts).length) {
    return `<div class="empty-state">Aucun statut à afficher.</div>`;
  }

  return `
    <div class="status-stack">
      ${Object.entries(counts)
        .map(
          ([label, value]) => `
            <div class="status-item">
              <div class="status-meta">
                <span>${label}</span>
                <span>${value}</span>
              </div>
              <div class="status-bar">
                <div class="status-fill" style="width: ${(value / max) * 100}%; background: ${
                  colors[label] || "linear-gradient(90deg, #51b7ea, #0e7d3a)"
                }"></div>
              </div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function computeFilteredView(data) {
  const members = data.members || [];
  const periodFilter = state.filters.period;
  const zoneFilter = normalizeText(state.filters.zone);
  const statusFilter = normalizeText(state.filters.status);

  let filteredMembers = members.filter((member) => {
    const zoneOk = zoneFilter === "all" || normalizeText(member.zone) === zoneFilter;
    const statusOk = statusFilter === "all" || normalizeText(member.status) === statusFilter;
    return zoneOk && statusOk;
  });

  if (periodFilter !== "all") {
    const monthlyLookup = new Map((data.monthlyMeetings || []).map((item) => [parseMonthKey(item.month), item.value]));
    const selectedMonthHasData = monthlyLookup.has(periodFilter);
    if (!selectedMonthHasData) {
      filteredMembers = [];
    }
  }

  const monthItems =
    periodFilter === "all"
      ? data.monthlyMeetings || []
      : (data.monthlyMeetings || []).filter((item) => parseMonthKey(item.month) === periodFilter);

  const totalMeetings = filteredMembers.reduce((sum, member) => sum + Number(member.meetings || 0), 0);
  const totalPastors = filteredMembers.reduce((sum, member) => sum + Number(member.pastors || 0), 0);
  const activeMembers = filteredMembers.filter((member) => Number(member.meetings || 0) > 0).length;
  const inactiveMembers = filteredMembers.length - activeMembers;

  const kpis = (data.kpis || []).map((kpi) => ({ ...kpi }));
  if (kpis[0]) {
    kpis[0].value = totalPastors;
    kpis[0].delta = `${totalMeetings} rencontres visibles`;
  }
  if (kpis[1]) {
    kpis[1].value = activeMembers;
    kpis[1].delta = `${inactiveMembers} sans activite`;
    kpis[1].tone = inactiveMembers > 0 ? "warning" : "positive";
  }
  if (kpis[2]) {
    kpis[2].value = totalMeetings;
    kpis[2].delta = `${filteredMembers.length} membres filtres`;
  }
  if (kpis[3]) {
    kpis[3].value = filteredMembers.filter((member) => Number(member.formation || 0) > 0).length;
    kpis[3].delta = `${filteredMembers.length ? Math.round(filteredMembers.reduce((sum, member) => sum + Number(member.formation || 0), 0) / filteredMembers.length) : 0}% formation moyenne`;
  }

  const pipeline = [
    { label: "Rencontres visibles", value: totalMeetings },
    { label: "Membres filtres", value: filteredMembers.length },
    { label: "Pasteurs visibles", value: totalPastors },
    { label: "Suivis a faire", value: inactiveMembers }
  ];

  return {
    kpis,
    monthlyMeetings: monthItems,
    members: filteredMembers,
    formationTimeline: data.formationTimeline || [],
    pipeline
  };
}

function populateFilterOptions(data) {
  const periodFilter = document.getElementById("period-filter");
  const zoneFilter = document.getElementById("zone-filter");
  const statusFilter = document.getElementById("status-filter");

  if (!periodFilter || !zoneFilter || !statusFilter) {
    return;
  }

  const monthOptions = (data.monthlyMeetings || []).map((item) => ({
    value: parseMonthKey(item.month),
    label: item.month
  }));
  const zones = Array.from(new Set((data.members || []).map((member) => member.zone).filter(Boolean))).sort();
  const statuses = Array.from(new Set((data.members || []).map((member) => member.status).filter(Boolean))).sort();

  periodFilter.innerHTML = [
    `<option value="all">Toutes periodes</option>`,
    ...monthOptions.map((item) => `<option value="${item.value}">${item.label}</option>`)
  ].join("");
  zoneFilter.innerHTML = [
    `<option value="all">Toutes les zones</option>`,
    ...zones.map((zone) => `<option value="${zone}">${zone}</option>`)
  ].join("");
  statusFilter.innerHTML = [
    `<option value="all">Tous</option>`,
    ...statuses.map((status) => `<option value="${status}">${status}</option>`)
  ].join("");
}

function renderDashboard() {
  if (!state.rawData) {
    return;
  }

  const view = computeFilteredView(state.rawData);
  state.filteredMembers = view.members;

  document.getElementById("kpi-grid").innerHTML = view.kpis.map(createKpiCard).join("");
  document.getElementById("monthly-chart").innerHTML = createTrendChart(view.monthlyMeetings);
  document.getElementById("activity-chart").innerHTML = createActivityChart(view.members);
  document.getElementById("pipeline-list").innerHTML = createPipeline(view.pipeline);
  document.getElementById("members-table").innerHTML = createMembersRows(view.members);
  document.getElementById("formation-chart").innerHTML = createProgressChart(view.formationTimeline);
  document.getElementById("status-chart").innerHTML = createStatusChart(view.members);
}

function attachFilterHandlers() {
  const periodFilter = document.getElementById("period-filter");
  const zoneFilter = document.getElementById("zone-filter");
  const statusFilter = document.getElementById("status-filter");
  const resetFilters = document.getElementById("reset-filters");

  periodFilter?.addEventListener("change", () => {
    state.filters.period = periodFilter.value;
    renderDashboard();
  });

  zoneFilter?.addEventListener("change", () => {
    state.filters.zone = zoneFilter.value;
    renderDashboard();
  });

  statusFilter?.addEventListener("change", () => {
    state.filters.status = statusFilter.value;
    renderDashboard();
  });

  resetFilters?.addEventListener("click", () => {
    state.filters = { period: "all", zone: "all", status: "all" };
    periodFilter.value = "all";
    zoneFilter.value = "all";
    statusFilter.value = "all";
    renderDashboard();
    showFeedback("Filtres reinitialises.", "success");
  });
}

function setButtonsBusy(isBusy) {
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.disabled = isBusy;
  });
}

async function runAction(action) {
  const routes = {
    "sync-calendar": { url: "/api/sync/calendar-to-sheets", message: "Synchronisation Calendar terminee." },
    "sync-firestore": { url: "/api/sync/firestore", message: "Synchronisation Firestore terminee." }
  };

  const config = routes[action];
  if (!config) {
    return;
  }

  setButtonsBusy(true);
  showFeedback("Operation en cours...", "info");

  try {
    const response = await fetch(config.url);
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "Operation impossible.");
    }

    showFeedback(config.message, "success");
    await refreshDashboard();
  } catch (error) {
    showFeedback(error.message, "error");
  } finally {
    setButtonsBusy(false);
  }
}

function attachActionHandlers() {
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => runAction(button.dataset.action));
  });
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

async function refreshDashboard() {
  const response = await fetch("/api/dashboard");
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Impossible de charger le dashboard.");
  }

  state.rawData = data;
  document.getElementById("policy-name").textContent = data.meta.policyName;
  document.getElementById("period-label").textContent = data.meta.period;
  document.getElementById("refresh-label").textContent = data.meta.refreshLabel;
  populateFilterOptions(data);
  renderDashboard();
}

async function loadDashboard() {
  const app = document.getElementById("app");

  try {
    app.innerHTML = document.getElementById("dashboard-template").innerHTML;
    attachActionHandlers();
    attachNavigationHandlers();
    attachFilterHandlers();
    await refreshDashboard();
  } catch (error) {
    app.innerHTML = `
      <section class="loading-state">
        Impossible de charger les donnees du dashboard.
      </section>
    `;
    showFeedback(error.message, "error");
  }
}

loadDashboard();
