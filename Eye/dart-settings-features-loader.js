/* Lazy Settings-only controls: avoid adding them to every dashboard view. */
(function(){
  "use strict";
  let loaded=false;
  function load(){
    if(loaded)return;
    loaded=true;
    for(const src of [
      "dart-settings-shortcuts.js?v=20261105-final-three-1",
      "dart-return-policy-settings.js?v=20261107-1",
      "dart-card-system-settings.js?v=20261107-1"
    ]){
      const script=document.createElement("script");
      script.src=src;script.defer=true;document.head.appendChild(script);
    }
  }
  document.addEventListener("click",event=>{
    if(event.target.closest?.('[data-target="settings"]'))load();
  },true);
  function start(){
    if(location.hash==="#settings"||
       document.getElementById("settings")?.classList.contains("active"))load();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});
  else start();
  window.addEventListener("hashchange",start);
})();
