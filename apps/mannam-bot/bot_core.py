"""
Logique partagée entre main.py (webhook) et main_dev.py (polling).
Ne contient PAS de point d'entrée — importer depuis main.py / main_dev.py.
"""
import logging
import os
import json
import asyncio
from collections import defaultdict
import firestore_sync
import api_client

from google import genai
from google.genai import types as genai_types
from google.oauth2.service_account import Credentials
import re
from datetime import datetime, timedelta
from telegram import Update, BotCommand
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    filters, ConversationHandler, CallbackQueryHandler,
)
from googleapiclient.discovery import build

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)

# ── Config ─────────────────────────────────────────────────────────────────────
SCOPES        = ['https://www.googleapis.com/auth/calendar']

# All IDs and sheet names are loaded from environment variables.
# Set them in .env (dev) or Cloud Run environment (prod).
CALENDAR_ID   = os.environ.get(
    'GOOGLE_CALENDAR_ID',
    '55d96ffebeaba7bbe1a3264b40d7479625bed6b44a2a5a242b61ee2cee58e8b7@group.calendar.google.com'
)


# States for conversation handler
ADD_EVENT, EDIT_EVENT = range(2)

# Cache: chat_id → liste ordonnée des Google Calendar event IDs affichés par /list
_list_cache: dict[int, list[str]] = {}
# Cache: chat_id → event_id en cours d'édition
_edit_cache: dict[int, str] = {}

# ── Gemini ─────────────────────────────────────────────────────────────────────
_GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')
_gemini_client  = genai.Client(api_key=_GEMINI_API_KEY) if _GEMINI_API_KEY else None

_GEMINI_PROMPT = """
Tu es un assistant d'extraction de données pour un agenda d'événements religieux.
À partir du message libre de l'utilisateur, extrais les informations suivantes et retourne-les UNIQUEMENT sous forme d'objet JSON valide, sans texte autour.

Champs attendus (TOUS OBLIGATOIRES - ne jamais retourner null) :
- "summary"   : titre de l'événement (type de visite + nom du pasteur). Ex: "Visite Pasteur Kim"
- "date"      : date au format AAAA-MM-JJ. Ex: "2026-04-23"
- "time"      : heure au format HH:MM (24h). Ex: "18:00"
- "location"  : lieu de l'événement. Ex: "Châtelet"
- "description" : objet / but de la visite. Ex: "Présentation du GMCS"
- "mannamjas" : liste des participants séparés par des virgules. Ex: "Alice, Bob"
- "section"   : section des participants parmi "New/Old", "Talak", "Fideles", "Centre". Si non mentionné, utilise ""

Règles importantes :
- NE JAMAIS inventer de valeurs ni utiliser des placeholders.
- Interdits absolus (dans n'importe quel champ): "inconnu", "par défaut", "non spécifié", "unknown", "n/a".
- Si une information manque vraiment, retourne une chaîne vide "" pour ce champ.
- Normalise la date : "23 avril 2026" → "{year}-04-23", "15/03" → "{year}-03-15"
- Si l'année n'est pas mentionnée, utilise {year} comme année par défaut.
- Normalise l'heure : "18h00" → "18:00", "6h30 du soir" → "18:30", "2h30 PM" → "14:30"
- Accepte les typos (ex: "Chatelêt" → "Châtelet", "mannamja" → participants)
- Pour les participants : extrais tous les noms mentionnés après des mots comme "mannamjas", "participants", "avec", etc.
- Retourne EXCLUSIVEMENT le JSON, rien d'autre.

Message de l'utilisateur :
{{message}}
"""


def _build_gemini_prompt(message: str) -> str:
    year = datetime.utcnow().year
    # Replace {year} via simple string replace to avoid conflicts with {message} placeholder.
    return _GEMINI_PROMPT.replace("{year}", str(year)).replace("{{message}}", message)


