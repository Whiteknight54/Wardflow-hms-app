// =============================================================================
// actions.js - Patient Lifecycle Operations (Admit, Discharge, Transfer, Treat)
// =============================================================================
// PURPOSE: Core patient data manipulation functions
// Handles: Admit new patients, discharge, transfer between wards/teams, log treatments
//
// CALLED BY: User button clicks and form submissions
// DEPENDS ON: data.js (patients, doctors globals), auth.js (getPerms)
// SIDE EFFECTS: Modifies patients[], wardConfig, auditLog. Calls saveData() to persist.
// =============================================================================

function getApiBaseUrl() {
  if (typeof window.resolveApiBaseUrl === 'function') {
    return window.resolveApiBaseUrl();
  }
  return window.WARDFLOW_API_BASE_URL || '/api';
}

async function apiRequest(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = sessionStorage.getItem('wardflow_access_token') || JSON.parse(sessionStorage.getItem('activeUser') || 'null')?.token;
  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...options,
    headers
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const errorMessage = payload.detail || payload.error || `Request failed (${response.status})`;
    throw new Error(errorMessage);
  }

  return payload;
}

async function refreshFromBackendSnapshot() {
  if (typeof initializeApp === 'function') {
    await initializeApp();
    return;
  }
  refreshDashboard();
}

// ADMIT PATIENT: Create new patient record and assign to ward + team
// Params: None (reads from form fields in admitModal)
// Returns: void
// Side effects: Adds to patients[], wardObj.occ++, auditLog, calls refreshDashboard()
// Called by: admitModal form submit button
async function admitPatient() {
  if (!getPerms().admit) { showToast('You do not have permission to admit patients.', 'error'); return; }
  const name = document.getElementById('admitName').value.trim();
  if(!name) { showToast('Please enter a patient name.', 'error'); return; }

  const sexSelect = document.getElementById('admitSex');
  const sex = sexSelect ? sexSelect.value : '—'; 
  
  const dobInput = document.getElementById('admitDob');
  let age = '—';
  if (dobInput && dobInput.value) {
    const dob = new Date(dobInput.value);
    const diff = Date.now() - dob.getTime();
    age = Math.abs(new Date(diff).getUTCFullYear() - 1970); 
  }

  const wardName = (document.getElementById('admitWard').value || '').trim();
  const preferredBedLabel = (document.getElementById('admitBed')?.value || '').trim();
  if (!wardName) {
    showToast('Please select a ward and bed.', 'error');
    return;
  }

  const wardObj = wards.find(w => w.name === wardName);
  if (!wardObj) return;

  const patientsInWard = patients.filter(p => p.ward === wardName);
  const occupiedBeds = patientsInWard.map(p => {
    const match = p.bed.match(/\d+/); 
    return match ? parseInt(match[0]) : 0;
  });

  let bedLabelForAdmission = '';
  if (preferredBedLabel) {
    const selectedBedMatch = preferredBedLabel.match(/\d+/);
    const selectedBedNum = selectedBedMatch ? parseInt(selectedBedMatch[0], 10) : NaN;
    if (!Number.isFinite(selectedBedNum) || selectedBedNum < 1 || selectedBedNum > wardObj.beds) {
      showToast('Selected bed is invalid for this ward. Please reselect a bed.', 'error');
      return;
    }
    if (occupiedBeds.includes(selectedBedNum)) {
      showToast('Selected bed is no longer available. Please choose another bed.', 'error');
      return;
    }
    bedLabelForAdmission = `Bed ${selectedBedNum}`;
  } else {
    if (wardObj.occ >= wardObj.beds) {
      showToast(`Admission failed: ${wardName} Ward is at full capacity.`, 'error');
      return;
    }

    let availableBedNum = 1;
    while (occupiedBeds.includes(availableBedNum)) { availableBedNum++; }
    bedLabelForAdmission = `Bed ${availableBedNum}`;
  }
  
  const teamSelect = document.getElementById('admitTeam');
  const teamCode = teamSelect ? teamSelect.value : 'Alpha';
  const existingIds = new Set(patients.map(p => p.id));
  let newId;
  do { newId = String(Math.floor(Math.random()*900)+100); }
  while (existingIds.has(newId));
  
  if (!confirm(`Admit ${name} to ${wardName} Ward (${bedLabelForAdmission})?`)) return;

  const submitBtn = document.querySelector('#admitModal .btn-primary, #admitModal [onclick*="admitPatient"]');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Admitting…'; }

  try {
    const result = await apiRequest('/patients', {
      method: 'POST',
      body: JSON.stringify({
        full_name: name,
        age: Number.isFinite(age) ? age : 0,
        sex: (sex && sex !== '—') ? sex : 'O',
        ward: wardName,
        team: teamCode,
        bed_label: bedLabelForAdmission
      })
    });

    if (typeof logSystemAction === 'function') {
      logSystemAction('PATIENT_ADMIT', result?.data?.patient_code || name, {
        ward: wardName,
        team: teamCode,
        actor: JSON.parse(sessionStorage.getItem('activeUser') || 'null')?.email || 'SYSTEM'
      });
    }

    admissionsToday++;
    await refreshFromBackendSnapshot();
    await loadStatsFromBackend();

    closeModal('admitModal');
    document.getElementById('admitName').value = '';
    if (dobInput) dobInput.value = '';
    if (typeof updateAdmitBedUi === 'function') {
      updateAdmitBedUi('', '');
    }
    showToast(`Admitted ${name}`);
  } catch (error) {
    showToast(`Admission failed: ${error.message}`, 'error');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Admit Patient'; }
  }
}

