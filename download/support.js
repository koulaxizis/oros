// SUP-1 (Chris 2026-11-19, replaces the KOFI-1 Ko-fi step): a short
// support step before a download, the same idea as nulljsfx.tech and
// noxpress.tech. On the first click of a download link, at most once
// every 30 days in this browser: a note that orOS is free, one plain link
// to useoros.online/support/ (merch, a one-time donation, services) and
// "Skip to download", with "Don't show this again". Every choice but Esc
// or the backdrop goes on to the download. No third-party scripts, no
// widgets: plain links (no-tracking doctrine). Nothing is unlocked.
(function () {
  "use strict";
  // localStorage, never synced: SEEN = when the step last showed,
  // OFF = "1" after "Don't show this again". Without storage the step
  // stays off (never a nag that cannot be turned off).
  var SEEN = "oros-dl-support-seen", OFF = "oros-dl-support-off";
  var GAP = 30 * 24 * 3600 * 1000;
  var DL = /\/releases\/(download|latest)\b|\.(apk|exe|zip|iso|AppImage|deb|xpi)(\?|#|$)/i;
  var T = {
    en: {
      title: "Your download is next",
      body: "orOS is free and made by one person, and it stays that way. If it is useful to you, you can support it with an orOS t-shirt, mug or sticker, a one-time donation, or by hiring me. Nothing is unlocked.",
      page: "♡ Ways to support",
      skip: "Skip to download",
      on: "Continue to download",
      never: "Don't show this again"
    },
    el: {
      title: "Η λήψη σου ξεκινά αμέσως μετά",
      body: "Το orOS είναι δωρεάν, το φτιάχνει ένας άνθρωπος και έτσι θα μείνει. Αν σου είναι χρήσιμο, μπορείς να το στηρίξεις με ένα t-shirt, μια κούπα ή ένα αυτοκόλλητο του orOS, μια εφάπαξ δωρεά ή μια δουλειά για μένα. Δεν ξεκλειδώνει τίποτα.",
      page: "♡ Τρόποι στήριξης",
      skip: "Συνέχεια στη λήψη",
      on: "Συνέχεια στη λήψη",
      never: "Να μην εμφανιστεί ξανά"
    }
  };
  function due() {
    try {
      if (localStorage.getItem(OFF) === "1") return false;
      var t = parseInt(localStorage.getItem(SEEN) || "0", 10);
      return !(t > 0 && Date.now() - t < GAP);
    } catch (e) { return false; }
  }
  function mark() { try { localStorage.setItem(SEEN, String(Date.now())); } catch (e) {} }

  var css = document.createElement("style");
  css.textContent =
    ".dls-ov{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;z-index:50}" +
    ".dls{background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:12px;padding:20px;max-width:440px;width:100%}" +
    ".dls h2{margin:0 0 8px}.dls p{margin:0 0 14px}" +
    ".dls-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}" +
    ".dls .btn{margin-top:0}" +
    ".dls-skip{background:none;border:0;color:var(--dim);font:inherit;font-size:14px;text-decoration:underline;cursor:pointer;padding:8px 4px;margin-left:auto}" +
    ".dls-never{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:14px;color:var(--dim);cursor:pointer}";
  document.head.appendChild(css);

  function show(link) {
    var art = link.closest ? link.closest("article[lang]") : null;
    var lang = (art && art.getAttribute("lang")) === "el" ? "el" : "en";
    var t = T[lang];
    var href = link.href, back = document.activeElement;
    var ov = document.createElement("div");
    ov.className = "dls-ov";
    var box = document.createElement("div");
    box.className = "dls";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-labelledby", "dls-t");
    var h = document.createElement("h2"); h.id = "dls-t"; h.textContent = t.title;
    var p = document.createElement("p"); p.textContent = t.body;
    var row = document.createElement("div"); row.className = "dls-row";
    var page = document.createElement("a");
    page.className = "btn";
    page.href = "/support/?lang=" + lang;
    page.target = "_blank"; page.rel = "noopener";
    page.textContent = t.page;
    var skip = document.createElement("button");
    skip.type = "button"; skip.className = "dls-skip"; skip.textContent = t.skip;
    // After a visit to /support/ (new tab), the skip button reads as the way on.
    page.addEventListener("click", function () { skip.textContent = t.on; });
    skip.addEventListener("click", function () { go(); });
    row.appendChild(page);
    row.appendChild(skip);
    var lab = document.createElement("label"); lab.className = "dls-never";
    var never = document.createElement("input"); never.type = "checkbox";
    lab.appendChild(never);
    lab.appendChild(document.createTextNode(t.never));
    box.appendChild(h); box.appendChild(p); box.appendChild(row); box.appendChild(lab);
    ov.appendChild(box);
    function remember() {
      if (!never.checked) return;
      try { localStorage.setItem(OFF, "1"); } catch (e) {}
    }
    function close() {
      remember();
      document.removeEventListener("keydown", onKey);
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      if (back && back.focus) back.focus();
    }
    function go() { close(); setTimeout(function () { location.href = href; }, 0); }
    function onKey(e) { if (e.key === "Escape") close(); }
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(ov);
    skip.focus();
  }

  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a || a.closest(".dls") || !DL.test(a.getAttribute("href") || "") || !due()) return;
    e.preventDefault();
    mark();
    show(a);
  });
})();
