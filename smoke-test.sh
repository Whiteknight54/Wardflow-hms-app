#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="${SMOKE_BASE_URL:-http://localhost:8001/api}"
FRONTEND_HOST="${SMOKE_FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${SMOKE_FRONTEND_PORT:-5501}"
ADMIN_EMAIL="${SMOKE_ADMIN_EMAIL:-admin@wardflow.com}"
ADMIN_PASSWORD="${SMOKE_ADMIN_PASSWORD:-password123}"
LOGIN_PAYLOAD="$(ADMIN_EMAIL="${ADMIN_EMAIL}" ADMIN_PASSWORD="${ADMIN_PASSWORD}" python3 - <<'PY'
import json
import os
print(json.dumps({"email": os.environ["ADMIN_EMAIL"], "password": os.environ["ADMIN_PASSWORD"]}))
PY
)"
STATIC_SERVER_PID=""
SMOKE_PATIENT_CODE=""

cleanup() {
  if [[ -n "${SMOKE_PATIENT_CODE}" ]]; then
    TOKEN="$(curl -sS -X POST "${BASE_URL}/auth/login" -H 'Content-Type: application/json' -d "${LOGIN_PAYLOAD}" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("data",{}).get("token",""))' || true)"
    if [[ -n "${TOKEN}" ]]; then
      curl -sS -o /dev/null -X DELETE "${BASE_URL}/patients/${SMOKE_PATIENT_CODE}" -H "Authorization: Bearer ${TOKEN}" || true
    fi
  fi

  if [[ -n "${STATIC_SERVER_PID}" ]]; then
    kill "${STATIC_SERVER_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

echo "Starting test stack..."
docker compose -f "${REPO_ROOT}/docker-compose.test.yml" up -d --build

echo "Waiting for API health..."
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sS "${BASE_URL}/health" >/dev/null; then
    break
  fi
  sleep 1
done

echo "Reseeding database..."
docker exec wardflow-test-api python backend/scripts/seed.py

echo "Checking API health endpoint..."
curl -sS "${BASE_URL}/health" | python3 -c 'import json,sys; data=json.loads(sys.stdin.read()); assert data.get("success") is True'

echo "Logging in..."
LOGIN_RESPONSE="$(curl -sS -X POST "${BASE_URL}/auth/login" -H 'Content-Type: application/json' -d "${LOGIN_PAYLOAD}")"
ACCESS_TOKEN="$(python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("data",{}).get("token",""))' <<< "${LOGIN_RESPONSE}")"
if [[ -z "${ACCESS_TOKEN}" ]]; then
  echo "Login failed"
  echo "${LOGIN_RESPONSE}"
  exit 1
fi

echo "Checking authenticated bootstrap endpoints..."
for endpoint in '/patients?limit=5' '/wards' '/teams' '/staff' '/roles' '/system-perms'; do
  curl -sS "${BASE_URL}${endpoint}" -H "Authorization: Bearer ${ACCESS_TOKEN}" | python3 -c 'import json,sys; data=json.loads(sys.stdin.read()); assert data.get("success") is True'
done

echo "Starting local frontend server..."
python3 -m http.server "${FRONTEND_PORT}" --bind "${FRONTEND_HOST}" >/tmp/wardflow-smoke-http.log 2>&1 &
STATIC_SERVER_PID=$!
FRONTEND_READY_STATUS=""
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  FRONTEND_READY_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "http://${FRONTEND_HOST}:${FRONTEND_PORT}/index.html" || true)"
  if [[ "${FRONTEND_READY_STATUS}" == "200" ]]; then
    break
  fi
  sleep 1
done

if [[ "${FRONTEND_READY_STATUS}" != "200" ]]; then
  echo "Frontend server failed to start"
  cat /tmp/wardflow-smoke-http.log || true
  exit 1
fi

echo "Checking frontend pages..."
for page in login.html index.html census.html system.html workload.html analytics.html; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' "http://${FRONTEND_HOST}:${FRONTEND_PORT}/${page}")"
  if [[ "${code}" != "200" ]]; then
    echo "Frontend page check failed: ${page} -> ${code}"
    exit 1
  fi
done

echo "Running patient workflow..."
ADMIT_STATUS_AND_BODY_FILE="$(mktemp)"
ADMIT_STATUS="$(curl -sS -o "${ADMIT_STATUS_AND_BODY_FILE}" -w '%{http_code}' -X POST "${BASE_URL}/patients" -H 'Content-Type: application/json' -H "Authorization: Bearer ${ACCESS_TOKEN}" -d '{"full_name":"Smoke Test Patient","age":45,"sex":"M","ward":"General","team":"Team Beta"}')"
ADMIT_RESPONSE="$(cat "${ADMIT_STATUS_AND_BODY_FILE}")"
rm -f "${ADMIT_STATUS_AND_BODY_FILE}"
if [[ "${ADMIT_STATUS}" != "200" && "${ADMIT_STATUS}" != "201" ]]; then
  echo "Admit failed: ${ADMIT_STATUS}"
  echo "${ADMIT_RESPONSE}"
  exit 1
fi
SMOKE_PATIENT_CODE="$(python3 -c 'import json,sys; data=json.loads(sys.stdin.read()); print((data.get("data") or {}).get("patient_code", ""))' <<< "${ADMIT_RESPONSE}")"
if [[ -z "${SMOKE_PATIENT_CODE}" ]]; then
  echo "Admit failed"
  echo "${ADMIT_RESPONSE}"
  exit 1
fi

TRANSFER_RESPONSE="$(curl -sS -X PATCH "${BASE_URL}/patients/${SMOKE_PATIENT_CODE}/transfer" -H 'Content-Type: application/json' -H "Authorization: Bearer ${ACCESS_TOKEN}" -d '{"ward":"ICU","team":"Team Beta"}')"
python3 -c 'import json,sys; data=json.loads(sys.stdin.read()); assert data.get("success") is True' <<< "${TRANSFER_RESPONSE}"

TREATMENT_RESPONSE="$(curl -sS -X POST "${BASE_URL}/patients/${SMOKE_PATIENT_CODE}/treatments" -H 'Content-Type: application/json' -H "Authorization: Bearer ${ACCESS_TOKEN}" -d '{"doctor_name":"Dr. James Wilson","notes":"Smoke test treatment note"}')"
python3 -c 'import json,sys; data=json.loads(sys.stdin.read()); assert data.get("success") is True' <<< "${TREATMENT_RESPONSE}"

HISTORY_RESPONSE="$(curl -sS "${BASE_URL}/patients/${SMOKE_PATIENT_CODE}/treatments" -H "Authorization: Bearer ${ACCESS_TOKEN}")"
HISTORY_COUNT="$(python3 -c 'import json,sys; data=json.loads(sys.stdin.read()); print(len(data.get("data") or []))' <<< "${HISTORY_RESPONSE}")"
if [[ "${HISTORY_COUNT}" -lt 1 ]]; then
  echo "Treatment history check failed"
  echo "${HISTORY_RESPONSE}"
  exit 1
fi

DISCHARGE_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE "${BASE_URL}/patients/${SMOKE_PATIENT_CODE}" -H "Authorization: Bearer ${ACCESS_TOKEN}")"
if [[ "${DISCHARGE_STATUS}" != "200" && "${DISCHARGE_STATUS}" != "204" ]]; then
  echo "Discharge failed: ${DISCHARGE_STATUS}"
  exit 1
fi

echo "Smoke test passed."