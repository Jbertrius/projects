"""
commands/list_attendance.py – /list command handler.

Syntax: /list <event_name>
"""

from __future__ import annotations

import logging

import uuid

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

import attendance_service as svc
from utils.formatters import format_attendance, format_error
from utils.parser import parse_list_command

logger = logging.getLogger(__name__)


async def list_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not context.args:
        await update.message.reply_text(
            format_error("Usage : /list `<nom_événement>`"),
            parse_mode="Markdown",
        )
        return

    event_name = parse_list_command(context.args)

    candidates = svc.find_event_candidates(event_name)
    if not candidates:
        await update.message.reply_text(
            format_error(f"Événement *{event_name}* introuvable.\nUtilisez /events pour voir la liste."),
            parse_mode="Markdown",
        )
        return

    if len(candidates) == 1 and candidates[0].lower() == event_name.strip().lower():
        await _execute_list(update, candidates[0])
        return

    key = uuid.uuid4().hex[:8]
    context.user_data[key] = {"candidates": candidates}
    rows = [[InlineKeyboardButton(name, callback_data=f"ev_ls:{key}:{i}")] for i, name in enumerate(candidates)]
    rows.append([InlineKeyboardButton("❌ Annuler", callback_data=f"ev_cancel:{key}")])
    await update.message.reply_text(
        f"❓ Événement *{event_name}* introuvable. Vouliez-vous dire :",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(rows),
    )


async def list_event_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    parts = query.data.split(":")
    key, idx = parts[1], int(parts[2])
    pending = context.user_data.pop(key, None)
    if not pending:
        await query.edit_message_text("⚠️ Session expirée. Veuillez réessayer la commande.")
        return
    event_name = pending["candidates"][idx]
    await query.edit_message_text(f"✅ *{event_name}*", parse_mode="Markdown")
    await _execute_list(update, event_name)


async def _execute_list(update: Update, event_name: str) -> None:
    try:
        grouped = svc.list_attendance(event_name)
        await update.effective_message.reply_text(
            format_attendance(event_name, grouped),
            parse_mode="Markdown",
        )

    except Exception as exc:
        logger.exception("Erreur inattendue dans le handler list")
        await update.effective_message.reply_text(
            format_error(f"Une erreur est survenue : {exc}"), parse_mode="Markdown"
        )
