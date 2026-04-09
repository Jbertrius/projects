const { getSessionUserFromRequest, canManageContent, canManageUsers, canAssignRoles, ROLES } = require("../../lib/auth");

async function sessionAuth(req, res, next) {
  try {
    req.sessionUser = await getSessionUserFromRequest(req);
  } catch {
    req.sessionUser = null;
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.sessionUser) {
    return res.status(401).json({ ok: false, error: "Authentification requise." });
  }
  next();
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.sessionUser) {
      return res.status(401).json({ ok: false, error: "Authentification requise." });
    }
    if (!allowedRoles.includes(req.sessionUser.role)) {
      return res.status(403).json({ ok: false, error: "Acces refuse." });
    }
    next();
  };
}

function requireContentManager(req, res, next) {
  if (!req.sessionUser) {
    return res.status(401).json({ ok: false, error: "Authentification requise." });
  }
  if (!canManageContent(req.sessionUser)) {
    return res.status(403).json({ ok: false, error: "Acces refuse." });
  }
  next();
}

function requireUserManager(req, res, next) {
  if (!req.sessionUser) {
    return res.status(401).json({ ok: false, error: "Authentification requise." });
  }
  if (!canManageUsers(req.sessionUser)) {
    return res.status(403).json({ ok: false, error: "Acces refuse." });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.sessionUser) {
    return res.status(401).json({ ok: false, error: "Authentification requise." });
  }
  if (req.sessionUser.role !== ROLES.ADMIN) {
    return res.status(403).json({ ok: false, error: "Acces refuse." });
  }
  next();
}

module.exports = {
  sessionAuth,
  requireAuth,
  requireRole,
  requireContentManager,
  requireUserManager,
  requireAdmin
};
