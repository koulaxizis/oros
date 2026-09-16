# orOS — MASTER CHANGELOG & ARCHITECTURE REFERENCE

Live: https://useoros.online · Repo: github.com/koulaxizis/oros
Designed by Christos Koulaxizis · koulaxizis.gr

THIS IS THE PRIMARY HANDOFF DOCUMENT BETWEEN CHATS. It contains
the mantra, all standing rules, every architecture contract, the
canonical app-development template, all registries (files, keys,
data models, palettes, sync, shell subsystems), the release
pipeline, checklists, backlog and release history.

READ FULLY BEFORE TOUCHING ANY FILE. It is dense on purpose —
every section exists because something broke once without it.

Document map:
  1. MANTRA
  2. STANDING PROCESS RULES (R1–R20)
  3. CURRENT STATE
  4. APP REGISTRY (all apps, versions, keys, merge types)
  5. FILE TREE & LOCALSTORAGE KEYS
  6. DATA MODELS (per app)
  7. SYNC ARCHITECTURE (engine v0.9.0 + contracts)
  8. SHELL SUBSYSTEMS (shortcuts, toast, sync dot, weather,
     info modal, alarms, shell slice)
  9. PALETTE CONTRACT & COLOR VOCABULARIES
  10. NEW APP DEVELOPMENT CONTRACT (canonical template — read
      this instead of requesting mood.js again)
  11. UI STANDARDS (orOS-wide)
  12. RELEASE PIPELINE & CHECKLISTS
  13. BACKLOG
  14. RELEASE HISTORY (condensed)

════════════════════════════════════════════════════════════
1. MANTRA (design contract — never violate)
════════════════════════════════════════════════════════════
  Offline first · Mobile first · No external dependencies ·
  Full project manual export · Full project automatic export ·
  Full project snapshots · Full project auto-merge sync ·
  No guessing: if unsure, ASK; if a file is missing, REQUEST
  it; never guess or assume.

════════════════════════════════════════════════════════════
2. STANDING PROCESS RULES (R1–R20)
════════════════════════════════════════════════════════════
DELIVERY & PATCHING
R1  NO WHOLESALE REGENERATION for fixes. Surgical patches
    (old block + new block + exact anchor) — regenerations
    dropped working code invisibly (v0.14.0). EXCEPTION (see
    Delivery Rule below): LARGE multi-edit changes or user-
    requested restructures ship as FULL corrected files.
R2  RELEASE RITUAL IS MANDATORY (§12). Stale bundles impersonate
    broken code. Strikes: v0.13.1, v0.14.1, v0.14.2.
R3  VERIFY THE RUNNING VERSION FIRST (Info modal Ctrl+Alt+Shift+I,
    boot marker in console) on BOTH devices before diagnosing.
R4  Before chaining a patch ON TOP of a previous patch, CONFIRM
    the previous one was applied. Never assume.
R11 Deliver patches against the USER'S CURRENT FILES, not
    remembered intermediate states. When in doubt, ship the
    COMBINED block rather than chained anchors.
R13 Local/deployed desync: CI bot commits version stamps — run
    `git fetch && git log --oneline -5 origin/main` and
    `git pull --ff-only` BEFORE diagnosing "version drift".

MERGE & SYNC DOCTRINE
R5  MERGES ARE SYMMETRIC: merge(A,B) === merge(B,A). Tie-breaks:
    mtime → lexicographic JSON/id — NEVER "local wins"
    (flip-flops between devices).
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
R10 Floating/transient views are SESSION-ONLY: search, filters,
    tag panels persist NOTHING (no prefs, no storage keys).
R12 SHORTCUTS: final contract Ctrl+Alt+Shift+letter, matched via
    e.code ("KeyP" — physical key, layout-agnostic; Greek layout
    makes e.key lie). Alt+Shift is DEAD (Windows layout toggle
    eats it). Ctrl+Shift+* is DEAD (browser steals: print/
    screenshot). SC_DEFS in shell.js §9c is the single source.
R14 NATIVE DIALOGS RETIRED: no alert()/confirm()/prompt() in any
    app. Themed custom dialogs + undo-toasts instead.
