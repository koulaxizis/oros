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
let suppressDirty = false;        // set while a sync pull writes state
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
  const folderId = (state && state.folders &&
    state.folders[raw.folderId]) ? raw.folderId : ROOT_FOLDER;
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
      const it = sanitizeItem(raw.items[id], id);
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
  if (dirty !== false && !suppressDirty) markDirty();
}

function markDirty() {
  if (window.__orosSyncApi && typeof window.__orosSyncApi.dirty === "function") {
    window.__orosSyncApi.dirty();
  }
}

/* Dirty funnel — defined BEFORE the slice registers (§11/boot).
   The sync layer pulls through this callback; _suppress stops the
   incoming write from echoing back as a push (loop guard). */
window.__orosSyncApi = {
  dirty: function () {
    const api = window.orosSync;
    if (api && typeof api.markDirty === "function") api.markDirty("bookmarks");
  },
  /* Called by the sync layer when a remote payload arrives. */
  pullSet: function (remoteRaw) {
    suppressDirty = true;
    try {
      const merged = mergeBookmarks(
        JSON.parse(JSON.stringify(state)),
        sanitizeState(remoteRaw));
      state = merged;
      save(false);
      renderAll();                 // defined in §4
    } finally { suppressDirty = false; }
  }
};

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
console.log("[orOS] bookmarks.js v" + SCRIPT_V + " booted (" + LANG + ")");
})();

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
    b.addEventListener("click", () => {
      uiActiveFolder = f.id;
      uiQuery = "";                    // switching folder clears search
      $("#search").value = "";
      $("#search-clear").hidden = true;
      renderAll();
    });
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