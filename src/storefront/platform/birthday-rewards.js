  // BEGIN Birthday reward clock — frontend prototype; backend remains authoritative.
  function cairoParts(value = new Date()) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: CAIRO_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(value);
    return Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
  }

  function cairoOffsetMs(value) {
    const parts = cairoParts(value);
    return (
      Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
      ) - Math.floor(value.getTime() / 1000) * 1000
    );
  }

  function cairoMoment(year, month, day, hour = 0, minute = 0, second = 0) {
    const normalized = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    const target = {
      year: normalized.getUTCFullYear(),
      month: normalized.getUTCMonth() + 1,
      day: normalized.getUTCDate(),
      hour: normalized.getUTCHours(),
      minute: normalized.getUTCMinutes(),
      second: normalized.getUTCSeconds(),
    };
    let timestamp = Date.UTC(
      target.year,
      target.month - 1,
      target.day,
      target.hour,
      target.minute,
      target.second,
    );
    for (let index = 0; index < 3; index += 1) {
      const adjusted =
        Date.UTC(
          target.year,
          target.month - 1,
          target.day,
          target.hour,
          target.minute,
          target.second,
        ) - cairoOffsetMs(new Date(timestamp));
      if (adjusted === timestamp) break;
      timestamp = adjusted;
    }
    return new Date(timestamp);
  }

  function birthdayParts(value) {
    const text = String(value || "").trim(),
      yearFirst = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/),
      dayFirst = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (yearFirst)
      return { month: Number(yearFirst[2]), day: Number(yearFirst[3]) };
    if (dayFirst)
      return { month: Number(dayFirst[2]), day: Number(dayFirst[1]) };
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? null
      : { month: parsed.getMonth() + 1, day: parsed.getDate() };
  }

  function birthdayWindow(birthday, reference = new Date()) {
    const birth = birthdayParts(birthday);
    if (!birth) return null;
    const cairoNow = cairoParts(reference);
    for (const year of [cairoNow.year, cairoNow.year - 1]) {
      const startsAt = cairoMoment(year, birth.month, birth.day);
      const expiresAt = cairoMoment(
        year,
        birth.month,
        birth.day + BIRTHDAY_REWARD_DAYS,
      );
      if (reference >= startsAt && reference < expiresAt)
        return { year, startsAt, expiresAt };
    }
    return null;
  }

  function birthdayRewardId(customerId, year) {
    return `BDAY-${String(customerId || "CUSTOMER")}-${year}`;
  }

  function syncBirthdayRewards(user = currentUser(), reference = new Date()) {
    if (!user?.customerId) return null;
    const rewards = read(KEYS.birthdayRewards, []);
    if (API_REQUIRED) {
      const windowData = birthdayWindow(user.birthday, reference);
      if (!windowData) return null;
      return (
        rewards.find(
          (row) =>
            row.id === birthdayRewardId(user.customerId, windowData.year) &&
            ["Active", "Reserved"].includes(row.status),
        ) || null
      );
    }
    let changed = false;
    rewards.forEach((reward) => {
      if (reward.customerId !== user.customerId) return;
      if (["Active", "Reserved"].includes(reward.status)) {
        const order = reward.orderId
          ? read(KEYS.orders, []).find(
              (row) => String(row.orderId) === String(reward.orderId),
            )
          : null;
        if (order?.status === "Delivered") {
          reward.status = "Used";
          reward.usedCount = 1;
          reward.usedAt = order.deliveredAt || order.updatedAt || now();
          changed = true;
        } else if (["Cancelled", "Refused"].includes(order?.status)) {
          reward.status = reference < new Date(reward.expiresAt) ? "Active" : "Expired";
          reward.orderId = "";
          reward.reservedAt = null;
          changed = true;
        } else if (reference >= new Date(reward.expiresAt)) {
          reward.status = "Expired";
          changed = true;
        }
      }
    });
    const windowData = birthdayWindow(user.birthday, reference);
    if (windowData) {
      const id = birthdayRewardId(user.customerId, windowData.year);
      let reward = rewards.find((row) => row.id === id);
      if (!reward) {
        reward = {
          id,
          customerId: user.customerId,
          customerName: user.name,
          type: "Birthday",
          discountPercent: BIRTHDAY_DISCOUNT_PERCENT,
          usageLimit: 1,
          usedCount: 0,
          startsAt: windowData.startsAt.toISOString(),
          expiresAt: windowData.expiresAt.toISOString(),
          status: "Active",
          orderId: "",
          createdAt: now(),
        };
        rewards.push(reward);
        changed = true;
      } else if (reward.status === "Scheduled") {
        reward.status = "Active";
        changed = true;
      }
    }
    if (changed) write(KEYS.birthdayRewards, rewards);
    if (!windowData) return null;
    return (
      rewards.find(
        (row) =>
          row.id === birthdayRewardId(user.customerId, windowData.year) &&
          ["Active", "Reserved"].includes(row.status),
      ) || null
    );
  }

  function activeBirthdayReward(user = currentUser()) {
    const reward = syncBirthdayRewards(user);
    return reward?.status === "Active" ? reward : null;
  }

  function dartCardExpiry(value) {
    const parts = String(value || "")
      .split(/[-/]/)
      .map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    return parts[0] > 999
      ? new Date(parts[0], parts[1] - 1, parts[2], 23, 59, 59, 999)
      : new Date(parts[2], parts[1] - 1, parts[0], 23, 59, 59, 999);
  }

  function activeDartCard(user = currentUser(), requestedItems = 0) {
    if (!user?.customerId) return null;
    const quantity = Math.max(0, Math.trunc(Number(requestedItems) || 0));
    return (
      read("dart_cards", []).find((card) => {
        const limit = Number(card.itemLimit || card.purchasedLimit || 10),
          used = Number(card.purchasedItems || 0),
          expiry = dartCardExpiry(card.expDate),
          remaining = Math.max(0, limit - used);
        return (
          card.clientId === user.customerId &&
          card.status === "Active" &&
          !card.isArchived &&
          !card.isDeleted &&
          remaining > 0 &&
          (!quantity || quantity <= remaining) &&
          (!expiry || expiry >= new Date())
        );
      }) || null
    );
  }

  function visibleBirthdayReward(user = currentUser()) {
    return syncBirthdayRewards(user);
  }

  function updateBirthdayRewardForOrder(order, targetStatus) {
    if (API_REQUIRED) return;
    if (!order?.birthdayRewardId) return;
    const rewards = read(KEYS.birthdayRewards, []);
    const reward = rewards.find((row) => row.id === order.birthdayRewardId);
    if (!reward) return;
    if (targetStatus === "Delivered") {
      reward.status = "Used";
      reward.usedCount = 1;
      reward.usedAt = order.deliveredAt || now();
      order.birthdayRewardUsageRecorded = true;
    } else if (["Cancelled", "Refused"].includes(targetStatus)) {
      reward.status = new Date() < new Date(reward.expiresAt) ? "Active" : "Expired";
      reward.orderId = "";
      reward.reservedAt = null;
      order.birthdayRewardUsageRecorded = false;
    }
    write(KEYS.birthdayRewards, rewards);
  }
  // END Birthday reward clock.

