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
// Text only through textContent. Nothing is stored, nothing is sent.
// The pure part (which children become title and text) runs in Node:
// tests/emptykit.test.js.
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.0.0";

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
    }
    return el;
  }

  var api = { VER: VER, roles: roles, dress: dress };
  root.orosEmpty = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
