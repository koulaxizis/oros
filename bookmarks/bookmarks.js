/*! ============================================================
 *  orOS Bookmarks — bookmarks.js
 *  A static, offline-first, mobile-first bookmark manager.
 *  Data: localStorage blob "oros-bookmarks-data" (single-blob,
 *  upgradeable to per-entry granularity in a later wave).
 *
 *  SCHEMA v1 (what sanitizeState enforces):
 *    {
 *      ver:     1,
 *      items:   { [id]: { id, url, title, note, folderId,
 *                          tags[], status, visits, lastVisit,
 *                          added, modified } },
 *      folders: { [id]: { id, name, pos, modified } },
 *      deleted: { [id]: epochMs },        // tombstones, 30d prune
 *      settings: {}
 *    }
 *  - "unsorted" is the permanent root folder (undeletable).
 *  - Merge: entity-union by id, newest "modified"/tombstone wins,
 *    deterministic tie-break on canonical JSON (no Date.now()
 *    inside the merge — both devices must compute identically).
 *
 *  Mantra: Offline first, Mobile first, No external deps,
 *          Full manual export, Full auto export, Snapshots,
 *          Auto merge sync, No guessing.
 *  ============================================================ */
(function () {
"use strict";

/* ---------- 0. Constants + tiny utils ---------- */

const SCRIPT_V = (document.currentScript &&
  (document.currentScript.src.match(/[?&]v=(\d[\w.]*)/) || [])[1]) || "dev";
const DATA_KEY = "oros-bookmarks-data";
const ROOT_FOLDER = "unsorted";
const DELETED_PRUNE_DAYS = 30;

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "bm-" + Date.now().toString(36) + "-" +
    Math.random().toString(36).slice(2, 10);
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* Canonical JSON string for deterministic tie-breaks. */
function canon(v) {
  const keys = Object.keys(v).sort();
  return JSON.stringify(keys.reduce((o, k) => (o[k] = v[k], o), {}));
}

/* "example.com/path?x" — lowercase host, keep path/query. */
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}

/* ---------- 1. Palette inheritance (runtime, same-origin shell) ---------- */

const PALETTE_VARS = [
  "--bg", "--text", "--text-dim", "--accent", "--accent-hover",
  "--accent-soft", "--panel-bg", "--border", "--danger", "--shadow"
];

function inheritPalette() {
  try {
    const parentStyle = window.parent.getComputedStyle(
      window.parent.document.documentElement);
    const vars = {};
    PALETTE_VARS.forEach((name) => {
      const val = parentStyle.getPropertyValue(name);
      if (val && val.trim()) vars[name] = val.trim();
    });
    if (Object.keys(vars).length) {
      document.documentElement.style.cssText = "";
      const root = document.documentElement;
      Object.keys(vars).forEach((k) => root.style.setProperty(k, vars[k]));
    }
  } catch (e) { /* cross-origin or standalone — keep :root fallback */ }
}

function watchPalette() {
  try {
    const target = window.parent.document.documentElement;
    new MutationObserver(inheritPalette).observe(target, {
      attributes: true, attributeFilter: ["style", "class", "data-theme"]
    });
  } catch (e) { /* standalone — nothing to watch */ }
}

/* ---------- 2. i18n (EN default / EL) ---------- */

const STR = {
  "en": {
    "app.name": "Bookmarks",
    "tab.add": "New folder",
    "quick.add": "Paste a link — or link | title",
    "search.ph": "Search…",
    "search.clear": "Clear search",
    "import.title": "Import bookmarks (Netscape HTML)",
    "export.title": "Export bookmarks (Netscape HTML)",
    "folder.settings": "Folder options",
    "folder.settings.dlg": "Folder settings",
    "folder.name": "Name",
    "folder.delete": "Delete folder",
    "folder.unsorted": "Unsorted",
    "view.all": "All",
    "folder.count": "{n} bookmark(s) in this folder",
    "folder.confirm.delete": "Delete this folder? Its bookmarks move to Unsorted.",
    "folder.empty.title": "This folder is empty",
    "folder.empty.hint": "Links you add land in the open folder.",
    "empty.title": "Nothing here yet",
    "empty.hint": "Paste a link above to save it.",
    "search.none": "No matches",
    "search.none.hint": "Try another term or check the spelling.",
    "item.title": "Bookmark",
    "item.title.f": "Title",
    "item.url": "Address",
    "item.note": "Description",
    "item.folder": "Folder",
    "item.delete": "Delete",
    "item.open": "Open",
    "item.move": "Move to…",
    "item.edit": "Edit",
    "save": "Save",
    "cancel": "Cancel",
    "added": "Saved",
    "added.dup": "Already saved in “{f}”",
    "moved": "Moved to “{f}”",
    "deleted": "Deleted",
    "undo": "Undo",
    "import.picked": "Imported {n} bookmark(s), {f} folder(s)",
    "import.none": "No bookmarks found in this file",
    "exported": "Exported {n} bookmark(s)",
    "ctx.open": "Open",
    "ctx.edit": "Edit",
    "ctx.move": "Move to…",
    "ctx.delete": "Delete",
    "time.just": "just now",
    "time.min": "{n} min ago",
    "time.hour": "{n} h ago",
    "time.day": "{n} d ago",
    "tags": "Tags",
    "tags.hint": "Add tag, press Enter…",
    "tags.all": "All tags",
    "tags.none": "No tags yet — add some from a bookmark",
    "tags.clear": "Clear filters",
    "tags.dup": "already added",
    "tags.filter": "Click to filter",
    "sort.recent": "Recent",
    "sort.title": "Title A–Z",
    "sort.visited": "Most visited",
    "sort.manual": "Manual",
    "sel.mode": "Select bookmarks",
    "sel.selected": "{n} selected",
    "sel.move": "Move to…",
    "sel.delete": "Delete",
    "sel.done": "Done",
    "sel.deleted": "Deleted {n} bookmark(s)",
    "sel.moved": "Moved {n} bookmark(s)",
    "sel.none": "Select at least one bookmark",
    "tab.rename": "Rename",
    "tab.movel": "Move left",
    "tab.mover": "Move right",
    "dupe.title": "Duplicate bookmarks",
    "dupe.none": "No duplicates found — each address exists only once.",
    "dupe.keep": "Keep oldest, delete {n}",
    "dupe.deleted": "Deleted {n} duplicate(s)",
    "dupe.keeper": "oldest — kept"
  },
  "el": {
    "app.name": "Συντομεύσεις",
    "tab.add": "Νέος φάκελος",
    "quick.add": "Κόλλησε σύνδεσμο — ή σύνδεσμος | τίτλος",
    "search.ph": "Αναζήτηση…",
    "search.clear": "Καθαρισμός",
    "import.title": "Εισαγωγή σελιδοδεικτών (Netscape HTML)",
    "export.title": "Εξαγωγή σελιδοδεικτών (Netscape HTML)",
    "folder.settings": "Επιλογές φακέλου",
    "folder.settings.dlg": "Ρυθμίσεις φακέλου",
    "folder.name": "Όνομα",
    "folder.delete": "Διαγραφή φακέλου",
    "folder.unsorted": "Αταξινόμητα",
    "view.all": "Όλα",
    "folder.count": "{n} συντόμευση(εις) σε αυτόν τον φάκελο",
    "folder.confirm.delete": "Διαγραφή φακέλου; Οι συντομεύσεις του μεταφέρονται στα Αταξινόμητα.",
    "folder.empty.title": "Ο φάκελος είναι κενός",
    "folder.empty.hint": "Οι σύνδεσμοι που προσθέτεις πέφτουν στον ανοιχτό φάκελο.",
    "empty.title": "Δεν υπάρχει τίποτα ακόμα",
    "empty.hint": "Κόλλησε έναν σύνδεσμο παραπάνω για αποθήκευση.",
    "search.none": "Κανένα αποτέλεσμα",
    "search.none.hint": "Δοκίμασε άλλον όρο ή έλεγξε την ορθογραφία.",
    "item.title": "Συντόμευση",
    "item.title.f": "Τίτλος",
    "item.url": "Διεύθυνση",
    "item.note": "Περιγραφή",
    "item.folder": "Φάκελος",
    "item.delete": "Διαγραφή",
    "item.open": "Άνοιγμα",
    "item.move": "Μετακίνηση σε…",
    "item.edit": "Επεξεργασία",
    "save": "Αποθήκευση",
    "cancel": "Ακύρωση",
    "added": "Αποθηκεύτηκε",
    "added.dup": "Βρίσκεται ήδη στα «{f}»",
    "moved": "Μεταφέρθηκε στα «{f}»",
    "deleted": "Διαγράφηκε",
    "undo": "Αναίρεση",
    "import.picked": "Εισήχθησαν {n} συντόμευση(εις), {f} φάκελος(οι)",
    "import.none": "Δεν βρέθηκαν συντομεύσεις σε αυτό το αρχείο",
    "exported": "Εξήχθησαν {n} συντόμευση(εις)",
    "ctx.open": "Άνοιγμα",
    "ctx.edit": "Επεξεργασία",
    "ctx.move": "Μετακίνηση σε…",
    "ctx.delete": "Διαγραφή",
    "time.just": "μόλις τώρα",
    "time.min": "πριν {n} λεπτά",
    "time.hour": "πριν {n} ώρες",
    "time.day": "πριν {n} ημέρες",
    "tags": "Ετικέτες",
    "tags.hint": "Προσθήκη ετικέτας, Enter…",
    "tags.all": "Όλες οι ετικέτες",
    "tags.none": "Καμία ετικέτα ακόμα — πρόσθεσε από κάποια συντόμευση",
    "tags.clear": "Καθαρισμός φίλτρων",
    "tags.dup": "ήδη προστέθηκε",
    "tags.filter": "Πάτα για φίλτρο",
    "sort.recent": "Πρόσφατα",
    "sort.title": "Τίτλος Α–Ω",
    "sort.visited": "Πιο δημοφιλή",
    "sort.manual": "Χειροκίνητα",
    "sel.mode": "Επιλογή σελιδοδεικτών",
    "sel.selected": "{n} επιλεγμένα",
    "sel.move": "Μετακίνηση σε…",
    "sel.delete": "Διαγραφή",
    "sel.done": "Τέλος",
    "sel.deleted": "Διεγράφησαν {n} συντόμευση(εις)",
    "sel.moved": "Μετακινήθηκαν {n} συντόμευση(εις)",
    "sel.none": "Επίλεξε τουλάχιστον έναν σελιδοδείκτη",
    "tab.rename": "Μετονομασία",
    "tab.movel": "Κίνηση αριστερά",
    "tab.mover": "Κίνηση δεξιά",
    "dupe.title": "Διπλότυπες εγγραφές",
    "dupe.none": "Δεν βρέθηκαν διπλότυπα — κάθε διεύθυνση υπάρχει μόνο μία φορά.",
    "dupe.keep": "Διατήρηση παλαιότερης, διαγραφή {n}",
    "dupe.deleted": "Διεγράφησαν {n} διπλότυπες",
    "dupe.keeper": "παλαιότερη — διατηρήθηκε"
  }
};

let LANG = "en";
(function detectLang() {
  try { LANG = window.parent.orosLang || "en"; } catch (e) { /* standalone */ }
  if (LANG !== "el") LANG =
    (localStorage.getItem("oros-lang") === "el") ? "el" : "en";
})();

function t(key, vars) {
  let s = (STR[LANG] && STR[LANG][key]) != null ? STR[LANG][key]
        : (STR.en[key] != null ? STR.en[key] : key);
  if (vars) {
    Object.keys(vars).forEach((k) =>
      s = s.split("{" + k + "}").join(String(vars[k])));
  }
  return s;
}

function applyI18n(root) {
  (root || document).querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  (root || document).querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.placeholder = t(el.getAttribute("data-i18n-ph"));
  });
  (root || document).querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.getAttribute("data-i18n-title"));
    if (el.hasAttribute("data-i18n-aria")) el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
  });
  document.title = t("app.name") + " · orOS";
}

