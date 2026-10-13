// ============================================================
// orOS Time — Stage display window (v1.0.0, wave 2)
// The page time/stage.js opens with "Open stage display". It shows
// the speaker's picture (time/stage-view.js) from this device's own
// storage and follows every change through the storage event, so the
// operator can close Time, switch apps or reload without the stage
// screen stopping. It writes nothing. Double-click or F: full screen.
// ============================================================
(function () {
  "use strict";
  var V = window.OrosStageView;
  if (!V) return;
  var lang = "en";
  try { if (localStorage.getItem("oros-lang") === "el") lang = "el"; } catch (e) {}
  document.documentElement.lang = lang;
  var T = {
    en: { fs: "Full screen", close: "Close", title: "Stage · orOS" },
    el: { fs: "Πλήρης οθόνη", close: "Κλείσιμο", title: "Σκηνή · orOS" }
  }[lang];
  document.title = T.title;
  document.getElementById("d-fs").textContent = T.fs;
  document.getElementById("d-close").textContent = T.close;

  var view = V.create(document.getElementById("d-root"), { lang: lang });
  var state = V.readState();
  function paint() { view.paint(state, Date.now()); }
  window.addEventListener("storage", function (e) {
    if (!e.key || /^oros-time-stage/.test(e.key)) { state = V.readState(); paint(); }
  });
  setInterval(paint, 250);
  paint();

  function fsOn() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function toggleFs() {
    try {
      if (fsOn()) {
        var x = document.exitFullscreen || document.webkitExitFullscreen;
        var p1 = x && x.call(document); if (p1 && p1.catch) p1.catch(function () {});
      } else {
        var el = document.documentElement, f = el.requestFullscreen || el.webkitRequestFullscreen;
        var p2 = f && f.call(el); if (p2 && p2.catch) p2.catch(function () {});
      }
    } catch (e) {}
  }
  var tools = document.getElementById("d-tools"), idle = 0;
  function poke() {
    tools.classList.add("on");
    document.body.classList.remove("idle");
    clearTimeout(idle);
    idle = setTimeout(function () { tools.classList.remove("on"); document.body.classList.add("idle"); }, 3000);
  }
  document.addEventListener("pointermove", poke);
  document.addEventListener("pointerdown", poke);
  document.addEventListener("dblclick", toggleFs);
  document.addEventListener("keydown", function (e) {
    if (e.key === "f" || e.key === "F") { e.preventDefault(); toggleFs(); }
  });
  document.getElementById("d-fs").addEventListener("click", toggleFs);
  document.getElementById("d-close").addEventListener("click", function () { window.close(); });
  poke();

  // keep the stage screen awake (where supported)
  function lock() {
    try { if (navigator.wakeLock) navigator.wakeLock.request("screen").catch(function () {}); } catch (e) {}
  }
  lock();
  document.addEventListener("visibilitychange", function () { if (!document.hidden) lock(); });
})();
