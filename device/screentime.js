// ============================================================
// orOS — device/screentime.js (Screen time, shell component, v1.0.0)
// ------------------------------------------------------------
// How long each app was in front, per day, on THIS device, as
// Android's Digital Wellbeing and iOS's Screen Time do. A shell
// component like nightlight.js: it runs IN the shell document, from
// the late bundle (in device/, next to Settings › Device, like
// device/screens.js). shell.js calls attach() once (also in a single
// app) and note() right before the app in front changes. A bundle
// without this file draws and counts nothing.
//
//   • Off by default. Settings › Screen time turns it on.
//   • What counts: every 15 s (a tick) the time since the last tick
//     goes to the app in front ("~desk" when no app runs, "~sens"
//     while Sensitive work is on: names are never written then), and
//     only while orOS is on screen (visible), unlocked and in use:
//     this window has the focus and there was a tap, key, wheel or
//     mouse move in the last 5 minutes, or sound or video plays.
//     A gap longer than two ticks (the device slept, the browser
//     paused orOS) counts nothing. Side by side: the app whose frame
//     has the focus.
//   • Input inside app frames: same-origin frame documents (the
//     shell's __orosAppDocs, through host.docs()) get the same
//     passive listeners once each.
//   • Two orOS windows: only the one with the focus counts (sound or
//     video in a window without the focus counts too; rare).
//
// Privacy (Chris 2026-11-17, ST-1): the key is device-local and holds
// only day → app → seconds. Never synced (no slice), never in a
// backup or export, never in the Device report (which measures every
// key's size only), never read by Assistant, orOS Gate, Today or
// Automations, never sent anywhere.
//
// Storage: device-local "oros-screentime" = { v: 1, on, days:
// { "YYYY-MM-DD": { <app id>: seconds } } }; other top-level fields
// (limits, bedtime: later waves) are kept as they are. Days older
// than 4 weeks (KEEP_DAYS, Chris 2026-11-17) are dropped. Seconds
// collect in memory and are written at most once a minute (and when
// orOS goes out of sight), added to what is stored, so two windows
// never overwrite each other's time; no change, no write.
// Pure logic is unit-tested in node (tests/screentime.test.js).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.0.0";
  var KEY = "oros-screentime";
  var KEEP_DAYS = 28;
  var TICK = 15000;
  var MAX_STEP = 2 * TICK;
  var IDLE = 5 * 60000;
  var FLUSH = 60000;
  var MAX_APPS = 300;             // ids per day, a guard against junk
  var DESK = "~desk", SENS = "~sens";
  var ID_RE = /^(~desk|~sens|[a-z0-9][a-z0-9_-]{0,47})$/;
  var DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  // ---------- 1. Model (pure) ----------
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dayKey(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function dayMs(key) {
    var m = DAY_RE.exec(String(key || ""));
    if (!m) return NaN;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return dayKey(d.getTime()) === key ? d.getTime() : NaN;
  }
  function addDays(key, n) {
    var t = dayMs(key);
    if (!isFinite(t)) return "";
    var d = new Date(t);
    return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime());
  }
  function validId(id) { return typeof id === "string" && ID_RE.test(id); }

  function cleanDay(v) {
    var o = {}, n = 0;
    if (!v || typeof v !== "object" || Array.isArray(v)) return o;
    Object.keys(v).forEach(function (id) {
      if (n >= MAX_APPS || !validId(id)) return;
      var s = Math.floor(Number(v[id]));
      if (!isFinite(s) || s <= 0) return;
      o[id] = Math.min(86400, s);
      n++;
    });
    return o;
  }
  // The days to keep for `today`: valid dates from KEEP_DAYS-1 days
  // back to one day ahead (a clock that was wrong for a while).
  function prune(days, today) {
    var out = {}, first = addDays(today, -(KEEP_DAYS - 1)), last = addDays(today, 1);
    if (!days || typeof days !== "object") return out;
    Object.keys(days).forEach(function (k) {
      if (!isFinite(dayMs(k)) || k < first || k > last) return;
      var d = cleanDay(days[k]);
      if (Object.keys(d).length) out[k] = d;
    });
    return out;
  }
  // An unreadable or old value falls back field by field; fields of
  // later waves ride along untouched.
  function normalize(p, today) {
    var o = {};
    p = p && typeof p === "object" && !Array.isArray(p) ? p : {};
    Object.keys(p).forEach(function (k) { if (k !== "v" && k !== "on" && k !== "days") o[k] = p[k]; });
    o.v = 1;
    o.on = p.on === true;
    o.days = prune(p.days, today);
    return o;
  }
  // Seconds added: { day: { id: secs } } onto p.days (a copy).
  function addAll(p, add, today) {
    var o = normalize(p, today);
    Object.keys(add || {}).forEach(function (day) {
      if (!isFinite(dayMs(day))) return;
      var src = add[day] || {};
      var d = o.days[day] || {};
      Object.keys(src).forEach(function (id) {
        var s = Math.floor(Number(src[id]));
        if (!validId(id) || !isFinite(s) || s <= 0) return;
        if (!(id in d) && Object.keys(d).length >= MAX_APPS) return;
        d[id] = Math.min(86400, (d[id] || 0) + s);
      });
      if (Object.keys(d).length) o.days[day] = d;
    });
    o.days = prune(o.days, today);
    return o;
  }

  // Does this tick count? c = { on, visible, locked, focused, media, idle }
  function counts(c) {
    if (!c || !c.on || !c.visible || c.locked) return false;
    if (c.media) return true;
    return !!c.focused && Number(c.idle) < IDLE;
  }
  // Where a counted tick goes.
  function bucket(front, sensitive) {
    if (sensitive) return SENS;
    return validId(front) && front.charAt(0) !== "~" ? front : DESK;
  }
  // How much of a step counts: nothing for a gap (sleep, a paused tab).
  function stepOf(ms) {
    ms = Number(ms);
    return isFinite(ms) && ms > 0 && ms <= MAX_STEP ? ms : 0;
  }

  // One day for Settings: { day, total, apps: [{ id, secs }] }, longest first.
  function dayView(p, day) {
    var d = (p.days && p.days[day]) || {}, total = 0;
    var apps = Object.keys(d).map(function (id) { total += d[id]; return { id: id, secs: d[id] }; });
    apps.sort(function (a, b) { return b.secs - a.secs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
    return { day: day, total: total, apps: apps };
  }
  // The last `n` days up to today, oldest first.
  function lastDays(p, today, n) {
    var out = [];
    for (var i = (n || 7) - 1; i >= 0; i--) out.push(dayView(p, addDays(today, -i)));
    return out;
  }

  var model = { VER: VER, KEY: KEY, KEEP_DAYS: KEEP_DAYS, TICK: TICK, MAX_STEP: MAX_STEP, IDLE: IDLE,
                DESK: DESK, SENS: SENS, dayKey: dayKey, dayMs: dayMs, addDays: addDays, validId: validId,
                prune: prune, normalize: normalize, addAll: addAll, counts: counts, bucket: bucket,
                stepOf: stepOf, dayView: dayView, lastDays: lastDays };
  if (typeof module !== "undefined" && module.exports) module.exports = model;
  if (typeof document === "undefined") return;

  // ---------- 2. Shell side ----------
  var doc = document;
  var host = null, timer = 0, lastTick = 0, lastInput = 0, lastFlush = 0;
  var pend = {}, pendMs = 0;      // { day: { id: ms } } not written yet
  var wired = typeof WeakSet === "function" ? new WeakSet() : null;

  function today() { return dayKey(Date.now()); }
  function read() {
    try { return normalize(JSON.parse(localStorage.getItem(KEY) || "null"), today()); }
    catch (e) { return normalize(null, today()); }
  }
  function write(p) {
    try { localStorage.setItem(KEY, JSON.stringify(p)); return true; } catch (e) { return false; }
  }
  function call(name, dflt) {
    if (!host || typeof host[name] !== "function") return dflt;
    try { return host[name](); } catch (e) { return dflt; }
  }

  function poke() { lastInput = Date.now(); }
  function wire(d) {
    if (!d || !d.addEventListener) return;
    if (wired) { if (wired.has(d)) return; wired.add(d); }
    else { if (d.__orosStWired) return; d.__orosStWired = 1; }
    var opt = { capture: true, passive: true };
    ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"].forEach(function (ev) {
      try { d.addEventListener(ev, poke, opt); } catch (e) {}
    });
  }
  function docs() {
    var out = [doc];
    var more = call("docs", []);
    if (Array.isArray(more)) more.forEach(function (d) { if (d && out.indexOf(d) === -1) out.push(d); });
    return out;
  }
  // Sound or video playing: the shell's players (Music, Podcasts,
  // Radio through host.media()) or a <video>/<audio> in a frame.
  function mediaOn(list) {
    if (call("media", false)) return true;
    for (var i = 0; i < list.length; i++) {
      var els;
      try { els = list[i].querySelectorAll("video, audio"); } catch (e) { continue; }
      for (var j = 0; j < els.length; j++) {
        var m = els[j];
        if (!m.paused && !m.ended && m.readyState > 2 && !m.muted) return true;
      }
    }
    return false;
  }
  function focused() {
    try { return doc.hasFocus(); } catch (e) { return false; }
  }

  // seen: orOS was on screen until now (it is going out of sight).
  function accrue(on, seen) {
    var now = Date.now();
    var step = stepOf(now - lastTick);
    lastTick = now;
    var list = docs();
    list.forEach(wire);
    if (!on || !step) return;
    var c = { on: true, visible: !!seen || doc.visibilityState === "visible", locked: !!call("locked", false),
              focused: focused(), media: false, idle: now - lastInput };
    if (!(c.visible && !c.locked)) return;
    if (!(c.focused && c.idle < IDLE)) c.media = mediaOn(list);
    if (!counts(c)) return;
    var id = bucket(call("front", ""), !!call("sensitive", false));
    var day = dayKey(now - step / 2);
    var d = pend[day] || (pend[day] = {});
    d[id] = (d[id] || 0) + step;
    pendMs += step;
  }

  // Whole seconds go to storage, the rest stays for the next time.
  function flush() {
    lastFlush = Date.now();
    if (!pendMs) return;
    var add = {}, any = false;
    Object.keys(pend).forEach(function (day) {
      Object.keys(pend[day]).forEach(function (id) {
        var s = Math.floor(pend[day][id] / 1000);
        if (s <= 0) return;
        (add[day] = add[day] || {})[id] = s;
        pend[day][id] -= s * 1000;
        any = true;
      });
    });
    if (!any) return;
    var p = read();
    if (!p.on) { pend = {}; pendMs = 0; return; }   // turned off in another window
    write(addAll(p, add, today()));
    var left = 0, keep = {};
    Object.keys(pend).forEach(function (day) {
      Object.keys(pend[day]).forEach(function (id) {
        if (pend[day][id] > 0) { (keep[day] = keep[day] || {})[id] = pend[day][id]; left += pend[day][id]; }
      });
    });
    pend = keep; pendMs = left;
  }

  var onCache = { at: 0, v: false };
  function isOn() {
    var now = Date.now();
    if (now - onCache.at > 5000) { onCache.at = now; onCache.v = read().on; }
    return onCache.v;
  }
  function tick() {
    accrue(isOn());
    if (Date.now() - lastFlush >= FLUSH) flush();
  }

  // Right before the app in front changes (shell.js openApp,
  // returnToDesktop): the time so far goes to the one leaving.
  function note() {
    if (!host) return;
    accrue(isOn());
  }

  function snapshot() {
    if (host) { accrue(isOn()); flush(); }
    var p = read(), t = today();
    var name = function (id) {
      if (id === DESK || id === SENS) return "";
      var n = "";
      if (host && typeof host.appName === "function") { try { n = host.appName(id) || ""; } catch (e) {} }
      return n || id;
    };
    var days = lastDays(p, t, 7).map(function (d) {
      return { day: d.day, total: d.total, apps: d.apps.map(function (a) { return { id: a.id, name: name(a.id), secs: a.secs }; }) };
    });
    return { on: p.on, today: t, days: days, has: Object.keys(p.days).length > 0, keep: KEEP_DAYS };
  }

  function setOn(v) {
    var p = read();
    v = !!v;
    if (p.on === v) return;
    if (v) { lastInput = Date.now(); lastTick = Date.now(); }
    else { pend = {}; pendMs = 0; }
    p.on = v;
    write(p);
    onCache.at = 0;
  }
  function clear() {
    pend = {}; pendMs = 0;
    var p = read();
    if (!Object.keys(p.days).length) return;
    p.days = {};
    write(p);
  }

  function attach(h) {
    if (host) return;
    host = h || {};
    lastTick = lastFlush = lastInput = Date.now();
    wire(doc);
    timer = setInterval(tick, TICK);
    doc.addEventListener("visibilitychange", function () {
      if (doc.visibilityState === "hidden") { accrue(isOn(), true); flush(); }
      else { lastTick = Date.now(); poke(); }   // the time away counts nothing
    });
    root.addEventListener("pagehide", function () { accrue(isOn(), true); flush(); });
    root.addEventListener("focus", poke);
    root.addEventListener("storage", function (e) { if (e.key === KEY) onCache.at = 0; });
  }

  root.orosScreenTime = {
    VER: VER,
    model: model,
    attach: attach,
    note: note,
    snapshot: snapshot,
    setOn: setOn,
    clear: clear
  };
})(typeof window !== "undefined" ? window : globalThis);
