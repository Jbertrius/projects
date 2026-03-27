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
    "À relancer": "linear-gradient(90deg, #f0c25a, #b87b00)"
  };

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

async function loadDashboard() {
  const app = document.getElementById("app");

  try {
    const response = await fetch("/api/dashboard");
    const data = await response.json();

    app.innerHTML = document.getElementById("dashboard-template").innerHTML;

    document.getElementById("policy-name").textContent = data.meta.policyName;
    document.getElementById("period-label").textContent = data.meta.period;
    document.getElementById("refresh-label").textContent = data.meta.refreshLabel;
    document.getElementById("kpi-grid").innerHTML = data.kpis.map(createKpiCard).join("");
    document.getElementById("monthly-chart").innerHTML = createTrendChart(data.monthlyMeetings);
    document.getElementById("activity-chart").innerHTML = createActivityChart(data.members);
    document.getElementById("pipeline-list").innerHTML = createPipeline(data.pipeline);
    document.getElementById("members-table").innerHTML = createMembersRows(data.members);
    document.getElementById("formation-chart").innerHTML = createProgressChart(data.formationTimeline);
    document.getElementById("status-chart").innerHTML = createStatusChart(data.members);
  } catch (error) {
    app.innerHTML = `
      <section class="loading-state">
        Impossible de charger les donnees du dashboard.
      </section>
    `;
  }
}

loadDashboard();
