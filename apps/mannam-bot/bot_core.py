"""
Logique partagée entre main.py (webhook) et main_dev.py (polling).
Ne contient PAS de point d'entrée — importer depuis main.py / main_dev.py.
"""
import logging
import os
import json
import asyncio
import html
from collections import defaultdict
import api_client

from google import genai
from google.genai import types as genai_types
from google.auth import default as google_auth_default
from google.oauth2.service_account import Credentials
import re
import unicodedata
from datetime import datetime, timedelta
from telegram import Update, BotCommand, InlineKeyboardButton, InlineKeyboardMarkup
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

# Cache: chat_id → liste ordonnée des ids affichés par /list (event Google
# Calendar OU mannam Firestore sans événement Calendar réel, cf. ci-dessous)
_list_cache: dict[int, list[str]] = {}
# Cache: chat_id → sous-ensemble des ids de _list_cache qui sont des mannams
# Firestore sans événement Calendar réel (issus d'un rapport chatgi) —
# /edit et /delete doivent les traiter différemment d'un vrai événement.
_list_cache_firestore_ids: dict[int, set[str]] = {}
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
- "section"   : section des participants parmi "New", "Old", "Talak", "Fideles", "Centre". Si non mentionné, utilise ""
- "pays"      : pays où se trouve le pasteur/l'église, uniquement si explicitement mentionné
                (ex: "pasteur au Bénin" → "Bénin"). Si non mentionné, utilise "" (France sera
                utilisé par défaut, ne jamais l'inventer toi-même).

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
        result.setdefault("pays", "")

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


_GEMINI_EDIT_PROMPT = """
Tu es un assistant de modification d'événements pour un agenda religieux.
L'utilisateur te décrit les changements à apporter à un événement existant.
Extrais UNIQUEMENT les champs modifiés et retourne-les sous forme d'objet JSON valide, sans texte autour.

Champs possibles (retourne SEULEMENT ceux explicitement mentionnés dans le message) :
- "summary"   : nouveau titre. Ex: "Visite Pasteur Kim"
- "date"      : nouvelle date au format AAAA-MM-JJ. Ex: "2026-04-25"
- "time"      : nouvelle heure au format HH:MM (24h). Ex: "20:00"
- "location"  : nouveau lieu. Ex: "Lyon"
- "description" : nouvelle description.
- "mannamjas" : nouveaux participants séparés par des virgules.
- "section"   : nouvelle section parmi "New", "Old", "Talak", "Fideles", "Centre".

Règles :
- NE retourne QUE les champs dont la valeur est clairement mentionnée dans le message.
- Ne jamais inventer de valeurs ni utiliser des placeholders.
- Normalise la date : "25 avril 2026" → "{year}-04-25", "25/04" → "{year}-04-25"
- Si l'année n'est pas mentionnée, utilise {year}.
- Normalise l'heure : "20h00" → "20:00", "8h du soir" → "20:00"
- Retourne EXCLUSIVEMENT le JSON, rien d'autre.

Message de l'utilisateur :
{{message}}
"""


def _build_gemini_edit_prompt(message: str) -> str:
    year = datetime.utcnow().year
    return _GEMINI_EDIT_PROMPT.replace("{year}", str(year)).replace("{{message}}", message)


def normalize_edit_with_gemini(message: str) -> dict | None:
    """Utilise Gemini pour extraire les champs à modifier depuis une instruction d'édition libre.
    Contrairement à normalize_event_with_gemini, accepte les réponses partielles (champs non
    mentionnés → absents du dict) sans les rejeter comme 'trop génériques'.
    """
    if not _gemini_client:
        logging.warning("GEMINI_API_KEY absent — fallback sur le parsing regex.")
        return None
    try:
        response = _gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=_build_gemini_edit_prompt(message),
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
        )
        raw_text = getattr(response, "text", "") or ""
        raw_json = _extract_json_object(raw_text)
        if not raw_json:
            logging.warning("Gemini edit: réponse vide ou non exploitable.")
            return None

        data = json.loads(raw_json)
        # Pour un message d'édition, un dict vide signifie que Gemini n'a rien compris.
        if not data:
            logging.warning("Gemini edit: aucun champ extrait.")
            return None

        result = {k: (v or "") for k, v in data.items() if k in
                  ("summary", "date", "time", "location", "description", "mannamjas", "section")}
        logging.info(f"Gemini edit: champs extraits: {result}")
        return result if result else None
    except Exception as e:
        logging.error(f"Erreur Gemini edit: {e}")
        return None


_AMR_PROMPT = """
Tu es un assistant d'extraction pour des rapports de mannam (rencontre avec un
pasteur), postés selon un gabarit fixe commençant par "After mannam report" et
se terminant par le marqueur "#AMR". Extrais les informations suivantes et
retourne-les UNIQUEMENT sous forme d'objet JSON valide, sans texte autour.

Champs :
- "pastor_name"       : nom de la figure religieuse (champ "Name"). Ex: "Prophetesse Nadige"
- "eglise"            : nom de l'église (champ "Name of Church").
- "responsable"       : personne en charge (champ "Class / POD in charge").
- "location"          : lieu (champ "Location").
- "section"           : section (champ "section").
- "resume"            : tout le contenu narratif de la partie "Résultat" (intérêt,
                        observations, tout ce qui suit "Résultat" jusqu'à "Demande de FB"
                        inclus), regroupé en un seul texte.
- "demande_fb"        : contenu du champ "Demande de FB".
- "prochaines_etapes" : contenu de la partie "Next meeting" (texte libre — ne transforme
                        jamais une plage de dates comme "entre 23 et 29 Août" en date unique).

Règles :
- Si un champ est absent du message, retourne une chaîne vide "".
- Ne jamais inventer de valeurs.
- Retourne EXCLUSIVEMENT le JSON, rien d'autre.

Message :
{{message}}
"""


def normalize_report_with_gemini(message: str) -> dict | None:
    """Extrait les champs d'un rapport #AMR depuis le texte du message Telegram."""
    if not _gemini_client:
        logging.warning("GEMINI_API_KEY absent — extraction de rapport impossible.")
        return None
    try:
        response = _gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=_AMR_PROMPT.replace("{{message}}", message),
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
        )
        raw_text = getattr(response, "text", "") or ""
        raw_json = _extract_json_object(raw_text)
        if not raw_json:
            logging.warning("Gemini rapport: réponse vide ou non exploitable.")
            return None

        data = json.loads(raw_json)
        if not data.get("pastor_name"):
            logging.warning(f"Gemini rapport: pastor_name manquant: {data}")
            return None

        fields = ("pastor_name", "eglise", "responsable", "location", "section",
                  "resume", "demande_fb", "prochaines_etapes")
        return {k: (data.get(k) or "") for k in fields}
    except Exception as e:
        logging.error(f"Erreur Gemini rapport: {e}")
        return None


