"""Entrypoint PRODUCTION — webhook."""
import os
from bot_core import build_app


def main():
    BOT_TOKEN = os.getenv("BOT_TOKEN")
    if not BOT_TOKEN:
        raise EnvironmentError("Variable d'env BOT_TOKEN manquante.")
    DOMAIN    = os.getenv('DOMAIN', 'fb21-2001-861-3f0b-b7a0-4c10-b0ae-38fb-f150.ngrok-free.app')
    PORT      = int(os.getenv('PORT', 8000))

    app = build_app(BOT_TOKEN)
    app.run_webhook(
        listen="0.0.0.0",
        port=PORT,
        url_path=BOT_TOKEN,
        webhook_url=f"{DOMAIN}/{BOT_TOKEN}",
    )


if __name__ == '__main__':
    main()
