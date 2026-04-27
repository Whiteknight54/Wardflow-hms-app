// =============================================================================
// script.js - REFACTORED (Core utilities + page initialization)
// =============================================================================
// AFTER REFACTORING: This file is now ~400 lines (was 1700+ lines!)
// Extracted modules: ui.js, actions.js, modals.js, admin.js
//
// PURPOSE: Core permissions, data sync, page utilities, initialization
// LOAD ORDER: data.js → ui.js → actions.js → modals.js → admin.js → script.js
// =============================================================================

// =============================================================================
// RUNTIME INTEGRATION NOTES FOR DEVELOPMENT TEAM
// =============================================================================
// CURRENT STATE: Local static frontend + Dockerized FastAPI/PostgreSQL test stack
// RUNTIME DEFAULTS: Frontend on http://127.0.0.1:5500, API on http://127.0.0.1:8001/api
//
// The following functions are a migration checklist for the browser layer.
// Keep this guide aligned with the live API and test stack.
// =============================================================================

// PHASE 1: READ OPERATIONS (Low Risk)
// Replace localStorage reads with GET endpoints:
// - getFilteredPatients() → GET /api/patients?ward=X&team=Y
// - renderTable() → fetch and display from API
// - renderWards() → GET /api/wards
// - renderTeams() → GET /api/teams
// Status: [ ] JavaScript layer ready
//         [ ] Backend endpoints documented
//         [ ] API response schemas defined

// PHASE 2: WRITE OPERATIONS (Medium Risk)
// Replace saveData() + local mutations with API calls:
// - admitPatient() → POST /api/patients
// - dischargePatient() → DELETE /api/patients/{id}
// - doTransfer() → PATCH /api/patients/{id}/transfer
// - recordTreatment() → POST /api/patients/{id}/treatments
// Status: [ ] Mutation functions isolated
//         [ ] Endpoint contracts drafted
//         [ ] Transaction handling designed

// PHASE 3: ADMIN OPERATIONS (Higher Risk)
// Move system admin mutations to API:
// - saveWardSettings() → PATCH /api/wards/{id}
// - addNewTeam() / removeTeam() → POST/DELETE /api/teams
// - saveRolePermissions() → PATCH /api/roles/{id}
// - saveRoster() → POST /api/roster/{team_id}
// Status: [ ] Admin workflows mapped
//         [ ] Endpoints secured with server RBAC
//         [ ] Audit trail captured server-side

// PHASE 4: AUTH & SESSION (Critical)
// Move auth from browser localStorage to server:
// - handleLogin() → POST /api/auth/login (returns JWT/session)
// - sessionStorage activeUser → JWT token in cookie or header
// - Permission checks → server-side authorization on every endpoint
// Status: [ ] JWT or session-based auth designed
//         [ ] Token refresh strategy implemented
//         [ ] Server-side RBAC rules enforced

// API ENDPOINT CHECKLIST FOR BACKEND TEAM:
// POST   /api/auth/login                    - User login, return token
// POST   /api/auth/change-password          - Update temporary password
// POST   /api/auth/request-otp              - Request fresh OTP
// POST   /api/auth/verify-otp               - Verify OTP challenge
// GET    /api/auth/me                       - Return current user context
// GET    /api/patients                      - List patients (paginated, filtered)
// POST   /api/patients                      - Admit new patient
// GET    /api/patients/{id}                 - Patient detail
// PATCH  /api/patients/{id}                 - Update patient
// DELETE /api/patients/{id}                 - Discharge patient
// POST   /api/patients/{id}/transfer        - Transfer patient to ward/team
// POST   /api/patients/{id}/treatments      - Log treatment
// GET    /api/wards                         - List wards
// PATCH  /api/wards/{ward_name}             - Update ward capacity/status
// GET    /api/teams                         - List teams
// POST   /api/teams                         - Create team
// DELETE /api/teams/{team_name}             - Delete team
// GET    /api/staff                         - List staff members
// GET    /api/roles                         - List role templates
// POST   /api/roles                         - Create role
// PATCH  /api/roles/{role_name}             - Update role permissions
// POST   /api/roster/{team_name}           - Save roster
// GET    /api/audit-log                     - List audit events (admin only)
// See BACKEND-API-SPEC.md for full contract details
// 
// =============================================================================
// END RUNTIME INTEGRATION NOTES
// =============================================================================

