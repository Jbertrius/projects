# Architecture Audit & Refactoring Plan

Status note: this document remains useful as the detailed audit baseline, but parts of the implementation status are now stale. For the current prioritized plan, use `docs/roadmap.md` first and treat this file as supporting context.

**Date:** 2026-04-07
**Scope:** Full system audit (Web Dashboard, Telegram Bots, Firestore, Infrastructure)

---

## 1. Audit Summary

### Current System

| Component | Technology | Location |
|-----------|-----------|----------|
| Web Dashboard | Node.js (raw HTTP, no framework), Vanilla JS frontend | `server.js` + `lib/` + `public/` |
| Attendance Bot | Python (python-telegram-bot), 11 commands | `external/attendance_bot/` |
| Mannam Bot | Python (python-telegram-bot), 5 commands + conversations | `external/mannam_bot/` |
| Database | Firestore (REST API, no SDK) | Collections: members, meetings, pastors, academy*, mannamEvents, appUsers |
| Legacy data | Google Sheets + Google Calendar | Sync scripts bridge Sheets -> Firestore |
| Infrastructure | Cloud Run (Docker), Cloud Build, GitHub Actions | Single service deployment |

### Current Data Flow (Fragmented)

```
Attendance Bot (Python)  ---> direct Firestore writes ---> Firestore (no rules)
Mannam Bot (Python)      ---> direct Firestore writes -/
Web Dashboard (Node.js)  ---> direct Firestore reads/writes
                               also reads from Google Sheets <-> Google Calendar
```

Every component independently authenticates to Firestore with a service account and writes whatever it wants. There is no shared contract, no validation layer, no single source of truth for business logic.

---

## 2. Critical Issues

### P0 - Security

| Issue | Detail |
|-------|--------|
| No Firestore security rules | No `firestore.rules` file exists. Leaked credentials = total compromise. |
| Hard-coded credentials in bot code | Mannam bot has `CALENDAR_ID`, `SPREADSHEET_ID`, sheet names hard-coded. |
| No CSRF protection | Web sessions use HMAC cookies but have no CSRF token. |
| No rate limiting on login | `/api/auth/login` has no brute-force protection. |

### P1 - Architecture

| Issue | Detail |
|-------|--------|
| No centralized API | Both Python bots and Node.js web app independently write to Firestore. Business logic duplicated across 3 codebases in 2 languages. |
| Bots are too smart | Attendance bot has its own `firestore_service.py`, `attendance_service.py`, `sheets_service.py`. Full backend services embedded in bot code. |
| Inconsistent collection schemas | Attendance bot writes to `CLASSES`, `LESSONS`, `STUDENTS` (uppercase). Web app writes to `academyClasses`, `academyStudents`, `academyLessons` (camelCase). Different collections for the same domain. |
| Three data sources, no single truth | Google Sheets, Google Calendar, and Firestore all hold overlapping data. Sync scripts are manually triggered. Data drift is inevitable. |
| No framework | `server.js` is 937 lines of raw `http.createServer` with manual URL parsing, body parsing, cookie handling. Fragile and hard to extend. |

### P2 - Cost & Performance

| Issue | Detail |
|-------|--------|
| Full collection scans | `listCollectionDocuments()` fetches ALL documents, filters in JS. |
| No caching | Every `/api/dashboard` call re-fetches all members, meetings, training from Firestore. |
| No indexes defined | No `firestore.indexes.json`. Composite queries will be slow. |
| Redundant sync architecture | Calendar -> Sheets -> Firestore is 3 hops. Each hop duplicates data. |

### P3 - Maintainability

| Issue | Detail |
|-------|--------|
| Two languages | Bots are Python, web app is Node.js. Shared logic duplicated. |
| 13 ad-hoc scripts | Scripts like `merge-academy-firestore.js` suggest data integrity is fixed manually. |
| No tests | Zero test files in web app. |
| `academy.js` is 1,707 lines | Single frontend file handling all academy logic. |

---

## 3. Target Architecture

### Design Principles

1. **Single API gateway** - all writes go through one backend
2. **Bots become thin clients** - they parse messages and call the API
3. **Firestore is the single source of truth** - eliminate Sheets dependency
4. **Domain separation** - academy, evangelism, admin are distinct modules
5. **Keep it simple** - Express, not NestJS. No microservices. One deployable.

### Target Data Flow

```
Attendance Bot (Python) --- HTTP POST ---> Central API (Node.js/Express)
Mannam Bot (Python)     --- HTTP POST -/       |
Web Frontend (browser)  --- fetch()   -/       |
                                               v
                                          Firestore (only)
                                               |
                                    Google Calendar (optional push)
```

### Backend Structure

```
src/
  server.js                    # Express app setup, middleware registration
  config/
    index.js                   # Environment loading, validation
  middleware/
    auth.js                    # Session auth (web users)
    apiKey.js                  # API key auth (bots)
    requireRole.js             # Role-based access control
    errorHandler.js            # Centralized error handling
  routes/
    auth.routes.js             # POST /login, /logout, GET /session
    dashboard.routes.js        # GET /dashboard
    members.routes.js          # CRUD /members
    meetings.routes.js         # CRUD /meetings
    pastors.routes.js          # CRUD /pastors
    academy.routes.js          # CRUD /academy/*
    users.routes.js            # CRUD /users (admin)
    sync.routes.js             # POST /sync/* (admin, migration only)
  services/
    auth.service.js            # Password hashing, session creation
    dashboard.service.js       # KPI computation, aggregation
    member.service.js          # Member lifecycle
    meeting.service.js         # Meeting creation, calendar push
    pastor.service.js          # Pastor matching, dedup
    academy.service.js         # Lesson recording, attendance
  repositories/
    base.repository.js         # Shared Firestore CRUD operations
    member.repository.js
    meeting.repository.js
    pastor.repository.js
    academy.repository.js
    user.repository.js
  utils/
    firestore-client.js        # Firestore REST API wrapper
    google-auth.js             # Service account token management
    name-matching.js           # Fuzzy name resolution
    slugify.js                 # ID generation
  public/                      # Static frontend (unchanged)
```

