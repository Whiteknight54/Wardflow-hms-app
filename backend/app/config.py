import os
from pathlib import Path

from dotenv import load_dotenv

# Load backend/.env when running locally (outside Docker).
# In Docker, environment vars are injected by compose and load_dotenv is a no-op.
_env_file = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(_env_file, override=False)


def _env(name: str, default: str) -> str:
    value = os.getenv(name)
    return value.strip() if value and value.strip() else default


DATABASE_URL = _env("DATABASE_URL", "postgresql://admin:password123@postgres:5432/wardflow")
CORS_ORIGINS = [
    origin.strip()
    for origin in _env("CORS_ORIGINS", "http://localhost:5500,http://127.0.0.1:5500,null").split(",")
    if origin.strip()
]
JWT_SECRET = _env("JWT_SECRET", "change-this-in-production")
JWT_ALGORITHM = _env("JWT_ALGORITHM", "HS256")
JWT_EXPIRES_MINUTES = int(_env("JWT_EXPIRES_MINUTES", "120"))

SMTP_HOST = _env("SMTP_HOST", "")
SMTP_PORT = int(_env("SMTP_PORT", "587"))
SMTP_USERNAME = _env("SMTP_USERNAME", "")
SMTP_PASSWORD = _env("SMTP_PASSWORD", "")
SMTP_FROM_EMAIL = _env("SMTP_FROM_EMAIL", "noreply@wardflow.local")
SMTP_USE_TLS = _env("SMTP_USE_TLS", "true").lower() == "true"

OTP_EXPIRES_MINUTES = int(_env("OTP_EXPIRES_MINUTES", "10"))
OTP_RESEND_MIN_SECONDS = int(_env("OTP_RESEND_MIN_SECONDS", "30"))
OTP_DEV_FALLBACK = _env("OTP_DEV_FALLBACK", "true").lower() == "true"
OTP_ALWAYS_REQUIRED = _env("OTP_ALWAYS_REQUIRED", "false").lower() == "true"

RESET_TOKEN_EXPIRES_MINUTES = int(_env("RESET_TOKEN_EXPIRES_MINUTES", "30"))
RESET_REQUEST_MIN_SECONDS = int(_env("RESET_REQUEST_MIN_SECONDS", "60"))

# Bootstrap admin users — comma-separated emails auto-created as System Admin on startup.
# Existing users are never overwritten.
BOOTSTRAP_ADMIN_EMAILS: list[str] = [
    e.strip()
    for e in _env("BOOTSTRAP_ADMIN_EMAILS", "admin@wardflow.com").split(",")
    if e.strip()
]
BOOTSTRAP_ADMIN_PASSWORD = _env("BOOTSTRAP_ADMIN_PASSWORD", "password123")
