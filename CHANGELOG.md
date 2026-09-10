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
R12 SHORTCUT CHOICES: validate against NATIVE browser combos
    BEFORE shipping (v0.18.0: Ctrl+Shift+E was native in FF/
    Chrome → swapped to Ctrl+Shift+X pre-release; the near-miss
    cost one revision round). The Info modal table derives from
    SC_DEFS — a shortcut change is ONE line (key letter), the
    table follows automatically.

────────────────────────────────────────────────────────────────
CURRENT STATE (v0.18.0) — WAVE 3 (SHELL) COMPLETE
────────────────────────────────────────────────────────────────
Core shell  : APP_VERSION 0.18.0 in shell.js (single source of
              truth). sw.js CACHE_VERSION, manifest version and
              ALL ?v= stamps are written AUTOMATICALLY by the CI
              action (see RELEASE PIPELINE).
Apps        : To-Do (merge v0.4, DATA_VER 3), Kanban (v0.5,
              DATA_VER 4), Notes (v0.17.0, DATA_VER 2 — save-
              indicator REMOVED in v0.18.0, see below).
Sync engine : sync.js v0.8.1 (per-slice baselines + divergence
              guard).
Skins       : 16 · Wallpapers: 15 (sand default).
Shell uses  : useoros.online only (no alt domains).

WAVE 3 (v0.18.0) FEATURE SET — all six shipped:
  1. Global shortcuts, Contract Β (shell-owned handler +
     per-app forwarding) — Ctrl+Shift+P/O/S/X + I/U/L/R.
  2. Weather widget (Open-Meteo, taskbar chip, offline-aware).
  3. Taskbar sync dot (single OS-wide sync indicator, chromatic
     states) — per-app indicators removed (Notes save-indicator
     was the only one).
  4. Backup-folder Stop/Reconnect button styling fix.
  5. Version toast: single line, tighter gap, mobile compact.
  6. Info modal (Ctrl+Shift+I + menu row) — about + auto-
     generated shortcuts table.

NOTES APP FEATURE SET (v0.17.0, cumulative — app untouched in
0.18.0 except the save-indicator removal):
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
  - v0.18.0: save-indicator dot REMOVED (HTML div + 3 CSS rules
    + setSaveIndicator() + 3 call sites). Dirty-state is shown
    by the TASKBAR sync dot (orange "dirty" state) — one
    indicator OS-wide by design.

NOTES TREE FOOTER (runtime-injected, order):
  [🔍 search] [＋ new] [⬇ export zip] [🏷 tags]

────────────────────────────────────────────────────────────────
REFERENCE REGISTRIES
────────────────────────────────────────────────────────────────

FILE TREE (repo root)
  index.html            shell markup + SW lifecycle broker
                        (inline: skipWaiting + controllerchange reload)
  shell.js              shell logic, menus, skins, wallpapers,
                        auto-backup, shell slice registration,
                        shortcuts (§9c), weather (§9d), taskbar
                        sync dot (§9b)
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
  oros-weather                weather settings {on, auto, lat,
                              lon, label} — TRAVELS IN SHELL SLICE
  oros-wx-cache               last successful weather read {at,
                              temp, code} — DEVICE-LOCAL, never
                              synced (an offline device must not
                              inherit another device's stale temp)
  oros-wx-last                epoch ms of last fetch attempt
                              (device-local throttle)
  v0.15.0–0.17.0 added ZERO new keys; v0.18.0 added the three
  weather keys above (wx settings are prefs, cache/throttle are
  device-local by contract).

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
  syncInterval, autoexport, weather } — getter reads live state;
  setter applies pulled values and NEVER marks dirty (R6).
  weather is normalized on set (invalid lat/lon → null, label
  coerced to string) so a corrupt remote can never poison prefs.

