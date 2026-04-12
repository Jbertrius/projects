// ─────────────────────────────────────────────────────────────────────────────
// gemini-parser.js
// Uses Gemini to parse an attendance block into the same structure as
// academy-parser.js parseAttendanceBlock(), then falls back to the regex
// parser if Gemini is unavailable or returns malformed output.
// ─────────────────────────────────────────────────────────────────────────────

const { getEnv } = require("./google-auth");
const { parseAttendanceBlock } = require("./academy-parser");

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const SYSTEM_PROMPT = `Tu analyses un bloc de présence d'une classe académique chrétienne.
Retourne UNIQUEMENT du JSON strict sans markdown, sans explication.

Tu dois être CONSERVATEUR: mieux vaut ignorer une ligne ambiguë que créer un faux étudiant.
Ne pas halluciner de noms. Ne pas inventer d'étudiants absents du texte.

Structure attendue:
{
  "class_code": string,
  "church_name": string,
  "teacher_name": string,
  "lesson_title": string,
  "lesson_date": string,
  "registered_students": [[name, status, group], ...],
  "unregistered_students": [string],
  "absence_notes": { [name]: string }
}

RÈGLES STRICTES SUR CE QUI EST UN ÉTUDIANT:
Un étudiant est une PERSONNE avec un PRÉNOM et un NOM (ex: "Mane Massoly", "Habib Dossou").
Un étudiant doit provenir d'une ligne de participant (emoji statut + nom, ou ligne indexée d'élève).
Un étudiant n'est JAMAIS un en-tête de groupe, un pays, un hashtag, un code de classe, ou un mot-clé.

NE JAMAIS mettre dans registered_students:
- Les noms de pays ou régions: France, Gabon, Benin, Congo, etc.
- Les hashtags: #attendanceFR, #presence, etc.
- Les codes de classe: 157P, 115-1P, CEP, DMD, etc.
- Les lignes avec format "Pays (X/Y)": ce sont des en-têtes de groupe, PAS des étudiants
- Les lignes "Total", "TOTAL", légendes (présent=, absent=, etc.)
- Les lignes de section/rubrique: "ATTENDANCE", "Classe Ouverte", "Date", "Titre", "Instructeur", "Confirmé", "Présent", "Absent"
- Les lignes qui ne sont pas des noms de personnes

IDENTIFICATION DES ÉTUDIANTS:
- Formats étudiants acceptés:
  1) Non indexé: "👍 Nom Prénom" / "✖️ Nom Prénom"
  2) Indexé: "👍 1- Nom Prénom" / "✖️2. Nom Prénom" / "X 7) Nom Prénom"
- Emoji/statuts: 👍✅☑️✔️🎥 = present, ✖️❌🚫X = absent
- Si "late" ou "retard" est mentionné après le nom → status = "late"
- Les notes entre parenthèses après un nom (ex: "work night, MU samedi matin") → mettre UNIQUEMENT dans absence_notes ; l'étudiant DOIT quand même figurer dans registered_students avec son statut emoji
- Un étudiant avec une note reste TOUJOURS dans registered_students. Ne jamais l'omettre à cause de la note.
- Le nom dans registered_students = uniquement prénom + nom, SANS les parenthèses ni leur contenu
- group = le pays/région de l'en-tête précédent (France, Gabon, Benin...), sinon ""

RÈGLES ANTI-FAUX POSITIFS:
- Si une ligne contient "(X/Y)", c'est un en-tête de groupe, jamais un étudiant.
- Si une ligne commence par "#", c'est un hashtag, jamais un étudiant.
- Si le "nom" extrait est un seul mot (ex: "France", "Benin", "attendanceFR"), ne pas l'ajouter.
- Si le "nom" extrait correspond à un pays/région, ne pas l'ajouter.
- Si la ligne contient surtout des métadonnées (date, titre, total, code), ne pas l'ajouter.
- Les drapeaux seuls ou drapeaux + pays ne sont pas des étudiants.

ALGORITHME D'EXTRACTION (à suivre):
1) Détecter class_code, teacher_name, lesson_title, lesson_date.
2) Détecter les en-têtes de groupe "Pays (X/Y)" et mémoriser group courant.
3) Pour chaque ligne, extraire un étudiant uniquement si la ligne matche un format étudiant accepté.
4) Nettoyer le nom (retirer index, emoji, parenthèses finales) et valider que c'est une personne.
5) Rejeter les faux positifs avec les règles anti-faux positifs.
6) Construire registered_students sans doublons exacts sur le nom (garder la première occurrence).

MÉTADONNÉES:
- class_code: code après "ATTENDANCE -" ou après "⭐️" (ex: "157P")
- teacher_name: nom après "Date:" ou après un tiret sur la ligne date (ex: "Dohee BJN")
- lesson_date: code org 6 chiffres AAMMJJ depuis 1983 (430408 → 1983+43=2026, mois=04, jour=08 → 2026-04-08)
- lesson_title: texte après "Titre de la leçon :" ou "Titre:"
- church_name: nom d'église si mentionné après "ATTENDANCE - CODE -", sinon ""

EXEMPLE D'ERREUR À ÉVITER:
Entrée:
- "🇫🇷France (2/4)"
- "#attendanceFR"
Sortie INCORRECTE: ajouter "France" ou "attendanceFR" dans registered_students
Sortie CORRECTE: n'ajouter aucun étudiant pour ces lignes.

Ignorer complètement: hashtags (#...), lignes Total/TOTAL, lignes "⭐️CODE", drapeaux seuls`;

