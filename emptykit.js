// ============================================================
// orOS — emptykit.js: one friendly look for "nothing here yet"
// (EMPTY-1, new users wave 2, 2026-11-11).
// ------------------------------------------------------------
// An app keeps its own empty element, its own words and its own
// show / hide logic. Once the element exists, the app dresses it:
//
//   <link rel="stylesheet" href="../emptykit.css">
//   <script src="../emptykit.js"></script>
//   orosEmpty.dress(el, { app: "todo", action: { label, run } });
//
// dress() adds, once:
//   • the app's own icon in a soft disc on top (the shell's static icon
//     markup through parent.orosTodayEnv.icon(id); none outside orOS);
//   • .ek-title / .ek-text on the first two text children;
//   • a main button (.ek-act) when `action` is given (label is text;
//     run is called on click). Calling dress() again updates the
//     label and the handler, never adds a second button.
//   • in the apps of EX_APPS, a second button "Show me an example"
//     (.ek-act.ek-alt, EXAMPLE-1, wave 3): it loads emptykit-ex.js
//     the first time and paints its made-up rows as a read-only
//     preview (.ek-ex) inside the empty screen, with "This is an
//     example. Nothing is saved.", "Start my own" (closes it and runs
//     the main action) and "Close". The preview never reads or writes
//     the app's data; it lives only in this element.
// Text only through textContent. Nothing is stored, nothing is sent.
// The pure part (which children become title and text) runs in Node:
// tests/emptykit.test.js.
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.1.0";

  // Apps with a made-up example in emptykit-ex.js (same list there).
  var EX_APPS = ["todo", "kanban", "bookmarks", "invoices", "contacts", "budget", "notes", "meals"];

  var STR = {
    en: { show: "Show me an example", note: "This is an example. Nothing is saved.", mine: "Start my own", close: "Close", label: "Example" },
    el: { show: "Δείξε μου ένα παράδειγμα", note: "Αυτό είναι παράδειγμα. Δεν αποθηκεύεται τίποτα.", mine: "Ξεκινώ το δικό μου", close: "Κλείσιμο", label: "Παράδειγμα" },
    de: { show: "Zeig mir ein Beispiel", note: "Das ist ein Beispiel. Nichts wird gespeichert.", mine: "Mit eigenem beginnen", close: "Schließen", label: "Beispiel" }
  };

  // emptykit-ex.js next to this file, with the same ?v=.
  var EX_SRC = (function () {
    try {
      var s = root.document && root.document.currentScript;
      return s && s.src ? s.src.replace(/emptykit\.js(?=\?|#|$)/, "emptykit-ex.js") : "";
    } catch (e) { return ""; }
  })();

  function lang() {
    var l = "";
    try { if (root.orosI18n && typeof root.orosI18n.lang === "function") l = root.orosI18n.lang(); } catch (e) {}
    if (!l) try { l = root.document.documentElement.lang || ""; } catch (e) {}
    l = String(l).slice(0, 2).toLowerCase();
    return l === "el" || l === "de" ? l : "en";
  }

  // Index of the children that become the title and the text: the
  // first two element children that are not the kit's own parts.
  function roles(tags) {
    var out = { title: -1, text: -1 };
    for (var i = 0; i < tags.length; i++) {
      var c = tags[i];
      if (!c || c.kit) continue;
      if (out.title === -1) out.title = i;
      else if (out.text === -1) { out.text = i; break; }
    }
    return out;
  }

  function appIcon(id) {
    try {
      var E = root.parent && root.parent !== root && root.parent.orosTodayEnv;
      var svg = E && typeof E.icon === "function" ? E.icon(id) : "";
      return typeof svg === "string" && /^<svg[\s>]/.test(svg.trim()) ? svg : "";
    } catch (e) { return ""; }
  }

  function dress(el, opts) {
    if (!el || !el.ownerDocument) return el;
    opts = opts || {};
    var doc = el.ownerDocument;
    el.classList.add("ek");
    // The app rebuilt the element's content: the preview went with it.
    if (el.classList.contains("ek-ex-on") && !el.querySelector(":scope > .ek-ex")) el.classList.remove("ek-ex-on");
    var art = el.querySelector(":scope > .ek-art");
    if (!art && opts.app) {
      var svg = appIcon(opts.app);
      if (svg) {
        art = doc.createElement("span");
        art.className = "ek-art";
        art.setAttribute("aria-hidden", "true");
        art.innerHTML = svg;                       // the shell's static icon markup, not data
        el.insertBefore(art, el.firstChild);
      }
    }
    var kids = Array.prototype.slice.call(el.children);
    var r = roles(kids.map(function (c) {
      return { kit: /(^|\s)ek-(art|act|acts)(\s|$)/.test(c.className || "") || c.tagName === "svg" || c.tagName === "SVG" };
    }));
    if (r.title !== -1) kids[r.title].classList.add("ek-title");
    if (r.text !== -1) kids[r.text].classList.add("ek-text");
    if (opts.action && opts.action.label && typeof opts.action.run === "function") {
      var acts = el.querySelector(":scope > .ek-acts");
      if (!acts) {
        acts = doc.createElement("div");
        acts.className = "ek-acts";
        el.appendChild(acts);
      }
      var b = acts.querySelector(".ek-act");
      if (!b) {
        b = doc.createElement("button");
        b.type = "button";
        b.className = "ek-act";
        acts.appendChild(b);
        b.addEventListener("click", function (e) { e.stopPropagation(); if (b.__ekRun) b.__ekRun(); });
      }
      b.textContent = String(opts.action.label);
      b.__ekRun = opts.action.run;
      el.__ekRun = opts.action.run;
      if (opts.app && EX_APPS.indexOf(opts.app) !== -1 && opts.example !== false) {
        var x = acts.querySelector(".ek-alt");
        if (!x) {
          x = doc.createElement("button");
          x.type = "button";
          x.className = "ek-act ek-alt";
          acts.appendChild(x);
          x.addEventListener("click", function (e) { e.stopPropagation(); exampleOpen(el, x.__ekApp); });
        }
        x.textContent = STR[lang()].show;
        x.__ekApp = opts.app;
      }
    }
    return el;
  }

  function exampleLoad(doc, done) {
    if (root.orosExamples) { done(); return; }
    if (!EX_SRC) return;
    var s = doc.createElement("script");
    s.src = EX_SRC;
    s.onload = function () { if (root.orosExamples) done(); };
    (doc.head || doc.documentElement).appendChild(s);
  }

  function exampleClose(el, focus) {
    var box = el.querySelector(":scope > .ek-ex");
    if (box) box.remove();
    el.classList.remove("ek-ex-on");
    var x = el.querySelector(":scope > .ek-acts .ek-alt");
    if (focus && x) x.focus();
  }

  // The read-only preview: made-up rows only, painted through
  // textContent, inside this element. Nothing of the app is touched.
  function exampleOpen(el, app) {
    var doc = el.ownerDocument;
    exampleLoad(doc, function () {
      var L = lang(), s = STR[L];
      var data = root.orosExamples.get(app, L);
      if (!data || !data.rows || !data.rows.length) return;
      exampleClose(el, false);
      var box = doc.createElement("section");
      box.className = "ek-ex";
      box.setAttribute("aria-label", s.label);
      var note = doc.createElement("p");
      note.className = "ek-ex-note";
      note.textContent = s.note;
      box.appendChild(note);
      var ul = doc.createElement("ul");
      ul.className = "ek-ex-list";
      var group = "";
      data.rows.forEach(function (r) {
        if (r.g && r.g !== group) {
          group = r.g;
          var h = doc.createElement("li");
          h.className = "ek-ex-g";
          h.textContent = String(r.g);
          ul.appendChild(h);
        }
        var li = doc.createElement("li");
        li.className = "ek-ex-row";
        var t = doc.createElement("span");
        t.className = "ek-ex-t";
        t.textContent = String(r.t);
        var m = doc.createElement("span");
        m.className = "ek-ex-m";
        m.textContent = String(r.m || "");
        li.appendChild(t);
        li.appendChild(m);
        ul.appendChild(li);
      });
      box.appendChild(ul);
      var foot = doc.createElement("div");
      foot.className = "ek-acts";
      var mine = doc.createElement("button");
      mine.type = "button";
      mine.className = "ek-act";
      mine.textContent = s.mine;
      mine.addEventListener("click", function (e) {
        e.stopPropagation();
        exampleClose(el, false);
        if (typeof el.__ekRun === "function") el.__ekRun();
      });
      var close = doc.createElement("button");
      close.type = "button";
      close.className = "ek-act ek-alt";
      close.textContent = s.close;
      close.addEventListener("click", function (e) { e.stopPropagation(); exampleClose(el, true); });
      foot.appendChild(mine);
      foot.appendChild(close);
      box.appendChild(foot);
      box.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); exampleClose(el, true); } });
      el.appendChild(box);
      el.classList.add("ek-ex-on");
      mine.focus();
    });
  }

  var api = { VER: VER, EX_APPS: EX_APPS, STR: STR, roles: roles, dress: dress, lang: lang };
  root.orosEmpty = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
