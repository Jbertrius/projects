# Amélioration du parsing des messages `/add` - Manuel d'utilisation

## Problème original
Le bot mannam rejetait les messages mal structurés avec : `⚠️ Champs manquants : Titre, Date, Heure, Lieu`

## Solution : Support de 3 formats de parsing

### 1. **Format Gemini (IA - Recommandé)**
Le bot utilise **Gemini AI** pour parser les messages libres naturellement structurés.

**Avantage** : Très flexible, accepte les dates/heures en français, typos mineurs, formatage libre.

**Exemple** :
```
Visite Pasteur Kasa Kasa le 23 avril 2026 à 18h00 à Châtelet pour présentation du GMCS, Haena, Fidèles
```

---

### 2. **Format Structuré (Option 3)**
Structure rigide avec des étiquettes explicites.

**Avantage** : Fiable, sans ambiguïté, pas d'API requise.

**Format** :
```
Titre : Visite Pasteur Kasa Kasa
Date : 2026-04-23
Heure : 18:00
Lieu : Châtelet
Description : Présentation du GMCS invitation Sommet Paris
Mannamjas : Haena
Section : Fidèles
```

---

### 3. **Format Libre Amélioré (Option 2)**
Format semi-libre avec regexes intelligentes (fallback si Gemini n'est pas disponible).

**Avantage** : Flexible, localement traité (sans API), rapide.

**Format** :
```
Visite Pasteur Kasa Kasa le 23 avril 2026 à 18h00 à Châtelet pour présentation du GMCS invitation Sommet Paris, Haena, Fidèles
```

---

## Champs attendus

| Champ | Format | Exemple | Obligatoire |
|-------|--------|---------|-------------|
| **Titre** | Texte libre | `Visite Pasteur Kasa Kasa` | ✅ Oui |
| **Date** | `AAAA-MM-JJ` ou français | `2026-04-23` ou `23 avril 2026` | ✅ Oui |
| **Heure** | `HH:MM` ou français | `18:00` ou `18h00` | ✅ Oui |
| **Lieu** | Texte libre | `Châtelet` | ✅ Oui |
| **Description** | Texte libre | `Présentation du GMCS` | ❌ Non |
| **Mannamjas** | Noms séparés par virgules | `Haena, Alice` | ❌ Non |
| **Section** | `Talak`, `Fideles`, `New/Old`, `Centre` | `Fidèles` | ❌ Non |

---

## Ordre de parsing

Le bot essaie les parsers dans cet ordre :
1. **Gemini AI** (si API disponible)
2. **Format Structuré** (avec étiquettes explicites)
3. **Format Libre** (regexes intelligentes)

Le premier qui marche est utilisé. ✅

---

## Cas spéciaux gérés

✅ **Dates françaises** : `23 avril 2026`, `23 avril`, `23/04/2026`, `23/04`  
✅ **Heures françaises** : `18h00`, `18h`, `6h30 du soir`, `14:30`  
✅ **Typos** : `Chatelêt` → `Châtelet`, `mannamja` → `participants`  
✅ **Prépositions flexibles** : `à`, `au`, `en`, `a` (minuscule avec typo)  
✅ **Ordre flexible** : Les champs n'ont pas besoin d'être dans un ordre spécifique  

---

## Tests

Un script de test est disponible :
```bash
python3 test_parsers_standalone.py
```

Tous les 3 formats sont testés et fonctionnent correctement. ✅

---

## Recommandations

1. **Préférez le Format Libre Amélioré (Option 2)** pour les utilisateurs. C'est le plus naturel.
   ```
   Visite Pasteur Kasa Kasa le 23 avril 2026 à 18h00 à Châtelet pour présentation du GMCS, Haena, Fidèles
   ```

2. **Utilisez le Format Structuré (Option 3)** si vous avez besoin d'une fiabilité maximale.
   ```
   Titre : Visite Pasteur Kasa Kasa
   Date : 2026-04-23
   ...
   ```

3. **Laissez le Format Gemini** fonctionner en arrière-plan — il est très puissant pour les formats libres.

---

## Modifications du code

### `bot_core.py`
- ✅ Prompt Gemini amélioré (plus robuste)
- ✅ Fonction `_normalize_french_date()` (normalisation des dates)
- ✅ Fonction `_normalize_french_time()` (normalisation des heures)
- ✅ Fonction `parse_event_details_freeform()` (parser libre amélioré)
- ✅ Fonction `handle_add_event()` (ordre de parsing)

### Fichiers de test
- ✅ `test_parsers.py` (test complet avec dépendances)
- ✅ `test_parsers_standalone.py` (test standalone sans dépendances)
