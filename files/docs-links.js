// ============================================================
// orOS Files — docs-links.js (v1.0.0): "Documents" in other apps.
// ------------------------------------------------------------
// DOCS-1 wave 4. A document in Files › Documents can be linked to an
// item of Budget, Invoices, Garage, Health or CRM (docs.js: its `ln`
// rows { a: app id, r: that app's search target, t: title }). This
// file gives those apps their read-only side: the documents linked to
// the item that is open, as a small list whose rows open the document
// in Files. Each app loads it with a script tag and calls
//   OrosDocsLinks.attach(container, app, test)
// where test(r) says whether a link target names the open item. The
// list is drawn with textContent only, and only when there is
// something to show (no empty section). It never writes: a link is
// made and removed in Files.
//   linked(raw, app, test) → [{ id, title }] (pure, tested in node)
// Reads oros-files-docs from the same origin's storage; tombstones
// hide rows the way the merge does (files/docs-core.js).
// Exposes window.OrosDocsLinks (browser) or module.exports (tests).
// ============================================================
(function (root) {
  "use strict";

  var KEY = "oros-files-docs";
  var S = {
    en: { title: "Documents", open: "Open in Files" },
    el: { title: "Έγγραφα", open: "Άνοιγμα στα Αρχεία" },
    de: { title: "Dokumente", open: "In Dateien öffnen" }
  };

  function isObj(o) { return !!o && typeof o === "object" && !Array.isArray(o); }
  function lang() {
    var l = "";
    try { l = (root.document && root.document.documentElement.lang) || ""; } catch (e) { l = ""; }
    l = String(l).slice(0, 2).toLowerCase();
    return S[l] ? l : "en";
  }

  function linked(raw, app, test) {
    if (!isObj(raw) || !Array.isArray(raw.docs) || typeof test !== "function") return [];
    var tombs = isObj(raw.tombs) ? raw.tombs : {}, out = [];
    raw.docs.forEach(function (d) {
      if (!isObj(d) || typeof d.id !== "string" || d.id.indexOf("d-") !== 0) return;
      var tomb = Number(tombs[d.id]);
      if (isFinite(tomb) && tomb >= Number(d.m)) return;
      var hit = (Array.isArray(d.ln) ? d.ln : []).some(function (l) {
        if (!isObj(l) || l.a !== app) return false;
        try { return !!test(l.r); } catch (e) { return false; }
      });
      if (!hit) return;
      var p = typeof d.p === "string" ? d.p : "";
      var title = (typeof d.t === "string" && d.t.trim()) || p.slice(p.lastIndexOf("/") + 1) || d.id;
      out.push({ id: d.id, title: title, d: typeof d.d === "string" ? d.d : "" });
    });
    return out.sort(function (a, b) { return a.d !== b.d ? (a.d < b.d ? 1 : -1) : (a.title < b.title ? -1 : 1); })
      .map(function (x) { return { id: x.id, title: x.title }; });
  }

  function read() {
    try { return JSON.parse(root.localStorage.getItem(KEY)); } catch (e) { return null; }
  }
  function openDoc(id) {
    var w = root;
    try { if (root.parent && root.parent !== root && typeof root.parent.__orosOpenAt === "function") w = root.parent; } catch (e) { w = root; }
    if (typeof w.__orosOpenAt === "function" && w !== root) w.__orosOpenAt("files", { doc: id });
    else if (root.location) root.location.href = "../files/";   // standalone page: Files itself
  }

  // Draws the section into `host` (before its button row when the host
  // is a form or dialog with one). Returns the section, or null.
  function attach(host, app, test) {
    if (!host || !root.document) return null;
    var old = host.querySelector(":scope > .oros-doclinks, :scope form > .oros-doclinks");
    if (old) old.remove();
    var list = linked(read(), app, test);
    if (!list.length) return null;
    var T = S[lang()], doc = root.document;
    var sec = doc.createElement("section");
    sec.className = "oros-doclinks";
    sec.style.cssText = "margin:10px 0;display:flex;flex-direction:column;gap:6px";
    var h = doc.createElement("div");
    h.textContent = T.title;
    h.style.cssText = "font-size:.85em;opacity:.75";
    sec.appendChild(h);
    list.slice(0, 20).forEach(function (x) {
      var b = doc.createElement("button");
      b.type = "button";
      b.className = "oros-doclink";
      b.textContent = "📄 " + x.title;
      b.title = T.open;
      b.style.cssText = "text-align:left;min-height:40px;padding:8px 12px;border:1px solid rgba(127,127,127,.4);border-radius:10px;background:none;color:inherit;font:inherit;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%";
      b.addEventListener("click", function () {
        var dlg = b.closest("dialog");
        if (dlg && dlg.open) { try { dlg.close(); } catch (e) {} }
        openDoc(x.id);
      });
      sec.appendChild(b);
    });
    var form = host.tagName === "FORM" ? host : host.querySelector("form") || host;
    var row = null, kids = form.children;
    for (var i = kids.length - 1; i >= 0; i--) {
      var k = kids[i];
      if (k.tagName === "MENU" || /(^| )(([a-z]+-)?(actions|buttons|btns|footer)|dlg-row|btn-row)( |$)/.test(typeof k.className === "string" ? k.className : "") || k.tagName === "FOOTER") { row = k; break; }
    }
    if (row) form.insertBefore(sec, row);
    else form.appendChild(sec);
    return sec;
  }

  var API = { VERSION: "1.0.0", KEY: KEY, linked: linked, attach: attach };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosDocsLinks = API;
})(typeof window !== "undefined" ? window : globalThis);
