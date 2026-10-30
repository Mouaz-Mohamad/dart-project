/* Public guest feedback is separate from authenticated, delivered-order reviews. */
(() => {
  "use strict";
  const form = document.getElementById("reviewForm");
  const status = document.getElementById("dart-public-review-status");
  if (!form || !status) return;
  let submitting = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting || !form.reportValidity()) return;
    const fields = new FormData(form);
    const submit = form.querySelector('button[type="submit"]');
    const payload = {
      fullName: String(fields.get("full_name") || "").trim(),
      phone1: String(fields.get("phone1") || "").trim(),
      rating: Number(fields.get("rating")),
      review: String(fields.get("review") || "").trim(),
      website: String(fields.get("website") || ""),
    };
    for (const [key, name] of [["phone2", "phone2"], ["email", "email"], ["title", "title"]]) {
      const value = String(fields.get(name) || "").trim();
      if (value) payload[key] = value;
    }
    submitting = true;
    submit.disabled = true;
    status.textContent = "Sending your review…";
    status.classList.remove("is-error");
    try {
      const response = await fetch("/api/v1/reviews/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        cache: "no-store",
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 429) throw new Error("Too many attempts. Please try again later.");
        if (response.status === 409) throw new Error("This review has already been received. Thank you!");
        throw new Error(result?.error?.message || "We couldn't send your review. Please try again.");
      }
      form.reset();
      status.textContent = "Thank you! Your review has been received and is awaiting approval.";
    } catch (error) {
      status.classList.add("is-error");
      status.textContent = error instanceof Error ? error.message : "Unable to send right now.";
    } finally {
      submitting = false;
      submit.disabled = false;
    }
  });
})();
