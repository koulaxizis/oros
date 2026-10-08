// ============================================================
// orOS Pet World — App logic (v1.2.0: foundations, garden, walks + nest)
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
//   - synced slice "petgarden" (oros-petgarden-data, phase 2): the
//     garden beds, see section 2b.
//   - synced slice "petnest" (oros-petnest-data, phase 3): walks and
//     the nest, see section 2c. The companion reads it to show that
//     the pet is out on a walk.
//   - device-local (R10): oros-petworld-device (this device's row id),
//     oros-petworld-walk-seen (the last walk welcomed home here)
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
  var GARDEN_KEY  = "oros-petgarden-data";
  var NEST_KEY    = "oros-petnest-data";
  var SEEN_KEY    = "oros-petworld-walk-seen";  // device-local: the last walk welcomed home here
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
      "offline": "Pet World lives inside orOS. Open it from the orOS menu.",
      "act.garden": "Garden", "act.bag": "Backpack",
      "key.garden": "Garden (G)", "key.bag": "Backpack (B)",
      "item.kibble": "Kibble", "item.carrot": "Carrot", "item.strawberry": "Strawberry",
      "item.mushroom": "Mushroom", "item.apple": "Apple", "item.sunflower": "Sunflower",
      "item.seed_carrot": "Carrot seeds", "item.seed_strawberry": "Strawberry seeds",
      "item.seed_mushroom": "Mushroom spores", "item.seed_sunflower": "Sunflower seeds",
      "item.seed_apple": "Apple pips",
      "fx.kibble": "Fills the tummy", "fx.carrot": "Fills the tummy, some energy",
      "fx.strawberry": "Fills the tummy, lots of joy", "fx.mushroom": "Fills the tummy, joy and energy",
      "fx.apple": "Fills the tummy, energy and joy", "fx.sunflower": "Keep it for the nest",
      "fx.seed": "Plant it in the garden",
      "fx.fav": "Favourite!",
      "count.many": "×{n}", "count.endless": "always",
      "feed.title": "Feed {name}", "feed.btn": "Feed",
      "bag.title": "Backpack", "bag.empty": "The backpack is empty.",
      "garden.title": "Garden", "garden.plot": "Bed {n}",
      "garden.empty": "Empty", "garden.growing": "{crop}: ready in {time}",
      "garden.ready": "{crop}: ready to pick!", "garden.watered": "watered",
      "garden.adult": "{crop} tree: new fruit in {time}",
      "garden.unknown": "A plant from a newer version",
      "garden.plant": "Plant", "garden.water": "Water", "garden.harvest": "Pick",
      "garden.dig": "Dig up", "garden.noSeeds": "No seeds left. Pick ripe plants to get more.",
      "garden.choose": "What to plant in bed {n}?",
      "garden.digConfirm": "Dig up the {crop} in bed {n}? It is gone for good.",
      "garden.digYes": "Dig up", "garden.cancel": "Cancel", "dlg.close": "Close",
      "time.hm": "{h}h {m}m", "time.m": "{m}m", "time.soon": "less than a minute",
      "toast.planted": "{crop} planted in bed {n}",
      "toast.watered": "Bed {n} watered: a quarter faster",
      "toast.harvest": "Picked: {list}",
      "toast.dug": "Bed {n} is empty again",
      "toast.ate": "{name} ate: {food}",
      "toast.noFood": "No {food} left",
      "live.ready": "Ready to pick in bed {n}",
      "act.walk": "Walk", "act.nest": "Nest", "key.walk": "Walk (W)", "key.nest": "Nest (N)",
      "item.twig": "Twig", "item.leaf": "Leaf", "item.moss": "Moss", "item.pebble": "Pebble",
      "item.feather": "Feather", "item.shell": "Snail shell", "item.clover": "Four-leaf clover",
      "fx.material": "For the nest", "fx.find": "A treasure from a walk",
      "walk.title": "A walk in the forest",
      "walk.msg": "Send {name} exploring. Walks bring back twigs, leaves, moss and pebbles for the nest, sometimes seeds.",
      "walk.len": "{m} minutes",
      "walk.15": "A few materials", "walk.30": "More materials, maybe seeds",
      "walk.60": "Lots of materials, seeds, maybe a treasure",
      "walk.go": "Go",
      "walk.away": "{name} is on a walk. Back at {time} (in {left}).",
      "walk.asleep": "{name} is asleep. Wake {name} up first.",
      "walk.tired": "{name} is too tired for a walk and needs a rest first.",
      "toast.walkOff": "{name} set off. Back at {time}",
      "toast.back": "{name} is back! Found: {list}",
      "toast.backEmpty": "{name} is back!",
      "toast.away": "{name} is on a walk. Back at {time}",
      "say.back": ["I'm back!", "What a walk!", "Look what I found!"],
      "scene.away": "The forest, {when}. {name} is out on a walk, back at {time}.",
      "nest.title": "Nest", "nest.stage": "Stage {k} of 5",
      "nest.none": "No nest yet. Gather materials on walks and build it stage by stage.",
      "nest.done": "The nest is finished. {name} sleeps in it.",
      "nest.n1": "The spot", "nest.n2": "Twig base", "nest.n3": "Walls", "nest.n4": "Leaf roof", "nest.n5": "Moss bed",
      "nest.decor": "Decorations",
      "nest.path": "Pebble path", "nest.lantern": "Firefly lantern", "nest.flowers": "Sunflowers", "nest.garland": "Leaf garland",
      "nest.build": "Build", "nest.built": "Built",
      "nest.locked": "After: {stage}",
      "toast.built": "Built: {what}",
      "toast.nestDone": "The nest is finished! {name} has a home"
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
      "offline": "Ο κόσμος του κατοικιδίου ζει μέσα στο orOS. Άνοιξέ τον από το μενού του orOS.",
      "act.garden": "Κήπος", "act.bag": "Σακίδιο",
      "key.garden": "Κήπος (G)", "key.bag": "Σακίδιο (B)",
      "item.kibble": "Κροκέτες", "item.carrot": "Καρότο", "item.strawberry": "Φράουλα",
      "item.mushroom": "Μανιτάρι", "item.apple": "Μήλο", "item.sunflower": "Ηλιοτρόπιο",
      "item.seed_carrot": "Σπόροι καρότου", "item.seed_strawberry": "Σπόροι φράουλας",
      "item.seed_mushroom": "Σπόρια μανιταριού", "item.seed_sunflower": "Σπόροι ηλιοτρόπιου",
      "item.seed_apple": "Κουκούτσια μήλου",
      "fx.kibble": "Γεμίζει το στομάχι", "fx.carrot": "Γεμίζει το στομάχι, λίγη ενέργεια",
      "fx.strawberry": "Γεμίζει το στομάχι, πολλή χαρά", "fx.mushroom": "Γεμίζει το στομάχι, χαρά και ενέργεια",
      "fx.apple": "Γεμίζει το στομάχι, ενέργεια και χαρά", "fx.sunflower": "Κράτα το για τη φωλιά",
      "fx.seed": "Φύτεψέ το στον κήπο",
      "fx.fav": "Το αγαπημένο του!",
      "count.many": "×{n}", "count.endless": "πάντα",
      "feed.title": "Τάισμα: {name}", "feed.btn": "Τάισε",
      "bag.title": "Σακίδιο", "bag.empty": "Το σακίδιο είναι άδειο.",
      "garden.title": "Κήπος", "garden.plot": "Παρτέρι {n}",
      "garden.empty": "Άδειο", "garden.growing": "{crop}: έτοιμο σε {time}",
      "garden.ready": "{crop}: έτοιμο για μάζεμα!", "garden.watered": "ποτισμένο",
      "garden.adult": "Μηλιά: νέα μήλα σε {time}",
      "garden.unknown": "Φυτό από νεότερη έκδοση",
      "garden.plant": "Φύτεψε", "garden.water": "Πότισε", "garden.harvest": "Μάζεψε",
      "garden.dig": "Ξερίζωσε", "garden.noSeeds": "Δεν έμειναν σπόροι. Μάζεψε ώριμα φυτά για να πάρεις κι άλλους.",
      "garden.choose": "Τι θα φυτέψεις στο παρτέρι {n};",
      "garden.digConfirm": "Ξεριζώνεις: {crop} στο παρτέρι {n}; Χάνεται οριστικά.",
      "garden.digYes": "Ξερίζωσε", "garden.cancel": "Άκυρο", "dlg.close": "Κλείσιμο",
      "time.hm": "{h}ώ {m}λ", "time.m": "{m}λ", "time.soon": "λιγότερο από ένα λεπτό",
      "toast.planted": "{crop}: φυτεύτηκε στο παρτέρι {n}",
      "toast.watered": "Παρτέρι {n}: ποτίστηκε, θα ωριμάσει πιο γρήγορα",
      "toast.harvest": "Μάζεψες: {list}",
      "toast.dug": "Το παρτέρι {n} άδειασε",
      "toast.ate": "{name}: έφαγε {food}",
      "toast.noFood": "Δεν έμεινε: {food}",
      "live.ready": "Έτοιμο για μάζεμα στο παρτέρι {n}",
      "act.walk": "Βόλτα", "act.nest": "Φωλιά", "key.walk": "Βόλτα (W)", "key.nest": "Φωλιά (N)",
      "item.twig": "Κλαδάκι", "item.leaf": "Φύλλο", "item.moss": "Βρύα", "item.pebble": "Βότσαλο",
      "item.feather": "Φτερό", "item.shell": "Κοχύλι σαλιγκαριού", "item.clover": "Τετράφυλλο τριφύλλι",
      "fx.material": "Για τη φωλιά", "fx.find": "Θησαυρός από βόλτα",
      "walk.title": "Βόλτα στο δάσος",
      "walk.msg": "Από κάθε βόλτα, {name} φέρνει κλαδάκια, φύλλα, βρύα και βότσαλα για τη φωλιά, καμιά φορά και σπόρους.",
      "walk.len": "{m} λεπτά",
      "walk.15": "Λίγα υλικά", "walk.30": "Περισσότερα υλικά, ίσως σπόροι",
      "walk.60": "Πολλά υλικά, σπόροι, ίσως κι ένας θησαυρός",
      "walk.go": "Πήγαινε",
      "walk.away": "{name}: σε βόλτα. Γυρνά στις {time} (σε {left}).",
      "walk.asleep": "{name}: κοιμάται. Ξύπνα το πρώτα.",
      "walk.tired": "{name}: δεν έχει δυνάμεις για βόλτα, χρειάζεται πρώτα ξεκούραση.",
      "toast.walkOff": "{name}: ξεκίνησε για βόλτα. Γυρνά στις {time}",
      "toast.back": "{name}: γύρισε! Βρήκε: {list}",
      "toast.backEmpty": "{name}: γύρισε!",
      "toast.away": "{name}: σε βόλτα. Γυρνά στις {time}",
      "say.back": ["Γύρισα!", "Τι ωραία βόλτα!", "Δες τι βρήκα!"],
      "scene.away": "Το δάσος, {when}. {name}: σε βόλτα, γυρνά στις {time}.",
      "nest.title": "Φωλιά", "nest.stage": "Στάδιο {k} από 5",
      "nest.none": "Δεν υπάρχει ακόμα φωλιά. Μάζεψε υλικά στις βόλτες και χτίσ' τη στάδιο στάδιο.",
      "nest.done": "Η φωλιά είναι έτοιμη. {name}: κοιμάται μέσα της.",
      "nest.n1": "Το σημείο", "nest.n2": "Βάση από κλαδιά", "nest.n3": "Τοιχώματα", "nest.n4": "Στέγη από φύλλα", "nest.n5": "Στρώμα από βρύα",
      "nest.decor": "Διακοσμητικά",
      "nest.path": "Μονοπάτι με βότσαλα", "nest.lantern": "Φανάρι με πυγολαμπίδες", "nest.flowers": "Ηλιοτρόπια", "nest.garland": "Γιρλάντα από φύλλα",
      "nest.build": "Χτίσε", "nest.built": "Έτοιμο",
      "nest.locked": "Μετά από: {stage}",
      "toast.built": "Χτίστηκε: {what}",
      "toast.nestDone": "Η φωλιά τελείωσε! {name}: έχει πια σπίτι"
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

  // Anything in the forest worth asking about before a fresh start.
  function worldHasContent(d) {
    return Object.keys(d.rows || {}).some(function (dev) {
      var c = d.rows[dev].c;
      return Object.keys(c).some(function (k) { return c[k][0] > 0 || c[k][1] > 0; });
    });
  }

  // A ledger move on THIS device's row (plantings, meals; later
  // phases: finds, purchases). The row's epoch is never older than the reset stamp.
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

  // ---------- 2b. Garden data (phase 2) ----------
  // Its own synced slice "petgarden" (oros-petgarden-data): a phase-1
  // device keeps only the keys it knows in "petworld", so new keys
  // there would bounce between versions; a new slice is relayed
  // untouched by an older app (sync.js carry mailbox).
  //   { ver, br, plots{ "0".."9": { s, t, n, wn, tot{item:n} } } }
  //   s  = what grows ("" = nothing, a dug-up or never-planted plot)
  //   t  = planting time: the cycle id; a newer t replaces the plot
  //   n  = harvests taken from this planting (an annual is done at 1)
  //   wn = the growth (n) that was watered, -1 none: watering cuts
  //        that growth's time by a quarter, once per growth
  //   tot = everything ever harvested from this plot, carried from one
  //        planting to the next. The yield of growth n is fixed by
  //        (plot, t, n), so two devices harvesting the same growth
  //        write the same tot: one harvest, never two.
  // Merge: br max; plots with t < br drop (a fresh start); larger t
  // wins whole; equal t: s by greater string, n max, wn max, tot max
  // per item. Balance of an item = start pack + ledger + Σ tot.
  var HOUR = 3600000;
  var PLOTS = 4;                             // phase 5 unlocks more with the level
  var CROPS = {
    carrot:     { seed: "seed_carrot",     d: 4,  crop: [2, 3], seeds: [1, 2] },
    strawberry: { seed: "seed_strawberry", d: 8,  crop: [3, 4], seeds: [1, 2] },
    mushroom:   { seed: "seed_mushroom",   d: 12, crop: [2, 3], seeds: [1, 2] },
    sunflower:  { seed: "seed_sunflower",  d: 24, crop: [1, 1], seeds: [2, 3] },
    apple:      { seed: "seed_apple",      d: 72, crop: [3, 5], seeds: [0, 1], regrow: 24 }
  };
  var CROP_ORDER = ["carrot", "strawberry", "mushroom", "sunflower", "apple"];
  var FOOD_ORDER = ["carrot", "strawberry", "mushroom", "apple"];
  var START_PACK = { seed_carrot: 3, seed_strawberry: 2, seed_mushroom: 1, seed_sunflower: 1, seed_apple: 1 };
  var PLOT_RE = /^[0-9]$/;

  function normTot(src) {
    var out = {}, n = 0;
    if (!src || typeof src !== "object") return out;
    Object.keys(src).filter(function (k) { return ITEM_RE.test(k); }).sort(cmpStr).forEach(function (k) {
      if (n >= MAX_ITEMS || !isCount(src[k])) return;
      out[k] = src[k];
      n++;
    });
    return out;
  }

  function normPlot(p) {
    if (!p || typeof p !== "object" || !isTs(p.t)) return null;
    if (typeof p.s !== "string" || (p.s !== "" && !ITEM_RE.test(p.s))) return null;
    var n = isCount(p.n) && p.n <= 1e6 ? p.n : 0;
    var wn = (typeof p.wn === "number" && Math.floor(p.wn) === p.wn && p.wn >= -1 && p.wn <= 1e6) ? p.wn : -1;
    return { s: p.s, t: p.t, n: n, wn: wn, tot: normTot(p.tot) };
  }

  function joinPlot(x, y) {
    if (!x) return y;
    if (!y) return x;
    if (x.t !== y.t) return x.t > y.t ? x : y;
    if (x.s !== y.s) return cmpStr(x.s, y.s) > 0 ? x : y;
    var tot = {};
    Object.keys(x.tot).concat(Object.keys(y.tot)).forEach(function (k) {
      tot[k] = Math.max(x.tot[k] || 0, y.tot[k] || 0);
    });
    return { s: x.s, t: x.t, n: Math.max(x.n, y.n), wn: Math.max(x.wn, y.wn), tot: normTot(tot) };
  }

  function mergeGarden(A, B) {
    var a = (A && typeof A === "object") ? A : {};
    var b = (B && typeof B === "object") ? B : {};
    var br = Math.max(isTs(a.br) ? a.br : 0, isTs(b.br) ? b.br : 0);
    var plots = {};
    [a.plots, b.plots].forEach(function (src) {
      if (!src || typeof src !== "object") return;
      Object.keys(src).forEach(function (id) {
        if (!PLOT_RE.test(id)) return;
        var p = normPlot(src[id]);
        if (!p || p.t < br) return;
        plots[id] = joinPlot(plots[id] || null, p);
      });
    });
    var sorted = {};
    Object.keys(plots).sort(cmpStr).forEach(function (id) { sorted[id] = plots[id]; });
    return { ver: DATA_VER, br: br, plots: sorted };
  }

  function defaultGarden() { return { ver: DATA_VER, br: 0, plots: {} }; }

  // Fixed yield of growth n of the planting (plot, t): a small hash,
  // the same on every device.
  function yieldOf(id, p) {
    var c = CROPS[p.s];
    if (!c) return {};
    var str = id + ":" + p.t + ":" + p.n, h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    h = h >>> 0;
    var out = {};
    out[p.s] = c.crop[0] + (h % (c.crop[1] - c.crop[0] + 1));
    var sd = c.seeds[0] + ((h >>> 8) % (c.seeds[1] - c.seeds[0] + 1));
    if (sd > 0) out[c.seed] = sd;
    return out;
  }

  // When growth n becomes ready: growths are scheduled from the
  // planting time (a late harvest does not delay the next fruit).
  function growthSpan(c, n) { return (n === 0 ? c.d : (c.regrow || c.d)) * HOUR; }
  function readyAt(p) {
    var c = CROPS[p.s];
    if (!c) return Infinity;
    var at = p.t + c.d * HOUR + (p.n > 0 ? p.n * (c.regrow || c.d) * HOUR : 0);
    if (p.wn === p.n) at -= Math.round(growthSpan(c, p.n) / 4);
    return at;
  }

  // { state: empty | growing | ready | unknown, stage 0..3, readyAt, watered }
  function plotState(p, now) {
    if (!p || p.s === "") return { state: "empty" };
    var c = CROPS[p.s];
    if (!c) return { state: "unknown" };             // a newer version's plant
    if (!c.regrow && p.n >= 1) return { state: "empty" };
    var at = readyAt(p);
    if (now >= at) return { state: "ready", stage: 3, readyAt: at, watered: p.wn === p.n };
    var span = growthSpan(c, p.n) * (p.wn === p.n ? 0.75 : 1);
    var k = clamp(1 - (at - now) / span, 0, 1);
    return { state: "growing", stage: k < 0.34 ? 0 : (k < 0.67 ? 1 : 2), readyAt: at, watered: p.wn === p.n, adult: p.n > 0 };
  }

  function withPlot(g, id, p) {
    var plots = {};
    Object.keys(g.plots).forEach(function (k) { plots[k] = g.plots[k]; });
    plots[id] = p;
    return mergeGarden({ ver: DATA_VER, br: g.br, plots: plots }, null);
  }

  function plantSeed(g, id, crop, now) {
    var cur = g.plots[id] || null;
    if (!CROPS[crop] || !PLOT_RE.test(id)) return g;
    var st = plotState(cur, now).state;
    if (st !== "empty") return g;
    var t = Math.max(now, g.br, cur ? cur.t + 1 : 0);
    return withPlot(g, id, { s: crop, t: t, n: 0, wn: -1, tot: cur ? cur.tot : {} });
  }

  function waterPlot(g, id, now) {
    var cur = g.plots[id];
    if (!cur || plotState(cur, now).state !== "growing" || cur.wn === cur.n) return g;
    return withPlot(g, id, { s: cur.s, t: cur.t, n: cur.n, wn: cur.n, tot: cur.tot });
  }

  // Returns { g, got: {item:n} } — got is empty when nothing was ready.
  function harvestPlot(g, id, now) {
    var cur = g.plots[id];
    if (!cur || plotState(cur, now).state !== "ready") return { g: g, got: {} };
    var got = yieldOf(id, cur), tot = {};
    Object.keys(cur.tot).forEach(function (k) { tot[k] = cur.tot[k]; });
    Object.keys(got).forEach(function (k) { tot[k] = Math.min(MAX_N, (tot[k] || 0) + got[k]); });
    return { g: withPlot(g, id, { s: cur.s, t: cur.t, n: cur.n + 1, wn: cur.wn, tot: tot }), got: got };
  }

  function digUp(g, id, now) {
    var cur = g.plots[id];
    if (!cur || cur.s === "") return g;
    return withPlot(g, id, { s: "", t: Math.max(now, cur.t + 1), n: 0, wn: -1, tot: cur.tot });
  }

  function freshGarden(g, br) {
    return mergeGarden({ ver: DATA_VER, br: Math.max(br, g.br), plots: g.plots }, null);
  }

  // What the backpack holds: the start pack + this forest's ledger
  // (plantings, meals) + every harvest (+ walks − nest, phase 3, when
  // the nest slice is given). Never below zero on screen.
  function stock(d, g, item, nst, now) {
    var n = START_PACK[item] || 0;
    if (nst) n += nestNet(nst, item, now);
    Object.keys(d.rows || {}).forEach(function (dev) {
      var c = d.rows[dev].c[item];
      if (c) n += c[0] - c[1];
    });
    Object.keys(g.plots || {}).forEach(function (id) { n += g.plots[id].tot[item] || 0; });
    return Math.max(0, n);
  }

  function gardenHasContent(g) {
    return Object.keys(g.plots || {}).some(function (id) {
      var p = g.plots[id];
      return p.s !== "" || Object.keys(p.tot).length > 0;
    });
  }

  // ---------- 2c. Walks + nest data (phase 3) ----------
  // Its own synced slice "petnest" (oros-petnest-data), for the same
  // reason as the garden (a phase-1/2 device relays it untouched):
  //   { ver, br, built{key: ts}, rows{deviceId:{b, v, w{start: min}, sum{item:n}}} }
  //   built = nest stages n1..n5 and decorations, each with the time it
  //        was built. What they cost is DERIVED from what is built, so
  //        a stage built on two offline devices is paid once.
  //   rows = walks, one row per device that started them and written
  //        only by that device: w = its walks (start time → minutes);
  //        a walk's loot is fixed by (device, start, minutes), so every
  //        device sees the same finds. Finished walks other than the
  //        newest fold into sum (v + 1), so a row stays small.
  // The companion (pet.js) reads rows.*.w to show that the pet is out.
  // Merge: br max; built per key max ts, ts < br drop; rows: larger
  // (b, v) wins whole, a tie takes the greater canonical JSON; rows
  // with b < br drop.
  var MIN = 60000;
  var WALKS = [15, 30, 60];                  // minutes of real time
  var WALK_ENERGY = 20;                      // too tired below this
  var MATERIALS = ["twig", "leaf", "moss", "pebble"];
  var FINDS = ["feather", "shell", "clover"];
  var LOOT = {
    15: { rolls: [2, 3],  seed: 0,    find: 0 },
    30: { rolls: [4, 5],  seed: 0.25, find: 0 },
    60: { rolls: [8, 10], seed: 0.5,  find: 0.25 }
  };
  var NEST = [
    { id: "n1", cost: { pebble: 3 } },
    { id: "n2", cost: { twig: 8 } },
    { id: "n3", cost: { twig: 6, leaf: 4 } },
    { id: "n4", cost: { leaf: 10 } },
    { id: "n5", cost: { moss: 6 } }
  ];
  var DECOR = [
    { id: "path",    cost: { pebble: 6 },           needs: 1 },
    { id: "lantern", cost: { twig: 3, pebble: 2 },  needs: 2 },
    { id: "flowers", cost: { sunflower: 2 },        needs: 2 },
    { id: "garland", cost: { leaf: 6 },             needs: 4 }
  ];
  var WALK_RE = /^[0-9]{1,15}$/;
  var MAX_WALKS = 32;

  function normWalks(src) {
    var keys = [];
    if (src && typeof src === "object") {
      keys = Object.keys(src).filter(function (k) {
        var d = src[k];
        return WALK_RE.test(k) && typeof d === "number" && Math.floor(d) === d && d >= 1 && d <= 1440;
      });
    }
    keys.sort(function (a, b) { return Number(b) - Number(a); });   // newest first, then cap
    var out = {};
    keys.slice(0, MAX_WALKS).sort(cmpStr).forEach(function (k) { out[k] = src[k]; });
    return out;
  }

  function normNestRow(r) {
    if (!r || typeof r !== "object" || !isTs(r.b)) return null;
    return { b: r.b, v: isCount(r.v) ? r.v : 0, w: normWalks(r.w), sum: normTot(r.sum) };
  }

  function joinNestRow(x, y) {
    if (!x) return y;
    if (!y) return x;
    if (x.b !== y.b) return x.b > y.b ? x : y;
    if (x.v !== y.v) return x.v > y.v ? x : y;
    return cmpStr(JSON.stringify(x), JSON.stringify(y)) >= 0 ? x : y;
  }

  function mergeNest(A, B) {
    var a = (A && typeof A === "object") ? A : {};
    var b = (B && typeof B === "object") ? B : {};
    var br = Math.max(isTs(a.br) ? a.br : 0, isTs(b.br) ? b.br : 0);
    var built = {}, rows = {};
    [a, b].forEach(function (src) {
      var bs = (src.built && typeof src.built === "object") ? src.built : {};
      Object.keys(bs).forEach(function (k) {
        if (!ITEM_RE.test(k) || !isTs(bs[k]) || bs[k] < br) return;
        built[k] = Math.max(built[k] || 0, bs[k]);
      });
      var rs = (src.rows && typeof src.rows === "object") ? src.rows : {};
      Object.keys(rs).forEach(function (dev) {
        if (!ID_RE.test(dev)) return;
        var r = normNestRow(rs[dev]);
        if (!r || r.b < br) return;
        rows[dev] = joinNestRow(rows[dev] || null, r);
      });
    });
    var sb = {}, sr = {};
    Object.keys(built).sort(cmpStr).slice(0, MAX_ITEMS).forEach(function (k) { sb[k] = built[k]; });
    Object.keys(rows).sort(cmpStr).forEach(function (dev) { sr[dev] = rows[dev]; });
    return { ver: DATA_VER, br: br, built: sb, rows: sr };
  }

  function defaultNest() { return { ver: DATA_VER, br: 0, built: {}, rows: {} }; }

  // The fixed loot of one walk.
  function lootOf(dev, start, min) {
    var str = dev + ":" + start + ":" + min, h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    var r = mulberry(h | 0);
    var L = LOOT[min] || { rolls: [Math.ceil(min / 8), Math.ceil(min / 6)], seed: 0, find: 0 };
    var out = {}, add = function (k) { out[k] = (out[k] || 0) + 1; };
    var n = L.rolls[0] + Math.floor(r() * (L.rolls[1] - L.rolls[0] + 1));
    for (var j = 0; j < n; j++) {
      var x = r();
      add(x < 0.35 ? "twig" : x < 0.7 ? "leaf" : x < 0.85 ? "moss" : "pebble");
    }
    if (r() < L.seed) add(CROPS[CROP_ORDER[Math.floor(r() * CROP_ORDER.length)]].seed);
    if (r() < L.find) add(FINDS[Math.floor(r() * FINDS.length)]);
    return out;
  }

  // Every walk in the forest: [{ dev, s, d, end }], oldest first.
  function walkList(n) {
    var out = [];
    Object.keys(n.rows).forEach(function (dev) {
      var w = n.rows[dev].w;
      Object.keys(w).forEach(function (k) { out.push({ dev: dev, s: Number(k), d: w[k], end: Number(k) + w[k] * MIN }); });
    });
    out.sort(function (a, b) { return a.s - b.s || cmpStr(a.dev, b.dev); });
    return out;
  }
  // The walk under way (the one ending last), or null.
  function activeWalk(n, now) {
    var best = null;
    walkList(n).forEach(function (w) { if (now < w.end && (!best || w.end > best.end)) best = w; });
    return best;
  }
  function lastWalk(n) {
    var all = walkList(n);
    return all.length ? all[all.length - 1] : null;
  }

  function withNestRow(n, dev, row) {
    var rows = {};
    Object.keys(n.rows).forEach(function (k) { rows[k] = n.rows[k]; });
    rows[dev] = row;
    return mergeNest({ ver: DATA_VER, br: n.br, built: n.built, rows: rows }, null);
  }

  // Finished walks of THIS device's row, except the newest, move
  // their loot into sum: the same totals, a smaller row.
  function foldWalks(n, dev, now) {
    var row = n.rows[dev];
    if (!row) return n;
    var keys = Object.keys(row.w).sort(function (a, b) { return Number(a) - Number(b); });
    var newest = keys[keys.length - 1];
    var fold = keys.filter(function (k) { return k !== newest && Number(k) + row.w[k] * MIN <= now; });
    if (!fold.length) return n;
    var w = {}, sum = {};
    Object.keys(row.sum).forEach(function (k) { sum[k] = row.sum[k]; });
    keys.forEach(function (k) {
      if (fold.indexOf(k) < 0) { w[k] = row.w[k]; return; }
      var got = lootOf(dev, Number(k), row.w[k]);
      Object.keys(got).forEach(function (i) { sum[i] = Math.min(MAX_N, (sum[i] || 0) + got[i]); });
    });
    return withNestRow(n, dev, { b: row.b, v: row.v + 1, w: w, sum: sum });
  }

  function startWalk(n, dev, min, now) {
    if (WALKS.indexOf(min) < 0 || activeWalk(n, now)) return n;
    var row = n.rows[dev] && n.rows[dev].b >= n.br ? n.rows[dev] : { b: n.br, v: 0, w: {}, sum: {} };
    var s = Math.max(now, n.br);
    Object.keys(row.w).forEach(function (k) { s = Math.max(s, Number(k) + 1); });
    var w = {};
    Object.keys(row.w).forEach(function (k) { w[k] = row.w[k]; });
    w[String(s)] = min;
    return foldWalks(withNestRow(n, dev, { b: row.b, v: row.v + 1, w: w, sum: row.sum }), dev, now);
  }

  // Materials, seeds and finds brought home (finished walks only),
  // minus what the nest and the decorations cost.
  function nestNet(n, item, now) {
    var v = 0;
    Object.keys(n.rows).forEach(function (dev) { v += n.rows[dev].sum[item] || 0; });
    walkList(n).forEach(function (w) { if (w.end <= now) v += lootOf(w.dev, w.s, w.d)[item] || 0; });
    NEST.concat(DECOR).forEach(function (x) { if (n.built[x.id]) v -= x.cost[item] || 0; });
    return v;
  }

  function nestStage(n) {
    var k = 0;
    while (k < NEST.length && n.built[NEST[k].id]) k++;
    return k;
  }

  function buildable(id, n) {
    var st = nestStage(n), i;
    for (i = 0; i < NEST.length; i++) if (NEST[i].id === id) return { def: NEST[i], ok: i === st };
    for (i = 0; i < DECOR.length; i++) if (DECOR[i].id === id) return { def: DECOR[i], ok: !n.built[id] && st >= DECOR[i].needs };
    return null;
  }

  // have(item) = the backpack count of the item. Returns n unchanged
  // when the step is not next in line or something is missing.
  function buildNest(n, id, now, have) {
    var b = buildable(id, n);
    if (!b || !b.ok) return n;
    if (Object.keys(b.def.cost).some(function (k) { return have(k) < b.def.cost[k]; })) return n;
    var built = {};
    Object.keys(n.built).forEach(function (k) { built[k] = n.built[k]; });
    built[id] = Math.max(now, n.br);
    return mergeNest({ ver: DATA_VER, br: n.br, built: built, rows: n.rows }, null);
  }

  function freshNest(n, br) {
    return mergeNest({ ver: DATA_VER, br: Math.max(br, n.br), built: n.built, rows: n.rows }, null);
  }

  function nestHasContent(n) {
    return Object.keys(n.built).length > 0 || Object.keys(n.rows).some(function (dev) {
      return Object.keys(n.rows[dev].w).length > 0 || Object.keys(n.rows[dev].sum).length > 0;
    });
  }

  var data = defaultData();
  var garden = defaultGarden();
  var nest = defaultNest();

  // The backpack count of an item, everything included.
  function have(item) { return stock(data, garden, item, nest, Date.now()); }

  function loadKey(key, merge, fallback) {
    var raw = null;
    try { raw = localStorage.getItem(key); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return merge(parsed, null);
      } catch (e) {}
      // unreadable → device-local rescue copy BEFORE the fresh state
      try { localStorage.setItem(key + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] petworld: unreadable data copied to " + key + "-broken"); } catch (e) {}
    }
    return fallback();
  }
  function load() {
    data = loadKey(STORAGE_KEY, mergeWorld, defaultData);
    garden = loadKey(GARDEN_KEY, mergeGarden, defaultGarden);
    nest = loadKey(NEST_KEY, mergeNest, defaultNest);
  }

  var saveFailShown = false;
  function saveKey(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }
  function save() { saveKey(STORAGE_KEY, data); }
  function saveGarden() { saveKey(GARDEN_KEY, garden); }
  function saveNest() { saveKey(NEST_KEY, nest); }

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
    U = clamp(Math.floor(Math.min(H / 62, W / 60)), 3, 8);   // oak + nest + 4 beds fit from 360 px
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
    // a mossy bed at the roots: the sleeping spot (the nest is built here)
    g.fillStyle = lit("#4f7d3b", L);
    g.fillRect(x + 4 * U, baseY - U, 11 * U, U);
    g.fillRect(x + 5 * U, baseY - 2 * U, 9 * U, U);
    g.fillStyle = lit("#7fb069", L);
    g.fillRect(x + 6 * U, baseY - 2 * U, 2 * U, U);
    g.fillRect(x + 10 * U, baseY - 2 * U, 3 * U, U);
  }

  // ---------- 4b. Garden beds in the scene ----------
  // The beds sit on the grass to the right of the oak, drawn every
  // frame (a handful of rectangles) in the light of the hour.
  var curL = 1;
  function plotRects() {
    var x0 = Math.round(Math.max(W * 0.4, sleepX + 17 * U) / U) * U;   // right of the nest
    var avail = W - 2 * U - x0;
    var pw = clamp(Math.floor((avail - 3 * 2 * U) / PLOTS / U), 4, 10) * U;
    var out = [];
    for (var i = 0; i < PLOTS; i++) out.push({ id: String(i), x: x0 + i * (pw + 2 * U), w: pw });
    return out;
  }
  function plotAt(x, y) {
    if (y < groundY - 14 * U || y > groundY + 5 * U) return null;
    var rs = plotRects();
    for (var i = 0; i < rs.length; i++) if (x >= rs[i].x - U && x <= rs[i].x + rs[i].w + U) return rs[i];
    return null;
  }

  var CROP_COLORS = { carrot: "#f08a24", strawberry: "#e53950", mushroom: "#b5653a", sunflower: "#ffd23f", apple: "#d83a3a" };
  function drawGarden(now) {
    var L = curL, g = ctx;
    plotRects().forEach(function (r) {
      var p = garden.plots[r.id] || null, st = plotState(p, now);
      var cx = r.x + Math.floor(r.w / 2 / U) * U, base = groundY + U;
      g.fillStyle = lit(st.watered ? "#3e2a18" : "#5a3d24", L);
      g.fillRect(r.x, base, r.w, 2 * U);
      g.fillStyle = lit("#6e4b2e", L);
      for (var k = r.x + U; k < r.x + r.w - U; k += 2 * U) g.fillRect(k, base, U, U);
      if (st.state === "empty") return;
      var leaf = lit("#5aa05c", L), dark = lit("#3f7d4a", L);
      var R = function (x, y, w, h, c) { g.fillStyle = c; g.fillRect(cx + x * U, base + y * U, w * U, h * U); };
      if (st.state === "unknown") { R(0, -2, 1, 2, leaf); R(-1, -2, 1, 1, leaf); return; }
      var crop = p.s, col = lit(CROP_COLORS[crop] || "#ffffff", L);
      if (crop === "apple" && (st.state === "ready" || st.adult || st.stage === 2)) {
        R(0, -6, 1, 6, lit("#6b4a2f", L));
        R(-2, -9, 5, 3, dark); R(-1, -10, 3, 1, dark); R(-1, -9, 2, 1, leaf);
        if (st.state === "ready") { R(-2, -8, 1, 1, col); R(1, -9, 1, 1, col); R(2, -7, 1, 1, col); }
      } else if (st.state === "growing" && st.stage === 0) {
        R(0, -1, 1, 1, leaf);
      } else if (st.state === "growing" && st.stage === 1) {
        R(0, -2, 1, 2, leaf); R(-1, -2, 1, 1, leaf); R(1, -3, 1, 1, leaf);
      } else if (crop === "carrot") {
        var tall = st.state === "ready" ? 4 : 3;
        R(0, -tall, 1, tall, leaf); R(-1, -tall + 1, 1, 1, leaf); R(1, -tall, 1, 1, leaf); R(-1, -tall - 1, 1, 1, dark);
        if (st.state === "ready") R(-1, -1, 3, 1, col);
      } else if (crop === "strawberry") {
        R(-2, -3, 5, 3, dark); R(-1, -4, 3, 1, leaf);
        if (st.state === "ready") { R(-2, -1, 1, 1, col); R(1, -2, 1, 1, col); R(2, -1, 1, 1, col); }
        else R(0, -3, 1, 1, lit("#ffffff", L));
      } else if (crop === "mushroom") {
        var big = st.state === "ready";
        R(0, big ? -2 : -1, 1, big ? 2 : 1, lit("#f3e9d2", L));
        R(big ? -2 : -1, big ? -4 : -2, big ? 5 : 3, big ? 2 : 1, col);
        if (big) R(-1, -4, 1, 1, lit("#f3e9d2", L));
      } else if (crop === "sunflower") {
        var h = st.state === "ready" ? 8 : 5;
        R(0, -h, 1, h, leaf); R(-1, -3, 1, 1, leaf); R(1, -5, 1, 1, leaf);
        if (st.state === "ready") { R(-1, -h - 2, 3, 3, col); R(0, -h - 1, 1, 1, lit("#6b4a2f", L)); }
        else R(0, -h - 1, 1, 1, dark);
      } else {
        R(0, -3, 1, 3, leaf); R(-1, -3, 1, 1, leaf);
      }
      if (st.state === "ready" && !reducedMotion() && Math.floor(now / 500) % 2 === 0) {
        R(2, -6, 1, 1, "rgba(255,255,240,0.9)");
      }
    });
  }

  // ---------- 4c. The nest in the scene (phase 3) ----------
  // Built where the pet sleeps, 16 units wide like the pet; drawn in
  // two layers: everything behind the pet, then the front lip.
  function nestCx() { return sleepX + 8 * U; }
  function nestAt(x, y) {
    var cx = nestCx();
    return x >= cx - 12 * U && x <= cx + 8 * U && y >= groundY - 24 * U && y <= groundY + 6 * U;
  }
  function nestPainter() {
    var cx = nestCx(), B = groundY + 2 * U, L = curL;
    return function (x, y, w, h, c) { ctx.fillStyle = lit(c, L); ctx.fillRect(cx + x * U, B + y * U, w * U, h * U); };
  }
  var TWIG = "#7a5232", TWIG_D = "#5a3b22", TWIG_L = "#a0744a", LEAF = "#4f9a43", LEAF_D = "#3b7a35",
      LEAF_L = "#8fd16f", MOSS = "#6c9b3c", MOSS_L = "#9cc95a", STONE = "#9aa3a8", STONE_D = "#6f787d";
  function drawNestBack(now) {
    var st = nestStage(nest), R = nestPainter(), b = nest.built;
    if (b.flowers) {
      R(-14, -6, 1, 6, LEAF_D); R(-15, -9, 3, 3, "#ffd23f"); R(-14, -8, 1, 1, TWIG_D);
      R(-17, -4, 1, 4, LEAF_D); R(-18, -7, 3, 3, "#ffd23f"); R(-17, -6, 1, 1, TWIG_D);
    }
    if (b.lantern) {
      R(-11, -14, 1, 14, TWIG_D); R(-11, -14, 3, 1, TWIG_D);
      var night = curL < 0.4;
      if (night) { ctx.fillStyle = "rgba(255,230,120,0.18)"; ctx.fillRect(nestCx() - 12 * U, groundY + 2 * U - 16 * U, 6 * U, 6 * U); }
      R(-10, -13, 2, 2, night ? "#fff3b8" : "#e0c068");
    }
    if (st >= 4) {
      R(-8, -17, 16, 15, "#2b3f24");                       // the shade inside the hut
      R(-10, -17, 2, 10, LEAF_D); R(8, -17, 2, 10, LEAF_D);
      R(-10, -19, 20, 2, LEAF); R(-8, -21, 16, 2, LEAF); R(-5, -22, 10, 1, LEAF_L); R(-6, -21, 3, 1, LEAF_L);
      if (b.garland) {
        ["#e53950", "#f08a24", "#ffd23f"].forEach(function (c, i) {
          for (var x = -9 + i * 2; x < 9; x += 6) R(x, -17, 1, 1, c);
        });
      }
    }
    if (st >= 3) {
      R(-9, -7, 2, 6, TWIG); R(7, -7, 2, 6, TWIG);
      R(-9, -5, 1, 1, LEAF); R(8, -3, 1, 1, LEAF); R(-7, -6, 14, 1, TWIG_D);
    }
    if (st >= 2) {
      R(-8, -2, 16, 2, TWIG_D); R(-7, -2, 3, 1, TWIG_L); R(-1, -2, 4, 1, TWIG_L); R(4, -1, 3, 1, TWIG_L);
    }
    if (st >= 5) { R(-7, -3, 14, 1, MOSS); R(-6, -4, 4, 1, MOSS_L); R(2, -4, 3, 1, MOSS_L); }
    if (st >= 1) { R(-10, -1, 2, 1, STONE); R(8, -1, 2, 1, STONE); R(-8, 0, 1, 1, STONE_D); R(7, 0, 1, 1, STONE_D); }
    if (b.path) { R(-6, 2, 2, 1, STONE); R(-2, 3, 2, 1, STONE_D); R(2, 2, 2, 1, STONE); R(5, 3, 2, 1, STONE_D); }
  }
  function drawNestFront() {
    if (nestStage(nest) < 3) return;
    var R = nestPainter();
    R(-8, -2, 16, 1, TWIG); R(-6, -2, 2, 1, TWIG_L); R(1, -2, 3, 1, TWIG_L);
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

  var away = null;           // the walk under way, if any (from the petnest slice)
  function updatePet(dt) {
    if (!snap) return;
    pet.frame++;
    if (away) {
      // Off on a walk: out past the right edge, then gone.
      if (pet.mode !== "gone") {
        pet.dir = 1; pet.target = null;
        pet.x += WALK_UPS * U * dt * 1.3;
        pet.mode = pet.x > W + U ? "gone" : "walk";
      }
      return;
    }
    if (pet.mode === "gone") { pet.x = W + U; walkTo(W * 0.6); }
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
    if (pet.mode === "gone") return;
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
    drawGarden(Date.now());
    drawNestBack();
    drawPet();
    drawNestFront();
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
    garden: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21v-9"/><path d="M12 12c0-4-3-6-7-6 0 4 3 6 7 6zM12 10c0-4 3-6 7-6 0 4-3 6-7 6z"/><path d="M4 21h16"/></svg>',
    bag:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M9 6V4.5a3 3 0 0 1 6 0V6"/><path d="M5 13h14M10 13v3h4v-3"/></svg>',
    walk:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 21c-1.7 0-3-1.5-3-3.5S5 13 7 13s2.5 2.5 2.5 4.5S8.7 21 7 21z"/><path d="M15 12c-1.7 0-3-1.5-3-3.5S13 4 15 4s2.5 2.5 2.5 4.5S16.7 12 15 12z"/><path d="M6 10.5V9M10 11l.5-1.2M16 18.5V17M19.5 17l.5-1"/></svg>',
    nest:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 7 0 0 0 18 0"/><path d="M3 12h18"/><path d="M5 15.5l3-2M9 17.5l3-3M13 17.5l3-3M17 15.5l2-1.5"/><path d="M8 9.5c1-2.5 3-4 4-4s3 1.5 4 4"/></svg>',
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
    $("garden-btn").querySelector(".act-ico").innerHTML = ICONS.garden;
    $("garden-btn").querySelector(".act-lbl").textContent = t("act.garden");
    $("garden-btn").title = t("key.garden");
    $("bag-btn").querySelector(".act-ico").innerHTML = ICONS.bag;
    $("bag-btn").querySelector(".act-lbl").textContent = t("act.bag");
    $("bag-btn").title = t("key.bag");
    $("walk-btn").querySelector(".act-ico").innerHTML = ICONS.walk;
    $("walk-btn").querySelector(".act-lbl").textContent = t("act.walk");
    $("walk-btn").title = t("key.walk");
    $("nest-btn").querySelector(".act-ico").innerHTML = ICONS.nest;
    $("nest-btn").querySelector(".act-lbl").textContent = t("act.nest");
    $("nest-btn").title = t("key.nest");
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
    if (away) canvas.setAttribute("aria-label", t("scene.away", { name: snap.name, when: when, time: clockHM(away.end) }));
    else canvas.setAttribute("aria-label", t(asleep ? "scene.asleep" : "scene.awake", { name: snap.name, when: when }));
  }

  // Low-stat lines, once per crossing (the companion's thresholds).
  function checkWarnings() {
    if (!snap || snap.asleep || away) return;
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
  function hasGardenFood() {
    return FOOD_ORDER.some(function (f) { return have(f) > 0; });
  }
  // The Feed button: straight to kibble while the backpack has no
  // garden food, otherwise a choice.
  function feedButton() {
    if (awayToast()) return;
    if (hasGardenFood()) foodDialog(); else doFeed("kibble");
  }
  // While the pet is out on a walk, care waits for its return.
  function awayToast() {
    if (!away || !snap) return false;
    showToast(t("toast.away", { name: snap.name, time: clockHM(away.end) }));
    return true;
  }
  function doFeed(kind) {
    var b = bridge();
    if (!b || !snap || awayToast()) return;
    kind = kind || "kibble";
    if (kind !== "kibble") {
      if (have(kind) < 1) { showToast(t("toast.noFood", { food: t("item." + kind) })); return; }
    }
    var wasAsleep = snap.asleep, res;
    try { res = b.feed(kind); } catch (e) { return; }
    snap = res;
    if (kind !== "kibble") {
      var dev = deviceId();
      data = ledger(data, dev, kind, 0, 1);
      // the favourite, once found, wears a star in the backpack
      if (res.favourite && have("fav_" + kind) < 1) data = ledger(data, dev, "fav_" + kind, 1, 0);
      save();
    }
    pet.mode = "eat"; pet.timer = 2400; pet.eatAt = Date.now(); pet.target = null;
    if (res.favourite) { say(b.line("speech.fav")); addHearts(); }
    else say(b.line(wasAsleep ? "speech.wake" : "speech.eat"));
    announce(t("live.fed", { name: snap.name }));
    if (kind !== "kibble") showToast(t("toast.ate", { name: snap.name, food: t("item." + kind) }));
    renderUI();
  }
  function doPat() {
    var b = bridge();
    if (!b || !snap || awayToast()) return;
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
    if (!b || !snap || awayToast()) return;
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
    if (pet.mode !== "gone" && x >= px - U && x <= px + petWidth() + U && y >= py - U && y <= py + petWidth() + 2 * U) { doPat(); return; }
    var plot = plotAt(x, y);
    if (plot) { gardenDialog(plot.id); return; }
    if (nestAt(x, y)) { nestDialog(); return; }
    if (away) return;
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
      garden = freshGarden(garden, data.br);
      nest = freshNest(nest, data.br);
      save();
      saveGarden();
      saveNest();
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
    if (!data.pet || !(worldHasContent(data) || gardenHasContent(garden) || nestHasContent(nest))) {
      data = bindPet(data, snap.id, Date.now());
      save();
      return;
    }
    friendDialog(snap.id);
  }

  // ---------- 8b. Backpack, food and garden dialogs ----------
  // 8×8 pixel icons; one letter per colour, "." transparent.
  var ART = {
    kibble:     { px: ["........", "........", "..b.bb..", ".bbbbbb.", "wwwwwwww", ".wwwwww.", "..wwww..", "........"], c: { b: "#a0663a", w: "#90a4ae" } },
    carrot:     { px: [".....g.g", "....g.g.", "....oo..", "...ooo..", "..ooo...", ".ooo....", ".oo.....", "o......."], c: { o: "#f08a24", g: "#5aa05c" } },
    strawberry: { px: ["...gg...", "..gggg..", ".rrrrrr.", ".rryrrr.", ".rrrryr.", "..rrrr..", "...rr...", "........"], c: { r: "#e53950", y: "#ffe08a", g: "#5aa05c" } },
    mushroom:   { px: ["..rrrr..", ".rrwrrr.", "rrrrrwrr", "rwrrrrrr", "...ww...", "...ww...", "..wwww..", "........"], c: { r: "#b5653a", w: "#f3e9d2" } },
    apple:      { px: ["....b...", "...bg...", ".rrrrrr.", "rrrrrwrr", "rrrrrrwr", "rrrrrrrr", ".rrrrrr.", "..rrrr.."], c: { r: "#d83a3a", b: "#6b4a2f", g: "#5aa05c", w: "#ffb3b3" } },
    sunflower:  { px: ["..yyyy..", ".yybbyy.", ".ybbbby.", ".yybbyy.", "..yyyy..", "...g....", "..gg....", "...g...."], c: { y: "#ffd23f", b: "#6b4a2f", g: "#5aa05c" } },
    twig:       { px: ["......b.", ".....b..", "..l.b...", "...bb...", "..bb.l..", ".bb.....", "bb......", "b......."], c: { b: "#7a5232", l: "#5aa05c" } },
    leaf:       { px: [".....ggg", "...ggggg", "..gglggg", ".gglgggg", ".glgggg.", ".lggg...", "l.......", "........"], c: { g: "#4f9a43", l: "#8fd16f" } },
    moss:       { px: ["........", "........", "..g..g..", ".gggggg.", "gGgggGgg", "gggGgggg", ".gggggg.", "........"], c: { g: "#6c9b3c", G: "#9cc95a" } },
    pebble:     { px: ["........", "........", "...ggg..", "..gwggg.", ".ggggggd", ".gggggdd", "..dddd..", "........"], c: { g: "#9aa3a8", w: "#d5dadc", d: "#6f787d" } },
    feather:    { px: [".......w", "......ww", ".....wbw", "....wbw.", "...wbw..", "..wbw...", ".bww....", "b......."], c: { w: "#f3ead2", b: "#8d6e63" } },
    shell:      { px: ["........", "..oooo..", ".oyyyoo.", "oyoooyo.", "oyoyoyo.", "oyyyoo..", ".oooooo.", "........"], c: { o: "#c47a3a", y: "#f3d39a" } },
    clover:     { px: ["..gg.gg.", ".gggggg.", ".gglggg.", "..ggggg.", ".gggggg.", ".gg.gg..", "...l....", "..l....."], c: { g: "#3fa34d", l: "#2e7d32" } },
    nest:       { px: ["........", "........", "..llll..", ".bbbbbb.", "bmmmmmmb", "bbbbbbbb", ".bbbbbb.", "........"], c: { b: "#7a5232", m: "#6c9b3c", l: "#4f9a43" } },
    walk:       { px: ["....bb..", "...bbbb.", "...bbbb.", "....bb..", ".bb.....", "bbbb....", "bbbb....", ".bb....."], c: { b: "#8d6e63" } },
    seed:       { px: ["..pppp..", ".pppppp.", ".pwwwwp.", ".pwccwp.", ".pwccwp.", ".pwwwwp.", ".pppppp.", "........"], c: { p: "#c9b48a", w: "#f3ead2" } }
  };
  function itemIcon(item) {
    var cv = document.createElement("canvas");
    cv.width = 8; cv.height = 8;
    cv.className = "item-ico";
    cv.setAttribute("aria-hidden", "true");
    var g = cv.getContext("2d"), art, colors;
    var crop = item.indexOf("seed_") === 0 ? item.slice(5) : null;
    if (crop) {
      art = ART.seed;
      colors = { p: art.c.p, w: art.c.w, c: CROP_COLORS[crop] || "#8d6e63" };
    } else {
      art = ART[item] || ART.seed;
      colors = art.c;
    }
    art.px.forEach(function (row, y) {
      for (var x = 0; x < 8; x++) {
        var k = row[x];
        if (k === "." || !colors[k]) continue;
        g.fillStyle = colors[k];
        g.fillRect(x, y, 1, 1);
      }
    });
    return cv;
  }

  function itemRow(item, sub, count, actions, title) {
    var r = el("div", "item-row");
    r.appendChild(itemIcon(item));
    var txt = el("div", "item-txt");
    txt.appendChild(el("strong", "", title || t("item." + item)));
    if (sub) txt.appendChild(el("small", "", sub));
    r.appendChild(txt);
    if (count !== null) r.appendChild(el("span", "item-count", count));
    (actions || []).forEach(function (a) { r.appendChild(a); });
    return r;
  }
  function smallBtn(label, cls, fn) {
    var b = button(label, "small" + (cls ? " " + cls : ""), fn);
    return b;
  }
  function closeRow(dlg) {
    var acts = el("div", "dlg-actions");
    var c = button(t("dlg.close"), "", function () { dlg.close(); });
    acts.appendChild(c);
    dlg.appendChild(acts);
    return c;
  }
  function favMark(food) {
    return snap && snap.favFood === food && have("fav_" + food) > 0;
  }
  function foodSub(food) {
    return t("fx." + food) + (favMark(food) ? " · " + t("fx.fav") : "");
  }

  function foodDialog() {
    if (!snap) return;
    var dlg = makeDialog("pw-food");
    dlg.appendChild(el("div", "dlg-title", t("feed.title", { name: snap.name })));
    var list = el("div", "item-list");
    var first = smallBtn(t("feed.btn"), "primary", function () { dlg.close(); doFeed("kibble"); });
    list.appendChild(itemRow("kibble", t("fx.kibble"), t("count.endless"), [first]));
    FOOD_ORDER.forEach(function (f) {
      var n = have(f);
      if (n < 1) return;
      list.appendChild(itemRow(f, foodSub(f), t("count.many", { n: n }),
        [smallBtn(t("feed.btn"), "primary", function () { dlg.close(); doFeed(f); })]));
    });
    dlg.appendChild(list);
    closeRow(dlg);
    document.body.appendChild(dlg);
    dlg.showModal();
    first.focus();
  }

  function bagDialog() {
    var dlg = makeDialog("pw-bag");
    dlg.appendChild(el("div", "dlg-title", t("bag.title")));
    var list = el("div", "item-list"), any = false;
    FOOD_ORDER.concat(["sunflower"]).forEach(function (f) {
      var n = have(f);
      if (n < 1) return;
      any = true;
      var acts = CROPS[f] && f !== "sunflower" ? [smallBtn(t("feed.btn"), "", function () { dlg.close(); doFeed(f); })] : [];
      list.appendChild(itemRow(f, f === "sunflower" ? t("fx.sunflower") : foodSub(f), t("count.many", { n: n }), acts));
    });
    CROP_ORDER.forEach(function (c) {
      var item = CROPS[c].seed, n = have(item);
      if (n < 1) return;
      any = true;
      list.appendChild(itemRow(item, t("fx.seed"), t("count.many", { n: n }),
        [smallBtn(t("act.garden"), "", function () { dlg.close(); gardenDialog(null); })]));
    });
    MATERIALS.forEach(function (m) {
      var n = have(m);
      if (n < 1) return;
      any = true;
      list.appendChild(itemRow(m, t("fx.material"), t("count.many", { n: n }),
        [smallBtn(t("act.nest"), "", function () { dlg.close(); nestDialog(); })]));
    });
    FINDS.forEach(function (f) {
      var n = have(f);
      if (n < 1) return;
      any = true;
      list.appendChild(itemRow(f, t("fx.find"), t("count.many", { n: n })));
    });
    if (!any) list.appendChild(el("div", "dlg-msg", t("bag.empty")));
    dlg.appendChild(list);
    var c = closeRow(dlg);
    document.body.appendChild(dlg);
    dlg.showModal();
    c.focus();
  }

  function fmtLeft(ms) {
    var m = Math.ceil(ms / 60000);
    if (m < 1) return t("time.soon");
    if (m < 60) return t("time.m", { m: m });
    return t("time.hm", { h: Math.floor(m / 60), m: m % 60 });
  }

  function plotLine(id, now) {
    var p = garden.plots[id] || null, st = plotState(p, now);
    if (st.state === "empty") return t("garden.empty");
    if (st.state === "unknown") return t("garden.unknown");
    var crop = t("item." + p.s);
    if (st.state === "ready") return t("garden.ready", { crop: crop });
    var line = st.adult ? t("garden.adult", { crop: crop, time: fmtLeft(st.readyAt - now) })
                        : t("garden.growing", { crop: crop, time: fmtLeft(st.readyAt - now) });
    return line + (st.watered ? " · " + t("garden.watered") : "");
  }

  function gardenDialog(focusId) {
    var dlg = makeDialog("pw-garden");
    dlg.appendChild(el("div", "dlg-title", t("garden.title")));
    var list = el("div", "item-list"), focusBtn = null, now = Date.now();
    plotRects().forEach(function (r) {
      var id = r.id, p = garden.plots[id] || null, st = plotState(p, now), acts = [];
      var n = Number(id) + 1;
      if (st.state === "empty") {
        acts.push(smallBtn(t("garden.plant"), "primary", function () { dlg.close(); seedDialog(id); }));
      } else if (st.state === "ready") {
        acts.push(smallBtn(t("garden.harvest"), "primary", function () { dlg.close(); doHarvest(id); }));
      } else if (st.state === "growing") {
        if (!st.watered) acts.push(smallBtn(t("garden.water"), "primary", function () { dlg.close(); doWater(id); }));
        acts.push(smallBtn(t("garden.dig"), "danger", function () { dlg.close(); digDialog(id); }));
      } else {
        acts.push(smallBtn(t("garden.dig"), "danger", function () { dlg.close(); digDialog(id); }));
      }
      var row = el("div", "item-row" + (focusId === id ? " focus" : ""));
      if (p && CROPS[p.s] && st.state !== "empty") row.appendChild(itemIcon(p.s));
      else { var ph = el("span", "item-ico plot-ico"); ph.setAttribute("aria-hidden", "true"); row.appendChild(ph); }
      var txt = el("div", "item-txt");
      txt.appendChild(el("strong", "", t("garden.plot", { n: n })));
      txt.appendChild(el("small", "", plotLine(id, now)));
      row.appendChild(txt);
      acts.forEach(function (a) { row.appendChild(a); });
      list.appendChild(row);
      if (focusId === id && acts[0]) focusBtn = acts[0];
    });
    dlg.appendChild(list);
    var c = closeRow(dlg);
    document.body.appendChild(dlg);
    dlg.showModal();
    (focusBtn || c).focus();
  }

  function seedDialog(id) {
    var dlg = makeDialog("pw-seeds");
    dlg.appendChild(el("div", "dlg-title", t("garden.title")));
    dlg.appendChild(el("div", "dlg-msg", t("garden.choose", { n: Number(id) + 1 })));
    var list = el("div", "item-list"), first = null;
    CROP_ORDER.forEach(function (c) {
      var n = have(CROPS[c].seed);
      if (n < 1) return;
      var b = smallBtn(t("garden.plant"), "primary", function () { dlg.close(); doPlant(id, c); });
      if (!first) first = b;
      list.appendChild(itemRow(CROPS[c].seed, t("item." + c) + " · " + fmtLeft(CROPS[c].d * HOUR), t("count.many", { n: n }), [b]));
    });
    if (!first) list.appendChild(el("div", "dlg-msg", t("garden.noSeeds")));
    dlg.appendChild(list);
    var c = closeRow(dlg);
    document.body.appendChild(dlg);
    dlg.showModal();
    (first || c).focus();
  }

  function digDialog(id) {
    var p = garden.plots[id];
    if (!p) return;
    var dlg = makeDialog("pw-dig");
    dlg.appendChild(el("div", "dlg-msg", t("garden.digConfirm", {
      crop: CROPS[p.s] ? t("item." + p.s) : "?", n: Number(id) + 1 })));
    var acts = el("div", "dlg-actions");
    var no = button(t("garden.cancel"), "", function () { dlg.close(); });
    acts.appendChild(no);
    acts.appendChild(button(t("garden.digYes"), "danger", function () { dlg.close(); doDig(id); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    no.focus();
  }

  // ---------- 8c. Walks and the nest (phase 3) ----------
  function clockHM(ts) {
    var d = new Date(ts), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function lootList(got) {
    return MATERIALS.concat(CROP_ORDER.map(function (c) { return CROPS[c].seed; }), FINDS)
      .filter(function (k) { return got[k]; })
      .map(function (k) { return t("item." + k) + " " + t("count.many", { n: got[k] }); }).join(", ");
  }

  function walkDialog() {
    if (!snap) return;
    var dlg = makeDialog("pw-walk"), now = Date.now(), first = null;
    dlg.appendChild(el("div", "dlg-title", t("walk.title")));
    if (away) {
      dlg.appendChild(el("div", "dlg-msg", t("walk.away", { name: snap.name, time: clockHM(away.end), left: fmtLeft(away.end - now) })));
    } else {
      var why = snap.asleep ? t("walk.asleep", { name: snap.name })
              : snap.energy < WALK_ENERGY ? t("walk.tired", { name: snap.name }) : "";
      dlg.appendChild(el("div", "dlg-msg", why || t("walk.msg", { name: snap.name })));
      var list = el("div", "item-list");
      WALKS.forEach(function (m) {
        var go = smallBtn(t("walk.go"), "primary", function () { dlg.close(); doWalk(m); });
        go.disabled = !!why;
        if (!first && !why) first = go;
        list.appendChild(itemRow("walk", t("walk." + m), null, [go], t("walk.len", { m: m })));
      });
      dlg.appendChild(list);
    }
    var c = closeRow(dlg);
    document.body.appendChild(dlg);
    dlg.showModal();
    (first || c).focus();
  }

  function doWalk(min) {
    if (!snap || snap.asleep || away || snap.energy < WALK_ENERGY) return;
    var now = Date.now(), next = startWalk(nest, deviceId(), min, now);
    if (next === nest) return;
    nest = next;
    saveNest();
    away = activeWalk(nest, now);
    try { localStorage.setItem(SEEN_KEY, String(away ? away.s : 0)); } catch (e) {}
    var b = bridge();
    if (b) say(b.line("speech.happy"));
    showToast(t("toast.walkOff", { name: snap.name, time: clockHM(away ? away.end : now) }));
    renderUI();
  }

  // The last walk ended and this device has not welcomed the pet home
  // yet: show what it found (once per walk per device).
  function welcomeHome() {
    if (!snap || away) return;
    var w = lastWalk(nest);
    if (!w || w.end > Date.now()) return;
    var seen = 0;
    try { seen = Number(localStorage.getItem(SEEN_KEY)) || 0; } catch (e) {}
    if (seen > w.s) return;
    try { localStorage.setItem(SEEN_KEY, String(w.s + 1)); } catch (e) {}
    var list = lootList(lootOf(w.dev, w.s, w.d));
    var msg = list ? t("toast.back", { name: snap.name, list: list }) : t("toast.backEmpty", { name: snap.name });
    showToast(msg);
    announce(msg);
    say(pick(t("say.back")));
    // older finished walks of THIS device's row fold into its sum
    var dev = deviceId(), folded = foldWalks(nest, dev, Date.now());
    if (folded !== nest) { nest = folded; saveNest(); }
  }

  function costLine(cost) {
    return Object.keys(cost).map(function (k) {
      return t("item." + k) + " " + Math.min(have(k), cost[k]) + "/" + cost[k];
    }).join(" · ");
  }

  function nestDialog() {
    if (!snap) return;
    var dlg = makeDialog("pw-nest"), st = nestStage(nest), first = null;
    dlg.appendChild(el("div", "dlg-title", t("nest.title")));
    dlg.appendChild(el("div", "dlg-msg", st === 0 ? t("nest.none")
      : st >= NEST.length ? t("nest.done", { name: snap.name }) : t("nest.stage", { k: st })));
    var list = el("div", "item-list");
    var row = function (def, title, needTitle) {
      var b = buildable(def.id, nest), acts = [], sub;
      if (nest.built[def.id]) {
        sub = t("nest.built");
      } else if (!b.ok) {
        sub = t("nest.locked", { stage: needTitle });
      } else {
        sub = costLine(def.cost);
        var afford = Object.keys(def.cost).every(function (k) { return have(k) >= def.cost[k]; });
        var go = smallBtn(t("nest.build"), "primary", function () { dlg.close(); doBuild(def.id, title); });
        go.disabled = !afford;
        if (afford && !first) first = go;
        acts.push(go);
      }
      list.appendChild(itemRow(def.id.charAt(0) === "n" ? "nest" : (def.id === "flowers" ? "sunflower" : def.id === "path" ? "pebble" : def.id === "garland" ? "leaf" : "twig"),
        sub, null, acts, title));
    };
    NEST.forEach(function (def, i) { row(def, t("nest." + def.id), i ? t("nest." + NEST[i - 1].id) : ""); });
    list.appendChild(el("div", "item-head", t("nest.decor")));
    DECOR.forEach(function (def) { row(def, t("nest." + def.id), t("nest." + NEST[def.needs - 1].id)); });
    dlg.appendChild(list);
    var c = closeRow(dlg);
    document.body.appendChild(dlg);
    dlg.showModal();
    (first || c).focus();
  }

  function doBuild(id, title) {
    var before = nestStage(nest), next = buildNest(nest, id, Date.now(), have);
    if (next === nest) return;
    nest = next;
    saveNest();
    if (snap && !snap.asleep && !away) walkTo(sleepX + (id === "path" ? 8 * U : 0));
    if (before < NEST.length && nestStage(nest) === NEST.length) {
      showToast(t("toast.nestDone", { name: snap ? snap.name : "" }));
      if (!away) addHearts();
    } else showToast(t("toast.built", { what: title }));
    if (snap && !snap.asleep && !away) { var b = bridge(); if (b) say(b.line("speech.happy")); }
  }

  // ---------- Garden actions ----------
  function plotCenter(id) {
    var r = plotRects()[Number(id)];
    return r ? r.x + r.w / 2 : pet.x;
  }
  function goToPlot(id) {
    if (snap && !snap.asleep && !away && pet.mode !== "eat") walkTo(plotCenter(id) - petWidth() / 2);
  }
  function doPlant(id, crop) {
    var seed = CROPS[crop] && CROPS[crop].seed;
    if (!seed || have(seed) < 1) return;
    var next = plantSeed(garden, id, crop, Date.now());
    if (next === garden) return;
    garden = next;
    data = ledger(data, deviceId(), seed, 0, 1);
    saveGarden();
    save();
    goToPlot(id);
    showToast(t("toast.planted", { crop: t("item." + crop), n: Number(id) + 1 }));
  }
  function doWater(id) {
    var next = waterPlot(garden, id, Date.now());
    if (next === garden) return;
    garden = next;
    saveGarden();
    goToPlot(id);
    showToast(t("toast.watered", { n: Number(id) + 1 }));
  }
  function doHarvest(id) {
    var res = harvestPlot(garden, id, Date.now());
    var keys = Object.keys(res.got);
    if (!keys.length) return;
    garden = res.g;
    saveGarden();
    goToPlot(id);
    var list = keys.map(function (k) { return t("item." + k) + " " + t("count.many", { n: res.got[k] }); }).join(", ");
    showToast(t("toast.harvest", { list: list }));
    announce(t("toast.harvest", { list: list }));
    if (snap && !snap.asleep) { var b = bridge(); if (b) say(b.line("speech.happy")); }
  }
  function doDig(id) {
    var next = digUp(garden, id, Date.now());
    if (next === garden) return;
    garden = next;
    saveGarden();
    showToast(t("toast.dug", { n: Number(id) + 1 }));
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
      if (e.code === "KeyF") { e.preventDefault(); doFeed("kibble"); }
      else if (e.code === "KeyG") { e.preventDefault(); gardenDialog(null); }
      else if (e.code === "KeyB") { e.preventDefault(); bagDialog(); }
      else if (e.code === "KeyW") { e.preventDefault(); walkDialog(); }
      else if (e.code === "KeyN") { e.preventDefault(); nestDialog(); }
      else if (e.code === "KeyP") { e.preventDefault(); doPat(); }
      else if (e.code === "KeyS") { e.preventDefault(); doSleep(); }
      else if (e.key === "ArrowLeft" && snap && !snap.asleep && !away) { e.preventDefault(); walkTo(pet.x - 8 * U); }
      else if (e.key === "ArrowRight" && snap && !snap.asleep && !away) { e.preventDefault(); walkTo(pet.x + 8 * U); }
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
    api.registerSlice("petgarden", gardenSliceGet, gardenSliceSet, GARDEN_KEY, mergeGarden);
    api.registerSlice("petnest", nestSliceGet, nestSliceSet, NEST_KEY, mergeNest);
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

  function gardenSliceGet() {
    return mergeGarden(garden, null);   // canonical copy (R26)
  }

  function gardenSliceSet(incoming) {
    if (!incoming || typeof incoming !== "object") return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      garden = mergeGarden(incoming, null);
      localStorage.setItem(GARDEN_KEY, JSON.stringify(garden));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
  }

  function nestSliceGet() {
    return mergeNest(nest, null);   // canonical copy (R26)
  }

  function nestSliceSet(incoming) {
    if (!incoming || typeof incoming !== "object") return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      nest = mergeNest(incoming, null);
      localStorage.setItem(NEST_KEY, JSON.stringify(nest));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
  }

  // ---------- 12. Wiring & boot ----------
  function tick() {
    curL = skyAt(hourNow()).light;
    var before = snap ? snap.id : null;
    refreshSnap();
    if (snap && before && snap.id !== before) { spriteCache = {}; warned = { food: false, happy: false, energy: false }; }
    away = activeWalk(nest, Date.now());
    welcomeHome();
    renderUI();
    checkWarnings();
    checkBinding();
  }

  function wire() {
    $("feed-btn").addEventListener("click", feedButton);
    $("garden-btn").addEventListener("click", function () { gardenDialog(null); });
    $("bag-btn").addEventListener("click", bagDialog);
    $("walk-btn").addEventListener("click", walkDialog);
    $("nest-btn").addEventListener("click", nestDialog);
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
    away = activeWalk(nest, Date.now());
    if (away) { pet.mode = "gone"; pet.x = W + U; }
    else if (snap && snap.asleep) pet.x = sleepX;
    wire();
    tick();
    if (snap && !away) setTimeout(function () { var b = bridge(); if (b && !away) say(b.line(snap.asleep ? "speech.sleep" : "speech.hello")); }, 500);
    startLoop();
  }

  boot();
})();
