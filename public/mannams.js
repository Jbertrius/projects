// ─────────────────────────────────────────────────────────────────────────────
// mannams.js — Mannam meeting management page
// ─────────────────────────────────────────────────────────────────────────────

const mannamState = {
  meetings: [],      // all meetings from API
  members: [],       // full member directory
  pastors: [],       // full pastor directory (for cooperation validations)
  filtered: [],      // meetings after filter
  selectedId: "",
  isSaving: false,
  filters: {
    search: "",
    match: "all",
    coop: "all",
    sort: "action",
    dateFrom: "",
    dateTo: ""
  }
};

// ─── Utilities ───────────────────────────────────────────────────────────────

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

function formatDate(isoDate) {
  if (!isoDate) return "—";
  const d = new Date(isoDate + "T12:00:00");
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

function getInitials(name) {
  return String(name || "Pasteur inconnu")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "PI";
}

function getMeetingLeadIcon(meeting) {
  const status = meeting.member_match_status || "unmatched";
  const map = {
    exact: "verified",
    fuzzy: "manage_search",
    partial: "rule",
    unmatched: "priority_high",
    manual: "edit_square"
  };
  return map[status] || "event_note";
}

function getMeetingRecencyLabel(isoDate) {
  if (!isoDate) return "Date non precisee";
  const now = new Date();
  const meetingDate = new Date(`${String(isoDate).slice(0, 10)}T12:00:00`);
  const diffDays = Math.round((now - meetingDate) / (1000 * 60 * 60 * 24));

  if (Number.isNaN(diffDays)) return "Date non precisee";
  if (diffDays <= 1) return "Tres recent";
  if (diffDays <= 7) return "Cette semaine";
  if (diffDays <= 30) return "Ce mois-ci";
  return "Archive active";
}

function getMeetingSourceLabel(source) {
  const map = {
    calendar: "Agenda",
    sheet: "Feuille",
    sheets: "Feuille",
    firestore: "Firestore",
    manual: "Saisie manuelle"
  };
  return map[String(source || "").toLowerCase()] || source || "Source inconnue";
}

function hasAcademyClassConfigured(pastor) {
  if (!pastor) return false;
  return Boolean(String(pastor.academy_class || "").trim());
}

function findPastorForMeeting(meeting) {
  const pastorName = normalizeText(meeting?.pastor_name || "");
  if (!pastorName) return null;

  return mannamState.pastors.find((pastor) => {
    const direct = normalizeText(pastor.name || "");
    if (direct && direct === pastorName) return true;

    const aliases = String(pastor.aliases || "")
      .split(/[|,;]/)
      .map((a) => normalizeText(a))
      .filter(Boolean);

    return aliases.includes(pastorName);
  }) || null;
}

function getMeetingTimestamp(isoDate) {
  if (!isoDate) return 0;
  return Date.parse(`${String(isoDate).slice(0, 10)}T12:00:00`) || 0;
}

function getUrgencyScore(meeting) {
  const matchStatus = meeting.member_match_status || "unmatched";
  const coopStatus = meeting.cooperation_status || "none";
  const unresolvedCount = (meeting.unmatchedSuggestions || []).length;
  const hasFollowUp = Boolean(String(meeting.follow_up_note || "").trim());

  let score = 0;

  if (matchStatus === "unmatched") score += 70;
  else if (matchStatus === "partial") score += 56;
  else if (matchStatus === "fuzzy") score += 38;
  else if (matchStatus === "exact") score += 14;
  else if (matchStatus === "manual") score += 10;

  if (coopStatus === "none") score += 14;
  else if (coopStatus === "interested") score += 24;
  else if (coopStatus === "agreed") score += 18;
  else if (coopStatus === "enrolled") score += 12;
  else if (coopStatus === "church") score += 8;
  else if (coopStatus === "joined") score -= 8;

  score += Math.min(unresolvedCount * 8, 24);
  if (!hasFollowUp) score += 10;

  const timestamp = getMeetingTimestamp(meeting.meeting_date);
  if (timestamp > 0) {
    const ageDays = Math.max(0, Math.round((Date.now() - timestamp) / (1000 * 60 * 60 * 24)));
    if (ageDays <= 7) score += 15;
    else if (ageDays <= 30) score += 9;
    else score += 3;
  }

  if ((matchStatus === "exact" || matchStatus === "manual") && coopStatus === "joined" && unresolvedCount === 0 && hasFollowUp) {
    score -= 20;
  }

  return Math.max(score, 0);
}

function getPriorityTier(score) {
  if (score >= 95) return "critical";
  if (score >= 62) return "attention";
  return "stable";
}

function getPriorityLabel(tier) {
  const map = {
    critical: "Urgent",
    attention: "Attention",
    stable: "Stable"
  };
  return map[tier] || "Stable";
}

// ─── Match status helpers ─────────────────────────────────────────────────────

function matchBadgeClass(status) {
  const map = { exact: "badge-exact", fuzzy: "badge-fuzzy", partial: "badge-partial", unmatched: "badge-unmatched", manual: "badge-manual" };
  return map[status] || "badge-unmatched";
}

function matchBadgeLabel(status) {
  const map = { exact: "Exact", fuzzy: "Flou", partial: "Partiel", unmatched: "Non résolu", manual: "Corrigé" };
  return map[status] || status || "—";
}

function coopBadgeClass(status) {
  const map = {
    none: "badge-coop-none",
    interested: "badge-coop-interested",
    agreed: "badge-coop-agreed",
    enrolled: "badge-coop-enrolled",
    church: "badge-coop-church",
    joined: "badge-coop-joined"
  };
  return map[status] || "badge-coop-none";
}

function coopBadgeLabel(status) {
  const map = {
    none: "",
    interested: "Interesse",
    agreed: "Accord",
    enrolled: "Inscrit",
    church: "A l'eglise",
    joined: "Integre"
  };
  return map[status] || "";
}

// ─── Filter & count ───────────────────────────────────────────────────────────

function applyFilters() {
  const { search, match, coop, sort, dateFrom, dateTo } = mannamState.filters;
  const q = normalizeText(search);

  mannamState.filtered = mannamState.meetings.filter((m) => {
    if (q) {
      const hay = normalizeText(
        [m.pastor_name, m.event_summary, m.event_description,
         ...(m.resolvedMembers || []).map((r) => r.name),
         m.member_name_raw].join(" ")
      );
      if (!hay.includes(q)) return false;
    }
    if (match !== "all" && String(m.member_match_status || "unmatched") !== match) return false;
    if (coop !== "all" && String(m.cooperation_status || "none") !== coop) return false;
    const d = String(m.meeting_date || "").slice(0, 10);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  });

  const sortMode = sort || "action";
  mannamState.filtered.sort((a, b) => {
    if (sortMode === "newest") {
      return getMeetingTimestamp(b.meeting_date) - getMeetingTimestamp(a.meeting_date);
    }

    if (sortMode === "oldest") {
      return getMeetingTimestamp(a.meeting_date) - getMeetingTimestamp(b.meeting_date);
    }

    if (sortMode === "pastor") {
      return String(a.pastor_name || "").localeCompare(String(b.pastor_name || ""), "fr");
    }

    const scoreDiff = getUrgencyScore(b) - getUrgencyScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return getMeetingTimestamp(b.meeting_date) - getMeetingTimestamp(a.meeting_date);
  });
}

// ─── Render list ──────────────────────────────────────────────────────────────

function renderList() {
  const container = document.getElementById("mannams-list");
  const countEl = document.getElementById("list-count");
  if (!container) return;

  if (!mannamState.filtered.length) {
    container.innerHTML = `<div class="detail-empty"><span class="material-symbols-rounded" style="font-size:2rem">search_off</span>Aucune rencontre pour ces filtres.</div>`;
    countEl.textContent = "0 rencontre";
    return;
  }

  countEl.textContent = `${mannamState.filtered.length} rencontre${mannamState.filtered.length > 1 ? "s" : ""}`;

  container.innerHTML = mannamState.filtered.map((m) => {
    const matchStatus = m.member_match_status || "unmatched";
    const coopStatus = m.cooperation_status || "none";
    const resolvedMembers = m.resolvedMembers || [];
    const memberNames = resolvedMembers.map((r) => r.name).join(", ")
      || m.member_names_canonical
      || m.member_name_raw
      || "—";
    const coopLabel = coopBadgeLabel(coopStatus);
    const memberCount = resolvedMembers.length || (m.member_names_canonical?.length || 0);
    const unmatchedCount = (m.unmatchedSuggestions || []).length;
    const sourceLabel = getMeetingSourceLabel(m.source);
    const recencyLabel = getMeetingRecencyLabel(m.meeting_date);
    const leadIcon = getMeetingLeadIcon(m);
    const followUpLabel = m.follow_up_note ? "Suivi note" : "Sans note";
    const urgencyScore = getUrgencyScore(m);
    const priorityTier = getPriorityTier(urgencyScore);
    const priorityLabel = getPriorityLabel(priorityTier);

    return `
      <div class="mannam-row is-priority-${priorityTier}${String(m.id) === String(mannamState.selectedId) ? " is-selected" : ""}" data-id="${m.id}">
        <div class="mannam-row-top">
          <div class="mannam-row-identity">
            <span class="mannam-avatar" aria-hidden="true">${getInitials(m.pastor_name)}</span>
            <div class="mannam-row-primary">
              <div class="mannam-row-head">
                <span class="mannam-row-pastor">${m.pastor_name || "Pasteur inconnu"}</span>
                <span class="mannam-row-date">${formatDate(m.meeting_date)}</span>
              </div>
              <div class="mannam-row-summary">${m.event_summary || "—"}</div>
              <div class="mannam-row-members"><strong>Membres</strong> ${memberNames}</div>
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
            <span class="mannam-priority-pill is-${priorityTier}">${priorityLabel}</span>
            <span class="mannam-row-symbol" aria-hidden="true"><span class="material-symbols-rounded">${leadIcon}</span></span>
          </div>
        </div>
        <div class="mannam-row-context">
          <span class="mannam-context-pill"><span class="material-symbols-rounded" aria-hidden="true">local_fire_department</span>Score ${urgencyScore}</span>
          <span class="mannam-context-pill"><span class="material-symbols-rounded" aria-hidden="true">groups</span>${memberCount || 0} membre${memberCount > 1 ? "s" : ""}</span>
          <span class="mannam-context-pill"><span class="material-symbols-rounded" aria-hidden="true">schedule</span>${recencyLabel}</span>
          <span class="mannam-context-pill"><span class="material-symbols-rounded" aria-hidden="true">lan</span>${sourceLabel}</span>
          <span class="mannam-context-pill"><span class="material-symbols-rounded" aria-hidden="true">note_stack</span>${followUpLabel}</span>
          ${unmatchedCount ? `<span class="mannam-context-pill"><span class="material-symbols-rounded" aria-hidden="true">person_search</span>${unmatchedCount} a verifier</span>` : ""}
        </div>
        <div class="mannam-row-badges">
          <span class="badge ${matchBadgeClass(matchStatus)}">${matchBadgeLabel(matchStatus)}</span>
          ${coopLabel ? `<span class="badge ${coopBadgeClass(coopStatus)}">${coopLabel}</span>` : ""}
        </div>
      </div>`;
  }).join("");

  container.querySelectorAll(".mannam-row").forEach((row) => {
    row.addEventListener("click", () => {
      mannamState.selectedId = row.dataset.id;
      renderList();
      renderDetail();
    });
  });
}

// ─── Render detail panel ──────────────────────────────────────────────────────

function renderDetail() {
  const meeting = mannamState.meetings.find((m) => String(m.id) === String(mannamState.selectedId));
  const emptyEl = document.getElementById("detail-empty");
  const contentEl = document.getElementById("detail-content");
  if (!emptyEl || !contentEl) return;

  if (!meeting) {
    emptyEl.hidden = false;
    contentEl.hidden = true;
    return;
  }

  emptyEl.hidden = true;
  contentEl.hidden = false;

  // Basic fields
  document.getElementById("d-date").textContent = formatDate(meeting.meeting_date);
  document.getElementById("d-pastor").textContent = meeting.pastor_name || "—";

  const pastorLink = document.getElementById("d-pastor-link");
  const btnCreateStub = document.getElementById("btn-create-pastor-stub");
  const pastorExists = Boolean(meeting.pastor_name && findPastorForMeeting(meeting));

  if (pastorLink) {
    const query = encodeURIComponent(meeting.pastor_name || "");
    pastorLink.href = query ? `/pastors.html?search=${query}` : "/pastors.html";
    pastorLink.hidden = !pastorExists;
  }
  if (btnCreateStub) {
    btnCreateStub.hidden = !meeting.pastor_name || pastorExists;
  }
  document.getElementById("d-summary").textContent = meeting.event_summary || "—";
  const desc = meeting.event_description || "";
  const descEl = document.getElementById("d-description");
  descEl.textContent = desc || "Aucune description";
  descEl.className = `detail-value${desc ? "" : " muted"}`;
  document.getElementById("d-source").textContent = meeting.source || "—";

  // Match badge
  const matchStatus = meeting.member_match_status || "unmatched";
  const badgeEl = document.getElementById("d-match-badge");
  badgeEl.textContent = matchBadgeLabel(matchStatus);
  badgeEl.className = `badge ${matchBadgeClass(matchStatus)}`;

  // Resolved members
  const chipsEl = document.getElementById("d-members");
  const resolved = meeting.resolvedMembers || [];
  chipsEl.innerHTML = resolved.length
    ? resolved.map((r) => `<span class="member-chip">${r.name}<span class="muted" style="font-size:0.72rem">${r.zone || ""}</span></span>`).join("")
    : `<span class="muted" style="font-size:0.85rem">Aucun membre résolu</span>`;

  // Participants correction
  const correctionArea = document.getElementById("correction-area");
  const participantsSelect = document.getElementById("participants-select");
  const unmatched = meeting.unmatchedSuggestions || [];
  const historySummary = document.getElementById("history-member-summary");

  if (participantsSelect) {
    const suggestedIds = unmatched.map((item) => item.candidates?.[0]?.id).filter(Boolean);
    const preselectedIds = new Set([
      ...(meeting.resolvedMembers || []).map((r) => String(r.id)),
      ...suggestedIds.map((id) => String(id))
    ]);

    participantsSelect.innerHTML = mannamState.members.map((member) => {
      const selected = preselectedIds.has(String(member.id)) ? " selected" : "";
      return `<option value="${member.id}"${selected}>${member.name}</option>`;
    }).join("");
  }

  // Always keep participant correction visible once a meeting is selected.
  // Previously it was hidden when both unmatched and resolved arrays were empty.
  correctionArea.hidden = false;

  if (historySummary) {
    historySummary.textContent = resolved.length
      ? `Participants resolus: ${resolved.map((r) => r.name).join(", ")}`
      : "Aucun participant resolu pour cette rencontre.";
  }

  // Cooperation
  document.getElementById("coop-select").value = meeting.cooperation_status || "none";
  document.getElementById("follow-up-note").value = meeting.follow_up_note || "";
}

// ─── Member history ───────────────────────────────────────────────────────────

// ─── Stats ────────────────────────────────────────────────────────────────────

function renderStats() {
  const all = mannamState.meetings;
  const total = all.length;
  const needsFix = all.filter((m) => ["unmatched", "partial"].includes(m.member_match_status || "unmatched")).length;
  const towardCoop = all.filter((m) => ["interested", "agreed", "enrolled", "church"].includes(m.cooperation_status || "none")).length;
  const joined = all.filter((m) => m.cooperation_status === "joined").length;
  const exactPct = total ? Math.round(all.filter((m) => ["exact", "manual"].includes(m.member_match_status || "")).length / total * 100) : 0;

  setText("stat-total", total);
  setText("stat-unmatched", needsFix);
  setText("stat-coop", towardCoop);
  setText("stat-joined", joined);
  setText("hero-quality-title", `${exactPct}% resolus`);

  const sidebarStats = document.getElementById("sidebar-stats");
  if (sidebarStats) {
    sidebarStats.innerHTML = `
      <span>${total} rencontres</span>
      <span style="color:#991b1b">${needsFix} à corriger</span>
      <span style="color:#166534">${joined} intégrés</span>`;
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ─── API calls ────────────────────────────────────────────────────────────────

async function loadData() {
  const [meetResp, memberResp, pastorResp] = await Promise.all([
    fetch(`/api/meetings?ts=${Date.now()}`, { cache: "no-store" }),
    fetch(`/api/meetings/members?ts=${Date.now()}`, { cache: "no-store" }),
    fetch(`/api/pastors?ts=${Date.now()}`, { cache: "no-store" })
  ]);

  if (!meetResp.ok) throw new Error("Impossible de charger les rencontres.");
  if (!memberResp.ok) throw new Error("Impossible de charger les membres.");
  if (!pastorResp.ok) throw new Error("Impossible de charger les fiches pasteurs.");

  const meetData = await meetResp.json();
  const memberData = await memberResp.json();
  const pastorData = await pastorResp.json();

  mannamState.meetings = meetData.meetings || [];
  mannamState.members = (memberData.members || []).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  mannamState.pastors = pastorData.pastors || [];
}

async function saveMemberCorrection() {
  const meeting = mannamState.meetings.find((m) => String(m.id) === String(mannamState.selectedId));
  if (!meeting) return;

  const participantsSelect = document.getElementById("participants-select");
  const selectedOptions = participantsSelect ? [...participantsSelect.selectedOptions] : [];
  const newMemberIds = selectedOptions.map((opt) => String(opt.value));
  const newMemberNames = selectedOptions.map((opt) => String(opt.textContent || "").trim());
  const remainingUnmatched = newMemberIds.length ? [] : (meeting.unmatchedSuggestions || []).map((u) => u.rawName);
  const newMatchStatus = newMemberIds.length ? "manual" : (meeting.member_match_status || "unmatched");

  mannamState.isSaving = true;
  setSavingState(true);
  try {
    const resp = await fetch(`/api/meetings/${encodeURIComponent(meeting.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        member_ids: newMemberIds,
        member_names_canonical: newMemberNames,
        member_match_status: newMatchStatus,
        member_unmatched_names: remainingUnmatched
      })
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || "Erreur lors de la correction.");

    showFeedback("Correction enregistrée.", "success");
    await loadData();
    applyFilters();
    renderList();
    renderDetail();
    renderStats();
  } catch (err) {
    showFeedback(err.message, "error");
  } finally {
    mannamState.isSaving = false;
    setSavingState(false);
  }
}

async function saveCooperation() {
  const meeting = mannamState.meetings.find((m) => m.id === mannamState.selectedId);
  if (!meeting) return;

  const coopStatus = document.getElementById("coop-select").value;
  const followUpNote = document.getElementById("follow-up-note").value.trim();

  if (coopStatus === "enrolled") {
    const pastor = findPastorForMeeting(meeting);
    if (!hasAcademyClassConfigured(pastor)) {
      showFeedback("Impossible de passer a 'Inscrit (academie)' tant que la fiche pasteur n'a pas de classe renseignee.", "error");
      return;
    }
  }

  mannamState.isSaving = true;
  setSavingState(true);
  try {
    const resp = await fetch(`/api/meetings/${encodeURIComponent(meeting.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cooperation_status: coopStatus, follow_up_note: followUpNote })
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || "Erreur lors de l'enregistrement.");

    // Update local state without full reload
    meeting.cooperation_status = coopStatus;
    meeting.follow_up_note = followUpNote;

    applyFilters();
    renderList();
    renderStats();
    showFeedback("Suivi coopération enregistré.", "success");
  } catch (err) {
    showFeedback(err.message, "error");
  } finally {
    mannamState.isSaving = false;
    setSavingState(false);
  }
}

async function createPastorStub() {
  const meeting = mannamState.meetings.find((m) => String(m.id) === String(mannamState.selectedId));
  if (!meeting?.pastor_name) return;

  const btn = document.getElementById("btn-create-pastor-stub");
  if (btn) { btn.disabled = true; btn.textContent = "Création…"; }

  try {
    const resp = await fetch("/api/pastors/stub", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: meeting.pastor_name, date: meeting.meeting_date || "" })
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || "Erreur lors de la création.");

    if (data.created) {
      showFeedback("Fiche pasteur créée. Vous pouvez maintenant la compléter.", "success");
    } else {
      showFeedback("La fiche pasteur existe déjà.", "info");
    }

    // Refresh pastor list so the link appears
    const pastorResp = await fetch(`/api/pastors?ts=${Date.now()}`, { cache: "no-store" });
    const pastorData = await pastorResp.json();
    mannamState.pastors = pastorData.pastors || [];
    renderDetail();
  } catch (err) {
    showFeedback(err.message, "error");
    if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true" style="font-size:1rem">person_add</span> Créer la fiche pasteur'; }
  }
}

async function deleteMeeting() {
  const meeting = mannamState.meetings.find((m) => String(m.id) === String(mannamState.selectedId));
  if (!meeting) return;

  const label = meeting.pastor_name || meeting.event_summary || meeting.id;
  if (!confirm(`Supprimer définitivement la rencontre avec "${label}" ?\n\nCette action supprime aussi l'événement Google Calendar.`)) return;

  const btn = document.getElementById("btn-delete-meeting");
  if (btn) { btn.disabled = true; btn.textContent = "Suppression…"; }

  try {
    const resp = await fetch(`/api/meetings/${encodeURIComponent(meeting.id)}`, { method: "DELETE" });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) throw new Error(data.error || "Erreur lors de la suppression.");

    showFeedback("Rencontre supprimée.", "success");
    mannamState.selectedId = "";
    await loadData();
    applyFilters();
    renderList();
    renderDetail();
    renderStats();
  } catch (err) {
    showFeedback(err.message, "error");
    if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-symbols-rounded" style="font-size:1rem">delete</span> Supprimer cette rencontre'; }
  }
}