/* ---------- 3. State, schema, sanitizers, persistence ---------- */

let state = null;
let lastUndoSnapshot = null;
// Snapshots: handled globally by the orOS shell (oros-auto-snapshots, max 5).
// Bookmarks travels inside the full DB snapshot via its sync slice.

/* Whitelisted, bounded field sanitizers — everything else is dropped. */

const RE_ID   = /^[A-Za-z0-9_-]{1,64}$/;
const RE_URL  = /^https?:\/\/\S{1,2048}$/i;
const RE_TS   = /^\d{1,15}$/;    // epoch ms
const MAX_TXT = 512;

function sanText(v, max) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max || MAX_TXT);
}

function sanitizeItem(raw, idHint) {
  if (!raw || typeof raw !== "object") return null;
  const id = RE_ID.test(raw.id || "") ? raw.id : (idHint || uid());
  let url = sanText(raw.url, 2048);
  if (!/^https?:\/\//i.test(url)) {
    if (!url) return null;
    url = "https://" + url.replace(/^\/+/, "");
  }
  try { new URL(url); } catch (e) { return null; }   // must parse
  const ctxFolders = (arguments.length > 2 && arguments[2]) ||
                     (state && state.folders) || {};
  const folderId = ctxFolders[raw.folderId] ? raw.folderId : ROOT_FOLDER;
  const tags = Array.isArray(raw.tags)
    ? raw.tags.slice(0, 12).map((tg) => sanText(tg, 32)).filter(Boolean)
    : [];
  return {
    id: id,
    url: url,
    title: sanText(raw.title, 256) || url,
    note: sanText(raw.note, 1024),
    folderId: folderId,
    tags: tags,
    status: raw.status === "dead" ? "dead"
          : raw.status === "unknown" ? "unknown" : "ok",
    visits: Math.max(0, parseInt(raw.visits, 10) || 0),
    lastVisit: RE_TS.test(String(raw.lastVisit)) ? Number(raw.lastVisit) : 0,
    pos: (raw.pos !== undefined && Number.isFinite(raw.pos)) ? raw.pos : null, // manual order
    added: RE_TS.test(String(raw.added)) ? Number(raw.added)
          : (Date.now()),
    modified: RE_TS.test(String(raw.modified)) ? Number(raw.modified)
            : (Date.now())
  };
}

function sanitizeFolder(raw, idHint) {
  if (!raw || typeof raw !== "object") return null;
  const name = sanText(raw.name, 64);
  if (!name) return null;
  const id = RE_ID.test(raw.id || "") ? raw.id : (idHint || uid());
  return {
    id: id,
    name: name,
    pos: Number.isFinite(raw.pos) ? raw.pos : 1000,
    modified: RE_TS.test(String(raw.modified)) ? Number(raw.modified)
            : (Date.now())
  };
}

function sanitizeState(raw) {
  const out = { ver: 1, items: {}, folders: {}, deleted: {}, settings: {} };

  if (raw && raw.folders) {
    Object.keys(raw.folders).forEach((id) => {
      const f = sanitizeFolder(raw.folders[id], id);
      if (f) out.folders[f.id] = f;
    });
  }
  if (!out.folders[ROOT_FOLDER]) {
    out.folders[ROOT_FOLDER] = {
      id: ROOT_FOLDER,
      name: ROOT_FOLDER,           // re-labeled in UI via i18n
      pos: 0,
      modified: 0
    };
  }
  if (raw && raw.items) {
    Object.keys(raw.items).forEach((id) => {
      const it = sanitizeItem(raw.items[id], id, out.folders);
      if (it && !out.deleted[it.id]) out.items[it.id] = it;
    });
    /* Assign implicit pos to items missing it (pre-Wave 2) —
       reverse-added order gives them a deterministic baseline
       so the first manual reorder works predictably. */
    let maxPos = 0;
    const sortedByAdded = Object.keys(out.items)
      .map((id) => out.items[id])
      .sort((a, b) => (b.added - a.added));
    sortedByAdded.forEach((it) => {
      if (it.pos === null) {
        it.pos = maxPos;
        maxPos += 1000;           // room for inserts between
      }
    });
  }
  if (raw && raw.deleted && typeof raw.deleted === "object") {
    Object.keys(raw.deleted).forEach((id) => {
      if (!RE_ID.test(id)) return;
      const ts = Number(raw.deleted[id]);
      if (RE_TS.test(String(ts))) out.deleted[id] = ts;
    });
  }
  if (raw && raw.settings && typeof raw.settings === "object") {
    out.settings = raw.settings;
  }
  return out;
}

/* --- Load / save --- */

function load() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(DATA_KEY) || "null"); }
  catch (e) { raw = null; }
  state = sanitizeState(raw);

  /* Tombstone pruning (age > 30d) — keeps the blob small.
     Deterministic: clock read once at load, never inside merges. */
  const cutoff = Date.now() - DELETED_PRUNE_DAYS * 86400000;
  let pruned = false;
  Object.keys(state.deleted).forEach((id) => {
    if (state.deleted[id] < cutoff) {
      delete state.deleted[id];
      pruned = true;
    }
  });
  if (pruned || !raw) save(false);
}

function save(dirty) {
  try { localStorage.setItem(DATA_KEY, JSON.stringify(state)); }
  catch (e) { /* storage full — app still works in memory */ }
  if (dirty !== false) markDirty();
}

/* The sync engine lives in the PARENT window (the app iframe never
   loads sync.js itself) — same-origin, so parent lookup is legal.
   Same resolution order as registerSync in §11. */
function syncHost() {
  if (window.orosSync) return window.orosSync;
  try { return window.parent.orosSync || null; } catch (e) { return null; }
}

function markDirty() {
  const api = syncHost();
  if (api && typeof api.markDirty === "function") api.markDirty();
}

/* Snapshot for Undo (delete / move operations in later sections). */
function snapshotForUndo() {
  lastUndoSnapshot = JSON.parse(JSON.stringify(state));
}

