"""Tests pour l'alerte de doublon sur /add et la fusion Calendar+Firestore
sur /list (mannams issus d'un rapport chatgi, sans événement Calendar réel).
Aucune connexion externe requise — Telegram, Calendar et l'API sont mockés.
"""
import asyncio
import sys
import os
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', 'shared', 'python'))

from telegram.ext import ConversationHandler
import bot_core
from bot_core import (
    handle_add_event,
    on_duplicate_confirm_callback,
    cancel_conversation,
    list_events,
    delete_event,
    edit_event,
    _pending_duplicate_confirms,
    _list_cache,
    _list_cache_firestore_ids,
)

EVENT_DETAILS = {
    "summary": "Visite Pasteur Jean", "date": "2026-08-08", "time": "14:00",
    "location": "Paris", "description": "Visite", "mannamjas": "Alice",
    "section": "", "pays": "",
}


def _make_message_update(text: str = "Visite Pasteur Jean le 8 août à 14h", chat_id: int = 1, message_id: int = 42):
    update = MagicMock()
    update.message.text = text
    update.message.message_id = message_id
    update.message.reply_text = AsyncMock()
    update.effective_chat.id = chat_id
    return update


def _make_callback_update(data: str):
    update = MagicMock()
    update.callback_query.data = data
    update.callback_query.answer = AsyncMock()
    update.callback_query.edit_message_text = AsyncMock()
    update.callback_query.message.reply_text = AsyncMock()
    return update


def _fake_calendar_service(event_id: str = "cal_evt_1"):
    service = MagicMock()
    service.events.return_value.insert.return_value.execute.return_value = {
        "id": event_id, "htmlLink": f"https://calendar.google.com/{event_id}",
    }
    return service


# ── handle_add_event : alerte de doublon ────────────────────────────────────

class TestHandleAddEventDuplicateCheck:
    def setup_method(self):
        _pending_duplicate_confirms.clear()

    def test_no_duplicate_creates_event_directly(self):
        update = _make_message_update()
        with patch.object(bot_core, "normalize_event_with_gemini", return_value=EVENT_DETAILS), \
             patch.object(bot_core.api_client, "check_duplicate_mannam", return_value={"duplicate": False}), \
             patch.object(bot_core, "get_calendar_service", return_value=_fake_calendar_service()), \
             patch.object(bot_core, "_sync_mannam_to_api", return_value={"match": "exact"}) as mock_sync:
            result = asyncio.run(handle_add_event(update, None))

        assert result == ConversationHandler.END
        mock_sync.assert_called_once()
        assert not _pending_duplicate_confirms
        texts = [c.args[0] for c in update.message.reply_text.call_args_list]
        assert any("🎉 Événement créé" in t for t in texts)

    def test_duplicate_shows_confirm_prompt_and_does_not_create(self):
        update = _make_message_update(chat_id=1, message_id=42)
        dup = {"duplicate": True, "mannamId": "m1", "pastorName": "Pasteur Jean", "summary": "Visite Jean"}
        with patch.object(bot_core, "normalize_event_with_gemini", return_value=EVENT_DETAILS), \
             patch.object(bot_core.api_client, "check_duplicate_mannam", return_value=dup), \
             patch.object(bot_core, "get_calendar_service") as mock_service:
            result = asyncio.run(handle_add_event(update, None))

        assert result == ConversationHandler.END
        mock_service.assert_not_called()
        token = "1:42"
        assert token in _pending_duplicate_confirms
        assert _pending_duplicate_confirms[token]["event_details"] == EVENT_DETAILS
        texts = [c.args[0] for c in update.message.reply_text.call_args_list]
        assert any("existe déjà" in t and "Pasteur Jean" in t for t in texts)

    def test_check_duplicate_exception_falls_back_to_direct_creation(self):
        # Un souci réseau sur la vérification ne doit jamais bloquer /add.
        update = _make_message_update()
        with patch.object(bot_core, "normalize_event_with_gemini", return_value=EVENT_DETAILS), \
             patch.object(bot_core.api_client, "check_duplicate_mannam", side_effect=ValueError("HTTP 500")), \
             patch.object(bot_core, "get_calendar_service", return_value=_fake_calendar_service()), \
             patch.object(bot_core, "_sync_mannam_to_api", return_value={"match": "exact"}):
            result = asyncio.run(handle_add_event(update, None))

        assert result == ConversationHandler.END
        texts = [c.args[0] for c in update.message.reply_text.call_args_list]
        assert any("🎉 Événement créé" in t for t in texts)


