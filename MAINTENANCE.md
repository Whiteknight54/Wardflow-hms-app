# HMS (Hospital Management System) - Code Maintenance Guide

## Documentation Scope

This guide documents the **frontend application only**.

Included in scope:
- Browser UI architecture and module boundaries
- Client-side state and persistence behavior
- Rendering and interaction flows
- Frontend permissions and UX behavior

Excluded from scope:
- Backend services, APIs, or server-side architecture
- Database implementation details
- Generated SQL artifacts such as `schema.sql`

If backend documentation is required, maintain it in a separate backend-specific guide to avoid coupling client and server concerns.

## Quick Reference

### Current Status

The codebase is now modular and the old monolithic `script.js` has been split into focused files.

Active modules:
- `components.js` - shared page chrome and modal shells
- `data.js` - seed data and persistent app state
- `auth.js` - login, session handling, role templates
- `ui.js` - rendering helpers for tables, wards, teams, treatment history
- `actions.js` - patient lifecycle actions
- `modals.js` - patient and bed matrix modal flows
- `admin.js` - system management, roles, accounts, roster, reports
- `script.js` - core utilities, sync, permissions helpers, startup

Out of scope for this document:
- `schema.sql` (database schema artifact; backend concern)

Reference backup:
- `script.js.bak` - archived pre-refactor version, kept only as a fallback reference

## Architecture Overview

## Frontend Design Justification

### Why this is a client-first architecture

The current system is intentionally browser-first to support rapid iteration and low operational overhead:

1. Zero-backend deployment complexity for prototyping and demonstrations.
2. Fast interaction loops with local state mutation and immediate re-render.
3. Predictable behavior across pages via shared script load order and global state conventions.

Tradeoff acknowledged: this is not appropriate for production-grade security/compliance workloads without a server-backed identity and data layer.

### Why the modular split was chosen

The monolithic script was split into focused modules to reduce regression risk and improve maintainability:

1. `data.js` isolates persistent state ownership.
2. `auth.js` isolates session and permission logic.
3. `ui.js` isolates pure render concerns.
4. `actions.js` isolates patient lifecycle mutations.
5. `modals.js` isolates modal orchestration and context.
6. `admin.js` isolates system-management panels and admin workflows.
7. `script.js` remains the integration/runtime layer.

This separation reduces cross-cutting edits, makes debugging faster, and keeps feature work scoped.

### Why strict script load order exists

Load order guarantees dependency availability without a bundler:

1. UI shells are available before content injection.
2. Base state exists before auth and runtime logic read it.
3. Feature modules load before runtime initialization invokes shared functions.

Without this order, first-paint race conditions and undefined global references become likely.

### Why localStorage/sessionStorage are used

Storage choices are intentional for browser-only operation:

1. `sessionStorage` for active login/session-lifetime identity.
2. `localStorage` for durable app data and user-config state.

This provides persistence with no server dependency, but has explicit limitations:

1. Not tamper-proof.
2. Not suitable for sensitive PHI in production.
3. Not suitable for multi-user concurrency guarantees.

### Why `refreshDashboard()` is the central re-render path

A single refresh pipeline (`saveData() -> syncData() -> render/update`) minimizes state drift:

1. Prevents partial updates where some views are stale.
2. Ensures derived ward/team metrics stay aligned with patient mutations.
3. Simplifies troubleshooting by narrowing where post-action consistency is enforced.

### Why permission checks exist in UI and action handlers

Permissions are enforced both at presentation and operation levels:

1. UI gating removes inaccessible controls for clarity.
2. Handler-level checks prevent unauthorized operation calls from DOM/manual trigger paths.

This dual-check model is appropriate for frontend guardrails, but must be backed by server-side authorization in production systems.

### Load Order

Every page should load scripts in this order:

1. `components.js`
2. `data.js`
3. `injectComponents('pageName')`
4. `auth.js`
5. `ui.js`
6. `actions.js`
7. `modals.js`
8. `admin.js`
9. `script.js`

The HTML pages currently follow this order.

### State Ownership

`data.js` owns the persistent base state:
- `patients`
- `doctors`
- `teams`
- `wardConfigs`
- `rosterData`
- `availableRoles`
- `sysPerms`
- `auditLog`

`script.js` owns derived runtime state and cross-module helpers:
- `wards`
- `admissionsToday`
- `transfersToday`
- `dischargedToday`
- `currentSortCol`
- `currentSortAsc`

`modals.js` owns modal-local state:
- `currentPatientId`

`sessionStorage` stores:
- `activeUser`

`localStorage` stores:
- `wardflow_users`
- `wardflow_patients`
- `wardflow_doctors`
- `wardflow_roles`
- `wardflow_role_templates`
- `wardflow_wards`
- `wardflow_roster`
- `wardflow_perms`
- `wardflow_audit`
- `wardflow_theme`
- `wardflow_remembered_email`

