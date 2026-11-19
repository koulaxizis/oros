// KOFI-1 (Chris 2026-11-19): the Ko-fi step before a download, the same
// idea as nulljsfx.tech and noxpress.tech. Once per visit (sessionStorage),
// on the first click of a download link: a short note on how orOS is
// funded, two plain Ko-fi links and "Skip to download". Every choice
// but Esc or the backdrop goes on to the download. No third-party
// scripts, no widgets: plain links (no-tracking doctrine).
(function () {
  "use strict";
  var SEEN = "oros-dl-support";
  var DL = /\/releases\/(download|latest)\b|\.(apk|exe|zip|iso|AppImage|deb|xpi)(\?|#|$)/i;
  var T = {
    en: {
      title: "Your download is next",
      body: "orOS is free and made by one person, and Ko-fi is the only way it is funded. A €5 coffee pays for about a day of the tools it is built with; a membership from €3 a month keeps it going. Nothing is unlocked: everything stays free.",
      coffee: "☕ Buy a coffee",
      tiers: "Monthly, from €3",
      skip: "Skip to download"
    },
    el: {
      title: "Η λήψη σου ξεκινά αμέσως μετά",
      body: "Το orOS είναι δωρεάν, το φτιάχνει ένας άνθρωπος και το Ko-fi είναι ο μόνος τρόπος που χρηματοδοτείται. Ένας καφές των 5 € πληρώνει περίπου μια μέρα από τα εργαλεία με τα οποία φτιάχνεται· μια συνδρομή από 3 € τον μήνα το κρατά ζωντανό. Δεν ξεκλειδώνει τίποτα: όλα μένουν δωρεάν.",
      coffee: "☕ Κέρασε έναν καφέ",
      tiers: "Μηνιαία, από 3 €",
      skip: "Συνέχεια στη λήψη"
    }
  };
  function seen() { try { return sessionStorage.getItem(SEEN) === "1"; } catch (e) { return true; } }
  function mark() { try { sessionStorage.setItem(SEEN, "1"); } catch (e) {} }

  var css = document.createElement("style");
  css.textContent =
    ".dls-ov{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;z-index:50}" +
    ".dls{background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:12px;padding:20px;max-width:440px;width:100%}" +
    ".dls h2{margin:0 0 8px}.dls p{margin:0 0 14px}" +
    ".dls-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}" +
    ".dls .btn{margin-top:0}" +
    ".dls-skip{background:none;border:0;color:var(--dim);font:inherit;font-size:14px;text-decoration:underline;cursor:pointer;padding:8px 4px;margin-left:auto}";
  document.head.appendChild(css);

  function show(link) {
    var art = link.closest ? link.closest("article[lang]") : null;
    var t = T[(art && art.getAttribute("lang")) === "el" ? "el" : "en"];
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
    function kofi(url, label, soft) {
      var a = document.createElement("a");
      a.className = soft ? "btn soft" : "btn";
      a.href = url; a.target = "_blank"; a.rel = "noopener";
      a.textContent = label;
      a.addEventListener("click", function () { go(); });
      return a;
    }
    var skip = document.createElement("button");
    skip.type = "button"; skip.className = "dls-skip"; skip.textContent = t.skip;
    skip.addEventListener("click", function () { go(); });
    row.appendChild(kofi("https://ko-fi.com/koulaxizis", t.coffee, false));
    row.appendChild(kofi("https://ko-fi.com/koulaxizis/tiers", t.tiers, true));
    row.appendChild(skip);
    box.appendChild(h); box.appendChild(p); box.appendChild(row);
    ov.appendChild(box);
    function close() {
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
    if (!a || a.closest(".dls") || !DL.test(a.getAttribute("href") || "") || seen()) return;
    e.preventDefault();
    mark();
    show(a);
  });
})();