def _extract_json_object(text: str) -> str:
    """Extrait le premier objet JSON d'une réponse Gemini (même si entouré de markdown)."""
    if not text:
        return ""
    cleaned = re.sub(r"```(?:json)?", "", text, flags=re.IGNORECASE).replace("```", "").strip()
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    return match.group(0).strip() if match else cleaned


def _looks_like_placeholder(value: str) -> bool:
    s = (value or "").strip().lower()
    if not s:
        return True
    placeholder_tokens = [
        "inconnu", "unknown", "n/a", "non specifie", "non spécifié",
        "aucun", "pas precise", "pas précisé", "non renseigne", "non renseigné",
    ]
    return any(tok in s for tok in placeholder_tokens)


def _event_contains_placeholder_defaults(event_details: dict) -> bool:
    check_fields = ("summary", "date", "time", "location", "description", "mannamjas")
    return any(_looks_like_placeholder(str(event_details.get(k, ""))) for k in check_fields)


def normalize_event_with_gemini(message: str) -> dict | None:
    """Utilise Gemini pour extraire les champs d'un événement depuis un message libre."""
    if not _gemini_client:
        logging.warning("GEMINI_API_KEY absent — fallback sur le parsing regex.")
        return None
    try:
        response = _gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=_build_gemini_prompt(message),
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
        )
        raw_text = getattr(response, "text", "") or ""
        raw_json = _extract_json_object(raw_text)
        if not raw_json:
            logging.warning("Gemini: réponse vide ou non exploitable.")
            return None

        data = json.loads(raw_json)
        required = {"summary", "date", "time", "location", "description", "mannamjas"}
        if not required.issubset(data.keys()):
            logging.warning(f"Gemini: champs manquants dans la réponse: {data}")
            return None
        result = {k: (v or "") for k, v in data.items()}
        result.setdefault("section", "")

        # Rejette les réponses trop génériques pour laisser le fallback regex agir.
        critical_fields = ("summary", "date", "time", "location")
        placeholder_count = sum(1 for k in critical_fields if _looks_like_placeholder(str(result.get(k, ""))))
        if placeholder_count >= 2:
            logging.warning(f"Gemini: réponse jugée trop générique, fallback activé: {result}")
            return None

        return result
    except Exception as e:
        logging.error(f"Erreur Gemini: {e}")
        return None


# ── Google API services ────────────────────────────────────────────────────────

def _creds_from_env(scopes: list[str]):
    key = os.environ.get('service_account_key')
    if not key:
        raise EnvironmentError("Variable d'env 'service_account_key' manquante.")
    return Credentials.from_service_account_info(json.loads(key), scopes=scopes)


def get_calendar_service():
    return build('calendar', 'v3', credentials=_creds_from_env(SCOPES))



# ── Mannam sync ──────────────────────────────────────────────────────────────

def _sync_mannam_to_api(event_id: str, event_details: dict):
    try:
        firestore_sync.upsert_mannam_event(event_id, {
            **event_details,
            'figure_name': _extract_figure_name(event_details.get('summary', '')),
        })
    except Exception as fs_err:
        logging.warning(f"Erreur sync API mannam: {fs_err}")


def _delete_mannam_from_api(event_id: str):
    try:
        firestore_sync.delete_mannam_event(event_id)
    except Exception as fs_err:
        logging.warning(f"Erreur sync API mannam (delete): {fs_err}")