// ====== PERMISSIONS & SESSION MANAGEMENT ======
// Retrieve permission object for logged-in user from sessionStorage
// Returns full permission template for checking access to features
function getPerms() {
  const u = JSON.parse(sessionStorage.getItem('activeUser'));
  if (!u || !u.permissions) return roleTemplates['System Admin']; 
  return u.permissions;
}

// Return only patients visible to current user based on permissions
// System Admin sees all patients; restricted roles see only allowed wards/teams
function getFilteredPatients() {
  const perms = getPerms();
  
  if (perms.viewGlobalPatients) return patients;

  return patients.filter(p => {
    const isAllowedWard = perms.allowedWards.includes(p.ward);
    const teamCode = p.team.replace('Team ', '');
    const isAllowedTeam = perms.allowedTeams.includes(teamCode) || perms.allowedTeams.includes(p.team);
    
    return isAllowedWard || isAllowedTeam;
  });
}

// Returns the team name (e.g. "Team Alpha") that the active user belongs to as a doctor
// Used to scope team-specific operations
function getActiveUserTeam() {
  const u = JSON.parse(sessionStorage.getItem('activeUser'));
  if (!u) return null;
  const doc = doctors.find(d => d.name === u.name);
  return doc ? doc.team : null;
}

// Utility: Find lead consultant for a team
// Used to display lead consultant name on patient detail modal
function getLeadConsultantForPatient(teamCode) {
  if (!teamCode) return 'Unassigned';
  const formattedTeamName = teamCode.includes('Team') ? teamCode : 'Team ' + teamCode;
  const leadDoc = doctors.find(d => d.team === formattedTeamName && d.role === 'Consultant');
  return leadDoc ? leadDoc.name : 'Unassigned';
}

const API_BASE_URL = typeof window.resolveApiBaseUrl === 'function'
  ? window.resolveApiBaseUrl()
  : (window.WARDFLOW_API_BASE_URL || '/api');

function setDataSourceBanner(isFallback, message = '') {
  let banner = document.getElementById('dataSourceBanner');

  if (!isFallback) {
    if (banner) banner.remove();
    return;
  }

  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'dataSourceBanner';
    banner.className = 'data-source-banner';
    document.body.appendChild(banner);
  }

  const suffix = message ? ` (${message})` : '';
  banner.textContent = `Offline fallback active: showing browser-local data, not PostgreSQL.${suffix}`;
}

function normalizeTeamName(teamName) {
  if (!teamName) return '';
  const text = String(teamName).trim();
  return text.replace(/^Team\s+/i, '');
}

function normalizePatientsFromApi(apiPatients) {
  return (apiPatients || []).map(patient => ({
    id: patient.patient_code,
    name: patient.full_name,
    age: patient.age,
    sex: patient.sex,
    ward: patient.ward,
    bed: patient.bed_label,
    team: patient.team,
    treatments: Array.isArray(patient.treatments) ? patient.treatments : []
  }));
}

function normalizeWardsFromApi(apiWards) {
  return (apiWards || []).map(ward => ({
    name: ward.name,
    beds: Number(ward.beds) || 0,
    status: ward.status || 'Active / Open'
  }));
}

function normalizeTeamsFromApi(apiTeams) {
  return (apiTeams || []).map(team => ({
    name: team.name,
    count: Number(team.count) || 0,
    wards: Array.isArray(team.wards) ? team.wards : [],
    patients: Array.isArray(team.patients) ? team.patients : []
  }));
}

function normalizeDoctorsFromApi(apiStaff) {
  return (apiStaff || [])
    .filter(staff => staff.title === 'Consultant' || staff.title === 'Junior Doctor')
    .map(staff => ({
      name: staff.full_name,
      role: staff.title,
      grade: staff.grade,
      team: staff.team_name || ''
    }));
}

async function fetchBackendJson(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = sessionStorage.getItem('wardflow_access_token') || JSON.parse(sessionStorage.getItem('activeUser') || 'null')?.token;
  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers,
    ...options
  });

  if (!response.ok) {
    throw new Error(`Backend request failed: ${response.status}`);
  }

  return response.json();
}

