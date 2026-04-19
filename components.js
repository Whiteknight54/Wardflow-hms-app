// =============================================================================
// components.js - Shared UI Component Renderers
// =============================================================================
// PURPOSE: Generate reusable UI elements (topbar, sidebar, modals, stats)
// These functions are called by components.js injectComponents() which inserts
// the HTML into slot divs on each page.
//
// LOAD ORDER: Loaded FIRST before data.js (doesn't depend on any data)
// Not executable on its own - functions are called by injectComponents()
// =============================================================================

// RENDER TOPBAR: Header with logo, theme toggle, search, user profile
function renderTopbar() {
  return `
    <div class="topbar">
      <div class="logo-icon">
        <svg viewBox="0 0 20 20"><polyline points="2,10 6,4 10,14 14,6 18,10"/></svg>
      </div>
      <span class="app-title">${typeof t === 'function' ? t('app_title', 'WardFlow: Admissions &amp; Team Tracking') : 'WardFlow: Admissions &amp; Team Tracking'}</span>
      <div class="topbar-actions">
        <div id="shiftClock" class="shift-clock"></div>

        <button class="icon-btn theme-toggle-btn" title="Toggle Theme" onclick="toggleTheme()">
          <svg class="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
          
          <svg class="icon-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
        </button>
        <button class="icon-btn" title="${typeof t === 'function' ? t('topbar_search', 'Search') : 'Search'}" onclick="document.getElementById('searchInput').focus()">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="8" r="5"/><line x1="12" y1="12" x2="18" y2="18"/></svg>
        </button>
        
        <div style="position: relative; display: flex; align-items: center; margin-left: 8px;">
          <div class="profile-avatar" onclick="toggleProfileMenu(event)">AD</div>
          <div id="profileMenu" class="profile-dropdown">
            <div class="profile-header">
              <strong>Admin Account</strong>
              <span>System Administrator • Ward Operations</span>
            </div>
            <div class="profile-links">
              <a href="#" onclick="openUserModal('profile'); toggleProfileMenu(); return false;">${typeof t === 'function' ? t('topbar_profile', 'My Profile') : 'My Profile'}</a>
              <a href="#" onclick="openUserModal('settings'); toggleProfileMenu(); return false;">${typeof t === 'function' ? t('topbar_settings', 'Account Settings') : 'Account Settings'}</a>
              <a href="#" onclick="openUserModal('support'); toggleProfileMenu(); return false;">${typeof t === 'function' ? t('topbar_support', 'Help & Support') : 'Help & Support'}</a>
            </div>
            <div class="profile-logout" onclick="logout()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
              ${typeof t === 'function' ? t('topbar_logout', 'Log Out') : 'Log Out'}
            </div>
          </div>
        </div>

      </div>
    </div>`;
}

function getNavPerms() {
  const fallbackPerms = {
    admit: true,
    manageAccounts: true,
    viewReports: true,
    bedMatrix: true
  };

  if (typeof getPerms === 'function') {
    try {
      return { ...fallbackPerms, ...getPerms() };
    } catch (e) {
      // Fall through to session data while auth/script helpers are not yet loaded.
    }
  }

  const activeUser = JSON.parse(sessionStorage.getItem('activeUser') || 'null');
  if (activeUser && activeUser.permissions) {
    return { ...fallbackPerms, ...activeUser.permissions };
  }

  return fallbackPerms;
}

