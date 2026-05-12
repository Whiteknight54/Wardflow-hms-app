from __future__ import annotations

import sys
from pathlib import Path

import bcrypt
from psycopg.rows import dict_row

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.db import close_pool, get_connection, open_pool

WARDS = [
    {"name": "Cardiology", "bed_capacity": 20, "status": "Active / Open"},
    {"name": "ICU", "bed_capacity": 20, "status": "Active / Open"},
    {"name": "Maternity", "bed_capacity": 20, "status": "Active / Open"},
    {"name": "Pediatric", "bed_capacity": 20, "status": "Active / Open"},
    {"name": "Surgery", "bed_capacity": 20, "status": "Active / Open"},
    {"name": "General", "bed_capacity": 20, "status": "Active / Open"},
]

TEAMS = [
    {"code": "ALPHA", "name": "Team Alpha", "lead_staff_code": "STF-001"},
    {"code": "BETA", "name": "Team Beta", "lead_staff_code": "STF-003"},
    {"code": "DELTA", "name": "Team Delta", "lead_staff_code": "STF-005"},
    {"code": "GAMA", "name": "Team Gama", "lead_staff_code": "STF-006"},
    {"code": "ZULU", "name": "Team Zulu", "lead_staff_code": "STF-004"},
]

STAFF = [
    {"staff_code": "STF-001", "full_name": "Dr. Gregory House", "title": "Consultant", "grade": "Lead Consultant", "team_code": "ALPHA"},
    {"staff_code": "STF-002", "full_name": "Dr. Robert Chase", "title": "Junior Doctor", "grade": "ST5", "team_code": "ALPHA"},
    {"staff_code": "STF-003", "full_name": "Dr. James Wilson", "title": "Consultant", "grade": "Lead Consultant", "team_code": "BETA"},
    {"staff_code": "STF-004", "full_name": "Dr. Eric Foreman", "title": "Junior Doctor", "grade": "ST4", "team_code": "ZULU"},
    {"staff_code": "STF-005", "full_name": "Dr. Lisa Cuddy", "title": "Consultant", "grade": "Lead Consultant", "team_code": "DELTA"},
    {"staff_code": "STF-006", "full_name": "Dr. Allison Cameron", "title": "Junior Doctor", "grade": "FY2", "team_code": "GAMA"},
]

SYSTEM_USERS = [
    {"email": "wardflowhms@gmail.com", "password": "password123", "role": "System Admin", "linked_staff_code": None},
    {"email": "admin@wardflow.com", "password": "password123", "role": "System Admin", "linked_staff_code": None},
    {"email": "house@wardflow.com", "password": "password123", "role": "Consultant", "linked_staff_code": "STF-001"},
    {"email": "consultant@wardflow.com", "password": "password123", "role": "Consultant", "linked_staff_code": "STF-003"},
    {"email": "seniordoctor@wardflow.com", "password": "password123", "role": "Consultant", "linked_staff_code": "STF-005"},
    {"email": "jdoctor@wardflow.com", "password": "password123", "role": "Junior Doctor", "linked_staff_code": "STF-002"},
    {"email": "wmanager@wardflow.com", "password": "password123", "role": "Ward Manager", "linked_staff_code": None},
    {"email": "nurse@wardflow.com", "password": "password123", "role": "Ward Manager", "linked_staff_code": None},
]