async function loadBackendState() {
  const requests = await Promise.allSettled([
    fetchBackendJson('/patients?limit=500'),
    fetchBackendJson('/wards'),
    fetchBackendJson('/teams'),
    fetchBackendJson('/staff'),
    fetchBackendJson('/roles'),
    fetchBackendJson('/system-perms')
  ]);

  const [patientsReq, wardsReq, teamsReq, staffReq, rolesReq, permsReq] = requests;
  const requiredRequests = [patientsReq, wardsReq, teamsReq, staffReq];
  const hasRequiredFailure = requiredRequests.some(req => req.status === 'rejected');

  if (hasRequiredFailure) {
    const firstFailure = requiredRequests.find(req => req.status === 'rejected');
    const reason = firstFailure && firstFailure.status === 'rejected'
      ? (firstFailure.reason?.message || 'backend unavailable')
      : 'backend unavailable';
    setDataSourceBanner(true, reason);
    return false;
  }

  const patientsResp = patientsReq.status === 'fulfilled' ? patientsReq.value : null;
  const wardsResp = wardsReq.status === 'fulfilled' ? wardsReq.value : null;
  const teamsResp = teamsReq.status === 'fulfilled' ? teamsReq.value : null;
  const staffResp = staffReq.status === 'fulfilled' ? staffReq.value : null;
  const rolesResp = rolesReq.status === 'fulfilled' ? rolesReq.value : null;
  const permsResp = permsReq.status === 'fulfilled' ? permsReq.value : null;

  if (patientsResp && patientsResp.success) {
    patients = normalizePatientsFromApi(patientsResp.data);
  }

  if (wardsResp && wardsResp.success) {
    wardConfigs = normalizeWardsFromApi(wardsResp.data);
  }

  if (teamsResp && teamsResp.success) {
    teams = normalizeTeamsFromApi(teamsResp.data);
  }

  if (staffResp && staffResp.success) {
    doctors = normalizeDoctorsFromApi(staffResp.data);
  }

  if (rolesResp && rolesResp.success && rolesResp.data) {
    availableRoles = Array.isArray(rolesResp.data.available_roles) ? rolesResp.data.available_roles : availableRoles;

    const incomingTemplates = rolesResp.data.role_templates || {};
    Object.keys(roleTemplates).forEach(k => delete roleTemplates[k]);
    Object.entries(incomingTemplates).forEach(([k, v]) => {
      roleTemplates[k] = v;
    });
  }

  if (permsResp && permsResp.success && permsResp.data) {
    sysPerms = { ...sysPerms, ...permsResp.data };
  }

  setDataSourceBanner(false);
  return true;
}

// ====== AUDIT LOGGING ======
// Record all system actions for compliance/debugging
// Params: actionType (string), targetElement (ID), details (object)
// Stored in auditLog array and persisted to localStorage
function logSystemAction(actionType, targetElement, details) {
  const activeSession = JSON.parse(sessionStorage.getItem('activeUser'));
  const actor = activeSession ? activeSession.email : 'SYSTEM';
  
  const logEntry = {
    timestamp: new Date().toISOString(),
    actor: actor,
    action: actionType,
    target: targetElement,
    details: details
  };

  auditLog.unshift(logEntry);
  
  // Cap the log at 1000 entries to prevent localStorage bloat
  if (auditLog.length > 1000) auditLog.pop();
  
  localStorage.setItem('wardflow_audit', JSON.stringify(auditLog));
}

let wards = []; // This will be rebuilt dynamically every time syncData() runs

// ====== DATA SYNCHRONIZATION ENGINE ======
// CRITICAL: Rebuilds wards[] and teams[] from patient data after ANY change
// Called by: refreshDashboard() (after admit/discharge/transfer)
// Updates occupancy counts, ward assignments, team workload
function syncData() {
  // Rebuild wards array from memory configs to respect customized capacities
  wards = wardConfigs.map(wc => ({
    name: wc.name, beds: parseInt(wc.beds), status: wc.status, occ: 0, patients: []
  }));
  teams.forEach(t => { t.count = 0; t.wards = []; t.patients = []; });

  patients.forEach(p => {
    const wardObj = wards.find(w => w.name === p.ward);
    if (wardObj) {
      wardObj.occ++;
      wardObj.patients.push(`${p.name.split(' ')[0]} ${p.age}y`);
    }

    const teamObj = teams.find(t => t.name === p.team || t.name === 'Team ' + p.team || ('Team ' + t.name) === p.team);
    if (teamObj) {
      teamObj.count++;
      teamObj.patients.push({ name: p.name, age: p.age, ward: p.ward });
      
      const teamWard = teamObj.wards.find(tw => tw.ward === p.ward);
      if (teamWard) {
        teamWard.num++;
      } else {
        teamObj.wards.push({ num: 1, ward: p.ward });
      }
    }
  });

}

// ====== DASHBOARD REFRESH ======
// CRITICAL: Rebuild ALL UI after data changes
// Sequence: Save to localStorage -> Recalculate stats -> Update all views
function refreshDashboard() {
  saveData();
  syncData();       
  filterTable(); 
  renderWards();
  renderTeams();
  updateGlobalStats();     
  updateAdmissionsStats();
  updateOperationalKpis();
}

