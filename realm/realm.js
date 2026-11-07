// ============================================================
// orOS Realm — App logic (v1.0.0)
// A turn-based territory game on a hex island: regions with a
// treasury, units of four tiers that merge, Watchtowers, Forts and
// Mills, upkeep that ruins a realm grown too fast, Thicket on
// neglected land. The rules live in realm/engine.js (RealmEngine,
// tested headless); this file is the screen.
//   - vs Computer (1-5 sides, Easy / Medium / Hard) and hot-seat for
//     up to 6 people on one device, in any mix
//   - island sizes Small / Medium / Large from a seed; "Same island
//     again" replays one
//   - pan (drag), zoom (pinch, wheel, + / −), keyboard cursor
//   - undo inside your turn; computer turns animated (skippable)
//   - a short "How to play" on the first game
// Data:
//   - synced slice "realm" (oros-realm-data): results vs the computer
//     per level and island size as per-device counter rows (each
//     device only grows its own row; merge = per-row max, a join) +
//     reset stamp br (same pattern as Reversi)
//   - device-local (R10): oros-realm-prefs (new-game options, fast
//     turns, tour seen), oros-realm-session (the game in progress and
//     the undo steps of the current turn), oros-realm-device (counter
//     row id), oros-realm-sfx (sound on/off)
// Sections:
//   1. Constants, i18n, helpers
//   2. Synced records: load / save / normalize / merge (R5, R26)
//   3. Device-local prefs + session
//   4. Game flow (new, act, undo, end turn, computer, finish)
//   5. Map view (geometry, pan / zoom, drawing)
//   6. Input (tap, drag, pinch, wheel, keyboard)
//   7. Panels (toolbar, status, buy bar)
//   8. Dialogs (new game, result, records, confirm, pass, surrender, tour)
//   9. Toasts
//  10. Sound
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var E = window.RealmEngine;
  var O = E.O;

  var STORAGE_KEY = "oros-realm-data";
  var PREFS_KEY   = "oros-realm-prefs";
  var SESSION_KEY = "oros-realm-session";
  var DEVICE_KEY  = "oros-realm-device";
  var SFX_KEY     = "oros-realm-sfx";
  var DATA_VER    = 1;

  var LEVELS = E.LEVELS;               // e, m, h
  var SIZES = ["s", "m", "l"];
  var KINDS = E.KINDS;                 // u1..u4, tower, fort, mill
  var UNDO_MAX = 40;
  var AI_STEP_MS = 260;                // one computer action, animated
  // Okabe-Ito colours (colour-blind safe), one per side, plus a mark
  // per side so the sides also read in greyscale.
  var SIDE_COLORS = ["#0072B2", "#E69F00", "#009E73", "#D55E00", "#CC79A7", "#56B4E9"];

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = window.orosI18n ? window.orosI18n.lang() : appLang();

  var STRINGS = {
    en: {
      "app.name": "Realm",
      "btn.new": "New game (N)", "btn.undo": "Undo (Z)", "btn.undoNone": "Nothing to undo in this turn",
      "btn.end": "End turn", "btn.endKey": "End turn (E)",
      "btn.stats": "Records", "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "btn.zoomIn": "Zoom in (+)", "btn.zoomOut": "Zoom out (−)", "btn.center": "Show my land",
      "map.label": "Island map. Arrow keys move the cursor, Enter acts, 1 to 7 buy.",
      "color.0": "Blue", "color.1": "Orange", "color.2": "Green", "color.3": "Red", "color.4": "Pink", "color.5": "Sky",
      "side.you": "You", "side.ai": "Computer ({color})", "side.person": "{color}",
      "turn.you": "Your turn", "turn.ai": "{who} is playing…", "turn.person": "{who}'s turn",
      "turn.round": "Round {n}",
      "turn.over": "Game over",
      "reg.gold": "Gold {g}", "reg.net": "{net} per turn", "reg.none": "Tap your land",
      "reg.lone": "A lone cell has no treasury",
      "kind.u1": "Militia", "kind.u2": "Pikeman", "kind.u3": "Rider", "kind.u4": "Champion",
      "kind.tower": "Watchtower", "kind.fort": "Fort", "kind.mill": "Mill",
      "kind.hall": "Hall", "kind.thicket": "Thicket", "kind.ruin": "Ruin",
      "buy.label": "{kind}, {cost} gold",
      "buy.pick": "{kind}: tap a lit cell",
      "cell.water": "Sea", "cell.free": "Free land", "cell.of": "{who}'s land",
      "cell.guard": "guard {n}",
      "live.move": "{who}: {kind} moved", "live.take": "{who}: {kind} took a cell",
      "live.buy": "{who}: bought {kind}", "live.turn": "Round {n}: {who}",
      "live.out": "{who} is out",
      "res.title": "Game over", "res.youwin": "You rule the island!", "res.ailose": "The computer won",
      "res.pwin": "{who} wins!", "res.lost": "Your realm has fallen",
      "res.rounds": "Rounds", "res.again": "New game", "res.same": "Same island again", "res.close": "Close",
      "new.title": "New game", "new.size": "Island", "new.size.s": "Small", "new.size.m": "Medium", "new.size.l": "Large",
      "new.people": "People", "new.comps": "Computer sides", "new.level": "Computer level",
      "new.seed": "Island code (empty = a new island)", "new.fast": "Fast computer turns",
      "new.start": "Start", "new.cancel": "Cancel", "new.count": "2 to 6 sides in all",
      "level.e": "Easy", "level.m": "Medium", "level.h": "Hard",
      "stats.title": "Records vs computer", "stats.head": "Won · lost", "stats.reset": "Reset records",
      "stats.close": "Close", "stats.code": "This island's code: {seed}",
      "confirm.reset": "Delete the records vs the computer on every device?",
      "confirm.yes": "Reset", "confirm.no": "Cancel",
      "pass.title": "Pass the device", "pass.msg": "{who}, it is your turn.", "pass.go": "Start my turn",
      "sur.title": "The computer gives up", "sur.msg": "You hold {p}% of the island. Accept the surrender and win?",
      "sur.yes": "Accept", "sur.no": "Play on",
      "tour.title": "How to play", "tour.next": "Next", "tour.skip": "Skip", "tour.done": "Play",
      "tour.1": "Your land is blue. Each region of your land has a Hall with its treasury. Every turn a region earns 1 gold per cell, and 4 more per Mill.",
      "tour.2": "Buy units at the bottom: Militia, Pikeman, Rider, Champion. Each one costs gold every turn (upkeep). If a region cannot pay, all its units desert.",
      "tour.3": "Tap a unit, then a lit cell. A unit walks up to 4 cells inside its region and then takes a cell next to it. Put two units together to make a stronger one.",
      "tour.4": "A cell is guarded by the strongest unit or building on it and next to it. To take it you need a stronger unit. Watchtowers (2) and Forts (3) guard your border.",
      "tour.5": "Thicket grows on land nobody looks after and earns nothing. Take every enemy region to win. Tap End turn when you are done.",
      "toast.reset": "Records reset", "toast.newgame": "New game started", "toast.undo": "Undo",
      "toast.save": "Could not save: storage is full",
      "toast.wait": "The computer is playing",
      "toast.over": "The game is over: start a new one (N)",
      "toast.cant": "You can't place that there",
      "toast.poor": "Not enough gold in this region",
      "toast.noCell": "No cell for that in this region",
      "toast.done": "This unit has already acted",
      "toast.noMove": "It can't go there",
      "toast.desert": "Units deserted: a region could not pay its upkeep"
    },
    el: {
      "app.name": "Επικράτεια",
      "btn.new": "Νέο παιχνίδι (N)", "btn.undo": "Αναίρεση (Z)", "btn.undoNone": "Τίποτα για αναίρεση σε αυτόν τον γύρο",
      "btn.end": "Τέλος γύρου", "btn.endKey": "Τέλος γύρου (E)",
      "btn.stats": "Ρεκόρ", "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "btn.zoomIn": "Μεγέθυνση (+)", "btn.zoomOut": "Σμίκρυνση (−)", "btn.center": "Δείξε τα εδάφη μου",
      "map.label": "Χάρτης του νησιού. Τα βέλη μετακινούν τον δείκτη, το Enter κάνει την κίνηση, το 1 έως 7 αγοράζει.",
      "color.0": "Μπλε", "color.1": "Πορτοκαλί", "color.2": "Πράσινο", "color.3": "Κόκκινο", "color.4": "Ροζ", "color.5": "Γαλάζιο",
      "side.you": "Εσύ", "side.ai": "Υπολογιστής ({color})", "side.person": "{color}",
      "turn.you": "Σειρά σου", "turn.ai": "Παίζει: {who}…", "turn.person": "Σειρά: {who}",
      "turn.round": "Γύρος {n}",
      "turn.over": "Τέλος παιχνιδιού",
      "reg.gold": "Χρυσός {g}", "reg.net": "{net} τον γύρο", "reg.none": "Πάτησε στα εδάφη σου",
      "reg.lone": "Ένα μοναχικό κελί δεν έχει ταμείο",
      "kind.u1": "Πολιτοφύλακας", "kind.u2": "Λογχοφόρος", "kind.u3": "Ιππέας", "kind.u4": "Πρωταθλητής",
      "kind.tower": "Παρατηρητήριο", "kind.fort": "Φρούριο", "kind.mill": "Μύλος",
      "kind.hall": "Δημαρχείο", "kind.thicket": "Λόχμη", "kind.ruin": "Ερείπιο",
      "buy.label": "{kind}, {cost} χρυσός",
      "buy.pick": "{kind}: πάτησε ένα φωτισμένο κελί",
      "cell.water": "Θάλασσα", "cell.free": "Ελεύθερο έδαφος", "cell.of": "Έδαφος: {who}",
      "cell.guard": "φρούρηση {n}",
      "live.move": "{who}: μετακίνηση, {kind}", "live.take": "{who}: {kind}, κατάληψη κελιού",
      "live.buy": "{who}: αγορά, {kind}", "live.turn": "Γύρος {n}: {who}",
      "live.out": "Έξω από το παιχνίδι: {who}",
      "res.title": "Τέλος", "res.youwin": "Το νησί είναι δικό σου!", "res.ailose": "Κέρδισε ο υπολογιστής",
      "res.pwin": "Κέρδισε: {who}!", "res.lost": "Η επικράτειά σου έπεσε",
      "res.rounds": "Γύροι", "res.again": "Νέο παιχνίδι", "res.same": "Το ίδιο νησί ξανά", "res.close": "Κλείσιμο",
      "new.title": "Νέο παιχνίδι", "new.size": "Νησί", "new.size.s": "Μικρό", "new.size.m": "Μεσαίο", "new.size.l": "Μεγάλο",
      "new.people": "Άτομα", "new.comps": "Πλευρές υπολογιστή", "new.level": "Επίπεδο υπολογιστή",
      "new.seed": "Κωδικός νησιού (κενό = νέο νησί)", "new.fast": "Γρήγοροι γύροι υπολογιστή",
      "new.start": "Έναρξη", "new.cancel": "Άκυρο", "new.count": "Από 2 έως 6 πλευρές συνολικά",
      "level.e": "Εύκολο", "level.m": "Μεσαίο", "level.h": "Δύσκολο",
      "stats.title": "Ρεκόρ με υπολογιστή", "stats.head": "Νίκες · ήττες", "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο", "stats.code": "Κωδικός αυτού του νησιού: {seed}",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ με τον υπολογιστή σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός", "confirm.no": "Άκυρο",
      "pass.title": "Δώσε τη συσκευή", "pass.msg": "Σειρά σου: {who}.", "pass.go": "Ξεκινάω τον γύρο μου",
      "sur.title": "Ο υπολογιστής παραδίδεται", "sur.msg": "Κρατάς το {p}% του νησιού. Δέχεσαι την παράδοση και κερδίζεις;",
      "sur.yes": "Δέχομαι", "sur.no": "Συνεχίζω",
      "tour.title": "Πώς παίζεται", "tour.next": "Επόμενο", "tour.skip": "Παράλειψη", "tour.done": "Παίζω",
      "tour.1": "Τα εδάφη σου είναι μπλε. Κάθε περιοχή σου έχει ένα Δημαρχείο με το ταμείο της. Κάθε γύρο μια περιοχή κερδίζει 1 χρυσό ανά κελί και 4 ακόμα ανά Μύλο.",
      "tour.2": "Αγοράζεις μονάδες από κάτω: Πολιτοφύλακα, Λογχοφόρο, Ιππέα, Πρωταθλητή. Η καθεμία κοστίζει χρυσό κάθε γύρο (συντήρηση). Αν μια περιοχή δεν μπορεί να πληρώσει, όλες οι μονάδες της λιποτακτούν.",
      "tour.3": "Πάτησε μια μονάδα και μετά ένα φωτισμένο κελί. Μια μονάδα περπατά έως 4 κελιά μέσα στην περιοχή της και μετά πιάνει ένα κελί δίπλα. Βάλε δύο μονάδες μαζί για να φτιάξεις μια πιο δυνατή.",
      "tour.4": "Ένα κελί το φρουρεί η πιο δυνατή μονάδα ή το πιο δυνατό κτίριο πάνω του και δίπλα του. Για να το πάρεις χρειάζεσαι πιο δυνατή μονάδα. Τα Παρατηρητήρια (2) και τα Φρούρια (3) φυλάνε τα σύνορά σου.",
      "tour.5": "Η λόχμη φυτρώνει σε έδαφος που δεν το φροντίζει κανείς και δεν αποδίδει τίποτα. Πάρε όλες τις περιοχές των αντιπάλων για να νικήσεις. Πάτησε Τέλος γύρου όταν τελειώσεις.",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν", "toast.newgame": "Ξεκίνησε νέο παιχνίδι", "toast.undo": "Αναίρεση",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "toast.wait": "Παίζει ο υπολογιστής",
      "toast.over": "Το παιχνίδι τελείωσε: ξεκίνα νέο (N)",
      "toast.cant": "Δεν μπαίνει εκεί",
      "toast.poor": "Δεν φτάνει ο χρυσός αυτής της περιοχής",
      "toast.noCell": "Δεν υπάρχει κελί γι' αυτό σε αυτή την περιοχή",
      "toast.done": "Αυτή η μονάδα έπαιξε ήδη",
      "toast.noMove": "Δεν μπορεί να πάει εκεί",
      "toast.desert": "Λιποτάκτησαν μονάδες: μια περιοχή δεν πλήρωσε τη συντήρηση"
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "realm", LANG);

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
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // A new island code: 6 letters and digits, easy to read aloud.
  function newSeed() {
    var abc = "abcdefghjkmnpqrstuvwxyz23456789", buf = new Uint32Array(6), s = "";
    crypto.getRandomValues(buf);
    for (var i = 0; i < 6; i++) s += abc.charAt(buf[i] % abc.length);
    return s;
  }
  function cleanSeed(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("realm.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Synced records ----------
  // data = { ver, br, rows: { <device id>: { b, s: { "<lv>:<size>": [won, lost] } } } }
  // Each device only grows its own row, so a per-row max is a join and
  // nothing is double-counted however the devices meet.
  var data = null;
  var deviceId = null;
  var REC_KEYS = [];
  LEVELS.forEach(function (lv) { SIZES.forEach(function (sz) { REC_KEYS.push(lv + ":" + sz); }); });

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normRow(row) {
    if (!row || typeof row !== "object" || !isInt(row.b) || row.b < 0) return null;
    var s = {}, any = false;
    REC_KEYS.forEach(function (k) {
      var v = row.s && row.s[k];
      if (Array.isArray(v) && v.length === 2 && isInt(v[0]) && isInt(v[1]) && v[0] >= 0 && v[1] >= 0) {
        s[k] = [v[0], v[1]];
        any = true;
      }
    });
    return any ? { b: row.b, s: s } : null;
  }
  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var s = {};
    REC_KEYS.forEach(function (k) {
      var a = x.s[k], c = y.s[k];
      if (!a && !c) return;
      if (!a) { s[k] = c.slice(); return; }
      if (!c) { s[k] = a.slice(); return; }
      s[k] = [Math.max(a[0], c[0]), Math.max(a[1], c[1])];
    });
    return { b: x.b, s: s };
  }
  function mergeRealm(A, B) {
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
      REC_KEYS.forEach(function (k) { if (r.s[k]) s[k] = r.s[k].slice(); });
      sorted[id] = { b: r.b, s: s };
    });
    return { ver: DATA_VER, br: br, rows: sorted };
  }
  // Totals for a level (all sizes, or one): [won, lost].
  function totals(lv, sz) {
    var out = [0, 0];
    Object.keys(data.rows).forEach(function (id) {
      SIZES.forEach(function (s) {
        if (sz && s !== sz) return;
        var v = data.rows[id].s[lv + ":" + s];
        if (v) { out[0] += v[0]; out[1] += v[1]; }
      });
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
          data = mergeRealm(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.warn("[orOS] realm: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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
  // res: 0 = won, 1 = lost
  function countResult(lv, sz, res) {
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };
    var k = lv + ":" + sz;
    var v = row.s[k] ? row.s[k].slice() : [0, 0];
    v[res]++;
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    row.s[k] = v;
    data.rows[deviceId] = row;
    data = mergeRealm(data, data);
    save();
  }

  // ---------- 3. Device-local prefs + session ----------
  var prefs = { size: "s", people: 1, comps: 2, lv: "m", fast: false, tour: false };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (SIZES.indexOf(p.size) >= 0) prefs.size = p.size;
        if (LEVELS.indexOf(p.lv) >= 0) prefs.lv = p.lv;
        if (isInt(p.people) && p.people >= 1 && p.people <= 6) prefs.people = p.people;
        if (isInt(p.comps) && p.comps >= 0 && p.comps <= 5) prefs.comps = p.comps;
        if (prefs.people + prefs.comps < 2 || prefs.people + prefs.comps > 6) { prefs.people = 1; prefs.comps = 2; }
        prefs.fast = p.fast === true;
        prefs.tour = p.tour === true;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = {
  //   g: engine state,
  //   u: [engine state…]   undo steps of the current turn (≤ 40)
  //   opts: { size, people, comps, lv, seed },
  //   done: bool           the game is over for this device's records
  // }
  var game = null;

  function validSession(s) {
    if (!s || typeof s !== "object" || !E.valid(s.g) || !Array.isArray(s.u) || s.u.length > UNDO_MAX) return false;
    var o = s.opts;
    if (!o || SIZES.indexOf(o.size) < 0 || LEVELS.indexOf(o.lv) < 0 || typeof o.seed !== "string" ||
        !isInt(o.people) || !isInt(o.comps) || o.people < 1 || o.people + o.comps > 6 || o.people + o.comps < 2) return false;
    if (s.g.sides.length !== o.people + o.comps) return false;
    for (var i = 0; i < s.u.length; i++) if (!E.valid(s.u[i])) return false;
    return true;
  }
  function loadSession() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(s)) { s.done = s.done === true; return s; }
    } catch (e) {}
    return null;
  }
  var sessionFailShown = false;
  function saveSession() {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(game));
      sessionFailShown = false;
    } catch (e) {
      if (!sessionFailShown) { sessionFailShown = true; showToast(t("toast.save")); }
    }
  }

  // ---------- 4. Game flow ----------
  var st = null;              // = game.g
  var sel = -1;               // selected unit cell
  var region = -1;            // a cell of the selected region (current side)
  var armed = null;           // buy kind waiting for a cell
  var lit = { walk: [], take: [], buy: [] };
  var aiTimer = null, aiPlan = null;

  function humans() {
    var n = 0;
    st.sides.forEach(function (s) { if (s.k === "h") n++; });
    return n;
  }
  function sideName(s) {
    var color = t("color." + s);
    if (st.sides[s].k === "c") return t("side.ai", { color: color });
    if (humans() === 1) return t("side.you");
    return t("side.person", { color: color });
  }
  function humanTurn() { return st && st.over < 0 && !game.done && st.sides[st.turn].k === "h"; }
  function inProgress() { return !!(game && !game.done && st.over < 0 && st.acts > 0); }

  function makeGame(opts) {
    var sides = [];
    for (var i = 0; i < opts.people; i++) sides.push({ k: "h", lv: opts.lv });
    for (var j = 0; j < opts.comps; j++) sides.push({ k: "c", lv: opts.lv });
    return { g: E.makeMap({ size: opts.size, seed: opts.seed, sides: sides }), u: [], opts: opts, done: false };
  }

  // A game in progress is never lost silently: Undo toast (R14).
  function startGame(opts) {
    var prev = inProgress() ? JSON.parse(JSON.stringify(game)) : null;
    cancelAi();
    game = makeGame(opts);
    st = game.g;
    saveSession();
    afterLoad(true);
    if (prev) {
      undoToast(t("toast.newgame"), function () {
        cancelAi();
        game = prev;
        st = game.g;
        saveSession();
        afterLoad(true);
      });
    } else live(t("toast.newgame"));
  }

  // After a new or restored game: fit the view, pick a region, go on.
  function afterLoad(fit) {
    clearSel();
    if (fit) fitView(true);
    if (humanTurn()) pickRegion();
    renderAll();
    continueFlow(false);
  }

  function clearSel() {
    sel = -1; armed = null; lit = { walk: [], take: [], buy: [] };
  }
  // The largest region of the side to move.
  function pickRegion() {
    region = -1;
    var regs = E.regions(st, st.turn).filter(function (r) { return r.length >= 2; });
    regs.sort(function (a, b) { return b.length - a.length || a[0] - b[0]; });
    if (regs.length) region = E.hallOf(st, regs[0]) >= 0 ? E.hallOf(st, regs[0]) : regs[0][0];
  }
  function regionCells() {
    if (region < 0 || st.own[region] !== st.turn) return [];
    return E.regionOf(st, region);
  }

  function pushUndo() {
    game.u.push(E.clone(st));
    if (game.u.length > UNDO_MAX) game.u.shift();
  }

  // A human taps cell i.
  function tapCell(i) {
    if (!st || i < 0) return;
    cursor = i;
    if (game.done || st.over >= 0) { showToast(t("toast.over")); return; }      // R28
    if (!humanTurn()) { skipAi(); showToast(t("toast.wait")); return; }
    var side = st.turn;
    if (armed) {
      var at = regionCells().length ? region : -1;
      if (at >= 0 && E.canBuy(st, at, armed, i)) {
        var kind = armed;
        pushUndo();
        E.buy(st, at, kind, i);
        sfx(E.isUnit(st.obj[i]) && st.own[i] === side && lit.take.indexOf(i) >= 0 ? "take" : "buy");
        live(t("live.buy", { who: sideName(side), kind: t("kind." + kind) }));
        armed = null;
        afterAction(i);
        return;
      }
      if (st.own[i] === side) { setRegion(i); armed = null; computeLit(); renderAll(); return; }
      shake(); showToast(t("toast.cant"));
      return;
    }
    if (sel >= 0) {
      if (i === sel) { sel = -1; computeLit(); renderAll(); return; }
      if (lit.walk.indexOf(i) >= 0 || lit.take.indexOf(i) >= 0) {
        var kindU = "u" + E.tierOf(st.obj[sel]);
        var took = lit.take.indexOf(i) >= 0;
        pushUndo();
        E.move(st, sel, i);
        sfx(took ? "take" : "move");
        live(t(took ? "live.take" : "live.move", { who: sideName(side), kind: t("kind." + kindU) }));
        sel = -1;
        afterAction(i);
        return;
      }
    }
    var o = st.obj[i];
    if (E.isUnit(o)) {
      if (st.own[i] !== side) { if (sel >= 0) { shake(); showToast(t("toast.noMove")); } else { describe(i); } return; }
      setRegion(i);
      if (st.done[i]) { sel = -1; computeLit(); renderAll(); showToast(t("toast.done")); return; }
      sel = i;
      computeLit();
      renderAll();
      sfx("select");
      return;
    }
    if (st.own[i] === side) { sel = -1; setRegion(i); computeLit(); renderAll(); return; }
    if (sel >= 0) { shake(); showToast(t("toast.noMove")); return; }
    describe(i);
  }
  function setRegion(i) {
    var reg = E.regionOf(st, i), h = E.hallOf(st, reg);
    region = h >= 0 ? h : i;
  }
  // Say what a cell is (R28: a tap that does nothing says why).
  function describe(i) {
    if (!st.land[i]) { live(t("cell.water")); return; }
    var parts = [];
    var who = st.own[i] >= 0 ? t("cell.of", { who: sideName(st.own[i]) }) : t("cell.free");
    parts.push(who);
    var o = st.obj[i];
    if (o) parts.push(t("kind." + objKind(o)));
    if (st.own[i] >= 0) parts.push(t("cell.guard", { n: E.defence(st, i) }));
    showToast(parts.join(" · "));
  }
  function objKind(o) {
    if (E.isUnit(o)) return "u" + E.tierOf(o);
    return { 1: "hall", 2: "tower", 3: "fort", 4: "mill", 5: "thicket", 6: "ruin" }[o] || "hall";
  }

  function afterAction(i) {
    if (st.own[i] === st.turn) setRegion(i);
    computeLit();
    saveSession();
    renderAll();
    if (st.over >= 0 || humanFallen()) { finish(); return; }
    offerSurrender();
  }

  function computeLit() {
    lit = { walk: [], take: [], buy: [] };
    if (!humanTurn()) return;
    if (sel >= 0) {
      var tg = E.targets(st, sel);
      lit.walk = tg.walk; lit.take = tg.take;
    } else if (armed && regionCells().length) {
      lit.buy = E.buyCells(st, region, armed);
      lit.take = lit.buy.filter(function (y) { return st.own[y] !== st.turn; });
    }
  }

  function canUndo() { return humanTurn() && game.u.length > 0; }
  function undo() {
    if (!canUndo()) { showToast(t("btn.undoNone")); return; }             // R28
    game.g = game.u.pop();
    st = game.g;
    clearSel();
    if (region < 0 || st.own[region] !== st.turn) pickRegion();
    saveSession();
    renderAll();
    sfx("move");
  }

  function arm(kind) {
    if (!humanTurn()) { showToast(game.done || st.over >= 0 ? t("toast.over") : t("toast.wait")); return; }
    if (armed === kind) { armed = null; computeLit(); renderAll(); return; }
    if (!regionCells().length) { showToast(t("reg.none")); return; }
    var info = E.regionInfo(st, region);
    if (info.hall < 0) { showToast(t("reg.lone")); return; }
    if (info.gold < E.costOf(kind, info)) { showToast(t("toast.poor")); return; }
    var cells = E.buyCells(st, region, kind);
    if (!cells.length) { showToast(t("toast.noCell")); return; }
    sel = -1;
    armed = kind;
    computeLit();
    renderAll();
    live(t("buy.pick", { kind: t("kind." + kind) }));
  }

  // End the human's turn, then let the flow run (computers, the next person).
  function endTurn() {
    if (!humanTurn()) { showToast(game.done || st.over >= 0 ? t("toast.over") : t("toast.wait")); return; }
    nextTurn();
  }
  function nextTurn() {
    var before = outList();
    var deserted = E.endTurn(st) && desertedNow();
    game.u = [];
    clearSel();
    announceOut(before);
    saveSession();
    if (st.over >= 0 || humanFallen()) { renderAll(); finish(); return; }
    if (humanTurn()) {
      pickRegion();
      if (deserted) showToast(t("toast.desert"));
    }
    sfx("turn");
    continueFlow(true);
  }
  function outList() { return st.sides.map(function (s) { return s.out; }); }
  function announceOut(before) {
    st.sides.forEach(function (s, k) { if (s.out && !before[k]) live(t("live.out", { who: sideName(k) })); });
  }
  // Units of the side now to move deserted at the start of its turn
  // (a Ruin on its own land can only come from that: Ruins of earlier
  // rounds have grown into Thicket).
  function desertedNow() {
    for (var i = 0; i < st.obj.length; i++) if (st.obj[i] === O.RUIN && st.own[i] === st.turn) return true;
    return false;
  }
  // The person (vs computer) or every person (hot-seat) is out.
  function humanFallen() {
    return st.over < 0 && !st.sides.some(function (s) { return s.k === "h" && !s.out; });
  }

  // What to do next: computer turn, pass screen, or wait for a person.
  function continueFlow(turnChanged) {
    renderAll();
    if (game.done || st.over >= 0) return;
    if (st.sides[st.turn].k === "c") { runAi(); return; }
    if (turnChanged && humans() > 1) { passDialog(); return; }
    if (turnChanged) { reveal(region); live(t("live.turn", { n: st.round, who: sideName(st.turn) })); }
    offerSurrender();
    maybeTour();
  }

  function cancelAi() {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    aiPlan = null;
  }
  function runAi() {
    cancelAi();
    renderStatus();
    aiTimer = setTimeout(function () {
      aiTimer = null;
      if (game.done || st.over >= 0 || st.sides[st.turn].k !== "c") return;
      aiPlan = E.planTurn(st, st.sides[st.turn].lv);
      stepAi();
    }, 40);
  }
  function stepAi() {
    if (!aiPlan) return;
    if (prefs.fast || reducedMotion()) { flushAi(); return; }
    if (!aiPlan.length) { aiPlan = null; nextTurn(); return; }
    var act = aiPlan.shift();
    applyAi(act);
    saveSession();
    renderAll();
    if (st.over >= 0 || humanFallen()) { aiPlan = null; finish(); return; }
    aiTimer = setTimeout(function () { aiTimer = null; stepAi(); }, AI_STEP_MS);
  }
  function applyAi(act) {
    var took = act.a === "move" ? st.own[act.y] !== st.turn : (act.kind.charAt(0) === "u" && st.own[act.y] !== st.turn);
    if (!E.apply(st, act)) return;
    flash = act.y;
    if (!prefs.fast && !reducedMotion()) sfx(took ? "take" : "move");
  }
  // Apply the rest of the computer's turn at once (a tap skips).
  function flushAi() {
    if (!aiPlan) return;
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    while (aiPlan.length && st.over < 0) E.apply(st, aiPlan.shift());
    aiPlan = null;
    saveSession();
    if (st.over >= 0 || humanFallen()) { renderAll(); finish(); return; }
    nextTurn();
  }
  function skipAi() { if (aiPlan) flushAi(); }

  function offerSurrender() {
    if (!humanTurn() || document.querySelector("dialog[open]")) return;
    var s = E.surrenderOffer(st);
    if (s >= 0) surrenderDialog(s);
  }

  function finish() {
    if (game.done) { renderAll(); return; }
    cancelAi();
    game.done = true;
    var hs = [];
    st.sides.forEach(function (s, k) { if (s.k === "h") hs.push(k); });
    var won = st.over >= 0 && st.sides[st.over].k === "h";
    if (hs.length === 1 && game.opts.comps > 0) countResult(game.opts.lv, game.opts.size, won ? 0 : 1);
    saveSession();
    clearSel();
    renderAll();
    setTimeout(function () { sfx(won ? "win" : "end"); }, 250);
    setTimeout(function () { resultDialog(); }, 900);
  }

  // ---------- 5. Map view ----------
  var SQ3 = Math.sqrt(3);
  var view = { scale: 30, ox: 0, oy: 0, fit: 30 };
  var canvas = null, ctx = null, dpr = 1, cw = 0, ch = 0;
  var cursor = -1, flash = -1;
  var drawQueued = false;
  var colors = {};

  // Centre of cell i in world units (hex radius 1).
  function center(i) {
    var r = Math.floor(i / st.W), c = i % st.W;
    return { x: (c + 0.5 * (r & 1)) * SQ3 + SQ3 / 2, y: r * 1.5 + 1 };
  }
  function worldW() { return st.W * SQ3 + SQ3 / 2; }
  function worldH() { return (st.H - 1) * 1.5 + 2; }
  function toScreen(p) { return { x: p.x * view.scale + view.ox, y: p.y * view.scale + view.oy }; }
  function cellAt(sx, sy) {
    var wx = (sx - view.ox) / view.scale, wy = (sy - view.oy) / view.scale;
    var r0 = Math.round((wy - 1) / 1.5), best = -1, bestD = 1.0;
    for (var r = r0 - 1; r <= r0 + 1; r++) {
      if (r < 0 || r >= st.H) continue;
      var c0 = Math.round((wx - SQ3 / 2) / SQ3 - 0.5 * (r & 1));
      for (var c = c0 - 1; c <= c0 + 1; c++) {
        if (c < 0 || c >= st.W) continue;
        var p = center(r * st.W + c), d = Math.hypot(p.x - wx, p.y - wy);
        if (d < bestD) { bestD = d; best = r * st.W + c; }
      }
    }
    return best;
  }
  function landBox() {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < st.land.length; i++) {
      if (!st.land[i]) continue;
      var p = center(i);
      x0 = Math.min(x0, p.x - 1); x1 = Math.max(x1, p.x + 1);
      y0 = Math.min(y0, p.y - 1); y1 = Math.max(y1, p.y + 1);
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }
  // Fit the island; on a small screen zoom in so a cell stays at least
  // 34 px wide, centred on the side to move.
  function fitView(reset) {
    if (!canvas || !st) return;
    resize();
    var b = landBox(), pad = 12;
    var fit = Math.min((cw - pad * 2) / (b.x1 - b.x0), (ch - pad * 2) / (b.y1 - b.y0));
    view.fit = fit;
    if (reset) {
      view.scale = Math.max(fit, 34 / SQ3);
      view.ox = cw / 2 - ((b.x0 + b.x1) / 2) * view.scale;
      view.oy = ch / 2 - ((b.y0 + b.y1) / 2) * view.scale;
      if (view.scale > fit + 0.01) centerOn(humanTurn() ? region : -1);
    }
    clampView();
    draw();
  }
  function minScale() { return Math.min(view.fit, 34 / SQ3); }
  function maxScale() { return Math.max(view.fit * 1.2, 72 / SQ3); }
  function clampView() {
    var b = landBox();
    view.scale = clamp(view.scale, minScale(), maxScale());
    // keep some of the island on screen
    var x0 = b.x0 * view.scale, x1 = b.x1 * view.scale, y0 = b.y0 * view.scale, y1 = b.y1 * view.scale;
    var m = 60;
    view.ox = clamp(view.ox, m - x1, cw - m - x0);
    view.oy = clamp(view.oy, m - y1, ch - m - y0);
  }
  function centerOn(i) {
    if (!canvas || !st) return;
    if (i < 0) {
      var regs = E.regions(st, st.turn);
      if (!regs.length) return;
      i = regs[0][0];
    }
    var p = center(i);
    view.ox = cw / 2 - p.x * view.scale;
    view.oy = ch / 2 - p.y * view.scale;
    clampView();
    draw();
  }
  // Pan only when cell i is off screen or near the edge.
  function reveal(i) {
    if (!canvas || !st || i < 0) return;
    var p = toScreen(center(i)), mx = Math.min(80, cw * 0.15), my = Math.min(80, ch * 0.15);
    if (p.x < mx || p.y < my || p.x > cw - mx || p.y > ch - my) centerOn(i);
  }
  function zoomBy(f, sx, sy) {
    if (sx === undefined) { sx = cw / 2; sy = ch / 2; }
    var s0 = view.scale, s1 = clamp(s0 * f, minScale(), maxScale());
    view.ox = sx - (sx - view.ox) * (s1 / s0);
    view.oy = sy - (sy - view.oy) * (s1 / s0);
    view.scale = s1;
    clampView();
    draw();
  }
  function resize() {
    var wrap = $("map-wrap");
    dpr = window.devicePixelRatio || 1;
    cw = Math.max(1, wrap.clientWidth);
    ch = Math.max(1, wrap.clientHeight);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.width = cw + "px";
    canvas.style.height = ch + "px";
  }

  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ["--rm-sea", "--rm-sea-line", "--rm-land", "--rm-line", "--rm-border", "--rm-thicket",
     "--rm-ruin", "--rm-build", "--rm-build-line", "--accent", "--text", "--danger", "--bg"].forEach(function (v) {
      colors[v] = cs.getPropertyValue(v).trim() || "#888";
    });
  }

  function draw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(function () { drawQueued = false; paint(); });
  }
  function hexPath(p, s) {
    ctx.beginPath();
    for (var k = 0; k < 6; k++) {
      var a = Math.PI / 180 * (60 * k - 30);
      var x = p.x + s * Math.cos(a), y = p.y + s * Math.sin(a);
      if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
  }
  function corner(p, s, k) {
    var a = Math.PI / 180 * (60 * k - 30);
    return { x: p.x + s * Math.cos(a), y: p.y + s * Math.sin(a) };
  }
  // Edge corners per neighbour direction W, E, NW, NE, SW, SE.
  var EDGE = [[3, 4], [0, 1], [4, 5], [5, 0], [2, 3], [1, 2]];

  function paint() {
    if (!ctx || !st) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colors["--rm-sea"];
    ctx.fillRect(0, 0, cw, ch);
    var s = view.scale, n = st.land.length;
    var regSet = {};
    regionCells().forEach(function (x) { regSet[x] = true; });
    var litSet = {};
    lit.walk.forEach(function (x) { litSet[x] = "w"; });
    lit.buy.forEach(function (x) { litSet[x] = "b"; });
    lit.take.forEach(function (x) { litSet[x] = "t"; });
    var ready = {};
    if (humanTurn()) E.readyUnits(st).forEach(function (x) { ready[x] = true; });
    // 1. cells
    for (var i = 0; i < n; i++) {
      if (!st.land[i]) continue;
      var p = toScreen(center(i));
      if (p.x < -s * 2 || p.y < -s * 2 || p.x > cw + s * 2 || p.y > ch + s * 2) continue;
      hexPath(p, s * 0.98);
      var o = st.own[i];
      ctx.fillStyle = o >= 0 ? SIDE_COLORS[o] : colors["--rm-land"];
      ctx.globalAlpha = o >= 0 ? (regSet[i] ? 1 : 0.82) : 1;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors["--rm-line"];
      ctx.lineWidth = 1;
      ctx.stroke();
      if (o >= 0 && s >= 14) mark(p, s, o);
    }
    // 2. region borders (between different owners)
    ctx.lineCap = "round";
    for (var j = 0; j < n; j++) {
      if (!st.land[j] || st.own[j] < 0) continue;
      var q = toScreen(center(j)), nb = E.around(st, j);
      for (var k = 0; k < 6; k++) {
        var x = nb[k];
        if (x >= 0 && st.own[x] === st.own[j]) continue;
        var a = corner(q, s, EDGE[k][0]), b = corner(q, s, EDGE[k][1]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = regSet[j] ? colors["--text"] : colors["--rm-border"];
        ctx.lineWidth = regSet[j] ? Math.max(2, s * 0.12) : Math.max(1.5, s * 0.08);
        ctx.stroke();
      }
    }
    // 3. objects + highlights
    for (var m = 0; m < n; m++) {
      if (!st.land[m]) continue;
      var c = toScreen(center(m));
      if (c.x < -s * 2 || c.y < -s * 2 || c.x > cw + s * 2 || c.y > ch + s * 2) continue;
      var L = litSet[m];
      if (L) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, s * (L === "t" ? 0.62 : 0.5), 0, Math.PI * 2);
        ctx.fillStyle = L === "t" ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.22)";
        ctx.fill();
        ctx.lineWidth = Math.max(2, s * 0.08);
        ctx.strokeStyle = L === "t" ? colors["--danger"] : colors["--accent"];
        ctx.stroke();
      }
      drawObj(c, s, st.obj[m], st.own[m], ready[m], m === sel);
      if (m === flash) {
        hexPath(c, s * 0.9);
        ctx.lineWidth = Math.max(2, s * 0.1);
        ctx.strokeStyle = colors["--accent"];
        ctx.stroke();
      }
    }
    // 4. keyboard cursor
    if (cursor >= 0 && kbdActive) {
      var cc = toScreen(center(cursor));
      hexPath(cc, s * 0.86);
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = colors["--text"];
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  // A small mark per side, so the sides read without colour too.
  function mark(p, s, o) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "#000";
    ctx.fillStyle = "#000";
    ctx.lineWidth = Math.max(1, s * 0.06);
    var x = p.x - s * 0.55, y = p.y + s * 0.42, d = s * 0.14;
    ctx.beginPath();
    if (o === 1) { ctx.moveTo(x - d, y + d); ctx.lineTo(x + d, y - d); }
    else if (o === 2) { ctx.arc(x, y, d * 0.6, 0, Math.PI * 2); ctx.fill(); }
    else if (o === 3) { ctx.moveTo(x - d, y); ctx.lineTo(x + d, y); }
    else if (o === 4) { ctx.moveTo(x - d, y - d); ctx.lineTo(x + d, y + d); ctx.moveTo(x - d, y + d); ctx.lineTo(x + d, y - d); }
    else if (o === 5) { ctx.moveTo(x, y - d); ctx.lineTo(x, y + d); }
    ctx.stroke();
    ctx.restore();
  }

  function drawObj(p, s, o, own, isReady, isSel) {
    if (!o) return;
    var u = s * 0.5;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1, s * 0.06);
    ctx.strokeStyle = colors["--rm-build-line"];
    ctx.fillStyle = colors["--rm-build"];
    if (o === O.HALL) {
      ctx.beginPath();
      ctx.moveTo(p.x - u * 0.8, p.y + u * 0.7);
      ctx.lineTo(p.x - u * 0.8, p.y - u * 0.1);
      ctx.lineTo(p.x, p.y - u * 0.85);
      ctx.lineTo(p.x + u * 0.8, p.y - u * 0.1);
      ctx.lineTo(p.x + u * 0.8, p.y + u * 0.7);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = colors["--rm-build-line"];
      ctx.fillRect(p.x - u * 0.18, p.y + u * 0.15, u * 0.36, u * 0.55);
    } else if (o === O.TOWER) {
      ctx.beginPath();
      ctx.moveTo(p.x - u * 0.4, p.y + u * 0.8);
      ctx.lineTo(p.x - u * 0.4, p.y - u * 0.6);
      ctx.lineTo(p.x - u * 0.55, p.y - u * 0.6);
      ctx.lineTo(p.x - u * 0.55, p.y - u * 0.9);
      ctx.lineTo(p.x + u * 0.55, p.y - u * 0.9);
      ctx.lineTo(p.x + u * 0.55, p.y - u * 0.6);
      ctx.lineTo(p.x + u * 0.4, p.y - u * 0.6);
      ctx.lineTo(p.x + u * 0.4, p.y + u * 0.8);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (o === O.FORT) {
      ctx.beginPath();
      var top = p.y - u * 0.55, bot = p.y + u * 0.75, l = p.x - u * 0.9, r = p.x + u * 0.9, w = (r - l) / 5;
      ctx.moveTo(l, bot); ctx.lineTo(l, top - u * 0.3);
      for (var k = 0; k < 5; k++) {
        var x0 = l + k * w;
        ctx.lineTo(x0 + w, k % 2 ? top - u * 0.3 : top);
        if (k < 4) ctx.lineTo(x0 + w, k % 2 ? top : top - u * 0.3);
      }
      ctx.lineTo(r, bot); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = colors["--rm-build-line"];
      ctx.beginPath(); ctx.arc(p.x, bot, u * 0.3, Math.PI, 0); ctx.fill();
    } else if (o === O.MILL) {
      ctx.beginPath(); ctx.arc(p.x, p.y + u * 0.2, u * 0.45, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      for (var b = 0; b < 4; b++) {
        var a = Math.PI / 4 + b * Math.PI / 2;
        ctx.moveTo(p.x, p.y + u * 0.2);
        ctx.lineTo(p.x + Math.cos(a) * u * 0.95, p.y + u * 0.2 + Math.sin(a) * u * 0.95);
      }
      ctx.lineWidth = Math.max(1.5, s * 0.09);
      ctx.stroke();
    } else if (o === O.THICKET) {
      ctx.fillStyle = colors["--rm-thicket"];
      [[-0.45, 0.25, 0.55], [0.4, 0.3, 0.5], [0, -0.15, 0.7]].forEach(function (tr) {
        var cx = p.x + tr[0] * u, cy = p.y + tr[1] * u, h = tr[2] * u;
        ctx.beginPath();
        ctx.moveTo(cx, cy - h); ctx.lineTo(cx + h * 0.6, cy + h * 0.5); ctx.lineTo(cx - h * 0.6, cy + h * 0.5);
        ctx.closePath(); ctx.fill();
      });
    } else if (o === O.RUIN) {
      ctx.fillStyle = colors["--rm-ruin"];
      [[-0.5, 0.2, 0.4, 0.4], [0.05, 0.35, 0.45, 0.3], [-0.15, -0.3, 0.3, 0.45]].forEach(function (rb) {
        ctx.fillRect(p.x + rb[0] * u, p.y + rb[1] * u, rb[2] * u, rb[3] * u);
      });
    } else if (E.isUnit(o)) {
      var tier = E.tierOf(o);
      ctx.beginPath();
      ctx.arc(p.x, p.y, u * 0.82, 0, Math.PI * 2);
      ctx.fillStyle = "#fbf8ef";
      ctx.fill();
      ctx.lineWidth = Math.max(2, s * 0.1);
      ctx.strokeStyle = own >= 0 ? SIDE_COLORS[own] : "#333";
      ctx.stroke();
      ctx.fillStyle = "#1b1b1b";
      ctx.font = "800 " + Math.round(u * (tier === 4 ? 0.7 : 0.8)) + "px Nunito, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(["I", "II", "III", "IV"][tier - 1], p.x, p.y + u * 0.04);
      if (isReady) {
        ctx.beginPath();
        ctx.arc(p.x + u * 0.65, p.y - u * 0.65, Math.max(3, u * 0.2), 0, Math.PI * 2);
        ctx.fillStyle = colors["--accent"];
        ctx.fill();
      }
      if (isSel) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, u * 1.05, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(2.5, s * 0.12);
        ctx.strokeStyle = colors["--accent"];
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function shake() {
    var w = $("map-wrap");
    if (!w || reducedMotion()) return;
    w.classList.remove("shake");
    void w.offsetWidth;
    w.classList.add("shake");
  }
  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 6. Input ----------
  var pointers = {}, gesture = null, kbdActive = false;

  function localXY(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function wireInput() {
    canvas.addEventListener("pointerdown", function (e) {
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      pointers[e.pointerId] = localXY(e);
      var ids = Object.keys(pointers);
      if (ids.length === 1) {
        gesture = { kind: "tap", start: localXY(e), ox: view.ox, oy: view.oy };
      } else if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        gesture = { kind: "pinch", d: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: view.scale,
                    mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, ox: view.ox, oy: view.oy };
      }
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!pointers[e.pointerId] || !gesture) return;
      pointers[e.pointerId] = localXY(e);
      var ids = Object.keys(pointers);
      if (gesture.kind === "pinch" && ids.length >= 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        var s1 = clamp(gesture.scale * d / gesture.d, minScale(), maxScale());
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        view.ox = mx - (gesture.mx - gesture.ox) * (s1 / gesture.scale);
        view.oy = my - (gesture.my - gesture.oy) * (s1 / gesture.scale);
        view.scale = s1;
        clampView();
        draw();
        return;
      }
      var p = pointers[e.pointerId];
      var dx = p.x - gesture.start.x, dy = p.y - gesture.start.y;
      if (gesture.kind === "tap" && Math.hypot(dx, dy) > 8) gesture.kind = "pan";
      if (gesture.kind === "pan") {
        view.ox = gesture.ox + dx; view.oy = gesture.oy + dy;
        clampView();
        draw();
      }
    });
    function up(e) {
      if (!pointers[e.pointerId]) return;
      var p = pointers[e.pointerId];
      delete pointers[e.pointerId];
      if (gesture && gesture.kind === "tap" && e.type === "pointerup") {
        kbdActive = false;
        tapCell(cellAt(p.x, p.y));
      }
      if (!Object.keys(pointers).length) gesture = null;
      else if (gesture && gesture.kind === "pinch") gesture = { kind: "done" };
    }
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", function (e) {
      e.preventDefault();
      var p = localXY(e);
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y);
    }, { passive: false });
    window.addEventListener("resize", function () { fitView(false); });
  }

  // Arrow keys move the cursor one cell; Enter / Space tap it.
  function moveCursor(dir) {
    if (cursor < 0) cursor = region >= 0 ? region : 0;
    var r = Math.floor(cursor / st.W), c = cursor % st.W;
    if (dir === "ArrowLeft") c--; else if (dir === "ArrowRight") c++;
    else if (dir === "ArrowUp") r--; else r++;
    if (r < 0 || r >= st.H || c < 0 || c >= st.W) return;
    cursor = r * st.W + c;
    kbdActive = true;
    reveal(cursor);
    draw();
    var sr = st.land[cursor] ? (st.own[cursor] >= 0 ? t("cell.of", { who: sideName(st.own[cursor]) }) : t("cell.free")) : t("cell.water");
    if (st.obj[cursor]) sr += ", " + t("kind." + objKind(st.obj[cursor]));
    live(sr);
  }
  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey) return;
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT") return;
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ" && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (e.ctrlKey || e.metaKey) return;               // never steal OS combos
      if (e.shiftKey && e.code !== "Equal") return;     // Shift only for "+"
      if (e.code === "KeyN") { e.preventDefault(); newDialog(); return; }
      if (e.code === "KeyZ") { e.preventDefault(); undo(); return; }
      if (e.code === "KeyE") { e.preventDefault(); endTurn(); return; }
      if (e.code === "Escape") { if (armed || sel >= 0) { clearSel(); renderAll(); } return; }
      if (e.code === "Equal" || e.code === "NumpadAdd") { e.preventDefault(); zoomBy(1.2); return; }
      if (e.code === "Minus" || e.code === "NumpadSubtract") { e.preventDefault(); zoomBy(1 / 1.2); return; }
      var dg = /^(Digit|Numpad)([1-7])$/.exec(e.code);
      if (dg) { e.preventDefault(); arm(KINDS[+dg[2] - 1]); return; }
      if (document.activeElement !== canvas) return;
      if (/^Arrow/.test(e.key)) { e.preventDefault(); moveCursor(e.key); return; }
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); kbdActive = true; tapCell(cursor < 0 ? region : cursor); }
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

  // ---------- 7. Panels ----------
  function renderAll() {
    renderToolbar();
    renderStatus();
    renderBuyBar();
    draw();
  }
  function renderToolbar() {
    var u = $("undo-btn"), ok = canUndo();
    u.disabled = !ok;
    u.title = t(ok ? "btn.undo" : "btn.undoNone");
    u.setAttribute("aria-label", u.title);
    $("end-btn").disabled = !humanTurn();
    paintSfxBtn();
  }
  function renderStatus() {
    if (!st) return;
    var who = st.over >= 0 ? st.over : st.turn;
    $("sw").style.background = SIDE_COLORS[who];
    var txt;
    if (st.over >= 0 || game.done) txt = t("turn.over");
    else if (st.sides[st.turn].k === "c") txt = t("turn.ai", { who: sideName(st.turn) });
    else txt = humans() === 1 ? t("turn.you") : t("turn.person", { who: sideName(st.turn) });
    $("turn").textContent = txt;
    $("round").textContent = t("turn.round", { n: st.round });
    var info = humanTurn() && regionCells().length ? E.regionInfo(st, region) : null;
    if (info && info.hall >= 0) {
      $("gold").textContent = t("reg.gold", { g: info.gold });
      var net = info.net;
      $("net").textContent = t("reg.net", { net: (net > 0 ? "+" : net < 0 ? "−" : "±") + Math.abs(net) });
      $("net").classList.toggle("neg", net < 0);
    } else {
      $("gold").textContent = humanTurn() ? (region >= 0 ? t("reg.lone") : t("reg.none")) : "";
      $("net").textContent = "";
      $("net").classList.remove("neg");
    }
  }
  function renderBuyBar() {
    var info = humanTurn() && regionCells().length ? E.regionInfo(st, region) : null;
    KINDS.forEach(function (k) {
      var b = $("buy-" + k);
      var cost = E.costOf(k, info || { mills: 0 });
      b.querySelector(".cost").textContent = String(cost);
      var can = !!(info && info.hall >= 0 && info.gold >= cost);
      b.classList.toggle("poor", !can);
      b.setAttribute("aria-disabled", can ? "false" : "true");
      b.setAttribute("aria-pressed", armed === k ? "true" : "false");
      b.setAttribute("aria-label", t("buy.label", { kind: t("kind." + k), cost: cost }));
      b.title = b.getAttribute("aria-label");
    });
  }

  // ---------- 8. Dialogs ----------
  function makeDialog(id) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "mm-dlg";
    dlg.addEventListener("click", function (e) { if (e.target === dlg && !dlg.hasAttribute("data-modal")) dlg.close(); });
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
  function segField(label, values, cur, nameKey, onPick) {
    var wrap = el("div", "dlg-field");
    wrap.appendChild(el("div", "dlg-label", label));
    var seg = el("div", "seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", label);
    values.forEach(function (v) {
      var b = el("button", "seg-btn" + (v === cur ? " active" : ""), t(nameKey + v));
      b.type = "button";
      b.setAttribute("aria-pressed", v === cur ? "true" : "false");
      b.addEventListener("click", function () {
        [].forEach.call(seg.children, function (x) { x.classList.remove("active"); x.setAttribute("aria-pressed", "false"); });
        b.classList.add("active");
        b.setAttribute("aria-pressed", "true");
        onPick(v);
      });
      seg.appendChild(b);
    });
    wrap.appendChild(seg);
    return wrap;
  }
  function selectField(label, from, to, cur, onPick) {
    var wrap = el("label", "dlg-field");
    wrap.appendChild(el("span", "dlg-label", label));
    var s = el("select", "dlg-select");
    for (var i = from; i <= to; i++) {
      var o = el("option", "", String(i));
      o.value = String(i);
      if (i === cur) o.selected = true;
      s.appendChild(o);
    }
    s.addEventListener("change", function () { onPick(+s.value); });
    wrap.appendChild(s);
    return { wrap: wrap, select: s };
  }

  function newDialog(opts) {
    cancelTourWait();
    var o = opts || { size: prefs.size, people: prefs.people, comps: prefs.comps, lv: prefs.lv, seed: "" };
    var dlg = makeDialog("rm-new");
    dlg.appendChild(el("div", "dlg-title", t("new.title")));
    dlg.appendChild(segField(t("new.size"), SIZES, o.size, "new.size.", function (v) { o.size = v; }));
    var note = el("div", "dlg-note", t("new.count"));
    var pf = selectField(t("new.people"), 1, 6, o.people, function (v) { o.people = v; check(); });
    var cf = selectField(t("new.comps"), 0, 5, o.comps, function (v) { o.comps = v; check(); });
    dlg.appendChild(pf.wrap);
    dlg.appendChild(cf.wrap);
    var lvf = segField(t("new.level"), LEVELS, o.lv, "level.", function (v) { o.lv = v; });
    dlg.appendChild(lvf);
    var seedWrap = el("label", "dlg-field");
    seedWrap.appendChild(el("span", "dlg-label", t("new.seed")));
    var seed = el("input", "dlg-input");
    seed.type = "text";
    seed.maxLength = 16;
    seed.autocomplete = "off";
    seed.spellcheck = false;
    seed.value = o.seed || "";
    seedWrap.appendChild(seed);
    dlg.appendChild(seedWrap);
    var fastWrap = el("label", "dlg-check");
    var fast = el("input");
    fast.type = "checkbox";
    fast.checked = prefs.fast;
    fastWrap.appendChild(fast);
    fastWrap.appendChild(el("span", "", t("new.fast")));
    dlg.appendChild(fastWrap);
    dlg.appendChild(note);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("new.cancel"), "", function () { dlg.close(); }));
    var go = button(t("new.start"), "primary", function () {
      if (o.people + o.comps < 2 || o.people + o.comps > 6) { showToast(t("new.count")); return; }
      prefs.size = o.size; prefs.people = o.people; prefs.comps = o.comps; prefs.lv = o.lv;
      prefs.fast = fast.checked;
      savePrefs();
      var sd = cleanSeed(seed.value) || newSeed();
      dlg.close();
      startGame({ size: o.size, people: o.people, comps: o.comps, lv: o.lv, seed: sd });
    });
    acts.appendChild(go);
    dlg.appendChild(acts);
    function check() {
      var ok = o.people + o.comps >= 2 && o.people + o.comps <= 6;
      note.classList.toggle("bad", !ok);
      go.disabled = !ok;
      lvf.hidden = o.comps === 0;
    }
    check();
    document.body.appendChild(dlg);
    dlg.showModal();
    go.focus();
  }

  function resultDialog() {
    if (!game || !game.done) return;
    var dlg = makeDialog("rm-result");
    var hs = st.sides.filter(function (s) { return s.k === "h"; }).length;
    var won = st.over >= 0 && st.sides[st.over].k === "h";
    dlg.appendChild(el("div", "dlg-title", t("res.title") + (game.opts.comps ? " · " + t("level." + game.opts.lv) : "")));
    var hero;
    if (hs === 1) hero = won ? t("res.youwin") : (st.over >= 0 ? t("res.ailose") : t("res.lost"));
    else hero = st.over >= 0 ? t("res.pwin", { who: sideName(st.over) }) : t("res.ailose");
    dlg.appendChild(el("div", "dlg-hero", hero));
    dlg.appendChild(row(t("res.rounds"), String(st.round)));
    if (hs === 1 && game.opts.comps) {
      dlg.appendChild(row(t("stats.head") + " · " + t("new.size." + game.opts.size), totals(game.opts.lv, game.opts.size).join(" · ")));
    }
    dlg.appendChild(el("div", "dlg-note", t("stats.code", { seed: game.opts.seed })));
    var acts = el("div", "dlg-actions wrap");
    acts.appendChild(button(t("res.close"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("res.same"), "", function () {
      dlg.close();
      startGame(JSON.parse(JSON.stringify(game.opts)));
    }));
    var again = button(t("res.again"), "primary", function () { dlg.close(); newDialog(); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    again.focus();
  }

  function statsDialog() {
    var dlg = makeDialog("rm-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    LEVELS.forEach(function (lv) {
      var parts = SIZES.map(function (sz) {
        var v = totals(lv, sz);
        if (v[0] + v[1]) empty = false;
        return t("new.size." + sz) + " " + v[0] + "·" + v[1];
      });
      dlg.appendChild(row(t("level." + lv), parts.join("  ")));
    });
    if (game) dlg.appendChild(el("div", "dlg-note", t("stats.code", { seed: game.opts.seed })));
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
    var dlg = makeDialog("rm-confirm");
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
    data = mergeRealm(data, data);
    save();
    showToast(t("toast.reset"));
  }

  // Hot-seat: the next person takes the device; the map stays hidden
  // behind the dialog until they start.
  function passDialog() {
    var dlg = makeDialog("rm-pass");
    dlg.classList.add("pass");
    dlg.setAttribute("data-modal", "1");
    var sw = el("span", "pass-sw");
    sw.style.background = SIDE_COLORS[st.turn];
    dlg.appendChild(sw);
    dlg.appendChild(el("div", "dlg-title", t("pass.title")));
    dlg.appendChild(el("div", "dlg-hero", t("pass.msg", { who: sideName(st.turn) })));
    var acts = el("div", "dlg-actions");
    var go = button(t("pass.go"), "primary", function () { dlg.close(); });
    acts.appendChild(go);
    dlg.appendChild(acts);
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); });
    dlg.addEventListener("close", function () {
      reveal(region);
      renderAll();
      live(t("live.turn", { n: st.round, who: sideName(st.turn) }));
      offerSurrender();
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    go.focus();
  }

  function surrenderDialog(side) {
    var dlg = makeDialog("rm-sur");
    dlg.appendChild(el("div", "dlg-title", t("sur.title")));
    dlg.appendChild(el("div", "dlg-msg", t("sur.msg", { p: Math.round(E.share(st, side) * 100) })));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("sur.no"), "", function () {
      st.nos = 1;
      saveSession();
      dlg.close();
    }));
    var yes = button(t("sur.yes"), "primary", function () {
      dlg.close();
      E.surrender(st, side);
      saveSession();
      finish();
    });
    acts.appendChild(yes);
    dlg.appendChild(acts);
    dlg.addEventListener("cancel", function () { st.nos = 1; saveSession(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    yes.focus();
  }

  // The first game on this device shows five short steps.
  var tourTimer = null;
  function cancelTourWait() { if (tourTimer) { clearTimeout(tourTimer); tourTimer = null; } }
  function maybeTour() {
    if (prefs.tour || tourTimer || document.querySelector("dialog[open]")) return;
    tourTimer = setTimeout(function () { tourTimer = null; tourDialog(1); }, 400);
  }
  function tourDialog(n) {
    if (document.querySelector("dialog[open]")) return;
    var dlg = makeDialog("rm-tour");
    dlg.appendChild(el("div", "dlg-title", t("tour.title") + " · " + n + "/5"));
    dlg.appendChild(el("div", "dlg-msg", t("tour." + n)));
    var acts = el("div", "dlg-actions");
    function seen() { prefs.tour = true; savePrefs(); }
    if (n < 5) acts.appendChild(button(t("tour.skip"), "", function () { seen(); dlg.close(); }));
    var next = button(t(n < 5 ? "tour.next" : "tour.done"), "primary", function () {
      dlg.close();
      if (n < 5) setTimeout(function () { tourDialog(n + 1); }, 0);
      else seen();
    });
    acts.appendChild(next);
    dlg.appendChild(acts);
    dlg.addEventListener("cancel", seen);
    document.body.appendChild(dlg);
    dlg.showModal();
    next.focus();
  }

  // ---------- 9. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "realm", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
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
    g.gain.setValueAtTime(vol || 0.16, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(audio.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function sfx(kind) {
    if (window.orosHaptics) window.orosHaptics.cue(kind === "select" ? "tick" : kind);
    if (!sfxOn()) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio) audio = new AC();
      if (audio.state === "suspended") audio.resume();
      if (kind === "move") tone(392, 0, 0.08, "triangle", 0.12);
      else if (kind === "select") tone(523, 0, 0.05, "sine", 0.08);
      else if (kind === "take") { tone(294, 0, 0.08, "square", 0.08); tone(440, 0.07, 0.1, "triangle", 0.12); }
      else if (kind === "buy") { tone(880, 0, 0.06, "sine", 0.1); tone(1175, 0.05, 0.09, "sine", 0.08); }
      else if (kind === "turn") tone(330, 0, 0.12, "sine", 0.08);
      else if (kind === "win") [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
      else if (kind === "end") { tone(392, 0, 0.18, "sine"); tone(262, 0.16, 0.34, "sine"); }
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Icons (R9: icon buttons ship empty, filled here) ----------
  var SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  var UI_ICONS = {
    new:    SVG + '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    undo:   SVG + '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    stats:  SVG + '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    sfxOn:  SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    sfxOff: SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
    zin:    SVG + '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/></svg>',
    zout:   SVG + '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/></svg>',
    center: SVG + '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
    u1:     SVG + '<circle cx="12" cy="12" r="8"/><path d="M12 8v8"/></svg>',
    u2:     SVG + '<circle cx="12" cy="12" r="8"/><path d="M10 8v8M14 8v8"/></svg>',
    u3:     SVG + '<circle cx="12" cy="12" r="8"/><path d="M8.5 8v8M12 8v8M15.5 8v8"/></svg>',
    u4:     SVG + '<circle cx="12" cy="12" r="8"/><path d="M8 8v8M11 8l2 8 2-8"/></svg>',
    tower:  SVG + '<path d="M8 21V8H6V3h12v5h-2v13z"/><path d="M10 3v2M14 3v2"/></svg>',
    fort:   SVG + '<path d="M3 21V8h3v2h3V8h6v2h3V8h3v13z"/><path d="M10 21v-4a2 2 0 0 1 4 0v4"/></svg>',
    mill:   SVG + '<circle cx="12" cy="13" r="3"/><path d="M12 13 5 6M12 13l7-7M12 13l-7 7M12 13l7 7"/></svg>'
  };
  function paintSfxBtn() {
    var b = $("sfx-btn"), on = sfxOn();
    b.innerHTML = on ? UI_ICONS.sfxOn : UI_ICONS.sfxOff;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.setAttribute("aria-label", t(on ? "btn.sfxOn" : "btn.sfxOff"));
    b.title = t(on ? "btn.sfxOn" : "btn.sfxOff");
  }

  // ---------- 11. Sync slice + palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft", "--accent-ink",
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
    readColors();
    draw();
  }
  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-theme", "style", "class"] });
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
    api.registerSlice("realm", sliceGet, sliceSet, STORAGE_KEY, mergeRealm);
  }
  function sliceGet() { return mergeRealm(data, data); }   // canonical copy (R26)
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeRealm(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
  }

  // ---------- 12. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    canvas.setAttribute("aria-label", t("map.label"));
    $("end-btn").title = t("btn.endKey");
  }
  function paintStatic() {
    [["new-btn", "new", "btn.new"], ["undo-btn", "undo", "btn.undo"], ["stats-btn", "stats", "btn.stats"],
     ["zin-btn", "zin", "btn.zoomIn"], ["zout-btn", "zout", "btn.zoomOut"], ["center-btn", "center", "btn.center"]
    ].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    KINDS.forEach(function (k) {
      var b = $("buy-" + k);
      b.querySelector(".ic").innerHTML = UI_ICONS[k];
      b.querySelector(".nm").textContent = t("kind." + k);
    });
    paintSfxBtn();
  }
  function wire() {
    $("new-btn").addEventListener("click", function () { newDialog(); });
    $("undo-btn").addEventListener("click", undo);
    $("end-btn").addEventListener("click", endTurn);
    $("stats-btn").addEventListener("click", statsDialog);
    $("zin-btn").addEventListener("click", function () { zoomBy(1.25); });
    $("zout-btn").addEventListener("click", function () { zoomBy(1 / 1.25); });
    $("center-btn").addEventListener("click", function () { centerOn(humanTurn() ? region : -1); });
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("buy");
    });
    KINDS.forEach(function (k) {
      $("buy-" + k).addEventListener("click", function () { arm(k); });
    });
    wireInput();
    wireKeyboard();
    // Save on the way out (R10 session).
    document.addEventListener("visibilitychange", function () { if (document.hidden && game) saveSession(); });
    window.addEventListener("pagehide", function () { if (game) saveSession(); });
  }

  function boot() {
    canvas = $("map");
    ctx = canvas.getContext("2d");
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
    if (!game) game = makeGame({ size: prefs.size, people: prefs.people, comps: prefs.comps, lv: prefs.lv, seed: newSeed() });
    st = game.g;
    saveSession();
    afterLoad(true);
    if (game.done) setTimeout(resultDialog, 300);
  }

  boot();
})();
