"""
Tests unitaires pour la fonctionnalité de rapport de mannam (#AMR).
Aucune connexion externe requise (Telegram, Gemini, Calendar) — tout est mocké.
Lancer : python -m pytest tests/ -v
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
    normalize_report_with_gemini,
    _resultat_keyboard,
    _pending_reports,
    _pending_matches,
    on_amr_report,
    on_report_result_callback,
    on_pastor_pick_callback,
    nouveau_rapport_command,
    voir_rapport_command,
)

AMR_MESSAGE = """🔰After mannam report AMR

▪️Basic info
- Name: Prophetesse Nadige
- Name of Church : Shekinah
- Class / POD in charge: Beomhee
- Location: Sarcelles
- section : Fidèles

▪️Résultat (que peut on envisager avec ce pasteur?) :
- Intérêt : Très ouverte à la collaboration.

- Demande de FB : Pour le moment aucune

▪️Next meeting :
🔜 NTF entre 23 et 29 Août

#After #AMR"""

GEMINI_NADIGE_JSON = json.dumps({
    "pastor_name": "Prophetesse Nadige",
    "eglise": "Shekinah",
    "responsable": "Beomhee",
    "location": "Sarcelles",
    "section": "Fidèles",
    "resume": "Très ouverte à la collaboration.",
    "demande_fb": "Pour le moment aucune",
    "prochaines_etapes": "NTF entre 23 et 29 Août",
})


def _make_gemini_response(text: str):
    resp = MagicMock()
    resp.text = text
    return resp


# ── normalize_report_with_gemini ───────────────────────────────────────────────

class TestNormalizeReportWithGemini:
    def test_extracts_key_fields_from_real_example(self):
        fake_client = MagicMock()
        fake_client.models.generate_content.return_value = _make_gemini_response(GEMINI_NADIGE_JSON)
        with patch.object(bot_core, "_gemini_client", fake_client):
            result = normalize_report_with_gemini(AMR_MESSAGE)
        assert result is not None
        assert result["pastor_name"] == "Prophetesse Nadige"
        assert result["eglise"] == "Shekinah"
        assert result["responsable"] == "Beomhee"
        assert result["location"] == "Sarcelles"
        assert result["prochaines_etapes"] == "NTF entre 23 et 29 Août"

    def test_missing_pastor_name_returns_none(self):
        fake_client = MagicMock()
        payload = json.loads(GEMINI_NADIGE_JSON)
        payload["pastor_name"] = ""
        fake_client.models.generate_content.return_value = _make_gemini_response(json.dumps(payload))
        with patch.object(bot_core, "_gemini_client", fake_client):
            result = normalize_report_with_gemini(AMR_MESSAGE)
        assert result is None

    def test_no_gemini_client_returns_none(self):
        with patch.object(bot_core, "_gemini_client", None):
            assert normalize_report_with_gemini(AMR_MESSAGE) is None

    def test_gemini_exception_returns_none(self):
        fake_client = MagicMock()
        fake_client.models.generate_content.side_effect = RuntimeError("boom")
        with patch.object(bot_core, "_gemini_client", fake_client):
            assert normalize_report_with_gemini(AMR_MESSAGE) is None


# ── _resultat_keyboard ──────────────────────────────────────────────────────────

class TestResultatKeyboard:
    def test_has_four_buttons(self):
        markup = _resultat_keyboard("tok")
        buttons = [b for row in markup.inline_keyboard for b in row]
        assert len(buttons) == 4

    def test_callback_data_encodes_token_and_resultat(self):
        markup = _resultat_keyboard("chat1:42")
        buttons = [b for row in markup.inline_keyboard for b in row]
        codes = {b.callback_data.split("|")[2] for b in buttons}
        assert codes == {"succes", "processus_en_cours", "echec", "annule"}
        assert all(b.callback_data.startswith("rr|chat1:42|") for b in buttons)


# ── on_amr_report ────────────────────────────────────────────────────────────────

def _make_update(text: str, chat_id: int = 1, message_id: int = 100):
    update = MagicMock()
    update.message.text = text
    update.message.message_id = message_id
    update.message.reply_text = AsyncMock()
    update.effective_chat.id = chat_id
    return update