## File Guide

### `data.js`
Purpose: initialize seed data and persistent app state.

Key points:
- Patient, doctor, ward, roster, permission, and audit data are loaded here.
- Teams are static and rebuilt from patient data.
- If values seem to “reset”, check the browser localStorage entries above.

### `auth.js`
Purpose: login/logout and role template management.

Key points:
- `roleTemplates` now loads from `wardflow_role_templates` and merges with defaults.
- Users without `customPermissions` sync to their role template on login.
- The seeded test users continue to work as local fallback auth records in the test stack.

Important flags in role templates:
- `viewGlobalPatients`
- `allowedWards`
- `allowedTeams`
- `admit`
- `discharge`
- `transfer`
- `logTreatment`
- `exportData`
- `manageSystem`
- `manageStaff`
- `manageAccounts`
- `manageWards`
- `viewReports`
- `bedMatrix`

### `components.js`
Purpose: render shared UI chrome and modal shells.

Key points:
- Contains the topbar, stats bar, sidebar, and modal templates.
- Bed Matrix modal is rendered here as `bedModal`.
- If a modal cannot open, first check the template ID in this file.

### `ui.js`
Purpose: render all main content views.

Typical responsibilities:
- patient table rendering
- search filtering
- ward cards
- team cards
- treatment history tables

### `actions.js`
Purpose: perform patient state changes.

Typical responsibilities:
- admit patient
- discharge patient
- transfer patient
- record treatment

These actions should always end by calling `refreshDashboard()` and `saveData()` through the shared flow.

### `modals.js`
Purpose: open and populate patient-related modals.

Key points:
- `openBedMatrix()` now targets the Bed Matrix modal shell created in `components.js`.
- `renderBedMatrix()` uses ward occupancy and patient bed assignments.
- `openDetail()` and `openTransfer()` still control the patient detail and transfer flows.

### `admin.js`
Purpose: system management panels and admin helpers.

Current panels:
- Edit Wards
- Ward History
- Manage Team
- Staff Roster
- Manage Accounts
- User Roles
- Permissions
- Audit Logs
- View Reports
- Export Data

Important behavior:
- User Roles now edits real role templates and persists them.
- Manage Accounts shows whether a user is on role defaults or custom overrides.
- `resetUserToRoleDefaults()` clears per-user custom permissions safely.
- `saveRoster()` persists roster edits.

### `script.js`
Purpose: shared runtime utilities and app initialization.

Key responsibilities:
- `getPerms()`
- `getFilteredPatients()`
- `getActiveUserTeam()`
- `getLeadConsultantForPatient()`
- `logSystemAction()`
- `syncData()`
- `refreshDashboard()`
- `updateGlobalStats()`
- `updateAdmissionsStats()`
- `sortTable()`
- `toggleTheme()`
- `updateClock()`
- `togglePasswordVisibility()`
- `toggleProfileMenu()`
- `openUserModal()`
- `applySecurityAndProfile()`
- `saveData()`

## Common Debugging Scenarios

### Patients do not show in the table

Check:
1. Is `sessionStorage.activeUser` present?
2. Does the user have the correct permission flags?
3. Is `wardflow_patients` populated?
4. Did `syncData()` run?
5. Did `renderTable(getFilteredPatients())` run?

Useful console checks:
```javascript
console.log(getPerms());
console.log(getFilteredPatients());
console.log(wards);
refreshDashboard();
```

### Bed Matrix does not open

Check:
1. Does `components.js` still render `bedModal` and `bedMatrixGrid`?
2. Is `openBedMatrix()` using the current modal ID?
3. Are the bed matrix scripts loaded before `script.js`?

### User Roles changes do not persist

Check:
1. Did `saveRolePermissions()` run?
2. Is `wardflow_role_templates` being written by `saveData()`?
3. Does the user have `customPermissions` set to false if they should follow the role template?

### Manage Accounts shows the wrong permission badge

Check:
1. Is `customPermissions` set on the user object?
2. Was the account edited through granular permissions?
3. Was `resetUserToRoleDefaults()` used to clear the override?

### Staff roster or ward history looks stale

Check:
1. Did the modal helper rerender after the panel opened?
2. Did `saveData()` run after editing the roster or ward settings?
3. Did `refreshDashboard()` run after the change?

## Data Flow Summary

```
User action
  -> open modal or click action
  -> edit state in module
  -> saveData()
  -> logSystemAction() if needed
  -> refreshDashboard()
  -> syncData()
  -> re-render UI
```

## Change Checklist

