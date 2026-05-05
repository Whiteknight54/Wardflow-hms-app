#!/usr/bin/env bash
# WardFlow HMS — one-step startup script (macOS / Linux)
set -euo pipefail

cd "$(dirname "$0")"

echo ""
echo "========================================"
echo "  WardFlow HMS — Starting stack"
echo "========================================"
echo ""

# Build and start all containers
docker compose up -d --build

echo ""
echo "Waiting for services to become healthy..."

# Poll the API health endpoint (up to 90s)
for i in $(seq 1 18); do
  if curl -sf http://localhost:8001/api/health > /dev/null 2>&1; then
    echo "API is ready."
    break
  fi
  if [ "$i" -eq 18 ]; then
    echo "WARNING: API did not respond after 90s. Check logs with: docker compose logs api"
  fi
  sleep 5
done

echo ""
echo "========================================"
echo "  Stack ready!"
echo "========================================"
echo ""
echo "  Frontend:  http://localhost:5500"
echo "  API:       http://localhost:8001/api/health"
echo "  pgAdmin:   http://localhost:5051"
echo ""
echo "  Login credentials (run seed.py first):"
echo "    admin@wardflow.com         / password123  (System Admin)"
echo "    wardflowhms@gmail.com      / password123  (System Admin)"
echo "    use@wardflow.com           / password123  (Consultant)"
echo "    consultant@wardflow.com    / password123  (Consultant)"
echo "    seniordoctor@wardflow.com  / password123  (Consultant)"
echo "    jdoctor@wardflow.com       / password123  (Junior Doctor)"
echo "    wmanager@wardflow.com      / password123  (Ward Manager)"
echo "    nurse@wardflow.com         / password123  (Ward Manager)"
echo ""
echo "  pgAdmin login:  admin@wardflow.com / admin123"
echo ""
echo "  To seed sample data:"
echo "    docker compose exec api python backend/scripts/seed.py"
echo ""
echo "  To stop:              docker compose down"
echo "  To stop + clear data: docker compose down -v"
echo ""

# Open browser (macOS: open, Linux: xdg-open — silent if neither works)
if command -v open > /dev/null 2>&1; then
  open http://localhost:5500/login.html
elif command -v xdg-open > /dev/null 2>&1; then
  xdg-open http://localhost:5500/login.html
fi