function undoFromSnapshot() {
  if (!lastUndoSnapshot) return false;
  /* Fresh mtimes so resurrected entities win any tombstone. */
  const now = Date.now();
  const snap = lastUndoSnapshot;
  lastUndoSnapshot = null;
  Object.keys(snap.items).forEach((id) => { snap.items[id].modified = now; });
  Object.keys(snap.folders).forEach((id) => { snap.folders[id].modified = now; });
  Object.keys(snap.deleted).forEach((id) => { delete snap.deleted[id]; });
  state = snap;
  save();
  renderAll();
  return true;
}

/* Boot marker (visible in the shell's console, like every orOS app). */
console.log("[orOS] bookmarks.js v" + SCRIPT_V + " loaded (" + LANG + ")");

/* ===== 4. UI STATE + RENDER ===== */

let uiActiveFolder = ROOT_FOLDER;
let uiQuery = "";

function renderAll() {
  /* Guard: if the active folder vanished (remote delete via sync),
     fall back safely to the root folder. */
  if (uiActiveFolder !== "ALL_VIEW" && !state.folders[uiActiveFolder]) {
    uiActiveFolder = ROOT_FOLDER;
  }
  renderTabs();
  renderList();
}

/* Sort helper: folders by pos, items newest-first. */
function folderList() {
  /* Folders sort by pos (ascending) — smaller pos = leftmost tab. */
  return Object.keys(state.folders)
    .map((id) => state.folders[id])
    .sort((a, b) => (a.pos - b.pos) || (a.id < b.id ? -1 : 1));
}

function folderName(f) {
  return f.id === ROOT_FOLDER ? t("folder.unsorted") : f.name;
}

function renderTabs() {
  const tabs = $("#tabs");
  tabs.textContent = "";
    /* "All" pseudo-tab — not a real folder, just a UI layer. */
  const allBtn = document.createElement("button");
  allBtn.className = "tab all-tab" +
    (uiActiveFolder === "ALL_VIEW" ? " active" : "");
  allBtn.setAttribute("role", "tab");
  allBtn.textContent = t("view.all");
  allBtn.dataset.folder = "ALL";   // marker value
  allBtn.addEventListener("click", () => {
    if (selectionMode) exitSelectionMode();
    uiActiveFolder = "ALL_VIEW";   // marker for renderList/itemsInFolder
    uiQuery = "";
    $("#search").value = "";
    $("#search-clear").hidden = true;
    clearTagFilters();
    renderAll();
  });
  wireTabDrop(allBtn, true);       // allow drop ON "All" (moves to Unsorted)
  tabs.appendChild(allBtn);
  folderList().forEach((f) => {
    const b = document.createElement("button");
    b.className = "tab" + (f.id === uiActiveFolder ? " active" : "");
    b.setAttribute("role", "tab");
    b.textContent = folderName(f);
    b.dataset.folder = f.id;
    b.draggable = true;               // required — buttons aren't draggable
    b.addEventListener("dblclick", () => openFolderDialog("edit", f.id));
    b.addEventListener("click", () => {
      if (selectionMode) exitSelectionMode();
      uiActiveFolder = f.id;              // plain folder id — no prefix
      uiQuery = "";
      $("#search").value = "";
      $("#search-clear").hidden = true;
      clearTagFilters();
      renderAll();
    });
    wireTabDrop(b);
    wireTabLongPress(b, f.id);
    tabs.appendChild(b);
  });
}

/* ---- Items ---- */

function itemsInFolder(fid) {
  /* "ALL_VIEW" means show everything (cross-folder) */
  if (fid === "ALL_VIEW") {
    return Object.keys(state.items)
      .map((id) => state.items[id])
      .sort((a, b) => (b.added - a.added) || (a.id < b.id ? -1 : 1));
  }
  return Object.keys(state.items)
    .map((id) => state.items[id])
    .filter((it) => it.folderId === fid)
    .sort((a, b) => (b.added - a.added) || (a.id < b.id ? -1 : 1));
}

function searchItems(q) {
  q = q.toLowerCase();
  return Object.keys(state.items)
    .map((id) => state.items[id])
    .filter((it) => {
      const fld = state.folders[it.folderId];
      return it.title.toLowerCase().includes(q) ||
             it.url.toLowerCase().includes(q) ||
             it.tags.some((tg) => tg.toLowerCase().includes(q)) ||
             (fld ? folderName(fld).toLowerCase().includes(q) : false);
    })
    .sort((a, b) => (b.added - a.added) || (a.id < b.id ? -1 : 1));
}

/* Deterministic domain-hash color (Wave 3 favicon simulation,
   shipped now because the row skeleton already depends on it). */
function faviconStyle(host) {
  let h = 0;
  for (let i = 0; i < host.length; i++) h = (h * 31 + host.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return "hsl(" + hue + ", 42%, 34%)";
}

function relTime(ts) {
  if (!ts) return "";
  const s = Math.max(0, Date.now() - ts) / 1000;
  if (s < 60) return t("time.just");
  if (s < 3600) return t("time.min", { n: Math.floor(s / 60) });
  if (s < 86400) return t("time.hour", { n: Math.floor(s / 3600) });
  return t("time.day", { n: Math.floor(s / 86400) });
}

/* Selection mode variables MUST be declared before renderList uses them */
let selectionMode = false;
let selectedIds = new Set();

function renderList() {
  const ul = $("#items");
  ul.textContent = "";
  const searchMode = uiQuery.trim().length > 0;
  const filterMode = searchMode || uiTagFilters.size > 0;

  /* Base pool: search → everywhere; tag filters → everywhere
     (cross-folder); neither → active folder only. */
  let list;
  if (searchMode)      list = searchItems(uiQuery.trim());
  else if (uiTagFilters.size) list =
      Object.keys(state.items)
        .map((id) => state.items[id])
        .sort((a, b) => (b.added - a.added) || (a.id < b.id ? -1 : 1));
  else                 list = itemsInFolder(uiActiveFolder);
  list = list.filter(itemMatchesTags);

  const total = Object.keys(state.items).length;
  $("#empty").hidden = total > 0;
  $("#no-match").hidden = !(filterMode && total > 0 && !list.length);
  $("#folder-empty").hidden =
    !(!filterMode && total > 0 && !list.length);
  ul.hidden = !list.length;

  list = sortItems(list);
  list.forEach((it) => ul.appendChild(buildRow(it, filterMode)));

  /* Selection unavailable while searching/filtering. */
  $("#select-btn").disabled = filterMode;
  $("#select-btn").style.opacity = filterMode ? ".45" : "1";
}

function buildRow(it, searchMode) {
  const host = hostOf(it.url) || it.url;
  const li = document.createElement("li");
  li.className = "item";
  li.dataset.id = it.id;
  li.draggable = true;

  /* Checkbox (appears only in selection mode — controlled externally) */
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "item-check" + (selectedIds.has(it.id) ? " on" : "");
  cb.value = it.id;
  if (selectionMode) {
    cb.checked = selectedIds.has(it.id);
    cb.style.display = "";
  } else {
    cb.checked = false;
    cb.style.display = "none";
  }
  cb.addEventListener("change", (e) => {
    e.stopPropagation();
    /* CSS visual mirrors the input state */
    cb.classList.toggle("on", e.target.checked);
    toggleSelection(it.id, e.target.checked);
  });
  li.prepend(cb);

  /* In selection mode, a row tap toggles instead of opening. */
  if (selectionMode) {
    li.classList.add("selecting");
    li.draggable = false;            // drag conflicts with check taps
  }

  const fav = document.createElement("span");
  fav.className = "favicon";
  fav.style.background = faviconStyle(host);
  fav.textContent = (host[0] || "?").toUpperCase();

  const info = document.createElement("div");
  info.className = "info";
  const ttl = document.createElement("div");
  ttl.className = "title" + (it.status === "dead" ? " dead" : "");
  ttl.textContent = it.title;
  const meta = document.createElement("div");
  meta.className = "meta" + (it.tags.length ? " with-tags" : "");

  const hostText = document.createElement("span");
  hostText.className = "host-text";
  hostText.textContent = host + (it.visits ? " · " + it.visits + "× " +
    relTime(it.lastVisit) : " · " + relTime(it.added));
  meta.appendChild(hostText);

  if (it.tags.length) {
    const wrap = document.createElement("span");
    wrap.className = "tag-wrap";
    const shown = it.tags.slice(0, 3);
    shown.forEach((tg) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tag-chip";
      chip.textContent = tg;
      chip.title = uiTagFilters.has(tg) ? "" : t("tags.filter") || "";
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleTagFilter(tg);
      });
      wrap.appendChild(chip);
    });
    if (it.tags.length > 3) {
      const more = document.createElement("span");
      more.className = "tag-more";
      more.textContent = "+" + (it.tags.length - 3);
      more.title = it.tags.slice(3).join(", ");
      wrap.appendChild(more);
    }
    meta.appendChild(wrap);
  }
  info.append(ttl, meta);

  li.append(fav, info);

  if (searchMode) {
    const chip = document.createElement("span");
    chip.className = "src-chip";
    const fld = state.folders[it.folderId];
    chip.textContent = fld ? folderName(fld) : "";
    li.appendChild(chip);
  }

  const openBtn = document.createElement("button");
  openBtn.className = "open-btn";
  openBtn.type = "button";
  openBtn.title = t("item.open");
  openBtn.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8' +
    'a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" ' +
    'y1="14" x2="21" y2="3"/></svg>';
  li.appendChild(openBtn);

  li.addEventListener("click", () => {
    if (selectionMode) {
      const on = !selectedIds.has(it.id);
      const cb = li.querySelector(".item-check");
      if (cb) { cb.checked = on; cb.classList.toggle("on", on); }
      toggleSelection(it.id, on);
    } else {
      openItem(it.id);
    }
  });
  li.addEventListener("dblclick", () => {
    if (!selectionMode) openItemDialog(it.id);
  });
  if (!selectionMode) {
    wireRowDrag(li, it.id);
    wireLongPress(li, it.id);
  }

  return li;
}

