// ============================================================
// orOS Micro-Zen — App logic (v1.0.0)
// A breathing circle and a minute of quiet.
//   - three patterns: Box 4-4-4-4, Relax 4-7-8, Coherent 5.5
//   - sessions of 1, 3, 5 or 10 minutes, always ending on a whole
//     breath; a 3-2-1 countdown; paused when the app is hidden
//   - the circle grows on the in-breath, rests on a hold and shrinks
//     on the out-breath (reduced motion: light and text only)
//   - optional soft tones and phone vibration on each phase change
//   - minutes today / this week, sessions, streak, last 7 days
// Data:
//   - synced slice "zen" (oros-zen-data): per-device rows of
//     per-day [sessions, seconds, breaths], join + reset stamp br,
//     canonical (R5, R26)
//   - device-local (R10): oros-zen-prefs (pattern, minutes, sound,
//     vibration), oros-zen-device
// Sections:
//   1. Constants, i18n, helpers
//   2. Patterns + timing
//   3. Days + stats
//   4. Synced data: rows, join, merge
//   5. Storage + prefs
//   6. Session engine
//   7. Cues: tones, vibration, wake lock
//   8. UI
//   9. Dialogs + toasts
//  10. Keyboard (Contract Β)
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-zen-data";
  var PREFS_KEY   = "oros-zen-prefs";
  var DEVICE_KEY  = "oros-zen-device";
  var DATA_VER    = 1;
  var MAX_DAYS    = 400;            // per device row
  var MINUTES     = [1, 3, 5, 10];
  var COUNTDOWN   = 3000;
  var SMALL       = 0.5;            // circle scale at the bottom of a breath

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();

  var STRINGS = {
    en: {
      "pat.box": "Box", "pat.relax": "Relax", "pat.coherent": "Coherent",
      "pat.box.sub": "4-4-4-4 · balance", "pat.relax.sub": "4-7-8 · for sleep", "pat.coherent.sub": "5.5-5.5 · steady",
      "ph.in": "Breathe in", "ph.hold": "Hold", "ph.out": "Breathe out",
      "ready": "Tap to begin", "paused": "Paused", "getReady": "Get ready",
      "btn.start": "Start (Space)", "btn.pause": "Pause (Space)", "btn.resume": "Resume (Space)", "btn.stop": "End (Esc)",
      "btn.sound": "Soft tones", "btn.vibe": "Vibration",
      "sec.session": "Session", "sec.pattern": "Pattern", "sec.length": "Length", "sec.stats": "Your quiet",
      "min": "{n} min", "breaths": "{n} breaths", "breath1": "1 breath",
      "st.today": "Today", "st.week": "This week", "st.sessions": "Sessions", "st.streak": "Streak",
      "st.min": "{n} min", "st.days": "{n} days", "st.day1": "1 day", "st.reset": "Reset stats",
      "chart": "Minutes on each of the last 7 days",
      "done.title": "Well done", "done.body": "{b} · {t}", "done.ok": "Close", "done.again": "Again",
      "confirm.title": "Reset stats?", "confirm.body": "Minutes, sessions and the streak go back to zero on all your devices.",
      "confirm.yes": "Reset", "confirm.no": "Cancel",
      "toast.reset": "Stats reset", "toast.short": "Too short to count: finish one whole breath",
      "toast.save": "Could not save: storage is full", "toast.locked": "Pause first",
      "toast.ended": "Session ended"
    },
    el: {
      "pat.box": "Κουτί", "pat.relax": "Χαλάρωση", "pat.coherent": "Σταθερή",
      "pat.box.sub": "4-4-4-4 · ισορροπία", "pat.relax.sub": "4-7-8 · για ύπνο", "pat.coherent.sub": "5.5-5.5 · σταθερός ρυθμός",
      "ph.in": "Εισπνοή", "ph.hold": "Κράτα", "ph.out": "Εκπνοή",
      "ready": "Πάτα για να ξεκινήσεις", "paused": "Σε παύση", "getReady": "Ετοιμάσου",
      "btn.start": "Έναρξη (Space)", "btn.pause": "Παύση (Space)", "btn.resume": "Συνέχεια (Space)", "btn.stop": "Τέλος (Esc)",
      "btn.sound": "Απαλοί τόνοι", "btn.vibe": "Δόνηση",
      "sec.session": "Συνεδρία", "sec.pattern": "Μοτίβο", "sec.length": "Διάρκεια", "sec.stats": "Η ησυχία σου",
      "min": "{n} λεπτ.", "breaths": "{n} ανάσες", "breath1": "1 ανάσα",
      "st.today": "Σήμερα", "st.week": "Αυτή την εβδομάδα", "st.sessions": "Συνεδρίες", "st.streak": "Σερί",
      "st.min": "{n} λεπτ.", "st.days": "{n} μέρες", "st.day1": "1 μέρα", "st.reset": "Επαναφορά στατιστικών",
      "chart": "Λεπτά σε καθεμία από τις τελευταίες 7 μέρες",
      "done.title": "Μπράβο", "done.body": "{b} · {t}", "done.ok": "Κλείσιμο", "done.again": "Ξανά",
      "confirm.title": "Επαναφορά στατιστικών;", "confirm.body": "Τα λεπτά, οι συνεδρίες και το σερί μηδενίζονται σε όλες τις συσκευές σου.",
      "confirm.yes": "Επαναφορά", "confirm.no": "Άκυρο",
      "toast.reset": "Τα στατιστικά μηδενίστηκαν", "toast.short": "Πολύ σύντομη για να μετρήσει: ολοκλήρωσε μία ανάσα",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος", "toast.locked": "Κάνε πρώτα παύση",
      "toast.ended": "Η συνεδρία τελείωσε"
    }
  };

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) {
      Object.keys(params).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(params[k]));
      });
    }
    return s;
  }

  function $(id) { return document.getElementById(id); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("zen.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Patterns + timing ----------
  // A pattern is a list of phases { k: in|hold|out, ms }. A hold takes
  // the size of the phase before it (full after in, small after out).
  var PATTERN_IDS = ["box", "relax", "coherent"];
  var PATTERNS = {
    box:      [{ k: "in", ms: 4000 }, { k: "hold", ms: 4000 }, { k: "out", ms: 4000 }, { k: "hold", ms: 4000 }],
    relax:    [{ k: "in", ms: 4000 }, { k: "hold", ms: 7000 }, { k: "out", ms: 8000 }],
    coherent: [{ k: "in", ms: 5500 }, { k: "out", ms: 5500 }]
  };

  function cycleMs(id) {
    return PATTERNS[id].reduce(function (s, p) { return s + p.ms; }, 0);
  }

  // Whole breaths in a session of `minutes` (at least one).
  function sessionBreaths(id, minutes) {
    return Math.max(1, Math.round(minutes * 60000 / cycleMs(id)));
  }

  // Smooth in and out (sine), so the circle never jerks.
  function ease(x) { x = x < 0 ? 0 : (x > 1 ? 1 : x); return 0.5 - 0.5 * Math.cos(Math.PI * x); }

  // Where a session is `ms` after its start: breath number, phase,
  // time left in the phase, circle scale (SMALL–1).
  function phaseAt(id, ms) {
    var ph = PATTERNS[id], cyc = cycleMs(id);
    ms = Math.max(0, ms);
    var breath = Math.floor(ms / cyc), r = ms - breath * cyc, i = 0;
    while (i < ph.length - 1 && r >= ph[i].ms) { r -= ph[i].ms; i++; }
    var p = ph[i], x = p.ms ? r / p.ms : 1;
    var full = 1, small = SMALL, scale;
    if (p.k === "in") scale = small + (full - small) * ease(x);
    else if (p.k === "out") scale = full - (full - small) * ease(x);
    else scale = (i > 0 && ph[i - 1].k === "in") ? full : small;
    return { breath: breath, idx: i, k: p.k, left: p.ms - r, x: x, scale: scale };
  }

  // ---------- 3. Days + stats ----------
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dayKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

  // All devices summed per day: { day: [sessions, seconds, breaths] }.
  function dayTotals(dat) {
    var out = {};
    Object.keys(dat.rows || {}).forEach(function (id) {
      var d = dat.rows[id].d;
      Object.keys(d).forEach(function (k) {
        var c = out[k] || (out[k] = [0, 0, 0]);
        c[0] += d[k][0]; c[1] += d[k][1]; c[2] += d[k][2];
      });
    });
    return out;
  }

  // Days in a row with a session, ending today (or yesterday, when
  // today has none yet: the streak is still alive until midnight).
  function streak(totals, today) {
    var d = today, n = 0;
    if (!(totals[dayKey(d)] && totals[dayKey(d)][0] > 0)) d = addDays(d, -1);
    while (totals[dayKey(d)] && totals[dayKey(d)][0] > 0) { n++; d = addDays(d, -1); }
    return n;
  }

  function stats(dat, today) {
    var tot = dayTotals(dat), week = [], weekSec = 0, sessions = 0;
    for (var i = 6; i >= 0; i--) {
      var k = dayKey(addDays(today, -i)), sec = tot[k] ? tot[k][1] : 0;
      week.push({ day: k, sec: sec });
      weekSec += sec;
    }
    Object.keys(tot).forEach(function (k) { sessions += tot[k][0]; });
    var tk = dayKey(today);
    return { todaySec: tot[tk] ? tot[tk][1] : 0, weekSec: weekSec, sessions: sessions,
             streak: streak(tot, today), week: week };
  }

  // ---------- 4. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                     // max-merged
  //   rows: { <deviceId>: { b: <epoch>, d: { "YYYY-MM-DD": [sessions, seconds, breaths] } } }
  // }
  // Each device only ever writes ITS OWN row, and its counters only
  // grow. Merge per row: the newer epoch wins; equal epochs take, per
  // day, the larger of each counter. Rows older than br are dropped; a
  // row keeps its 400 newest days. A join (symmetric, associative,
  // idempotent): no session is lost or counted twice.
  var data = null, deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normCell(v) {
    if (!Array.isArray(v) || v.length !== 3) return null;
    for (var i = 0; i < 3; i++) if (!isInt(v[i]) || v[i] < 0) return null;
    return [v[0], v[1], v[2]];
  }
  function trimDays(d) {
    var keys = Object.keys(d).sort(cmpStr), out = {};
    keys.slice(Math.max(0, keys.length - MAX_DAYS)).forEach(function (k) { out[k] = d[k]; });
    return out;
  }
  function normRow(row) {
    if (!row || typeof row !== "object" || !isInt(row.b) || row.b < 0) return null;
    var d = {}, any = false, src = (row.d && typeof row.d === "object") ? row.d : {};
    Object.keys(src).forEach(function (k) {
      var c = DAY_RE.test(k) ? normCell(src[k]) : null;
      if (c) { d[k] = c; any = true; }
    });
    return any ? { b: row.b, d: trimDays(d) } : null;
  }
  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var d = {};
    [x.d, y.d].forEach(function (m) {
      Object.keys(m).forEach(function (k) {
        var c = m[k], cur = d[k];
        d[k] = cur ? [Math.max(cur[0], c[0]), Math.max(cur[1], c[1]), Math.max(cur[2], c[2])] : [c[0], c[1], c[2]];
      });
    });
    return { b: x.b, d: trimDays(d) };
  }
  function mergeZen(A, B) {
    var a = A || {}, b = B || {};
    var br = Math.max(isInt(a.br) && a.br > 0 ? a.br : 0, isInt(b.br) && b.br > 0 ? b.br : 0);
    var rows = {};
    [a.rows || {}, b.rows || {}].forEach(function (m) {
      if (!m || typeof m !== "object") return;
      Object.keys(m).forEach(function (id) {
        if (!/^[a-z0-9]{6,32}$/.test(id)) return;
        var r = normRow(m[id]);
        if (!r || r.b < br) return;
        rows[id] = rows[id] ? joinRows(rows[id], r) : r;
      });
    });
    var sorted = {};
    Object.keys(rows).sort(cmpStr).forEach(function (id) {
      var r = rows[id], d = {};
      Object.keys(r.d).sort(cmpStr).forEach(function (k) { d[k] = r.d[k]; });
      sorted[id] = { b: r.b, d: d };
    });
    return { ver: DATA_VER, br: br, rows: sorted };
  }

  // Adds one finished session to this device's row for `day`.
  function addSession(dat, dev, day, seconds, breaths) {
    var row = dat.rows[dev];
    if (!row || row.b < dat.br) row = { b: dat.br, d: {} };   // new epoch after a reset
    var d = JSON.parse(JSON.stringify(row.d));
    var c = d[day] || [0, 0, 0];
    d[day] = [c[0] + 1, c[1] + seconds, c[2] + breaths];
    var rows = JSON.parse(JSON.stringify(dat.rows));
    rows[dev] = { b: row.b, d: d };
    return mergeZen({ ver: DATA_VER, br: dat.br, rows: rows }, null);
  }

  // ---------- 5. Storage + prefs ----------
  var prefs = null;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.rows && typeof parsed.rows === "object") {
          data = mergeZen(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] zen: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = defaultData();
  }

  var saveFailShown = false;
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function ensureDeviceId() {
    try { deviceId = localStorage.getItem(DEVICE_KEY); } catch (e) {}
    if (!deviceId || !/^[a-z0-9]{6,32}$/.test(deviceId)) {
      var r = new Uint32Array(2);
      crypto.getRandomValues(r);
      deviceId = Date.now().toString(36) + r[0].toString(36) + r[1].toString(36).slice(0, 4);
      try { localStorage.setItem(DEVICE_KEY, deviceId); } catch (e) {}
    }
  }

  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    p = (p && typeof p === "object") ? p : {};
    prefs = {
      pat: PATTERN_IDS.indexOf(p.pat) >= 0 ? p.pat : "box",
      min: MINUTES.indexOf(p.min) >= 0 ? p.min : 3,
      sound: p.sound === 1 ? 1 : 0,
      vibe: p.vibe === 1 ? 1 : 0
    };
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ---------- 6. Session engine ----------
  // state: idle | countdown | run | paused
  var S = { state: "idle", pat: "box", breaths: 0, total: 0, acc: 0, since: 0, lastKey: "", raf: 0, cdEnd: 0 };

  function now() { return performance.now(); }
  function elapsed() { return S.acc + (S.state === "run" ? now() - S.since : 0); }

  function start() {
    if (S.state === "run" || S.state === "countdown") return;
    if (S.state === "paused") { resume(); return; }
    S.pat = prefs.pat;
    S.breaths = sessionBreaths(S.pat, prefs.min);
    S.total = S.breaths * cycleMs(S.pat);
    S.acc = 0;
    S.lastKey = "";
    S.state = "countdown";
    S.cdEnd = now() + COUNTDOWN;
    ensureAudio();
    wakeLock(true);
    loop();
    render();
  }

  function resume() {
    ensureAudio();
    wakeLock(true);
    S.state = "countdown";
    S.cdEnd = now() + COUNTDOWN;
    loop();
    render();
  }

  function pause() {
    if (S.state === "run") { S.acc += now() - S.since; }
    if (S.state !== "run" && S.state !== "countdown") return;
    S.state = "paused";
    S.lastKey = "";
    wakeLock(false);
    cancelAnimationFrame(S.raf);
    render();
    paint();
  }

  function togglePlay() {
    if (S.state === "run" || S.state === "countdown") pause(); else start();
  }

  // End early (Esc / End): a session counts when one whole breath is done.
  function stop() {
    if (S.state === "idle") return;
    if (S.state === "run") S.acc += now() - S.since;
    var cyc = cycleMs(S.pat), done = Math.floor(S.acc / cyc);
    cancelAnimationFrame(S.raf);
    wakeLock(false);
    if (done >= 1) finish(done, done * cyc);
    else {
      var tried = S.acc > 0;
      reset();
      if (tried) showToast(t("toast.short"));
    }
  }

  function reset() {
    S.state = "idle";
    S.acc = 0;
    S.lastKey = "";
    render();
    paint();
  }

  function finish(breaths, ms) {
    var sec = Math.round(ms / 1000);
    data = addSession(data, deviceId, dayKey(new Date()), sec, breaths);
    save();
    reset();
    renderStats();
    chime();
    doneDialog(breaths, ms);
  }

  function loop() {
    cancelAnimationFrame(S.raf);
    S.raf = requestAnimationFrame(frame);
  }

  function frame() {
    if (S.state === "countdown") {
      var left = S.cdEnd - now();
      if (left <= 0) {
        S.state = "run";
        S.since = now();
        render();
      } else {
        $("phase").textContent = t("getReady");
        $("count").textContent = String(Math.ceil(left / 1000));
        S.raf = requestAnimationFrame(frame);
        return;
      }
    }
    if (S.state !== "run") return;
    var ms = elapsed();
    if (ms >= S.total) {
      S.acc = S.total;
      cancelAnimationFrame(S.raf);
      wakeLock(false);
      finish(S.breaths, S.total);
      return;
    }
    paint();
    S.raf = requestAnimationFrame(frame);
  }

  // Draws the circle, phase and progress for the current moment.
  function paint() {
    var orb = $("orb");
    if (S.state === "idle") {
      orb.style.setProperty("--s", String(SMALL + (1 - SMALL) * 0.35));
      orb.style.setProperty("--glow", "0.35");
      $("phase").textContent = t("ready");
      $("count").textContent = "";
      $("progress").style.width = "0%";
      $("meta").textContent = metaText(0, 0);
      return;
    }
    var ms = elapsed(), p = phaseAt(S.pat, ms);
    orb.style.setProperty("--s", String(p.scale));
    orb.style.setProperty("--glow", String(0.3 + 0.7 * (p.scale - SMALL) / (1 - SMALL)));
    orb.setAttribute("data-k", p.k);
    if (S.state === "paused") {
      $("phase").textContent = t("paused");
      $("count").textContent = "";
    } else {
      $("phase").textContent = t("ph." + p.k);
      $("count").textContent = String(Math.max(1, Math.ceil(p.left / 1000)));
      var key = p.breath + ":" + p.idx;
      if (key !== S.lastKey) {
        if (S.lastKey) cue(p.k);
        else cue(p.k, true);
        S.lastKey = key;
        live(t("ph." + p.k));
      }
    }
    $("progress").style.width = (100 * Math.min(1, ms / S.total)) + "%";
    $("meta").textContent = metaText(Math.min(S.breaths, p.breath), ms);
  }

  function fmtClock(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return pad(Math.floor(s / 60)) + ":" + pad(s % 60);
  }
  function breathsText(n) { return n === 1 ? t("breath1") : t("breaths", { n: n }); }
  function metaText(b, ms) {
    var total = S.state === "idle" ? sessionBreaths(prefs.pat, prefs.min) : S.breaths;
    var totalMs = S.state === "idle" ? total * cycleMs(prefs.pat) : S.total;
    return b + " / " + breathsText(total) + " · " + fmtClock(ms) + " / " + fmtClock(totalMs);
  }

  // ---------- 7. Cues ----------
  var actx = null, lock = null;

  function ensureAudio() {
    if (!prefs.sound) return;
    try {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!actx && C) actx = new C();
      if (actx && actx.state === "suspended" && actx.resume) actx.resume();
    } catch (e) { actx = null; }
  }
  function tone(f, at, d, peak) {
    var o = actx.createOscillator(), g = actx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(f, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, at + d);
    o.connect(g); g.connect(actx.destination);
    o.start(at); o.stop(at + d + 0.05);
  }
  var CUE_F = { "in": 528, hold: 440, out: 396 };
  var VIBE  = { "in": [40], hold: [15], out: [20, 80, 20] };
  function cue(k, first) {
    if (prefs.sound && actx) {
      try { tone(CUE_F[k], actx.currentTime + 0.01, first ? 1.2 : 0.9, k === "hold" ? 0.05 : 0.08); } catch (e) {}
    }
    if (prefs.vibe && navigator.vibrate) { try { navigator.vibrate(VIBE[k]); } catch (e) {} }
  }
  function chime() {
    if (prefs.sound && actx) {
      try {
        var at = actx.currentTime + 0.02;
        [396, 528, 660].forEach(function (f, i) { tone(f, at + i * 0.35, 1.6, 0.07); });
      } catch (e) {}
    }
    if (prefs.vibe && navigator.vibrate) { try { navigator.vibrate([60, 120, 60]); } catch (e) {} }
  }

  // Keep the screen on while a session runs (where supported).
  function wakeLock(on) {
    try {
      if (on && !lock && navigator.wakeLock && navigator.wakeLock.request) {
        navigator.wakeLock.request("screen").then(function (l) {
          if (S.state === "run" || S.state === "countdown") lock = l; else l.release();
        }).catch(function () {});
      } else if (!on && lock) {
        lock.release().catch(function () {});
        lock = null;
      }
    } catch (e) {}
  }

  // ---------- 8. UI ----------
  var UI = {
    play:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
    stop:  '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
    mute:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
    vibe:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="3" width="8" height="18" rx="2"/><path d="M4 8v8M20 8v8M1.5 10v4M22.5 10v4"/></svg>'
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function busy() { return S.state !== "idle"; }

  function buildPatterns() {
    var host = $("patterns");
    host.innerHTML = "";
    PATTERN_IDS.forEach(function (id) {
      var b = el("button", "pat");
      b.type = "button";
      b.setAttribute("data-p", id);
      b.setAttribute("role", "radio");
      b.appendChild(el("span", "pat-name", t("pat." + id)));
      b.appendChild(el("span", "pat-sub", t("pat." + id + ".sub")));
      b.addEventListener("click", function () {
        if (busy()) { showToast(t("toast.locked")); return; }
        prefs.pat = id; savePrefs(); render(); paint();
      });
      host.appendChild(b);
    });
  }
  function buildLengths() {
    var host = $("lengths");
    host.innerHTML = "";
    MINUTES.forEach(function (m) {
      var b = el("button", "chip", t("min", { n: m }));
      b.type = "button";
      b.setAttribute("data-m", m);
      b.setAttribute("role", "radio");
      b.addEventListener("click", function () {
        if (busy()) { showToast(t("toast.locked")); return; }
        prefs.min = m; savePrefs(); render(); paint();
      });
      host.appendChild(b);
    });
  }

  function render() {
    var running = S.state === "run" || S.state === "countdown";
    document.body.classList.toggle("running", running);
    document.body.classList.toggle("session", busy());
    [].forEach.call(document.querySelectorAll(".pat"), function (b) {
      var on = b.getAttribute("data-p") === prefs.pat;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.disabled = busy();
    });
    [].forEach.call(document.querySelectorAll("#lengths .chip"), function (b) {
      var on = parseInt(b.getAttribute("data-m"), 10) === prefs.min;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.disabled = busy();
    });
    var pb = $("play-btn");
    pb.innerHTML = running ? UI.pause : UI.play;
    var lbl = running ? t("btn.pause") : (S.state === "paused" ? t("btn.resume") : t("btn.start"));
    pb.setAttribute("aria-label", lbl);
    pb.title = lbl;
    $("stop-btn").hidden = !busy();
    $("orb-btn").setAttribute("aria-label", lbl);
    var sb = $("sound-btn");
    sb.innerHTML = prefs.sound ? UI.sound : UI.mute;
    sb.setAttribute("aria-pressed", prefs.sound ? "true" : "false");
    sb.classList.toggle("on", !!prefs.sound);
    var vb = $("vibe-btn");
    vb.hidden = !navigator.vibrate;
    vb.setAttribute("aria-pressed", prefs.vibe ? "true" : "false");
    vb.classList.toggle("on", !!prefs.vibe);
    $("title-sub").textContent = t("pat." + (busy() ? S.pat : prefs.pat)) + " · " + t("min", { n: prefs.min });
  }

  function minutesText(sec) {
    var m = Math.round(sec / 60);
    return t("st.min", { n: sec > 0 && m === 0 ? "<1" : m });
  }

  function renderStats() {
    var st = stats(data, new Date());
    $("st-today").textContent = minutesText(st.todaySec);
    $("st-week").textContent = minutesText(st.weekSec);
    $("st-sessions").textContent = String(st.sessions);
    $("st-streak").textContent = st.streak === 1 ? t("st.day1") : t("st.days", { n: st.streak });
    var host = $("chart"), max = 0;
    st.week.forEach(function (w) { if (w.sec > max) max = w.sec; });
    host.innerHTML = "";
    var loc = LANG === "el" ? "el-GR" : "en-GB";
    st.week.forEach(function (w, i) {
      var col = el("div", "bar");
      var fill = el("span", "fill");
      fill.style.height = (max ? Math.max(w.sec ? 6 : 0, Math.round(100 * w.sec / max)) : 0) + "%";
      col.appendChild(fill);
      var parts = w.day.split("-"), d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
      var lab = "";
      try { lab = d.toLocaleDateString(loc, { weekday: "narrow" }); } catch (e) {}
      col.appendChild(el("i", "", lab));
      col.title = w.day + ": " + minutesText(w.sec);
      if (i === 6) col.classList.add("today");
      host.appendChild(col);
    });
    host.setAttribute("aria-label", t("chart") + ": " + st.week.map(function (w) { return minutesText(w.sec); }).join(", "));
    $("reset-btn").hidden = st.sessions === 0;
  }

  // ---------- 9. Dialogs + toasts ----------
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function makeDialog(id) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "mm-dlg";
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () {
      parkToast();
      setTimeout(function () { dlg.remove(); }, 0);
    });
    return dlg;
  }

  function doneDialog(breaths, ms) {
    var dlg = makeDialog("zen-done");
    dlg.classList.add("done-dlg");
    dlg.appendChild(el("div", "done-orb"));
    dlg.appendChild(el("div", "dlg-title", t("done.title")));
    dlg.appendChild(el("p", "done-body", t("done.body", { b: breathsText(breaths), t: fmtClock(ms) })));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("done.ok"), "", function () { dlg.close(); }));
    var again = button(t("done.again"), "primary", function () { dlg.close(); setTimeout(start, 0); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    again.focus();
  }

  function confirmReset() {
    var dlg = makeDialog("zen-confirm");
    dlg.appendChild(el("div", "dlg-title", t("confirm.title")));
    dlg.appendChild(el("p", "done-body", t("confirm.body")));
    var acts = el("div", "dlg-actions");
    var no = button(t("confirm.no"), "", function () { dlg.close(); });
    acts.appendChild(no);
    acts.appendChild(button(t("confirm.yes"), "danger", function () { dlg.close(); resetStats(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    no.focus();
  }

  // Reset = a new epoch: every device drops rows older than br and
  // starts its own row again from zero.
  function resetStats() {
    data.br = Math.max(Date.now(), data.br + 1);
    data = mergeZen(data, data);
    save();
    renderStats();
    showToast(t("toast.reset"));
  }

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "zen", title: String(text) })) return;
    } catch (e) {}
    localToast(text);
  }
  var toastTimer = null;
  function localToast(text) {
    var box = $("toast");
    if (!box) return;
    hostToast();
    box.innerHTML = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, 4000);
  }
  function hostToast() {
    var box = $("toast"), d = document.querySelector("dialog[open]");
    if (box && d && box.parentNode !== d) d.appendChild(box);
  }
  function parkToast() {
    var box = $("toast");
    if (box && box.parentNode !== document.body) document.body.appendChild(box);
  }

  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 10. Keyboard ----------
  function wireKeyboard() {
    // Contract Β: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    // Space start / pause, Esc end (not on a button, not in a dialog)
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (document.querySelector("dialog[open]")) return;
      var tag = e.target && e.target.tagName;
      if (e.key === "Escape" && busy()) { e.preventDefault(); stop(); return; }
      if ((e.key === " " || e.code === "Space") && tag !== "BUTTON" && tag !== "INPUT") {
        e.preventDefault(); togglePlay();
      }
    });
  }

  // ---------- 11. Sync slice + palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow", "--danger"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }

  function registerSync() {
    // LOCAL FIRST: load() has already run (boot order).
    var api = syncApi();
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("zen", sliceGet, sliceSet, STORAGE_KEY, mergeZen);
  }

  function sliceGet() { return mergeZen(data, data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows || typeof incoming.rows !== "object") return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeZen(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) !== before) renderStats();   // no toast on merge
  }

  // ---------- 12. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    var st = $("stop-btn");
    st.innerHTML = UI.stop;
    st.setAttribute("aria-label", t("btn.stop"));
    st.title = t("btn.stop");
    $("sound-btn").setAttribute("aria-label", t("btn.sound"));
    $("sound-btn").title = t("btn.sound");
    var vb = $("vibe-btn");
    vb.innerHTML = UI.vibe;
    vb.setAttribute("aria-label", t("btn.vibe"));
    vb.title = t("btn.vibe");
    $("reset-btn").textContent = t("st.reset");
  }

  function wire() {
    $("play-btn").addEventListener("click", togglePlay);
    $("orb-btn").addEventListener("click", togglePlay);
    $("stop-btn").addEventListener("click", stop);
    $("sound-btn").addEventListener("click", function () {
      prefs.sound = prefs.sound ? 0 : 1;
      savePrefs();
      if (prefs.sound && busy()) ensureAudio();
      render();
    });
    $("vibe-btn").addEventListener("click", function () {
      prefs.vibe = prefs.vibe ? 0 : 1;
      savePrefs();
      if (prefs.vibe && navigator.vibrate) { try { navigator.vibrate(30); } catch (e) {} }
      render();
    });
    $("reset-btn").addEventListener("click", confirmReset);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") pause();
      else renderStats();                     // a new day may have started
    });
    window.addEventListener("pagehide", function () {
      try { if (actx) actx.close(); } catch (e) {}
      wakeLock(false);
    });
    wireKeyboard();
  }

  function boot() {
    load();
    ensureDeviceId();
    loadPrefs();
    applyI18n();
    buildPatterns();
    buildLengths();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    render();
    paint();
    renderStats();
  }

  boot();
})();