class TestOnAmrReport:
    def setup_method(self):
        _pending_reports.clear()
        _pending_matches.clear()

    def test_matched_report_stores_pending_and_sends_keyboard(self):
        fake_fields = {
            "pastor_name": "Prophetesse Nadige", "eglise": "Shekinah", "responsable": "Beomhee",
            "location": "Sarcelles", "section": "Fidèles", "resume": "resume texte",
            "demande_fb": "", "prochaines_etapes": "NTF entre 23 et 29 Août",
        }
        match = {
            "matched": True, "pastorId": "p1", "pastorName": "Prophetesse Nadige",
            "matchType": "exact", "mannamId": "m1", "mannamDate": "2026-07-23",
            "mannamSummary": "Mannam Nadige",
        }
        update = _make_update(AMR_MESSAGE, chat_id=1, message_id=42)
        with patch.object(bot_core, "normalize_report_with_gemini", return_value=fake_fields), \
             patch.object(bot_core.api_client, "match_report", return_value=match):
            asyncio.run(on_amr_report(update, None))

        token = "1:42"
        assert token in _pending_reports
        assert _pending_reports[token]["mannam_id"] == "m1"
        assert _pending_reports[token]["reporter"] == "Beomhee"
        assert _pending_reports[token]["report"]["resume"] == "resume texte"
        update.message.reply_text.assert_awaited_once()
        _, kwargs = update.message.reply_text.call_args
        assert "reply_markup" in kwargs

    def test_extraction_failure_replies_with_manual_fallback_hint(self):
        update = _make_update(AMR_MESSAGE)
        with patch.object(bot_core, "normalize_report_with_gemini", return_value=None):
            asyncio.run(on_amr_report(update, None))
        assert not _pending_reports
        text = update.message.reply_text.call_args[0][0]
        assert "/nouveau_rapport" in text

    def test_no_pastor_match_replies_with_manual_fallback_hint(self):
        fake_fields = {"pastor_name": "Pasteur Inconnu", "eglise": "", "responsable": "",
                       "location": "", "section": "", "resume": "", "demande_fb": "",
                       "prochaines_etapes": ""}
        update = _make_update(AMR_MESSAGE)
        with patch.object(bot_core, "normalize_report_with_gemini", return_value=fake_fields), \
             patch.object(bot_core.api_client, "match_report",
                          return_value={"matched": False, "reason": "pastor_not_found"}):
            asyncio.run(on_amr_report(update, None))
        assert not _pending_reports
        text = update.message.reply_text.call_args[0][0]
        assert "/nouveau_rapport" in text

    def test_match_report_exception_replies_with_manual_fallback_hint(self):
        fake_fields = {"pastor_name": "Prophetesse Nadige", "eglise": "", "responsable": "",
                       "location": "", "section": "", "resume": "", "demande_fb": "",
                       "prochaines_etapes": ""}
        update = _make_update(AMR_MESSAGE)
        with patch.object(bot_core, "normalize_report_with_gemini", return_value=fake_fields), \
             patch.object(bot_core.api_client, "match_report", side_effect=ValueError("HTTP 500")):
            asyncio.run(on_amr_report(update, None))
        assert not _pending_reports
        text = update.message.reply_text.call_args[0][0]
        assert "/nouveau_rapport" in text

    def test_ambiguous_match_proposes_candidates(self):
        # Le nom du rapport n'est pas exact (typo/surnom) — un match_report
        # sans "matched" mais avec des candidats doit proposer un choix,
        # pas abandonner sur le filet de secours manuel.
        fake_fields = {"pastor_name": "Nadge", "eglise": "Shekinah", "responsable": "Beomhee",
                       "location": "", "section": "", "resume": "resume texte",
                       "demande_fb": "", "prochaines_etapes": ""}
        match = {
            "matched": False, "reason": "ambiguous",
            "candidates": [
                {"pastorId": "pastor_nadige", "pastorName": "Prophetesse Nadige"},
                {"pastorId": "pastor_nadeille", "pastorName": "Nadeille"},
            ],
        }
        update = _make_update(AMR_MESSAGE, chat_id=1, message_id=99)
        with patch.object(bot_core, "normalize_report_with_gemini", return_value=fake_fields), \
             patch.object(bot_core.api_client, "match_report", return_value=match):
            asyncio.run(on_amr_report(update, None))

        assert not _pending_reports
        token = "1:99"
        assert token in _pending_matches
        assert _pending_matches[token]["reporter"] == "Beomhee"
        assert _pending_matches[token]["report"]["resume"] == "resume texte"

        _, kwargs = update.message.reply_text.call_args
        markup = kwargs["reply_markup"]
        buttons = [b for row in markup.inline_keyboard for b in row]
        labels = [b.text for b in buttons]
        assert "Prophetesse Nadige" in labels
        assert "Nadeille" in labels
        assert "Aucun de ceux-là" in labels
        assert all(b.callback_data.startswith(f"rp|{token}|") for b in buttons)


