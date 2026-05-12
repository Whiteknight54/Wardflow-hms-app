from __future__ import annotations

import hashlib
import hmac
import secrets
import smtplib
from email.message import EmailMessage
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from jwt import InvalidTokenError
from pydantic import BaseModel, Field
from psycopg import errors as psycopg_errors
from psycopg.rows import dict_row
from psycopg.types.json import Json

from .config import (
    BOOTSTRAP_ADMIN_EMAILS,
    BOOTSTRAP_ADMIN_PASSWORD,
    JWT_ALGORITHM,
    JWT_EXPIRES_MINUTES,
    RESET_REQUEST_MIN_SECONDS,
    RESET_TOKEN_EXPIRES_MINUTES,
    JWT_SECRET,
    OTP_ALWAYS_REQUIRED,
    OTP_DEV_FALLBACK,
    OTP_EXPIRES_MINUTES,
    OTP_RESEND_MIN_SECONDS,
    SMTP_FROM_EMAIL,
    SMTP_HOST,
    SMTP_PASSWORD,
    SMTP_PORT,
    SMTP_USERNAME,
    SMTP_USE_TLS,
)
from .db import get_connection


router = APIRouter(prefix="/api")


class AdmitPatientPayload(BaseModel):
    full_name: str = Field(min_length=1)
    age: int = Field(ge=0)
    sex: str = Field(min_length=1, max_length=10)
    ward: str = Field(min_length=1)
    team: str = Field(min_length=1)
    bed_label: str | None = None


class TransferPayload(BaseModel):
    ward: str = Field(min_length=1)
    team: str = Field(min_length=1)


class TreatmentPayload(BaseModel):
    doctor_name: str = Field(min_length=1)
    notes: str | None = None


class WardSettingsPayload(BaseModel):
    bed_capacity: int = Field(ge=0)
    status: str = Field(min_length=1)


class NewWardPayload(BaseModel):
    name: str = Field(min_length=1)
    bed_capacity: int = Field(default=20, ge=0)
    status: str = Field(default="Active / Open", min_length=1)


class NewTeamPayload(BaseModel):
    name: str = Field(min_length=1)
    consultant_name: str | None = None


class NewRolePayload(BaseModel):
    role_name: str = Field(min_length=1)


class RoleTemplatePayload(BaseModel):
    viewGlobalPatients: bool
    allowedWards: list[str]
    allowedTeams: list[str]
    admit: bool
    discharge: bool
    transfer: bool
    logTreatment: bool
    exportData: bool
    manageSystem: bool
    manageStaff: bool
    manageAccounts: bool
    manageWards: bool
    viewReports: bool
    bedMatrix: bool


class RosterPayload(BaseModel):
    d: list[str]
    n: list[str]


class SystemPermsPayload(BaseModel):
    timeout: str
    mfa: str
    ip: str


class LoginPayload(BaseModel):
    email: str = Field(min_length=1)
    password: str = Field(min_length=1)


class CreateUserPayload(BaseModel):
    linked_staff_name: str = Field(min_length=1)
    email: str = Field(min_length=1)
    password: str = Field(min_length=1)
    role: str = Field(min_length=1)


class ResetUserPasswordPayload(BaseModel):
    new_password: str = Field(min_length=1)


class UserPermissionsPayload(BaseModel):
    viewGlobalPatients: bool
    allowedWards: list[str]
    allowedTeams: list[str]
    admit: bool
    discharge: bool
    transfer: bool
    logTreatment: bool
    exportData: bool
    manageSystem: bool
    manageStaff: bool
    manageAccounts: bool
    manageWards: bool
    viewReports: bool
    bedMatrix: bool
    customPermissions: bool = True


class ChangePasswordPayload(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8)


class VerifyOtpPayload(BaseModel):
    otp_code: str = Field(min_length=4, max_length=12)


class ForgotPasswordRequestPayload(BaseModel):
    email: str = Field(min_length=1)


class ForgotPasswordConfirmPayload(BaseModel):
    email: str = Field(min_length=1)
    reset_token: str = Field(min_length=8)
    new_password: str = Field(min_length=8)


def _normalize_team_input(team: str) -> tuple[str, str]:
    cleaned = team.strip()
    code = cleaned.replace("Team ", "").strip().upper()
    name = cleaned if cleaned.lower().startswith("team ") else f"Team {cleaned}"
    return code, name


def _resolve_team(cursor: Any, team_input: str) -> dict[str, Any]:
    code, name = _normalize_team_input(team_input)
    cursor.execute(
        """
        SELECT id, code, name
        FROM teams
        WHERE LOWER(code) = LOWER(%s) OR LOWER(name) = LOWER(%s)
        LIMIT 1
        """,
        (code, name),
    )
    row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Team not found: {team_input}")
    return row


def _create_access_token(subject: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=JWT_EXPIRES_MINUTES)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _resolve_user_permissions(cursor: Any, user_row: dict[str, Any]) -> dict[str, Any]:
    role_templates = _get_config_value(cursor, "role_templates", _default_role_templates())
    base_template = role_templates.get(user_row["role"], _default_role_template())
    stored = user_row.get("permissions") or {}
    custom_permissions = bool(stored.get("customPermissions"))

    permissions = {**base_template}
    if custom_permissions:
        permissions.update({k: v for k, v in stored.items() if k != "customPermissions"})
    else:
        # Keep data scopes from stored user record while permissions follow role template.
        if isinstance(stored.get("allowedWards"), list):
            permissions["allowedWards"] = stored.get("allowedWards")
        if isinstance(stored.get("allowedTeams"), list):
            permissions["allowedTeams"] = stored.get("allowedTeams")

    if user_row["role"] == "Junior Doctor" and not permissions.get("allowedTeams"):
        cursor.execute(
            """
            SELECT t.name, t.code
            FROM staff s
            JOIN teams t ON t.id = s.team_id
            WHERE s.id = %s
            LIMIT 1
            """,
            (user_row.get("linked_staff_id"),),
        )
        team_row = cursor.fetchone()
        if team_row:
            permissions["allowedTeams"] = [team_row["name"], team_row["code"]]

    permissions["customPermissions"] = custom_permissions
    return permissions


