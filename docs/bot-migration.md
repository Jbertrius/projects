# Bot Migration Guide

How to migrate the Telegram bots from direct Firestore access to the central API.

## Why

Both bots currently write to Firestore directly using a service account. This means:
- Business logic is duplicated across Python and Node.js
- Collection schemas diverge silently (e.g. `LESSONS` vs `academyLessons`)
- A bug in a bot can corrupt data with no validation layer
- Any schema change requires updating 3 codebases

After this migration, bots do one thing: parse Telegram messages and call the API.

---

## Step 1 — Set the API key environment variable

Add to your bot's Cloud Run environment (or `.env` for local dev):

**Attendance bot:**
```
BOT_API_KEY_ATTENDANCE=<generate with: openssl rand -hex 32>
API_BASE_URL=https://your-dashboard-url.run.app
```

**Mannam bot:**
```
BOT_API_KEY_MANNAM=<generate with: openssl rand -hex 32>
API_BASE_URL=https://your-dashboard-url.run.app
```

Add the same values to the dashboard's Cloud Run environment:
```
BOT_API_KEY_ATTENDANCE=<same value>
BOT_API_KEY_MANNAM=<same value>
```

---

## Step 2 — Replace the Firestore client with an HTTP client

Create a shared helper in each bot:

```python
# api_client.py
import os
import httpx

API_BASE_URL = os.environ["API_BASE_URL"]
BOT_API_KEY  = os.environ.get("BOT_API_KEY_ATTENDANCE") or os.environ.get("BOT_API_KEY_MANNAM")

async def api_post(path: str, payload: dict) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{API_BASE_URL}{path}",
            json=payload,
            headers={"Authorization": f"Bearer {BOT_API_KEY}"},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()

async def api_get(path: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{API_BASE_URL}{path}",
            headers={"Authorization": f"Bearer {BOT_API_KEY}"},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()
```

---

## Step 3 — Migrate the attendance bot

### Before (firestore_service.py writes directly)
```python
# attendance_service.py — OLD
async def record_lesson(parsed):
    await firestore_service.write_class(parsed)
    await firestore_service.write_lesson(parsed)
    for student in parsed["students"]:
        await firestore_service.write_attendance(parsed, student)
```

### After (calls the API)
```python
# attendance_service.py — NEW
from api_client import api_post

async def record_lesson(parsed):
    payload = {
        "classCode":  parsed["class_code"],
        "date":       parsed["lesson_date"],
        "title":      parsed["lesson_title"],
        "instructor": parsed["teacher_name"],
        "students": [
            {
                "name":   name,
                "status": status,
                "note":   parsed.get("absence_notes", {}).get(name, "")
            }
            for name, status, *_ in parsed["registered_students"]
        ],
        "source": "telegram_bot"
    }
    result = await api_post("/api/bot/lessons", payload)
    return result["summary"]
```

### Files to delete after migration
- `attendance_bot/firestore_service.py`
- `attendance_bot/sheets_service.py` (superseded by `/api/bot/members`)

---

## Step 4 — Migrate the mannam bot

### Before (firestore_sync.py writes directly)
```python
# firestore_sync.py — OLD
async def sync_event(event):
    doc = build_mannam_doc(event)
    await write_document("mannamEvents", event["id"], doc)
```

### After (calls the API)
```python
# meeting_service.py — NEW
from api_client import api_post

async def record_meeting(parsed_event):
    payload = {
        "summary":         parsed_event["summary"],
        "date":            parsed_event["date"],        # YYYY-MM-DD
        "time":            parsed_event.get("time"),    # HH:MM
        "location":        parsed_event.get("location"),
        "description":     parsed_event.get("description"),
        "participants":    parsed_event.get("mannamjas", []),
        "calendarEventId": parsed_event.get("calendar_event_id"),
        "source":          "mannam_bot"
    }
    result = await api_post("/api/bot/meetings", payload)
    return result["meetingId"]
```

### Files to delete after migration
- `mannam_bot/firestore_sync.py`

---

## Step 5 — Resolve member names via the API

Both bots use fuzzy name matching to map raw Telegram names to canonical members.
This logic should move to the API side — bots can query the member list:

```python
from api_client import api_get

async def get_member_list():
    data = await api_get("/api/bot/members")
    return data["members"]  # [{ id, name, aliases, zone }]
```

Cache this locally in the bot process (TTL ~10 min) to avoid repeated calls.

---

## API Reference

### POST /api/bot/lessons
```json
{
  "classCode":  "CLS01",
  "date":       "2026-04-01",
  "title":      "Lecon 5 - La Foi",
  "instructor": "Jean Dupont",
  "students": [
    { "name": "Marie Dupont", "status": "present" },
    { "name": "Paul Martin",  "status": "absent", "note": "maladie" }
  ],
  "mode":   "create",
  "source": "telegram_bot"
}
```
`mode` options: `"create"` (default), `"replace"` (requires `lessonId`+`classId`), `"delete-by-id"` (requires `lessonId`).

### POST /api/bot/meetings
```json
{
  "summary":         "Rencontre Pasteur Martin",
  "date":            "2026-04-01",
  "time":            "14:30",
  "location":        "Eglise Centrale",
  "description":     "Discussion sur la formation",
  "participants":    ["Jean Dupont", "Marie Martin"],
  "calendarEventId": "abc123xyz",
  "source":          "mannam_bot"
}
```

### GET /api/bot/members
Returns `{ ok: true, members: [{ id, name, aliases, zone }] }`.

---

## Checklist

- [ ] Generate API keys and set env vars on both bots and the dashboard
- [ ] Test API keys locally: `curl -H "Authorization: Bearer <key>" <url>/api/bot/members`
- [ ] Migrate attendance bot `record_lesson` to use `POST /api/bot/lessons`
- [ ] Migrate mannam bot `sync_event` to use `POST /api/bot/meetings`
- [ ] Delete `firestore_service.py` from attendance bot
- [ ] Delete `sheets_service.py` from attendance bot
- [ ] Delete `firestore_sync.py` from mannam bot
- [ ] Remove Firestore credentials from bot deployments (bots no longer need them)
- [ ] Deploy and verify in staging before production
