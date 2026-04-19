// =============================================================================
// ui.js - Rendering Functions (Tables, Cards, Searches)
// =============================================================================
// PURPOSE: All DOM rendering logic for tables, wards, teams, and search results
// These functions convert data arrays into HTML and inject into page DOM
//
// CALLED BY: script.js after data changes
// DEPENDS ON: data.js (global state), auth.js (permissions)
// =============================================================================

// RENDER PATIENT TABLE: Convert filtered patient array to HTML table rows
// Called by: filterTable(), page initialization via syncData()
// IMPORTANT: This is permission-scoped - only shows getFilteredPatients()
function renderTable(data) {
  const tbody = document.getElementById('patientBody');
  if (!tbody) return;
  tbody.innerHTML = data.map(p => {
    return `<tr onclick="openDetail('${p.id}')" style="cursor: pointer;">
      <td>${p.id}</td>
      <td style="font-weight:500;">${p.name}</td>
      <td>${p.age}</td>
      <td>${p.sex}</td>
      <td>${p.ward}</td>
      <td>${p.bed}</td>
      <td><button class="action-btn transfer" onclick="event.stopPropagation(); openTransfer('${p.id}')">Transfer</button></td>
      <td><button class="action-btn log" onclick="event.stopPropagation(); openDetail('${p.id}')">Log Treatment</button></td>
    </tr>`;
  }).join('');
}

// SEARCH & FILTER: Real-time patient search (called on every keystroke in search box)
// Filters patients by name, ward, or patient ID
// Shows dropdown with matching results that can be clicked to open detail modal
function filterTable() {
  const searchEl = document.getElementById('searchInput');
  const q = searchEl ? searchEl.value.toLowerCase() : '';
  const params = new URLSearchParams(window.location.search);
  const wardScope = (params.get('ward') || '').trim().toLowerCase();
  const teamScope = (params.get('team') || '').trim().toLowerCase();
  const kpiScope = (params.get('kpi') || '').trim().toLowerCase();
  let results = getFilteredPatients();

  if (wardScope) {
    results = results.filter(p => (p.ward || '').toLowerCase() === wardScope);
  }

  if (teamScope) {
    results = results.filter(p => {
      const teamName = (p.team || '').toLowerCase();
      const teamCode = teamName.replace(/^team\s+/i, '').trim();
      return teamName === teamScope || teamCode === teamScope;
    });
  }

  if (kpiScope) {
    const actionMap = {
      admissions: 'PATIENT_ADMIT',
      transfers: 'PATIENT_TRANSFER',
      discharged: 'PATIENT_DISCHARGE'
    };
    const targetAction = actionMap[kpiScope];

    if (targetAction) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const ids = new Set(
        (auditLog || [])
          .filter(log => String(log?.action || '').toUpperCase() === targetAction)
          .filter(log => {
            const ts = new Date(log?.timestamp || 0);
            return !Number.isNaN(ts.getTime()) && ts >= todayStart;
          })
          .map(log => String(log?.target || '').trim())
          .filter(Boolean)
      );

      if (kpiScope === 'discharged') {
        // Discharged patients leave active census; keep table empty if no active rows match.
        results = results.filter(p => ids.has(String(p.id)));
      } else {
        results = results.filter(p => ids.has(String(p.id)));
      }
    }
  }

  if (q) {
    results = results.filter(p => 
      p.name.toLowerCase().includes(q) || 
      p.ward.toLowerCase().includes(q) || 
      p.id.includes(q)
    );
  }

  const tbody = document.getElementById('patientBody');
  if (tbody) renderTable(results);

  let dropdown = document.getElementById('globalSearchResults');
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.id = 'globalSearchResults';
    dropdown.className = 'search-results';
    const searchBarWrap = document.querySelector('.search-bar');
    if (searchBarWrap) searchBarWrap.appendChild(dropdown);
  }

  if (!q) {
    dropdown.classList.remove('open');
    return;
  }

  if (results.length === 0) {
     dropdown.innerHTML = `<div class="search-result-item"><div class="search-result-name" style="color: var(--color-text-secondary);">No patients found...</div></div>`;
  } else {
     dropdown.innerHTML = results.map(p => `
       <div class="search-result-item" onclick="openDetail('${p.id}'); document.getElementById('globalSearchResults').classList.remove('open'); if(document.getElementById('searchInput')) { document.getElementById('searchInput').value = ''; filterTable(); }">
         <div class="search-result-name">${p.name} (ID: ${p.id})</div>
         <div class="search-result-meta">${p.ward} • ${p.team}</div>
       </div>
     `).join('');
  }
  dropdown.classList.add('open');
}