def _verify_password_and_upgrade(cursor: Any, user_id: str, provided_password: str, stored_hash: str) -> bool:
    if not stored_hash:
        return False

    if stored_hash.startswith("$2"):
        try:
            return bcrypt.checkpw(provided_password.encode("utf-8"), stored_hash.encode("utf-8"))
        except ValueError:
            return False

    legacy_hash = hashlib.sha256(provided_password.encode("utf-8")).hexdigest()
    if legacy_hash != stored_hash:
        return False

    upgraded_hash = bcrypt.hashpw(provided_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    cursor.execute(
        "UPDATE system_users SET password_hash = %s, updated_at = now() WHERE id = %s",
        (upgraded_hash, user_id),
    )
    return True


def _hash_otp_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def _hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _send_otp_email(recipient_email: str, code: str) -> tuple[bool, str]:
    if not SMTP_HOST:
        if OTP_DEV_FALLBACK:
            return False, "smtp_not_configured"
        raise HTTPException(status_code=500, detail="SMTP is not configured")

    msg = EmailMessage()
    msg["Subject"] = "WardFlow OTP Verification"
    msg["From"] = SMTP_FROM_EMAIL
    msg["To"] = recipient_email
    msg.set_content(
        "Your WardFlow verification code is: "
        f"{code}\n\n"
        f"This code expires in {OTP_EXPIRES_MINUTES} minutes."
    )

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
            if SMTP_USE_TLS:
                server.starttls()
            if SMTP_USERNAME:
                server.login(SMTP_USERNAME, SMTP_PASSWORD)
            server.send_message(msg)
        return True, "sent"
    except Exception as exc:
        if OTP_DEV_FALLBACK:
            return False, f"smtp_failed:{exc.__class__.__name__}"
        raise HTTPException(status_code=502, detail="Failed to send OTP email") from exc


def _send_password_reset_email(recipient_email: str, token: str) -> tuple[bool, str]:
    if not SMTP_HOST:
        if OTP_DEV_FALLBACK:
            return False, "smtp_not_configured"
        raise HTTPException(status_code=500, detail="SMTP is not configured")

    msg = EmailMessage()
    msg["Subject"] = "WardFlow Password Reset"
    msg["From"] = SMTP_FROM_EMAIL
    msg["To"] = recipient_email
    msg.set_content(
        "You requested a WardFlow password reset.\n\n"
        f"Reset token: {token}\n\n"
        f"This token expires in {RESET_TOKEN_EXPIRES_MINUTES} minutes and can be used once."
    )

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
            if SMTP_USE_TLS:
                server.starttls()
            if SMTP_USERNAME:
                server.login(SMTP_USERNAME, SMTP_PASSWORD)
            server.send_message(msg)
        return True, "sent"
    except Exception as exc:
        if OTP_DEV_FALLBACK:
            return False, f"smtp_failed:{exc.__class__.__name__}"
        raise HTTPException(status_code=502, detail="Failed to send password reset email") from exc


def _ensure_auth_columns(cursor: Any) -> None:
    cursor.execute("ALTER TABLE system_users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false")
    cursor.execute("ALTER TABLE system_users ADD COLUMN IF NOT EXISTS otp_required boolean NOT NULL DEFAULT false")
    cursor.execute("ALTER TABLE system_users ADD COLUMN IF NOT EXISTS otp_code_hash text NULL")
    cursor.execute("ALTER TABLE system_users ADD COLUMN IF NOT EXISTS otp_expires_at timestamptz NULL")
    cursor.execute("ALTER TABLE system_users ADD COLUMN IF NOT EXISTS otp_verified_at timestamptz NULL")
    cursor.execute("ALTER TABLE system_users ADD COLUMN IF NOT EXISTS otp_requested_at timestamptz NULL")
    cursor.execute("ALTER TABLE system_users ADD COLUMN IF NOT EXISTS pwd_reset_token_hash text NULL")
    cursor.execute("ALTER TABLE system_users ADD COLUMN IF NOT EXISTS pwd_reset_expires_at timestamptz NULL")
    cursor.execute("ALTER TABLE system_users ADD COLUMN IF NOT EXISTS pwd_reset_requested_at timestamptz NULL")
    cursor.execute("ALTER TABLE system_users ADD COLUMN IF NOT EXISTS pwd_reset_used_at timestamptz NULL")


def _ensure_bootstrap_admin_users(cursor: Any) -> None:
    if not BOOTSTRAP_ADMIN_EMAILS:
        return

    for email in BOOTSTRAP_ADMIN_EMAILS:
        normalized_email = email.strip().lower()
        if not normalized_email:
            continue

        cursor.execute(
            "SELECT 1 FROM system_users WHERE LOWER(email) = LOWER(%s) LIMIT 1",
            (normalized_email,),
        )
        if cursor.fetchone():
            continue

        password_hash = bcrypt.hashpw(BOOTSTRAP_ADMIN_PASSWORD.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        cursor.execute(
            """
            INSERT INTO system_users (email, password_hash, role, linked_staff_id, permissions, must_change_password, otp_required)
            VALUES (%s, %s, %s, NULL, %s::jsonb, false, false)
            """,
            (normalized_email, password_hash, "System Admin", "{}"),
        )


def ensure_auth_schema() -> None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            _ensure_auth_columns(cursor)
            _ensure_bootstrap_admin_users(cursor)


def _ensure_audit_table(cursor: Any) -> None:
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_log (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            action_type text NOT NULL,
            target_id text NULL,
            details jsonb NOT NULL DEFAULT '{}'::jsonb,
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    cursor.execute("ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_email text NULL")
    cursor.execute("ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'SYSTEM'")
    cursor.execute("ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'SUCCESS'")
    cursor.execute("ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS request_id text NULL")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_action_type ON audit_log(action_type)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_actor_email ON audit_log(actor_email)")


def ensure_audit_schema() -> None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            _ensure_audit_table(cursor)


def _issue_otp_challenge(cursor: Any, user_id: str, recipient_email: str) -> dict[str, Any]:
    code = f"{secrets.randbelow(1_000_000):06d}"
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=OTP_EXPIRES_MINUTES)

    cursor.execute(
        """
        UPDATE system_users
        SET otp_code_hash = %s,
            otp_expires_at = %s,
            otp_verified_at = NULL,
            otp_requested_at = now(),
            updated_at = now()
        WHERE id = %s
        """,
        (_hash_otp_code(code), expires_at, user_id),
    )

    delivered, channel = _send_otp_email(recipient_email, code)
    payload: dict[str, Any] = {
        "otpRequired": True,
        "otpDelivery": "smtp" if delivered else "development-fallback",
        "otpExpiresMinutes": OTP_EXPIRES_MINUTES,
        "otpChannel": channel,
    }
    if not delivered and OTP_DEV_FALLBACK:
        payload["devOtpCode"] = code
    return payload


def _resolve_current_user(authorization: str | None = Header(default=None), allow_unverified_otp: bool = False) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")

    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except InvalidTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc

    subject = payload.get("sub")
    if not subject:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject")

    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT u.id, u.email, u.role, u.permissions, u.linked_staff_id, u.otp_required, s.full_name
                FROM system_users u
                LEFT JOIN staff s ON s.id = u.linked_staff_id
                WHERE LOWER(u.email) = LOWER(%s)
                LIMIT 1
                """,
                (subject,),
            )
            user = cursor.fetchone()
            if not user:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

            permissions = _resolve_user_permissions(cursor, user)

    if bool(user.get("otp_required")) and not allow_unverified_otp:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="OTP verification required")

    return {
        "id": str(user["id"]),
        "email": user["email"],
        "name": user["full_name"] or user["email"],
        "role": user["role"],
        "permissions": permissions,
    }


def require_current_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    return _resolve_current_user(authorization=authorization, allow_unverified_otp=False)


def require_current_user_allow_unverified_otp(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    return _resolve_current_user(authorization=authorization, allow_unverified_otp=True)


def _write_security_denied_audit(
    current_user: dict[str, Any],
    *,
    action_type: str,
    details: dict[str, Any],
) -> None:
    try:
        with get_connection() as audit_connection:
            with audit_connection.cursor(row_factory=dict_row) as audit_cursor:
                _ensure_audit_table(audit_cursor)
                _write_audit(
                    audit_cursor,
                    action_type,
                    current_user.get("email", "unknown"),
                    details,
                    actor_email=current_user.get("email"),
                    category="SECURITY",
                    outcome="DENIED",
                )
    except Exception:
        # Authorization should still fail even if audit persistence fails.
        pass


def _require_permission(current_user: dict[str, Any], permission_key: str, *, action: str | None = None) -> None:
    if not current_user.get("permissions", {}).get(permission_key):
        if action:
            _write_security_denied_audit(
                current_user,
                action_type="SECURITY_PERMISSION_DENIED",
                details={
                    "action": action,
                    "missing_permission": permission_key,
                    "reason": "missing_permission",
                },
            )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Missing permission: {permission_key}",
        )


def _require_any_permission(current_user: dict[str, Any], permission_keys: list[str], *, action: str | None = None) -> None:
    permissions = current_user.get("permissions", {}) or {}
    if any(bool(permissions.get(key)) for key in permission_keys):
        return
    if action:
        _write_security_denied_audit(
            current_user,
            action_type="SECURITY_PERMISSION_DENIED",
            details={
                "action": action,
                "required_any_permission": permission_keys,
                "reason": "missing_required_permissions",
            },
        )
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Missing one of required permissions: {', '.join(permission_keys)}",
    )


def _resolve_ward(cursor: Any, ward_name: str) -> dict[str, Any]:
    cursor.execute(
        """
        SELECT id, name, bed_capacity
        FROM wards
        WHERE LOWER(name) = LOWER(%s)
        LIMIT 1
        """,
        (ward_name.strip(),),
    )
    row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Ward not found: {ward_name}")
    return row


def _next_patient_code(cursor: Any) -> str:
    cursor.execute(
        """
        SELECT COALESCE(MAX(patient_code::int), 0) AS max_code
        FROM patients
        WHERE patient_code ~ '^[0-9]+$'
        """
    )
    next_code = int(cursor.fetchone()["max_code"]) + 1
    return str(next_code).zfill(3)


def _next_available_bed(cursor: Any, ward_id: str, bed_capacity: int) -> str:
    cursor.execute(
        """
        SELECT bed_label
        FROM patients
        WHERE ward_id = %s AND discharged_at IS NULL
        """,
        (ward_id,),
    )
    occupied = set()
    for row in cursor.fetchall():
        label = str(row["bed_label"])
        if label.lower().startswith("bed "):
            try:
                occupied.add(int(label.split(" ")[1]))
            except (ValueError, IndexError):
                continue

    for num in range(1, bed_capacity + 1):
        if num not in occupied:
            return f"Bed {num}"

    raise HTTPException(status_code=409, detail="Ward is at full capacity")


def _get_patient_by_code(cursor: Any, patient_code: str) -> dict[str, Any]:
    cursor.execute(
        """
        SELECT
            p.id,
            p.patient_code,
            p.full_name,
            p.age,
            p.sex,
            p.bed_label,
            p.ward_id,
            p.team_id,
            p.discharged_at,
            p.created_at,
            p.updated_at,
            w.name AS ward_name,
            t.name AS team_name
        FROM patients p
        JOIN wards w ON w.id = p.ward_id
        JOIN teams t ON t.id = p.team_id
        WHERE p.patient_code = %s
        LIMIT 1
        """,
        (patient_code,),
    )
    row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Patient not found: {patient_code}")
    return row


def _write_audit(
    cursor: Any,
    action_type: str,
    target_id: str,
    details: dict[str, Any],
    actor_email: str | None = None,
    category: str = "SYSTEM",
    outcome: str = "SUCCESS",
    request_id: str | None = None,
) -> None:
    _ensure_audit_table(cursor)
    payload_details = details if isinstance(details, dict) else {"value": details}
    cursor.execute(
        """
        INSERT INTO audit_log (action_type, target_id, details, actor_email, category, outcome, request_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (action_type, target_id, Json(payload_details), actor_email, category, outcome, request_id),
    )


def _ensure_config_table(cursor: Any) -> None:
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS app_config (
            key text PRIMARY KEY,
            value jsonb NOT NULL DEFAULT '{}'::jsonb,
            updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )


def _get_config_value(cursor: Any, key: str, default_value: Any) -> Any:
    _ensure_config_table(cursor)
    cursor.execute("SELECT value FROM app_config WHERE key = %s", (key,))
    row = cursor.fetchone()
    if not row:
        return default_value
    return row["value"]


def _set_config_value(cursor: Any, key: str, value: Any) -> None:
    _ensure_config_table(cursor)
    cursor.execute(
        """
        INSERT INTO app_config (key, value, updated_at)
        VALUES (%s, %s, now())
        ON CONFLICT (key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = now()
        """,
        (key, Json(value)),
    )


def _default_role_template() -> dict[str, Any]:
    return {
        "viewGlobalPatients": False,
        "allowedWards": [],
        "allowedTeams": [],
        "admit": False,
        "discharge": False,
        "transfer": False,
        "logTreatment": False,
        "exportData": False,
        "manageSystem": False,
        "manageStaff": False,
        "manageAccounts": False,
        "manageWards": False,
        "viewReports": False,
        "bedMatrix": True,
    }


def _default_role_templates() -> dict[str, Any]:
    return {
        "System Admin": {
            "viewGlobalPatients": True,
            "allowedWards": [],
            "allowedTeams": [],
            "admit": True,
            "discharge": True,
            "transfer": True,
            "logTreatment": True,
            "exportData": True,
            "manageSystem": True,
            "manageStaff": True,
            "manageAccounts": True,
            "manageWards": True,
            "viewReports": True,
            "bedMatrix": True,
        },
        "Consultant": {
            "viewGlobalPatients": True,
            "allowedWards": [],
            "allowedTeams": [],
            "admit": True,
            "discharge": True,
            "transfer": True,
            "logTreatment": True,
            "exportData": False,
            "manageSystem": False,
            "manageStaff": False,
            "manageAccounts": False,
            "manageWards": False,
            "viewReports": True,
            "bedMatrix": True,
        },
        "Junior Doctor": {
            "viewGlobalPatients": False,
            "allowedWards": [],
            "allowedTeams": [],
            "admit": False,
            "discharge": False,
            "transfer": False,
            "logTreatment": True,
            "exportData": False,
            "manageSystem": False,
            "manageStaff": False,
            "manageAccounts": False,
            "manageWards": False,
            "viewReports": False,
            "bedMatrix": True,
        },
        "Ward Manager": {
            "viewGlobalPatients": False,
            "allowedWards": [],
            "allowedTeams": [],
            "admit": True,
            "discharge": False,
            "transfer": True,
            "logTreatment": False,
            "exportData": True,
            "manageSystem": False,
            "manageStaff": False,
            "manageAccounts": False,
            "manageWards": True,
            "viewReports": True,
            "bedMatrix": True,
        },
    }


def _role_default_permissions_for_user(cursor: Any, role: str, linked_staff_id: str | None) -> dict[str, Any]:
    role_templates = _get_config_value(cursor, "role_templates", _default_role_templates())
    permissions = {**role_templates.get(role, _default_role_template())}

    if role == "Junior Doctor" and linked_staff_id:
        cursor.execute(
            """
            SELECT t.name, t.code
            FROM staff s
            JOIN teams t ON t.id = s.team_id
            WHERE s.id = %s
            LIMIT 1
            """,
            (linked_staff_id,),
        )
        team_row = cursor.fetchone()
        if team_row:
            permissions["allowedTeams"] = [team_row["name"], team_row["code"]]

    permissions["customPermissions"] = False
    return permissions


def _resolve_system_user_by_email(cursor: Any, email: str) -> dict[str, Any]:
    cursor.execute(
        """
        SELECT
            u.id,
            u.email,
            u.role,
            u.permissions,
            u.linked_staff_id,
            u.must_change_password,
            u.otp_required,
            s.full_name,
            s.title,
            t.name AS team_name,
            t.code AS team_code
        FROM system_users u
        LEFT JOIN staff s ON s.id = u.linked_staff_id
        LEFT JOIN teams t ON t.id = s.team_id
        WHERE LOWER(u.email) = LOWER(%s)
        LIMIT 1
        """,
        (email.strip().lower(),),
    )
    row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"User not found: {email}")
    return row


def _serialize_system_user(cursor: Any, user_row: dict[str, Any]) -> dict[str, Any]:
    permissions = _resolve_user_permissions(cursor, user_row)
    custom_permissions = bool(permissions.get("customPermissions"))
    return {
        "id": str(user_row["id"]),
        "email": user_row["email"],
        "name": user_row.get("full_name") or user_row["email"],
        "role": user_row["role"],
        "permissions": permissions,
        "customPermissions": custom_permissions,
        "linked_staff_id": str(user_row["linked_staff_id"]) if user_row.get("linked_staff_id") else None,
        "staff_title": user_row.get("title"),
        "team": user_row.get("team_name"),
        "mustChangePassword": bool(user_row.get("must_change_password")),
        "otpRequired": bool(user_row.get("otp_required")),
    }


def _normalize_patient_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "patient_code": row["patient_code"],
        "full_name": row["full_name"],
        "age": row["age"],
        "sex": row["sex"],
        "ward": row["ward_name"],
        "bed_label": row["bed_label"],
        "team": row["team_name"],
        "discharged_at": row["discharged_at"].isoformat() if row["discharged_at"] else None,
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
    }


