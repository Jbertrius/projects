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
  }, 4500);
}

async function submitLogin(event) {
  event.preventDefault();

  const button = document.getElementById("login-submit");
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;

  button.disabled = true;
  button.textContent = "Connexion...";

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email, password })
    });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "Connexion impossible.");
    }

    window.location.href = "/";
  } catch (error) {
    showFeedback(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Se connecter";
  }
}

async function bootLogin() {
  const session = await window.AppAuth.getSession();
  if (session?.authenticated) {
    window.location.href = "/";
    return;
  }

  document.getElementById("login-form")?.addEventListener("submit", (event) => {
    submitLogin(event).catch((error) => showFeedback(error.message, "error"));
  });
}

bootLogin().catch((error) => showFeedback(error.message, "error"));