// ====== STATS & TRACKING ======
let admissionsToday = 0;
let transfersToday = 0;
let dischargedToday = 0;

function updateGlobalStats() {
  const occEl = document.getElementById('globalOccupancy');
  const teamsEl = document.getElementById('globalTeams');
  const sysBeds = document.getElementById('sysTotalBeds');
  const anaTotalOccEl = document.getElementById('anaTotalOccupancy');
  const anaTotalOccPctEl = document.getElementById('anaTotalOccupancyPct');
  const anaOccProgressEl = document.getElementById('anaOccupancyProgress');
  const anaGlobalTeamsEl = document.getElementById('anaGlobalTeams');

  const totalBeds = wards.reduce((sum, w) => sum + w.beds, 0);
  const totalPatients = patients.length;
  const occupancyPct = Math.round((totalPatients / totalBeds) * 100) || 0;

  if (occEl) {
    occEl.textContent = `${totalPatients}/${totalBeds} (${occupancyPct}%)`;
  }
  if (teamsEl) {
    teamsEl.textContent = teams.length;
  }
  if (sysBeds) {
    sysBeds.textContent = wards.reduce((sum, w) => sum + w.beds, 0);
  }
  if (anaTotalOccEl) {
    anaTotalOccEl.textContent = `${totalPatients}/${totalBeds}`;
  }
  if (anaTotalOccPctEl) {
    anaTotalOccPctEl.textContent = `${occupancyPct}%`;
  }
  if (anaOccProgressEl) {
    anaOccProgressEl.style.width = `${Math.max(0, Math.min(100, occupancyPct))}%`;
    anaOccProgressEl.classList.remove('warning', 'danger');
    if (occupancyPct >= 90) {
      anaOccProgressEl.classList.add('danger');
    } else if (occupancyPct >= 85) {
      anaOccProgressEl.classList.add('warning');
    }
  }
  if (anaGlobalTeamsEl) {
    anaGlobalTeamsEl.textContent = teams.length;
  }
}

function updateAdmissionsStats() {
  const globalAdmissionsEl = document.getElementById('globalAdmissions');
  const globalTransfersEl = document.getElementById('globalTransfers');
  const globalDischargedEl = document.getElementById('globalDischarged');
  const anaAdmissionsEl = document.getElementById('anaAdmissions');
  const anaTransfersEl = document.getElementById('anaTransfers');
  const anaDischargedEl = document.getElementById('anaDischarged');

  if (globalAdmissionsEl) globalAdmissionsEl.textContent = admissionsToday;
  if (globalTransfersEl) globalTransfersEl.textContent = transfersToday;
  if (globalDischargedEl) globalDischargedEl.textContent = dischargedToday;

  if (anaAdmissionsEl) anaAdmissionsEl.textContent = admissionsToday;
  if (anaTransfersEl) anaTransfersEl.textContent = transfersToday;
  if (anaDischargedEl) anaDischargedEl.textContent = dischargedToday;
}

function updateOperationalKpis() {
  const totalPatients = patients.length;
  const anaPendingAdmissionsEl = document.getElementById('anaPendingAdmissions');
  const anaBottleneckAlertEl = document.getElementById('anaBottleneckAlert');

  const avgTreatments = totalPatients > 0
    ? patients.reduce((sum, p) => sum + (p.treatments || []).length, 0) / totalPatients
    : 0;
  const estimatedAlos = (2 + avgTreatments * 0.8).toFixed(1);

  const pendingAdmissions = patients.filter(p => {
    if (!p.bed) return true;
    const bedLabel = String(p.bed).trim().toLowerCase();
    return bedLabel === '' || bedLabel === 'unassigned' || bedLabel === 'n/a' || bedLabel === '--';
  }).length;

  const bottleneckWards = wards
    .map(w => ({
      name: w.name,
      occPct: w.beds > 0 ? (w.occ / w.beds) * 100 : 0
    }))
    .filter(w => w.occPct > 90)
    .sort((a, b) => b.occPct - a.occPct);
  const bottleneckText = bottleneckWards.length > 0
    ? `${bottleneckWards[0].name} ${Math.round(bottleneckWards[0].occPct)}%`
    : 'No ward above 90%';

  const anaAlosEl = document.getElementById('anaAlos');

  if (anaPendingAdmissionsEl) anaPendingAdmissionsEl.textContent = String(pendingAdmissions);
  if (anaBottleneckAlertEl) {
    anaBottleneckAlertEl.textContent = bottleneckText;
    anaBottleneckAlertEl.classList.toggle('status-alert', bottleneckWards.length > 0);
    anaBottleneckAlertEl.classList.toggle('status-clear', bottleneckWards.length === 0);
  }
  if (anaAlosEl) anaAlosEl.textContent = `${estimatedAlos}d`;
}

