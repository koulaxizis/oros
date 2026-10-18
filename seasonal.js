// ============================================================
// orOS — seasonal.js (seasonal desktop decorations, v1.2.0)
// ------------------------------------------------------------
// A shell component, like pet.js and launcher.js: it runs IN the
// shell document, keeps its own storage and registers its own sync
// slice. shell.js calls attach() once at boot and refresh() when an
// app opens or closes, the theme or the language changes. A bundle
// without this file draws exactly what it drew before.
//
//   • In the right season the desktop gets a decoration: snow,
//     lights and a tree at Christmas, fireworks at New Year,
//     pumpkins, bats and a web at Halloween (1.0.0); the Greek feasts
//     (1.1.0): Epiphany, Valentine's Day, Carnival, Clean Monday,
//     25 March, Easter, May Day, 28 October. Movable ones count from
//     Orthodox Easter, computed here. ON by default. 1.2.0: the four
//     seasons (OFF by default), my birthday (once its date is set) and
//     Easter on the Western date for those who keep it.
//   • It sits over the wallpaper and UNDER the desktop's icons
//     (z-index -1 inside #oros-desktop, like the live wallpaper)
//     and never takes a click (pointer-events: none).
//   • Settings › Appearance › Seasonal decorations: a main switch,
//     motion (auto / still), amount, the Christmas piece (tree or
//     boat) and one switch + "Try it now" per event.
//   • "Try it now" shows an event at once with a small bar on the
//     desktop: Keep it (stays until the event's period ends) · Stop.
//
// Data (synced, slice "seasonal", key oros-seasonal):
//   { ver:1, f:{ <field>: { v, t } } }   fields sorted by name
//   • on, motion ("auto"|"still"), amount ("low"|"mid"|"high"),
//     xmas ("tree"|"boat"), easter ("orthodox"|"western"),
//     bday ("MM-DD" or ""), "ev.<id>" (event switch, boolean);
//   • t = ms of the user's change to THAT field (stamped at the
//     mutation site only). Merge: per field the higher t wins, a tie
//     goes to the greater JSON. A field this bundle does not know
//     (an event added by a newer bundle) is kept as it is.
//   • A fresh device stores nothing until the first real change, and
//     nothing is ever written because of the date: which event shows
//     is computed every time.
// Device-local (oros-seasonal-local, never synced):
//   { keep: { id, until: "YYYY-MM-DD" } | null, hide: "YYYY-MM-DD" | null }
//   A preview that was not kept lives in memory only.
//
// Performance: one canvas for moving things, static SVG for the
// rest, at most 30 frames a second, paused while an app is open or
// the tab is hidden. Reduced motion, a low battery (where the
// browser tells) or a frame rate that keeps dropping leave only the
// still pieces. Weak devices get half the particles. Every drawing
// is our own; no images, fonts or libraries, nothing from the net.
// Pure logic (dates, events, fields, merge) is unit-tested in node
// (tests/seasonal.test.js).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.2.1";
  var DATA_KEY = "oros-seasonal";
  var LOCAL_KEY = "oros-seasonal-local";
  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
  var FIELD_RE = /^[a-z][a-z0-9]{0,15}(\.[a-z0-9]{1,24})?$/;
  var MAX_FIELDS = 120;

  // ---------- 1. Dates (pure) ----------
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isYmd(s) { return typeof s === "string" && YMD_RE.test(s); }
  function ymdOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function dayNum(s) {
    return Math.floor(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
  }
  function fromDay(n) {
    var d = new Date(n * 86400000);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }
  function addDays(s, n) { return fromDay(dayNum(s) + n); }

  // Orthodox Easter (Meeus, Julian calendar + 13 days, valid 1900-2099),
  // the same as calendar/namedays.js. Movable feasts count from it.
  function orthodoxEaster(year) {
    var a = year % 4, b = year % 7, c = year % 19;
    var d = (19 * c + 15) % 30;
    var e = (2 * a + 4 * b - d + 34) % 7;
    var month = Math.floor((d + e + 114) / 31);
    var day = ((d + e + 114) % 31) + 1;
    return addDays(year + "-" + pad(month) + "-" + pad(day), 13);
  }

  // Western (Gregorian) Easter, the anonymous Gregorian algorithm.
  function westernEaster(year) {
    var a = year % 19, b = Math.floor(year / 100), c = year % 100;
    var d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return year + "-" + pad(month) + "-" + pad(day);
  }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  // "MM-DD" of a real day (29 Feb allowed), or "" = not set.
  function bdayOk(v) {
    if (v === "") return true;
    if (typeof v !== "string" || !/^\d\d-\d\d$/.test(v)) return false;
    var m = +v.slice(0, 2), d = +v.slice(3);
    return m >= 1 && m <= 12 && d >= 1 && d <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }

  // ---------- 2. Events (pure) ----------
  // win(year, opt) = [first, last] day (inclusive) of the period that
  // STARTS in that year, or null (a birthday not set). opt = the user's
  // choices that move dates: { western, bday } (see optOf).
  // prio: the higher wins when two overlap.
  // Movable feasts count from Orthodox Easter (ez); Easter itself can
  // follow the Western date (1.2.0). Seasons, OFF by default, lose to
  // every feast; a birthday wins over everything.
  function ez(y, from, to) {
    var e = orthodoxEaster(y);
    return [addDays(e, from), addDays(e, to)];
  }
  var EVENTS = [
    { id: "epiphany", en: "Epiphany", prio: 3, def: true,
      win: function (y) { return [y + "-01-05", y + "-01-06"]; } },
    { id: "valentine", en: "Valentine's Day", prio: 4, def: true,   // its 2 days beat Carnival
      win: function (y) { return [y + "-02-13", y + "-02-14"]; } },
    { id: "carnival", en: "Carnival", prio: 3, def: true,
      win: function (y) { return ez(y, -59, -49); } },          // Tsiknopempti to Cheesefare Sunday
    { id: "cleanmon", en: "Clean Monday", prio: 4, def: true,
      win: function (y) { return ez(y, -48, -48); } },
    { id: "mar25", en: "25 March", prio: 3, def: true,
      win: function (y) { return [y + "-03-24", y + "-03-25"]; } },
    { id: "easter", en: "Easter", prio: 4, def: true,
      win: function (y, opt) {                                   // Holy Thursday to Easter Monday
        if (opt && opt.western) { var e = westernEaster(y); return [addDays(e, -3), addDays(e, 1)]; }
        return ez(y, -3, 1);
      } },
    { id: "mayday", en: "May Day", prio: 2, def: true,
      win: function (y) { return [y + "-04-30", y + "-05-01"]; } },
    { id: "xmas", en: "Christmas", prio: 2, def: true,
      win: function (y) { return [y + "-12-01", y + "-12-30"]; } },
    { id: "newyear", en: "New Year", prio: 3, def: true,
      win: function (y) { return [y + "-12-31", (y + 1) + "-01-02"]; } },
    { id: "halloween", en: "Halloween", prio: 2, def: true,
      win: function (y) { return [y + "-10-25", y + "-10-31"]; } },
    { id: "oct28", en: "28 October", prio: 3, def: true,
      win: function (y) { return [y + "-10-27", y + "-10-28"]; } },
    { id: "birthday", en: "My birthday", prio: 5, def: true,
      win: function (y, opt) {
        var b = opt && opt.bday;
        if (!b) return null;
        if (b === "02-29" && !isLeap(y)) b = "02-28";
        return [y + "-" + b, y + "-" + b];
      } },
    { id: "spring", en: "Spring", prio: 1, def: false, season: true,
      win: function (y) { return [y + "-03-20", y + "-06-20"]; } },
    { id: "summer", en: "Summer", prio: 1, def: false, season: true,
      win: function (y) { return [y + "-06-21", y + "-09-22"]; } },
    { id: "autumn", en: "Autumn", prio: 1, def: false, season: true,
      win: function (y) { return [y + "-09-23", y + "-11-30"]; } },
    { id: "winter", en: "Winter", prio: 1, def: false, season: true,
      win: function (y) { return [y + "-01-01", y + "-03-19"]; } }
  ];

  function eventById(id) {
    for (var i = 0; i < EVENTS.length; i++) if (EVENTS[i].id === id) return EVENTS[i];
    return null;
  }

  // The period of `ev` that contains day `s`, or null.
  function windowAt(ev, s, opt) {
    var y = +s.slice(0, 4);
    for (var k = y; k >= y - 1; k--) {
      var w = ev.win(k, opt);
      if (w && s >= w[0] && s <= w[1]) return w;
    }
    return null;
  }

  // The period that contains `s`, else the next one to start (null
  // when the event has no date, like a birthday not set).
  function nextWindow(ev, s, opt) {
    var at = windowAt(ev, s, opt);
    if (at) return at;
    var y = +s.slice(0, 4);
    for (var k = y; k <= y + 1; k++) {
      var w = ev.win(k, opt);
      if (w && w[0] > s) return w;
    }
    return ev.win(y + 1, opt);
  }

  // Events on day `s` that `enabled(id)` allows, highest priority first.
  function activeOn(s, enabled, opt) {
    return EVENTS.filter(function (ev) {
      return windowAt(ev, s, opt) && (!enabled || enabled(ev.id));
    }).sort(function (a, b) { return b.prio - a.prio || (a.id < b.id ? -1 : 1); });
  }

  // ---------- 3. Settings fields (pure) ----------
  var FIELDS = {
    on:     { def: true,   ok: function (v) { return typeof v === "boolean"; } },
    motion: { def: "auto", ok: function (v) { return v === "auto" || v === "still"; } },
    amount: { def: "mid",  ok: function (v) { return v === "low" || v === "mid" || v === "high"; } },
    xmas:   { def: "tree", ok: function (v) { return v === "tree" || v === "boat"; } },
    easter: { def: "orthodox", ok: function (v) { return v === "orthodox" || v === "western"; } },
    bday:   { def: "", ok: bdayOk }
  };
  function fieldSpec(key) {
    if (Object.prototype.hasOwnProperty.call(FIELDS, key)) return FIELDS[key];
    if (key.indexOf("ev.") === 0) {
      var ev = eventById(key.slice(3));
      return { def: ev ? ev.def : false, ok: function (v) { return typeof v === "boolean"; } };
    }
    return null;
  }
  // A value another bundle may know: small primitives only.
  function foreignOk(v) {
    return typeof v === "boolean" || (typeof v === "string" && v.length <= 24) ||
           (typeof v === "number" && isFinite(v));
  }

  // The single funnel: load, save, merge output, slice get and set.
  function normalize(data) {
    var src = (data && typeof data === "object" && data.f && typeof data.f === "object") ? data.f : {};
    var keys = Object.keys(src).filter(function (k) { return FIELD_RE.test(k); }).sort();
    if (keys.length > MAX_FIELDS) keys = keys.slice(0, MAX_FIELDS);
    var f = {};
    keys.forEach(function (k) {
      var e = src[k];
      if (!e || typeof e !== "object") return;
      var spec = fieldSpec(k);
      if (spec ? !spec.ok(e.v) : !foreignOk(e.v)) return;
      var t = (typeof e.t === "number" && isFinite(e.t) && e.t >= 0) ? Math.floor(e.t) : 0;
      f[k] = { v: e.v, t: t };
    });
    return { ver: 1, f: f };
  }

  function get(data, key) {
    var e = data.f[key], spec = fieldSpec(key);
    if (e && (!spec || spec.ok(e.v))) return e.v;
    return spec ? spec.def : undefined;
  }

  // A new copy with one field changed (or the same object when the
  // value is invalid or already there).
  function setField(data, key, v, now) {
    var spec = fieldSpec(key);
    if (!spec || !spec.ok(v)) return data;
    var cur = data.f[key];
    if (cur && cur.v === v) return data;
    var f = {};
    Object.keys(data.f).forEach(function (k) { f[k] = data.f[k]; });
    f[key] = { v: v, t: Math.max(now, cur ? cur.t + 1 : 0) };
    return normalize({ f: f });
  }

  function merge(a, b) {
    var A = normalize(a), B = normalize(b), f = {};
    Object.keys(A.f).concat(Object.keys(B.f)).forEach(function (k) {
      var p = A.f[k], q = B.f[k];
      if (!p || !q) { f[k] = p || q; return; }
      if (p.t !== q.t) f[k] = p.t > q.t ? p : q;
      else f[k] = JSON.stringify(p) >= JSON.stringify(q) ? p : q;
    });
    return normalize({ f: f });
  }

  // Device-local part.
  function normLocal(x) {
    x = (x && typeof x === "object") ? x : {};
    var k = x.keep;
    var keep = (k && typeof k === "object" && eventById(k.id) && isYmd(k.until)) ? { id: k.id, until: k.until } : null;
    return { keep: keep, hide: isYmd(x.hide) ? x.hide : null };
  }

  // The choices that move dates.
  function optOf(data) {
    return { western: get(data, "easter") === "western", bday: get(data, "bday") };
  }

  // What shows on day `s`: { id, mode: "preview"|"kept"|"auto" } or null.
  function pick(data, local, s, preview) {
    if (preview && eventById(preview)) return { id: preview, mode: "preview" };
    if (local.keep && s <= local.keep.until) return { id: local.keep.id, mode: "kept" };
    if (!get(data, "on") || local.hide === s) return null;
    var list = activeOn(s, function (id) { return get(data, "ev." + id) === true; }, optOf(data));
    return list.length ? { id: list[0].id, mode: "auto" } : null;
  }

  var model = {
    EVENTS: EVENTS, orthodoxEaster: orthodoxEaster, westernEaster: westernEaster, addDays: addDays, optOf: optOf,
    windowAt: windowAt, nextWindow: nextWindow, activeOn: activeOn,
    normalize: normalize, get: get, setField: setField, merge: merge,
    normLocal: normLocal, pick: pick, eventById: eventById
  };

  if (typeof module !== "undefined" && module.exports) { module.exports = model; }
  if (typeof document === "undefined") return;     // node: the model only

  // ---------- 4. Storage + sync ----------
  var cache = null;
  function load() {
    if (cache) return cache;
    var raw = null, parsed = null;
    try { raw = root.localStorage.getItem(DATA_KEY); } catch (e) {}
    if (raw) {
      try { parsed = JSON.parse(raw); }
      catch (e) { try { root.localStorage.setItem(DATA_KEY + "-broken", raw); } catch (e2) {} }
    }
    cache = normalize(parsed);
    return cache;
  }
  function store(d) {
    cache = normalize(d);
    try { root.localStorage.setItem(DATA_KEY, JSON.stringify(cache)); } catch (e) {}
  }
  function loadLocal() {
    try { return normLocal(JSON.parse(root.localStorage.getItem(LOCAL_KEY))); }
    catch (e) { return normLocal(null); }
  }
  function storeLocal(x) {
    x = normLocal(x);
    try {
      if (!x.keep && !x.hide) root.localStorage.removeItem(LOCAL_KEY);
      else root.localStorage.setItem(LOCAL_KEY, JSON.stringify(x));
    } catch (e) {}
  }

  function sliceGet() {
    var raw = null;
    try { raw = root.localStorage.getItem(DATA_KEY); } catch (e) {}
    if (!raw) return null;     // nothing yet: a fresh device sends nothing
    return load();
  }
  function sliceSet(data) {
    if (!data) return;
    store(data);               // no markDirty: pulled data must not re-push
    update();
    changed();
  }

  // ---------- 5. Host + environment ----------
  var host = null;
  var preview = null;          // event id shown by "Try it now" (memory only)
  var previewAt = 0;
  var lowBattery = false;
  var weak = false;
  var mqReduce = null;

  // Strings come from the shell's table (translations.js, "ssn.*",
  // German from i18n/<code>/shell.js); English when it is not there.
  function tx(key, fb, vars) {
    var f = root && root.t, v = typeof f === "function" ? f(key) : key;
    if (v === key || typeof v !== "string") v = fb;
    if (vars) Object.keys(vars).forEach(function (k) { v = v.split("{" + k + "}").join(String(vars[k])); });
    return v;
  }
  function name(ev) { return tx("ssn.ev." + ev.id, ev.en); }
  function running() { return !!(host && host.running && host.running()); }
  function changed() { if (host && typeof host.changed === "function") { try { host.changed(); } catch (e) {} } }
  function today() { return ymdOf(new Date()); }
  function reduced() { return !!(mqReduce && mqReduce.matches); }

  // ---------- 6. Still pieces (static SVG, our own drawings) ----------
  var SVG_NS = 'xmlns="http://www.w3.org/2000/svg"';
  var TREE = '<svg ' + SVG_NS + ' viewBox="0 0 100 130" aria-hidden="true">' +
    '<rect x="43" y="108" width="14" height="18" rx="2" fill="#7a4a24"/>' +
    '<polygon points="50,20 84,72 16,72" fill="#1f7a3a"/>' +
    '<polygon points="50,38 92,96 8,96" fill="#23893f"/>' +
    '<polygon points="50,58 98,112 2,112" fill="#2a9a4a"/>' +
    '<path d="M24 70 Q50 82 76 66 M16 94 Q50 108 86 90" fill="none" stroke="#f3c64a" stroke-width="2" opacity=".8"/>' +
    '<g class="ssn-tw">' +
    '<circle cx="34" cy="64" r="4" fill="#e53935"/><circle cx="62" cy="58" r="4" fill="#42a5f5"/>' +
    '<circle cx="46" cy="84" r="4" fill="#fdd835"/><circle cx="74" cy="86" r="4" fill="#e53935"/>' +
    '<circle cx="24" cy="100" r="4" fill="#42a5f5"/><circle cx="56" cy="104" r="4" fill="#ab47bc"/>' +
    '<circle cx="82" cy="106" r="4" fill="#fdd835"/></g>' +
    '<polygon class="ssn-star" points="50,4 54,15 66,15 56,22 60,33 50,26 40,33 44,22 34,15 46,15" fill="#ffd54f"/>' +
    '</svg>';
  // The Greek Christmas boat (karavaki) with its string of lights.
  var BOAT = '<svg ' + SVG_NS + ' viewBox="0 0 120 110" aria-hidden="true">' +
    '<path d="M58 14 L58 78" stroke="#8d6e63" stroke-width="3"/>' +
    '<path d="M61 18 L98 72 L61 72 Z" fill="#f5f5f5" stroke="#cfd8dc"/>' +
    '<path d="M55 26 L26 72 L55 72 Z" fill="#e3f2fd" stroke="#cfd8dc"/>' +
    '<path d="M8 80 L112 80 L96 100 L22 100 Z" fill="#1565c0"/>' +
    '<path d="M12 85 L108 85" stroke="#fff" stroke-width="3"/>' +
    '<path d="M58 12 L6 78 M58 12 L114 78" stroke="#ffe082" stroke-width="1" fill="none"/>' +
    '<g class="ssn-tw">' +
    '<circle cx="45" cy="28" r="2.6" fill="#ffd54f"/><circle cx="32" cy="44" r="2.6" fill="#ef5350"/>' +
    '<circle cx="19" cy="61" r="2.6" fill="#66bb6a"/><circle cx="71" cy="28" r="2.6" fill="#42a5f5"/>' +
    '<circle cx="84" cy="44" r="2.6" fill="#ffd54f"/><circle cx="98" cy="61" r="2.6" fill="#ef5350"/></g>' +
    '<path d="M58 6 L72 10 L58 14 Z" fill="#1565c0"/>' +
    '</svg>';
  // A pomegranate, the Greek New Year's luck.
  var POMEGRANATE = '<svg ' + SVG_NS + ' viewBox="0 0 100 110" aria-hidden="true">' +
    '<path d="M40 20 L44 8 L50 18 L56 8 L60 20 Z" fill="#b71c1c"/>' +
    '<circle cx="50" cy="62" r="40" fill="#c62828"/>' +
    '<ellipse cx="36" cy="48" rx="10" ry="16" fill="#ef5350" opacity=".45" transform="rotate(-25 36 48)"/>' +
    '<path d="M62 22 Q80 6 92 18 Q78 30 62 22 Z" fill="#43a047"/>' +
    '<g class="ssn-tw"><path d="M14 18 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2 Z" fill="#ffd54f"/>' +
    '<path d="M86 52 l1.6 5 5 1.6 -5 1.6 -1.6 5 -1.6 -5 -5 -1.6 5 -1.6 Z" fill="#ffe082"/></g>' +
    '</svg>';
  var PUMPKINS = '<svg ' + SVG_NS + ' viewBox="0 0 150 90" aria-hidden="true">' +
    '<g transform="translate(6 18)">' +
    '<path d="M38 6 Q40 0 46 2" stroke="#4e7d2e" stroke-width="5" fill="none"/>' +
    '<ellipse cx="40" cy="40" rx="38" ry="31" fill="#ef6c00"/>' +
    '<ellipse cx="40" cy="40" rx="20" ry="31" fill="#f57c00"/>' +
    '<ellipse cx="40" cy="40" rx="6" ry="31" fill="#fb8c00"/>' +
    '<g class="ssn-glow" fill="#ffeb3b"><polygon points="22,32 32,32 27,22"/><polygon points="48,32 58,32 53,22"/>' +
    '<path d="M18 46 L26 52 L32 46 L40 54 L48 46 L54 52 L62 46 Q40 66 18 46 Z"/></g></g>' +
    '<g transform="translate(86 38) scale(.72)">' +
    '<path d="M38 6 Q40 0 46 2" stroke="#4e7d2e" stroke-width="5" fill="none"/>' +
    '<ellipse cx="40" cy="40" rx="38" ry="31" fill="#e65100"/>' +
    '<ellipse cx="40" cy="40" rx="18" ry="31" fill="#ef6c00"/>' +
    '<g class="ssn-glow" fill="#ffee58"><circle cx="27" cy="32" r="6"/><circle cx="53" cy="32" r="6"/>' +
    '<ellipse cx="40" cy="52" rx="12" ry="5"/></g></g>' +
    '</svg>';
  function web(stroke) {
    var s = '<svg ' + SVG_NS + ' viewBox="0 0 120 120" aria-hidden="true"><g fill="none" stroke="' + stroke + '" stroke-width="1">';
    var cx = 120, cy = 0, i, r, a;
    for (i = 0; i <= 6; i++) {
      a = Math.PI / 2 + (Math.PI / 2) * i / 6;
      s += '<path d="M' + cx + ' ' + cy + ' L' + (cx + Math.cos(a) * 130).toFixed(1) + ' ' + (cy + Math.sin(a) * 130).toFixed(1) + '"/>';
    }
    for (r = 22; r <= 112; r += 18) {
      var d = "";
      for (i = 0; i <= 6; i++) {
        a = Math.PI / 2 + (Math.PI / 2) * i / 6;
        var x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) d += "M" + x.toFixed(1) + " " + y.toFixed(1);
        else {
          var am = Math.PI / 2 + (Math.PI / 2) * (i - 0.5) / 6, rm = r * 0.9;
          d += " Q" + (cx + Math.cos(am) * rm).toFixed(1) + " " + (cy + Math.sin(am) * rm).toFixed(1) + " " + x.toFixed(1) + " " + y.toFixed(1);
        }
      }
      s += '<path d="' + d + '"/>';
    }
    s += '</g><g class="ssn-spider"><path d="M86 0 L86 54" stroke="' + stroke + '" stroke-width="1"/>' +
      '<ellipse cx="86" cy="60" rx="5" ry="6.5" fill="#212121"/><circle cx="86" cy="52" r="3.6" fill="#212121"/>' +
      '<path d="M81 58 l-7 -5 M81 61 l-8 0 M81 64 l-7 5 M91 58 l7 -5 M91 61 l8 0 M91 64 l7 5" stroke="#212121" stroke-width="1.4"/></g></svg>';
    return s;
  }
  // The Epiphany: a gold cross over the sea.
  var CROSS = '<svg ' + SVG_NS + ' viewBox="0 0 110 110" aria-hidden="true">' +
    '<g class="ssn-tw"><circle cx="55" cy="36" r="30" fill="#fff8e1" opacity=".35"/></g>' +
    '<path d="M51 8 h8 v16 h14 v8 h-14 v34 h-8 v-34 h-14 v-8 h14 Z" fill="#ffca28" stroke="#b28704" stroke-width="1.5"/>' +
    '<path d="M0 74 Q14 66 28 74 T56 74 T84 74 T112 74 V110 H0 Z" fill="#1e88e5"/>' +
    '<path d="M0 86 Q14 78 28 86 T56 86 T84 86 T112 86 V110 H0 Z" fill="#1565c0"/>' +
    '<path d="M0 98 Q14 90 28 98 T56 98 T84 98 T112 98 V110 H0 Z" fill="#0d47a1"/>' +
    '</svg>';
  // Two hearts (Valentine's Day).
  var HEARTS = '<svg ' + SVG_NS + ' viewBox="0 0 120 90" aria-hidden="true">' +
    '<path class="ssn-beat" d="M40 82 C6 58 2 34 14 22 C26 10 40 18 40 30 C40 18 54 10 66 22 C78 34 74 58 40 82 Z" fill="#e53935"/>' +
    '<path class="ssn-beat ssn-late" d="M86 70 C62 52 60 36 68 28 C76 20 86 26 86 34 C86 26 96 20 104 28 C112 36 110 52 86 70 Z" fill="#f06292"/>' +
    '</svg>';
  // A carnival mask with feathers.
  var MASK = '<svg ' + SVG_NS + ' viewBox="0 0 130 100" aria-hidden="true">' +
    '<path d="M56 34 Q50 4 62 0 Q60 20 64 32 Z" fill="#43a047"/><path d="M62 32 Q68 2 82 2 Q72 18 68 32 Z" fill="#fdd835"/>' +
    '<path d="M68 34 Q86 8 98 12 Q82 22 72 36 Z" fill="#e53935"/>' +
    '<path d="M8 46 Q20 30 50 36 Q65 40 80 36 Q110 30 122 46 Q120 74 92 76 Q76 76 65 62 Q54 76 38 76 Q10 74 8 46 Z" fill="#7b1fa2" stroke="#fdd835" stroke-width="3"/>' +
    '<ellipse cx="38" cy="52" rx="12" ry="7" fill="#1a1022"/><ellipse cx="92" cy="52" rx="12" ry="7" fill="#1a1022"/>' +
    '<g class="ssn-tw"><circle cx="65" cy="46" r="3" fill="#fdd835"/><circle cx="20" cy="62" r="2.5" fill="#4fc3f7"/>' +
    '<circle cx="110" cy="62" r="2.5" fill="#4fc3f7"/></g>' +
    '<path d="M122 46 L128 90" stroke="#8d6e63" stroke-width="3"/>' +
    '</svg>';
  // A kite with its tail (Clean Monday).
  var KITE = '<svg ' + SVG_NS + ' viewBox="0 0 100 150" aria-hidden="true"><g class="ssn-sway">' +
    '<path d="M50 4 L88 46 L50 96 L12 46 Z" fill="#e53935"/><path d="M50 4 L88 46 L50 46 Z" fill="#fdd835"/>' +
    '<path d="M12 46 L50 46 L50 96 Z" fill="#1e88e5"/><path d="M50 4 V96 M12 46 H88" stroke="#5d4037" stroke-width="1.5"/>' +
    '<path d="M50 96 Q38 112 54 122 T48 146" fill="none" stroke="#5d4037" stroke-width="1.2"/>' +
    '<path d="M44 108 l12 -4 M46 122 l12 0 M44 136 l12 3" stroke="#43a047" stroke-width="4" stroke-linecap="round"/>' +
    '</g></svg>';
  // The Greek flag on a pole (25 March, 28 October).
  var FLAG = (function () {
    var s = '<svg ' + SVG_NS + ' viewBox="0 0 120 130" aria-hidden="true">' +
      '<rect x="6" y="4" width="4" height="124" rx="2" fill="#9e9e9e"/><circle cx="8" cy="4" r="4" fill="#ffca28"/>' +
      '<g class="ssn-wave"><rect x="10" y="8" width="104" height="72" fill="#fff"/>';
    for (var i = 0; i < 9; i += 2) s += '<rect x="10" y="' + (8 + i * 8) + '" width="104" height="8" fill="#0d5eaf"/>';
    s += '<rect x="10" y="8" width="40" height="40" fill="#0d5eaf"/><rect x="26" y="8" width="8" height="40" fill="#fff"/>' +
      '<rect x="10" y="24" width="40" height="8" fill="#fff"/></g></svg>';
    return s;
  })();
  // Red eggs and a lit Easter candle (lambada).
  var EASTER = '<svg ' + SVG_NS + ' viewBox="0 0 130 130" aria-hidden="true">' +
    '<g class="ssn-flame"><path d="M96 8 Q104 22 96 30 Q88 22 96 8 Z" fill="#ffb300"/><path d="M96 16 Q100 24 96 28 Q92 24 96 16 Z" fill="#fff59d"/></g>' +
    '<rect x="92" y="30" width="8" height="90" rx="2" fill="#fafafa" stroke="#e0e0e0"/>' +
    '<path d="M92 60 Q78 66 84 80 M100 60 Q114 66 108 80" stroke="#e53935" stroke-width="3" fill="none"/>' +
    '<circle cx="96" cy="60" r="5" fill="#e53935"/>' +
    '<ellipse cx="30" cy="104" rx="16" ry="21" fill="#c62828"/><ellipse cx="60" cy="110" rx="15" ry="19" fill="#d32f2f"/>' +
    '<ellipse cx="44" cy="92" rx="14" ry="18" fill="#b71c1c"/>' +
    '<ellipse cx="38" cy="86" rx="4" ry="7" fill="#fff" opacity=".35"/><ellipse cx="24" cy="98" rx="4" ry="7" fill="#fff" opacity=".3"/>' +
    '<path d="M6 126 Q40 116 76 126 Z" fill="#7cb342"/>' +
    '</svg>';
  // Balloons (my birthday).
  var BALLOONS = '<svg ' + SVG_NS + ' viewBox="0 0 120 150" aria-hidden="true">' +
    '<path d="M30 70 Q36 110 58 148 M60 60 Q60 110 58 148 M92 74 Q80 112 58 148" fill="none" stroke="#9e9e9e" stroke-width="1.2"/>' +
    '<g class="ssn-float"><ellipse cx="30" cy="44" rx="22" ry="27" fill="#e53935"/><path d="M27 70 h6 l-3 5 Z" fill="#e53935"/>' +
    '<ellipse cx="22" cy="34" rx="5" ry="9" fill="#fff" opacity=".35"/></g>' +
    '<g class="ssn-float ssn-late"><ellipse cx="60" cy="32" rx="22" ry="27" fill="#fdd835"/><path d="M57 58 h6 l-3 5 Z" fill="#fdd835"/>' +
    '<ellipse cx="52" cy="22" rx="5" ry="9" fill="#fff" opacity=".4"/></g>' +
    '<g class="ssn-float"><ellipse cx="92" cy="48" rx="22" ry="27" fill="#1e88e5"/><path d="M89 74 h6 l-3 5 Z" fill="#1e88e5"/>' +
    '<ellipse cx="84" cy="38" rx="5" ry="9" fill="#fff" opacity=".35"/></g>' +
    '</svg>';
  // Tulips (spring).
  var TULIPS = '<svg ' + SVG_NS + ' viewBox="0 0 120 110" aria-hidden="true">' +
    '<path d="M30 50 Q32 80 40 106 M60 40 Q60 80 60 106 M90 52 Q86 80 80 106" fill="none" stroke="#43a047" stroke-width="3"/>' +
    '<path d="M46 96 Q30 70 22 80 Q34 86 44 104 Z M74 98 Q92 72 100 82 Q88 88 76 104 Z" fill="#66bb6a"/>' +
    '<g class="ssn-sway2"><path d="M18 30 Q20 52 30 54 Q40 52 42 30 L36 38 L30 28 L24 38 Z" fill="#e53935"/></g>' +
    '<g class="ssn-sway2 ssn-late"><path d="M48 20 Q50 42 60 44 Q70 42 72 20 L66 28 L60 18 L54 28 Z" fill="#f06292"/></g>' +
    '<g class="ssn-sway2"><path d="M78 32 Q80 54 90 56 Q100 54 102 32 L96 40 L90 30 L84 40 Z" fill="#fdd835"/></g>' +
    '</svg>';
  // The sun (summer), in the top right corner.
  var SUN = (function () {
    var s = '<svg ' + SVG_NS + ' viewBox="0 0 120 120" aria-hidden="true"><g class="ssn-spin">';
    for (var i = 0; i < 12; i++) {
      var a = i * Math.PI / 6;
      s += '<path d="M' + (60 + Math.cos(a) * 34).toFixed(1) + ' ' + (60 + Math.sin(a) * 34).toFixed(1) + ' L' +
        (60 + Math.cos(a) * 52).toFixed(1) + ' ' + (60 + Math.sin(a) * 52).toFixed(1) + '" stroke="#ffb300" stroke-width="5" stroke-linecap="round"/>';
    }
    return s + '</g><circle cx="60" cy="60" r="27" fill="#ffca28" stroke="#ff8f00" stroke-width="2"/></svg>';
  })();
  // Waves along the bottom edge (summer); 80 px period, drifting.
  function waves(w) {
    var W = Math.ceil(w / 80) * 80 + 160, d = function (y, c, o) {
      var p = "M0 " + y;
      for (var x = 0; x < W; x += 80) p += " q20 -9 40 0 t40 0";
      return '<path d="' + p + ' V44 H0 Z" fill="' + c + '" opacity="' + o + '"/>';
    };
    return '<svg ' + SVG_NS + ' viewBox="0 0 ' + W + ' 44" width="' + W + '" height="44" aria-hidden="true"><g class="ssn-drift">' +
      d(16, "#4fc3f7", ".55") + d(26, "#0288d1", ".6") + d(36, "#01579b", ".7") + '</g></svg>';
  }
  // Bunting: small pennants along a string (flags, carnival).
  function bunting(w, colors) {
    var n = Math.max(8, Math.round(w / 34)), step = w / n, s = "";
    for (var i = 0; i < n; i++) {
      var x = i * step, y = 4 + Math.sin((i / n) * Math.PI * 4) * 2;
      s += '<path d="M' + (x + 2).toFixed(1) + ' ' + y.toFixed(1) + ' L' + (x + step - 2).toFixed(1) + ' ' + y.toFixed(1) +
        ' L' + (x + step / 2).toFixed(1) + ' ' + (y + 22).toFixed(1) + ' Z" fill="' + colors[i % colors.length] + '" stroke="rgba(0,0,0,.25)" stroke-width=".8"/>';
    }
    return '<svg ' + SVG_NS + ' viewBox="0 0 ' + w.toFixed(0) + ' 34" width="' + w.toFixed(0) + '" height="34" aria-hidden="true">' +
      '<path d="M0 4 Q' + (w / 2).toFixed(0) + ' 10 ' + w.toFixed(0) + ' 4" fill="none" stroke="#5d4037" stroke-width="1.2"/><g class="ssn-flutter">' + s + '</g></svg>';
  }
  // A May Day wreath: a green vine with flowers.
  function wreath(w) {
    var n = Math.max(6, Math.round(w / 46)), step = w / n, s = "", vine = "M0 8";
    var cols = ["#e53935", "#fdd835", "#f06292", "#ffffff", "#ab47bc"];
    for (var i = 0; i < n; i++) {
      var x0 = i * step, cx = x0 + step / 2;
      vine += " Q" + cx.toFixed(1) + " 20 " + (x0 + step).toFixed(1) + " 8";
      var c = cols[i % cols.length], fy = 15;
      s += '<g class="ssn-bulb" style="animation-delay:' + ((i % 3) * 0.6).toFixed(1) + 's">';
      for (var k = 0; k < 5; k++) {
        var a = k * 1.2566;
        s += '<circle cx="' + (cx + Math.cos(a) * 5).toFixed(1) + '" cy="' + (fy + Math.sin(a) * 5).toFixed(1) + '" r="4" fill="' + c + '" stroke="rgba(0,0,0,.2)" stroke-width=".6"/>';
      }
      s += '<circle cx="' + cx.toFixed(1) + '" cy="' + fy + '" r="3" fill="#ffb300"/>' +
        '<ellipse cx="' + (x0 + step * 0.2).toFixed(1) + '" cy="12" rx="6" ry="3" fill="#43a047" transform="rotate(-20 ' + (x0 + step * 0.2).toFixed(1) + ' 12)"/></g>';
    }
    return '<svg ' + SVG_NS + ' viewBox="0 0 ' + w.toFixed(0) + ' 34" width="' + w.toFixed(0) + '" height="34" aria-hidden="true">' +
      '<path d="' + vine + '" fill="none" stroke="#2e7d32" stroke-width="2.4"/>' + s + '</svg>';
  }
  // A string of bulbs along the top edge, as wide as the screen.
  function lights(w, colors) {
    var n = Math.max(6, Math.round(w / 52)), step = w / n, s = "", wire = "M0 6";
    for (var i = 0; i < n; i++) {
      var x0 = i * step, x1 = x0 + step;
      wire += " Q" + (x0 + step / 2).toFixed(1) + " 22 " + x1.toFixed(1) + " 6";
      var bx = x0 + step / 2, c = colors[i % colors.length];
      s += '<g class="ssn-bulb" style="animation-delay:' + ((i % 4) * 0.45).toFixed(2) + 's">' +
        '<rect x="' + (bx - 2.5).toFixed(1) + '" y="12" width="5" height="4" fill="#555"/>' +
        '<ellipse cx="' + bx.toFixed(1) + '" cy="21" rx="4.5" ry="6.5" fill="' + c + '"/></g>';
    }
    return '<svg ' + SVG_NS + ' viewBox="0 0 ' + w.toFixed(0) + ' 34" width="' + w.toFixed(0) + '" height="34" aria-hidden="true">' +
      '<path d="' + wire + '" fill="none" stroke="#3a3a3a" stroke-width="1.6"/>' + s + '</svg>';
  }

  // ---------- 7. Moving things (one canvas) ----------
  function rnd(a, b) { return a + Math.random() * (b - a); }

  function Snow(color, big) {
    this.color = color; this.big = big; this.list = [];
  }
  Snow.prototype.fit = function (w, h, n) {
    while (this.list.length < n) this.list.push(this.spawn(w, h, true));
    if (this.list.length > n) this.list.length = n;
  };
  Snow.prototype.spawn = function (w, h, anywhere) {
    var r = rnd(1, this.big ? 3.4 : 2.2);
    return { x: rnd(0, w), y: anywhere ? rnd(0, h) : -5, r: r, vy: 14 + r * 9, ph: rnd(0, 6.3), sw: rnd(8, 22) };
  };
  Snow.prototype.step = function (dt, w, h, ctx) {
    ctx.fillStyle = this.color;
    ctx.strokeStyle = "rgba(40,50,70,.35)";       // a thin rim: visible on light wallpapers too
    ctx.lineWidth = 1;
    for (var i = 0; i < this.list.length; i++) {
      var p = this.list[i];
      p.y += p.vy * dt; p.ph += dt * 0.8;
      if (p.y > h + 5) { this.list[i] = p = this.spawn(w, h, false); }
      ctx.globalAlpha = 0.55 + p.r / 8;
      ctx.beginPath();
      ctx.arc(p.x + Math.sin(p.ph) * p.sw, p.y, p.r, 0, 6.2832);
      ctx.fill();
      if (p.r > 1.6) ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  // Gold sparkles that drift down and twinkle (New Year).
  function Sparkle(colors) { this.colors = colors || ["#ffd54f", "#fff3c4"]; this.list = []; }
  Sparkle.prototype.fit = Snow.prototype.fit;
  Sparkle.prototype.spawn = function (w, h, anywhere) {
    return { x: rnd(0, w), y: anywhere ? rnd(0, h) : -4, r: rnd(1, 2.4), vy: rnd(8, 20), ph: rnd(0, 6.3),
             c: this.colors[Math.floor(Math.random() * this.colors.length)] };
  };
  Sparkle.prototype.step = function (dt, w, h, ctx) {
    for (var i = 0; i < this.list.length; i++) {
      var p = this.list[i];
      p.y += p.vy * dt; p.ph += dt * 3;
      if (p.y > h + 4) { this.list[i] = p = this.spawn(w, h, false); }
      ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(p.ph));
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x - p.r, p.y - p.r / 3, p.r * 2, p.r / 1.5);
      ctx.fillRect(p.x - p.r / 3, p.y - p.r, p.r / 1.5, p.r * 2);
    }
    ctx.globalAlpha = 1;
  };

  // Rockets that burst into stars.
  var FW_COLORS = ["#ffd54f", "#ef5350", "#66bb6a", "#42a5f5", "#ffffff", "#ce93d8"];
  function Fireworks() { this.rockets = []; this.sparks = []; this.wait = 0.4; this.max = 2; }
  Fireworks.prototype.fit = function (w, h, n) { this.max = Math.max(1, Math.min(4, Math.round(n / 40))); };
  Fireworks.prototype.step = function (dt, w, h, ctx) {
    this.wait -= dt;
    if (this.wait <= 0 && this.rockets.length < this.max) {
      this.rockets.push({ x: rnd(w * 0.15, w * 0.85), y: h, vy: -rnd(h * 0.55, h * 0.8), top: rnd(h * 0.12, h * 0.45),
                          c: FW_COLORS[Math.floor(Math.random() * FW_COLORS.length)] });
      this.wait = rnd(0.6, 1.6);
    }
    var i;
    for (i = this.rockets.length - 1; i >= 0; i--) {
      var r = this.rockets[i];
      r.y += r.vy * dt;
      ctx.fillStyle = r.c; ctx.globalAlpha = 0.9;
      ctx.fillRect(r.x - 1, r.y, 2, 7);
      if (r.y <= r.top) {
        var n = 34;
        for (var k = 0; k < n; k++) {
          var a = (k / n) * 6.2832, v = rnd(60, 130);
          this.sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, c: r.c });
        }
        this.rockets.splice(i, 1);
      }
    }
    for (i = this.sparks.length - 1; i >= 0; i--) {
      var s = this.sparks[i];
      s.vy += 60 * dt; s.vx *= 0.985; s.vy *= 0.985;
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt * 0.7;
      if (s.life <= 0) { this.sparks.splice(i, 1); continue; }
      ctx.globalAlpha = s.life; ctx.fillStyle = s.c;
      ctx.fillRect(s.x - 1.2, s.y - 1.2, 2.4, 2.4);
    }
    ctx.globalAlpha = 1;
  };

  // A few bats crossing now and then (Halloween).
  function Bats(color) { this.color = color; this.list = []; this.wait = 1; this.max = 2; }
  Bats.prototype.fit = function (w, h, n) { this.max = Math.max(1, Math.min(4, Math.round(n / 30))); };
  Bats.prototype.step = function (dt, w, h, ctx) {
    this.wait -= dt;
    if (this.wait <= 0 && this.list.length < this.max) {
      var ltr = Math.random() < 0.5;
      this.list.push({ x: ltr ? -30 : w + 30, y: rnd(h * 0.08, h * 0.55), vx: (ltr ? 1 : -1) * rnd(70, 130),
                       ph: rnd(0, 6.3), s: rnd(0.7, 1.25), bob: rnd(10, 30) });
      this.wait = rnd(2.5, 6);
    }
    ctx.fillStyle = this.color;
    ctx.strokeStyle = "rgba(255,183,77,.55)";     // an orange rim: visible on dark wallpapers too
    ctx.lineWidth = 1.2;
    for (var i = this.list.length - 1; i >= 0; i--) {
      var b = this.list[i];
      b.x += b.vx * dt; b.ph += dt * 11;
      if (b.x < -40 || b.x > w + 40) { this.list.splice(i, 1); continue; }
      var y = b.y + Math.sin(b.ph / 5) * b.bob, f = Math.sin(b.ph) * 7 * b.s, s = 12 * b.s;
      ctx.beginPath();
      ctx.moveTo(b.x, y);
      ctx.quadraticCurveTo(b.x - s * 0.6, y - f - 2, b.x - s * 1.6, y - f);
      ctx.quadraticCurveTo(b.x - s * 1.1, y + 1, b.x - s * 0.9, y + 3);
      ctx.quadraticCurveTo(b.x - s * 0.4, y + 1, b.x, y + 4);
      ctx.quadraticCurveTo(b.x + s * 0.4, y + 1, b.x + s * 0.9, y + 3);
      ctx.quadraticCurveTo(b.x + s * 1.1, y + 1, b.x + s * 1.6, y - f);
      ctx.quadraticCurveTo(b.x + s * 0.6, y - f - 2, b.x, y);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath(); ctx.arc(b.x, y + 1, 2.6 * b.s, 0, 6.2832); ctx.fill();
    }
  };

  // Confetti or petals: small pieces that tumble down.
  function Confetti(colors, petals) { this.colors = colors; this.petals = !!petals; this.list = []; }
  Confetti.prototype.fit = Snow.prototype.fit;
  Confetti.prototype.spawn = function (w, h, anywhere) {
    return { x: rnd(0, w), y: anywhere ? rnd(0, h) : -8, s: rnd(4, 8), vy: rnd(this.petals ? 16 : 28, this.petals ? 30 : 55),
             ph: rnd(0, 6.3), rot: rnd(0, 6.3), vr: rnd(-3, 3), sw: rnd(10, 30),
             c: this.colors[Math.floor(Math.random() * this.colors.length)] };
  };
  Confetti.prototype.step = function (dt, w, h, ctx) {
    ctx.strokeStyle = "rgba(0,0,0,.25)";
    ctx.lineWidth = 0.8;
    for (var i = 0; i < this.list.length; i++) {
      var p = this.list[i];
      p.y += p.vy * dt; p.ph += dt; p.rot += p.vr * dt;
      if (p.y > h + 8) { this.list[i] = p = this.spawn(w, h, false); }
      ctx.save();
      ctx.translate(p.x + Math.sin(p.ph) * p.sw, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.abs(Math.cos(p.rot * 1.3)) * 0.8 + 0.2);
      ctx.fillStyle = p.c;
      ctx.beginPath();
      if (this.petals) ctx.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, 6.2832);
      else ctx.rect(-p.s / 2, -p.s / 3, p.s, p.s / 1.5);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  };

  // Hearts that rise and sway (Valentine's Day).
  function Hearts() { this.list = []; }
  Hearts.prototype.fit = Snow.prototype.fit;
  Hearts.prototype.spawn = function (w, h, anywhere) {
    return { x: rnd(0, w), y: anywhere ? rnd(0, h) : h + 10, s: rnd(5, 11), vy: rnd(14, 30), ph: rnd(0, 6.3),
             sw: rnd(8, 24), c: Math.random() < 0.5 ? "#e53935" : "#f06292" };
  };
  Hearts.prototype.step = function (dt, w, h, ctx) {
    ctx.strokeStyle = "rgba(255,255,255,.55)";
    ctx.lineWidth = 1;
    for (var i = 0; i < this.list.length; i++) {
      var p = this.list[i];
      p.y -= p.vy * dt; p.ph += dt;
      if (p.y < -12) { this.list[i] = p = this.spawn(w, h, false); }
      var x = p.x + Math.sin(p.ph) * p.sw, y = p.y, s = p.s;
      ctx.globalAlpha = Math.min(1, Math.max(0.15, p.y / h + 0.2));
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.moveTo(x, y + s * 0.9);
      ctx.bezierCurveTo(x - s * 1.4, y, x - s * 0.7, y - s, x, y - s * 0.35);
      ctx.bezierCurveTo(x + s * 0.7, y - s, x + s * 1.4, y, x, y + s * 0.9);
      ctx.fill(); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  // Butterflies that wander (Easter).
  var BF_COLORS = ["#ffb300", "#4fc3f7", "#f06292", "#ffffff", "#9ccc65"];
  function Butterflies() { this.list = []; }
  Butterflies.prototype.fit = function (w, h, n) {
    n = Math.max(2, Math.min(8, Math.round(n / 10)));
    while (this.list.length < n) {
      this.list.push({ x: rnd(0, w), y: rnd(h * 0.2, h * 0.9), a: rnd(0, 6.3), v: rnd(30, 55), ph: rnd(0, 6.3),
                       s: rnd(0.8, 1.3), c: BF_COLORS[this.list.length % BF_COLORS.length] });
    }
    this.list.length = n;
  };
  Butterflies.prototype.step = function (dt, w, h, ctx) {
    ctx.strokeStyle = "rgba(0,0,0,.45)";
    ctx.lineWidth = 1;
    for (var i = 0; i < this.list.length; i++) {
      var b = this.list[i];
      b.a += rnd(-1.2, 1.2) * dt; b.ph += dt * 14;
      b.x += Math.cos(b.a) * b.v * dt; b.y += Math.sin(b.a) * b.v * dt;
      if (b.x < -20) b.x = w + 20; else if (b.x > w + 20) b.x = -20;
      if (b.y < h * 0.1 || b.y > h - 20) b.a = -b.a;
      var f = Math.abs(Math.sin(b.ph)) * 0.8 + 0.2, s = 11 * b.s;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.fillStyle = b.c;
      ctx.beginPath();
      ctx.ellipse(-s * 0.55 * f, -s * 0.3, s * 0.6 * f, s * 0.7, -0.4, 0, 6.2832);
      ctx.ellipse(s * 0.55 * f, -s * 0.3, s * 0.6 * f, s * 0.7, 0.4, 0, 6.2832);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#3e2723";
      ctx.fillRect(-1, -s * 0.8, 2, s * 1.3);
      ctx.restore();
    }
  };

  // Kites high up, swaying on their strings (Clean Monday).
  var KITE_COLORS = [["#e53935", "#fdd835"], ["#1e88e5", "#ffffff"], ["#43a047", "#ff7043"], ["#8e24aa", "#ffca28"]];
  function Kites() { this.list = []; }
  Kites.prototype.fit = function (w, h, n) {
    n = Math.max(1, Math.min(4, Math.round(n / 20)));
    this.list = [];
    for (var i = 0; i < n; i++) {
      this.list.push({ ax: w * (i + 0.6) / (n + 0.4), ay: rnd(h * 0.12, h * 0.38), ph: rnd(0, 6.3), s: rnd(0.8, 1.2),
                       c: KITE_COLORS[i % KITE_COLORS.length] });
    }
  };
  Kites.prototype.step = function (dt, w, h, ctx) {
    for (var i = 0; i < this.list.length; i++) {
      var k = this.list[i];
      k.ph += dt * 0.9;
      var x = k.ax + Math.sin(k.ph) * 18, y = k.ay + Math.sin(k.ph * 1.7) * 8, s = 18 * k.s, tilt = Math.sin(k.ph) * 0.25;
      ctx.strokeStyle = "rgba(90,70,60,.55)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y + s * 1.2); ctx.quadraticCurveTo(x - 40, y + h * 0.4, k.ax - 60, h); ctx.stroke();
      ctx.save(); ctx.translate(x, y); ctx.rotate(tilt);
      ctx.fillStyle = k.c[0];
      ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.8, 0); ctx.lineTo(0, s * 1.2); ctx.lineTo(-s * 0.8, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = k.c[1];
      ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.8, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.stroke();
      ctx.strokeStyle = k.c[0]; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, s * 1.2);
      for (var t = 1; t <= 4; t++) ctx.lineTo(Math.sin(k.ph * 3 + t) * 6, s * 1.2 + t * 9);
      ctx.stroke();
      ctx.restore();
    }
  };

  // ---------- 8. Scenes ----------
  // Each scene: the still pieces (corner, top string, web) and the
  // moving ones (particle systems with a density per 1280×720).
  // Colours do not follow the theme: the wallpaper under them may be
  // dark in the light theme too, so every piece carries its own rim.
  function scene(id, nowDate) {
    var d = load();
    switch (id) {
      case "xmas":
        return { corner: get(d, "xmas") === "boat" ? BOAT : TREE, cornerW: get(d, "xmas") === "boat" ? 1.15 : 0.9,
                 top: function (w) { return lights(w, ["#e53935", "#fdd835", "#43a047", "#1e88e5"]); },
                 moving: function () { return [{ sys: new Snow("#ffffff", true), n: 90 }]; } };
      case "newyear":
        return { corner: POMEGRANATE, cornerW: 0.8, top: function (w) { return lights(w, ["#ffd54f", "#fff8e1", "#ffca28"]); },
                 moving: function () {
                   var out = [{ sys: new Sparkle(), n: 50 }, { sys: new Snow("#ffffff", false), n: 35 }];
                   if (fireworksTime(nowDate)) out.push({ sys: new Fireworks(), n: 80 });
                   return out;
                 } };
      case "halloween":
        return { corner: PUMPKINS, cornerW: 1.3, tr: web("rgba(235,235,245,.7)"), trW: 0.9,
                 moving: function () { return [{ sys: new Bats("#1d1626"), n: 60 }]; } };
      case "epiphany":
        return { corner: CROSS, cornerW: 0.85,
                 moving: function () { return [{ sys: new Sparkle(["#bbdefb", "#ffffff", "#ffe082"]), n: 45 }]; } };
      case "valentine":
        return { corner: HEARTS, cornerW: 0.9,
                 moving: function () { return [{ sys: new Hearts(), n: 30 }]; } };
      case "carnival":
        return { corner: MASK, cornerW: 1.1, top: function (w) { return bunting(w, CONFETTI); },
                 moving: function () { return [{ sys: new Confetti(CONFETTI, false), n: 70 }]; } };
      case "cleanmon":
        return { corner: KITE, cornerW: 0.7,
                 moving: function () { return [{ sys: new Kites(), n: 60 }]; } };
      case "mar25":
      case "oct28":
        return { corner: FLAG, cornerW: 0.95, top: function (w) { return bunting(w, ["#0d5eaf", "#ffffff"]); },
                 moving: function () { return []; } };
      case "easter":
        return { corner: EASTER, cornerW: 1.15, top: function (w) { return wreath(w); },
                 moving: function () { return [{ sys: new Butterflies(), n: 50 }]; } };
      case "birthday":
        return { corner: BALLOONS, cornerW: 0.95, top: function (w) { return bunting(w, CONFETTI); },
                 moving: function () { return [{ sys: new Confetti(CONFETTI, false), n: 55 }]; } };
      case "spring":
        return { corner: TULIPS, cornerW: 0.85,
                 moving: function () { return [{ sys: new Confetti(["#f8bbd0", "#ffffff", "#f48fb1"], true), n: 16 }]; } };
      case "summer":
        return { tr: SUN, trW: 0.7, bottom: function (w) { return waves(w); },
                 moving: function () { return []; } };
      case "autumn":
        return { moving: function () { return [{ sys: new Confetti(["#e65100", "#bf360c", "#f9a825", "#8d6e63", "#d84315"], true), n: 22 }]; } };
      case "winter":
        return { moving: function () { return [{ sys: new Snow("#ffffff", false), n: 35 }]; } };
      case "mayday":
        return { corner: null, top: function (w) { return wreath(w); },
                 moving: function () { return [{ sys: new Confetti(["#f8bbd0", "#ffffff", "#fff59d", "#f48fb1"], true), n: 40 }]; } };
    }
    return null;
  }

  var CONFETTI = ["#e53935", "#fdd835", "#43a047", "#1e88e5", "#ab47bc", "#ff7043"];

  // Fireworks: New Year's Eve 23:55 to 00:10, or the first 25 s of a
  // New Year preview.
  function fireworksTime(d) {
    if (preview === "newyear" && Date.now() - previewAt < 25000) return true;
    var m = d.getMonth(), day = d.getDate(), h = d.getHours(), min = d.getMinutes();
    return (m === 11 && day === 31 && h === 23 && min >= 55) || (m === 0 && day === 1 && h === 0 && min < 10);
  }

  // ---------- 9. Rendering ----------
  var layer = null, canvas = null, ctx = null, bar = null;
  var shown = "";              // key of what is painted now
  var systems = [];
  var raf = 0, lastTs = 0, ema = 33, slowFrames = 0, scale = 1, degraded = false;

  var CSS =
    "#ssn-layer{position:fixed;top:calc(40px + env(safe-area-inset-top,0px));left:0;width:100vw;" +
    "height:calc(100vh - 40px - env(safe-area-inset-top,0px));height:calc(100dvh - 40px - env(safe-area-inset-top,0px));" +
    "z-index:-1;pointer-events:none;overflow:hidden}" +
    "#ssn-layer canvas{position:absolute;inset:0;width:100%;height:100%}" +
    "#ssn-layer .ssn-top{position:absolute;top:0;left:0;right:0;height:34px;opacity:.95}" +
    "#ssn-layer .ssn-corner{position:absolute;right:12px;bottom:calc(var(--tb-h,0px) + 12px);opacity:.96}" +
    "#ssn-layer .ssn-corner svg,#ssn-layer .ssn-web svg{width:100%;height:auto;display:block}" +
    "#ssn-layer .ssn-web{position:absolute;top:0;right:0;opacity:.9}" +
    "#ssn-layer .ssn-web svg{filter:drop-shadow(0 0 1px rgba(0,0,0,.7))}" +
    "#ssn-layer .ssn-corner svg{filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}" +
    "#ssn-layer .ssn-bulb{animation:ssn-blink 1.8s ease-in-out infinite alternate}" +
    "#ssn-layer .ssn-tw circle,#ssn-layer .ssn-tw path{animation:ssn-blink 2.4s ease-in-out infinite alternate}" +
    "#ssn-layer .ssn-tw :nth-child(2n){animation-delay:1.2s}" +
    "#ssn-layer .ssn-star{animation:ssn-blink 3s ease-in-out infinite alternate}" +
    "#ssn-layer .ssn-glow{animation:ssn-flicker 2.2s steps(6) infinite}" +
    "#ssn-layer .ssn-spider{animation:ssn-bob 5s ease-in-out infinite alternate}" +
    "#ssn-layer .ssn-wave{transform-origin:10px 44px;animation:ssn-wave 3s ease-in-out infinite alternate}" +
    "#ssn-layer .ssn-sway{transform-origin:50px 96px;animation:ssn-sway 4s ease-in-out infinite alternate}" +
    "#ssn-layer .ssn-flame{transform-origin:96px 30px;animation:ssn-flame 1.2s ease-in-out infinite alternate}" +
    "#ssn-layer .ssn-beat{transform-box:fill-box;transform-origin:center;animation:ssn-beat 1.6s ease-in-out infinite}" +
    "#ssn-layer .ssn-late{animation-delay:.4s}" +
    "#ssn-layer .ssn-flutter{animation:ssn-flutter 3s ease-in-out infinite alternate}" +
    "#ssn-layer .ssn-bottom{position:absolute;left:0;right:0;bottom:var(--tb-h,0px);height:44px;overflow:hidden;opacity:.85}" +
    "#ssn-layer .ssn-drift{animation:ssn-drift 6s linear infinite}" +
    "#ssn-layer .ssn-spin{transform-box:fill-box;transform-origin:center;animation:ssn-spin 40s linear infinite}" +
    "#ssn-layer .ssn-float{animation:ssn-bob 3.5s ease-in-out infinite alternate}" +
    "#ssn-layer .ssn-sway2{transform-box:fill-box;transform-origin:bottom center;animation:ssn-sway 3s ease-in-out infinite alternate}" +
    "#ssn-layer.ssn-still *{animation:none!important}" +
    "@keyframes ssn-drift{from{transform:translateX(0)}to{transform:translateX(-80px)}}" +
    "@keyframes ssn-spin{to{transform:rotate(360deg)}}" +
    "@keyframes ssn-wave{from{transform:skewY(0)}to{transform:skewY(-4deg) scaleX(.96)}}" +
    "@keyframes ssn-flutter{from{transform:translateY(0)}to{transform:translateY(2px)}}" +
    "@keyframes ssn-sway{from{transform:rotate(-5deg)}to{transform:rotate(5deg)}}" +
    "@keyframes ssn-flame{from{transform:scale(1,1)}to{transform:scale(.85,1.12)}}" +
    "@keyframes ssn-beat{0%,100%{transform:scale(1)}15%{transform:scale(1.08)}30%{transform:scale(.97)}}" +
    "@keyframes ssn-blink{from{opacity:1}to{opacity:.35}}" +
    "@keyframes ssn-flicker{0%,100%{opacity:1}30%{opacity:.7}55%{opacity:.95}80%{opacity:.6}}" +
    "@keyframes ssn-bob{from{transform:translateY(0)}to{transform:translateY(14px)}}" +
    "#ssn-bar{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(var(--tb-h,0px) + 18px + env(safe-area-inset-bottom,0px));" +
    "z-index:960;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;max-width:calc(100vw - 24px);" +
    "box-sizing:border-box;padding:8px 10px 8px 14px;border-radius:12px;background:var(--panel-bg);color:var(--text);" +
    "border:1px solid var(--border);box-shadow:0 6px 24px var(--shadow);font-size:14px}" +
    "#ssn-bar button{font:inherit;border-radius:8px;padding:6px 12px;cursor:pointer;border:1px solid var(--border);" +
    "background:transparent;color:var(--text);min-height:34px}" +
    "#ssn-bar button.ssn-main{background:var(--accent);border-color:var(--accent);color:#fff}" +
    "#ssn-bar button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
    "body.app-running #ssn-bar{display:none}";

  function injectCss() {
    if (document.getElementById("ssn-css")) return;
    var st = document.createElement("style");
    st.id = "ssn-css";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function still() {
    return reduced() || lowBattery || degraded || get(load(), "motion") === "still";
  }

  function amountFactor() {
    var a = get(load(), "amount");
    return (a === "low" ? 0.5 : a === "high" ? 1.8 : 1) * (weak ? 0.5 : 1) * scale;
  }

  function size() {
    var w = root.innerWidth || 800, h = Math.max(100, (root.innerHeight || 600) - 40);
    return { w: w, h: h };
  }

  function clear() {
    stopLoop();
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    layer = canvas = ctx = null;
    systems = [];
    shown = "";
  }

  function paint(p) {
    var desk = host && host.desktop;
    if (!desk) return;
    var now = new Date();
    var sc = scene(p.id, now);
    if (!sc) { clear(); return; }
    var sz = size(), isStill = still();
    var key = [p.id, sz.w, sz.h, isStill ? 1 : 0, get(load(), "xmas"), get(load(), "amount"),
               p.id === "newyear" && fireworksTime(now) ? "fw" : ""].join("|");
    if (key === shown && layer && layer.parentNode === desk) { syncLoop(); return; }
    clear();
    shown = key;
    layer = document.createElement("div");
    layer.id = "ssn-layer";
    layer.setAttribute("aria-hidden", "true");
    layer.setAttribute("data-event", p.id);
    if (isStill) layer.className = "ssn-still";
    var m = Math.min(sz.w, sz.h);
    var base = Math.max(70, Math.min(170, m * 0.24));
    // Static markup below is this file's own constant SVG, never data.
    if (sc.top) {
      var top = document.createElement("div");
      top.className = "ssn-top";
      top.innerHTML = sc.top(sz.w);
      layer.appendChild(top);
    }
    if (sc.tr) {                                  // top right: web, sun
      var wb = document.createElement("div");
      wb.className = "ssn-web";
      wb.style.width = Math.round(base * sc.trW) + "px";
      wb.innerHTML = sc.tr;
      layer.appendChild(wb);
    }
    if (sc.bottom) {
      var bt = document.createElement("div");
      bt.className = "ssn-bottom";
      bt.innerHTML = sc.bottom(sz.w);
      layer.appendChild(bt);
    }
    if (sc.corner) {
      var c = document.createElement("div");
      c.className = "ssn-corner";
      c.style.width = Math.round(base * sc.cornerW) + "px";
      c.innerHTML = sc.corner;
      layer.appendChild(c);
    }
    // A scene made only of moving things (autumn leaves, winter snow)
    // would be empty when still, so it gets one frozen frame instead.
    var frozen = isStill && !sc.top && !sc.tr && !sc.bottom && !sc.corner;
    var moving = isStill && !frozen ? [] : sc.moving();
    if (moving.length) {
      canvas = document.createElement("canvas");
      var dpr = Math.min(2, root.devicePixelRatio || 1);
      canvas.width = Math.round(sz.w * dpr);
      canvas.height = Math.round(sz.h * dpr);
      ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        var area = (sz.w * sz.h) / (1280 * 720), f = amountFactor();
        systems = moving.map(function (s) {
          var n = Math.max(6, Math.min(400, Math.round(s.n * Math.sqrt(area) * f)));
          s.sys.fit(sz.w, sz.h, n);
          return s.sys;
        });
        layer.insertBefore(canvas, layer.firstChild);
        if (frozen) {                             // draw once, no loop
          for (var i = 0; i < systems.length; i++) systems[i].step(0, sz.w, sz.h, ctx);
          systems = [];
        }
      } else canvas = null;
    }
    desk.appendChild(layer);
    syncLoop();
  }

  function shouldRun() {
    return !!(ctx && layer && systems.length && !running() && !document.hidden);
  }
  function stopLoop() {
    if (raf) { root.cancelAnimationFrame(raf); raf = 0; }
  }
  function syncLoop() {
    if (shouldRun()) { if (!raf) { lastTs = 0; raf = root.requestAnimationFrame(frame); } }
    else stopLoop();
  }
  function frame(ts) {
    raf = 0;
    if (!shouldRun()) return;
    if (lastTs && ts - lastTs < 31) { raf = root.requestAnimationFrame(frame); return; }   // ≤ 30 fps
    var gap = lastTs ? ts - lastTs : 33;
    lastTs = ts;
    // A device that cannot keep up: half the particles, then still.
    ema = ema * 0.95 + Math.min(gap, 250) * 0.05;
    if (ema > 55) {
      if (++slowFrames > 90) {
        slowFrames = 0; ema = 33; scale *= 0.5;
        if (scale < 0.24) degraded = true;
        shown = ""; update(); return;
      }
    } else slowFrames = 0;
    var sz = size(), dt = Math.min(gap, 100) / 1000;
    ctx.clearRect(0, 0, sz.w, sz.h);
    for (var i = 0; i < systems.length; i++) systems[i].step(dt, sz.w, sz.h, ctx);
    raf = root.requestAnimationFrame(frame);
  }

  // The bar of a preview that was not kept yet.
  function paintBar(p) {
    var want = !!(p && p.mode === "preview");
    if (!want) { if (bar && bar.parentNode) bar.parentNode.removeChild(bar); bar = null; return; }
    var ev = eventById(p.id);
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "ssn-bar";
      bar.setAttribute("role", "region");
      document.body.appendChild(bar);
    }
    bar.setAttribute("aria-label", tx("ssn.bar", "Decoration preview"));
    bar.textContent = "";
    var txt = document.createElement("span");
    txt.textContent = tx("ssn.preview", "Preview: {name}", { name: name(ev) });
    var keep = document.createElement("button");
    keep.type = "button"; keep.className = "ssn-main";
    keep.textContent = tx("ssn.keep", "Keep it");
    keep.title = tx("ssn.keep.tip", "Stays until the event's period ends");
    keep.addEventListener("click", function () { keepPreview(); });
    var stop = document.createElement("button");
    stop.type = "button";
    stop.textContent = tx("ssn.stop", "Stop");
    stop.addEventListener("click", function () { stopPreview(); });
    bar.appendChild(txt); bar.appendChild(keep); bar.appendChild(stop);
  }

  function current() { return pick(load(), loadLocal(), today(), preview); }

  function update() {
    if (!host) return;
    var p = current();
    if (!p) clear(); else paint(p);
    paintBar(p);
  }

  // ---------- 10. Actions ----------
  function setPref(key, v) {
    var cur = load(), next = setField(cur, key, v, Date.now());
    if (next === cur) return false;
    store(next);
    // A new motion or amount choice gives a slow device another try.
    if (key === "motion" || key === "amount") { degraded = false; scale = 1; ema = 33; slowFrames = 0; }
    var api = root.orosSync;
    if (api && typeof api.markDirty === "function") api.markDirty();
    shown = "";
    update();
    changed();
    return true;
  }

  function startPreview(id) {
    if (!eventById(id)) return false;
    preview = id; previewAt = Date.now();
    var l = loadLocal();
    if (l.keep && l.keep.id !== id) { l.keep = null; storeLocal(l); }
    shown = ""; update(); changed();
    // Fireworks end after 25 s: repaint without them.
    if (id === "newyear") setTimeout(function () { shown = ""; update(); }, 25500);
    return true;
  }

  function keepPreview() {
    var id = preview || (loadLocal().keep && loadLocal().keep.id);
    var ev = eventById(id);
    if (!ev) return false;
    var l = loadLocal();
    var w = nextWindow(ev, today(), optOf(load()));
    l.keep = { id: id, until: w ? w[1] : today() };             // a birthday not set: today only
    storeLocal(l);
    preview = null;
    update(); changed();
    return true;
  }

  function stopPreview() {
    var l = loadLocal();
    preview = null;
    if (l.keep) { l.keep = null; storeLocal(l); }
    shown = ""; update(); changed();
  }

  function hideToday(on) {
    var l = loadLocal();
    l.hide = on ? today() : null;
    storeLocal(l);
    update(); changed();
  }

  // For the Settings app (through the shell's orosSettings bridge).
  function fmtDay(s) {
    var M = tx("ssn.months", "Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec").split(",");
    return tx("ssn.day", "{d} {m}", { d: +s.slice(8, 10), m: M[+s.slice(5, 7) - 1] || "" });
  }
  function snapshot() {
    var d = load(), l = loadLocal(), s = today(), p = current();
    var opt = optOf(d);
    var auto = get(d, "on") ? activeOn(s, function (id) { return get(d, "ev." + id) === true; }, opt) : [];
    return {
      on: get(d, "on"), motion: get(d, "motion"), amount: get(d, "amount"), xmas: get(d, "xmas"),
      easter: get(d, "easter"), bday: get(d, "bday"),
      reduced: reduced(), lowBattery: lowBattery, slow: degraded,
      // Soonest first: what is on now, then what comes next.
      // A birthday not set has no dates and goes last; seasons are
      // marked so Settings can list them apart.
      events: EVENTS.map(function (ev) {
        var w = nextWindow(ev, s, opt);
        return { id: ev.id, name: name(ev), from: w ? fmtDay(w[0]) : "", to: w ? fmtDay(w[1]) : "",
                 at: w ? w[0] : "9999", season: !!ev.season, one: !!(w && w[0] === w[1]),
                 on: get(d, "ev." + ev.id) === true, now: !!windowAt(ev, s, opt) };
      }).sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; }),
      showing: p ? { id: p.id, name: name(eventById(p.id)), mode: p.mode,
                     until: p.mode === "kept" ? fmtDay(l.keep.until) : null } : null,
      todayEvent: auto.length ? { id: auto[0].id, name: name(auto[0]) } : null,
      hidden: l.hide === s
    };
  }

  // ---------- 11. Boot ----------
  var tick = null, resizeT = null;
  function attach(h) {
    if (host || !h || !h.desktop) return;
    host = h;
    injectCss();
    try { mqReduce = root.matchMedia ? root.matchMedia("(prefers-reduced-motion: reduce)") : null; } catch (e) {}
    if (mqReduce && mqReduce.addEventListener) mqReduce.addEventListener("change", function () { shown = ""; update(); });
    var nav = root.navigator || {};
    weak = (typeof nav.deviceMemory === "number" && nav.deviceMemory <= 2) ||
           (typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency <= 2);
    if (typeof nav.getBattery === "function") {
      nav.getBattery().then(function (b) {
        function chk() {
          var low = !b.charging && b.level < 0.2;
          if (low !== lowBattery) { lowBattery = low; shown = ""; update(); }
        }
        b.addEventListener("levelchange", chk);
        b.addEventListener("chargingchange", chk);
        chk();
      }).catch(function () {});
    }
    var api = root.orosSync;
    if (api && typeof api.registerSlice === "function") api.registerSlice("seasonal", sliceGet, sliceSet, DATA_KEY, merge);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) update(); else stopLoop(); });
    root.addEventListener("resize", function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(function () { shown = ""; update(); }, 250);
    });
    // The date and the fireworks minute change on their own.
    tick = setInterval(function () { if (!document.hidden) update(); }, 20000);
    update();
  }

  root.orosSeasonal = {
    VER: VER,
    model: model,
    attach: attach,
    refresh: function () { if (host) update(); },
    snapshot: snapshot,
    set: setPref,
    preview: startPreview,
    keep: keepPreview,
    stop: stopPreview,
    hideToday: hideToday
  };
})(typeof window !== "undefined" ? window : globalThis);