class TestOnDuplicateConfirmCallback:
    def setup_method(self):
        _pending_duplicate_confirms.clear()

    def test_yes_creates_the_event(self):
        _pending_duplicate_confirms["1:42"] = {"event_details": EVENT_DETAILS}
        update = _make_callback_update("dc|1:42|yes")
        with patch.object(bot_core, "get_calendar_service", return_value=_fake_calendar_service()), \
             patch.object(bot_core, "_sync_mannam_to_api", return_value={"match": "exact"}) as mock_sync:
            asyncio.run(on_duplicate_confirm_callback(update, None))

        mock_sync.assert_called_once()
        assert "1:42" not in _pending_duplicate_confirms
        update.callback_query.message.reply_text.assert_any_call(
            "🎉 Événement créé : https://calendar.google.com/cal_evt_1",
        )

    def test_no_cancels_without_creating(self):
        _pending_duplicate_confirms["1:42"] = {"event_details": EVENT_DETAILS}
        update = _make_callback_update("dc|1:42|no")
        with patch.object(bot_core, "get_calendar_service") as mock_service:
            asyncio.run(on_duplicate_confirm_callback(update, None))

        mock_service.assert_not_called()
        assert "1:42" not in _pending_duplicate_confirms
        update.callback_query.edit_message_text.assert_called_with("❌ Création annulée.")

    def test_expired_token_shows_expiry_message(self):
        update = _make_callback_update("dc|unknown:1|yes")
        asyncio.run(on_duplicate_confirm_callback(update, None))
        text = update.callback_query.edit_message_text.call_args[0][0]
        assert "expiré" in text.lower()


# ── /list : fusion Calendar + mannams chatgi ────────────────────────────────

def _make_list_update(chat_id: int = 1):
    update = MagicMock()
    update.effective_chat.id = chat_id
    update.message.reply_text = AsyncMock()
    return update


class TestListEventsMergesFirestoreMannams:
    def setup_method(self):
        _list_cache.clear()
        _list_cache_firestore_ids.clear()

    def test_merges_and_marks_firestore_only_entries(self):
        calendar_service = MagicMock()
        calendar_service.events.return_value.list.return_value.execute.return_value = {
            "items": [{
                "id": "cal_1", "summary": "Visite Calendar",
                "start": {"dateTime": "2026-08-06T10:00:00+02:00"},
                "description": "desc", "location": "Paris",
            }],
        }
        firestore_mannams = [{
            "id": "fs_1", "summary": "Mannam Chatgi X", "date": "2026-08-07",
            "time": "09:00", "location": "Lyon",
        }]
        update = _make_list_update(chat_id=1)
        with patch.object(bot_core, "get_calendar_service", return_value=calendar_service), \
             patch.object(bot_core.api_client, "get_mannams_without_calendar_event",
                          return_value=firestore_mannams):
            asyncio.run(list_events(update, None))

        assert _list_cache[1] == ["cal_1", "fs_1"]
        assert _list_cache_firestore_ids[1] == {"fs_1"}
        text = update.message.reply_text.call_args[0][0]
        assert "[1]" in text and "Visite Calendar" in text
        assert "[2]" in text and "Mannam Chatgi X" in text
        assert "🧡" in text

    def test_calendar_and_firestore_items_on_same_date_do_not_crash(self):
        # Google Calendar renvoie un dateTime avec offset (tz-aware) ; les
        # mannams chatgi (Firestore) sont naïfs. Les deux sur la même date
        # doivent être triables ensemble sans TypeError (bug réel observé
        # en prod : "can't compare offset-naive and offset-aware datetimes").
        calendar_service = MagicMock()
        calendar_service.events.return_value.list.return_value.execute.return_value = {
            "items": [{
                "id": "cal_1", "summary": "Visite Calendar",
                "start": {"dateTime": "2026-08-07T10:00:00+02:00"},
                "description": "", "location": "Paris",
            }],
        }
        firestore_mannams = [{
            "id": "fs_1", "summary": "Mannam Chatgi Same Day", "date": "2026-08-07",
            "time": "09:00", "location": "Lyon",
        }]
        update = _make_list_update(chat_id=1)
        with patch.object(bot_core, "get_calendar_service", return_value=calendar_service), \
             patch.object(bot_core.api_client, "get_mannams_without_calendar_event",
                          return_value=firestore_mannams):
            asyncio.run(list_events(update, None))

        # 09:00 (firestore) doit passer avant 10:00 (calendar) dans le tri.
        assert _list_cache[1] == ["fs_1", "cal_1"]
        text = update.message.reply_text.call_args[0][0]
        assert "Mannam Chatgi Same Day" in text
        assert "Visite Calendar" in text

    def test_no_calendar_events_but_firestore_mannams_still_shown(self):
        calendar_service = MagicMock()
        calendar_service.events.return_value.list.return_value.execute.return_value = {"items": []}
        firestore_mannams = [{
            "id": "fs_1", "summary": "Mannam Chatgi Only", "date": "2026-08-07",
            "time": "", "location": "",
        }]
        update = _make_list_update()
        with patch.object(bot_core, "get_calendar_service", return_value=calendar_service), \
             patch.object(bot_core.api_client, "get_mannams_without_calendar_event",
                          return_value=firestore_mannams):
            asyncio.run(list_events(update, None))

        assert _list_cache[1] == ["fs_1"]
        text = update.message.reply_text.call_args[0][0]
        assert "Mannam Chatgi Only" in text

    def test_firestore_fetch_failure_still_shows_calendar_events(self):
        calendar_service = MagicMock()
        calendar_service.events.return_value.list.return_value.execute.return_value = {
            "items": [{
                "id": "cal_1", "summary": "Visite Calendar",
                "start": {"dateTime": "2026-08-06T10:00:00+02:00"},
                "description": "", "location": "Paris",
            }],
        }
        update = _make_list_update()
        with patch.object(bot_core, "get_calendar_service", return_value=calendar_service), \
             patch.object(bot_core.api_client, "get_mannams_without_calendar_event",
                          side_effect=ValueError("HTTP 500")):
            asyncio.run(list_events(update, None))

        assert _list_cache[1] == ["cal_1"]
        assert _list_cache_firestore_ids.get(1, set()) == set()

    def test_nothing_at_all_shows_no_events_message(self):
        calendar_service = MagicMock()
        calendar_service.events.return_value.list.return_value.execute.return_value = {"items": []}
        update = _make_list_update()
        with patch.object(bot_core, "get_calendar_service", return_value=calendar_service), \
             patch.object(bot_core.api_client, "get_mannams_without_calendar_event", return_value=[]):
            asyncio.run(list_events(update, None))

        update.message.reply_text.assert_called_once_with("No events scheduled for this week.")

    def test_malformed_time_does_not_crash_the_whole_command(self):
        # Un mannam chatgi avec une heure mal formée (texte libre non
        # normalisé côté source) ne doit jamais faire planter /list pour
        # tout le monde — repli sur minuit plutôt qu'une exception.
        calendar_service = MagicMock()
        calendar_service.events.return_value.list.return_value.execute.return_value = {"items": []}
        firestore_mannams = [{
            "id": "fs_1", "summary": "Mannam Chatgi Bad Time", "date": "2026-08-07",
            "time": "19H30", "location": "",
        }]
        update = _make_list_update()
        with patch.object(bot_core, "get_calendar_service", return_value=calendar_service), \
             patch.object(bot_core.api_client, "get_mannams_without_calendar_event",
                          return_value=firestore_mannams):
            asyncio.run(list_events(update, None))

        assert _list_cache[1] == ["fs_1"]
        text = update.message.reply_text.call_args[0][0]
        assert "Mannam Chatgi Bad Time" in text