def _build_lower_in_clause(column_expr: str, values: list[str]) -> tuple[str | None, list[Any]]:
    if not values:
        return None, []

    placeholders = ", ".join(["%s"] * len(values))
    return f"LOWER({column_expr}) IN ({placeholders})", values


def _normalize_scope_permissions(current_user: dict[str, Any]) -> tuple[bool, list[str], list[str], list[str]]:
    permissions = current_user.get("permissions", {}) or {}
    view_global = bool(permissions.get("viewGlobalPatients", False))

    allowed_wards = sorted(
        {
            str(name).strip().lower()
            for name in (permissions.get("allowedWards") or [])
            if str(name).strip()
        }
    )

    allowed_team_names: set[str] = set()
    allowed_team_codes: set[str] = set()
    for raw_value in permissions.get("allowedTeams") or []:
        value = str(raw_value).strip().lower()
        if not value:
            continue

        if value.startswith("team "):
            allowed_team_names.add(value)
            suffix = value.replace("team ", "", 1).strip()
            if suffix:
                allowed_team_codes.add(suffix)
        else:
            allowed_team_codes.add(value)
            allowed_team_names.add(f"team {value}")

    return view_global, allowed_wards, sorted(allowed_team_names), sorted(allowed_team_codes)


def _is_scope_allowed(current_user: dict[str, Any], ward_name: str | None, team_name: str | None) -> bool:
    view_global, allowed_wards, allowed_team_names, allowed_team_codes = _normalize_scope_permissions(current_user)
    if view_global:
        return True

    ward_value = str(ward_name or "").strip().lower()
    if ward_value and ward_value in allowed_wards:
        return True

    team_value = str(team_name or "").strip().lower()
    if team_value:
        team_code = team_value.replace("team ", "", 1).strip() if team_value.startswith("team ") else team_value
        if team_value in allowed_team_names or team_code in allowed_team_codes:
            return True

    return False


def _require_scope_allowed(
    current_user: dict[str, Any],
    *,
    cursor: Any | None = None,
    ward_name: str | None,
    team_name: str | None,
    action: str,
) -> None:
    if _is_scope_allowed(current_user, ward_name=ward_name, team_name=team_name):
        return

    # Write denied attempts in a separate transaction so they persist
    # even when the calling request is rejected and rolled back.
    try:
        with get_connection() as audit_connection:
            with audit_connection.cursor(row_factory=dict_row) as audit_cursor:
                _ensure_audit_table(audit_cursor)
                _write_audit(
                    audit_cursor,
                    "SECURITY_SCOPE_DENIED",
                    current_user.get("email", "unknown"),
                    {
                        "action": action,
                        "ward": ward_name,
                        "team": team_name,
                        "reason": "out_of_scope",
                    },
                    actor_email=current_user.get("email"),
                    category="SECURITY",
                    outcome="DENIED",
                )
    except Exception:
        # Do not block authorization rejection if audit write fails.
        pass

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Out of scope for {action}: allowed wards/teams do not include this target",
    )


@router.get("/health")
def api_health() -> dict:
    return {"success": True, "service": "wardflow-api"}


@router.post("/auth/login")
def login(payload: LoginPayload) -> dict:
    email = payload.email.strip().lower()
    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT u.id, u.email, u.role, u.password_hash, u.permissions, u.linked_staff_id, u.must_change_password, u.otp_required, s.full_name
                FROM system_users u
                LEFT JOIN staff s ON s.id = u.linked_staff_id
                WHERE LOWER(u.email) = LOWER(%s)
                LIMIT 1
                """,
                (email,),
            )
            user = cursor.fetchone()
            if not user or not _verify_password_and_upgrade(cursor, user["id"], payload.password, user["password_hash"]):
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

            permissions = _resolve_user_permissions(cursor, user)
            token = _create_access_token(user["email"])
            requires_password_change = bool(user.get("must_change_password"))
            requires_otp = (bool(user.get("otp_required")) or OTP_ALWAYS_REQUIRED) and not requires_password_change

    return {
        "success": True,
        "data": {
            "token": token,
            "requiresPasswordChange": requires_password_change,
            "requiresOtp": requires_otp,
            "user": {
                "email": user["email"],
                "name": user["full_name"] or user["email"],
                "role": user["role"],
                "permissions": permissions,
                "customPermissions": bool(permissions.get("customPermissions")),
            },
        },
    }


@router.post("/auth/change-password")
def change_password(
    payload: ChangePasswordPayload,
    current_user: dict[str, Any] = Depends(require_current_user),
) -> dict:
    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT id, email, password_hash
                FROM system_users
                WHERE LOWER(email) = LOWER(%s)
                LIMIT 1
                """,
                (current_user["email"],),
            )
            user = cursor.fetchone()
            if not user:
                raise HTTPException(status_code=404, detail="User not found")

            if not _verify_password_and_upgrade(cursor, user["id"], payload.current_password, user["password_hash"]):
                raise HTTPException(status_code=401, detail="Current password is incorrect")

            new_password_hash = bcrypt.hashpw(payload.new_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
            cursor.execute(
                """
                UPDATE system_users
                SET password_hash = %s,
                    must_change_password = false,
                    otp_required = true,
                    updated_at = now()
                WHERE id = %s
                """,
                (new_password_hash, user["id"]),
            )

            otp_payload = _issue_otp_challenge(cursor, user["id"], user["email"])
            _write_audit(
                cursor,
                "ACCOUNT_PASSWORD_CHANGE",
                user["email"],
                {"changed_by": current_user["email"]},
                actor_email=current_user["email"],
                category="AUTH",
            )

    return {"success": True, "data": otp_payload}


@router.post("/auth/request-otp")
def request_otp(current_user: dict[str, Any] = Depends(require_current_user_allow_unverified_otp)) -> dict:
    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                "SELECT id, email, otp_requested_at FROM system_users WHERE LOWER(email) = LOWER(%s) LIMIT 1",
                (current_user["email"],),
            )
            user = cursor.fetchone()
            if not user:
                raise HTTPException(status_code=404, detail="User not found")

            requested_at = user.get("otp_requested_at")
            if requested_at:
                elapsed = (datetime.now(timezone.utc) - requested_at).total_seconds()
                if elapsed < OTP_RESEND_MIN_SECONDS:
                    remaining = max(1, int(OTP_RESEND_MIN_SECONDS - elapsed))
                    raise HTTPException(
                        status_code=429,
                        detail=f"Please wait {remaining}s before requesting another OTP",
                    )

            otp_payload = _issue_otp_challenge(cursor, user["id"], user["email"])
            _write_audit(
                cursor,
                "OTP_REQUEST",
                user["email"],
                {"requested_by": current_user["email"]},
                actor_email=current_user["email"],
                category="AUTH",
            )

    return {"success": True, "data": otp_payload}


