// ============================================================
// orOS Assistant — routine host (AS-RT, wave 2; Chris 2026-11-28)
// Runs in the SHELL window. automations/host.js loads it (with
// assistant/routines.js) on its clock tick the first time the
// Assistant's synced data holds a routine, so a device without
// routines loads nothing.
//
//   - tick(): at most once a minute, finds the routines due on THIS
//     device (routines.due: schedule, device, catch-up, retry, Pause
//     all) and the file-landed ones (AH-PNJ-2: orosFS.ls of the
//     routine's folder, routines.filesDue) and queues them;
//   - runs ONE routine at a time in a hidden Assistant frame
//     (assistant/index.html?routine=1, window.__asRoutine.run), which
//     claims the occurrence, runs the turn read-only and writes the
//     result into the routine's own conversation;
//   - drops the frame RT_IDLE after the last run, so nothing heavy
//     stays loaded;
//   - window.orosRoutineHost { tick, runNow(id), running() } for the
//     Assistant's "Run now" and the dock.
// orOS closed = nothing runs (no server of ours); the installed
// desktop's GATE-HOST keeps a windowless orOS that runs them.
// ============================================================
(function (root) {
  "use strict";
  var R = root.OrosAssistRoutines;
  if (!R || root.orosRoutineHost) return;

  var KEY = "oros-assistant-data";
  var TICK_MS = 60000;
  var RT_IDLE = 3 * 60000;
  var FRAME_WAIT = 30000;
  var RUN_MAX = 30 * 60000;             // a run that never ends frees the queue
  var lastTick = 0, queue = [], cur = null, idleT = 0;
  var frame = null, frameP = null, frameReady = null;

  function read() {
    try { var d = JSON.parse(localStorage.getItem(KEY) || "null"); return d && typeof d === "object" ? d : {}; }
    catch (e) { return {}; }
  }
  function me() {
    try { var c = root.orosContinue; return c && typeof c.deviceId === "function" ? String(c.deviceId() || "") : ""; }
    catch (e) { return ""; }
  }
  function live(d) {
    var rt = d && d.rt && typeof d.rt === "object" ? d.rt : {};
    return Object.keys(rt).map(function (id) { return R.normRoutine(rt[id], id); })
      .filter(function (r) { return r && !r.del; });
  }
  function queued(id) {
    return (cur && cur.id === id) || queue.some(function (j) { return j.id === id; });
  }
  function ymd(t) { return R.ymdhm(t).slice(0, 8); }

  function tick(force) {
    var now = Date.now();
    if (!force && now - lastTick < TICK_MS) return;
    lastTick = now;
    var d = read(), dev = me(), rr = d.rr && typeof d.rr === "object" ? d.rr : {};
    var paused = !!(d.rp && d.rp.on);
    if (!dev) return;
    live(d).forEach(function (r) {
      if (queued(r.id)) return;
      if (r.sched.k === "file") { fileCheck(r, rr[r.id], dev, paused, now); return; }
      var due = R.due(r, rr[r.id], now, dev, paused);
      if (due) queue.push({ id: r.id, key: due.key, retry: due.retry });
    });
    pump();
  }
  // AH-PNJ-2: a file whose name fits landed (new or changed) in the
  // routine's folder → one run for that file version, 20 a day at most.
  function fileCheck(r, run, dev, paused, now) {
    if (paused || !r.on || (r.dev && r.dev !== dev)) return;
    var fs = root.orosFS;
    if (!fs || typeof fs.ls !== "function" || typeof fs.stat !== "function") return;
    run = R.normRun(run) || {};
    if (run.st === "run" && now - run.at < R.RUN_STALE) return;
    if (R.shouldStop(run)) return;
    if (run.st === "fail" && now - run.at < R.RETRY) return;
    var today = run.day === ymd(now) ? run.dn || 0 : 0;
    var dir = diskPath(r.sched.dir);
    listDir(fs, dir, r).then(function (files) {
      var due = R.filesDue(r, files, run.seen || {}, today);
      if (!due.length || queued(r.id)) return;
      queue.push({ id: r.id, key: r.id + "#" + due[0].key, file: { name: due[0].name, key: due[0].key, path: dir + "/" + due[0].name } });
      pump();
    }).catch(function () {});
  }
  // "/Claude/NULL JSFX" (as the person writes it) → "/internal/Claude/NULL JSFX"
  function diskPath(p) { return p.indexOf("/internal/") === 0 || p === "/internal" ? p : "/internal" + p; }
  // The folder's files: on this device (orosFS, with stat for the time
  // and size) and the ones only in the cloud (Vault Drive on demand,
  // with their hash). Only names that fit are stat'ed.
  function listDir(fs, dir, r) {
    var out = [], have = {};
    var V = root.orosVault;
    try {
      if (V && typeof V.remoteOnly === "function") (V.remoteOnly(dir) || []).forEach(function (e) {
        if (!e || typeof e.path !== "string" || e.path.indexOf(dir + "/") !== 0) return;
        var name = e.path.slice(dir.length + 1);
        if (name.indexOf("/") >= 0 || !R.fits(r.sched.pat, name)) return;
        have[name] = 1;
        out.push({ name: name, m: e.m || 0, size: e.s || 0, hash: typeof e.h === "string" ? e.h.slice(0, 16) : "" });
      });
    } catch (e) {}
    return Promise.resolve().then(function () { return fs.ls(dir); }).then(function (list) {
      var names = (Array.isArray(list) ? list : []).filter(function (f) { return f && !f.dir && typeof f.name === "string" && !have[f.name] && R.fits(r.sched.pat, f.name); })
        .map(function (f) { return f.name; }).slice(0, 200);
      return Promise.all(names.map(function (n) {
        return Promise.resolve().then(function () { return fs.stat(dir + "/" + n); }).then(function (st) {
          if (st && !st.dir) out.push({ name: n, m: typeof st.mtime === "number" ? st.mtime : 0, size: st.size || 0 });
        }, function () {});
      }));
    }, function () {}).then(function () { return out; });
  }

  function pump() {
    if (cur || !queue.length) return;
    clearTimeout(idleT);
    cur = queue.shift();
    var job = cur, ended = false;
    var guard = setTimeout(function () { end({ ok: false, why: "time" }); }, RUN_MAX);
    function end(res) {
      if (ended) return;
      ended = true;
      clearTimeout(guard);
      cur = null;
      changed(job, res);
      if (queue.length) pump();
      else idleT = setTimeout(dropFrame, RT_IDLE);
    }
    getFrame().then(function (F) {
      if (!F || typeof F.run !== "function") { end({ ok: false, why: "frame" }); return; }
      return Promise.resolve(F.run(job)).then(end, function () { end({ ok: false, why: "error" }); });
    }, function () { end({ ok: false, why: "frame" }); });
  }

  var listeners = [];
  function changed(job, res) {
    listeners.slice().forEach(function (fn) { try { fn(job, res); } catch (e) {} });
  }

  function getFrame() {
    if (frame && frame.contentWindow && frame.contentWindow.__asRoutine) return Promise.resolve(frame.contentWindow.__asRoutine);
    if (frameP) return frameP;
    frameP = new Promise(function (resolve) {
      var timer = setTimeout(function () { done(null); }, FRAME_WAIT);
      function done(v) {
        clearTimeout(timer);
        frameReady = null;
        if (!v) { frameP = null; dropFrame(); }
        resolve(v);
      }
      frameReady = function () { done(frame && frame.contentWindow ? frame.contentWindow.__asRoutine || null : null); };
      try {
        var v = root.orosTodayEnv && root.orosTodayEnv.version ? encodeURIComponent(root.orosTodayEnv.version) : "";
        frame = document.createElement("iframe");
        frame.setAttribute("aria-hidden", "true");
        frame.setAttribute("tabindex", "-1");
        frame.title = "orOS Assistant routines";
        frame.style.cssText = "position:fixed;width:1px;height:1px;left:-9999px;top:0;border:0;opacity:0;pointer-events:none";
        frame.src = "assistant/index.html?routine=1" + (v ? "&v=" + v : "");
        document.body.appendChild(frame);
      } catch (e) { done(null); }
    });
    return frameP;
  }
  function dropFrame() {
    if (cur) return;
    if (frame) { try { frame.remove(); } catch (e) {} }
    frame = null;
    frameP = null;
  }

  root.orosRoutineHost = {
    VERSION: "1.0.0",
    tick: function () { tick(false); },
    // "Run now" from the Assistant: the person's own tap, so it runs
    // even when the routine is off or paused (never twice at once).
    runNow: function (id) {
      id = String(id || "");
      var r = live(read()).filter(function (x) { return x.id === id; })[0];
      if (!r || queued(id)) return false;
      queue.push({ id: id, key: id + "@now" + R.ymdhm(Date.now()), manual: 1 });
      pump();
      return true;
    },
    // An Automations rule's "routine" step (wave 4): the person's own
    // rule, so it runs like Run now, but never while "Pause all" is on.
    runAuto: function (id, ruleKey) {
      id = String(id || "");
      var d = read(), r = live(d).filter(function (x) { return x.id === id; })[0];
      if (!r || (d.rp && d.rp.on) || queued(id)) return false;
      queue.push({ id: id, key: id + "@auto" + R.ymdhm(Date.now()), manual: 1, auto: String(ruleKey || "").slice(0, 120) });
      pump();
      return true;
    },
    running: function () { return cur ? cur.id : ""; },
    queued: function (id) { return queued(String(id || "")); },
    frameReady: function () { if (frameReady) frameReady(); },
    onChange: function (fn) { if (typeof fn === "function") listeners.push(fn); }
  };
})(window);
