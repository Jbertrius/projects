# Mannam Bot — Documentation

Bot Telegram de gestion et suivi des mannams (visites de figures religieuses).  
Déploiement : **Docker sur Google Cloud Platform** (Cloud Run, webhook) ou **local** (polling).

---

## Architecture

```
bot_core.py       — toute la logique partagée (handlers, Google APIs, stats)
main.py           — entrypoint PRODUCTION (webhook, GCP/Cloud Run)
main_dev.py       — entrypoint DÉVELOPPEMENT LOCAL (polling, dotenv)
```

---

## Prérequis

| Outil | Version minimale |
|---|---|
| Python | 3.11+ |
| Docker Desktop | toute version récente (optionnel) |
| WSL 2 + Debian | optionnel (recommandé pour tests) |

---

## Configuration

### 1. Créer le fichier `.env`

```bash
cp .env.example .env
```

Remplir `.env` :

```dotenv
# Token obtenu via @BotFather
BOT_TOKEN=7873549...

# Clé API Gemini (google.generativeai)
GEMINI_API_KEY=AIza...

# Contenu du fichier service_account.json sur UNE SEULE LIGNE
# PowerShell : (Get-Content service_account.json -Raw) -replace "`r`n","\n"
# Bash/WSL  : cat service_account.json | tr -d '\n'
service_account_key={"type":"service_account", ...}
```

---

## Lancement local (polling)

```bash
# Installer les dépendances
pip install -r requirements.txt python-dotenv

# Démarrer le bot
python main_dev.py
```

Ou via WSL :

```bash
bash setup_wsl.sh       # 1ère fois uniquement
source .venv-wsl/bin/activate
python main_dev.py
```

---

## Commandes disponibles

| Commande | Action |
|---|---|
| `/start` | Message de bienvenue |
| `/add` | Ajouter un événement (libre ou structuré, parsé par Gemini) |
| `/list` | Événements de la semaine courante |
| `/edit <n>` | Modifier l'événement n° n (après `/list`) |
| `/delete <n>` | Supprimer l'événement n° n (après `/list`) |
| `/check_data` | Rapport pastoral par groupe (PC / DMD / Bénin) |
| `/stats` | Générer le dashboard de suivi des mannams → GSheet `dashboard` |

### Format structuré pour `/add` (ou description libre)

```
Titre : Visite Pastor Kim
Date : 2026-03-15
Heure : 14:30
Lieu : Salle A
Description : Prédication du dimanche
Mannamjas : Alice, Bob
```

> Gemini 2.5-flash parse aussi les messages naturels :  
> _"Visite Pastor Kim le 15 mars à 14h30 à Paris, mannamjas Alice et Bob"_

---

## Google Sheets utilisées

| Feuille | Rôle |
|---|---|
| `data_pasteurs` | Référentiel des figures religieuses (nom, position, indo, PIC, niveau) |
| `mannams` | Historique des mannams (sync depuis Google Calendar) |
| `mannamjas` | Liste maître des participants (`nom`, `second_name`, `groupe`) |
| `dashboard` | Tableau de bord généré par `/stats` |

### Colonnes `mannams`

`calendar_event_id` · `summary` · `date` · `time` · `location` · `description` · `mannamjas` · `mannam_status` · `comment` · `figure_name`

> `figure_name` est rempli automatiquement par Gemini lors du premier `/stats` et mis en cache dans la feuille pour les appels suivants.

### Colonnes `mannamjas`

| Colonne | Rôle |
|---|---|
| `nom` | Nom canonique du mannamja |
| `second_name` | Alias alternatif (ex : `Maelys` pour `Sunhee`) |
| `groupe` | `TP` ou `Center` |

La résolution des noms est floue : hyphens, initiales et suffixes CamelCase sont normalisés automatiquement (`SeokJin J` → `Seokjin`, `SeojunJk` → `Seojun`).

---

## Tests

```bash
# Windows
python -m pytest tests/ -v

# WSL
bash run_tests.sh -v
```

| Classe de test | Fonction testée |
|---|---|
| `TestParseEventDetails` | `parse_event_details()` |
| `TestSanitizeString` | `sanitize_string()` |
| `TestExtractMannamjas` | `extract_mannamjas_and_clean_description()` |
| `TestGetWeekRange` | `get_start_and_end_of_week()` |
| `TestCreateEvent` | `create_event()` (Google API mockée) |

---

## Docker local

```bash
# Build + lancer (mode polling, Dockerfile.dev)
docker-compose up --build

# Arrêter
docker-compose down
```

---

## Fichiers du projet

| Fichier | Rôle |
|---|---|
| `bot_core.py` | Logique partagée (handlers, APIs, stats) |
| `main.py` | Entrypoint production (webhook) |
| `main_dev.py` | Entrypoint développement (polling) |
| `Dockerfile` | Image production (webhook) |
| `Dockerfile.dev` | Image développement local (polling) |
| `docker-compose.yml` | Test Docker local |
| `cloudbuild.yaml` | Pipeline CI/CD GCP |
| `requirements.txt` | Dépendances Python |
| `tests/` | Tests unitaires |
| `setup_wsl.sh` | Setup de l'environnement WSL |
| `run_tests.sh` | Lancement des tests sous WSL |

---

## Déploiement production (GCP)