@router.post("/auth/verify-otp")
def verify_otp(payload: VerifyOtpPayload, current_user: dict[str, Any] = Depends(require_current_user_allow_unverified_otp)) -> dict:
    code_hash = _hash_otp_code(payload.otp_code.strip())
    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT id, email, otp_code_hash, otp_expires_at
                FROM system_users
                WHERE LOWER(email) = LOWER(%s)
                LIMIT 1
                """,
                (current_user["email"],),
            )
            user = cursor.fetchone()
            if not user:
                raise HTTPException(status_code=404, detail="User not found")

            if not user.get("otp_code_hash") or not user.get("otp_expires_at"):
                raise HTTPException(status_code=400, detail="No active OTP challenge")

            expires_at = user["otp_expires_at"]
            if expires_at <= datetime.now(timezone.utc):
                raise HTTPException(status_code=400, detail="OTP has expired")

            if not hmac.compare_digest(str(user["otp_code_hash"]), code_hash):
                raise HTTPException(status_code=400, detail="Invalid OTP code")

            cursor.execute(
                """
                UPDATE system_users
                SET otp_verified_at = now(),
                    otp_required = false,
                    otp_code_hash = NULL,
                    otp_expires_at = NULL,
                    updated_at = now()
                WHERE id = %s
                """,
                (user["id"],),
            )
            _write_audit(
                cursor,
                "OTP_VERIFY",
                user["email"],
                {"verified_by": current_user["email"]},
                actor_email=current_user["email"],
                category="AUTH",
            )

    return {"success": True, "data": {"otpVerified": True}}


@router.post("/auth/forgot-password/request")
def forgot_password_request(payload: ForgotPasswordRequestPayload) -> dict:
    normalized_email = payload.email.strip().lower()

    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT id, email, pwd_reset_requested_at
                FROM system_users
                WHERE LOWER(email) = LOWER(%s)
                LIMIT 1
                """,
                (normalized_email,),
            )
            user = cursor.fetchone()

            if not user:
                return {
                    "success": True,
                    "data": {
                        "message": "If the account exists, a password reset token has been sent.",
                    },
                }

            requested_at = user.get("pwd_reset_requested_at")
            if requested_at:
                elapsed = (datetime.now(timezone.utc) - requested_at).total_seconds()
                if elapsed < RESET_REQUEST_MIN_SECONDS:
                    remaining = max(1, int(RESET_REQUEST_MIN_SECONDS - elapsed))
                    raise HTTPException(
                        status_code=429,
                        detail=f"Please wait {remaining}s before requesting another password reset",
                    )

            reset_token = secrets.token_urlsafe(24)
            reset_expires_at = datetime.now(timezone.utc) + timedelta(minutes=RESET_TOKEN_EXPIRES_MINUTES)

            cursor.execute(
                """
                UPDATE system_users
                SET pwd_reset_token_hash = %s,
                    pwd_reset_expires_at = %s,
                    pwd_reset_requested_at = now(),
                    pwd_reset_used_at = NULL,
                    updated_at = now()
                WHERE id = %s
                """,
                (_hash_reset_token(reset_token), reset_expires_at, user["id"]),
            )

            _send_password_reset_email(user["email"], reset_token)
            _write_audit(
                cursor,
                "PASSWORD_RESET_REQUEST",
                user["email"],
                {"channel": "email"},
                actor_email=user["email"],
                category="AUTH",
            )

    return {
        "success": True,
        "data": {
            "message": "If the account exists, a password reset token has been sent.",
        },
    }


@router.post("/auth/forgot-password/confirm")
def forgot_password_confirm(payload: ForgotPasswordConfirmPayload) -> dict:
    normalized_email = payload.email.strip().lower()
    provided_hash = _hash_reset_token(payload.reset_token.strip())

    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT id, email, pwd_reset_token_hash, pwd_reset_expires_at, pwd_reset_used_at
                FROM system_users
                WHERE LOWER(email) = LOWER(%s)
                LIMIT 1
                """,
                (normalized_email,),
            )
            user = cursor.fetchone()
            if not user:
                raise HTTPException(status_code=400, detail="Invalid reset token or email")

            if user.get("pwd_reset_used_at"):
                raise HTTPException(status_code=400, detail="Reset token has already been used")
            if not user.get("pwd_reset_token_hash") or not user.get("pwd_reset_expires_at"):
                raise HTTPException(status_code=400, detail="No active password reset request")
            if user["pwd_reset_expires_at"] <= datetime.now(timezone.utc):
                raise HTTPException(status_code=400, detail="Reset token has expired")

            if not hmac.compare_digest(str(user["pwd_reset_token_hash"]), provided_hash):
                raise HTTPException(status_code=400, detail="Invalid reset token or email")

            new_password_hash = bcrypt.hashpw(payload.new_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
            cursor.execute(
                """
                UPDATE system_users
                SET password_hash = %s,
                    must_change_password = false,
                    otp_required = false,
                    otp_code_hash = NULL,
                    otp_expires_at = NULL,
                    pwd_reset_used_at = now(),
                    pwd_reset_token_hash = NULL,
                    pwd_reset_expires_at = NULL,
                    updated_at = now()
                WHERE id = %s
                """,
                (new_password_hash, user["id"]),
            )

            _write_audit(
                cursor,
                "PASSWORD_RESET_CONFIRM",
                user["email"],
                {"method": "token"},
                actor_email=user["email"],
                category="AUTH",
            )

    return {"success": True, "data": {"passwordReset": True}}


@router.get("/auth/me")
def auth_me(current_user: dict[str, Any] = Depends(require_current_user)) -> dict:
    return {"success": True, "data": current_user}


@router.get("/db-health")
def db_health(_auth: dict[str, Any] = Depends(require_current_user)) -> dict:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_database() AS db_name, current_user AS db_user")
            row = cursor.fetchone()

    return {"success": True, "database": row[0], "user": row[1]}


@router.get("/stats")
def get_stats(_auth: dict[str, Any] = Depends(require_current_user)) -> dict:
    """Return today's admission, discharge, and transfer counts from the database.
    'Today' is evaluated in the database server's local time zone.
    Admissions  = patients whose created_at    is today and are still active (not discharged).
    Discharged  = patients whose discharged_at is today.
    Transfers   = audit log entries of type PATIENT_TRANSFER logged today.
    """
    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT
                    COUNT(*) FILTER (
                        WHERE created_at    >= date_trunc('day', now())
                          AND discharged_at IS NULL
                    )::int AS admissions_today,

                    COUNT(*) FILTER (
                        WHERE discharged_at >= date_trunc('day', now())
                    )::int AS discharged_today,

                    (
                        SELECT COUNT(*)::int
                        FROM audit_log
                        WHERE action_type = 'PATIENT_TRANSFER'
                          AND created_at  >= date_trunc('day', now())
                    ) AS transfers_today
                FROM patients
                """
            )
            row = cursor.fetchone()

    return {
        "success": True,
        "data": {
            "admissionsToday": row["admissions_today"],
            "dischargedToday": row["discharged_today"],
            "transfersToday":  row["transfers_today"],
        },
    }