// ====== UTILITIES: SORTING, THEMING, TIME ======
let currentSortCol = '';
let currentSortAsc = true;

function sortTable(col) {
  if (currentSortCol === col) {
    currentSortAsc = !currentSortAsc;
  } else {
    currentSortCol = col;
    currentSortAsc = true;
  }

  patients.sort((a, b) => {
    let valA = a[col];
    let valB = b[col];

    if (col === 'age') {
      valA = valA === '—' ? 0 : parseInt(valA);
      valB = valB === '—' ? 0 : parseInt(valB);
    }

    if (valA < valB) return currentSortAsc ? -1 : 1;
    if (valA > valB) return currentSortAsc ? 1 : -1;
    return 0;
  });

  document.querySelectorAll('.sort-icon').forEach(icon => icon.textContent = '');
  
  const activeHeader = document.getElementById('th-' + col);
  if (activeHeader) {
    activeHeader.querySelector('.sort-icon').textContent = currentSortAsc ? ' ▲' : ' ▼';
  }

  filterTable(); 
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('wardflow_theme', newTheme);
}

function showToast(message, type = 'success') {
  if (!message) return;

  const toast = document.createElement('div');
  toast.className = `app-toast ${type}`;
  toast.textContent = message;

  document.body.appendChild(toast);

  // Trigger CSS transition after insertion.
  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 220);
  }, 2200);
}

if (localStorage.getItem('wardflow_theme') === 'dark') {
  document.documentElement.setAttribute('data-theme', 'dark');
}

function updateClock() {
  const clockEl = document.getElementById('shiftClock');
  if (!clockEl) return;

  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const timeString = `${hours.toString().padStart(2, '0')}:${minutes}`;

  const isDayShift = hours >= 8 && hours < 20;

  if (isDayShift) {
    clockEl.className = 'shift-clock day';
    clockEl.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
      <span>${timeString} • Day Shift</span>
    `;
  } else {
    clockEl.className = 'shift-clock night';
    clockEl.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
      <span>${timeString} • Night Shift</span>
    `;
  }
}

updateClock();
setInterval(updateClock, 10000);

function togglePasswordVisibility() {
  const input = document.getElementById('loginPassword');
  const icon = document.getElementById('eyeIcon');
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    icon.innerHTML = `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>`;
  } else {
    input.type = 'password';
    icon.innerHTML = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  }
}

// ====== USER PROFILE & MODALS ======
function toggleProfileMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('profileMenu');
  if (menu) menu.classList.toggle('open');
}

