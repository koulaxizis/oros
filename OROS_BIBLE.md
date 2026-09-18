# ══════════════════════════════════════════════════════════
# orOS — THE DEVELOPMENT BIBLE — SINGLE SOURCE OF TRUTH
# ══════════════════════════════════════════════════════════
#
# THE PRIMARY HANDOFF DOCUMENT FOR THE ASSISTANT.
# Read FULLY before touching any file. It is dense on purpose —
# every section exists because something broke once without it.
#
# Live     : https://useoros.online
# Repo     : github.com/koulaxizis/oros
# Author   : Designed by Christos Koulaxizis · koulaxizis.gr
# Tagline  : "A static operating system in your browser"
#
# MERGED 2026-09-18: this file now REPLACES the former
# OROS_BIBLE.md + CHANGELOG.md pair. CHANGELOG.md is RETIRED —
# the changelog lives in Part XIII at the END of this file
# (ascending order; new entries are APPENDED at the bottom).
#
# This file contains:
#   · The MUST-RULE REGISTRY (system-wide, per-app)
#   · The complete architecture reference
#   · The canonical app-development contract
#   · All standing process rules, pipelines, and checklists
#   · The AUDIT LEDGER with open items (Part X)
#   · The full release history (Part XIII)
#
# ABSOLUTE PRINCIPLES (non-negotiable, govern every decision):
#   Absolute consistency · Absolute functionality · Absolute
#   app interoperability · One shared line across everything.
#   Offline first · Mobile first · No external dependencies.
#   ZERO data-loss risk · Full merge sync · Full snapshots ·
#   Full manual + auto exports. Zero user tracking · End-to-end
#   encryption of all synced data · Open source · Clear
#   architecture.
#
# Document map:
#   Part I   — MANTRA + STANDING PROCESS RULES (R1–R22)
#   Part II  — MASTER RULE REGISTRY (system-wide, per-app)
#   Part III — CURRENT STATE + REGISTRIES (apps, files, keys)
#   Part IV  — DATA MODELS (per app)
#   Part V   — SYNC ARCHITECTURE + DATA SAFETY SUPREMACY
#   Part VI  — SHELL SUBSYSTEMS + PALETTE CONTRACT
#   Part VII — CANONICAL NEW-APP TEMPLATE (verbatim code)
#   Part VIII— UI STANDARDS
#   Part IX  — RELEASE PIPELINE + ALL CHECKLISTS
#   Part X   — AUDIT LEDGER & OPEN ITEMS ← READ BEFORE WORK
#   Part XI  — BACKLOG
#   Part XII — SESSION HANDOFF TEMPLATE
#   Part XIII— CHANGELOG (ascending; append at the BOTTOM)


╔══════════════════════════════════════════════════════════╗
║  PART I — MANTRA + STANDING PROCESS RULES                ║
╚══════════════════════════════════════════════════════════╝

──────────────────────────────
1. MANTRA (design contract — never violate)
──────────────────────────────
  Offline first · Mobile first · No external dependencies ·
  Full project manual export · Full project automatic export ·
  Full project snapshots · Full project auto-merge sync ·
  No guessing: if unsure, ASK; if a file is missing, REQUEST
  it; never guess or assume.

──────────────────────────────
2. STANDING PROCESS RULES (R1–R22)
──────────────────────────────
DELIVERY & PATCHING
  R1  NO WHOLESALE REGENERATION for fixes. Surgical patches
      (OLD block + NEW block + exact anchor) — regenerations
      dropped working code invisibly (v0.14.0). EXCEPTION:
      LARGE multi-edit changes or user-requested restructures
      ship as FULL corrected files.
  R2  RELEASE RITUAL IS MANDATORY (Part IX). Stale bundles
      impersonate broken code. Strikes: v0.13.1, v0.14.1,
      v0.14.2.
  R3  VERIFY THE RUNNING VERSION FIRST (Info modal
      Ctrl+Alt+Shift+I, boot marker in console) on BOTH devices
      before diagnosing.
  R4  Before chaining a patch ON TOP of a previous patch, CONFIRM
      the previous one was applied. Never assume.
  R11 Deliver patches against the USER'S CURRENT FILES, not
      remembered intermediate states. When in doubt, ship the
      COMBINED block rather than chained anchors.
  R13 Local/deployed desync: CI bot commits version stamps — run
      `git fetch && git log --oneline -5 origin/main` and
      `git pull --ff-only` BEFORE diagnosing "version drift".

MERGE & SYNC DOCTRINE
  R5  MERGES ARE SYMMETRIC: merge(A,B) === merge(B,A).
      Tie-breaks: mtime → lexicographic JSON/id — NEVER "local
      wins" (flip-flops between devices).
  R6  Pull-fed slice setters NEVER call markDirty (infinite
      pull→set→push loop otherwise). Echo suppression where the
      setter writes state.
  R8  Apps resolve sync via
      syncApi() = (window.parent && window.parent.orosSync) ||
      window.orosSync.

