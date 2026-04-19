#!/usr/bin/env bash
set -euo pipefail

API='http://localhost:8001/api'
ADMIN_EMAIL='admin@wardflow.com'
ADMIN_PASS='password123'
STAMP="$(date +%s)"

login() {
  local email="$1" pass="$2"
  curl -sS -X POST "$API/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$pass\"}"
}

status_code() {
  local method="$1"; shift
  local url="$1"; shift
  curl -s -o /tmp/wf_resp.json -w '%{http_code}' -X "$method" "$url" "$@"
}

echo '== Admin login =='
ADMIN_LOGIN_JSON="$(login "$ADMIN_EMAIL" "$ADMIN_PASS")"
ADMIN_TOKEN="$(echo "$ADMIN_LOGIN_JSON" | jq -r '.data.token // empty')"
if [[ -z "$ADMIN_TOKEN" ]]; then
  echo 'Admin login failed:'
  echo "$ADMIN_LOGIN_JSON" | jq .
  exit 1
fi

echo '== Resolve staff names =='
STAFF_JSON="$(curl -sS "$API/staff" -H "Authorization: Bearer $ADMIN_TOKEN")"
CONSULTANT_NAME="$(echo "$STAFF_JSON" | jq -r '.data[] | select((.title // "") | test("Consultant"; "i")) | .full_name' | head -n1)"
WARD_MGR_NAME="$(echo "$STAFF_JSON" | jq -r '.data[] | select((.title // "") | test("Ward Manager|Manager"; "i")) | .full_name' | head -n1)"
JUNIOR_NAME="$(echo "$STAFF_JSON" | jq -r '.data[] | select((.title // "") | test("Junior"; "i")) | .full_name' | head -n1)"

if [[ -z "$WARD_MGR_NAME" ]]; then
  WARD_MGR_NAME="$(echo "$STAFF_JSON" | jq -r '.data[0].full_name // empty')"
fi

if [[ -z "$CONSULTANT_NAME" || -z "$WARD_MGR_NAME" || -z "$JUNIOR_NAME" ]]; then
  echo 'Missing required staff names for test users.'
  echo "$STAFF_JSON" | jq '.data[:10]'
  exit 1
fi

CONSULTANT_EMAIL="itest.consultant.$STAMP@wardflow.local"
WARD_MGR_EMAIL="itest.wardmgr.$STAMP@wardflow.local"
JUNIOR_EMAIL="itest.juniordoc.$STAMP@wardflow.local"
TEST_PASS='Pass1234!'

create_user() {
  local role="$1" staff="$2" email="$3"
  local payload
  payload="{\"linked_staff_name\":\"$staff\",\"email\":\"$email\",\"password\":\"$TEST_PASS\",\"role\":\"$role\"}"
  local resp
  resp="$(curl -sS -X POST "$API/users" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "$payload")"
  if [[ "$(echo "$resp" | jq -r '.success // false')" != "true" ]]; then
    echo "Create user failed for $email:"
    echo "$resp" | jq .
    exit 1
  fi
}

echo '== Create test users =='
create_user 'Consultant' "$CONSULTANT_NAME" "$CONSULTANT_EMAIL"
create_user 'Ward Manager' "$WARD_MGR_NAME" "$WARD_MGR_EMAIL"
create_user 'Junior Doctor' "$JUNIOR_NAME" "$JUNIOR_EMAIL"
echo "Created users: $CONSULTANT_EMAIL, $WARD_MGR_EMAIL, $JUNIOR_EMAIL"

POSTGRES_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E 'wardflow.*postgres' | head -n1 || true)"
if [[ -z "$POSTGRES_CONTAINER" ]]; then
  echo 'Postgres container not found (cannot apply OTP bypass).'
  exit 1
fi

echo "== OTP bypass update in $POSTGRES_CONTAINER =="
SQL="UPDATE system_users SET otp_required=false, must_change_password=false, otp_code_hash=NULL, otp_expires_at=NULL WHERE email IN ('$CONSULTANT_EMAIL','$WARD_MGR_EMAIL','$JUNIOR_EMAIL');"
docker exec "$POSTGRES_CONTAINER" psql -U admin -d wardflow -c "$SQL"

test_role() {
  local label="$1" email="$2"
  local login_json token me_code patients_code audit_code users_code admit_code
  login_json="$(login "$email" "$TEST_PASS")"
  token="$(echo "$login_json" | jq -r '.data.token // empty')"
  if [[ -z "$token" ]]; then
    echo "$label|LOGIN|FAIL"
    echo "$login_json" | jq .
    return
  fi

  me_code="$(status_code GET "$API/auth/me" -H "Authorization: Bearer $token")"
  patients_code="$(status_code GET "$API/patients?limit=5" -H "Authorization: Bearer $token")"
  audit_code="$(status_code GET "$API/audit-log?limit=1" -H "Authorization: Bearer $token")"
  users_code="$(status_code GET "$API/users" -H "Authorization: Bearer $token")"
  admit_code="$(status_code POST "$API/patients" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -d '{"full_name":"Lifecycle Test Patient","age":44,"sex":"M","ward":"ICU","team":"Team Alpha"}')"

  echo "$label|LOGIN|PASS|requiresOtp=$(echo "$login_json" | jq -r '.data.requiresOtp')|requiresPasswordChange=$(echo "$login_json" | jq -r '.data.requiresPasswordChange')"
  echo "$label|auth_me|$me_code"
  echo "$label|patients_view|$patients_code"
  echo "$label|audit_view|$audit_code"
  echo "$label|users_view|$users_code"
  echo "$label|admit|$admit_code"
}

echo '== Execute role lifecycle checks =='
test_role 'Consultant' "$CONSULTANT_EMAIL"
test_role 'Ward Manager' "$WARD_MGR_EMAIL"
test_role 'Junior Doctor' "$JUNIOR_EMAIL"

echo '== Cleanup =='
for EMAIL in "$CONSULTANT_EMAIL" "$WARD_MGR_EMAIL" "$JUNIOR_EMAIL"; do
  CODE="$(status_code DELETE "$API/users/$EMAIL" -H "Authorization: Bearer $ADMIN_TOKEN")"
  echo "cleanup|$EMAIL|$CODE"
done

echo 'Lifecycle test run complete.'
