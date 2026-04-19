"""
commands/lesson.py – /newlesson command handler.

Usage (multi-line Telegram message):

    /newlesson
    🔰Classe Ouverte - 164-2C - Eglise Mission d'Impact de la Parole de Dieu
    👩‍🏫Pst Fatoumata AMANKOU
    📝Titre de la leçon : Introduction à la foi
    Total : 8 / 10
    1- ✅Maxime AMANKOU
    2- ✖️Blandine LIDA
    …
    ▫️Non registered
    1- Kelly NKATIAH

You may optionally prepend a date (YYYY-MM-DD or DD/MM/YYYY) on the first
line after /newlesson; otherwise today's date is used.
"""

from __future__ import annotations

import logging
import re

from telegram import Update
from telegram.ext import ContextTypes

import attendance_service as svc
import gemini_parser as gp
from utils.formatters import format_error, format_lesson_recorded

logger = logging.getLogger(__name__)

_DATE_ISO   = re.compile(r"^(\d{4}-\d{2}-\d{2})")
_DATE_DMY   = re.compile(r"^(\d{2}/\d{2}/\d{4})")
_DATE_ORG   = re.compile(r"^📆(\d{6})")   # org-year format embedded in body
_CMD_PREFIX = re.compile(r"^/newlesson\S*\s*", re.IGNORECASE)

_USAGE = (
    "📋 *Nouvelle leçon*\n\n"
    "Collez le bloc d'appel directement après la commande :\n\n"
    "`/newlesson`\n"
    "`🔰Classe Ouverte - 164-2C - Eglise Mission d'Impact...`\n"
    "`👩‍🏫Pst Fatoumata AMANKOU`\n"
    "`📝Titre de la leçon : La grâce suffisante`\n"
    "`📆430317`  _(date : 43=2026, 03=mars, 17=17)_\n"
    "`Total : X / N`\n\n"
    "`👍1- Maxime AMANKOU`  _(👍 = présent)_\n"
    "`X 7- Eva MAMBO (raison)`  _(X = absent)_\n"
    "`✖️8- Goli Jourdain KAFE`\n"
    "`👍- Dédé Akofa Nou HANVI`  _(sans numéro)_\n\n"
    "▫️Non registered\n"
    "`👍1- Kelly NKATIAH`\n\n"
    "💡 La date 📆 dans le bloc est prioritaire.\n"
    "Sinon, ajoutez une date en 1ʳᵉ ligne : `2026-03-17` ou `17/03/2026`."
)


async def newlesson_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    body = _CMD_PREFIX.sub("", update.message.text or "").strip()

    if not body:
        await update.message.reply_text(_USAGE, parse_mode="Markdown")
        return

    # Optional date on the first line
    lesson_date = ""
    lines = body.split("\n")
    first = lines[0].strip()

    m_iso = _DATE_ISO.match(first)
    m_dmy = _DATE_DMY.match(first)
    if m_iso:
        lesson_date = m_iso.group(1)
        body = "\n".join(lines[1:]).strip()
    elif m_dmy:
        d, mo, y = m_dmy.group(1).split("/")
        lesson_date = f"{y}-{mo}-{d}"
        body = "\n".join(lines[1:]).strip()

    if not body:
        await update.message.reply_text(_USAGE, parse_mode="Markdown")
        return

    parsed = gp.parse_attendance_message(body, lesson_date)

    if not parsed.class_code:
        await update.message.reply_text(
            format_error(
                "Code de classe introuvable.\n"
                "Assurez-vous que le message contient la ligne 🔰 "
                "(ex : `🔰Classe Ouverte - 164-2C - Eglise...`)."
            ),
            parse_mode="Markdown",
        )
        return

    if not parsed.lesson_title:
        await update.message.reply_text(
            format_error(
                "Titre de la leçon introuvable.\n"
                "Assurez-vous d'inclure la ligne 📝 "
                "(ex : `📝Titre de la leçon : Mon titre`)."
            ),
            parse_mode="Markdown",
        )
        return

    try:
        result = svc.record_lesson(parsed)
        await update.message.reply_text(
            format_lesson_recorded(result),
            parse_mode="Markdown",
        )
    except svc.AttendanceError as exc:
        await update.message.reply_text(
            f"\u26a0\ufe0f {exc}",
            parse_mode="Markdown",
        )
    except Exception:
        logger.exception("Error in /newlesson")
        await update.message.reply_text(
            format_error("Une erreur s'est produite lors de l'enregistrement. R\u00e9essayez."),
            parse_mode="Markdown",
        )
