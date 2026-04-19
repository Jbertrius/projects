#!/usr/bin/env bash
# setup_wsl.sh — Installation initiale de l'environnement Python dans WSL
# À lancer UNE SEULE FOIS depuis PowerShell :
#   wsl bash setup_wsl.sh
# Ou depuis un terminal WSL (dans le répertoire du projet) :
#   bash setup_wsl.sh

set -e  # Arrêt immédiat en cas d'erreur

VENV_DIR=".venv-wsl"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "──────────────────────────────────────────"
echo " Setup WSL — mannam_bot"
echo " Répertoire : $PROJECT_DIR"
echo "──────────────────────────────────────────"

cd "$PROJECT_DIR"

# 1. Créer le venv WSL (séparé du .venv Windows)
if [ -d "$VENV_DIR" ]; then
    echo "[INFO] $VENV_DIR existe déjà, skip création."
else
    echo "[INFO] Création du venv WSL..."
    python3 -m venv "$VENV_DIR"
    echo "[OK] Venv créé dans $VENV_DIR"
fi

# 2. Installer les dépendances
echo "[INFO] Installation des dépendances..."
"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet -r requirements.txt
"$VENV_DIR/bin/pip" install --quiet pytest python-dotenv

echo ""
echo "[OK] Setup terminé."
echo ""
echo "Lancer les tests avec :"
echo "  wsl bash run_tests.sh"
echo "  — ou depuis WSL : bash run_tests.sh"
