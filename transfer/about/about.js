/* orOS Transfer landing page: language switch, the hero artwork and
   the code box (opens the receive page with the code in the #fragment,
   which never leaves the browser). No network request of its own. */
(function () {
  "use strict";
  var LANGS = ["en", "el", "de"];
  var SEED = 20261113;                 // the landing page always shows the same sunset

  function set(l) {
    if (LANGS.indexOf(l) < 0) l = "en";
    LANGS.forEach(function (x) { var a = document.getElementById(x); if (a) a.hidden = x !== l; });
    document.documentElement.lang = l;
    [].forEach.call(document.querySelectorAll(".lang button"), function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-l") === l));
    });
    try { localStorage.setItem("oros-lang", l); } catch (e) {}
  }
  function start() {
    var q = /[?&]lang=(en|el|de)\b/.exec(location.search);
    if (q) return q[1];
    try { var s = localStorage.getItem("oros-lang"); if (LANGS.indexOf(s) >= 0) return s; } catch (e) {}
    var n = String(navigator.language || "").slice(0, 2).toLowerCase();
    return LANGS.indexOf(n) >= 0 ? n : "en";
  }

  var A = window.orosTransferArt, box = document.getElementById("art"), lastW = 0;
  function paint() {
    if (!A || !box) return;
    var w = box.clientWidth || window.innerWidth, h = box.clientHeight || window.innerHeight;
    if (Math.abs(w - lastW) < 40 && box.firstChild) return;     // phones change height while scrolling
    lastW = w;
    var svg = A.toNode(A.draw(SEED, { style: "horizon", accent: "#d4af37", w: w, h: h }), document, "land");
    box.textContent = "";
    box.appendChild(svg);
  }
  var tm = 0;
  window.addEventListener("resize", function () { clearTimeout(tm); tm = setTimeout(paint, 150); });

  [].forEach.call(document.querySelectorAll("form[data-code]"), function (f) {
    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var v = String(f.querySelector("input").value || "").trim();
      var m = /#(.+)$/.exec(v);                                  // a pasted link
      if (m) v = decodeURIComponent(m[1]);
      var code = v.toUpperCase().replace(/[\s\-_.·]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
      if (!/^[0-9A-HJKMNP-TV-Z]{12}$/.test(code)) { f.classList.add("bad"); f.querySelector("input").focus(); return; }
      location.href = "../receive.html#" + code.slice(0, 4) + "-" + code.slice(4, 8) + "-" + code.slice(8, 12);
    });
    f.querySelector("input").addEventListener("input", function () { f.classList.remove("bad"); });
  });
  [].forEach.call(document.querySelectorAll(".lang button"), function (b) {
    b.addEventListener("click", function () { set(b.getAttribute("data-l")); });
  });

  set(start());
  paint();
})();
