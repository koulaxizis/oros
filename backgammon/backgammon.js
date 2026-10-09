// ============================================================
// orOS Backgammon — App logic (v1.0.0)
// Standard backgammon (in Greece: Πόρτες, the first game of Τάβλι).
// 15 checkers each; roll two dice (crypto RNG), move one checker per
// die, doubles play four times. A single opposing checker (a blot) is
// hit to the bar and must come back in before anything else moves.
// With every checker home, bear off: the exact die, or a higher die
// from the highest point. As many dice as possible must be used; if
// only one of two can be, the larger one. No legal move: the turn
// passes (with a toast). First to bear off all 15 wins 1 point, a
// gammon (2) if the other has borne off none, a backgammon (3) if it
// also still has a checker on the bar or in the winner's home board.
//   - vs Computer (you are White), 3 levels: Easy (a random legal
//     play) · Medium (heuristic: pips, made points, primes, blots,
//     the bar) · Hard (the best plays by that heuristic, each scored
//     against the opponent's best answer to all 21 rolls: 1-ply
//     expectimax, 700 ms budget)
//   - 2 players on one device, with a running points score
//   - tap / click a checker, then a lit destination; drag on desktop;
//     Undo (Z) any step of the turn until Done (Enter); pip counts
//   - the opening roll: one die each, the higher starts with both
//   - no doubling cube (a later idea)
// Data:
//   - synced slice "backgammon" (oros-backgammon-data): results vs the
//     computer per level (won, lost, points won, points lost) as
//     per-device counter rows (each device only grows its own row;
//     merge = per-row join) + a reset stamp br
//   - device-local (R10): oros-backgammon-prefs (mode, level),
//     oros-backgammon-session (the game in progress and the 2-player
//     score), oros-backgammon-device (row id), oros-backgammon-sfx
// Sections:
//   1. Constants, i18n, helpers
//   2. Board model (moves, the dice rules, scoring)
//   3. Computer player (easy / heuristic / expectimax)
//   4. Synced data: load / save / normalize / merge (R5, R26)
//   5. Device-local prefs + session
//   6. Game flow (new, roll, move, undo, done, pass, computer, finish)
//   7. Render (toolbar, status, actions, SVG board)
//   8. Pointer input (tap, drag)
//   9. Dialogs (result, records, confirm)
//  10. Toasts
//  11. Sound
//  12. Keyboard (Space, Enter, arrows, Z, N, Contract Β)
//  13. Sync slice + palette
//  14. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-backgammon-data";
  var PREFS_KEY   = "oros-backgammon-prefs";
  var SESSION_KEY = "oros-backgammon-session";
  var DEVICE_KEY  = "oros-backgammon-device";
  var SFX_KEY     = "oros-backgammon-sfx";
  var DATA_VER    = 1;

  var LEVELS = ["e", "m", "h"];
  var MODES = ["ai", "duo"];
  var PHASES = ["open", "roll", "move", "done"];
  var HARD_CANDS = 16, HARD_BUDGET = 700;   // plays looked at, ms
  var AI_ROLL_DELAY = 550, AI_STEP = 520;   // ms, so the computer's play is visible
  var PASS_DELAY = 1600;                    // ms before a turn with no move passes

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
      "mode.ai": "vs Computer", "mode.duo": "2 players",
      "level.e": "Easy", "level.m": "Medium", "level.h": "Hard",
      "side.you": "You", "side.ai": "Computer",
      "player.0": "White", "player.1": "Black",
      "pips": "{n} pips",
      "turn.open": "Roll to see who starts",
      "turn.openTie": "Both rolled {n}: roll again",
      "turn.youRoll": "Your turn: roll the dice",
      "turn.pRoll": "{player}: roll the dice",
      "turn.youMove": "Your move",
      "turn.pMove": "{player} to move",
      "turn.youDone": "Press Done, or undo a move",
      "turn.pDone": "{player}: press Done, or undo",
      "turn.ai": "Computer is thinking…",
      "turn.aiRolls": "The computer rolls…",
      "turn.pass": "{who}: no legal move",
      "turn.win": "{who} won", "turn.youwin": "You won",
      "act.roll": "Roll", "act.undo": "Undo", "act.done": "Done",
      "act.rollKey": "Roll the dice (Space)",
      "act.undoKey": "Undo the last step (Z)",
      "act.doneKey": "End the turn (Enter)",
      "btn.new": "New game (N)",
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "board.label": "Backgammon board. Arrows pick a checker or a destination, Enter moves, Space rolls.",
      "pt.label": "Point {n}",
      "pt.bar": "The bar",
      "pt.off": "Bear off",
      "pt.has": "{n} {color}",
      "pt.empty": "empty",
      "color.0": "white", "color.1": "black",
      "live.roll": "{who} rolled {a} and {b}",
      "live.open": "Opening roll: White {a}, Black {b}. {who} starts",
      "live.move": "{who}: {moves}",
      "live.sel": "Selected {from}. Targets: {targets}",
      "live.none": "nothing",
      "res.title": "Game over",
      "res.youwin": "You win!",
      "res.ailose": "The computer wins",
      "res.pwin": "{player} wins!",
      "res.k1": "Single game · 1 point",
      "res.k2": "Gammon · 2 points",
      "res.k3": "Backgammon · 3 points",
      "res.again": "Play again",
      "res.close": "Close",
      "res.series": "Points",
      "stats.title": "Records vs computer",
      "stats.head": "Won · lost",
      "stats.pts": "points {a} – {b}",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "confirm.reset": "Delete the records vs the computer on every device, and this device's 2-player score?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Records reset",
      "toast.newgame": "New game started",
      "toast.undo": "Undo",
      "toast.save": "Could not save: storage is full",
      "toast.rollFirst": "Roll the dice first (Space)",
      "toast.rolled": "The dice are already rolled",
      "toast.notDone": "Use your dice first: every die that can be played must be",
      "toast.nothing": "Nothing to undo in this turn",
      "toast.cant": "That checker cannot move with these dice",
      "toast.bar": "Bring the checker on the bar in first",
      "toast.notThere": "It cannot go there",
      "toast.noMore": "No more moves: press Done (Enter)",
      "toast.pick": "Pick one of your checkers that can move",
      "toast.wait": "The computer is playing",
      "toast.over": "The game is over: start a new one (N)",
      "toast.pass": "{who}: no legal move, the turn passes"
    },
    el: {
      "mode.ai": "Με υπολογιστή", "mode.duo": "2 παίκτες",
      "level.e": "Εύκολο", "level.m": "Μεσαίο", "level.h": "Δύσκολο",
      "side.you": "Εσύ", "side.ai": "Υπολογιστής",
      "player.0": "Λευκά", "player.1": "Μαύρα",
      "pips": "{n} πόντοι",
      "turn.open": "Ρίξε για να δεις ποιος ξεκινά",
      "turn.openTie": "Φέρατε κι οι δύο {n}: ξαναρίξτε",
      "turn.youRoll": "Σειρά σου: ρίξε τα ζάρια",
      "turn.pRoll": "{player}: ρίξτε τα ζάρια",
      "turn.youMove": "Παίζεις εσύ",
      "turn.pMove": "Παίζουν τα {player}",
      "turn.youDone": "Πάτα Τέλος ή αναίρεσε μια κίνηση",
      "turn.pDone": "{player}: Τέλος ή αναίρεση",
      "turn.ai": "Ο υπολογιστής σκέφτεται…",
      "turn.aiRolls": "Ο υπολογιστής ρίχνει…",
      "turn.pass": "{who}: καμία έγκυρη κίνηση",
      "turn.win": "Κέρδισαν: {who}", "turn.youwin": "Κέρδισες",
      "act.roll": "Ζάρια", "act.undo": "Αναίρεση", "act.done": "Τέλος",
      "act.rollKey": "Ρίξε τα ζάρια (Space)",
      "act.undoKey": "Αναίρεση του τελευταίου βήματος (Z)",
      "act.doneKey": "Τέλος γύρου (Enter)",
      "btn.new": "Νέο παιχνίδι (N)",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "board.label": "Ταμπλό τάβλι. Τα βέλη διαλέγουν πούλι ή προορισμό, το Enter το παίζει, το Space ρίχνει τα ζάρια.",
      "pt.label": "Θέση {n}",
      "pt.bar": "Η μέση (μπάρα)",
      "pt.off": "Μάζεμα",
      "pt.has": "{n} {color}",
      "pt.empty": "άδεια",
      "color.0": "λευκά", "color.1": "μαύρα",
      "live.roll": "{who}: {a} και {b}",
      "live.open": "Πρώτη ζαριά: Λευκά {a}, Μαύρα {b}. Ξεκινά: {who}",
      "live.move": "{who}: {moves}",
      "live.sel": "Επιλέχθηκε {from}. Προορισμοί: {targets}",
      "live.none": "κανένας",
      "res.title": "Τέλος",
      "res.youwin": "Κέρδισες!",
      "res.ailose": "Κέρδισε ο υπολογιστής",
      "res.pwin": "Κέρδισαν τα {player}!",
      "res.k1": "Απλή νίκη · 1 πόντος",
      "res.k2": "Διπλή νίκη (γκάμον) · 2 πόντοι",
      "res.k3": "Τριπλή νίκη (μπακγκάμον) · 3 πόντοι",
      "res.again": "Ξανά",
      "res.close": "Κλείσιμο",
      "res.series": "Πόντοι",
      "stats.title": "Ρεκόρ με υπολογιστή",
      "stats.head": "Νίκες · ήττες",
      "stats.pts": "πόντοι {a} – {b}",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ με τον υπολογιστή σε όλες τις συσκευές και το σκορ 2 παικτών αυτής της συσκευής;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.newgame": "Ξεκίνησε νέο παιχνίδι",
      "toast.undo": "Αναίρεση",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "toast.rollFirst": "Ρίξε πρώτα τα ζάρια (Space)",
      "toast.rolled": "Τα ζάρια έχουν ήδη ριχτεί",
      "toast.notDone": "Παίξε πρώτα τα ζάρια σου: όποιο ζάρι παίζεται πρέπει να παιχτεί",
      "toast.nothing": "Δεν υπάρχει κίνηση για αναίρεση σε αυτόν τον γύρο",
      "toast.cant": "Αυτό το πούλι δεν κινείται με αυτά τα ζάρια",
      "toast.bar": "Βάλε πρώτα μέσα το πούλι από τη μέση",
      "toast.notThere": "Δεν μπορεί να πάει εκεί",
      "toast.noMore": "Δεν υπάρχουν άλλες κινήσεις: πάτα Τέλος (Enter)",
      "toast.pick": "Διάλεξε ένα δικό σου πούλι που κινείται",
      "toast.wait": "Παίζει ο υπολογιστής",
      "toast.over": "Το παιχνίδι τελείωσε: ξεκίνα νέο (N)",
      "toast.pass": "{who}: καμία έγκυρη κίνηση, χάνει τη σειρά"
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
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  // crypto RNG with rejection sampling (same as Dice / Memory)
  function randInt(n) {
    var buf = new Uint32Array(1);
    var lim = 0xFFFFFFFF - (0xFFFFFFFF % n);
    while (true) {
      crypto.getRandomValues(buf);
      if (buf[0] < lim) return buf[0] % n;
    }
  }

  function reducedMotion() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch (e) { return false; }
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("backgammon.js v" + (SCRIPT_V || "?") + " boot");
  })();


  // ---------- 2. Board model ----------
  // c = [white, black]: per player an array of 26 counts in that
  // player's OWN numbering: [0] borne off, [1..24] points (home board
  // 1–6, moving down), [25] the bar. Player p's point i is the other
  // player's point 25 − i. White (0) numbers the board as drawn.
  function startPos() {
    var a = [];
    for (var i = 0; i < 26; i++) a.push(0);
    a[24] = 2; a[13] = 5; a[8] = 3; a[6] = 5;
    return [a, a.slice()];
  }

  function cloneC(c) { return [c[0].slice(), c[1].slice()]; }

  function posKey(c) {
    return String.fromCharCode.apply(null, c[0]) + String.fromCharCode.apply(null, c[1]);
  }

  function allHome(m) {
    for (var i = 7; i <= 25; i++) if (m[i]) return false;
    return true;
  }

  // Single checker moves of player p with one die d, ignoring the
  // "use as many dice as possible" rules. {f, t, d}: t = 0 bears off.
  function stepsFor(c, p, d) {
    var m = c[p], o = c[1 - p], out = [], t;
    if (m[25] > 0) {                                  // the bar first
      t = 25 - d;
      if (o[25 - t] < 2) out.push({ f: 25, t: t, d: d });
      return out;
    }
    var home = allHome(m);
    for (var f = 24; f >= 1; f--) {
      if (!m[f]) continue;
      t = f - d;
      if (t >= 1) {
        if (o[25 - t] < 2) out.push({ f: f, t: t, d: d });
      } else if (home) {
        if (t === 0) out.push({ f: f, t: 0, d: d });
        else {
          // a higher die bears off only from the highest point
          var higher = false;
          for (var k = f + 1; k <= 6; k++) if (m[k]) { higher = true; break; }
          if (!higher) out.push({ f: f, t: 0, d: d });
        }
      }
    }
    return out;
  }

  function applyStep(c, p, st) {
    var n = cloneC(c), m = n[p], o = n[1 - p];
    m[st.f]--;
    if (st.t > 0) {
      m[st.t]++;
      if (o[25 - st.t] === 1) { o[25 - st.t] = 0; o[25]++; }
    } else {
      m[0]++;
    }
    return n;
  }

  function isHit(c, p, st) { return st.t > 0 && c[1 - p][25 - st.t] === 1; }

  function without(dice, k) { return dice.slice(0, k).concat(dice.slice(k + 1)); }

  // The most dice player p can use from position c (memoized).
  function maxUse(c, p, dice, memo) {
    if (!dice.length) return 0;
    var key = posKey(c) + dice.join("");
    if (memo[key] !== undefined) return memo[key];
    var best = 0, tried = {};
    for (var k = 0; k < dice.length && best < dice.length; k++) {
      var d = dice[k];
      if (tried[d]) continue;
      tried[d] = true;
      var st = stepsFor(c, p, d), rest = without(dice, k);
      for (var j = 0; j < st.length; j++) {
        var u = 1 + maxUse(applyStep(c, p, st[j]), p, rest, memo);
        if (u > best) { best = u; if (best === dice.length) break; }
      }
    }
    memo[key] = best;
    return best;
  }

  // The single moves allowed now with the dice left (rem), by the
  // official rules: as many dice as possible must be used, and when
  // only one of two different dice can be used, the larger one if it
  // can. A step is legal if a maximal play starts with it.
  function legalSteps(c, p, rem, memo) {
    memo = memo || {};
    var need = maxUse(c, p, rem, memo), out = [];
    if (!need) return out;
    var tried = {};
    for (var k = 0; k < rem.length; k++) {
      var d = rem[k];
      if (tried[d]) continue;
      tried[d] = true;
      var st = stepsFor(c, p, d), rest = without(rem, k);
      for (var j = 0; j < st.length; j++) {
        if (1 + maxUse(applyStep(c, p, st[j]), p, rest, memo) === need) out.push(st[j]);
      }
    }
    if (need === 1 && rem.length === 2 && rem[0] !== rem[1]) {
      var hi = Math.max(rem[0], rem[1]);
      var big = out.filter(function (s) { return s.d === hi; });
      if (big.length) out = big;
    }
    return out;
  }

  // Every distinct position player p can reach with a legal play of
  // the dice: [{ c, seq: [step…] }]. Used by the computer.
  function allPlays(c, p, dice) {
    var memo = {}, need = maxUse(c, p, dice, memo);
    if (!need) return [{ c: c, seq: [] }];
    var out = [], seen = {}, visited = {};
    var bigOnly = need === 1 && dice.length === 2 && dice[0] !== dice[1] ? Math.max(dice[0], dice[1]) : 0;
    if (bigOnly && !stepsFor(c, p, bigOnly).length) bigOnly = 0;
    (function rec(cur, rest, seq) {
      if (seq.length === need) {
        var fk = posKey(cur);
        if (!seen[fk]) { seen[fk] = true; out.push({ c: cur, seq: seq }); }
        return;
      }
      var vk = posKey(cur) + rest.join("");
      if (visited[vk]) return;
      visited[vk] = true;
      var tried = {};
      for (var k = 0; k < rest.length; k++) {
        var d = rest[k];
        if (tried[d] || (bigOnly && seq.length === 0 && d !== bigOnly)) continue;
        tried[d] = true;
        var st = stepsFor(cur, p, d), r2 = without(rest, k);
        for (var j = 0; j < st.length; j++) {
          var nx = applyStep(cur, p, st[j]);
          if (seq.length + 1 + maxUse(nx, p, r2, memo) === need) rec(nx, r2, seq.concat([st[j]]));
        }
      }
    })(c, dice, []);
    return out;
  }

  function pips(m) {
    var s = 0;
    for (var i = 1; i <= 25; i++) s += i * m[i];
    return s;
  }

  // Points for the winner w: 1, gammon 2 (the loser has borne off
  // nothing), backgammon 3 (and still has a checker on the bar or in
  // the winner's home board).
  function winPoints(c, w) {
    var l = c[1 - w];
    if (l[0] > 0) return 1;
    for (var i = 19; i <= 25; i++) if (l[i]) return 3;
    return 2;
  }

  function diceOf(a, b) { return a === b ? [a, a, a, a] : [a, b]; }

  // ---------- 3. Computer player ----------
  // Static evaluation in pips, from p's side, of a position where the
  // OTHER player rolls next.
  var PT_W = [0, 1, 1.5, 2, 3, 4, 3.5, 3, 2, 1.5, 1, 0.8, 0.6,
              0.5, 0.5, 0.5, 0.5, 0.5, 1.5, 1.5, 2.5, 2.5, 1.2, 1, 1];

  function lastOcc(m) {
    for (var i = 25; i >= 1; i--) if (m[i]) return i;
    return 0;
  }

  function structure(m, o) {
    var s = 0, run = 0, bestRun = 0, oppHome = 0;
    for (var i = 1; i <= 24; i++) {
      if (m[i] >= 2) {
        s += PT_W[i];
        run++;
        if (run > bestRun) bestRun = run;
        if (m[i] > 3) s -= (m[i] - 3) * 0.4;           // heavy stack
      } else run = 0;
    }
    if (bestRun >= 3) s += bestRun * bestRun * 0.6;     // a prime
    if (m[25]) {
      for (var k = 1; k <= 6; k++) if (o[k] >= 2) oppHome++;
      s -= m[25] * (3 + oppHome * oppHome * 0.8);       // stuck on the bar
    }
    return s;
  }

  // Expected pips lost by m's blots to o's next roll (blocks ignored).
  function blotRisk(m, o) {
    var loss = [], any = false, d;
    for (d = 0; d <= 24; d++) loss.push(0);
    for (var i = 1; i <= 24; i++) {
      if (m[i] !== 1) continue;
      var at = 25 - i, lose = 25 - i + 4;               // o's number of my point
      for (var j = 25; j > at; j--) {
        if (!o[j]) continue;
        d = j - at;
        if (d <= 24 && lose > loss[d]) { loss[d] = lose; any = true; }
      }
    }
    if (!any) return 0;
    var sum = 0;
    for (var a = 1; a <= 6; a++) {
      for (var b = 1; b <= 6; b++) {
        var l = Math.max(loss[a], loss[b]);
        if (a === b) {
          if (2 * a <= 24) l = Math.max(l, loss[2 * a]);
          if (3 * a <= 24) l = Math.max(l, loss[3 * a]);
          if (4 * a <= 24) l = Math.max(l, loss[4 * a]);
        } else if (a + b <= 24) l = Math.max(l, loss[a + b]);
        sum += l;
      }
    }
    return sum / 36;
  }

  function evaluate(c, p) {
    var m = c[p], o = c[1 - p];
    if (m[0] === 15) return 1000 * winPoints(c, p);
    if (o[0] === 15) return -1000 * winPoints(c, 1 - p);
    var s = pips(o) - pips(m);
    if (lastOcc(m) + lastOcc(o) < 25) {                 // a pure race
      return s + (m[0] - o[0]) * 1.5;
    }
    s += structure(m, o) - 0.7 * structure(o, m);
    s -= blotRisk(m, o);
    s += 0.25 * blotRisk(o, m);
    return s;
  }

  function pickTop(list, score) {
    var top = -Infinity, ties = [];
    list.forEach(function (x) {
      var v = score(x);
      if (v > top + 1e-9) { top = v; ties = [x]; }
      else if (Math.abs(v - top) <= 1e-9) ties.push(x);
    });
    return ties[randInt(ties.length)];
  }

  // The 21 different rolls with their weight out of 36.
  var ROLLS = (function () {
    var out = [];
    for (var a = 1; a <= 6; a++) for (var b = a; b <= 6; b++) out.push([a, b, a === b ? 1 : 2]);
    return out;
  })();

  // Hard: the best few plays by the static evaluation, each scored by
  // the opponent's best answer to each of its 21 rolls (1-ply
  // expectimax), within a time budget.
  function chooseHard(c, p, plays, budgetMs) {
    var deadline = now() + budgetMs;
    var ranked = plays.map(function (x) { return { x: x, v: evaluate(x.c, p) }; })
      .sort(function (a, b) { return b.v - a.v; }).slice(0, HARD_CANDS);
    var best = null, bestV = -Infinity;
    for (var k = 0; k < ranked.length; k++) {
      var cand = ranked[k].x, v = 0, done = true;
      if (cand.c[p][0] === 15) return cand;
      for (var r = 0; r < ROLLS.length; r++) {
        if (k > 0 && now() > deadline) { done = false; break; }
        var answers = allPlays(cand.c, 1 - p, diceOf(ROLLS[r][0], ROLLS[r][1]));
        var theirs = -Infinity;                        // the answer best for them
        for (var j = 0; j < answers.length; j++) {
          var e = evaluate(answers[j].c, 1 - p);
          if (e > theirs) theirs = e;
        }
        v -= ROLLS[r][2] * theirs;
      }
      if (!done) break;
      v /= 36;
      if (v > bestV) { bestV = v; best = cand; }
    }
    return best || ranked[0].x;
  }

  function chooseMove(c, p, dice, level, budgetMs) {
    var plays = allPlays(c, p, dice);
    if (plays.length === 1) return plays[0];
    if (level === "e") return plays[randInt(plays.length)];
    if (level === "m") return pickTop(plays, function (x) { return evaluate(x.c, p); });
    return chooseHard(c, p, plays, budgetMs || HARD_BUDGET);
  }


  // ---------- 4. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                  // max-merged
  //   rows: { <deviceId>: { b: <epoch>,
  //           s: { e:[won, lost, pointsWon, pointsLost], m:[…], h:[…] } } }
  // }
  // Each device only ever increments ITS OWN row; a row counts from
  // epoch b. Merge per row: the newer epoch wins, equal epochs take the
  // per-cell max; rows older than br are dropped. A join (symmetric,
  // associative, idempotent), so no result is lost or double-counted.
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normCell(v) {
    if (!Array.isArray(v) || v.length !== 4) return null;
    for (var k = 0; k < 4; k++) if (!isInt(v[k]) || v[k] < 0) return null;
    // points: at least 1, at most 3 per game
    if (v[2] < v[0] || v[2] > 3 * v[0] || v[3] < v[1] || v[3] > 3 * v[1]) return null;
    return v.slice();
  }

  function normRow(row) {
    if (!row || typeof row !== "object" || !isInt(row.b) || row.b < 0) return null;
    var s = {}, any = false;
    LEVELS.forEach(function (lv) {
      var v = normCell(row.s && row.s[lv]);
      if (v) { s[lv] = v; any = true; }
    });
    return any ? { b: row.b, s: s } : null;
  }

  // Equal epochs: the row with more games per level is the newer copy
  // of the same counter (both only grow), ties by the per-cell max.
  function joinCell(a, c) {
    var ga = a[0] + a[1], gc = c[0] + c[1];
    if (ga !== gc) return (ga > gc ? a : c).slice();
    if (a[0] !== c[0]) return (a[0] > c[0] ? a : c).slice();
    return [a[0], a[1], Math.max(a[2], c[2]), Math.max(a[3], c[3])];
  }

  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var s = {};
    LEVELS.forEach(function (lv) {
      var a = x.s[lv], c = y.s[lv];
      if (!a && !c) return;
      s[lv] = !a ? c.slice() : !c ? a.slice() : joinCell(a, c);
    });
    return { b: x.b, s: s };
  }

  function mergeBackgammon(A, B) {
    var a = A || {}, b = B || {};
    var br = Math.max(isInt(a.br) && a.br > 0 ? a.br : 0, isInt(b.br) && b.br > 0 ? b.br : 0);
    var rows = {};
    [a.rows, b.rows].forEach(function (m) {
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
      LEVELS.forEach(function (lv) { if (r.s[lv]) s[lv] = r.s[lv].slice(); });
      sorted[id] = { b: r.b, s: s };
    });
    return { ver: DATA_VER, br: br, rows: sorted };
  }

  // Totals per level across every device: [won, lost, pts won, pts lost].
  function totals(lv) {
    var out = [0, 0, 0, 0];
    Object.keys(data.rows).forEach(function (id) {
      var v = data.rows[id].s[lv];
      if (v) for (var k = 0; k < 4; k++) out[k] += v[k];
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
          data = mergeBackgammon(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] backgammon: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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

  function countResult(lv, won, pts) {
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // a new epoch after a reset
    var v = row.s[lv] ? row.s[lv].slice() : [0, 0, 0, 0];
    if (won) { v[0]++; v[2] += pts; } else { v[1]++; v[3] += pts; }
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    row.s[lv] = v;
    data.rows[deviceId] = row;
    data = mergeBackgammon(data, data);
    save();
  }

  // ---------- 5. Device-local prefs + session ----------
  var prefs = { mode: "ai", lv: "m" };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (MODES.indexOf(p.mode) >= 0) prefs.mode = p.mode;
        if (LEVELS.indexOf(p.lv) >= 0) prefs.lv = p.lv;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = {
  //   mode, lv,
  //   ai: −1 | 1,          // the computer plays Black (1) vs the computer
  //   c: [white[26], black[26]],
  //   turn: −1 | 0 | 1,    // −1 until the opening roll
  //   phase: "open" | "roll" | "move" | "done",
  //   dice: [a, b],        // as rolled (shown); [] before a roll
  //   rem: [d…],           // dice still to play (doubles: four)
  //   hist: [{c, rem}],    // this turn's steps, for Undo
  //   mv: [step…],         // this turn's steps (f, t, d, h = hit)
  //   last: {p, mv},       // the previous turn, for highlights
  //   tie: 0 | n,          // the opening roll was a tie of n
  //   winner: −1 | 0 | 1, pts: 0–3,
  //   series: [white, black]   // 2-player points (this device)
  // }
  var game = null;

  function validC(c) {
    if (!Array.isArray(c) || c.length !== 2) return false;
    for (var p = 0; p < 2; p++) {
      var m = c[p], n = 0;
      if (!Array.isArray(m) || m.length !== 26) return false;
      for (var i = 0; i < 26; i++) {
        if (!isInt(m[i]) || m[i] < 0) return false;
        n += m[i];
      }
      if (n !== 15) return false;
    }
    for (var k = 1; k <= 24; k++) if (c[0][k] && c[1][25 - k]) return false;
    return true;
  }
  function validDice(a, max) {
    if (!Array.isArray(a) || a.length > max) return false;
    for (var k = 0; k < a.length; k++) if (!isInt(a[k]) || a[k] < 1 || a[k] > 6) return false;
    return true;
  }
  function validSession(g) {
    if (!g || typeof g !== "object" || MODES.indexOf(g.mode) < 0 || LEVELS.indexOf(g.lv) < 0 ||
        (g.ai !== -1 && g.ai !== 1) || !validC(g.c) || PHASES.indexOf(g.phase) < 0 ||
        (g.turn !== -1 && g.turn !== 0 && g.turn !== 1) ||
        (g.phase === "open") !== (g.turn === -1) ||
        !validDice(g.dice, 2) || !validDice(g.rem, 4) || !Array.isArray(g.hist) || !Array.isArray(g.mv) ||
        !Array.isArray(g.series) || g.series.length !== 2 ||
        !isInt(g.series[0]) || !isInt(g.series[1])) return false;
    for (var k = 0; k < g.hist.length; k++) {
      if (!g.hist[k] || !validC(g.hist[k].c) || !validDice(g.hist[k].rem, 4)) return false;
    }
    if (g.phase === "done" && g.winner !== 0 && g.winner !== 1) return false;
    return true;
  }
  function loadSession() {
    try {
      var g = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(g)) {
        if (g.phase !== "move") { g.rem = []; g.hist = []; g.mv = []; }
        if (!g.last || !Array.isArray(g.last.mv)) g.last = null;
        g.tie = isInt(g.tie) ? g.tie : 0;
        return g;
      }
    } catch (e) {}
    return null;
  }
  function saveSession() {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(game)); } catch (e) {}
  }

  // ---------- 6. Game flow ----------
  var aiTimer = null, passTimer = null, rollAnim = null;
  var sel = null;          // the selected source (mover's numbering), or null
  var cur = null;          // keyboard cursor: { kind, rel }
  var legalCache = null;   // { key, steps }

  function fresh(series) {
    return { mode: prefs.mode, lv: prefs.lv, ai: prefs.mode === "ai" ? 1 : -1,
             c: startPos(), turn: -1, phase: "open", dice: [], rem: [], hist: [], mv: [],
             last: null, tie: 0, winner: -1, pts: 0, series: series || [0, 0] };
  }

  function inProgress() { return !!(game && game.phase !== "done" && game.turn >= 0); }
  function aiTurn() { return game.mode === "ai" && game.phase !== "done" && game.turn === game.ai; }
  function busy() { return !!rollAnim || !!passTimer; }

  function legalNow() {
    if (!game || game.phase !== "move" || !game.rem.length) return [];
    var key = posKey(game.c) + game.turn + game.rem.join("");
    if (!legalCache || legalCache.key !== key) {
      legalCache = { key: key, steps: legalSteps(game.c, game.turn, game.rem) };
    }
    return legalCache.steps;
  }

  // The turn is played out: every die that could be used was.
  function turnComplete() { return game.phase === "move" && legalNow().length === 0; }

  function sources() {
    var seen = {}, out = [];
    legalNow().forEach(function (s) { if (!seen[s.f]) { seen[s.f] = true; out.push(s.f); } });
    return out.sort(function (a, b) { return b - a; });
  }

  // Where the checker on src can go this turn: target → the steps
  // (one die, or several dice for the same checker; the fewest steps,
  // then the smallest first die).
  function targetsFrom(src) {
    var out = {}, p = game.turn, memo = {};
    (function walk(c, rem, from, path) {
      var steps = legalSteps(c, p, rem, memo);
      steps.forEach(function (s) {
        if (s.f !== from) return;
        var np = path.concat([s]), old = out[s.t];
        if (!old || old.length > np.length || (old.length === np.length && np[0].d < old[0].d)) out[s.t] = np;
        if (s.t > 0 && rem.length > 1) {
          walk(applyStep(c, p, s), without(rem, rem.indexOf(s.d)), s.t, np);
        }
      });
    })(game.c, game.rem, src, []);
    return out;
  }

  function stopTimers() {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    if (passTimer) { clearTimeout(passTimer); passTimer = null; }
    if (rollAnim) { clearTimeout(rollAnim.timer); rollAnim = null; }
  }

  // A game in progress is never lost silently: Undo toast (R14).
  function newGame(announce, keepSeries) {
    var prev = inProgress() ? JSON.parse(JSON.stringify(game)) : null;
    var prevPrefs = JSON.parse(JSON.stringify(prefs));
    stopTimers();
    var series = (keepSeries && game && game.mode === "duo" && prefs.mode === "duo") ? game.series.slice() : [0, 0];
    game = fresh(series);
    sel = null; cur = null;
    saveSession();
    renderAll();
    if (prev) {
      undoToast(t("toast.newgame"), function () {
        stopTimers();
        prefs = prevPrefs;
        savePrefs();
        game = prev;
        sel = null; cur = null;
        saveSession();
        renderAll();
        resume();
      });
    } else if (announce) {
      live(t("toast.newgame"));
    }
  }

  function who(p) {
    if (game.mode === "ai") return t(p === game.ai ? "side.ai" : "side.you");
    return t("player." + p);
  }

  // Roll: the opening roll (one die each) or the mover's two dice.
  // byAi: the computer's own roll (a person's press on its turn is refused).
  function roll(byAi) {
    if (game.phase === "done") { showToast(t("toast.over")); return; }
    if (busy()) return;
    if (aiTurn() && game.phase !== "open" && byAi !== true) { showToast(t("toast.wait")); return; }
    if (game.phase === "move") { showToast(t("toast.rolled")); return; }
    var a = 1 + randInt(6), b = 1 + randInt(6);
    if (game.phase === "open") {
      game.dice = [a, b];                 // White's die, Black's die
      if (a === b) {
        game.tie = a;
        saveSession();
        animateRoll(function () { renderAll(); live(t("turn.openTie", { n: a })); }, true);
        return;
      }
      game.tie = 0;
      game.turn = a > b ? 0 : 1;
      game.dice = a > b ? [a, b] : [b, a];
      live(t("live.open", { a: a, b: b, who: who(game.turn) }));
    } else {
      game.dice = [a, b];
      live(t("live.roll", { who: who(game.turn), a: a, b: b }));
    }
    var opening = game.phase === "open";
    game.phase = "move";
    game.rem = diceOf(game.dice[0], game.dice[1]);
    game.hist = []; game.mv = [];
    sel = null; cur = null;
    saveSession();
    animateRoll(afterRoll, opening);
  }

  function afterRoll() {
    renderAll();
    if (!legalNow().length) { schedulePass(); return; }
    resume();
  }

  // Dice tumble for a moment (values are already decided and saved).
  function animateRoll(done, opening) {
    sfx("roll");
    if (reducedMotion()) { done(); return; }
    var n = 0;
    rollAnim = { faces: [1 + randInt(6), 1 + randInt(6)], open: !!opening, timer: null };
    var tick = function () {
      if (!rollAnim) return;
      if (++n > 7) { rollAnim = null; done(); return; }
      rollAnim.faces = [1 + randInt(6), 1 + randInt(6)];
      renderBoard();
      rollAnim.timer = setTimeout(tick, 60);
    };
    renderAll();
    rollAnim.timer = setTimeout(tick, 60);
  }

  function schedulePass() {
    showToast(t("toast.pass", { who: who(game.turn) }));
    passTimer = setTimeout(function () {
      passTimer = null;
      endTurn();
    }, PASS_DELAY);
    renderAll();
  }

  // Play one step for the mover (already checked legal).
  function doStep(s) {
    var p = game.turn;
    game.hist.push({ c: game.c, rem: game.rem.slice() });
    var hit = isHit(game.c, p, s);
    game.c = applyStep(game.c, p, s);
    game.rem = without(game.rem, game.rem.indexOf(s.d));
    game.mv.push({ f: s.f, t: s.t, d: s.d, h: hit });
    sfx(hit ? "hit" : s.t === 0 ? "off" : "move");
    if (game.c[p][0] === 15) { finish(p); return true; }
    return false;
  }

  function moveText(mv) {
    return mv.map(function (s) {
      return (s.f === 25 ? "bar" : s.f) + "/" + (s.t === 0 ? "off" : s.t) + (s.h ? "*" : "");
    }).join(" ");
  }

  // Human: move the selected checker to target rel.
  function moveTo(target) {
    var path = targetsFrom(sel)[target];
    if (!path) { showToast(t("toast.notThere")); return; }
    sel = null; cur = null;
    for (var k = 0; k < path.length; k++) if (doStep(path[k])) return;
    saveSession();
    renderAll();
    if (turnComplete()) live(t("live.move", { who: who(game.turn), moves: moveText(game.mv) }) + ". " + t(game.mode === "ai" ? "turn.youDone" : "turn.pDone", { player: who(game.turn) }));
  }

  function undoStep() {
    if (game.phase === "done") { showToast(t("toast.over")); return; }
    if (aiTurn()) { showToast(t("toast.wait")); return; }
    if (game.phase !== "move" || !game.hist.length) { showToast(t("toast.nothing")); return; }   // R28
    var h = game.hist.pop();
    game.c = h.c;
    game.rem = h.rem;
    game.mv.pop();
    sel = null; cur = null;
    saveSession();
    renderAll();
  }

  function done() {
    if (game.phase === "done") { showToast(t("toast.over")); return; }
    if (aiTurn()) { showToast(t("toast.wait")); return; }
    if (game.phase !== "move") { showToast(t("toast.rollFirst")); return; }
    if (busy()) return;
    if (!turnComplete()) { showToast(t("toast.notDone")); return; }
    live(t("live.move", { who: who(game.turn), moves: moveText(game.mv) }));
    endTurn();
  }

  function endTurn() {
    game.last = { p: game.turn, mv: game.mv.slice() };
    game.turn = 1 - game.turn;
    game.phase = "roll";
    game.dice = []; game.rem = []; game.hist = []; game.mv = [];
    sel = null; cur = null;
    saveSession();
    renderAll();
    resume();
  }

  // Whatever the computer has to do next (also after a reload).
  function resume() {
    if (aiTimer || busy() || game.phase === "done") return;
    if (game.phase === "move" && !legalNow().length && !game.hist.length) { schedulePass(); return; }
    if (!aiTurn()) return;
    if (game.phase === "roll") {
      renderStatus();
      aiTimer = setTimeout(function () { aiTimer = null; if (aiTurn()) roll(true); }, AI_ROLL_DELAY);
      return;
    }
    if (game.phase !== "move") return;
    if (turnComplete()) {
      aiTimer = setTimeout(function () { aiTimer = null; if (aiTurn()) endTurn(); }, AI_STEP);
      return;
    }
    renderStatus();
    aiTimer = setTimeout(function () {
      var plan = chooseMove(game.c, game.ai, game.rem, game.lv);
      var k = 0;
      var next = function () {
        aiTimer = null;
        if (!aiTurn() || game.phase !== "move") return;
        if (k >= plan.seq.length) {
          live(t("live.move", { who: who(game.ai), moves: moveText(game.mv) }));
          endTurn();
          return;
        }
        if (doStep(plan.seq[k++])) return;
        saveSession();
        renderAll();
        aiTimer = setTimeout(next, reducedMotion() ? 200 : AI_STEP);
      };
      aiTimer = setTimeout(next, 120);
    }, 40);
  }

  function finish(w) {
    stopTimers();
    game.phase = "done";
    game.winner = w;
    game.pts = winPoints(game.c, w);
    game.last = { p: w, mv: game.mv.slice() };
    game.rem = []; game.hist = []; game.mv = [];
    sel = null; cur = null;
    if (game.mode === "duo") game.series[w] += game.pts;
    else countResult(game.lv, w !== game.ai, game.pts);
    saveSession();
    renderAll();
    sfx(game.mode === "ai" && w === game.ai ? "end" : "win");
    setTimeout(function () { resultDialog(); }, 800);
  }

  // A tap / click / Enter on a board region.
  function tap(region) {
    if (!region) return;
    if (game.phase === "done") { showToast(t("toast.over")); return; }
    if (aiTurn() && !(game.phase === "open" && region.kind === "dice")) { showToast(t("toast.wait")); return; }
    if (busy()) return;
    if (region.kind === "dice") {
      if (game.phase === "open" || game.phase === "roll") roll();
      else if (turnComplete()) done();
      else showToast(t("toast.rolled"));
      return;
    }
    if (game.phase !== "move") { showToast(t("toast.rollFirst")); return; }
    var p = game.turn;
    var rel = region.kind === "bar" ? 25 : region.kind === "off" ? 0 : (p === 0 ? region.abs : 25 - region.abs);
    if (sel !== null) {
      if (rel === sel) { sel = null; renderBoard(); return; }
      if (targetsFrom(sel)[rel]) { moveTo(rel); return; }
    }
    var src = sources();
    if (src.indexOf(rel) >= 0) { select(rel); return; }
    if (!legalNow().length) { showToast(t("toast.noMore")); return; }
    if (rel >= 1 && game.c[p][rel] > 0) {
      showToast(t(game.c[p][25] > 0 ? "toast.bar" : "toast.cant"));
      shake();
      return;
    }
    showToast(t(sel !== null ? "toast.notThere" : "toast.pick"));
    shake();
  }

  function select(rel) {
    sel = rel;
    var tg = Object.keys(targetsFrom(rel)).map(Number).sort(function (a, b) { return b - a; });
    renderBoard();
    live(t("live.sel", { from: relName(rel), targets: tg.length ? tg.map(relName).join(", ") : t("live.none") }));
  }

  function relName(rel) {
    return rel === 25 ? t("pt.bar") : rel === 0 ? t("pt.off") : t("pt.label", { n: rel });
  }

  // ---------- 7. Render ----------
  function renderAll() {
    renderToolbar();
    renderStatus();
    renderActions();
    renderBoard();
  }

  function renderToolbar() {
    var mode = game ? game.mode : prefs.mode;
    var lv = game ? game.lv : prefs.lv;
    [].forEach.call(document.querySelectorAll("#mode-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-mode") === mode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-level") === lv;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    $("level-seg").hidden = mode !== "ai";
    paintSfxBtn();
  }

  function renderStatus() {
    if (!game) return;
    var ai = game.mode === "ai";
    $("name0").textContent = ai ? t("side.you") : t("player.0");
    $("name1").textContent = ai ? t("side.ai") : t("player.1");
    $("pips0").textContent = t("pips", { n: pips(game.c[0]) });
    $("pips1").textContent = t("pips", { n: pips(game.c[1]) });
    var p = game.turn, txt;
    if (game.phase === "done") {
      txt = ai && game.winner !== game.ai ? t("turn.youwin") : t("turn.win", { who: who(game.winner) });
    } else if (game.phase === "open") {
      txt = game.tie ? t("turn.openTie", { n: game.tie }) : t("turn.open");
    } else if (passTimer) {
      txt = t("turn.pass", { who: who(p) });
    } else if (aiTurn()) {
      txt = game.phase === "roll" ? t("turn.aiRolls") : t("turn.ai");
    } else if (game.phase === "roll") {
      txt = ai ? t("turn.youRoll") : t("turn.pRoll", { player: who(p) });
    } else if (turnComplete()) {
      txt = ai ? t("turn.youDone") : t("turn.pDone", { player: who(p) });
    } else {
      txt = ai ? t("turn.youMove") : t("turn.pMove", { player: who(p) });
    }
    $("turn").textContent = txt;
    $("side0").classList.toggle("turn", game.phase !== "done" && p === 0);
    $("side1").classList.toggle("turn", game.phase !== "done" && p === 1);
  }

  // Roll · Undo · Done. Never disabled (a refused press explains itself,
  // R28); aria-disabled + dim when it would be refused.
  function renderActions() {
    var human = game.phase !== "done" && !aiTurn() && !busy();
    var canRoll = human && (game.phase === "open" || game.phase === "roll") ||
                  (game.phase === "open" && !busy());
    var canUndo = human && game.phase === "move" && game.hist.length > 0;
    var canDone = human && turnComplete() && game.hist.length > 0;
    [["roll-btn", canRoll], ["undo-btn", canUndo], ["done-btn", canDone]].forEach(function (x) {
      var b = $(x[0]);
      if (x[1]) b.removeAttribute("aria-disabled"); else b.setAttribute("aria-disabled", "true");
    });
    $("roll-btn").classList.toggle("go", canRoll);
    $("done-btn").classList.toggle("go", canDone);
  }

  // --- SVG board ---
  // Logical board (landscape, White's home bottom right):
  //   margin M · left half (points 12…7 / 13…18) · bar · right half
  //   (6…1 / 19…24) · tray (borne off: White below, Black above).
  // On a tall screen everything is turned a quarter (P maps x, y).
  var M = 24, PW = 50, PH = 230, GAP = 48, BW = 50, TG = 10, TW = 56;
  var LX = M, BX = M + 6 * PW, RX = BX + BW, TX = RX + 6 * PW + TG;
  var W = TX + TW + M, H = M + PH + GAP + PH + M, R = 23;
  var portrait = false;

  function P(x, y) { return portrait ? [H - y, x] : [x, y]; }
  function unP(x, y) { return portrait ? [y, H - x] : [x, y]; }
  function f1(v) { return Math.round(v * 10) / 10; }

  function colX(abs) {
    if (abs <= 6) return RX + (6 - abs) * PW;
    if (abs <= 12) return LX + (12 - abs) * PW;
    if (abs <= 18) return LX + (abs - 13) * PW;
    return RX + (abs - 19) * PW;
  }
  function absOf(p, rel) { return p === 0 ? rel : 25 - rel; }

  // Centre of the k-th checker (0 = at the edge) on point abs.
  function slot(abs, k) {
    var x = colX(abs) + PW / 2;
    return abs >= 13 ? [x, M + R + k * 2 * R] : [x, H - M - R - k * 2 * R];
  }
  function barSlot(p, k) {
    var x = BX + BW / 2;
    return p === 0 ? [x, H / 2 - GAP / 2 - R - k * 2 * R] : [x, H / 2 + GAP / 2 + R + k * 2 * R];
  }

  function rectSvg(x, y, w, h, cls, extra) {
    var a = P(x, y), b = P(x + w, y + h);
    return '<rect class="' + cls + '" x="' + f1(Math.min(a[0], b[0])) + '" y="' + f1(Math.min(a[1], b[1])) +
      '" width="' + f1(Math.abs(b[0] - a[0])) + '" height="' + f1(Math.abs(b[1] - a[1])) + '"' + (extra || "") + '/>';
  }
  function circleSvg(x, y, r, cls) {
    var a = P(x, y);
    return '<circle class="' + cls + '" cx="' + f1(a[0]) + '" cy="' + f1(a[1]) + '" r="' + r + '"/>';
  }
  function textSvg(x, y, s, cls) {
    var a = P(x, y);
    return '<text class="' + cls + '" x="' + f1(a[0]) + '" y="' + f1(a[1]) + '">' + s + '</text>';
  }
  function triSvg(abs, cls) {
    var x = colX(abs), top = abs >= 13;
    var y0 = top ? M : H - M, y1 = top ? M + PH - 6 : H - M - PH + 6;
    var pts = [P(x + 2, y0), P(x + PW - 2, y0), P(x + PW / 2, y1)];
    return '<polygon class="' + cls + '" points="' + pts.map(function (q) { return f1(q[0]) + "," + f1(q[1]); }).join(" ") + '"/>';
  }

  var PIPS = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]],
               4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
               6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
  function dieSvg(cx, cy, size, v, p, cls) {
    var out = rectSvg(cx - size / 2, cy - size / 2, size, size, "die k" + p + (cls ? " " + cls : ""), ' rx="' + Math.round(size * 0.18) + '"');
    if (v) {
      (PIPS[v] || []).forEach(function (q) {
        // pips keep their pattern upright on screen
        var a = P(cx, cy), o = size * 0.26;
        out += '<circle class="pip k' + p + (cls ? " " + cls : "") + '" cx="' + f1(a[0] + q[0] * o) + '" cy="' + f1(a[1] + q[1] * o) + '" r="' + f1(size * 0.09) + '"/>';
      });
    } else {
      var a2 = P(cx, cy);
      out += '<text class="die-q" x="' + f1(a2[0]) + '" y="' + f1(a2[1]) + '">?</text>';
    }
    return out;
  }

  function diceSvg() {
    var out = "", cy = H / 2, ph = game.phase;
    var halfX = function (p) { return p === 0 ? RX + 3 * PW : LX + 3 * PW; };
    if (rollAnim) {
      if (!rollAnim.open) {
        var x0 = halfX(game.turn);
        out += dieSvg(x0 - 25, cy, 40, rollAnim.faces[0], game.turn, "tumble");
        out += dieSvg(x0 + 25, cy, 40, rollAnim.faces[1], game.turn, "tumble");
      } else {
        out += dieSvg(halfX(0), cy, 40, rollAnim.faces[0], 0, "tumble");
        out += dieSvg(halfX(1), cy, 40, rollAnim.faces[1], 1, "tumble");
      }
      return out;
    }
    if (ph === "open") {
      if (game.tie) {
        out += dieSvg(halfX(0), cy, 40, game.tie, 0, "");
        out += dieSvg(halfX(1), cy, 40, game.tie, 1, "");
      } else {
        out += dieSvg(halfX(0), cy, 40, 0, 0, "ask");
        out += dieSvg(halfX(1), cy, 40, 0, 1, "ask");
      }
      return out;
    }
    if (ph === "roll") {
      if (!aiTurn()) {
        out += dieSvg(halfX(game.turn) - 25, cy, 40, 0, game.turn, "ask");
        out += dieSvg(halfX(game.turn) + 25, cy, 40, 0, game.turn, "ask");
      }
      return out;
    }
    if (ph !== "move" || !game.dice.length) return out;
    var all = diceOf(game.dice[0], game.dice[1]);
    var used = all.length - game.rem.length;
    var size = all.length === 4 ? 34 : 40, gap = all.length === 4 ? 6 : 10;
    var span = all.length * size + (all.length - 1) * gap;
    var x = halfX(game.turn) - span / 2 + size / 2;
    // used dice dim; with two different dice the used one is the one
    // no longer in rem
    var remLeft = game.rem.slice();
    for (var k = 0; k < all.length; k++) {
      var j = remLeft.indexOf(all[k]), isUsed;
      if (all.length === 4) isUsed = k < used;
      else { isUsed = j < 0; if (j >= 0) remLeft.splice(j, 1); }
      out += dieSvg(x + k * (size + gap), cy, size, all[k], game.turn, isUsed ? "used" : "");
    }
    return out;
  }

  function renderBoard() {
    var svg = $("board");
    if (!svg || !game) return;
    var wrap = $("board-wrap");
    portrait = wrap.clientHeight > wrap.clientWidth * 1.08;
    svg.setAttribute("viewBox", portrait ? "0 0 " + H + " " + W : "0 0 " + W + " " + H);
    var out = [], p = game.turn, c = game.c;
    var moving = game.phase === "move" && !aiTurn() && !busy();
    var src = moving && sel === null ? sources() : [];
    var tg = moving && sel !== null ? targetsFrom(sel) : {};
    var view = game.mode === "duo" && p === 1 ? 1 : 0;    // whose numbers are shown

    out.push(rectSvg(0, 0, W, H, "frame", ' rx="14"'));
    out.push(rectSvg(LX, M, 6 * PW, H - 2 * M, "felt"));
    out.push(rectSvg(RX, M, 6 * PW, H - 2 * M, "felt"));
    out.push(rectSvg(TX, M, TW, PH, "tray"));
    out.push(rectSvg(TX, H - M - PH, TW, PH, "tray"));
    for (var a = 1; a <= 24; a++) {
      out.push(triSvg(a, "pt " + (a % 2 ? "pa" : "pb")));
      var nb = a >= 13 ? M / 2 + 5 : H - M / 2 + 5;
      out.push(textSvg(colX(a) + PW / 2, nb, String(view === 0 ? a : 25 - a), "num"));
    }
    // targets under the checkers
    Object.keys(tg).forEach(function (k) {
      var rel = +k;
      if (rel === 0) out.push(rectSvg(TX, p === 0 ? H - M - PH : M, TW, PH, "tgt-tray"));
      else out.push(triSvg(absOf(p, rel), "tgt"));
    });
    // keyboard cursor
    if (cur) {
      if (cur.kind === "pt") out.push(rectSvg(colX(cur.abs) + 1, cur.abs >= 13 ? M + 1 : H - M - PH - 1, PW - 2, PH, "cur", ' rx="6"'));
      else if (cur.kind === "bar") out.push(rectSvg(BX + 1, M + 1, BW - 2, H - 2 * M - 2, "cur", ' rx="6"'));
      else if (cur.kind === "off") out.push(rectSvg(TX + 1, p === 0 ? H - M - PH : M, TW - 2, PH, "cur", ' rx="6"'));
    }
    // the previous turn's landing points
    var lastTo = {};
    if (game.last && game.last.mv) game.last.mv.forEach(function (s) { if (s.t > 0) lastTo[absOf(game.last.p, s.t)] = game.last.p; });

    // checkers on the points
    for (var b = 1; b <= 24; b++) {
      var who0 = c[0][b], who1 = c[1][25 - b];
      var n = who0 || who1, pl = who0 ? 0 : 1;
      if (!n) continue;
      var shown = Math.min(n, 5);
      for (var k2 = 0; k2 < shown; k2++) {
        var q = slot(b, k2), top = k2 === shown - 1;
        var cls = "ck k" + pl;
        if (top && moving && pl === p) {
          var relb = p === 0 ? b : 25 - b;
          if (src.indexOf(relb) >= 0) cls += " src";
          if (sel === relb) cls += " sel";
        }
        if (top && lastTo[b] === pl && !(moving && sel !== null)) cls += " last";
        out.push(circleSvg(q[0], q[1], R - 1, cls));
        out.push(circleSvg(q[0], q[1], R * 0.62, "ckr k" + pl));
        if (top && n > 5) out.push(textSvg(q[0], q[1] + 6, String(n), "cnt k" + pl));
      }
    }
    // the bar
    for (var pb = 0; pb < 2; pb++) {
      var nbar = c[pb][25];
      for (var k3 = 0; k3 < Math.min(nbar, 3); k3++) {
        var qb = barSlot(pb, k3), topb = k3 === Math.min(nbar, 3) - 1, clsb = "ck k" + pb;
        if (topb && moving && pb === p) {
          if (src.indexOf(25) >= 0) clsb += " src";
          if (sel === 25) clsb += " sel";
        }
        out.push(circleSvg(qb[0], qb[1], R - 1, clsb));
        out.push(circleSvg(qb[0], qb[1], R * 0.62, "ckr k" + pb));
        if (topb && nbar > 3) out.push(textSvg(qb[0], qb[1] + 6, String(nbar), "cnt k" + pb));
      }
    }
    // borne off: White in the lower tray, Black in the upper
    for (var po = 0; po < 2; po++) {
      for (var k4 = 0; k4 < c[po][0]; k4++) {
        var y = po === 0 ? H - M - (k4 + 1) * 15 + 2 : M + k4 * 15 + 2;
        out.push(rectSvg(TX + 5, y, TW - 10, 12, "offck k" + po, ' rx="3"'));
      }
    }
    // landing hints on targets
    Object.keys(tg).forEach(function (k) {
      var rel = +k;
      if (rel === 0) return;
      var ab = absOf(p, rel), own = c[p][rel];
      var qh = slot(ab, Math.min(own, 4));
      out.push(circleSvg(qh[0], qh[1], R - 3, "hint"));
    });
    out.push(diceSvg());
    svg.innerHTML = out.join("");
    svg.classList.toggle("over", game.phase === "done");
    svg.classList.toggle("portrait", portrait);
  }

  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  function shake() {
    var s = $("board");
    if (reducedMotion()) return;
    s.classList.remove("shake");
    void s.getBoundingClientRect();
    s.classList.add("shake");
  }

  // ---------- 8. Pointer input ----------
  // Client point → a board region in the logical (landscape) layout.
  function regionAt(clientX, clientY) {
    var svg = $("board"), ctm = svg.getScreenCTM();
    if (!ctm) return null;
    var pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    var u = pt.matrixTransform(ctm.inverse());
    var l = unP(u.x, u.y), x = l[0], y = l[1];
    if (x < 0 || y < 0 || x > W || y > H) return null;
    if (x >= TX - TG / 2) return { kind: "off" };
    if (x >= BX && x < RX) return { kind: "bar" };
    if (Math.abs(y - H / 2) < GAP / 2 && x >= LX && x < TX) return { kind: "dice" };
    if (x < LX || x >= RX + 6 * PW) return null;
    var right = x >= RX, col = Math.floor(((right ? x - RX : x - LX)) / PW);
    col = Math.max(0, Math.min(5, col));
    var abs;
    if (y < H / 2) abs = right ? 19 + col : 13 + col;
    else abs = right ? 6 - col : 12 - col;
    return { kind: "pt", abs: abs };
  }

  var down = null;
  function wirePointer() {
    var svg = $("board");
    svg.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      var r = regionAt(e.clientX, e.clientY);
      down = { x: e.clientX, y: e.clientY, r: r, drag: false, id: e.pointerId, picked: false, was: sel };
      // press on a movable checker: pick it up at once (drag start)
      if (r && game.phase === "move" && !aiTurn() && !busy() && (r.kind === "pt" || r.kind === "bar")) {
        var rel = r.kind === "bar" ? 25 : (game.turn === 0 ? r.abs : 25 - r.abs);
        if (sources().indexOf(rel) >= 0 && !(sel !== null && targetsFrom(sel)[rel])) {
          if (sel !== rel) { select(rel); down.picked = true; }
          down.src = rel;
        }
      }
    });
    svg.addEventListener("pointermove", function (e) {
      if (!down || down.src === undefined || e.pointerId !== down.id) return;
      if (!down.drag && Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) < 10) return;
      if (!down.drag) {
        down.drag = true;
        try { svg.setPointerCapture(e.pointerId); } catch (err) {}
        svg.classList.add("dragging");
      }
      var ctm = svg.getScreenCTM(), pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      var u = pt.matrixTransform(ctm.inverse());
      var g = $("ghost");
      if (!g) {
        g = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        g.id = "ghost";
        g.setAttribute("r", String(R));
        g.setAttribute("class", "ck ghost k" + game.turn);
        svg.appendChild(g);
      }
      g.setAttribute("cx", String(f1(u.x)));
      g.setAttribute("cy", String(f1(u.y)));
    });
    var up = function (e) {
      if (!down || e.pointerId !== down.id) return;
      var d = down;
      down = null;
      svg.classList.remove("dragging");
      var g = $("ghost");
      if (g) g.remove();
      if (e.type === "pointercancel") { renderBoard(); return; }
      if (d.drag) {
        var r = regionAt(e.clientX, e.clientY);
        if (r && sel !== null) {
          var rel = r.kind === "bar" ? 25 : r.kind === "off" ? 0 : r.kind === "pt" ? (game.turn === 0 ? r.abs : 25 - r.abs) : -1;
          if (targetsFrom(sel)[rel]) { moveTo(rel); return; }
          if (rel !== sel) showToast(t("toast.notThere"));
        }
        renderBoard();
        return;
      }
      if (d.src !== undefined) {
        if (!d.picked && d.was === d.src) { sel = null; renderBoard(); }   // second tap: put it down
        return;
      }
      tap(d.r);
    };
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", up);
  }

  // ---------- 9. Dialogs ----------
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

  function resultDialog() {
    if (!game || game.phase !== "done") return;      // replaced meanwhile
    var dlg = makeDialog("backgammon-result");
    var ai = game.mode === "ai", w = game.winner;
    dlg.appendChild(el("div", "dlg-title", t("res.title") + (ai ? " · " + t("level." + game.lv) : "")));
    var hero = ai ? t(w === game.ai ? "res.ailose" : "res.youwin") : t("res.pwin", { player: t("player." + w) });
    dlg.appendChild(el("div", "dlg-hero", hero));
    dlg.appendChild(el("div", "dlg-badge" + (game.pts > 1 ? " big" : ""), t("res.k" + game.pts)));
    if (ai) {
      var s = totals(game.lv);
      dlg.appendChild(row(t("stats.head"), s[0] + " · " + s[1]));
      dlg.appendChild(row(t("res.series"), s[2] + " – " + s[3]));
    } else {
      dlg.appendChild(row(t("res.series"), t("player.0") + " " + game.series[0] + " – " + game.series[1] + " " + t("player.1")));
    }
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("res.close"), "", function () { dlg.close(); }));
    var again = button(t("res.again"), "primary", function () { dlg.close(); newGame(false, true); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    again.focus();
  }

  function statsDialog() {
    var dlg = makeDialog("backgammon-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    LEVELS.forEach(function (lv) {
      var s = totals(lv);
      if (s[0] + s[1]) empty = false;
      dlg.appendChild(row(t("level." + lv), s[0] + " · " + s[1] + "  (" + t("stats.pts", { a: s[2], b: s[3] }) + ")"));
    });
    if (game && (game.series[0] || game.series[1])) {
      empty = false;
      dlg.appendChild(el("div", "dlg-sub", t("mode.duo")));
      dlg.appendChild(row(t("res.series"), t("player.0") + " " + game.series[0] + " – " + game.series[1] + " " + t("player.1")));
    }
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
    var dlg = makeDialog("backgammon-confirm");
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
    data = mergeBackgammon(data, data);
    save();
    if (game) { game.series = [0, 0]; saveSession(); }
    renderStatus();
    showToast(t("toast.reset"));
  }

  // ---------- 10. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "backgammon", title: String(text) })) return;
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
    box.innerHTML = "";
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

  // ---------- 11. Sound ----------
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
      if (kind === "roll") { for (var k = 0; k < 4; k++) tone(180 + randInt(120), k * 0.06, 0.05, "square", 0.05); }
      else if (kind === "move") tone(330, 0, 0.08, "triangle", 0.14);
      else if (kind === "hit") { tone(220, 0, 0.1, "square", 0.08); tone(165, 0.08, 0.14, "triangle", 0.14); }
      else if (kind === "off") tone(660, 0, 0.1, "triangle", 0.12);
      else if (kind === "win") {
        [523, 659, 784, 1047].forEach(function (f, j) { tone(f, j * 0.11, 0.22, "triangle"); });
      } else if (kind === "end") { tone(392, 0, 0.18, "sine"); tone(294, 0.16, 0.3, "sine"); }
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Toolbar icons (R9: injected by JS) ----------
  var UI_ICONS = {
    new:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    undo:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    roll:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="16" cy="16" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>',
    done:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
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

  // ---------- 12. Keyboard ----------
  // Arrows walk the cursor over what can be picked now (checkers that
  // can move, then the selected checker's destinations); Enter picks.
  function choices() {
    if (game.phase !== "move" || aiTurn() || busy()) return [];
    var p = game.turn;
    var rels = sel === null ? sources()
      : Object.keys(targetsFrom(sel)).map(Number).concat([sel]).sort(function (a, b) { return b - a; });
    return rels.map(function (rel) {
      return rel === 25 ? { kind: "bar", rel: 25 } : rel === 0 ? { kind: "off", rel: 0 }
        : { kind: "pt", abs: absOf(p, rel), rel: rel };
    });
  }

  function moveCursor(dir) {
    var list = choices();
    if (!list.length) {
      if (game.phase === "open" || game.phase === "roll") showToast(t("toast.rollFirst"));
      else if (game.phase === "move" && !aiTurn() && turnComplete()) showToast(t("toast.noMore"));
      return;
    }
    var i = -1;
    if (cur) for (var k = 0; k < list.length; k++) if (list[k].rel === cur.rel) i = k;
    i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    cur = list[i];
    renderBoard();
    var c = game.c, p = game.turn, rel = cur.rel, desc;
    if (rel === 0) desc = t("pt.off");
    else if (rel === 25) desc = t("pt.bar") + ": " + t("pt.has", { n: c[p][25], color: t("color." + p) });
    else {
      var mine = c[p][rel], theirs = c[1 - p][25 - rel];
      desc = relName(rel) + ": " + (mine ? t("pt.has", { n: mine, color: t("color." + p) })
        : theirs ? t("pt.has", { n: theirs, color: t("color." + (1 - p)) }) : t("pt.empty"));
    }
    live(desc);
  }

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.shiftKey) return;
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") { e.preventDefault(); undoStep(); return; }
      if (e.ctrlKey || e.metaKey) return;               // never steal OS combos
      var onBtn = tag === "BUTTON" && document.activeElement.id !== "board";
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); moveCursor(1); return; }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); moveCursor(-1); return; }
      if (e.repeat) return;
      if (e.code === "KeyN") { e.preventDefault(); newGame(true, true); return; }
      if (e.code === "KeyZ" || e.key === "Backspace") { e.preventDefault(); undoStep(); return; }
      if (e.key === "Escape") { if (sel !== null || cur) { sel = null; cur = null; renderBoard(); } return; }
      if (e.code === "KeyR" || (e.key === " " && !onBtn)) {
        e.preventDefault();
        if (cur && e.key === " ") { tap(cur); return; }
        if (game.phase === "open" || game.phase === "roll" || aiTurn()) roll();
        else showToast(t("toast.rolled"));
        return;
      }
      if (e.key === "Enter" && !onBtn) {
        e.preventDefault();
        if (cur) { var c0 = cur; tap(c0.kind === "pt" ? { kind: "pt", abs: c0.abs } : { kind: c0.kind }); return; }
        if (game.phase === "open" || game.phase === "roll") { roll(); return; }
        done();
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

  // ---------- 13. Sync slice + palette ----------
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
    api.registerSlice("backgammon", sliceGet, sliceSet, STORAGE_KEY, mergeBackgammon);
  }

  function sliceGet() {
    return mergeBackgammon(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeBackgammon(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    // no toast on merge (sync feedback = taskbar dot)
  }

  // ---------- 14. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    $("board").setAttribute("aria-label", t("board.label"));
  }

  function paintStatic() {
    [["new-btn", "new", "btn.new"], ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    [["roll-btn", "roll", "act.roll", "act.rollKey"], ["undo-btn", "undo", "act.undo", "act.undoKey"],
     ["done-btn", "done", "act.done", "act.doneKey"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]] + "<span>" + t(x[2]) + "</span>";
      b.title = t(x[3]);
      b.setAttribute("aria-label", t(x[3]));
    });
    paintSfxBtn();
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#mode-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () {
        var m = b.getAttribute("data-mode");
        if (game && m === game.mode && game.phase !== "done") return;   // visible active state
        prefs.mode = m; savePrefs(); newGame(true, true);
      });
    });
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () {
        var lv = b.getAttribute("data-level");
        if (game && lv === game.lv && game.phase !== "done") return;
        prefs.lv = lv; savePrefs(); newGame(true, true);
      });
    });
    $("new-btn").addEventListener("click", function () { newGame(true, true); $("new-btn").blur(); });
    $("stats-btn").addEventListener("click", statsDialog);
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("move");   // audible confirmation when turned on
    });
    $("roll-btn").addEventListener("click", function () { roll(false); });
    $("undo-btn").addEventListener("click", function () { undoStep(); });
    $("done-btn").addEventListener("click", function () { done(); });
    wirePointer();

    var relayout = function () { renderBoard(); };
    if (window.ResizeObserver) new ResizeObserver(relayout).observe($("board-wrap"));
    else window.addEventListener("resize", relayout);

    window.addEventListener("pagehide", function () { if (game) saveSession(); });
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
    game = loadSession();
    if (game) {
      // The resumed game decides what the toolbar shows.
      prefs.mode = game.mode; prefs.lv = game.lv;
    } else {
      game = fresh(null);
      saveSession();
    }
    renderAll();
    resume();   // a game left on the computer's turn (or a pass) continues
  }

  boot();
})();
