const crypto = require("crypto");
const fs = require("fs");
const { fetchJson, getAccessToken, getEnv } = require("./google-auth");
const { hasFirestoreConfig, loadDashboardDataFromFirestore } = require("./firestore");
const { hasGoogleSheetsConfig, loadGoogleSheetsData } = require("./sheets");

const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
const USERS_COLLECTION = "appUsers";
const SESSION_COOKIE = "dmd_session";

const ROLES = {
  ADMIN: "admin",
  GERANT: "gerant",
  MEMBRE: "membre"
};

function hasAuthStoreConfig() {
  return Boolean(getEnv("FIRESTORE_PROJECT_ID"));
}

function getFirestoreBaseUrl() {
  const projectId = getEnv("FIRESTORE_PROJECT_ID");
  const databaseId = getEnv("FIRESTORE_DATABASE_ID", "(default)");

  if (!projectId) {
    throw new Error("Missing FIRESTORE_PROJECT_ID.");
  }

  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents`;
}

function stringValue(value) {
  return { stringValue: String(value ?? "") };
}

function booleanValue(value) {
  return { booleanValue: Boolean(value) };
}

function timestampValue(value) {
  return { timestampValue: new Date(value).toISOString() };
}

function firestoreValueToJs(value) {
  if (!value || typeof value !== "object") {
    return "";
  }
  if ("stringValue" in value) {
    return value.stringValue;
  }
  if ("booleanValue" in value) {
    return Boolean(value.booleanValue);
  }
  if ("timestampValue" in value) {
    return value.timestampValue;
  }
  return "";
}

function parseFirestoreDocument(doc) {
  const id = decodeURIComponent(String(doc.name || "").split("/").pop() || "");
  return { id, fields: doc.fields || {} };
}

function sanitizeUser(user) {
  if (!user) {
    return null;
  }
  return {
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
  };
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizePersonKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function userDocumentId(email) {
  return `user_${slugify(normalizeEmail(email))}`;
}

function buildMemberPlaceholderEmail(member) {
  const memberName = slugify(member.name || "membre") || "membre";
  const memberId = slugify(member.id || "x") || "x";
  return `member_${memberName}_${memberId}@dmd.local`;
}

function passwordSalt() {
  return crypto.randomBytes(16).toString("hex");
}

function temporaryPassword(length = 14) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password || ""), salt, 120000, 64, "sha512").toString("hex");
}

function verifyPassword(password, salt, expectedHash) {
  const actual = Buffer.from(hashPassword(password, salt), "hex");
  const expected = Buffer.from(String(expectedHash || ""), "hex");
  if (actual.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(actual, expected);
}

function readStableSecretMaterial() {
  const explicit = getEnv("APP_SESSION_SECRET");
  if (explicit) {
    return explicit;
  }

  const rawJson = getEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      return parsed.private_key || parsed.client_email || rawJson;
    } catch {
      return rawJson;
    }
  }

  const jsonPath = getEnv("GOOGLE_SERVICE_ACCOUNT_JSON_PATH");
  if (jsonPath && fs.existsSync(jsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      return parsed.private_key || parsed.client_email || jsonPath;
    } catch {
      return jsonPath;
    }
  }

  return getEnv("GOOGLE_PRIVATE_KEY") || getEnv("GOOGLE_CLIENT_EMAIL") || "dmd-fallback-secret";
}

function sessionSigningKey() {
  return crypto.createHash("sha256").update(readStableSecretMaterial()).digest();
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(value) {
  const padded = String(value)
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function signSessionPayload(payload) {
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", sessionSigningKey()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifySessionCookie(value) {
  if (!value || !String(value).includes(".")) {
    return null;
  }

  const [encoded, signature] = String(value).split(".");
  const expected = crypto.createHmac("sha256", sessionSigningKey()).update(encoded).digest("base64url");
  if (!signature || signature.length !== expected.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encoded));
    if (!payload.exp || Date.now() > Number(payload.exp)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || "";
  return cookieHeader.split(";").reduce((accumulator, part) => {
    const [key, ...rest] = part.trim().split("=");
    if (!key) {
      return accumulator;
    }
    accumulator[key] = decodeURIComponent(rest.join("="));
    return accumulator;
  }, {});
}

function buildSetCookie(value, { secure = false, expires } = {}) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax"
  ];

  if (secure) {
    parts.push("Secure");
  }

  if (expires) {
    parts.push(`Expires=${expires.toUTCString()}`);
  }

  return parts.join("; ");
}

function shouldUseSecureCookies(req) {
  return String(req.headers["x-forwarded-proto"] || "").includes("https") || getEnv("NODE_ENV") === "production";
}

function setSessionCookie(res, req, user) {
  const payload = {
    uid: user.id,
    exp: Date.now() + 1000 * 60 * 60 * 12
  };

  res.setHeader("Set-Cookie", buildSetCookie(signSessionPayload(payload), { secure: shouldUseSecureCookies(req) }));
}

function clearSessionCookie(res, req) {
  res.setHeader(
    "Set-Cookie",
    buildSetCookie("", {
      secure: shouldUseSecureCookies(req),
      expires: new Date(0)
    })
  );
}

async function writeUserDocument(user) {
  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();
  const document = {
    fields: {
      email: stringValue(user.email),
      displayName: stringValue(user.display_name),
      role: stringValue(user.role),
      isActive: booleanValue(user.is_active),
      memberSourceId: stringValue(user.member_source_id || ""),
      memberZone: stringValue(user.member_zone || ""),
      memberDepartmentRole: stringValue(user.member_department_role || ""),
      passwordSalt: stringValue(user.password_salt),
      passwordHash: stringValue(user.password_hash),
      createdAt: timestampValue(user.created_at),
      updatedAt: timestampValue(user.updated_at),
      lastLoginAt: user.last_login_at ? timestampValue(user.last_login_at) : stringValue("")
    }
  };

  return fetchJson(`${baseUrl}/${USERS_COLLECTION}/${encodeURIComponent(user.id)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(document)
  });
}

