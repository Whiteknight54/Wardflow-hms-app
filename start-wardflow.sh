#!/usr/bin/env bash
set -euo pipefail

echo "Starting WardFlow with Docker Compose..."
docker-compose up -d --build

echo
echo "WardFlow is starting:"
echo "  Frontend:   http://localhost:5500/login.html"
echo "  API health: http://localhost:8001/api/health"
echo "  pgAdmin:    http://localhost:5051"
echo
echo "Default login:"
echo "  admin@wardflow.com / password123"
