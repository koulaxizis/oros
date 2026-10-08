// ============================================================
// orOS Pet World — App logic (v1.0.0, phase 1: foundations)
// The Screen Pet's own world: a pixel forest where the SAME pet as
// the desktop companion lives, with the real time of day.
//   - The pet itself (name, palette, care clocks, sleep) belongs to
//     the shell's pet.js. This app never writes oros-pet-data: it
//     reads window.parent.orosPet.snapshot() and asks for care
//     through orosPet.feed / pat / sleepToggle / rename, so the
//     companion and the forest always show one creature.
//   - The art is shared too: orosPet.sprite(pose) returns the very
//     16×16 grid the companion draws.
//   - The forest (later phases: nest, garden, backpack, progress)
//     is this app's own synced slice "petworld". Phase 1 carries the
//     binding to the pet and the per-device ledger the next phases
//     fill; a new pet asks once whether the forest stays or starts
//     fresh (Chris, 2026-10-08).
// Data:
//   - synced slice "petworld" (oros-petworld-data):
//     { ver, br, pet{id, ts}, rows{deviceId:{b, c{item:[in, out]}}} }
//     join: br max; pet by later ts; rows per device by epoch b,
//     equal epochs take per item the max of in and of out; rows with
//     b < br drop (a fresh start). Balance of an item = Σin − Σout.
//   - device-local (R10): oros-petworld-device (this device's row id)
// Sections:
//   1. Constants, i18n, helpers
//   2. World data: normalize / merge / ledger / binding (R5, R26)
//   3. Bridge to the shell pet
//   4. Scene: layout, sky by time of day, prerendered background
//   5. Pet choreography + particles
//   6. Render loop
//   7. UI: toolbar, stats, actions, speech bubble
//   8. Dialogs (rename, new friend)
//   9. Toasts
//  10. Keyboard
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-petworld-data";
  var DEVICE_KEY  = "oros-petworld-device";
  var PET_KEY     = "oros-pet-data";        // read-only here: storage event only
  var DATA_VER    = 1;
  var ITEM_RE     = /^[a-z][a-z0-9_]{0,23}$/;
  var ID_RE       = /^[A-Za-z0-9_-]{1,40}$/;
  var MAX_ITEMS   = 64;
  var MAX_N       = 1e9;
  var WAKE_AT     = 95;                     // pet.js auto-wake threshold
  var NAME_MAX    = 16;                     // pet.js MAX_NAME_LEN

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
      "age.one": "{n} day with you",
      "age.many": "{n} days with you",
      "stat.food": "Food", "stat.happy": "Happiness", "stat.energy": "Energy",
      "act.feed": "Feed", "act.pat": "Pat", "act.sleep": "Sleep", "act.wake": "Wake up",
      "key.feed": "Feed (F)", "key.pat": "Pat (P)", "key.sleep": "Sleep (S)", "key.wake": "Wake up (S)",
      "btn.rename": "Rename {name}",
      "btn.companionOn": "Shown on the desktop too (tap to hide)",
      "btn.companionOff": "Not shown on the desktop (tap to show)",
      "scene.awake": "{name} in the forest, {when}. Tap {name} to pat, tap the ground to call.",
      "scene.asleep": "{name} sleeps under the old oak, {when}.",
      "when.night": "night", "when.dawn": "dawn", "when.day": "daytime", "when.dusk": "dusk",
      "say.asleep": ["Zzz...", "Shh... sleeping", "Zzz... five more minutes..."],
      "live.fed": "{name} ate",
      "live.pat": "{name} was patted",
      "live.sleep": "{name} went to sleep",
      "live.wake": "{name} woke up",
      "toast.notSleepy": "{name} is not sleepy yet",
      "toast.renamed": "Now called {name}",
      "toast.companionOn": "{name} is on the desktop too",
      "toast.companionOff": "{name} lives only in the forest now",
      "toast.save": "Could not save: storage is full",
      "toast.fresh": "A fresh start in the forest",
      "rename.title": "Name",
      "rename.ok": "Save", "rename.cancel": "Cancel",
      "friend.title": "A new friend",
      "friend.msg": "{name} lives in the forest now. Keep the forest as it is (nest, garden, backpack, progress) or start fresh?",
      "friend.keep": "Keep the forest",
      "friend.fresh": "Start fresh",
      "offline": "Pet World lives inside orOS. Open it from the orOS menu."
    },
    el: {
      "age.one": "{n} ημέρα μαζί σου",
      "age.many": "{n} ημέρες μαζί σου",
      "stat.food": "Φαγητό", "stat.happy": "Διάθεση", "stat.energy": "Ενέργεια",
      "act.feed": "Τάισμα", "act.pat": "Χάδι", "act.sleep": "Ύπνος", "act.wake": "Ξύπνα",
      "key.feed": "Τάισμα (F)", "key.pat": "Χάδι (P)", "key.sleep": "Ύπνος (S)", "key.wake": "Ξύπνα (S)",
      "btn.rename": "Μετονομασία: {name}",
      "btn.companionOn": "Φαίνεται και στην επιφάνεια εργασίας (πάτα για απόκρυψη)",
      "btn.companionOff": "Δεν φαίνεται στην επιφάνεια εργασίας (πάτα για εμφάνιση)",
      "scene.awake": "{name} στο δάσος, {when}. Πάτα πάνω του για χάδι ή στο έδαφος για να έρθει.",
      "scene.asleep": "{name} κοιμάται κάτω από τη γέρικη βελανιδιά, {when}.",
      "when.night": "νύχτα", "when.dawn": "χαράματα", "when.day": "μέρα", "when.dusk": "σούρουπο",
      "say.asleep": ["Zzz...", "Σςς... κοιμάμαι", "Zzz... πέντε λεπτά ακόμα..."],
      "live.fed": "{name}: έφαγε",
      "live.pat": "{name}: πήρε χάδια",
      "live.sleep": "{name}: πήγε για ύπνο",
      "live.wake": "{name}: ξύπνησε",
      "toast.notSleepy": "{name}: δεν νυστάζει ακόμα",
      "toast.renamed": "Νέο όνομα: {name}",
      "toast.companionOn": "{name}: και στην επιφάνεια εργασίας",
      "toast.companionOff": "{name}: ζει πια μόνο στο δάσος",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "toast.fresh": "Νέα αρχή στο δάσος",
      "rename.title": "Όνομα",
      "rename.ok": "Αποθήκευση", "rename.cancel": "Άκυρο",
      "friend.title": "Νέος φίλος",
      "friend.msg": "{name}: ζει πια στο δάσος. Κρατάς το δάσος όπως είναι (φωλιά, κήπο, σακίδιο, πρόοδο) ή ξεκινάς από την αρχή;",
      "friend.keep": "Κράτα το δάσος",
      "friend.fresh": "Από την αρχή",
      "offline": "Ο κόσμος του κατοικιδίου ζει μέσα στο orOS. Άνοιξέ τον από το μενού του orOS."
    }
  };

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var v = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (typeof v === "string" && params) {
      Object.keys(params).forEach(function (k) { v = v.split("{" + k + "}").join(String(params[k])); });
    }
    return v;
  }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function $(id) { return document.getElementById(id); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function reducedMotion() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch (e) { return false; }
  }

  // ---------- 2. World data ----------
  function cmpStr(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }
  function isCount(n) { return typeof n === "number" && isFinite(n) && n >= 0 && Math.floor(n) === n && n <= MAX_N; }
  function isTs(n) { return typeof n === "number" && isFinite(n) && n >= 0 && Math.floor(n) === n; }

  function normPet(p) {
    if (!p || typeof p !== "object" || typeof p.id !== "string" || !ID_RE.test(p.id) || !isTs(p.ts)) return null;
    return { id: p.id, ts: p.ts };
  }

  // A row: { b: epoch, c: { item: [in, out] } }. Unknown item ids are
  // KEPT when well-formed (a newer version's items must survive an
  // older device's merge, or two versions would re-upload forever);
  // the UI only ever shows the items it knows.
  function normRow(r) {
    if (!r || typeof r !== "object" || !isTs(r.b)) return null;
    var src = (r.c && typeof r.c === "object") ? r.c : {};
    var c = {}, n = 0;
    Object.keys(src).filter(function (k) { return ITEM_RE.test(k); }).sort(cmpStr).forEach(function (k) {
      var v = src[k];
      if (n >= MAX_ITEMS || !Array.isArray(v) || v.length !== 2 || !isCount(v[0]) || !isCount(v[1])) return;
      c[k] = [v[0], v[1]];
      n++;
    });
    return { b: r.b, c: c };
  }

  function joinRows(x, y) {
    if (!x) return y;
    if (!y) return x;
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var c = {};
    Object.keys(x.c).concat(Object.keys(y.c)).forEach(function (k) {
      var a = x.c[k] || [0, 0], b = y.c[k] || [0, 0];
      c[k] = [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    });
    return normRow({ b: x.b, c: c });
  }

  function mergeWorld(A, B) {
    var a = (A && typeof A === "object") ? A : {};
    var b = (B && typeof B === "object") ? B : {};
    var br = Math.max(isTs(a.br) ? a.br : 0, isTs(b.br) ? b.br : 0);

    var pa = normPet(a.pet), pb = normPet(b.pet), pet = pa || pb;
    if (pa && pb && pa !== pb) {
      if (pa.ts !== pb.ts) pet = pa.ts > pb.ts ? pa : pb;
      else pet = cmpStr(pa.id, pb.id) >= 0 ? pa : pb;
    }

    var rows = {};
    [a.rows, b.rows].forEach(function (src) {
      if (!src || typeof src !== "object") return;
      Object.keys(src).forEach(function (dev) {
        if (!ID_RE.test(dev)) return;
        var r = normRow(src[dev]);
        if (!r || r.b < br) return;
        rows[dev] = joinRows(rows[dev] || null, r);
      });
    });
    var sorted = {};
    Object.keys(rows).sort(cmpStr).forEach(function (dev) { sorted[dev] = rows[dev]; });
    return { ver: DATA_VER, br: br, pet: pet, rows: sorted };
  }

  function defaultData() { return { ver: DATA_VER, br: 0, pet: null, rows: {} }; }

  // Balance of one item across every device row.
  function itemCount(d, item) {
    var n = 0;
    Object.keys(d.rows || {}).forEach(function (dev) {
      var c = d.rows[dev].c[item];
      if (c) n += c[0] - c[1];
    });
    return Math.max(0, n);
  }

  // Anything in the forest worth asking about before a fresh start.
  function worldHasContent(d) {
    return Object.keys(d.rows || {}).some(function (dev) {
      var c = d.rows[dev].c;
      return Object.keys(c).some(function (k) { return c[k][0] > 0 || c[k][1] > 0; });
    });
  }

  // A ledger move on THIS device's row (later phases: harvests,
  // purchases). The row's epoch is never older than the reset stamp.
  function ledger(d, dev, item, nIn, nOut) {
    if (!ITEM_RE.test(item)) return d;
    var row = d.rows[dev] && d.rows[dev].b >= d.br ? d.rows[dev] : { b: d.br, c: {} };
    var cur = row.c[item] || [0, 0];
    var next = { b: row.b, c: {} };
    Object.keys(row.c).forEach(function (k) { next.c[k] = row.c[k].slice(); });
    next.c[item] = [Math.min(MAX_N, cur[0] + (nIn | 0)), Math.min(MAX_N, cur[1] + (nOut | 0))];
    var rows = {};
    Object.keys(d.rows).forEach(function (k) { rows[k] = d.rows[k]; });
    rows[dev] = next;
    return mergeWorld({ ver: DATA_VER, br: d.br, pet: d.pet, rows: rows }, null);
  }

  // A fresh start: every row older than the new stamp drops on every
  // device; the forest is bound to the given pet.
  function freshStart(d, petId, now) {
    var br = Math.max(now, d.br + 1);
    return mergeWorld({ ver: DATA_VER, br: br, pet: { id: petId, ts: br }, rows: d.rows }, null);
  }

  function bindPet(d, petId, now) {
    return mergeWorld({ ver: DATA_VER, br: d.br, pet: { id: petId, ts: Math.max(now, d.pet ? d.pet.ts + 1 : 0) }, rows: d.rows }, null);
  }

  var data = defaultData();

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") { data = mergeWorld(parsed, null); return; }
      } catch (e) {}
      // unreadable → device-local rescue copy BEFORE the fresh state
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] petworld: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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

  function deviceId() {
    var id = null;
    try { id = localStorage.getItem(DEVICE_KEY); } catch (e) {}
    if (!id || !ID_RE.test(id)) {
      id = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem(DEVICE_KEY, id); } catch (e) {}
    }
    return id;
  }

  // ---------- 3. Bridge to the shell pet ----------
  function bridge() {
    try {
      var p = window.parent && window.parent !== window ? window.parent.orosPet : null;
      return (p && typeof p.snapshot === "function") ? p : null;
    } catch (e) { return null; }
  }

  var snap = null;          // last snapshot (plain JSON from the shell)
  function refreshSnap() {
    var b = bridge();
    if (!b) { snap = null; return null; }
    try { snap = b.snapshot(); } catch (e) { snap = null; }
    return snap;
  }

  var spriteCache = {};
  function spriteFor(pose) {
    var key = [pose.mood, pose.mode, pose.legPhase, pose.dir, pose.contemplating ? 1 : 0,
               pose.eatT < 0 ? -1 : Math.round(pose.eatT * 10)].join("|");
    if (spriteCache[key]) return spriteCache[key];
    var b = bridge(), g = null;
    try { g = b ? b.sprite(pose) : null; } catch (e) { g = null; }
    if (!Array.isArray(g)) return null;
    spriteCache[key] = g;
    return g;
  }

  // ---------- 4. Scene ----------
  var canvas, ctx, bg, bgCtx;
  var W = 0, H = 0, DPR = 1, U = 6, groundY = 0, oakX = 0, sleepX = 0;
  var bgStamp = "";

  function mulberry(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var r = Math.imul(seed ^ seed >>> 15, 1 | seed);
      r = r + Math.imul(r ^ r >>> 7, 61 | r) ^ r;
      return ((r ^ r >>> 14) >>> 0) / 4294967296;
    };
  }

  function hex(c) {
    var n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgb(a) { return "rgb(" + Math.round(a[0]) + "," + Math.round(a[1]) + "," + Math.round(a[2]) + ")"; }
  function mix(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
  // Night tint: darken and pull towards a deep blue.
  function lit(c, L) {
    var base = hex(c);
    var night = [base[0] * 0.22 + 10, base[1] * 0.26 + 14, base[2] * 0.34 + 34];
    return rgb(mix(night, base, L));
  }

  // Sky keyframes by local hour: [hour, top, bottom, light]
  var SKY = [
    [0,    "#0b1026", "#1c2552", 0.0],
    [5,    "#121a3d", "#2c3466", 0.05],
    [6.5,  "#6a7fc1", "#f7b78a", 0.65],
    [8,    "#5fb0e8", "#c6e8f7", 1.0],
    [17.5, "#5fb0e8", "#c6e8f7", 1.0],
    [19,   "#58507a", "#f08a5d", 0.6],
    [20.5, "#141b40", "#2a3263", 0.08],
    [24,   "#0b1026", "#1c2552", 0.0]
  ];
  function skyAt(h) {
    for (var i = 0; i < SKY.length - 1; i++) {
      var a = SKY[i], b = SKY[i + 1];
      if (h >= a[0] && h <= b[0]) {
        var k = (h - a[0]) / (b[0] - a[0] || 1);
        return { top: mix(hex(a[1]), hex(b[1]), k), bottom: mix(hex(a[2]), hex(b[2]), k), light: a[3] + (b[3] - a[3]) * k };
      }
    }
    return { top: hex(SKY[0][1]), bottom: hex(SKY[0][2]), light: 0 };
  }
  function hourNow() {
    var d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  }
  function whenKey(h) {
    if (h >= 5 && h < 8) return "when.dawn";
    if (h >= 8 && h < 18) return "when.day";
    if (h >= 18 && h < 20.5) return "when.dusk";
    return "when.night";
  }

  function layout() {
    var wrap = $("scene-wrap");
    W = Math.max(1, wrap.clientWidth);
    H = Math.max(1, wrap.clientHeight);
    DPR = Math.min(2, window.devicePixelRatio || 1);
    U = clamp(Math.floor(Math.min(H / 62, W / 40)), 3, 8);
    groundY = Math.round(H - Math.max(10 * U, H * 0.2));
    oakX = Math.round(clamp(W * 0.2, 9 * U, W * 0.35));
    sleepX = oakX + 6 * U;
    [canvas, bg].forEach(function (c) {
      c.width = Math.round(W * DPR);
      c.height = Math.round(H * DPR);
    });
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    bgCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = false;
    bgCtx.imageSmoothingEnabled = false;
    bgStamp = "";
    pet.x = clamp(pet.x || W * 0.55, minX(), maxX());
  }
  function minX() { return 2 * U; }
  function maxX() { return Math.max(minX(), W - 18 * U); }

  // Everything that does not move, drawn once per resize and once
  // every five minutes (the light follows the clock).
  function paintBackground() {
    var h = hourNow();
    var stamp = W + "x" + H + "@" + Math.floor(h * 12);
    if (stamp === bgStamp) return;
    bgStamp = stamp;
    var sky = skyAt(h), L = sky.light, g = bgCtx;
    var rnd = mulberry(7);

    // Sky in pixel bands
    var bands = Math.max(1, Math.ceil(groundY / (2 * U)));
    for (var i = 0; i < bands; i++) {
      g.fillStyle = rgb(mix(sky.top, sky.bottom, i / bands));
      g.fillRect(0, i * 2 * U, W, 2 * U + 1);
    }

    // Stars (night) — fixed places, faint at dawn/dusk
    if (L < 0.6) {
      g.fillStyle = "rgba(255,250,225," + clamp((0.6 - L) / 0.5, 0, 1) + ")";
      for (var s = 0; s < 70; s++) {
        var sx = Math.floor(rnd() * W / U) * U, sy = Math.floor(rnd() * groundY * 0.6 / U) * U;
        g.fillRect(sx, sy, U * (rnd() < 0.15 ? 1 : 0.5), U * (rnd() < 0.15 ? 1 : 0.5));
      }
    } else { for (var s2 = 0; s2 < 210; s2++) rnd(); }

    // Sun 6:00→20:00, moon 19:00→7:00, along an arc
    var arc = function (k) { return { x: W * (0.08 + 0.84 * k), y: groundY * (0.62 - 0.5 * Math.sin(Math.PI * k)) }; };
    if (h >= 6 && h <= 20) {
      var sp = arc((h - 6) / 14);
      pixelDisc(g, sp.x, sp.y, 4, "#ffe58a");
      pixelDisc(g, sp.x, sp.y, 3, "#fff3b8");
    }
    if (h >= 19 || h <= 7) {
      var mp = arc(((h + 24 - 19) % 24) / 12);
      pixelDisc(g, mp.x, mp.y, 3, "#f3f0dc");
      pixelDisc(g, mp.x + U, mp.y - U, 2, rgb(mix(sky.top, sky.bottom, 0.3)));
    }

    // Far hills, then a back row of pines
    hills(g, groundY - 16 * U, 5 * U, 0.004, 1.3, lit("#5f8f74", L));
    hills(g, groundY - 9 * U, 3 * U, 0.009, 4.1, lit("#4d7d5e", L));
    var x = -4 * U;
    while (x < W + 4 * U) {
      var th = (12 + Math.floor(rnd() * 10)) * U;
      pine(g, x, groundY - 2 * U, th, lit("#2f5d45", L), lit("#3b7052", L));
      x += (9 + Math.floor(rnd() * 8)) * U;
    }

    // The old oak (home; the nest will be built here)
    oak(g, oakX, groundY, L);

    // Ground: grass band, soil, pebbles, tufts and a few flowers
    g.fillStyle = lit("#6dbb5c", L);
    g.fillRect(0, groundY, W, 3 * U);
    g.fillStyle = lit("#58a34b", L);
    g.fillRect(0, groundY + 3 * U, W, U);
    g.fillStyle = lit("#7b5a3a", L);
    g.fillRect(0, groundY + 4 * U, W, H - groundY - 4 * U);
    for (var p = 0; p < W / (5 * U); p++) {
      g.fillStyle = lit(rnd() < 0.5 ? "#8e6b48" : "#694a2e", L);
      g.fillRect(Math.floor(rnd() * W / U) * U, groundY + (5 + Math.floor(rnd() * Math.max(1, (H - groundY) / U - 6))) * U, U, U);
    }
    for (var q = 0; q < W / (3 * U); q++) {
      var tx = Math.floor(rnd() * W / U) * U;
      g.fillStyle = lit(rnd() < 0.5 ? "#8fd16f" : "#4f9a43", L);
      g.fillRect(tx, groundY - U, U, U);
      if (rnd() < 0.4) g.fillRect(tx + U, groundY - 2 * U, U, 2 * U);
    }
    var flowers = ["#f48fb1", "#fff176", "#ffffff", "#b39ddb"];
    for (var f = 0; f < W / (24 * U); f++) {
      var fx = Math.floor(rnd() * W / U) * U;
      g.fillStyle = lit("#4f9a43", L);
      g.fillRect(fx, groundY - 2 * U, U, 2 * U);
      g.fillStyle = lit(flowers[Math.floor(rnd() * flowers.length)], L);
      g.fillRect(fx - U, groundY - 3 * U, 3 * U, U);
      g.fillRect(fx, groundY - 4 * U, U, 3 * U);
      g.fillStyle = lit("#ffb74d", L);
      g.fillRect(fx, groundY - 3 * U, U, U);
    }
  }

  function pixelDisc(g, cx, cy, r, color) {
    g.fillStyle = color;
    for (var j = -r; j <= r; j++) {
      var half = Math.floor(Math.sqrt(r * r - j * j + r * 0.6));
      g.fillRect(Math.round(cx / U) * U - half * U, Math.round(cy / U) * U + j * U, (2 * half + 1) * U, U);
    }
  }

  function hills(g, base, amp, freq, phase, color) {
    g.fillStyle = color;
    for (var x = 0; x < W; x += U) {
      var y = base - amp * (0.6 * Math.sin(x * freq + phase) + 0.4 * Math.sin(x * freq * 2.7 + phase * 2));
      y = Math.round(y / U) * U;
      g.fillRect(x, y, U, groundY - y + U);
    }
  }

  function pine(g, x, baseY, height, dark, light) {
    var rows = Math.floor(height / U), w;
    g.fillStyle = dark;
    g.fillRect(x - U, baseY - 2 * U, 2 * U, 2 * U);
    for (var r = 0; r < rows - 2; r++) {
      w = Math.max(1, Math.floor((r % 4 + 1 + r / 3) * 0.9));
      var y = baseY - height + r * U;
      g.fillStyle = dark;
      g.fillRect(x - w * U, y, 2 * w * U, U);
      g.fillStyle = light;
      g.fillRect(x - w * U, y, U, U);
    }
  }

  function oak(g, x, baseY, L) {
    var trunk = lit("#6b4a2f", L), bark = lit("#563a24", L);
    g.fillStyle = trunk;
    g.fillRect(x - 2 * U, baseY - 18 * U, 5 * U, 18 * U);
    g.fillRect(x - 4 * U, baseY - 2 * U, 9 * U, 2 * U);
    g.fillStyle = bark;
    g.fillRect(x, baseY - 14 * U, U, 5 * U);
    g.fillRect(x - U, baseY - 7 * U, U, 3 * U);
    var crowns = [[0, -24, 9], [-7, -20, 6], [8, -21, 7], [-2, -30, 6], [5, -28, 5]];
    crowns.forEach(function (c) { pixelDisc(g, x + c[0] * U, baseY + c[1] * U, c[2], lit("#3f7d4a", L)); });
    crowns.forEach(function (c) { pixelDisc(g, x + (c[0] - 2) * U, baseY + (c[1] - 2) * U, Math.max(1, c[2] - 4), lit("#5aa05c", L)); });
    // a mossy bed at the roots: the sleeping spot (the nest comes here)
    g.fillStyle = lit("#4f7d3b", L);
    g.fillRect(x + 4 * U, baseY - U, 11 * U, U);
    g.fillRect(x + 5 * U, baseY - 2 * U, 9 * U, U);
    g.fillStyle = lit("#7fb069", L);
    g.fillRect(x + 6 * U, baseY - 2 * U, 2 * U, U);
    g.fillRect(x + 10 * U, baseY - 2 * U, 3 * U, U);
  }

  // ---------- 5. Pet choreography + particles ----------
  var WALK_UPS = 7;          // walking speed in pixel units per second
  var pet = { x: 0, dir: 1, mode: "idle", timer: 1500, target: null, frame: 0, eatAt: 0 };
  var particles = [];        // hearts / leaves / fireflies
  var warned = { food: false, happy: false, energy: false };

  function petWidth() { return 16 * U; }
  function petY() { return groundY + 2 * U - petWidth(); }

  function walkTo(x) {
    pet.target = clamp(x, minX(), maxX());
    pet.mode = "walk";
  }

  function updatePet(dt) {
    if (!snap) return;
    pet.frame++;
    var asleep = snap.asleep;
    if (pet.mode === "eat" || pet.mode === "happy") {
      pet.timer -= dt * 1000;
      if (pet.timer <= 0) { pet.mode = "idle"; pet.timer = 1500 + Math.random() * 2500; }
      return;
    }
    if (asleep) {
      // A sleeping pet belongs in the hollow under the oak.
      if (Math.abs(pet.x - sleepX) > U) { pet.target = sleepX; pet.mode = "walk"; }
      else { pet.x = sleepX; pet.mode = "idle"; pet.target = null; return; }
    }
    if (pet.mode === "walk" && pet.target !== null) {
      var d = pet.target - pet.x, step = WALK_UPS * U * dt * (asleep ? 0.6 : 1);
      pet.dir = d >= 0 ? 1 : -1;
      if (Math.abs(d) <= step) {
        pet.x = pet.target; pet.target = null; pet.mode = "idle";
        pet.timer = 1500 + Math.random() * 3500;
      } else pet.x += pet.dir * step;
      return;
    }
    pet.timer -= dt * 1000;
    if (pet.timer <= 0) {
      if (Math.random() < 0.65) walkTo(pet.x + (Math.random() * 2 - 1) * W * 0.4);
      else { pet.dir = -pet.dir; pet.timer = 1200 + Math.random() * 2500; }
    }
  }

  function poseNow() {
    var asleep = snap && snap.asleep;
    var walking = pet.mode === "walk";
    return {
      mood: asleep ? (walking ? "tired" : "sleep") : (snap ? snap.mood : "neutral"),
      mode: walking ? "walk" : pet.mode,
      legPhase: walking ? Math.floor(pet.frame / 6) % 2 : 0,
      dir: pet.dir,
      frame: pet.frame,
      eatT: pet.mode === "eat" ? (Date.now() - pet.eatAt) / 900 : -1,
      contemplating: false
    };
  }

  function addHearts() {
    if (reducedMotion()) return;
    for (var i = 0; i < 4; i++) {
      particles.push({ k: "heart", x: pet.x + petWidth() / 2 + (Math.random() * 2 - 1) * 4 * U,
                       y: petY(), vy: -(3 + Math.random() * 2) * U, life: 1.4 + i * 0.15 });
    }
  }

  function ambient(dt) {
    if (reducedMotion()) { particles = particles.filter(function (p) { return p.k === "heart"; }); return; }
    var L = skyAt(hourNow()).light;
    var flies = 0, leaves = 0;
    particles.forEach(function (p) { if (p.k === "fly") flies++; if (p.k === "leaf") leaves++; });
    if (L < 0.4 && flies < 7 && Math.random() < dt * 2) {
      particles.push({ k: "fly", x: Math.random() * W, y: groundY - (3 + Math.random() * 18) * U,
                       ph: Math.random() * 6.28, life: 6 + Math.random() * 6 });
    }
    if (L >= 0.4 && leaves < 3 && Math.random() < dt * 0.4) {
      particles.push({ k: "leaf", x: oakX + (Math.random() * 2 - 1) * 9 * U, y: groundY - 30 * U,
                       ph: Math.random() * 6.28, life: 9 });
    }
  }

  function stepParticles(dt) {
    particles.forEach(function (p) {
      p.life -= dt;
      if (p.k === "heart") { p.y += p.vy * dt; }
      else if (p.k === "fly") { p.ph += dt * 1.5; p.x += Math.cos(p.ph) * U * dt * 3; p.y += Math.sin(p.ph * 1.3) * U * dt * 2; }
      else if (p.k === "leaf") {
        p.ph += dt * 2; p.x += Math.sin(p.ph) * U * dt * 4; p.y += U * dt * 3;
        if (p.y > groundY + U) p.life = Math.min(p.life, 0.6);
      }
    });
    particles = particles.filter(function (p) { return p.life > 0; });
  }

  var HEART = ["0110110", "1111111", "1111111", "0111110", "0011100", "0001000"];
  function drawParticles() {
    particles.forEach(function (p) {
      var a = clamp(p.life, 0, 1);
      if (p.k === "heart") {
        ctx.fillStyle = "rgba(240,98,146," + a + ")";
        var s = Math.max(1, Math.round(U * 0.6));
        HEART.forEach(function (row, j) {
          for (var i = 0; i < row.length; i++) if (row[i] === "1") ctx.fillRect(Math.round(p.x) + i * s, Math.round(p.y) + j * s, s, s);
        });
      } else if (p.k === "fly") {
        var on = 0.5 + 0.5 * Math.sin(p.ph * 3);
        ctx.fillStyle = "rgba(255,241,118," + (a * on) + ")";
        ctx.fillRect(Math.round(p.x / U) * U, Math.round(p.y / U) * U, U, U);
      } else if (p.k === "leaf") {
        ctx.fillStyle = "rgba(205,140,60," + a + ")";
        ctx.fillRect(Math.round(p.x / U) * U, Math.round(p.y / U) * U, U * 2, U);
      }
    });
  }

  function drawPet() {
    var grid = spriteFor(poseNow());
    if (!grid || !snap) return;
    var colors = snap.colors || {};
    var x0 = Math.round(pet.x), y0 = petY(), sleeping = snap.asleep && pet.mode !== "walk";
    var bob = 0;
    if (pet.mode === "walk") bob = (Math.floor(pet.frame / 6) % 2) * Math.round(U * 0.4);
    else if (pet.mode === "happy" && !reducedMotion()) bob = (Math.floor(pet.frame / 4) % 2) === 0 ? -U : 0;
    else if (sleeping) bob = Math.round(U * 0.8);
    // soft shadow
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(x0 + 3 * U, groundY + U, 10 * U, U);
    for (var j = 0; j < 16; j++) {
      for (var i = 0; i < 16; i++) {
        var v = grid[j] && grid[j][i];
        if (!v || !colors[v]) continue;
        var col = pet.dir === 1 ? i : 15 - i;
        ctx.fillStyle = colors[v];
        ctx.fillRect(x0 + col * U, y0 + bob + j * U, U, U);
      }
    }
  }

  // ---------- 6. Render loop ----------
  var rafId = 0, lastTs = 0;
  function frame(ts) {
    rafId = 0;
    if (document.visibilityState === "hidden") return;
    var dt = Math.min(0.05, ((ts - lastTs) / 1000) || 0.016);
    lastTs = ts;
    paintBackground();
    updatePet(dt);
    ambient(dt);
    stepParticles(dt);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bg, 0, 0, W, H);
    drawPet();
    drawParticles();
    placeBubble();
    rafId = requestAnimationFrame(frame);
  }
  function startLoop() {
    if (!rafId && document.visibilityState !== "hidden") {
      lastTs = performance.now();
      rafId = requestAnimationFrame(frame);
    }
  }

  // ---------- 7. UI ----------
  var ICONS = {
    food:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11h18a9 9 0 0 1-18 0z"/><path d="M8 7c0-1.5 1-2 1-3.5M12 7c0-1.5 1-2 1-3.5M16 7c0-1.5 1-2 1-3.5"/></svg>',
    happy:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
    energy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
    pat:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12"/><path d="M11 11.5v-2a1.5 1.5 0 0 1 3 0V12"/><path d="M14 10.5a1.5 1.5 0 0 1 3 0V12"/><path d="M17 11.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L4.3 14a1.5 1.5 0 0 1 2.4-1.8L8 14"/></svg>',
    sleep:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
    wake:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    companion: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M8 20.5h8M12 16.5v4"/><path d="M9 13v-2.5a3 3 0 0 1 6 0V13zM10 8.5 9.5 7M14 8.5l.5-1.5"/></svg>'
  };

  function paintStatic() {
    [["stat-food", "food"], ["stat-happy", "happy"], ["stat-energy", "energy"]].forEach(function (s) {
      $(s[0]).querySelector(".stat-ico").innerHTML = ICONS[s[1]];
      $(s[0]).setAttribute("role", "meter");
      $(s[0]).setAttribute("aria-valuemin", "0");
      $(s[0]).setAttribute("aria-valuemax", "100");
      $(s[0]).setAttribute("aria-label", t("stat." + s[1]));
      $(s[0]).title = t("stat." + s[1]);
    });
    $("feed-btn").querySelector(".act-ico").innerHTML = ICONS.food;
    $("feed-btn").querySelector(".act-lbl").textContent = t("act.feed");
    $("feed-btn").title = t("key.feed");
    $("pat-btn").querySelector(".act-ico").innerHTML = ICONS.pat;
    $("pat-btn").querySelector(".act-lbl").textContent = t("act.pat");
    $("pat-btn").title = t("key.pat");
    $("companion-btn").innerHTML = ICONS.companion;
  }

  var lastSleepIcon = null;
  function renderUI() {
    var b = bridge();
    $("offline").hidden = !!b;
    $("actions").hidden = !b;
    $("stats").hidden = !b;
    if (!b || !snap) {
      $("offline").textContent = t("offline");
      $("pet-name").textContent = "orOS";
      $("pet-age").textContent = "";
      $("name-btn").disabled = true;
      $("companion-btn").hidden = true;
      return;
    }
    $("name-btn").disabled = false;
    $("pet-name").textContent = snap.name;
    $("pet-age").textContent = t(snap.ageDays === 1 ? "age.one" : "age.many", { n: snap.ageDays });
    $("name-btn").setAttribute("aria-label", t("btn.rename", { name: snap.name }));
    $("name-btn").title = t("btn.rename", { name: snap.name });

    [["stat-food", snap.food], ["stat-happy", snap.happy], ["stat-energy", snap.energy]].forEach(function (s) {
      var v = Math.round(clamp(s[1], 0, 100)), box = $(s[0]);
      box.querySelector(".stat-fill").style.width = v + "%";
      box.querySelector(".stat-num").textContent = String(v);
      box.setAttribute("aria-valuenow", String(v));
      box.classList.toggle("low", v < 25);
    });

    var sb = $("sleep-btn"), asleep = !!snap.asleep;
    if (lastSleepIcon !== asleep) {
      lastSleepIcon = asleep;
      sb.querySelector(".act-ico").innerHTML = asleep ? ICONS.wake : ICONS.sleep;
    }
    sb.querySelector(".act-lbl").textContent = t(asleep ? "act.wake" : "act.sleep");
    sb.title = t(asleep ? "key.wake" : "key.sleep");

    var cb = $("companion-btn"), on = false;
    try { on = !!b.isEnabled(); } catch (e) {}
    cb.hidden = false;
    cb.setAttribute("aria-pressed", on ? "true" : "false");
    cb.setAttribute("aria-label", t(on ? "btn.companionOn" : "btn.companionOff"));
    cb.title = t(on ? "btn.companionOn" : "btn.companionOff");

    var when = t(whenKey(hourNow()));
    canvas.setAttribute("aria-label", t(asleep ? "scene.asleep" : "scene.awake", { name: snap.name, when: when }));
  }

  // Low-stat lines, once per crossing (the companion's thresholds).
  function checkWarnings() {
    if (!snap || snap.asleep) return;
    var b = bridge();
    if (!b) return;
    [["food", "speech.hungry", 20, 35], ["happy", "speech.bored", 25, 35], ["energy", "speech.tired", 20, 35]].forEach(function (w) {
      var v = snap[w[0]];
      if (v < w[2] && !warned[w[0]]) { warned[w[0]] = true; say(b.line(w[1])); }
      if (v >= w[3]) warned[w[0]] = false;
    });
  }

  var bubbleTimer = null, bubbleOn = false;
  function say(text) {
    if (!text) return;
    var bb = $("bubble");
    bb.textContent = text;
    bubbleOn = true;
    placeBubble();
    bb.classList.add("show");
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(function () { bb.classList.remove("show"); bubbleOn = false; }, 2800);
  }
  function placeBubble() {
    if (!bubbleOn) return;
    var bb = $("bubble");
    var bw = bb.offsetWidth, bh = bb.offsetHeight;
    var x = clamp(pet.x + petWidth() / 2 - bw / 2, 8, Math.max(8, W - bw - 8));
    var y = Math.max(8, petY() - bh - U);
    bb.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
  }

  function announce(text) { $("live").textContent = text; }

  // ---------- Care actions (all through the shell pet) ----------
  function doFeed() {
    var b = bridge();
    if (!b) return;
    var wasAsleep = snap && snap.asleep;
    try { snap = b.feed(); } catch (e) { return; }
    pet.mode = "eat"; pet.timer = 2400; pet.eatAt = Date.now(); pet.target = null;
    say(b.line(wasAsleep ? "speech.wake" : "speech.eat"));
    announce(t("live.fed", { name: snap.name }));
    renderUI();
  }
  function doPat() {
    var b = bridge();
    if (!b || !snap) return;
    if (snap.asleep) { say(pick(t("say.asleep"))); return; }
    try { snap = b.pat(); } catch (e) { return; }
    pet.mode = "happy"; pet.timer = 2200; pet.target = null;
    addHearts();
    say(b.line("speech.happy"));
    announce(t("live.pat", { name: snap.name }));
    renderUI();
  }
  function doSleep() {
    var b = bridge();
    if (!b || !snap) return;
    // R28: a rested pet would wake again at once (pet.js auto-wake);
    // say so instead of a "good night" that undoes itself.
    if (!snap.asleep && snap.energy >= WAKE_AT) {
      showToast(t("toast.notSleepy", { name: snap.name }));
      return;
    }
    var wasAsleep = snap.asleep;
    try { snap = b.sleepToggle(); } catch (e) { return; }
    pet.mode = "idle"; pet.timer = 1500;
    say(b.line(wasAsleep ? "speech.wake" : "speech.sleep"));
    announce(t(wasAsleep ? "live.wake" : "live.sleep", { name: snap.name }));
    renderUI();
  }
  function toggleCompanion() {
    var b = bridge();
    if (!b || !snap) return;
    try { b.toggle(); } catch (e) { return; }
    var on = false;
    try { on = !!b.isEnabled(); } catch (e) {}
    showToast(t(on ? "toast.companionOn" : "toast.companionOff", { name: snap.name }));
    renderUI();
  }

  function sceneTap(e) {
    if (!snap) return;
    var r = canvas.getBoundingClientRect();
    var x = e.clientX - r.left, y = e.clientY - r.top;
    var px = pet.x, py = petY();
    if (x >= px - U && x <= px + petWidth() + U && y >= py - U && y <= py + petWidth() + 2 * U) { doPat(); return; }
    if (snap.asleep) { say(pick(t("say.asleep"))); return; }
    if (pet.mode === "eat" || pet.mode === "happy") return;
    walkTo(x - petWidth() / 2);
  }

  // ---------- 8. Dialogs ----------
  function makeDialog(id) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "pw-dlg";
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () {
      parkToast();
      setTimeout(function () { dlg.remove(); }, 0);
    });
    return dlg;
  }
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  function renameDialog() {
    var b = bridge();
    if (!b || !snap) return;
    var dlg = makeDialog("pw-rename");
    dlg.appendChild(el("div", "dlg-title", t("rename.title")));
    var form = document.createElement("form");
    form.method = "dialog";
    var inp = el("input", "dlg-input");
    inp.type = "text";
    inp.maxLength = NAME_MAX;
    inp.value = snap.name;
    inp.setAttribute("aria-label", t("rename.title"));
    inp.autocomplete = "off";
    form.appendChild(inp);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("rename.cancel"), "", function () { dlg.close(); }));
    var ok = el("button", "dlg-btn primary", t("rename.ok"));
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = String(inp.value || "").trim().slice(0, NAME_MAX);
      dlg.close();
      if (!name || name === snap.name) return;
      try { snap = b.rename(name); } catch (err) { return; }
      showToast(t("toast.renamed", { name: snap.name }));
      renderUI();
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    inp.focus();
    inp.select();
  }

  // A new pet arrived (here or on another device) while the forest
  // holds something: ask every time (Chris, 2026-10-08). Closing the
  // dialog without a choice asks again at the next visit.
  var askingFriend = false, friendAsked = null;
  function friendDialog(petId) {
    if (askingFriend || friendAsked === petId || document.querySelector("dialog[open]")) return;
    askingFriend = true;
    friendAsked = petId;      // once per pet per visit; the next visit asks again
    var dlg = makeDialog("pw-friend");
    dlg.addEventListener("close", function () { askingFriend = false; });
    dlg.appendChild(el("div", "dlg-title", t("friend.title")));
    dlg.appendChild(el("div", "dlg-msg", t("friend.msg", { name: snap.name })));
    var acts = el("div", "dlg-actions stack");
    var keep = button(t("friend.keep"), "primary", function () {
      dlg.close();
      data = bindPet(data, petId, Date.now());
      save();
    });
    acts.appendChild(keep);
    acts.appendChild(button(t("friend.fresh"), "danger", function () {
      dlg.close();
      data = freshStart(data, petId, Date.now());
      save();
      showToast(t("toast.fresh"));
    }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    keep.focus();
  }

  // The forest follows the pet it belongs to. A provisional pet (a
  // fresh device before its first sync) is never bound: the real one
  // may still arrive.
  function checkBinding() {
    if (!snap || snap.provisional) return;
    if (data.pet && data.pet.id === snap.id) return;
    if (!data.pet || !worldHasContent(data)) {
      data = bindPet(data, snap.id, Date.now());
      save();
      return;
    }
    friendDialog(snap.id);
  }

  // ---------- 9. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "petworld", title: String(text) })) return;
    } catch (e) {}
    localToast(text);
  }
  var toastTimer = null;
  function localToast(text) {
    var box = $("toast");
    if (!box) return;
    hostToast();
    box.textContent = text;
    box.classList.remove("show");
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, 4000);
  }
  function hostToast() {
    var box = $("toast"), d = document.querySelector("dialog[open]");
    if (box && d && box.parentNode !== d) d.appendChild(box);
  }
  function parkToast() {
    var box = $("toast");
    if (box && box.parentNode !== document.body) document.body.appendChild(box);
  }

  // ---------- 10. Keyboard ----------
  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;   // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "KeyF") { e.preventDefault(); doFeed(); }
      else if (e.code === "KeyP") { e.preventDefault(); doPat(); }
      else if (e.code === "KeyS") { e.preventDefault(); doSleep(); }
      else if (e.key === "ArrowLeft" && snap && !snap.asleep) { e.preventDefault(); walkTo(pet.x - 8 * U); }
      else if (e.key === "ArrowRight" && snap && !snap.asleep) { e.preventDefault(); walkTo(pet.x + 8 * U); }
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
    api.registerSlice("petworld", sliceGet, sliceSet, STORAGE_KEY, mergeWorld);
  }

  function sliceGet() {
    return mergeWorld(data, null);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object") return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeWorld(incoming, null);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    checkBinding();
  }

  // ---------- 12. Wiring & boot ----------
  function tick() {
    var before = snap ? snap.id : null;
    refreshSnap();
    if (snap && before && snap.id !== before) { spriteCache = {}; warned = { food: false, happy: false, energy: false }; }
    renderUI();
    checkWarnings();
    checkBinding();
  }

  function wire() {
    $("feed-btn").addEventListener("click", doFeed);
    $("pat-btn").addEventListener("click", doPat);
    $("sleep-btn").addEventListener("click", doSleep);
    $("companion-btn").addEventListener("click", toggleCompanion);
    $("name-btn").addEventListener("click", renameDialog);
    canvas.addEventListener("pointerdown", sceneTap);

    // The pet changed elsewhere (companion HUD, another device's sync).
    window.addEventListener("storage", function (e) {
      if (e.key === PET_KEY) tick();
      else if (e.key === "oros-lang") { LANG = appLang(); paintStatic(); tick(); }
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") { tick(); startLoop(); }
    });
    var relayout = function () { layout(); placeBubble(); };
    if (window.ResizeObserver) new ResizeObserver(relayout).observe($("scene-wrap"));
    else window.addEventListener("resize", relayout);
    setInterval(tick, 1000);
    wireKeyboard();
  }

  function boot() {
    canvas = $("scene");
    ctx = canvas.getContext("2d");
    bg = document.createElement("canvas");
    bgCtx = bg.getContext("2d");
    load();
    registerSync();
    inheritPalette();
    watchPalette();
    paintStatic();
    layout();
    refreshSnap();
    if (snap && snap.asleep) pet.x = sleepX;
    wire();
    tick();
    if (snap) setTimeout(function () { var b = bridge(); if (b) say(b.line(snap.asleep ? "speech.sleep" : "speech.hello")); }, 500);
    startLoop();
  }

  boot();
})();
