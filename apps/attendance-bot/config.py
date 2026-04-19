"""
config.py – Centralised configuration loaded from environment variables.
All secrets are injected via Cloud Run env vars or Secret Manager.
"""
import os

from dotenv import load_dotenv

load_dotenv()

# ── Telegram ──────────────────────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN: str = os.getenv("TELEGRAM_BOT_TOKEN", "")

# Public HTTPS URL of the Cloud Run service, e.g.
# https://attendance-bot-xxxx-uc.a.run.app
WEBHOOK_URL: str = os.getenv("WEBHOOK_URL", "")

# Cloud Run injects PORT automatically (default 8080)
PORT: int = int(os.getenv("PORT", "8080"))

# ── Gemini ────────────────────────────────────────────────────────────────────
GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
