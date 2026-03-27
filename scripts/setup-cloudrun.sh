#!/usr/bin/env bash
# One-time setup for deploying member-evolution-dashboard to Cloud Run.
# Run this from the project root using WSL or any bash shell.
# Prerequisites: gcloud CLI authenticated, Docker installed.

set -euo pipefail

PROJECT_ID="cedar-freedom-138023"
REGION="us-central1"
SERVICE="member-evolution-dashboard"
AR_REPO="cloud-run-apps"

echo "==> Setting active project..."
gcloud config set project "$PROJECT_ID"

echo "==> Enabling required APIs..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com

echo "==> Creating Artifact Registry repository (if not exists)..."
gcloud artifacts repositories create "$AR_REPO" \
  --repository-format=docker \
  --location="$REGION" \
  --description="Cloud Run container images" 2>/dev/null || echo "Repository already exists, skipping."

echo "==> Creating Secret Manager secrets..."
echo "    You will be prompted to paste the value for each secret."

echo ""
echo "--- GOOGLE_SERVICE_ACCOUNT_JSON ---"
echo "Paste the full contents of service-account.json below, then press Ctrl+D:"
gcloud secrets create GOOGLE_SERVICE_ACCOUNT_JSON --data-file=- 2>/dev/null \
  || { echo "Secret exists. Adding new version..."; gcloud secrets versions add GOOGLE_SERVICE_ACCOUNT_JSON --data-file=-; }

echo ""
echo "--- GEMINI_API_KEY ---"
read -rsp "Paste your Gemini API key and press Enter: " GEMINI_KEY
echo ""
printf '%s' "$GEMINI_KEY" | gcloud secrets create GEMINI_API_KEY --data-file=- 2>/dev/null \
  || { printf '%s' "$GEMINI_KEY" | gcloud secrets versions add GEMINI_API_KEY --data-file=-; }

echo ""
echo "==> Granting Cloud Build service account access to secrets..."
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
CLOUDBUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
CLOUDRUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for SA in "$CLOUDBUILD_SA" "$CLOUDRUN_SA"; do
  gcloud secrets add-iam-policy-binding GOOGLE_SERVICE_ACCOUNT_JSON \
    --member="serviceAccount:${SA}" \
    --role="roles/secretmanager.secretAccessor"
  gcloud secrets add-iam-policy-binding GEMINI_API_KEY \
    --member="serviceAccount:${SA}" \
    --role="roles/secretmanager.secretAccessor"
done

echo "==> Granting Cloud Build permission to deploy to Cloud Run..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${CLOUDBUILD_SA}" \
  --role="roles/run.admin"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${CLOUDBUILD_SA}" \
  --role="roles/iam.serviceAccountUser"

echo ""
echo "==> Running first build and deploy via Cloud Build..."
gcloud builds submit --config cloudbuild.yaml .

echo ""
echo "==> Deployment complete!"
gcloud run services describe "$SERVICE" \
  --region="$REGION" \
  --format="value(status.url)"
