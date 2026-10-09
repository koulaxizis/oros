// ============================================================
// orOS Xeri — App logic (v1.0.0)
// The Greek card game Ξερή, you against the computer, drawn by cardkit/.
// Rules (2 players, 52 cards):
//   - 6 cards each (option: 4) and 4 open cards on the table; a Jack
//     dealt to the table goes back into the deck and another card is
//     drawn. New hands from the deck until it runs out.
//   - Play one card: the same rank as the top table card takes the whole
//     table; a Jack always takes it (when the table is not empty).
//   - Xeri: a capture when the table holds exactly one card = 10 points;
//     Jack on a lone Jack = 20. A Jack on a lone other card is a plain
//     capture (option: a xeri, 10).
//   - End of the deal: the cards left on the table go to the last
//     capturer. Points: most cards 3 (none on 26–26), each K, Q, J, 10
//     one point except 10♦ two, 2♣ one, plus the xeri points. That is
//     21 a deal without xeri (18 on a tie).
//   - Match to 51 (options: 101, or a single deal). A tie at or past the
//     target plays another deal; a single deal can end level.
// Computer: Easy (random card, captures 3 times in 4 when it can) ·
// Medium (rules: takes points, keeps Jacks, avoids a lone card) · Hard
// (counts the open cards and weighs the odds of your reply). It only
// ever sees aiView(): its own hand and the open cards, never yours.
// Play: tap or drag a card onto the table; keys 1–6; N new match.
// Data:
//   - synced slice "xeri" (oros-xeri-data): per level the matches, wins,
//     xeri, Jack-on-Jack xeri and the best deal, as per-device rows
//     (each device grows its own row; merge = per-row join) + a reset
//     stamp br. Same shape as Connect 4.
//   - device-local (R10): oros-xeri-prefs (level + rules), oros-xeri-session
//     (the match in progress), oros-xeri-device (row id), oros-xeri-sfx
// Sections:
//   1. Constants, i18n, helpers
//   2. Rules: deal, play, capture, scoring
//   3. Computer player (sees aiView only)
//   4. Synced data: load / save / normalize / merge (R5, R26)
//   5. Device-local prefs + session
//   6. Game flow (new match, play, computer turn, deal end)
//   7. Render (toolbar, status, table layout)
//   8. Dialogs (rules, deal breakdown, match result, records, confirm)
//   9. Toasts
//  10. Sound
//  11. Input (tap + drag via cardkit, keys 1–6, N, Contract Β)
//  12. Sync slice + palette
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-xeri-data";
  var PREFS_KEY   = "oros-xeri-prefs";
  var SESSION_KEY = "oros-xeri-session";
  var DEVICE_KEY  = "oros-xeri-device";
  var SFX_KEY     = "oros-xeri-sfx";
  var DATA_VER    = 1;

  var LEVELS = ["e", "m", "h"];
  var TARGETS = [51, 101, 0];              // 0 = a single deal
  var HAND_SIZES = [6, 4];
  var PHASES = ["play", "end", "over"];
  var TABLE_START = 4;
  var JACK = 11;
  var CARD_W = 0.12;                       // a card's share of the 3 "most cards" points
  var MAX_BEST = 999;
  var MAX_COUNT = 1000000000;

  var CK = window.orosCards;

  var AI_DELAY = 700;                      // ms before the computer plays
  var SHOW_MS = 650;                       // a capture stays visible this long
  var TAKE_MS = 260;                       // the pile slides to the capturer

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
      "btn.opts": "Rules",
      "btn.new": "New match (N)",
      "btn.stats": "Records",
      "btn.sfxOn": "Card sound on", "btn.sfxOff": "Card sound off",
      "btn.next": "Next deal",
      "btn.result": "Match result",
      "btn.again": "New match",
      "side.you": "You", "side.ai": "Computer",
      "turn.you": "Your turn",
      "turn.ai": "Computer is playing…",
      "turn.end": "Deal over",
      "turn.won": "You won the match",
      "turn.lost": "The computer won",
      "turn.draw": "Draw",
      "info.deal": "Deal {n}",
      "info.to": "to {n}",
      "info.one": "one deal",
      "info.cards": "Cards {n}",
      "info.xeri": "Xeri {n}",
      "info.jx": "J on J {n}",
      "deck.label": "Deck: {n} cards",
      "deck.empty": "Deck: empty",
      "table.empty": "Table: empty",
      "table.label": "Table: {n} cards, top {c}",
      "table.one": "Table: one card, {c}",
      "hand.label": "Your hand",
      "hand.card": "{k}: {c}",
      "opp.label": "Computer's hand: {n} cards",
      "live.you": "You played {c}",
      "live.youCap": "You played {c}, captured {n} cards",
      "live.ai": "Computer played {c}",
      "live.aiCap": "Computer played {c}, captured {n} cards",
      "live.xeri": "Xeri! {p} points",
      "live.refill": "New hands. {n} cards left in the deck",
      "live.lastYou": "You take the cards left on the table",
      "live.lastAi": "The computer takes the cards left on the table",
      "live.dealYou": "Deal {n}. You lead",
      "live.dealAi": "Deal {n}. The computer leads",
      "flash.xeri": "Xeri!",
      "bd.title": "Deal {n}",
      "bd.cards": "Cards",
      "bd.most": "Most cards",
      "bd.figs": "Figures & 10s",
      "bd.td": "10♦",
      "bd.tc": "2♣",
      "bd.xeri": "Xeri",
      "bd.total": "Deal points",
      "bd.match": "Match",
      "bd.tie": "26–26: nobody gets the 3 points for cards.",
      "bd.goal": "First to {n} wins; a tie plays another deal.",
      "res.title": "Match over",
      "res.win": "You win!",
      "res.lose": "The computer wins",
      "res.draw": "It's a draw",
      "res.score": "Final score",
      "res.deals": "Deals",
      "res.close": "Close",
      "stats.title": "Records vs computer",
      "stats.matches": "Matches · wins",
      "stats.xeri": "Xeri · Jack on Jack",
      "stats.best": "Best deal",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "confirm.reset": "Delete the records vs the computer on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "opt.title": "Rules",
      "opt.target": "Match",
      "opt.t51": "To 51", "opt.t101": "To 101", "opt.t0": "One deal",
      "opt.hand": "Cards per hand",
      "opt.jx": "Jack on a lone card",
      "opt.jxNo": "Plain capture", "opt.jxYes": "Xeri (10)",
      "opt.help": "Play a card of the same rank as the top card to take the whole table; a Jack always takes it. Taking a single card is a xeri: 10 points, Jack on Jack 20. Points: most cards 3, each K, Q, J, 10 one (10♦ two), 2♣ one.",
      "opt.note": "Rule changes apply from the next match.",
      "opt.now": "New match now",
      "opt.close": "Close",
      "toast.newmatch": "New match started",
      "toast.undo": "Undo",
      "toast.save": "Could not save: storage is full",
      "toast.wait": "Wait: the computer is playing",
      "toast.end": "The deal is over: tap Next deal",
      "toast.over": "The match is over: start a new one (N)",
      "toast.nokey": "No card {n} in your hand",
      "toast.rules": "Saved: the rules apply from the next match",
      "toast.reset": "Records reset"
    },
    el: {
      "level.e": "Εύκολο", "level.m": "Μέτριο", "level.h": "Δύσκολο",
      "btn.opts": "Κανόνες",
      "btn.new": "Νέα παρτίδα (N)",
      "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος φύλλων ανοιχτός", "btn.sfxOff": "Ήχος φύλλων κλειστός",
      "btn.next": "Επόμενη μοιρασιά",
      "btn.result": "Αποτέλεσμα",
      "btn.again": "Νέα παρτίδα",
      "side.you": "Εσύ", "side.ai": "Υπολογιστής",
      "turn.you": "Σειρά σου",
      "turn.ai": "Παίζει ο υπολογιστής…",
      "turn.end": "Τέλος μοιρασιάς",
      "turn.won": "Κέρδισες την παρτίδα",
      "turn.lost": "Κέρδισε ο υπολογιστής",
      "turn.draw": "Ισοπαλία",
      "info.deal": "Μοιρασιά {n}",
      "info.to": "ως τους {n}",
      "info.one": "μία μοιρασιά",
      "info.cards": "Φύλλα {n}",
      "info.xeri": "Ξερές {n}",
      "info.jx": "Β σε Β {n}",
      "deck.label": "Τράπουλα: {n} φύλλα",
      "deck.empty": "Τράπουλα: άδεια",
      "table.empty": "Τραπέζι: άδειο",
      "table.label": "Τραπέζι: {n} φύλλα, πάνω {c}",
      "table.one": "Τραπέζι: ένα φύλλο, {c}",
      "hand.label": "Το χέρι σου",
      "hand.card": "{k}: {c}",
      "opp.label": "Χέρι υπολογιστή: {n} φύλλα",
      "live.you": "Έπαιξες {c}",
      "live.youCap": "Έπαιξες {c}, μάζεψες {n} φύλλα",
      "live.ai": "Ο υπολογιστής έπαιξε {c}",
      "live.aiCap": "Ο υπολογιστής έπαιξε {c}, μάζεψε {n} φύλλα",
      "live.xeri": "Ξερή! {p} πόντοι",
      "live.refill": "Νέα φύλλα. Μένουν {n} στην τράπουλα",
      "live.lastYou": "Παίρνεις τα φύλλα που έμειναν στο τραπέζι",
      "live.lastAi": "Ο υπολογιστής παίρνει τα φύλλα που έμειναν στο τραπέζι",
      "live.dealYou": "Μοιρασιά {n}. Ξεκινάς εσύ",
      "live.dealAi": "Μοιρασιά {n}. Ξεκινά ο υπολογιστής",
      "flash.xeri": "Ξερή!",
      "bd.title": "Μοιρασιά {n}",
      "bd.cards": "Φύλλα",
      "bd.most": "Περισσότερα φύλλα",
      "bd.figs": "Φιγούρες και δεκάρια",
      "bd.td": "10 καρό",
      "bd.tc": "2 σπαθί",
      "bd.xeri": "Ξερές",
      "bd.total": "Πόντοι μοιρασιάς",
      "bd.match": "Παρτίδα",
      "bd.tie": "26–26: κανείς δεν παίρνει τους 3 πόντους των φύλλων.",
      "bd.goal": "Κερδίζει όποιος φτάσει πρώτος τους {n}· στην ισοπαλία παίζεται κι άλλη μοιρασιά.",
      "res.title": "Τέλος παρτίδας",
      "res.win": "Κέρδισες!",
      "res.lose": "Κέρδισε ο υπολογιστής",
      "res.draw": "Ισοπαλία",
      "res.score": "Τελικό σκορ",
      "res.deals": "Μοιρασιές",
      "res.close": "Κλείσιμο",
      "stats.title": "Ρεκόρ με τον υπολογιστή",
      "stats.matches": "Παρτίδες · νίκες",
      "stats.xeri": "Ξερές · βαλές σε βαλέ",
      "stats.best": "Καλύτερη μοιρασιά",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ με τον υπολογιστή σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "opt.title": "Κανόνες",
      "opt.target": "Παρτίδα",
      "opt.t51": "Ως τους 51", "opt.t101": "Ως τους 101", "opt.t0": "Μία μοιρασιά",
      "opt.hand": "Φύλλα ανά χέρι",
      "opt.jx": "Βαλές σε μοναχό φύλλο",
      "opt.jxNo": "Απλό μάζεμα", "opt.jxYes": "Ξερή (10)",
      "opt.help": "Με φύλλο ίδιο με το πάνω φύλλο του τραπεζιού μαζεύεις όλο το τραπέζι· ο βαλές μαζεύει πάντα. Αν μαζέψεις μοναχό φύλλο, κάνεις ξερή: 10 πόντοι, βαλές σε βαλέ 20. Πόντοι: περισσότερα φύλλα 3, κάθε Ρ, Ν, Β, 10 από 1 (το 10 καρό 2), το 2 σπαθί 1.",
      "opt.note": "Οι αλλαγές στους κανόνες ισχύουν από την επόμενη παρτίδα.",
      "opt.now": "Νέα παρτίδα τώρα",
      "opt.close": "Κλείσιμο",
      "toast.newmatch": "Ξεκίνησε νέα παρτίδα",
      "toast.undo": "Αναίρεση",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "toast.wait": "Περίμενε: παίζει ο υπολογιστής",
      "toast.end": "Η μοιρασιά τελείωσε: πάτα «Επόμενη μοιρασιά»",
      "toast.over": "Η παρτίδα τελείωσε: ξεκίνα νέα (N)",
      "toast.nokey": "Δεν έχεις φύλλο {n} στο χέρι",
      "toast.rules": "Αποθηκεύτηκε: οι κανόνες ισχύουν από την επόμενη παρτίδα",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν"
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

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("xeri.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Rules ----------
  // g = {
  //   ver: 1, lv, tgt (51 | 101 | 0), hs (6 | 4), jx (Jack on a lone card = xeri),
  //   dn: deal number, lead: 0 | 1 (who plays first this deal; 0 = you),
  //   deck: [ids] (drawn from its end), table: [ids] (last = top),
  //   hands: [[you], [computer]], won: [[…], […]] (captured cards),
  //   xr: [[xeri, jackXeri], […]] this deal, last: -1 | 0 | 1 (last capturer),
  //   turn: 0 | 1, sc: [you, computer] match points, log: [[a, b]…] per deal,
  //   phase: "play" | "end" (deal over) | "over" (match over)
  // }
  // Positions are never mutated: every step returns a new object.
  function cloneG(g) { return JSON.parse(JSON.stringify(g)); }

  function cardPts(c) {
    var r = CK.rank(c), s = CK.suit(c);
    if (r === 10 && s === 2) return 2;          // 10♦
    if (r === 2 && s === 3) return 1;           // 2♣
    return r >= 10 ? 1 : 0;                     // 10, J, Q, K
  }

  function blankGame(rules) {
    return { ver: 1, lv: rules.lv, tgt: rules.tgt, hs: rules.hs, jx: rules.jx === true,
             dn: 0, lead: 1, deck: [], table: [], hands: [[], []], won: [[], []],
             xr: [[0, 0], [0, 0]], last: -1, turn: 0, sc: [0, 0], log: [], phase: "play" };
  }

  // One round of hands, the leader's card first (mutates n: a fresh clone).
  function dealRound(n) {
    for (var i = 0; i < n.hs; i++) {
      n.hands[n.lead].push(n.deck.pop());
      n.hands[1 - n.lead].push(n.deck.pop());
    }
    n.turn = n.lead;
  }

  // deck: a shuffled full deck; rnd(k) → integer in [0, k).
  // A Jack drawn for the table goes back into the deck (never on top,
  // so the next draw is another card) and a new card is drawn.
  function startDeal(g, deck, rnd) {
    var n = cloneG(g);
    n.dn += 1;
    n.lead = 1 - g.lead;                        // the first deal: you lead
    n.deck = deck.slice();
    n.table = []; n.hands = [[], []]; n.won = [[], []];
    n.xr = [[0, 0], [0, 0]]; n.last = -1; n.phase = "play";
    dealRound(n);
    while (n.table.length < TABLE_START) {
      var c = n.deck.pop();
      if (CK.rank(c) === JACK) { n.deck.splice(rnd(n.deck.length), 0, c); continue; }
      n.table.push(c);
    }
    return n;
  }

  function newMatch(rules, deck, rnd) { return startDeal(blankGame(rules), deck, rnd); }

  // "" no capture · "c" plain capture · "x10" xeri · "x20" Jack on a lone Jack
  function captureKind(table, c, jx) {
    if (!table.length) return "";
    var top = CK.rank(table[table.length - 1]), r = CK.rank(c);
    if (r !== top && r !== JACK) return "";
    if (table.length !== 1) return "c";
    if (r === JACK && top === JACK) return "x20";
    if (r === top) return "x10";
    return jx ? "x10" : "c";
  }

  // who plays hand[idx] → { g, ev: { who, card, cap (cards taken, 0 = none), xeri } }
  function playCard(g, who, idx) {
    var n = cloneG(g);
    var c = n.hands[who].splice(idx, 1)[0];
    var kind = captureKind(g.table, c, g.jx);
    var ev = { who: who, card: c, cap: 0, xeri: kind === "x20" ? 20 : (kind === "x10" ? 10 : 0) };
    n.table.push(c);
    if (kind) {
      ev.cap = n.table.length;
      if (ev.xeri === 20) n.xr[who][1]++;
      else if (ev.xeri === 10) n.xr[who][0]++;
      n.won[who] = n.won[who].concat(n.table);
      n.table = [];
      n.last = who;
    }
    n.turn = 1 - who;
    return { g: n, ev: ev };
  }

  // After a card: new hands while the deck lasts, else the deal ends (the
  // table goes to the last capturer; nobody captured → the dealer).
  function advance(g) {
    if (g.phase !== "play" || g.hands[0].length || g.hands[1].length) return g;
    var n = cloneG(g);
    if (n.deck.length) { dealRound(n); return n; }
    if (n.table.length) {
      var to = n.last >= 0 ? n.last : 1 - n.lead;
      n.won[to] = n.won[to].concat(n.table);
      n.table = [];
    }
    var s = dealScore(n);
    n.sc = [n.sc[0] + s[0].total, n.sc[1] + s[1].total];
    n.log = n.log.concat([[s[0].total, s[1].total]]);
    n.phase = matchWinner(n) >= 0 ? "over" : "end";
    return n;
  }

  function dealScore(g) {
    var cnt = [g.won[0].length, g.won[1].length];
    return [0, 1].map(function (p) {
      var figs = 0, td = 0, tc = 0;
      g.won[p].forEach(function (c) {
        var r = CK.rank(c), s = CK.suit(c);
        if (r === 10 && s === 2) td = 2;
        else if (r >= 10) figs++;
        else if (r === 2 && s === 3) tc = 1;
      });
      var most = cnt[p] > cnt[1 - p] ? 3 : 0;
      var xeri = g.xr[p][0] * 10 + g.xr[p][1] * 20;
      return { cards: cnt[p], most: most, figs: figs, td: td, tc: tc,
               x10: g.xr[p][0], x20: g.xr[p][1], xeri: xeri,
               total: most + figs + td + tc + xeri };
    });
  }

  // -1 = play on · 0 / 1 = that side won · 2 = draw (single deal only)
  function matchWinner(g) {
    var a = g.sc[0], b = g.sc[1];
    if (g.tgt === 0) return a > b ? 0 : (b > a ? 1 : 2);
    if (Math.max(a, b) < g.tgt || a === b) return -1;
    return a > b ? 0 : 1;
  }

  function nextDeal(g, deck, rnd) { return g.phase === "end" ? startDeal(g, deck, rnd) : g; }

  // A stored match: every field in range, the 52 cards each exactly once.
  function validGame(g) {
    if (!g || typeof g !== "object" || g.ver !== 1 || LEVELS.indexOf(g.lv) < 0 ||
        TARGETS.indexOf(g.tgt) < 0 || HAND_SIZES.indexOf(g.hs) < 0 || typeof g.jx !== "boolean" ||
        !isInt(g.dn) || g.dn < 1 || g.dn > 1000 || (g.lead !== 0 && g.lead !== 1) ||
        (g.turn !== 0 && g.turn !== 1) || (g.last !== -1 && g.last !== 0 && g.last !== 1) ||
        PHASES.indexOf(g.phase) < 0) return false;
    var arrs = [g.deck, g.table, g.hands && g.hands[0], g.hands && g.hands[1], g.won && g.won[0], g.won && g.won[1]];
    if (!arrs.every(Array.isArray) || g.hands.length !== 2 || g.won.length !== 2) return false;
    var seen = {}, count = 0;
    for (var a = 0; a < arrs.length; a++) {
      for (var i = 0; i < arrs[a].length; i++) {
        var c = arrs[a][i];
        if (!isInt(c) || c < 0 || c > 51 || seen[c]) return false;
        seen[c] = true; count++;
      }
    }
    if (count !== 52) return false;
    if (g.hands[0].length > g.hs || g.hands[1].length > g.hs || g.deck.length % (2 * g.hs) !== 0) return false;
    if (!Array.isArray(g.xr) || g.xr.length !== 2 || !Array.isArray(g.sc) || g.sc.length !== 2 || !Array.isArray(g.log)) return false;
    for (var p = 0; p < 2; p++) {
      if (!Array.isArray(g.xr[p]) || g.xr[p].length !== 2 || !isInt(g.xr[p][0]) || !isInt(g.xr[p][1]) ||
          g.xr[p][0] < 0 || g.xr[p][1] < 0 || g.xr[p][0] + g.xr[p][1] > 52) return false;
      if (!isInt(g.sc[p]) || g.sc[p] < 0) return false;
    }
    var sum = [0, 0];
    for (var k = 0; k < g.log.length; k++) {
      var d = g.log[k];
      if (!Array.isArray(d) || d.length !== 2 || !isInt(d[0]) || !isInt(d[1]) || d[0] < 0 || d[1] < 0) return false;
      sum[0] += d[0]; sum[1] += d[1];
    }
    if (sum[0] !== g.sc[0] || sum[1] !== g.sc[1]) return false;
    if (g.phase === "play") {
      if (g.log.length !== g.dn - 1 || (!g.hands[0].length && !g.hands[1].length)) return false;
      if (matchWinner(g) >= 0 && g.log.length && g.tgt !== 0) return false;
    } else {
      if (g.log.length !== g.dn || g.deck.length || g.table.length || g.hands[0].length || g.hands[1].length) return false;
      if ((matchWinner(g) >= 0) !== (g.phase === "over")) return false;
    }
    return true;
  }

  // ---------- 3. Computer player ----------
  // The computer decides from aiView() alone: its own hand and the cards
  // that lie or lay open (the table and both captured piles), plus counts.
  // Nothing in this section receives a game object, so it cannot read
  // your hand or the order of the deck (tests/xeri.test.js checks both).
  function aiView(g, me) {
    return {
      hand: g.hands[me].slice(),
      table: g.table.slice(),
      seen: g.won[0].concat(g.won[1], g.table).sort(numCmp),
      opp: g.hands[1 - me].length,
      deck: g.deck.length,
      hs: g.hs,
      jx: g.jx,
      mine: g.last === me
    };
  }

  function pileVal(cards) {
    var v = 0;
    for (var i = 0; i < cards.length; i++) v += cardPts(cards[i]);
    return v + cards.length * CARD_W;
  }

  // Chance that k cards, dealt from `pool` unseen cards, hold at least
  // one of `hits` particular ones.
  function pAny(pool, hits, k) {
    if (hits <= 0 || k <= 0 || pool <= 0) return 0;
    if (hits >= pool || k >= pool) return 1;
    var miss = 1;
    for (var i = 0; i < k; i++) miss *= Math.max(0, pool - hits - i) / (pool - i);
    return 1 - miss;
  }

  // Unseen cards per rank (1..13) from the computer's point of view.
  function unseenByRank(view) {
    var left = [0, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4];
    view.seen.concat(view.hand).forEach(function (c) { left[CK.rank(c)]--; });
    return left;
  }

  function sameRankInHand(view, i) {
    var r = CK.rank(view.hand[i]), n = 0;
    view.hand.forEach(function (c, j) { if (j !== i && CK.rank(c) === r) n++; });
    return n;
  }

  // Medium: plain rules of thumb, no odds.
  function scoreMedium(view, i) {
    var c = view.hand[i], r = CK.rank(c), after = view.table.concat([c]);
    var kind = captureKind(view.table, c, view.jx);
    var last = view.hand.length === 1 && view.deck === 0 && view.opp === 0;
    if (kind) {
      var gain = pileVal(after) + (kind === "x20" ? 20 : (kind === "x10" ? 10 : 0));
      if (r === JACK && kind !== "x20" && !last && pileVal(view.table) < 2) gain -= 2.5;   // keep Jacks
      return gain;
    }
    var v = pileVal(after), risk;
    if (after.length === 1) {
      risk = 6 + v;                                       // a lone card invites a xeri
      if (sameRankInHand(view, i)) risk -= 3;            // we hold its twin
      var seenR = 0;
      view.seen.forEach(function (x) { if (CK.rank(x) === r) seenR++; });
      if (seenR >= 2) risk -= 3;                          // its rank is mostly gone
    } else {
      risk = v * 0.5;
    }
    if (r === JACK) risk += 4;                            // a Jack is worth keeping
    return -risk - cardPts(c) * 0.5;
  }

  // Hard: counts the open cards; weighs the odds that your next card
  // (from the cards it has not seen) takes what it leaves.
  function scoreHard(view, i, left) {
    var c = view.hand[i], r = CK.rank(c), after = view.table.concat([c]);
    var kind = captureKind(view.table, c, view.jx);
    var pool = 0;
    for (var q = 1; q <= 13; q++) pool += left[q];
    // the cards of the reply: yours now, or a fresh hand if you are out
    var k = view.opp > 0 ? view.opp : (view.deck > 0 ? view.hs : 0);
    var jacksOut = left[JACK];
    if (kind) {
      var gain = pileVal(after) + (kind === "x20" ? 20 : (kind === "x10" ? 10 : 0));
      if (r === JACK && kind !== "x20" && k > 0) {
        // a Jack spent on a small pile is a Jack missing for a big one
        gain -= 0.9 + 0.35 * Math.min(jacksOut + 1, 3) * (view.deck > 0 ? 1 : 0.5);
      }
      return gain;
    }
    var v = pileVal(after);
    if (k === 0) return view.mine ? v * 0.5 : -v;        // the last card: the table goes to the last capturer
    var pr = pAny(pool, left[r], k);
    var risk;
    if (after.length === 1) {
      if (r === JACK) risk = pr * (v + 20);
      else {
        var pj = pAny(pool, jacksOut, k);
        risk = pr * (v + 10) + (1 - pr) * pj * (v + (view.jx ? 10 : 0));
      }
    } else {
      risk = pAny(pool, r === JACK ? jacksOut : left[r] + jacksOut, k) * v;
    }
    if (r === JACK) risk += 1.6;                         // dropping a Jack wastes it
    // keep a card we can answer with: a twin in hand covers this rank later
    if (sameRankInHand(view, i) && after.length > 1) risk -= 0.25;
    return -risk - cardPts(c) * 0.1;
  }

  // Index into view.hand. rnd(k) → integer in [0, k) (ties, Easy).
  function chooseCard(view, lv, rnd) {
    var n = view.hand.length;
    if (!n) return -1;
    if (lv === "e") {
      var caps = [];
      for (var i = 0; i < n; i++) if (captureKind(view.table, view.hand[i], view.jx)) caps.push(i);
      if (caps.length && rnd(4) < 3) return caps[rnd(caps.length)];
      return rnd(n);
    }
    var left = lv === "h" ? unseenByRank(view) : null;
    var best = -Infinity, ties = [];
    for (var j = 0; j < n; j++) {
      var s = lv === "h" ? scoreHard(view, j, left) : scoreMedium(view, j);
      s = Math.round(s * 1000) / 1000;
      if (s > best) { best = s; ties = [j]; }
      else if (s === best) ties.push(j);
    }
    return ties[rnd(ties.length)];
  }

  // ---------- 4. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                         // max-merged
  //   rows: { <deviceId>: { b: <epoch>, s: { e|m|h: [m, w, x, j, d] } } }
  // }
  // m matches finished, w won (w ≤ m), x xeri, j Jack-on-Jack xeri,
  // d best deal (your points in one deal). Each device only ever writes
  // ITS OWN row; a row counts from epoch b. Merge per row: the newer
  // epoch wins; equal epochs take the max of each field. Rows older than
  // br drop. A join (symmetric, associative, idempotent).
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normCell(v) {
    if (!Array.isArray(v) || v.length !== 5) return null;
    for (var i = 0; i < 5; i++) if (!isInt(v[i]) || v[i] < 0 || v[i] > MAX_COUNT) return null;
    if (v[1] > v[0] || v[4] > MAX_BEST) return null;
    if (!(v[0] || v[2] || v[3] || v[4])) return null;
    return v.slice();
  }

  function normRow(row) {
    if (!row || typeof row !== "object" || !isInt(row.b) || row.b < 0) return null;
    var s = {}, any = false;
    LEVELS.forEach(function (lv) {
      var c = normCell(row.s && row.s[lv]);
      if (c) { s[lv] = c; any = true; }
    });
    return any ? { b: row.b, s: s } : null;
  }

  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var s = {};
    LEVELS.forEach(function (lv) {
      var a = x.s[lv], c = y.s[lv];
      if (!a && !c) return;
      if (!a || !c) { s[lv] = (a || c).slice(); return; }
      s[lv] = a.map(function (v, i) { return Math.max(v, c[i]); });
    });
    return { b: x.b, s: s };
  }

  function mergeXeri(A, B) {
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
      var r = rows[id], s = {};
      LEVELS.forEach(function (lv) { if (r.s[lv]) s[lv] = r.s[lv]; });
      sorted[id] = { b: r.b, s: s };
    });
    return { ver: DATA_VER, br: br, rows: sorted };
  }

  // A level across every device: counts add up, the best deal is the max.
  function totals(d, lv) {
    var out = [0, 0, 0, 0, 0];
    Object.keys(d.rows).forEach(function (id) {
      var c = d.rows[id].s[lv];
      if (!c) return;
      for (var i = 0; i < 4; i++) out[i] += c[i];
      out[4] = Math.max(out[4], c[4]);
    });
    return out;
  }

  // One deal's result into a cell: add = { x, j, d, m (0|1), w (0|1) }.
  function bumpCell(cell, add) {
    var c = cell ? cell.slice() : [0, 0, 0, 0, 0];
    c[0] = Math.min(MAX_COUNT, c[0] + add.m);
    c[1] = Math.min(c[0], c[1] + add.w);
    c[2] = Math.min(MAX_COUNT, c[2] + add.x);
    c[3] = Math.min(MAX_COUNT, c[3] + add.j);
    c[4] = Math.max(c[4], Math.min(MAX_BEST, add.d));
    return c;
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.rows && typeof parsed.rows === "object") {
          data = mergeXeri(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] xeri: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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

  // Your side of a finished deal (and match) into this device's row.
  function record(g) {
    var s = dealScore(g)[0], over = g.phase === "over";
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };   // new epoch after a reset
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    row.s[g.lv] = bumpCell(row.s[g.lv], { x: s.x10, j: s.x20, d: s.total,
      m: over ? 1 : 0, w: over && matchWinner(g) === 0 ? 1 : 0 });
    data.rows[deviceId] = row;
    data = mergeXeri(data, data);
    save();
  }

  // ---------- 5. Device-local prefs + session ----------
  var prefs = { lv: "m", tgt: 51, hs: 6, jx: false };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (LEVELS.indexOf(p.lv) >= 0) prefs.lv = p.lv;
        if (TARGETS.indexOf(p.tgt) >= 0) prefs.tgt = p.tgt;
        if (HAND_SIZES.indexOf(p.hs) >= 0) prefs.hs = p.hs;
        prefs.jx = p.jx === true;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  var game = null;

  function loadSession() {
    try {
      var g = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validGame(g)) return g;
    } catch (e) {}
    return null;
  }
  function saveSession() {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(game)); } catch (e) {}
  }

  // ---------- 6. Game flow ----------
  var aiTimer = null, showTimer = null, flashTimer = null;
  var disp = null;          // a card on show: { g (before advance), table, ev }
  var lastPlay = 0;         // when you last played (double tap guard)
  var focusIdx = -1;        // hand card to focus after a render (keyboard)

  function rules() { return { lv: prefs.lv, tgt: prefs.tgt, hs: prefs.hs, jx: prefs.jx }; }
  function freshDeck() { return CK.shuffle(CK.newDeck()); }

  function cancelTimers() {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
    disp = null;
  }

  function inProgress() {
    return !!(game && game.phase !== "over" &&
      (game.dn > 1 || game.won[0].length + game.won[1].length > 0 ||
       game.hands[0].length + game.hands[1].length < 2 * game.hs || game.deck.length < 52 - 2 * game.hs - TABLE_START));
  }

  // A match under way is never lost silently: Undo toast (R14).
  function newGame() {
    var prev = inProgress() ? cloneG(game) : null;
    var prevLv = prefs.lv;
    cancelTimers();
    closeDialogs();
    game = newMatch(rules(), freshDeck(), CK.randInt);
    saveSession();
    renderAll();
    if (prev) {
      undoToast(t("toast.newmatch"), function () {
        cancelTimers();
        closeDialogs();
        game = prev;
        prefs.lv = prevLv;
        savePrefs();
        saveSession();
        renderAll();
        resumeFlow();
      });
    }
    live(t(game.lead === 0 ? "live.dealYou" : "live.dealAi", { n: game.dn }));
    resumeFlow();
  }

  function myTurn() { return game && game.phase === "play" && game.turn === 0 && !disp; }

  // A tap, drag or key on hand card idx.
  function humanPlay(idx) {
    if (!game) return;
    if (game.phase === "end") { showToast(t("toast.end")); return; }          // R28
    if (game.phase === "over") { showToast(t("toast.over")); return; }
    if (disp || game.turn !== 0) { showToast(t("toast.wait")); return; }
    if (!(idx >= 0 && idx < game.hands[0].length)) { showToast(t("toast.nokey", { n: idx + 1 })); return; }
    lastPlay = Date.now();
    doPlay(0, idx);
  }

  function doPlay(who, idx) {
    var before = game;
    var r = playCard(before, who, idx);
    var next = advance(r.g);
    game = next;
    if (next.phase !== "play") record(next);
    saveSession();
    disp = { g: r.g, table: before.table.concat([r.ev.card]), ev: r.ev };
    if (who === 0) focusIdx = Math.min(idx, r.g.hands[0].length - 1);
    sfx("card");
    var msg = t(who === 0 ? (r.ev.cap ? "live.youCap" : "live.you") : (r.ev.cap ? "live.aiCap" : "live.ai"),
      { c: CK.cardName(r.ev.card, LANG), n: r.ev.cap });
    if (r.ev.xeri) msg += ". " + t("live.xeri", { p: r.ev.xeri });
    live(msg);
    renderAll();
    if (r.ev.xeri) flash(t("flash.xeri") + " +" + r.ev.xeri);
    var rm = reducedMotion();
    showTimer = setTimeout(function () {
      if (!r.ev.cap) { endShow(r.g); return; }
      if (rm) { endShow(r.g); return; }
      [].forEach.call($("table").querySelectorAll(".ock-card"), function (n) { n.classList.add("take-" + who); });
      showTimer = setTimeout(function () { endShow(r.g); }, TAKE_MS);
    }, r.ev.cap ? SHOW_MS : 180);
  }

  function endShow(mid) {
    showTimer = null;
    disp = null;
    renderAll();
    if (game.phase === "play") {
      if (mid.deck.length !== game.deck.length) live(t("live.refill", { n: game.deck.length }));
      resumeFlow();
      return;
    }
    if (mid.table.length) live(t(mid.last === 1 || (mid.last < 0 && mid.lead === 0) ? "live.lastAi" : "live.lastYou"));
    showTimer = setTimeout(function () { showTimer = null; dealDialog(); }, 350);
  }

  // Whatever the state asks for next: the computer's card, or a dialog.
  function resumeFlow() {
    if (!game || disp) return;
    if (game.phase === "play" && game.turn === 1 && !aiTimer) {
      aiTimer = setTimeout(function () {
        aiTimer = null;
        if (!game || disp || game.phase !== "play" || game.turn !== 1) return;
        var i = chooseCard(aiView(game, 1), game.lv, CK.randInt);
        if (i >= 0) doPlay(1, i);
      }, AI_DELAY);
    }
  }

  function goNextDeal() {
    if (!game) return;
    if (game.phase === "over") { newGame(); return; }
    if (game.phase !== "end") return;
    cancelTimers();
    closeDialogs();
    game = nextDeal(game, freshDeck(), CK.randInt);
    saveSession();
    focusIdx = -1;
    renderAll();
    live(t(game.lead === 0 ? "live.dealYou" : "live.dealAi", { n: game.dn }));
    resumeFlow();
  }

  // ---------- 7. Render ----------
  function cur() { return disp ? disp.g : game; }
  function tableNow() { return disp ? disp.table : game.table; }

  function renderAll() {
    renderToolbar();
    renderStatus();
    renderBoard();
  }

  function renderToolbar() {
    var lv = game ? game.lv : prefs.lv;
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      var on = b.getAttribute("data-level") === lv;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    paintSfxBtn();
  }

  function renderStatus() {
    if (!game) return;
    var g = cur();
    $("name0").textContent = t("side.you");
    $("name1").textContent = t("side.ai");
    $("score0").textContent = String(g.sc[0]);
    $("score1").textContent = String(g.sc[1]);
    var txt, w = g.phase === "over" ? matchWinner(g) : -1;
    if (g.phase === "over") txt = t(w === 0 ? "turn.won" : (w === 1 ? "turn.lost" : "turn.draw"));
    else if (g.phase === "end") txt = t("turn.end");
    else txt = t(g.turn === 0 ? "turn.you" : "turn.ai");
    $("turn").textContent = txt;
    $("turn").className = g.phase === "over" ? "done" : "";
    $("side0").classList.toggle("turn", g.phase === "play" && g.turn === 0);
    $("side1").classList.toggle("turn", g.phase === "play" && g.turn === 1);
  }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  // Card width from the room: six cards across (overlapping on a phone),
  // three rows of cards down (the computer's at 60 %).
  function layout() {
    var wrap = $("board-wrap"), board = $("board");
    var W = wrap.clientWidth, H = wrap.clientHeight;
    if (W <= 0 || H <= 0) return;
    var n = game ? game.hs : 6, side = W < 480 ? 12 : 24;
    var room = W - 2 * side;
    var w = (room - (n - 1) * 8) / n;
    if (w < 64) w = room / (n - (n - 1) * 0.2);        // overlap by a fifth
    w = Math.floor(Math.max(40, Math.min(w, 112, (H - 112) / 3.45)));
    var gap = Math.min(8, Math.floor((room - n * w) / (n - 1)));
    board.style.setProperty("--cw", w + "px");
    board.style.setProperty("--gap", gap + "px");
    board.classList.toggle("ock-roomy", w >= 72);
  }

  function badge(text) {
    var b = document.createElement("span");
    b.className = "count";
    b.textContent = text;
    return b;
  }

  function renderBoard() {
    if (!game) return;
    var g = cur(), table = tableNow(), mine = myTurn();
    layout();

    // the computer's hand: backs only
    var opp = $("opp-hand");
    opp.textContent = "";
    g.hands[1].forEach(function () { opp.appendChild(CK.cardEl(0, { faceUp: false })); });   // backs carry no card
    opp.setAttribute("role", "img");
    opp.setAttribute("aria-label", t("opp.label", { n: g.hands[1].length }));

    // deck
    var deck = $("deck");
    deck.textContent = "";
    deck.classList.toggle("empty", !g.deck.length);
    if (g.deck.length) {
      var back = CK.cardEl(0, { faceUp: false });
      back.appendChild(badge(String(g.deck.length)));
      deck.appendChild(back);
    }
    deck.setAttribute("role", "img");
    deck.setAttribute("aria-label", g.deck.length ? t("deck.label", { n: g.deck.length }) : t("deck.empty"));

    // table: the top card and up to three under it, slightly offset
    var tb = $("table");
    tb.textContent = "";
    var from = Math.max(0, table.length - 4);
    for (var i = from; i < table.length; i++) {
      var el = CK.cardEl(table[i], { faceUp: true });
      el.style.setProperty("--k", String(i - from));
      if (disp && i === table.length - 1) el.classList.add("in-" + disp.ev.who);
      tb.appendChild(el);
    }
    if (table.length) tb.appendChild(badge(String(table.length)));
    tb.classList.toggle("empty", !table.length);
    tb.setAttribute("role", "img");
    tb.setAttribute("aria-label", !table.length ? t("table.empty")
      : table.length === 1 ? t("table.one", { c: CK.cardName(table[0], LANG) })
      : t("table.label", { n: table.length, c: CK.cardName(table[table.length - 1], LANG) }));

    // your hand
    var hand = $("my-hand"), active = document.activeElement, hadFocus = hand.contains(active);
    var want = focusIdx >= 0 ? focusIdx : (hadFocus && active.hasAttribute("data-i") ? +active.getAttribute("data-i") : -1);
    hand.textContent = "";
    hand.setAttribute("aria-label", t("hand.label"));
    hand.classList.toggle("wait", !mine);
    g.hands[0].forEach(function (c, k) {
      var e = CK.cardEl(c, { faceUp: true });
      e.setAttribute("data-i", String(k));
      e.setAttribute("role", "button");
      e.tabIndex = 0;
      e.setAttribute("aria-label", t("hand.card", { k: k + 1, c: CK.cardName(c, LANG) }));
      if (!mine) e.setAttribute("aria-disabled", "true");
      var key = document.createElement("span");
      key.className = "key";
      key.setAttribute("aria-hidden", "true");
      key.textContent = String(k + 1);
      e.appendChild(key);
      hand.appendChild(e);
    });
    if (want >= 0 && hand.children.length && (hadFocus || !active || active === document.body)) {
      hand.children[Math.min(want, hand.children.length - 1)].focus();
    }
    focusIdx = -1;

    // side lines: cards captured, xeri
    [0, 1].forEach(function (p) {
      var box = $("info" + p), x = g.xr[p][0] + g.xr[p][1];
      box.textContent = "";
      var a = document.createElement("span");
      a.textContent = t("info.cards", { n: g.won[p].length });
      box.appendChild(a);
      var b = document.createElement("span");
      b.textContent = t("info.xeri", { n: x });
      if (x) b.className = "hot";
      box.appendChild(b);
      if (g.xr[p][1]) {
        var j = document.createElement("span");
        j.className = "hot";
        j.textContent = t("info.jx", { n: g.xr[p][1] });
        box.appendChild(j);
      }
    });

    $("deal-no").textContent = t("info.deal", { n: g.dn });
    $("target").textContent = g.tgt ? t("info.to", { n: g.tgt }) : t("info.one");
    var nb = $("next-btn");
    nb.hidden = g.phase === "play" || !!disp;
    nb.textContent = t(g.phase === "over" ? "btn.result" : "btn.next");
  }

  function flash(text) {
    var f = $("flash");
    f.textContent = text;
    f.hidden = false;
    f.classList.remove("go");
    void f.offsetWidth;
    f.classList.add("go");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { f.hidden = true; f.classList.remove("go"); }, 1300);
  }

  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 8. Dialogs ----------
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
  function closeDialogs() {
    [].forEach.call(document.querySelectorAll("dialog[open]"), function (d) { d.close(); });
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
  function seg(options, value, onPick) {
    var s = el("div", "seg");
    s.setAttribute("role", "group");
    options.forEach(function (o) {
      var b = el("button", "seg-btn", o[1]);
      b.type = "button";
      var on = o[0] === value;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.addEventListener("click", function () {
        [].forEach.call(s.children, function (x) { x.classList.remove("active"); x.setAttribute("aria-pressed", "false"); });
        b.classList.add("active");
        b.setAttribute("aria-pressed", "true");
        onPick(o[0]);
      });
      s.appendChild(b);
    });
    return s;
  }
  function optRow(label, s) {
    var r = el("div", "opt-row");
    r.appendChild(el("div", "dlg-sub", label));
    r.appendChild(s);
    return r;
  }

  function optionsDialog() {
    var dlg = makeDialog("xr-opts");
    var changed = false;
    function pick(k) { return function (v) { prefs[k] = v; savePrefs(); changed = true; }; }
    dlg.appendChild(el("div", "dlg-title", t("opt.title")));
    dlg.appendChild(el("div", "dlg-msg small", t("opt.help")));
    dlg.appendChild(optRow(t("opt.target"), seg([[51, t("opt.t51")], [101, t("opt.t101")], [0, t("opt.t0")]], prefs.tgt, pick("tgt"))));
    dlg.appendChild(optRow(t("opt.hand"), seg([[6, "6"], [4, "4"]], prefs.hs, pick("hs"))));
    dlg.appendChild(optRow(t("opt.jx"), seg([[false, t("opt.jxNo")], [true, t("opt.jxYes")]], prefs.jx, pick("jx"))));
    dlg.appendChild(el("div", "dlg-note", t("opt.note")));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("opt.now"), "", function () { changed = false; dlg.close(); newGame(); }));
    var close = button(t("opt.close"), "primary", function () { dlg.close(); });
    acts.appendChild(close);
    dlg.appendChild(acts);
    dlg.addEventListener("close", function () {
      if (!changed || !game) return;
      if (inProgress()) showToast(t("toast.rules"));
      else if (game.phase === "play") newGame();     // nothing played yet: the new rules at once
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    close.focus();
  }

  // The deal's points side by side; at the end of a match it leads on
  // to the match result.
  function dealDialog() {
    if (!game || game.phase === "play") return;
    var g = game, s = dealScore(g), over = g.phase === "over";
    var dlg = makeDialog("xr-deal");
    dlg.appendChild(el("div", "dlg-title", t("bd.title", { n: g.dn })));
    var tbl = el("table", "bd");
    var head = el("tr");
    head.appendChild(el("th", "", ""));
    head.appendChild(el("th", "", t("side.you")));
    head.appendChild(el("th", "", t("side.ai")));
    var thead = el("thead");
    thead.appendChild(head);
    tbl.appendChild(thead);
    var body = el("tbody");
    function line(label, a, b, cls) {
      var tr = el("tr", cls || "");
      tr.appendChild(el("th", "", label));
      tr.appendChild(el("td", "", String(a)));
      tr.appendChild(el("td", "", String(b)));
      body.appendChild(tr);
    }
    line(t("bd.cards"), s[0].cards, s[1].cards, "dim");
    line(t("bd.most"), s[0].most, s[1].most);
    line(t("bd.figs"), s[0].figs, s[1].figs);
    line(t("bd.td"), s[0].td, s[1].td);
    line(t("bd.tc"), s[0].tc, s[1].tc);
    line(t("bd.xeri"), xeriText(s[0]), xeriText(s[1]));
    line(t("bd.total"), s[0].total, s[1].total, "sum");
    line(t("bd.match"), g.sc[0], g.sc[1], "sum");
    tbl.appendChild(body);
    dlg.appendChild(tbl);
    if (s[0].cards === s[1].cards) dlg.appendChild(el("div", "dlg-note", t("bd.tie")));
    if (!over && g.tgt) dlg.appendChild(el("div", "dlg-note", t("bd.goal", { n: g.tgt })));
    var acts = el("div", "dlg-actions");
    var go = button(t(over ? "btn.result" : "btn.next"), "primary", function () {
      dlg.close();
      if (over) resultDialog(); else goNextDeal();
    });
    acts.appendChild(go);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    go.focus();
  }
  function xeriText(s) {
    if (!s.xeri) return "0";
    var parts = [];
    if (s.x10) parts.push(s.x10 + "×10");
    if (s.x20) parts.push(s.x20 + "×20");
    return s.xeri + " (" + parts.join(" + ") + ")";
  }

  function resultDialog() {
    if (!game || game.phase !== "over") return;
    var g = game, w = matchWinner(g);
    var dlg = makeDialog("xr-result");
    dlg.appendChild(el("div", "dlg-title", t("res.title") + " · " + t("level." + g.lv)));
    dlg.appendChild(el("div", "dlg-hero", t(w === 0 ? "res.win" : (w === 1 ? "res.lose" : "res.draw"))));
    dlg.appendChild(row(t("res.score"), g.sc[0] + " – " + g.sc[1]));
    dlg.appendChild(row(t("res.deals"), g.log.map(function (d) { return d[0] + "–" + d[1]; }).join(" · ")));
    var tt = totals(data, g.lv);
    dlg.appendChild(row(t("stats.matches"), tt[0] + " · " + tt[1]));
    dlg.appendChild(row(t("stats.best"), String(tt[4])));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("res.close"), "", function () { dlg.close(); }));
    var again = button(t("btn.again"), "primary", function () { dlg.close(); newGame(); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    again.focus();
  }

  function statsDialog() {
    var dlg = makeDialog("xr-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    var empty = true;
    LEVELS.forEach(function (lv) {
      var s = totals(data, lv);
      if (s[0] || s[2] || s[3] || s[4]) empty = false;
      dlg.appendChild(el("div", "dlg-sub", t("level." + lv)));
      dlg.appendChild(row(t("stats.matches"), s[0] + " · " + s[1] + (s[0] ? " (" + Math.round(100 * s[1] / s[0]) + "%)" : "")));
      dlg.appendChild(row(t("stats.xeri"), s[2] + " · " + s[3]));
      dlg.appendChild(row(t("stats.best"), String(s[4])));
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
    var dlg = makeDialog("xr-confirm");
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
    data = mergeXeri(data, data);
    save();
    showToast(t("toast.reset"));
  }

  // ---------- 9. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "xeri", title: String(text) })) return;
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

  // ---------- 10. Sound ----------
  // Off by default; when on, a soft "tak" for every card on the table.
  var audio = null;
  function sfxOn() {
    try { return localStorage.getItem(SFX_KEY) === "1"; } catch (e) { return false; }
  }
  function sfx() {
    if (!sfxOn()) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio) audio = new AC();
      if (audio.state === "suspended") audio.resume();
      var len = Math.floor(audio.sampleRate * 0.03), buf = audio.createBuffer(1, len, audio.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      var src = audio.createBufferSource(), f = audio.createBiquadFilter(), g = audio.createGain();
      src.buffer = buf;
      f.type = "bandpass"; f.frequency.value = 1800; f.Q.value = 0.8;
      g.gain.value = 0.35;
      src.connect(f); f.connect(g); g.connect(audio.destination);
      src.start();
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Toolbar icons (R9: injected by JS) ----------
  var UI_ICONS = {
    opts:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
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

  // ---------- 11. Input ----------
  var dragCtl = null;

  function overTable(rect) {
    var z = $("mid-zone").getBoundingClientRect();
    return rect.left < z.right && rect.right > z.left && rect.top < z.bottom && rect.bottom > z.top;
  }

  function wireBoard() {
    var hand = $("my-hand");
    dragCtl = CK.dragHelper(hand, {
      selector: ".ock-card[data-i]",
      pick: function (node) {
        var i = +node.getAttribute("data-i");
        return { data: i, els: myTurn() ? [node] : [] };          // not your turn: tap only (it explains)
      },
      tap: function (i, count) {
        if (count === 2 && Date.now() - lastPlay < 700) return;  // the first tap already played
        humanPlay(i);
      },
      over: function (i, rect) { $("mid-zone").classList.toggle("drop-ok", overTable(rect)); },
      drop: function (i, rect) {
        $("mid-zone").classList.remove("drop-ok");
        if (!overTable(rect) || !myTurn()) return false;
        lastPlay = Date.now();
        doPlay(0, i);
        return true;
      },
      end: function () { $("mid-zone").classList.remove("drop-ok"); }
    });
    hand.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var n = e.target && e.target.closest && e.target.closest(".ock-card[data-i]");
      if (!n) return;
      e.preventDefault();
      focusIdx = +n.getAttribute("data-i");
      humanPlay(focusIdx);
    });
  }

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey || e.repeat) return;   // never steal OS combos
      if (e.code === "KeyN") { e.preventDefault(); newGame(); return; }
      var m = /^(?:Digit|Numpad)([1-6])$/.exec(e.code);
      if (m) {
        e.preventDefault();
        var inHand = $("my-hand").contains(document.activeElement);
        if (inHand) focusIdx = +m[1] - 1;
        humanPlay(+m[1] - 1);
        return;
      }
      var onCard = document.activeElement && document.activeElement.closest &&
                   document.activeElement.closest("#my-hand .ock-card");
      if (onCard && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        var sib = e.key === "ArrowLeft" ? onCard.previousElementSibling : onCard.nextElementSibling;
        if (sib) sib.focus();
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
    api.registerSlice("xeri", sliceGet, sliceSet, STORAGE_KEY, mergeXeri);
  }

  function sliceGet() {
    return mergeXeri(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeXeri(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    // no toast, no re-render of the table (sync feedback = taskbar dot)
  }

  // ---------- 13. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
  }

  function paintStatic() {
    [["opts-btn", "opts", "btn.opts"], ["new-btn", "new", "btn.new"],
     ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    paintSfxBtn();
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#level-seg .seg-btn"), function (b) {
      b.addEventListener("click", function () {
        var lv = b.getAttribute("data-level");
        if (game && lv === game.lv && game.phase !== "over") return;   // visible active state
        prefs.lv = lv;
        savePrefs();
        newGame();
      });
    });
    $("opts-btn").addEventListener("click", optionsDialog);
    $("new-btn").addEventListener("click", function () { newGame(); $("new-btn").blur(); });
    $("stats-btn").addEventListener("click", statsDialog);
    $("next-btn").addEventListener("click", function () {
      if (game && game.phase === "over") resultDialog(); else goNextDeal();
    });
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx();   // audible confirmation when turned on
    });
    wireBoard();
    wireKeyboard();

    var relayout = function () {
      if (dragCtl) dragCtl.cancel();
      layout();
    };
    if (window.ResizeObserver) new ResizeObserver(relayout).observe($("board-wrap"));
    else window.addEventListener("resize", relayout);
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
      prefs.lv = game.lv;                    // the resumed match decides the level shown
      savePrefs();
    } else {
      game = newMatch(rules(), freshDeck(), CK.randInt);
      saveSession();
    }
    renderAll();
    if (game.phase !== "play") dealDialog();
    else resumeFlow();                       // a match left on the computer's turn continues
  }

  boot();
})();
