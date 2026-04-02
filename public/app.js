const state = {
  rawData: null,
  filteredMembers: [],
  charts: {},
  filters: {
    period: "all",
    zone: "all",
    status: "all",
    granularity: "monthly"
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

function pad(value) {
  return String(value).padStart(2, "0");
}

function parseDateValue(value) {
  if (!value) {
    return null;
  }

  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }

  const frenchMatch = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!frenchMatch) {
    return null;
  }

  const [, day, month, year] = frenchMatch;
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
  if (granularity === "daily") {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  if (granularity === "weekly") {
    const monday = startOfWeek(date);
    return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
  }

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function formatBucketLabel(key, granularity) {
  if (granularity === "daily") {
    const date = parseDateValue(key);
    return date
      ? date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
      : key;
  }

  if (granularity === "weekly") {
    const date = parseDateValue(key);
    return date
      ? `Sem. du ${date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`
      : key;
  }

  const date = parseDateValue(`${key}-01`);
  return date
    ? date.toLocaleDateString("fr-FR", { month: "short", year: "numeric" })
    : key;
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

function matchesZone(record, zoneFilter) {
  if (zoneFilter === "all") {
    return true;
  }

  const zones = [record.zone, ...(record.memberZones || [])]
    .map(normalizeText)
    .filter(Boolean);

  return zones.includes(zoneFilter);
}

function matchesStatus(record, statusFilter) {
  if (statusFilter === "all") {
    return true;
  }

  return (record.memberStatuses || []).map(normalizeText).includes(statusFilter);
}

function getZoneStatusFilteredRecords(data) {
  const records = data.meetingRecords || [];
  const zoneFilter = normalizeText(state.filters.zone);
  const statusFilter = normalizeText(state.filters.status);

  return records.filter((record) => matchesZone(record, zoneFilter) && matchesStatus(record, statusFilter));
}

function aggregateTrajectoryRecords(records, granularity) {
  const grouped = new Map();

  records.forEach((record) => {
    const date = parseDateValue(record.meetingDate);
    if (!date) {
      return;
    }

    const key = toBucketKey(date, granularity);
    grouped.set(key, (grouped.get(key) || 0) + 1);
  });

  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({
      key,
      label: formatBucketLabel(key, granularity),
      value
    }));
}

function computeMemberSummaries(members, records, scopedToPeriod) {
  const meetingStats = new Map();

  records.forEach((record) => {
    const pastorName = record.pastorName || "";
    (record.memberIds || []).forEach((memberId) => {
      const key = String(memberId);
      const current = meetingStats.get(key) || { meetings: 0, pastors: new Set() };
      current.meetings += 1;
      if (pastorName) {
        current.pastors.add(pastorName);
      }
      meetingStats.set(key, current);
    });
  });

  const summaries = members.map((member) => {
    const stats = meetingStats.get(String(member.id)) || { meetings: 0, pastors: new Set() };
    return {
      ...member,
      meetings: stats.meetings,
      pastors: stats.pastors.size
    };
  });

  const visibleMembers = scopedToPeriod ? summaries.filter((member) => member.meetings > 0) : summaries;
  return visibleMembers.sort((a, b) => b.meetings - a.meetings || b.formation - a.formation || a.name.localeCompare(b.name));
}

function computeFilteredView(data) {
  const members = data.members || [];
  const granularity = state.filters.granularity;
  const zoneFilter = normalizeText(state.filters.zone);
  const statusFilter = normalizeText(state.filters.status);
  const zoneStatusFilteredMembers = members.filter((member) => {
    const zoneOk = zoneFilter === "all" || normalizeText(member.zone) === zoneFilter;
    const statusOk = statusFilter === "all" || normalizeText(member.status) === statusFilter;
    return zoneOk && statusOk;
  });

  const zoneStatusRecords = getZoneStatusFilteredRecords(data);
  const trajectoryAll = aggregateTrajectoryRecords(zoneStatusRecords, granularity);
  const validPeriodKeys = new Set(trajectoryAll.map((item) => item.key));

  if (state.filters.period !== "all" && !validPeriodKeys.has(state.filters.period)) {
    state.filters.period = "all";
  }

  const memberSummaries = computeMemberSummaries(zoneStatusFilteredMembers, zoneStatusRecords, false);
  const totalMeetings = zoneStatusRecords.length;
  const totalPastors = new Set(zoneStatusRecords.map((record) => record.pastorName).filter(Boolean)).size;
  const activeMembers = memberSummaries.filter((member) => Number(member.meetings || 0) > 0).length;
  const inactiveMembers = memberSummaries.length - activeMembers;

  const kpis = (data.kpis || []).map((kpi) => ({ ...kpi }));
  if (kpis[0]) {
    kpis[0].value = totalPastors;
    kpis[0].delta = `${totalMeetings} rencontres visibles`;
  }
  if (kpis[1]) {
    kpis[1].value = activeMembers;
    kpis[1].delta = `${Math.max(inactiveMembers, 0)} sans activite`;
    kpis[1].tone = inactiveMembers > 0 ? "warning" : "positive";
  }
  if (kpis[2]) {
    kpis[2].value = totalMeetings;
    kpis[2].delta = `${memberSummaries.length} membres filtres`;
  }
  if (kpis[3]) {
    const membersWithFormation = memberSummaries.filter((member) => Number(member.formation || 0) > 0);
    kpis[3].value = membersWithFormation.length;
    kpis[3].delta = `${memberSummaries.length ? Math.round(memberSummaries.reduce((sum, member) => sum + Number(member.formation || 0), 0) / memberSummaries.length) : 0}% formation moyenne`;
  }

  const pipeline = [
    { label: "Rencontres visibles", value: totalMeetings },
    { label: "Membres filtres", value: memberSummaries.length },
    { label: "Pasteurs visibles", value: totalPastors },
    { label: "Suivis a faire", value: Math.max(inactiveMembers, 0) }
  ];

  return {
    kpis,
    trajectory:
      state.filters.period === "all"
        ? trajectoryAll
        : trajectoryAll.filter((item) => item.key === state.filters.period),
    members: memberSummaries,
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

  const previousPeriod = state.filters.period;
  const trajectoryOptions = aggregateTrajectoryRecords(getZoneStatusFilteredRecords(data), state.filters.granularity);
  const zones = Array.from(new Set((data.members || []).map((member) => member.zone).filter(Boolean))).sort();
  const statuses = Array.from(new Set((data.members || []).map((member) => member.status).filter(Boolean))).sort();

  periodFilter.innerHTML = [
    `<option value="all">Toutes periodes</option>`,
    ...trajectoryOptions.map((item) => `<option value="${item.key}">${item.label}</option>`)
  ].join("");
  zoneFilter.innerHTML = [
    `<option value="all">Toutes les zones</option>`,
    ...zones.map((zone) => `<option value="${zone}">${zone}</option>`)
  ].join("");
  statusFilter.innerHTML = [
    `<option value="all">Tous</option>`,
    ...statuses.map((status) => `<option value="${status}">${status}</option>`)
  ].join("");

  state.filters.period = trajectoryOptions.some((item) => item.key === previousPeriod) ? previousPeriod : "all";
  periodFilter.value = state.filters.period;
  zoneFilter.value = state.filters.zone;
  statusFilter.value = state.filters.status;
}

function getChartBaseOptions() {
  return {
    chart: {
      fontFamily: 'Instrument Sans, sans-serif',
      toolbar: { show: false },
      zoom: { enabled: false },
      animations: { easing: 'easeinout', speed: 420 }
    },
    grid: {
      borderColor: 'rgba(37, 137, 200, 0.12)',
      strokeDashArray: 4,
      padding: { left: 6, right: 12, top: 8, bottom: 0 }
    },
    legend: {
      fontSize: '13px',
      labels: { colors: ['#5f7891'] }
    },
    tooltip: {
      theme: 'light'
    },
    dataLabels: {
      enabled: false
    }
  };
}

function destroyChart(key) {
  if (state.charts[key]) {
    state.charts[key].destroy();
    delete state.charts[key];
  }
}

async function mountChart(key, elementId, options) {
  const element = document.getElementById(elementId);
  if (!element) {
    return;
  }

  if (typeof ApexCharts === 'undefined') {
    element.innerHTML = '<div class="empty-state">La librairie de graphiques n\'a pas pu se charger.</div>';
    return;
  }

  destroyChart(key);
  element.innerHTML = '';
  const chart = new ApexCharts(element, options);
  state.charts[key] = chart;
  await chart.render();
}

function renderEmptyChart(key, elementId, message) {
  destroyChart(key);
  const element = document.getElementById(elementId);
  if (element) {
    element.innerHTML = `<div class="empty-state">${message}</div>`;
  }
}

async function renderTrajectoryChart(items) {
  if (!items.length) {
    renderEmptyChart('trajectory', 'monthly-chart', 'Aucune rencontre pour les filtres actuels.');
    return;
  }

  await mountChart('trajectory', 'monthly-chart', {
    ...getChartBaseOptions(),
    chart: {
      ...getChartBaseOptions().chart,
      type: 'area',
      height: 320
    },
    colors: ['#1d8a5a'],
    stroke: {
      curve: 'smooth',
      width: 4
    },
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.32,
        opacityTo: 0.04,
        stops: [0, 90, 100],
        colorStops: [
          [
            { offset: 0, color: '#51b7ea', opacity: 0.42 },
            { offset: 50, color: '#f5c32c', opacity: 0.28 },
            { offset: 100, color: '#0e7d3a', opacity: 0.08 }
          ]
        ]
      }
    },
    series: [
      {
        name: 'Rencontres',
        data: items.map((item) => item.value)
      }
    ],
    xaxis: {
      categories: items.map((item) => item.label),
      labels: {
        rotate: 0,
        trim: true,
        hideOverlappingLabels: true,
        style: {
          colors: '#68839d',
          fontSize: '12px'
        }
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
      tooltip: { enabled: false }
    },
    yaxis: {
      min: 0,
      forceNiceScale: true,
      labels: {
        style: {
          colors: '#68839d',
          fontSize: '12px'
        }
      }
    },
    markers: {
      size: 5,
      strokeWidth: 3,
      strokeColors: '#ffffff',
      hover: { size: 7 }
    },
    tooltip: {
      theme: 'light',
      y: {
        formatter: (value) => `${value} rencontre${value > 1 ? 's' : ''}`
      }
    }
  });
}

async function renderActivityChart(items) {
  const topMembers = [...items].sort((a, b) => b.meetings - a.meetings).slice(0, 6);
  if (!topMembers.length) {
    renderEmptyChart('activity', 'activity-chart', 'Aucun membre pour les filtres actuels.');
    return;
  }

  await mountChart('activity', 'activity-chart', {
    ...getChartBaseOptions(),
    chart: {
      ...getChartBaseOptions().chart,
      type: 'bar',
      height: 320
    },
    colors: ['#2589c8'],
    series: [
      {
        name: 'Rencontres',
        data: topMembers.map((member) => member.meetings)
      }
    ],
    plotOptions: {
      bar: {
        horizontal: true,
        borderRadius: 8,
        barHeight: '54%',
        distributed: true
      }
    },
    colors: ['#51b7ea', '#3ea0d4', '#2d94bf', '#1f87ab', '#177a8f', '#0e7d3a'],
    xaxis: {
      categories: topMembers.map((member) => member.name),
      labels: {
        style: {
          colors: '#68839d',
          fontSize: '12px'
        }
      }
    },
    yaxis: {
      labels: {
        style: {
          colors: '#12314a',
          fontSize: '14px',
          fontWeight: 600
        }
      }
    },
    tooltip: {
      theme: 'light',
      y: {
        formatter: (value) => `${value} rencontre${value > 1 ? 's' : ''}`
      }
    },
    legend: { show: false }
  });
}

async function renderProgressChart(items) {
  if (!items.length) {
    renderEmptyChart('progress', 'formation-chart', 'Aucune progression formation disponible.');
    return;
  }

  await mountChart('progress', 'formation-chart', {
    ...getChartBaseOptions(),
    chart: {
      ...getChartBaseOptions().chart,
      type: 'bar',
      height: 320,
      stacked: false
    },
    series: [
      {
        name: 'Presences',
        data: items.map((item) => item.attendance)
      },
      {
        name: 'Validations',
        data: items.map((item) => item.completed)
      }
    ],
    colors: ['#51b7ea', '#f5c32c'],
    plotOptions: {
      bar: {
        borderRadius: 8,
        columnWidth: '42%'
      }
    },
    xaxis: {
      categories: items.map((item) => item.week),
      labels: {
        style: {
          colors: '#68839d',
          fontSize: '12px'
        }
      }
    },
    yaxis: {
      min: 0,
      labels: {
        style: {
          colors: '#68839d',
          fontSize: '12px'
        }
      }
    }
  });
}

async function renderStatusChart(items) {
  const counts = items.reduce((acc, member) => {
    acc[member.status] = (acc[member.status] || 0) + 1;
    return acc;
  }, {});

  const labels = Object.keys(counts);
  if (!labels.length) {
    renderEmptyChart('status', 'status-chart', 'Aucun statut a afficher.');
    return;
  }

  await mountChart('status', 'status-chart', {
    ...getChartBaseOptions(),
    chart: {
      ...getChartBaseOptions().chart,
      type: 'donut',
      height: 320
    },
    series: labels.map((label) => counts[label]),
    labels,
    colors: ['#0e7d3a', '#51b7ea', '#f5c32c', '#b87b00', '#8ab8d0'],
    stroke: {
      colors: ['rgba(255,255,255,0.92)']
    },
    legend: {
      position: 'bottom',
      fontSize: '13px',
      labels: { colors: ['#5f7891'] }
    },
    plotOptions: {
      pie: {
        donut: {
          size: '68%',
          labels: {
            show: true,
            total: {
              show: true,
              label: 'Membres',
              color: '#5f7891',
              formatter: () => String(items.length)
            }
          }
        }
      }
    }
  });
}

async function renderDashboard() {
  if (!state.rawData) {
    return;
  }

  populateFilterOptions(state.rawData);
  const view = computeFilteredView(state.rawData);
  state.filteredMembers = view.members;

  document.getElementById('kpi-grid').innerHTML = view.kpis.map(createKpiCard).join('');
  document.getElementById('pipeline-list').innerHTML = createPipeline(view.pipeline);
  document.getElementById('members-table').innerHTML = createMembersRows(view.members);

  await Promise.all([
    renderTrajectoryChart(view.trajectory),
    renderActivityChart(view.members),
    renderProgressChart(view.formationTimeline),
    renderStatusChart(view.members)
  ]);

  document.querySelectorAll('[data-granularity]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.granularity === state.filters.granularity);
  });
}

function attachFilterHandlers() {
  const periodFilter = document.getElementById('period-filter');
  const zoneFilter = document.getElementById('zone-filter');
  const statusFilter = document.getElementById('status-filter');
  const resetFilters = document.getElementById('reset-filters');

  periodFilter?.addEventListener('change', () => {
    state.filters.period = periodFilter.value;
    renderDashboard();
  });

  zoneFilter?.addEventListener('change', () => {
    state.filters.zone = zoneFilter.value;
    renderDashboard();
  });

  statusFilter?.addEventListener('change', () => {
    state.filters.status = statusFilter.value;
    renderDashboard();
  });

  resetFilters?.addEventListener('click', () => {
    state.filters = { period: 'all', zone: 'all', status: 'all', granularity: 'monthly' };
    renderDashboard();
    showFeedback('Filtres reinitialises.', 'success');
  });

  document.querySelectorAll('[data-granularity]').forEach((button) => {
    button.addEventListener('click', () => {
      state.filters.granularity = button.dataset.granularity;
      state.filters.period = 'all';
      renderDashboard();
    });
  });
}

function setButtonsBusy(isBusy) {
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.disabled = isBusy;
  });
}

