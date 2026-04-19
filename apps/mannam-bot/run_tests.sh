#!/usr/bin/env bash
# run_tests.sh — Lance pytest dans l'environnement WSL
# Depuis PowerShell :
#   wsl bash run_tests.sh
# Depuis un terminal WSL :
#   bash run_tests.sh
#
# Options pytest passables en argument :
#   wsl bash run_tests.sh -v -k "TestParseEventDetails"

set -e

VENV_DIR=".venv-wsl"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

cd "$PROJECT_DIR"

# Vérification que le venv WSL existe
if [ ! -f "$VENV_DIR/bin/pytest" ]; then
    echo "[ERREUR] Venv WSL introuvable. Lancez d'abord :"
    echo "  wsl bash setup_wsl.sh"
    exit 1
fi

echo "──────────────────────────────────────────"
echo " Tests WSL — mannam_bot"
echo " Python : $($VENV_DIR/bin/python --version)"
echo "──────────────────────────────────────────"

"$VENV_DIR/bin/pytest" tests/ "$@"