R15 BILINGUAL SEEDS: factory presets store bi {en, el}; display
    uses the ACTIVE language. A hand-rename KILLS bi permanently
    (the user's text is its only truth). Duplicate-detection must
    check BOTH label and colLabel spellings.
R16 DETERMINISTIC SEED IDS: two fresh installs that sync must
    NOT union into duplicate seeds ("seed-loc-0" style ids, not
    uid()). Label-normalized dedupe runs at merge time.
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

Standing delivery rule
  SMALL change → PALIO/NEO replacement blocks with exact
  anchors + precise placement instructions. LARGE change (many
  edits across one file) or user-requested restructure → FULL
  corrected file. Never mix: a full-file regeneration is never
  justified for a one-line fix, and a 20-patch series is never
  justified when the file is being restructured anyway.

════════════════════════════════════════════════════════════
3. CURRENT STATE — v0.32.15 (2026-09-15)
════════════════════════════════════════════════════════════
Core shell  : APP_VERSION in shell.js (single truth; CI stamps
              sw.js/manifest/root ?v= automatically).
Sync engine : sync.js v0.9.0 (Zero-Knowledge Sync v0.9 — see §7).
Skins       : 16 · Wallpapers: 15 (Desert Sand default).
Domain      : useoros.online ONLY (no alt domains).
Version surf: Info modal (Ctrl+Alt+Shift+I) + version toast.
Locale      : EN default, EL secondary. Dark default, light
              optional. 24h clock. EN/EL language switch chips.
Fonts       : Nunito woff2 vendored (5 weights, fonts/).
Platform    : https://useoros.online — static GitHub Pages, PWA
              (start_url "/?source=pwa", standalone, maskable
              icons, theme #1b1a18, bg #131820).

════════════════════════════════════════════════════════════
4. APP REGISTRY
════════════════════════════════════════════════════════════
App         | Dir       | Slice key / storage       | DATA_VER | Merge type
------------|-----------|----------------------------|----------|--------------------------
To-Do       | todo/     | oros-todo-data             | 3        | entity LWW + tombs
Kanban      | kanban/   | oros-kanban-data           | 5        | boards[] union, root tombs
Notes       | notes/    | oros-notes-data            | 2        | page/label LWW + tombs
Weather     | weather/  | oros-weatherapp-data       | 1        | merge-lite
Mood        | mood/     | oros-mood-data             | 3        | entity LWW + cols dedupe
Time        | time/     | oros-time-data             | 1        | entity union + scalar smtime
Calendar    | calendar/ | oros-calendar-data        | 1        | event union + tombs
Quote       | quote/    | (quote slice)              | 1        | entity union + LWW + tombs
Prompter    | prompter/ | oros-prompter-data         | 1        | union + LWW + tombs
Storage     | storage/  | oros-storage-data          | 1        | flat ents union + LWW + del
Slices with NO app open: registered via persisted registry —
data travels while apps are closed (v0.8 divergence guard
applies automatically). syncApi() resolution per R8.
Reference app (THE canonical template): mood/ v0.27.00 — every
contract in §10 is extracted VERBATIM from it. When in doubt,
"what does mood.js do?" is the tie-breaker.

════════════════════════════════════════════════════════════
5. FILE TREE & LOCALSTORAGE KEYS
════════════════════════════════════════════════════════════
REPO ROOT
  index.html            shell markup + SW lifecycle broker
                        (inline skipWaiting + controllerchange
                        reload) + boot splash
  shell.js              shell logic: menus, skins, wallpapers,
                        auto-backup, shell slice registration,
                        shortcuts §9c, weather §9d, sync dot
                        §9b, scToast §9, info modal, alarms
                        (window.orosAlarms), i18n, ICONS map,
                        APP_VERSION (SINGLE SOURCE OF TRUTH)
  style.css             shell stylesheet — skin palettes are
                        the CANONICAL palette vocabulary source
  sync.js               orOS sync engine v0.9.0
  translations.js       EN/EL shell strings (window.t)
  apps.json            app registry (id, name, url, icon,
                        category, type) — MUST stay valid JSON
  sw.js                 service worker: precache-all,
                        cache-first; CACHE_VERSION busts it.
                        PRECACHE_URLS must list every app file
                        (G2 guard fails the build otherwise)
  manifest.webmanifest  PWA (CI-stamped version)
  vendor/               jspdf.umd.min.js, NotoSans-Regular.ttf
  fonts/                Nunito woff2 (regular/medium/semibold/
                        bold/extrabold)
  todo/ kanban/ notes/ weather/ mood/ time/ calendar/ quote/
    prompter/ storage/  one dir per app:
                        index.html + <app>.css + <app>.js
  .github/workflows/bump-version.yml   release pipeline (v3)
  CHANGELOG.md          THIS FILE

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
    "oros-fs"    store "handles"  FileSystemDirectoryHandle
  App data (synced): see §4 registry (oro*-<app>-data keys)
  App device-local: oros-notes-prefs, oros-mood-seen,
    oros-weatherapp-cache (MAX 6 cities, NEVER synced),
    oros-storage-data-broken (corrupt-data rescue backup)
  DEVICE-LOCAL WHITELIST (intentionally excluded from sync):
    oros-wx-cache, oros-auto-snapshots, oros-fs-*, all
    *-prefs/*-cache/*-seen keys.

════════════════════════════════════════════════════════════
6. DATA MODELS
════════════════════════════════════════════════════════════
COMMON CONTRACTS (all apps)
  · Entities: { id, mtime, ... } — union by id, LWW by mtime,
    tie → lexicographic JSON/id. Tombstones: max-ts union,
    delete wins ties, newer edit resurrects.
  · ids: uid() = Date.now().toString(36) +
    Math.random().toString(36).slice(2,7). Seeds: deterministic
    ("seed-<col>-<i>") — R16.
  · Day keys (any calendar grouping): LOCAL calendar
    d.getFullYear()+"-"+pad(m+1)+"-"+pad(d) — no ISO/timezone
    bugs. pad() = leading zero helper.
  · Timestamp discipline: time-of-day & day boundaries DERIVE
    from entry ts at render time — never stored, never asked.

NOTES (DATA_VER 2)
  { ver, pages:[{id,parent,title,text,mtime,pos,labels:[]}],
    labels:[{id,name,color,mtime,pos}],
    tombs:{pageId→ts, "lbl:"+labelId→ts} }
  Merge: per-page/label LWW, 30d prune, normalizeState()
  idempotent, autosave debounce 500ms. Wiki-links [[Title]]:
    zero storage, regex-derived; solid chip = resolved,
    dashed chip = creation-on-click child page.

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
  · 9 fixed emotions (stable statistics vocabulary) — see §9.
  · Columns (loc/person/trig): {id,label,bi?,mtime,pos},
    seeded deterministically, renames kill bi, deletes are
    tombstoned, dedupeCols() at merge (normLabel =
    trim+lowercase+collapse-space, mtime winner, symmetric
    remap of entry references).
  · Entry order = DESC ts (derived at sort time, not pos).
  · sm = state mtime (server-style stamp), om = order mtime
    (position donation in merge: om-larger side wins).
  · Migration wave-1 booleans: true→"yes", false→null (the
    old unchecked state was never a conscious "no").

TIME (DATA_VER 1) · CALENDAR (DATA_VER 1) · QUOTE · PROMPTER
  · Time: scalar prefs LWW via smtime (style, pomodoro
    durations, sound), zones entity-union + tombstones,
    runtime states (timer/stopwatch/pomodoro) deliberately
    NOT synced. Alarms are DEVICE-LOCAL BY DESIGN (intent for
    THAT device to ring); shell-owned engine
    window.orosAlarms survives iframe close (localStorage
    "oros-alarms"), NOT browser close.
  · Calendar: events {id,mtime,...} + tombstones in
    state.deleted; edit-after-delete cancels the tombstone.
  · Quote: quotes/clients/templates/payMethods entity
    collections + shared tombstone map. Computed totals are
    PURE functions (never stored → no arithmetic merge
    conflicts). Numbering OFF-YYYY-NNN recovery-based max
    scan — no synced counters. sliceGet strips activeQuoteId.
  · Prompter: built-in 100 prompts embedded (10 categories,
    EN/EL handwritten), customs ride the slice as entities;
    favorites/completed are sets; tombstone resurrection on
    re-favorite/re-complete.

STORAGE (DATA_VER 1)
  { ver, ents: [{ id, type(space|room|furniture|position|
    item), name|bi, parentId, pos, qty?, note?, mtime, del }] }
  Flat entity array (no nesting — merge-friendly). Hierarchy
  enforced render-side: Space→Room→Furniture→Position→Item.
  Cascade delete tombstones every descendant with fresh
  mtime. qty floor Math.max(1,floor). sliceGet prunes
  tombstones >30d from the PAYLOAD only. Corrupt local data
  → rescue copy to oros-storage-data-broken before re-seed.

════════════════════════════════════════════════════════════
7. SYNC ARCHITECTURE — sync.js v0.9.0 (Zero-Knowledge Sync v0.9)
════════════════════════════════════════════════════════════
SECURITY MODEL
  · Zero-knowledge: passphrase NEVER leaves the client.
  · E2EE: AES-GCM client-side encryption; Dropbox tokens
    used ONLY for file I/O (PKCE flow, localStorage fallback).
  · Vault: oros-vault-data (sealed sync secrets) + IndexedDB
    non-extractable keys (store "keys").
  · All synced third-party-cloud data MUST be E2EE — never
    plaintext files (standing requirement for any future
    provider: Google Drive, OneDrive, Box…).

ZK v0.9 HARDENING (v0.30.03)
  · changePassphrase(oldPw,newPw,remember): explicit typed
    old-passphrase verification (never in-memory reuse),
    re-encrypts cloud, dirty flag survives.
  · ensureCloudReadable(): PUSH GUARD on ALL push paths
    (tab-hide, shortcut, manual) — verifies cloud blob
    decrypts with current passphrase before encrypting.
  · Trust window: lastSuccessfulPullAt (<30s skips redundant
    verification). pwEpoch tracking (oros-sync-pw-epoch) +
    detectPwEpochMismatch(). errorKey() maps OperationError +
    wrong-passphrase → sync.err.passphrase (no misleading
    "check connection").
  · Dialogs: showChangePassDialog / showPassChangedDialog.

SLICE REGISTRATION (apps → engine)
  api.registerSlice(<id>, sliceGet, sliceSet, STORAGE_KEY,
    mergeFn)  — 5 args, sync.js v0.7+.
  · sliceGet(): deep-copy state (JSON.parse/stringify).
  · sliceSet(data, info): migrate → guard validity → write →
    re-render live → NEVER markDirty (R6). sanitize view state
    after remote deletes (climb to surviving ancestor, drop
    orphaned editing targets).
  · markDirty funnel: window.__orosSyncApi.dirty() wrapper
    with _suppress flag (guards echo loops).
  · Engine: collectPayload()/applyPayload() is the unified
    funnel for cloud sync, manual export, auto-snapshots,
    folder mirroring — one funnel, zero divergence.
  · Baselines djb2 per slice; divergence guard for mergeless
    slices: unpushed = dirty OR missing baseline OR mismatch.
  · reconcile(reason) triggers: boot / interval / visible /
    online / register / debounce (DEBOUNCE_MS=5000).
  · ACCEPTED LIMIT: two offline devices with apps closed
    converge only via a live open (merge needs app code).

SHELL SLICE (synced): { lang, theme, skin, wallpaper,
  syncInterval, autoexport, weather } — getter reads live
  state; setter applies pulled values, NEVER marks dirty.

════════════════════════════════════════════════════════════
8. SHELL SUBSYSTEMS (where things live in shell.js)
════════════════════════════════════════════════════════════
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
    §10). Bindings: P push · O pull · S snapshot · X export ·
    I info · U updates · L language · R reconnect. Info modal
    table derives from SC_DEFS — one entry changes everything.
§9d WEATHER WIDGET       Open-Meteo (no key, no cookies).
    Offline = slashed-cloud SVG, NO temperature, never fake
    numbers. GPS (user-activated) or manual city. Settings
    travel in shell slice; cache device-local.
ALARMS (window.orosAlarms): shell-owned engine — firing
    survives iframe close + page reloads; fully closed
    browser = nothing rings (honest limit). Daily repeat
    advances to NEXT future firing (catch-up loop, no
    notification storms). Snooze +9min button on the shell
    alarm toast (one-shot, additive). Notification spam cap
    30s. Alarms SYNCED (slice in shell slice) since 0.32.00.
INFO MODAL: version pill, tagline "A static operating system
    in your browser", capabilities, shortcuts table, repo
    link, credits LINKED to koulaxizis.gr, external-services
    disclosure (Open-Meteo).
TASKBAR: 24h clock. #bar-time opens Time, #bar-date opens
    Calendar (single click, no desktop hop; menu fallback if
    stale apps.json; legacy #bar-clock fallback). Version
    badge lives in the info modal, NOT the taskbar.
MENUS: app menu doesn't close on every click. "Install orOS" /
    "Update orOS" separate from skin/theme settings.

════════════════════════════════════════════════════════════
9. PALETTE CONTRACT & COLOR VOCABULARIES
════════════════════════════════════════════════════════════
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
  Apps extend with their own (e.g. --panel-bg-light,
    --font-stack). Standalone = try/catch + :root fallback
  tokens in the app CSS (never transparent/unreadable).
  Each app MAY take its own accent (e.g. Notes #d4af37) but
  adopts the OS THEME (light/dark) — palette follows OS theme
  switching, sync via shell slice.

SYSTEM ACCENT: --accent (skin-dependent). orOS gold skin
default; "lumo" purple skin (#6d4aff) among 16 skins.

LABEL_COLORS (8-color, shared Notes/To-Do/Mood):
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

════════════════════════════════════════════════════════════
10. NEW APP DEVELOPMENT CONTRACT (canonical template)
════════════════════════════════════════════════════════════
PROCESS (how a new orOS app is born)
  1. Design discussion FIRST: purpose, needs, justification as
     a standalone app (collaborative, mutual questions until
     consensus). Present numbered feature proposals → user
     approves items (sometimes "all") → assistant may
     delegate design polish when functionality/usability are
     the priority.
  2. Start from a BARE MINIMUM core ("nothing else"),
     localStorage only. Expand in WAVES (feature sets
     activated sequentially). New features ship AFTER the
     pre-completion checklist (R18) of the current wave.
  3. New apps are BUILT FROM SCRATCH (or clean-room ports of
     beta apps used as functional reference ONLY — zero code
     carried over, "inspiration" role).
  4. After every wave: full changelog entry. Unimplemented
     but non-conflicting features → backlog as "under
     consideration".
  5. Deep audit before release: dead code, orphans, logic
     errors → numbered findings → user approves → bulk fixes.

FILE STRUCTURE (per app)
  <app>/index.html   minimal markup, EMPTY icon buttons (R9),
                      cache-busted app-local refs ?v=x.y.z
                      (MANUAL bumps, R20)
  <app>/<app>.css    :root palette fallbacks (standalone),
                      scrollbar standard + [hidden] guard (§11)
  <app>/<app>.js     IIFE, "use strict", ES5 — sections:
                      1 constants/i18n/icons/helpers
                      2 data model + storage
                      2b merge engine
                      3 capture/render flow
                      4 sync slice + palette
                      5 wiring & boot

CANONICAL PATTERNS (verbatim contracts from mood.js v0.27.00)

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
    inside merge = non-determinism bug, v0.1.0 storage #6).

  I18N: inline STRINGS = { en:{...}, el:{...} } inside the
  app; t(key) with en-fallback. APP names/menu entries =
  translations.js app.<id> (en+el). Escape user text via esc()
  before innerHTML. Locale: el-GR / en-GB; Greek dates have
  NO comma after the day (English does).

  DIALOGS: native <dialog>, created via createElement,
  showModal(), close on outside click + Esc, Delete button
  gets focus. Double confirmation for destructive factory
  resets (tombstone-everything, merge-proof).

  TOAST: lazy-created singleton on document.body, top-right
  (top: calc(12px + env(safe-area-inset-top))), text node
  first, optional action button second, 5s auto-hide.

  FORM REBUILD DISCIPLINE (buildCapture pattern): read
  previous input values + scrollTop BEFORE innerHTML="",
  rebuild, restore — mid-form re-renders never lose drafts or
  jump scroll.

  FRESHNESS/FILTER VIEW STATE: session-only variables
  (searchQ, filters, open dialogs) — reset them in factory
  reset (ghost views die with their data) (R10).

INTEGRATION CHECKLIST (every new app — files to touch)
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
  8. Shortcut forwarding listener (canonical template)
  9. CHANGELOG entry (this file)
  NOTHING in bump-version.yml — ?v= auto-stamped (root refs);
  app-local refs manual (R20).

════════════════════════════════════════════════════════════
11. UI STANDARDS (orOS-wide, permanent)
════════════════════════════════════════════════════════════
SCROLLBAR STANDARD (mood.css §6b — every app, scoped to its
main scroll container):
  10px, transparent track, pill thumb 999px radius with 2px
  border var(--bg), hover var(--accent); Firefox
  scrollbar-width:thin + scrollbar-color. Applied retroactively
  to: todo #list-scroll, kanban #columns + .col-body, notes
  panes, quote global + tab panes, weather #hourly,
  time #tmain, calendar #cmain. (DONE — backlog complete.)
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
  single-slot replacement (see §9).
LANG: EN/EL only. Language switch updates OPEN apps live
  (broadcast), placeholder texts included. Dates follow
  active language (EL: ηη/μμ/εεεε, no comma after day).
MOBILE: drills/filters/actions reachable single-thumb; toasts
  and dialogs sized for phones; long-press (450ms) /
  right-click context menus with visible affordances (Manage…
  buttons — never hidden-gesture-only).
DESKTOP: ≥1024px split views allowed (sidebar/tree + content).
AUTOSAVE: debounce, no explicit Save buttons for settings —
  real-time localStorage. Documents keep explicit save flows
  where semantics demand it.
VERSION BADGE: shell version lives in Info modal only.
BUTTONS: deleting = danger styling; undo via toast action
  (resurrection contract R17) preferred over confirmations.

════════════════════════════════════════════════════════════
12. RELEASE PIPELINE & CHECKLISTS
════════════════════════════════════════════════════════════
PIPELINE — .github/workflows/bump-version.yml (v3)
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
  MANUAL BY DESIGN: shell.js APP_VERSION only.

CHECKLIST A — VERSION BUMP (every release)
  1. shell.js: APP_VERSION (+ banner text, same commit).
  2. Push to main. CI stamps everything else.
  3. Verify on BOTH devices (Info modal + boot marker).
  NOTE: app-local ?v= in <app>/index.html = manual (R20).

CHECKLIST B — NEW APP: see §10 integration checklist (9 items).

CHECKLIST C — SYNC ENGINE CHANGES: version bump only; re-read
  the DEPLOYED file (cachebust fetch) before diagnosing —
  stale SW caches impersonate bugs (R3/R13).

CHECKLIST D — RELEASE PRE-FLIGHT
  · node --check every touched JS; JSON syntax validation.
  · Console: no SyntaxError; boot marker matches ?v=.
  · Shortcuts smoke test in EACH app (incl. forwarding).
  · Deploy + version check on BOTH devices.
  · PWA update path: welcome toast shows version; update via
    Update orOS button; verify on desktop AND mobile.

PRE-COMPLETION (per app/wave, R18): perfect sync · full
  export · offline-first · mobile-first — all four before
  "done".

════════════════════════════════════════════════════════════
13. BACKLOG (recorded, not scheduled)
════════════════════════════════════════════════════════════
Core / Sync
  · Unified shell-level toast API (orosToast) — cross-app.
  · Hierarchical key rotation (transitional windows).
  · Cross-device notification for passphrase changes.
  · PW epoch PROACTIVE detection (eliminate OperationError).
  · Additional cloud providers (Google Drive, OneDrive,
    pDrive, Box) — E2EE mandatory.
  · Synced alarms with proper merge semantics (optional).
Apps
  · Kanban: board color in column headers; search scope
    (active vs all boards); mobile long-press board drag.
  · Notes: import (.txt → page, ZIP → non-destructive
    restore); fuzzy backlink matching; read-mode links.
  · Mood: gentle reminders (orOS-open-only); weekly recap
    card refinements; ghost-label Option B for deleted
    column values; PDF export enhancements.
  · Weather: per-hour graph view; radar integration.
  · Calendar: replace remaining native dialogs (custom UI).
  · astro.js: coordination of storage slice (pending).
  · Quote: custom fields; CSV export; print styling of the
    create tab; payment preset name/order editing.
  · Prompter Wave 5+: sprint timer, multi-prompt sessions,
    Markdown export, keyboard shortcuts.
  · Storage Wave 2: Restock Center (low-stock thresholds,
    aggregated shopping list, one-tap restock);
    drag-and-drop moves; search/filters; "All items" flat
    view; manual pos-based reordering.
New apps (planned, not started)
  · Pad (Notepad++-style: Python grammar, diff viewer).
  · Pagination/typesetting app (Scribus/InDesign/Affinity).
  · Public Domain Calculator (country presets, GR default,
    Wikipedia/web lookup for unknown publication dates).
  · Habit Tracker (separate from Mood; possible Mood-model
    integration).
  · Characters app (character design, traits, relations).
  · Desk suite (linux-OS-style desktop: icons, custom
    shortcuts, full export-import) — experimental.
  · Native Windows/Android conversion of selected apps
    (decision pending flawless PWA validation).

════════════════════════════════════════════════════════════
14. RELEASE HISTORY (condensed — newest first)
════════════════════════════════════════════════════════════
## v0.32.15 (2026-09-15) — Alarm snooze (shell)
  Snooze +9min one-shot button on shell alarm notification
  (alarmNotify); Dismiss stays primary. No changes to
  alarmTick/daily catch-up/30s cap. Rolled in v0.32.14.

## v0.32.14 (2026-09-15) — Quote icon + system styling
  shell.js ICONS.quote (folded document + quotation strokes).
  Scrollbar standard + [hidden] guard applied system-wide.
  Time app closed v0.1.1d (translated quick-zone chips).

## [0.32.00] (2026-09-15) — Alarms synced + merge hardening
  Alarms ride the shell slice (alarmsRead/get/set +
  sanitization + markDirty triggers). Kanban archived/color
  fields survive merge. Application sync audits (all 8 apps
  verified, registry aligned). Unified sync funnel confirmed.
  Mood known issues filed → backlog.

## Storage app v0.1.2 — palette live-watch (mood.js parity)
  inheritPalette rewritten (data-theme mirror + setProperty
  per var; cssText+= bug eliminated); watchPalette observer;
  asset refs ?v=0.1.2. Verified: live skin switch repaint,
  standalone fallback intact, boot marker v0.1.2.

## Storage app v0.1.1 — post-audit Wave 1 core (15 findings)
  Desktop split-view grid moved body→.view (#1); .ico 16px
  sizing (#2); strict mergeRow drops invalid rows — merge
  determinism (#6); sanitizeNav climbs to surviving ancestor
  on remote delete (#3); :root standalone fallback (#4);
  corrupt-data rescue backup oros-storage-data-broken (#5);
  qty floor (#7); scroll reset targets .main-pane (#8);
  debounced resize (#9); themed delete dialog replaces
  confirm() (#12); dead code sweep (#15–19). Shortcut
  predicate #13 CLOSED (verified byte-identical vs mood.js
  v0.27.00 in-session).

## Storage app v0.1.0 — Wave 1 core (new app)
  Home inventory, Space→Room→Furniture→Position→Item, flat
  ents array, deterministic merge, cascade tombstones,
  mobile drill-down + desktop ≥1024px split view.

## [prompter] 0.2.0 — Wave 4: custom prompt editor
  CRUD modal, tombstone deletes, favorites/completed cleanup,
  "Mine" filter, factory reset covers it. Schema unchanged.

## Prompter Waves 1–3 — new app + data + tags
  Wave 1: 100 prompts (10 categories, handwritten EN/EL),
  browse/search/favorites/completed/daily, stats, sync slice.
  Wave 2: variations engine, 100 prompts corrected, 87
  constrained variations, EN/EL parity. Wave 3: 57-tag
  controlled vocabulary, tag chips/filter/suggestions,
  "Today" badge, day streak (grace rule), category stats
  fix (catTotal/catDone split).

## Quote app v0.1.00 — new app (clean-room rewrite of "Offer")
  Two tabs (Create/Quotes); quotes/clients/templates/
  payMethods entities + shared tombstones; pure computed
  totals; instalments with rounding-safe even split;
  OFF-YYYY-NNN numbering (recovery scan); deterministic
  payment presets; status accents; PDF (vendored jsPDF +
  NotoSans, Greek fallback to print); mailto send; 13
  post-audit fixes before release. Post-release polish wave:
  edit-client button, line-item headers, mobile grid areas,
  dead-code sweep.

## Time app v0.1.1(a–e) — 2026-09-15
  1.1: faces/fixes. 1.1a: root-caused stale-bundle
  cross-version mix (index v0.1.1 vs js v0.1.0); boot
  markers added. 1.1b: scrollbar standard adopted. 1.1c:
  astro divider dead row. 1.1d: quick-zone chips i18n
  (zoneKey→zoneName, renderChips refresh). 1.1e: restored
  STR eaten by the 1.1d patch (SyntaxError), half-done
  rename completed. LESSON (R11 exemplar): patches must be
  delivered against live files and chained only after
  predecessor confirmation.

## 0.31.00 — Time & Calendar apps
  Time: digital/analog/binary + flip/neon faces, world clock
  (21 presets), shell-owned alarm engine, timer/stopwatch/
  pomodoro, astronomy module (offline math). Calendar:
  Monday-first grid, event CRUD with tombstones from day
  one. Both self-register slices with deterministic merges;
  persisted registry → data travels while closed.
  Taskbar: #bar-time → Time, #bar-date → Calendar.

## v0.30.03 — Zero-Knowledge Sync v0.9
  Push guard (ensureCloudReadable on ALL push paths),
  changePassphrase with typed old-password verification,
  recovery dialogs, pwEpoch tracking, trust window (<30s),
  errorKey OperationError→passphrase mapping, contentDownload
  error handling. Zero breaking changes, additive-only.

## v0.27.04 — cache strategy + splash
  ignoreSearch removed from SW cache-first (?v= works);
  boot splash overlay; info modal external-services + mobile
  alignment; app-name translation fallback.

## v0.27.00 — Mood deep-review cleanup
  Edit-from-list tab switch; SVG repair; deterministic seed
  ids; Greek PDF via vendored NotoSans; SCRIPT_V captured at
  boot (currentScript null in handlers); draft survival;
  toast hygiene; empty-state localization; factory-reset
  view ghosts; single-pass boot; sync receipt toast. Core:
  info-modal listener leak; keydown bail when modal open;
  NotoSans precached. Decisions: privacy banner REMOVED,
  demo data console-only.

## v0.26.0 — Mood Wave 5 + versioning overhaul
  Trigger presets (DATA_VER 3, deterministic migration);
  factory seeds; smart preselection (facts-only, time-of-day
  bucket); habits/rituals split. Chip menu opacity fix; reset
  hygiene; scroll-jump fix. APP_VERSION single source of
  truth; CI reads-and-stamps only.

## v0.25.0 — Mood tabs + intelligence
  Capture/Entries/Insights tabs; co-occurrence pairs; top-6
  trigger trends; intensity trend; entries search; recap
  card; PDF export.

## v0.24.0 — Mood filters + trends engine
  Single-select filter groups (session-only); delta pts;
  streak/calendar unfiltered; guards (min 5/condition,
  12pt, top 6); weekday patterns; weekly momentum.

## v0.21.x — sync messaging honesty + Weather fixes
  Three-way pull outcomes; timezone-correct "now"; undo
  delete; NaN guards; UV/AQI legends; night icons.

## v0.19–v0.22 — Weather app waves
  0.2.0 units/UV/AQI/pager/autocomplete; 0.1.0 current +
  48h + 7-day + multi-city + offline honesty (Open-Meteo).
  Mood 0.1.0 core (9 emotions, columns, triads, guard, thread).

## v0.18.0–v0.18.2 — Wave 3 shell + Wave 4 audit
  Contract Β shortcuts (R12); sync dot; weather widget; info
  modal. 81 findings → 70 patches (kanban drag
  ReferenceError; dialog contracts; i18n reach; SW ignoreSearch).

## v0.13–v0.17 — Notes app era
  0.13 Notes born · 0.14 labels + palette · 0.15 exports
  (page .txt + notebook ZIP, store-method writer) · 0.16
  search + tags panel · 0.17 wiki-links + backlinks.
  
## [prompter] 0.2.1 — Wave 5 + 7
### Added
- Custom editor: known-tag suggestions (from 57-tag vocabulary) while
  typing the last fragment of the tags field; already-entered tags excluded;
  click-to-append; free-form custom tags still supported
- Custom editor: Ctrl/Cmd+Enter saves
### Considered (deferred — "under consideration")
- Per-app export of customs as JSON: skipped because the orOS core
  Database Export already covers the prompter slice (sync-safe, single
  export pathway). Revisit only if sharing customs with third parties
  becomes a use case.
  
  ## [prompter css] 0.2.2 — Polish pass
### Fixed
- .settings-dlg: rule existed only in JS className references, zero CSS —
  settings & custom editor dialogs rendered with white UA defaults in dark mode.
  Added shared modal base (+ ::backdrop, prim/danger variants)
### Removed
- Duplicate .daily-badge rule (outlined/gold variant) — conflicted with the
  primary accent-pill rule; JS pairs "badge daily-badge" classes
- Legacy gold #d4af37 fallbacks and gray rgba fallbacks in tag styles
  (copy-paste residue from notes palette)
### Added
- Section 7 "Mobile-first" media queries: single-column grid ≤480px,
  tighter breakdowns, smaller KPis, compact topbar
### Pending
- .search-row / .sec-title suspected dead CSS — awaiting prompter.html
  verification before deletion
  
  ## [prompter] 0.2.3 — Audit closure
### Verified
- prompter.html skeleton: all 6 IDs ($ hooks) present and matched;
  #stats hidden init correct; CSS/JS load order correct; version param
  consistent (v=0.32.20) across both assets
### Removed
- Dead CSS: .sec-title, .search-row (+ .search-row input rules) —
  confirmed absent from both HTML skeleton and JS-generated markup
### Notes
- Font: Nunito requested by CSS but not loaded in iframe — inherits
  system-ui fallback unless a font <link> matching other orOS apps is added
- HTML title is EN-only (fine for iframe context; shell owns tab title)

### v0.33.0 — Habits Wave 1 (List view) · orOS v0.33.0

**New app: Habits / Συνήθειες (v0.1.0)** — clean-room port of the beta
habit tracker (beta served as functional reference only; zero code carried).

- **Data model** (DATA_VER 1, key `oros-habits-data`): `{ ver, habits:[], comps:[] }`
  - habit: `{ id, name≤200, icon(16 SVG set), color(shared LABEL_COLORS 8),
    days:[0..6] MONDAY-first, mtime, del }`
  - comp (completion): `{ id:"<habitId>|<YYYY-MM-DD>", habitId, date, mtime, del }`
    — toggle-off = tombstone, re-toggle = resurrect (R17), LWW merge by id
  - days semantics: 7 = Daily · empty = Flexible (any day) · subset = N/wk
    REPLACES beta's broken tri-modal daily/weekly/custom (beta "weekly"
    was scheduled-every-day — audit #1)
- **Sync**: registerSlice("habits") · strict mergeRows (no volatile defaults) ·
  tombstone prune >30d in shipped payload only · local rescue backup to
  `oros-habits-data-broken` on corrupt data
- **Fixed vs beta**: schedule-aware longest streak (symmetric with current
  streak, audit #2) · localized months via Intl el-GR/en-GB (audit #4) ·
  graceful today-pending streak · no native confirm() (R14)
- **Stack**: `<dialog>` modals (lazy, language-refilled on open) · inline SVG
  only (R11) · delegated events · Monday-first hardcoded (platform convention,
  no weekStart setting) · palette inherit + watch (postMessage + MutationObserver)
  · global-shortcut forwarding (§10) · boot marker + orosHabits debug handle
- 16 icons: check, star, heart, fire, book, music, bulb, target, sun, moon,
  trophy, leaf, coffee, dumbbell, bed, run

**Under consideration (backlog):**
- Wave 2: Calendar view (month × habits grid)
- Wave 3: Stats view (schedule-aware rates, fixed totals math — audit #3
  deferred to that wave)
- Per-habit weekly targets (e.g. 5×/wk explicit goal vs flexible)
- Mood-app triadic habits ↔ Habits bridge
- Streak freeze / recovery mechanism
- Seeded bilingual starter habits for net-new installs

**Wave 1 acceptance checklist (R18):** ☐ push-pull sync both directions
☐ tombstone resurrect after multi-device delete  ☐ offline toggles survive
reconnect  ☐ full DB export includes oros-habits-data  ☐ ?v= cache-bust
verified on mobile PWA  ☐ palette follows shell skin swap live  ☐
language switch live re-render (list + dialogs + period label)

### v0.34.00 — Habits Wave 2 (Calendar view) · habits v0.2.0
- View switcher (List/Calendar segmented control) — pref in device-local
  `oros-habits-view`, deliberately OUTSIDE the sync slice (UI pref ≠ data)
- Month × habits grid: sticky gutter (name + streak), day-number header,
  today accented; month navigation ±1, "today" snap button (icon)
- Cells share the exact .wdot state vocabulary + toggle rules with the
  list view — ONE data path (toggleComp), two presentations
- Future days locked; unscheduled cells hollow/non-interactive (undo of a
  completed unscheduled day still allowed — symmetric with list)
- Gutter click = edit habit. Responsive: horizontal scroll + sticky
  gutter + compact cells ≤640px
- 6 new STRINGS (view/month/week nav tooltips) EN+EL; "Σήμερα" reuses
  existing `today` key
**Under consideration:** week-row variant (weekday-week sub-view),
heatmap intensity, per-habit zoom

### v0.34.00 — Habits Wave 2 (Calendar view) · habits v0.2.0
- View switcher (List/Calendar segmented control) — pref in device-local
  `oros-habits-view`, OUTSIDE the sync slice (UI pref ≠ data)
- Month × habits grid: sticky gutter (name + streak), day-number header,
  today accented; month navigation ±1, "today" snap button (icon)
- Cells share .wdot state vocabulary + toggle rules with list view
  — ONE data path, two presentations
- Future days locked; unscheduled cells hollow/non-interactive
- Gutter click = edit habit. Responsive: horizontal scroll + sticky gutter
- New strings (view/month/week nav) EN+EL; dead `empty.cal.*` keys remain
  but unused (cosmetic only)
- FIX: remove duplicate calView/setCalView block (dead code cleanup)
**Under consideration:** week-row sub-view, heat intensity overlay

────────────────────────────────────────────────────────────
SESSION HANDOFF — template
────────────────────────────────────────────────────────────
Copy this block into a new chat's first message:

  "Continuing orOS work. Read CHANGELOG.md §1–§12 before
   touching anything. Current state: v<major.minor.patch>.
   Next task: <task>. Apps involved: <dirs>. I will paste
   any file you explicitly request — the changelog registries
   (§4–§11) contain the contracts; request files only when
   the LIVE code state of a specific function matters."

The changelog IS the architecture reference — when a pattern
question arises ("how do we do X in orOS?"), the answer is
in §§4–11; request a file only for verbatim code state.

────────────────────────────────────────────────────────────

*Designed by Christos Koulaxizis — koulaxizis.gr*
*orOS — A static operating system in your browser*