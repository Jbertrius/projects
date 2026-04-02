(function attachAuthClient() {
  let sessionCache = null;

  async function loadSession(force = false) {
    if (!force && sessionCache) {
      return sessionCache;
    }

    const response = await fetch(`/api/auth/session?ts=${Date.now()}`, {
      cache: "no-store",
      credentials: "same-origin"
    });
    const payload = await response.json();
    sessionCache = payload;
    return payload;
  }

  function hydrateShell(sessionPayload) {
    const user = sessionPayload?.user || null;
    document.querySelectorAll("[data-auth-user]").forEach((element) => {
      element.textContent = user?.display_name || "Utilisateur";
    });
    document.querySelectorAll("[data-auth-role]").forEach((element) => {
      element.textContent = user?.role ? `Role: ${user.role}` : "Non connecte";
    });
    document.querySelectorAll("[data-manage-users-link]").forEach((element) => {
      element.hidden = !sessionPayload?.capabilities?.canManageUsers;
    });
  }

  async function requireAuth() {
    const payload = await loadSession(true);
    if (!payload?.authenticated) {
      window.location.href = "/login.html";
      throw new Error("Session requise.");
    }
    hydrateShell(payload);
    return payload;
  }

  async function logout() {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin"
    });
    sessionCache = null;
    window.location.href = "/login.html";
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-logout]");
    if (!target) {
      return;
    }
    event.preventDefault();
    logout().catch(() => {
      window.location.href = "/login.html";
    });
  });

  window.AppAuth = {
    getSession: () => loadSession(),
    requireAuth,
    hydrateShell,
    logout
  };
})();
