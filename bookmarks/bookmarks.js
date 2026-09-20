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
    "time.day": "{n} d ago"
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
    "time.day": "πριν {n} ημέρες"
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
  renderTabs();
  renderList();
}

/* Sort helper: folders by pos, items newest-first. */
function folderList() {
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
  folderList().forEach((f) => {
    const b = document.createElement("button");
    b.className = "tab" + (f.id === uiActiveFolder ? " active" : "");
    b.setAttribute("role", "tab");
    b.textContent = folderName(f);
    b.dataset.folder = f.id;
    b.addEventListener("dblclick", () => openFolderDialog("edit", f.id));
    b.addEventListener("click", () => {
      uiActiveFolder = f.id;
      uiQuery = "";                    // switching folder clears search
      $("#search").value = "";
      $("#search-clear").hidden = true;
      renderAll();
    });
    wireTabDrop(b);
    tabs.appendChild(b);
  });
}

/* ---- Items ---- */

function itemsInFolder(fid) {
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

function renderList() {
  const ul = $("#items");
  ul.textContent = "";
  const searchMode = uiQuery.trim().length > 0;
  const list = searchMode ? searchItems(uiQuery.trim())
                          : itemsInFolder(uiActiveFolder);

  const total = Object.keys(state.items).length;
  $("#empty").hidden = total > 0;
  $("#no-match").hidden = !(searchMode && total > 0 && !list.length);
  $("#folder-empty").hidden =
    !(!searchMode && total > 0 && !list.length);
  ul.hidden = !list.length;

  list.forEach((it) => ul.appendChild(buildRow(it, searchMode)));
}

function buildRow(it, searchMode) {
  const host = hostOf(it.url) || it.url;
  const li = document.createElement("li");
  li.className = "item";
  li.dataset.id = it.id;
  li.draggable = true;

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
  meta.className = "meta";
  meta.textContent = host + (it.visits ? " · " + it.visits + "× " +
    relTime(it.lastVisit) : " · " + relTime(it.added));
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

  li.addEventListener("click", () => openItem(it.id));
  li.addEventListener("dblclick", () => openItemDialog(it.id));
  wireRowDrag(li, it.id);
  wireLongPress(li, it.id);

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
  const raw = input.value;
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
    showToast(t("added.dup", { f: folderName(fld) }));
    return;
  }

  const it = sanitizeItem({
    url: norm,
    title: titlePart,
    folderId: uiActiveFolder
  });
  if (!it) { flashDuplicate(); return; }
  state.items[it.id] = it;
  save();
  input.value = "";
  renderAll();
  showToast(t("added"));
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

function wireTabDrop(tab) {
  tab.addEventListener("dragover", (e) => {
    if (draggingId) { e.preventDefault(); tab.classList.add("drop-target"); }
  });
  tab.addEventListener("dragleave", () => tab.classList.remove("drop-target"));
  tab.addEventListener("drop", (e) => {
    e.preventDefault();
    const id = draggingId || e.dataTransfer.getData("text/plain");
    tab.classList.remove("drop-target");
    if (id && state.items[id]) moveItem(id, tab.dataset.folder);
  });
}

function clearDropTargets() {
  $$(".drop-target").forEach((el) => el.classList.remove("drop-target"));
}

/* Long-press (mobile) — 500ms hold, cancelled by scroll/second touch. */
function wireLongPress(li, id) {
  let timer = null, startY = 0;
  li.addEventListener("touchstart", (e) => {
    startY = e.touches[0].clientY;
    timer = setTimeout(() => {
      timer = null;
      if (e.cancelable) e.preventDefault();
      const tx = e.touches[0].clientX, ty = e.touches[0].clientY;
      navigator.vibrate && navigator.vibrate(15);
      showCtxMenu(id, tx, ty);
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

/* ===== 7. ITEM DIALOG ===== */

let editingItemId = null;

function openItemDialog(id) {
  const it = state.items[id];
  if (!it) return;
  editingItemId = id;
  $("#f-title").value = it.title;
  $("#f-url").value = it.url;
  $("#f-note").value = it.note || "";
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
  showToast(newItems || newFolders
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

  showToast(t("exported", { n: Object.keys(state.items).length }));
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

  /* Import (file picker in — fully offline) */
  $("#import-btn").addEventListener("click", () => $("#import-in").click());
  $("#import-in").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      applyImport(parseNetscape(await file.text()));
    } catch (err) {
      showToast(t("import.none"));
    }
  });

  /* Export */
  $("#export-btn").addEventListener("click", exportNetscape);

  /* Folders */
  $("#folder-settings").addEventListener("click",
    () => openFolderDialog("edit", uiActiveFolder));
  $("#tab-add").addEventListener("click",
    () => openFolderDialog("create"));

  /* Item dialog */
  $("#item-form").addEventListener("submit", (e) => {
    const norm = normalizeUrl($("#f-url").value);
    if (!norm) { e.preventDefault(); $("#f-url").focus(); return; }
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