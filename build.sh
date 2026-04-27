#!/bin/bash
# Build the React frontend and output to static/
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/frontend"

if [ ! -d "node_modules" ]; then
  echo "Installing frontend dependencies..."
  npm install
fi

echo "Building React app → ../static/ ..."
npm run build
echo "Build complete."
