# orOS — CHANGELOG & ARCHITECTURE REFERENCE

Live: https://useoros.online · Repo: github.com/koulaxizis/oros
This file is the PRIMARY handoff document between chats. It records
the mantra, standing process rules, all architecture contracts, the
release pipeline, checklists, backlog and release history. Read it
fully before touching any file.

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
R1  NO WHOLESALE REGENERATION. Surgical patches only. A regenera-
    tion drops working code invisibly (v0.14.0 strikes).
R2  RELEASE RITUAL IS MANDATORY (see RELEASE PIPELINE). Stale
    bundles impersonate broken code — multiple strikes so far:
    v0.13.1 (sync), v0.14.1 (labels), v0.14.2 (palette).
R3  VERIFY THE RUNNING VERSION FIRST. Menu badge = v<APP_VERSION>.
    Confirm on BOTH devices before interpreting symptoms as code
    bugs. Staleness diagnostic: fetch with a cachebust param and
    compare content + ?v= + APP_VERSION against the running copy.
R4  PATCH FORMAT: old block + new block + exact location. If
    anything is unclear, ask — never guess selectors or structures.
R5  MERGES ARE SYMMETRIC. Tie-breaks: mtime, then lexicographic
    JSON — never "local wins".
R6  Pull-fed slice setters NEVER call markDirty (infinite loop).
R7  renderAll() re-syncs ALL DOM controls after state changes.
R8  Apps resolve sync via syncApi():
    (window.parent && window.parent.orosSync) || window.orosSync.
R9  i18n keys must match data-i18n attributes EXACTLY; HTML ships
    icon buttons EMPTY, JS injects SVGs (paintStaticIcons pattern
    + runtime-cloned buttons for extra header/footer actions).
R10 Floating views (search, tag panel) are SESSION-ONLY: they
    persist NOTHING — no prefs, no storage keys. Sync pulls can
    never resurrect them.

────────────────────────────────────────────────────────────────
CURRENT STATE (v0.16.0)
────────────────────────────────────────────────────────────────
Core shell  : APP_VERSION 0.16.0 in shell.js (single source of
              truth). sw.js CACHE_VERSION, manifest version and
              ALL ?v= stamps are written AUTOMATICALLY by the CI
              action (see RELEASE PIPELINE).
Apps        : To-Do (merge v0.4, DATA_VER 3), Kanban (v0.5,
              DATA_VER 4), Notes (v0.16.0, DATA_VER 2).
Sync engine : sync.js v0.8.1 (per-slice baselines + divergence
              guard).
Skins       : 16 · Wallpapers: 15 (sand default).
Shell uses  : useoros.online only.

NOTES APP FEATURE SET (v0.16.0, cumulative):
  - Zim-style page tree (folders/sub-pages, LWW merge, tombs)
  - Page labels/registry with colored dots + editor chips
  - Export: page .txt (node menu) · notebook ZIP (node menu +
    tree-footer button) — in-house store-method ZIP writer with
    CRC32, ZERO dependencies
  - Search: Ctrl+K or 🔍 button — titles + content, snippets
    around the match, title-hits ranked first, 50-result cap
  - Tags aggregation panel: 🏷 button in tree footer — all labels
    with page counts → click a label → its pages → click to open

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
  translations.js       EN/EL shell strings (window.t)
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
  oros-notes-prefs            Notes device-local prefs (NOT synced)
  oros-kanban-data            Kanban slice storage (syncs)
  NOTE: v0.16.0 added ZERO new keys — search + tag panel are
  session-only by construction (R10).

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
  converge only via a live open.

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
  notes.js once passed its OWN documentElement → the app froze
  on the oros fallback palette forever.
  G3 scans JS files referenced via src="" in the app index.html
  — an app using inline <script> needs the guard extended.

EXPORT SUBSYSTEM (Notes, v0.15.0) — zero dependencies
  writeZip(entries[{path,data}]) → Blob: store-method ZIP,
  CRC32 table, DOS timestamps, UTF-8 names (flag bit 11).
  sanitizeFilename() (80 chars, strips \\/:*?"<>|, ASCII
  "Untitled" fallback), sanitizeFolder() (no trailing dots).
  Notebook zip: tree mirrors folders 1:1, parent's .txt lives
  inside its own folder, duplicates " (2)", cycle guard depth
  50, name notes-YYYY-MM-DD.zip.
  Download via object URL (revoked after 1s).
  IMPORT IS DEFERRED — exports are one-way for now. Full-
  fidelity restore = the shell manual DB export/import.

SEARCH + TAG PANEL (Notes, v0.16.0)
  openSearch(): Ctrl+K or 🔍 (tree footer). Titles + content,
  lowercase contains, title hits ranked first then mtime desc,
  50-result cap, snippet ±30 chars around first text match.
  tag panel: 🏷 (tree footer) → labels with counts → filtered
  page list (mtime desc) → click opens the page.
  Both session-only (R10): zero persistence. Escape, backdrop
  click, outside click and X close everything.

TREE FOOTER BUTTON ORDER (runtime-injected after the + button):
  [🔍 search] [＋ new] [⬇ export zip] [🏷 tags]

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
       EVERY index.html (directory scan — new apps need ZERO
       config; absolute URLs untouched).
     – G2 offline guard: app folders must appear in sw.js
       PRECACHE_URLS, else FAIL.
     – G3 palette guard: app JS must contain inheritPalette AND
       watchPalette, else FAIL.
  5. Commit via `git add -u` (all TRACKED modified files).

────────────────────────────────────────────────────────────────
FILE UPDATE CHECKLISTS (standing rules)
────────────────────────────────────────────────────────────────
A. VERSION BUMP (every release) — ONE manual step
   1. shell.js: APP_VERSION (+ per-app APP_VERSION/comment where
      the app itself tracks one).
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
      setters never markDirty (R6).
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

────────────────────────────────────────────────────────────────
WAVE 2 (Notes) — STATUS
────────────────────────────────────────────────────────────────
DONE:
  v0.14.1  Page labels: registry + attach/detach + tomb merge +
           tree dots, editor chips, stylized picker.
  v0.14.2/3  Palette fix (inheritPalette read the app's own root
           instead of the shell's) + data-theme mirror.
  v0.15.0  Exports: page .txt + notebook ZIP (in-house writer,
           zero dependencies). Import DEFERRED.
  v0.16.0  Search (Ctrl+K, session-only) + Tags aggregation
           panel (session-only). Zero new storage keys.

REMAINING (Wave 2 tail):
  – Wiki-links [[Page]] with creation-on-click (PREREQUISITE
    for backlinks).
  – Backlinks panel: occurrences of [[current page title]]
    across other pages.

BACKLOG (recorded, not scheduled)
  – Notes import (.txt → new page, ZIP → non-destructive restore
    under "Import <date>" root) — deferred by decision.
  – Kanban/To-Do per-field merges (subtasks/info).
  – Schema-aware generic union for mergeless closed-app proxies.
  – Snapshot compression.
  – Restore-button icon polish.
  – Zombie slice references cleanup; sync.js dead `changed` var.
  – Extend CI G3 if an app ever uses inline <script>.

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
           ?v= in the ritual; changelog rebuilt.
0.14.2/3   Palette fix (wrong root in inheritPalette) + data-theme
           mirror.
0.15.0     Notes exports: page .txt + notebook ZIP (store-method,
           CRC32, zero deps). Import deferred.
0.16.0     Notes search (Ctrl+K) + tags aggregation panel — both
           session-only, zero new storage keys. CI action v3
           (no paths filter, git add -u, fail-loud manifest, G2
           offline guard, G3 palette guard).