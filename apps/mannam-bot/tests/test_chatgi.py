"""Tests unitaires pour la fonctionnalité de rapport chatgi (#chatgui, SUBAE
FORM). Aucune connexion externe requise (Telegram, Gemini, API) — tout est
mocké. Lancer : python -m pytest tests/ -v
"""
import asyncio
import json
import sys
import os
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', 'shared', 'python'))

import bot_core
from bot_core import (
    _convert_sck_date,
    _chatgi_totals,
    normalize_chatgi_with_gemini,
    on_chatgi_report,
)

SUBAE_MESSAGE = """🌞 SUBAE FORM - 43.08.05
👥Groupe : Centre

🌱 Today's seed:

🌐Lien : https://us06web.zoom.us/j/2468787033?pwd=MXU2M1FwSnA5SldwL1g3K09QcW94QT09


➖➖➖➖➖➖➖➖➖➖➖

👨🏽‍🌾NBJNs :

🔥Totaux : 🌾:  ☎️:  👤:


➖➖➖
📍OTW :  🌾:0  ☎️:1 👤:2
🐴Kyung-Mi 🌾:0 ☎️: 1👤:2
🧡Pasteur Stéphane mannam Samedi 430808 13:30 Sarcelles
🧡Pasteur Samuel Kalaki LS vendredi 430807 19H30


➖➖
☎️TM

➖➖➖
📱FU

➖➖➖
@saehaneulsaettang SMN @Gyeojassi TJN
#chatgui"""

GEMINI_CHATGI_JSON = json.dumps({
    "date": "43.08.05",
    "groupe": "centre",
    # "📍OTW" est un en-tête de lieu (ses chiffres sont ceux de Kyung-Mi,
    # listée juste en dessous dans le message d'origine) — un Gemini qui
    # suit correctement la consigne ne le retourne pas comme une entrée.
    "entries": [
        {"person": "Kyung-Mi", "recherche": 0, "appels": 1, "chatgi": 2},
    ],
    "mannams": [
        {"figure_name": "Pasteur Stéphane", "event_type": "mannam",
         "date": "430808", "time": "13:30", "location": "Sarcelles"},
        {"figure_name": "Pasteur Samuel Kalaki", "event_type": "ls",
         "date": "430807", "time": "19H30", "location": ""},
    ],
})


def _make_gemini_response(text: str):
    resp = MagicMock()
    resp.text = text
    return resp


# ── _convert_sck_date ────────────────────────────────────────────────────────

class TestConvertSckDate:
    def test_dotted_format(self):
        assert _convert_sck_date("43.08.05") == "2026-08-05"

    def test_compact_format(self):
        assert _convert_sck_date("430808") == "2026-08-08"

    def test_dashed_format(self):
        assert _convert_sck_date("43-08-05") == "2026-08-05"

    def test_already_iso_passthrough(self):
        assert _convert_sck_date("2026-08-05") == "2026-08-05"

    def test_unrecognized_text_passthrough(self):
        assert _convert_sck_date("mercredi") == "mercredi"

    def test_empty_string(self):
        assert _convert_sck_date("") == ""


# ── _chatgi_totals ─────────────────────────────────────────────────────────────

class TestChatgiTotals:
    def test_sums_multiple_entries(self):
        entries = [
            {"person": "OTW", "recherche": 0, "appels": 1, "chatgi": 2},
            {"person": "Kyung-Mi", "recherche": 3, "appels": 1, "chatgi": 2},
        ]
        assert _chatgi_totals(entries) == {"recherche": 3, "appels": 2, "chatgi": 4}

    def test_empty_entries_gives_zero(self):
        assert _chatgi_totals([]) == {"recherche": 0, "appels": 0, "chatgi": 0}


# ── normalize_chatgi_with_gemini ─────────────────────────────────────────────

