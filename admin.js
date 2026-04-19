      // =============================================================================
      // admin.js - System Administration Functions
      // =============================================================================
      // PURPOSE: System management panels for admins (wards, teams, users, reports, security)
      // Handles all openSysModal nested panels and their respective save operations
      //
      // CALLED BY: System Management page buttons and openSysModal()
      // DEPENDS ON: data.js (global state), auth.js (permissions), ui.js (renderTeams, renderWards)
      // =============================================================================

      let wardAnalyticsChart = null;
      let teamAnalyticsChart = null;
      let analyticsRoutingBound = false;

      function escapeHtml(value) {
        return String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function formatScopeTeamLabel(teamValue) {
        const value = String(teamValue || '').trim();
        if (!value) return '';
        return /^team\s+/i.test(value) ? value : `Team ${value}`;
      }

      function renderAnalyticsScopeBadge() {
        const badge = document.getElementById('analyticsScopeBadge');
        if (!badge) return;

        const activeUser = JSON.parse(sessionStorage.getItem('activeUser') || 'null');
        const permissions = activeUser?.permissions || null;
        if (!permissions) {
          badge.style.display = 'none';
          return;
        }

        const allowedWards = Array.isArray(permissions.allowedWards) ? permissions.allowedWards.filter(Boolean) : [];
        const allowedTeams = Array.isArray(permissions.allowedTeams)
          ? permissions.allowedTeams.map(formatScopeTeamLabel).filter(Boolean)
          : [];

        if (permissions.viewGlobalPatients) {
          badge.className = 'scope-pill scope-pill-global';
          badge.textContent = 'Scope: Global patient visibility';
          badge.style.display = 'inline-flex';
          return;
        }

        const scopeBits = [];
        if (allowedWards.length > 0) scopeBits.push(`Wards: ${allowedWards.join(', ')}`);
        if (allowedTeams.length > 0) scopeBits.push(`Teams: ${allowedTeams.join(', ')}`);

        badge.className = 'scope-pill scope-pill-limited';
        badge.textContent = scopeBits.length > 0
          ? `Scope: ${scopeBits.join(' | ')}`
          : 'Scope: No ward/team scope assigned';
        badge.style.display = 'inline-flex';
      }

      function selectRoleForEdit(roleName) {
        const roleSelect = document.getElementById('editRoleSelect');
        if (!roleSelect) return;
        roleSelect.value = roleName;
        loadRolePermissionsForEdit(roleName);
      }

      let scopeModalState = {
        context: null,
        roleName: null,
        userIndex: null,
        allowedWards: [],
        allowedTeams: []
      };

      function getScopeTeams() {
        return Array.from(
          new Set(teams.map(t => String(t.name || '').replace(/^Team\s+/i, '').trim()).filter(Boolean))
        ).sort();
      }

      function ensureScopeModal() {
        let modal = document.getElementById('scopeModal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'scopeModal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
          <div class="modal" style="width: min(720px, 96vw);">
            <button class="modal-close" onclick="closeModal('scopeModal')">✕</button>
            <div id="scopeModalTitle" style="font-size: 18px; font-weight: 700; margin-bottom: 6px;">Data Scope</div>
            <div id="scopeModalDesc" style="font-size: 12px; color: var(--color-text-secondary); margin-bottom: 16px;">Choose which wards and teams remain visible when global access is off.</div>
            <div class="form-row" style="gap: 16px; margin-bottom: 12px;">
              <div class="form-group" style="margin: 0; flex: 1;">
                <label class="form-label">Allowed Wards</label>
                <select id="scopeModalWards" class="form-select" multiple size="6" style="height: auto; padding: 6px;">
                  ${wardConfigs.map(w => `<option value="${w.name}">${w.name}</option>`).join('')}
                </select>
              </div>
              <div class="form-group" style="margin: 0; flex: 1;">
                <label class="form-label">Allowed Teams</label>
                <select id="scopeModalTeams" class="form-select" multiple size="6" style="height: auto; padding: 6px;">
                  ${getScopeTeams().map(t => `<option value="${t}">Team ${t}</option>`).join('')}
                </select>
              </div>
            </div>
            <div style="font-size: 11px; color: var(--color-text-secondary); margin-bottom: 16px;">Hold Ctrl/Cmd to select multiple. Leave both lists empty to keep the role/user unrestricted within the non-global scope.</div>
            <div style="display: flex; justify-content: flex-end; gap: 8px;">
              <button class="btn-cancel" onclick="closeModal('scopeModal')">Cancel</button>
              <button class="btn-primary" onclick="saveScopeModal()">Save Scope</button>
            </div>
          </div>
        `;
        document.body.appendChild(modal);
        return modal;
      }

      function updateScopeSummary(context, allowedWards, allowedTeams, globalEnabled) {
        const summaryId = context === 'role' ? 'role_scopeSummary' : 'perm_scopeSummary';
        const buttonId = context === 'role' ? 'role_scopeButton' : 'perm_scopeButton';
        const summary = document.getElementById(summaryId);
        const button = document.getElementById(buttonId);
        const wards = Array.isArray(allowedWards) ? allowedWards.filter(Boolean) : [];
        const teamsList = Array.isArray(allowedTeams) ? allowedTeams.filter(Boolean) : [];

        if (button) {
          button.style.display = globalEnabled ? 'none' : 'inline-flex';
        }

        if (!summary) return;

        if (globalEnabled) {
          summary.textContent = 'Global visibility is enabled. Scope filters are inactive.';
          return;
        }

        const scopeBits = [];
        if (wards.length > 0) scopeBits.push(`Wards: ${wards.join(', ')}`);
        if (teamsList.length > 0) scopeBits.push(`Teams: ${teamsList.map(formatScopeTeamLabel).join(', ')}`);
        summary.textContent = scopeBits.length > 0
          ? `Current scope: ${scopeBits.join(' | ')}`
          : 'No ward/team scope selected yet.';
      }

      function openScopeModal(context, title, description, allowedWards, allowedTeams) {
        const modal = ensureScopeModal();
        const wardSelect = modal.querySelector('#scopeModalWards');
        const teamSelect = modal.querySelector('#scopeModalTeams');
        const modalTitle = modal.querySelector('#scopeModalTitle');
        const modalDesc = modal.querySelector('#scopeModalDesc');

        scopeModalState = {
          context,
          roleName: context === 'role' ? (document.getElementById('editRoleSelect')?.value || null) : scopeModalState.roleName,
          userIndex: context === 'user' ? editingUserIndex : null,
          allowedWards: Array.isArray(allowedWards) ? [...allowedWards] : [],
          allowedTeams: Array.isArray(allowedTeams) ? [...allowedTeams] : []
        };

        if (modalTitle) modalTitle.textContent = title;
        if (modalDesc) modalDesc.textContent = description;

        if (wardSelect) {
          Array.from(wardSelect.options).forEach(opt => {
            opt.selected = scopeModalState.allowedWards.includes(opt.value);
          });
        }

        if (teamSelect) {
          Array.from(teamSelect.options).forEach(opt => {
            opt.selected = scopeModalState.allowedTeams.includes(opt.value);
          });
        }

        modal.classList.add('open');
      }

      function closeScopeModal() {
        closeModal('scopeModal');
      }

      function saveScopeModal() {
        const modal = document.getElementById('scopeModal');
        if (!modal) return;

        const wardSelect = modal.querySelector('#scopeModalWards');
        const teamSelect = modal.querySelector('#scopeModalTeams');

        scopeModalState.allowedWards = wardSelect ? Array.from(wardSelect.selectedOptions).map(opt => opt.value) : [];
        scopeModalState.allowedTeams = teamSelect ? Array.from(teamSelect.selectedOptions).map(opt => opt.value) : [];

        if (scopeModalState.context === 'role') {
          updateScopeSummary('role', scopeModalState.allowedWards, scopeModalState.allowedTeams, document.getElementById('role_viewGlobalPatients')?.checked);
        } else if (scopeModalState.context === 'user') {
          updateScopeSummary('user', scopeModalState.allowedWards, scopeModalState.allowedTeams, document.getElementById('cb_global')?.checked);
        }

        closeScopeModal();
      }

      function handleRoleGlobalVisibilityChange() {
        const isGlobal = !!document.getElementById('role_viewGlobalPatients')?.checked;
        const roleName = document.getElementById('editRoleSelect')?.value;

        if (isGlobal) {
          closeScopeModal();
          updateScopeSummary('role', scopeModalState.allowedWards, scopeModalState.allowedTeams, true);
          return;
        }

        const source = roleTemplates[roleName] || {};
        const allowedWards = Array.isArray(scopeModalState.allowedWards) && scopeModalState.context === 'role' && scopeModalState.roleName === roleName
          ? scopeModalState.allowedWards
          : Array.isArray(source.allowedWards) ? source.allowedWards : [];
        const allowedTeams = Array.isArray(scopeModalState.allowedTeams) && scopeModalState.context === 'role' && scopeModalState.roleName === roleName
          ? scopeModalState.allowedTeams
          : Array.isArray(source.allowedTeams) ? source.allowedTeams : [];

        updateScopeSummary('role', allowedWards, allowedTeams, false);
        openScopeModal(
          'role',
          'Role Data Scope',
          'Select the wards and teams this role can view when global visibility is off.',
          allowedWards,
          allowedTeams
        );
      }

      function handleUserGlobalVisibilityChange() {
        const isGlobal = !!document.getElementById('cb_global')?.checked;
        const user = editingUserIndex !== null ? systemUsers[editingUserIndex] : null;
        const roleFallback = user ? (roleTemplates[user.role] || {}) : {};
        const currentPermissions = user ? (user.permissions || {}) : {};

        if (isGlobal) {
          closeScopeModal();
          updateScopeSummary('user', scopeModalState.allowedWards, scopeModalState.allowedTeams, true);
          return;
        }

        const allowedWards = Array.isArray(scopeModalState.allowedWards) && scopeModalState.context === 'user' && scopeModalState.userIndex === editingUserIndex
          ? scopeModalState.allowedWards
          : Array.isArray(currentPermissions.allowedWards) ? currentPermissions.allowedWards : Array.isArray(roleFallback.allowedWards) ? roleFallback.allowedWards : [];
        const allowedTeams = Array.isArray(scopeModalState.allowedTeams) && scopeModalState.context === 'user' && scopeModalState.userIndex === editingUserIndex
          ? scopeModalState.allowedTeams
          : Array.isArray(currentPermissions.allowedTeams) ? currentPermissions.allowedTeams : Array.isArray(roleFallback.allowedTeams) ? roleFallback.allowedTeams : [];

        updateScopeSummary('user', allowedWards, allowedTeams, false);
        openScopeModal(
          'user',
          'User Data Scope',
          'Select the wards and teams this user can view when global visibility is off.',
          allowedWards,
          allowedTeams
        );
      }

      let activeUserActionsIndex = null;

      function closeUserActionsMenu() {
        const menu = document.getElementById('userActionsMenu');
        if (menu) {
          menu.style.display = 'none';
          menu.innerHTML = '';
        }
        activeUserActionsIndex = null;
      }

      function ensureUserActionsMenu() {
        let menu = document.getElementById('userActionsMenu');
        if (!menu) {
          menu = document.createElement('div');
          menu.id = 'userActionsMenu';
          menu.className = 'user-actions-menu';
          menu.style.display = 'none';
          menu.addEventListener('click', (event) => event.stopPropagation());
          document.body.appendChild(menu);
        }

        if (!window.__userActionsMenuBound) {
          document.addEventListener('click', closeUserActionsMenu);
          window.addEventListener('resize', closeUserActionsMenu);
          window.addEventListener('scroll', closeUserActionsMenu, true);
          window.__userActionsMenuBound = true;
        }

        return menu;
      }

      function toggleUserActionsMenu(event, index) {
        event.stopPropagation();

        const user = systemUsers[index];
        if (!user) return;

        const menu = ensureUserActionsMenu();
        const button = event.currentTarget;
        const isOpen = menu.style.display === 'block' && activeUserActionsIndex === index;

        if (isOpen) {
          closeUserActionsMenu();
          return;
        }

        const displayName = escapeHtml(user.name || user.email || 'User');
        menu.innerHTML = `
          <div class="user-actions-menu-header">${displayName}</div>
          <button type="button" class="user-actions-item" onclick="openUserPermsEditor(${index}); closeUserActionsMenu();">Granular permissions</button>
          <button type="button" class="user-actions-item" onclick="resetUserToRoleDefaults(${index}); closeUserActionsMenu();">Reset to role defaults</button>
          <button type="button" class="user-actions-item" onclick="resetUserPassword(${index}); closeUserActionsMenu();">Reset password</button>
          <div class="user-actions-divider"></div>
          <button type="button" class="user-actions-item danger" onclick="deleteUserAccount(${index}); closeUserActionsMenu();">Revoke access</button>
        `;

        menu.style.display = 'block';
        menu.style.visibility = 'hidden';

        const rect = button.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        const horizontalGap = 8;
        const verticalGap = 6;

        let left = rect.right - menuRect.width;
        left = Math.min(left, window.innerWidth - menuRect.width - horizontalGap);
        left = Math.max(horizontalGap, left);

        let top = rect.bottom + verticalGap;
        if (top + menuRect.height > window.innerHeight - horizontalGap) {
          top = Math.max(horizontalGap, rect.top - menuRect.height - verticalGap);
        }

        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
        menu.style.visibility = 'visible';
        activeUserActionsIndex = index;
      }

      function getManageAccountsFilteredUsers() {
        const query = (document.getElementById('manageAccountsSearch')?.value || '').trim().toLowerCase();
        if (!query) return systemUsers;

        return systemUsers.filter((u) => {
          const haystack = [
            u.name,
            u.email,
            u.role,
            u.staff_title,
            u.team,
            u.customPermissions ? 'custom overrides' : 'role default',
            u.mustChangePassword ? 'must change password' : '',
            u.otpRequired ? 'otp pending' : '',
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return haystack.includes(query);
        });
      }

      function renderManageAccountsRows() {
        const tbody = document.getElementById('userAccountsBody');
        if (!tbody) return;

        const rows = getManageAccountsFilteredUsers();
        if (rows.length === 0) {
          tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:12px; color:var(--color-text-secondary);">No users match your search.</td></tr>';
          return;
        }

        tbody.innerHTML = rows.map((u) => {
          const idx = systemUsers.indexOf(u);
          return `
            <tr>
              <td style="font-weight:500; font-size:12px;">
                ${escapeHtml(u.name || u.email || 'Unnamed user')}<br>
                <span style="color:var(--color-text-secondary);font-size:10px;">${escapeHtml(u.email || 'No email')}</span>
                <br>
                <span style="display:inline-block; margin-top:4px; font-size:10px; color:var(--color-text-secondary);">
                  ${escapeHtml(u.staff_title || 'No staff role')} • ${escapeHtml(u.team || 'No team')}
                </span>
              </td>
              <td>
                <span class="badge badge-stable">${escapeHtml(u.role || 'Unknown')}</span><br>
                <span style="display:inline-block; margin-top:4px; padding:2px 6px; border-radius:10px; font-size:10px; font-weight:600; ${u.customPermissions ? 'background:#FFF4E5; color:#B45309;' : 'background:#E1F5EE; color:#0F6E56;'}">
                  ${u.customPermissions ? 'Custom Overrides' : 'Role Default'}
                </span>
                ${(u.mustChangePassword || u.otpRequired) ? `<br><span style="display:inline-block; margin-top:4px; padding:2px 6px; border-radius:10px; font-size:10px; font-weight:600; background:#FEF3C7; color:#92400E;">${u.mustChangePassword ? 'Must Change Password' : 'OTP Pending'}</span>` : ''}
              </td>
              <td style="text-align: right;">
                <button type="button" class="action-btn action-btn-more" onclick="toggleUserActionsMenu(event, ${idx})" title="More actions" aria-label="More actions for ${escapeHtml(u.name || u.email || 'user')}">⋯</button>
              </td>
            </tr>
          `;
        }).join('');
      }

      function getUserRolesFilteredList() {
        const query = (document.getElementById('userRolesSearch')?.value || '').trim().toLowerCase();
        if (!query) return availableRoles;
        return availableRoles.filter((roleName) => String(roleName || '').toLowerCase().includes(query));
      }

      function renderUserRolesRows() {
        const tbody = document.getElementById('userRolesBody');
        if (!tbody) return;

        const coreRoles = new Set(['System Admin', 'Consultant', 'Junior Doctor', 'Ward Manager']);
        const roles = getUserRolesFilteredList();
        if (roles.length === 0) {
          tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:12px; color:var(--color-text-secondary);">No roles match your search.</td></tr>';
          return;
        }

        tbody.innerHTML = roles.map((roleName) => `
          <tr>
            <td style="font-weight:500; font-size:12px;">${escapeHtml(roleName)}</td>
            <td>
              <span style="display:inline-block; padding:2px 6px; border-radius:10px; font-size:10px; font-weight:600; ${coreRoles.has(roleName) ? 'background:#E1F5EE; color:#0F6E56;' : 'background:#FFF4E5; color:#B45309;'}">
                ${coreRoles.has(roleName) ? 'Core Role' : 'Custom Role'}
              </span>
            </td>
            <td style="text-align:right;">
              <button class="action-btn log" onclick='selectRoleForEdit(${JSON.stringify(roleName)})'>Edit</button>
            </td>
          </tr>
        `).join('');
      }

      function routeAnalyticsKpi(kpiKey) {
        const key = String(kpiKey || '').trim().toLowerCase();
        if (!key) return;

        if (key === 'occupancy' || key === 'global-occupancy' || key === 'turnover' || key === 'alos' || key === 'bottleneck') {
          window.location.href = 'census.html?occupied=true';
          return;
        }

        if (key === 'active-teams') {
          window.location.href = 'workload.html?active=true';
          return;
        }

        if (key === 'pending-admissions') {
          window.location.href = 'index.html';
          return;
        }

        if (key === 'admissions' || key === 'transfers' || key === 'discharged') {
          window.location.href = `index.html?kpi=${encodeURIComponent(key)}`;
        }
      }

      function bindAnalyticsRouting() {
        if (analyticsRoutingBound) return;

        document.querySelectorAll('.kpi-drill[data-kpi]').forEach((card) => {
          card.addEventListener('click', () => routeAnalyticsKpi(card.getAttribute('data-kpi')));
        });

        analyticsRoutingBound = true;
      }

      function getAdminApiBaseUrl() {
        if (typeof window.resolveApiBaseUrl === 'function') {
          return window.resolveApiBaseUrl();
        }
        return window.WARDFLOW_API_BASE_URL || '/api';
      }

      async function adminApiRequest(path, options = {}) {
        const headers = { ...(options.headers || {}) };
        const token = sessionStorage.getItem('wardflow_access_token') || JSON.parse(sessionStorage.getItem('activeUser') || 'null')?.token;
        if (token && !headers.Authorization) {
          headers.Authorization = `Bearer ${token}`;
        }
        if (options.body && !headers['Content-Type']) {
          headers['Content-Type'] = 'application/json';
        }

        const response = await fetch(`${getAdminApiBaseUrl()}${path}`, {
          ...options,
          headers
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.success === false) {
          const msg = payload.detail || payload.error || `Request failed (${response.status})`;
          throw new Error(msg);
        }

        return payload;
      }

      async function refreshFromApiSnapshot() {
        if (typeof initializeApp === 'function') {
          await initializeApp();
          return;
        }
        refreshDashboard();
      }

      async function syncAdminConfigFromBackend() {
        try {
          const [rolesResp, permsResp] = await Promise.all([
            adminApiRequest('/roles'),
            adminApiRequest('/system-perms')
          ]);

          if (rolesResp?.success && rolesResp.data) {
            availableRoles = Array.isArray(rolesResp.data.available_roles) ? rolesResp.data.available_roles : availableRoles;
            const incomingTemplates = rolesResp.data.role_templates || {};
            Object.keys(roleTemplates).forEach(k => delete roleTemplates[k]);
            Object.entries(incomingTemplates).forEach(([k, v]) => { roleTemplates[k] = v; });
          }

          if (permsResp?.success && permsResp.data) {
            sysPerms = { ...sysPerms, ...permsResp.data };
          }
        } catch (error) {
          // Keep local fallback behavior if backend config endpoints are unavailable.
        }
      }

      async function syncSystemUsersFromBackend() {
        try {
          const usersResp = await adminApiRequest('/users');
          if (usersResp?.success && Array.isArray(usersResp.data)) {
            systemUsers = usersResp.data.map(user => ({
              ...user,
              permissions: user.permissions || {},
              customPermissions: !!user.customPermissions
            }));
          }
        } catch (error) {
          // Keep local fallback behavior if user account endpoints are unavailable.
        }
      }

      async function getAuditEntriesForUi() {
        try {
          const resp = await adminApiRequest('/audit-log?limit=300');
          if (resp?.success && Array.isArray(resp.data)) {
            return resp.data.map((entry) => {
              const timestamp = entry.created_at || new Date().toISOString();
              const actor = entry.actor_email || (entry.details?.updated_by || entry.details?.created_by || entry.details?.reset_by || entry.details?.requested_by || entry.details?.verified_by || 'system@wardflow.local');
              return {
                timestamp,
                actor,
                action: entry.action_type || 'UNKNOWN',
                details: JSON.stringify(entry.details || {}),
              };
            });
          }
        } catch (error) {
          // fall through to local fallback data
        }
        return Array.isArray(auditLog) ? auditLog : [];
      }

      function syncActiveSessionUser(updatedUser) {
        if (!updatedUser || !updatedUser.email) return;
        const activeSession = JSON.parse(sessionStorage.getItem('activeUser'));
        if (!activeSession || activeSession.email !== updatedUser.email) return;

        const token = sessionStorage.getItem('wardflow_access_token') || activeSession.token;
        const nextSession = {
          ...activeSession,
          ...updatedUser,
          token
        };
        sessionStorage.setItem('activeUser', JSON.stringify(nextSession));
        applySecurityAndProfile();
        filterTable();
      }

      // DYNAMIC SYSTEM MODAL: Central hub for all admin panels
      // Renders different forms based on title parameter
      // Handles: Edit Wards, Manage Teams, Accounts, Permissions, Audit Logs, Reports, Exports
      async function openSysModal(title, description) {
        const perms = getPerms();

        // Permission gate: check if user can access this panel
        const blockedByPerms = (
          (['Manage Team', 'Staff Roster'].includes(title) && !perms.manageStaff) ||
          (['Manage Accounts', 'User Roles'].includes(title) && !perms.manageAccounts) ||
          (['Permissions'].includes(title) && !perms.manageSystem) ||
          (['Edit Wards'].includes(title) && !perms.manageWards) ||
          (['Export Data'].includes(title) && !perms.exportData) ||
          (['View Reports', 'Ward History'].includes(title) && !perms.viewReports)
        );

        if (blockedByPerms) {
          const u = JSON.parse(sessionStorage.getItem('activeUser'));
          alert(`Access denied: Your role (${u ? u.role : 'Unknown'}) does not have permission to access "${title}".`);
          return;
        }

        if (['User Roles', 'Permissions', 'Staff Roster'].includes(title)) {
          await syncAdminConfigFromBackend();
        }

        if (title === 'Manage Accounts') {
          await syncSystemUsersFromBackend();
        }

        const modalTitle = document.getElementById('sysModalTitle');
        const modalDesc = document.getElementById('sysModalDesc');
        const modalContent = document.getElementById('sysModalContent');
        const modalOverlay = document.getElementById('sysModal');
        if (!modalOverlay) return; 

        const modalWindow = modalOverlay.querySelector('.modal');
        modalTitle.textContent = title;
        modalDesc.textContent = description;

        let contentHtml = '';

        if (title === 'Edit Wards') {
          contentHtml = `
            <div style="font-size: 12px; font-weight: 500; margin-bottom: 8px;">Edit Existing Ward</div>
            <div class="form-group">
              <label class="form-label">Select Ward</label>
              <select class="form-select" id="editWardSelect" onchange="loadWardConfig(this.value)">
                ${wardConfigs.map(w => `<option value="${w.name}">${w.name}</option>`).join('')}
              </select>
            </div>
            <div class="form-row">
              <div class="form-group" style="margin: 0;">
                <label class="form-label">Total Beds Capacity</label>
                <input type="number" id="editWardBeds" class="form-input" min="1" max="100" />
              </div>
              <div class="form-group" style="margin: 0;">
                <label class="form-label">Ward Status</label>
                <select class="form-select" id="editWardStatus">
                  <option>Active / Open</option>
                  <option>Maintenance / Closed</option>
                </select>
              </div>
            </div>

            <div style="border-top: 1px solid var(--color-border-tertiary); padding-top: 16px; margin-top: 16px;">
              <div style="font-size: 12px; font-weight: 500; margin-bottom: 8px;">Add New Ward</div>
              <div class="form-row" style="align-items: flex-end;">
                <div class="form-group" style="margin: 0; flex: 1;">
                  <label class="form-label">Ward Name</label>
                  <input type="text" id="newWardName" class="form-input" placeholder="e.g. Oncology" />
                </div>
                <div class="form-group" style="margin: 0; flex: 1;">
                  <label class="form-label">Bed Capacity</label>
                  <input type="number" id="newWardBeds" class="form-input" min="1" max="100" value="20" />
                </div>
              </div>
              <button class="btn-primary" style="width: 100%; margin-top: 12px;" onclick="addNewWard()">Add Ward</button>
            </div>

            <div style="border-top: 1px solid var(--color-border-tertiary); padding-top: 16px; margin-top: 16px;">
              <div style="font-size: 12px; font-weight: 500; margin-bottom: 8px;">Remove Ward</div>
              <div class="form-row" style="align-items: flex-end;">
                <div class="form-group" style="margin: 0; flex: 1;">
                  <label class="form-label">Select Ward to Remove</label>
                  <select class="form-select" id="removeWardSelect">
                    ${wardConfigs.map(w => `<option value="${w.name}">${w.name}</option>`).join('')}
                  </select>
                </div>
                <button class="btn-danger" style="height: 33px; white-space: nowrap;" onclick="removeWard()">Remove Ward</button>
              </div>
            </div>
          `;
          setTimeout(() => loadWardConfig(document.getElementById('editWardSelect')?.value), 50);
          setTimeout(renderWardHistoryChart, 50);
        }

        else if (title === 'Manage Team') {
          contentHtml = `
            <div class="form-group">
              <label class="form-label">Select Care Team</label>
              <select class="form-select" id="manageTeamSelect" onchange="updateStaffModalTable(this.value)">
                ${teams.map(t => `<option value="${t.name}">${t.name}</option>`).join('')}
              </select>
            </div>
            <div style="font-size: 12px; font-weight: 500; margin-bottom: 8px;">Assigned Personnel</div>
            <div class="table-wrap" style="margin-bottom: 16px; max-height: 150px; overflow-y: auto;">
              <table>
                <thead><tr><th>Name</th><th>Role</th><th style="text-align:right;">Action</th></tr></thead>
                <tbody id="manageTeamStaffBody"></tbody>
              </table>
            </div>
            <div style="border-top: 1px solid var(--color-border-tertiary); padding-top: 16px;">
              <div class="form-row">
                <div class="form-group" style="margin: 0;"><label class="form-label">Full Name</label><input type="text" id="newStaffName" class="form-input" placeholder="e.g. Dr. Cameron" /></div>
                <div class="form-group" style="margin: 0;"><label class="form-label">Role</label>
                  <select class="form-select" id="newStaffRole">${availableRoles.map(r => `<option value="${r}">${r}</option>`).join('')}</select>
                </div>
              </div>

              <button class="btn-primary" style="width: 100%; margin-top: 12px;" onclick="addNewStaffToSystem()">Add to Selected Team</button>
            </div>

            <div style="border-top: 1px solid var(--color-border-tertiary); padding-top: 16px; margin-top: 16px;">
              <div style="font-size: 12px; font-weight: 500; margin-bottom: 8px;">Add New Team</div>
              <div class="form-row" style="align-items: flex-end;">
                <div class="form-group" style="margin: 0; flex: 1;">
                  <label class="form-label">Team Name</label>
                  <input type="text" id="newTeamName" class="form-input" placeholder="e.g. Team Echo" />
                </div>
                <div class="form-group" style="margin: 0; flex: 1;">
                  <label class="form-label">Lead Consultant</label>
                  <input type="text" id="newTeamConsultant" class="form-input" placeholder="e.g. Dr. Smith" />
                </div>
              </div>
              <button class="btn-primary" style="width: 100%; margin-top: 12px;" onclick="addNewTeam()">Add Team</button>
            </div>

            <div style="border-top: 1px solid var(--color-border-tertiary); padding-top: 16px; margin-top: 16px;">
              <div style="font-size: 12px; font-weight: 500; margin-bottom: 8px;">Remove Team</div>
              <div class="form-row" style="align-items: flex-end;">
                <div class="form-group" style="margin: 0; flex: 1;">
                  <label class="form-label">Select Team to Remove</label>
                  <select class="form-select" id="removeTeamSelect">
                    ${teams.map(t => `<option value="${t.name}">${t.name}</option>`).join('')}
                  </select>
                </div>
                <button class="btn-danger" style="height: 33px; white-space: nowrap;" onclick="removeTeam()">Remove Team</button>
              </div>
            </div>
          `;
          setTimeout(() => updateStaffModalTable(teams[0].name), 50);
        }

        else if (title === 'Staff Roster') {
          const teamName = teams[0]?.name;
          contentHtml = `
            <div class="form-row">
              <div class="form-group" style="margin: 0;"><label class="form-label">Target Team</label>
                <select class="form-select" id="rosterTeamSelect" onchange="loadRoster(this.value)">
                  ${teams.map(t => `<option value="${t.name}">${t.name}</option>`).join('')}
                </select>
              </div>
              <div class="form-group" style="margin: 0; display:flex; align-items:flex-end;">
                <span style="font-size: 11px; color: var(--color-text-secondary);">Changes auto-save on submission.</span>
              </div>
            </div>
            <div class="table-wrap" style="margin-top: 16px; overflow-x: auto;">
              <table class="table-dense" style="min-width: 620px;">
                <thead><tr><th>Shift</th><th>Mon</th><th>Tue</th><th>Wed</th><th>Thu</th><th>Fri</th></tr></thead>
                <tbody id="rosterTbody"></tbody>
              </table>
            </div>
          `;
          if (teamName) {
            setTimeout(() => loadRoster(teamName), 50);
          }
        }

        else if (title === 'Manage Accounts') {
          contentHtml = `
            <div style="font-size: 12px; font-weight: 500; margin-bottom: 8px;">Registered Users</div>
            <div class="form-group" style="margin-bottom: 8px;">
              <input type="text" id="manageAccountsSearch" class="form-input" placeholder="Search by name, email, role, team..." oninput="renderManageAccountsRows()" />
            </div>
            <div class="table-wrap" style="margin-bottom: 16px; max-height: 150px; overflow-y: auto; overflow-x: auto; width: 100%;">
              <table style="table-layout: fixed; width: 100%;">
                <thead><tr><th style="width: 52%;">Name</th><th style="width: 22%;">Role</th><th style="width: 26%; text-align:right;">Actions</th></tr></thead>
                <tbody id="userAccountsBody"></tbody>
              </table>
            </div>
            <div style="border-top: 1px solid var(--color-border-tertiary); padding-top: 16px;">
              <div style="font-size: 12px; font-weight: 500; margin-bottom: 8px;">Create Login for Existing Staff</div>
              <div style="font-size: 11px; color: var(--color-text-secondary); margin-bottom: 10px;">New accounts are created with temporary passwords and must reset password on first sign-in.</div>
              <div class="form-row">
                <div class="form-group" style="margin: 0;">
                  <label class="form-label">Link to Staff Member</label>
                  <select class="form-select" id="newAccStaffLink">
                    <option value="">-- Select Staff --</option>
                    ${doctors.map(d => `<option value="${d.name}">${d.name} (${d.team})</option>`).join('')}
                  </select>
                </div>
                <div class="form-group" style="margin: 0;">
                  <label class="form-label">Email</label>
                  <input type="email" id="newAccEmail" class="form-input" placeholder="name@hospital.com"/>
                </div>
              </div>
              <div class="form-row">
                <div class="form-group" style="margin: 0;"><label class="form-label">Temporary Password</label><input type="text" id="newAccPass" class="form-input" value="Welcome123" /></div>
                <div class="form-group" style="margin: 0;"><label class="form-label">System Role</label>
                  <select class="form-select" id="newAccRole">${availableRoles.map(r => `<option value="${r}">${r}</option>`).join('')}</select>
                </div>
              </div>
              <button class="btn-primary" style="width: 100%; margin-top: 12px;" onclick="createNewAccount()">Create Linked Account</button>
            </div>
          `;
          setTimeout(renderManageAccountsRows, 0);
        }

        else if (title === 'User Roles') {
          contentHtml = `
            <div style="font-size: 12px; font-weight: 500; margin-bottom: 8px;">Registered Roles</div>
            <div class="form-group" style="margin-bottom: 8px;">
              <input type="text" id="userRolesSearch" class="form-input" placeholder="Search role name..." oninput="renderUserRolesRows()" />
            </div>
            <div class="table-wrap" style="margin-bottom: 16px; max-height: 160px; overflow-y: auto;">
              <table>
                <thead><tr><th>Role</th><th>Type</th><th style="text-align:right;">Actions</th></tr></thead>
                <tbody id="userRolesBody"></tbody>
              </table>
            </div>

            <div style="border-top: 1px solid var(--color-border-tertiary); padding-top: 16px;">
              <div style="font-size: 12px; font-weight: 500; margin-bottom: 8px;">Create New Role</div>
              <div class="form-row" style="align-items: flex-end;">
                <div class="form-group" style="margin: 0; flex: 1;"><input type="text" id="customRoleName" class="form-input" placeholder="e.g. Pharmacy Liaison" /></div>
                <button class="btn-primary" style="height: 33px;" onclick="createNewRole()">Add Role</button>
              </div>
              <div id="roleSuccessMsg" style="color: #1D9E75; font-size: 11px; margin-top: 6px; display: none;"></div>
            </div>

            <div style="border-top: 1px solid var(--color-border-tertiary); padding-top: 16px; margin-top: 16px;">
              <div class="form-group"><label class="form-label">Select Role to Edit Permissions</label>
                <select class="form-select" id="editRoleSelect" style="margin-bottom: 12px;" onchange="loadRolePermissionsForEdit(this.value)">${availableRoles.map(r => `<option value="${r}">${r}</option>`).join('')}</select>
              </div>
            </div>
            <div style="font-size: 12px; font-weight: 500; margin-bottom: 8px;">Role Permissions</div>
            <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; background: var(--color-background-secondary); padding: 14px; border-radius: var(--border-radius-md); border: 0.5px solid var(--color-border-tertiary);">
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;"><input type="checkbox" id="role_viewGlobalPatients" onchange="handleRoleGlobalVisibilityChange()"> View all patient data globally</label>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;"><input type="checkbox" id="role_admit"> Admit patients</label>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;"><input type="checkbox" id="role_discharge"> Discharge patients</label>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;"><input type="checkbox" id="role_transfer"> Transfer patients between wards</label>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;"><input type="checkbox" id="role_logTreatment"> Log treatment</label>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;"><input type="checkbox" id="role_bedMatrix"> Bed matrix access</label>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;"><input type="checkbox" id="role_viewReports"> View reports/history</label>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;"><input type="checkbox" id="role_exportData"> Export data</label>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;"><input type="checkbox" id="role_manageWards"> Manage wards</label>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;"><input type="checkbox" id="role_manageStaff"> Manage staff</label>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;"><input type="checkbox" id="role_manageAccounts"> Manage accounts</label>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;"><input type="checkbox" id="role_manageSystem"> Access system management</label>
            </div>

            <div style="border-top: 1px solid var(--color-border-tertiary); padding-top: 16px; margin-top: 16px;">
              <div style="font-size: 12px; font-weight: 500; margin-bottom: 4px; color: #1D9E75;">Data Scope (Ward & Team Filters)</div>
              <div style="font-size: 11px; color: var(--color-text-secondary); margin-bottom: 10px;">
                Scope opens in a separate modal whenever global visibility is turned off.
              </div>
              <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                <div id="role_scopeSummary" style="font-size: 11px; color: var(--color-text-secondary); flex: 1; min-width: 220px;">Global visibility is enabled. Scope filters are inactive.</div>
                <button type="button" class="btn-cancel" id="role_scopeButton" onclick="openScopeModal('role', 'Role Data Scope', 'Select the wards and teams this role can view when global visibility is off.', scopeModalState.allowedWards || [], scopeModalState.allowedTeams || [])" style="display:none;">Configure scope</button>
              </div>
            </div>
          `;
          setTimeout(renderUserRolesRows, 0);
          setTimeout(() => loadRolePermissionsForEdit(document.getElementById('editRoleSelect')?.value), 50);
        }

        else if (title === 'Permissions') {
          contentHtml = `
            <div style="font-size: 12px; font-weight: 500; margin-bottom: 8px;">Global Security Policies</div>
            <div class="form-group">
              <label class="form-label">Session Timeout</label>
              <select class="form-select" id="permTimeout">
                <option ${sysPerms.timeout==='15 Minutes'?'selected':''}>15 Minutes</option>
                <option ${sysPerms.timeout==='30 Minutes'?'selected':''}>30 Minutes</option>
                <option ${sysPerms.timeout==='1 Hour'?'selected':''}>1 Hour</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Multi-Factor Authentication (MFA)</label>
              <select class="form-select" id="permMFA">
                <option ${sysPerms.mfa==='Disabled'?'selected':''}>Disabled</option>
                <option ${sysPerms.mfa==='Optional for Staff'?'selected':''}>Optional for Staff</option>
                <option ${sysPerms.mfa==='Mandatory for all users'?'selected':''}>Mandatory for all users</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">IP Whitelisting</label>
              <input class="form-input" id="permIP" value="${sysPerms.ip}" />
              <span style="font-size: 10px; color: var(--color-text-secondary); margin-top: 4px;">Restrict dashboard access to hospital internal network only.</span>
            </div>
          `;
        }

        else if (title === 'Audit Logs') {
          const entries = await getAuditEntriesForUi();
          contentHtml = `
            <div style="font-size: 12px; font-weight: 500; margin-bottom: 8px;">System Action History</div>
            <div style="font-size: 11px; color: var(--color-text-secondary); margin-bottom: 12px;">
              Immutable record of all critical system and clinical actions.
            </div>
            <div class="table-wrap" style="max-height: 350px; overflow-y: auto; overflow-x: auto; width: 100%;">
              <table style="width: 100%; text-align: left; table-layout: fixed;">
                <thead>
                  <tr>
                    <th style="width: 22%;">Timestamp</th>
                    <th style="width: 20%;">Actor</th>
                    <th style="width: 22%;">Action</th>
                    <th style="width: 36%;">Details</th>
                  </tr>
                </thead>
                <tbody>
                  ${entries.length === 0 ? '<tr><td colspan="4" style="text-align:center;">No logs recorded yet.</td></tr>' : ''}
                  ${entries.map(log => {
                    const d = new Date(log.timestamp);
                    const timeStr = `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2,'0')}`;
                    
                    let badgeColor = 'var(--color-background-secondary)';
                    let textColor = 'var(--color-text-primary)';
                    if (log.action.includes('ADMIT') || log.action.includes('TRANSFER')) { badgeColor = '#E1F5EE'; textColor = '#0F6E56'; }
                    if (log.action.includes('DISCHARGE') || log.action.includes('REVOKE')) { badgeColor = '#FDE8E8'; textColor = '#C81E1E'; }
                    if (log.action.includes('SECURITY')) { badgeColor = '#E1EFFE'; textColor = '#1E429F'; }

                    return `
                      <tr style="font-size: 11px; border-bottom: 0.5px solid var(--color-border-tertiary);">
                        <td style="color: var(--color-text-secondary); padding: 8px;">${timeStr}</td>
                        <td style="font-weight: 500; padding: 8px;">${log.actor.split('@')[0]}</td>
                        <td style="padding: 8px;"><span style="background:${badgeColor}; color:${textColor}; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:600;">${log.action}</span></td>
                        <td style="color: var(--color-text-secondary); padding: 8px; word-break: break-word; white-space: normal;">${log.details}</td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `;
        }

        else if (title === 'View Reports' || title === 'Export Data') {
          contentHtml = `
            <div class="form-group">
              <label class="form-label">Select Report Type</label>
              <select class="form-select" id="reportTypeSelect" onchange="toggleReportInputs()"><option value="ward">Ward Patient List</option><option value="team">Team Care List</option><option value="treatment">Patient Treatment Record</option></select>
            </div>
            <div class="form-group" id="inputWard" style="display: block;"><label class="form-label">Select Ward</label><select class="form-select" id="reportWardSelect">${wards.map(w => `<option value="${w.name}">${w.name}</option>`).join('')}</select></div>
            <div class="form-group" id="inputTeam" style="display: none;"><label class="form-label">Select Care Team</label><select class="form-select" id="reportTeamSelect">${teams.map(t => `<option value="${t.name}">${t.name}</option>`).join('')}</select></div>
            <div class="form-group" id="inputPatient" style="display: none;"><label class="form-label">Select Patient</label><select class="form-select" id="reportPatientSelect">${patients.map(p => `<option value="${p.id}">${p.name} (ID: ${p.id})</option>`).join('')}</select></div>
            <button class="btn-primary" style="width: 100%; margin-top: 16px;" onclick="generateHAReport()">Generate Report</button>
            <div id="reportOutputArea" style="margin-top: 20px; border-top: 1px solid var(--color-border-tertiary); padding-top: 16px; display: none;"></div>
          `;
        }

        modalContent.innerHTML = contentHtml;
        
        // Route confirmation button based on modal type
        const confirmBtn = document.getElementById('sysModalConfirmBtn');
        if (title === 'Export Data') {
          confirmBtn.textContent = 'Download CSV'; 
          confirmBtn.onclick = downloadCSV;
        } else if (title === 'Edit Wards') {
          confirmBtn.textContent = 'Save Capacity'; 
          confirmBtn.onclick = saveWardSettings;
        } else if (title === 'Permissions') {
          confirmBtn.textContent = 'Save Policies'; 
          confirmBtn.onclick = savePermissions;
        } else if (title === 'User Roles') {
          confirmBtn.textContent = 'Save Role Permissions';
          confirmBtn.onclick = saveRolePermissions;
        } else if (title === 'Staff Roster') {
          confirmBtn.textContent = 'Save Roster';
          confirmBtn.onclick = saveRoster;
        } else if (title === 'Manage Accounts') {
          confirmBtn.textContent = 'Done';
          confirmBtn.onclick = () => closeModal('sysModal');
        } else {
          confirmBtn.textContent = 'Done'; 
          confirmBtn.onclick = () => closeModal('sysModal');
        }

        modalOverlay.classList.add('open');
      }

      // ====== WARD MANAGEMENT HELPERS ======
      function loadWardConfig(wardName) {
        const wc = wardConfigs.find(w => w.name === wardName);
        if (wc) {
          document.getElementById('editWardBeds').value = wc.beds;
          document.getElementById('editWardStatus').value = wc.status;
        }
      }

      async function saveWardSettings() {
        const wardName = document.getElementById('editWardSelect').value;
        const newBeds = document.getElementById('editWardBeds').value;
        const newStatus = document.getElementById('editWardStatus').value;

        try {
          await adminApiRequest(`/wards/${encodeURIComponent(wardName)}`, {
            method: 'PATCH',
            body: JSON.stringify({
              bed_capacity: parseInt(newBeds, 10) || 0,
              status: newStatus
            })
          });

          await refreshFromApiSnapshot();
          closeModal('sysModal');
          showToast(`Saved ${wardName} settings`);
        } catch (error) {
          alert(`Unable to save ward settings: ${error.message}`);
        }
      }

      async function addNewWard() {
        const name = document.getElementById('newWardName').value.trim();
        const beds = parseInt(document.getElementById('newWardBeds').value);
        if (!name) { alert('Please enter a ward name.'); return; }
        if (!confirm(`Add "${name}" ward with ${beds || 20} beds?`)) return;

        try {
          await adminApiRequest('/wards', {
            method: 'POST',
            body: JSON.stringify({
              name,
              bed_capacity: beds || 20,
              status: 'Active / Open'
            })
          });

          await refreshFromApiSnapshot();
          openSysModal('Edit Wards', 'Adjust total bed capacity for each ward.');
        } catch (error) {
          alert(`Unable to add ward: ${error.message}`);
        }
      }

      async function removeWard() {
        const name = document.getElementById('removeWardSelect').value;
        if (!confirm(`Are you sure you want to remove ${name} Ward?`)) return;

        try {
          await adminApiRequest(`/wards/${encodeURIComponent(name)}`, {
            method: 'DELETE'
          });

          await refreshFromApiSnapshot();
          openSysModal('Edit Wards', 'Adjust total bed capacity for each ward.');
        } catch (error) {
          alert(`Unable to remove ward: ${error.message}`);
        }
      }

      // ====== TEAM MANAGEMENT HELPERS ======
      async function addNewTeam() {
        const name = document.getElementById('newTeamName').value.trim();
        const consultant = document.getElementById('newTeamConsultant').value.trim();
        if (!name) { alert('Please enter a team name.'); return; }
        const fullName = name.startsWith('Team ') ? name : 'Team ' + name;
        if (!confirm(`Add "${fullName}"${consultant ? ` with ${consultant} as lead consultant` : ''}?`)) return;

        try {
          await adminApiRequest('/teams', {
            method: 'POST',
            body: JSON.stringify({
              name: fullName,
              consultant_name: consultant || null
            })
          });

          await refreshFromApiSnapshot();
          openSysModal('Manage Team', 'Assign or remove consultants and junior doctors.');
          showToast(`Added ${fullName}`);
        } catch (error) {
          alert(`Unable to add team: ${error.message}`);
        }
      }

      async function removeTeam() {
        const name = document.getElementById('removeTeamSelect').value;
        if (!confirm(`Are you sure you want to remove ${name}?`)) return;

        try {
          await adminApiRequest(`/teams/${encodeURIComponent(name)}`, {
            method: 'DELETE'
          });

          await refreshFromApiSnapshot();
          openSysModal('Manage Team', 'Assign or remove consultants and junior doctors.');
          showToast(`Removed ${name}`);
        } catch (error) {
          alert(`Unable to remove team: ${error.message}`);
        }
      }

      // ====== PERMISSION & SECURITY HELPERS ======
      async function savePermissions() {
        const nextPerms = {
          timeout: document.getElementById('permTimeout').value,
          mfa: document.getElementById('permMFA').value,
          ip: document.getElementById('permIP').value
        };

        try {
          const result = await adminApiRequest('/system-perms', {
            method: 'PATCH',
            body: JSON.stringify(nextPerms)
          });
          sysPerms = { ...sysPerms, ...(result.data || nextPerms) };
          saveData();
          closeModal('sysModal');
          showToast('System policies saved');
        } catch (error) {
          alert(`Unable to save policies: ${error.message}`);
        }
      }

      async function loadRoster(teamName) {
        const tbody = document.getElementById('rosterTbody');
        if (!tbody) return;

        const defaults = {
          d: ['House', 'House', 'Chase', 'Chase', 'Cameron'],
          n: ['Cameron', 'Cameron', 'House', 'Chase', 'House']
        };
        let data = rosterData[teamName] || defaults;

        try {
          const result = await adminApiRequest(`/roster/${encodeURIComponent(teamName)}`);
          if (result?.success && result.data?.roster) {
            data = result.data.roster;
            rosterData[teamName] = data;
          }
        } catch (error) {
          // Keep local fallback.
        }

        tbody.innerHTML = `
          <tr>
            <td style="font-weight:500;">Day<br><span style="color:var(--color-text-secondary);font-size:9px;">08:00-20:00</span></td>
            ${data.d.map((val, i) => `<td><input type="text" id="r_d_${i}" class="form-input roster-input" value="${val}" /></td>`).join('')}
          </tr>
          <tr>
            <td style="font-weight:500;">Night<br><span style="color:var(--color-text-secondary);font-size:9px;">20:00-08:00</span></td>
            ${data.n.map((val, i) => `<td><input type="text" id="r_n_${i}" class="form-input roster-input" value="${val}" /></td>`).join('')}
          </tr>
        `;
      }

      async function saveRoster() {
        const teamName = document.getElementById('rosterTeamSelect')?.value;
        if (!teamName) {
          closeModal('sysModal');
          return;
        }

        const d = [0, 1, 2, 3, 4].map(i => document.getElementById(`r_d_${i}`)?.value || '');
        const n = [0, 1, 2, 3, 4].map(i => document.getElementById(`r_n_${i}`)?.value || '');
        try {
          await adminApiRequest(`/roster/${encodeURIComponent(teamName)}`, {
            method: 'POST',
            body: JSON.stringify({ d, n })
          });

          rosterData[teamName] = { d, n };
          saveData();
          closeModal('sysModal');
          showToast('Roster saved');
        } catch (error) {
          alert(`Unable to save roster: ${error.message}`);
        }
      }

      function renderWardHistoryChart() {
        const area = document.getElementById('wardHistoryChartArea');
        if (!area) return;

        let bars = '';
        for (let i = 0; i < 7; i++) {
          const height = Math.floor(Math.random() * 60) + 20;
          bars += `<div style="flex: 1; min-width: 18px; max-width: 36px; background: linear-gradient(180deg, #1D9E75 0%, #0F6E56 100%); border-radius: 4px 4px 0 0; height: ${height}%;"></div>`;
        }
        area.innerHTML = bars;
      }

      async function createNewRole() {
        const roleInput = document.getElementById('customRoleName');
        const successMsg = document.getElementById('roleSuccessMsg');
        if (!roleInput || !successMsg) return;

        const roleName = roleInput.value.trim();
        if (!roleName) {
          alert('Please enter a role name.');
          return;
        }

        try {
          await adminApiRequest('/roles', {
            method: 'POST',
            body: JSON.stringify({ role_name: roleName })
          });
        } catch (error) {
          alert(`Unable to add role: ${error.message}`);
          return;
        }

        await syncAdminConfigFromBackend();
        saveData();

        roleInput.value = '';
        successMsg.textContent = `Role "${roleName}" added successfully.`;
        successMsg.style.display = 'block';

        const roleSelect = document.getElementById('editRoleSelect');
        if (roleSelect) {
          roleSelect.innerHTML = availableRoles.map(r => `<option value="${r}">${r}</option>`).join('');
          roleSelect.value = roleName;
          loadRolePermissionsForEdit(roleName);
        }
      }

      function loadRolePermissionsForEdit(roleName) {
        if (!roleName) return;
        const t = roleTemplates[roleName] || {};

        const setChecked = (id, value) => {
          const el = document.getElementById(id);
          if (el) el.checked = !!value;
        };

        setChecked('role_viewGlobalPatients', t.viewGlobalPatients);
        setChecked('role_admit', t.admit);
        setChecked('role_discharge', t.discharge);
        setChecked('role_transfer', t.transfer);
        setChecked('role_logTreatment', t.logTreatment);
        setChecked('role_bedMatrix', t.bedMatrix);
        setChecked('role_viewReports', t.viewReports);
        setChecked('role_exportData', t.exportData);
        setChecked('role_manageWards', t.manageWards);
        setChecked('role_manageStaff', t.manageStaff);
        setChecked('role_manageAccounts', t.manageAccounts);
        setChecked('role_manageSystem', t.manageSystem);

        const allowedWards = Array.isArray(t.allowedWards) ? t.allowedWards : [];
        const allowedTeams = Array.isArray(t.allowedTeams) ? t.allowedTeams : [];
        scopeModalState = {
          context: 'role',
          roleName,
          userIndex: null,
          allowedWards: [...allowedWards],
          allowedTeams: [...allowedTeams]
        };
        updateScopeSummary('role', allowedWards, allowedTeams, !!t.viewGlobalPatients);

        if (!t.viewGlobalPatients) {
          openScopeModal(
            'role',
            'Role Data Scope',
            'Select the wards and teams this role can view when global visibility is off.',
            allowedWards,
            allowedTeams
          );
        } else {
          closeScopeModal();
        }
      }

      async function saveRolePermissions() {
        const roleName = document.getElementById('editRoleSelect')?.value;
        if (!roleName) return;

        const getChecked = id => !!document.getElementById(id)?.checked;
        const allowedWards = scopeModalState.context === 'role' && scopeModalState.roleName === roleName
          ? [...scopeModalState.allowedWards]
          : [...(roleTemplates[roleName]?.allowedWards || [])];
        const allowedTeams = scopeModalState.context === 'role' && scopeModalState.roleName === roleName
          ? [...scopeModalState.allowedTeams]
          : [...(roleTemplates[roleName]?.allowedTeams || [])];

        const nextTemplate = {
          viewGlobalPatients: getChecked('role_viewGlobalPatients'),
          allowedWards: allowedWards,
          allowedTeams: allowedTeams,
          admit: getChecked('role_admit'),
          discharge: getChecked('role_discharge'),
          transfer: getChecked('role_transfer'),
          logTreatment: getChecked('role_logTreatment'),
          exportData: getChecked('role_exportData'),
          manageSystem: getChecked('role_manageSystem'),
          manageStaff: getChecked('role_manageStaff'),
          manageAccounts: getChecked('role_manageAccounts'),
          manageWards: getChecked('role_manageWards'),
          viewReports: getChecked('role_viewReports'),
          bedMatrix: getChecked('role_bedMatrix')
        };

        try {
          await adminApiRequest(`/roles/${encodeURIComponent(roleName)}`, {
            method: 'PATCH',
            body: JSON.stringify(nextTemplate)
          });
        } catch (error) {
          alert(`Unable to save role permissions: ${error.message}`);
          return;
        }

        roleTemplates[roleName] = nextTemplate;

        systemUsers.forEach(u => {
          if (u.role === roleName && !u.customPermissions) {
            u.permissions = { ...nextTemplate };
          }
        });

        const activeSession = JSON.parse(sessionStorage.getItem('activeUser'));
        if (activeSession && activeSession.role === roleName && !activeSession.customPermissions) {
          activeSession.permissions = { ...nextTemplate };
          sessionStorage.setItem('activeUser', JSON.stringify(activeSession));
        }

        saveData();
        await refreshFromApiSnapshot();
        applySecurityAndProfile();
        filterTable();
        alert(`Permissions saved for role: ${roleName}`);
      }

      // ====== STAFF & USER ACCOUNT HELPERS ======
      async function deleteUserAccount(index) {
        const user = systemUsers[index];
        if (!user) return;
        const activeSession = JSON.parse(sessionStorage.getItem('activeUser'));
        if (activeSession && activeSession.email === user.email) {
          alert("Action Denied: You cannot delete your own active administrator account.");
          return;
        }

        if (confirm(`Are you sure you want to revoke system access for ${user.name}? This action cannot be undone.`)) {
          try {
            await adminApiRequest(`/users/${encodeURIComponent(user.email)}`, {
              method: 'DELETE'
            });
            await syncSystemUsersFromBackend();
            logSystemAction('ACCOUNT_REVOKE', user.email, `System access permanently revoked`);
            saveData();
          } catch (error) {
            alert(`Unable to revoke access: ${error.message}`);
            return;
          }
          openSysModal('Manage Accounts', 'Create and manage user login credentials.');
        }
      }

      async function resetUserPassword(index) {
        const user = systemUsers[index];
        if (!user) return;
        const newPass = prompt(`Enter a new temporary password for ${user.name}:\n(They will be forced to change this upon next login)`, "Temp1234!");
        
        if (newPass !== null && newPass.trim() !== "") {
          try {
            await adminApiRequest(`/users/${encodeURIComponent(user.email)}/password`, {
              method: 'PATCH',
              body: JSON.stringify({
                new_password: newPass.trim()
              })
            });
            logSystemAction('ACCOUNT_PASSWORD_RESET', user.email, 'Temporary password reset by admin');
            alert(`Password successfully updated for ${user.email}.`);
          } catch (error) {
            alert(`Unable to reset password: ${error.message}`);
          }
        }
      }

      async function resetUserToRoleDefaults(index) {
        const user = systemUsers[index];
        if (!user) return;
        const baseTemplate = roleTemplates[user.role];

        if (!baseTemplate) {
          alert(`No role template found for ${user.role}.`);
          return;
        }

        if (!confirm(`Reset ${user.name}'s permissions to the ${user.role} role defaults?`)) return;

        try {
          const resp = await adminApiRequest(`/users/${encodeURIComponent(user.email)}/reset-permissions`, {
            method: 'POST'
          });

          const updatedUser = resp?.data;
          if (updatedUser) {
            systemUsers[index] = {
              ...systemUsers[index],
              ...updatedUser,
              permissions: updatedUser.permissions || {},
              customPermissions: !!updatedUser.customPermissions
            };
            syncActiveSessionUser(systemUsers[index]);
          }

          logSystemAction('SECURITY_UPDATE', user.email, 'User permissions reset to role defaults');
          saveData();
        } catch (error) {
          alert(`Unable to reset permissions: ${error.message}`);
          return;
        }

        openSysModal('Manage Accounts', 'Create and manage user login credentials.');
      }

      async function createNewAccount() {
        const name = document.getElementById('newAccStaffLink').value;
        const email = document.getElementById('newAccEmail').value.trim().toLowerCase();
        const pass = document.getElementById('newAccPass').value.trim();
        const role = document.getElementById('newAccRole').value;

        if (!name) {
          alert("Please select a staff member to link this account to.");
          return;
        }
        if (!email || !pass) {
          alert("Please fill out the email and password fields.");
          return;
        }

        if (systemUsers.find(u => u.email.toLowerCase() === email.toLowerCase())) {
          alert("An account with this email already exists.");
          return;
        }

        try {
          await adminApiRequest('/users', {
            method: 'POST',
            body: JSON.stringify({
              linked_staff_name: name,
              email,
              password: pass,
              role
            })
          });

          await syncSystemUsersFromBackend();
          saveData();
          showToast(`Account created for ${name}`);
          openSysModal('Manage Accounts', 'Create and manage user login credentials.');
        } catch (error) {
          alert(`Unable to create account: ${error.message}`);
        }
      }

      let editingUserIndex = null;

      function openUserPermsEditor(index) {
        editingUserIndex = index;
        const user = systemUsers[index];
        if (!user) return;

        const roleFallback = roleTemplates[user.role] || {};
        const p = { ...roleFallback, ...(user.permissions || {}) };
        p.allowedWards = Array.isArray(p.allowedWards) ? p.allowedWards : [];
        p.allowedTeams = Array.isArray(p.allowedTeams) ? p.allowedTeams : [];

        const modalContent = document.getElementById('sysModalContent');
        document.getElementById('sysModalTitle').textContent = `Editing Permissions: ${user.name}`;
        document.getElementById('sysModalDesc').textContent = `Modifying granular access for ${user.email}`;

        const allTeams = teams.map(t => t.name.replace('Team ', ''));

        modalContent.innerHTML = `
          <div style="font-size: 13px; font-weight: 500; margin-bottom: 12px; color: #1D9E75;">Global Visibility & Actions</div>
          <div class="form-row">
            <label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
              <input type="checkbox" id="cb_global" ${p.viewGlobalPatients ? 'checked' : ''} onchange="handleUserGlobalVisibilityChange()"> View Global Patients
            </label>
            <label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
              <input type="checkbox" id="cb_log" ${p.logTreatment ? 'checked' : ''}> Log Treatments
            </label>
          </div>
          
          <div class="form-row" style="margin-bottom: 16px;">
            <label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;"><input type="checkbox" id="cb_admit" ${p.admit ? 'checked' : ''}> Can Admit</label>
            <label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;"><input type="checkbox" id="cb_discharge" ${p.discharge ? 'checked' : ''}> Can Discharge</label>
            <label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;"><input type="checkbox" id="cb_transfer" ${p.transfer ? 'checked' : ''}> Can Transfer</label>
          </div>

          <div style="border-top: 1px solid var(--color-border-tertiary); padding-top: 16px;">
            <div style="font-size: 13px; font-weight: 500; margin-bottom: 4px; color: #1D9E75;">Data Scope (Ward & Team Filters)</div>
            <div style="font-size: 11px; color: var(--color-text-secondary); margin-bottom: 10px;">
              Scope opens in a separate modal whenever global visibility is turned off.
            </div>
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <div id="perm_scopeSummary" style="font-size: 11px; color: var(--color-text-secondary); flex: 1; min-width: 220px;">Global visibility is enabled. Scope filters are inactive.</div>
                <button type="button" class="btn-cancel" id="perm_scopeButton" onclick="openScopeModal('user', 'User Data Scope', 'Select the wards and teams this user can view when global visibility is off.', scopeModalState.allowedWards || [], scopeModalState.allowedTeams || [])" style="display:none;">Configure scope</button>
            </div>
          </div>
        `;

        scopeModalState = {
          context: 'user',
          roleName: null,
          userIndex: index,
          allowedWards: [...p.allowedWards],
          allowedTeams: [...p.allowedTeams]
        };

        updateScopeSummary('user', p.allowedWards, p.allowedTeams, !!p.viewGlobalPatients);

        if (!p.viewGlobalPatients) {
          openScopeModal(
            'user',
            'User Data Scope',
            'Select the wards and teams this user can view when global visibility is off.',
            p.allowedWards,
            p.allowedTeams
          );
        } else {
          closeScopeModal();
        }

        const confirmBtn = document.getElementById('sysModalConfirmBtn');
        confirmBtn.textContent = 'Save User Perms';
        confirmBtn.onclick = saveGranularPerms;
      }

      async function saveGranularPerms() {
        if (editingUserIndex === null) return;
        const user = systemUsers[editingUserIndex];
        if (!user) return;
        
        const nextPermissions = {
          ...(roleTemplates[user.role] || {}),
          ...(user.permissions || {})
        };

        nextPermissions.viewGlobalPatients = document.getElementById('cb_global').checked;
        nextPermissions.admit = document.getElementById('cb_admit').checked;
        nextPermissions.discharge = document.getElementById('cb_discharge').checked;
        nextPermissions.transfer = document.getElementById('cb_transfer').checked;
        nextPermissions.logTreatment = document.getElementById('cb_log').checked;

        const allowedWards = scopeModalState.context === 'user' && scopeModalState.userIndex === editingUserIndex
          ? [...scopeModalState.allowedWards]
          : [...(nextPermissions.allowedWards || [])];
        const allowedTeams = scopeModalState.context === 'user' && scopeModalState.userIndex === editingUserIndex
          ? [...scopeModalState.allowedTeams]
          : [...(nextPermissions.allowedTeams || [])];

        nextPermissions.allowedWards = allowedWards;
        nextPermissions.allowedTeams = allowedTeams;
        nextPermissions.customPermissions = true;

        try {
          const resp = await adminApiRequest(`/users/${encodeURIComponent(user.email)}/permissions`, {
            method: 'PATCH',
            body: JSON.stringify(nextPermissions)
          });

          if (resp?.data) {
            systemUsers[editingUserIndex] = {
              ...systemUsers[editingUserIndex],
              ...resp.data,
              permissions: resp.data.permissions || {},
              customPermissions: !!resp.data.customPermissions
            };
            syncActiveSessionUser(systemUsers[editingUserIndex]);
          }

          logSystemAction('SECURITY_UPDATE', user.email, `Granular access control modified`);
          saveData();
        } catch (error) {
          alert(`Unable to save user permissions: ${error.message}`);
          return;
        }
        
        openSysModal('Manage Accounts', 'Create and manage user login credentials.');
      }

      function updateStaffModalTable(teamName) {
        const tbody = document.getElementById('manageTeamStaffBody');
        if (!tbody) return;

        const teamStaff = doctors.filter(d => d.team === teamName);

        if (teamStaff.length === 0) {
          tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 12px; color: var(--color-text-secondary);">No staff assigned to this team.</td></tr>';
          return;
        }

        tbody.innerHTML = teamStaff.map(d => `
          <tr>
            <td style="font-weight:500;">${d.name}</td>
            <td>${d.role} ${d.role === 'Consultant' ? '(Lead)' : ''}</td>
            <td style="text-align: right;">
              <button class="action-btn" style="color: #E24B4A; border-color: #E24B4A;" onclick="removeStaffFromSystem('${d.name}')">Remove</button>
            </td>
          </tr>
        `).join('');
      }

      function addNewStaffToSystem() {
        const name = document.getElementById('newStaffName').value.trim();
        const role = document.getElementById('newStaffRole').value;
        const team = document.getElementById('manageTeamSelect').value;

        if (!name) { alert("Please enter a staff name."); return; }
        if (!confirm(`Add ${name} as ${role} to ${team}?`)) return;

        if (role === 'Consultant') {
          doctors.forEach(d => {
            if (d.team === team && d.role === 'Consultant') {
              d.role = 'Junior Doctor';
              d.grade = 'Senior Registrar';
            }
          });
        }

        doctors.push({
          name: name,
          role: role,
          grade: role === 'Consultant' ? 'Lead Consultant' : 'ST4',
          team: team
        });

        document.getElementById('newStaffName').value = '';
        updateStaffModalTable(team);
        saveData();
        refreshDashboard(); 
      }

      function removeStaffFromSystem(doctorName) {
        if (!confirm(`Remove ${doctorName} from the system?`)) return;
        const idx = doctors.findIndex(d => d.name === doctorName);
        if (idx > -1) {
          doctors.splice(idx, 1);
          saveData();
          refreshDashboard();
          const teamName = document.getElementById('manageTeamSelect').value;
          updateStaffModalTable(teamName);
        }
      }

      // ====== REPORTING & EXPORT HELPERS ======
      function toggleReportInputs() {
        const type = document.getElementById('reportTypeSelect').value;
        document.getElementById('inputWard').style.display = type === 'ward' ? 'block' : 'none';
        document.getElementById('inputTeam').style.display = type === 'team' ? 'block' : 'none';
        document.getElementById('inputPatient').style.display = type === 'treatment' ? 'block' : 'none';
        document.getElementById('reportOutputArea').style.display = 'none'; 
      }

      function generateHAReport() {
        const type = document.getElementById('reportTypeSelect').value;
        const outputArea = document.getElementById('reportOutputArea');
        let html = '';

        if (type === 'ward') {
          const wardName = document.getElementById('reportWardSelect').value;
          const wardPatients = patients.filter(p => p.ward === wardName || p.ward.includes(wardName));

          html += `<div style="font-size: 14px; font-weight: 500; margin-bottom: 8px;">Patients in ${wardName} Ward</div>`;
          if (wardPatients.length === 0) {
            html += `<div style="color: var(--color-text-secondary); font-size: 12px;">No patients currently in this ward.</div>`;
          } else {
            html += `<div class="table-wrap" style="max-height: 250px; overflow-y: auto;"><table><thead><tr><th>Patient Name</th><th>Age</th></tr></thead><tbody>`;
            html += wardPatients.map(p => `<tr><td>${p.name}</td><td>${p.age}</td></tr>`).join('');
            html += `</tbody></table></div>`;
          }
        } 
        else if (type === 'team') {
          const teamName = document.getElementById('reportTeamSelect').value;
          const teamPatients = patients.filter(p => p.team === teamName || 'Team ' + p.team === teamName || p.team.includes(teamName.replace('Team ', '')));

          html += `<div style="font-size: 14px; font-weight: 500; margin-bottom: 8px;">Patients under care of ${teamName}</div>`;
          if (teamPatients.length === 0) {
            html += `<div style="color: var(--color-text-secondary); font-size: 12px;">No patients currently assigned to this team.</div>`;
          } else {
            html += `<div class="table-wrap" style="max-height: 250px; overflow-y: auto;"><table><thead><tr><th>Patient Name</th><th>Current Ward</th></tr></thead><tbody>`;
            html += teamPatients.map(p => `<tr><td style="font-weight: 500;">${p.name}</td><td>${p.ward}</td></tr>`).join('');
            html += `</tbody></table></div>`;
          }
        } 
        else if (type === 'treatment') {
          const patientId = document.getElementById('reportPatientSelect').value;
          const p = patients.find(x => x.id === patientId);
          if (!p) return;

          html += `<div style="font-size: 14px; font-weight: 500; margin-bottom: 12px;">Treatment Record: ${p.name}</div>`;
          const leadConsultant = getLeadConsultantForPatient(p.team);

          html += `
            <div class="pt-detail-meta" style="margin-bottom: 12px; background: var(--color-background-secondary); border-radius: var(--border-radius-md);">
              <div class="meta-item"><div class="meta-label">Responsible Consultant</div><div class="meta-val">${leadConsultant}</div></div>
              <div class="meta-item"><div class="meta-label">Team Code</div><div class="meta-val">${p.team}</div></div>
            </div>
            <div style="font-size: 12px; font-weight: 500; margin-bottom: 6px;">Treating Doctors History</div>
          `;

          if (!p.treatments || p.treatments.length === 0) {
            html += `<div style="color: var(--color-text-secondary); font-size: 12px; border: 0.5px dashed var(--color-border-tertiary); padding: 12px; text-align: center; border-radius: 4px;">No treatments recorded in this system yet.</div>`;
          } else {
            html += `<div class="table-wrap" style="max-height: 150px; overflow-y: auto;"><table><thead><tr><th>Doctor Name</th><th>Role</th><th>Grade</th></tr></thead><tbody>`;
            html += p.treatments.map(t => `<tr><td style="font-weight: 500;">${t.name}</td><td>${t.role}</td><td>${t.grade || '—'}</td></tr>`).join('');
            html += `</tbody></table></div>`;
          }
        }

        outputArea.innerHTML = html;
        outputArea.style.display = 'block';
      }

      function downloadCSV() {
        const headers = ["Patient ID", "Full Name", "Age", "Sex", "Assigned Ward", "Bed", "Care Team", "Lead Consultant"];
        
        const rows = patients.map(p => [
          p.id, 
          `"${p.name}"`, 
          p.age, 
          p.sex, 
          `"${p.ward}"`, 
          p.bed, 
          `"${p.team}"`, 
          `"${getLeadConsultantForPatient(p.team)}"`
        ]);
        
        let csvContent = "data:text/csv;charset=utf-8," 
          + headers.join(",") + "\n"
          + rows.map(e => e.join(",")).join("\n");
          
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        
        const dateStr = new Date().toISOString().split('T')[0];
        link.setAttribute("download", `WardFlow_Export_${dateStr}.csv`);
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        closeModal('sysModal');
        setTimeout(() => alert("✅ Export successful! Check your downloads folder."), 300);
      }

      // =============================================================================
      // ANALYTICS ENGINE (Chart.js Integration)
      // =============================================================================
      function renderAnalyticsCharts() {
        const wardCanvas = document.getElementById('wardChart');
        const teamCanvas = document.getElementById('teamChart');
        if (!wardCanvas || !teamCanvas) return;

        bindAnalyticsRouting();
        renderAnalyticsScopeBadge();

        if (typeof Chart === 'undefined') {
          alert('Analytics library failed to load. Please refresh and try again.');
          return;
        }

        // Destroy previous charts to avoid Chart.js canvas reuse errors.
        if (wardAnalyticsChart) wardAnalyticsChart.destroy();
        if (teamAnalyticsChart) teamAnalyticsChart.destroy();

        const wardNames = wards.map(w => w.name);
        const wardOccupied = wards.map(w => w.occ);
        const wardAvailable = wards.map(w => w.beds - w.occ);

        wardAnalyticsChart = new Chart(wardCanvas, {
          type: 'bar',
          data: {
            labels: wardNames,
            datasets: [
              {
                label: 'Occupied Beds',
                data: wardOccupied,
                backgroundColor: '#1D9E75',
                borderRadius: 4
              },
              {
                label: 'Available Beds',
                data: wardAvailable,
                backgroundColor: '#E5E7EB',
                borderRadius: 4
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: (_, activeElements) => {
              if (!activeElements || activeElements.length === 0) return;
              const index = activeElements[0].index;
              const wardName = wardNames[index];
              window.location.href = `workload.html?ward=${encodeURIComponent(wardName)}`;
            },
            scales: {
              x: { stacked: true, grid: { display: false } },
              y: { stacked: true, beginAtZero: true }
            },
            plugins: {
              legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } }
            }
          }
        });

        const teamNames = teams.map(t => t.name.replace('Team ', ''));
        const teamCounts = teams.map(t => t.count);

        teamAnalyticsChart = new Chart(teamCanvas, {
          type: 'doughnut',
          data: {
            labels: teamNames,
            datasets: [{
              data: teamCounts,
              backgroundColor: [
                '#1D9E75',
                '#3B82F6',
                '#F59E0B',
                '#8B5CF6',
                '#E24B4A',
                '#14B8A6',
                '#F97316',
                '#64748B'
              ],
              borderWidth: 0,
              hoverOffset: 4
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            onClick: (_, activeElements) => {
              if (!activeElements || activeElements.length === 0) return;
              const index = activeElements[0].index;
              const teamName = teamNames[index];
              window.location.href = `workload.html?team=${encodeURIComponent(teamName)}`;
            },
            plugins: {
              legend: { position: 'right', labels: { boxWidth: 12, font: { size: 10 } } }
            }
          }
        });
      }
