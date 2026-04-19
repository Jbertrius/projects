(function attachShellPage() {
  function wireCollapsibleMenus() {
    document.querySelectorAll("[data-nav-toggle]").forEach((toggle) => {
      const targetId = toggle.getAttribute("aria-controls");
      if (!targetId) return;
      const submenu = document.getElementById(targetId);
      if (!submenu) return;

      const expanded = toggle.getAttribute("aria-expanded") !== "false";
      submenu.hidden = !expanded;

      toggle.addEventListener("click", () => {
        const nextExpanded = toggle.getAttribute("aria-expanded") === "false";
        toggle.setAttribute("aria-expanded", nextExpanded ? "true" : "false");
        submenu.hidden = !nextExpanded;
      });
    });
  }

  function wireSectionNavigation() {
    document.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-target]");
      if (!trigger) {
        return;
      }

      const sectionId = trigger.getAttribute("data-target");
      if (!sectionId) {
        return;
      }

      const section = document.getElementById(sectionId);
      if (!section) {
        return;
      }

      event.preventDefault();
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function wireMobileMenu() {
    const toggle = document.querySelector(".mobile-menu-toggle");
    const sidebar = document.querySelector(".sidebar");
    const overlay = document.querySelector(".sidebar-overlay");
    if (!toggle || !sidebar) return;

    function openMenu() {
      sidebar.classList.add("is-open");
      if (overlay) {
        overlay.classList.add("is-open");
      }
      toggle.setAttribute("aria-expanded", "true");
      toggle.textContent = "close";
      document.body.style.overflow = "hidden";
    }

    function closeMenu() {
      sidebar.classList.remove("is-open");
      if (overlay) {
        overlay.classList.remove("is-open");
      }
      toggle.setAttribute("aria-expanded", "false");
      toggle.textContent = "menu";
      document.body.style.overflow = "";
    }

    toggle.addEventListener("click", () => {
      if (sidebar.classList.contains("is-open")) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    if (overlay) {
      overlay.addEventListener("click", closeMenu);
    }

    // Close on nav link click
    sidebar.querySelectorAll(".nav-link, .nav-item").forEach((link) => {
      link.addEventListener("click", () => {
        if (link.hasAttribute("data-nav-toggle")) {
          return;
        }
        if (window.innerWidth <= 1200) {
          closeMenu();
        }
      });
    });

    // Close on ESC
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && sidebar.classList.contains("is-open")) {
        closeMenu();
      }
    });
  }

  async function bootstrap() {
    if (window.AppAuth?.requireAuth) {
      await window.AppAuth.requireAuth();
    }
    wireCollapsibleMenus();
    wireSectionNavigation();
    wireMobileMenu();
  }

  document.addEventListener("DOMContentLoaded", () => {
    bootstrap().catch(() => {
      window.location.href = "/login.html";
    });
  });
})();
