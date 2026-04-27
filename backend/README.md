# WardFlow Backend Starter

This backend is wired for PostgreSQL and is currently exercised through the local test stack in the repo root.

## Connection

Current test database URL:

`postgresql://admin:password123@postgres:5432/wardflow`

When the API runs in `docker-compose.yml`, the browser-facing frontend should call `http://127.0.0.1:8001/api`.

## SMTP / OTP

The backend can send OTP codes through Gmail SMTP for first-login and verification flows.

Set these environment variables before starting the API:

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=wardflowhms@gmail.com
SMTP_PASSWORD=<gmail-app-password>
SMTP_FROM_EMAIL=wardflowhms@gmail.com
SMTP_USE_TLS=true
OTP_RESEND_MIN_SECONDS=30
RESET_TOKEN_EXPIRES_MINUTES=30
RESET_REQUEST_MIN_SECONDS=60
OTP_DEV_FALLBACK=false
```

If `OTP_DEV_FALLBACK=true`, the API returns the OTP code in the response when SMTP delivery fails or is unavailable. Keep that disabled for real email delivery.
When an account has a pending OTP challenge, protected API routes are blocked until `POST /api/auth/verify-otp` succeeds.

## Setting Up SMTP Credentials (Gmail)

To enable email features (OTP, password reset), you must set up a Gmail App Password for SMTP. Do NOT use your regular Gmail password.

**Steps:**
1. Go to https://myaccount.google.com/security
2. Enable 2-Step Verification if not already enabled.
3. Under "App passwords," generate a new app password for "Mail" (select "Other" if needed).
4. Copy the generated password (16 characters, no spaces).
5. Set the following environment variables (in your .env or Docker secrets):

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=<your-gmail>--or-wardflowhms@gmail.com
SMTP_PASSWORD=<your-app-password>
SMTP_FROM_EMAIL=<your-gmail>--or-wardflowhms@gmail.com
SMTP_USE_TLS=true
```

**Never commit real SMTP_PASSWORD values to version control.**

If you need to rotate or update the password, repeat the steps above and update your environment.

## Run

1. Start the current test stack from the repo root:

```bash
docker-compose -f docker-compose.test.yml up -d --build
```

2. The API container is exposed on host port `8001` and serves `/api/*` routes.

3. The container connects to PostgreSQL on the `pgnet_test` Docker network.

4. The schema and starter seed are loaded from `backend/sql/001_init.sql` when postgres starts.

## Endpoints

- `GET /` checks the API process.
- `GET /api/health` returns the API health status.
- `POST /api/auth/login` returns a JWT access token.
- `POST /api/auth/forgot-password/request` sends a one-time reset token email.
- `POST /api/auth/forgot-password/confirm` validates the token and updates password (one-time use).
- `POST /api/auth/change-password` updates a temporary password and triggers OTP verification.
- `POST /api/auth/request-otp` sends a fresh OTP challenge to the signed-in user.
- `POST /api/auth/verify-otp` verifies the OTP challenge and completes the login flow.
- `GET /api/auth/me` validates token and returns current user context.
- `GET /api/wards` returns ward occupancy.
- `GET /api/teams` returns team workload.
- `GET /api/staff` returns the staff directory.
- `GET /api/patients` returns the patient census with optional filters.
- `POST /api/patients` admits a patient.
- `PATCH /api/patients/{patient_code}/transfer` transfers a patient.
- `DELETE /api/patients/{patient_code}` discharges a patient.
- `GET /api/patients/{patient_code}/treatments` returns treatment history.
- `POST /api/patients/{patient_code}/treatments` logs treatment.
- `GET /api/db-health` checks the PostgreSQL connection.
- `GET /api/audit-log` returns structured audit events with filters (`action_type`, `actor_email`, `target_id`, `category`, `outcome`, `query`) and pagination (`limit`, `offset`).
- `POST /api/wards`, `PATCH /api/wards/{ward_name}`, `DELETE /api/wards/{ward_name}` manage wards.
- `POST /api/teams`, `DELETE /api/teams/{team_name}` manage teams.
- `GET /api/users`, `POST /api/users`, `DELETE /api/users/{email}` manage system accounts.
- `PATCH /api/users/{email}/password` resets account passwords.
- `PATCH /api/users/{email}/permissions`, `POST /api/users/{email}/reset-permissions` manage per-user permissions.
- `GET /api/roles`, `POST /api/roles`, `PATCH /api/roles/{role_name}` manage role templates.
- `GET /api/roster/{team_name}`, `POST /api/roster/{team_name}` manage roster data.
- `GET /api/system-perms`, `PATCH /api/system-perms` manage security policies.

## Auth Usage

Most `/api/*` endpoints are protected and require:

`Authorization: Bearer <token>`

Login example payload:

```json
{
	"email": "admin@wardflow.com",
	"password": "password123"
}
```

For local development, reseed users when needed:

```bash
docker exec wardflow-test-api python backend/scripts/seed.py
```

## Seeded Login Accounts (Application UI)

- `admin@wardflow.com` / `password123` (System Admin)
- `wardflowhms@gmail.com` / `password123` (System Admin)
- `house@wardflow.com` / `password123` (Consultant)
- `consultant@wardflow.com` / `password123` (Consultant)
- `seniordoctor@wardflow.com` / `password123` (Senior Doctor profile via Consultant role)
- `jdoctor@wardflow.com` / `password123` (Junior Doctor)
- `wmanager@wardflow.com` / `password123` (Ward Manager)
- `nurse@wardflow.com` / `password123` (Nurse profile via Ward Manager role)