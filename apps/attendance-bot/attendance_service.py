"""
attendance_service.py – Application-level business logic.

All reads and writes go through the central API (api_client).
Direct Firestore access has been removed. Ensure API_BASE_URL and
BOT_API_KEY are set in the environment before running the bot.
"""

from __future__ import annotations

import difflib
import logging

import api_client

logger = logging.getLogger(__name__)


class AttendanceError(Exception):
    """Raised for recoverable business-rule violations."""


class EventNotFoundError(AttendanceError):
    pass


class CategoryNotFoundError(AttendanceError):
    pass


def _require_api() -> None:
    if not api_client.is_configured():
        raise AttendanceError(
            "API_BASE_URL et BOT_API_KEY doivent être configurés.\n"
            "Contactez l'administrateur."
        )


# ── Events ─────────────────────────────────────────────────────────────────────

def list_events() -> list[dict]:
    _require_api()
    try:
        return api_client.get_events()
    except (ValueError, RuntimeError) as exc:
        raise AttendanceError(str(exc)) from exc


def list_categories() -> list[dict]:
    _require_api()
    try:
        return api_client.get_categories()
    except (ValueError, RuntimeError) as exc:
        raise AttendanceError(str(exc)) from exc


# ── Event fuzzy lookup ─────────────────────────────────────────────────────────

def find_event_candidates(event_name: str, n: int = 4, cutoff: float = 0.4) -> list[str]:
    all_names = [event["event_name"] for event in list_events()]
    lookup = event_name.strip().lower()

    for name in all_names:
        if name.lower() == lookup:
            return [name]

    substring_matches = [name for name in all_names if lookup in name.lower()]
    if substring_matches:
        return substring_matches[:n]

    return difflib.get_close_matches(event_name, all_names, n=n, cutoff=cutoff)


# ── Attendance read / write ────────────────────────────────────────────────────

def list_attendance(event_name: str) -> dict[str, list[str]]:
    _validate_event(event_name)
    _require_api()
    try:
        rows = api_client.get_event_attendance(event_name)
    except (ValueError, RuntimeError) as exc:
        raise AttendanceError(str(exc)) from exc

    grouped: dict[str, list[str]] = {}
    for row in rows:
        category = row.get("category") or "Uncategorised"
        grouped.setdefault(category, []).append(row["participant_name"])
    for category in grouped:
        grouped[category].sort()
    return grouped


def add_participants(event_name: str, participants: list[str], category: str) -> list[str]:
    _validate_event(event_name)
    _validate_category(category)
    _require_api()
    try:
        return api_client.add_participants(event_name, participants, category)
    except (ValueError, RuntimeError) as exc:
        raise AttendanceError(str(exc)) from exc


def remove_participant(event_name: str, participant_name: str) -> bool:
    _validate_event(event_name)
    _require_api()
    try:
        return api_client.remove_participant(event_name, participant_name)
    except (ValueError, RuntimeError) as exc:
        raise AttendanceError(str(exc)) from exc


# ── Lesson recording ───────────────────────────────────────────────────────────

def record_lesson(parsed: object) -> dict:
    """Submit a parsed lesson block to the central API."""
    _require_api()
    try:
        result = api_client.post_lesson(parsed)
        logger.info("Lesson recorded via API: %s", result.get("summary", {}))
        api_summary = result.get("summary", {})
        api_result = result.get("result", {})

        # Build per-student lists from the local parsed object — the API only
        # returns counts, not the individual names.
        present = [name for name, status, *_ in parsed.registered_students if status == "present"]
        absent  = [name for name, status, *_ in parsed.registered_students if status == "absent"]
        unknown = [name for name, status, *_ in parsed.registered_students if status not in ("present", "absent")]

        return {
            "class_code": api_summary.get("classCode", parsed.class_code),
            "teacher_name": parsed.teacher_name,
            "lesson_title": api_summary.get("title", parsed.lesson_title),
            "lesson_date": api_summary.get("date", parsed.lesson_date),
            # API returns camelCase keys
            "lesson_id": api_result.get("lessonId", api_result.get("lesson_id", "")),
            "sheet_tab": api_result.get("sheetTab", api_result.get("sheet_tab", "")),
            "class_created": api_result.get("classCreated", api_result.get("class_created", False)),
            "replaced_existing": api_result.get("replacedExisting", api_result.get("replaced_existing", False)),
            "firestore_enabled": True,
            "present": present,
            "absent": absent,
            "unknown": unknown,
            "unregistered": list(parsed.unregistered_students),
        }
    except (ValueError, RuntimeError) as exc:
        raise AttendanceError(str(exc)) from exc


# ── Academy reports ────────────────────────────────────────────────────────────

def get_class_report(query: str) -> dict:
    _require_api()
    try:
        data = api_client.get_class_report(query)
        if not data.get("ok", True):
            raise AttendanceError(
                f"Classe *{query}* introuvable.\n"
                "Utilisez le code de classe (ex : 164-2C) ou le nom du professeur."
            )
        return {
            "cls": data.get("cls", {}),
            "lessons": data.get("lessons", []),
            "students": data.get("students", []),
            "att_lookup": data.get("att_lookup", {}),
        }
    except (ValueError, RuntimeError) as exc:
        raise AttendanceError(str(exc)) from exc


def get_student_report(student_name: str) -> list[dict]:
    _require_api()
    try:
        records = api_client.get_student_report(student_name)
        if not records:
            raise AttendanceError(
                f"Aucune donnee trouvee pour *{student_name}*.\n"
                "Verifiez l'orthographe du nom."
            )
        return records
    except (ValueError, RuntimeError) as exc:
        raise AttendanceError(str(exc)) from exc


def get_absentees(class_code: str, lesson_filter: str = "") -> dict:
    _require_api()
    try:
        data = api_client.get_absentees(class_code, lesson_filter)
        if not data.get("ok", True):
            raise AttendanceError(
                f"Classe *{class_code}* introuvable.\n"
                "Utilisez /classreport pour voir les classes disponibles."
            )
        return {
            "cls": data.get("cls", {}),
            "lessons": data.get("lessons", []),
            "att_by_lesson": data.get("att_by_lesson", {}),
        }
    except (ValueError, RuntimeError) as exc:
        raise AttendanceError(str(exc)) from exc


# ── Validators ─────────────────────────────────────────────────────────────────

def _validate_event(event_name: str) -> None:
    all_names = [e["event_name"] for e in list_events()]
    if not any(n.strip().lower() == event_name.strip().lower() for n in all_names):
        raise EventNotFoundError(
            f"Event *{event_name}* not found.\n"
            "Use /events to see available events."
        )


def _validate_category(category_name: str) -> None:
    all_names = [c["category_name"] for c in list_categories()]
    if not any(n.strip().lower() == category_name.strip().lower() for n in all_names):
        raise CategoryNotFoundError(
            f"Category *{category_name}* not found.\n"
            "Use /categories to see available categories."
        )
