// orOS focus modes (FOCUS-1, wave F1): Do Not Disturb, Sleep, Work,
// Personal and up to 10 own modes. A mode decides only whether a
// notification pops up and sounds; every notification still enters
// the bell (nothing is ever dropped).
//
// Chris 2026-11-17 (big-OS ideas, item 1, "Ναι, όλο"); decisions:
//   D1 23:17Z: the active mode holds on ALL devices (synced).
//   D2 23:23Z: Do Not Disturb and quiet hours became modes (quiet
//              hours = the Sleep mode's schedule).
//
// Storage: the notifications settings object (slice "notifs", synced
// and encrypted) under settings.focus = { mrev, modes, act }:
//   modes  [{ id, name, icon, allow:[ns…], sched?, cal? }]  (built-ins
//          always there; name "" = the translated built-in name)
//          F2: sched { on, days, from, to } weekly in half hours (not
//          Sleep: its hours are the quiet hours); cal { on, label, word }
//          on during a timed Calendar event with that label or word.
//   mrev   stamp of the modes list (ms, monotonic): newer list wins
//   act    { id, until, at }: the manual choice. id "" = off;
//          until 0 = until turned off, else the ms it ends at;
//          at = its stamp (newer wins).
// Focus is written through orosNotifs.setFocus, which does NOT move
// settingsRev, and notifMerge merges it on these stamps alone: a sound
// change on one device never undoes a mode started on another, and a
// mode started never undoes the sound.
// Old orOS versions keep settings.focus untouched (they take the
// settings object whole) and still honour quietHours, which stays
// the Sleep schedule.
//
// Loads with the late bundle (index.html <template data-oros-late>,
// first), after notifications.js; window.orosFocus. The pure model is
// also module.exports for the tests.
(function (root) {
  "use strict";

  var VER = "1.2.0";
  var HOUR = 3600000;
  var MAX_OWN = 10;
  var MAX_NAME = 40;
  var ICONS = ["bell", "moon", "work", "home", "book", "heart", "car", "game", "leaf", "star"];
  var BUILTIN = [
    { id: "dnd", icon: "bell", allow: [] },
    { id: "sleep", icon: "moon", allow: [] },
    { id: "work", icon: "work", allow: ["calendar", "time", "todo", "kanban", "mail", "crm", "invoices", "timesheet", "system"] },
    { id: "personal", icon: "home", allow: ["calendar", "time", "contacts", "todo", "habits", "water", "plants", "petcare", "baby", "chores", "health", "household", "together", "meals", "weather", "system"] }
  ];
  var LOCKED_ALLOW = { dnd: true };   // Do Not Disturb lets nothing through

  // ---------- 1. Model (pure) ----------
  function isBuiltin(id) {
    for (var i = 0; i < BUILTIN.length; i++) if (BUILTIN[i].id === id) return true;
    return false;
  }
  function num(v) { return (typeof v === "number" && isFinite(v) && v >= 0) ? Math.floor(v) : 0; }
  function cleanName(s) {
    return (typeof s === "string") ? s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME) : "";
  }
  function cleanAllow(a) {
    var out = [];
    if (!Array.isArray(a)) return out;
    a.forEach(function (ns) {
      if (typeof ns === "string" && /^[a-z][a-z0-9_-]{0,31}$/.test(ns) && out.indexOf(ns) < 0) out.push(ns);
    });
    return out.sort();
  }
  function isInt(v, lo, hi) { return typeof v === "number" && v % 1 === 0 && v >= lo && v <= hi; }
  // Weekly schedule (F2): days 0 = Sunday … 6, from/to in half hours
  // (0 = 00:00 … 47 = 23:30); to <= from runs past midnight into the
  // next day. `on` false keeps the choice without running it.
  function cleanSched(x) {
    if (!x || typeof x !== "object") return null;
    var days = [];
    (Array.isArray(x.days) ? x.days : []).forEach(function (d) { if (isInt(d, 0, 6) && days.indexOf(d) < 0) days.push(d); });
    return { on: !!x.on, days: days.sort(), from: isInt(x.from, 0, 47) ? x.from : 18, to: isInt(x.to, 0, 47) ? x.to : 34 };
  }
  // Calendar trigger (F2): on while a timed Calendar event with this
  // label (its id) or with this word in its title runs.
  function cleanCal(x) {
    if (!x || typeof x !== "object") return null;
    var label = (typeof x.label === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(x.label)) ? x.label : "";
    return { on: !!x.on, label: label, word: cleanName(x.word) };
  }
  // What a mode hides while it runs (F3, D3: only the desktop and the
  // Dock; the menu and search still find every app): widget kinds and
  // app ids. The ids are checked, so they are safe inside CSS.
  function cleanIds(a, re, max) {
    var out = [];
    (Array.isArray(a) ? a : []).forEach(function (x) {
      if (typeof x === "string" && re.test(x) && out.indexOf(x) < 0 && out.length < max) out.push(x);
    });
    return out.sort();
  }
  function cleanHide(x) {
    if (!x || typeof x !== "object") return null;
    var w = cleanIds(x.widgets, /^[a-z]{1,16}$/, 16), a = cleanIds(x.apps, /^[a-z0-9][a-z0-9_-]{0,47}$/, 80);
    return (w.length || a.length) ? { widgets: w, apps: a } : null;
  }
  // Fields a later orOS adds to a mode ride along untouched (an older
  // device never drops what it does not know).
  var KNOWN = { id: 1, name: 1, icon: 1, allow: 1, sched: 1, cal: 1, hide: 1 };
  function extras(m) {
    var out = {}, size = 0;
    Object.keys(m).forEach(function (k) {
      if (KNOWN[k] || !/^[a-z][A-Za-z0-9]{0,15}$/.test(k)) return;
      var j;
      try { j = JSON.stringify(m[k]); } catch (e) { return; }
      if (j === undefined || size + j.length > 4000) return;
      size += j.length;
      out[k] = JSON.parse(j);
    });
    return out;
  }
  function cleanMode(m, fallback) {
    m = (m && typeof m === "object") ? m : {};
    var id = fallback ? fallback.id : m.id;
    var c = extras(m);
    c.id = id;
    c.name = cleanName(m.name);
    c.icon = ICONS.indexOf(m.icon) >= 0 ? m.icon : (fallback ? fallback.icon : "star");
    c.allow = LOCKED_ALLOW[id] ? [] : cleanAllow(Array.isArray(m.allow) ? m.allow : (fallback ? fallback.allow : []));
    var sc = id === "sleep" ? null : cleanSched(m.sched);   // Sleep's hours are the quiet hours (D2)
    if (sc) c.sched = sc;
    var ca = cleanCal(m.cal);
    if (ca) c.cal = ca;
    var hi = cleanHide(m.hide);
    if (hi) c.hide = hi;
    return c;
  }
  // Repairs every field; the built-ins are always first, in order.
  function normalize(f) {
    f = (f && typeof f === "object" && !Array.isArray(f)) ? f : {};
    var given = Array.isArray(f.modes) ? f.modes : [];
    var byId = {};
    given.forEach(function (m) { if (m && typeof m.id === "string" && !byId[m.id]) byId[m.id] = m; });
    var modes = BUILTIN.map(function (b) { return cleanMode(byId[b.id] || null, b); });
    var own = 0;
    given.forEach(function (m) {
      if (!m || typeof m.id !== "string" || !/^m_[a-z0-9]{1,24}$/.test(m.id) || own >= MAX_OWN) return;
      if (modes.some(function (x) { return x.id === m.id; })) return;
      var c = cleanMode(m, null);
      if (!c.name) return;          // an own mode needs a name
      modes.push(c);
      own++;
    });
    var a = (f.act && typeof f.act === "object") ? f.act : {};
    var actId = (typeof a.id === "string" && modes.some(function (x) { return x.id === a.id; })) ? a.id : "";
    return {
      mrev: num(f.mrev),
      modes: modes,
      act: { id: actId, until: num(a.until), at: num(a.at) }
    };
  }
  // Symmetric and deterministic: the newer modes list, the newer
  // manual choice; an exact tie keeps the greater JSON.
  function pick(x, y, kx, ky) {
    if (kx !== ky) return kx > ky ? x : y;
    return JSON.stringify(x) >= JSON.stringify(y) ? x : y;
  }
  function merge(a, b) {
    var A = normalize(a), B = normalize(b);
    var mw = pick(A, B, A.mrev, B.mrev);
    var act = pick(A.act, B.act, A.act.at, B.act.at);
    return normalize({ mrev: mw.mrev, modes: mw.modes, act: act });
  }
  // A stored value worth keeping (the merge and the slice keep it out
  // when nobody ever touched focus modes).
  function touched(f) { return !!(f && typeof f === "object" && (num(f.mrev) || (f.act && num(f.act.at)))); }

  function readQuiet(q) {
    q = (q && typeof q === "object") ? q : {};
    var s = (typeof q.quietHoursStart === "number" && q.quietHoursStart >= 0 && q.quietHoursStart <= 23) ? q.quietHoursStart : 22;
    var e = (typeof q.quietHoursEnd === "number" && q.quietHoursEnd >= 0 && q.quietHoursEnd <= 23) ? q.quietHoursEnd : 8;
    return { on: !!q.enabled, start: s, end: e };
  }
  // The Sleep schedule (quiet hours): the ms the current window ends
  // at, or 0 when "now" is outside it. Same hour rule as before.
  function sleepEnds(q, now) {
    var r = readQuiet(q);
    if (!r.on || r.start === r.end) return 0;
    var d = new Date(now), h = d.getHours();
    var inside = r.start < r.end ? (h >= r.start && h < r.end) : (h >= r.start || h < r.end);
    if (!inside) return 0;
    var end = new Date(now);
    end.setHours(r.end, 0, 0, 0);
    if (end.getTime() <= now) end.setDate(end.getDate() + 1);
    return end.getTime();
  }
  // One window of a weekly schedule that starts on the day `k` days
  // from `now` (local time, so DST moves with the clock).
  function windowOf(sc, now, k) {
    var d = new Date(now);
    var start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + k, 0, sc.from * 30, 0, 0);
    var end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + k + (sc.to > sc.from ? 0 : 1), 0, sc.to * 30, 0, 0);
    return { day: start.getDay(), s: start.getTime(), e: end.getTime() };
  }
  function schedLive(sc) { return !!(sc && sc.on && sc.days.length && sc.from !== sc.to); }
  // The ms the running window ends at, or 0 outside every window.
  function schedEnds(sc, now) {
    sc = cleanSched(sc);
    if (!schedLive(sc)) return 0;
    for (var k = -1; k <= 0; k++) {
      var w = windowOf(sc, now, k);
      if (sc.days.indexOf(w.day) >= 0 && w.s <= now && now < w.e) return w.e;
    }
    return 0;
  }
  // The end of the running or the next window (within a week), or 0.
  function schedNextEnd(sc, now) {
    sc = cleanSched(sc);
    if (!schedLive(sc)) return 0;
    for (var k = -1; k <= 7; k++) {
      var w = windowOf(sc, now, k);
      if (sc.days.indexOf(w.day) >= 0 && w.e > now) return w.e;
    }
    return 0;
  }
  // Quiet hours as a schedule of every day (the Sleep mode's hours).
  function quietSched(q) {
    var r = readQuiet(q);
    return { on: r.on, days: [0, 1, 2, 3, 4, 5, 6], from: r.start * 2, to: r.end * 2 };
  }
  function fold(s) {
    s = String(s || "").toLowerCase();
    try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    return s.replace(/\u03c2/g, "\u03c3");   // final sigma
  }
  // evs: [{ s, e, title, label }] timed Calendar events around now.
  function calEnds(ca, evs, now) {
    ca = cleanCal(ca);
    if (!ca || !ca.on || (!ca.label && !ca.word) || !Array.isArray(evs)) return 0;
    var w = ca.word ? fold(ca.word) : "", end = 0;
    evs.forEach(function (ev) {
      if (!ev || !(ev.s <= now && now < ev.e)) return;
      var hit = (ca.label && ev.label === ca.label) || (w && fold(ev.title).indexOf(w) >= 0);
      if (hit && ev.e > end) end = ev.e;
    });
    return end;
  }
  // Does a mode's own schedule or Calendar trigger hold now?
  // → { until, by: "schedule"|"calendar" } | null
  function triggerOf(m, q, now, evs) {
    var se = m.id === "sleep" ? sleepEnds(q, now) : schedEnds(m.sched, now);
    if (se) return { until: se, by: "schedule" };
    var ce = calEnds(m.cal, evs, now);
    if (ce) return { until: ce, by: "calendar" };
    return null;
  }
  function scheduledAt(f, q, now, evs) {
    for (var i = 0; i < f.modes.length; i++) {
      var r = triggerOf(f.modes[i], q, now, evs);
      if (r) return { id: f.modes[i].id, until: r.until, by: r.by };
    }
    return null;
  }
  // → { id, until, by: "manual"|"schedule"|"calendar" } | null
  // A manual choice wins; else the first mode in the list whose
  // schedule or Calendar trigger holds (Sleep: the quiet hours).
  function activeAt(f, q, now, evs) {
    f = normalize(f);
    var a = f.act;
    var live = !a.until || a.until > now;
    if (a.id && live) return { id: a.id, until: a.until, by: "manual" };
    // "off" chosen while a schedule ran keeps it off until its end
    if (a.id === "" && a.at && a.until > now) return null;
    return scheduledAt(f, q, now, evs);
  }
  // "Until the schedule ends" for mode `id`: the end of its running
  // trigger, else of its next weekly window; 0 = it has none.
  function endOf(f, q, id, now, evs) {
    f = normalize(f);
    var m = modeOf(f, id);
    if (!m) return 0;
    var r = triggerOf(m, q, now, evs);
    if (r) return r.until;
    return schedNextEnd(m.id === "sleep" ? quietSched(q) : m.sched, now);
  }
  function modeOf(f, id) {
    f = normalize(f);
    for (var i = 0; i < f.modes.length; i++) if (f.modes[i].id === id) return f.modes[i];
    return null;
  }
  // Is a notification of app `ns` kept silent now? (inbox + badge only)
  function silent(f, q, ns, now, evs) {
    var cur = activeAt(f, q, now, evs);
    if (!cur) return false;
    var m = modeOf(f, cur.id);
    if (!m) return false;
    return m.allow.indexOf(String(ns || "")) < 0;
  }
  function stamp(prev, now) { return Math.max(num(prev) + 1, now); }
  // The value after starting a mode (until 0 = until turned off).
  function started(f, id, until, now) {
    f = normalize(f);
    if (!modeOf(f, id)) return f;
    f.act = { id: id, until: num(until) > now ? num(until) : 0, at: stamp(f.act.at, now) };
    return f;
  }
  // Off. Inside a scheduled window (Sleep's quiet hours, a weekly
  // schedule, a Calendar event) it stays off until that window ends.
  function stopped(f, q, now, evs) {
    f = normalize(f);
    var sc = scheduledAt(f, q, now, evs);
    f.act = { id: "", until: sc ? sc.until : 0, at: stamp(f.act.at, now) };
    return f;
  }
  function edited(f, id, patch, now) {
    f = normalize(f);
    var m = modeOf(f, id);
    if (!m) return f;
    patch = patch || {};
    var next = f.modes.map(function (x) {
      if (x.id !== id) return x;
      var y = JSON.parse(JSON.stringify(x));
      if ("name" in patch) y.name = cleanName(patch.name);
      if ("icon" in patch && ICONS.indexOf(patch.icon) >= 0) y.icon = patch.icon;
      if ("allow" in patch) y.allow = cleanAllow(patch.allow);
      if ("sched" in patch) { var sc = cleanSched(patch.sched); if (sc && id !== "sleep") y.sched = sc; else delete y.sched; }
      if ("cal" in patch) { var ca = cleanCal(patch.cal); if (ca) y.cal = ca; else delete y.cal; }
      if ("hide" in patch) { var hi = cleanHide(patch.hide); if (hi) y.hide = hi; else delete y.hide; }
      if (!isBuiltin(id) && !y.name) y.name = x.name;   // an own mode keeps a name
      return cleanMode(y, isBuiltin(id) ? { id: id, icon: x.icon, allow: [] } : null);
    });
    if (JSON.stringify(next) === JSON.stringify(f.modes)) return f;
    f.modes = next;
    f.mrev = stamp(f.mrev, now);
    return normalize(f);
  }
  function newId(rand) {
    var s = "";
    for (var i = 0; i < 8; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(rand() * 36));
    return "m_" + s;
  }
  function added(f, name, icon, now, rand) {
    f = normalize(f);
    name = cleanName(name);
    var own = f.modes.filter(function (m) { return !isBuiltin(m.id); }).length;
    if (!name || own >= MAX_OWN) return { f: f, id: null };
    var id;
    do { id = newId(rand || Math.random); } while (modeOf(f, id));
    f.modes.push({ id: id, name: name, icon: ICONS.indexOf(icon) >= 0 ? icon : "star", allow: [] });
    f.mrev = stamp(f.mrev, now);
    return { f: normalize(f), id: id };
  }
  function removed(f, id, now) {
    f = normalize(f);
    if (isBuiltin(id) || !modeOf(f, id)) return f;
    f.modes = f.modes.filter(function (m) { return m.id !== id; });
    f.mrev = stamp(f.mrev, now);
    if (f.act.id === id) f.act = { id: "", until: 0, at: stamp(f.act.at, now) };
    return normalize(f);
  }
  // Durations of the Quick settings menu, as Do Not Disturb had them.
  // "end" needs the mode's schedule: endOf(…) (0 = until turned off).
  function untilOf(choice, now, end) {
    if (choice === "hour") return now + HOUR;
    if (choice === "end") return num(end) > now ? num(end) : 0;
    if (choice === "morning") {
      var d = new Date(now);
      d.setHours(8, 0, 0, 0);
      if (d.getTime() <= now) d.setDate(d.getDate() + 1);
      return d.getTime();
    }
    return 0;
  }
  // The shell's CSS for what the running mode hides ("" = nothing).
  function hideCss(f, cur) {
    var m = cur ? modeOf(f, cur.id) : null;
    if (!m || !m.hide) return "";
    var sel = m.hide.widgets.map(function (k) { return '.wg-card[data-wg="' + k + '"]'; })
      .concat(m.hide.apps.map(function (id) { return '#ld-desk [data-app="' + id + '"], #ld-dock [data-app="' + id + '"]'; }));
    return sel.length ? sel.join(", ") + " { display: none !important; }" : "";
  }
  function nameOf(m, t) {
    if (!m) return "";
    if (m.name) return m.name;
    return t("focus.m." + m.id);
  }

  // Static icon drawings (never user data), for Quick settings and the bar.
  var PATHS = {
    bell: '<path d="M13.7 21a2 2 0 0 1-3.4 0"/><path d="M18.6 13A17.9 17.9 0 0 1 18 8"/><path d="M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.3-5"/><path d="M3 3l18 18"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
    home: '<path d="M4 21V10l8-6 8 6v11"/><path d="M9 21v-6h6v6"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
    car: '<path d="M5 17h14v-5l-2-5H7l-2 5z"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/><path d="M5 12h14"/>',
    game: '<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 11v3M5.5 12.5h3"/><path d="M15 12h.01M18 13.5h.01"/>',
    leaf: '<path d="M11 20A7 7 0 0 1 4 13C4 7 9 4 20 4c0 11-3 16-9 16z"/><path d="M4 20c4-4 7-6 11-8"/>',
    star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>'
  };
  function svg(icon) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (PATHS[icon] || PATHS.star) + "</svg>";
  }

  var model = { VER: VER, svg: svg, ICONS: ICONS.slice(), BUILTIN_IDS: BUILTIN.map(function (b) { return b.id; }), MAX_OWN: MAX_OWN,
                normalize: normalize, merge: merge, touched: touched, sleepEnds: sleepEnds, activeAt: activeAt,
                schedEnds: schedEnds, schedNextEnd: schedNextEnd, calEnds: calEnds, endOf: endOf, fold: fold, hideCss: hideCss,
                modeOf: modeOf, silent: silent, started: started, stopped: stopped, edited: edited,
                added: added, removed: removed, untilOf: untilOf, nameOf: nameOf, isBuiltin: isBuiltin };
  if (typeof module !== "undefined" && module.exports) module.exports = model;
  if (typeof document === "undefined") return;

  // ---------- 2. Live API (through orosNotifs' settings) ----------
  function t(k) { return typeof root.t === "function" ? root.t(k) : k; }
  function N() { var n = root.orosNotifs; return (n && typeof n.getSetting === "function") ? n : null; }
  function read() { var n = N(); return normalize(n ? n.getSetting("focus", null) : null); }
  function quiet() { var n = N(); return n ? n.getSetting("quietHours", {}) : {}; }
  // Calendar (F2): the timed events running around now, read from the
  // Calendar's own data on this device (synced by Calendar itself), and
  // only while some mode has a Calendar trigger. Cached per minute.
  function calData() {
    var raw = null, hh = null;
    try { raw = JSON.parse(localStorage.getItem("oros-calendar-data")); } catch (e) {}
    try { hh = JSON.parse(localStorage.getItem("oros-calendar-hh")); } catch (e) {}
    raw = (raw && typeof raw === "object") ? raw : {};
    var evs = Array.isArray(raw.events) ? raw.events : [];
    if (hh && Array.isArray(hh.events)) evs = evs.concat(hh.events);
    return { labels: Array.isArray(raw.labels) ? raw.labels : [], events: evs, deleted: Array.isArray(raw.deleted) ? raw.deleted : [] };
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymdOf(ms) { var d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function wall(date, hm) {
    var p = date.split("-"), h = hm.split(":");
    return new Date(+p[0], +p[1] - 1, +p[2], +h[0], +h[1], 0, 0).getTime();
  }
  var evCache = { min: -1, list: [] };
  function eventsNow(f, now) {
    if (!f.modes.some(function (m) { return m.cal && m.cal.on; })) return [];
    var min = Math.floor(now / 60000);
    if (evCache.min === min) return evCache.list;
    var OCC = root.OrosCalOccur, list = [];
    if (OCC && typeof OCC.instancesBetween === "function") {
      var d = calData(), gone = {};
      d.deleted.forEach(function (x) { if (x && typeof x.id === "string") gone[x.id] = true; });
      var from = ymdOf(now - 86400000), to = ymdOf(now);
      d.events.forEach(function (ev) {
        if (!ev || typeof ev !== "object" || gone[ev.id] || typeof ev.start !== "string" || !/^\d{2}:\d{2}$/.test(ev.start)) return;
        try {
          OCC.instancesBetween(ev, from, to, function (inst) {
            if (!inst.start) return true;
            var s = wall(inst.date, inst.start), e;
            if (inst.end) {
              e = wall(inst.dateEnd || inst.date, inst.end);
              if (e <= s) e += 86400000;            // ends after midnight
            } else e = s + 3600000;                   // no end time: one hour
            if (s <= now && now < e) list.push({ s: s, e: e, title: String(ev.title || ""), label: typeof ev.labelId === "string" ? ev.labelId : "" });
            return true;
          });
        } catch (e) {}
      });
    }
    evCache = { min: min, list: list };
    return list;
  }
  function evs(now) { return eventsNow(read(), now); }
  // F3: hide the chosen widgets and desktop/Dock icons while a mode runs
  // (one <style> in the shell; nothing is removed from the layouts).
  function paintHide(css) {
    var doc = root.document;
    if (!doc || !doc.head) return;
    var st = doc.getElementById("oros-focus-hide");
    if (!css) { if (st) st.remove(); return; }
    if (!st) { st = doc.createElement("style"); st.id = "oros-focus-hide"; doc.head.appendChild(st); }
    if (st.textContent !== css) st.textContent = css;
  }
  var listeners = [];
  var lastKey = "";
  function changed() {
    var now = Date.now(), f0 = read(), cur = activeAt(f0, quiet(), now, evs(now));
    paintHide(hideCss(f0, cur));
    var key = JSON.stringify([cur, read().modes]);
    if (key === lastKey) return;
    lastKey = key;
    listeners.slice().forEach(function (fn) { try { fn(cur); } catch (e) {} });
  }
  function write(f) {
    var n = N();
    if (!n) return false;
    if (typeof n.setFocus === "function") n.setFocus(f); else n.setSetting("focus", f);
    changed();
    return true;
  }
  var LAST_KEY = "oros-focus-last";   // device-local: the mode the pill starts
  function last() {
    var v = null;
    try { v = localStorage.getItem(LAST_KEY); } catch (e) {}
    return modeOf(read(), v) ? v : "dnd";
  }

  root.orosFocus = {
    VER: VER,
    model: model,
    // [{ id, name (shown), own (typed, "" = built-in name), icon, allow, builtin, locked }]
    list: function () {
      return read().modes.map(function (m) {
        return { id: m.id, name: nameOf(m, t), own: m.name, icon: m.icon, allow: m.allow.slice(), builtin: isBuiltin(m.id), locked: !!LOCKED_ALLOW[m.id],
                 sched: m.sched ? JSON.parse(JSON.stringify(m.sched)) : null, cal: m.cal ? JSON.parse(JSON.stringify(m.cal)) : null,
                 hide: m.hide ? JSON.parse(JSON.stringify(m.hide)) : null };
      });
    },
    // { id, name, until, by } | null
    active: function (now) {
      now = now || Date.now();
      var f = read(), cur = activeAt(f, quiet(), now, evs(now));
      if (!cur) return null;
      return { id: cur.id, name: nameOf(modeOf(f, cur.id), t), until: cur.until, by: cur.by };
    },
    start: function (id, opts) {
      var now = Date.now();
      if (!modeOf(read(), id)) return false;
      try { localStorage.setItem(LAST_KEY, id); } catch (e) {}
      return write(started(read(), id, opts && opts.until, now));
    },
    stop: function () { var now = Date.now(); return write(stopped(read(), quiet(), now, evs(now))); },
    // the ms "Until the schedule ends" means for mode id (0 = no schedule)
    endOf: function (id, now) { now = now || Date.now(); return endOf(read(), quiet(), id, now, evs(now)); },
    // the Calendar's labels [{ id, name }] for the Calendar trigger
    calLabels: function () {
      return calData().labels.filter(function (l) { return l && typeof l.id === "string" && typeof l.name === "string"; })
        .map(function (l) { return { id: l.id, name: l.name }; });
    },
    last: last,
    edit: function (id, patch) { return write(edited(read(), id, patch, Date.now())); },
    add: function (name, icon) {
      var r = added(read(), name, icon, Date.now());
      if (r.id) write(r.f);
      return r.id;
    },
    remove: function (id) { return write(removed(read(), id, Date.now())); },
    // notifications.js asks this before a pop-up or a sound
    silent: function (ns, now) { now = now || Date.now(); return silent(read(), quiet(), ns, now, evs(now)); },
    merge: merge,
    touched: touched,
    onChange: function (fn) { if (typeof fn === "function") listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; },
    // notifications.js calls this after a pull and every minute
    changed: changed
  };
  // notifications.js may already be up (focus.js comes with the late
  // bundle): let it migrate an old Do Not Disturb and repaint now.
  try { if (root.orosNotifs && typeof root.orosNotifs.focusReady === "function") root.orosNotifs.focusReady(); } catch (e) {}
})(typeof window !== "undefined" ? window : globalThis);
