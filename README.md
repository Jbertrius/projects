# Evolution des membres

Premier MVP d'une application web de pilotage pour:

- suivre les rencontres déclarées par les membres;
- identifier les membres actifs, inactifs ou à relancer;
- suivre les inscriptions et la progression à une formation;
- préparer une architecture peu coûteuse pour un déploiement sur Google Cloud Run.

## Lancer le projet

```bash
node server.js
```

L'application sera disponible sur `http://localhost:8080`.

## Variables d'environnement Google Sheets

Pour brancher la vraie donnée Google Sheets, configure:

```bash
GOOGLE_SPREADSHEET_ID=...
GOOGLE_CLIENT_EMAIL=service-account@project-id.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_MEMBERS_RANGE=members!A1:Z
GOOGLE_SHEET_MEETINGS_RANGE=meetings!A1:Z
GOOGLE_SHEET_TRAINING_RANGE=training!A1:Z
```

Le service account doit avoir accès en lecture au spreadsheet.

Le projet charge automatiquement `.env` et `.env.local` au démarrage. Pour un test local simple, crée un fichier `.env.local` à la racine du projet.

## Test local avec vraies données Google Sheets

### 1. Créer un service account GCP

Dans Google Cloud:

- va dans `IAM & Admin > Service Accounts`
- crée un compte de service
- génère une clé JSON
- récupère:
  - `client_email`
  - `private_key`

### 2. Partager le Google Sheet avec le service account

Ouvre ton spreadsheet et partage-le en lecture avec l'adresse email du service account, par exemple:

```text
my-service-account@my-project.iam.gserviceaccount.com
```

### 3. Créer `.env.local`

Exemple:

```bash
PORT=8080
GOOGLE_SPREADSHEET_ID=ton_spreadsheet_id
GOOGLE_SERVICE_ACCOUNT_JSON_PATH=C:\\path\\to\\service-account.json
GOOGLE_SHEET_MEMBERS_RANGE=members!A1:Z
GOOGLE_SHEET_MEETINGS_RANGE=meetings!A1:Z
GOOGLE_SHEET_TRAINING_RANGE=
```

C'est la methode recommandee en local.

Alternative possible si tu veux tout mettre en variables:

```bash
GOOGLE_CLIENT_EMAIL=service-account@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=\"-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n\"
```

Mais cette methode est plus fragile, surtout sur Windows, a cause du format de la cle privee.

`GOOGLE_SHEET_TRAINING_RANGE` est optionnel. Si ton onglet formation n'existe pas encore, laisse cette variable vide.

### 4. Lancer l'application

```bash
node server.js
```

### Initialiser automatiquement le spreadsheet vide

Si ton Google Sheet est vide, tu peux creer la structure attendue avec:

```bash
npm run setup:sheets
```

Le script cree ou verifie les onglets:

- `members`
- `meetings`
- `training`

Et il pose les en-tetes attendus par l'application.

### 5. Vérifier la connexion

Dans le navigateur:

