// ============================================================
// orOS Screen Pet — Shell component
// v0.2 (Wave 2/3/4 evolution of the v0.1 orOS-native port)
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
// v0.2 EVOLUTION (approved waves — no schema change, DATA_VER
// stays 1; fm/palette/name/birthTs already existed in v0.1):
//   - Wave 2: energy-scaled wandering (short hops + longer idle
//     pauses when energy < 40), mood-driven expressions
//     (happy / neutral / tired — pure render from derived
//     stats), enriched bilingual speech pools, hunger reaction
//     (droopy half-lidded gaze + slow blinks + throttled hungry
//     bubble every ~10 min while food < 20).
//   - Wave 3: palette picker + rename in the HUD (both via the
//     per-field LWW fm map — they were already synced fields),
//     position memory: device-local "oros-pet-pos" (normalized
//     fractions, clamped on restore; never synced, never dirty).
//   - Wave 4: "N days with you" HUD line (display-only from
//     birthTs), sync celebration hop (Part 4 — wired against
//     the REAL orosSync event surface, progressive-guarded).
//
// Sections:
//   1. Constants, i18n, helpers
//   2. State model, storage, field writes, position memory
//   3. Derived stats (cycle simulation)
//   4. Sync slice (merge engine, per-field LWW)
//   5. Sprite engine (moods, directional pupils)
//   6. Behavior loop (energy-scaled wandering, hunger gaze)
//   7. Interactions + HUD (palette picker, rename, age line)
//   8. Boot & shell toggle (position restore, sync hook)
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-pet-data";
  var DATA_VER = 1;
  var ENABLED_KEY = "oros-pet-enabled";   // shell-local pref (device presence)
  var POS_KEY = "oros-pet-pos";           // v0.2: device-local position memory
  var MAX_NAME_LEN = 16;                  // v0.2: rename input cap
  var HUNGER_TALK_MS = 10 * 60 * 1000;    // v0.2: hungry bubble cadence

  // ---------- 1. Constants, i18n, helpers ----------
  var LANG = localStorage.getItem("oros-lang") === "el" ? "el" : "en";

  // Relaxed decay (units per minute)
  var FOOD_RATE    = 100 / (24 * 60);   // ~24h from 100 to 0
  var HAPPY_RATE   = 100 / (36 * 60);   // ~36h
  var ENERGY_DECAY = 100 / (10 * 60);   // ~10h awake
  var ENERGY_GAIN  = 100 / (5 * 60);    // ~5h asleep
  var SLEEP_AT     = 8;                 // auto-sleep threshold
  var WAKE_AT      = 95;                // auto-wake threshold

  var STRINGS = {
    en: {
      "hud.name":        "{name}",
      "hud.age.one":     "{n} day with you",
      "hud.age.many":    "{n} days with you",
      "stat.food":       "Food",
      "stat.happy":      "Happy",
      "stat.energy":     "Energy",
      "action.feed":     "Feed",
      "action.sleep":    "Sleep",
      "action.wake":     "Wake up",
      "action.newpet":   "New pet",
      "menu.pet":        "Screen Pet",
      "confirm.newpet":  "Release {name} and welcome a new pet? This cannot be undone.",
      "confirm.no":      "Cancel",
      "confirm.yes":     "New pet",
      "speech.hello":    "Hi! My name is {name}!",
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
                          "Nighty night...", "See you tomorrow..."]
    },
    el: {
      "hud.name":        "{name}",
      "hud.age.one":     "{n} ημέρα μαζί σου",
      "hud.age.many":    "{n} ημέρες μαζί σου",
      "stat.food":       "Φαγητό",
      "stat.happy":      "Διάθεση",
      "stat.energy":     "Ενέργεια",
      "action.feed":     "Φαγητό",
      "action.sleep":    "Ύπνος",
      "action.wake":     "Ξύπνα",
      "action.newpet":   "Νέο πλάσμα",
      "menu.pet":        "Screen Pet",
      "confirm.newpet":  "Να φύγει η/ο {name} και να έρθει νέο πλάσμα; Δεν αναιρείται.",
      "confirm.no":      "Άκυρο",
      "confirm.yes":     "Νέο πλάσμα",
      "speech.hello":    "Γεια! Με λένε {name}!",
      "speech.hungry":   ["Πεινάω...", "Μμμ, φαγητό;", "Το στομάχι μου γκρινιάζει!",
                          "Τάισέ με, σε παρακαλώ!", "Είναι ώρα για φαγητό;"],
      "speech.bored":    ["Χαδέψου μου!", "Βαριέμαι...", "Παίξε μαζί μου!",
                          "Έλα! Κοίτα με!", "Τόση ησυχία εδώ..."],
      "speech.tired":    ["Νυστάζω...", "Ωωχ...", "Νιώθω το κρεβάτι να με φωνάζει",
                          "Δεν ανοίγω τα μάτια μου...", "Χρειάζομαι... ύπνο..."],
      "speech.happy":    ["Λαλάλα!", "Είμαι ευτυχισμένο/η!", "Χοοοοπ!",
                          "Κορυφαία μέρα!", "Χιχι!"],
      "speech.eat":      ["Ναμ νάμ!", "Νόστιμο!", "Περισσότερα!",
                          "Νταξ!", "Ναμ ναμ ναμ!"],
      "speech.wake":     ["Καλημέρααα!", "Ξύπνιος/α!", "Ωραία νύχτα!",
                          "Γεια σου ήλιε!", "Έτοιμος/η για παιχνίδι!"],
      "speech.sleep":    ["Καληνύχτα...", "Zzz...", "Όνειρα γλυκά",
                          "Υπνάκια...", "Τα λέμε αύριο..."]
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
    { nameEn: "Orange",  nameEl: "Πορτοκαλί", body: "#ffb74d", belly: "#fff3e0", eye: "#5d2f00" },
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

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    console.log("pet.js v" + (SCRIPT_V || "?") + " boot");
  })();
  
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
  var runtime = null;   // per-device choreography (Part 3), never synced

  function defaultState() {
    var now = Date.now();
    return {
      ver: DATA_VER,
      sm: now,
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
      fm: { name: now, palette: now }
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
    save();
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

  // v0.2: POSITION MEMORY — device-local like oros-pet-enabled
  // (ergonomics, never synced, never dirty). Stored as NORMALIZED
  // fractions (fx over stage width, fy over floor height) so a
  // restore on a different window size still lands on-screen.
  // Saved on drag end and disable; clamped on restore.
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

  // v0.2: AGE — pure display math from birthTs (display-only field,
  // Part IX: never part of any sync computation)
  function ageDays(now) {
    return Math.max(0, Math.floor(((now) - (state.pet.birthTs || now)) / 86400000));
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

  // v0.2: MOOD — pure derivation from stats, drives the sprite
  // expression (Part 3). Priority: asleep > tired (low energy or
  // starving) > happy (well-loved) > neutral. No storage, no sync —
  // every device computes the same face from the same stats.
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

  var TEMPORAL = ["lastFed", "lastPetted"];
  var FIELDS_LWW = ["name", "palette"];

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
    var pet;
    var aAlive = aPet && !del[aPet.id];
    var bAlive = bPet && !del[bPet.id];
    if (aAlive && !bAlive) pet = aPet;
    else if (bAlive && !aAlive) pet = bPet;
    else if (!aAlive && !bAlive) pet = null;
    else {
      var aSm = a.sm || 0, bSm = b.sm || 0;
      if (aSm > bSm) pet = aPet;
      else if (bSm > aSm) pet = bPet;
      else pet = (JSON.stringify(aPet) < JSON.stringify(bPet)) ? aPet : bPet;

      // Field-level reconciliation on the chosen base:
      var other = (pet === aPet) ? bPet : aPet;
      var out = {};
      Object.keys(pet).forEach(function (k) { out[k] = pet[k]; });

      TEMPORAL.forEach(function (k) {
        if (other[k] !== undefined && (out[k] === undefined || other[k] > out[k])) out[k] = other[k];
      });

      // Active anchor pair: newer anchor wins as a unit.
      var otherAsleep = other.asleepSince || 0;
      var outAsleep = out.asleepSince || 0;
      if (otherAsleep > outAsleep) {
        out.asleepSince = other.asleepSince;
        out.asleepE = other.asleepE || 0;
      }
      if ((other.wokeAt || 0) > (out.wokeAt || 0)) {
        out.wokeAt = other.wokeAt;
        out.awakeE = other.awakeE;
      }

      var fmA = (pet === aPet) ? (a.fm || {}) : (b.fm || {});
      var fmB = (pet === aPet) ? (b.fm || {}) : (a.fm || {});
      var fm = {};
      FIELDS_LWW.forEach(function (k) {
        if (fmB[k] !== undefined && (fmA[k] === undefined || fmB[k] > fmA[k])) {
          out[k] = other[k];
          fm[k] = fmB[k];
        } else {
          fm[k] = fmA[k] || 0;
        }
      });
      pet = out;
      var fmOut = fm;
      var result = {
        ver: DATA_VER,
        sm: Math.max(a.sm || 0, b.sm || 0),
        deleted: del,
        pet: pet,
        fm: fmOut
      };
      if (!result.pet) return null;
      return result;
    }

    var out2 = {
      ver: DATA_VER,
      sm: Math.max(a.sm || 0, b.sm || 0),
      deleted: del,
      pet: pet,
      fm: (pet && (a.pet === pet ? a.fm : b.fm)) || {}
    };
    if (!out2.pet) return null;
    return out2;
  }

  function sliceGet() {
    return JSON.parse(JSON.stringify(state));
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
    // v0.2 LIVE REFRESH: a remote merge (rename / palette change /
    // feed from another device / new entity) now reflects IMMEDIATELY
    // on this device while the pet is active — stats recomputed, HUD
    // redrawn, warn flags rearmed so low-stat thresholds re-fire.
    // While inactive, the next petEnable() reads the fresh state.
    if (runtime && runtime.active) {
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
  }
  
  