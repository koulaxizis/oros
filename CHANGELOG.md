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
R3  VERIFY THE RUNNING VERSION FIRST. Version surface (v0.18.2,
    pending push — see SHIP STATUS):
    Info modal (Ctrl+Alt+Shift+I) always shows v<APP_VERSION>;
    the version toast fires on change. The taskbar badge is GONE.
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
    COMBINED BLOCK rather than chained anchors. DELIVER PATCHES
    AGAINST THE USER'S CURRENT FILES, NOT against remembered
    intermediate states: the shortcut v0.18.1b patch assumed a
    standalone capture-template listener existed in notes.js —
    it never did (notes forwards INLINE, inside its wireUI()
    keydown handler). Ask for the file when unsure.
R12 SHORTCUT DESIGN — THREE STRIKES, ONE LESSON EACH:
    (a) Ctrl+Shift+E was native (FF/Chrome) → swapped to X.
    (b) Ctrl+Shift+* wholesale: P opened PRINT DIALOG, S
        screenshot — the browser steals the combo BEFORE the
        page ever sees it (capture phase can't help).
    (c) Alt+Shift+letter was tried as replacement: killed by the
        WINDOWS KEYBOARD LAYOUT TOGGLE (EN↔EL) AND by e.key lying
        under the Greek layout (physical P arrives as "π").
    FINAL CONTRACT: Ctrl+Alt+Shift+letter (zero native conflicts
    in Chrome/FF/Edge/Safari incl. macOS ⌃⌥⇧), matched via
    e.code ("KeyP" — PHYSICAL key, layout-agnostic), never e.key.
    The Info modal table derives from SC_DEFS — a change is one
    SC_DEFS entry; validate against native combos BEFORE shipping
    (test ALL bindings on desktop AND mobile, both layouts).
R13 LOCAL VS DEPLOYED VERSION DESYNC (born in the cleanup wave):
    the local working copy can LAG behind the bot-committed
    remote (action stamps CACHE_VERSION/manifest/?v= and commits
    them; local files only diverge). Before diagnosing "version
    drift" as a code bug, run `git fetch && git log --oneline -5
    origin/main` and look for "chore: stamp version vX (auto)"
    commits; `git pull --ff-only` BEFORE applying version patches.
    v0.18.2 instance: local sw.js showed CACHE_VERSION 0.18.0
    while remote manifest was 0.18.1 — same-workflow stamps can
    never disagree; local staleness was the cause (pending user
    verification at pause time).

### Standing delivery rule
- Patch format scales with change size: SMALL changes ship as
  PALIO/NEO replacement blocks with exact anchors and precise
  placement instructions (before/after); LARGE changes (many
  edits across one file) ship as FULL corrected files. Never the
  inverse: no full-file regeneration for a two-line fix, no
  fragile twelve-step patch chain when a rewrite would be cleaner.

────────────────────────────────────────────────────────────────
CURRENT STATE — see RELEASE HISTORY for the newest version
────────────────────────────────────────────────────────────────
  (Historical note: the detailed CURRENT STATE block froze at
  v0.18.2 / Wave 4. Live state = the newest RELEASE HISTORY
  entries — currently v0.22.0, Mood Wave 1 staged, ship checklist
  in the SESSION HANDOFF at the end of this file. Older registries
  below remain accurate unless a newer section supersedes them.)

Core shell  : APP_VERSION in shell.js (single source of truth).
              sw.js CACHE_VERSION, manifest version and ALL ?v=
              stamps are written AUTOMATICATICALLY by the CI
              action (see RELEASE PIPELINE).
Apps        : To-Do (merge v0.4, DATA_VER 3), Kanban (v0.5,
              DATA_VER 4), Notes (v0.17.0, DATA_VER 2 — save-
              indicator REMOVED in v0.18.0, see below),
              Weather (app v0.3.1), Mood (v0.1.0, Wave 1 staged).
Sync engine : sync.js v0.8.2 (per-slice baselines + divergence
              guard; v0.8.2 = cleanup wave dead-code removal).
Skins       : 16 · Wallpapers: 15 (sand default).
Shell uses  : useoros.online only (no alt domains).
Version surf: Info modal (Ctrl+Alt+Shift+I) + update toast. The
              taskbar version badge was REMOVED in v0.18.1
              (index.html span + applyLang line; dead CSS rule
              removed in v0.18.2).

WAVE 3 (v0.18.0) FEATURE SET — all six shipped:
  1. Global shortcuts, Contract Β (shell-owned handler +
     per-app forwarding) — see GLOBAL SHORTCUTS for the v0.18.1
     modifier rewrite.
  2. Weather widget (Open-Meteo, taskbar chip, offline-aware).
  3. Taskbar sync dot (single OS-wide sync indicator, chromatic
     states) — per-app indicators removed (Notes save-indicator
     was the only one).
  4. Backup-folder Stop/Reconnect button styling fix.
  5. Version toast: single line, tighter gap, mobile compact.
  6. Info modal (Ctrl+Alt+Shift+I + menu row) — about + auto-
     generated shortcuts table.

v0.18.1 POST-SHIP WAVE (all fixes user-tested on desktop):
  a. Shortcut modifier swap — see R12. Dispatcher matches e.code,
     not e.key. Applied to: shell dispatcher (§9c), shell-level
     listener (§12), Info modal prefix (⌃⌥⇧ / Ctrl+Alt+Shift+),
     app forwarding listeners (ALL apps now use the canonical
     capture template — notes migrated in v0.18.2).
  b. Toast subsystem (scToast, §9): setSyncMsg/setSyncMsgRaw now
     ALSO fire a taskbar toast (single-slot, new replaces old;
     err holds 4.5s, others 2.6s; palette-var inline styles —
     follows skins, zero CSS). Side effect (intended): auto-backup
     snapshots and auto-sync errors are now VISIBLE outside the
     menu.
  c. Sync dot CLICK = trigger full sync (syncNowFromDot): pull,
     then push if dirty, one/then-two toasts, green flash. Not
     connected → red error toast. Locked → opens menu (the
     passphrase UI lives only there). The dot never opens the
     menu otherwise — menu access: menu button / weather chip.
  d. Taskbar version badge removed (2 patches: index.html
     element + applyLang write). Version = Info modal + toast.
  e. Info modal: capabilities line key sc.info.cap (was wrongly
     menu.empty.hint — "Apps will appear here…", user caught it);
     credits "Designed by Christos Koulaxizis" now LINKS to
     https://koulaxizis.gr (target _blank, rel noopener).
  f. RESOLVED in v0.21.2 (user-approved): combined dot-push toast
     omits the pull part when nothing came down; all four pull
     entry points centralize in reportPullResult().

NOTES APP FEATURE SET (v0.17.0, cumulative — app untouched in
0.18.x except save-indicator removal + forwarding migration):
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
                        (inline: skipWaiting + controllerchange
                        reload). #btn-menu-version removed 0.18.1.
  shell.js              shell logic, menus, skins, wallpapers,
                        auto-backup, shell slice registration,
                        shortcuts (§9c), weather (§9d), taskbar
                        sync dot (§9b), scToast (§9)
  style.css             shell stylesheet (skin palettes = the
                        canonical palette vocabulary source)
  sync.js               orOS sync engine v0.8.2
  translations.js      EN/EL shell strings (window.t)
  apps.json             app registry (name, url, icon, category)
  sw.js                 service worker (cache-first with
                        ignoreSearch:true on cache-first branch;
                        only CACHE_VERSION bump busts it;
                        PRECACHE_URLS must cover apps — G2 enforces)
  manifest.webmanifest  PWA (start_url "/?source=pwa",
                        theme_color #1b1a18, background #131820,
                        display standalone, maskable icons;
                        audited clean in v0.18.2)
  fonts/                vendored Nunito woff2 (5 weights)
  todo/  kanban/  notes/  weather/  mood/  app folders
                        (index.html + css + js)
  .github/workflows/bump-version.yml   release pipeline (v3)
  CHANGELOG.md          THIS FILE

LOCALSTORAGE / STORAGE KEYS
  oros-lang / oros-theme / oros-skin / oros-wallpaper   prefs
  oros-last-version          last SEEN version (update toast)
  oros-slices                 registered slice metadata (sync)
  oros-sync-baselines         per-slice pushed hashes (djb2)
  oros-sync-dirty             unpushed-changes flag
  oros-remote-carry           parked remote payloads (divergence)
  oros-sync-interval          user autosync interval (minutes)
  oros-db-account             Dropbox account cache
  oros-vault-data             encrypted device vault (passphrase-
                              sealed sync secrets, IndexedDB key
                              fetched from store "keys")
  oros-db-access / oros-db-refresh / oros-db-expiry
                              Dropbox token triplet (access /
                              refresh token + expiry epoch)
  oros-pkce-verifier          PKCE verifier — SESSION-ONLY
                              (sessionStorage, dies with the tab)
  IndexedDB "oros-vault"      store "keys" → vault decryption key
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
  oros-weatherapp-data        Weather app slice storage (cities +
                              units; todo-contract merge, v0.19.0)
  oros-weatherapp-cache       Weather app device-local forecast
                              map (cityId → payload, MAX 6 —
                              NEVER synced, v0.19.0)
  oros-weather                weather settings {on, auto, lat,
                              lon, label} — TRAVELS IN SHELL SLICE
  oros-wx-cache               last successful weather read {at,
                              temp, code} — DEVICE-LOCAL, never
                              synced (an offline device must not
                              inherit another device's stale temp)
  oros-wx-last                epoch ms of last fetch attempt
                              (device-local throttle)
  oros-mood-data              Mood slice storage (syncs; todo-
                              contract merge, v0.22.0)
  oros-mood-seen              Mood device-local privacy-notice
                              flag (one-time dialog per device,
                              NOT synced by decision, v0.22.0)
  IndexedDB "oros-vault"      store "keys" → vault decryption key

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
  (v0.18.2: the pre-0.14 "notes.*" i18n duplicate block was
  audited — dead keys removed, LIVE keys documented. See WAVE 4.)

SYNC ENGINE v0.8.2 (sync.js)
  api.registerSlice(name, get, set, storageKey?, mergeFn?)
    — 5th arg enables merge; mergeFn throw → degrade to LWW.
  Baselines (djb2) per slice; divergence guard for mergeless
    slices: unpushed = dirty OR missing baseline OR mismatch ⇒
    remote parks in oros-remote-carry, local becomes new truth.
  reconcile(reason) triggers: boot / interval / visible / online /
    register / debounce (DEBOUNCE_MS = 5000).
  ACCEPTED LIMIT: two devices offline with the app closed
    converge only via a live open (merge needs app code present).
  v0.8.2 cleanup: dead `changed` var + dead vaultReady removed;
    DEAD-AND-DANGEROUS sliceIsClean() DELETED (re-encoded wrong
    v0.8 "missing baseline = clean" semantics — would resurrect
    the divergence bug if reused); parkRemote comment/code
    mismatch fixed; shell applyPayload branch simplified
    (verified equivalent).

SHELL SLICE (synced): { lang, theme, skin, wallpaper,
  syncInterval, autoexport, weather } — getter reads live state;
  setter applies pulled values and NEVER marks dirty (R6).
  weather is normalized on set (invalid lat/lon → null, label
  coerced to string) so a corrupt remote can never poison prefs.

GLOBAL SHORTCUTS SUBSYSTEM — shell.js §9c
  Architecture — CONTRACT Β (shell owns, apps forward):
    - ALL handlers live in the shell (section 9c).
    - window.orosShortcuts = { handle(e) } is the public contract.
    - Apps forward via ONE keydown listener; canonical capture-
      phase template (todo/kanban/writer AND notes — v0.18.2):
        document.addEventListener("keydown", function (e) {
          if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
          var p = window.parent;
          if (!(p && p.orosShortcuts &&
                typeof p.orosShortcuts.handle === "function")) return;
          if (p.orosShortcuts.handle(e)) e.stopPropagation();
        }, true);
      (v0.18.2: notes.js migrated OFF its inline wireUI() bubble
      forwarding — the R11 exception is CLOSED, all apps share
      the same block. Historical note: v0.18.1 shipped notes with
      inline forwarding because the capture template was assumed,
      not verified — that is what made R11.)
  MODIFIERS: Ctrl+Alt+Shift (macOS: ⌃⌥⇧, metaKey accepted).
  KEY MATCHING: e.code ("KeyP") — PHYSICAL key, immune to the
    Greek layout (e.key returns "π"). Letters only (code must
    start with "Key"). Ctrl+K in notes matches e.code too.
  Bindings:
    P  force push        O  force pull
    S  snapshot now       X  export DB
    I  info modal         U  check updates (SW update() ping)
    L  toggle language   R  reconnect (Dropbox connect OR
                           backup-folder permission re-grant —
                           both need user activation, satisfied)
  SC_DEFS array = single source of truth: the dispatch handler
    AND the Info modal table both derive from it. Adding a
    shortcut = one SC_DEFS entry + one i18n key. Nothing else.
  Shell-level listener (§12): passes every Ctrl+Alt+Shift combo
    to orosShortcuts.handle; unmatched combos fall through.

TOAST SUBSYSTEM (v0.18.1) — shell.js §9 scToast()
  scToast(kind, text): taskbar toast, top:44px, z-index 1400
  (above Info modal 1300, version toast 1200). Single-slot (a new
  toast replaces the old), inline palette-var styles (follows
  every skin, zero CSS rules), err border #e06c75 / ok var(--accent)
  / dim var(--border). Wired INTO setSyncMsg + setSyncMsgRaw —
  every sync/shortcut/weather/menu message is now visible
  ANYWHERE in the OS, not just inside the open menu. Menu keeps
  rendering state.syncMsg as persistent history. Consequence
  (intended): auto-backup snapshot confirmations and auto-sync
  errors now surface unprompted.

TASKBAR SYNC DOT (v0.18.0/v0.18.1) — shell.js §9b + §12
  #sync-dot inside .bar-right (button #sync-dot-btn, injected at
  runtime, before #btn-lang).
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
  ARIA (v0.18.2): dot aria-label localized via key sync.dot.aria
    (EN+EL), refreshed on every state write + language toggle.
  CLICK (v0.18.1) = syncNowFromDot(): if not connected → red
    error toast; if locked → open menu (passphrase lives there);
    else pull then push-if-dirty, syncing→synced transients,
    toasts for each leg. The dot NO LONGER opens the menu.
    Menu access points left: menu button, weather chip.

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

INFO MODAL (v0.18.0/v0.18.1) — shell.js §9c showInfoModal
  Trigger: Ctrl+Alt+Shift+I or the menu Info row (renders last,
    AFTER the sync section). Content: orOS + version pill (the
    version surface since the badge removal), tagline "A static
    operating system in your browser.", capabilities line
    (sc.info.cap), the FULL shortcuts table (generated from
    SC_DEFS, ⌃⌥⇧ prefix auto-detected on Apple platforms),
    repo link github.com/koulaxizis/oros, credits line with
    "Designed by Christos Koulaxizis" LINKED to
    https://koulaxizis.gr (v0.18.1).
  Overlay: backdrop click or Escape closes. z-index 1300.

MERGE CONTRACTS PER APP
  To-Do (v0.4): per-entity mtime + om/pos ordering, root scalars
    LWW, tombstones 30d, structural merge, Undo = stampAll().
  Kanban (v0.5, DATA_VER 4): root om = column order, column om =
    card order, card mtime INCLUDES placement, cascade tombs,
    deleteLabel touches every card wearing it, subtasks/info =
    whole-card LWW (backlog). v0.18.2 ordering hardening:
    quickAdd stamps col.om (top-insert = ordering decision);
    duplicateCard uses the ONE full stampColOrder() (a hoisted
    one-liner duplicate was silently shadowing it — removed).
  Notes: see NOTES DATA MODEL above.
  Weather app (v0.19.0+, DATA_VER 1): compact todo-contract.
    Cities union by id + content LWW by mtime; tombstones union
    max-ts (an edit newer than its tombstone resurrects — the
    undo-delete toast relies on it); ordering = the om-larger
    side donates positions; scalars (active, units, shellWx)
    ride the sm-winning side (losing them on merge once wiped
    the units toggle — fixed in Wave 2). Cache NEVER travels.
  Mood (v0.22.0, DATA_VER 1): see MOOD DATA MODEL in the
    SESSION HANDOFF at the end of this file.

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
  KEPT-BY-DECISION (v0.18.2): --bg-desktop/--accent-hover travel
  in PAL_VARS although some apps consume only 9 — shell pass-
  through symmetry, intentional.

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
  itself stores nothing, only paints. v0.22.0 extension: Mood's
  time-of-day, day keys, thread dots and smart preselection are
  all render-time derivations of entry timestamps.

SEARCH + TAG PANEL (Notes, v0.16.0)
  openSearch(): Ctrl+K or 🔍. Titles + content, lowercase
  contains, title hits first then mtime desc, 50-result cap,
  snippet ±30 chars, Enter = first result, Esc/backdrop closes.
  Tag panel: 🏷 → labels with counts → click → its pages.

AUTO-BACKUP (v0.12.0+)
  Mode off/daily/weekly/monthly in shell slice; checks at boot +
  tab-visible only; on-change-only compare; rolling 5 snapshots
  in oros-auto-snapshots (FIFO); restore via orosSync.importData.
  FS-folder mirror (Chromium desktop): IndexedDB-held handle,
  permission check per write, ⚠ + Reconnect UI on revoke.
  v0.18.0 style fix: the Stop/Reconnect/Choose button inside
    .sync-interval rows was unstyled — compact bordered style
    added; the label ellipsizes (flex:1 + min-width:0).

VERSION TOAST (v0.8.0 style, tightened v0.18.0)
  Sole update confirmation after auto-update reload. Single
  line, gap 5px, nowrap, max-width 100vw-32px; mobile ≤480px
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
       LIMITATION (recorded v0.18.2): G2 checks the app FOLDER
       name appears in PRECACHE_URLS, not every FILE of it —
       a new app asset missing from precache passes G2 silently.
     – G3 palette guard: app JS must contain inheritPalette AND
       watchPalette, else FAIL (v0.14.2 lesson).
  5. Commit via `git add -u`.
Self-trigger note: the bot's own commit re-runs the workflow
once; stamps are then already current → no diff → no commit →
terminates. Safe.
  COVERED BY ACTION: CACHE_VERSION, manifest version, ALL ?v=.
  MANUAL BY DESIGN: banner comments + per-app APP_VERSION
  (regex over comments = R1-class risk; banned).

────────────────────────────────────────────────────────────────
FILE UPDATE CHECKLISTS (standing rules)
────────────────────────────────────────────────────────────
A. VERSION BUMP (every release) — ONE manual step
   1. shell.js: APP_VERSION (+ banner; style.css/translations.js/
      sync.js/sw.js banners updated manually same commit).
   2. Push to main. The Action stamps everything else.
   3. Verify on BOTH devices: Info modal (Ctrl+Alt+Shift+I)
      shows the new version BEFORE interpreting behavior as
      broken code (R3/R13).

B. NEW APP ADDED (<app>/ folder)
   1. apps.json — entry (name, url, icon, category).
   2. sw.js — add the app's files to PRECACHE_URLS (G2 fails
      the push otherwise; see G2 folder-level limitation).
   3. shell.js — icon SVG in the ICONS map.
   4. Translations — category label + shell-facing strings.
   5. Register a sync slice (R8; merge contracts). Pull-fed
      setters never markDirty (R6); setter compares JSON and
      suppresses echoes.
   6. Palette inheritance: inheritPalette + watchPalette (G3
      enforces; reference todo.js §12).
   7. Shortcut forwarding listener (canonical Contract Β
      capture template) — REQUIRED. Must match the CURRENT
      modifier contract (Ctrl+Alt+Shift, R12).
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
      version matches Info modal.
   - Shortcuts smoke test in EACH app: Ctrl+Alt+Shift+P while an
     app is focused proves the forwarding listener is live.
   - Deploy + version check on BOTH devices before feature
     testing (Lesson 4).

F. RELEASE SHIP STATUS (v0.18.2 era — superseded; kept for
   history). The CURRENT outstanding items live in the SESSION
   HANDOFF block at the end of this file.

──────────────────────────────────────────────────────────────
WAVE 2 (Notes) — CLOSED ✓
──────────────────────────────────────────────────────────────
  v0.14.1  Page labels: registry + attach/detach + tomb merge +
           tree dots, editor chips, stylized picker.
  v0.14.2/3  Palette fix + data-theme mirror.
  v0.15.0  Exports: page .txt + notebook ZIP. Import DEFERRED.
  v0.16.0  Search (Ctrl+K) + Tags aggregation panel.
  v0.17.0  Wiki-links [[Title]] + backlinks strip.

WAVE 3 (Shell) — CLOSED ✓ (v0.18.0 + v0.18.1 fixes)
──────────────────────────────────────────────────────────────
  #4 Folder Stop-button styling fix (.sync-interval label
     ellipsis + compact bordered menu-item).
  #5 Version toast single-line + tighter gap + mobile compact.
  #3 Taskbar sync dot (7 chromatic states, clock-tick
     derivation, transient holds) — menu dot copy REMOVED,
     Notes save-indicator REMOVED (only per-app dot in the
     suite). One indicator OS-wide.
  #1 Global shortcuts Contract Β: SC_DEFS dispatch + shell
     listener + app forwarding. R12 born (three modifier
     strikes: E→X native conflict; Ctrl+Shift+* browser-stolen
     wholesale; Alt+Shift killed by Windows layout toggle +
     Greek-layout e.key lying → final: Ctrl+Alt+Shift matched
     via e.code).
  #6 Info modal (menu row + shortcut trigger), shortcuts table
     auto-generated from SC_DEFS, tagline "A static operating
     system in your browser.", repo + credits. v0.18.1 fixes:
     capabilities key sc.info.cap (was menu.empty.hint —
     "Apps will appear here…"); credits linked to koulaxizis.gr.
  #2 Weather widget: Open-Meteo, taskbar chip, GPS/manual city,
     offline slashed-cloud contract (never a fake temperature),
     settings in the shell slice, cache device-local, 30-min
     throttle, fetches on gesture/online/visible only.

v0.18.1 POST-SHIP FIXES (full detail under CURRENT STATE):
  shortcut modifier rewrite · scToast subsystem · sync-dot click
  = full sync · version badge removal · sc.info.cap fix ·
  credits link. All user-tested and working.

WAVE 4 (CLEANUP/AUDIT) — CLOSED ✓ (v0.18.2)
──────────────────────────────────────────────────────────────
  Process: cold audit per file (numbered findings; EN/EL key
  parity; HTML ids vs getElementById; CSS selectors vs JS-
  generated DOM; storage registry vs reality; stale comments vs
  code) → per-file user approval ("Πάμε όλα") → collective
  surgical patches. 81 numbered findings → 70 patches. Zero
  wholesale regenerations (R1 held).

  CORE
  - notes/: dead i18n keys removed (notes.app, tree.title,
    tree.empty.hint, page.placeholder, page.count, labels.empty.new
    — page.new kept LIVE); "Ένο_static" corrupted EL tagline →
    "Ένα στατικό λειτουργικό στον browser σου."; notes.js
    APP_VERSION → 0.17.0; Ctrl+K matched via e.code (R12);
    inline wireUI() forwarding → canonical capture template
    (backlog item closed, R11 exception retired); corrupted
    comments cleaned.
  - style.css: dead #btn-menu-version rules removed; header
    refreshed.
  - sync.js: dead `changed` var + dead vaultReady removed;
    DEAD-AND-DANGEROUS sliceIsClean() DELETED (re-encoded the
    WRONG v0.8 "missing baseline = clean" semantics — would have
    resurrected the divergence bug if reused); shell branch of
    applyPayload simplified (review-verified equivalent);
    parkRemote comment/code mismatch fixed.
  - translations.js: EL syncdot.dirty phrasing fixed; dead
    sc.info.about removed; sync.dot.aria ADDED (EN+EL); dupes
    removed (syncdot.err dup, tab in sync.snapshots.info).
  - shell.js/index.html: sync-dot aria localization;
    LANGUAGE TOGGLE NOW RELOADS THE OPEN APP (refreshRunningApp —
    iframes read oros-lang at boot only; data lives in storage/
    slices, zero loss); stale comments (Ctrl+Shift+I, Contract
    Β wording) fixed; cache-busters aligned to 0.18.1 dev state.
  - sw.js: caches.match(request, {ignoreSearch:true}) on the
    cache-first branch ONLY (precache now serves ?v= requests —
    fewer cold round-trips); navigate branch deliberately
    untouched (network-first for navigations stays).
  - apps.json: normalized (todo/kanban/notes entries: id/
    category/icon/url/type consistent).

  APPS
  - todo/ (14 findings): #dlg-list commits on ANY close path
    (saveListDialog() — Esc was silently losing typed renames);
    third empty state (#filtered) explains hidden-by-filter
    tasks; tab-drag post-click suppression (tabDragEndTs);
    compare-before-touch on dlg-item close (openSnapshot
    fingerprint — zero-edit close stamps nothing); defaultState
    stamps root om; new keys tab.add/add.task/interval.aria/
    filtered.title/filtered.hint; dead due.overdue removed;
    hardcoded aria → paintStaticAria().
  - kanban/ (15 findings): SAME-COLUMN CARD DRAG WAS BROKEN —
    ReferenceError (undefined `col` in moveCard's sameCol
    branch): mutation ran, save/render never did. FIXED
    (col → srcCol). Duplicate stampColOrder removed (hoisted
    one-liner silently shadowed the full version); dlg-col now
    commits on ANY close path; zero-edit card-dialog close no
    longer stamps mtime (cardFingerprint compare); quickAdd
    stamps col.om (merge-ordering); no-op drop no longer saves;
    dead col.add.title removed; corrupted multilingual comments
    cleaned (nicht/перемещ/ενoriaκα/κοίνια); KC banner v0.5.

  REGISTRY — 7 sync-engine storage keys documented (were in
  code since v0.8.x, never in this file). Zero new keys.
  DECISIONS LOGGED: PAL_VARS keeps --bg-desktop/--accent-hover
  (pass-through symmetry); hardcoded EN aria in shell index.html
  = intentional FOUC guards, overwritten by applyLang.

BACKLOG (recorded, not scheduled)
──────────────────────────────────────────────────────────────
  – Notes read-mode (rendered [[links]] clickable inside text).
  – Notes import (.txt → new page, ZIP → non-destructive
    restore) — deferred by user decision.
  – Fuzzy/case-insensitive backlink needle matching.
  – Kanban/To-Do per-field merges (subtasks/info).
  – Schema-aware generic union for mergeless closed-app proxies.
  – Snapshot compression.
  – Extend CI G3 if an app ever uses inline <script>; extend G2
    to per-file precache verification (folder-level today).
  – Action hardening: post-stamp verification step (see E.7).
  – Weather: per-hour graph view, radar (loose ideas).
  – Mood Wave 2/3/4 roadmap — see SESSION HANDOFF (below).
  – Idea (loose, never confirmed): Pad app, pagination app,
    Public Domain Calculator — separate orOS waves.

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
           mirror; orphan-brace SyntaxError + stale-?v= SW
           double strike (R2/R3 hardened, R11 born).
0.15.0     Notes exports: page .txt + notebook ZIP. Import
           deferred. CI action v3 (G2/G3 guards, git add -u).
0.16.0     Notes search (Ctrl+K) + tags aggregation panel.
0.17.0     Notes wiki-links + backlinks strip — Wave 2 COMPLETE.
           VIEW-DERIVATION PRINCIPLE formalized.
0.18.0     WAVE 3 (shell): global shortcuts Contract Β
           (SC_DEFS single-source, app forwarding, R12), taskbar
           sync dot (7 states), weather widget (Open-Meteo,
           offline slashed-cloud contract, slice-traveling
           settings), Info modal (auto-generated shortcuts
           table), version-toast one-line fix, folder-button
           styling fix, Notes save-indicator removal. First
           shell wave since 0.13 — all six items user-approved
           upfront, shipped as one bump.
0.18.1     Post-ship fixes: shortcut modifiers rewritten to
           Ctrl+Alt+Shift matched via e.code (browser-stolen
           Ctrl+Shift + Greek-layout e.key lying — R12 complete);
           scToast subsystem wired into setSyncMsg/setSyncMsgRaw
           (messages visible outside the menu); sync dot click =
           full sync trigger; taskbar version badge removed
           (version surface = Info modal + update toast); Info
           modal sc.info.cap fix; credits linked to koulaxizis.gr.
0.18.2     WAVE 4 — full-repo cleanup/audit: 81 findings → 70
           surgical patches. Notable: kanban same-column drag
           ReferenceError FIXED (undefined `col` in moveCard);
           dialog contracts unified across todo+kanban+notes
           (commit-on-any-close + zero-edit no-stamp); corrupted
           EL tagline fixed; language toggle reaches open apps;
           sync.dot.aria added; sw.js precache serves ?v=
           requests (ignoreSearch); notes.js migrated to the
           canonical capture forwarding (backlog closed); dead
           code swept (sliceIsClean — dead-and-dangerous,
           vaultReady, `changed`, dead keys/rules); storage
           registry completed; manifest audited clean. App
           version surface: 0.18.2.
0.19.0     NEW APP: Weather (v0.1.0) — current + 48h hourly +
           7-day, multi-city, device-local cache (never synced),
           offline badge contract, Open-Meteo, merge-lite sync
           slice oros-weatherapp-data.
0.19.x–0.20.0  Weather Wave 2 (app v0.2.0): °C⇄°F render-only
           toggle (traveling preference), UV + sunrise/sunset
           cells (same request), European AQI (separate optional
           endpoint), smart context hints, city pager (swipe +
           dots), interactive city-search autocomplete in app
           dialog AND shell menu (3rd char, tokened, keyboard
           navigable; shell native prompt() retired for a custom
           dialog).
0.21.0     Weather v0.3.0 audit fixes: timezone-correct "now"
           (utc_offset_seconds from the RESPONSE — device clock
           retired; payload.tz), undo-delete toast (native
           confirm() retired), NaN guards, pointercancel, UV/AQI
           band words + legend tooltips, no-data state.
0.21.1/2   Weather v0.3.1 hotfix (delivery-review bugs: badge
           hidden-flag inversion, toast word order, city-local
           night icons) + sync messaging honesty: reportPullResult()
           three-way pull outcomes ("Nothing in the cloud yet"
           retired → cloud-empty / nothing-new / pulled-N),
           applied to all four pull entry points.
0.22.0     NEW APP: Mood (v0.1.0, Wave 1) — 9-emotion grid with
           intensities, Location/Person columns (seeds + inline
           add + smart time-of-day preselection), water/food/meds
           toggles, reflection + trigger, 1h soft guard (custom
           panel, no native confirm), recent list with edit +
           undo-delete, 7-day thread (hollow = no entry — absence
           ≠ neutral mood), one-time privacy dialog (device-local),
           todo-contract merge slice oros-mood-data. SHIP
           PENDING — see SESSION HANDOFF.

## [0.19.0] — NEW APP: Weather

### Added
- **Weather app** (`weather/`): standalone orOS app (v0.1.0)
  - Current conditions + 48h hourly + 7-day daily forecast
  - Multi-city favorites with per-city device-local cache
    (`oros-weatherapp-cache`, NEVER synced — merge-safe by design)
  - Precipitation probability bars (hourly strip + daily rows)
  - Offline: renders last-known data + dim "offline" badge —
    never fake numbers, never blank screen
  - 30-min fetch throttle; fetch on open / tab-visible / manual
    refresh only (network-first logic, no background polling)
  - Open-Meteo provider (no key, no cookies), geocoding on add,
    timezone=auto
  - Sync slice `oros-weatherapp-data` (cities list travels via
    Dropbox; compact todo-contract merge: LWW + tombstones + om
    ordering; merge-engine-lite ~50 lines)
  - OS-pure theme (PAL_VARS palette inheritance from shell,
    same contract as todo/kanban/notes) — G3 enforced
  - Inline i18n EN/EL reading `oros-lang` at boot (same pattern)
  - Contract Β shortcut forwarding (capture-phase, canonical)
  - °C / km/h only (Europe-first; units toggle deferred to backlog)

### Changed
- Version bump: 0.18.2 → 0.19.0 (new app = minor bump)

### Wired files checklist (guide for future app additions)
When adding a new orOS app `foo/` (foo/index.html + foo.css + foo.js):
1. Create `foo/` folder with 3 files (follow todo/weather template)
2. `apps.json` — add entry (id, name, category, icon, url, type)
3. `shell.js` — ICONS: add `foo` icon SVG + APP_VERSION minor bump
4. `sw.js` — add 4 PRECACHE_URLS entries (`foo/` + 3 files) in SAME
   push (cache.addAll fails on 404 — never ship sw.js alone)
5. `translations.js` — new category key if new category introduced
6. CI (`bump-version.yml`) — verify weather/foo files auto-covered
   for `?v=` stamping; add explicit entries if the yml lists files
7. Push all in ONE commit; verify on BOTH devices (R3) via Info
   modal + open the new app offline to verify precache

## 0.20.0 / weather 0.2.0 — Weather Wave 2

### Added
- **Units toggle**: tap the big temperature → °C⇄°F + km/h⇄mph everywhere.
  Render-only conversion (cache/slice always stay metric = portable);
  preference syncs via the slice. Condition label moved to icon tooltip.
- **UV index** (current, from hourly at current hour — same request, no extra calls).
- **Sunrise/Sunset** cell (same request, `daily=sunrise,sunset`).
- **Air quality (European AQI)**: separate Open-Meteo endpoint, fetched
  serially AFTER the forecast (optional data, fire-and-forget). Failure →
  dim "—" cell; semantic coloring: ≤20 good (green), ≤40 fair (amber), above = red.
- **Smart hints**: the condition line under the temperature is now a
  context phrase (EN/EL, priority storm > fog > rain > UV > hot > cold > swing > mild).
- **City pager**: swipe left/right on the main area (excludes the hourly
  strip's own scroll) cycles saved cities; pager dots next to the city
  name jump directly; hidden with a single city.
- **Interactive city search**: autocomplete suggestions from the 3rd
  typed character (e.g. "Ath" → "Athens, Greece" / "Athens, Georgia")
  in BOTH the Weather app dialog and the shell menu city picker.
  Geocoding count=1→5, debounced 250ms, tokened stale-response guard,
  keyboard navigable (↑/↓/Enter/Esc), offline = no suggestions.
  Shell menu: native prompt() replaced by a custom dialog (prompts
  can't host suggestions).

### Fixed
- Greek hint string typo ("hint.hot").
- Horizontal scrollbar in My cities (wrap + min-width:0 + scrollbar-gutter,
  forensic-diagnosed on #city-add-row) — shipped early in 0.19.7.

### Notes
- AQI uses its own Open-Meteo endpoint (second request by design);
  weather truth/badge stays owned by the forecast fetch only.
- Boot marker discipline: `weather.js v0.2.0 boot` must match the served ?v=.

## v0.21.0 — Weather app v0.3.0 (audit fixes)

Weather app: weather.js v0.3.0, weather.css v0.1.2.

### Fixed
- **Timezone-correct "now"**: the hourly slice start, feels/hum/UV
  lookup, AQI hour index and the "Today" daily label are now derived
  from the forecast response's `utc_offset_seconds` (city-local
  wall clock) instead of the device clock. Distant cities (Tokyo vs
  Serres) previously mis-sliced the strip by hours. `payload.tz`
  stored in cache for render passes; legacy cache rows (no tz) fall
  back to the device offset.
- **Undo-delete toast**: native `confirm()` retired from city
  deletion. Immediate delete + 5s undo toast. Undo resurrects with
  the same id + fresh mtime (> tombstone — merge-safe resurrection).
- NaN guards in fmtTemp/fmtSpeed (null hourly slots showed "NaN°").
- pointercancel listener releases the swipe-tracking flag.

### Added
- UV cell shows WHO band word ("6.2 · High"); hover legend with the
  full WHO scale (EN/EL).
- AQI cell shows European AQI band word ("34 · Fair"); hover legend
  explains the 0–100+ zones (NOT a percentage). Extended data-level
  classes: good/fair/moderate/poor/vpoor/epoor (+ legacy "bad").
- "No saved data" state when a city exists but the device cache has
  no payload (first offline open).

### Known traps observed
- Multi-part delivery cut mid-function AGAIN (fmtSpeed). Searched
  and joined before shipping.

## v0.3.1 — Weather app hotfix (badge regression, toast order, night icons)

Weather app: weather.js v0.3.1. (Ships after v0.3.0 — patches the
three bugs found in the v0.3.0 delivery review, before push.)

### Fixed
- **Offline badge never showed** (regression from v0.3.0 delivery):
  `ob.hidden = obShow` had the boolean flipped — hidden=true when
  we WANTED to show it (offline/failed fetch), and a redundant
  `display:"none"` hid the healthy case too. Badge was invisible
  in ALL states. Now: `ob.hidden = !obShow`.
- **Undo toast word order**: text node was appended AFTER the
  action button → rendered as "[Undo] Deleted — Serres". Text now
  appends first.
- **Night icons used the DEVICE clock** (inconsistent with the
  v0.3.0 timezone fix): `wxNightNow()` consulted local hours, so
  Tokyo at 22:00 viewed from Greece showed a sun, and the whole
  daily list went nocturnal in the evening. `iconFor(code, hour)`
  now takes a city-local hour: current conditions via
  `cityHour(tz)` (new helper, sits next to cityTodayStr), hourly
  cells parse their own ISO time, daily rows pass 12 (day symbols
  by convention). Legacy callers without an hour fall back to the
  device clock. Side fix: the tz fallback expression was deduped
  into a single `tz` var reused by both todayStr and icon calls.

### Cleaned
- Dead code removed: aqiBand() (unused — renderAll builds the band
  inline), STALE_MS (never referenced), "city.add.tip" i18n key
  (no consumer), fmtSpeed indentation.

## v0.21.2 — Sync messaging: honest pull outcomes

### Fixed
- "Nothing in the cloud yet" retired — it sounded alarming
  ("did my data vanish?") and lied in two cases. Pull results now
  report three ways, centralized in reportPullResult(): empty cloud
  → "Cloud is empty — nothing to pull yet"; cloud identical to
  local (applied=0) → "Nothing new to sync" (was previously shown
  as a pull success or the scary empty message, depending on the
  entry point); real changes → the usual "pulled — N slices".
- Applied to all four pull entry points: unlock flow, menu pull
  button, Ctrl+Alt+Shift+O shortcut, taskbar sync-dot click.
- Combined dot-push toast omits the pull part when nothing came
  down (closes the old open decision from v0.18.1 f — the user
  approved the combined variant).
- Translations: sync.ok.empty removed; sync.ok.cloud.empty and
  sync.ok.none added (EN/EL).

## v0.22.0 — Mood app v0.1.0 (Wave 1)

New orOS application: Mood (mood tracker). Files: mood.html,
mood.js, mood.css. Design principle: capturing how you feel must
take seconds, not minutes.

### Wave 1 scope
- Entry flow: L1 emotion grid (9 fixed emotions, multi-select,
  per-emotion intensity 1–5, default 3) · L2 Location/Person
  columns (5 seed values each, editable/deletable, inline "+Add",
  smart time-of-day preselection by frequency) · L3 toggles
  (water/food/meds) · L4 free reflection + optional trigger.
  Time-of-day DERIVED from the entry timestamp (morning/
  afternoon/evening/night) — never asked.
- Soft guard: saving within 1h of the last entry asks
  "update or new" via inline panel (no native confirm).
- Recent list (30 newest): faces, context, note preview, edit +
  delete-with-undo (tombstone/resurrection merge-safe).
- 7-day thread: colored dots per day (highest-intensity emotion),
  hollow = no entry that day (absence ≠ neutral mood — enforced
  visually AND statistically going forward).
- Privacy notice: one-time dialog on first open per device
  (device-local flag oros-mood-seen).
- Sync: oros-mood-data slice (todo-contract merge: entries LWW by
  mtime, tombstones, column values with om-based ordering).
  Included in manual export + snapshots via the standard engine.

### Mantra checkpoints
- Offline first ✓ (zero network beyond sync engine)
- Mobile first ✓ (thumb-zone sticky save, mobile-first CSS)
- No external dependencies ✓
- Full project manual export ✓ (engine)
- Full project snapshots ✓ (engine)
- Full project auto merge sync ✓ (engine)

### Under consideration (backlog)
- Wave 2: distributions, calendar dots view, streak indicator,
  medication adherence history.
- Wave 3: correlations, insights panel.
- Wave 4: gentle morning/evening reminders — when orOS is open
  (first-open-after-hour → toast, clickable → opens Mood; no
  background timers, no architecture change).

────────────────────────────────────────────────────────────────
SESSION HANDOFF — Mood Wave 1 (v0.22.0) — ship pending
────────────────────────────────────────────────────────────────

MOOD DATA MODEL (DATA_VER 1, mood.js v0.1.0)
  state = { ver, sm, om,
    entries: [{ id, ts, mtime,
                emotions: [{k, i}],      // k = fixed key, i = 1–5
                loc, person,             // column-value id | null
                water, food, meds,       // booleans
                note, trigger }],        // strings ("" = unset)
    cols: { loc:   [{id, label, mtime, pos}],
            person: [{id, label, mtime, pos}] },
    deleted: { <entryId|colValId>: <tombstone ts> } }
  EMOTIONS (FIXED 9 — statistics need a stable dictionary; custom
  emotion fields NEVER; freedom lives in note/trigger):
    happy #87cf3e · calm #51a2da · excited #8c5ec7 · sad #5277c3 ·
    angry #e06c75 · anxious #e0a44c · tired #9aa0ae ·
    stressed #ff7043 · numb #6d4aff — SYSTEM hues only, zero new
    palette members.
  Seeds (editable/deletable, live in state once seeded):
    loc: At home / At work / Outdoors / Commute / Café & bars
    person: Alone / Partner / Family / Friends / Colleagues
  DERIVED, never stored: time-of-day from ts (5–11 morning ·
  11–17 afternoon · 17–22 evening · else night) · day keys for
  the 7-day thread computed render-side on the LOCAL calendar
  (entries are epoch stamps — the weather wall-clock bug does
  NOT apply here; do not "fix" it into existence).
  Merge (todo-contract): entries + column values = union by id +
  LWW by mtime (tie → lexicographic JSON); tombs = union max-ts,
  an edit newer than its tombstone resurrects (undo-delete
  depends on it — e.mtime = Date.now() BEFORE push, always);
  entry order = DESC ts derived at sort time (NO stored pos);
  column order = the om-larger side donates positions.
  sliceSet: never marks dirty (R6) · re-sorts + re-positions ·
  resets a capture that was editing an entry another device
  deleted · light ack toast on merged pulls.

STORAGE KEYS (added this wave — registry):
  oros-mood-data     slice storage (syncs; todo-contract merge)
  oros-mood-seen     DEVICE-LOCAL privacy-notice flag — one-time
                     dialog per device, never re-shown; NOT
                     synced by decision (each device acknowledges
                     once). Flip to synced only if user asks.

SMART-PRESELECTION CONTRACT (L2 columns): suggestion = most-used
value within the CURRENT time-of-day bucket → fallback most
recent valid → fallback first seed (pos 0). Never blocks, never
persists a preference — pure render-time derivation.

SOFT GUARD (1h rule): saving <1h after the newest entry opens an
inline "update or new" panel (no native confirm anywhere in the
suite — retired in weather v0.3.0, never born here). The
"update" path loads the old entry into the capture THEN commits
the new emotions into it (edit-with-prefill, LWW-clean).

FILE TREE addition: mood/  (index.html + mood.css + mood.js)

CRITICAL — DELIVERY STATE OF THE WORKING COPY (R4/R11):
mood.js shipped in 5 parts + 3 in-thread fixes. Before push,
CONFIRM all applied (chained patch discipline):
  Fix 2a  mergeUnionList: tombstone-undefined semantics
          (seeds have mtime 0 — `ts = tomb ? tomb[id] : undefined`)
  Fix 2b  sortColVals call sites: .loc ref must be (a.cols).loc
          (a bad copy passed .person — silently reorders wrong)
  Fix P2  EL "privacy.title" → "Ιδιωτικό εκ σχεδίασης"
          (corrupted multibyte sequence in Part 2's paste)
Plus the standing traps: boot marker `mood.js v0.1.0 boot` ·
`registerSlice("mood", ...)` · zero `confirm(` · new-btn empty
in HTML, SVG injected by paintStaticAria (R9).

SHIP CHECKLIST (Mood v0.22.0 — DO THESE NEXT):
  1. translations.js — "category.lifestyle" EN/EL beside
     category.utilities (UNVERIFIED — file not supplied this
     chat; no-guessing rule held. If format differs, request it).
  2. sw.js — PRECACHE_URLS += mood/, mood/index.html,
     mood/mood.css, mood/mood.js — SAME push as the app files
     (cache.addAll 404s otherwise; G2 checks folder-level only —
     new-asset misses pass silently, G2 limitation stands).
  3. shell.js — ICONS.mood (smiley, shipped in this wave's
     Part 5) + APP_VERSION 0.21.2 → 0.22.0 (new app = minor bump).
  4. node --check mood.js · boot marker · smoke tests: menu card
     (Lifestyle/Τρόπος ζωής), privacy dialog once-only, full
     entry → Saved toast → dot in thread, second save <1h →
     soft guard, delete→undo→restored, cross-device pull.
  5. Verify the weather v0.3.0/0.3.1/0.21.2 patches are live on
     BOTH devices (R3/R13) if not already confirmed.

WAVE ROADMAP (user-approved trajectory):
  Wave 2 — distributions, calendar dots view, streak, med-
           adherence history (adherence wants an early start of
           collection — cheap since L3 toggles already log).
  Wave 3 — correlations + insights panel (needs ≥2–3 weeks of
           entries to mean anything; do not ship earlier).
  Wave 4 — reminders, orOS-open-only contract: first open after
           the "morning" threshold → toast, CLICKABLE → opens
           Mood (toast action patch in shell scToast — approved
           in design, small PALIO/NEO then). No background
           timers, no SW notifications, no architecture change.
  Statistical integrity rule (USER-DECREED, standing): absence of
  data ≠ neutral mood. Hollow dot = no entry; statistics and
  future correlations must never impute a neutral value for
  unlogged time.

NEXT-CHAT STARTER: user opens with Mood Wave 2 (stats) or a new
file dump for re-audit. Read: MOOD DATA MODEL + DELIVERY STATE
blocks above + R4/R11/R13 before touching anything.

## 0.24.0 — Mood Wave 3 + 3.5 (filters, trends, polish)

- FILTERS: loc/person/habit single-select groups in Insights ("field:side"
  encoding); view-state only (never persisted); "Showing X of Y" line;
  emotion distribution gains vs-overall +/-pt deltas (baseline passed only
  when a filter is active). Streak + calendar ignore filters; breakdowns,
  weekday and habits respect them.
- TRENDS (auto-observations): transparent stats, no magic. Per-context
  (location / person / habit yes-no) most over-represented emotion vs the
  range baseline. Guards: min 5 entries per condition, min 12pt delta,
  top 6 sentences, sorted by strength. Habit-forgetting tendency at >=35%
  of logged days.
- WEEKDAY PATTERNS: emotion most over-represented per day-of-week
  (min 3 samples, min 10pt). Filtered.
- WEEKLY MOMENTUM: positive share (happy/calm/excited) this week vs
  last week (min 3 entries each). Time-based, ignores filters.
- FIX: habits/breakdown bars had no background → invisible fills
  (.dist-fill now explicit var(--accent)).
- FIX: renderInsights early-return hid the factory reset link on empty
  state (appendResetLink helper, dedup of the bottom link too).
- FIX: sliceSet now re-renders Insights when open (live pull updates).
- FIX: corrupted line-1 header comment; boot marker v0.3.0;
  CSS header stamps.
- UI: calendar cells get bordered "boxes" (today = accent ring);
  The Basics habits = 3 full-width rows (yes/no side by side);
  new-btn from Insights returns to capture (clean form, scroll top);
  7-day thread gains weekday labels; .dist-val stacks delta below.
- CAPTURE: "Repeat last" ghost button (prefills form from latest entry).
- NOTES: buildCaptureKeepScroll present (past crash's root cause —
  partial assembly lost it mid-Wave-2). R14 standing rule added:
  node --check before every push.

KNOWN DEFERRED (backlog): co-occurrence pairs, weekly recap card,
Wave 4 reminders (orOS-open-only, clickable toast), ghost-label
Option B for deleted column values.

## 0.25.0 — Mood Wave 3.5 complete + tabs

- TABS: three-view topbar (Capture · Entries · Insights). Entries
  list moved out of the capture page. FIX: renderRecent forced
  sec.hidden=false regardless of active view — now defers to
  applyView.
- CO-OCCURRENCE: "when X, also Y" pairs into Patterns. Guards:
  ≥40% co-occurrence, ≥20pt above general prevalence, min counts.
- TRIGGER INTELLIGENCE: top-6 triggers become trend conditions
  ("when X triggers it…"); capture trigger field gains a datalist
  autocomplete from past values (free text stays, no model change).
- INTENSITY TREND: new section — avg intensity per emotion, recent
  half vs earlier half of the range (min 3/side, |Δ|≥0.4 noise floor).
- Full Wave 3.5 as previously shipped: filters, trends engine,
  weekday, momentum, reset-link fix, tabs.
KNOWN DEFERRED: reminders (Wave 4), weekly recap card, ghost-label
Option B, export.

## 0.25.0 — Mood project close
- Entries tab: search row (scans dates, feelings, contexts, habits, notes, triggers)
- Insights: weekly recap card (count / top feeling / positive share vs last week)
- Export PDF: full analytical report (overview, patterns, distribution with shares+avg,
  habits %, momentum, weekday, locations/people) — vendored jsPDF, no CDN
- 9-triad habit fields fully plumbed (move/som/caf/alc/scr i18n)
- Manage… affordance: rename/delete column values without hidden gestures
- Delayed reminder (3.5s, first-entry users, today-empty, app-open only)
- Dead i18n keys removed; boot marker v0.25.0

## 0.26.0 — Mood Wave 5: trigger presets · habits/rituals split · versioning overhaul

Feature wave + full audit closure. Supersedes the old bump-writing pipeline.

### Added
- **Trigger presets (Option A takeover)**: "What triggered this?" is a
  closed chip list (like Location/Person) + inline Add… + Manage
  rename/delete. DATA_VER 2 → 3: per-entry `trig` id, labels live in
  cols.trig {id,label,mtime,pos}; legacy free-text strings migrate
  deterministically (find-or-create, case-insensitive trim, stored entry
  order — both devices converge identically). Labels resolve at RENDER
  time everywhere (Entries preview, search haystack, Trends top-6) —
  zero denormalized strings, renames propagate instantly, trends are
  rename-proof. Merge plumbing: cols.trig in mergeCols / sortColVals /
  factoryReset / sliceSet pos-guard.
- **Factory trigger seeds** (TRIG_SEED EN/EL): Work deadline, Argument,
  Good news, Exercise, Sick day, Late screens — seeded ONCE on an empty
  cols.trig (covers existing installs: a new column never had a birth
  moment — old seed rule left it empty forever). Fully user-manageable.
- **Smart preselection ACTIVATED** (defined but never called since Wave 1
  — dead contract revived): new-entry mode preselects the most-used
  Location/Person for the current time-of-day bucket. FACTS-ONLY RULE
  (standing): loc/person may preselect; feelings, triggers and habits
  NEVER — default effect would pollute statistics.
- **Habits/Rituals visual split**: two titled sections in Capture
  (mkHabBlock → #habits / #rituals, CSS class .habpanel — was id-only
  #habits) and two full sections in Insights; filter panel splits into
  Basics + Rituals groups. ONE HABITS array (21 fields, grp hab/rit) —
  zero data-model change. PDF export already split — untouched.

### Fixed
- Chip context menu (Manage → rename/delete) was INVISIBLE: built and
  positioned but opacity never set from 0 (transition start state) —
  blocked clicks invisibly. Fix: m.style.opacity = "1" in openChipMenu.
- hab (triadic picks) leaked from entry to entry — resetCapture now
  clears all 21 fields + the managing flag (conscious-picks-only rule).
- askRecentGuard "Edit" discarded the fresh loc/person/habits picks
  (loadEntryIntoCapture overwrote them) — edit path now folds fresh
  picks INTO the recent entry; notes merge unchanged.
- Trigger-only entries showed no preview line in Entries (retired
  e.trigger string check → e.trig + render-time label).
- Scroll jumped to top on every chip tap — scroll preservation moved
  INSIDE buildCapture (read #moodmain.scrollTop before clear, restore
  after paint); buildCaptureKeepScroll deleted (dead); resetCapture
  scrolls to top explicitly for fresh entries.
- Topbar tab buttons had no hover/active state (dead #new-btn CSS
  selectors) → #cap-btn/#ent-btn/#ins-btn covered.
- .addrow inputs hijacked by the generic #capture input CSS (Add button
  wrapped onto its own line) → specific override added.
- applyView wrote a wrong title attribute on tab change; rename popup
  save button read "Save entry" → new key col.menu.save (EN/EL).

### Changed — VERSIONING OVERHAUL (CI semantics change)
- shell.js APP_VERSION is the SINGLE SOURCE OF TRUTH and is NEVER
  written by CI. Manual bump only (dev commit). The Action READS it and
  stamps sw.js CACHE_VERSION, manifest version and all ?v= — nothing
  else. The old bump-computing + shell-writing steps are gone.
- workflow_dispatch bump-type input removed — patch/minor/major is
  decided by hand-editing shell.js per the versioning policy:
    bugfix → patch · completed feature wave → minor ·
    1.0.0 = "public-ready" declaration, never routine.
- Bot commit message: "chore: sync orOS assets to vX (auto) [skip ci]".
- Action hardening: post-stamp verification on sw.js + manifest (fail
  LOUD on a silent sed no-op); node step refuses to run when 0 app
  folders are found (was a silent near-noop).
- Checklist A simplifies to: edit shell.js APP_VERSION → push → verify
  on both devices (Info modal).

### Fixed — offline / PWA
- sw.js PRECACHE_URLS += vendor/jspdf.umd.min.js — PDF export was
  BROKEN OFFLINE (lazy fetch 404s; online worked, hence unnoticed).
- loadPdfLib dead candidate removed (mood/vendor/… never existed —
  every first export fired a spurious 404); jspdf lazy-load now carries
  the app's own ?v= (boot-marker trick) as cache-buster.
- manifest.webmanifest: "id": "/" added (PWA identity stability).
- sw.js header banner refreshed (was "orOS Core v0.18.1").

### Cleanup
- Dead i18n keys removed: l4.trigger, tod.morning/afternoon/evening/
  night (both languages). col.menu.save added.
- Triple .dist-val CSS (Wave 3.5 + stray nowrap override) consolidated
  into one block.
- DATA_VER bookkeeping corrected (comment said 3, value said 2).
- buildTrends trigger counting migrated to cols.trig labels.

### Temporarily disabled (standing TEMP markers — do NOT delete)
- Daily reminder toast (delayed, today-empty check) — commented out at
  the boot call site; revisit in Wave 4.
- First-open privacy dialog (oros-mood-seen, device-local flag) —
  commented out at the boot call site; flag semantics stay honored for
  devices that already acknowledged.

### 0.25.1–0.25.10 (interim, retroactive note)
Auto patch bumps through the OLD bump-writing pipeline while this wave
was in flight. The consolidated record of what shipped in that window
is the audit lists above; no per-patch entries were kept.

### Ship ritual for this release (supersedes previous checklists)
1. git pull --ff-only FIRST (R13: local ?v= stamps lag behind the
   bot-committed remote).
2. Apply the two TEMP-disable patches; node --check mood.js.
3. shell.js: APP_VERSION → "0.26.0" (MANUAL — the only version edit).
4. Append this changelog section; single commit; push.
5. Action expectations: "Using APP_VERSION from shell.js: 0.26.0";
   sw.js + manifest + every index.html stamped; bot commit [skip ci];
   a no-diff rerun terminates cleanly.
6. Both devices: Info modal shows 0.26.0; mood boot marker derives
   from ?v= automatically. Smoke: no reminder toast, no privacy dialog,
   trigger chips + legacy-string migration (edit an old entry → preset
   lit), Manage popup visible, two Habits/Rituals sections, no scroll
   jump on chip taps, OFFLINE PDF export works.
   
   ### Temporarily disabled (standing TEMP markers — do NOT delete)
- Daily reminder toast (delayed 6s, today-empty check, OS-level) —
  lives in SHELL.JS boot section (reads oros-mood-data directly,
  fires via scToast). Commented out at the boot call site with a
  line-by-line // prefix (block contains a nested /* */ comment —
  block comments impossible). Revive: strip the leading "// ".
- First-open privacy dialog — lives in MOOD.JS boot tail
  (maybePrivacyNotice() call commented; function definition kept
  intact). SEEN_KEY ("oros-mood-seen") stays honored: devices that
  already acknowledged never see it again.
  
  - DATA_VER finally set to 3 (code was shipping the trig migration
  with the constant still at 2 — harmless, migrate() runs
  unconditionally, but the ledger lied).
- Zero-loss test script: fixed an undefined-variable crash in the
  summary line (FAIL → BAD constant).
- askRecentGuard ("Logged Xm ago — update it?") moved from the top
  of the Capture view to just above the Save Entry button —
  visible without scrolling up; scrollIntoView(nearest) on show.
- .dist-val max-width (110px desktop / 88px mobile) removed: long
  Greek values ("x από x ημέρες με καταγραφή") overflowed LEFT
  over the bar (right-aligned nowrap text in a capped box). Box
  now sizes to content; the bar (min-width: 0) yields space
  instead — "value never wraps" rule preserved. dist-row gap
  10→12px.
  
  - el: ins.hab.days "ημέρες με καταγραφή" → "ημέρες καταγραφής"
  (shorter — pairs with the .dist-val fix; also grammatical tidy).
- Integration test script v2: snapshot-vs-state comparison now
  honors snapshot freshness (SKIP when snapshot predates state.sm
  — stale ≠ loss); older snapshots pre-dating the Mood app no
  longer FAIL the coverage check; last-run ReferenceError fixed.
  
  - Zero-loss verification PASSED end-to-end (integration test v2):
  structure, DATA_VER, triadic fields, sync payload bit-exact,
  baselines, roundtrip import zero-loss. Remaining FAIL was the
  test correctly flagging demo data still installed locally.
- Demo purge procedure: tombstone-based (demo- prefixed entry ids
  + fixed demo column-value ids) — merge-proof by construction,
  survives any pull/push cycle. NEVER wipe demo state with
  removeItem alone (merge union would resurrect it).
- Integration test v2.1: snapshot timestamp field detection
  widened (at | ts | t | time | created) — SKIP logic no longer
  bypassed by a differently-named schema field.
  
  - INCIDENT (resolved via snapshot restore): demo dataset injected on
  a SYNC-CONNECTED device overwrote real local state, and subsequent
  roundtrip/save marked the slice dirty → mixture pushed to cloud.
  Real data recovered from auto-snapshot (zero-loss restore path
  verified under fire). LESSONS: (1) demo datasets on sync-connected
  devices must be tombstone-purged BEFORE any push; (2) consider a
  demo-mode flag that suppresses __orosSyncApi.dirty() entirely —
  candidate for Wave 6; (3) take a manual snapshot BEFORE injecting
  test data.
  
  - Zero-loss certification achieved (v0.26.0): Full coverage matrix
  verified across Sync (Dropbox), Auto-Snapshots (local rolling),
  Manual Export (JSON download), and Folder Mirror (Chromium FS).
  Every localStorage key covered: shell slice (theme/lang/skin/wp)
  + app slices (todos, kanban, notes, mood, weather settings) +
  sync settings (interval, autoexport). Tombstones, custom columns,
  and triadic fields travel intact via the slice mechanism.

- Divergence Guard hardening (sync.js v0.8.1): Missing baseline
  treated as DIVERGED for mergeless slices — fixes the rare case
  where an offline edit on a closed app post-upgrade would be
  wiped by a pull. Remote parked in carry mailbox; local marked
  dirty and pushed as truth.

- Merge convergence verified: Simultaneous edits from multiple
  devices converge deterministically via mergeFn; tie-breaks
  (mtime, lexicographic) ensure no ping-pong.

- Snapshot restore path validated: Uses identical guarded/merge
  apply logic as cloud pull — stale rescue files cannot clobber
  newer local work.

- File System Access mirror (v0.12.2): Each auto-snapshot on
  Chromium desktop also writes a real JSON file in user-chosen
  folder; permission revocation detected and flagged (⚠) without
  breaking the localStorage net.

- Demo purge procedure documented: tombstone-based removal of
  demo-* prefixed entries + fixed demo col ids — merge-proof
  cleanup that survives any pull/push cycle.
  
  ## [0.27.00] — Mood app deep-review cleanup release

Full functional audit of the Mood app (capture, entries, insights,
factory reset, sync slice, boot, PDF export) plus the surrounding
core files (shell.js, sw.js, bump-version.yml, mood.css).
All findings below were reviewed item-by-item and approved.

### Mood app — fixes (mood.js)

- EDIT FROM ENTRIES LIST: `editEntry()` now switches to the
  Capture tab (`showTab("capture")`) before rebuilding the form.
  Previously the edit button looked dead — the form populated
  but stayed hidden behind the view-mode gate.
- BROKEN SVG: repaired the malformed pencil-icon path in
  `paintStaticAria()` (invalid arc data "2.8.2 8" → "2.8 2.8").
  The Capture tab icon rendered broken.
- SYNC CONVERGENCE (HIGH): all `uid()` seeds replaced with
  DETERMINISTIC ids — `seed-loc-*`, `seed-per-*`, `seed-trig-*`
  (newState + seedTriggers) and `mig-trig-<normalized-label>`
  (legacy free-text trigger migration). Two fresh installs that
  sync now converge to one chip set instead of doubling every
  preset. Belt-and-suspenders: `dedupeCols()` (label-normalized,
  symmetric, mtime-winner) runs inside `mergeMoodStates()`
  before sorting; losers are remapped into entries so nothing
  orphans into "not logged". Covers pre-fix installs too.
- GREEK PDF EXPORT (HIGH): jsPDF's built-in fonts are
  WinAnsi-only. Added `vendor/NotoSans-Regular.ttf` (Apache/OFL,
  Latin+Greek+Cyrillic), lazy-loaded only when LANG=el via
  `loadPdfFont()` → `addFileToVFS`/`addFont` (registered as
  both "normal" and "bold"). Missing file = warning toast +
  Latin fallback, never a crash. File is PRECACHED (see sw.js).
- CACHE-BUST FIX: `SCRIPT_V` is now captured once at boot via
  the IIFE (where `document.currentScript` is still valid) and
  reused by `loadPdfLib()`/`loadPdfFont()`. The old trick read
  `document.currentScript` inside a click handler — always
  null, so `?v=` was never appended.
- ADD… DRAFT SURVIVAL: `buildCapture()` now preserves the three
  Add-row input values across rebuilds (same contract as the
  note field and scroll position). `commitColVal()` clears its
  input when a value is consumed so it can't resurrect.
- TOAST STACKING: `showToast()` wipes `textContent` before
  appending — rapid successive toasts no longer concatenate
  ("DeletedRenamed").
- TOAST POSITION: moved to TOP-RIGHT, below the app's own
  topbar (Linux convention, standing E3 decision). In-iframe
  position is intentional so the shell's taskbar toast (also
  top-right, screen level) never overlaps it.
- ENTRIES EMPTY STATE: blank panel replaced with a localized
  "No entries yet" message (`ent.empty`). Stale search box is
  removed when the list empties (factory reset, deletes).
- FACTORY RESET: also clears view state (insFilter,
  insFiltersOpen, searchQ, calMonth) — no ghost filters
  pointing at deleted values.
- BOOT: single-pass render (`renderThread()` + `renderRecent()`
  instead of full `renderAll()` — no more double capture rebuild).
  Also sets `document.documentElement.lang` from the locale.
- SYNC ACK: merged-pull toast now says "Updated from sync"
  (`sync.pull`) instead of the misleading "Saved".

### Decisions (review round)

- First-launch "Private by design" banner: REMOVED
  INTENTIONALLY (standing policy established, privacy is
  stated in app docs — no per-launch disclaimer).
- Demo data generator: console-testing tool only, not shipped.
- In-app toast position: TOP-RIGHT inside the app frame.

### Core — fixes (shell.js, sw.js, bump-version.yml, mood.css)

- shell.js — INFO MODAL LISTENER LEAK: single `close()` path
  (registered as module-level `scInfoClose`) now removes BOTH
  the overlay and its document-level Escape listener on every
  exit route (backdrop click, Escape, toggle re-open).
- shell.js — ESCAPE SCOPE: the global keydown handler bails out
  when the Info modal is open (`sc-info-overlay` check) —
  pressing Escape with the modal open no longer ALSO returns
  to desktop / closes the running app.
- shell.js — removed dead `wxsAcTimer` variable (never used;
  the city dialog debounces via `wxCTimer`).
- sw.js — `vendor/NotoSans-Regular.ttf` added to
  PRECACHE_URLS (offline Greek PDF export; see dependency note
  in commit 1). Header comment refreshed (stale "v0.18.1").
- bump-version.yml — header comment rewritten to match the
  ACTUAL behavior (reads APP_VERSION from shell.js, stamps
  sw.js/manifest/?v=; shell.js is never modified by the bot).
- mood.css — header/section numbering cleanup only.

### Under consideration (backlog)

- Unified shell-level toast API (`orosToast`): all apps route
  toasts through the shell so every notification renders in
  one screen-level spot. Deferred — cross-app architectural
  change, deserves its own wave.
- One-time legacy duplicate sweep: existing two-device installs
  that ALREADY doubled their presets (pre-deterministic-id)
  are converged by `dedupeCols()` at the next merge, but a
  manual Manage→delete may still be wanted for cosmetics.

### Verification checklist (run before pushing to stable)

  (a) Edit an entry from the Entries list → form visibly opens
      in the Capture tab, pre-filled.
  (b) Type text in any Add… field, tap a habit chip → typed text
      survives the rebuild.
  (c) Export PDF in Greek locale → Greek renders (verify the
      ttf is served; also test offline).
  (d) Fresh install on a second device, sync → single chip
      set, no duplicated presets; edit/rename propagates.

### Files changed

  mood/mood.js, mood/mood.css, shell.js, sw.js,
  .github/workflows/bump-version.yml, CHANGELOG.md
  NEW: vendor/NotoSans-Regular.ttf (~430 KB, vendored)
  
  # orOS 0.27.04 — Release Notes

## Fixes & Improvements

### Service Worker Cache Strategy (#A, #B)
- **Critical fix:** Removed `ignoreSearch: true` from the fetch handler's cache-first branch. Query-string cache-busting (`?v=`) now works correctly — a new release never resolves to an old cached file.
- **Root cause:** An offline-only `ignoreSearch` fallback now runs ONLY when the exact key misses AND the network fails. Online, every versioned asset is fetched via exact-match, guaranteeing the latest release is always served.
- **Effect:** Hard refresh no longer required. Each natural session load pulls the current shell, translations, and scripts.

### UI Enhancements (#1, #3, #5)
- **Info modal:** New "External services" section disclosing Weather data source (Open-Meteo) before Shortcuts.
- **Info modal alignment (mobile):** Shortcut rows stack vertically on ≤480px screens. Long Greek descriptions no longer misalign against the key chip.
- **Sync button text wrap:** Greek sync labels ("Αποστολή στο cloud", "Εισαγωγή δεδομένων") wrap instead of widening, eliminating horizontal scrollbar in the menu.
- **Boot splash screen:** Static HTML overlay shows before any JS parses. Displays "Welcome to orOS — checking for updates…" (EN/EL from localStorage). Fade-out at ~1s, fail-safe at 10s. Survives even if shell.js fails to load.

### Translation Fallback (#4)
- **App names:** Menu and browser tab title now use i18n keys (`app.todo`, `app.kanban`, etc.) with automatic fallback to the `apps.json` name. Enabling future translations without breaking existing deployments.

## Known Behavior
- Mobile splash appears after a brief delay on some devices (slower SW activation on iOS/Brave) — this is expected and does not affect functionality.

## Files Changed
- `sw.js` — cache strategy (fetch handler)
- `shell.js` — showInfoModal(), renderMenu(), openApp()
- `index.html` — boot splash div + inline script
- `style.css` — `.sc-row` mobile stacking, `.sync-actions .menu-item` text wrap, `#oro-splash`
- `translations.js` — new keys for external services, splash, and app names (EN/EL)