- [http://localhost:8080/api/connection-status](http://localhost:8080/api/connection-status)
- [http://localhost:8080/api/test/google-sheets](http://localhost:8080/api/test/google-sheets)
- [http://localhost:8080/api/test/google-calendar](http://localhost:8080/api/test/google-calendar)

Le premier endpoint te dit si la config est présente.
Le second teste réellement l'accès au Google Sheet et te retourne un échantillon de données.
Le troisième teste l'accès au Google Calendar configuré.

## Synchroniser Google Calendar vers Google Sheets

Pour ton process actuel, on peut garder le bot sur Google Calendar puis synchroniser les événements vers l'onglet `meetings`.

Configuration locale:

```bash
GOOGLE_CALENDAR_ID=primary
GOOGLE_CALENDAR_PAST_DAYS=180
GOOGLE_CALENDAR_FUTURE_DAYS=30
```

Test du calendrier:

```bash
http://localhost:8080/api/test/google-calendar
```

Synchronisation:

```bash
npm run sync:calendar
```

Ou via l'API:

```bash
http://localhost:8080/api/sync/calendar-to-sheets
```

Le synchroniseur:

- lit les événements du calendrier;
- convertit les événements en lignes `meetings`;
- fusionne avec les lignes déjà présentes;
- évite les doublons par `event.id`.

## Rattachement automatique aux members

La synchronisation enrichit aussi les lignes `meetings` avec:

- `member_name_raw`: valeur brute venant du Calendar
- `member_ids`: ids membres résolus
- `member_names_canonical`: noms canoniques issus de `members`
- `member_match_status`: `exact`, `fuzzy`, `partial` ou `unmatched`
- `member_unmatched_names`: morceaux non reconnus

Pour aider le matching, tu peux ajouter dans la feuille `members` une colonne `aliases`, avec des variantes séparées par `;`.

Exemple:

```text
Stephane;Stéphane;Stephèn
```

## Preparation Sheets -> Firestore

Une premiere couche est prête pour la phase 2:

```bash
npm run sync:firestore
```

Variables à prévoir quand tu activeras Firestore:

```bash
FIRESTORE_PROJECT_ID=ton-project-id
FIRESTORE_DATABASE_ID=(default)
```

Le script synchronisera les collections:

- `members`
- `meetings`
- `trainingSessions`

## Rapport de matching members

Pour voir quels noms n'ont pas été rattachés automatiquement:

```bash
npm run report:matching
```

Ce rapport aide à compléter la colonne `aliases` dans `members`.

### Format attendu des onglets

`members`

- `id`
- `name`
- `zone`
- `department_role`
- `status`

`meetings`

- `id`
- `member_id`
- `member_name`
- `pastor_name`
- `meeting_date`
- `month`
- `zone`
- `calendar_logged`

`training`

- `id`
- `member_id`
- `member_name`
- `cohort`
- `week`
- `attendance`
- `completed`
- `completion_score`
- `enrolled`

## Déploiement Cloud Run

Construire puis déployer:

```bash
gcloud run deploy member-evolution-dashboard --source .
```

## CI/CD GitHub -> Cloud Run

Le workflow GitHub Actions est dans [.github/workflows/deploy-cloud-run.yml](C:\Applications\projects\.github\workflows\deploy-cloud-run.yml).

Il déploie automatiquement sur Cloud Run à chaque `push` sur `main` ou `master`.

### Variables GitHub à définir

Dans `Settings > Secrets and variables > Actions`, ajoute:

Variables de repository:

- `GCP_PROJECT_ID`
- `GCP_REGION`
- `CLOUD_RUN_SERVICE`
- `CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT`
- `GOOGLE_SPREADSHEET_ID`
- `GOOGLE_SHEET_MEMBERS_RANGE`
- `GOOGLE_SHEET_MEETINGS_RANGE`
- `GOOGLE_SHEET_TRAINING_RANGE`
- `GOOGLE_CALENDAR_ID`
- `GOOGLE_CALENDAR_PAST_DAYS`
- `GOOGLE_CALENDAR_FUTURE_DAYS`
- `FIRESTORE_PROJECT_ID`
- `FIRESTORE_DATABASE_ID`

Secrets de repository:

- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT_EMAIL`

### Recommandation d'authentification

Je recommande `Workload Identity Federation` entre GitHub et GCP, pas une clé JSON statique. C'est plus propre et plus sûr pour le déploiement CI/CD.

### Ce que fait le pipeline

1. checkout du repo;
2. authentification à Google Cloud;
3. build Docker de l'application;
4. push de l'image dans Artifact Registry;
5. déploiement de l'image sur Cloud Run.

### Variables runtime Cloud Run

Le workflow est prêt pour une approche plus propre:

- variables runtime injectées au déploiement;
- compte de service Cloud Run attaché au service;
- plus besoin de fichier JSON local sur Cloud Run si le compte de service a accès à Sheets, Calendar et Firestore.

### Pré-requis GCP

- activer `Cloud Run`
- activer `Artifact Registry`
- activer `IAM Credentials API`
- activer `Firestore API`
- créer la base Firestore si elle n'existe pas encore
- créer un service account pour le déploiement GitHub
- autoriser GitHub via Workload Identity Federation
- donner au service account les rôles nécessaires sur Cloud Run et Artifact Registry
- partager le Google Sheet et le Google Calendar avec le service account runtime Cloud Run

### Initialiser le remote GitHub

Exemple:

```bash
git remote add origin https://github.com/<owner>/<repo>.git
git add .
git commit -m "Initial dashboard MVP with Cloud Run CI/CD"
git branch -M main
git push -u origin main
```

## Architecture recommandée

### Phase 1: la moins chère possible

- `Cloud Run` pour héberger l'application web.
- `Google Sheets` comme source de vérité temporaire.
- `Telegram Bot` continue à recevoir les déclarations.
- `Google Calendar` reste alimenté pour les rendez-vous.
- Le backend de l'application lit les données via `Google Sheets API` et les consolide dans un format dashboard.

Pourquoi cette phase:

- presque aucun coût fixe;
- tu gardes tes flux existants;
- tu centralises enfin l'affichage, le pilotage et les graphiques.

### Phase 2: sortir progressivement de Google Sheets

Quand le volume augmente ou si tu veux une vraie application autonome:

- `Firestore` pour stocker membres, rencontres, formations et journaux d'activité;
- `Cloud Run` garde l'API et le frontend;
- un job planifié peut synchroniser Telegram, Calendar et éventuellement Sheets pendant la transition.

Pourquoi `Firestore`:

- offre gratuite intéressante pour un petit volume;
- très simple à intégrer avec Cloud Run;
- pas besoin de gérer un serveur SQL.

## Structure

- `server.js`: serveur HTTP minimal compatible Cloud Run.
- `public/`: interface utilisateur.
- `data/dashboard.json`: données d'exemple pour le MVP visuel.

## Prochaines étapes utiles

1. Connecter `Google Sheets API` à la place du fichier JSON.
2. Définir les entités métier: membres, rencontres, pasteurs, sessions de formation, présences.
3. Ajouter l'authentification Google.
4. Construire les écrans de détail par membre et par pasteur.
