// ─────────────────────────────────────────────────────────────────────────────
// evangelisation.js — Trajectoire + Top membres charts for the Evangelisation page
// ─────────────────────────────────────────────────────────────────────────────

const evState = {
  rawData: null,
  charts: {},
  filters: {
    granularity: "monthly",
    dateFrom: "",
    dateTo: ""
  }
};

// ─── Utilities ───────────────────────────────────────────────────────────────

function evPad(value) {
  return String(value).padStart(2, "0");
}

function evParseDateValue(value) {
  if (!value) return null;
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;
  const frenchMatch = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!frenchMatch) return null;
  const [, day, month, year] = frenchMatch;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function evStartOfWeek(date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function evToBucketKey(date, granularity) {
  if (granularity === "daily") {
    return `${date.getFullYear()}-${evPad(date.getMonth() + 1)}-${evPad(date.getDate())}`;
  }
  if (granularity === "weekly") {
    const monday = evStartOfWeek(date);
    return `${monday.getFullYear()}-${evPad(monday.getMonth() + 1)}-${evPad(monday.getDate())}`;
  }
  return `${date.getFullYear()}-${evPad(date.getMonth() + 1)}`;
}

function evFormatBucketLabel(key, granularity) {
  if (granularity === "daily") {
    const date = evParseDateValue(key);
    return date ? date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : key;
  }
  if (granularity === "weekly") {
    const date = evParseDateValue(key);
    return date ? `Sem. du ${date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}` : key;
  }
  const date = evParseDateValue(`${key}-01`);
  return date ? date.toLocaleDateString("fr-FR", { month: "short", year: "numeric" }) : key;
}

// ─── Data aggregation ────────────────────────────────────────────────────────

function evGetFilteredRecords() {
  const records = evState.rawData?.meetingRecords || [];
  const { dateFrom, dateTo } = evState.filters;
  if (!dateFrom && !dateTo) return records;
  return records.filter((record) => {
    const d = String(record.meetingDate || "").slice(0, 10);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  });
}

function evFormatDate(value) {
  if (!value) return "—";
  const d = new Date(String(value).slice(0, 10) + "T12:00:00");
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

function evMatchBadgeClass(status) {
  const map = { exact: "badge-success", fuzzy: "badge-warning", partial: "badge-warning", manual: "badge-info", unmatched: "badge-error" };
  return `badge ${map[status] || "badge-error"}`;
}

function evMatchBadgeLabel(status) {
  const map = { exact: "Résolu", fuzzy: "Approximatif", partial: "Partiel", manual: "Manuel", unmatched: "Non résolu" };
  return map[status] || "Non résolu";
}

function evBuildSubtitle() {
  const { dateFrom, dateTo } = evState.filters;
  const fmt = (s) => new Date(s + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  if (dateFrom && dateTo) return `Du ${fmt(dateFrom)} au ${fmt(dateTo)}`;
  if (dateFrom) return `À partir du ${fmt(dateFrom)}`;
  if (dateTo) return `Jusqu'au ${fmt(dateTo)}`;
  return "Toutes les rencontres";
}

function evRenderMannams() {
  const loading = document.getElementById("ev-mannams-loading");
  const empty = document.getElementById("ev-mannams-empty");
  const list = document.getElementById("ev-mannams-list");
  const subtitle = document.getElementById("ev-mannams-subtitle");
  const countBadge = document.getElementById("ev-mannams-count");
  if (!list) return;

  const records = evGetFilteredRecords();
  // Sort newest first
  const sorted = [...records].sort((a, b) => String(b.meetingDate || "").localeCompare(String(a.meetingDate || "")));

  if (loading) loading.hidden = true;

  // Always update hero total
  const allRecords = evState.rawData?.meetingRecords || [];
  const statTotal = document.getElementById("ev-stat-total");
  if (statTotal) statTotal.textContent = allRecords.length;

  // Update subtitle to reflect active date filter
  if (subtitle) subtitle.textContent = evBuildSubtitle();

  if (!sorted.length) {
    if (list) list.hidden = true;
    if (empty) empty.hidden = false;
    if (countBadge) countBadge.textContent = "0";
    const statPeriod = document.getElementById("ev-stat-period");
    if (statPeriod) statPeriod.textContent = "0";
    return;
  }

  if (empty) empty.hidden = true;
  list.hidden = false;
  if (countBadge) countBadge.textContent = sorted.length;

  const statPeriod = document.getElementById("ev-stat-period");
  if (statPeriod) statPeriod.textContent = sorted.length;

  list.innerHTML = sorted.map((record) => {
    const member = (record.memberNames || [])[0] || "—";
    const matchStatus = record.matchStatus || "unmatched";
    const isUnmatched = matchStatus === "unmatched";

    return `
      <div class="ev-mannam-item${isUnmatched ? " is-unmatched" : ""}">
        <div class="ev-mannam-body">
          <div class="ev-mannam-name">${record.pastorName || "Pasteur inconnu"}</div>
          <div class="ev-mannam-meta">${member} · ${evFormatDate(record.meetingDate)}</div>
        </div>
        ${isUnmatched ? `<span class="material-symbols-rounded ev-mannam-alert" title="Non resolu">priority_high</span>` : ""}
        <a href="/mannams.html?id=${encodeURIComponent(record.id)}" class="ev-btn ev-btn-secondary ev-btn-sm" style="flex-shrink:0;text-decoration:none">
          <span class="material-symbols-rounded" aria-hidden="true">open_in_new</span>
        </a>
      </div>`;
  }).join("");
}

function evAggregateTrajectory(records) {
  const grouped = new Map();
  records.forEach((record) => {
    const date = evParseDateValue(record.meetingDate);
    if (!date) return;
    const key = evToBucketKey(date, evState.filters.granularity);
    grouped.set(key, (grouped.get(key) || 0) + 1);
  });
  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, label: evFormatBucketLabel(key, evState.filters.granularity), value }));
}

