# ── Python backend ───────────────────────────────────────────
FROM python:3.11-slim AS backend

WORKDIR /app

# System deps for asyncpg, torch, sentence-transformers
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ app/
COPY main.py .
COPY schema_v6.sql .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
