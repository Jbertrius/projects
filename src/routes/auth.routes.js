const { Router } = require("express");
const {
  authenticateUser,
  canAssignRoles,
  canManageContent,
  canManageUsers,
  changePassword,
  clearSessionCookie,
  deleteUserDocument,
  exportUserData,
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

// --- RGPD: Data export ---
router.get("/export", (req, res, next) => {
  if (!req.sessionUser) {
    return res.status(401).json({ ok: false, error: "Authentification requise." });
  }

  exportUserData(req.sessionUser.id)
    .then((data) => res.json({ ok: true, ...data }))
    .catch(next);
});

// --- RGPD: Account deletion request ---
router.post("/delete-account", (req, res, next) => {
  if (!req.sessionUser) {
    return res.status(401).json({ ok: false, error: "Authentification requise." });
  }

  deleteUserDocument(req.sessionUser.id)
    .then(() => {
      clearSessionCookie(res, req);
      res.json({ ok: true, message: "Compte supprimé. Vos données seront effacées sous 30 jours." });
    })
    .catch(next);
});

// --- Change password ---
router.post("/change-password", (req, res, next) => {
  if (!req.sessionUser) {
    return res.status(401).json({ ok: false, error: "Authentification requise." });
  }

  const errors = validate(req.body, {
    currentPassword: [required()],
    newPassword: [required()]
  });
  if (errors) {
    return res.status(400).json({ ok: false, error: errors[0], errors });
  }

  const { currentPassword, newPassword } = req.body;
  changePassword(req.sessionUser.id, currentPassword, newPassword)
    .then((user) => {
      clearSessionCookie(res, req);
      res.json({ ok: true, message: "Mot de passe modifié. Veuillez vous reconnecter.", user });
    })
    .catch((err) => {
      if (err.message.includes("incorrect") || err.message.includes("8 caractères")) {
        return res.status(400).json({ ok: false, error: err.message });
      }
      next(err);
    });
});

module.exports = router;