function getRouteScopes() {
  const params = new URLSearchParams(window.location.search);
  return {
    wardScope: (params.get('ward') || '').trim().toLowerCase(),
    teamScope: (params.get('team') || '').trim().toLowerCase(),
    activeScope: (params.get('active') || '').trim().toLowerCase() === 'true',
    occupiedScope: (params.get('occupied') || '').trim().toLowerCase() === 'true',
    wardOnlyScope: (params.get('wardOnly') || '').trim().toLowerCase() === 'true'
  };
}

function formatTeamScopeLabel(teamScope) {
  const value = String(teamScope || '').trim();
  if (!value) return '';
  return /^team\s+/i.test(value) ? value : `Team ${value}`;
}

function renderWorkloadScopeBadge() {
  const badge = document.getElementById('workloadScopeBadge');
  if (!badge) return;

  const params = new URLSearchParams(window.location.search);
  const wardLabel = (params.get('ward') || '').trim();
  const teamLabel = (params.get('team') || '').trim();
  const { wardScope, teamScope, activeScope } = getRouteScopes();
  const bits = [];

  if (wardScope) bits.push(`Ward: ${wardLabel || wardScope}`);
  if (teamScope) bits.push(`Team: ${formatTeamScopeLabel(teamLabel || teamScope)}`);
  if (activeScope) bits.push('Active teams only');

  if (bits.length === 0) {
    badge.style.display = 'none';
    badge.textContent = '';
    return;
  }

  badge.className = 'scope-pill scope-pill-limited';
  badge.textContent = `Filter: ${bits.join(' | ')}`;
  badge.style.display = 'inline-flex';
}

// RENDER WARD CARDS: Display occupancy info and recent admissions for each ward
// Called by: page init, after patient transfers/admissions/discharges
// Shows occupancy bar, bed count, and last 3 admitted patients per ward
function renderWards() {
  const grid = document.getElementById('wardGrid');
  if (grid) {
    const { wardScope, teamScope, occupiedScope, wardOnlyScope } = getRouteScopes();
    let effectiveTeamScope = teamScope;
    const visiblePatients = getFilteredPatients();

    let scopedWards = wards;

    if (wardScope) {
      scopedWards = scopedWards.filter(w => (w.name || '').toLowerCase() === wardScope);
    }

    if (wardOnlyScope && wardScope) {
      effectiveTeamScope = '';
    }

    if (effectiveTeamScope) {
      const teamCode = effectiveTeamScope.replace(/^team\s+/i, '').trim();
      scopedWards = scopedWards.filter(w => visiblePatients.some((p) => {
        const pTeamName = (p.team || '').toLowerCase();
        const pTeamCode = pTeamName.replace(/^team\s+/i, '').trim();
        return (p.ward || '').toLowerCase() === (w.name || '').toLowerCase() && (pTeamName === effectiveTeamScope || pTeamCode === teamCode);
      }));
    }

    if (occupiedScope) {
      scopedWards = scopedWards.filter(w => Number(w.occ) > 0);
    }

    grid.innerHTML = scopedWards.map(w => `
      <div class="ward-card">
        <div class="ward-name">${w.name} Ward</div>
        <div class="ward-beds">${w.occ} / ${w.beds} Beds Occupied</div>
        <div class="occ-label"><span>Occupancy</span><span>${Math.round((w.occ/w.beds)*100) || 0}%</span></div>
        <div class="occ-bar"><div class="occ-fill ${w.occ>=w.beds?'high':''}" style="width:${Math.min(100, (w.occ/w.beds)*100)}%"></div></div>
        <div class="pt-list">
          <div class="pt-list-label">Recent Admissions</div>
          ${w.patients.slice(0, 3).map(p => `<div class="pt-row"><span>${p}</span></div>`).join('')}
        </div>
      </div>`).join('');

    if (!grid.innerHTML.trim()) {
      grid.innerHTML = '<div class="sys-section" style="grid-column: 1 / -1; margin-bottom: 0;"><div class="sys-section-desc">No wards match the current analytics drill-through scope.</div></div>';
    }
  }
}

