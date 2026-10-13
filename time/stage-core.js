// ============================================================
// orOS Time — Stage core (v1.0.0, wave 1)
// Pure logic of the Stage tab (a conference / stage timer): the
// synced data model (events + rundown items + tombstones), its merge
// (slice "stage", key oros-time-stage), the running timer of the
// live item and the day's schedule (planned vs expected, behind /
// ahead). No DOM; time/stage.js draws it. UMD: window.OrosStageCore
// in the app, module.exports under Node for tests/time-stage.test.js.
//
// Synced (oros-time-stage):
//   { v: 1,
//     events: [{ id, name, date "YYYY-MM-DD"|"", start "HH:MM"|"",
//                yellow s, red s, flash bool, mtime }],
//     items:  [{ id, ev, pos, title, speaker, kind, dur s,
//                until "HH:MM"|"", auto bool, yellow s|null,
//                red s|null, notes, mtime }],
//     msgs:   [{ id, text, mtime }],      (wave 2: saved speaker messages;
//                                          the key is left out when empty)
//     tombs:  [{ id, t }] }
// Device-local (oros-time-stage-run, never synced): which event is
// open, the live item and its clock, actual start/end per item.
//   { ev, cur, startedAt, pausedAt, adj s, log: { itemId: {s, e} } }
// Device-local (oros-time-stage-show, wave 2): what the stage output
// shows besides the clock; read by the in-app view and display.html.
//   { black, layout: full|timer|agenda, mirror, logoAt,
//     msg: { text, on, flash, color: white|yellow|red|green, at } }
// ============================================================
(function (root) {
  "use strict";

  var KINDS = ["down", "up", "until", "clock"];
  var DEF_YELLOW = 120, DEF_RED = 30;          // seconds left
  var MAX_DUR = 24 * 3600;
  var ID_RE = /^[a-z0-9]{4,24}$/;
  var HM_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
  var YMD_RE = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

  function num(x, d) { return (typeof x === "number" && isFinite(x)) ? x : d; }
  function str(x, max) {
    if (typeof x !== "string") return "";
    // control characters out (newlines kept only in notes, by caller)
    return x.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, max);
  }
  function line(x, max) { return str(x, max).replace(/[\r\n\t]+/g, " ").trim(); }
  function secs(x, d, max) {
    var n = num(x, d);
    if (n === null) return null;
    return Math.max(0, Math.min(max, Math.round(n)));
  }

  function normEvent(e) {
    if (!e || typeof e !== "object" || typeof e.id !== "string" || !ID_RE.test(e.id)) return null;
    return {
      id: e.id,
      name: line(e.name, 120),
      date: (typeof e.date === "string" && YMD_RE.test(e.date)) ? e.date : "",
      start: (typeof e.start === "string" && HM_RE.test(e.start)) ? e.start : "",
      yellow: secs(e.yellow, DEF_YELLOW, 3600),
      red: secs(e.red, DEF_RED, 3600),
      flash: e.flash !== false,
      mtime: num(e.mtime, 0)
    };
  }
  function normItem(it) {
    if (!it || typeof it !== "object" || typeof it.id !== "string" || !ID_RE.test(it.id)) return null;
    if (typeof it.ev !== "string" || !ID_RE.test(it.ev)) return null;
    var kind = KINDS.indexOf(it.kind) >= 0 ? it.kind : "down";
    var y = (it.yellow === null || it.yellow === undefined) ? null : secs(it.yellow, null, 3600);
    var r = (it.red === null || it.red === undefined) ? null : secs(it.red, null, 3600);
    return {
      id: it.id,
      ev: it.ev,
      pos: num(it.pos, 0),
      title: line(it.title, 200),
      speaker: line(it.speaker, 120),
      kind: kind,
      dur: secs(it.dur, 600, MAX_DUR),
      until: (typeof it.until === "string" && HM_RE.test(it.until)) ? it.until : "",
      auto: it.auto === true,
      yellow: y,
      red: r,
      notes: str(it.notes, 2000),
      mtime: num(it.mtime, 0)
    };
  }
  function normMsg(m) {
    if (!m || typeof m !== "object" || typeof m.id !== "string" || !ID_RE.test(m.id)) return null;
    var text = line(m.text, 200);
    if (!text) return null;
    return { id: m.id, text: text, mtime: num(m.mtime, 0) };
  }
  function normTomb(d) {
    if (!d || typeof d !== "object" || typeof d.id !== "string" || !ID_RE.test(d.id)) return null;
    return { id: d.id, t: num(d.t, 0) };
  }
  function list(x, fn) { return (Array.isArray(x) ? x : []).map(fn).filter(Boolean); }

  // Symmetric pick (Bible: merge engine shape): newer mtime, then the
  // larger canonical JSON, so every device keeps the same copy.
  function newer(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.mtime !== b.mtime) return a.mtime > b.mtime ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }
  function byId(x, y) { return x.id < y.id ? -1 : x.id > y.id ? 1 : 0; }

  // merge(local, remote): union by id, LWW per entity, tombstones
  // (delete wins ties). The output is canonical (sorted, fixed key order), so merge(s, s) is
  // the one form the getter, the storage and the merge all use.
  function merge(a, b) {
    a = a || {}; b = b || {};
    var tomb = {};
    list(a.tombs, normTomb).concat(list(b.tombs, normTomb)).forEach(function (d) {
      if (!tomb[d.id] || d.t > tomb[d.id].t) tomb[d.id] = d;
    });
    function pickAll(xs) {
      var m = {};
      xs.forEach(function (x) { m[x.id] = newer(m[x.id], x); });
      return m;
    }
    var evs = pickAll(list(a.events, normEvent).concat(list(b.events, normEvent)));
    var its = pickAll(list(a.items, normItem).concat(list(b.items, normItem)));
    var mss = pickAll(list(a.msgs, normMsg).concat(list(b.msgs, normMsg)));
    var alive = function (x) { return !(tomb[x.id] && tomb[x.id].t >= x.mtime); };
    var events = [], items = [];
    Object.keys(evs).forEach(function (id) {
      if (alive(evs[id])) { events.push(evs[id]); delete tomb[id]; }
    });
    // Deleting an event tombstones each of its items too (stage.js),
    // so the merge stays a plain union: no cascade here, which keeps
    // it associative. An item edited on another device after its
    // event was deleted survives as data and is simply not shown.
    Object.keys(its).forEach(function (id) {
      if (alive(its[id])) { items.push(its[id]); delete tomb[id]; }
    });
    var msgs = [];
    Object.keys(mss).forEach(function (id) {
      if (alive(mss[id])) { msgs.push(mss[id]); delete tomb[id]; }
    });
    var tombs = Object.keys(tomb).map(function (id) { return tomb[id]; });
    events.sort(byId); items.sort(byId); msgs.sort(byId); tombs.sort(byId);
    var out = { v: 1, events: events, items: items, tombs: tombs };
    // "msgs" only when there are some: a wave-1 device (no msgs) and
    // this one then write the same bytes, so a mixed fleet never
    // re-uploads in turns over an empty list.
    if (msgs.length) out = { v: 1, events: events, items: items, msgs: msgs, tombs: tombs };
    return out;
  }
  function canon(s) { return merge(s, s); }
  function empty() { return { v: 1, events: [], items: [], tombs: [] }; }

  // Items of one event in rundown order (pos, then id).
  function rundown(data, evId) {
    return (data && Array.isArray(data.items) ? data.items : []).filter(function (it) {
      return it.ev === evId;
    }).sort(function (x, y) { return x.pos - y.pos || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0); });
  }
  // A pos between two neighbours (fractional ordering: moving one
  // item never rewrites the others, so two devices can reorder).
  function posBetween(before, after) {
    if (before === null && after === null) return 1000;
    if (before === null) return after - 1000;
    if (after === null) return before + 1000;
    return (before + after) / 2;
  }

  // ---------- Clock helpers (local time) ----------
  function hmToMs(dayMs, hm) {
    var d = new Date(dayMs);
    d.setHours(+hm.slice(0, 2), +hm.slice(3, 5), 0, 0);
    return d.getTime();
  }
  function dayStart(ymd, now) {
    var d;
    if (ymd && YMD_RE.test(ymd)) d = new Date(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));
    else { d = new Date(now); d.setHours(0, 0, 0, 0); }
    return d.getTime();
  }
  function thresholds(item, ev) {
    return {
      yellow: (item && item.yellow !== null && item.yellow !== undefined) ? item.yellow : (ev ? ev.yellow : DEF_YELLOW),
      red: (item && item.red !== null && item.red !== undefined) ? item.red : (ev ? ev.red : DEF_RED)
    };
  }
  // The clock time an "until" item ends at, on or after `from`.
  function untilAt(item, from) {
    if (!item.until) return from + item.dur * 1000;
    var t = hmToMs(from, item.until);
    if (t < from - 12 * 3600000) t += 86400000;   // "until 00:30" after a late start
    return t;
  }

  // ---------- The live timer ----------
  // timer(item, ev, run, now) -> { kind, started, paused, elapsed,
  //   remaining (ms, may be negative), total (ms), shown (ms, signed
  //   for count-downs), phase: idle|ok|warn|red|over|clock, progress }
  function timer(item, ev, run, now) {
    var started = !!(run && run.cur === item.id && run.startedAt);
    var paused = started && !!run.pausedAt;
    var at = paused ? run.pausedAt : now;
    var adj = (started ? num(run.adj, 0) : 0) * 1000;
    var elapsed = started ? Math.max(0, at - run.startedAt) : 0;
    var total, remaining, shown;
    if (item.kind === "until" && item.until) {
      var from = started ? run.startedAt : now;
      var end = untilAt(item, from) + adj;
      total = Math.max(0, end - from);
      remaining = end - (started ? at : now);
      shown = remaining;
    } else {
      total = Math.max(0, item.dur * 1000 + adj);
      remaining = total - elapsed;
      shown = item.kind === "up" ? elapsed : remaining;
    }
    var th = thresholds(item, ev), phase;
    if (item.kind === "clock") phase = "clock";
    else if (!started) phase = "idle";
    else if (item.kind === "up" && total === 0) phase = "ok";
    else if (remaining <= 0) phase = "over";
    else if (remaining <= th.red * 1000) phase = "red";
    else if (remaining <= th.yellow * 1000) phase = "warn";
    else phase = "ok";
    return {
      kind: item.kind, started: started, paused: paused,
      elapsed: elapsed, remaining: remaining, total: total, shown: shown,
      phase: phase,
      progress: total > 0 ? Math.max(0, Math.min(1, elapsed / total)) : 0
    };
  }

  // "MM:SS" / "H:MM:SS"; negative values get a minus sign (overtime).
  // Count-downs round up (10.2 s left shows 00:11, as on every stage
  // timer), overtime rounds down (0.5 s over still shows 00:00).
  function fmt(ms, up) {
    var s;
    if (up) s = Math.floor(Math.max(0, ms) / 1000);
    else s = ms > 0 ? Math.ceil(ms / 1000) : -Math.floor(-ms / 1000);
    var neg = s < 0;
    if (neg) s = -s;
    var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    var out = h > 0 ? h + ":" + p(m) + ":" + p(x) : p(m) + ":" + p(x);
    return (neg ? "−" : "") + out;
  }
  function hm(ms) {
    var d = new Date(ms);
    return (d.getHours() < 10 ? "0" : "") + d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
  }

  // ---------- The day's schedule ----------
  // schedule(ev, items, run, now) -> {
  //   rows: [{ id, state: done|live|skipped|todo, planStart, planEnd,
  //            expStart, expEnd, actual: {s, e}|null }],
  //   planEnd, expEnd, delta (ms, > 0 = behind), hasPlan }
  // Planned times exist when the event has a start time; expected
  // times always (from what really happened and the live timer).
  function schedule(ev, items, run, now) {
    var hasPlan = !!(ev && ev.start);
    var day = dayStart(ev && ev.date, now);
    var t = hasPlan ? hmToMs(day, ev.start) : null;
    var log = (run && run.log && typeof run.log === "object") ? run.log : {};
    var curIdx = -1;
    for (var i = 0; i < items.length; i++) if (run && items[i].id === run.cur) curIdx = i;
    var rows = [];
    // planned
    items.forEach(function (it) {
      var r = { id: it.id, state: "todo", planStart: null, planEnd: null, expStart: null, expEnd: null, actual: null };
      if (hasPlan) {
        r.planStart = t;
        r.planEnd = it.kind === "until" && it.until ? Math.max(t, untilAt(it, t)) : t + it.dur * 1000;
        t = r.planEnd;
      }
      var a = log[it.id];
      if (a && typeof a.s === "number") r.actual = { s: a.s, e: typeof a.e === "number" ? a.e : null };
      rows.push(r);
    });
    // expected
    var cursor = null, open = false;
    rows.forEach(function (r, i) {
      var it = items[i];
      var ended = !!(r.actual && r.actual.e !== null);
      if (curIdx >= 0 && i < curIdx) {
        r.state = ended ? "done" : "skipped";
      } else if (curIdx < 0 && ended && !open) {
        r.state = "done";             // nothing live: the finished run so far
      } else if (i === curIdx) {
        r.state = "live";
      } else {
        r.state = "todo";
        open = true;
      }
      if (r.state === "done") {
        r.expStart = r.actual.s; r.expEnd = r.actual.e;
        cursor = r.expEnd;
        return;
      }
      if (r.state === "skipped") return;
      if (r.state === "live") {
        var tv = timer(it, ev, run, now);
        r.expStart = tv.started ? run.startedAt : now;
        r.expEnd = now + Math.max(0, tv.remaining);
        if (it.kind === "up" && tv.total === 0) r.expEnd = now;
        cursor = r.expEnd;
        return;
      }
      var s = cursor === null ? Math.max(now, r.planStart === null ? now : r.planStart) : cursor;
      r.expStart = s;
      r.expEnd = it.kind === "until" && it.until ? Math.max(s, untilAt(it, s)) : s + it.dur * 1000;
      cursor = r.expEnd;
    });
    var last = rows.length ? rows[rows.length - 1] : null;
    var planEnd = last ? last.planEnd : null;
    var expEnd = cursor;
    var delta = (hasPlan && planEnd !== null && expEnd !== null) ? expEnd - planEnd : 0;
    return { rows: rows, planEnd: planEnd, expEnd: expEnd, delta: delta, hasPlan: hasPlan };
  }

  // The item the big clock is about: the live one, else the next one
  // to run (the first "todo" row of the schedule), else null.
  function focus(items, sch, run) {
    var i;
    if (run && run.cur) for (i = 0; i < items.length; i++) if (items[i].id === run.cur) return items[i];
    for (i = 0; i < sch.rows.length; i++) if (sch.rows[i].state === "todo") return items[i];
    return null;
  }

  // ---------- Stage output (device-local, wave 2) ----------
  var LAYOUTS = ["full", "timer", "agenda"];
  var COLORS = ["white", "yellow", "red", "green"];
  function normShow(x) {
    x = (x && typeof x === "object") ? x : {};
    var m = (x.msg && typeof x.msg === "object") ? x.msg : {};
    return {
      black: x.black === true,
      layout: LAYOUTS.indexOf(x.layout) >= 0 ? x.layout : "full",
      mirror: x.mirror === true,
      logoAt: num(x.logoAt, 0),
      msg: {
        text: line(m.text, 200),
        on: m.on === true && !!line(m.text, 200),
        flash: m.flash === true,
        color: COLORS.indexOf(m.color) >= 0 ? m.color : "white",
        at: num(m.at, 0)
      }
    };
  }

  // ---------- Run state (device-local) ----------
  function normRun(r) {
    r = (r && typeof r === "object") ? r : {};
    var log = {};
    if (r.log && typeof r.log === "object") {
      Object.keys(r.log).slice(0, 500).forEach(function (k) {
        var a = r.log[k];
        if (ID_RE.test(k) && a && typeof a.s === "number" && isFinite(a.s)) {
          log[k] = { s: a.s, e: (typeof a.e === "number" && isFinite(a.e)) ? a.e : null };
        }
      });
    }
    return {
      ev: (typeof r.ev === "string" && ID_RE.test(r.ev)) ? r.ev : "",
      cur: (typeof r.cur === "string" && ID_RE.test(r.cur)) ? r.cur : "",
      startedAt: num(r.startedAt, 0),
      pausedAt: num(r.pausedAt, 0),
      adj: Math.max(-MAX_DUR, Math.min(MAX_DUR, Math.round(num(r.adj, 0)))),
      log: log
    };
  }
  // Transitions. Each returns a NEW run object; `now` is passed in so
  // the tests drive the clock.
  function closeCur(run, now) {
    var log = Object.assign({}, run.log);
    if (run.cur && run.startedAt && log[run.cur]) {
      log[run.cur] = { s: log[run.cur].s, e: run.pausedAt || now };
    }
    return log;
  }
  function start(run, now) {
    run = normRun(run);
    if (!run.cur) return run;
    if (!run.startedAt) {
      var log = Object.assign({}, run.log);
      log[run.cur] = { s: now, e: null };
      return Object.assign({}, run, { startedAt: now, pausedAt: 0, log: log });
    }
    if (run.pausedAt) {
      // shift the start by the paused time: the clock resumes where it stopped
      return Object.assign({}, run, { startedAt: run.startedAt + (now - run.pausedAt), pausedAt: 0 });
    }
    return run;
  }
  function pause(run, now) {
    run = normRun(run);
    if (!run.startedAt || run.pausedAt) return run;
    return Object.assign({}, run, { pausedAt: now });
  }
  // Make `id` the live item. `go` starts it at once.
  function select(run, id, now, go) {
    run = normRun(run);
    var log = closeCur(run, now);
    if (id && log[id] && log[id].e !== null) delete log[id];   // run it again
    var r = Object.assign({}, run, { cur: id || "", startedAt: 0, pausedAt: 0, adj: 0, log: log });
    return go ? start(r, now) : r;
  }
  function finish(run, now) {
    run = normRun(run);
    return Object.assign({}, run, { cur: "", startedAt: 0, pausedAt: 0, adj: 0, log: closeCur(run, now) });
  }
  function reset(run) {
    run = normRun(run);
    var log = Object.assign({}, run.log);
    if (run.cur) delete log[run.cur];
    return Object.assign({}, run, { startedAt: 0, pausedAt: 0, adj: 0, log: log });
  }
  function addTime(run, sec) {
    run = normRun(run);
    return Object.assign({}, run, { adj: Math.max(-MAX_DUR, Math.min(MAX_DUR, run.adj + sec)) });
  }
  function neighbour(items, id, step) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) {
        var j = i + step;
        return (j >= 0 && j < items.length) ? items[j].id : null;
      }
    }
    return items.length ? items[step > 0 ? 0 : items.length - 1].id : null;
  }

  var API = {
    KINDS: KINDS, DEF_YELLOW: DEF_YELLOW, DEF_RED: DEF_RED, ID_RE: ID_RE, HM_RE: HM_RE, YMD_RE: YMD_RE,
    LAYOUTS: LAYOUTS, COLORS: COLORS, normShow: normShow, focus: focus, normMsg: normMsg,
    normEvent: normEvent, normItem: normItem, merge: merge, canon: canon, empty: empty,
    rundown: rundown, posBetween: posBetween, thresholds: thresholds,
    timer: timer, fmt: fmt, hm: hm, schedule: schedule,
    normRun: normRun, start: start, pause: pause, select: select, finish: finish,
    reset: reset, addTime: addTime, neighbour: neighbour
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosStageCore = API;
})(typeof window !== "undefined" ? window : null);