PATIENTS = [
    {"patient_code": "027", "full_name": "John Doe", "age": 54, "sex": "M", "ward": "General", "bed_label": "Bed 3", "team": "Team Alpha"},
    {"patient_code": "023", "full_name": "Janet Doe", "age": 54, "sex": "F", "ward": "ICU", "bed_label": "Bed 2", "team": "Team Beta"},
    {"patient_code": "043", "full_name": "James Doe", "age": 60, "sex": "M", "ward": "Cardiology", "bed_label": "Bed 3", "team": "Team Alpha"},
    {"patient_code": "012", "full_name": "Susan Ray", "age": 69, "sex": "F", "ward": "ICU", "bed_label": "Bed 4", "team": "Team Gama"},
    {"patient_code": "008", "full_name": "John Doe", "age": 64, "sex": "M", "ward": "Surgery", "bed_label": "Bed 1", "team": "Team Beta"},
    {"patient_code": "076", "full_name": "John Done", "age": 12, "sex": "M", "ward": "Pediatric", "bed_label": "Bed 3", "team": "Team Delta"},
    {"patient_code": "037", "full_name": "Elena Scott", "age": 31, "sex": "F", "ward": "Maternity", "bed_label": "Bed 3", "team": "Team Delta"},
    {"patient_code": "056", "full_name": "Mark Desnon", "age": 51, "sex": "M", "ward": "Surgery", "bed_label": "Bed 2", "team": "Team Gama"},
    {"patient_code": "046", "full_name": "Mark Desnon", "age": 64, "sex": "M", "ward": "ICU", "bed_label": "Bed 6", "team": "Team Alpha"},
    {"patient_code": "031", "full_name": "Sarah Johnson", "age": 67, "sex": "F", "ward": "General", "bed_label": "Bed 1", "team": "Team Zulu"},
    {"patient_code": "032", "full_name": "David Thompson", "age": 54, "sex": "M", "ward": "General", "bed_label": "Bed 5", "team": "Team Zulu"},
    {"patient_code": "033", "full_name": "Lisa Brown", "age": 46, "sex": "F", "ward": "General", "bed_label": "Bed 7", "team": "Team Zulu"},
]


def password_hash(value: str) -> str:
    return bcrypt.hashpw(value.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def main() -> None:
    open_pool()

    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute("TRUNCATE TABLE treatments, audit_log, patients, system_users, staff, teams, wards RESTART IDENTITY CASCADE")

            ward_ids: dict[str, str] = {}
            team_ids: dict[str, str] = {}
            staff_ids: dict[str, str] = {}

            for ward in WARDS:
                cursor.execute(
                    """
                    INSERT INTO wards (name, bed_capacity, status)
                    VALUES (%s, %s, %s)
                    RETURNING id
                    """,
                    (ward["name"], ward["bed_capacity"], ward["status"]),
                )
                ward_ids[ward["name"]] = str(cursor.fetchone()["id"])

            for team in TEAMS:
                cursor.execute(
                    """
                    INSERT INTO teams (code, name)
                    VALUES (%s, %s)
                    RETURNING id
                    """,
                    (team["code"], team["name"]),
                )
                team_ids[team["code"]] = str(cursor.fetchone()["id"])

            for staff in STAFF:
                cursor.execute(
                    """
                    INSERT INTO staff (staff_code, full_name, title, grade, team_id)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        staff["staff_code"],
                        staff["full_name"],
                        staff["title"],
                        staff["grade"],
                        team_ids[staff["team_code"]],
                    ),
                )
                staff_ids[staff["staff_code"]] = str(cursor.fetchone()["id"])

            for team in TEAMS:
                cursor.execute(
                    "UPDATE teams SET lead_staff_id = %s WHERE code = %s",
                    (staff_ids[team["lead_staff_code"]], team["code"]),
                )

            for system_user in SYSTEM_USERS:
                cursor.execute(
                    """
                    INSERT INTO system_users (email, password_hash, role, linked_staff_id, permissions)
                    VALUES (%s, %s, %s, %s, %s::jsonb)
                    """,
                    (
                        system_user["email"],
                        password_hash(system_user["password"]),
                        system_user["role"],
                        staff_ids.get(system_user["linked_staff_code"]),
                        "{}",
                    ),
                )

            for patient in PATIENTS:
                cursor.execute(
                    """
                    INSERT INTO patients (patient_code, full_name, age, sex, ward_id, bed_label, team_id)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        patient["patient_code"],
                        patient["full_name"],
                        patient["age"],
                        patient["sex"],
                        ward_ids[patient["ward"]],
                        patient["bed_label"],
                        team_ids[patient["team"].replace("Team ", "").upper() if patient["team"].startswith("Team ") else patient["team"]],
                    ),
                )

    close_pool()
    print("Seed completed successfully.")


if __name__ == "__main__":
    try:
        main()
    finally:
        close_pool()
