#!/bin/bash
# Builds the React UI (if needed), then starts the FastAPI backend.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

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

echo "MouseOps → http://127.0.0.1:8765"
exec .venv/bin/uvicorn main:app --host 127.0.0.1 --port 8765
