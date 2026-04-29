# Build context = repo root  →  docker build -f apps/mannam-bot/Dockerfile .

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY apps/mannam-bot/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/mannam-bot/main.py        ./main.py
COPY apps/mannam-bot/bot_core.py    ./bot_core.py
COPY shared/python/api_client.py    ./api_client.py

EXPOSE 8080

CMD ["python", "main.py"]
