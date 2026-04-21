#!/usr/bin/env python3
"""Test des parseurs pour différents formats de messages."""

import sys
import os
from datetime import datetime

# Imports depuis bot_core
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bot_core import (
    parse_event_details,
    parse_event_details_freeform,
    _normalize_french_date,
    _normalize_french_time,
)

# Messages de test
test_messages = [
    # Message original (Option 2 - format libre)
    {
        "name": "Message original (format libre non-structuré)",
        "text": """Mannam Gmcs Pasteur Kasa kasa
23 avril 2026 18h00 a Chatelêt,  présentation du GMCS invitation Sommet paris, mannamja Haena, Fidèles""",
        "expected": {
            "summary": "Mannam Gmcs Pasteur Kasa kasa",
            "date": "2026-04-23",
            "time": "18:00",
            "location": "Châtelet",
            "description": "présentation du GMCS",
            "mannamjas": "Haena",
            "section": "Fidèles",
        }
    },
    # Format structuré (Option 3)
    {
        "name": "Format structuré (Option 3)",
        "text": """Titre : Visite Pasteur Kasa Kasa
Date : 2026-04-23
Heure : 18:00
Lieu : Châtelet
Description : Présentation du GMCS invitation Sommet Paris
Mannamjas : Haena
Section : Fidèles""",
        "expected": {
            "summary": "Visite Pasteur Kasa Kasa",
            "date": "2026-04-23",
            "time": "18:00",
            "location": "Châtelet",
            "description": "Présentation du GMCS invitation Sommet Paris",
            "mannamjas": "Haena",
            "section": "Fidèles",
        }
    },
    # Format libre bien structuré (Option 2 - version claire)
    {
        "name": "Format libre bien structuré",
        "text": "Visite Pasteur Kasa Kasa le 23 avril 2026 à 18h00 à Châtelet pour présentation du GMCS invitation Sommet Paris, Haena, Fidèles",
        "expected": {
            "summary": "Visite Pasteur Kasa Kasa",
            "date": "2026-04-23",
            "time": "18:00",
            "location": "Châtelet",
            "description": "présentation du GMCS",
            "mannamjas": "Haena",
            "section": "Fidèles",
        }
    },
]

# Tests de normalisation des dates
date_tests = [
    ("23 avril 2026", "2026-04-23"),
    ("23 avril", f"{datetime.utcnow().year}-04-23"),
    ("23/04/2026", "2026-04-23"),
    ("23/04", f"{datetime.utcnow().year}-04-23"),
    ("2026-04-23", "2026-04-23"),
]

# Tests de normalisation des heures
time_tests = [
    ("18h00", "18:00"),
    ("18h", "18:00"),
    ("18:00", "18:00"),
    ("6h30 du soir", "18:30"),
    ("2h30 PM", "02:30"),
]

def test_normalizers():
    """Test les fonctions de normalisation."""
    print("=" * 60)
    print("TEST DES NORMALISATEURS")
    print("=" * 60)
    
    print("\n--- Dates ---")
    for date_input, expected in date_tests:
        result = _normalize_french_date(date_input)
        status = "✓" if result == expected else "✗"
        print(f"{status} '{date_input}' → '{result}' (attendu: '{expected}')")
    
    print("\n--- Heures ---")
    for time_input, expected in time_tests:
        result = _normalize_french_time(time_input)
        status = "✓" if result == expected else "✗"
        print(f"{status} '{time_input}' → '{result}' (attendu: '{expected}')")

def test_parsers():
    """Test les parseurs avec les messages."""
    print("\n" + "=" * 60)
    print("TEST DES PARSEURS")
    print("=" * 60)
    
    for i, test in enumerate(test_messages, 1):
        print(f"\n--- Test {i}: {test['name']} ---")
        print(f"Message:\n{test['text'][:100]}...")
        
        # Essayer format structuré
        result = parse_event_details(test['text'])
        if result:
            print(f"✓ Parsé par parse_event_details (format structuré)")
            print(f"  - Titre: {result['summary']}")
            print(f"  - Date: {result['date']}")
            print(f"  - Heure: {result['time']}")
            print(f"  - Lieu: {result['location']}")
        else:
            # Essayer format libre
            result = parse_event_details_freeform(test['text'])
            if result:
                print(f"✓ Parsé par parse_event_details_freeform (format libre)")
                print(f"  - Titre: {result['summary']}")
                print(f"  - Date: {result['date']}")
                print(f"  - Heure: {result['time']}")
                print(f"  - Lieu: {result['location']}")
            else:
                print("✗ Aucun parseur n'a pu traiter ce message")
                result = {}
        
        # Vérifier les champs critiques
        critical_fields = ['summary', 'date', 'time', 'location']
        missing = [f for f in critical_fields if not result.get(f)]
        if missing:
            print(f"  ⚠️ Champs manquants: {', '.join(missing)}")
        else:
            print(f"  ✓ Tous les champs critiques sont présents")

if __name__ == '__main__':
    test_normalizers()
    test_parsers()
