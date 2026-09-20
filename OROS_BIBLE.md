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
#   Part I   — MANTRA + STANDING PROCESS RULES (R1–R23)
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
2. STANDING PROCESS RULES (R1–R23)
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
  R23 VERSIONING IS USER-OWNED: version numbers, cache-busters
      (?v= refs), CACHE_VERSION stamps and APP_VERSION bumps are
      the USER'S sole responsibility (CI executes, user decides).
      Audits NEVER propose, apply or "fix" versions. Version
      / cache-buster mismatches are EXPECTED mid-cycle and OUT
      OF AUDIT SCOPE by default — never flag them as findings.
      (Full rule text at the bottom of Part XIII; this rule
      closes and retires open item H/#27.)

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
  · Kernel Lock re-audit (F1–F11 + SP1–SP6 + IP1/IP2 + FP1/FP2
    + SW-I + TP1): CLOSED — core files verified/patched
    (shell.js, sync.js, fs.js, translations.js, index.html,
    sw.js, apps.json — see Part XIII entries).
  · Files: initial audit (29 items, 0.34.08) + deep re-audit
    (FA1–FA8 → FB1–FB6 → FC1–FC4 → FD1–FD5 → FE1–FE4 → FF1–FF3
    → FG1–FG5) ALL APPLIED AND VERIFIED — audit CLOSED (detail
    in Part X §23). Blob-sync limits = documented standing
    limit (Part V), NOT an open item.
  · Remaining queued audits: weather, mood, time, quote,
    storage, prompter, characters, habits — NOT yet deep-audited.
  · Weather is the NEXT audit in the queue (high priority:
    taskbar widget + app sync coupling).

VERSION LEDGER RECONCILIATION: CLOSED via R23 (versioning is
  user-owned; version/cache-buster observations are out of
  audit scope). The historical mixed-label note is retained
  below for archaeology only.
  Recent entries used MIXED labels: habits waves tagged
  0.34.00/0.35.00, files sync glue 0.34.07, Files app launch
  0.35.00, delivered shell.js read 0.34.08. These look like
  audit-cycle/app-wave labels rather than a clean APP_VERSION
  sequence. Superseded by R23 — no assistant action required.

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
  Weather   | weather/    | oros-weatherapp-data   | 1   | merge-lite             | QUEUED (NEXT)
  Mood      | mood/       | oros-mood-data         | 3   | entity LWW + cols      | QUEUED
            |             |                        |     | dedupe                 |
  Time      | time/      | oros-time-data         | 1   | entity union +          | QUEUED
            |             |                        |     | scalar smtime          |
  Calendar  | calendar/   | oros-calendar-data     | 1   | event union + tombs,   | DONE #C1–14
            |             |                        |     | v0.2.0 schema          | + Waves 2–3 (F6 open)
  Quote     | quote/      | (quote slice)          | 1   | entity union + LWW +   | QUEUED
            |             |                        |     | tombs                  |
  Prompter  | prompter/   | oros-prompter-data     | 1   | union + LWW + tombs    | QUEUED (3 patches)
  Storage   | storage/    | oros-storage-data      | 1   | flat ents union + del  | QUEUED
  Habits    | habits/     | oros-habits-data       | 1   | habits/comps LWW +     | QUEUED (v0.3.0)
            |             |                        |     | tombs                  |
  Characters| characters/ | oros-characters-data  | 1   | non-merge LWW +        | QUEUED (key/model
            |             | (PENDING audit)       |     | divergence guard       | pending)
  Files     | files/      | oros-files-data (view  | 1   | files-disk slice:      | 29-item audit DONE;
            |             | prefs only) +         |     | blob snapshot via      | deep re-audit FA1–FG5
            |             | "files-disk" slice    |     | shell §9f (Part V)     | ALL CLOSED (§23)
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
    oros-files-disk-meta     device-local sync pill state
                             {ts, dirty} for the Files app
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
    oros-habits-range (view prefs — never in the slice),
    oros-files-recents (Files app recents journal — device-
    local by design), oros-files-storage-cache (Files app
    storage-bar cache, 5min TTL)
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

KERNEL-LOCK HARDENING (SP1–SP6, 2026-09-19 — applied + verified)
  · SP1 ensureCloudReadable: non-409 status errors no longer
    launder as "empty cloud" — inconclusive checks REJECT the
    push (Trap-3 hardening).
  · SP2 pull() in-flight guards: pullInFlight flag + refusal
    while push/reconcile in flight — manual pull can no longer
    LWW-clobber a racing push's freshly-uploaded state.
  · SP3 proxy set() strict write: quota failures THROW →
    applyPayload skips baseline recording → stale-local-
    over-cloud push path eliminated (writeJsonStrict for
    proxies only).
  · SP4 refreshAccessToken memoized (single in-flight refresh)
    — concurrent API legs can no longer burn a rotating token.
  · SP5 debounce re-arms (1s) when the engine is busy instead
    of silently consuming the raced edit's only scheduled
    uploader.
  · SP6 shell.js refreshFilesDiskCache: changed disk content
    re-marks dirty — closes the push-vs-cache-refresh race
    window.

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
  date) matching the column header — COLUMN HEADER FIRST,
  then the Recents section, then entries (root view DOM
  order contract, FG fix). Recursive delete confirmation via
  themed dialog (R14).

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
  (Version numbers themselves are USER-OWNED — R23. The
  assistant never proposes or applies version bumps.)

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
       (SUPERSEDED by R23: version refs are user-owned —
       no assistant action required; residual question is
       cosmetic only.)
  #35 ⊗ DECISION — dead keys + "live editing" comment
       cleanup: approve?

──────────────────────────────
21. NOTES APP AUDIT (#36–#44) — 2 open
──────────────────────────────
  #38 ✓ CRITICAL: sliceSet markSyncDirty() after merge
  #42 ✓ boot marker added
  #41 ⊗ DECISION — 3 native confirm() R14 patches: approve?
  #44 ⊗ DECISION — ?v=0.34.03 discrepancy (same as #34,
       SUPERSEDED by R23)

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
23. FILES APP AUDITS — ALL CLOSED (0.34.08 → FG)
──────────────────────────────
  ROUND 1 (29 items, applied at 0.34.08):
  Critical: boot() stray-brace SyntaxError · importFile
  ENOENT/keep-both · tree-drop move · recents/toolbar DOM
  injection · sync pill anchor · 4-track list grid.
  Serious: wipe-first conflict restore · binary-faithful
  download · context-menu height · i18n dedupe/EL set ·
  pending-remote at end of boot · APP_VER alignment.
  Minor: fs.js mkdir dirty · dead code · search debounce
  250ms · CSS consolidation.

  ROUND 2 (FA1–FA8): performMove/performCopy self-containment
  guards (folder-into-itself / descendant = catastrophic
  self-wipe prevention) · reallyApply honors importDisk
  {applied, failed} (partial restores never toast "restored")
  · clearSearch refresh() · mdInline javascript:/data: scheme
  stripping · import toast honesty · object-URL revoke on
  preview close · dead updateSortIndicators stub removed.

  ROUND 3 (FB1–FB6): mdInline escape→linkify ORDER restored
  (FA5 regression — links render again, schemes still
  stripped) · clearSearch/navigate redundant-fetch elimination
  · empty-disk restore = success · one toast per guard pass
  · FA8 leftover comment · search status-bar match count.

  ROUNDS 4–6 (FC–FF): follow-up compliance pass — regression
  repairs on the FA/FB batches, toast/i18n wording, CSS
  polish (spacer + danger-arm), status-bar and preview
  cleanups. All verified by paste-back.

  ROUND 7 (FG1–FG5) — FINAL PASS, CLOSED:
  · FG-DOM: ensureRecentsSection() now inserts the Recents
    section AFTER #list-header instead of at host.firstChild —
    root view order is COLUMN HEADER → Recents → entries
    (was: Recents above the header). Subfolders unaffected
    (Recents hidden there). Pure DOM-order fix, no
    showRecents/hideRecents logic change.
  · Remaining FG items: minor a11y (search-row keyboard
    access), toast offset in iframe context, binary copy
    note — all recorded as standing limits, no action.

  STATUS: Files app audit trail CLOSED. The queued "deeper
  glue audit" (blob-sync limits) is RESOLVED AS DOCUMENTED:
  the blob model's limits (quota on very large disks,
  conflict surface at app open/boot-flush) are STANDING
  DOCUMENTED LIMITS in Part V §Files — not defects, not
  open items. The per-entry model remains a backlog upgrade
  (Part XI).

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
  Weather    High — taskbar widget + app sync coupling (NEXT)
  Mood       High — deepest data model, stats engine
  Time       Medium — multiple views
  Calendar   Medium — post-Wave-3 secondary pass (F6 + minor)
  Quote      Medium — computed totals, numbering logic
  Storage    Medium — cascade tombstones, corrupt rescue
  Habits     Medium — 3-view app, streak logic
  Prompter   Low — 3 cosmetic patches pending
  Characters Low — registry + model pending (also core #16)
  (Files REMOVED from this queue — all audit rounds closed,
  see §23.)

──────────────────────────────
26. OPEN DECISION SUMMARY (USER RESPONSE NEEDED)
──────────────────────────────
  ⊗ #21 (To-Do) — priority keywords: implement/strike/defer?
  ⊗ #34/#44 (Kanban/Notes) — SUPERSEDED by R23 (versions
     are user-owned); no action needed unless you want the
     cosmetic cleanup noted anyway.
  ⊗ #41 (Notes) — approve 3 confirm() → themed dialog?
  ⊗ #35 (Kanban) — clean up unused keys + stale comment?
  ⊗ #S5 (Shell) — aurora label: Σέλας or Αυγή?
  ⊗ #16 (Core) — characters storage key/model: confirm at
     the scheduled characters audit.
  △ #S1 — paste ICONS block back for verification.
  △ #S2/#S3 — confirm the 0.35.00 second-pass audit marks
     are accurate against live files (reconciliation above).
  △ #19 (To-Do) — undo-across-sync: tackle now or defer?
  ✓ CLOSED — H/#27 (version ledger reconciliation): resolved
     by POLICY, not patch — R23 (versioning is user-owned;
     version/cache-buster observations are out of audit
     scope). See §27.

──────────────────────────────
27. VERSION LEDGER RECONCILIATION — CLOSED (R23)
──────────────────────────────
  Original concern: mixed labels in recent history (habits
  waves 0.34.00/0.35.00, files glue 0.34.07, Files app
  0.35.00, delivered shell.js read 0.34.08; index.html
  ?v= drift 0.34.05/0.34.03 vs 0.35.00; sw.js CACHE_VERSION
  0.35.06 vs APP_VERSION 0.35.07).
  RESOLUTION: standing policy — version numbers and
  cache-busters are USER-OWNED (R23). Mismatches are expected
  mid-cycle, resolved at deploy time by the GitHub Action,
  and are OUT OF AUDIT SCOPE. No git-log reconciliation or
  assistant action required. Do not reopen.

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
  · Per-entry file sync for OrosFS (replace blob model —
    the documented standing limit is tracked here, not as
    an audit item).
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
  v0.32.14–v0.32.15 — Quote ICONS entry; system-wide
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
  
  ## orOS Notes app — v0.35.00 sync & stability audit
Date: 2026-09-18 · Files: notes.js, notes.css

### Context
Reported: "notes no longer sync between devices."
Audit covered notes.html/notes.css/notes.js against sync.js (v0.9.1).

