// ============================================================
// orOS Whack-a-Mole — App logic (v1.0.0)
// Nine holes; moles pop up for a moment and you whack them before
// they hide. A round lasts 30 seconds; the score is the points won.
//   - 3 levels: how long a mole stays up, how many at once, and
//     (Medium, Hard) a hedgehog you must NOT hit (−2, never below 0)
//   - mole +1, golden mole +3 (rare, shorter); empty hole: nothing
//   - the last 10 seconds run a little faster
//   - the round pauses while the app is hidden and resumes after a
//     3-2-1 countdown; closing the app drops the round (not counted)
//   - tap / click (on press, not release) or keys 1–9 laid out like a
//     numeric keypad; Space starts, N stops or starts a round
// Data:
//   - synced slice "whack" (oros-whack-data): per level the best score
//     (and when) and the rounds played, as per-device rows (each device
//     only grows its own row; merge = per-row join) + a reset stamp br
//   - device-local (R10): oros-whack-prefs (level), oros-whack-device
//     (row id), oros-whack-sfx (sound on/off)
// Sections:
//   1. Constants, i18n, helpers
//   2. Round model (schedule, scoring, keys)
//   3. Synced data: load / save / normalize / merge (R5, R26)
//   4. Device-local prefs
//   5. Round flow (start, countdown, loop, whack, pause, finish)
//   6. Render (toolbar, status, board, holes)
//   7. Dialogs (result, records, confirm)
//   8. Toasts
//   9. Sound
//  10. Input (pointer, keyboard, Contract Β)
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-whack-data";
  var PREFS_KEY   = "oros-whack-prefs";
  var DEVICE_KEY  = "oros-whack-device";
  var SFX_KEY     = "oros-whack-sfx";
  var DATA_VER    = 1;

  var LEVELS = ["e", "m", "h"];
  var HOLES = 9;
  var ROUND_MS = 30000;
  var RUSH_MS = 10000;                       // the last 10 s run faster
  var RUSH = 0.85;
  var HOLE_REST = 150;                       // a hole stays empty this long after a mole
  var GOLD = 0.07;                           // chance of a golden mole
  var MAX_SCORE = 999;                       // anything above is junk
  // up: ms a mole stays up · max: moles up at once · gap: ms between
  // pop-ups · hog: chance of a hedgehog
  var PARAMS = {
    e: { up: 1100, max: 1, gap: [650, 1000], hog: 0 },
    m: { up: 800,  max: 2, gap: [450, 750],  hog: 0.12 },
    h: { up: 550,  max: 3, gap: [300, 550],  hog: 0.15 }
  };
  // keys 1–9 as on a numeric keypad: 7 8 9 is the top row
  var KEYPAD = "789456123";

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
      "level.e": "Easy", "level.m": "Medium", "level.h": "Hard",
      "btn.new": "New round (N)",
      "btn.stop": "Stop the round (N)",
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "btn.start": "Start",
      "btn.again": "Play again",
      "st.score": "Score", "st.time": "Time",
      "turn.idle": "Whack the moles!",
      "turn.idleHog": "Whack the moles, spare the hedgehog!",
      "turn.best": "Best: {n}",
      "turn.ready": "Get ready…",
      "turn.go": "Go!",
      "turn.paused": "Paused",
      "turn.over": "Time's up!",
      "board.label": "Nine holes",
      "hole.label": "Hole {n}",
      "hole.m": "Hole {n}: mole!",
      "hole.g": "Hole {n}: golden mole!",
      "hole.x": "Hole {n}: hedgehog, don't hit",
      "live.start": "Round started, 30 seconds",
      "live.over": "Time's up: {s} points",
      "live.paused": "Paused",
      "res.title": "Time's up",
      "res.points": "{s} points",
      "res.point": "1 point",
      "res.record": "New record!",
      "res.hits": "Moles whacked",
      "res.acc": "Accuracy",
      "res.hogs": "Hedgehogs hit",
      "res.best": "Best",
      "res.rounds": "Rounds",
      "res.close": "Close",
      "stats.title": "Records",
      "stats.head": "Best score · rounds",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "confirm.reset": "Delete the records on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Records reset",
      "toast.stopped": "Round stopped (not counted)",
      "toast.busy": "Finish or stop the round first (N)",
      "toast.start": "Press Start (Space) to play",
      "toast.save": "Could not save: storage is full"
    },
    el: {
      "level.e": "Εύκολο", "level.m": "Μεσαίο", "level.h": "Δύσκολο",
      "btn.new": "Νέος γύρος (N)",
      "btn.stop": "Διακοπή γύρου (N)",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "btn.start": "Έναρξη",
      "btn.again": "Ξανά",
      "st.score": "Πόντοι", "st.time": "Χρόνος",
      "turn.idle": "Χτύπα τους τυφλοπόντικες!",
      "turn.idleHog": "Χτύπα τους τυφλοπόντικες, όχι τον σκαντζόχοιρο!",
      "turn.best": "Ρεκόρ: {n}",
      "turn.ready": "Ετοιμάσου…",
      "turn.go": "Πάμε!",
      "turn.paused": "Παύση",
      "turn.over": "Τέλος χρόνου!",
      "board.label": "Εννέα τρύπες",
      "hole.label": "Τρύπα {n}",
      "hole.m": "Τρύπα {n}: τυφλοπόντικας!",
      "hole.g": "Τρύπα {n}: χρυσός τυφλοπόντικας!",
      "hole.x": "Τρύπα {n}: σκαντζόχοιρος, μην τον χτυπήσεις",
      "live.start": "Ο γύρος ξεκίνησε, 30 δευτερόλεπτα",
      "live.over": "Τέλος χρόνου: {s} πόντοι",
      "live.paused": "Παύση",
      "res.title": "Τέλος χρόνου",
      "res.points": "{s} πόντοι",
      "res.point": "1 πόντος",
      "res.record": "Νέο ρεκόρ!",
      "res.hits": "Τυφλοπόντικες",
      "res.acc": "Ευστοχία",
      "res.hogs": "Σκαντζόχοιροι",
      "res.best": "Ρεκόρ",
      "res.rounds": "Γύροι",
      "res.close": "Κλείσιμο",
      "stats.title": "Ρεκόρ",
      "stats.head": "Ρεκόρ · γύροι",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.stopped": "Ο γύρος σταμάτησε (δεν μετράει)",
      "toast.busy": "Τελείωσε ή σταμάτησε πρώτα τον γύρο (N)",
      "toast.start": "Πάτα Έναρξη (Space) για να παίξεις",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος"
    }
  };

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var str = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) {
      Object.keys(params).forEach(function (k) {
        str = str.split("{" + k + "}").join(String(params[k]));
      });
    }
    return str;
  }

  function $(id) { return document.getElementById(id); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }

  // crypto RNG in [0, 1) (53 bits are more than enough here)
  function rand() {
    var buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return (buf[0] * 2097152 + (buf[1] >>> 11)) / 9007199254740992;
  }

  function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("whack.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Round model ----------
  // The whole round is planned up front: a list of pop-ups
  // { t: ms into the round, h: hole 0–8, k: "m" mole | "g" golden |
  // "x" hedgehog, up: ms it stays up }. Never more than the level's
  // maximum up at once, never two in one hole, and a hole rests a
  // moment after each pop-up. rnd() returns [0, 1).
  function schedule(level, rnd) {
    var P = PARAMS[level], ev = [], busy = [], t = 600, h;
    for (h = 0; h < HOLES; h++) busy.push(0);
    while (t < ROUND_MS - 300) {
      var f = t >= ROUND_MS - RUSH_MS ? RUSH : 1;
      var active = 0, free = [];
      for (var i = 0; i < ev.length; i++) if (ev[i].t <= t && t < ev[i].t + ev[i].up) active++;
      for (h = 0; h < HOLES; h++) if (busy[h] <= t) free.push(h);
      if (active >= P.max || !free.length) { t += 100; continue; }
      var r = rnd();
      var k = r < P.hog ? "x" : (r < P.hog + GOLD ? "g" : "m");
      var up = Math.min(Math.round(P.up * f * (k === "g" ? 0.75 : 1)), ROUND_MS - t);
      if (up < 250) break;
      h = free[Math.floor(rnd() * free.length)];
      ev.push({ t: t, h: h, k: k, up: up });
      busy[h] = t + up + HOLE_REST;
      t += Math.round((P.gap[0] + rnd() * (P.gap[1] - P.gap[0])) * f);
    }
    return ev;
  }

  // Score after a hit on kind k: mole +1, golden +3, hedgehog −2 (not below 0).
  function scoreHit(score, k) {
    if (k === "g") return score + 3;
    if (k === "x") return Math.max(0, score - 2);
    return score + 1;
  }

  // Hole for a key "1"–"9" (keypad layout), or -1.
  function holeForKey(key) {
    return key && key.length === 1 && key >= "1" && key <= "9" ? KEYPAD.indexOf(key) : -1;
  }

  // ---------- 3. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                  // max-merged
  //   rows: { <deviceId>: { b: <epoch>,
  //                         s: { e|m|h: { n: best score, ts: when, g: rounds } } } }
  // }
  // Each device only ever writes ITS OWN row; a row counts from epoch b.
  // Merge per row: the newer epoch wins; equal epochs take, per level,
  // the better best (higher n, then the earlier ts) and the higher g.
  // Rows older than br drop. A join (symmetric, associative, idempotent).
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normCell(v) {
    if (!v || typeof v !== "object" || !isInt(v.n) || !isInt(v.ts) || !isInt(v.g) ||
        v.n < 0 || v.n > MAX_SCORE || v.ts < 0 || v.g < 1) return null;
    return { n: v.n, ts: v.ts, g: v.g };
  }

  function normRow(row) {
    if (!row || typeof row !== "object" || !isInt(row.b) || row.b < 0) return null;
    var s = {}, any = false;
    LEVELS.forEach(function (k) {
      var c = normCell(row.s && row.s[k]);
      if (c) { s[k] = c; any = true; }
    });
    return any ? { b: row.b, s: s } : null;
  }

  function joinCell(a, c) {
    var best = (a.n !== c.n) ? (a.n > c.n ? a : c) : (a.ts <= c.ts ? a : c);
    return { n: best.n, ts: best.ts, g: Math.max(a.g, c.g) };
  }

  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var s = {};
    LEVELS.forEach(function (k) {
      var a = x.s[k], c = y.s[k];
      if (!a && !c) return;
      s[k] = (a && c) ? joinCell(a, c) : normCell(a || c);
    });
    return { b: x.b, s: s };
  }

  function mergeWhack(A, B) {
    var a = A || {}, b = B || {};
    var br = Math.max(isInt(a.br) ? a.br : 0, isInt(b.br) ? b.br : 0);
    var rows = {};
    [a.rows || {}, b.rows || {}].forEach(function (m) {
      if (typeof m !== "object") return;
      Object.keys(m).forEach(function (id) {
        var r = normRow(m[id]);
        if (!r || r.b < br) return;
        rows[id] = rows[id] ? joinRows(rows[id], r) : r;
      });
    });
    var sorted = {};
    Object.keys(rows).sort(cmpStr).forEach(function (id) {
      var r = rows[id], s = {};
      LEVELS.forEach(function (k) { if (r.s[k]) s[k] = r.s[k]; });
      sorted[id] = { b: r.b, s: s };
    });
    return { ver: DATA_VER, br: br, rows: sorted };
  }

  // Best score and rounds played on a level, across every device.
  function totals(key) {
    var out = { n: 0, g: 0 };
    Object.keys(data.rows).forEach(function (id) {
      var c = data.rows[id].s[key];
      if (!c) return;
      out.g += c.g;
      if (c.n > out.n) out.n = c.n;
    });
    return out;
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.rows && typeof parsed.rows === "object") {
          data = mergeWhack(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] whack: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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
      deviceId = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem(DEVICE_KEY, deviceId); } catch (e) {}
    }
  }

  // Counts a finished round; returns true on a new record.
  function countRound(key, score) {
    var before = totals(key).n;
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // new epoch after a reset
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    var c = row.s[key] || { n: 0, ts: 0, g: 0 };
    c = { n: c.n, ts: c.ts, g: c.g + 1 };
    score = Math.min(MAX_SCORE, score);
    if (score > c.n) { c.n = score; c.ts = Date.now(); }
    row.s[key] = c;
    data.rows[deviceId] = row;
    data = mergeWhack(data, data);
    save();
    return score > 0 && score > before;
  }

  // ---------- 4. Device-local prefs ----------
  var prefs = { level: "e" };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object" && LEVELS.indexOf(p.level) >= 0) prefs.level = p.level;
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ---------- 5. Round flow ----------
  // state: idle → count (3-2-1) → run ⇄ paused (hidden; resumes via
  // count) → over. Nothing of a round is saved: it is 30 seconds long.
  var round = null;         // { level, ev, i, acc, runFrom, score, hits, seen, hogs }
  var state = "idle";
  var holes = [];           // per hole: { e: pop-up, hit } or null
  var countTimer = null, countN = 0;
  var raf = 0;

  function busy() { return state === "count" || state === "run" || state === "paused"; }
  function playTime() {
    return round ? round.acc + (round.runFrom ? nowMs() - round.runFrom : 0) : 0;
  }

  function start() {
    if (busy()) return;
    closeDialogs();
    round = { level: prefs.level, ev: schedule(prefs.level, rand), i: 0, acc: 0, runFrom: 0,
              score: 0, hits: 0, seen: 0, hogs: 0 };
    clearHoles();
    countdown();
  }

  // 3-2-1, then the clock runs. Used to start and to resume.
  function countdown() {
    state = "count";
    countN = 3;
    clearTimeout(countTimer);
    renderAll();
    sfx("tick");
    countTimer = setTimeout(function step() {
      countN--;
      if (countN > 0) { renderOverlay(); sfx("tick"); countTimer = setTimeout(step, 650); return; }
      if (document.visibilityState === "hidden") { pause(); return; }
      state = "run";
      if (!round.acc) live(t("live.start"));
      round.runFrom = nowMs();
      renderAll();
      $("board").focus();
      raf = requestAnimationFrame(loop);
    }, 650);
  }

  function pause() {
    if (state === "run") {
      round.acc = playTime();
      round.runFrom = 0;
      cancelAnimationFrame(raf);
    }
    if (state === "run" || state === "count") {
      clearTimeout(countTimer);
      state = "paused";
      live(t("live.paused"));
      renderAll();
    }
  }

  // Stop a round in progress: not counted (R28: the toast says so).
  function stop() {
    if (!busy()) return;
    clearTimeout(countTimer);
    cancelAnimationFrame(raf);
    state = "idle";
    round = null;
    clearHoles();
    renderAll();
    showToast(t("toast.stopped"));
  }

  function loop() {
    if (state !== "run") return;
    var gt = playTime();
    while (round.i < round.ev.length && round.ev[round.i].t <= gt) popUp(round.ev[round.i++]);
    for (var h = 0; h < HOLES; h++) {
      var x = holes[h];
      if (x && !x.hit && gt >= x.e.t + x.e.up) hideHole(h);
    }
    renderClock();
    if (gt >= ROUND_MS) { finish(); return; }
    raf = requestAnimationFrame(loop);
  }

  function popUp(e) {
    holes[e.h] = { e: e, hit: false };
    if (e.k !== "x") round.seen++;
    var b = $("board").children[e.h];
    b.querySelector(".who").innerHTML = CHAR_SVG[e.k];
    b.classList.remove("hit");
    b.classList.add("up");
    b.setAttribute("data-k", e.k);
    b.setAttribute("aria-label", t("hole." + e.k, { n: KEYPAD[e.h] }));
    sfx("pop");
  }

  function hideHole(h) {
    holes[h] = null;
    var b = $("board").children[h];
    b.classList.remove("up");
    b.setAttribute("aria-label", t("hole.label", { n: KEYPAD[h] }));
  }

  function clearHoles() {
    holes = [];
    for (var h = 0; h < HOLES; h++) {
      holes.push(null);
      var b = $("board").children[h];
      if (b) {
        b.classList.remove("up", "hit");
        b.setAttribute("aria-label", t("hole.label", { n: KEYPAD[h] }));
      }
    }
  }

  // A press on hole h (pointer down, key, Enter / Space on the hole).
  function whack(h) {
    if (state === "count" || state === "paused") return;          // the countdown is on screen
    if (state !== "run") { showToast(t("toast.start")); return; }  // R28
    var x = holes[h], b = $("board").children[h];
    if (!x || x.hit) { b.classList.remove("miss"); void b.offsetWidth; b.classList.add("miss"); return; }
    x.hit = true;
    round.score = scoreHit(round.score, x.e.k);
    if (x.e.k === "x") round.hogs++; else round.hits++;
    var pop = b.querySelector(".pop");
    pop.textContent = x.e.k === "g" ? "+3" : (x.e.k === "x" ? "−2" : "+1");
    pop.className = "pop " + (x.e.k === "x" ? "bad" : "good");
    void pop.offsetWidth;
    pop.classList.add("show");
    b.classList.add("hit");
    sfx(x.e.k === "x" ? "ouch" : "bonk");
    renderStatus();
    var e = x.e;
    setTimeout(function () { if (holes[h] && holes[h].e === e) hideHole(h); }, 280);
  }

  function finish() {
    cancelAnimationFrame(raf);
    round.acc = ROUND_MS;
    round.runFrom = 0;
    state = "over";
    for (var h = 0; h < HOLES; h++) if (holes[h]) hideHole(h);
    var rec = countRound(round.level, round.score);
    renderAll();
    live(t("live.over", { s: round.score }));
    sfx("end");
    setTimeout(function () { resultDialog(rec); }, 500);
  }

  // ---------- 6. Render ----------
  function renderAll() {
    renderToolbar();
    renderStatus();
    renderOverlay();
  }

  function renderToolbar() {
    var lv = round && busy() ? round.level : prefs.level;
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-level") === lv;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var nb = $("new-btn"), k = busy() ? "btn.stop" : "btn.new";
    nb.innerHTML = busy() ? UI_ICONS.stop : UI_ICONS.new;
    nb.setAttribute("aria-label", t(k));
    nb.title = t(k);
    paintSfxBtn();
  }

  function fmtLeft(ms) {
    var s = Math.max(0, Math.ceil((ROUND_MS - ms) / 1000));
    return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2);
  }
  function renderClock() {
    var el = $("time");
    el.textContent = fmtLeft(playTime());
    el.classList.toggle("rush", state === "run" && playTime() >= ROUND_MS - RUSH_MS);
  }

  function renderStatus() {
    $("score").textContent = String(round && state !== "idle" ? round.score : 0);
    renderClock();
    var msg, best = totals(prefs.level).n;
    if (state === "count") msg = t("turn.ready");
    else if (state === "run") msg = t("turn.go");
    else if (state === "paused") msg = t("turn.paused");
    else if (state === "over") msg = t("turn.over");
    else msg = best ? t("turn.best", { n: best }) : t(PARAMS[prefs.level].hog ? "turn.idleHog" : "turn.idle");
    $("turn").textContent = msg;
    $("turn").className = state === "over" ? "done" : "";
  }

  function renderOverlay() {
    var ov = $("overlay"), sb = $("start-btn"), cn = $("count");
    var showStart = state === "idle" || state === "over";
    ov.hidden = state === "run";
    sb.hidden = !showStart;
    cn.hidden = showStart;
    sb.innerHTML = UI_ICONS.play + '<span>' + t(state === "over" ? "btn.again" : "btn.start") + '</span><kbd>Space</kbd>';
    cn.textContent = state === "count" ? String(countN) : (state === "paused" ? "❚❚" : "");
    $("field").classList.toggle("dim", state !== "run");
  }

  function layoutBoard() {
    var wrap = $("board-wrap"), el = $("field");
    var cs = getComputedStyle(wrap);
    var W = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var H = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (W <= 0 || H <= 0) return;
    el.style.setProperty("--size", Math.floor(Math.max(220, Math.min(W, H, 540))) + "px");
  }

  function buildBoard() {
    var el = $("board");
    el.innerHTML = "";
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", t("board.label"));
    el.tabIndex = -1;
    for (var h = 0; h < HOLES; h++) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "hole";
      b.setAttribute("data-h", String(h));
      b.innerHTML = '<span class="pit"></span><span class="mask"><span class="who"></span></span>' +
                    '<span class="lip"></span><span class="key">' + KEYPAD[h] + '</span><span class="pop"></span>';
      el.appendChild(b);
    }
    clearHoles();
    layoutBoard();
  }

  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // Characters (viewBox 100×100, standing on the bottom edge). Told
  // apart by shape: the golden one wears a crown, the hedgehog spikes.
  var EYES = '<g class="eyes"><circle cx="38" cy="50" r="4.5"/><circle cx="62" cy="50" r="4.5"/></g>' +
             '<g class="xeyes"><path d="M34 46l8 8M42 46l-8 8M58 46l8 8M66 46l-8 8"/></g>';
  var CHAR_SVG = {
    m: '<svg viewBox="0 0 100 100" aria-hidden="true"><path class="body" d="M14 100V58a36 36 0 0 1 72 0v42z" fill="#8a5a3b"/>' +
       '<ellipse cx="50" cy="84" rx="22" ry="16" fill="#c08b63"/>' + EYES +
       '<ellipse cx="50" cy="62" rx="7" ry="5" fill="#f19aa6"/>' +
       '<path d="M30 64h-12M30 68l-11 4M70 64h12M70 68l11 4" stroke="#3a2618" stroke-width="1.6"/></svg>',
    g: '<svg viewBox="0 0 100 100" aria-hidden="true"><path class="body" d="M14 100V58a36 36 0 0 1 72 0v42z" fill="#e0ad2e"/>' +
       '<ellipse cx="50" cy="84" rx="22" ry="16" fill="#f3d27a"/>' + EYES +
       '<ellipse cx="50" cy="62" rx="7" ry="5" fill="#f19aa6"/>' +
       '<path d="M31 30l4-20 8 11 7-15 7 15 8-11 4 20z" fill="#ffe26a" stroke="#8a6410" stroke-width="2" stroke-linejoin="round"/></svg>',
    x: '<svg viewBox="0 0 100 100" aria-hidden="true"><path class="body" d="M6 100L9 70 3 62 13 56 9 44 21 44 21 30 33 36 37 22 47 32 54 18 60 32 70 22 72 37 84 31 82 45 94 47 88 58 97 65 91 72 94 100z" fill="#5b4f45"/>' +
       '<path d="M24 100V72a26 22 0 0 1 52 0v28z" fill="#d9c3a5"/>' +
       '<g class="eyes"><circle cx="41" cy="72" r="4"/><circle cx="59" cy="72" r="4"/></g>' +
       '<g class="xeyes"><path d="M37 68l8 8M45 68l-8 8M55 68l8 8M63 68l-8 8"/></g>' +
       '<circle cx="50" cy="84" r="5" fill="#2b2420"/></svg>'
  };

  // ---------- 7. Dialogs ----------
  function closeDialogs() {
    [].forEach.call(document.querySelectorAll("dialog[open]"), function (d) { d.close(); });
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
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function row(k, v) {
    var r = el("div", "dlg-row");
    r.appendChild(el("span", "", k));
    r.appendChild(el("strong", "", v));
    return r;
  }
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  function resultDialog(rec) {
    if (state !== "over" || !round) return;    // replaced meanwhile
    var s = totals(round.level);
    var dlg = makeDialog("whack-result");
    dlg.appendChild(el("div", "dlg-title", t("res.title") + " · " + t("level." + round.level)));
    dlg.appendChild(el("div", "dlg-hero", round.score === 1 ? t("res.point") : t("res.points", { s: round.score })));
    if (rec) dlg.appendChild(el("div", "dlg-badge", t("res.record")));
    dlg.appendChild(row(t("res.hits"), round.hits + " / " + round.seen));
    dlg.appendChild(row(t("res.acc"), round.seen ? Math.round(100 * round.hits / round.seen) + "%" : "–"));
    if (PARAMS[round.level].hog) dlg.appendChild(row(t("res.hogs"), String(round.hogs)));
    dlg.appendChild(row(t("res.best"), String(s.n)));
    dlg.appendChild(row(t("res.rounds"), String(s.g)));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("res.close"), "", function () { dlg.close(); }));
    var again = button(t("btn.again"), "primary", function () { dlg.close(); start(); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    again.focus();
  }

  function statsDialog() {
    if (busy()) { showToast(t("toast.busy")); return; }
    var dlg = makeDialog("whack-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    LEVELS.forEach(function (k) {
      var s = totals(k);
      if (s.g) empty = false;
      dlg.appendChild(row(t("level." + k), s.g ? s.n + " · " + s.g : "–"));
    });
    var acts = el("div", "dlg-actions");
    var reset = button(t("stats.reset"), "danger", function () {
      dlg.close();
      confirmDialog(t("confirm.reset"), resetRecords);
    });
    reset.disabled = empty;
    acts.appendChild(reset);
    var close = button(t("stats.close"), "primary", function () { dlg.close(); });
    acts.appendChild(close);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    close.focus();
  }

  function confirmDialog(msg, onYes) {
    var dlg = makeDialog("whack-confirm");
    dlg.appendChild(el("div", "dlg-msg", msg));
    var acts = el("div", "dlg-actions");
    var no = button(t("confirm.no"), "", function () { dlg.close(); });
    acts.appendChild(no);
    acts.appendChild(button(t("confirm.yes"), "danger", function () { dlg.close(); onYes(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    no.focus();
  }

  // Reset = a new epoch: every device drops rows older than br and
  // starts its own row again from zero.
  function resetRecords() {
    data.br = Math.max(Date.now(), data.br + 1);
    data = mergeWhack(data, data);
    save();
    renderStatus();
    showToast(t("toast.reset"));
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "whack", title: String(text) })) return;
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

  // ---------- 9. Sound ----------
  var audio = null;
  function sfxOn() {
    try { return localStorage.getItem(SFX_KEY) === "1"; } catch (e) { return false; }
  }
  function tone(freq, start, dur, type, vol) {
    var o = audio.createOscillator(), g = audio.createGain();
    o.type = type || "sine";
    o.frequency.value = freq;
    var t0 = audio.currentTime + start;
    g.gain.setValueAtTime(vol || 0.18, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(audio.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function sfx(kind) {
    if (!sfxOn()) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio) audio = new AC();
      if (audio.state === "suspended") audio.resume();
      if (kind === "pop") tone(520, 0, 0.06, "sine", 0.06);
      else if (kind === "tick") tone(880, 0, 0.08, "triangle", 0.1);
      else if (kind === "bonk") { tone(220, 0, 0.09, "triangle", 0.22); tone(150, 0.03, 0.1, "triangle", 0.18); }
      else if (kind === "ouch") tone(110, 0, 0.25, "sawtooth", 0.12);
      else if (kind === "end") {
        [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
      }
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Toolbar icons (R9: injected by JS) ----------
  var UI_ICONS = {
    new:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    stop:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>',
    play:  '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
    stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    sfxOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    sfxOff:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>'
  };
  function paintSfxBtn() {
    var b = $("sfx-btn"), on = sfxOn();
    b.innerHTML = on ? UI_ICONS.sfxOn : UI_ICONS.sfxOff;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.setAttribute("aria-label", t(on ? "btn.sfxOn" : "btn.sfxOff"));
    b.title = t(on ? "btn.sfxOn" : "btn.sfxOff");
  }

  // ---------- 10. Input ----------
  // A whack counts on press (pointerdown), so it feels instant; Enter /
  // Space on a focused hole arrive as a click with detail 0.
  function wirePointer() {
    var board = $("board");
    board.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      var b = e.target.closest && e.target.closest(".hole");
      if (!b) return;
      e.preventDefault();                      // no focus ring flash, no double-tap zoom
      whack(+b.getAttribute("data-h"));
    });
    board.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".hole");
      if (b && e.detail === 0) whack(+b.getAttribute("data-h"));
    });
  }

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;              // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      if (e.repeat) return;
      var h = holeForKey(e.key);
      if (h >= 0) { e.preventDefault(); whack(h); return; }
      if (e.shiftKey) return;
      if (e.code === "KeyN") { e.preventDefault(); if (busy()) stop(); else start(); return; }
      if (e.code === "Space" && !busy()) {
        // a focused toolbar or dialog button keeps its own Space
        var a = document.activeElement;
        if (a && a.tagName === "BUTTON" && a.id !== "start-btn" &&
            !(a.classList && a.classList.contains("hole"))) return;
        e.preventDefault();
        start();
      }
    });

    // Contract Β: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
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
    api.registerSlice("whack", sliceGet, sliceSet, STORAGE_KEY, mergeWhack);
  }

  function sliceGet() {
    return mergeWhack(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeWhack(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (state === "idle") renderStatus();
    // no toast on merge (sync feedback = taskbar dot)
  }

  // ---------- 12. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
  }

  function paintStatic() {
    var b = $("stats-btn");
    b.innerHTML = UI_ICONS.stats;
    b.setAttribute("aria-label", t("btn.stats"));
    b.title = t("btn.stats");
    paintSfxBtn();
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () {
        if (busy()) { showToast(t("toast.busy")); return; }                // R28
        prefs.level = b.getAttribute("data-level");
        savePrefs();
        if (state === "over") { state = "idle"; round = null; }
        renderAll();
      });
    });
    $("new-btn").addEventListener("click", function () { if (busy()) stop(); else start(); });
    $("start-btn").addEventListener("click", start);
    $("stats-btn").addEventListener("click", statsDialog);
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("bonk");   // audible confirmation when turned on
    });
    wirePointer();

    var relayout = function () { layoutBoard(); };
    if (window.ResizeObserver) new ResizeObserver(relayout).observe($("board-wrap"));
    else window.addEventListener("resize", relayout);

    // Hidden → pause; visible again → 3-2-1 and carry on.
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") pause();
      else if (state === "paused") countdown();
    });

    wireKeyboard();
  }

  function boot() {
    load();
    ensureDeviceId();
    loadPrefs();
    applyI18n();
    paintStatic();
    buildBoard();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    renderAll();
  }

  boot();
})();
