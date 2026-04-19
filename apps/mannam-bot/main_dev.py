"""
Entrypoint DÉVELOPPEMENT LOCAL — polling (pas de webhook, pas de domaine public requis).

Usage :
    1. Copier .env.example → .env et remplir les valeurs
    2. pip install python-dotenv
    3. python main_dev.py
"""
import logging
import os

try:
    from dotenv import load_dotenv
    load_dotenv()
    logging.info(".env chargé avec python-dotenv")
except ImportError:
    logging.warning("python-dotenv non installé. Variables d'env chargées depuis le système.")

from telegram import Update
from bot_core import build_app


def main():
    BOT_TOKEN = os.getenv("BOT_TOKEN")
    if not BOT_TOKEN:
        raise EnvironmentError("Variable d'env BOT_TOKEN manquante. Vérifiez votre .env")

    app = build_app(BOT_TOKEN)
    logging.info("Démarrage en mode POLLING (développement local)...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == '__main__':
    main()
