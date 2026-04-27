// =============================================================================
// auth.js - Identity and Session Management Module
// =============================================================================
// PURPOSE: Manage user authentication, session state, and role-based permissions
//
// KEY CONCEPTS:
// - sessionStorage: Holds ACTIVE USER (lost on browser close) - checked at page load
// - localStorage: Holds remembered test users and permission templates for local fallback flows
// - roleTemplates: Permission blueprints (System Admin, Consultant, Junior Doctor, Ward Manager)
// - AUTO-UPGRADE: Users without explicit permissions are assigned a role template on first login
//
// DEPENDENCY: Loads BEFORE script.js. Uses roleTemplates and systemUsers globally.
// =============================================================================

// ====== SECTION 1: SESSION PROTECTION ======
// On every page load, check if user has active session.
// If not logged in and not on login page -> redirect to login.html

const activeUser = JSON.parse(sessionStorage.getItem('activeUser'));
const AUTH_API_BASE_URL = typeof window.resolveApiBaseUrl === 'function'
  ? window.resolveApiBaseUrl()
  : (window.WARDFLOW_API_BASE_URL || '/api');

if (!activeUser && !window.location.href.includes('login.html')) {
  window.location.href = 'login.html';
}

function parseSessionTimeoutMinutes(timeoutValue) {
  if (!timeoutValue) return 30;
  const text = String(timeoutValue).toLowerCase();
  const numeric = parseInt(text, 10);
  if (Number.isNaN(numeric)) return 30;

  if (text.includes('hour')) return numeric * 60;
  return numeric;
}

function startSessionTimeoutGuard() {
  if (window.location.href.includes('login.html')) return;

  const active = JSON.parse(sessionStorage.getItem('activeUser'));
  if (!active) return;

  const storedPerms = JSON.parse(localStorage.getItem('wardflow_perms')) || {};
  const timeoutMinutes = parseSessionTimeoutMinutes(storedPerms.timeout || '30 Minutes');
  const timeoutMs = timeoutMinutes * 60 * 1000;
  const ACTIVITY_KEY = 'wardflow_last_activity_ts';

  if (!sessionStorage.getItem(ACTIVITY_KEY)) {
    sessionStorage.setItem(ACTIVITY_KEY, String(Date.now()));
  }

  const bumpActivity = () => {
    sessionStorage.setItem(ACTIVITY_KEY, String(Date.now()));
  };

  const endSessionForTimeout = () => {
    sessionStorage.removeItem('activeUser');
    sessionStorage.removeItem(ACTIVITY_KEY);
    alert(`Session expired after ${timeoutMinutes} minute(s) of inactivity. Please sign in again.`);
    window.location.href = 'login.html';
  };

  ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'].forEach(evt => {
    window.addEventListener(evt, bumpActivity, { passive: true });
  });

  setInterval(() => {
    const last = parseInt(sessionStorage.getItem(ACTIVITY_KEY) || '0', 10);
    if (!last) {
      bumpActivity();
      return;
    }

    if (Date.now() - last > timeoutMs) {
      endSessionForTimeout();
    }
  }, 15000);
}

// ====== SECTION 2: USER DATABASE ======
// All system users stored in localStorage under key 'wardflow_users'
// Declared globally so script.js can read/modify when managing accounts
// User object structure: { email, password, role, name, permissions (optional) }
// 
// PASSWORD SECURITY NOTE: The live API stores hashes; the local seeded user list remains a test fallback.

let systemUsers = JSON.parse(localStorage.getItem('wardflow_users')) || [
  { email: 'wardflowhms@gmail.com', password: 'password123', role: 'System Admin', name: 'Admin Account' },
  { email: 'house@wardflow.com', password: 'password123', role: 'Consultant', name: 'Dr. Gregory House' }
];

// ====== SECTION 3: ROLE PERMISSION TEMPLATES ======
// Blueprint permissions for each role type.
// Keys match role names in systemUsers[].role
// Used during login to assign the active role template when permissions are missing
// 
// Permission flags:
// - viewGlobalPatients: Can see all patients vs only assigned patients
// - allowedWards/Teams: Scopes for ward managers and team doctors
// - admit, discharge, transfer, logTreatment: Patient operation permissions
// - exportData, manageSystem, manageStaff, manageAccounts, manageWards, viewReports, bedMatrix: Admin features