_CHATGI_PROMPT = """
Tu es un assistant d'extraction pour des rapports quotidiens de prospection
("SUBAE FORM"), postés dans un gabarit fixe se terminant par "#chatgui".
Extrais les informations suivantes et retourne-les UNIQUEMENT sous forme
d'objet JSON valide, sans texte autour.

Structure typique du message (l'ordre et les espacements varient) :
- Une ligne d'en-tête "SUBAE FORM - AA.MM.JJ" — date au format année(2
  chiffres)-mois-jour, ex: "43.08.05".
- Une ligne "Groupe : Centre" ou "Groupe : Team" (peut être absente ou mal
  orthographiée — dans le doute laisse "groupe" vide).
- Des lignes NOMMANT UNE PERSONNE avec trois compteurs marqués par emoji : 🌾
  (recherche de nouveaux contacts), ☎️ (appel simple, sans mannam), 👤
  (chatgi = nouvelle personne contactée). Ex: "🐴Kyung-Mi 🌾:0 ☎️:1 👤:2".
  Ces lignes peuvent apparaître dans la section principale, ou sous des
  sous-titres "TM" (télémarketing) ou "FU" (follow-up) — dans tous les cas,
  inclus-les toutes dans "entries".
  IGNORE la ligne "🔥Totaux" (souvent vide ou fausse, ne jamais l'utiliser).
  IGNORE AUSSI toute ligne commençant par "📍<lieu>" (ex: "📍OTW :  🌾:0
  ☎️:1 👤:2") — ce n'est PAS une personne, c'est un EN-TÊTE DE LIEU (ex:
  "OTW" = "on the way") dont les chiffres sont déjà la somme de la ou des
  personnes listées juste en dessous. Si tu inclus à la fois la ligne 📍
  et la ligne de la personne, les totaux seraient comptés deux fois — donc
  n'extrais QUE les lignes qui nomment explicitement une personne.
- Des lignes commençant par "🧡" annonçant un événement obtenu avec un
  pasteur, au format libre "🧡<nom du pasteur> <type> <jour de semaine>
  <date AAMMJJ> <heure> <lieu>" (jour de semaine, heure et lieu parfois
  absents ou dans un ordre différent). <type> est un MOT-CLÉ qui n'appartient
  PAS au nom du pasteur — le nom s'arrête juste avant lui :
    * "mannam" → une rencontre normale.
    * "LS" → une invitation à une Leçon Spéciale (PAS un mannam).
  Si aucun de ces deux mots-clés n'apparaît sur la ligne, mets "mannam" par
  défaut et n'invente rien d'autre.

Champs attendus :
- "date"    : date du rapport telle qu'écrite sur la ligne d'en-tête (ex:
              "43.08.05") — NE PAS convertir toi-même, laisse le texte brut.
- "groupe"  : "centre" ou "team" selon la ligne "Groupe :" ; chaîne vide ""
              si absente ou illisible. Ne jamais deviner à partir d'autre
              chose que cette ligne explicite.
- "entries" : liste de {"person": str, "recherche": int, "appels": int,
              "chatgi": int} — une entrée par ligne individuelle repérée (0
              pour un compteur non précisé sur la ligne).
- "mannams" : liste de {"figure_name": str, "event_type": "mannam"|"ls",
              "date": str (brut, ex: "430808"), "time": str, "location": str}
              — une par ligne "🧡". "figure_name" ne doit JAMAIS contenir
              "mannam" ni "LS". Chaîne vide "" pour un sous-champ absent.

Règles :
- Ne jamais inventer de valeurs.
- Retourne EXCLUSIVEMENT le JSON, rien d'autre.

Message :
{{message}}
"""


def normalize_chatgi_with_gemini(message: str) -> dict | None:
    """Extrait les champs d'un rapport #chatgui (SUBAE FORM) depuis le texte
    du message Telegram. Les totaux ne sont PAS extraits ici : voir
    _chatgi_totals, qui les recalcule à partir de "entries"."""
    if not _gemini_client:
        logging.warning("GEMINI_API_KEY absent — extraction chatgi impossible.")
        return None
    try:
        response = _gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=_CHATGI_PROMPT.replace("{{message}}", message),
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
        )
        raw_text = getattr(response, "text", "") or ""
        raw_json = _extract_json_object(raw_text)
        if not raw_json:
            logging.warning("Gemini chatgi: réponse vide ou non exploitable.")
            return None

        data = json.loads(raw_json)

        def _as_int(v) -> int:
            try:
                return int(v or 0)
            except (TypeError, ValueError):
                return 0

        entries = [
            {
                "person": str(e.get("person", "")).strip(),
                "recherche": _as_int(e.get("recherche")),
                "appels": _as_int(e.get("appels")),
                "chatgi": _as_int(e.get("chatgi")),
            }
            for e in (data.get("entries") or [])
            # Filet de sécurité si Gemini inclut quand même une ligne d'en-tête
            # de lieu ("📍OTW…") malgré la consigne — ses chiffres sont déjà
            # comptés dans la personne listée juste en dessous.
            if not str(e.get("person", "")).strip().startswith("📍")
        ]
        def _event_type(v) -> str:
            t = str(v or "").strip().lower()
            return t if t in ("mannam", "ls") else "mannam"

        mannams = [
            {
                "figure_name": str(m.get("figure_name", "")).strip(),
                "event_type": _event_type(m.get("event_type")),
                "date": str(m.get("date", "")).strip(),
                "time": str(m.get("time", "")).strip(),
                "location": str(m.get("location", "")).strip(),
            }
            for m in (data.get("mannams") or [])
            if str(m.get("figure_name", "")).strip()
        ]
        groupe = str(data.get("groupe", "")).strip().lower()
        if groupe not in ("centre", "team"):
            groupe = ""

        return {
            "date": str(data.get("date", "")).strip(),
            "groupe": groupe,
            "entries": entries,
            "mannams": mannams,
        }
    except Exception as e:
        logging.error(f"Erreur Gemini chatgi: {e}")
        return None


def _chatgi_totals(entries: list[dict]) -> dict:
    """Somme les compteurs par ligne individuelle — jamais la ligne "Totaux"
    du message d'origine, souvent laissée vide ou fausse par erreur humaine."""
    return {
        "recherche": sum(e.get("recherche", 0) for e in entries),
        "appels": sum(e.get("appels", 0) for e in entries),
        "chatgi": sum(e.get("chatgi", 0) for e in entries),
    }


def _normalize_key(s: str) -> str:
    """Normalise un texte libre (minuscules, sans accents ni espaces) pour
    construire un identifiant déterministe, indépendant du message Telegram
    d'origine — sert à dédoublonner les mannams issus d'un rapport chatgi
    quand le même gabarit SUBAE FORM est reposté ou mis à jour dans la
    journée (sinon chaque repost créerait un mannam en double)."""
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


