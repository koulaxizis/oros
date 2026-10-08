// ============================================================
// orOS Simon Says — App logic (v1.0.0)
// Simon plays a sequence of lit pads, each with its own tone; you
// repeat it. Every round adds one step; the first mistake ends the
// game. Score = the longest sequence you completed.
//   - 4 or 6 pads; Classic or Reverse (repeat it back to front)
//   - the tempo rises after steps 5, 9 and 13, as in the original
//   - no time limit for your answer
// Data:
//   - synced slice "simon" (oros-simon-data): best score, its date and
//     the games played per setting, as per-device rows (each device
//     only grows its own row; merge = per-row join) + a reset stamp br
//   - device-local (R10): oros-simon-prefs (pads, mode),
//     oros-simon-device (row id), oros-simon-sfx (sound; ON unless
//     turned off: the tones are part of the game)
//   - a game in progress is not saved: the sequence has to be shown
//     from the start, so leaving ends it
// Sections:
//   1. Constants, i18n, helpers
//   2. Game model (sequence, expected pad, tempo)
//   3. Synced data: load / save / normalize / merge (R5, R26)
//   4. Device-local prefs
//   5. Game flow (start, show, input, round, game over)
//   6. Render (toolbar, status, board, pads)
//   7. Dialogs (result, records, confirm)
//   8. Toasts
//   9. Sound (one tone per pad)
//  10. Keyboard (1–4 / 1–6, Space, N, Contract Β)
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-simon-data";
  var PREFS_KEY   = "oros-simon-prefs";
  var DEVICE_KEY  = "oros-simon-device";
  var SFX_KEY     = "oros-simon-sfx";
  var DATA_VER    = 1;

  var PADS = [4, 6];
  var MODES = ["c", "r"];                    // classic / reverse
  var KEYS = ["c4", "r4", "c6", "r6"];       // records: mode + pads
  var MAX_SEQ = 200;
  var ROUND_PAUSE = 700;                     // ms after a completed round
  var PRESS_MS = 220;                        // a tapped pad stays lit

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
      "pads.4": "4 pads", "pads.6": "6 pads",
      "mode.c": "Classic", "mode.r": "Reverse",
      "mode.rTip": "Repeat the sequence back to front",
      "btn.new": "New game (N)",
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "btn.start": "Start",
      "hub.start": "Start (Space)",
      "st.round": "Round", "st.best": "Best",
      "turn.idle": "Press Start",
      "turn.show": "Simon says…",
      "turn.you": "Your turn",
      "turn.youRev": "Your turn, back to front",
      "turn.over": "Game over",
      "board.label": "Simon pads",
      "pad.0": "Green circle", "pad.1": "Red triangle", "pad.2": "Yellow square",
      "pad.3": "Blue diamond", "pad.4": "Purple star", "pad.5": "Orange hexagon",
      "pad.label": "{n}: {name}",
      "live.round": "Round {n}: watch",
      "live.you": "Your turn: {n} steps",
      "live.over": "Wrong pad. Score {n}",
      "res.title": "Game over",
      "res.score": "Score {n}",
      "res.zero": "No round completed",
      "res.record": "New record!",
      "res.best": "Best",
      "res.games": "Games",
      "res.again": "Play again",
      "res.close": "Close",
      "stats.title": "Records",
      "stats.head": "Best · games",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "confirm.reset": "Delete the records and game counts on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Records reset",
      "toast.ended": "Game ended with score {n}",
      "toast.wait": "Watch first: Simon is playing",
      "toast.idle": "Press Start to play (Space)",
      "toast.save": "Could not save: storage is full"
    },
    el: {
      "pads.4": "4 πλήκτρα", "pads.6": "6 πλήκτρα",
      "mode.c": "Κλασικό", "mode.r": "Ανάποδα",
      "mode.rTip": "Επανάλαβε την ακολουθία από το τέλος προς την αρχή",
      "btn.new": "Νέο παιχνίδι (N)",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "btn.start": "Έναρξη",
      "hub.start": "Έναρξη (Space)",
      "st.round": "Γύρος", "st.best": "Ρεκόρ",
      "turn.idle": "Πάτα Έναρξη",
      "turn.show": "Ο Σάιμον λέει…",
      "turn.you": "Σειρά σου",
      "turn.youRev": "Σειρά σου, ανάποδα",
      "turn.over": "Τέλος",
      "board.label": "Πλήκτρα του Σάιμον",
      "pad.0": "Πράσινος κύκλος", "pad.1": "Κόκκινο τρίγωνο", "pad.2": "Κίτρινο τετράγωνο",
      "pad.3": "Μπλε ρόμβος", "pad.4": "Μωβ αστέρι", "pad.5": "Πορτοκαλί εξάγωνο",
      "pad.label": "{n}: {name}",
      "live.round": "Γύρος {n}: παρακολούθησε",
      "live.you": "Σειρά σου: {n} βήματα",
      "live.over": "Λάθος πλήκτρο. Σκορ {n}",
      "res.title": "Τέλος",
      "res.score": "Σκορ {n}",
      "res.zero": "Δεν ολοκληρώθηκε γύρος",
      "res.record": "Νέο ρεκόρ!",
      "res.best": "Ρεκόρ",
      "res.games": "Παιχνίδια",
      "res.again": "Ξανά",
      "res.close": "Κλείσιμο",
      "stats.title": "Ρεκόρ",
      "stats.head": "Ρεκόρ · παιχνίδια",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ και οι μετρητές παιχνιδιών σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.ended": "Το παιχνίδι έληξε με σκορ {n}",
      "toast.wait": "Πρώτα δες: παίζει ο Σάιμον",
      "toast.idle": "Πάτα Έναρξη για να παίξεις (Space)",
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

  // crypto RNG with rejection sampling (same as Dice / Memory / Connect 4)
  function randInt(n) {
    var buf = new Uint32Array(1);
    var lim = 0xFFFFFFFF - (0xFFFFFFFF % n);
    while (true) {
      crypto.getRandomValues(buf);
      if (buf[0] < lim) return buf[0] % n;
    }
  }

  function fmtDate(ts) {
    try {
      return new Date(ts).toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB",
        { day: "numeric", month: "short", year: "numeric" });
    } catch (e) { return ""; }
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("simon.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Game model ----------
  // The pad the player must press as the k-th answer of this round.
  function expectedPad(seq, mode, k) {
    return mode === "r" ? seq[seq.length - 1 - k] : seq[k];
  }

  // One more step; the earlier steps never change.
  function extend(seq, pads) { return seq.concat([randInt(pads)]); }

  // How long a pad is lit while Simon plays, and the gap after it (ms).
  // Faster after steps 5, 9 and 13, as in the original game.
  function tempo(len) {
    if (len <= 5) return { on: 480, gap: 140 };
    if (len <= 9) return { on: 380, gap: 120 };
    if (len <= 13) return { on: 300, gap: 100 };
    return { on: 230, gap: 90 };
  }

  // ---------- 3. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                     // max-merged
  //   rows: { <deviceId>: { b: <epoch>,
  //                         s: { c4|r4|c6|r6: { n: best, ts: when, g: games } } } }
  // }
  // Each device only ever writes ITS OWN row; a row counts from epoch
  // b. Merge per row: the newer epoch wins; equal epochs take, per
  // setting, the better best (higher n, then earlier ts) and the larger
  // g. Rows older than br are dropped. A join (symmetric, associative,
  // idempotent): no record or game is lost or counted twice.
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normCell(v) {
    if (!v || typeof v !== "object" || !isInt(v.n) || !isInt(v.ts) || !isInt(v.g) ||
        v.n < 0 || v.n > MAX_SEQ || v.ts < 0 || v.g < 0) return null;
    return { n: v.n, ts: v.ts, g: v.g };
  }

  function normRow(row) {
    if (!row || typeof row !== "object" || !isInt(row.b) || row.b < 0) return null;
    var s = {}, any = false;
    KEYS.forEach(function (k) {
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
    KEYS.forEach(function (k) {
      var a = x.s[k], c = y.s[k];
      if (!a && !c) return;
      s[k] = !a ? normCell(c) : !c ? normCell(a) : joinCell(a, c);
    });
    return { b: x.b, s: s };
  }

  function mergeSimon(A, B) {
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
      KEYS.forEach(function (k) { if (r.s[k]) s[k] = r.s[k]; });
      sorted[id] = { b: r.b, s: s };
    });
    return { ver: DATA_VER, br: br, rows: sorted };
  }

  // Best (with its date) and games played for one setting, all devices.
  function totals(key) {
    var out = { n: 0, ts: 0, g: 0 };
    Object.keys(data.rows).forEach(function (id) {
      var c = data.rows[id].s[key];
      if (!c) return;
      out.g += c.g;
      if (c.n > out.n || (c.n === out.n && c.n > 0 && (out.ts === 0 || c.ts < out.ts))) {
        out.n = c.n; out.ts = c.ts;
      }
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
          data = mergeSimon(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] simon: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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

  // Counts a finished game; returns true when it set a new record.
  function countGame(key, score) {
    var before = totals(key).n;
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // new epoch after a reset
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    var c = row.s[key] || { n: 0, ts: 0, g: 0 };
    c = { n: c.n, ts: c.ts, g: c.g + 1 };
    if (score > c.n) { c.n = score; c.ts = Date.now(); }
    row.s[key] = c;
    data.rows[deviceId] = row;
    data = mergeSimon(data, data);
    save();
    return score > 0 && score > before;
  }

  // ---------- 4. Device-local prefs ----------
  var prefs = { pads: 4, mode: "c" };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (PADS.indexOf(p.pads) >= 0) prefs.pads = p.pads;
        if (MODES.indexOf(p.mode) >= 0) prefs.mode = p.mode;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }
  function prefKey() { return prefs.mode + prefs.pads; }

  // ---------- 5. Game flow ----------
  // game = { pads, mode, seq: [pad…], phase: "idle"|"show"|"input"|"over",
  //          k: answers given this round, score }
  var game = null;
  var timers = [];
  var lit = -1;            // pad lit right now (-1: none)
  var missed = -1;         // the pad that was expected when you missed

  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  function fresh() {
    return { pads: prefs.pads, mode: prefs.mode, seq: [], phase: "idle", k: 0, score: 0 };
  }

  function playing() { return !!(game && (game.phase === "show" || game.phase === "input")); }

  // A game in progress is never dropped silently: it ends and counts.
  function endRunning(announce) {
    if (!playing()) return;
    var score = game.seq.length - 1;
    clearTimers();
    lightPad(-1);
    countGame(game.mode + game.pads, score);
    if (announce) showToast(t("toast.ended", { n: score }));
  }

  function newGame(autostart) {
    endRunning(true);
    clearTimers();
    game = fresh();
    missed = -1;
    renderAll(true);
    if (autostart) start();
  }

  function start() {
    if (playing()) return;
    if (!game || game.phase === "over" || game.pads !== prefs.pads || game.mode !== prefs.mode) {
      game = fresh();
      missed = -1;
      renderAll(true);
    }
    nextRound();
  }

  function nextRound() {
    game.seq = extend(game.seq, game.pads);
    game.k = 0;
    showSequence();
  }

  function showSequence() {
    game.phase = "show";
    renderAll(false);
    live(t("live.round", { n: game.seq.length }));
    var tp = tempo(game.seq.length), at = 450;
    game.seq.forEach(function (p) {
      later(function () { lightPad(p); tone(p, tp.on / 1000); }, at);
      later(function () { lightPad(-1); }, at + tp.on);
      at += tp.on + tp.gap;
    });
    later(function () {
      game.phase = "input";
      renderAll(false);
      live(t("live.you", { n: game.seq.length }));
    }, at);
  }

  // A press on pad p (tap, click or key).
  function press(p) {
    if (!game || p < 0 || p >= game.pads) return;
    if (game.phase === "show") { showToast(t("toast.wait")); return; }   // R28
    if (game.phase !== "input") { showToast(t("toast.idle")); return; }
    clearTimers();
    lightPad(p);
    later(function () { lightPad(-1); }, PRESS_MS);
    if (p !== expectedPad(game.seq, game.mode, game.k)) { gameOver(); return; }
    tone(p, PRESS_MS / 1000);
    game.k++;
    if (game.k < game.seq.length) return;
    game.score = game.seq.length;
    game.phase = "show";                       // locked until the next round
    renderAll(false);
    later(nextRound, ROUND_PAUSE);
  }

  function gameOver() {
    missed = expectedPad(game.seq, game.mode, game.k);
    game.phase = "over";
    game.score = game.seq.length - 1;
    buzz();
    var rec = countGame(game.mode + game.pads, game.score);
    live(t("live.over", { n: game.score }));
    renderAll(false);
    later(function () { lightPad(missed); }, PRESS_MS + 60);     // show the right pad
    later(function () { lightPad(-1); }, PRESS_MS + 760);
    later(function () { resultDialog(rec); }, 1100);
  }

  // ---------- 6. Render ----------
  var PAD_SHAPES = [
    '<circle cx="12" cy="12" r="7"/>',
    '<path d="M12 4.5 20 19H4z"/>',
    '<rect x="5.5" y="5.5" width="13" height="13" rx="1.5"/>',
    '<path d="M12 3.5 20.5 12 12 20.5 3.5 12z"/>',
    '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
    '<path d="M12 3.5l7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5z"/>'
  ];

  function renderAll(rebuild) {
    renderToolbar();
    renderStatus();
    if (rebuild) buildBoard(); else renderBoard();
  }

  function segActive(sel, attr, val) {
    [].forEach.call(document.querySelectorAll(sel + " .seg-btn"), function (b) {
      var on = b.getAttribute(attr) === String(val);
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function renderToolbar() {
    segActive("#pads-seg", "data-pads", prefs.pads);
    segActive("#mode-seg", "data-mode", prefs.mode);
    paintSfxBtn();
  }

  function renderStatus() {
    if (!game) return;
    $("round").textContent = String(game.phase === "idle" ? 0 : game.seq.length);
    $("best").textContent = String(totals(game.mode + game.pads).n);
    var txt = { idle: t("turn.idle"), show: t("turn.show"), over: t("turn.over"),
                input: t(game.mode === "r" ? "turn.youRev" : "turn.you") }[game.phase];
    $("turn").textContent = txt;
    $("turn").className = game.phase;
  }

  function layoutBoard() {
    var wrap = $("board-wrap"), el = $("board");
    var cs = getComputedStyle(wrap);
    var W = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var H = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (W <= 0 || H <= 0) return;
    el.style.setProperty("--size", Math.floor(Math.max(220, Math.min(W, H, 560))) + "px");
  }

  function buildBoard() {
    var el = $("board"), n = game.pads;
    el.innerHTML = "";
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", t("board.label"));
    el.className = "n" + n;
    var ring = n === 4 ? 0.33 : 0.34, size = n === 4 ? 0.30 : 0.26;
    for (var p = 0; p < n; p++) {
      var a = -Math.PI / 2 + (n === 4 ? Math.PI / 4 : 0) + p * 2 * Math.PI / n;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "pad c" + p;
      b.setAttribute("data-p", String(p));
      b.setAttribute("aria-label", t("pad.label", { n: p + 1, name: t("pad." + p) }));
      b.style.left = ((0.5 + ring * Math.cos(a) - size / 2) * 100).toFixed(3) + "%";
      b.style.top = ((0.5 + ring * Math.sin(a) - size / 2) * 100).toFixed(3) + "%";
      b.style.width = b.style.height = (size * 100) + "%";
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + PAD_SHAPES[p] + "</svg>";
      var num = document.createElement("span");
      num.className = "num";
      num.textContent = String(p + 1);
      b.appendChild(num);
      el.appendChild(b);
    }
    var hub = document.createElement("button");
    hub.type = "button";
    hub.id = "hub";
    el.appendChild(hub);
    layoutBoard();
    renderBoard();
  }

  function renderBoard() {
    var el = $("board");
    el.classList.toggle("listen", game.phase === "show");
    el.classList.toggle("over", game.phase === "over");
    var pads = el.querySelectorAll(".pad");
    for (var p = 0; p < pads.length; p++) {
      pads[p].classList.toggle("lit", p === lit);
      pads[p].classList.toggle("missed", game.phase === "over" && p === missed);
      if (game.phase === "input") pads[p].removeAttribute("aria-disabled");
      else pads[p].setAttribute("aria-disabled", "true");
    }
    var hub = $("hub");
    if (!hub) return;
    var canStart = !playing();
    hub.textContent = canStart ? t("btn.start") : String(game.seq.length);
    hub.classList.toggle("go", canStart);
    hub.setAttribute("aria-label", canStart ? t("hub.start") : t("st.round") + " " + game.seq.length);
    hub.title = canStart ? t("hub.start") : "";
    if (canStart) hub.removeAttribute("aria-disabled");
    else hub.setAttribute("aria-disabled", "true");
  }

  function lightPad(p) {
    lit = p;
    var pads = $("board").querySelectorAll(".pad");
    for (var i = 0; i < pads.length; i++) pads[i].classList.toggle("lit", i === p);
  }

  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 7. Dialogs ----------
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
  function settingName(key) {
    return t("pads." + key.slice(1)) + " · " + t("mode." + key.charAt(0));
  }
  function bestText(s) {
    return s.n ? s.n + " · " + fmtDate(s.ts) : "–";
  }

  function resultDialog(record) {
    if (!game || game.phase !== "over") return;        // replaced meanwhile
    var key = game.mode + game.pads, s = totals(key);
    var dlg = makeDialog("simon-result");
    dlg.appendChild(el("div", "dlg-title", t("res.title") + " · " + settingName(key)));
    dlg.appendChild(el("div", "dlg-hero", game.score ? t("res.score", { n: game.score }) : t("res.zero")));
    if (record) dlg.appendChild(el("div", "dlg-badge", t("res.record")));
    dlg.appendChild(row(t("res.best"), bestText(s)));
    dlg.appendChild(row(t("res.games"), String(s.g)));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("res.close"), "", function () { dlg.close(); }));
    var again = button(t("res.again"), "primary", function () { dlg.close(); newGame(true); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    again.focus();
  }

  function statsDialog() {
    var dlg = makeDialog("simon-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    KEYS.forEach(function (k) {
      var s = totals(k);
      if (s.g) empty = false;
      dlg.appendChild(row(settingName(k), (s.n ? bestText(s) : "–") + " · " + s.g));
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
    var dlg = makeDialog("simon-confirm");
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
    data = mergeSimon(data, data);
    save();
    renderStatus();
    showToast(t("toast.reset"));
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "simon", title: String(text) })) return;
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
  // One tone per pad (the first four are the original Simon notes).
  var FREQ = [329.63, 261.63, 220.0, 164.81, 392.0, 293.66];
  var audio = null;
  function sfxOn() {
    try { return localStorage.getItem(SFX_KEY) !== "0"; } catch (e) { return true; }
  }
  function ctx() {
    if (!sfxOn()) return null;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!audio) audio = new AC();
      if (audio.state === "suspended") audio.resume();
      return audio;
    } catch (e) { return null; }
  }
  function note(freq, dur, type, vol) {
    var a = ctx();
    if (!a) return;
    try {
      var o = a.createOscillator(), g = a.createGain(), t0 = a.currentTime;
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
      g.gain.setValueAtTime(vol, t0 + Math.max(0.02, dur - 0.05));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(a.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (e) { /* no audio → silent */ }
  }
  function tone(p, dur) { note(FREQ[p], dur, "triangle", 0.2); }
  function buzz() { note(70, 0.6, "sawtooth", 0.12); }

  // ---------- Toolbar icons (R9: injected by JS) ----------
  var UI_ICONS = {
    new:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
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

  // ---------- 10. Keyboard ----------
  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;   // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var a = document.activeElement;
      var tag = (a && a.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      if (e.code === "KeyN") { e.preventDefault(); newGame(true); return; }
      var m = /^(?:Digit|Numpad)([1-6])$/.exec(e.code);
      if (m) { e.preventDefault(); if (!e.repeat) press(+m[1] - 1); return; }
      // Space starts a game, unless it is pressing a focused button
      if (e.code === "Space" && !(tag === "BUTTON" && a.id !== "hub")) {
        e.preventDefault();
        if (!playing()) start();
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
    api.registerSlice("simon", sliceGet, sliceSet, STORAGE_KEY, mergeSimon);
  }

  function sliceGet() {
    return mergeSimon(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeSimon(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    renderStatus();   // no toast on merge (sync feedback = taskbar dot)
  }

  // ---------- 12. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    var r = document.querySelector('#mode-seg [data-mode="r"]');
    r.title = t("mode.rTip");
  }

  function paintStatic() {
    [["new-btn", "new", "btn.new"], ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    paintSfxBtn();
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#pads-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () {
        var n = +b.getAttribute("data-pads");
        if (n === prefs.pads && !(game && game.phase === "over")) return;
        prefs.pads = n; savePrefs(); newGame(false);
      });
    });
    [].forEach.call(document.querySelectorAll("#mode-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () {
        var m = b.getAttribute("data-mode");
        if (m === prefs.mode && !(game && game.phase === "over")) return;
        prefs.mode = m; savePrefs(); newGame(false);
      });
    });
    $("new-btn").addEventListener("click", function () { newGame(true); $("new-btn").blur(); });
    $("stats-btn").addEventListener("click", statsDialog);
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      tone(0, 0.15);   // audible confirmation when turned on
    });
    // pointerdown, not click: the pad answers the moment it is touched
    $("board").addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      var p = e.target.closest && e.target.closest(".pad");
      if (p) { e.preventDefault(); press(+p.getAttribute("data-p")); }
    });
    $("board").addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("#hub")) { if (!playing()) start(); return; }
      // keyboard activation (Enter / Space on a focused pad) has detail 0
      var p = e.target.closest && e.target.closest(".pad");
      if (p && e.detail === 0) press(+p.getAttribute("data-p"));
    });

    var relayout = function () { layoutBoard(); };
    if (window.ResizeObserver) new ResizeObserver(relayout).observe($("board-wrap"));
    else window.addEventListener("resize", relayout);

    // Leaving the app mid-game ends it (it cannot be resumed) and counts it.
    window.addEventListener("pagehide", function () { endRunning(false); });

    wireKeyboard();
  }

  function boot() {
    load();
    ensureDeviceId();
    loadPrefs();
    applyI18n();
    paintStatic();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    game = fresh();
    renderAll(true);
  }

  boot();
})();
