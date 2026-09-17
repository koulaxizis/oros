 # ══════════════════════════════════════════════════════════
# orOS — THE DEVELOPMENT BIBLE
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
# This file merges:
#   · The MUST-RULE REGISTRY (system-wide audit: ~168 rules)
#   · The complete architecture reference (ex-CHANGELOG.md)
#   · The canonical app-development contract
#   · All standing process rules, pipelines, and checklists
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
#   Part I   — MANTRA + STANDING PROCESS RULES
#   Part II  — MASTER RULE REGISTRY (system-wide, per-app)
#   Part III — CURRENT STATE + REGISTRIES (apps, files, keys)
#   Part IV  — DATA MODELS (per app)
#   Part V   — SYNC ARCHITECTURE + DATA SAFETY SUPREMACY
#   Part VI  — SHELL SUBSYSTEMS + PALETTE CONTRACT
#   Part VII — CANONICAL NEW-APP TEMPLATE (verbatim code)
#   Part VIII— UI STANDARDS
#   Part IX  — RELEASE PIPELINE + ALL CHECKLISTS
#   Part X   — BACKLOG + RELEASE HISTORY + HANDOFF


╔══════════════════════════════════════════════════════════╗
║  PART I — MANTRA + STANDING PROCESS RULES                ║
╚══════════════════════════════════════════════════════════╝

──────────────────────────────────────
1. MANTRA (design contract — never violate)
──────────────────────────────────────
  Offline first · Mobile first · No external dependencies ·
  Full project manual export · Full project automatic export ·
  Full project snapshots · Full project auto-merge sync ·
  No guessing: if unsure, ASK; if a file is missing, REQUEST
  it; never guess or assume.

──────────────────────────────────────
2. STANDING PROCESS RULES (R1–R20)
──────────────────────────────────────
DELIVERY & PATCHING
  R1  NO WHOLESALE REGENERATION for fixes. Surgical patches
      (OLD block + NEW block + exact anchor) — regenerations
      dropped working code invisibly (v0.14.0). EXCEPTION: LARGE
      multi-edit changes or user-requested restructures ship as
      FULL corrected files.
  R2  RELEASE RITUAL IS MANDATORY (Part IX). Stale bundles
      impersonate broken code. Strikes: v0.13.1, v0.14.1, v0.14.2.
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
      NOT union into duplicate seeds ("seed-loc-0" style ids,
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
  R20 APP-LOCAL VERSION REFS: per-asset ?v= params in an app's
    index.html are MANUAL (bump when shipping app-local
    changes). APP_VERSION (shell.js), CACHE_VERSION (sw.js),
    manifest version and ROOT-level ?v= stamps are CI-AUTOMATED
    — never edit those by hand. shell.js APP_VERSION is the
    single source of truth, bumped manually in a dev commit.
R21 CHANGELOG DISCIPLINE: after EVERY significant change
    (bug fix batch, feature, wave, audit closure, architecture
    change), write a CHANGELOG.md entry BEFORE moving to the
    next task — same response that delivers the patch ships
    the changelog text, so the user never has to ask. Entries:
    what changed, why, files touched, deferred items marked
    "under consideration". No change ships undocumented.
R22 BIBLE CURRENCY: after every significant PROJECT DECISION
    (new contract, resolved conflict, schema/model change,
    new rule or precedent, acceptance of a standing pattern),
    update OROS_BIBLE.md in the SAME response — the registry
    parts (II–IX) must always describe the CURRENT truth. The
    Bible changes when contracts change; the changelog changes
    when code changes. If a session ends with an unlogged
    decision, it did not happen.

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

──────────────────────────────────────
3. SYSTEM-WIDE RULES
──────────────────────────────────────
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
    window.orosAlarms engine surviving iframe close.
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
    busts correctly).

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
  · CI stamps sw.js CACHE_VERSION, manifest, root ?v= refs.
  · Boot markers log the running version; app-local ?v= manual.

DATA RULES (DATA-1…DATA-5):
  · Additive-only migrations (never destructive field drops).
  · Idempotent normalizeState() on load AND on merge results.
  · Corrupt-data rescue backup BEFORE reseeding.
  · Exports capture every parameter/state variation (R19).
  · Device-local whitelist (prefs/caches/seen) NEVER synced.

──────────────────────────────────────
4. PER-APP RULE SETS
──────────────────────────────────────
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
  · App version (v0.1.1) ≠ OS version (0.33.05) — dual tracking.
  · Faces hidden via [hidden] + :not([hidden]) display guards.
  · Alarm/timer/pomodoro FIRINGS run in the SHELL engine
    (window.orosAlarms) — survive iframe close; runtime states
    deliberately NOT synced; alarms device-local BY DESIGN.
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

PROMPTER:
  · Built-in 100 prompts embedded; customs ride the slice as
    entities; favorites/completed sets; tombstone resurrection
    on re-favorite/re-complete; 57-tag controlled vocabulary.
  · Known gaps (pending): dead empty.stats branch in
    renderStats(), CSS version comment stale, Contract Β
    forwarding — 3 patches queued.