# ── Google API services ────────────────────────────────────────────────────────

def _creds_from_env(scopes: list[str]):
    # Prefer Application Default Credentials (Cloud Run attached service account).
    try:
        creds, _ = google_auth_default(scopes=scopes)
        return creds
    except Exception:
        key = os.environ.get('service_account_key')
        if key:
            return Credentials.from_service_account_info(json.loads(key), scopes=scopes)
        raise EnvironmentError(
            "Impossible d'obtenir des credentials Google: ADC indisponible et 'service_account_key' absent."
        )


def get_calendar_service():
    return build('calendar', 'v3', credentials=_creds_from_env(SCOPES))



# ── Mannam sync ──────────────────────────────────────────────────────────────

def _sync_mannam_to_api(event_id: str, event_details: dict) -> dict | None:
    """Retourne la réponse de l'API ({id, pastorId, match, pastorName}) pour
    permettre à l'appelant (ex: handle_add_event) de proposer une
    confirmation si le rattachement pasteur est approximatif ; None en cas
    d'erreur — les appels en tâche de fond (sync_calendar_to_api) ignorent
    simplement la valeur de retour."""
    try:
        return api_client.upsert_meeting(event_id, {
            **event_details,
            'figure_name': _extract_figure_name(event_details.get('summary', '')),
        })
    except Exception as fs_err:
        logging.warning(f"Erreur sync API mannam: {fs_err}")
        return None


def _delete_mannam_from_api(event_id: str):
    try:
        api_client.delete_meeting(event_id)
    except Exception as fs_err:
        logging.warning(f"Erreur sync API mannam (delete): {fs_err}")


def sync_calendar_to_api(cal_service):
    """Synchronise les evenements du calendrier vers l'API centrale.

    Idempotent au niveau de l'événement : une fois traité avec succès, un
    événement est marqué via extendedProperties (mannam_synced) pour ne
    plus jamais être retraité (donc plus d'appel Gemini répété) — y compris
    entre deux redémarrages du bot, puisque le marqueur vit sur l'événement
    Calendar lui-même et pas seulement dans le cache mémoire du process.
    """
    synced = 0
    skipped = 0
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
            if (event.get('extendedProperties', {}) or {}).get('private', {}).get('mannam_synced'):
                skipped += 1
                continue
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
                api_client.upsert_meeting(event['id'], {
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
                try:
                    cal_service.events().patch(
                        calendarId=CALENDAR_ID, eventId=event['id'],
                        body={'extendedProperties': {'private': {'mannam_synced': '1'}}},
                    ).execute()
                except Exception as mark_err:
                    logging.warning(f"Impossible de marquer l'événement {event['id']} comme synchronisé: {mark_err}")
            except Exception as fs_err:
                logging.warning(f"Erreur sync API mannam (startup sync): {fs_err}")
        page_token = result.get('nextPageToken')
        if not page_token:
            break
    logging.info(f"Sync calendrier vers API: {synced} evenement(s) traites, {skipped} deja synchronises (ignores).")


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


_SCK_YEAR_OFFSET = 1983  # année SCK "43" = 1983 + 43 = 2026


def _convert_sck_date(date_str: str) -> str:
    """Convertit une date au format SCK 'AA.MM.JJ' / 'AA-MM-JJ' / 'AA/MM/JJ'
    ou compact 'AAMMJJ' (ex: "43.08.05" ou "430805") vers AAAA-MM-JJ, en
    utilisant l'année = 1983 + AA (ex: 43 → 2026). Retourne la chaîne
    d'origine si le format n'est pas reconnu (déjà AAAA-MM-JJ, ou texte libre)."""
    s = (date_str or "").strip()
    if re.match(r'^\d{4}-\d{2}-\d{2}$', s):
        return s
    m = re.match(r'^(\d{2})[.\-/](\d{2})[.\-/](\d{2})$', s)
    if not m:
        m = re.match(r'^(\d{2})(\d{2})(\d{2})$', s)
    if m:
        yy, mm, dd = m.groups()
        return f"{_SCK_YEAR_OFFSET + int(yy)}-{mm}-{dd}"
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
        r"Mannamjas\s*:\s*([^\r\n]*)" +
        r"(?:" + line_break + r"Section\s*:\s*([^\r\n]*))?" +
        r"(?:" + line_break + r"Pays\s*:\s*(.*))?"
    )
    match = re.search(pattern, message, re.DOTALL)
    if match:
        return {
            'summary':     match.group(1).strip(),
            'date':        _normalize_french_date(_ensure_year_in_date(match.group(2).strip())),
            'time':        _normalize_french_time(match.group(3).strip()),
            'location':    match.group(4).strip(),
            'description': match.group(5).strip(),
            'mannamjas':   match.group(6).strip(),
            'section':     (match.group(7) or "").strip(),
            'pays':        (match.group(8) or "").strip(),
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
    section_keywords = ['New', 'Old', 'Talak', 'Fideles', 'Centre']
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


def extract_mannamjas_and_clean_description(description: str):
    mannamjas = "No Mannamjas"
    cleaned = sanitize_string(description)
    if cleaned:
        match = re.search(r'^\s*Mannamjas\s*:\s*(.+)$', cleaned, flags=re.IGNORECASE | re.MULTILINE)
        if match:
            raw_mannamjas = match.group(1).strip()
            # Ignore malformed payloads like "Mannamjas: Section: New/Old"
            if not re.match(r'^section\s*:', raw_mannamjas, flags=re.IGNORECASE):
                mannamjas = _normalize_mannamjas(raw_mannamjas)

        cleaned = re.sub(r'^\s*Mannamjas\s*:\s*.*$', '', cleaned, flags=re.IGNORECASE | re.MULTILINE)
        cleaned = re.sub(r'^\s*Section\s*:\s*.+$', '', cleaned, flags=re.IGNORECASE | re.MULTILINE)
        cleaned = re.sub(r'\n{3,}', '\n\n', cleaned).strip()
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
    _, base_description = extract_mannamjas_and_clean_description(event_details.get('description', ''))
    desc_parts = [base_description, f"Mannamjas: {event_details['mannamjas']}"]
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
        "Section : [New, Old, Talak, Fideles, Centre]\n"
        "Pays : [optionnel — France par défaut si non précisé]\n\n"
        "💡 Vous pouvez aussi écrire naturellement, ex :\n"
        "\"Visite Pastor Kim le 15 mars à 14h30 à Paris, section Talak, mannamjas Alice et Bob\"\n"
        "(si l'année n'est pas précisée, l'année en cours est utilisée)"
    )
    return ADD_EVENT


async def handle_add_event(update: Update, _):
    message = update.message.text

    event_details = normalize_event_with_gemini(message)
    parser_used = "gemini" if event_details is not None else "none"

    if not event_details:
        event_details = parse_event_details(message)
        if event_details is not None:
            parser_used = "structured"

    if not event_details:
        event_details = parse_event_details_freeform(message)
        if event_details is not None:
            parser_used = "freeform"

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
    pays = event_details.get('pays', '') or ''
    await update.message.reply_text(
        f"✅ Événement détecté :\n"
        f"📌 Titre : {event_details['summary']}\n"
        f"📅 Date : {event_details['date']}\n"
        f"🕐 Heure : {event_details['time']}\n"
        f"📍 Lieu : {event_details['location']}\n"
        f"📝 Description : {event_details.get('description', '-')}\n"
        f"🚶 Mannamjas : {event_details.get('mannamjas', '-')}\n"
        f"🏷 Section : {section or '-'}\n"
        + (f"🌍 Pays : {pays}\n" if pays else "")
    )

    figure_name = _extract_figure_name(event_details.get('summary', ''))
    try:
        dup = api_client.check_duplicate_mannam(figure_name, event_details['date'])
    except Exception as e:
        logging.warning(f"Erreur check_duplicate_mannam: {e}")
        dup = {"duplicate": False}

    if dup.get("duplicate"):
        token = f"{update.effective_chat.id}:{update.message.message_id}"
        _pending_duplicate_confirms[token] = {"event_details": event_details}
        await update.message.reply_text(
            f"⚠️ Un mannam existe déjà pour {dup.get('pastorName') or figure_name} le "
            f"{event_details['date']} : « {dup.get('summary', '') or '(sans titre)'} ».\n"
            "Créer quand même ?",
            reply_markup=_duplicate_confirm_keyboard(token),
        )
        return ConversationHandler.END

    await update.message.reply_text("Création en cours...")
    result = await _create_mannam_event(update.message.reply_text, event_details)
    if result and result.get('match') == 'fuzzy':
        await _prompt_pastor_confirm(update, result, event_details)

    return ConversationHandler.END


# token ("chat_id:message_id") → création de mannam en attente de
# confirmation, un mannam actif existe déjà pour ce pasteur à cette date
_pending_duplicate_confirms: dict[str, dict] = {}


def _duplicate_confirm_keyboard(token: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("✅ Créer quand même", callback_data=f"dc|{token}|yes"),
        InlineKeyboardButton("❌ Annuler", callback_data=f"dc|{token}|no"),
    ]])