// RENDER STATS BAR: Second row with occupancy, teams count, search input, buttons
function renderStatsBar() {
  const perms = getNavPerms();
  return `
    <div class="stats-bar">
      <div class="stat-chip">
        <svg viewBox="0 0 20 20" fill="none" stroke="#1D9E75" stroke-width="1.5"><rect x="3" y="6" width="14" height="12" rx="1"/><path d="M7 6V4a3 3 0 016 0v2"/><line x1="10" y1="10" x2="10" y2="14"/><line x1="8" y1="12" x2="12" y2="12"/></svg>
        <div><div class="stat-label">${typeof t === 'function' ? t('stat_total_occupancy', 'Total Occupancy') : 'Total Occupancy'}</div><div class="stat-val" id="globalOccupancy">0/0 (0%)</div></div>
      </div>
      <div class="stat-chip">
        <svg viewBox="0 0 20 20" fill="none" stroke="#1D9E75" stroke-width="1.5"><circle cx="7" cy="8" r="3"/><circle cx="13" cy="8" r="3"/><path d="M1 18c0-4 3-6 6-6"/><path d="M13 12c3 0 6 2 6 6"/></svg>
        <div><div class="stat-label">${typeof t === 'function' ? t('stat_active_teams', 'Active Teams') : 'Active Teams'}</div><div class="stat-val" id="globalTeams">0</div></div>
      </div>
      <div class="stat-chip"><div><div class="stat-label">${typeof t === 'function' ? t('stat_admissions_today', 'Admissions Today') : 'Admissions Today'}</div><div class="stat-val" id="globalAdmissions">0</div></div></div>
      <div class="stat-chip"><div><div class="stat-label">${typeof t === 'function' ? t('stat_transfers_today', 'Transfers Today') : 'Transfers Today'}</div><div class="stat-val" id="globalTransfers">0</div></div></div>
      <div class="stat-chip"><div><div class="stat-label">${typeof t === 'function' ? t('stat_discharged_today', 'Discharged Today') : 'Discharged Today'}</div><div class="stat-val" id="globalDischarged">0</div></div></div>
      <div class="search-bar">
        <input class="search-input" type="text" placeholder="${typeof t === 'function' ? t('search_placeholder', 'Search patient...') : 'Search patient...'}" id="searchInput" oninput="filterTable()"/>
      </div>
      
      ${perms.bedMatrix ? `
      <button style="padding: 7px 14px; background: var(--color-background-secondary); color: var(--color-text-primary); border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-md); font-size: 13px; font-weight: 500; cursor: pointer; display: flex; align-items: center; gap: 6px; margin-right: 8px;" onclick="openBedMatrix()">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="14" height="14" rx="2"/><path d="M3 10h14M10 3v14"/></svg>
        ${typeof t === 'function' ? t('topbar_bed_matrix', 'Bed Matrix') : 'Bed Matrix'}
      </button>
      ` : ''}

      ${perms.admit ? `
      <button class="admit-btn" onclick="openAdmit()">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><line x1="10" y1="4" x2="10" y2="16"/><line x1="4" y1="10" x2="16" y2="10"/></svg>
        ${typeof t === 'function' ? t('topbar_admit', 'Admit Patient') : 'Admit Patient'}
      </button>
      ` : ''}
    </div>`;
}

// RENDER SIDEBAR: Navigation menu highlighting active page
// Params: activePage (string) - current page ID to highlight
function renderSidebar(activePage) {
  let perms = {};

  // Prefer shared permission helper when available, but keep sidebar RBAC
  // functional during early script load order on first paint.
  if (typeof getPerms === 'function') {
    try {
      perms = getPerms() || {};
    } catch (e) {
      perms = {};
    }
  }

  if (!perms || Object.keys(perms).length === 0) {
    const activeUser = JSON.parse(sessionStorage.getItem('activeUser') || 'null');
    if (activeUser && activeUser.permissions) {
      perms = activeUser.permissions;
    } else {
      perms = { manageAccounts: false, viewReports: false };
    }
  }

  const canManageSystem = Boolean(perms.manageAccounts);
  const canViewAnalytics = Boolean(perms.viewReports);

  const basePages = [
    { id: 'index',    href: 'index.html',    label: typeof t === 'function' ? t('nav_admissions', 'Admissions/Ward flow') : 'Admissions/Ward flow',
      icon: `<rect x="3" y="3" width="14" height="14" rx="2"/><line x1="7" y1="8" x2="13" y2="8"/><line x1="7" y1="11" x2="11" y2="11"/>` },
    { id: 'census',   href: 'census.html',   label: typeof t === 'function' ? t('nav_census', 'Ward Census') : 'Ward Census',
      icon: `<rect x="2" y="2" width="7" height="7" rx="1"/><rect x="11" y="2" width="7" height="7" rx="1"/><rect x="2" y="11" width="7" height="7" rx="1"/><rect x="11" y="11" width="7" height="7" rx="1"/>` },
    { id: 'workload', href: 'workload.html', label: typeof t === 'function' ? t('nav_workload', 'Team Workload') : 'Team Workload',
      icon: `<circle cx="7" cy="8" r="3"/><circle cx="13" cy="8" r="3"/><path d="M1 18c0-3 2-5 6-5"/><path d="M13 13c4 0 6 2 6 5"/>` }
  ];

  const pages = [
    ...basePages,
    ...(canViewAnalytics ? [{ id: 'analytics', href: 'analytics.html', label: typeof t === 'function' ? t('nav_analytics', 'Analytics Dashboard') : 'Analytics Dashboard',
      icon: `<line x1="3" y1="17" x2="17" y2="17"/><rect x="4" y="10" width="2.5" height="6" rx="0.5"/><rect x="8.5" y="7" width="2.5" height="9" rx="0.5"/><rect x="13" y="4" width="2.5" height="12" rx="0.5"/>` }] : []),
    ...(canManageSystem ? [{ id: 'system', href: 'system.html', label: typeof t === 'function' ? t('nav_system', 'System Management') : 'System Management',
      icon: `<circle cx="10" cy="10" r="3"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4"/>` }] : [])
  ];

  return `
    <div class="sidebar">
      ${pages.map(p => `
        <div class="nav-item ${p.id === activePage ? 'active' : ''}" onclick="window.location.href='${p.href}'">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">${p.icon}</svg>
          ${p.label}
        </div>`).join('')}
    </div>`;
}

