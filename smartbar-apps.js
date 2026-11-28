// ============================================================
// orOS — smartbar-apps.js (smart top bar SB5, v1.1.0)
// ------------------------------------------------------------
// The smart top bar's cards of other apps, loaded by smartbar.js the
// first time one of them is ticked (so start-up stays as it was).
// Every card reads the app's own Today provider through
// orosToday.agenda(app, days): the same clean rows as the Today
// summary, whatever Today's own on/off says, since the person ticked
// the card. Read-only. Pure part unit-tested (tests/smartbar.test.js).
//   Habits, Plants, Chores, Kanban   how many are due today or late
//   Timesheet timer                  live time while it runs
//   Overdue invoices                 a count only (hidden under
//                                    Sensitive work, like meals, the
//                                    book and trip names)
//   Next trip                        Today / Tomorrow / in N days
//   Today's meals, the book you are reading   today's line
// Cards of the device itself (OWN, not from an agenda):
//   Screen time (STC-1)   today's total; tap: the apps, longest first
//                         (names hidden under Sensitive work, locked
//                         apps never listed); off = no card
//   Storage (STORE-1)     free space: the disk orOS's data is on where
//                         the orOS USB / Portable host reports it
//                         (<html data-oros-sys-disk="free total">),
//                         else the browser's own estimate for orOS;
//                         the warning colour under 10 %
//   Exchange rate (RATES-1)  the Unit Converter's currency pair from the
//                         ECB rates the Calculator / Unit Converter
//                         already keeps (oros-units-rates): nothing new
//                         is fetched; a tap opens the converter on it
//   Mail (MAILCARD-1)     unread in the Inboxes (the count Mail keeps on
//                         this device); tap: a peek with the unread
//                         messages first and Starred one tap away, a
//                         row opens the message in Mail. Read only, from
//                         Mail's own cache (IndexedDB "oros-mail",
//                         opened without a version and closed at once,
//                         never the "keys" / "creds" stores). Nothing
//                         under Sensitive work or while Mail is locked.
// ============================================================
(function (root) {
  "use strict";

  // SB5: cards read from another app's own Today provider
  // (orosToday.agenda(app, days): the same clean rows as the summary,
  // whatever Today's own on/off says, since the person ticked the card).
  var AGENDA = { habits: ["habits", 1], plants: ["plants", 1], chores: ["chores", 1], timer: ["timesheet", 1],
                 invoices: ["invoices", 1], trip: ["travel", 31], kanban: ["kanban", 1], meal: ["meals", 1],
                 reading: ["library", 1] };
  function dayGap(a, b) {               // whole days from YYYY-MM-DD a to b
    var pa = a.split("-"), pb = b.split("-");
    return Math.round((Date.UTC(+pb[0], +pb[1] - 1, +pb[2]) - Date.UTC(+pa[0], +pa[1] - 1, +pa[2])) / 86400000);
  }
  var YMD = /^\d{4}-\d{2}-\d{2}$/;
  // SB5: one app's agenda rows (today/agg.js cleanRow) → what its card says.
  //   habits / plants / chores / kanban: { n, first } of the tasks due
  //     today or late (kanban: also cards that start today);
  //   invoices: { n, first } of the late tasks (unpaid invoices and bills
  //     past their day; recurring reminders without a day are left out);
  //   trip: { days, row } of the next trip day (a departure, or a trip
  //     running today), up to the horizon;
  //   meal / reading / timer: { row } of the first info line of today
  //     (timer: the "run" line only, a timer that runs now).
  //   → null when there is nothing to say.
  function agendaCard(kind, rows, today) {
    if (!Array.isArray(rows) || !YMD.test(today || "")) return null;
    var ok = rows.filter(function (r) { return r && typeof r === "object" && typeof r.title === "string" && r.title; });
    function due(r) { return YMD.test(r.due || "") ? r.due : today; }
    if (kind === "habits" || kind === "plants" || kind === "chores" || kind === "kanban" || kind === "invoices") {
      var late = kind === "invoices";
      var hit = ok.filter(function (r) {
        if (r.kind === "info") return false;
        if (late) return r.kind === "task" && YMD.test(r.due || "") && r.due < today;
        if (r.kind === "task") return due(r) <= today;
        return kind === "kanban" && r.kind === "event" && due(r) === today;
      });
      return hit.length ? { n: hit.length, first: hit[0] } : null;
    }
    if (kind === "trip") {
      var best = null;
      ok.forEach(function (r) {
        if (r.kind !== "event" || !r.target || r.target.tab !== "" || !YMD.test(r.due || "") || r.due < today) return;
        if (!best || r.due < best.due) best = r;
      });
      return best ? { days: dayGap(today, best.due), row: best } : null;
    }
    if (kind === "meal" || kind === "reading" || kind === "timer") {
      var line = ok.filter(function (r) { return r.kind === "info" && due(r) === today && (kind !== "timer" || r.id === "run"); })[0];
      return line ? { row: line } : null;
    }
    return null;
  }

  // STC-1: seconds → "1 h 5 min" with the Screen time strings.
  function durOf(secs, t) {
    var m = Math.max(0, Math.floor(secs / 60));
    if (m < 60) return t("st.fmt.m").replace("{m}", m);
    if (m % 60 === 0) return t("st.fmt.h").replace("{h}", m / 60);
    return t("st.fmt.hm").replace("{h}", Math.floor(m / 60)).replace("{m}", m % 60);
  }
  // STC-1: the peek's rows: real apps (never the desktop, Sensitive work
  // or a locked app), longest first, at most `max`; pct of the longest.
  function screenRows(apps, locked, max) {
    var list = (Array.isArray(apps) ? apps : []).filter(function (a) {
      return a && typeof a.id === "string" && a.id.charAt(0) !== "~" && a.secs >= 60 && !(locked && locked(a.id));
    });
    var top = list.length ? list[0].secs : 0;
    return list.slice(0, max || 8).map(function (a) { return { id: a.id, name: a.name || a.id, secs: a.secs, pct: top ? Math.max(4, Math.round(a.secs / top * 100)) : 0 }; });
  }

  // STORE-1: the host's "free total" (bytes), else the browser's
  // estimate { usage, quota } → { free, total, pct, low, host } or null.
  var LOW_PCT = 10;
  function storageOf(attr, est) {
    var m = /^(\d{1,16}) (\d{1,16})$/.exec(String(attr || ""));
    var free, total, host = false;
    if (m && +m[2] > 0 && +m[1] <= +m[2]) { free = +m[1]; total = +m[2]; host = true; }
    else if (est && typeof est.quota === "number" && est.quota > 0 && typeof est.usage === "number" && est.usage >= 0) {
      total = est.quota; free = Math.max(0, est.quota - est.usage);
    } else return null;
    var pct = Math.round(free / total * 1000) / 10;
    return { free: free, total: total, pct: pct, low: pct < LOW_PCT, host: host };
  }
  // Bytes → "183 GB", "7,4 GB", "512 MB" (decimal units, the language's mark).
  function bytesOf(n, loc) {
    var u = n >= 1e12 ? ["TB", 1e12] : n >= 1e9 ? ["GB", 1e9] : ["MB", 1e6];
    var v = n / u[1], d = v >= 100 ? 0 : 1;
    var s;
    try { s = v.toLocaleString(loc || "en", { maximumFractionDigits: d, minimumFractionDigits: 0 }); }
    catch (e) { s = String(Math.round(v * (d ? 10 : 1)) / (d ? 10 : 1)); }
    return s + " " + u[0];
  }

  // RATES-1: the converter's pair (oros-units-prefs pairs.currency,
  // default EUR → USD) with the stored ECB rates (EUR-based) →
  // { f, t, v, date } or null.
  var CUR_RE = /^[A-Z]{3}$/;
  function ratePair(rates, prefs) {
    if (!rates || typeof rates !== "object" || rates.base !== "EUR" || !rates.rates || typeof rates.rates !== "object") return null;
    var p = prefs && prefs.pairs && prefs.pairs.currency;
    var f = p && CUR_RE.test(p.f) ? p.f : "EUR", to = p && CUR_RE.test(p.t) ? p.t : "USD";
    if (f === to) { f = "EUR"; to = "USD"; }
    var r = function (c) { var v = c === "EUR" ? 1 : rates.rates[c]; return typeof v === "number" && isFinite(v) && v > 0 ? v : null; };
    var a = r(f), b = r(to);
    if (!a || !b) return null;
    return { f: f, t: to, v: b / a, date: /^\d{4}-\d{2}-\d{2}$/.test(rates.date || "") ? rates.date : "" };
  }
  // 1.0842, 162.35, 0.0061: 2 decimals from 100 up, else 4.
  function rateText(v, loc) {
    var d = v >= 100 ? 2 : 4;
    try { return v.toLocaleString(loc || "en", { maximumFractionDigits: d }); }
    catch (e) { return String(Math.round(v * 1e4) / 1e4); }
  }

  // MAILCARD-1 (pure): the living accounts of oros-mail-data (as
  // mail/today.js), the unread count of their Inboxes, and the peek's rows.
  var ACCT_RE = /^[a-z0-9]{6,40}$/;
  function mailAccounts(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.accounts)) return [];
    var tombs = data.tombs && typeof data.tombs === "object" ? data.tombs : {};
    return data.accounts.filter(function (a) {
      return a && typeof a.id === "string" && ACCT_RE.test(a.id) && typeof a.email === "string" &&
        !(typeof tombs[a.id] === "number" && typeof a.m === "number" && tombs[a.id] >= a.m);
    });
  }
  function mailUnread(accts, folders) {
    var n = 0;
    accts.forEach(function (a) {
      var rec = folders && folders[a.id];
      (rec && Array.isArray(rec.list) ? rec.list : []).forEach(function (f) {
        if (f && f.name === "INBOX" && typeof f.unseen === "number" && f.unseen > 0) n += Math.floor(f.unseen);
      });
    });
    return n;
  }
  // heads { acctId: { msgs } } → rows { acct, uid, who, subj, date, seen }:
  // "unread" = the unread ones, newest first; "starred" = \Flagged ones.
  function mailRows(accts, heads, mode, max) {
    var out = [];
    accts.forEach(function (a) {
      var rec = heads && heads[a.id];
      (rec && Array.isArray(rec.msgs) ? rec.msgs : []).forEach(function (m) {
        if (!m || typeof m.uid !== "number" || m.uid <= 0) return;
        var fl = Array.isArray(m.flags) ? m.flags : [];
        if (fl.indexOf("\\Deleted") >= 0) return;
        var seen = fl.indexOf("\\Seen") >= 0, star = fl.indexOf("\\Flagged") >= 0;
        if (mode === "starred" ? !star : seen) return;
        var from = m.from && typeof m.from === "object" ? m.from : {};
        out.push({ acct: a.id, uid: m.uid, who: String(from.name || from.addr || "").slice(0, 80),
                   subj: typeof m.subj === "string" ? m.subj.slice(0, 200) : "", date: typeof m.date === "number" ? m.date : 0, seen: seen });
      });
    });
    out.sort(function (x, y) { return (y.date - x.date) || (y.uid - x.uid); });
    return out.slice(0, max || 8);
  }

  // Icons: fixed markup, never data.
  var IC = {
    habits: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l4 4L20 5"/><path d="M4 20h16"/></svg>',
    plants: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21v-9"/><path d="M12 12c0-4 3-7 8-7 0 5-3 8-8 7z"/><path d="M12 14c0-3-2.5-5.5-7-5.5 0 4 2.5 6 7 5.5z"/></svg>',
    chores: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l6-6"/><path d="M14.5 3.5l6 6-6 6-6-6z"/></svg>',
    timer: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4h3M9 2.5h6"/><path d="M19 5l1.5 1.5"/></svg>',
    invoices: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
    trip: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 13.5l19-7-7 19-2.5-8z"/></svg>',
    kanban: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M9.5 4v16M15 4v16"/></svg>',
    meal: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10"/><path d="M17 21V3c-2 1.5-3 4-3 7v3h3"/></svg>',
    reading: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5.5c3-1.5 6-1.5 9 .5 3-2 6-2 9-.5V19c-3-1.5-6-1.5-9 .5-3-2-6-2-9-.5z"/><path d="M12 6v13.5"/></svg>',
    screen: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v5l3 2"/><path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M20.5 4v4h-4"/></svg>'
  };
  IC.storage = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>';
  // The cards that are not an app's agenda (OWN): their kinds.
  IC.rates = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/></svg>';
  IC.mail = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>';
  var OWN = { screen: 1, storage: 1, rates: 1, mail: 1 };
  var PEEKS = { screen: 1, mail: 1 };

  // api (from smartbar.js): { t, call, strict, appName, clock, ymdOf,
  //   ttl, host(), kinds() (the ticked kinds), repaint(kinds), peek(kind) }
  function make(api) {
    var t = api.t, call = api.call, strict = api.strict, appName = api.appName, clock = api.clock, ymdOf = api.ymdOf;
    var ag = {};                       // app → { rows, at, busy }
    var tsRaw = null, tsRun = null;    // the Timesheet timer, parsed only when its data changes
    function cardOf(kind, now) {
      var a = AGENDA[kind], c = ag[a[0]];
      refreshAgenda(a[0], a[1], false);
      if (!c) return null;
      return call(function () { return agendaCard(kind, c.rows, ymdOf(new Date(now))); }) || null;
    }
    function opener(kind, row) {
      var app = AGENDA[kind][0];
      return function () {
        if (row && row.target && root.orosToday && root.orosToday.open) root.orosToday.open(app, row.target);
        else api.host().open(app);
      };
    }
    function countCard(kind, now) {
      var c = cardOf(kind, now);
      if (!c) return null;
      var app = AGENDA[kind][0], first = kind === "invoices" ? "" : c.first.title;
      var more = c.n > 1 ? t("sb.list.more").replace("{n}", c.n - 1) : "";
      var tip = (first ? t("sb.list.tip").replace("{t}", first).replace("{more}", more) : t("sb.invoices.tip").replace("{n}", c.n)) + " · " + appName(app);
      return { v: String(c.n), l: t("sb." + kind + (c.n === 1 ? ".one" : ".label")), cls: kind === "invoices" ? "sb-soon" : "",
               tip: tip, go: opener(kind, c.n === 1 ? c.first : null) };
    }
    function lineCard(kind, now) {
      var c = cardOf(kind, now);
      if (!c) return null;
      var app = AGENDA[kind][0];
      return { v: c.row.title, l: "", cls: "sb-txt", tip: c.row.title + (c.row.text ? " · " + c.row.text : "") + " · " + appName(app),
               go: opener(kind, c.row) };
    }
    // The running Timesheet entry, from its own core (loaded with its
    // provider), parsed again only when the stored text changes.
    function timerRun() {
      var C = root.orosTimesheetCore;
      if (!C) return null;
      var raw = null;
      try { raw = localStorage.getItem(C.STORAGE_KEY); } catch (e) {}
      if (raw !== tsRaw) {
        tsRaw = raw;
        tsRun = call(function () { var d = raw ? C.parse(raw) : null; return d ? C.running(d)[0] || null : null; }) || null;
      }
      return tsRun && typeof tsRun.s === "number" ? tsRun : null;
    }
    function wantsAgenda(app) {
      return api.kinds().some(function (k) { return AGENDA[k] && AGENDA[k][0] === app; });
    }
    function refreshAgenda(app, days, force) {
      var c = ag[app], now = Date.now();
      if (!(root.orosToday && root.orosToday.agenda) || !wantsAgenda(app)) return;
      if (c && (c.busy || (!force && now - c.at < api.ttl))) return;
      c = ag[app] = c || { rows: null, at: 0, busy: false };
      c.busy = true;
      root.orosToday.agenda(app, days).then(function (rows) {
        c.busy = false; c.at = Date.now(); c.rows = Array.isArray(rows) ? rows : [];
        api.repaint(Object.keys(AGENDA).filter(function (k) { return AGENDA[k][0] === app; }));
      }, function () { c.busy = false; c.at = Date.now(); });
    }
    function agendaStale() { Object.keys(ag).forEach(function (a) { ag[a].at = 0; }); }
    function appLocked(id) {
      var L = root.orosLock;
      return !!call(function () { return L && L.apps && L.apps.state(id); });
    }
    // STC-1: Screen time's own numbers for today (device-local, read only).
    function screenUse() {
      var S = root.orosScreenTime;
      return S && typeof S.todayUse === "function" ? call(function () { return S.todayUse(); }) : null;
    }
    function openScreenTime() {
      call(function () { root.__orosOpenAt("settings", { section: "screentime" }); });
    }
    // STORE-1: the browser's estimate, asked at most every 10 minutes.
    var est = null, estAt = 0, estBusy = false;
    function estimate() {
      var S = root.navigator && root.navigator.storage;
      if (estBusy || !S || typeof S.estimate !== "function" || (est && Date.now() - estAt < 600000)) return est;
      estBusy = true;
      S.estimate().then(function (e) {
        estBusy = false; estAt = Date.now();
        est = e && typeof e === "object" ? { usage: e.usage, quota: e.quota } : null;
        api.repaint(["storage"]);
      }, function () { estBusy = false; estAt = Date.now(); });
      return est;
    }
    // MAILCARD-1: Mail's cache, read without a version (nothing is
    // created on a device without Mail) and closed at once.
    var mailFolders = null, mailAt = 0, mailBusy = false, mailTab = "unread";
    function mailOff() {
      if (strict()) return true;
      var L = root.orosLock;
      return !!call(function () { return L && L.apps && L.apps.state("mail"); });
    }
    function mailData() { try { return JSON.parse(localStorage.getItem("oros-mail-data") || "null"); } catch (e) { return null; } }
    function mailDb(stores, keys, done) {
      var idb = null, rq;
      try { idb = root.indexedDB; } catch (e) {}
      if (!keys.length || !idb || typeof idb.open !== "function") { done({}); return; }
      try { rq = idb.open("oros-mail"); } catch (e) { done({}); return; }
      rq.onupgradeneeded = function () { try { rq.transaction.abort(); } catch (e) {} };
      rq.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); done({}); };
      rq.onblocked = function () { done({}); };
      rq.onsuccess = function () {
        var db = rq.result, out = {}, left = keys.length;
        db.onversionchange = function () { db.close(); };
        if (!db.objectStoreNames.contains(stores)) { db.close(); done({}); return; }
        var one = function () { if (--left === 0) { db.close(); done(out); } };
        try {
          var st = db.transaction(stores, "readonly").objectStore(stores);
          keys.forEach(function (k) {
            var g = st.get(k[1]);
            g.onsuccess = function () { if (g.result) out[k[0]] = g.result; one(); };
            g.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); one(); };
          });
        } catch (e) { db.close(); done({}); }
      };
    }
    function mailRefresh() {
      if (mailBusy || Date.now() - mailAt < api.ttl) return;
      var accts = mailAccounts(mailData());
      mailBusy = true;
      mailDb("folders", accts.map(function (a) { return [a.id, a.id]; }), function (recs) {
        mailBusy = false; mailAt = Date.now(); mailFolders = recs;
        api.repaint(["mail"]);
      });
    }
    var FILL = {
      mail: function (p, kit) {
        if (mailOff()) return false;
        var accts = mailAccounts(mailData());
        if (!accts.length) return false;
        var tabs = kit.el("div", "pk-tabs");
        tabs.setAttribute("role", "group");
        ["unread", "starred"].forEach(function (k) {
          var b = kit.pbtn("pk-tab" + (mailTab === k ? " on" : ""), t("sb.mail." + k), function () {
            mailTab = k; p.textContent = ""; FILL.mail(p, kit);
            var f = p.querySelector(".pk-tab.on"); if (f) f.focus();
          });
          b.setAttribute("aria-pressed", mailTab === k ? "true" : "false");
          tabs.appendChild(b);
        });
        p.appendChild(tabs);
        var box = kit.el("div", "pk-mail");
        box.appendChild(kit.el("div", "pk-empty", t("sb.mail.loading")));
        p.appendChild(box);
        var tab = mailTab;
        mailDb("heads", accts.map(function (a) { return [a.id, a.id + "|INBOX"]; }), function (heads) {
          if (!box.isConnected || tab !== mailTab || mailOff()) return;
          box.textContent = "";
          var rows = mailRows(accts, heads, tab, 8);
          rows.forEach(function (r) {
            var b = kit.pbtn("pk-row pk-msg" + (r.seen ? "" : " pk-unread"), null, function () {
              kit.close();
              call(function () { root.__orosOpenAt("mail", { acct: r.acct, folder: "INBOX", uid: r.uid }); });
            }, (r.who ? r.who + ": " : "") + (r.subj || t("sb.mail.nosubj")));
            b.appendChild(kit.el("span", "pk-who", r.who || "—"));
            b.appendChild(kit.el("span", "pk-w", r.subj || t("sb.mail.nosubj")));
            box.appendChild(b);
          });
          if (!rows.length) box.appendChild(kit.el("div", "pk-empty", t(tab === "starred" ? "sb.mail.nostar" : "sb.mail.none")));
        });
        p.appendChild(kit.pbtn("pk-open", t("pk.open").replace("{app}", appName("mail") || "Mail"), function () { kit.open("mail"); }));
        return true;
      },
      screen: function (p, kit) {
        var u = screenUse();
        if (!u || !u.on) return false;
        var h = kit.el("div", "pk-h");
        var tx = kit.el("div");
        tx.appendChild(kit.el("b", null, durOf(u.total, t)));
        tx.appendChild(kit.el("small", null, t("sb.screen.today")));
        h.appendChild(tx);
        p.appendChild(h);
        if (strict()) p.appendChild(kit.el("div", "pk-empty", t("sb.screen.hidden")));
        else {
          var rows = screenRows(u.apps, appLocked, 8);
          rows.forEach(function (r) {
            var b = kit.pbtn("pk-row pk-st", null, function () { kit.open(r.id); }, r.name + ": " + durOf(r.secs, t));
            b.appendChild(kit.el("span", "pk-w", r.name));
            b.appendChild(kit.el("span", "pk-t", durOf(r.secs, t)));
            var bar = kit.el("span", "pk-bar");
            var fill = kit.el("span");
            fill.style.setProperty("width", r.pct + "%");
            bar.appendChild(fill);
            b.appendChild(bar);
            p.appendChild(b);
          });
          if (!rows.length) p.appendChild(kit.el("div", "pk-empty", t("sb.screen.none")));
        }
        p.appendChild(kit.pbtn("pk-open", t("sb.screen.open"), function () { kit.close(); openScreenTime(); }));
        return true;
      }
    };
    var STATE = {
      habits: function (now) { return countCard("habits", now); },
      plants: function (now) { return countCard("plants", now); },
      chores: function (now) { return countCard("chores", now); },
      kanban: function (now) { return countCard("kanban", now); },
      invoices: function (now) { return strict() ? null : countCard("invoices", now); },
      trip: function (now) {
        var c = cardOf("trip", now);
        if (!c) return null;
        var when = c.days <= 0 ? t("sb.trip.today") : (c.days === 1 ? t("sb.trip.tomorrow") : t("sb.trip.in").replace("{n}", c.days));
        var name = strict() ? t("sb.event.hidden") : c.row.title;
        return { v: when, l: name, cls: c.days <= 0 ? "sb-now" : (c.days === 1 ? "sb-soon" : ""),
                 tip: t("sb.trip.tip").replace("{t}", name).replace("{w}", when).replace("{app}", appName("travel")), go: opener("trip", c.row) };
      },
      meal: function (now) { return strict() ? null : lineCard("meal", now); },
      reading: function (now) { return strict() ? null : lineCard("reading", now); },
      // MAILCARD-1: a count only (never a sender or a subject in the bar).
      mail: function () {
        if (mailOff()) return null;
        mailRefresh();
        var n = mailFolders ? mailUnread(mailAccounts(mailData()), mailFolders) : 0;
        if (!n) return null;
        var v = n > 999 ? "999+" : String(n);
        return { v: v, l: t(n === 1 ? "sb.mail.one" : "sb.mail.label"), tip: t("sb.mail.tip").replace("{n}", v).replace("{app}", appName("mail") || "Mail"),
                 go: function () { if (!api.peek || !api.peek("mail")) api.host().open("mail"); } };
      },
      // RATES-1: hidden under Sensitive work, like the money cards.
      rates: function () {
        if (strict()) return null;
        var read = function (k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
        var r = ratePair(read("oros-units-rates"), read("oros-units-prefs"));
        if (!r) return null;
        var loc = call(function () { return root.orosI18n.locale(api.host().lang ? api.host().lang() : "en"); }) || undefined;
        var v = rateText(r.v, loc), app = appName("units") || appName("calculator");
        return { v: v, l: r.f + " → " + r.t,
                 tip: t("sb.rates.tip").replace("{f}", r.f).replace("{v}", v).replace("{t}", r.t).replace("{d}", r.date || "—").replace("{app}", app),
                 go: function () { call(function () { root.__orosOpenAt("units", { cat: "currency", from: r.f, to: r.t, value: 1 }); }); } };
      },
      // STORE-1: free space; the warning colour under 10 %.
      storage: function () {
        var attr = call(function () { return root.document.documentElement.getAttribute("data-oros-sys-disk"); });
        var s = storageOf(attr, attr ? null : estimate());
        if (!s) return null;
        var loc = call(function () { return root.orosI18n.locale(api.host().lang ? api.host().lang() : "en"); }) || undefined;
        var f = bytesOf(s.free, loc), tot = bytesOf(s.total, loc);
        var pct = call(function () { return s.pct.toLocaleString(loc, { maximumFractionDigits: 0 }); }) || String(Math.round(s.pct));
        return { v: f, l: t(s.low ? "sb.storage.low" : "sb.storage.label"), cls: s.low ? "sb-soon" : "",
                 tip: t(s.host ? "sb.storage.tip.disk" : "sb.storage.tip").replace("{f}", f).replace("{t}", tot).replace("{p}", pct),
                 go: function () { call(function () { root.__orosOpenAt("settings", { section: "system", item: "about-device" }); }); } };
      },
      // STC-1: only while Screen time is on and today has a minute.
      screen: function () {
        var u = screenUse();
        if (!u || !u.on || u.total < 60) return null;
        var d = durOf(u.total, t);
        return { v: d, l: t("sb.screen.label"), tip: t("sb.screen.tip").replace("{d}", d),
                 go: function () { if (!api.peek || !api.peek("screen")) openScreenTime(); } };
      },
      timer: function (now) {
        var c = cardOf("timer", now), run = c ? timerRun() : null;
        if (!c || (root.orosTimesheetCore && !run)) return null;   // stopped since the last read
        var left = run ? clock(Math.max(0, now - run.s)) : c.row.title;
        var p = c.row.text || "";
        return { v: left, l: p, cls: "sb-soon",
                 tip: t("sb.timer.tip").replace("{r}", left).replace("{p}", p || "—").replace("{app}", appName("timesheet")), go: opener("timer", c.row) };
      }
    };
    return {
      state: function (kind, now) { return STATE[kind] ? STATE[kind](now) : null; },
      icon: function (kind) { return IC[kind] || ""; },
      stale: agendaStale,
      canPeek: function (kind) { return !!PEEKS[kind] && !!STATE[kind] && !!STATE[kind](Date.now()); },
      fill: function (kind, panel, kit) { return FILL[kind] ? FILL[kind](panel, kit) : false; }
    };
  }

  var EXP = { VER: "1.1.0", AGENDA: AGENDA, OWN: OWN, KINDS: Object.keys(AGENDA).concat(Object.keys(OWN)), agendaCard: agendaCard, dayGap: dayGap,
              durOf: durOf, screenRows: screenRows, storageOf: storageOf, bytesOf: bytesOf, LOW_PCT: LOW_PCT,
              ratePair: ratePair, rateText: rateText, mailAccounts: mailAccounts, mailUnread: mailUnread, mailRows: mailRows, make: make };
  if (typeof module !== "undefined" && module.exports) module.exports = EXP;
  root.orosSmartBarApps = EXP;
})(typeof window !== "undefined" ? window : globalThis);
