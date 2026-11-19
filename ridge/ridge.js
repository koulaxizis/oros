// ============================================================
// orOS Windmill ridge — App logic (v1.0.0)
// A tower defense game: on stormy nights sea fog climbs a winding
// island road to the village well. Build sling posts, bell towers,
// olive presses and windmills on the stone pads beside it; the wind
// turns with every wave. Real time with pause (1x / 2x / 3x), a wave
// starts only when the player calls it. The rules live in
// ridge/engine.js (RidgeEngine, tested headless); this file is the
// screen, the saves and the clock.
// Data:
//   - synced slice "ridge" (oros-ridge-data): best stars per ridge and
//     per-device counter rows (RidgeEngine.merge, a join). Written only
//     when a night ends or progress is reset; never during play.
//   - device-local (R10): oros-ridge-session ({g: the night in progress,
//     ck: the night at the start of its last wave, counted}, saved at
//     every wave start, after every build and on the way out; read by
//     gamekit/resume.js), oros-ridge-prefs (difficulty, tour, last ridge),
//     oros-ridge-device, oros-ridge-sfx.
// Sections:
//   1. Constants, i18n, helpers
//   2. Saves (progress, prefs, session)
//   3. The night: start, actions, ending
//   4. Loop (real time, speed, pause)
//   5. Scene (the ridge on one canvas)
//   6. Input (tap, keyboard)
//   7. Toolbar + bottom bar
//   8. Island chart
//   9. Dialogs (end of night, how to play, confirm)
//  10. Toasts + live region
//  11. Sound
//  12. Sync slice + palette
//  13. Test hooks, wiring & boot
// ============================================================
(function () {
  "use strict";

  var E = window.RidgeEngine;

  var STORAGE_KEY = "oros-ridge-data";
  var PREFS_KEY   = "oros-ridge-prefs";
  var SESSION_KEY = "oros-ridge-session";
  var DEVICE_KEY  = "oros-ridge-device";
  var SFX_KEY     = "oros-ridge-sfx";
  var SAVE_MS     = 600;                 // a build is saved this long after
  var RUN_SAVE_MS = 5000;                // and while the night runs, this often
  var SPEEDS      = [1, 2, 3];
  var DIR_KEYS    = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

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
      "app.name": "Windmill ridge",
      "btn.chart": "Island chart (C)", "btn.help": "How to play (?)",
      "btn.sfxOn": "Sound on (M)", "btn.sfxOff": "Sound off (M)",
      "btn.pause": "Pause (Space)", "btn.play": "Play (Space)", "btn.speed": "Speed {n}x (F)",
      "btn.next": "Next wave", "btn.nextEarly": "Next wave now (+{n})", "btn.nextKey": "Call the next wave (N)",
      "btn.first": "First wave", "btn.lastOut": "Last wave on the road", "btn.ok": "Good", "btn.cancel": "Cancel",
      "btn.again": "Try again from wave {n}", "btn.restart": "Play the night again", "btn.nextRidge": "Next ridge",
      "btn.toChart": "Island chart",
      "btn.reset": "Reset progress", "btn.resetYes": "Reset",
      "view.label": "The ridge: the road from the sea up to the well, with stone pads beside it. Arrow keys choose a pad.",
      "st.hearts": "Hearts", "st.coins": "Coins", "st.wave": "Wave {n} of {m}", "st.waveShort": "{n}/{m}",
      "wind.label": "Wind: {d}, {s}", "wind.calm": "Calm",
      "wind.s0": "calm", "wind.s1": "breeze", "wind.s2": "strong wind", "wind.s3": "gale",
      "wind.n": "north wind", "wind.ne": "north-east wind", "wind.e": "east wind", "wind.se": "south-east wind",
      "wind.s": "south wind", "wind.sw": "south-west wind", "wind.w": "west wind", "wind.nw": "north-west wind",
      "diff.m": "Mild", "diff.n": "Normal", "diff.h": "Hard",
      "tw.sling": "Sling post", "tw.bell": "Bell tower", "tw.press": "Olive press", "tw.mill": "Windmill",
      "tw.sling.a": "Twin sling", "tw.sling.b": "Long sling", "tw.bell.a": "Deep bell", "tw.bell.b": "Chime",
      "tw.press.a": "Hot oil", "tw.press.b": "Spill", "tw.mill.a": "Great sails", "tw.mill.b": "Millstone",
      "fx.sling": "Fast stones at one fog.", "fx.bell": "Rings: slows all the fog in reach.",
      "fx.press": "Rolls oil onto the road that burns the fog crossing it, and cracks shells.",
      "fx.mill": "Pushes the fog in reach back down the road, harder in a strong wind.",
      "fx.sling.a": "Two fogs at a time.", "fx.sling.b": "Much farther, heavier stones, slower.",
      "fx.bell.a": "Slows more and cracks shells.", "fx.bell.b": "Rings wider and hurts a little.",
      "fx.press.a": "Burns longer and hotter.", "fx.press.b": "A long patch that also slows.",
      "fx.mill.a": "Pushes much farther.", "fx.mill.b": "The pushed fog is also hurt.",
      "fog.w": "wisp", "fog.r": "runner", "fog.s": "shell", "fog.p": "puff", "fog.m": "half puff", "fog.b": "fog bank",
      "fogs.w": "wisps", "fogs.r": "runners", "fogs.s": "shells", "fogs.p": "puffs", "fogs.m": "half puffs", "fogs.b": "fog banks",
      "tm.first": "Aims at: the first", "tm.strong": "Aims at: the strongest", "tm.close": "Aims at: the closest",
      "act.up": "Upgrade", "act.sell": "Sell", "act.aim": "Aim", "act.locked": "Ridge {n}",
      "act.lv": "{t} · level {l}", "act.max": "Top level",
      "pad.empty": "An empty stone pad: choose a tower.",
      "pad.tower": "<strong>{t}</strong> · level {l} · {fx}",
      "pad.sell": "Sell for {n}",
      "ctx.next": "Next:", "ctx.done": "All waves are out. Clear the road!",
      "ctx.pick": "Tap a stone pad beside the road to build.", "ch.island1": "The near island",
      "ch.intro": "Every night the fog climbs from the sea to the well. Clear a ridge to open the next one; the wind turns with every wave.",
      "ch.diff": "Difficulty", "ch.lock": "Clear the ridge before it to open", "ch.waves": "{n} waves",
      "ch.towers": "Towers: {list}", "ch.cont": "Continue: {r}, wave {n}",
      "ch.replace": "A night is still under way on {r}. Start {s} instead? The night under way is given up.",
      "ch.resetAsk": "Reset the stars and records on every device?",
      "rd.i1r1": "Harbour steps", "rd.i1r2": "Olive terraces", "rd.i1r3": "Mill road", "rd.i1r4": "The crest",
      "end.won": "The well is safe", "end.lost": "The fog reached the well",
      "end.hearts": "Hearts left", "end.faded": "Fog faded", "end.waves": "Waves",
      "end.wonNote": "Three stars with nine tenths of the hearts left.",
      "end.lostNote": "Try again from the start of the wave you lost, with the towers you had then.",
      "end.unlock": "{t} is now ready to build.",
      "tour.title": "How to play",
      "tour.1": "Fog climbs the road from the sea to the well. Each fog that reaches the well costs a heart (a fog bank costs three).",
      "tour.2": "Tap a stone pad beside the road to build a tower, and tap a tower to upgrade, aim or sell it. At level 3 you choose one of two branches.",
      "tour.3": "A wave starts only when you press Next wave. Pause at any time and build while paused; 2x and 3x speed things up.",
      "tour.4": "The wind turns with every wave: the arrow at the top shows it. Slings and presses reach farther downwind and less upwind, bells farther downwind, windmills push harder in a strong wind.",
      "tour.5": "Towers built since the last wave started come back in full when you sell them; older ones give 70%.",
      "toast.coins": "Not enough coins", "toast.locked": "{t} opens on ridge {n}", "toast.save": "Not saved: the browser's storage is full",
      "toast.reset": "Progress reset", "toast.early": "+{n} for calling the wave early",
      "live.wave": "Wave {n} of {m}. {w}.", "live.clear": "Wave {n} cleared, +{c} coins.", "live.heart": "A fog reached the well. {h} hearts left.",
      "live.sel": "{p}. {s}", "live.pad": "Pad {n}",
      "live.status": "{h} hearts, {c} coins, wave {n} of {m}."
    },
    el: {
      "app.name": "Η ράχη με τους ανεμόμυλους",
      "btn.chart": "Χάρτης του νησιού (C)", "btn.help": "Πώς παίζεται (?)",
      "btn.sfxOn": "Ήχος ανοιχτός (M)", "btn.sfxOff": "Ήχος κλειστός (M)",
      "btn.pause": "Παύση (Space)", "btn.play": "Συνέχεια (Space)", "btn.speed": "Ταχύτητα {n}x (F)",
      "btn.next": "Επόμενο κύμα", "btn.nextEarly": "Επόμενο κύμα τώρα (+{n})", "btn.nextKey": "Κάλεσε το επόμενο κύμα (N)",
      "btn.first": "Πρώτο κύμα", "btn.lastOut": "Το τελευταίο κύμα είναι στον δρόμο", "btn.ok": "Ωραία", "btn.cancel": "Άκυρο",
      "btn.again": "Ξανά από το κύμα {n}", "btn.restart": "Ξανά όλη η νύχτα", "btn.nextRidge": "Επόμενη ράχη",
      "btn.toChart": "Χάρτης του νησιού",
      "btn.reset": "Μηδενισμός προόδου", "btn.resetYes": "Μηδενισμός",
      "view.label": "Η ράχη: ο δρόμος από τη θάλασσα ως το πηγάδι, με πέτρινες βάσεις δίπλα του. Με τα βελάκια διαλέγεις βάση.",
      "st.hearts": "Καρδιές", "st.coins": "Νομίσματα", "st.wave": "Κύμα {n} από {m}", "st.waveShort": "{n}/{m}",
      "wind.label": "Άνεμος: {d}, {s}", "wind.calm": "Νηνεμία",
      "wind.s0": "νηνεμία", "wind.s1": "αύρα", "wind.s2": "δυνατός αέρας", "wind.s3": "μπουρίνι",
      "wind.n": "βοριάς", "wind.ne": "γρέγος", "wind.e": "λεβάντες", "wind.se": "σιρόκος",
      "wind.s": "νοτιάς", "wind.sw": "γαρμπής", "wind.w": "πουνέντες", "wind.nw": "μαΐστρος",
      "diff.m": "Ήπιο", "diff.n": "Κανονικό", "diff.h": "Δύσκολο",
      "tw.sling": "Σφεντόνα", "tw.bell": "Καμπαναριό", "tw.press": "Λιοτρίβι", "tw.mill": "Ανεμόμυλος",
      "tw.sling.a": "Διπλή σφεντόνα", "tw.sling.b": "Μακριά σφεντόνα", "tw.bell.a": "Βαθιά καμπάνα", "tw.bell.b": "Καμπανάκια",
      "tw.press.a": "Καυτό λάδι", "tw.press.b": "Χυμένο λάδι", "tw.mill.a": "Μεγάλα πανιά", "tw.mill.b": "Μυλόπετρα",
      "fx.sling": "Γρήγορες πέτρες σε μία ομίχλη.", "fx.bell": "Χτυπά: επιβραδύνει όλη την ομίχλη κοντά της.",
      "fx.press": "Ρίχνει λάδι στον δρόμο που καίει την ομίχλη που περνά και σπάει τα καβούκια.",
      "fx.mill": "Σπρώχνει την ομίχλη κοντά του πίσω στον δρόμο, πιο δυνατά όταν φυσά πολύ.",
      "fx.sling.a": "Δύο ομίχλες κάθε φορά.", "fx.sling.b": "Πολύ πιο μακριά, βαριές πέτρες, πιο αργά.",
      "fx.bell.a": "Επιβραδύνει περισσότερο και σπάει τα καβούκια.", "fx.bell.b": "Ακούγεται πιο μακριά και πονά λίγο.",
      "fx.press.a": "Καίει περισσότερο και πιο δυνατά.", "fx.press.b": "Μακρύ λάδι που επιβραδύνει κιόλας.",
      "fx.mill.a": "Σπρώχνει πολύ πιο μακριά.", "fx.mill.b": "Η ομίχλη που σπρώχνει παθαίνει και ζημιά.",
      "fog.w": "αχνός", "fog.r": "γοργός", "fog.s": "καβούκι", "fog.p": "τούφα", "fog.m": "μισή τούφα", "fog.b": "τείχος ομίχλης",
      "fogs.w": "αχνοί", "fogs.r": "γοργοί", "fogs.s": "καβούκια", "fogs.p": "τούφες", "fogs.m": "μισές τούφες", "fogs.b": "τείχη ομίχλης",
      "tm.first": "Σημαδεύει: την πρώτη", "tm.strong": "Σημαδεύει: τη δυνατότερη", "tm.close": "Σημαδεύει: την κοντινότερη",
      "act.up": "Αναβάθμιση", "act.sell": "Πούλα", "act.aim": "Στόχος", "act.locked": "Ράχη {n}",
      "act.lv": "{t} · επίπεδο {l}", "act.max": "Τελευταίο επίπεδο",
      "pad.empty": "Άδεια πέτρινη βάση: διάλεξε πύργο.",
      "pad.tower": "<strong>{t}</strong> · επίπεδο {l} · {fx}",
      "pad.sell": "Πούλα για {n}",
      "ctx.next": "Έρχονται:", "ctx.done": "Βγήκαν όλα τα κύματα. Καθάρισε τον δρόμο!",
      "ctx.pick": "Πάτα μια πέτρινη βάση δίπλα στον δρόμο για να χτίσεις.", "ch.island1": "Το κοντινό νησί",
      "ch.intro": "Κάθε νύχτα η ομίχλη ανεβαίνει από τη θάλασσα ως το πηγάδι. Πέρασε μια ράχη για να ανοίξει η επόμενη· ο άνεμος αλλάζει σε κάθε κύμα.",
      "ch.diff": "Δυσκολία", "ch.lock": "Πέρασε πρώτα την προηγούμενη ράχη", "ch.waves": "{n} κύματα",
      "ch.towers": "Πύργοι: {list}", "ch.cont": "Συνέχεια: {r}, κύμα {n}",
      "ch.replace": "Μια νύχτα είναι ακόμα σε εξέλιξη στη ράχη «{r}». Να ξεκινήσει η «{s}»; Η νύχτα σε εξέλιξη χάνεται.",
      "ch.resetAsk": "Να μηδενιστούν τα αστέρια και το αρχείο σε όλες τις συσκευές;",
      "rd.i1r1": "Τα σκαλιά του λιμανιού", "rd.i1r2": "Οι πεζούλες με τις ελιές", "rd.i1r3": "Ο δρόμος των μύλων", "rd.i1r4": "Η κορυφή",
      "end.won": "Το πηγάδι σώθηκε", "end.lost": "Η ομίχλη έφτασε στο πηγάδι",
      "end.hearts": "Καρδιές που έμειναν", "end.faded": "Ομίχλες που σκόρπισαν", "end.waves": "Κύματα",
      "end.wonNote": "Τρία αστέρια με τα εννιά δέκατα των καρδιών.",
      "end.lostNote": "Ξαναπροσπάθησε από την αρχή του κύματος που έχασες, με τους πύργους που είχες τότε.",
      "end.unlock": "Τώρα μπορείς να χτίσεις: {t}.",
      "tour.title": "Πώς παίζεται",
      "tour.1": "Η ομίχλη ανεβαίνει τον δρόμο από τη θάλασσα ως το πηγάδι. Κάθε ομίχλη που φτάνει στο πηγάδι κοστίζει μία καρδιά (το τείχος ομίχλης τρεις).",
      "tour.2": "Πάτα μια πέτρινη βάση δίπλα στον δρόμο για να χτίσεις πύργο, και πάτα έναν πύργο για να τον αναβαθμίσεις, να αλλάξεις στόχο ή να τον πουλήσεις. Στο επίπεδο 3 διαλέγεις έναν από δύο δρόμους.",
      "tour.3": "Ένα κύμα ξεκινά μόνο όταν πατήσεις «Επόμενο κύμα». Κάνε παύση όποτε θέλεις και χτίζε στην παύση· με 2x και 3x πάει πιο γρήγορα.",
      "tour.4": "Ο άνεμος αλλάζει σε κάθε κύμα: το βέλος επάνω τον δείχνει. Οι σφεντόνες και τα λιοτρίβια φτάνουν πιο μακριά προς τα εκεί που φυσά και πιο κοντά κόντρα στον άνεμο, τα καμπαναριά πιο μακριά με τον άνεμο, και οι ανεμόμυλοι σπρώχνουν πιο δυνατά όταν φυσά πολύ.",
      "tour.5": "Οι πύργοι που έχτισες από την αρχή του τελευταίου κύματος σου επιστρέφουν όλα τα νομίσματα αν τους πουλήσεις· οι παλιότεροι το 70%.",
      "toast.coins": "Δεν φτάνουν τα νομίσματα", "toast.locked": "{t}: ανοίγει στη ράχη {n}", "toast.save": "Δεν αποθηκεύτηκε: ο χώρος του προγράμματος περιήγησης γέμισε",
      "toast.reset": "Η πρόοδος μηδενίστηκε", "toast.early": "+{n} επειδή κάλεσες νωρίς το κύμα",
      "live.wave": "Κύμα {n} από {m}. {w}.", "live.clear": "Το κύμα {n} καθάρισε, +{c} νομίσματα.", "live.heart": "Μια ομίχλη έφτασε στο πηγάδι. Έμειναν {h} καρδιές.",
      "live.sel": "{p}. {s}", "live.pad": "Βάση {n}",
      "live.status": "{h} καρδιές, {c} νομίσματα, κύμα {n} από {m}."
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "ridge", LANG);

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
  function twName(tw) { return t("tw." + tw.k + (tw.l === 3 ? "." + tw.b : "")); }
  function twFx(tw) { return t("fx." + tw.k + (tw.l === 3 ? "." + tw.b : "")); }
  function rdName(id) { return t("rd." + id); }
  function windText(w) {
    if (!w.s) return t("wind.calm");
    return t("wind.label", { d: t("wind." + DIR_KEYS[(w.d + 4) % 8]), s: t("wind.s" + w.s) });
  }
  function fogList(list) {
    return list.map(function (x) { return x.n + " " + t((x.n === 1 ? "fog." : "fogs.") + x.k); }).join(" · ");
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("ridge.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Saves ----------
  var data = null, deviceId = null;
  var prefs = { diff: "n", tour: 0, last: "i1r1" };
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
      try { console.warn("[orOS] ridge: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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
        if (E.RIDGE[p.last]) prefs.last = p.last;
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
  var sel = -1;                        // the chosen pad, -1 none
  var paused = true, speed = 1;
  var view = "chart";                  // "chart" | "play"

  function startNight(ridge, diff) {
    var g = E.newRun(ridge, diff);
    if (!g) return;
    sess = { g: g, ck: null, counted: false };
    game = g;
    prefs.last = ridge; prefs.diff = diff;
    savePrefs();
    sel = -1; paused = true;
    fx = []; lastShot = {};
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
  function tryAct(ok, failKey) {
    if (!ok) { if (failKey) showToast(t(failKey)); sfx("no"); return false; }
    sfx("build");
    saveSoon();
    renderBar(); renderStatus(); draw();
    return true;
  }
  function build(k) {
    if (sel < 0 || !game) return;
    if (!E.unlocked(game, k)) { showToast(t("toast.locked", { t: t("tw." + k), n: E.TOWERS[k].u })); sfx("no"); return; }
    if (game.coins < E.buildCost(k)) { tryAct(false, "toast.coins"); return; }
    tryAct(E.build(game, sel, k));
  }
  function upgrade(branch) {
    if (sel < 0 || !game || !game.tw[sel]) return;
    var tw = game.tw[sel];
    if (tw.l >= 3) return;
    if (game.coins < E.upCost(tw)) { tryAct(false, "toast.coins"); return; }
    tryAct(E.upgrade(game, sel, branch));
  }
  function sellSel() {
    if (sel < 0 || !game || !game.tw[sel]) return;
    tryAct(E.sell(game, sel));
  }
  function aimSel() {
    if (sel < 0 || !game || !game.tw[sel]) return;
    tryAct(E.target(game, sel));
  }
  function nextWave() {
    if (!game || game.over >= 0 || game.wave >= game.nw) return;
    sess.ck = E.saveable(game);
    sess.ck.ev = [];
    E.callWave(game);
    paused = false;
    sfx("wave");
    announce(t("live.wave", { n: game.wave, m: game.nw, w: windText(E.windNow(game)) }));
    handleEvents();
    saveSession();
    renderAll();
  }
  // The night is over: count it once, then the end card.
  function endNight() {
    if (!sess || sess.counted) return;
    var before = E.isOpen(data, nextRidgeId(game.ridge) || game.ridge);
    data = E.record(data, deviceId, game, Date.now());
    sess.counted = true;
    saveData();
    saveSession();
    paused = true;
    var nx = nextRidgeId(game.ridge);
    var opened = nx && !before && E.isOpen(data, nx) ? nx : null;
    sfx(game.over === 1 ? "won" : "lost");
    endDialog(opened);
  }
  function nextRidgeId(id) {
    var rd = E.RIDGE[id];
    return rd && E.RIDGES[rd.idx + 1] ? E.RIDGES[rd.idx + 1].id : null;
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
  var fx = [], lastShot = {};
  function handleEvents() {
    if (!game || !game.ev.length) return;
    var ev = game.ev; game.ev = [];
    var rd = E.RIDGE[game.ridge], hurt = false, fade = 0;
    ev.forEach(function (x) {
      if (x.e === "shot") {
        var f = fogById(x.f);
        if (f) fx.push({ k: "shot", from: E.padPos(rd, x.p), to: E.posAt(rd, f.s), life: 120 });
        if (!lastShot[x.p] || Date.now() - lastShot[x.p] > 140) { lastShot[x.p] = Date.now(); sfx("shot"); }
      } else if (x.e === "ring") { fx.push({ k: "ring", at: E.padPos(rd, x.p), r: E.stats(game.tw[x.p] || { k: "bell", l: 1 }).r, life: 500 }); sfx("bell"); }
      else if (x.e === "oil") sfx("oil");
      else if (x.e === "push") { fx.push({ k: "push", at: E.padPos(rd, x.p), life: 400 }); sfx("push"); }
      else if (x.e === "fade") { fade++; fx.push({ k: "fade", at: E.posAt(rd, x.s), life: 450 }); }
      else if (x.e === "leak") hurt = true;
      else if (x.e === "clear") { announce(t("live.clear", { n: x.w + 1, c: x.n })); sfx("clear"); }
      else if (x.e === "early") showToast(t("toast.early", { n: x.n }));
    });
    if (fade) sfx("fade");
    if (hurt) {
      sfx("heart");
      announce(t("live.heart", { h: game.hearts }));
      if (window.orosHaptics) window.orosHaptics.cue("bad");
    }
    renderStatus();
    renderBar();
    if (game.over >= 0) endNight();
  }
  function fogById(id) {
    for (var i = 0; i < game.fog.length; i++) if (game.fog[i].id === id) return game.fog[i];
    return null;
  }
  function ageFx(dt) {
    fx = fx.filter(function (f) { f.life -= dt; return f.life > 0; });
  }

  // ---------- 5. Scene ----------
  var canvas, ctx, dpr = 1, W = 0, H = 0, tile = 30, ox = 0, oy = 0;
  var reduced = false;
  var C = {};
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ["--bg", "--text", "--text-dim", "--accent", "--border", "--danger", "--panel-bg",
     "--rd-ground", "--rd-grass", "--rd-road", "--rd-edge", "--rd-pad", "--rd-pad2", "--rd-sea", "--rd-well",
     "--rd-fog", "--rd-eye", "--rd-oil", "--rd-tower", "--rd-reach"].forEach(function (v) {
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

  function draw() {
    if (!ctx || view !== "play" || !game) return;
    var rd = E.RIDGE[game.ridge];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C["rd-ground"]; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C["rd-grass"]; ctx.fillRect(ox, oy, tile * E.COLS, tile * E.ROWS);
    drawSea(rd);
    drawRoad(rd);
    drawOil(rd);
    drawWell(rd);
    rd.pads.forEach(function (p, i) { drawPad(rd, i); });
    if (sel >= 0) drawReach(rd, sel);
    game.fog.forEach(function (f) { drawFog(rd, f); });
    drawFx();
  }
  function drawSea(rd) {
    var a = rd.path[0], b = rd.path[1];
    ctx.fillStyle = C["rd-sea"];
    var x = ox + a[0] * tile, y = oy + a[1] * tile;
    // the sea lies past the edge the road starts from
    if (a[1] === E.ROWS - 1 && b[1] < a[1]) ctx.fillRect(ox, y + tile * 0.55, tile * E.COLS, tile * 0.45);
    else if (a[0] === 0) ctx.fillRect(ox, y - tile, tile * 0.45, tile * 3);
    else if (a[0] === E.COLS - 1) ctx.fillRect(x + tile * 0.55, y - tile, tile * 0.45, tile * 3);
    else ctx.fillRect(x - tile, y + tile * 0.55, tile * 3, tile * 0.45);
  }
  function roadPath(rd) {
    ctx.beginPath();
    rd.path.forEach(function (p, i) {
      var q = px({ x: p[0] + 0.5, y: p[1] + 0.5 });
      if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
    });
  }
  function drawRoad(rd) {
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    roadPath(rd); ctx.strokeStyle = C["rd-edge"]; ctx.lineWidth = tile * 0.86; ctx.stroke();
    roadPath(rd); ctx.strokeStyle = C["rd-road"]; ctx.lineWidth = tile * 0.7; ctx.stroke();
  }
  function drawOil(rd) {
    ctx.lineCap = "round";
    game.oil.forEach(function (o) {
      ctx.beginPath();
      for (var s = Math.max(0, o.a), i = 0; s <= Math.min(rd.len, o.b) + 1e-9; s += 0.1, i++) {
        var q = px(E.posAt(rd, s));
        if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
      }
      ctx.globalAlpha = Math.max(0.25, Math.min(0.75, (o.e - game.t) / 120));
      ctx.strokeStyle = C["rd-oil"]; ctx.lineWidth = tile * 0.5; ctx.stroke();
      ctx.globalAlpha = 1;
    });
  }
  function drawWell(rd) {
    var p = rd.path[rd.path.length - 1];
    var q = px({ x: p[0] + 0.5, y: p[1] + 0.5 });
    ctx.beginPath(); ctx.arc(q.x, q.y, tile * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = C["rd-pad2"]; ctx.fill();
    ctx.beginPath(); ctx.arc(q.x, q.y, tile * 0.26, 0, Math.PI * 2);
    ctx.fillStyle = C["rd-well"]; ctx.fill();
  }
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  function drawPad(rd, i) {
    var p = rd.pads[i], x = ox + p[0] * tile, y = oy + p[1] * tile, m = tile * 0.1;
    rr(x + m, y + m, tile - 2 * m, tile - 2 * m, tile * 0.18);
    ctx.fillStyle = C["rd-pad"]; ctx.fill();
    if (i === sel) { ctx.lineWidth = Math.max(2, tile * 0.08); ctx.strokeStyle = C.accent; ctx.stroke(); }
    var tw = game.tw[i];
    if (tw) drawTower(tw, x + tile / 2, y + tile / 2, tile * 0.36);
  }
  // Each tower has its own outline (never only a colour).
  function drawTower(tw, cx, cy, r) {
    ctx.fillStyle = C["rd-tower"]; ctx.strokeStyle = C["rd-tower"]; ctx.lineWidth = Math.max(1.5, r * 0.18);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (tw.k === "sling") {
      ctx.beginPath(); ctx.moveTo(cx, cy + r); ctx.lineTo(cx, cy); ctx.moveTo(cx - r * 0.7, cy - r * 0.8);
      ctx.lineTo(cx, cy); ctx.lineTo(cx + r * 0.7, cy - r * 0.8); ctx.stroke();
    } else if (tw.k === "bell") {
      ctx.beginPath(); ctx.moveTo(cx - r * 0.75, cy + r * 0.6);
      ctx.quadraticCurveTo(cx - r * 0.65, cy - r, cx, cy - r);
      ctx.quadraticCurveTo(cx + r * 0.65, cy - r, cx + r * 0.75, cy + r * 0.6);
      ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy + r * 0.8, r * 0.18, 0, Math.PI * 2); ctx.fill();
    } else if (tw.k === "press") {
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.25, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx - r * 0.8, cy); ctx.lineTo(cx + r * 0.8, cy); ctx.stroke();
    } else {
      var a0 = reduced ? 0.4 : (Date.now() / 600) * (0.5 + E.windNow(game).s * 0.5);
      ctx.beginPath();
      for (var k = 0; k < 4; k++) {
        var a = a0 + k * Math.PI / 2;
        ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.2, 0, Math.PI * 2); ctx.fill();
    }
    // level: one, two or three dots under the tower
    ctx.fillStyle = C.accent;
    for (var j = 0; j < tw.l; j++) {
      ctx.beginPath(); ctx.arc(cx + (j - (tw.l - 1) / 2) * r * 0.45, cy + r * 1.2, Math.max(1.5, r * 0.11), 0, Math.PI * 2); ctx.fill();
    }
  }
  // The reach of the chosen tower in the wind now (a stretched ring).
  function drawReach(rd, pad) {
    var tw = game.tw[pad];
    if (!tw) return;
    var st = E.stats(tw), w = E.windNow(game), c = px(E.padPos(rd, pad));
    ctx.beginPath();
    for (var i = 0; i <= 48; i++) {
      var a = i / 48 * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
      var r = E.reachTo(tw.k, st.r, w, dx, dy) * tile;
      if (i) ctx.lineTo(c.x + dx * r, c.y + dy * r); else ctx.moveTo(c.x + dx * r, c.y + dy * r);
    }
    ctx.closePath();
    ctx.fillStyle = C["rd-reach"]; ctx.fill();
    ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5; ctx.stroke();
  }
  // Each fog kind has its own outline; two lantern eyes; a health bar.
  function drawFog(rd, f) {
    var q = px(E.posAt(rd, f.s)), r = tile * (f.k === "b" ? 0.42 : f.k === "m" ? 0.16 : 0.24);
    ctx.fillStyle = C["rd-fog"]; ctx.strokeStyle = C["rd-fog"];
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    if (f.k === "r") {
      ctx.moveTo(q.x, q.y - r * 1.4); ctx.quadraticCurveTo(q.x + r * 1.1, q.y, q.x, q.y + r);
      ctx.quadraticCurveTo(q.x - r * 1.1, q.y, q.x, q.y - r * 1.4);
    } else if (f.k === "s") {
      for (var i = 0; i < 6; i++) {
        var a = Math.PI / 6 + i * Math.PI / 3;
        if (i) ctx.lineTo(q.x + Math.cos(a) * r, q.y + Math.sin(a) * r); else ctx.moveTo(q.x + Math.cos(a) * r, q.y + Math.sin(a) * r);
      }
      ctx.closePath();
    } else if (f.k === "p") {
      ctx.arc(q.x - r * 0.5, q.y + r * 0.2, r * 0.6, 0, Math.PI * 2);
      ctx.moveTo(q.x + r * 1.1, q.y + r * 0.2); ctx.arc(q.x + r * 0.5, q.y + r * 0.2, r * 0.6, 0, Math.PI * 2);
      ctx.moveTo(q.x + r * 0.6, q.y - r * 0.4); ctx.arc(q.x, q.y - r * 0.4, r * 0.6, 0, Math.PI * 2);
    } else if (f.k === "b") {
      ctx.ellipse(q.x, q.y, r * 1.4, r * 0.8, 0, 0, Math.PI * 2);
    } else ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (f.ar) { ctx.lineWidth = Math.max(1.5, r * 0.25); ctx.strokeStyle = C["rd-pad2"]; ctx.stroke(); }
    ctx.fillStyle = C["rd-eye"];
    var e = Math.max(1, r * 0.18);
    ctx.beginPath(); ctx.arc(q.x - r * 0.35, q.y - r * 0.1, e, 0, Math.PI * 2); ctx.arc(q.x + r * 0.35, q.y - r * 0.1, e, 0, Math.PI * 2); ctx.fill();
    if (f.hp < f.mx) {
      var bw = Math.max(tile * 0.5, r * 2), fr = Math.max(0, f.hp / f.mx);
      ctx.fillStyle = C.border; ctx.fillRect(q.x - bw / 2, q.y - r - 6, bw, 3);
      ctx.fillStyle = C.accent; ctx.fillRect(q.x - bw / 2, q.y - r - 6, bw * fr, 3);
    }
    if (f.st > 0 && f.sl > 0) {
      ctx.strokeStyle = C["rd-well"]; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(q.x, q.y, r + 3, 0, Math.PI * 2); ctx.stroke();
    }
  }
  function drawFx() {
    fx.forEach(function (f) {
      if (f.k === "shot") {
        var a = px(f.from), b = px(f.to);
        ctx.globalAlpha = Math.min(1, f.life / 120);
        ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      } else if (f.k === "ring") {
        var c = px(f.at), k = reduced ? 1 : 1 - f.life / 500;
        ctx.globalAlpha = reduced ? 0.35 * f.life / 500 : 0.5 * f.life / 500;
        ctx.strokeStyle = C["rd-well"]; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(2, f.r * tile * k), 0, Math.PI * 2); ctx.stroke();
      } else if (f.k === "push") {
        var p = px(f.at);
        ctx.globalAlpha = 0.5 * f.life / 400;
        ctx.strokeStyle = C["rd-tower"]; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, tile * (reduced ? 0.8 : 1.6 - f.life / 400), 0, Math.PI * 2); ctx.stroke();
      } else if (f.k === "fade") {
        var m = px(f.at);
        ctx.globalAlpha = 0.6 * f.life / 450;
        ctx.fillStyle = C["rd-fog"];
        ctx.beginPath(); ctx.arc(m.x, m.y - (reduced ? 0 : (1 - f.life / 450) * tile * 0.4), tile * 0.3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    });
  }

  // ---------- 6. Input ----------
  function padAt(clientX, clientY) {
    if (!game) return -1;
    var r = canvas.getBoundingClientRect();
    var x = (clientX - r.left - ox) / tile, y = (clientY - r.top - oy) / tile;
    var rd = E.RIDGE[game.ridge], best = -1, bd = 0.85 * 0.85;
    rd.pads.forEach(function (p, i) {
      var d = Math.pow(p[0] + 0.5 - x, 2) + Math.pow(p[1] + 0.5 - y, 2);
      if (d <= bd) { bd = d; best = i; }
    });
    return best;
  }
  function select(i) {
    sel = i;
    renderBar(); draw();
    if (i >= 0) {
      var tw = game.tw[i];
      announce(t("live.sel", { p: t("live.pad", { n: i + 1 }), s: tw ? t("act.lv", { t: twName(tw), l: tw.l }) : t("pad.empty") }));
    }
  }
  function wireInput() {
    canvas.addEventListener("pointerdown", function (e) {
      if (view !== "play" || !game) return;
      e.preventDefault();
      canvas.focus({ preventScroll: true });
      var i = padAt(e.clientX, e.clientY);
      select(i === sel ? -1 : i);
    });
  }
  // Arrow keys: the nearest pad in that direction.
  function movePad(dx, dy) {
    var rd = E.RIDGE[game.ridge];
    if (sel < 0) { select(0); return; }
    var p = rd.pads[sel], best = -1, bs = Infinity;
    rd.pads.forEach(function (q, i) {
      if (i === sel) return;
      var vx = q[0] - p[0], vy = q[1] - p[1];
      var along = vx * dx + vy * dy;
      if (along <= 0) return;
      var side = Math.abs(vx * dy - vy * dx);
      var score = along + side * 2;
      if (score < bs) { bs = score; best = i; }
    });
    if (best >= 0) select(best);
  }
  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (dlgOpen()) return;
      var k = e.key;
      if (k === "m" || k === "M") { toggleSfx(); e.preventDefault(); return; }
      if (k === "?") { tourDialog(); e.preventDefault(); return; }
      if (k === "c" || k === "C") { showChart(); e.preventDefault(); return; }
      if (view !== "play" || !game) return;
      var tag = (e.target && e.target.tagName) || "";
      if (k === " " && tag === "BUTTON") return;
      var handled = true;
      if (k === "ArrowLeft") movePad(-1, 0);
      else if (k === "ArrowRight") movePad(1, 0);
      else if (k === "ArrowUp") movePad(0, -1);
      else if (k === "ArrowDown") movePad(0, 1);
      else if (k === " ") togglePause();
      else if (k === "f" || k === "F") cycleSpeed();
      else if (k === "n" || k === "N") nextWave();
      else if (k === "Escape") select(-1);
      else if (/^[1-4]$/.test(k) && sel >= 0 && !game.tw[sel]) build(E.KINDS[+k - 1]);
      else if ((k === "u" || k === "U") && sel >= 0 && game.tw[sel] && game.tw[sel].l === 1) upgrade("");
      else if ((k === "a" || k === "A" || k === "b" || k === "B") && sel >= 0 && game.tw[sel] && game.tw[sel].l === 2) upgrade(k.toLowerCase());
      else if ((k === "s" || k === "S") && sel >= 0) sellSel();
      else if ((k === "t" || k === "T") && sel >= 0) aimSel();
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
    var w = E.windNow(game);
    // the arrow shows where it blows, one dot per strength (calm: a dash)
    setStat("s-wind", ICONS.wind, w.s ? "•••".slice(0, w.s) : "–", windText(w));
    var svg = $("s-wind").querySelector("svg");
    if (svg) svg.style.transform = w.s ? "rotate(" + (w.d * 45) + "deg)" : "";
  }
  function towerBtn(k) {
    var b = el("button", "act");
    b.type = "button";
    var on = E.unlocked(game, k), c = E.buildCost(k);
    if (!on) b.classList.add("locked");
    b.innerHTML = ICONS[k];
    b.appendChild(el("span", "nm", t("tw." + k)));
    b.appendChild(el("span", "cost", on ? String(c) : t("act.locked", { n: E.TOWERS[k].u })));
    b.disabled = on && game.coins < c;
    b.title = t("tw." + k) + ": " + t("fx." + k) + " (" + (E.KINDS.indexOf(k) + 1) + ")";
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
    var nb = $("next-btn"), left = E.fogLeft(game);
    nb.querySelector(".ic").innerHTML = ICONS.wave;
    nb.querySelector(".lb").textContent = game.wave >= game.nw ? t("btn.lastOut") : game.wave === 0 ? t("btn.first") :
      left ? t("btn.nextEarly", { n: left }) : t("btn.next");
    nb.disabled = game.over >= 0 || game.wave >= game.nw;
    nb.title = t("btn.nextKey");
    // the context row: the chosen pad, or what comes next
    var tw = sel >= 0 ? game.tw[sel] : null;
    var key = [sel, tw ? JSON.stringify(tw) : "", Math.floor(game.coins), game.wave, game.over, LANG].join("|");
    if (key === barKey) return;
    barKey = key;
    var ctx2 = $("bar-ctx"), tip = $("tip");
    ctx2.textContent = "";
    if (sel < 0) {
      tip.hidden = true;
      var tx = el("div", "ctx-text");
      if (game.wave >= game.nw) tx.appendChild(el("span", "", t("ctx.done")));
      else {
        var nw = E.windNext(game), list = E.preview(game);
        var s1 = el("span", "");
        s1.appendChild(el("strong", "", t("ctx.next")));
        tx.appendChild(s1);
        list.forEach(function (x) {
          var g = el("span", "fg");
          g.innerHTML = ICONS["fog_" + x.k] || "";
          g.appendChild(document.createTextNode(x.n + " " + t((x.n === 1 ? "fog." : "fogs.") + x.k)));
          tx.appendChild(g);
        });
        tx.appendChild(el("span", "fg", "· " + windText(nw)));
        if (game.wave === 0 && !Object.keys(game.tw).length) tx.appendChild(el("span", "", t("ctx.pick")));
      }
      ctx2.appendChild(tx);
      return;
    }
    tip.hidden = false;
    // the tip covers the half of the map the chosen pad is not in
    tip.classList.toggle("low", E.RIDGE[game.ridge].pads[sel][1] < E.ROWS / 2);
    if (!tw) {
      tip.textContent = t("pad.empty");
      E.KINDS.forEach(function (k) { ctx2.appendChild(towerBtn(k)); });
      return;
    }
    tip.innerHTML = t("pad.tower", { t: esc(twName(tw)), l: tw.l, fx: esc(twFx(tw)) });
    var uc = E.upCost(tw);
    if (tw.l === 1) {
      ctx2.appendChild(actBtn(ICONS.up, t("act.up"), String(uc), t("act.up") + " (U): " + t("tw." + tw.k) + " 2, " + uc, function () { upgrade(""); }, game.coins < uc));
    } else if (tw.l === 2) {
      ["a", "b"].forEach(function (br) {
        var nm = t("tw." + tw.k + "." + br);
        ctx2.appendChild(actBtn(ICONS.up, nm, String(uc), nm + " (" + br.toUpperCase() + "): " + t("fx." + tw.k + "." + br) + " " + uc, function () { upgrade(br); }, game.coins < uc));
      });
    } else {
      ctx2.appendChild(actBtn(ICONS.star, t("act.max"), "", t("act.max"), function () {}, true));
    }
    if (E.TOWERS[tw.k].tm) {
      ctx2.appendChild(actBtn(ICONS.aim, t("act.aim"), "", t("tm." + E.TARGETS[tw.tm]) + " (T)", aimSel));
      var last = ctx2.lastChild;
      last.querySelector(".nm").textContent = t("tm." + E.TARGETS[tw.tm]).split(": ").pop();
    }
    var sv = E.sellValue(tw);
    ctx2.appendChild(actBtn(ICONS.sell, t("act.sell"), "+" + sv, t("pad.sell", { n: sv }) + " (S)", sellSel));
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
    $("chart").hidden = true;
    resize();
    renderAll();
    canvas.focus({ preventScroll: true });
  }

  // ---------- 8. Island chart ----------
  function showChart() {
    if (view === "play" && game && underWay()) { paused = true; saveSession(); }
    view = "chart";
    sel = -1;
    document.body.classList.remove("playing");
    $("tip").hidden = true;
    renderChart();
    $("chart").hidden = false;
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
  function renderChart() {
    var box = $("chart");
    box.textContent = "";
    var wrap = el("div", "ch-wrap");
    wrap.appendChild(el("p", "ch-intro", t("ch.intro")));
    if (underWay()) {
      var cont = el("button", "ch-cont", t("ch.cont", { r: rdName(game.ridge), n: Math.max(1, game.wave) }));
      cont.type = "button";
      cont.addEventListener("click", showPlay);
      wrap.appendChild(cont);
    }
    wrap.appendChild(el("div", "ch-island", t("ch.diff")));
    var seg = el("div", "seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", t("ch.diff"));
    E.DIFFS.forEach(function (d) {
      var b = el("button", "", t("diff." + d));
      b.type = "button";
      b.setAttribute("aria-pressed", prefs.diff === d ? "true" : "false");
      b.addEventListener("click", function () { prefs.diff = d; savePrefs(); renderChart(); });
      seg.appendChild(b);
    });
    wrap.appendChild(seg);
    wrap.appendChild(el("div", "ch-island", t("ch.island1")));
    E.RIDGES.forEach(function (rd) {
      var open = E.isOpen(data, rd.id);
      var b = el("button", "ridge-card" + (underWay() && game.ridge === rd.id ? " cur" : ""));
      b.type = "button";
      b.disabled = !open;
      b.appendChild(el("span", "no", String(rd.idx + 1)));
      var tx = el("span", "tx");
      tx.appendChild(el("span", "nm", rdName(rd.id)));
      var kinds = E.KINDS.filter(function (k) { return E.TOWERS[k].u <= Math.min(4, rd.idx + 1); }).map(function (k) { return t("tw." + k); });
      tx.appendChild(el("span", "fx", open ? t("ch.waves", { n: rd.waves.length }) + " · " + t("ch.towers", { list: kinds.join(", ") }) : t("ch.lock")));
      b.appendChild(tx);
      b.appendChild(starIcons(E.starsOf(data, rd.id)));
      b.setAttribute("aria-label", rdName(rd.id) + ", " + E.starsOf(data, rd.id) + "/3");
      b.addEventListener("click", function () { pickRidge(rd.id); });
      wrap.appendChild(b);
    });
    var rs = el("button", "dlg-btn danger ch-reset", t("btn.reset"));
    rs.type = "button";
    rs.addEventListener("click", function () {
      confirmDialog(t("ch.resetAsk"), t("btn.resetYes"), resetProgress);
    });
    wrap.appendChild(rs);
    box.appendChild(wrap);
  }
  function pickRidge(id) {
    if (underWay() && game.acts > 0 && (game.ridge !== id || game.diff !== prefs.diff)) {
      confirmDialog(t("ch.replace", { r: rdName(game.ridge), s: rdName(id) }), t("btn.ok"), function () { startNight(id, prefs.diff); });
      return;
    }
    if (underWay() && game.ridge === id && game.diff === prefs.diff) { showPlay(); return; }
    startNight(id, prefs.diff);
  }
  // Reset progress: a new reset stamp, so older rows drop on every device.
  function resetProgress() {
    data = E.merge({ ver: 1, br: Math.max(Date.now(), data.br + 1), maps: {}, rows: {} }, data);
    saveData();
    showToast(t("toast.reset"));
    renderChart();
  }

  // ---------- 9. Dialogs ----------
  var dlgKind = "";
  function dlgOpen() { return $("dlg").open; }
  function openDialog(kind, build) {
    var d = $("dlg");
    if (d.open) d.close();
    d.textContent = "";
    dlgKind = kind;
    build(d);
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
      d.appendChild(el("div", "dlg-title", rdName(g.ridge) + " · " + t("diff." + g.diff)));
      d.appendChild(el("div", "dlg-hero", t(won ? "end.won" : "end.lost")));
      var st = el("div", "dlg-stars");
      for (var i = 0; i < 3; i++) { var s = el("span", i < E.stars(g) ? "" : "off"); s.innerHTML = ICONS.star; st.appendChild(s); }
      if (won) d.appendChild(st);
      d.appendChild(row(t("end.hearts"), g.hearts + " / " + g.hmax));
      d.appendChild(row(t("end.waves"), g.wave + " / " + g.nw));
      d.appendChild(row(t("end.faded"), g.faded));
      d.appendChild(el("p", "dlg-note", t(won ? "end.wonNote" : "end.lostNote")));
      if (opened) {
        var nk = E.KINDS.filter(function (k) { return E.TOWERS[k].u === E.RIDGE[opened].idx + 1; });
        if (nk.length) d.appendChild(el("p", "dlg-note", t("end.unlock", { t: t("tw." + nk[0]) })));
      }
      var a = el("div", "dlg-actions");
      if (!won && sess.ck) a.appendChild(dlgBtn(t("btn.again", { n: sess.ck.wave + 1 }), "primary", retryWave));
      var nx = nextRidgeId(g.ridge);
      if (won && nx) a.appendChild(dlgBtn(t("btn.nextRidge"), "primary", function () { closeDialog(); startNight(nx, g.diff); }));
      a.appendChild(dlgBtn(t("btn.restart"), "", function () { closeDialog(); startNight(g.ridge, g.diff); }));
      a.appendChild(dlgBtn(t("btn.toChart"), "", function () { closeDialog(); showChart(); }));
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
      if (kind === "shot") tone(900, 0, 0.05, "triangle", 0.03, 500);
      else if (kind === "bell") { tone(660, 0, 0.6, "sine", 0.05); tone(990, 0, 0.4, "sine", 0.02); }
      else if (kind === "oil") tone(240, 0, 0.25, "sawtooth", 0.02, 120);
      else if (kind === "push") tone(140, 0, 0.35, "triangle", 0.05, 90);
      else if (kind === "fade") tone(1200, 0, 0.12, "sine", 0.025, 1600);
      else if (kind === "heart") tone(110, 0, 0.5, "sawtooth", 0.05, 80);
      else if (kind === "build") { tone(440, 0, 0.07, "triangle", 0.07); tone(660, 0.05, 0.09, "triangle", 0.06); }
      else if (kind === "wave") { tone(220, 0, 0.3, "triangle", 0.06); tone(330, 0.12, 0.3, "triangle", 0.05); }
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
    chart:  SVG + '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/></svg>',
    help:   SVG + '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7"/><path d="M12 17h.01"/></svg>',
    sfxOn:  SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    sfxOff: SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
    heart:  SVG + '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/></svg>',
    coin:   SVG + '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10h5M9.5 14h5"/></svg>',
    wave:   SVG + '<path d="M3 15c2-3 4-3 6 0s4 3 6 0 4-3 6 0"/><path d="M3 9c2-3 4-3 6 0s4 3 6 0 4-3 6 0"/></svg>',
    wind:   SVG + '<path d="M12 21V4"/><path d="M6 10l6-6 6 6"/></svg>',
    play:   SVG + '<path d="M7 4l13 8-13 8z"/></svg>',
    pause:  SVG + '<path d="M8 4v16M16 4v16"/></svg>',
    up:     SVG + '<path d="M12 20V5M5 12l7-7 7 7"/></svg>',
    sell:   SVG + '<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/></svg>',
    aim:    SVG + '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
    star:   SVG + '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill="currentColor"/></svg>',
    sling:  SVG + '<path d="M12 21v-9M6 4l6 8 6-8"/></svg>',
    bell:   SVG + '<path d="M6 17c0-6 1-11 6-11s6 5 6 11z"/><path d="M4 17h16M12 20v.01"/></svg>',
    press:  SVG + '<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><circle cx="12" cy="12" r="2"/></svg>',
    mill:   SVG + '<path d="M12 12 5 5M12 12l7-7M12 12l-7 7M12 12l7 7"/><circle cx="12" cy="12" r="1.5"/></svg>',
    fog_w:  SVG + '<circle cx="12" cy="12" r="6"/></svg>',
    fog_r:  SVG + '<path d="M12 4c4 5 5 8 5 10a5 5 0 0 1-10 0c0-2 1-5 5-10z"/></svg>',
    fog_s:  SVG + '<path d="M12 5l6 3.5v7L12 19l-6-3.5v-7z"/></svg>',
    fog_p:  SVG + '<circle cx="9" cy="14" r="4"/><circle cx="15" cy="14" r="4"/><circle cx="12" cy="9" r="4"/></svg>',
    fog_m:  SVG + '<circle cx="12" cy="12" r="3.5"/></svg>',
    fog_b:  SVG + '<ellipse cx="12" cy="12" rx="9" ry="5"/></svg>'
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
    api.registerSlice("ridge", sliceGet, sliceSet, STORAGE_KEY, mergeRidge);
  }
  function mergeRidge(a, b) { return E.merge(a, b); }
  function sliceGet() { return data; }
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.maps) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      var m = E.merge(data, incoming);
      if (JSON.stringify(m) === JSON.stringify(data)) return;
      data = m;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
      if (view === "chart") renderChart();
    } finally {
      window.__orosSyncApi._suppress = false;
    }
  }

  // ---------- 13. Test hooks, wiring & boot ----------
  // render_game_to_text: the visible state as JSON. Coordinates are
  // tiles of the 9 × 16 map, origin top left; s = distance along the
  // road in tiles, p = s / road length (0 the sea, 1 the well).
  window.render_game_to_text = function () {
    if (view !== "play" || !game) {
      return JSON.stringify({ mode: dlgKind || "chart", diff: prefs.diff,
        ridges: E.RIDGES.map(function (rd) { return { id: rd.id, open: E.isOpen(data, rd.id), stars: E.starsOf(data, rd.id) }; }) });
    }
    var rd = E.RIDGE[game.ridge];
    return JSON.stringify({
      mode: dlgKind || (game.over === 1 ? "won" : game.over === 0 ? "lost" : paused ? "paused" : "running"),
      ridge: game.ridge, diff: game.diff, speed: speed, hearts: game.hearts, coins: Math.floor(game.coins),
      wave: game.wave, waves: game.nw, wind: E.windNow(game), next: E.preview(game), sel: sel,
      towers: Object.keys(game.tw).map(function (p) {
        var tw = game.tw[p], q = rd.pads[p];
        return { pad: +p, c: q[0], r: q[1], k: tw.k, l: tw.l, b: tw.b, aim: E.TARGETS[tw.tm] };
      }),
      pads: rd.pads.length,
      fog: game.fog.map(function (f) {
        var q = E.posAt(rd, f.s);
        return { k: f.k, x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10, p: Math.round(f.s / rd.len * 100) / 100, hp: Math.ceil(f.hp) };
      }),
      note: "tiles 9x16, origin top left; p = 0 at the sea, 1 at the well"
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
    [["chart-btn", "chart", "btn.chart"], ["help-btn", "help", "btn.help"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = ICONS[x[1]];
      b.title = t(x[2]); b.setAttribute("aria-label", t(x[2]));
    });
    paintSfxBtn();
  }
  function wire() {
    $("chart-btn").addEventListener("click", function () { if (view === "chart" && underWay()) showPlay(); else showChart(); });
    $("help-btn").addEventListener("click", tourDialog);
    $("sfx-btn").addEventListener("click", toggleSfx);
    $("pause-btn").addEventListener("click", togglePause);
    $("speed-btn").addEventListener("click", cycleSpeed);
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
    // a night under way reopens paused; otherwise the island chart
    if (underWay()) showPlay(); else showChart();
    if (!prefs.tour) tourDialog();
    startLoop();
  }

  boot();
})();
