"""
commands/add.py – /add command handler.

Syntax: /add <event_name> <name1> [name2 ...] [category <category_name>]
"""

from __future__ import annotations

import logging

import uuid

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

import attendance_service as svc
import gemini_parser as gp
from utils.formatters import (
    format_add_success,
    format_all_skipped,
    format_error,
)

logger = logging.getLogger(__name__)


async def add_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not context.args:
        await update.message.reply_text(
            format_error(
                "Usage : /add `<événement>` `<Prénom Nom>` `[...]` catégorie `<catégorie>`\n\n"
                "⚠️ La *catégorie* (ex : Membres, Invités) n'est pas le titre de la personne "
                "(ex : Pasteur, Diacre). C'est le groupe auquel elle appartient."
            ),
            parse_mode="Markdown",
        )
        return

    parsed = gp.parse_add_args(" ".join(context.args))
    event_name, participants, category = parsed.event_name, parsed.participants, parsed.category

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

    if not category:
        category = "Guest"

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
        await _execute_add(update, candidates[0], participants, category)
        return

    key = uuid.uuid4().hex[:8]
    context.user_data[key] = {"candidates": candidates, "participants": participants, "category": category}
    rows = [[InlineKeyboardButton(name, callback_data=f"ev_add:{key}:{i}")] for i, name in enumerate(candidates)]
    rows.append([InlineKeyboardButton("❌ Annuler", callback_data=f"ev_cancel:{key}")])
    await update.message.reply_text(
        f"❓ Événement *{event_name}* introuvable. Vouliez-vous dire :",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(rows),
    )


async def add_event_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
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
    await _execute_add(update, event_name, pending["participants"], pending["category"])


async def _execute_add(
    update: Update,
    event_name: str,
    participants: list[str],
    category: str,
) -> None:
    try:
        added = svc.add_participants(event_name, participants, category)
        skipped = [p for p in participants if p not in added]

        if not added:
            await update.effective_message.reply_text(
                format_all_skipped(event_name, participants),
                parse_mode="Markdown",
            )
        else:
            await update.effective_message.reply_text(
                format_add_success(event_name, category, added, skipped or None),
                parse_mode="Markdown",
            )

    except svc.CategoryNotFoundError as exc:
        await update.effective_message.reply_text(format_error(str(exc)), parse_mode="Markdown")
    except Exception as exc:
        logger.exception("Erreur inattendue dans le handler add")
        await update.effective_message.reply_text(
            format_error(f"Une erreur est survenue : {exc}"), parse_mode="Markdown"
        )
