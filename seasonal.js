// ============================================================
// orOS — seasonal.js (seasonal desktop decorations, v1.0.0)
// ------------------------------------------------------------
// A shell component, like pet.js and launcher.js: it runs IN the
// shell document, keeps its own storage and registers its own sync
// slice. shell.js calls attach() once at boot and refresh() when an
// app opens or closes, the theme or the language changes. A bundle
// without this file draws exactly what it drew before.
//
//   • In the right season the desktop gets a decoration: snow,
//     lights and a tree at Christmas, fireworks at New Year,
//     pumpkins, bats and a web at Halloween. ON by default.
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
//     xmas ("tree"|"boat"), "ev.<id>" (event switch, boolean);
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

  var VER = "1.0.0";
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

  // ---------- 2. Events (pure) ----------
  // win(year) = [first, last] day (inclusive) of the period that
  // STARTS in that year. prio: the higher wins when two overlap.
  // Wave 2 adds the Greek feasts here, wave 3 the optional ones.
  var EVENTS = [
    { id: "xmas", en: "Christmas", el: "Χριστούγεννα", prio: 2, def: true,
      win: function (y) { return [y + "-12-01", y + "-12-30"]; } },
    { id: "newyear", en: "New Year", el: "Πρωτοχρονιά", prio: 3, def: true,
      win: function (y) { return [y + "-12-31", (y + 1) + "-01-02"]; } },
    { id: "halloween", en: "Halloween", el: "Halloween", prio: 2, def: true,
      win: function (y) { return [y + "-10-25", y + "-10-31"]; } }
  ];

  function eventById(id) {
    for (var i = 0; i < EVENTS.length; i++) if (EVENTS[i].id === id) return EVENTS[i];
    return null;
  }

  // The period of `ev` that contains day `s`, or null.
  function windowAt(ev, s) {
    var y = +s.slice(0, 4);
    for (var k = y; k >= y - 1; k--) {
      var w = ev.win(k);
      if (s >= w[0] && s <= w[1]) return w;
    }
    return null;
  }

  // The period that contains `s`, else the next one to start.
  function nextWindow(ev, s) {
    var at = windowAt(ev, s);
    if (at) return at;
    var y = +s.slice(0, 4);
    for (var k = y; k <= y + 1; k++) {
      var w = ev.win(k);
      if (w[0] > s) return w;
    }
    return ev.win(y + 1);
  }

  // Events on day `s` that `enabled(id)` allows, highest priority first.
  function activeOn(s, enabled) {
    return EVENTS.filter(function (ev) {
      return windowAt(ev, s) && (!enabled || enabled(ev.id));
    }).sort(function (a, b) { return b.prio - a.prio || (a.id < b.id ? -1 : 1); });
  }

  // ---------- 3. Settings fields (pure) ----------
  var FIELDS = {
    on:     { def: true,   ok: function (v) { return typeof v === "boolean"; } },
    motion: { def: "auto", ok: function (v) { return v === "auto" || v === "still"; } },
    amount: { def: "mid",  ok: function (v) { return v === "low" || v === "mid" || v === "high"; } },
    xmas:   { def: "tree", ok: function (v) { return v === "tree" || v === "boat"; } }
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

  // What shows on day `s`: { id, mode: "preview"|"kept"|"auto" } or null.
  function pick(data, local, s, preview) {
    if (preview && eventById(preview)) return { id: preview, mode: "preview" };
    if (local.keep && s <= local.keep.until) return { id: local.keep.id, mode: "kept" };
    if (!get(data, "on") || local.hide === s) return null;
    var list = activeOn(s, function (id) { return get(data, "ev." + id) === true; });
    return list.length ? { id: list[0].id, mode: "auto" } : null;
  }

  var model = {
    EVENTS: EVENTS, orthodoxEaster: orthodoxEaster, addDays: addDays,
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

  function lang() { return (host && host.lang && host.lang() === "el") ? "el" : "en"; }
  function name(ev) { return lang() === "el" ? ev.el : ev.en; }
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
  function Sparkle() { this.list = []; }
  Sparkle.prototype.fit = Snow.prototype.fit;
  Sparkle.prototype.spawn = function (w, h, anywhere) {
    return { x: rnd(0, w), y: anywhere ? rnd(0, h) : -4, r: rnd(1, 2.4), vy: rnd(8, 20), ph: rnd(0, 6.3),
             c: Math.random() < 0.5 ? "#ffd54f" : "#fff3c4" };
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
                 lights: ["#e53935", "#fdd835", "#43a047", "#1e88e5"],
                 moving: function () { return [{ sys: new Snow("#ffffff", true), n: 90 }]; } };
      case "newyear":
        return { corner: POMEGRANATE, cornerW: 0.8, lights: ["#ffd54f", "#fff8e1", "#ffca28"],
                 moving: function () {
                   var out = [{ sys: new Sparkle(), n: 50 }, { sys: new Snow("#ffffff", false), n: 35 }];
                   if (fireworksTime(nowDate)) out.push({ sys: new Fireworks(), n: 80 });
                   return out;
                 } };
      case "halloween":
        return { corner: PUMPKINS, cornerW: 1.3, web: web("rgba(235,235,245,.7)"),
                 moving: function () { return [{ sys: new Bats("#1d1626"), n: 60 }]; } };
    }
    return null;
  }

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
    "#ssn-layer.ssn-still *{animation:none!important}" +
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
    if (sc.lights) {
      var top = document.createElement("div");
      top.className = "ssn-top";
      top.innerHTML = lights(sz.w, sc.lights);
      layer.appendChild(top);
    }
    if (sc.web) {
      var wb = document.createElement("div");
      wb.className = "ssn-web";
      wb.style.width = Math.round(base * 0.9) + "px";
      wb.innerHTML = sc.web;
      layer.appendChild(wb);
    }
    if (sc.corner) {
      var c = document.createElement("div");
      c.className = "ssn-corner";
      c.style.width = Math.round(base * sc.cornerW) + "px";
      c.innerHTML = sc.corner;
      layer.appendChild(c);
    }
    if (!isStill) {
      canvas = document.createElement("canvas");
      var dpr = Math.min(2, root.devicePixelRatio || 1);
      canvas.width = Math.round(sz.w * dpr);
      canvas.height = Math.round(sz.h * dpr);
      ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        var area = (sz.w * sz.h) / (1280 * 720), f = amountFactor();
        systems = sc.moving().map(function (s) {
          var n = Math.max(6, Math.min(400, Math.round(s.n * Math.sqrt(area) * f)));
          s.sys.fit(sz.w, sz.h, n);
          return s.sys;
        });
        layer.insertBefore(canvas, layer.firstChild);
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
    var L = lang() === "el";
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "ssn-bar";
      bar.setAttribute("role", "region");
      document.body.appendChild(bar);
    }
    bar.setAttribute("aria-label", L ? "Προεπισκόπηση διακόσμησης" : "Decoration preview");
    bar.textContent = "";
    var txt = document.createElement("span");
    txt.textContent = (L ? "Προεπισκόπηση: " : "Preview: ") + name(ev);
    var keep = document.createElement("button");
    keep.type = "button"; keep.className = "ssn-main";
    keep.textContent = L ? "Κράτα το" : "Keep it";
    keep.title = L ? "Μένει μέχρι να τελειώσει η περίοδος της γιορτής" : "Stays until the event's period ends";
    keep.addEventListener("click", function () { keepPreview(); });
    var stop = document.createElement("button");
    stop.type = "button";
    stop.textContent = L ? "Τέλος" : "Stop";
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
    l.keep = { id: id, until: nextWindow(ev, today())[1] };
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
    var M = lang() === "el"
      ? ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μαΐ", "Ιουν", "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"]
      : ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return (+s.slice(8, 10)) + " " + M[+s.slice(5, 7) - 1];
  }
  function snapshot() {
    var d = load(), l = loadLocal(), s = today(), p = current();
    var auto = get(d, "on") ? activeOn(s, function (id) { return get(d, "ev." + id) === true; }) : [];
    return {
      on: get(d, "on"), motion: get(d, "motion"), amount: get(d, "amount"), xmas: get(d, "xmas"),
      reduced: reduced(), lowBattery: lowBattery,
      events: EVENTS.map(function (ev) {
        var w = nextWindow(ev, s);
        return { id: ev.id, name: name(ev), from: fmtDay(w[0]), to: fmtDay(w[1]),
                 on: get(d, "ev." + ev.id) === true, now: !!windowAt(ev, s) };
      }),
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
