const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadLocalEnv } = require("./lib/env");
const {
  ROLES,
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
  setSessionCookie,
  syncMembersToUsers,
  updateUser
} = require("./lib/auth");
const { buildDashboard } = require("./lib/dashboard");
const {
  hasGoogleSheetsConfig,
  loadGoogleSheetsData,
  getGoogleSheetsConfigSummary
} = require("./lib/sheets");
const {
  buildFirestoreDocuments,
  createAcademyLessonRecord,
  getFirestoreConfigSummary,
  hasFirestoreConfig,
  loadAcademyDataFromFirestore,
  loadDashboardDataFromFirestore,
  loadPastorsFromFirestore,
  replaceAcademyLessonRecord,
  syncAcademySheetToFirestore,
  syncSheetsToFirestore,
  testFirestoreConnection,
  updatePastorInFirestore
} = require("./lib/firestore");
const { normalizeIsoDate, parseAttendanceBlock } = require("./lib/academy-parser");
const {
  listAccessibleCalendars,
  listCalendarEvents,
  syncCalendarToMeetingsSheet
} = require("./lib/calendar");
const { loadPastorsSheet, updatePastorRecord } = require("./lib/pastors");

loadLocalEnv();

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_FILE = path.join(__dirname, "data", "dashboard.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": MIME_TYPES[".json"],
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendRedirect(res, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store"
  });
  res.end();
}

function readLocalDashboard() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(res, 500, { error: "Unable to read file." });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(content);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });

    req.on("error", reject);
  });
}