// DISCHARGE PATIENT: Remove patient from system (permanent deletion)
// Params: None (uses currentPatientId set by openDetail)
// Returns: void
// Side effects: Removes from patients[], auditLog updated, calls refreshDashboard()
// Called by: "Discharge" button in patient detail modal
async function dischargePatient() {
  if (!getPerms().discharge) { showToast('You do not have permission to discharge patients.', 'error'); return; }
  if (!confirm('Discharge this patient? They will be removed from the board.')) return;

  const dischargeBtn = document.querySelector('#detailModal .btn-danger, #detailModal [onclick*="dischargePatient"]');
  if (dischargeBtn) { dischargeBtn.disabled = true; dischargeBtn.textContent = 'Discharging…'; }

  try {
    const dischargeTarget = currentPatientId;
    await apiRequest(`/patients/${encodeURIComponent(currentPatientId)}`, {
      method: 'DELETE'
    });

    if (typeof logSystemAction === 'function') {
      logSystemAction('PATIENT_DISCHARGE', dischargeTarget, {
        actor: JSON.parse(sessionStorage.getItem('activeUser') || 'null')?.email || 'SYSTEM'
      });
    }

    dischargedToday++;
    await refreshFromBackendSnapshot();
    await loadStatsFromBackend();
    showToast(`Patient ${currentPatientId} discharged`);
    closeModal('detailModal');
  } catch (error) {
    showToast(`Discharge failed: ${error.message}`, 'error');
    if (dischargeBtn) { dischargeBtn.disabled = false; dischargeBtn.textContent = 'Discharge'; }
  }
}

