"""
firestore_sync.py – Meeting persistence via the central web-app API.

Direct Firestore access has been removed. All writes and deletes now go
through the central API (api_client). Ensure API_BASE_URL and BOT_API_KEY
are set in the environment before running the bot.
"""

import logging

import api_client

logger = logging.getLogger(__name__)


def upsert_mannam_event(event_id: str, event_details: dict) -> None:
    """
    Persist a mannam meeting via the central API.
    Raises RuntimeError if the API is not configured.
    """
    if not api_client.is_configured():
        raise RuntimeError(
            "API_BASE_URL et BOT_API_KEY doivent être configurés. "
            "Contactez l'administrateur."
        )
    api_client.upsert_meeting(event_id, event_details)
    logger.info("Mannam event synced via API: %s", event_id)


def delete_mannam_event(event_id: str) -> None:
    """
    Delete a mannam meeting via the central API.
    Logs a warning and continues if the API is not configured.
    """
    if not api_client.is_configured():
        logger.warning(
            "API_BASE_URL/BOT_API_KEY not set — cannot delete event %s", event_id
        )
        return
    try:
        api_client.delete_meeting(event_id)
        logger.info("Mannam event deleted via API: %s", event_id)
    except Exception as exc:
        logger.warning("Could not delete mannam event %s via API: %s", event_id, exc)
