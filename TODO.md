# TODO

## Immediate

- [x] Install Node dependencies and get the test suite running.
- [x] Remove the weak auth/session fallback secret.
- [x] Add process-level handlers for unhandled rejections and uncaught exceptions.
- [x] Route all server-side errors through structured logging.

## Next

- [x] Expand route and service test coverage after the baseline is green.
- [x] Add a `.env.example` that matches the current runtime configuration.
- [x] Refresh architecture docs to match the current Express app and migration state.

## Notes

- Baseline established: `npm ci` succeeded and `npm test` is green in the current workspace.
- Auth/session fallback now uses a per-process random secret when no configured secret material exists.
- Fatal process events now flow through graceful shutdown with structured error logging.
- Added `.env.example` covering app, auth, Firestore, Sheets, Calendar, bot, and Gemini configuration.
- Added `docs/roadmap.md` and marked the older audit as supporting context rather than the primary plan.
- Added focused coverage for auth session responses, static HTML auth guards, and auth secret fallback behavior.
- Current root priority after this pass: continue bot migration and performance cleanup rather than baseline hardening.