### Responsibility Boundaries

| Layer | Knows about | Does NOT know about |
|-------|------------|-------------------|
| Routes | HTTP, request/response, input validation | Firestore, business rules |
| Services | Business rules, domain logic | HTTP, Firestore queries |
| Repositories | Firestore collections, document mapping | Business rules, HTTP |
| Middleware | Auth tokens, roles | Business logic, data |

---

## 4. Firestore Redesign

### Proposed Collection Structure

```
firestore/
  users/                    # Authentication & roles
    {userId}
      email, displayName, role, memberId, passwordHash, passwordSalt,
      createdAt, lastLoginAt

  members/                  # Church members (source of truth)
    {memberId}
      firstName, lastName, aliases[], zone, departmentRole,
      status, createdAt, updatedAt

  pastors/                  # External pastors/shepherds
    {pastorId}
      firstName, lastName, title, aliases[], churchName, city,
      phone, email, meetingCount, lastMeetingDate, needsReview

  meetings/                 # Evangelism meetings (mannam)
    {meetingId}
      memberIds[], pastorId, meetingDate, summary, location,
      description, calendarEventId, source, createdAt

  academy/
    classes/{classId}
      code, name, instructorName, churchName, studentCount
    lessons/{lessonId}
      classId, title, date, instructorName, presentCount, absentCount
    attendance/{attendanceId}
      lessonId, classId, studentName, status, isRegistered, absenceNote

  aggregates/               # Pre-computed stats
    dashboard
      totalMembers, activeMembers, totalMeetings, meetingsThisMonth, lastUpdated
    monthlyStats/{YYYY-MM}
      meetingCount, activeMemberCount, topMembers[], topPastors[]
```

### Key Design Decisions

1. **Pre-compute aggregates** - Update `aggregates/dashboard` on writes. Dashboard = 1 read instead of ~1200.
2. **Denormalize counters** - `pastors/{id}.meetingCount`, `lessons/{id}.presentCount`. Avoids count queries.
3. **Deterministic document IDs** - Enables idempotent writes (PATCH/upsert).
4. **Drop Sheets dependency** - Bots call API, API writes to Firestore. Sheets becomes irrelevant.

---

## 5. Bot Refactoring

### Logic Placement

| Logic | Bot | API |
|-------|-----|-----|
| Telegram message handling | Yes | No |
| Command routing | Yes | No |
| Gemini text parsing | Yes | No |
| Inline keyboard / conversation state | Yes | No |
| Data validation | No | Yes |
| Fuzzy name matching | No | Yes |
| Firestore reads/writes | No | Yes |
| Attendance calculations / reports | No | Yes |
| Calendar event creation | No | Yes |
| Role/permission checks | No | Yes |

### Bot Authentication

Simple API key system for bot-to-API auth:
- Bots send `Authorization: Bearer <key>` header
- API middleware validates key and identifies the caller
- No need for OAuth/JWT for machine-to-machine auth at this scale

---

## 6. Roles & Permissions

| Role | Dashboard | Academy | Meetings | Users | System |
|------|-----------|---------|----------|-------|--------|
| admin | RW | RW | RW | Yes | Yes |
| manager | RW | RW | RW | Create members only | No |
| member | Read own | Read own class | Read own | No | No |
| bot | No | Write (API key) | Write (API key) | No | No |

---

## 7. Performance & Cost Optimization

| Pattern | Current Cost | Fix |
|---------|-------------|-----|
| Dashboard loads all collections | ~1200 reads/load | Pre-computed aggregates doc = 1 read |
| No query filters | Fetches ALL docs, filters in JS | Use Firestore `where` clauses |
| Bot writes + web re-reads | Double writes to different collections | Single API write path |
| Sheets -> Firestore sync | Unnecessary reads/writes | Eliminate Sheets dependency |
| Full pagination loops | Loops through all pages | Query only what you need |

### Caching Strategy

Simple in-memory TTL cache (no Redis needed at this scale):
- Dashboard KPIs: 5 min TTL
- Member list: 10 min TTL
- Pastor list: 10 min TTL
- Auth sessions: always validate from Firestore

---

## 8. Migration Plan

### Phase 1: Foundation (week 1-2)
1. Add Express framework
2. Extract routes from `server.js` into `src/routes/`
3. Extract services from `lib/` into `src/services/`
4. Create repository layer in `src/repositories/`
5. Add centralized error handling and input validation

### Phase 2: Centralize Data Access (week 2-3)
6. Unify collection names (bot vs web app)
7. Add aggregate documents
8. Add Firestore indexes
9. Add input validation with zod

### Phase 3: Bot Refactoring (week 3-4)
10. Add bot API endpoints
11. Add API key middleware
12. Refactor attendance bot to call API
13. Refactor mannam bot to call API

### Phase 4: Cleanup (week 4-5)
14. Delete sync scripts
15. Delete Sheets integration
16. Add Firestore security rules
17. Add logging and monitoring
18. Add integration tests

---

## 9. What NOT To Do

- Don't introduce microservices
- Don't add Redis (in-memory cache is fine)
- Don't rewrite the frontend
- Don't add GraphQL (REST is sufficient)
- Don't add Cloud Functions (keep one Cloud Run service)
- Don't over-engineer permissions (4 roles covers everything)
