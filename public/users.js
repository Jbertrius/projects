const usersState = {
  users: [],
  currentUser: null,
  capabilities: {
    canAssignRoles: false
  },
  selectedId: "",
  filters: {
    search: "",
    status: "all",
    role: "all",
    completion: "all"
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
  }, 5000);
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("fr-FR", {
        dateStyle: "medium",
        timeStyle: "short"
      });
}

function selectedUser() {
  return usersState.users.find((user) => user.id === usersState.selectedId) || null;
}

function roleLabel(role) {
  if (role === "admin") {
    return "Admin";
  }
  if (role === "gerant") {
    return "Gerant";
  }
  return "Membre";
}

function canEditRole(targetRole) {
  return usersState.capabilities.canAssignRoles || targetRole === "membre";
}

function isIncompleteUser(user) {
  return !user.is_active || !user.email || user.email.endsWith("@dmd.local");
}

function filteredUsers() {
  const { search, status, role, completion } = usersState.filters;
  const searchValue = String(search || "").trim().toLowerCase();

  return usersState.users.filter((user) => {
    if (status === "active" && !user.is_active) {
      return false;
    }
    if (status === "inactive" && user.is_active) {
      return false;
    }
    if (role !== "all" && user.role !== role) {
      return false;
    }
    if (completion === "missing" && !isIncompleteUser(user)) {
      return false;
    }
    if (completion === "ready" && isIncompleteUser(user)) {
      return false;
    }
    if (!searchValue) {
      return true;
    }

    return [
      user.display_name,
      user.email,
      user.member_zone,
      user.member_department_role,
      user.role
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(searchValue));
  });
}

function setBusyState(element, isBusy, idleLabel, busyLabel) {
  if (!element) {
    return;
  }
  element.disabled = isBusy;
  if (busyLabel) {
    element.textContent = isBusy ? busyLabel : idleLabel;
  }
}

function renderUsersTable() {
  const tbody = document.getElementById("users-table");
  const summary = document.getElementById("users-summary");
  const roleHint = document.getElementById("users-role-hint");
  const importButton = document.getElementById("users-import-members");
  const rows = filteredUsers();
  const activeCount = usersState.users.filter((user) => user.is_active).length;
  const incompleteCount = usersState.users.filter((user) => isIncompleteUser(user)).length;

  summary.textContent = `${rows.length} affiches / ${usersState.users.length} utilisateurs`;
  roleHint.textContent = usersState.capabilities.canAssignRoles
    ? `${activeCount} actifs, ${incompleteCount} a completer.`
    : "Tu peux gerer les acces des membres.";
  if (importButton) {
    importButton.hidden = !usersState.capabilities.canAssignRoles;
  }

  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-table">Aucun utilisateur pour ces filtres.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rows
    .map(
      (user) => `
        <tr>
          <td>
            <strong>${user.display_name}</strong>
            <div class="table-subline">${user.member_department_role || "Membre du departement"}</div>
          </td>
          <td>${user.email}</td>
          <td>${user.member_zone || "-"}</td>
          <td>${roleLabel(user.role)}</td>
          <td><span class="status-pill ${user.is_active ? "" : "status-pill-warning"}">${user.is_active ? "Actif" : "Inactif"}</span></td>
          <td>${formatDate(user.last_login_at)}</td>
          <td>
            <div class="user-row-actions">
              <button class="secondary-action compact-action" type="button" data-select-user="${user.id}">Editer</button>
              <button class="secondary-action compact-action" type="button" data-quick-activate="${user.id}">
                ${user.is_active ? "Desactiver" : "Activer"}
              </button>
              <button class="secondary-action compact-action" type="button" data-temp-password="${user.id}">Code provisoire</button>
            </div>
          </td>
        </tr>
      `
    )
    .join("");

  tbody.querySelectorAll("[data-select-user]").forEach((button) => {
    button.addEventListener("click", () => {
      usersState.selectedId = button.dataset.selectUser;
      renderEditor();
    });
  });

  tbody.querySelectorAll("[data-quick-activate]").forEach((button) => {
    button.addEventListener("click", () => {
      quickToggleActive(button.dataset.quickActivate).catch((error) => showFeedback(error.message, "error"));
    });
  });

  tbody.querySelectorAll("[data-temp-password]").forEach((button) => {
    button.addEventListener("click", () => {
      generateTemporaryPassword(button.dataset.tempPassword).catch((error) => showFeedback(error.message, "error"));
    });
  });
}

function syncRoleOptions() {
  const createRole = document.getElementById("create-role");
  const editRole = document.getElementById("edit-role");
  if (!createRole || !editRole) {
    return;
  }

  const allowedCreateRoles = usersState.capabilities.canAssignRoles
    ? ["membre", "gerant", "admin"]
    : ["membre"];

  createRole.innerHTML = allowedCreateRoles.map((role) => `<option value="${role}">${roleLabel(role)}</option>`).join("");
  if (!allowedCreateRoles.includes(createRole.value)) {
    createRole.value = allowedCreateRoles[0];
  }
}

