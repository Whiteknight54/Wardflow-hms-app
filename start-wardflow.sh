#!/bin/bash
# ============================================================================
# start-wardflow.sh - Launch WardFlow test environment (Nginx + API + DB)
# ============================================================================
# Usage: ./start-wardflow.sh
#
# This script launches the full WardFlow stack using Docker Compose and opens
# the login page in your default browser. It is safe to run multiple times.
#
# Requirements:
#   - Docker and Docker Compose installed
#   - macOS or Linux (for Windows, use START-TEST.bat)
#
# ============================================================================

set -e

# Move to script directory
cd "$(dirname "$0")"

# Start the stack
COMPOSE_FILE="docker-compose.test.yml"
echo "[INFO] Starting WardFlow containers..."
docker compose -f "$COMPOSE_FILE" up -d --build

# Wait for Nginx frontend to be ready
FRONTEND_URL="http://127.0.0.1:5500/login.html"
echo "[INFO] Waiting for frontend to be available at $FRONTEND_URL ..."
for i in {1..20}; do
  if curl -sSf "$FRONTEND_URL" > /dev/null; then
    echo "[INFO] Frontend is up."
    break
  fi
  sleep 1
done

# Open the login page in the default browser (macOS/Linux)
echo "[INFO] Opening WardFlow login page..."
if command -v open > /dev/null; then
  open "$FRONTEND_URL"
elif command -v xdg-open > /dev/null; then
  xdg-open "$FRONTEND_URL"
else
  echo "[WARN] Could not detect browser opener. Please open: $FRONTEND_URL"
fi

echo "[SUCCESS] WardFlow environment is running."