class TestCancelConversation:
    def test_replies_and_ends_conversation(self):
        update = _make_list_update()
        result = asyncio.run(cancel_conversation(update, None))
        assert result == ConversationHandler.END
        update.message.reply_text.assert_called_once_with("❌ Annulé.")


# ── /delete et /edit : branchement Firestore-only ───────────────────────────

def _make_command_update(chat_id: int, args: list[str]):
    update = MagicMock()
    update.effective_chat.id = chat_id
    update.message.reply_text = AsyncMock()
    context = MagicMock()
    context.args = args
    return update, context


class TestDeleteEventFirestoreOnly:
    def setup_method(self):
        _list_cache.clear()
        _list_cache_firestore_ids.clear()

    def test_firestore_only_entry_deletes_via_api_not_calendar(self):
        _list_cache[1] = ["cal_1", "fs_1"]
        _list_cache_firestore_ids[1] = {"fs_1"}
        update, context = _make_command_update(1, ["2"])
        with patch.object(bot_core, "get_calendar_service") as mock_service, \
             patch.object(bot_core.api_client, "delete_meeting") as mock_delete:
            asyncio.run(delete_event(update, context))

        mock_service.assert_not_called()
        mock_delete.assert_called_once_with("fs_1")
        assert _list_cache[1] == ["cal_1"]
        assert "fs_1" not in _list_cache_firestore_ids[1]
        text = update.message.reply_text.call_args[0][0]
        assert "supprimé" in text

    def test_calendar_entry_still_uses_calendar_api(self):
        _list_cache[1] = ["cal_1"]
        _list_cache_firestore_ids[1] = set()
        update, context = _make_command_update(1, ["1"])
        calendar_service = MagicMock()
        with patch.object(bot_core, "get_calendar_service", return_value=calendar_service), \
             patch.object(bot_core, "_delete_mannam_from_api") as mock_delete_api:
            asyncio.run(delete_event(update, context))

        calendar_service.events.return_value.delete.assert_called_once_with(
            calendarId=bot_core.CALENDAR_ID, eventId="cal_1",
        )
        mock_delete_api.assert_called_once_with("cal_1")


class TestEditEventFirestoreOnly:
    def setup_method(self):
        _list_cache.clear()
        _list_cache_firestore_ids.clear()

    def test_firestore_only_entry_declines_edit(self):
        _list_cache[1] = ["fs_1"]
        _list_cache_firestore_ids[1] = {"fs_1"}
        update, context = _make_command_update(1, ["1"])
        with patch.object(bot_core, "get_calendar_service") as mock_service:
            result = asyncio.run(edit_event(update, context))

        mock_service.assert_not_called()
        assert result == ConversationHandler.END
        text = update.message.reply_text.call_args[0][0]
        assert "chatgi" in text.lower()
        assert "/edit" in text
