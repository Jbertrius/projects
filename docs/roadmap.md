# Current Roadmap

Last updated: 2026-04-29

## Current State

- Runtime: Express app served from `server.js` and `src/app.js`
- Frontend: static pages under `public/`
- Data: Firestore is the primary live store, with optional Google Sheets and Google Calendar integrations still present for migration and sync workflows
- Bots: central bot-facing API routes already exist under `/api/bot/*`, but Python bots still need to finish moving off direct datastore access
- Baseline quality: Node dependencies install cleanly and the root test suite is green

## Done Recently

- Session signing no longer falls back to a hardcoded secret
- Fatal process errors now flow through graceful shutdown
- Server-side 5xx errors use the shared structured logger
- A checked-in `.env.example` now documents the active runtime configuration

## Next 30 Days

1. Expand focused automated coverage around auth, CSRF, bot routes, and startup/runtime failure handling.
2. Finish documenting and validating local and Cloud Run environment setup from `.env.example`.
3. Complete bot migration from direct Firestore writes to `/api/bot/lessons`, `/api/bot/meetings`, and `/api/bot/members`.
4. Reduce stale documentation by aligning architecture docs and deployment notes with the current Express app.

## Next 60-90 Days

1. Reduce data path overlap between Firestore, Sheets, and Calendar so Firestore is the operational source of truth.
2. Replace the highest-risk full-collection scans with narrower repository queries and cached aggregate reads.
3. Add targeted tests for repository and aggregation behavior before larger refactors.
4. Remove bot-side direct datastore code and credentials after API migration is complete.

## Notable Risks

- Bot migration is incomplete, so business logic still spans Node and Python surfaces.
- Some operational docs still describe the older Sheets-first architecture.
- Dashboard and repository performance still depend on broad reads in several paths.

## Source Documents

- `docs/architecture-audit.md`: detailed audit and long-form refactoring analysis
- `docs/bot-migration.md`: bot migration plan and API contract
- `docs/architecture.md`: earlier architecture proposal kept for historical context