@router.get("/audit-log")
def get_audit_log(
    current_user: dict[str, Any] = Depends(require_current_user),
    action_type: str | None = Query(default=None),
    actor_email: str | None = Query(default=None),
    target_id: str | None = Query(default=None),
    category: str | None = Query(default=None),
    outcome: str | None = Query(default=None),
    query: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict:
    _require_any_permission(
        current_user,
        ["manageSystem", "manageAccounts", "viewReports"],
        action="read audit log",
    )

    filters: list[str] = []
    params: list[Any] = []

    if action_type:
        filters.append("LOWER(action_type) = LOWER(%s)")
        params.append(action_type)
    if actor_email:
        filters.append("LOWER(COALESCE(actor_email, '')) = LOWER(%s)")
        params.append(actor_email)
    if target_id:
        filters.append("LOWER(COALESCE(target_id, '')) LIKE LOWER(%s)")
        params.append(f"%{target_id}%")
    if category:
        filters.append("LOWER(category) = LOWER(%s)")
        params.append(category)
    if outcome:
        filters.append("LOWER(outcome) = LOWER(%s)")
        params.append(outcome)
    if query:
        filters.append("(details::text ILIKE %s OR target_id ILIKE %s OR action_type ILIKE %s OR actor_email ILIKE %s)")
        like = f"%{query}%"
        params.extend([like, like, like, like])

    where_sql = f"WHERE {' AND '.join(filters)}" if filters else ""

    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            _ensure_audit_table(cursor)
            cursor.execute(
                f"""
                SELECT COUNT(*)::int AS total
                FROM audit_log
                {where_sql}
                """,
                params,
            )
            total = cursor.fetchone()["total"]

            cursor.execute(
                f"""
                SELECT id, action_type, target_id, details, actor_email, category, outcome, request_id, created_at
                FROM audit_log
                {where_sql}
                ORDER BY created_at DESC
                LIMIT %s OFFSET %s
                """,
                params + [limit, offset],
            )
            rows = cursor.fetchall()

    data = [
        {
            "id": str(row["id"]),
            "action_type": row["action_type"],
            "target_id": row["target_id"],
            "actor_email": row.get("actor_email"),
            "category": row.get("category"),
            "outcome": row.get("outcome"),
            "request_id": row.get("request_id"),
            "details": row.get("details") or {},
            "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
        }
        for row in rows
    ]

    return {
        "success": True,
        "data": data,
        "meta": {
            "total": total,
            "limit": limit,
            "offset": offset,
        },
    }


@router.get("/users")
def list_system_users(current_user: dict[str, Any] = Depends(require_current_user)) -> dict:
    _require_permission(current_user, "manageAccounts")
    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT
                    u.id,
                    u.email,
                    u.role,
                    u.permissions,
                    u.linked_staff_id,
                    u.must_change_password,
                    u.otp_required,
                    s.full_name,
                    s.title,
                    t.name AS team_name,
                    t.code AS team_code
                FROM system_users u
                LEFT JOIN staff s ON s.id = u.linked_staff_id
                LEFT JOIN teams t ON t.id = s.team_id
                ORDER BY u.role ASC, COALESCE(s.full_name, u.email) ASC
                """
            )
            users = [_serialize_system_user(cursor, row) for row in cursor.fetchall()]

    return {"success": True, "data": users}


@router.post("/users")
def create_system_user(payload: CreateUserPayload, current_user: dict[str, Any] = Depends(require_current_user)) -> dict:
    _require_permission(current_user, "manageAccounts")
    email = payload.email.strip().lower()
    role = payload.role.strip()
    linked_staff_name = payload.linked_staff_name.strip()

    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute("SELECT 1 FROM system_users WHERE LOWER(email) = LOWER(%s) LIMIT 1", (email,))
            if cursor.fetchone():
                raise HTTPException(status_code=409, detail="An account with this email already exists")

            available_roles = _get_config_value(
                cursor,
                "available_roles",
                ["Consultant", "Junior Doctor", "Ward Manager", "System Admin"],
            )
            if role not in available_roles:
                raise HTTPException(status_code=400, detail=f"Unknown role: {role}")

            cursor.execute(
                """
                SELECT s.id
                FROM staff s
                WHERE LOWER(s.full_name) = LOWER(%s)
                LIMIT 1
                """,
                (linked_staff_name,),
            )
            staff = cursor.fetchone()
            if not staff:
                raise HTTPException(status_code=404, detail=f"Staff member not found: {linked_staff_name}")

            permissions = _role_default_permissions_for_user(cursor, role, str(staff["id"]))
            password_hash = bcrypt.hashpw(payload.password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

            cursor.execute(
                """
                INSERT INTO system_users (email, password_hash, role, linked_staff_id, permissions, must_change_password, otp_required)
                VALUES (%s, %s, %s, %s, %s, true, false)
                RETURNING id
                """,
                (email, password_hash, role, staff["id"], Json(permissions)),
            )
            created_id = cursor.fetchone()["id"]

            _write_audit(
                cursor,
                "ACCOUNT_CREATE",
                email,
                {
                    "role": role,
                    "linked_staff_name": linked_staff_name,
                    "created_by": current_user["email"],
                },
                actor_email=current_user["email"],
                category="ACCOUNT",
            )

            cursor.execute(
                """
                SELECT
                    u.id,
                    u.email,
                    u.role,
                    u.permissions,
                    u.linked_staff_id,
                    u.must_change_password,
                    u.otp_required,
                    s.full_name,
                    s.title,
                    t.name AS team_name,
                    t.code AS team_code
                FROM system_users u
                LEFT JOIN staff s ON s.id = u.linked_staff_id
                LEFT JOIN teams t ON t.id = s.team_id
                WHERE u.id = %s
                LIMIT 1
                """,
                (created_id,),
            )
            created_user = cursor.fetchone()
            serialized_user = _serialize_system_user(cursor, created_user)

            return {"success": True, "data": serialized_user}


@router.delete("/users/{email}")
def delete_system_user(email: str, current_user: dict[str, Any] = Depends(require_current_user)) -> dict:
    _require_permission(current_user, "manageAccounts")
    normalized_email = email.strip().lower()
    if normalized_email == current_user["email"].strip().lower():
        raise HTTPException(status_code=409, detail="You cannot delete your own active account")

    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            user = _resolve_system_user_by_email(cursor, normalized_email)
            cursor.execute("DELETE FROM system_users WHERE id = %s", (user["id"],))
            _write_audit(
                cursor,
                "ACCOUNT_REVOKE",
                user["email"],
                {"revoked_by": current_user["email"]},
                actor_email=current_user["email"],
                category="ACCOUNT",
            )

    return {"success": True, "message": f"System access revoked for {normalized_email}"}


@router.patch("/users/{email}/password")
def reset_system_user_password(
    email: str,
    payload: ResetUserPasswordPayload,
    current_user: dict[str, Any] = Depends(require_current_user),
) -> dict:
    _require_permission(current_user, "manageAccounts")
    normalized_email = email.strip().lower()
    password_hash = bcrypt.hashpw(payload.new_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            user = _resolve_system_user_by_email(cursor, normalized_email)
            cursor.execute(
                """
                UPDATE system_users
                SET password_hash = %s,
                    updated_at = now()
                WHERE id = %s
                """,
                (password_hash, user["id"]),
            )
            _write_audit(
                cursor,
                "ACCOUNT_PASSWORD_RESET",
                user["email"],
                {"reset_by": current_user["email"]},
                actor_email=current_user["email"],
                category="ACCOUNT",
            )

    return {"success": True, "message": f"Password updated for {normalized_email}"}


@router.post("/users/{email}/reset-permissions")
def reset_system_user_permissions(email: str, current_user: dict[str, Any] = Depends(require_current_user)) -> dict:
    _require_permission(current_user, "manageAccounts")
    normalized_email = email.strip().lower()

    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            user = _resolve_system_user_by_email(cursor, normalized_email)
            reset_permissions = _role_default_permissions_for_user(cursor, user["role"], user.get("linked_staff_id"))
            cursor.execute(
                """
                UPDATE system_users
                SET permissions = %s,
                    updated_at = now()
                WHERE id = %s
                """,
                (Json(reset_permissions), user["id"]),
            )

            _write_audit(
                cursor,
                "SECURITY_UPDATE",
                user["email"],
                {"action": "reset_to_role_defaults", "updated_by": current_user["email"]},
                actor_email=current_user["email"],
                category="SECURITY",
            )

            updated_user = _resolve_system_user_by_email(cursor, normalized_email)
            serialized_user = _serialize_system_user(cursor, updated_user)

            return {"success": True, "data": serialized_user}


@router.patch("/users/{email}/permissions")
def update_system_user_permissions(
    email: str,
    payload: UserPermissionsPayload,
    current_user: dict[str, Any] = Depends(require_current_user),
) -> dict:
    _require_permission(current_user, "manageAccounts")
    normalized_email = email.strip().lower()

    permissions = payload.model_dump()
    permissions["customPermissions"] = bool(permissions.get("customPermissions", True))

    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            user = _resolve_system_user_by_email(cursor, normalized_email)
            cursor.execute(
                """
                UPDATE system_users
                SET permissions = %s,
                    updated_at = now()
                WHERE id = %s
                """,
                (Json(permissions), user["id"]),
            )

            _write_audit(
                cursor,
                "SECURITY_UPDATE",
                user["email"],
                {"action": "custom_permissions_update", "updated_by": current_user["email"]},
                actor_email=current_user["email"],
                category="SECURITY",
            )

            updated_user = _resolve_system_user_by_email(cursor, normalized_email)
            serialized_user = _serialize_system_user(cursor, updated_user)

            return {"success": True, "data": serialized_user}


@router.get("/wards")
def list_wards(current_user: dict[str, Any] = Depends(require_current_user)) -> dict:
    permissions = current_user.get("permissions", {}) or {}
    view_global, allowed_wards, allowed_team_names, allowed_team_codes = _normalize_scope_permissions(current_user)

    where_clauses: list[str] = []
    where_params: list[Any] = []

    if not view_global:
        scope_clauses: list[str] = []

        ward_clause, ward_params = _build_lower_in_clause("w.name", allowed_wards)
        if ward_clause:
            scope_clauses.append(ward_clause)
            where_params.extend(ward_params)

        team_parts: list[str] = []
        team_params: list[Any] = []

        team_name_clause, team_name_params = _build_lower_in_clause("t_scope.name", allowed_team_names)
        if team_name_clause:
            team_parts.append(team_name_clause)
            team_params.extend(team_name_params)

        team_code_clause, team_code_params = _build_lower_in_clause("t_scope.code", allowed_team_codes)
        if team_code_clause:
            team_parts.append(team_code_clause)
            team_params.extend(team_code_params)

        if team_parts:
            scope_clauses.append(
                """
                EXISTS (
                    SELECT 1
                    FROM patients p_scope
                    JOIN teams t_scope ON t_scope.id = p_scope.team_id
                    WHERE p_scope.ward_id = w.id
                      AND p_scope.discharged_at IS NULL
                      AND (
                """
                + " OR ".join(team_parts)
                + """
                      )
                )
                """
            )
            where_params.extend(team_params)

        if not allowed_wards and (allowed_team_names or allowed_team_codes) and (
            bool(permissions.get("admit")) or bool(permissions.get("transfer")) or bool(permissions.get("discharge"))
        ):
            # Keep active wards visible for team-scoped operational users,
            # even when no active patient is currently assigned to their team.
            scope_clauses.append("w.status = 'Active / Open'")

        if scope_clauses:
            where_clauses.append("(" + " OR ".join(scope_clauses) + ")")
        else:
            where_clauses.append("1 = 0")

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    query = """
        SELECT
            w.id,
            w.name,
            w.bed_capacity,
            w.status,
            COUNT(p.id)::int AS occupied_beds,
            json_agg(
                DISTINCT jsonb_build_object(
                    'patient_code', p.patient_code,
                    'full_name', p.full_name,
                    'bed_label', p.bed_label
                )
            ) FILTER (WHERE p.id IS NOT NULL) AS patients
        FROM wards w
        LEFT JOIN patients p
            ON p.ward_id = w.id
           AND p.discharged_at IS NULL
    """ + where_sql + """
        GROUP BY w.id, w.name, w.bed_capacity, w.status
        ORDER BY w.name
    """

    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(query, where_params)
            wards = []
            for row in cursor.fetchall():
                patients = row["patients"] or []
                wards.append(
                    {
                        "id": str(row["id"]),
                        "name": row["name"],
                        "beds": row["bed_capacity"],
                        "status": row["status"],
                        "occ": row["occupied_beds"],
                        "patients": patients,
                    }
                )

    return {"success": True, "data": wards}


@router.get("/teams")
def list_teams(current_user: dict[str, Any] = Depends(require_current_user)) -> dict:
    view_global, allowed_wards, allowed_team_names, allowed_team_codes = _normalize_scope_permissions(current_user)

    where_clauses: list[str] = []
    where_params: list[Any] = []

    if not view_global:
        scope_clauses: list[str] = []

        team_parts: list[str] = []
        team_params: list[Any] = []

        team_name_clause, team_name_params = _build_lower_in_clause("t.name", allowed_team_names)
        if team_name_clause:
            team_parts.append(team_name_clause)
            team_params.extend(team_name_params)

        team_code_clause, team_code_params = _build_lower_in_clause("t.code", allowed_team_codes)
        if team_code_clause:
            team_parts.append(team_code_clause)
            team_params.extend(team_code_params)

        if team_parts:
            scope_clauses.append("(" + " OR ".join(team_parts) + ")")
            where_params.extend(team_params)

        ward_clause, ward_params = _build_lower_in_clause("w_scope.name", allowed_wards)
        if ward_clause:
            scope_clauses.append(
                """
                EXISTS (
                    SELECT 1
                    FROM patients p_scope
                    JOIN wards w_scope ON w_scope.id = p_scope.ward_id
                    WHERE p_scope.team_id = t.id
                      AND p_scope.discharged_at IS NULL
                      AND """
                + ward_clause
                + """
                )
                """
            )
            where_params.extend(ward_params)

        if scope_clauses:
            where_clauses.append("(" + " OR ".join(scope_clauses) + ")")
        else:
            where_clauses.append("1 = 0")

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    query = """
        SELECT
            t.id,
            t.code,
            t.name,
            COALESCE(lead.full_name, '') AS lead_name,
            COALESCE(team_counts.patient_count, 0)::int AS patient_count,
            COALESCE(team_wards.wards, '[]'::jsonb) AS wards,
            COALESCE(team_patients.patients, '[]'::jsonb) AS patients
        FROM teams t
        LEFT JOIN staff lead ON lead.id = t.lead_staff_id
        LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS patient_count
            FROM patients p
            WHERE p.team_id = t.id
              AND p.discharged_at IS NULL
        ) AS team_counts ON TRUE
        LEFT JOIN LATERAL (
            SELECT jsonb_agg(
                jsonb_build_object('ward', ward_counts.ward_name, 'num', ward_counts.ward_count)
                ORDER BY ward_counts.ward_name
            ) AS wards
            FROM (
                SELECT w.name AS ward_name, COUNT(*)::int AS ward_count
                FROM patients p
                JOIN wards w ON w.id = p.ward_id
                WHERE p.team_id = t.id
                  AND p.discharged_at IS NULL
                GROUP BY w.name
            ) AS ward_counts
        ) AS team_wards ON TRUE
        LEFT JOIN LATERAL (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', patient_rows.id,
                    'patient_code', patient_rows.patient_code,
                    'name', patient_rows.full_name,
                    'ward', patient_rows.ward_name,
                    'bed', patient_rows.bed_label
                )
                ORDER BY patient_rows.created_at DESC, patient_rows.patient_code ASC
            ) AS patients
            FROM (
                SELECT p.id, p.patient_code, p.full_name, p.bed_label, p.created_at, w.name AS ward_name
                FROM patients p
                JOIN wards w ON w.id = p.ward_id
                WHERE p.team_id = t.id
                  AND p.discharged_at IS NULL
            ) AS patient_rows
        ) AS team_patients ON TRUE
    """ + where_sql + """
        ORDER BY t.name
    """

    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(query, where_params)
            teams = []
            for row in cursor.fetchall():
                wards = row["wards"] or []
                patients = row["patients"] or []
                teams.append(
                    {
                        "id": str(row["id"]),
                        "code": row["code"],
                        "name": row["name"],
                        "lead_name": row["lead_name"] or None,
                        "count": row["patient_count"],
                        "wards": wards,
                        "patients": patients,
                    }
                )

    return {"success": True, "data": teams}


@router.get("/staff")
def list_staff(current_user: dict[str, Any] = Depends(require_current_user)) -> dict:
    view_global, allowed_wards, allowed_team_names, allowed_team_codes = _normalize_scope_permissions(current_user)

    where_clauses: list[str] = []
    where_params: list[Any] = []

    if not view_global:
        scope_clauses: list[str] = []

        team_parts: list[str] = []
        team_params: list[Any] = []

        team_name_clause, team_name_params = _build_lower_in_clause("t.name", allowed_team_names)
        if team_name_clause:
            team_parts.append(team_name_clause)
            team_params.extend(team_name_params)

        team_code_clause, team_code_params = _build_lower_in_clause("t.code", allowed_team_codes)
        if team_code_clause:
            team_parts.append(team_code_clause)
            team_params.extend(team_code_params)

        if team_parts:
            scope_clauses.append("(" + " OR ".join(team_parts) + ")")
            where_params.extend(team_params)

        ward_clause, ward_params = _build_lower_in_clause("w_scope.name", allowed_wards)
        if ward_clause:
            scope_clauses.append(
                """
                EXISTS (
                    SELECT 1
                    FROM patients p_scope
                    JOIN wards w_scope ON w_scope.id = p_scope.ward_id
                    WHERE p_scope.team_id = s.team_id
                      AND p_scope.discharged_at IS NULL
                      AND """
                + ward_clause
                + """
                )
                """
            )
            where_params.extend(ward_params)

        if scope_clauses:
            where_clauses.append("(" + " OR ".join(scope_clauses) + ")")
        else:
            where_clauses.append("1 = 0")

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    query = """
        SELECT
            s.id,
            s.staff_code,
            s.full_name,
            s.title,
            s.grade,
            s.status,
            t.name AS team_name,
            t.code AS team_code
        FROM staff s
        LEFT JOIN teams t ON t.id = s.team_id
    """ + where_sql + """
        ORDER BY s.full_name
    """

    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(query, where_params)
            staff_members = [
                {
                    "id": str(row["id"]),
                    "staff_code": row["staff_code"],
                    "full_name": row["full_name"],
                    "title": row["title"],
                    "grade": row["grade"],
                    "status": row["status"],
                    "team_name": row["team_name"],
                    "team_code": row["team_code"],
                }
                for row in cursor.fetchall()
            ]

    return {"success": True, "data": staff_members}


@router.get("/patients")
def list_patients(
    current_user: dict[str, Any] = Depends(require_current_user),
    ward: str | None = Query(default=None),
    team: str | None = Query(default=None),
    q: str | None = Query(default=None, alias="query"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict:
    filters: list[str] = ["p.discharged_at IS NULL"]
    params: list[Any] = []

    view_global, allowed_wards, allowed_team_names, allowed_team_codes = _normalize_scope_permissions(current_user)
    if not view_global:
        allowed_team_names_set = set(allowed_team_names)
        allowed_team_codes_set = set(allowed_team_codes)

        scope_clauses: list[str] = []

        ward_clause, ward_params = _build_lower_in_clause("w.name", allowed_wards)
        if ward_clause:
            scope_clauses.append(ward_clause)
            params.extend(ward_params)

        if allowed_team_names_set or allowed_team_codes_set:
            team_parts: list[str] = []

            team_name_clause, team_name_params = _build_lower_in_clause("t.name", sorted(allowed_team_names_set))
            if team_name_clause:
                team_parts.append(team_name_clause)
                params.extend(team_name_params)

            team_code_clause, team_code_params = _build_lower_in_clause("t.code", sorted(allowed_team_codes_set))
            if team_code_clause:
                team_parts.append(team_code_clause)
                params.extend(team_code_params)

            scope_clauses.append(f"({' OR '.join(team_parts)})")

        if scope_clauses:
            filters.append(f"({' OR '.join(scope_clauses)})")
        else:
            filters.append("1 = 0")

    if ward:
        filters.append("LOWER(w.name) = LOWER(%s)")
        params.append(ward)

    if team:
        filters.append("(LOWER(t.name) = LOWER(%s) OR LOWER(t.code) = LOWER(%s) OR LOWER(t.name) = LOWER(CONCAT('Team ', %s)))")
        params.extend([team, team, team])

    if q:
        filters.append("(p.full_name ILIKE %s OR p.patient_code ILIKE %s OR w.name ILIKE %s OR t.name ILIKE %s)")
        like = f"%{q}%"
        params.extend([like, like, like, like])

    where_clause = " AND ".join(filters)

    query = f"""
        SELECT
            p.id,
            p.patient_code,
            p.full_name,
            p.age,
            p.sex,
            p.bed_label,
            p.discharged_at,
            p.created_at,
            p.updated_at,
            w.name AS ward_name,
            t.name AS team_name
        FROM patients p
        JOIN wards w ON w.id = p.ward_id
        JOIN teams t ON t.id = p.team_id
        WHERE {where_clause}
        ORDER BY p.created_at DESC, p.patient_code ASC
        LIMIT %s OFFSET %s
    """

    count_query = f"""
        SELECT COUNT(*)::int AS total
        FROM patients p
        JOIN wards w ON w.id = p.ward_id
        JOIN teams t ON t.id = p.team_id
        WHERE {where_clause}
    """

    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(count_query, params)
            total = cursor.fetchone()["total"]

            cursor.execute(query, params + [limit, offset])
            patients = [_normalize_patient_row(row) for row in cursor.fetchall()]

    return {
        "success": True,
        "data": patients,
        "meta": {
            "total": total,
            "limit": limit,
            "offset": offset,
        },
    }


@router.post("/patients")
def admit_patient(payload: AdmitPatientPayload, _auth: dict[str, Any] = Depends(require_current_user)) -> dict:
    _require_permission(_auth, "admit", action="patient admission")

    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            ward = _resolve_ward(cursor, payload.ward)
            team = _resolve_team(cursor, payload.team)

            _require_scope_allowed(
                _auth,
                cursor=cursor,
                ward_name=ward["name"],
                team_name=team["name"],
                action="patient admission",
            )

            cursor.execute(
                """
                SELECT COUNT(*)::int AS occupied
                FROM patients
                WHERE ward_id = %s
                  AND discharged_at IS NULL
                """,
                (ward["id"],),
            )
            occupied = int(cursor.fetchone()["occupied"])
            if occupied >= int(ward["bed_capacity"]):
                raise HTTPException(status_code=409, detail=f"{ward['name']} ward is full")

            bed_label = payload.bed_label.strip() if payload.bed_label else _next_available_bed(cursor, ward["id"], int(ward["bed_capacity"]))

            cursor.execute(
                """
                SELECT 1
                FROM patients
                WHERE ward_id = %s AND bed_label = %s AND discharged_at IS NULL
                LIMIT 1
                """,
                (ward["id"], bed_label),
            )
            if cursor.fetchone():
                raise HTTPException(status_code=409, detail=f"{bed_label} is already occupied in {ward['name']}")

            patient_code = _next_patient_code(cursor)
            try:
                cursor.execute(
                    """
                    INSERT INTO patients (patient_code, full_name, age, sex, ward_id, bed_label, team_id)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (patient_code, payload.full_name.strip(), payload.age, payload.sex.strip(), ward["id"], bed_label, team["id"]),
                )
            except psycopg_errors.UniqueViolation as exc:
                constraint = getattr(exc.diag, "constraint_name", "") or ""
                if "bed_label" in constraint or "ward_id" in constraint:
                    raise HTTPException(
                        status_code=409,
                        detail=f"Bed allocation race condition detected: {bed_label} in {ward['name']} was occupied by another admission. Please retry.",
                    )
                raise HTTPException(
                    status_code=409,
                    detail="Patient code conflict due to concurrent admissions. Please retry.",
                )

            _write_audit(
                cursor,
                "PATIENT_ADMIT",
                patient_code,
                {
                    "ward": ward["name"],
                    "team": team["name"],
                    "bed_label": bed_label,
                },
                actor_email=_auth["email"],
                category="CLINICAL",
            )

            row = _get_patient_by_code(cursor, patient_code)

    return {"success": True, "data": _normalize_patient_row(row)}


