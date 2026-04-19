"""
bot.py – Main entry point for the Telegram Attendance Bot.

Deployment mode
---------------
Cloud Run delivers HTTP requests; Telegram pushes updates to the bot via a
webhook.  python-telegram-bot >= 20 uses asyncio and ships its own aiohttp-
based HTTP server that handles webhook calls, so no separate web framework is
required.

The flow on Cloud Run:
  1. Container starts → bot.py runs → registers webhook with Telegram.
  2. Cloud Run exposes port $PORT → nginx / Cloud Run proxy forwards HTTPS.
  3. Telegram POSTs each update to https://<service-url>/webhook/<TOKEN>.
  4. python-telegram-bot dispatches to the correct handler.
  5. A /health endpoint is exposed for Cloud Run health checks.
"""

from __future__ import annotations

import logging
import os
import sys

from telegram import BotCommand, Update
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
)

import config
from commands.add import add_event_callback, add_handler
from commands.categories import categories_handler
from commands.classreport import absentees_handler, classreport_handler, studentreport_handler
from commands.events import events_handler
from commands.lesson import newlesson_handler
from commands.list_attendance import list_event_callback, list_handler
from commands.remove import remove_event_callback, remove_handler
from utils.formatters import format_help

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)


# ── /start and /help ──────────────────────────────────────────────────────────

async def cancel_callback(update: Update, context) -> None:
    query = update.callback_query
    await query.answer()
    key = query.data.split(":")[1]
    context.user_data.pop(key, None)
    await query.edit_message_text("❌ Opération annulée.")


async def start_handler(update: Update, context) -> None:
    await update.message.reply_text(format_help(), parse_mode="Markdown")


async def help_handler(update: Update, context) -> None:
    await update.message.reply_text(format_help(), parse_mode="Markdown")


# ── Application factory ───────────────────────────────────────────────────────

BOT_COMMANDS = [
    BotCommand("start",         "Afficher l'aide"),
    BotCommand("help",          "Afficher l'aide"),
    BotCommand("add",           "Ajouter des participants à un événement"),
    BotCommand("remove",        "Retirer un participant d'un événement"),
    BotCommand("list",          "Afficher la liste de présences"),
    BotCommand("events",        "Voir tous les événements"),
    BotCommand("categories",    "Voir toutes les catégories"),
    BotCommand("newlesson",     "Enregistrer une leçon (coller le bloc d'appel)"),
    BotCommand("classreport",   "Rapport d'assiduité d'une classe"),
    BotCommand("studentreport", "Suivi d'assiduité d'un étudiant"),
    BotCommand("absentees",     "Liste des absents par leçon"),
]


async def _post_init(application: Application) -> None:
    """Déclaration des commandes auprès de Telegram (menu '/')."""
    await application.bot.set_my_commands(BOT_COMMANDS)
    logger.info("Bot commands registered with Telegram.")


def build_application() -> Application:
    app = Application.builder().token(config.TELEGRAM_BOT_TOKEN).post_init(_post_init).build()

    # ── Commands
    app.add_handler(CommandHandler("start",         start_handler))
    app.add_handler(CommandHandler("help",          help_handler))
    app.add_handler(CommandHandler("add",           add_handler))
    app.add_handler(CommandHandler("remove",        remove_handler))
    app.add_handler(CommandHandler("list",          list_handler))
    app.add_handler(CommandHandler("events",        events_handler))
    app.add_handler(CommandHandler("categories",    categories_handler))
    app.add_handler(CommandHandler("newlesson",     newlesson_handler))
    app.add_handler(CommandHandler("classreport",   classreport_handler))
    app.add_handler(CommandHandler("studentreport", studentreport_handler))
    app.add_handler(CommandHandler("absentees",     absentees_handler))

    # ── Inline keyboard callbacks (résolution floue des événements)
    app.add_handler(CallbackQueryHandler(add_event_callback, pattern=r"^ev_add:"))
    app.add_handler(CallbackQueryHandler(remove_event_callback, pattern=r"^ev_rm:"))
    app.add_handler(CallbackQueryHandler(list_event_callback, pattern=r"^ev_ls:"))
    app.add_handler(CallbackQueryHandler(cancel_callback, pattern=r"^ev_cancel:"))

    return app


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    app = build_application()

    webhook_url = config.WEBHOOK_URL.rstrip("/")
    secret_path = f"webhook/{config.TELEGRAM_BOT_TOKEN}"

    if webhook_url:
        # ── Production: Cloud Run webhook mode
        logger.info(
            "Starting webhook on port %d | path /%s", config.PORT, secret_path
        )
        app.run_webhook(
            listen="0.0.0.0",
            port=config.PORT,
            url_path=secret_path,
            webhook_url=f"{webhook_url}/{secret_path}",
            # Expose /health for Cloud Run health checks via a custom route
            allowed_updates=Update.ALL_TYPES,
        )
    else:
        # ── Local development: long-polling (no public URL needed)
        logger.info("No WEBHOOK_URL set – starting in long-polling mode")
        app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