UI & CODE CONVENTIONS
  R7  renderAll() re-syncs ALL DOM controls after state changes.
  R9  i18n keys must match data-i18n attributes EXACTLY; HTML
      ships icon buttons EMPTY, JS injects SVGs
      (paintStaticAria/paintStaticIcons pattern).
  R10 Floating/transient views are SESSION-ONLY: search,
      filters, tag panels persist NOTHING (no prefs, no storage
      keys).
  R12 SHORTCUTS: final contract Ctrl+Alt+Shift+letter, matched
      via e.code ("KeyP" — physical key, layout-agnostic;
      Greek layout makes e.key lie). Alt+Shift is DEAD (Windows
      layout toggle eats it). Ctrl+Shift+* is DEAD (browser
      steals: print/screenshot). SC_DEFS in shell.js §9c is the
      single source.
  R14 NATIVE DIALOGS RETIRED: no alert()/confirm()/prompt() in
      any app. Themed custom dialogs + undo-toasts instead.
  R15 BILINGUAL SEEDS: factory presets store bi {en, el};
      display uses the ACTIVE language. A hand-rename KILLS bi
      permanently (the user's text is its only truth).
      Duplicate-detection must check BOTH label and colLabel
      spellings.
  R16 DETERMINISTIC SEED IDS: two fresh installs that sync must
      NOT union into duplicate seeds ("seed-<col>-<i>" style ids,
      not uid()). Label-normalized dedupe runs at merge time.
  R17 TOMBSTONE CONTRACT: deletes write tombstones (deleted{} /
      tombs{} / del flags, max-ts union); newer edits resurrect
      (fresh mtime beats tombstone); factory reset tombstones
      EVERYTHING that ever lived + rebirths seeds with fresh
      mtimes (merge-proof across devices).

QUALITY GATES
  R18 PRE-COMPLETION CHECKLIST per app: perfect sync (no data
      loss), full local export (zero loss), offline-first,
      mobile-first — ALL four before the app is "done".
  R19 VALIDATION: user pastes delivered code back for explicit
      correctness confirmation before committing to production.
      All exports (manual/auto/snapshot) must capture EVERY
      parameter and state variation — zero-loss recovery.
  R20 VERSION REFS — FULLY AUTOMATED: every relative .css/.js
      ref in EVERY index.html (root + all app folders) is
      stamped ?v=<APP_VERSION> by the CI bot (directory scan,
      overwrite semantics). NO ?v= param is ever edited by hand.
      APP_VERSION (shell.js) is the only manual version — the
      single source of truth, bumped in a dev commit; every
      release-stamped ref derives from it. (The old manual
      app-local ?v= rule described a pre-v3 workflow and was
      retired; every change rides a version bump by Checklist A,
      so manual refs served no scenario.)
  R21 CHANGELOG DISCIPLINE: after EVERY significant change
      (bug fix batch, feature, wave, audit closure, architecture
      change), APPEND an entry to Part XIII (bottom of THIS
      file) in the SAME response that delivers the patch — the
      user never has to ask. Entries: what changed, why, files
      touched, deferred items marked "under consideration".
      No change ships undocumented. CHANGELOG.md is RETIRED.
  R22 BIBLE CURRENCY: after every significant PROJECT DECISION
      (new contract, resolved conflict, schema/model change,
      new rule or precedent, acceptance of a standing pattern),
      update the affected registry parts (II–IX) of THIS file in
      the SAME response — the registry must always describe the
      CURRENT truth. The Bible changes when contracts change;
      the changelog changes when code changes. If a session ends
      with an unlogged decision, it did not happen.

STANDING DELIVERY RULE
  SMALL change → OLD/NEW replacement blocks with exact anchors +
  precise placement instructions. LARGE change (many edits across
  one file) or user-requested restructure → FULL corrected file.
  Never mix: a full-file regeneration is never justified for a
  one-line fix, and a 20-patch series is never justified when the
  file is being restructured anyway. Code for large files may be
  delivered in sequential numbered "doses" (with continuation
  markers verbatim) to prevent truncation.


╔══════════════════════════════════════════════════════════╗
║  PART II — MASTER RULE REGISTRY (the audit)              ║
╚══════════════════════════════════════════════════════════╝
Derived from the full codebase audit (shell, sync, sw, apps.json,
style.css, translations + Notes/Mood reference apps, then
Time/Weather/Prompter). Rules are MUSTS. When a rule conflicts
with convenience, the rule wins.

──────────────────────────────
3. SYSTEM-WIDE RULES
──────────────────────────────
CORE RULES (shell.js — CORE-1…CORE-35), the essentials:
  · IIFE encapsulation with "use strict" — every JS file.
  · ANTI-LOOP SYNC CONTRACT: setters fed by sync pulls NEVER
    trigger dirty flags / markDirty. Echo suppression at the
    write point.
  · SINGLE-SOURCE VERSIONING: APP_VERSION in shell.js is the
    only manual version; everything else stamped by CI.
  · OFFLINE HONESTY: never fake data when offline — show last
    known or an explicit empty/— state.
  · BATTERY EFFICIENCY: no idle timers that burn CPU for
    nothing; intervals sized to their purpose (tick 250ms only
    when visual smoothness demands it).
  · Shell subsystems: scToast top-right single-slot, sync dot
    single taskbar representation, SC_DEFS shortcut table,
    Open-Meteo weather widget with SVG offline indicator,
    window.orosAlarms engine surviving iframe close, calendar
    reminder engine §9e2 (Part VI).
  · Full version details live in the codebase; when a fix needs
    the exact current function, REQUEST shell.js.

APP RULES (apps.json — APP-1…APP-4):
  · Valid JSON, always (commas!).
  · Entry fields: id, name, url, icon, category, type.
  · Registry drives the menu — new apps appear via apps.json +
    sw.js PRECACHE_URLS (G2 guard) + translations + ICONS.

SW RULES (sw.js — SW-1…SW-5):
  · Precache-all: per-URL precache, exact URL matching, no
    globbing. PRECACHE_URLS must list every app file — the CI G2
    guard FAILS the push otherwise.
  · CACHE_VERSION busts everything at once; ?v= cache-bust
    params auto-stamped by CI on relative css/js refs.
  · ignoreSearch REMOVED from cache-first matching (so ?v=
    busts correctly). Navigation cache guarded (only
    response.ok; OAuth ?code= one-shot URLs never cached).

SYNC RULES (sync.js — SYNC-1…SYNC-14), the essentials:
  · Deterministic, symmetric merges (R5). LWW by mtime,
    lexicographic tie-breaks, tombstones with max-ts union,
    delete-wins-ties, newer-edit resurrection (R17).
  · Carry-forward logic for unknown slices (remote payload
    survives unknown local state).
  · Zero-knowledge passphrase; AES-GCM E2EE; PKCE OAuth.
  · sliceGet returns deep copies; sliceSet migrates → guards →
    writes → re-renders, never dirties.
  · Full engine contract in Part V.

CSS RULES (style.css/app CSS — CSS-1…CSS-8):
  · [hidden] { display: none !important; } authority guard at
    the end of EVERY app stylesheet.
  · Per-element display rules guarded with :not([hidden]).
  · Scrollbar standard (Part VIII §6b pattern).
  · Skin palettes defined once in shell style.css — the
    canonical palette vocabulary source.

I18N RULES (translations.js — I18N-1…I18N-3):
  · EN/EL only, everywhere. EN default.
  · Keys match data-i18n attributes exactly (R9).
  · Locale: el-GR / en-GB; Greek dates have NO comma after the
    day; EL dates dd/mm/yyyy.

VER RULES (VER-1…VER-3):
  · APP_VERSION single source of truth in shell.js.
  · CI stamps sw.js CACHE_VERSION, manifest, ?v= refs
    (root + all app index.html refs).
  · Boot markers log the running version.

DATA RULES (DATA-1…DATA-5):
  · Additive-only migrations (never destructive field drops).
  · Idempotent normalizeState() on load AND on merge results.
  · Corrupt-data rescue backup BEFORE reseeding.
  · Exports capture every parameter/state variation (R19).
  · Device-local whitelist (prefs/caches/seen) NEVER synced.

──────────────────────────────
4. PER-APP RULE SETS
──────────────────────────────
NOTES (N-1…N-33) — reference for complex state management:
  · Autosave debounce 500ms; additive-only schema migrations;
    idempotent normalization; deep-copy sync getters;
    SURGICAL DOM updates (targeted node patches, not full
    rebuilds); persisted search sidebar (desktop luxury
    pattern); long-press 450ms standard; labels with id/name/
    color/mtime/pos; wiki-links [[Title]] zero-storage,
    regex-derived; pinned notes; hamburger auto-close on small
    screens; notebook delete confirmation flow; export page .txt
    + notebook ZIP (skip confirm when single notebook); sort
    asymmetry known-issue: siblingListByParent ignores pinned
    (low priority).

MOOD (M-1…M-36) — THE CANONICAL TEMPLATE (reference cert):
  · Full-form re-render WITH draft preservation (read inputs +
    scrollTop before innerHTML="", rebuild, restore);
    derived-state-at-render-time (timestamps/day keys never
    stored); immediate save on entry commit; bilingual seeds
    (R15/R16); tombstone deletes; deterministic column merge
    with normalized-label dedupe + symmetric reference remap;
    created-once search UI that survives re-renders (mobile
    pattern); insights/statistics computed, never stored;
    "Logged X min ago" status above the Save Entry button; bars
    stop short of text labels (Greek overlap); PDF export with
    vendored NotoSans for Greek; triadic habits null|"yes"|"no".

TIME (T-1…T-8):
  · App version (v0.1.1) ≠ OS version — dual tracking.
  · Faces hidden via [hidden] + :not([hidden]) display guards.
  · Alarm/timer/pomodoro FIRINGS run in the SHELL engine
    (window.orosAlarms) — survive iframe close; runtime states
    deliberately NOT synced; alarms SYNCED via shell slice
    since 0.32.00.
  · Zones = entities {tz, mtime} + tombstones; scalar prefs LWW
    via smtime; astro coordinates round-trip in the slice
    (never wiped by time.js).
  · Merge: entity union + scalar smtime family + pmDone max().

WEATHER (W-1…W-17):
  · Merge engine lite (todo-contract): union-by-id cities, LWW
    content, tombstone-aware, om ordering donation, scalar side
    donates active+units+shellWx.
  · Undo-toast deletion (NO native confirm); resurrection =
    same id + fresh mtime.
  · Honest offline: badge = true offline OR netDown (failed
    fetch while online). Never fake numbers.
  · Render-only units (cache + slice ALWAYS metric).
  · European AQI (≤20 good → >100 epoor) + WHO UV bands
    (0–2 low → 11+ extreme) with legend tooltips.
  · City-local calendar judgment (utc_offset_seconds from the
    RESPONSE, never the device clock).
  · Autocomplete from 3rd char, 250ms debounce, stale-token
    discard, arrow-key navigation, mousedown-beats-blur.
  · GPS only inside user click handlers; null-guarded for stale
    HTML bundles.
  · Pager dots (≤1 city hidden); smart hints priority: storm >
    fog > rain > UV > heat > cold > swing > mild; no-data state
    (city exists, no payload); __orosWeatherUpdate bridge +
    boot-time shell fingerprint reconciliation (empty list
    re-adopts, non-empty respected); tray cache mirror with
    0.15° tolerance; swipe pager ≥45px (except #hourly) with
    pointercancel cleanup; toast bottom-centered with optional
    action; Contract Β shortcut forwarding.

CALENDAR (CAL-1…CAL-n) — built from scratch post-v0.35.00:
  · Sticky monthly/yearly clamp (Jan 31 → Feb 28 → Mar 31,
    Google-style) — recurrence algorithm mirrors shell.js
    calRemEachOccurrence 1:1; the two engines must NEVER
    disagree (hard contract).
  · Recurrence: master + computed occurrences (never stored);
    "recur" field freq D/W/M/Y, interval 1|2 (2 = bi-weekly,
    weekly only), until (YYYY-MM-DD), exdates (sorted, deduped,
    100-cap = intentional corruption bound).
  · Occurrence edit = exdate on master + independent override
    copy (fresh id, plain event); occurrence delete = exdate
    only. Undo exists for delete / exdate / move.
  · remindMin whitelist (None/5/15/30/60m, 1/3/5d) enforced in
    BOTH sanitizeEvent AND mergeSanitizeEv (sync contract).
  · Reminder engines (shell §9e2 + in-app standalone fallback)
    dedupe via shared device-local "oros-cal-reminders-fired".
  · Drag & drop (plain events + overrides only; series
    occurrences deliberately not draggable; desktop-only).
  · Labels share the event tombstone list; delete blocked
    while label in use; color change bumps mtime → syncs.
  · reseedSeedNames mtime-0 seeds: merge-inert by design; user
    edit detaches permanently.
  · Time picker: custom 24h (15' slots + free typing, "9" →
    09:00, "937" → 09:37), no native AM/PM anywhere.

FILES + OROSFS:
  · All file I/O via window.parent.orosFS only.
  · files-disk slice = BLOB TRANSPORT (JSON snapshot of
    /internal in localStorage cache); known limits: quota on
    very large disks, conflicts surface at app open/boot-flush;
    per-entry model = documented future upgrade.
  · fdSliceGet is PURE (no cache refresh inside get — injected
    "ts" would mismatch baselines forever).
  · "Take cloud version" conflict resolution wipes first
    (importDisk {wipe:true}) — remote deletions must survive.
  · downloadEntry() binary-faithful (FS().read + MIME map).
  · Reserved-name + forbidden-char validation on rename;
    stat() ENOENT = normal new-file path; "keep both" uniques
    against the real destination listing.
  · Tree expansion state persisted in view prefs (device-local,
    never in slice); empty-folder ghost fallback to /internal
    root without resetting sort prefs.

PROMPTER:
  · Built-in 100 prompts embedded; customs ride the slice as
    entities; favorites/completed sets; tombstone resurrection
    on re-favorite/re-complete; 57-tag controlled vocabulary.
  · Known gaps (pending): dead empty.stats branch in
    renderStats(), CSS version comment stale, Contract Β
    forwarding — 3 patches queued.

──────────────────────────────
5. RESOLVED CROSS-APP CONFLICTS (precedents)
──────────────────────────────
  #1 LONG-PRESS THRESHOLD: 450ms (Mood standard) — all apps.
  #2 PERSISTENCE STRATEGY: per data shape — editing-heavy apps
     (Notes) debounce; entry-based apps (Mood) save immediately.
     Document the choice in the app header.
  #3 RENDER STRATEGY: surgical updates = premium/performance
     (Notes); full rebuild + draft rescue = simpler (Mood).
     Choose per complexity; the draft-preservation discipline is
     MANDATORY either way.
  #4 SEARCH UI: created-once-survives-renders (Mood) = mobile
     default; persisted sidebar (Notes) = desktop enhancement.

UNIVERSAL CONTRACTS:
  · Contract Β — ALL apps forward shell shortcuts (capture
    phase, verbatim template in Part VII).
  · Palette inheritance system — all apps, CI-enforced (G3).


╔══════════════════════════════════════════════════════════╗
║  PART III — CURRENT STATE + REGISTRIES                   ║
╚══════════════════════════════════════════════════════════╝

──────────────────────────────
6. CURRENT STATE — v0.35.00 (2026-09-18)
──────────────────────────────
  Core shell  : APP_VERSION "0.35.00" (single truth; CI stamps
                sw.js/manifest/?v= automatically). Core kernel
                LOCKED at 0.35.00 — later modified BY USER
                DIRECTIVE for calendar reminders (§9e2 added).
  Sync engine : sync.js v0.9.1 — second-pass regression audit
                CLEAN (changePassphrase pushInFlight lock,
                empty-cloud 409, backupExistingRemote all
                applied; see Part XIII).
  Virtual disk: fs.js (OrosFS v0.1.0, OPFS + IDB fallback)
                + Files app + "files-disk" sync slice (Part V).
  Calendar    : v0.2.0 + Wave 3 (recurring events, reminders,
                drag & drop) — deep audit CLOSED, R19 paste-back
                verification PASSED. Ready for commit after
                optional F6 one-liner (Part X).
  Apps        : 13 in apps.json — see registry §7.
  Skins       : 16 · Wallpapers: 15 (Desert Sand default).
  Domain      : useoros.online ONLY (no alt domains).
  Version surf: Info modal (Ctrl+Alt+Shift+I) + version toast.
  Locale      : EN default, EL secondary. Dark default, light
                optional. 24h clock. EN/EL switch chips.
  Fonts       : Nunito woff2 vendored (5 weights, fonts/).
  Platform    : static GitHub Pages PWA (start_url "/?source=pwa",
                standalone, maskable icons, theme #1b1a18,
                bg #14120d — matches boot splash).

AUDIT POSTURE (full detail in Part X):
  · Core audit #1–#16: CLOSED (one open: #16 characters registry).
  · App audits: todo #17–25 CLOSED (2 decisions pending),
    kanban #26–35 CLOSED (2 open), notes #36–44 (2 open),
    calendar #C1–#C14 + waves CLOSED.
  · Second-pass shell+sync audit #S1–#S5 (S1 verification
    pending, S2/S3 status reconciliation pending, S5 decision
    pending — see Part X).
  · Files: full audit (29 items) applied at 0.34.08; deeper
    glue audit queued.
  · Remaining queued audits: weather, mood, time, quote,
    storage, prompter, characters, habits — NOT yet deep-audited.

VERSION LEDGER RECONCILIATION (OPEN — Part X.H):
  Recent entries used MIXED labels: habits waves tagged
  0.34.00/0.35.00, files sync glue 0.34.07, Files app launch
  0.35.00, delivered shell.js read 0.34.08. These look like
  audit-cycle/app-wave labels rather than a clean APP_VERSION
  sequence. ACTION: `git log` review to establish the actual
  APP_VERSION sequence. App-local ?v= refs observed: notes
  0.34.03, index.html 0.34.05 vs 0.35.00 (CI stamps on next
  push — R20).

DEPRECATED PATHS (verified dead — do not chase):
  · writer/ app: does NOT exist in the rebuilt orOS core
    (sw.js precache entries are forward-looking staging only).
  · "Update orOS" button: dead — skipWaiting() on install
    means no waiting worker ever exists.
  · Manual version stamps: replaced by automated GitHub Action
    (shell.js only manual bump point).

──────────────────────────────
7. APP REGISTRY
──────────────────────────────
  App       | Dir         | Slice / storage key    | VER | Merge type              | Audit
  ----------|-------------|------------------------|-----|------------------------|---------
  To-Do     | todo/       | oros-todo-data         | 3   | entity LWW + tombs     | DONE #17–25 (2 open)
  Kanban    | kanban/     | oros-kanban-data       | 5   | boards[] union, tombs  | DONE #26–35 (2 open)
  Notes     | notes/     | oros-notes-data        | 2   | page/label LWW + tombs | DONE #36–44 (2 open)
  Weather   | weather/    | oros-weatherapp-data   | 1   | merge-lite             | QUEUED
  Mood      | mood/       | oros-mood-data         | 3   | entity LWW + cols      | QUEUED
            |             |                        |     | dedupe                 |
  Time      | time/      | oros-time-data         | 1   | entity union +         | QUEUED
            |             |                        |     | scalar smtime          |
  Calendar  | calendar/   | oros-calendar-data     | 1   | event union + tombs,   | DONE #C1–14
            |             |                        |     | v0.2.0 schema          | + Waves 2–3 (F6 open)
  Quote     | quote/      | (quote slice)          | 1   | entity union + LWW +   | QUEUED
            |             |                        |     | tombs                  |
  Prompter  | prompter/   | oros-prompter-data     | 1   | union + LWW + tombs    | QUEUED (3 patches)
  Storage   | storage/    | oros-storage-data      | 1   | flat ents union + del  | QUEUED
  Habits    | habits/     | oros-habits-data       | 1   | habits/comps LWW +     | QUEUED (v0.3.0)
            |             |                        |     | tombs                  |
  Characters| characters/ | oros-characters-data   | 1   | non-merge LWW +        | QUEUED (key/model
            |             | (PENDING audit)       |     | divergence guard       | pending)
  Files     | files/      | oros-files-data (view  | 1   | files-disk slice:      | 29-item audit DONE;
            |             | prefs only) +         |     | blob snapshot via      | deeper audit QUEUED
            |             | "files-disk" slice    |     | shell §9f (Part V)     |
  · Slices with NO app open: registered via persisted registry —
    data travels while apps are closed (v0.8.1 divergence guard
    applies automatically). syncApi() resolution per R8.
  · REFERENCE APP (canonical template): mood/ v0.27.00 — every
    contract in Part VII is extracted VERBATIM from it. When in
    doubt, "what does mood.js do?" is the tie-breaker.
  · Characters: apps.json lists it + precached; storage key +
    data model PENDING the scheduled deep audit (features
    section intentionally blank).

──────────────────────────────
8. FILE TREE & LOCALSTORAGE KEYS
──────────────────────────────
REPO ROOT
  index.html            shell markup + SW lifecycle broker
                        (inline skipWaiting + controllerchange
                        reload) + boot splash (inline anti-FOUC
                        styles, noscript in body, window.onerror
                        splash error display on mobile)
  shell.js              menus, skins, wallpapers, auto-backup,
                        shell slice, shortcuts §9c, weather §9d,
                        sync dot §9b, scToast §9, info modal,
                        alarms (window.orosAlarms), calendar
                        reminder engine §9e2, files-disk slice
                        §9f, i18n, ICONS, APP_VERSION
                        (SINGLE SOURCE OF TRUTH)
  sync.js               orOS sync engine v0.9.1
  fs.js                 OrosFS virtual disk v0.1.0 (OPFS +
                        IndexedDB "oros-ofs" fallback); loads
                        BETWEEN sync.js and shell.js
  style.css             shell stylesheet — skin palettes =
                        canonical palette vocabulary source;
                        z-index ladder documented (sc-toast 1400,
                        alarm 1450, below splash 2000)
  translations.js       EN/EL shell strings (window.t); alarm.*
                        + wx keys migrated here (R9); version
                        headers stripped (R20)
  apps.json             app registry (id, name, url, icon,
                        category, type) — MUST stay valid JSON;
                        files app uses "files" icon, storage
                        uses "storage" (differentiated)
  sw.js                 precache-all, cache-first; per-URL
                        precache (single 404 never aborts
                        install — D1); CACHE_VERSION busts it;
                        PRECACHE_URLS lists every app file
                        (G2 guard); writer/ entries retained as
                        forward-looking staging (graceful
                        per-URL misses)
  manifest.webmanifest  PWA (CI-stamped version; start_url
                        "/?source=pwa", standalone, maskable)
  vendor/               jspdf.umd.min.js, NotoSans-Regular.ttf
  fonts/                Nunito woff2 (regular/medium/semibold/
                        bold/extrabold)
  todo/ kanban/ notes/ weather/ mood/ time/ calendar/ quote/
    prompter/ storage/ habits/ files/ characters/
                        one dir per app: index.html +
                        <app>.css + <app>.js (time/ also has
                        astro.js)
  .github/workflows/bump-version.yml   release pipeline (v3)
  OROS_BIBLE.md         THIS FILE (single source of truth —
                        Bible + changelog merged 2026-09-18;
                        former CHANGELOG.md RETIRED/DELETED)

LOCALSTORAGE / STORAGE KEYS
  Shell prefs (synced via shell slice):
    oros-lang · oros-theme · oros-skin · oros-wallpaper
    oros-sync-interval · oros-autoexport
    oros-weather {on, auto, lat, lon, label}
    oros-alarms            alarms list (shell-owned engine,
                           travels IN the shell slice since
                           0.32.00)
  Shell device-local:
    oros-last-version        last SEEN version (update toast)
    oros-wx-cache            last weather read {at,temp,code}
    oros-wx-last             fetch throttle epoch
    oros-autoexport-last     last auto-backup check epoch
    oros-auto-snapshots      rolling 5 full-DB snapshots (FIFO)
    oros-fs-folder-name / oros-fs-lapsed   backup-folder state
    oros-cal-reminders-fired calendar reminder dedupe log
                             (shared shell+app, device-local)
  Sync engine:
    oros-slices              registered slice metadata
    oros-sync-baselines      per-slice pushed hashes (djb2)
    oros-sync-dirty          unpushed-changes flag
    oros-remote-carry        parked remote payloads (divergence)
    oros-db-account          Dropbox account cache
    oros-db-access / oros-db-refresh / oros-db-expiry  tokens
    oros-pkce-verifier       SESSION-ONLY (sessionStorage)
    oros-vault-data          encrypted device vault
    oros-sync-pw-epoch       known passphrase epoch (ZK v0.9)
  Files app / OrosFS:
    oros-files-disk-cache    staged JSON snapshot of /internal —
                             the "files-disk" slice TRANSPORT
                             body (blob model; per-entry model
                             is a documented future upgrade)
    oros-files-disk-pending  flag: remote arrived while app
                             closed; consumed by files.js boot
    oros-files-data          Files app VIEW prefs only
    oros-ofs-dirty          OrosFS dirty flag (swept by
                             factory reset oros- prefix)
  IndexedDB:
    "oros-vault" store "keys"     vault decryption key
    "oros-fs"    store "handles"  FileSystemDirectoryHandle
    "oros-ofs"   OrosFS fallback backend (OPFS primary —
                 invisible to the localStorage sweep; wiped
                 via wipeOrosFS() in factory reset)
  App data (synced): see registry §7 (oros-*-data keys)
  App device-local: oros-notes-prefs, oros-mood-seen,
    oros-weatherapp-cache (MAX 6 cities, NEVER synced),
    oros-storage-data-broken, oros-habits-data-broken
    (corrupt-data rescue backups), oros-habits-view,
    oros-habits-range (view prefs — never in the slice)
  DEVICE-LOCAL WHITELIST (intentionally excluded from sync):
    oros-wx-cache, oros-auto-snapshots, oros-fs-*,
    oros-files-disk-pending, oros-cal-reminders-fired, all
    *-prefs/*-cache/*-seen keys. (NOTE:
    oros-files-disk-CACHE is the slice BODY — it IS synced
    content, not a whitelist member.)


╔══════════════════════════════════════════════════════════╗
║  PART IV — DATA MODELS                                  ║
╚══════════════════════════════════════════════════════════╝

──────────────────────────────
9. COMMON CONTRACTS (all apps)
──────────────────────────────
  · Entities: { id, mtime, ... } — union by id, LWW by mtime,
    tie → lexicographic JSON/id. Tombstones: max-ts union,
    delete wins ties, newer edit resurrects (R17).
  · ids: uid() = Date.now().toString(36) +
    Math.random().toString(36).slice(2,7). Seeds:
    deterministic ("seed-<col>-<i>") — R16.
  · Day keys (any calendar grouping): LOCAL calendar
    d.getFullYear()+"-"+pad(m+1)+"-"+pad(d) — no ISO/timezone
    bugs. pad() = leading zero helper.
  · Timestamp discipline: time-of-day & day boundaries DERIVE
    from entry ts at render time — never stored, never asked.

──────────────────────────────
10. PER-APP MODELS
──────────────────────────────
NOTES (DATA_VER 2)
  { ver, pages:[{id,parent,title,text,mtime,pos,labels:[]}],
    labels:[{id,name,color,mtime,pos}],
    tombs:{pageId→ts, "lbl:"+labelId→ts} }
  Merge: per-page/label LWW, 30d prune, normalizeState()
  idempotent, autosave debounce 500ms. Wiki-links [[Title]]:
  zero storage, regex-derived; solid chip = resolved, dashed
  chip = creation-on-click child page.
  SliceSet merge rule (#38 fix): after a merge that includes
  LOCAL contributions, compare applied state against the
  incoming payload — if different, markSyncDirty() so the
  merged result propagates back to the cloud (pure pulls skip
  push-back).

KANBAN (DATA_VER 5)
  { ver, boards:[{id,name,columns,labels,tombs,mtime,color?,
    archived?}], boardDeleted:{boardId→ts}, activeBoardId }
  activeBoardId is DEVICE-LOCAL. Merge: boards union + LWW;
  nested per-board v0.5 contract; root tombs prevent
  resurrection; archived/color fields survive merge; prune
  >30d; archive keeps last-live-board guard.

MOOD (DATA_VER 3)
  { ver, sm, om, entries:[{id,ts,mtime,emotions:[{k,i}],
    loc,person,trig, <21 habit fields> null|"yes"|"no",
    note, trigger:""}],
    cols:{loc[],person[],trig[]}, deleted:{id→ts} }
  · 9 fixed emotions (stable statistics vocabulary) — Part VI.
  · Columns: {id,label,bi?,mtime,pos}, deterministic seeds,
    renames kill bi, deletes tombstoned, dedupeCols() at merge
    (normLabel = trim+lowercase+collapse-space, mtime winner,
    symmetric remap of entry references).
  · Entry order = DESC ts (derived at sort time, not pos).
  · sm = state mtime, om = order mtime (position donation in
    merge: om-larger side wins).
  · Migration wave-1 booleans: true→"yes", false→null.

TIME (VER 1) · QUOTE · PROMPTER
  · Time: scalar prefs LWW via smtime (style, pomodoro
    durations, sound), zones entity-union + tombstones,
    runtime states NOT synced. Alarms SYNCED via shell slice
    since 0.32.00; the RINGING INTENT is synced; the engine
    lives in the shell and survives iframe close.
  · Quote: quotes/clients/templates/payMethods entity
    collections + shared tombstone map. Computed totals are
    PURE functions (never stored → no arithmetic merge
    conflicts). Numbering OFF-YYYY-NNN recovery-based max
    scan — no synced counters. sliceGet strips activeQuoteId.
  · Prompter: 100 built-ins embedded (10 categories, EN/EL
    handwritten); customs ride the slice as entities;
    favorites/completed are sets; tombstone resurrection on
    re-favorite/re-complete.

CALENDAR (VER 1 blob; schema evolved additively to v0.2.0+
  Wave 3 — zero-loss migrations at load)
  { ver, events:[{id, title, date, start "HH:MM"|null, end
    "HH:MM"|null (end ≥ start enforced deterministically),
    allDay implied by null start, location ≤150, labelId
    string|null, recur {freq D|W|M|Y, interval 1|2, until
    "YYYY-MM-DD", exdates [sorted, deduped, ≤100]},
    remindMin whitelist|null, mtime }],
    labels:[{id,name,color,mtime}] (fixed 8-color palette),
    deleted:{eventId/labelId → ts} — SHARED tombstone list;
    edit-after-delete cancels the tombstone }
  · v0.1 blobs migrate at load; seeds (Personal/Work/Family)
    only when empty; mtime-0 seeds → any user edit wins the
    merge (merge-inert by design).
  · Recurrence: master + computed occurrences (NEVER stored);
    sticky monthly/yearly clamp mirrors shell.js
    calRemEachOccurrence 1:1 (hard contract, Part II).
    Series edit keeps its anchor date; series occurrences not
    draggable; occurrence edit = exdate + override copy
    (fresh id, plain event).
  · Reminders: presets None/5/15/30/60m · 1/3/5d,
    whitelist-enforced in BOTH sanitizeEvent AND
    mergeSanitizeEv; deterministic stringify for the merge
    tie-break.
  · Fixed key order → JSON tie-break deterministic.
  · Strict merge-time sanitizers (mergeSanitizeEv/Tomb): rows
    with invalid mtime DROPPED — no Date.now() inside merge
    (Storage #6 precedent). Load-time sanitizers stay lenient
    for legacy blobs.

STORAGE (VER 1)
  { ver, ents: [{ id, type(space|room|furniture|position|
    item), name|bi, parentId, pos, qty?, note?, mtime, del }] }
  Flat entity array. Hierarchy render-side: Space→Room→
  Furniture→Position→Item. Cascade delete tombstones every
  descendant with fresh mtime. qty floor Math.max(1,floor).
  sliceGet prunes tombstones >30d from the PAYLOAD only.
  Corrupt local data → rescue copy to oros-storage-data-broken
  before re-seed.

HABITS (VER 1) — key oros-habits-data
  { ver, habits:[], comps:[] }
  · habit: { id, name≤200, icon(16 SVG set), color(LABEL_COLORS
    8), days:[0..6] MONDAY-first, mtime, del }
  · comp: { id:"<habitId>|<YYYY-MM-DD>", habitId, date, mtime,
    del } — toggle-off = tombstone, re-toggle = resurrect
    (R17), LWW merge by id.
  · days semantics: 7 = Daily · empty = Flexible · subset =
    N/wk.
  · Three views (List/Calendar/Stats) — one data path
    (toggleComp); view prefs oros-habits-view /
    oros-habits-range DEVICE-LOCAL, deliberately OUTSIDE the
    slice.

WEATHER (VER 1)
  { ver, sm, om, active, deleted:{id→ts},
    cities:[{id,label,lat,lon,mtime,pos}],
    shellWx: <fingerprint|null>, units:"metric"|"imperial" }
  units is RENDER ONLY — cache + slice always metric.
  Payload cache (device-local, MAX 6): oros-weatherapp-cache.

FILES (view prefs + transport blob)
  · oros-files-data: VIEW prefs only (expanded-tree keys, sort
    prefs etc.) — never user file content in localStorage.
  · "files-disk" slice body: JSON snapshot of the whole
    /internal disk {kind:"oros-files-disk", ...} staged in
    oros-files-disk-cache. BLOB MODEL — known limits
    documented (quota, conflict surface). Per-entry model =
    documented future upgrade.
  · Content I/O: window.parent.orosFS only.

CHARACTERS — model PENDING deep audit (registry: non-merge
  LWW + divergence guard; key oros-characters-data tentative).


╔══════════════════════════════════════════════════════════╗
║  PART V — SYNC ARCHITECTURE + DATA SAFETY SUPREMACY      ║
╚══════════════════════════════════════════════════════════╝

──────────────────────────────
11. SYNC ENGINE — sync.js v0.9.1 (Zero-Knowledge Sync v0.9.1)
──────────────────────────────
SECURITY MODEL (ABSOLUTE — non-negotiable)
  · Zero user tracking. No cookies, no analytics, no telemetry.
  · Zero-knowledge: passphrase NEVER leaves the client.
  · E2EE: AES-GCM + PBKDF2 (100k rounds) client-side; Dropbox
    tokens used ONLY for file I/O (PKCE flow).
  · Vault: oros-vault-data (sealed passphrase) + IndexedDB
    NON-EXTRACTABLE key (store "keys"), opt-in per device.
  · ALL synced third-party-cloud data MUST be E2EE — never
    plaintext files (standing requirement for ANY future
    provider: Google Drive, OneDrive, pDrive, Box…).

ZK v0.9/v0.9.1 HARDENING
  · changePassphrase(oldPw,newPw,remember): typed old-pass
    verification, re-encrypts cloud, dirty flag survives,
    pwEpoch increment, vault epoch update. HOLDS the
    pushInFlight lock (closes the last Trap-3 race window).
    Empty cloud 409 → returns null (never {ok:true}).
    Duplicate setPassphrase in 409 path removed (vault
	    corruption race eliminated). backupExistingRemote() runs
    BEFORE passphrase-change upload — mirrors the push
    overwrite contract, provides a recovery path if the new
    passphrase is forgotten.
  · ensureCloudReadable(): PUSH GUARD on ALL push paths —
    never overwrite a cloud blob the current passphrase
    cannot decrypt. Trust window: lastSuccessfulPullAt <30s
    skips redundant verification.
  · contentDownload 409 contract (CRITICAL, v0.9.1): 409 =
    empty cloud (path/not_found) RETURNS the response — every
    caller (pull, ensureCloudReadable, changePassphrase)
    branches on res.status===409 itself. Genuine network
    TypeErrors are wrapped; intentional status errors pass
    through so errorKey() maps auth failures correctly. (The
    eager !res.ok throw made all 409 branches unreachable —
    first-ever push failed on fresh/factory-reset installs.)
  · errorKey() maps OperationError + wrong-passphrase →
    sync.err.passphrase (never "check your connection").
  · Dead code REMOVED: detectPwEpochMismatch()/setPWEpoch().
    Kept: getWVEpoch(), payload.meta.pwEpoch. Proactive
    pwEpoch detection remains backlog (designed UX feature,
    not dormant code — decision logged 2026-09, audit #12).

BASELINE CONTRACT (#S2): push() records per-slice baselines
  from the PAYLOAD COLLECTED AT PUSH START, never from a
  re-read of live state. An edit landing mid-push would
  otherwise be falsely stamped "synced" while the cloud holds
  the older payload — defeating the divergence guard on the
  next pull.

ENGINE CORE (v0.6–v0.8.1 heritage)
  · registerSlice(name, get, set, storageKey?, mergeFn?) —
    5 args. Persisted registry (oros-slices) hydrates
    lightweight proxies at boot → app slices travel WHILE THE
    APP IS CLOSED.
  · mergeFn(local, remote) → merged. Must be deterministic
    (tie-breaks: mtime → lexicographic). Setter may receive
    (data, {merged:true}) — the merged-toast receipt contract.
  · Divergence guard (v0.8.1): mergeless slice with unpushed
    local work (= dirty OR missing baseline OR baseline
    mismatch) NEVER gets remotely overwritten — remote parks
    in the carry mailbox (oros-remote-carry), local pushes as
    the new truth; parked remote flushes at the next live
    merge-capable registration.
  · collectPayload()/applyPayload() = the unified funnel for
    cloud sync, manual export, auto-snapshots, folder
    mirroring — one funnel, zero divergence.
  · reconcile(reason) triggers: boot / interval / visible /
    online / register / debounce (DEBOUNCE_MS=5000,
    push-on-change). Guards: pushInFlight/reconcileInFlight.
  · ACCEPTED LIMIT: two offline devices with apps closed
    converge only via a live open (merge needs app code).

SHELL SLICE (synced): { lang, theme, skin, wallpaper,
  syncInterval, autoexport, weather, alarms } — getter reads
  live state; setter applies pulled values, NEVER marks
  dirty (anti-loop contract). Alarms: sanitize on pull
  (past/duplicate "once" items dropped), wholesale replace.

FILES-DISK GLUE (shell.js §9f, zero sync.js changes)
  · files.js mutates → window.__orosFilesDiskTouched():
    engine markDirty + 1s-debounced cache refresh (cache =
    last JSON snapshot of /internal in localStorage).
  · Remote while app closed: fdSet stages the snapshot +
    oros-files-disk-pending flag; files.js consumes it at
    next open through its own conflict-aware applyRemote.
  · fdSliceGet is PURE (no cache refresh inside get —
    injecting a new "ts" there would mismatch baselines
    forever). Pill state follows engine cycles
    (fdMarkCleanIfIdle on push/dot-click/done).

OROSFS (fs.js v0.1.0) — window.orosFS, one mount (/internal).
  OPFS primary, IndexedDB "oros-ofs" fallback, identical
  promise API: read/readText/write/writeText/ls/mkdir/rm/mv/
  stat + usage() (usage awaits backendReady()). exportDisk()
  portable JSON (base64 payloads, cross-backend, empty disk →
  empty export). importDisk(payload, {wipe}) — MERGE by
  default (never deletes absent files; reinforced markDirty —
  imported disk MUST reach the cloud), {wipe:true} only
  destructive mode. isDirty()/clearDirty(). ZERO-CONTACT:
  no existing keys/DBs touched. mkdir() marks dirty too.
  fs.js must be in the manual commit (bot never stages
  untracked files).

──────────────────────────────
12. DATA SAFETY SUPREMACY (the zero-loss guarantee)
──────────────────────────────
EVERY app and every change MUST satisfy ALL of these:
  · SYNC: bidirectional push-pull with deterministic merge —
    simultaneous edits on multiple devices survive (no
    overwrite, no data loss).
  · SNAPSHOTS: rolling 5 full-DB auto-snapshots (FIFO,
    on-change-only), "oros-auto-snapshots" — restore-safe.
  · MANUAL EXPORT: full database export capturing EVERY
    parameter and state variation — import restores with zero
    loss (tabs, documents, footnotes, templates, correction
    rules, settings, customs, everything).
  · AUTO EXPORT: optional periodic full unencrypted database
    export to a preset folder (manual-only option available)
    + on-close auto-sync safety net + beforeunload warning
    when dirty + online.
  · FACTORY RESET: double confirmation → suspend → cloud →
    folder → localStorage prefix sweep → OrosFS wipe
    ("oros-ofs" IDB via wipeOrosFS()) → marker → reload;
    tombstones EVERYTHING that ever lived + rebirths seeds
    with fresh mtimes (merge-proof).
  · CORRUPTION: rescue backup before any reseed (e.g.
    oros-storage-data-broken, oros-habits-data-broken).
  · BACKWARD COMPATIBILITY: updates to deployed apps NEVER
    lose user data; migrations additive-only; schemas carry
    forward unknown fields.

╔══════════════════════════════════════════════════════════╗
║  PART VI — SHELL SUBSYSTEMS + PALETTE CONTRACT           ║
╚══════════════════════════════════════════════════════════╝

──────────────────────────────
13. SHELL SUBSYSTEMS (where things live in shell.js)
──────────────────────────────
§9  scToast(kind, text)   taskbar toast, top:44px, z 1400,
    single-slot, palette-var styles. Wired into
    setSyncMsg/setSyncMsgRaw — every sync/shortcut/weather
    message visible anywhere. Linux convention: toasts pin
    top-right below the clock. Toast wrapper in apps: lazy-
    create div on body, text FIRST action-button SECOND
    (wipe textContent before append), 5s timeout, action
    callback fires + hide.

§9b SYNC DOT             taskbar dot, states via data-state:
    off/locked/idle/syncing/synced/dirty/err. CLICK =
    syncNowFromDot() (pull then push-if-dirty) — does NOT
    open the menu. Per-app sync indicators REMOVED — single
    taskbar dot represents everything.

§9c SHORTCUTS            SC_DEFS single source of truth;
    window.orosShortcuts.handle(e) public contract; shell
    owns ALL handlers (Contract Β), apps forward (template in
    Part VII). Bindings: P push · O pull · S snapshot ·
    X export · I info · U updates · L language · R
    reconnect. Info modal table derives from SC_DEFS — one
    entry changes everything.

§9d WEATHER WIDGET       Open-Meteo (no key, no cookies).
    Offline = slashed-cloud SVG, NO temperature, never fake
    numbers. GPS (user-activated) or manual city. City
    autocomplete from 3rd char (250ms debounce, stale-token
    discard via wxCAcToken, arrow-key navigation with wrap).
    Settings travel in shell slice; cache device-local.
    wxPushToApp() called after pull so fresh prefs reach a
    running weather app (#S3).

§9e ALARMS               window.orosAlarms — shell-owned engine.
    Firing survives iframe close + page reloads; fully closed
    browser = nothing rings (honest limit). Daily repeat
    advances to NEXT future firing (catch-up loop, no
    notification storms). Snooze +9min button on the shell
    alarm toast (one-shot, additive). Notification spam cap
    30s. Alarms are SYNCED (slice in shell slice) since
    v0.32.00. i18n keys: alarm.title / alarm.snooze ({n}) /
    alarm.dismiss (EL+EN, migrated from hardcoded ternaries).

§9e2 CALENDAR REMINDER ENGINE (added post-0.35.00 by user
    directive) — background-capable: fires while the Calendar
    app is CLOSED. Reads "oros-calendar-data" directly,
    occurrence expansion for recurring events (mirror of the
    app's recurrence math — the two engines must NEVER
    disagree), 30s throttle inside the 1s clock tick, no new
    background timers, first sweep 4s after boot. Notify:
    persistent top-right overlay (own element — NOT scToast,
    which auto-dismisses in 2.6s) + Web Notification ONLY when
    permission is already granted (permission is requested
    from the Calendar Save button — a legal user gesture; the
    shell never asks on its own). Standing honest limit (same
    as alarms): browser/tab fully closed = nothing fires.
    orOS is a browser OS, not a daemon.

§9f FILES-DISK SLICE     transport-only JSON snapshot of
    /internal OPFS. NOT a sync.js change: shell owns the
    slice, files.js mutates → __orosFilesDiskTouched, cache
    refresh 1s debounced, remote while app closed stages +
    pending flag, consumed at boot with conflict handling.
    Divergence guard: unpushed local work parks remote in
    carry; local pushes as truth; remote flushes at next live
    merge-capable registration. Pill state follows engine
    cycles (idle → markClean).

INFO MODAL: version pill (reads shell.js APP_VERSION at boot),
    tagline "A static operating system in your browser",
    capabilities, shortcuts table (invisible two-column table
    for mobile alignment — derives from SC_DEFS), repo link
    (clickable koulaxizis/oros), credits LINKED to
    koulaxizis.gr, external-services disclosure (Open-Meteo).

TASKBAR: 24h clock. #bar-time opens Time, #bar-date opens
    Calendar (single click, no desktop hop; menu fallback if
    stale apps.json; legacy #bar-clock fallback removed —
    dead selectors purged). Version badge lives in the info
    modal, NOT the taskbar.

MENUS: app menu doesn't close on every click. "Install orOS"
    / "Update orOS" separate from skin/theme settings (but
    "Update orOS" is a verified dead path — see Part III
    deprecated paths).

FACTORY RESET: full wipe incl. OrosFS ("oros-ofs" IDB) +
    tombstone-everything + seed rebirth (merge-proof).

──────────────────────────────
14. PALETTE CONTRACT & COLOR VOCABULARIES
──────────────────────────────
IFRAME PALETTE CONTRACT (CI-ENFORCED, G3)
  inheritPalette() MUST read
  window.parent.document.documentElement and mirror data-theme
  from the parent + copy palette vars via style.setProperty
  per variable (NEVER cssText += — it appends duplicates).
  watchPalette() = MutationObserver on parent <html>
  (attributes data-skin/data-theme). G3 scans JS files
  referenced via src in app index.html — missing either
  function FAILS the push.
  PAL_VARS baseline (mood.js):
    --bg --bg-desktop --bar-bg --text --text-dim --accent
    --accent-hover --accent-soft --panel-bg --border --shadow
  Apps extend with their own (--panel-bg-light,
  --font-stack). Standalone = try/catch + :root fallback tokens
  in the app CSS (never transparent/unreadable). Each app MAY
  take its own accent (Notes #d4af37) but adopts the OS THEME
  (light/dark) — palette follows OS theme switching, sync via
  shell slice.

SYSTEM ACCENT: --accent (skin-dependent). orOS gold skin
  default; "lumo" purple skin (#6d4aff) among 16 skins.

LABEL_COLORS (8-color, shared Notes/To-Do/Mood/Habits):
  #e06c75 #ecc75f #87cf3e #4fc4cf #6d4aff #e09ecf #f28c5a
  #9aa4b0

MOOD EMOTIONS (9, immutable — statistics need a stable
dictionary; tile carries the hue, glyph is currentColor):
  happy #87cf3e · calm #51a2da · excited #8c5ec7 ·
  sad #5277c3 · angry #e06c75 · anxious #e0a44c ·
  tired #9aa0ae · stressed #ff7043 · numb #6d4aff

MOOD HABITS (21, triadic null|"yes"|"no"):
  basics: water, food, sleep, move, som, caf, alc, scr, meds
  rituals: meditate, read, tv, music, games, cook, walk, nap,
            journal, chores, bedtime, outdoor
  UI: two titled sections (Basics / Rituals); re-tap active
  chip = unknown.

HABITS APP ICONS (16 SVG): check, star, heart, fire, book,
  music, bulb, target, sun, moon, trophy, leaf, coffee,
  dumbbell, bed, run. Colors: LABEL_COLORS 8.

FILES APP COLORS: inherits system --accent. No custom palette
  override.

╔══════════════════════════════════════════════════════════╗
║  PART VII — CANONICAL NEW-APP TEMPLATE                    ║
╚══════════════════════════════════════════════════════════╝

──────────────────────────────
15. PROCESS (how a new orOS app is born)
──────────────────────────────
  1. Design discussion FIRST: purpose, needs, justification as
     a standalone app (collaborative, mutual questions until
     consensus). Numbered feature proposals → user approves
     items (sometimes "all") → assistant may own design polish
     when functionality/usability are the priority.
  2. Start from a BARE MINIMUM core ("nothing else"),
     localStorage only. Expand in WAVES (feature sets
     activated sequentially). New features ship AFTER the
     pre-completion checklist (R18) of the current wave.
  3. New apps are BUILT FROM SCRATCH (or clean-room ports of
     beta apps used as functional reference ONLY — zero code
     carried over, "inspiration" role).
  4. After every wave: append a changelog entry (R21).
     Unimplemented but non-conflicting features → backlog as
     "under consideration".
  5. Deep audit before release: dead code, orphans, logic
     errors → numbered findings → user approves → bulk fixes.

FILE STRUCTURE (per app)
  <app>/index.html   minimal markup, EMPTY icon buttons (R9),
                      cache-busted app-local refs ?v=x.y.z
                      (CI-STAMPED automatically — R20)
  <app>/<app>.css    :root palette fallbacks (standalone),
                      scrollbar standard + [hidden] guard
                      (Part VIII)
  <app>/<app>.js     IIFE, "use strict", ES5 — sections:
                      1 constants/i18n/icons/helpers
                      2 data model + storage
                      2b merge engine
                      3 capture/render flow
                      4 sync slice + palette
                      5 wiring & boot

──────────────────────────────
16. CANONICAL PATTERNS (verbatim contracts from mood.js v0.27.00)
──────────────────────────────

  BOOT SEQUENCE (order matters):
    load() → applyI18n() → paintStaticAria/icons → wire() →
    registerSync() → inheritPalette() → watchPalette() →
    reset initial view state → first renders (SINGLE PASS —
    never renderAll twice at boot).

  BOOT MARKER (stale-file detection):
    var SCRIPT_V = "";
    (function(){ var m=(document.currentScript &&
      document.currentScript.src||"").match(/[?&]v=([^&#]+)/);
      SCRIPT_V = m?m[1]:"";
      document.documentElement.lang = LANG;
      console.log("<app>.js v"+(SCRIPT_V||"?")+" boot"); })();

  SYNC RESOLUTION + DIRTY FUNNEL:
    function registerSync() {
      var api = (window.parent && window.parent.orosSync) ||
                window.orosSync;
      window.__orosSyncApi = { _suppress:false,
        dirty:function(){ if(this._suppress)return;
          if(api&&typeof api.markDirty==="function")
            api.markDirty(); } };
      if(!api||typeof api.registerSlice!=="function")return;
      api.registerSlice("<id>",sliceGet,sliceSet,STORAGE_KEY,
        mergeFn);
    }
    save(): localStorage.setItem + __orosSyncApi.dirty().
    sliceSet(): suppress flag ON → write → OFF → sort/normalize
    → sanitize view state (orphaned editing target → reset) →
    re-render → info.merged → toast "Updated from sync" (a
    RECEIPT, never "Saved" — it wasn't a local save).

  SHORTCUT FORWARDING (Contract Β — capture phase, verbatim):
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey ||
          !e.shiftKey) return;
      var p = window.parent;
      if (!(p && p.orosShortcuts &&
          typeof p.orosShortcuts.handle === "function"))
        return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);

  MERGE ENGINE SHAPE (deterministic, symmetric):
    newerObj: mtime compare → lexicographic JSON tie-break.
    mergeUnionList: map by id, loser detection, tombstone
    filter (alive if mtime > tomb ts). Entries sort DESC ts.
    Column/order values: om-larger side donates positions.
    Strict normalizers for merge-time validation DROP invalid
    rows — never inject volatile defaults (uid/Date.now()
    inside merge = non-determinism bug, Storage #6 precedent).

  I18N: inline STRINGS = { en:{...}, el:{...} } inside the
    app; t(key) with en-fallback. App names/menu entries =
    translations.js app.<id> (en+el). Escape user text via
    esc() before innerHTML. Locale: el-GR / en-GB; Greek
    dates have NO comma after the day.

  DIALOGS: native <dialog>, created via createElement,
    showModal(), close on outside click + Esc, Delete button
    gets focus. Double confirmation for destructive factory
    resets (tombstone-everything, merge-proof).

  TOAST: lazy-created singleton on document.body, top-right
    (top: calc(12px + env(safe-area-inset-top))), text node
    first, optional action button second, 5s auto-hide.

  FORM REBUILD DISCIPLINE (buildCapture pattern): read
    previous input values + scrollTop BEFORE innerHTML="",
    rebuild, restore — mid-form re-renders never lose drafts
    or jump scroll.

  FRESHNESS/FILTER VIEW STATE: session-only variables
    (searchQ, filters, open dialogs) — reset them in factory
    reset (ghost views die with their data) (R10).

╔══════════════════════════════════════════════════════════╗
║  PART VIII — UI STANDARDS (orOS-wide, permanent)         ║
╚══════════════════════════════════════════════════════════╝

SCROLLBAR STANDARD (mood.css §6b — every app, scoped to its
main scroll container): 10px, transparent track, pill thumb
999px radius with 2px border var(--bg), hover var(--accent);
Firefox scrollbar-width:thin + scrollbar-color. Applied
retroactively to: todo #list-scroll, kanban #columns +
.col-body, notes panes, quote global + tab panes, weather
#hourly, time #tmain, calendar #cmain, habits, files,
storage. (DONE — backlog complete.)

HIDDEN AUTHORITY GUARD: every app CSS ends with
  [hidden]{display:none!important} (defense-in-depth over
  per-element :not([hidden]) guards).

OVERSCROLL: overscroll-behavior:contain on main scroll panes.

DIALOGS: no native alert/confirm/prompt (R14). Outside-click
  + Esc close. Commit-on-submit (Esc/backdrop = discard).
  Zero-edit close must NOT stamp mtime (no LWW locks).

ICONS: inline SVG everywhere — Fork Awesome ABANDONED. SVGs
  carry viewBox + explicit sizing (.ico 16px) or
  width/height attrs (never viewBox-only → 300×150 default).

TOASTS: top-right, below clock/taskbar, lazy singleton,
  single-slot replacement (see §9). Language switch updates
  OPEN apps live (broadcast), placeholders included.

LANG: EN/EL only. Dates follow active language (EL: ηη/μμ/
  εεεε, no comma after day).

MOBILE: drills/filters/actions reachable single-thumb; toasts
  and dialogs sized for phones; long-press (450ms) /
  right-click context menus with visible affordances (Manage…
  buttons — never hidden-gesture-only); touch targets ≥44px;
  safe-area insets (env()); media queries 480/420/360px.

DESKTOP: ≥1024px split views allowed (sidebar/tree + content).

AUTOSAVE: debounce, no explicit Save buttons for settings —
  real-time localStorage. Documents keep explicit save flows
  where semantics demand it.

VERSION BADGE: shell version lives in Info modal only.

BUTTONS: deleting = danger styling; undo via toast action
  (resurrection contract R17) preferred over confirmations.

FILES APP SPECIFIC: breadcrumb navigation + parent-up button,
  mobile slide-out tree drawer (<640px), status bar (item
  count, current path), 4-track list grid (icon|name|size|
  date) matching the column header. Recursive delete
  confirmation via themed dialog (R14).

╔══════════════════════════════════════════════════════════╗
║  PART IX — RELEASE PIPELINE + ALL CHECKLISTS             ║
╚══════════════════════════════════════════════════════════╝

──────────────────────────────
17. PIPELINE — .github/workflows/bump-version.yml (v3)
──────────────────────────────
  Triggers on EVERY push to main (no paths filter). Steps:
  1. Read APP_VERSION from shell.js (fail if missing).
  2. Stamp sw.js CACHE_VERSION = "oros-v<version>".
  3. Stamp manifest.webmanifest version.
  4. Node step: ?v=<version> on every RELATIVE .css/.js in
     EVERY index.html (directory scan — new apps need ZERO
     config); G2 offline guard (app folders must be in
     PRECACHE_URLS); G3 palette guard (inheritPalette +
     watchPalette present in app JS).
  5. Commit `git add -u` — "chore: sync orOS assets to vX
     (auto)". Bot commit re-runs once, no diff → terminates.
  COVERED BY ACTION: CACHE_VERSION, manifest, ?v= on every
  relative ref. MANUAL BY DESIGN: shell.js APP_VERSION only —
  the single trigger for everything else. Bot never stages
  untracked files — NEW files must be in the manual commit.

CHECKLIST A — VERSION BUMP (every release)
  1. shell.js: APP_VERSION (+ banner text, same commit).
  2. Push to main. CI stamps everything else.
  3. Verify on BOTH devices (Info modal + boot marker).
  4. Append changelog entry (R21) + Bible registry sync if
     any contract shipped (R22).

CHECKLIST B — NEW APP INTEGRATION (9 items)
  1. <app>/ folder (index.html + css + js)
  2. apps.json entry (valid JSON — commas!) (+icon key)
  3. sw.js PRECACHE_URLS (folder + every file + vendor deps)
     ← G2 guard FAILS the CI push until done
  4. shell.js ICONS entry (inline SVG)
  5. translations.js: app.<id> + category strings (en+el)
  6. Self-registration in the app (registerSlice + markDirty
     via __orosSyncApi)
  7. Palette: inheritPalette + watchPalette ← G3 guard
     FAILS the CI push until present
  8. Shortcut forwarding listener (Contract Β template,
     Part VII)
  9. CHANGELOG entry appended here (Part XIII) + registry
     update (Part III) — same response
  NOTHING in bump-version.yml — ?v= auto-stamped everywhere.

CHECKLIST C — SYNC ENGINE CHANGES: version bump only; re-read
  the DEPLOYED file (cachebust fetch) before diagnosing —
  stale SW caches impersonate bugs (R3/R13).

CHECKLIST D — RELEASE PRE-FLIGHT
  · node --check every touched JS; JSON syntax validation.
  · Console: no SyntaxError; boot marker matches ?v=.
  · Shortcuts smoke test in EACH app (incl. forwarding).
  · Deploy + version check on BOTH devices.
  · PWA update path: welcome toast shows version; verify on
    desktop AND mobile.
  · Changelog entry appended (R21); Bible current (R22).

CHECKLIST E — PRE-COMPLETION (per app/wave, R18)
  ☐ Perfect sync: push-pull both directions, no data loss
  ☐ Tombstone resurrection after multi-device delete
  ☐ Offline edits survive reconnect
  ☐ Full local export zero-loss (manual + auto + snapshot)
  ☐ Offline-first verified · ☐ Mobile-first verified

CHECKLIST F — UNIVERSAL COMPLIANCE (every app, master audit)
  STRUCTURE & STATE: IIFE strict · storageKey "oros-<app>-data"
  synced · prefs separate device-local · DATA_VER + additive
  migrations · normalizeState() idempotent.
  i18N: app-local STRINGS · lang attr at boot · all strings
  via t() · data-i18n(+ph) · parent orosLang typeof-guarded.
  SYNC: __orosSyncApi wrapper + _suppress · deep-copy
  getters · validating setters · deterministic merges ·
  tombstones · markDirty ONLY from user actions.
  UI: palette inherit + watch · toast standard · [hidden]
  guard · inline SVG only · <dialog> + outside/Esc ·
  Contract Β forwarding · no per-app sync indicator.
  DATA SAFETY: rolling 5 snapshots · full export · merge-aware
  import · factory reset full wipe + seed rebirth · corrupt
  rescue backup · unsaved-changes guard.
  MOBILE: touch targets · media queries · themed scrollbars ·
  safe-area insets · no hover-only features.
  OFFLINE: local cache · honest badge · never fake data ·
  throttled network · SW exact-URL match.
  SECURITY: esc() on dynamic innerHTML · typeof guards ·
  payload whitelisting · permissions only in user gestures ·
  no eval/user-input innerHTML.

╔══════════════════════════════════════════════════════════╗
║  PART X — AUDIT LEDGER & OPEN ITEMS                      ║
║  (READ THIS SECTION FIRST — exact patches/decisions      ║
║   waiting for you live HERE)                             ║
╚══════════════════════════════════════════════════════════╝

──────────────────────────────
18. CORE AUDIT FINDINGS (#1–#16) — ALL CLOSED
──────────────────────────────
  #1   ✓ restoreLastSnapshot() R14 patch applied
  #2   ✓ alarm i18n migration
  #3   ✓ translations.js header aligned
  #4   ✓ registerShellSlice verified (3-arg ok)
  #5   ✓ apps.json fetch caching documented
  #6   ✓ sw.js header aligned
  #7–10 ✓ i18n key validation
  #11  ✓ sync.js 409 empty-cloud fix (v0.9.1)
  #12  ✓ dead code remove (detectPwEpochMismatch)
  #13  ✓ app.quote translation defensive keys
  #14  ✓ sw.js precache verified
  #15  ✓ cross-check apps.json ↔ sw.js
  #16  ⚠ OPEN — characters app registry status (key/model
       pending scheduled audit; Bible Part III marks it
       ACTIVE with tentative key oros-characters-data)

──────────────────────────────
19. TO-DO APP AUDIT (#17–#25) — CLOSED, 2 decisions
──────────────────────────────
  #17 ✓ R14: 3 confirm() → themed dialog
  #18 ✓ merge safety: deleteLabel touch()s items + undo
  #20 ✓ rollover: visibilitychange midnight guard
  #23 ✓ palette: SWATCH_COLORS → LABEL_COLORS
  #25 ✓ boot marker + lang attr
  #19 △ DEFERRED — undo-across-sync merge semantics
       (proposal in Part XI To-Do entry)
  #21 ⊗ DECISION — priority keywords ('Σημαντικό'/
       'Επείγον' → red/orange/green chips): implement as
       mini-wave, strike from Bible, or defer?

──────────────────────────────
20. KANBAN APP AUDIT (#26–#35) — CLOSED, 2 open
──────────────────────────────
  #26–#33 ✓ R14 ×4, undo parity, palette, dead code,
       mojibake, boot marker, manage-list refresh,
       search/filter reset
  #34 ⊗ DECISION — index.html ?v=0.34.03 vs batch target:
       manual edit (R20 violation) or CI post-push?
  #35 ⊗ DECISION — dead keys + "live editing" comment
       cleanup: approve?

──────────────────────────────
21. NOTES APP AUDIT (#36–#44) — 2 open
──────────────────────────────
  #38 ✓ CRITICAL: sliceSet markSyncDirty() after merge
  #42 ✓ boot marker added
  #41 ⊗ DECISION — 3 native confirm() R14 patches: approve?
  #44 ⊗ DECISION — ?v=0.34.03 discrepancy (same as #34)

──────────────────────────────
22. SECOND-PASS SHELL + SYNC AUDIT (#S1–#S5)
──────────────────────────────
  #S1 ✓ CRITICAL ICONS missing comma (habits/files) fixed —
       verification PENDING (paste back for confirm)
  #S2 ▓ STATUS CONFLICT — §13 of the old changelog said
       "delivered, NOT applied"; the 0.35.00 deployment
       checklist marked the second-pass regression audit as
       complete (~20 patches applied, zero critical
       regressions). RECONCILE: confirm against the live
       files, or the v0.35.00 checklist wins by default
       (later in time). Baselines-from-payload contract is
       documented in Part V either way.
  #S3 ▓ STATUS CONFLICT — same reconciliation question for
       wxPushToApp-after-pull (documented as current
       contract in Part VI §9d).
  #S4 ✓ applyPayload merged flag accurate
  #S5 ⊗ DECISION — aurora wallpaper label "Αυγόρα" looks
       like "Αγορά": replace with "Σέλας" (Aurora) or
       "Αυγή" (Dawn)?

──────────────────────────────
23. FILES APP AUDIT (29 items) — APPLIED at 0.34.08
──────────────────────────────
  Critical: boot() stray-brace SyntaxError · importFile
  ENOENT/keep-both · tree-drop move · recents/toolbar DOM
  injection · sync pill anchor · 4-track list grid.
  Serious: wipe-first conflict restore · binary-faithful
  download · context-menu height · i18n dedupe/EL set ·
  pending-remote at end of boot · APP_VER alignment.
  Minor: fs.js mkdir dirty · dead code · search debounce
  250ms · CSS consolidation.
  STATUS: all applied; deeper glue audit (blob-sync limits)
  remains QUEUED in the app-audit queue below.

──────────────────────────────
24. CALENDAR APP — DEEP AUDIT CLOSED, R19 VERIFIED
──────────────────────────────
  #C1–#C14 audit batch CLOSED (R14 ×2, Contract Β, boot
  marker, strict merge sanitizers, deep-copy fallback,
  44px targets, dead keys, receipt toast, dirty funnel,
  focus, aria, midnight rollover, ?v= recorded).
  Wave 2 (start/end/location/labels/undo) + Wave 3
  (recurrence/reminders/DnD) FINAL VERIFICATION PASSED
  (all paste-backs confirmed). R18 gates all four checked.
  OPEN (cosmetic, non-blocking):
  · F6: .cal-cell.drop-target transform:scale(1.02) →
    one-line CSS simplification (inset shadow instead;
    no grid overflow on small screens). READY FOR COMMIT
    after F6.

──────────────────────────────
25. QUEUED APP AUDITS (NEXT PHASE — NOT YET STARTED)
──────────────────────────────
  Weather    High — taskbar widget + app sync coupling
  Mood       High — deepest data model, stats engine
  Files glue High — OrosFS blob-sync limits
  Time       Medium — multiple views
  Calendar   Medium — post-Wave-3 secondary pass (F6 + minor)
  Quote      Medium — computed totals, numbering logic
  Storage    Medium — cascade tombstones, corrupt rescue
  Habits     Medium — 3-view app, streak logic
  Prompter   Low — 3 cosmetic patches pending
  Characters Low — registry + model pending (also core #16)

──────────────────────────────
26. OPEN DECISION SUMMARY (USER RESPONSE NEEDED)
──────────────────────────────
  ⊗ #21 (To-Do) — priority keywords: implement/strike/defer?
  ⊗ #34/#44 (Kanban/Notes) — ?v=0.34.03: CI or manual edit?
  ⊗ #41 (Notes) — approve 3 confirm() → themed dialog?
  ⊗ #35 (Kanban) — clean up unused keys + stale comment?
  ⊗ #S5 (Shell) — aurora label: Σέλας or Αυγή?
  ⊗ #16 (Core) — characters storage key/model: confirm at
     the scheduled characters audit.
  △ #S1 — paste ICONS block back for verification.
  △ #S2/#S3 — confirm the 0.35.00 second-pass audit marks
     are accurate against live files (reconciliation above).
  △ #19 (To-Do) — undo-across-sync: tackle now or defer?
  △ H (below) — version ledger reconciliation via git log.

──────────────────────────────
27. VERSION LEDGER RECONCILIATION NEEDED
──────────────────────────────
  Mixed labels in recent history: habits waves 0.34.00/
  0.35.00, files glue 0.34.07, Files app 0.35.00, delivered
  shell.js read 0.34.08 — these look like audit-cycle labels,
  not a clean APP_VERSION sequence. ACTION: `git log` review
  to establish the ACTUAL APP_VERSION sequence and re-anchor
  Part III §6. index.html ?v= drift (0.34.05/0.34.03 vs
  0.35.00) resolves itself on the next push (R20 — CI
  stamps); sw.js holds a manual defense stamp 0.35.00.

──────────────────────────────
28. HOUSEKEEPING FROM THE MERGE (2026-09-18)
──────────────────────────────
  · CHANGELOG.md RETIRED — delete from repo (and from sw.js
    PRECACHE_URLS only if it was ever listed; it was not a
    precached asset).
  · References to "CHANGELOG.md" elsewhere in the codebase
    (comments, README if any) should now point to
    OROS_BIBLE.md Part XIII.
  · Old Bible's Bible-vs-changelog split rules (early R21/
    R22 drafts) are SUPERSEDED by the merged-file versions
    in Part I.

╔══════════════════════════════════════════════════════════╗
║  PART XI — BACKLOG (long-term ideas, not scheduled)       ║
╚══════════════════════════════════════════════════════════╝

CORE / SYNC
  · Unified shell-level toast API (orosToast) — cross-app.
  · Hierarchical key rotation (transitional windows).
  · Cross-device notification for passphrase changes.
  · PW epoch PROACTIVE detection (eliminate OperationError).
  · Additional cloud providers (Google Drive, OneDrive,
    pDrive, Box) — E2EE mandatory.
  · Synced alarms with proper merge semantics (optional).
  · Per-entry file sync for OrosFS (replace blob model).
  · Navigation network-first timeout race (~4s fallback).
  · Export/import parity audit across apps · manual snapshot
    visual distinction (Manual badge + dedicated delete).

APPS
  · Kanban: board color in column headers; search scope
    (active vs all boards); mobile long-press board drag;
    createBoard UX parity (filters not reset — fix K-7
    approved?).
  · Notes: import (.txt → page, ZIP → non-destructive
    restore); fuzzy backlink matching; read-mode links.
  · Mood: gentle reminders (orOS-open-only); weekly recap
    card refinements; ghost-label Option B; PDF export
    enhancements.
  · Weather: per-hour graph view; radar integration.
  · Calendar: replace remaining native dialogs (custom UI).
  · astro.js: coordination of storage slice (pending).
  · Quote: custom fields; CSV export; print styling of the
    create tab; payment preset name/order editing.
  · Prompter Wave 5+: sprint timer, multi-prompt sessions,
    Markdown export, keyboard shortcuts; + 3 queued
    compliance patches (renderStats dead branch, CSS comment,
    Contract Β forwarding).
  · Storage Wave 2: Restock Center (low-stock thresholds,
    aggregated shopping list, one-tap restock);
    drag-and-drop moves; search/filters; "All items" flat
    view; manual pos-based reordering.
  · Habits Wave 4: per-habit weekly targets (model change →
    migration plan required); week-row calendar variant;
    heat intensity; streak freeze; Mood-habits bridge; PDF
    stats export; seeded bilingual starter habits.
  · Files Wave 2: drag-drop import, batch operations,
    Dropbox-mount sync for file content; file previews
    (text/images); advanced editor integration; search.
  · To-Do: undo-across-sync semantics — proposed state =
    mergeTodoStates(current, stampAll(snapshot)) preserving
    remote-only entities; trade-off: list-delete fallback
    list may persist as ghost (#19, decision pending).

NEW APPS (planned, not started)
  · Pad (Notepad++-style: Python grammar, diff viewer).
  · Pagination/typesetting app (Scribus/InDesign/Affinity).
  · Public Domain Calculator (country presets, GR default,
    Wikipedia/web lookup for unknown publication dates).
  · Cycle (women's health: cycle, symptoms, meds,
    irregularities).
  · Desk suite (linux-OS-style desktop — experimental).
  · Native Windows/Android conversion of selected apps
    (decision pending flawless PWA validation).

╔══════════════════════════════════════════════════════════╗
║  PART XII — SESSION HANDOFF TEMPLATE                      ║
╚══════════════════════════════════════════════════════════╝
Copy this block into a new chat's first message:

  "Continuing orOS work. OROS_BIBLE.md is the SINGLE SOURCE
   OF TRUTH (Bible + changelog merged). Read Parts I–XIII
   fully before touching anything — Part X has the open
   items, Part XIII the changelog (newest at the bottom).
   Current state: v0.35.00. Next task: <task>. Apps involved:
   <dirs>. I will paste any file you explicitly request —
   the Bible registries contain the contracts; request files
   only when the LIVE code state of a specific function
   matters."

╔══════════════════════════════════════════════════════════╗
║  PART XIII — CHANGELOG                                   ║
╚══════════════════════════════════════════════════════════╝
ASCENDING ORDER (oldest → newest). NEW ENTRIES ARE APPENDED
AT THE BOTTOM OF THIS FILE — never insert above. Entry
template:

  ## [v<version> / <app or Wave>] — YYYY-MM-DD
  ### Changed / Added / Fixed / Removed
  ### Files touched
  ### Deferred ("under consideration")

──────────────────────────────────
  Pre-0.13 — To-Do, Kanban, sync engine genesis, PWA
    hardening, offline-first foundations.
  v0.13–v0.17 — Notes app era (born → labels → exports →
    search → wiki-links/backlinks).
  v0.18.x — Wave 3/4 shell (Contract Β shortcuts, sync dot,
    weather widget, info modal); 81 findings → 70 patches.
  v0.21–v0.26 — Mood evolution (tabs, insights, filters,
    triggers presets, habits/rituals split, versioning
    overhaul). Weather waves (units/UV/AQI/pager/
    autocomplete, timezone-correct now, undo delete).
  v0.27.00–v0.27.04 — Mood deep-review cleanup
    (deterministic seed ids, Greek PDF, SCRIPT_V at boot,
    single-pass boot, sync receipt toasts); cache strategy
    ignoreSearch removed; boot splash; info modal
    disclosures.
  Quote app v0.1.00 — clean-room rewrite of "Offer":
    entities + shared tombs, pure computed totals,
    instalments, OFF-YYYY-NNN numbering, PDF (jsPDF +
    NotoSans Greek), mailto, 13 pre-release audit fixes.
  Storage app v0.1.0–v0.1.2 — home inventory (flat ents,
    cascade tombstones, split-view desktop, mobile
    drill-down); post-audit wave (15 findings) incl. merge
    determinism #6 (volatile-defaults ban), sanitizeNav #3,
    palette live-watch parity.
  v0.30.03 — Zero-Knowledge Sync v0.9 (push guard,
    passphrase change, pwEpoch, trust window, errorKey
    mapping).
  v0.31.00 — Time & Calendar apps; taskbar shortcuts
    (#bar-time/#bar-date). Time v0.1.1 lessons:
    stale-bundle cross-version mix → boot markers (R11
    exemplar).
  Prompter 0.2.1–0.2.3 — tag suggestions, Ctrl+Enter save,
    modal CSS fixes, mobile media queries, dead-CSS removal.
  fs.js v0.1.0 — OrosFS Wave 1 (OPFS + IDB fallback, merge
    import, factory-reset leg, zero-contact guarantee).
    Hotfixes: dispatch arg order, opfsCollect return,
    empty-disk export.
  Habits v0.1.0 (orOS v0.33.0) — clean-room port; data model
    {habits, comps}; schedule-aware streaks; strict
    mergeRows; R14 dialogs; 16 icons.
  v0.32.00 — Alarms synced via shell slice; Kanban
    archived/color merge survival; all-app sync audit.
  v0.32.14–0.32.15 — Quote ICONS entry; system-wide
    scrollbar + [hidden] standard; alarm snooze +9min;
    Time quick-zone chips i18n + STR restoration.
  Habits v0.2.0 (v0.34.00) — Calendar view (month × habits
    grid, sticky gutter, future-locked, one data path).
  v0.34.02 — Core audit batch #1–#16 (R14 restore dialog,
    alarm i18n, sync v0.9.1 CRITICAL empty-cloud 409 fix,
    dead pwEpoch code removed). + To-Do batch #17–#25 (R14
    ×3, merge-safe deleteLabel, midnight rollover, boot
    marker, LABEL_COLORS). R20 rewritten to full automation
    (audit #24). + Kanban batch #26–#33.
  v0.34.03 — OrosFS Wave 1 shipped (fs.js v0.1.0).
  v0.34.04 — Notes #38 CRITICAL sliceSet merge propagation
    fix + #42 boot marker.
  Habits v0.3.0 (v0.35.00 label) — Stats view (overview
    cards, per-habit rates, natural-language insights,
    30/90/all ranges), habit identity colors inline.
  v0.34.07 — Files-disk sync slice glue (shell §9f, zero
    sync.js changes).
  v0.34.08 — Core audit wave 2 (#S1–#S5): ICONS comma fix,
    baselines-from-payload (#S2), wxPushToApp-after-pull
    (#S3). + Files full audit: 29 items applied (see
    Part X §23) — boot SyntaxError, importFile ENOENT,
    binary-faithful download, i18n dedupe, and more.
  v0.34.09 — RELEASE CANDIDATE SUPERSEDED (contents merged
    into 0.35.00; never shipped): changePassphrase
    empty-cloud null, wxCAcToken rename, usage()
    backendReady, sw.js defense bump, dead-code cleanup.
  [Files App] v0.35.00 — Wave 1 Launch: browse/create/rename/
    delete on /internal, lazy tree, breadcrumbs, mobile
    drawer, status bar; architecture via window.parent.orosFS.
  v0.35.00 — RELEASE CANDIDATE: changePassphrase pushInFlight
    lock + duplicate setPassphrase removal +
    backupExistingRemote; fs.js mkdir dirty + usage fix;
    sw.js per-URL precache (D1) + navigation cache guard;
    splash anti-FOUC + noscript in body + window.onerror;
    translations keys (fsfolder reconnect/lapsed, EL
    terminology); apps.json files-vs-storage icon split;
    R20 single-source versioning protocol sealed. Full
    second-pass regression audit of all core files (~20
    patches, zero critical regressions). Deployment
    checklist partially open (push, Action run, mobile PWA
    tests).
  [Calendar] v0.1.1 — deep audit batch #C1–#C14 (R14 ×2,
    Contract Β, boot marker, strict merge sanitizers, 44px
    targets, receipt toast, aria).
  [Calendar] v0.2.0 — Wave 2: start/end times (custom 24h
    picker), location, labels with color picker + filter
    chips, undo delete, desktop rectangular cells; schema
    additive, mtime-0 seeds merge-inert.
  [orOS Wave 3] — Calendar recurring events (sticky clamp,
    exdates, override copies), reminders (shell §9e2
    background engine + in-app dedupe), drag & drop;
    shell.js MODIFIED BY USER DIRECTIVE post-lock. Testing
    checklist recorded (recurrence clamps, sync round-trips,
    reminder with app closed, undo survival, export).
  [Calendar] v0.2.0 Wave 3 Final Verification — audit CLOSED
    (all paste-backs R19-confirmed; horizon prune, dynamic
    MAX_STEPS, corruption guard, series chooser, undo stacks
    cleared on sync, renderChips live refresh, CSS coverage).
    F6 cosmetic one-liner optional before commit.
  ## [BIBLE] 2026-09-18 — OROS_BIBLE.md + CHANGELOG.md MERGED
  into this single file. Part XIII = append-at-bottom
  changelog; CHANGELOG.md RETIRED (delete from repo). R21/R22
  updated for the merged-document workflow. All open audit
  items consolidated into Part X (incl. #S2/#S3 status
  reconciliation and deprecated-path registry). Entry
  template added at the top of this Part.

──────────────────────────────
*Designed by Christos Koulaxizis — koulaxizis.gr*
*orOS — A static operating system in your browser*
*No tracking · No cookies · E2EE sync · Open source*