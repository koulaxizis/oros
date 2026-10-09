// ============================================================
// orOS Battleship — App logic (v1.0.0)
// Sink the computer's fleet before it sinks yours. Two 10×10 seas;
// each side has five ships (5, 4, 3, 3 and 2 squares). You fire first,
// then one shot each in turn; a hit or a sunk ship is announced.
//   - place your fleet: tap a square (the ship's top / left end),
//     Rotate (R), Random, Clear; tap a placed ship to pick it up;
//     keyboard: arrows move, Enter / Space place, Backspace pick up
//   - option: ships may not touch (not even corners), default off
//   - computer levels: Easy (random shots) · Medium (hunt on a
//     checkerboard, then target around a hit and along a line) · Hard
//     (probability density of every ship that still fits)
//   - both seas on screen: side by side, or stacked on a phone
//   - a game in progress is kept on the device and resumes
// Data:
//   - synced slice "battleship" (oros-battleship-data): per level wins,
//     losses and the fewest shots in a win, as per-device rows (each
//     device only grows its own row; merge = per-row join) + a reset
//     stamp br
//   - device-local (R10): oros-battleship-prefs (level, no touching),
//     oros-battleship-session (the game in progress),
//     oros-battleship-device (row id), oros-battleship-sfx (sound on/off)
// Sections:
//   1. Constants, i18n, helpers
//   2. Sea model (ships, placement rules, random fleet, shots)
//   3. Computer player (easy / hunt-target / density)
//   4. Synced data: load / save / normalize / merge (R5, R26)
//   5. Device-local prefs + session
//   6. Game flow (place, start, fire, computer turn, finish)
//   7. Render (toolbar, status, layout, seas, dock)
//   8. Dialogs (result, records, options, confirm)
//   9. Toasts
//  10. Sound
//  11. Input (taps, hover, keys, Contract Β)
//  12. Sync slice + palette
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-battleship-data";
  var PREFS_KEY   = "oros-battleship-prefs";
  var SESSION_KEY = "oros-battleship-session";
  var DEVICE_KEY  = "oros-battleship-device";
  var SFX_KEY     = "oros-battleship-sfx";
  var DATA_VER    = 1;

  var N = 10, CELLS = 100;
  var FLEET = [5, 4, 3, 3, 2];
  var FLEET_CELLS = 17;
  var LEVELS = ["e", "m", "h"];
  var COLS = "ABCDEFGHIJ";
  var AI_DELAY = 550;                         // ms, so the reply is visible

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
      "btn.new": "New game (N)",
      "btn.opts": "Options",
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "level.e": "Easy", "level.m": "Medium", "level.h": "Hard",
      "st.mine": "Your ships", "st.theirs": "Enemy ships",
      "cap.enemy": "Enemy waters",
      "cap.mine": "Your fleet",
      "cap.dock": "Place your ships",
      "ship.0": "Carrier", "ship.1": "Battleship", "ship.2": "Cruiser", "ship.3": "Submarine", "ship.4": "Destroyer",
      "ship.label": "{s}, {n} squares",
      "ship.placed": "{s}, placed: tap to pick it up",
      "act.rotate": "Rotate", "act.random": "Random", "act.clear": "Clear", "act.start": "Start",
      "act.rotateLong": "Rotate the ship (R)",
      "act.vertical": "Vertical", "act.horizontal": "Horizontal",
      "turn.place": "Place the {s} ({n}): tap where it starts",
      "turn.ready": "Fleet ready: Start (Enter)",
      "turn.you": "Your shot: pick a square in enemy waters",
      "turn.ai": "The computer is aiming…",
      "turn.won": "You won in {n} shots!",
      "turn.lost": "The computer sank your fleet",
      "grid.enemy": "Enemy waters, 10 by 10",
      "grid.mine": "Your fleet, 10 by 10",
      "cell.unknown": "{c}",
      "cell.miss": "{c}, miss",
      "cell.hit": "{c}, hit",
      "cell.sunk": "{c}, sunk",
      "cell.ship": "{c}, your ship",
      "cell.water": "{c}, water",
      "live.you": "You fire at {c}: {r}",
      "live.ai": "The computer fires at {c}: {r}",
      "live.miss": "miss", "live.hit": "hit", "live.sunk": "{s} sunk!",
      "live.placed": "{s} placed at {c}",
      "live.won": "You won!",
      "live.lost": "The computer won",
      "res.won": "You won!",
      "res.lost": "The computer won",
      "res.shots": "Your shots",
      "res.acc": "Accuracy",
      "res.record": "Won · lost",
      "res.best": "Fewest shots",
      "res.rec": "New record!",
      "res.again": "Play again",
      "res.close": "Close",
      "stats.title": "Records",
      "stats.head": "Won · lost · fewest shots",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "opts.title": "Options",
      "opts.touch": "Ships may not touch",
      "opts.touchSub": "Not even at a corner: for both fleets",
      "opts.close": "Close",
      "confirm.reset": "Delete the records on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Records reset",
      "toast.newgame": "New game",
      "toast.undo": "Undo",
      "toast.bounds": "The ship does not fit there",
      "toast.overlap": "Ships cannot overlap",
      "toast.touch": "Ships may not touch (see Options)",
      "toast.pick": "Pick a ship first, or tap a placed one",
      "toast.notReady": "Place all five ships first",
      "toast.already": "Already fired at {c}",
      "toast.wait": "Wait for the computer's shot",
      "toast.ownSea": "Fire at enemy waters",
      "toast.over": "This game is over: start a new one (N)",
      "toast.nextGame": "Applies from the next game",
      "toast.touchFixed": "Ships that touched went back to the dock",
      "toast.placeFirst": "Place your fleet first",
      "toast.rotatePlace": "Ships turn only while you place them",
      "toast.empty": "No ships placed yet",
      "toast.save": "Could not save: storage is full"
    },
    el: {
      "btn.new": "Νέο παιχνίδι (N)",
      "btn.opts": "Επιλογές",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "level.e": "Εύκολο", "level.m": "Μέτριο", "level.h": "Δύσκολο",
      "st.mine": "Δικά σου", "st.theirs": "Εχθρικά",
      "cap.enemy": "Εχθρικά νερά",
      "cap.mine": "Ο στόλος σου",
      "cap.dock": "Τοποθέτησε τα πλοία",
      "ship.0": "Αεροπλανοφόρο", "ship.1": "Θωρηκτό", "ship.2": "Καταδρομικό", "ship.3": "Υποβρύχιο", "ship.4": "Αντιτορπιλικό",
      "ship.label": "{s}, {n} τετράγωνα",
      "ship.placed": "{s}, τοποθετήθηκε: πάτα για να το σηκώσεις",
      "act.rotate": "Περιστροφή", "act.random": "Τυχαία", "act.clear": "Καθάρισμα", "act.start": "Έναρξη",
      "act.rotateLong": "Περιστροφή του πλοίου (R)",
      "act.vertical": "Κάθετα", "act.horizontal": "Οριζόντια",
      "turn.place": "Βάλε το {s} ({n}): πάτα από πού ξεκινά",
      "turn.ready": "Ο στόλος είναι έτοιμος: Έναρξη (Enter)",
      "turn.you": "Σειρά σου: διάλεξε τετράγωνο στα εχθρικά νερά",
      "turn.ai": "Ο υπολογιστής σημαδεύει…",
      "turn.won": "Νίκησες με {n} βολές!",
      "turn.lost": "Ο υπολογιστής βύθισε τον στόλο σου",
      "grid.enemy": "Εχθρικά νερά, 10 επί 10",
      "grid.mine": "Ο στόλος σου, 10 επί 10",
      "cell.unknown": "{c}",
      "cell.miss": "{c}, άστοχο",
      "cell.hit": "{c}, χτύπημα",
      "cell.sunk": "{c}, βυθισμένο",
      "cell.ship": "{c}, δικό σου πλοίο",
      "cell.water": "{c}, νερό",
      "live.you": "Ρίχνεις στο {c}: {r}",
      "live.ai": "Ο υπολογιστής ρίχνει στο {c}: {r}",
      "live.miss": "άστοχο", "live.hit": "χτύπημα", "live.sunk": "βυθίστηκε το {s}!",
      "live.placed": "Το {s} μπήκε στο {c}",
      "live.won": "Νίκησες!",
      "live.lost": "Νίκησε ο υπολογιστής",
      "res.won": "Νίκησες!",
      "res.lost": "Νίκησε ο υπολογιστής",
      "res.shots": "Οι βολές σου",
      "res.acc": "Ευστοχία",
      "res.record": "Νίκες · ήττες",
      "res.best": "Λιγότερες βολές",
      "res.rec": "Νέο ρεκόρ!",
      "res.again": "Ξανά",
      "res.close": "Κλείσιμο",
      "stats.title": "Ρεκόρ",
      "stats.head": "Νίκες · ήττες · λιγότερες βολές",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "opts.title": "Επιλογές",
      "opts.touch": "Τα πλοία δεν ακουμπούν",
      "opts.touchSub": "Ούτε στη γωνία: και για τους δύο στόλους",
      "opts.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.newgame": "Νέο παιχνίδι",
      "toast.undo": "Αναίρεση",
      "toast.bounds": "Το πλοίο δεν χωράει εκεί",
      "toast.overlap": "Τα πλοία δεν μπορούν να επικαλύπτονται",
      "toast.touch": "Τα πλοία δεν πρέπει να ακουμπούν (δες τις Επιλογές)",
      "toast.pick": "Διάλεξε πρώτα πλοίο ή πάτα ένα τοποθετημένο",
      "toast.notReady": "Βάλε πρώτα και τα πέντε πλοία",
      "toast.already": "Έχεις ήδη ρίξει στο {c}",
      "toast.wait": "Περίμενε τη βολή του υπολογιστή",
      "toast.ownSea": "Ρίξε στα εχθρικά νερά",
      "toast.over": "Το παιχνίδι τελείωσε: ξεκίνα νέο (N)",
      "toast.nextGame": "Ισχύει από το επόμενο παιχνίδι",
      "toast.touchFixed": "Τα πλοία που ακουμπούσαν γύρισαν πίσω",
      "toast.placeFirst": "Τοποθέτησε πρώτα τον στόλο σου",
      "toast.rotatePlace": "Τα πλοία περιστρέφονται μόνο στην τοποθέτηση",
      "toast.empty": "Δεν έχεις βάλει ακόμα πλοία",
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

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("battleship.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Sea model ----------
  // A ship is { r, c, v }: its top / left square and vertical or not;
  // fleets are arrays in FLEET order (null = not placed yet). A square
  // is r * 10 + c.
  function coord(i) { return COLS[i % N] + (Math.floor(i / N) + 1); }

  function shipCells(s, len) {
    var out = [];
    for (var i = 0; i < len; i++) out.push((s.r + (s.v ? i : 0)) * N + s.c + (s.v ? 0 : i));
    return out;
  }
  function inBounds(s, len) {
    return !!s && isInt(s.r) && isInt(s.c) && typeof s.v === "boolean" && s.r >= 0 && s.c >= 0 &&
      (s.v ? s.r + len <= N && s.c < N : s.c + len <= N && s.r < N);
  }
  // Square → ship index, or -1.
  function occupancy(ships) {
    var occ = [];
    for (var i = 0; i < CELLS; i++) occ.push(-1);
    ships.forEach(function (s, k) {
      if (!s || !inBounds(s, FLEET[k])) return;
      shipCells(s, FLEET[k]).forEach(function (q) { if (occ[q] < 0) occ[q] = k; });
    });
    return occ;
  }
  // The 8 squares around one, inside the sea.
  function around(i) {
    var r = Math.floor(i / N), c = i % N, out = [];
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        if ((dr || dc) && r + dr >= 0 && r + dr < N && c + dc >= 0 && c + dc < N) out.push((r + dr) * N + c + dc);
      }
    }
    return out;
  }
  // "" when the (partial) fleet is legal, else "bounds" | "overlap" | "touch".
  function fleetProblem(ships, noTouch) {
    var occ = [], k, i;
    for (i = 0; i < CELLS; i++) occ.push(-1);
    for (k = 0; k < FLEET.length; k++) {
      var s = ships[k];
      if (!s) continue;
      if (!inBounds(s, FLEET[k])) return "bounds";
      var cells = shipCells(s, FLEET[k]);
      for (i = 0; i < cells.length; i++) {
        if (occ[cells[i]] >= 0) return "overlap";
        occ[cells[i]] = k;
      }
    }
    if (noTouch) {
      for (i = 0; i < CELLS; i++) {
        if (occ[i] < 0) continue;
        var nb = around(i);
        for (var j = 0; j < nb.length; j++) if (occ[nb[j]] >= 0 && occ[nb[j]] !== occ[i]) return "touch";
      }
    }
    return "";
  }
  // Where a ship goes for a tapped square: the square is its top / left
  // end, moved back so the ship fits inside the sea.
  function anchorAt(i, len, v) {
    var r = Math.floor(i / N), c = i % N;
    if (v) r = Math.min(r, N - len); else c = Math.min(c, N - len);
    return { r: r, c: c, v: v };
  }
  // A whole legal fleet at random (biggest ships first, restart if stuck).
  function randomFleet(rnd, noTouch) {
    for (var attempt = 0; attempt < 200; attempt++) {
      var ships = [null, null, null, null, null], ok = true;
      for (var k = 0; k < FLEET.length && ok; k++) {
        var len = FLEET[k], placed = false;
        for (var tries = 0; tries < 300 && !placed; tries++) {
          var v = rnd(2) === 1;
          var s = { r: rnd(v ? N - len + 1 : N), c: rnd(v ? N : N - len + 1), v: v };
          ships[k] = s;
          if (!fleetProblem(ships, noTouch)) placed = true;
          else ships[k] = null;
        }
        ok = placed;
      }
      if (ok) return ships;
    }
    return null;
  }
  function fleetComplete(ships) {
    return Array.isArray(ships) && ships.length === FLEET.length && ships.every(function (s) { return !!s; });
  }

  // What the shooter knows of a sea: per square 0 unknown, 1 miss,
  // 2 hit, 3 sunk; the lengths still afloat; the sunk ship indexes.
  function seaView(ships, shots) {
    var occ = occupancy(ships), view = [], shot = {}, i;
    for (i = 0; i < CELLS; i++) view.push(0);
    shots.forEach(function (q) { shot[q] = true; view[q] = occ[q] < 0 ? 1 : 2; });
    var afloat = [], sunk = [];
    ships.forEach(function (s, k) {
      if (!s) return;
      var cells = shipCells(s, FLEET[k]);
      if (cells.every(function (q) { return shot[q]; })) {
        sunk.push(k);
        cells.forEach(function (q) { view[q] = 3; });
      } else afloat.push(FLEET[k]);
    });
    return { view: view, afloat: afloat, sunk: sunk };
  }
  // One shot at a sea: { hit, sunk: ship index | -1, win }.
  function shotResult(ships, shots, q) {
    var k = occupancy(ships)[q];
    if (k < 0) return { hit: false, sunk: -1, win: false };
    var after = shots.concat([q]), set = {};
    after.forEach(function (x) { set[x] = true; });
    var isSunk = shipCells(ships[k], FLEET[k]).every(function (x) { return set[x]; });
    var win = ships.every(function (s, j) {
      return shipCells(s, FLEET[j]).every(function (x) { return set[x]; });
    });
    return { hit: true, sunk: isSunk ? k : -1, win: win };
  }

  // ---------- 3. Computer player ----------
  // Squares known to be empty: around sunk ships, and diagonal to a hit,
  // when ships may not touch.
  function knownEmpty(view, noTouch) {
    var out = {};
    if (!noTouch) return out;
    for (var i = 0; i < CELLS; i++) {
      if (view[i] === 3) around(i).forEach(function (q) { if (view[q] === 0) out[q] = true; });
      else if (view[i] === 2) {
        var r = Math.floor(i / N), c = i % N;
        [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(function (d) {
          var rr = r + d[0], cc = c + d[1];
          if (rr >= 0 && rr < N && cc >= 0 && cc < N && view[rr * N + cc] === 0) out[rr * N + cc] = true;
        });
      }
    }
    return out;
  }

  // Medium's target mode: beyond the ends of a line of hits; otherwise
  // the four neighbours of every hit.
  function targetCells(view, blocked) {
    var line = {}, near = {}, i;
    var open = function (q) { return view[q] === 0 && !blocked[q]; };
    for (i = 0; i < CELLS; i++) {
      if (view[i] !== 2) continue;
      var r = Math.floor(i / N), c = i % N;
      if ((c > 0 && view[i - 1] === 2) || (c < N - 1 && view[i + 1] === 2)) {
        var a = c, b = c;
        while (a > 0 && view[r * N + a - 1] === 2) a--;
        while (b < N - 1 && view[r * N + b + 1] === 2) b++;
        if (a > 0 && open(r * N + a - 1)) line[r * N + a - 1] = true;
        if (b < N - 1 && open(r * N + b + 1)) line[r * N + b + 1] = true;
      }
      if ((r > 0 && view[i - N] === 2) || (r < N - 1 && view[i + N] === 2)) {
        var u = r, d = r;
        while (u > 0 && view[(u - 1) * N + c] === 2) u--;
        while (d < N - 1 && view[(d + 1) * N + c] === 2) d++;
        if (u > 0 && open((u - 1) * N + c)) line[(u - 1) * N + c] = true;
        if (d < N - 1 && open((d + 1) * N + c)) line[(d + 1) * N + c] = true;
      }
      if (r > 0 && open(i - N)) near[i - N] = true;
      if (r < N - 1 && open(i + N)) near[i + N] = true;
      if (c > 0 && open(i - 1)) near[i - 1] = true;
      if (c < N - 1 && open(i + 1)) near[i + 1] = true;
    }
    var ln = Object.keys(line).map(Number);
    return ln.length ? ln : Object.keys(near).map(Number);
  }

  // Hard: for every ship still afloat, every place it could be; with
  // hits on the board only places that cover a hit count (heavily).
  function density(view, afloat, blocked) {
    var score = [], i, hits = 0;
    for (i = 0; i < CELLS; i++) { score.push(0); if (view[i] === 2) hits++; }
    afloat.forEach(function (len) {
      for (var v = 0; v < 2; v++) {
        for (var r = 0; r + (v ? len : 1) <= N; r++) {
          for (var c = 0; c + (v ? 1 : len) <= N; c++) {
            var cells = shipCells({ r: r, c: c, v: !!v }, len), cover = 0, bad = false;
            for (var k = 0; k < len; k++) {
              var x = view[cells[k]];
              if (x === 1 || x === 3 || blocked[cells[k]]) { bad = true; break; }
              if (x === 2) cover++;
            }
            if (bad || (hits && !cover)) continue;
            var w = cover ? 40 * cover * cover : 1;
            for (k = 0; k < len; k++) if (view[cells[k]] === 0) score[cells[k]] += w;
          }
        }
      }
    });
    return score;
  }

  // The computer's next square: never one already fired at.
  function aiPick(level, view, afloat, noTouch, rnd) {
    var blocked = level === "e" ? {} : knownEmpty(view, noTouch), open = [], i;
    for (i = 0; i < CELLS; i++) if (view[i] === 0 && !blocked[i]) open.push(i);
    if (!open.length) for (i = 0; i < CELLS; i++) if (view[i] === 0) open.push(i);
    if (!open.length) return -1;
    if (level === "e") return open[rnd(open.length)];
    if (level === "m") {
      var tg = targetCells(view, blocked);
      if (tg.length) return tg[rnd(tg.length)];
      var step = Math.max(1, Math.min.apply(null, afloat.length ? afloat : [2]));
      var par = open.filter(function (q) { return (Math.floor(q / N) + q % N) % step === 0; });
      var pool = par.length ? par : open;
      return pool[rnd(pool.length)];
    }
    // ties go to a square next to a hit (as likely, and it finishes the ship sooner)
    var sc = density(view, afloat, blocked), best = -1, cand = [];
    for (i = 0; i < CELLS; i++) {
      if (view[i] !== 2) continue;
      if (i >= N) sc[i - N] += 1;
      if (i < CELLS - N) sc[i + N] += 1;
      if (i % N > 0) sc[i - 1] += 1;
      if (i % N < N - 1) sc[i + 1] += 1;
    }
    open.forEach(function (q) {
      if (sc[q] > best) { best = sc[q]; cand = [q]; }
      else if (sc[q] === best) cand.push(q);
    });
    return cand[rnd(cand.length)];
  }

  // ---------- 4. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                       // max-merged
  //   rows: { <deviceId>: { b: <epoch>, s: { e|m|h: { w: wins, l: losses,
  //                                                   bs: fewest shots in a win (0 = none) } } } }
  // }
  // Each device only ever writes ITS OWN row; a row counts from epoch b.
  // Merge per row: the newer epoch wins; equal epochs take, per level,
  // the max of w and l and the smallest bs above 0. A join (symmetric,
  // associative, idempotent). Rows older than br drop.
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normCell(c) {
    if (!c || typeof c !== "object" || !isInt(c.w) || !isInt(c.l) || !isInt(c.bs) ||
        c.w < 0 || c.l < 0 || c.w + c.l < 1 ||
        (c.w === 0 ? c.bs !== 0 : (c.bs < FLEET_CELLS || c.bs > CELLS))) return null;
    return { w: c.w, l: c.l, bs: c.bs };
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
    return { w: Math.max(a.w, c.w), l: Math.max(a.l, c.l),
             bs: !a.bs ? c.bs : (!c.bs ? a.bs : Math.min(a.bs, c.bs)) };
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

  function mergeBattleship(A, B) {
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

  // Wins, losses and the fewest shots for a level, across every device.
  function totals(d, level) {
    var out = { w: 0, l: 0, bs: 0 };
    Object.keys(d.rows).forEach(function (id) {
      var c = d.rows[id].s[level];
      if (!c) return;
      out.w += c.w; out.l += c.l;
      if (c.bs && (!out.bs || c.bs < out.bs)) out.bs = c.bs;
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
          data = mergeBattleship(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] battleship: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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

  // Counts a finished game (shots = the player's shots when won, 0
  // when lost); true for a new fewest-shots record.
  function countGame(level, shots) {
    var before = totals(data, level);
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // new epoch after a reset
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    var c = row.s[level] || { w: 0, l: 0, bs: 0 };
    c = { w: c.w + (shots ? 1 : 0), l: c.l + (shots ? 0 : 1), bs: c.bs };
    if (shots && (!c.bs || shots < c.bs)) c.bs = shots;
    row.s[level] = c;
    data.rows[deviceId] = row;
    data = mergeBattleship(data, data);
    save();
    return !!shots && (!before.bs || shots < before.bs);
  }

  // ---------- 5. Device-local prefs + session ----------
  var prefs = { level: "m", noTouch: false };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (LEVELS.indexOf(p.level) >= 0) prefs.level = p.level;
        if (typeof p.noTouch === "boolean") prefs.noTouch = p.noTouch;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = { level, noTouch, phase: "place"|"play"|"done", mine: [ship|null ×5],
  //          theirs: [ship ×5] | null, myShots: [q], aiShots: [q], turn: "me"|"ai",
  //          sel: ship index being placed | -1, vert, winner: ""|"me"|"ai", rec }
  var game = null;

  function validShots(a) {
    if (!Array.isArray(a) || a.length > CELLS) return false;
    var seen = {};
    for (var i = 0; i < a.length; i++) {
      if (!isInt(a[i]) || a[i] < 0 || a[i] >= CELLS || seen[a[i]]) return false;
      seen[a[i]] = true;
    }
    return true;
  }
  function validSession(g) {
    if (!g || typeof g !== "object" || LEVELS.indexOf(g.level) < 0 || typeof g.noTouch !== "boolean" ||
        ["place", "play", "done"].indexOf(g.phase) < 0 || !Array.isArray(g.mine) || g.mine.length !== FLEET.length ||
        fleetProblem(g.mine, g.noTouch) || !validShots(g.myShots) || !validShots(g.aiShots) ||
        ["me", "ai"].indexOf(g.turn) < 0 || !isInt(g.sel) || g.sel < -1 || g.sel >= FLEET.length ||
        typeof g.vert !== "boolean" || ["", "me", "ai"].indexOf(g.winner) < 0 || typeof g.rec !== "boolean") return false;
    if (g.phase === "place") return !g.myShots.length && !g.aiShots.length && !g.winner;
    if (!fleetComplete(g.mine) || !fleetComplete(g.theirs) || fleetProblem(g.theirs, g.noTouch)) return false;
    var me = seaView(g.theirs, g.myShots), ai = seaView(g.mine, g.aiShots);
    var winner = !me.afloat.length ? "me" : (!ai.afloat.length ? "ai" : "");
    if (winner !== g.winner || (g.phase === "done") !== !!winner) return false;
    // turns alternate, the player first
    var d = g.myShots.length - g.aiShots.length;
    return winner ? (d === 0 || d === 1) : (g.turn === "me" ? d === 0 : d === 1);
  }
  function loadSession() {
    try {
      var g = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(g)) return g;
    } catch (e) {}
    return null;
  }
  function saveSession() {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(game)); } catch (e) {}
  }

  // ---------- 6. Game flow ----------
  function fresh() {
    return { level: prefs.level, noTouch: prefs.noTouch, phase: "place", mine: [null, null, null, null, null],
             theirs: null, myShots: [], aiShots: [], turn: "me", sel: 0, vert: false, winner: "", rec: false };
  }
  function inProgress() { return !!(game && game.phase === "play" && game.myShots.length > 0); }
  function nextUnplaced(from) {
    for (var k = 0; k < FLEET.length; k++) {
      var j = (from + k) % FLEET.length;
      if (!game.mine[j]) return j;
    }
    return -1;
  }

  var aiTimer = null, finishTimer = null;
  function cancelAi() { if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; } }

  // ----- placing -----
  function placeAt(q) {
    if (!game || game.phase !== "place") return;
    if (game.sel < 0) {
      var k0 = occupancy(game.mine)[q];
      if (k0 >= 0) { pickUp(k0); return; }
      showToast(t(fleetComplete(game.mine) ? "turn.ready" : "toast.pick"));
      return;
    }
    var occ = occupancy(game.mine);
    if (occ[q] >= 0 && occ[q] !== game.sel) { pickUp(occ[q]); return; }
    var k = game.sel, s = anchorAt(q, FLEET[k], game.vert), ships = game.mine.slice();
    ships[k] = s;
    var bad = fleetProblem(ships, game.noTouch);
    if (bad) { showToast(t("toast." + bad)); shakeGrid("grid-mine"); return; }
    game.mine = ships;
    game.sel = nextUnplaced(k + 1);
    saveSession();
    sfx("key");
    live(t("live.placed", { s: t("ship." + k), c: coord(s.r * N + s.c) }));
    renderAll();
  }
  function pickUp(k) {
    if (!game || game.phase !== "place") return;
    if (game.mine[k]) { game.vert = game.mine[k].v; game.mine[k] = null; }
    game.sel = k;
    saveSession();
    renderAll();
  }
  function rotate() {
    if (!game) return;
    if (game.phase !== "place") { showToast(t(game.phase === "done" ? "toast.over" : "toast.rotatePlace")); return; }
    game.vert = !game.vert;
    saveSession();
    renderAll();
  }
  function randomPlace() {
    if (!game || game.phase !== "place") return;
    var f = randomFleet(randInt, game.noTouch);
    if (!f) return;
    game.mine = f;
    game.sel = -1;
    saveSession();
    sfx("key");
    renderAll();
  }
  function clearFleet() {
    if (!game || game.phase !== "place") return;
    if (!game.mine.some(function (s) { return !!s; })) { showToast(t("toast.empty")); return; }
    var prev = JSON.parse(JSON.stringify(game));
    game.mine = [null, null, null, null, null];
    game.sel = 0;
    saveSession();
    renderAll();
    undoToast(t("act.clear"), function () { game = prev; saveSession(); renderAll(); });
  }
  function start() {
    if (!game || game.phase !== "place") return;
    if (!fleetComplete(game.mine)) { showToast(t("toast.notReady")); return; }
    game.theirs = randomFleet(randInt, game.noTouch);
    if (!game.theirs) return;
    game.phase = "play";
    game.turn = "me";
    game.sel = -1;
    cursor = 44;
    saveSession();
    renderAll(true);
    live(t("turn.you"));
  }

  // ----- firing -----
  function fire(q) {
    if (!game) return;
    if (game.phase === "place") { showToast(t("toast.placeFirst")); return; }
    if (game.phase === "done") { showToast(t("toast.over")); return; }          // R28
    if (game.turn !== "me") { showToast(t("toast.wait")); return; }
    if (game.myShots.indexOf(q) >= 0) { showToast(t("toast.already", { c: coord(q) })); shakeCell("grid-enemy", q); return; }
    var res = shotResult(game.theirs, game.myShots, q);
    game.myShots.push(q);
    announceShot("live.you", q, res);
    sfx(res.sunk >= 0 ? "sunk" : (res.hit ? "hit" : "miss"));
    if (res.win) { finish("me"); return; }
    game.turn = "ai";
    saveSession();
    renderAll();
    maybeAi();
  }
  function announceShot(key, q, res) {
    var r = res.sunk >= 0 ? t("live.sunk", { s: t("ship." + res.sunk) }) : t(res.hit ? "live.hit" : "live.miss");
    live(t(key, { c: coord(q), r: r }));
    lastShot = { who: key === "live.you" ? "me" : "ai", q: q };
  }
  var lastShot = null;

  function maybeAi() {
    if (!game || game.phase !== "play" || game.turn !== "ai" || aiTimer) return;
    aiTimer = setTimeout(function () {
      aiTimer = null;
      if (!game || game.phase !== "play" || game.turn !== "ai") return;
      var sv = seaView(game.mine, game.aiShots);
      var q = aiPick(game.level, sv.view, sv.afloat, game.noTouch, randInt);
      if (q < 0) return;
      var res = shotResult(game.mine, game.aiShots, q);
      game.aiShots.push(q);
      announceShot("live.ai", q, res);
      sfx(res.sunk >= 0 ? "sunk" : (res.hit ? "hit" : "miss"));
      if (res.win) { finish("ai"); return; }
      game.turn = "me";
      saveSession();
      renderAll();
    }, AI_DELAY);
  }

  function finish(winner) {
    cancelAi();
    game.phase = "done";
    game.winner = winner;
    game.turn = "me";
    game.rec = countGame(game.level, winner === "me" ? game.myShots.length : 0);
    saveSession();
    renderAll();
    setTimeout(function () { live(t(winner === "me" ? "live.won" : "live.lost")); }, 600);
    sfx(winner === "me" ? "win" : "lose");
    var g = game;
    clearTimeout(finishTimer);
    finishTimer = setTimeout(function () { if (game === g) resultDialog(); }, 1000);
  }

  // A game in progress is never lost silently: Undo toast (R14).
  function newGame(level) {
    closeDialogs();
    cancelAi();
    clearTimeout(finishTimer);
    var prev = inProgress() ? JSON.parse(JSON.stringify(game)) : null;
    var prevPrefs = JSON.parse(JSON.stringify(prefs));
    if (level) { prefs.level = level; savePrefs(); }
    game = fresh();
    cursor = 44;
    saveSession();
    renderAll(true);
    if (prev) {
      undoToast(t("toast.newgame"), function () {
        cancelAi();
        prefs = prevPrefs; savePrefs();
        game = prev;
        saveSession();
        renderAll(true);
        maybeAi();
      });
    } else {
      live(t("toast.newgame"));
    }
  }

  function setLevel(level) {
    if (game && level === game.level) return;
    if (game && game.phase === "place") {        // nothing to lose: keep the fleet being placed
      prefs.level = level; savePrefs();
      game.level = level;
      saveSession();
      renderAll();
      return;
    }
    newGame(level);
  }

  function setNoTouch(on) {
    prefs.noTouch = on; savePrefs();
    if (!game) return;
    if (game.phase !== "place") { showToast(t("toast.nextGame")); return; }
    game.noTouch = on;
    var dropped = false;
    if (on) {
      // put back every ship that touches one placed before it
      var keep = [null, null, null, null, null];
      for (var k = 0; k < FLEET.length; k++) {
        if (!game.mine[k]) continue;
        keep[k] = game.mine[k];
        if (fleetProblem(keep, true)) { keep[k] = null; dropped = true; }
      }
      game.mine = keep;
      if (dropped) game.sel = nextUnplaced(0);
    }
    saveSession();
    renderAll();
    if (dropped) showToast(t("toast.touchFixed"));
  }

  // ---------- 7. Render ----------
  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var cursor = 44, kbd = false, hover = -1;

  function renderAll(rebuild) {
    renderToolbar();
    renderStatus();
    renderSea("grid-enemy", rebuild);
    renderSea("grid-mine", rebuild);
    renderDock(rebuild);
    layout();
  }

  function renderToolbar() {
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      var on = !!game && b.getAttribute("data-level") === game.level;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    paintSfxBtn();
  }

  function renderStatus() {
    var mv = seaView(game.mine, game.aiShots), tv = game.theirs ? seaView(game.theirs, game.myShots) : null;
    $("mine-left").textContent = String(game.phase === "place" ? game.mine.filter(Boolean).length : mv.afloat.length);
    $("theirs-left").textContent = String(tv ? tv.afloat.length : FLEET.length);
    var msg, cls = "";
    if (game.phase === "place") {
      msg = game.sel >= 0 ? t("turn.place", { s: t("ship." + game.sel), n: FLEET[game.sel] }) : t("turn.ready");
    } else if (game.phase === "done") {
      if (game.winner === "me") { msg = t("turn.won", { n: game.myShots.length }); cls = "done"; }
      else { msg = t("turn.lost"); cls = "warn"; }
    } else msg = t(game.turn === "me" ? "turn.you" : "turn.ai");
    $("turn").textContent = msg;
    $("turn").className = cls;
  }

  // Both seas (or sea + dock) as large as the space allows: side by
  // side, or stacked with the active sea bigger.
  function layout() {
    var wrap = $("board-wrap"), box = $("boards");
    var cs = getComputedStyle(wrap);
    var W = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var H = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (W <= 0 || H <= 0) return;
    var place = game.phase === "place", CAP = 26, GAP = 14, U = 10.6;   // 10 squares + the label strip
    box.classList.toggle("placing", place);
    var side, stack, ratio = 1;
    if (place) {
      // the dock's height when it sits under the sea (it does not depend on --cell)
      box.classList.add("stack");
      box.classList.remove("side");
      var dockW = Math.min(250, Math.max(200, W * 0.3)), dockH = $("dock").offsetHeight + 2;
      side = Math.min((W - GAP - dockW) / U, (H - CAP) / U);
      stack = Math.min(W / U, (H - CAP - GAP - dockH) / U);
    } else {
      side = Math.min((W - GAP) / (2 * U), (H - CAP) / U);
      ratio = 0.62;
      stack = Math.min(W / U, (H - 2 * CAP - GAP) / (U * (1 + ratio)));
    }
    var useSide = side >= stack * 0.92;
    var c = Math.floor(Math.max(12, Math.min(useSide ? side : stack, 46)));
    var c2 = useSide ? c : Math.floor(Math.max(10, c * ratio));
    if (!useSide && !place) c2 = Math.floor(Math.max(10, Math.min(c2, (H - 2 * CAP - GAP - c * U) / U)));
    box.classList.toggle("side", useSide);
    box.classList.toggle("stack", !useSide);
    $("panel-enemy").style.setProperty("--cell", c + "px");
    $("panel-mine").style.setProperty("--cell", (place ? c : c2) + "px");
    $("dock").style.setProperty("--cell", Math.min(c, 26) + "px");
  }

  function buildSea(id) {
    var grid = $(id), enemy = id === "grid-enemy";
    grid.innerHTML = "";
    grid.appendChild(el("span", "lbl corner"));
    for (var c = 0; c < N; c++) grid.appendChild(el("span", "lbl", COLS[c]));
    for (var r = 0; r < N; r++) {
      grid.appendChild(el("span", "lbl", String(r + 1)));
      for (var k = 0; k < N; k++) {
        var b = el("button", "sq");
        b.type = "button";
        b.tabIndex = -1;
        b.setAttribute("data-q", String(r * N + k));
        b.setAttribute("role", "gridcell");
        grid.appendChild(b);
      }
    }
    grid.setAttribute("aria-label", t(enemy ? "grid.enemy" : "grid.mine"));
    grid.setAttribute("data-built", "1");
  }

  // Ship squares get their end / middle shape for a capsule look.
  function shipShape(ships, occ, q) {
    var k = occ[q];
    if (k < 0 || !ships[k]) return "";
    var cells = shipCells(ships[k], FLEET[k]), i = cells.indexOf(q);
    return " ship " + (ships[k].v ? "v" : "h") + (i === 0 ? " first" : (i === cells.length - 1 ? " last" : ""));
  }

  function renderSea(id, rebuild) {
    var grid = $(id), enemy = id === "grid-enemy";
    if (rebuild || !grid.getAttribute("data-built")) buildSea(id);
    var place = game.phase === "place";
    $(enemy ? "panel-enemy" : "panel-mine").hidden = enemy && place;
    if (enemy && place) return;
    var ships = enemy ? game.theirs : game.mine, shots = enemy ? game.myShots : game.aiShots;
    var sv = seaView(ships, shots), occ = occupancy(ships);
    var show = !enemy || game.phase === "done";          // enemy ships show at the end
    var ghost = {}, ghostBad = false;
    if (!enemy && place && game.sel >= 0 && (hover >= 0 || kbd)) {
      var at = hover >= 0 ? hover : cursor, s = anchorAt(at, FLEET[game.sel], game.vert), tmp = game.mine.slice();
      tmp[game.sel] = s;
      ghostBad = !!fleetProblem(tmp, game.noTouch);
      shipCells(s, FLEET[game.sel]).forEach(function (q) { ghost[q] = true; });
    }
    var active = enemy ? (game.phase === "play" && game.turn === "me") : place;
    grid.classList.toggle("active", active);
    grid.classList.toggle("wait", enemy && game.phase === "play" && game.turn !== "me");
    var sqs = grid.querySelectorAll(".sq");
    for (var q = 0; q < CELLS; q++) {
      var b = sqs[q], v = sv.view[q], cls = "sq";
      if (show) cls += shipShape(ships, occ, q);
      else if (v === 3) cls += shipShape(ships, occ, q);
      if (v === 1) cls += " miss";
      else if (v === 2) cls += " hit";
      else if (v === 3) cls += " hit sunk";
      if (ghost[q]) cls += ghostBad ? " ghost bad" : " ghost";
      if (kbd && active && q === cursor) cls += " cur";
      if (lastShot && q === lastShot.q && lastShot.who === (enemy ? "me" : "ai") && !reduced) cls += " last";
      if (b.className !== cls) b.className = cls;
      var lab;
      if (v === 1) lab = "cell.miss";
      else if (v === 2) lab = "cell.hit";
      else if (v === 3) lab = "cell.sunk";
      else if (!enemy) lab = occ[q] >= 0 ? "cell.ship" : "cell.water";
      else lab = "cell.unknown";
      b.setAttribute("aria-label", t(lab, { c: coord(q) }));
      b.setAttribute("aria-disabled", active ? "false" : "true");
    }
  }

  function renderDock(rebuild) {
    var place = game.phase === "place";
    $("dock").hidden = !place;
    if (!place) return;
    var list = $("ships");
    if (rebuild || list.children.length !== FLEET.length) {
      list.innerHTML = "";
      FLEET.forEach(function (len, k) {
        var b = el("button", "dship");
        b.type = "button";
        b.setAttribute("data-k", String(k));
        var bar = el("span", "dbar");
        for (var i = 0; i < len; i++) bar.appendChild(el("i"));
        b.appendChild(bar);
        b.appendChild(el("span", "dname", t("ship." + k)));
        list.appendChild(b);
      });
    }
    [].forEach.call(list.children, function (b) {
      var k = +b.getAttribute("data-k"), placed = !!game.mine[k];
      b.classList.toggle("placed", placed);
      b.classList.toggle("sel", k === game.sel);
      b.setAttribute("aria-pressed", k === game.sel ? "true" : "false");
      b.setAttribute("aria-label", t(placed ? "ship.placed" : "ship.label", { s: t("ship." + k), n: FLEET[k] }));
    });
    $("rotate-btn").querySelector("span").textContent = t(game.vert ? "act.vertical" : "act.horizontal");
    $("rotate-btn").classList.toggle("vert", game.vert);
    $("start-btn").setAttribute("aria-disabled", fleetComplete(game.mine) ? "false" : "true");
    $("clear-btn").setAttribute("aria-disabled", game.mine.some(Boolean) ? "false" : "true");
  }

  function shakeGrid(id) {
    var g = $(id);
    if (!g || reduced) return;
    g.classList.remove("shake");
    void g.offsetWidth;
    g.classList.add("shake");
    setTimeout(function () { g.classList.remove("shake"); }, 400);
  }
  function shakeCell(id, q) {
    var b = $(id).querySelectorAll(".sq")[q];
    if (!b || reduced) return;
    b.classList.remove("shake");
    void b.offsetWidth;
    b.classList.add("shake");
    setTimeout(function () { b.classList.remove("shake"); }, 400);
  }

  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 8. Dialogs ----------
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

  function resultDialog() {
    if (!game || game.phase !== "done") return;
    closeDialogs();
    var won = game.winner === "me", s = totals(data, game.level);
    var hits = seaView(game.theirs, game.myShots).view.filter(function (v) { return v >= 2; }).length;
    var dlg = makeDialog("battleship-result");
    dlg.appendChild(el("div", "dlg-title", t("level." + game.level)));
    dlg.appendChild(el("div", "dlg-hero" + (won ? "" : " lost"), t(won ? "res.won" : "res.lost")));
    if (won && game.rec) dlg.appendChild(el("div", "dlg-badge", t("res.rec")));
    dlg.appendChild(row(t("res.shots"), String(game.myShots.length)));
    dlg.appendChild(row(t("res.acc"), (game.myShots.length ? Math.round(100 * hits / game.myShots.length) : 0) + "%"));
    dlg.appendChild(row(t("res.record"), s.w + " · " + s.l));
    dlg.appendChild(row(t("res.best"), s.bs ? String(s.bs) : "–"));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("res.close"), "", function () { dlg.close(); }));
    var again = button(t("res.again"), "primary", function () { dlg.close(); newGame(); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    again.focus();
  }

  function statsDialog() {
    var dlg = makeDialog("battleship-stats"), empty = true;
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    LEVELS.forEach(function (lv) {
      var s = totals(data, lv);
      if (s.w + s.l) empty = false;
      dlg.appendChild(row(t("level." + lv), s.w + s.l ? s.w + " · " + s.l + " · " + (s.bs || "–") : "–"));
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

  function optsDialog() {
    var dlg = makeDialog("battleship-opts");
    dlg.appendChild(el("div", "dlg-title", t("opts.title")));
    var lab = el("label", "bs-opt");
    var box = el("input");
    box.type = "checkbox";
    box.checked = game && game.phase === "place" ? game.noTouch : prefs.noTouch;
    box.addEventListener("change", function () { setNoTouch(box.checked); });
    lab.appendChild(box);
    var txt = el("span", "bs-opt-txt");
    txt.appendChild(el("strong", "", t("opts.touch")));
    txt.appendChild(el("span", "", t("opts.touchSub")));
    lab.appendChild(txt);
    dlg.appendChild(lab);
    var acts = el("div", "dlg-actions");
    var close = button(t("opts.close"), "primary", function () { dlg.close(); });
    acts.appendChild(close);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    close.focus();
  }

  function confirmDialog(msg, onYes) {
    var dlg = makeDialog("battleship-confirm");
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

  // Reset = a new epoch: every device drops rows older than br.
  function resetRecords() {
    data.br = Math.max(Date.now(), data.br + 1);
    data = mergeBattleship(data, data);
    save();
    renderStatus();
    showToast(t("toast.reset"));
  }

  // ---------- 9. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "battleship", title: String(text) })) return;
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

  // ---------- 10. Sound ----------
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
      if (kind === "win") {
        [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
      } else if (kind === "lose") {
        [392, 330, 262].forEach(function (f, k) { tone(f, k * 0.14, 0.2, "triangle", 0.12); });
      } else if (kind === "sunk") {
        [180, 140, 110].forEach(function (f, k) { tone(f, k * 0.09, 0.16, "sawtooth", 0.08); });
      } else if (kind === "hit") {
        tone(150, 0, 0.18, "sawtooth", 0.1);
      } else if (kind === "miss") {
        tone(520, 0, 0.1, "sine", 0.08);
      } else tone(620, 0, 0.05, "triangle", 0.1);
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Toolbar icons (R9: injected by JS) ----------
  var UI_ICONS = {
    new:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    opts:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
    stats:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    rotate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
    random: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
    clear:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    start:  '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M7 4.5v15l12-7.5z"/></svg>',
    sfxOn:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    sfxOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>'
  };
  function paintSfxBtn() {
    var b = $("sfx-btn"), on = sfxOn();
    b.innerHTML = on ? UI_ICONS.sfxOn : UI_ICONS.sfxOff;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.setAttribute("aria-label", t(on ? "btn.sfxOn" : "btn.sfxOff"));
    b.title = t(on ? "btn.sfxOn" : "btn.sfxOff");
  }

  // ---------- 11. Input ----------
  var KEY_DIR = { ArrowUp: -N, ArrowDown: N, ArrowLeft: -1, ArrowRight: 1 };

  function moveCursor(d) {
    var r = Math.floor(cursor / N), c = cursor % N;
    if (d === -1) c = Math.max(0, c - 1);
    else if (d === 1) c = Math.min(N - 1, c + 1);
    else if (d === -N) r = Math.max(0, r - 1);
    else r = Math.min(N - 1, r + 1);
    cursor = r * N + c;
    kbd = true;
    hover = -1;
    renderSea("grid-enemy");
    renderSea("grid-mine");
  }

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;   // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      if (!game) return;
      if (KEY_DIR[e.key] !== undefined) { e.preventDefault(); moveCursor(KEY_DIR[e.key]); return; }
      if (e.key === "Enter" || e.key === " ") {
        var a = document.activeElement;
        if (a && a.tagName === "BUTTON" && !a.classList.contains("sq")) return;   // a focused button keeps Enter
        e.preventDefault();
        if (e.repeat) return;
        if (game.phase === "place") {
          if (game.sel < 0 && fleetComplete(game.mine)) start();
          else { kbd = true; placeAt(cursor); }
        } else fire(cursor);
        return;
      }
      if (e.repeat) return;
      if (e.key === "Backspace" || e.key === "Delete") {
        if (game.phase !== "place") return;
        e.preventDefault();
        var k = occupancy(game.mine)[cursor];
        if (k >= 0) pickUp(k); else showToast(t("toast.pick"));
        return;
      }
      if (e.code === "KeyR") { e.preventDefault(); rotate(); return; }
      if (e.code === "KeyN") { e.preventDefault(); newGame(); }
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

  function wirePointer() {
    $("grid-enemy").addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".sq");
      if (!b) return;
      kbd = false;
      cursor = +b.getAttribute("data-q");
      fire(cursor);
    });
    $("grid-mine").addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".sq");
      if (!b || !game) return;
      kbd = false;
      cursor = +b.getAttribute("data-q");
      if (game.phase === "place") placeAt(cursor);
      else showToast(t(game.phase === "done" ? "toast.over" : "toast.ownSea"));
    });
    // mouse hover shows where the ship being placed would go
    $("grid-mine").addEventListener("pointermove", function (e) {
      if (e.pointerType !== "mouse" || !game || game.phase !== "place") return;
      var b = e.target.closest && e.target.closest(".sq"), q = b ? +b.getAttribute("data-q") : -1;
      if (q !== hover) { hover = q; kbd = false; renderSea("grid-mine"); }
    });
    $("grid-mine").addEventListener("pointerleave", function () {
      if (hover >= 0) { hover = -1; renderSea("grid-mine"); }
    });
    $("ships").addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".dship");
      if (b) pickUp(+b.getAttribute("data-k"));
    });
    $("rotate-btn").addEventListener("click", function () { rotate(); });
    $("random-btn").addEventListener("click", function () { randomPlace(); });
    $("clear-btn").addEventListener("click", function () { clearFleet(); });
    $("start-btn").addEventListener("click", function () { start(); $("start-btn").blur(); });
  }

  // ---------- 12. Sync slice + palette ----------
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
    api.registerSlice("battleship", sliceGet, sliceSet, STORAGE_KEY, mergeBattleship);
  }

  function sliceGet() {
    return mergeBattleship(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeBattleship(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    // no toast on merge (sync feedback = taskbar dot)
  }

  // ---------- 13. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    $("cap-enemy").textContent = t("cap.enemy");
    $("cap-mine").textContent = t("cap.mine");
    $("cap-dock").textContent = t("cap.dock");
  }

  function paintStatic() {
    [["opts-btn", "opts", "btn.opts"], ["new-btn", "new", "btn.new"],
     ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    [["rotate-btn", "rotate", "act.horizontal", "act.rotateLong"], ["random-btn", "random", "act.random"],
     ["clear-btn", "clear", "act.clear"], ["start-btn", "start", "act.start"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]] + "<span>" + t(x[2]) + "</span>";
      if (x[3]) { b.title = t(x[3]); b.setAttribute("aria-label", t(x[3])); }
    });
    paintSfxBtn();
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () { setLevel(b.getAttribute("data-level")); b.blur(); });
    });
    $("new-btn").addEventListener("click", function () { newGame(); $("new-btn").blur(); });
    // blurred first, so a closed dialog does not hand Enter back to them
    $("opts-btn").addEventListener("click", function () { $("opts-btn").blur(); optsDialog(); });
    $("stats-btn").addEventListener("click", function () { $("stats-btn").blur(); statsDialog(); });
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("key");   // audible confirmation when turned on
    });
    wirePointer();
    var relayout = function () { if (game) layout(); };
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
    game = loadSession() || fresh();
    if (prefs.level !== game.level) { prefs.level = game.level; savePrefs(); }
    saveSession();
    renderAll(true);
    maybeAi();
  }

  boot();
})();
