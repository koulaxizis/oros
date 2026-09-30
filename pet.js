// ============================================================
// orOS Screen Pet — Shell component
// v0.1 (first orOS-native port from Soffitta "Screen Pet")
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
// Sections:
//   1. Constants, i18n, helpers
//   2. State model, storage, field writes
//   3. Derived stats (cycle simulation)
//   4. Sync slice (merge engine, per-field LWW)
//   5. Sprite engine (Part 2)
//   6. Behavior loop (Part 2)
//   7. Interactions + HUD (Part 3)
//   8. Boot & shell toggle (Part 4)
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-pet-data";
  var DATA_VER = 1;
  var ENABLED_KEY = "oros-pet-enabled";   // shell-local pref (also synced via fm? no — shell settings handle it)

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
      "speech.hungry":   ["I'm hungry...", "Food? Any food?", "My tummy is rumbling!"],
      "speech.bored":    ["Pet me!", "I'm bored...", "Play with me!"],
      "speech.tired":    ["I'm sleepy...", "Yaaawn...", "Ohh..."],
      "speech.happy":    ["Lalala!", "I'm so happy!", "Whooo!"],
      "speech.eat":      ["Yum yum!", "Delicious!", "More please!"],
      "speech.wake":     ["Good morning!", "I'm awake!", "Slept great!"],
      "speech.sleep":    ["Good night...", "Zzz...", "Sweet dreams"]
    },
    el: {
      "hud.name":        "{name}",
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
      "speech.hungry":   ["Πεινάω...", "Μμμ, φαγητό;", "Το στομάχι μου γκρινιάζει!"],
      "speech.bored":    ["Χαδέψου μου!", "Βαριέμαι...", "Παίξε μαζί μου!"],
      "speech.tired":    ["Νυστάζω...", "Ωωχ...", "Νιώθω το κρεβάτι να με φωνάζει"],
      "speech.happy":    ["Λαλάλα!", "Είμαι ευτυχισμένο/η!", "Χοοοοπ!"],
      "speech.eat":      ["Ναμ νάμ!", "Νόστιμο!", "Περισσότερα!"],
      "speech.wake":     ["Καλημέρααα!", "Ξύπνιος/α!", "Ωραία νύχτα!"],
      "speech.sleep":    ["Καληνύχτα...", "Zzz...", "Όνειρα γλυκά"]
    }
  };

  var NAMES = {
    en: ["Pixel", "Bean", "Mochi", "Pip", "Waffles", "Ziggy", "Bloop", "Pesto"],
    el: ["Πίκα", "Κόκο", "Μπέλλα", "Λόλι", "Νούφα", "Σίσσυ", "Κούκος", "Μήλο",
         "Φασολάκης", "Καφέ", "Ζίτα", "Πάντζαρης", "Μπέγια", "Σουάρι", "Τρίγωνο"]
  };

  var PALETTES = [
    { name: "Γαλάζιο",   body: "#81d4fa", belly: "#e1f5fe", eye: "#0b2030" },
    { name: "Πορτοκαλί", body: "#ffb74d", belly: "#fff3e0", eye: "#5d2f00" },
    { name: "Πράσινο",  body: "#a5d6a7", belly: "#f1f8e9", eye: "#1b3a1e" },
    { name: "Ροζ",      body: "#f48fb1", belly: "#fce4ec", eye: "#4a1430" },
    { name: "Μωβ",      body: "#b39ddb", belly: "#ede7f6", eye: "#2c1849" }
  ];

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

  // ---------- 2. State model, storage, field writes ----------
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
  var runtime = null;   // per-device choreography (Part 2), never synced

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
    // Part 3 hooks: refreshHUD(); refreshSpeechIfChanged();
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

    // ---------- 5. Sprite engine ----------
  // 16×16 pixel-grid renderer (transplanted from Soffitta, cleaned:
  // directional pupils now work both ways, no off-by-one eye shift,
  // Zzz drawn on canvas, bubbles clamped to stage bounds).

  var PX = 6;            // pixel size in CSS px (scaled down on mobile via CSS)
  var SPR = 16;           // sprite grid 16×16
  var WALK_SPEED = 42;   // px/sec
  var FLOOR_MARGIN = 16;  // keep pet above layer bottom edge

  var GRID_COLORS = null;

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
  }

  // ---------- 6. Behavior loop (runtime, never synced) ----------
  // runtime = per-device choreography: position, facing, frame,
  // walk decisions, bubble state, warn flags. Reset on boot, never
  // persisted, never merged — every device dances its own dance
  // around the SAME synced pet entity.
  runtime = {
    layer: null, canvas: null, ctx: null,
    bubble: null, bubbleTimer: null,
    x: 0, y: 0, dir: 1,
    mode: "idle",           // idle | walk | happy | eat | drag
    frame: 0, walkTimer: 0, targetX: null,
    dragging: false, dragOffX: 0,
    stats: null, statsAt: 0,
    hungerWarned: false, boredWarned: false, tiredWarned: false,
    lastTs: 0, active: false
  };

  function stageBounds() {
    var w = runtime.layer ? runtime.layer.clientWidth : window.innerWidth;
    var h = runtime.layer ? runtime.layer.clientHeight : window.innerHeight;
    return {
      w: w - runtime.canvas.width,
      h: h,
      floorY: h - runtime.canvas.height - FLOOR_MARGIN -
              (parseFloat(getComputedStyle(runtime.layer).getPropertyValue("--pet-floor-lift")) || 0)
    };
  }

  function refreshStatsIfStale(now) {
    // Cheap throttle: stats drive bars + sprite mode, 1s resolution
    if (now - runtime.statsAt < 1000 && runtime.stats) return runtime.stats;
    runtime.stats = computeStats(now, state.pet);
    runtime.statsAt = now;
    return runtime.stats;
  }

  function updateBehavior(dt, now) {
    var stats = refreshStatsIfStale(now);
    runtime.frame++;

    // Derived sleep overrides choreography: sprite sleeps while the
    // pet is asleep — every device agrees, because it's computed.
    var sleeping = stats.asleep;

    // Eat/happy are transient pose timers (2–2.5s), then back to life
    if (runtime.mode === "eat" || runtime.mode === "happy") {
      runtime.walkTimer -= dt * 1000;
      if (runtime.walkTimer <= 0) runtime.mode = sleeping ? "idle" : "walk";
    } else if (runtime.mode === "drag") {
      // position controlled by pointer; no movement decisions
    } else if (sleeping) {
      runtime.mode = "idle";   // pose shown via stats.asleep, not mode
    } else {
      if (runtime.mode === "walk") {
        if (runtime.targetX !== null) {
          var dx = runtime.targetX - runtime.x;
          if (Math.abs(dx) < 6) {
            runtime.targetX = null;
            runtime.mode = "idle";
            runtime.walkTimer = 2000 + Math.random() * 4000;
          } else {
            runtime.dir = dx > 0 ? 1 : -1;
            runtime.x += clamp(dx, -WALK_SPEED * dt, WALK_SPEED * dt);
          }
        } else {
          runtime.walkTimer -= dt * 1000;
          if (runtime.walkTimer <= 0) {
            var r = Math.random();
            if (r < 0.35) {
              runtime.mode = "idle";
              runtime.walkTimer = 1500 + Math.random() * 3500;
            } else if (r < 0.5) {
              runtime.dir *= -1;
              runtime.walkTimer = 1200 + Math.random() * 2500;
            } else {
              runtime.walkTimer = 1500 + Math.random() * 3000;
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

    // Stage limits
    var b = stageBounds();
    if (runtime.x < 0) { runtime.x = 0; runtime.dir = 1; runtime.targetX = null; }
    if (runtime.x > b.w) { runtime.x = b.w; runtime.dir = -1; runtime.targetX = null; }
    runtime.y = Math.max(b.floorY, 60);

    // Threshold speech (once per crossing — runtime flags, not synced)
    if (!speechAllowed()) return;
    if (stats.food < 25 && !runtime.hungerWarned) { runtime.hungerWarned = true; speak(speakLine("speech.hungry")); }
    if (stats.food >= 35) runtime.hungerWarned = false;
    if (!stats.asleep) {
      if (stats.happy < 25 && !runtime.boredWarned) { runtime.boredWarned = true; speak(speakLine("speech.bored")); }
      if (stats.happy >= 35) runtime.boredWarned = false;
      if (stats.energy < 20 && !runtime.tiredWarned) { runtime.tiredWarned = true; speak(speakLine("speech.tired")); }
      if (stats.energy >= 35) runtime.tiredWarned = false;
    }
  }

  // ---------- Sprite drawing ----------

  function drawSprite(stats) {
    var pal = PALETTES[clamp(state.pet.palette | 0, 0, PALETTES.length - 1)];
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

    // Grid: 0 empty, 1 body, 2 belly, 3 eye/dark
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
    // Tail (left side; flipped for dir = -1 below)
    rect(13, 10, 15, 11, 1);

    // Walking legs alternate
    if (legPhase === 1) {
      rect(4, 14, 6, 15, 0);
      rect(4, 13, 6, 13, 1);
    }

    // Eyes — FIXED from prototype: pupils shift cleanly toward
    // walking direction on BOTH eyes (the old grid[5][10] hack
    // punched a hole in the wrong eye for one direction).
    if (sleeping) {
      rect(5, 6, 6, 6, 3);
      rect(9, 6, 10, 6, 3);
    } else if (runtime.frame % 140 < 4) {           // occasional blink
      rect(5, 6, 6, 6, 3);
      rect(9, 6, 10, 6, 3);
    } else {
      rect(5, 5, 6, 7, 3);
      rect(9, 5, 10, 7, 3);
      // pupil highlight toward direction
      if (runtime.dir === 1) {
        grid[5][6] = 2; grid[5][10] = 2;             // light pixel
      } else {
        grid[5][5] = 2; grid[5][9] = 2;
      }
    }

    // Mouth
    if (runtime.mode === "eat") {
      rect(7, 10, 8, 11, 3);
    } else if (runtime.mode === "happy") {
      rect(7, 9, 8, 9, 3);
    } else if (!sleeping) {
      rect(7, 10, 8, 10, 3);
    }

    // Zzz above head when asleep
    if (sleeping) {
      rect(13, 2, 13, 2, 3);
      rect(14, 0, 14, 1, 3);
      rect(15, 0, 15, 0, 3);
    }

    // Render with direction flip
    ctx.save();
    ctx.translate(cw / 2, cw / 2 + bob * PX * 0.4);
    ctx.scale(runtime.dir === 1 ? 1 : -1, 1);
    ctx.translate(-cw / 2, -cw / 2);
    var colors = { 1: pal.body, 2: pal.belly, 3: pal.eye };
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
    if (!runtime.bubble || !speechAllowed()) return;
    runtime.bubble.textContent = text;

    // Clamp inside stage (prototype could clip above the top edge)
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
    for (var i = 0; i < 3; i++) {
      setTimeout(function () {
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
    updateBehavior(dt, now);
    drawSprite(runtime.stats);

    runtime.canvas.style.transform =
      "translate(" + runtime.x + "px, " + runtime.y + "px)";

    // HUD refresh piggybacks the 1s stats throttle
    if (runtime.statsAt === now) refreshHUD(runtime.stats);

    requestAnimationFrame(loop);
  }

    // ---------- 7. Interactions + HUD ----------

  var hud = null;

  function buildHUD() {
    hud = document.createElement("div");
    hud.id = "pet-hud";
    hud.innerHTML =
      '<div class="pet-hud-name" id="pet-hud-name"></div>' +
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
        '<button type="button" id="pet-sleep-btn"></button>' +
        '<button type="button" id="pet-new-btn"></button>' +
      '</div>';
    runtime.layer.appendChild(hud);

    $("pet-feed-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      feed();
    });
    $("pet-sleep-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      toggleSleep();
    });
    $("pet-new-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      confirmNewPet();
    });
    // HUD must never trigger stage-walk on its own clicks
    hud.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
  }

  function refreshHUD(stats) {
    if (!hud || !stats || !state.pet) return;
    $("pet-hud-name").textContent = state.pet.name;
    $("pet-fill-food").style.width = stats.food + "%";
    $("pet-fill-happy").style.width = stats.happy + "%";
    $("pet-fill-energy").style.width = stats.energy + "%";
    $("pet-stat-food").classList.toggle("low", stats.food < 30);
    $("pet-stat-happy").classList.toggle("low", stats.happy < 30);
    $("pet-stat-energy").classList.toggle("low", stats.energy < 30);
    $("pet-feed-btn").textContent = t("action.feed");
    $("pet-sleep-btn").textContent = stats.asleep ? t("action.wake") : t("action.sleep");
    $("pet-new-btn").textContent = t("action.newpet");
  }

  // Care actions. Everything funnels through writePet() so field
  // timestamps stay coherent and the sync engine sees clean writes.

  function feed() {
    var stats = computeStats(Date.now(), state.pet);
    writePet(function (p, now) {
      p.lastFed = now;
      if (stats.asleep) {
        // Feed gently wakes the pet (friendly, not forced)
        p.asleepSince = null;
        p.asleepE = 0;
        p.wokeAt = now;
        p.awakeE = stats.energy;
      }
    });
    runtime.mode = "eat";
    runtime.walkTimer = 2400;
    runtime.targetX = null;
    speak(speakLine(stats.asleep ? "speech.wake" : "speech.eat"));
    refreshHUD(computeStats(Date.now(), state.pet));
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
    refreshHUD(computeStats(Date.now(), state.pet));
  }

  function petThePet() {
    writePet(function (p, now) { p.lastPetted = now; });
    runtime.mode = "happy";
    runtime.walkTimer = 2200;
    runtime.targetX = null;
    speak(speakLine("speech.happy"));
    spawnHearts();
    refreshHUD(computeStats(Date.now(), state.pet));
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
      speak(t("speech.hello", { name: state.pet.name }));
      refreshHUD(computeStats(Date.now(), state.pet));
    });
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
      "width:min(340px,calc(100vw - 32px));";

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

  // Pointer interactions: click-to-pet vs DRAG (finally implemented —
  // the prototype had the CSS but no handlers). 8px movement
  // threshold separates "petting" from "carrying".
  function wirePointer() {
    var downX = 0, downY = 0, isDragging = false;

    runtime.canvas.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      runtime.canvas.setPointerCapture(e.pointerId);
      downX = e.clientX;
      downY = e.clientY;
      isDragging = false;
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
      }
      isDragging = false;
    };
    runtime.canvas.addEventListener("pointerup", releaseHandler);
    runtime.canvas.addEventListener("pointercancel", releaseHandler);

    // Tap/click on empty desktop → walk there
    runtime.layer.addEventListener("pointerdown", function (e) {
      if (e.target === runtime.canvas || e.target === hud) return;
      if (hud && hud.contains(e.target)) return;
      var stats = computeStats(Date.now(), state.pet);
      if (stats.asleep) return;
      var rect = runtime.layer.getBoundingClientRect();
      var px = e.clientX - rect.left;
      var b = stageBounds();
      runtime.targetX = clamp(px - runtime.canvas.width / 2, 0, b.w);
      runtime.mode = "walk";
    });
  }

  // Keyboard: F=feed, S=sleep — modifier-guarded (fixes prototype
  // bug where Ctrl+S saved AND slept the pet). Runs in the SHELL
  // document, so guards must be strict: no OS combos, no inputs,
  // pet must be active, document visible.
  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (!runtime.active) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var el = document.activeElement;
      var tag = (el && el.tagName) || "";
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" ||
          (el && el.isContentEditable)) return;
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        feed();
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        toggleSleep();
      }
    });
  }

  // window resize: keep pet in bounds
  function wireResize() {
    window.addEventListener("resize", function () {
      if (!runtime.active) return;
      var b = stageBounds();
      runtime.x = clamp(runtime.x, 0, b.w);
      runtime.y = clamp(runtime.y, 60, b.floorY);
    });
  }

    // ---------- 8. Boot & shell toggle ----------
  // The pet is a shell COMPONENT, not an app: it boots when the shell
  // boots (if enabled) and exposes window.orosPet for the menu to
  // toggle. Presence pref (oros-pet-enabled) is deliberately
  // SHELL-LOCAL for v0.1 (device-specific presence — flagged as
  // "under consideration" for a future synced shell-settings wave).

  function $(id) { return document.getElementById(id); }

  function petEnable() {
    if (runtime.active) return;
    createLayer();
    buildHUD();
    wirePointer();
    var b = stageBounds();
    runtime.x = Math.max(0, b.w / 2 - runtime.canvas.width / 2);
    runtime.y = b.floorY;
    runtime.mode = "idle";
    runtime.walkTimer = 1800;
    runtime.targetX = null;
    runtime.statsAt = 0;
    runtime.lastTs = 0;
    runtime.hungerWarned = runtime.boredWarned = runtime.tiredWarned = false;
    runtime.active = true;
    refreshHUD(computeStats(Date.now(), state.pet));
    setTimeout(function () {
      speak(t("speech.hello", { name: state.pet.name }));
    }, 700);
    requestAnimationFrame(loop);
  }

  function petDisable() {
    if (!runtime.active) return;
    runtime.active = false;                 // kills the rAF loop
    clearTimeout(runtime.bubbleTimer);
    if (runtime.layer) runtime.layer.remove();
    runtime.layer = null;
    runtime.canvas = null;
    runtime.ctx = null;
    runtime.bubble = null;
    hud = null;                              // full teardown, no ghosts
  }

  function setEnabled(on) {
    try { localStorage.setItem(ENABLED_KEY, on ? "1" : "0"); } catch (e) {}
    if (on) petEnable(); else petDisable();
  }
  function isEnabled() { return localStorage.getItem(ENABLED_KEY) === "1"; }
  function togglePet() { setEnabled(!isEnabled()); }

  window.orosPet = {
    enable:  function () { setEnabled(true); },
    disable: function () { setEnabled(false); },
    toggle:  togglePet,
    isEnabled: isEnabled,
    isActive: function () { return runtime.active; }
  };

  // ---------- Boot ----------
  load();
  registerSync();
  wireKeyboard();
  wireResize();
  if (isEnabled()) petEnable();

})();