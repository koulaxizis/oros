// ============================================================
// orOS Core — pickers-ui.js: the themed pickers themselves (PICK-1)
// ------------------------------------------------------------
// Loaded by pickers.js on the first tap, click or key on a field (or
// the first OrosPick.ask), together with pickers-ui.css, so a page's
// first open pays only for the small pickers.js. Exposes
// window.OrosPickUI (open / ask / close / isOpen); pages and apps use
// window.OrosPick from pickers.js, never this object.
// The full contract (what opens, keys, values, colours) is in the
// header of pickers.js and Bible Part VII (PICK-1).
// Pure helpers (fold, matches, nextIndex, dates, colours) are exported
// for Node tests (tests/pickers.test.js).
// ============================================================
// The contract of the themed pickers (PICK-1), loader in pickers.js:
// Browsers draw the pickers of a form themselves (Android shows a grey
// system dialog, Windows a white menu), so they never followed the
// orOS palette. Every page that loads this file gets orOS pickers
// instead, for every field it has now or adds later:
//   - <select>: a list (T1);
//   - <input type=date|time|datetime-local>: a calendar and/or clock (T2);
//   - <input type=color>: a colour picker (T3);
//   - OrosPick.ask(): the themed twin of confirm() / prompt() (T4, R14).
// Phones and narrow frames (coarse pointer or < 600 px) get a sheet
// that rises from the bottom; desktop a panel under the field.
// The field itself stays where it was and keeps its value, its events
// and its form: a choice sets the value and fires "input" then
// "change" (bubbling), like the browser does. App code does not change.
//
// pickers.js is small on purpose (the first-open budget of every app,
// .github/qa/budget.json): it only keeps the browser's pickers shut and
// loads pickers-ui.js + pickers-ui.css, which draw the orOS ones, on
// the first press on a field (they come from the service worker's
// cache, so the wait is a few milliseconds).
//
// How the browser's own picker is kept shut, in every engine:
//   - pointer: html.opk-on gives eligible fields pointer-events:none
//     (pickers.css), so a tap or click lands on what is under the
//     field; a capture listener on the window finds the field whose
//     box holds the point (and that the hit element contains, so an
//     overlay above the field is never pierced), stops the event and
//     opens ours. This is the only way that also holds on Android
//     Chrome / WebView / TWA, where preventDefault on mousedown does
//     not stop the system dialog.
//   - keyboard: on a focused select Space, Enter, F4, Alt+Up/Down; on
//     a date / time field F4, Alt+Up/Down, Space (typing digits stays
//     the browser's); on a colour field Space, Enter.
//   - field.showPicker() opens ours too.
// Left alone (browser picker): <select multiple>, size > 1, disabled
// or readonly fields, data-native on the field or any ancestor.
// ============================================================
// i18n-inline-ok: the strings of the pickers in EN/EL/DE are data
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosPickUI = api;
})(typeof window !== "undefined" ? window : this, function (win) {
  "use strict";

  var VERSION = "1.3.0";
  var SEARCH_FROM = 13;   // a search field from this many rows on

  var STR = {
    en: { search: "Search", none: "No matches", close: "Close", list: "Options",
      date: "Date", time: "Time", today: "Today", now: "Now", clear: "Clear", done: "Done",
      prev: "Previous month", next: "Next month", prevY: "Earlier years", nextY: "Later years",
      pickYear: "Choose month and year", hours: "Hours", minutes: "Minutes", seconds: "Seconds",
      colour: "Colour", hex: "Colour code", hue: "Hue", shade: "Saturation and brightness", eyedrop: "Pick from the screen", swatches: "Colours", cancel: "Cancel", ok: "OK" },
    el: { search: "Αναζήτηση", none: "Δεν βρέθηκε τίποτα", close: "Κλείσιμο", list: "Επιλογές",
      date: "Ημερομηνία", time: "Ώρα", today: "Σήμερα", now: "Τώρα", clear: "Καθαρισμός", done: "Τέλος",
      prev: "Προηγούμενος μήνας", next: "Επόμενος μήνας", prevY: "Προηγούμενα έτη", nextY: "Επόμενα έτη",
      pickYear: "Επιλογή μήνα και έτους", hours: "Ώρες", minutes: "Λεπτά", seconds: "Δευτερόλεπτα",
      colour: "Χρώμα", hex: "Κωδικός χρώματος", hue: "Απόχρωση", shade: "Κορεσμός και φωτεινότητα", eyedrop: "Επιλογή από την οθόνη", swatches: "Χρώματα", cancel: "Άκυρο", ok: "Εντάξει" },
    de: { search: "Suchen", none: "Keine Treffer", close: "Schließen", list: "Optionen",
      date: "Datum", time: "Uhrzeit", today: "Heute", now: "Jetzt", clear: "Löschen", done: "Fertig",
      prev: "Vorheriger Monat", next: "Nächster Monat", prevY: "Frühere Jahre", nextY: "Spätere Jahre",
      pickYear: "Monat und Jahr wählen", hours: "Stunden", minutes: "Minuten", seconds: "Sekunden",
      colour: "Farbe", hex: "Farbcode", hue: "Farbton", shade: "Sättigung und Helligkeit", eyedrop: "Vom Bildschirm wählen", swatches: "Farben", cancel: "Abbrechen", ok: "OK" }
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

  // ---------- pure date and time helpers (T2) ----------
  // Calendar dates as { y, m (1-12), d }, times as { h, mi, s }; values
  // in the formats of <input type=date|time|datetime-local>.
  function pad(n, w) { n = String(n); while (n.length < (w || 2)) n = "0" + n; return n; }
  function utc(y, m, d) { var t = new Date(0); t.setUTCFullYear(y, m - 1, d); return t; }
  function daysIn(y, m) { return utc(y, m + 1, 0).getUTCDate(); }
  function parseDate(v) {
    var m = /^(\d{4,6})-(\d{2})-(\d{2})/.exec(v || "");
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return null;
    return { y: y, m: mo, d: d };
  }
  function parseTime(v) {
    var m = /(?:^|T)(\d{2}):(\d{2})(?::(\d{2}))?/.exec(v || "");
    if (!m) return null;
    var h = +m[1], mi = +m[2], sec = m[3] ? +m[3] : 0;
    if (h > 23 || mi > 59 || sec > 59) return null;
    return { h: h, mi: mi, s: sec };
  }
  function isoDate(o) { return pad(o.y, 4) + "-" + pad(o.m) + "-" + pad(o.d); }
  function isoTime(o, secs) { return pad(o.h) + ":" + pad(o.mi) + (secs ? ":" + pad(o.s) : ""); }
  function addDays(o, k) { var t = utc(o.y, o.m, o.d + k); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; }
  function addMonths(o, k) {
    var mm = o.m - 1 + k, y = o.y + Math.floor(mm / 12);
    mm = ((mm % 12) + 12) % 12;
    return { y: y, m: mm + 1, d: Math.min(o.d || 1, daysIn(y, mm + 1)) };
  }
  function sameDay(a, b) { return !!a && !!b && a.y === b.y && a.m === b.m && a.d === b.d; }
  // Monday = 0 … Sunday = 6
  function weekday(o) { return (utc(o.y, o.m, o.d).getUTCDay() + 6) % 7; }
  // 6 weeks from the Monday on or before the 1st: [{ y, m, d, out }]
  function monthGrid(y, m) {
    var first = { y: y, m: m, d: 1 }, start = addDays(first, -weekday(first)), out = [];
    for (var i = 0; i < 42; i++) {
      var c = addDays(start, i);
      c.out = c.m !== m;
      out.push(c);
    }
    return out;
  }
  // The date part of a min / max value bounds a day.
  function dayAllowed(o, min, max) {
    var v = isoDate(o);
    if (min && parseDate(min) && v < min.slice(0, 10)) return false;
    if (max && parseDate(max) && v > max.slice(0, 10)) return false;
    return true;
  }
  // A full value kept inside min and max (same format, so the strings
  // compare in time order).
  function clampValue(v, min, max) {
    if (!v) return v;
    if (min && min.length === v.length && v < min) return min;
    if (max && max.length === v.length && v > max) return max;
    return v;
  }
  // ---------- pure colour helpers (T3) ----------
  // "#abc" / "#AABBCC" / "aabbcc" → "#aabbcc"; anything else → null
  function normHex(v) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(v == null ? "" : v).trim());
    if (!m) return null;
    var h = m[1].toLowerCase();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return "#" + h;
  }
  function hexToRgb(h) {
    h = normHex(h);
    if (!h) return null;
    var n = parseInt(h.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbToHex(c) {
    function x(v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? "0" : "") + v.toString(16); }
    return "#" + x(c.r) + x(c.g) + x(c.b);
  }
  // h 0-360, s and v 0-1
  function rgbToHsv(c) {
    var r = c.r / 255, g = c.g / 255, b = c.b / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h: h, s: mx ? d / mx : 0, v: mx };
  }
  function hsvToRgb(o) {
    var h = ((o.h % 360) + 360) % 360, c = o.v * o.s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = o.v - c;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
  }
  // step attribute (seconds) → seconds column or not, minute step
  function timeSteps(step) {
    var st = +step;
    if (!(st > 0)) st = 60;
    if (st % 60) return { secs: true, miStep: 1, sStep: st < 60 && 60 % st === 0 ? st : 1 };
    var mi = st / 60;
    return { secs: false, miStep: mi <= 30 && 60 % mi === 0 ? mi : 1, sStep: 1 };
  }

  if (!win || !win.document || typeof win.document.createElement !== "function") {
    return { VERSION: VERSION, fold: fold, matches: matches, nextIndex: nextIndex,
      jumpIndex: jumpIndex, strings: strings, STR: STR, parseDate: parseDate, parseTime: parseTime,
      isoDate: isoDate, isoTime: isoTime, daysIn: daysIn, addDays: addDays, addMonths: addMonths,
      weekday: weekday, monthGrid: monthGrid, dayAllowed: dayAllowed, clampValue: clampValue,
      timeSteps: timeSteps, sameDay: sameDay,
      normHex: normHex, hexToRgb: hexToRgb, rgbToHex: rgbToHex, rgbToHsv: rgbToHsv, hsvToRgb: hsvToRgb };
  }
  var doc = win.document;
  if (win.OrosPickUI && win.OrosPickUI.VERSION) return win.OrosPickUI;

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

  var DATE_TYPES = { date: 1, time: 1, "datetime-local": 1 };
  function eligibleDate(n) {
    if (!n || n.tagName !== "INPUT" || !DATE_TYPES[n.type]) return false;
    if (n.disabled || n.readOnly) return false;
    if (n.closest && n.closest("[data-native]")) return false;
    return true;
  }
  function eligibleColour(n) {
    if (!n || n.tagName !== "INPUT" || n.type !== "color") return false;
    if (n.disabled || n.readOnly) return false;
    if (n.closest && n.closest("[data-native]")) return false;
    return true;
  }
  function eligibleAny(n) { return eligible(n) || eligibleDate(n) || eligibleColour(n); }
  function eligible(sel) {
    if (!sel || sel.tagName !== "SELECT") return false;
    if (sel.multiple || sel.disabled) return false;
    if (sel.size > 1) return false;
    if (sel.closest && sel.closest("[data-native]")) return false;
    return true;
  }

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

  // The page's own font (a field may carry the browser's monospace default)
  function pageFont(field) {
    var f = "";
    try { f = win.getComputedStyle(field.parentNode || doc.body).fontFamily; } catch (e) {}
    if (!f) try { f = win.getComputedStyle(doc.body).fontFamily; } catch (e) {}
    return f;
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
    dlg.style.fontFamily = pageFont(sel);
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
    var w = Math.min(Math.max(r.width, cur.minW || 200), vw - 16);
    var below = vh - r.bottom - 8, above = r.top - 8;
    var want = cur.kind === "big" ? Math.min(d.scrollHeight, 520) : 220;
    var up = below < want && above > below;
    var room = Math.max(120, Math.min(cur.kind === "big" ? 520 : 380, up ? above : below));
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
    if (c.cancelAsk) { var f = c.cancelAsk; c.cancelAsk = null; setTimeout(f, 0); }
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

  // ---------- date and time (T2) ----------
  // <input type=date|time|datetime-local>: a month grid (Monday first,
  // month names in the user's language) and/or hour and minute columns.
  // A date alone is set as soon as a day is picked; a time or a date
  // with a time is set by Done. min / max: days outside are dimmed and
  // cannot be picked, the final value is kept inside them. step: the
  // minute column counts in its steps (300 → 00, 05, …), seconds when
  // the step asks for them. Clear only when the field is not required.
  function locale() {
    try { if (win.orosI18n && win.orosI18n.locale) return win.orosI18n.locale(); } catch (e) {}
    return { en: "en-GB", el: "el-GR", de: "de-DE" }[lang()] || "en-GB";
  }
  function fmt(loc, opts, o) {
    try {
      opts.timeZone = "UTC";
      return new Intl.DateTimeFormat(loc, opts).format(utc(o.y, o.m, o.d || 1));
    } catch (e) { return isoDate({ y: o.y, m: o.m, d: o.d || 1 }); }
  }
  function monthName(loc, m) {
    // "May 2024" with the year cut: the standalone form ("Μάιος", not "Μαΐου")
    return fmt(loc, { month: "long", year: "numeric" }, { y: 2024, m: m, d: 1 }).replace(/[\s,]*2024[\s.г年]*/, "").trim();
  }
  function todayParts() {
    var t = new Date();
    return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate(), h: t.getHours(), mi: t.getMinutes(), s: t.getSeconds() };
  }
  var ICON_PREV = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_NEXT = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_EYE = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M14.5 4.5l5 5M17 2.5l4.5 4.5-3 3-4.5-4.5zM14 8l-9 9-1 3 3-1 9-9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

  function iconBtn(cls, label, svg) {
    var b = el("button", cls);
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.title = label;
    b.innerHTML = svg;
    return b;
  }

  function openDate(inp) {
    if (!supported || !eligibleDate(inp)) return false;
    if (cur) close(false);
    var S = strings(lang()), loc = locale(), type = inp.type;
    var hasDate = type !== "time", hasTime = type !== "date";
    var sheet = sheetMode(), name = fieldLabel(inp) || (hasDate ? S.date : S.time);
    var min = inp.min || "", max = inp.max || "";
    var steps = timeSteps(inp.getAttribute("step"));
    var now = todayParts();
    var picked = hasDate ? parseDate(inp.value) : null;
    var time = hasTime ? (parseTime(inp.value) || (type === "time" ? { h: now.h, mi: now.mi - now.mi % steps.miStep, s: 0 } : { h: 9, mi: 0, s: 0 })) : null;
    var anchor = picked || (dayAllowed(now, min, max) ? now : (parseDate(min) || parseDate(max) || now));
    var st = { y: anchor.y, m: anchor.m, focus: { y: anchor.y, m: anchor.m, d: anchor.d }, mode: "days", yearBase: anchor.y - anchor.y % 12 };

    var dlg = el("dialog", "opk opk-date" + (sheet ? " opk-sheet" : " opk-drop"));
    dlg.setAttribute("aria-label", name);
    dlg.style.fontFamily = pageFont(inp);
    var theme = doc.documentElement.getAttribute("data-theme");
    if (theme === "light" || theme === "dark") dlg.style.colorScheme = theme;
    if (sheet) {
      var head = el("div", "opk-head");
      head.appendChild(el("span", "opk-title", name));
      var x = iconBtn("opk-x", S.close, ICON_X);
      x.addEventListener("click", function () { close(true); });
      head.appendChild(x);
      dlg.appendChild(head);
    }
    var body = el("div", "opk-body");
    dlg.appendChild(body);

    // calendar
    var cal, title, grid, prevB, nextB;
    if (hasDate) {
      cal = el("div", "opk-cal");
      var nav = el("div", "opk-nav");
      prevB = iconBtn("opk-arrow", S.prev, ICON_PREV);
      nextB = iconBtn("opk-arrow", S.next, ICON_NEXT);
      title = el("button", "opk-ym");
      title.type = "button";
      title.setAttribute("aria-label", S.pickYear);
      title.setAttribute("aria-live", "polite");
      nav.appendChild(prevB); nav.appendChild(title); nav.appendChild(nextB);
      cal.appendChild(nav);
      grid = el("div", "opk-grid");
      cal.appendChild(grid);
      body.appendChild(cal);
      prevB.addEventListener("click", function () { step(-1); });
      nextB.addEventListener("click", function () { step(1); });
      title.addEventListener("click", function () {
        st.mode = st.mode === "days" ? "years" : "days";
        st.yearBase = st.y - st.y % 12;
        drawCal(true);
      });
    }

    // time columns
    var cols = [];
    if (hasTime) {
      var tw = el("div", "opk-time");
      tw.setAttribute("role", "group");
      tw.setAttribute("aria-label", S.time);
      var defs = [{ k: "h", n: 24, by: 1, label: S.hours }, { k: "mi", n: 60, by: steps.miStep, label: S.minutes }];
      if (steps.secs) defs.push({ k: "s", n: 60, by: steps.sStep, label: S.seconds });
      defs.forEach(function (d, ci) {
        if (ci) tw.appendChild(el("span", "opk-colon", ":"));
        var col = el("div", "opk-col");
        col.setAttribute("role", "listbox");
        col.setAttribute("aria-label", d.label);
        for (var v = 0; v < d.n; v += d.by) {
          var o = el("div", "opk-cell", pad(v));
          o.setAttribute("role", "option");
          o.setAttribute("data-v", String(v));
          col.appendChild(o);
        }
        col.tabIndex = 0;
        col.addEventListener("click", function (e) {
          var c = e.target.closest ? e.target.closest(".opk-cell") : null;
          if (!c) return;
          time[d.k] = +c.getAttribute("data-v");
          drawTime(false);
        });
        col.addEventListener("keydown", function (e) {
          var list = col.children, i = -1, k = e.key;
          for (var j = 0; j < list.length; j++) if (+list[j].getAttribute("data-v") === time[d.k]) i = j;
          var to = k === "ArrowDown" ? i + 1 : k === "ArrowUp" ? i - 1 : k === "PageDown" ? i + 6 : k === "PageUp" ? i - 6 : k === "Home" ? 0 : k === "End" ? list.length - 1 : null;
          if (to === null) return;
          e.preventDefault();
          to = Math.max(0, Math.min(list.length - 1, to));
          time[d.k] = +list[to].getAttribute("data-v");
          drawTime(false);
        });
        cols.push({ k: d.k, el: col });
        tw.appendChild(col);
      });
      body.appendChild(tw);
    }

    // buttons
    var foot = el("div", "opk-foot");
    var clearB = null;
    if (!inp.required) {
      clearB = el("button", "opk-btn opk-ghost", S.clear);
      clearB.type = "button";
      clearB.addEventListener("click", function () { commit(""); });
      foot.appendChild(clearB);
    }
    var nowB = el("button", "opk-btn opk-ghost", hasDate ? S.today : S.now);
    nowB.type = "button";
    nowB.addEventListener("click", function () {
      var t = todayParts();
      if (hasTime) { time = { h: t.h, mi: t.mi - t.mi % steps.miStep, s: steps.secs ? t.s - t.s % steps.sStep : 0 }; drawTime(true); }
      if (hasDate) {
        if (!dayAllowed(t, min, max)) { st.y = t.y; st.m = t.m; st.mode = "days"; drawCal(true); return; }
        picked = { y: t.y, m: t.m, d: t.d };
        st.y = t.y; st.m = t.m; st.focus = picked; st.mode = "days";
        if (!hasTime) { commit(isoDate(picked)); return; }
        drawCal(true);
      }
    });
    foot.appendChild(nowB);
    foot.appendChild(el("span", "opk-gap"));
    if (hasTime) {
      var doneB = el("button", "opk-btn opk-main", S.done);
      doneB.type = "button";
      doneB.addEventListener("click", function () {
        if (hasDate && !picked) { if (title) title.focus(); return; }
        var v = (hasDate ? isoDate(picked) : "") + (hasDate && hasTime ? "T" : "") + (hasTime ? isoTime(time, steps.secs) : "");
        commit(v);
      });
      foot.appendChild(doneB);
    }
    dlg.appendChild(foot);

    function commit(v) {
      v = clampValue(v, min, max);
      var changed = inp.value !== v;
      close(true);
      if (!changed) return;
      inp.value = v;
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
    }
    function step(k) {
      if (st.mode === "years") { st.yearBase += 12 * k; drawCal(true); return; }
      if (st.mode === "months") { st.y += k; drawCal(true); return; }
      var n = addMonths({ y: st.y, m: st.m, d: st.focus.d }, k);
      st.y = n.y; st.m = n.m; st.focus = n;
      drawCal(false);
    }
    function dayBtn(c) {
      var b = el("button", "opk-day", String(c.d));
      b.type = "button";
      b.setAttribute("role", "gridcell");
      b.setAttribute("data-d", isoDate(c));
      b.setAttribute("aria-label", fmt(loc, { weekday: "long", day: "numeric", month: "long", year: "numeric" }, c));
      if (c.out) b.classList.add("opk-out");
      if (sameDay(c, now)) { b.classList.add("opk-today"); b.setAttribute("aria-current", "date"); }
      if (sameDay(c, picked)) { b.classList.add("opk-on"); b.setAttribute("aria-selected", "true"); }
      if (!dayAllowed(c, min, max)) { b.disabled = true; b.setAttribute("aria-disabled", "true"); }
      b.tabIndex = sameDay(c, st.focus) ? 0 : -1;
      b.addEventListener("click", function () {
        picked = { y: c.y, m: c.m, d: c.d };
        if (!hasTime) { commit(isoDate(picked)); return; }
        st.focus = picked;
        if (c.out) { st.y = c.y; st.m = c.m; }
        drawCal(true);
      });
      return b;
    }
    function drawCal(keepFocusOnGrid) {
      if (!hasDate) return;
      grid.textContent = "";
      grid.className = "opk-grid opk-" + st.mode;
      var focusEl = null;
      if (st.mode === "days") {
        title.textContent = fmt(loc, { month: "long", year: "numeric" }, { y: st.y, m: st.m, d: 1 });
        prevB.setAttribute("aria-label", S.prev); prevB.title = S.prev;
        nextB.setAttribute("aria-label", S.next); nextB.title = S.next;
        grid.setAttribute("role", "grid");
        grid.setAttribute("aria-label", title.textContent);
        var hr = el("div", "opk-row opk-wd");
        hr.setAttribute("role", "row");
        for (var w = 0; w < 7; w++) {
          var wd = { y: 2024, m: 1, d: 1 + w };   // 2024-01-01 was a Monday
          var h = el("span", "opk-wday", fmt(loc, { weekday: "short" }, wd).replace(/\.$/, ""));
          h.setAttribute("role", "columnheader");
          h.setAttribute("aria-label", fmt(loc, { weekday: "long" }, wd));
          hr.appendChild(h);
        }
        grid.appendChild(hr);
        if (st.focus.y !== st.y || st.focus.m !== st.m) st.focus = { y: st.y, m: st.m, d: Math.min(st.focus.d, daysIn(st.y, st.m)) };
        var cells = monthGrid(st.y, st.m), row = null;
        cells.forEach(function (c, i) {
          if (i % 7 === 0) { row = el("div", "opk-row"); row.setAttribute("role", "row"); grid.appendChild(row); }
          var b = dayBtn(c);
          if (!c.out && sameDay(c, st.focus)) focusEl = b;
          row.appendChild(b);
        });
      } else if (st.mode === "years") {
        title.textContent = st.yearBase + " – " + (st.yearBase + 11);
        prevB.setAttribute("aria-label", S.prevY); prevB.title = S.prevY;
        nextB.setAttribute("aria-label", S.nextY); nextB.title = S.nextY;
        grid.setAttribute("role", "group");
        grid.setAttribute("aria-label", title.textContent);
        for (var y = st.yearBase; y < st.yearBase + 12; y++) (function (y) {
          var b = el("button", "opk-big", String(y));
          b.type = "button";
          if (y === st.y) { b.classList.add("opk-on"); focusEl = b; }
          if (y === now.y) b.classList.add("opk-today");
          var lo = parseDate(min), hi = parseDate(max);
          if ((lo && y < lo.y) || (hi && y > hi.y)) b.disabled = true;
          b.addEventListener("click", function () { st.y = y; st.mode = "months"; drawCal(true); });
          grid.appendChild(b);
        })(y);
      } else {
        title.textContent = String(st.y);
        prevB.setAttribute("aria-label", S.prevY); prevB.title = S.prevY;
        nextB.setAttribute("aria-label", S.nextY); nextB.title = S.nextY;
        grid.setAttribute("role", "group");
        grid.setAttribute("aria-label", title.textContent);
        for (var m = 1; m <= 12; m++) (function (m) {
          var b = el("button", "opk-big", monthName(loc, m));
          b.type = "button";
          if (m === st.m) { b.classList.add("opk-on"); focusEl = b; }
          var lo = parseDate(min), hi = parseDate(max), ym = st.y * 100 + m;
          if ((lo && ym < lo.y * 100 + lo.m) || (hi && ym > hi.y * 100 + hi.m)) b.disabled = true;
          b.addEventListener("click", function () { st.m = m; st.mode = "days"; st.focus = { y: st.y, m: m, d: Math.min(st.focus.d || 1, daysIn(st.y, m)) }; drawCal(true); });
          grid.appendChild(b);
        })(m);
      }
      if (keepFocusOnGrid === true && focusEl && dlg.open) focusEl.focus({ preventScroll: true });
      if (!sheet && dlg.open) place();
    }
    function drawTime(center) {
      cols.forEach(function (c) {
        var list = c.el.children, sel = list[0], j;
        // a value between the steps (09:07 with step 5) snaps to the step below
        for (j = 0; j < list.length; j++) if (+list[j].getAttribute("data-v") <= time[c.k]) sel = list[j];
        time[c.k] = +sel.getAttribute("data-v");
        for (j = 0; j < list.length; j++) {
          var on = list[j] === sel;
          list[j].setAttribute("aria-selected", on ? "true" : "false");
          list[j].classList.toggle("opk-on", on);
        }
        if (sel) {
          var top = sel.offsetTop - c.el.offsetTop, h = sel.offsetHeight, b = c.el;
          if (center) b.scrollTop = Math.max(0, top - (b.clientHeight - h) / 2);
          else if (top < b.scrollTop) b.scrollTop = top;
          else if (top + h > b.scrollTop + b.clientHeight) b.scrollTop = top + h - b.clientHeight;
        }
      });
    }

    // arrows move the focused day; PageUp/PageDown a month (Shift: a year)
    if (hasDate) grid.addEventListener("keydown", function (e) {
      if (st.mode !== "days") return;
      var k = e.key, d = 0;
      if (k === "ArrowRight") d = 1; else if (k === "ArrowLeft") d = -1;
      else if (k === "ArrowDown") d = 7; else if (k === "ArrowUp") d = -7;
      var f = st.focus, n = null;
      if (d) n = addDays(f, d);
      else if (k === "PageDown" || k === "PageUp") n = addMonths(f, (k === "PageDown" ? 1 : -1) * (e.shiftKey ? 12 : 1));
      else if (k === "Home") n = addDays(f, -weekday(f));
      else if (k === "End") n = addDays(f, 6 - weekday(f));
      if (!n) return;
      e.preventDefault();
      st.focus = n; st.y = n.y; st.m = n.m;
      drawCal(true);
    });

    cur = { sel: inp, dlg: dlg, sheet: sheet, minW: hasDate ? 300 : 220, kind: "big" };
    dlg.addEventListener("cancel", function (e) {
      e.preventDefault();
      if (hasDate && st.mode !== "days") { st.mode = "days"; drawCal(true); return; }
      close(true);
    });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) close(true); });
    ["input", "change", "keyup", "keypress"].forEach(function (t) {
      dlg.addEventListener(t, function (e) { e.stopPropagation(); });
    });

    (doc.body || doc.documentElement).appendChild(dlg);
    dlg.showModal();
    drawCal(null);
    drawTime(true);
    if (!sheet) place();
    var first = hasDate ? grid.querySelector(".opk-day[tabindex='0']") : (cols[0] && cols[0].el);
    if (first) first.focus({ preventScroll: true });
    win.addEventListener("resize", onResize);
    return true;
  }

  // ---------- colour (T3) ----------
  // <input type=color>: a saturation / brightness square, a hue bar, the
  // colour code, the page's own colours and a row of common ones (or the
  // field's <datalist>), and the screen eyedropper where the browser has
  // one. The field follows live ("input" on every move, as the browser
  // does), Done fires "change"; Cancel, Esc or a tap outside put the
  // first colour back.
  var COMMON = ["#000000", "#5f6368", "#ffffff", "#e53935", "#fb8c00", "#fdd835", "#43a047", "#00897b",
    "#1e88e5", "#3949ab", "#8e24aa", "#d81b60", "#6d4c41", "#d4af37"];

  function pageColours() {
    var out = [], cs;
    try { cs = win.getComputedStyle(doc.documentElement); } catch (e) { return out; }
    ["--accent", "--accent-hover", "--text", "--bg", "--panel-bg", "--danger"].forEach(function (v) {
      var h = cssHex(cs.getPropertyValue(v));
      if (h && out.indexOf(h) < 0) out.push(h);
    });
    return out;
  }
  // a computed CSS colour ("#abc", "rgb(…)") → "#rrggbb"; null for the rest
  function cssHex(v) {
    v = String(v || "").trim();
    var h = normHex(v);
    if (h) return h;
    var m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(v);
    if (!m || (m[4] && parseFloat(m[4]) < (m[4].indexOf("%") > 0 ? 100 : 1))) return null;
    return rgbToHex({ r: +m[1], g: +m[2], b: +m[3] });
  }

  function openColour(inp) {
    if (!supported || !eligibleColour(inp)) return false;
    if (cur) close(false);
    var S = strings(lang()), sheet = sheetMode(), name = fieldLabel(inp) || S.colour;
    var first = normHex(inp.value) || "#000000";
    var hsv = rgbToHsv(hexToRgb(first));

    var dlg = el("dialog", "opk opk-colour" + (sheet ? " opk-sheet" : " opk-drop"));
    dlg.setAttribute("aria-label", name);
    dlg.style.fontFamily = pageFont(inp);
    var theme = doc.documentElement.getAttribute("data-theme");
    if (theme === "light" || theme === "dark") dlg.style.colorScheme = theme;
    if (sheet) {
      var head = el("div", "opk-head");
      head.appendChild(el("span", "opk-title", name));
      var x = iconBtn("opk-x", S.close, ICON_X);
      x.addEventListener("click", function () { cancel(); });
      head.appendChild(x);
      dlg.appendChild(head);
    }
    var body = el("div", "opk-body");
    dlg.appendChild(body);

    var area = el("div", "opk-sv");
    area.setAttribute("role", "slider");
    area.setAttribute("aria-label", S.shade);
    area.tabIndex = 0;
    var dot = el("span", "opk-sv-dot");
    area.appendChild(dot);
    body.appendChild(area);

    var hue = el("div", "opk-hue");
    hue.setAttribute("role", "slider");
    hue.setAttribute("aria-label", S.hue);
    hue.setAttribute("aria-valuemin", "0");
    hue.setAttribute("aria-valuemax", "360");
    hue.tabIndex = 0;
    var knob = el("span", "opk-hue-knob");
    hue.appendChild(knob);
    body.appendChild(hue);

    var row = el("div", "opk-crow");
    var prev = el("span", "opk-chip opk-now");
    prev.setAttribute("aria-hidden", "true");
    row.appendChild(prev);
    var hex = el("input", "opk-hex");
    hex.type = "text";
    hex.setAttribute("aria-label", S.hex);
    hex.setAttribute("autocomplete", "off");
    hex.setAttribute("spellcheck", "false");
    hex.setAttribute("maxlength", "7");
    hex.setAttribute("inputmode", "text");
    row.appendChild(hex);
    if (typeof win.EyeDropper === "function") {
      var eye = iconBtn("opk-arrow opk-eye", S.eyedrop, ICON_EYE);
      eye.addEventListener("click", function () {
        try {
          new win.EyeDropper().open().then(function (r) {
            var h = normHex(r && r.sRGBHex) || cssHex(r && r.sRGBHex);
            if (h) setHex(h, true);
          }, function () {});
        } catch (e) {}
      });
      row.appendChild(eye);
    }
    body.appendChild(row);

    var sw = el("div", "opk-swatches");
    sw.setAttribute("role", "group");
    sw.setAttribute("aria-label", S.swatches);
    var list = [];
    if (inp.list && inp.list.options) for (var i = 0; i < inp.list.options.length; i++) {
      var h0 = normHex(inp.list.options[i].value);
      if (h0 && list.indexOf(h0) < 0) list.push(h0);
    }
    if (!list.length) pageColours().concat(COMMON).forEach(function (h) { if (list.indexOf(h) < 0) list.push(h); });
    list.slice(0, 21).forEach(function (h) {
      var b = el("button", "opk-chip");
      b.type = "button";
      b.style.background = h;
      b.setAttribute("aria-label", h);
      b.title = h;
      b.setAttribute("data-hex", h);
      b.addEventListener("click", function () { setHex(h, true); });
      sw.appendChild(b);
    });
    body.appendChild(sw);

    var foot = el("div", "opk-foot");
    var cancelB = el("button", "opk-btn opk-ghost", S.cancel);
    cancelB.type = "button";
    cancelB.addEventListener("click", function () { cancel(); });
    foot.appendChild(cancelB);
    foot.appendChild(el("span", "opk-gap"));
    var doneB = el("button", "opk-btn opk-main", S.done);
    doneB.type = "button";
    doneB.addEventListener("click", function () { done(); });
    foot.appendChild(doneB);
    dlg.appendChild(foot);

    function current() { return rgbToHex(hsvToRgb(hsv)); }
    function paint(skipHex) {
      var h = current();
      area.style.backgroundColor = rgbToHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 }));
      dot.style.left = (hsv.s * 100) + "%";
      dot.style.top = ((1 - hsv.v) * 100) + "%";
      dot.style.background = h;
      area.setAttribute("aria-valuetext", Math.round(hsv.s * 100) + "%, " + Math.round(hsv.v * 100) + "% · " + h);
      knob.style.left = (hsv.h / 360 * 100) + "%";
      knob.style.background = rgbToHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 }));
      hue.setAttribute("aria-valuenow", String(Math.round(hsv.h)));
      prev.style.background = h;
      if (!skipHex) hex.value = h;
      var chips = sw.children;
      for (var j = 0; j < chips.length; j++) chips[j].setAttribute("aria-pressed", chips[j].getAttribute("data-hex") === h ? "true" : "false");
    }
    function live() {
      var h = current();
      if (inp.value === h) return;
      inp.value = h;
      inp.dispatchEvent(new Event("input", { bubbles: true }));
    }
    function setHex(h, fromChip) {
      var c = hexToRgb(h);
      if (!c) return;
      var n = rgbToHsv(c);
      if (!n.s || !n.v) n.h = hsv.h;   // grey or black keeps the hue it had
      hsv = n;
      paint(!fromChip);
      live();
    }
    function drag(target, fn) {
      target.addEventListener("pointerdown", function (e) {
        if (e.button) return;
        e.preventDefault();
        target.focus({ preventScroll: true });
        try { target.setPointerCapture(e.pointerId); } catch (err) {}
        fn(e);
        function mv(ev) { fn(ev); }
        function up() {
          target.removeEventListener("pointermove", mv);
          target.removeEventListener("pointerup", up);
          target.removeEventListener("pointercancel", up);
        }
        target.addEventListener("pointermove", mv);
        target.addEventListener("pointerup", up);
        target.addEventListener("pointercancel", up);
      });
    }
    function clamp01(v) { return Math.max(0, Math.min(1, v)); }
    drag(area, function (e) {
      var r = area.getBoundingClientRect();
      hsv.s = clamp01((e.clientX - r.left) / r.width);
      hsv.v = 1 - clamp01((e.clientY - r.top) / r.height);
      paint(); live();
    });
    drag(hue, function (e) {
      var r = hue.getBoundingClientRect();
      hsv.h = clamp01((e.clientX - r.left) / r.width) * 359.9;
      paint(); live();
    });
    area.addEventListener("keydown", function (e) {
      var d = e.shiftKey ? 0.1 : 0.01, k = e.key;
      if (k === "ArrowRight") hsv.s = clamp01(hsv.s + d);
      else if (k === "ArrowLeft") hsv.s = clamp01(hsv.s - d);
      else if (k === "ArrowUp") hsv.v = clamp01(hsv.v + d);
      else if (k === "ArrowDown") hsv.v = clamp01(hsv.v - d);
      else return;
      e.preventDefault(); paint(); live();
    });
    hue.addEventListener("keydown", function (e) {
      var d = e.shiftKey ? 30 : 3, k = e.key;
      if (k === "ArrowRight" || k === "ArrowUp") hsv.h = Math.min(359.9, hsv.h + d);
      else if (k === "ArrowLeft" || k === "ArrowDown") hsv.h = Math.max(0, hsv.h - d);
      else if (k === "Home") hsv.h = 0;
      else if (k === "End") hsv.h = 359.9;
      else return;
      e.preventDefault(); paint(); live();
    });
    hex.addEventListener("input", function () {
      var h = normHex(hex.value);
      hex.setAttribute("aria-invalid", h ? "false" : "true");
      if (h) setHex(h, false);
    });
    hex.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); done(); } });
    hex.addEventListener("blur", function () { hex.value = current(); hex.removeAttribute("aria-invalid"); });

    function done() {
      live();
      var changed = current() !== first;
      close(true);
      if (changed) inp.dispatchEvent(new Event("change", { bubbles: true }));
    }
    function cancel() {
      var was = inp.value !== first;
      close(true);
      if (was) {
        inp.value = first;
        inp.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }

    dlg.addEventListener("keydown", function () { dlg.classList.add("opk-kb"); });
    cur = { sel: inp, dlg: dlg, sheet: sheet, minW: 280, kind: "big" };
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); cancel(); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) cancel(); });
    ["input", "change", "keyup", "keypress"].forEach(function (t) {
      dlg.addEventListener(t, function (e) { e.stopPropagation(); });
    });
    (doc.body || doc.documentElement).appendChild(dlg);
    dlg.showModal();
    paint();
    if (!sheet) place();
    area.focus({ preventScroll: true });
    win.addEventListener("resize", onResize);
    return true;
  }

  // ---------- questions (T4, R14) ----------
  // OrosPick.ask({ text, title?, value?, ok?, cancel?, danger?, input?,
  // max? }) → Promise: true / false for a yes-no question, the typed
  // text / null when `input` (or `value`) is given. The themed twin of
  // confirm() and prompt(), which R14 bans: centred (R32), Esc and a tap
  // outside answer "no", Enter answers "yes". Texts are set with
  // textContent only.
  function ask(o) {
    o = o || {};
    return new Promise(function (resolve) {
      if (!supported) { resolve(o.input || o.value != null ? null : false); return; }
      if (cur) close(false);
      var S = strings(lang()), withInput = !!o.input || o.value != null;
      var dlg = el("dialog", "opk opk-ask");
      dlg.setAttribute("role", "alertdialog");
      dlg.style.fontFamily = pageFont(doc.body || doc.documentElement);
      var theme = doc.documentElement.getAttribute("data-theme");
      if (theme === "light" || theme === "dark") dlg.style.colorScheme = theme;
      var id = "opk" + (++uid);
      var body = el("div", "opk-body");
      if (o.title) { var h = el("h2", "opk-ask-h", String(o.title)); h.id = id + "-h"; body.appendChild(h); dlg.setAttribute("aria-labelledby", h.id); }
      var p = el("p", "opk-ask-t", String(o.text || ""));
      p.id = id + "-t";
      body.appendChild(p);
      if (o.title) dlg.setAttribute("aria-describedby", p.id); else dlg.setAttribute("aria-labelledby", p.id);
      var field = null;
      if (withInput) {
        field = el("input", "opk-hex opk-ask-in");
        field.type = "text";
        field.value = o.value == null ? "" : String(o.value);
        if (o.max) field.maxLength = o.max;
        field.setAttribute("aria-labelledby", p.id);
        field.setAttribute("autocomplete", "off");
        body.appendChild(field);
      }
      dlg.appendChild(body);
      var foot = el("div", "opk-foot");
      foot.appendChild(el("span", "opk-gap"));
      var no = el("button", "opk-btn opk-ghost", o.cancel || S.cancel);
      no.type = "button";
      var yes = el("button", "opk-btn opk-main" + (o.danger ? " opk-danger" : ""), o.ok || S.ok);
      yes.type = "button";
      foot.appendChild(no); foot.appendChild(yes);
      dlg.appendChild(foot);
      var done = false;
      function answer(v) {
        if (done) return;
        done = true;
        close(true);
        resolve(v);
      }
      no.addEventListener("click", function () { answer(withInput ? null : false); });
      yes.addEventListener("click", function () { answer(withInput ? field.value : true); });
      dlg.addEventListener("cancel", function (e) { e.preventDefault(); answer(withInput ? null : false); });
      dlg.addEventListener("click", function (e) { if (e.target === dlg) answer(withInput ? null : false); });
      dlg.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && e.target !== no) { e.preventDefault(); yes.click(); }
      });
      ["input", "change", "keyup", "keypress"].forEach(function (t) {
        dlg.addEventListener(t, function (e) { e.stopPropagation(); });
      });
      var back = doc.activeElement;
      (doc.body || doc.documentElement).appendChild(dlg);
      cur = { sel: back && back.focus ? back : (doc.body || doc.documentElement), dlg: dlg, sheet: true, kind: "ask",
        cancelAsk: function () { answer(withInput ? null : false); } };
      dlg.showModal();
      if (field) { field.focus(); field.select(); } else (o.danger ? no : yes).focus();
    });
  }

  var FIELDS = 'select, input[type="date"], input[type="time"], input[type="datetime-local"], input[type="color"]';
  function openAny(n) { return n.tagName === "SELECT" ? open(n) : n.type === "color" ? openColour(n) : openDate(n); }

  return { VERSION: VERSION, open: openAny, ask: ask, close: function () { close(true); },
    isOpen: function () { return !!cur; }, eligible: eligibleAny, FIELDS: FIELDS,
    fold: fold, matches: matches, nextIndex: nextIndex, jumpIndex: jumpIndex,
    strings: strings, STR: STR, parseDate: parseDate, parseTime: parseTime,
      isoDate: isoDate, isoTime: isoTime, daysIn: daysIn, addDays: addDays, addMonths: addMonths,
      weekday: weekday, monthGrid: monthGrid, dayAllowed: dayAllowed, clampValue: clampValue,
      timeSteps: timeSteps, sameDay: sameDay,
      normHex: normHex, hexToRgb: hexToRgb, rgbToHex: rgbToHex, rgbToHsv: rgbToHsv, hsvToRgb: hsvToRgb };
});
