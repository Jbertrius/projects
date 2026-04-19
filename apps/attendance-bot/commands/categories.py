"""commands/categories.py – /categories command handler."""

from __future__ import annotations

import logging

from telegram import Update
from telegram.ext import ContextTypes

import attendance_service as svc
from utils.formatters import format_categories, format_error

logger = logging.getLogger(__name__)


async def categories_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    try:
        categories = svc.list_categories()
        await update.message.reply_text(
            format_categories(categories), parse_mode="Markdown"
        )
    except Exception as exc:
        logger.exception("Erreur inattendue dans le handler categories")
        await update.message.reply_text(
            format_error(f"Une erreur est survenue : {exc}"), parse_mode="Markdown"
        )