def sync_calendar_to_api(cal_service):
    """Synchronise les evenements du calendrier vers Firestore via API."""
    synced = 0
    page_token = None
    time_min = datetime.utcnow().replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0).strftime('%Y-%m-%dT%H:%M:%SZ')
    while True:
        params = dict(
            calendarId=CALENDAR_ID,
            timeMin=time_min,
            singleEvents=True,
            orderBy='startTime',
            maxResults=500,
        )
        if page_token:
            params['pageToken'] = page_token
        result = cal_service.events().list(**params).execute()
        for event in result.get('items', []):
            start_raw = event.get('start', {}).get('dateTime', event.get('start', {}).get('date', ''))
            if 'T' in start_raw:
                dt = datetime.fromisoformat(start_raw)
                date_val = dt.strftime('%Y-%m-%d')
                time_val = dt.strftime('%H:%M')
            else:
                date_val = start_raw
                time_val = ''
            mannamjas, description = extract_mannamjas_and_clean_description(event.get('description', ''))
            section = extract_section_from_description(event.get('description', ''))
            try:
                firestore_sync.upsert_mannam_event(event['id'], {
                    'summary': event.get('summary') or '(Sans titre)',
                    'date': date_val or datetime.utcnow().strftime('%Y-%m-%d'),
                    'time': time_val,
                    'location': event.get('location', ''),
                    'description': description,
                    'mannamjas': mannamjas,
                    'section': section,
                    'figure_name': _extract_figure_name(event.get('summary', '')),
                })
                synced += 1
            except Exception as fs_err:
                logging.warning(f"Erreur sync API mannam (startup sync): {fs_err}")
        page_token = result.get('nextPageToken')
        if not page_token:
            break
    logging.info(f"Sync calendrier vers API: {synced} evenement(s) traites.")


# -- Utilitaires ────────────────────────────────────────────────────────────────

def _ensure_year_in_date(date_str: str) -> str:
    """If date_str is MM-DD or lacks a 4-digit year prefix, prepend the current year."""
    s = date_str.strip()
    if re.match(r'^\d{4}-\d{2}-\d{2}$', s):
        return s
    # e.g. "03-15" or "15/03"
    current_year = datetime.utcnow().year
    if re.match(r'^\d{2}-\d{2}$', s):
        return f"{current_year}-{s}"
    return s


def parse_event_details(message: str):
    """Parse format structuré : Titre : ... / Date : ... / Heure : ... / Lieu : ... / etc."""
    line_break = r"(?:\r?\n)"
    pattern = (
        r"Titre\s*:\s*(.*?)" + line_break +
        r"Date\s*:\s*(.*?)" + line_break +
        r"Heure\s*:\s*(.*?)" + line_break +
        r"Lieu\s*:\s*(.*?)" + line_break +
        r"Description\s*:\s*(.*?)" + line_break +
        r"Mannamjas\s*:\s*(.*?)(?:" + line_break + r"Section\s*:\s*(.*))?"
    )
    match = re.search(pattern, message, re.DOTALL)
    if match:
        return {
            'summary':     match.group(1).strip(),
            'date':        _ensure_year_in_date(match.group(2).strip()),
            'time':        match.group(3).strip(),
            'location':    match.group(4).strip(),
            'description': match.group(5).strip(),
            'mannamjas':   match.group(6).strip(),
            'section':     (match.group(7) or "").strip(),
        }
    return None


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


def parse_event_details_freeform(message: str) -> dict | None:
    """Parse format libre : texte naturel structuré de manière souple.
    Ex: 'Visite Pasteur Kasa le 23 avril 2026 à 18h00 à Châtelet pour présentation GMCS, Haena, Fidèles'
    """
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
        r'(?:à|au|en)\s+([A-Z][a-zâêîôûäëïöüàèé\s\-\.]+?)(?:\s+pour|,|$)',  # Avec préposition
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


def _looks_like_structured_event_message(message: str) -> bool:
    required_labels = ["Titre", "Date", "Heure", "Lieu", "Description", "Mannamjas"]
    return all(re.search(rf"(?im)^\s*{label}\s*:", message or "") for label in required_labels)


def sanitize_string(s: str) -> str:
    return re.sub(r'<[^>]*>', '', s)


def _normalize_mannamjas(raw: str) -> str:
    """Converts list-like strings (e.g. \"['A', 'B']\") to plain comma-separated names."""
    raw = raw.strip()
    if raw.startswith('[') and raw.endswith(']'):
        tokens = re.findall(r"[\"']?([^\"',\[\]]+)[\"']?", raw)
        return ', '.join(t.strip() for t in tokens if t.strip())
    return raw


