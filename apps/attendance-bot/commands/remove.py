"""
commands/remove.py – /remove command handler.

Syntax: /remove <event_name> <participant_name> [participant_name2 ...]
        (analysé par Gemini pour supporter les noms composés et titres)
"""

from __future__ import annotations

import logging

import uuid

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

import attendance_service as svc
import gemini_parser as gp
from utils.formatters import (
    format_error,
    format_remove_not_found,
    format_remove_success,
)

logger = logging.getLogger(__name__)


async def remove_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not context.args:
        await update.message.reply_text(
            format_error(
                "Usage : /remove `<événement>` `<Prénom Nom>` `[...]`"
            ),
            parse_mode="Markdown",
        )
        return

    parsed = gp.parse_remove_args(" ".join(context.args))
    event_name, participants = parsed.event_name, parsed.participants

    if not event_name:
        await update.message.reply_text(
            format_error("Nom d'événement introuvable. Veuillez réessayer."),
            parse_mode="Markdown",
        )
        return

    if not participants:
        await update.message.reply_text(
            format_error("Aucun participant trouvé. Veuillez inclure au moins un nom."),
            parse_mode="Markdown",
        )
        return

    try:
        candidates = svc.find_event_candidates(event_name)
    except Exception as exc:
        logger.exception("Erreur lors de la recherche d'événements")
        await update.message.reply_text(
            format_error(f"Impossible de récupérer les événements : {exc}"),
            parse_mode="Markdown",
        )
        return

    if not candidates:
        await update.message.reply_text(
            format_error(f"Événement *{event_name}* introuvable.\nUtilisez /events pour voir la liste."),
            parse_mode="Markdown",
        )
        return

    if len(candidates) == 1 and candidates[0].lower() == event_name.strip().lower():
        for name in participants:
            await _execute_remove(update, candidates[0], name)
        return

    key = uuid.uuid4().hex[:8]
    context.user_data[key] = {"candidates": candidates, "participants": participants}
    rows = [[InlineKeyboardButton(name, callback_data=f"ev_rm:{key}:{i}")] for i, name in enumerate(candidates)]
    rows.append([InlineKeyboardButton("❌ Annuler", callback_data=f"ev_cancel:{key}")])
    await update.message.reply_text(
        f"❓ Événement *{event_name}* introuvable. Vouliez-vous dire :",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(rows),
    )


async def remove_event_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
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
    for name in pending["participants"]:
        await _execute_remove(update, event_name, name)


async def _execute_remove(
    update: Update,
    event_name: str,
    participant_name: str,
) -> None:
    try:
        removed = svc.remove_participant(event_name, participant_name)
        if removed:
            await update.effective_message.reply_text(
                format_remove_success(event_name, participant_name),
                parse_mode="Markdown",
            )
        else:
            await update.effective_message.reply_text(
                format_remove_not_found(event_name, participant_name),
                parse_mode="Markdown",
            )

    except Exception as exc:
        logger.exception("Erreur inattendue dans le handler remove")
        await update.effective_message.reply_text(
            format_error(f"Une erreur est survenue : {exc}"), parse_mode="Markdown"
        )
