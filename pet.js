// ============================================================
// orOS Screen Pet — Shell component
// v0.3 (Wave 5 evolution: pencil rename, food animation,
//       catch mini-game, event log, calendar feed, birthday toast)
//
// ARCHITECTURE (design decisions — do not change casually):
//   - Lives INSIDE the shell document (not an iframe app).
//     Creates its own overlay layer; never touches existing
//     shell DOM ids. Palette comes from CSS vars for free.
//   - Synced identity, local choreography: the pet ENTITY
//     (name/palette/timestamps) is synced via orosSync slice;
//     runtime position/frame/mode are per-device, never stored.
//   - Stats are DERIVED, never stored (Quote/Cycle doctrine):
//       food  = 100 - minutesSinceLastFed      * FOOD_RATE
//       happy = 100 - minutesSincePetted       * HAPPY_RATE
//       energy = cycle simulation (awake decay / asleep
//                recovery) from transition anchors — fully
//                deterministic, no wall-clock writes, no drift.
//     Auto-sleep (<8) and auto-wake (>=95) are PURE DERIVED
//     transitions: long absences resolve retroactively via the
//     same math, identical on every device.
//   - Relaxed pacing (orOS stance): food ~24h, happy ~36h,
//     energy ~10h awake / ~5h asleep. No death — floor is 0
//     (grumpy, immortal — Bible Part IX exemption).
//   - Merge: temporal fields are their own clocks (newer value
//     wins); paired anchors travel together; name/palette use
//     per-field mtime map (fm). Never wall-clock writes.
//   - Stays OFF the z-stack: no external assets, no intervals
//     that write state, keyboard fully guarded (no OS combos).
//
// v0.3 EVOLUTION (approved waves — no schema change, DATA_VER
// stays 1; fm/palette/name/birthTs already existed in v0.1):
//   - Wave 5a (UX polish): inline SVG pencil icon next to name
//     (dblclick still works), food sprite animation during eat
//     mode, catch mini-game (ball falls, click to catch → +10
//     happy/energy, 5-min cooldown), event log modal (last 100
//     entries device-local), contemplation mode (idle after 5
//     min non-interaction), first-feed-of-day greeting, birthday
//     toast (anniversary with hearts), theme-sync (canvas bg
//     adapts to --bg/--panel-bg).
//   - Wave 5b (Calendar integration): pet events feed into the
//     orOS Calendar as read-only all-day rows with a purple
//     "Screen Pet" label (same contract as Contacts/Cycle/Mood/
//     Habits/Kanban feeds). Event types: Feed, Pet, Sleep, Wake,
//     New Pet, Birthday. Synced event log slice ("petEvents" —
//     union merge, see 2b-2), rolling buffer (max 100 entries).
//     Calendar deep-link (click → open pet dialog).
//
// Sections:
//   1. Constants, i18n, helpers (v0.3 speech pools, event types)
//   2. State model, storage, event log, calendar feed slice
//   3. Derived stats, mood, birthday logic, petFeedOn
//   4. Sprite engine (moods, food anim, catch ball, contemplation)
//   5. Interactions + HUD (pencil, event log, catch handler)
//   6. Boot & shell toggle (birthday toast, calendar deep-link)
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-pet-data";
  var DATA_VER = 1;
  var ENABLED_KEY = "oros-pet-enabled";   // LEGACY (v0.3): migrated → synced petSettings.enabled
  var POS_KEY = "oros-pet-pos";           // device-local position memory (v0.2)
  var EVENTS_KEY = "oros-pet-events";     // v0.3.1+: event log (SYNCED slice "petEvents")
  var CALENDAR_SYNC_KEY = "oros-pet-calendar-sync"; // legacy mirror view (calendar.js reader)
  var MAX_NAME_LEN = 16;                  // v0.2: rename input cap
  var HUNGER_TALK_MS = 10 * 60 * 1000;    // v0.2: hungry bubble cadence
  var EVENT_LOG_MAX = 100;                // v0.3: rolling buffer cap
  var CATCH_COOLDOWN_MS = 5 * 60 * 1000;  // v0.3: catch game cooldown
  var CONTEMPLATION_IDLE_MS = 5 * 60 * 1000; // v0.3: contemplation trigger

  // ---------- 1. Constants, i18n, helpers ----------
  // PT-4: the pet lives in the shell document and is never reloaded
  // by a language switch — a LANG read once at load left the whole
  // HUD in the old language until the next full reload. currentLang()
  // is re-read on every HUD refresh (once a second).
  function currentLang() {
    var l = window.orosLang;
    if (l !== "el" && l !== "en") {
      try { l = localStorage.getItem("oros-lang"); } catch (e) { l = "en"; }
    }
    return l === "el" ? "el" : "en";
  }
  var LANG = currentLang();

  // Relaxed decay (units per minute)
  var FOOD_RATE    = 100 / (24 * 60);   // ~24h from 100 to 0
  var HAPPY_RATE   = 100 / (36 * 60);   // ~36h
  var ENERGY_DECAY = 100 / (10 * 60);   // ~10h awake
  var ENERGY_GAIN  = 100 / (5 * 60);    // ~5h asleep
  var SLEEP_AT     = 8;                 // auto-sleep threshold
  var WAKE_AT      = 95;                // auto-wake threshold

  // v0.3: Event types (for log + calendar feed)
  var PET_EVENT_TYPES = {
    FEED:   "feed",
    PET:    "pet",
    SLEEP:  "sleep",
    WAKE:   "wake",
    NEWPET: "newpet",
    BIRTHDAY: "birthday",
    CATCH:  "catch"
  };

  var STRINGS = {
    en: {
      "hud.name":        "{name}",
      "hud.age.one":     "{n} day with you",
      "hud.age.many":    "{n} days with you",
      "hud.firstfeed":   "First feed of the day!",
      "stat.food":       "Food",
      "stat.happy":      "Happy",
      "stat.energy":     "Energy",
      "action.feed":     "Feed",
      "action.sleep":    "Sleep",
      "action.wake":     "Wake up",
      "action.newpet":   "New pet",
      "action.rename":   "Rename",
      "action.viewlog":  "Activity log",
      "action.forest":   "Forest",
      "away.label":      "On a walk · back {time}",
      "away.title":      "{name} is on a walk in the forest. Open Pet World",
      "action.catch":    "Catch!",
      "menu.pet":        "Screen Pet",
      "confirm.newpet":  "Release {name} and welcome a new pet? This cannot be undone.",
      "confirm.no":      "Cancel",
      "confirm.yes":     "New pet",
      "speech.hello":    "Hi! My name is {name}!",
      "speech.firstfed": ["You're the first to feed me today!",
                          "Fresh breakfast! Thanks!",
                          "Best way to start the day!"],
      "speech.hungry":   ["I'm hungry...", "Food? Any food?", "My tummy is rumbling!",
                          "Feed me, please!", "Is it dinner time yet?"],
      "speech.bored":    ["Pet me!", "I'm bored...", "Play with me!",
                          "Hey! Look at me!", "So quiet here..."],
      "speech.tired":    ["I'm sleepy...", "Yaaawn...", "Ohh...",
                          "Can't keep my eyes open...", "Need... sleep..."],
      "speech.happy":    ["Lalala!", "I'm so happy!", "Whooo!",
                          "Best day ever!", "Hehe!"],
      "speech.eat":      ["Yum yum!", "Delicious!", "More please!",
                          "Tasty!", "Nom nom!"],
      "speech.wake":     ["Good morning!", "I'm awake!", "Slept great!",
                          "Hello sunshine!", "Ready to play!"],
      "speech.sleep":    ["Good night...", "Zzz...", "Sweet dreams",
                          "Nighty night...", "See you tomorrow..."],
      "speech.fav":      ["My favourite!!", "Yesss, my favourite!", "You remembered!"],
      "speech.back":     ["I'm back!", "What a walk!", "Look what I found!"],
      "speech.catch":    ["Gotcha!", "Nailed it!", "Awesome!",
                          "Perfect catch!", "Yes!"],
      "speech.contemp":  ["Just thinking...", "Hmm...", "Contemplating...",
                          "Quiet moment...", "Reflecting..."],
      "event.log.title": "Activity Log",
      "event.log.empty": "No recent activity",
      "event.type.feed": "Was fed",
      "event.type.pet":  "Was petted",
      "event.type.sleep": "Went to sleep",
      "event.type.wake":  "Woke up",
      "event.type.newpet": "New pet arrived",
      "event.type.catch": "Caught the ball",
      "event.type.birthday": "Birthday!",
      "evt.today": "Today",
      "evt.yesterday": "Yesterday",
      "evt.date": "{d}/{m}/{y}",
      "notif.bday.first": "First birthday for {name}!",
      "notif.bday.years": "{name} turns {years} years old!",
      "cal.pet.feed": "{name} was fed",
      "cal.pet.pet": "{name} was petted",
      "cal.pet.sleep": "{name} went to sleep",
      "cal.pet.wake": "{name} woke up",
      "cal.pet.new": "{name} started life",
      "cal.pet.catch": "Ball catch!",
      "cal.pet.bday": "{name}'s birthday!"
    },
    el: {
      "hud.name":        "{name}",
      "hud.age.one":     "{n} ημέρα μαζί σου",
      "hud.age.many":    "{n} ημέρες μαζί σου",
      "hud.firstfeed":   "Πρώτο φαγητό σήμερα!",
      "stat.food":       "Φαγητό",
      "stat.happy":      "Διάθεση",
      "stat.energy":     "Ενέργεια",
      "action.feed":     "Φαγητό",
      "action.sleep":    "Ύπνος",
      "action.wake":     "Ξύπνα",
      "action.newpet":   "Νέο πλάσμα",
      "action.rename":   "Μετονομασία",
      "action.viewlog":  "Ιστορικό δραστηριότητας",
      "action.forest":   "Δάσος",
      "away.label":      "Σε βόλτα · γυρνά {time}",
      "away.title":      "{name}: σε βόλτα στο δάσος. Άνοιξε τον κόσμο του κατοικιδίου",
      "action.catch":    "Πιάσε το!",
      "menu.pet":        "Screen Pet",
      "confirm.newpet":  "Αποχαιρετάς το πλάσμα «{name}» και έρχεται καινούργιο; Δεν αναιρείται.",
      "confirm.no":      "Άκυρο",
      "confirm.yes":     "Νέο πλάσμα",
      "speech.hello":    "Γεια! Με λένε {name}!",
      "speech.firstfed": ["Το πρώτο φαγητό της ημέρας!",
                          "Φρέσκο πρωινό! Ευχαριστώ!",
                          "Ο καλύτερος τρόπος να ξεκινήσεις την ημέρα!"],
      "speech.hungry":   ["Πεινάω...", "Μμμ, φαγητό;", "Το στομάχι μου γκρινιάζει!",
                          "Τάισέ με, σε παρακαλώ!", "Είναι ώρα για φαγητό;"],
      "speech.bored":    ["Χάιδεψέ με!", "Βαριέμαι...", "Παίξε μαζί μου!",
                          "Έλα! Κοίτα με!", "Τόση ησυχία εδώ..."],
      "speech.tired":    ["Νυστάζω...", "Ωωχ...", "Νιώθω το κρεβάτι να με φωνάζει",
                          "Δεν ανοίγω τα μάτια μου...", "Χρειάζομαι... ύπνο..."],
      "speech.happy":    ["Λαλάλα!", "Τι χαρά!", "Χοοοοπ!",
                          "Κορυφαία μέρα!", "Χιχι!"],
      "speech.eat":      ["Ναμ ναμ!", "Νόστιμο!", "Κι άλλο!",
                          "Πεντανόστιμο!", "Ναμ ναμ ναμ!"],
      "speech.wake":     ["Καλημέρααα!", "Ξύπνησα!", "Τι ωραίος ύπνος!",
                          "Γεια σου ήλιε!", "Πάμε για παιχνίδι!"],
      "speech.sleep":    ["Καληνύχτα...", "Zzz...", "Όνειρα γλυκά",
                          "Υπνάκια...", "Τα λέμε αύριο..."],
      "speech.fav":      ["Το αγαπημένο μου!!", "Ναιιι, το αγαπημένο μου!", "Το θυμήθηκες!"],
      "speech.back":     ["Γύρισα!", "Τι ωραία βόλτα!", "Δες τι βρήκα!"],
      "speech.catch":    ["Την έπιασα!", "Το 'χω!", "Τέλεια!",
                          "Τι πιάσιμο!", "Ναι!"],
      "speech.contemp":  ["Σκέφτομαι...", "Μμμ...", "Απολαμβάνω...",
                          "Ηρεμία...", "Σιωπηλή στιγμή..."],
      "event.log.title": "Ιστορικό Δραστηριότητας",
      "event.log.empty": "Καμία πρόσφατη δραστηριότητα",
      "event.type.feed": "Έφαγε",
      "event.type.pet":  "Πήρε χάδια",
      "event.type.sleep": "Πήγε για ύπνο",
      "event.type.wake":  "Ξύπνησε",
      "event.type.newpet": "Ήρθε νέο πλάσμα",
      "event.type.catch": "Έπιασε την μπάλα",
      "event.type.birthday": "Γενέθλια!",
      "evt.today": "Σήμερα",
      "evt.yesterday": "Χθες",
      "evt.date": "{d}/{m}/{y}",
      "notif.bday.first": "Τα πρώτα γενέθλια: {name}!",
      "notif.bday.years": "{name}: {years} χρόνια μαζί σου!",
      "cal.pet.feed": "{name}: φαγητό",
      "cal.pet.pet": "{name}: χάδια",
      "cal.pet.sleep": "{name}: ύπνος",
      "cal.pet.wake": "{name}: ξύπνημα",
      "cal.pet.new": "{name}: πρώτη μέρα",
      "cal.pet.catch": "Πιάστηκε η μπάλα!",
      "cal.pet.bday": "Γενέθλια: {name}!"
    }
  };

  var NAMES = {
    en: ["Pixel", "Bean", "Mochi", "Pip", "Waffles", "Ziggy", "Bloop", "Pesto"],
    el: ["Πίκα", "Κόκο", "Μπέλλα", "Λόλι", "Νούφα", "Σίσσυ", "Κούκος", "Μήλο",
         "Φασολάκης", "Καφέ", "Ζίτα", "Πάντζαρης", "Μπέγια", "Σουάρι", "Τρίγωνο"]
  };

  // v0.2: bilingual palette names (picker tooltips follow LANG)
  var PALETTES = [
    { nameEn: "Sky blue", nameEl: "Γαλάζιο",   body: "#81d4fa", belly: "#e1f5fe", eye: "#0b2030" },
    { nameEn: "Orange",  nameEl: "Πορτοκαλί", body: "#ffb74d", belly: "#fff3e0", eye: "#5d2900" },
    { nameEn: "Green",   nameEl: "Πράσινο",   body: "#a5d6a7", belly: "#f1f8e9", eye: "#1b3a1e" },
    { nameEn: "Pink",    nameEl: "Ροζ",       body: "#f48fb1", belly: "#fce4ec", eye: "#4a1430" },
    { nameEn: "Purple",  nameEl: "Μωβ",       body: "#b39ddb", belly: "#ede7f6", eye: "#2c1849" }
  ];
  function palName(i) {
    var p = PALETTES[clamp(i, 0, PALETTES.length - 1)];
    return LANG === "el" ? p.nameEl : p.nameEn;
  }

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var v = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (typeof v === "string" && params) {
      Object.keys(params).forEach(function (k) {
        v = v.replace(new RegExp("\\{" + k + "\\}", "g"), params[k]);
      });
    }
    return v;
  }
  function speakLine(group) {
    var arr = t(group);
    if (!Array.isArray(arr)) return String(arr);
    return arr[Math.floor(Math.random() * arr.length)];
  }
  function rndName() {
    var arr = NAMES[LANG] || NAMES.el;
    return arr[Math.floor(Math.random() * arr.length)];
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function minutesBetween(fromMs, toMs) { return Math.max(0, (toMs - fromMs) / 60000); }
  function ymd(y, m, d) { return y + "-" + pad(m + 1) + "-" + pad(d); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function todayYMD() {
    var n = new Date();
    return ymd(n.getFullYear(), n.getMonth(), n.getDate());
  }
  // dparse removed (unused — replaced by tsLocalYmd)

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    console.log("pet.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // v0.3: Theme sync removed (no-op — canvas stays transparent)
  
    // ---------- 2. State model, storage, field writes, position memory ----------
  // state = {
  //   ver: 1, sm: <root mtime>, deleted: { <petId>: ts },
  //   pet: {
  //     id, name, palette, birthTs,
  //     lastFed: <ts>, lastPetted: <ts>,
  //     // energy anchors — exactly ONE pair is active:
  //     wokeAt: <ts>,       awakeE: <number>,   // awake period start + energy at wake
  //     asleepSince: <ts|null>, asleepE: <number>  // sleep period start + energy at onset
  //   },
  //   fm: { name: <ts>, palette: <ts> }   // per-field mtimes for non-temporal fields
  // }
  var state = null;
  var runtime = null;   // per-device choreography (Part 4), never synced

  // PT-1: a pet nobody has touched yet is PROVISIONAL — sm 0, fm 0.
  // Every device creates one at its first boot, even with the pet
  // switched off. Stamped "now" (as before), the newcomer's random
  // pet was the NEWEST entity at the first sync and replaced the
  // pet the user already had — name, age and history — on every
  // device. With sm 0 any real pet wins; the first real interaction
  // (writePet) stamps it and makes it real.
  function defaultState() {
    var now = Date.now();
    return {
      ver: DATA_VER,
      sm: 0,
      deleted: {},
      pet: {
        id: uid(),
        name: rndName(),
        palette: Math.floor(Math.random() * PALETTES.length),
        birthTs: now,
        lastFed: now,
        lastPetted: now,
        wokeAt: now, awakeE: 100,
        asleepSince: null, asleepE: 0
      },
      fm: { name: 0, palette: 0 }
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        if (data && data.pet && data.pet.id) {
          state = data;
          if (!state.deleted) state.deleted = {};
          if (!state.fm) state.fm = {};
          return;
        }
      }
    } catch (e) { /* corrupted → fresh start */ }
    state = defaultState();
    // PT-1: stored, but NOT announced to the sync engine — a
    // provisional pet is not work that must reach the cloud.
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e2) { /* quota */ }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* quota */ }
    if (window.__orosPetSyncApi) window.__orosPetSyncApi.dirty();
  }

  // Every mutation goes through a small write API so field mtimes
  // stay consistent and the sync engine sees a coherent entity.
  function writePet(mutator) {
    var now = Date.now();
    mutator(state.pet, now);
    state.sm = now;
    save();
  }

  // POSITION MEMORY — device-local like oros-pet-enabled
  // (ergonomics, never synced, never dirty). Stored as NORMALIZED
  // fractions (fx over stage width, fy over floor height) so a
  // restore on a different window size still lands on-screen.
  function savePos() {
    try {
      if (!runtime || !runtime.active || !runtime.layer) return;
      var b = stageBounds();
      if (!b.w || b.floorY <= 0) return;
      localStorage.setItem(POS_KEY, JSON.stringify({
        fx: runtime.x / b.w,
        fy: runtime.y / b.floorY
      }));
    } catch (e) { /* position memory is best-effort only */ }
  }

  function loadPos() {
    try {
      var raw = localStorage.getItem(POS_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (!p || typeof p.fx !== "number" || typeof p.fy !== "number") return null;
      return { fx: clamp(p.fx, 0, 1), fy: clamp(p.fy, 0, 1) };
    } catch (e) { return null; }
  }

  // AGE — pure display math from birthTs (display-only field,
  // Part IX: never part of any sync computation)
  function ageDays(now) {
    return Math.max(0, Math.floor(((now) - (state.pet.birthTs || now)) / 86400000));
  }

  // ---------- 2b. Event log (v0.3.1: synced slice "petEvents") ----------
  // Rolling buffer of care/history moments. TWO consumers:
  //   1. The pet's own Activity Log modal (HUD, Part 5).
  //   2. The orOS Calendar pet feed (calendar.js petFeedOn reads
  //      this key DIRECTLY — same-origin shared localStorage,
  //      exact same read pattern as Contacts/Cycle/Mood/Habits).
  // Schema: { ver, events: [ { id, ts, type, name } ] }
  //   - type ∈ PET_EVENT_TYPES values
  //   - name = SNAPSHOT of the pet's name at event time (a rename
  //     must not rewrite history; a "New Pet" event keeps the old
  //     friend's name in the log, and the calendar row stays honest)
  //   - v0.3.1: SYNCED SLICE ("petEvents") — union by id on merge;
  //     birthday events use a DETERMINISTIC id (pet+day) so two
  //     devices logging the same anniversary collapse to one row.
  //     clearLog propagates via clearedAt (events older than the
  //     newest wipe are dropped in the merge — deterministic).
  // Trimmed to EVENT_LOG_MAX (100) newest entries on every write.
  function loadEventLog() {
    try {
      var d = JSON.parse(localStorage.getItem(EVENTS_KEY));
      if (d && typeof d === "object" && Array.isArray(d.events)) return d;
    } catch (e) {}
    return { ver: 1, events: [] };
  }

  function saveEventLog(log) {
    try {
      // rolling trim — oldest dropped, newest kept
      if (log.events.length > EVENT_LOG_MAX) {
        log.events = log.events.slice(-EVENT_LOG_MAX);
      }
      localStorage.setItem(EVENTS_KEY, JSON.stringify(log));
    } catch (e) { /* best-effort — the log is decorative, not vital */ }
  }

  // Single funnel: every care action logs through here (Part 4/5
  // call sites: feed, petThePet, toggleSleep, confirmNewPet, catch,
  // birthday toast). Suppressed when the calendar feed is opted
  // out (still logs? YES — decision record: the Activity Log is the
  // pet's OWN feature and always records; only the CALENDAR reads
  // respect the opt-out. Log always, filter at read.)
  function logEvent(type, idOverride) {
    if (!state || !state.pet) return;
    var log = loadEventLog();
    log.events.push({
      id: idOverride || uid(),
      ts: Date.now(),
      type: String(type),
      name: state.pet.name
    });
    saveEventLog(log);
    // v0.3.1: the log is a synced slice — a new entry is dirty work
    // (debounced push fires ~5s later via the existing funnel)
    if (window.__orosPetSyncApi) window.__orosPetSyncApi.dirty();
  }

  function eventLogEntries() {
    return loadEventLog().events;
  }

  function clearEventLog() {
    try {
      localStorage.setItem(EVENTS_KEY, JSON.stringify({
        ver: 1, clearedAt: Date.now(), events: []
      }));
    } catch (e) { return; }
    if (window.__orosPetSyncApi) window.__orosPetSyncApi.dirty();
  }
  
  // ---------- 2b-2. Event log sync slice (v0.3.1) ----------
  // The log is a synced slice ("petEvents", storage key EVENTS_KEY
  // — the SAME key the calendar feed reads, so calendar.js needs
  // no change). Merge = UNION by event id (events are immutable
  // after writing), deterministic sort by (ts, id), then a rolling
  // trim to EVENT_LOG_MAX. clearedAt propagates a clearLog wipe:
  // events with ts <= clearedAt are dropped on every merge, so a
  // wipe performed on ANY device wins everywhere, deterministically.
  function mergeEventLogs(A, B) {
    var aEv = (A && Array.isArray(A.events)) ? A.events : [];
    var bEv = (B && Array.isArray(B.events)) ? B.events : [];
    var clearedAt = Math.max((A && A.clearedAt) || 0, (B && B.clearedAt) || 0);
    var byId = {};
    var ids = [];
    aEv.concat(bEv).forEach(function (ev) {
      if (!ev || !ev.id || typeof ev.ts !== "number") return;
      if (ev.ts <= clearedAt) return;                 // wiped by the newer clear
      if (!Object.prototype.hasOwnProperty.call(byId, ev.id)) {
        byId[ev.id] = ev;
        ids.push(ev.id);
      } else {
        // Same id, different payload (legacy anomaly): deterministic
        // tie-break — smaller JSON serialization wins.
        var prev = byId[ev.id];
        if (JSON.stringify(ev) < JSON.stringify(prev)) byId[ev.id] = ev;
      }
    });
    var merged = ids.map(function (id) { return byId[id]; })
      .sort(function (x, y) {
        return (x.ts - y.ts) || (x.id < y.id ? -1 : (x.id > y.id ? 1 : 0));
      });
    if (merged.length > EVENT_LOG_MAX) merged = merged.slice(-EVENT_LOG_MAX);
    return { ver: 1, clearedAt: clearedAt, events: merged };
  }

  function eventsSliceGet() {
    // Deep clone — the sync engine stringifies for equality checks;
    // never hand it the live object.
    // PT-10: same SHAPE as mergeEventLogs() returns (ver, clearedAt,
    // events). A log that was never cleared had no "clearedAt" here
    // and "clearedAt: 0" after a merge — so the first pull after any
    // push "applied 1 section" for nothing.
    var log = loadEventLog();
    return JSON.parse(JSON.stringify({
      ver: 1,
      clearedAt: (log && typeof log.clearedAt === "number") ? log.clearedAt : 0,
      events: (log && Array.isArray(log.events)) ? log.events : []
    }));
  }

  function eventsSliceSet(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.events)) return;
    window.__orosPetSyncApi._suppress = true;
    try {
      localStorage.setItem(EVENTS_KEY, JSON.stringify(data));
    } finally {
      window.__orosPetSyncApi._suppress = false;
    }
    // No live rerender needed: the log modal reads on open, and the
    // calendar feed reads localStorage at render time — the next
    // paint of either picks the merged content up.
  }

