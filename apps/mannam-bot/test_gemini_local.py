# -*- coding: utf-8 -*-
import os, sys, json, re
from datetime import datetime
from google import genai
from google.genai import types as genai_types

_gemini_client = genai.Client(api_key=os.environ['GEMINI_API_KEY'])

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
    return _GEMINI_PROMPT.replace("{year}", str(year)).replace("{{message}}", message)

def _extract_json_object(text: str) -> str:
    if not text:
        return ""
    cleaned = re.sub(r"```(?:json)?", "", text, flags=re.IGNORECASE).replace("```", "").strip()
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    return match.group(0).strip() if match else cleaned

def _looks_like_placeholder(value: str) -> bool:
    s = (value or "").strip().lower()
    if not s:
        return True
    tokens = ["inconnu", "unknown", "n/a", "non specifie", "non spécifié", "aucun", "pas precise", "pas précisé"]
    return any(tok in s for tok in tokens)

message = """Mannam Gmcs Pasteur Kasa kasa
23 avril 2026 18h00 a Chatelêt,  présentation du GMCS invitation Sommet paris, mannamja Haena, Fidèles"""

print("=== Test Gemini parsing ===")
print(f"Message :\n{message}\n")

prompt = _build_gemini_prompt(message)

response = _gemini_client.models.generate_content(
    model="gemini-2.5-flash",
    contents=prompt,
    config=genai_types.GenerateContentConfig(response_mime_type="application/json"),
)
raw_text = getattr(response, "text", "") or ""
print(f"Réponse brute Gemini : {raw_text!r}\n")

raw_json = _extract_json_object(raw_text)
data = json.loads(raw_json)

print("Résultat extrait :")
for k, v in data.items():
    print(f"  {k:15}: {v!r}")

missing = [k for k in ("summary", "date", "time", "location") if not data.get(k)]
placeholders = [k for k in ("summary","date","time","location","description","mannamjas") if _looks_like_placeholder(str(data.get(k,"")))]

print()
print(f"Champs manquants  : {missing if missing else 'aucun'}")
print(f"Placeholders      : {placeholders if placeholders else 'aucun'}")
print()
if not missing and not placeholders:
    print("STATUT : OK - Evenement valide, creation possible")
else:
    print("STATUT : PROBLEME - Champs manquants ou invalides")