const defaultRoleTemplates = {
  'System Admin': {
    viewGlobalPatients: true, allowedWards: [], allowedTeams: [],
    admit: true, discharge: true, transfer: true, logTreatment: true,
    exportData: true, manageSystem: true, manageStaff: true,
    manageAccounts: true, manageWards: true, viewReports: true, bedMatrix: true
  },
  'Consultant': {
    viewGlobalPatients: true, allowedWards: [], allowedTeams: [],
    admit: true, discharge: true, transfer: true, logTreatment: true,
    exportData: false, manageSystem: false, manageStaff: false,
    manageAccounts: false, manageWards: false, viewReports: true, bedMatrix: true
  },
  'Junior Doctor': {
    viewGlobalPatients: false, allowedWards: [], allowedTeams: [],
    admit: false, discharge: false, transfer: false, logTreatment: true,
    exportData: false, manageSystem: false, manageStaff: false,
    manageAccounts: false, manageWards: false, viewReports: false, bedMatrix: true
  },
  'Ward Manager': {
    viewGlobalPatients: false, allowedWards: [], allowedTeams: [],
    admit: true, discharge: false, transfer: true, logTreatment: false,
    exportData: true, manageSystem: false, manageStaff: false,
    manageAccounts: false, manageWards: true, viewReports: true, bedMatrix: true
  }
};

const storedRoleTemplates = JSON.parse(localStorage.getItem('wardflow_role_templates')) || {};
const roleTemplates = {};
Object.keys(defaultRoleTemplates).forEach(role => {
  roleTemplates[role] = { ...defaultRoleTemplates[role], ...(storedRoleTemplates[role] || {}) };
});
Object.keys(storedRoleTemplates).forEach(role => {
  if (!roleTemplates[role]) {
    roleTemplates[role] = { ...storedRoleTemplates[role] };
  }
});

// ====== SECTION 4: AUTHENTICATION FUNCTIONS ======
// Core login/logout logic with auto-upgrade handling
// LOGIN FUNCTION: Validates credentials, checks for auto-upgrade, sets session
// Called by form submit on login.html
// Flow: Validate email/password -> Check permissions -> Auto-upgrade if needed -> Save to sessionStorage -> Redirect

const authLifecycleState = {
  user: null,
  token: '',
  rememberMe: false,
  requiresPasswordChange: false,
  requiresOtp: false,
  otpResendCooldownUntil: 0,
};
const DEMO_MODE = false;

function setMainLoginButtonState(isBusy, label) {
  const btn = document.getElementById('loginBtn');
  if (!btn) return;
  btn.textContent = label || (isBusy ? 'Authenticating...' : 'Sign In');
  btn.style.opacity = isBusy ? '0.8' : '1';
  btn.disabled = isBusy;
}

function showLoginError(message) {
  const errorEl = document.getElementById('loginError');
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.style.display = 'block';
}

function hideLoginError() {
  const errorEl = document.getElementById('loginError');
  if (!errorEl) return;
  errorEl.style.display = 'none';
}

function openModalById(modalId) {
  const el = document.getElementById(modalId);
  if (!el) return;
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');

  const firstInput = el.querySelector('input, button, select, textarea');
  if (firstInput) firstInput.focus();
}

function closeModalById(modalId) {
  const el = document.getElementById(modalId);
  if (!el) return;
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
}

function setModalMessage(elementId, message, kind = 'info') {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message || '';
  el.style.display = message ? 'block' : 'none';
  if (kind === 'error') {
    el.style.color = '#E24B4A';
    el.style.background = 'rgba(226,75,74,0.08)';
    el.style.border = '0.5px solid rgba(226,75,74,0.3)';
  } else {
    el.style.color = '#0F6E56';
    el.style.background = 'rgba(29,158,117,0.08)';
    el.style.border = '0.5px solid rgba(29,158,117,0.3)';
  }
}

function applyModalBusyState(buttonId, isBusy, busyLabel, idleLabel) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  btn.disabled = isBusy;
  btn.style.opacity = isBusy ? '0.8' : '1';
  btn.textContent = isBusy ? busyLabel : idleLabel;
}

