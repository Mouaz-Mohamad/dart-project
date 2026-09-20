(function () {
  "use strict";

  const card = document.getElementById("settings-staff-access-card");
  const form = document.getElementById("settings-staff-invite-form");
  const invitePermissions = document.getElementById("settings-staff-invite-permissions");
  const staffList = document.getElementById("settings-staff-list");
  const invitationsList = document.getElementById("settings-staff-invitations");
  const statusNode = document.getElementById("settings-staff-status");

  if (!card || !form || !invitePermissions || !staffList || !invitationsList) return;

  let directory = {
    permissions: [],
    invitations: [],
    staff: [],
  };

  const protectedBasics = new Set([
    "profile.read_own",
    "profile.update_own",
    "sessions.read_own",
    "sessions.revoke_own",
  ]);

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function can(permission) {
    return window.DartAdminAccess?.can?.(permission) === true;
  }

  function setStatus(message, error = false) {
    statusNode.textContent = message || "";
    statusNode.classList.toggle("is-error", Boolean(error));
    statusNode.hidden = !message;
  }

  function permissionGroup(key) {
    return String(key || "").split(".")[0] || "other";
  }

  function permissionLabel(permission) {
    return `
      <label class="dart-staff-permission">
        <input
          type="checkbox"
          value="${esc(permission.key)}"
          ${protectedBasics.has(permission.key) ? "checked disabled" : ""}
        >
        <span>
          <strong>${esc(permission.key)}</strong>
          <small>${esc(permission.description || "")}</small>
        </span>
      </label>`;
  }

  function renderInvitePermissions() {
    const groups = new Map();
    directory.permissions.forEach((permission) => {
      const group = permissionGroup(permission.key);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(permission);
    });
    invitePermissions.innerHTML = [...groups.entries()]
      .map(
        ([group, permissions]) => `
          <fieldset class="dart-staff-permission-group">
            <legend>${esc(group)}</legend>
            ${permissions.map(permissionLabel).join("")}
          </fieldset>`,
      )
      .join("");
  }

  function staffPermissionEditor(member) {
    if (member.isOwner) {
      return `
        <div class="dart-staff-protected">
          <i class="fa-solid fa-shield-halved"></i>
          Owner permissions are protected.
        </div>`;
    }
    const selected = new Set(member.permissions || []);
    return `
      <div class="dart-staff-member-permissions" data-staff-permissions="${esc(member.id)}">
        ${directory.permissions
          .map((permission) => {
            const checked =
              selected.has(permission.key) || protectedBasics.has(permission.key);
            return `
              <label class="dart-staff-permission">
                <input
                  type="checkbox"
                  value="${esc(permission.key)}"
                  ${checked ? "checked" : ""}
                  ${protectedBasics.has(permission.key) ? "disabled" : ""}
                >
                <span>
                  <strong>${esc(permission.key)}</strong>
                  <small>${esc(permission.description || "")}</small>
                </span>
              </label>`;
          })
          .join("")}
        ${can("staff.manage")
          ? `<button type="button" class="dart-settings-save" data-save-staff-permissions="${esc(member.id)}">Save permissions</button>`
          : ""}
      </div>`;
  }

  function renderStaff() {
    if (!directory.staff.length) {
      staffList.innerHTML =
        '<div class="dart-empty-state">No Staff accounts yet.</div>';
      return;
    }
    staffList.innerHTML = directory.staff
      .map(
        (member) => `
          <details class="dart-settings-list-row dart-staff-member" data-staff-id="${esc(member.id)}">
            <summary>
              <div>
                <strong>${esc(member.name)}</strong>
                <small>${esc(member.email)} · ${esc(member.staffCode || "")}</small>
              </div>
              <span>${member.isOwner ? "Owner" : esc(member.status)}</span>
            </summary>
            <div class="dart-staff-member-body">
              <p>2FA: <strong>${member.mfaRequired ? "Required" : "Optional"}</strong></p>
              <p>Created: ${member.createdAt ? esc(new Date(member.createdAt).toLocaleString()) : "-"}</p>
              ${staffPermissionEditor(member)}
            </div>
          </details>`,
      )
      .join("");
  }

  function renderInvitations() {
    if (!directory.invitations.length) {
      invitationsList.innerHTML =
        '<div class="dart-empty-state">No Staff invitations yet.</div>';
      return;
    }
    invitationsList.innerHTML = directory.invitations
      .map(
        (invite) => `
          <div class="dart-settings-list-row">
            <div>
              <strong>${esc(invite.name)}</strong>
              <small>${esc(invite.email)} · ${esc(invite.status)}</small>
            </div>
            <span>${
              invite.expiresAt
                ? esc(new Date(invite.expiresAt).toLocaleDateString())
                : "No expiry"
            }</span>
          </div>`,
      )
      .join("");
  }

  async function load() {
    if (!can("staff.read") || !window.DartAdminApi?.request) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    try {
      directory = await window.DartAdminApi.request("/api/v1/admin/staff");
      renderInvitePermissions();
      renderStaff();
      renderInvitations();
      setStatus("");
    } catch (error) {
      setStatus(error.message || "Unable to load Staff access.", true);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    if (!can("staff.manage")) {
      setStatus("You do not have permission to invite Staff.", true);
      return;
    }
    const selected = [
      ...invitePermissions.querySelectorAll('input[type="checkbox"]:checked:not(:disabled)'),
    ].map((input) => input.value);
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await window.DartAdminApi.request("/api/v1/admin/staff/invitations", {
        method: "POST",
        body: {
          displayName: document.getElementById("settings-staff-name").value.trim(),
          email: document.getElementById("settings-staff-email").value.trim(),
          permissionKeys: selected,
          mfaRequired: document.getElementById("settings-staff-mfa").checked,
        },
      });
      form.reset();
      document.getElementById("settings-staff-mfa").checked = true;
      setStatus("Staff invitation created. The employee can now activate the account with the invited email.");
      await load();
    } catch (error) {
      setStatus(error.message || "Unable to invite Staff.", true);
    } finally {
      submit.disabled = false;
    }
  });

  staffList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-save-staff-permissions]");
    if (!button) return;
    const staffId = button.dataset.saveStaffPermissions;
    const container = staffList.querySelector(
      `[data-staff-permissions="${CSS.escape(staffId)}"]`,
    );
    if (!container) return;
    const selected = [
      ...container.querySelectorAll('input[type="checkbox"]:checked'),
    ].map((input) => input.value);
    button.disabled = true;
    try {
      await window.DartAdminApi.request(
        `/api/v1/admin/staff/${encodeURIComponent(staffId)}/permissions`,
        {
          method: "PUT",
          body: { permissionKeys: selected },
        },
      );
      setStatus("Staff permissions updated. Existing sessions for that employee were revoked.");
      await load();
    } catch (error) {
      setStatus(error.message || "Unable to update Staff permissions.", true);
    } finally {
      button.disabled = false;
    }
  });

  window.addEventListener("dart:admin-authenticated", load);
  document.addEventListener("DOMContentLoaded", () => {
    if (can("staff.read")) void load();
  });
})();