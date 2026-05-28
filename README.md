# Member Evolution Dashboard

Dashboard web de pilotage pour suivre l'activité des membres, leurs rencontres avec les pasteurs et leur progression en formation. Complété par deux bots Telegram qui collectent les données.

---

## Vue d'ensemble

Ce dépôt contient **trois services indépendants** déployés séparément sur Google Cloud Run :

| Service | Dossier | Langage | Rôle |
|---|---|---|---|
| **Dashboard** | `/` (racine) | Node.js / Express | API REST + interface web |
| **Attendance Bot** | `apps/attendance-bot/` | Python | Bot Telegram gestion présences & formation |
| **Mannam Bot** | `apps/mannam-bot/` | Python | Bot Telegram suivi des mannams (visites pastorales) |

### Flux de données

```
Telegram
   ↓
Attendance Bot / Mannam Bot (Python)
   ↓ HTTP (/api/bot/*)
Dashboard API (Node.js / Express)
   ↓
Firestore (source de vérité principale)
   ↑
Google Sheets / Calendar (import historique & sync)
```

---

## Architecture du dashboard (racine)

```
server.js          — point d'entrée, démarre Express + jobs planifiés
src/
  app.js           — montage des middlewares et des routes
  config/          — validation des variables d'environnement au démarrage
  routes/          — endpoints REST (auth, users, dashboard, pastors, academy, meetings, bot, admin)
  repositories/    — accès Firestore (membres, rencontres, formation…)
  jobs/            — tâches de fond (résolution membres ↔ rencontres, lien pasteurs ↔ étudiants)
  middleware/      — auth session, API key, CSRF, logger, headers sécurité
  utils/           — fonctions partagées
lib/               — clients Google (Firestore, Sheets, Calendar, Gemini, Auth)
public/            — interface web statique (HTML/JS/CSS)
scripts/           — scripts d'import, de sync et de maintenance Firestore
tests/             — tests unitaires Node.js
```

### Routes API principales

| Préfixe | Rôle |
|---|---|
| `GET /health` | Health check (Cloud Run) |
| `/api/auth` | Connexion / déconnexion session |
| `/api/users` | Gestion des utilisateurs (admin/gérant) |
| `/api/dashboard` | Agrégats pour le dashboard |
| `/api/pastors` | Données pasteurs |
| `/api/academy` | Formation (classes, étudiants, leçons) |
| `/api/meetings` | Rencontres |
| `/api/bot/*` | Point d'entrée pour les bots Telegram |

### Rôles utilisateurs

| Rôle | Droits |
|---|---|
| `admin` | Gère les rôles et tous les accès |
| `gerant` | Ajoute ou retire des accès membres |
| `membre` | Consulte l'application |

---

## Prérequis

- **Node.js** ≥ 20
- Un projet **Google Cloud** avec Firestore activé
- Un **service account** GCP avec accès Firestore (et optionnellement Sheets / Calendar)

---

## Installation locale

```bash
# Cloner le dépôt
git clone <url>
cd projects

# Installer les dépendances Node
npm install

# Copier et remplir les variables d'environnement
cp .env.example .env.local
```

Édite `.env.local` avec au minimum :

```dotenv
PORT=8080

# Session
APP_SESSION_SECRET=une-chaine-aleatoire-longue

# Premier compte admin (créé automatiquement si Firestore est vide)
APP_INITIAL_ADMIN_EMAIL=admin@example.com
APP_INITIAL_ADMIN_PASSWORD=motdepassefort
APP_INITIAL_ADMIN_NAME=Administrateur

# Firestore (requis pour l'auth et les données live)
FIRESTORE_PROJECT_ID=ton-project-id
FIRESTORE_DATABASE_ID=(default)

# Service account GCP (méthode recommandée en local)
GOOGLE_SERVICE_ACCOUNT_JSON_PATH=C:\\chemin\\vers\\service-account.json

# Google Sheets (optionnel, pour les imports historiques)
GOOGLE_SPREADSHEET_ID=ton-spreadsheet-id
GOOGLE_SHEET_MEMBERS_RANGE=members!A1:Z
GOOGLE_SHEET_MEETINGS_RANGE=meetings!A1:Z

# Google Calendar (optionnel)
GOOGLE_CALENDAR_ID=primary
GOOGLE_CALENDAR_PAST_DAYS=180
GOOGLE_CALENDAR_FUTURE_DAYS=30
```

> Voir `.env.example` pour la liste complète des variables.

### Créer le service account GCP