// RENDER TEAM CARDS: Display team workload, patient list, ward assignments
// Called by: page init, after patient operations
// Each team card shows: total patient count, ward breakdown, expandable patient list
function renderTeams() {
  const grid = document.getElementById('teamGrid');
  if (grid) {
    renderWorkloadScopeBadge();

    const { wardScope, teamScope, activeScope } = getRouteScopes();

    const scopedTeams = teams.filter((t) => {
      const normalizedName = (t.name || '').toLowerCase();
      const normalizedCode = normalizedName.replace(/^team\s+/i, '').trim();

      if (teamScope && normalizedName !== `team ${teamScope.replace(/^team\s+/i, '').trim()}` && normalizedCode !== teamScope.replace(/^team\s+/i, '').trim()) {
        return false;
      }

      if (wardScope) {
        const hasWard = (t.wards || []).some((w) => (w.ward || '').toLowerCase() === wardScope);
        if (!hasWard) return false;
      }

      if (activeScope && Number(t.count) <= 0) {
        return false;
      }

      return true;
    });

    grid.innerHTML = scopedTeams.map((t,i) => {
      const teamStaffCount = doctors.filter(d => d.team === t.name).length;
      const patientsPerStaff = teamStaffCount > 0 ? (t.count / teamStaffCount) : Infinity;
      const ratioColor = patientsPerStaff > 6 ? '#D85A30' : (patientsPerStaff < 4 ? '#1D9E75' : 'var(--color-text-primary)');
      const ratioValue = Number.isFinite(patientsPerStaff) ? `1:${patientsPerStaff.toFixed(1)}` : 'No staff assigned';

      return `
      <div class="team-card">
        <div class="team-name">${t.name}</div>
        <div class="team-count">${t.count} patients assigned</div>
        <div style="font-size:12px; margin-bottom:10px; color:${ratioColor}; font-weight:500;">Staff-to-Patient Ratio: ${ratioValue}</div>
        <div class="occ-bar" style="margin-bottom:12px"><div class="occ-fill ${t.count>=10?'high':''}" style="width:${Math.min(100,t.count/20*100)}%"></div></div>
        <div class="team-wards">
          ${t.wards.map(w=>`<div class="team-ward-stat"><span class="num">${w.num}</span><span class="wname">${w.ward}</span></div>`).join('')}
        </div>
        <button class="team-expand-btn" onclick="toggleTeam(${i})">
          View patient list <span id="arr${i}">▾</span>
        </button>
        <div class="team-patient-list" id="tpl${i}">
          ${t.patients.map(p=>`<div class="team-pt-row"><span style="font-weight:500">${p.name}</span><span style="color:var(--color-text-secondary)">${p.ward}</span></div>`).join('')}
        </div>
      </div>`;
    }).join('');

    if (!grid.innerHTML.trim()) {
      grid.innerHTML = '<div class="sys-section" style="grid-column: 1 / -1; margin-bottom: 0;"><div class="sys-section-desc">No teams match the current analytics drill-through scope.</div></div>';
    }
  }
}

// EXPAND/COLLAPSE: Toggle team patient list visibility
function toggleTeam(i) {
  const el = document.getElementById('tpl'+i);
  const arr = document.getElementById('arr'+i);
  el.classList.toggle('open');
  arr.textContent = el.classList.contains('open') ? '▴' : '▾';
}

// RENDER TREATMENTS: Display treatment history for a patient in table format
// Called by: openDetail() when opening patient modal
function renderTreatments(id) {
  const p = patients.find(x => x.id === id);
  const tbody = document.getElementById('detailDoctors');
  if (!p || !tbody) return;

  if (p.treatments.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color: var(--color-text-secondary); padding: 16px;">No treatments recorded yet.</td></tr>';
  } else {
    tbody.innerHTML = p.treatments.map(t => `
      <tr>
        <td style="font-weight: 500;">${t.name}</td>
        <td>${t.role}</td>
        <td>${t.grade}</td>
      </tr>
    `).join('');
  }
}