// ---------- 2b-3. Pet Settings sync slice (v0.3.2) ----------
// Synced preferences that MUST travel across devices:
//   - calFeed: boolean (calendar feed enabled/disabled)
//   - enabled / minimized (v0.4)
// Device-local ergonomics (NOT synced, NOT in this slice):
//   - oros-pet-pos
// Merge = per-field LWW (last-write-wins), simplest possible.
// PT-2: ONE shape everywhere. The getter returned the settings
// WITHOUT "ver", the merge returned them WITH it, the setter stored
// them without it again — so after every pull the merged value
// differed from both the local and the cloud copy: "1 section
// updated" and a fresh upload on EVERY sync cycle, forever. And a
// tie between two stamps picked "the first argument", i.e. each
// device picked its own value and the two never agreed.
function petSettingsCanon(s) {
  s = (s && typeof s === "object") ? s : {};
  function ts(k) { return (typeof s[k] === "number" && isFinite(s[k]) && s[k] >= 0) ? s[k] : 0; }
  return {
    ver:         1,
    calFeed:     (typeof s.calFeed === "boolean") ? s.calFeed : true,
    calFeedTs:   ts("calFeedTs"),
    enabled:     (typeof s.enabled === "boolean") ? s.enabled : false,
    enabledTs:   ts("enabledTs"),
    minimized:   (typeof s.minimized === "boolean") ? s.minimized : false,
    minimizedTs: ts("minimizedTs")
  };
}

