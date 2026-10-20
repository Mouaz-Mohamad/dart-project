// DART CODE GUIDE | Eye/dart-staff.js
// الغرض: منطق Dart Eye Dashboard؛ يعرض/يدير البيانات عبر الـAPI مع احترام صلاحيات الموظف.
// DART EYE | MODULE: dart-staff.js
// Owner-managed Staff allowlist, permissions, status, and session revocation UI.
// BEGIN MODULE

(function () {
  "use strict";

  const card = document.getElementById("settings-staff-access-card");
  const staffTab = document.getElementById("settings-tab-staff");
  const form = document.getElementById("settings-staff-invite-form");
  const emailInput = document.getElementById("settings-staff-email");
  const roleSelect = document.getElementById("settings-staff-role");
  const permissionsWrap = document.getElementById("settings-staff-permissions-wrap");
  const invitePermissions = document.getElementById("settings-staff-invite-permissions");
  const staffList = document.getElementById("settings-staff-list");
  const invitationsList = document.getElementById("settings-staff-invitations");
  const statusNode = document.getElementById("settings-staff-status");

  if (
    !card ||
    !form ||
    !emailInput ||
    !roleSelect ||
    !permissionsWrap ||
    !invitePermissions ||
    !staffList ||
    !invitationsList ||
    !statusNode
  ) {
    return;
  }

  let directory = {
    permissions: [],
    invitations: [],
    staff: [],
  };
  let selectedStaffId=null;
  let directoryRevision=0;
  const permissionDrafts=new Map(),pendingMembers=new Set();

  const protectedBasics = new Set([
    "profile.read_own",
    "profile.update_own",
    "sessions.read_own",
    "sessions.revoke_own",
  ]);

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function can(permission) {
    return window.DartAdminAccess?.can?.(permission) === true;
  }

  function setStatus(message, error = false) {
    statusNode.textContent = message || "";
    statusNode.classList.toggle("is-error", Boolean(error));
    statusNode.hidden = !message;
  }

  function displayDate(value) {
    if (!value) return "Never";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
  }

  function permissionGroup(key) {
    return String(key || "").split(".")[0] || "other";
  }

  function permissionLabel(permission, selected = new Set()) {
    const checked =
      selected.has(permission.key) || protectedBasics.has(permission.key);
    return `
      <label class="dart-staff-permission">
        <input
          type="checkbox"
          value="${esc(permission.key)}"
          ${checked ? "checked" : ""}
          ${protectedBasics.has(permission.key) || !can('staff.manage') ? "disabled" : ""}
        >
        <span>
          <strong>${esc(permission.key)}</strong>
          <small>${esc(permission.description || "")}</small>
        </span>
      </label>`;
  }

  function groupedPermissions(selected=new Set()) {
    const groups = new Map();
    directory.permissions.forEach((permission) => {
      const group = permissionGroup(permission.key);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(permission);
    });

    return [...groups.entries()]
      .map(
        ([group, permissions]) => `
          <details class="dart-staff-permission-group">
            <summary>${esc(group)} <small>${permissions.filter(permission=>selected.has(permission.key)||protectedBasics.has(permission.key)).length} / ${permissions.length}</small></summary>
            <div class="dart-staff-permission-options">${permissions.map((permission) => permissionLabel(permission,selected)).join("")}</div>
          </details>`,
      )
      .join("");
  }
  function renderInvitePermissions(){
    const selected=new Set([...invitePermissions.querySelectorAll('input:checked')].map(input=>input.value));
    invitePermissions.innerHTML=groupedPermissions(selected);
  }

  function syncRoleUi() {
    const owner = roleSelect.value === "owner";
    permissionsWrap.hidden = owner;
    invitePermissions
      .querySelectorAll('input[type="checkbox"]')
      .forEach((input) => {
        input.disabled = owner || protectedBasics.has(input.value) || !can('staff.manage');
      });
  }

  function staffPermissionEditor(member) {
    if (member.isOwner) {
      return `
        <div class="dart-staff-protected">
          <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
          Owner access and permissions are protected.
        </div>`;
    }
    const selected = permissionDrafts.get(String(member.id)) || new Set(member.permissions || []);
    return `
      <div class="dart-staff-member-permissions" data-staff-permissions>
        ${groupedPermissions(selected)}
        ${can("staff.manage")
          ? '<button type="button" class="dart-settings-save" data-staff-action="permissions">Save permissions</button>'
          : ""}
      </div>`;
  }

  function staffActions(member) {
    if (!can("staff.manage") || member.isOwner) return "";
    const active = member.status === "Active";
    return `
      <div class="dart-staff-actions">
        <button type="button" class="dart-settings-secondary" data-staff-action="toggle-access">
          ${active ? "Disable access" : "Activate access"}
        </button>
        <button type="button" class="dart-settings-secondary" data-staff-action="revoke-sessions">
          Revoke all sessions
        </button>
      </div>`;
  }

  function renderStaff() {
    if (!directory.staff.length) {
      staffList.innerHTML =
        '<div class="dart-empty-state">No dashboard accounts yet.</div>';
      return;
    }

    const query=String(document.getElementById('settings-staff-search')?.value||'').trim().toLowerCase();
    const members=directory.staff.filter(member=>[member.name,member.email,member.staffCode].some(value=>String(value||'').toLowerCase().includes(query)));
    if(!members.length){staffList.innerHTML='<div class="dart-empty-state">No accounts match this search.</div>';return;}
    staffList.innerHTML = `<p class="dart-staff-selection-hint">${selectedStaffId?'Only the selected account is open.':'Choose an account to view its details and permissions.'}</p>`+members
      .map((member) => `
        <article
          class="dart-settings-list-row dart-staff-member"
          data-staff-id="${esc(member.id)}"
          data-staff-active="${member.status === "Active" ? "true" : "false"}"
          data-staff-owner="${member.isOwner ? "true" : "false"}"
        >
          <header class="dart-staff-member-head">
            <div>
              <strong>${esc(member.name || member.email)}</strong><small>${esc(member.email)}</small>
              <small>${esc(member.staffCode || "")} · ${member.isOwner ? "Owner" : "Staff"}</small>
            </div>
            <div class="dart-staff-badges">
              <span>${esc(member.status)}</span>
              <span>${member.emailVerified ? "Email verified" : "Email pending"}</span>
            </div>
            <button type="button" class="dart-settings-secondary" data-staff-action="view" aria-expanded="${String(selectedStaffId)===String(member.id)}">${String(selectedStaffId)===String(member.id)?'Close details':'Details'}</button>
          </header>
          ${String(selectedStaffId)===String(member.id)?`<div class="dart-staff-member-body">
            <h3>${esc(member.email)} · ${esc(member.staffCode || '')}</h3>
            <p>Role: <strong>${member.isOwner ? "Owner" : "Staff"}</strong></p>
            <p>Last login: <strong>${esc(displayDate(member.lastLoginAt))}</strong></p>
            ${member.disabledReason
              ? `<p>Disabled reason: <strong>${esc(member.disabledReason)}</strong></p>`
              : ""}
            ${staffActions(member)}
            ${staffPermissionEditor(member)}
          </div>`:''}
        </article>`,
      )
      .join("");
    staffList.querySelectorAll('[data-staff-id]').forEach(row=>{const pending=pendingMembers.has(row.dataset.staffId);row.setAttribute('aria-busy',String(pending));if(pending)row.querySelectorAll('input,button:not([data-staff-action="view"])').forEach(node=>{node.disabled=true;});});
  }

  function renderAllowances() {
    const pending = directory.invitations.filter(
      (entry) =>
        entry.accessMode === "email_otp" &&
        entry.status === "pending",
    );
    if (!pending.length) {
      invitationsList.innerHTML =
        '<div class="dart-empty-state">No emails waiting for verification.</div>';
      return;
    }

    invitationsList.innerHTML = pending
      .map((entry) => `
        <div class="dart-settings-list-row" data-allowance-id="${esc(entry.id)}">
          <div>
            <strong>${esc(entry.email)}</strong>
            <small>${entry.role === "owner" ? "Owner" : "Staff"} · waiting for first email verification</small>
          </div>
          ${can("staff.manage") && entry.role !== "owner"
            ? '<button type="button" class="dart-settings-secondary" data-remove-allowance>Remove</button>'
            : '<span>Protected</span>'}
        </div>`)
      .join("");
  }

  async function load(preserveStatus=false) {
    const revision=++directoryRevision;
    if (!can("staff.read") || !window.DartAdminApi?.request) {
      card.hidden = true;
      if (staffTab) staffTab.hidden = true;
      window.DartSettingsTabs?.refresh?.();
      return;
    }
    card.hidden = false;
    if (staffTab) staffTab.hidden = false;
    window.DartSettingsTabs?.refresh?.();
    if(preserveStatus!==true)setStatus('Loading Staff accounts…');
    try {
      const response = await window.DartAdminApi.request("/api/v1/admin/staff");
      if(revision!==directoryRevision||!can('staff.read'))return;
      directory = response;
      renderInvitePermissions();
      syncRoleUi();
      renderStaff();
      renderAllowances();
      if(preserveStatus!==true)setStatus("");
    } catch (error) {
      if(revision!==directoryRevision||!can('staff.read'))return;
      setStatus(error.message || "Unable to load Staff access.", true);
    }
  }

  roleSelect.addEventListener("change", syncRoleUi);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if(form.dataset.saving==='true')return;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    if (!can("staff.manage")) {
      setStatus("You do not have permission to manage Staff.", true);
      return;
    }

    const role = roleSelect.value === "owner" ? "owner" : "staff";
    const selected =
      role === "owner"
        ? []
        : [
            ...invitePermissions.querySelectorAll(
              'input[type="checkbox"]:checked:not(:disabled)',
            ),
          ].map((input) => input.value);
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    form.dataset.saving='true';form.setAttribute('aria-busy','true');

    try {
      await window.DartAdminApi.request("/api/v1/admin/staff/allowlist", {
        method: "POST",
        body: {
          email: emailInput.value.trim(),
          role,
          permissionKeys: selected,
        },
      });
      form.reset();
      roleSelect.value = "staff";
      syncRoleUi();
      setStatus(
        "Email allowed. The account will activate after the owner of that email enters the verification code.",
      );
      document.getElementById('settings-staff-add').open=false;
      await load(true);
    } catch (error) {
      setStatus(error.message || "Unable to allow dashboard access.", true);
    } finally {
      submit.disabled = false;
      delete form.dataset.saving;form.setAttribute('aria-busy','false');
    }
  });

  invitationsList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-remove-allowance]");
    if (!button) return;
    const row = button.closest("[data-allowance-id]");
    const allowanceId = row?.dataset.allowanceId;
    if (!allowanceId || !can("staff.manage")) return;

    button.disabled = true;
    try {
      await window.DartAdminApi.request(
        `/api/v1/admin/staff/allowlist/${encodeURIComponent(allowanceId)}`,
        {
          method: "DELETE",
          body: { reason: "removed_by_owner" },
        },
      );
      setStatus("Pending email access removed.");
      await load(true);
    } catch (error) {
      setStatus(error.message || "Unable to remove Staff access.", true);
      button.disabled = false;
    }
  });

  staffList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-staff-action]");
    if (!button) return;

    const memberRow = button.closest("[data-staff-id]");
    const staffId = memberRow?.dataset.staffId;
    if(button.dataset.staffAction==='view'){selectedStaffId=String(selectedStaffId)===String(staffId)?null:staffId;renderStaff();return;}
    if(!can('staff.manage')||pendingMembers.has(staffId))return;
    const isOwner = memberRow?.dataset.staffOwner === "true";
    if (!staffId || isOwner) return;

    const action = button.dataset.staffAction;
    button.disabled = true;
    pendingMembers.add(staffId);memberRow.setAttribute('aria-busy','true');
    memberRow.querySelectorAll('input,button:not([data-staff-action="view"])').forEach(node=>{node.disabled=true;});
    try {
      if (action === "permissions") {
        const container = memberRow.querySelector("[data-staff-permissions]");
        const selected = [
          ...container.querySelectorAll('input[type="checkbox"]:checked'),
        ].map((input) => input.value);
        await window.DartAdminApi.request(
          `/api/v1/admin/staff/${encodeURIComponent(staffId)}/permissions`,
          {
            method: "PUT",
            body: { permissionKeys: selected },
          },
        );
        permissionDrafts.delete(staffId);
        setStatus(
          "Staff permissions updated. Existing sessions were revoked so the new permissions take effect.",
        );
      } else if (action === "toggle-access") {
        const active = memberRow.dataset.staffActive === "true";
        const reason = active
          ? await window.DartDialog.prompt("Reason for disabling this employee:", "disabled_by_owner")
          : "reactivated_by_owner";
        if (active && reason === null) return;
        await window.DartAdminApi.request(
          `/api/v1/admin/staff/${encodeURIComponent(staffId)}/access`,
          {
            method: "PATCH",
            body: {
              active: !active,
              reason: String(reason || "").trim(),
            },
          },
        );
        setStatus(
          active
            ? "Staff access disabled and active sessions revoked."
            : "Staff access activated.",
        );
      } else if (action === "revoke-sessions") {
        await window.DartAdminApi.request(
          `/api/v1/admin/staff/${encodeURIComponent(staffId)}/sessions/revoke`,
          { method: "POST" },
        );
        setStatus("All sessions for this Staff account were revoked.");
      }
      await load(true);
    } catch (error) {
      setStatus(error.message || "Unable to update Staff access.", true);
    } finally {
      button.disabled = false;
      pendingMembers.delete(staffId);renderStaff();
    }
  });
  staffList.addEventListener('change',event=>{if(!event.target.matches('[data-staff-permissions] input'))return;const row=event.target.closest('[data-staff-id]');permissionDrafts.set(row.dataset.staffId,new Set([...row.querySelectorAll('[data-staff-permissions] input:checked')].map(input=>input.value)));const group=event.target.closest('.dart-staff-permission-group');if(group)group.querySelector('summary small').textContent=`${group.querySelectorAll('input:checked').length} / ${group.querySelectorAll('input').length}`;});
  document.getElementById('settings-staff-search')?.addEventListener('input',renderStaff);
  card.querySelectorAll('[data-staff-directory]').forEach(button=>button.addEventListener('click',()=>{card.querySelectorAll('[data-staff-directory]').forEach(node=>node.setAttribute('aria-pressed',String(node===button)));card.querySelectorAll('[data-staff-directory-panel]').forEach(panel=>{panel.hidden=panel.dataset.staffDirectoryPanel!==button.dataset.staffDirectory;});}));
  window.addEventListener('dart:admin-logged-out',()=>{directoryRevision+=1;selectedStaffId=null;permissionDrafts.clear();pendingMembers.clear();directory={staff:[],invitations:[],permissions:[]};staffList.replaceChildren();invitationsList.replaceChildren();invitePermissions.replaceChildren();card.hidden=true;if(staffTab)staffTab.hidden=true;});

  window.addEventListener("dart:admin-authenticated", load);
  document.addEventListener("DOMContentLoaded", () => {
    if (can("staff.read")) void load();
  });
})();

// END MODULE
