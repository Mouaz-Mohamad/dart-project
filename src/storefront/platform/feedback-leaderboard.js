  function renderFeedbackEligibility() {
    const section = document.getElementById("reviewForm")?.closest(".feedback-section");
    if (!section || section.dataset.eligibilityRendered) return;
    const user = currentUser();
    const eligible =
      Boolean(user) &&
      (API_BASE
        ? serverReviewEligible === true
        : read(KEYS.orders, []).some(
            (order) =>
              order.clientId === user.customerId && order.status === "Delivered",
          ));
    if (eligible) {
      section.dataset.eligibilityRendered = "1";
      section.querySelector(".feedback-access-message")?.remove();
      const form = section.querySelector("#reviewForm");
      if (form) {
        form.hidden = false;
        form.elements.full_name.value = user.name;
        form.elements.phone1.value = displayPhone(user.phone1);
        form.elements.phone2.value = displayPhone(user.phone2);
        form.elements.email.value = user.email;
        ["full_name", "phone1", "phone2", "email"].forEach((name) => {
          const field = form.elements[name];
          if (field) field.readOnly = true;
        });
      }
      return;
    }
    section.dataset.eligibilityRendered = "1";
    const form = section.querySelector("#reviewForm");
    if (form) form.hidden = true;
    if (!section.querySelector(".feedback-access-message")) {
      section.insertAdjacentHTML(
        "beforeend",
        '<div class="feedback-access-message"><i class="fa-solid fa-bag-shopping"></i><h2>شارك تجربتك بعد استلام طلبك الأول</h2><p>قم بطلب قطعة من Dart، وبعد تسليم الطلب ستتمكن من إرسال تقييمك.</p><a href="products.html" class="submit-btn-form">عرض المنتجات</a></div>',
      );
    }
  }

  // BEGIN Leaderboard net items — completed customer returns no longer count as purchases.


  let publicLeaderboardRows = null;
  let publicLeaderboardPeriod = "";
  let publicLeaderboardLoading = false;
  let publicLeaderboardFailed = false;

  async function hydratePublicLeaderboard() {
    if (!API_BASE || publicLeaderboardLoading) return publicLeaderboardRows || [];
    publicLeaderboardLoading = true;
    try {
      const payload = await apiRequest("/api/v1/leaderboard");
      const serverRows = Array.isArray(payload.rows) ? payload.rows : [];
      publicLeaderboardRows = serverRows;
      publicLeaderboardPeriod = String(payload.period || "");
      publicLeaderboardFailed = false;
      renderLeaderboard();
      return publicLeaderboardRows;
    } catch (error) {
      publicLeaderboardRows = [];
      publicLeaderboardFailed = true;
      renderLeaderboard();
      window.dispatchEvent(new CustomEvent("dart:leaderboard-unavailable", {
        detail: { code: error?.code || "NETWORK_UNAVAILABLE" },
      }));
      return [];
    } finally {
      publicLeaderboardLoading = false;
    }
  }

  function renderLeaderboard() {
    const list = document.querySelector(".leaderboard-list");
    if (!list) return;

    if (!API_BASE) {
      list.innerHTML =
        '<li class="leaderboard-empty">Leaderboard requires the Dart API.</li>';
      return;
    }

    if (publicLeaderboardRows === null && !publicLeaderboardFailed) {
      list.innerHTML =
        '<li class="leaderboard-empty" role="status">Loading current contenders…</li>';
      void hydratePublicLeaderboard();
      return;
    }

    if (publicLeaderboardFailed) {
      list.innerHTML =
        '<li class="leaderboard-empty"><span>Leaderboard is temporarily unavailable.</span> <button type="button" class="dart-leaderboard-retry">Retry</button></li>';
      list
        .querySelector(".dart-leaderboard-retry")
        ?.addEventListener("click", () => {
          publicLeaderboardFailed = false;
          publicLeaderboardRows = null;
          renderLeaderboard();
        });
      return;
    }

    const rows = (publicLeaderboardRows || []).slice(0, 3);
    const signature = `${publicLeaderboardPeriod}:${JSON.stringify(rows)}`;
    if (list.dataset.dartLeaderboardSignature === signature) return;

    if (!rows.length) {
      list.innerHTML =
        '<li class="leaderboard-empty">No eligible candidates this month yet.</li>';
      list.dataset.dartLeaderboardSignature = signature;
      return;
    }

    list.innerHTML =
      rows
        .map(
          (row, index) =>
            `<li class="leaderboard-item rank-${index + 1} ${index === 0 ? "top-rank" : ""}"><div class="rank-badge"><h2 class="rank-num">${index + 1}</h2></div><div class="leaderboard-candidate"><small>${index === 0 ? "Leading contender" : "Dart Card contender"}</small><h3 class="user-name">${escapeHtml(row.name || "Dart Customer")}</h3></div><h3 class="score" aria-label="${Number(row.items) || 0} PIC"><strong>${Number(row.items) || 0}</strong><span>PIC</span></h3></li>`,
        )
        .join("");
    list.dataset.dartLeaderboardSignature = signature;
  }
  // END Leaderboard net items.