function renderEditor() {
  const user = selectedUser();
  const title = document.getElementById("user-editor-title");
  const role = document.getElementById("user-editor-role");
  const help = document.getElementById("user-editor-help");
  const saveButton = document.getElementById("save-user-button");
  const deleteButton = document.getElementById("delete-user-button");
  const activateButton = document.getElementById("activate-member-button");
  const tempButton = document.getElementById("generate-temp-password");

  if (!user) {
    title.textContent = "Selectionner un utilisateur";
    role.textContent = "-";
    if (help) {
      help.textContent = "Selectionne un utilisateur pour modifier ses acces.";
    }
    document.getElementById("user-edit-form").reset();
    document.getElementById("edit-user-id").value = "";
    document.getElementById("edit-member-zone").value = "";
    document.getElementById("edit-member-role").value = "";
    [saveButton, deleteButton, activateButton, tempButton].forEach((button) => {
      if (button) {
        button.disabled = true;
      }
    });
    return;
  }

  title.textContent = user.display_name;
  role.textContent = `${roleLabel(user.role)} - ${user.is_active ? "actif" : "inactif"}`;
  document.getElementById("edit-user-id").value = user.id;
  document.getElementById("edit-display-name").value = user.display_name || "";
  document.getElementById("edit-email").value = user.email || "";
  document.getElementById("edit-member-zone").value = user.member_zone || "";
  document.getElementById("edit-member-role").value = user.member_department_role || "";
  document.getElementById("edit-role").value = user.role || "membre";
  document.getElementById("edit-password").value = "";
  document.getElementById("edit-active").checked = Boolean(user.is_active);

  const canChangeRole = canEditRole(user.role);
  document.getElementById("edit-display-name").disabled = !canChangeRole;
  document.getElementById("edit-email").disabled = !canChangeRole;
  document.getElementById("edit-password").disabled = !canChangeRole;
  document.getElementById("edit-active").disabled = !canChangeRole;
  document.getElementById("edit-role").disabled = !usersState.capabilities.canAssignRoles || !canChangeRole;

  [saveButton, deleteButton, activateButton, tempButton].forEach((button) => {
    if (button) {
      button.disabled = !canChangeRole;
    }
  });

  if (activateButton) {
    activateButton.textContent = user.is_active ? "Desactiver et enregistrer" : "Activer et enregistrer";
  }

  if (help) {
    help.textContent = canChangeRole
      ? "Tu peux ajuster le role, activer l'acces et generer un mot de passe provisoire."
      : "Ce compte ne peut pas etre modifie avec ton niveau d'acces.";
  }
}

async function loadUsers() {
  const response = await fetch(`/api/users?ts=${Date.now()}`, {
    cache: "no-store",
    credentials: "same-origin"
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || "Impossible de charger les utilisateurs.");
  }

  usersState.users = payload.users || [];
  usersState.currentUser = payload.currentUser || null;
  usersState.capabilities = payload.capabilities || { canAssignRoles: false };
  if (!usersState.selectedId && usersState.users.length) {
    usersState.selectedId = usersState.users[0].id;
  }
  if (!usersState.users.some((user) => user.id === usersState.selectedId)) {
    usersState.selectedId = usersState.users[0]?.id || "";
  }

  syncRoleOptions();
  renderUsersTable();
  renderEditor();
}

async function createUser(event) {
  event.preventDefault();
  const response = await fetch("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      display_name: document.getElementById("create-display-name").value,
      email: document.getElementById("create-email").value,
      password: document.getElementById("create-password").value,
      role: document.getElementById("create-role").value
    })
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || "Creation impossible.");
  }

  document.getElementById("user-create-form").reset();
  syncRoleOptions();
  showFeedback("Utilisateur ajoute.", "success");
  await loadUsers();
}