async function runAction(action) {
  const routes = {
    'sync-full': {
      url: '/api/sync/full',
      message: 'Synchronisation complete terminee.'
    },
    'sync-calendar': { url: '/api/sync/calendar-to-sheets', message: 'Import des rencontres termine.' },
    'sync-firestore': { url: '/api/sync/firestore', message: 'Mise a jour de la base terminee.' }
  };

  const config = routes[action];
  if (!config) {
    return;
  }

  setButtonsBusy(true);
  showFeedback('Operation en cours...', 'info');

  try {
    const response = await fetch(config.url);
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || 'Operation impossible.');
    }

    if (action === 'sync-full' && payload.steps) {
      const importedEvents = payload.steps.calendarToSheets?.importedEvents ?? 0;
      const syncedMeetings = payload.steps.sheetsToFirestore?.meetings ?? 0;
      showFeedback(`${config.message} ${importedEvents} rencontres importees, ${syncedMeetings} rencontres consolidees.`, 'success');
    } else {
      showFeedback(config.message, 'success');
    }
    await refreshDashboard();
  } catch (error) {
    showFeedback(error.message, 'error');
  } finally {
    setButtonsBusy(false);
  }
}

function attachActionHandlers() {
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => runAction(button.dataset.action));
  });
}

function attachNavigationHandlers() {
  const navItems = Array.from(document.querySelectorAll('.nav-item[data-target]'));
  navItems.forEach((button) => {
    button.addEventListener('click', () => {
      navItems.forEach((item) => item.classList.remove('is-active'));
      button.classList.add('is-active');
      const target = document.getElementById(button.dataset.target);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

async function refreshDashboard() {
  const response = await fetch('/api/dashboard');
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Impossible de charger le dashboard.');
  }

  state.rawData = data;
  document.getElementById('policy-name').textContent = data.meta.policyName;
  document.getElementById('period-label').textContent = data.meta.period;
  document.getElementById('refresh-label').textContent = data.meta.refreshLabel;
  await renderDashboard();
}

async function loadDashboard() {
  const app = document.getElementById('app');

  try {
    await window.AppAuth.requireAuth();
    app.innerHTML = document.getElementById('dashboard-template').innerHTML;
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
    showFeedback(error.message, 'error');
  }
}

loadDashboard().catch((error) => showFeedback(error.message, 'error'));