function saveAuthenticatedSessionAndRedirect() {
  const matchedUser = { ...(authLifecycleState.user || {}) };
  matchedUser.token = authLifecycleState.token;

  if (matchedUser.role && matchedUser.permissions) {
    roleTemplates[matchedUser.role] = { ...matchedUser.permissions };
  }

  sessionStorage.setItem('wardflow_access_token', authLifecycleState.token);
  sessionStorage.setItem('activeUser', JSON.stringify(matchedUser));
  sessionStorage.setItem('wardflow_last_activity_ts', String(Date.now()));

  if (authLifecycleState.rememberMe) {
    localStorage.setItem('wardflow_remembered_email', matchedUser.email);
  } else {
    localStorage.removeItem('wardflow_remembered_email');
  }

  const landingPage = matchedUser.role === 'System Admin' ? 'analytics.html' : 'index.html';
  setTimeout(() => { window.location.href = landingPage; }, 250);
}

function resetAuthLifecycleState() {
  authLifecycleState.user = null;
  authLifecycleState.token = '';
  authLifecycleState.rememberMe = false;
  authLifecycleState.requiresPasswordChange = false;
  authLifecycleState.requiresOtp = false;
  authLifecycleState.otpResendCooldownUntil = 0;
}

function updateOtpResendButtonCooldown() {
  const resendBtn = document.getElementById('resendOtpBtn');
  if (!resendBtn) return;

  const now = Date.now();
  const remainingMs = authLifecycleState.otpResendCooldownUntil - now;
  if (remainingMs <= 0) {
    resendBtn.disabled = false;
    resendBtn.textContent = 'Resend Code';
    return;
  }

  const seconds = Math.ceil(remainingMs / 1000);
  resendBtn.disabled = true;
  resendBtn.textContent = `Resend in ${seconds}s`;
  setTimeout(updateOtpResendButtonCooldown, 1000);
}

function beginOtpFlow(data) {
  const otpHint = data && data.otpDelivery === 'development-fallback'
    ? `OTP sent via development fallback. Code: ${data.devOtpCode || 'check server log'}`
    : 'We sent a one-time verification code to your email address.';

  setModalMessage('otpMessage', otpHint, 'info');
  closeModalById('passwordChangeModal');
  openModalById('otpModal');

  authLifecycleState.otpResendCooldownUntil = Date.now() + 30000;
  updateOtpResendButtonCooldown();
}

