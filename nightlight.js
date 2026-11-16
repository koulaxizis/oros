// ============================================================
// orOS — nightlight.js (Night Light, shell component, v1.0.0)
// ------------------------------------------------------------
// A warm screen in the evening, as GNOME's Night Light: less blue
// light after dark. A shell component like qsettings.js: it runs IN
// the shell document. shell.js calls attach() once at boot (also in a
// single app) and refresh() when the language changes. A bundle
// without this file draws exactly what it drew before.
//
//   • The filter: one element (#oros-night) over the whole shell,
//     apps' frames and the lock screen included, never under a
//     finger (pointer-events: none). It multiplies every colour by
//     the white of a warmer colour temperature (mix-blend-mode:
//     multiply), the same sum a gamma tool does on the screen's
//     ramps: red stays, green drops a little, blue drops most.
//   • When: Off, or on with one schedule: from sunset to sunrise
//     (computed here, offline, for the Weather app's place: the
//     shell's wxLoc), hours of your own (from / to, half hours), or
//     always. A schedule fades in and out over 20 minutes.
//   • Quick settings: one button. A tap turns the warm light on now
//     (until the schedule's next end) or off until the next evening;
//     the arrow opens Settings › Appearance › Night Light.
//   • Warmth: 0–100 → 5500 K … 2700 K (default 50 → 4100 K).
//
// orOS USB (oros-usb system extension): when the page has
// <html data-oros-sys-night="1">, the computer changes the screen's
// own colours (cage's gamma control). Then this file draws no filter
// and sends the DOM event "oros-night" on document with detail the
// temperature in kelvin as a string ("0" = off) whenever it changes
// by 50 K or more, so the Internet window and Tor Browser turn warm
// too. Nothing here depends on it.
//
// Storage: device-local "oros-night" (never synced: screens and
// evenings differ per device), see read()/write().
// Pure logic (sun times, schedule, fades, holds, colours) is
// unit-tested in node (tests/nightlight.test.js).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.0.0";
  var KEY = "oros-night";
  var MIN = 60000, HOUR = 3600000, DAY = 86400000;
  var FADE = 20 * MIN;
  var NEUTRAL = 6500;
  var WARM_MIN = 5500, WARM_MAX = 2700;
  var SCHEDS = ["sun", "times", "always"];
  var DEFAULTS = { on: false, sched: "sun", from: "21:00", to: "07:00", warmth: 50, hold: null };
  // Without a place for sunset: the usual evening.
  var SUN_FALLBACK = { from: "20:00", to: "07:00" };

  // ---------- 1. Model (pure) ----------
  function hm(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ""));
    if (!m) return null;
    var h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }
  function hmText(mins) {
    mins = ((Math.round(mins) % 1440) + 1440) % 1440;
    var h = Math.floor(mins / 60), m = mins % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }
  // Every half hour of the day, for the hour pickers.
  function halfHours() {
    var out = [];
    for (var i = 0; i < 48; i++) out.push(hmText(i * 30));
    return out;
  }

  function clampWarmth(v) {
    v = Number(v);
    if (!isFinite(v)) return DEFAULTS.warmth;
    return Math.max(0, Math.min(100, Math.round(v)));
  }
  // An unreadable or old value falls back field by field.
  function normalize(p) {
    var o = {};
    p = p && typeof p === "object" ? p : {};
    o.on = p.on === true;
    o.sched = SCHEDS.indexOf(p.sched) !== -1 ? p.sched : DEFAULTS.sched;
    o.from = hm(p.from) !== null ? hmText(hm(p.from)) : DEFAULTS.from;
    o.to = hm(p.to) !== null ? hmText(hm(p.to)) : DEFAULTS.to;
    if (o.from === o.to) o.to = DEFAULTS.to === o.from ? DEFAULTS.from : DEFAULTS.to;
    o.warmth = clampWarmth(p.warmth === undefined ? DEFAULTS.warmth : p.warmth);
    var h = p.hold;
    o.hold = h && typeof h === "object" && typeof h.until === "number" && isFinite(h.until) ?
      { on: h.on === true, until: h.until } : null;
    return o;
  }

  // Sunrise and sunset for the local calendar day of `dayMs` at
  // lat/lon (NOAA's sunrise equation, about a minute off), as ms.
  // { rise, set } or { polar: "day" | "night" }.
  function sunTimes(dayMs, lat, lon) {
    var d0 = new Date(dayMs);
    var rad = Math.PI / 180;
    // Days from J2000.0 to 12:00 UTC of that calendar day, then the
    // mean solar noon at this longitude (east positive).
    var n = Math.round(Date.UTC(d0.getFullYear(), d0.getMonth(), d0.getDate(), 12) / DAY + 2440587.5 - 2451545.0);
    var Jstar = n - lon / 360;
    var M = (357.5291 + 0.98560028 * Jstar) % 360;
    var C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
    var lam = (M + C + 180 + 102.9372) % 360;
    var Jtransit = 2451545.0 + Jstar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lam * rad);
    var dec = Math.asin(Math.sin(lam * rad) * Math.sin(23.4397 * rad));
    var cosw = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec));
    if (cosw < -1) return { polar: "day" };
    if (cosw > 1) return { polar: "night" };
    var w = Math.acos(cosw) / rad;
    var toMs = function (J) { return Math.round((J - 2440587.5) * DAY); };
    return { rise: toMs(Jtransit - w / 360), set: toMs(Jtransit + w / 360) };
  }

  // The local day's start (midnight) for a time.
  function dayStart(ms) {
    var d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  function addDays(dayMs, n) {
    var d = new Date(dayMs);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
  }
  function atMinutes(dayMs, mins) {
    var d = new Date(dayMs);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(mins / 60), mins % 60).getTime();
  }

  // The night that starts on local day `dayMs`: { start, end } in ms,
  // "all" (polar night: the whole day), or null (no night).
  function nightOf(p, dayMs, loc) {
    if (p.sched === "sun") {
      if (loc && typeof loc.lat === "number" && typeof loc.lon === "number") {
        var a = sunTimes(dayMs, loc.lat, loc.lon);
        if (a.polar === "night") return "all";
        if (a.polar === "day") return null;
        var b = sunTimes(addDays(dayMs, 1), loc.lat, loc.lon);
        var end = b.rise;
        if (b.polar === "night") end = addDays(dayMs, 2);
        else if (b.polar === "day") end = addDays(dayMs, 1);
        return { start: a.set, end: end };
      }
      return { start: atMinutes(dayMs, hm(SUN_FALLBACK.from)), end: atMinutes(addDays(dayMs, 1), hm(SUN_FALLBACK.to)) };
    }
    var f = hm(p.from), t = hm(p.to);
    var s = atMinutes(dayMs, f);
    var e = t > f ? atMinutes(dayMs, t) : atMinutes(addDays(dayMs, 1), t);
    return { start: s, end: e };
  }

  // The schedule's own level now, 0 … 1 (fading 20 min at each edge),
  // and the night it belongs to (for holds).
  function scheduled(p, now, loc) {
    if (p.sched === "always") return { level: 1, night: null };
    var today = dayStart(now);
    // A night that started yesterday may still run.
    for (var i = -1; i <= 0; i++) {
      var day = addDays(today, i);
      var nt = nightOf(p, day, loc);
      if (nt === "all") {
        if (now >= day && now < addDays(day, 1)) return { level: 1, night: { start: day, end: addDays(day, 1) } };
        continue;
      }
      if (!nt || now < nt.start || now >= nt.end) continue;
      var lv = Math.min(1, (now - nt.start) / FADE, (nt.end - now) / FADE);
      return { level: Math.max(0, lv), night: nt };
    }
    return { level: 0, night: null };
  }

  // The next night after `now` (its start > now), within a week.
  function nextNight(p, now, loc) {
    var today = dayStart(now);
    for (var i = 0; i <= 7; i++) {
      var day = addDays(today, i);
      var nt = nightOf(p, day, loc);
      if (nt === "all") { if (day > now) return { start: day, end: addDays(day, 1) }; continue; }
      if (nt && nt.start > now) return nt;
    }
    return null;
  }

  // What the screen shows now: { level 0…1, held, until (ms or 0) }.
  function state(p, now, loc) {
    p = normalize(p);
    if (p.hold && now < p.hold.until) {
      // Held off: "until" is when the warm light comes back.
      var back = 0;
      if (!p.hold.on && p.on) {
        if (p.sched === "always") back = p.hold.until;
        else { var nb = nextNight(p, p.hold.until - 1, loc); back = nb ? Math.max(nb.start, p.hold.until) : 0; }
      }
      return { level: p.hold.on ? 1 : 0, held: true, until: p.hold.on ? p.hold.until : back, on: p.on };
    }
    if (!p.on) return { level: 0, held: false, until: 0, on: false };
    var s = scheduled(p, now, loc);
    var until = 0;
    if (s.level > 0 && s.night) until = s.night.end;
    else if (s.level === 0 && p.sched !== "always") { var nx = nextNight(p, now, loc); until = nx ? nx.start : 0; }
    return { level: s.level, held: false, until: until, on: true };
  }

  // Quick settings' tap: the new prefs. Warm now → off until the next
  // evening (or off for "always"); not warm → warm now until the
  // schedule's next end (a sunrise, the "to" hour), turning it on.
  function toggled(p, now, loc) {
    var st = state(p, now, loc);
    var o = normalize(p);
    o.hold = null;
    if (st.level > 0) {
      // A warm "always", or a warm hold of a switched-off light: off.
      if (o.sched === "always" || !o.on) { o.on = false; return o; }
      var s = scheduled(o, now, loc);
      if (s.level > 0 && s.night) o.hold = { on: false, until: s.night.end };
      return o;
    }
    o.on = true;
    if (o.sched === "always" || scheduled(o, now, loc).level > 0) return o;
    var nx = nextNight(o, now, loc);
    o.hold = { on: true, until: nx ? nx.end : now + 12 * HOUR };
    return o;
  }

  // Warmth and level → colour temperature in kelvin.
  function kelvin(warmth, level) {
    var target = WARM_MIN + (WARM_MAX - WARM_MIN) * clampWarmth(warmth) / 100;
    var lv = Math.max(0, Math.min(1, Number(level) || 0));
    return Math.round(NEUTRAL + (target - NEUTRAL) * lv);
  }
  // The white point of a temperature (Tanner Helland's fit), scaled so
  // red is 255: what the screen's channels are multiplied by.
  function whiteOf(k) {
    var t = Math.max(1000, Math.min(NEUTRAL, k)) / 100, r, g, b;
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    if (k >= NEUTRAL) { g = 255; b = 255; }
    var c = function (v) { return Math.max(0, Math.min(255, Math.round(v))); };
    return [c(r), c(g), c(b)];
  }

  var model = { VER: VER, KEY: KEY, FADE: FADE, DEFAULTS: DEFAULTS, SCHEDS: SCHEDS, SUN_FALLBACK: SUN_FALLBACK,
                hm: hm, hmText: hmText, halfHours: halfHours, normalize: normalize, sunTimes: sunTimes,
                nightOf: nightOf, scheduled: scheduled, nextNight: nextNight, state: state, toggled: toggled,
                kelvin: kelvin, whiteOf: whiteOf };
  if (typeof module !== "undefined" && module.exports) module.exports = model;
  if (typeof document === "undefined") return;

  // ---------- 2. Shell side ----------
  var doc = document;
  var host = null, layer = null, timer = null, lastSent = null, listeners = [];

  function read() {
    try { return normalize(JSON.parse(localStorage.getItem(KEY) || "null")); }
    catch (e) { return normalize(null); }
  }
  function write(p) {
    var o = normalize(p);
    // A hold that has run out is dropped.
    if (o.hold && o.hold.until <= Date.now()) o.hold = null;
    try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {}
    apply();
    listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }
  function loc() {
    if (!host || typeof host.loc !== "function") return null;
    try { return host.loc() || null; } catch (e) { return null; }
  }
  function sysGamma() { return doc.documentElement.getAttribute("data-oros-sys-night") === "1"; }

  // The layer sits in the browser's top layer (a manual popover) and
  // is raised again whenever a modal dialog opens or something goes
  // full screen (an app's video included: its frame is the full-screen
  // element), so nothing the shell shows is left out. Older browsers
  // without popovers get the highest z-index instead.
  function ensureLayer() {
    if (layer) return layer;
    layer = doc.createElement("div");
    layer.id = "oros-night";
    layer.setAttribute("aria-hidden", "true");
    if (typeof layer.showPopover === "function") layer.setAttribute("popover", "manual");
    var s = layer.style;
    s.position = "fixed"; s.left = "0"; s.top = "0"; s.right = "0"; s.bottom = "0";
    s.width = "100vw"; s.height = "100vh"; s.maxWidth = "none"; s.maxHeight = "none";
    s.margin = "0"; s.padding = "0"; s.border = "0"; s.overflow = "hidden";
    s.pointerEvents = "none"; s.zIndex = "2147483647";
    s.mixBlendMode = "multiply";
    s.transition = "background-color 1.5s ease";
    s.backgroundColor = "rgb(255,255,255)";
    doc.body.appendChild(layer);
    try {
      new MutationObserver(function () { if (shown) raise(); })
        .observe(doc.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
    } catch (e) {}
    doc.addEventListener("fullscreenchange", function () { if (shown) raise(); });
    return layer;
  }
  var shown = false, fadeTimer = 0;
  function currentK() {
    var p = read(), st = state(p, Date.now(), loc());
    return st.level > 0 && !sysGamma() ? kelvin(p.warmth, st.level) : 0;
  }
  function raise() {
    if (!layer) return;
    if (typeof layer.showPopover !== "function") { layer.style.display = ""; return; }
    try {
      if (layer.matches(":popover-open")) layer.hidePopover();
      layer.showPopover();
    } catch (e) {}
  }
  function hideLayer() {
    shown = false;
    if (!layer) return;
    try { if (typeof layer.hidePopover === "function" && layer.matches(":popover-open")) layer.hidePopover(); } catch (e) {}
    layer.style.display = "none";
  }

  function apply() {
    if (!host) return;
    var p = read(), now = Date.now();
    var st = state(p, now, loc());
    var k = st.level > 0 ? kelvin(p.warmth, st.level) : 0;
    if (sysGamma()) {
      hideLayer();
      send(k);
      return;
    }
    if (lastSent !== null && lastSent !== 0) send(0);   // the extension went away
    if (!k) {
      // Fade back to white, then leave the top layer.
      if (shown && layer) {
        layer.style.backgroundColor = "rgb(255,255,255)";
        clearTimeout(fadeTimer);
        fadeTimer = setTimeout(function () { if (!currentK()) hideLayer(); }, 1600);
      }
      return;
    }
    clearTimeout(fadeTimer);
    var w = whiteOf(k);
    var l = ensureLayer();
    l.style.backgroundColor = "rgb(" + w.join(",") + ")";
    l.style.display = "block";
    if (!shown) { shown = true; raise(); }
  }

  function send(k) {
    if (lastSent !== null && Math.abs(k - lastSent) < 50 && !(k === 0 && lastSent !== 0)) return;
    lastSent = k;
    try { doc.dispatchEvent(new CustomEvent("oros-night", { detail: String(k) })); } catch (e) {}
  }

  // For Settings and Quick settings.
  function snapshot() {
    var p = read(), now = Date.now(), L = loc();
    var st = state(p, now, L);
    var sun = null;
    if (L && typeof L.lat === "number" && typeof L.lon === "number") {
      // This evening's sunset and the next morning's sunrise.
      var a = sunTimes(now, L.lat, L.lon), b = sunTimes(addDays(dayStart(now), 1), L.lat, L.lon);
      sun = { place: L.label || "", polar: a.polar || "", set: a.set || 0, rise: b.rise || 0 };
    }
    return { on: p.on, sched: p.sched, from: p.from, to: p.to, warmth: p.warmth,
             active: st.level > 0, held: st.held, until: st.until, sun: sun,
             fallback: SUN_FALLBACK, hours: halfHours(), gamma: sysGamma() };
  }

  function set(name, value) {
    var p = read();
    switch (name) {
      case "on": p.on = !!value; p.hold = null; break;
      case "sched": if (SCHEDS.indexOf(value) !== -1) { p.sched = value; p.hold = null; } break;
      case "from": if (hm(value) !== null) { p.from = value; p.hold = null; } break;
      case "to": if (hm(value) !== null) { p.to = value; p.hold = null; } break;
      case "warmth": p.warmth = clampWarmth(value); break;
      default: return;
    }
    write(p);
  }

  function toggleNow() { write(toggled(read(), Date.now(), loc())); }

  function attach(h) {
    if (host) return;
    host = h || {};
    apply();
    // The schedule's fades: a small step every 30 s is enough.
    timer = setInterval(apply, 30000);
    // Settings in another window of this device.
    root.addEventListener("storage", function (e) { if (e.key === KEY) { apply(); listeners.forEach(function (fn) { try { fn(); } catch (x) {} }); } });
    // orOS USB's extension sets data-oros-sys-night after the page starts.
    try {
      new MutationObserver(function () { lastSent = null; apply(); })
        .observe(doc.documentElement, { attributes: true, attributeFilter: ["data-oros-sys-night"] });
    } catch (e) {}
    doc.addEventListener("visibilitychange", function () { if (doc.visibilityState === "visible") apply(); });
  }

  root.orosNight = {
    VER: VER,
    model: model,
    attach: attach,
    snapshot: snapshot,
    set: set,
    toggleNow: toggleNow,
    isActive: function () { return state(read(), Date.now(), loc()).level > 0; },
    onChange: function (fn) {
      if (typeof fn !== "function") return function () {};
      listeners.push(fn);
      return function () { var i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); };
    },
    refresh: function () { lastSent = null; apply(); }
  };
})(typeof window !== "undefined" ? window : globalThis);