GLOBAL SHORTCUTS SUBSYSTEM (v0.18.0) — shell.js §9c
  Architecture — CONTRACT Β (shell owns, apps forward):
    - ALL handlers live in the shell (section 9c).
    - window.orosShortcuts = { handle(e) } is the public contract.
    - Apps forward via ONE standalone capture-phase listener
      (template shipped to todo/kanban/writer/notes):
        document.addEventListener("keydown", function (e) {
          if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
          var p = window.parent;
          if (!(p && p.orosShortcuts &&
                typeof p.orosShortcuts.handle === "function")) return;
          if (p.orosShortcuts.handle(e)) e.stopPropagation();
        }, true);   // capture: beats the app's own bubble listeners
  Combos (Ctrl+Shift+*, metaKey accepted for macOS):
    P  force push        O  force pull (was F — O chosen: F is
                          browser-native in several browsers)
    S  snapshot now      X  export DB (was E — native conflict,
                          see R12)
    I  info modal        U  check updates (SW update() ping)
    L  toggle language  R  reconnect (Dropbox connect OR
                          backup-folder permission re-grant —
                          both need user activation, satisfied)
  SC_DEFS array = single source of truth: the dispatch handler
    AND the Info modal table both derive from it. Adding a
    shortcut = one SC_DEFS entry + one i18n key. Nothing else.
  Shell-level listener (§12) passes every Ctrl+Shift combo to
    orosShortcuts.handle; unmatched combos fall through untouched.
  Guard conditions: ctrl||meta AND shift, no alt, single-char key.

TASKBAR SYNC DOT (v0.18.0) — shell.js §9b
  #sync-dot inside .bar-right (button, injected at runtime).
  STATES (data-state attr, colors via CSS):
    off      grey            not connected
    locked   hollow ring     connected, no passphrase
    idle     dim grey        connected + unlocked + clean
    syncing  accent, pulse  push/pull in flight
    synced   green          4s transient, auto-reverts
    dirty    orange         unpushed changes (cf. beforeunload)
    err      red            6s transient on any sync error
  Derivation: autoSyncDot() piggybacks the 1s clock tick —
    recomputes off/locked/idle/dirty when no transient holds
    (syncDotHold timestamp). Manual pull/push/unlock + auto-sync
    pulses set transient states. setSyncMsgRaw wires err→red.
  Click = open app menu (same behavior as the weather chip).
  THE MENU COPY IS GONE: renderSyncSection renders no dot; the
    taskbar dot represents ALL apps (per-app removal: Notes
    save-indicator deleted in v0.18.0 — the only one).