1. Dans Google Cloud : `IAM & Admin > Service Accounts`
2. Crée un compte de service, génère une clé JSON
3. Accorde-lui les rôles `Cloud Datastore User` (Firestore) et éventuellement `Viewer` sur le Spreadsheet

---

## Lancer en local

```bash
npm start
# ou
node server.js
```

L'application démarre sur `http://localhost:8080`.

> Le projet charge automatiquement `.env` puis `.env.local` au démarrage. Mets tes overrides locaux dans `.env.local`.

Au premier démarrage avec Firestore vide, le compte admin initial est créé automatiquement à partir des variables `APP_INITIAL_ADMIN_*`.

---

## Scripts disponibles

| Commande | Description |
|---|---|
| `npm start` | Démarre le serveur |
| `npm test` | Lance les tests unitaires Node.js |
| `npm run setup:sheets` | Crée/vérifie la structure du Google Sheet (onglets + en-têtes) |
| `npm run sync:calendar` | Synchronise Google Calendar → Google Sheets |
| `npm run sync:firestore` | Synchronise Google Sheets → Firestore |
| `npm run sync:academy` | Synchronise la feuille académie → Firestore |
| `npm run db:check` | Vérifie le schéma Firestore |
| `npm run db:fix` | Corrige les incohérences de schéma Firestore |

### Jobs de fond (automatiques au démarrage)

Deux jobs tournent toutes les 8 heures si Firestore est configuré :
- **resolve-meeting-members** : associe les rencontres aux membres correspondants
- **link-pastors-to-students** : lie les pasteurs à leurs étudiants

---

## Tests

```bash
npm test
```

Les tests se trouvent dans `tests/`. Ils utilisent le runner natif Node.js (`node --test`).

---

## Collections Firestore

| Collection | Contenu |
|---|---|
| `members` | Membres (nom, zone, rôle, statut, aliases) |
| `meetings` | Rencontres (membre, pasteur, date, source) |
| `academyLessons` | Leçons de formation |
| `academyStudents` | Étudiants inscrits en formation |
| `users` | Comptes utilisateurs de l'application |

---

## Bots Telegram

Chaque bot a son propre README détaillé :

- **Attendance Bot** (`apps/attendance-bot/README.md`) — présences aux événements et suivi de formation, écrit via `/api/bot/`
- **Mannam Bot** (`apps/mannam-bot/README.md`) — suivi des visites pastorales (mannams), utilise Google Calendar + Gemini AI

Les bots communiquent avec le dashboard via des clés API :

```dotenv
# Sur les bots et sur le dashboard (même valeur)
BOT_API_KEY_ATTENDANCE=<openssl rand -hex 32>
BOT_API_KEY_MANNAM=<openssl rand -hex 32>
API_BASE_URL=https://ton-dashboard.run.app
```

> ⚠️ Migration en cours : les bots passent progressivement de l'écriture directe Firestore à l'appel de `/api/bot/*`. Voir `docs/bot-migration.md`.

---

## Déploiement Cloud Run

```bash
gcloud run deploy member-evolution-dashboard --source .
```

### CI/CD automatique (GitHub Actions)

Le pipeline `.github/workflows/deploy-cloud-run.yml` déploie automatiquement sur Cloud Run à chaque push sur `main`.

**Variables GitHub à définir** (`Settings > Secrets and variables > Actions`) :

| Type | Nom |
|---|---|
| Variable | `GCP_PROJECT_ID`, `GCP_REGION`, `CLOUD_RUN_SERVICE`, `CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT`, `FIRESTORE_PROJECT_ID`, `FIRESTORE_DATABASE_ID` |
| Secret | `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT_EMAIL` |

L'authentification utilise **Workload Identity Federation** (pas de clé JSON statique).

**Pré-requis GCP :**
- Activer Cloud Run, Artifact Registry, IAM Credentials API, Firestore API
- Créer un service account pour le déploiement GitHub avec les rôles Cloud Run et Artifact Registry
- Autoriser GitHub via Workload Identity Federation

---

## Documentation complémentaire

| Fichier | Contenu |
|---|---|
| `docs/architecture.md` | Proposition d'architecture initiale |
| `docs/data-architecture.md` | Choix et évolution du modèle de données |
| `docs/bot-migration.md` | Guide de migration des bots vers l'API centrale |
| `docs/roadmap.md` | État actuel, prochaines étapes, risques |
| `docs/openapi.yaml` | Contrat d'API REST |
| `.env.example` | Référence complète des variables d'environnement |