function evComputeTopMembers(records) {
  const members = evState.rawData?.members || [];
  const meetingCounts = new Map();
  records.forEach((record) => {
    (record.memberIds || []).forEach((id) => {
      meetingCounts.set(String(id), (meetingCounts.get(String(id)) || 0) + 1);
    });
  });
  const memberById = new Map(members.map((m) => [String(m.id), m]));
  return Array.from(meetingCounts.entries())
    .map(([id, count]) => ({ name: memberById.get(id)?.name || id, meetings: count }))
    .sort((a, b) => b.meetings - a.meetings)
    .slice(0, 6);
}

// ─── Chart helpers ───────────────────────────────────────────────────────────

function evGetChartBaseOptions() {
  return {
    chart: {
      fontFamily: "Instrument Sans, sans-serif",
      toolbar: { show: false },
      zoom: { enabled: false },
      animations: { easing: "easeinout", speed: 420 }
    },
    grid: {
      borderColor: "rgba(37, 137, 200, 0.12)",
      strokeDashArray: 4,
      padding: { left: 6, right: 12, top: 8, bottom: 0 }
    },
    legend: { fontSize: "13px", labels: { colors: ["#5f7891"] } },
    tooltip: { theme: "light" },
    dataLabels: { enabled: false }
  };
}

function evDestroyChart(key) {
  if (evState.charts[key]) {
    evState.charts[key].destroy();
    delete evState.charts[key];
  }
}

async function evMountChart(key, elementId, options) {
  const element = document.getElementById(elementId);
  if (!element) return;
  if (typeof ApexCharts === "undefined") {
    element.innerHTML = '<div class="empty-state">La librairie de graphiques n\'a pas pu se charger.</div>';
    return;
  }
  evDestroyChart(key);
  element.innerHTML = "";
  const chart = new ApexCharts(element, options);
  evState.charts[key] = chart;
  await chart.render();
}

function evRenderEmptyChart(key, elementId, message) {
  evDestroyChart(key);
  const el = document.getElementById(elementId);
  if (el) el.innerHTML = `<div class="empty-state">${message}</div>`;
}

// ─── Chart renders ───────────────────────────────────────────────────────────