@router.patch("/patients/{patient_code}/transfer")
def transfer_patient(patient_code: str, payload: TransferPayload, _auth: dict[str, Any] = Depends(require_current_user)) -> dict:
    _require_permission(_auth, "transfer", action="patient transfer")

    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            patient = _get_patient_by_code(cursor, patient_code)
            if patient["discharged_at"] is not None:
                raise HTTPException(status_code=409, detail="Cannot transfer a discharged patient")

            _require_scope_allowed(
                _auth,
                cursor=cursor,
                ward_name=patient["ward_name"],
                team_name=patient["team_name"],
                action="patient transfer",
            )

            new_ward = _resolve_ward(cursor, payload.ward)
            new_team = _resolve_team(cursor, payload.team)

            _require_scope_allowed(
                _auth,
                cursor=cursor,
                ward_name=new_ward["name"],
                team_name=new_team["name"],
                action="patient transfer destination",
            )

            if str(patient["ward_id"]) == str(new_ward["id"]):
                new_bed_label = patient["bed_label"]
            else:
                cursor.execute(
                    """
                    SELECT COUNT(*)::int AS occupied
                    FROM patients
                    WHERE ward_id = %s AND discharged_at IS NULL
                    """,
                    (new_ward["id"],),
                )
                occupied = int(cursor.fetchone()["occupied"])
                if occupied >= int(new_ward["bed_capacity"]):
                    raise HTTPException(status_code=409, detail=f"{new_ward['name']} ward is full")
                new_bed_label = _next_available_bed(cursor, new_ward["id"], int(new_ward["bed_capacity"]))

            cursor.execute(
                """
                UPDATE patients
                SET ward_id = %s,
                    team_id = %s,
                    bed_label = %s,
                    updated_at = now()
                WHERE patient_code = %s
                """,
                (new_ward["id"], new_team["id"], new_bed_label, patient_code),
            )

            _write_audit(
                cursor,
                "PATIENT_TRANSFER",
                patient_code,
                {
                    "to_ward": new_ward["name"],
                    "to_team": new_team["name"],
                    "to_bed": new_bed_label,
                },
                actor_email=_auth["email"],
                category="CLINICAL",
            )

            row = _get_patient_by_code(cursor, patient_code)

    return {"success": True, "data": _normalize_patient_row(row)}


