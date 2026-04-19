"""
api_client.py – Thin HTTP client for the central web-app API.

Shared by attendance-bot and mannam-bot. All bot writes go through the
central API instead of hitting Firestore directly. Authentication is via
a pre-shared Bearer token stored in BOT_API_KEY.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from urllib.error import HTTPError, URLError
from urllib import request as urllib_request
from urllib.parse import quote

logger = logging.getLogger(__name__)

# ── Config ─────────────────────────────────────────────────────────────────────

API_BASE_URL: str = os.getenv("API_BASE_URL", "").rstrip("/")
BOT_API_KEY: str = os.getenv("BOT_API_KEY", "")


def is_configured() -> bool:
    return bool(API_BASE_URL and BOT_API_KEY)


# ── Low-level helper ───────────────────────────────────────────────────────────

def _request(method: str, path: str, body: dict | None = None) -> dict:
    if not is_configured():
        raise RuntimeError(
            "API_BASE_URL and BOT_API_KEY must be set to use the central API."
        )

    url = f"{API_BASE_URL}{path}"
    payload = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib_request.Request(
        url,
        data=payload,
        method=method,
        headers={
            "Authorization": f"Bearer {BOT_API_KEY}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib_request.urlopen(req, timeout=30) as resp:
            content = resp.read().decode("utf-8").strip()
            return json.loads(content) if content else {}
    except HTTPError as exc:
        error_body = ""
        if getattr(exc, "fp", None):
            try:
                error_body = exc.fp.read().decode("utf-8", errors="replace")[:300]
            except Exception:
                pass
        raise ValueError(
            f"API request failed: HTTP {exc.code} {method} {path} — {error_body}"
        ) from exc
    except URLError as exc:
        raise ValueError(f"Cannot reach API at {url}: {exc.reason}") from exc


def _encode(value: str) -> str:
    """URL-encode a path segment."""
    return quote(str(value or ""), safe="")


# ── Members ────────────────────────────────────────────────────────────────────

def get_members() -> list[dict]:
    """Fetch the member list from GET /api/bot/members."""
    result = _request("GET", "/api/bot/members")
    return result.get("members", [])


# ── Member cache & name resolution (used by mannam-bot) ───────────────────────

_members_cache: tuple[float, list[dict]] | None = None
_MEMBERS_CACHE_TTL = 3600  # 1 hour


def _get_members_cached() -> list[dict]:
    global _members_cache
    if _members_cache and (time.time() - _members_cache[0]) < _MEMBERS_CACHE_TTL:
        return _members_cache[1]
    try:
        members = get_members()
        _members_cache = (time.time(), members)
        return members
    except Exception as exc:
        logger.warning("Impossible de récupérer les membres pour la résolution: %s", exc)
        return _members_cache[1] if _members_cache else []


def _norm(name: str) -> str:
    """Normalise a name for comparison: lowercase, no accents, no dash/space,
    strips group tag/suffix (1-3 letter initial or CamelCase suffix)."""
    s = name.strip()
    s = re.sub(r'\s+(?:[A-Za-z]{1,3}|[A-Z][a-z]+)$', '', s)
    s = re.sub(r'(?<=[a-z])[A-Z][a-zA-Z]{0,2}$', '', s)
    return re.sub(r'[-\s]', '', s.strip().lower())


def _resolve_participant(raw_name: str, members: list[dict]) -> str:
    """Match raw_name to a canonical member name, returning raw_name if no match."""
    key = _norm(raw_name)
    if not key:
        return raw_name
    for member in members:
        if _norm(member.get("name", "")) == key:
            return member["name"]
        for alias in (member.get("aliases") or "").split(","):
            if alias.strip() and _norm(alias) == key:
                return member["name"]
    return raw_name


# ── Academy lessons (attendance-bot) ──────────────────────────────────────────

def post_lesson(parsed) -> dict:
    """Submit a parsed attendance block to POST /api/bot/lessons."""
    students = []
    for row in parsed.registered_students:
        if len(row) == 3:
            name, status, subgroup = row
        else:
            name, status = row
            subgroup = ""
        if not name:
            continue
        entry: dict = {
            "name": str(name).strip(),
            "status": str(status).strip() or "present",
        }
        if subgroup:
            entry["subgroup"] = str(subgroup).strip()
        note = parsed.absence_notes.get(name, "")
        if note:
            entry["note"] = str(note).strip()
        students.append(entry)

    payload = {
        "classCode": parsed.class_code,
        "date": parsed.lesson_date,
        "title": parsed.lesson_title,
        "instructor": parsed.teacher_name,
        "students": students,
        "mode": "replace",
        "source": "attendance_bot",
    }
    logger.info(
        "Posting lesson to API: class=%s date=%s title=%s students=%d",
        parsed.class_code, parsed.lesson_date, parsed.lesson_title, len(students),
    )
    return _request("POST", "/api/bot/lessons", payload)


# ── Attendance events (attendance-bot) ────────────────────────────────────────

def get_events() -> list[dict]:
    """Fetch all attendance events from GET /api/bot/events."""
    result = _request("GET", "/api/bot/events")
    return result.get("events", [])


def get_categories() -> list[dict]:
    """Fetch all attendance categories from GET /api/bot/categories."""
    result = _request("GET", "/api/bot/categories")
    return result.get("categories", [])


def get_event_attendance(event_name: str) -> list[dict]:
    """Fetch all participants for one event. GET /api/bot/events/{name}/attendance"""
    result = _request("GET", f"/api/bot/events/{_encode(event_name)}/attendance")
    return result.get("rows", [])


def add_participants(event_name: str, participants: list[str], category: str) -> list[str]:
    """Add participants to an event. POST /api/bot/events/{name}/participants"""
    result = _request(
        "POST",
        f"/api/bot/events/{_encode(event_name)}/participants",
        {"participants": participants, "category": category},
    )
    return result.get("added", [])


def remove_participant(event_name: str, participant_name: str) -> bool:
    """Remove a participant from an event. DELETE /api/bot/events/{name}/participants/{p}"""
    path = f"/api/bot/events/{_encode(event_name)}/participants/{_encode(participant_name)}"
    try:
        result = _request("DELETE", path)
        return bool(result.get("removed", True))
    except ValueError:
        return False


# ── Academy reports (attendance-bot) ──────────────────────────────────────────

def get_class_report(code: str) -> dict:
    """GET /api/bot/academy/report/class/{code}"""
    return _request("GET", f"/api/bot/academy/report/class/{_encode(code)}")


def get_student_report(student_name: str) -> list[dict]:
    """GET /api/bot/academy/report/student/{name}"""
    result = _request("GET", f"/api/bot/academy/report/student/{_encode(student_name)}")
    return result.get("records", [])


def get_absentees(class_code: str, lesson_filter: str = "") -> dict:
    """GET /api/bot/academy/report/absentees/{code}[?lesson=<filter>]"""
    path = f"/api/bot/academy/report/absentees/{_encode(class_code)}"
    if lesson_filter:
        path += f"?lesson={_encode(lesson_filter)}"
    return _request("GET", path)


# ── Meetings (mannam-bot) ──────────────────────────────────────────────────────

def upsert_meeting(event_id: str, event_details: dict) -> dict:
    """Submit a meeting record to POST /api/bot/meetings."""
    mannamjas_raw = event_details.get("mannamjas", "") or ""
    raw_participants = [
        p.strip()
        for p in mannamjas_raw.replace("&amp;", ",").replace("&", ",").split(",")
        if p.strip()
    ]

    members = _get_members_cached()
    participants = [_resolve_participant(p, members) for p in raw_participants]

    resolved = [
        f"{r} (← {o})" for o, r in zip(raw_participants, participants) if o != r
    ]
    if resolved:
        logger.info("Participants résolus: %s", ", ".join(resolved))

    payload = {
        "summary": event_details.get("summary", ""),
        "date": event_details.get("date", ""),
        "time": event_details.get("time", ""),
        "location": event_details.get("location", ""),
        "description": event_details.get("description", ""),
        "figureName": event_details.get("figure_name", ""),
        "participants": participants,
        "calendarEventId": event_id,
        "source": "mannam_bot",
    }
    logger.info(
        "Posting meeting to API: event_id=%s summary=%s date=%s",
        event_id, event_details.get("summary", ""), event_details.get("date", ""),
    )
    return _request("POST", "/api/bot/meetings", payload)


def delete_meeting(event_id: str) -> dict:
    """Delete a meeting record via DELETE /api/bot/meetings/{id}."""
    logger.info("Deleting meeting from API: event_id=%s", event_id)
    return _request("DELETE", f"/api/bot/meetings/{_encode(event_id)}")