function mergePetSettings(A, B) {
  var a = petSettingsCanon(A), b = petSettingsCanon(B);
  // Newer stamp wins; on an exact tie the same value on both
  // devices: "true" (deterministic, symmetric).
  function lww(field) {
    var at = a[field + "Ts"], bt = b[field + "Ts"];
    if (at !== bt) return (at > bt) ? { v: a[field], ts: at } : { v: b[field], ts: bt };
    return { v: (a[field] || b[field]), ts: at };
  }
  var cf = lww("calFeed"), en = lww("enabled"), mn = lww("minimized");
  return {
    ver:         1,
    calFeed:     cf.v,
    calFeedTs:   cf.ts,
    enabled:     en.v,
    enabledTs:   en.ts,
    minimized:   mn.v,
    minimizedTs: mn.ts
  };
}

function settingsSliceGet() {
  var s = null;
  try { s = JSON.parse(localStorage.getItem("oros-pet-settings")); } catch (e) {}
  return petSettingsCanon(s);
}

function settingsSliceSet(data) {
  if (!data || typeof data !== "object") return;
  window.__orosPetSyncApi._suppress = true;
  try {
    var out = petSettingsCanon(data);
    localStorage.setItem("oros-pet-settings", JSON.stringify(out));
    // LEGACY MIRROR: calendar.js (unmodified) still reads
    // "oros-pet-calendar-sync" at render time. We keep it in
    // lock-step so the calendar honors the synced value on every
    // device. oros-pet-settings remains the single source of
    // truth; this key is a derived read-only view for the calendar.
    try { localStorage.setItem(CALENDAR_SYNC_KEY, out.calFeed ? "1" : "0"); } catch (e) {}
    applyPetSettings(out);
  } finally {
    window.__orosPetSyncApi._suppress = false;
  }
}