def _norm_name(name: str) -> str:
    """Normalise un nom pour comparaison floue : minuscule, sans tiret ni espace."""
    return re.sub(r'[-\s]', '', name.strip().lower())


def _norm_name_no_tag(name: str) -> str:
    """Normalisation + suppression du tag suffixe (case-insensitive).
    Gère :
      - initiale 1-3 lettres séparée par espace : 'Sunhee J'→'sunhee', 'Sunhee j'→'sunhee', 'Aera JJ'→'aera'
      - surname/suffixe capitalisé séparé : 'Seojun Khan'→'seojun', 'SeokJin J'→'seokjin'
      - suffixe CamelCase collé après minuscule : 'SeojunJk'→'seojun', 'SeojunJK'→'seojun'
    """
    s = name.strip()
    # Cas 1 : dernier mot séparé par espace = initial/tag (1-3 lettres, any case) ou mot capitalisé
    s = re.sub(r'\s+(?:[A-Za-z]{1,3}|[A-Z][a-z]+)$', '', s)
    # Cas 2 : suffixe CamelCase collé après une minuscule
    s = re.sub(r'(?<=[a-z])[A-Z][a-zA-Z]{0,2}$', '', s)
    return _norm_name(s)


def extract_mannamjas_and_clean_description(description: str):
    mannamjas = "No Mannamjas"
    cleaned = sanitize_string(description)
    if cleaned:
        match = re.search(r'Mannamjas\s*:\s*(.+)', cleaned)
        if match:
            mannamjas = _normalize_mannamjas(match.group(1).strip())
            cleaned = re.sub(r'Mannamjas\s*:\s*.+', '', cleaned).strip()
    return mannamjas, cleaned


def extract_section_from_description(description: str) -> str:
    cleaned = sanitize_string(description)
    match = re.search(r'Section\s*:\s*(.+)', cleaned)
    return match.group(1).strip() if match else ""


_figure_name_cache: dict[str, str] = {}

_FIGURE_NAME_PROMPT = """
Tu es un assistant d'extraction de données pour un agenda d'événements religieux.
À partir du titre d'un événement, extrais uniquement le nom de la figure religieuse (pasteur, dirigeant, etc.) mentionnée.
Supprime les mots d'action comme "Visite", "Mannam", "Rencontre", "Rendez-vous", "Réunion", ainsi que les prépositions "avec", "de", etc.
Retourne UNIQUEMENT le nom extrait, sans ponctuation ni texte supplémentaire.

Exemples :
- "Visite Pastor Kim" → "Pastor Kim"
- "Mannam avec Rev. Park" → "Rev. Park"
- "Rencontre Père Moon" → "Père Moon"
- "Rendez-vous Dr. Johnson" → "Dr. Johnson"

Titre : {summary}
"""

def _extract_figure_name(summary: str) -> str:
    """Extrait le nom de la figure religieuse depuis le titre de l'événement via Gemini.
    Fallback regex si Gemini est indisponible.
    Ex: 'Visite Pastor Kim' → 'Pastor Kim'.
    """
    s = summary.strip()
    if s in _figure_name_cache:
        return _figure_name_cache[s]

    if _gemini_client:
        try:
            response = _gemini_client.models.generate_content(
                model="gemini-2.5-flash",
                contents=_FIGURE_NAME_PROMPT.format(summary=s),
            )
            result = response.text.strip()
            if result:
                _figure_name_cache[s] = result
                return result
        except Exception as e:
            logging.warning(f"_extract_figure_name Gemini error: {e} — fallback regex")

    # Fallback regex
    cleaned = re.sub(
        r'^(?:visite|mannam|rencontre|rendez.?vous|réunion)\s+(?:avec\s+)?',
        '', s, flags=re.IGNORECASE
    )
    result = cleaned.strip() or s
    _figure_name_cache[s] = result
    return result


