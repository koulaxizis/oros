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
  var REF_KEY = "oros-automations-ref";          // device-local: the file a bridge.* run is about (item 25)
  var REF_MAX = 50;
  var SEEN_MAX = 200;                            // BR-EV-2: signal runs remembered on this device
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
      var lk = {};                              // SB2: the last signal run this device handled, per rule
      if (o && o.lk && typeof o.lk === "object") {
        Object.keys(o.lk).forEach(function (k) { if (C.ID_RE.test(k) && typeof o.lk[k] === "string" && o.lk[k].length <= 90) lk[k] = o.lk[k]; });
      }
      // BR-EV-2: the last signal runs this device handled (any rule), so a
      // state the shell watches (several overdue invoices) is one run each
      var sk = o && Array.isArray(o.sk) ? o.sk.filter(function (k) { return typeof k === "string" && k.length <= 90; }).slice(-SEEN_MAX) : [];
      return { done: done, day: day, cnt: cnt, lk: lk, sk: sk };
    } catch (e) { return { done: {}, day: "", cnt: {}, lk: {}, sk: [] }; }
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
    routinesTick();
    var N = root.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;
    var data = read(), local = readLocal(), now = Date.now(), apps = installed(), l = lang(), touched = false;
    data.rules.forEach(function (rule) {
      var d = C.due(rule, now, local.done[rule.id] || "", bootAt);
      if (!d) return;
      local.done[rule.id] = d.key;
      touched = true;
      runLocal(rule);                                          // SB2: pause / chime on every device
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
      if (id) runSelf(rule, d.key);
    });
    // Forget rules that are gone, so the record stays small.
    Object.keys(local.done).forEach(function (k) { if (!C.find(data, k)) { delete local.done[k]; touched = true; } });
    if (touched) writeLocal(local);
    watch(data, now);
  }

  // ---------- SB2: steps this device does by itself ----------
  // pause = everything that plays in orOS (the shell's
  // __orosPauseAll: music, podcasts, radio, Sound Mixer); sound = a
  // short two-note chime (Web Audio, quiet; never while a focus mode keeps Automations silent).
  function runLocal(rule) {
    (rule && rule["do"] || []).forEach(function (a) {
      if (a.a === "pause" && typeof root.__orosPauseAll === "function") { try { root.__orosPauseAll(); } catch (e) {} }
      if (a.a === "sound") chime();
      if (a.a === "focus") focusStep(a);
    });
  }
  // Focus F4 (D5): turn a focus mode on or off. At most once a minute on
  // this device, so two rules that start each other's mode cannot ping-pong.
  var focusAt = 0;
  function focusStep(a) {
    var F = root.orosFocus, now = Date.now();
    if (!F || typeof F.start !== "function" || now - focusAt < 60000) return;
    focusAt = now;
    try {
      if (a.mode === "off") F.stop();
      else F.start(a.mode, { until: a.min ? now + a.min * 60000 : 0 });
    } catch (e) {}
  }
  var audio = null;
  function chime() {
    var N = root.orosNotifs;
    try { if (N && (N.silent ? N.silent("automations") : (N.dnd && N.dnd().on))) return; } catch (e) {}
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    try {
      audio = audio || new AC();
      if (audio.state === "suspended" && audio.resume) audio.resume();
      var t0 = audio.currentTime + 0.02;
      [[880, 0], [1318.5, 0.18]].forEach(function (n) {
        var o = audio.createOscillator(), g = audio.createGain();
        o.type = "sine"; o.frequency.value = n[0];
        g.gain.setValueAtTime(0.0001, t0 + n[1]);
        g.gain.exponentialRampToValueAtTime(0.18, t0 + n[1] + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + n[1] + 0.6);
        o.connect(g); g.connect(audio.destination);
        o.start(t0 + n[1]); o.stop(t0 + n[1] + 0.65);
      });
    } catch (e) {}
  }

  // ---------- SB2: what the shell watches itself ----------
  // Only while a rule that is on asks for it, on the clock tick (30 s
  // throttle). event.soon: timed rows of today's summary (Today,
  // rebuilt at most every 2 minutes), never rows of apps kept out of
  // search; goal.spent: this month's expenses in Budget; goal.sales:
  // today's till sales in Stock (stock/pos-core.js, loaded once). Each
  // is a signal; matches() compares it with the rule's minutes or amount,
  // and the signal's key (the row and day, the month, the day) makes it
  // one run.
  var todayRes = null, todayAt = 0, todayBusy = false, posLoad = 0;
  function wants(data) {
    var o = {};
    data.rules.forEach(function (r) { if (r.on && r.when.t === "event" && /^(event\.soon|goal\.|invoices\.overdue$)/.test(r.when.ev)) o[r.when.ev] = true; });
    return o;
  }
  function strictOn() { try { return !!(root.orosStrict && root.orosStrict.level()); } catch (e) { return false; } }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function money(cents, cur) {
    var I = root.orosI18n, loc = "en-GB";
    try { loc = I ? I.locale(lang()) : loc; } catch (e) {}
    try { return new Intl.NumberFormat(loc, { style: "currency", currency: cur }).format(cents / 100); }
    catch (e) { return (cents / 100).toFixed(2) + " " + cur; }
  }
  function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function watch(data, now) {
    var w = wants(data);
    if (w["event.soon"]) watchSoon(now);
    if (w["goal.spent"]) {
      var SB = root.orosSmartBar && root.orosSmartBar.model;
      var d = new Date(now), ym = d.getFullYear() + "-" + pad(d.getMonth() + 1);
      var sp = SB ? SB.monthSpent(readJSON("oros-budget-data"), ym) : null;
      if (sp) signal("event", "goal.spent", "spent:" + ym, strictOn() ? "" : money(sp.cents, sp.cur), null, sp.cents);
    }
    if (w["invoices.overdue"]) {
      // BR-EV-2: documents that became overdue (invoices/core.js, in the
      // shell bundle); the amount stays out in sensitive work mode.
      var quiet = strictOn();
      C.overdueList(root.OrosInvoicesCore, readJSON("oros-invoices-data"), C.ymdOf(now)).forEach(function (x) {
        var said = [x.num, x.party, quiet ? "" : money(x.bal, x.cur)].filter(Boolean).join(" \u00b7 ");
        signal("event", "invoices.overdue", x.key, said, null, x.late);
      });
    }
    if (w["goal.sales"]) {
      var P = root.OrosStockPosCore;
      if (!P) { loadPos(); return; }
      var st = readJSON("oros-stock-data");
      if (!st || !Array.isArray(st.sales)) return;
      var ymd = C.ymdOf(now), rep = null;
      try { rep = P.zReport(st, ymd); } catch (e) { rep = null; }
      if (!rep || !rep.n) return;
      var cur = st.settings && /^[A-Z]{3}$/.test(st.settings.cur || "") ? st.settings.cur : "EUR";
      signal("event", "goal.sales", "sales:" + ymd, strictOn() ? "" : money(rep.g, cur), null, rep.g);
    }
  }
  function loadPos() {
    if (posLoad) return;
    posLoad = 1;
    var s = document.createElement("script");
    var v = (document.querySelector('script[src*="automations/host.js"]') || {}).src || "";
    var m = /[?&]v=([^&#]+)/.exec(v);
    s.src = "stock/pos-core.js" + (m ? "?v=" + m[1] : "");
    s.onerror = function () { posLoad = 0; };
    document.head.appendChild(s);
  }
  function watchSoon(now) {
    var T = root.orosToday;
    if (!T || typeof T.build !== "function") return;
    if (!todayBusy && (!todayRes || now - todayAt > 120000)) {
      todayBusy = true;
      T.build().then(function (res) { todayBusy = false; todayAt = Date.now(); todayRes = res; soonSignals(Date.now()); },
        function () { todayBusy = false; todayAt = Date.now(); });
    }
    soonSignals(now);
  }
  // Minutes from this minute to today's HH:MM, counted in real time,
  // so the night the clocks change still counts right: in March 03:02
  // does not exist and is 04:02 (3 min after 02:59); in October the
  // hour 03:00-03:59 comes twice and the second pass is tried too.
  // -1 when it is past or more than SOON_MAX away.
  function soonLeft(d, h, mi, base) {
    var at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mi).getTime();
    var tries = [at], again = new Date(at + 3600000);
    if (again.getHours() === h && again.getMinutes() === mi) tries.push(again.getTime());
    for (var i = 0; i < tries.length; i++) {
      var left = Math.round((tries[i] - base) / 60000);
      if (left >= 0 && left <= C.SOON_MAX) return left;
    }
    return -1;
  }
  function soonSignals(now) {
    var res = todayRes;
    if (!res || !res.groups || res.today !== C.ymdOf(now)) return;
    var hidden = {};
    (res.apps || []).forEach(function (a) { if (a.sensitive) hidden[a.id] = true; });
    var d = new Date(now), base = now - now % 60000, quiet = strictOn();
    (res.groups.today || []).forEach(function (r) {
      if (!r || r.kind === "info" || hidden[r.app] || C.BLOCKED_APPS[r.app]) return;
      var m = /^(\d{2}):(\d{2})$/.exec(r.time || "");
      if (!m) return;
      var left = soonLeft(d, +m[1], +m[2], base);
      if (left < 0) return;
      signal("event", "event.soon", "soon:" + r.key + ":" + res.today + ":" + r.time, quiet ? "" : r.title + " · " + r.time, null, left);
    });
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
  // Item 25: { bridge: <file key>, name, kind, size } of a bridge.* run,
  // kept on this device for the tap (the file is on this computer only).
  function readRefs() {
    try { var o = JSON.parse(localStorage.getItem(REF_KEY)); return o && typeof o === "object" ? o : {}; }
    catch (e) { return {}; }
  }
  function keepRef(key, ref) {
    if (!ref || typeof ref.bridge !== "string" || !/^[0-9a-f]{16}$/.test(ref.bridge)) return;
    var name = typeof ref.name === "string" ? ref.name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) : "";
    if (!name) return;
    var o = readRefs(), ks;
    o[key] = { bridge: ref.bridge, name: name, kind: ["pdf", "image"].indexOf(ref.kind) >= 0 ? ref.kind : "other",
               size: typeof ref.size === "number" && ref.size >= 0 ? Math.floor(ref.size) : 0 };
    ks = Object.keys(o);
    while (ks.length > REF_MAX) { delete o[ks.shift()]; }
    try { localStorage.setItem(REF_KEY, JSON.stringify(o)); } catch (e) {}
  }
  function refFor(key) { var r = readRefs()[String(key || "")]; return r && typeof r === "object" ? r : null; }
  function signal(kind, name, key, text, ref, num) {
    if (!registered()) return 0;
    if (kind !== "notice" && kind !== "event") return 0;
    if (typeof name !== "string" || typeof key !== "string" || !key) return 0;
    if (kind === "notice" && (name === "automations" || C.BLOCKED_APPS[name])) return 0;   // AUTO-4, no loops
    var N = root.orosNotifs;
    if (!(N && typeof N.emit === "function")) return 0;
    var said = typeof text === "string" ? text.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    var sig = { kind: kind, name: name, key: key, text: said };
    if (typeof num === "number" && isFinite(num)) sig.n = num;
    var data = read(), local = readLocal(), now = Date.now(), apps = installed(), l = lang(), n = 0;
    var today = C.ymdOf(now);
    if (local.day !== today) { local.day = today; local.cnt = {}; }
    data.rules.forEach(function (rule) {
      var rk = C.matches(rule, sig, now);
      if (!rk || local.lk[rule.id] === rk || local.sk.indexOf(rk) >= 0) return;   // SB2: this device already handled it
      local.lk[rule.id] = rk;
      local.sk.push(rk);
      if (local.sk.length > SEEN_MAX) local.sk.splice(0, local.sk.length - SEEN_MAX);
      runLocal(rule);                                          // SB2: pause / chime here
      if (inboxHas("automations:" + rk)) return;
      if ((local.cnt[rule.id] || 0) >= DAY_CAP) return;
      local.cnt[rule.id] = (local.cnt[rule.id] || 0) + 1;
      if (!C.runnable(rule, apps)) { log(rule, rk, now, "skip"); return; }
      keepSaid(rk, said);
      if (ref && C.bridgeEvent(name)) keepRef(rk, ref);
      var txt = C.notice(rule, now, l, appName, said);
      var id = N.emit({ ns: "automations", key: rk, type: "reminder", title: txt.title, body: txt.body,
                        deepLink: C.pending(rule).length ? "automations:run:" + rk : "automations:open" });
      log(rule, rk, now, id ? "sent" : "off");
      if (id) sendOut(rule, rk, now, l, said);
      n++;
    });
    Object.keys(local.lk).forEach(function (k) { if (!C.find(data, k)) delete local.lk[k]; });
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
  // person's go-ahead). → true when a receiving app was opened (or, for
  // a file step, its reading started). key = the run, for a file step.
  // AS-RT wave 4: "routine" steps run by themselves on the device that
  // sent the notice (never on the others: the inbox has it there).
  function runSelf(rule, key) {
    (rule && rule["do"] || []).forEach(function (a) { if (a.a === "routine") routineStep(a, key); });
  }
  function routineStep(a, key) {
    var H = root.orosRoutineHost;
    function go(h) { return !!(h && typeof h.runAuto === "function" && h.runAuto(a.r, String(key || ""))); }
    if (H) return go(H);
    routinesTick();
    setTimeout(function () { go(root.orosRoutineHost); }, 2000);
    return true;
  }
  function runAction(action, at, said, key) {
    if (action && C.LOCAL[action.a]) { runLocal({ "do": [action] }); return true; }
    if (action && C.SELF && C.SELF[action.a]) return routineStep(action, key || "now" + Date.now());
    var c = C.call(action, at || Date.now(), lang(), C.from(lang()), said);
    if (c && (c.fn === "bridgeFile" || c.fn === "bridgePrint")) return fileStep(c, refFor(key));
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
  // ---------- Item 25: the file a bridge.* run is about ----------
  var FILE_TARGET = {
    scanpdf: function (tok) { return { openFile: { token: tok } }; },
    files: function (tok, f) { return { importFile: { token: tok, name: f.name } }; },
    invoices: function (tok) { return { importPdf: { token: tok } }; }
  };
  // Words in core.js STRINGS ("file.*", every language with them).
  function fileSay(k, o) {
    var S0 = C.STRINGS, tb = S0[lang()] || S0.en, s = tb["file." + k] || S0.en["file." + k] || "";
    s = s.replace("{name}", o && o.name ? o.name : "");
    var N = root.orosNotifs;
    try { if (N && typeof N.transient === "function") N.transient({ ns: "automations", title: s }); } catch (e) {}
  }
  function errKey(e) {
    var c = e && e.code;
    if (c === "changed" || c === "notfound") return "gone";
    if (c === "toolarge") return "big";
    return "off";
  }
  function fileStep(c, ref) {
    if (!ref) { fileSay("none"); return false; }
    var go = function (W) {
      if (c.fn === "bridgePrint") {
        W.print(ref).then(function () { fileSay("printed", ref); },
          function (e) { fileSay(e && (e.code === "noapp" || e.code === "failed") ? "noprint" : errKey(e)); });
        return;
      }
      if (installed().indexOf(c.app) < 0 || !FILE_TARGET[c.app]) return;
      W.readFile(ref).then(function (file) {
        var F = root.orosFileOpen, tok = F && typeof F.hand === "function" ? F.hand(file) : "";
        if (!tok || typeof root.__orosOpenAt !== "function") return;
        root.__orosOpenAt(c.app, FILE_TARGET[c.app](tok, file));
      }, function (e) { fileSay(errKey(e)); });
    };
    bridge().then(go, function () { fileSay("off"); });
    return true;
  }
  // automations/bridge.js, loaded on first use (or at start when on)
  var bridgeLoad = null;
  function bridge() {
    if (root.orosBridgeWatch) return Promise.resolve(root.orosBridgeWatch);
    if (!bridgeLoad) {
      bridgeLoad = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        var v = (document.querySelector('script[src*="automations/host.js"]') || {}).src || "";
        var m = /[?&]v=([^&#]+)/.exec(v);
        s.src = "automations/bridge.js" + (m ? "?v=" + m[1] : "");
        s.onload = function () { root.orosBridgeWatch ? resolve(root.orosBridgeWatch) : reject(new Error("bridge")); };
        s.onerror = function () { bridgeLoad = null; reject(new Error("bridge")); };
        document.head.appendChild(s);
      });
    }
    return bridgeLoad;
  }

  // AS-RT (Chris 2026-11-28): the Assistant's routines get the same
  // clock. assistant/routines.js + assistant/rthost.js load the first
  // time the Assistant's synced data holds a routine; the host does the
  // rest (once a minute, one run at a time, a hidden Assistant frame).
  var rtLoad = 0;
  function hasRoutines() {
    try {
      var d = JSON.parse(localStorage.getItem("oros-assistant-data") || "null");
      var rt = d && d.rt && typeof d.rt === "object" ? d.rt : null;
      return !!rt && Object.keys(rt).some(function (k) { return rt[k] && typeof rt[k] === "object" && !rt[k].del; });
    } catch (e) { return false; }
  }
  function routinesTick() {
    var H = root.orosRoutineHost;
    if (H) { H.tick(); return; }
    if (rtLoad || !hasRoutines()) return;
    rtLoad = 1;
    var v = (document.querySelector('script[src*="automations/host.js"]') || {}).src || "";
    var m = /[?&]v=([^&#]+)/.exec(v), q = m ? "?v=" + m[1] : "";
    function add(src, next) {
      var s = document.createElement("script");
      s.src = src + q;
      s.onload = next;
      s.onerror = function () { rtLoad = 0; };
      document.head.appendChild(s);
    }
    add("assistant/routines.js", function () {
      add("assistant/rthost.js", function () { if (root.orosRoutineHost) root.orosRoutineHost.tick(); });
    });
  }

  // The notice's deep link: one action → straight to it; several →
  // the app's run sheet, one button each.
  function openRun(key) {
    key = String(key || "");
    var rule = C.find(read(), key.split("@")[0]);
    if (typeof root.__orosOpenAt !== "function") return;
    if (!rule) { root.__orosOpenAt("automations", null); return; }
    var acts = C.pending(rule), at = keyTime(key) || Date.now(), said = saidFor(key);
    if (acts.length === 1 && runAction(acts[0], at, said, key)) { log(rule, key, at, "run"); return; }
    root.__orosOpenAt("automations", { run: { r: rule.id, k: key, at: at } });
  }
  // "r…@202611041830" → that local moment.
  function keyTime(key) {
    var m = /@(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?$/.exec(String(key || ""));
    if (!m) return 0;
    return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0).getTime();
  }

  root.orosAutomations = {
    VERSION: "1.4.0",
    rules: function () { return read(); },
    save: save,
    tick: tick,
    runAction: runAction,
    openRun: openRun,
    signal: signal,
    bridge: bridge,
    notice: function (ns, key, text) { return signal("notice", ns, key, text); },
    said: saidFor,
    log: readLog,
    noteRun: function (ruleId, key, at) {
      var rule = C.find(read(), String(ruleId || ""));
      if (rule) log(rule, String(key || "manual"), typeof at === "number" ? at : Date.now(), "run");
    },
    installed: installed,
    appName: appName,
    onChange: onChange,
    routines: function () { routinesTick(); return root.orosRoutineHost || null; }
  };
  root.orosEvents = events;
  registerSlice();
  // Item 25: folders on this computer, when the person turned them on here
  try { var bw = JSON.parse(localStorage.getItem("oros-bridge-watch")); if (bw && bw.on) setTimeout(function () { bridge().then(null, function () {}); }, 3000); }
  catch (e) {}
})(window);
