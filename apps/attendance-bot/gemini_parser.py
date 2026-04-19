"""
gemini_parser.py – Natural-language intent parser powered by Google Gemini.

Converts a free-text user message into a structured ParsedCommand so that
command handlers do not need to know whether the user typed a /command or
a sentence like "Please add Sarah to Leadership Meeting as Staff".

The prompt is engineered to return *only* a JSON object, preventing Gemini
from wrapping the answer in markdown fences or preamble text.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import date

import google.generativeai as genai

import config

logger = logging.getLogger(__name__)

# Lazy-initialised model singleton (one per process)
_model: genai.GenerativeModel | None = None

INTENT_ADD = "add"
INTENT_REMOVE = "remove"
INTENT_LIST = "list"
INTENT_EVENTS = "events"
INTENT_CATEGORIES = "categories"
INTENT_UNKNOWN = "unknown"

VALID_INTENTS = {INTENT_ADD, INTENT_REMOVE, INTENT_LIST, INTENT_EVENTS, INTENT_CATEGORIES}


@dataclass
class ParsedCommand:
    intent: str = INTENT_UNKNOWN
    event_name: str = ""
    participants: list[str] = field(default_factory=list)
    category: str = ""
    raw_text: str = ""


@dataclass
class ParsedAttendance:
    """Structured result of parsing a class attendance message block."""
    class_code: str = ""
    church_name: str = ""
    teacher_name: str = ""
    lesson_title: str = ""
    lesson_date: str = ""                                    # ISO: YYYY-MM-DD
    registered_students: list[tuple[str, str, str]] = field(default_factory=list)  # (name, status, subgroup)
    unregistered_students: list[str] = field(default_factory=list)
    absence_notes: dict = field(default_factory=dict)        # name → reason
    raw_text: str = ""


_SYSTEM_PROMPT = """
You are a structured data extractor for an attendance management Telegram bot.
User messages are written in French. You must understand French vocabulary and
grammar to extract the relevant fields.

Your job is to read the user's message and output ONLY a JSON object — no
markdown, no explanation, no code fences — with the following keys:

{
  "intent":       "<add | remove | list | events | categories | unknown>",
  "event_name":   "<event name string or empty string>",
  "participants": ["<name1>", "<name2>", ...],
  "category":     "<category name or empty string>"
}

Rules:
- "intent" must be one of: add, remove, list, events, categories, unknown.
- "participants" is an array even when there is only one name.
- Normalise participant names to Title Case.
- French intent mapping (non-exhaustive):
    add        → ajouter, inscrire, enregistrer, mettre, rajouter
    remove     → enlever, retirer, supprimer, effacer, désinscrire
    list       → voir la liste, afficher la présence, qui est présent, lister les présences
    events     → voir les événements, afficher les événements, liste des événements, quels événements
    categories → voir les catégories, afficher les catégories, liste des catégories, quelles catégories
- If the user asks to see / show / list events → intent = "events".
- If the user asks to see / show / list categories → intent = "categories".
- If intent is "list" the user wants to see attendance for an event.
- Output ONLY the JSON object. Nothing else.
""".strip()


# ── Add-specific prompt ──────────────────────────────────────────────────────

_ADD_ARGS_PROMPT = """
You are a structured data extractor for an attendance management Telegram bot.
The user has typed a /add command in French. The text you receive is everything
after "/add" — it may include pastoral titles (Pasteur, Évangéliste, Diacre,
Ancien, Apôtre, Prophète, etc.) followed by full names.

Extract the following fields and return ONLY a JSON object (no markdown, no
explanation, no code fences):

{
  "event_name":   "<full event name, preserving original capitalisation>",
  "participants": ["<full name 1>", "<full name 2>", ...],
  "category":     "<category name or empty string>"
}

Rules:
- "event_name" is the name of the church event (e.g. "Culte du Dimanche",
  "Conférence Annuelle", "Retraite Spirituelle").
- "participants" are the people being registered. Do not include their title if present
  (e.g. "Pasteur Jean-Marie Dupont"). Each participant is a separate entry.
  Normalise to Title Case.
- "category" is specified after keywords like: category, catégorie, cat, groupe.
  If absent, return an empty string.
- Output ONLY the JSON object. Nothing else.
""".strip()


# ── Remove-specific prompt ────────────────────────────────────────────────────

_REMOVE_ARGS_PROMPT = """
You are a structured data extractor for an attendance management Telegram bot.
The user has typed a /remove command in French. The text you receive is everything
after "/remove" — it may include pastoral titles (Pasteur, Évangéliste, Diacre,
Ancien, Apôtre, Prophète, etc.) followed by full names.

