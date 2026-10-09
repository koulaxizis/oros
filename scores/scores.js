// ============================================================
// orOS Score Keeper — App logic (v1.0.0)
// The score sheet for games played at the table: backgammon,
// prefa, xeri, biriba, poker chips or anything else.
//   - a match = 2–8 players or teams, an optional target, rounds
//     of points (negative allowed); totals, leader, winner
//   - ready templates (editable: a saved copy replaces the ready
//     one) and your own templates
//   - history of finished matches, wins per player and game
//   - optional round timer (this device only), CSV export
// Data:
//   - synced slice "scores" (oros-scores-data): matches, rounds,
//     templates and players, each LWW by mtime + tombstones
//     (R5, R17, R26). Rounds are their own entities, so two
//     devices adding rounds to one match both keep theirs.
//   - device-local (R10): oros-scores-prefs (tab, open match,
//     unsent entry, timer)
// Sections:
//   1. Constants, i18n, helpers
//   2. Model: normalize, ready templates
//   3. Merge
//   4. Score math: totals, winners, stats, CSV
//   5. Storage + prefs
//   6. Home: open matches, history, stats
//   7. Match: sheet, entry, timer
//   8. Dialogs: new match, round, match menu, edit match
//   9. Toasts, export
//  10. Keyboard (Contract Β)
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-scores-data";
  var PREFS_KEY   = "oros-scores-prefs";
  var DATA_VER    = 1;
  var MIN_SEATS   = 2;
  var MAX_SEATS   = 8;
  var NAME_LEN    = 40;
  var SEAT_LEN    = 24;
  var MAX_SCORE   = 1000000;
  var MAX_QUICK   = 4;
  var MAX_MATCHES = 1000;
  var MAX_ROUNDS  = 500;           // per match
  var MAX_TPLS    = 40;
  var MAX_PLAYERS = 200;
  var LISTS       = ["matches", "rounds", "tpls", "players"];
  var PCOLORS = ["#e85d75", "#3a86ff", "#f1c453", "#2ec4b6", "#c86bfa", "#f29e4c", "#8bc34a", "#ff7eb6"];
  var TIMER_LENS = [15, 30, 45, 60, 90, 120, 180, 300, 600];

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
      "app": "Score Keeper",
      "tab.play": "Playing", "tab.hist": "History", "tab.stats": "Stats",
      "btn.new": "New match", "btn.back": "Back", "btn.menu": "Match options", "btn.timer": "Round timer",
      "home.empty": "No match in progress.",
      "hist.empty": "Finished matches show up here.", "hist.csv": "Export CSV",
      "stats.game": "Game", "stats.all": "All games", "stats.empty": "Finish a match to see who wins most.",
      "stats.player": "Player", "stats.played": "Played", "stats.wins": "Wins", "stats.rate": "Win %",
      "stats.forget": "Forget {name}", "stats.forgot": "{name} removed from the suggestions",
      "card.rounds": "{n} rounds", "card.round1": "1 round", "card.target": "to {n}", "card.low": "lowest wins",
      "card.won": "Won by {w}", "card.tie": "Tie: {w}",
      "sheet.round": "#", "sheet.total": "Total", "sheet.need": "{n} to go", "sheet.empty": "No rounds yet. Write the points below.",
      "entry.add": "Add round", "entry.ph": "0", "entry.sign": "Change sign for {name}",
      "entry.quick": "Add {n} to {name}", "entry.aria": "Points for {name}",
      "entry.none": "Write points for at least one player", "entry.bad": "“{v}” is not a whole number",
      "entry.max": "Up to {n} rounds per match",
      "info.target": "Target {n}", "info.free": "No target", "info.low": "Lowest wins", "info.done": "Finished",
      "timer.go": "Start", "timer.pause": "Pause", "timer.reset": "Reset", "timer.len": "Timer length",
      "timer.end": "Time is up",
      "dlg.newTitle": "New match", "dlg.game": "Game", "dlg.name": "Name", "dlg.players": "Players or teams",
      "dlg.player": "Player {n}", "dlg.more": "Add player", "dlg.less": "Remove player {n}",
      "dlg.target": "Target (0 = no target)", "dlg.low": "Lowest total wins",
      "dlg.quick": "Quick buttons (up to 4, e.g. 1, 5, 10)", "dlg.saveTpl": "Save as my template",
      "dlg.start": "Start", "dlg.cancel": "Cancel", "dlg.save": "Save", "dlg.delete": "Delete",
      "dlg.close": "Close", "dlg.tplDel": "Delete template {name}", "dlg.mine": "Mine",
      "dlg.roundTitle": "Round {n}", "dlg.editTitle": "Edit match",
      "dlg.seatsFixed": "The number of players is fixed once the match starts.",
      "menu.edit": "Edit match", "menu.finish": "Finish match", "menu.reopen": "Reopen match",
      "menu.csv": "Export CSV", "menu.delete": "Delete match",
      "win.title": "We have a winner", "win.tie": "It's a tie", "win.finish": "Finish match", "win.go": "Keep playing",
      "win.pts": "{n} points",
      "toast.added": "Round {n} added", "toast.undo": "Undo", "toast.deleted": "Match deleted",
      "toast.roundDel": "Round deleted", "toast.save": "Could not save: storage is full",
      "toast.needName": "Give the match a name", "toast.needSeat": "Every player needs a name",
      "toast.dupSeat": "Two players have the same name", "toast.maxTpl": "Up to {n} templates",
      "toast.tplSaved": "Template saved", "toast.tplDel": "Template deleted", "toast.finished": "Match finished",
      "toast.reopened": "Match reopened", "toast.exported": "Exported", "toast.nothing": "Nothing to export yet",
      "toast.maxMatches": "Up to {n} matches: delete some old ones first",
      "live.round": "Round {n}: {pts}", "live.leader": "{w} leads",
      "csv.date": "Date", "csv.game": "Game", "csv.player": "Player", "csv.total": "Total", "csv.winner": "Winner",
      "csv.round": "Round", "csv.yes": "yes", "csv.no": "no", "csv.file": "scores",
      "tpl.tavli": "Backgammon", "tpl.prefa": "Prefa", "tpl.xeri": "Xeri", "tpl.biriba": "Biriba",
      "tpl.poker": "Poker (chips)", "tpl.free": "Free scoring",
      "seat.default": "Player {n}"
    },
    el: {
      "app": "Μετρητής πόντων",
      "tab.play": "Σε εξέλιξη", "tab.hist": "Ιστορικό", "tab.stats": "Στατιστικά",
      "btn.new": "Νέα παρτίδα", "btn.back": "Πίσω", "btn.menu": "Επιλογές παρτίδας", "btn.timer": "Χρονόμετρο γύρου",
      "home.empty": "Καμία παρτίδα σε εξέλιξη.",
      "hist.empty": "Εδώ εμφανίζονται οι παρτίδες που τελείωσαν.", "hist.csv": "Εξαγωγή CSV",
      "stats.game": "Παιχνίδι", "stats.all": "Όλα τα παιχνίδια", "stats.empty": "Τελείωσε μια παρτίδα για να δεις ποιος κερδίζει συχνότερα.",
      "stats.player": "Παίκτης", "stats.played": "Παρτίδες", "stats.wins": "Νίκες", "stats.rate": "% νικών",
      "stats.forget": "Αφαίρεση: {name}", "stats.forgot": "Το «{name}» βγήκε από τις προτάσεις",
      "card.rounds": "{n} γύροι", "card.round1": "1 γύρος", "card.target": "ως τους {n}", "card.low": "κερδίζει ο μικρότερος",
      "card.won": "Νίκη: {w}", "card.tie": "Ισοπαλία: {w}",
      "sheet.round": "#", "sheet.total": "Σύνολο", "sheet.need": "λείπουν {n}", "sheet.empty": "Κανένας γύρος ακόμα. Γράψε τους πόντους από κάτω.",
      "entry.add": "Προσθήκη γύρου", "entry.ph": "0", "entry.sign": "Αλλαγή προσήμου: {name}",
      "entry.quick": "Πρόσθεσε {n} στον/στην {name}", "entry.aria": "Πόντοι: {name}",
      "entry.none": "Γράψε πόντους για έναν παίκτη τουλάχιστον", "entry.bad": "Το «{v}» δεν είναι ακέραιος αριθμός",
      "entry.max": "Έως {n} γύροι ανά παρτίδα",
      "info.target": "Στόχος {n}", "info.free": "Χωρίς στόχο", "info.low": "Κερδίζει ο μικρότερος", "info.done": "Τελείωσε",
      "timer.go": "Έναρξη", "timer.pause": "Παύση", "timer.reset": "Μηδενισμός", "timer.len": "Διάρκεια",
      "timer.end": "Τέλος χρόνου",
      "dlg.newTitle": "Νέα παρτίδα", "dlg.game": "Παιχνίδι", "dlg.name": "Όνομα", "dlg.players": "Παίκτες ή ομάδες",
      "dlg.player": "Παίκτης {n}", "dlg.more": "Προσθήκη παίκτη", "dlg.less": "Αφαίρεση παίκτη {n}",
      "dlg.target": "Στόχος (0 = χωρίς στόχο)", "dlg.low": "Κερδίζει το μικρότερο σύνολο",
      "dlg.quick": "Γρήγορα κουμπιά (έως 4, π.χ. 1, 5, 10)", "dlg.saveTpl": "Αποθήκευση ως δικό μου πρότυπο",
      "dlg.start": "Ξεκίνα", "dlg.cancel": "Άκυρο", "dlg.save": "Αποθήκευση", "dlg.delete": "Διαγραφή",
      "dlg.close": "Κλείσιμο", "dlg.tplDel": "Διαγραφή προτύπου {name}", "dlg.mine": "Δικά μου",
      "dlg.roundTitle": "Γύρος {n}", "dlg.editTitle": "Επεξεργασία παρτίδας",
      "dlg.seatsFixed": "Ο αριθμός των παικτών δεν αλλάζει αφού ξεκινήσει η παρτίδα.",
      "menu.edit": "Επεξεργασία παρτίδας", "menu.finish": "Τέλος παρτίδας", "menu.reopen": "Άνοιγμα ξανά",
      "menu.csv": "Εξαγωγή CSV", "menu.delete": "Διαγραφή παρτίδας",
      "win.title": "Έχουμε νικητή", "win.tie": "Ισοπαλία", "win.finish": "Τέλος παρτίδας", "win.go": "Συνεχίζουμε",
      "win.pts": "{n} πόντοι",
      "toast.added": "Ο γύρος {n} μπήκε", "toast.undo": "Αναίρεση", "toast.deleted": "Η παρτίδα διαγράφηκε",
      "toast.roundDel": "Ο γύρος διαγράφηκε", "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "toast.needName": "Δώσε ένα όνομα στην παρτίδα", "toast.needSeat": "Κάθε παίκτης θέλει όνομα",
      "toast.dupSeat": "Δύο παίκτες έχουν το ίδιο όνομα", "toast.maxTpl": "Έως {n} πρότυπα",
      "toast.tplSaved": "Το πρότυπο αποθηκεύτηκε", "toast.tplDel": "Το πρότυπο διαγράφηκε", "toast.finished": "Η παρτίδα τελείωσε",
      "toast.reopened": "Η παρτίδα άνοιξε ξανά", "toast.exported": "Η εξαγωγή έγινε", "toast.nothing": "Δεν υπάρχει τίποτα για εξαγωγή ακόμα",
      "toast.maxMatches": "Έως {n} παρτίδες: σβήσε πρώτα μερικές παλιές",
      "live.round": "Γύρος {n}: {pts}", "live.leader": "Προηγείται: {w}",
      "csv.date": "Ημερομηνία", "csv.game": "Παιχνίδι", "csv.player": "Παίκτης", "csv.total": "Σύνολο", "csv.winner": "Νικητής",
      "csv.round": "Γύρος", "csv.yes": "ναι", "csv.no": "όχι", "csv.file": "pontoi",
      "tpl.tavli": "Τάβλι", "tpl.prefa": "Πρέφα", "tpl.xeri": "Ξερή", "tpl.biriba": "Μπιρίμπα",
      "tpl.poker": "Πόκα (μάρκες)", "tpl.free": "Ελεύθερο",
      "seat.default": "Παίκτης {n}"
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

  function newId() {
    var r = new Uint32Array(2);
    crypto.getRandomValues(r);
    return Date.now().toString(36) + r[0].toString(36) + r[1].toString(36).slice(0, 4);
  }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("scores.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Model ----------
  // match  = { id, m, c (created), name, tpl, seats[2..8], target (0 = none),
  //            low (0|1), quick[0..4], done (0 | finished at) }
  // round  = { id, m, g (match id), c (created: the order), s[int per seat] }
  // tpl    = { id, m, name, target, low, quick[], seats (count), base ("" | ready id it replaces) }
  // player = { id, m, name, col (0..7) }
  // data   = { ver, matches[], rounds[], tpls[], players[] (each sorted by id),
  //            tombs { id: deletedAt } }
  var ID_RE  = /^[a-z0-9]{6,40}$/;
  var TPL_RE = /^[a-z0-9]{0,40}$/;

  function normText(s, max) {
    return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "";
  }
  function normScore(v) {
    return isInt(v) && Math.abs(v) <= MAX_SCORE ? v : 0;
  }
  function normQuick(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (v) {
      if (isInt(v) && v !== 0 && Math.abs(v) <= 1000 && out.indexOf(v) < 0 && out.length < MAX_QUICK) out.push(v);
    });
    return out;
  }
  function normTarget(v) { return isInt(v) && v > 0 && v <= MAX_SCORE ? v : 0; }
  function base(x) {
    return x && typeof x === "object" && typeof x.id === "string" && ID_RE.test(x.id) &&
           isInt(x.m) && x.m >= 0;
  }

  function normMatch(x) {
    if (!base(x)) return null;
    var name = normText(x.name, NAME_LEN);
    if (!name || !Array.isArray(x.seats)) return null;
    var seats = x.seats.slice(0, MAX_SEATS).map(function (s) { return normText(s, SEAT_LEN); });
    if (seats.length < MIN_SEATS || seats.some(function (s) { return !s; })) return null;
    return {
      id: x.id, m: x.m, c: isInt(x.c) && x.c >= 0 ? x.c : x.m, name: name,
      tpl: typeof x.tpl === "string" && TPL_RE.test(x.tpl) ? x.tpl : "",
      seats: seats, target: normTarget(x.target), low: x.low === 1 ? 1 : 0,
      quick: normQuick(x.quick), done: isInt(x.done) && x.done > 0 ? x.done : 0
    };
  }
  function normRound(x) {
    if (!base(x) || typeof x.g !== "string" || !ID_RE.test(x.g) || !Array.isArray(x.s) ||
        x.s.length < 1 || x.s.length > MAX_SEATS) return null;
    return { id: x.id, m: x.m, g: x.g, c: isInt(x.c) && x.c >= 0 ? x.c : x.m, s: x.s.map(normScore) };
  }
  function normTpl(x) {
    if (!base(x)) return null;
    var name = normText(x.name, NAME_LEN);
    if (!name) return null;
    var seats = isInt(x.seats) ? Math.max(MIN_SEATS, Math.min(MAX_SEATS, x.seats)) : MIN_SEATS;
    return {
      id: x.id, m: x.m, name: name, target: normTarget(x.target), low: x.low === 1 ? 1 : 0,
      quick: normQuick(x.quick), seats: seats,
      base: typeof x.base === "string" && READY_IDS.indexOf(x.base) >= 0 ? x.base : ""
    };
  }
  function normPlayer(x) {
    if (!base(x)) return null;
    var name = normText(x.name, SEAT_LEN);
    if (!name) return null;
    return { id: x.id, m: x.m, name: name, col: isInt(x.col) && x.col >= 0 && x.col < PCOLORS.length ? x.col : 0 };
  }
  var NORM = { matches: normMatch, rounds: normRound, tpls: normTpl, players: normPlayer };

  // Ready templates: not synced; a saved template with `base` set
  // replaces the ready one of that id.
  var READY_IDS = ["tavli", "prefa", "xeri", "biriba", "poker", "free"];
  var READY = {
    tavli:  { target: 5,    low: 0, quick: [1, 2, 3],   seats: 2 },
    prefa:  { target: 0,    low: 0, quick: [],          seats: 3 },
    xeri:   { target: 51,   low: 0, quick: [10, 20],    seats: 2 },
    biriba: { target: 1500, low: 0, quick: [],          seats: 2 },
    poker:  { target: 0,    low: 0, quick: [5, 10, 25], seats: 4 },
    free:   { target: 0,    low: 0, quick: [],          seats: 2 }
  };
  function readyTpl(id) {
    var r = READY[id];
    return { id: id, ready: true, name: t("tpl." + id), target: r.target, low: r.low,
             quick: r.quick.slice(), seats: r.seats, base: "" };
  }
  // The template list the new-match dialog shows: ready ones (or the
  // saved copy replacing them), then the user's own.
  function allTemplates(d) {
    var over = {}, own = [];
    d.tpls.forEach(function (x) { if (x.base) over[x.base] = x; else own.push(x); });
    var list = READY_IDS.map(function (id) { return over[id] || readyTpl(id); });
    own.sort(function (a, b) { return cmpStr(a.name.toLowerCase(), b.name.toLowerCase()) || cmpStr(a.id, b.id); });
    return list.concat(own);
  }

  // ---------- 3. Merge ----------
  // Per entity LWW (newer m wins; equal m: the larger canonical
  // JSON), tombstones max-merged, delete wins ties, a newer edit
  // resurrects (R17). Rounds of a deleted match that is gone go too.
  // Symmetric, idempotent and canonical (R5, R26).
  function emptyData() { return { ver: DATA_VER, matches: [], rounds: [], tpls: [], players: [], tombs: {} }; }

  function mergeScores(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object") return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    var out = emptyData();
    LISTS.forEach(function (key) {
      var best = {};
      [a[key], b[key]].forEach(function (list) {
        if (!Array.isArray(list)) return;
        list.forEach(function (raw) {
          var x = NORM[key](raw);
          if (!x) return;
          var cur = best[x.id];
          if (!cur || x.m > cur.m ||
              (x.m === cur.m && JSON.stringify(x) > JSON.stringify(cur))) best[x.id] = x;
        });
      });
      Object.keys(best).sort(cmpStr).forEach(function (id) {
        if (id in tombs && tombs[id] >= best[id].m) return;
        out[key].push(best[id]);
      });
    });
    var live = {};
    out.matches.forEach(function (x) { live[x.id] = 1; });
    out.rounds = out.rounds.filter(function (r) { return live[r.g] || !(r.g in tombs); });
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { out.tombs[id] = tombs[id]; });
    return out;
  }

  // ---------- 4. Score math ----------
  function roundsOf(d, gid) {
    return d.rounds.filter(function (r) { return r.g === gid; })
      .sort(function (x, y) { return x.c - y.c || cmpStr(x.id, y.id); });
  }
  function totalsOf(match, rounds) {
    var tot = match.seats.map(function () { return 0; });
    rounds.forEach(function (r) {
      for (var i = 0; i < tot.length; i++) tot[i] += (i < r.s.length ? r.s[i] : 0);
    });
    return tot;
  }
  // { totals, best: [seat indices in the lead], reached: target hit }
  function standing(match, rounds) {
    var tot = totalsOf(match, rounds);
    var bestVal = match.low ? Math.min.apply(null, tot) : Math.max.apply(null, tot);
    var best = [];
    tot.forEach(function (v, i) { if (v === bestVal) best.push(i); });
    var reached = match.target > 0 && tot.some(function (v) { return v >= match.target; });
    return { totals: tot, best: rounds.length ? best : [], reached: reached };
  }
  function nameKey(s) { return normText(s, SEAT_LEN).toLocaleLowerCase(); }

  // Wins per player over finished matches (all games or one game).
  // A tie counts as a win for every player who shares the lead.
  function statsOf(d, game) {
    var rows = {};
    d.matches.forEach(function (mt) {
      if (!mt.done) return;
      if (game && nameKey(mt.name) !== game) return;
      var st = standing(mt, roundsOf(d, mt.id));
      mt.seats.forEach(function (s, i) {
        var k = nameKey(s);
        var r = rows[k] || (rows[k] = { name: s, played: 0, wins: 0 });
        r.played++;
        if (st.best.indexOf(i) >= 0) r.wins++;
      });
    });
    return Object.keys(rows).map(function (k) { return rows[k]; })
      .sort(function (x, y) { return y.wins - x.wins || x.played - y.played || cmpStr(x.name, y.name); });
  }
  function gamesPlayed(d) {
    var seen = {}, out = [];
    d.matches.forEach(function (mt) {
      if (!mt.done) return;
      var k = nameKey(mt.name);
      if (!seen[k]) { seen[k] = 1; out.push({ key: k, name: mt.name }); }
    });
    return out.sort(function (x, y) { return cmpStr(x.key, y.key); });
  }

  // Score entry: "", "5", "-5", "+5", "−5" (U+2212). null = invalid.
  function parsePts(s) {
    s = String(s == null ? "" : s).replace(/\s+/g, "").replace(/−/g, "-");
    if (s === "") return 0;
    if (!/^[+-]?\d{1,7}$/.test(s)) return null;
    var v = parseInt(s, 10);
    return Math.abs(v) <= MAX_SCORE ? v : null;
  }

  // CSV: every text cell quoted; text starting with = + - @ tab or CR
  // gets a leading apostrophe (no formula injection); numbers raw.
  function csvCell(v) {
    if (typeof v === "number") return String(v);
    var s = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function csvLines(rows) {
    return "﻿" + rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n") + "\r\n";
  }
  function matchCsv(match, rounds) {
    var rows = [[t("csv.round")].concat(match.seats)];
    rounds.forEach(function (r, i) {
      rows.push([i + 1].concat(match.seats.map(function (_, k) { return k < r.s.length ? r.s[k] : 0; })));
    });
    rows.push([t("csv.total")].concat(totalsOf(match, rounds)));
    return csvLines(rows);
  }
  function historyCsv(d, fmtDate) {
    var rows = [[t("csv.date"), t("csv.game"), t("csv.player"), t("csv.total"), t("csv.winner")]];
    d.matches.filter(function (mt) { return mt.done; })
      .sort(function (x, y) { return x.done - y.done || cmpStr(x.id, y.id); })
      .forEach(function (mt) {
        var st = standing(mt, roundsOf(d, mt.id));
        mt.seats.forEach(function (s, i) {
          rows.push([fmtDate(mt.done), mt.name, s, st.totals[i], t(st.best.indexOf(i) >= 0 ? "csv.yes" : "csv.no")]);
        });
      });
    return csvLines(rows);
  }

  // ---------- 5. Storage + prefs ----------
  var data = null, prefs = null;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.matches)) {
          data = mergeScores(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] scores: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = emptyData();
  }

  var saveFailShown = false;
  function saveNow() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }
  function commit() {
    data = mergeScores(data, data);
    saveNow();
    renderAll();
  }
  function stamp(x) { x.m = Math.max(Date.now(), (x.m || 0) + 1); return x; }
  function tomb(id, m) {
    var at = Math.max(Date.now(), (m || 0));
    if (!(id in data.tombs) || data.tombs[id] < at) data.tombs[id] = at;
  }

  // prefs = { tab, cur, draft: { g, v[] }, timer: { on, len } }
  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    p = (p && typeof p === "object") ? p : {};
    var tm = p.timer && typeof p.timer === "object" ? p.timer : {};
    var dr = p.draft && typeof p.draft === "object" && typeof p.draft.g === "string" && Array.isArray(p.draft.v) ? p.draft : null;
    prefs = {
      tab: ["play", "hist", "stats"].indexOf(p.tab) >= 0 ? p.tab : "play",
      cur: typeof p.cur === "string" && ID_RE.test(p.cur) ? p.cur : null,
      draft: dr ? { g: dr.g, v: dr.v.slice(0, MAX_SEATS).map(function (s) { return typeof s === "string" ? s.slice(0, 9) : ""; }) } : null,
      timer: { on: tm.on === 1 ? 1 : 0, len: TIMER_LENS.indexOf(tm.len) >= 0 ? tm.len : 60 },
      game: typeof p.game === "string" ? p.game.slice(0, SEAT_LEN) : ""
    };
  }
  var prefsTimer = null;
  function savePrefs() { clearTimeout(prefsTimer); prefsTimer = setTimeout(savePrefsNow, 300); }
  function savePrefsNow() {
    clearTimeout(prefsTimer); prefsTimer = null;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  function findIn(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function curMatch() { return prefs.cur ? findIn(data.matches, prefs.cur) : null; }

  function fmtDate(ms) {
    var d = new Date(ms);
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear();
  }
  function fmtNum(v) {
    return (v < 0 ? "−" : "") + Math.abs(v).toLocaleString(LANG === "el" ? "el-GR" : "en-GB");
  }
  function seatColor(name) {
    var k = nameKey(name);
    for (var i = 0; i < data.players.length; i++) {
      if (nameKey(data.players[i].name) === k) return PCOLORS[data.players[i].col];
    }
    return null;
  }

  // ---------- UI icons ----------
  var UI = {
    plus:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    back:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    menu:  '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>',
    timer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>',
    play:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l12-7.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
    reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    crown: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5z"/></svg>',
    x:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>'
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function iconBtn(cls, svg, label, fn) {
    var b = el("button", cls);
    b.type = "button";
    b.innerHTML = svg;                   // static icon markup only
    b.setAttribute("aria-label", label);
    b.title = label;
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function dot(color) {
    var d = el("span", "dot");
    if (color) d.style.background = color;
    return d;
  }

  // ---------- 6. Home ----------
  function renderAll() {
    var mt = curMatch();
    if (prefs.cur && !mt) { prefs.cur = null; savePrefs(); }
    $("home").hidden = !!mt;
    $("match").hidden = !mt;
    $("back-btn").hidden = !mt;
    $("menu-btn").hidden = !mt;
    $("timer-btn").hidden = !mt;
    $("new-btn").hidden = !!mt;
    $("title").textContent = mt ? mt.name : t("app");
    if (mt) renderMatch(mt); else renderHome();
  }

  function renderHome() {
    ["play", "hist", "stats"].forEach(function (k) {
      var on = prefs.tab === k;
      var tb = $("tab-" + k);
      tb.setAttribute("aria-selected", on ? "true" : "false");
      tb.tabIndex = on ? 0 : -1;
      tb.classList.toggle("on", on);
      $("pane-" + k).hidden = !on;
    });
    if (prefs.tab === "play") renderOpen();
    else if (prefs.tab === "hist") renderHist();
    else renderStats();
  }

  function matchCard(mt) {
    var rs = roundsOf(data, mt.id), st = standing(mt, rs);
    var card = el("button", "card");
    card.type = "button";
    var head = el("div", "card-head");
    head.appendChild(el("span", "card-name", mt.name));
    head.appendChild(el("span", "card-meta", mt.done ? fmtDate(mt.done) :
      (rs.length === 1 ? t("card.round1") : t("card.rounds", { n: rs.length }))));
    card.appendChild(head);
    var seats = el("div", "card-seats");
    mt.seats.forEach(function (s, i) {
      var chip = el("span", "card-seat" + (st.best.indexOf(i) >= 0 ? " lead" : ""));
      chip.appendChild(dot(seatColor(s)));
      chip.appendChild(el("span", "cs-name", s));
      chip.appendChild(el("b", "cs-pts", fmtNum(st.totals[i])));
      seats.appendChild(chip);
    });
    card.appendChild(seats);
    var sub = [];
    if (mt.target) sub.push(t("card.target", { n: fmtNum(mt.target) }));
    if (mt.low) sub.push(t("card.low"));
    if (mt.done && st.best.length) {
      var names = st.best.map(function (i) { return mt.seats[i]; }).join(", ");
      sub.push(t(st.best.length > 1 ? "card.tie" : "card.won", { w: names }));
    }
    if (sub.length) card.appendChild(el("div", "card-sub", sub.join(" · ")));
    card.addEventListener("click", function () { openMatch(mt.id); });
    return card;
  }

  function renderOpen() {
    var box = $("open-list");
    box.textContent = "";
    var list = data.matches.filter(function (x) { return !x.done; })
      .sort(function (x, y) { return lastTouch(y) - lastTouch(x) || cmpStr(x.id, y.id); });
    list.forEach(function (mt) { box.appendChild(matchCard(mt)); });
    $("empty-play").hidden = list.length > 0;
  }
  function lastTouch(mt) {
    var m = mt.m;
    data.rounds.forEach(function (r) { if (r.g === mt.id && r.m > m) m = r.m; });
    return m;
  }

  function renderHist() {
    var box = $("hist-list");
    box.textContent = "";
    var list = data.matches.filter(function (x) { return x.done; })
      .sort(function (x, y) { return y.done - x.done || cmpStr(x.id, y.id); });
    list.forEach(function (mt) { box.appendChild(matchCard(mt)); });
    $("empty-hist").hidden = list.length > 0;
    $("csv-all").hidden = !list.length;
  }

  function renderStats() {
    var games = gamesPlayed(data);
    var sel = $("stats-game");
    sel.textContent = "";
    var all = el("option", "", t("stats.all"));
    all.value = "";
    sel.appendChild(all);
    var found = false;
    games.forEach(function (g) {
      var o = el("option", "", g.name);
      o.value = g.key;
      if (g.key === prefs.game) found = true;
      sel.appendChild(o);
    });
    if (!found) prefs.game = "";
    sel.value = prefs.game;
    var rows = statsOf(data, prefs.game);
    var wrap = $("stats-wrap");
    wrap.textContent = "";
    $("empty-stats").hidden = rows.length > 0;
    sel.parentNode.hidden = !games.length;
    if (!rows.length) return;
    var tb = el("table", "stats");
    var hr = el("tr");
    ["stats.player", "stats.played", "stats.wins", "stats.rate"].forEach(function (k, i) {
      var th = el("th", i ? "num" : "", t(k));
      th.scope = "col";
      hr.appendChild(th);
    });
    hr.appendChild(el("th", ""));
    var thead = el("thead");
    thead.appendChild(hr);
    tb.appendChild(thead);
    var body = el("tbody");
    rows.forEach(function (r, idx) {
      var tr = el("tr", idx === 0 && r.wins ? "top" : "");
      var name = el("td", "st-name");
      name.appendChild(dot(seatColor(r.name)));
      name.appendChild(el("span", "", r.name));
      tr.appendChild(name);
      tr.appendChild(el("td", "num", String(r.played)));
      tr.appendChild(el("td", "num", String(r.wins)));
      tr.appendChild(el("td", "num", Math.round(100 * r.wins / r.played) + "%"));
      var act = el("td", "act");
      var p = playerByName(r.name);
      if (p) act.appendChild(iconBtn("mini danger", UI.x, t("stats.forget", { name: r.name }), function () { forgetPlayer(p); }));
      tr.appendChild(act);
      body.appendChild(tr);
    });
    tb.appendChild(body);
    wrap.appendChild(tb);
  }
  function playerByName(name) {
    var k = nameKey(name);
    for (var i = 0; i < data.players.length; i++) if (nameKey(data.players[i].name) === k) return data.players[i];
    return null;
  }
  // Forgetting a player only drops the suggestion and colour; the
  // matches keep their names.
  function forgetPlayer(p) {
    tomb(p.id, p.m);
    commit();
    showToast(t("stats.forgot", { name: p.name }));
  }

  function openMatch(id) {
    prefs.cur = id;
    savePrefs();
    renderAll();
    var first = document.querySelector("#entry-row input");
    if (first && !window.matchMedia("(pointer: coarse)").matches) first.focus();
  }
  function goHome() {
    stopTimer(true);
    prefs.cur = null;
    savePrefs();
    renderAll();
  }

  // ---------- 7. Match ----------
  function renderMatch(mt) {
    var rs = roundsOf(data, mt.id), st = standing(mt, rs);
    // info line
    var info = $("match-info");
    info.textContent = "";
    info.appendChild(el("span", "pill", mt.target ? t("info.target", { n: fmtNum(mt.target) }) : t("info.free")));
    if (mt.low) info.appendChild(el("span", "pill", t("info.low")));
    if (mt.done) info.appendChild(el("span", "pill done", t("info.done")));
    // sheet
    var tb = $("sheet");
    tb.textContent = "";
    var thead = el("thead"), hr = el("tr");
    var corner = el("th", "rn", t("sheet.round"));
    corner.scope = "col";
    hr.appendChild(corner);
    mt.seats.forEach(function (s, i) {
      var th = el("th", "seat" + (st.best.indexOf(i) >= 0 ? " lead" : ""));
      th.scope = "col";
      var inner = el("span", "seat-in");
      inner.appendChild(dot(seatColor(s)));
      inner.appendChild(el("span", "seat-name", s));
      if (st.best.indexOf(i) >= 0 && (mt.done || st.reached)) {
        var cr = el("span", "crown");
        cr.innerHTML = UI.crown;
        inner.appendChild(cr);
      }
      th.appendChild(inner);
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    tb.appendChild(thead);
    var body = el("tbody");
    if (!rs.length) {
      var er = el("tr", "empty-row"), ec = el("td", "", t("sheet.empty"));
      ec.colSpan = mt.seats.length + 1;
      er.appendChild(ec);
      body.appendChild(er);
    }
    rs.forEach(function (r, ri) {
      var tr = el("tr", "rrow");
      tr.tabIndex = 0;
      tr.setAttribute("role", "button");
      tr.setAttribute("aria-label", t("dlg.roundTitle", { n: ri + 1 }));
      tr.appendChild(el("td", "rn", String(ri + 1)));
      mt.seats.forEach(function (_, i) {
        var v = i < r.s.length ? r.s[i] : 0;
        tr.appendChild(el("td", "pts" + (v < 0 ? " neg" : "") + (v === 0 ? " zero" : ""), fmtNum(v)));
      });
      var open = function () { roundDialog(mt, r, ri + 1); };
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
      body.appendChild(tr);
    });
    tb.appendChild(body);
    var tfoot = el("tfoot"), fr = el("tr");
    var th0 = el("th", "rn", "Σ");
    th0.scope = "row";
    th0.setAttribute("aria-label", t("sheet.total"));
    fr.appendChild(th0);
    mt.seats.forEach(function (_, i) {
      var td = el("td", "tot" + (st.best.indexOf(i) >= 0 ? " lead" : ""));
      td.appendChild(el("b", "", fmtNum(st.totals[i])));
      if (mt.target && !mt.low && !mt.done && st.totals[i] < mt.target) {
        td.appendChild(el("small", "", t("sheet.need", { n: fmtNum(mt.target - st.totals[i]) })));
      }
      fr.appendChild(td);
    });
    tfoot.appendChild(fr);
    tb.appendChild(tfoot);
    tb.style.setProperty("--cols", mt.seats.length);
    renderEntry(mt);
    renderTimer();
    // keep the newest round in view
    var wrap = $("sheet-wrap");
    if (wrap.dataset.g !== mt.id || wrap.dataset.n !== String(rs.length)) {
      wrap.dataset.g = mt.id;
      wrap.dataset.n = String(rs.length);
      wrap.scrollTop = wrap.scrollHeight;
    }
  }

  // The entry row: one field per seat (+ quick buttons). Kept as a
  // draft in prefs while you type, so closing the app loses nothing.
  var entryFor = null;
  function renderEntry(mt) {
    var entry = $("entry");
    entry.hidden = !!mt.done;
    if (mt.done) return;
    var row = $("entry-row");
    var vals = draftVals(mt);
    // rebuild only when the match or its seats changed (keeps focus while syncing)
    var sig = mt.id + "|" + mt.seats.join("\u0001") + "|" + mt.quick.join(",");
    if (entryFor === sig) {
      [].forEach.call(row.querySelectorAll("input"), function (inp, i) {
        if (document.activeElement !== inp && inp.value !== (vals[i] || "")) inp.value = vals[i] || "";
      });
      return;
    }
    entryFor = sig;
    row.textContent = "";
    row.style.setProperty("--cols", mt.seats.length);
    row.style.setProperty("--ncols", mt.seats.length <= 3 ? mt.seats.length : Math.min(3, Math.ceil(mt.seats.length / 2)));
    mt.seats.forEach(function (s, i) {
      var cell = el("div", "ent");
      var line = el("div", "ent-line");
      var sign = el("button", "sign", "±");
      sign.type = "button";
      sign.setAttribute("aria-label", t("entry.sign", { name: s }));
      sign.title = t("entry.sign", { name: s });
      var inp = el("input");
      inp.type = "text";
      inp.inputMode = "numeric";
      inp.autocomplete = "off";
      inp.maxLength = 9;
      inp.placeholder = t("entry.ph");
      inp.setAttribute("aria-label", t("entry.aria", { name: s }));
      inp.value = vals[i] || "";
      inp.addEventListener("input", function () { setDraft(mt, i, inp.value); });
      inp.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        e.preventDefault();
        var all = row.querySelectorAll("input");
        if (i < all.length - 1) { all[i + 1].focus(); all[i + 1].select(); }
        else addRound();
      });
      sign.addEventListener("click", function () {
        var v = parsePts(inp.value);
        if (v === null) return;
        inp.value = v ? String(-v) : (inp.value.charAt(0) === "-" ? "" : "-");
        setDraft(mt, i, inp.value);
        inp.focus();
      });
      line.appendChild(sign);
      line.appendChild(inp);
      cell.appendChild(line);
      if (mt.quick.length) {
        var q = el("div", "quick");
        mt.quick.forEach(function (n) {
          var b = el("button", "qbtn", (n > 0 ? "+" : "−") + Math.abs(n));
          b.type = "button";
          b.setAttribute("aria-label", t("entry.quick", { n: n, name: s }));
          b.addEventListener("click", function () {
            var cur = parsePts(inp.value);
            if (cur === null) cur = 0;
            var nv = Math.max(-MAX_SCORE, Math.min(MAX_SCORE, cur + n));
            inp.value = String(nv);
            setDraft(mt, i, inp.value);
          });
          q.appendChild(b);
        });
        cell.appendChild(q);
      }
      row.appendChild(cell);
    });
  }
  function draftVals(mt) {
    return prefs.draft && prefs.draft.g === mt.id ? prefs.draft.v : [];
  }
  function setDraft(mt, i, v) {
    if (!prefs.draft || prefs.draft.g !== mt.id) prefs.draft = { g: mt.id, v: mt.seats.map(function () { return ""; }) };
    prefs.draft.v[i] = String(v).slice(0, 9);
    savePrefs();
  }

  function addRound() {
    var mt = curMatch();
    if (!mt || mt.done) return;
    var inputs = $("entry-row").querySelectorAll("input");
    var s = [], any = false;
    for (var i = 0; i < mt.seats.length; i++) {
      var raw = inputs[i] ? inputs[i].value : "";
      var v = parsePts(raw);
      if (v === null) { showToast(t("entry.bad", { v: raw.trim() })); if (inputs[i]) inputs[i].focus(); return; }
      if (String(raw).trim() !== "") any = true;
      s.push(v);
    }
    if (!any) { showToast(t("entry.none")); if (inputs[0]) inputs[0].focus(); return; }
    var rs = roundsOf(data, mt.id);
    if (rs.length >= MAX_ROUNDS) { showToast(t("entry.max", { n: MAX_ROUNDS })); return; }
    var before = standing(mt, rs);
    var now = Date.now();
    var lastC = rs.length ? rs[rs.length - 1].c : 0;
    var r = { id: newId(), m: now, g: mt.id, c: Math.max(now, lastC + 1), s: s };
    data.rounds.push(r);
    prefs.draft = null;
    savePrefs();
    [].forEach.call(inputs, function (inp) { inp.value = ""; });
    commit();
    var n = rs.length + 1;
    undoToast(t("toast.added", { n: n }), function () {
      var x = findIn(data.rounds, r.id);
      if (!x) return;
      tomb(x.id, x.m);
      commit();
    });
    var after = standing(mt, roundsOf(data, mt.id));
    live(t("live.round", { n: n, pts: mt.seats.map(function (sn, k) { return sn + " " + fmtNum(s[k]); }).join(", ") }) +
         (after.best.length === 1 ? ". " + t("live.leader", { w: mt.seats[after.best[0]] }) : ""));
    if (after.reached && !before.reached) winDialog(mt, after);
    else if (inputs[0] && !window.matchMedia("(pointer: coarse)").matches) inputs[0].focus();
  }

  // ---------- Round timer (this device only) ----------
  var timerLeft = 0, timerEnd = 0, timerTick = null, actx = null;
  function renderTimer() {
    var on = !!prefs.timer.on;
    var mt = curMatch();
    $("timer").hidden = !on || !mt || !!mt.done;
    $("timer-btn").classList.toggle("on", on);
    $("timer-btn").setAttribute("aria-pressed", on ? "true" : "false");
    if (!timerTick && !timerLeft) timerLeft = prefs.timer.len * 1000;
    showTime();
  }
  function showTime() {
    var ms = timerTick ? Math.max(0, timerEnd - Date.now()) : timerLeft;
    var sec = Math.ceil(ms / 1000);
    $("timer-show").textContent = Math.floor(sec / 60) + ":" + (sec % 60 < 10 ? "0" : "") + (sec % 60);
    $("timer-show").classList.toggle("low", !!timerTick && sec <= 5);
    var go = $("timer-go");
    go.innerHTML = timerTick ? UI.pause : UI.play;
    go.setAttribute("aria-label", t(timerTick ? "timer.pause" : "timer.go"));
    go.title = t(timerTick ? "timer.pause" : "timer.go");
  }
  function toggleTimer() {
    if (timerTick) { stopTimer(false); return; }
    if (timerLeft <= 0) timerLeft = prefs.timer.len * 1000;
    timerEnd = Date.now() + timerLeft;
    warmAudio();
    timerTick = setInterval(function () {
      if (Date.now() >= timerEnd) { clearInterval(timerTick); timerTick = null; timerLeft = 0; showTime(); timeUp(); return; }
      showTime();
    }, 200);
    showTime();
  }
  function stopTimer(reset) {
    if (timerTick) { timerLeft = Math.max(0, timerEnd - Date.now()); clearInterval(timerTick); timerTick = null; }
    if (reset) timerLeft = prefs.timer.len * 1000;
    if ($("timer-show")) showTime();
  }
  function timeUp() {
    live(t("timer.end"));
    showToast(t("timer.end"));
    beep();
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
  }
  function warmAudio() {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") actx.resume();
    } catch (e) { actx = null; }
  }
  function beep() {
    if (!actx) return;
    try {
      var t0 = actx.currentTime;
      [0, 0.28, 0.56].forEach(function (d) {
        var o = actx.createOscillator(), gn = actx.createGain();
        o.type = "sine";
        o.frequency.value = 880;
        gn.gain.setValueAtTime(0.0001, t0 + d);
        gn.gain.exponentialRampToValueAtTime(0.25, t0 + d + 0.02);
        gn.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.22);
        o.connect(gn); gn.connect(actx.destination);
        o.start(t0 + d); o.stop(t0 + d + 0.24);
      });
    } catch (e) {}
  }
  function buildTimerLens() {
    var sel = $("timer-len");
    sel.textContent = "";
    TIMER_LENS.forEach(function (s) {
      var o = el("option", "", s < 60 ? s + "″" : (s % 60 ? Math.floor(s / 60) + "′" + (s % 60) + "″" : (s / 60) + "′"));
      o.value = String(s);
      sel.appendChild(o);
    });
    sel.value = String(prefs.timer.len);
    sel.setAttribute("aria-label", t("timer.len"));
  }

  // ---------- 8. Dialogs ----------
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function makeDialog(id, title) {
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
    if (title) dlg.appendChild(el("div", "dlg-title", title));
    return dlg;
  }
  function field(labelText, input, id) {
    var wrap = el("div", "fld");
    var lab = el("label", "dlg-lbl", labelText);
    input.id = id;
    lab.setAttribute("for", id);
    wrap.appendChild(lab);
    wrap.appendChild(input);
    return wrap;
  }
  function numInput(v) {
    var i = el("input");
    i.type = "text";
    i.inputMode = "numeric";
    i.autocomplete = "off";
    i.maxLength = 8;
    i.value = String(v);
    return i;
  }
  function parseQuick(s) {
    var out = [];
    String(s || "").split(/[,;\s]+/).forEach(function (p) {
      var v = parsePts(p);
      if (p && v) out.push(v);
    });
    return normQuick(out);
  }
  // Seat names: trimmed, non-empty, unique (case-insensitive).
  function checkSeats(names) {
    var seen = {};
    for (var i = 0; i < names.length; i++) {
      if (!names[i]) return "toast.needSeat";
      var k = nameKey(names[i]);
      if (seen[k]) return "toast.dupSeat";
      seen[k] = 1;
    }
    return null;
  }

  function newMatchDialog() {
    if (data.matches.length >= MAX_MATCHES) { showToast(t("toast.maxMatches", { n: MAX_MATCHES })); return; }
    var dlg = makeDialog("sk-new", t("dlg.newTitle"));
    dlg.classList.add("wide");
    var form = el("form");
    form.method = "dialog";
    var tpls = allTemplates(data);
    var chosen = tpls[0];
    var seatNames = [];

    var chipLbl = el("div", "dlg-lbl", t("dlg.game"));
    var chips = el("div", "chips");
    chips.setAttribute("role", "radiogroup");
    chips.setAttribute("aria-label", t("dlg.game"));
    var nameIn = el("input");
    nameIn.maxLength = NAME_LEN;
    nameIn.autocomplete = "off";
    var seatBox = el("div", "seat-edit");
    var moreBtn = button(t("dlg.more"), "add-seat", function () {
      readSeats();
      if (seatNames.length < MAX_SEATS) { seatNames.push(""); drawSeats(seatNames.length - 1); }
    });
    var targetIn = numInput(0);
    var lowIn = el("input");
    lowIn.type = "checkbox";
    var quickIn = el("input");
    quickIn.autocomplete = "off";
    quickIn.maxLength = 40;
    var tplIn = el("input");
    tplIn.type = "checkbox";

    var dl = el("datalist");
    dl.id = "sk-players";
    data.players.slice().sort(function (a, b) { return cmpStr(a.name.toLowerCase(), b.name.toLowerCase()); })
      .forEach(function (p) { var o = el("option"); o.value = p.name; dl.appendChild(o); });

    function readSeats() {
      seatNames = [].map.call(seatBox.querySelectorAll("input"), function (i) { return i.value; });
    }
    function drawSeats(focusAt) {
      seatBox.textContent = "";
      seatNames.forEach(function (v, i) {
        var line = el("div", "seat-line");
        line.appendChild(dot(PCOLORS[i % PCOLORS.length]));
        var inp = el("input");
        inp.maxLength = SEAT_LEN;
        inp.autocomplete = "off";
        inp.setAttribute("list", "sk-players");
        inp.placeholder = t("seat.default", { n: i + 1 });
        inp.setAttribute("aria-label", t("dlg.player", { n: i + 1 }));
        inp.value = v;
        line.appendChild(inp);
        var rm = iconBtn("mini danger", UI.x, t("dlg.less", { n: i + 1 }), function () {
          readSeats();
          seatNames.splice(i, 1);
          drawSeats();
        });
        rm.disabled = seatNames.length <= MIN_SEATS;
        line.appendChild(rm);
        seatBox.appendChild(line);
        if (focusAt === i) setTimeout(function () { inp.focus(); }, 0);
      });
      moreBtn.disabled = seatNames.length >= MAX_SEATS;
    }
    function pick(tp) {
      chosen = tp;
      [].forEach.call(chips.querySelectorAll(".chip"), function (c) {
        var on = c.dataset.id === tp.id;
        c.classList.toggle("on", on);
        c.setAttribute("aria-checked", on ? "true" : "false");
      });
      nameIn.value = tp.name;
      targetIn.value = String(tp.target);
      lowIn.checked = !!tp.low;
      quickIn.value = tp.quick.join(", ");
      readSeats();
      var n = tp.seats;
      while (seatNames.length < n) seatNames.push("");
      if (seatNames.length > n && seatNames.slice(n).every(function (s) { return !s.trim(); })) seatNames = seatNames.slice(0, n);
      drawSeats();
    }
    function drawChips() {
      chips.textContent = "";
      tpls.forEach(function (tp) {
        var wrap = el("span", "tpl-chip");
        var c = el("button", "chip", tp.name);
        c.type = "button";
        c.dataset.id = tp.id;
        c.setAttribute("role", "radio");
        c.addEventListener("click", function () { pick(tp); });
        wrap.appendChild(c);
        if (!tp.ready) {
          wrap.appendChild(iconBtn("mini danger", UI.x, t("dlg.tplDel", { name: tp.name }), function () {
            tomb(tp.id, tp.m);
            commit();
            tpls = allTemplates(data);
            if (chosen.id === tp.id) chosen = tpls[0];
            drawChips();
            pick(chosen);
            showToast(t("toast.tplDel"));
          }));
        }
        chips.appendChild(wrap);
      });
    }

    form.appendChild(chipLbl);
    form.appendChild(chips);
    form.appendChild(field(t("dlg.name"), nameIn, "sk-name"));
    form.appendChild(el("div", "dlg-lbl", t("dlg.players")));
    form.appendChild(seatBox);
    form.appendChild(moreBtn);
    form.appendChild(dl);
    var opts = el("details", "more-opts");
    var sum = el("summary", "", t("dlg.target").replace(/\s*\(.*\)$/, "") + " · " + t("dlg.quick").replace(/\s*\(.*\)$/, ""));
    opts.appendChild(sum);
    opts.appendChild(field(t("dlg.target"), targetIn, "sk-target"));
    var lowLbl = el("label", "check");
    lowLbl.appendChild(lowIn);
    lowLbl.appendChild(el("span", "", t("dlg.low")));
    opts.appendChild(lowLbl);
    opts.appendChild(field(t("dlg.quick"), quickIn, "sk-quick"));
    var tplLbl = el("label", "check");
    tplLbl.appendChild(tplIn);
    tplLbl.appendChild(el("span", "", t("dlg.saveTpl")));
    opts.appendChild(tplLbl);
    form.appendChild(opts);

    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.start"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      readSeats();
      var name = normText(nameIn.value, NAME_LEN);
      if (!name) { showToast(t("toast.needName")); nameIn.focus(); return; }
      var seats = seatNames.map(function (s, i) { return normText(s, SEAT_LEN) || t("seat.default", { n: i + 1 }); });
      var bad = checkSeats(seats);
      if (bad) { showToast(t(bad)); return; }
      var target = parsePts(targetIn.value);
      target = target && target > 0 ? target : 0;
      var low = lowIn.checked ? 1 : 0;
      var quick = parseQuick(quickIn.value);
      var now = Date.now();
      if (tplIn.checked) {
        var ownCount = data.tpls.length;
        var tp = chosen.ready ? null : findIn(data.tpls, chosen.id);
        if (tp) {
          tp.name = name; tp.target = target; tp.low = low; tp.quick = quick; tp.seats = seats.length;
          stamp(tp);
        } else if (ownCount >= MAX_TPLS) {
          showToast(t("toast.maxTpl", { n: MAX_TPLS }));
        } else {
          // Saving from a ready template with its own name replaces it;
          // a new name makes a template of your own.
          var replaces = chosen.ready && name === chosen.name ? chosen.id : "";
          tp = { id: newId(), m: now, name: name, target: target, low: low, quick: quick,
                 seats: seats.length, base: replaces };
          data.tpls.push(tp);
        }
        if (tp) chosen = tp;
        showToast(t("toast.tplSaved"));
      }
      var mt = { id: newId(), m: now, c: now, name: name, tpl: chosen.id || "", seats: seats,
                 target: target, low: low, quick: quick, done: 0 };
      data.matches.push(mt);
      rememberPlayers(seats);
      dlg.close();
      prefs.cur = mt.id;
      prefs.draft = null;
      savePrefs();
      commit();
      openMatch(mt.id);
    });

    drawChips();
    pick(chosen);
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    var first = chips.querySelector(".chip");
    if (first) first.focus();
  }

  // New names become suggestions with a colour of their own.
  function rememberPlayers(seats) {
    var used = {};
    data.players.forEach(function (p) { used[p.col] = (used[p.col] || 0) + 1; });
    seats.forEach(function (s) {
      if (playerByName(s) || data.players.length >= MAX_PLAYERS) return;
      var col = 0;
      for (var c = 1; c < PCOLORS.length; c++) if ((used[c] || 0) < (used[col] || 0)) col = c;
      used[col] = (used[col] || 0) + 1;
      data.players.push({ id: newId(), m: Date.now(), name: s, col: col });
    });
  }

  function roundDialog(mt, r, n) {
    var dlg = makeDialog("sk-round", t("dlg.roundTitle", { n: n }));
    var form = el("form");
    form.method = "dialog";
    var ins = mt.seats.map(function (s, i) {
      var inp = numInput(i < r.s.length ? r.s[i] : 0);
      form.appendChild(field(s, inp, "sk-r" + i));
      return inp;
    });
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.delete"), "danger", function () {
      var x = findIn(data.rounds, r.id);
      if (x) {
        var keep = JSON.parse(JSON.stringify(x));
        tomb(x.id, x.m);
        commit();
        undoToast(t("toast.roundDel"), function () {
          keep.m = Math.max(Date.now(), (data.tombs[keep.id] || 0) + 1);
          data.rounds.push(keep);
          commit();
        });
      }
      dlg.close();
    }));
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var s = [];
      for (var i = 0; i < ins.length; i++) {
        var v = parsePts(ins[i].value);
        if (v === null) { showToast(t("entry.bad", { v: ins[i].value.trim() })); ins[i].focus(); return; }
        s.push(v);
      }
      var x = findIn(data.rounds, r.id);
      if (x && JSON.stringify(x.s) !== JSON.stringify(s)) {
        var was = standing(mt, roundsOf(data, mt.id)).reached;
        x.s = s;
        stamp(x);
        commit();
        var now = curMatch() && standing(mt, roundsOf(data, mt.id));
        dlg.close();
        if (now && now.reached && !was && !mt.done) winDialog(mt, now);
        return;
      }
      dlg.close();
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    ins[0].focus();
    ins[0].select();
  }

  function winDialog(mt, st) {
    var dlg = makeDialog("sk-win");
    dlg.classList.add("res-dlg");
    var tie = st.best.length > 1;
    dlg.appendChild(el("div", "dlg-title", t(tie ? "win.tie" : "win.title")));
    var crown = el("div", "res-crown");
    crown.innerHTML = UI.crown;
    dlg.appendChild(crown);
    dlg.appendChild(el("div", "res-win", st.best.map(function (i) { return mt.seats[i]; }).join(" · ")));
    dlg.appendChild(el("div", "dlg-sub", t("win.pts", { n: fmtNum(st.totals[st.best[0]]) })));
    var acts = el("div", "dlg-actions res-actions");
    acts.appendChild(button(t("win.go"), "", function () { dlg.close(); }));
    var fin = button(t("win.finish"), "primary", function () { dlg.close(); finishMatch(mt.id, true); });
    acts.appendChild(fin);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    fin.focus();
  }

  function finishMatch(id, done) {
    var mt = findIn(data.matches, id);
    if (!mt) return;
    mt.done = done ? Date.now() : 0;
    stamp(mt);
    if (done) stopTimer(true);
    commit();
    showToast(t(done ? "toast.finished" : "toast.reopened"));
  }

  function menuDialog() {
    var mt = curMatch();
    if (!mt) return;
    var dlg = makeDialog("sk-menu", mt.name);
    var list = el("div", "menu-list");
    function item(key, fn, cls) {
      var b = button(t(key), "menu-item" + (cls ? " " + cls : ""), function () { dlg.close(); fn(); });
      list.appendChild(b);
      return b;
    }
    if (!mt.done) item("menu.edit", function () { editDialog(mt.id); });
    item(mt.done ? "menu.reopen" : "menu.finish", function () { finishMatch(mt.id, !mt.done); });
    item("menu.csv", function () { exportMatch(mt.id); });
    item("menu.delete", function () { deleteMatch(mt.id); }, "danger");
    dlg.appendChild(list);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.close"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    list.firstChild.focus();
  }

  function editDialog(id) {
    var mt = findIn(data.matches, id);
    if (!mt) return;
    var dlg = makeDialog("sk-edit", t("dlg.editTitle"));
    var form = el("form");
    form.method = "dialog";
    var nameIn = el("input");
    nameIn.maxLength = NAME_LEN;
    nameIn.autocomplete = "off";
    nameIn.value = mt.name;
    form.appendChild(field(t("dlg.name"), nameIn, "sk-e-name"));
    form.appendChild(el("div", "dlg-lbl", t("dlg.players")));
    var seatIns = mt.seats.map(function (s, i) {
      var line = el("div", "seat-line");
      line.appendChild(dot(seatColor(s) || PCOLORS[i % PCOLORS.length]));
      var inp = el("input");
      inp.maxLength = SEAT_LEN;
      inp.autocomplete = "off";
      inp.value = s;
      inp.setAttribute("aria-label", t("dlg.player", { n: i + 1 }));
      line.appendChild(inp);
      form.appendChild(line);
      return inp;
    });
    form.appendChild(el("p", "hint", t("dlg.seatsFixed")));
    var targetIn = numInput(mt.target);
    form.appendChild(field(t("dlg.target"), targetIn, "sk-e-target"));
    var lowIn = el("input");
    lowIn.type = "checkbox";
    lowIn.checked = !!mt.low;
    var lowLbl = el("label", "check");
    lowLbl.appendChild(lowIn);
    lowLbl.appendChild(el("span", "", t("dlg.low")));
    form.appendChild(lowLbl);
    var quickIn = el("input");
    quickIn.maxLength = 40;
    quickIn.autocomplete = "off";
    quickIn.value = mt.quick.join(", ");
    form.appendChild(field(t("dlg.quick"), quickIn, "sk-e-quick"));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = normText(nameIn.value, NAME_LEN);
      if (!name) { showToast(t("toast.needName")); nameIn.focus(); return; }
      var seats = seatIns.map(function (i) { return normText(i.value, SEAT_LEN); });
      var bad = checkSeats(seats);
      if (bad) { showToast(t(bad)); return; }
      var target = parsePts(targetIn.value);
      var x = findIn(data.matches, id);
      if (!x) { dlg.close(); return; }
      x.name = name;
      x.seats = seats;
      x.target = target && target > 0 ? target : 0;
      x.low = lowIn.checked ? 1 : 0;
      x.quick = parseQuick(quickIn.value);
      stamp(x);
      rememberPlayers(seats);
      entryFor = null;
      dlg.close();
      commit();
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    nameIn.focus();
  }

  function deleteMatch(id) {
    var mt = findIn(data.matches, id);
    if (!mt) return;
    var keep = JSON.parse(JSON.stringify(mt));
    var keepRounds = JSON.parse(JSON.stringify(roundsOf(data, id)));
    tomb(mt.id, mt.m);
    keepRounds.forEach(function (r) { tomb(r.id, r.m); });
    stopTimer(true);
    prefs.cur = null;
    if (prefs.draft && prefs.draft.g === id) prefs.draft = null;
    savePrefs();
    commit();
    undoToast(t("toast.deleted"), function () {
      if (findIn(data.matches, id)) return;
      var bump = function (x) { x.m = Math.max(Date.now(), (data.tombs[x.id] || 0) + 1); return x; };
      data.matches.push(bump(keep));
      keepRounds.forEach(function (r) { data.rounds.push(bump(r)); });
      commit();
    });
  }

  // ---------- 9. Toasts, export ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "scores", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  // Undo toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, onUndo); }

  var toastTimer = null;
  function localToast(text, onUndo) {
    var box = $("toast");
    if (!box) return;
    hostToast();
    box.textContent = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    if (onUndo) {
      var b = el("button", "", t("toast.undo"));
      b.type = "button";
      b.addEventListener("click", function () {
        box.classList.remove("show");
        clearTimeout(toastTimer);
        onUndo();
      });
      box.appendChild(b);
    }
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, onUndo ? 8000 : 4000);
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

  function dialogHost() {
    try { return window.orosDialog || window.parent.orosDialog || null; } catch (e) { return window.orosDialog || null; }
  }
  function saveCsv(text, filename) {
    var blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    var done = function () { showToast(t("toast.exported")); };
    var host = dialogHost();
    if (host && typeof host.saveFile === "function") {
      host.saveFile({ blob: blob, filename: filename, mime: "text/csv",
                      types: [{ description: "CSV", accept: { "text/csv": [".csv"] } }] })
        .then(function (r) { if (r && r.ok) done(); });
      return;
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 40000);
    done();
  }
  function slug(s) {
    return normText(s, NAME_LEN).toLowerCase().replace(/[^a-z0-9Ͱ-Ͽἀ-῿]+/g, "-").replace(/^-+|-+$/g, "") || "match";
  }
  function isoDay(ms) {
    var d = new Date(ms), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function exportMatch(id) {
    var mt = findIn(data.matches, id);
    if (!mt) return;
    saveCsv(matchCsv(mt, roundsOf(data, id)), t("csv.file") + "-" + slug(mt.name) + "-" + isoDay(mt.c) + ".csv");
  }
  function exportHistory() {
    if (!data.matches.some(function (x) { return x.done; })) { showToast(t("toast.nothing")); return; }
    saveCsv(historyCsv(data, fmtDate), t("csv.file") + "-" + isoDay(Date.now()) + ".csv");
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
    // Tabs: arrow keys move between them (WAI-ARIA tabs)
    $("tabs").addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      var order = ["play", "hist", "stats"];
      var i = order.indexOf(prefs.tab) + (e.key === "ArrowRight" ? 1 : -1);
      setTab(order[(i + order.length) % order.length]);
      $("tab-" + prefs.tab).focus();
      e.preventDefault();
    });
    // Escape in a match goes back (not while a dialog is open)
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || document.querySelector("dialog[open]") || !curMatch()) return;
      var tag = e.target && e.target.tagName;
      if (tag === "INPUT" && e.target.value) return;
      goHome();
    });
  }
  function setTab(k) {
    prefs.tab = k;
    savePrefs();
    renderHome();
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
    api.registerSlice("scores", sliceGet, sliceSet, STORAGE_KEY, mergeScores);
  }

  function sliceGet() {
    return mergeScores(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.matches)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeScores(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;   // no toast on merge (sync feedback = taskbar dot)
    if (document.querySelector("dialog#sk-round[open], dialog#sk-edit[open], dialog#sk-new[open]")) {
      renderBehindDialog = true;
      return;
    }
    renderAll();
  }
  // A pull while a form is open re-renders after it closes, so the
  // form never loses what you typed.
  var renderBehindDialog = false;
  function afterDialogs() {
    if (renderBehindDialog && !document.querySelector("dialog[open]")) {
      renderBehindDialog = false;
      renderAll();
    }
  }

  // ---------- 12. Wiring & boot ----------
  function applyI18n() {
    document.title = t("app") + " · orOS";
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    $("tab-play").textContent = t("tab.play");
    $("tab-hist").textContent = t("tab.hist");
    $("tab-stats").textContent = t("tab.stats");
    $("new-btn").innerHTML = UI.plus;
    $("new-btn").appendChild(el("span", "", t("btn.new")));
    $("new-btn").setAttribute("aria-label", t("btn.new"));
    $("empty-new").textContent = t("btn.new");
    $("csv-all").textContent = t("hist.csv");
    [["back-btn", UI.back, "btn.back"], ["menu-btn", UI.menu, "btn.menu"], ["timer-btn", UI.timer, "btn.timer"],
     ["timer-reset", UI.reset, "timer.reset"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = x[1];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    $("add-round").textContent = t("entry.add");
  }

  function wire() {
    $("new-btn").addEventListener("click", newMatchDialog);
    $("empty-new").addEventListener("click", newMatchDialog);
    $("back-btn").addEventListener("click", goHome);
    $("menu-btn").addEventListener("click", menuDialog);
    $("add-round").addEventListener("click", addRound);
    $("csv-all").addEventListener("click", exportHistory);
    ["play", "hist", "stats"].forEach(function (k) {
      $("tab-" + k).addEventListener("click", function () { setTab(k); });
    });
    $("stats-game").addEventListener("change", function () {
      prefs.game = $("stats-game").value;
      savePrefs();
      renderStats();
    });
    $("timer-btn").addEventListener("click", function () {
      prefs.timer.on = prefs.timer.on ? 0 : 1;
      if (!prefs.timer.on) stopTimer(true);
      savePrefs();
      renderTimer();
    });
    $("timer-go").addEventListener("click", toggleTimer);
    $("timer-reset").addEventListener("click", function () { stopTimer(true); });
    $("timer-len").addEventListener("change", function () {
      var v = parseInt($("timer-len").value, 10);
      if (TIMER_LENS.indexOf(v) < 0) return;
      prefs.timer.len = v;
      savePrefs();
      stopTimer(true);
    });
    document.addEventListener("close", afterDialogs, true);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") savePrefsNow();
    });
    window.addEventListener("pagehide", function () {
      savePrefsNow();
      try { if (actx) actx.close(); } catch (e) {}
    });
    wireKeyboard();
  }

  function boot() {
    load();
    loadPrefs();
    applyI18n();
    buildTimerLens();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    renderAll();
  }

  boot();
})();
