  // BEGIN Birthday celebration, countdown and vertical navbar ticker.
  function countdownValues(expiresAt) {
    const remaining = Math.max(0, new Date(expiresAt).getTime() - Date.now());
    return {
      remaining,
      days: Math.floor(remaining / 864e5),
      hours: Math.floor((remaining % 864e5) / 36e5),
      minutes: Math.floor((remaining % 36e5) / 6e4),
    };
  }

  function renderBirthdayTicker() {
    const track = document.querySelector(".dart-nav-ticker-track");
    if (!track) return;
    const reward = visibleBirthdayReward(),
      configured = window.DartSiteSettings?.activeAnnouncements?.() || [],
      birthdayPercent = Number(reward?.discountPercent ?? BIRTHDAY_DISCOUNT_PERCENT),
      messages = configured.length ? configured.map((row) => row.text) : ["Welcome to Dart"];
    if (reward)
      messages.push(
        reward.status === "Reserved"
          ? `Your ${birthdayPercent}% birthday gift is reserved for your current order`
          : `Your birthday gift is ready — ${birthdayPercent}% OFF for 7 days`,
      );
    const signature = JSON.stringify([reward?.id || "none", reward?.status || "", messages]);
    if (track.dataset.signature === signature) return;
    track.dataset.signature = signature;
    track.innerHTML = messages
      .map(
        (message, index) =>
          `<p class="dart-nav-ticker-message${index ? " is-birthday" : ""}">${escapeHtml(message)}</p>`,
      )
      .join("");
    clearInterval(window.dartNavTickerTimer);
    track.style.transform = "translateY(0)";
    if (messages.length > 1) {
      let index = 0;
      window.dartNavTickerTimer = setInterval(() => {
        index = (index + 1) % messages.length;
        track.style.transform = `translateY(-${index * 30}px)`;
      }, 4000);
    }
  }

  function wireSocialLinks() {
    document.querySelectorAll("[data-social-url]").forEach((link) => {
      const url = String(link.dataset.socialUrl || "").trim();
      if (url) {
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.removeAttribute("aria-disabled");
        link.removeAttribute("tabindex");
      } else {
        link.removeAttribute("href");
        link.setAttribute("aria-disabled", "true");
        link.tabIndex = -1;
      }
    });
  }

  function requestedAuthDestination() {
    let requested = "";
    try {
      requested = new URLSearchParams(location.search || "").get("next") || "";
    } catch {}
    return requested === "checkout" ? "cart-checkout.html" : "profile.html";
  }

  function wireAccountLink() {
    const destination = currentUser()
      ? "/profile.html"
      : "/Sign%20Up%20modern.html?next=profile";
    document.querySelectorAll(".account-btn a").forEach((link) => {
      link.href = destination;
    });
  }

  function redirectRememberedCustomer() {
    let pathname = "";
    try {
      pathname = decodeURIComponent(location.pathname || "").toLowerCase();
    } catch {
      pathname = String(location.pathname || "").toLowerCase();
    }
    const user = currentUser();
    if (
      !pathname.endsWith("/sign up modern.html") ||
      !user ||
      (API_BASE && user.status !== "active")
    )
      return false;
    location.replace(requestedAuthDestination());
    return true;
  }

  function addPartyPieces(layer) {
    const confettiColors = ["#ab012b", "#f4c95d", "#ffffff", "#ef7b45"];
    for (let index = 0; index < 34; index += 1) {
      const piece = document.createElement("span");
      piece.className = "dart-confetti-piece";
      piece.style.left = `${(index * 29) % 100}%`;
      piece.style.background = confettiColors[index % confettiColors.length];
      piece.style.setProperty("--fall", `${5 + (index % 6)}s`);
      piece.style.setProperty("--delay", `${-(index % 9)}s`);
      piece.style.setProperty("--drift", `${(index % 2 ? 1 : -1) * (18 + (index % 5) * 9)}px`);
      layer.appendChild(piece);
    }
    for (let index = 0; index < 9; index += 1) {
      const balloon = document.createElement("span");
      balloon.className = "dart-balloon";
      balloon.textContent = ["🎈", "🎈", "🎉"][index % 3];
      balloon.style.left = `${3 + ((index * 13) % 91)}%`;
      balloon.style.setProperty("--rise", `${8 + (index % 5) * 1.4}s`);
      balloon.style.setProperty("--delay", `${-(index % 7) * 1.2}s`);
      balloon.style.setProperty("--drift", `${(index % 2 ? 1 : -1) * (15 + index * 2)}px`);
      layer.appendChild(balloon);
    }
  }

  function updateBirthdayCountdown(overlay, reward) {
    const values = countdownValues(reward.expiresAt);
    const fields = {
      days: values.days,
      hours: values.hours,
      minutes: values.minutes,
    };
    Object.entries(fields).forEach(([key, value]) => {
      const field = overlay.querySelector(`[data-birthday-time="${key}"]`);
      if (field) field.textContent = String(value).padStart(2, "0");
    });
    if (values.remaining > 0) return;
    overlay.remove();
    syncBirthdayRewards();
    renderBirthdayTicker();
    clearInterval(window.dartBirthdayCountdownTimer);
  }

  function renderBirthdayCelebration() {
    const reward = visibleBirthdayReward(),
      existing = document.querySelector(".dart-birthday-celebration");
    const closeKey = reward
      ? `dart_birthday_celebration_closed:${reward.id}`
      : "";
    if (reward && !preparedBirthdayCelebrationIds.has(reward.id)) {
      preparedBirthdayCelebrationIds.add(reward.id);
      if (!PRESERVE_BIRTHDAY_CLOSE_STATE) sessionStorage.removeItem(closeKey);
    }
    if (
      !reward ||
      sessionStorage.getItem(closeKey) === "1"
    ) {
      existing?.remove();
      return;
    }
    if (existing?.dataset.rewardId === reward.id) return;
    existing?.remove();
    const overlay = document.createElement("section");
    overlay.className = "dart-birthday-celebration";
    overlay.dataset.rewardId = reward.id;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Your Dart birthday gift");
    overlay.innerHTML = `<div class="dart-party-layer" aria-hidden="true"></div><div class="dart-birthday-card"><div class="dart-birthday-countdown" aria-label="Time remaining on birthday discount"><div class="dart-birthday-time"><strong data-birthday-time="days">00</strong><span>Days</span></div><div class="dart-birthday-time"><strong data-birthday-time="hours">00</strong><span>Hours</span></div><div class="dart-birthday-time"><strong data-birthday-time="minutes">00</strong><span>Minutes</span></div></div></div><button type="button" class="dart-birthday-close">Close</button>`;
    addPartyPieces(overlay.querySelector(".dart-party-layer"));
    overlay.querySelector(".dart-birthday-close").addEventListener("click", () => {
      sessionStorage.setItem(closeKey, "1");
      overlay.remove();
      clearInterval(window.dartBirthdayCountdownTimer);
    });
    document.body.appendChild(overlay);
    updateBirthdayCountdown(overlay, reward);
    clearInterval(window.dartBirthdayCountdownTimer);
    window.dartBirthdayCountdownTimer = setInterval(
      () => updateBirthdayCountdown(overlay, reward),
      1000,
    );
    overlay.querySelector(".dart-birthday-close")?.focus();
  }

  function renderBirthdayExperience() {
    renderBirthdayTicker();
    wireSocialLinks();
    renderBirthdayCelebration();
  }
  // END Birthday celebration, countdown and vertical navbar ticker.