function openItem(id) {
  const it = state.items[id];
  if (!it) return;
  it.visits += 1;
  it.lastVisit = Date.now();
  it.modified = Date.now();
  save();
  window.open(it.url, "_blank", "noopener,noreferrer");
  renderList();
}

/* ===== 4b. TAGS (Wave 2): state, helpers, filter row, panel ===== */

let uiTagFilters = new Set();       // active tag filters (AND logic)

/* tag -> count, alphabetical order. */
function allTagCounts() {
  const counts = {};
  Object.keys(state.items).forEach((id) => {
    state.items[id].tags.forEach((tg) => {
      counts[tg] = (counts[tg] || 0) + 1;
    });
  });
  return Object.keys(counts).sort((a, b) =>
    a.toLowerCase() < b.toLowerCase() ? -1 : 1)
    .reduce((o, tg) => (o[tg] = counts[tg], o), {});
}

function itemMatchesTags(it) {
  for (const tg of uiTagFilters) {
    if (!it.tags.includes(tg)) return false;
  }
  return true;                       // empty set = pass-through
}

function toggleTagFilter(tg) {
  if (uiTagFilters.has(tg)) uiTagFilters.delete(tg);
  else uiTagFilters.add(tg);
  if (selectionMode) exitSelectionMode();
  renderTagFilter();
  renderList();
}

function clearTagFilters() {
  if (!uiTagFilters.size) return;
  uiTagFilters.clear();
  renderTagFilter();
  renderList();
}

/* ---------- Sorting (Wave 2) ---------- */

let uiSortMode = "recent";          // "recent" | "title" | "visited" | "manual"

function setSortMode(mode) {
  uiSortMode = mode;
  // Persists locally only (UI pref, not synced)
  try { localStorage.setItem("oros-bookmarks-sort", mode); } catch (e) {}
  renderList();
}

function enterSelectionMode() {
  /* Available only in folder / All views — search + tag filter
     mixes are confusing for destructive bulk ops. */
  if (uiQuery.trim() || uiTagFilters.size) return;
  selectionMode = true;
  selectedIds.clear();
  $("#bulk-bar").classList.add("show");
  updateSelButtons();
  renderList();
}

function exitSelectionMode() {
  selectionMode = false;
  selectedIds.clear();
  $("#bulk-bar").classList.remove("show");
  renderList();
}

function toggleSelection(id, checked) {
  if (checked) selectedIds.add(id);
  else selectedIds.delete(id);
  updateSelButtons();
}

function updateSelButtons() {
  const n = selectedIds.size;
  $("#sel-count").textContent = t("sel.selected", { n: n });
  $("#sel-move").textContent = t("sel.move");
  $("#sel-delete").textContent = t("sel.delete");
  $("#sel-done").textContent = t("sel.done");
  $("#sel-move").disabled = !n;
  $("#sel-delete").disabled = !n;
  $("#sel-move").style.opacity = n ? "1" : ".45";
  $("#sel-delete").style.opacity = n ? "1" : ".45";
}

/* Move all selected → folder chosen from a small runtime menu
   (reuses ctx-menu visuals, anchored to the Move button). */
function bulkMoveMenu() {
  if (!selectedIds.size) return;
  closeCtxMenu();
  const others = folderList().filter((f) => {
    /* only folders where at least one selected item isn't there */
    return Array.from(selectedIds).some(
      (id) => state.items[id] && state.items[id].folderId !== f.id);
  });
  if (!others.length) { transientNote(t("sel.none")); return; }

  const m = document.createElement("div");
  m.id = "ctx-menu";
  others.forEach((f) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = folderName(f);
    b.addEventListener("click", () => {
      closeCtxMenu();
      bulkMove(f.id);
    });
    m.appendChild(b);
  });
  document.body.appendChild(m);
  const btn = $("#sel-move").getBoundingClientRect();
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8,
    Math.min(btn.left, innerWidth - r.width - 8)) + "px";
  m.style.top = Math.max(8, btn.top - r.height - 8) + "px";
  setTimeout(() => {
    document.addEventListener("click", closeCtxMenu, true);
  }, 0);
}

function bulkMove(folderId) {
  if (!selectedIds.size) return;
  snapshotForUndo();
  let n = 0;
  selectedIds.forEach((id) => {
    const it = state.items[id];
    if (it && it.folderId !== folderId) {
      it.folderId = folderId;
      it.modified = Date.now();
      n++;
    }
  });
  if (!n) { transientNote(t("sel.none")); return; }
  save();
  exitSelectionMode();
  renderAll();
  const fld = state.folders[folderId];
  showToast(t("sel.moved", { n: n }) + " — " + folderName(fld), {
    action: { label: t("undo"), fn: undoFromSnapshot }
  });
}

function bulkDelete() {
  if (!selectedIds.size) return;
  snapshotForUndo();
  const now = Date.now();
  let n = 0;
  selectedIds.forEach((id) => {
    if (state.items[id]) {
      delete state.items[id];
      state.deleted[id] = now;      // tombstones — sync-safe
      n++;
    }
  });
  save();
  exitSelectionMode();
  renderAll();
  showToast(t("sel.deleted", { n: n }), {
    action: { label: t("undo"), fn: undoFromSnapshot }
  });
}

/* ---- Tab reordering (folder pos updates) ---- */

let tabDragTarget = null;

document.addEventListener("dragover", (e) => {
  if (!(e.target instanceof Element)) return;
  const tab = e.target.closest(".tab");
  if (!tab || tab.dataset.folder === "ALL") return;
  if (!document.querySelector(".tab.dragging")) return;   // item drag — ignore
  if (tabDragTarget && tabDragTarget !== tab) {
    tabDragTarget.classList.remove("drop-target");
  }
  tabDragTarget = tab;
  tab.classList.add("drop-target");
  e.preventDefault();              // required so the document drop fires
});

document.addEventListener("drop", (e) => {
  if (!tabDragTarget) return;
  e.preventDefault();
  const src = e.currentTarget.querySelector(".tab.dragging");
  if (!src || !src.dataset.folder || !tabDragTarget.dataset.folder) return;
  if (src.dataset.folder === tabDragTarget.dataset.folder) return;
  reorderFolder(src.dataset.folder, tabDragTarget.dataset.folder);
  tabDragTarget.classList.remove("drop-target");
  tabDragTarget = null;
});

document.addEventListener("dragleave", (e) => {
  /* Left the tab strip entirely → drop the highlight. */
  const rel = e.relatedTarget;
  if (!rel || !(rel instanceof Element) || !rel.closest("#tabbar-wrap")) {
    if (tabDragTarget) tabDragTarget.classList.remove("drop-target");
    tabDragTarget = null;
  }
});

function reorderFolder(srcId, dstId) { swapFolders(srcId, dstId); }

/* Mobile: long-press on tab → move left/right menu. */
function wireTabLongPress(tab, id) {
  let timer = null, startY = 0;
  tab.addEventListener("touchstart", (e) => {
    const startX = e.touches[0].clientX;   // cache before timeout
    startY = e.touches[0].clientY;
    timer = setTimeout(() => {
      timer = null;
      if (e.cancelable) e.preventDefault();
      navigator.vibrate && navigator.vibrate(15);
      showTabContextMenu(id, startX, startY);
    }, 500);
  }, { passive: false });
  ["touchmove", "touchend", "touchcancel"].forEach((ev) => {
    tab.addEventListener(ev, (e) => {
      if (ev === "touchmove" &&
          Math.abs(e.touches[0].clientY - startY) < 12) return;
      clearTimeout(timer);
      timer = null;
    });
  });
}

function showTabContextMenu(id, x, y) {
  closeCtxMenu();
  const f = state.folders[id];
  if (!f || f.id === ROOT_FOLDER) return;

  const ordered = folderList();
  const idx = ordered.findIndex((fd) => fd.id === id);

  const m = document.createElement("div");
  m.id = "ctx-menu";

  function row(label, fn) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", () => { closeCtxMenu(); fn(); });
    m.appendChild(b);
  }

  row(t("tab.rename"), () => openFolderDialog("edit", id));
  if (idx > 0) {
    row(t("tab.movel"), () => swapFolders(id, ordered[idx - 1].id));
  }
  if (idx < ordered.length - 1) {
    row(t("tab.mover"), () => swapFolders(id, ordered[idx + 1].id));
  }

  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
  setTimeout(() => {
    document.addEventListener("click", closeCtxMenu, true);
    window.addEventListener("scroll", closeCtxMenu, true);
  }, 0);
}

