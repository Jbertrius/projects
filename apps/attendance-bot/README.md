# Attendance Bot

Un bot Telegram de production qui gère les listes de présences d'événements
**et** le suivi d'assiduité des classes ouvertes. Les écritures applicatives
passent désormais par l'API centrale, tandis que Google Sheets reste utilisé
comme source auxiliaire pour certains workflows historiques. Le bot s'appuie
sur Google Gemini AI pour la compréhension du langage naturel.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Structure](#project-structure)
3. [Prerequisites](#prerequisites)
4. [Google Sheets Setup](#google-sheets-setup)
5. [Local Development](#local-development)
6. [GCP Setup](#gcp-setup)
7. [CI/CD – Cloud Build + GitHub](#cicd--cloud-build--github)
8. [Secrets Management](#secrets-management)
9. [Environment Variables Reference](#environment-variables-reference)
10. [Bot Commands & Usage](#bot-commands--usage)
11. [Class Attendance Tracking](#class-attendance-tracking)
12. [Avoiding Cold Starts](#avoiding-cold-starts)
13. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
User → Telegram → HTTPS Webhook
                        ↓
              Google Cloud Run (bot.py)
              ┌────────────────────────────────────┐
              │  python-telegram-bot 21             │
              │  ┌──────────────┐  ┌─────────────┐ │
              │  │   Commands   │  │  NLP Gemini │ │
              │  └──────────────┘  └─────────────┘ │
              │          ↓                          │
              │  AttendanceService                  │
              │          ↓                          │
              │  API centrale (/api/bot/*)          │
              └────────────────────────────────────┘
                        ↓
              Firestore / services du dashboard
              ┌──────────────────────────────────────┐
              │ members / meetings / academy*         │
              └──────────────────────────────────────┘
```

CI/CD flow:

```
GitHub push (main branch)
        ↓
Cloud Build trigger
        ↓
docker build  →  Artifact Registry  →  Cloud Run deploy
```

---

## Project Structure

```
attendance_bot/
├── bot.py                  # Entry point & handler registration
├── config.py               # Environment variable loader
├── gemini_parser.py        # Gemini AI NLP parser + attendance block parser
├── sheets_service.py       # Google Sheets CRUD (events + relational model)
├── attendance_service.py   # Business logic, validation & class tracking
│
├── commands/
│   ├── add.py              # /add
│   ├── remove.py           # /remove
│   ├── list_attendance.py  # /list
│   ├── events.py           # /events
│   ├── categories.py       # /categories
│   ├── lesson.py           # /newlesson  ← NEW
│   └── classreport.py      # /classreport  /studentreport  /absentees  ← NEW
│
├── utils/
│   ├── parser.py           # Fallback /command argument parser
│   └── formatters.py       # Telegram Markdown message builders
│
├── Dockerfile
├── cloudbuild.yaml
├── requirements.txt
└── README.md
```

---

## Prerequisites

| Tool | Version |
|------|---------|
| Python | 3.11+ |
| Docker | 24+ |
| gcloud CLI | latest |
| A Telegram Bot Token | from [@BotFather](https://t.me/BotFather) |
| A Google Cloud project | with billing enabled |
| A Gemini API key | from [Google AI Studio](https://aistudio.google.com) |

---

## Google Sheets Setup

### 1. Create the spreadsheet

Create a Google Sheets file with the following tabs named **exactly**:

**Event tracking (existing)**

| Tab | Purpose |
|-----|---------|
| `EVENTS` | Liste des événements |
| `CATEGORIES` | Catégories de participants |
| `ATTENDANCE` | Présences par événement |

**Class tracking (new – created automatically on first use)**

| Tab | Purpose |
|-----|---------|
| `CLASSES` | Une ligne par classe ouverte |
| `LESSONS` | Une ligne par leçon enregistrée |
| `STUDENTS` | Un étudiant par ligne, lié à sa classe |
| `LESSON_ATTENDANCE` | Statut présent/absent par leçon et par étudiant |
| `Fatoumata Class` | Pivot auto-généré pour Pst Fatoumata |
| `Hada Class` | Pivot auto-généré pour Pst Hada |
| *(une feuille par classe)* | Nommée d'après le prénom du professeur |

> Les 5 derniers onglets sont **créés et mis à jour automatiquement** à
> chaque appel à `/newlesson`. Vous n'avez rien à créer manuellement.

### 2. En-têtes des feuilles d'événements

**EVENTS**
```
event_id | event_name | date | description
```

**CATEGORIES**
```
category_id | category_name
```

**ATTENDANCE**
```
event_name | participant_name | category | timestamp
```

### 3. Données initiales (événements)

```
1 | Leadership Meeting  | 2026-03-14 | Réunion hebdomadaire
2 | Evangelism Training | 2026-03-21 | Session de formation
```

Catégories suggérées :
```
1 | Staff
2 | Guest
3 | Member
4 | Pastor
```

### 4. Partager la feuille avec le service account

Partagez le spreadsheet avec l'email du service account en tant qu'**Éditeur** :
```bash
cat service-account.json | python -c "import sys,json; print(json.load(sys.stdin)['client_email'])"
```

---

## Local Development

```bash
# 1. Clone the repo
git clone https://github.com/your-org/attendance_bot.git
cd attendance_bot

# 2. Create virtual environment
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure environment
cp .env.example .env
# Edit .env with your real values

# 5. Run in long-polling mode (no webhook needed locally)
python bot.py
```

> Lorsque `WEBHOOK_URL` est vide, le bot passe automatiquement en mode
> **long-polling**, idéal pour le développement local.

---

## GCP Setup

### Step 1 – Create a GCP project and enable APIs

```bash
export PROJECT_ID=my-gcp-project
export REGION=us-central1

gcloud projects create $PROJECT_ID
gcloud config set project $PROJECT_ID

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  firestore.googleapis.com
```

### Step 2 – Create Artifact Registry repository

```bash
gcloud artifacts repositories create attendance-bot \
  --repository-format=docker \
  --location=$REGION \
  --description="Attendance Bot Docker images"
```

### Step 3 – Create a Service Account for Google Sheets

```bash
gcloud iam service-accounts create attendance-sheets-sa \
  --display-name="Attendance Bot Sheets SA"

# Download the JSON key
gcloud iam service-accounts keys create service-account.json \
  --iam-account=attendance-sheets-sa@$PROJECT_ID.iam.gserviceaccount.com
```

### Step 3b – Create the Cloud Run runtime service account

```bash
RUNTIME_SA="attendance-runtime-sa@$PROJECT_ID.iam.gserviceaccount.com"

gcloud iam service-accounts create attendance-runtime-sa \
  --display-name="Attendance Bot Runtime SA"
```

Le bot n'écrit plus directement dans Firestore. Ce compte sert seulement
comme identité d'exécution Cloud Run si vous souhaitez séparer le runtime
du compte Compute par défaut.

### Step 4 – Grant Cloud Build permissions

```bash
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
CB_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/iam.serviceAccountUser"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/artifactregistry.writer"
```

### Step 4b – Allow Cloud Build to set the runtime identity on deploy

```bash
gcloud iam service-accounts add-iam-policy-binding \
  attendance-runtime-sa@$PROJECT_ID.iam.gserviceaccount.com \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/iam.serviceAccountUser"
```

---

## Secrets Management

```bash
create_secret() {
  gcloud secrets create "$1" --replication-policy=automatic
  echo -n "$2" | gcloud secrets versions add "$1" --data-file=-
}

create_secret TELEGRAM_BOT_TOKEN      "123456789:ABCDEF..."
create_secret GEMINI_API_KEY          "AIzaXXXXXXX..."
create_secret GOOGLE_SHEET_ID         "1BxiMV..."
create_secret WEBHOOK_URL             "https://attendance-bot-xxxx-uc.a.run.app"
create_secret BOT_API_KEY             "$(openssl rand -hex 32)"

SA_JSON=$(cat service-account.json | tr -d '\n')
create_secret GOOGLE_SERVICE_ACCOUNT_JSON "$SA_JSON"
```

> Cloud Build injecte ces secrets dans Cloud Run via `--set-secrets` dans
> `cloudbuild.yaml` — ils apparaissent comme variables d'environnement à
> l'intérieur du conteneur.

### Getting the WEBHOOK_URL

```bash
gcloud run deploy attendance-bot \
  --image=gcr.io/cloudrun/placeholder \
  --region=$REGION \
  --allow-unauthenticated

gcloud run services describe attendance-bot \
  --region=$REGION \
  --format='value(status.url)'
```

---

## CI/CD – Cloud Build + GitHub

### 1. Connect GitHub repository

GCP Console → Cloud Build → Triggers → **Connect Repository** → GitHub →
choisir votre dépôt.

### 2. Create the trigger

```bash
gcloud builds triggers create github \
  --repo-name=attendance_bot \
  --repo-owner=your-github-org \
  --branch-pattern="^main$" \
  --build-config=cloudbuild.yaml \
  --substitutions=_PROJECT_ID=$PROJECT_ID,_REGION=$REGION,_SERVICE=attendance-bot,_REGISTRY=$REGION-docker.pkg.dev/$PROJECT_ID/attendance-bot
```

### 3. Push to deploy

```bash
git add .
git commit -m "feat: deploy attendance bot"
git push origin main
```

Cloud Build va automatiquement :
1. Builder l'image Docker avec cache de couches
2. Pousser les tags `:SHORT_SHA` et `:latest` vers Artifact Registry
3. Déployer la nouvelle révision sur Cloud Run avec migration de trafic par étapes

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | ✅ | Token from @BotFather |
| `GEMINI_API_KEY` | ✅ | Gemini API key from AI Studio |
| `GOOGLE_SHEET_ID` | ✅ | The long ID in the Google Sheets URL |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | ✅ | Service account key JSON (single-line string) |
| `WEBHOOK_URL` | ✅ prod | Public HTTPS URL of the Cloud Run service |
| `API_BASE_URL` | ✅ | Base URL of the central dashboard API |
| `BOT_API_KEY` | ✅ | Shared Bearer token accepted by `/api/bot/*` |
| `PORT` | auto | Injected by Cloud Run (default: 8080) |
| `GEMINI_MODEL` | ❌ | Gemini model name (default: `gemini-2.5-flash`) |

---

## Bot Commands & Usage

### Toutes les commandes

| Commande | Description |
|---------|-------------|
| `/start` | Message d'accueil |
| `/help` | Afficher toutes les commandes |
| `/add <événement> <nom1> [nom2…] catégorie <cat>` | Ajouter des participants |
| `/remove <événement> <nom>` | Retirer un participant |
| `/list <événement>` | Afficher les présences groupées par catégorie |
| `/events` | Lister tous les événements |
| `/categories` | Lister toutes les catégories |
| `/newlesson` | Enregistrer une leçon (coller le bloc d'appel) |
| `/classreport <code>` | Rapport d'assiduité d'une classe |
| `/studentreport <nom>` | Suivi d'assiduité d'un étudiant |
| `/absentees <code> [titre]` | Absents par leçon |

---

### Gestion des événements (commandes existantes)

#### `/add` — Ajouter des participants

```
/add Leadership Meeting John Marie catégorie Staff
```

Gemini AI extrait automatiquement l'événement, les noms et la catégorie.
Si l'événement est ambigu, un clavier inline s'affiche pour choisir.

Réponse :
```
✅ Participants ajoutés

Événement : Leadership Meeting
Catégorie : Staff

Participants :
  • John
  • Marie
```

#### `/remove` — Retirer un participant

```
/remove Leadership Meeting Paul Dupont
```

#### `/list` — Afficher les présences

```
/list Leadership Meeting
```

```
📋 Présences – Leadership Meeting

Total : 3

▪️Staff (2)
1. John
2. Marie

▪️Guest (1)
1. Anna
```

#### `/events` et `/categories`

```
/events       → liste de tous les événements avec date
/categories   → liste de toutes les catégories
```

---

## Class Attendance Tracking

Ce module permet le **suivi d'assiduité des classes ouvertes** (Pst Fatoumata,
Pst Hada, etc.) avec traçabilité complète par leçon.

### Modèle relationnel

```
CLASSES ──< LESSONS ──< LESSON_ATTENDANCE
    │                          │
    └──────< STUDENTS ─────────┘
```

| Feuille | Colonnes clés |
|---------|--------------|
| `CLASSES` | class_id, class_code, church_name, teacher_name, sheet_tab |
| `LESSONS` | lesson_id, class_id, lesson_title, lesson_date |
| `STUDENTS` | student_id, class_id, student_name, is_registered |
| `LESSON_ATTENDANCE` | lesson_id, class_id, student_name, status (`present`/`absent`/`unknown`) |

---

### `/newlesson` — Enregistrer une leçon

Colle directement le bloc d'appel Telegram après la commande :

```
/newlesson
🔰Classe Ouverte - 164-2C - Eglise Mission d'Impact de la Parole de Dieu
👩‍🏫Pst Fatoumata AMANKOU
📝Titre de la leçon : La grâce suffisante
📆430317

Total : 8 / 10

👍1- Maxime AMANKOU
👍2- Blandine LIDA
👍3- Gnanki Hosniyath GOUNOU
👍4- Anne-Noé TROH
👍5- Audio Diane Marcelle TROH BIZIE
👍6- Eliona TROH
X 7- Eva MAMBO (absence maladie)
✖️8- Goli Jourdain KAFE (voyage)
👍- Dédé Akofa Nou HANVI
👍10- Audrey Aurore YORRO

▫️Non registered
👍1- Kelly NKATIAH
```

**Marqueurs de statut :**

| Marqueur | Signification |
|----------|--------------|
| 👍 | Présent |
| `X` | Absent |
| ✖️ | Absent |
| *(aucun)* | Statut inconnu |

> Une raison entre parenthèses est facultative : `X 7- Eva MAMBO (maladie)`.
> Elle est extraite et stockée dans le champ `absence_notes`.

**Format de la date `📆` (prioritaire) :**

La ligne `📆AAMMJJ` encode la date selon le calendrier de l'organisation :

| Code | Valeur |
|------|--------|
| `AA` | Année de l'org → année réelle = 1983 + AA |
| `MM` | Mois |
| `JJ` | Jour |

Exemple : `📆430317` → AA=43 → 1983+43=**2026**, MM=03, JJ=17 → **17 mars 2026**

**Priorité de résolution de la date :**
1. Ligne `📆` dans le bloc (priorité haute)
2. Date en première ligne après `/newlesson` : `2026-03-17` ou `17/03/2026`
3. Date du jour (fallback)

**Lignes sans numéro :** `👍- Dédé Akofa Nou HANVI` est accepté (le numéro est optionnel).

**Compatibilité ascendante :** l'ancien format `1- ✅Maxime AMANKOU` est toujours accepté.

**Ce que fait la commande automatiquement :**
1. Crée la classe dans `CLASSES` si elle n'existe pas encore
2. Crée les étudiants dans `STUDENTS` (inscrits et non-inscrits)
3. Insère la leçon dans `LESSONS`
4. Insère les lignes de présence dans `LESSON_ATTENDANCE`
5. **Reconstruit la feuille pivot** (ex : *Fatoumata Class*) avec le tableau
   complet ✅/✖️ par étudiant et par leçon

Réponse :
```
✅ Leçon enregistrée avec succès !

📚 La grâce suffisante
📅 2026-03-25
👩‍🏫 Pst Fatoumata AMANKOU
🔰 Classe 164-2C

📊 Résumé : 5/10 présent(s)

✅ Présents (5) :
  • Maxime AMANKOU
  • Anne-Noé TROH
  …

✖️ Absents (2) :
  • Blandine LIDA
  …

📋 Feuille mise à jour : Fatoumata Class
```

---

### `/classreport` — Rapport d'une classe

```
/classreport 164-2C
```

Affiche pour chaque étudiant inscrit son taux de présence sur l'ensemble
des leçons enregistrées.

```
📋 Rapport d'assiduité – Classe 164-2C
👩‍🏫 Pst Fatoumata AMANKOU
📚 3 leçon(s) enregistrée(s)

Étudiants inscrits :
  • Maxime AMANKOU — 3/3 (100%)
  • Blandine LIDA — 1/3 (33%)
  • Anne-Noé TROH — 2/3 (66%)
  …

Leçons :
  1. Introduction à la foi  2026-03-11
  2. La grâce suffisante    2026-03-18
  3. La prière              2026-03-25

📑 Détails dans la feuille Fatoumata Class
```

Vous pouvez aussi chercher par nom de professeur :
```
/classreport Fatoumata
```

---

### `/studentreport` — Suivi d'un étudiant

```
/studentreport Blandine LIDA
```

```
👤 Rapport étudiant – Blandine LIDA
📊 Assiduité globale : 1/3 (33%)

✅ 2026-03-11 — Introduction à la foi  164-2C
✖️ 2026-03-18 — La grâce suffisante   164-2C
✖️ 2026-03-25 — La prière             164-2C
```

---

### `/absentees` — Absents par leçon

```
/absentees 164-2C
```

Liste l'ensemble des absents pour chaque leçon de la classe.

```
/absentees 164-2C grâce
```

Filtre sur les leçons dont le titre contient *grâce*.

```
📋 Absences – Classe 164-2C
👩‍🏫 Pst Fatoumata AMANKOU

📚 La grâce suffisante – 2026-03-18 (2 absent(s))
  ✖️ Blandine LIDA
  ✖️ Audio Diane Marcelle TROH BIZIE
```

---

### Feuille pivot automatique (ex : *Fatoumata Class*)

Après chaque `/newlesson`, la feuille est **entièrement reconstruite** :

| Étudiant | Leçon 1 (2026-03-11) | Leçon 2 (2026-03-18) | … | Taux (%) | Présences | Total leçons |
|----------|---------------------|---------------------|---|----------|-----------|--------------|
| Maxime AMANKOU | ✅ | ✅ | … | 100% | 2 | 2 |
| Blandine LIDA | ✅ | ✖️ | … | 50% | 1 | 2 |
| ▫️ Non inscrits | | | | | | |
| Kelly NKATIAH | - | - | … | N/A | - | - |

Cette feuille est directement utilisable pour créer des graphiques Google
Sheets (histogrammes, courbes de tendance, etc.).

---

## Avoiding Cold Starts

Le `cloudbuild.yaml` déploie Cloud Run avec `--min-instances=1`, ce qui
maintient un conteneur chaud en permanence et élimine les cold starts pour
le webhook.

Optimisations supplémentaires déjà en place :

- **Multi-stage Dockerfile** — image runtime légère (~120 MB) démarre plus vite.
- **Module-level singletons** — le client gspread et le modèle Gemini sont
  initialisés une seule fois par instance, pas par requête.
- **Layer caching** — `--cache-from` dans l'étape Docker build accélère le CI.
- **Staged rollout** — `--no-traffic` + `update-traffic` garantit que la
  nouvelle révision est saine avant de recevoir du vrai trafic.

---

## Troubleshooting

**Bot not responding after deploy**
```bash
gcloud run services logs read attendance-bot --region=us-central1 --limit=50
```

**Sheets API quota error**
Le `sheets_service` réessaie jusqu'à 5 fois avec back-off exponentiel. En
cas de 429 persistants, demandez une augmentation de quota dans la console
GCP : *APIs & Services → Google Sheets API → Quotas*.

**Webhook not registered**
Vérifiez que `WEBHOOK_URL` est correctement défini dans Secret Manager et
redéployez. Pour vérifier :
```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

**Feuille pivot vide après /newlesson**
Vérifiez que la ligne `📝Titre de la leçon :` et la ligne `🔰Classe Ouverte`
sont bien présentes dans le bloc collé — ce sont les deux champs obligatoires.


---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Structure](#project-structure)
3. [Prerequisites](#prerequisites)
4. [Google Sheets Setup](#google-sheets-setup)
5. [Local Development](#local-development)
6. [GCP Setup](#gcp-setup)
7. [CI/CD – Cloud Build + GitHub](#cicd--cloud-build--github)
8. [Secrets Management](#secrets-management)
9. [Environment Variables Reference](#environment-variables-reference)
10. [Bot Commands & Usage](#bot-commands--usage)
11. [Avoiding Cold Starts](#avoiding-cold-starts)

---

## Architecture Overview

```
User → Telegram → HTTPS Webhook
                        ↓
              Google Cloud Run (bot.py)
              ┌────────────────────────────┐
              │  python-telegram-bot 21    │
              │  ┌──────────┐  ┌────────┐ │
              │  │ Commands │  │  NLP   │ │
              │  └──────────┘  │ Gemini │ │
              │       ↓        └────────┘ │
              │  AttendanceService         │
              │       ↓                   │
              │  SheetsService (gspread)  │
              └────────────────────────────┘
                        ↓
              Google Sheets (data store)
```

CI/CD flow:

```
GitHub push (main branch)
        ↓
Cloud Build trigger
        ↓
docker build  →  Artifact Registry  →  Cloud Run deploy
```

---

## Project Structure

```
attendance_bot/
├── bot.py                  # Entry point & handler registration
├── config.py               # Environment variable loader
├── gemini_parser.py        # Gemini AI natural-language parser
├── sheets_service.py       # Google Sheets CRUD (with retries)
├── attendance_service.py   # Business logic & validation
│
├── commands/
│   ├── add.py
│   ├── remove.py
│   ├── list_attendance.py
│   ├── events.py
│   └── categories.py
│
├── utils/
│   ├── parser.py           # Fallback /command argument parser
│   └── formatters.py       # Telegram Markdown message builders
│
├── Dockerfile
├── cloudbuild.yaml
├── requirements.txt
├── .env.example
└── README.md
```

---

## Prerequisites

| Tool | Version |
|------|---------|
| Python | 3.11+ |
| Docker | 24+ |
| gcloud CLI | latest |
| A Telegram Bot Token | from [@BotFather](https://t.me/BotFather) |
| A Google Cloud project | with billing enabled |
| A Gemini API key | from [Google AI Studio](https://aistudio.google.com) |

---

## Google Sheets Setup

### 1. Create the spreadsheet

Create a Google Sheets file with three tabs named exactly:

- `EVENTS`
- `CATEGORIES`
- `ATTENDANCE`

### 2. Add header rows

**EVENTS**
```
event_id | event_name | date | description
```

**CATEGORIES**
```
category_id | category_name
```

**ATTENDANCE**
```
event_name | participant_name | category | timestamp
```

### 3. Populate initial data

Example EVENTS rows:
```
1 | Leadership Meeting  | 2026-03-14 | Weekly leadership meeting
2 | Evangelism Training | 2026-03-21 | Training session
```

Example CATEGORIES rows:
```
1 | Staff
2 | Guest
3 | Member
4 | Pastor
```

### 4. Share the sheet with the service account

Once you create a Service Account (see GCP Setup), share the spreadsheet
with the service account email (`...@....iam.gserviceaccount.com`) as
**Editor**.

---

## Local Development

```bash
# 1. Clone the repo
git clone https://github.com/your-org/attendance_bot.git
cd attendance_bot

# 2. Create virtual environment
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure environment
cp .env.example .env
# Edit .env with your real values

# 5. Run in long-polling mode (no webhook needed locally)
python bot.py
```

> When `WEBHOOK_URL` is empty the bot switches to **long-polling** mode
> automatically, which is perfect for local development.

---

## GCP Setup

### Step 1 – Create a GCP project and enable APIs

```bash
export PROJECT_ID=my-gcp-project
export REGION=us-central1

gcloud projects create $PROJECT_ID
gcloud config set project $PROJECT_ID

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com
```

### Step 2 – Create Artifact Registry repository

```bash
gcloud artifacts repositories create attendance-bot \
  --repository-format=docker \
  --location=$REGION \
  --description="Attendance Bot Docker images"
```

### Step 3 – Create a Service Account for Google Sheets

```bash
gcloud iam service-accounts create attendance-sheets-sa \
  --display-name="Attendance Bot Sheets SA"

# Download the JSON key
gcloud iam service-accounts keys create service-account.json \
  --iam-account=attendance-sheets-sa@$PROJECT_ID.iam.gserviceaccount.com
```

**Share the Google Sheet** with the email printed by:
```bash
cat service-account.json | python -c "import sys,json; print(json.load(sys.stdin)['client_email'])"
```

### Step 4 – Grant Cloud Build permissions

```bash
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
CB_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/iam.serviceAccountUser"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/artifactregistry.writer"
```

---

## Secrets Management

Store every secret in Secret Manager (never in code or `.env` in production):

```bash
# Helper function
create_secret() {
  gcloud secrets create "$1" --replication-policy=automatic
  echo -n "$2" | gcloud secrets versions add "$1" --data-file=-
}

create_secret TELEGRAM_BOT_TOKEN      "123456789:ABCDEF..."
create_secret GEMINI_API_KEY          "AIzaXXXXXXX..."
create_secret GOOGLE_SHEET_ID         "1BxiMV..."
create_secret WEBHOOK_URL             "https://attendance-bot-xxxx-uc.a.run.app"

# Service account JSON (single line)
SA_JSON=$(cat service-account.json | tr -d '\n')
create_secret GOOGLE_SERVICE_ACCOUNT_JSON "$SA_JSON"
```

> Cloud Build injects these into Cloud Run via `--set-secrets` in
> `cloudbuild.yaml` – they appear as environment variables inside the
> container.

### Getting the WEBHOOK_URL

Deploy the service once with a placeholder URL to get the auto-generated URL:

```bash
gcloud run deploy attendance-bot \
  --image=gcr.io/cloudrun/placeholder \
  --region=$REGION \
  --allow-unauthenticated

# Get the URL
gcloud run services describe attendance-bot \
  --region=$REGION \
  --format='value(status.url)'
```

Then update the secret with the real URL and redeploy via Cloud Build.

---

## CI/CD – Cloud Build + GitHub

### 1. Connect GitHub repository

In the GCP Console → Cloud Build → Triggers → **Connect Repository** →
select GitHub → authorise → choose your repo.

### 2. Create the trigger

```bash
gcloud builds triggers create github \
  --repo-name=attendance_bot \
  --repo-owner=your-github-org \
  --branch-pattern="^main$" \
  --build-config=cloudbuild.yaml \
  --substitutions=_PROJECT_ID=$PROJECT_ID,_REGION=$REGION,_SERVICE=attendance-bot,_REGISTRY=$REGION-docker.pkg.dev/$PROJECT_ID/attendance-bot
```

### 3. Push to deploy

```bash
git add .
git commit -m "feat: deploy attendance bot"
git push origin main
```

Cloud Build will automatically:
1. Build the Docker image with layer caching
2. Push `:SHORT_SHA` and `:latest` tags to Artifact Registry
3. Deploy the new revision to Cloud Run with staged traffic migration

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | ✅ | Token from @BotFather |
| `GEMINI_API_KEY` | ✅ | Gemini API key from AI Studio |
| `GOOGLE_SHEET_ID` | ✅ | The long ID in the Google Sheets URL |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | ✅ | Service account key JSON (single-line string) |
| `WEBHOOK_URL` | ✅ prod | Public HTTPS URL of the Cloud Run service |
| `PORT` | auto | Injected by Cloud Run (default: 8080) |
| `GEMINI_MODEL` | ❌ | Gemini model name (default: `gemini-1.5-flash`) |

---

## Bot Commands & Usage

### Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/help` | Show all commands |
| `/add <event> <name1> [name2...] category <cat>` | Add participants |
| `/remove <event> <name>` | Remove a participant |
| `/list <event>` | Show attendance grouped by category |
| `/events` | List all events |
| `/categories` | List all categories |

### Natural language examples

```
Add John and Maria to Leadership Meeting as Staff
Please add David to Evangelism Training
List Leadership Meeting
Remove Paul from Leadership Meeting
Show me all events
What categories are available?
```

### Example output — /list

```
📋 Attendance – Leadership Meeting

Staff
  • John
  • Maria

Members
  • Paul

Guests
  • Anna
```

### Example output — /add confirmation

```
✅ Participants added

Event: Leadership Meeting
Category: Staff

Participants:
  • John
  • Maria
```

---

## Avoiding Cold Starts

The `cloudbuild.yaml` deploys Cloud Run with `--min-instances=1`, which keeps
one container warm at all times and eliminates cold starts for the webhook.

Additional optimisations already in place:

- **Multi-stage Dockerfile** – slim runtime image (~120 MB) starts faster.
- **Module-level singletons** – the gspread client and Gemini model are
  initialised once per container instance, not per request.
- **Layer caching** – `--cache-from` in the Docker build step speeds up CI.
- **Staged rollout** – `--no-traffic` + `update-traffic` means the new
  revision is healthy before receiving real traffic.


---

## Troubleshooting

**Bot not responding after deploy**
```bash
# Check Cloud Run logs
gcloud run services logs read attendance-bot --region=us-central1 --limit=50
```

**Sheets API quota error**  
The sheets_service retries up to 5 times with exponential back-off. If you
see persistent 429 errors, request a quota increase in the GCP console under
*APIs & Services → Google Sheets API → Quotas*.

**Webhook not registered**  
Set `WEBHOOK_URL` correctly in Secret Manager and redeploy. You can verify:
```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

CI trigger test 2026-04-20