def create_event(service, event_details: dict):
    start_dt = datetime.fromisoformat(f"{event_details['date']}T{event_details['time']}:00")
    end_dt   = start_dt + timedelta(hours=1)
    desc_parts = [event_details['description'], f"Mannamjas: {event_details['mannamjas']}"]
    if event_details.get('section'):
        desc_parts.append(f"Section: {event_details['section']}")
    event = {
        'summary':  event_details['summary'],
        'location': event_details['location'],
        'description': "\n".join(desc_parts),
        'start': {'dateTime': start_dt.isoformat(), 'timeZone': 'Europe/Paris'},
        'end':   {'dateTime': end_dt.isoformat(),   'timeZone': 'Europe/Paris'},
    }
    return service.events().insert(calendarId=CALENDAR_ID, body=event).execute()


def get_start_and_end_of_week():
    today = datetime.utcnow()
    start_of_week = today - timedelta(days=today.weekday())
    end_of_week   = start_of_week + timedelta(days=7)
    return start_of_week, end_of_week


# ── Handlers Telegram ──────────────────────────────────────────────────────────

async def start(update: Update, _):
    await update.message.reply_text(
        'Hello Family! Use /add to add an event, /list to list events, and /delete to delete an event.'
    )


async def add_event(update: Update, _):
    await update.message.reply_text(
        "Décrivez l'événement librement ou utilisez le format structuré :\n\n"
        "Titre : [type de visite + Pastor Name]\n"
        "Date : [AAAA-MM-JJ]\n"
        "Heure : [HH:MM]\n"
        "Lieu : [lieu]\n"
        "Description : [purpose of visit]\n"
        "Mannamjas : [nom1, nom2]\n"
        "Section : [New/Old, Talak, Fideles, Centre]\n\n"
        "💡 Vous pouvez aussi écrire naturellement, ex :\n"
        "\"Visite Pastor Kim le 15 mars à 14h30 à Paris, section Talak, mannamjas Alice et Bob\"\n"
        "(si l'année n'est pas précisée, l'année en cours est utilisée)"
    )
    return ADD_EVENT


async def handle_add_event(update: Update, _):
    message = update.message.text

    event_details = normalize_event_with_gemini(message)
    parser_used = "gemini" if event_details is not None else "none"

    logging.info(f"add_event parser utilisé: {parser_used}")

    if not event_details:
        await update.message.reply_text(
            "❌ Impossible d'extraire les informations de l'événement.\n"
            "Réessayez avec plus de détails (titre, date, heure, lieu, description, participants)."
        )
        return ConversationHandler.END

    missing = [k for k in ("summary", "date", "time", "location") if not event_details.get(k)]
    if missing:
        labels = {"summary": "Titre", "date": "Date", "time": "Heure", "location": "Lieu"}
        await update.message.reply_text(
            f"⚠️ Champs manquants : {', '.join(labels[k] for k in missing)}\n"
            "Merci de renvoyer le message en précisant ces informations."
        )
        return ConversationHandler.END

    section = event_details.get('section', '') or ''
    await update.message.reply_text(
        f"✅ Événement détecté :\n"
        f"📌 Titre : {event_details['summary']}\n"
        f"📅 Date : {event_details['date']}\n"
        f"🕐 Heure : {event_details['time']}\n"
        f"📍 Lieu : {event_details['location']}\n"
        f"📝 Description : {event_details.get('description', '-')}\n"
        f"🚶 Mannamjas : {event_details.get('mannamjas', '-')}\n"
        f"🏷 Section : {section or '-'}\n\nCréation en cours..."
    )

    service = get_calendar_service()
    try:
        event = create_event(service, event_details)
        await update.message.reply_text(f"🎉 Événement créé : {event.get('htmlLink')}")
        _sync_mannam_to_api(event['id'], event_details)
    except Exception as e:
        logging.error(f"Error creating event: {e}")
        await update.message.reply_text("❌ Une erreur est survenue lors de la création de l'événement.")

    return ConversationHandler.END