### Root-cause hypothesis (sync)
registerNotesSlice() ran ONCE at script-boot with no retry — if
window.parent.orosSync was not yet initialized at that moment,
the slice never registered, silently, forever. Most likely culprit
for the outage. Fixed with a bounded retry loop (50 × 100ms = 5s),
with explicit console success/failure markers.
NOTE: if sync still fails after this fix with "registered
successfully" in the log, the problem is inside the engine/baseline
state — collect oros-slices / oros-sync-baselines / oros-sync-dirty
from BOTH devices before further patching. DO NOT GUESS.

### Patches applied (OLD → NEW, copy-paste format)
1. notes.js registerNotesSlice(): retry loop + console diagnostics.
2. notes.js loadData(): migration fills p.pinned (bool) and
   sanitizes p.labels arrays on legacy/merged data. The merge
   engine drops pages/labels whose `nb` refs are unknown, so
   migration guarantees field shape BEFORE sync merges.
3. notes.js movePage(): now uses kidsOf() (pinned-aware sort)
   instead of siblingListByParent() — tree visuals and swap
   arithmetic agree.
4. notes.js backlinkPages(): case-insensitive match, parity with
   pageByTitle()'s case-insensitive title lookup.
5. notes.js nb-selector contextmenu: reuses #node-menu /
   .node-menu-item / .node-menu-separator design-system classes;
   inline cssText styling removed.