WEATHER WIDGET (v0.18.0) — shell.js §9d
  Provider: Open-Meteo forecast + geocoding APIs. NO API key,
  no cookies (privacy stance; the two hosts are the ONLY
  external network calls in the entire shell — third-party
  deps rule interpreted as: no code deps; network APIs allowed
  for this opt-in feature. OFF BY DEFAULT).
  Display: taskbar chip #wx-chip (button, before #btn-lang).
    icon (WMO code → one of 8 inline SVGs, night variants for
    clear/partly between 21:00–06:00 local) + temperature.
    Click = open app menu. Painted by wxRenderChip() on every
    clock tick (cheap, no fetch inside the tick loop).
  OFFLINE CONTRACT (user-decreed): offline → slashed-cloud SVG
    and NO temperature. Also no location yet or cache older
    than 3h (WX_STALE_MS) → slashed cloud, dimmed. Never a
    stale or invented temperature.
  Fetch policy (no idle timers — same stance as auto-backup):
    throttle ≥30 min (WX_MIN_MS) via oros-wx-last; forced by
    user toggles; fired on online + tab-visible events; catch-
    all promise (offline keeps the last painted state).
  Location: EITHER device GPS (geolocation, only ever invoked
    from the menu button click — user activation; maximumAge
    30min, timeout 10s) OR manual city (Open-Meteo geocoding,
    count=1, localized). auto flag records which. Hint line in
    the menu shows GPS/city + rounded coords.
  Sync: settings {on, auto, lat, lon, label} ride the SHELL
    SLICE (cross-device consistency); CACHE stays device-local
    (a device that slept overnight must show offline/refreshed
    reality, not another device's cached degrees).
  WMO mapping: 0 sun/moon · 1-2 partly · 3 cloud · 45/48 fog ·
    51-67 rain · 71-77 snow · 80-82 showers · 85/86 snow · 95+
    storm. Unknown → cloud.

INFO MODAL (v0.18.0) — shell.js §9c showInfoModal
  Trigger: Ctrl+Shift+I or the menu Info row (renders last,
    AFTER the sync section). Content: orOS + version pill,
    tagline "A static operating system in your browser.",
    capabilities line (sc.info.cap — v0.18.0 post-fix: it
    originally reused menu.empty.hint, which read "Apps will
    appear here as they are installed." — wrong context, user
    caught it), the FULL shortcuts table (generated from
    SC_DEFS, ⌘⇧ prefix auto-detected on Apple platforms),
    source link github.com/koulaxizis/oros, credits line.
  Overlay: backdrop click or Escape closes. z-index 1300 (above
    the version toast's 1200).

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
  sanitizeFilename() (80 chars, strips \/:*?"<>|, ASCII
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
      as CHILD of the current page, then overwrite its title.
  backlinkPages(current): other pages whose text contains
    the literal needle "[[<current title>]]".
  Render triggers: renderEditor AND live on text input.
  Merge-wise: links live in page.text ⇒ plain LWW. CASE
    EDGE: renaming a page leaves stale needles; acceptable.

VIEW-DERIVATION PRINCIPLE (established v0.15.0–0.17.0)
  Anything computable from state is DERIVED AT RENDER TIME, not
  stored. Zero storage keys, zero sync surface, impossible to
  desync. v0.18.0 extension: the weather CHIP is likewise
  derived-per-tick from cache+prefs+online state — the chip
  itself stores nothing, only paints.

SEARCH + TAG PANEL (Notes, v0.16.0)
  openSearch(): Ctrl+K or 🔍. Titles + content, lowercase
  contains, title hits first then mtime desc, 50-result cap,
  snippet ±30 chars, Enter = first result, Esc/backdrop closes.
  tag panel: 🏷 → labels with counts → click → its pages.

AUTO-BACKUP (v0.12.0+)
  Mode off/daily/weekly/monthly in shell slice; checks at boot +
  tab-visible only; on-change-only compare; rolling 5 snapshots
  in oros-auto-snapshots (FIFO); restore via orosSync.importData.
  FS-folder mirror (Chromium desktop): IndexedDB-held handle,
  permission check per write, ⚠ + Reconnect UI on revoke.
  v0.18.0 style fix: the Stop/Reconnect/Choose button inside
    .sync-interval rows was unstyled (menu-item expected a
    .sync-actions wrapper) — compact bordered style added; the
    label ellipsizes (flex:1 + min-width:0).

VERSION TOAST (v0.8.0 style, tightened v0.18.0)
  Sole update confirmation after auto-update reload. v0.18.0:
  gap 8px→5px, white-space:nowrap, max-width 100vw-32px,
  overflow hidden — guaranteed SINGLE line; mobile ≤480px gets
  font-size 11.5px + padding 7px 12px.

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
  5. Commit via `git add -u`.
Self-trigger note: the bot's own commit re-runs the workflow
once; stamps are then already current → no diff → no commit →
terminates. Safe.

────────────────────────────────────────────────────────────────
FILE UPDATE CHECKLISTS (standing rules)
────────────────────────────────────────────────────────────
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
   7. Shortcut forwarding listener (the Contract Β capture-
      template block) — REQUIRED for shell shortcuts to work
      while the app is focused.
   8. Nothing in bump-version.yml (directory scan). ?v= is
      stamped automatically.
   9. Follow checklist A for the release bump.

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
   - Shortcuts smoke test in EACH app: Ctrl+Shift+P while an
     app is focused proves the forwarding listener is live.
   - Deploy + badge check on BOTH devices before feature
     testing (Lesson 4).

────────────────────────────────────────────────────────────────
WAVE 2 (Notes) — CLOSED ✓
──────────────────────────────────────────────────────────────
  v0.14.1  Page labels: registry + attach/detach + tomb merge +
           tree dots, editor chips, stylized picker.
  v0.14.2/3  Palette fix + data-theme mirror.
  v0.15.0  Exports: page .txt + notebook ZIP. Import DEFERRED.
  v0.16.0  Search (Ctrl+K) + Tags aggregation panel.
  v0.17.0  Wiki-links [[Title]] + backlinks strip.

WAVE 3 (Shell) — CLOSED ✓ (v0.18.0)
──────────────────────────────────────────────────────────────
  #4 Folder Stop-button styling fix (.sync-interval label
     ellipsis + compact bordered menu-item).
  #5 Version toast single-line + tighter gap + mobile compact.
  #3 Taskbar sync dot (7 chromatic states, clock-tick
     derivation, transient holds) — menu dot copy REMOVED,
     Notes save-indicator REMOVED (only per-app dot in the
     suite). One indicator OS-wide.
  #1 Global shortcuts Contract Β: SC_DEFS dispatch + shell
     listener + app forwarding template (capture phase).
     Ctrl+Shift+P/O/S/X + I/U/L/R. R12 born (E→X native-
     conflict pre-release swap; O replaces the earlier F).
  #6 Info modal (Ctrl+Shift+I + menu row), shortcuts table
     auto-generated from SC_DEFS, tagline "A static operating
     system in your browser.", repo + credits. Post-ship fix:
     capabilities line initially reused menu.empty.hint
     ("Apps will appear here as they are installed.") — replaced
     by dedicated sc.info.cap key.
  #2 Weather widget: Open-Meteo, taskbar chip, GPS/manual city,
     offline slashed-cloud contract (never a fake temperature),
     settings in the shell slice, cache device-local, 30-min
     throttle, fetches on gesture/online/visible only.

POST-WAVE-3 RECOMMENDED NEXT STEPS (assistant's suggestion):
  1. Shortcuts parity audit: confirm the forwarding listener is
     live in EVERY app (todo, kanban, notes, writer-equivalents)
     — one missing = shortcut dead only when that app focused.
  2. Weather regression matrix: online GPS, online manual city,
     offline chip, stale-cache chip, mobile PWA.
  3. Cold audit of the Notes app (pre-existing recommendation,
     still pending) — orphaned code, unused i18n keys
     ("notes.*" pre-0.14 block in STRINGS), CSS dead rules.
  4. Feature-parity sweep To-Do ↔ Kanban ↔ Notes.
  5. Any backlog item below, on request.

──────────────────────────────────────────────────────────────
BACKLOG (recorded, not scheduled)
──────────────────────────────────────────────────────────────
  – Notes read-mode (rendered [[links]] clickable inside text).
  – Notes import (.txt → new page, ZIP → non-destructive
    restore) — deferred by user decision.
  – Fuzzy/case-insensitive backlink needle matching.
  – Kanban/To-Do per-field merges (subtasks/info).
  – Schema-aware generic union for mergeless closed-app proxies.
  – Snapshot compression.
  – Zombie slice references cleanup; sync.js dead `changed` var
    in collectPayload.
  – Extend CI G3 if an app ever uses inline <script>.
  – Full weather APP (forecast view) — the v0.18.0 widget is the
    shell-surface slice of it; a dedicated app would need its own
    slice if it ever stores more than {on,auto,lat,lon,label}.
  – Idea (loose, never confirmed): Pad app, pagination app,
    Public Domain Calculator — separate orOS waves.

──────────────────────────────────────────────────────────────
RELEASE HISTORY (condensed)
──────────────────────────────────────────────────────────────
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
           mirror; orphan-brace/ SyntaxError + stale-?v= SW
           double strike (R2/R3 hardened, R11 born).
0.15.0     Notes exports: page .txt + notebook ZIP. Import
           deferred. CI action v3 (G2/G3 guards, git add -u).
0.16.0     Notes search (Ctrl+K) + tags aggregation panel.
0.17.0     Notes wiki-links + backlinks strip — Wave 2 COMPLETE.
           VIEW-DERIVATION PRINCIPLE formalized.
0.18.0     WAVE 3 (shell): global shortcuts Contract Β
           (SC_DEFS single-source, app forwarding, R12), taskbar
           sync dot (states off/locked/idle/syncing/synced/dirty/
           err), weather widget (Open-Meteo, offline slashed-
           cloud contract, slice-traveling settings), Info modal
           (auto-generated shortcuts table), version-toast one-
           line fix, folder-button styling fix, Notes save-
           indicator removal. First shell wave since 0.13 — all
           six items user-approved upfront, shipped as one bump.