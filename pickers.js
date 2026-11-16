// ============================================================
// orOS Core — pickers.js: themed pickers (Bible Part VII, PICK-1)
// ------------------------------------------------------------
// Browsers draw the list of a <select> themselves (Android shows a
// grey system dialog, Windows a white menu), so it never followed the
// orOS palette. Every page that loads this file gets the orOS list
// instead, for every <select> it has now or adds later:
//   - phones and narrow frames (coarse pointer or < 600 px): a sheet
//     that rises from the bottom, with the field's name on top;
//   - desktop: a list right under the field (above it when there is
//     no room below).
// The <select> itself stays where it was and keeps its value, its
// events and its form: choosing a row sets selectedIndex and fires
// "input" then "change" (bubbling), like the browser does. App code
// does not change and does not know about this file.
//
// How the browser's own list is kept shut, in every engine:
//   - pointer: html.opk-on gives eligible selects pointer-events:none
//     (pickers.css), so a tap or click lands on what is under the
//     field; a capture listener on the window finds the select whose
//     box holds the point (and that the hit element contains, so an
//     overlay above the field is never pierced) and opens ours. This
//     is the only way that also holds on Android Chrome / WebView,
//     where preventDefault on mousedown does not stop the system
//     dialog.
//   - keyboard: Space, Enter, F4 and Alt+Up/Down on a focused select
//     are cancelled and open ours. Plain Up/Down still step the value
//     the browser's way.
// Left alone (browser list): <select multiple>, size > 1 (a list box
// on the page, no pop-up), disabled selects, data-native on the
// select or any ancestor (an app that wants the system list).
//
// The list is a modal <dialog> in the top layer (placed against the
// viewport whatever its parent), so it also shows above an app's own
// modal dialogs and is the only thing that takes input
// while open. Esc, a tap outside, Tab or the close button shut it
// without a change; focus goes back to the field.
// Accessibility: role="listbox" with aria-activedescendant, options
// role="option" + aria-selected, label from the field's <label>,
// aria-label or aria-labelledby; arrows, Home/End, PageUp/PageDown,
// Enter, typing to jump (or to filter when the list has a search
// field, more than 12 rows). Optgroups are headings; disabled rows
// cannot be picked, hidden rows are left out.
// Colours: pickers.css reads the page's palette tokens (--panel-bg,
// --text, --text-dim, --accent, --accent-soft, --accent-ink, --border,
// set by each app's inheritPalette), so it follows skin, light/dark
// and high contrast live, with system colours as the fallback on a
// page without tokens.
// Strings: EN / EL / DE inline (three words, no pack needed).
// Pure helpers (fold, matches, nextIndex, label) are exported for
// Node tests (tests/pickers.test.js).
// ============================================================
// i18n-inline-ok: the three strings of the list in EN/EL/DE are data
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosPick = api;
})(typeof window !== "undefined" ? window : this, function (win) {
  "use strict";

  var VERSION = "1.0.0";
  var SEARCH_FROM = 13;   // a search field from this many rows on

  var STR = {
    en: { search: "Search", none: "No matches", close: "Close", list: "Options" },
    el: { search: "Αναζήτηση", none: "Δεν βρέθηκε τίποτα", close: "Κλείσιμο", list: "Επιλογές" },
    de: { search: "Suchen", none: "Keine Treffer", close: "Schließen", list: "Optionen" }
  };

  // ---------- pure helpers ----------
  // Lower case without accents (Greek tonos and dialytika too), so
  // "ελλαδα" finds "Ελλάδα" and "cafe" finds "Café".
  function fold(s) {
    s = String(s == null ? "" : s).toLowerCase();
    if (s.normalize) s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return s.replace(/ς/g, "σ");
  }
  // Every word of the query appears in the text.
  function matches(text, query) {
    var q = fold(query).split(/\s+/).filter(Boolean);
    if (!q.length) return true;
    var t = fold(text);
    for (var i = 0; i < q.length; i++) if (t.indexOf(q[i]) < 0) return false;
    return true;
  }
  // Next pickable row from `from` going `step` (±1, ±8 …), clamped to
  // the ends; rows: [{ disabled }]. -1 when no row can be picked.
  function nextIndex(rows, from, step) {
    var n = rows.length, i, dir = step < 0 ? -1 : 1;
    if (!n) return -1;
    i = from < 0 ? (dir > 0 ? -1 : n) : from;
    i += step;
    if (i < 0) i = 0;
    if (i > n - 1) i = n - 1;
    for (var k = i; k >= 0 && k < n; k += dir) if (!rows[k].disabled) return k;
    for (k = i - dir; k >= 0 && k < n; k -= dir) if (!rows[k].disabled) return k;
    return -1;
  }
  // Type to jump: first pickable row after `from` (wrapping) whose
  // label starts with the typed text.
  function jumpIndex(rows, from, typed) {
    var t = fold(typed), n = rows.length;
    if (!t) return -1;
    for (var k = 1; k <= n; k++) {
      var i = (from + k + n) % n;
      if (!rows[i].disabled && fold(rows[i].label).indexOf(t) === 0) return i;
    }
    return -1;
  }
  function strings(code) { return STR[code] || STR.en; }

  if (!win || !win.document || typeof win.document.createElement !== "function") {
    return { VERSION: VERSION, fold: fold, matches: matches, nextIndex: nextIndex,
      jumpIndex: jumpIndex, strings: strings, STR: STR };
  }
  var doc = win.document;
  if (win.OrosPick && win.OrosPick.VERSION) return win.OrosPick;

  // ---------- environment ----------
  function lang() {
    var c = "";
    try { if (win.orosI18n && win.orosI18n.lang) c = win.orosI18n.lang(); } catch (e) {}
    if (!c) try { if (win.parent !== win && typeof win.parent.orosLang === "string") c = win.parent.orosLang; } catch (e) {}
    if (!c) c = (doc.documentElement.getAttribute("lang") || "en").slice(0, 2);
    return STR[c] ? c : "en";
  }
  function sheetMode() {
    try {
      if (win.matchMedia && win.matchMedia("(pointer: coarse)").matches) return true;
    } catch (e) {}
    return (win.innerWidth || 1024) < 600;
  }
  var supported = typeof doc.createElement("dialog").showModal === "function";

  function eligible(sel) {
    if (!sel || sel.tagName !== "SELECT") return false;
    if (sel.multiple || sel.disabled) return false;
    if (sel.size > 1) return false;
    if (sel.closest && sel.closest("[data-native]")) return false;
    return true;
  }

  // ---------- stylesheet (same folder as this file, same ?v=) ----------
  (function linkCss() {
    var me = doc.currentScript, href = "";
    if (me && me.src) href = me.src.replace(/pickers\.js(\?|#|$)/, "pickers.css$1");
    if (!href || doc.querySelector('link[data-opk]')) return;
    var l = doc.createElement("link");
    l.rel = "stylesheet"; l.href = href; l.setAttribute("data-opk", "");
    (doc.head || doc.documentElement).appendChild(l);
  })();
  if (supported) doc.documentElement.classList.add("opk-on");

  // ---------- the list ----------
  var cur = null;   // { sel, dlg, box, rows, view, active, typed, typedAt, search }
  var uid = 0;

  function fieldLabel(sel) {
    var t = sel.getAttribute("aria-label") || "";
    if (!t) {
      var ids = (sel.getAttribute("aria-labelledby") || "").split(/\s+/);
      t = ids.map(function (id) { var n = id && doc.getElementById(id); return n ? n.textContent : ""; }).join(" ");
    }
    if (!t.trim() && sel.labels && sel.labels.length) {
      var lb = sel.labels[0].cloneNode(true);
      var inner = lb.querySelectorAll("select, option, button, input");
      for (var i = 0; i < inner.length; i++) inner[i].parentNode.removeChild(inner[i]);
      t = lb.textContent;
    }
    if (!t.trim()) t = sel.getAttribute("title") || "";
    return t.replace(/\s+/g, " ").trim();
  }

  function readRows(sel) {
    var rows = [], kids = sel.children;
    function add(o, group) {
      if (o.hidden) return;
      rows.push({ opt: o, index: o.index, label: o.label || o.text, disabled: o.disabled || (group && group.disabled), group: group });
    }
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.tagName === "OPTION") add(k, null);
      else if (k.tagName === "OPTGROUP" && !k.hidden) {
        for (var j = 0; j < k.children.length; j++) if (k.children[j].tagName === "OPTION") add(k.children[j], k);
      }
    }
    return rows;
  }

  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function open(sel) {
    if (!supported || !eligible(sel)) return false;
    if (cur) close(false);
    var S = strings(lang());
    var rows = readRows(sel);
    var sheet = sheetMode();
    var name = fieldLabel(sel);
    var id = "opk" + (++uid);

    var dlg = el("dialog", "opk" + (sheet ? " opk-sheet" : " opk-drop"));
    dlg.setAttribute("aria-label", name || S.list);
    var cs = win.getComputedStyle(sel);
    dlg.style.fontFamily = cs.fontFamily;
    var theme = doc.documentElement.getAttribute("data-theme");
    if (theme === "light" || theme === "dark") dlg.style.colorScheme = theme;

    if (sheet) {
      var head = el("div", "opk-head");
      head.appendChild(el("span", "opk-title", name || S.list));
      var x = el("button", "opk-x");
      x.type = "button";
      x.setAttribute("aria-label", S.close);
      x.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
      x.addEventListener("click", function () { close(true); });
      head.appendChild(x);
      dlg.appendChild(head);
    }
    var search = null;
    if (rows.length >= SEARCH_FROM) {
      search = el("input", "opk-search");
      search.type = "search";
      search.placeholder = S.search;
      search.setAttribute("aria-label", S.search);
      search.setAttribute("aria-controls", id);
      search.setAttribute("autocomplete", "off");
      search.setAttribute("enterkeyhint", "done");
      dlg.appendChild(search);
    }
    var box = el("div", "opk-list");
    box.id = id;
    box.setAttribute("role", "listbox");
    box.setAttribute("aria-label", name || S.list);
    box.tabIndex = 0;
    dlg.appendChild(box);
    var empty = el("p", "opk-none", S.none);
    empty.hidden = true;
    dlg.appendChild(empty);

    cur = { sel: sel, dlg: dlg, box: box, rows: rows, view: rows.slice(), active: -1,
      typed: "", typedAt: 0, search: search, empty: empty, sheet: sheet, id: id };
    paint();
    cur.active = indexInView(sel.selectedIndex);
    if (cur.active < 0) cur.active = nextIndex(cur.view, -1, 1);
    mark();

    dlg.addEventListener("cancel", function (e) { e.preventDefault(); close(true); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) close(true); });
    dlg.addEventListener("keydown", onKey);
    box.addEventListener("click", function (e) {
      var r = e.target.closest ? e.target.closest(".opk-opt") : null;
      if (!r || r.getAttribute("aria-disabled") === "true") return;
      pick(+r.getAttribute("data-i"));
    });
    if (search) search.addEventListener("input", function () { filter(search.value); });
    // The search field is ours: its typing never reaches the app's own
    // input / change listeners (autosave, dirty flags).
    ["input", "change", "keyup", "keypress"].forEach(function (t) {
      dlg.addEventListener(t, function (e) { e.stopPropagation(); });
    });

    (doc.body || doc.documentElement).appendChild(dlg);
    dlg.showModal();
    if (!sheet) place();
    var focusSearch = search && !sheet;
    (focusSearch ? search : box).focus({ preventScroll: true });
    scrollActive(true);
    win.addEventListener("resize", onResize);
    return true;
  }

  function indexInView(selIndex) {
    for (var i = 0; i < cur.view.length; i++) if (cur.view[i].index === selIndex) return i;
    return -1;
  }

  function paint() {
    var box = cur.box, lastGroup = null, sel = cur.sel;
    box.textContent = "";
    cur.view.forEach(function (r, i) {
      if (r.group && r.group !== lastGroup) {
        var g = el("div", "opk-group", r.group.label);
        g.setAttribute("role", "presentation");
        box.appendChild(g);
      }
      lastGroup = r.group;
      var o = el("div", "opk-opt");
      o.id = cur.id + "-" + i;
      o.setAttribute("role", "option");
      o.setAttribute("data-i", String(i));
      var on = r.index === sel.selectedIndex;
      o.setAttribute("aria-selected", on ? "true" : "false");
      if (r.disabled) o.setAttribute("aria-disabled", "true");
      if (r.group) o.classList.add("opk-in");
      o.appendChild(el("span", "opk-label", r.label));
      var tick = el("span", "opk-tick");
      tick.setAttribute("aria-hidden", "true");
      if (on) tick.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      o.appendChild(tick);
      box.appendChild(o);
    });
    cur.empty.hidden = cur.view.length > 0;
  }

  function mark() {
    var prev = cur.box.querySelector(".opk-opt.opk-act");
    if (prev) prev.classList.remove("opk-act");
    if (cur.active < 0) { cur.box.removeAttribute("aria-activedescendant"); return; }
    var n = doc.getElementById(cur.id + "-" + cur.active);
    if (!n) return;
    n.classList.add("opk-act");
    cur.box.setAttribute("aria-activedescendant", n.id);
    if (cur.search) cur.search.setAttribute("aria-activedescendant", n.id);
  }
  function scrollActive(center) {
    var n = cur && cur.active >= 0 ? doc.getElementById(cur.id + "-" + cur.active) : null;
    if (!n) return;
    var b = cur.box, top = n.offsetTop - b.offsetTop, h = n.offsetHeight;
    if (center) b.scrollTop = Math.max(0, top - (b.clientHeight - h) / 2);
    else if (top < b.scrollTop) b.scrollTop = top;
    else if (top + h > b.scrollTop + b.clientHeight) b.scrollTop = top + h - b.clientHeight;
  }

  function filter(q) {
    cur.view = cur.rows.filter(function (r) { return matches(r.label, q); });
    paint();
    cur.active = indexInView(cur.sel.selectedIndex);
    if (cur.active < 0) cur.active = nextIndex(cur.view, -1, 1);
    mark();
    scrollActive(false);
  }

  function place() {
    var d = cur.dlg, r = cur.sel.getBoundingClientRect();
    var vw = doc.documentElement.clientWidth || win.innerWidth, vh = win.innerHeight;
    var w = Math.min(Math.max(r.width, 200), vw - 16);
    var below = vh - r.bottom - 8, above = r.top - 8;
    var up = below < 220 && above > below;
    var room = Math.max(120, Math.min(380, up ? above : below));
    d.style.width = w + "px";
    d.style.maxHeight = room + "px";
    d.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + "px";
    if (up) { d.style.top = "auto"; d.style.bottom = (vh - r.top + 4) + "px"; }
    else { d.style.bottom = "auto"; d.style.top = (r.bottom + 4) + "px"; }
  }
  function onResize() { if (cur && !cur.sheet) place(); }

  function pick(i) {
    var r = cur && cur.view[i];
    if (!r || r.disabled) return;
    var sel = cur.sel, changed = sel.selectedIndex !== r.index;
    close(true);
    if (!changed) return;
    sel.selectedIndex = r.index;
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function close(refocus) {
    if (!cur) return;
    var c = cur;
    cur = null;
    win.removeEventListener("resize", onResize);
    try { c.dlg.close(); } catch (e) {}
    if (c.dlg.parentNode) c.dlg.parentNode.removeChild(c.dlg);
    if (refocus) try { c.sel.focus({ preventScroll: true }); } catch (e) {}
  }

  function onKey(e) {
    if (!cur) return;
    var k = e.key, inSearch = e.target === cur.search, step = 0;
    if (k === "ArrowDown") step = 1;
    else if (k === "ArrowUp") step = -1;
    else if (k === "PageDown") step = 8;
    else if (k === "PageUp") step = -8;
    if (step) {
      e.preventDefault();
      cur.active = nextIndex(cur.view, cur.active, step);
      mark(); scrollActive(false);
      return;
    }
    if ((k === "Home" || k === "End") && !inSearch) {
      e.preventDefault();
      cur.active = k === "Home" ? nextIndex(cur.view, -1, 1) : nextIndex(cur.view, cur.view.length, -1);
      mark(); scrollActive(false);
      return;
    }
    if (k === "Enter" || (k === " " && !inSearch)) {
      e.preventDefault();
      if (cur.active >= 0) pick(cur.active); else close(true);
      return;
    }
    if (k === "Tab") { e.preventDefault(); close(true); return; }
    if (!inSearch && k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (cur.search) { cur.search.focus(); return; }   // the key types into the search field
      var now = Date.now();
      cur.typed = (now - cur.typedAt > 700 ? "" : cur.typed) + k;
      cur.typedAt = now;
      var from = cur.typed.length > 1 ? cur.active - 1 : cur.active;
      var j = jumpIndex(cur.view, from, cur.typed);
      if (j >= 0) { cur.active = j; mark(); scrollActive(false); }
    }
  }

  // ---------- opening ----------
  function hitSelect(e) {
    var t = e.target;
    if (!t || t.nodeType !== 1 || (cur && cur.dlg.contains(t))) return null;
    if (t.tagName === "SELECT") return eligible(t) ? t : null;
    var x = e.clientX, y = e.clientY;
    if (typeof x !== "number") return null;
    var list = t.querySelectorAll ? t.querySelectorAll("select") : [];
    for (var i = list.length - 1; i >= 0; i--) {
      var s = list[i];
      if (!eligible(s)) continue;
      var r = s.getBoundingClientRect();
      if (r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return s;
    }
    return null;
  }
  var downOn = null;
  function onDown(e) {
    if (e.button) return;
    var s = hitSelect(e);
    downOn = s;
    if (!s) return;
    e.preventDefault();
    e.stopPropagation();
  }
  function onClick(e) {
    var s = hitSelect(e);
    if (!s) return;
    e.preventDefault();
    e.stopPropagation();
    if (s !== downOn && e.detail) return;   // pressed elsewhere, let go here
    downOn = null;
    try { s.focus({ preventScroll: true }); } catch (err) {}
    open(s);
  }
  function onSelKey(e) {
    var s = e.target;
    if (cur || !s || s.tagName !== "SELECT" || !eligible(s)) return;
    var k = e.key;
    if (k === " " || k === "Enter" || k === "F4" || (e.altKey && (k === "ArrowDown" || k === "ArrowUp"))) {
      e.preventDefault();
      e.stopPropagation();
      open(s);
    }
  }
  if (supported) {
    win.addEventListener("pointerdown", onDown, true);
    win.addEventListener("mousedown", function (e) { if (hitSelect(e)) { e.preventDefault(); e.stopPropagation(); } }, true);
    win.addEventListener("click", onClick, true);
    win.addEventListener("keydown", onSelKey, true);
  }

  return { VERSION: VERSION, open: open, close: function () { close(true); },
    isOpen: function () { return !!cur; }, eligible: eligible,
    fold: fold, matches: matches, nextIndex: nextIndex, jumpIndex: jumpIndex,
    strings: strings, STR: STR };
});