function applyPetSettings(s) {
  // Live application — calendar feed reads this directly
  if (typeof s.calFeed === "boolean") {
    window.__orosPetCalFeedEnabled = s.calFeed;
  }
  // v0.4: on/off + minimized apply LIVE from the synced slice.
  // Idempotent (petEnable/petDisable guard on runtime.active),
  // never writes back — no sync echo loop.
  if (typeof s.enabled === "boolean") {
    if (s.enabled) petEnable(); else petDisable();
  }
  if (runtime && runtime.active && state && state.pet) {
    refreshHUD(computeStats(Date.now(), state.pet));
  }
}

  // ---------- 2c. Calendar feed helpers (v0.3.2: synced) ----------
  // The opt-out now travels in the synced "petSettings" slice
  // (key "oros-pet-settings"). Default: ON when absent.
  // Legacy key "oros-pet-calendar-sync" is migrated once at boot.
  function calendarFeedOn() {
    var raw = localStorage.getItem("oros-pet-settings");
    try {
      var s = JSON.parse(raw);
      if (s && typeof s.calFeed === "boolean") return s.calFeed;
    } catch (e) {}
    return true;   // default positive, like weather
  }
  function setCalendarFeed(on) {
    var cur = settingsSliceGet();
    cur.calFeed = !!on;
    cur.calFeedTs = Date.now();
    settingsSliceSet(cur);
    // A user toggle is dirty work — settingsSliceSet suppresses
    // dirty during its own write, so the push must be armed HERE.
    // Without this the toggle rides only with the NEXT unrelated
    // write (feed/pet/save) — or never.
    if (window.__orosPetSyncApi) window.__orosPetSyncApi.dirty();
  }

  // Local-timezone YMD of a timestamp (calendar cells speak
  // "YYYY-MM-DD" — same convention as tsToLocalYmd in calendar.js)
  function tsLocalYmd(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    return ymd(d.getFullYear(), d.getMonth(), d.getDate());
  }

  // Birthday math: TRUE when the LOCAL calendar day is an exact
  // anniversary of birthTs (month + day match, year > birth year).
  // Deterministic from synced birthTs — every device agrees on the
  // DAY; the toast firing is device-local (dedupe key below).
  function birthdayYears(now) {
    var b = new Date(state.pet.birthTs || now);
    if (isNaN(b.getTime())) return 0;
    var n = new Date(now);
    var years = n.getFullYear() - b.getFullYear();
    // anniversary not reached yet this year → last completed year
    if (n.getMonth() < b.getMonth() ||
        (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) {
      years--;
    }
    return Math.max(0, years);
  }
  function isBirthdayToday(now) {
    var b = new Date(state.pet.birthTs || now);
    if (isNaN(b.getTime())) return false;
    var n = new Date(now);
    return n.getMonth() === b.getMonth() &&
           n.getDate() === b.getDate() &&
           n.getFullYear() > b.getFullYear();   // birth day itself ≠ birthday
  }
  
    // ---------- 3. Derived stats (pure functions — no writes) ----------

  // Energy cycle simulation. Walks awake/asleep periods forward from
  // the active anchor until `now` lands inside one. Deterministic:
  // same state + same now ⇒ same result on every device. Long
  // absences resolve retroactively (pet auto-slept/woke on schedule
  // without anyone watching).
  function computeEnergy(now, pet) {
    var asleep = pet.asleepSince !== null && pet.asleepSince !== undefined;
    var tm, ev;
    if (asleep) { tm = pet.asleepSince; ev = pet.asleepE; }
    else { tm = pet.wokeAt || pet.birthTs; ev = (pet.awakeE === 0 ? 0 : (pet.awakeE || 100)); }

    for (var guard = 0; guard < 100000; guard++) {
      if (asleep) {
        var wakeAt = tm + ((WAKE_AT - ev) / ENERGY_GAIN) * 60000;
        if (now < wakeAt) return { asleep: true,  energy: clamp(ev + minutesBetween(tm, now) * ENERGY_GAIN, 0, 100) };
        tm = wakeAt; ev = WAKE_AT; asleep = false;
      } else {
        var sleepAt = tm + ((ev - SLEEP_AT) / ENERGY_DECAY) * 60000;
        if (now < sleepAt) return { asleep: false, energy: clamp(ev - minutesBetween(tm, now) * ENERGY_DECAY, 0, 100) };
        tm = sleepAt; ev = SLEEP_AT; asleep = true;
      }
    }
    // Numeric paranoia fallback (should never be reached)
    return { asleep: false, energy: 0 };
  }

  function computeStats(now, pet) {
    var e = computeEnergy(now, pet);
    return {
      food:   clamp(100 - minutesBetween(pet.lastFed || pet.birthTs, now) * FOOD_RATE, 0, 100),
      happy:  clamp(100 - minutesBetween(pet.lastPetted || pet.birthTs, now) * HAPPY_RATE, 0, 100),
      energy: e.energy,
      asleep: e.asleep
    };
  }

  // MOOD — pure derivation from stats, drives the sprite
  // expression. Priority: asleep > tired (low energy or
  // starving) > happy (well-loved) > neutral. No storage, no sync —
  // every device computes the same face from the same stats.
  // v0.3: "contemplation" is NOT a mood — it is a runtime chore-
  // ography state (Part 4), deliberately separate so a contemplating
  // pet still wears its honest emotional face.
  function mood(stats) {
    if (!stats) return "neutral";
    if (stats.asleep) return "sleep";
    if (stats.energy < 25 || stats.food < 20) return "tired";
    if (stats.happy > 60) return "happy";
    return "neutral";
  }

  // ---------- 4. Sync slice (per-field LWW merge) ----------
  // Doctrine: temporal fields ARE their clocks — max value wins.
  // Anchor pairs travel together (wokeAt+awakeE, asleepSince+asleepE):
  // whichever anchor timestamp is newer defines the active pair.
  // name/palette use per-field mtime map (fm). Tombstoned pet ids
  // win over any resurrected entity (dead pets stay dead).
  // v0.3.2 NOTE: the event log travels in its OWN slice
  // ("petEvents", mergeEventLogs — see 2b-2) and the calendar
  // feed toggle in "petSettings" (2b-3). Only oros-pet-pos and
  // oros-pet-enabled/minimized stay DEVICE-LOCAL.

  var TEMPORAL = ["lastFed", "lastPetted"];
  var FIELDS_LWW = ["name", "palette"];

  // PT-3 — canonical form (R26): fixed key order, tombstones sorted,
  // and exactly ONE active energy anchor pair. Used by the getter and
  // by the merge, so a converged pet produces no phantom push.
  var PET_KEYS = ["id", "name", "palette", "birthTs", "lastFed", "lastPetted",
                  "wokeAt", "awakeE", "asleepSince", "asleepE"];

  // The newer anchor is the active one: a pet woken AFTER it fell
  // asleep is awake. (The old merge took the newest asleepSince and
  // the newest wokeAt independently — a stale "asleep" from another
  // device put a freshly woken pet back to sleep.)
  function normalizeAnchors(pet) {
    var as = (typeof pet.asleepSince === "number") ? pet.asleepSince : 0;
    var wk = (typeof pet.wokeAt === "number") ? pet.wokeAt : 0;
    if (as > 0 && as >= wk) {
      pet.wokeAt = null;
      pet.awakeE = 0;
    } else {
      pet.asleepSince = null;
      pet.asleepE = 0;
    }
    return pet;
  }

  function canonPetState(st) {
    if (!st || !st.pet || !st.pet.id) return null;
    var del = {}, src = st.deleted || {};
    Object.keys(src).sort().forEach(function (id) { del[id] = src[id]; });
    var raw = {}, pet = {};
    Object.keys(st.pet).forEach(function (k) { raw[k] = st.pet[k]; });
    normalizeAnchors(raw);
    PET_KEYS.forEach(function (k) { if (raw[k] !== undefined) pet[k] = raw[k]; });
    Object.keys(raw).sort().forEach(function (k) { if (pet[k] === undefined && raw[k] !== undefined) pet[k] = raw[k]; });
    var fm = st.fm || {};
    return {
      ver: DATA_VER,
      sm: st.sm || 0,
      deleted: del,
      pet: pet,
      fm: { name: fm.name || 0, palette: fm.palette || 0 }
    };
  }

  function mergePetStates(A, B) {
    var a = A || {}, b = B || {};
    var aPet = a.pet || null, bPet = b.pet || null;

    // Tombstone union (max per id — timestamps, wall-clock-free)
    var del = {};
    var aDel = a.deleted || {}, bDel = b.deleted || {};
    Object.keys(aDel).forEach(function (id) { del[id] = aDel[id]; });
    Object.keys(bDel).forEach(function (id) { del[id] = Math.max(del[id] || 0, bDel[id]); });

    // Pick base entity: alive side wins over tombstoned side;
    // otherwise newer entity sm; tie → lexicographic JSON (R5).
    var aAlive = !!(aPet && aPet.id && !del[aPet.id]);
    var bAlive = !!(bPet && bPet.id && !del[bPet.id]);
    if (!aAlive && !bAlive) return null;

    var base, baseFm, other = null, otherFm = null;
    if (aAlive && !bAlive) { base = aPet; baseFm = a.fm || {}; }
    else if (bAlive && !aAlive) { base = bPet; baseFm = b.fm || {}; }
    else {
      var aSm = a.sm || 0, bSm = b.sm || 0, aWins;
      if (aSm !== bSm) aWins = aSm > bSm;
      else aWins = JSON.stringify(canonPetState(a)) < JSON.stringify(canonPetState(b));
      base = aWins ? aPet : bPet;       baseFm = (aWins ? a.fm : b.fm) || {};
      other = aWins ? bPet : aPet;      otherFm = (aWins ? b.fm : a.fm) || {};
      // Two DIFFERENT creatures: the base wins whole. (Their care
      // clocks, energy anchors and names used to be mixed into it.)
      if (other.id !== base.id) other = null;
    }

    var out = {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    var fm = { name: baseFm.name || 0, palette: baseFm.palette || 0 };

    if (other) {
      // Same creature on both sides — field-level reconciliation.
      TEMPORAL.forEach(function (k) {
        if (typeof other[k] === "number" && (typeof out[k] !== "number" || other[k] > out[k])) out[k] = other[k];
      });
      // Energy anchors: each pair travels as a unit, the newest of
      // each kind is kept, then normalizeAnchors picks the active one.
      if ((other.asleepSince || 0) > (out.asleepSince || 0)) {
        out.asleepSince = other.asleepSince;
        out.asleepE = other.asleepE || 0;
      }
      if ((other.wokeAt || 0) > (out.wokeAt || 0)) {
        out.wokeAt = other.wokeAt;
        out.awakeE = other.awakeE;
      }
      FIELDS_LWW.forEach(function (k) {
        var fo = otherFm[k] || 0;
        if (fo > fm[k] ||
            (fo === fm[k] && JSON.stringify(other[k]) > JSON.stringify(out[k]))) {
          out[k] = other[k];
          fm[k] = fo;
        }
      });
      // Everything else is immutable for one creature and identical
      // on both sides in practice. If it ever differs, the answer
      // must not depend on which side happened to be the base:
      // the earlier birth, otherwise the greater serialization.
      var handled = { id: 1, lastFed: 1, lastPetted: 1, wokeAt: 1, awakeE: 1,
                      asleepSince: 1, asleepE: 1, name: 1, palette: 1 };
      Object.keys(other).forEach(function (k) {
        if (handled[k] || other[k] === undefined) return;
        if (out[k] === undefined) { out[k] = other[k]; return; }
        if (k === "birthTs" && typeof out[k] === "number" && typeof other[k] === "number") {
          out[k] = Math.min(out[k], other[k]);
        } else if (JSON.stringify(other[k]) > JSON.stringify(out[k])) {
          out[k] = other[k];
        }
      });
    }

    return canonPetState({
      ver: DATA_VER,
      sm: Math.max(a.sm || 0, b.sm || 0),
      deleted: del,
      pet: out,
      fm: fm
    });
  }

  function sliceGet() {
    // Canonical clone (PT-3) — never the live object.
    return JSON.parse(JSON.stringify(canonPetState(state) || state));
  }

  function sliceSet(data) {
    if (!data || !data.pet) return;
    window.__orosPetSyncApi._suppress = true;
    try {
      state = data;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } finally {
      window.__orosPetSyncApi._suppress = false;
    }
    // LIVE REFRESH: a remote merge (rename / palette change /
    // feed from another device / new entity) reflects IMMEDIATELY
    // on this device while the pet is active — stats recomputed, HUD
    // redrawn, warn flags rearmed so low-stat thresholds re-fire.
    // While inactive, the next petEnable() reads the fresh state.
    // v0.3: identity swap (different pet.id after a remote New Pet)
    // ALSO resets the birthday dedupe key — the new friend gets its
    // own first-year clock and must not inherit the old one's flags.
    if (runtime && runtime.active) {
      if (runtime.lastPetId !== state.pet.id) {
        runtime.lastPetId = state.pet.id;
        runtime.birthdayShownYmd = "";
        runtime.birthdayFiredPetId = null;
      }
      runtime.hungerWarned = runtime.boredWarned = runtime.tiredWarned = false;
      runtime.statsAt = 0;
      refreshHUD(computeStats(Date.now(), state.pet));
    }
  }

  function registerSync() {
    // Pet runs IN the shell document — same window, not a parent iframe.
    var api = window.orosSync;
    window.__orosPetSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("pet", sliceGet, sliceSet, "oros-pet-data", mergePetStates);
    // v0.3.1: the event log is a SECOND synced slice — events
    // recorded on any device converge on every device (union by
    // event id, clearedAt wipe propagation). Same storage key the
    // calendar feed already reads: calendar.js needs no change.
    api.registerSlice("petEvents", eventsSliceGet, eventsSliceSet, EVENTS_KEY, mergeEventLogs);
    // v0.3.2: synced preferences (THIRD slice) — calendar feed
    // toggle travels; device-local ergonomics (enabled/minimized/
    // pos) stay device-local by design.
    api.registerSlice("petSettings", settingsSliceGet, settingsSliceSet, "oros-pet-settings", mergePetSettings);
  }
  
    // ---------- 5. Sprite engine ----------
  // 16×16 pixel-grid renderer (Soffitta transplant, cleaned).
  // v0.3: MOOD expressions as before (Part 3 mood()), PLUS a
  // transient FOOD overlay during eat mode (interpolated pixel
  // kibble descending toward the mouth) and slow-blink rendering
  // during contemplation.

  var PX = 6;            // pixel size in CSS px
  var SPR = 16;           // sprite grid 16×16
  var WALK_SPEED = 42;   // px/sec
  var FLOOR_MARGIN = 16;  // keep pet above layer bottom edge
  var EAT_MS = 2400;      // eat pose duration (set by feed())
  var BALL_R = 9;         // catch-ball radius (DOM px)
  var BALL_G = 900;       // catch-ball gravity (px/s²)
  var BALL_LIFE_MS = 4200;// catch-ball lifetime before fade-out

  // GRID_COLORS removed (unused — sprite uses inline colors)

  function createLayer() {
    var layer = document.createElement("div");
    layer.id = "pet-layer";
    document.body.appendChild(layer);
    runtime.layer = layer;

    var canvas = document.createElement("canvas");
    canvas.id = "pet-canvas";
    layer.appendChild(canvas);
    runtime.canvas = canvas;
    runtime.ctx = canvas.getContext("2d");

    var cw = SPR * PX;
    canvas.width = cw;
    canvas.height = cw;
    canvas.style.width = cw + "px";
    canvas.style.height = cw + "px";
    runtime.ctx.imageSmoothingEnabled = false;

    layer.appendChild(buildBubble());

    // Pet World walk: while the pet is away, this sign stands in for it.
    var away = document.createElement("button");
    away.type = "button";
    away.className = "pet-away";
    away.hidden = true;
    away.addEventListener("click", function () {
      if (typeof window.__orosOpenApp === "function") window.__orosOpenApp("petworld");
    });
    layer.appendChild(away);
    runtime.awayEl = away;
  }

  // ---------- Pet World walks (read-only) ----------
  // The forest app owns oros-petnest-data; the companion only reads
  // it (or, before the app ever ran here, sync's carry copy) to know
  // whether the pet is out on a walk, and until when.
  // rows{device:{w{startTs: minutes}}}: away while now < start + length.
  var NEST_KEY = "oros-petnest-data";
  function walkUntil(now) {
    var raw = null, until = 0;
    try {
      raw = JSON.parse(localStorage.getItem(NEST_KEY) || "null");
      // a device that never opened Pet World holds the slice in sync's carry mailbox
      if (!raw) raw = (JSON.parse(localStorage.getItem("oros-remote-carry") || "null") || {}).petnest || null;
    } catch (e) { return 0; }
    if (!raw || typeof raw !== "object" || !raw.rows || typeof raw.rows !== "object") return 0;
    Object.keys(raw.rows).forEach(function (dev) {
      var w = raw.rows[dev] && raw.rows[dev].w;
      if (!w || typeof w !== "object") return;
      Object.keys(w).forEach(function (k) {
        var end = Number(k) + Number(w[k]) * 60000;
        if (isFinite(end) && end > now && end > until) until = end;
      });
    });
    return Math.min(until, now + 24 * 3600000);   // a broken clock never hides the pet for days
  }
  // The accessory Pet World put on the pet (oros-petprogress-data,
  // read only; the carry copy before the app ever ran here). The app
  // only lets the pet wear what it owns.
  var PROGRESS_KEY = "oros-petprogress-data";
  function wornAccessory() {
    var raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "null");
      if (!raw) raw = (JSON.parse(localStorage.getItem("oros-remote-carry") || "null") || {}).petprogress || null;
    } catch (e) { return ""; }
    var w = raw && typeof raw === "object" ? raw.wear : null;
    return w && typeof w.id === "string" && ACCESSORIES[w.id] === 1 ? w.id : "";
  }
  function updateAway(now) {
    if (now - runtime.awayCheckAt < 2000) return;
    runtime.awayCheckAt = now;
    runtime.acc = wornAccessory();
    var until = walkUntil(now), was = runtime.awayUntil > 0;
    runtime.awayUntil = until;
    if (!runtime.canvas || !runtime.awayEl) return;
    runtime.canvas.style.visibility = until ? "hidden" : "";
    runtime.awayEl.hidden = !until;
    if (until) {
      var d = new Date(until), hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
      runtime.awayEl.textContent = "\uD83C\uDF92 " + t("away.label", { time: hm });
      runtime.awayEl.title = t("away.title", { name: state.pet.name });
      var maxL = Math.max(4, runtime.layer.clientWidth - runtime.awayEl.offsetWidth - 8);
      runtime.awayEl.style.left = Math.round(clamp(runtime.x, 4, maxL)) + "px";
      runtime.awayEl.style.top = Math.round(stageBounds().floorY + runtime.canvas.height - 34) + "px";
      clearTimeout(runtime.bubbleTimer);
      if (runtime.bubble) runtime.bubble.classList.remove("visible");
    } else if (was) {
      speak(speakLine("speech.back"));
    }
  }

  // ---------- 6. Behavior loop (runtime, never synced) ----------
  // runtime = per-device choreography: position, facing, frame,
  // walk decisions, bubble state, warn flags, ball, contemplation.
  // v0.3 additions: lastInteractionTs (contemplation clock),
  // contemplating, catchCooldownUntil, ball, birthday dedupe keys,
  // lastPetId (identity-swap guard from sliceSet, Part 3).
  runtime = {
    layer: null, canvas: null, ctx: null,
    bubble: null, bubbleTimer: null, rafId: 0,
    x: 0, y: 0, dir: 1,
    mode: "idle",           // idle | walk | happy | eat | drag
    frame: 0, walkTimer: 0, targetX: null,
    dragging: false, dragOffX: 0,
    stats: null, statsAt: 0,
    hungerWarned: false, boredWarned: false, tiredWarned: false,
    hungerTalkedAt: 0,        // hungry speech throttle
    lastTs: 0, active: false,
    // v0.2:
    lastCelebratedAt: 0,      // sync-hop throttle
    // v0.3:
    eatStartTs: 0,            // food-overlay interpolation clock
    lastInteractionTs: 0,     // contemplation clock
    contemplating: false,
    contemplateTalkedAt: 0,   // rare contemplation speech throttle
    catchCooldownUntil: 0,    // catch mini-game cooldown
    ball: null,               // { el, x, y, vy, bornAt, settled }
    lastPetId: "",            // identity-swap guard (sliceSet)
    birthdayShownYmd: "",     // birthday toast dedupe (1x/day)
    birthdayFiredPetId: null,
    // Pet World walk (read from oros-petnest-data, never written):
    awayEl: null, awayUntil: 0, awayCheckAt: 0,
    acc: ""                 // Pet World accessory worn (read every 2 s with the walk)
  };

  // PT-6: stageBounds() runs several times per animation frame. It
  // called getComputedStyle() every time (a forced style pass, 3+
  // per frame, 60 frames a second, for as long as the pet is on).
  // The lift is a CSS variable that changes rarely: read it at most
  // once a second.
  var floorLift = 0, floorLiftAt = 0;
  function stageBounds() {
    var w = runtime.layer ? runtime.layer.clientWidth : window.innerWidth;
    var h = runtime.layer ? runtime.layer.clientHeight : window.innerHeight;
    var nowB = Date.now();
    if (runtime.layer && nowB - floorLiftAt > 1000) {
      floorLiftAt = nowB;
      floorLift = parseFloat(getComputedStyle(runtime.layer).getPropertyValue("--pet-floor-lift")) || 0;
    }
    return {
      w: w - runtime.canvas.width,
      h: h,
      floorY: h - runtime.canvas.height - FLOOR_MARGIN - floorLift
    };
  }

  function refreshStatsIfStale(now) {
    if (now - runtime.statsAt < 1000 && runtime.stats) return runtime.stats;
    runtime.stats = computeStats(now, state.pet);
    runtime.statsAt = now;
    return runtime.stats;
  }

  // v0.3: INTERACTION PULSE — every human touch (canvas pointer,
  // HUD button, ball click) routes through here. Resets the
  // contemplation clock AND exits contemplation instantly.
  function touchInteraction() {
    runtime.lastInteractionTs = Date.now();
    runtime.contemplating = false;
  }

  // ENERGY-SCALED WANDERING (v0.2, unchanged)
  function walkParameters(stats) {
    var energy = stats.energy;
    var food = stats.food;

    var idleMin = 1500, idleMax = 3500;
    if (energy < 30) {
      idleMin = 3000; idleMax = 7000;
    } else if (energy < 60) {
      idleMin = 2200; idleMax = 5000;
    }

    var targetRange = 1.0;
    if (energy < 30) targetRange = 0.3;
    else if (energy < 50) targetRange = 0.6;

    var stepDelay = idleMin + Math.random() * (idleMax - idleMin);

    return { stepDelay: stepDelay, targetRange: targetRange };
  }

  // v0.3: BIRTHDAY CHECK — fired from the behavior loop (cheap:
  // one string compare per second thanks to the stats throttle).
  // Dedupe: once per LOCAL day per pet id. Fires unified notification
  // (emit, with dedup key), hearts, happy pose, and a birthday log event.
  function checkBirthday(now, stats) {
    if (!isBirthdayToday(now)) return;
    var today = todayYMD();
    if (runtime.birthdayShownYmd === today &&
        runtime.birthdayFiredPetId === state.pet.id) return;
    runtime.birthdayShownYmd = today;
    runtime.birthdayFiredPetId = state.pet.id;

    var years = birthdayYears(now);
    var msgTitle = t("event.type.birthday");
    var msgBodyKey = years === 0 ? "notif.bday.first" : "notif.bday.years";
    var msgBody = t(msgBodyKey, { name: state.pet.name || "?", years: years });

    // Unified notification (orOS toast + inbox). Guarded so absent
    // orosNotifs is harmless; key ensures 1x/day per pet id.
    var notifKey = "pet-bday:" + state.pet.id + ":" + today;
    try {
      var api = window.orosNotifs;
      if (api && typeof api.emit === "function") {
        api.emit({ ns: "pet", key: notifKey, type: "reminder", title: msgTitle, body: msgBody });
      }
    } catch (e) {}
    if (!stats.asleep) {
      runtime.mode = "happy";
      runtime.walkTimer = 2200;
      runtime.targetX = null;
    }
    speak(speakLine("speech.happy"));
    spawnHearts();
    // Deterministic id: two devices logging the same anniversary
    // collapse to ONE row in the log + calendar feed at merge time.
    logEvent(PET_EVENT_TYPES.BIRTHDAY, "bday-" + state.pet.id + ":" + today);
  }

  // v0.3: CATCH MINI-GAME — a small ball drops near the pet.
  // Click/tap it before it settles+expires → catch reward
  // (+happy via lastPetted, +2 energy via fresh awake anchors,
  // happy pose, catch speech, log event). Gravity + light bounce,
  // auto-removes on expiry. HUD button gates entry (cooldown 5 min,
  // pet must be awake and active).
  function spawnBall() {
    if (runtime.ball || !runtime.active) return;
    var b = stageBounds();
    var startX = clamp(runtime.x + (Math.random() - 0.5) * 120 + 20, 10, Math.max(10, b.w - 10));
    var el = document.createElement("div");
    el.style.cssText =
      "position:absolute;width:" + (BALL_R * 2) + "px;height:" + (BALL_R * 2) + "px;" +
      "border-radius:50%;background:radial-gradient(circle at 35% 35%, #ffe0b2, #e8896c);" +
      "box-shadow:0 2px 6px rgba(0,0,0,.35);cursor:pointer;z-index:5;touch-action:none;";
    runtime.layer.appendChild(el);
    runtime.ball = {
      el: el, x: startX, y: -BALL_R * 2, vy: 60,
      bornAt: Date.now(), settled: false
    };
    el.addEventListener("pointerdown", function (e) {
      e.stopPropagation();
      e.preventDefault();
      catchBall();
    });
  }

  function updateBall(dt, now, floorY) {
    var ball = runtime.ball;
    if (!ball) return;
    if (!ball.settled) {
      ball.vy += BALL_G * dt;
      ball.y += ball.vy * dt;
      if (ball.y >= floorY + runtime.canvas.height - BALL_R) {
        ball.y = floorY + runtime.canvas.height - BALL_R;
        if (ball.vy > 140) { ball.vy = -ball.vy * 0.35; }  // light bounce
        else { ball.vy = 0; ball.settled = true; }
      }
    }
    // fade out in the last 700ms of life
    var age = now - ball.bornAt;
    ball.el.style.opacity = age > BALL_LIFE_MS - 700
      ? String(Math.max(0, (BALL_LIFE_MS - age) / 700)) : "1";
    ball.el.style.transform =
      "translate(" + ball.x + "px," + ball.y + "px)";
    if (age >= BALL_LIFE_MS) destroyBall(false);
  }

  function destroyBall(caught) {
    var ball = runtime.ball;
    if (!ball) return;
    ball.el.remove();
    runtime.ball = null;
    if (caught) runtime.catchCooldownUntil = Date.now() + CATCH_COOLDOWN_MS;
  }

  function catchBall() {
    if (!runtime.ball || !runtime.active) return;
    touchInteraction();
    var stats = computeStats(Date.now(), state.pet);
    // Reward: happy reset (lastPetted = now) + +2 energy via a
    // FRESH anchor pair (wokeAt=now, awakeE=current+2) — pure
    // derived math, deterministic, no drift, no stored stats.
    writePet(function (p, now) {
      p.lastPetted = now;
      if (!stats.asleep) {
        p.wokeAt = now;
        p.awakeE = clamp(stats.energy + 2, 0, 100);
      }
    });
    destroyBall(true);
    runtime.mode = "happy";
    runtime.walkTimer = 2200;
    runtime.targetX = null;
    speak(speakLine("speech.catch"));
    spawnHearts();
    logEvent(PET_EVENT_TYPES.CATCH);
    refreshHUD(computeStats(Date.now(), state.pet));
  }

  function updateBehavior(dt, now) {
    var stats = refreshStatsIfStale(now);
    runtime.frame++;

    // v0.3: birthday wiring (1x/day per pet id — see checkBirthday)
    checkBirthday(now, stats);

    var sleeping = stats.asleep;

    if (runtime.mode === "eat" || runtime.mode === "happy") {
      runtime.walkTimer -= dt * 1000;
      if (runtime.walkTimer <= 0) runtime.mode = sleeping ? "idle" : "walk";
    } else if (runtime.mode === "drag") {
      // position controlled by pointer; no movement decisions
    } else if (sleeping) {
      runtime.mode = "idle";
      runtime.contemplating = false;
    } else {
      // v0.3: CONTEMPLATION — 5 min without interaction freezes
      // choreography (no wander decisions, slow blink). NOT a mood:
      // the face keeps its honest expression. Broken instantly by
      // touchInteraction() from any input path.
      if (!runtime.contemplating &&
          now - runtime.lastInteractionTs > CONTEMPLATION_IDLE_MS &&
          runtime.lastInteractionTs > 0) {
        runtime.contemplating = true;
        runtime.mode = "idle";
        runtime.targetX = null;
      }
      if (runtime.contemplating) {
        // rare contemplation murmur (~every 90s), never forced
        if (now - runtime.contemplateTalkedAt > 90000 &&
            Math.random() < 0.02) {
          runtime.contemplateTalkedAt = now;
          speak(speakLine("speech.contemp"));
        }
      } else if (runtime.mode === "walk") {
        if (runtime.targetX !== null) {
          var dx = runtime.targetX - runtime.x;
          if (Math.abs(dx) < 6) {
            runtime.targetX = null;
            runtime.mode = "idle";
            var p = walkParameters(stats);
            runtime.walkTimer = p.stepDelay;
          } else {
            runtime.dir = dx > 0 ? 1 : -1;
            runtime.x += clamp(dx, -WALK_SPEED * dt, WALK_SPEED * dt);
          }
        } else {
          runtime.walkTimer -= dt * 1000;
          if (runtime.walkTimer <= 0) {
            var r = Math.random();
            var p = walkParameters(stats);
            if (r < 0.35) {
              runtime.mode = "idle";
              runtime.walkTimer = p.stepDelay;
            } else if (r < 0.5) {
              runtime.dir *= -1;
              runtime.walkTimer = 1200 + Math.random() * 2500;
            } else {
              runtime.mode = "walk";
              var b = stageBounds();
              runtime.targetX = runtime.x + ((Math.random() - 0.5) * 2) * (b.w * p.targetRange);
              runtime.targetX = clamp(runtime.targetX, 0, b.w);
              runtime.walkTimer = 3000;
            }
          }
          runtime.x += runtime.dir * WALK_SPEED * dt;
        }
      } else { // idle
        runtime.walkTimer -= dt * 1000;
        if (runtime.walkTimer <= 0) {
          runtime.mode = "walk";
          var b = stageBounds();
          runtime.targetX = Math.random() * b.w;
          runtime.walkTimer = 3000;
        }
      }
    }

    // Stage limits (FIX-D1: y follows the pointer while dragging)
    var b = stageBounds();
    if (runtime.x < 0) { runtime.x = 0; runtime.dir = 1; runtime.targetX = null; }
    if (runtime.x > b.w) { runtime.x = b.w; runtime.dir = -1; runtime.targetX = null; }
    if (runtime.mode !== "drag") runtime.y = b.floorY;

    // Threshold speech (flags are runtime, not synced)
    if (!speechAllowed()) return;

    if (stats.food < 25 && !runtime.hungerWarned) {
      runtime.hungerWarned = true;
      if (now - runtime.hungerTalkedAt >= HUNGER_TALK_MS) {
        speak(speakLine("speech.hungry"));
        runtime.hungerTalkedAt = now;
      }
    }
    if (stats.food >= 35) {
      runtime.hungerWarned = false;
      runtime.hungerTalkedAt = 0;
    }

    if (!stats.asleep && !runtime.contemplating) {
      if (stats.happy < 25 && !runtime.boredWarned) { runtime.boredWarned = true; speak(speakLine("speech.bored")); }
      if (stats.happy >= 35) runtime.boredWarned = false;
      if (stats.energy < 20 && !runtime.tiredWarned) { runtime.tiredWarned = true; speak(speakLine("speech.tired")); }
      if (stats.energy >= 35) runtime.tiredWarned = false;
    }
  }

  // ---------- Sprite drawing ----------

  // The pixel art itself, as data: a 16×16 grid of colour codes
  // (0 empty, 1 body, 2 belly, 3 eye/dark, 4 food-kibble) for one
  // pose. Shared with the Pet World app (orosPet.sprite) so the
  // companion and the forest draw the very same creature.
  //   pose = { mood, mode, legPhase, dir, frame, eatT, contemplating }
  //   mood ∈ sleep|tired|happy|neutral; mode ∈ idle|walk|happy|eat;
  //   eatT = 0→1 progress of the falling kibble (eat mode), else -1.
  function spriteGrid(pose) {
    var m = pose.mood;
    var sleeping = m === "sleep";
    var frame = pose.frame | 0;
    var grid = [];
    for (var j = 0; j < SPR; j++) {
      var row = [];
      for (var i = 0; i < SPR; i++) row.push(0);
      grid.push(row);
    }
    function rect(x0, y0, x1, y1, v) {
      for (var yy = y0; yy <= y1; yy++)
        for (var xx = x0; xx <= x1; xx++)
          if (yy >= 0 && yy < SPR && xx >= 0 && xx < SPR) grid[yy][xx] = v;
    }

    // Body (rounded silhouette from the original)
    rect(4, 2, 12, 4, 1);
    rect(2, 4, 13, 12, 1);
    rect(3, 12, 12, 13, 1);
    rect(4, 14, 6, 15, 1);
    rect(9, 14, 11, 15, 1);
    // Ears
    rect(3, 0, 4, 2, 1);
    rect(11, 0, 12, 2, 1);
    // Belly
    rect(4, 8, 11, 12, 2);
    // Tail
    rect(13, 10, 15, 11, 1);

    if (pose.legPhase === 1) {
      rect(4, 14, 6, 15, 0);
      rect(4, 13, 6, 13, 1);
    }

    // MOOD-DRIVEN EXPRESSIONS
    if (m === "sleep") {
      rect(5, 6, 6, 6, 3);
      rect(9, 6, 10, 6, 3);
    } else if (m === "tired") {
      rect(5, 6, 6, 6, 3);
      rect(9, 6, 10, 6, 3);
    } else if (m === "happy") {
      rect(5, 5, 6, 7, 3);
      rect(9, 5, 10, 7, 3);
      rect(5, 6, 6, 6, 2);
      rect(9, 6, 10, 6, 2);
    } else { // neutral
      rect(5, 5, 6, 7, 3);
      rect(9, 5, 10, 7, 3);
      if (pose.dir === 1) {
        grid[5][6] = 2; grid[5][10] = 2;
      } else {
        grid[5][5] = 2; grid[5][9] = 2;
      }
    }

    // Mouth — varies by mood
    if (pose.mode === "eat") {
      rect(7, 10, 8, 11, 3);
    } else if (m === "happy") {
      rect(7, 9, 8, 10, 3);
    } else if (m === "tired") {
      rect(7, 11, 8, 11, 3);
    } else if (!sleeping) {
      rect(7, 10, 8, 10, 3);
    }

    // v0.3: FOOD ANIMATION — during eat mode a 2x2 kibble pixel
    // descends from above the head toward the mouth during the
    // first 900ms of the pose, then disappears (munched).
    if (pose.mode === "eat" && pose.eatT >= 0 && pose.eatT <= 1) {
      var fy = Math.round(pose.eatT * 10);               // y=0 (above head) → y=10 (mouth)
      rect(7, clamp(fy, 0, 9), 8, clamp(fy + 1, 1, 10), 4);
    }

    // v0.3: CONTEMPLATION SLOW BLINK — neutral/tired face closes
    // smoothly every ~6s while contemplating (visually distinct
    // from sleeping: pet sits upright, walks paused, eyes blink).
    if (pose.contemplating && !sleeping) {
      if (frame % 360 < 24) {
        rect(5, 6, 6, 6, 3);
        rect(9, 6, 10, 6, 3);
      }
    }

    // Pet World accessory (phase 5): drawn over the body, under the Zzz
    if (pose.acc) dressSprite(rect, grid, pose.acc);

    // Zzz above head when asleep
    if (sleeping) {
      rect(13, 2, 13, 2, 3);
      rect(14, 0, 14, 1, 3);
      rect(15, 0, 15, 0, 3);
    }
    return grid;
  }

  // Pet World accessories (bought in the forest bazaar). Colours 5…9
  // are the same for every palette: 5 dark, 6 pink, 7 red, 8 yellow,
  // 9 leaf green. The head never moves in the grid, so one drawing
  // fits every pose (the flip for direction mirrors it with the pet).
  var ACCESSORIES = { bow: 1, scarf: 1, hat: 1, glasses: 1, crown: 1, bell: 1 };
  function dressSprite(rect, grid, acc) {
    if (acc === "bow") {
      rect(5, 1, 6, 3, 6); rect(9, 1, 10, 3, 6); rect(7, 2, 8, 2, 7);
    } else if (acc === "hat") {
      rect(6, 0, 9, 1, 5); rect(6, 2, 9, 2, 7); rect(4, 3, 11, 3, 5);
    } else if (acc === "glasses") {
      rect(4, 4, 11, 4, 5); rect(4, 5, 4, 6, 5); rect(11, 5, 11, 6, 5); rect(7, 5, 8, 5, 5);
    } else if (acc === "crown") {
      rect(4, 2, 11, 2, 9);
      grid[1][5] = 8; grid[1][8] = 6; grid[1][10] = 8; grid[2][6] = 8; grid[2][9] = 6;
    } else if (acc === "scarf") {
      rect(3, 12, 12, 12, 7); rect(4, 13, 5, 13, 7);
      grid[12][5] = 8; grid[12][8] = 8; grid[12][11] = 8; grid[13][5] = 8;
    } else if (acc === "bell") {
      rect(3, 12, 12, 12, 6); rect(7, 13, 8, 13, 8);
    }
  }

  function spriteColors(paletteIdx) {
    var pal = PALETTES[clamp(paletteIdx | 0, 0, PALETTES.length - 1)];
    return { 1: pal.body, 2: pal.belly, 3: pal.eye, 4: "#c96f4a",
             5: "#2f2a44", 6: "#e0457b", 7: "#d64545", 8: "#ffd23f", 9: "#5aa05c" };
  }

  function drawSprite(stats) {
    var cw = SPR * PX;
    var ctx = runtime.ctx;
    ctx.clearRect(0, 0, cw, cw);

    var sleeping = stats && stats.asleep;

    // Vertical bobbing per mode
    var bob = 0;
    var legPhase = 0;
    if (sleeping) {
      bob = 2;
    } else if (runtime.mode === "walk") {
      legPhase = Math.floor(runtime.frame / 6) % 2;
      bob = legPhase;
    } else if (runtime.mode === "happy") {
      bob = (Math.floor(runtime.frame / 4) % 2) === 0 ? -2 : 0;
    } else if (runtime.mode === "eat") {
      bob = (Math.floor(runtime.frame / 5) % 2) === 0 ? 1 : 0;
    }

    var grid = spriteGrid({
      mood: mood(stats),
      mode: runtime.mode,
      legPhase: legPhase,
      dir: runtime.dir,
      frame: runtime.frame,
      eatT: (runtime.mode === "eat" && runtime.eatStartTs) ? (Date.now() - runtime.eatStartTs) / 900 : -1,
      contemplating: runtime.contemplating,
      acc: runtime.acc
    });

    // Render with direction flip
    ctx.save();
    ctx.translate(cw / 2, cw / 2 + bob * PX * 0.4);
    ctx.scale(runtime.dir === 1 ? 1 : -1, 1);
    ctx.translate(-cw / 2, -cw / 2);
    var colors = spriteColors(state.pet.palette);
    for (var yy = 0; yy < SPR; yy++) {
      for (var xx = 0; xx < SPR; xx++) {
        var v = grid[yy][xx];
        if (!v) continue;
        ctx.fillStyle = colors[v];
        ctx.fillRect(xx * PX, yy * PX, PX, PX);
      }
    }
    ctx.restore();
  }

  // ---------- Speech bubble + hearts (clamped, leak-free) ----------

  function buildBubble() {
    var bubble = document.createElement("div");
    bubble.className = "pet-bubble";
    runtime.layer.appendChild(bubble);
    return bubble;
  }

  function speechAllowed() {
    return runtime.active && document.visibilityState === "visible";
  }

  function speak(text) {
    if (!runtime.bubble || !speechAllowed() || runtime.awayUntil) return;   // nobody home on a walk
    runtime.bubble.textContent = text;

    var b = stageBounds();
    var bx = clamp(runtime.x + 24, 4, Math.max(4, b.h && (runtime.layer.clientWidth - 160)));
    var by = Math.max(4, runtime.y - 46);
    runtime.bubble.style.left = bx + "px";
    runtime.bubble.style.top = by + "px";
    runtime.bubble.classList.add("visible");

    clearTimeout(runtime.bubbleTimer);
    runtime.bubbleTimer = setTimeout(function () {
      runtime.bubble.classList.remove("visible");
    }, 2600);
  }

  function spawnHearts() {
    if (!runtime.active || !runtime.layer) return;   // a care action from Pet World with the companion off
    for (var i = 0; i < 3; i++) {
      setTimeout(function () {
        if (!runtime.layer) return;
        var h = document.createElement("div");
        h.className = "pet-heart";
        h.textContent = "❤️";
        h.style.left = (runtime.x + 16 + Math.random() * 30 - 8) + "px";
        h.style.top = (runtime.y - 10) + "px";
        runtime.layer.appendChild(h);
        setTimeout(function () { h.remove(); }, 1150);
      }, i * 180);
    }
  }

  // ---------- Main loop ----------

  function loop(ts) {
    if (!runtime.active) return;                    // stopped → loop dies
    var dt = Math.min(0.05, (ts - runtime.lastTs) / 1000 || 0.016);
    runtime.lastTs = ts;

    var now = Date.now();
    var b = stageBounds();
    updateBehavior(dt, now);
    updateAway(now);
    updateBall(dt, now, b.floorY);                  // v0.3: ball physics
    drawSprite(runtime.stats);

    runtime.canvas.style.transform =
      "translate(" + runtime.x + "px, " + runtime.y + "px)";

    // HUD refresh piggybacks the 1s stats throttle
    if (runtime.statsAt === now) refreshHUD(runtime.stats);

    if (runtime.active) runtime.rafId = requestAnimationFrame(loop);
  }
  
    // ---------- 7. Interactions + HUD ----------

  var hud = null;

  // v0.3: INVISIBLE PENCIL SVG (inline, inherits currentColor)
  var PENCIL_SVG =
    '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" ' +
    'style="vertical-align:-1px;opacity:.55;">' +
    '<path d="M11.5 1.5l3 3L5 14H2v-3zM10 4l2 2" fill="none" stroke="currentColor" ' +
    'stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg>';

  function buildHUD() {
    hud = document.createElement("div");
    hud.id = "pet-hud";
    // Name row: label + pencil (both open rename; dblclick kept for
    // muscle memory). Age line, palette swatches, catch button.
    // All v0.3 elements carry INLINE styles — pet.css untouched.
    hud.innerHTML =
      '<div class="pet-hud-name-row" style="display:flex;align-items:center;' +
        'justify-content:center;gap:5px;">' +
        '<button type="button" id="pet-minimize-btn" title="' +
          (LANG === "el" ? "Ελαχιστοποίηση" : "Minimize") + '" ' +
          'style="border:none;background:transparent;color:inherit;padding:2px;' +
          'cursor:pointer;line-height:0;font-size:14px;">◀</button>' +
        '<span class="pet-hud-name" id="pet-hud-name"></span>' +
        '<button type="button" id="pet-pencil-btn" title="' +
          (LANG === "el" ? "Μετονομασία" : "Rename") + '" ' +
          'style="border:none;background:transparent;color:inherit;padding:2px;' +
          'cursor:pointer;line-height:0;">' + PENCIL_SVG + '</button>' +
      '</div>' +
      '<div id="pet-hud-age" style="font-size:10.5px;color:var(--text-dim);text-align:center;margin:-3px 0 6px;"></div>' +
      '<div id="pet-palettes" style="display:flex;gap:6px;justify-content:center;margin:0 0 8px;"></div>' +
      '<div class="pet-stat" id="pet-stat-food">' +
        '<span class="pet-stat-ico">🍖</span>' +
        '<span class="pet-stat-track"><span class="pet-stat-fill" id="pet-fill-food"></span></span>' +
      '</div>' +
      '<div class="pet-stat" id="pet-stat-happy">' +
        '<span class="pet-stat-ico">💛</span>' +
        '<span class="pet-stat-track"><span class="pet-stat-fill" id="pet-fill-happy"></span></span>' +
      '</div>' +
      '<div class="pet-stat" id="pet-stat-energy">' +
        '<span class="pet-stat-ico">⚡</span>' +
        '<span class="pet-stat-track"><span class="pet-stat-fill" id="pet-fill-energy"></span></span>' +
      '</div>' +
      '<div class="pet-hud-actions">' +
        '<button type="button" id="pet-feed-btn"></button>' +
        '<button type="button" id="pet-catch-btn"></button>' +
        '<button type="button" id="pet-log-btn"></button>' +
      '</div>' +
      '<div class="pet-hud-actions">' +
        '<button type="button" id="pet-sleep-btn"></button>' +
        '<button type="button" id="pet-forest-btn"></button>' +
        '<button type="button" id="pet-new-btn"></button>' +
      '</div>';
    runtime.layer.appendChild(hud);

    $("pet-feed-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      touchInteraction();
      feed();
    });
    $("pet-catch-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      touchInteraction();
      tryCatch();
    });
    $("pet-log-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      touchInteraction();
      openEventLog();
    });
    $("pet-sleep-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      touchInteraction();
      toggleSleep();
    });
    // Pet World: the same pet, in its own app (menu category Fun).
    $("pet-forest-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      touchInteraction();
      if (typeof window.__orosOpenApp === "function") window.__orosOpenApp("petworld");
    });
    $("pet-new-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      touchInteraction();
      confirmNewPet();
    });
    hud.addEventListener("pointerdown", function (e) { e.stopPropagation(); });

    // Minimize toggle (left of name) — collapses stats & actions, shows only name
    var minBtn = $("pet-minimize-btn");
    minBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      touchInteraction();
      toggleMinimize();
    });
    minBtn.addEventListener("pointerdown", function (e) { e.stopPropagation(); });

    // Rename entry points: pencil (single click) + dblclick (kept)
    var nameEl = $("pet-hud-name");
    nameEl.title = LANG === "el" ? "Διπλό κλικ για μετονομασία" : "Double-click to rename";
    nameEl.addEventListener("dblclick", function (e) {
      e.stopPropagation();
      touchInteraction();
      startRename();
    });
    $("pet-pencil-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      touchInteraction();
      startRename();
    });
    $("pet-pencil-btn").addEventListener("pointerdown", function (e) { e.stopPropagation(); });
  }

  // PALETTE PICKER — 5 swatches, active ring follows synced choice
  function buildPaletteRow() {
    var row = $("pet-palettes");
    if (!row) return;
    row.innerHTML = "";
    PALETTES.forEach(function (p, i) {
      var s = document.createElement("button");
      s.type = "button";
      s.title = palName(i);
      s.style.cssText =
        "width:18px;height:18px;border-radius:50%;cursor:pointer;" +
        "border:2px solid rgba(255,255,255,.15);padding:0;" +
        "background:" + p.body + ";box-sizing:border-box;";
      s.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      s.addEventListener("click", function (e) {
        e.stopPropagation();
        touchInteraction();
        setPalette(i);
      });
      row.appendChild(s);
    });
  }

  function setPalette(i) {
    i = clamp(i | 0, 0, PALETTES.length - 1);
    if (i === clamp(state.pet.palette | 0, 0, PALETTES.length - 1)) return;
    writePet(function (p, now) {
      p.palette = i;
      state.fm.palette = now;
    });
    refreshHUD(computeStats(Date.now(), state.pet));
  }

  // RENAME — inline input swaps into the name slot (pencil or dblclick)
  function startRename() {
    if (!hud || !state.pet) return;
    var host = $("pet-hud-name");
    if (!host || host.getAttribute("data-editing")) return;
    host.setAttribute("data-editing", "1");
    host.textContent = "";

    var input = document.createElement("input");
    input.type = "text";
    input.value = state.pet.name;
    input.maxLength = MAX_NAME_LEN;
    input.placeholder = LANG === "el" ? "Όνομα…" : "Name…";
    input.style.cssText =
      "width:130px;background:transparent;border:none;" +
      "border-bottom:1px solid var(--border);color:var(--text);" +
      "font:inherit;text-align:center;outline:none;";
    host.appendChild(input);
    input.focus();
    input.select();

    var closed = false;
    function done(save) {
      if (closed) return;
      closed = true;
      host.removeAttribute("data-editing");
      if (save) renamePet(input.value);
      host.textContent = state.pet.name;
    }
    input.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter") done(true);
      else if (e.key === "Escape") done(false);
    });
    input.addEventListener("blur", function () { done(false); });
    input.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    input.addEventListener("click", function (e) { e.stopPropagation(); });
  }

  function renamePet(raw) {
    var name = String(raw || "").trim().slice(0, MAX_NAME_LEN);
    if (!name || name === state.pet.name) return;
    writePet(function (p, now) {
      p.name = name;
      state.fm.name = now;
    });
    refreshHUD(computeStats(Date.now(), state.pet));
  }

  // COLLAPSED STATE — device-local memory
  function isMinimized() {
    return settingsSliceGet().minimized === true;
  }
  function setMinimized(on) {
    on = !!on;
    var cur = settingsSliceGet();
    cur.minimized = on;
    cur.minimizedTs = Date.now();
    settingsSliceSet(cur);
    if (window.__orosPetSyncApi) window.__orosPetSyncApi.dirty();
  }
  function toggleMinimize() {
    var nowMin = !isMinimized();
    setMinimized(nowMin);
    refreshHUD(computeStats(Date.now(), state.pet));
  }

  function refreshHUD(stats) {
    if (!hud || !stats || !state.pet) return;
    // PT-4: follow a language switch made in the shell.
    var langNow = currentLang();
    if (langNow !== LANG) {
      LANG = langNow;
      var nm = $("pet-hud-name"), pc = $("pet-pencil-btn");
      if (nm) nm.title = LANG === "el" ? "Διπλό κλικ για μετονομασία" : "Double-click to rename";
      if (pc) pc.title = LANG === "el" ? "Μετονομασία" : "Rename";
      buildPaletteRow();
    }
    if (!$("pet-hud-name").getAttribute("data-editing")) {
      $("pet-hud-name").textContent = state.pet.name;
    }

    // Apply collapsed/expanded layout
    var collapsed = isMinimized();
    hud.classList.toggle("pet-hud-collapsed", collapsed);
    $("pet-minimize-btn").textContent = collapsed ? "▶" : "◀";
    $("pet-minimize-btn").title = collapsed
      ? (LANG === "el" ? "Ανάπτυξη" : "Expand")
      : (LANG === "el" ? "Ελαχιστοποίηση" : "Minimize");

    // Show/hide dependent sections based on collapsed state
    $("pet-hud-age").style.display = collapsed ? "none" : "block";
    $("pet-palettes").style.display = collapsed ? "none" : "flex";
    $("pet-stat-food").style.display = collapsed ? "none" : "flex";
    $("pet-stat-happy").style.display = collapsed ? "none" : "flex";
    $("pet-stat-energy").style.display = collapsed ? "none" : "flex";

    var d = ageDays(Date.now());
    $("pet-hud-age").textContent =
      t(d === 1 ? "hud.age.one" : "hud.age.many", { n: d });

    var cur = clamp(state.pet.palette | 0, 0, PALETTES.length - 1);
    var row = $("pet-palettes");
    if (row) {
      Array.prototype.forEach.call(row.children, function (s, i) {
        s.style.borderColor = (i === cur)
          ? "var(--accent, #c8a96e)"
          : "rgba(255,255,255,.15)";
      });
    }

    $("pet-fill-food").style.width = stats.food + "%";
    $("pet-fill-happy").style.width = stats.happy + "%";
    $("pet-fill-energy").style.width = stats.energy + "%";
    $("pet-stat-food").classList.toggle("low", stats.food < 30);
    $("pet-stat-happy").classList.toggle("low", stats.happy < 30);
    $("pet-stat-energy").classList.toggle("low", stats.energy < 30);
    $("pet-feed-btn").textContent = t("action.feed");
    $("pet-sleep-btn").textContent = stats.asleep ? t("action.wake") : t("action.sleep");
    $("pet-new-btn").textContent = t("action.newpet");
    var fb = $("pet-forest-btn");
    if (fb) fb.textContent = t("action.forest");

    // Catch button: hides while on cooldown (cleaner than a dead
    // button — the layer is precious screen real estate)
    var cb = $("pet-catch-btn");
    if (cb) {
      var cooling = Date.now() < runtime.catchCooldownUntil;
      cb.style.display = (stats.asleep || cooling) ? "none" : "";
      cb.textContent = t("action.catch");
    }
    var lb = $("pet-log-btn");
    if (lb) lb.textContent = t("action.viewlog");
  }

  // ---------- Care actions ----------

  // Pet World foods (petworld/ app, phase 2). Kibble is the HUD's
  // endless food; garden foods add a little more on top of a full
  // tummy. Effects only move the existing clocks FORWARD (lastPetted,
  // the awake anchor), so the merge rules stay exactly as they are.
  var FOODS = {
    kibble:     { happy: 0,  energy: 0 },
    carrot:     { happy: 0,  energy: 10 },
    strawberry: { happy: 25, energy: 0 },
    mushroom:   { happy: 10, energy: 10 },
    apple:      { happy: 10, energy: 20 }
  };
  var FAV_BONUS = 25;
  // Every pet has one favourite garden food, fixed by its id.
  function favouriteFood(id) {
    var h = 0, str = String(id || "");
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    var list = ["carrot", "strawberry", "mushroom", "apple"];
    return list[Math.abs(h) % list.length];
  }

  function feed(kind) {
    kind = FOODS[kind] ? kind : "kibble";
    var fx = FOODS[kind];
    var fav = kind !== "kibble" && kind === favouriteFood(state.pet.id);
    var happyUp = fx.happy + (fav ? FAV_BONUS : 0);
    var stats = computeStats(Date.now(), state.pet);
    // v0.3: FIRST FEED OF THE DAY — computed BEFORE the write
    // (lastFed still points to yesterday/earlier). Different
    // greeting + no wake penalty framing: it's a warm moment.
    var firstOfDay = stats.asleep === false &&
                     tsLocalYmd(state.pet.lastFed || 0) !== todayYMD();
    writePet(function (p, now) {
      p.lastFed = now;
      if (happyUp > 0) {
        // happy = 100 - minutes since lastPetted * rate: move the clock
        // to where the raised value would have been reached.
        var target = clamp(stats.happy + happyUp, 0, 100);
        var at = now - ((100 - target) / HAPPY_RATE) * 60000;
        if (at > (p.lastPetted || 0)) p.lastPetted = Math.min(now, Math.round(at));
      }
      if (stats.asleep || fx.energy > 0) {
        p.asleepSince = null;
        p.asleepE = 0;
        p.wokeAt = now;
        p.awakeE = clamp(stats.energy + fx.energy, 0, 100);
      }
    });
    runtime.mode = "eat";
    runtime.walkTimer = EAT_MS;
    runtime.eatStartTs = Date.now();            // v0.3: kibble clock
    runtime.targetX = null;
    runtime.hungerWarned = false;
    runtime.hungerTalkedAt = 0;
    speak(speakLine(fav ? "speech.fav" : firstOfDay ? "speech.firstfed"
                               : (stats.asleep ? "speech.wake" : "speech.eat")));
    if (firstOfDay || fav) spawnHearts();
    logEvent(PET_EVENT_TYPES.FEED);
    refreshHUD(computeStats(Date.now(), state.pet));
    return fav;
  }

  function toggleSleep() {
    var stats = computeStats(Date.now(), state.pet);
    writePet(function (p, now) {
      if (stats.asleep) {
        p.asleepSince = null;
        p.asleepE = 0;
        p.wokeAt = now;
        p.awakeE = stats.energy;
      } else {
        p.wokeAt = null;
        p.awakeE = 0;
        p.asleepSince = now;
        p.asleepE = stats.energy;
      }
    });
    speak(speakLine(stats.asleep ? "speech.wake" : "speech.sleep"));
    runtime.mode = "idle";
    runtime.targetX = null;
    logEvent(stats.asleep ? PET_EVENT_TYPES.WAKE : PET_EVENT_TYPES.SLEEP);
    refreshHUD(computeStats(Date.now(), state.pet));
  }

  function petThePet() {
    writePet(function (p, now) { p.lastPetted = now; });
    runtime.mode = "happy";
    runtime.walkTimer = 2200;
    runtime.targetX = null;
    speak(speakLine("speech.happy"));
    spawnHearts();
    logEvent(PET_EVENT_TYPES.PET);
    refreshHUD(computeStats(Date.now(), state.pet));
  }

  // v0.3: CATCH entry point (HUD button) — guarded, delegates to
  // spawnBall() from Part 4. Ball click handles the reward itself.
  function tryCatch() {
    if (!runtime.active) return;
    if (Date.now() < runtime.catchCooldownUntil) return;
    var stats = computeStats(Date.now(), state.pet);
    if (stats.asleep || runtime.awayUntil) return;   // asleep, or out on a Pet World walk
    spawnBall();
  }

  // New pet: tombstone the old one so it cannot resurrect via sync
  function confirmNewPet() {
    petConfirm("confirm.newpet", { name: state.pet.name }, function () {
      state.deleted[state.pet.id] = Date.now();
      var now = Date.now();
      state.pet = {
        id: uid(),
        name: rndName(),
        palette: Math.floor(Math.random() * PALETTES.length),
        birthTs: now,
        lastFed: now,
        lastPetted: now,
        wokeAt: now, awakeE: 100,
        asleepSince: null, asleepE: 0
      };
      state.fm = { name: now, palette: now };
      state.sm = now;
      save();
      runtime.mode = "idle";
      runtime.targetX = null;
      runtime.hungerWarned = runtime.boredWarned = runtime.tiredWarned = false;
      runtime.hungerTalkedAt = 0;
      // v0.3: identity swap — birthday dedupe belongs to the NEW friend
      runtime.lastPetId = state.pet.id;
      runtime.birthdayShownYmd = "";
      runtime.birthdayFiredPetId = null;
      logEvent(PET_EVENT_TYPES.NEWPET);
      speak(t("speech.hello", { name: state.pet.name }));
      refreshHUD(computeStats(Date.now(), state.pet));
    });
  }

  // ---------- v0.3: Event log modal (standalone — deep-link safe) ----------
  // Attached to document.body, NOT the pet layer: opens even when
  // the pet is disabled (the calendar deep-link and the log are
  // still meaningful with the pet hidden). Calendar feed rows may
  // link to the matching event via __orosOpenPet(eventId).

  function openEventLog(highlightId) {
    var stale = document.getElementById("pet-eventlog");
    if (stale) stale.remove();

    var dlg = document.createElement("dialog");
    dlg.id = "pet-eventlog";
    dlg.style.cssText =
      "border:1px solid var(--border);border-radius:12px;" +
      "background:var(--panel-bg);color:var(--text);padding:16px;" +
      "width:min(380px,calc(100vw - 32px));" +
      "margin:auto;max-height:calc(100vh - 32px);overflow-y:auto;";   // R32

    var form = document.createElement("form");
    form.method = "dialog";

    var title = document.createElement("div");
    title.style.cssText =
      "font-size:13px;font-weight:700;margin-bottom:10px;";
    title.textContent = t("event.log.title");
    form.appendChild(title);

    var list = document.createElement("div");
    list.style.cssText =
      "max-height:min(320px,50vh);overflow-y:auto;font-size:12px;" +
      "line-height:1.6;display:flex;flex-direction:column;gap:6px;";

    var events = eventLogEntries().slice().reverse();  // newest first
    if (!events.length) {
      var empty = document.createElement("div");
      empty.style.cssText = "color:var(--text-dim);padding:12px 0;";
      empty.textContent = t("event.log.empty");
      list.appendChild(empty);
    }
    events.forEach(function (ev) {
      var row = document.createElement("div");
      var dayLabel = dayLabelFor(ev.ts);
      row.style.cssText =
        "display:flex;justify-content:space-between;gap:12px;" +
        "padding:4px 8px;border-radius:6px;";
      if (highlightId && ev.id === highlightId) {
        row.style.background = "var(--accent, #c8a96e)";
        row.style.color = "#131820";
      }
      var left = document.createElement("span");
      left.textContent = t("event.type." + ev.type) +
        (ev.name ? " · " + ev.name : "");
      var right = document.createElement("span");
      right.style.cssText = "color:var(--text-dim);white-space:nowrap;";
      right.textContent = dayLabel + " " + timeHM(ev.ts);
      row.appendChild(left);
      row.appendChild(right);
      list.appendChild(row);
    });
    form.appendChild(list);

    var closeRow = document.createElement("div");
    closeRow.style.cssText =
      "display:flex;gap:8px;justify-content:flex-end;margin-top:12px;";
    var close = document.createElement("button");
    close.type = "submit";
    close.style.cssText =
      "border:1px solid var(--border);border-radius:7px;background:transparent;" +
      "color:var(--text);padding:7px 14px;font-size:12.5px;font-weight:600;" +
      "cursor:pointer;";
    close.textContent = "OK";
    closeRow.appendChild(close);
    form.appendChild(closeRow);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      dlg.close();
    });
    dlg.appendChild(form);
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) dlg.close();
    });
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  function timeHM(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function dayLabelFor(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    var today = new Date();
    if (ymd(d.getFullYear(), d.getMonth(), d.getDate()) === todayYMD())
      return t("evt.today");
    var yest = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (ymd(d.getFullYear(), d.getMonth(), d.getDate()) ===
        ymd(yest.getFullYear(), yest.getMonth(), yest.getDate()))
      return t("evt.yesterday");
    return t("evt.date", { d: d.getDate(), m: d.getMonth() + 1, y: d.getFullYear() });
  }

  // Confirmation dialog (dice pattern, self-contained, ES5)
  function petConfirm(msgKey, params, onYes) {
    var stale = document.getElementById("pet-confirm");
    if (stale) stale.remove();

    var dlg = document.createElement("dialog");
    dlg.id = "pet-confirm";
    dlg.style.cssText =
      "border:1px solid var(--border);border-radius:12px;" +
      "background:var(--panel-bg);color:var(--text);padding:18px;" +
      "width:min(340px,calc(100vw - 32px));" +
      "margin:auto;max-height:calc(100vh - 32px);overflow-y:auto;";   // R32

    var form = document.createElement("form");
    form.method = "dialog";

    var msg = document.createElement("div");
    msg.style.cssText = "font-size:13px;line-height:1.5;margin-bottom:16px;";
    msg.textContent = t(msgKey, params);
    form.appendChild(msg);

    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";

    var no = document.createElement("button");
    no.type = "button";
    no.style.cssText =
      "border:1px solid var(--border);border-radius:7px;background:transparent;" +
      "color:var(--text-dim);padding:7px 14px;font-size:12.5px;font-weight:600;" +
      "cursor:pointer;";
    no.textContent = t("confirm.no");
    no.addEventListener("click", function () { dlg.close(); });
    row.appendChild(no);

    var yes = document.createElement("button");
    yes.type = "submit";
    yes.style.cssText =
      "border:1px solid var(--danger);border-radius:7px;background:transparent;" +
      "color:var(--danger);padding:7px 14px;font-size:12.5px;font-weight:600;" +
      "cursor:pointer;";
    yes.textContent = t("confirm.yes");
    row.appendChild(yes);

    form.appendChild(row);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      dlg.close();
      onYes();
    });
    dlg.appendChild(form);
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) dlg.close();
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    setTimeout(function () { no.focus(); }, 50);
  }

  // Pointer interactions: click-to-pet vs DRAG (8px threshold).
  function wirePointer() {
    var downX = 0, downY = 0, isDragging = false;

    runtime.canvas.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      runtime.canvas.setPointerCapture(e.pointerId);
      downX = e.clientX;
      downY = e.clientY;
      isDragging = false;
      touchInteraction();                       // v0.3: contemplation break
    });

    runtime.canvas.addEventListener("pointermove", function (e) {
      if (!runtime.canvas.hasPointerCapture || !runtime.canvas.hasPointerCapture(e.pointerId)) return;
      if (!isDragging) {
        if (Math.abs(e.clientX - downX) < 8 && Math.abs(e.clientY - downY) < 8) return;
        isDragging = true;
        var stats = computeStats(Date.now(), state.pet);
        if (stats.asleep) return;                    // don't drag a sleeping pet
        runtime.mode = "drag";
        runtime.targetX = null;
      }
      var rect = runtime.layer.getBoundingClientRect();
      var nx = e.clientX - rect.left - runtime.canvas.width / 2;
      var ny = e.clientY - rect.top - runtime.canvas.height / 2;
      var b = stageBounds();
      runtime.x = clamp(nx, 0, b.w);
      runtime.y = clamp(ny, 4, b.floorY);
      runtime.dir = (e.clientX - rect.left) > runtime.x + runtime.canvas.width / 2 ? 1 : -1;
    });

    var releaseHandler = function (e) {
      if (!runtime.canvas.hasPointerCapture || !runtime.canvas.hasPointerCapture(e.pointerId)) return;
      if (!isDragging) {
        petThePet();                                 // it was a click → petting
      } else {
        runtime.mode = "idle";
        runtime.walkTimer = 1500;
        runtime.y = stageBounds().floorY;
        savePos();
      }
      isDragging = false;
    };
    runtime.canvas.addEventListener("pointerup", releaseHandler);
    runtime.canvas.addEventListener("pointercancel", releaseHandler);

    // Tap/click on empty desktop → walk there (disabled: layer is pointer-events:none)
    // TODO: re-enable by moving click handling to shell document or changing layer CSS
  }

  // Keyboard: F=feed, C=catch, L=log, S=sleep — modifier-guarded
  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (!runtime.active) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // PT-7: F / S / C / L belong to whatever dialog is open (a
      // focused button in the passphrase or Info dialog is not an
      // input, so the tag test below let the keys through).
      if (document.querySelector("dialog[open]") ||
          document.getElementById("sc-info-overlay")) return;
      var el = document.activeElement;
      var tag = (el && el.tagName) || "";
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" ||
          (el && el.isContentEditable)) return;
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        touchInteraction();
        feed();
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        touchInteraction();
        toggleSleep();
      } else if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        touchInteraction();
        tryCatch();
      } else if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        touchInteraction();
        openEventLog();
      }
    });
  }

  // window resize: keep pet in bounds
  function wireResize() {
    window.addEventListener("resize", function () {
      if (!runtime.active) return;
      var b = stageBounds();
      runtime.x = clamp(runtime.x, 0, b.w);
      runtime.y = clamp(runtime.y, b.floorY - runtime.canvas.height, b.floorY);
    });
  }

  // SYNC CELEBRATION (v0.2, unchanged)
  var CELEBRATE_MIN_MS = 60 * 1000;

  function wireSyncCelebration() {
    var api = window.orosSync;
    if (!api || typeof api.onAutoSync !== "function") return;
    api.onAutoSync(function (kind, reason) {
      if (kind !== "done") return;
      if (reason === "interval") return;
      if (!runtime || !runtime.active) return;
      var now = Date.now();
      if (now - (runtime.lastCelebratedAt || 0) < CELEBRATE_MIN_MS) return;
      var stats = computeStats(now, state.pet);
      if (stats.asleep) return;
      runtime.lastCelebratedAt = now;
      runtime.mode = "happy";
      runtime.walkTimer = 1600;
      runtime.targetX = null;
      speak(speakLine("speech.happy"));
      spawnHearts();
    });
  }

  // ---------- 8. Boot & shell toggle ----------
  // window.orosPet API + v0.3 CALENDAR DEEP-LINK contract:
  // window.__orosOpenPet(eventId?) — called by calendar.js when a
  // feed row (label lbl-feed-pet) is clicked. Opens the Activity
  // Log with the matching row highlighted. Progressive: absent
  // calendar.js simply never calls it. Works with pet disabled.

  function $(id) { return document.getElementById(id); }

  function petEnable() {
    if (runtime.active) return;
    createLayer();
    buildHUD();
    buildPaletteRow();
    wirePointer();
    var b = stageBounds();
    var pos = loadPos();
    if (pos) {
      runtime.x = clamp(pos.fx * b.w, 0, b.w);
      runtime.y = clamp(pos.fy * b.floorY, b.floorY - runtime.canvas.height, b.floorY);
    } else {
      runtime.x = Math.max(0, b.w / 2 - runtime.canvas.width / 2);
      runtime.y = b.floorY;
    }
    runtime.mode = "idle";
    runtime.walkTimer = 1800;
    runtime.targetX = null;
    runtime.statsAt = 0;
    runtime.lastTs = 0;
    runtime.lastCelebratedAt = 0;
    runtime.hungerWarned = runtime.boredWarned = runtime.tiredWarned = false;
    runtime.hungerTalkedAt = 0;
    // v0.3 resets:
    runtime.eatStartTs = 0;
    runtime.lastInteractionTs = Date.now();
    runtime.contemplating = false;
    runtime.contemplateTalkedAt = 0;
    runtime.catchCooldownUntil = 0;
    runtime.ball = null;
    runtime.awayUntil = 0;
    runtime.awayCheckAt = 0;
    runtime.lastPetId = state.pet.id;
    runtime.birthdayShownYmd = "";               // let the loop fire if today IS the day
    runtime.birthdayFiredPetId = null;
    runtime.active = true;
    // v0.3: apply collapsed state from localStorage
    if (isMinimized()) hud && hud.classList.add("pet-hud-collapsed");
    refreshHUD(computeStats(Date.now(), state.pet));
    setTimeout(function () {
      speak(t("speech.hello", { name: state.pet.name }));
    }, 700);
    requestAnimationFrame(loop);
  }

  function petDisable() {
    if (!runtime.active) return;
    savePos();
    destroyBall(false);                          // v0.3: no orphan balls
    runtime.active = false;
    if (runtime.rafId) cancelAnimationFrame(runtime.rafId); // prevent dual loops
    runtime.rafId = 0;
    clearTimeout(runtime.bubbleTimer);
    if (runtime.layer) runtime.layer.remove();
    runtime.layer = null;
    runtime.canvas = null;
    runtime.ctx = null;
    runtime.bubble = null;
    runtime.awayEl = null;
    runtime.contemplating = false;
    hud = null;                                  // full teardown, no ghosts
  }

  function setEnabled(on) {
    on = !!on;
    var cur = settingsSliceGet();
    if (cur.enabled !== on) {
      cur.enabled = on;
      cur.enabledTs = Date.now();
      settingsSliceSet(cur);        // applies live via applyPetSettings
      if (window.__orosPetSyncApi) window.__orosPetSyncApi.dirty();
    } else {
      if (on) petEnable(); else petDisable();
    }
  }
  function isEnabled() { return settingsSliceGet().enabled === true; }
  function togglePet() { setEnabled(!isEnabled()); }

  // ---------- Pet World bridge (petworld/ app, same origin) ----------
  // The app is an iframe; this file stays the ONLY writer of
  // oros-pet-data. The app reads the pet through snapshot() and asks
  // for care through feed / pat / sleepToggle / rename, which run the
  // very same code as the HUD buttons, so the companion and the app
  // never disagree and no second merge exists. Everything returned is
  // a plain JSON clone: nothing of this realm leaks into the frame.
  function worldSnapshot() {
    var now = Date.now();
    var st = computeStats(now, state.pet);
    return JSON.parse(JSON.stringify({
      id: state.pet.id,
      name: state.pet.name,
      palette: clamp(state.pet.palette | 0, 0, PALETTES.length - 1),
      colors: spriteColors(state.pet.palette),
      birthTs: state.pet.birthTs || now,
      ageDays: ageDays(now),
      food: st.food,
      happy: st.happy,
      energy: st.energy,
      asleep: st.asleep,
      mood: mood(st),
      favFood: favouriteFood(state.pet.id),
      provisional: !state.sm
    }));
  }

  function worldSprite(pose) {
    var p = pose || {};
    var moods = { sleep: 1, tired: 1, happy: 1, neutral: 1 };
    var modes = { idle: 1, walk: 1, happy: 1, eat: 1 };
    return spriteGrid({
      mood: moods[p.mood] ? p.mood : "neutral",
      mode: modes[p.mode] ? p.mode : "idle",
      legPhase: p.legPhase === 1 ? 1 : 0,
      dir: p.dir === -1 ? -1 : 1,
      frame: typeof p.frame === "number" && isFinite(p.frame) ? p.frame : 0,
      eatT: typeof p.eatT === "number" && isFinite(p.eatT) ? p.eatT : -1,
      contemplating: !!p.contemplating,
      acc: typeof p.acc === "string" && ACCESSORIES[p.acc] === 1 ? p.acc : ""
    }).map(function (row) { return row.slice(); });
  }

  window.orosPet = {
    enable:  function () { setEnabled(true); },
    disable: function () { setEnabled(false); },
    toggle:  togglePet,
    isEnabled: isEnabled,
    isActive: function () { return runtime.active; },
    // v0.3 surfaces:
    openLog: function (eventId) { openEventLog(eventId); },
    clearLog: clearEventLog,
    calendarFeedOn: calendarFeedOn,
    setCalendarFeed: setCalendarFeed,
    // Pet World bridge (see above):
    snapshot: worldSnapshot,
    sprite: worldSprite,
    line: function (group) {
      LANG = currentLang();
      var ok = { "speech.hello": 1, "speech.firstfed": 1, "speech.hungry": 1, "speech.bored": 1,
                 "speech.tired": 1, "speech.happy": 1, "speech.eat": 1, "speech.wake": 1,
                 "speech.sleep": 1, "speech.contemp": 1, "speech.fav": 1, "speech.back": 1 };
      if (!ok[group]) return "";
      return group === "speech.hello" ? t(group, { name: state.pet.name }) : speakLine(group);
    },
    // kind: kibble | carrot | strawberry | mushroom | apple (unknown → kibble).
    // The app spends the food from its backpack; this only feeds.
    feed: function (kind) {
      var fav = feed(typeof kind === "string" ? kind : "kibble");
      var out = worldSnapshot();
      out.favourite = fav;
      return out;
    },
    pat: function () { petThePet(); return worldSnapshot(); },
    // A finished game with the pet (Pet World): joy like a pat, and
    // the energy it cost (0..15) through a FRESH anchor pair, the
    // catch-game way. Visuals run only with the companion on; no
    // event is logged (the activity log keeps care, not play).
    play: function (cost) {
      var c = clamp(Math.round(Number(cost) || 0), 0, 15);
      var stats = computeStats(Date.now(), state.pet);
      writePet(function (p, now) {
        p.lastPetted = now;
        if (!stats.asleep) { p.wokeAt = now; p.awakeE = clamp(stats.energy - c, 0, 100); }
      });
      if (runtime.active) {
        runtime.mode = "happy";
        runtime.walkTimer = 2200;
        runtime.targetX = null;
        spawnHearts();
        refreshHUD(computeStats(Date.now(), state.pet));
      }
      return worldSnapshot();
    },
    sleepToggle: function () { toggleSleep(); return worldSnapshot(); },
    rename: function (name) { renamePet(name); return worldSnapshot(); }
  };

  // v0.3: calendar deep-link (named exactly as contracted in the
  // integration plan; calendar.js checks typeof before calling)
  window.__orosOpenPet = function (eventId) {
    openEventLog(typeof eventId === "string" ? eventId : null);
  };

  // ---------- Boot ----------
  load();
  // v0.3.2: one-time legacy migration — carry over a pre-0.3.2
  // calendar opt-out ("oros-pet-calendar-sync" = "0") into the
  // synced petSettings slice. calFeedTs=1 beats the epoch-0
  // default but loses to any real write. The migrated value MUST
  // reach the cloud: bootLegacyDirty arms the first push right
  // after registerSync (the dirty funnel does not exist before
  // it — see finding #1 in the same wave).
  var bootLegacyDirty = false;
  (function migrateLegacySettings() {
    try {
      if (localStorage.getItem("oros-pet-settings")) return;
      var legacy = localStorage.getItem(CALENDAR_SYNC_KEY);
      var legacyEnabled = localStorage.getItem(ENABLED_KEY);
      var legacyMin = localStorage.getItem("oros-pet-minimized");
      if (legacy === null && legacyEnabled === null && legacyMin === null) return;
      localStorage.setItem("oros-pet-settings", JSON.stringify({
        ver: 1,
        calFeed: legacy !== null ? legacy !== "0" : true,
        calFeedTs: legacy !== null ? 1 : 0,
        enabled: legacyEnabled === "1",
        enabledTs: legacyEnabled !== null ? 1 : 0,
        minimized: legacyMin === "1",
        minimizedTs: legacyMin !== null ? 1 : 0
      }));
      bootLegacyDirty = true;
    } catch (e) {}
  })();
  registerSync();
  if (bootLegacyDirty && window.__orosPetSyncApi) {
    window.__orosPetSyncApi.dirty();
  }
  wireKeyboard();
  wireResize();
  wireSyncCelebration();
  if (isEnabled()) petEnable();

})();