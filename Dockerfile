# ── Stage 1: build React frontend ────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /project
# Copy only package files first for better layer caching
COPY frontend/package*.json frontend/
WORKDIR /project/frontend
RUN npm ci
COPY frontend/ .
# vite.config.js outputs to '../static' relative to frontend/ → /project/static
RUN npm run build

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM python:3.12-slim

LABEL org.opencontainers.image.title="MouseOps"
LABEL org.opencontainers.image.description="Showroom E2E Test Runner"

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application and built frontend
COPY main.py .
COPY --from=frontend-builder /project/static ./static

# Persistent data directory (mount a volume here)
RUN mkdir -p /app/data
VOLUME ["/app/data"]

# Default environment
ENV MOUSEOPS_DATA_DIR=/app/data \
    MOUSEOPS_MODE=https         \
    MOUSEOPS_HTTP_PORT=8765     \
    MOUSEOPS_HTTPS_PORT=8766

EXPOSE 8765 8766

COPY docker-entrypoint.sh /usr/local/bin/mouseops-entrypoint
RUN chmod +x /usr/local/bin/mouseops-entrypoint

ENTRYPOINT ["mouseops-entrypoint"]
