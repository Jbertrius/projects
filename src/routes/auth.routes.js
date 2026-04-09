const { Router } = require("express");
const {
  authenticateUser,
  canAssignRoles,
  canManageContent,
  canManageUsers,
  clearSessionCookie,
  hasAuthStoreConfig,
  setSessionCookie
} = require("../../lib/auth");
const { validate, required, isEmail } = require("../utils/validate");
const { rateLimit } = require("../middleware/rateLimit");
const { getCsrfToken } = require("../middleware/csrf");

const router = Router();

// 10 attempts per minute per IP before lockout
const loginRateLimit = rateLimit({ windowMs: 60_000, max: 10 });

function authCapabilities(user) {
  return {
    canManageContent: canManageContent(user),
    canManageUsers: canManageUsers(user),
    canAssignRoles: canAssignRoles(user)
  };
}

router.get("/session", (req, res) => {
  res.json({
    ok: true,
    authenticated: Boolean(req.sessionUser),
    authConfigured: hasAuthStoreConfig(),
    user: req.sessionUser,
    capabilities: authCapabilities(req.sessionUser),
    csrfToken: getCsrfToken(req.sessionUser)
  });
});

router.post("/login", loginRateLimit, async (req, res, next) => {
  try {
    if (!hasAuthStoreConfig()) {
      return res.status(500).json({
        ok: false,
        error: "La base d'authentification n'est pas configuree."
      });
    }

    const errors = validate(req.body, {
      email: [required(), isEmail()],
      password: [required()]
    });
    if (errors) {
      return res.status(400).json({ ok: false, error: errors[0], errors });
    }

    const { email, password } = req.body;
    const user = await authenticateUser(email, password);
    if (!user) {
      return res.status(401).json({ ok: false, error: "Email ou mot de passe invalide." });
    }

    setSessionCookie(res, req, user);
    res.json({ ok: true, user, capabilities: authCapabilities(user), csrfToken: getCsrfToken(user) });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", (req, res) => {
  clearSessionCookie(res, req);
  res.json({ ok: true });
});

module.exports = router;
