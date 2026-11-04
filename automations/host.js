// ============================================================
// orOS Automations — shell side (wave A1)
// Runs in the SHELL window (index.html late bundle, after
// automations/core.js). It
//   - owns the synced slice "automations" (oros-automations-data):
//     the rules; the app edits them through window.orosAutomations;
//   - on the shell's clock tick (window.orosAutomations.tick, throttled
//     by the shell, no timer of its own) runs every rule that is due;
//   - a run = ONE notice (ns "automations", key = the run's key, so the
//     synced inbox runs it once on every device, AUTO-3). Its text is
//     the rule's "notify" lines; when the rule has other actions the
//     notice says what a tap does, and the tap (deep link
//     "automations:run:<key>", key = "<ruleId>@<when>") opens the receiving app's prefill
//     through its existing bridge (AUTO-2: nothing written elsewhere
//     until the person saves it there);
//   - keeps device-local "oros-automations-local" { done: {ruleId: key} }
//     (the last run this device handled) and "oros-automations-log"
//     (the last 50 runs on this device, for the app's Recent list).
// orOS closed = nothing runs; the next open runs a missed run once if
// it is under 36 hours old (honest limit, like Today).
// ============================================================
(function (root) {
  "use strict";
  var C = root.OrosAutoCore;
  if (!C) return;                                // stale bundle without core.js

  var KEY = "oros-automations-data";
  var LOCAL_KEY = "oros-automations-local";
  var LOG_KEY = "oros-automations-log";
  var LOG_MAX = 50;
  var SAID_KEY = "oros-automations-said";       // device-local: what a signal run said, for its tap
  var SAID_MAX = 50;
  var DAY_CAP = 20;                              // signal runs per rule per day on this device
  var bootAt = Date.now();
  var listeners = [];

  function S() { return root.orosSync || null; }
  function env() { return root.orosTodayEnv || null; }
  function lang() {
    var I = root.orosI18n, l = "";
    if (I) { try { l = I.lang(); } catch (x) {} }
    if (!l) { var e = env(); try { l = e ? e.lang() : ""; } catch (x) {} }
    return l || "en";
  }

  // ---------- Synced slice ----------
  function read() {
    try { return C.normalize(JSON.parse(localStorage.getItem(KEY))); }
    catch (e) { return C.empty(); }
  }
  function write(d) {
    try { localStorage.setItem(KEY, C.serialize(d)); return true; }
    catch (e) { return false; }
  }
  function sliceGet() { return read(); }
  function sliceSet(d) {                          // R6: a pull never marks dirty
    if (!d || typeof d !== "object") return;
    var cur = read(), next = C.merge(cur, d);
    if (C.serialize(next) === C.serialize(cur)) return;
    write(next);
    changed("rules");
  }
  // The app's edits: → true when saved (false = storage full).
  function save(next) {
    var cur = read(), clean = C.normalize(next);
    if (C.serialize(clean) === C.serialize(cur)) return true;
    if (!write(clean)) return false;
    var s = S();
    if (s && typeof s.markDirty === "function") s.markDirty();
    changed("rules");
    return true;
  }
  function registerSlice() {
    var s = S();
    if (!s || typeof s.registerSlice !== "function") { setTimeout(registerSlice, 100); return; }
    // No storage-key proxy: this module is always live in the shell.
    s.registerSlice("automations", sliceGet, sliceSet, null, C.merge);
  }

  function changed(why) { listeners.slice().forEach(function (fn) { try { fn(why); } catch (e) {} }); }
  function onChange(fn) {
    if (typeof fn !== "function") return function () {};
    listeners.push(fn);
    return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  }

  // ---------- Device-local state ----------
  function readLocal() {
    try {
      var o = JSON.parse(localStorage.getItem(LOCAL_KEY));
      var done = {};
      if (o && o.done && typeof o.done === "object") {
        Object.keys(o.done).forEach(function (k) {
          if (C.ID_RE.test(k) && typeof o.done[k] === "string" && o.done[k].length <= 90) done[k] = o.done[k];
        });
      }
      var day = o && typeof o.day === "string" ? o.day : "", cnt = {};
      if (o && o.cnt && typeof o.cnt === "object") {
        Object.keys(o.cnt).forEach(function (k) { if (C.ID_RE.test(k) && typeof o.cnt[k] === "number") cnt[k] = o.cnt[k]; });
      }
      return { done: done, day: day, cnt: cnt };
    } catch (e) { return { done: {}, day: "", cnt: {} }; }
  }
  function writeLocal(o) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(o)); } catch (e) {} }
  function readLog() {
    try {
      var a = JSON.parse(localStorage.getItem(LOG_KEY));
      return Array.isArray(a) ? a.filter(function (x) {
        return x && typeof x.r === "string" && typeof x.at === "number" && typeof x.k === "string";
      }).slice(0, LOG_MAX) : [];
    } catch (e) { return []; }
  }
  // what: "sent" | "off" (notices off) | "skip" (an app is missing) | "run" (tapped) | "late"
  //       | "outErr" (a push or webhook step was not delivered)
  function log(rule, key, at, what) {
    var a = readLog();
    a.unshift({ r: rule.id, n: rule.name || "", k: key, at: at, t: Date.now(), w: what });
    try { localStorage.setItem(LOG_KEY, JSON.stringify(a.slice(0, LOG_MAX))); } catch (e) {}
    changed("log");
  }

  // ---------- Apps ----------
  function installed() {
    var e = env();
    try { return e ? e.apps().map(function (a) { return a.id; }) : []; } catch (x) { return []; }
  }
  function appName(id) {
    var e = env();
    try {
      var list = e ? e.apps() : [];
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].name;
    } catch (x) {}
    return id;
  }
  function registered() { return installed().indexOf("automations") >= 0; }

  // ---------- Running ----------
  function inboxHas(dedupKey) {
    var N = root.orosNotifs;
    try {
      var items = N.getSlice().items;
      for (var i = 0; i < items.length; i++) if (items[i].dedupKey === dedupKey) return true;
    } catch (e) {}
    return false;
  }
  function tick() {
    if (!registered()) return;
    var N = root.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;
    var data = read(), local = readLocal(), now = Date.now(), apps = installed(), l = lang(), touched = false;
    data.rules.forEach(function (rule) {
      var d = C.due(rule, now, local.done[rule.id] || "", bootAt);
      if (!d) return;
      local.done[rule.id] = d.key;
      touched = true;
      if (inboxHas("automations:" + d.key)) return;           // another device ran it
      if (!C.runnable(rule, apps)) { log(rule, d.key, d.at, "skip"); return; }   // AUTO-5
      var txt = C.notice(rule, d.at, l, appName);
      var id = N.emit({
        ns: "automations",
        key: d.key,
        type: "reminder",
        title: txt.title,
        body: txt.body,
        deepLink: C.pending(rule).length ? "automations:run:" + d.key : "automations:open"
      });
      log(rule, d.key, d.at, id ? (d.late ? "late" : "sent") : "off");
      if (id) sendOut(rule, d.key, d.at, l, "");
    });
    // Forget rules that are gone, so the record stays small.
    Object.keys(local.done).forEach(function (k) { if (!C.find(data, k)) { delete local.done[k]; touched = true; } });
    if (touched) writeLocal(local);
  }

  // ---------- Wave A5: steps that leave the device ----------
  // Only the device whose notice claimed the run (the synced inbox
  // holds it) sends, and only to an address the person allowed in the
  // editor (C.outbound returns null otherwise). No cookies, no
  // referrer, no redirects; a failure is logged, never retried.
  function sendOut(rule, key, at, l, said) {
    if (typeof fetch !== "function") return;
    C.outSteps(rule).forEach(function (a) {
      var q = C.outbound(a, rule, at, l, said);
      if (!q) return;
      try {
        fetch(q.url, { method: q.method, headers: q.headers, body: q.body, mode: "cors", credentials: "omit", cache: "no-store",
                       redirect: "error", referrerPolicy: "no-referrer", keepalive: true })
          .then(function (res) { if (!res.ok) log(rule, key, at, "outErr"); }, function () { log(rule, key, at, "outErr"); });
      } catch (e) { log(rule, key, at, "outErr"); }
    });
  }

  // ---------- Wave A2: rules that follow what happens (BR-EV) ----------
  // A signal = a notice another app posted on THIS device (notifications.js
  // calls notice() after its own emit; notices pulled from another
  // device do not come here, that device ran them) or an app's event
  // (window.orosEvents.emit). Each matching rule posts one notice keyed
  // by the signal's own key, so the synced inbox runs it once.
  function readSaid() {
    try { var o = JSON.parse(localStorage.getItem(SAID_KEY)); return o && typeof o === "object" ? o : {}; }
    catch (e) { return {}; }
  }
  function keepSaid(key, text) {
    var o = readSaid(), ks;
    o[key] = String(text || "").slice(0, 300);
    ks = Object.keys(o);
    while (ks.length > SAID_MAX) { delete o[ks.shift()]; }
    try { localStorage.setItem(SAID_KEY, JSON.stringify(o)); } catch (e) {}
  }
  function saidFor(key) { var t = readSaid()[key]; return typeof t === "string" ? t : ""; }
  function signal(kind, name, key, text) {
    if (!registered()) return 0;
    if (kind !== "notice" && kind !== "event") return 0;
    if (typeof name !== "string" || typeof key !== "string" || !key) return 0;
    if (kind === "notice" && (name === "automations" || C.BLOCKED_APPS[name])) return 0;   // AUTO-4, no loops
    var N = root.orosNotifs;
    if (!(N && typeof N.emit === "function")) return 0;
    var said = typeof text === "string" ? text.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    var sig = { kind: kind, name: name, key: key, text: said };
    var data = read(), local = readLocal(), now = Date.now(), apps = installed(), l = lang(), n = 0;
    var today = C.ymdOf(now);
    if (local.day !== today) { local.day = today; local.cnt = {}; }
    data.rules.forEach(function (rule) {
      var rk = C.matches(rule, sig, now);
      if (!rk || inboxHas("automations:" + rk)) return;
      if ((local.cnt[rule.id] || 0) >= DAY_CAP) return;
      local.cnt[rule.id] = (local.cnt[rule.id] || 0) + 1;
      if (!C.runnable(rule, apps)) { log(rule, rk, now, "skip"); return; }
      keepSaid(rk, said);
      var txt = C.notice(rule, now, l, appName, said);
      var id = N.emit({ ns: "automations", key: rk, type: "reminder", title: txt.title, body: txt.body,
                        deepLink: C.pending(rule).length ? "automations:run:" + rk : "automations:open" });
      log(rule, rk, now, id ? "sent" : "off");
      if (id) sendOut(rule, rk, now, l, said);
      n++;
    });
    writeLocal(local);
    return n;
  }
  var events = {
    // apps: window.parent.orosEvents.emit(name, key, text). Unknown
    // names do nothing.
    emit: function (name, key, text) {
      if (C.EVENTS.indexOf(name) < 0) return 0;
      return signal("event", name, String(key || "").slice(0, 200), text);
    },
    names: function () { return C.EVENTS.slice(); }
  };

  // Do one action now (a tap in the app or on the notice is the
  // person's go-ahead). → true when a receiving app was opened.
  function runAction(action, at, said) {
    var c = C.call(action, at || Date.now(), lang(), C.from(lang()), said);
    if (!c || installed().indexOf(c.app) < 0) return false;
    if (c.fn === "calendarNew") {
      if (typeof root.__orosOpenCalendarNew !== "function") return false;
      root.__orosOpenCalendarNew(c.arg);
      return true;
    }
    if (c.fn === "budgetNew") return typeof root.__orosOpenBudgetNew === "function" && root.__orosOpenBudgetNew(c.arg) !== false;
    if (typeof root.__orosOpenAt !== "function") return false;
    root.__orosOpenAt(c.app, c.arg);
    return true;
  }
  // The notice's deep link: one action → straight to it; several →
  // the app's run sheet, one button each.
  function openRun(key) {
    key = String(key || "");
    var rule = C.find(read(), key.split("@")[0]);
    if (typeof root.__orosOpenAt !== "function") return;
    if (!rule) { root.__orosOpenAt("automations", null); return; }
    var acts = C.pending(rule), at = keyTime(key) || Date.now(), said = saidFor(key);
    if (acts.length === 1 && runAction(acts[0], at, said)) { log(rule, key, at, "run"); return; }
    root.__orosOpenAt("automations", { run: { r: rule.id, k: key, at: at } });
  }
  // "r…@202611041830" → that local moment.
  function keyTime(key) {
    var m = /@(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?$/.exec(String(key || ""));
    if (!m) return 0;
    return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0).getTime();
  }

  root.orosAutomations = {
    VERSION: "1.2.0",
    rules: function () { return read(); },
    save: save,
    tick: tick,
    runAction: runAction,
    openRun: openRun,
    signal: signal,
    notice: function (ns, key, text) { return signal("notice", ns, key, text); },
    said: saidFor,
    log: readLog,
    noteRun: function (ruleId, key, at) {
      var rule = C.find(read(), String(ruleId || ""));
      if (rule) log(rule, String(key || "manual"), typeof at === "number" ? at : Date.now(), "run");
    },
    installed: installed,
    appName: appName,
    onChange: onChange
  };
  root.orosEvents = events;
  registerSlice();
})(window);