function openUserModal(type) {
  const titleEl = document.getElementById('userModalTitle');
  const descEl = document.getElementById('userModalDesc');
  const contentEl = document.getElementById('userModalContent');
  const currentLanguage = typeof getCurrentLanguage === 'function' ? getCurrentLanguage() : 'en';
  
  if (type === 'profile') {
    const u = JSON.parse(sessionStorage.getItem('activeUser')) || {};
    const initials = (u.name || '?').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    titleEl.textContent = typeof t === 'function' ? t('profile_title', 'My Profile') : 'My Profile';
    descEl.textContent = typeof t === 'function' ? t('profile_desc', 'View your administrative credentials and assignments.') : 'View your administrative credentials and assignments.';
    contentEl.innerHTML = `
      <div style="display:flex; gap:16px; align-items:center; margin-bottom:16px;">
        <div style="width:60px; height:60px; border-radius:50%; background:#E1F5EE; display:flex; align-items:center; justify-content:center; font-size:24px; font-weight:bold; color:#0F6E56;">${initials}</div>
        <div>
          <div style="font-size:16px; font-weight:500;">${u.name || 'Unknown'}</div>
          <div style="font-size:13px; color:var(--color-text-secondary);">${u.role || '—'}</div>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Role</label><input class="form-input" value="${u.role || '—'}" disabled/></div>
        <div class="form-group"><label class="form-label">Email</label><input class="form-input" value="${u.email || '—'}" disabled/></div>
      </div>
    `;
  } 
  else if (type === 'settings') {
    titleEl.textContent = typeof t === 'function' ? t('settings_title', 'Account Settings') : 'Account Settings';
    descEl.textContent = typeof t === 'function' ? t('settings_desc', 'Manage your preferences and security.') : 'Manage your preferences and security.';
    const languageOptions = typeof getLanguageOptions === 'function' ? getLanguageOptions() : [
      { code: 'en', label: 'English' },
      { code: 'fr', label: 'French' },
      { code: 'es', label: 'Spanish' },
      { code: 'zh', label: 'Chinese' },
      { code: 'ar', label: 'Arabic' }
    ];
    contentEl.innerHTML = `
      <div style="font-size:13px; font-weight:500; margin-bottom:8px;">${typeof t === 'function' ? t('settings_notifications', 'Notifications') : 'Notifications'}</div>
      <label style="display:flex; align-items:center; gap:8px; font-size:13px; margin-bottom:8px; cursor:pointer;"><input type="checkbox" checked> Email alerts for capacity limits</label>
      <label style="display:flex; align-items:center; gap:8px; font-size:13px; margin-bottom:16px; cursor:pointer;"><input type="checkbox" checked> Daily census summary</label>

      <div style="font-size:13px; font-weight:500; margin-bottom:8px;">${typeof t === 'function' ? t('settings_language_label', 'App language') : 'App language'}</div>
      <div style="font-size:12px; color:var(--color-text-secondary); margin-bottom:8px;">${typeof t === 'function' ? t('settings_language_help', 'Choose the language used across the interface.') : 'Choose the language used across the interface.'}</div>
      <div class="form-group" style="margin-bottom:16px;">
        <select class="form-select" id="accountLanguageSelect">
          ${languageOptions.map(option => `<option value="${option.code}" ${option.code === currentLanguage ? 'selected' : ''}>${option.label}</option>`).join('')}
        </select>
      </div>

      <div style="font-size:13px; font-weight:500; margin-bottom:8px;">${typeof t === 'function' ? t('settings_security', 'Security') : 'Security'}</div>
      <button class="sys-btn" style="width:100%; margin-bottom:8px;">${typeof t === 'function' ? t('settings_change_password', 'Change Password') : 'Change Password'}</button>
      <button class="sys-btn" style="width:100%; margin-bottom:12px;">${typeof t === 'function' ? t('settings_2fa', 'Setup Two-Factor Auth (2FA)') : 'Setup Two-Factor Auth (2FA)'}</button>
      <button class="btn-primary" type="button" style="width:100%;" onclick="applyLanguagePreference(document.getElementById('accountLanguageSelect').value)">${typeof t === 'function' ? t('settings_save_language', 'Save Language') : 'Save Language'}</button>
    `;
  } 
  else if (type === 'support') {
    titleEl.textContent = typeof t === 'function' ? t('support_title', 'Help & Support') : 'Help & Support';
    descEl.textContent = typeof t === 'function' ? t('support_desc', 'Get assistance with the WardFlow system.') : 'Get assistance with the WardFlow system.';
    contentEl.innerHTML = `
      <div class="sys-section" style="padding:12px; margin-bottom:12px;">
        <div style="font-weight:500; margin-bottom:4px;">${typeof t === 'function' ? t('support_it_helpdesk', 'IT Helpdesk') : 'IT Helpdesk'}</div>
        <div style="font-size:12px; color:var(--color-text-secondary);">Ext: 4400<br>Email: it-support@hospital.com</div>
      </div>
      <div class="sys-section" style="padding:12px;">
        <div style="font-weight:500; margin-bottom:4px;">${typeof t === 'function' ? t('support_docs', 'Documentation') : 'Documentation'}</div>
        <a href="#" style="font-size:12px; color:#1D9E75; text-decoration:none; display:block; margin-bottom:4px;">WardFlow Administrator Guide (PDF)</a>
      </div>
    `;
  }
  
  document.getElementById('userModal').classList.add('open');
}

function applyStaticTranslations() {
  if (typeof t !== 'function') return;

  const setElementTextPreserveChildren = (element, translated) => {
    if (!element) return;
    if (element.childElementCount === 0) {
      element.textContent = translated;
      return;
    }

    const firstTextNode = Array.from(element.childNodes).find(
      node => node.nodeType === Node.TEXT_NODE && node.nodeValue.trim().length > 0
    );
    if (firstTextNode) {
      const hasTrailingSpace = /\s$/.test(firstTextNode.nodeValue);
      firstTextNode.nodeValue = hasTrailingSpace ? `${translated} ` : translated;
      return;
    }

    element.insertBefore(document.createTextNode(`${translated} `), element.firstChild || null);
  };

  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    if (!key) return;

    const translated = t(key, element.textContent || '');
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      element.placeholder = translated;
      return;
    }

    setElementTextPreserveChildren(element, translated);
  });

  const pageTitle = document.querySelector('[data-i18n-page-title]');
  if (pageTitle) {
    document.title = t(pageTitle.getAttribute('data-i18n-page-title'), document.title);
  }
}

