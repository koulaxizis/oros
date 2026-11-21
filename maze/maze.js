// ============================================================
// orOS Lantern maze — App logic (v1.0.0)
// A tower defense game on an open grid: at night shadows slip in at
// the town gate and walk to the fountain of an old square. Stack
// crates and hang lanterns anywhere on the free ground to build them a
// maze; shadows always take the darkest way, moths the brightest. Real
// time with pause (1x / 2x / 3x), a wave starts only when the player
// calls it. The rules live in maze/engine.js (MazeEngine, tested
// headless); this file is the screen, the saves and the clock.
// Data:
//   - synced slice "maze" (oros-maze-data): best stars per square and
//     per-device counter rows (MazeEngine.merge, a join). Written only
//     when a night ends or progress is reset; never during play.
//   - device-local (R10): oros-maze-session ({g: the night in progress,
//     ck: the night at the start of its last wave, counted}, saved at
//     every wave start, after every build and on the way out; read by
//     gamekit/resume.js), oros-maze-prefs (difficulty, tour, last
//     square, show the darkness), oros-maze-device, oros-maze-sfx.
// Sections:
//   1. Constants, i18n, helpers
//   2. Saves (progress, prefs, session)
//   3. The night: start, actions, ending
//   4. Loop (real time, speed, pause)
//   5. Scene (the square on one canvas)
//   6. Input (tap and drag, keyboard)
//   7. Toolbar + bottom bar
//   8. Town map
//   9. Dialogs (end of night, how to play, confirm)
//  10. Toasts + live region
//  11. Sound
//  12. Sync slice + palette
//  13. Test hooks, wiring & boot
// ============================================================
(function () {
  "use strict";

  var E = window.MazeEngine;

  var STORAGE_KEY = "oros-maze-data";
  var PREFS_KEY   = "oros-maze-prefs";
  var SESSION_KEY = "oros-maze-session";
  var DEVICE_KEY  = "oros-maze-device";
  var SFX_KEY     = "oros-maze-sfx";
  var SAVE_MS     = 600;                 // a build is saved this long after
  var RUN_SAVE_MS = 5000;                // and while the night runs, this often
  var SPEEDS      = [1, 2, 3];
  var BUILD_KEYS  = ["crate"].concat(E.KINDS);

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
      "app.name": "Lantern maze",
      "btn.map": "Town map (L)", "btn.help": "How to play (?)",
      "btn.sfxOn": "Sound on (M)", "btn.sfxOff": "Sound off (M)",
      "btn.pause": "Pause (Space)", "btn.play": "Play (Space)", "btn.speed": "Speed {n}x (F)",
      "btn.darkOn": "Light levels shown (D)", "btn.darkOff": "Show the light levels (D)",
      "btn.next": "Next wave", "btn.nextEarly": "Wave now (+{n})", "btn.nextKey": "Call the next wave (N)",
      "btn.first": "First wave", "btn.lastOut": "Last wave is out", "btn.ok": "Good", "btn.cancel": "Cancel",
      "btn.again": "Try again from wave {n}", "btn.restart": "Play the night again", "btn.nextSq": "Next square",
      "btn.toMap": "Town map",
      "btn.reset": "Reset progress", "btn.resetYes": "Reset",
      "view.label": "The square: free ground, houses and columns, the gate and the fountain. Arrow keys move the cursor.",
      "st.hearts": "Hearts", "st.coins": "Coins", "st.wave": "Wave {n} of {m}", "st.waveShort": "{n}/{m}",
      "diff.m": "Mild", "diff.n": "Normal", "diff.h": "Hard",
      "bk.crate": "Crate", "bk.lantern": "Lantern", "bk.flash": "Flash lamp", "bk.mirror": "Mirror", "bk.bell": "Bell",
      "bk.lantern.a": "Bright lamp", "bk.lantern.b": "Coloured glass", "bk.flash.a": "Magnesium", "bk.flash.b": "Rapid flash",
      "bk.mirror.a": "Long mirror", "bk.mirror.b": "Prism", "bk.bell.a": "Deep bell", "bk.bell.b": "Chime",
      "fx.crate": "A cheap wall: no light, no harm, it only bends the way.",
      "fx.lantern": "Steady light that hurts every shadow in it. Shadows walk around light when they can.",
      "fx.flash": "A dark lamp: a burst every two seconds at the shadows close by. Shadows do not see it.",
      "fx.mirror": "Throws the light of a lantern next to it along a line. Turn it to aim the beam.",
      "fx.bell": "Rings: slows every shadow in reach.",
      "fx.lantern.a": "Twice the light and much wider: steers strongly.",
      "fx.lantern.b": "A small, hot light: hurts much more, close by.",
      "fx.flash.a": "Bigger bursts that tear veils.", "fx.flash.b": "Bursts twice as often, a little weaker.",
      "fx.mirror.a": "A much longer beam.", "fx.mirror.b": "Two beams at a right angle.",
      "fx.bell.a": "Slows more and tears veils.", "fx.bell.b": "Rings wider and hurts a little.",
      "sh.s": "shade", "sh.k": "skitter", "sh.m": "moth", "sh.v": "veil", "sh.g": "gloom",
      "shs.s": "shades", "shs.k": "skitters", "shs.m": "moths", "shs.v": "veils", "shs.g": "glooms",
      "act.up": "Upgrade", "act.sell": "Sell", "act.turn": "Turn", "act.locked": "Square {n}",
      "act.lv": "{t} · level {l}", "act.max": "Top level",
      "tile.free": "Free ground: build a crate or a tower.",
      "tile.ground": "Nothing can be built here.",
      "tile.gate": "The gate: the shadows come in here.", "tile.fountain": "The fountain: keep the shadows away from it.",
      "tile.block": "<strong>{t}</strong> · level {l} · {fx}", "tile.crate": "<strong>{t}</strong> · {fx}",
      "tile.sell": "Sell for {n}",
      "why.closed": "A block here would close the last way to the fountain.",
      "why.shadow": "A shadow is walking here.",
      "why.coins": "Not enough coins", "why.locked": "{t} opens on square {n}",
      "why.ground": "Nothing can be built here.",
      "ctx.next": "Next:", "ctx.done": "All waves are out. Clear the square!",
      "ctx.pick": "Tap free ground to build. The dotted line is the way the shadows will walk.",
      "map.q1": "The Harbour quarter",
      "map.intro": "Every night the shadows walk from the gate to the fountain by the darkest way they can find. Clear a square to open the next one.",
      "map.diff": "Difficulty", "map.lock": "Clear the square before it to open", "map.waves": "{n} waves",
      "map.towers": "Towers: {list}", "map.cont": "Continue: {r}, wave {n}",
      "map.replace": "A night is still under way on {r}. Start {s} instead? The night under way is given up.",
      "map.resetAsk": "Reset the stars and records on every device? The night in progress ends too.",
      "sq.q1": "Net-menders' square", "sq.q2": "Customs yard", "sq.q3": "Chapel steps", "sq.q4": "Harbour gate",
      "end.won": "The fountain is safe", "end.lost": "The shadows reached the fountain",
      "end.hearts": "Hearts left", "end.faded": "Shadows faded", "end.waves": "Waves",
      "end.wonNote": "Three stars with nine tenths of the hearts left.",
      "end.lostNote": "Try again from the start of the wave you lost, with the maze you had then.",
      "end.unlock": "{t} is now ready to build.",
      "tour.title": "How to play",
      "tour.1": "Shadows walk from the gate to the fountain. Each one that reaches it costs a heart (a gloom costs three).",
      "tour.2": "Tap free ground, then build a crate (a cheap wall) or a tower in the bar below. Tap what you built to upgrade or sell it. You can never close the last way: the game says so and refuses.",
      "tour.3": "Shadows take the darkest way, not the shortest: a lit tile counts as three steps for them. Lanterns hurt the shadows in their light, so wall off the dark ways and leave them only the lit one. Moths do the opposite and look for light.",
      "tour.4": "The dotted line always shows the way the shadows will walk. A wave starts only when you press Next wave; pause at any time and build while paused.",
      "tour.5": "Anything built since the last wave started comes back in full when you sell it; older blocks give 70%.",
      "toast.save": "Not saved: the browser's storage is full",
      "toast.reset": "Progress reset", "toast.early": "+{n} for calling the wave early",
      "live.wave": "Wave {n} of {m}: {w}.", "live.clear": "Wave {n} cleared, +{c} coins.", "live.heart": "A shadow reached the fountain. {h} hearts left.",
      "live.sel": "Column {c}, row {r}. {s}",
      "live.status": "{h} hearts, {c} coins, wave {n} of {m}."
    },
    el: {
      "app.name": "Λαβύρινθος με φανάρια",
      "btn.map": "Χάρτης της πόλης (L)", "btn.help": "Πώς παίζεται (?)",
      "btn.sfxOn": "Ήχος ανοιχτός (M)", "btn.sfxOff": "Ήχος κλειστός (M)",
      "btn.pause": "Παύση (Space)", "btn.play": "Συνέχεια (Space)", "btn.speed": "Ταχύτητα {n}x (F)",
      "btn.darkOn": "Φαίνεται πόσο φως έχει κάθε πλακάκι (D)", "btn.darkOff": "Δείξε πόσο φως έχει κάθε πλακάκι (D)",
      "btn.next": "Επόμενο κύμα", "btn.nextEarly": "Κύμα τώρα (+{n})", "btn.nextKey": "Κάλεσε το επόμενο κύμα (N)",
      "btn.first": "Πρώτο κύμα", "btn.lastOut": "Βγήκε το τελευταίο κύμα", "btn.ok": "Ωραία", "btn.cancel": "Άκυρο",
      "btn.again": "Ξανά από το κύμα {n}", "btn.restart": "Ξανά όλη η νύχτα", "btn.nextSq": "Επόμενη πλατεία",
      "btn.toMap": "Χάρτης της πόλης",
      "btn.reset": "Μηδενισμός προόδου", "btn.resetYes": "Μηδενισμός",
      "view.label": "Η πλατεία: ελεύθερο έδαφος, σπίτια και κολόνες, η πύλη και το συντριβάνι. Με τα βελάκια μετακινείς τον δείκτη.",
      "st.hearts": "Καρδιές", "st.coins": "Νομίσματα", "st.wave": "Κύμα {n} από {m}", "st.waveShort": "{n}/{m}",
      "diff.m": "Ήπιο", "diff.n": "Κανονικό", "diff.h": "Δύσκολο",
      "bk.crate": "Κιβώτιο", "bk.lantern": "Φανάρι", "bk.flash": "Φλας", "bk.mirror": "Καθρέφτης", "bk.bell": "Καμπάνα",
      "bk.lantern.a": "Λαμπερό φανάρι", "bk.lantern.b": "Χρωματιστό γυαλί", "bk.flash.a": "Μαγνήσιο", "bk.flash.b": "Γρήγορο φλας",
      "bk.mirror.a": "Μακρύς καθρέφτης", "bk.mirror.b": "Πρίσμα", "bk.bell.a": "Βαθιά καμπάνα", "bk.bell.b": "Καμπανάκια",
      "fx.crate": "Φτηνός τοίχος: ούτε φως ούτε ζημιά, μόνο στρίβει τον δρόμο.",
      "fx.lantern": "Σταθερό φως που πληγώνει κάθε σκιά μέσα του. Οι σκιές το παρακάμπτουν όταν μπορούν.",
      "fx.flash": "Σκοτεινή λάμπα: κάθε δύο δευτερόλεπτα μια λάμψη στις κοντινές σκιές. Οι σκιές δεν τη βλέπουν.",
      "fx.mirror": "Ρίχνει σε μια γραμμή το φως ενός φαναριού δίπλα του. Γύρνα τον για να σημαδέψεις.",
      "fx.bell": "Χτυπά: επιβραδύνει κάθε σκιά κοντά της.",
      "fx.lantern.a": "Διπλό φως και πολύ πιο πλατύ: στρίβει δυνατά τις σκιές.",
      "fx.lantern.b": "Μικρό, καυτό φως: πληγώνει πολύ περισσότερο, από κοντά.",
      "fx.flash.a": "Μεγαλύτερες λάμψεις που σκίζουν τα πέπλα.", "fx.flash.b": "Λάμψεις δύο φορές πιο συχνά, λίγο πιο αδύναμες.",
      "fx.mirror.a": "Πολύ μακρύτερη δέσμη.", "fx.mirror.b": "Δύο δέσμες σε ορθή γωνία.",
      "fx.bell.a": "Επιβραδύνει περισσότερο και σκίζει τα πέπλα.", "fx.bell.b": "Ακούγεται πιο μακριά και πονά λίγο.",
      "sh.s": "σκιά", "sh.k": "τρεχάλα", "sh.m": "νυχτοπεταλούδα", "sh.v": "πέπλο", "sh.g": "ζόφος",
      "shs.s": "σκιές", "shs.k": "τρεχάλες", "shs.m": "νυχτοπεταλούδες", "shs.v": "πέπλα", "shs.g": "ζόφοι",
      "act.up": "Αναβάθμιση", "act.sell": "Πούλα", "act.turn": "Γύρνα", "act.locked": "Πλατεία {n}",
      "act.lv": "{t} · επίπεδο {l}", "act.max": "Τελευταίο επίπεδο",
      "tile.free": "Ελεύθερο έδαφος: χτίσε κιβώτιο ή πύργο.",
      "tile.ground": "Εδώ δεν χτίζεται τίποτα.",
      "tile.gate": "Η πύλη: από εδώ μπαίνουν οι σκιές.", "tile.fountain": "Το συντριβάνι: κράτα τις σκιές μακριά του.",
      "tile.block": "<strong>{t}</strong> · επίπεδο {l} · {fx}", "tile.crate": "<strong>{t}</strong> · {fx}",
      "tile.sell": "Πούλα για {n}",
      "why.closed": "Εδώ θα έκλεινε ο τελευταίος δρόμος προς το συντριβάνι.",
      "why.shadow": "Εδώ περπατά μια σκιά.",
      "why.coins": "Δεν φτάνουν τα νομίσματα", "why.locked": "{t}: ανοίγει στην πλατεία {n}",
      "why.ground": "Εδώ δεν χτίζεται τίποτα.",
      "ctx.next": "Έρχονται:", "ctx.done": "Βγήκαν όλα τα κύματα. Καθάρισε την πλατεία!",
      "ctx.pick": "Πάτα ελεύθερο έδαφος για να χτίσεις. Η διακεκομμένη γραμμή δείχνει από πού θα περάσουν οι σκιές.",
      "map.q1": "Η γειτονιά του λιμανιού",
      "map.intro": "Κάθε νύχτα οι σκιές περπατούν από την πύλη ως το συντριβάνι από τον πιο σκοτεινό δρόμο που βρίσκουν. Πέρασε μια πλατεία για να ανοίξει η επόμενη.",
      "map.diff": "Δυσκολία", "map.lock": "Πέρασε πρώτα την προηγούμενη πλατεία", "map.waves": "{n} κύματα",
      "map.towers": "Πύργοι: {list}", "map.cont": "Συνέχεια: {r}, κύμα {n}",
      "map.replace": "Μια νύχτα είναι ακόμα σε εξέλιξη στην πλατεία «{r}». Να ξεκινήσει η «{s}»; Η νύχτα σε εξέλιξη χάνεται.",
      "map.resetAsk": "Να μηδενιστούν τα αστέρια και το αρχείο σε όλες τις συσκευές; Τελειώνει και η νύχτα που παίζεται.",
      "sq.q1": "Η πλατεία με τα δίχτυα", "sq.q2": "Η αυλή του τελωνείου", "sq.q3": "Τα σκαλιά του ξωκλησιού", "sq.q4": "Η πύλη του λιμανιού",
      "end.won": "Το συντριβάνι σώθηκε", "end.lost": "Οι σκιές έφτασαν στο συντριβάνι",
      "end.hearts": "Καρδιές που έμειναν", "end.faded": "Σκιές που χάθηκαν", "end.waves": "Κύματα",
      "end.wonNote": "Τρία αστέρια με τα εννιά δέκατα των καρδιών.",
      "end.lostNote": "Ξαναπροσπάθησε από την αρχή του κύματος που έχασες, με τον λαβύρινθο που είχες τότε.",
      "end.unlock": "Τώρα μπορείς να χτίσεις: {t}.",
      "tour.title": "Πώς παίζεται",
      "tour.1": "Οι σκιές περπατούν από την πύλη ως το συντριβάνι. Κάθε σκιά που φτάνει εκεί κοστίζει μία καρδιά (ο ζόφος τρεις).",
      "tour.2": "Πάτα ελεύθερο έδαφος και χτίσε στη μπάρα από κάτω ένα κιβώτιο (φτηνό τοίχο) ή έναν πύργο. Πάτα ό,τι έχτισες για να το αναβαθμίσεις ή να το πουλήσεις. Τον τελευταίο δρόμο δεν μπορείς να τον κλείσεις ποτέ: το παιχνίδι σού το λέει και δεν το δέχεται.",
      "tour.3": "Οι σκιές παίρνουν τον πιο σκοτεινό δρόμο, όχι τον πιο σύντομο: ένα φωτισμένο πλακάκι τούς μετρά για τρία βήματα. Τα φανάρια πληγώνουν τις σκιές μέσα στο φως τους, οπότε κλείσε τους σκοτεινούς δρόμους και άφησέ τους μόνο τον φωτεινό. Οι νυχτοπεταλούδες κάνουν το ανάποδο και ψάχνουν το φως.",
      "tour.4": "Η διακεκομμένη γραμμή δείχνει πάντα από πού θα περάσουν οι σκιές. Ένα κύμα ξεκινά μόνο όταν πατήσεις «Επόμενο κύμα»· κάνε παύση όποτε θέλεις και χτίζε στην παύση.",
      "tour.5": "Ό,τι έχτισες από την αρχή του τελευταίου κύματος σού επιστρέφει όλα τα νομίσματα αν το πουλήσεις· τα παλιότερα το 70%.",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος του προγράμματος περιήγησης γέμισε",
      "toast.reset": "Η πρόοδος μηδενίστηκε", "toast.early": "+{n} επειδή κάλεσες νωρίς το κύμα",
      "live.wave": "Κύμα {n} από {m}: {w}.", "live.clear": "Το κύμα {n} καθάρισε, +{c} νομίσματα.", "live.heart": "Μια σκιά έφτασε στο συντριβάνι. Έμειναν {h} καρδιές.",
      "live.sel": "Στήλη {c}, σειρά {r}. {s}",
      "live.status": "{h} καρδιές, {c} νομίσματα, κύμα {n} από {m}."
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "maze", LANG);

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
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function bkName(b) { return t("bk." + b.k + (b.l === 3 ? "." + b.b : "")); }
  function bkFx(b) { return t("fx." + b.k + (b.l === 3 ? "." + b.b : "")); }
  function sqName(id) { return t("sq." + id); }
  function shadowList(list) {
    return list.map(function (x) { return x.n + " " + t((x.n === 1 ? "sh." : "shs.") + x.k); }).join(", ");
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("maze.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Saves ----------
  var data = null, deviceId = null;
  var prefs = { diff: "n", tour: 0, last: "q1", dark: 0 };
  var sess = null;                     // { g, ck, counted }
  var game = null;                     // sess.g, the night on screen
  var saveFailShown = false;

  function loadData() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.maps && typeof parsed.maps === "object") {
          data = E.merge(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.warn("[orOS] maze: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = E.defaultData();
  }
  function saveData() {
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
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (E.DIFF[p.diff]) prefs.diff = p.diff;
        if (p.tour === 1) prefs.tour = 1;
        if (E.SQUARE[p.last]) prefs.last = p.last;
        if (p.dark === 1) prefs.dark = 1;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }
  function loadSession() {
    var x = null;
    try { x = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) {}
    if (!x || typeof x !== "object") return null;
    var g = E.normalizeRun(x.g);
    if (!g) return null;
    var ck = x.ck ? E.normalizeRun(x.ck) : null;
    return { g: g, ck: ck, counted: x.counted === true };
  }
  var saveTimer = null;
  function saveSession() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!sess) return;
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        g: E.saveable(sess.g), ck: sess.ck ? E.saveable(sess.ck) : null, counted: !!sess.counted }));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }
    }
  }
  function saveSoon() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSession, SAVE_MS);
  }
  function underWay() { return !!(sess && !sess.counted && game.over < 0); }

  // ---------- 3. The night ----------
  var sel = -1;                        // the chosen tile, -1 none
  var paused = true, speed = 1;
  var view = "map";                    // "map" | "play"

  function startNight(sqId, diff) {
    var g = E.newRun(sqId, diff);
    if (!g) return;
    sess = { g: g, ck: null, counted: false };
    game = g;
    prefs.last = sqId; prefs.diff = diff;
    savePrefs();
    sel = -1; paused = true;
    fx = [];
    saveSession();
    showPlay();
    announce(t("live.status", { h: g.hearts, c: g.coins, n: g.wave, m: g.nw }));
  }
  function retryWave() {
    if (!sess || !sess.ck) return;
    sess.g = E.clone(sess.ck); sess.g.ev = [];
    sess.counted = false;
    game = sess.g;
    sel = -1; paused = true; fx = [];
    saveSession();
    closeDialog();
    showPlay();
  }
  function done(ok) {
    if (!ok) { sfx("no"); return false; }
    sfx("build");
    saveSoon();
    barKey = "";
    renderBar(); renderStatus(); draw();
    return true;
  }
  // Build on the chosen tile; a refusal always says why (R28).
  function build(k) {
    if (sel < 0 || !game) return;
    var why = E.whyNot(game, sel, k);
    if (why) {
      if (why === "locked") showToast(t("why.locked", { t: t("bk." + k), n: E.BLOCKS[k].u }));
      else if (why === "coins") showToast(t("why.coins"));
      else if (why === "closed" || why === "shadow" || why === "ground") {
        showToast(t("why." + why));
        announce(t("why." + why));
        refused = { at: sel, life: 600 };
      }
      done(false);
      return;
    }
    done(E.build(game, sel, k));
  }
  function upgrade(branch) {
    if (sel < 0 || !game || !game.bl[sel]) return;
    var b = game.bl[sel];
    if (b.k === "crate" || b.l >= 3) return;
    if (game.coins < E.upCost(b)) { showToast(t("why.coins")); done(false); return; }
    done(E.upgrade(game, sel, branch));
  }
  function sellSel() {
    if (sel < 0 || !game || !game.bl[sel]) return;
    done(E.sell(game, sel));
  }
  function turnSel() {
    if (sel < 0 || !game || !game.bl[sel] || game.bl[sel].k !== "mirror") return;
    done(E.turn(game, sel));
  }
  function nextWave() {
    if (!game || game.over >= 0 || game.wave >= game.nw) return;
    var list = E.preview(game);
    sess.ck = E.saveable(game);
    sess.ck.ev = [];
    E.callWave(game);
    paused = false;
    sfx("wave");
    announce(t("live.wave", { n: game.wave, m: game.nw, w: shadowList(list) }));
    handleEvents();
    saveSession();
    renderAll();
  }
  // The night is over: count it once, then the end card.
  function endNight() {
    if (!sess || sess.counted) return;
    var nx = nextSqId(game.sq);
    var before = nx ? E.isOpen(data, nx) : true;
    data = E.record(data, deviceId, game, Date.now());
    sess.counted = true;
    saveData();
    saveSession();
    paused = true;
    var opened = nx && !before && E.isOpen(data, nx) ? nx : null;
    sfx(game.over === 1 ? "won" : "lost");
    endDialog(opened);
  }
  function nextSqId(id) {
    var sq = E.SQUARE[id];
    return sq && E.SQUARES[sq.idx + 1] ? E.SQUARES[sq.idx + 1].id : null;
  }

  // ---------- 4. Loop ----------
  var raf = 0, lastT = 0, acc = 0, sinceSave = 0;
  var FRAME = 1000 / E.TPS;
  function frame(now) {
    raf = 0;
    var dt = lastT ? Math.min(250, now - lastT) : 0;
    lastT = now;
    if (view === "play" && game && !paused && game.over < 0 && !dlgOpen()) {
      advance(dt * speed);
      sinceSave += dt;
      if (sinceSave >= RUN_SAVE_MS) { sinceSave = 0; saveSession(); }
    }
    ageFx(dt);
    draw();
    if (!document.hidden) raf = requestAnimationFrame(frame);
  }
  function advance(ms) {
    acc += ms;
    var n = 0;
    while (acc >= FRAME && game.over < 0 && n < 600) { E.step(game); acc -= FRAME; n++; }
    if (n) handleEvents();
  }
  function startLoop() { if (!raf && !document.hidden) { lastT = 0; raf = requestAnimationFrame(frame); } }

  // What the engine reported: sounds, effects, the live region.
  var fx = [], refused = null, lastSnd = {};
  function soundOnce(kind, ms) {
    var now = Date.now();
    if (lastSnd[kind] && now - lastSnd[kind] < ms) return;
    lastSnd[kind] = now;
    sfx(kind);
  }
  function handleEvents() {
    if (!game || !game.ev.length) return;
    var ev = game.ev; game.ev = [];
    var hurt = false, fade = 0;
    ev.forEach(function (x) {
      if (x.e === "flash") {
        var st = E.stats(game.bl[x.p] || { k: "flash", l: 1 });
        fx.push({ k: "flash", at: E.centre(x.p), r: st.r, life: 260 });
        soundOnce("flash", 120);
      } else if (x.e === "ring") {
        fx.push({ k: "ring", at: E.centre(x.p), r: E.stats(game.bl[x.p] || { k: "bell", l: 1 }).r, life: 500 });
        soundOnce("bell", 150);
      } else if (x.e === "fade") { fade++; fx.push({ k: "fade", at: { x: x.x, y: x.y }, life: 450 }); }
      else if (x.e === "leak") hurt = true;
      else if (x.e === "clear") { announce(t("live.clear", { n: x.w + 1, c: x.n })); sfx("clear"); }
      else if (x.e === "early") showToast(t("toast.early", { n: x.n }));
    });
    if (fade) soundOnce("fade", 80);
    if (hurt) {
      sfx("heart");
      announce(t("live.heart", { h: game.hearts }));
      if (window.orosHaptics) window.orosHaptics.cue("bad");
    }
    renderStatus();
    renderBar();
    if (game.over >= 0) endNight();
  }
  function ageFx(dt) {
    fx = fx.filter(function (f) { f.life -= dt; return f.life > 0; });
    if (refused) { refused.life -= dt; if (refused.life <= 0) refused = null; }
  }

  // ---------- 5. Scene ----------
  var canvas, ctx, dpr = 1, W = 0, H = 0, tile = 30, ox = 0, oy = 0;
  var reduced = false;
  var C = {};
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ["--bg", "--text", "--text-dim", "--accent", "--border", "--danger", "--panel-bg",
     "--mz-ground", "--mz-cobble", "--mz-joint", "--mz-house", "--mz-roof", "--mz-stone", "--mz-water",
     "--mz-glow", "--mz-beam", "--mz-shadow", "--mz-rim", "--mz-eye", "--mz-moth", "--mz-crate",
     "--mz-tower", "--mz-way", "--mz-ghost"].forEach(function (v) {
      C[v.slice(2)] = cs.getPropertyValue(v).trim() || "#888";
    });
  }
  function resize() {
    if (!canvas) return;
    var box = $("scene").getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = Math.max(1, Math.floor(box.width)); H = Math.max(1, Math.floor(box.height));
    canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    tile = Math.max(8, Math.min(W / E.COLS, H / E.ROWS));
    ox = (W - tile * E.COLS) / 2; oy = (H - tile * E.ROWS) / 2;
    draw();
  }
  function px(p) { return { x: ox + p.x * tile, y: oy + p.y * tile }; }
  function tx(i) { return ox + E.colOf(i) * tile; }
  function ty(i) { return oy + E.rowOf(i) * tile; }

  function draw() {
    if (!ctx || view !== "play" || !game) return;
    var sq = E.SQUARE[game.sq], f = E.fields(game);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C["mz-ground"]; ctx.fillRect(0, 0, W, H);
    for (var i = 0; i < E.N; i++) drawTile(sq, f, i);
    drawBeams(f);
    drawWays();
    for (i = 0; i < E.N; i++) if (game.bl[i]) drawBlock(game.bl[i], i);
    drawCursor(sq);
    game.sh.forEach(drawShadow);
    drawFx();
  }
  function drawTile(sq, f, i) {
    var ch = sq.ground[i], x = tx(i), y = ty(i), L = f.light[i];
    if (ch === "#") {
      ctx.fillStyle = C["mz-house"]; ctx.fillRect(x, y, tile + 0.5, tile + 0.5);
      // a roof line where the house meets open ground below
      var below = i + E.COLS;
      if (below < E.N && sq.ground[below] !== "#") { ctx.fillStyle = C["mz-roof"]; ctx.fillRect(x, y + tile * 0.82, tile + 0.5, tile * 0.18); }
      // a few small lit windows, always the same ones
      if ((E.colOf(i) * 7 + E.rowOf(i) * 3) % 5 === 0) {
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = C["mz-glow"]; ctx.fillRect(x + tile * 0.38, y + tile * 0.3, tile * 0.24, tile * 0.28);
        ctx.globalAlpha = 1;
      }
      return;
    }
    ctx.fillStyle = C["mz-cobble"]; ctx.fillRect(x, y, tile + 0.5, tile + 0.5);
    ctx.strokeStyle = C["mz-joint"]; ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, tile - 1, tile - 1);
    if (L > 0) {
      ctx.globalAlpha = 0.12 + 0.12 * L;
      ctx.fillStyle = C["mz-glow"]; ctx.fillRect(x, y, tile + 0.5, tile + 0.5);
      ctx.globalAlpha = 1;
    }
    var cx = x + tile / 2, cy = y + tile / 2;
    if (ch === "o") {
      ctx.beginPath(); ctx.arc(cx, cy, tile * 0.38, 0, Math.PI * 2);
      ctx.fillStyle = C["mz-stone"]; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, tile * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = C["mz-roof"]; ctx.fill();
    } else if (ch === "w") {
      ctx.fillStyle = C["mz-stone"]; ctx.fillRect(x + 1, y + 1, tile - 2, tile - 2);
      ctx.fillStyle = C["mz-water"]; ctx.fillRect(x + tile * 0.2, y + tile * 0.2, tile * 0.6, tile * 0.6);
    } else if (ch === "F") {
      ctx.beginPath(); ctx.arc(cx, cy, tile * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = C["mz-stone"]; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, tile * 0.32, 0, Math.PI * 2);
      ctx.fillStyle = C["mz-water"]; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, tile * 0.08, 0, Math.PI * 2);
      ctx.fillStyle = C["mz-stone"]; ctx.fill();
    } else if (ch === "G") {
      ctx.strokeStyle = C["mz-stone"]; ctx.lineWidth = Math.max(2, tile * 0.12);
      ctx.beginPath();
      ctx.moveTo(x + tile * 0.18, y + tile * 0.9); ctx.lineTo(x + tile * 0.18, y + tile * 0.45);
      ctx.arc(cx, y + tile * 0.45, tile * 0.32, Math.PI, 0);
      ctx.lineTo(x + tile * 0.82, y + tile * 0.9);
      ctx.stroke();
    }
    if (prefs.dark && L > 0 && E.isGround(sq, i) && !game.bl[i]) {
      ctx.fillStyle = C.text;
      ctx.font = "800 " + Math.max(9, Math.round(tile * 0.36)) + "px Nunito, system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(L), cx, cy);
    }
  }
  function drawBeams(f) {
    Object.keys(f.beams).forEach(function (k) {
      f.beams[k].forEach(function (line) {
        if (!line.length) return;
        var a = E.centre(+k), b = E.centre(line[line.length - 1]);
        var p = px(a), q = px(b);
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = C["mz-beam"]; ctx.lineWidth = Math.max(2, tile * 0.16); ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        ctx.globalAlpha = 1;
      });
    });
  }
  function wayLine(route, color, dash, width) {
    if (!route || route.length < 2) return;
    ctx.save();
    ctx.setLineDash(dash);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath();
    route.forEach(function (i, k) {
      var q = px(E.centre(i));
      if (k) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
    });
    ctx.stroke();
    ctx.restore();
  }
  // The way of the shadows (dots), of the moths (dashes) when moths come
  // on this square, and the way it would become with a block on the
  // chosen free tile (a light line).
  function drawWays() {
    var dot = Math.max(2, tile * 0.1);
    E.routes(game, false).forEach(function (r) { wayLine(r, C["mz-way"], [dot, dot * 2.2], dot); });
    if (E.hasMoths(game.sq)) E.routes(game, true).forEach(function (r) { wayLine(r, C["mz-moth"], [dot * 3, dot * 2.5], dot * 0.8); });
    if (sel >= 0 && !game.bl[sel] && E.isGround(E.SQUARE[game.sq], sel) && game.over < 0) {
      var w = E.routeWith(game, sel), now = E.routes(game, false);
      if (w) w.forEach(function (r, k) {
        if (r.join() !== (now[k] || []).join()) wayLine(r, C["mz-ghost"], [], Math.max(1.5, tile * 0.06));
      });
    }
  }
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  // Each block has its own outline (never only a colour).
  function drawBlock(b, i) {
    var x = tx(i), y = ty(i), cx = x + tile / 2, cy = y + tile / 2, r = tile * 0.34;
    if (b.k === "crate") {
      var m = tile * 0.12;
      rr(x + m, y + m, tile - 2 * m, tile - 2 * m, tile * 0.08);
      ctx.fillStyle = C["mz-crate"]; ctx.fill();
      ctx.strokeStyle = C["mz-joint"]; ctx.lineWidth = Math.max(1, tile * 0.05); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + m, y + m); ctx.lineTo(x + tile - m, y + tile - m);
      ctx.moveTo(x + tile - m, y + m); ctx.lineTo(x + m, y + tile - m); ctx.stroke();
      return;
    }
    ctx.fillStyle = C["mz-tower"]; ctx.strokeStyle = C["mz-tower"];
    ctx.lineWidth = Math.max(1.5, r * 0.18); ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (b.k === "lantern") {
      // a lamp: a cap, a glass body, a warm flame
      ctx.beginPath(); ctx.moveTo(cx - r * 0.45, cy - r * 0.7); ctx.lineTo(cx + r * 0.45, cy - r * 0.7); ctx.stroke();
      rr(cx - r * 0.5, cy - r * 0.6, r, r * 1.3, r * 0.2); ctx.stroke();
      var fl = E.stats(b).li ? C["mz-glow"] : C["mz-beam"];
      ctx.beginPath(); ctx.arc(cx, cy + r * 0.05, r * 0.26, 0, Math.PI * 2); ctx.fillStyle = fl; ctx.fill();
    } else if (b.k === "flash") {
      // a star burst
      ctx.beginPath();
      for (var k = 0; k < 8; k++) {
        var a = k * Math.PI / 4, rr2 = k % 2 ? r * 0.45 : r;
        ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2);
      }
      ctx.stroke();
    } else if (b.k === "mirror") {
      // a disc with the beam direction marked
      ctx.beginPath(); ctx.ellipse(cx, cy, r * 0.8, r * 0.8, 0, 0, Math.PI * 2); ctx.stroke();
      var dirs = E.stats(b).two ? [b.d, (b.d + 1) % 4] : [b.d];
      dirs.forEach(function (d) {
        var dx = E.DIRS[d][0], dy = E.DIRS[d][1];
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + dx * r * 1.15, cy + dy * r * 1.15); ctx.stroke();
      });
    } else {
      ctx.beginPath(); ctx.moveTo(cx - r * 0.75, cy + r * 0.6);
      ctx.quadraticCurveTo(cx - r * 0.65, cy - r, cx, cy - r);
      ctx.quadraticCurveTo(cx + r * 0.65, cy - r, cx + r * 0.75, cy + r * 0.6);
      ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy + r * 0.8, r * 0.18, 0, Math.PI * 2); ctx.fill();
    }
    // level: one, two or three dots under the tower
    ctx.fillStyle = C.accent;
    for (var j = 0; j < b.l; j++) {
      ctx.beginPath(); ctx.arc(cx + (j - (b.l - 1) / 2) * r * 0.5, y + tile * 0.9, Math.max(1.3, r * 0.1), 0, Math.PI * 2); ctx.fill();
    }
  }
  function drawCursor(sq) {
    if (refused) {
      ctx.globalAlpha = Math.min(1, refused.life / 300) * 0.7;
      ctx.fillStyle = C.danger; ctx.fillRect(tx(refused.at), ty(refused.at), tile, tile);
      ctx.globalAlpha = 1;
    }
    if (sel < 0) return;
    var b = game.bl[sel];
    if (b && b.k !== "crate") drawReach(b, sel);
    ctx.lineWidth = Math.max(2, tile * 0.09);
    ctx.strokeStyle = C.accent;
    ctx.strokeRect(tx(sel) + 1.5, ty(sel) + 1.5, tile - 3, tile - 3);
  }
  function drawReach(b, i) {
    var st = E.stats(b);
    if (!st || !st.r) return;
    var c = px(E.centre(i));
    ctx.beginPath(); ctx.arc(c.x, c.y, st.r * tile, 0, Math.PI * 2);
    ctx.globalAlpha = 0.12; ctx.fillStyle = C.accent; ctx.fill();
    ctx.globalAlpha = 1; ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5; ctx.stroke();
  }
  // Each kind has its own outline; two pale eyes; a health bar.
  function drawShadow(s) {
    var q = px(s), r = tile * (s.k === "g" ? 0.42 : s.k === "k" ? 0.2 : 0.27);
    ctx.fillStyle = s.k === "m" ? C["mz-moth"] : C["mz-shadow"];
    ctx.strokeStyle = C["mz-rim"];
    ctx.lineWidth = Math.max(1, tile * 0.05);
    ctx.beginPath();
    if (s.k === "k") {
      ctx.moveTo(q.x, q.y - r * 1.4); ctx.quadraticCurveTo(q.x + r * 1.1, q.y, q.x, q.y + r);
      ctx.quadraticCurveTo(q.x - r * 1.1, q.y, q.x, q.y - r * 1.4);
    } else if (s.k === "m") {
      ctx.moveTo(q.x, q.y - r * 1.15); ctx.lineTo(q.x + r * 1.15, q.y); ctx.lineTo(q.x, q.y + r * 1.15); ctx.lineTo(q.x - r * 1.15, q.y); ctx.closePath();
    } else if (s.k === "v") {
      for (var i = 0; i < 6; i++) {
        var a = Math.PI / 6 + i * Math.PI / 3;
        if (i) ctx.lineTo(q.x + Math.cos(a) * r, q.y + Math.sin(a) * r); else ctx.moveTo(q.x + Math.cos(a) * r, q.y + Math.sin(a) * r);
      }
      ctx.closePath();
    } else if (s.k === "g") {
      ctx.ellipse(q.x, q.y, r * 1.35, r * 0.8, 0, 0, Math.PI * 2);
    } else ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    if (s.ar) { ctx.lineWidth = Math.max(1.5, r * 0.3); ctx.strokeStyle = C["mz-stone"]; ctx.stroke(); }
    ctx.fillStyle = C["mz-eye"];
    var e = Math.max(1, r * 0.17);
    ctx.beginPath(); ctx.arc(q.x - r * 0.35, q.y - r * 0.12, e, 0, Math.PI * 2); ctx.arc(q.x + r * 0.35, q.y - r * 0.12, e, 0, Math.PI * 2); ctx.fill();
    if (s.hp < s.mx) {
      var bw = Math.max(tile * 0.5, r * 2), fr = Math.max(0, s.hp / s.mx);
      ctx.fillStyle = C.border; ctx.fillRect(q.x - bw / 2, q.y - r - 6, bw, 3);
      ctx.fillStyle = C.accent; ctx.fillRect(q.x - bw / 2, q.y - r - 6, bw * fr, 3);
    }
    if (s.st > 0 && s.sl > 0) {
      ctx.strokeStyle = C["mz-water"]; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(q.x, q.y, r + 3, 0, Math.PI * 2); ctx.stroke();
    }
  }
  function drawFx() {
    fx.forEach(function (f) {
      var c = px(f.at);
      if (f.k === "flash") {
        ctx.globalAlpha = (reduced ? 0.25 : 0.55) * f.life / 260;
        ctx.fillStyle = C["mz-beam"];
        ctx.beginPath(); ctx.arc(c.x, c.y, f.r * tile, 0, Math.PI * 2); ctx.fill();
      } else if (f.k === "ring") {
        var k = reduced ? 1 : 1 - f.life / 500;
        ctx.globalAlpha = (reduced ? 0.35 : 0.5) * f.life / 500;
        ctx.strokeStyle = C["mz-water"]; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(2, f.r * tile * k), 0, Math.PI * 2); ctx.stroke();
      } else if (f.k === "fade") {
        ctx.globalAlpha = 0.6 * f.life / 450;
        ctx.fillStyle = C["mz-rim"];
        ctx.beginPath(); ctx.arc(c.x, c.y - (reduced ? 0 : (1 - f.life / 450) * tile * 0.4), tile * 0.25, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    });
  }

  // ---------- 6. Input ----------
  function tileAt(clientX, clientY) {
    var r = canvas.getBoundingClientRect();
    var c = Math.floor((clientX - r.left - ox) / tile), w = Math.floor((clientY - r.top - oy) / tile);
    if (c < 0 || c >= E.COLS || w < 0 || w >= E.ROWS) return -1;
    return E.idx(c, w);
  }
  function tileText(i) {
    var sq = E.SQUARE[game.sq], ch = sq.ground[i], b = game.bl[i];
    if (b) return t("act.lv", { t: bkName(b), l: b.l });
    if (ch === "G") return t("tile.gate");
    if (ch === "F") return t("tile.fountain");
    if (ch !== ".") return t("tile.ground");
    return t("tile.free");
  }
  function select(i, quiet) {
    sel = i;
    barKey = "";
    renderBar(); draw();
    if (i >= 0 && !quiet) announce(t("live.sel", { c: E.colOf(i) + 1, r: E.rowOf(i) + 1, s: tileText(i) }));
  }
  var drag = null;                     // { id, start, moved, was }
  function wireInput() {
    canvas.addEventListener("pointerdown", function (e) {
      if (view !== "play" || !game) return;
      e.preventDefault();
      canvas.focus({ preventScroll: true });
      try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
      var i = tileAt(e.clientX, e.clientY);
      drag = { id: e.pointerId, start: i, moved: false, was: sel };
      if (i !== sel) select(i, true);
    });
    // a finger drags the cursor, so the thumb never hides the tile
    canvas.addEventListener("pointermove", function (e) {
      if (!drag || drag.id !== e.pointerId) return;
      var i = tileAt(e.clientX, e.clientY);
      if (i >= 0 && i !== sel) { drag.moved = true; select(i, true); }
    });
    function up(e) {
      if (!drag || drag.id !== e.pointerId) return;
      var d = drag; drag = null;
      if (!d.moved && d.start === d.was && d.start >= 0) { select(-1); return; }  // tap the chosen tile again: let go
      if (sel >= 0) announce(t("live.sel", { c: E.colOf(sel) + 1, r: E.rowOf(sel) + 1, s: tileText(sel) }));
    }
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", function () { drag = null; });
  }
  function moveCursor(dx, dy) {
    if (sel < 0) {
      var sq = E.SQUARE[game.sq];
      select(sq.gates[0]);
      return;
    }
    var c = Math.max(0, Math.min(E.COLS - 1, E.colOf(sel) + dx));
    var r = Math.max(0, Math.min(E.ROWS - 1, E.rowOf(sel) + dy));
    select(E.idx(c, r));
  }
  function toggleDark() {
    prefs.dark = prefs.dark ? 0 : 1;
    savePrefs();
    barKey = "";
    renderBar(); draw();
  }
  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (dlgOpen()) return;
      var k = e.key;
      if (k === "m" || k === "M") { toggleSfx(); e.preventDefault(); return; }
      if (k === "?") { tourDialog(); e.preventDefault(); return; }
      if (k === "l" || k === "L") { showMap(); e.preventDefault(); return; }
      if (view !== "play" || !game) return;
      var tag = (e.target && e.target.tagName) || "";
      if (k === " " && tag === "BUTTON") return;
      var b = sel >= 0 ? game.bl[sel] : null;
      var handled = true;
      if (k === "ArrowLeft") moveCursor(-1, 0);
      else if (k === "ArrowRight") moveCursor(1, 0);
      else if (k === "ArrowUp") moveCursor(0, -1);
      else if (k === "ArrowDown") moveCursor(0, 1);
      else if (k === " ") togglePause();
      else if (k === "f" || k === "F") cycleSpeed();
      else if (k === "n" || k === "N") nextWave();
      else if (k === "d" || k === "D") toggleDark();
      else if (k === "Escape") select(-1);
      else if ((k === "c" || k === "C" || k === "0") && sel >= 0 && !b) build("crate");
      else if (/^[1-4]$/.test(k) && sel >= 0 && !b) build(E.KINDS[+k - 1]);
      else if ((k === "u" || k === "U") && b && b.k !== "crate" && b.l === 1) upgrade("");
      else if ((k === "a" || k === "A" || k === "b" || k === "B") && b && b.k !== "crate" && b.l === 2) upgrade(k.toLowerCase());
      else if ((k === "s" || k === "S") && b) sellSel();
      else if ((k === "r" || k === "R") && b && b.k === "mirror") turnSel();
      else handled = false;
      if (handled) e.preventDefault();
    });
  }

  // ---------- 7. Toolbar + bottom bar ----------
  function setStat(id, icon, v, label) {
    var n = $(id);
    n.querySelector(".ic").innerHTML = icon;
    n.querySelector(".v").textContent = v;
    n.title = label;
    n.setAttribute("aria-label", label);
  }
  function renderStatus() {
    if (!game) return;
    setStat("s-hearts", ICONS.heart, game.hearts, t("st.hearts") + ": " + game.hearts);
    $("s-hearts").classList.toggle("low", game.hearts <= Math.ceil(game.hmax / 4));
    setStat("s-coins", ICONS.coin, Math.floor(game.coins), t("st.coins") + ": " + Math.floor(game.coins));
    setStat("s-wave", ICONS.wave, t("st.waveShort", { n: game.wave, m: game.nw }), t("st.wave", { n: game.wave, m: game.nw }));
  }
  function buildBtn(k) {
    var b = el("button", "act");
    b.type = "button";
    var on = E.unlocked(game, k), c = E.buildCost(k);
    if (!on) b.classList.add("locked");
    b.innerHTML = ICONS[k];
    b.appendChild(el("span", "nm", t("bk." + k)));
    b.appendChild(el("span", "cost", on ? String(c) : t("act.locked", { n: E.BLOCKS[k].u })));
    var key = k === "crate" ? "C" : String(E.KINDS.indexOf(k) + 1);
    b.disabled = on && game.coins < c;
    b.title = t("bk." + k) + ": " + t("fx." + k) + " (" + key + ")";
    b.setAttribute("aria-label", b.title + (on ? ", " + c : ""));
    b.addEventListener("click", function () { build(k); });
    return b;
  }
  function actBtn(icon, name, cost, title, fn, disabled) {
    var b = el("button", "act");
    b.type = "button";
    b.innerHTML = icon;
    b.appendChild(el("span", "nm", name));
    if (cost !== "") b.appendChild(el("span", "cost", cost));
    b.title = title; b.setAttribute("aria-label", title);
    b.disabled = !!disabled;
    b.addEventListener("click", fn);
    return b;
  }
  var barKey = "";
  function renderBar() {
    if (!game) return;
    var pb = $("pause-btn");
    pb.innerHTML = paused ? ICONS.play : ICONS.pause;
    pb.title = t(paused ? "btn.play" : "btn.pause");
    pb.setAttribute("aria-label", pb.title);
    pb.setAttribute("aria-pressed", paused ? "true" : "false");
    pb.disabled = game.over >= 0;
    var sb = $("speed-btn");
    sb.textContent = speed + "x";
    sb.title = t("btn.speed", { n: speed }); sb.setAttribute("aria-label", sb.title);
    var db = $("dark-btn");
    db.innerHTML = ICONS.eye;
    db.setAttribute("aria-pressed", prefs.dark ? "true" : "false");
    db.title = t(prefs.dark ? "btn.darkOn" : "btn.darkOff"); db.setAttribute("aria-label", db.title);
    var nb = $("next-btn"), left = E.shadowsLeft(game);
    nb.querySelector(".ic").innerHTML = ICONS.wave;
    nb.querySelector(".lb").textContent = game.wave >= game.nw ? t("btn.lastOut") : game.wave === 0 ? t("btn.first") :
      left ? t("btn.nextEarly", { n: left }) : t("btn.next");
    nb.disabled = game.over >= 0 || game.wave >= game.nw;
    nb.title = t("btn.nextKey");
    // the context row: the chosen tile, or what comes next
    var b = sel >= 0 ? game.bl[sel] : null;
    var why = sel >= 0 && !b ? E.whyNot(game, sel, "crate") : "";
    var key = [sel, b ? JSON.stringify(b) : "", Math.floor(game.coins), game.wave, game.over, why, LANG].join("|");
    if (key === barKey) return;
    barKey = key;
    var row = $("bar-ctx"), tip = $("tip");
    row.textContent = "";
    if (sel < 0) {
      tip.hidden = true;
      var tx2 = el("div", "ctx-text");
      if (game.wave >= game.nw) tx2.appendChild(el("span", "", t("ctx.done")));
      else {
        var s1 = el("span", "");
        s1.appendChild(el("strong", "", t("ctx.next")));
        tx2.appendChild(s1);
        E.preview(game).forEach(function (x) {
          var g = el("span", "fg");
          g.innerHTML = ICONS["sh_" + x.k] || "";
          g.appendChild(document.createTextNode(x.n + " " + t((x.n === 1 ? "sh." : "shs.") + x.k)));
          tx2.appendChild(g);
        });
        if (game.wave === 0 && !Object.keys(game.bl).length) tx2.appendChild(el("span", "", t("ctx.pick")));
      }
      row.appendChild(tx2);
      return;
    }
    tip.hidden = false;
    // the tip covers the half of the square the chosen tile is not in
    tip.classList.toggle("low", E.rowOf(sel) < E.ROWS / 2);
    var sq = E.SQUARE[game.sq];
    if (!b) {
      if (!E.isGround(sq, sel)) {
        tip.textContent = tileText(sel);
        row.appendChild(el("div", "ctx-text", tileText(sel)));
        return;
      }
      tip.textContent = why === "closed" || why === "shadow" ? t("why." + why) : t("tile.free");
      tip.classList.toggle("warn", why === "closed" || why === "shadow");
      BUILD_KEYS.forEach(function (k) { row.appendChild(buildBtn(k)); });
      return;
    }
    tip.classList.remove("warn");
    if (b.k === "crate") tip.innerHTML = t("tile.crate", { t: esc(bkName(b)), fx: esc(bkFx(b)) });
    else tip.innerHTML = t("tile.block", { t: esc(bkName(b)), l: b.l, fx: esc(bkFx(b)) });
    if (b.k !== "crate") {
      var uc = E.upCost(b);
      if (b.l === 1) {
        row.appendChild(actBtn(ICONS.up, t("act.up"), String(uc), t("act.up") + " (U): " + t("bk." + b.k) + " 2, " + uc, function () { upgrade(""); }, game.coins < uc));
      } else if (b.l === 2) {
        ["a", "b"].forEach(function (br) {
          var nm = t("bk." + b.k + "." + br);
          row.appendChild(actBtn(ICONS.up, nm, String(uc), nm + " (" + br.toUpperCase() + "): " + t("fx." + b.k + "." + br) + " " + uc, function () { upgrade(br); }, game.coins < uc));
        });
      } else {
        row.appendChild(actBtn(ICONS.star, t("act.max"), "", t("act.max"), function () {}, true));
      }
      if (b.k === "mirror") row.appendChild(actBtn(ICONS.turn, t("act.turn"), "", t("act.turn") + " (R)", turnSel));
    }
    var sv = E.sellValue(b);
    row.appendChild(actBtn(ICONS.sell, t("act.sell"), "+" + sv, t("tile.sell", { n: sv }) + " (S)", sellSel));
  }
  function togglePause() {
    if (!game || game.over >= 0) return;
    paused = !paused;
    if (paused) saveSession();
    renderBar();
  }
  function cycleSpeed() {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    renderBar();
  }
  function renderAll() { renderStatus(); barKey = ""; renderBar(); draw(); }

  function showPlay() {
    view = "play";
    document.body.classList.add("playing");
    $("map").hidden = true;
    resize();
    renderAll();
    canvas.focus({ preventScroll: true });
  }

  // ---------- 8. Town map ----------
  function showMap() {
    if (view === "play" && game && underWay()) { paused = true; saveSession(); }
    view = "map";
    sel = -1;
    document.body.classList.remove("playing");
    $("tip").hidden = true;
    renderMap();
    $("map").hidden = false;
  }
  function starIcons(n) {
    var s = el("span", "st");
    for (var i = 0; i < 3; i++) {
      var x = el("span", i < n ? "" : "off");
      x.innerHTML = ICONS.star;
      s.appendChild(x);
    }
    return s;
  }
  function renderMap() {
    var box = $("map");
    box.textContent = "";
    var wrap = el("div", "mp-wrap");
    wrap.appendChild(el("p", "mp-intro", t("map.intro")));
    if (underWay()) {
      var cont = el("button", "mp-cont", t("map.cont", { r: sqName(game.sq), n: Math.max(1, game.wave) }));
      cont.type = "button";
      cont.addEventListener("click", showPlay);
      wrap.appendChild(cont);
    }
    wrap.appendChild(el("div", "mp-head", t("map.diff")));
    var seg = el("div", "seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", t("map.diff"));
    E.DIFFS.forEach(function (d) {
      var b = el("button", "", t("diff." + d));
      b.type = "button";
      b.setAttribute("aria-pressed", prefs.diff === d ? "true" : "false");
      b.addEventListener("click", function () { prefs.diff = d; savePrefs(); renderMap(); });
      seg.appendChild(b);
    });
    wrap.appendChild(seg);
    wrap.appendChild(el("div", "mp-head", t("map.q1")));
    E.SQUARES.forEach(function (sq) {
      var open = E.isOpen(data, sq.id);
      var b = el("button", "sq-card" + (underWay() && game.sq === sq.id ? " cur" : ""));
      b.type = "button";
      b.disabled = !open;
      b.appendChild(el("span", "no", String(sq.idx + 1)));
      var tx2 = el("span", "tx");
      tx2.appendChild(el("span", "nm", sqName(sq.id)));
      var kinds = E.KINDS.filter(function (k) { return E.BLOCKS[k].u <= Math.min(4, sq.idx + 1); }).map(function (k) { return t("bk." + k); });
      tx2.appendChild(el("span", "fx", open ? t("map.waves", { n: sq.waves.length }) + " · " + t("map.towers", { list: kinds.join(", ") }) : t("map.lock")));
      b.appendChild(tx2);
      b.appendChild(starIcons(E.starsOf(data, sq.id)));
      b.setAttribute("aria-label", sqName(sq.id) + ", " + E.starsOf(data, sq.id) + "/3");
      b.addEventListener("click", function () { pickSquare(sq.id); });
      wrap.appendChild(b);
    });
    var rs = el("button", "dlg-btn danger mp-reset", t("btn.reset"));
    rs.type = "button";
    rs.addEventListener("click", function () {
      confirmDialog(t("map.resetAsk"), t("btn.resetYes"), resetProgress);
    });
    wrap.appendChild(rs);
    box.appendChild(wrap);
  }
  function pickSquare(id) {
    if (underWay() && game.acts > 0 && (game.sq !== id || game.diff !== prefs.diff)) {
      confirmDialog(t("map.replace", { r: sqName(game.sq), s: sqName(id) }), t("btn.ok"), function () { startNight(id, prefs.diff); });
      return;
    }
    if (underWay() && game.sq === id && game.diff === prefs.diff) { showPlay(); return; }
    startNight(id, prefs.diff);
  }
  // Reset progress: a new reset stamp, so older rows drop on every device.
  // The night in progress ends too (not counted): a reset that left it on
  // screen, with Continue, read as "nothing was reset".
  function resetProgress() {
    data = E.merge({ ver: 1, br: Math.max(Date.now(), data.br + 1), maps: {}, rows: {} }, data);
    saveData();
    if (sess && !sess.counted) { sess.counted = true; paused = true; saveSession(); }
    showToast(t("toast.reset"));
    renderMap();
  }

  // ---------- 9. Dialogs ----------
  var dlgKind = "";
  function dlgOpen() { return $("dlg").open; }
  function openDialog(kind, fill) {
    var d = $("dlg");
    if (d.open) d.close();
    d.textContent = "";
    dlgKind = kind;
    fill(d);
    try { d.showModal(); } catch (e) { d.setAttribute("open", ""); }
    var f = d.querySelector(".primary") || d.querySelector("button");
    if (f) f.focus();
  }
  function closeDialog() { var d = $("dlg"); if (d.open) d.close(); dlgKind = ""; }
  function dlgBtn(text, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), text);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  function row(label, value) {
    var r = el("div", "dlg-row");
    r.appendChild(el("span", "", label));
    r.appendChild(el("strong", "", String(value)));
    return r;
  }
  function endDialog(opened) {
    var g = game, won = g.over === 1;
    openDialog("end", function (d) {
      d.appendChild(el("div", "dlg-title", sqName(g.sq) + " · " + t("diff." + g.diff)));
      d.appendChild(el("div", "dlg-hero", t(won ? "end.won" : "end.lost")));
      var st = el("div", "dlg-stars");
      for (var i = 0; i < 3; i++) { var s = el("span", i < E.stars(g) ? "" : "off"); s.innerHTML = ICONS.star; st.appendChild(s); }
      if (won) d.appendChild(st);
      d.appendChild(row(t("end.hearts"), g.hearts + " / " + g.hmax));
      d.appendChild(row(t("end.waves"), g.wave + " / " + g.nw));
      d.appendChild(row(t("end.faded"), g.faded));
      d.appendChild(el("p", "dlg-note", t(won ? "end.wonNote" : "end.lostNote")));
      if (opened) {
        var nk = E.KINDS.filter(function (k) { return E.BLOCKS[k].u === E.SQUARE[opened].idx + 1; });
        if (nk.length) d.appendChild(el("p", "dlg-note", t("end.unlock", { t: t("bk." + nk[0]) })));
      }
      var a = el("div", "dlg-actions");
      if (!won && sess.ck) a.appendChild(dlgBtn(t("btn.again", { n: sess.ck.wave + 1 }), "primary", retryWave));
      var nx = nextSqId(g.sq);
      if (won && nx) a.appendChild(dlgBtn(t("btn.nextSq"), "primary", function () { closeDialog(); startNight(nx, g.diff); }));
      a.appendChild(dlgBtn(t("btn.restart"), "", function () { closeDialog(); startNight(g.sq, g.diff); }));
      a.appendChild(dlgBtn(t("btn.toMap"), "", function () { closeDialog(); showMap(); }));
      d.appendChild(a);
    });
  }
  function tourDialog() {
    if (view === "play" && game && !paused) { paused = true; renderBar(); saveSession(); }
    openDialog("tour", function (d) {
      d.appendChild(el("div", "dlg-title", t("tour.title")));
      var ul = el("ul", "dlg-list");
      for (var i = 1; i <= 5; i++) ul.appendChild(el("li", "", t("tour." + i)));
      d.appendChild(ul);
      var a = el("div", "dlg-actions");
      a.appendChild(dlgBtn(t("btn.ok"), "primary", function () { prefs.tour = 1; savePrefs(); closeDialog(); }));
      d.appendChild(a);
    });
  }
  function confirmDialog(msg, yes, fn) {
    openDialog("confirm", function (d) {
      d.appendChild(el("p", "dlg-msg", msg));
      var a = el("div", "dlg-actions");
      a.appendChild(dlgBtn(t("btn.cancel"), "", closeDialog));
      a.appendChild(dlgBtn(yes, "primary danger", function () { closeDialog(); fn(); }));
      d.appendChild(a);
    });
  }

  // ---------- 10. Toasts + live region ----------
  var toastTimer = null;
  function showToast(msg) {
    var n = $("toast");
    n.textContent = msg;
    n.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { n.classList.remove("show"); }, 2600);
  }
  function announce(msg) { $("live").textContent = msg; }

  // ---------- 11. Sound ----------
  var audio = null;
  function sfxOn() {
    try { return localStorage.getItem(SFX_KEY) === "1"; } catch (e) { return false; }
  }
  function tone(freq, start, dur, type, vol, to) {
    var t0 = audio.currentTime + start;
    var o = audio.createOscillator(), g = audio.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(vol || 0.1, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(audio.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  var HAPTIC = { build: "tick", no: "bad", won: "good", wave: "tick" };
  function sfx(kind) {
    if (window.orosHaptics && HAPTIC[kind]) window.orosHaptics.cue(HAPTIC[kind]);
    if (!sfxOn()) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio) audio = new AC();
      if (audio.state === "suspended") audio.resume();
      if (kind === "flash") tone(1400, 0, 0.08, "square", 0.02, 700);
      else if (kind === "bell") { tone(660, 0, 0.6, "sine", 0.05); tone(990, 0, 0.4, "sine", 0.02); }
      else if (kind === "fade") tone(1200, 0, 0.12, "sine", 0.025, 1600);
      else if (kind === "heart") tone(110, 0, 0.5, "sawtooth", 0.05, 80);
      else if (kind === "build") { tone(180, 0, 0.08, "triangle", 0.08, 120); tone(520, 0.04, 0.08, "sine", 0.05); }
      else if (kind === "wave") { tone(220, 0, 0.3, "triangle", 0.06); tone(294, 0.12, 0.3, "triangle", 0.05); }
      else if (kind === "clear") [523, 659, 784].forEach(function (f, k) { tone(f, k * 0.08, 0.16, "sine", 0.05); });
      else if (kind === "won") [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.1, 0.22, "triangle", 0.07); });
      else if (kind === "lost") [392, 330, 262].forEach(function (f, k) { tone(f, k * 0.14, 0.3, "sine", 0.06); });
      else if (kind === "no") tone(170, 0, 0.14, "sawtooth", 0.04);
      else if (kind === "toggle") { tone(1047, 0, 0.05, "sine", 0.06); tone(1319, 0.04, 0.07, "sine", 0.05); }
    } catch (e) { /* no audio → silent */ }
  }
  function toggleSfx() {
    try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
    paintSfxBtn();
    sfx("toggle");
  }

  // ---------- Icons (R9: icon buttons ship empty, filled here) ----------
  var SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var ICONS = {
    map:    SVG + '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/></svg>',
    help:   SVG + '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7"/><path d="M12 17h.01"/></svg>',
    sfxOn:  SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    sfxOff: SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
    heart:  SVG + '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/></svg>',
    coin:   SVG + '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10h5M9.5 14h5"/></svg>',
    wave:   SVG + '<path d="M4 20c3-3 3-6 0-9M10 20c3-3 3-6 0-9M16 20c3-3 3-6 0-9"/><path d="M4 7h16"/></svg>',
    eye:    SVG + '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    play:   SVG + '<path d="M7 4l13 8-13 8z"/></svg>',
    pause:  SVG + '<path d="M8 4v16M16 4v16"/></svg>',
    up:     SVG + '<path d="M12 20V5M5 12l7-7 7 7"/></svg>',
    sell:   SVG + '<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/></svg>',
    turn:   SVG + '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>',
    star:   SVG + '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill="currentColor"/></svg>',
    crate:  SVG + '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 4l16 16M20 4 4 20"/></svg>',
    lantern: SVG + '<path d="M9 3h6M8 6h8l-1 12H9z"/><path d="M10 21h4"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>',
    flash:  SVG + '<path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.5 3.5M15.5 15.5 19 19M19 5l-3.5 3.5M8.5 15.5 5 19"/></svg>',
    mirror: SVG + '<circle cx="12" cy="12" r="7"/><path d="M12 12h10"/></svg>',
    bell:   SVG + '<path d="M6 17c0-6 1-11 6-11s6 5 6 11z"/><path d="M4 17h16M12 20v.01"/></svg>',
    sh_s:   SVG + '<circle cx="12" cy="12" r="6"/></svg>',
    sh_k:   SVG + '<path d="M12 4c4 5 5 8 5 10a5 5 0 0 1-10 0c0-2 1-5 5-10z"/></svg>',
    sh_m:   SVG + '<path d="M12 4l8 8-8 8-8-8z"/></svg>',
    sh_v:   SVG + '<path d="M12 5l6 3.5v7L12 19l-6-3.5v-7z"/></svg>',
    sh_g:   SVG + '<ellipse cx="12" cy="12" rx="9" ry="5"/></svg>'
  };
  function paintSfxBtn() {
    var b = $("sfx-btn"), on = sfxOn();
    b.innerHTML = on ? ICONS.sfxOn : ICONS.sfxOff;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.setAttribute("aria-label", t(on ? "btn.sfxOn" : "btn.sfxOff"));
    b.title = t(on ? "btn.sfxOn" : "btn.sfxOff");
  }

  // ---------- 12. Sync slice + palette ----------
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
    // standalone (no shell): the page itself would be watched, and every
    // inheritPalette would trigger it again
    try { if (window.parent === window) return; } catch (e) { return; }
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
    // LOCAL FIRST: loadData() has already run (boot order).
    var api = syncApi();
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("maze", sliceGet, sliceSet, STORAGE_KEY, mergeMaze);
  }
  function mergeMaze(a, b) { return E.merge(a, b); }
  function sliceGet() { return data; }
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.maps) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      var m = E.merge(data, incoming);
      if (JSON.stringify(m) === JSON.stringify(data)) return;
      data = m;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
      if (view === "map") renderMap();
    } finally {
      window.__orosSyncApi._suppress = false;
    }
  }

  // ---------- 13. Test hooks, wiring & boot ----------
  // render_game_to_text: the visible state as JSON. Coordinates are
  // tiles of the 12 × 18 map, origin top left (c column, r row; x, y
  // the centre of a shadow, in tiles).
  window.render_game_to_text = function () {
    if (view !== "play" || !game) {
      return JSON.stringify({ mode: dlgKind || "map", diff: prefs.diff,
        squares: E.SQUARES.map(function (sq) { return { id: sq.id, open: E.isOpen(data, sq.id), stars: E.starsOf(data, sq.id) }; }) });
    }
    var f = E.fields(game);
    function cr(i) { return [E.colOf(i), E.rowOf(i)]; }
    return JSON.stringify({
      mode: dlgKind || (game.over === 1 ? "won" : game.over === 0 ? "lost" : paused ? "paused" : "running"),
      square: game.sq, diff: game.diff, speed: speed, hearts: game.hearts, coins: Math.floor(game.coins),
      wave: game.wave, waves: game.nw, next: E.preview(game), sel: sel >= 0 ? cr(sel) : null,
      blocks: Object.keys(game.bl).map(function (i) {
        var b = game.bl[i];
        return { c: E.colOf(+i), r: E.rowOf(+i), k: b.k, l: b.l, b: b.b, d: b.k === "mirror" ? b.d : undefined };
      }),
      way: E.routes(game, false).map(function (r) { return r.map(cr); }),
      lit: f.light.reduce(function (n, L) { return n + (L > 0 ? 1 : 0); }, 0),
      shadows: game.sh.map(function (s) {
        return { k: s.k, x: Math.round(s.x * 10) / 10, y: Math.round(s.y * 10) / 10, hp: Math.ceil(s.hp) };
      }),
      note: "tiles 12x18, origin top left; way = tiles from the gate to the fountain"
    });
  };
  // advanceTime(ms): steps the night deterministically at the current
  // speed, as if that much real time passed while playing.
  window.advanceTime = function (ms) {
    if (view !== "play" || !game || paused) { draw(); return; }
    advance(Math.max(0, +ms || 0) * speed);
    draw();
  };

  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    document.title = t("app.name") + " · orOS";
    canvas.setAttribute("aria-label", t("view.label"));
    [["map-btn", "map", "btn.map"], ["help-btn", "help", "btn.help"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = ICONS[x[1]];
      b.title = t(x[2]); b.setAttribute("aria-label", t(x[2]));
    });
    paintSfxBtn();
  }
  function wire() {
    $("map-btn").addEventListener("click", function () { if (view === "map" && underWay()) showPlay(); else showMap(); });
    $("help-btn").addEventListener("click", tourDialog);
    $("sfx-btn").addEventListener("click", toggleSfx);
    $("pause-btn").addEventListener("click", togglePause);
    $("speed-btn").addEventListener("click", cycleSpeed);
    $("dark-btn").addEventListener("click", toggleDark);
    $("next-btn").addEventListener("click", nextWave);
    $("dlg").addEventListener("close", function () { dlgKind = ""; });
    $("dlg").addEventListener("cancel", function () {
      if (dlgKind === "tour") { prefs.tour = 1; savePrefs(); }
    });
    wireInput();
    wireKeyboard();
    window.addEventListener("resize", resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe($("scene"));
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { if (underWay()) paused = true; saveSession(); renderBar(); }
      else startLoop();
    });
    window.addEventListener("pagehide", saveSession);
    try {
      var mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      reduced = mq.matches;
      var onMq = function () { reduced = mq.matches; };
      if (mq.addEventListener) mq.addEventListener("change", onMq); else if (mq.addListener) mq.addListener(onMq);
    } catch (e) {}
  }

  function boot() {
    canvas = $("view");
    ctx = canvas.getContext("2d");
    ensureDeviceId();
    loadData();
    loadPrefs();
    sess = loadSession();
    game = sess ? sess.g : null;
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    // a night under way reopens paused; otherwise the town map
    if (underWay()) showPlay(); else showMap();
    if (!prefs.tour) tourDialog();
    startLoop();
  }

  boot();
})();