@router.delete("/patients/{patient_code}")
def discharge_patient(patient_code: str, _auth: dict[str, Any] = Depends(require_current_user)) -> dict:
    _require_permission(_auth, "discharge", action="patient discharge")

    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            patient = _get_patient_by_code(cursor, patient_code)
            if patient["discharged_at"] is not None:
                return {"success": True, "message": "Patient already discharged"}

            _require_scope_allowed(
                _auth,
                cursor=cursor,
                ward_name=patient["ward_name"],
                team_name=patient["team_name"],
                action="patient discharge",
            )

            cursor.execute(
                """
                UPDATE patients
                SET discharged_at = now(),
                    bed_label     = NULL,
                    updated_at    = now()
                WHERE patient_code = %s
                """,
                (patient_code,),
            )

            _write_audit(
                cursor,
                "PATIENT_DISCHARGE",
                patient_code,
                {
                    "ward": patient["ward_name"],
                    "team": patient["team_name"],
                },
                actor_email=_auth["email"],
                category="CLINICAL",
            )

    return {"success": True, "message": f"Patient {patient_code} discharged"}


@router.get("/patients/{patient_code}/treatments")
def get_patient_treatments(patient_code: str, _auth: dict[str, Any] = Depends(require_current_user)) -> dict:
    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            patient = _get_patient_by_code(cursor, patient_code)

            _require_scope_allowed(
                _auth,
                cursor=cursor,
                ward_name=patient["ward_name"],
                team_name=patient["team_name"],
                action="view treatment history",
            )

            cursor.execute(
                """
                SELECT
                    t.id,
                    t.notes,
                    t.created_at,
                    s.full_name AS doctor_name,
                    s.title AS doctor_role,
                    s.grade AS doctor_grade
                FROM treatments t
                JOIN staff s ON s.id = t.staff_id
                JOIN patients p ON p.id = t.patient_id
                WHERE p.patient_code = %s
                ORDER BY t.created_at DESC
                """,
                (patient_code,),
            )

            rows = cursor.fetchall()

    data = [
        {
            "id": str(row["id"]),
            "name": row["doctor_name"],
            "role": row["doctor_role"],
            "grade": row["doctor_grade"],
            "notes": row["notes"],
            "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        }
        for row in rows
    ]
    return {"success": True, "data": data}


@router.post("/patients/{patient_code}/treatments")
def record_treatment(patient_code: str, payload: TreatmentPayload, _auth: dict[str, Any] = Depends(require_current_user)) -> dict:
    _require_permission(_auth, "logTreatment", action="record treatment")

    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            patient = _get_patient_by_code(cursor, patient_code)
            if patient["discharged_at"] is not None:
                raise HTTPException(status_code=409, detail="Cannot record treatment for a discharged patient")

            _require_scope_allowed(
                _auth,
                cursor=cursor,
                ward_name=patient["ward_name"],
                team_name=patient["team_name"],
                action="record treatment",
            )

            cursor.execute(
                """
                SELECT s.id, s.full_name, s.title, s.grade, t.name AS team_name
                FROM staff s
                LEFT JOIN teams t ON t.id = s.team_id
                WHERE LOWER(s.full_name) = LOWER(%s)
                LIMIT 1
                """,
                (payload.doctor_name.strip(),),
            )
            staff = cursor.fetchone()
            if not staff:
                raise HTTPException(status_code=404, detail=f"Doctor not found: {payload.doctor_name}")

            if str(staff["team_name"]) != str(patient["team_name"]):
                raise HTTPException(
                    status_code=403,
                    detail=f"Doctor {staff['full_name']} is not assigned to {patient['team_name']}",
                )

            cursor.execute(
                """
                INSERT INTO treatments (patient_id, staff_id, notes)
                VALUES (%s, %s, %s)
                RETURNING id, created_at
                """,
                (patient["id"], staff["id"], payload.notes),
            )
            inserted = cursor.fetchone()

            _write_audit(
                cursor,
                "TREATMENT_LOG",
                patient_code,
                {
                    "doctor": staff["full_name"],
                    "role": staff["title"],
                    "team": patient["team_name"],
                },
                actor_email=_auth["email"],
                category="CLINICAL",
            )

    return {
        "success": True,
        "data": {
            "id": str(inserted["id"]),
            "name": staff["full_name"],
            "role": staff["title"],
            "grade": staff["grade"],
            "notes": payload.notes,
            "created_at": inserted["created_at"].isoformat() if inserted["created_at"] else None,
        },
    }


@router.post("/wards")
def create_ward(payload: NewWardPayload, _auth: dict[str, Any] = Depends(require_current_user)) -> dict:
    _require_permission(_auth, "manageWards", action="create ward")
    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                "SELECT 1 FROM wards WHERE LOWER(name) = LOWER(%s) LIMIT 1",
                (payload.name.strip(),),
            )
            if cursor.fetchone():
                raise HTTPException(status_code=409, detail="Ward already exists")

            cursor.execute(
                """
                INSERT INTO wards (name, bed_capacity, status)
                VALUES (%s, %s, %s)
                RETURNING id, name, bed_capacity, status
                """,
                (payload.name.strip(), payload.bed_capacity, payload.status.strip()),
            )
            ward = cursor.fetchone()

            _write_audit(
                cursor,
                "WARD_CREATE",
                ward["name"],
                {"beds": ward["bed_capacity"], "status": ward["status"]},
                actor_email=_auth["email"],
                category="CONFIG",
            )

    return {
        "success": True,
        "data": {
            "id": str(ward["id"]),
            "name": ward["name"],
            "beds": ward["bed_capacity"],
            "status": ward["status"],
        },
    }