/* Position swap between two adjacent folders — same primitive
   as desktop tab drag reorder, one source of truth. */
function swapFolders(aId, bId) {
  const a = state.folders[aId], b = state.folders[bId];
  if (!a || !b) return;
  const tmp = a.pos;
  a.pos = b.pos;
  b.pos = tmp;
  a.modified = Date.now();
  b.modified = Date.now();
  save();
  renderTabs();
}

function loadSortPreference() {
  try {
    const m = localStorage.getItem("oros-bookmarks-sort");
    if (["recent", "title", "visited", "manual"].includes(m))
      uiSortMode = m;
  } catch (e) {}
}

/* Sort comparator per mode — all stable by item id for determinism. */
function sortItems(list) {
  if (uiSortMode === "title") {
    return list.slice().sort((a, b) =>
      a.title.toLowerCase() < b.title.toLowerCase() ? -1 :
      a.title.toLowerCase() > b.title.toLowerCase() ? 1 :
      a.id < b.id ? -1 : 1);
  } else if (uiSortMode === "visited") {
    return list.slice().sort((a, b) =>
      (b.visits - a.visits) || (b.lastVisit || 0) - (a.lastVisit || 0) ||
      (a.id < b.id ? -1 : 1));
  } else if (uiSortMode === "manual") {
    return list.slice().sort((a, b) =>
      (a.pos ?? Infinity) - (b.pos ?? Infinity) ||
      (a.id < b.id ? -1 : 1));
  } else { /* "recent" — newest-first */
    return list.slice().sort((a, b) =>
      (b.added - a.added) || (a.id < b.id ? -1 : 1));
  }
}

function renderTagFilter() {
  const row = $("#tag-filter");
  row.textContent = "";
  row.hidden = uiTagFilters.size === 0;
  if (uiTagFilters.size === 0) return;

  uiTagFilters.forEach((tg) => {
    const chip = document.createElement("span");
    chip.className = "ftag";
    const label = document.createElement("span");
    label.textContent = tg;
    const x = document.createElement("button");
    x.type = "button";
    x.className = "x";
    x.setAttribute("aria-label", t("search.clear"));
    x.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    x.addEventListener("click", () => toggleTagFilter(tg));
    chip.append(label, x);
    row.appendChild(chip);
  });
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "clear-all";
  clear.textContent = t("tags.clear");
  clear.addEventListener("click", clearTagFilters);
  row.appendChild(clear);
}

/* ---- "All tags" panel (overlay + anchored panel) ---- */

function closeTagsPanel() {
  const ov = $("#tags-overlay");
  if (ov) ov.remove();
}

function showTagsPanel() {
  closeTagsPanel();
  const counts = allTagCounts();
  const names = Object.keys(counts);

  const ov = document.createElement("div");
  ov.id = "tags-overlay";

  const panel = document.createElement("div");
  panel.id = "tags-panel";

  const h = document.createElement("h4");
  h.textContent = t("tags.all");
  panel.appendChild(h);

  if (!names.length) {
    const none = document.createElement("div");
    none.className = "tag-none";
    none.textContent = t("tags.none");
    panel.appendChild(none);
  } else {
    names.forEach((tg) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tag-row";
      const lbl = document.createElement("span");
      lbl.textContent = tg;
      const cnt = document.createElement("span");
      cnt.className = "cnt-bubble";
      cnt.textContent = counts[tg];
      b.append(lbl, cnt);
      b.addEventListener("click", () => {
        closeTagsPanel();
        toggleTagFilter(tg);
      });
      panel.appendChild(b);
    });
  }

  ov.appendChild(panel);
  ov.addEventListener("click", (e) => {
    if (e.target === ov) closeTagsPanel();
  });
  document.body.appendChild(ov);

  /* Anchor: below the tags button, clamped to viewport. */
  const btn = $("#tags-btn").getBoundingClientRect();
  panel.style.left = "";
  panel.style.transform = "";
  panel.style.position = "absolute";
  panel.style.top = (btn.bottom + 8) + "px";
  const r = panel.getBoundingClientRect();
  panel.style.left = Math.max(8,
    Math.min(btn.left, innerWidth - r.width - 8)) + "px";
}

/* ---- Duplicates (same-address bookmarks): finder + purge ---- */

/* Groups items by normalized address (same rule as findByUrl:
   trailing-slash-stripped stored url). Each group is sorted
   oldest-first, so g[0] is the original. */
function findDupeGroups() {
  const byNorm = {};
  Object.keys(state.items).forEach((id) => {
    const it = state.items[id];
    const key = it.url.replace(/\/$/, "");
    (byNorm[key] = byNorm[key] || []).push(it);
  });
  return Object.keys(byNorm)
    .filter((k) => byNorm[k].length > 1)
    .map((k) => byNorm[k].sort((a, b) =>
      (a.added - b.added) || (a.id < b.id ? -1 : 1)))
    .sort((g1, g2) => (g2.length - g1.length) ||
      (g1[0].id < g2[0].id ? -1 : 1));
}

function closeDupesPanel() {
  const ov = $("#dupes-overlay");
  if (ov) ov.remove();
}

function showDupesPanel() {
  closeDupesPanel();
  closeTagsPanel();
  const groups = findDupeGroups();

  const ov = document.createElement("div");
  ov.id = "dupes-overlay";

  const panel = document.createElement("div");
  panel.id = "dupes-panel";

  const h = document.createElement("h4");
  h.textContent = t("dupe.title");
  panel.appendChild(h);

  if (!groups.length) {
    const none = document.createElement("div");
    none.className = "tag-none";
    none.textContent = t("dupe.none");
    panel.appendChild(none);
  } else {
    groups.forEach((g) => {
      const keep = g[0];                // oldest — the original
      const blk = document.createElement("div");
      blk.className = "dupe-group";

      const head = document.createElement("div");
      head.className = "dupe-head";
      head.textContent = hostOf(keep.url) || keep.url;
      blk.appendChild(head);

      g.forEach((it) => {
        const row = document.createElement("div");
        row.className = "dupe-row";
        const lbl = document.createElement("span");
        lbl.className = "dupe-lbl";
        lbl.textContent = it.title +
          (it.id === keep.id ? " — " + t("dupe.keeper") : "");
        const sub = document.createElement("span");
        sub.className = "dupe-sub";
        const fld = state.folders[it.folderId];
        sub.textContent = (fld ? folderName(fld) : "?") +
          " · " + relTime(it.added);
        row.append(lbl, sub);
        blk.appendChild(row);
      });

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dupe-purge";
      btn.textContent = t("dupe.keep", { n: g.length - 1 });
      btn.addEventListener("click", () => purgeDupeGroup(g));
      blk.appendChild(btn);

      panel.appendChild(blk);
    });
  }

  ov.appendChild(panel);
  ov.addEventListener("click", (e) => {
    if (e.target === ov) closeDupesPanel();
  });
  document.body.appendChild(ov);

  /* Anchor below the button, clamped (tags-panel pattern). */
  const anchorBtn = $("#dupes-btn");
  panel.style.position = "absolute";
  if (anchorBtn) {
    const btn = anchorBtn.getBoundingClientRect();
    panel.style.top = (btn.bottom + 8) + "px";
    const r = panel.getBoundingClientRect();
    panel.style.left = Math.max(8,
      Math.min(btn.left, innerWidth - r.width - 8)) + "px";
  } else {
    panel.style.left = "50%";
    panel.style.transform = "translateX(-50%)";
    panel.style.top = "72px";
  }
}

/* Deletes every copy except the oldest. Visits and lastVisit
   are folded into the keeper so stats survive the purge. */
function purgeDupeGroup(g) {
  if (!g || g.length < 2) return;
  const keep = g[0];                   // oldest — the original
  snapshotForUndo();
  const now = Date.now();
  let n = 0;
  g.forEach((it) => {
    if (it.id === keep.id) return;
    keep.visits += it.visits;
    keep.lastVisit = Math.max(keep.lastVisit || 0, it.lastVisit || 0);
    delete state.items[it.id];
    state.deleted[it.id] = now;         // tombstones — sync-safe
    n++;
  });
  if (!n) return;
  keep.modified = now;
  save();
  closeDupesPanel();
  renderAll();
  showToast(t("dupe.deleted", { n: n }), {
    action: { label: t("undo"), fn: undoFromSnapshot }
  });
}

/* ===== 5. SEARCH + QUICK-ADD ===== */

function wireSearch() {
  const input = $("#search");
  input.addEventListener("input", () => {
    uiQuery = input.value;
    $("#search-clear").hidden = !uiQuery;
    renderList();
  });
  $("#search-clear").addEventListener("click", () => {
    input.value = "";
    uiQuery = "";
    $("#search-clear").hidden = true;
    input.focus();
    renderList();
  });
}

/* Normalize: trim, drop scheme-less input onto https, strip
   trailing slash so http(s)/site.tld match the stored twin. */