async def list_events(update, _):
    service = get_calendar_service()
    try:
        start_of_week, end_of_week = get_start_and_end_of_week()
        events_result = service.events().list(
            calendarId=CALENDAR_ID,
            timeMin=start_of_week.isoformat() + 'Z',
            timeMax=end_of_week.isoformat() + 'Z',
            singleEvents=True,
            orderBy='startTime'
        ).execute()
        events = events_result.get('items', [])
        if not events:
            await update.message.reply_text('No events scheduled for this week.')
            return

        events_by_date = defaultdict(list)
        for event in events:
            start = event.get('start', {}).get('dateTime', event.get('start', {}).get('date'))
            start_time = (datetime.fromisoformat(start) if 'T' in start
                          else datetime.fromisoformat(start + "T00:00:00"))
            events_by_date[start_time.strftime('%Y-%m-%d')].append((event, start_time))

        ordered_event_ids: list[str] = []
        for date in sorted(events_by_date.keys()):
            for event, _ in events_by_date[date]:
                ordered_event_ids.append(event['id'])
        _list_cache[update.effective_chat.id] = ordered_event_ids

        results = ["🔰 Weekly Offline Mannam\n"]
        idx = 1
        for date, evts in sorted(events_by_date.items()):
            results.append(f"📆 Date: {datetime.strptime(date, '%Y-%m-%d').strftime('%Y-%m-%d (%A)')}")
            for event, start_time in evts:
                mannamjas, desc = extract_mannamjas_and_clean_description(event.get('description', ''))
                results.append(
                    f"[{idx}] 🇫🇷☀️ {event.get('summary', 'N/A')} / {desc}\n"
                    f"    🗝 {event.get('location', 'N/A')} ({start_time.strftime('%H:%M')})\n"
                    f"    🚶 Mannamjas: {mannamjas.replace('&amp;', ', ')}\n"
                )
                idx += 1
            results.append("")
        results.append("➡️ Supprimer : /delete <numéro>  |  Modifier : /edit <numéro>")
        await update.message.reply_text("\n".join(results).strip())
    except Exception as e:
        logging.error(f"Error listing weekly events: {e}")
        await update.message.reply_text("An error occurred while fetching events.")


async def edit_event(update: Update, context):
    """Usage : /edit <numéro>"""
    args = context.args
    if not args or not args[0].isdigit():
        await update.message.reply_text(
            "Usage : /edit <numéro>\nUtilisez /list pour voir les numéros des événements."
        )
        return ConversationHandler.END

    idx      = int(args[0])
    chat_id  = update.effective_chat.id
    event_ids = _list_cache.get(chat_id, [])

    if not event_ids:
        await update.message.reply_text(
            "❌ Aucune liste en mémoire. Faites d'abord /list pour afficher les événements."
        )
        return ConversationHandler.END
    if idx < 1 or idx > len(event_ids):
        await update.message.reply_text(f"❌ Numéro invalide. Choisissez entre 1 et {len(event_ids)}.")
        return ConversationHandler.END

    event_id = event_ids[idx - 1]
    service  = get_calendar_service()
    try:
        event = service.events().get(calendarId=CALENDAR_ID, eventId=event_id).execute()
    except Exception as e:
        logging.error(f"Error fetching event for edit: {e}")
        await update.message.reply_text("❌ Impossible de récupérer l'événement.")
        return ConversationHandler.END

    _edit_cache[chat_id] = event_id
    start_raw = event.get('start', {}).get('dateTime', event.get('start', {}).get('date', ''))
    start_dt  = datetime.fromisoformat(start_raw) if start_raw else None
    mannamjas, clean_desc = extract_mannamjas_and_clean_description(event.get('description', ''))
    section_old = extract_section_from_description(event.get('description', ''))

    await update.message.reply_text(
        f"✏️ Édition de l'événement [{idx}] :\n"
        f"📌 Titre : {event.get('summary', '-')}\n"
        f"📅 Date : {start_dt.strftime('%Y-%m-%d') if start_dt else '-'}\n"
        f"🕐 Heure : {start_dt.strftime('%H:%M') if start_dt else '-'}\n"
        f"📍 Lieu : {event.get('location', '-')}\n"
        f"📝 Description : {clean_desc or '-'}\n"
        f"🚶 Mannamjas : {mannamjas}\n"
        f"🏷 Section : {section_old or '-'}\n\n"
        "Décrivez les modifications à apporter (les champs non mentionnés seront conservés).\n"
        "Ex : \"Changer l'heure à 15h00 et le lieu à Lyon\""
    )
    return EDIT_EVENT