# ── on_pastor_pick_callback ──────────────────────────────────────────────────────

class TestOnPastorPickCallback:
    def setup_method(self):
        _pending_reports.clear()
        _pending_matches.clear()

    def test_valid_pick_resolves_mannam_and_shows_resultat_keyboard(self):
        _pending_matches["1:99"] = {"report": {"resume": "resume texte"}, "reporter": "Beomhee"}
        update = _make_callback_update("rp|1:99|pastor_nadige")
        match = {
            "matched": True, "pastorId": "pastor_nadige", "pastorName": "Prophetesse Nadige",
            "matchType": "manual", "mannamId": "m1", "mannamDate": "2026-07-23", "mannamSummary": "Mannam Nadige",
        }
        with patch.object(bot_core.api_client, "match_report_by_pastor", return_value=match) as mock_match:
            asyncio.run(on_pastor_pick_callback(update, None))

        mock_match.assert_called_once_with("pastor_nadige")
        assert "1:99" not in _pending_matches
        result_token = "pick:1:99"
        assert _pending_reports[result_token]["mannam_id"] == "m1"
        assert _pending_reports[result_token]["reporter"] == "Beomhee"
        assert _pending_reports[result_token]["report"]["resume"] == "resume texte"
        update.callback_query.edit_message_text.assert_awaited_once()
        assert "reply_markup" in update.callback_query.edit_message_text.call_args[1]

    def test_none_of_those_shows_manual_fallback_hint(self):
        _pending_matches["1:99"] = {"report": {}, "reporter": ""}
        update = _make_callback_update("rp|1:99|none")
        asyncio.run(on_pastor_pick_callback(update, None))
        assert "1:99" not in _pending_matches
        text = update.callback_query.edit_message_text.call_args[0][0]
        assert "/nouveau_rapport" in text

    def test_expired_token_shows_expiry_message(self):
        update = _make_callback_update("rp|unknown:1|pastor_x")
        asyncio.run(on_pastor_pick_callback(update, None))
        text = update.callback_query.edit_message_text.call_args[0][0]
        assert "expiré" in text.lower()

    def test_chosen_pastor_has_no_pending_mannam(self):
        _pending_matches["1:99"] = {"report": {}, "reporter": ""}
        update = _make_callback_update("rp|1:99|pastor_x")
        with patch.object(bot_core.api_client, "match_report_by_pastor",
                          return_value={"matched": False, "reason": "no_pending_mannam"}):
            asyncio.run(on_pastor_pick_callback(update, None))
        text = update.callback_query.edit_message_text.call_args[0][0]
        assert "/nouveau_rapport" in text

    def test_match_report_by_pastor_exception_shows_error(self):
        _pending_matches["1:99"] = {"report": {}, "reporter": ""}
        update = _make_callback_update("rp|1:99|pastor_x")
        with patch.object(bot_core.api_client, "match_report_by_pastor", side_effect=ValueError("HTTP 500")):
            asyncio.run(on_pastor_pick_callback(update, None))
        text = update.callback_query.edit_message_text.call_args[0][0]
        assert "erreur" in text.lower()


# ── on_report_result_callback ───────────────────────────────────────────────────

