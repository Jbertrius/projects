"""commands/events.py – /events command handler."""

from __future__ import annotations

import logging

from telegram import Update
from telegram.ext import ContextTypes

import attendance_service as svc
from utils.formatters import format_error, format_events

logger = logging.getLogger(__name__)


async def events_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    try:
        events = svc.list_events()
        await update.message.reply_text(format_events(events), parse_mode="Markdown")
    except Exception as exc:
        logger.exception("Erreur inattendue dans le handler events")
        await update.message.reply_text(
            format_error(f"Une erreur est survenue : {exc}"), parse_mode="Markdown"
        )
