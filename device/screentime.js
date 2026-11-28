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
// Daily limits (S2, Chris 2026-11-17 decision 1): a limit per app in
// minutes. 5 minutes before it a quiet toast; at the limit a
// «Time for a break?» card over the app (a modal <dialog> in the
// shell): the app stays open and loaded under it, nothing is lost,
// one tap goes on: "15 more minutes" (Escape too) or "No more
// reminders today", or "Go to the desktop". Never a block, never on
// Settings. The menu marks an app past its limit with an hourglass.
//
// Storage: device-local "oros-screentime" = { v: 1, on, days:
// { "YYYY-MM-DD": { <app id>: seconds } }, limits: { <app id>:
// minutes }, remind: { day, apps: { <id>: { w: 1 warned, s: seconds
// of the next card, d: 1 no more today } } } }; other top-level
// fields (bedtime: a later wave) are kept as they are. Days older
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
  var LIMITS = [15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480];   // minutes
  var NO_LIMIT = ["settings"];     // never limited
  var WARN = 5 * 60;               // seconds before the limit: a quiet toast
  var MORE = 15 * 60;              // "15 more minutes"
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
  function limitable(id) { return validId(id) && id.charAt(0) !== "~" && NO_LIMIT.indexOf(id) === -1; }
  function cleanLimits(v) {
    var o = {};
    if (!v || typeof v !== "object" || Array.isArray(v)) return o;
    Object.keys(v).forEach(function (id) {
      var m = Number(v[id]);
      if (limitable(id) && LIMITS.indexOf(m) !== -1) o[id] = m;
    });
    return o;
  }
  // Reminder state belongs to one day; another day starts clean.
  function cleanRemind(v, today) {
    var o = { day: today, apps: {} };
    if (!v || typeof v !== "object" || v.day !== today || !v.apps || typeof v.apps !== "object") return o;
    Object.keys(v.apps).forEach(function (id) {
      var r = v.apps[id];
      if (!limitable(id) || !r || typeof r !== "object") return;
      var c = {};
      if (r.w === 1) c.w = 1;
      if (r.d === 1) c.d = 1;
      var sn = Math.floor(Number(r.s));
      if (isFinite(sn) && sn > 0) c.s = Math.min(86400, sn);
      if (c.w || c.d || c.s) o.apps[id] = c;
    });
    return o;
  }
  // ---------- Bedtime (S3) ----------
  // { on, from, to (minutes after midnight, half hours), days (weekdays
  // of the evening it starts, 0 = Sunday), sleep (also Sleep focus),
  // skip / warned / slept (the evening's day key: "Not tonight", the
  // notice 15 minutes before, Sleep focus started) }.
  var BED_DEFAULT = { on: false, from: 23 * 60, to: 7 * 60, days: [0, 1, 2, 3, 4, 5, 6], sleep: false };
  var BED_WARN = 15 * 60000;
  var BED_FADE = 60000;
  function halfHour(v, dflt) {
    var n = Number(v);
    return isFinite(n) && n >= 0 && n < 1440 && n % 30 === 0 ? n : dflt;
  }
  function cleanBed(v) {
    v = v && typeof v === "object" && !Array.isArray(v) ? v : {};
    var o = { on: v.on === true, from: halfHour(v.from, BED_DEFAULT.from), to: halfHour(v.to, BED_DEFAULT.to),
              days: BED_DEFAULT.days.slice(), sleep: v.sleep === true };
    if (Array.isArray(v.days)) {
      o.days = [0, 1, 2, 3, 4, 5, 6].filter(function (d) { return v.days.indexOf(d) !== -1; });
    }
    if (o.from === o.to) o.to = (o.from + 30) % 1440;    // never a night of no length
    ["skip", "warned", "slept"].forEach(function (k) { if (typeof v[k] === "string" && isFinite(dayMs(v[k]))) o[k] = v[k]; });
    return o;
  }
  // The night around `now`: { active, key (its evening), end, next
  // (the next start), nextKey }. Local time, so a night across a clock
  // change keeps its wall-clock hours.
  function bedNight(bed, now) {
    var b = cleanBed(bed), out = { active: false, key: "", end: 0, next: 0, nextKey: "" };
    if (!b.on || !b.days.length) return out;
    var base = new Date(now);
    for (var i = -1; i <= 7; i++) {
      var y = base.getFullYear(), m = base.getMonth(), d = base.getDate() + i;
      var st = new Date(y, m, d, Math.floor(b.from / 60), b.from % 60).getTime();
      var wd = new Date(y, m, d).getDay();
      if (b.days.indexOf(wd) === -1) continue;
      var en = new Date(y, m, d + (b.to <= b.from ? 1 : 0), Math.floor(b.to / 60), b.to % 60).getTime();
      var key = dayKey(new Date(y, m, d).getTime());
      if (now >= st && now < en && !out.active) { out.active = true; out.key = key; out.end = en; }
      if (st > now && !out.next) { out.next = st; out.nextKey = key; }
    }
    return out;
  }
  // What bedtime wants now: grey on, the notice due, Sleep focus due.
  function bedWants(bed, now) {
    var b = cleanBed(bed), n = bedNight(b, now);
    return {
      night: n,
      grey: n.active && b.skip !== n.key,
      warn: !n.active && !!n.next && n.next - now <= BED_WARN && b.warned !== n.nextKey && b.skip !== n.nextKey,
      sleep: n.active && b.sleep && b.skip !== n.key && b.slept !== n.key
    };
  }

  // An unreadable or old value falls back field by field; fields of
  // later waves ride along untouched.
  function normalize(p, today) {
    var o = {};
    p = p && typeof p === "object" && !Array.isArray(p) ? p : {};
    Object.keys(p).forEach(function (k) { if (["v", "on", "days", "limits", "remind", "bed"].indexOf(k) === -1) o[k] = p[k]; });
    o.v = 1;
    o.on = p.on === true;
    o.days = prune(p.days, today);
    o.limits = cleanLimits(p.limits);
    o.remind = cleanRemind(p.remind, today);
    o.bed = cleanBed(p.bed);
    return o;
  }
  // What is due for `id` that has been used `used` seconds today:
  // "card" (at the limit, or at the end of "15 more minutes"), "warn"
  // (5 minutes before, once), or "" (nothing, no limit, no more today).
  function due(p, id, used) {
    var lim = (p.limits || {})[id];
    if (!lim || !limitable(id)) return "";
    var r = (p.remind && p.remind.apps && p.remind.apps[id]) || {};
    if (r.d) return "";
    var at = r.s || lim * 60;
    if (used >= at) return "card";
    if (!r.w && !r.s && lim * 60 > WARN && used >= lim * 60 - WARN) return "warn";
    return "";
  }
  // The reminder state after an answer: "warned", "more" (15 more
  // minutes from `used`), "done" (no more today).
  function answered(p, id, what, used) {
    var o = normalize(p, p.remind ? p.remind.day : "");
    var r = o.remind.apps[id] || (o.remind.apps[id] = {});
    if (what === "warned") r.w = 1;
    else if (what === "more") r.s = Math.min(86400, Math.floor(used) + MORE);
    else if (what === "done") r.d = 1;
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
                stepOf: stepOf, dayView: dayView, lastDays: lastDays,
                LIMITS: LIMITS, NO_LIMIT: NO_LIMIT, WARN: WARN, MORE: MORE, limitable: limitable, due: due, answered: answered,
                BED_DEFAULT: BED_DEFAULT, BED_WARN: BED_WARN, cleanBed: cleanBed, bedNight: bedNight, bedWants: bedWants };
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
    checkLimit();
    checkBed();
  }

  // ---------- 3. Daily limits (S2) ----------
  function tr(key, vars) {
    var v = key;
    try { v = typeof root.t === "function" ? root.t(key) : key; } catch (e) {}
    Object.keys(vars || {}).forEach(function (k) { v = v.split("{" + k + "}").join(vars[k]); });
    return v;
  }
  function dur(secs) {
    var m = Math.max(0, Math.floor(secs / 60));
    if (m < 60) return tr("st.fmt.m", { m: m });
    if (m % 60 === 0) return tr("st.fmt.h", { h: m / 60 });
    return tr("st.fmt.hm", { h: Math.floor(m / 60), m: m % 60 });
  }
  function nameOf(id) {
    var n = "";
    if (host && typeof host.appName === "function") { try { n = host.appName(id) || ""; } catch (e) {} }
    return n || id;
  }
  function usedToday(p, id) {
    var t = today(), d = p.days[t] || {}, secs = d[id] || 0;
    if (pend[t] && pend[t][id]) secs += pend[t][id] / 1000;
    return secs;
  }
  var dlg = null, dlgFor = "";
  function checkLimit() {
    if (!host || (dlg && dlg.open)) return;
    if (doc.visibilityState !== "visible" || call("locked", false) || call("sensitive", false)) return;
    var id = call("front", "");
    if (!limitable(id)) return;
    var p = read();
    if (!p.on || !p.limits[id]) return;
    var used = usedToday(p, id), what = due(p, id, used);
    if (what === "warn") {
      write(answered(p, id, "warned", used));
      var nm = nameOf(id);
      if (host && typeof host.toast === "function") {
        try { host.toast(tr("st.warn.title", { app: nm }), tr("st.warn.body", { app: nm, limit: dur(p.limits[id] * 60) })); } catch (e) {}
      }
    } else if (what === "card") showCard(id, used, p.limits[id]);
    overAt = 0;
  }
  function answer(what) {
    var id = dlgFor;
    if (!id) return;
    var p = read();
    write(answered(p, id, what === "home" ? "more" : what, usedToday(p, id)));
    dlgFor = "";
    overAt = 0;
    try { if (dlg.open) dlg.close(); } catch (e) {}
    if (what === "home" && host && typeof host.home === "function") { try { host.home(); } catch (e) {} }
  }
  function btn(cls, key, what) {
    var b = doc.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = tr(key);
    b.addEventListener("click", function () { answer(what); });
    return b;
  }
  var CSS =
    "#oros-st-pause{border:1px solid var(--border,#322d20);border-radius:18px;padding:22px 20px 18px;max-width:min(420px,calc(100vw - 32px));" +
    "background:var(--panel-bg,#1d1a13);color:var(--text,#f0ead9);box-shadow:0 18px 50px var(--shadow,rgba(0,0,0,.5));font:inherit}" +
    "#oros-st-pause::backdrop{background:rgba(0,0,0,.45)}" +
    "#oros-st-pause h2{margin:0 0 8px;font-size:20px;outline:none}" +
    "#oros-st-pause p{margin:0 0 8px;line-height:1.45;font-size:15px}" +
    "#oros-st-pause .st-p-note{color:var(--text-dim,#a89f8a);font-size:13px}" +
    "#oros-st-pause .st-p-acts{display:flex;flex-direction:column;gap:8px;margin-top:14px}" +
    "#oros-st-pause button{min-height:44px;border-radius:12px;border:1px solid var(--border,#322d20);background:none;color:inherit;font:inherit;font-weight:700;cursor:pointer;padding:8px 14px}" +
    "#oros-st-pause button.st-p-main{background:var(--accent,#d4af37);border-color:var(--accent,#d4af37);color:var(--accent-ink,#14120d)}" +
    "#oros-st-pause button:focus-visible{outline:2px solid var(--accent,#d4af37);outline-offset:2px}";
  function showCard(id, used, lim) {
    if (!doc.body) return;
    if (!dlg) {
      var st = doc.createElement("style");
      st.textContent = CSS;
      doc.head.appendChild(st);
      dlg = doc.createElement("dialog");
      dlg.id = "oros-st-pause";
      dlg.setAttribute("aria-labelledby", "oros-st-pause-t");
      dlg.setAttribute("aria-describedby", "oros-st-pause-b");
      // Escape is "15 more minutes": the card never traps anyone.
      // Browsers may close a modal on Escape without a cancelable
      // cancel (no user activation), so a close the card did not make
      // is "15 more minutes" too.
      dlg.addEventListener("cancel", function (e) { e.preventDefault(); answer("more"); });
      dlg.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); answer("more"); } });
      dlg.addEventListener("close", function () { if (dlgFor) answer("more"); });
      doc.body.appendChild(dlg);
    }
    dlgFor = id;
    while (dlg.firstChild) dlg.removeChild(dlg.firstChild);
    var h = doc.createElement("h2");
    h.id = "oros-st-pause-t";
    h.tabIndex = -1;
    h.textContent = tr("st.pause.title");
    var b = doc.createElement("p");
    b.id = "oros-st-pause-b";
    b.textContent = tr("st.pause.body", { app: nameOf(id), used: dur(used), limit: dur(lim * 60) });
    var n = doc.createElement("p");
    n.className = "st-p-note";
    n.textContent = tr("st.pause.note");
    var acts = doc.createElement("div");
    acts.className = "st-p-acts";
    var more = btn("st-p-main", "st.pause.more", "more");
    acts.appendChild(more);
    acts.appendChild(btn("", "st.pause.done", "done"));
    acts.appendChild(btn("", "st.pause.home", "home"));
    dlg.appendChild(h);
    dlg.appendChild(b);
    dlg.appendChild(n);
    dlg.appendChild(acts);
    try { if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", ""); } catch (e) { dlg.setAttribute("open", ""); }
    try { more.focus(); } catch (e) {}
  }

  // ---------- 4. Bedtime (S3) ----------
  // Every tick, counting on or off: the grey overlay (through the
  // colour filters' overlay, host.grey; it fades in and out over a
  // minute), the quiet notice 15 minutes before with "Not tonight",
  // and, if chosen, Sleep focus until the night ends (host.focus()).
  var greyOn = null;
  function hm(mins) { var h = Math.floor(mins / 60), m = mins % 60; return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m; }
  function focusApi() {
    var F = host && typeof host.focus === "function" ? call("focus", null) : null;
    return F && typeof F.start === "function" ? F : null;
  }
  function setGrey(on) {
    if (greyOn === on) return;
    greyOn = on;
    if (host && typeof host.grey === "function") { try { host.grey(on, BED_FADE); } catch (e) {} }
  }
  function checkBed() {
    if (!host) return;
    var p = read(), now = Date.now(), w = bedWants(p.bed, now);
    setGrey(w.grey);
    if (w.warn) {
      p.bed.warned = w.night.nextKey;
      write(p);
      var key = w.night.nextKey;
      if (typeof host.toast === "function") {
        try {
          host.toast(tr("st.bed.warn.title"), tr("st.bed.warn.body", { time: hm(p.bed.from) }),
            { label: tr("st.bed.skip"), fn: function () { bedSkip(true, key); } });
        } catch (e) {}
      }
    }
    if (w.sleep) {
      var F = focusApi();
      if (F) {
        p.bed.slept = w.night.key;
        write(p);
        try { F.start("sleep", { until: w.night.end }); } catch (e) {}
      }
    }
  }
  // "Not tonight": the night that runs now or comes next; false = on again.
  function bedSkip(on, key) {
    var p = read(), n = bedNight(p.bed, Date.now());
    key = key || (n.active ? n.key : n.nextKey);
    if (!key) return;
    if (on) {
      p.bed.skip = key;
      // Sleep focus that bedtime started tonight ends with it.
      var F = focusApi();
      if (F && p.bed.slept === key && n.active && n.key === key) {
        try { var a = F.active(Date.now()); if (a && a.id === "sleep") F.stop(); } catch (e) {}
      }
    } else if (p.bed.skip === key) delete p.bed.skip;
    write(p);
    checkBed();
  }
  function setBed(patch) {
    var p = read(), b = p.bed;
    patch = patch && typeof patch === "object" ? patch : {};
    if ("on" in patch) b.on = patch.on === true;
    if ("from" in patch) b.from = halfHour(patch.from, b.from);
    if ("to" in patch) b.to = halfHour(patch.to, b.to);
    if (Array.isArray(patch.days)) b.days = patch.days;
    if ("sleep" in patch) b.sleep = patch.sleep === true;
    p.bed = cleanBed(b);
    write(p);
    checkBed();
  }
  function bedSnapshot() {
    var p = read(), now = Date.now(), n = bedNight(p.bed, now), b = p.bed;
    return { on: b.on, from: b.from, to: b.to, days: b.days.slice(), sleep: b.sleep,
             active: n.active, end: n.end, next: n.next,
             skipped: !!b.skip && b.skip === (n.active ? n.key : n.nextKey),
             grey: n.active && b.skip !== n.key, focus: !!focusApi() };
  }

  // Apps past today's limit, for the menu's hourglass (cached 5 s).
  var overAt = 0, overSet = {};
  function over(id) {
    var now = Date.now();
    if (now - overAt > 5000) {
      overAt = now;
      overSet = {};
      var p = read();
      if (p.on) Object.keys(p.limits).forEach(function (a) { if (usedToday(p, a) >= p.limits[a] * 60) overSet[a] = 1; });
    }
    return !!overSet[id];
  }
  // The apps past their limit, for the menu to know when to redraw.
  function overKey() { over(""); return Object.keys(overSet).sort().join(","); }
  function setLimit(id, mins) {
    var p = read();
    mins = Number(mins) || 0;
    if (!limitable(id)) return;
    if (mins && LIMITS.indexOf(mins) === -1) return;
    if ((p.limits[id] || 0) === mins) return;
    if (mins) p.limits[id] = mins; else delete p.limits[id];
    delete p.remind.apps[id];      // a new limit starts its reminders again
    write(p);
    overAt = 0;
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
    var used = {}, limitNames = {};
    Object.keys(p.limits).forEach(function (id) { used[id] = Math.floor(usedToday(p, id)); limitNames[id] = name(id); });
    return { on: p.on, today: t, days: days, has: Object.keys(p.days).length > 0, keep: KEEP_DAYS,
             limits: p.limits, used: used, limitNames: limitNames, choices: LIMITS.slice(), noLimit: NO_LIMIT.slice(), bed: bedSnapshot() };
  }

  // The Screen time bar card (STC-1, smartbar-apps.js): today's total
  // and its apps, longest first, with the time not written yet. Reads
  // only; names come from the shell ("" for the desktop and Sensitive work).
  function todayUse() {
    var p = read(), t = today();
    if (!p.on) return { on: false, total: 0, apps: [] };
    var src = p.days[t] || {}, d = {};
    Object.keys(src).forEach(function (id) { d[id] = src[id]; });
    if (pend[t]) Object.keys(pend[t]).forEach(function (id) { d[id] = (d[id] || 0) + pend[t][id] / 1000; });
    var one = {}; one[t] = d;
    var v = dayView({ days: one }, t);
    return { on: true, total: Math.floor(v.total), apps: v.apps.map(function (a) {
      return { id: a.id, name: a.id === DESK || a.id === SENS ? "" : nameOf(a.id), secs: Math.floor(a.secs) };
    }) };
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
    checkBed();     // a night already running greys the screen from the start
  }

  root.orosScreenTime = {
    VER: VER,
    model: model,
    attach: attach,
    note: note,
    snapshot: snapshot,
    todayUse: todayUse,
    setOn: setOn,
    clear: clear,
    setLimit: setLimit,
    over: over,
    overKey: overKey,
    bed: bedSnapshot,
    setBed: setBed,
    bedSkip: function (on) { bedSkip(!!on); }
  };
})(typeof window !== "undefined" ? window : globalThis);