def _make_callback_update(data: str):
    update = MagicMock()
    update.callback_query.data = data
    update.callback_query.answer = AsyncMock()
    update.callback_query.edit_message_text = AsyncMock()
    return update


class TestOnReportResultCallback:
    def setup_method(self):
        _pending_reports.clear()

    def test_applies_pending_report_and_confirms(self):
        _pending_reports["1:42"] = {
            "mannam_id": "m1",
            "report": {"resume": "resume texte", "sujets": "Shekinah", "prochaines_etapes": "NTF"},
            "reporter": "Beomhee",
        }
        update = _make_callback_update("rr|1:42|succes")
        with patch.object(bot_core.api_client, "submit_report") as mock_submit:
            asyncio.run(on_report_result_callback(update, None))

        mock_submit.assert_called_once_with(
            "m1",
            {"resume": "resume texte", "sujets": "Shekinah", "prochaines_etapes": "NTF", "resultat": "succes"},
            reporter="Beomhee",
        )
        assert "1:42" not in _pending_reports
        update.callback_query.edit_message_text.assert_awaited_once()
        assert "Succès" in update.callback_query.edit_message_text.call_args[0][0]

    def test_expired_token_shows_expiry_message(self):
        update = _make_callback_update("rr|unknown:1|succes")
        asyncio.run(on_report_result_callback(update, None))
        text = update.callback_query.edit_message_text.call_args[0][0]
        assert "expiré" in text.lower()

    def test_submit_report_exception_shows_error(self):
        _pending_reports["1:42"] = {"mannam_id": "m1", "report": {}, "reporter": ""}
        update = _make_callback_update("rr|1:42|echec")
        with patch.object(bot_core.api_client, "submit_report", side_effect=ValueError("HTTP 500")):
            asyncio.run(on_report_result_callback(update, None))
        text = update.callback_query.edit_message_text.call_args[0][0]
        assert "erreur" in text.lower()


# ── nouveau_rapport_command (filet de secours manuel) ───────────────────────────

def _make_command_update(chat_id: int, message_id: int, args: list[str]):
    update = MagicMock()
    update.effective_chat.id = chat_id
    update.message.message_id = message_id
    update.message.reply_text = AsyncMock()
    context = MagicMock()
    context.args = args
    return update, context


class TestNouveauRapportCommand:
    def setup_method(self):
        _pending_reports.clear()
        bot_core._list_cache.clear()

    def test_no_args_shows_usage(self):
        update, context = _make_command_update(1, 1, [])
        asyncio.run(nouveau_rapport_command(update, context))
        assert "Usage" in update.message.reply_text.call_args[0][0]

    def test_no_cached_list_shows_error(self):
        update, context = _make_command_update(1, 1, ["1"])
        asyncio.run(nouveau_rapport_command(update, context))
        assert "Aucune liste" in update.message.reply_text.call_args[0][0]

    def test_out_of_range_index_shows_error(self):
        bot_core._list_cache[1] = ["evt_a", "evt_b"]
        update, context = _make_command_update(1, 1, ["5"])
        asyncio.run(nouveau_rapport_command(update, context))
        assert "invalide" in update.message.reply_text.call_args[0][0].lower()

    def test_valid_index_stores_pending_report_with_correct_mannam_id(self):
        bot_core._list_cache[1] = ["evt_a", "evt_b"]
        update, context = _make_command_update(1, 42, ["2"])
        asyncio.run(nouveau_rapport_command(update, context))
        token = "1:42"
        assert _pending_reports[token]["mannam_id"] == "evt_b"
        update.message.reply_text.assert_awaited_once()
        assert "reply_markup" in update.message.reply_text.call_args[1]

    def test_pastor_name_arg_bypasses_list_cache_and_matches(self):
        # Cas d'usage réel : mannam plus ancien, absent de /list (semaine en
        # cours seulement) — /nouveau_rapport <nom> doit fonctionner sans _list_cache.
        match = {
            "matched": True, "pastorId": "p1", "pastorName": "Prophetesse Nadige",
            "matchType": "exact", "mannamId": "m_old", "mannamDate": "2026-06-01",
            "mannamSummary": "Mannam Nadige",
        }
        update, context = _make_command_update(1, 7, ["Prophetesse", "Nadige"])
        with patch.object(bot_core.api_client, "match_report", return_value=match) as mock_match:
            asyncio.run(nouveau_rapport_command(update, context))
        mock_match.assert_called_once_with("Prophetesse Nadige")
        token = "1:7"
        assert _pending_reports[token]["mannam_id"] == "m_old"
        assert "reply_markup" in update.message.reply_text.call_args[1]

    def test_pastor_name_arg_not_found_shows_hint(self):
        update, context = _make_command_update(1, 7, ["Pasteur", "Inconnu"])
        with patch.object(bot_core.api_client, "match_report",
                          return_value={"matched": False, "reason": "pastor_not_found"}):
            asyncio.run(nouveau_rapport_command(update, context))
        assert "1:7" not in _pending_reports
        text = update.message.reply_text.call_args[0][0]
        assert "Pasteur Inconnu" in text


