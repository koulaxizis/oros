# orOS — CHANGELOG & ARCHITECTURE REFERENCE

Live: https://useoros.online · Repo: github.com/koulaxizis/oros
This file is the PRIMARY handoff document between chats. It records
the mantra, standing process rules, all architecture contracts, the
release pipeline, checklists, backlog and release history. READ IT
FULLY BEFORE TOUCHING ANY FILE — it is dense on purpose; every
section here exists because something broke once without it.

Structure of this document:
  MANTRA → PROCESS RULES → CURRENT STATE → REGISTRIES (files,
  storage keys, data models, sync, palette, exports, links) →
  RELEASE PIPELINE → CHECKLISTS → WAVE STATUS → BACKLOG → HISTORY.

────────────────────────────────────────────────────────────────
MANTRA (design contract — never violate)
────────────────────────────────────────────────────────────────
  Offline first · Mobile first · No external dependencies ·
  Full project manual export · Full project automatic export ·
  Full project snapshots · Full project auto-merge sync ·
  No guessing: if unsure, ASK; if a file is missing, REQUEST it;
  never guess or assume.

────────────────────────────────────────────────────────────────
STANDING PROCESS RULES
────────────────────────────────────────────────────────────────
R1  NO WHOLESALE REGENERATION. Surgical patches only (old block +
    new block + exact location). A regeneration drops working
    code invisibly (v0.14.0 lost icon injection + i18n keys this
    way). User validates by pasting files back for confirmation.
R2  RELEASE RITUAL IS MANDATORY (see RELEASE PIPELINE). Stale
    bundles impersonate broken code — strikes so far: v0.13.1
    (sync), v0.14.1 (labels), v0.14.2 (palette, twice: orphan
    brace at notes.js:311 + stale ?v=0.13.1 served by SW).
