// ============================================================
// orOS Solitaire — App logic (v1.0.0)
// Three one-player card games on one table, drawn by cardkit/:
//   - Klondike: draw 1 or 3, classic (Windows) score or no score
//   - FreeCell: Microsoft numbered deals 1–32000 (same deal everywhere),
//     multi-card moves as far as free cells and empty columns allow
//   - Spider: 1, 2 or 4 suits
// Play: drag (mouse, touch, pen) or tap a card: it goes to the best
// place (foundation first). A double tap never moves twice. Unlimited
// undo, hint, auto-complete once every card is open (Klondike,
// FreeCell); Spider clears K→A runs by itself. Keys: Ctrl/Cmd+Z undo,
// H hint, N new deal; Enter / Space on a focused pile = tap.
// Data:
//   - synced slice "solitaire" (oros-solitaire-data): per variant ×
//     setting the games played and won, best time / fewest moves / best
//     score (each with its date) and best streak, as per-device rows
//     (each device grows its own row; merge = per-row join) + a reset
//     stamp br. Same shape as Snake / Number Slider.
//   - device-local (R10): oros-solitaire-prefs (variant, rules, table),
//     oros-solitaire-session (one game in progress per variant, with
//     its undo steps), oros-solitaire-streak (current streaks: they do
//     not merge across devices), oros-solitaire-device (row id)
// Sections:
//   1. Constants, i18n, helpers
//   2. Rules: deals, moves, scoring, auto-complete, hint
//   3. Synced data: load / save / normalize / merge (R5, R26)
//   4. Device-local prefs, sessions, streaks
//   5. Game flow (new, move, undo, clock, auto-complete, finish)
//   6. Render (toolbar, status, table layout)
//   7. Dialogs (options, result, records, confirm)
//   8. Toasts
//   9. Win animation
//  10. Input (drag + tap via cardkit, keys, Contract Β)
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-solitaire-data";
  var PREFS_KEY   = "oros-solitaire-prefs";
  var SESSION_KEY = "oros-solitaire-session";
  var DEVICE_KEY  = "oros-solitaire-device";
  var STREAK_KEY  = "oros-solitaire-streak";
  var DATA_VER    = 1;

  var VARIANTS = ["k", "f", "s"];
  var KEYS = ["k1c", "k1n", "k3c", "k3n", "f", "s1", "s2", "s4"];   // variant + setting
  var COLS = { k: 7, f: 8, s: 10 };
  var FC_MAX_DEAL = 32000;
  var MAX_MS = 360000000;                  // 100 h
  var MAX_MOVES = 100000;
  var MAX_SCORE = 10000000;
  var UNDO_KEEP = 150;                     // undo steps kept across a reload (in memory: all)
  var MS_SUIT = [3, 2, 1, 0];              // Microsoft ♣ ♦ ♥ ♠ → cardkit suit index

  var CK = window.orosCards;

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
      "v.k": "Klondike", "v.f": "FreeCell", "v.s": "Spider",
      "opt.draw1": "Draw 1", "opt.draw3": "Draw 3",
      "opt.scoreC": "Classic score", "opt.scoreN": "No score",
      "opt.suits1": "1 suit", "opt.suits2": "2 suits", "opt.suits4": "4 suits",
      "opt.felt": "Felt", "opt.plain": "Plain",
      "btn.opts": "Game options",
      "btn.undo": "Undo (Ctrl+Z)",
      "btn.hint": "Hint (H)",
      "btn.new": "New deal (N)",
      "btn.stats": "Records",
      "st.moves": "Moves", "st.score": "Score",
      "st.time": "Time",
      "turn.deal": "Deal #{n}",
      "turn.won": "Solved!",
      "board.label": "Card table: {v}",
      "pile.t": "Column {n}", "pile.f": "Foundation", "pile.c": "Free cell",
      "pile.w": "Waste", "pile.s": "Stock", "pile.done": "Completed runs",
      "pile.empty": "{p}, empty",
      "pile.card": "{p}: {c}",
      "pile.stock": "Stock, {n} cards",
      "pile.stockSpider": "Stock, {n} deals left",
      "pile.recycle": "Stock, empty: turn the waste over",
      "live.move": "{c} to {p}",
      "live.draw": "Drew {c}",
      "live.recycle": "Waste turned over",
      "live.deal": "Dealt a new row",
      "live.run": "Run of {s} completed",
      "live.undo": "Move undone",
      "live.nomove": "No move for this card",
      "live.down": "That card is face down",
      "live.auto": "Every card is open: finishing",
      "live.won": "Solved!",
      "live.hint": "Hint: {c} to {p}",
      "live.hintStock": "Hint: take from the stock",
      "opts.title": "Game options",
      "opts.draw": "Draw",
      "opts.score": "Scoring",
      "opts.suits": "Suits",
      "opts.table": "Table",
      "opts.deal": "Deal number (1–32000)",
      "opts.play": "Play",
      "opts.current": "This deal: #{n}",
      "opts.note": "Changing a rule starts a new deal.",
      "opts.close": "Close",
      "res.title": "Solved",
      "res.hero": "You won!",
      "res.time": "Time",
      "res.moves": "Moves",
      "res.score": "Score",
      "res.rate": "Won",
      "res.streak": "Streak",
      "res.recT": "Best time!",
      "res.recM": "Fewest moves!",
      "res.recS": "Best score!",
      "res.again": "New deal",
      "res.close": "Close",
      "stats.title": "Records",
      "stats.played": "Played · won",
      "stats.bestT": "Best time",
      "stats.bestM": "Fewest moves",
      "stats.bestS": "Best score",
      "stats.streak": "Streak · best",
      "stats.none": "No games yet",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "confirm.reset": "Delete the records of every variant on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Records reset",
      "toast.newgame": "New deal",
      "toast.undo": "Undo",
      "toast.noUndo": "Nothing to undo",
      "toast.wonUndo": "This deal is solved: start a new one (N)",
      "toast.won": "Solved: start a new deal (N)",
      "toast.noHint": "No useful move left: undo or start a new deal",
      "toast.cells": "Not enough free space: you can move {n} cards at once",
      "toast.stockEmpty": "The stock is empty",
      "toast.dealEmpty": "Fill every empty column before dealing",
      "toast.badDeal": "Pick a deal from 1 to 32000",
      "toast.landscape": "Tip: turn the phone sideways for bigger cards",
      "toast.save": "Could not save: storage is full"
    },
    el: {
      "v.k": "Κλοντάικ", "v.f": "FreeCell", "v.s": "Αράχνη",
      "opt.draw1": "Ανά 1", "opt.draw3": "Ανά 3",
      "opt.scoreC": "Κλασικό σκορ", "opt.scoreN": "Χωρίς σκορ",
      "opt.suits1": "1 χρώμα", "opt.suits2": "2 χρώματα", "opt.suits4": "4 χρώματα",
      "opt.felt": "Τσόχα", "opt.plain": "Απλό",
      "btn.opts": "Ρυθμίσεις παιχνιδιού",
      "btn.undo": "Αναίρεση (Ctrl+Z)",
      "btn.hint": "Υπόδειξη (H)",
      "btn.new": "Νέα μοιρασιά (N)",
      "btn.stats": "Ρεκόρ",
      "st.moves": "Κινήσεις", "st.score": "Σκορ",
      "st.time": "Χρόνος",
      "turn.deal": "Μοιρασιά #{n}",
      "turn.won": "Βγήκε!",
      "board.label": "Τραπέζι: {v}",
      "pile.t": "Στήλη {n}", "pile.f": "Θεμέλιο", "pile.c": "Ελεύθερο κελί",
      "pile.w": "Ανοιχτά φύλλα", "pile.s": "Τράπουλα", "pile.done": "Ολοκληρωμένες σειρές",
      "pile.empty": "{p}, άδειο",
      "pile.card": "{p}: {c}",
      "pile.stock": "Τράπουλα, {n} φύλλα",
      "pile.stockSpider": "Τράπουλα, {n} μοιρασιές ακόμα",
      "pile.recycle": "Η τράπουλα τελείωσε: γύρνα τα ανοιχτά φύλλα",
      "live.move": "{c} στο σημείο: {p}",
      "live.draw": "Τράβηξες {c}",
      "live.recycle": "Τα φύλλα γύρισαν στην τράπουλα",
      "live.deal": "Μοιράστηκε νέα σειρά",
      "live.run": "Ολοκληρώθηκε σειρά σε {s}",
      "live.undo": "Η κίνηση αναιρέθηκε",
      "live.nomove": "Αυτό το φύλλο δεν έχει πού να πάει",
      "live.down": "Το φύλλο είναι κλειστό",
      "live.auto": "Όλα τα φύλλα είναι ανοιχτά: ολοκληρώνεται",
      "live.won": "Βγήκε!",
      "live.hint": "Υπόδειξη: {c} στο σημείο: {p}",
      "live.hintStock": "Υπόδειξη: τράβηξε από την τράπουλα",
      "opts.title": "Ρυθμίσεις παιχνιδιού",
      "opts.draw": "Τράβηγμα",
      "opts.score": "Σκορ",
      "opts.suits": "Χρώματα",
      "opts.table": "Τραπέζι",
      "opts.deal": "Αριθμός μοιρασιάς (1–32000)",
      "opts.play": "Παίξε",
      "opts.current": "Αυτή η μοιρασιά: #{n}",
      "opts.note": "Αν αλλάξεις κανόνα, ξεκινά νέα μοιρασιά.",
      "opts.close": "Κλείσιμο",
      "res.title": "Βγήκε",
      "res.hero": "Μπράβο, κέρδισες!",
      "res.time": "Χρόνος",
      "res.moves": "Κινήσεις",
      "res.score": "Σκορ",
      "res.rate": "Νίκες",
      "res.streak": "Σερί",
      "res.recT": "Ρεκόρ χρόνου!",
      "res.recM": "Ρεκόρ κινήσεων!",
      "res.recS": "Ρεκόρ σκορ!",
      "res.again": "Νέα μοιρασιά",
      "res.close": "Κλείσιμο",
      "stats.title": "Ρεκόρ",
      "stats.played": "Παρτίδες · νίκες",
      "stats.bestT": "Καλύτερος χρόνος",
      "stats.bestM": "Λιγότερες κινήσεις",
      "stats.bestS": "Καλύτερο σκορ",
      "stats.streak": "Σερί · καλύτερο",
      "stats.none": "Καμία παρτίδα ακόμα",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ όλων των παραλλαγών σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.newgame": "Νέα μοιρασιά",
      "toast.undo": "Αναίρεση",
      "toast.noUndo": "Δεν υπάρχει κίνηση για αναίρεση",
      "toast.wonUndo": "Η μοιρασιά βγήκε: ξεκίνα νέα (N)",
      "toast.won": "Βγήκε: ξεκίνα νέα μοιρασιά (N)",
      "toast.noHint": "Δεν μένει χρήσιμη κίνηση: κάνε αναίρεση ή νέα μοιρασιά",
      "toast.cells": "Δεν φτάνει ο ελεύθερος χώρος: μετακινείς έως {n} φύλλα μαζί",
      "toast.stockEmpty": "Η τράπουλα τελείωσε",
      "toast.dealEmpty": "Γέμισε πρώτα τις άδειες στήλες",
      "toast.badDeal": "Διάλεξε μοιρασιά από 1 έως 32000",
      "toast.landscape": "Συμβουλή: γύρνα το κινητό οριζόντια για μεγαλύτερα φύλλα",
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
  function numCmp(x, y) { return x - y; }

  function fmtTime(ms) {
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    var ss = ("0" + (s % 60)).slice(-2);
    return h ? h + ":" + ("0" + m).slice(-2) + ":" + ss : m + ":" + ss;
  }
  function fmtDate(ts) {
    try { return new Date(ts).toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB"); } catch (e) { return ""; }
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("solitaire.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Rules ----------
  // A game g = {
  //   v: "k" | "f" | "s",  o: setting ("1c" "3n" … | "" | "1" "2" "4"),
  //   deal: FreeCell deal number (else 0),
  //   tab: [[card…]] columns (bottom first), down: [n] face-down cards
  //        at the bottom of each column,
  //   st: stock (top = last), wa: waste (Klondike, top = last),
  //   fd: foundations (bottom = ace; Spider: one pile per finished run),
  //   fc: free cells (FreeCell: 4 piles of 0 or 1 card, else []),
  //   mv: moves, sc: score, ps: passes through the stock }
  // Cards are cardkit ids (suit * 13 + rank - 1). Piles are named by
  // refs: "t3" column, "f0" foundation, "c1" cell, "w0" waste, "s0" stock.
  // Every rule function returns a NEW game; a game object is never
  // changed once it exists (the undo stack keeps them as they are).
  function cloneG(g) { return JSON.parse(JSON.stringify(g)); }

  function blank(v, o, deal) {
    return { v: v, o: o, deal: deal, tab: [], down: [], st: [], wa: [], fd: [], fc: [], mv: 0, sc: 0, ps: 0 };
  }

  function dealKlondike(deck, draw, scoredOn) {
    var g = blank("k", String(draw) + (scoredOn ? "c" : "n"), 0), k = 0;
    for (var c = 0; c < 7; c++) {
      g.tab.push(deck.slice(k, k + c + 1));
      g.down.push(c);
      k += c + 1;
    }
    g.st = deck.slice(k);
    g.fd = [[], [], [], []];
    return g;
  }

  // Microsoft FreeCell deal n: the C runtime LCG
  //   state = state * 214013 + 2531011 (mod 2^31), rand = state >> 16
  // over 52 cards indexed rank * 4 + suit (♣ ♦ ♥ ♠); card i of the
  // result goes to column i % 8.
  function msDeal(n) {
    var seed = n, deck = [], out = [], i;
    for (i = 0; i < 52; i++) deck.push(i);
    for (i = 0; i < 52; i++) {
      seed = (seed * 214013 + 2531011) % 2147483648;
      var left = 52 - i, j = Math.floor(seed / 65536) % left;
      out.push(deck[j]);
      deck[j] = deck[left - 1];
    }
    return out.map(function (c) { return CK.make((c >> 2) + 1, MS_SUIT[c & 3]); });
  }

  function dealFreeCell(n) {
    var g = blank("f", "", n);
    for (var c = 0; c < 8; c++) { g.tab.push([]); g.down.push(0); }
    msDeal(n).forEach(function (card, i) { g.tab[i % 8].push(card); });
    g.fd = [[], [], [], []];
    g.fc = [[], [], [], []];
    return g;
  }

  function spiderDeck(suits) {
    var list = suits === 1 ? [0] : (suits === 2 ? [0, 1] : [0, 1, 2, 3]);
    return CK.newDeck({ suits: list, copies: 8 / list.length });
  }

  function dealSpider(deck, suits) {
    var g = blank("s", String(suits), 0), k = 0;
    for (var c = 0; c < 10; c++) {
      var n = c < 4 ? 6 : 5;
      g.tab.push(deck.slice(k, k + n));
      g.down.push(n - 1);
      k += n;
    }
    g.st = deck.slice(k);
    g.sc = 500;
    return g;
  }

  function pileOf(g, ref) {
    var k = ref.charAt(0), n = +ref.slice(1);
    if (k === "t") return g.tab[n] || null;
    if (k === "f") return g.fd[n] || null;
    if (k === "c") return g.fc[n] || null;
    if (k === "w") return g.wa;
    if (k === "s") return g.st;
    return null;
  }

  function scored(g) { return g.v === "s" || (g.v === "k" && g.o.charAt(1) === "c"); }

  // Can `over` lie on `under` in a column?
  function fits(v, under, over) {
    if (CK.rank(under) !== CK.rank(over) + 1) return false;
    return v === "s" ? true : CK.isRed(under) !== CK.isRed(over);
  }

  // Do two neighbours belong to one movable run? (Spider: same suit too.)
  function linked(v, under, over) {
    return fits(v, under, over) && (v !== "s" || CK.suit(under) === CK.suit(over));
  }

  // The cards that would move when card i of a pile is taken, or null.
  function runFrom(g, ref, i) {
    var p = pileOf(g, ref), k = ref.charAt(0);
    if (!p || !isInt(i) || i < 0 || i >= p.length) return null;
    if (k === "t") {
      if (i < g.down[+ref.slice(1)]) return null;
      for (var j = i + 1; j < p.length; j++) if (!linked(g.v, p[j - 1], p[j])) return null;
      return p.slice(i);
    }
    if (i !== p.length - 1 || k === "s" || (k === "f" && g.v !== "k")) return null;
    return [p[i]];
  }

  // FreeCell: how many cards move at once (free cells + 1, doubled per
  // empty column that is not the target).
  function maxRun(g, toEmpty) {
    var free = 0, empty = 0;
    g.fc.forEach(function (p) { if (!p.length) free++; });
    g.tab.forEach(function (p) { if (!p.length) empty++; });
    if (toEmpty) empty--;
    return (free + 1) * Math.pow(2, Math.max(0, empty));
  }

  // "" when the cards may go onto pile dst; else why not: "rule" | "cells".
  function canPlace(g, src, cards, dst) {
    if (!cards || !cards.length || src === dst) return "rule";
    var k = dst.charAt(0), p = pileOf(g, dst), c0 = cards[0];
    if (!p) return "rule";
    if (k === "t") {
      if (!p.length) {
        if (g.v === "k" && CK.rank(c0) !== 13) return "rule";
      } else if (!fits(g.v, p[p.length - 1], c0)) return "rule";
      if (g.v === "f" && cards.length > maxRun(g, !p.length)) return "cells";
      return "";
    }
    if (k === "f") {
      if (g.v === "s" || cards.length !== 1) return "rule";
      if (!p.length) return CK.rank(c0) === 1 ? "" : "rule";
      var top = p[p.length - 1];
      return CK.suit(top) === CK.suit(c0) && CK.rank(c0) === CK.rank(top) + 1 ? "" : "rule";
    }
    if (k === "c") return g.v === "f" && !p.length && cards.length === 1 ? "" : "rule";
    return "rule";
  }

  // Turn the top card of a column face up when its last open card left.
  function flipTop(g, c) {
    if (g.down[c] > 0 && g.down[c] >= g.tab[c].length) {
      g.down[c] = g.tab[c].length - 1;
      if (g.v === "k" && scored(g)) g.sc += 5;
    }
  }

  // Spider: a full K→A run of one suit on top of a column leaves it.
  function collectRuns(g) {
    for (var c = 0; c < g.tab.length; c++) {
      var p = g.tab[c], L = p.length;
      if (L - g.down[c] < 13) continue;
      var run = runFrom(g, "t" + c, L - 13);
      if (!run || CK.rank(run[0]) !== 13) continue;
      p.splice(L - 13);
      g.fd.push(run.reverse());
      g.sc += 100;
      flipTop(g, c);
    }
  }

  // Move card i of src (with the cards on it) to dst. Assumes canPlace.
  // Classic Klondike score: waste → column +5, to a foundation +10,
  // foundation → column −15, a card turned +5. Spider: −1 a move.
  function applyMove(g, src, i, dst) {
    var n = cloneG(g), cards = pileOf(n, src).splice(i), sk = src.charAt(0), dk = dst.charAt(0);
    var to = pileOf(n, dst);
    to.push.apply(to, cards);
    n.mv++;
    if (scored(n)) {
      if (n.v === "k") {
        if (sk === "w" && dk === "t") n.sc += 5;
        else if ((sk === "w" || sk === "t") && dk === "f") n.sc += 10;
        else if (sk === "f" && dk === "t") n.sc -= 15;
      } else n.sc -= 1;
    }
    if (sk === "t") flipTop(n, +src.slice(1));
    if (n.v === "s") collectRuns(n);
    n.sc = Math.max(0, n.sc);
    return n;
  }

  // Klondike stock: draw 1 or 3 onto the waste; an empty stock takes the
  // waste back (classic score −100 when drawing 1, −20 when drawing 3).
  function drawStock(g) {
    var n = cloneG(g), draw = +g.o.charAt(0);
    if (n.st.length) {
      for (var k = 0; k < draw && n.st.length; k++) n.wa.push(n.st.pop());
    } else if (n.wa.length) {
      n.st = n.wa.reverse();
      n.wa = [];
      n.ps++;
      if (scored(n)) n.sc = Math.max(0, n.sc - (draw === 1 ? 100 : 20));
    } else return null;
    n.mv++;
    return n;
  }

  // Spider: why a new row cannot be dealt ("" = it can).
  function dealWhy(g) {
    if (g.st.length < 10) return "stock";
    for (var c = 0; c < g.tab.length; c++) if (!g.tab[c].length) return "empty";
    return "";
  }

  function dealRow(g) {
    if (dealWhy(g)) return null;
    var n = cloneG(g);
    for (var c = 0; c < 10; c++) n.tab[c].push(n.st.pop());
    n.mv++;
    n.sc = Math.max(0, n.sc - 1);
    collectRuns(n);
    return n;
  }

  function isWon(g) {
    if (g.v === "s") return g.fd.length === 8;
    var n = 0;
    g.fd.forEach(function (p) { n += p.length; });
    return n === 52;
  }

  // Auto-complete is safe when nothing is hidden and every column falls
  // in rank toward its top: the lowest card left is then always free and
  // fits its foundation (Klondike also needs stock and waste empty).
  function canAuto(g) {
    if (g.v === "s" || isWon(g)) return false;
    if (g.st.length || g.wa.length) return false;
    for (var c = 0; c < g.tab.length; c++) {
      if (g.down[c]) return false;
      var p = g.tab[c];
      for (var j = 1; j < p.length; j++) if (CK.rank(p[j - 1]) < CK.rank(p[j])) return false;
    }
    return true;
  }

  // The foundation a card can go to, or -1.
  function foundFor(g, card) {
    if (g.v === "s") return -1;
    var empty = -1;
    for (var f = 0; f < 4; f++) {
      var p = g.fd[f];
      if (!p.length) { if (empty < 0) empty = f; continue; }
      var top = p[p.length - 1];
      if (CK.suit(top) === CK.suit(card) && CK.rank(card) === CK.rank(top) + 1) return f;
    }
    return CK.rank(card) === 1 ? empty : -1;
  }

  // One auto-complete step: the lowest free card that fits a foundation.
  function autoStep(g) {
    var srcs = [];
    g.tab.forEach(function (p, c) { if (p.length) srcs.push(["t" + c, p.length - 1]); });
    if (g.wa.length) srcs.push(["w0", g.wa.length - 1]);
    g.fc.forEach(function (p, c) { if (p.length) srcs.push(["c" + c, 0]); });
    var best = null;
    srcs.forEach(function (s) {
      var card = pileOf(g, s[0])[s[1]], f = foundFor(g, card);
      if (f >= 0 && (!best || CK.rank(card) < best.r)) best = { src: s[0], i: s[1], dst: "f" + f, r: CK.rank(card) };
    });
    return best ? { src: best.src, i: best.i, dst: best.dst } : null;
  }

  // Where a tap sends card i of src: a foundation first (one card), then
  // a column with cards (Spider: same suit first), then an empty column
  // (never a whole column into another empty one), then a free cell.
  // Returns { dst, why } with why "stuck" | "cells" when dst is "".
  function bestTarget(g, src, i) {
    var cards = runFrom(g, src, i);
    if (!cards) return { dst: "", why: "stuck" };
    var sk = src.charAt(0), why = "stuck", k, c;
    if (cards.length === 1 && sk !== "f") {
      var f = foundFor(g, cards[0]);
      if (f >= 0) return { dst: "f" + f, why: "" };
    }
    var n = g.tab.length, start = sk === "t" ? +src.slice(1) + 1 : 0, filled = [], empty = "";
    for (k = 0; k < n; k++) {
      c = (start + k) % n;
      var ref = "t" + c;
      if (ref === src) continue;
      var r = canPlace(g, src, cards, ref);
      if (r) { if (r === "cells") why = "cells"; continue; }
      if (g.tab[c].length) filled.push(c);
      else if (!empty && !(sk === "t" && i === 0)) empty = ref;
    }
    if (filled.length) {
      if (g.v === "s") {
        for (k = 0; k < filled.length; k++) {
          var p = g.tab[filled[k]];
          if (CK.suit(p[p.length - 1]) === CK.suit(cards[0])) return { dst: "t" + filled[k], why: "" };
        }
      }
      return { dst: "t" + filled[0], why: "" };
    }
    if (empty) return { dst: empty, why: "" };
    if (g.v === "f" && cards.length === 1 && sk !== "c") {
      for (k = 0; k < 4; k++) if (!g.fc[k].length) return { dst: "c" + k, why: "" };
    }
    return { dst: "", why: why };
  }

  // Every legal move from a column, the waste or a cell (moves off a
  // foundation are left out: they are never a hint).
  function allMoves(g) {
    var srcs = [], dsts = [], out = [];
    g.tab.forEach(function (p, c) { for (var i = g.down[c]; i < p.length; i++) srcs.push(["t" + c, i]); });
    if (g.wa.length) srcs.push(["w0", g.wa.length - 1]);
    g.fc.forEach(function (p, c) { if (p.length) srcs.push(["c" + c, 0]); });
    g.tab.forEach(function (p, c) { dsts.push("t" + c); });
    if (g.v !== "s") for (var f = 0; f < 4; f++) dsts.push("f" + f);
    g.fc.forEach(function (p, c) { dsts.push("c" + c); });
    srcs.forEach(function (s) {
      var cards = runFrom(g, s[0], s[1]);
      if (!cards) return;
      dsts.forEach(function (d) {
        if (!canPlace(g, s[0], cards, d)) out.push({ src: s[0], i: s[1], dst: d });
      });
    });
    return out;
  }

  // How useful a move is for a hint (0 = pointless: it only shuffles a
  // card between equal places).
  function moveValue(g, m) {
    var sk = m.src.charAt(0), dk = m.dst.charAt(0), p = pileOf(g, m.src), card = p[m.i];
    var col = sk === "t" ? +m.src.slice(1) : -1;
    var reveals = sk === "t" && m.i > 0 && m.i === g.down[col];
    if (dk === "f") return 100 + (reveals ? 10 : 0);
    if (sk === "w") return 50;
    if (sk === "c") return dk === "t" ? 45 : 0;
    var dp = pileOf(g, m.dst);
    if (dk === "t" && !dp.length && m.i === 0) return 0;
    if (reveals) return 80 + g.down[col];
    if (dk === "c") return 4;
    if (m.i === 0) return 50;
    var under = p[m.i - 1];
    if (g.v === "s") {
      if (linked("s", under, card)) return 0;
      if (dp.length && CK.suit(dp[dp.length - 1]) === CK.suit(card)) return 40;
      if (fits("s", under, card)) return 0;
      return dp.length ? 15 : 8;
    }
    if (fits(g.v, under, card)) return 0;
    return foundFor(g, under) >= 0 ? 30 : 12;
  }

  // The most useful move, else the stock ({ src: "s0" }), else null.
  function findHint(g) {
    var best = null, bv = 0;
    allMoves(g).forEach(function (m) {
      var v = moveValue(g, m);
      if (v > bv) { bv = v; best = m; }
    });
    if (best) return best;
    if (g.v === "k" && (g.st.length || g.wa.length)) return { src: "s0", i: -1, dst: "" };
    if (g.v === "s" && !dealWhy(g)) return { src: "s0", i: -1, dst: "" };
    return null;
  }

  // Score shown / recorded. Klondike classic: −2 every 10 s; a win after
  // at least 30 s adds 700000 / seconds (the Windows bonus).
  function scoreNow(g, ms, won) {
    if (!scored(g)) return 0;
    if (g.v === "s") return g.sc;
    var secs = Math.floor(ms / 1000), s = Math.max(0, g.sc - 2 * Math.floor(secs / 10));
    return won && secs >= 30 ? s + Math.floor(700000 / secs) : s;
  }

  function keyOf(g) { return g.v + g.o; }

  function intCards(a) {
    return Array.isArray(a) && a.every(function (x) { return isInt(x) && x >= 0 && x < 52; });
  }

  // A stored game is used only when it is a real position: right shape,
  // foundations in order, and exactly the cards of its deck.
  function validGame(g) {
    if (!g || typeof g !== "object" || VARIANTS.indexOf(g.v) < 0 || typeof g.o !== "string") return false;
    var v = g.v, c, j;
    if (!(v === "k" ? /^[13][cn]$/.test(g.o) : (v === "f" ? g.o === "" : /^[124]$/.test(g.o)))) return false;
    if (v === "f" ? !(isInt(g.deal) && g.deal >= 1 && g.deal <= FC_MAX_DEAL) : g.deal !== 0) return false;
    if (!isInt(g.mv) || g.mv < 0 || g.mv > MAX_MOVES || !isInt(g.sc) || g.sc < 0 || g.sc > MAX_SCORE ||
        !isInt(g.ps) || g.ps < 0 || g.ps > MAX_MOVES) return false;
    if (!Array.isArray(g.tab) || g.tab.length !== COLS[v] || !Array.isArray(g.down) || g.down.length !== COLS[v]) return false;
    if (!Array.isArray(g.fd) || !Array.isArray(g.fc) || !intCards(g.st) || !intCards(g.wa)) return false;
    if ((v !== "k" && g.wa.length) || (v === "f" && g.st.length) || (v === "s" && g.st.length % 10)) return false;
    if (v === "f" ? g.fc.length !== 4 : g.fc.length) return false;
    if (v === "s" ? g.fd.length > 8 : g.fd.length !== 4) return false;
    var all = g.st.concat(g.wa);
    for (c = 0; c < g.tab.length; c++) {
      var p = g.tab[c];
      if (!intCards(p) || !isInt(g.down[c]) || g.down[c] < 0 || g.down[c] > Math.max(0, p.length - 1)) return false;
      if (v === "f" && g.down[c]) return false;
      all = all.concat(p);
    }
    for (c = 0; c < g.fc.length; c++) {
      if (!intCards(g.fc[c]) || g.fc[c].length > 1) return false;
      all = all.concat(g.fc[c]);
    }
    for (c = 0; c < g.fd.length; c++) {
      var f = g.fd[c];
      if (!intCards(f) || (v === "s" && f.length !== 13)) return false;
      for (j = 0; j < f.length; j++) if (CK.rank(f[j]) !== j + 1 || CK.suit(f[j]) !== CK.suit(f[0])) return false;
      all = all.concat(f);
    }
    var want = v === "s" ? spiderDeck(+g.o) : CK.newDeck();
    if (all.length !== want.length) return false;
    all.sort(numCmp);
    want.sort(numCmp);
    for (c = 0; c < all.length; c++) if (all[c] !== want[c]) return false;
    return true;
  }

  // ---------- 3. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                         // max-merged
  //   rows: { <deviceId>: { b: <epoch>, s: { <key>: cell } } }
  // }
  // key = variant + setting (KEYS). cell = { p: played, w: won, k: best
  // streak, t/tt: best time (ms) and when, m/mt: fewest moves and when,
  // s/st: best score and when } — bests only once w ≥ 1.
  // Each device only ever writes ITS OWN row; a row counts from epoch b.
  // Merge per row: the newer epoch wins; equal epochs take the max of
  // p, w, k and the better of each best (earlier stamp on a tie). Rows
  // older than br drop. A join (symmetric, associative, idempotent).
  var data = null;
  var deviceId = null;

  // field, its stamp, min, max, direction (-1: lower is better)
  var BESTS = [["t", "tt", 1, MAX_MS, -1], ["m", "mt", 1, MAX_MOVES, -1], ["s", "st", 0, MAX_SCORE, 1]];

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normCell(v) {
    if (!v || typeof v !== "object" || !isInt(v.p) || !isInt(v.w) || !isInt(v.k) ||
        v.p < 1 || v.w < 0 || v.w > v.p || v.k < 0 || v.k > v.w) return null;
    var out = { p: v.p, w: v.w, k: v.k };
    if (v.w) {
      BESTS.forEach(function (b) {
        var x = v[b[0]], ts = v[b[1]];
        if (isInt(x) && x >= b[2] && x <= b[3] && isInt(ts) && ts >= 0) { out[b[0]] = x; out[b[1]] = ts; }
      });
    }
    return out;
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

  // The better of two bests (either may lack it).
  function pickBest(a, c, b) {
    var f = b[0], ts = b[1], x = a && a[f] !== undefined ? a : null, y = c && c[f] !== undefined ? c : null;
    if (!x || !y) return x || y;
    if (x[f] !== y[f]) return (x[f] - y[f]) * b[4] > 0 ? x : y;
    return x[ts] <= y[ts] ? x : y;
  }

  function joinCell(a, c) {
    var out = { p: Math.max(a.p, c.p), w: Math.max(a.w, c.w), k: Math.max(a.k, c.k) };
    BESTS.forEach(function (b) {
      var pick = pickBest(a, c, b);
      if (pick) { out[b[0]] = pick[b[0]]; out[b[1]] = pick[b[1]]; }
    });
    return out;
  }

  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var s = {};
    KEYS.forEach(function (k) {
      var a = x.s[k], c = y.s[k];
      if (!a && !c) return;
      s[k] = (a && c) ? normCell(joinCell(a, c)) : normCell(a || c);
    });
    return { b: x.b, s: s };
  }

  function mergeSolitaire(A, B) {
    var a = A || {}, b = B || {};
    var br = Math.max(isInt(a.br) ? a.br : 0, isInt(b.br) ? b.br : 0);
    var rows = {};
    [a.rows || {}, b.rows || {}].forEach(function (m) {
      if (!m || typeof m !== "object") return;
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

  // A key across every device: p and w add up, k and the bests are the best.
  function totals(d, key) {
    var out = { p: 0, w: 0, k: 0 };
    Object.keys(d.rows).forEach(function (id) {
      var c = d.rows[id].s[key];
      if (!c) return;
      var j = joinCell(out, c);
      j.p = out.p + c.p;
      j.w = out.w + c.w;
      out = j;
    });
    return out;
  }

  // One cell after a game: res = { won, ms, moves, score (null: unscored),
  // streak, ts }. A game counts as played at its first move (won false);
  // a win adds w, the streak and any best.
  function bumpCell(cell, res) {
    var c = cell ? JSON.parse(JSON.stringify(cell)) : { p: 0, w: 0, k: 0 };
    if (!res.won) { c.p += 1; return c; }
    c.w += 1;
    c.p = Math.max(c.p, c.w);
    c.k = Math.max(c.k, Math.min(res.streak, c.w));
    var mine = { t: Math.max(1, Math.min(MAX_MS, res.ms)), tt: res.ts,
                 m: Math.max(1, Math.min(MAX_MOVES, res.moves)), mt: res.ts };
    if (res.score !== null && res.score !== undefined) { mine.s = Math.max(0, Math.min(MAX_SCORE, res.score)); mine.st = res.ts; }
    BESTS.forEach(function (b) {
      var pick = pickBest(c, mine, b);
      if (pick) { c[b[0]] = pick[b[0]]; c[b[1]] = pick[b[1]]; }
    });
    return c;
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.rows && typeof parsed.rows === "object") {
          data = mergeSolitaire(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] solitaire: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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
      deviceId = Date.now().toString(36) + CK.randInt(2176782336).toString(36);
      try { localStorage.setItem(DEVICE_KEY, deviceId); } catch (e) {}
    }
  }

  // Writes one result into this device's row; returns the records beaten.
  function record(key, res) {
    var before = totals(data, key);
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // new epoch after a reset
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    row.s[key] = bumpCell(row.s[key], res);
    data.rows[deviceId] = row;
    data = mergeSolitaire(data, data);
    save();
    if (!res.won) return {};
    return {
      t: before.t === undefined || res.ms < before.t,
      m: before.m === undefined || res.moves < before.m,
      s: res.score !== null && (before.s === undefined || res.score > before.s)
    };
  }

  // ---------- 4. Device-local prefs, sessions, streaks ----------
  var prefs = { v: "k", draw: 1, score: "c", suits: 1, bg: "felt" };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (VARIANTS.indexOf(p.v) >= 0) prefs.v = p.v;
        if (p.draw === 1 || p.draw === 3) prefs.draw = p.draw;
        if (p.score === "c" || p.score === "n") prefs.score = p.score;
        if (p.suits === 1 || p.suits === 2 || p.suits === 4) prefs.suits = p.suits;
        if (p.bg === "felt" || p.bg === "plain") prefs.bg = p.bg;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }
  // Keep the rule prefs in line with a game that is shown (resume, Undo).
  function prefsFrom(g) {
    prefs.v = g.v;
    if (g.v === "k") { prefs.draw = +g.o.charAt(0); prefs.score = g.o.charAt(1); }
    if (g.v === "s") prefs.suits = +g.o;
    savePrefs();
  }

  // sessions = { k|f|s: { g, u: [games], t: ms, c: counted } }
  var sessions = {};

  function normEntry(v, e) {
    if (!e || typeof e !== "object" || !validGame(e.g) || e.g.v !== v) return null;
    var u = Array.isArray(e.u) ? e.u : [];
    var ok = u.length <= UNDO_KEEP && u.every(function (x) { return validGame(x) && x.v === v && x.o === e.g.o && x.deal === e.g.deal; });
    return { g: e.g, u: ok ? u : [], t: isInt(e.t) && e.t >= 0 && e.t <= MAX_MS ? e.t : 0, c: e.c === true };
  }
  function loadSessions() {
    sessions = {};
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (s && typeof s === "object") {
        VARIANTS.forEach(function (v) { var e = normEntry(v, s[v]); if (e) sessions[v] = e; });
      }
    } catch (e) {}
  }
  function saveSession() {
    if (game) {
      if (won) delete sessions[game.v];
      else sessions[game.v] = { g: game, u: undoStack.slice(-UNDO_KEEP), t: elapsedMs(), c: counted };
    }
    try {
      if (Object.keys(sessions).length) localStorage.setItem(SESSION_KEY, JSON.stringify(sessions));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }

  var streaks = {};
  function loadStreaks() {
    streaks = {};
    try {
      var s = JSON.parse(localStorage.getItem(STREAK_KEY) || "null");
      if (s && typeof s === "object") KEYS.forEach(function (k) { if (isInt(s[k]) && s[k] > 0) streaks[k] = s[k]; });
    } catch (e) {}
  }
  function saveStreaks() {
    try { localStorage.setItem(STREAK_KEY, JSON.stringify(streaks)); } catch (e) {}
  }

  // ---------- 5. Game flow ----------
  var game = null;          // the position on the table
  var undoStack = [];       // earlier positions (game objects are never mutated)
  var counted = false;      // first move made: counted as played
  var won = false;
  var hint = null, hintTimer = null;
  var autoTimer = null;
  var clockBase = 0, clockT0 = 0, clockTimer = null;

  function elapsedMs() { return Math.min(MAX_MS, clockBase + (clockT0 ? Date.now() - clockT0 : 0)); }
  function startClock() {
    if (clockT0 || won || !counted || document.visibilityState === "hidden") return;
    clockT0 = Date.now();
    if (!clockTimer) clockTimer = setInterval(renderStatus, 1000);
  }
  function stopClock() {
    if (clockT0) { clockBase = elapsedMs(); clockT0 = 0; }
    clearInterval(clockTimer);
    clockTimer = null;
  }

  function freshGame(v, dealNo) {
    if (v === "k") return dealKlondike(CK.shuffle(CK.newDeck()), prefs.draw, prefs.score === "c");
    if (v === "f") return dealFreeCell(dealNo || CK.randInt(FC_MAX_DEAL) + 1);
    return dealSpider(CK.shuffle(spiderDeck(prefs.suits)), prefs.suits);
  }

  function show(entry) {
    game = entry.g;
    undoStack = entry.u.slice();
    clockBase = entry.t;
    clockT0 = 0;
    counted = entry.c;
    won = false;
    hint = null;
  }

  // Abandoning a counted deal ends its streak; the Undo toast brings
  // back the deal, its undo steps, its clock and the streak.
  function newGame(announce, dealNo) {
    stopAuto();
    stopClock();
    closeDialogs();
    var v = prefs.v, prev = null;
    if (game && counted && !won) {
      var key = keyOf(game);
      prev = { e: { g: game, u: undoStack.slice(), t: clockBase, c: true }, key: key, sk: streaks[key] || 0 };
      delete streaks[key];
      saveStreaks();
    }
    show({ g: freshGame(v, dealNo), u: [], t: 0, c: false });
    saveSession();
    renderAll();
    if (prev) {
      undoToast(t("toast.newgame"), function () {
        stopAuto();
        stopClock();
        show(prev.e);
        prefsFrom(game);
        if (prev.sk) streaks[prev.key] = prev.sk;
        saveStreaks();
        saveSession();
        renderAll();
        startClock();
      });
    } else if (announce) live(t("toast.newgame"));
  }

  // Switching variant parks this deal (clock stopped) and resumes the
  // other variant's deal, or deals one.
  function switchVariant(v) {
    if (!game || v === game.v) return;
    stopAuto();
    stopClock();
    saveSession();
    prefs.v = v;
    savePrefs();
    var e = sessions[v];
    if (e) { show(e); prefsFrom(game); }
    else show({ g: freshGame(v), u: [], t: 0, c: false });
    saveSession();
    renderAll();
    startClock();
    if (canAuto(game)) startAuto();
    landscapeTip();
  }

  function commit(next, msg) {
    undoStack.push(game);
    game = next;
    hint = null;
    if (!counted) { counted = true; record(keyOf(game), { won: false }); }
    startClock();
    if (msg) live(msg);
    if (isWon(game)) { finish(); return; }
    saveSession();
    renderAll();
    if (canAuto(game)) startAuto();
  }

  function moveCards(src, i, dst) {
    var card = pileOf(game, src)[i], runs = game.fd.length;
    var next = applyMove(game, src, i, dst);
    var msg = t("live.move", { c: CK.cardName(card, LANG), p: pileName(dst) });
    if (next.v === "s" && next.fd.length > runs) msg += ". " + t("live.run", { s: CK.suitName(CK.suit(next.fd[next.fd.length - 1][0]), LANG) });
    commit(next, msg);
  }

  function stockAction() {
    if (game.v === "k") {
      var n = drawStock(game);
      if (!n) { showToast(t("toast.stockEmpty")); return; }
      commit(n, n.wa.length ? t("live.draw", { c: CK.cardName(n.wa[n.wa.length - 1], LANG) }) : t("live.recycle"));
    } else if (game.v === "s") {
      var why = dealWhy(game);
      if (why) { showToast(t(why === "empty" ? "toast.dealEmpty" : "toast.stockEmpty")); return; }
      commit(dealRow(game), t("live.deal"));
    }
  }

  function undo() {
    if (autoTimer) return;
    if (won) { showToast(t("toast.wonUndo")); return; }
    if (!undoStack.length) { showToast(t("toast.noUndo")); return; }
    game = undoStack.pop();
    hint = null;
    saveSession();
    renderAll();
    live(t("live.undo"));
  }

  function showHint() {
    if (won) { showToast(t("toast.won")); return; }
    if (autoTimer) return;
    var h = findHint(game);
    if (!h) { showToast(t("toast.noHint")); return; }
    hint = h;
    renderBoard();
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { hint = null; renderBoard(); }, 2400);
    if (h.src === "s0") live(t("live.hintStock"));
    else live(t("live.hint", { c: CK.cardName(pileOf(game, h.src)[h.i], LANG), p: pileName(h.dst) }));
  }

  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // Auto-complete: one card at a time to the foundations (no undo steps:
  // it always ends in a win).
  function startAuto() {
    if (autoTimer || won) return;
    live(t("live.auto"));
    var step = function () {
      autoTimer = null;
      var s = autoStep(game);
      if (!s) { saveSession(); renderAll(); return; }
      game = applyMove(game, s.src, s.i, s.dst);
      if (isWon(game)) { finish(); return; }
      if (reduced) { step(); return; }
      renderBoard();
      renderStatus();
      autoTimer = setTimeout(step, 70);
    };
    autoTimer = setTimeout(step, reduced ? 0 : 250);
  }
  function stopAuto() {
    clearTimeout(autoTimer);
    autoTimer = null;
  }

  var lastWin = null;
  function finish() {
    stopAuto();
    stopClock();
    won = true;
    hint = null;
    var key = keyOf(game), ms = Math.max(1000, elapsedMs());
    var score = scored(game) ? scoreNow(game, ms, true) : null;
    streaks[key] = (streaks[key] || 0) + 1;
    saveStreaks();
    var rec = record(key, { won: true, ms: ms, moves: game.mv, score: score, streak: streaks[key], ts: Date.now() });
    lastWin = { g: game, ms: ms, score: score, rec: rec };
    saveSession();
    renderAll();
    live(t("live.won"));
    celebrate(function () { resultDialog(); });
  }

  // ---------- 6. Render ----------
  function renderAll() {
    renderToolbar();
    renderStatus();
    renderBoard();
  }

  function renderToolbar() {
    [].forEach.call(document.querySelectorAll("#variant-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-v") === game.v;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var wrap = $("board-wrap");
    wrap.classList.toggle("felt", prefs.bg === "felt");
    wrap.classList.toggle("plain", prefs.bg !== "felt");
  }

  function modeName(key) {
    var v = key.charAt(0), parts = [t("v." + v)];
    if (v === "k") {
      parts.push(t("opt.draw" + key.charAt(1)));
      parts.push(t(key.charAt(2) === "c" ? "opt.scoreC" : "opt.scoreN"));
    } else if (v === "s") parts.push(t("opt.suits" + key.charAt(1)));
    return parts.join(" · ");
  }

  function renderStatus() {
    if (!game) return;
    var ms = elapsedMs();
    $("moves").textContent = String(game.mv);
    $("time").textContent = fmtTime(won && lastWin ? lastWin.ms : ms);
    var sc = scored(game);
    $("score-stat").hidden = !sc;
    if (sc) $("score").textContent = String(won && lastWin && lastWin.score !== null ? lastWin.score : scoreNow(game, ms, false));
    var msg;
    if (won) msg = t("turn.won");
    else if (game.v === "f") msg = t("turn.deal", { n: game.deal });
    else msg = modeName(keyOf(game)).split(" · ").slice(1).join(" · ");
    $("turn").textContent = msg;
    $("turn").className = won ? "done" : "";
  }

  var geo = null;           // last layout: { cw, ch, piles: { ref: { x, y, w, h } } }
  var cardEls = {};         // ref → rendered card elements by index

  function computeLayout() {
    var wrap = $("board-wrap"), W = wrap.clientWidth, H = wrap.clientHeight, cols = COLS[game.v];
    if (W <= 0 || H <= 0) return null;
    var pad = W < 480 ? 4 : 10, gap = Math.max(2, Math.min(12, Math.round(W * (cols > 8 && W < 480 ? 0.006 : 0.012))));
    var cw = Math.floor((W - 2 * pad - gap * (cols - 1)) / cols);
    cw = Math.max(24, Math.min(cw, 104, Math.floor(H / 4.4)));
    var ch = Math.round(cw * 1.4), f = Math.max(12, Math.round(cw * 0.32));
    var upMin = Math.ceil(f * 1.3 + 3), up = Math.max(upMin, Math.round(ch * 0.27)), dn = Math.max(4, Math.round(ch * 0.1));
    var x0 = Math.max(pad, Math.round((W - (cols * cw + (cols - 1) * gap)) / 2));
    var X = function (i) { return x0 + i * (cw + gap); };
    var topY = pad, tabY = pad + ch + Math.max(8, gap * 2), avail = H - tabY - pad - ch;
    var out = { cw: cw, ch: ch, X: X, topY: topY, tabY: tabY, piles: {}, cols: [], bottom: H };
    game.tab.forEach(function (p, c) {
      var d = game.down[c], u = p.length - d, ud = up, dd = dn;
      if (d * dd + Math.max(0, u - 1) * ud > avail) {
        if (u > 1) ud = Math.max(upMin, Math.floor((avail - d * dd) / (u - 1)));
        if (d && d * dd + Math.max(0, u - 1) * ud > avail) dd = Math.max(3, Math.floor((avail - Math.max(0, u - 1) * ud) / d));
      }
      var ys = [], y = tabY;
      for (var i = 0; i < p.length; i++) { ys.push(y); y += i < d ? dd : ud; }
      var last = p.length ? ys[p.length - 1] : tabY;
      out.cols.push(ys);
      out.piles["t" + c] = { x: X(c), y: tabY, w: cw, h: last - tabY + ch };
      out.bottom = Math.max(out.bottom, last + ch + pad);
    });
    // top row
    if (game.v === "k") {
      out.piles.s0 = { x: X(0), y: topY, w: cw, h: ch };
      out.piles.w0 = { x: X(1), y: topY, w: cw, h: ch };
      for (var k = 0; k < 4; k++) out.piles["f" + k] = { x: X(3 + k), y: topY, w: cw, h: ch };
    } else if (game.v === "f") {
      for (k = 0; k < 4; k++) {
        out.piles["c" + k] = { x: X(k), y: topY, w: cw, h: ch };
        out.piles["f" + k] = { x: X(4 + k), y: topY, w: cw, h: ch };
      }
    } else {
      out.piles.s0 = { x: X(0), y: topY, w: cw, h: ch };
      for (k = 0; k < 8; k++) out.piles["f" + k] = { x: X(2 + k), y: topY, w: cw, h: ch };
    }
    return out;
  }

  function pileName(ref) {
    var k = ref.charAt(0);
    if (k === "t") return t("pile.t", { n: +ref.slice(1) + 1 });
    if (k === "f") return t(game && game.v === "s" ? "pile.done" : "pile.f");
    return t("pile." + k);
  }

  function place(el, x, y, z) {
    el.style.left = x + "px";
    el.style.top = y + "px";
    if (z !== undefined) el.style.zIndex = String(z);
  }

  function slotEl(ref, r, label, icon) {
    var s = document.createElement("div");
    s.className = "slot";
    s.setAttribute("data-p", ref);
    place(s, r.x, r.y);
    s.style.width = r.w + "px";
    s.style.height = r.h + "px";
    if (icon) s.innerHTML = UI_ICONS[icon];
    else if (label) { var l = document.createElement("span"); l.textContent = label; s.appendChild(l); }
    return s;
  }

  function cardNode(ref, i, id, faceUp, x, y, z) {
    var el = CK.cardEl(id, { faceUp: faceUp });
    el.setAttribute("data-p", ref);
    el.setAttribute("data-i", String(i));
    place(el, x, y, z);
    (cardEls[ref] = cardEls[ref] || [])[i] = el;
    return el;
  }

  // The focus stop of a pile: its top card, or its empty slot.
  function focusStop(el, ref, label) {
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", label);
    el.setAttribute("data-stop", ref);
  }

  function topLabel(ref, p) {
    var name = pileName(ref);
    return p.length ? t("pile.card", { p: name, c: CK.cardName(p[p.length - 1], LANG) }) : t("pile.empty", { p: name });
  }

  function renderBoard() {
    if (!game) return;
    var board = $("board"), had = document.activeElement && board.contains(document.activeElement) ?
      document.activeElement.getAttribute("data-stop") : null;
    var g = game, L = computeLayout();
    if (!L) return;
    geo = L;
    cardEls = {};
    board.textContent = "";
    board.style.setProperty("--ock-w", L.cw + "px");
    board.classList.toggle("ock-roomy", L.cw >= 64);
    board.setAttribute("aria-label", t("board.label", { v: t("v." + g.v) }));
    var frag = document.createDocumentFragment(), z = 1;
    var add = function (n) { frag.appendChild(n); return n; };

    // Stock
    if (L.piles.s0) {
      var sr = L.piles.s0, sn;
      if (g.st.length) {
        var shown = g.v === "s" ? Math.min(5, g.st.length / 10) : Math.min(3, Math.ceil(g.st.length / 8));
        for (var k = 0; k < shown; k++) {
          sn = add(cardNode("s0", g.st.length - shown + k, g.st[g.st.length - shown + k], false, sr.x + k * 2, sr.y + k, z++));
        }
        var badge = document.createElement("span");
        badge.className = "count";
        badge.textContent = String(g.v === "s" ? g.st.length / 10 : g.st.length);
        sn.appendChild(badge);
        focusStop(sn, "s0", g.v === "s" ? t("pile.stockSpider", { n: g.st.length / 10 }) : t("pile.stock", { n: g.st.length }));
      } else {
        sn = add(slotEl("s0", sr, "", g.v === "k" && g.wa.length ? "recycle" : ""));
        focusStop(sn, "s0", g.v === "k" && g.wa.length ? t("pile.recycle") : t("pile.empty", { p: pileName("s0") }));
      }
    }
    // Waste
    if (g.v === "k") {
      var wr = L.piles.w0, wn = add(slotEl("w0", wr, "", ""));
      var fan = +g.o.charAt(0) === 3 ? 3 : 1, from = Math.max(0, g.wa.length - Math.max(fan, 2));
      var dx = Math.round(L.cw * 0.3);
      for (var w = from; w < g.wa.length; w++) {
        var pos = fan === 3 ? Math.max(0, w - (g.wa.length - 3)) : 0;
        wn = add(cardNode("w0", w, g.wa[w], true, wr.x + pos * dx, wr.y, z++));
      }
      focusStop(wn, "w0", topLabel("w0", g.wa));
    }
    // Free cells
    g.fc.forEach(function (p, c) {
      var r = L.piles["c" + c], n = add(slotEl("c" + c, r, "", "cell"));
      if (p.length) n = add(cardNode("c" + c, 0, p[0], true, r.x, r.y, z++));
      focusStop(n, "c" + c, topLabel("c" + c, p));
    });
    // Foundations
    var nf = g.v === "s" ? 8 : 4;
    for (var f = 0; f < nf; f++) {
      var fr = L.piles["f" + f], fp = g.fd[f] || [], fn = add(slotEl("f" + f, fr, g.v === "s" ? "" : "A", g.v === "s" ? "run" : ""));
      for (var j = Math.max(0, fp.length - 2); j < fp.length; j++) fn = add(cardNode("f" + f, j, fp[j], true, fr.x, fr.y, z++));
      if (g.v !== "s") focusStop(fn, "f" + f, topLabel("f" + f, fp));
    }
    // Columns
    g.tab.forEach(function (p, c) {
      var r = L.piles["t" + c], ys = L.cols[c];
      var n = add(slotEl("t" + c, { x: r.x, y: r.y, w: L.cw, h: L.ch }, g.v === "k" ? "K" : "", ""));
      for (var i = 0; i < p.length; i++) n = add(cardNode("t" + c, i, p[i], i >= g.down[c], r.x, ys[i], z++));
      focusStop(n, "t" + c, topLabel("t" + c, p));
    });
    board.appendChild(frag);
    board.style.height = L.bottom + "px";
    markHint();
    if (had) {
      var back = board.querySelector('[data-stop="' + had + '"]');
      if (back) back.focus({ preventScroll: true });
    }
  }

  function markHint() {
    if (!hint) return;
    var els = cardEls[hint.src] || [];
    if (hint.src === "s0") {
      var s = $("board").querySelector('[data-stop="s0"]');
      if (s) s.classList.add("ock-hl", "hl");
      return;
    }
    for (var i = hint.i; i < els.length; i++) if (els[i]) els[i].classList.add("ock-hl");
    var d = $("board").querySelector('[data-stop="' + hint.dst + '"]');
    if (d) d.classList.add("ock-hl", "hl");
  }

  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // A tap that leads nowhere: the cards shake (and the reason is read out).
  function shake(ref, i) {
    var els = (cardEls[ref] || []).slice(Math.max(0, i));
    els.forEach(function (el) {
      if (!el) return;
      el.classList.remove("shake");
      void el.offsetWidth;
      el.classList.add("shake");
      setTimeout(function () { el.classList.remove("shake"); }, 400);
    });
  }

  // Spider on a narrow portrait screen: suggest landscape once per visit.
  var tipShown = false;
  function landscapeTip() {
    if (tipShown || !game || game.v !== "s") return;
    if (window.innerWidth < 520 && window.innerHeight > window.innerWidth) {
      tipShown = true;
      showToast(t("toast.landscape"));
    }
  }

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
  function segRow(title, items, current, onPick) {
    var wrap = el("div", "opt-row");
    wrap.appendChild(el("div", "dlg-sub", title));
    var seg = el("div", "seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", title);
    items.forEach(function (it) {
      var b = el("button", "seg-btn" + (it[0] === current ? " active" : ""), it[1]);
      b.type = "button";
      b.setAttribute("aria-pressed", it[0] === current ? "true" : "false");
      b.addEventListener("click", function () { if (it[0] !== current) onPick(it[0]); });
      seg.appendChild(b);
    });
    wrap.appendChild(seg);
    return wrap;
  }

  // A rule change starts a new deal (Undo toast if one was under way).
  function setRule(name, value) {
    prefs[name] = value;
    savePrefs();
    newGame(true);
  }

  function optionsDialog() {
    var dlg = makeDialog("sol-options"), v = game.v, focus = null;
    dlg.appendChild(el("div", "dlg-title", t("opts.title") + " · " + t("v." + v)));
    if (v === "k") {
      dlg.appendChild(segRow(t("opts.draw"), [[1, t("opt.draw1")], [3, t("opt.draw3")]], prefs.draw,
        function (x) { setRule("draw", x); }));
      dlg.appendChild(segRow(t("opts.score"), [["c", t("opt.scoreC")], ["n", t("opt.scoreN")]], prefs.score,
        function (x) { setRule("score", x); }));
    } else if (v === "s") {
      dlg.appendChild(segRow(t("opts.suits"), [[1, t("opt.suits1")], [2, t("opt.suits2")], [4, t("opt.suits4")]], prefs.suits,
        function (x) { setRule("suits", x); }));
    } else {
      var lab = el("label", "dlg-sub", t("opts.deal"));
      lab.setAttribute("for", "deal-no");
      dlg.appendChild(lab);
      var line = el("div", "deal-line");
      var inp = el("input", "deal-input");
      inp.id = "deal-no";
      inp.type = "number";
      inp.min = "1";
      inp.max = String(FC_MAX_DEAL);
      inp.inputMode = "numeric";
      inp.value = String(game.deal);
      var play = button(t("opts.play"), "primary", function () {
        var n = Number(inp.value);
        if (!isInt(n) || n < 1 || n > FC_MAX_DEAL) { showToast(t("toast.badDeal")); inp.focus(); return; }
        newGame(true, n);
      });
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); play.click(); } });
      line.appendChild(inp);
      line.appendChild(play);
      dlg.appendChild(line);
      dlg.appendChild(el("div", "dlg-note", t("opts.current", { n: game.deal })));
      focus = inp;
    }
    if (v !== "f") dlg.appendChild(el("div", "dlg-note", t("opts.note")));
    dlg.appendChild(segRow(t("opts.table"), [["felt", t("opt.felt")], ["plain", t("opt.plain")]], prefs.bg, function (x) {
      prefs.bg = x;
      savePrefs();
      renderToolbar();
      dlg.close();
    }));
    var acts = el("div", "dlg-actions");
    var close = button(t("opts.close"), "", function () { dlg.close(); });
    acts.appendChild(close);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    (focus || close).focus();
  }

  function resultDialog() {
    if (!won || !lastWin) return;
    var g = lastWin.g, key = keyOf(g), s = totals(data, key);
    var dlg = makeDialog("sol-result");
    dlg.appendChild(el("div", "dlg-title", t("res.title") + " · " + modeName(key)));
    dlg.appendChild(el("div", "dlg-hero", t("res.hero")));
    var badges = [];
    if (lastWin.rec.t) badges.push(t("res.recT"));
    if (lastWin.rec.m) badges.push(t("res.recM"));
    if (lastWin.rec.s) badges.push(t("res.recS"));
    if (badges.length) dlg.appendChild(el("div", "dlg-badge", badges.join(" · ")));
    dlg.appendChild(row(t("res.time"), fmtTime(lastWin.ms)));
    dlg.appendChild(row(t("res.moves"), String(g.mv)));
    if (lastWin.score !== null) dlg.appendChild(row(t("res.score"), String(lastWin.score)));
    dlg.appendChild(row(t("res.rate"), s.w + " / " + s.p + " (" + Math.round(100 * s.w / Math.max(1, s.p)) + "%)"));
    dlg.appendChild(row(t("res.streak"), (streaks[key] || 0) + " · " + s.k));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("res.close"), "", function () { dlg.close(); }));
    var again = button(t("res.again"), "primary", function () { dlg.close(); newGame(false); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    again.focus();
  }

  function statsDialog(v) {
    v = v || game.v;
    var dlg = makeDialog("sol-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    var tabs = el("div", "seg stats-seg");
    tabs.setAttribute("role", "group");
    VARIANTS.forEach(function (x) {
      var b = el("button", "seg-btn" + (x === v ? " active" : ""), t("v." + x));
      b.type = "button";
      b.setAttribute("aria-pressed", x === v ? "true" : "false");
      b.addEventListener("click", function () { if (x !== v) statsDialog(x); });
      tabs.appendChild(b);
    });
    dlg.appendChild(tabs);
    var any = false;
    KEYS.filter(function (k) { return k.charAt(0) === v; }).forEach(function (k) {
      var s = totals(data, k), scoredKey = k.charAt(0) === "s" || k.charAt(2) === "c";
      if (v !== "f") dlg.appendChild(el("div", "dlg-sub", modeName(k).split(" · ").slice(1).join(" · ")));
      if (!s.p) { dlg.appendChild(row(t("stats.played"), t("stats.none"))); return; }
      any = true;
      dlg.appendChild(row(t("stats.played"), s.p + " · " + s.w + " (" + Math.round(100 * s.w / s.p) + "%)"));
      if (s.t !== undefined) dlg.appendChild(row(t("stats.bestT"), fmtTime(s.t) + " · " + fmtDate(s.tt)));
      if (s.m !== undefined) dlg.appendChild(row(t("stats.bestM"), s.m + " · " + fmtDate(s.mt)));
      if (scoredKey && s.s !== undefined) dlg.appendChild(row(t("stats.bestS"), s.s + " · " + fmtDate(s.st)));
      dlg.appendChild(row(t("stats.streak"), (streaks[k] || 0) + " · " + s.k));
    });
    var acts = el("div", "dlg-actions");
    var reset = button(t("stats.reset"), "danger", function () {
      dlg.close();
      confirmDialog(t("confirm.reset"), resetRecords);
    });
    reset.disabled = !any && !KEYS.some(function (k) { return totals(data, k).p > 0; });
    acts.appendChild(reset);
    var close = button(t("stats.close"), "primary", function () { dlg.close(); });
    acts.appendChild(close);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    close.focus();
  }

  function confirmDialog(msg, onYes) {
    var dlg = makeDialog("sol-confirm");
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
  // starts its own row again from zero. Local streaks go too.
  function resetRecords() {
    data.br = Math.max(Date.now(), data.br + 1);
    data = mergeSolitaire(data, data);
    save();
    streaks = {};
    saveStreaks();
    renderStatus();
    showToast(t("toast.reset"));
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "solitaire", title: String(text) })) return;
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

  // ---------- 9. Win animation ----------
  // The cards leave the foundations one by one and bounce off the
  // bottom edge, leaving a trail. A tap or a key ends it; reduced motion
  // skips it.
  function celebrate(done) {
    var cv = $("fx"), wrap = $("board-wrap");
    var finished = false, raf = 0;
    var end = function () {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      cv.hidden = true;
      cv.removeEventListener("pointerdown", end);
      document.removeEventListener("keydown", end, true);
      done();
    };
    if (reduced || !geo || !cv.getContext) { setTimeout(end, 400); return; }
    var r = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    cv.style.left = r.left + "px";
    cv.style.top = r.top + "px";
    cv.style.width = r.width + "px";
    cv.style.height = r.height + "px";
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    cv.hidden = false;
    var ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var g = lastWin.g, queue = [], back = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    for (var rk = 13; rk >= 1; rk--) {
      g.fd.forEach(function (p, f) {
        var pr = geo.piles["f" + f];
        if (pr && p[rk - 1] !== undefined) queue.push({ id: p[rk - 1], x: pr.x, y: pr.y - wrap.scrollTop });
      });
    }
    var flying = [], next = 0, last = 0, W = r.width, H = r.height, cw = geo.cw, ch = geo.ch, t0 = performance.now();
    var frame = function (now) {
      if (finished) return;
      if (now - last > 110 && next < queue.length) {
        var q = queue[next++], dir = CK.randInt(2) ? 1 : -1;
        flying.push({ id: q.id, x: q.x, y: q.y, vx: dir * (2 + CK.randInt(40) / 10), vy: -CK.randInt(60) / 10 });
        last = now;
      }
      flying = flying.filter(function (c) {
        c.vy += 0.45;
        c.x += c.vx;
        c.y += c.vy;
        if (c.y + ch > H) { c.y = H - ch; c.vy = -c.vy * 0.72; }
        CK.paintCard(ctx, c.id, c.x, c.y, cw, { back: back });
        return c.x > -cw && c.x < W;
      });
      if ((next >= queue.length && !flying.length) || now - t0 > 9000) { end(); return; }
      raf = requestAnimationFrame(frame);
    };
    cv.addEventListener("pointerdown", end);
    document.addEventListener("keydown", end, true);
    raf = requestAnimationFrame(frame);
  }

  // ---------- Toolbar icons (R9: injected by JS) ----------
  var UI_ICONS = {
    opts:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
    undo:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    hint:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>',
    new:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    recycle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
    cell:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="16" rx="2"/><path d="M9 12h6"/></svg>',
    run:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>'
  };

  // ---------- 10. Input ----------
  var lastTapMove = 0;
  var dragCtl = null;
  var overEl = null;

  function pick(node) {
    if (!game || won || autoTimer) return null;
    var ref = node.getAttribute("data-p"), i = node.hasAttribute("data-i") ? +node.getAttribute("data-i") : -1;
    var data = { p: ref, i: i };
    if (i < 0 || !runFrom(game, ref, i)) return { data: data, els: [] };
    var list = cardEls[ref] || [], els = [];
    for (var k = i; k < list.length; k++) if (list[k]) els.push(list[k]);
    return { data: data, els: els };
  }

  function onTap(d, count) {
    if (count === 2 && Date.now() - lastTapMove < 700) return;   // the first tap already moved it
    tapAt(d.p, d.i);
  }

  function tapAt(ref, i) {
    if (!game) return;
    if (won) { showToast(t("toast.won")); return; }
    if (autoTimer) return;
    if (ref === "s0") { stockAction(); return; }
    if (i < 0) return;                                              // an empty place
    if (ref.charAt(0) === "t" && i < game.down[+ref.slice(1)]) { live(t("live.down")); shake(ref, i); return; }
    var bt = bestTarget(game, ref, i);
    if (bt.dst) { lastTapMove = Date.now(); moveCards(ref, i, bt.dst); return; }
    shake(ref, i);
    if (bt.why === "cells") showToast(t("toast.cells", { n: maxRun(game, false) }));
    else live(t("live.nomove"));
  }

  // Enter / Space on a focused pile: a column tries its longest movable
  // run first, then shorter ones; other piles tap their top card.
  function keyTap(ref) {
    if (!game) return;
    var p = pileOf(game, ref) || [];
    if (ref.charAt(0) === "t" && p.length && !won && !autoTimer) {
      for (var i = game.down[+ref.slice(1)]; i < p.length; i++) {
        if (runFrom(game, ref, i) && bestTarget(game, ref, i).dst) { tapAt(ref, i); return; }
      }
    }
    tapAt(ref, ref === "s0" ? -1 : p.length - 1);
  }

  // The pile a dragged run lands on: the legal one it overlaps most.
  function dropTarget(d, rect) {
    var cards = runFrom(game, d.p, d.i), b = $("board").getBoundingClientRect();
    var res = { dst: "", why: "" }, bestA = 0;
    if (!cards || !geo) return res;
    var x = rect.left - b.left, y = rect.top - b.top;
    Object.keys(geo.piles).forEach(function (ref) {
      if (ref === d.p || ref === "s0" || ref === "w0") return;
      var p = geo.piles[ref];
      var ox = Math.min(x + rect.width, p.x + p.w) - Math.max(x, p.x);
      var oy = Math.min(y + rect.height, p.y + p.h) - Math.max(y, p.y);
      if (ox <= 0 || oy <= 0) return;
      var why = canPlace(game, d.p, cards, ref);
      if (why) { if (why === "cells") res.why = why; return; }
      if (ox * oy > bestA) { bestA = ox * oy; res.dst = ref; }
    });
    return res;
  }

  function markOver(ref) {
    if (overEl) overEl.classList.remove("drop-ok");
    overEl = ref ? $("board").querySelector('[data-stop="' + ref + '"]') : null;
    if (overEl) overEl.classList.add("drop-ok");
  }

  function wireBoard() {
    var board = $("board");
    dragCtl = CK.dragHelper(board, {
      selector: "[data-p]",
      pick: pick,
      tap: onTap,
      over: function (d, rect) { markOver(dropTarget(d, rect).dst); },
      drop: function (d, rect) {
        markOver("");
        var r = dropTarget(d, rect);
        if (!r.dst) {
          if (r.why === "cells") showToast(t("toast.cells", { n: maxRun(game, false) }));
          return false;
        }
        moveCards(d.p, d.i, r.dst);
        return true;
      },
      end: function () { markOver(""); }
    });
    board.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var n = e.target && e.target.getAttribute && e.target.getAttribute("data-stop");
      if (!n) return;
      e.preventDefault();
      keyTap(n);
    });
  }

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === "KeyZ") {
        e.preventDefault();
        undo();
        return;
      }
      if (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey || e.repeat) return;   // never steal OS combos
      if (e.code === "KeyH") { e.preventDefault(); showHint(); }
      else if (e.code === "KeyN") { e.preventDefault(); newGame(true); }
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
    api.registerSlice("solitaire", sliceGet, sliceSet, STORAGE_KEY, mergeSolitaire);
  }

  function sliceGet() {
    return mergeSolitaire(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeSolitaire(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    // no toast, no re-render of the table (sync feedback = taskbar dot)
  }

  // ---------- 12. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
  }

  function paintStatic() {
    [["opts-btn", "opts", "btn.opts"], ["undo-btn", "undo", "btn.undo"], ["hint-btn", "hint", "btn.hint"],
     ["new-btn", "new", "btn.new"], ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    $("time-stat").setAttribute("aria-label", t("st.time"));
    $("time-stat").title = t("st.time");
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#variant-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () { switchVariant(b.getAttribute("data-v")); });
    });
    $("opts-btn").addEventListener("click", optionsDialog);
    $("undo-btn").addEventListener("click", undo);
    $("hint-btn").addEventListener("click", showHint);
    $("new-btn").addEventListener("click", function () { newGame(true); $("new-btn").blur(); });
    $("stats-btn").addEventListener("click", function () { statsDialog(); });
    wireBoard();
    wireKeyboard();

    var relayout = function () {
      if (dragCtl) dragCtl.cancel();
      renderBoard();
    };
    if (window.ResizeObserver) new ResizeObserver(relayout).observe($("board-wrap"));
    else window.addEventListener("resize", relayout);

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { stopClock(); saveSession(); }
      else startClock();
    });
    window.addEventListener("pagehide", function () { stopClock(); saveSession(); });
  }

  function boot() {
    load();
    ensureDeviceId();
    loadPrefs();
    loadSessions();
    loadStreaks();
    applyI18n();
    paintStatic();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    var e = sessions[prefs.v];
    if (e) { show(e); prefsFrom(game); }
    else show({ g: freshGame(prefs.v), u: [], t: 0, c: false });
    saveSession();
    renderAll();
    startClock();
    if (canAuto(game)) startAuto();
    landscapeTip();
  }

  boot();
})();
