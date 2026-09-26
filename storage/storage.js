// ============================================================
// orOS Storage v0.1.1 — Home inventory (Wave 1 core)
// Hierarchy: Space → Room → Furniture → Position → Items
//
// v0.1.1 — post-audit pass (fixes #3,#5,#6,#7,#15,#16,#18):
//   - strict mergeRow() normalizer: NO volatile defaults inside
//     the merge (no uid(), no Date.now()) — malformed rows are
//     dropped, so both devices compute byte-identical merges
//   - dbLoad backs up unreadable raw data to oros-storage-data-
//     broken BEFORE re-seeding (destructive re-seed eliminated)
//   - qty floor enforced via Math.max(1, Math.floor())
//   - sliceSet sanitizes the nav target (remote deletes can kill
//     the entity the user is currently viewing)
//   - dead code removed: prevIds, LEVEL_ORDER, unused STRINGS
//
// Architecture mirrored 1:1 from the mature orOS apps (mood.js):
//   IIFE · "use strict" · ES5 vars · STRINGS (en/el) + t() ·
//   bilingual seeds { bi } until first rename · flat entity
//   array { ver, ents } · tombstone deletes · registerSlice with
//   deterministic mergeFn · lazy toast · palette inheritance.
// ============================================================
(function () {
  "use strict";

  // ===== VERSION & LANGUAGE =====
  var SCRIPT_V = "0.1.2";
  var LANG = "en";
  try {
    LANG = (window.parent && window.parent.orosLang) ||
           window.orosLang ||
           (localStorage.getItem("oros-lang") === "el" ? "el" : "en");
    if (LANG !== "el" && LANG !== "en") LANG = "en";
  } catch (e) { /* cross-origin edge — default EN */ }

  // ===== STRINGS =====
  var STRINGS = {
    en: {
      "home":             "Home",
      "add.space":        "Add space",
      "add.room":        "Add room",
      "add.furniture":    "Add furniture",
      "add.position":     "Add position",
      "add.item":         "Add item",
      "name.label":       "Name",
      "qty.label":        "Quantity",
      "note.label":       "Note (optional)",
      "rename":           "Rename",
      "del":              "Delete",
      "cancel":           "Cancel",
      "save":             "Save",
      "confirm.del.space":   "Delete this space and EVERYTHING inside it?",
      "confirm.del.room":    "Delete this room and everything inside it?",
      "confirm.del.furn":    "Delete this furniture and everything inside it?",
      "confirm.del.pos":     "Delete this position and everything inside it?",
      "confirm.del.item":    "Delete this item?",
      "empty.space":       "No spaces yet — create your first one.",
      "empty.room":        "No rooms in this space yet.",
      "empty.furniture":   "No furniture in this room yet.",
      "empty.position":    "No positions on this furniture yet.",
      "empty.item":        "No items in this position yet.",
      "contains":          "{n} inside",
      "contains.items":    "{n} items",
      "toast.saved":      "Saved",
      "toast.deleted":    "Deleted",
      "toast.name.req":   "Name is required",
      "back":             "Back"
    },
    el: {
      "home":             "Σπίτι",
      "add.space":        "Προσθήκη χώρου",
      "add.room":        "Προσθήκη δωματίου",
      "add.furniture":    "Προσθήκη επίπλου",
      "add.position":     "Προσθήκη θέσης",
      "add.item":         "Προσθήκη αντικειμένου",
      "name.label":       "Όνομα",
      "qty.label":        "Ποσότητα",
      "note.label":       "Σημείωση (προαιρετικό)",
      "rename":           "Μετονομασία",
      "del":              "Διαγραφή",
      "cancel":           "Άκυρο",
      "save":             "Αποθήκευση",
      "confirm.del.space":   "Διαγραφή αυτού του χώρου και ΟΛΩΝ των περιεχομένων;",
      "confirm.del.room":    "Διαγραφή αυτού του δωματίου και όλων των περιεχομένων;",
      "confirm.del.furn":    "Διαγραφή αυτού του επίπλου και όλων των περιεχομένων;",
      "confirm.del.pos":     "Διαγραφή αυτής της θέσης και όλων των περιεχομένων;",
      "confirm.del.item":    "Διαγραφή αυτού του αντικειμένου;",
      "empty.space":       "Κανείς χώρος ακόμα — δημιούργησε τον πρώτο σου.",
      "empty.room":        "Κανένα δωμάτιο σε αυτόν τον χώρο ακόμα.",
      "empty.furniture":   "Κανένα έπιπλο σε αυτό το δωμάτιο ακόμα.",
      "empty.position":    "Καμία θέση σε αυτό το έπιπλο ακόμα.",
      "empty.item":        "Κανένα αντικείμενο σε αυτή τη θέση ακόμα.",
      "contains":          "{n} μέσα",
      "contains.items":    "{n} αντικείμενα",
      "toast.saved":      "Αποθηκεύτηκε",
      "toast.deleted":    "Διαγράφτηκε",
      "toast.name.req":   "Απαιτείται όνομα",
      "back":             "Πίσω"
    }
  };

  function t(key) {
    var p = STRINGS[LANG] || {};
    if (p[key] !== undefined) return p[key];
    if (STRINGS.en[key] !== undefined) return STRINGS.en[key];
    return key;
  }
  function fmt(key, n) {
    return t(key).replace("{n}", String(n));
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ===== CONSTANTS & HIERARCHY =====
  var DATA_KEY = "oros-storage-data";
  var BROKEN_KEY = "oros-storage-data-broken";   // local rescue copy, never synced
  var DATA_VER = 1;
  var TOMB_PRUNE_DAYS = 30;   // ST-1: payload-only tombstone cutoff
  var DAY_MS          = 24 * 60 * 60 * 1000;

  // type → child type; the drill-down spine of the app
  var LEVELS = {
    space:     { child: "room",     depth: 0 },
    room:      { child: "furniture", depth: 1 },
    furniture: { child: "position", depth: 2 },
    position:  { child: "item",     depth: 3 },
    item:      { child: null,       depth: 4 }
  };

  // ===== SEEDS (bilingual until first rename) =====
  var SEEDS = [
    { id: "seed-sp-home", type: "space", bi: { en: "Home", el: "Σπίτι" }, pos: 0 }
  ];

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ===== DATA LAYER =====
  var db = null;   // in-memory state; persisted atomically on every mutation

  // Local-write normalizer: fills in defaults for rows WE create
  // or sanitize on load/normalize. Never used inside the merge —
  // see mergeRow() for the strict, volatility-free counterpart.
  function entDefaults(raw) {
    return {
      id:       (typeof raw.id === "string" && raw.id) ? raw.id : uid(),
      type:     (LEVELS[raw.type] ? raw.type : null),
      name:     (typeof raw.name === "string") ? raw.name : "",
      bi:       (raw.bi && typeof raw.bi === "object" &&
                 (raw.bi.en || raw.bi.el)) ? { en: raw.bi.en || "", el: raw.bi.el || "" } : null,
      parentId: (typeof raw.parentId === "string" && raw.parentId) ? raw.parentId : null,
      qty:      (raw.type === "item" && typeof raw.qty === "number" &&
                 isFinite(raw.qty) && raw.qty > 0)
                  ? Math.max(1, Math.floor(raw.qty))
                  : (raw.type === "item" ? 1 : undefined),
      note:     (raw.type === "item" && typeof raw.note === "string")
                  ? raw.note.slice(0, 300) : undefined,
      pos:      (typeof raw.pos === "number" && isFinite(raw.pos)) ? raw.pos : 0,
      mtime:    (typeof raw.mtime === "number" && isFinite(raw.mtime)) ? raw.mtime : Date.now(),
      del:      !!raw.del
    };
  }

  // Display name: an explicit rename (plain string) beats the seed's
  // bilingual pair; seeds resolve per active language until then.
  function nameOf(e) {
    if (e.name) return e.name;
    if (e.bi) return LANG === "el" ? (e.bi.el || e.bi.en) : (e.bi.en || e.bi.el);
    return "";
  }

  // LOAD with rescue backup (#5): if the stored raw data cannot be
  // parsed or normalized, copy it verbatim to BROKEN_KEY before we
  // give up — dbInit's re-seed can then no longer destroy the only
  // copy. BROKEN_KEY is deliberately NOT part of any sync slice.
  function dbLoad() {
    var raw = null;
    try { raw = localStorage.getItem(DATA_KEY); } catch (e) { raw = null; }
    if (!raw) return null;

    function rescue(reason, err) {
      try { localStorage.setItem(BROKEN_KEY, raw); } catch (e2) { /* quota — nothing more we can do */ }
      console.error("[orOS] storage: " + reason +
                    " — raw data backed up to " + BROKEN_KEY, err || "");
    }

    var obj = null;
    try { obj = JSON.parse(raw); }
    catch (parseErr) { rescue("dbLoad parse failed", parseErr); return null; }

    var norm = normalize(obj);
    if (!norm) { rescue("dbLoad shape invalid"); return null; }
    return norm;
  }

  function dbPersist() {
    try { localStorage.setItem(DATA_KEY, JSON.stringify(db)); }
    catch (e) { console.error("[orOS] storage: persist failed:", e); }
  }

  // MIGRATE / NORMALIZE — never destructive: every inbound entity
  // passes entDefaults (known types only, qty floor, note clamp),
  // then dedupe by id (first occurrence wins).
  function normalize(obj) {
    if (!obj || typeof obj !== "object" || !Array.isArray(obj.ents)) return null;
    var seen = {}, ents = [];
    for (var i = 0; i < obj.ents.length; i++) {
      var e = entDefaults(obj.ents[i]);
      if (!e.type) continue;              // garbage — cannot exist anywhere
      if (seen[e.id]) continue;           // dedupe by id
      seen[e.id] = true;
      ents.push(e);
    }
    return { ver: DATA_VER, ents: ents };
  }

  function seedDb() {
    var ents = [], now = Date.now();
    SEEDS.forEach(function (s, i) {
      var e = entDefaults({
        id: s.id, type: s.type, bi: s.bi,
        parentId: null, pos: i, mtime: now, del: false
      });
      ents.push(e);
    });
    return { ver: DATA_VER, ents: ents };
  }

  function dbInit() {
    db = dbLoad();
    if (!db) { db = seedDb(); dbPersist(); }
  }

  // ===== QUERY HELPERS =====
  function children(type, parentId) {
    var out = [];
    for (var i = 0; i < db.ents.length; i++) {
      var e = db.ents[i];
      if (e.type === type && e.parentId === parentId && !e.del) out.push(e);
    }
    out.sort(function (a, b) { return a.pos - b.pos || (a.id < b.id ? -1 : 1); });
    return out;
  }

  function byId(id) {
    for (var i = 0; i < db.ents.length; i++) {
      if (db.ents[i].id === id) return db.ents[i];
    }
    return null;
  }

  // Recursive descendant count (for "3 inside" meta)
  function countDescendants(id) {
    var n = 0;
    for (var i = 0; i < db.ents.length; i++) {
      var e = db.ents[i];
      if (!e.del && e.parentId === id) n += 1 + countDescendants(e.id);
    }
    return n;
  }

  // ===== MUTATIONS (all funnel through save()) =====
  function touch(e) { e.mtime = Date.now(); }

  function save() {
    dbPersist();
    if (syncApi && typeof syncApi.markDirty === "function") {
      syncApi.markDirty();
    }
  }

  function addEnt(type, parentId, name, extra) {
    var e = entDefaults({
      id: uid(), type: type, name: String(name || "").trim(),
      parentId: parentId || null,
      pos: children(type, parentId || null).length,
      qty: (extra && extra.qty),
      note: (extra && extra.note),
      mtime: Date.now(), del: false
    });
    db.ents.push(e);
    save();
    return e;
  }

  function renameEnt(e, name) {
    e.name = String(name || "").trim();
    e.bi = null;                  // a rename kills the seed's bilingual name
    touch(e);
    save();
  }

  // Delete with cascade: descendants get tombstoned too (tombstones
  // propagate through merge — a delete made on ANY device wins).
  function deleteEnt(e) {
    function tombRecursive(id) {
      for (var i = 0; i < db.ents.length; i++) {
        var c = db.ents[i];
        if (c.parentId === id && !c.del) { c.del = true; touch(c); tombRecursive(c.id); }
      }
    }
    e.del = true;
    touch(e);
    tombRecursive(e.id);
    save();
  }

  function setQty(e, delta) {
    var q = (typeof e.qty === "number" ? e.qty : 1) + delta;
    e.qty = q < 1 ? 1 : q;        // Wave 1 floor: quantity never below 1
    touch(e);
    save();
  }

  // ===== MERGE ENGINE =====
  // STRICT merge-side normalizer (#6): unlike entDefaults, this one
  // introduces NO volatile values — no uid(), no Date.now(). Any row
  // missing a valid id / type / mtime is DROPPED, because a dropped
  // row is a deterministic outcome on every device, while an
  // invented id or timestamp would produce divergent outputs and
  // trip sync.js's divergence guard.
  function mergeRow(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.id !== "string" || !raw.id) return null;
    if (!LEVELS[raw.type]) return null;
    if (!(typeof raw.mtime === "number" && isFinite(raw.mtime))) return null;

    var e = {
      id:       raw.id,
      type:     raw.type,
      name:     (typeof raw.name === "string") ? raw.name : "",
      bi:       (raw.bi && typeof raw.bi === "object" &&
                 (raw.bi.en || raw.bi.el)) ? { en: raw.bi.en || "", el: raw.bi.el || "" } : null,
      parentId: (typeof raw.parentId === "string" && raw.parentId) ? raw.parentId : null,
      pos:      (typeof raw.pos === "number" && isFinite(raw.pos)) ? raw.pos : 0,
      mtime:    raw.mtime,
      del:      !!raw.del
    };
    if (raw.type === "item") {
      e.qty = (typeof raw.qty === "number" && isFinite(raw.qty) && raw.qty >= 1)
                ? Math.max(1, Math.floor(raw.qty)) : 1;
      e.note = (typeof raw.note === "string") ? raw.note.slice(0, 300) : undefined;
    }
    return e;
  }

  // union by id · LWW by mtime · tombstone wins ties · deterministic
  // (tie-breaks: bigger mtime, then del===true, then bigger qty,
  //  then lexicographic id — identical inputs yield identical
  //  output on every device)
  function mergeEnts(localArr, remoteArr) {
    var map = {};
    function put(e) { map[e.id] = e; }

    var i, r, l, ex;
    for (i = 0; i < remoteArr.length; i++) {
      r = mergeRow(remoteArr[i]);
      if (r) put(r);
    }
    for (i = 0; i < localArr.length; i++) {
      l = mergeRow(localArr[i]);
      if (!l) continue;
      ex = map[l.id];
      if (!ex) { put(l); continue; }
      // Same id on both sides — resolve deterministically:
      if (l.mtime > ex.mtime) put(l);
      else if (l.mtime < ex.mtime) put(ex);
      else if (l.del !== ex.del) put(l.del ? l : ex);         // tie → tombstone wins
      else if (typeof l.qty === "number" && typeof ex.qty === "number" &&
               l.qty !== ex.qty) put(l.qty > ex.qty ? l : ex); // tie → bigger qty
      else put((l.id || "") <= (ex.id || "") ? l : ex);         // final tie-break
    }

    var out = [];
    for (var k in map) if (map.hasOwnProperty(k)) out.push(map[k]);
    out.sort(function (a, b) { return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); });
    return out;
  }

  // mergeData(local, remote) → merged — called by sync.js (both inputs
  // pre-cloned by the engine). Returned shape feeds sliceSet + push.
  function mergeData(local, remote) {
    if (!local || !remote) return remote || local || null;
    return {
      ver: Math.max(local.ver || 1, remote.ver || 1),
      ents: mergeEnts(local.ents || [], remote.ents || [])
    };
  }

  // ===== SYNC REGISTRATION =====
  var syncApi = null;
  try {
    syncApi = (window.parent && window.parent.orosSync) || window.orosSync || null;
  } catch (e) { syncApi = window.orosSync || null; }

  function sliceGet() {
    // ST-1: deterministic tombstone pruning (HB-3 / MD-4 / NT-2
    // pattern — Prompter PR-2 / Quote Q-1 parity). The cutoff
    // derives from the dataset's newest mtime, never the wall
    // clock — same data yields the same payload on every device
    // at any time. Payload-only: db keeps every tombstone, so a
    // lagging device can never resurrect a deleted entity.
    var maxTs = 0;
    for (var mi = 0; mi < db.ents.length; mi++) {
      if ((db.ents[mi].mtime || 0) > maxTs) maxTs = db.ents[mi].mtime;
    }
    var CUTOFF = maxTs - TOMB_PRUNE_DAYS * DAY_MS;
    var ents = [];
    for (var i = 0; i < db.ents.length; i++) {
      var e = db.ents[i];
      if (e.del && e.mtime < CUTOFF) continue;
      ents.push(e);
    }
    return { ver: db.ver, ents: ents };
  }

  // Nav-target sanitizer (#3): if the entity the user is currently
  // viewing was deleted or vanished remotely, climb to the nearest
  // SURVIVING ancestor — never render a dead reference. (nav, byId
  // and friends are declared further below; function hoisting makes
  // this safe — sliceSet only ever runs after boot completes.)
  function sanitizeNav() {
    if (!nav.id) return;
    var cur = byId(nav.id);
    if (!cur) { nav.id = null; return; }   // pruned entirely — no ancestry to follow
    if (!cur.del) return;                  // alive — keep
    while (cur && cur.del && cur.parentId) cur = byId(cur.parentId);
    nav.id = (cur && !cur.del) ? cur.id : null;
  }

  function sliceSet(data, info) {
    if (!data || typeof data !== "object" || !Array.isArray(data.ents)) return;
    var next = normalize({ ver: data.ver, ents: data.ents });
    if (!next) return;
    db = next;
    dbPersist();
    sanitizeNav();               // BEFORE render — no dead-target empty states
    render();
    // ST-2: per-sync toast removed (Notes Wave 11 doctrine) —
    // info.merged means "the merge engine ran", not "data changed".
    // Sync feedback = the taskbar sync dot, never a per-sync toast.
  }

  function registerSync() {
    if (!syncApi || typeof syncApi.registerSlice !== "function") return;
    syncApi.registerSlice("storage", sliceGet, sliceSet, DATA_KEY, mergeData);
  }

    // ===== NAVIGATION & RENDER =====

  // nav.id === null → root (list of spaces). Navigating INTO a
  // non-item entity shows its children. Items are leaves — no nav.
  var nav = { id: null };

  // Inline SVG icon set (ForkAwesome exiled, handcrafted forever)
  var ICO = {
    space:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>',
    room:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="1.5"/><circle cx="15.5" cy="12" r="1.2"/></svg>',
    furniture: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="7" rx="1.5"/><path d="M5 11v9M19 11v9M9.5 8.5h5"/></svg>',
    position:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 15h16M12 4v16"/></svg>',
    item:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/></svg>',
    plus:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    pencil:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4L8 20l-5 1 1-5z"/></svg>',
    trash:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>',
    chev:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>'
  };

  function iconSvg(type) {
    return '<span class="ico">' + (ICO[type] || ICO.item) + '</span>';
  }

  // Child type listed at the current nav position
  function childTypeFor(navId) {
    if (!navId) return "space";
    var ent = byId(navId);
    if (!ent) return "space";
    return LEVELS[ent.type] ? (LEVELS[ent.type].child || "item") : "space";
  }

  // Desktop split view: the scrolling element is .main-pane, not
  // #view (#8 in v0.1.0) — reset whichever is present.
  function resetScroll() {
    var view = document.getElementById("view");
    if (!view) return;
    view.scrollTop = 0;
    var pane = view.querySelector(".main-pane");
    if (pane) pane.scrollTop = 0;
  }

  function goTo(id) {
    nav.id = id;
    render();
    resetScroll();
  }

  function goUp() {
    if (!nav.id) return;
    var ent = byId(nav.id);
    goTo(ent ? ent.parentId : null);
  }

  // Breadcrumb chain: root → … → current entity
  function chainFor(id) {
    var chain = [];
    var cur = id ? byId(id) : null;
    while (cur && !cur.del) {
      chain.unshift(cur);
      cur = cur.parentId ? byId(cur.parentId) : null;
    }
    return chain;
  }

  function renderCrumbs() {
    var host = document.getElementById("crumbs");
    host.innerHTML = "";

    var home = document.createElement("button");
    home.className = "crumb" + (nav.id ? "" : " active");
    home.type = "button";
    home.textContent = t("home");
    home.addEventListener("click", function () { goTo(null); });
    host.appendChild(home);

    var chain = chainFor(nav.id);
    for (var i = 0; i < chain.length; i++) {
      (function (ent, isLast) {
        var sep = document.createElement("span");
        sep.className = "sep";
        sep.textContent = "›";
        host.appendChild(sep);
        var c = document.createElement("button");
        c.className = "crumb" + (isLast ? " active" : "");
        c.type = "button";
        c.textContent = nameOf(ent);
        c.addEventListener("click", function () { goTo(ent.id); });
        host.appendChild(c);
      })(chain[i], i === chain.length - 1);
    }
  }

  // ----- Content pane (shared: mobile main + desktop main-pane) -----

  function mkEmpty(typeKey) {
    var box = document.createElement("div");
    box.className = "empty";
    box.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M3 7l2-4h14l2 4"/><path d="M10 11h4"/></svg>' +
      '<div>' + esc(t(typeKey)) + '</div>';
    return box;
  }

  // Entity card (space/room/furniture/position) — tap to drill in
  function mkEntCard(ent) {
    var row = document.createElement("div");
    row.className = "item-row";
    row.setAttribute("role", "button");
    row.tabIndex = 0;

    var info = document.createElement("div");
    info.className = "item-info";
    var nm = document.createElement("div");
    nm.className = "item-name";
    nm.innerHTML = iconSvg(ent.type) + esc(nameOf(ent));
    var meta = document.createElement("div");
    meta.className = "item-meta";
    var childT = LEVELS[ent.type].child;
    var n = countDescendants(ent.id);
    if (childT === "item") meta.textContent = fmt("contains.items", n);
    else if (n) meta.textContent = fmt("contains", n);
    info.appendChild(nm);
    info.appendChild(meta);
    row.appendChild(info);

    var acts = document.createElement("div");
    acts.className = "card-actions";

    var ren = mkIconBtn(ICO.pencil, t("rename"), function (ev) {
      ev.stopPropagation();
      openEntityDialog("rename", ent);
    });
    acts.appendChild(ren);

    var del = mkIconBtn(ICO.trash, t("del"), function (ev) {
      ev.stopPropagation();
      openConfirmDialog(ent);
    });
    acts.appendChild(del);

    var chev = mkIconBtn(ICO.chev, nameOf(ent), function () { goTo(ent.id); });
    acts.appendChild(chev);

    row.appendChild(acts);

    row.addEventListener("click", function () { goTo(ent.id); });
    row.addEventListener("keydown", function (e) {
      if (e.key === "Enter") goTo(ent.id);
    });
    return row;
  }

  // Item row — leaf: qty −/+ controls, edit, delete
  function mkItemRow(ent) {
    var row = document.createElement("div");
    row.className = "item-row";

    var info = document.createElement("div");
    info.className = "item-info";
    var nm = document.createElement("div");
    nm.className = "item-name";
    nm.innerHTML = iconSvg("item") + esc(nameOf(ent));
    info.appendChild(nm);
    if (ent.note) {
      var meta = document.createElement("div");
      meta.className = "item-meta";
      meta.textContent = ent.note;
      info.appendChild(meta);
    }
    row.appendChild(info);

    var qty = document.createElement("div");
    qty.className = "qty-controls";
    var minus = document.createElement("button");
    minus.type = "button";
    minus.className = "qty-btn";
    minus.setAttribute("aria-label", "−1");
    minus.textContent = "−";
    minus.addEventListener("click", function () { setQty(ent, -1); paintQty(); });
    qty.appendChild(minus);
    var val = document.createElement("span");
    val.className = "qty-val";
    val.textContent = String(ent.qty);
    qty.appendChild(val);
    var plus = document.createElement("button");
    plus.type = "button";
    plus.className = "qty-btn";
    plus.setAttribute("aria-label", "+1");
    plus.textContent = "+";
    plus.addEventListener("click", function () { setQty(ent, 1); paintQty(); });
    qty.appendChild(plus);
    row.appendChild(qty);

    function paintQty() { val.textContent = String(ent.qty); }

    var acts = document.createElement("div");
    acts.className = "card-actions";
    acts.appendChild(mkIconBtn(ICO.pencil, t("rename"), function () {
      openEntityDialog("rename", ent);
    }));
    acts.appendChild(mkIconBtn(ICO.trash, t("del"), function () {
      openConfirmDialog(ent);
    }));
    row.appendChild(acts);
    return row;
  }

  function mkIconBtn(svg, label, fn) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "btn ghost";
    b.setAttribute("aria-label", label || "");
    b.setAttribute("title", label || "");
    b.innerHTML = svg;
    b.addEventListener("click", fn);
    return b;
  }

  function paneContent() {
    var childT = childTypeFor(nav.id);
    var wrap = document.createElement("div");
    wrap.className = "content-pane";

    var kids = children(childT, nav.id);
    if (!kids.length) {
      wrap.appendChild(mkEmpty("empty." + childT));
      return wrap;
    }

    var list = document.createElement("div");
    list.className = "item-list";
    for (var i = 0; i < kids.length; i++) {
      list.appendChild(childT === "item" ? mkItemRow(kids[i]) : mkEntCard(kids[i]));
    }
    wrap.appendChild(list);
    return wrap;
  }

  // ----- Desktop sidebar tree (≥1024px) -----

  function treeContent() {
    var tree = document.createElement("ul");
    tree.className = "tree";
    buildTreeLevel(tree, "space", null, 0);
    return tree;
  }

  function buildTreeLevel(host, type, parentId, depth) {
    var kids = children(type, parentId);
    for (var i = 0; i < kids.length; i++) {
      (function (ent) {
        var li = document.createElement("li");
        li.setAttribute("data-depth", String(depth));
        var it = document.createElement("div");
        it.className = "item" + (nav.id === ent.id ? " active" : "");
        it.setAttribute("role", "button");
        it.tabIndex = 0;
        it.innerHTML = iconSvg(ent.type) + "<span>" + esc(nameOf(ent)) + "</span>";
        it.addEventListener("click", function () { goTo(ent.id); });
        it.addEventListener("keydown", function (e) {
          if (e.key === "Enter") goTo(ent.id);
        });
        li.appendChild(it);
        host.appendChild(li);
        var childT = LEVELS[type].child;
        if (childT) {
          var sub = document.createElement("ul");
          sub.className = "tree";
          buildTreeLevel(sub, childT, ent.id, depth + 1);
          if (sub.children.length) li.appendChild(sub);
        }
      })(kids[i]);
    }
  }

  // ===== MAIN RENDER =====

  function render() {
    renderCrumbs();

    // Top bar: back button + add-button label follow the level
    var back = document.getElementById("btn-back");
    if (nav.id) { back.hidden = false; back.textContent = "‹ " + t("back"); }
    else { back.hidden = true; }

    var childT = childTypeFor(nav.id);
    var add = document.getElementById("btn-add");
    add.innerHTML = ICO.plus + "<span>" + esc(t("add." + childT)) + "</span>";

    // View pane
    var view = document.getElementById("view");
    view.innerHTML = "";

    var desktop = window.matchMedia("(min-width: 1024px)").matches;
    if (desktop) {
      var side = document.createElement("aside");
      side.className = "sidebar";
      side.appendChild(treeContent());
      view.appendChild(side);
      var main = document.createElement("section");
      main.className = "main-pane";
      main.appendChild(paneContent());
      view.appendChild(main);
    } else {
      view.appendChild(paneContent());
    }
  }

  // ===== DIALOGS =====

  // add (target type inferred from current level) / rename (entity)
  function openEntityDialog(mode, ent) {
    var stale = document.getElementById("ent-dialog");
    if (stale) stale.remove();

    var type, parentForAdd;
    if (mode === "add") {
      type = childTypeFor(nav.id);
      parentForAdd = nav.id;
    } else {
      type = ent.type;
    }

    var dlg = document.createElement("dialog");
    dlg.id = "ent-dialog";

    var form = document.createElement("form");
    form.noValidate = true;
    form.className = "dialog-form";

    // Simple title: add → "Add <type>", rename → "Rename" (#10)
    var title = document.createElement("h3");
    title.textContent = (mode === "add") ? t("add." + type) : t("rename");
    form.appendChild(title);

    function mkField(labelKey, inputType, initial) {
      var wrap = document.createElement("div");
      wrap.className = "field";
      var lab = document.createElement("label");
      lab.textContent = t(labelKey);
      wrap.appendChild(lab);
      var inp = document.createElement("input");
      inp.type = inputType;
      inp.value = initial !== undefined ? String(initial) : "";
      if (inputType === "number") { inp.min = "1"; inp.step = "1"; }
      wrap.appendChild(inp);
      form.appendChild(wrap);
      return inp;
    }

    var nameInp = mkField(
      "name.label", "text",
      mode === "rename" ? nameOf(ent) : "");

    var qtyInp = null, noteInp = null;
    if (type === "item") {
      qtyInp = mkField("qty.label", "number", mode === "rename" ? ent.qty : 1);
      noteInp = mkField("note.label", "text", mode === "rename" ? (ent.note || "") : "");
    }

    var errBox = document.createElement("div");
    errBox.className = "dialog-err";
    form.appendChild(errBox);

    var btnRow = document.createElement("div");
    btnRow.className = "dialog-actions";
    var cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn ghost";
    cancelBtn.textContent = t("cancel");
    cancelBtn.addEventListener("click", function () { dlg.close(); });
    btnRow.appendChild(cancelBtn);
    var okBtn = document.createElement("button");
    okBtn.type = "submit";
    okBtn.className = "btn prim";
    okBtn.textContent = t("save");
    btnRow.appendChild(okBtn);
    form.appendChild(btnRow);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      errBox.textContent = "";
      var name = nameInp.value.trim();
      if (!name) { errBox.textContent = t("toast.name.req"); nameInp.focus(); return; }

      if (mode === "add") {
        var extra = {};
        if (type === "item") {
          var q = parseInt(qtyInp.value, 10);
          extra.qty = (isNaN(q) || q < 1) ? 1 : q;
          extra.note = noteInp.value.trim() || undefined;
        }
        addEnt(type, parentForAdd, name, extra);
      } else {
        renameEnt(ent, name);
        if (ent.type === "item") {
          var q2 = parseInt(qtyInp.value, 10);
          ent.qty = (isNaN(q2) || q2 < 1) ? 1 : q2;
          ent.note = noteInp ? (noteInp.value.trim() || undefined) : undefined;
          touch(ent);
          save();
        }
      }
      dlg.close();
      notifyTransient(t("toast.saved"));
      render();
    });

    dlg.appendChild(form);
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) dlg.close();      // outside click = cancel
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    setTimeout(function () { nameInp.focus(); nameInp.select(); }, 50);
  }

  // ===== DELETE (styled confirm dialog, cascade tombstones) =====

  // Native window.confirm replaced by a themed <dialog> in the same
  // idiom as the entity dialog (#12 in v0.1.0): destructive action
  // gets the .btn.danger treatment, outside click + Esc cancel.
  function openConfirmDialog(ent) {
    var stale = document.getElementById("confirm-dialog");
    if (stale) stale.remove();

    var key = {
      space: "confirm.del.space", room: "confirm.del.room",
      furniture: "confirm.del.furn", position: "confirm.del.pos",
      item: "confirm.del.item"
    }[ent.type] || "confirm.del.item";

    var dlg = document.createElement("dialog");
    dlg.id = "confirm-dialog";

    var title = document.createElement("h3");
    title.textContent = t("del") + " — " + nameOf(ent);
    dlg.appendChild(title);

    var body = document.createElement("p");
    body.className = "confirm-body";
    body.textContent = t(key);
    dlg.appendChild(body);

    var btnRow = document.createElement("div");
    btnRow.className = "dialog-actions";
    var cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn ghost";
    cancelBtn.textContent = t("cancel");
    cancelBtn.addEventListener("click", function () { dlg.close(); });
    btnRow.appendChild(cancelBtn);
    var delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn danger";
    delBtn.textContent = t("del");
    delBtn.addEventListener("click", function () {
      dlg.close();
      confirmDelete(ent);
    });
    btnRow.appendChild(delBtn);
    dlg.appendChild(btnRow);

    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) dlg.close();      // outside click = cancel
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    delBtn.focus();
  }

  function confirmDelete(ent) {
    deleteEnt(ent);
    notifyTransient(t("toast.deleted"));
    sanitizeNav();               // shared with sliceSet (#3) — no dead refs
    render();
  }

  // ===== TOAST (lazy) =====

  var toastTimer = null;
  function toast(text) {
    var el = document.getElementById("toast");
    if (!el) return;            // ST-2: stale/embedded HTML guard
    el.textContent = text;
    el.hidden = false;
    requestAnimationFrame(function () { el.classList.add("show"); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove("show");
      setTimeout(function () { el.hidden = true; }, 300);
    }, 2200);
  }
  
    // ST-2: unified notifications doctrine (Wave 6 — mood/kanban/
  // prompter/quote pattern). The module lives in the shell
  // (parent), dynamic resolution; the local toast() above stays
  // as the stale-bundle fallback.
  function notifyTransient(text) {
    try {
      var N = (window.parent && window.parent.orosNotifs) || window.orosNotifs || null;
      if (N && typeof N.transient === "function") { N.transient({ ns: "storage", title: text, body: "" }); return; }
    } catch (e) { /* cross-origin guard */ }
    toast(text);
  }

  // ===== PALETTE INHERITANCE (parent shell) =====

  // mood.js parity (v0.27.00): copy the parent's data-theme
  // attribute + every palette var via setProperty (NEVER cssText
  // += — that APPENDS duplicates instead of replacing on every
  // call). Live skin/theme switches repaint via watchPalette().
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--panel-bg-light", "--border", "--shadow",
                  "--font-stack"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        document.documentElement.style.setProperty(v, cs.getPropertyValue(v).trim());
      });
    } catch (e) { /* standalone — :root fallback palette stands */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone — nothing to watch */ }
  }

  // ===== WIRING =====

  function wireUI() {
    document.getElementById("btn-back").addEventListener("click", goUp);

    document.getElementById("btn-add").addEventListener("click", function () {
      openEntityDialog("add", null);
    });

    // Debounced resize re-render (#9): crossing the 1024px breakpoint
    // swaps mobile drill-down ↔ desktop split tree. Debounce keeps
    // us from re-rendering on every pixel of a window drag.
    var rzTimer = null;
    var lastDesktop = null;
    window.addEventListener("resize", function () {
      clearTimeout(rzTimer);
      rzTimer = setTimeout(function () {
        var desktop = window.matchMedia("(min-width: 1024px)").matches;
        if (lastDesktop === null || desktop !== lastDesktop) {
          lastDesktop = desktop;
          render();
        }
      }, 150);
    });

    // ST-4: Contract B — shell-owned combos (Ctrl+Alt+Shift+*) get
    // the CANONICAL capture-phase forwarding (parity with todo/
    // kanban/writer/notes/prompter/quote). When the shell handles
    // the combo, stopPropagation prevents any app-level keydown
    // from double-reacting to it. Stale bundle (no orosShortcuts)
    // = safe no-op.
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.shiftKey) {
        try {
          if (window.parent.orosShortcuts &&
              typeof window.parent.orosShortcuts.handle === "function" &&
              window.parent.orosShortcuts.handle(e)) {
            e.stopPropagation();
            return;
          }
        } catch (err) {}
      }
      // ST-6: Escape → goUp(), but yield to editable targets first
      // (an Escape closing a native select dropdown must not also
      // navigate up) and never while a dialog is open (Esc cancels
      // dialogs natively).
      if (e.key === "Escape" && nav.id) {
        var tgt = e.target;
        var editable = tgt && (tgt.tagName === "INPUT" ||
          tgt.tagName === "TEXTAREA" || tgt.tagName === "SELECT" ||
          tgt.isContentEditable);
        if (editable) return;
        if (document.querySelector("dialog[open]")) return;
        goUp();
      }
    }, true);

    // Language switch on the shell re-opens the iframe (fresh boot,
    // zero data risk) — nothing else needed here.
  }

  // ===== BOOT =====

  function boot() {
    inheritPalette();
    watchPalette();
    dbInit();
    wireUI();
    render();
    registerSync();
    console.log("[orOS] storage.js v" + SCRIPT_V + " booted");
  }

  boot();
})();