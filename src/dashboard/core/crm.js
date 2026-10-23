function renderReviews(dataArray) {
  const c = document.getElementById("review-container");
  if (!c) return;
  c.innerHTML = "";
  getSortedData(dataArray)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .forEach((r) => {
      const active = r.status === "Active";
      const source =
        r.source || (r.recordType === "contact" ? "Contact Us" : "Review");
      const isContact = source === "Contact Us";
      const visibilityButton = isContact
        ? ""
        : `<button class="btn-toggle-review review-toggle-btn ${active ? "review-status-active" : "review-status-hidden"}">${active ? "Hide" : "Activate"}</button>`;
      c.insertAdjacentHTML(
        "beforeend",
        `<div class="${getRowClass(r)}" data-id="${dartEsc(r.id)}" data-permission-domain="${isContact ? "contacts" : "reviews"}"><input type="checkbox" class="model-checkbox" ${r.isChecked ? "checked" : ""}><div class="w200 button row-action-btns"><button class="action-btn btn-delete"><i class="bx ${dartIsArchived(r) ? "bx-revision" : "bx-minus-circle"}"></i></button><button class="action-btn btn-hard-delete"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit"><i class="bx bx-edit"></i></button>${visibilityButton}</div><span class="text-item w200">${dartEsc(new Date(r.createdAt).toLocaleString())}</span><span class="text-item w150">${dartEsc(source)}</span><span class="text-item w200">${dartEsc(r.clientName || "-")}</span><span class="text-item w150">${dartEsc(r.clientId || "-")}</span><span class="text-item w150 status-text" style="color:${isContact ? "#64748b" : active ? "green" : "red"}">${dartEsc(r.status || "-")}</span><span class="text-item w100">${isContact ? "-" : `${dartEsc(r.rating || "-")} / 5`}</span><span class="text-item w300">${dartEsc(r.title || "-")}</span><span class="text-item w500 overflow">${dartEsc(r.review || "-")}</span><span class="text-item w150">${dartEsc(r.phone1 || "-")}</span><span class="text-item w150">${dartEsc(r.phone2 || "-")}</span><span class="text-item w150">${dartEsc(r.email || "-")}</span></div>`,
      );
    });
}

function renderRepresentative(dataArray) {
  const c = document.getElementById("representative-container");
  if (!c) return;
  c.innerHTML = "";
  getSortedData(dataArray).forEach((r) => {
    const current = ordersData.filter(
        (o) =>
          String(o.representativeId) === String(r.id) &&
          !DART_FINAL_ORDER_STATES.includes(o.status),
      ).length,
      total = ordersData.filter(
        (o) => String(o.representativeId) === String(r.id),
      ).length,
      pending = r.serverAuthoritative && r.status === "Pending Approval",
      secureActions = r.serverAuthoritative
        ? `<button class="action-btn dart-rep-docs" title="Verification documents"><i class="bx bx-id-card"></i></button>
           ${pending ? '<button class="action-btn dart-rep-approve" title="Approve"><i class="bx bx-check-circle"></i></button><button class="action-btn dart-rep-reject" title="Reject"><i class="bx bx-x-circle"></i></button>' : ""}`
        : "",
      maskedNationalId = r.nationalIdLast4
        ? `••••••••••${dartEsc(r.nationalIdLast4)}`
        : "-";
    c.insertAdjacentHTML(
      "beforeend",
      `<div class="${getRowClass(r)}" data-id="${dartEsc(r.id)}"><input type="checkbox" class="model-checkbox" ${r.isChecked ? "checked" : ""}><div class="w300 button row-action-btns"><button class="action-btn btn-delete"><i class="bx ${dartIsArchived(r) ? "bx-revision" : "bx-minus-circle"}"></i></button><button class="action-btn btn-hard-delete"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit"><i class="bx bx-edit"></i></button><button class="dart-history-btn" data-history-entity="representative"><i class="bx bx-history"></i></button>${secureActions}</div><span class="text-item w200">${dartEsc(r.name)}</span><span class="text-item w150">${dartEsc(r.repId)}</span><span class="text-item w150" style="color:${r.status === "Active" ? "#10b981" : r.status === "Pending Approval" ? "#f59e0b" : "#ef4444"}">${dartEsc(r.status)}</span><span class="text-item w150">${maskedNationalId}</span><span class="text-item w150">${current}</span><span class="text-item w100">${total}</span><span class="text-item w150">${dartEsc(r.phone1)}</span><span class="text-item w150">${dartEsc(r.phone2 || "-")}</span><span class="text-item w200">${dartEsc(r.address || "-")}</span><span class="text-item w150">${dartEsc(r.createdAt ? new Date(r.createdAt).toLocaleDateString() : r.date || "-")}</span></div>`,
    );
  });
}