async def _create_mannam_event(reply, event_details: dict) -> dict | None:
    """Crée l'événement Calendar + synchronise l'API — factorisé pour être
    appelé aussi bien directement depuis /add (pas de doublon détecté) que
    depuis la confirmation explicite d'un doublon. `reply` : coroutine
    (str) -> None (update.message.reply_text ou query.message.reply_text)."""
    service = get_calendar_service()
    try:
        event = create_event(service, event_details)
        await reply(f"🎉 Événement créé : {event.get('htmlLink')}")
        return _sync_mannam_to_api(event['id'], event_details)
    except Exception as e:
        logging.error(f"Error creating event: {e}")
        await reply("❌ Une erreur est survenue lors de la création de l'événement.")
        return None


async def on_duplicate_confirm_callback(update: Update, _):
    """Le membre confirme (ou annule) la création d'un mannam malgré un
    doublon détecté (même pasteur, même date, déjà actif)."""
    query = update.callback_query
    await query.answer()
    try:
        _, token, choice = query.data.split("|", 2)
    except ValueError:
        return

    pending = _pending_duplicate_confirms.pop(token, None)
    if not pending:
        await query.edit_message_text("⌛ Cette demande a expiré. Relancez /add.")
        return

    if choice != "yes":
        await query.edit_message_text("❌ Création annulée.")
        return

    await query.edit_message_text("Création en cours...")
    await _create_mannam_event(query.message.reply_text, pending["event_details"])


async def _prompt_pastor_confirm(update: Update, sync_result: dict, event_details: dict) -> None:
    """Le rattachement pasteur n'est qu'approximatif (nom proche d'un dossier
    existant, pas identique) : demande confirmation plutôt que d'accumuler
    silencieusement l'historique sur un dossier qui n'est peut-être pas le
    bon — la cause la plus fréquente de doublons non détectés."""
    figure_name = _extract_figure_name(event_details.get('summary', ''))
    token = f"{update.effective_chat.id}:{update.message.message_id}"
    _pending_pastor_confirms[token] = {
        'mannam_id': sync_result['id'],
        'figure_name': figure_name,
        'section': event_details.get('section', ''),
        'pays': event_details.get('pays', ''),
    }
    keyboard = InlineKeyboardMarkup([[
        InlineKeyboardButton("✅ Oui, c'est lui", callback_data=f"cp|{token}|yes"),
        InlineKeyboardButton("❌ Non, nouveau pasteur", callback_data=f"cp|{token}|no"),
    ]])
    pastor_label = sync_result.get('pastorName') or figure_name
    await update.message.reply_text(
        f"🔎 J'ai rattaché ce mannam à {pastor_label} (dossier déjà existant, "
        "nom proche mais pas identique) — c'est bien la même personne ?",
        reply_markup=keyboard,
    )