async function evRenderTrajectoryChart() {
  const records = evGetFilteredRecords();
  const items = evAggregateTrajectory(records);

  if (!items.length) {
    evRenderEmptyChart("ev-trajectory", "ev-monthly-chart", "Aucune rencontre pour les filtres actuels.");
    return;
  }

  await evMountChart("ev-trajectory", "ev-monthly-chart", {
    ...evGetChartBaseOptions(),
    chart: { ...evGetChartBaseOptions().chart, type: "area", height: 320 },
    colors: ["#1d8a5a"],
    stroke: { curve: "smooth", width: 4 },
    fill: {
      type: "gradient",
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.32,
        opacityTo: 0.04,
        stops: [0, 90, 100],
        colorStops: [[
          { offset: 0, color: "#51b7ea", opacity: 0.42 },
          { offset: 50, color: "#f5c32c", opacity: 0.28 },
          { offset: 100, color: "#0e7d3a", opacity: 0.08 }
        ]]
      }
    },
    series: [{ name: "Rencontres", data: items.map((item) => item.value) }],
    xaxis: {
      categories: items.map((item) => item.label),
      labels: {
        rotate: 0, trim: true, hideOverlappingLabels: true,
        style: { colors: "#68839d", fontSize: "12px" }
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
      tooltip: { enabled: false }
    },
    yaxis: {
      min: 0, forceNiceScale: true,
      labels: { style: { colors: "#68839d", fontSize: "12px" } }
    },
    markers: { size: 5, strokeWidth: 3, strokeColors: "#ffffff", hover: { size: 7 } },
    tooltip: { theme: "light", y: { formatter: (v) => `${v} rencontre${v > 1 ? "s" : ""}` } }
  });
}

async function evRenderActivityChart() {
  const records = evGetFilteredRecords();
  const topMembers = evComputeTopMembers(records);

  if (!topMembers.length) {
    evRenderEmptyChart("ev-activity", "ev-activity-chart", "Aucun membre pour les filtres actuels.");
    return;
  }

  await evMountChart("ev-activity", "ev-activity-chart", {
    ...evGetChartBaseOptions(),
    chart: { ...evGetChartBaseOptions().chart, type: "bar", height: 320 },
    series: [{ name: "Rencontres", data: topMembers.map((m) => m.meetings) }],
    plotOptions: { bar: { horizontal: true, borderRadius: 8, barHeight: "54%", distributed: true } },
    colors: ["#51b7ea", "#3ea0d4", "#2d94bf", "#1f87ab", "#177a8f", "#0e7d3a"],
    xaxis: {
      categories: topMembers.map((m) => m.name),
      labels: { style: { colors: "#68839d", fontSize: "12px" } },
      axisBorder: { show: false }, axisTicks: { show: false }
    },
    yaxis: {
      labels: { style: { colors: "#12314a", fontSize: "14px", fontWeight: 600 } }
    },
    tooltip: { theme: "light", y: { formatter: (v) => `${v} rencontre${v > 1 ? "s" : ""}` } },
    legend: { show: false }
  });
}

async function evRenderCharts() {
  evRenderMannams();
  await Promise.all([evRenderTrajectoryChart(), evRenderActivityChart()]);

  document.querySelectorAll("[data-ev-granularity]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.evGranularity === evState.filters.granularity);
  });
}

// ─── Event wiring ────────────────────────────────────────────────────────────

function evAttachHandlers() {
  document.querySelectorAll("[data-ev-granularity]").forEach((btn) => {
    btn.addEventListener("click", () => {
      evState.filters.granularity = btn.dataset.evGranularity;
      evRenderCharts();
    });
  });

  document.getElementById("ev-date-from")?.addEventListener("change", (e) => {
    evState.filters.dateFrom = e.target.value;
    evRenderCharts();
  });

  document.getElementById("ev-date-to")?.addEventListener("change", (e) => {
    evState.filters.dateTo = e.target.value;
    evRenderCharts();
  });

  document.getElementById("ev-date-reset")?.addEventListener("click", () => {
    evState.filters.dateFrom = "";
    evState.filters.dateTo = "";
    document.getElementById("ev-date-from").value = "";
    document.getElementById("ev-date-to").value = "";
    evRenderCharts();
  });
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function evBootstrap() {
  if (window.AppAuth?.requireAuth) await window.AppAuth.requireAuth();
  if (window.AppAuth?.canManageUsers?.()) {
    document.querySelectorAll("[data-manage-users-link]").forEach((el) => { el.hidden = false; });
  }

  evAttachHandlers();

  try {
    const resp = await fetch(`/api/dashboard?ts=${Date.now()}`, { cache: "no-store" });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Impossible de charger les donnees.");
    evState.rawData = data;
    await evRenderCharts();
  } catch (err) {
    ["ev-monthly-chart", "ev-activity-chart"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<div class="empty-state">${err.message}</div>`;
    });
    const loading = document.getElementById("ev-mannams-loading");
    if (loading) loading.textContent = err.message;
  }
}

document.addEventListener("DOMContentLoaded", evBootstrap);
