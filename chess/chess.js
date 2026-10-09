// ============================================================
// orOS Chess — App logic (v1.0.0)
// Full rules: castling, en passant, promotion (choice dialog), check,
// checkmate, stalemate, the 50-move rule, threefold repetition and
// insufficient material (all drawn automatically).
//   - vs Computer, 3 levels: Easy (shallow search that often picks a
//     worse move on purpose, always takes a mate in one) · Medium
//     (alpha-beta to depth 4 with a short capture search, picks among
//     equal moves) · Hard (iterative deepening, alpha-beta with a
//     transposition table, killer / history ordering, check extension
//     and full quiescence; ~0.9 s budget). The search runs in a Blob
//     Web Worker, so the page never freezes (fallback: a short search
//     on the page after a paint)
//   - play white, black or a random side; the board turns for black;
//     2 players on one device; flip button
//   - click-to-move and drag (mouse), tap-tap (touch), keyboard
//     (arrows + Enter), legal-move dots, last-move and check marks,
//     SAN move list
//   - undo (vs the computer: your move and its answer; the game then
//     counts for no record)
// Data:
//   - synced slice "chess" (oros-chess-data): results vs the computer
//     per level [won, drawn, lost] as per-device counter rows (each
//     device only grows its own row; merge = per-row join) + a reset
//     stamp br. 2-player games are not recorded.
//   - device-local (R10): oros-chess-prefs (mode, level, side, flip),
//     oros-chess-session (the game in progress as UCI moves),
//     oros-chess-device (row id), oros-chess-sfx (sound on/off)
// Sections:
//   1. Constants, i18n, helpers
//   2. Rules engine + computer player (makeEngine, also the worker)
//   3. Synced data: load / save / normalize / merge (R5, R26)
//   4. Device-local prefs + session
//   5. Game flow (new, select, move, promotion, computer, undo, finish)
//   6. Render (toolbar, status, board, move list)
//   7. Dialogs (promotion, result, records, confirm)
//   8. Toasts
//   9. Sound
//  10. Input (pointer: click / drag / tap; keyboard; Contract Β)
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-chess-data";
  var PREFS_KEY   = "oros-chess-prefs";
  var SESSION_KEY = "oros-chess-session";
  var DEVICE_KEY  = "oros-chess-device";
  var SFX_KEY     = "oros-chess-sfx";
  var DATA_VER    = 1;

  var LEVELS = ["e", "m", "h"];
  var MODES = ["ai", "duo"];
  var SIDES = ["w", "b", "r"];
  var MAX_PLIES = 1200;                      // a session longer than this is junk
  var AI_MIN_DELAY = 350;                    // ms, so the reply is visible
  var DRAG_PX = 5;
  var SLIDE_MS = 160;

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
      "side.w": "As white", "side.b": "As black", "side.r": "Random side",
      "side.label": "Your pieces",
      "name.you": "You", "name.ai": "Computer", "name.w": "White", "name.b": "Black",
      "sidel.w": "White", "sidel.b": "Black",
      "color.w": "white", "color.b": "black",
      "piece.1": "pawn", "piece.2": "knight", "piece.3": "bishop",
      "piece.4": "rook", "piece.5": "queen", "piece.6": "king",
      "turn.you": "Your move", "turn.ai": "Computer is thinking…",
      "turn.side": "{side} to move", "turn.check": "Check!",
      "turn.mate": "Checkmate · {who}", "turn.draw": "Draw · {why}",
      "who.you": "you win", "who.ai": "the computer wins", "who.w": "White wins", "who.b": "Black wins",
      "why.stalemate": "stalemate", "why.fifty": "50-move rule",
      "why.rep": "threefold repetition", "why.material": "insufficient material",
      "moves.title": "Moves", "st.unrated": "Unrated",
      "btn.new": "New game (N)", "btn.undo": "Undo move (U)",
      "btn.undoNone": "Nothing to undo",
      "btn.flip": "Turn the board (F)",
      "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "board.label": "Chess board",
      "sq.empty": "{sq}", "sq.piece": "{sq}: {color} {piece}",
      "live.move": "{who}: {san}",
      "promo.title": "Promote to",
      "promo.cancel": "Cancel",
      "res.title": "Game over",
      "res.youwin": "You win!",
      "res.ailose": "The computer wins",
      "res.pwin": "{side} wins!",
      "res.draw": "Draw",
      "res.mate": "Checkmate",
      "res.stalemate": "Stalemate",
      "res.fifty": "50 moves without a capture or a pawn move",
      "res.rep": "The same position three times",
      "res.material": "Not enough pieces left to mate",
      "res.moves": "Moves",
      "res.rec": "Won · drawn · lost",
      "res.unrated": "Undo was used: this game is not recorded",
      "res.again": "Play again",
      "res.close": "Close",
      "stats.title": "Records vs computer",
      "stats.head": "Won · drawn · lost",
      "stats.note": "Games with an undo and 2-player games are not recorded.",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "confirm.reset": "Delete the records vs the computer on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "toast.reset": "Records reset",
      "toast.newgame": "New game started",
      "toast.undo": "Undo",
      "toast.save": "Could not save: storage is full",
      "toast.wait": "The computer is playing",
      "toast.over": "The game is over: start a new one (N)",
      "toast.notYours": "It is {side}'s move",
      "toast.aiPiece": "That is the computer's piece",
      "toast.noMoves": "That piece has no legal move",
      "toast.illegal": "Illegal move",
      "toast.inCheck": "Illegal move: your king is in check",
      "toast.pinned": "Illegal move: it would leave your king in check",
      "toast.undone": "Undone: this game will not be recorded"
    },
    el: {
      "mode.ai": "Με υπολογιστή", "mode.duo": "2 παίκτες",
      "level.e": "Εύκολο", "level.m": "Μεσαίο", "level.h": "Δύσκολο",
      "side.w": "Με λευκά", "side.b": "Με μαύρα", "side.r": "Τυχαία",
      "side.label": "Τα πιόνια σου",
      "name.you": "Εσύ", "name.ai": "Υπολογιστής", "name.w": "Λευκά", "name.b": "Μαύρα",
      "sidel.w": "λευκά", "sidel.b": "μαύρα",
      "color.w": "των λευκών", "color.b": "των μαύρων",
      "piece.1": "πιόνι", "piece.2": "ίππος", "piece.3": "αξιωματικός",
      "piece.4": "πύργος", "piece.5": "βασίλισσα", "piece.6": "βασιλιάς",
      "turn.you": "Σειρά σου", "turn.ai": "Ο υπολογιστής σκέφτεται…",
      "turn.side": "Παίζουν τα {side}", "turn.check": "Σαχ!",
      "turn.mate": "Ματ · {who}", "turn.draw": "Ισοπαλία · {why}",
      "who.you": "κέρδισες", "who.ai": "κέρδισε ο υπολογιστής", "who.w": "κέρδισαν τα λευκά", "who.b": "κέρδισαν τα μαύρα",
      "why.stalemate": "πατ", "why.fifty": "κανόνας 50 κινήσεων",
      "why.rep": "τριπλή επανάληψη", "why.material": "ανεπαρκές υλικό",
      "moves.title": "Κινήσεις", "st.unrated": "Χωρίς βαθμολογία",
      "btn.new": "Νέα παρτίδα (N)", "btn.undo": "Αναίρεση κίνησης (U)",
      "btn.undoNone": "Δεν υπάρχει κίνηση για αναίρεση",
      "btn.flip": "Γύρισμα σκακιέρας (F)",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "board.label": "Σκακιέρα",
      "sq.empty": "{sq}", "sq.piece": "{sq}: {piece} {color}",
      "live.move": "{who}: {san}",
      "promo.title": "Προαγωγή σε",
      "promo.cancel": "Άκυρο",
      "res.title": "Τέλος παρτίδας",
      "res.youwin": "Κέρδισες!",
      "res.ailose": "Κέρδισε ο υπολογιστής",
      "res.pwin": "Κέρδισαν τα {side}!",
      "res.draw": "Ισοπαλία",
      "res.mate": "Ματ",
      "res.stalemate": "Πατ",
      "res.fifty": "50 κινήσεις χωρίς αιχμαλωσία ή κίνηση πιονιού",
      "res.rep": "Η ίδια θέση τρεις φορές",
      "res.material": "Δεν έμειναν αρκετά κομμάτια για ματ",
      "res.moves": "Κινήσεις",
      "res.rec": "Νίκες · ισοπαλίες · ήττες",
      "res.unrated": "Έγινε αναίρεση: η παρτίδα δεν καταγράφεται",
      "res.again": "Ξανά",
      "res.close": "Κλείσιμο",
      "stats.title": "Ρεκόρ με υπολογιστή",
      "stats.head": "Νίκες · ισοπαλίες · ήττες",
      "stats.note": "Οι παρτίδες με αναίρεση και οι παρτίδες 2 παικτών δεν καταγράφονται.",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ με τον υπολογιστή σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.newgame": "Ξεκίνησε νέα παρτίδα",
      "toast.undo": "Αναίρεση",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "toast.wait": "Παίζει ο υπολογιστής",
      "toast.over": "Η παρτίδα τελείωσε: ξεκίνα νέα (N)",
      "toast.notYours": "Παίζουν τα {side}",
      "toast.aiPiece": "Αυτό το κομμάτι είναι του υπολογιστή",
      "toast.noMoves": "Αυτό το κομμάτι δεν έχει νόμιμη κίνηση",
      "toast.illegal": "Μη νόμιμη κίνηση",
      "toast.inCheck": "Μη νόμιμη κίνηση: ο βασιλιάς σου έχει σαχ",
      "toast.pinned": "Μη νόμιμη κίνηση: ο βασιλιάς σου θα έμενε σε σαχ",
      "toast.undone": "Έγινε αναίρεση: η παρτίδα δεν θα καταγραφεί"
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

  // crypto RNG in [0, 1)
  function rand() {
    var buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return (buf[0] * 2097152 + (buf[1] >>> 11)) / 9007199254740992;
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("chess.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Rules engine + computer player ----------
  // The whole rules engine and computer player in one function, so the
  // same source runs here and in a Blob Web Worker (makeEngine.toString()).
  // Board: 0x88, square = rank * 16 + file, rank 0 = rank "1".
  // Pieces: 1 P, 2 N, 3 B, 4 R, 5 Q, 6 K; white > 0, black < 0.
  // Move: from | to << 7 | promo << 14 | flags << 17
  //   (flags: 1 capture, 2 en passant, 4 castling, 8 double push).
  function makeEngine() {
    "use strict";
    var START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    var N_OFF = [33, 31, 18, 14, -14, -18, -31, -33];
    var B_OFF = [15, 17, -15, -17];
    var R_OFF = [1, -1, 16, -16];
    var K_OFF = [1, -1, 16, -16, 15, 17, -15, -17];
    var F_CAP = 1, F_EP = 2, F_CASTLE = 4, F_DBL = 8;
    var VAL = [0, 100, 320, 330, 500, 900, 0];
    var MATE = 30000, INF = 32000;
    var nowf = (typeof performance !== "undefined" && performance.now) ?
      function () { return performance.now(); } : function () { return Date.now(); };

    // Rights kept when a move touches a square (a1 h1 e1 a8 h8 e8).
    var CASTLE_KEEP = [];
    for (var ci = 0; ci < 128; ci++) CASTLE_KEEP.push(15);
    CASTLE_KEEP[0] = 13; CASTLE_KEEP[7] = 14; CASTLE_KEEP[4] = 12;
    CASTLE_KEEP[112] = 7; CASTLE_KEEP[119] = 11; CASTLE_KEEP[116] = 3;

    // Zobrist keys: two 32-bit halves, from a fixed seed (same everywhere).
    var seed = 0x9e3779b9;
    function rnd32() {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return seed | 0;
    }
    var Z1 = [], Z2 = [], ZC1 = [], ZC2 = [], ZE1 = [], ZE2 = [];
    for (var zp = 0; zp < 12; zp++) {
      var a1 = [], a2 = [];
      for (var zs = 0; zs < 128; zs++) { a1.push(rnd32()); a2.push(rnd32()); }
      Z1.push(a1); Z2.push(a2);
    }
    for (var zc = 0; zc < 16; zc++) { ZC1.push(rnd32()); ZC2.push(rnd32()); }
    for (var ze = 0; ze < 8; ze++) { ZE1.push(rnd32()); ZE2.push(rnd32()); }
    var ZT1 = rnd32(), ZT2 = rnd32();
    function zi(p) { return p > 0 ? p - 1 : 5 - p; }

    // Piece-square tables, as seen by white with rank 8 on the first line.
    var PST = [null, [
       0,  0,  0,  0,  0,  0,  0,  0,  50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,   5,  5, 10, 25, 25, 10,  5,  5,
       0,  0,  0, 20, 20,  0,  0,  0,   5, -5,-10,  0,  0,-10, -5,  5,
       5, 10, 10,-20,-20, 10, 10,  5,   0,  0,  0,  0,  0,  0,  0,  0], [
     -50,-40,-30,-30,-30,-30,-40,-50, -40,-20,  0,  0,  0,  0,-20,-40,
     -30,  0, 10, 15, 15, 10,  0,-30, -30,  5, 15, 20, 20, 15,  5,-30,
     -30,  0, 15, 20, 20, 15,  0,-30, -30,  5, 10, 15, 15, 10,  5,-30,
     -40,-20,  0,  5,  5,  0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50], [
     -20,-10,-10,-10,-10,-10,-10,-20, -10,  0,  0,  0,  0,  0,  0,-10,
     -10,  0,  5, 10, 10,  5,  0,-10, -10,  5,  5, 10, 10,  5,  5,-10,
     -10,  0, 10, 10, 10, 10,  0,-10, -10, 10, 10, 10, 10, 10, 10,-10,
     -10,  5,  0,  0,  0,  0,  5,-10, -20,-10,-10,-10,-10,-10,-10,-20], [
       0,  0,  0,  0,  0,  0,  0,  0,   5, 10, 10, 10, 10, 10, 10,  5,
      -5,  0,  0,  0,  0,  0,  0, -5,  -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,  -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,   0,  0,  0,  5,  5,  0,  0,  0], [
     -20,-10,-10, -5, -5,-10,-10,-20, -10,  0,  0,  0,  0,  0,  0,-10,
     -10,  0,  5,  5,  5,  5,  0,-10,  -5,  0,  5,  5,  5,  5,  0, -5,
       0,  0,  5,  5,  5,  5,  0, -5, -10,  5,  5,  5,  5,  5,  0,-10,
     -10,  0,  5,  0,  0,  0,  0,-10, -20,-10,-10, -5, -5,-10,-10,-20], [
     -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
     -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
     -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10,
      20, 20,  0,  0,  0,  0, 20, 20,  20, 30, 10,  0,  0, 10, 30, 20]];
    var KING_END = [
     -50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,  0,  0,-10,-20,-30,
     -30,-10, 20, 30, 30, 20,-10,-30, -30,-10, 30, 40, 40, 30,-10,-30,
     -30,-10, 30, 40, 40, 30,-10,-30, -30,-10, 20, 30, 30, 20,-10,-30,
     -30,-30,  0,  0,  0,  0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50];

    function sqName(s) { return "abcdefgh".charAt(s & 7) + ((s >> 4) + 1); }
    function sqFrom(n) {
      var f = "abcdefgh".indexOf(n.charAt(0)), r = "12345678".indexOf(n.charAt(1));
      return (f < 0 || r < 0 || n.length !== 2) ? -1 : r * 16 + f;
    }
    function mFrom(m) { return m & 127; }
    function mTo(m) { return (m >> 7) & 127; }
    function mPromo(m) { return (m >> 14) & 7; }
    function mFlags(m) { return m >> 17; }
    function mk(f, t, pr, fl) { return f | (t << 7) | (pr << 14) | (fl << 17); }

    // ---- position ----
    function rehash(P) {
      var h1 = 0, h2 = 0;
      for (var s = 0; s < 128; s++) {
        if ((s & 0x88) || !P.b[s]) continue;
        h1 ^= Z1[zi(P.b[s])][s]; h2 ^= Z2[zi(P.b[s])][s];
      }
      h1 ^= ZC1[P.c]; h2 ^= ZC2[P.c];
      if (P.ep >= 0) { h1 ^= ZE1[P.ep & 7]; h2 ^= ZE2[P.ep & 7]; }
      if (P.t < 0) { h1 ^= ZT1; h2 ^= ZT2; }
      P.z1 = h1; P.z2 = h2;
    }

    // Is there a pawn of side `side` that could take en passant on ep?
    function epUsable(b, ep, side) {
      var from = ep - 16 * side;
      return (!((from - 1) & 0x88) && b[from - 1] === side) ||
             (!((from + 1) & 0x88) && b[from + 1] === side);
    }

    function parseFen(fen) {
      var parts = String(fen || "").trim().split(/\s+/);
      if (parts.length < 4) return null;
      var b = [], kw = -1, kb = -1, r = 7, f = 0, rows = parts[0].split("/");
      for (var i = 0; i < 128; i++) b.push(0);
      if (rows.length !== 8) return null;
      for (r = 0; r < 8; r++) {
        f = 0;
        var row = rows[7 - r];
        for (var k = 0; k < row.length; k++) {
          var ch = row.charAt(k);
          if (/[1-8]/.test(ch)) { f += +ch; continue; }
          var ty = "pnbrqk".indexOf(ch.toLowerCase());
          if (ty < 0 || f > 7) return null;
          var p = (ty + 1) * (ch === ch.toLowerCase() ? -1 : 1);
          b[r * 16 + f] = p;
          if (p === 6) kw = r * 16 + f;
          if (p === -6) kb = r * 16 + f;
          f++;
        }
        if (f !== 8) return null;
      }
      if (kw < 0 || kb < 0) return null;
      var c = 0;
      if (parts[2].indexOf("K") >= 0) c |= 1;
      if (parts[2].indexOf("Q") >= 0) c |= 2;
      if (parts[2].indexOf("k") >= 0) c |= 4;
      if (parts[2].indexOf("q") >= 0) c |= 8;
      var t = parts[1] === "b" ? -1 : 1;
      var ep = parts[3] === "-" ? -1 : sqFrom(parts[3]);
      if (ep >= 0 && !epUsable(b, ep, t)) ep = -1;
      var P = { b: b, t: t, c: c, ep: ep, h: +(parts[4] || 0) || 0, n: +(parts[5] || 1) || 1,
                kw: kw, kb: kb, z1: 0, z2: 0, stack: [], keys: [] };
      rehash(P);
      return P;
    }

    function toFen(P) {
      var out = [];
      for (var r = 7; r >= 0; r--) {
        var row = "", empty = 0;
        for (var f = 0; f < 8; f++) {
          var p = P.b[r * 16 + f];
          if (!p) { empty++; continue; }
          if (empty) { row += empty; empty = 0; }
          var ch = "pnbrqk".charAt(Math.abs(p) - 1);
          row += p > 0 ? ch.toUpperCase() : ch;
        }
        if (empty) row += empty;
        out.push(row);
      }
      var c = (P.c & 1 ? "K" : "") + (P.c & 2 ? "Q" : "") + (P.c & 4 ? "k" : "") + (P.c & 8 ? "q" : "");
      return out.join("/") + " " + (P.t > 0 ? "w" : "b") + " " + (c || "-") + " " +
        (P.ep >= 0 ? sqName(P.ep) : "-") + " " + P.h + " " + P.n;
    }

    function attacked(P, sq, by) {
      var b = P.b, s, i, p;
      if (by > 0) {
        s = sq - 15; if (!(s & 0x88) && b[s] === 1) return true;
        s = sq - 17; if (!(s & 0x88) && b[s] === 1) return true;
      } else {
        s = sq + 15; if (!(s & 0x88) && b[s] === -1) return true;
        s = sq + 17; if (!(s & 0x88) && b[s] === -1) return true;
      }
      for (i = 0; i < 8; i++) {
        s = sq + N_OFF[i]; if (!(s & 0x88) && b[s] === 2 * by) return true;
        s = sq + K_OFF[i]; if (!(s & 0x88) && b[s] === 6 * by) return true;
      }
      for (i = 0; i < 4; i++) {
        s = sq + B_OFF[i];
        while (!(s & 0x88)) {
          p = b[s];
          if (p) { if (p === 3 * by || p === 5 * by) return true; break; }
          s += B_OFF[i];
        }
        s = sq + R_OFF[i];
        while (!(s & 0x88)) {
          p = b[s];
          if (p) { if (p === 4 * by || p === 5 * by) return true; break; }
          s += R_OFF[i];
        }
      }
      return false;
    }

    function inCheck(P) { return attacked(P, P.t > 0 ? P.kw : P.kb, -P.t); }

    // Pseudo-legal moves (capsOnly: captures and promotions).
    function genMoves(P, capsOnly) {
      var b = P.b, t = P.t, out = [], s, to, p, i, d, ty;
      for (s = 0; s < 120; s++) {
        if (s & 0x88) { s += 7; continue; }
        p = b[s];
        if (!p || (p > 0) !== (t > 0)) continue;
        ty = p * t;
        if (ty === 1) {
          var dir = 16 * t, rank = s >> 4, last = t > 0 ? 6 : 1;
          to = s + dir;
          if (!b[to]) {
            if (rank === last) { for (var pr = 5; pr >= 2; pr--) out.push(mk(s, to, pr, 0)); }
            else if (!capsOnly) {
              out.push(mk(s, to, 0, 0));
              if (rank === (t > 0 ? 1 : 6) && !b[to + dir]) out.push(mk(s, to + dir, 0, F_DBL));
            }
          }
          for (i = -1; i <= 1; i += 2) {
            to = s + dir + i;
            if (to & 0x88) continue;
            if (b[to] * t < 0) {
              if (rank === last) { for (var pc = 5; pc >= 2; pc--) out.push(mk(s, to, pc, F_CAP)); }
              else out.push(mk(s, to, 0, F_CAP));
            } else if (to === P.ep) out.push(mk(s, to, 0, F_CAP | F_EP));
          }
        } else if (ty === 2 || ty === 6) {
          var offs = ty === 2 ? N_OFF : K_OFF;
          for (i = 0; i < 8; i++) {
            to = s + offs[i];
            if (to & 0x88) continue;
            if (!b[to]) { if (!capsOnly) out.push(mk(s, to, 0, 0)); }
            else if (b[to] * t < 0) out.push(mk(s, to, 0, F_CAP));
          }
        } else {
          var dirs = ty === 3 ? B_OFF : (ty === 4 ? R_OFF : K_OFF);
          for (i = 0; i < dirs.length; i++) {
            d = dirs[i];
            to = s + d;
            while (!(to & 0x88)) {
              if (!b[to]) { if (!capsOnly) out.push(mk(s, to, 0, 0)); }
              else { if (b[to] * t < 0) out.push(mk(s, to, 0, F_CAP)); break; }
              to += d;
            }
          }
        }
      }
      if (!capsOnly) {
        var base = t > 0 ? 0 : 112, kingSq = base + 4;
        if (b[kingSq] === 6 * t) {
          if ((P.c & (t > 0 ? 1 : 4)) && !b[base + 5] && !b[base + 6] && b[base + 7] === 4 * t &&
              !attacked(P, kingSq, -t) && !attacked(P, base + 5, -t) && !attacked(P, base + 6, -t)) {
            out.push(mk(kingSq, base + 6, 0, F_CASTLE));
          }
          if ((P.c & (t > 0 ? 2 : 8)) && !b[base + 3] && !b[base + 2] && !b[base + 1] && b[base] === 4 * t &&
              !attacked(P, kingSq, -t) && !attacked(P, base + 3, -t) && !attacked(P, base + 2, -t)) {
            out.push(mk(kingSq, base + 2, 0, F_CASTLE));
          }
        }
      }
      return out;
    }

    function setSq(P, s, p) {
      var old = P.b[s];
      if (old) { P.z1 ^= Z1[zi(old)][s]; P.z2 ^= Z2[zi(old)][s]; }
      if (p) { P.z1 ^= Z1[zi(p)][s]; P.z2 ^= Z2[zi(p)][s]; }
      P.b[s] = p;
    }

    // Plays m; returns false (and takes it back) when it leaves the king in check.
    function makeMove(P, m) {
      var f = mFrom(m), to = mTo(m), pr = mPromo(m), fl = mFlags(m), t = P.t;
      var piece = P.b[f], cap = P.b[to], capSq = to;
      P.stack.push({ m: m, cap: 0, c: P.c, ep: P.ep, h: P.h, z1: P.z1, z2: P.z2 });
      P.keys.push(P.z1);
      if (fl & F_EP) { capSq = to - 16 * t; cap = P.b[capSq]; setSq(P, capSq, 0); }
      P.stack[P.stack.length - 1].cap = cap;
      setSq(P, to, pr ? pr * t : piece);
      setSq(P, f, 0);
      if (fl & F_CASTLE) {
        if ((to & 7) === 6) { setSq(P, to - 1, P.b[to + 1]); setSq(P, to + 1, 0); }
        else { setSq(P, to + 1, P.b[to - 2]); setSq(P, to - 2, 0); }
      }
      if (piece === 6) P.kw = to; else if (piece === -6) P.kb = to;
      P.z1 ^= ZC1[P.c]; P.z2 ^= ZC2[P.c];
      P.c &= CASTLE_KEEP[f] & CASTLE_KEEP[to];
      P.z1 ^= ZC1[P.c]; P.z2 ^= ZC2[P.c];
      if (P.ep >= 0) { P.z1 ^= ZE1[P.ep & 7]; P.z2 ^= ZE2[P.ep & 7]; }
      P.ep = -1;
      if ((fl & F_DBL) && epUsable(P.b, f + 16 * t, -t)) {
        P.ep = f + 16 * t;
        P.z1 ^= ZE1[P.ep & 7]; P.z2 ^= ZE2[P.ep & 7];
      }
      P.h = (cap || piece * t === 1) ? 0 : P.h + 1;
      if (t < 0) P.n++;
      P.t = -t;
      P.z1 ^= ZT1; P.z2 ^= ZT2;
      if (attacked(P, t > 0 ? P.kw : P.kb, -t)) { unmakeMove(P); return false; }
      return true;
    }

    function unmakeMove(P) {
      var u = P.stack.pop();
      P.keys.pop();
      var m = u.m, f = mFrom(m), to = mTo(m), fl = mFlags(m);
      P.t = -P.t;
      var t = P.t, piece = mPromo(m) ? t : P.b[to];
      P.b[f] = piece;
      P.b[to] = 0;
      if (fl & F_EP) P.b[to - 16 * t] = u.cap; else P.b[to] = u.cap;
      if (fl & F_CASTLE) {
        if ((to & 7) === 6) { P.b[to + 1] = P.b[to - 1]; P.b[to - 1] = 0; }
        else { P.b[to - 2] = P.b[to + 1]; P.b[to + 1] = 0; }
      }
      if (piece === 6) P.kw = f; else if (piece === -6) P.kb = f;
      P.c = u.c; P.ep = u.ep; P.h = u.h; P.z1 = u.z1; P.z2 = u.z2;
      if (t < 0) P.n--;
    }

    function legalMoves(P) {
      var all = genMoves(P, false), out = [];
      for (var i = 0; i < all.length; i++) {
        if (makeMove(P, all[i])) { unmakeMove(P); out.push(all[i]); }
      }
      return out;
    }

    function perft(P, depth) {
      if (depth === 0) return 1;
      var all = genMoves(P, false), n = 0;
      for (var i = 0; i < all.length; i++) {
        if (!makeMove(P, all[i])) continue;
        n += depth === 1 ? 1 : perft(P, depth - 1);
        unmakeMove(P);
      }
      return n;
    }

    // ---- notation ----
    function toUci(m) {
      return sqName(mFrom(m)) + sqName(mTo(m)) + (mPromo(m) ? "nbrq".charAt(mPromo(m) - 2) : "");
    }
    function fromUci(P, str) {
      str = String(str || "");
      var f = sqFrom(str.slice(0, 2)), to = sqFrom(str.slice(2, 4));
      var pr = str.length === 5 ? "nbrq".indexOf(str.charAt(4)) + 2 : 0;
      if (f < 0 || to < 0 || pr === 1 || str.length > 5) return 0;
      var legal = legalMoves(P);
      for (var i = 0; i < legal.length; i++) {
        var m = legal[i];
        if (mFrom(m) === f && mTo(m) === to && mPromo(m) === pr) return m;
      }
      return 0;
    }

    function san(P, m) {
      var f = mFrom(m), to = mTo(m), fl = mFlags(m), ty = Math.abs(P.b[f]), s;
      if (fl & F_CASTLE) s = (to & 7) === 6 ? "O-O" : "O-O-O";
      else if (ty === 1) {
        s = (fl & F_CAP) ? sqName(f).charAt(0) + "x" + sqName(to) : sqName(to);
        if (mPromo(m)) s += "=" + "NBRQ".charAt(mPromo(m) - 2);
      } else {
        var legal = legalMoves(P), same = false, fileHit = false, rankHit = false;
        for (var i = 0; i < legal.length; i++) {
          var o = legal[i], of = mFrom(o);
          if (of === f || mTo(o) !== to || Math.abs(P.b[of]) !== ty) continue;
          same = true;
          if ((of & 7) === (f & 7)) fileHit = true;
          if ((of >> 4) === (f >> 4)) rankHit = true;
        }
        var dis = !same ? "" : (!fileHit ? sqName(f).charAt(0) :
                  (!rankHit ? sqName(f).charAt(1) : sqName(f)));
        s = "NBRQK".charAt(ty - 2) + dis + ((fl & F_CAP) ? "x" : "") + sqName(to);
      }
      makeMove(P, m);
      if (inCheck(P)) s += legalMoves(P).length ? "+" : "#";
      unmakeMove(P);
      return s;
    }

    // ---- game state ----
    function insufficient(P) {
      var minors = [];
      for (var s = 0; s < 120; s++) {
        if (s & 0x88) { s += 7; continue; }
        var ty = Math.abs(P.b[s]);
        if (ty === 1 || ty === 4 || ty === 5) return false;
        if (ty === 2 || ty === 3) minors.push({ ty: ty, c: ((s >> 4) + (s & 7)) & 1 });
      }
      if (minors.length <= 1) return true;
      for (var i = 0; i < minors.length; i++) {
        if (minors[i].ty !== 3 || minors[i].c !== minors[0].c) return false;
      }
      return true;
    }

    function repeats(P) {
      var n = 1;
      for (var i = P.keys.length - 2; i >= 0 && i >= P.keys.length - P.h; i -= 2) {
        if (P.keys[i] === P.z1 && P.stack[i].z2 === P.z2) n++;
      }
      return n;
    }

    // { over, result: "1-0" | "0-1" | "1/2", reason: mate | stalemate | fifty | rep | material }
    function status(P) {
      var any = legalMoves(P).length > 0;
      if (!any) {
        if (inCheck(P)) return { over: true, result: P.t > 0 ? "0-1" : "1-0", reason: "mate" };
        return { over: true, result: "1/2", reason: "stalemate" };
      }
      if (insufficient(P)) return { over: true, result: "1/2", reason: "material" };
      if (P.h >= 100) return { over: true, result: "1/2", reason: "fifty" };
      if (repeats(P) >= 3) return { over: true, result: "1/2", reason: "rep" };
      return { over: false, result: "", reason: "" };
    }

    // Replays UCI moves from the start (or fen); null if one is illegal.
    function replay(moves, fen) {
      var P = parseFen(fen || START), sans = [];
      for (var i = 0; i < moves.length; i++) {
        var m = fromUci(P, moves[i]);
        if (!m) return null;
        sans.push(san(P, m));
        makeMove(P, m);
      }
      return { pos: P, sans: sans };
    }

    // ---- evaluation (centipawns, from white's side) ----
    function evaluate(P) {
      var b = P.b, mg = 0, npm = 0, s, p, ty, idx, wMat = 0, bMat = 0;
      for (s = 0; s < 120; s++) {
        if (s & 0x88) { s += 7; continue; }
        p = b[s];
        if (!p) continue;
        ty = p > 0 ? p : -p;
        idx = p > 0 ? (7 - (s >> 4)) * 8 + (s & 7) : (s >> 4) * 8 + (s & 7);
        if (ty === 6) continue;
        var v = VAL[ty] + PST[ty][idx];
        if (ty > 1) npm += VAL[ty];
        if (p > 0) { mg += v; wMat += VAL[ty]; } else { mg -= v; bMat += VAL[ty]; }
      }
      // King: middle game table fades into the end game table.
      var ph = Math.min(1, npm / 6200);
      var wi = (7 - (P.kw >> 4)) * 8 + (P.kw & 7), bi = (P.kb >> 4) * 8 + (P.kb & 7);
      mg += Math.round(ph * (PST[6][wi] - PST[6][bi]) + (1 - ph) * (KING_END[wi] - KING_END[bi]));
      // Mop-up: the side ahead drives the bare king to the edge.
      if (npm <= 1400 && Math.abs(wMat - bMat) >= 300) {
        var win = wMat > bMat ? 1 : -1, lk = win > 0 ? P.kb : P.kw, wk = win > 0 ? P.kw : P.kb;
        var cd = Math.max(3 - (lk >> 4), (lk >> 4) - 4) + Math.max(3 - (lk & 7), (lk & 7) - 4);
        var kd = Math.abs((lk >> 4) - (wk >> 4)) + Math.abs((lk & 7) - (wk & 7));
        mg += win * (10 * cd + 4 * (14 - kd));
      }
      return mg;
    }

    // ---- search ----
    var TT_BITS = 18, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
    var ttKey = new Int32Array(TT_SIZE), ttMove = new Int32Array(TT_SIZE);
    var ttScore = new Int32Array(TT_SIZE), ttDepth = new Int8Array(TT_SIZE), ttFlag = new Int8Array(TT_SIZE);
    function ttClear() { ttFlag.fill(0); }

    function Abort() {}

    function orderScore(P, m, ttm, ctx, ply) {
      if (m === ttm) return 1e7;
      var fl = mFlags(m);
      if (fl & F_CAP) {
        var victim = (fl & F_EP) ? 1 : Math.abs(P.b[mTo(m)]);
        return 1e6 + VAL[victim] * 10 - VAL[Math.abs(P.b[mFrom(m)])] / 10 + (mPromo(m) === 5 ? 9000 : 0);
      }
      if (mPromo(m) === 5) return 9e5;
      if (ctx.killers[ply] && (ctx.killers[ply][0] === m || ctx.killers[ply][1] === m)) return 8e5;
      return ctx.hist[(m & 0x3fff)] || 0;
    }

    function sortMoves(P, moves, ttm, ctx, ply) {
      var sc = [];
      for (var i = 0; i < moves.length; i++) sc.push(orderScore(P, moves[i], ttm, ctx, ply));
      // insertion sort: lists are short
      for (var a = 1; a < moves.length; a++) {
        var m = moves[a], s = sc[a], j = a - 1;
        while (j >= 0 && sc[j] < s) { moves[j + 1] = moves[j]; sc[j + 1] = sc[j]; j--; }
        moves[j + 1] = m; sc[j + 1] = s;
      }
      return moves;
    }

    function quiesce(P, alpha, beta, ply, qd, ctx) {
      if ((++ctx.nodes & 2047) === 0 && nowf() > ctx.deadline) throw new Abort();
      var stand = evaluate(P) * P.t;
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      if (qd <= 0) return stand;
      var moves = sortMoves(P, genMoves(P, true), 0, ctx, ply);
      for (var i = 0; i < moves.length; i++) {
        if (!makeMove(P, moves[i])) continue;
        var s = -quiesce(P, -beta, -alpha, ply + 1, qd - 1, ctx);
        unmakeMove(P);
        if (s >= beta) return s;
        if (s > alpha) alpha = s;
      }
      return alpha;
    }

    function isRepeat(P) {
      for (var i = P.keys.length - 2; i >= 0 && i >= P.keys.length - P.h; i -= 2) {
        if (P.keys[i] === P.z1) return true;
      }
      return false;
    }

    function search(P, depth, alpha, beta, ply, ctx) {
      if ((++ctx.nodes & 2047) === 0 && nowf() > ctx.deadline) throw new Abort();
      if (ply > 0 && (P.h >= 100 || isRepeat(P))) return 0;
      var check = inCheck(P);
      if (check && ply < 40) depth++;
      if (depth <= 0) return quiesce(P, alpha, beta, ply, ctx.qd, ctx);
      var slot = P.z1 & TT_MASK, ttm = 0, a0 = alpha;
      if (ttFlag[slot] && ttKey[slot] === P.z2) {
        ttm = ttMove[slot];
        if (ply > 0 && ttDepth[slot] >= depth) {
          var ts = ttScore[slot];
          if (ts > MATE - 1000) ts -= ply; else if (ts < -MATE + 1000) ts += ply;
          var tf = ttFlag[slot];
          if (tf === 1) return ts;
          if (tf === 2 && ts >= beta) return ts;
          if (tf === 3 && ts <= alpha) return ts;
        }
      }
      var moves = sortMoves(P, genMoves(P, false), ttm, ctx, ply);
      var best = -INF, bestMove = 0, legal = 0;
      for (var i = 0; i < moves.length; i++) {
        var m = moves[i];
        if (!makeMove(P, m)) continue;
        legal++;
        var s;
        try { s = -search(P, depth - 1, -beta, -alpha, ply + 1, ctx); }
        finally { unmakeMove(P); }
        if (s > best) { best = s; bestMove = m; }
        if (s > alpha) alpha = s;
        if (alpha >= beta) {
          if (!(mFlags(m) & F_CAP)) {
            var k = ctx.killers[ply] || (ctx.killers[ply] = [0, 0]);
            if (k[0] !== m) { k[1] = k[0]; k[0] = m; }
            ctx.hist[m & 0x3fff] = (ctx.hist[m & 0x3fff] || 0) + depth * depth;
          }
          break;
        }
      }
      if (!legal) return check ? -MATE + ply : 0;
      var st = best;
      if (st > MATE - 1000) st += ply; else if (st < -MATE + 1000) st -= ply;
      ttKey[slot] = P.z2; ttMove[slot] = bestMove; ttScore[slot] = st;
      ttDepth[slot] = depth; ttFlag[slot] = best <= a0 ? 3 : (best >= beta ? 2 : 1);
      return best;
    }

    // Every root move with its score at this depth (exact for all with
    // full windows, or alpha-beta bounds when only the best one matters).
    function rootSearch(P, moves, depth, ctx, exact) {
      var out = [], alpha = -INF;
      for (var i = 0; i < moves.length; i++) {
        makeMove(P, moves[i]);
        var s;
        try { s = -search(P, depth - 1, -INF, exact ? INF : -alpha, 1, ctx); }
        finally { unmakeMove(P); }
        out.push({ m: moves[i], s: s });
        if (s > alpha) alpha = s;
      }
      return out;
    }

    var LEVELS = {
      e: { depth: 2, qd: 0, budget: 300, exact: true },
      m: { depth: 4, qd: 4, budget: 500, exact: true },
      h: { depth: 30, qd: 16, budget: 900, exact: false }
    };

    // The computer's move for level e | m | h; rnd() in [0, 1).
    function choose(P, level, rnd, budget) {
      var L = LEVELS[level] || LEVELS.m;
      rnd = rnd || Math.random;
      var moves = legalMoves(P);
      if (!moves.length) return { move: 0, score: 0, depth: 0 };
      // A mate in one is always taken.
      for (var i = 0; i < moves.length; i++) {
        makeMove(P, moves[i]);
        var mate = inCheck(P) && legalMoves(P).length === 0;
        unmakeMove(P);
        if (mate) return { move: moves[i], score: MATE - 1, depth: 1 };
      }
      if (moves.length === 1) return { move: moves[0], score: 0, depth: 0 };
      var ctx = { nodes: 0, deadline: Infinity, qd: L.qd, killers: [], hist: {} };
      var start = nowf(), limit = budget || L.budget, scores = null, depth = 0;
      ttClear();
      for (var d = 1; d <= L.depth; d++) {
        ctx.deadline = d === 1 ? Infinity : start + limit;
        try { scores = rootSearch(P, moves, d, ctx, L.exact); depth = d; }
        catch (e) { if (e instanceof Abort) break; throw e; }
        scores.sort(function (x, y) { return y.s - x.s; });
        moves = scores.map(function (x) { return x.m; });
        if (scores[0].s > MATE - 1000 || nowf() - start > limit * 0.55) break;
      }
      var pick = scores[0];
      if (level === "e") {
        // Deliberate mistakes: often the best move, sometimes a worse one.
        var r = rnd();
        if (r < 0.3) pick = scores[Math.floor(rnd() * scores.length)];
        else if (r < 0.6) pick = scores[Math.floor(rnd() * Math.min(4, scores.length))];
      } else if (level === "m") {
        var near = scores.filter(function (x) { return x.s >= scores[0].s - 15; });
        pick = near[Math.floor(rnd() * near.length)];
      }
      return { move: pick.m, score: pick.s, depth: depth, nodes: ctx.nodes };
    }

    return {
      START: START, parseFen: parseFen, toFen: toFen, legalMoves: legalMoves, genMoves: genMoves, makeMove: makeMove,
      unmakeMove: unmakeMove, perft: perft, inCheck: inCheck, attacked: attacked, toUci: toUci,
      fromUci: fromUci, san: san, status: status, replay: replay, insufficient: insufficient,
      evaluate: evaluate, choose: choose, sqName: sqName, sqFrom: sqFrom,
      mFrom: mFrom, mTo: mTo, mPromo: mPromo, mFlags: mFlags
    };
  }

  var E = makeEngine();
  var GLYPH = ["", "♟", "♞", "♝", "♜", "♛", "♚"];
  var PIECE_VAL = [0, 1, 3, 3, 5, 9, 0];

  // ---------- 3. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                               // max-merged
  //   rows: { <deviceId>: { b: <epoch>, s: { e:[w,d,l], m:[…], h:[…] } } }
  // }
  // Each device only ever increments ITS OWN row; a row counts from
  // epoch b. Merge per row: the newer epoch wins, equal epochs take the
  // per-cell max; rows older than br are dropped. That is a join
  // (symmetric, associative, idempotent), so no result is lost or
  // double-counted however the devices meet.
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normRow(row) {
    if (!row || typeof row !== "object" || !isInt(row.b) || row.b < 0) return null;
    var s = {}, any = false;
    LEVELS.forEach(function (lv) {
      var v = row.s && row.s[lv];
      if (Array.isArray(v) && v.length === 3 &&
          isInt(v[0]) && isInt(v[1]) && isInt(v[2]) && v[0] >= 0 && v[1] >= 0 && v[2] >= 0) {
        s[lv] = [v[0], v[1], v[2]];
        any = true;
      }
    });
    return any ? { b: row.b, s: s } : null;
  }

  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var s = {};
    LEVELS.forEach(function (lv) {
      var a = x.s[lv], c = y.s[lv];
      if (!a && !c) return;
      if (!a) { s[lv] = c.slice(); return; }
      if (!c) { s[lv] = a.slice(); return; }
      s[lv] = [Math.max(a[0], c[0]), Math.max(a[1], c[1]), Math.max(a[2], c[2])];
    });
    return { b: x.b, s: s };
  }

  function mergeChess(A, B) {
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
      LEVELS.forEach(function (lv) { if (r.s[lv]) s[lv] = r.s[lv].slice(); });
      sorted[id] = { b: r.b, s: s };
    });
    return { ver: DATA_VER, br: br, rows: sorted };
  }

  // Totals per level across every device: [won, drawn, lost].
  function totals(lv) {
    var out = [0, 0, 0];
    Object.keys(data.rows).forEach(function (id) {
      var v = data.rows[id].s[lv];
      if (v) { out[0] += v[0]; out[1] += v[1]; out[2] += v[2]; }
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
          data = mergeChess(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] chess: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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

  // res: 0 = you won, 1 = draw, 2 = you lost
  function countResult(lv, res) {
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // a new epoch after a reset
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    var v = row.s[lv] ? row.s[lv].slice() : [0, 0, 0];
    v[res]++;
    row.s[lv] = v;
    data.rows[deviceId] = row;
    data = mergeChess(data, data);
    save();
  }

  // ---------- 4. Device-local prefs + session ----------
  var prefs = { mode: "ai", lv: "m", side: "w", flip: false };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (MODES.indexOf(p.mode) >= 0) prefs.mode = p.mode;
        if (LEVELS.indexOf(p.lv) >= 0) prefs.lv = p.lv;
        if (SIDES.indexOf(p.side) >= 0) prefs.side = p.side;
        prefs.flip = p.flip === true;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = {
  //   mode, lv,
  //   human: "w" | "b",    // your side vs the computer ("w" with 2 players)
  //   moves: [uci…],       // from the start position
  //   done: bool,
  //   unrated: bool        // an undo was used vs the computer
  // }
  // The position is always replayed from moves.
  var game = null;
  var pos = null, sans = [], legal = [], st = null;

  function validSession(g) {
    if (!g || typeof g !== "object" || MODES.indexOf(g.mode) < 0 ||
        LEVELS.indexOf(g.lv) < 0 || (g.human !== "w" && g.human !== "b") ||
        !Array.isArray(g.moves) || g.moves.length > MAX_PLIES) return false;
    for (var i = 0; i < g.moves.length; i++) {
      if (typeof g.moves[i] !== "string" || !/^[a-h][1-8][a-h][1-8][nbrq]?$/.test(g.moves[i])) return false;
    }
    return !!E.replay(g.moves);
  }
  function loadSession() {
    try {
      var g = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(g)) {
        return { mode: g.mode, lv: g.lv, human: g.human, moves: g.moves.slice(),
                 done: g.done === true, unrated: g.unrated === true };
      }
    } catch (e) {}
    return null;
  }
  function saveSession() {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(game)); } catch (e) {}
  }

  // ---------- 5. Game flow ----------
  var sel = -1;                // selected square (0x88) or -1
  var lastFrom = -1, lastTo = -1;
  var anim = null;             // { from, to } of the move to slide

  function fresh() {
    var g = { mode: prefs.mode, lv: prefs.lv, human: "w", moves: [], done: false, unrated: false };
    if (g.mode === "ai") g.human = prefs.side === "r" ? (rand() < 0.5 ? "w" : "b") : prefs.side;
    return g;
  }

  function inProgress() { return !!(game && !game.done && game.moves.length > 0); }
  function colorOf(p) { return p > 0 ? "w" : "b"; }
  function toMove() { return pos.t > 0 ? "w" : "b"; }
  function aiTurn() { return !!(game && game.mode === "ai" && !game.done && toMove() !== game.human); }

  // Rebuild the position, the SAN list and the legal moves from game.moves.
  function syncPos() {
    var r = E.replay(game.moves);
    pos = r.pos;
    sans = r.sans;
    afterMove();
    var u = game.moves[game.moves.length - 1];
    lastFrom = u ? E.sqFrom(u.slice(0, 2)) : -1;
    lastTo = u ? E.sqFrom(u.slice(2, 4)) : -1;
  }
  function afterMove() {
    st = E.status(pos);
    legal = st.over ? [] : E.legalMoves(pos);
  }

  // A game in progress is never lost silently: Undo toast (R14).
  function newGame(announce) {
    var prev = inProgress() ? JSON.parse(JSON.stringify(game)) : null;
    var prevPrefs = JSON.parse(JSON.stringify(prefs));
    cancelAi();
    closeDialogs();
    game = fresh();
    saveSession();
    sel = -1; anim = null;
    syncPos();
    renderAll(true);
    maybeAi();
    if (prev) {
      undoToast(t("toast.newgame"), function () {
        cancelAi();
        closeDialogs();
        prefs = prevPrefs;
        savePrefs();
        game = prev;
        saveSession();
        sel = -1; anim = null;
        syncPos();
        renderAll(true);
        maybeAi();
      });
    } else if (announce) {
      live(t("toast.newgame"));
    }
  }

  function sideName(c) {
    if (game && game.mode === "ai") return t(c === game.human ? "name.you" : "name.ai");
    return t("name." + c);
  }

  function movesFrom(sq) {
    return legal.filter(function (m) { return E.mFrom(m) === sq; });
  }

  // A tap / click / Enter on a square.
  function onSquare(sq) {
    if (!game || document.querySelector("dialog[open]")) return;
    if (game.done) { showToast(t("toast.over")); return; }            // R28
    if (aiTurn()) { showToast(t("toast.wait")); return; }
    var p = pos.b[sq], mine = !!p && colorOf(p) === toMove();
    if (sel >= 0 && sq === sel) { select(-1); return; }
    if (sel >= 0 && !mine) { tryMove(sel, sq, false); return; }
    if (mine) {
      if (!movesFrom(sq).length) {
        select(-1);
        refuse(sq, E.inCheck(pos) ? t("toast.inCheck") : t("toast.noMoves"));
        return;
      }
      select(sq);
      return;
    }
    if (p) {
      refuse(sq, game.mode === "ai" ? t("toast.aiPiece") : t("toast.notYours", { side: t("sidel." + toMove()) }));
    }
  }

  function select(sq) {
    sel = sq;
    renderBoard();
  }

  function tryMove(from, to, dragged) {
    var cands = legal.filter(function (m) { return E.mFrom(m) === from && E.mTo(m) === to; });
    if (!cands.length) {
      // Why not: a move the piece could make, but that leaves the king in check?
      var pseudo = E.genMoves(pos, false).some(function (m) { return E.mFrom(m) === from && E.mTo(m) === to; });
      select(-1);
      refuse(to, !pseudo ? t("toast.illegal") : (E.inCheck(pos) ? t("toast.inCheck") : t("toast.pinned")));
      return;
    }
    if (cands.length > 1) {                       // promotion: ask
      promoDialog(toMove(), function (pr) {
        var m = cands.filter(function (x) { return E.mPromo(x) === pr; })[0];
        if (m) applyMove(m, true);
      });
      return;
    }
    applyMove(cands[0], dragged);
  }

  function applyMove(m, noSlide) {
    var mover = toMove(), san = E.san(pos, m), cap = (E.mFlags(m) & 1) !== 0;
    E.makeMove(pos, m);
    game.moves.push(E.toUci(m));
    sans.push(san);
    lastFrom = E.mFrom(m); lastTo = E.mTo(m);
    anim = noSlide ? null : { from: lastFrom, to: lastTo };
    sel = -1;
    afterMove();
    live(t("live.move", { who: sideName(mover), san: san }));
    if (st.over) { finish(); return; }
    sfx(E.inCheck(pos) ? "check" : (cap ? "capture" : "move"));
    saveSession();
    renderAll(false);
    maybeAi();
  }

  // ---- computer player: a Blob Web Worker, or a short search here ----
  var worker = null, workerOk = true, aiJob = 0, aiTimer = null, thinking = false, aiDone = null;

  function getWorker() {
    if (worker || !workerOk) return worker;
    try {
      var src = "var E=(" + makeEngine.toString() + ")();" +
        "onmessage=function(e){var d=e.data,r=E.replay(d.moves),m=0;" +
        "if(r){m=E.choose(r.pos,d.lv,Math.random).move;}" +
        "postMessage({id:d.id,uci:m?E.toUci(m):\"\"});};";
      var url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      worker = new Worker(url);
      worker.onmessage = function (e) {
        var d = e.data || {};
        if (aiDone && d.id === aiJob) aiDone(d.uci);
      };
      worker.onerror = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        workerOk = false;
        try { worker.terminate(); } catch (x) {}
        worker = null;
        if (thinking) { thinking = false; maybeAi(); }
      };
    } catch (e) {
      workerOk = false;
      worker = null;
    }
    return worker;
  }

  function cancelAi() {
    aiJob++;
    thinking = false;
    aiDone = null;
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
  }

  function maybeAi() {
    if (!aiTurn() || thinking) return;
    thinking = true;
    var job = ++aiJob, started = Date.now();
    renderStatus();
    aiDone = function (uci) {
      if (job !== aiJob) return;
      aiDone = null;
      var wait = Math.max(0, AI_MIN_DELAY - (Date.now() - started));
      aiTimer = setTimeout(function () {
        aiTimer = null;
        if (job !== aiJob) return;
        thinking = false;
        var m = uci ? E.fromUci(pos, uci) : 0;
        if (m && aiTurn()) applyMove(m, false);
        else renderAll(false);
      }, wait);
    };
    var w = getWorker();
    if (w) {
      w.postMessage({ id: job, moves: game.moves.slice(), lv: game.lv });
    } else {
      // No worker: search here after the "thinking" text paints, with a
      // shorter budget.
      aiTimer = setTimeout(function () {
        aiTimer = null;
        if (job !== aiJob) return;
        var r = E.choose(pos, game.lv, rand, 450);
        if (aiDone) aiDone(r.move ? E.toUci(r.move) : "");
      }, 40);
    }
  }

  // Undo: one move with 2 players; vs the computer, your last move and
  // its answer (the game then counts for no record).
  function canUndo() {
    if (!game || game.done || !game.moves.length) return false;
    if (game.mode === "duo") return true;
    var first = game.human === "w" ? 0 : 1;          // index of your first move
    return game.moves.length > first;
  }
  function undo() {
    if (!canUndo()) { showToast(t("btn.undoNone")); return; }       // R28
    cancelAi();
    closeDialogs();
    game.moves.pop();
    if (game.mode === "ai") {
      while (game.moves.length && (game.moves.length % 2 === 0 ? "w" : "b") !== game.human) game.moves.pop();
      if (!game.unrated) { game.unrated = true; showToast(t("toast.undone")); }
    }
    sel = -1; anim = null;
    syncPos();
    saveSession();
    renderAll(false);
    live(t("btn.undo").replace(/ \(.\)$/, ""));
    maybeAi();
  }

  function winnerOf(s) { return s.result === "1-0" ? "w" : (s.result === "0-1" ? "b" : ""); }

  function finish() {
    game.done = true;
    var w = winnerOf(st);
    if (game.mode === "ai" && !game.unrated) {
      countResult(game.lv, !w ? 1 : (w === game.human ? 0 : 2));
    }
    saveSession();
    renderAll(false);
    sfx(w && !(game.mode === "ai" && w !== game.human) ? "win" : "end");
    live(statusText());
    setTimeout(resultDialog, 800);
  }

  // ---------- 6. Render ----------
  function renderAll(rebuild) {
    renderToolbar();
    renderStatus();
    if (rebuild) buildBoard(); else renderBoard();
    renderMoves();
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
    $("side-select").hidden = mode !== "ai";
    $("side-select").value = prefs.side;
    var u = $("undo-btn"), ok = canUndo();
    u.disabled = !ok;
    u.title = t(ok ? "btn.undo" : "btn.undoNone");
    u.setAttribute("aria-label", u.title);
    $("flip-btn").setAttribute("aria-pressed", prefs.flip ? "true" : "false");
    paintSfxBtn();
  }

  function statusText() {
    if (!game || !st) return "";
    if (st.over) {
      var w = winnerOf(st);
      if (st.reason === "mate") {
        var who = game.mode === "ai" ? t(w === game.human ? "who.you" : "who.ai") : t("who." + w);
        return t("turn.mate", { who: who });
      }
      return t("turn.draw", { why: t("why." + st.reason) });
    }
    var txt;
    if (game.mode === "ai") txt = aiTurn() ? t("turn.ai") : t("turn.you");
    else txt = t("turn.side", { side: t("sidel." + toMove()) });
    if (E.inCheck(pos) && !aiTurn()) txt = t("turn.check") + " " + txt;
    return txt;
  }

  function material() {
    var s = { w: 0, b: 0 };
    for (var sq = 0; sq < 120; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      var p = pos.b[sq];
      if (p) s[colorOf(p)] += PIECE_VAL[Math.abs(p)];
    }
    return s;
  }

  function renderStatus() {
    if (!game || !pos) return;
    $("name-w").textContent = sideName("w");
    $("name-b").textContent = sideName("b");
    var mat = material(), d = mat.w - mat.b;
    $("adv-w").textContent = d > 0 ? "+" + d : "";
    $("adv-b").textContent = d < 0 ? "+" + (-d) : "";
    var tn = $("turn");
    tn.textContent = statusText();
    tn.className = st.over ? "done" : (E.inCheck(pos) ? "warn" : "");
    $("side-w").classList.toggle("turn", !st.over && toMove() === "w");
    $("side-b").classList.toggle("turn", !st.over && toMove() === "b");
    $("unrated").hidden = !(game.mode === "ai" && game.unrated);
  }

  // White at the bottom unless you play black, or the board is flipped.
  function whiteBottom() {
    var base = !(game && game.mode === "ai" && game.human === "b");
    return prefs.flip ? !base : base;
  }
  // The square shown at visual cell i (row-major from the top left).
  function sqAt(i, wb) {
    var row = Math.floor(i / 8), col = i % 8;
    return wb ? (7 - row) * 16 + col : row * 16 + (7 - col);
  }

  var focusIdx = 52;           // e2 for white at the bottom
  function buildBoard() {
    var el = $("board"), wb = whiteBottom();
    el.innerHTML = "";
    el.setAttribute("role", "grid");
    el.setAttribute("aria-label", t("board.label"));
    el.classList.toggle("flipped", !wb);
    for (var r = 0; r < 8; r++) {
      var rowEl = document.createElement("div");
      rowEl.className = "rank";
      rowEl.setAttribute("role", "row");
      for (var c = 0; c < 8; c++) {
        var i = r * 8 + c, sq = sqAt(i, wb);
        var b = document.createElement("button");
        b.type = "button";
        b.className = "sq " + ((((sq >> 4) + (sq & 7)) & 1) ? "l" : "d");
        b.setAttribute("role", "gridcell");
        b.setAttribute("data-sq", String(sq));
        b.setAttribute("data-i", String(i));
        b.tabIndex = i === focusIdx ? 0 : -1;
        if (r === 7) b.setAttribute("data-file", "abcdefgh".charAt(sq & 7));
        if (c === 0) b.setAttribute("data-rank", String((sq >> 4) + 1));
        rowEl.appendChild(b);
      }
      el.appendChild(rowEl);
    }
    renderBoard();
  }

  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function renderBoard() {
    var el = $("board");
    if (!pos || !el.firstChild) return;
    var targets = {}, checkSq = -1;
    if (sel >= 0) movesFrom(sel).forEach(function (m) { targets[E.mTo(m)] = true; });
    if (E.inCheck(pos)) checkSq = pos.t > 0 ? pos.kw : pos.kb;
    el.classList.toggle("over", !!game.done);
    var cells = el.querySelectorAll(".sq"), slid = null;
    for (var k = 0; k < cells.length; k++) {
      var b = cells[k], sq = +b.getAttribute("data-sq"), p = pos.b[sq];
      var cls = "sq " + ((((sq >> 4) + (sq & 7)) & 1) ? "l" : "d");
      if (sq === lastFrom || sq === lastTo) cls += " last";
      if (sq === sel) cls += " sel";
      if (sq === checkSq) cls += " check";
      if (targets[sq]) cls += p || (sq === pos.ep && Math.abs(pos.b[sel]) === 1) ? " cap" : " dot";
      if (b.className !== cls) b.className = cls;
      var pc = b.firstChild;
      if (!p) { if (pc) b.removeChild(pc); }
      else {
        if (!pc) { pc = document.createElement("span"); b.appendChild(pc); }
        var pcls = "pc " + colorOf(p);
        if (pc.className !== pcls) pc.className = pcls;
        var g = GLYPH[Math.abs(p)] + "︎";
        if (pc.textContent !== g) pc.textContent = g;
        pc.setAttribute("aria-hidden", "true");
        pc.style.transform = "";
        if (anim && sq === anim.to) slid = pc;
      }
      var name = E.sqName(sq);
      b.setAttribute("aria-label", p ? t("sq.piece", { sq: name, color: t("color." + colorOf(p)), piece: t("piece." + Math.abs(p)) })
                                      : t("sq.empty", { sq: name }));
      b.setAttribute("aria-selected", sq === sel ? "true" : "false");
    }
    if (slid && !reduced) slide(slid, anim.from, anim.to);
    anim = null;
  }

  // Slide the moved piece from its old square (FLIP).
  function slide(pc, from, to) {
    var wb = whiteBottom();
    var fx = wb ? (from & 7) : 7 - (from & 7), fy = wb ? 7 - (from >> 4) : (from >> 4);
    var tx = wb ? (to & 7) : 7 - (to & 7), ty = wb ? 7 - (to >> 4) : (to >> 4);
    pc.classList.add("moving");
    pc.style.transition = "none";
    pc.style.transform = "translate(" + ((fx - tx) * 100) + "%, " + ((fy - ty) * 100) + "%)";
    void pc.offsetWidth;
    pc.style.transition = "";
    pc.style.transform = "";
    setTimeout(function () { pc.classList.remove("moving"); }, SLIDE_MS + 40);
  }

  // A refused tap: a short shake of the square and a toast (R28).
  function refuse(sq, msg) {
    showToast(msg);
    if (reduced) return;
    var b = document.querySelector('#board .sq[data-sq="' + sq + '"]');
    if (!b) return;
    b.classList.remove("shake");
    void b.offsetWidth;
    b.classList.add("shake");
    setTimeout(function () { b.classList.remove("shake"); }, 320);
  }

  function renderMoves() {
    var ol = $("moves");
    ol.innerHTML = "";
    for (var i = 0; i < sans.length; i += 2) {
      var li = document.createElement("li");
      li.appendChild(el("span", "no", (i / 2 + 1) + "."));
      for (var k = i; k < Math.min(i + 2, sans.length); k++) {
        li.appendChild(el("span", "mv" + (k === sans.length - 1 ? " cur" : ""), sans[k]));
      }
      ol.appendChild(li);
    }
    var wrap = $("moves");
    wrap.scrollTop = wrap.scrollHeight;
    wrap.scrollLeft = wrap.scrollWidth;
  }

  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
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

  // Promotion: queen, rook, bishop or knight.
  function promoDialog(color, onPick) {
    var dlg = makeDialog("chess-promo");
    dlg.appendChild(el("div", "dlg-title", t("promo.title")));
    var grid = el("div", "promo-grid");
    var first = null;
    [5, 4, 3, 2].forEach(function (ty) {
      var b = el("button", "promo-btn");
      b.type = "button";
      var pc = el("span", "pc " + color, GLYPH[ty] + "︎");
      pc.setAttribute("aria-hidden", "true");
      b.appendChild(pc);
      b.appendChild(el("span", "promo-name", t("piece." + ty)));
      b.setAttribute("aria-label", t("piece." + ty));
      b.addEventListener("click", function () { dlg.close(); onPick(ty); });
      grid.appendChild(b);
      if (!first) first = b;
    });
    dlg.appendChild(grid);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("promo.cancel"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    dlg.addEventListener("close", function () { if (game && !game.done) { sel = -1; renderBoard(); } });
    document.body.appendChild(dlg);
    dlg.showModal();
    first.focus();
  }

  function resultDialog() {
    if (!game || !game.done || !st || !st.over) return;   // undone / replaced meanwhile
    closeDialogs();
    var dlg = makeDialog("chess-result");
    var ai = game.mode === "ai", w = winnerOf(st);
    dlg.appendChild(el("div", "dlg-title",
      t("res.title") + (ai ? " · " + t("level." + game.lv) : "")));
    var hero = !w ? t("res.draw")
      : ai ? t(w === game.human ? "res.youwin" : "res.ailose")
      : t("res.pwin", { side: t("sidel." + w) });
    dlg.appendChild(el("div", "dlg-hero", hero));
    dlg.appendChild(el("div", "dlg-msg dlg-center", t("res." + st.reason)));
    if (ai && game.unrated) dlg.appendChild(el("div", "dlg-msg dlg-note", t("res.unrated")));
    dlg.appendChild(row(t("res.moves"), String(Math.ceil(game.moves.length / 2))));
    if (ai) dlg.appendChild(row(t("res.rec") + " · " + t("level." + game.lv), totals(game.lv).join(" · ")));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("res.close"), "", function () { dlg.close(); }));
    var again = button(t("res.again"), "primary", function () { dlg.close(); newGame(false); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    again.focus();
  }

  function statsDialog() {
    var dlg = makeDialog("chess-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    LEVELS.forEach(function (lv) {
      var s = totals(lv);
      if (s[0] + s[1] + s[2]) empty = false;
      dlg.appendChild(row(t("level." + lv), s.join(" · ")));
    });
    dlg.appendChild(el("div", "dlg-foot", t("stats.note")));
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
    var dlg = makeDialog("chess-confirm");
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
    data = mergeChess(data, data);
    save();
    renderStatus();
    showToast(t("toast.reset"));
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "chess", title: String(text) })) return;
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
      if (kind === "move") tone(300, 0, 0.07, "triangle", 0.14);
      else if (kind === "capture") { tone(220, 0, 0.06, "square", 0.08); tone(330, 0.05, 0.08, "triangle", 0.12); }
      else if (kind === "check") { tone(660, 0, 0.09, "triangle", 0.12); tone(880, 0.08, 0.12, "triangle", 0.1); }
      else if (kind === "win") {
        [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
      } else if (kind === "end") { tone(392, 0, 0.18, "sine"); tone(294, 0.16, 0.3, "sine"); }
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Toolbar icons (R9: injected by JS) ----------
  var UI_ICONS = {
    new:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    undo:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    flip:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16M7 4 3 8M7 4l4 4"/><path d="M17 20V4M17 20l-4-4M17 20l4-4"/></svg>',
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
  // Mouse / pen: press on your piece and drag it, or click it and click
  // the target. Touch: tap the piece, then tap the target.
  var drag = null, ghost = null, suppressClickUntil = 0;

  function canPickUp(sq) {
    if (!game || game.done || aiTurn() || document.querySelector("dialog[open]")) return false;
    var p = pos.b[sq];
    return !!p && colorOf(p) === toMove() && movesFrom(sq).length > 0;
  }

  function wirePointer() {
    var board = $("board");
    board.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || e.pointerType === "touch") return;
      var b = e.target.closest && e.target.closest(".sq");
      if (!b) return;
      var sq = +b.getAttribute("data-sq");
      if (!canPickUp(sq)) return;
      e.preventDefault();                 // no text selection / native drag
      try { b.focus({ preventScroll: true }); } catch (x) {}
      drag = { sq: sq, x: e.clientX, y: e.clientY, on: false, id: e.pointerId, wasSel: sel === sq };
    });
    document.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.on) {
        if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < DRAG_PX) return;
        drag.on = true;
        sel = drag.sq;
        renderBoard();
        startGhost(drag.sq);
      }
      moveGhost(e.clientX, e.clientY);
    });
    document.addEventListener("pointerup", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var d = drag;
      drag = null;
      if (!d.on) return;                  // a plain click: the click handler decides
      endGhost();
      suppressClickUntil = Date.now() + 400;
      var hit = document.elementFromPoint(e.clientX, e.clientY);
      var b = hit && hit.closest && hit.closest("#board .sq");
      var to = b ? +b.getAttribute("data-sq") : -1;
      if (to < 0 || to === d.sq) { renderBoard(); return; }   // dropped back: stays selected
      tryMove(d.sq, to, true);
    });
    document.addEventListener("pointercancel", function () {
      if (!drag) return;
      drag = null;
      endGhost();
      renderBoard();
    });
    board.addEventListener("click", function (e) {
      if (e.detail !== 0 && Date.now() < suppressClickUntil) return;   // the click after a drag
      var b = e.target.closest && e.target.closest(".sq");
      if (b) onSquare(+b.getAttribute("data-sq"));
    });
    board.addEventListener("dragstart", function (e) { e.preventDefault(); });
  }

  function startGhost(sq) {
    var b = document.querySelector('#board .sq[data-sq="' + sq + '"]');
    var pc = b && b.querySelector(".pc");
    if (!pc) return;
    var r = b.getBoundingClientRect();
    ghost = el("div", "ghost");
    var g = el("span", pc.className, pc.textContent);
    ghost.appendChild(g);
    ghost.style.width = r.width + "px";
    ghost.style.height = r.height + "px";
    ghost.style.fontSize = getComputedStyle(pc).fontSize;
    document.body.appendChild(ghost);
    pc.classList.add("lifted");
  }
  function moveGhost(x, y) {
    if (!ghost) return;
    ghost.style.transform = "translate(" + (x - ghost.offsetWidth / 2) + "px, " + (y - ghost.offsetHeight / 2) + "px)";
  }
  function endGhost() {
    if (ghost) { ghost.remove(); ghost = null; }
    [].forEach.call(document.querySelectorAll("#board .pc.lifted"), function (p) { p.classList.remove("lifted"); });
  }

  // Keyboard: arrows walk the board, Enter / Space pick and drop, Esc
  // drops the selection; N new game, U undo, F turn the board.
  function focusCell(i) {
    var cells = $("board").querySelectorAll(".sq");
    if (!cells.length) return;
    i = Math.max(0, Math.min(63, i));
    if (cells[focusIdx]) cells[focusIdx].tabIndex = -1;
    focusIdx = i;
    cells[i].tabIndex = 0;
    cells[i].focus();
  }

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;   // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      var onSq = document.activeElement && document.activeElement.classList &&
                 document.activeElement.classList.contains("sq");
      var arrows = { ArrowUp: -8, ArrowDown: 8, ArrowLeft: -1, ArrowRight: 1 };
      if (onSq && arrows[e.key] !== undefined) {
        e.preventDefault();
        var i = +document.activeElement.getAttribute("data-i"), d = arrows[e.key];
        if ((d === -1 && i % 8 === 0) || (d === 1 && i % 8 === 7)) return;
        focusCell(i + d);
        return;
      }
      if (e.repeat) return;
      if (e.key === "Escape" && sel >= 0) { e.preventDefault(); select(-1); return; }
      if (e.code === "KeyN") { e.preventDefault(); newGame(true); return; }
      if (e.code === "KeyU") { e.preventDefault(); undo(); return; }
      if (e.code === "KeyF") { e.preventDefault(); flip(); }
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

  function flip() {
    var hadFocus = document.activeElement && document.activeElement.classList &&
                   document.activeElement.classList.contains("sq");
    prefs.flip = !prefs.flip;
    savePrefs();
    focusIdx = 63 - focusIdx;            // the same square after the turn
    buildBoard();
    renderToolbar();
    if (hadFocus) focusCell(focusIdx);
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
    api.registerSlice("chess", sliceGet, sliceSet, STORAGE_KEY, mergeChess);
  }

  function sliceGet() {
    return mergeChess(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeChess(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    // no toast on merge (sync feedback = taskbar dot)
  }

  // ---------- 12. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    $("side-select").setAttribute("aria-label", t("side.label"));
    $("side-select").title = t("side.label");
    $("moves").setAttribute("aria-label", t("moves.title"));
  }

  function paintStatic() {
    [["new-btn", "new", "btn.new"], ["undo-btn", "undo", "btn.undo"],
     ["flip-btn", "flip", "btn.flip"], ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    paintSfxBtn();
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#mode-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () {
        var m = b.getAttribute("data-mode");
        if (game && m === game.mode && !game.done) return;   // visible active state
        prefs.mode = m; savePrefs(); newGame(true);
      });
    });
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () {
        var lv = b.getAttribute("data-level");
        if (game && lv === game.lv && !game.done) return;
        prefs.lv = lv; savePrefs(); newGame(true);
      });
    });
    $("side-select").addEventListener("change", function () {
      prefs.side = $("side-select").value;
      savePrefs();
      newGame(true);
      $("side-select").blur();
    });
    $("new-btn").addEventListener("click", function () { newGame(true); $("new-btn").blur(); });
    $("undo-btn").addEventListener("click", function () { undo(); });
    $("flip-btn").addEventListener("click", flip);
    $("stats-btn").addEventListener("click", statsDialog);
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("move");   // audible confirmation when turned on
    });
    $("board").addEventListener("focusin", function (e) {
      var c = e.target.closest && e.target.closest(".sq");
      if (!c || c.tabIndex === 0) return;
      var cells = $("board").querySelectorAll(".sq");
      if (cells[focusIdx]) cells[focusIdx].tabIndex = -1;
      focusIdx = +c.getAttribute("data-i");
      c.tabIndex = 0;
    });
    wirePointer();
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
      game = fresh();
      saveSession();
    }
    syncPos();
    if (st.over) game.done = true;
    if (!whiteBottom()) focusIdx = 63 - focusIdx;
    renderAll(true);
    maybeAi();   // a game left on the computer's turn continues
  }

  boot();
})();
