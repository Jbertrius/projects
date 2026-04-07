const { Router } = require("express");
const { requireUserManager, requireAdmin } = require("../middleware/auth");
const {
  canAssignRoles,
  canManageContent,
  canManageUsers,
  createUser,
  deleteUser,
  listUsers,
  ROLES,
  syncMembersToUsers,
  updateUser
} = require("../../lib/auth");
const { validate, required, isEmail, minLength, oneOf } = require("../utils/validate");

const router = Router();

function authCapabilities(user) {
  return {
    canManageContent: canManageContent(user),
    canManageUsers: canManageUsers(user),
    canAssignRoles: canAssignRoles(user)
  };
}

router.get("/", requireUserManager, async (req, res, next) => {
  try {
    const users = await listUsers();
    res.json({
      ok: true,
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        role: user.role,
        is_active: user.is_active,
        member_source_id: user.member_source_id || "",
        member_zone: user.member_zone || "",
        member_department_role: user.member_department_role || "",
        created_at: user.created_at,
        updated_at: user.updated_at,
        last_login_at: user.last_login_at
      })),
      currentUser: req.sessionUser,
      capabilities: authCapabilities(req.sessionUser)
    });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireUserManager, async (req, res, next) => {
  try {
    const errors = validate(req.body, {
      email: [required(), isEmail()],
      display_name: [required()],
      password: [required(), minLength(8)],
      role: [oneOf([ROLES.ADMIN, ROLES.GERANT, ROLES.MEMBRE])]
    });
    if (errors) {
      return res.status(400).json({ ok: false, error: errors[0], errors });
    }
    const user = await createUser(req.sessionUser, req.body);
    res.json({ ok: true, user });
  } catch (error) {
    error.status = 400;
    next(error);
  }
});

router.post("/import-members", requireAdmin, async (req, res, next) => {
  try {
    const result = await syncMembersToUsers(req.sessionUser);
    res.json({ ok: true, ...result });
  } catch (error) {
    error.status = 400;
    next(error);
  }
});

router.patch("/:userId", requireUserManager, async (req, res, next) => {
  try {
    const user = await updateUser(req.sessionUser, decodeURIComponent(req.params.userId), req.body);
    res.json({ ok: true, user });
  } catch (error) {
    error.status = 400;
    next(error);
  }
});

router.delete("/:userId", requireUserManager, async (req, res, next) => {
  try {
    const user = await deleteUser(req.sessionUser, decodeURIComponent(req.params.userId));
    res.json({ ok: true, user });
  } catch (error) {
    error.status = 400;
    next(error);
  }
});

module.exports = router;
