# Build context = repo root  →  docker build -f apps/attendance-bot/Dockerfile .

# ── Stage 1: dependency builder ───────────────────────────────────────────────
FROM python:3.11-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /build

RUN pip install --upgrade pip

COPY apps/attendance-bot/requirements.txt .
RUN pip install --prefix=/install --no-cache-dir -r requirements.txt


# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

COPY --from=builder /install /usr/local

COPY apps/attendance-bot/bot.py               ./bot.py
COPY apps/attendance-bot/attendance_service.py ./attendance_service.py
COPY apps/attendance-bot/config.py            ./config.py
COPY apps/attendance-bot/gemini_parser.py     ./gemini_parser.py
COPY apps/attendance-bot/commands/            ./commands/
COPY apps/attendance-bot/utils/               ./utils/
COPY shared/python/api_client.py              ./api_client.py

RUN addgroup --system appgroup && \
    adduser --system --ingroup appgroup appuser && \
    chown -R appuser:appgroup /app

USER appuser

EXPOSE ${PORT}

CMD ["python", "bot.py"]