@router.patch("/wards/{ward_name}")
def update_ward(ward_name: str, payload: WardSettingsPayload, _auth: dict[str, Any] = Depends(require_current_user)) -> dict:
    _require_permission(_auth, "manageWards", action="update ward")
    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            ward = _resolve_ward(cursor, ward_name)
            cursor.execute(
                """
                UPDATE wards
                SET bed_capacity = %s,
                    status = %s,
                    updated_at = now()
                WHERE id = %s
                RETURNING id, name, bed_capacity, status
                """,
                (payload.bed_capacity, payload.status.strip(), ward["id"]),
            )
            updated = cursor.fetchone()

            _write_audit(
                cursor,
                "WARD_UPDATE",
                updated["name"],
                {"beds": updated["bed_capacity"], "status": updated["status"]},
                actor_email=_auth["email"],
                category="CONFIG",
            )

    return {
        "success": True,
        "data": {
            "id": str(updated["id"]),
            "name": updated["name"],
            "beds": updated["bed_capacity"],
            "status": updated["status"],
        },
    }


@router.delete("/wards/{ward_name}")
def delete_ward(ward_name: str, _auth: dict[str, Any] = Depends(require_current_user)) -> dict:
    _require_permission(_auth, "manageWards", action="delete ward")
    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            ward = _resolve_ward(cursor, ward_name)
            cursor.execute(
                """
                SELECT COUNT(*)::int AS active_patients
                FROM patients
                WHERE ward_id = %s AND discharged_at IS NULL
                """,
                (ward["id"],),
            )
            active_patients = int(cursor.fetchone()["active_patients"])
            if active_patients > 0:
                raise HTTPException(status_code=409, detail="Cannot remove ward with active patients")

            cursor.execute("DELETE FROM wards WHERE id = %s", (ward["id"],))
            _write_audit(cursor, "WARD_DELETE", ward["name"], {}, actor_email=_auth["email"], category="CONFIG")

    return {"success": True, "message": f"Ward {ward['name']} removed"}


@router.post("/teams")
def create_team(payload: NewTeamPayload, _auth: dict[str, Any] = Depends(require_current_user)) -> dict:
    _require_permission(_auth, "manageStaff", action="create team")
    team_name = payload.name.strip()
    if not team_name.lower().startswith("team "):
        team_name = f"Team {team_name}"

    team_code = team_name.replace("Team ", "").strip().upper()

    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                "SELECT 1 FROM teams WHERE LOWER(name) = LOWER(%s) OR LOWER(code) = LOWER(%s) LIMIT 1",
                (team_name, team_code),
            )
            if cursor.fetchone():
                raise HTTPException(status_code=409, detail="Team already exists")

            lead_staff_id = None
            if payload.consultant_name and payload.consultant_name.strip():
                cursor.execute(
                    """
                    SELECT id
                    FROM staff
                    WHERE LOWER(full_name) = LOWER(%s)
                    LIMIT 1
                    """,
                    (payload.consultant_name.strip(),),
                )
                lead_staff = cursor.fetchone()
                if lead_staff:
                    lead_staff_id = lead_staff["id"]
                else:
                    cursor.execute(
                        """
                        INSERT INTO staff (staff_code, full_name, title, grade, status)
                        VALUES (%s, %s, 'Consultant', 'Lead Consultant', 'Active')
                        RETURNING id
                        """,
                        (f"STF-{team_code}-{abs(hash(payload.consultant_name)) % 10000:04d}", payload.consultant_name.strip()),
                    )
                    lead_staff_id = cursor.fetchone()["id"]

            cursor.execute(
                """
                INSERT INTO teams (code, name, lead_staff_id)
                VALUES (%s, %s, %s)
                RETURNING id, code, name
                """,
                (team_code, team_name, lead_staff_id),
            )
            team = cursor.fetchone()

            if lead_staff_id:
                cursor.execute("UPDATE staff SET team_id = %s WHERE id = %s", (team["id"], lead_staff_id))

            _write_audit(
                cursor,
                "TEAM_CREATE",
                team["name"],
                {"code": team["code"]},
                actor_email=_auth["email"],
                category="CONFIG",
            )

    return {"success": True, "data": {"id": str(team["id"]), "code": team["code"], "name": team["name"]}}


@router.delete("/teams/{team_name}")
def delete_team(team_name: str, _auth: dict[str, Any] = Depends(require_current_user)) -> dict:
    _require_permission(_auth, "manageStaff", action="delete team")
    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            team = _resolve_team(cursor, team_name)
            cursor.execute(
                """
                SELECT COUNT(*)::int AS active_patients
                FROM patients
                WHERE team_id = %s AND discharged_at IS NULL
                """,
                (team["id"],),
            )
            active_patients = int(cursor.fetchone()["active_patients"])
            if active_patients > 0:
                raise HTTPException(status_code=409, detail="Cannot remove team with active patients")

            cursor.execute("UPDATE staff SET team_id = NULL WHERE team_id = %s", (team["id"],))
            cursor.execute("DELETE FROM teams WHERE id = %s", (team["id"],))
            _write_audit(cursor, "TEAM_DELETE", team["name"], {}, actor_email=_auth["email"], category="CONFIG")

    return {"success": True, "message": f"Team {team['name']} removed"}


@router.get("/roles")
def get_roles(_auth: dict[str, Any] = Depends(require_current_user)) -> dict:
    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            available_roles = _get_config_value(
                cursor,
                "available_roles",
                ["Consultant", "Junior Doctor", "Ward Manager", "System Admin"],
            )
            role_templates = _get_config_value(cursor, "role_templates", _default_role_templates())

    return {"success": True, "data": {"available_roles": available_roles, "role_templates": role_templates}}


@router.post("/roles")
def create_role(payload: NewRolePayload, _auth: dict[str, Any] = Depends(require_current_user)) -> dict:
    _require_permission(_auth, "manageAccounts", action="create role")
    role_name = payload.role_name.strip()
    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            available_roles = _get_config_value(
                cursor,
                "available_roles",
                ["Consultant", "Junior Doctor", "Ward Manager", "System Admin"],
            )
            role_templates = _get_config_value(cursor, "role_templates", _default_role_templates())

            if role_name in available_roles:
                raise HTTPException(status_code=409, detail="Role already exists")

            available_roles.append(role_name)
            role_templates[role_name] = _default_role_template()

            _set_config_value(cursor, "available_roles", available_roles)
            _set_config_value(cursor, "role_templates", role_templates)
            _write_audit(cursor, "ROLE_CREATE", role_name, {}, actor_email=_auth["email"], category="CONFIG")

    return {"success": True, "data": {"role_name": role_name}}


@router.patch("/roles/{role_name}")
def update_role(role_name: str, payload: RoleTemplatePayload, _auth: dict[str, Any] = Depends(require_current_user)) -> dict:
    _require_permission(_auth, "manageAccounts", action="update role")
    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            role_templates = _get_config_value(cursor, "role_templates", _default_role_templates())
            template = payload.model_dump()

            role_templates[role_name] = template
            _set_config_value(cursor, "role_templates", role_templates)

            cursor.execute(
                """
                UPDATE system_users
                SET permissions = permissions || %s::jsonb,
                    updated_at = now()
                WHERE role = %s
                  AND COALESCE((permissions ->> 'customPermissions')::boolean, false) = false
                """,
                (Json(template), role_name),
            )

            _write_audit(cursor, "ROLE_UPDATE", role_name, template, actor_email=_auth["email"], category="CONFIG")

    return {"success": True, "data": {"role_name": role_name, "template": template}}


@router.get("/roster/{team_name}")
def get_roster(team_name: str, _auth: dict[str, Any] = Depends(require_current_user)) -> dict:
    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            roster_map = _get_config_value(cursor, "roster", {})
            roster = roster_map.get(team_name) or {
                "d": ["House", "House", "Chase", "Chase", "Cameron"],
                "n": ["Cameron", "Cameron", "House", "Chase", "House"],
            }

    return {"success": True, "data": {"team": team_name, "roster": roster}}


@router.post("/roster/{team_name}")
def save_roster(team_name: str, payload: RosterPayload, _auth: dict[str, Any] = Depends(require_current_user)) -> dict:
    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            roster_map = _get_config_value(cursor, "roster", {})
            roster_map[team_name] = {"d": payload.d, "n": payload.n}
            _set_config_value(cursor, "roster", roster_map)
            _write_audit(
                cursor,
                "ROSTER_UPDATE",
                team_name,
                roster_map[team_name],
                actor_email=_auth["email"],
                category="CONFIG",
            )

    return {"success": True, "data": {"team": team_name, "roster": roster_map[team_name]}}


@router.get("/system-perms")
def get_system_perms(_auth: dict[str, Any] = Depends(require_current_user)) -> dict:
    _require_permission(_auth, "manageSystem", action="system_perms_view")
    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            perms = _get_config_value(
                cursor,
                "system_perms",
                {"timeout": "30 Minutes", "mfa": "Mandatory for all users", "ip": "10.0.0.*"},
            )
    return {"success": True, "data": perms}


@router.patch("/system-perms")
def update_system_perms(payload: SystemPermsPayload, _auth: dict[str, Any] = Depends(require_current_user)) -> dict:
    _require_permission(_auth, "manageSystem", action="system_perms_update")
    perms = payload.model_dump()
    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            _set_config_value(cursor, "system_perms", perms)
            _write_audit(cursor, "SYSTEM_PERMS_UPDATE", "system", perms, actor_email=_auth["email"], category="SECURITY")
    return {"success": True, "data": perms}
