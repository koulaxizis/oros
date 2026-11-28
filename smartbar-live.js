// ============================================================
// orOS — smartbar-live.js (smart top bar live pills, SB-LIVE v1.0.0)
// ------------------------------------------------------------
// Loaded by smartbar.js the first time something runs (start-up stays
// as it was). The pills need no ticking; they show only while:
//   • tmr   a Time timer runs (the one ending first, "+N" for the
//           others), time left; device-local oros-time-timers.
//   • sw    the Time stopwatch runs, time so far; oros-time-sw.
//   • rec   Screen Capture records: the Capture window registers the
//           recording in memory (orosSmartBar.live), nothing stored, so
//           a closed window never leaves a pill behind.
// Each pill has its own stop button beside it (two buttons, never
// nested). A timer and the stopwatch pause through Time's own rules
// (time/clock-core.js, loaded once from the precache; the timer's
// shell alarm is taken off; an open Time window redraws from its
// storage listener). A recording stops as with Capture's own button
// and Capture comes to the front to save it. This is the one place the
// bar writes another app's data, and only on that button.
// Pure part unit-tested in node (tests/smartbar.test.js).
// ============================================================
(function (root) {
  "use strict";

  // ---------- Model (pure) ----------
  // The running timers (already normalised by Time's timerNorm)
  // → { tm, left: ms, more: how many others run } | null.
  function liveTimer(list, now) {
    var run = (Array.isArray(list) ? list : []).filter(function (x) {
      return x && x.st === "run" && typeof x.end === "number" && x.end > now;
    }).sort(function (a, b) { return a.end - b.end; });
    return run.length ? { tm: run[0], left: run[0].end - now, more: run.length - 1 } : null;
  }
  // The stopwatch (Time's swNorm) → { ms } while it runs, else null.
  function liveSw(sw, now) {
    if (!sw || sw.run !== true || typeof sw.start !== "number") return null;
    return { ms: Math.max(0, (+sw.base || 0) + Math.max(0, now - sw.start)) };
  }
  // A recording's numbers, as Capture reports them → { ms, paused } | null.
  function liveRec(r) {
    if (!r || typeof r.ms !== "number" || !isFinite(r.ms) || r.ms < 0) return null;
    return { ms: r.ms, paused: !!r.paused };
  }

  // Icons: fixed markup, never data. Hourglass, stopwatch, the recording dot.
  var IC = {
    tmr: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12M6 21h12M7 3c0 5 10 6 10 9s-10 4-10 9M17 3c0 5-10 6-10 9s10 4 10 9"/></svg>',
    sw: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="14" r="7.5"/><path d="M12 14V10M10 2.5h4M12 2.5v4M18.5 6.5l1.5-1.5"/></svg>',
    rec: '<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>'
  };
  var PAUSE = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
  var STOP = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  function stopIcon(kind) { return kind === "rec" ? STOP : PAUSE; }

  var CSS = [
    // The pill's colour is a 32 px band; its buttons keep their 44 px touch height.
    ".sb-live { position: relative; isolation: isolate; display: inline-flex; align-items: center; }",
    ".sb-live::before { content: \"\"; position: absolute; z-index: -1; left: 0; right: 0; top: 6px; bottom: 6px; border-radius: 999px;",
    "  background: var(--accent-soft); pointer-events: none; }",
    ".sb-live .sb-chip { border-radius: 999px; }",
    ".sb-live[hidden] { display: none !important; }",
    ".sb-live .sb-chip:focus-visible { background: color-mix(in srgb, var(--accent) 22%, transparent); }",
    "@media (hover: hover) { .sb-live .sb-chip:hover { background: color-mix(in srgb, var(--accent) 22%, transparent); } }",
    ".sb-stop { display: inline-flex; align-items: center; justify-content: center; min-width: 32px; min-height: 44px; padding: 0;",
    "  border: none; border-radius: 8px; background: transparent; color: var(--text); cursor: pointer; }",
    ".sb-stop:hover, .sb-stop:focus-visible { background: color-mix(in srgb, var(--accent) 22%, transparent); outline: none; }",
    ".sb-stop svg { pointer-events: none; }",
    ".sb-chip.sb-rec svg, .sb-card.sb-rec svg { color: #e5484d; }",
    ".sb-chip.sb-rec.sb-paused svg, .sb-card.sb-rec.sb-paused svg { color: var(--text-dim); }",
    "@media (prefers-reduced-motion: no-preference) { .sb-chip.sb-rec:not(.sb-paused) svg { animation: sb-blink 1.6s ease-in-out infinite; } }",
    "@keyframes sb-blink { 50% { opacity: .35; } }",
    "html[data-oros-motion=\"reduce\"] .sb-chip.sb-rec svg { animation: none !important; }",
    "#oros-bar.bar-tight .sb-stop { min-width: 26px; }",
    "#oros-bar.bar-tight .sb-live .sb-chip { padding: 0 3px 0 7px; gap: 4px; }",
    ".sb-cardrow { display: flex; align-items: center; gap: 4px; }",
    ".sb-cardrow + .sb-cardrow, .sb-cardrow + .sb-card, .sb-card + .sb-cardrow { margin-top: 2px; }",
    ".sb-cardrow .sb-card { flex: 1; min-width: 0; }",
    ".sb-cardrow .sb-stop { min-width: 48px; min-height: 48px; border-radius: 12px; }"
  ].join("\n");

  //   ctx: { t, call, appName, clock, readJSON, host(), rec(v?), repaint(kinds) }
  function make(ctx) {
    var t = ctx.t, call = ctx.call, appName = ctx.appName, clock = ctx.clock, readJSON = ctx.readJSON;
    var doc = root.document, clockLoad = 0;
    function host() { return ctx.host(); }

    if (doc && !doc.getElementById("sb-live-css")) {
      var st = doc.createElement("style");
      st.id = "sb-live-css";
      st.textContent = CSS;
      doc.head.appendChild(st);
    }

    function stopBtn(kind, halt) {
      var sb = doc.createElement("button");
      sb.type = "button";
      sb.className = "sb-stop";
      sb.innerHTML = stopIcon(kind);                // fixed markup, never data
      sb.addEventListener("click", function (e) { e.stopPropagation(); halt(kind); });
      return sb;
    }
    // A chip of smartbar.js becomes a group: its button + a stop button.
    function wrap(c, kind, halt) {
      var g = doc.createElement("span");
      g.className = "sb-live";
      g.setAttribute("role", "group");
      g.setAttribute("data-sb", kind);
      c.btn.removeAttribute("data-sb");
      g.appendChild(c.btn);
      c.sb = stopBtn(kind, halt);
      g.appendChild(c.sb);
      c.el = g;
    }
    // A card of the fold panel with its stop button beside it.
    function row(card, kind, c, halt) {
      var tip = c.stopTip;
      if (/\bsb-rec\b/.test(c.btn.className)) card.className += " sb-rec" + (/\bsb-paused\b/.test(c.btn.className) ? " sb-paused" : "");
      var rw = doc.createElement("div");
      rw.className = "sb-cardrow";
      var sb = stopBtn(kind, halt);
      sb.setAttribute("data-sb", kind);
      sb.title = tip; sb.setAttribute("aria-label", tip);
      rw.appendChild(card); rw.appendChild(sb);
      return rw;
    }

    // Time's clock rules (normalise, pause), loaded once from the precache.
    function clockCore() {
      if (root.OrosClockCore) return root.OrosClockCore;
      if (clockLoad) return null;
      clockLoad = 1;
      var s = doc.createElement("script");
      s.src = "time/clock-core.js?v=" + (call(function () { return host().version(); }) || "");
      s.onload = function () { ctx.repaint(["tmr", "sw"]); };
      s.onerror = function () { clockLoad = 0; };
      doc.head.appendChild(s);
      return null;
    }
    function openTime(pane) {
      if (call(function () { return host().barwin(); })) { host().open("time"); return; }
      if (typeof root.__orosOpenTime === "function") call(function () { root.__orosOpenTime(pane); });
      else call(function () { host().open("time"); });
    }
    function writeKey(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); }
      catch (e) { call(function () { host().toast(t("sb.savefail")); }); }
    }
    // Pause the way Time's own Pause does, the timer's alarm taken off.
    function pauseTimer(id) {
      var CC = root.OrosClockCore;
      if (!CC) return;
      var now = Date.now(), list = CC.timerNorm(readJSON("oros-time-timers")), hit = false;
      list = list.map(function (tm) {
        if (tm.id !== id || tm.st !== "run") return tm;
        hit = true;
        if (tm.aid) { var aid = tm.aid; call(function () { root.orosAlarms.remove(aid); }); }
        var nx = CC.timerPause(tm, now);
        nx.aid = "";
        return nx;
      });
      if (hit) writeKey("oros-time-timers", list);
    }
    function pauseSw() {
      var CC = root.OrosClockCore;
      if (!CC) return;
      var sw = CC.swNorm(readJSON("oros-time-sw"));
      if (sw.run) writeKey("oros-time-sw", CC.swToggle(sw, Date.now()));
    }

    // One pill: { v, l, cls, tip, stop (its button's label), halt, go } | null.
    var STATE = {
      tmr: function (now) {
        var CC = clockCore();
        if (!CC) return null;
        var lt = liveTimer(call(function () { return CC.timerNorm(readJSON("oros-time-timers")); }), now);
        if (!lt) return null;
        var name = lt.tm.name || t("sb.tmr.name"), left = clock(lt.left), id = lt.tm.id;
        return { v: left + (lt.more ? " +" + lt.more : ""), l: name, cls: "sb-soon",
                 tip: t("sb.tmr.tip").replace("{n}", name).replace("{r}", left).replace("{app}", appName("time")),
                 stop: t("sb.tmr.stop").replace("{n}", name),
                 halt: function () { pauseTimer(id); }, go: function () { openTime("timer"); } };
      },
      sw: function (now) {
        var CC = clockCore();
        if (!CC) return null;
        var ls = liveSw(call(function () { return CC.swNorm(readJSON("oros-time-sw")); }), now);
        if (!ls) return null;
        var r = clock(ls.ms);
        return { v: r, l: t("sb.sw.label"), tip: t("sb.sw.tip").replace("{r}", r).replace("{app}", appName("time")),
                 stop: t("sb.sw.stop"), halt: pauseSw, go: function () { openTime("stopwatch"); } };
      },
      rec: function () {
        var h = ctx.rec();
        if (!h) return null;
        var lr = liveRec(call(function () { return h.state(); }));
        if (!lr) { ctx.rec(null); return null; }               // the Capture window is gone
        var r = clock(lr.ms), app = appName("capture");
        return { v: lr.paused ? t("sb.rec.paused") + " " + r : r, l: "", cls: "sb-rec" + (lr.paused ? " sb-paused" : ""),
                 tip: t(lr.paused ? "sb.rec.tip.p" : "sb.rec.tip").replace("{r}", r).replace("{app}", app),
                 stop: t("sb.rec.stop"),
                 // QS-REC-1: a recording of the shell's own (screenrec.js) brings its go()
                 halt: function () { call(function () { h.stop(); }); ctx.rec(null); if (typeof h.go !== "function") call(function () { host().open("capture"); }); },
                 go: function () { if (typeof h.go === "function") call(function () { h.go(); }); else host().open("capture"); } };
      }
    };
    // smartbar.js paint(): the stop button of a pill (none in the desktop bar window).
    function paintStop(c, s) {
      c.halt = s ? s.halt : null;
      c.stop = s && s.halt && !call(function () { return host().barwin(); }) ? 1 : 0;
      c.stopTip = s && s.stop || "";
      if (c.sb.hidden !== !c.stop) c.sb.hidden = !c.stop;
      if (c.sb.title !== c.stopTip) { c.sb.title = c.stopTip; c.sb.setAttribute("aria-label", c.stopTip); }
    }
    return {
      paintStop: paintStop,
      state: function (kind, now) { return STATE[kind] ? STATE[kind](now) : null; },
      icon: function (kind) { return IC[kind] || ""; },
      stopIcon: stopIcon, wrap: wrap, row: row
    };
  }

  var EXP = { VER: "1.0.0", liveTimer: liveTimer, liveSw: liveSw, liveRec: liveRec, make: make };
  if (typeof module !== "undefined" && module.exports) module.exports = EXP;
  root.orosSmartBarLive = EXP;
})(typeof window !== "undefined" ? window : globalThis);