When adding a new feature:
1. Put persistent base data in `data.js` if it belongs to app state.
2. Put rendering in `ui.js`.
3. Put patient mutations in `actions.js`.
4. Put modal orchestration in `modals.js`.
5. Put admin panels in `admin.js`.
6. Use `saveData()` for persistence.
7. Update this guide if the load order, storage keys, or permission flow changes.

## Notes for Future Maintenance

- Keep `script.js` small. It should remain a shared utility and initialization layer, not a second monolith.
- If you add a new permission field, update both the role template data and the UI that edits it.
- If you add a new page, ensure it loads the same script sequence as the other HTML files.
- Keep `script.js.bak` as archive only; do not edit it unless you intentionally need to compare against the pre-refactor version.

## Frontend Non-Goals

These are intentionally not solved in the frontend-only implementation:

1. Server-verified identity and role claims.
2. Authoritative audit immutability.
3. Distributed locking or concurrent edit conflict resolution.
4. At-rest encryption and backend key management.

Treat these as backend concerns and document them separately from this file.

## Frontend ADRs

These Architecture Decision Records (ADRs) document why key frontend decisions were made.

### ADR-001: Browser-First Runtime

Context:
- The project needed rapid delivery, low setup overhead, and easy local execution.

Decision:
- Keep runtime client-side with browser storage (`localStorage` and `sessionStorage`) and no required backend service.

Consequences:
- Positive: fast iteration, simple deployment, minimal infrastructure cost.
- Negative: no server-trust guarantees, limited multi-user consistency, unsuitable for production PHI handling.

### ADR-002: Modular JavaScript Boundaries

Context:
- A large monolithic script increased change risk and made troubleshooting difficult.

Decision:
- Split responsibilities into dedicated modules (`data.js`, `auth.js`, `ui.js`, `actions.js`, `modals.js`, `admin.js`, `script.js`).

Consequences:
- Positive: clearer ownership, safer refactoring, easier onboarding and debugging.
- Negative: strict dependency/load ordering is required and must be preserved on every page.

### ADR-003: Deterministic Script Load Order

Context:
- The app is multi-page and non-bundled; modules rely on globally available symbols.

Decision:
- Enforce shared script sequence on all pages: components -> data -> inject -> auth -> ui -> actions -> modals -> admin -> script.

Consequences:
- Positive: predictable first paint and consistent runtime initialization.
- Negative: incorrect ordering can cause undefined symbol errors and partial UI startup.

### ADR-004: Centralized Refresh Pipeline

Context:
- Patient operations affect derived ward/team metrics and multiple views.

Decision:
- Route post-mutation consistency through `refreshDashboard()` (persist, sync derived state, then rerender metrics/views).

Consequences:
- Positive: reduced stale-view bugs, easier debugging of state drift.
- Negative: full refresh may do more work than targeted updates as feature complexity grows.

### ADR-005: Dual-Layer Permission Enforcement (UI + Handler)

Context:
- Frontend-only controls can be triggered through UI or direct function calls.

Decision:
- Keep permission checks in both render-time UI gating and operation handlers (`actions.js`, admin workflows).

Consequences:
- Positive: clearer UX and stronger guardrails against accidental unauthorized actions.
- Negative: still not authoritative security without backend authorization.

### ADR-006: Backward-Compatible Data Keys

Context:
- Existing users rely on persisted `wardflow_*` keys in browser storage.

Decision:
- Preserve storage key names and keep compatibility logic for legacy/default data paths.

Consequences:
- Positive: upgrades do not wipe user state; reduced migration friction.
- Negative: schema evolution requires careful versioning when data shape changes.

---

## Optional Enhancements

The core refactor is complete. Any further changes are optional polish:

1. Create a `utils.js` file if helper code starts to grow again.
2. Split `components.js` further only if modal templates become difficult to maintain.
3. Add automated browser smoke tests if the app continues to grow.

---

## Smoke Test Checklist

Use this after changes to permissions, modals, or data flow:

1. Log in as admin.
2. Open Bed Matrix and confirm it loads.
3. Open System Management and verify Edit Wards, Ward History, Staff Roster, User Roles, and Manage Accounts.
4. Change a role permission and save it.
5. Reset one custom account back to role defaults.
6. Log out and back in as a non-admin user to confirm permissions are applied correctly.
7. Check that patient table, ward cards, and team cards refresh after an admit, transfer, or discharge.

## Key Takeaways

1. Always call `syncData()` after patient data changes so derived ward/team state stays correct.
2. Check permission flags before operations with `getPerms()`.
3. Use `refreshDashboard()` for the full re-render path.
4. Keep `wardflow_` as the prefix for all persistent localStorage keys.
5. Preserve `customPermissions` when you want a user to diverge from the role template.
6. Use `resetUserToRoleDefaults()` when you want to remove a user override safely.

---

**Last Updated:** April 15, 2026  
**Maintenance Status:** Functionally complete and modularized
