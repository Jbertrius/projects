function createKpiCard(kpi) {
  return `
    <article class="card kpi-card">
      <p class="section-label">${kpi.label}</p>
      <div class="kpi-value">${kpi.value}</div>
      <div class="kpi-delta tone-${kpi.tone}">${kpi.delta}</div>
    </article>
  `;
}

function createBarChart(items) {
  const max = Math.max(...items.map((item) => item.value), 1);

  return items
    .map((item) => {
      const height = Math.round((item.value / max) * 100);
      return `
        <div class="bar-col">
          <div class="bar-value">${item.value}</div>
          <div class="bar-track">
            <div class="bar-fill" style="height: ${height}%"></div>
          </div>
          <div>${item.month}</div>
        </div>
      `;
    })
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

function createFormationChart(items) {
  const max = Math.max(...items.map((item) => Math.max(item.attendance, item.completed)), 1);

  return items
    .map(
      (item) => `
        <div class="line-row">
          <strong>${item.week}</strong>
          <div class="line-track">
            <div class="line-attendance" style="width: ${(item.attendance / max) * 100}%"></div>
            <div class="line-completed" style="width: ${(item.completed / max) * 100}%"></div>
          </div>
          <span>${item.attendance} présents / ${item.completed} validés</span>
        </div>
      `
    )
    .join("");
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
    document.getElementById("monthly-chart").innerHTML = createBarChart(data.monthlyMeetings);
    document.getElementById("pipeline-list").innerHTML = createPipeline(data.pipeline);
    document.getElementById("members-table").innerHTML = createMembersRows(data.members);
    document.getElementById("formation-chart").innerHTML = createFormationChart(data.formationTimeline);
  } catch (error) {
    app.innerHTML = `
      <section class="loading-state">
        Impossible de charger les données du dashboard.
      </section>
    `;
  }
}

loadDashboard();
