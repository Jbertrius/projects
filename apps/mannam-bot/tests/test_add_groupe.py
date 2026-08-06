"""Tests pour le champ "groupe" (Centre+KYK / Team+Fidèle) ajouté à /add —
jusqu'ici seuls les mannams issus d'un rapport chatgi portaient ce champ,
donc tout mannam créé via /add était ignoré par le calcul "Mannams faits"
des objectifs hebdomadaires (cf. Objectifs.tsx côté web). Aucune connexion
externe requise (Telegram, Gemini, API) — tout est mocké.
"""
import json
import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', 'shared', 'python'))

import bot_core
from bot_core import (
    _normalize_groupe,
    normalize_event_with_gemini,
    parse_event_details,
    parse_event_details_freeform,
)


def _make_gemini_response(text: str):
    resp = MagicMock()
    resp.text = text
    return resp


class TestNormalizeGroupe:
    def test_centre_variants(self):
        for raw in ("Centre", "centre", "Centre + KYK", "CENTRE+KYK", " centre "):
            assert _normalize_groupe(raw) == "centre"

    def test_team_variants(self):
        for raw in ("Team", "team", "Team + Fidèle", "TEAM+FIDELE"):
            assert _normalize_groupe(raw) == "team"

    def test_unrecognized_or_empty_returns_empty_string(self):
        for raw in ("", "  ", "Paris", "Zoom"):
            assert _normalize_groupe(raw) == ""


class TestParseEventDetailsGroupe:
    BASE = (
        "Titre : Visite Pastor Kim\n"
        "Date : 2026-03-15\n"
        "Heure : 14:30\n"
        "Lieu : Salle A\n"
        "Description : Prédication du dimanche\n"
        "Mannamjas : Alice, Bob"
    )

    def test_no_groupe_line_returns_empty_string(self):
        result = parse_event_details(self.BASE)
        assert result is not None
        assert result['groupe'] == ""

    def test_groupe_line_after_mannamjas(self):
        msg = self.BASE + "\nGroupe : Team"
        result = parse_event_details(msg)
        assert result['groupe'] == "team"

    def test_groupe_line_after_section_and_pays(self):
        msg = self.BASE + "\nSection : New\nPays : Bénin\nGroupe : Centre"
        result = parse_event_details(msg)
        assert result['section'] == "New"
        assert result['pays'] == "Bénin"
        assert result['groupe'] == "centre"


class TestParseEventDetailsFreeformGroupe:
    def test_explicit_groupe_mention_detected(self):
        msg = "Visite Pasteur Kim le 15 mars 2026 à 14h30 à Paris pour présentation, groupe: Team"
        result = parse_event_details_freeform(msg)
        assert result is not None
        assert result['groupe'] == "team"

    def test_no_groupe_mention_returns_empty_string(self):
        msg = "Visite Pasteur Kim le 15 mars 2026 à 14h30 à Paris pour présentation"
        result = parse_event_details_freeform(msg)
        assert result is not None
        assert result['groupe'] == ""

    def test_bare_centre_keyword_not_confused_with_groupe(self):
        # "Centre" seul est déjà réservé à la Section — ne doit pas être
        # interprété comme un groupe sans le mot "groupe" explicite.
        msg = "Visite Pasteur Kim le 15 mars 2026 à 14h30 à Paris pour présentation, Centre"
        result = parse_event_details_freeform(msg)
        assert result is not None
        assert result['section'] == "Centre"
        assert result['groupe'] == ""


GEMINI_ADD_JSON = json.dumps({
    "summary": "Visite Pastor Kim",
    "date": "2026-03-15",
    "time": "14:30",
    "location": "Salle A",
    "description": "Prédication",
    "mannamjas": "Alice, Bob",
    "section": "",
    "pays": "",
    "groupe": "team",
})


class TestNormalizeEventWithGeminiGroupe:
    def test_groupe_extracted_and_normalized(self):
        fake_client = MagicMock()
        fake_client.models.generate_content.return_value = _make_gemini_response(GEMINI_ADD_JSON)
        with patch.object(bot_core, "_gemini_client", fake_client):
            result = normalize_event_with_gemini("Visite Pastor Kim le 15 mars à 14h30, groupe team")
        assert result is not None
        assert result["groupe"] == "team"

    def test_missing_groupe_defaults_to_empty_string(self):
        payload = json.loads(GEMINI_ADD_JSON)
        del payload["groupe"]
        fake_client = MagicMock()
        fake_client.models.generate_content.return_value = _make_gemini_response(json.dumps(payload))
        with patch.object(bot_core, "_gemini_client", fake_client):
            result = normalize_event_with_gemini("Visite Pastor Kim le 15 mars à 14h30")
        assert result is not None
        assert result["groupe"] == ""

    def test_invalid_groupe_normalized_to_empty_string(self):
        payload = json.loads(GEMINI_ADD_JSON)
        payload["groupe"] = "nord"
        fake_client = MagicMock()
        fake_client.models.generate_content.return_value = _make_gemini_response(json.dumps(payload))
        with patch.object(bot_core, "_gemini_client", fake_client):
            result = normalize_event_with_gemini("Visite Pastor Kim le 15 mars à 14h30")
        assert result is not None
        assert result["groupe"] == ""