# ── voir_rapport_command (consultation en lecture seule) ────────────────────────

class TestVoirRapportCommand:
    def test_no_args_shows_usage(self):
        update, context = _make_command_update(1, 1, [])
        asyncio.run(voir_rapport_command(update, context))
        assert "Usage" in update.message.reply_text.call_args[0][0]

    def test_found_report_shows_details(self):
        update, context = _make_command_update(1, 1, ["Evangelist", "Jean"])
        result = {
            "found": True, "pastorId": "p1", "pastorName": "Evangelist Jean",
            "mannamId": "m1", "mannamDate": "2026-07-20", "mannamSummary": "Mannam Jean",
            "resultat": "succes",
            "report": {"resume": "Bonne rencontre", "sujets": "Formation", "prochaines_etapes": "Relancer en aout"},
            "reportBy": "Beomhee",
        }
        with patch.object(bot_core.api_client, "view_report", return_value=result) as mock_view:
            asyncio.run(voir_rapport_command(update, context))
        mock_view.assert_called_once_with("Evangelist Jean")
        text = update.message.reply_text.call_args[0][0]
        assert "Evangelist Jean" in text
        assert "Succès" in text
        assert "Bonne rencontre" in text
        assert "Beomhee" in text

    def test_no_report_yet_shows_hint(self):
        update, context = _make_command_update(1, 1, ["Evangelist", "Jean"])
        result = {"found": False, "reason": "no_report", "pastorId": "p1", "pastorName": "Evangelist Jean"}
        with patch.object(bot_core.api_client, "view_report", return_value=result):
            asyncio.run(voir_rapport_command(update, context))
        text = update.message.reply_text.call_args[0][0]
        assert "Evangelist Jean" in text
        assert "pas encore" in text.lower()

    def test_pastor_not_found_shows_hint(self):
        update, context = _make_command_update(1, 1, ["Pasteur", "Inconnu"])
        result = {"found": False, "reason": "pastor_not_found", "candidates": []}
        with patch.object(bot_core.api_client, "view_report", return_value=result):
            asyncio.run(voir_rapport_command(update, context))
        text = update.message.reply_text.call_args[0][0]
        assert "Pasteur Inconnu" in text

    def test_ambiguous_lists_candidates(self):
        update, context = _make_command_update(1, 1, ["Nadge"])
        result = {
            "found": False, "reason": "ambiguous",
            "candidates": [
                {"pastorId": "pastor_nadige", "pastorName": "Prophetesse Nadige"},
                {"pastorId": "pastor_nadeille", "pastorName": "Nadeille"},
            ],
        }
        with patch.object(bot_core.api_client, "view_report", return_value=result):
            asyncio.run(voir_rapport_command(update, context))
        text = update.message.reply_text.call_args[0][0]
        assert "Prophetesse Nadige" in text
        assert "Nadeille" in text

    def test_view_report_exception_shows_error(self):
        update, context = _make_command_update(1, 1, ["Evangelist", "Jean"])
        with patch.object(bot_core.api_client, "view_report", side_effect=ValueError("HTTP 500")):
            asyncio.run(voir_rapport_command(update, context))
        text = update.message.reply_text.call_args[0][0]
        assert "erreur" in text.lower()