function normalizeUrl(raw) {
  let u = String(raw || "").trim();
  if (!u) return null;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)) u = "https://" + u.replace(/^\/+/, "");
  try {
    const url = new URL(u);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href.replace(/\/$/, "");
  } catch (e) { return null; }
}

function findByUrl(normalized) {
  return Object.keys(state.items)
    .map((id) => state.items[id])
    .find((it) => it.url.replace(/\/$/, "") === normalized) || null;
}

function quickAdd() {
  const input = $("#quick-add");
  const raw = input.value.trim();
  if (!raw) return;                 // silent exit — empty input is not an error
  let urlPart = raw, titlePart = "";
  const bar = raw.indexOf("|");
  if (bar > -1) {
    titlePart = raw.slice(bar + 1).trim();
    urlPart = raw.slice(0, bar);
  }
  const norm = normalizeUrl(urlPart);
  if (!norm) { flashDuplicate(); return; }

  const existing = findByUrl(norm);
  if (existing) {
    flashDuplicate();
    const fld = state.folders[existing.folderId];
    transientNote(t("added.dup", { f: folderName(fld) }));
    return;
  }

  const it = sanitizeItem({
    url: norm,
    title: titlePart,
    /* All view has no target folder — new links land in Unsorted. */
    folderId: uiActiveFolder === "ALL_VIEW" ? ROOT_FOLDER : uiActiveFolder
  });
  if (!it) { flashDuplicate(); return; }
  state.items[it.id] = it;
  save();
  input.value = "";
  renderAll();
  transientNote(t("added"));
}

function flashDuplicate() {
  const bar = $("#addbar");
  bar.classList.remove("duplicate");
  void bar.offsetWidth;              // restart the CSS state
  bar.classList.add("duplicate");
  setTimeout(() => bar.classList.remove("duplicate"), 1200);
  $("#quick-add").focus();
}

/* ===== 6. MOVE (D&D desktop + long-press menu) ===== */

let draggingId = null;

function moveItem(id, folderId) {
  const it = state.items[id];
  if (!it || it.folderId === folderId) return;
  snapshotForUndo();
  it.folderId = folderId;
  it.modified = Date.now();
  save();
  renderAll();
  const fld = state.folders[folderId];
  showToast(t("moved", { f: folderName(fld) }), {
    action: { label: t("undo"), fn: undoFromSnapshot }
  });
}

function wireRowDrag(li, id) {
  li.addEventListener("dragstart", (e) => {
    draggingId = id;
    li.classList.add("dragging");
    e.dataTransfer.setData("text/plain", id);   // Firefox needs data
    e.dataTransfer.effectAllowed = "move";
  });
  li.addEventListener("dragend", () => {
    draggingId = null;
    li.classList.remove("dragging");
    clearDropTargets();
  });
}

function wireTabDrop(tab, isAllView = false) {
  /* Item drop — moves bookmark to folder. */
  tab.addEventListener("dragover", (e) => {
    if (draggingId) { e.preventDefault(); tab.classList.add("drop-target"); }
  });
  tab.addEventListener("dragleave", () => tab.classList.remove("drop-target"));
  tab.addEventListener("drop", (e) => {
    e.preventDefault();
    const id = draggingId || e.dataTransfer.getData("text/plain");
    tab.classList.remove("drop-target");
    if (!id) return;

    if (isAllView && state.items[id]) {
      /* Drop on "All" → move to Unsorted (default recovery). */
      moveItem(id, ROOT_FOLDER);
      return;
    }
    if (state.items[id]) moveItem(id, tab.dataset.folder);
  });

  /* Tab-to-tab drag — reorder folders (Wave 2). Only triggers if
     the dragged element itself is a tab (tab.dragging flag).
     NOTE: This coexists with item dragstart (checked via class). */
  tab.addEventListener("dragstart", (e) => {
    if (e.target.classList.contains("tab") && !e.target.classList.contains("dragging")) {
      e.target.classList.add("dragging");
      e.dataTransfer.setData("text/plain", "tab-reorder:" + tab.dataset.folder);
      e.dataTransfer.effectAllowed = "move";
    }
  });
  tab.addEventListener("dragend", () => {
    $$(".tab.dragging").forEach((t) => t.classList.remove("dragging"));
    clearDropTargets();
  });
}

function clearDropTargets() {
  $$(".drop-target").forEach((el) => el.classList.remove("drop-target"));
}

/* Long-press (mobile) — 500ms hold, cancelled by scroll/second touch. */
function wireLongPress(li, id) {
  let timer = null, startY = 0;
  li.addEventListener("touchstart", (e) => {
    const startX = e.touches[0].clientX;   // cache before timeout
    startY = e.touches[0].clientY;
    timer = setTimeout(() => {
      timer = null;
      if (e.cancelable) e.preventDefault();
      navigator.vibrate && navigator.vibrate(15);
      showCtxMenu(id, startX, startY);
    }, 500);
  }, { passive: false });
  ["touchmove", "touchend", "touchcancel"].forEach((ev) => {
    li.addEventListener(ev, (e) => {
      if (ev === "touchmove" &&
          Math.abs(e.touches[0].clientY - startY) < 12) return;
      clearTimeout(timer);
      timer = null;
    });
  });
}

function closeCtxMenu() {
  const m = $("#ctx-menu");
  if (m) m.remove();
  document.removeEventListener("click", closeCtxMenu, true);
  window.removeEventListener("scroll", closeCtxMenu, true);
}

function showCtxMenu(id, x, y) {
  closeCtxMenu();
  const it = state.items[id];
  if (!it) return;

  const m = document.createElement("div");
  m.id = "ctx-menu";

  function row(label, fn, danger) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    if (danger) b.className = "danger";
    b.addEventListener("click", () => { closeCtxMenu(); fn(); });
    m.appendChild(b);
  }

  row(t("ctx.open"), () => openItem(id));
  row(t("ctx.edit"), () => openItemDialog(id));
  const others = folderList().filter((f) => f.id !== it.folderId);
  if (others.length) {
    const sep = document.createElement("div");
    sep.className = "sep";
    m.appendChild(sep);
    others.forEach((f) =>
      row(t("ctx.move") + " " + folderName(f), () => moveItem(id, f.id)));
  }
  const sep2 = document.createElement("div");
  sep2.className = "sep";
  m.appendChild(sep2);
  row(t("ctx.delete"), () => deleteItem(id), true);

  document.body.appendChild(m);
  /* Clamp inside viewport — mobile-first. */
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";

  setTimeout(() => {               // let this tap finish first
    document.addEventListener("click", closeCtxMenu, true);
    window.addEventListener("scroll", closeCtxMenu, true);
  }, 0);
}

/* ---- Toast (single slot, top-right) ---- */

let toastTimer = null;
function showToast(msg, opts) {
  const el = $("#toast");
  el.textContent = "";
  el.appendChild(document.createTextNode(msg));
  if (opts && opts.action) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "action";
    b.textContent = opts.action.label;
    b.addEventListener("click", () => { hideToast(); opts.action.fn(); });
    el.appendChild(b);
  }
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}
function hideToast() { $("#toast").classList.remove("show"); }

/* Unified notifications (orOS compliance): informational toasts
   route through the shell's orosNotifs.transient() — click
   feedback, no inbox, no toggle needed. Falls back to the local
   toast when the app runs standalone (no shell present).
   Undo-bearing toasts keep the local path (interactive action). */
function transientNote(title, body) {
  let api = window.orosNotifs;
  if (!api) {
    try { api = window.parent.orosNotifs; } catch (e) {}
  }
  if (api && typeof api.transient === "function") {
    api.transient({ ns: "bookmarks", title: title, body: body || "" });
  } else {
    showToast(title + (body ? " — " + body : ""));
  }
}

/* ===== 7. ITEM DIALOG ===== */

let editingItemId = null;
let dlgTags = [];                    // working copy while dialog open
let acHighlighted = -1;              // autocomplete row index

function renderDlgTags() {
  const editor = $("#f-tags-editor");
  /* Remove existing chips, keep the input (last child). */
  editor.querySelectorAll(".chip").forEach((c) => c.remove());
  const input = $("#f-tags-input");
  dlgTags.forEach((tg) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    const lbl = document.createElement("span");
    lbl.textContent = tg;
    const x = document.createElement("button");
    x.type = "button";
    x.className = "x";
    x.setAttribute("aria-label", t("search.clear"));
    x.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    x.addEventListener("click", () => {
      dlgTags = dlgTags.filter((t2) => t2 !== tg);
      renderDlgTags();
    });
    chip.append(lbl, x);
    editor.insertBefore(chip, input);
  });
}

function addDlgTag(raw) {
  const tg = sanText(raw, 32);
  if (!tg) return;
  if (dlgTags.includes(tg)) {
    transientNote(t("tags.dup"), tg);
    return;
  }
  if (dlgTags.length >= 12) return;  // sanitizer cap: max 12 tags
  dlgTags.push(tg);
  renderDlgTags();
}

/* Autocomplete: suggestions from the 1st typed character,
   excluding already-added tags. Shows usage counts. */