async def handle_edit_event(update: Update, context):
    chat_id  = update.effective_chat.id
    event_id = _edit_cache.get(chat_id)
    if not event_id:
        await update.message.reply_text("❌ Session d'édition expirée. Relancez /edit <numéro>.")
        return ConversationHandler.END

    message = update.message.text
    changes = normalize_event_with_gemini(message)
    if changes is None:
        changes = parse_event_details(message) or {}

    service = get_calendar_service()
    try:
        event = service.events().get(calendarId=CALENDAR_ID, eventId=event_id).execute()
    except Exception as e:
        logging.error(f"Error fetching event for patch: {e}")
        await update.message.reply_text("❌ Impossible de récupérer l'événement.")
        return ConversationHandler.END

    start_raw = event.get('start', {}).get('dateTime', '')
    start_dt  = datetime.fromisoformat(start_raw) if start_raw else None
    current_date = start_dt.strftime('%Y-%m-%d') if start_dt else ''
    current_time = start_dt.strftime('%H:%M') if start_dt else '00:00'
    mannamjas_old, desc_old = extract_mannamjas_and_clean_description(event.get('description', ''))

    section_old = extract_section_from_description(event.get('description', ''))
    new_date        = changes.get('date')        or current_date
    new_time        = changes.get('time')        or current_time
    new_summary     = changes.get('summary')     or event.get('summary', '')
    new_location    = changes.get('location')    or event.get('location', '')
    new_description = changes.get('description') or desc_old
    new_mannamjas   = changes.get('mannamjas')   or mannamjas_old
    new_section     = changes.get('section')     or section_old

    edit_start_dt = datetime.fromisoformat(f"{new_date}T{new_time}:00")
    edit_end_dt   = edit_start_dt + timedelta(hours=1)
    desc_parts = [new_description, f"Mannamjas: {new_mannamjas}"]
    if new_section:
        desc_parts.append(f"Section: {new_section}")
    patch_body = {
        'summary':  new_summary,
        'location': new_location,
        'description': "\n".join(desc_parts),
        'start': {'dateTime': edit_start_dt.isoformat(), 'timeZone': 'Europe/Paris'},
        'end':   {'dateTime': edit_end_dt.isoformat(),   'timeZone': 'Europe/Paris'},
    }

    try:
        service.events().patch(calendarId=CALENDAR_ID, eventId=event_id, body=patch_body).execute()
        del _edit_cache[chat_id]
        _sync_mannam_to_api(event_id, {
            'summary': new_summary, 'date': new_date, 'time': new_time,
            'location': new_location, 'description': new_description,
            'mannamjas': new_mannamjas, 'section': new_section,
        })
        await update.message.reply_text(
            f"✅ Événement mis à jour :\n"
            f"📌 Titre : {new_summary}\n"
            f"📅 Date : {new_date}\n"
            f"🕐 Heure : {new_time}\n"
            f"📍 Lieu : {new_location}\n"
            f"📝 Description : {new_description}\n"
            f"🚶 Mannamjas : {new_mannamjas}\n"
            f"🏷 Section : {new_section or '-'}"
        )
    except Exception as e:
        logging.error(f"Error patching event: {e}")
        await update.message.reply_text("❌ Une erreur est survenue lors de la modification de l'événement.")

    return ConversationHandler.END


