# WardFlow: Administrative Hospital Management System

## Overview
WardFlow is a Hospital Management System (HMS) for hospital administrators and ward clerks, focused entirely on patient logistics, capacity management, and team-based care tracking. This system explicitly excludes clinical/medical records (EHR).

### Architecture Phase
**Current:** Frontend served from a local static server with a Dockerized Python API + PostgreSQL test stack  
**In Progress:** API-driven refactor with server-side auth, RBAC, and transactional consistency  
**Target:** Production-ready system with hardened deployment defaults and audit coverage  

## Key Architectural Decisions
* **Strict Role-Based Scope:** Designed for Administrator persona. Doctors and patients are database entities, not system users.
* **3NF Data Normalization:** Normalized data model. Patient records link to teams/doctors via foreign keys, preventing anomalies.
* **Modular UI Components:** Component injection architecture (`components.js`) maintains DRY codebase across multiple pages.
* **Responsive Design:** CSS Flexbox/Grid with media queries for desktop, tablet, and mobile.
* **API-Ready Frontend:** Vanilla JS + fetch for future backend integration (no heavy frameworks).

## Features
* **Admissions & Discharges:** Register and remove patients with automatic capacity validation.
* **Ward Capacity Management:** Real-time bed matrix and occupancy tracking to prevent overbooking.
* **Transfer Logistics:** Move patients between wards and teams seamlessly.
* **Treatment Logging:** Record patient-doctor interactions with team membership validation.
* **Reporting & Exports:** Dynamic filtering by Ward, Care Team, or Treatment History.
* **Role-Based Access Control:** Admin, Consultant, Junior Doctor, Ward Manager roles with permission enforcement.

## Tech Stack
### Frontend (Current)
* **Language:** Vanilla JavaScript (ES6+) — no frameworks
* **Styling:** CSS3 with CSS Variables, Flexbox, Grid
* **Architecture:** Component injection, modular script separation
* **Browser Storage:** localStorage (seed data) + sessionStorage (session state)

### Runtime Environment
* **Frontend server:** Nginx container at `http://127.0.0.1:5500`
* **Backend API:** `http://127.0.0.1:8001/api`
* **Test database:** PostgreSQL on host port `5433`

### Backend (In Development)
* **Framework:** Python (FastAPI or Flask) with RESTful API
* **Database:** PostgreSQL (3NF schema)
* **Auth:** Session-based or JWT tokens with server-side RBAC
* **Migrations:** Alembic or equivalent for schema versioning


## How to Run (Current Environment)


### Recommended: One-Step Startup Script (macOS/Linux)
1. In the project directory, run:
  ```bash
  ./start-wardflow.sh
  ```
  This will build and launch all containers, then open the login page in your default browser.

### Windows Quick Start
1. In the project directory, double-click or run:
  ```bat
  START-TEST.bat
  ```
  This will build and launch all containers, then print the login URL for you to open in your browser.

### Alternative: Manual Docker Compose
1. Start the test stack:
  ```bash
  docker compose -f docker-compose.test.yml up -d --build
  ```
2. Open `http://127.0.0.1:5500/login.html` in your browser.

### Login Credentials
Use credentials:
  - Email: `admin@wardflow.com` / Password: `password123`
  - Email: `house@wardflow.com` / Password: `password123`

The stack includes an Nginx frontend container that serves static assets and proxies `/api/*` to the API service.

## Backend Integration Roadmap
See [BACKEND-MIGRATION.md](#) for detailed API contracts and integration phases.

### Phase 1: Read Operations (Q2)
- Replace localStorage reads with GET endpoints
- Implement client-side fetch wrappers
- Target: Patient list, ward/team census, audit log queries

### Phase 2: Write Operations (Q2–Q3)
- Replace `saveData()` with transactional POST/PATCH/DELETE calls
- Add optimistic UI updates with server reconciliation
- Target: Admit, discharge, transfer, treatment logging

### Phase 3: Admin & Permissions (Q3)
- Move admin CRUD to API endpoints
- Enforce server-side RBAC on all operations
- Target: Ward management, user roles, roster scheduling

### Phase 4: Authentication (Q3)
- Replace browser-based login with server session/JWT auth
- Implement token refresh and session timeout
- Target: Secure multi-user environment

## For Backend Development Team

Refer to [MAINTENANCE.md](MAINTENANCE.md) for frontend module descriptions and to [script.js](script.js) for a backend migration checklist embedded in code comments.

### Frontend → Backend Responsibility Shift
| Operation | Current (Frontend) | Target (Backend) |
|-----------|-------------------|------------------|
| Patient admit | localStorage → saveData() | PostgreSQL transaction + audit log |
| Permissions check | getPerms() in-memory | JWT claims + server RBAC |
| Ward occupancy sync | syncData() on every action | Database view / cached query |
| Treatment logging | client-side array push | SQL INSERT with foreign key validation |
| Audit trail | JSON array in browser | Immutable database audit table |

### Expected API Responses
Each endpoint should return:
```json
{
  "success": true,
  "data": { /* operation result */ },
  "error": null,
  "timestamp": "2026-04-15T10:30:00Z"
}
```
On errors:
```json
{
  "success": false,
  "data": null,
  "error": "Permission denied: user cannot discharge patients",
  "code": 403
}
```

### Database Design Baseline
Start from [schema.sql](schema.sql) (3NF normalized for PostgreSQL).

## Contributing
- **Frontend changes:** Update corresponding module (`ui.js`, `actions.js`, etc.). See [MAINTENANCE.md](MAINTENANCE.md).
- **Backend changes:** Document endpoint changes in a separate backend API spec.
- **Cross-team changes:** Coordinate frontend/backend API contract changes with both teams.