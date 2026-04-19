"""
Tests unitaires pour les fonctions utilitaires de main.py.
Aucune connexion externe requise (Telegram, Google Calendar).
Lancer : python -m pytest tests/ -v
"""
import pytest
import sys
import os
from datetime import datetime
from unittest.mock import MagicMock, patch

# Permet d'importer main.py sans que main() se déclenche
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from main import (
    parse_event_details,
    sanitize_string,
    extract_mannamjas_and_clean_description,
    get_start_and_end_of_week,
    create_event,
)


# ── 1. parse_event_details ─────────────────────────────────────────────────────

class TestParseEventDetails:
    VALID_MESSAGE = (
        "Titre : Visite Pastor Kim\n"
        "Date : 2026-03-15\n"
        "Heure : 14:30\n"
        "Lieu : Salle A\n"
        "Description : Prédication du dimanche\n"
        "Mannamjas : Alice, Bob"
    )

    def test_valid_message_returns_dict(self):
        result = parse_event_details(self.VALID_MESSAGE)
        assert result is not None

    def test_extracts_correct_title(self):
        result = parse_event_details(self.VALID_MESSAGE)
        assert result['summary'] == 'Visite Pastor Kim'

    def test_extracts_correct_date(self):
        result = parse_event_details(self.VALID_MESSAGE)
        assert result['date'] == '2026-03-15'

    def test_extracts_correct_time(self):
        result = parse_event_details(self.VALID_MESSAGE)
        assert result['time'] == '14:30'

    def test_extracts_correct_location(self):
        result = parse_event_details(self.VALID_MESSAGE)
        assert result['location'] == 'Salle A'

    def test_extracts_correct_description(self):
        result = parse_event_details(self.VALID_MESSAGE)
        assert result['description'] == 'Prédication du dimanche'

    def test_extracts_correct_mannamjas(self):
        result = parse_event_details(self.VALID_MESSAGE)
        assert result['mannamjas'] == 'Alice, Bob'

    def test_invalid_message_returns_none(self):
        assert parse_event_details("texte aléatoire sans format") is None

    def test_missing_field_returns_none(self):
        # Manque le champ Mannamjas
        msg = (
            "Titre : Test\n"
            "Date : 2026-01-01\n"
            "Heure : 10:00\n"
            "Lieu : Paris\n"
            "Description : Test desc"
        )
        assert parse_event_details(msg) is None

    def test_empty_string_returns_none(self):
        assert parse_event_details("") is None


# ── 2. sanitize_string ─────────────────────────────────────────────────────────

class TestSanitizeString:
    def test_removes_html_tags(self):
        assert sanitize_string("<b>texte</b>") == "texte"

    def test_removes_nested_tags(self):
        assert sanitize_string("<div><p>contenu</p></div>") == "contenu"

    def test_plain_text_unchanged(self):
        assert sanitize_string("texte normal") == "texte normal"

    def test_empty_string(self):
        assert sanitize_string("") == ""

    def test_removes_html_entities_tags_only(self):
        result = sanitize_string("Pastor &amp; Friends")
        # sanitize_string ne touche pas les entités HTML, seulement les balises
        assert "&amp;" in result


# ── 3. extract_mannamjas_and_clean_description ────────────────────────────────

class TestExtractMannamjas:
    def test_extracts_mannamjas_from_description(self):
        desc = "Prédication\nMannamjas : Alice, Bob"
        mannamjas, cleaned = extract_mannamjas_and_clean_description(desc)
        assert mannamjas == "Alice, Bob"

    def test_cleaned_description_without_mannamjas_line(self):
        desc = "Prédication\nMannamjas : Alice, Bob"
        _, cleaned = extract_mannamjas_and_clean_description(desc)
        assert "Mannamjas" not in cleaned

    def test_no_mannamjas_returns_default(self):
        desc = "Simple description sans mannamjas"
        mannamjas, _ = extract_mannamjas_and_clean_description(desc)
        assert mannamjas == "No Mannamjas"

    def test_strips_html_tags_from_description(self):
        desc = "<b>Prédication</b>\nMannamjas : Alice"
        _, cleaned = extract_mannamjas_and_clean_description(desc)
        assert "<b>" not in cleaned

    def test_empty_description(self):
        mannamjas, cleaned = extract_mannamjas_and_clean_description("")
        assert mannamjas == "No Mannamjas"
        assert cleaned == ""


# ── 4. get_start_and_end_of_week ──────────────────────────────────────────────

class TestGetWeekRange:
    def test_returns_two_datetimes(self):
        start, end = get_start_and_end_of_week()
        assert isinstance(start, datetime)
        assert isinstance(end, datetime)

    def test_end_is_7_days_after_start(self):
        start, end = get_start_and_end_of_week()
        delta = end - start
        assert delta.days == 7

    def test_start_is_monday(self):
        start, _ = get_start_and_end_of_week()
        # weekday() == 0 → lundi
        assert start.weekday() == 0


# ── 5. create_event (mock du service Calendar) ───────────────────────────────

class TestCreateEvent:
    def _make_service_mock(self):
        mock_service = MagicMock()
        # Utilise return_value pour configurer la chaîne sans déclencher d'appels
        mock_service.events.return_value.insert.return_value.execute.return_value = {
            'id': 'fake_event_id',
            'htmlLink': 'https://calendar.google.com/fake'
        }
        return mock_service

    def _valid_details(self):
        return {
            'summary': 'Visite Pastor Kim',
            'date': '2026-03-15',
            'time': '14:30',
            'location': 'Salle A',
            'description': 'Prédication',
            'mannamjas': 'Alice, Bob',
        }

    def test_returns_event_with_html_link(self):
        service = self._make_service_mock()
        event = create_event(service, self._valid_details())
        assert 'htmlLink' in event

    def test_calls_calendar_api_once(self):
        service = self._make_service_mock()
        create_event(service, self._valid_details())
        service.events().insert.assert_called_once()

    def test_event_body_has_correct_summary(self):
        service = self._make_service_mock()
        create_event(service, self._valid_details())
        call_kwargs = service.events().insert.call_args[1]
        assert call_kwargs['body']['summary'] == 'Visite Pastor Kim'

    def test_event_body_has_correct_location(self):
        service = self._make_service_mock()
        create_event(service, self._valid_details())
        call_kwargs = service.events().insert.call_args[1]
        assert call_kwargs['body']['location'] == 'Salle A'

    def test_end_time_is_one_hour_after_start(self):
        service = self._make_service_mock()
        create_event(service, self._valid_details())
        call_kwargs = service.events().insert.call_args[1]
        start_dt = call_kwargs['body']['start']['dateTime']
        end_dt = call_kwargs['body']['end']['dateTime']
        start = datetime.fromisoformat(start_dt)
        end = datetime.fromisoformat(end_dt)
        assert (end - start).seconds == 3600

    def test_description_includes_mannamjas(self):
        service = self._make_service_mock()
        create_event(service, self._valid_details())
        call_kwargs = service.events().insert.call_args[1]
        assert 'Alice, Bob' in call_kwargs['body']['description']
