(function () {
  "use strict";

  const card = document.getElementById("settings-staff-access-card");
  const form = document.getElementById("settings-staff-invite-form");
  const invitePermissions = document.getElementById("settings-staff-invite-permissions");
  const staffList = document.getElementById("settings-staff-list");
  const invitationsList = document.getElementById("settings-staff-invitations");
  const statusNode = document.getElementById("settings-staff-status");

  if (!card || !form || !invitePermissions || !staffList || !invitationsList || !statusNode) {
    return;
  }

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
          ${protectedBasics.has(permission.key) ? "disabled" : ""}
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
            ${permissions.map((permission) => permissionLabel(permission)).join("")}
          </fieldset>`,
      )
      .join("");
  }

  function staffPermissionEditor(member) {
    if (member.isOwner) {
      return `
        <div class="dart-staff-protected">
          <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
          Owner permissions and Owner identity are protected.
        </div>`;
    }
    const selected = new Set(member.permissions || []);
    return `
      <div class="dart-staff-member-permissions" data-staff-permissions>
        ${directory.permissions
          .map((permission) => permissionLabel(permission, selected))
          .join("")}
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
        <button type="button" class="dart-settings-secondary" data-staff-action="relink-google">
          Change Gmail / relink
        </button>
      </div>`;
  }

  function renderStaff() {
    if (!directory.staff.length) {
      staffList.innerHTML =
        '<div class="dart-empty-state">No Staff accounts yet.</div>';
      return;
    }

    staffList.innerHTML = directory.staff
      .map((member) => `
        <details
          class="dart-settings-list-row dart-staff-member"
          data-staff-id="${esc(member.id)}"
          data-staff-active="${member.status === "Active" ? "true" : "false"}"
          data-staff-owner="${member.isOwner ? "true" : "false"}"
        >
          <summary>
            <div>
              <strong>${esc(member.name)}</strong>
              <small>${esc(member.email)} · ${esc(member.staffCode || "")}</small>
            </div>
            <div class="dart-staff-badges">
              <span>${member.isOwner ? "Owner" : esc(member.status)}</span>
              <span>${member.googleLinked ? "Google Linked" : "Google Not linked"}</span>
            </div>
          </summary>
          <div class="dart-staff-member-body">
            <p>Google identity: <strong>${member.googleLinked ? "Linked" : "Not linked"}</strong></p>
            <p>Last Google login: <strong>${esc(displayDate(member.lastLoginAt))}</strong></p>
            <p>Identity linked: <strong>${esc(displayDate(member.linkedAt))}</strong></p>
            ${member.disabledReason
              ? `<p>Disabled reason: <strong>${esc(member.disabledReason)}</strong></p>`
              : ""}
            ${staffActions(member)}
            ${staffPermissionEditor(member)}
          </div>
        </details>`,
      )
      .join("");
  }

  function renderAllowances() {
    const pending = directory.invitations.filter(
      (entry) =>
        entry.accessMode === "google" &&
        entry.status === "pending",
    );
    if (!pending.length) {
      invitationsList.innerHTML =
        '<div class="dart-empty-state">No pending Google access entries.</div>';
      return;
    }

    invitationsList.innerHTML = pending
      .map((entry) => `
        <div class="dart-settings-list-row" data-allowance-id="${esc(entry.id)}">
          <div>
            <strong>${esc(entry.name)}</strong>
            <small>${esc(entry.email)} · waiting for first Google sign-in</small>
          </div>
          ${can("staff.manage")
            ? '<button type="button" class="dart-settings-secondary" data-remove-allowance>Remove</button>'
            : '<span>Pending</span>'}
        </div>`)
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
      renderAllowances();
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
      setStatus("You do not have permission to manage Staff.", true);
      return;
    }

    const selected = [
      ...invitePermissions.querySelectorAll(
        'input[type="checkbox"]:checked:not(:disabled)',
      ),
    ].map((input) => input.value);
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;

    try {
      await window.DartAdminApi.request("/api/v1/admin/staff/allowlist", {
        method: "POST",
        body: {
          displayName: document.getElementById("settings-staff-name").value.trim(),
          email: document.getElementById("settings-staff-email").value.trim(),
          phone: document.getElementById("settings-staff-phone").value.trim(),
          permissionKeys: selected,
        },
      });
      form.reset();
      setStatus(
        "Employee Gmail allowed. No OTP or password was sent; they can use Continue with Google.",
      );
      await load();
    } catch (error) {
      setStatus(error.message || "Unable to allow Staff access.", true);
    } finally {
      submit.disabled = false;
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
          body: { reason: "removed_before_first_google_login" },
        },
      );
      setStatus("Pending Staff Gmail access removed.");
      await load();
    } catch (error) {
      setStatus(error.message || "Unable to remove Staff access.", true);
      button.disabled = false;
    }
  });

  staffList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-staff-action]");
    if (!button || !can("staff.manage")) return;

    const memberRow = button.closest("[data-staff-id]");
    const staffId = memberRow?.dataset.staffId;
    const isOwner = memberRow?.dataset.staffOwner === "true";
    if (!staffId || isOwner) return;

    const action = button.dataset.staffAction;
    button.disabled = true;
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
        setStatus(
          "Staff permissions updated. Existing sessions were revoked so the new permissions take effect.",
        );
      } else if (action === "toggle-access") {
        const active = memberRow.dataset.staffActive === "true";
        const reason = active
          ? window.prompt("Reason for disabling this employee:", "disabled_by_owner")
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
      } else if (action === "relink-google") {
        const email = window.prompt(
          "Enter the new allowed Gmail. The current Google link and all sessions will be revoked:",
          "",
        );
        if (!email) return;
        const reason = window.prompt(
          "Enter the reason for this Gmail change (minimum 8 characters):",
          "gmail changed",
        );
        if (!reason) return;
        await window.DartAdminApi.request(
          `/api/v1/admin/staff/${encodeURIComponent(staffId)}/google/relink`,
          {
            method: "POST",
            body: {
              email: email.trim(),
              reason: reason.trim(),
            },
          },
        );
        setStatus(
          "Google identity unlinked safely. The employee must sign in again with the new allowed Gmail.",
        );
      }
      await load();
    } catch (error) {
      setStatus(error.message || "Unable to update Staff access.", true);
    } finally {
      button.disabled = false;
    }
  });

  window.addEventListener("dart:admin-authenticated", load);
  document.addEventListener("DOMContentLoaded", () => {
    if (can("staff.read")) void load();
  });
})();
