#!/usr/bin/env python3
"""Test des parseurs pour différents formats de messages (version simplifiée)."""

import re
from datetime import datetime

def _normalize_french_date(date_str: str) -> str:
    """Convertit les dates françaises (ex: '23 avril 2026', '23/04') en AAAA-MM-JJ."""
    date_str = date_str.strip()
    current_year = datetime.utcnow().year
    
    # Mois français
    months_fr = {
        'janvier': '01', 'février': '02', 'mars': '03', 'avril': '04', 'mai': '05', 'juin': '06',
        'juillet': '07', 'août': '08', 'septembre': '09', 'octobre': '10', 'novembre': '11', 'décembre': '12'
    }
    
    # Déjà au format AAAA-MM-JJ
    if re.match(r'^\d{4}-\d{2}-\d{2}$', date_str):
        return date_str
    
    # Format JJ/MM/AAAA ou JJ/MM
    if re.match(r'^\d{2}/\d{2}/\d{4}$', date_str):
        parts = date_str.split('/')
        return f"{parts[2]}-{parts[1]}-{parts[0]}"
    if re.match(r'^\d{2}/\d{2}$', date_str):
        parts = date_str.split('/')
        return f"{current_year}-{parts[1]}-{parts[0]}"
    
    # Format français "JJ mois" ou "JJ mois AAAA"
    match = re.match(r'^(\d{1,2})\s+(\w+)(?:\s+(\d{4}))?', date_str, re.IGNORECASE)
    if match:
        day = match.group(1).zfill(2)
        month_name = match.group(2).lower()
        year = match.group(3) or str(current_year)
        month = months_fr.get(month_name)
        if month:
            return f"{year}-{month}-{day}"
    
    return date_str


def _normalize_french_time(time_str: str) -> str:
    """Convertit les heures françaises (ex: '18h00', '6h30 du soir') en HH:MM."""
    time_str = time_str.strip()
    
    # Déjà au format HH:MM
    if re.match(r'^\d{2}:\d{2}$', time_str):
        return time_str
    
    # Format "HHhMM" ou "HH h MM"
    match = re.match(r'^(\d{1,2})\s*h\s*(\d{0,2})', time_str, re.IGNORECASE)
    if match:
        hour = int(match.group(1))
        minute = match.group(2) or '0'
        minute = minute.zfill(2) if minute else '00'
        
        # Gère "du soir" / "de l'après-midi" / "du matin"
        if 'soir' in time_str.lower() and hour < 12:
            hour += 12
        elif 'après' in time_str.lower() and hour < 12:
            hour += 12
        elif 'matin' in time_str.lower() and hour >= 12:
            hour = hour - 12
        
        return f"{hour:02d}:{minute}"
    
    return time_str


def parse_event_details(message: str):
    """Parse format structuré : Titre : ... / Date : ... / Heure : ... / Lieu : ... / etc."""
    pattern = r"Titre : (.*?)\nDate : (.*?)\nHeure : (.*?)\nLieu : (.*?)\nDescription : (.*?)\nMannamjas : (.*?)(?:\nSection\s*:\s*(.*))?"
    match = re.search(pattern, message, re.DOTALL)
    if match:
        return {
            'summary':     match.group(1).strip(),
            'date':        _normalize_french_date(match.group(2).strip()),
            'time':        _normalize_french_time(match.group(3).strip()),
            'location':    match.group(4).strip(),
            'description': match.group(5).strip(),
            'mannamjas':   match.group(6).strip(),
            'section':     (match.group(7) or "").strip(),
        }
    return None


