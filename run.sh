#!/bin/bash
# Usage:
#   bash run.sh           → HTTPS on :8766 + HTTP redirect on :8765 (default)
#   bash run.sh --http    → HTTP only on :8765  (no SSL, no redirect)
#   bash run.sh --https   → HTTPS on :8766 + HTTP redirect on :8765
#
# Port overrides: MOUSEOPS_HTTP_PORT=80 MOUSEOPS_HTTPS_PORT=443 bash run.sh
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# ── Parse mode flag ───────────────────────────────────────────────────────────
MODE="${MOUSEOPS_PROTOCOL:-https}"   # default: https
for arg in "$@"; do
    case "$arg" in
        --http)  MODE=http  ;;
        --https) MODE=https ;;
    esac
done

# ── React build ───────────────────────────────────────────────────────────────
if [ ! -f "static/index.html" ] || [ "${SKIP_BUILD}" != "1" ]; then
    echo "Building React frontend..."
    bash "$DIR/build.sh"
fi

# ── Python venv ───────────────────────────────────────────────────────────────
if [ ! -d ".venv" ]; then
    echo "Creating Python virtualenv..."
    python3 -m venv .venv
    .venv/bin/pip install -q -r requirements.txt
fi

# ── Ports ─────────────────────────────────────────────────────────────────────
HTTP_PORT="${MOUSEOPS_HTTP_PORT:-8765}"
HTTPS_PORT="${MOUSEOPS_HTTPS_PORT:-8766}"

# ── Start ─────────────────────────────────────────────────────────────────────
if [ "$MODE" = "http" ]; then
    echo ""
    echo "MouseOps  [HTTP mode]"
    echo "  http://127.0.0.1:${HTTP_PORT}"
    echo ""
    export MOUSEOPS_MODE=http
    exec .venv/bin/uvicorn main:app \
        --host 0.0.0.0 \
        --port "${HTTP_PORT}"
else
    # Export mode BEFORE importing main so HTTPS_MODE is set correctly in main.py
    export MOUSEOPS_MODE=https
    # Ensure SSL cert exists before uvicorn binds the SSL port
    .venv/bin/python3 -c "import main" 2>/dev/null || true
    echo ""
    echo "MouseOps  [HTTPS mode]"
    echo "  HTTP  → http://127.0.0.1:${HTTP_PORT}  (redirects to HTTPS)"
    echo "  HTTPS → https://127.0.0.1:${HTTPS_PORT}"
    echo "  Note: browser will warn about self-signed cert — click Advanced → Proceed"
    echo ""
    exec .venv/bin/uvicorn main:app \
        --host 0.0.0.0 \
        --port "${HTTPS_PORT}" \
        --ssl-keyfile  .ssl/key.pem \
        --ssl-certfile .ssl/cert.pem
fi