async function updateUserRequest(userId, body) {
  const response = await fetch(`/api/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || "Mise a jour impossible.");
  }
  return payload.user;
}

async function saveUser(event) {
  event.preventDefault();
  const userId = document.getElementById("edit-user-id").value;
  if (!userId) {
    showFeedback("Selectionne d'abord un utilisateur.", "warning");
    return;
  }

  await updateUserRequest(userId, {
    display_name: document.getElementById("edit-display-name").value,
    email: document.getElementById("edit-email").value,
    role: document.getElementById("edit-role").value,
    password: document.getElementById("edit-password").value,
    is_active: document.getElementById("edit-active").checked
  });

  showFeedback("Utilisateur mis a jour.", "success");
  await loadUsers();
}

async function quickToggleActive(userId) {
  const user = usersState.users.find((item) => item.id === userId);
  if (!user) {
    return;
  }

  await updateUserRequest(userId, {
    is_active: !user.is_active,
    role: user.role
  });

  showFeedback(
    !user.is_active ? `${user.display_name} est maintenant actif.` : `${user.display_name} est maintenant inactif.`,
    "success"
  );
  await loadUsers();
}

async function quickActivateSelected() {
  const user = selectedUser();
  if (!user) {
    showFeedback("Selectionne d'abord un utilisateur.", "warning");
    return;
  }

  await updateUserRequest(user.id, {
    display_name: document.getElementById("edit-display-name").value,
    email: document.getElementById("edit-email").value,
    role: document.getElementById("edit-role").value,
    is_active: !user.is_active
  });

  showFeedback(
    !user.is_active ? "Acces active et informations enregistrees." : "Acces desactive et informations enregistrees.",
    "success"
  );
  await loadUsers();
}

async function generateTemporaryPassword(userId = document.getElementById("edit-user-id")?.value) {
  if (!userId) {
    showFeedback("Selectionne d'abord un utilisateur.", "warning");
    return;
  }

  const user = await updateUserRequest(userId, {
    generate_temp_password: true
  });

  if (user?.temporary_password) {
    try {
      await navigator.clipboard.writeText(user.temporary_password);
      showFeedback(`Mot de passe temporaire genere et copie: ${user.temporary_password}`, "success");
    } catch {
      showFeedback(`Mot de passe temporaire: ${user.temporary_password}`, "success");
    }
  } else {
    showFeedback("Mot de passe temporaire genere.", "success");
  }

  await loadUsers();
}

async function removeUser() {
  const user = selectedUser();
  if (!user) {
    showFeedback("Selectionne d'abord un utilisateur.", "warning");
    return;
  }

  const confirmed = window.confirm(`Supprimer l'acces de ${user.display_name} ?`);
  if (!confirmed) {
    return;
  }

  const response = await fetch(`/api/users/${encodeURIComponent(user.id)}`, {
    method: "DELETE",
    credentials: "same-origin"
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || "Suppression impossible.");
  }

  usersState.selectedId = "";
  showFeedback("Acces utilisateur supprime.", "success");
  await loadUsers();
}

async function importMembers() {
  const button = document.getElementById("users-import-members");
  setBusyState(button, true, "Importer les membres", "Import en cours...");

  try {
    const response = await fetch("/api/users/import-members", {
      method: "POST",
      credentials: "same-origin"
    });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "Import impossible.");
    }

    showFeedback(
      `${payload.created} comptes crees, ${payload.updated} mis a jour, ${payload.skipped} ignores.`,
      "success"
    );
    await loadUsers();
  } finally {
    setBusyState(button, false, "Importer les membres", "Import en cours...");
  }
}

function applyFiltersFromInputs() {
  usersState.filters.search = document.getElementById("users-search")?.value || "";
  usersState.filters.status = document.getElementById("users-status-filter")?.value || "all";
  usersState.filters.role = document.getElementById("users-role-filter")?.value || "all";
  usersState.filters.completion = document.getElementById("users-completion-filter")?.value || "all";
  renderUsersTable();
}

function attachFilterHandlers() {
  ["users-search", "users-status-filter", "users-role-filter", "users-completion-filter"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", applyFiltersFromInputs);
    document.getElementById(id)?.addEventListener("change", applyFiltersFromInputs);
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

async function boot() {
  await window.AppAuth.requireAuth();
  attachNavigationHandlers();
  attachFilterHandlers();

  document.getElementById("user-create-form")?.addEventListener("submit", (event) => {
    createUser(event).catch((error) => showFeedback(error.message, "error"));
  });
  document.getElementById("user-edit-form")?.addEventListener("submit", (event) => {
    saveUser(event).catch((error) => showFeedback(error.message, "error"));
  });
  document.getElementById("delete-user-button")?.addEventListener("click", () => {
    removeUser().catch((error) => showFeedback(error.message, "error"));
  });
  document.getElementById("users-refresh")?.addEventListener("click", () => {
    loadUsers()
      .then(() => showFeedback("Liste utilisateurs actualisee.", "success"))
      .catch((error) => showFeedback(error.message, "error"));
  });
  document.getElementById("users-import-members")?.addEventListener("click", () => {
    importMembers().catch((error) => showFeedback(error.message, "error"));
  });
  document.getElementById("generate-temp-password")?.addEventListener("click", () => {
    generateTemporaryPassword().catch((error) => showFeedback(error.message, "error"));
  });
  document.getElementById("activate-member-button")?.addEventListener("click", () => {
    quickActivateSelected().catch((error) => showFeedback(error.message, "error"));
  });

  await loadUsers();
}

boot().catch((error) => showFeedback(error.message, "error"));