──────────────────────────────────────
5. RESOLVED CROSS-APP CONFLICTS (Notes ↔ Mood precedents)
──────────────────────────────────────
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

──────────────────────────────────────
6. CURRENT STATE — v0.32.15 (2026-09-15)
──────────────────────────────────────
  Core shell  : APP_VERSION in shell.js (single truth; CI stamps
                sw.js/manifest/root ?v= automatically).
  Sync engine : sync.js v0.9.0 (Zero-Knowledge Sync v0.9).
  Skins       : 16 · Wallpapers: 15 (Desert Sand default).
  Domain      : useoros.online ONLY (no alt domains).
  Version surf: Info modal (Ctrl+Alt+Shift+I) + version toast.
  Locale      : EN default, EL secondary. Dark default, light
                optional. 24h clock. EN/EL switch chips.
  Fonts       : Nunito woff2 vendored (5 weights, fonts/).
  Platform    : static GitHub Pages, PWA (start_url
                "/?source=pwa", standalone, maskable icons,
                theme #1b1a18, bg #131820).
  Compliance  : Mood 100% (reference cert) · Weather 100% ·
                Time 100% · Notes 100% · Prompter 97% (3
                cosmetic patches pending) · Habits Waves 1–3
                complete (v0.3.0, R18 acceptance pending) ·
                OrosFS Wave 1 complete (fs.js v0.1.0).

──────────────────────────────────────
7. APP REGISTRY
──────────────────────────────────────
  App       | Dir       | Slice key / storage      | VER | Merge type
  ----------|-----------|---------------------------|-----|--------------------
  To-Do     | todo/     | oros-todo-data           | 3   | entity LWW + tombs
  Kanban    | kanban/   | oros-kanban-data         | 5   | boards[] union, root tombs
  Notes     | notes/    | oros-notes-data          | 2   | page/label LWW + tombs
  Weather   | weather/  | oros-weatherapp-data     | 1   | merge-lite
  Mood      | mood/     | oros-mood-data           | 3   | entity LWW + cols dedupe
  Time      | time/     | oros-time-data           | 1   | entity union + scalar smtime
  Calendar  | calendar/ | oros-calendar-data       | 1   | event union + tombs
  Quote     | quote/    | (quote slice)            | 1   | entity union + LWW + tombs
  Prompter  | prompter/ | oros-prompter-data       | 1   | union + LWW + tombs
  Storage   | storage/  | oros-storage-data        | 1   | flat ents union + LWW + del
  Habits    | habits/   | oros-habits-data         | 1   | habit/comp LWW + del
  Slices with NO app open: registered via persisted registry —
  data travels while apps are closed. syncApi() per R8.
  REFERENCE APP (canonical template): mood/ v0.27.00 — every
  contract in Part VII is extracted VERBATIM from it. When in
  doubt, "what does mood.js do?" is the tie-breaker.

──────────────────────────────────────
8. FILE TREE & LOCALSTORAGE KEYS
──────────────────────────────────────
REPO ROOT
  index.html            shell markup + SW lifecycle broker
                        (inline skipWaiting + controllerchange
                        reload) + boot splash
  shell.js              menus, skins, wallpapers, auto-backup,
                        shell slice, shortcuts §9c, weather §9d,
                        sync dot §9b, scToast §9, info modal,
                        alarms (window.orosAlarms), i18n, ICONS,
                        APP_VERSION (SINGLE SOURCE OF TRUTH)
  sync.js               orOS sync engine v0.9.0
  fs.js                 OrosFS virtual disk v0.1.0 (OPFS +
                        IndexedDB "oros-ofs" fallback)
  style.css             shell stylesheet — skin palettes =
                        canonical palette vocabulary source
  translations.js       EN/EL shell strings (window.t)
  apps.json             app registry (id, name, url, icon,
                        category, type) — MUST stay valid JSON
  sw.js                 precache-all, cache-first;
                        CACHE_VERSION busts it; PRECACHE_URLS
                        lists every app file (G2 guard)
  manifest.webmanifest  PWA (CI-stamped version)
  vendor/               jspdf.umd.min.js, NotoSans-Regular.ttf
  fonts/                Nunito woff2 (regular/medium/semibold/
                        bold/extrabold)
  todo/ kanban/ notes/ weather/ mood/ time/ calendar/ quote/
    prompter/ storage/ habits/ — one dir per app:
                        index.html + <app>.css + <app>.js
  .github/workflows/bump-version.yml   release pipeline (v3)
  OROS_BIBLE.md         THIS FILE
  CHANGELOG.md          release history log (living document)

LOCALSTORAGE / STORAGE KEYS
  Shell prefs (synced via shell slice):
    oros-lang · oros-theme · oros-skin · oros-wallpaper
    oros-sync-interval · oros-autoexport
    oros-weather {on, auto, lat, lon, label}
  Shell device-local:
    oros-last-version        last SEEN version (update toast)
    oros-wx-cache            last weather read {at,temp,code}
    oros-wx-last             fetch throttle epoch
    oros-autoexport-last     last auto-backup check epoch
    oros-auto-snapshots      rolling 5 full-DB snapshots (FIFO)
    oros-fs-folder-name / oros-fs-lapsed   backup-folder state
  Sync engine:
    oros-slices              registered slice metadata
    oros-sync-baselines      per-slice pushed hashes (djb2)
    oros-sync-dirty          unpushed-changes flag
    oros-remote-carry        parked remote payloads (divergence)
    oros-db-account          Dropbox account cache
    oros-db-access / oros-db-refresh / oros-db-expiry   token
                             triplet
    oros-pkce-verifier       SESSION-ONLY (sessionStorage)
    oros-vault-data          encrypted device vault
    oros-sync-pw-epoch       known passphrase epoch (ZK v0.9)
  IndexedDB:
    "oros-vault" store "keys"      vault decryption key
    "oros-fs"    store "handles"    FileSystemDirectoryHandle
    "oros-ofs"                       OrosFS fallback backend
  App data (synced): see registry §7 (oros-*-data keys)
  App device-local: oros-notes-prefs, oros-mood-seen,
    oros-weatherapp-cache (MAX 6 cities, NEVER synced),
    oros-habits-view, oros-habits-range (UI prefs — NEVER
    synced), oros-storage-data-broken, oros-habits-data-broken
    (rescue backups)
  DEVICE-LOCAL WHITELIST (intentionally excluded from sync):
    oros-wx-cache, oros-auto-snapshots, oros-fs-*, all
    *-prefs/*-cache/*-seen keys.


╔══════════════════════════════════════════════════════════╗
║  PART IV — DATA MODELS                                  ║
╚══════════════════════════════════════════════════════════╝

──────────────────────────────────────
9. COMMON CONTRACTS (all apps)
──────────────────────────────────────
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

──────────────────────────────────────
10. PER-APP MODELS
──────────────────────────────────────
NOTES (DATA_VER 2)
  { ver, pages:[{id,parent,title,text,mtime,pos,labels:[]}],
    labels:[{id,name,color,mtime,pos}],
    tombs:{pageId→ts, "lbl:"+labelId→ts} }
  Merge: per-page/label LWW, 30d prune, normalizeState()
  idempotent, autosave debounce 500ms. Wiki-links [[Title]]:
  zero storage, regex-derived; solid chip = resolved, dashed
  chip = creation-on-click child page.

KANBAN (DATA_VER 5)
  { ver, boards:[{id,name,columns,labels,tombs,mtime,color?,
    archived?}], boardDeleted:{boardId→ts}, activeBoardId }
  activeBoardId DEVICE-LOCAL. Nested per-board v0.5 contract;
  root tombs prevent resurrection; archived/color survive
  merge; prune >30d; archive keeps last-live-board guard.

MOOD (DATA_VER 3)
  { ver, sm, om, entries:[{id,ts,mtime,emotions:[{k,i}],
    loc,person,trig, <21 habit fields> null|"yes"|"no",
    note, trigger:""}],
    cols:{loc[],person[],trig[]}, deleted:{id→ts} }
  · 9 fixed emotions (stable statistics vocabulary) — Part VI.
  · Columns: {id,label,bi?,mtime,pos}, deterministic seeds,
    renames kill bi, tombstoned deletes, dedupeCols() at merge
    (normLabel = trim+lowercase+collapse-space, mtime winner,
    symmetric remap of entry references).
  · Entry order = DESC ts (derived at sort time, not pos).
  · sm = state mtime, om = order mtime (position donation).
  · Migration: booleans true→"yes", false→null.

TIME (VER 1) · CALENDAR (VER 1) · QUOTE · PROMPTER
  · Time: scalar prefs LWW via smtime (style, pomodoro
    durations, sound), zones entity-union + tombstones,
    runtime states NOT synced. Alarms DEVICE-LOCAL BY DESIGN
    (intent for THAT device to ring); shell engine
    window.orosAlarms survives iframe close (localStorage
    "oros-alarms"), NOT browser close. Alarms SYNCED via shell
    slice since 0.32.00.
  · Calendar: events {id,mtime,...} + tombstones in
    state.deleted; edit-after-delete cancels the tombstone.
  · Quote: quotes/clients/templates/payMethods entity
    collections + shared tombstone map. Computed totals PURE
    functions (never stored → no arithmetic merge conflicts).
    Numbering OFF-YYYY-NNN recovery-based max scan. sliceGet
    strips activeQuoteId.
  · Prompter: 100 built-ins embedded, customs as entities;
    favorites/completed sets; tombstone resurrection on
    re-favorite/re-complete.

STORAGE (VER 1)
  { ver, ents: [{ id, type(space|room|furniture|position|item),
    name|bi, parentId, pos, qty?, note?, mtime, del }] }
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
  · Views (List/Calendar/Stats) device-local prefs — UI pref ≠
    data, NEVER in the slice.

WEATHER (VER 1)
  { ver, sm, om, active, deleted:{id→ts},
    cities:[{id,label,lat,lon,mtime,pos}],
    shellWx: <fingerprint|null>, units:"metric"|"imperial" }
  units is RENDER ONLY — cache + slice always metric.
  Payload cache (device-local, MAX 6): oros-weatherapp-cache.


╔══════════════════════════════════════════════════════════╗
║  PART V — SYNC ARCHITECTURE + DATA SAFETY SUPREMACY      ║
╚══════════════════════════════════════════════════════════╝

──────────────────────────────────────
11. SYNC ENGINE — sync.js v0.9.0 (Zero-Knowledge Sync v0.9)
──────────────────────────────────────
SECURITY MODEL (ABSOLUTE — non-negotiable)
  · Zero user tracking. No cookies, no analytics, no telemetry.
  · Zero-knowledge: passphrase NEVER leaves the client.
  · E2EE: AES-GCM client-side encryption; Dropbox tokens used
    ONLY for file I/O (PKCE flow, localStorage fallback).
  · Vault: oros-vault-data (sealed sync secrets) + IndexedDB
    non-extractable keys (store "keys").
  · ALL synced third-party-cloud data MUST be E2EE — never
    plaintext files (standing requirement for ANY future
    provider: Google Drive, OneDrive, pDrive, Box…).

ZK v0.9 HARDENING (v0.30.03)
  · changePassphrase(oldPw,newPw,remember): typed old-
    passphrase verification (never in-memory reuse), re-encrypts
    cloud, dirty flag survives.
  · ensureCloudReadable(): PUSH GUARD on ALL push paths
    (tab-hide, shortcut, manual) — verifies cloud blob decrypts
    before encrypting.
  · Trust window: lastSuccessfulPullAt (<30s skips redundant
    verification). pwEpoch tracking (oros-sync-pw-epoch) +
    detectPwEpochMismatch(). errorKey() maps OperationError +
    wrong-passphrase → sync.err.passphrase.
  · Dialogs: showChangePassDialog / showPassChangedDialog.

SLICE REGISTRATION (apps → engine)
  api.registerSlice(<id>, sliceGet, sliceSet, STORAGE_KEY,
    mergeFn)  — 5 args.
  · sliceGet(): deep-copy state (JSON.parse/stringify).
  · sliceSet(data, info): migrate → guard validity → write →
    re-render live → NEVER markDirty (R6). Sanitize view state
    after remote deletes (climb to surviving ancestor, drop
    orphaned editing targets).
  · markDirty funnel: window.__orosSyncApi.dirty() with
    _suppress flag (guards echo loops).
  · Engine: collectPayload()/applyPayload() = the unified
    funnel for cloud sync, manual export, auto-snapshots,
    folder mirroring — one funnel, zero divergence.
  · Baselines djb2 per slice; divergence guard for mergeless
    slices: unpushed = dirty OR missing baseline OR mismatch.
  · reconcile(reason) triggers: boot / interval / visible /
    online / register / debounce (DEBOUNCE_MS=5000).
  · ACCEPTED LIMIT: two offline devices with apps closed
    converge only via a live open (merge needs app code).

SHELL SLICE (synced): { lang, theme, skin, wallpaper,
  syncInterval, autoexport, weather, alarms } — getter reads
  live state; setter applies pulled values, NEVER marks dirty.

OROSFS (fs.js v0.1.0, Wave 1)
  window.orosFS — virtual file system, one mount (/internal).
  OPFS primary, IndexedDB "oros-ofs" fallback, identical
  promise API: read/readText/write/writeText/ls/mkdir/rm/mv/
  stat + usage(). Full-disk export (portable JSON, base64)
  + import (MERGE by default, never deletes absent files;
  {wipe:true} only destructive mode). No sync registration yet.
  ZERO-CONTACT: no existing keys/DBs touched. fs.js must be in
  the manual commit (bot never stages untracked files).

──────────────────────────────────────
12. DATA SAFETY SUPREMACY (the zero-loss guarantee)
──────────────────────────────────────
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
    export to a preset folder (manual-only option available) +
    on-close auto-sync safety net + beforeunload warning when
    dirty + online.
  · FACTORY RESET: double confirmation → suspend → cloud →
    folder → localStorage prefix sweep → OrosFS wipe ("oros-ofs"
    IDB) → marker → reload; tombstones EVERYTHING that ever
    lived + rebirths seeds with fresh mtimes (merge-proof).
  · CORRUPTION: rescue backup before any reseed (e.g.
    oros-storage-data-broken, oros-habits-data-broken).
  · BACKWARD COMPATIBILITY: updates to deployed apps NEVER lose
    user data; migrations additive-only; schemas carry forward
    unknown fields.


╔══════════════════════════════════════════════════════════╗
║  PART VI — SHELL SUBSYSTEMS + PALETTE CONTRACT           ║
╚══════════════════════════════════════════════════════════╝

──────────────────────────────────────
13. SHELL SUBSYSTEMS (where things live in shell.js)
──────────────────────────────────────
§9  scToast(kind, text)   taskbar toast, top:44px, z 1400,
    single-slot, palette-var styles. Wired into
    setSyncMsg/setSyncMsgRaw — every sync/shortcut/weather
    message visible anywhere. Linux convention: toasts pin
    top-right below the clock. App toast wrapper: lazy-create
    div on body, text FIRST action-button SECOND (wipe
    textContent before append), 5s timeout, action callback
    fires + hide.
§9b SYNC DOT             taskbar dot, states via data-state:
    off/locked/idle/syncing/synced/dirty/err. CLICK =
    syncNowFromDot() (pull then push-if-dirty) — does NOT open
    the menu. Per-app sync indicators REMOVED — single taskbar
    dot represents everything.
§9c SHORTCUTS            SC_DEFS single source of truth;
    window.orosShortcuts.handle(e) public contract; shell owns
    ALL handlers (Contract Β), apps forward (template Part
    VII). Bindings: P push · O pull · S snapshot · X export ·
    I info · U updates · L language · R reconnect. Info modal
    table derives from SC_DEFS.
§9d WEATHER WIDGET       Open-Meteo (no key, no cookies).
    Offline = slashed-cloud SVG, NO temperature, never fake
    numbers. GPS (user-activated) or manual city. Settings
    travel in shell slice; cache device-local.
ALARMS (window.orosAlarms): shell-owned engine — firing
    survives iframe close + page reloads; fully closed browser
    = nothing rings (honest limit). Daily repeat advances to
    NEXT future firing (catch-up loop, no notification
    storms). Snooze +9min one-shot button on the shell alarm
    toast. Notification spam cap 30s. Alarms SYNCED (shell
    slice) since 0.32.00.
INFO MODAL: version pill, tagline, capabilities, shortcuts
    table (invisible two-column table for mobile alignment),
    repo link, credits LINKED to koulaxizis.gr,
    external-services disclosure (Open-Meteo).
TASKBAR: 24h clock. #bar-time opens Time, #bar-date opens
    Calendar (single click, no desktop hop; menu fallback if
    stale apps.json; legacy #bar-clock fallback). Version
    badge lives in the info modal, NOT the taskbar.
MENUS: app menu doesn't close on every click. "Install orOS" /
    "Update orOS" separate from skin/theme settings.

──────────────────────────────────────
14. PALETTE CONTRACT & COLOR VOCABULARIES
──────────────────────────────────────
IFRAME PALETTE CONTRACT (CI-ENFORCED, G3)
  inheritPalette() MUST read
  window.parent.document.documentElement and mirror data-theme
  from the parent + copy palette vars via style.setProperty per
  variable (NEVER cssText += — it appends duplicates).
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
  take its own accent (Notes #d4af37, Weather default lumo
  #6d4aff) but adopts the OS THEME (light/dark); palette
  follows OS theme switching, synced via shell slice.

SYSTEM ACCENT: --accent (skin-dependent). orOS gold default;
  "lumo" purple skin (#6d4aff) among 16 skins.

LABEL_COLORS (8-color, shared Notes/To-Do/Mood/Habits):
  #e06c75 #ecc75f #87cf3e #4fc4cf #6d4aff #e09ecf #f28c5a
  #9aa4b0

MOOD EMOTIONS (9, immutable — statistics need a stable
dictionary; tile carries the hue, glyph is currentColor):
  happy #87cf3e · calm #51a2da · excited #8c5ec7 ·
  sad #5277c3 · angry #e06c75 · anxious #e0a44c ·
  tired #9aa4ae · stressed #ff7043 · numb #6d4aff

MOOD HABITS (21, triadic null|"yes"|"no"):
  basics: water, food, sleep, move, som, caf, alc, scr, meds
  rituals: meditate, read, tv, music, games, cook, walk, nap,
            journal, chores, bedtime, outdoor
  UI: two titled sections (Basics / Rituals); re-tap active
  chip = unknown. Keys 'Σημαντικό'/'Επείγον' auto-tag with
  priority chips red/orange/green (To-Do).

MOOD SEEDS (deterministic ids, bi {en,el}):
  loc: At home/Στο σπίτι, At work/Στη δουλειά, Outdoors/Στη
       φύση, Commute/Μετακίνηση, Café & bars/Καφέ & μπάρες
  person: Alone/Μόνος, Partner/Σύντροφος, Kids/Παιδιά,
          Family/Οικογένεια, Friends/Φίλοι, Colleagues/Συνάδελφοι
  trig: Work deadline/Προθεσμία, Argument/Έριδα, Good news/
        Καλά νέα, Exercise/Άσκηση, Sick day/Μέρα αρρώστιας,
        Late screens/Οθόνες αργά


╔══════════════════════════════════════════════════════════╗
║  PART VII — CANONICAL NEW-APP TEMPLATE                    ║
╚══════════════════════════════════════════════════════════╝

──────────────────────────────────────
15. PROCESS (how a new orOS app is born)
──────────────────────────────────────
  1. Design discussion FIRST: purpose, needs, justification as
     a standalone app (collaborative, mutual questions until
     consensus). Numbered feature proposals → user approves →
     assistant may own design polish when functionality/
     usability are the priority.
  2. Start from a BARE MINIMUM core ("nothing else"),
     localStorage only. Expand in WAVES. New features ship
     AFTER the current wave's pre-completion checklist (R18).
  3. New apps are BUILT FROM SCRATCH (or clean-room ports of
     beta apps used as functional reference ONLY — zero code
     carried over, "inspiration" role).
  4. After every wave: full changelog entry. Unimplemented but
     non-conflicting features → backlog "under consideration".
  5. Deep audit before release: dead code, orphans, logic
     errors → numbered findings → user approves → bulk fixes.

FILE STRUCTURE (per app)
  <app>/index.html   minimal markup, EMPTY icon buttons (R9),
                      cache-busted app-local refs ?v=x.y.z
                      (MANUAL bumps, R20)
  <app>/<app>.css    :root palette fallbacks (standalone),
                      scrollbar standard + [hidden] guard (VIII)
  <app>/<app>.js     IIFE, "use strict", ES5 — sections:
                      1 constants/i18n/icons/helpers
                      2 data model + storage
                      2b merge engine
                      3 capture/render flow
                      4 sync slice + palette
                      5 wiring & boot

──────────────────────────────────────
16. CANONICAL PATTERNS (verbatim contracts from mood.js v0.27.00)
──────────────────────────────────────

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
  sliceSet(): suppress ON → write → OFF → sort/normalize →
  sanitize view state (orphaned editing target → reset) →
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
  mergeUnionList: map by id, loser detection, tombstone filter
  (alive if mtime > tomb ts). Entries sort DESC ts.
  Column/order values: om-larger side donates positions.
  Strict normalizers for merge-time validation DROP invalid
  rows — never inject volatile defaults (uid/Date.now()
  inside merge = non-determinism bug).

I18N: inline STRINGS = { en:{...}, el:{...} } inside the app;
  t(key) with en-fallback. App names/menu entries =
  translations.js app.<id> (en+el). Escape user text via esc()
  before innerHTML. Locale el-GR / en-GB; Greek dates have NO
  comma after the day.

DIALOGS: native <dialog>, created via createElement,
  showModal(), close on outside click + Esc, Delete button
  gets focus. Double confirmation for destructive factory
  resets (tombstone-everything, merge-proof).

TOAST: lazy-created singleton on document.body, top-right
  (top: calc(12px + env(safe-area-inset-top))), text node
  first, optional action button second, 5s auto-hide.

FORM REBUILD DISCIPLINE (buildCapture pattern): read previous
  input values + scrollTop BEFORE innerHTML="", rebuild,
  restore — mid-form re-renders never lose drafts or jump
  scroll.

FRESHNESS/FILTER VIEW STATE: session-only variables
  (searchQ, filters, open dialogs) — reset them in factory
  reset (ghost views die with their data) (R10).


╔══════════════════════════════════════════════════════════╗
║  PART VIII — UI STANDARDS (orOS-wide, permanent)         ║
╚══════════════════════════════════════════════════════════╝

SCROLLBAR STANDARD (mood.css §6b — every app, scoped to its
main scroll container): 10px, transparent track, pill thumb
999px radius with 2px border var(--bg), hover var(--accent);
Firefox scrollbar-width:thin + scrollbar-color. Applied to:
todo #list-scroll, kanban #columns + .col-body, notes panes,
quote global + tab panes, weather #hourly, time #tmain,
calendar #cmain.
HIDDEN AUTHORITY GUARD: every app CSS ends with
  [hidden]{display:none!important} (defense-in-depth over
  per-element :not([hidden]) guards).
OVERSCROLL: overscroll-behavior:contain on main scroll panes.
DIALOGS: no native alert/confirm/prompt (R14). Outside-click +
  Esc close. Commit-on-submit (Esc/backdrop = discard).
  Zero-edit close must NOT stamp mtime (no LWW locks).
ICONS: inline SVG everywhere — Fork Awesome ABANDONED. SVGs
  carry viewBox + explicit sizing (.ico 16px) or width/height
  attrs (never viewBox-only → 300×150 default).
TOASTS: top-right, below clock/taskbar, lazy singleton,
  single-slot replacement (§9).
LANG: EN/EL only. Language switch updates OPEN apps live
  (broadcast), placeholders included. Dates follow active
  language (EL: ηη/μμ/εεεε, no comma after day).
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


╔══════════════════════════════════════════════════════════╗
║  PART IX — RELEASE PIPELINE + ALL CHECKLISTS             ║
╚══════════════════════════════════════════════════════════╝

──────────────────────────────────────
17. PIPELINE — .github/workflows/bump-version.yml (v3)
──────────────────────────────────────
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
  COVERED BY ACTION: CACHE_VERSION, manifest, root-level ?v=.
  MANUAL BY DESIGN: shell.js APP_VERSION only; app-local ?v=
  in <app>/index.html (R20). Bot never stages untracked files
  — NEW files must be in the manual commit.

CHECKLIST A — VERSION BUMP (every release)
  1. shell.js: APP_VERSION (+ banner text, same commit).
  2. Push to main. CI stamps everything else.
  3. Verify on BOTH devices (Info modal + boot marker).
  4. CHANGELOG entry for the release (R21) + Bible sync if
     any contract/decision shipped with it (R22).

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
  8. Shortcut forwarding listener (Contract Β template, VII)
  9. CHANGELOG entry + Bible registry update (Part III)
  NOTHING in bump-version.yml — ?v= auto-stamped (root refs).

CHECKLIST C — SYNC ENGINE CHANGES: version bump only; re-read
  the DEPLOYED file (cachebust fetch) before diagnosing —
  stale SW caches impersonate bugs (R3/R13).

CHECKLIST D — RELEASE PRE-FLIGHT
  · node --check every touched JS; JSON syntax validation.
  · Console: no SyntaxError; boot marker matches ?v=.
  · Shortcuts smoke test in EACH app (incl. forwarding).
  · Deploy + version check on BOTH devices.
  · PWA update path: welcome toast shows version; update via
    Update orOS button; verify desktop AND mobile.
  · CHANGELOG entry written (R21); Bible current (R22).

CHECKLIST E — PRE-COMPLETION (per app/wave, R18)
  ☐ Perfect sync: push-pull both directions, no data loss
  ☐ Tombstone resurrection after multi-device delete
  ☐ Offline edits survive reconnect
  ☐ Full local export zero-loss (manual + auto + snapshot)
  ☐ Offline-first verified · ☐ Mobile-first verified
  All four pillars before the app/wave is "done".

CHECKLIST F — UNIVERSAL COMPLIANCE (every app, master audit)
  STRUCTURE & STATE: IIFE strict · header version + section
  map · storageKey "oros-<app>-data" synced · prefs separate
  device-local · DATA_VER + additive migrations ·
  normalizeState() idempotent.
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
║  PART X — BACKLOG + RELEASE HISTORY + HANDOFF           ║
╚══════════════════════════════════════════════════════════╝

──────────────────────────────────────
18. KNOWN GAPS + IMMEDIATE QUEUE
──────────────────────────────────────
PROMPTER (97% compliant — 3 patches pending):
  · Dead empty.stats branch in renderStats() → delete
  · CSS version comment stale → v0.33.05
  · Contract Β shortcut forwarding → add canonical template
NOTES (low priority): sort asymmetry (siblingListByParent
  ignores pinned); renamePage/notebooks native dialogs
  (cosmetic); import (.txt → page, ZIP → restore).
GLOBAL (future): export/import parity audit across apps ·
  manual snapshot visual distinction (Manual badge + dedicated
  delete) · unified shell-level toast API (orosToast).

──────────────────────────────────────
19. BACKLOG (recorded, not scheduled)
──────────────────────────────────────
Core / Sync
  · Hierarchical key rotation (transitional windows).
  · Cross-device notification for passphrase changes.
  · PW epoch PROACTIVE detection (eliminate OperationError).
  · Additional cloud providers (Google Drive, OneDrive,
    pDrive, Box) — E2EE mandatory.
  · Synced alarms with proper merge semantics (optional).
  · OrosFS Wave 2: File Manager app (UI over OrosFS) ·
    Wave 3: Dropbox mount (cross-device, E2EE).
Apps
  · Kanban: board color in column headers; search scope;
    mobile long-press board drag.
  · Notes: fuzzy backlink matching; read-mode links.
  · Mood: gentle reminders (orOS-open-only); weekly recap
    refinements; ghost-label Option B; PDF export polish.
  · Weather: per-hour graph view; radar integration.
  · Calendar: replace remaining native dialogs.
  · astro.js: coordination of storage slice (pending).
  · Quote: custom fields; CSV export; print styling; payment
    preset name/order editing.
  · Prompter Wave 5+: sprint timer, multi-prompt sessions,
    Markdown export, app-local keyboard shortcuts.
  · Storage Wave 2: Restock Center (low-stock thresholds,
    aggregated shopping list, one-tap restock);
    drag-and-drop; search/filters; "All items" flat view;
    manual reordering.
  · Habits: week-row calendar variant; heat intensity;
    per-habit weekly targets (Wave 4 — data model migration);
    streak freeze; Mood-habits bridge; PDF stats export;
    seeded bilingual starter habits.
New apps (planned, not started)
  · Pad (Notepad++-style: Python grammar, diff viewer).
  · Pagination/typesetting app (Scribus/InDesign/Affinity).
  · Public Domain Calculator (country presets, GR default,
    Wikipedia/web lookup for unknown publication dates).
  · Characters app (character design, traits, relations).
  · Cycle (women's health: cycle, symptoms, meds, irregularities).
  · Desk suite (linux-OS-style desktop — experimental).
  · Native Windows/Android conversion of selected apps
    (decision pending flawless PWA validation).

──────────────────────────────────────
20. RELEASE HISTORY (condensed — newest first)
──────────────────────────────────────
  v0.32.15 — Alarm snooze (shell): +9min one-shot on shell
    alarm toast. Time closed v0.1.1d–e (quick-zone chips i18n,
    STR restoration — R11 lesson).
  v0.32.14 — Quote ICONS entry; system-wide scrollbar +
    [hidden] standard.
  0.32.00 — Alarms synced via shell slice (sanitization +
    markDirty); Kanban archived/color merge survival; all-app
    sync audit (8 apps verified, registry aligned); unified
    sync funnel confirmed.
  Habits v0.1.0 (orOS v0.33.0) — clean-room port; data model
    {habits, comps}; schedule-aware streaks; strict mergeRows;
    R14 dialogs; 16 icons; deterministic seeds planned.
  Habits v0.2.0 (v0.34.00) — Calendar view (month × habits
    grid, sticky gutter, future-locked, one data path).
  Habits v0.3.0 (v0.35.00) — Stats view (overview cards,
    per-habit rates, natural-language insights, 30/90/all
    ranges), habit identity colors inline in both views.
  fs.js v0.1.0 — OrosFS Wave 1 (OPFS + IDB fallback, merge
    import, factory-reset leg, zero-contact guarantee).
  Prompter 0.2.1–0.2.3 — tag suggestions, Ctrl+Enter save,
    modal CSS fixes, mobile media queries, dead-CSS removal
    (search-row/sec-title), font/tab-title notes.
  v0.31.00 — Time & Calendar apps; taskbar shortcuts
    (#bar-time/#bar-date). Time v0.1.1 lessons: stale-bundle
    cross-version mix → boot markers (R11 exemplar).
  v0.30.03 — Zero-Knowledge Sync v0.9 (push guard, passphrase
    change, pwEpoch, trust window, errorKey mapping).
  Storage app v0.1.0–v0.1.2 — home inventory (flat ents,
    cascade tombstones, split-view desktop, mobile drill-down);
    post-audit wave (15 findings) incl. merge determinism #6
    (volatile-defaults ban), sanitizeNav #3, palette
    live-watch parity.
  Quote app v0.1.00 — clean-room rewrite of "Offer": entities +
    shared tombs, pure computed totals, instalments,
    OFF-YYYY-NNN numbering, PDF (jsPDF + NotoSans Greek),
    mailto, 13 pre-release audit fixes.
  v0.27.00–v0.27.04 — Mood deep-review cleanup (deterministic
    seed ids, Greek PDF, SCRIPT_V at boot, single-pass boot,
    sync receipt toasts); cache strategy ignoreSearch removed;
    boot splash; info modal disclosures.
  v0.21–v0.26 — Mood evolution (tabs, insights, filters,
    triggers presets, habits/rituals split, versioning
    overhaul). Weather waves (units/UV/AQI/pager/
    autocomplete, timezone-correct now, undo delete).
  v0.18.x — Wave 3/4 shell (Contract Β shortcuts, sync dot,
    weather widget, info modal); 81 findings → 70 patches.
  v0.13–v0.17 — Notes app era (born, labels, exports,
    search/tags, wiki-links/backlinks).
  Pre-0.13 — To-Do, Kanban, sync engine genesis, PWA
    hardening, offline-first foundations.

──────────────────────────────────────
21. SESSION HANDOFF — template
──────────────────────────────────────
Copy this block into a new chat's first message:

  "Continuing orOS work. Read OROS_BIBLE.md Parts I–IX before
   touching anything. Current state: v<major.minor.patch>.
   Next task: <task>. Apps involved: <dirs>. I will paste any
   file you explicitly request — the Bible registries
   (Parts III–VIII) contain the contracts; request files only
   when the LIVE code state of a specific function matters."

The Bible IS the architecture reference — when a pattern
question arises ("how do we do X in orOS?"), the answer is in
Parts II–VIII; request a file only for verbatim code state.

──────────────────────────────────────
*Designed by Christos Koulaxizis — koulaxizis.gr*
*orOS — A static operating system in your browser*
*No tracking · No cookies · E2EE sync · Open source*