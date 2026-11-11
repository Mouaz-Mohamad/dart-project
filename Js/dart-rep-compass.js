// Device heading stays on the courier's device. No network request or persistent sensor record.
(() => {
  "use strict";
  let active = false, permitted = false, reading = null, sampledAt = 0, lastEventAt = 0, permissionRequest = null, lastStatus = "";
  const wrap = degrees => ((degrees % 360) + 360) % 360;
  function status(state) {
    if (state === lastStatus) return;
    lastStatus = state;
    document.dispatchEvent(new CustomEvent("dart:rep-compass-state", { detail: { state } }));
  }
  function receive(event) {
    if (!active || document.hidden || Date.now() - lastEventAt < 80) return;
    let heading = null;
    if (typeof event.webkitCompassHeading === "number" && Number.isFinite(event.webkitCompassHeading)) {
      if (event.webkitCompassAccuracy != null && (event.webkitCompassAccuracy < 0 || event.webkitCompassAccuracy > 40)) { status("calibrate"); return; }
      heading = event.webkitCompassHeading;
    } else if ((event.absolute === true || event.type === "deviceorientationabsolute") &&
        typeof event.alpha === "number" && Number.isFinite(event.alpha)) {
      heading = 360 - event.alpha;
    }
    // Relative alpha has an arbitrary origin; never present it as a north-referenced compass.
    if (heading == null) return;
    const screenAngle = Number(window.screen?.orientation?.angle ?? window.orientation ?? 0);
    heading = wrap(heading + (Number.isFinite(screenAngle) ? screenAngle : 0));
    reading = heading;
    lastEventAt = sampledAt = Date.now();
    status("active");
    document.dispatchEvent(new CustomEvent("dart:rep-compass", { detail: { heading: reading } }));
  }
  function resume() {
    if (!permitted || active || document.hidden || !document.getElementById("repNavigationDialog")?.open) return;
    active = true;
    window.addEventListener("deviceorientationabsolute", receive, { passive: true });
    window.addEventListener("deviceorientation", receive, { passive: true });
    status("waiting");
  }
  function pause() {
    active = false; reading = null; sampledAt = 0;
    status("paused");
    window.removeEventListener("deviceorientationabsolute", receive);
    window.removeEventListener("deviceorientation", receive);
  }
  function enable() {
    if (permissionRequest) return permissionRequest;
    if (permitted) { if (document.getElementById("repNavigationDialog")?.open) resume(); return Promise.resolve(true); }
    if (!window.DeviceOrientationEvent) { status("unavailable"); return Promise.resolve(false); }
    // Invoke synchronously from Start/Resume/the compass button, before any network await, for iOS activation.
    let permission;
    try {
      permission = typeof window.DeviceOrientationEvent.requestPermission === "function"
        ? window.DeviceOrientationEvent.requestPermission(true) : Promise.resolve("granted");
    } catch { status("denied"); return Promise.resolve(false); }
    permissionRequest = Promise.resolve(permission).then(result => {
      permitted = result === "granted";
      if (permitted && document.getElementById("repNavigationDialog")?.open) resume();
      else if (!permitted) status("denied");
      return permitted;
    }).catch(() => { status("denied"); return false; }).finally(() => { permissionRequest = null; });
    return permissionRequest;
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
    else if (document.getElementById("repNavigationDialog")?.open) resume();
  });
  window.DartRepCompass = Object.freeze({ enable, pause, resume,
    get heading() { return active && Date.now() - sampledAt < 10000 ? reading : null; } });
})();
