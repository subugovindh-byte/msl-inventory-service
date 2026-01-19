// User & Role Management UI for admins
import { fetchExpectOk } from './utils.js';

function getToken() { return localStorage.getItem('jwt_token'); }
function apiHeaders() { return { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'application/json' }; }

window.addEventListener('DOMContentLoaded', () => {
  // DOM lookups
  const usersTable = document.getElementById('users-table')?.querySelector('tbody');
  const rolesTable = document.getElementById('roles-table')?.querySelector('tbody');
  const addUserBtn = document.getElementById('add-user-btn') || null;
  const addRoleBtn = document.getElementById('add-role-btn') || null;
  const modal = document.getElementById('modal') || null;
  const modalContent = document.getElementById('modal-content') || null;
  const backBtn = document.getElementById('back-btn') || null;
  const loginModal = document.getElementById('login-modal') || null;
  const loginContent = document.getElementById('login-content') || null;
  const loginScreen = document.getElementById('login-screen') || null;
  const loginForm = document.getElementById('login-form') || null;
  const loginError = document.getElementById('login-error') || null;
  const userInfo = document.getElementById('user-info') || null;
  const logoutBtn = document.getElementById('logout-btn') || null;

  async function loadUsers() {
    try {
      const users = await fetchExpectOk('/api/users', { headers: apiHeaders() });
      usersTable.innerHTML = '';
      users.forEach(u => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${u.id}</td><td>${u.username}</td><td>${u.display_name||''}</td><td>${u.email||''}</td><td>${u.role||''}</td><td>${u.is_active?'Active':'Inactive'}</td><td><button data-id="${u.id}" class="edit-user">Edit</button></td>`;
        usersTable.appendChild(tr);
      });
    } catch (err) {
      if (err.message && err.message.includes('401')) {
        showLoginModal();
      } else {
        alert('Failed to load users: ' + err.message);
      }
    }
  }

  async function loadRoles() {
    try {
      const roles = await fetchExpectOk('/api/admin/roles', { headers: apiHeaders() });
      rolesTable.innerHTML = '';
      roles.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${r.id}</td><td>${r.name}</td><td><button data-id="${r.id}" class="edit-role">Edit</button></td>`;
        rolesTable.appendChild(tr);
      });
    } catch (err) {
      if (err.message && err.message.includes('401')) {
        showLoginModal();
      } else {
        alert('Failed to load roles: ' + err.message);
      }
    }
  }

  // Populate a <select> with available roles
  async function fillRoleSelect(selectId, selectedId) {
    try {
      const roles = await fetchExpectOk('/api/admin/roles', { headers: apiHeaders() });
      const select = document.getElementById(selectId);
      if (!select) return;
      select.innerHTML = '';
      roles.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = r.name;
        if (selectedId && String(r.id) === String(selectedId)) opt.selected = true;
        select.appendChild(opt);
      });
    } catch (err) {
      // Optionally show error in UI
    }
  }

  async function getCurrentUserRole() {
    try {
      const res = await fetch('/api/users/me', { headers: apiHeaders() });
      if (!res.ok) return null;
      const user = await res.json();
      return user.role;
    } catch {
      return null;
    }
  }

  async function getPoliciesForRole(role) {
    try {
      const res = await fetch('/api/admin/policies', { headers: apiHeaders() });
      if (!res.ok) return [];
      const policies = await res.json();
      return policies.filter(p => p.role === role);
    } catch {
      return [];
    }
  }

  async function updateUIForPolicies() {
    const role = await getCurrentUserRole();
    const policies = await getPoliciesForRole(role);
    // Only show Add User/Role if policy allows 'manage' for users/roles
    const canManageUsers = policies.some(p => p.resource === 'users' && p.action === 'manage');
    const canManageRoles = policies.some(p => p.resource === 'roles' && p.action === 'manage');
    addUserBtn.style.display = canManageUsers ? '' : 'none';
    addRoleBtn.style.display = canManageRoles ? '' : 'none';
  }

  function showModal(html) {
    modalContent.innerHTML = html;
    modal.hidden = false;
  }
  function hideModal() { modal.hidden = true; }

  function showLoginModal() {
    loginContent.innerHTML = `<h3>Login Required</h3>
      <form id="login-form">
        <label>Username <input name="username" required></label><br>
        <label>Password <input name="password" type="password" required></label><br>
        <button type="submit">Login</button>
        <div id="login-error" style="color:red;"></div>
      </form>`;
    loginModal.hidden = false;
    // Hide main UI and header while login modal is shown
    const main = document.querySelector('main');
    const header = document.querySelector('header');
    if (main) main.style.display = 'none';
    if (header) header.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'none';
    document.getElementById('login-form').onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target;
      const data = Object.fromEntries(new FormData(form));
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error('Login failed');
        const j = await res.json();
        localStorage.setItem('jwt_token', j.token);
        loginModal.hidden = true;
        // Show main UI and header after login
        if (main) main.style.display = '';
        if (header) header.style.display = '';
        if (logoutBtn) logoutBtn.style.display = '';
        // Reload the page after login for clean state and UX
        window.location.reload();
      } catch (err) {
        document.getElementById('login-error').textContent = err.message;
      }
    };
  }

  // --- Inline Add User Form ---
  function renderAddUserInline() {
    const formRow = document.createElement('tr');
    formRow.innerHTML = `
      <td></td>
      <td><input name="username" required placeholder="Username"></td>
      <td><input name="display_name" placeholder="Display Name"></td>
      <td><input name="email" type="email" placeholder="Email"></td>
      <td><select name="role_id" id="inline-role-select"></select></td>
      <td></td>
      <td>
        <button id="inline-user-save">Save</button>
        <button id="inline-user-cancel">Cancel</button>
        <span id="inline-user-error" style="color:red;"></span>
      </td>`;
    usersTable.prepend(formRow);
    fillRoleSelect('inline-role-select');
    document.getElementById('inline-user-cancel').onclick = () => { formRow.remove(); };
    document.getElementById('inline-user-save').onclick = async () => {
      const data = {
        username: formRow.querySelector('[name=username]').value,
        display_name: formRow.querySelector('[name=display_name]').value,
        email: formRow.querySelector('[name=email]').value,
        role_id: formRow.querySelector('[name=role_id]').value,
        password: 'changeme' // Default password, should prompt in real app
      };
      try {
        await fetchExpectOk('/api/admin/users', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(data) });
        formRow.remove();
        loadUsers();
      } catch (err) {
        document.getElementById('inline-user-error').textContent = err.message;
      }
    };
  }
  if (addUserBtn) addUserBtn.onclick = renderAddUserInline;

  // --- Inline Add Role Form ---
  function renderAddRoleInline() {
    const formRow = document.createElement('tr');
    formRow.innerHTML = `
      <td></td>
      <td><input name="name" required placeholder="Role Name"></td>
      <td>
        <button id="inline-role-save">Save</button>
        <button id="inline-role-cancel">Cancel</button>
        <span id="inline-role-error" style="color:red;"></span>
      </td>`;
    rolesTable.prepend(formRow);
    document.getElementById('inline-role-cancel').onclick = () => { formRow.remove(); };
    document.getElementById('inline-role-save').onclick = async () => {
      const data = { name: formRow.querySelector('[name=name]').value };
      try {
        await fetchExpectOk('/api/admin/roles', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(data) });
        formRow.remove();
        loadRoles();
      } catch (err) {
        document.getElementById('inline-role-error').textContent = err.message;
      }
    };
  }
  if (addRoleBtn) addRoleBtn.onclick = renderAddRoleInline;

  // Edit User Handler
  if (usersTable) usersTable.onclick = async (e) => {
    const btn = e.target.closest('button.edit-user');
    if (!btn) return;
    const userId = btn.getAttribute('data-id');
    try {
      const user = await fetchExpectOk(`/api/users`, { headers: apiHeaders() });
      const u = user.find(u => String(u.id) === String(userId));
      if (!u) return alert('User not found');

      // --- Modal Overlay Popup ---
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');

      const modal = document.createElement('div');
      modal.className = 'modal';
      overlay.appendChild(modal);

      const header = document.createElement('div');
      header.className = 'modal-header';
      const title = document.createElement('div');
      title.style.fontWeight = '700';
      title.textContent = 'Edit User';
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'modal-close';
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.textContent = '✕';
      header.appendChild(title);
      header.appendChild(closeBtn);
      modal.appendChild(header);

      const body = document.createElement('div');
      body.className = 'modal-body';
      modal.appendChild(body);

      const form = document.createElement('form');
      form.id = 'edit-user-form';
      form.innerHTML = `
        <div class="form-row"><label>Username <input name="username" value="${u.username}" required></label></div>
        <div class="form-row"><label>Display Name <input name="display_name" value="${u.display_name||''}"></label></div>
        <div class="form-row"><label>Email <input name="email" type="email" value="${u.email||''}"></label></div>
        <div class="form-row"><label>Role <select name="role_id" id="edit-role-select"></select></label></div>
        <div class="form-row"><label>Status <select name="is_active"><option value="1"${u.is_active?' selected':''}>Active</option><option value="0"${!u.is_active?' selected':''}>Inactive</option></select></label></div>
        <div class="form-row gx-span-2"><button type="submit">Save</button> <button type="button" id="cancel-btn">Cancel</button></div>
        <div class="form-row gx-span-2"><div id="form-error" style="color:red;"></div></div>
      `;
      form.className = 'edit-form gx-edit-form';
      body.appendChild(form);
      document.body.appendChild(overlay);
      await fillRoleSelect('edit-role-select', u.role_id);

      // Dirty tracking
      let dirty = false;
      form.addEventListener('input', () => { dirty = true; });

      // Close logic with unsaved changes
      const close = () => { document.body.removeChild(overlay); };
      const guardedClose = () => {
        if (form.querySelector('button[type="submit"]').disabled) return;
        if (dirty) {
          if (!confirm('You have unsaved changes. Discard?')) return;
        }
        close();
      };
      closeBtn.onclick = guardedClose;
      overlay.addEventListener('click', (e) => { if (e.target === overlay) guardedClose(); });
      document.addEventListener('keydown', function escListener(ev) {
        if (ev.key === 'Escape') { ev.preventDefault(); guardedClose(); document.removeEventListener('keydown', escListener); }
      });
      document.getElementById('cancel-btn').onclick = guardedClose;

      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const saveBtn = form.querySelector('button[type="submit"]');
        const cancelBtn = form.querySelector('#cancel-btn');
        saveBtn.disabled = true;
        cancelBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        const data = Object.fromEntries(new FormData(form));
        data.is_active = Number(data.is_active);
        try {
          await fetchExpectOk(`/api/admin/users/${userId}`, { method: 'PUT', headers: apiHeaders(), body: JSON.stringify(data) });
          close();
          loadUsers();
        } catch (err) {
          form.querySelector('#form-error').textContent = err.message;
          saveBtn.disabled = false;
          cancelBtn.disabled = false;
          saveBtn.textContent = 'Save';
        }
      };
    } catch (err) {
      alert('Failed to load user: ' + err.message);
    }
  };

  // Edit Role Handler
  if (rolesTable) rolesTable.onclick = async (e) => {
    const btn = e.target.closest('button.edit-role');
    if (!btn) return;
    const roleId = btn.getAttribute('data-id');
    try {
      const roles = await fetchExpectOk('/api/admin/roles', { headers: apiHeaders() });
      const r = roles.find(r => String(r.id) === String(roleId));
      if (!r) return alert('Role not found');

      // --- Modal Overlay Popup ---
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');

      const modal = document.createElement('div');
      modal.className = 'modal';
      overlay.appendChild(modal);

      const header = document.createElement('div');
      header.className = 'modal-header';
      const title = document.createElement('div');
      title.style.fontWeight = '700';
      title.textContent = 'Edit Role';
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'modal-close';
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.textContent = '✕';
      header.appendChild(title);
      header.appendChild(closeBtn);
      modal.appendChild(header);

      const body = document.createElement('div');
      body.className = 'modal-body';
      modal.appendChild(body);

      const form = document.createElement('form');
      form.id = 'edit-role-form';
      form.innerHTML = `
        <div class="form-row"><label>Name <input name="name" value="${r.name}" required></label></div>
        <div class="form-row gx-span-2"><button type="submit">Save</button> <button type="button" id="cancel-btn">Cancel</button></div>
        <div class="form-row gx-span-2"><div id="form-error" style="color:red;"></div></div>
      `;
      form.className = 'edit-form gx-edit-form';
      body.appendChild(form);
      document.body.appendChild(overlay);

      // Dirty tracking
      let dirty = false;
      form.addEventListener('input', () => { dirty = true; });

      // Close logic with unsaved changes
      const close = () => { document.body.removeChild(overlay); };
      const guardedClose = () => {
        if (form.querySelector('button[type="submit"]').disabled) return;
        if (dirty) {
          if (!confirm('You have unsaved changes. Discard?')) return;
        }
        close();
      };
      closeBtn.onclick = guardedClose;
      overlay.addEventListener('click', (e) => { if (e.target === overlay) guardedClose(); });
      document.addEventListener('keydown', function escListener(ev) {
        if (ev.key === 'Escape') { ev.preventDefault(); guardedClose(); document.removeEventListener('keydown', escListener); }
      });
      document.getElementById('cancel-btn').onclick = guardedClose;

      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const saveBtn = form.querySelector('button[type="submit"]');
        const cancelBtn = form.querySelector('#cancel-btn');
        saveBtn.disabled = true;
        cancelBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        const data = Object.fromEntries(new FormData(form));
        try {
          await fetchExpectOk(`/api/admin/roles/${roleId}`, { method: 'PUT', headers: apiHeaders(), body: JSON.stringify(data) });
          close();
          loadRoles();
        } catch (err) {
          form.querySelector('#form-error').textContent = err.message;
          saveBtn.disabled = false;
          cancelBtn.disabled = false;
          saveBtn.textContent = 'Save';
        }
      };
    } catch (err) {
      alert('Failed to load role: ' + err.message);
    }
  };

  // Attach logout handler
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      localStorage.removeItem('jwt_token');
      window.location.reload();
    };
  }

  // Modal click to close
  if (loginModal) loginModal.onclick = (e) => { if (e.target === loginModal) loginModal.hidden = true; };

  // Show login modal or main UI based on token
  if (!getToken()) {
    // Hide main UI and header if not already hidden
    const main = document.querySelector('main');
    const header = document.querySelector('header');
    if (main) main.style.display = 'none';
    if (header) header.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'none';
    showLoginModal();
  } else {
    // If token exists, show logout button and load users/roles
    if (logoutBtn) logoutBtn.style.display = '';
    const main = document.querySelector('main');
    const header = document.querySelector('header');
    if (main) main.style.display = '';
    if (header) header.style.display = '';
    loadUsers();
    loadRoles();
    updateUIForPolicies();
  }
});