// ====== APPLY SECURITY & UI CUSTOMIZATION ======
// Called on page load to hide/disable features based on user permissions
function applySecurityAndProfile() {
  const activeUser = JSON.parse(sessionStorage.getItem('activeUser'));
  if (!activeUser) return;
  const perms = getPerms();

  // Context-aware topbar/stats behavior: analytics page is read-only for admits,
  // but still supports global patient search from the shared top bar.
  if (document.getElementById('page-analytics')) {
    const admitBtn = document.querySelector('.admit-btn');
    if (admitBtn) admitBtn.style.display = 'none';
  }

  // Personalize topbar profile
  const avatarEl = document.querySelector('.profile-avatar');
  const headerName = document.querySelector('.profile-header strong');
  const headerRole = document.querySelector('.profile-header span');
  if (avatarEl) {
    const initials = activeUser.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    avatarEl.textContent = initials;
  }
  if (headerName) headerName.textContent = activeUser.name;
  if (headerRole) headerRole.textContent = activeUser.role;

  // Hide System Management if not permitted
  if (!perms.manageAccounts) {
    document.querySelectorAll('.nav-item').forEach(item => {
      if (item.textContent.includes('System Management')) item.style.display = 'none';
    });
  }

  if (!perms.viewReports) {
    document.querySelectorAll('.nav-item').forEach(item => {
      if (item.textContent.includes('Analytics Dashboard')) item.style.display = 'none';
    });

    if (document.getElementById('page-analytics')) {
      alert('Access denied: You do not have permission to view Analytics Dashboard.');
      window.location.href = 'index.html';
      return;
    }
  }

  // Hide buttons by permission
  if (!perms.admit) {
    const admitBtn = document.querySelector('.admit-btn');
    if (admitBtn) admitBtn.style.display = 'none';
  }

  if (!perms.discharge) {
    document.querySelectorAll('.btn-danger').forEach(btn => {
      if (btn.textContent.trim() === 'Discharge') btn.style.display = 'none';
    });
  }

  if (!perms.transfer) {
    document.querySelectorAll('.action-btn.transfer').forEach(btn => btn.style.display = 'none');
    document.querySelectorAll('.btn-primary').forEach(btn => {
      if (btn.textContent.trim() === 'Transfer') btn.style.display = 'none';
    });
  }

  if (!perms.logTreatment) {
    document.querySelectorAll('.action-btn.log').forEach(btn => btn.style.display = 'none');
  }

  // Disable system management buttons by specific permission
  const sysPage = document.getElementById('page-system');
  if (sysPage) {
    if (!perms.manageStaff) {
      document.querySelectorAll('.sys-btn').forEach(btn => {
        if (btn.textContent.includes('Manage team') || btn.textContent.includes('Staff roster')) {
          btn.disabled = true;
          btn.title = 'Insufficient permissions';
          btn.style.opacity = '0.45';
          btn.style.cursor = 'not-allowed';
        }
      });
    }
    if (!perms.manageAccounts) {
      document.querySelectorAll('.sys-btn').forEach(btn => {
        if (btn.textContent.includes('Manage accounts') || btn.textContent.includes('User roles') || btn.textContent.includes('Permissions')) {
          btn.disabled = true;
          btn.title = 'Insufficient permissions';
          btn.style.opacity = '0.45';
          btn.style.cursor = 'not-allowed';
        }
      });
    }
    if (!perms.manageWards) {
      document.querySelectorAll('.sys-btn').forEach(btn => {
        if (btn.textContent.includes('Edit wards')) {
          btn.disabled = true;
          btn.title = 'Insufficient permissions';
          btn.style.opacity = '0.45';
          btn.style.cursor = 'not-allowed';
        }
      });
    }
    if (!perms.exportData) {
      document.querySelectorAll('.sys-btn').forEach(btn => {
        if (btn.textContent.includes('Export data')) {
          btn.disabled = true;
          btn.title = 'Insufficient permissions';
          btn.style.opacity = '0.45';
          btn.style.cursor = 'not-allowed';
        }
      });
    }
    if (!perms.viewReports) {
      document.querySelectorAll('.sys-btn').forEach(btn => {
        if (btn.textContent.includes('View reports') || btn.textContent.includes('View history')) {
          btn.disabled = true;
          btn.title = 'Insufficient permissions';
          btn.style.opacity = '0.45';
          btn.style.cursor = 'not-allowed';
        }
      });
    }

    const pageHeader = sysPage.querySelector('.page-header p');
    if (pageHeader) {
      const existingBadge = pageHeader.querySelector('.role-badge');
      if (!existingBadge) {
        pageHeader.insertAdjacentHTML('beforeend', ` &nbsp;<span class="role-badge" style="font-size:11px; background:#E1F5EE; color:#0F6E56; padding:2px 8px; border-radius:20px; font-weight:500;">${activeUser.role}</span>`);
      }
    }
  }
}