async def on_pastor_confirm_callback(update: Update, _):
    """Confirme ou infirme un rattachement pasteur approximatif proposé après
    la création d'un mannam. Sur "Non" : crée un nouveau dossier pour ce nom
    et y réaffecte le mannam, plutôt que de le laisser sur le mauvais
    dossier — évite d'alimenter un doublon sans que personne ne le remarque."""
    query = update.callback_query
    await query.answer()
    try:
        _, token, choice = query.data.split("|", 2)
    except ValueError:
        return

    pending = _pending_pastor_confirms.pop(token, None)
    if not pending:
        await query.edit_message_text("⌛ Cette demande a expiré.")
        return

    if choice == "yes":
        await query.edit_message_text("✅ Rattachement confirmé.")
        return

    try:
        api_client.reject_pastor_match(
            pending["mannam_id"], pending["figure_name"],
            section=pending.get("section", ""), pays=pending.get("pays", ""),
        )
        await query.edit_message_text(
            f"🆕 Nouveau dossier créé pour « {pending['figure_name']} » et mannam réaffecté."
        )
    except Exception as e:
        logging.error(f"Erreur reject_pastor_match: {e}")
        await query.edit_message_text("❌ Une erreur est survenue lors de la réaffectation.")


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

        # Les mannams issus d'un rapport chatgi n'ont jamais d'événement
        # Google Calendar réel (cf. on_chatgi_report) — sans ça, ils restent
        # invisibles à /list alors qu'ils existent bien côté site.
        firestore_mannams: list[dict] = []
        try:
            firestore_mannams = api_client.get_mannams_without_calendar_event(
                start_of_week.strftime('%Y-%m-%d'), end_of_week.strftime('%Y-%m-%d'),
            )
        except Exception as e:
            logging.warning(f"Impossible de récupérer les mannams chatgi pour /list: {e}")

        if not events and not firestore_mannams:
            await update.message.reply_text('No events scheduled for this week.')
            return

        events_by_date = defaultdict(list)
        for event in events:
            start = event.get('start', {}).get('dateTime', event.get('start', {}).get('date'))
            start_time = (datetime.fromisoformat(start) if 'T' in start
                          else datetime.fromisoformat(start + "T00:00:00"))
            if start_time.tzinfo is not None:
                # Google Calendar renvoie un datetime avec offset ; les
                # mannams chatgi (Firestore) sont naïfs. Comparer les deux
                # (tri par heure) lève TypeError si on ne les uniformise
                # pas — l'offset ne change pas l'heure murale affichée.
                start_time = start_time.replace(tzinfo=None)
            events_by_date[start_time.strftime('%Y-%m-%d')].append((event, start_time, "calendar"))
        for m in firestore_mannams:
            date = m.get('date') or ''
            if not date:
                continue
            try:
                start_time = datetime.fromisoformat(f"{date}T{m.get('time') or '00:00'}:00")
            except ValueError:
                # Heure mal formée (texte libre non normalisé côté source) —
                # ne doit jamais faire échouer /list pour tout le monde.
                logging.warning(f"Heure invalide pour le mannam {m.get('id')}: {m.get('time')!r}")
                start_time = datetime.fromisoformat(f"{date}T00:00:00")
            events_by_date[date].append((m, start_time, "firestore"))

        # Un seul tri chronologique par date, réutilisé pour construire à la
        # fois _list_cache (les numéros [N]) et le texte affiché — sinon les
        # deux peuvent diverger (numéro affiché ≠ index réel) dès que
        # Calendar et Firestore partagent une date, puisque l'ordre
        # d'insertion (Calendar toujours avant Firestore) ne correspond pas
        # forcément à l'ordre chronologique.
        sorted_by_date = {
            date: sorted(items, key=lambda t: t[1]) for date, items in events_by_date.items()
        }

        ordered_event_ids: list[str] = []
        firestore_ids: set[str] = set()
        for date in sorted(sorted_by_date.keys()):
            for item, _start_time, source in sorted_by_date[date]:
                item_id = item['id']
                ordered_event_ids.append(item_id)
                if source == "firestore":
                    firestore_ids.add(item_id)
        chat_id = update.effective_chat.id
        _list_cache[chat_id] = ordered_event_ids
        _list_cache_firestore_ids[chat_id] = firestore_ids

        results = ["🔰 Weekly Offline Mannam\n"]
        idx = 1
        for date in sorted(sorted_by_date.keys()):
            results.append(f"📆 Date: {datetime.strptime(date, '%Y-%m-%d').strftime('%Y-%m-%d (%A)')}")
            for item, start_time, source in sorted_by_date[date]:
                if source == "calendar":
                    mannamjas, desc = extract_mannamjas_and_clean_description(item.get('description', ''))
                    section = extract_section_from_description(item.get('description', ''))
                    results.append(
                        f"[{idx}] 🇫🇷☀️ {item.get('summary', 'N/A')} / {desc}\n"
                        f"    🗝 {item.get('location', 'N/A')} ({start_time.strftime('%H:%M')})\n"
                        f"    🚶 Mannamjas: {mannamjas.replace('&amp;', ', ')}\n"
                        f"    🏷 Section: {section or '-'}\n"
                    )
                else:
                    results.append(
                        f"[{idx}] 🧡 {item.get('summary', 'N/A')} (chatgi — pas d'événement Calendar)\n"
                        f"    🗝 {item.get('location') or '-'} ({start_time.strftime('%H:%M')})\n"
                    )
                idx += 1
            results.append("")
        results.append(
            "➡️ Supprimer : /delete <numéro>  |  Modifier : /edit <numéro>\n"
            "ℹ️ Les mannams 🧡 (chatgi) ne sont modifiables que depuis le site, pas via /edit."
        )
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
    if event_id in _list_cache_firestore_ids.get(chat_id, set()):
        await update.message.reply_text(
            f"⚠️ Cet élément [{idx}] vient d'un rapport chatgi et n'a pas d'événement Google Calendar — "
            "modifiez-le depuis le site plutôt que via /edit."
        )
        return ConversationHandler.END

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
    changes = normalize_edit_with_gemini(message)
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
    _, new_description = extract_mannamjas_and_clean_description(new_description)
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
    if event_id in _list_cache_firestore_ids.get(chat_id, set()):
        # Mannam issu d'un rapport chatgi : pas d'événement Calendar à
        # supprimer, juste le document Firestore (archivage).
        try:
            api_client.delete_meeting(event_id)
            _list_cache[chat_id].pop(idx - 1)
            _list_cache_firestore_ids[chat_id].discard(event_id)
            await update.message.reply_text(f"✅ Événement [{idx}] supprimé avec succès.")
        except Exception as e:
            logging.error(f"Error deleting firestore-only mannam: {e}")
            await update.message.reply_text("❌ Une erreur est survenue lors de la suppression de l'événement.")
        return

    service  = get_calendar_service()
    try:
        service.events().delete(calendarId=CALENDAR_ID, eventId=event_id).execute()
        _list_cache[chat_id].pop(idx - 1)
        _delete_mannam_from_api(event_id)
        await update.message.reply_text(f"✅ Événement [{idx}] supprimé avec succès.")
    except Exception as e:
        logging.error(f"Error deleting event: {e}")
        await update.message.reply_text("❌ Une erreur est survenue lors de la suppression de l'événement.")


# ── Rapports de mannam (#AMR) ──────────────────────────────────────────────────
# Détection passive : les membres postent déjà leurs comptes-rendus sous un
# gabarit fixe se terminant par "#AMR" — pas besoin de commande dédiée. Seul le
# résultat (succès/échec/en cours/annulé) est confirmé d'un tap, car ce champ
# pilote un vrai changement d'état et ne doit jamais être deviné par une IA.

# token ("chat_id:message_id") → rapport en attente de confirmation du résultat
_pending_reports: dict[str, dict] = {}
# token ("chat_id:message_id") → rapport en attente du choix du bon pasteur
# (le nom dans le rapport ne matche exactement aucun dossier)
_pending_matches: dict[str, dict] = {}
# token ("chat_id:message_id") → mannam en attente de confirmation du
# rattachement pasteur (match approximatif "fuzzy" — nom trouvé proche d'un
# dossier existant, mais pas assez exact pour l'attacher sans demander)
_pending_pastor_confirms: dict[str, dict] = {}

