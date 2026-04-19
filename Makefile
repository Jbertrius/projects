.PHONY: dev build-web build-attendance build-mannam test-web test-bots sync-shared

# ── Local dev ──────────────────────────────────────────────────────────────────

dev:
	docker compose up --build

dev-web:
	npm run dev

dev-attendance:
	cd apps/attendance-bot && python bot.py

dev-mannam:
	cd apps/mannam-bot && python main_dev.py

# ── Build (mirrors Cloud Build steps) ─────────────────────────────────────────

build-web:
	docker build -t member-evolution-dashboard:local .

build-attendance:
	docker build -f apps/attendance-bot/Dockerfile -t attendance-bot:local .

build-mannam:
	docker build -f apps/mannam-bot/Dockerfile -t mannam-bot:local .

# ── Tests ──────────────────────────────────────────────────────────────────────

test-web:
	npm test

test-bots:
	cd apps/mannam-bot && bash run_tests.sh

# ── Shared code sync (for local dev without Docker) ───────────────────────────
# Copies shared/python/api_client.py into each bot dir so imports work locally.

sync-shared:
	cp shared/python/api_client.py apps/attendance-bot/api_client.py
	cp shared/python/api_client.py apps/mannam-bot/api_client.py
	@echo "shared/python/api_client.py synced to both bots"