// RENDER MODALS: All modal templates (admit, detail, transfer, bed matrix, etc)
// These are empty shells, content populated by script.js when modals open
function renderModals() {
  return `
    <div class="modal-overlay" id="bedModal">
      <div class="modal" style="width: 600px;">
        <div class="modal-title">${typeof t === 'function' ? t('topbar_bed_matrix', 'Live Bed Availability') : 'Live Bed Availability'}</div>
        <div class="modal-sub">${typeof t === 'function' ? t('bed_matrix_desc', 'View real-time bed status across all wards.') : 'View real-time bed status across all wards.'}</div>
        <button class="modal-close" onclick="closeBedMatrix()">✕</button>

        <div class="form-group" style="margin-bottom: 0;">
          <label class="form-label">${typeof t === 'function' ? t('bed_matrix_select_ward', 'Select Ward') : 'Select Ward'}</label>
          <select class="form-select" id="bedMatrixWard" onchange="renderBedMatrix(this.value)"></select>
        </div>

        <div class="bed-matrix" id="bedMatrixGrid"></div>
      </div>
    </div>
    <div class="modal-overlay" id="admitModal">
      <div class="modal">
        <div class="modal-title">${typeof t === 'function' ? t('topbar_admit', 'Admit Patient') : 'Admit Patient'}</div>
        <div class="modal-sub">${typeof t === 'function' ? t('admissions_desc', 'Register a new patient and assign ward &amp; care team') : 'Register a new patient and assign ward &amp; care team'}</div>
        <button class="modal-close" onclick="closeModal('admitModal')">✕</button>
        <div class="form-group"><label class="form-label">Name</label><input class="form-input" placeholder="Full name" id="admitName"/></div>
        <div class="form-row">
          <div class="form-row">
          <div class="form-group" style="margin:0"><label class="form-label">Sex</label><select class="form-select" id="admitSex"><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option></select></div>
          <div class="form-group" style="margin:0"><label class="form-label">Date of birth</label><input class="form-input" type="date" id="admitDob"/></div>
        </div>
        </div>
        <div class="form-group"><label class="form-label">Care team</label>
        <select class="form-select" id="admitTeam">
            <option value="Alpha">Team Alpha – Dr. House</option>
            <option value="Beta">Team Beta – Dr. Wilson</option>
            <option value="Gama">Team Gama – Dr. Chase</option>
            <option value="Delta">Team Delta – Dr. Cuddy</option>
            <option value="Zulu">Team Zulu – Dr. Foreman</option>
</select>
       </div>
        <div class="form-group">
          <label class="form-label">${typeof t === 'function' ? t('admit_ward_bed_label', 'Assign ward and preferred bed') : 'Assign ward and preferred bed'}</label>
          <button type="button" class="bed-picker-btn" id="admitBedPickerBtn" onclick="openAdmitBedPicker()">${typeof t === 'function' ? t('topbar_bed_matrix', 'Select ward and bed') : 'Select ward and bed'}</button>
          <div class="bed-picker-hint" id="admitBedHint">${typeof t === 'function' ? t('admit_bed_hint', 'No bed selected. A bed will be auto-assigned after you pick a ward.') : 'No bed selected. A bed will be auto-assigned after you pick a ward.'}</div>
          <input type="hidden" id="admitWard"/>
          <input type="hidden" id="admitBed"/>
        </div>
        <div class="modal-actions">
          <button class="btn-cancel" onclick="closeModal('admitModal')">Cancel</button>
          <button class="btn-primary" onclick="admitPatient()">Admit</button>
        </div>
      </div>
    </div>

   <div class="modal-overlay" id="detailModal">
      <div class="modal" style="width: 540px;"> 
        <div class="modal-title" id="detailName">Patient Detail</div>
        <button class="modal-close" onclick="closeModal('detailModal')">✕</button>
        
        <div class="pt-detail-meta" style="margin-bottom: 12px;">
          <div class="meta-item"><div class="meta-label">Responsible consultant</div><div class="meta-val" id="detailConsultant"></div></div>
          <div class="meta-item"><div class="meta-label">Team code</div><div class="meta-val" id="detailTeam"></div></div>
        </div>

        <div style="font-size:13px;font-weight:500;margin-bottom:8px; margin-top:16px;">Log New Treatment</div>
        <div class="form-row" style="align-items: flex-start;">
          <div class="form-group" style="margin:0; flex-grow: 1;">
            <select class="form-select" id="treatmentDoctorSelect"></select>
            <div id="treatmentError" style="color: #E24B4A; font-size: 11px; margin-top: 6px; display: none;"></div>
          </div>
          <button class="btn-primary" style="margin:0; height: 33px;" onclick="recordTreatment()">Record</button>
        </div>

        <div style="font-size:13px;font-weight:500;margin-bottom:8px; margin-top:20px;">Treatment History</div>
        <div class="table-wrap" style="margin-bottom:16px; max-height: 150px; overflow-y: auto;">
          <table>
            <thead><tr><th>Doctor Name</th><th>Role</th><th>Grade</th></tr></thead>
            <tbody id="detailDoctors"></tbody>
          </table>
        </div>
        
        <div class="modal-actions">
          <button class="btn-cancel" onclick="closeModal('detailModal')">Cancel</button>
          <button class="btn-primary" onclick="openTransferFromDetail()">Transfer</button>
          <button class="btn-danger" onclick="dischargePatient()">Discharge</button>
        </div>
        
        <div class="warn-text" style="color: var(--color-text-secondary); display: flex; align-items: center; gap: 6px; margin-top: 12px; font-size: 11px;">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="10" r="9"/><line x1="10" y1="10" x2="10" y2="14"/><line x1="10" y1="6" x2="10.01" y2="6"/></svg>
          Patient will be removed from this board upon discharge. Medical records remain in the central EHR.
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="transferModal">
      <div class="modal">
        <div class="modal-title">Transfer Patient</div>
        <button class="modal-close" onclick="closeModal('transferModal')">✕</button>
        <div class="pt-detail-meta" style="margin-bottom:16px;">
          <div class="meta-item"><div class="meta-label">Patient</div><div class="meta-val" id="transferName"></div></div>
          <div class="meta-item"><div class="meta-label">Team code</div><div class="meta-val" id="transferTeam"></div></div>
        </div>
        <div class="form-row">
          <div class="form-group" style="margin:0"><label class="form-label">Choose ward</label>
            <select class="form-select" id="transferWardSelect">
              <option>Surgery (4/7)</option>
              <option>ICU (14/20)</option>
              <option>General (20/30)</option>
            </select>
          </div>
          <div class="form-group" style="margin:0"><label class="form-label">Choose team</label>
            <select class="form-select" id="transferTeamSelect">
              <option>Team Beta</option><option>Team Gama</option><option>Team Delta</option><option>Team Zulu</option>
            </select>
          </div>
        </div>
        <div class="form-group"><label class="form-label">Transfer reason</label><textarea class="form-input" rows="3" style="resize:none;" placeholder="Enter reason for transfer..."></textarea></div>
        <div class="modal-actions">
          <button class="btn-cancel" onclick="closeModal('transferModal')">Cancel</button>
          <button class="btn-primary" onclick="doTransfer()">Transfer patient</button>
        </div>
        <div class="warn-text" style="color: var(--color-text-secondary); display: flex; align-items: center; gap: 6px; margin-top: 12px; font-size: 11px;">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="10" r="9"/><line x1="10" y1="10" x2="10" y2="14"/><line x1="10" y1="6" x2="10.01" y2="6"/></svg>
          Patient will be handed over and removed from this ward's active census.
        </div>
      </div>
    </div> <div class="modal-overlay" id="userModal">
      <div class="modal">
        <div class="modal-title" id="userModalTitle">Title</div>
        <div class="modal-sub" id="userModalDesc">Description</div>
        <button class="modal-close" onclick="closeModal('userModal')">✕</button>
        
        <div id="userModalContent" style="margin-bottom: 16px;"></div>
        
        <div class="modal-actions">
          <button class="btn-primary" onclick="closeModal('userModal')">Done</button>
        </div>
      </div>
    </div>
  `;
}

// INJECT COMPONENTS: Main entry point - renders all shared UI and inserts into slots
// Params: activePage (string) - used to highlight active nav item
// Called by: Every HTML page after loading components.js
function injectComponents(activePage) {
  document.getElementById('topbar-slot').outerHTML = renderTopbar();
  document.getElementById('statsbar-slot').outerHTML = renderStatsBar();
  document.getElementById('sidebar-slot').outerHTML = renderSidebar(activePage);
  document.getElementById('modals-slot').outerHTML = renderModals();
}