async function authFetch(path, method, body) {
  const response = await fetch(`${AUTH_API_BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authLifecycleState.token}`,
    },
    body: JSON.stringify(body || {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) {
    throw new Error(payload.detail || payload.error || 'Authentication request failed.');
  }
  return payload;
}

async function handleLogin(event) {
  event.preventDefault();

  const emailInput = document.getElementById('loginEmail').value.trim().toLowerCase();
  const passInput = document.getElementById('loginPassword').value.trim();
  const rememberMe = document.getElementById('rememberMe').checked;

  hideLoginError();
  setMainLoginButtonState(true, 'Authenticating...');

  try {
    const response = await fetch(`${AUTH_API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailInput, password: passInput }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
      throw new Error(payload.detail || payload.error || 'Incorrect email or password. Please try again.');
    }

    authLifecycleState.user = { ...(payload.data.user || {}) };
    authLifecycleState.token = payload.data.token || '';
    authLifecycleState.rememberMe = rememberMe;
    authLifecycleState.requiresPasswordChange = Boolean(payload.data.requiresPasswordChange);
    authLifecycleState.requiresOtp = Boolean(payload.data.requiresOtp);

    if (authLifecycleState.requiresPasswordChange) {
      setMainLoginButtonState(false, 'Sign In');
      setModalMessage('passwordChangeError', '', 'error');
      document.getElementById('currentPassword').value = passInput;
      document.getElementById('newPassword').value = '';
      document.getElementById('confirmNewPassword').value = '';
      openModalById('passwordChangeModal');
      return;
    }

    if (authLifecycleState.requiresOtp) {
      setMainLoginButtonState(false, 'Sign In');
      try {
        const otpPayload = await authFetch('/auth/request-otp', 'POST', {});
        beginOtpFlow(otpPayload.data || {});
      } catch (otpErr) {
        resetAuthLifecycleState();
        showLoginError(otpErr.message || 'Unable to request OTP right now.');
      }
      return;
    }

    saveAuthenticatedSessionAndRedirect();
  } catch (err) {
    const isNetworkError = err instanceof TypeError || (err && err.message && err.message.includes('Failed to fetch'));
    if (DEMO_MODE && isNetworkError) {
      if (passInput !== 'test') {
        showLoginError("Demo mode: password must be 'test'");
        return;
      }

      const mockUser = {
        email: emailInput,
        name: 'Demo User',
        role: 'System Admin',
        permissions: (typeof roleTemplates !== 'undefined' && roleTemplates['System Admin']) ? roleTemplates['System Admin'] : {},
      };
      sessionStorage.setItem('activeUser', JSON.stringify(mockUser));
      window.location.href = 'index.html';
      return;
    }

    resetAuthLifecycleState();
    showLoginError(err.message || 'Unable to sign in right now.');
  } finally {
    setMainLoginButtonState(false, 'Sign In');
  }
}

async function submitForcedPasswordChange(event) {
  event.preventDefault();
  const currentPassword = document.getElementById('currentPassword').value.trim();
  const newPassword = document.getElementById('newPassword').value.trim();
  const confirmNewPassword = document.getElementById('confirmNewPassword').value.trim();
  const btn = document.getElementById('passwordChangeBtn');

  if (!newPassword || newPassword.length < 8) {
    setModalMessage('passwordChangeError', 'New password must be at least 8 characters.', 'error');
    return;
  }
  if (newPassword !== confirmNewPassword) {
    setModalMessage('passwordChangeError', 'New password and confirmation do not match.', 'error');
    return;
  }

  btn.disabled = true;
  btn.style.opacity = '0.8';
  btn.textContent = 'Updating...';
  setModalMessage('passwordChangeError', '', 'error');

  try {
    const payload = await authFetch('/auth/change-password', 'POST', {
      current_password: currentPassword,
      new_password: newPassword,
    });
    authLifecycleState.requiresPasswordChange = false;
    beginOtpFlow((payload && payload.data) || {});
  } catch (err) {
    setModalMessage('passwordChangeError', err.message || 'Unable to change password.', 'error');
  } finally {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.textContent = 'Change Password';
  }
}

async function resendOtpCode() {
  const resendBtn = document.getElementById('resendOtpBtn');
  if (!authLifecycleState.token || !resendBtn) return;

  if (Date.now() < authLifecycleState.otpResendCooldownUntil) {
    updateOtpResendButtonCooldown();
    return;
  }

  resendBtn.disabled = true;
  resendBtn.textContent = 'Resending...';
  try {
    const payload = await authFetch('/auth/request-otp', 'POST', {});
    beginOtpFlow((payload && payload.data) || {});
  } catch (err) {
    setModalMessage('otpMessage', err.message || 'Unable to resend OTP now.', 'error');
  } finally {
    resendBtn.disabled = false;
    resendBtn.textContent = 'Resend Code';
  }
}

async function submitOtpVerification(event) {
  event.preventDefault();
  const otpCode = document.getElementById('otpCode').value.trim();
  const btn = document.getElementById('verifyOtpBtn');

  if (!otpCode) {
    setModalMessage('otpMessage', 'Enter the OTP code to continue.', 'error');
    return;
  }

  btn.disabled = true;
  btn.style.opacity = '0.8';
  btn.textContent = 'Verifying...';
  setModalMessage('otpMessage', '', 'info');

  try {
    await authFetch('/auth/verify-otp', 'POST', { otp_code: otpCode });
    closeModalById('otpModal');
    saveAuthenticatedSessionAndRedirect();
  } catch (err) {
    setModalMessage('otpMessage', err.message || 'OTP verification failed.', 'error');
  } finally {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.textContent = 'Verify & Continue';
  }
}

function openForgotPasswordModal(event) {
  if (event && typeof event.preventDefault === 'function') {
    event.preventDefault();
  }

  const loginEmail = (document.getElementById('loginEmail')?.value || '').trim();
  const resetEmailEl = document.getElementById('resetEmail');
  if (resetEmailEl) resetEmailEl.value = loginEmail;
  setModalMessage('forgotPasswordRequestMessage', '', 'info');
  openModalById('forgotPasswordRequestModal');
}

function closeForgotPasswordRequestModal() {
  closeModalById('forgotPasswordRequestModal');
}

function closeForgotPasswordConfirmModal() {
  closeModalById('forgotPasswordConfirmModal');
}

async function submitForgotPasswordRequest(event) {
  event.preventDefault();
  const email = (document.getElementById('resetEmail')?.value || '').trim().toLowerCase();
  if (!email) {
    setModalMessage('forgotPasswordRequestMessage', 'Enter your account email.', 'error');
    return;
  }

  applyModalBusyState('forgotPasswordRequestBtn', true, 'Sending...', 'Send Reset Token');
  setModalMessage('forgotPasswordRequestMessage', '', 'info');

  try {
    const response = await fetch(`${AUTH_API_BASE_URL}/auth/forgot-password/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
      throw new Error(payload.detail || payload.error || 'Unable to process password reset request.');
    }

    setModalMessage('forgotPasswordRequestMessage', payload.data?.message || 'If the account exists, a reset token has been sent.', 'info');
    const confirmEmailEl = document.getElementById('resetConfirmEmail');
    if (confirmEmailEl) confirmEmailEl.value = email;

    setTimeout(() => {
      closeForgotPasswordRequestModal();
      setModalMessage('forgotPasswordConfirmMessage', '', 'info');
      openModalById('forgotPasswordConfirmModal');
    }, 400);
  } catch (err) {
    setModalMessage('forgotPasswordRequestMessage', err.message || 'Unable to process password reset request.', 'error');
  } finally {
    applyModalBusyState('forgotPasswordRequestBtn', false, 'Sending...', 'Send Reset Token');
  }
}

async function submitForgotPasswordConfirm(event) {
  event.preventDefault();

  const email = (document.getElementById('resetConfirmEmail')?.value || '').trim().toLowerCase();
  const resetToken = (document.getElementById('resetToken')?.value || '').trim();
  const newPassword = (document.getElementById('resetNewPassword')?.value || '').trim();
  const confirmNewPassword = (document.getElementById('resetConfirmNewPassword')?.value || '').trim();

  if (!email || !resetToken || !newPassword || !confirmNewPassword) {
    setModalMessage('forgotPasswordConfirmMessage', 'All fields are required.', 'error');
    return;
  }
  if (newPassword.length < 8) {
    setModalMessage('forgotPasswordConfirmMessage', 'New password must be at least 8 characters.', 'error');
    return;
  }
  if (newPassword !== confirmNewPassword) {
    setModalMessage('forgotPasswordConfirmMessage', 'New password and confirmation do not match.', 'error');
    return;
  }

  applyModalBusyState('forgotPasswordConfirmBtn', true, 'Resetting...', 'Reset Password');
  setModalMessage('forgotPasswordConfirmMessage', '', 'info');

  try {
    const response = await fetch(`${AUTH_API_BASE_URL}/auth/forgot-password/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        reset_token: resetToken,
        new_password: newPassword,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
      throw new Error(payload.detail || payload.error || 'Unable to reset password.');
    }

    setModalMessage('forgotPasswordConfirmMessage', 'Password reset successful. You can now sign in.', 'info');
    const loginEmail = document.getElementById('loginEmail');
    if (loginEmail) loginEmail.value = email;

    setTimeout(() => {
      closeForgotPasswordConfirmModal();
      const loginPassword = document.getElementById('loginPassword');
      if (loginPassword) loginPassword.focus();
    }, 600);
  } catch (err) {
    setModalMessage('forgotPasswordConfirmMessage', err.message || 'Unable to reset password.', 'error');
  } finally {
    applyModalBusyState('forgotPasswordConfirmBtn', false, 'Resetting...', 'Reset Password');
  }
}

function togglePasswordVisibility() {
  const input = document.getElementById('loginPassword');
  const eyeIcon = document.getElementById('eyeIcon');
  if (!input || !eyeIcon) return;
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  eyeIcon.innerHTML = isPassword
    ? '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.77 21.77 0 0 1 5.17-6.75"/><path d="M1 1l22 22"/><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M14.12 14.12 9.88 9.88"/>'
    : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
}

window.handleLogin = handleLogin;
window.submitForcedPasswordChange = submitForcedPasswordChange;
window.submitOtpVerification = submitOtpVerification;
window.resendOtpCode = resendOtpCode;
window.togglePasswordVisibility = togglePasswordVisibility;
window.openForgotPasswordModal = openForgotPasswordModal;
window.closeForgotPasswordRequestModal = closeForgotPasswordRequestModal;
window.closeForgotPasswordConfirmModal = closeForgotPasswordConfirmModal;
window.submitForgotPasswordRequest = submitForgotPasswordRequest;
window.submitForgotPasswordConfirm = submitForgotPasswordConfirm;

// LOGOUT FUNCTION: Clear session and redirect to login
// Called by "Log Out" button in profile menu
function logout() {
  sessionStorage.removeItem('activeUser'); 
  sessionStorage.removeItem('wardflow_last_activity_ts');
  sessionStorage.removeItem('wardflow_access_token');
  window.location.href = 'login.html';
}

startSessionTimeoutGuard();
window.logout = logout;