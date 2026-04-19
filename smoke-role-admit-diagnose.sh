#!/usr/bin/env bash
set -euo pipefail

API='http://localhost:8001/api'
ADMIN_EMAIL='admin@wardflow.com'
ADMIN_PASS='password123'
STAMP="$(date +%s)"
TEST_PASS='Pass1234!'

login() {
  local email="$1" pass="$2"
  curl -sS -X POST "$API/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$pass\"}"
}

echo '== Admin login =='
ADMIN_LOGIN_JSON="$(login "$ADMIN_EMAIL" "$ADMIN_PASS")"
ADMIN_TOKEN="$(echo "$ADMIN_LOGIN_JSON" | jq -r '.data.token // empty')"
if [[ -z "$ADMIN_TOKEN" ]]; then
  echo 'Admin login failed:'
  echo "$ADMIN_LOGIN_JSON" | jq .
  exit 1
fi

echo '== Live role template check =='
ROLES_JSON="$(curl -sS "$API/roles" -H "Authorization: Bearer $ADMIN_TOKEN")"
echo "$ROLES_JSON" | jq '{consultant: .data.role_templates["Consultant"], ward_manager: .data.role_templates["Ward Manager"]}'

STAFF_JSON="$(curl -sS "$API/staff" -H "Authorization: Bearer $ADMIN_TOKEN")"
CONSULTANT_NAME="$(echo "$STAFF_JSON" | jq -r '.data[] | select((.title // "") | test("Consultant"; "i")) | .full_name' | head -n1)"
WARD_MGR_NAME="$(echo "$STAFF_JSON" | jq -r '.data[0].full_name // empty')"

if [[ -z "$CONSULTANT_NAME" || -z "$WARD_MGR_NAME" ]]; then
  echo 'Unable to resolve staff names.'
  exit 1
fi

CONSULTANT_EMAIL="diag.consultant.$STAMP@wardflow.local"
WARD_MGR_EMAIL="diag.wardmgr.$STAMP@wardflow.local"

create_user() {
  local role="$1" staff="$2" email="$3"
  local payload
  payload="{\"linked_staff_name\":\"$staff\",\"email\":\"$email\",\"password\":\"$TEST_PASS\",\"role\":\"$role\"}"
  local resp
  resp="$(curl -sS -X POST "$API/users" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "$payload")"
  if [[ "$(echo "$resp" | jq -r '.success // false')" != "true" ]]; then
    echo "Create user failed for $email"
    echo "$resp" | jq .
    exit 1
  fi
}

echo '== Create diagnostic users =='
create_user 'Consultant' "$CONSULTANT_NAME" "$CONSULTANT_EMAIL"
create_user 'Ward Manager' "$WARD_MGR_NAME" "$WARD_MGR_EMAIL"

after_cleanup() {
  for email in "$CONSULTANT_EMAIL" "$WARD_MGR_EMAIL"; do
    curl -sS -X DELETE "$API/users/$email" -H "Authorization: Bearer $ADMIN_TOKEN" >/dev/null || true
  done
}
trap after_cleanup EXIT

POSTGRES_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E 'wardflow.*postgres' | head -n1 || true)"
if [[ -z "$POSTGRES_CONTAINER" ]]; then
  echo 'Postgres container not found.'
  exit 1
fi

SQL="UPDATE system_users SET otp_required=false, must_change_password=false, otp_code_hash=NULL, otp_expires_at=NULL WHERE email IN ('$CONSULTANT_EMAIL','$WARD_MGR_EMAIL');"
docker exec "$POSTGRES_CONTAINER" psql -U admin -d wardflow -c "$SQL" >/dev/null

try_admit() {
  local label="$1" email="$2"
  local lj token me resp code

  lj="$(login "$email" "$TEST_PASS")"
  token="$(echo "$lj" | jq -r '.data.token // empty')"
  if [[ -z "$token" ]]; then
    echo "$label login failed"
    echo "$lj" | jq .
    return
  fi

  me="$(curl -sS "$API/auth/me" -H "Authorization: Bearer $token")"
  echo "-- $label resolved permissions --"
  echo "$me" | jq '{email: .data.email, role: .data.role, permissions: .data.permissions}'

  resp="$(curl -sS -w '\nHTTP_STATUS:%{http_code}\n' -X POST "$API/patients" \
    -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' \
    -d '{"full_name":"Diag Admit Patient","age":50,"sex":"F","ward":"ICU","team":"Team Alpha"}')"

  code="$(echo "$resp" | awk -F: '/HTTP_STATUS/ {print $2}' | tr -d '[:space:]')"
  body="$(echo "$resp" | sed '/HTTP_STATUS:/d')"

  echo "-- $label admit response code: $code --"
  echo "$body" | jq . 2>/dev/null || echo "$body"

  echo "-- $label recent security audit --"
  curl -sS "$API/audit-log?limit=20&actor_email=$email" -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.data[] | select(.action_type=="SECURITY_SCOPE_DENIED" or .action_type=="SECURITY_PERMISSION_DENIED") | {action_type,target_id,details,outcome,created_at}'
}

echo '== Diagnose Consultant =='
try_admit 'Consultant' "$CONSULTANT_EMAIL"

echo '== Diagnose Ward Manager =='
try_admit 'Ward Manager' "$WARD_MGR_EMAIL"

echo '== Cleanup diagnostic users =='
for email in "$CONSULTANT_EMAIL" "$WARD_MGR_EMAIL"; do
  code="$(curl -s -o /tmp/wf_del.json -w '%{http_code}' -X DELETE "$API/users/$email" -H "Authorization: Bearer $ADMIN_TOKEN")"
  echo "delete|$email|$code"
done