// Close dropdown menus when clicking elsewhere
document.addEventListener('click', (e) => {
  const alertsMenu = document.getElementById('alertsMenu');
  if (alertsMenu && alertsMenu.classList.contains('open') && !e.target.closest('.icon-btn[title="Alerts"]')) {
    alertsMenu.classList.remove('open');
  }
  
  const profileMenu = document.getElementById('profileMenu');
  if (profileMenu && profileMenu.classList.contains('open') && !e.target.closest('.profile-avatar')) {
    profileMenu.classList.remove('open');
  }

  const searchMenu = document.getElementById('globalSearchResults');
  if (searchMenu && searchMenu.classList.contains('open') && !e.target.closest('.search-bar')) {
    searchMenu.classList.remove('open');
  }
});

// ====== PAGE INITIALIZATION ======
// This runs on EVERY page load after all modules are loaded
async function initializeApp() {
  await loadBackendState();

  const params = new URLSearchParams(window.location.search);
  const initialWardScope = (params.get('ward') || '').trim();
  const initialTeamScope = (params.get('team') || '').trim();
  const initialKpiScope = (params.get('kpi') || '').trim().toLowerCase();

  if (document.getElementById('page-census')) {
    const searchInput = document.getElementById('searchInput');
    if (searchInput && !searchInput.value) {
      if (initialWardScope) {
        searchInput.value = initialWardScope;
      } else if (initialTeamScope) {
        searchInput.value = initialTeamScope;
      }
    }
  }

  if (document.getElementById('page-admissions')) {
    const searchInput = document.getElementById('searchInput');
    if (searchInput && initialKpiScope) {
      const labels = {
        admissions: 'Admissions today',
        transfers: 'Transfers today',
        discharged: 'Discharged today'
      };
      const label = labels[initialKpiScope] || initialKpiScope;
      searchInput.placeholder = `KPI drill-through: ${label}`;
      searchInput.title = `KPI scope active: ${label}`;
    }
  }

  syncData(); 
  filterTable();
  renderWards();
  renderTeams();
  updateGlobalStats();
  updateAdmissionsStats();
  updateOperationalKpis();
  applySecurityAndProfile();
  applyStaticTranslations();

  if (document.getElementById('page-analytics') && typeof renderAnalyticsCharts === 'function') {
    renderAnalyticsCharts();
  }
}

setTimeout(() => {
  initializeApp();
}, 100);

function saveData() {
  localStorage.setItem('wardflow_users', JSON.stringify(systemUsers));
  localStorage.setItem('wardflow_patients', JSON.stringify(patients));
  localStorage.setItem('wardflow_doctors', JSON.stringify(doctors));
  localStorage.setItem('wardflow_teams', JSON.stringify(teams));
  localStorage.setItem('wardflow_roles', JSON.stringify(availableRoles));
  localStorage.setItem('wardflow_wards', JSON.stringify(wardConfigs));
  localStorage.setItem('wardflow_roster', JSON.stringify(rosterData));
  localStorage.setItem('wardflow_perms', JSON.stringify(sysPerms));
  localStorage.setItem('wardflow_role_templates', JSON.stringify(roleTemplates));
}

async function hydratePatientTreatments(patientCode) {
  if (!patientCode) return;

  try {
    const result = await fetchBackendJson(`/patients/${encodeURIComponent(patientCode)}/treatments`);
    if (!result || !result.success) return;

    const patient = patients.find(p => p.id === patientCode);
    if (!patient) return;

    patient.treatments = (result.data || []).map(item => ({
      name: item.name,
      role: item.role,
      grade: item.grade
    }));

    if (typeof renderTreatments === 'function') {
      renderTreatments(patientCode);
    }
  } catch (error) {
    // Keep the modal functional even if treatment history endpoint is unavailable.
  }
}