function setSavingState(saving) {
  ["btn-save-members", "btn-save-coop"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) { el.disabled = saving; el.textContent = saving ? "Enregistrement…" : (id === "btn-save-coop" ? "Enregistrer le suivi" : "Enregistrer les participants"); }
  });
}

// ─── Event wiring ─────────────────────────────────────────────────────────────

function attachHandlers() {
  document.getElementById("search-input")?.addEventListener("input", (e) => {
    mannamState.filters.search = e.target.value;
    applyFilters(); renderList();
  });

  document.getElementById("filter-match")?.addEventListener("change", (e) => {
    mannamState.filters.match = e.target.value;
    applyFilters(); renderList();
  });

  document.getElementById("filter-coop")?.addEventListener("change", (e) => {
    mannamState.filters.coop = e.target.value;
    applyFilters(); renderList();
  });

  document.getElementById("filter-date-from")?.addEventListener("change", (e) => {
    mannamState.filters.dateFrom = e.target.value;
    applyFilters(); renderList();
  });

  document.getElementById("filter-date-to")?.addEventListener("change", (e) => {
    mannamState.filters.dateTo = e.target.value;
    applyFilters(); renderList();
  });

  document.getElementById("filter-sort")?.addEventListener("change", (e) => {
    mannamState.filters.sort = e.target.value;
    applyFilters(); renderList();
  });

  document.getElementById("btn-reset-filters")?.addEventListener("click", () => {
    mannamState.filters = { search: "", match: "all", coop: "all", sort: "action", dateFrom: "", dateTo: "" };
    document.getElementById("search-input").value = "";
    document.getElementById("filter-match").value = "all";
    document.getElementById("filter-coop").value = "all";
    document.getElementById("filter-sort").value = "action";
    document.getElementById("filter-date-from").value = "";
    document.getElementById("filter-date-to").value = "";
    applyFilters(); renderList();
  });

  document.getElementById("btn-refresh")?.addEventListener("click", async () => {
    try {
      await loadData();
      applyFilters(); renderList(); renderDetail(); renderStats();
      showFeedback("Données actualisées.", "success");
    } catch (err) {
      showFeedback(err.message, "error");
    }
  });

  document.getElementById("btn-save-members")?.addEventListener("click", saveMemberCorrection);
  document.getElementById("btn-save-coop")?.addEventListener("click", saveCooperation);
  document.getElementById("btn-create-pastor-stub")?.addEventListener("click", createPastorStub);
  document.getElementById("btn-delete-meeting")?.addEventListener("click", deleteMeeting);
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap() {
  if (window.AppAuth?.requireAuth) {
    await window.AppAuth.requireAuth();
  }

  const session = await window.AppAuth.getSession();
  if (session?.capabilities?.canManageUsers) {
    document.querySelectorAll("[data-manage-users-link]").forEach((el) => { el.hidden = false; });
  }
  if (session?.capabilities?.canManageContent) {
    const deleteSection = document.getElementById("section-delete-meeting");
    if (deleteSection) deleteSection.hidden = false;
  }

  attachHandlers();

  try {
    await loadData();
    applyFilters();
    renderList();
    renderStats();
  } catch (err) {
    showFeedback(err.message, "error");
    document.getElementById("mannams-list").innerHTML =
      `<div class="detail-empty"><span class="material-symbols-rounded" style="font-size:2rem">error</span>${err.message}</div>`;
  }
}

document.addEventListener("DOMContentLoaded", bootstrap);