R3  VERIFY THE RUNNING VERSION FIRST. Menu badge = v<APP_VERSION>.
    Confirm on BOTH devices before interpreting symptoms as code
    bugs. Staleness diagnostic (proven, reuse verbatim):
      var s = document.querySelector('script[src*="notes.js"]');
      fetch(s.src.split("?")[0] + "?cachebust=" + Date.now())
        .then(r=>r.text()).then(t=>console.log(t.match(
        /APP_VERSION\s*=\s*"([^"]+)"/)));
    Fetch with cachebust BYPASSES the SW (different URL ⇒
    different cache entry) — compares deployed truth vs running
    copy. Caution: fetch the JS via its <script src>, NOT
    location.href (that is the HTML, APP_VERSION regex nulls).
R4  PATCH FORMAT: old block + new block + exact location (function
    name / neighboring lines). Before building a patch that
    chains on TOP of a previous patch, CONFIRM the previous patch
    was actually applied (v0.16.0 Patch 3 hung on an unapplied
    v0.15.0 Patch 2 — caught by the user, never assume).
R5  MERGES ARE SYMMETRIC. Tie-breaks: mtime, then lexicographic
    JSON — never "local wins" (flip-flops between devices).
R6  Pull-fed slice setters NEVER call markDirty (pull→set→push→
    pull infinite loop otherwise). Echo suppression in setters:
    compare incoming JSON vs live JSON, bail if equal.
R7  renderAll() re-syncs ALL DOM controls after state changes —
    partial renders leave stale UI (chips AND tree dots AND
    links strip all refresh from renderEditor/renderAll).
R8  Apps resolve sync via syncApi():
    (window.parent && window.parent.orosSync) || window.orosSync.
R9  i18n keys must match data-i18n attributes EXACTLY; HTML ships
    icon buttons EMPTY, JS injects SVGs (paintStaticIcons pattern
    + runtime-cloned/injected buttons for extra footer actions —
    never touch HTML/CSS for a new button, clone .icon-btn).
R10 FLOATING/TRANSIENT VIEWS ARE SESSION-ONLY: search, tag panel
    persist NOTHING — no prefs, no storage keys. Sync pulls and
    re-renders can never resurrect them. User demands this.
R11 WHEN SHIPPING UI, USER LOOKS FOR PATCH LOCATIONS IN HIS
    CURRENT FILE — patches may arrive out of order or reference
    unapplied predecessors (see R4). When in doubt, SHIP THE
    COMBINED BLOCK (e.g. the unified v0.15.0+v0.16.0 tree-footer
    button injection) rather than chained anchors.

────────────────────────────────────────────────────────────────
CURRENT STATE (v0.17.0) — WAVE 2 (NOTES) COMPLETE
────────────────────────────────────────────────────────────────
Core shell  : APP_VERSION 0.17.0 in shell.js (single source of
              truth). sw.js CACHE_VERSION, manifest version and
              ALL ?v= stamps are written AUTOMATICALLY by the CI
              action (see RELEASE PIPELINE).
Apps        : To-Do (merge v0.4, DATA_VER 3), Kanban (v0.5,
              DATA_VER 4), Notes (v0.17.0, DATA_VER 2).
Sync engine : sync.js v0.8.1 (per-slice baselines + divergence
              guard).
Skins       : 16 · Wallpapers: 15 (sand default).
Shell uses  : useoros.online only (no alt domains).

NOTES APP FEATURE SET (v0.17.0, cumulative):
  - Zim-style page tree (folders/sub-pages, LWW merge, tombs)
  - Page labels/registry: colored tree dots, editor chips,
    stylized picker (create/attach/detach/delete in one popover)
  - Export: page .txt (node menu) · notebook ZIP (node menu +
    tree-footer button) — in-house store-method ZIP writer with
    CRC32, ZERO dependencies
  - Search: Ctrl+K or 🔍 — titles + content, snippets, title
    hits first, 50-result cap
  - Tags aggregation panel: 🏷 — labels with counts → filtered
    page list
  - Wiki-links [[Title]] + backlinks strip under the editor:
    outgoing chips (solid = resolved, dashed = creation-on-click),
    backlink chips (pages mentioning [[current title]]); live
    while typing

NOTES TREE FOOTER (runtime-injected, order):
  [🔍 search] [＋ new] [⬇ export zip] [🏷 tags]

────────────────────────────────────────────────────────────────
REFERENCE REGISTRIES
────────────────────────────────────────────────────────────────

FILE TREE (repo root)
  index.html            shell markup + SW lifecycle broker
                        (inline: skipWaiting + controllerchange reload)
  shell.js              shell logic, menus, skins, wallpapers,
                        auto-backup, shell slice registration
  style.css             shell stylesheet (skin palettes = the
                        canonical palette vocabulary source)
  sync.js               orOS sync engine v0.8.1
  translations.js      EN/EL shell strings (window.t)
  apps.json             app registry (name, url, icon, category)
  sw.js                 service worker (cache-first; only
                        CACHE_VERSION bump busts it; PRECACHE_URLS
                        must cover apps — CI guard G2 enforces)
  manifest.webmanifest  PWA (start_url "/?source=pwa",
                        theme_color #1b1a18, background #131820,
                        display standalone, maskable icons)
  fonts/                vendored Nunito woff2 (5 weights)
  todo/  kanban/  notes/  app folders (index.html + css + js)
  .github/workflows/bump-version.yml   release pipeline (v3)
  CHANGELOG.md          THIS FILE

LOCALSTORAGE / STORAGE KEYS
  oros-lang / oros-theme / oros-skin / oros-wallpaper   prefs
  oros-last-version          last SEEN version (update toast)
  oros-slices                 registered slice metadata (sync)
  oros-sync-baselines         per-slice pushed hashes (djb2)
  oros-sync-dirty             unpushed-changes flag
  oros-remote-carry           parked remote payloads (divergence)
  oros-db-account            Dropbox account cache
  oros-autoexport             auto-backup mode (off/daily/weekly/monthly)
  oros-autoexport-last        last auto-backup check epoch
  oros-auto-snapshots         rolling 5 full-DB snapshots (FIFO)
  oros-fs-folder-name / oros-fs-lapsed   backup-folder state
  IndexedDB "oros-fs"         store "handles" → FileSystemDirectoryHandle
  oros-todo-data              To-Do slice storage (syncs)
  oros-notes-data             Notes slice storage (syncs)
  oros-notes-prefs            Notes device-local prefs {open,
                              current, width} — NOT synced
  oros-kanban-data            Kanban slice storage (syncs)
  NOTE: v0.15.0–v0.17.0 added ZERO new keys — search, tag panel,
  links strip are derived/session-only by construction (R10).

NOTES DATA MODEL (DATA_VER 2)
  state = { ver, pages:[{id, parent, title, text, mtime, pos,
    labels:[]}], labels:[{id, name, color, mtime, pos}],
    tombs: {pageId→ts, "lbl:"+labelId→ts} }
  8-color LABEL_COLORS palette (shared vocabulary with To-Do):
  #e06c75 #ecc75f #87cf3e #4fc4cf #6d4aff #e09ecf #f28c5a #9aa4b0
  Merge: per-page/label LWW (mtime, tie → lexicographic JSON),
  tombs union max-ts, delete wins ties (>=), 30d prune,
  normalizeState() idempotent (runs on load AND merge results).
  Autosave debounce 500ms; flushSave on switch/hide/unload.
  DEBUG: window.__notesDebug = {version, state, merge, sliceGet}.

SYNC ENGINE v0.8.1 (sync.js)
  api.registerSlice(name, get, set, storageKey?, mergeFn?)
    — 5th arg enables merge; mergeFn throw → degrade to LWW.
  Baselines (djb2) per slice; divergence guard for mergeless
    slices: unpushed = dirty OR missing baseline OR mismatch ⇒
    remote parks in oros-remote-carry, local becomes new truth.
  reconcile(reason) triggers: boot / interval / visible / online /
    register / debounce (DEBOUNCE_MS = 5000).
  ACCEPTED LIMIT: two devices offline with the app closed
    converge only via a live open (merge needs app code present).

SHELL SLICE (synced): { lang, theme, skin, wallpaper,
  syncInterval, autoexport } — getter reads live state; setter
  applies pulled values and NEVER marks dirty.

MERGE CONTRACTS PER APP
  To-Do (v0.4): per-entity mtime + om/pos ordering, root scalars
    LWW, tombstones 30d, structural merge, Undo = stampAll().
  Kanban (v0.5, DATA_VER 4): root om = column order, column om =
    card order, card mtime INCLUDES placement, cascade tombs,
    deleteLabel touches every card wearing it, subtasks/info =
    whole-card LWW (backlog).
  Notes: see NOTES DATA MODEL above.

PALETTE CONTRACT (iframe apps) — CI-ENFORCED (G3)
  inheritPalette() MUST read
    window.parent.document.documentElement   (the SHELL's html,
    NOT the app's own!) and copy the 11 PAL_VARS (--bg, --bg-
    desktop, --bar-bg, --text, --text-dim, --accent, --accent-
    hover, --accent-soft, --panel-bg, --border, --shadow) onto
    the app root. ALSO mirror data-theme (light/dark) from the
    parent. watchPalette(): MutationObserver on parent <html>
    {data-skin, data-theme} → instant re-inherit.
  REFERENCE IMPLEMENTATION: todo.js §12. v0.14.2 lesson:
  notes.js once passed its OWN documentElement to
  window.parent.getComputedStyle — the app read itself, saw its
  own non-empty fallback :root, and froze on the oros palette
  forever. Symptom: "the app seems to have its own theme".
  G3 scans JS files referenced via src="" in the app index.html
  — an app using inline <script> needs the guard extended.

EXPORT SUBSYSTEM (Notes, v0.15.0) — zero dependencies
  writeZip(entries[{path,data}]) → Blob: store-method ZIP,
  CRC32 table, DOS timestamps, UTF-8 names (flag bit 11).
  utf8: TextEncoder with manual code-point fallback (works on
  ancient browsers — offline-everywhere mantra).
  sanitizeFilename() (80 chars, strips \\/:*?"<>|, ASCII
  "Untitled" fallback), sanitizeFolder() (no trailing dots).
  Notebook zip: tree mirrors folders 1:1, parent's .txt lives
  inside its own folder, duplicates " (2)", cycle guard depth
  50, name notes-YYYY-MM-DD.zip.
  Download via object URL (revoked after 1s).
  IMPORT IS DEFERRED — exports are one-way. Full-fidelity
  restore = the shell manual DB export/import.

WIKI-LINK SUBSYSTEM (Notes, v0.17.0) — zero storage, derived
  Syntax: [[Title]] inside page TEXT (plain-text purity — the
  editor is a <textarea>, links are NEVER injected into the
  text, only rendered as chips in a strip BELOW the editor).
  wikiTitles(text): regex /\[\[([^\[\]]+)\]\]/g, dedupe case-
    insensitive, preserves original casing.
  pageByTitle(title): exact case-insensitive trim match.
  Resolution model (openOrCreateFromLink):
    - resolved  → chip SOLID → selectPage(target)
    - unresolved → chip DASHED → CREATION-ON-CLICK: newPage()
      as CHILD of the current page, then overwrite its title
      (deliberate: reuses newPage's selection/save/toast flow,
      renderAll repaints the strip with the post-state).
  backlinkPages(current): other pages whose text contains the
    literal needle "[[<current title>]]" (title trimmed; empty
    title ⇒ no backlinks).
  Render triggers: renderEditor (selection/switch/sync-render)
    AND live on text input (cheap — strip is a separate element,
    textarea typing never interrupted; no debounce needed).
  Merge-wise: links live in page.text ⇒ plain LWW riding the
    existing per-page merge. NOTHING to sync. CASE-SENSITIVITY
    EDGE: [[ona]] vs page "Ονά" resolve (case-insensitive) but
    backlink needle matching is literal — renaming a page
    leaves stale needles; acceptable (deterministic, documented
    here as known trade-off; a fuzzy-normalizing backlink
    matcher is a possible backlog item if it ever bites).

VIEW-DERIVATION PRINCIPLE (established v0.15.0–0.17.0)
  Anything computable from state is DERIVED AT RENDER TIME, not
  stored: search results, tag counts, tag page lists, link
  resolution, backlinks. Benefits: zero storage keys, zero sync
  surface, zero migration risk, impossible to desync. All such
  views are SESSION-ONLY (R10). Future Notes features should
  default to this principle and only persist data that survives
  a page reload (tree shape, page content, labels).

SEARCH + TAG PANEL (Notes, v0.16.0)
  openSearch(): Ctrl+K or 🔍 (tree footer). Titles + content,
  lowercase contains, title hits ranked first then mtime desc,
  50-result cap, snippet ±30 chars around first text match,
  Enter = first result, Esc/backdrop click closes.
  tag panel: 🏷 → labels with counts (sorted pos, then name) →
  click a label → its pages (mtime desc) → click opens.

AUTO-BACKUP (v0.12.0+)
  Mode off/daily/weekly/monthly in shell slice; checks at boot +
  tab-visible only; on-change-only compare; rolling 5 snapshots
  in oros-auto-snapshots (FIFO); restore via orosSync.importData.
  FS-folder mirror (Chromium desktop): IndexedDB-held handle,
  permission check per write, ⚠ + Reconnect UI on revoke.

────────────────────────────────────────────────────────────────
RELEASE PIPELINE — .github/workflows/bump-version.yml (v3)
────────────────────────────────────────────────────────────────
Triggers on EVERY push to main (no paths filter). Steps:
  1. Read APP_VERSION from shell.js (fail if missing).
  2. Stamp sw.js CACHE_VERSION = "oros-v<version>" (fail loudly).
  3. Stamp manifest.webmanifest version (fail loudly).
  4. Node step:
     – ?v=<version> on every RELATIVE .css/.js reference in
       EVERY index.html (root + all app folders, directory scan —
       new apps need ZERO config; absolute URLs untouched).
     – G2 offline guard: app folders must appear in sw.js
       PRECACHE_URLS, else FAIL (v0.13.0 lesson).
     – G3 palette guard: app JS must contain inheritPalette AND
       watchPalette, else FAIL (v0.14.2 lesson).
  5. Commit via `git add -u` (all TRACKED modified files — the
     old hardcoded file list once omitted notes/index.html and
     the stamp died on the runner's disk).
Self-trigger note: the bot's own commit re-runs the workflow
once; stamps are then already current → no diff → no commit →
terminates. Safe.

────────────────────────────────────────────────────────────────
FILE UPDATE CHECKLISTS (standing rules)
────────────────────────────────────────────────────────────────
A. VERSION BUMP (every release) — ONE manual step
   1. shell.js: APP_VERSION (+ the per-app APP_VERSION & header
      comment when the app itself tracks one — notes.js does).
   2. Push to main. The Action stamps everything else.
   3. Verify on BOTH devices: menu badge = new version BEFORE
      interpreting behavior as broken code (R3).

B. NEW APP ADDED (<app>/ folder)
   1. apps.json — entry (name, url, icon, category).
   2. sw.js — add the app's files to PRECACHE_URLS (G2 fails
      the push otherwise).
   3. shell.js — icon SVG in the ICONS map.
   4. Translations — category label + shell-facing strings.
   5. Register a sync slice (R8; merge contracts). Pull-fed
      setters never markDirty (R6); setter compares JSON and
      suppresses echoes.
   6. Palette inheritance: inheritPalette + watchPalette (G3
      enforces; reference todo.js §12).
   7. Nothing in bump-version.yml (directory scan). ?v= is
      stamped automatically.
   8. Follow checklist A for the release bump.

C. NEW FILE ADDED TO AN EXISTING APP
   1. sw.js — add to PRECACHE_URLS if it must work offline.
   2. ?v= stamp is automatic on the next bump if referenced
      from the app's index.html.

D. SYNC ENGINE CHANGES (sync.js)
   - Version bump only. Re-read the DEPLOYED file (cachebust
     fetch) before diagnosing — stale SW caches impersonate
     broken code (R3).

E. RELEASE PRE-FLIGHT (recommended before any stable push)
   - JS/JSON syntax sanity (node --check or paste-validate).
   - Console in app iframe: no SyntaxError, __notesDebug alive,
     version matches badge.
   - Deploy + badge check on BOTH devices before feature
     testing (Lesson 4).

────────────────────────────────────────────────────────────────
WAVE 2 (Notes) — CLOSED ✓
────────────────────────────────────────────────────────────────
  v0.14.1  Page labels: registry + attach/detach + tomb merge +
           tree dots, editor chips, stylized picker.
  v0.14.2/3  Palette fix (inheritPalette read the app's own
           root) + data-theme mirror.
  v0.15.0  Exports: page .txt + notebook ZIP (in-house writer,
           zero dependencies). Import DEFERRED.
  v0.16.0  Search (Ctrl+K) + Tags aggregation panel — both
           session-only, zero new storage keys.
  v0.17.0  Wiki-links [[Title]] + backlinks strip (creation-
           on-click, child of current page; links strip under
           editor, live while typing, zero storage). Links are
           NOT clickable inside the textarea by design — plain-
           text purity; clickable in-text = read-mode (backlog).

POST-WAVE-2 RECOMMENDED NEXT STEPS (assistant's suggestion):
  1. Cold audit of the Notes app (4 releases, 2 weeks old) —
     orphaned code, unused i18n keys ("notes.*" pre-0.14 block
     exists in STRINGS), CSS dead rules, structural drift.
  2. Feature-parity sweep To-Do ↔ Kanban ↔ Notes (search, labels
     presence, export story per app).
  3. Any backlog item below, on request.

────────────────────────────────────────────────────────────────
BACKLOG (recorded, not scheduled)
────────────────────────────────────────────────────────────────
  – Notes read-mode (rendered [[links]] clickable inside text —
    needs a preview pane; deliberately deferred).
  – Notes import (.txt → new page, ZIP → non-destructive restore
    under "Import <date>" root) — deferred by user decision.
  – Fuzzy/case-insensitive backlink needle matching (see
    WIKI-LINK SUBSYSTEM trade-off note).
  – Kanban/To-Do per-field merges (subtasks/info).
  – Schema-aware generic union for mergeless closed-app proxies.
  – Snapshot compression.
  – Restore-button icon polish.
  – Zombie slice references cleanup; sync.js dead `changed` var
    in collectPayload.
  – Extend CI G3 if an app ever uses inline <script>.
  – Idea (loose, never confirmed): Pad app, pagination app,
    Public Domain Calculator — separate orOS waves, not Notes.

────────────────────────────────────────────────────────────────
RELEASE HISTORY (condensed)
────────────────────────────────────────────────────────────────
0.1–0.9    Shell born: bar, menu, skins, wallpapers, PWA, clock;
           To-Do built; Dropbox sync begun.
0.10.x     Sync hardening; intervals; shell slice.
0.11.x     Kanban ported (merge engine v0.4 pattern).
0.12.x     +6 Linux skins, +5 composite wallpapers; auto-backup
           snapshots + FS-folder mirror.
0.13.0/1   Notes app born; deploy failure (SW cache + missing
           PRECACHE) → notes.js rebuilt with syncApi(), palette
           inheritance, full redeploy ritual.
0.14.0     Notes labels (Wave 2.1). Regressions from a wholesale
           regeneration (lost icon injection + i18n keys).
0.14.1     Four surgical patches + appended CSS block; app-level
           ?v= in the ritual; changelog rebuilt as architecture
           reference.
0.14.2/3   Palette fix (wrong root in inheritPalette) + data-theme
           mirror; the orphan-brace/ SyntaxError + stale-?v= SW
           double strike (R2/R3 hardened, R11 born).
0.15.0     Notes exports: page .txt + notebook ZIP (store-method,
           CRC32, zero deps). Import deferred. CI action v3 (no
           paths filter, git add -u, fail-loud manifest, G2
           offline guard, G3 palette guard).
0.16.0     Notes search (Ctrl+K) + tags aggregation panel — both
           session-only, zero new storage keys.
0.17.0     Notes wiki-links [[Title]] + backlinks strip — Wave 2
           COMPLETE. VIEW-DERIVATION PRINCIPLE formalized.