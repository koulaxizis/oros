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
      return { done: done };
    } catch (e) { return { done: {} }; }
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
    });
    // Forget rules that are gone, so the record stays small.
    Object.keys(local.done).forEach(function (k) { if (!C.find(data, k)) { delete local.done[k]; touched = true; } });
    if (touched) writeLocal(local);
  }

  // Do one action now (a tap in the app or on the notice is the
  // person's go-ahead). → true when a receiving app was opened.
  function runAction(action, at) {
    var c = C.call(action, at || Date.now(), lang(), C.from(lang()));
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
    var acts = C.pending(rule), at = keyTime(key) || Date.now();
    if (acts.length === 1 && runAction(acts[0], at)) { log(rule, key, at, "run"); return; }
    root.__orosOpenAt("automations", { run: { r: rule.id, k: key, at: at } });
  }
  // "r…@202611041830" → that local moment.
  function keyTime(key) {
    var m = /@(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?$/.exec(String(key || ""));
    if (!m) return 0;
    return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0).getTime();
  }

  root.orosAutomations = {
    VERSION: "1.0.0",
    rules: function () { return read(); },
    save: save,
    tick: tick,
    runAction: runAction,
    openRun: openRun,
    log: readLog,
    noteRun: function (ruleId, key, at) {
      var rule = C.find(read(), String(ruleId || ""));
      if (rule) log(rule, String(key || "manual"), typeof at === "number" ? at : Date.now(), "run");
    },
    installed: installed,
    appName: appName,
    onChange: onChange
  };
  registerSlice();
})(window);
