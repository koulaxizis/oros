// ============================================================
// orOS Game Center — App logic (v1.0.0)
// One page for every game: today's six Daily challenges, the
// achievements and the statistics of each game (played, won,
// streak, best time, best score).
//   - READ-ONLY: it reads the games' own synced data from this
//     device (oros-<game>-data) through gamecenter/core.js and
//     never writes it. It has no slice and stores nothing of its
//     own, so achievements are always computed, never saved.
//   - opens a game (Daily cards open straight into the Daily with
//     the deep link { daily: true }); a game that is not installed
//     shows as such
//   - deep link __orosOpenAt("gamecenter", { game: "<id>" }) (the
//     "All games" link in each game) scrolls to that game's row
// Data: none (no synced slice, no device-local keys).
// Sections:
//   1. Constants, i18n, helpers
//   2. Shell bridge (installed apps, open a game)
//   3. Render (header, today, achievements, statistics)
//   4. Palette + Contract Β
//   5. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var CORE = window.orosGameCore;
  var DK = window.orosDaily || null;

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  // orosI18n (../i18n.js): the full language code, a pack language included.
  var LANG = window.orosI18n ? window.orosI18n.lang() : appLang();
  function loc() { return window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB"); }

  var STRINGS = {
    en: {
      "app.name": "Game Center",
      "sub.streak": "Daily streak: {n} days · best {b}",
      "sub.streak1": "Daily streak: 1 day · best {b}",
      "sub.none": "Solve a daily puzzle to start a streak.",
      "today.title": "Today's dailies",
      "today.note": "{n} of {k} solved",
      "today.solved": "Solved",
      "today.lost": "Not solved",
      "today.open": "Not played yet",
      "today.streak": "Streak {n}",
      "today.play": "Play",
      "today.see": "See",
      "today.missing": "Not installed",
      "ach.title": "Achievements",
      "ach.note": "{n} of {k}",
      "ach.done": "Done",
      "ach.progress": "{h} of {n}",
      "stats.title": "Statistics",
      "stats.note": "{p} games played · {w} won",
      "stats.empty": "No games played on this device yet.",
      "stats.played": "Played",
      "stats.won": "Won",
      "stats.solved": "Solved",
      "stats.streak": "Streak",
      "stats.streakV": "{c} · best {b}",
      "stats.time": "Best time",
      "stats.score": "Best score",
      "stats.daily": "Dailies",
      "stats.open": "Open {g}",
      "stats.unplayed": "Not played yet ({n})",
      "foot.note": "Everything here is read from the games' own data on this device, which syncs with each game. Nothing extra is stored.",
      "toast.missing": "{g} is not installed. Add it from the App Store in Settings.",
      "a.first": "First win", "d.first": "Win or solve any game.",
      "a.daily1": "First daily", "d.daily1": "Solve a Daily challenge.",
      "a.streak7": "One week", "d.streak7": "Solve the Daily of one game 7 days in a row.",
      "a.streak30": "One month", "d.streak30": "Solve the Daily of one game 30 days in a row.",
      "a.sweep": "Clean sweep", "d.sweep": "Solve all six dailies on the same day.",
      "a.clean": "No help needed", "d.clean": "Solve a Sudoku, Nonogram, Flow Free or Crossword daily without a hint.",
      "a.wordle2": "Sharp guess", "d.wordle2": "Find the daily Wordle word in two tries or fewer.",
      "a.killer": "Killer", "d.killer": "Solve a Killer Sudoku.",
      "a.cards": "Card shark", "d.cards": "Win Klondike, FreeCell, Spider and Pyramid.",
      "a.hard": "Machine beater", "d.hard": "Beat the computer on Hard in any game.",
      "a.expert": "Mine expert", "d.expert": "Win Minesweeper on Expert.",
      "a.speedy": "Fast fingers", "d.speedy": "Solve a Sudoku in under 5 minutes.",
      "a.variety": "All-rounder", "d.variety": "Win 10 different games.",
      "a.played100": "Regular", "d.played100": "Play 100 games.",
      "a.wins250": "Champion", "d.wins250": "Win 250 games."
    },
    el: {
      "app.name": "Κέντρο παιχνιδιών",
      "sub.streak": "Σερί ημερήσιων: {n} μέρες · καλύτερο {b}",
      "sub.streak1": "Σερί ημερήσιων: 1 μέρα · καλύτερο {b}",
      "sub.none": "Λύσε ένα ημερήσιο παζλ για να ξεκινήσεις σερί.",
      "today.title": "Σημερινές προκλήσεις",
      "today.note": "{n} από {k} λυμένες",
      "today.solved": "Λύθηκε",
      "today.lost": "Δεν λύθηκε",
      "today.open": "Δεν παίχτηκε ακόμα",
      "today.streak": "Σερί {n}",
      "today.play": "Παίξε",
      "today.see": "Δες",
      "today.missing": "Δεν είναι εγκατεστημένο",
      "ach.title": "Επιτεύγματα",
      "ach.note": "{n} από {k}",
      "ach.done": "Έγινε",
      "ach.progress": "{h} από {n}",
      "stats.title": "Στατιστικά",
      "stats.note": "{p} παιχνίδια · {w} νίκες",
      "stats.empty": "Δεν έχεις παίξει ακόμα σε αυτή τη συσκευή.",
      "stats.played": "Παιχνίδια",
      "stats.won": "Νίκες",
      "stats.solved": "Λυμένα",
      "stats.streak": "Σερί",
      "stats.streakV": "{c} · καλύτερο {b}",
      "stats.time": "Καλύτερος χρόνος",
      "stats.score": "Ρεκόρ",
      "stats.daily": "Ημερήσιες",
      "stats.open": "Άνοιγμα: {g}",
      "stats.unplayed": "Δεν παίχτηκαν ακόμα ({n})",
      "foot.note": "Όλα όσα βλέπεις εδώ διαβάζονται από τα δεδομένα των ίδιων των παιχνιδιών σε αυτή τη συσκευή, που συγχρονίζονται με κάθε παιχνίδι. Δεν αποθηκεύεται τίποτα επιπλέον.",
      "toast.missing": "Το «{g}» δεν είναι εγκατεστημένο. Πρόσθεσέ το από το App Store στις Ρυθμίσεις.",
      "a.first": "Πρώτη νίκη", "d.first": "Κέρδισε ή λύσε οποιοδήποτε παιχνίδι.",
      "a.daily1": "Πρώτη ημερήσια", "d.daily1": "Λύσε μια ημερήσια πρόκληση.",
      "a.streak7": "Μία εβδομάδα", "d.streak7": "Λύσε την ημερήσια πρόκληση ενός παιχνιδιού 7 μέρες στη σειρά.",
      "a.streak30": "Ένας μήνας", "d.streak30": "Λύσε την ημερήσια πρόκληση ενός παιχνιδιού 30 μέρες στη σειρά.",
      "a.sweep": "Σάρωμα", "d.sweep": "Λύσε και τις έξι ημερήσιες προκλήσεις την ίδια μέρα.",
      "a.clean": "Χωρίς βοήθεια", "d.clean": "Λύσε ημερήσιο Σουντόκου, Νονόγραμμα, Ένωσε τα χρώματα ή Σταυρόλεξο χωρίς βοήθεια.",
      "a.wordle2": "Εύστοχη μαντεψιά", "d.wordle2": "Βρες τη λέξη της ημέρας στη Λεξούλα με δύο προσπάθειες ή λιγότερες.",
      "a.killer": "Κίλερ", "d.killer": "Λύσε ένα Σουντόκου Κίλερ.",
      "a.cards": "Άσος της τράπουλας", "d.cards": "Κέρδισε Κλοντάικ, FreeCell, Αράχνη και Πυραμίδα.",
      "a.hard": "Νικητής της μηχανής", "d.hard": "Νίκησε τον υπολογιστή στο Δύσκολο σε οποιοδήποτε παιχνίδι.",
      "a.expert": "Ειδικός στις νάρκες", "d.expert": "Κέρδισε τον Ναρκαλιευτή στο επίπεδο Έμπειρος.",
      "a.speedy": "Γρήγορα δάχτυλα", "d.speedy": "Λύσε ένα Σουντόκου σε λιγότερο από 5 λεπτά.",
      "a.variety": "Πολυτεχνίτης", "d.variety": "Κέρδισε σε 10 διαφορετικά παιχνίδια.",
      "a.played100": "Θαμώνας", "d.played100": "Παίξε 100 παιχνίδια.",
      "a.wins250": "Πρωταθλητής", "d.wins250": "Κέρδισε 250 παιχνίδια."
    }
  };
  // Shown names when the shell cannot tell (standalone); the shell's
  // own names win when it can.
  var NAMES = {
    en: { wordle: "Wordle", crossword: "Crossword", sudoku: "Sudoku", nonogram: "Nonogram",
      flow: "Flow Free", minesweeper: "Minesweeper", wordsearch: "Word Search", solitaire: "Solitaire",
      mahjong: "Mahjong", jigsaw: "Jigsaw", spot: "Spot the Difference", hexagon: "Hexagon Puzzle",
      slider: "Number Slider", lightsout: "Lights Out", memory: "Memory", hangman: "Hangman",
      mastermind: "Mastermind", g2048: "2048", tetris: "Tetris", snake: "Snake", breakout: "Breakout",
      bubble: "Bubble Shooter", simon: "Simon Says", whack: "Whack-a-Mole", pong: "Pong", chess: "Chess",
      checkers: "Checkers", reversi: "Reversi", gomoku: "Gomoku", connect4: "Connect 4",
      dots: "Dots & Boxes", tictactoe: "Tic-Tac-Toe", mancala: "Mancala", backgammon: "Backgammon",
      battleship: "Battleship", rps: "Rock Paper Scissors", xeri: "Xeri" },
    el: { wordle: "Λεξούλα", crossword: "Σταυρόλεξο", sudoku: "Σουντόκου", nonogram: "Νονόγραμμα",
      flow: "Ένωσε τα χρώματα", minesweeper: "Ναρκαλιευτής", wordsearch: "Κρυπτόλεξο", solitaire: "Πασιέντζα",
      mahjong: "Μαντζόνγκ", jigsaw: "Παζλ", spot: "Βρες τις διαφορές", hexagon: "Εξάγωνα",
      slider: "Συρόμενοι αριθμοί", lightsout: "Σβήσε τα φώτα", memory: "Μνήμη", hangman: "Κρεμάλα",
      mastermind: "Σπάσε τον κωδικό", g2048: "2048", tetris: "Τέτρις", snake: "Φιδάκι", breakout: "Τουβλάκια",
      bubble: "Φούσκες", simon: "Ο Σάιμον λέει", whack: "Χτύπα τον τυφλοπόντικα", pong: "Πονγκ", chess: "Σκάκι",
      checkers: "Ντάμα", reversi: "Ρεβέρσι", gomoku: "Πέντε στη σειρά", connect4: "Τέσσερα στη σειρά",
      dots: "Τελείες & Κουτιά", tictactoe: "Τρίλιζα", mancala: "Μαγκάλα", backgammon: "Τάβλι (Πόρτες)",
      battleship: "Ναυμαχία", rps: "Πέτρα, ψαλίδι, χαρτί", xeri: "Ξερή" }
  };
  if (window.orosI18n) {
    window.orosI18n.table(STRINGS, "gamecenter", LANG);
    window.orosI18n.table(NAMES, "gamecenter", LANG);
  }
  // Puzzle games count "solved", the others "won".
  var SOLVES = { sudoku: 1, nonogram: 1, flow: 1, crossword: 1, wordsearch: 1, jigsaw: 1, spot: 1,
    hexagon: 1, slider: 1, lightsout: 1, mahjong: 1, memory: 1 };

  function t(key, vars) {
    var s = (STRINGS[LANG] && STRINGS[LANG][key]) || STRINGS.en[key] || key;
    if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? String(vars[k]) : m; });
    return s;
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function num(n) {
    try { return n.toLocaleString(loc()); } catch (e) { return String(n); }
  }
  function fmtTime(ms) {
    if (DK) return DK.fmtTime(ms);
    var s = Math.round(ms / 1000), m = Math.floor(s / 60);
    return m + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
  }
  function today() { return DK ? DK.today() : Math.round((Date.now() - Date.UTC(2026, 0, 1)) / 86400000); }

  var UI_ICONS = {
    check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    trophy: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    lock: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    arrow: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>'
  };

  // ---------- 2. Shell bridge ----------
  function shell() {
    try { return window.parent && window.parent !== window ? window.parent : null; } catch (e) { return null; }
  }
  // { id: shown name } of the installed apps, or null standalone.
  function installed() {
    try {
      var p = shell();
      if (!p || typeof p.orosAssistInstalled !== "function") return null;
      var out = {};
      p.orosAssistInstalled().forEach(function (a) { if (a && a.id) out[a.id] = String(a.name || a.id); });
      return out;
    } catch (e) { return null; }
  }
  var APPS = null;
  function nameOf(id) {
    return (APPS && APPS[id]) || (NAMES[LANG] && NAMES[LANG][id]) || NAMES.en[id] || id;
  }
  function canOpen(id) { return !!(APPS && APPS[id]); }
  function openGame(id, target) {
    if (!canOpen(id)) { showToast(t("toast.missing", { g: nameOf(id) })); return; }
    try { shell().__orosOpenAt(id, target || null); } catch (e) {}
  }

  function readJSON(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  // ---------- 3. Render ----------
  var focusGame = "";

  function render() {
    APPS = installed();
    var day = today(), sum = CORE.summarize(readJSON, day);
    renderHead(sum, day);
    renderToday(sum);
    renderAch(sum);
    renderStats(sum);
  }

  function renderHead(sum, day) {
    var date = "";
    try {
      date = new Date().toLocaleDateString(loc(),
        { weekday: "long", day: "numeric", month: "long" });
    } catch (e) { date = DK ? DK.dateStr(day) : ""; }
    var line = !sum.daily.days ? t("sub.none") :
      t(sum.daily.cur === 1 ? "sub.streak1" : "sub.streak", { n: sum.daily.cur, b: sum.daily.best });
    $("sub").textContent = date + " · " + line;
  }

  function renderToday(sum) {
    var grid = $("today-grid");
    grid.textContent = "";
    var done = 0;
    CORE.DAILY.forEach(function (id) {
      var S = sum.games[id], have = canOpen(id) || !APPS;
      if (S.today === 1) done++;
      var card = el("div", "day-card" + (S.today === 1 ? " solved" : S.today === 2 ? " lost" : ""));
      var top = el("div", "day-top");
      // One long word (German "Kreuzworträtsel"): a little smaller, so
      // it fits the card instead of breaking mid-word.
      var nm = nameOf(id);
      top.appendChild(el("span", "day-name" + (nm.length > 13 && !/\s/.test(nm) ? " long" : ""), nm));
      if (S.today === 1) {
        var ok = el("span", "day-ok");
        ok.innerHTML = UI_ICONS.check;
        top.appendChild(ok);
      }
      card.appendChild(top);
      var st = S.today === 1 ? t("today.solved") : S.today === 2 ? t("today.lost") : t("today.open");
      if (APPS && !canOpen(id)) st = t("today.missing");
      card.appendChild(el("span", "day-status", st));
      var foot = el("div", "day-foot");
      foot.appendChild(el("span", "day-streak", S.cur > 0 ? t("today.streak", { n: S.cur }) : ""));
      var b = el("button", "day-btn", S.today ? t("today.see") : t("today.play"));
      b.type = "button";
      b.disabled = !have || !APPS;
      b.setAttribute("aria-label", nameOf(id) + ": " + b.textContent);
      b.addEventListener("click", function () { openGame(id, { daily: true }); });
      foot.appendChild(b);
      card.appendChild(foot);
      grid.appendChild(card);
    });
    $("today-note").textContent = t("today.note", { n: done, k: CORE.DAILY.length });
  }

  function renderAch(sum) {
    var list = $("ach-list"), all = CORE.achievements(sum), n = 0;
    list.textContent = "";
    all.forEach(function (a) {
      if (a.done) n++;
      var li = el("li", "ach" + (a.done ? " done" : ""));
      var ico = el("span", "ach-ico");
      ico.innerHTML = a.done ? UI_ICONS.trophy : UI_ICONS.lock;
      li.appendChild(ico);
      var body = el("div", "ach-body");
      body.appendChild(el("span", "ach-name", t("a." + a.id)));
      body.appendChild(el("span", "ach-desc", t("d." + a.id)));
      if (!a.done && a.need > 1) {
        var bar = el("span", "ach-bar");
        var fill = el("span", "ach-fill");
        fill.style.width = Math.round(100 * a.have / a.need) + "%";
        bar.appendChild(fill);
        body.appendChild(bar);
      }
      li.appendChild(body);
      li.appendChild(el("span", "ach-state", a.done ? t("ach.done") :
        a.need > 1 ? t("ach.progress", { h: num(a.have), n: num(a.need) }) : ""));
      li.setAttribute("aria-label", t("a." + a.id) + ". " + t("d." + a.id) + " " +
        (a.done ? t("ach.done") : a.need > 1 ? t("ach.progress", { h: a.have, n: a.need }) : ""));
      list.appendChild(li);
    });
    $("ach-note").textContent = t("ach.note", { n: n, k: all.length });
  }

  function chip(label, value) {
    var c = el("span", "chip");
    c.appendChild(el("span", "chip-l", label));
    c.appendChild(el("strong", "chip-v", value));
    return c;
  }

  function renderStats(sum) {
    var list = $("stats-list"), played = [], unplayed = [];
    list.textContent = "";
    CORE.GAMES.forEach(function (id) {
      var S = sum.games[id];
      if (S.p > 0 || S.dn > 0) played.push(id); else unplayed.push(id);
    });
    played.sort(function (a, b) { return (sum.games[b].p - sum.games[a].p) || (CORE.GAMES.indexOf(a) - CORE.GAMES.indexOf(b)); });
    played.forEach(function (id) {
      var S = sum.games[id];
      var li = el("li", "game" + (id === focusGame ? " focus" : ""));
      li.id = "g-" + id;
      var name = el("button", "game-name");
      name.type = "button";
      name.appendChild(el("span", "", nameOf(id)));
      var ar = el("span", "game-go");
      ar.innerHTML = UI_ICONS.arrow;
      name.appendChild(ar);
      name.setAttribute("aria-label", t("stats.open", { g: nameOf(id) }));
      name.addEventListener("click", function () { openGame(id, null); });
      li.appendChild(name);
      var chips = el("div", "chips");
      chips.appendChild(chip(t("stats.played"), num(S.p)));
      if (S.w >= 0) chips.appendChild(chip(SOLVES[id] ? t("stats.solved") : t("stats.won"), num(S.w)));
      if (S.dn > 0) chips.appendChild(chip(t("stats.daily"), num(S.dn)));
      if (S.best > 0) chips.appendChild(chip(t("stats.streak"), t("stats.streakV", { c: S.cur, b: S.best })));
      if (S.t > 0) chips.appendChild(chip(t("stats.time"), fmtTime(S.t)));
      if (S.sc >= 0) chips.appendChild(chip(t("stats.score"), num(S.sc)));
      li.appendChild(chips);
      list.appendChild(li);
    });
    if (!played.length) list.appendChild(el("li", "empty", t("stats.empty")));
    $("stats-note").textContent = t("stats.note", { p: num(sum.tot.p), w: num(sum.tot.w) });
    var up = $("unplayed");
    up.hidden = !unplayed.length;
    $("unplayed-sum").textContent = t("stats.unplayed", { n: unplayed.length });
    $("unplayed-list").textContent = unplayed.map(nameOf).join(" · ");
  }

  function focusOn(id) {
    if (typeof id !== "string" || CORE.GAMES.indexOf(id) < 0) return;
    focusGame = id;
    render();
    var row = $("g-" + id);
    if (row) {
      try { row.scrollIntoView({ block: "center" }); } catch (e) { row.scrollIntoView(); }
      var b = row.querySelector(".game-name");
      if (b) b.focus({ preventScroll: true });
    }
  }

  // ---------- Toast ----------
  var toastTimer = null;
  function showToast(msg) {
    var n = $("toast");
    n.textContent = msg;
    n.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { n.classList.remove("show"); }, 3200);
  }

  // ---------- 4. Palette + Contract Β ----------
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
  }

  // ---------- 5. Wiring & boot ----------
  function applyI18n() {
    document.documentElement.lang = LANG;
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    document.title = t("app.name") + " · orOS";
  }

  var renderTimer = null;
  function renderSoon() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 150);
  }

  function boot() {
    applyI18n();
    inheritPalette();
    watchPalette();
    wireKeyboard();
    render();
    // A game's data changed (synced in, or the game was played in
    // another window): the numbers follow.
    window.addEventListener("storage", function (e) {
      if (!e.key || /^oros-[a-z0-9]+-data$/.test(e.key) || e.key === "oros-lang") renderSoon();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") render();
    });
    window.addEventListener("focus", renderSoon);
    // { game } scrolls to its row; { play, daily? } (orOS Games icon
    // shortcuts) opens that game, straight into its Daily if asked.
    function openTarget(tg) {
      if (!tg || typeof tg !== "object") return;
      if (typeof tg.play === "string" && CORE.GAMES.indexOf(tg.play) >= 0) {
        openGame(tg.play, tg.daily === true && CORE.DAILY.indexOf(tg.play) >= 0 ? { daily: true } : null);
      } else if (tg.game) focusOn(tg.game);
    }
    window.__orosOpenAt = openTarget;
    openTarget(DK ? DK.takeTarget("gamecenter") : null);
  }

  boot();
})();
