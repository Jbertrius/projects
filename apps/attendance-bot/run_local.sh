#!/usr/bin/env bash
# Lance le bot en mode polling (pas de webhook public requis).
# Usage : depuis la racine du repo → bash apps/attendance-bot/run_local.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SHARED_PY="$REPO_ROOT/shared/python"

cd "$SCRIPT_DIR"

if [ ! -f ".env" ]; then
  echo "❌  Fichier .env manquant."
  echo "   Copie .env.example en .env et remplis les variables."
  exit 1
fi

export PYTHONPATH="$SHARED_PY:$PYTHONPATH"

echo "▶  Démarrage du bot (polling)…"
echo "   PYTHONPATH inclut : $SHARED_PY"
python bot.py