6. notes.js deleteLabel(): new i18n keys labels.deleted ("Label
   deleted" / "Η ετικέτα διαγράφηκε") — was showing the DETACH
   message (and an intermediate fix mistakenly used toast.deleted
   "page deleted"; superseded).
7. notes.css header comment updated to v0.35.00 (doc drift).

### Retracted
- Claimed duplicate `padding` in #nb-selector: DOES NOT EXIST in
  the file (padding + intentional padding-right: 32px for the
  dropdown arrow). Lesson re-confirmed: verify OLD blocks against
  the shipped file before delivering patches.

### Known/pending (not blocking)
- notes.js APP_VERSION = "0.17.0" and __notesDebug.version are
  stale vs stratum 0.35.00. Left as-is: versioning policy says
  shell.js is the single source of truth — decide deliberately.
- localStorage keys touched: oros-notes-data (shape unchanged,
  additive fields only), oros-sync-baselines (via engine push).
  No data-loss risk: all patches are additive-field or UI-level.

### Verification checklist (both devices)
[ ] Boot: "[notes] Slice registered successfully" in console
[ ] Boot: "notes.js v0.35.00 boot" line
[ ] Edit on device A → arrives on device B (≤ interval)
[ ] Baselines contain "notes" entry after first push
[ ] Pinned page + Move up/down behaves
[ ] [[lowercase]] backlink appears on target page
[ ] Label delete toast says "Η ετικέτα διαγράφηκε" / "Label deleted"

## orOS sync — engine audit closure (post v0.35.03)
Files audited in full: notes.js, notes.css, shell.js, sw.js, apps.json, sync.js.

### Final diagnosis — "notes no longer sync"
ROOT CAUSE: version-skew merge warfare between devices. One device
(stale cached notes.js, pre-notebooks schema, DATA_VER < 3 — writes
lack nb/notebooks/pinned) pushes schema-old notes data; the updated
device's mergeNotesStates FILTERS OUT pages without valid nb refs
(notebookIdsInMerge map lookup on undefined). Result on the updated
device: merged == local → 0 applied (silent no-op, "nothing new"),
yet merged != remote → cloudStale → dirty → repush. The stale device
rewrites/strips unknown fields → pushes nb-less data again → loop.
Symptom: notes appear permanently unsynced; all other apps fine.

### What was RULED OUT (verified, not guessed)
- Registration race in notes.js: covered by retry patch (kept as
  defense-in-depth); shell loads orosSync before any app iframe.
- Stale SW bundles ONLINE: ruled out — sw.js navigate branch is
  network-first; iframes are navigations.
- sync.js engine v0.9.1: clean for merge-capable slices. Baselines
  (v0.8.1 + #S2-fix), park/carry/flush, divergence guard (mergeless
  only), push guard, 409 paths, vault, wipe: all verified sound.
- Applied and KEPT: notes.js patches 1-7 (registration retry,
  loadData migration/sanitization incl. pinned+labels coercion,
  kidsOf move sort, case-insensitive backlinks, labels.deleted i18n,
  nb-menu design-system reuse), CSS header v0.35.03.
- RETRACTED (never apply): openApp/refreshRunningApp cache-bust
  patch — would break the SW offline navigate fallback (iframe would
  load ./index.html inside the Notes window) with zero online gain.

### Remaining work (blocking closure)
1. mergeNotesStates must SALVAGE pages with unknown/missing nb
   (assign to default notebook) instead of dropping them — the
   loadData migration (Patch 2) alone does not cover the merge
   input path. Exact OLD/NEW patch pending current function text.
2. Per-device verification: boot log shows notes.js v0.35.03 AND
   oros-notes-data has ver:3 + nb on pages, on BOTH devices.

## [Calendar] v0.2.0 — Wave 3 Final Verification Pass (audit CLOSED)

### Paste-back verification (R19) — all three files confirmed
All Wave 3 patches verified PRESENT in the pasted calendar.js /
calendar.css / index.html:
- ✅ Horizon prune: checkReminders walks today+8d and STOPS past
  it (multi-day presets 1d/3d/5d fire BEFORE the event day,
  not on it) + STOP-the-walk optimization (ascending order).
- ✅ Dynamic MAX_STEPS (D=40000 / W=5200 / M,Y=600) — daily
  series older than ~17 months no longer vanish.
- ✅ Corruption guard in eachOccurrence (occYmd falsy → stop).
- ✅ Series chooser: "cancel" event listener + null-vs-"all"
  distinction — Esc/backdrop = pure cancel, never "Edit series".
- ✅ Undo stacks (lastMoved/lastDeleted/lastExdate) cleared in
  setFromSync — undo can never resurrect a sync-overwritten
  state.
- ✅ renderChips() refresh on label color change (main view +
  dots update live while the manage dialog stays open).
- ✅ tp-menu open/close transition (opacity + translate, hidden
  pointer-events).
- ✅ CSS coverage: #ser-dlg dialog, #ev-until-row show/hide
  contract, .ev-form select + input[type=date] skinned
  (color-scheme: dark), [hidden] authority guard intact.

### Confirmed-OK design findings (no action — documented)
- reseedSeedNames mtime-0 seeds: merge-inert by design; user
  edit (fresh mtime) detaches permanently. Re-translation on
  language change = FUTURE feature, not a bug.
- exdates 100-cap in eachOccurrence: intentional corruption
  bound (sanitizer dedupes+sorts anyway).
- makeTP document-level listeners: negligible in a
  single-dialog app; accepted.
- del-dlg/ser-dlg: outside-click + Esc verified against R14.

### Open (cosmetic, non-blocking)
- F6: .cal-cell.drop-target still carries transform:scale(1.02)
  — one-line CSS simplification recommended before commit
  (inset shadow instead of scale; no grid overflow on small
  screens).
- F8 variant (console.warn when exdateMaster finds no master):
  optional diagnostic; saveState NOT needed (both call sites
  already save).

### Pre-completion status (R18 gates)
- [x] Perfect sync (no data loss): recur/remindMin whitelisted
      in BOTH sanitizeEvent and mergeSanitizeEv; exdates sorted
      + deduped → deterministic stringify tie-break; override
      clones + exdates travel via standard entity merge.
- [x] Full local export: events carry recur + remindMin inside
      the standard slice funnel (collectPayload/applyPayload).
- [x] Offline-first: zero network dependencies; reminder
      engines (shell + in-app) are device-local.
- [x] Mobile-first: 44px targets throughout, small-screen cell
      sizing, no drag dependence (DnD is desktop-only bonus).

READY FOR COMMIT after F6 (optional one-liner).
   
   ### v0.35.04 — notes.js mergeNotesStates: nb salvage (FINAL sync fix)
ROOT CAUSE CONFIRMED against live mergeNotesStates source: pages/
labels arriving from a schema-old peer (pre-notebooks, DATA_VER < 3,
no nb field) were DROPPED by the merge filters
(notebookIdsInMerge[l.nb] / [p.nb] === undefined). Result: every
pull produced merged == local → 0 applied (silent no-op), while
merged != remote → cloudStale → dirty → repush → loop. Symptom:
"notes no longer sync"; all other apps unaffected (no schema
migration during this period).

FIX: merge now ADOPTS nb-less entries into the fallback notebook
(deterministic pick: lowest pos, then id — locale-independent)
instead of dropping them. Degenerate no-notebook case synthesizes
a stable "nb-default" notebook (invariant: always >= 1). Also
coerces p.pinned to boolean inside the merge (parity with
normalizeState fix).

ACCEPTED LIMIT: while a stale device keeps winning LWW on a page,
that page's notebook may relocate to the fallback notebook until
the device runs 0.35.03+. Position in tree is the only casualty;
content is never lost.

Verified chain: notes.js (retry + migration + merge salvage) ×
shell.js × sw.js × apps.json × sync.js v0.9.1 (audited clean).
Engine untouched — fix is app-side merge semantics.

## [Kernel Lock re-audit — shell.js] 2026-09-18 · shell.js
### Fixed (findings from shell.js full re-audit, v0.35.07)
- #2 maybeAutoExport: honest quota failure — writeSnapshots now returns
  boolean; failed snapshot storage reports an ERROR toast instead of a
  false "saved" (new i18n key sync.err.snapshot.quota, inline bilingual
  fallback until translations.js batch).
- #3 wxFetch: failed fetch no longer locks the tray chip for 30 min —
  short 2-min retry cooldown (WX_RETRY_MS) written only on failure.
- #4 checkVersionToast/scToast: local `t` renamed (vt/tt) — DOM variable
  no longer shadows window.t (preventive, no behavior change).
- #6 openApp/returnToDesktop: menu button tooltip painted immediately
  (title attribute set at transition, not only via applyLang).
### Files touched
- shell.js (patches 1–6, OLD→NEW copy-paste blocks)
### Deferred / open (tracked in audit registry)
- #1 factoryResetPending vs OrosFS IDB-fallback eager connection —
  pending fs.js review (potential factory-reset survival bug).
- #5 alarmsWrite/calRemFiredAdd silent write failures — policy pending.
- #7 fdSliceSet app-closed echo — pending sync.js divergence-guard
  cross-check. Bible §6 version drift (0.35.00 vs actual 0.35.07) noted.
  
  ## [Kernel Lock re-audit — sync.js] 2026-09-18 · sync.js + shell.js
### Verified (patches from prior audit — CONFIRMED PRESENT)
- F1 dirtyGen race guard: markDirty gen counter + dirtyGenAtCollect
  capture in push() + conditional clearDirty — fully wired.
- v0.9.1 contentDownload 409 passthrough; v0.8.1 baselineExists
  discriminator; #S2 baseline-from-payload; SY-3 pwEpoch in meta;
  v0.9.2 fresh read-modify-write carry in applyPayload.
- shell.js #S2/#S3/#S1 clean; importDisk consumers absent from
  shell.js (F7 impact = files.js only, pending).
### Fixed (new findings S-A..S-F)
- S-A ensureCloudReadable: non-409 status errors no longer launder
  as "empty cloud" — inconclusive checks now REJECT the push
  (Trap-3 hardening). [SP1]
- S-B pull() in-flight guards: pullInFlight flag + refusal while
  push/reconcile in flight — manual pull can no longer LWW-clobber
  a racing push's freshly-uploaded state. [SP2]
- S-C proxy set() strict write: quota failures THROW → applyPayload
  skips baseline recording → stale-local-over-cloud push path
  eliminated (writeJsonStrict for proxies only). [SP3]
- S-D refreshAccessToken memoized (single in-flight refresh) —
  concurrent API legs can no longer burn a rotating token. [SP4]
- S-E debounce re-arms (1s) when the engine is busy instead of
  silently consuming the raced edit's only scheduled uploader. [SP5]
- S-F shell.js refreshFilesDiskCache: changed disk content now
  re-marks dirty — closes the push-vs-cache-refresh race window. [SP6]
### Open (tracked)
- S decryptBlob pwEpoch mismatch: console.warn only (informational,
  standing limit — unchanged).
- importData unconditional markDirty on applied===0: benign noise.

## [Kernel Lock re-audit — fs.js] 2026-09-18 · fs.js
### Verified (prior findings — CONFIRMED PRESENT / RESOLVED)
- #1 factory-reset vs IDB fallback: RESOLVED — idbOpen() is lazy
  (only real ops open it; boot never does on the IDB path) and
  carries an onversionchange release handler. Closed permanently.
- F6 opfsMv: dir→file dual probe with rethrow present (silent
  failure fixed) — refinement applied as FP2 below.
- F7 importDisk: {applied, failed} return type + per-entry failure
  collection present. No fs.js-internal consumers break; shell.js
  consumes importDisk nowhere. Files-app consumers pending review.
### Fixed (new findings)
- FP1 importDisk: synchronous dataUrlToBlob throw on corrupt entries
  aborted the WHOLE import chain (valid entries after the corrupt
  one silently skipped, raw rejection to caller) — now routed
  through the per-entry failure collector.
- FP2 opfsMv: probe failures and mid-tree copy/remove failures are
  now separated (probe-scoped rejection handler) — a disk error is
  no longer misreported as "source doesn't exist".
### Recorded (no action)
- importDisk does not preserve original mtimes (writes Date.now()) —
  fidelity note, candidate future polish.
- mv copy-then-delete is non-atomic: worst case a duplicate remains
  on partial failure (never a loss). Standing limit.
- Double markDirty on some paths (public wrapper + driver #16) —
  harmless (flag, not counter).
  
  ## [Kernel Lock re-audit — translations.js] 2026-09-18 · translations.js
### Verified (prior finding F9 — CONFIRMED PRESENT)
- F9 sc.snapshot: keys present in EN + EL ("Take snapshot now" /
  "Δημιουργία στιγμιότυπου τώρα"), no shell.js usage issues.
### Added (new key for F9 batch)
- sync.err.snapshot.quota: permanent i18n entry replacing the
  inline bilingual fallback from shell.js Patch 1. [TP1]
### Status
- All shell.js/sync.js referenced keys now present in translations.js.
- Shell.js micro-patch (remove inline fallback) pending your
  confirmation that TP1 is applied.
  
  ### [Kernel Lock — shell.js follow-up] 2026-09-18 · shell.js
- maybeAutoExport: inline bilingual fallback for
  sync.err.snapshot.quota REMOVED — key now permanently in
  translations.js (TP1). Toast text sourced via window.t() only.
  
  ## [Kernel Lock re-audit — index.html] 2026-09-18 · index.html
### Verified
- All statically-referenced DOM IDs used by shell.js present;
  toasts/sync-dot/weather chip correctly runtime-created.
- Script load order (splash → broker → translations → sync → fs →
  shell) correct; skip-splash writer/consumer pair consistent.
### Fixed
- IP1 splash error handler: localStorage read wrapped in try/catch
  — blocked-storage throws can no longer recurse the window error
  listener.
- IP2 splash: boot errors now hold the splash for a 45s message
  window (hide deferral) instead of being erased ~700ms after load
  by the normal fade — a failed boot no longer ends in a blank page.
### Recorded (no action)
- Cache-buster ?v=0.35.06 lags APP_VERSION 0.35.07 — folded into
  open item H/#27 (version ledger reconciliation). Deployment note:
  this session's patches (shell/sync/fs/translations) REQUIRE a
  version bump via the Action when shipped.
- <html lang="en"> static — minor a11y note if applyLang doesn't
  update it (unverified; cosmetic).
  
  ## [Kernel Lock re-audit — sw.js] 2026-09-18 · sw.js
### Verified (prior finding F8 — CONFIRMED PRESENT)
- F8 apps.json: NETWORK-FIRST strategy present (S1 FIX comment +
  implementation). Precache per-URL add (D1 fix), navigate 200-only
  cache, waitUntil guards, origin guard — all confirmed present.
### Fixed
- SW-I activate: added 30s timeout guard around cache cleanup →
  clients.claim() won't be blocked indefinitely by slow cache
  deletion in extreme conditions.
### Recorded (no action)
- CACHE_VERSION string normalization note: comment added to
  document expected format independence (standing watch).
- CACHE_VERSION = "oros-v0.35.06" vs APP_VERSION = "0.35.07" —
  folded into open item H/#27 (version ledger reconciliation).
- QUOTA growth risk in RUNTIME_CACHE (no max-size enforcement)
  — standing limit, monitor during testing.
  
  ## [Kernel Lock re-audit — apps.json] 2026-09-18 · apps.json
### Verified — CLEAN, no patches required
- All 13 apps (todo, kanban, notes, weather, mood, time, calendar,
  quote, prompter, characters, storage, habits, files) fully
  cross-referenced against sw.js PRECACHE_URLS, shell.js ICONS map,
  and translations.js app.* / category.* keys — zero mismatches.
- Writer: precached in SW but absent from apps.json — CONSISTENT
  with the forward-looking staging strategy (Bible).
- Valid JSON, no duplicates, no missing fields.
### Recorded (design note, no action)
- Storage categorized as "Productivity" — arguably "Utilities"
  (space analytics). Cosmetic classification, owner's call.
  
  ## [Kernel Lock re-audit — files.js] 2026-09-18 · files.js
### Verified (prior findings — CONFIRMED PRESENT / RESOLVED)
- F2: No duplicate ~700-line block — cleanup confirmed (section
  headers appear once, dead stubs removed).
- F3: renderImagePreview handles Blob/ArrayBuffer/base64 verbatim,
    with 60s sweep-revoke (#FA2 FIX). Minor leak persists — see FA7.
- F4: recursive search uses 250ms debounce + renderToken +
    sequential chain, caps at SEARCH_CAP (#23 FIX).
- #8 FIX: wipe:true in reallyApply ensures "Take cloud version"
    truly replaces local disk.
- Shell §9f contract: orosFilesDisk exposes correct keys + boot
    consumes __orosFilesTakePending post-render (#13 FIX).
- F7: importDisk consumers reviewed — single consumer (reallyApply)
    found ignoring {applied, failed} return value (FA3 below).
### Critical / High Fixes
- FA1 performMove: added guard against moving a folder into itself
    or into one of its descendants — prevents catastrophic self-
    wipe (copy-then-delete scenario). [patch]
- FA2 performCopy: added identical self-containment guards to
    prevent infinite recursion when copying a folder into itself.
    [patch]
- FA3 reallyApply: honors importDisk {applied, failed} contract.
    Partial/zero-success restores do NOT mark clean or toast
    "restored" — next sync will retry, preventing silent cloud
    data loss. [patch]
### Medium / Low Fixes
- FA4 clearSearch: replaced stale re-render with full refresh()
    to restore proper lastEntries and status bar (fixes "0 items"
    bug on search clear). [patch]
- FA5 mdToHtml: strips javascript: and data: URLs from markdown
    links before rendering — prevents same-origin XSS in preview.
    [patch]
- FA6 importFilesList: honest toast messaging — FS failures no
    longer reported as "skipped (kept both)". [patch]
- FA7 renderImagePreview: revoke object URL immediately on preview
    close, not just after 60s timeout. [patch]
- FA8 Dead code: removed empty updateSortIndicators stub (real
    implementation exists later in file). [deletion]
### Recorded (no action)
- Search does not early-exit after SEARCH_CAP hits (perf only).
- Recents-click selection uses setTimeout(150ms) race guard.
- Copy content on binary files returns garbage (could hide non-text
    extensions).
- Clock skew between devices may affect snap.ts > syncMeta.ts check.
- Search-result rows lack keyboard accessibility.
- Minor mixed tabs/spaces in STRINGS object.

## [Files app re-audit] 2026-09-18 · files.js + files.css
### Verified (prior findings FA1-FA8)
- FA1-FA2 performMove/performCopy guards: present and functional.
- FA3 reallyApply: honored {applied, failed} — but the delivery
  incorrectly rejected empty-disk restores (total > 0 guard). Fixed.
- FA4 clearSearch: replaced stale re-render with refresh() — but
  caused redundant fetches on navigation. Fixed.
- FA5 mdInline: security sanitize applied BUT reversed the escape→
  linkify order, breaking ALL markdown links. Critical regression.
- FA6-FA7 import toast + image revoke: confirmed present.
- FA8 dead stub removed: but leftover comment remained.
### Fixed (regressions + secondary issues)
- FB1 mdInline: correct escape→linkify order restored; dangerous
  schemes (javascript:, data:) still stripped. Links render.
- FB2 clearSearch/navigate: eliminate redundant fetches; only
  fetch when search was actually active.
- FB3 reallyApply: empty-disk (applied=0, failed=0) now correctly
  marked as success.
- FB4 performMove: one toast per guard pass instead of stack.
- FB5 leftover FA8 comment removed.
- FB6 runSearch: status bar shows match count (was hardcoded 0).
### Optional CSS fixes
- OP1 .spacer: toolbar spacer functionality restored; removed
  dead .bar-spacer rule.
- OP2 .danger-arm: delete button visual arm added (border color
  when selection > 0).
### Recorded (no action)
- Toast top offset 48px targets OS shell — may need adjustment
  within app iframe context.
- Cache-buster lag (?v=0.35.06 vs APP_VERSION 0.35.07) — tracked
  in H/#27.
- Search results lack dblclick-open + tabIndex — standing a11y
  item.
  
  ## [Files app] Root view DOM order fix — Recents below the
  column header
  Date: 2026-09-19 · Files: files.js

  ### Fixed
  - ensureRecentsSection(): the section was inserted at
    host.firstChild, which placed it ABOVE the list column
    header (Name/Size/Date) in the root view. It now inserts
    immediately AFTER #list-header (fallback: host.firstChild
    when no header exists — defensive edge case).
  - Root view order is now: column header → "Recent" section →
    entries. Subfolders are unaffected (Recents is hidden
    there).
  - No change to showRecents/hideRecents logic — that is
    CSS-display based, position-independent.

  ### Delivery
  - OLD/NEW replacement pair (R1), files.js ensureRecentsSection().
  - R19 paste-back verification: pending user confirmation.
  - This is the closing fix of the Files audit trail (FG) —
    Part X §23 records the full sequence.

  ## [BIBLE] 2026-09-19 — Registry sync: R23 + Files audit closure
  Files touched: OROS_BIBLE.md ONLY (no code files).

  ### Added / Changed
  - R23 (versioning is USER-OWNED) registered in the Part I rule
    registry — closes open item H/#27 as a standing POLICY,
    not a code fix. #34/#44 (Kanban/Notes ?v= discrepancies)
    superseded by the same rule.
  - Part X §23: Files audit ledger consolidated and CLOSED
    (29-item round at 0.34.08, FA1–FA8, FB1–FB6, follow-up
    compliance rounds, final FG pass incl. the DOM-order fix).
    The queued "deeper glue audit" (blob-sync limits) resolved
    AS DOCUMENTED: the blob-model limits (quota on very large
    disks, conflict surface at app open/boot-flush) are standing
    documented limits in Part V — not defects, not open items.
    Files REMOVED from the §25 audit queue.
  - Part III §6/§7: audit posture + Files registry row updated
    (deep re-audit CLOSED).
  - Part III §8: localStorage registry extended with the
    Files-app device-local keys (oros-files-disk-meta sync-pill
    state, oros-files-recents journal, oros-files-storage-cache
    5min TTL).
  - Part V: Kernel-Lock hardening SP1–SP6 documented in the
    sync engine section (registry parity with the changelog
    entries above).
  - Part VIII: Files-app root view DOM-order contract recorded
    (column header FIRST, then Recents, then entries).
  - Document-map headers updated R1–R22 → R1–R23.

  ### Deferred
  - Files per-entry sync model — remains backlog (Part XI).
  - Search-row keyboard accessibility, iframe toast offset —
    recorded as standing limits in §23, no action planned.

  ### Rule: Versioning is USER-OWNED (closes #27 as a standing rule)

Cache-buster / version numbers are NOT the assistant's responsibility.
The user manages all versioning (APP_VERSION, ?v= parameters, GitHub Action
bumps) personally. During audits and fixes:

- Never propose, apply, or "fix" version numbers or ?v= parameters.
- Never flag cache-buster / APP_VERSION mismatches as findings — they are
  expected mid-cycle and resolved by the user at deploy time.
- Version references in code comments or logs are informational only.

Historical note: finding H/#27 (0.35.06 vs 0.35.07 cache-buster lag) was
resolved by this policy — not by a code patch. All future "version mismatch"
observations are out of audit scope by default. (Rule text ALSO lives in
Part I as R23 — the registry entry is the normative pointer; this block
is retained here verbatim as the historical closure record.)

## Cycle app — Wave 1 (initial release)

### Added
- New app **Cycle** (Lifestyle): menstrual cycle tracking — periods
  (start/end/flow), symptoms (preset + custom chips), pain-relief
  intake log (timestamped per day), free-text daily notes.
- Three views: Calendar (month grid, period days shaded by flow),
  Days (searchable log), Insights (avg cycle / avg period length,
  symptom frequency, pain-relief counts).
- Full sync slice `oros-cycle-data` via `registerSlice("cycle", ...)`
  with deterministic merge (union by id, mtime LWW, tombstones).

### Architecture (decisions locked for future waves)
- **Deterministic day ids** (`d-YYYY-MM-DD`): two devices logging
  the same calendar day converge instead of duplicating.
- **Whole-day LWW** merge granularity (a day is the atomic unit,
  like a period) — med-intake deletes are day edits.
- **Absence is never imputed**: an unlogged day is UNKNOWN, not
  "no period" (mood-thread honesty rule applies).
- Flow is a PERIOD-level property in Wave 1 (day-level flow =
  candidate future upgrade).

### Files
- NEW: `cycle/cycle.html`, `cycle/cycle.css`, `cycle/cycle.js`
- UPDATED: `apps.json`, `sw.js` (precache), `shell.js` (ICONS),
  `translations.js` (`app.cycle`)

### Under consideration (later waves — do NOT promise)
- Wave 2: prediction engine (next period / ovulation estimate)
  WITH medical disclaimer string shipped together.
- Wave 2: Mood ↔ Cycle cross-insights (shared patterns view).
- Wave 3: PDF export for the doctor (NotoSans Greek path exists
  from mood), symptom trend charts, reminders.
  
  ### Styling Rule — Single OS Skin (added with Contacts wave)
- ALL orOS apps inherit the active OS skin via inheritPalette() +
  watchPalette(). No per-app accent palettes, ever.
- The shell's CSS variables (--accent etc.) are the ONLY styling
  truth; apps may not override them locally.
- Existing exceptions (Notes custom accent, Weather custom accent)
  are DEPRECATED and scheduled for unification in a core cleanup
  wave — new apps (Contacts onwards) ship with no local accent.
- The LABEL_PALETTE (8 fixed colors) is unaffected: label colors
  are DATA, not skin.
  
  ## v0.3.2 — Post-audit re-review fixes
Files: calendar.js, calendar.css, index.html

### Fixed
- Search-jump in Agenda view: result click now rewinds the agenda
  window (agendaStart = event's Monday) instead of doing nothing.
- Deleted-all-labels no longer reseeds Personal/Work/Family on the
  next load or sync. Seeding now happens ONLY when the "labels"
  key is absent (fresh install / v0.1 blob). Empty array is
  honored as a deliberate empty label set.
- Span hint (multi-day edit warning) re-appears when the Repeat
  select returns to "None" during the same dialog session.
- "Today" button now clears the search overlay (searchQ wiped
  before the single selectDay paint).
- Week nav: selection carries to the same weekday (7-day shift,
  clamped to the visible week) instead of snapping to Monday.
- Agenda "Show more" hidden when the current window is empty.

### Cleanup (dead code)
- Removed unused "tp-commit" CustomEvent dispatch in makeTP().
- Removed never-true "_suppress" flag from __orosSyncApi.
- Removed unreachable `if (!occYmd) return;` guard in
  eachOccurrence (ymd() always returns a non-empty string).

### Improved
- Single-paint doctrine enforced: navStep (week/month), Today,
  moveEventToDate, undoMove now render exactly once per action
  via selectDay/followView instead of double renderAll.
- ICS export now includes VALARM blocks for reminders
  (TRIGGER:-PT{n}M, ACTION:DISPLAY).
- Disabled time inputs (All-day ticked) visually greyed out.
- Start-time field gets a bilingual placeholder (ev.ph.start).
- All five dialogs wired with aria-labelledby to their titles.

## orOS v0.35.06 — 2024-XX-XX (Contacts Wave 1)

### New Applications
- **Contacts** — Full alternative to Google Contacts (contacts/)
  - Structured name fields (given/middle/family/nickname)
  - Phones, emails, addresses, websites, IM (multi-field rows)
  - Events: birthday/anniversary/custom with yearless support (--MM-DD)
  - Labels (color-coded, filterable, manage dialog)
  - Starred favorites, notes
  - vCard (.vcf) import/export (RFC 6350 subset)
  - Duplicate detection ready (mergeContacts in sync)
  - Feed to Calendar birthdays (Wave 2)
  - Dropbox sync via registerSlice (merge-capable, carry-forward)

### Category Reorganization
- Moved: Weather/Time/Files → **Accessories**
- Created: **Office** category (To-Do, Kanban, Notes, Calendar, Quote, Contacts)
- Created: **Creativity** category (Prompter, Characters)
- Kept: **Personal** (Mood, Habits, Cycle)
- Removed: Productivity/Utilities/Lifestyle legacy categories

### Infrastructure
- Single OS Skin rule enforced (no per-app accent palettes)
- Updated translations keys for new categories
- Added contacts icon to shell.js ICONS map
- Updated sw.js PRECACHE for contacts/ folder

### Known Limitations (Wave 2 backlog)
- Relations (cross-contact links) — pending
- Birthday feed to Calendar reminders — pending
- Avatar images — pending (Wave 2 with size limit)
- Transliteration search — pending

BIBLE-1 — §6 Current State (μετρητής apps + κατηγορίες):

OLD:
  Apps        : 13 in apps.json — see registry §7.
NEW:
  Apps        : 15 in apps.json (Contacts + Cycle added) —
                see registry §7. Categories reorganized
                Linux-style: Accessories / Office /
                Creativity / Personal.
				
				BIBLE-2 — §7 App Registry (προσθήκη δύο γραμμών, αμέσως μετά τη γραμμή Files):

OLD:
  Files     | files/      | oros-files-data (view  | 1   | files-disk slice:      | 29-item audit DONE;
            |             | prefs only) +         |     | blob snapshot via      | deep re-audit FA1–FG5
            |             | "files-disk" slice    |     | shell §9f (Part V)     | ALL CLOSED (§23)
NEW:
  Files     | files/      | oros-files-data (view  | 1   | files-disk slice:      | 29-item audit DONE;
            |             | prefs only) +         |     | blob snapshot via      | deep re-audit FA1–FG5
            |             | "files-disk" slice    |     | shell §9f (Part V)     | ALL CLOSED (§23)
  Contacts  | contacts/   | oros-contacts-data    | 1   | union-by-id, mtime     | QUEUED (Wave 1 shipped;
            |             |                        |     | LWW, tombstones        | stabilization pass
            |             |                        |     | (mergeContacts)         | this session)
  Cycle     | cycle/      | oros-cycle-data        | 1   | day-entity union,      | QUEUED (Wave 1 shipped)
            |             |                        |     | whole-day LWW, tombs   |
			
			BIBLE-3 — §8 File Tree (προσθήκη directories):

OLD:
  todo/ kanban/ notes/ weather/ mood/ time/ calendar/ quote/
    prompter/ storage/ habits/ files/ characters/
NEW:
  todo/ kanban/ notes/ weather/ mood/ time/ calendar/ quote/
    prompter/ storage/ habits/ files/ characters/ contacts/
    cycle/
	
	BIBLE-4 — §25 Queued Audits (προσθήκη πριν το Weather):

OLD:
  Weather    High — taskbar widget + app sync coupling (NEXT)
NEW:
  Contacts   Medium — Wave 1 shipped; stabilization pass
             pending shell.js verification; Wave 2 (relations,
             dedup UI, Calendar reminder feed, avatars) queued
  Cycle      Medium — Wave 1 shipped; Wave 2 (prediction engine
             + medical disclaimer) queued
  Weather    High — taskbar widget + app sync coupling (NEXT)
  
  BIBLE-5 — Part XI: το Cycle αναφέρεται στα «NEW APPS (planned, not started)» ενώ έχει ήδη-shipped — πρόταση: διαγραφή του bullet · Cycle (women's health: cycle, symptoms, meds, irregularities). από τα NEW APPS, και προσθήκη στο τέλος της λίστας APPS (μετά το To-Do bullet):

NEW (append):
  · Cycle Wave 2: prediction engine (next period / ovulation)
    WITH medical disclaimer; Mood ↔ Cycle cross-insights.
  · Cycle Wave 3: PDF export (NotoSans Greek path exists from
    mood), symptom trend charts, reminders.

Η changelog entry (BIBLE-6) — στο ΚΑΤΩ μέρος του Part XIII
OLD:
──────────────────────────────
*Designed by Christos Koulaxizis — koulaxizis.gr*
NEW:
## [Contacts] Wave 1 — integration & stabilization — 2026-09-19

### Fixed
- shell.js ICONS["contacts"]: hard-coded #6d4aff stroke →
  currentColor + explicit width/height attrs. Single OS Skin
  compliance — the icon now follows the active skin instead of
  rendering purple in every palette (Standing Styling Rule).
- fmtEvtDate: TypeError from calling a non-existent String .pad()
  → replaced with direct zero-pad concatenation.

### Removed
- Dead pad() helper left unused by the fmtEvtDate fix.

### Cleanup
- apps.json: Contacts/Cycle entry indentation normalized to the
  project 2-space standard (tabs → spaces).

### Process
- sw.js CACHE_VERSION deliberately NOT touched — versioning is
  user-owned (R23); the GitHub Action stamps it at release.

### Files touched
- shell.js, apps.json, OROS_BIBLE.md (this entry + BIBLE-1–5
  registry sync).

### Deferred ("under consideration")
- Wave 2 per the Wave 1 entry: relations, duplicate-merge UI,
  Calendar birthday reminder feed, avatars, transliteration
  search.

──────────────────────────────
## [Contacts] Wave 1 — integration & stabilization — 2026-09-19

### Fixed (verified against live shell.js + delivered contacts.js)
- shell.js ICONS["contacts"]: hard-coded #6d4aff stroke →
  currentColor + explicit width/height attrs (Single OS Skin
  compliance — icon follows the active skin). VERIFIED PRESENT
  in live shell.js; no further patch needed.
- contacts.js fmtEvtDate: TypeError from calling non-existent
  String .pad() → replaced with direct zero-pad concatenation
  (inside the delivered Wave 1 full file).
- apps.json: Contacts/Cycle entry indentation normalized to the
  project 2-space standard (tabs → spaces).

### Removed
- Dead pad() helper left unused by the fmtEvtDate fix (contacts.js).

### Process
- sw.js CACHE_VERSION deliberately NOT touched — versioning is
  user-owned (R23); the GitHub Action stamps it at release.
  Expected mid-cycle lag is out of audit scope.

### Files touched
- shell.js (ICONS), contacts.js (fmtEvtDate, pad()), apps.json
  (formatting), OROS_BIBLE.md (this entry + BIBLE-1–5 registry
  sync: §6 app count 15, §7 Contacts/Cycle rows, §8 dirs,
  §25 audit queue, Part XI Cycle backlog).

### Deferred ("under consideration")
- Wave 2 per the Wave 1 entry: relations, duplicate-merge UI,
  Calendar birthday reminder feed (lbl-bday-feed), avatars,
  transliteration search.

──────────────────────────────

## orOS Cycle — Waves 2.1–2.3 (shipped @ core 0.35.10)

App files: cycle/index.html, cycle/cycle.css, cycle/cycle.js (v0.35.10 on HTML+JS script src; app-local only — shell.js stays the single version source of truth for the OS itself).

### Wave 2.1 — Predictions & Reminders
- Prediction engine: next start = last period start + avg cycle length; window = avg period
  length (fallback 5d until first ended period exists). RENDER-DERIVED ONLY — never stored,
  never synced, never authoritative.
- Calendar renders predicted days as dashed/faint red cells (.cal-cell.pred) — an estimate
  must be visually distinct from a fact. Legend hint shown only while a prediction exists.
- Reminder system: toggleable via state.prefs.remind (synced through the slice), toast on
  app open — "expected in ~N days" (≤2 days ahead) or "appears overdue ~N days ago".
  No native notifications, no timers while closed (R14 spirit).
- Ongoing-period render guard: an open-ended period never shades FUTURE calendar days
  (render-side cutoff only — periodCovering() itself untouched).

### Wave 2.2 — Cross-app Mood bridge (READ-ONLY)
- Cycle Insights gains "Mood on period days": prevalence per mood key during period days vs
  other days, from localStorage "oros-mood-data" (same origin, shared storage).
- Bridge contract: READ-ONLY, defensive parse (absent/garbage → no section, never throws),
  ZERO writes to mood data — EVER. Keys off mood.js's IMMUTABLE emotion dictionary (stable
  keys by design for statistics); unknown keys are silently ignored.
- Honesty guards identical to the trends engines: min 5 mood entries PER SIDE, min +12pt
  delta, max 2 sentences, positive-share bars (happy · calm · excited), explicit
  "correlations, not causes" disclaimer string (xm.disc) shipped WITH the feature.
- Mood app has the symmetric counterpart (period-day emotional patterns) — see mood entry.

### Wave 2.3 — Doctor Report (PDF export)
- "Doctor report" button in Insights top row (chip ghost). A4 PDF, sections: Overview
  (avg cycle / avg period / periods count / min–max gap variability), Period log
  (dates, inclusive duration, flow), Symptoms (frequency + "mostly on period days"
  marker), Pain relief (per-med intake counts + % of intakes on period days), Day notes,
  closing disclaimer (rep.disc) — the self-tracking disclaimer travels to paper.
- Cluster marker guards: symptom must appear ≥3 times AND land ≥70% on period days
  before the "mostly on period days" claim is printed. Nothing claimed on thin evidence.
- Range contract: the on-screen range chip (All / 6 months) defines the paper range —
  same as mood's export.
- PDF stack is a 1:1 port of mood.js's proven pipeline: vendored jspdf.umd.min.js
  (lazy-loaded from ../vendor/, cache-busted, graceful toast if absent), NotoSans TTF for
  Greek (fetched once, cached in window.__cyclePdfFont), NFC normalization funnel wrapped
  around doc.text() (mobile keyboards emit NFD — jsPDF draws combining marks as glyphs),
  pagination-safe section/kv/line helpers with footer on every page.
- Export guard: with zero data the button now shows a feedback toast instead of a
  silent no-op.

### Fixes this pass
- CRITICAL (sync): prefs edits now stamp state.om alongside state.sm. mergeCycleStates
  resolves prefs from the OM-DONOR side; a remind-toggle that only bumped sm could be
  silently overwritten by any device with a newer om. RULE: any prefs-touching edit
  bumps BOTH sm and om. (Same class of bug as the mood prefs race — hunt it in every
  app that resolves prefs by om-donor.)
- Empty-state dead button: "Doctor report" rendered before the empty-state return —
  now gives toast feedback.

### New standing rules recorded (Bible-grade)
1. Disclaimer-accompaniment contract: every predictive/correlational/estimative feature
   ships WITH its own disclaimer string, rendered next to it (screen AND paper). No
   disclaimers-before-the-fact, no orphan estimates.
2. Cross-app read-only bridge: apps may READ sibling slices from localStorage on the
   same origin, defensively, without writes. Claims built on another app's data must
   state the source and use that app's documented immutable vocabularies.
3. Om-donor prefs resolution: prefs live in the slice and resolve via om-side donor in
   merge; therefore prefs edits MUST bump om (see fix above).
4. Estimates are visually distinct: predicted/estimated UI states use dashed/faint
   variants of the SAME hue family — never full-strength rendering of a guess.

### Sync/storage surface (unchanged since Wave 1)
- Slice "oros-cycle-data": periods, days (deterministic d-YYYY-MM-DD ids, whole-day LWW),
  cols (sym/med vocabularies, bilingual seeds with bi labels, label-normalized dedupe),
  prefs, tombstones. Absence of data is never imputed (unknown ≠ no).

### Update guide (from previous 2.2-era install)
1. Replace cycle/index.html, cycle/cycle.js. cycle.css unchanged this pass.
2. Confirm sw.js PRECACHE_URLS includes vendor/jspdf.umd.min.js and
   vendor/NotoSans-Regular.ttf (already required by Mood) — verified this pass.
3. No data migration: DATA_VER stays 1; state shape unchanged (new prefs key optional,
   defaults to remind:true on migrate).
4. Post-deploy check: Insights → "Doctor report" exports (EN + EL), file downloads as
   oros-cycle-YYYY-MM-DD.pdf; reminder toggle survives a sync round-trip across devices.

### Files-touched checklist (release propagation)
- cycle/index.html — yes (script/css version refs)
- cycle/cycle.js — yes (STRINGS en/el +28 keys, PDF stack, button wiring, prefs fix, export guard)
- cycle/cycle.css — no
- apps.json / shell.js ICONS / translations.js — no (done at Wave 1 introduction)
- sw.js — no new entries needed (vendor files already precached)
- GitHub Action: version parameters untouched (auto-bump handles cache busting)

## Weather app — audit fixes
- Boot log: dynamic SCRIPT_V from ?v= cache-bust param (time.js pattern).
- Toast styling externalized to weather.css (.oro-toast / .sn-btn) —
  no inline style.cssText. CSS header no longer carries a version
  number (shell.js is the single source of truth for versions).
- GPS/shell location dedup tolerance 0.02° → 0.15° in
  __orosWeatherUpdate, fetchForecast tray mirror and
  syncShellLocation — aligned with shell.js nearest-city adoption;
  typed-city guard in commitCity intentionally stays 0.02°.
  
  ## Weather v0.3.0 — Audit Completed (2026-09-19)

### Fixes Applied
- **Toast positioning & interaction**: Moved to top-right (Linux convention), added `visibility`/`pointer-events` guard to prevent click-trap after fade-out
- **Palette inheritance**: Added `--danger`, `--ok`, `--warn` to `PAL_VARS` for AQI/UV semantic coloring
- **Theme consistency**: Replaced hardcoded `rgba(224, 108, 117, …)` with `color-mix(in srgb, var(--danger) N%, transparent)`
- **Sync UX**: Changed merged-ack toast from generic "Updated" to "Synced changes from another device" (bilingual)
- **Dead code removal**: Removed unused `data-skin="oros"` attribute from HTML
- **CSS cleanup**: Eliminated redundant `overscroll-behavior-y` declaration (already covered by `overscroll-behavior: contain`)

### Architecture Verified
- Timezone-correct "now" (utc_offset_seconds from API response)
- Undo-delete with tombstone resurrection
- No-data state (lazy-created, between offline badge & empty)
- Autocomplete (debounce/token/mousedown-vs-blur)
- WA2 sync stub (`__orosSyncApi`) defined BEFORE `load()`
- Merge engine symmetrical + deterministic

### Ready for Stable Release
No blocking issues. All audit findings resolved.

## Habits v0.3.1 — Audit Fixes (2026-09-19)

- CRITICAL: missing `}` in wire() cdot branch — SyntaxError killed the
  entire IIFE at parse time (blank app, no boot log)
- Shortcut forwarding now limited to shell-owned combos (Ctrl+Alt+Shift+*)
  instead of forwarding every plain keystroke to the parent document
- sliceGet() deep-clones the shipped payload (Weather-contract; no live
  db references in the sync layer)
- PAL_VARS extended with --ok/--warn (standing orOS palette rule)
- Toast standardized: top-right below app topbar, var(--border) stroke,
  z-index 1200 — adopted as OS-wide toast convention
- EL strings: "30μ"/"90μ" → "30 ημ"/"90 ημ" (misread as minutes)
- Dead code: daysWrap.dataset.built remnant removed
- CSS: .btn.danger color #fff → var(--bg) (palette purity)

Note: weather.js toast top offset (12px) pending alignment to the new
convention (below-app-topbar) — next Weather touch-up.

## Habits v0.3.1 — Verified (2026-09-19)

All 8 audit patches confirmed applied and cross-validated:
- SyntaxError fix (wire cdot branch) — app boots
- Shell-owned-only combo forwarding (§10 Weather parity)
- sliceGet deep clone (Weather-contract)
- PAL_VARS --ok/--warn
- Toast standardized (top-right below topbar, --border, z 1200)
- EL: "30 ημ"/"90 ημ"
- dataset.built remnant removed
- .btn.danger var(--bg)

Status: CLEAN — ready for stable.

## Wave 2.1 — Contacts ⇄ Calendar integration (done)

### Birthday/anniversary feed (calendar.js)
- Virtual feed labels `lbl-feed-bday|anniv|custom` (LABEL_PALETTE colors)
  added OUTSIDE state.labels by design: never synced, never deletable
  from the label manager, retranslated via i18n at every paint.
- `contactsFeedOn(dateStr)` reads `oros-contacts-data` (shared
  localStorage, same-origin iframe) with a 1s micro-cache. Builds
  ephemeral all-day events tagged `_feed:true` + `_contactId`.
  Read-only by construction: absent/corrupt blob → no feed events.
- `eventsOn()` concatenates feed events → Month dots, Week, Agenda,
  Day panel all render them. Feed rows are NOT draggable, never
  open the event dialog, bypass search/stats/ICS/reminder engine.
- Stats KPIs stay store-backed (CP1): no feed events in stats.

### Click-through bridge
- shell.js: `window.__orosOpenContact(id)` — live iframe push when
  Contacts is running (wxPushToApp pattern), else sessionStorage
  staging (`oros-contacts-open`, swept by factory reset) + app open.
- contacts.js: exposes `__orosContactsOpen(id)` (opens the edit
  dialog, stale id → silent no-op); consumes pending deep-link at
  boot AFTER first paint.

### Accepted edge cases (backlog)
- Calendar search does not surface contact feed events (future).
- Stale Contacts iframe without the bridge → pending id deferred
  until next Contacts cold boot (theoretical; cache-bust covers).
  
  ## Kanban — Deep audit pass (orOS 0.35.x, Kanban v0.6.x)

**Scope:** Full logic + consistency audit of the Kanban app
(index.html / kanban.css / kanban.js). All 14 identified issues
resolved and verified against the delivered files.

### Critical fixes
- **Live Save (card editing):** typed text (card text, notes,
  subtask text, extra-info fields) is now written to state +
  localStorage immediately via a 250 ms debounced `liveSaveCard()`,
  with `mtime` stamped so live edits win merge conflicts. Previously
  edits were only persisted on dialog close — an unexpected tab
  close could lose data.
- **Residual live-save gaps:** subtask checkbox toggle, subtask
  add/remove and extra-info remove now persist immediately
  (`touch(card) + save()`), no longer relying on the dialog close
  handler. Empty extra-info adds intentionally remain close-flushed
  (no content to lose).
- **Close handler retained** as a safety net: filters empty info
  rows, and a fingerprint check avoids stamping `mtime` on
  zero-edit closes (no spurious LWW wins).

### Ecosystem alignment (characters/weather patterns)
- **Language fallback chain:** `window.parent.orosLang` →
  `localStorage("oros-lang")` → English. `<html lang>` set at boot.
  The app now boots in the shell's language immediately.
- **Global shortcut forwarding:** capture-phase keydown listener
  forwards modifier combos (Ctrl/Alt/Meta) to the parent shell so
  global orOS shortcuts work while the Kanban iframe has focus.
  Plain typing is never forwarded. Alt+B = quick new board.
- **Toast repositioned top-right** (14px insets, downward reveal,
  mobile media query) matching the ecosystem-wide shell toast
  convention (Linux-desktop style, below the clock area).

### Silent saves (sync traffic hygiene)
- Added `saveLocal()`: writes localStorage only, never calls
  `markDirty()`. Used by `switchBoard()` — switching boards is
  device-local UI state and must not trigger network sync.
- `createBoard()` deliberately keeps `save()` (real content that
  must sync). `activeBoardId` never travels through the merge
  engine; each device keeps its own selection.

### Refactors & cleanup
- Extracted `resetSessionView()` shared by `switchBoard()` /
  `createBoard()` (was duplicated filter-reset blocks). Now also
  explicitly hides `#search-clear` and the filter popover when
  switching boards.
- Replaced hardcoded "New board" / column/card metadata strings
  with i18n keys (`new.board`, `meta.columns`, `meta.cards`) in
  both EN and EL dictionaries.
- Removed dead `update.checking` i18n key (unused in app; the
  shell owns update notifications).
- Repaired corrupted comment fragments in the merge-engine section
  (stray characters / duplicated phrases — no functional change).
- Verified `.info-x` / `.i-label` / `.sub-x` CSS classes are live
  (referenced by `makeRemoveBtn` / `makeInfoRow`); no dead CSS
  removal performed. `.info-x` remains as a harmless alias of
  `.sub-x`.

### Accessibility (HTML)
- Dialog labels now carry `for` attributes (`c-text`, `c-notes`,
  `col-name`, `b-name`) so clicking a label focuses its control.

### Architecture notes (for future sessions)
- **Save discipline:** `save()` = localStorage + `markDirty()`
  (network sync eligible); `saveLocal()` = localStorage only
  (device-local state). Choose deliberately per action.
- **Merge model:** unchanged multi-board union merge (board tomb-
  stones at root `state.boardDeleted`, per-board entity merges,
  `om`-based ordering). No schema changes in this pass.
- Live edits stamp `mtime` per keystroke-debounce; zero-edit
  closes stamp nothing (fingerprint equality).
- Version references (`?v=0.35.11`) are owned by the GitHub Action
  — no manual bumps in this pass.

### Verification checklist
- [x] All OLD blocks for the 15 patches matched the delivered files
- [x] Dialog close handlers safe against double-commits (early
      return on `editingColId === null` after deletes)
- [x] `DRAG_THRESHOLD` hoisting safe (IIFE-level init before boot)
- [x] No dead functions or unreachable branches found beyond
      the flagged i18n key
	  
	  ## v0.4.0 — Cross-app virtual feeds

### Architecture: virtual feed labels (Wave 2.1)
- FEED_LABELS array (bday/anniv/cycle/mood/habits) is DISPLAY-ONLY:
  never in state.labels, never in the synced blob, no mtime.
  Cannot be deleted/renamed/recolor by construction — renderLblList
  iterates state.labels only.
- Feed events carry _feed:true + a source id (_contactId/_habitId/
  _cycleId/_moodId), are never stored, never synced, never exported
  (.ics walks state.events only), never counted in Stats (CP1 rule).
- Read-only rows ARE shown in the Label Manager (🔒, app-managed):
  transparency without mutability.

### New feeds
- habitsFeedOn(): completed habits from oros-habits-data as teal
  all-day rows. Comp key: "<habitId>|<YYYY-MM-DD>", skips tombstoned
  (del) habits/comps.
- cycleFeedOn(): days inside a CLOSED period (start..end inclusive)
  from oros-cycle-data as pink all-day rows. OPEN period (end:null)
  paints ONLY day 1 — no projection, no guessing. Honors the deleted{}
  tombstone map.
- moodFeedOn(): every entry whose LOCAL calendar day matches the cell
  from oros-mood-data, purple all-day row. Title = note excerpt
  (≤40 chars) else the generic localized label. Honors deleted{}.

### Conventions
- All cross-app reads: same-origin localStorage, 1s micro-cache
  ({when, data} holder) to survive the ~31 eventsOn calls per month
  paint without JSON.parse storms.
- Time math is local-midnight aligned (setHours(0,0,0,0)) — never
  UTC-shifted.
- Click-through exists ONLY for Contacts (__orosOpenContact in
  shell). Cycle/Mood rows are passive read-only until a matching
  deep-link hook ships in the shell.

### Under consideration
- Dominant emotion in Mood feed titles (needs cols mapping decision).
- Deep links to Mood/Cycle apps from their feed rows.

## Wave 2.3 — Avatars, Relations, Transliteration (done)

### Hotfix (2.2 debt, patches A1–A7)
- FIXED: scanDuplicates threw `ReferenceError: reasonMap is not
  defined` the moment a real duplicate existed (references survived
  the declaration removal). Dead writes removed from email+phone
  loops.
- FIXED: hardcoded "Definitive/Possible matches" headers → i18n
  keys dup.sect.def/pos (textContent, no innerHTML).
- Group badge reason now truthful: email vs phone vs name (A7).

### Avatars (B1–B13)
- New schema field `photo`: base64 JPEG data URI (center-crop
  square, 128×128, q0.85, hard cap 50000 chars — sanitizer also
  accepts PNG for imports).
- Dialog uploader: upload → canvas resize → circular 48px preview;
  remove resets to initials. List + dedup rows + merge preview
  use the shared mkAvatarEl().
- Merge: photo joins the scalar fill-if-empty chain (loser photos
  survive when the primary has none).
- vCard: PHOTO exported as data URI; imported from data URIs and
  raw base64 (TYPE=JPEG|PNG). Remote http(s) URLs NOT fetched
  (static OS — no network dependency in imports), skipped silently.

### Relations (C1–C16)
- New schema field `relations: [{ with: <contactId>, type }]`,
  RELATION_TYPES whitelist, dedupe by with+type, sorted
  (deterministic merge bytes). Stored ONLY on the initiator; the
  inverse direction is COMPUTED at render (RELATION_INVERSE map,
  incomingRelations()) — zero double-write, zero sync races.
- Dialog: [contact select][type select][✕] rows, no self-relations,
  unpicked rows dropped at read time; read-only "Linked from other
  contacts" block shows computed inverses. Deleted targets render
  as absent (dangling refs are safe, tombstones never leak).
- Merge unions relations by with+type. Search haystack includes
  names of related contacts.
- NOT in vCard round-trip (no standard slot) — backlog:
  X-RELATED custom property export/import.

### Transliteration + phonetic sorting
- greekFold (lowercase + accent-strip + ς→σ) and latinize
  (Greek→Latin letter map): "dionisis" finds "Διονύσης", "μαιρια"
  matches "Μαρία" ignoring accents. SEARCH-ONLY — nothing stored
  transliterated. Limitation: single deterministic letter map,
  no digraph fuzziness (μπ→b, ντ→nd) — backlog.
- List + export sorting use folded collation: "Ήλιος" sorts with
  H, not at the end of the list.

### Files touched
contacts.js, contacts.css, contacts/index.html (no new files →
apps.json/sw.js untouched; version bump via GitHub Action).

## Mood — Audit fixes (8 items, post-0.35.11)

1. FIXED: Insights showed "0 of 0" ghost rows for habits/rituals
   with zero data — empty rows now skipped, sections fall back
   to the "nothing logged" placeholder.
2. FIXED: "Export PDF" was a dead button while jsPDF was
   loading (silent return on second click) — clicks now queue
   and all fire on onload; on failure the queue drains with
   the error toast.
3. FIXED: editEntry rebuilt the entire capture form twice and
   set the note after the rebuild — the note now travels with
   the edit (pendingNote), consumed by the single buildCapture
   inside applyView.
4. FIXED: PDF export printed the "nothing logged" fallback for
   the basics group only — rituals group now gets it too.
5. ADDED: explicit no-results state in the Entries search
   ("No entries match …"), ent.noRes key in EN+EL.
6. CLEANUP: stale (v0.27.00) header comments in mood.js /
   mood.css → "(version stamped by CI)" — never stale again.
7. FIXED: migration edge — pre-ver3 data lacking trigSeeded
   could respawn factory triggers on a deliberately emptied
   column; ver<3 states are now marked seeded in migrate().
   Trade-off: pre-ver3 installs that never used triggers skip
   factory presets (accepted, rare).
8. CLEANUP: dead .toLowerCase() comparisons in the seed
   backfill matcher (normLabel already lowercases).
   
   ## orOS Calendar v0.4.0 — Virtual Feeds & Deep Linking

Wave 2.1 (calendar) + Wave 4 (cross-app navigation). Companion
changes: shell.js (deep-link bridges), cycle.js (receiver),
mood.js (receiver). Core sync engine untouched.

### Added — Calendar virtual feeds
- FEED_LABELS in calendar.js: read-only pseudo-labels (Cycle,
  Mood, Habits) painted on the calendar grid as colored rows /
  dots. Display-only by contract: never stored in state.labels,
  never synced, never renamed or deleted by the user.
- Data sources (shared localStorage, same-origin read-only peek):
  - cycleFeedOn() → "oros-cycle-data" (periods only; open-ended
    periods paint ONLY the start day — no projection)
  - moodFeedOn() → "oros-mood-data" (entries; row title = note
    excerpt, fallback emotion face/labels)
  - habitsFeedOn() → "oros-habits-data"
- 1-second micro-cache on each feed reader to keep render-time
  reads cheap during repaints.
- Feed rows integrated into eventsOn() and surfaced in the Label
  Manager as locked (lock icon), non-editable rows alongside
  user labels.

### Added — Deep-link protocol (shell + source apps)
- Shell bridges (window.* on parent):
  - __orosOpenCycle(id) / __orosOpenMood(id): if the app iframe
    is live → push to its receiver directly; else stage the ID
    (sessionStorage "oros-cycle-open" / "oros-mood-open") and
    open the app.
  - __orosCycleTakePending() / __orosMoodTakePending(): one-shot
    consume of the staged ID. DEFINED IN THE SHELL ONLY — apps
    call the parent, never redefine it.
- Receivers (inside the apps):
  - cycle.js → window.__orosCycleOpen(periodId): read-only
    navigation — calendar view, month of the period start,
    cycle info strip. No editor, no edit mode.
  - mood.js → window.__orosMoodOpen(entryId): opens the entry in
    EDIT mode (the entry is the mood app's natural destination;
    Discard and entryById guard protect it). Deleted entry →
    lands on capture silently.
  - Both consume the staged ID at boot AFTER first paint
    (resetCapture()/applyView() first), so the target view is
    painted in one pass.

### Fixed (audit fallout, this wave)
- calendar.js: removed duplicate feedLabelName() definition that
  shadowed the correct one.
- cycle.js: preferences edits now update state.om alongside
  state.sm (sync race — prefs could be overwritten by pull).
- Palette inheritance: --danger / --ok / --warn added to PAL_VARS
  in all apps that shipped without them (theme mismatch).
- Toasts across touched apps: pinned top-right; fade-out now
  ends in visibility:hidden (removed the invisible click trap).
- cycle.js: syntax fix — missing closing brace in wire() had
  blocked app boot entirely.

### Contract notes (for future apps joining the protocol)
- Staged-ID keys follow the pattern "oros-<app>-open".
- Receiver naming: window.__oros<App>Open, take:
  window.__oros<App>TakePending (shell-owned).
- Boot-time take order: load data → first paint → take pending.
- Deep-link navigation is view-only unless the app's natural
  unit demands editing (Mood entries); receivers must guard
  against IDs deleted on other devices.

### Testing checklist (pre-stable)
- [ ] Calendar feed rows: Cycle periods, Mood entries, Habits.
- [ ] Feed row click with app CLOSED → app boots on target.
- [ ] Feed row click with app OPEN → live navigation, no reload.
- [ ] Deep-link to an entry deleted from another device →
      graceful landing (Mood: capture tab).
- [ ] Feed rows survive label manager add/rename/delete of REAL
      labels (feeds must never enter state.labels).
- [ ] Micro-cache: no perf regression while paging months fast.

### Under consideration
- Kanban / To-Do feeds for items carrying dates (same
  virtual-feed pattern).
- Cross-app deep links from Mood trends ("period days") into
  Cycle.

### Files touched
calendar.js, calendar.css, shell.js, cycle.js, cycle.css,
mood.js — no data-schema changes, no sync-engine changes.

## Notes — Audit fixes (14 items, post-0.35.11)

1. FIXED: corrupted empty-notebooks store crashed boot at
   currentNotebook().id — normalizeState now enforces the ">= 1
   notebook" invariant (rescue notebook on every load/merge).
2. FIXED: pages parented under a page in ANOTHER notebook were
   invisible in the tree yet leaked into ZIP exports —
   normalizeState re-parents cross-nb children to ROOT.
3. FIXED: merge sorts used localeCompare (browser-locale
   dependent) — notebooks/labels/pages now sort with locale-
   independent id tiebreaks; kills potential sync ping-pong via
   serialized-equality mismatch.
4. FIXED: saveNow crashed on quota/private-mode — guarded write
   with console error + user-visible toast (toast.saveFail).
5. FIXED: notebook ZIP export order ignored pinned pages —
   childrenSorted is now pinned-aware and nb-safe, matching the
   visible tree order.
6. FIXED: movePage was a silent no-op at the pinned/unpinned zone
   boundary and could produce negative/duplicate pos on colliding
   positions — boundary is now an explicit no-op; collisions
   renumber the sibling group.
7. FIXED: label toggles and sync merges while typing reset the
   caret/scroll (full renderEditor re-write) — same page + editor
   focus now refreshes only chips/links strip. Local edits win
   LWW, no data loss.
8. FIXED: deleteNotebook left stale prefs.open keys (device-local
   leak) — expanded-state open-map entries cleaned on delete.
9. FIXED: hardcoded "Show tree" / "Close" aria-labels → i18n keys
   (menu.showTree / menu.close, EN+EL), removed from index.html.
10. FIXED: notebook selector rendered ALL-CAPS (inherited
    text-transform:uppercase from the old static header) —
    override #nb-selector { text-transform: none }.
11. FIXED: nb-selector context menu could open off-screen on
    mobile — now clamps via clampToViewport like every menu.
12. ADDED: empty-notebook export shows a toast instead of
    silently doing nothing (toast.emptyExport, EN+EL).
13. CLEANUP: version drift (js "0.17.0" vs css "v0.35.00" vs
    ?v=0.35.11) — APP_VERSION now reads the CI-stamped ?v=
    param; CSS header neutralized ("version stamped by CI").
14. CLEANUP: local vars shadowing the currentNbId() function in
    runSearch/renderTagPanel — renamed to nbId.
	
	15. FIXED: P14 rename was half-applied — the tags-panel page count
    still referenced the old shadowed variable name (now resolving
    to the currentNbId FUNCTION, always falsy) → all tag counts
    showed 0. Renamed to nbId.
	
	## [Unreleased] — Wave 1A: Unified Notification System (core)

### Added
- notifications.js (new module, v1.0.0): hybrid pull-scheduler
  notification engine for the orOS shell
  - Central scheduler: boot sweep + visibilitychange catch-up +
    60s piggyback on renderClock (NO new setInterval — shell
    doctrine respected)
  - oros-notifs localStorage slice: {settings, appToggles, items,
    meta}; 7-day TTL pruning, 300-item sync cap
  - Registered via window.orosSync.registerSlice("notifs", get, set)
    — same contract as shell/files-disk slices
  - LWW per-field merge: readAt (non-null beats null, both-read →
    max), firedAt → max, createdAt → min; settings via settingsRev
    clock; anti-loop contract (setter never marks dirty)
  - Taskbar bell (.bar-right, before #btn-lang): inline SVG bell,
    palette vars only, unread badge (99+ cap), full inbox panel
    (click → openTarget deep link, dismiss, clear all)
  - Deep links routed to REAL bridges (__orosOpenContact /
    __orosOpenCycle / __orosOpenMood) — apps without a bridge
    no-op gracefully
  - Sounds: bell/ding/chime presets, pure WebAudio oscillators,
    zero external assets
  - All user mutations (read, clear, settings, toggles, new items)
    call orosSync.markDirty() — data travels to the cloud
  - beforeunload flushes via saveSliceNow() (replaces the broken
    saveSliceThrottled(0))

### Changed
- shell.js: renderClock now calls notifTickThrottled() (60s gate,
  try-guarded — cheap noop when notifications.js is absent)
- index.html: loads notifications.js after shell.js (bar order:
  sync-dot, bell, lang, time, date)

### Pending (later waves)
- Wave 1B: Inbox panel UI refinement, per-app trigger migration
  (calendar/cycle/mood/todo/habits), settings UI (position/style/
  sound customization), translations.js keys for notif strings
- sw.js: precache entry for notifications.js (see handoff note)

## [Unreleased] — Wave 1A: Unified Notification System (core)

### Added
- notifications.js (new module, v1.0.0): hybrid pull-scheduler
  notification engine for the orOS shell
  - Scheduler: boot sweep + visibilitychange catch-up + 60s sweep
    piggybacked on the shell's renderClock tick (NO new setInterval
    — shell "no idle timers" doctrine)
  - oros-notifs localStorage slice: {ver, settings, appToggles,
    items, meta}; 7-day TTL pruning; 300-item sync cap
  - Registered via window.orosSync.registerSlice("notifs", get, set)
    — same contract as shell / files-disk slices
  - LWW per-field merge: readAt (non-null beats null, both-read →
    max), firedAt → max, createdAt → min; settings LWW via
    settingsRev counter; anti-loop contract (pull-fed setter never
    marks dirty — shellSliceSet lesson)
  - Taskbar bell: injected into .bar-right before #btn-lang (real
    shell reality, sync-dot pattern); inline SVG bell (no emoji,
    no icon fonts); unread badge with 99+ cap, palette vars only
  - Inbox panel: click → deep link via REAL app bridges
    (__orosOpenContact / __orosOpenCycle / __orosOpenMood);
    apps without a bridge no-op gracefully; Clear all + per-item
    dismiss (both mark read)
  - Sounds: bell/ding/chime presets via WebAudio oscillators,
    zero external assets (alarmPip precedent)
  - Every user mutation (read, clear, settings, toggles, new
    items) calls orosSync.markDirty() — data travels to cloud
  - beforeunload flushes via saveSliceNow() (the old
    saveSliceThrottled(0) never ran before page death)
  - Bilingual UI strings via nt() helper (orosLang, EN default) —
    zero new translations.js keys for Wave 1A
- Deep-link contract: format "ns:type:id", routed via DL_BRIDGES
  map; extend the map (not the shell) when new apps gain bridges

### Changed
- shell.js: renderClock calls notifTickThrottled() — 60s gate,
  try-guarded, cheap noop when notifications.js is absent (same
  shape as calRemTickThrottled)
- index.html: loads notifications.js after shell.js (final bar
  order: sync-dot, bell, lang, time, date)
- sw.js: "./notifications.js" added to PRECACHE_URLS (unversioned,
  same pattern as all core scripts)

### Fixed (bugs found in the draft against real shell contracts)
- Slice registration: api.registerSlice(obj) (nonexistent) →
  window.orosSync.registerSlice(name, getFn, setFn) (real)
- state.meta.lastSyncPush crashed (no state.meta) →
  state.slice.meta.lastSyncPush + saveSliceNow()
- __orosOpenX (nonexistent) → DL_BRIDGES routing to the real
  per-app bridges
- #oros-taskbar / #oros-clock (nonexistent) → .bar-right /
  before #btn-lang
- setInterval(60000) idle timer removed → renderClock piggyback
- beforeunload saveSliceThrottled(0) → saveSliceNow()
- Hardcoded #6d4aff/#fff/#333 styling → palette vars
  (--accent/--panel-bg/--border/--text-dim) — follows every skin
- renderPanelItems sorted the LIVE array (mutation) → .slice()

### Pending (later waves)
- Wave 1B: inbox panel UI refinement; per-app trigger migration
  (calendar/cycle/mood/todo/habits registerTrigger adoption);
  settings UI in the menu (position/style/sound); quiet-hours UI
- translations.js keys for notification strings (currently nt()
  inline bilingual, deliberate for Wave 1A — promote to window.t()
  keys in Wave 1B when the settings UI lands)
- Badge-only fallback for unread items fired >24h ago (design
  agreed, fires when trigger migration lands in Wave 1B)
  
  ## Mood — v0.35.15 follow-up audit (9 fixes)
1. DST-SAFE: renderThread() + streakInfo() now step by calendar days
   (setDate) instead of subtracting 24h in ms — fall-back Sundays no
   longer duplicate/skip a thread dot or double-count a streak day.
   Matches the Cycle-peek pattern already in buildTrends().
2. RECAP: "Top feeling" count badge renders green (was red — missing
   "up" direction arg defaulted to "down").
3. HTML VALIDITY: entries search no-results state is now a <li>, not
   a <div> inside the <ul>.
4. LEAK: reset dialogs (both stages) remove themselves on Esc /
   "close" event, not only via their buttons.
5. I18N: calendar day-list title renders a locale-formatted date
   (EL: "Σάβ 20 Σεπτεμβρίου 2026"), not raw ISO "2026-09-20".
6. PDF: line() NFC-normalizes BEFORE splitTextToSize — measurement
   now matches the drawn (pdfClean'd) string for decomposed Greek.
7. R9 PARITY: hardcoded English aria-labels removed from index.html;
   paintStaticAria() remains the single source at boot.
8. UX: adding a column value no longer scrolls to top mid-form —
   buildCapture()'s keepScroll restores the viewport.
9. CSS: section numbering made sequential (7 chip menu, 8 insights,
   9 calendar, 10 mobile); #thread gap consolidated in §3 (6px),
   Wave 3.5 duplicate override deleted.
No schema, sync, or storage changes — DATA_VER 3 untouched.

## Prompter — v0.35.15 deep audit (7 fixes + 1 open decision)
1. DIALOG LOCK/LEAK: all three <dialog>s (settings, custom editor,
   delete-confirm) now self-remove on Esc ("close" event). Before:
   one Esc permanently disabled the Settings / New-prompt buttons
   until refresh.
2. SYNC: un-complete now tombstones the id (deletion survives
   the union merge); re-complete still resurrects via fresh ts >
   tombstone — the completed map needed NO schema change.
3. MERGE: customs tie-break on equal mtime now deterministic and
   symmetric (JSON compare, mood's newerObj contract) — devices
   can no longer diverge on same-mtime edits.
4. R9 PARITY: hardcoded English aria-labels removed from
   index.html; paintStaticAria() is the single source at boot.
5. I18N: badge tooltips (★/✓/✦) localized via new
   badge.fav/badge.comp/badge.custom keys (was hardcoded English).
6. CSS: [hidden] authority guard added — promised by the file
   header, previously missing.
7. RESET: factoryReset now also clears activeCategory and the
   search box (view state matched the wiped data).
OPEN: favorites array cannot beat tombstones (no mtime) —
unfavorite reverts across devices in merge, re-favoriting after
factory reset can be undone by a stale device's tombstone.
Decision pending: A) favorites → {id:mtime} object (mirrors
completed) or B) document as known limitation.

## Prompter — favorites schema v2 (Patch series 8–16)
FAVORITES: array of ids → { id: mtime } object (mirrors completed).
Un-favorite now tombstones the id — deletions survive the union
merge, and re-favoriting after a factory reset beats the wipe
tombstone via fresh ts (previously impossible with no mtime).
ON-THE-FLY MIGRATION: normalizeFavs() runs in load() and
sliceSet(); legacy arrays (own device or remote payloads from
not-yet-updated devices) contribute mtime 0 in merge — an
unfavorite anywhere still outranks them. No DATA_VER bump
needed (normalization is version-agnostic). No data loss.
ONE-TIME CAVEAT: old array-code devices must be updated before
the new object form reaches them via sync (indexOf TypeError
otherwise). Deploy → reload all devices → then sync.
Also: deleteCustom cleans favorites via object delete;
renderStats counts via Object.keys; factoryReset tombstones
via Object.keys; data-model comment updated.

## CHANGELOG — Bookmarks (orOS)

### Architecture context (standing)
- **Mantra:** Offline first · Mobile first · No external deps ·
  Full manual export · Full auto export · Snapshots · Auto merge
  sync · No guessing.
- **Files:** bookmarks/index.html · bookmarks/bookmarks.css ·
  bookmarks/bookmarks.js — app runs in same-origin iframe inside
  the orOS shell; palette inherited at runtime from the parent
  (:root values in CSS are offline fallback only, oros dark skin).
- **Data:** single localStorage blob, key "oros-bookmarks-data",
  SCHEMA v1 = { ver:1, items{}, folders{}, deleted{} (tombstones,
  30d prune), settings{} }. Root folder id "unsorted" — permanent,
  undeletable, re-labeled via i18n.
- **Merge:** entity-union by id; newest "modified" wins; ties break
  on canonical JSON (deterministic, clock-free). Tombstone wins over
  older entity; entity modified after its tombstone resurrects.
- **Sync:** slice registered as "bookmarks" via the parent's
  window.orosSync.registerSlice (same pattern as other orOS apps).
  Dirty funnel: syncHost() resolves window.orosSync → window.parent.
- **i18n:** EN default / EL inline in bookmarks.js (STR). Shell menu
  name pending translations.js key "app.bookmarks" (Wave 4).
- Version stamps (?v=) are owned by the GitHub Action on deploy —
  never manual.

### Wave 1 — initial build (delivered)
- Quick-add with URL normalization (https:// prepend, trailing
  slash strip), "url | title" syntax, dedup detection + red flash
  + toast pointing at the existing folder.
- Folder tabs (create/rename via dblclick or ⋮ dialog, delete with
  two-step confirm; deletes orphan items to Unsorted), real-time
  search across title/url/tags/folder with source chips, per-row
  domain-hash favicon color chips.
- Drag & drop rows → tabs (desktop); long-press context menu with
  move/edit/open/delete (mobile, 500ms hold, viewport-clamped).
- Netscape HTML import (DOMParser walk, folder hierarchy → folders,
  case-insensitive folder name reuse, dedup vs existing) + export.
- Undo (snapshot-based) for delete item / delete folder / move.
- Visit counters + relTime in row meta; status "dead" styling hook.

### Post-assembly audit (this session)
FIXED:
- #1 CRITICAL: stray "})();" after §3 closed the IIFE prematurely →
  SyntaxError, app never booted. Removed; sections 4–12 now live in
  the same IIFE as intended.
- #2 CRITICAL: dirty funnel looked up window.orosSync inside the
  app iframe (always undefined — sync.js loads only in the parent)
  → no change ever reached the sync engine. Replaced with
  syncHost() resolving parent.orosSync (mirrors registerSync).
- Dead code removed: window.__orosSyncApi (pullSet was never
  called; pulls go through the slice's setState) + orphaned
  suppressDirty flag (pull path uses explicit save(false)).

PENDING / KNOWN:
- VERIFY: registerSlice called with a 5th argument (custom merge
  fn). Args 1–4 confirmed supported from shell.js usage; arg 5
  needs sync.js confirmation before deploy. Do not ship until
  verified.
- Integration patches (apps.json entry, shell.js ICONS.bookmarks,
  sw.js precache) drafted — apply at deploy time.
- Wave 2 backlog: dedup check in the edit dialog, i18n titles for
  #tab-add / #quick-add-btn, translations.js "app.bookmarks" key.
- Testing phase (planned after implementation, per workflow):
  desktop + mobile PWA, offline add → online merge, two-device
  concurrent edit convergence, import round-trip, export fidelity.
  
  ## Prompter — v0.35.17 follow-up re-audit (3 fixes)
1. CRITICAL: null-guard added to the dialog "close" listeners
   (settings + editor). The close event fires ASYNC — the buttons
   null the variable before the queued event ran, so every
   button-based close threw an uncaught TypeError (invisible in
   UI; Esc worked fine). Factory-reset path covered too.
2. BOOT: default Browse tab now gets .on + aria-pressed at boot
   (applyView only fires on clicks — same as the mood fix).
3. MERGE: customs sort now tie-breaks by id after pos — devices
   can no longer disagree on order when pos collides across
   devices (mirrors the Notes deterministic-sort fix).
All 16 patches from the deep audit + favorites schema v2
verified present and correct. Rolling-upgrade caveat unchanged:
update all devices before letting sync carry object-form
favorites to old array-code devices.

  ### sync.js verification (this session)
  - #3 RESOLVED: registerSlice 5-arg mergeFn is official engine API
    (v0.7 SLICE MERGE API) — contract "deterministic, bigger mtime
    wins, then lexicographic" matches mergeBookmarks exactly.
  - Confirmed: merge-capable slices exempt from v0.8 divergence
    guard; proxy hydration travels closed-app slices (DATA_KEY
    passed as arg 4); markDirty() takes NO arguments (Patch 2's
    api.markDirty() is the correct signature); engine reconciles
    ~100ms after registration.
  - #10 noted: setter double-merges (engine merges via mergeFn,
    our set merges again) — idempotent for union merge, kept as
    defense-in-depth.
  - #11 (optional Patch 4): settings merge was asymmetric
    (Object.assign = remote-wins on both sides = divergence).
    Fixed with deterministic lexicographic pick. Harmless while
    settings is {} (Wave 1); REQUIRED before Wave 2 settings.
  - #12 noted (theoretical): sanitizeItem Date.now() fallback could
    make malformed timestamp-less entities diverge across devices.
    Our code always writes timestamps — accepted limit.
	
	# CHANGELOG — orOS Bookmarks

## Standing context (for future chats)
- **Mantra:** Offline first · Mobile first · No external deps ·
  Full manual export · Full auto export · Snapshots · Auto merge
  sync · No guessing.
- **Stack:** bookmarks/ (index.html, bookmarks.css, bookmarks.js)
  in same-origin iframe under the orOS shell. Palette inherited
  at runtime from parent (inheritPalette + watchPalette); CSS
  :root values are offline fallback only.
- **Data:** localStorage "oros-bookmarks-data", SCHEMA v1 =
  { ver:1, items{}, folders{}, deleted{} (tombstones, 30d prune
  at load), settings{} }. Root folder "unsorted" — permanent,
  undeletable, i18n-labeled.
- **Sync:** slice "bookmarks", registered 5-arg with mergeFn
  (mergeBookmarks: entity-union by id, newest modified wins,
  canon() lexicographic tie-break, tombstone/resurrect logic,
  deterministic settings pick, no Date.now() inside merge).
  Merge-capable → exempt from v0.8 divergence guard. Dirty funnel:
  syncHost() → parent.orosSync.markDirty() (NO arguments).
  Engine double-merge in setter is idempotent (known, accepted).
- **Version stamps** (?v=): owned by GitHub Action on deploy —
  never manual.
- i18n: EN/EL inline STR; shell menu name needs
  translations.js "app.bookmarks" key (Wave 4).

## v0.1.0 — Wave 1 (built this cycle)
Features: quick-add w/ normalization + "url | title" + dedup;
folder tabs (create/rename dblclick, two-step delete → orphans to
Unsorted); real-time search + source chips; D&D rows→tabs;
long-press ctx menu (mobile); Netscape HTML import (folder tree
preserved, case-insensitive folder reuse, dedup) + export; Undo
(snapshot + fresh mtimes) for delete/move; visit counters;
domain-hash favicon colors.

## Post-assembly audit + fixes
- FIX #1 (CRITICAL): stray "})();" after §3 killed the file with
  SyntaxError → removed.
- FIX #2 (CRITICAL): dirty funnel looked up window.orosSync
  inside the iframe (sync.js only lives in parent) → syncHost().
- FIX #3: registerSlice 5-arg mergeFn VERIFIED against sync.js
  v0.9.1 (official v0.7 SLICE MERGE API, signature matches).
- FIX #11: settings merge made deterministic (was remote-wins on
  both sides = divergence).
- Removed dead code: __orosSyncApi.pullSet, suppressDirty flag.
- Verified final file: IIFE balanced, patches 1/2/2b/4 confirmed
  applied, ready to deploy.

## Known / deferred (tracked, not blocking)
- #12 (theoretical): sanitizeItem Date.now() fallback for
  timestamp-less entities could diverge across devices — our
  code always writes timestamps; accepted limit.
- #7: i18n aria/title for #tab-add, #quick-add-btn (Wave 2).
- #8: edit-dialog URL dedup warning (Wave 2).
- translations.js "app.bookmarks" key (Wave 4).

## Deployment checklist (next steps)
1. [ ] Apply Patch 3 integration: apps.json entry (Office),
       shell.js ICONS.bookmarks, sw.js precache (4 paths).
2. [ ] Commit → push → GitHub Action stamps ?v= across files.
3. [ ] Testing phase (after implementation, per workflow):
       - offline add → online merge (no data loss)
       - two devices, both app-open, concurrent edits converge
       - import round-trip (browser export → import → export)
       - mobile: long-press move, D&D fallback, dialogs
       - Undo across a sync boundary (tombstone resurrect)

──────────────────────────────
*Designed by Christos Koulaxizis — koulaxizis.gr*
*orOS — A static operating system in your browser*
*No tracking · No cookies · E2EE sync · Open source*