_RESULTAT_LABELS = {
    "succes": "✅ Succès",
    "processus_en_cours": "⟳ En cours",
    "echec": "✕ Échec",
    "annule": "⊘ Annulé",
}


def _resultat_keyboard(token: str) -> InlineKeyboardMarkup:
    buttons = [
        InlineKeyboardButton(label, callback_data=f"rr|{token}|{code}")
        for code, label in _RESULTAT_LABELS.items()
    ]
    rows = [buttons[i:i + 2] for i in range(0, len(buttons), 2)]
    return InlineKeyboardMarkup(rows)


async def _match_and_prompt(
    update: Update, pastor_name: str, report: dict, reporter: str = "", reply_to: int | None = None,
) -> None:
    """Rattache pastor_name via /api/bot/reports/match puis propose le clavier
    de résultat, ou renvoie un message d'échec avec le filet de secours.
    Partagé entre la détection passive #AMR et /nouveau_rapport <nom du pasteur> —
    ce dernier existe précisément parce que /list (donc /nouveau_rapport <numéro>)
    ne montre que les mannams de la semaine en cours."""
    try:
        match = api_client.match_report(pastor_name)
    except Exception as e:
        logging.error(f"Erreur match_report: {e}")
        await update.message.reply_text(
            "⚠️ Une erreur est survenue lors du rattachement.\n"
            "Utilisez /nouveau_rapport <numéro> (après /list) pour le relier manuellement.",
            reply_to_message_id=reply_to,
        )
        return

    if not match.get("matched"):
        candidates = match.get("candidates") or []
        if candidates:
            # Le nom du rapport n'est pas toujours exact (typo, surnom...) —
            # on propose un choix plutôt que d'abandonner ou de deviner seul.
            token = f"{update.effective_chat.id}:{update.message.message_id}"
            _pending_matches[token] = {"report": report, "reporter": reporter}
            rows = [
                [InlineKeyboardButton(c["pastorName"], callback_data=f"rp|{token}|{c['pastorId']}")]
                for c in candidates
            ]
            rows.append([InlineKeyboardButton("Aucun de ceux-là", callback_data=f"rp|{token}|none")])
            await update.message.reply_text(
                f"🔎 « {pastor_name} » ne correspond exactement à aucun pasteur. Vouliez-vous dire :",
                reply_to_message_id=reply_to,
                reply_markup=InlineKeyboardMarkup(rows),
            )
            return

        if match.get("reason") == "no_pending_mannam":
            detail = f"« {pastor_name} » trouvé mais aucun mannam en attente de rapport pour ce pasteur"
        else:
            detail = f"aucun pasteur trouvé pour « {pastor_name} »"
        await update.message.reply_text(
            f"⚠️ {detail}.\nVérifiez l'orthographe, ou utilisez /nouveau_rapport <numéro> (après /list).",
            reply_to_message_id=reply_to,
        )
        return

    token = f"{update.effective_chat.id}:{update.message.message_id}"
    _pending_reports[token] = {"mannam_id": match["mannamId"], "report": report, "reporter": reporter}

    await update.message.reply_text(
        f"📋 Rapport détecté pour {match['pastorName']} ({match['mannamDate']}) — quel résultat ?",
        reply_to_message_id=reply_to,
        reply_markup=_resultat_keyboard(token),
    )


async def on_amr_report(update: Update, _):
    """Détection passive d'un message #AMR : extraction Gemini + rattachement
    pasteur/mannam (lecture seule), puis un tap suffit pour confirmer le résultat."""
    message = update.message.text or ""
    fields = normalize_report_with_gemini(message)
    if not fields or not fields.get("pastor_name"):
        await update.message.reply_text(
            "⚠️ Rapport #AMR détecté mais le nom du pasteur n'a pas pu être identifié.\n"
            "Utilisez /nouveau_rapport <nom du pasteur> ou /nouveau_rapport <numéro> (après /list) pour le relier manuellement.",
            reply_to_message_id=update.message.message_id,
        )
        return

    await _match_and_prompt(
        update, fields["pastor_name"],
        report={
            "resume": fields.get("resume", ""),
            "sujets": fields.get("eglise", ""),
            "prochaines_etapes": fields.get("prochaines_etapes", ""),
        },
        reporter=fields.get("responsable", ""),
        reply_to=update.message.message_id,
    )


async def on_report_result_callback(update: Update, _):
    """Applique le rapport en attente dès qu'un bouton de résultat est tapé."""
    query = update.callback_query
    await query.answer()
    try:
        _, token, resultat = query.data.split("|", 2)
    except ValueError:
        return

    pending = _pending_reports.pop(token, None)
    if not pending:
        await query.edit_message_text(
            "⌛ Cette demande a expiré. Relancez le rapport ou utilisez /nouveau_rapport <numéro>."
        )
        return

    try:
        api_client.submit_report(
            pending["mannam_id"],
            {**pending["report"], "resultat": resultat},
            reporter=pending.get("reporter", ""),
        )
        await query.edit_message_text(f"✅ Rapport enregistré ({_RESULTAT_LABELS.get(resultat, resultat)}).")
    except Exception as e:
        logging.error(f"Erreur submit_report: {e}")
        await query.edit_message_text("❌ Une erreur est survenue lors de l'enregistrement du rapport.")


async def on_pastor_pick_callback(update: Update, _):
    """Le membre choisit le bon pasteur parmi les candidats proposés quand le
    nom du rapport ne matche exactement aucun dossier. Cherche ensuite son
    mannam en attente et propose le clavier de résultat, comme pour un
    rattachement automatique clair."""
    query = update.callback_query
    await query.answer()
    try:
        _, token, pastor_id = query.data.split("|", 2)
    except ValueError:
        return

    pending = _pending_matches.pop(token, None)
    if not pending:
        await query.edit_message_text(
            "⌛ Cette demande a expiré. Utilisez /nouveau_rapport <numéro> ou /nouveau_rapport <nom du pasteur>."
        )
        return

    if pastor_id == "none":
        await query.edit_message_text(
            "D'accord — utilisez /nouveau_rapport <numéro> (après /list) ou /nouveau_rapport <nom du pasteur> pour préciser."
        )
        return

    try:
        match = api_client.match_report_by_pastor(pastor_id)
    except Exception as e:
        logging.error(f"Erreur match_report_by_pastor: {e}")
        await query.edit_message_text("❌ Une erreur est survenue lors du rattachement.")
        return

    if not match.get("matched"):
        await query.edit_message_text(
            "⚠️ Ce pasteur n'a aucun mannam en attente de rapport.\n"
            "Utilisez /nouveau_rapport <numéro> (après /list) pour le relier manuellement."
        )
        return

    result_token = f"pick:{token}"
    _pending_reports[result_token] = {
        "mannam_id": match["mannamId"], "report": pending["report"], "reporter": pending["reporter"],
    }
    await query.edit_message_text(
        f"📋 Rapport détecté pour {match['pastorName']} ({match['mannamDate']}) — quel résultat ?",
        reply_markup=_resultat_keyboard(result_token),
    )