// TRANSFER PATIENT: Move patient to different ward and/or team
// Params: None (reads from transfer modal form fields)
// Returns: void
// Side effects: Modifies patient.ward, patient.team, auditLog, calls refreshDashboard()
// Called by: "Confirm Transfer" button in transfer modal
// Checks permission and logs the action
async function doTransfer() {
  if (!getPerms().transfer) { showToast('You do not have permission to transfer patients.', 'error'); return; }
  
  const p = patients.find(x => x.id === currentPatientId);
  if (p) {
    const newWard = document.getElementById('transferWardSelect').value;
    const targetWard = wards.find(w => w.name === newWard);
    if (!targetWard) {
      showToast('Selected ward not found. Please try again.', 'error');
      return;
    }
    if (newWard !== p.ward && targetWard.occ >= targetWard.beds) {
      showToast(`Transfer blocked: ${newWard} Ward is at full capacity.`, 'error');
      return;
    }
    if (!confirm(`Transfer this patient to ${newWard}?`)) return;
    
    const newTeam = document.getElementById('transferTeamSelect').value;

    try {
      const transferTarget = currentPatientId;
      await apiRequest(`/patients/${encodeURIComponent(currentPatientId)}/transfer`, {
        method: 'PATCH',
        body: JSON.stringify({
          ward: newWard,
          team: newTeam
        })
      });

      if (typeof logSystemAction === 'function') {
        logSystemAction('PATIENT_TRANSFER', transferTarget, {
          toWard: newWard,
          toTeam: newTeam,
          actor: JSON.parse(sessionStorage.getItem('activeUser') || 'null')?.email || 'SYSTEM'
        });
      }

      transfersToday++;
      await refreshFromBackendSnapshot();
      await loadStatsFromBackend();
      showToast(`Patient ${currentPatientId} transferred`);
      closeModal('transferModal');
    } catch (error) {
      // --- BEGIN: Fallback to local prototype mode ---
      const oldWard = p.ward;
      const oldTeam = p.team;
      p.ward = newWard;
      p.team = newTeam;
      if (typeof logSystemAction === 'function') {
        logSystemAction('PATIENT_TRANSFER', currentPatientId, {
          from: { ward: oldWard, team: oldTeam },
          to: { ward: newWard, team: newTeam },
          actor: JSON.parse(sessionStorage.getItem('activeUser') || 'null')?.email || 'SYSTEM'
        });
      }
      transfersToday++;
      if (typeof saveData === 'function') saveData();
      if (typeof refreshDashboard === 'function') refreshDashboard();
      showToast(`Patient transferred to ${newWard} (offline)`);
      closeModal('transferModal');
      // --- END: Fallback to local prototype mode ---
    }
  }
}

// RECORD TREATMENT: Log doctor treatment for a patient
// Params: None (reads from detail modal form fields)
// Returns: void
// Side effects: Adds treatment record to patient.treatments, calls saveData()
// Called by: "Log Treatment" button in patient detail modal
// Validation: Checks permission, doctor exists, team matches patient team
async function recordTreatment() {
  if (!getPerms().logTreatment) { showToast('You do not have permission to log treatments.', 'error'); return; }
  
  const p = patients.find(x => x.id === currentPatientId);
  if (!p) return;

  const docName = document.getElementById('treatmentDoctorSelect').value;
  const errorEl = document.getElementById('treatmentError');

  if (!docName) {
    errorEl.textContent = "Please select a doctor from the list.";
    errorEl.style.display = 'block';
    return;
  }

  const selectedDoc = doctors.find(d => d.name === docName);
  if (!selectedDoc) {
    errorEl.textContent = "Doctor not found. Please refresh and try again.";
    errorEl.style.display = 'block';
    return;
  }
  
  const pTeamFormatted = p.team.includes('Team') ? p.team : 'Team ' + p.team;

  if (selectedDoc.team !== pTeamFormatted) {
    errorEl.textContent = `Action Denied: ${selectedDoc.name} belongs to ${selectedDoc.team}. This patient is under the care of ${pTeamFormatted}.`;
    errorEl.style.display = 'block';
    return;
  }

  errorEl.style.display = 'none';

  try {
    const result = await apiRequest(`/patients/${encodeURIComponent(currentPatientId)}/treatments`, {
      method: 'POST',
      body: JSON.stringify({ doctor_name: selectedDoc.name })
    });

    if (!p.treatments) p.treatments = [];
    p.treatments.unshift({
      name: result.data.name,
      role: result.data.role,
      grade: result.data.grade
    });

    renderTreatments(currentPatientId);
    document.getElementById('treatmentDoctorSelect').value = '';
    showToast('Treatment recorded');
  } catch (error) {
    errorEl.textContent = `Treatment failed: ${error.message}`;
    errorEl.style.display = 'block';
  }
}