function renderDlgAc(query) {
  const ac = $("#f-tags-ac");
  ac.textContent = "";
  acHighlighted = -1;
  if (!query) { ac.hidden = true; return; }
  const q = query.toLowerCase();
  const counts = allTagCounts();
  const sug = Object.keys(counts)
    .filter((tg) => tg.toLowerCase().startsWith(q) && !dlgTags.includes(tg))
    .slice(0, 6);
  if (!sug.length) { ac.hidden = true; return; }
  sug.forEach((tg) => {
    const b = document.createElement("button");
    b.type = "button";
    const lbl = document.createElement("span");
    lbl.textContent = tg;
    const cnt = document.createElement("span");
    cnt.className = "cnt";
    cnt.textContent = counts[tg];
    b.append(lbl, cnt);
    b.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus
    b.addEventListener("click", () => {
      addDlgTag(tg);
      $("#f-tags-input").value = "";
      renderDlgAc("");
    });
    ac.appendChild(b);
  });
  ac.hidden = false;
}

function wireTagEditor() {
  const input = $("#f-tags-input");
  input.addEventListener("input", () => renderDlgAc(input.value));
  input.addEventListener("keydown", (e) => {
    const ac = $("#f-tags-ac");
    const rows = ac.hidden ? [] : Array.from(ac.querySelectorAll("button"));
    if (e.key === "ArrowDown" && rows.length) {
      e.preventDefault();
      acHighlighted = Math.min(acHighlighted + 1, rows.length - 1);
      rows.forEach((r, i) => r.classList.toggle("hl", i === acHighlighted));
    } else if (e.key === "ArrowUp" && rows.length) {
      e.preventDefault();
      acHighlighted = Math.max(acHighlighted - 1, 0);
      rows.forEach((r, i) => r.classList.toggle("hl", i === acHighlighted));
    } else if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (acHighlighted >= 0 && rows[acHighlighted]) {
        addDlgTag(rows[acHighlighted].querySelector("span").textContent);
      } else if (input.value.trim()) {
        addDlgTag(input.value);
      }
      input.value = "";
      renderDlgAc("");
    } else if (e.key === "Backspace" && !input.value && dlgTags.length) {
      dlgTags.pop();
      renderDlgTags();
    }
  });
  input.addEventListener("blur", () => {
    /* Commit a dangling fragment after 150ms (blur from AC click
       fires before the click handler — mousedown preventDefault
       above already guards, this is belt-and-braces). */
    setTimeout(() => { $("#f-tags-ac").hidden = true; }, 150);
  });
}

function openItemDialog(id) {
  const it = state.items[id];
  if (!it) return;
  editingItemId = id;
  dlgTags = it.tags.slice();
  renderDlgTags();
  $("#f-title").value = it.title;
  $("#f-url").value = it.url;
  $("#f-note").value = it.note || "";
  $("#f-tags-input").value = "";
  $("#f-tags-ac").hidden = true;
  fillFolderSelect(it.folderId);
  $("#dlg-item").showModal();
}

function fillFolderSelect(selectedId) {
  const sel = $("#f-folder");
  sel.textContent = "";
  folderList().forEach((f) => {
    const o = document.createElement("option");
    o.value = f.id;
    o.textContent = folderName(f);
    if (f.id === selectedId) o.selected = true;
    sel.appendChild(o);
  });
}

function submitItemDialog(normUrl) {
  const it = state.items[editingItemId];
  if (!it) return;
  it.title = sanText($("#f-title").value, 256) || normUrl;
  it.url = normUrl;
  it.note = sanText($("#f-note").value, 1024);
  it.folderId = $("#f-folder").value || ROOT_FOLDER;
  it.tags = dlgTags.slice();
  it.modified = Date.now();
  save();
  renderAll();
}

function deleteItem(id) {
  const it = state.items[id];
  if (!it) return;
  snapshotForUndo();
  delete state.items[id];
  state.deleted[id] = Date.now();          // tombstone wins over stale copy
  save();
  renderAll();
  showToast(t("deleted"), {
    action: { label: t("undo"), fn: undoFromSnapshot }
  });
}

/* ===== 8. FOLDER DIALOG (create / rename / delete) ===== */

let folderDlgMode = "edit";
let folderDlgId = null;
let folderArmDelete = false;

function openFolderDialog(mode, folderId) {
  folderDlgMode = mode;
  folderDlgId = folderId || null;
  folderArmDelete = false;
  const isRoot = mode === "edit" && folderId === ROOT_FOLDER;
  const nameInput = $("#l-name");
  nameInput.readOnly = isRoot;
  if (mode === "create") {
    folderDlgId = null;
    nameInput.value = "";
  } else {
    nameInput.value = isRoot ? t("folder.unsorted")
                             : state.folders[folderId].name;
  }
  $("#l-delete").hidden = mode !== "edit" || isRoot;
  const n = mode === "edit" ? itemsInFolder(folderId).length : 0;
  $("#l-count").textContent = t("folder.count", { n: n });
  updateFolderDeleteLabel();
  $("#dlg-folder").showModal();
}

function updateFolderDeleteLabel() {
  $("#l-delete").textContent = folderArmDelete
    ? t("folder.confirm.delete")
    : t("folder.delete");
}

function uniquifyFolderName(name) {
  const names = folderList().map((f) => f.name.toLowerCase());
  if (!names.includes(name.toLowerCase())) return name;
  let i = 2;
  while (names.includes((name + " " + i).toLowerCase())) i++;
  return name + " " + i;
}

function nextFolderPos() {
  return folderList().reduce((m, f) => Math.max(m, f.pos), 0) + 1;
}

function submitFolderDialog(name) {
  if (folderDlgMode === "create") {
    const f = sanitizeFolder({
      name: uniquifyFolderName(name),
      pos: nextFolderPos(),
      modified: Date.now()
    });
    if (!f) return;
    state.folders[f.id] = f;
    uiActiveFolder = f.id;
  } else if (folderDlgId && folderDlgId !== ROOT_FOLDER) {
    const f = state.folders[folderDlgId];
    const newName = uniquifyFolderName(name);
    if (f.name !== newName) {
      f.name = newName;
      f.modified = Date.now();
    }
  }
  save();
  renderAll();
}

function deleteFolderNow() {
  if (!folderDlgId || folderDlgId === ROOT_FOLDER) return;
  snapshotForUndo();
  /* Orphans fall back to Unsorted — never lost. */
  Object.keys(state.items).forEach((id) => {
    if (state.items[id].folderId === folderDlgId) {
      state.items[id].folderId = ROOT_FOLDER;
      state.items[id].modified = Date.now();
    }
  });
  delete state.folders[folderDlgId];
  state.deleted[folderDlgId] = Date.now();
  uiActiveFolder = ROOT_FOLDER;
  $("#dlg-folder").close();
  save();
  renderAll();
  showToast(t("deleted"), {
    action: { label: t("undo"), fn: undoFromSnapshot }
  });
}

/* ===== 9. NETSCAPE IMPORT / EXPORT ===== */

function parseNetscape(htmlText) {
  const doc = new DOMParser().parseFromString(htmlText, "text/html");
  const out = [];

  /* Walks <DT><H3>Folder</H3> + sibling <DL> (the classic
     Netscape/Chrome/Firefox export shape) and nested <DL>
     inside the same <DT> (some exporters do this instead). */
  function walkDL(dl, path) {
    let curFolder = null;
    Array.from(dl.childNodes).forEach((node) => {
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (tag === "DT") {
        const a = node.querySelector(":scope > a[href]");
        const h3 = node.querySelector(":scope > h3");
        if (a) {
          out.push({
            url: a.getAttribute("href"),
            title: (a.textContent || "").trim(),
            path: curFolder ? path.concat([curFolder]) : path
          });
        } else if (h3) {
          curFolder = h3.textContent.trim();
          const inner = node.querySelector(":scope > dl");
          if (inner) walkDL(inner, path.concat([curFolder]));
        }
      } else if (tag === "DL") {
        if (curFolder) {
          walkDL(node, path.concat([curFolder]));
          curFolder = null;            // back at parent level
        } else {
          walkDL(node, path);
        }
      }
    });
  }

  const rootDL = doc.querySelector("dl");
  if (rootDL) walkDL(rootDL, []);
  return out;
}

function applyImport(entries) {
  let newItems = 0, newFolders = 0;
  const nameToId = {};
  folderList().forEach((f) => { nameToId[f.name.toLowerCase()] = f.id; });
  let nextPos = nextFolderPos();

  entries.forEach((entry) => {
    let fid = ROOT_FOLDER;
    (entry.path || []).forEach((pn) => {
      const key = pn.toLowerCase();
      if (!nameToId[key]) {
        const f = sanitizeFolder({ name: pn, pos: nextPos++, modified: Date.now() });
        if (f) {
          state.folders[f.id] = f;
          nameToId[key] = f.id;
          newFolders++;
        }
      }
      if (nameToId[key]) fid = nameToId[key];
    });

    const norm = normalizeUrl(entry.url);
    if (!norm || findByUrl(norm)) return;   // dedup against existing
    const it = sanitizeItem({ url: norm, title: entry.title, folderId: fid });
    if (!it) return;
    state.items[it.id] = it;
    newItems++;
  });

  save();
  renderAll();
  transientNote(newItems || newFolders
    ? t("import.picked", { n: newItems, f: newFolders })
    : t("import.none"));
}