async function parseWithGemini(rawText, lessonDate = "") {
  const apiKey = getEnv("GEMINI_API_KEY");
  if (!apiKey) return null;

  const userContent = lessonDate
    ? `Date fournie séparément: ${lessonDate}\n\n${rawText}`
    : rawText;

  let response;
  try {
    response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: `${SYSTEM_PROMPT}\n\n---\n${userContent}` }] }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1
        }
      })
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    console.error(`[gemini-parser] HTTP ${response.status}: ${errText.slice(0, 200)}`);
    return null;
  }

  try {
    const payload = await response.json();
    const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    if (!text) {
      console.error("[gemini-parser] empty response from Gemini:", JSON.stringify(payload).slice(0, 300));
      return null;
    }
    const parsed = JSON.parse(text);

    // Validate minimum structure
    if (!Array.isArray(parsed.registered_students)) return null;

    return {
      class_code: String(parsed.class_code || "").trim(),
      church_name: String(parsed.church_name || "").trim(),
      teacher_name: String(parsed.teacher_name || "").trim(),
      lesson_title: String(parsed.lesson_title || "").trim(),
      lesson_date: String(parsed.lesson_date || "").trim(),
      registered_students: parsed.registered_students
        .filter((s) => Array.isArray(s) && s[0])
        .map(([name, status, group]) => [
          String(name || "").trim(),
          ["present", "absent", "late"].includes(status) ? status : "unknown",
          String(group || "").trim()
        ]),
      unregistered_students: (parsed.unregistered_students || []).map((n) => String(n || "").trim()).filter(Boolean),
      absence_notes: typeof parsed.absence_notes === "object" && parsed.absence_notes !== null
        ? parsed.absence_notes
        : {},
      raw_text: rawText,
      _parsed_by: "gemini"
    };
  } catch {
    return null;
  }
}

/**
 * Parse an attendance block using Gemini if available, with regex fallback.
 * Merges any caller-supplied overrides (classCode, lessonTitle, etc.) after parsing.
 */
async function parseAttendanceBlockSmart(rawText, lessonDate = "") {
  const geminiResult = await parseWithGemini(rawText, lessonDate);
  if (geminiResult) {
    const regexResult = parseAttendanceBlock(rawText, lessonDate);
    const merged = {
      ...geminiResult,
      class_code: geminiResult.class_code || regexResult.class_code,
      church_name: geminiResult.church_name || regexResult.church_name,
      teacher_name: geminiResult.teacher_name || regexResult.teacher_name,
      lesson_title: geminiResult.lesson_title || regexResult.lesson_title,
      lesson_date: geminiResult.lesson_date || regexResult.lesson_date,
      registered_students: Array.isArray(geminiResult.registered_students) && geminiResult.registered_students.length
        ? geminiResult.registered_students
        : regexResult.registered_students,
      unregistered_students: Array.isArray(geminiResult.unregistered_students) && geminiResult.unregistered_students.length
        ? geminiResult.unregistered_students
        : regexResult.unregistered_students,
      absence_notes: {
        ...(regexResult.absence_notes || {}),
        ...(geminiResult.absence_notes || {})
      }
    };

    return merged;
  }
  // Fallback to regex parser
  return parseAttendanceBlock(rawText, lessonDate);
}

module.exports = { parseAttendanceBlockSmart };
