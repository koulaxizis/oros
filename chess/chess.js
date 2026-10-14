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
//   - PGN: open (file, paste, Open with .pgn, deep link { pgn }), save
//     and copy; review an opened game move by move with the Hard
//     search as analysis, and Play from here (vs the computer or 2
//     players; a game from a position is never recorded)
//   - Chess.com (read only, a username, no sign-in): ratings, your games
//     month by month (open one to review), the daily puzzle
// Data:
//   - synced slice "chess" (oros-chess-data): results vs the computer
//     per level [won, drawn, lost] as per-device counter rows (each
//     device only grows its own row; merge = per-row join) + a reset
//     stamp br. 2-player games are not recorded.
//   - device-local (R10): oros-chess-prefs (mode, level, side, flip),
//     oros-chess-session (the game on the board as UCI moves, also a
//     reviewed PGN game),
//     oros-chess-device (row id), oros-chess-sfx (sound on/off)
// Sections:
//   1. Constants, i18n, helpers
//   2. Rules engine + computer player (makeEngine, also the worker)
//   2b. PGN read / write (makePgn, pure)
//   2c. Chess.com answers (makeChessCom, pure)
//   3. Synced data: load / save / normalize / merge (R5, R26)
//   4. Device-local prefs + session
//   5. Game flow (new, select, move, promotion, computer, undo, finish)
//   6. Render (toolbar, status, board, move list)
//   7. Dialogs (promotion, result, records, confirm)
//   7b. PGN: open, save, review, analysis, Play from here, deep link
//   7c. Online accounts: Chess.com
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
      "toast.undone": "Undone: this game will not be recorded",
      "res.fromPos": "Started from a position: this game is not recorded",
      "btn.pgn": "Open or save a game (PGN)",
      "pgn.title": "Games (PGN)",
      "pgn.intro": "Open a game from a PGN file, or paste one, to replay it move by move. Save any game as PGN for Lichess, Chess.com or any chess program.",
      "pgn.paste": "Paste a PGN here",
      "pgn.openText": "Open pasted",
      "pgn.openFile": "Open file…",
      "pgn.save": "Save this game (.pgn)",
      "pgn.copy": "Copy PGN",
      "pgn.close": "Close",
      "pgn.pick": "Choose a game ({n})",
      "pgn.more": "Only the first 500 games of the file are listed.",
      "pgn.none": "No game could be read from this PGN",
      "pgn.big": "This PGN is too big (over 5 MB)",
      "pgn.stop": "Stopped at move {no}: “{tok}” is not a legal move there",
      "pgn.copied": "PGN copied",
      "pgn.copyFail": "Could not copy: select the text and copy it",
      "pgn.empty": "Make a move first: there is nothing to save yet",
      "pgn.vsai": "vs Computer ({level})",
      "pgn.duo": "2 players",
      "toast.opened": "Game opened for review",
      "toast.review": "Reviewing a game: use ◀ ▶, or Play from here",
      "toast.fromHere": "Playing on from this position",
      "rv.start": "Start position",
      "rv.first": "To the start (Home)",
      "rv.prev": "Previous move (←)",
      "rv.next": "Next move (→)",
      "rv.last": "To the end (End)",
      "rv.ana": "Analysis",
      "rv.anaHint": "Show the computer's view of each position (Hard level)",
      "rv.thinking": "Thinking…",
      "rv.eval": "{score} · best {san}",
      "rv.evalOver": "No moves left in this position",
      "rv.play": "Play from here",
      "rv.playTitle": "Play on from this position",
      "rv.playAi": "vs Computer, as {side}",
      "rv.playDuo": "2 players",
      "rv.playNote": "Games from a position are not recorded.",
      "btn.online": "Online accounts",
      "cc.title": "Online accounts",
      "cc.intro": "Enter your Chess.com username to see your ratings and open your games here. Chess.com shares only public data: no password is needed.",
      "cc.user": "Chess.com username",
      "cc.show": "Show",
      "cc.change": "Change",
      "cc.forget": "Forget",
      "cc.games": "My games",
      "cc.puzzle": "Daily puzzle",
      "cc.close": "Close",
      "cc.back": "Back",
      "cc.loading": "Loading…",
      "cc.k.rapid": "Rapid", "cc.k.blitz": "Blitz", "cc.k.bullet": "Bullet", "cc.k.daily": "Daily", "cc.k.puzzles": "Puzzles",
      "cc.best": "best {n}",
      "cc.wld": "{w} W · {l} L · {d} D",
      "cc.noStats": "No rated games yet.",
      "cc.months": "My games on Chess.com",
      "cc.noMonths": "No games on Chess.com yet.",
      "cc.noGames": "No standard chess games this month.",
      "cc.badUser": "A Chess.com username has 3 to 25 letters, digits, _ or -",
      "cc.offline": "You're offline: Chess.com needs the internet",
      "cc.nouser": "Chess.com has no player “{u}”",
      "cc.busy": "Chess.com is busy: try again in a moment",
      "cc.net": "Could not reach Chess.com",
      "cc.puzzleOpened": "Daily puzzle: find the best move for {side}. Step forward (→) to see the answer.",
      "cc.note": "Data from Chess.com's public API. It refreshes a few times a day, so a game that just ended may take a while to appear."
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
      "toast.undone": "Έγινε αναίρεση: η παρτίδα δεν θα καταγραφεί",
      "res.fromPos": "Ξεκίνησε από θέση: η παρτίδα δεν καταγράφεται",
      "btn.pgn": "Άνοιγμα ή αποθήκευση παρτίδας (PGN)",
      "pgn.title": "Παρτίδες (PGN)",
      "pgn.intro": "Άνοιξε μια παρτίδα από αρχείο PGN ή επικόλλησέ τη, για να την ξαναδείς κίνηση προς κίνηση. Αποθήκευσε οποιαδήποτε παρτίδα ως PGN για το Lichess, το Chess.com ή άλλο πρόγραμμα σκακιού.",
      "pgn.paste": "Επικόλλησε εδώ ένα PGN",
      "pgn.openText": "Άνοιγμα επικόλλησης",
      "pgn.openFile": "Άνοιγμα αρχείου…",
      "pgn.save": "Αποθήκευση παρτίδας (.pgn)",
      "pgn.copy": "Αντιγραφή PGN",
      "pgn.close": "Κλείσιμο",
      "pgn.pick": "Διάλεξε παρτίδα ({n})",
      "pgn.more": "Εμφανίζονται μόνο οι πρώτες 500 παρτίδες του αρχείου.",
      "pgn.none": "Δεν βρέθηκε παρτίδα σε αυτό το PGN",
      "pgn.big": "Το PGN είναι πολύ μεγάλο (πάνω από 5 MB)",
      "pgn.stop": "Σταμάτησε στην κίνηση {no}: το «{tok}» δεν είναι νόμιμη κίνηση εκεί",
      "pgn.copied": "Το PGN αντιγράφηκε",
      "pgn.copyFail": "Δεν έγινε αντιγραφή: επίλεξε το κείμενο και αντίγραψέ το",
      "pgn.empty": "Παίξε πρώτα μια κίνηση: δεν υπάρχει ακόμη κάτι για αποθήκευση",
      "pgn.vsai": "Με υπολογιστή ({level})",
      "pgn.duo": "2 παίκτες",
      "toast.opened": "Η παρτίδα άνοιξε για ανασκόπηση",
      "toast.review": "Ανασκόπηση παρτίδας: χρησιμοποίησε ◀ ▶ ή «Παίξε από εδώ»",
      "toast.fromHere": "Συνεχίζεις από αυτή τη θέση",
      "rv.start": "Αρχική θέση",
      "rv.first": "Στην αρχή (Home)",
      "rv.prev": "Προηγούμενη κίνηση (←)",
      "rv.next": "Επόμενη κίνηση (→)",
      "rv.last": "Στο τέλος (End)",
      "rv.ana": "Ανάλυση",
      "rv.anaHint": "Δείξε πώς βλέπει ο υπολογιστής κάθε θέση (επίπεδο Δύσκολο)",
      "rv.thinking": "Σκέφτεται…",
      "rv.eval": "{score} · καλύτερη {san}",
      "rv.evalOver": "Δεν υπάρχουν κινήσεις σε αυτή τη θέση",
      "rv.play": "Παίξε από εδώ",
      "rv.playTitle": "Συνέχεια από αυτή τη θέση",
      "rv.playAi": "Με υπολογιστή, με τα {side}",
      "rv.playDuo": "2 παίκτες",
      "rv.playNote": "Οι παρτίδες από θέση δεν καταγράφονται.",
      "btn.online": "Online λογαριασμοί",
      "cc.title": "Online λογαριασμοί",
      "cc.intro": "Γράψε το όνομα χρήστη σου στο Chess.com για να δεις τις βαθμολογίες σου και να ανοίξεις εδώ τις παρτίδες σου. Το Chess.com δίνει μόνο δημόσια στοιχεία: δεν χρειάζεται κωδικός.",
      "cc.user": "Όνομα χρήστη Chess.com",
      "cc.show": "Εμφάνιση",
      "cc.change": "Αλλαγή",
      "cc.forget": "Ξέχασέ το",
      "cc.games": "Οι παρτίδες μου",
      "cc.puzzle": "Γρίφος της ημέρας",
      "cc.close": "Κλείσιμο",
      "cc.back": "Πίσω",
      "cc.loading": "Φόρτωση…",
      "cc.k.rapid": "Rapid", "cc.k.blitz": "Blitz", "cc.k.bullet": "Bullet", "cc.k.daily": "Ημερήσιες", "cc.k.puzzles": "Γρίφοι",
      "cc.best": "καλύτερη {n}",
      "cc.wld": "{w} Ν · {l} Η · {d} Ι",
      "cc.noStats": "Δεν υπάρχουν ακόμη βαθμολογημένες παρτίδες.",
      "cc.months": "Οι παρτίδες μου στο Chess.com",
      "cc.noMonths": "Δεν υπάρχουν ακόμη παρτίδες στο Chess.com.",
      "cc.noGames": "Καμία παρτίδα κλασικού σκακιού αυτόν τον μήνα.",
      "cc.badUser": "Το όνομα χρήστη στο Chess.com έχει 3 έως 25 γράμματα, ψηφία, _ ή -",
      "cc.offline": "Είσαι εκτός σύνδεσης: το Chess.com θέλει internet",
      "cc.nouser": "Το Chess.com δεν έχει παίκτη «{u}»",
      "cc.busy": "Το Chess.com είναι απασχολημένο: δοκίμασε ξανά σε λίγο",
      "cc.net": "Δεν ήταν δυνατή η σύνδεση με το Chess.com",
      "cc.puzzleOpened": "Γρίφος της ημέρας: βρες την καλύτερη κίνηση για τα {side}. Προχώρα (→) για να δεις τη λύση.",
      "cc.note": "Στοιχεία από το δημόσιο API του Chess.com. Ανανεώνονται λίγες φορές τη μέρα, οπότε μια παρτίδα που μόλις τελείωσε μπορεί να αργήσει να φανεί."
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

  // ---------- 2b. PGN (pure: read and write games) ----------
  // parse(text) → { games: [ { tags, fen, moves[uci], sans[], result,
  //   stop?: { ply, tok } } ], more: bool } — every game of the text
  //   (up to MAX_GAMES), comments, variations and NAGs skipped. A game
  //   stops at its first move that is not legal (stop says where); a
  //   game of another variant (Chess960, …) or with a bad FEN is left
  //   out. Tag values are cleaned text (no control characters, ≤ 120);
  //   only TAGS are kept. Nothing here touches the page.
  // write({ tags, fen, moves, result }) → PGN text (export format:
  //   seven-tag roster first, SetUp / FEN when it starts from a
  //   position, lines ≤ 80).
  function makePgn(E) {
    var MAX_TEXT = 5 * 1024 * 1024, MAX_GAMES = 500, MAX_PLY = 1200, MAX_VAL = 120;
    var TAGS = ["Event", "Site", "Date", "Round", "White", "Black", "Result",
                "WhiteElo", "BlackElo", "TimeControl", "Termination", "ECO", "Opening"];
    var ROSTER = ["Event", "Site", "Date", "Round", "White", "Black", "Result"];
    var RESULTS = ["1-0", "0-1", "1/2-1/2", "*"];
    var TAG_RE = /\[\s*([A-Za-z0-9_]{1,40})\s+"((?:[^"\\\r\n]|\\.){0,2000})"\s*\]/y;
    var SAN_RE = /^([NBRQK])?([a-h])?([1-8])?[x:]?([a-h][1-8])(?:=?([NBRQnbrq]))?(?:e\.?p\.?)?$/;

    function clean(v) {
      return String(v === undefined || v === null ? "" : v)
        .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
        .replace(/\s+/g, " ").trim().slice(0, MAX_VAL);
    }

    // One SAN token (as people and sites write it) → the legal move, or 0.
    function matchSan(P, tok) {
      var s = String(tok || "").replace(/[+#!?]+$/, "").replace(/^0-0-0$/, "O-O-O").replace(/^0-0$/, "O-O");
      var legal = E.legalMoves(P), i, m;
      if (s === "O-O" || s === "O-O-O") {
        for (i = 0; i < legal.length; i++) {
          m = legal[i];
          if ((E.mFlags(m) & 4) && (E.mTo(m) & 7) === (s === "O-O" ? 6 : 2)) return m;
        }
        return 0;
      }
      var x = SAN_RE.exec(s);
      if (!x) return 0;
      var ty = x[1] ? "PNBRQK".indexOf(x[1]) + 1 : 1;
      var to = E.sqFrom(x[4]);
      var file = x[2] ? "abcdefgh".indexOf(x[2]) : -1, rank = x[3] ? +x[3] - 1 : -1;
      var pr = x[5] ? "NBRQ".indexOf(x[5].toUpperCase()) + 2 : 0;
      var hits = [];
      for (i = 0; i < legal.length; i++) {
        m = legal[i];
        var f = E.mFrom(m);
        if (E.mTo(m) !== to || Math.abs(P.b[f]) !== ty) continue;
        if (file >= 0 && (f & 7) !== file) continue;
        if (rank >= 0 && (f >> 4) !== rank) continue;
        // A pawn reaching the last rank with no piece named becomes a queen.
        var mp = E.mPromo(m);
        if (pr ? mp !== pr : (mp && mp !== 5)) continue;
        hits.push(m);
      }
      return hits.length === 1 ? hits[0] : 0;
    }

    // The text → raw games { tags, toks[], result }.
    function split(text) {
      var out = [], cur = null, depth = 0, i = 0, n = text.length, more = false;
      function close() {
        if (cur && (cur.toks.length || Object.keys(cur.tags).length)) {
          if (out.length < MAX_GAMES) out.push(cur); else more = true;
        }
        cur = null;
      }
      function game() { if (!cur) cur = { tags: {}, toks: [], result: "", started: false }; return cur; }
      while (i < n && !more) {
        var c = text.charAt(i);
        if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
        if (c === "{") { var e = text.indexOf("}", i); i = e < 0 ? n : e + 1; continue; }
        if (c === ";" || (c === "%" && (i === 0 || text.charAt(i - 1) === "\n"))) {
          var nl = text.indexOf("\n", i); i = nl < 0 ? n : nl + 1; continue;
        }
        if (c === "(") { depth++; i++; continue; }
        if (c === ")") { if (depth) depth--; i++; continue; }
        if (c === "[" && !depth) {
          TAG_RE.lastIndex = i;
          var tm = TAG_RE.exec(text);
          if (tm) {
            if (cur && cur.started) close();
            var g = game();
            if (TAGS.indexOf(tm[1]) >= 0 || tm[1] === "FEN" || tm[1] === "SetUp" || tm[1] === "Variant") {
              g.tags[tm[1]] = tm[2].replace(/\\(.)/g, "$1");
            }
            i = TAG_RE.lastIndex;
            continue;
          }
          var nl2 = text.indexOf("\n", i); i = nl2 < 0 ? n : nl2 + 1; continue;
        }
        var j = i;
        while (j < n && !/[\s{}()\[\];]/.test(text.charAt(j))) j++;
        if (j === i) { i++; continue; }        // a stray ] or }
        var w = text.slice(i, j);
        i = j;
        if (depth) continue;
        w = w.replace(/^\d+\.+/, "");
        if (!w || /^\$\d+$/.test(w) || /^[!?]+$/.test(w)) continue;
        if (RESULTS.indexOf(w) >= 0) { game().result = w; close(); continue; }
        var cg = game();
        cg.started = true;
        if (cg.toks.length < MAX_PLY + 1) cg.toks.push(w);
      }
      close();
      return { raw: out, more: more };
    }

    function parse(text) {
      text = String(text || "");
      if (text.length > MAX_TEXT) return { games: [], more: false, big: true };
      text = text.replace(/^﻿/, "");
      var sp = split(text), games = [];
      sp.raw.forEach(function (r) {
        var variant = r.tags.Variant;
        if (variant && !/^(standard|chess|from position)$/i.test(variant.trim())) return;
        var fen = "";
        if (r.tags.FEN && r.tags.SetUp !== "0") {
          fen = clean(r.tags.FEN);
          var P0 = E.parseFen(fen);
          if (!P0) return;
          fen = E.toFen(P0);
          if (fen === E.START) fen = "";
        }
        var P = E.parseFen(fen || E.START), moves = [], sans = [], stop = null;
        for (var k = 0; k < r.toks.length; k++) {
          var m = moves.length < MAX_PLY ? matchSan(P, r.toks[k]) : 0;
          if (!m) { stop = { ply: k, tok: clean(r.toks[k]).slice(0, 20) }; break; }
          sans.push(E.san(P, m));
          E.makeMove(P, m);
          moves.push(E.toUci(m));
        }
        var tags = {};
        TAGS.forEach(function (k2) { if (r.tags[k2] !== undefined && clean(r.tags[k2])) tags[k2] = clean(r.tags[k2]); });
        var result = RESULTS.indexOf(tags.Result) >= 0 ? tags.Result : (r.result || "*");
        var g = { tags: tags, fen: fen, moves: moves, sans: sans, result: result };
        if (stop) g.stop = stop;
        if (moves.length || fen) games.push(g);
      });
      return { games: games, more: sp.more };
    }

    function esc(v) { return clean(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }

    function write(g) {
      g = g || {};
      var tags = g.tags || {}, lines = [];
      var result = RESULTS.indexOf(g.result) >= 0 ? g.result : "*";
      ROSTER.forEach(function (k) {
        var v = k === "Result" ? result : (clean(tags[k]) || "?");
        lines.push("[" + k + ' "' + esc(v) + '"]');
      });
      TAGS.forEach(function (k) {
        if (ROSTER.indexOf(k) < 0 && clean(tags[k])) lines.push("[" + k + ' "' + esc(tags[k]) + '"]');
      });
      var P = E.parseFen(g.fen || E.START) || E.parseFen(E.START);
      if (g.fen && E.toFen(P) !== E.START) {
        lines.push('[SetUp "1"]');
        lines.push('[FEN "' + E.toFen(P) + '"]');
      }
      var words = [], moves = g.moves || [];
      for (var i = 0; i < moves.length; i++) {
        var m = E.fromUci(P, moves[i]);
        if (!m) break;
        if (P.t > 0) words.push(P.n + ".");
        else if (i === 0) words.push(P.n + "...");
        words.push(E.san(P, m));
        E.makeMove(P, m);
      }
      words.push(result);
      var body = [], line = "";
      words.forEach(function (w) {
        if (line && line.length + 1 + w.length > 79) { body.push(line); line = w; }
        else line = line ? line + " " + w : w;
      });
      if (line) body.push(line);
      return lines.join("\n") + "\n\n" + body.join("\n") + "\n";
    }

    return { parse: parse, write: write, matchSan: matchSan, clean: clean, TAGS: TAGS, MAX_TEXT: MAX_TEXT };
  }

  // ---------- 2c. Chess.com published data (pure: read the answers) ----------
  // Chess.com's Published-Data API is public and read only: a username
  // is all it needs (no sign-in, no key). These functions only check
  // and shape its JSON; the requests are in section 7c. Every string
  // goes through clean(); URLs are never taken from an answer (months
  // are rebuilt from YYYY/MM), so nothing here can point orOS elsewhere.
  function makeChessCom(clean) {
    var API = "https://api.chess.com/pub/";
    var USER_RE = /^[A-Za-z0-9_-]{3,25}$/;
    var KINDS = ["rapid", "blitz", "bullet", "daily"];
    function okUser(u) { return typeof u === "string" && USER_RE.test(u.trim()) ? u.trim() : ""; }
    function num(v) { return typeof v === "number" && isFinite(v) ? Math.round(v) : null; }
    function playerUrl(u, rest) { return API + "player/" + encodeURIComponent(okUser(u).toLowerCase()) + (rest || ""); }
    function monthUrl(u, ym) {
      var m = /^(\d{4})\/(\d{2})$/.exec(String(ym || ""));
      return m ? playerUrl(u, "/games/" + m[1] + "/" + m[2]) : "";
    }
    // { name, title } from /player/{u}
    function profile(j) {
      if (!j || typeof j !== "object") return null;
      return { user: clean(j.username), name: clean(j.name), title: clean(j.title) };
    }
    // [ { kind, last, best, w, l, d } ] from /player/{u}/stats, plus tactics
    function stats(j) {
      var out = [];
      if (!j || typeof j !== "object") return out;
      KINDS.forEach(function (k) {
        var x = j["chess_" + k];
        if (!x || typeof x !== "object") return;
        var last = num(x.last && x.last.rating);
        if (last === null) return;
        var r = x.record || {};
        out.push({ kind: k, last: last, best: num(x.best && x.best.rating),
                   w: num(r.win) || 0, l: num(r.loss) || 0, d: num(r.draw) || 0 });
      });
      var tac = j.tactics && num(j.tactics.highest && j.tactics.highest.rating);
      if (tac !== null && tac !== undefined) out.push({ kind: "puzzles", last: null, best: tac, w: 0, l: 0, d: 0 });
      return out;
    }
    // ["YYYY/MM", …] newest first, from /player/{u}/games/archives
    function months(j) {
      var out = [], seen = {};
      var list = j && Array.isArray(j.archives) ? j.archives : [];
      list.forEach(function (u) {
        var m = /\/games\/(\d{4})\/(\d{2})$/.exec(String(u || ""));
        if (!m || +m[2] < 1 || +m[2] > 12) return;
        var ym = m[1] + "/" + m[2];
        if (!seen[ym]) { seen[ym] = true; out.push(ym); }
      });
      out.sort().reverse();
      return out.slice(0, 240);
    }
    // Standard games of one month, newest first:
    // [ { white, black, wr, br, result, kind, end, pgn } ]
    function games(j) {
      var out = [];
      var list = j && Array.isArray(j.games) ? j.games : [];
      list.forEach(function (g) {
        if (!g || typeof g !== "object" || g.rules !== "chess" || typeof g.pgn !== "string" || g.pgn.length > 200000) return;
        var w = g.white || {}, b = g.black || {};
        var res = /\[Result "(1-0|0-1|1\/2-1\/2|\*)"\]/.exec(g.pgn);
        out.push({ white: clean(w.username) || "?", black: clean(b.username) || "?",
                   wr: num(w.rating), br: num(b.rating), result: res ? res[1] : "*",
                   kind: KINDS.indexOf(g.time_class) >= 0 ? g.time_class : "",
                   end: num(g.end_time) || 0, pgn: g.pgn });
      });
      out.sort(function (x, y) { return y.end - x.end; });
      return out.slice(0, 1000);
    }
    // The daily puzzle: { title, pgn } (its PGN carries the FEN)
    function puzzle(j) {
      if (!j || typeof j !== "object" || typeof j.pgn !== "string" || j.pgn.length > 20000) return null;
      return { title: clean(j.title), pgn: j.pgn };
    }
    return { API: API, KINDS: KINDS, okUser: okUser, playerUrl: playerUrl, monthUrl: monthUrl,
             profile: profile, stats: stats, months: months, games: games, puzzle: puzzle };
  }

  var E = makeEngine();
  var PGN = makePgn(E);
  var CC = makeChessCom(PGN.clean);
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
  var prefs = { mode: "ai", lv: "m", side: "w", flip: false, ana: false, cc: "" };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (MODES.indexOf(p.mode) >= 0) prefs.mode = p.mode;
        if (LEVELS.indexOf(p.lv) >= 0) prefs.lv = p.lv;
        if (SIDES.indexOf(p.side) >= 0) prefs.side = p.side;
        prefs.flip = p.flip === true;
        prefs.ana = p.ana === true;
        prefs.cc = CC.okUser(p.cc);
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = {
  //   mode, lv,            // mode ai | duo | review
  //   human: "w" | "b",    // your side vs the computer ("w" with 2 players)
  //   moves: [uci…],       // from the start position (or fen)
  //   done: bool,
  //   unrated: bool,       // an undo was used vs the computer, or it
  //                        // started from a position (base / fen)
  //   fen?: "<FEN>",       // a game that starts from a position
  //   base?: n,            // "Play from here": the first n moves came
  //                        // from a reviewed game (never undone)
  //   tags?: {…}, result?, at: n   // review only: the PGN tags, its
  //                        // result and the move shown (0…moves.length)
  // }
  // The position is always replayed from moves.
  var game = null;
  var pos = null, sans = [], legal = [], st = null;

  function validSession(g) {
    if (!g || typeof g !== "object" || (MODES.indexOf(g.mode) < 0 && g.mode !== "review") ||
        LEVELS.indexOf(g.lv) < 0 || (g.human !== "w" && g.human !== "b") ||
        !Array.isArray(g.moves) || g.moves.length > MAX_PLIES) return false;
    for (var i = 0; i < g.moves.length; i++) {
      if (typeof g.moves[i] !== "string" || !/^[a-h][1-8][a-h][1-8][nbrq]?$/.test(g.moves[i])) return false;
    }
    if (g.fen !== undefined && (typeof g.fen !== "string" || g.fen.length > 100 || !E.parseFen(g.fen))) return false;
    if (g.base !== undefined && (!isInt(g.base) || g.base < 0 || g.base > g.moves.length)) return false;
    return !!E.replay(g.moves, g.fen);
  }
  function cleanTags(x) {
    var out = {};
    if (!x || typeof x !== "object") return out;
    PGN.TAGS.forEach(function (k) {
      if (typeof x[k] === "string" && PGN.clean(x[k])) out[k] = PGN.clean(x[k]);
    });
    return out;
  }
  function loadSession() {
    try {
      var g = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(g)) {
        var out = { mode: g.mode, lv: g.lv, human: g.human, moves: g.moves.slice(),
                    done: g.done === true, unrated: g.unrated === true };
        if (g.fen) out.fen = E.toFen(E.parseFen(g.fen));
        if (g.base) out.base = g.base;
        if (g.mode === "review") {
          out.done = true;
          out.tags = cleanTags(g.tags);
          out.result = ["1-0", "0-1", "1/2-1/2"].indexOf(g.result) >= 0 ? g.result : "*";
          out.at = isInt(g.at) && g.at >= 0 && g.at <= g.moves.length ? g.at : g.moves.length;
        }
        return out;
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
  var revSans = { key: "", sans: [] };       // the reviewed game's SAN, once
  function syncPos() {
    var shown = game.mode === "review" ? game.moves.slice(0, game.at) : game.moves;
    var r = E.replay(shown, game.fen);
    pos = r.pos;
    sans = r.sans;
    if (game.mode === "review") {
      var key = (game.fen || "") + "|" + game.moves.join(" ");
      if (revSans.key !== key) revSans = { key: key, sans: E.replay(game.moves, game.fen).sans };
    }
    afterMove();
    var u = shown[shown.length - 1];
    lastFrom = u ? E.sqFrom(u.slice(0, 2)) : -1;
    lastTo = u ? E.sqFrom(u.slice(2, 4)) : -1;
  }
  function afterMove() {
    st = E.status(pos);
    legal = st.over ? [] : E.legalMoves(pos);
  }

  // A game in progress is never lost silently: Undo toast (R14).
  function newGame(announce) { replaceGame(fresh(), t("toast.newgame"), announce); }

  // Any other game in its place (a new one, a PGN to review, "Play
  // from here"); the one left behind comes back with Undo.
  function replaceGame(next, msg, announce) {
    var keep = inProgress() || (game && game.mode === "review");
    var prev = keep ? JSON.parse(JSON.stringify(game)) : null;
    var prevPrefs = JSON.parse(JSON.stringify(prefs));
    cancelAi();
    closeDialogs();
    game = next;
    saveSession();
    sel = -1; anim = null;
    syncPos();
    renderAll(true);
    maybeAi();
    if (prev) {
      undoToast(msg, function () {
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
      live(msg);
    }
  }

  function sideName(c) {
    if (game && game.mode === "review") {
      var tg = game.tags || {}, nm = tg[c === "w" ? "White" : "Black"], elo = tg[c === "w" ? "WhiteElo" : "BlackElo"];
      if (!nm || nm === "?") return t("name." + c);
      return nm + (elo && /^\d{3,4}$/.test(elo) ? " (" + elo + ")" : "");
    }
    if (game && game.mode === "ai") return t(c === game.human ? "name.you" : "name.ai");
    return t("name." + c);
  }

  function movesFrom(sq) {
    return legal.filter(function (m) { return E.mFrom(m) === sq; });
  }

  // A tap / click / Enter on a square.
  function onSquare(sq) {
    if (!game || document.querySelector("dialog[open]")) return;
    if (game.mode === "review") { showToast(t("toast.review")); return; }
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
        "onmessage=function(e){var d=e.data,r=E.replay(d.moves,d.fen||\"\"),c=null;" +
        "if(r){c=E.choose(r.pos,d.lv,Math.random);}" +
        "postMessage({id:d.id,uci:c&&c.move?E.toUci(c.move):\"\",score:c?c.score:0,depth:c?c.depth:0});};";
      var url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      worker = new Worker(url);
      worker.onmessage = function (e) {
        var d = e.data || {};
        if (aiDone && d.id === aiJob) aiDone(d.uci, d);
      };
      worker.onerror = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        workerOk = false;
        try { worker.terminate(); } catch (x) {}
        worker = null;
        if (thinking) { thinking = false; maybeAi(); }
        else if (aiDone && game && game.mode === "review") runAnalysis();
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
      w.postMessage({ id: job, moves: game.moves.slice(), fen: game.fen || "", lv: game.lv });
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
    var base = game ? game.base || 0 : 0;
    if (!game || game.done || game.mode === "review" || game.moves.length <= base) return false;
    if (game.mode === "duo") return true;
    var first = base + (sideAt(base) === game.human ? 0 : 1);   // index of your first move
    return game.moves.length > first;
  }
  function undo() {
    if (!canUndo()) { showToast(t("btn.undoNone")); return; }       // R28
    cancelAi();
    closeDialogs();
    game.moves.pop();
    if (game.mode === "ai") {
      while (game.moves.length > (game.base || 0) && sideAt(game.moves.length) !== game.human) game.moves.pop();
      if (!game.unrated) { game.unrated = true; showToast(t("toast.undone")); }
    }
    sel = -1; anim = null;
    syncPos();
    saveSession();
    renderAll(false);
    live(t("btn.undo").replace(/ \(.\)$/, ""));
    maybeAi();
  }

  // The side to move after n plies of this game.
  function sideAt(n) {
    var first = game.fen && game.fen.split(" ")[1] === "b" ? 1 : 0;
    return (n + first) % 2 === 0 ? "w" : "b";
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
    renderReviewBar();
  }

  // "12. Nf3" / "12… Nf6": the move that led to the position after n plies.
  function moveLabel(n) {
    var first = sideAt(0) === "b" ? 1 : 0, startNo = fenMoveNo();
    var v = n - 1 + first;
    return (startNo + Math.floor(v / 2)) + (v % 2 ? "… " : ". ") + (revSans.sans[n - 1] || "");
  }
  function fenMoveNo() {
    var n = game && game.fen ? +game.fen.split(" ")[5] : 1;
    return isInt(n) && n > 0 ? n : 1;
  }

  function statusText() {
    if (!game || !st) return "";
    if (game.mode === "review") {
      var txt = game.at ? moveLabel(game.at) : t("rv.start");
      if (game.at === game.moves.length && game.result && game.result !== "*") txt += " · " + game.result;
      else if (st.over && st.reason === "mate") txt += " · " + t("res.mate");
      return txt;
    }
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
    var rv = game.mode === "review";
    tn.className = rv ? "" : (st.over ? "done" : (E.inCheck(pos) ? "warn" : ""));
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

  // One line per move number; a game from a position with black to
  // move opens with "n… ". In review every move is a button to it.
  function renderMoves() {
    var ol = $("moves"), rv = game.mode === "review";
    var list = rv ? revSans.sans : sans, cur = rv ? game.at - 1 : list.length - 1;
    var first = sideAt(0) === "b" ? 1 : 0, startNo = fenMoveNo(), li = null, curEl = null;
    ol.innerHTML = "";
    ol.classList.toggle("review", rv);
    for (var k = 0; k < list.length; k++) {
      var v = k + first;
      if (!li || v % 2 === 0) {
        li = document.createElement("li");
        li.appendChild(el("span", "no", (startNo + Math.floor(v / 2)) + "."));
        if (v % 2) li.appendChild(el("span", "mv gap", "…"));
        ol.appendChild(li);
      }
      var mv = el(rv ? "button" : "span", "mv" + (k === cur ? " cur" : ""), list[k]);
      if (rv) {
        mv.type = "button";
        mv.setAttribute("data-ply", String(k + 1));
        mv.setAttribute("aria-current", k === cur ? "true" : "false");
      }
      if (k === cur) curEl = mv;
      li.appendChild(mv);
    }
    if (rv) {
      if (curEl && curEl.scrollIntoView) { try { curEl.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {} }
      else { ol.scrollTop = 0; ol.scrollLeft = 0; }
      return;
    }
    ol.scrollTop = ol.scrollHeight;
    ol.scrollLeft = ol.scrollWidth;
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
    if (ai && game.unrated) dlg.appendChild(el("div", "dlg-msg dlg-note", t(game.base || game.fen ? "res.fromPos" : "res.unrated")));
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

  // ---------- 7b. PGN: open, save, review ----------
  var ENGINE_MATE = 30000;                  // makeEngine's MATE

  function dialogHost() {
    try {
      var d = window.parent && window.parent !== window ? window.parent.orosDialog : null;
      if (d && typeof d.saveFile === "function" && typeof d.openFile === "function") return d;
    } catch (e) {}
    return null;
  }
  // Standalone (no shell): a plain file input.
  function localOpen(accept) {
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file";
      inp.accept = accept;
      inp.addEventListener("change", function () { resolve(inp.files && inp.files[0] ? inp.files[0] : null); });
      inp.click();
    });
  }

  // The game on the board as PGN data.
  function gameForPgn() {
    if (game.mode === "review") {
      return { tags: game.tags || {}, fen: game.fen || "", moves: game.moves, result: game.result || "*" };
    }
    var d = new Date(), pad = function (n) { return (n < 10 ? "0" : "") + n; };
    var res = st && st.over ? (st.result === "1/2" ? "1/2-1/2" : st.result) : "*";
    return {
      tags: {
        Event: "orOS Chess · " + (game.mode === "ai" ? t("pgn.vsai", { level: t("level." + game.lv) }) : t("pgn.duo")),
        Site: "useoros.online",
        Date: d.getFullYear() + "." + pad(d.getMonth() + 1) + "." + pad(d.getDate()),
        White: sideName("w"), Black: sideName("b"), Result: res
      },
      fen: game.fen || "", moves: game.moves, result: res
    };
  }

  function pgnFileName() {
    var g = gameForPgn(), tg = g.tags;
    var base = (tg.White || "white") + " - " + (tg.Black || "black") + (tg.Date ? " " + tg.Date : "");
    base = base.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "chess";
    return base + ".pgn";
  }

  function savePgn() {
    if (!game.moves.length && !game.fen) { showToast(t("pgn.empty")); return; }
    var text = PGN.write(gameForPgn()), host = dialogHost();
    if (host) {
      host.saveFile({ text: text, filename: pgnFileName(), mime: "application/x-chess-pgn",
                      types: [{ description: "PGN", accept: { "application/x-chess-pgn": [".pgn"] } }] })
        .catch(function () {});
      return;
    }
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/x-chess-pgn" }));
    a.download = pgnFileName();
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function copyPgn(area) {
    if (!game.moves.length && !game.fen) { showToast(t("pgn.empty")); return; }
    var text = PGN.write(gameForPgn());
    function fallback() {
      if (area) { area.value = text; area.focus(); area.select(); }
      showToast(t("pgn.copyFail"));
    }
    try {
      navigator.clipboard.writeText(text).then(function () { showToast(t("pgn.copied")); }, fallback);
    } catch (e) { fallback(); }
  }

  function pgnDialog() {
    var dlg = makeDialog("chess-pgn");
    dlg.classList.add("wide");
    dlg.appendChild(el("div", "dlg-title", t("pgn.title")));
    dlg.appendChild(el("div", "dlg-foot pgn-intro", t("pgn.intro")));
    var area = el("textarea", "pgn-area");
    area.placeholder = t("pgn.paste");
    area.setAttribute("aria-label", t("pgn.paste"));
    area.spellcheck = false;
    area.rows = 5;
    dlg.appendChild(area);
    var open = el("div", "dlg-actions");
    open.appendChild(button(t("pgn.openFile"), "", function () {
      var host = dialogHost();
      var pick = host ? host.openFile(".pgn,application/x-chess-pgn,text/plain") : localOpen(".pgn,text/plain");
      pick.then(function (f) { if (f) { dlg.close(); openPgnFile(f); } }).catch(function () {});
    }));
    var go = button(t("pgn.openText"), "primary", function () {
      if (!area.value.trim()) { area.focus(); return; }
      var txt = area.value;
      dlg.close();
      openPgnText(txt);
    });
    open.appendChild(go);
    dlg.appendChild(open);
    var none = !game.moves.length && !game.fen;
    var out = el("div", "dlg-actions");
    var sv = button(t("pgn.save"), "", function () { savePgn(); });
    var cp = button(t("pgn.copy"), "", function () { copyPgn(area); });
    sv.disabled = cp.disabled = none;
    out.appendChild(sv);
    out.appendChild(cp);
    dlg.appendChild(out);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("pgn.close"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    area.focus();
  }

  function openPgnFile(f) {
    if (!f) return;
    if (f.size > PGN.MAX_TEXT) { showToast(t("pgn.big")); return; }
    f.text().then(openPgnText, function () { showToast(t("pgn.none")); });
  }

  function openPgnText(text) {
    var r = PGN.parse(text);
    if (r.big) { showToast(t("pgn.big")); return; }
    if (!r.games.length) { showToast(t("pgn.none")); return; }
    if (r.games.length === 1) { startReview(r.games[0]); return; }
    pickDialog(r.games, r.more);
  }

  function pickDialog(games, more) {
    var dlg = makeDialog("chess-pick");
    dlg.classList.add("wide");
    dlg.appendChild(el("div", "dlg-title", t("pgn.pick", { n: games.length })));
    var list = el("div", "pick-list");
    games.forEach(function (g) {
      var tg = g.tags, b = el("button", "pick-btn");
      b.type = "button";
      b.appendChild(el("span", "pick-names", (tg.White || "?") + " – " + (tg.Black || "?")));
      var meta = [g.result, tg.Date && tg.Date.indexOf("?") < 0 ? tg.Date : "", tg.Event && tg.Event !== "?" ? tg.Event : "",
                  Math.ceil(g.moves.length / 2) + " " + t("res.moves").toLowerCase()].filter(Boolean).join(" · ");
      b.appendChild(el("span", "pick-meta", meta));
      b.addEventListener("click", function () { dlg.close(); startReview(g); });
      list.appendChild(b);
    });
    dlg.appendChild(list);
    if (more) dlg.appendChild(el("div", "dlg-foot", t("pgn.more")));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("pgn.close"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    var first = list.querySelector("button");
    if (first) first.focus();
  }

  function startReview(g, atStart) {
    var next = { mode: "review", lv: prefs.lv, human: "w", moves: g.moves.slice(), done: true, unrated: false,
                 tags: cleanTags(g.tags), result: g.result, at: atStart ? 0 : g.moves.length };
    if (g.fen) next.fen = g.fen;
    replaceGame(next, t("toast.opened"), true);
    runAnalysis();
    if (g.stop) {
      var first = sideAt(0) === "b" ? 1 : 0, v = g.stop.ply + first;
      showToast(t("pgn.stop", { no: fenMoveNo() + Math.floor(v / 2), tok: g.stop.tok }));
    }
  }

  function goTo(n) {
    if (!game || game.mode !== "review" || document.querySelector("dialog[open]")) return;
    n = Math.max(0, Math.min(game.moves.length, n));
    if (n === game.at) return;
    var step = n === game.at + 1;
    game.at = n;
    sel = -1;
    syncPos();
    if (step && !reduced) anim = { from: lastFrom, to: lastTo };
    saveSession();
    renderAll(false);
    live(statusText());
    runAnalysis();
  }

  function renderReviewBar() {
    var bar = $("review-bar"), rv = !!(game && game.mode === "review");
    bar.hidden = !rv;
    if (!rv) return;
    $("rv-first").disabled = $("rv-prev").disabled = game.at === 0;
    $("rv-next").disabled = $("rv-last").disabled = game.at === game.moves.length;
    var tg = game.tags || {};
    var info = [tg.Event && tg.Event !== "?" ? tg.Event : "", tg.Date && tg.Date.indexOf("?") < 0 ? tg.Date : "",
                tg.Opening || tg.ECO || "", tg.TimeControl && tg.TimeControl !== "-" ? tg.TimeControl : ""].filter(Boolean).join(" · ");
    $("rv-info").textContent = info;
    $("rv-info").hidden = !info;
    var a = $("rv-ana");
    a.setAttribute("aria-pressed", prefs.ana ? "true" : "false");
    a.title = t("rv.anaHint");
    $("rv-eval").hidden = !prefs.ana;
    $("rv-play").disabled = !!(st && st.over);
  }

  // Analysis: the Hard search on the shown position, in the worker.
  function evalText(score, side) {
    var s = side === "w" ? score : -score;
    if (Math.abs(s) > ENGINE_MATE - 1000) {
      var mateIn = Math.ceil((ENGINE_MATE - Math.abs(s)) / 2);
      return (s > 0 ? "#" : "#-") + mateIn;
    }
    return (s > 0 ? "+" : (s < 0 ? "−" : "")) + (Math.abs(s) / 100).toFixed(2);
  }
  function runAnalysis() {
    var box = $("rv-eval");
    if (!game || game.mode !== "review" || !prefs.ana) { if (game && game.mode === "review") cancelAi(); return; }
    cancelAi();
    if (st.over) { box.textContent = t("rv.evalOver"); return; }
    box.textContent = t("rv.thinking");
    var job = ++aiJob, side = toMove(), shown = game.moves.slice(0, game.at);
    aiDone = function (uci, d) {
      if (job !== aiJob) return;
      aiDone = null;
      var m = uci ? E.fromUci(pos, uci) : 0;
      box.textContent = m ? t("rv.eval", { score: evalText((d && d.score) || 0, side), san: E.san(pos, m) }) : "";
    };
    var w = getWorker();
    if (w) {
      w.postMessage({ id: job, moves: shown, fen: game.fen || "", lv: "h" });
    } else {
      aiTimer = setTimeout(function () {
        aiTimer = null;
        if (job !== aiJob) return;
        var r = E.choose(pos, "h", rand, 450);
        if (aiDone) aiDone(r.move ? E.toUci(r.move) : "", r);
      }, 40);
    }
  }

  function playDialog() {
    if (!game || game.mode !== "review" || (st && st.over)) return;
    var dlg = makeDialog("chess-play");
    dlg.appendChild(el("div", "dlg-title", t("rv.playTitle")));
    var side = toMove();
    var acts = el("div", "dlg-col");
    var ai = button(t("rv.playAi", { side: t("sidel." + side) }), "primary", function () { dlg.close(); playFromHere("ai", side); });
    acts.appendChild(ai);
    acts.appendChild(button(t("rv.playDuo"), "", function () { dlg.close(); playFromHere("duo", "w"); }));
    acts.appendChild(button(t("promo.cancel"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    dlg.appendChild(el("div", "dlg-foot", t("rv.playNote")));
    document.body.appendChild(dlg);
    dlg.showModal();
    ai.focus();
  }

  function playFromHere(mode, human) {
    var next = { mode: mode, lv: prefs.lv, human: human, moves: game.moves.slice(0, game.at),
                 done: false, unrated: mode === "ai", base: game.at };
    if (game.fen) next.fen = game.fen;
    if (!next.base) delete next.base;
    prefs.mode = mode;
    if (mode === "ai") prefs.side = human;
    savePrefs();
    replaceGame(next, t("toast.fromHere"), true);
  }

  // Incoming deep links (shell __orosOpenAt / __orosTakeTarget):
  //   { openFile: { token } }  a .pgn from the system's "Open with"
  //                            (shell fileopen.js)
  //   { pgn: "<text>" }        a PGN from another app
  function openTarget(x) {
    if (!x || typeof x !== "object") return;
    if (x.openFile) {
      var f = null;
      try {
        var p = window.parent;
        if (typeof x.openFile.token === "string" && p && p !== window && typeof p.__orosTakeFile === "function")
          f = p.__orosTakeFile(x.openFile.token);
      } catch (e) { f = null; }
      if (f) { closeDialogs(); openPgnFile(f); }
      return;
    }
    if (typeof x.pgn === "string") {
      closeDialogs();
      if (x.pgn.length > PGN.MAX_TEXT) { showToast(t("pgn.big")); return; }
      openPgnText(x.pgn);
    }
  }

  // ---------- 7c. Online accounts: Chess.com (read only) ----------
  // Straight from the browser to Chess.com's public API, one request at
  // a time (it answers parallel requests with 429). The username is a
  // device-local pref; nothing is sent anywhere else and nothing syncs.
  function ccGet(url) {
    if (navigator.onLine === false) return Promise.reject(new Error("offline"));
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 20000);
    return fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        clearTimeout(timer);
        if (r.status === 404 || r.status === 410) throw new Error("nouser");
        if (r.status === 429) throw new Error("busy");
        if (!r.ok) throw new Error("net");
        return r.json();
      }, function () { clearTimeout(timer); throw new Error(navigator.onLine === false ? "offline" : "net"); });
  }
  function ccError(e, user) {
    var k = e && e.message;
    showToast(t(k === "offline" || k === "nouser" || k === "busy" ? "cc." + k : "cc.net", { u: user || "" }));
  }

  // A dialog whose body fills in when its data arrives (and only if it is
  // still the dialog on screen).
  function ccDialog(id, title) {
    closeDialogs();
    var dlg = makeDialog(id);
    dlg.classList.add("wide");
    dlg.appendChild(el("div", "dlg-title", title));
    var body = el("div", "cc-body");
    body.appendChild(el("div", "dlg-msg dlg-center", t("cc.loading")));
    dlg.appendChild(body);
    var acts = el("div", "dlg-actions");
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    return { dlg: dlg, body: body, acts: acts, live: function () { return dlg.open && document.body.contains(dlg); } };
  }

  function onlineDialog() {
    if (!prefs.cc) { userDialog(); return; }
    var d = ccDialog("chess-online", t("cc.title"));
    var user = prefs.cc;
    d.acts.appendChild(button(t("cc.close"), "", function () { d.dlg.close(); }));
    var games = button(t("cc.games"), "primary", function () { monthsDialog(); });
    d.acts.appendChild(games);
    games.focus();
    var prof = null;
    ccGet(CC.playerUrl(user)).then(function (j) {
      prof = CC.profile(j);
      return ccGet(CC.playerUrl(user, "/stats"));
    }).then(function (j) {
      if (!d.live()) return;
      d.body.innerHTML = "";
      var head = el("div", "cc-head");
      var who = el("div", "cc-who");
      who.appendChild(el("strong", "", (prof && prof.title ? prof.title + " " : "") + ((prof && prof.user) || user)));
      if (prof && prof.name) who.appendChild(el("span", "", prof.name));
      head.appendChild(who);
      head.appendChild(button(t("cc.change"), "small", function () { userDialog(); }));
      d.body.appendChild(head);
      var rows = CC.stats(j);
      if (!rows.length) d.body.appendChild(el("div", "dlg-foot", t("cc.noStats")));
      rows.forEach(function (r) {
        var v = r.last !== null ? String(r.last) : String(r.best);
        if (r.last !== null && r.best !== null) v += " · " + t("cc.best", { n: r.best });
        var rw = row(t("cc.k." + r.kind), v);
        if (r.w + r.l + r.d) rw.appendChild(el("em", "cc-wld", t("cc.wld", { w: r.w, l: r.l, d: r.d })));
        d.body.appendChild(rw);
      });
      var more = el("div", "dlg-actions");
      more.appendChild(button(t("cc.puzzle"), "", dailyPuzzle));
      more.appendChild(button(t("cc.forget"), "danger", function () {
        prefs.cc = ""; savePrefs(); d.dlg.close();
      }));
      d.body.appendChild(more);
      d.body.appendChild(el("div", "dlg-foot", t("cc.note")));
    }).catch(function (e) {
      if (!d.live()) return;
      if (e && e.message === "nouser") { userDialog(); ccError(e, user); return; }
      d.dlg.close();
      ccError(e, user);
    });
  }

  function userDialog() {
    closeDialogs();
    var dlg = makeDialog("chess-ccuser");
    dlg.appendChild(el("div", "dlg-title", t("cc.title")));
    dlg.appendChild(el("div", "dlg-msg", t("cc.intro")));
    var inp = el("input", "cc-input");
    inp.type = "text";
    inp.autocomplete = "username";
    inp.spellcheck = false;
    inp.maxLength = 25;
    inp.value = prefs.cc;
    inp.placeholder = t("cc.user");
    inp.setAttribute("aria-label", t("cc.user"));
    dlg.appendChild(inp);
    function go() {
      var u = CC.okUser(inp.value);
      if (!u) { showToast(t("cc.badUser")); inp.focus(); return; }
      prefs.cc = u;
      savePrefs();
      onlineDialog();
    }
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); go(); } });
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("cc.puzzle"), "", dailyPuzzle));
    acts.appendChild(button(t("cc.show"), "primary", go));
    dlg.appendChild(acts);
    var close = el("div", "dlg-actions");
    close.appendChild(button(t("cc.close"), "", function () { dlg.close(); }));
    dlg.appendChild(close);
    document.body.appendChild(dlg);
    dlg.showModal();
    inp.focus();
  }

  function monthName(ym) {
    var p = ym.split("/");
    try { return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB", { month: "long", year: "numeric" }); }
    catch (e) { return ym; }
  }

  function monthsDialog() {
    var user = prefs.cc;
    var d = ccDialog("chess-ccmonths", t("cc.months"));
    d.acts.appendChild(button(t("cc.back"), "", onlineDialog));
    ccGet(CC.playerUrl(user, "/games/archives")).then(function (j) {
      if (!d.live()) return;
      var list = CC.months(j);
      d.body.innerHTML = "";
      if (!list.length) { d.body.appendChild(el("div", "dlg-msg dlg-center", t("cc.noMonths"))); return; }
      var box = el("div", "pick-list");
      list.forEach(function (ym) {
        var b = el("button", "pick-btn");
        b.type = "button";
        b.appendChild(el("span", "pick-names", monthName(ym)));
        b.addEventListener("click", function () { monthDialog(ym); });
        box.appendChild(b);
      });
      d.body.appendChild(box);
      var first = box.querySelector("button");
      if (first) first.focus();
    }).catch(function (e) { if (d.live()) { d.dlg.close(); ccError(e, user); } });
  }

  function monthDialog(ym) {
    var user = prefs.cc;
    var d = ccDialog("chess-ccmonth", monthName(ym));
    d.acts.appendChild(button(t("cc.back"), "", monthsDialog));
    ccGet(CC.monthUrl(user, ym)).then(function (j) {
      if (!d.live()) return;
      var list = CC.games(j);
      d.body.innerHTML = "";
      if (!list.length) { d.body.appendChild(el("div", "dlg-msg dlg-center", t("cc.noGames"))); return; }
      var box = el("div", "pick-list");
      list.forEach(function (g) {
        var b = el("button", "pick-btn");
        b.type = "button";
        b.appendChild(el("span", "pick-names",
          g.white + (g.wr ? " (" + g.wr + ")" : "") + " – " + g.black + (g.br ? " (" + g.br + ")" : "")));
        var when = g.end ? new Date(g.end * 1000).toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB", { day: "numeric", month: "short" }) : "";
        b.appendChild(el("span", "pick-meta", [g.result, g.kind ? t("cc.k." + g.kind) : "", when].filter(Boolean).join(" · ")));
        b.addEventListener("click", function () {
          var r = PGN.parse(g.pgn);
          d.dlg.close();
          if (!r.games.length) { showToast(t("pgn.none")); return; }
          startReview(r.games[0]);
        });
        box.appendChild(b);
      });
      d.body.appendChild(box);
      var first = box.querySelector("button");
      if (first) first.focus();
    }).catch(function (e) { if (d.live()) { d.dlg.close(); ccError(e, user); } });
  }

  function dailyPuzzle() {
    closeDialogs();
    ccGet(CC.API + "puzzle").then(function (j) {
      var pz = CC.puzzle(j), r = pz ? PGN.parse(pz.pgn) : null;
      if (!r || !r.games.length) { showToast(t("cc.net")); return; }
      var g = r.games[0];
      g.tags = { Event: "Chess.com · " + (pz.title || t("cc.puzzle")), Site: "chess.com" };
      g.result = "*";
      startReview(g, true);
      showToast(t("cc.puzzleOpened", { side: t("sidel." + toMove()) }));
    }).catch(function (e) { ccError(e); });
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
    pgn:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
    online:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
    first: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5v14M18 6l-7 6 7 6z"/></svg>',
    prev:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
    next:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    last:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 5v14M6 6l7 6-7 6z"/></svg>',
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
      if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;
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
      if (game && game.mode === "review" && !onSq && tag !== "TEXTAREA") {
        var nav = { ArrowLeft: game.at - 1, ArrowRight: game.at + 1, Home: 0, End: game.moves.length };
        if (nav[e.key] !== undefined) { e.preventDefault(); goTo(nav[e.key]); return; }
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
     ["flip-btn", "flip", "btn.flip"], ["stats-btn", "stats", "btn.stats"], ["pgn-btn", "pgn", "btn.pgn"], ["online-btn", "online", "btn.online"],
     ["rv-first", "first", "rv.first"], ["rv-prev", "prev", "rv.prev"],
     ["rv-next", "next", "rv.next"], ["rv-last", "last", "rv.last"]].forEach(function (x) {
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
    $("pgn-btn").addEventListener("click", function () { pgnDialog(); });
    $("online-btn").addEventListener("click", function () { onlineDialog(); });
    $("rv-first").addEventListener("click", function () { goTo(0); });
    $("rv-prev").addEventListener("click", function () { goTo(game.at - 1); });
    $("rv-next").addEventListener("click", function () { goTo(game.at + 1); });
    $("rv-last").addEventListener("click", function () { goTo(game.moves.length); });
    $("rv-ana").addEventListener("click", function () {
      prefs.ana = !prefs.ana;
      savePrefs();
      renderReviewBar();
      runAnalysis();
    });
    $("rv-play").addEventListener("click", playDialog);
    $("moves").addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-ply]");
      if (b && game && game.mode === "review") goTo(+b.getAttribute("data-ply"));
    });
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
      if (game.mode !== "review") prefs.mode = game.mode;
      prefs.lv = game.lv;
    } else {
      game = fresh();
      saveSession();
    }
    syncPos();
    if (st.over) game.done = true;
    if (!whiteBottom()) focusIdx = 63 - focusIdx;
    renderAll(true);
    maybeAi();   // a game left on the computer's turn continues
    runAnalysis();
    window.__orosOpenAt = openTarget;
    try {
      var p = window.parent;
      if (p && p !== window && typeof p.__orosTakeTarget === "function") {
        var pending = p.__orosTakeTarget("chess");
        if (pending) openTarget(pending);
      }
    } catch (e) {}
  }

  boot();
})();