function exportNetscape() {
  const lines = [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    "<!-- This is an automatically generated file. It will be read and overwritten. DO NOT EDIT! -->",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Bookmarks</TITLE>",
    "<H1>Bookmarks</H1>",
    "<DL><p>"
  ];

  folderList().forEach((f) => {
    const items = itemsInFolder(f.id);
    if (!items.length) return;
    lines.push("    <DT><H3>" + esc(folderName(f)) + "</H3>");
    lines.push("    <DL><p>");
    items.forEach((it) => {
      lines.push("        <DT><A HREF=\"" + esc(it.url) +
        "\" ADD_DATE=\"" + Math.floor(it.added / 1000) + "\">" +
        esc(it.title) + "</A>");
    });
    lines.push("    </DL><p>");
  });
  lines.push("</DL><p>");

  const blob = new Blob([lines.join("\n")], { type: "text/html" });
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = "oros-bookmarks.html";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 2000);

  transientNote(t("exported", { n: Object.keys(state.items).length }));
}

/* ===== 10. MERGE ENGINE (deterministic, clock-free) ===== */

/* Union merge by entity id:
   - newest "modified" wins per entity
   - identical mtimes → lexicographic canon() tie-break
   - tombstone beats an older entity; an entity modified AFTER
     its tombstone resurrects (that is how Undo survives sync)
   Both devices run this function on identical inputs, so the
   output converges without any coordination. */

function mergeBookmarks(aRaw, bRaw) {
  const A = aRaw || { items: {}, folders: {}, deleted: {}, settings: {} };
  const B = bRaw || { items: {}, folders: {}, deleted: {}, settings: {} };

  const out = { ver: 1, items: {}, folders: {}, deleted: {}, settings: {} };

  /* Deleted map: union, newest timestamp. */
  const delIds = new Set(
    Object.keys(A.deleted || {}).concat(Object.keys(B.deleted || {})));
  delIds.forEach((id) => {
    out.deleted[id] = Math.max(A.deleted[id] || 0, B.deleted[id] || 0);
  });

  function winner(a, b) {
    if (!a) return b;
    if (!b) return a;
    if ((b.modified || 0) !== (a.modified || 0))
      return (b.modified || 0) > (a.modified || 0) ? b : a;
    /* For manual reorders (pos-only changes), modified is equal
       on both sides — smaller pos wins (top-of-list preference). */
    if (a.pos !== b.pos) return (a.pos ?? 0) < (b.pos ?? 0) ? a : b;
    return canon(b) >= canon(a) ? b : a;
  }

  /* Entities whose sync-resurrection logic applies:
     tombstone only wins while it is newer than the entity. */
  function place(kind, map) {
    const ids = new Set(
      Object.keys(A[kind] || {}).concat(Object.keys(B[kind] || {})));
    ids.forEach((id) => {
      const ent = winner(A[kind] && A[kind][id], B[kind] && B[kind][id]);
      if (!ent) return;
      const death = out.deleted[id] || 0;
      if (death && (ent.modified || 0) <= death) return;  // stays dead
      if (death) delete out.deleted[id];                  // resurrected
      map[id] = ent;
    });
  }

  place("folders", out.folders);
  place("items", out.items);

  /* Root folder is immortal. */
  if (!out.folders[ROOT_FOLDER]) {
    out.folders[ROOT_FOLDER] =
      { id: ROOT_FOLDER, name: ROOT_FOLDER, pos: 0, modified: 0 };
    delete out.deleted[ROOT_FOLDER];
  }

  /* Deterministic settings pick — lexicographic JSON tie-break,
     symmetric on both devices (Object.assign was remote-wins =
     divergent). Empty settings lose to non-empty. */
  const sa = JSON.stringify(A.settings || {}),
        sb = JSON.stringify(B.settings || {});
  out.settings = (sa === "{}") ? (B.settings || {})
               : (sb === "{}") ? (A.settings || {})
               : (sb >= sa ? (B.settings || {}) : (A.settings || {}));
  return sanitizeState(out);   // re-checks folder refs + drops junk
}

/* ===== 11. SYNC SLICE REGISTRATION ===== */

function registerSync(retries) {
  let host = window.orosSync;
  if (!host) {
    try { host = window.parent.orosSync; } catch (e) { /* standalone */ }
  }
  if (host && typeof host.registerSlice === "function") {
    host.registerSlice(
      "bookmarks",
      function getState() { return state; },
      function setState(remoteRaw) {
        if (typeof remoteRaw === "string") {
          try { remoteRaw = JSON.parse(remoteRaw); } catch (e) { return; }
        }
        const before = JSON.stringify(state);
        state = mergeBookmarks(state, remoteRaw);
        save(false);                     // no dirty echo — pull path
        if (JSON.stringify(state) !== before) renderAll();
      },
      DATA_KEY,
      mergeBookmarks
    );
  } else if (retries < 40) {
    /* The shell may still be loading sync.js — retry ~20s max. */
    setTimeout(() => registerSync(retries + 1), 500);
  }
}

/* ===== 12. WIRE + BOOT ===== */

function wire() {
  /* Quick-add */
  $("#quick-add-btn").addEventListener("click", quickAdd);
  $("#quick-add").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); quickAdd(); }
  });

  wireSearch();
  /* Sort dropdown */
  loadSortPreference();
  $("#sort-select").value = uiSortMode;
  $("#sort-select").addEventListener("change", (e) => {
    setSortMode(e.target.value);
  });
  wireTagEditor();
  $("#tags-btn").addEventListener("click", showTagsPanel);
  /* Duplicate finder — button is optional in HTML (guarded). */
  const dupesBtn = $("#dupes-btn");
  if (dupesBtn) dupesBtn.addEventListener("click", showDupesPanel);

  /* Selection mode */
  $("#select-btn").addEventListener("click", () => {
    if (selectionMode) exitSelectionMode();
    else enterSelectionMode();
  });
  $("#sel-done").addEventListener("click", exitSelectionMode);
  $("#sel-delete").addEventListener("click", bulkDelete);
  $("#sel-move").addEventListener("click", bulkMoveMenu);

  /* Typing in search while selecting exits selection mode
     (mixing the two is a foot-gun for destructive ops). */
  $("#search").addEventListener("input", () => {
    if (selectionMode) exitSelectionMode();
  });

  /* Import (file picker in — fully offline) */
  $("#import-btn").addEventListener("click", () => $("#import-in").click());
  $("#import-in").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      applyImport(parseNetscape(await file.text()));
    } catch (err) {
      transientNote(t("import.none"));
    }
  });

  /* Export */
  $("#export-btn").addEventListener("click", exportNetscape);

  /* Folders */
  $("#folder-settings").addEventListener("click", () =>
    openFolderDialog("edit",
      uiActiveFolder === "ALL_VIEW" ? ROOT_FOLDER : uiActiveFolder));
  $("#tab-add").addEventListener("click",
    () => openFolderDialog("create"));

  /* Item dialog */
  $("#item-form").addEventListener("submit", (e) => {
    const norm = normalizeUrl($("#f-url").value);
    if (!norm) { e.preventDefault(); $("#f-url").focus(); return; }
    /* Duplicate guard: editing may not collide with another
       bookmark's address — same rule as quick-add. */
    const dup = findByUrl(norm);
    if (dup && dup.id !== editingItemId) {
      e.preventDefault();             // keep the dialog open for a fix
      const fld = state.folders[dup.folderId];
      transientNote(t("added.dup", { f: folderName(fld) }));
      $("#f-url").focus();
      return;
    }
    submitItemDialog(norm);            // dialog closes via method="dialog"
  });
  $("#f-delete").addEventListener("click", () => {
    const id = editingItemId;
    editingItemId = null;
    $("#dlg-item").close();
    deleteItem(id);
  });

  /* Folder dialog */
  $("#folder-form").addEventListener("submit", (e) => {
    const name = sanText($("#l-name").value, 64);
    if (!name) { e.preventDefault(); return; }
    submitFolderDialog(name);
  });
  $("#l-delete").addEventListener("click", () => {
    if (!folderArmDelete) {            // two-step confirm, in-dialog
      folderArmDelete = true;
      updateFolderDeleteLabel();
    } else {
      deleteFolderNow();
    }
  });
  $("#dlg-folder").addEventListener("close", () => {
    folderArmDelete = false;
  });

  /* Close dialogs on backdrop click (orOS convention) */
  ["#dlg-item", "#dlg-folder"].forEach((sel) => {
    $(sel).addEventListener("click", (e) => {
      if (e.target === $(sel)) $(sel).close();
    });
  });
}

function boot() {
  load();
  applyI18n();
  wire();
  registerSync(0);
  renderAll();
  inheritPalette();
  watchPalette();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

})();