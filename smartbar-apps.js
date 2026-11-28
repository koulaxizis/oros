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
  // The cards that are not an app's agenda (OWN): their kinds.
  var OWN = { screen: 1 };
  var PEEKS = { screen: 1 };

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
    var FILL = {
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
              durOf: durOf, screenRows: screenRows, make: make };
  if (typeof module !== "undefined" && module.exports) module.exports = EXP;
  root.orosSmartBarApps = EXP;
})(typeof window !== "undefined" ? window : globalThis);
