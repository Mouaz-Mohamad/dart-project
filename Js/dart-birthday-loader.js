// Home only: defer optional guest birthday popup until critical assets finish loading.
(function () {
  "use strict";
  function loadBirthdayWelcome() {
    if (!document.getElementById("dart-birthday-welcome-popup")) return;
    const script = document.createElement("script");
    script.src = "/Js/dart-birthday-welcome.js";
    script.async = true;
    document.head.appendChild(script);
  }
  if (document.readyState === "complete") loadBirthdayWelcome();
  else window.addEventListener("load", loadBirthdayWelcome, { once: true });
})();
