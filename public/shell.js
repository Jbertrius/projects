(function attachShellPage() {
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

  async function bootstrap() {
    if (window.AppAuth?.requireAuth) {
      await window.AppAuth.requireAuth();
    }
    wireSectionNavigation();
  }

  document.addEventListener("DOMContentLoaded", () => {
    bootstrap().catch(() => {
      window.location.href = "/login.html";
    });
  });
})();