class TestNormalizeChatgiWithGemini:
    def test_extracts_key_fields_from_real_example(self):
        fake_client = MagicMock()
        fake_client.models.generate_content.return_value = _make_gemini_response(GEMINI_CHATGI_JSON)
        with patch.object(bot_core, "_gemini_client", fake_client):
            result = normalize_chatgi_with_gemini(SUBAE_MESSAGE)
        assert result is not None
        assert result["date"] == "43.08.05"
        assert result["groupe"] == "centre"
        assert len(result["entries"]) == 1
        assert result["entries"][0] == {"person": "Kyung-Mi", "recherche": 0, "appels": 1, "chatgi": 2}
        assert len(result["mannams"]) == 2
        assert result["mannams"][0]["figure_name"] == "Pasteur Stéphane"
        assert result["mannams"][0]["event_type"] == "mannam"
        assert result["mannams"][0]["date"] == "430808"
        # "LS" est un mot-clé de type d'événement, pas une partie du nom
        assert result["mannams"][1]["figure_name"] == "Pasteur Samuel Kalaki"
        assert result["mannams"][1]["event_type"] == "ls"

    def test_invalid_groupe_normalized_to_empty(self):
        payload = json.loads(GEMINI_CHATGI_JSON)
        payload["groupe"] = "Centre "  # variante de casse/espace
        fake_client = MagicMock()
        fake_client.models.generate_content.return_value = _make_gemini_response(json.dumps(payload))
        with patch.object(bot_core, "_gemini_client", fake_client):
            result = normalize_chatgi_with_gemini(SUBAE_MESSAGE)
        assert result["groupe"] == "centre"  # trim + lower doit matcher

    def test_missing_groupe_returns_empty_string(self):
        payload = json.loads(GEMINI_CHATGI_JSON)
        payload["groupe"] = ""
        fake_client = MagicMock()
        fake_client.models.generate_content.return_value = _make_gemini_response(json.dumps(payload))
        with patch.object(bot_core, "_gemini_client", fake_client):
            result = normalize_chatgi_with_gemini(SUBAE_MESSAGE)
        assert result["groupe"] == ""

    def test_garbage_groupe_returns_empty_string(self):
        payload = json.loads(GEMINI_CHATGI_JSON)
        payload["groupe"] = "autre chose"
        fake_client = MagicMock()
        fake_client.models.generate_content.return_value = _make_gemini_response(json.dumps(payload))
        with patch.object(bot_core, "_gemini_client", fake_client):
            result = normalize_chatgi_with_gemini(SUBAE_MESSAGE)
        assert result["groupe"] == ""

    def test_mannam_without_figure_name_is_dropped(self):
        payload = json.loads(GEMINI_CHATGI_JSON)
        payload["mannams"].append({"figure_name": "", "date": "430809", "time": "", "location": ""})
        fake_client = MagicMock()
        fake_client.models.generate_content.return_value = _make_gemini_response(json.dumps(payload))
        with patch.object(bot_core, "_gemini_client", fake_client):
            result = normalize_chatgi_with_gemini(SUBAE_MESSAGE)
        assert len(result["mannams"]) == 2  # le 3e (vide) est ignoré

    def test_missing_event_type_defaults_to_mannam(self):
        payload = json.loads(GEMINI_CHATGI_JSON)
        del payload["mannams"][0]["event_type"]
        fake_client = MagicMock()
        fake_client.models.generate_content.return_value = _make_gemini_response(json.dumps(payload))
        with patch.object(bot_core, "_gemini_client", fake_client):
            result = normalize_chatgi_with_gemini(SUBAE_MESSAGE)
        assert result["mannams"][0]["event_type"] == "mannam"

    def test_unrecognized_event_type_defaults_to_mannam(self):
        payload = json.loads(GEMINI_CHATGI_JSON)
        payload["mannams"][0]["event_type"] = "autre"
        fake_client = MagicMock()
        fake_client.models.generate_content.return_value = _make_gemini_response(json.dumps(payload))
        with patch.object(bot_core, "_gemini_client", fake_client):
            result = normalize_chatgi_with_gemini(SUBAE_MESSAGE)
        assert result["mannams"][0]["event_type"] == "mannam"

    def test_event_type_case_and_whitespace_normalized(self):
        payload = json.loads(GEMINI_CHATGI_JSON)
        payload["mannams"][1]["event_type"] = " LS "
        fake_client = MagicMock()
        fake_client.models.generate_content.return_value = _make_gemini_response(json.dumps(payload))
        with patch.object(bot_core, "_gemini_client", fake_client):
            result = normalize_chatgi_with_gemini(SUBAE_MESSAGE)
        assert result["mannams"][1]["event_type"] == "ls"

    def test_non_numeric_counters_default_to_zero(self):
        payload = json.loads(GEMINI_CHATGI_JSON)
        payload["entries"] = [{"person": "X", "recherche": "beaucoup", "appels": None, "chatgi": 3}]
        fake_client = MagicMock()
        fake_client.models.generate_content.return_value = _make_gemini_response(json.dumps(payload))
        with patch.object(bot_core, "_gemini_client", fake_client):
            result = normalize_chatgi_with_gemini(SUBAE_MESSAGE)
        assert result["entries"][0] == {"person": "X", "recherche": 0, "appels": 0, "chatgi": 3}

    def test_location_header_entry_is_dropped_even_if_gemini_includes_it(self):
        # Filet de sécurité côté code : même si Gemini n'a pas suivi la
        # consigne et renvoie quand même la ligne "📍<lieu>", elle ne doit
        # jamais compter en plus de la personne listée sous elle (double
        # comptage des mêmes chiffres).
        payload = json.loads(GEMINI_CHATGI_JSON)
        payload["entries"].insert(0, {"person": "📍OTW", "recherche": 0, "appels": 1, "chatgi": 2})
        fake_client = MagicMock()
        fake_client.models.generate_content.return_value = _make_gemini_response(json.dumps(payload))
        with patch.object(bot_core, "_gemini_client", fake_client):
            result = normalize_chatgi_with_gemini(SUBAE_MESSAGE)
        assert len(result["entries"]) == 1
        assert result["entries"][0]["person"] == "Kyung-Mi"

    def test_no_gemini_client_returns_none(self):
        with patch.object(bot_core, "_gemini_client", None):
            assert normalize_chatgi_with_gemini(SUBAE_MESSAGE) is None

    def test_gemini_exception_returns_none(self):
        fake_client = MagicMock()
        fake_client.models.generate_content.side_effect = RuntimeError("boom")
        with patch.object(bot_core, "_gemini_client", fake_client):
            assert normalize_chatgi_with_gemini(SUBAE_MESSAGE) is None


