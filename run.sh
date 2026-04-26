#!/bin/bash
# Auto-creates a virtualenv on first run, then starts the server.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

if [ ! -d ".venv" ]; then
    echo "Creating virtualenv..."
    python3 -m venv .venv
    .venv/bin/pip install -q -r requirements.txt
    echo "Done."
fi

echo "MouseOps → http://127.0.0.1:8765"
exec .venv/bin/uvicorn main:app --host 127.0.0.1 --port 8765 --reload
