// =============================================================================
// modals.js - Modal Management Functions
// =============================================================================
// PURPOSE: Handle all modal dialogs for patient operations and system management
// Manages: Admit form, patient detail, transfer form, bed matrix modal
//
// CALLED BY: User button clicks (Admit Patient, Log Treatment, Transfer, etc)
// DEPENDS ON: data.js (global state), auth.js (permissions), ui.js (renderTreatments)
// =============================================================================

let bedMatrixContext = {
  mode: 'view'
};

function updateAdmitBedUi(wardName = '', bedLabel = '') {
  const wardInput = document.getElementById('admitWard');
  const bedInput = document.getElementById('admitBed');
  const pickerBtn = document.getElementById('admitBedPickerBtn');
  const hint = document.getElementById('admitBedHint');

  if (wardInput) wardInput.value = wardName || '';
  if (bedInput) bedInput.value = bedLabel || '';

  if (!pickerBtn || !hint) return;

  if (wardName && bedLabel) {
    pickerBtn.textContent = `Change bed (${wardName} - ${bedLabel})`;
    hint.textContent = `Selected: ${wardName} - ${bedLabel}`;
  } else if (wardName) {
    pickerBtn.textContent = `Pick a bed in ${wardName}`;
    hint.textContent = `Preferred ward: ${wardName}. No bed selected yet.`;
  } else {
    pickerBtn.textContent = 'Select ward and bed';
    hint.textContent = 'No bed selected. A bed will be auto-assigned after you pick a ward.';
  }
}

// OPEN ADMIT MODAL: Show form to admit new patient
// Params: None
// Returns: void
// Side effects: Resets/updates bed selection fields and shows modal
// Called by: "Admit Patient" button in stats bar
function openAdmit(preselectedWard) { 
  if (preselectedWard) {
    updateAdmitBedUi(preselectedWard, '');
  } else {
    updateAdmitBedUi('', '');
  }

  bedMatrixContext = { mode: 'view' };

  document.getElementById('admitModal').classList.add('open'); 
}

function openAdmitBedPicker() {
  const currentWard = document.getElementById('admitWard')?.value || '';
  closeModal('admitModal');
  openBedMatrix({ mode: 'admit-select', wardName: currentWard });
}

function selectAdmitBed(wardName, bedLabel) {
  updateAdmitBedUi(wardName, bedLabel);
  bedMatrixContext = { mode: 'view' };
  closeModal('bedModal');
  document.getElementById('admitModal').classList.add('open');
}

function closeBedMatrix() {
  const reopenAdmit = bedMatrixContext.mode === 'admit-select';
  bedMatrixContext = { mode: 'view' };
  closeModal('bedModal');
  if (reopenAdmit) {
    document.getElementById('admitModal').classList.add('open');
  }
}

// CLOSE ANY MODAL: Generic modal hide function
// Params: id (string) - modal element ID to close
// Returns: void
// Side effects: Removes 'open' class from modal, hiding it
function closeModal(id) { 
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('open'); 
}

// Store currently selected patient ID for modal operations
let currentPatientId = null;

// OPEN PATIENT DETAIL: Show patient info, treatment history, allow logging new treatment
// Params: id (patient ID string)
// Returns: void
// Side effects: Populates detail modal with patient data, calls renderTreatments()
// Called by: Patient table "Log Treatment" button or search result click
// Uses: currentPatientId global to track which patient is selected
function openDetail(id) {
  currentPatientId = id;
  const p = patients.find(x => x.id === id);
  if (!p) return;
  
  document.getElementById('detailName').textContent = p.name + ' (ID: ' + p.id + ')';
  document.getElementById('detailConsultant').textContent = getLeadConsultantForPatient(p.team);
  document.getElementById('detailTeam').textContent = p.team;
  
  const docSelect = document.getElementById('treatmentDoctorSelect');
  const logSection = document.querySelector('[onclick="recordTreatment()"]')?.closest('.form-row');
  const perms = getPerms();

  if (docSelect) {
    if (!perms.logTreatment) {
      // Hide the entire log treatment section for roles that can't log
      if (logSection) logSection.style.display = 'none';
      const logLabel = document.querySelector('div[style*="Log New Treatment"]');
      if (logLabel) logLabel.style.display = 'none';
    } else {
      if (logSection) logSection.style.display = '';
      
      const activeUserData = JSON.parse(sessionStorage.getItem('activeUser'));
      const isDoctor = doctors.find(d => d.name === activeUserData.name);
      if (isDoctor) {
        docSelect.innerHTML = `<option value="${isDoctor.name}">${isDoctor.name} (${isDoctor.team})</option>`;
      } else {
        docSelect.innerHTML = '<option value="">Select treating doctor...</option>' +
          doctors.map(d => `<option value="${d.name}">${d.name} (${d.team})</option>`).join('');
      }
    }
  }

  const errorEl = document.getElementById('treatmentError');
  if (errorEl) errorEl.style.display = 'none';

  if (!p.treatments) p.treatments = [];

  renderTreatments(id);
  if (typeof hydratePatientTreatments === 'function') {
    hydratePatientTreatments(id);
  }
  document.getElementById('detailModal').classList.add('open');
}