# ── on_chatgi_report ─────────────────────────────────────────────────────────

def _make_update(text: str, chat_id: int = 1, message_id: int = 100):
    update = MagicMock()
    update.message.text = text
    update.message.message_id = message_id
    update.message.reply_text = AsyncMock()
    update.effective_chat.id = chat_id
    return update


FAKE_FIELDS = {
    "date": "43.08.05",
    "groupe": "centre",
    "entries": [
        {"person": "Kyung-Mi", "recherche": 0, "appels": 1, "chatgi": 2},
    ],
    "mannams": [
        {"figure_name": "Pasteur Stéphane", "event_type": "mannam",
         "date": "430808", "time": "13:30", "location": "Sarcelles"},
    ],
}


class TestOnChatgiReport:
    def test_happy_path_submits_report_and_upserts_mannam(self):
        update = _make_update(SUBAE_MESSAGE, chat_id=1, message_id=42)
        with patch.object(bot_core, "normalize_chatgi_with_gemini", return_value=FAKE_FIELDS), \
             patch.object(bot_core.api_client, "submit_chatgi_report") as mock_submit, \
             patch.object(bot_core.api_client, "check_duplicate_mannam", return_value={"duplicate": False}), \
             patch.object(bot_core.api_client, "upsert_meeting") as mock_upsert:
            asyncio.run(on_chatgi_report(update, None))

        mock_submit.assert_called_once_with({
            "telegramMessageId": "1:42",
            "date": "2026-08-05",
            "groupe": "centre",
            "entries": FAKE_FIELDS["entries"],
        })
        mock_upsert.assert_called_once()
        event_id, details = mock_upsert.call_args[0]
        assert event_id == "chatgi:centre:pasteur-stephane:mannam:2026-08-08"
        assert details["figure_name"] == "Pasteur Stéphane"
        assert details["summary"] == "Mannam Pasteur Stéphane"
        assert details["event_type"] == "mannam"
        assert details["date"] == "2026-08-08"
        assert details["groupe"] == "centre"

        text = update.message.reply_text.call_args[0][0]
        assert "👤 2" in text
        assert "☎️ 1" in text
        assert "🌾 0" in text
        assert "1 mannam(s)" in text
        assert "Centre + KYK" in text

    def test_time_is_normalized_before_being_stored(self):
        # Le texte brut extrait par Gemini ("19H30") doit être normalisé en
        # "HH:MM" avant d'être envoyé à l'API — sinon /list plante plus
        # tard en essayant de le reparser comme une heure ISO.
        fields = {
            **FAKE_FIELDS,
            "mannams": [
                {"figure_name": "Pasteur Stéphane", "event_type": "mannam",
                 "date": "430808", "time": "19H30", "location": "Sarcelles"},
            ],
        }
        update = _make_update(SUBAE_MESSAGE)
        with patch.object(bot_core, "normalize_chatgi_with_gemini", return_value=fields), \
             patch.object(bot_core.api_client, "submit_chatgi_report"), \
             patch.object(bot_core.api_client, "check_duplicate_mannam", return_value={"duplicate": False}), \
             patch.object(bot_core.api_client, "upsert_meeting") as mock_upsert:
            asyncio.run(on_chatgi_report(update, None))
        _event_id, details = mock_upsert.call_args[0]
        assert details["time"] == "19:30"

    def test_ls_line_gets_plain_summary_zoom_location_and_is_reported_separately(self):
        # Pas de préfixe "Leçon Spéciale" dans le nom (la distinction se
        # fait via le badge event_type côté site) ; lieu toujours "Zoom"
        # peu importe ce qui était écrit dans le message d'origine.
        fields = {
            **FAKE_FIELDS,
            "mannams": [
                {"figure_name": "Pasteur Samuel Kalaki", "event_type": "ls",
                 "date": "430807", "time": "19H30", "location": "Chez lui"},
            ],
        }
        update = _make_update(SUBAE_MESSAGE, chat_id=1, message_id=43)
        with patch.object(bot_core, "normalize_chatgi_with_gemini", return_value=fields), \
             patch.object(bot_core.api_client, "submit_chatgi_report"), \
             patch.object(bot_core.api_client, "check_duplicate_mannam", return_value={"duplicate": False}), \
             patch.object(bot_core.api_client, "upsert_meeting") as mock_upsert:
            asyncio.run(on_chatgi_report(update, None))

        _event_id, details = mock_upsert.call_args[0]
        assert details["summary"] == "Mannam Pasteur Samuel Kalaki"
        assert details["location"] == "Zoom"
        assert details["event_type"] == "ls"

        text = update.message.reply_text.call_args[0][0]
        assert "1 leçon(s) spéciale(s)" in text
        assert "mannam(s)" not in text  # aucun vrai mannam dans ce lot

    def test_mixed_mannam_and_ls_lines_both_created_with_correct_breakdown(self):
        fields = {
            **FAKE_FIELDS,
            "mannams": [
                {"figure_name": "Pasteur Stéphane", "event_type": "mannam",
                 "date": "430808", "time": "13:30", "location": "Sarcelles"},
                {"figure_name": "Pasteur Samuel Kalaki", "event_type": "ls",
                 "date": "430807", "time": "19H30", "location": ""},
            ],
        }
        update = _make_update(SUBAE_MESSAGE, chat_id=1, message_id=44)
        with patch.object(bot_core, "normalize_chatgi_with_gemini", return_value=fields), \
             patch.object(bot_core.api_client, "submit_chatgi_report"), \
             patch.object(bot_core.api_client, "check_duplicate_mannam", return_value={"duplicate": False}), \
             patch.object(bot_core.api_client, "upsert_meeting") as mock_upsert:
            asyncio.run(on_chatgi_report(update, None))

        assert mock_upsert.call_count == 2
        summaries = {c.args[1]["summary"] for c in mock_upsert.call_args_list}
        assert summaries == {"Mannam Pasteur Stéphane", "Mannam Pasteur Samuel Kalaki"}
        locations = {c.args[1]["summary"]: c.args[1]["location"] for c in mock_upsert.call_args_list}
        assert locations["Mannam Pasteur Samuel Kalaki"] == "Zoom"
        assert locations["Mannam Pasteur Stéphane"] == "Sarcelles"

        text = update.message.reply_text.call_args[0][0]
        assert "1 mannam(s)" in text
        assert "1 leçon(s) spéciale(s)" in text

    def test_reposted_form_reuses_same_mannam_event_id_across_different_messages(self):
        # Le même gabarit peut être reposté/mis à jour plusieurs fois dans la
        # journée (nouveau message Telegram, message_id différent) — le
        # même pasteur/type/date doit donner le MÊME event_id pour que
        # upsert_meeting mette à jour au lieu de dupliquer.
        update1 = _make_update(SUBAE_MESSAGE, chat_id=1, message_id=50)
        update2 = _make_update(SUBAE_MESSAGE, chat_id=1, message_id=51)
        with patch.object(bot_core, "normalize_chatgi_with_gemini", return_value=FAKE_FIELDS), \
             patch.object(bot_core.api_client, "submit_chatgi_report"), \
             patch.object(bot_core.api_client, "check_duplicate_mannam", return_value={"duplicate": False}), \
             patch.object(bot_core.api_client, "upsert_meeting") as mock_upsert:
            asyncio.run(on_chatgi_report(update1, None))
            asyncio.run(on_chatgi_report(update2, None))

        event_id_1 = mock_upsert.call_args_list[0].args[0]
        event_id_2 = mock_upsert.call_args_list[1].args[0]
        assert event_id_1 == event_id_2

    def test_extraction_failure_replies_with_hint_and_makes_no_api_calls(self):
        update = _make_update(SUBAE_MESSAGE)
        with patch.object(bot_core, "normalize_chatgi_with_gemini", return_value=None), \
             patch.object(bot_core.api_client, "submit_chatgi_report") as mock_submit:
            asyncio.run(on_chatgi_report(update, None))
        mock_submit.assert_not_called()
        text = update.message.reply_text.call_args[0][0]
        assert "extraction a échoué" in text

    def test_missing_groupe_replies_with_hint_and_makes_no_api_calls(self):
        fields = {**FAKE_FIELDS, "groupe": ""}
        update = _make_update(SUBAE_MESSAGE)
        with patch.object(bot_core, "normalize_chatgi_with_gemini", return_value=fields), \
             patch.object(bot_core.api_client, "submit_chatgi_report") as mock_submit:
            asyncio.run(on_chatgi_report(update, None))
        mock_submit.assert_not_called()
        text = update.message.reply_text.call_args[0][0]
        assert "Groupe" in text

    def test_submit_report_exception_shows_error_and_skips_mannams(self):
        update = _make_update(SUBAE_MESSAGE)
        with patch.object(bot_core, "normalize_chatgi_with_gemini", return_value=FAKE_FIELDS), \
             patch.object(bot_core.api_client, "submit_chatgi_report", side_effect=ValueError("HTTP 500")), \
             patch.object(bot_core.api_client, "upsert_meeting") as mock_upsert:
            asyncio.run(on_chatgi_report(update, None))
        mock_upsert.assert_not_called()
        text = update.message.reply_text.call_args[0][0]
        assert "erreur" in text.lower()

    def test_no_mannam_lines_omits_mannam_summary(self):
        fields = {**FAKE_FIELDS, "mannams": []}
        update = _make_update(SUBAE_MESSAGE)
        with patch.object(bot_core, "normalize_chatgi_with_gemini", return_value=fields), \
             patch.object(bot_core.api_client, "submit_chatgi_report"), \
             patch.object(bot_core.api_client, "upsert_meeting") as mock_upsert:
            asyncio.run(on_chatgi_report(update, None))
        mock_upsert.assert_not_called()
        text = update.message.reply_text.call_args[0][0]
        assert "mannam(s)" not in text

    def test_one_failing_mannam_upsert_does_not_block_others(self):
        fields = {
            **FAKE_FIELDS,
            "mannams": [
                {"figure_name": "Pasteur A", "date": "430808", "time": "", "location": ""},
                {"figure_name": "Pasteur B", "date": "430808", "time": "", "location": ""},
            ],
        }
        update = _make_update(SUBAE_MESSAGE)
        with patch.object(bot_core, "normalize_chatgi_with_gemini", return_value=fields), \
             patch.object(bot_core.api_client, "submit_chatgi_report"), \
             patch.object(bot_core.api_client, "check_duplicate_mannam", return_value={"duplicate": False}), \
             patch.object(bot_core.api_client, "upsert_meeting",
                          side_effect=[ValueError("boom"), {"id": "ok"}]) as mock_upsert:
            asyncio.run(on_chatgi_report(update, None))
        assert mock_upsert.call_count == 2
        text = update.message.reply_text.call_args[0][0]
        assert "1 mannam(s)" in text  # un seul des deux a réussi

    def test_skips_creation_when_duplicate_exists_from_another_source(self):
        # Un mannam existe déjà pour ce pasteur à cette date, créé par une
        # AUTRE voie (/add, sync calendrier…) — mannamId différent de notre
        # event_id synthétique : ne pas en créer un second.
        update = _make_update(SUBAE_MESSAGE)
        dup = {"duplicate": True, "mannamId": "some_other_doc_id", "pastorName": "Pasteur Stéphane"}
        with patch.object(bot_core, "normalize_chatgi_with_gemini", return_value=FAKE_FIELDS), \
             patch.object(bot_core.api_client, "submit_chatgi_report"), \
             patch.object(bot_core.api_client, "check_duplicate_mannam", return_value=dup), \
             patch.object(bot_core.api_client, "upsert_meeting") as mock_upsert:
            asyncio.run(on_chatgi_report(update, None))
        mock_upsert.assert_not_called()
        text = update.message.reply_text.call_args[0][0]
        assert "1 déjà existant(s) (créé ailleurs), non recréé(s)" in text
        assert "prévu(s) ajouté(s)" not in text

    def test_still_upserts_when_duplicate_is_own_synthetic_entry(self):
        # check_duplicate_mannam retrouve NOTRE PROPRE entrée (repost du
        # même 🧡, même event_id synthétique) — doit quand même mettre à
        # jour, pas la sauter (sinon une correction dans un repost ne
        # serait jamais appliquée).
        own_event_id = "chatgi:centre:pasteur-stephane:mannam:2026-08-08"
        update = _make_update(SUBAE_MESSAGE)
        dup = {"duplicate": True, "mannamId": own_event_id, "pastorName": "Pasteur Stéphane"}
        with patch.object(bot_core, "normalize_chatgi_with_gemini", return_value=FAKE_FIELDS), \
             patch.object(bot_core.api_client, "submit_chatgi_report"), \
             patch.object(bot_core.api_client, "check_duplicate_mannam", return_value=dup), \
             patch.object(bot_core.api_client, "upsert_meeting") as mock_upsert:
            asyncio.run(on_chatgi_report(update, None))
        mock_upsert.assert_called_once()
        event_id, _details = mock_upsert.call_args[0]
        assert event_id == own_event_id
        text = update.message.reply_text.call_args[0][0]
        assert "1 mannam(s)" in text

    def test_check_duplicate_exception_falls_back_to_creating(self):
        # Un souci réseau sur la vérification ne doit jamais bloquer
        # l'enregistrement normal du mannam.
        update = _make_update(SUBAE_MESSAGE)
        with patch.object(bot_core, "normalize_chatgi_with_gemini", return_value=FAKE_FIELDS), \
             patch.object(bot_core.api_client, "submit_chatgi_report"), \
             patch.object(bot_core.api_client, "check_duplicate_mannam", side_effect=ValueError("HTTP 500")), \
             patch.object(bot_core.api_client, "upsert_meeting") as mock_upsert:
            asyncio.run(on_chatgi_report(update, None))
        mock_upsert.assert_called_once()
