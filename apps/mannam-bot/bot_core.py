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

Champs attendus :
- "summary"   : titre de l'événement (type de visite + nom du pasteur)
- "date"      : date au format AAAA-MM-JJ
- "time"      : heure au format HH:MM (24h)
- "location"  : lieu de l'événement
- "description" : objet / but de la visite
- "mannamjas" : liste des participants séparés par des virgules

Règles :
- Si une information est absente du message, utilise null pour ce champ.
- Normalise la date même si elle est écrite en toutes lettres (ex: "15 mars 2026" → "2026-03-15").
- Normalise l'heure même si elle est en format 12h ou avec des mots (ex: "2h30 de l'après-midi" → "14:30").
- Retourne exclusivement le JSON, rien d'autre.

Message de l'utilisateur :
{message}
"""


def normalize_event_with_gemini(message: str) -> dict | None:
    """Utilise Gemini pour extraire les champs d'un événement depuis un message libre."""
    if not _gemini_client:
        logging.warning("GEMINI_API_KEY absent — fallback sur le parsing regex.")
        return None
    try:
        response = _gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=_GEMINI_PROMPT.format(message=message),
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
        )
        data = json.loads(response.text)
        required = {"summary", "date", "time", "location", "description", "mannamjas"}
        if not required.issubset(data.keys()):
            logging.warning(f"Gemini: champs manquants dans la réponse: {data}")
            return None
        return {k: (v or "") for k, v in data.items()}
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
            try:
                firestore_sync.upsert_mannam_event(event['id'], {
                    'summary': event.get('summary') or '(Sans titre)',
                    'date': date_val or datetime.utcnow().strftime('%Y-%m-%d'),
                    'time': time_val,
                    'location': event.get('location', ''),
                    'description': description,
                    'mannamjas': mannamjas,
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

def parse_event_details(message: str):
    pattern = r"Titre : (.*?)\nDate : (.*?)\nHeure : (.*?)\nLieu : (.*?)\nDescription : (.*?)\nMannamjas : (.*)"
    match = re.search(pattern, message, re.DOTALL)
    if match:
        return {
            'summary':     match.group(1).strip(),
            'date':        match.group(2).strip(),
            'time':        match.group(3).strip(),
            'location':    match.group(4).strip(),
            'description': match.group(5).strip(),
            'mannamjas':   match.group(6).strip(),
        }
    return None


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
    event = {
        'summary':  event_details['summary'],
        'location': event_details['location'],
        'description': f"{event_details['description']}\nMannamjas: {event_details['mannamjas']}",
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
        "Mannamjas : [nom1, nom2]\n\n"
        "💡 Vous pouvez aussi écrire naturellement, ex :\n"
        "\"Visite Pastor Kim le 15 mars 2026 à 14h30 à Paris, mannamjas Alice et Bob\""
    )
    return ADD_EVENT


async def handle_add_event(update: Update, _):
    message = update.message.text

    event_details = normalize_event_with_gemini(message)
    if event_details is None:
        event_details = parse_event_details(message)

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

    await update.message.reply_text(
        f"✅ Événement détecté :\n"
        f"📌 Titre : {event_details['summary']}\n"
        f"📅 Date : {event_details['date']}\n"
        f"🕐 Heure : {event_details['time']}\n"
        f"📍 Lieu : {event_details['location']}\n"
        f"📝 Description : {event_details.get('description', '-')}\n"
        f"🚶 Mannamjas : {event_details.get('mannamjas', '-')}\n\nCréation en cours..."
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

    await update.message.reply_text(
        f"✏️ Édition de l'événement [{idx}] :\n"
        f"📌 Titre : {event.get('summary', '-')}\n"
        f"📅 Date : {start_dt.strftime('%Y-%m-%d') if start_dt else '-'}\n"
        f"🕐 Heure : {start_dt.strftime('%H:%M') if start_dt else '-'}\n"
        f"📍 Lieu : {event.get('location', '-')}\n"
        f"📝 Description : {clean_desc or '-'}\n"
        f"🚶 Mannamjas : {mannamjas}\n\n"
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

    new_date        = changes.get('date')        or current_date
    new_time        = changes.get('time')        or current_time
    new_summary     = changes.get('summary')     or event.get('summary', '')
    new_location    = changes.get('location')    or event.get('location', '')
    new_description = changes.get('description') or desc_old
    new_mannamjas   = changes.get('mannamjas')   or mannamjas_old

    edit_start_dt = datetime.fromisoformat(f"{new_date}T{new_time}:00")
    edit_end_dt   = edit_start_dt + timedelta(hours=1)
    patch_body = {
        'summary':  new_summary,
        'location': new_location,
        'description': f"{new_description}\nMannamjas: {new_mannamjas}",
        'start': {'dateTime': edit_start_dt.isoformat(), 'timeZone': 'Europe/Paris'},
        'end':   {'dateTime': edit_end_dt.isoformat(),   'timeZone': 'Europe/Paris'},
    }

    try:
        service.events().patch(calendarId=CALENDAR_ID, eventId=event_id, body=patch_body).execute()
        del _edit_cache[chat_id]
        _sync_mannam_to_api(event_id, {
            'summary': new_summary, 'date': new_date, 'time': new_time,
            'location': new_location, 'description': new_description,
            'mannamjas': new_mannamjas,
        })
        await update.message.reply_text(
            f"✅ Événement mis à jour :\n"
            f"📌 Titre : {new_summary}\n"
            f"📅 Date : {new_date}\n"
            f"🕐 Heure : {new_time}\n"
            f"📍 Lieu : {new_location}\n"
            f"📝 Description : {new_description}\n"
            f"🚶 Mannamjas : {new_mannamjas}"
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