async def delete_event(update: Update, context):
    """Usage : /delete <numéro>"""
    args = context.args
    if not args or not args[0].isdigit():
        await update.message.reply_text(
            "Usage : /delete <numéro>\nUtilisez /list pour voir les numéros des événements."
        )
        return

    idx      = int(args[0])
    chat_id  = update.effective_chat.id
    event_ids = _list_cache.get(chat_id, [])

    if not event_ids:
        await update.message.reply_text(
            "❌ Aucune liste en mémoire. Faites d'abord /list pour afficher les événements."
        )
        return
    if idx < 1 or idx > len(event_ids):
        await update.message.reply_text(f"❌ Numéro invalide. Choisissez entre 1 et {len(event_ids)}.")
        return

    event_id = event_ids[idx - 1]
    service  = get_calendar_service()
    try:
        service.events().delete(calendarId=CALENDAR_ID, eventId=event_id).execute()
        _list_cache[chat_id].pop(idx - 1)
        _delete_mannam_from_api(event_id)
        await update.message.reply_text(f"✅ Événement [{idx}] supprimé avec succès.")
    except Exception as e:
        logging.error(f"Error deleting event: {e}")
        await update.message.reply_text("❌ Une erreur est survenue lors de la suppression de l'événement.")


# -- Construction de l'application Telegram ────────────────────────────────────

BOT_COMMANDS = [
    BotCommand("start",  "Message de bienvenue"),
    BotCommand("add",    "Ajouter un événement au calendrier"),
    BotCommand("list",   "Voir les événements de la semaine"),
    BotCommand("edit",   "Modifier un événement (/edit <numéro>)"),
    BotCommand("delete", "Supprimer un événement (/delete <numéro>)"),
]


def build_app(bot_token: str) -> Application:
    """Crée l'Application Telegram avec tous les handlers enregistrés."""

    async def post_init(app: Application) -> None:
        await app.bot.set_my_commands(BOT_COMMANDS)

        sync_interval_hours = int(os.environ.get("SYNC_INTERVAL_HOURS", "6"))

        async def _sync_calendar_loop() -> None:
            while True:
                try:
                    cal_svc = get_calendar_service()
                    await asyncio.to_thread(sync_calendar_to_api, cal_svc)
                except Exception as e:
                    logging.error(f"Erreur sync calendrier périodique: {e}")
                await asyncio.sleep(sync_interval_hours * 3600)

        async def _prefetch_members() -> None:
            try:
                await asyncio.to_thread(api_client._get_members_cached)
                logging.info("Cache membres pré-chargé au démarrage.")
            except Exception as e:
                logging.warning(f"Pré-chargement membres échoué: {e}")

        # Important pour Cloud Run : ne pas bloquer le démarrage HTTP avec une sync longue.
        asyncio.create_task(_sync_calendar_loop())
        asyncio.create_task(_prefetch_members())

    app = Application.builder().token(bot_token).post_init(post_init).build()

    conv_handler = ConversationHandler(
        entry_points=[
            CommandHandler('add',  add_event),
            CommandHandler('edit', edit_event),
        ],
        states={
            ADD_EVENT:  [MessageHandler(filters.TEXT & ~filters.COMMAND, handle_add_event)],
            EDIT_EVENT: [MessageHandler(filters.TEXT & ~filters.COMMAND, handle_edit_event)],
        },
        fallbacks=[]
    )

    app.add_handler(conv_handler)
    app.add_handler(CommandHandler("start",      start))
    app.add_handler(CommandHandler("list",       list_events))
    app.add_handler(CommandHandler("delete", delete_event))

    return app