function normalizeLookupValue(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function splitList(value, separators = /[|,;]/) {
  return String(value || "")
    .split(separators)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildPastorMemberContext(pastors, meetings, members) {
  const pastorsById = new Map();
  const pastorsByName = new Map();
  const officialMembers = new Map();

  (members || []).forEach((member) => {
    const canonicalName = String(member.name || "").trim();
    if (!canonicalName) {
      return;
    }

    const lookupValues = new Set([canonicalName, ...splitList(member.aliases, /[|;,]/)]);
    lookupValues.forEach((value) => {
      const normalized = normalizeLookupValue(value);
      if (normalized) {
        officialMembers.set(normalized, canonicalName);
      }
    });
  });

  pastors.forEach((pastor) => {
    const pastorId = String(pastor.id || "").trim();
    const lookupValues = new Set([
      pastor.name,
      ...splitList(pastor.aliases, /[|;,]/),
      ...splitList(pastor.source_variants, /\|/)
    ]);

    if (pastorId) {
      pastorsById.set(pastorId, pastor);
    }

    lookupValues.forEach((value) => {
      const normalized = normalizeLookupValue(value);
      if (normalized) {
        pastorsByName.set(normalized, pastor);
      }
    });
  });

  const memberOptions = new Set();
  const membersByPastorId = new Map();

  meetings.forEach((meeting) => {
    const meetingMembers = splitList(meeting.member_names_canonical || meeting.member_name || "", /[,;|]/)
      .map((name) => officialMembers.get(normalizeLookupValue(name.trim())) || "")
      .filter(Boolean);
    const uniqueMeetingMembers = Array.from(new Set(meetingMembers));

    if (!uniqueMeetingMembers.length) {
      return;
    }

    let pastor = null;
    const pastorId = String(meeting.pastor_id || "").trim();
    if (pastorId && pastorsById.has(pastorId)) {
      pastor = pastorsById.get(pastorId);
    }

    if (!pastor) {
      const pastorName = normalizeLookupValue(meeting.pastor_name || meeting.pastor_name_raw || "");
      pastor = pastorsByName.get(pastorName) || null;
    }

    if (!pastor) {
      return;
    }

    const bucket = membersByPastorId.get(pastor.id) || new Set();
    uniqueMeetingMembers.forEach((memberName) => {
      bucket.add(memberName);
      memberOptions.add(memberName);
    });
    membersByPastorId.set(pastor.id, bucket);
  });

  return {
    pastors: pastors.map((pastor) => ({
      ...pastor,
      member_names: Array.from(membersByPastorId.get(pastor.id) || []).sort((a, b) => a.localeCompare(b, "fr"))
    })),
    memberOptions: Array.from(memberOptions).sort((a, b) => a.localeCompare(b, "fr"))
  };
}

function authCapabilities(user) {
  return {
    canManageContent: canManageContent(user),
    canManageUsers: canManageUsers(user),
    canAssignRoles: canAssignRoles(user)
  };
}

async function handleApi(req, res) {
  const pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
  const sessionUser = await getSessionUserFromRequest(req);

  const sendUnauthorized = (message = "Authentification requise.") =>
    sendJson(res, 401, { ok: false, error: message });
  const sendForbidden = (message = "Acces refuse.") =>
    sendJson(res, 403, { ok: false, error: message });

  if (pathname === "/api/auth/session" && req.method === "GET") {
    sendJson(res, 200, {
      ok: true,
      authenticated: Boolean(sessionUser),
      authConfigured: hasAuthStoreConfig(),
      user: sessionUser,
      capabilities: authCapabilities(sessionUser)
    });
    return;
  }

  if (pathname === "/api/auth/login" && req.method === "POST") {
    try {
      if (!hasAuthStoreConfig()) {
        sendJson(res, 500, {
          ok: false,
          error: "La base d'authentification n'est pas configuree."
        });
        return;
      }

      const payload = await readJsonBody(req);
      const user = await authenticateUser(payload.email, payload.password);
      if (!user) {
        sendUnauthorized("Email ou mot de passe invalide.");
        return;
      }

      setSessionCookie(res, req, user);
      sendJson(res, 200, {
        ok: true,
        user,
        capabilities: authCapabilities(user)
      });
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error.message
      });
    }
    return;
  }

  if (pathname === "/api/auth/logout" && req.method === "POST") {
    clearSessionCookie(res, req);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === "/api/users" && req.method === "GET") {
    if (!sessionUser) {
      sendUnauthorized();
      return;
    }
    if (!canManageUsers(sessionUser)) {
      sendForbidden();
      return;
    }

    try {
      const users = await listUsers();
      sendJson(res, 200, {
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
        currentUser: sessionUser,
        capabilities: authCapabilities(sessionUser)
      });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/users" && req.method === "POST") {
    if (!sessionUser) {
      sendUnauthorized();
      return;
    }
    if (!canManageUsers(sessionUser)) {
      sendForbidden();
      return;
    }

    try {
      const payload = await readJsonBody(req);
      const user = await createUser(sessionUser, payload);
      sendJson(res, 200, { ok: true, user });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/users/import-members" && req.method === "POST") {
    if (!sessionUser) {
      sendUnauthorized();
      return;
    }
    if (sessionUser.role !== ROLES.ADMIN) {
      sendForbidden();
      return;
    }

    try {
      const result = await syncMembersToUsers(sessionUser);
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch && req.method === "PATCH") {
    if (!sessionUser) {
      sendUnauthorized();
      return;
    }
    if (!canManageUsers(sessionUser)) {
      sendForbidden();
      return;
    }

    try {
      const payload = await readJsonBody(req);
      const user = await updateUser(sessionUser, decodeURIComponent(userMatch[1]), payload);
      sendJson(res, 200, { ok: true, user });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (userMatch && req.method === "DELETE") {
    if (!sessionUser) {
      sendUnauthorized();
      return;
    }
    if (!canManageUsers(sessionUser)) {
      sendForbidden();
      return;
    }

    try {
      const user = await deleteUser(sessionUser, decodeURIComponent(userMatch[1]));
      sendJson(res, 200, { ok: true, user });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (!sessionUser) {
    sendUnauthorized();
    return;
  }

  if (pathname === "/api/pastors" && req.method === "GET") {
    try {
      const source = hasFirestoreConfig() ? "firestore" : "sheets";
      const [pastors, dataSource] = hasFirestoreConfig()
        ? await Promise.all([loadPastorsFromFirestore(), loadDashboardDataFromFirestore()])
        : await Promise.all([loadPastorsSheet(), loadGoogleSheetsData()]);
      const context = buildPastorMemberContext(pastors, dataSource.meetings || [], dataSource.members || []);
      sendJson(res, 200, {
        ok: true,
        source,
        pastors: context.pastors,
        memberOptions: context.memberOptions
      });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/pastors/update" && req.method === "POST") {
    if (!canManageContent(sessionUser)) {
      sendForbidden();
      return;
    }
    try {
      const payload = await readJsonBody(req);
      const pastor = hasFirestoreConfig() ? await updatePastorInFirestore(payload) : await updatePastorRecord(payload);
      sendJson(res, 200, {
        ok: true,
        source: hasFirestoreConfig() ? "firestore" : "sheets",
        pastor
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/connection-status") {
    if (sessionUser.role !== ROLES.ADMIN) {
      sendForbidden();
      return;
    }
    sendJson(res, 200, {
      googleSheetsConfigured: hasGoogleSheetsConfig(),
      firestoreConfigured: hasFirestoreConfig(),
      config: {
        sheets: getGoogleSheetsConfigSummary(),
        firestore: getFirestoreConfigSummary()
      }
    });
    return;
  }

  if (pathname === "/api/academy" && req.method === "GET") {
    try {
      if (!hasFirestoreConfig()) {
        sendJson(res, 200, {
          ok: true,
          classes: [],
          students: [],
          attendance: [],
          meta: { refreshLabel: "Aucune base academie connectee" }
        });
        return;
      }

      const academyData = await loadAcademyDataFromFirestore();
      sendJson(res, 200, {
        ok: true,
        ...academyData,
        meta: { refreshLabel: "Donnees academie synchronisees" }
      });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/test/google-sheets") {
    if (sessionUser.role !== ROLES.ADMIN) {
      sendForbidden();
      return;
    }
    try {
      if (!hasGoogleSheetsConfig()) {
        sendJson(res, 400, {
          ok: false,
          error: "Google Sheets is not configured.",
          config: getGoogleSheetsConfigSummary()
        });
        return;
      }

      const sheetsData = await loadGoogleSheetsData();
      sendJson(res, 200, {
        ok: true,
        config: getGoogleSheetsConfigSummary(),
        counts: {
          members: sheetsData.members.length,
          meetings: sheetsData.meetings.length,
          trainingSessions: sheetsData.trainingSessions.length
        },
        sample: {
          member: sheetsData.members[0] || null,
          meeting: sheetsData.meetings[0] || null,
          trainingSession: sheetsData.trainingSessions[0] || null
        }
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error.message,
        config: getGoogleSheetsConfigSummary()
      });
    }
    return;
  }

  if (pathname === "/api/test/google-calendar") {
    if (sessionUser.role !== ROLES.ADMIN) {
      sendForbidden();
      return;
    }
    try {
      const payload = await listCalendarEvents();
      sendJson(res, 200, {
        ok: true,
        calendarId: payload.calendarId,
        count: payload.items.length,
        sample: payload.items[0] || null
      });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/test/google-calendar-list") {
    if (sessionUser.role !== ROLES.ADMIN) {
      sendForbidden();
      return;
    }
    try {
      const calendars = await listAccessibleCalendars();
      sendJson(res, 200, { ok: true, calendars });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/sync/calendar-to-sheets") {
    if (!canManageContent(sessionUser)) {
      sendForbidden();
      return;
    }
    try {
      const result = await syncCalendarToMeetingsSheet();
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/sync/full" && req.method === "GET") {
    if (!canManageContent(sessionUser)) {
      sendForbidden();
      return;
    }
    let calendarResult = null;

    try {
      calendarResult = await syncCalendarToMeetingsSheet();
      const firestoreResult = await syncSheetsToFirestore();
      sendJson(res, 200, {
        ok: true,
        steps: {
          calendarToSheets: calendarResult,
          sheetsToFirestore: firestoreResult
        }
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error.message,
        steps: { calendarToSheets: calendarResult }
      });
    }
    return;
  }

  if (pathname === "/api/test/firestore") {
    if (sessionUser.role !== ROLES.ADMIN) {
      sendForbidden();
      return;
    }
    try {
      if (!hasFirestoreConfig()) {
        sendJson(res, 400, {
          ok: false,
          error: "Firestore is not configured.",
          config: getFirestoreConfigSummary()
        });
        return;
      }

      const result = await testFirestoreConnection();
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error.message,
        config: getFirestoreConfigSummary()
      });
    }
    return;
  }

  if (pathname === "/api/preview/firestore") {
    if (sessionUser.role !== ROLES.ADMIN) {
      sendForbidden();
      return;
    }
    try {
      const sheetsData = await loadGoogleSheetsData();
      const preview = await buildFirestoreDocuments(sheetsData);
      sendJson(res, 200, {
        ok: true,
        config: getFirestoreConfigSummary(),
        counts: {
          members: preview.members.length,
          meetings: preview.meetings.length,
          trainingSessions: preview.trainingSessions.length
        },
        sample: {
          member: preview.members[0] || null,
          meeting: preview.meetings[0] || null,
          trainingSession: preview.trainingSessions[0] || null
        }
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error.message,
        config: getFirestoreConfigSummary()
      });
    }
    return;
  }

  if (pathname === "/api/sync/firestore") {
    if (!canManageContent(sessionUser)) {
      sendForbidden();
      return;
    }
    try {
      const result = await syncSheetsToFirestore();
      sendJson(res, 200, {
        ok: true,
        config: getFirestoreConfigSummary(),
        ...result
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error.message,
        config: getFirestoreConfigSummary()
      });
    }
    return;
  }

  if (pathname === "/api/academy/record-lesson" && req.method === "POST") {
    if (!canManageContent(sessionUser)) {
      sendForbidden();
      return;
    }
    try {
      if (!hasFirestoreConfig()) {
        sendJson(res, 400, {
          ok: false,
          error: "La base academie n'est pas configuree."
        });
        return;
      }

      const payload = await readJsonBody(req);
      const parsed = parseAttendanceBlock(String(payload.rawText || "").trim(), normalizeIsoDate(payload.lessonDate || ""));
      const issues = [];
      if (!parsed.class_code) issues.push("La ligne de classe est requise.");
      if (!parsed.lesson_title) issues.push("Le titre de la lecon est requis.");
      if (!parsed.teacher_name) issues.push("Le nom de l'instructeur est requis.");
      if (!parsed.registered_students.length) issues.push("Au moins un etudiant inscrit doit etre detecte.");

      if (issues.length) {
        sendJson(res, 400, {
          ok: false,
          error: "Validation impossible.",
          issues,
          parsed
        });
        return;
      }

      const result = payload.replaceExisting
        ? await replaceAcademyLessonRecord(parsed)
        : await createAcademyLessonRecord(parsed);
      sendJson(res, 200, { ok: true, parsed, result });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/sync/academy-sheet") {
    if (!canManageContent(sessionUser)) {
      sendForbidden();
      return;
    }
    try {
      const result = await syncAcademySheetToFirestore();
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname !== "/api/dashboard") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  try {
    if (hasFirestoreConfig()) {
      sendJson(res, 200, buildDashboard(await loadDashboardDataFromFirestore()));
      return;
    }

    if (hasGoogleSheetsConfig()) {
      sendJson(res, 200, buildDashboard(await loadGoogleSheetsData()));
      return;
    }

    sendJson(res, 200, readLocalDashboard());
  } catch (error) {
    sendJson(res, 500, {
      error: "Unable to load dashboard data.",
      details: error.message
    });
  }
}

async function handleStatic(req, res) {
  const pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const isHtmlPage = requestedPath === "/index.html" || requestedPath.endsWith(".html");
  const sessionUser = isHtmlPage ? await getSessionUserFromRequest(req) : null;

  if (requestedPath === "/login.html" && sessionUser) {
    sendRedirect(res, "/");
    return;
  }

  if (isHtmlPage && requestedPath !== "/login.html" && !sessionUser) {
    sendRedirect(res, "/login.html");
    return;
  }

  if (requestedPath === "/users.html" && sessionUser && !canManageUsers(sessionUser)) {
    sendRedirect(res, "/");
    return;
  }

  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    serveFile(res, filePath);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/")) {
    await handleApi(req, res);
    return;
  }

  await handleStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