async function dartRefreshRepresentativesFromServer() {
  if (!window.DartDomainState?.hydrateDomain) return;
  await window.DartDomainState.hydrateDomain("representatives", true);
}

async function dartReviewRepresentativeDocuments(representativeId) {
  if (!window.DartAdminApi?.request) {
    throw new Error("Secure admin API is unavailable.");
  }
  const types = [
    ["id_front", "National ID — front"],
    ["id_back", "National ID — back"],
    ["face", "Face verification"],
  ];
  const documents = [];
  for (const [type, label] of types) {
    const payload = await window.DartAdminApi.request(
      `/api/v1/admin/representatives/${encodeURIComponent(representativeId)}/documents/${type}`,
    );
    documents.push({ label, dataUrl: payload.document?.dataUrl || "" });
  }
  const viewer = window.open("", "_blank", "noopener,noreferrer");
  if (!viewer) throw new Error("Allow pop-ups to review verification documents.");
  viewer.document.title = "Dart Representative Verification";
  viewer.document.body.innerHTML =
    '<main style="font-family:Arial,sans-serif;max-width:900px;margin:30px auto;padding:0 20px"><h1>Representative verification</h1><p>Private review session. Do not share these documents.</p></main>';
  const main = viewer.document.querySelector("main");
  documents.forEach(({ label, dataUrl }) => {
    const section = viewer.document.createElement("section");
    section.style.marginBottom = "28px";
    const heading = viewer.document.createElement("h2");
    heading.textContent = label;
    const image = viewer.document.createElement("img");
    image.src = dataUrl;
    image.alt = label;
    image.style.maxWidth = "100%";
    image.style.borderRadius = "12px";
    section.append(heading, image);
    main.appendChild(section);
  });
}

document.addEventListener("click", async (event) => {
  const row = event.target.closest("#representative-container [data-id]");
  if (!row) return;
  const representativeId = row.dataset.id;
  const approve = event.target.closest(".dart-rep-approve");
  const reject = event.target.closest(".dart-rep-reject");
  const docs = event.target.closest(".dart-rep-docs");
  if (!approve && !reject && !docs) return;

  try {
    if (docs) {
      await dartReviewRepresentativeDocuments(representativeId);
      return;
    }
    if (!window.DartAdminApi?.request) {
      throw new Error("Secure admin API is unavailable.");
    }
    if (approve) {
      if (!await window.DartDialog.confirm("Approve this representative account?")) return;
      await window.DartAdminApi.request(
        `/api/v1/admin/representatives/${encodeURIComponent(representativeId)}/approve`,
        { method: "POST" },
      );
    }
    if (reject) {
      const reason = await window.DartDialog.prompt("Reason for rejecting this representative:");
      if (!reason || reason.trim().length < 3) return;
      await window.DartAdminApi.request(
        `/api/v1/admin/representatives/${encodeURIComponent(representativeId)}/reject`,
        { method: "POST", body: { reason: reason.trim() } },
      );
    }
    await dartRefreshRepresentativesFromServer();
  } catch (error) {
    window.DartDialog.alert(error.message || "Representative action failed.");
  }
});

