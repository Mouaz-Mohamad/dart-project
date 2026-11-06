/* DART public UI: no promotional or account card UI while feature is OFF. */
(function(){
  "use strict";
  function update(s=window.DartSiteSettings?.get?.()||{}){
    document.documentElement.classList.toggle("dart-card-enabled",s.dartCardEnabled===true);
  }
  window.addEventListener("dart:site-settings-changed",event=>update(event.detail));
  update();
})();