async def nouveau_rapport_command(update: Update, context):
    """Usage : /nouveau_rapport <numéro> (après /list) ou /nouveau_rapport <nom du pasteur>.
    Attache un NOUVEAU rapport à un mannam qui n'en a pas encore — filet de
    secours manuel si la détection automatique #AMR échoue ou est ambiguë.
    Le numéro réutilise _list_cache (comme /edit et /delete), mais /list ne
    montre que les mannams de la semaine en cours — d'où l'option par nom,
    qui rattache via /api/bot/reports/match comme la détection passive, et
    fonctionne donc quelle que soit la date du mannam.
    Pour relire un rapport déjà enregistré, voir /voir_rapport."""
    args = context.args
    if not args:
        await update.message.reply_text(
            "Usage : /nouveau_rapport <numéro> (après /list) ou /nouveau_rapport <nom du pasteur>."
        )
        return

    if len(args) == 1 and args[0].isdigit():
        idx = int(args[0])
        chat_id = update.effective_chat.id
        event_ids = _list_cache.get(chat_id, [])
        if not event_ids:
            await update.message.reply_text(
                "❌ Aucune liste en mémoire. Faites d'abord /list, ou utilisez /nouveau_rapport <nom du pasteur>."
            )
            return
        if idx < 1 or idx > len(event_ids):
            await update.message.reply_text(f"❌ Numéro invalide. Choisissez entre 1 et {len(event_ids)}.")
            return

        mannam_id = event_ids[idx - 1]
        token = f"{chat_id}:{update.message.message_id}"
        _pending_reports[token] = {"mannam_id": mannam_id, "report": {}, "reporter": ""}
        await update.message.reply_text(
            f"📋 Rapport pour l'événement [{idx}] — quel résultat ?",
            reply_markup=_resultat_keyboard(token),
        )
        return

    pastor_name = " ".join(args)
    await _match_and_prompt(update, pastor_name, report={})


def _escape_html(s: str) -> str:
    return html.escape(str(s or ""), quote=False)


def _format_reporter(report_by: str) -> str:
    """report_by est soit 'mannam_bot:<prénom>' (rapport #AMR/Telegram), soit
    'mannam_bot' (sans nom précisé), soit un uid Firebase (rapport web) —
    jamais affiché tel quel, pas lisible pour un humain."""
    if report_by.startswith("mannam_bot:"):
        return report_by.removeprefix("mannam_bot:") or "Telegram"
    if report_by == "mannam_bot":
        return "Telegram"
    return "le site" if report_by else ""


def _format_report_message(result: dict) -> str:
    """Met en forme (HTML Telegram) le rapport renvoyé par /reports/view."""
    report = result.get("report") or {}
    resultat_label = _RESULTAT_LABELS.get(result.get("resultat", ""), result.get("resultat", "-"))
    pastor_name = _escape_html(result.get("pastorName", ""))
    mannam_date = _escape_html(result.get("mannamDate", ""))

    header = f"📄 <b>Rapport — {pastor_name}</b>"
    if mannam_date:
        header += f"\n🗓 {mannam_date}"
    blocks = [header, f"<b>Résultat :</b> {resultat_label}"]

    sections = [
        ("resume", "📝", "Résumé"),
        ("sujets", "📌", "Sujets abordés"),
        ("difficultes", "⚠️", "Difficultés"),
        ("prochaines_etapes", "🔜", "Prochaines étapes"),
        ("prochaine_date", "📅", "Prochain rendez-vous"),
    ]
    for key, emoji, label in sections:
        if report.get(key):
            blocks.append(f"{emoji} <b>{label}</b>\n{_escape_html(report[key])}")

    reporter = _format_reporter(result.get("reportBy", ""))
    if reporter:
        blocks.append(f"👤 <i>Rapporté par {_escape_html(reporter)}</i>")

    return "\n\n".join(blocks)


async def voir_rapport_command(update: Update, context):
    """Usage : /voir_rapport <nom du pasteur>. Consultation en LECTURE SEULE
    du dernier rapport déjà enregistré pour ce pasteur — n'attache ni ne
    modifie rien, contrairement à /nouveau_rapport (qui échoue volontairement
    si un rapport existe déjà, faute de mannam "en attente")."""
    args = context.args
    if not args:
        await update.message.reply_text("Usage : /voir_rapport <nom du pasteur>.")
        return

    pastor_name = " ".join(args)
    try:
        result = api_client.view_report(pastor_name)
    except Exception as e:
        logging.error(f"Erreur view_report: {e}")
        await update.message.reply_text("⚠️ Une erreur est survenue lors de la consultation.")
        return

    if not result.get("found"):
        reason = result.get("reason")
        if reason == "ambiguous":
            names = ", ".join(c["pastorName"] for c in result.get("candidates") or [])
            await update.message.reply_text(
                f"🔎 « {pastor_name} » ne correspond exactement à aucun pasteur. Vouliez-vous dire : {names} ?\n"
                "Relancez /voir_rapport avec le nom exact."
            )
        elif reason == "no_report":
            await update.message.reply_text(
                f"ℹ️ « {result.get('pastorName') or pastor_name} » n'a pas encore de rapport enregistré."
            )
        else:
            await update.message.reply_text(f"⚠️ Aucun pasteur trouvé pour « {pastor_name} ».")
        return

    await update.message.reply_text(_format_report_message(result), parse_mode="HTML")


# ── Rapports chatgi (SUBAE FORM, #chatgui) ──────────────────────────────────
# Détection passive, même principe que #AMR : les groupes postent déjà leur
# compte-rendu quotidien de prospection sous un gabarit fixe se terminant
# par "#chatgui". Contrairement à #AMR, aucune confirmation humaine n'est
# nécessaire (pas de champ à trancher comme le résultat d'un mannam) — tout
# est enregistré directement dès l'extraction.

_GROUPE_LABELS = {"centre": "Centre + KYK", "team": "Team + Fidèle"}
_EVENT_TYPE_SUMMARY = {"mannam": "Mannam {name}", "ls": "Leçon Spéciale — {name}"}