// OPEN TRANSFER MODAL: Show form to transfer patient to different ward/team
// Params: id (patient ID string)
// Returns: void
// Side effects: Sets currentPatientId, populates patient info, shows modal
// Called by: Patient table "Transfer" button
function openTransfer(id) {
  currentPatientId = id;
  const p = patients.find(x=>x.id===id);
  if(!p) return;
  
  document.getElementById('transferName').textContent = p.name+', Age:'+p.age;
  document.getElementById('transferTeam').textContent = p.team;

  const wardSelect = document.getElementById('transferWardSelect');
  if (wardSelect) {
    wardSelect.innerHTML = wards.map(w => {
      const isFull = w.occ >= w.beds;
      const canSelect = !isFull || w.name === p.ward;
      return `<option value="${w.name}" ${canSelect ? '' : 'disabled'} ${w.name === p.ward ? 'selected' : ''}>
        ${w.name} (${w.occ}/${w.beds} beds) ${isFull && w.name !== p.ward ? '⛔ FULL' : ''}
      </option>`;
    }).join('');
  }

  document.getElementById('transferModal').classList.add('open');
}

// OPEN TRANSFER FROM DETAIL MODAL: Transition from patient detail to transfer modal
// Params: None
// Returns: void
// Side effects: Closes detail modal, opens transfer modal
// Called by: "Transfer" button in patient detail modal
function openTransferFromDetail() {
  closeModal('detailModal');
  openTransfer(currentPatientId);
}

// OPEN BED MATRIX: Show visual grid of bed occupancy by ward
// Params: None (optional wardName parameter, default shows first ward)
// Returns: void
// Side effects: Creates and displays bed matrix modal
// Called by: "Bed Matrix" button in stats bar
function openBedMatrix(options = {}) {
  if (!getPerms().bedMatrix) {
    alert('You do not have permission to access Bed Matrix.');
    return;
  }

  const requestedWard = options.wardName || options.ward || '';
  const requestedMode = options.mode === 'admit-select' ? 'admit-select' : 'view';
  bedMatrixContext = { mode: requestedMode };

  const select = document.getElementById('bedMatrixWard');
  if (select) {
    select.innerHTML = wards.map(w => {
      const available = w.beds - w.occ;
      return `<option value="${w.name}">${w.name} Ward (${available} beds available)</option>`;
    }).join('');
    if (requestedWard && Array.from(select.options).some(o => o.value === requestedWard)) {
      select.value = requestedWard;
    }
    if (select.value) {
      renderBedMatrix(select.value);
    } else if (wards.length > 0) {
      renderBedMatrix(wards[0].name);
    }
  }

  // Keep compatibility with both old and new modal IDs.
  const modal = document.getElementById('bedModal') || document.getElementById('bedMatrixModal');
  if (!modal) {
    alert('Bed Matrix modal not found in DOM');
    return;
  }
  modal.classList.add('open');
}

// RENDER BED MATRIX: Create visual grid showing bed availability by ward
// Params: wardName (string) - name of ward to visualize
// Returns: void
// Side effects: Populates bedMatrixGrid with HTML grid
// Helper function called by openBedMatrix()
function renderBedMatrix(wardName) {
  const grid = document.getElementById('bedMatrixGrid');
  if (!grid) return;
  const wardObj = wards.find(w => w.name === wardName);
  if (!wardObj) return;

  const patientsInWard = patients.filter(p => p.ward === wardName);

  let html = '';
  for (let i = 1; i <= wardObj.beds; i++) {
    const bedName = `Bed ${i}`;
    const occupant = patientsInWard.find(p => p.bed === bedName);

    if (occupant) {
      if (bedMatrixContext.mode === 'admit-select') {
        html += `
          <div class="bed-box occupied" title="Occupied bed">
            <div class="bed-num">${bedName}</div>
            <div class="bed-status" style="color: var(--color-text-primary); font-weight: 500;">${occupant.name}</div>
          </div>
        `;
      } else {
        html += `
          <div class="bed-box occupied" onclick="closeModal('bedModal'); openDetail('${occupant.id}');">
            <div class="bed-num">${bedName}</div>
            <div class="bed-status" style="color: var(--color-text-primary); font-weight: 500;">${occupant.name}</div>
          </div>
        `;
      }
    } else {
      if (bedMatrixContext.mode === 'admit-select') {
        html += `
          <div class="bed-box empty" onclick="selectAdmitBed('${wardName}', '${bedName}');">
            <div class="bed-num">${bedName}</div>
            <div class="bed-status">Select</div>
          </div>
        `;
      } else {
        html += `
          <div class="bed-box empty" onclick="closeModal('bedModal'); openAdmit('${wardName}');">
            <div class="bed-num">${bedName}</div>
            <div class="bed-status">Available</div>
          </div>
        `;
      }
    }
  }

  grid.innerHTML = html;
}
