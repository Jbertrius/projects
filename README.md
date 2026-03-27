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

Les variables applicatives comme `GOOGLE_SPREADSHEET_ID`, `GOOGLE_CLIENT_EMAIL` et `GOOGLE_PRIVATE_KEY` ne doivent pas être mises dans GitHub.

Elles doivent être configurées côté Cloud Run:

```bash
gcloud run services update member-evolution-dashboard \
  --region=europe-west9 \
  --set-env-vars GOOGLE_SPREADSHEET_ID=... \
  --set-env-vars GOOGLE_CLIENT_EMAIL=... \
  --set-env-vars GOOGLE_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n'
```

Ou mieux encore:

- `GOOGLE_SPREADSHEET_ID` en variable d'environnement;
- le compte de service Cloud Run attaché au service pour lire Sheets;
- éventuellement `Secret Manager` si tu veux externaliser certains secrets.

### Pré-requis GCP

- activer `Cloud Run`
- activer `Artifact Registry`
- activer `IAM Credentials API`
- créer un service account pour le déploiement GitHub
- autoriser GitHub via Workload Identity Federation
- donner au service account les rôles nécessaires sur Cloud Run et Artifact Registry

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