Géré par `cloudbuild.yaml` (Cloud Build → Cloud Run).  
Variables requises (secrets GCP) :

- `BOT_TOKEN`
- `service_account_key`
- `GEMINI_API_KEY`
- `DOMAIN` — URL publique du service Cloud Run


Bot Telegram de gestion d'événements Google Calendar.  
Cible de déploiement : **Docker sur Google Cloud Platform** (via `main.py` + webhook).

---

## Prérequis

| Outil | Version minimale |
|---|---|
| Python | 3.11+ |
| Docker Desktop | toute version récente |
| WSL 2 + Debian | optionnel (recommandé) |

---

## Configuration initiale

### 1. Créer le fichier `.env`

```bash
cp .env.example .env
```

Éditer `.env` et remplir les deux variables obligatoires :

```dotenv
# Token obtenu via @BotFather sur Telegram
BOT_TOKEN=7873549...

# Contenu du fichier service_account.json, sur UNE SEULE LIGNE
# PowerShell :
#   (Get-Content service_account.json -Raw) -replace "`r`n","\n" -replace "`n","\n"
# Bash/WSL :
#   cat service_account.json | tr -d '\n'
service_account_key={"type":"service_account", ...}
```

---

## Les 3 modes de test

```
┌─────────────────────────────────────────────────────────────────┐
│  Niveau 1 — Tests unitaires    ← sans internet, sans credentials│
│  Niveau 2 — Bot en polling     ← bot réel, sans domaine public  │
│  Niveau 3 — Bot en Docker      ← proche environnement GCP       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Niveau 1 — Tests unitaires

Teste les fonctions Python pures (parsing, dates, formatage).  
**Aucune connexion à Telegram ou Google Calendar requise.**

### Option A — Windows (PowerShell)

```powershell
# 1ère fois : installer les dépendances de test
pip install pytest python-dotenv

# Lancer tous les tests
python -m pytest tests/ -v

# Filtrer par classe
python -m pytest tests/ -v -k "TestParseEventDetails"
```

### Option B — WSL (recommandé, proche Linux/GCP)

```bash
# 1ère fois uniquement : setup de l'environnement WSL
bash setup_wsl.sh
# Si erreur "python3.13-venv not found" :
#   sudo apt install python3.13-venv  puis relancer setup_wsl.sh

# Lancer tous les tests
bash run_tests.sh -v

# Filtrer par classe ou nom de test
bash run_tests.sh -v -k "TestCreateEvent"
bash run_tests.sh -v -k "test_extracts_correct_date"
```

### Résultat attendu

```
platform linux -- Python 3.13.5
collected 29 items

tests/test_utils.py::TestParseEventDetails::test_valid_message_returns_dict PASSED
...
29 passed in 13s
```

### Couverture des tests

| Classe de test | Fonction testée | # tests |
|---|---|---|
| `TestParseEventDetails` | `parse_event_details()` | 10 |
| `TestSanitizeString` | `sanitize_string()` | 5 |
| `TestExtractMannamjas` | `extract_mannamjas_and_clean_description()` | 5 |
| `TestGetWeekRange` | `get_start_and_end_of_week()` | 3 |
| `TestCreateEvent` | `create_event()` (Google API mockée) | 6 |

---

## Niveau 2 — Bot réel en mode polling

Lance le bot avec votre vrai token Telegram, **sans webhook ni domaine public**.  
Idéal pour tester les commandes directement depuis Telegram.

```bash
# Windows
pip install -r requirements.txt python-dotenv
python main_dev.py

# WSL
source .venv-wsl/bin/activate
python main_dev.py
```

Le bot répond aux commandes suivantes dans Telegram :

| Commande | Action |
|---|---|
| `/start` | Message de bienvenue |
| `/list` | Liste les événements de la semaine courante |
| `/add` | Démarre le formulaire de création d'événement |
| `/delete` | Démarre la suppression d'un événement |

#### Format pour `/add`

```
Titre : Visite Pastor Kim
Date : 2026-03-15
Heure : 14:30
Lieu : Salle A
Description : Prédication du dimanche
Mannamjas : Alice, Bob
```

---

## Niveau 3 — Bot en Docker (local)

Teste dans un conteneur Linux, à l'identique du déploiement GCP.  
**Requiert Docker Desktop et le fichier `.env` rempli.**

```bash
# Construire et lancer
docker-compose up --build

# Arrêter
docker-compose down
```

> Le conteneur utilise `Dockerfile.dev` (mode polling) et non `Dockerfile` (webhook production).

---

## Différence entre les fichiers

| Fichier | Usage | Mode |
|---|---|---|
| `main.py` | **Production** (GCP / Cloud Run) | Webhook |
| `main_dev.py` | **Développement local** | Polling |
| `Dockerfile` | Image de production | Webhook |
| `Dockerfile.dev` | Image de développement local | Polling |
| `docker-compose.yml` | Test Docker local | Polling |

---

## Déploiement production (GCP)

Le déploiement est géré par `cloudbuild.yaml`.  
`main.py` démarre en mode webhook et requiert :
- La variable `DOMAIN` pointant vers l'URL publique du service Cloud Run
- La variable `service_account_key` injectée comme secret GCP
- La variable `BOT_TOKEN` injectée comme secret GCP
