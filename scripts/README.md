# scripts/

Operational utilities for production administration.

| Script | Purpose |
|--------|---------|
| `setup-cloudrun.sh` | One-time Cloud Run / IAM setup for a new GCP project |
| `setup-google-sheet.js` | Create / configure the Google Sheet structure |
| `sync-academy-sheet-to-firestore.js` | Manually trigger academy Sheet → Firestore sync |
| `sync-calendar-to-sheets.js` | Manually trigger Calendar → Sheets sync |
| `sync-sheets-to-firestore.js` | Manually trigger Sheets → Firestore full sync |

## archive/

Historical migration and debugging scripts kept for reference.
These were used once during the refactoring and are no longer needed
in day-to-day operations.