async function deleteUserDocument(userId) {
  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();
  const response = await fetch(`${baseUrl}/${USERS_COLLECTION}/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`HTTP ${response.status}: ${message}`);
  }
}

async function listUserDocuments() {
  const accessToken = await getAccessToken([FIRESTORE_SCOPE]);
  const baseUrl = getFirestoreBaseUrl();
  let result = { documents: [] };
  try {
    result = await fetchJson(`${baseUrl}/${USERS_COLLECTION}?pageSize=500`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
  } catch (error) {
    if (!String(error.message || "").startsWith("HTTP 404:")) {
      throw error;
    }
  }

  return (result.documents || []).map((doc) => {
    const parsed = parseFirestoreDocument(doc);
    return {
      id: parsed.id,
      email: firestoreValueToJs(parsed.fields.email),
      display_name: firestoreValueToJs(parsed.fields.displayName),
      role: firestoreValueToJs(parsed.fields.role) || ROLES.MEMBRE,
      is_active: Boolean(firestoreValueToJs(parsed.fields.isActive)),
      member_source_id: firestoreValueToJs(parsed.fields.memberSourceId),
      member_zone: firestoreValueToJs(parsed.fields.memberZone),
      member_department_role: firestoreValueToJs(parsed.fields.memberDepartmentRole),
      password_salt: firestoreValueToJs(parsed.fields.passwordSalt),
      password_hash: firestoreValueToJs(parsed.fields.passwordHash),
      created_at: firestoreValueToJs(parsed.fields.createdAt),
      updated_at: firestoreValueToJs(parsed.fields.updatedAt),
      last_login_at: firestoreValueToJs(parsed.fields.lastLoginAt)
    };
  });
}

async function ensureBootstrapAdmin() {
  if (!hasAuthStoreConfig()) {
    return;
  }

  const users = await listUserDocuments();
  if (users.length > 0) {
    return;
  }

  const email = normalizeEmail(getEnv("APP_INITIAL_ADMIN_EMAIL"));
  const password = getEnv("APP_INITIAL_ADMIN_PASSWORD");
  const displayName = getEnv("APP_INITIAL_ADMIN_NAME", "Administrateur");

  if (!email || !password) {
    return;
  }

  const now = new Date().toISOString();
  const salt = passwordSalt();
  const admin = {
    id: userDocumentId(email),
    email,
    display_name: displayName,
    role: ROLES.ADMIN,
    is_active: true,
    password_salt: salt,
    password_hash: hashPassword(password, salt),
    created_at: now,
    updated_at: now,
    last_login_at: ""
  };

  await writeUserDocument(admin);
}

async function getUserByEmail(email) {
  const users = await listUsers();
  return users.find((user) => user.email === normalizeEmail(email)) || null;
}

async function getUserById(userId) {
  const users = await listUsers();
  return users.find((user) => user.id === userId) || null;
}

async function listUsers() {
  await ensureBootstrapAdmin();
  return listUserDocuments();
}

async function authenticateUser(email, password) {
  const user = await getUserByEmail(email);
  if (!user || !user.is_active) {
    return null;
  }

  if (!verifyPassword(password, user.password_salt, user.password_hash)) {
    return null;
  }

  user.last_login_at = new Date().toISOString();
  user.updated_at = new Date().toISOString();
  await writeUserDocument(user);
  return sanitizeUser(user);
}

async function getSessionUserFromRequest(req) {
  const cookies = parseCookies(req);
  const payload = verifySessionCookie(cookies[SESSION_COOKIE]);
  if (!payload?.uid) {
    return null;
  }

  const user = await getUserById(String(payload.uid));
  if (!user || !user.is_active) {
    return null;
  }

  return sanitizeUser(user);
}

function roleRank(role) {
  if (role === ROLES.ADMIN) {
    return 3;
  }
  if (role === ROLES.GERANT) {
    return 2;
  }
  return 1;
}

function canManageContent(user) {
  return Boolean(user && roleRank(user.role) >= roleRank(ROLES.GERANT));
}

function canManageUsers(user) {
  return Boolean(user && roleRank(user.role) >= roleRank(ROLES.GERANT));
}

function canAssignRoles(user) {
  return Boolean(user && user.role === ROLES.ADMIN);
}

async function createUser(actor, input) {
  const email = normalizeEmail(input.email);
  const displayName = String(input.display_name || "").trim();
  const password = String(input.password || "");
  const requestedRole = String(input.role || ROLES.MEMBRE).trim().toLowerCase();

  if (!email || !displayName || !password) {
    throw new Error("Nom, email et mot de passe sont requis.");
  }

  if (!canManageUsers(actor)) {
    throw new Error("Acces refuse.");
  }

  const role = actor.role === ROLES.ADMIN ? requestedRole : ROLES.MEMBRE;
  if (![ROLES.ADMIN, ROLES.GERANT, ROLES.MEMBRE].includes(role)) {
    throw new Error("Role invalide.");
  }

  const existing = await getUserByEmail(email);
  if (existing) {
    throw new Error("Un utilisateur existe deja avec cet email.");
  }

  const now = new Date().toISOString();
  const salt = passwordSalt();
  const user = {
    id: userDocumentId(email),
    email,
    display_name: displayName,
    role,
    is_active: true,
    member_source_id: "",
    member_zone: "",
    member_department_role: "",
    password_salt: salt,
    password_hash: hashPassword(password, salt),
    created_at: now,
    updated_at: now,
    last_login_at: ""
  };

  await writeUserDocument(user);
  return sanitizeUser(user);
}

async function updateUser(actor, userId, input) {
  const existing = await getUserById(userId);
  if (!existing) {
    throw new Error("Utilisateur introuvable.");
  }

  if (!canManageUsers(actor)) {
    throw new Error("Acces refuse.");
  }

  if (actor.role === ROLES.GERANT && existing.role !== ROLES.MEMBRE) {
    throw new Error("Un gerant ne peut modifier qu'un membre.");
  }

  const updated = { ...existing };
  let generatedTemporaryPassword = "";
  if (input.display_name !== undefined) {
    updated.display_name = String(input.display_name || "").trim() || existing.display_name;
  }
  if (input.email !== undefined) {
    updated.email = normalizeEmail(input.email) || existing.email;
  }
  if (input.is_active !== undefined) {
    updated.is_active = Boolean(input.is_active);
  }

  if (actor.id === existing.id && updated.is_active === false) {
    throw new Error("Impossible de desactiver ton propre acces.");
  }

  if (actor.role === ROLES.ADMIN && input.role) {
    const nextRole = String(input.role).trim().toLowerCase();
    if (![ROLES.ADMIN, ROLES.GERANT, ROLES.MEMBRE].includes(nextRole)) {
      throw new Error("Role invalide.");
    }
    if (actor.id === existing.id && nextRole !== ROLES.ADMIN) {
      throw new Error("Impossible de retirer ton propre role admin.");
    }
    if (existing.role === ROLES.ADMIN && nextRole !== ROLES.ADMIN) {
      const otherAdmins = (await listUsers()).filter((user) => user.role === ROLES.ADMIN && user.id !== existing.id);
      if (!otherAdmins.length) {
        throw new Error("Impossible de retirer le role du dernier admin.");
      }
    }
    updated.role = nextRole;
  }

  if (input.password) {
    const salt = passwordSalt();
    updated.password_salt = salt;
    updated.password_hash = hashPassword(input.password, salt);
  }

  if (input.generate_temp_password) {
    generatedTemporaryPassword = temporaryPassword();
    const salt = passwordSalt();
    updated.password_salt = salt;
    updated.password_hash = hashPassword(generatedTemporaryPassword, salt);
  }

  const nextId = userDocumentId(updated.email);
  updated.id = nextId;
  updated.updated_at = new Date().toISOString();

  if (nextId !== existing.id) {
    const collision = await getUserByEmail(updated.email);
    if (collision && collision.id !== existing.id) {
      throw new Error("Cet email est deja utilise.");
    }
  }

  await writeUserDocument(updated);
  if (nextId !== existing.id) {
    try {
      await deleteUserDocument(existing.id);
    } catch {
      // Keep duplicate cleanup best-effort.
    }
  }

  return {
    ...sanitizeUser(updated),
    temporary_password: generatedTemporaryPassword
  };
}

async function deleteUser(actor, userId) {
  const existing = await getUserById(userId);
  if (!existing) {
    throw new Error("Utilisateur introuvable.");
  }

  if (!canManageUsers(actor)) {
    throw new Error("Acces refuse.");
  }

  if (actor.role === ROLES.GERANT && existing.role !== ROLES.MEMBRE) {
    throw new Error("Un gerant ne peut supprimer qu'un membre.");
  }

  if (actor.id === existing.id) {
    throw new Error("Impossible de supprimer ton propre acces.");
  }

  if (existing.role === ROLES.ADMIN) {
    const admins = (await listUsers()).filter((user) => user.role === ROLES.ADMIN && user.id !== existing.id);
    if (!admins.length) {
      throw new Error("Impossible de supprimer le dernier admin.");
    }
  }

  await deleteUserDocument(existing.id);
  return sanitizeUser(existing);
}

async function loadDepartmentMembers() {
  if (hasFirestoreConfig()) {
    const data = await loadDashboardDataFromFirestore();
    return data.members || [];
  }

  if (hasGoogleSheetsConfig()) {
    const data = await loadGoogleSheetsData();
    return data.members || [];
  }

  throw new Error("Aucune source membres n'est configuree.");
}

async function syncMembersToUsers(actor) {
  if (!actor || actor.role !== ROLES.ADMIN) {
    throw new Error("Seul un admin peut importer les membres.");
  }

  const [users, members] = await Promise.all([listUsers(), loadDepartmentMembers()]);
  const bySourceId = new Map();
  const byName = new Map();

  users.forEach((user) => {
    if (user.member_source_id) {
      bySourceId.set(String(user.member_source_id), user);
    }

    const key = normalizePersonKey(user.display_name);
    if (!key) {
      return;
    }
    const bucket = byName.get(key) || [];
    bucket.push(user);
    byName.set(key, bucket);
  });

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const member of members) {
    const memberId = String(member.id || "").trim();
    const displayName = String(member.name || "").trim();

    if (!memberId || !displayName) {
      skipped += 1;
      continue;
    }

    const normalizedName = normalizePersonKey(displayName);
    let existing = bySourceId.get(memberId) || null;
    if (!existing && normalizedName) {
      const matches = byName.get(normalizedName) || [];
      if (matches.length === 1) {
        existing = matches[0];
      }
    }

    if (existing) {
      const nextUser = {
        ...existing,
        member_source_id: memberId,
        member_zone: String(member.zone || "").trim(),
        member_department_role: String(member.department_role || "").trim(),
        updated_at: new Date().toISOString()
      };
      await writeUserDocument(nextUser);
      bySourceId.set(memberId, nextUser);
      updated += 1;
      continue;
    }

    const now = new Date().toISOString();
    const salt = passwordSalt();
    const email = buildMemberPlaceholderEmail(member);
    const newUser = {
      id: userDocumentId(email),
      email,
      display_name: displayName,
      role: ROLES.MEMBRE,
      is_active: false,
      member_source_id: memberId,
      member_zone: String(member.zone || "").trim(),
      member_department_role: String(member.department_role || "").trim(),
      password_salt: salt,
      password_hash: hashPassword(crypto.randomBytes(24).toString("base64url"), salt),
      created_at: now,
      updated_at: now,
      last_login_at: ""
    };

    await writeUserDocument(newUser);
    bySourceId.set(memberId, newUser);
    const bucket = byName.get(normalizedName) || [];
    bucket.push(newUser);
    byName.set(normalizedName, bucket);
    created += 1;
  }

  return {
    members: members.length,
    created,
    updated,
    skipped
  };
}

module.exports = {
  ROLES,
  SESSION_COOKIE,
  authenticateUser,
  canAssignRoles,
  canManageContent,
  canManageUsers,
  clearSessionCookie,
  createUser,
  deleteUser,
  getSessionUserFromRequest,
  hasAuthStoreConfig,
  listUsers,
  sanitizeUser,
  setSessionCookie,
  syncMembersToUsers,
  updateUser
};