async def on_chatgi_report(update: Update, _):
    """Détection passive d'un message #chatgui (SUBAE FORM) : extrait les
    compteurs de prospection (recherche/appels/chatgi) par personne et les
    mannams obtenus, puis enregistre le tout via l'API centrale."""
    message = update.message.text or ""
    fields = normalize_chatgi_with_gemini(message)
    if not fields:
        await update.message.reply_text(
            "⚠️ SUBAE FORM détecté mais l'extraction a échoué. Réessayez, ou contactez un administrateur.",
            reply_to_message_id=update.message.message_id,
        )
        return

    if fields["groupe"] not in ("centre", "team"):
        await update.message.reply_text(
            "⚠️ SUBAE FORM détecté mais la ligne « 👥Groupe : Centre » ou « 👥Groupe : Team » "
            "est absente ou illisible — ajoutez-la pour que ce rapport soit comptabilisé.",
            reply_to_message_id=update.message.message_id,
        )
        return

    totals = _chatgi_totals(fields["entries"])
    date_iso = _convert_sck_date(fields["date"])
    telegram_message_id = f"{update.effective_chat.id}:{update.message.message_id}"

    try:
        api_client.submit_chatgi_report({
            "telegramMessageId": telegram_message_id,
            "date": date_iso,
            "groupe": fields["groupe"],
            "entries": fields["entries"],
        })
    except Exception as e:
        logging.error(f"Erreur submit_chatgi_report: {e}")
        await update.message.reply_text(
            "❌ Une erreur est survenue lors de l'enregistrement du rapport chatgi.",
            reply_to_message_id=update.message.message_id,
        )
        return

    created_types: list[str] = []
    skipped_count = 0
    for m in fields["mannams"]:
        event_type = m.get("event_type", "mannam")
        mannam_date = _convert_sck_date(m.get("date", "")) or date_iso
        # Clé stable (pasteur + type + date de l'événement + groupe), PAS le
        # message Telegram : un même 🧡 reposté/mis à jour dans la journée
        # doit mettre à jour le MÊME mannam plutôt que d'en créer un double.
        event_id = f"chatgi:{fields['groupe']}:{_normalize_key(m['figure_name'])}:{event_type}:{mannam_date}"

        # Un mannam pour ce pasteur à cette date peut déjà exister via une
        # AUTRE voie (/add, sync calendrier…) — si c'est le cas ET que ce
        # n'est pas déjà NOTRE propre entrée (repost du même 🧡, identifié
        # par le même event_id synthétique, qu'on doit continuer à mettre
        # à jour normalement), ne pas en créer un second.
        try:
            dup = api_client.check_duplicate_mannam(m["figure_name"], mannam_date)
        except Exception as e:
            logging.warning(f"Erreur check_duplicate_mannam (chatgi): {e}")
            dup = {"duplicate": False}
        if dup.get("duplicate") and dup.get("mannamId") != event_id:
            skipped_count += 1
            continue

        try:
            api_client.upsert_meeting(event_id, {
                "summary": _EVENT_TYPE_SUMMARY.get(event_type, _EVENT_TYPE_SUMMARY["mannam"])
                    .format(name=m["figure_name"]),
                "date": mannam_date,
                "time": _normalize_french_time(m.get("time", "")),
                "location": m.get("location", ""),
                "figure_name": m["figure_name"],
                "groupe": fields["groupe"],
                "event_type": event_type,
            })
            created_types.append(event_type)
        except Exception as e:
            logging.warning(f"Erreur upsert mannam depuis chatgi ({m['figure_name']}): {e}")

    groupe_label = _GROUPE_LABELS.get(fields["groupe"], fields["groupe"])
    summary = (
        f"✅ Chatgi enregistrés pour {groupe_label} du {date_iso} : "
        f"👤 {totals['chatgi']} · ☎️ {totals['appels']} · 🌾 {totals['recherche']}"
    )
    if created_types:
        mannam_count = created_types.count("mannam")
        ls_count = created_types.count("ls")
        parts = []
        if mannam_count:
            parts.append(f"{mannam_count} mannam(s)")
        if ls_count:
            parts.append(f"{ls_count} leçon(s) spéciale(s)")
        summary += f"\n🧡 " + " · ".join(parts) + " prévu(s) ajouté(s)."
    if skipped_count:
        summary += f"\nℹ️ {skipped_count} déjà existant(s) (créé ailleurs), non recréé(s)."
    await update.message.reply_text(summary, reply_to_message_id=update.message.message_id)


# -- Construction de l'application Telegram ────────────────────────────────────

BOT_COMMANDS = [
    BotCommand("start",   "Message de bienvenue"),
    BotCommand("add",     "Ajouter un événement au calendrier"),
    BotCommand("list",    "Voir les événements de la semaine"),
    BotCommand("edit",    "Modifier un événement (/edit <numéro>)"),
    BotCommand("delete",  "Supprimer un événement (/delete <numéro>)"),
    BotCommand("cancel",  "Annuler un /add ou /edit en cours"),
    BotCommand("nouveau_rapport", "Attacher un nouveau rapport (/nouveau_rapport <numéro> ou <nom du pasteur>)"),
    BotCommand("voir_rapport", "Consulter un rapport déjà enregistré (/voir_rapport <nom du pasteur>)"),
]


async def cancel_conversation(update: Update, _):
    """Sort explicitement d'un /add ou /edit en cours. Existe surtout pour
    la conversation_timeout ci-dessous : tant qu'une conversation /add ou
    /edit reste ouverte (oubliée, abandonnée…), TOUS les messages texte
    suivants dans ce chat — y compris les #AMR et #chatgui passifs — sont
    absorbés par son handler au lieu d'être détectés normalement."""
    await update.message.reply_text("❌ Annulé.")
    return ConversationHandler.END


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
        # Tant que cette conversation reste ouverte (/add ou /edit oublié,
        # sans /cancel), TOUT message texte suivant dans ce chat — y compris
        # les #AMR et #chatgui passifs — est absorbé par son handler au lieu
        # d'être détecté normalement. /cancel est le seul filet de secours
        # (pas de conversation_timeout : nécessiterait l'extra job-queue,
        # non installé ici).
        fallbacks=[CommandHandler('cancel', cancel_conversation)],
    )

    app.add_handler(conv_handler)
    app.add_handler(CommandHandler("start",      start))
    app.add_handler(CommandHandler("list",       list_events))
    app.add_handler(CommandHandler("delete", delete_event))
    app.add_handler(CommandHandler("nouveau_rapport", nouveau_rapport_command))
    app.add_handler(CommandHandler("voir_rapport", voir_rapport_command))
    app.add_handler(MessageHandler(filters.Regex(r'#AMR') & filters.TEXT, on_amr_report))
    app.add_handler(MessageHandler(filters.Regex(r'(?i)#chatgui') & filters.TEXT, on_chatgi_report))
    app.add_handler(CallbackQueryHandler(on_pastor_pick_callback, pattern=r'^rp\|'))
    app.add_handler(CallbackQueryHandler(on_report_result_callback, pattern=r'^rr\|'))
    app.add_handler(CallbackQueryHandler(on_pastor_confirm_callback, pattern=r'^cp\|'))
    app.add_handler(CallbackQueryHandler(on_duplicate_confirm_callback, pattern=r'^dc\|'))

    return app