def parse_event_details_freeform(message: str) -> dict | None:
    """Parse format libre : texte naturel structuré de manière souple."""
    msg = message.strip()
    
    # Extraction du titre (généralement au début, jusqu'à la première date/chiffre)
    summary_match = re.match(r'^([^0-9]{5,}?)(?:\s+(?:le\s+)?(\d)|\s+(?:à|le)\s|$)', msg, re.IGNORECASE)
    summary = summary_match.group(1).strip() if summary_match else ""
    
    # Extraction de la date
    date_patterns = [
        r'(?:le\s+)?(\d{1,2}\s+\w+\s+\d{4})',  # "le 23 avril 2026"
        r'(?:le\s+)?(\d{1,2}\s+\w+)',            # "le 23 avril"
        r'(\d{1,2}/\d{1,2}/\d{4})',              # "23/04/2026"
        r'(\d{1,2}/\d{1,2})',                    # "23/04"
    ]
    date_str = ""
    for pattern in date_patterns:
        match = re.search(pattern, msg, re.IGNORECASE)
        if match:
            date_str = _normalize_french_date(match.group(1))
            break
    
    # Extraction de l'heure (accept "h" ou ":")
    time_match = re.search(r'(?:à\s+)?(\d{1,2}\s*h\s*\d{0,2}|\d{1,2}:\d{2})', msg, re.IGNORECASE)
    time_str = _normalize_french_time(time_match.group(1)) if time_match else ""
    
    # Extraction du lieu (après "à", "au", "en", ou avant une virgule avec des chiffres avant)
    # Plus flexible: accepte aussi les cas sans préposition claire
    location_candidates = [
        r'(?:à|au|en|a)\s+([A-Z][a-zâêîôûäëïöüàèé\s\-\.]+?)(?:\s+pour|,|$)',  # Avec préposition
        r'[,\s]([A-Z][a-zâêîôûäëïöüàèé\s\-\.]{3,}?)(?:\s+,|,)',              # Sans préposition, avant une virgule
    ]
    location = ""
    for pattern in location_candidates:
        match = re.search(pattern, msg, re.IGNORECASE)
        if match:
            location = match.group(1).strip()
            # Nettoyer les résidus
            location = re.sub(r'^\s+', '', location).strip()
            if location and len(location) > 3:
                break
    
    # Extraction de la description (après "pour" ou "but" ou avant une virgule si présente)
    desc_candidates = [
        r'(?:pour|but|objectif|presentation)\s+([^,]+?)(?:\s*,|$)',  # Après "pour"
        r'[,\s]([a-z].{10,}?)(?:\s*,\s+[A-Z]|\s*,|$)',                # Après virgule et avant section
    ]
    description = ""
    for pattern in desc_candidates:
        match = re.search(pattern, msg, re.IGNORECASE)
        if match:
            description = match.group(1).strip()
            # Nettoyer
            description = re.sub(r'^\s+', '', description).strip()
            if description and len(description) > 3:
                break
    
    # Extraction des participants (après "mannamjas", "participants", "avec", etc.)
    mannamjas = ""
    mannam_patterns = [
        r'(?:mannamjas?|participants?|avec)\s+([^,]+?)(?:\s*,|$)',  # Format structuré
        r',\s+(\w+(?:\s+\w+)*)\s*,\s*[A-Z]',                         # Entre virgules avant section
    ]
    for pattern in mannam_patterns:
        match = re.search(pattern, msg, re.IGNORECASE)
        if match:
            mannamjas = match.group(1).strip()
            if mannamjas:
                break
    
    # Extraction de la section (mots-clés connus à la fin ou après "section")
    section = ""
    section_keywords = ['New/Old', 'Talak', 'Fideles', 'Centre']
    for keyword in section_keywords:
        if re.search(rf'\b{keyword}\b', msg, re.IGNORECASE):
            section = keyword
            break
    
    # Valider que les champs critiques sont remplis
    if summary and date_str and time_str and location:
        return {
            'summary': summary,
            'date': date_str,
            'time': time_str,
            'location': location,
            'description': description,
            'mannamjas': mannamjas,
            'section': section,
        }
    
    return None


# Messages de test
test_messages = [
    # Message original (Option 2 - format libre)
    {
        "name": "Message original (format libre non-structuré)",
        "text": """Mannam Gmcs Pasteur Kasa kasa
23 avril 2026 18h00 a Chatelêt,  présentation du GMCS invitation Sommet paris, mannamja Haena, Fidèles""",
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
    },
    # Format libre bien structuré (Option 2 - version claire)
    {
        "name": "Format libre bien structuré",
        "text": "Visite Pasteur Kasa Kasa le 23 avril 2026 à 18h00 à Châtelet pour présentation du GMCS invitation Sommet Paris, Haena, Fidèles",
    },
]

# Tests de normalisation des dates
date_tests = [
    ("23 avril 2026", "2026-04-23"),
    ("23 avril", f"{datetime.utcnow().year}-04-23"),
]

# Tests de normalisation des heures
time_tests = [
    ("18h00", "18:00"),
    ("18h", "18:00"),
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
