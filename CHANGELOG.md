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
R3  VERIFY THE RUNNING VERSION FIRST. Version surface (v0.30.03,
    pending push):
    Info modal (Ctrl+Alt+Shift+I) always shows v<APP_VERSION>;
    the version toast fires on change. Confirm on BOTH devices
    before interpreting symptoms as code bugs.
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
    intermediate states.
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
    SC_DEFS entry; validate against native combos BEFORE shipping.
R13 LOCAL VS DEPLOYED VERSION DESYNC (born in the cleanup wave):
    the local working copy can LAG behind the bot-committed
    remote (action stamps CACHE_VERSION/manifest/?v= and commits
    them; local files only diverge). Before diagnosing "version
    drift" as a code bug, run `git fetch && git log --oneline -5
    origin/main` and look for "chore: stamp version vX (auto)"
    commits; `git pull --ff-only` BEFORE applying version patches.

### Standing delivery rule
- Patch format scales with change size: SMALL changes ship as
  PALIO/NEO replacement blocks with exact anchors and precise
  placement instructions (before/after); LARGE changes (many
  edits across one file) ship as FULL corrected files.

────────────────────────────────────────────────────────────────
CURRENT STATE — v0.30.03
────────────────────────────────────────────────────────────────
Core shell  : APP_VERSION in shell.js (single source of truth).
              sw.js CACHE_VERSION, manifest version and ALL ?v=
              stamps are written AUTOMATICATICALLY by the CI
              action (see RELEASE PIPELINE).
Apps        : To-Do (merge v0.4, DATA_VER 3), Kanban (v0.6,
              DATA_VER 5, multi-board), Notes (v0.17.0, DATA_VER 2),
              Weather (app v0.3.1, DATA_VER 1), Mood (v0.25.0,
              DATA_VER 3, trigger presets + habits/rituals split).
Sync engine : sync.js v0.9.0 (Zero-Knowledge Sync v0.9 — Cloud Lock
              Hardening with changePassphrase, push guard, trust
              window, error mapping — see v0.30.03 release notes).
Skins       : 16 · Wallpapers: 15 (sand default).
Shell uses  : useoros.online only (no alt domains).
Version surf: Info modal (Ctrl+Alt+Shift+I) + update toast.

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
                        sync dot (§9b), scToast (§9), i18n,
                        changePassphrase integration (v0.30.03)
  style.css             shell stylesheet (skin palettes = the
                        canonical palette vocabulary source)
  sync.js               orOS sync engine v0.9.0 — Zero-Knowledge
                        Sync v0.9 (changePassphrase, push guard,
                        trust window, errorKey mapping)
  translations.js       EN/EL shell strings (window.t)
  apps.json             app registry (name, url, icon, category)
  sw.js                 service worker (precache-all + cache-first
                        with ignoreSearch:true only on network
                        failure; CACHE_VERSION bump busts it)
  manifest.webmanifest  PWA (start_url "/?source=pwa",
                        theme_color #1b1a18, background #131820,
                        display standalone, maskable icons)
  vendor/               NotoSans-Regular.ttf (Greek PDF export),
                        jspdf.umd.min.js (Mood PDF)
  fonts/                vendored Nunito woff2 (5 weights)
  todo/  kanban/  notes/  weather/  mood/  app folders
                        (index.html + css + js)
  .github/workflows/bump-version.yml   release pipeline (v3)
  CHANGELOG.md          THIS FILE
  vendor/               (jsPDF, NotoSans font for Greek PDF)

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
  oros-todo-data              To-Do slice storage (syncs; DATA_VER 3)
  oros-notes-data             Notes slice storage (syncs; DATA_VER 2)
  oros-notes-prefs            Notes device-local prefs {open,
                              current, width} — NOT synced
  oros-kanban-data            Kanban slice storage (syncs; DATA_VER 5
                              multi-board: boards[] array +
                              state.boardDeleted tombstones)
  oros-weatherapp-data        Weather app slice storage (cities +
                              units; merge-lite sync; DATA_VER 1)
  oros-weatherapp-cache       Weather app device-local forecast
                              map (cityId → payload, MAX 6 —
                              NEVER synced)
  oros-weather                weather settings {on, auto, lat,
                              lon, label} — TRAVELS IN SHELL SLICE
  oros-wx-cache               last successful weather read {at,
                              temp, code} — DEVICE-LOCAL, never
                              synced
  oros-wx-last                epoch ms of last fetch attempt
                              (device-local throttle)
  oros-mood-data              Mood slice storage (syncs; DATA_VER 3
                              with trigger presets + col.trig labels)
  oros-mood-seen              Mood device-local privacy-notice
                              flag (one-time dialog per device,
                              NOT synced)
  oros-sync-pw-epoch          Zero-Knowledge Sync v0.9 — local
                              known passphrase epoch (v0.30.03)

NOTES DATA MODEL (DATA_VER 2)
  state = { ver, pages:[{id, parent, title, text, mtime, pos,
    labels:[]}], labels:[{id, name, color, mtime, pos}],
    tombs: {pageId→ts, "lbl:"+labelId→ts} }
  8-color LABEL_COLORS palette (shared with To-Do/Mood):
  #e06c75 #ecc75f #87cf3e #4fc4cf #6d4aff #e09ecf #f28c5a #9aa4b0
  Merge: per-page/label LWW (mtime, tie → lexicographic JSON),
  tombs union max-ts, delete wins ties (>=), 30d prune,
  normalizeState() idempotent. Autosave debounce 500ms.

KANBAN DATA MODEL (DATA_VER 5)
  state = { ver, boards:[{id, name, columns, labels, tombs,
    mtime, color?, archived?}], boardDeleted:{<boardId>→ts},
    activeBoardId } — activeBoardId is DEVICE-LOCAL only.
  Merge: boards[] union by id + LWW by mtime; nested per-board
    columns/cards/labels follow v0.5 contract; root tombstones
    state.boardDeleted prevent resurrection; prune > 30d.
  Archive: soft-hide via archived flag LWW; last-live-board guard.

MOOD DATA MODEL (DATA_VER 3)
  state = { ver, sm, om,
    entries: [{ id, ts, mtime,
                emotions: [{k, i}],
                loc, person, trig,       // col value ids | null
                water, food, meds, move, som, caf, alc, scr,
                note, trigger_old }],    // legacy free-text
    cols: { loc: [...], person: [...], trig: [...] },
    deleted: { <entryId|colValId>: <tombstone ts> } }
  FIXED EMOTIONS (9): happy #87cf3e, calm #51a2da, excited #8c5ec7,
    sad #5277c3, angry #e06c75, anxious #e0a44c, tired #9aa0ae,
    stressed #ff7043, numb #6d4aff.
  TRIGGERS: closed chip list (cols.trig), factory seeds seeded
    on empty cols.trig, deterministic migration (legacy strings
    → find-or-create ids).
  DERIVED: time-of-day from ts, day keys for thread (local
    calendar — no timezone bug), statistics derive from entries
    only (absence ≠ neutral).
  Merge: union by id + LWW by mtime; tombstones union max-ts;
    dedupeCols() runs at merge time (label-normalized, mtime-winner,
    symmetric remapping); entry order = DESC ts.

SYNC ENGINE v0.9.0 (Zero-Knowledge Sync v0.9)
  NEW: changePassphrase(oldPw, newPw, remember) — explicit old-
    passphrase verification (NEVER in-memory), re-encrypts cloud,
    dirty flag survives to push unsynced edits.
  NEW: ensureCloudReadable() — PUSH GUARD on ALL push invocations
    (tab-hide, shortcut, manual). Before encrypting, verifies the
    cloud blob can be decrypted with current passphrase. Skipped
    only when recent pull (<30s) already proved it.
  NEW: pwEpoch tracking (localStorage oros-sync-pw-epoch) +
    detectPwEpochMismatch() — warns when cloud epoch exceeds local.
  IMPROVED: errorKey() maps OperationError AND wrong-passphrase to
    sync.err.passphrase — eliminates misleading "check connection".
  FIXED: contentDownload() error handling (network errors logged);
    pull()/push() .catch() handlers added.
  Security: Zero-knowledge (passphrases NEVER leave client), E2EE
    (AES-GCM client-side), non-extractable vault keys (IndexedDB),
    PKCE flow hardened (localStorage fallback), Dropbox tokens
    ONLY for file I/O.
  Baselines (djb2) per slice; divergence guard for mergeless
    slices: unpushed = dirty OR missing baseline OR mismatch.
  reconcile(reason) triggers: boot / interval / visible / online /
    register / debounce (DEBOUNCE_MS = 5000).
  ACCEPTED LIMIT: two devices offline with app closed converge
    only via a live open (merge needs app code present).

SHELL SLICE (synced): { lang, theme, skin, wallpaper,
  syncInterval, autoexport, weather } — getter reads live state;
  setter applies pulled values and NEVER marks dirty (R6).

GLOBAL SHORTCUTS SUBSYSTEM — shell.js §9c
  Architecture: Contract Β (shell owns, apps forward).
    - ALL handlers live in the shell (section 9c).
    - window.orosShortcuts = { handle(e) } is the public contract.
    - Apps forward via ONE keydown listener (capture-phase,
      canonical template — all apps share the same block).
  MODIFIERS: Ctrl+Alt+Shift (macOS: ⌃⌥⇧, metaKey accepted).
  KEY MATCHING: e.code ("KeyP") — PHYSICAL key, immune to Greek
    layout (e.key returns "π"). Letters only (code must start
    with "Key").
  Bindings (SC_DEFS — single source of truth):
    P  force push        O  force pull
    S  snapshot now       X  export DB
    I  info modal         U  check updates
    L  toggle language   R  reconnect

TOAST SUBSYSTEM (v0.18.1) — shell.js §9 scToast()
  scToast(kind, text): taskbar toast, top:44px, z-index 1400.
  Single-slot (new replaces old), inline palette-var styles.
  Wired into setSyncMsg + setSyncMsgRaw — every sync/shortcut/
  weather/message visible ANYWHERE, not just inside menu.

TASKBAR SYNC DOT (v0.18.0/v0.18.1) — shell.js §9b + §12
  STATES (data-state attr): off/locked/idle/syncing/synced/dirty/err.
  CLICK = syncNowFromDot(): pull then push-if-dirty, syncing→synced
    transients, toasts for each leg. Dot NO LONGER opens menu.
  Auto-sync feedback: fail → red status dot (6s transient).

WEATHER WIDGET (v0.18.0) — shell.js §9d
  Provider: Open-Meteo (no key, no cookies).
  OFFLINE: slashed-cloud SVG, NO temperature, never fake numbers.
  Location: GPS (user activation required) OR manual city.
  Sync: settings in shell slice; cache device-local.

INFO MODAL (v0.18.0) — shell.js §9c showInfoModal
  Trigger: Ctrl+Alt+Shift+I or menu Info row.
  Content: orOS + version pill, tagline, capabilities, shortcuts
    table (from SC_DEFS), repo link, credits (linked to
    koulaxizis.gr), External services disclosure (v0.30.03).

EXPORT SUBSYSTEM (Notes, v0.15.0) — zero dependencies
  writeZip(entries[{path,data}]) → Blob: store-method ZIP,
  CRC32 table, DOS timestamps, UTF-8 names (flag bit 11).
  Notebook zip: tree mirrors folders 1:1.

WIKI-LINK SUBSYSTEM (Notes, v0.17.0) — zero storage, derived
  Syntax: [[Title]] inside page TEXT. wikiTitles(text) regex;
  pageByTitle(title) exact case-insensitive trim match.
  Resolution: resolved → SOLID chip → selectPage; unresolved
    → DASHED chip → CREATION-ON-CLICK (child page).

PALETTE CONTRACT (iframe apps) — CI-ENFORCED (G3)
  inheritPalette() MUST read window.parent.document.documentElement
  (the SHELL's html). ALSO mirror data-theme from parent.
  watchPalette(): MutationObserver on parent <html>.
  G3 scans JS files referenced via src="" in app index.html.

RELEASE PIPELINE — .github/workflows/bump-version.yml (v3)
────────────────────────────────────────────────────────────────
Triggers on EVERY push to main (no paths filter). Steps:
  1. Read APP_VERSION from shell.js (fail if missing).
  2. Stamp sw.js CACHE_VERSION = "oros-v<version>" (fail loudly).
  3. Stamp manifest.webmanifest version (fail loudly).
  4. Node step:
     – ?v=<version> on every RELATIVE .css/.js in EVERY index.html
       (root + all app folders, directory scan — new apps need ZERO
       config; absolute URLs untouched).
     – G2 offline guard: app folders must appear in sw.js
       PRECACHE_URLS, else FAIL.
     – G3 palette guard: app JS must contain inheritPalette AND
       watchPalette, else FAIL.
  5. Commit via `git add -u`.
Self-trigger: bot commit re-runs workflow once; stamps already
  current → no diff → no commit → terminates. Safe.
  COVERED BY ACTION: CACHE_VERSION, manifest version, ALL ?v=.
  MANUAL BY DESIGN: shell.js APP_VERSION only (edit + push).

────────────────────────────────────────────────────────────────
FILE UPDATE CHECKLISTS (standing rules)
────────────────────────────────────────────────────────────────
A. VERSION BUMP (every release) — ONE manual step
   1. shell.js: APP_VERSION (+ banner; other banners updated
      manually same commit).
   2. Push to main. Action stamps everything else.
   3. Verify on BOTH devices: Info modal shows new version.

B. NEW APP ADDED (<app>/ folder)
   1. apps.json — entry (name, url, icon, category).
   2. sw.js — add app files to PRECACHE_URLS.
   3. shell.js — icon SVG in ICONS map.
   4. Translations — category label + shell-facing strings.
   5. Register sync slice (R8; merge contracts).
   6. Palette inheritance: inheritPalette + watchPalette.
   7. Shortcut forwarding listener (canonical Contract Β).
   8. Nothing in bump-version.yml (?v= auto-stamped).

C. SYNC ENGINE CHANGES (sync.js)
   - Version bump only. Re-read deployed file (cachebust fetch)
     before diagnosing — stale SW caches impersonate bugs (R3).

D. RELEASE PRE-FLIGHT
   - JS/JSON syntax sanity (node --check).
   - Console: no SyntaxError, version matches Info modal.
   - Shortcuts smoke test in EACH app.
   - Deploy + version check on BOTH devices.

────────────────────────────────────────────────────────────────
RELEASE HISTORY (chronological — newest first)
────────────────────────────────────────────────────────────────

## v0.30.03 (2026-09-14) — Zero-Knowledge Sync v0.9

### Overview
Architectural overhaul of the zero-knowledge sync system to
eliminate all six security traps identified during the post-
factory-reset debugging saga.

### Changes
- **Push guard**: ensureCloudReadable() on ALL direct push
  invocations (tab-hide, shortcut, manual). Before encrypting,
  verifies cloud blob can be decrypted with current passphrase.
- **Explicit verification**: changePassphrase() uses TYPED old
  passphrase for verification, NEVER in-memory. Vault-unlocked
  devices must prove knowledge of old passphrase.
- **Recovery dialogs**: showChangePassDialog() (old/new/confirm,
  eye-toggles, vault-aware re-sealing); showPassChangedDialog()
  (any passphrase-class failure, retry-friendly).
- **Error mapping**: errorKey() maps OperationError AND wrong-
  passphrase to sync.err.passphrase — eliminates misleading
  "check connection" message.
- **Trust window**: lastSuccessfulPullAt tracks recent proven
  pulls (<30s) to skip redundant verification.
- **pwEpoch tracking**: localStorage oros-sync-pw-epoch for
  detecting cloud passphrase changes preemptively.

### Testing Checklist
  [ ] Device A: change passphrase → push OK
  [ ] Device B: boot with OLD passphrase → red dot → recovery
      dialog → new passphrase → pull → push → synced
  [ ] Device C: offline edit, reconnect → diverged guard → push
  [ ] Force-push with stale passphrase (tab-hide) → rejected
  [ ] Empty cloud (new account) → change passphrase → push OK

### Files Modified
- sync.js: +8 patches (A-D4)
- shell.js: +3 patches (B-E3)
- en.json & el.json: +10 keys each

### Known Limitations
- No cross-device notification (can't alert device B when A
  changes passphrase).
- Offline devices with stale passphrase can't auto-recover.
- No hierarchical key rotation (future: transitional windows).

---

## v0.27.04 — Cache strategy + splash screen

### Fixes
- **Service Worker cache**: Removed `ignoreSearch: true` from
  fetch handler's cache-first branch. Query-string cache-
  busting (`?v=`) now works correctly — new releases never
  resolve to old cached files.
- **Boot splash**: Static HTML overlay shows before JS parses.
  Displays "Welcome to orOS — checking for updates…" (EN/EL).
  Fade-out at ~1s, fail-safe at 10s.
- **Info modal**: External services disclosure (Open-Meteo).
  Shortcut alignment (mobile) — rows stack vertically ≤480px.
  Sync button text wrap (Greek labels).
- **Translation fallback**: App names in menu/tab use i18n keys
  with fallback to apps.json name.

### Files Changed
- sw.js — cache strategy
- shell.js — showInfoModal, renderMenu, openApp
- index.html — boot splash + inline script
- style.css — mobile stacking, text wrap, splash
- translations.js — new keys (EN/EL)

---

## v0.27.00 — Mood app deep-review cleanup

### Mood app fixes
- Edit from Entries list: switches to Capture tab first.
- Broken SVG: repaired malformed pencil icon path.
- Sync convergence: uid() seeds → DETERMINISTIC ids (seed-loc-*,
  seed-per-*, seed-trig-*). dedupeCols() runs at merge time.
- Greek PDF export: Added vendor/NotoSans-Regular.ttf (lazy-
  loaded, missing = warning + Latin fallback).
- Cache-bust fix: SCRIPT_V captured at boot (not in click
  handler where document.currentScript was null).
- Add draft survival: preserve input values across rebuilds.
- Toast stacking: wipe textContent before appending.
- Toast position: top-right, below app topbar (Linux convention).
- Entries empty state: localized message (no blank panel).
- Factory reset: clears view state (ghost filters).
- Boot: single-pass render; document.documentElement.lang set.
- Sync ack: "Updated from sync" (not misleading "Saved").

### Core fixes
- shell.js: Info modal listener leak fixed (Escape handler
  removes overlay + document listener on ALL exit routes).
- shell.js: global keydown handler bails when modal open.
- sw.js: NotoSans-Regular.ttf added to PRECACHE_URLS.
- bump-version.yml: header comment rewritten to match behavior.

### Decisions
- First-launch "Private by design" banner: REMOVED
- Demo data generator: console-testing tool only, not shipped.

---

## v0.26.0 — Mood Wave 5 + versioning overhaul

### Added
- **Trigger presets (Option A)**: Closed chip list + inline Add
  + Manage (rename/delete). DATA_VER 2→3: per-entry trig id,
  labels in cols.trig {id,label,mtime,pos}; legacy free-text
  migrates deterministically.
- **Factory trigger seeds**: Work deadline, Argument, Good news,
  Exercise, Sick day, Late screens — seeded ONCE on empty
  cols.trig.
- **Smart preselection ACTIVATED**: Most-used Location/Person
  for current time-of-day bucket preselected (facts-only rule).
- **Habits/Rituals split**: Two titled sections in Capture +
  Insights; filter panel splits into Basics + Rituals groups.

### Fixed
- Chip context menu (Manage) was INVISIBLE: opacity never set.
- Habits leaked between entries: resetCapture clears all 21.
- askRecentGuard discarded fresh picks: edit path now folds
  picks INTO recent entry.
- Trigger-only entries: no preview line (retired e.trigger
  string check → e.trig + render-time label).
- Scroll jump on chip tap: scroll preservation moved INSIDE
  buildCapture.
- Tab buttons: no hover/active state → covered.
- applyView: wrong title attribute; rename popup save button.

### Versioning overhaul
- shell.js APP_VERSION is SINGLE SOURCE OF TRUTH (NEVER written
  by CI). Manual bump only (dev commit).
- Action: READS APP_VERSION, stamps sw.js/manifest/?v= — nothing
  else. Old bump-computing steps removed.
- workflow_dispatch bump-type input removed — decided by hand-
  editing shell.js.
- Bot commit: "chore: sync orOS assets to vX (auto) [skip ci]".

### Disabled (TEMP markers)
- Daily reminder toast — commented at boot call site.
- First-open privacy dialog — commented in mood.js boot.

---

## v0.25.0 — Mood Wave 3.5 complete + tabs

### Features
- TABS: Capture · Entries · Insights.
- Co-occurrence: "when X, also Y" pairs (≥40% co-occurrence,
  ≥20pt above prevalence).
- Trigger intelligence: top-6 triggers → trend conditions;
  datalist autocomplete in capture.
- Intensity trend: avg intensity per emotion, recent vs earlier
  half (min 3/side, |Δ|≥0.4).
- Search (Entries): scans dates, feelings, contexts, habits,
  notes, triggers.
- Weekly recap card: count / top feeling / positive share.
- PDF export: full analytical report (vendored jsPDF, offline).

---

## v0.24.0 — Mood Wave 3 + 3.5 (filters, trends, polish)

### Filters
- Loc/person/habit single-select groups in Insights ("field:side"
  encoding); view-state only (never persisted).
- Emotion distribution gains vs-overall +/-pt deltas.
- Streak + calendar ignore filters; breakdowns, weekday, habits
  respect filters.

### Trends
- Auto-observations: per-context most over-represented emotion.
- Guards: min 5 entries per condition, min 12pt delta, top 6.
- Habit-forgetting tendency ≥35% logged days.

### Weekday patterns
- Emotion most over-represented per day-of-week (min 3 samples,
  min 10pt). Filtered.

### Weekly momentum
- Positive share (happy/calm/excited) this week vs last (min 3
  entries each). Time-based, ignores filters.

### Fixes
- Habits/breakdown bars: no background → invisible fills.
- renderInsights early-return hid factory reset link.
- sliceSet re-renders Insights when open.

### UI
- Calendar cells: bordered boxes (today = accent ring).
- The Basics habits: 3 full-width rows (yes/no side by side).
- new-btn from Insights returns to capture.
- 7-day thread: weekday labels.
- Capture: "Repeat last" ghost button.

### Deferred
- Co-occurrence pairs, weekly recap card, Wave 4 reminders.

---

## v0.6.0 — Kanban multi-board architecture

### Schema
- state.boards[] array (each: id, name, columns, labels, tombs,
  mtime, color?, archived?).
- activeBoardId is DEVICE-LOCAL (never synced).
- Migration: existing data wrapped into board "Main"/"Κύριο".

### Features
- Board selector dropdown (switch, stats).
- Create/manage boards dialog (rename, duplicate, delete,
  archive, color).
- Board-level stats (columns count, cards count).
- Cascade delete: board deletion = root-level tombstones.
- Alt+B quick-create; dblclick rename (desktop).

### Merge engine
- Boards[] union by id + LWW by mtime.
- Root tombstones state.boardDeleted prevent resurrection.
- Nested per-board merge (v0.5 contract unchanged).

### Polish
- Rename dialog (not prompt(); Esc/backdrop-safe, zero-edit
  doesn't stamp mtime).
- Archived boards section in manage dialog.
- Color dot + inline swatches.
- Board dot in selector.
- Archive/unarchive SVGs added.

### Untested before stable
- Fresh install · migration from v4 · switch/create/rename/
  duplicate/delete · archive last-board guard · root-tombstone
  cross-device non-resurrection · drag-reorder propagation
  via sync · color sync · popover layering · mobile.

---

## v0.21.2 — Sync messaging honesty

- "Nothing in the cloud yet" retired.
- Three-way pull outcomes: empty cloud / nothing-new / pulled-N.
- Combined dot-push toast omits pull part when nothing came down.
- Translations: sync.ok.cloud.empty and sync.ok.none added.

---

## v0.21.0/0.21.1/0.21.2 — Weather audit fixes

- Timezone-correct "now" (utc_offset_seconds from response).
- Undo-delete toast (native confirm retired).
- NaN guards, pointercancel.
- UV/AQI band words + legends.
- No-data state.
- Badge hidden-flag inversion fixed.
- City-local night icons (timezone-aware).

---

## v0.20.0/0.22.0 — Weather/Mood waves

- **Weather 0.2.0**: Units toggle (°C⇄°F), UV, sunrise/sunset,
  AQI, smart hints, city pager, interactive autocomplete.
- **Mood 0.1.0**: 9-emotion grid, Location/Person columns,
  water/food/meds toggles, reflection + trigger, 1h guard,
  recent list + undo-delete, 7-day thread, privacy dialog.

---

## v0.19.0 — Weather app v0.1.0

- Current + 48h hourly + 7-day forecast.
- Multi-city favorites, device-local cache.
- Precipitation probability bars.
- Offline: last-known + dim badge, never fake numbers.
- Open-Meteo provider (no key, no cookies).
- Merge-lite sync slice (todo-contract).

---

## v0.18.2 — Wave 4 (cleanup/audit)

81 findings → 70 surgical patches. Notable:
- Kanban same-column drag ReferenceError fixed (undefined `col`).
- Dialog contracts unified (commit-on-any-close + zero-edit
  no-stamp).
- Corrupted EL tagline fixed.
- Language toggle reaches open apps.
- sync.dot.aria added.
- sw.js precache serves ?v= requests (ignoreSearch).
- notes.js migrated to canonical capture forwarding.
- Dead code swept (sliceIsClean, vaultReady, `changed`).
- Storage registry completed.

---

## v0.18.1 — Post-ship fixes

- Shortcut modifiers → Ctrl+Alt+Shift matched via e.code.
- scToast wired into setSyncMsg/setSyncMsgRaw.
- Sync dot click = full sync trigger.
- Taskbar version badge removed.
- Info modal sc.info.cap fixed.
- Credits linked to koulaxizis.gr.

---

## v0.18.0 — Wave 3 (shell)

- Global shortcuts Contract Β (SC_DEFS dispatch + shell listener
  + app forwarding). R12 born.
- Taskbar sync dot (7 chromatic states, clock-tick derivation).
- Weather widget (Open-Meteo, taskbar chip, GPS/manual city).
- Info modal (auto-generated shortcuts table).
- Version toast single-line fix.
- Folder button styling fix.
- Notes save-indicator removal.

---

## Earlier versions (v0.1–v0.17.0)

See repository git history for detailed pre-v0.18.0 changelog.
Summary:
- v0.13.0: Notes app born
- v0.14.x: Wave 2 (Labels, palette fix)
- v0.15.0: Notes exports (page.txt + notebook ZIP)
- v0.16.0: Notes search + tags panel
- v0.17.0: Notes wiki-links + backlinks

────────────────────────────────────────────────────────────────
BACKLOG (recorded, not scheduled)
────────────────────────────────────────────────────────────────

Core / Sync
- Unified shell-level toast API (orosToast) — cross-app.
- Hierarchical key rotation (transitional windows).
- Cross-device notification for passphrase changes.
- Additional cloud providers (Google Drive, OneDrive, pDrive)
  — E2EE mandatory.

Kanban
- Board color in column headers.
- Search scope (active vs all boards).
- Mobile long-press board drag.

Notes
- Import (.txt → new page, ZIP → non-destructive restore).
- Fuzzy/case-insensitive backlink matching.
- Read-mode (rendered [[links]] clickable).

Mood
- Wave 6: gentle reminders (orOS-open-only, clickable toast).
- Weekly recap card.
- Ghost-label Option B for deleted column values.
- Export enhancements.

Weather
- Per-hour graph view.
- Radar integration.

New Apps
- Pad (Notepad++-style port, Python grammar, diff viewer).
- Pagination/typesetting app (Scribus/InDesign/Affinity style).
- Public Domain Calculator.
- Habit Tracker (separate from Mood).
- Characters app (character design, personality, relations).

OrOS Core
- Native Windows/Android conversion.
- Desk suite (linux-OS-style: desktop icons, wallpaper,
  custom shortcuts, full export-import).
- Default document handler/editor/viewer registration.

## 0.31.00 — Time & Calendar apps (minor feature release)

Two new applications, full sync integration, and the release polish
for the 0.30.x fixes wave. App version single source of truth:
shell.js APP_VERSION (GitHub Action propagates everywhere else).

### New applications

#### Time (time/) — v0.1.0
- Clock faces: Digital / Analog (SVG) / Binary, switchable, persisted.
- World clock: add/remove time zones (21 zone presets), live tick.
- Alarms: SHELL-OWNED engine (window.orosAlarms in shell.js) —
  firing survives closing the app iframe and page reloads
  (localStorage "oros-alarms"). Honest limit: fully closed browser
  = nothing rings. Daily repeat advances to the NEXT future firing
  (catch-up loop fix — no notification storms after days offline).
- Timer / Stopwatch / Pomodoro: all endings ride the same shell
  alarm engine; runtime state deliberately NOT synced.
- Astronomy module (astro.js): sun/moon positions, moon phase,
  sunrise/sunset — pure math, weather coordinates, fully offline.
- Standalone fallback alarm engine when loaded outside the shell.

#### Calendar (calendar/) — v0.1.0
- Monthly grid, Monday-first, trailing/leading padding, weekend tint.
- Day selection + full event CRUD (title, time, all-day, note).
- Events carry id + mtime from day one; deletes write TOMBSTONES
  ({ id, mtime } in state.deleted) so a delete on device A can
  never be resurrected by device B's stale copy. Edit-after-delete
  cancels the tombstone (newer mtime wins). Additive field,
  ver stays 1, zero migration.

### Sync integration (this release's engineering core)
- Both apps self-register slices via window.orosSync.registerSlice
  with deterministic mergeFn (entity union + tombstones for
  calendar events and time zones; scalar-LWW via smtime for
  style/pomodoro durations; max() for the pomodoro counter).
- Closed-app persistence via the persisted registry (storageKeys
  oros-time-data / oros-calendar-data) → proxies hydrate on boot,
  data travels while apps are closed (v0.8 divergence guard
  applies to them automatically).
- Alarms are DEVICE-LOCAL by design: an alarm is the intent for
  THAT device to ring. Cross-device scheduled moments are served
  by the (synced) Calendar. Under consideration for the future:
  optional synced alarms with proper merge semantics.
- time.js saveState() now marks the engine dirty (was missing —
  the slice existed but changes never flagged sync).

### Shell / core
- Taskbar clock split: #bar-time opens Time, #bar-date opens
  Calendar (single click, no desktop hop; menu fallback if a
  stale apps.json lacks the entries; legacy #bar-clock fallback
  for stale cached index.html bundles).
- clock/calendar icons added to the shell ICONS map (inline SVG).
- NEW APP ADDITION CHECKLIST (follow after every new app):
  1. app folder (index.html, *.css, *.js)
  2. apps.json entry (+ valid JSON — commas!)
  3. PRECACHE_URLS in sw.js (folder + every file)
  4. shell.js ICONS entry
  5. translations.js: app.<id> + category strings (en/el)
  6. self-registration in the app (registerSlice + markDirty)
  7. changelog entry (this file)
  GitHub Action bumps versions/cache-busts automatically.

### Standing rules (unchanged)
Offline first · Mobile first · No external dependencies · Full
project manual export · Full project automatic export · Full
project snapshots · Full project auto merge sync · No guessing.

  5. translations.js: app.<id> + category strings (en/el)
  5b. PALATE CONTRACT (bump-version.yml G3): the app's JS must
      define inheritPalette() + watchPalette() (watch the shell
      <html> data-theme/data-skin) — or the GitHub Action FAILS
      the push. Never inline-only palette inheritance.
  6. self-registration in the app (registerSlice + markDirty)
  
  ## Time app v0.1.1 — 2026-09-15
- FIX: binary clock always visible (CSS display overrode [hidden];
  all faces now use :not([hidden]) guards)
- FIX: scrollbar styled (WebKit + Firefox, theme vars)
- FIX: toast position top-right (shared .oro-toast, shell parity)
- FIX: astro times forced 24h (hour12:false); alarm time validated 24h
- ADD: Flip + Neon clock styles (style 3, 4; synced scalar, sanitized 0..4)
- ADD: alarm snooze 5/10/15 min (standalone engine; shell engine needs
  shell.js change — snooze buttons on its alarm toast)
- ADD: alarm sound (Web Audio beep, synced "sound" pref, al-sound checkbox)
- ADD: timer fullscreen countdown overlay for last 60s (click to dismiss)
- ADD: world clock zone editing (dblclick → swap via tombstone+add)
- ADD: quick-add chips for common zones (Athens/London/NY/Tokyo)
- ADD: timezone converter section (local ↔ zones, toggleable)
- ADD: geolocation fallback in astro (session-only, dialog-reviewed)
- ADD: solar status dots (day/twilight/night + GPS marker)
- ADD: ARIA labels + focus-visible rings throughout

## Time app v0.1.1 — 2026-09-15

### Bug Fixes
- FIX: binary clock always visible (CSS display overrode [hidden]; all faces now use :not([hidden]) guards)
- FIX: scrollbar styled (WebKit + Firefox, theme vars)
- FIX: toast position top-right (shared .oro-toast, shell parity)
- FIX: astro times forced 24h (hour12:false); alarm time validated 24h

### Features
- ADD: Flip + Neon clock styles (style 3, 4; synced scalar, sanitized 0..4)
- ADD: alarm snooze 5/10/15 min (standalone engine; shell engine needs shell.js change)
- ADD: alarm sound (Web Audio beep, synced "sound" pref, al-sound checkbox)
- ADD: timer fullscreen countdown overlay for last 60s (click to dismiss)
- ADD: world clock zone editing (dblclick → swap via tombstone+add)
- ADD: quick-add chips for common zones (Athens/London/NY/Tokyo)
- ADD: timezone converter section (local ↔ zones, toggleable)
- ADD: geolocation fallback in astro (session-only, dialog-reviewed)
- ADD: solar status dots (day/twilight/night + GPS marker)
- ADD: ARIA labels + focus-visible rings throughout

## Time app v0.1.1a — 2026-09-15
- DIAGNOSED: bugs #1–#4 όλα είχαν ΕΝΑ root cause — index.html v0.1.1
  τρελούσε με time.js/astro.js v0.1.0 (stale) + time.css χωρίς guards.
  Symptom proof: sty-3/4 dead buttons (old wiring loop i<3), raw keys
  "sty.flip"/"astro.geo"/"al.sound" (keys εκτός old i18n packs),
  face-flip/face-neon κενά containers.
- FIX (genuine CSS bug): #face-digital display:flex πλέον :not([hidden])
  — τελευταίο face χωρίς guard (ίδια κλάση bug με το original #1)
- time.css παραδίδεται πλέον ΜΟΝΟ consolidated (κανένα follow-up
  patches — full-file delivery policy)
- FIX: as-geo → data-i18n-a="astro.geo.detect" (astro keys ζουν ΜΟΝΟ
  στο astro.js pack, ποτέ στο time.js)
- ADD: boot markers "[orOS] time.js/astro.js v0.1.1 booted" — instant
  stale-file detection στο console
- STANDING RULE (νέο, καταγεγραμμένο): ΟΛΑ τα orOS apps υιοθετούν το
  scrollbar styling του Mood app ως καθολικό πρότυπο. Περ awaiting:
  mood.css scrollbar block. Ισχύει για κάθε νέο app ΚΑΙ retrofit
  υπάρχοντων (todo/kanban/notes/writer/weather/time).
  
  ## Time app v0.1.1b — 2026-09-15
- ADOPTED: scrollbars τυποποιημένα στο orOS-wide Mood standard
  (mood.css §6b): 10px, transparent track, pill thumb 999px με
  2px border var(--bg), hover var(--accent), Firefox
  scrollbar-width:thin + scrollbar-color. Ενσωματώθηκε στο time.css
  (patch 1). Το PENDING marker αφαιρέθηκε.
- ADOPTED: authority guard [hidden]{display:none!important}
  (mood.css §X) στο time.css (patch 2) — defense-in-depth πάνω
  από τα per-face :not([hidden]) guards.
- ADD: overscroll-behavior:contain στο #tmain (Mood parity).

## STANDING RULES (orOS-wide, μόνιμα σε ισχύ)
- SCROLLBAR STANDARD: πρότυπο = mood.css §6b. ΚΑΘΕ orOS app
  (νέο ή retrofit) υιοθετεί τo ίδιο block, scoped στο δικό του
  main scroll container: #todo main, #kanban board, #notes pane,
  #writer doc, #weather main, #time #tmain. Retrofit backlog:
  todo, kanban, notes, writer, weather (ελέγχουμε αν κάποιο έχει
  ήδη κοντινό styling και το ευθυγραμμίζουμε).
- HIDDEN AUTHORITY GUARD: κάθε app CSS τελειώνει με
  [hidden]{display:none!important} (mood.css §X). Ίδιο backlog
  με τα scrollbars.
  
  ## orOS Apps — Scrollbar + Hidden Guard Retrofits
### 2026-09-15 — Mood Standard Adoption

**APPLIED:** Mood scrollbar standard (§6b) + [hidden] authority guard (§X)
to ALL orOS app stylesheets. Uniform 10px pill thumbs with 2px border,
transparent tracks, and guaranteed hidden attribute precedence.

| App      | Scrollbar Target(s)          | Status  |
|----------|------------------------------|---------|
| Time     | #tmain                       | DONE    |
| Calendar | #cmain                       | PATCHED |
| Kanban   | #columns, .col-body          | PATCHED |
| Notes    | ::selection + specific panes | PATCHED |
| Quote    | Global + tab panes           | PATCHED |
| Todo     | #list-scroll                 | PATCHED |
| Weather  | #hourly                      | UPGRADED|

**BACKLOG COMPLETE:** All six core orOS apps now share identical
scrollbar aesthetics and hidden-element authority guards per the
Mood app reference standard.

## orOS 0.x.xx — Quote v0.1.00 (new app)

First stable build of the Quote app: clean-room rewrite of the
legacy beta "Offer" application, ported to the orOS architecture
(sync-first, offline-first, mobile-first). The beta files were used
ONLY as functional reference — zero code carried over.

### What was added

- **Application: Quote (quote/, v0.1.00)**
  - Two tabs: Create (full offer editor) + Quotes (list).
  - Data model: quotes, clients, templates, payMethods — four synced
    entity collections with a shared tombstone map.
  - Sync: full orosSync integration via registerSlice("quote", …,
    mergeFn). Merge = unionEntities + LWW per entity + tombstones.
    Deterministic and symmetric (merge(A,B) === merge(B,A)).
  - Computed totals (subtotal, discount, VAT, total) are PURE
    functions — never stored, so no merge can create arithmetic
    conflicts. Only inputs are synced.
  - Line items: code, description, qty, unit price, item discount,
    per-item VAT. Global discount applied pro-rata per line.
  - Instalments: manual dates/amounts + even split generator with
    rounding-safe allocation (remainder to first instalment).
  - Numbering: OFF-YYYY-NNN, recovery-based max scan per year —
    no synced counters, no merge conflicts on numbers.
  - Clients: dropdown selector + native <dialog> editor. Deleting a
    client keeps historical clientId references (no cascade — offer
    history never loses attribution).
  - Templates: save current offer as reusable template; applying a
    template ALWAYS creates a new draft (never overwrites).
  - Payment presets (payMethods): per-user synced text presets for
    Bank / PayPal / IRIS / Cash. Seeded deterministically (ids
    pm-bank etc.) so first sync between devices never duplicates.
    Editing a preset stamps mtime only when text changed
    (zero-edit close → no LWW locks).
  - Status: draft / sent / accepted / rejected / expired, with
    discrete 3px status accent bar on list rows derived from the
    theme palette (no saturated badges).
  - List: search (number, notes, payment terms, client, line-item
    descriptions & codes) + multi-select status filter popover.
  - Export: PDF via vendored jspdf.umd.min.js + NotoSans-Regular
    (Greek support). Falls back to print when font unavailable and
    UI language is Greek (garbled Greek worse than 2-step export).
  - Send: mailto: composition with client email, due date, total.
  - Palette: inheritPalette() + watchPalette() per orOS contract
    (G3 passes). Standalone fallback tokens in :root.
  - Keyboard: Alt+N = new quote (browser-safe combo).
  - Bilingual EN/EL, inline STRINGS (no external translation file).

### Post-audit fixes (13 patches applied before first release)

1. SyntaxError: missing comma in mergeQuoteStates return before
   payMethods (blocked entire app boot). 
2. New-client creation was impossible: dialog close handler bailed
   when editingClientId === null; no push() existed anywhere in
   that flow. Fixed: commit now lives on form submit (Save button),
   Esc/close = discard. Zero-edit submit is a no-op (fingerprint).
3. Removed dead createNewClientFromEditor() (superseded by 2).
4. saveCurrentAsTemplate crashed on dead client reference — added
   null guard (deleted client + historical quote = TypeError).
5. sliceGet() now strips activeQuoteId (device-local, never travels
   to cloud; also silences spurious markDirty on register-flush
   boot comparison in sync.js).
6. sliceSet(): if the currently open saved quote was deleted on
   another device, editor falls back to a fresh draft with toast
   instead of writing into an orphaned reference (silent data loss).
7. Fixed Greek typo "Εληξε" → "Έληξε" (status.expired).
8. PDF: total column right-aligned against page margin (W-M) to
   prevent overflow past the physical page edge.
9. Search now also matches line-item descriptions and codes.
10. Removed redundant data-i18n on #client-name-display (managed
    exclusively by renderClientDisplay()).
11. Removed dead CSS block #dlg-client .meta-fields (no matching
    markup).
12. Cleaned stray non-Greek characters in boot() comment.
13. Removed empty no-op block in mergeQuoteStates.

### Integration checklist (DONE / PENDING)

- [x] quote/index.html, quote.css, quote.js deployed to /quote/
- [x] STRINGS include all keys used by data-i18n attributes
- [x] registerSlice signature matches sync.js v0.7+ (5 args)
- [x] Palette contract (G3) satisfied
- [ ] apps.json — add quote entry (Productivity, icon, url quote/)
- [ ] sw.js PRECACHE_URLS — add quote/ entries + vendor fonts
      (jspdf.umd.min.js, NotoSans-Regular.ttf) for offline PDF
- [ ] bump-version.yml guards G2 (offline coverage) will fail
      until sw.js entry is added — do this BEFORE pushing to main

### Under consideration (future waves)

- Quote-level custom fields
- CSV export of the quotes list
- Direct browser print styling of the create tab (currently
  PDF-first, print only as fallback)
- Ability to edit payment preset names/order

## Time app v0.1.1c — 2026-09-15
- FIXED (astro.js): duplicate divider between "Sun now" and the
  solar status line — removed dead `row("", "")` placeholder row
  (empty .ast-row contributed an extra border-bottom + padding).
- INTERNAL: line 356 mixed-quote SyntaxError resolved earlier
  this session (history note, shipped in v0.1.1a).
  
  ## Time app v0.1.1d — 2026-09-15
- FIXED (time.js): quick-add zone chips (Athens, London, NY, Tokyo)
  now translate properly on language switch. Added qc.* keys to both
  en/el translation packs, renamed zoneName() → zoneKey() with a
  switch mapping for the four presets, and refreshed renderChips()
  call inside applyI18n() so the UI updates instantly when the
  language changes.
  
  ## orOS v0.32.14 — 2026-09-15
- ADDED (shell.js): new inline SVG icon "quote" for the Quote/Offer
  app — a folded document with two quotation-mark strokes, distinct
  from the "notes" document (plain text lines). Registered in the
  ICONS registry; consumed via apps.json "icon": "quote".
- Time app: closed out v0.1.1d (see Time changelog) — translated
  quick-zone chips, centered clock faces, astronomy divider fix.
- System-wide: standardized scrollbars + [hidden] authority guard
  applied to Calendar, Kanban, Notes, Quote, To-Do, Weather.
  
  ## orOS v0.32.15 — 2026-09-15
- ADDED (shell.js): Snooze button (+9 min) in the shell alarm
  notification (alarmNotify). One-shot snooze re-added through
  window.orosAlarms.add — same sanitization gate as the Time app.
  Daily alarms unaffected: the recurrence already advanced before
  notify, the snooze shot is purely additive. Secondary/ghost
  styling, Dismiss remains primary. No changes to alarmTick(),
  the daily catch-up logic, or the 30s hard cap.
- (v0.32.14 rolled in the same session: ICONS.quote for the
  Quote/Offer app.)
  
  ## Time app v0.1.1e — 2026-09-15
- FIXED (time.js): restored the STR i18n declaration lost in the
  v0.1.1d patch — "var STR = {" opener + full "en" pack were eaten,
  leaving an orphan "el:" block (SyntaxError line 52). The stray
  duplicate el block (English tab/alarm strings misplaced inside
  the first block) removed.
- FIXED (time.js): v0.1.1d's zoneName→zoneKey rename was half-done
  (renderChips/openZoneDlg/convRender still called zoneName → would
  ReferenceError after syntax repair) AND returned raw i18n keys
  ("qc.athens") without t(). Replaced with a proper zoneName()
  that translates the 4 presets and falls back to the derived
  city name for all other zones.

────────────────────────────────────────────────────────────────
SESSION HANDOFF — v0.30.03 Ready for Deployment
────────────────────────────────────────────────────────────────

SHIPPING CHECKLIST (Zero-Knowledge Sync v0.9)
  [ ] sync.js: Patch A1/A2/A3 (Part 3), D1/D2/D3/D4/D5 (Part 4)
  [ ] shell.js: Patch B/C (Part 3), E1/E2/E3 (Part 4)
  [ ] en.json & el.json: +10 keys each (append to end)
  [ ] CHANGELOG.md: new entry at top (done)
  [ ] node --check sync.js · node --check shell.js
  [ ] Boot marker verification: "sync.js v0.9.0 boot" matches ?v=
  [ ] Smoke tests: changePassphrase flow on 2 devices
  [ ] Offline edge cases: stale passphrase + offline edit + reconnect
  [ ] Verify on BOTH devices: Info modal shows v0.30.03
  [ ] Push to main → wait for CI → verify stamps (sw.js, manifest)
  [ ] Hard refresh (both devices) → confirm version in Info modal
  [ ] Test all four pull entry points: unlock, menu, shortcut, dot
  [ ] Test push guard: offline device with stale passphrase → tab
      hide → should reject, show recovery dialog

NEXT PHASE (after v0.30.03 stable)
  Mobile PWA testing: changePassphrase flow across devices
  PW epoch tracking: implement proactive detection (eliminates
    OperationError)
  Habit Tracker app: integrate with Mood data model
  Kanban merge deep-dive: multi-board sync edge cases
  Desk suite: linux-OS-style expansion

HANDOFF PROMPT FOR NEXT CHAT:
"orOS v0.30.03 deployed — Zero-Knowledge Sync v0.9 complete.
Testing pending on mobile PWA (changePassphrase flow).
Next: PW epoch proactive detection OR Habit Tracker integration.
Read CHANGELOG.md v0.30.03 section before touching sync.js/shell.js."

---

*Designed by Christos Koulaxizis*
*orOS v0.30.03 — A static operating system in your browser*