Extract the following fields and return ONLY a JSON object (no markdown, no
explanation, no code fences):

{
  "event_name":   "<full event name, preserving original capitalisation>",
  "participants": ["<full name 1 including title if present>", "<full name 2>", ...]
}

Rules:
- "event_name" is the name of the church event (e.g. "Culte du Dimanche",
  "Conférence Annuelle", "Retraite Spirituelle").
- "participants" are the people to remove. Keep their title if present
  (e.g. "Pasteur Jean-Marie Dupont"). Each participant is a separate entry.
  Normalise names to Title Case.
- "participants" is an array even when there is only one name.
- Output ONLY the JSON object. Nothing else.
""".strip()


# ── Public API ────────────────────────────────────────────────────────────────

def parse_remove_args(args_text: str) -> ParsedCommand:
    """
    Parse the raw text of a /remove command (everything after /remove) with a
    focused Gemini prompt that understands pastoral names and event names in French.

    Falls back to ParsedCommand(intent='remove') on any error.
    """
    model = _get_model()
    prompt = f"{_REMOVE_ARGS_PROMPT}\n\nCommand arguments: {args_text}"

    try:
        response = model.generate_content(prompt)
        raw_json = _extract_json(response.text)
        data = json.loads(raw_json)
        cmd = _build_command(data, args_text)
        cmd.intent = INTENT_REMOVE  # always remove in this context
        return cmd
    except Exception as exc:
        logger.warning("Gemini parse_remove_args error: %s | input: %r", exc, args_text)
        return ParsedCommand(intent=INTENT_REMOVE, raw_text=args_text)


def parse_add_args(args_text: str) -> ParsedCommand:
    """
    Parse the raw text of a /add command (everything after /add) with a
    focused Gemini prompt that understands full pastoral names, event names
    and categories in French.

    Falls back to ParsedCommand(intent='add') on any error.
    """
    model = _get_model()
    prompt = f"{_ADD_ARGS_PROMPT}\n\nCommand arguments: {args_text}"

    try:
        response = model.generate_content(prompt)
        raw_json = _extract_json(response.text)
        data = json.loads(raw_json)
        cmd = _build_command(data, args_text)
        cmd.intent = INTENT_ADD  # always add in this context
        return cmd
    except Exception as exc:
        logger.warning("Gemini parse_add_args error: %s | input: %r", exc, args_text)
        return ParsedCommand(intent=INTENT_ADD, raw_text=args_text)


def parse(user_message: str) -> ParsedCommand:
    """
    Parse *user_message* with Gemini and return a ParsedCommand.

    Falls back to ParsedCommand(intent='unknown') on any error so that the
    bot can still respond gracefully even when the AI is unavailable.
    """
    model = _get_model()
    prompt = f"{_SYSTEM_PROMPT}\n\nUser message: {user_message}"

    try:
        response = model.generate_content(prompt)
        raw_json = _extract_json(response.text)
        data = json.loads(raw_json)
        return _build_command(data, user_message)
    except Exception as exc:
        logger.warning("Gemini parse error: %s | input: %r", exc, user_message)
        return ParsedCommand(intent=INTENT_UNKNOWN, raw_text=user_message)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_model() -> genai.GenerativeModel:
    global _model
    if _model is None:
        genai.configure(api_key=config.GEMINI_API_KEY)
        _model = genai.GenerativeModel(config.GEMINI_MODEL)
        logger.info("Gemini model initialised: %s", config.GEMINI_MODEL)
    return _model


def _extract_json(text: str) -> str:
    """
    Strip markdown fences if Gemini wraps its response,
    then return the first {...} block found.
    """
    # Remove ```json ... ``` or ``` ... ```
    text = re.sub(r"```(?:json)?", "", text).replace("```", "").strip()
    # Find first JSON object
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        return match.group(0)
    return text  # let json.loads raise a descriptive error


def _build_command(data: dict, raw_text: str) -> ParsedCommand:
    intent = str(data.get("intent", INTENT_UNKNOWN)).strip().lower()
    if intent not in VALID_INTENTS:
        intent = INTENT_UNKNOWN

    participants = data.get("participants", [])
    if isinstance(participants, str):
        participants = [participants]
    participants = [str(p).strip() for p in participants if str(p).strip()]

    return ParsedCommand(
        intent=intent,
        event_name=str(data.get("event_name", "")).strip(),
        participants=participants,
        category=str(data.get("category", "")).strip(),
        raw_text=raw_text,
    )



# ── Attendance message parser (regex-based, no AI needed) ────────────────────

# Student-line patterns (new format: marker first, then optional number)
_MARKER_FIRST  = re.compile(r"^(✅|👍|✖️|✖|❌|X)\s*(\d*)\s*[-.)]\s*(.*)", re.UNICODE)
_NUMBER_FIRST  = re.compile(r"^(\d+)\s*[-. ]\s*(.*)")
_PRESENT_EMOJIS: frozenset[str] = frozenset({"✅", "👍"})


def _parse_student_line(line: str) -> tuple[str | None, str, str]:
    """
    Parse a single student line and return (name, status, absence_reason).
    Returns (None, '', '') when the line is not a student line.

    Supported formats:
      👍1- Name               → present
      👍- Name                → present (no number)
      X 7- Name (reason)      → absent + reason
      ✖️8- Name (reason)      → absent + reason
      ❌9- Name               → absent
      1- ✅Name               → present  (legacy)
      1- ✖️Name               → absent   (legacy)
      1- Name                 → unknown  (legacy, no marker)
    """
    if re.search(r"\b(confirme|confirmé|present|présent|absent|camera|caméra)\b", line, flags=re.IGNORECASE):
        return None, "", ""

    name_part = ""
    status = "unknown"

    m = _MARKER_FIRST.match(line)
    if m:
        marker = m.group(1).strip()
        name_part = m.group(3).strip()
        status = "present" if marker in _PRESENT_EMOJIS else "absent"
    else:
        m2 = _NUMBER_FIRST.match(line)
        if m2:
            rest = m2.group(2).strip()
            # Legacy: marker after the number
            inner = re.match(r"^(✅|👍|✖️|✖|❌)\s*(.*)", rest)
            if inner:
                status = "present" if inner.group(1) in _PRESENT_EMOJIS else "absent"
                name_part = inner.group(2).strip()
            else:
                name_part = rest
                status = "unknown"
        else:
            return None, "", ""

    # Extract optional absence reason: "Name (reason text)"
    reason = ""
    reason_m = re.search(r"\s*\(([^)]+)\)\s*$", name_part)
    if reason_m:
        reason = reason_m.group(1).strip()
        name_part = name_part[: reason_m.start()].strip()

    return (name_part if name_part else None), status, reason


def _normalize_line(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip()


def _parse_french_inline_date(line: str) -> str:
    month_map = {
        "janvier": "01",
        "fevrier": "02",
        "février": "02",
        "mars": "03",
        "avril": "04",
        "mai": "05",
        "juin": "06",
        "juillet": "07",
        "aout": "08",
        "août": "08",
        "septembre": "09",
        "octobre": "10",
        "novembre": "11",
        "decembre": "12",
        "décembre": "12",
    }

    match = re.search(r"(\d{1,2})\s+([A-Za-zÀ-ÿ]+)", line)
    if not match:
        return ""

    month = month_map.get(match.group(2).lower())
    if not month:
        return ""

    day = f"{int(match.group(1)):02d}"
    year_match = re.search(r"\b(20\d{2})\b", line)
    year = year_match.group(1) if year_match else str(date.today().year)
    return f"{year}-{month}-{day}"


def _parse_group_header(line: str) -> str:
    match = re.match(r"^[^\w]*(?P<label>[A-Za-z][A-Za-z0-9 ]{1,30}?)(?:\s*\(/?\d+\))?$", line)
    if not match:
        return ""

    label = (match.group("label") or "").strip().upper()
    if not label:
        return ""

    if re.search(r"\b(ATTENDANCE|TITRE|TOTAL|INSTRUCTEUR|PRESENT|PRÉSENT|ABSENT|CONFIRME|CONFIRMÉ)\b", label):
        return ""

    return label


def parse_attendance_message(text: str, lesson_date: str = "") -> ParsedAttendance:
    """
    Parse a structured attendance block.

    Accepted input (new format):

        🔰Classe Ouverte - 164-2C - Eglise Mission d'Impact de la Parole de Dieu
        👩‍🏫Pst Fatoumata AMANKOU
        📝Titre de la leçon : La grâce suffisante
        📆430317          ← org-year date: AA=43 → 1983+43=2026, MM=03, DD=17

        Total : 8 / 10

        👍1- Maxime AMANKOU        (👍 = present)
        👍2- Blandine LIDA
        X 7- Eva MAMBO (raison)    (X  = absent, optional reason)
        ✖️8- Goli Jourdain KAFE
        👍- Dédé Akofa Nou HANVI   (no number is OK)

        ▫️Non registered
        👍1- Kelly NKATIAH

    Legacy format (still accepted): 1- ✅Name / 1- ✖️Name / 1- Name

    Date priority: 📆 in body > lesson_date parameter > today.
    Org-year formula: actual_year = 1983 + AA  (43 → 2026).
    """
    from datetime import date as _date

    if not lesson_date:
        lesson_date = _date.today().isoformat()

    class_code: str = ""
    church_name: str = ""
    teacher_name: str = ""
    lesson_title: str = ""
    registered: list[tuple[str, str, str]] = []
    unregistered: list[str] = []
    absence_notes: dict[str, str] = {}
    in_non_registered = False
    current_group = ""

    for raw_line in text.split("\n"):
        line = _normalize_line(raw_line)
        if not line:
            continue

        # ── Class info: 🔰Classe Ouverte - <code> - <church> ──────────────
        # Accepts optional leading emoji while preserving class codes like 164-2C.
        class_header = re.search(
            r"(?:^|\W)(?:attendance|classe\s+ouverte)\s*-\s*([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)\s*-\s*(.+)$",
            line,
            flags=re.IGNORECASE,
        )
        if class_header:
            class_code = class_header.group(1).strip()
            church_name = class_header.group(2).strip()
            in_non_registered = False
            current_group = ""
            continue

        # ── Teacher: 👩‍🏫<name> ────────────────────────────────────────────
        direct_teacher = re.match(r"^(?:[^\w]*)?(?:pst|pasteur|ev|instructeur)\.?\s+(.+)$", line, flags=re.IGNORECASE)
        if direct_teacher:
            teacher_name = direct_teacher.group(1).strip()
            in_non_registered = False
            current_group = ""
            continue

        # ── Lesson title: 📝Titre de la leçon : <title> ─────────────────
        if re.search(r"titre[^:]*:\s*", line, flags=re.IGNORECASE):
            m = re.search(r":\s*(.+)", line)
            if m:
                lesson_title = m.group(1).strip()
            in_non_registered = False
            current_group = ""
            continue

        # ── Org-year date: 📆AAMMJJ  (actual_year = 1983 + AA) ───────────
        if "📆" in line or re.search(r"\b(\d{6})\b", line):
            dm = re.search(r"(?:📆)?\s*(\d{6})", line)
            if dm:
                code = dm.group(1)
                org_year = int(code[:2])
                month    = int(code[2:4])
                day      = int(code[4:6])
                lesson_date = f"{1983 + org_year:04d}-{month:02d}-{day:02d}"
            in_non_registered = False
            current_group = ""
            continue

        if re.search(r"\b(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b", line, flags=re.IGNORECASE) or re.search(r"(\d{1,2})\s+[A-Za-zÀ-ÿ]+", line):
            inferred_date = _parse_french_inline_date(line)
            if inferred_date:
                lesson_date = inferred_date

            if " - " in line:
                teacher_candidate = line.split(" - ")[-1].strip()
                if teacher_candidate:
                    teacher_name = re.sub(r"\bInstructeur\b", "", teacher_candidate, flags=re.IGNORECASE).strip()
            continue

        # ── Non-registered section marker ─────────────────────────────────
        if re.search(r"non\s*-?\s*inscrit", line, flags=re.IGNORECASE):
            in_non_registered = True
            current_group = ""
            continue

        # ── Skip "Total : …" lines ────────────────────────────────────────
        if re.match(r"^total\s*:", line, re.IGNORECASE):
            continue

        group = _parse_group_header(line)
        if group:
            current_group = group
            in_non_registered = False
            continue

        # ── Student line (emoji-first or legacy number-first format) ──────
        name, status, reason = _parse_student_line(line)
        if name:
            if in_non_registered:
                unregistered.append(name)
                if reason:
                    absence_notes[name] = reason
            else:
                registered.append((name, status, current_group))
                if reason:
                    absence_notes[name] = reason

    return ParsedAttendance(
        class_code=class_code,
        church_name=church_name,
        teacher_name=teacher_name,
        lesson_title=lesson_title,
        lesson_date=lesson_date,
        registered_students=registered,
        unregistered_students=unregistered,
        absence_notes=absence_notes,
        raw_text=text,
    )

