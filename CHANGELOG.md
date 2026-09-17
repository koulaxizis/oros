# orOS — MASTER CHANGELOG & ARCHITECTURE REFERENCE

Live: https://useoros.online · Repo: github.com/koulaxizis/oros
Designed by Christos Koulaxizis · koulaxizis.gr

THIS IS THE PRIMARY HANDOFF DOCUMENT BETWEEN CHATS. It contains
the mantra, all standing rules, every architecture contract, the
canonical app-development template, all registries (files, keys,
data models, palettes, sync, shell subsystems), the release
pipeline, the FULL AUDIT LEDGER with open items, backlog and
release history.

READ FULLY BEFORE TOUCHING ANY FILE. It is dense on purpose —
every section exists because something broke once without it.

Document map:
  1. MANTRA
  2. STANDING PROCESS RULES (R1–R20)
  3. CURRENT STATE + VERSION LEDGER
  4. APP REGISTRY (all 13 apps, audit status)
  5. FILE TREE & LOCALSTORAGE KEYS
  6. DATA MODELS (per app)
  7. SYNC ARCHITECTURE (engine v0.9.1 + files-disk glue)
  8. SHELL SUBSYSTEMS (shortcuts, toast, sync dot, weather,
     info modal, alarms, shell slice, files-disk slice)
  9. PALETTE CONTRACT & COLOR VOCABULARIES
  10. NEW APP DEVELOPMENT CONTRACT (canonical template)
  11. UI STANDARDS (orOS-wide)
  12. RELEASE PIPELINE & CHECKLISTS
  13. AUDIT LEDGER & OPEN ITEMS ← read before continuing work
  14. BACKLOG
  15. RELEASE HISTORY (condensed, newest first)

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
    dropped working code invisibly (v0.14.0). EXCEPTION:
    LARGE multi-edit changes or user-requested restructures
    ship as FULL corrected files.
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
    uses the ACTIVE language. A hand-rename KILLS bi permanently.
    Duplicate-detection checks BOTH label and colLabel spellings.
R16 DETERMINISTIC SEED IDS: two fresh installs that sync must
    NOT union into duplicate seeds. Label-normalized dedupe runs
    at merge time.
R17 TOMBSTONE CONTRACT: deletes write tombstones; newer edits
    resurrect (fresh mtime beats tombstone); factory reset
    tombstones EVERYTHING that ever lived + rebirths seeds with
    fresh mtimes (merge-proof across devices).

QUALITY GATES
R18 PRE-COMPLETION CHECKLIST per app: perfect sync (no data
    loss), full local export (zero loss), offline-first,
    mobile-first — ALL four before the app is "done".
R19 VALIDATION: user pastes delivered code back for explicit
    correctness confirmation before committing to production.
    All exports (manual/auto/snapshot) must capture EVERY
    parameter and state variation — zero-loss recovery.
R20 VERSIONING (fully automated): the bump-version.yml v3
    workflow directory-scans EVERY index.html (root + app
    folders) and stamps every relative .css/.js ref with ?v=
    automatically. APP_VERSION in shell.js is the ONLY manual
    version (single source of truth, bumped in a dev commit);
    CACHE_VERSION, manifest and ALL ?v= refs are CI-stamped —
    never hand-edit those. Old "manual app-local bumps" rule
    described a pre-v3 workflow and is RETIRED.

Standing delivery rule
  SMALL change → OLD/NEW replacement blocks with exact
  anchors + precise placement instructions. LARGE change (many
  edits across one file) or user-requested restructure → FULL
  corrected file. Never mix: a full-file regeneration is never
  justified for a one-line fix, and a 20-patch series is never
  justified when the file is being restructured anyway.

════════════════════════════════════════════════════════════
3. CURRENT STATE — v0.34.08 lineage (2026-09-17)
════════════════════════════════════════════════════════════
Core shell  : APP_VERSION "0.34.08" (shell.js header, last
              delivered state). Single truth; CI stamps
              sw.js/manifest/root ?v= automatically.
Sync engine : sync.js v0.9.1 (Zero-Knowledge Sync v0.9.1 —
              see §7). Includes 409 empty-cloud fix + #S2
              baselines-from-payload patch (pending
              application — see §13 OPEN ITEMS).
Virtual disk: fs.js (OrosFS v0.1.0, OPFS + IDB fallback)
              + Files app + "files-disk" sync slice (§7).
Apps        : 13 in apps.json (todo, kanban, notes, weather,
              mood, time, calendar, quote, storage, prompter,
              characters, habits, files) — see §4.
Skins       : 16 · Wallpapers: 15 (Desert Sand default).
Domain      : useoros.online ONLY (no alt domains).
Version surf: Info modal (Ctrl+Alt+Shift+I) + version toast.
Locale      : EN default, EL secondary. Dark default, light
              optional. 24h clock. EN/EL switch chips.
Fonts       : Nunito woff2 vendored (5 weights, fonts/).
Platform    : static GitHub Pages PWA (start_url "/?source=pwa",
              standalone, maskable icons, theme #1b1a18,
              bg #131820).

VERSION LEDGER (reconciliation pending — §13, open):
  Recent entries used MIXED version labels: habits waves were
  tagged 0.34.00 / 0.35.00, files sync glue 0.34.07, Files app
  launch 0.35.00, while the delivered shell.js reads 0.34.08.
  These look like audit-cycle/app-wave labels rather than a
  clean APP_VERSION sequence. ACTION NEEDED: `git log` review
  to establish the actual APP_VERSION sequence and re-anchor
  the ledger. App-local ?v= refs observed: notes/index.html
  0.34.03 (open #44).

AUDIT POSTURE (full detail in §13):
  · Core audit #1–#16: CLOSED (all six core files).
  · App audits: todo #17–25 CLOSED, kanban #26–35 (2 open),
    notes #36–44 (2 open).
  · Second-pass shell+sync audit #S1–#S5 (S1 critical —
    verification pending, S2–S4 patches pending application,
    S5 decision pending).
  · Remaining apps (weather, mood, time, calendar, quote,
    storage, prompter, characters, habits, files): NOT yet
    deep-audited — the queued next phase.

════════════════════════════════════════════════════════════
4. APP REGISTRY (13 apps)
════════════════════════════════════════════════════════════
App       | Dir        | Slice / storage key      | VER | Merge type            | Audit
----------|------------|--------------------------|-----|-----------------------|---------
To-Do     | todo/      | oros-todo-data           | 3   | entity LWW + tombs    | DONE #17–25
Kanban    | kanban/    | oros-kanban-data         | 5   | boards[] union, tombs| DONE #26–35 (2 open)
Notes     | notes/     | oros-notes-data          | 2   | page/label LWW+tombs | DONE #36–44 (2 open)
Weather   | weather/   | oros-weatherapp-data    | 1   | merge-lite           | QUEUED
Mood      | mood/      | oros-mood-data           | 3   | entity LWW + cols    | QUEUED
          |            |                          |     | dedupe                |
Time      | time/      | oros-time-data          | 1   | entity union +        | QUEUED
          |            |                          |     | scalar smtime        |
Calendar  | calendar/  | oros-calendar-data      | 1   | event union + tombs  | QUEUED
Quote     | quote/     | (quote slice)           | 1   | entity union + LWW + | QUEUED
          |            |                          |     | tombs                |
Prompter  | prompter/  | oros-prompter-data      | 1   | union + LWW + tombs  | QUEUED
Storage   | storage/   | oros-storage-data       | 1   | flat ents union+del  | QUEUED
Habits    | habits/    | oros-habits-data        | 1   | habits/comps LWW +   | QUEUED (v0.3.0)
          |            |                          |     | tombs                |
Characters| characters/| (pending app audit)     | ?   | non-merge LWW +      | QUEUED
          |            |                          |     | divergence guard     |
Files     | files/     | oros-files-data (view   | 1   | files-disk slice:     | QUEUED (v0.1.x)
          |            | prefs only) +           |     | blob snapshot via    |
          |            | "files-disk" slice      |     | shell §9f (§7)       |
  · Slices with NO app open: registered via persisted registry —
    data travels while apps are closed (v0.8.1 divergence guard
    applies automatically). syncApi() resolution per R8.
  · Reference app (THE canonical template): mood/ v0.27.00 —
    every contract in §10 is extracted VERBATIM from it. When
    in doubt, "what does mood.js do?" is the tie-breaker.
  · Characters: apps.json lists it + precached; Bible Part XIX
    marks it ACTIVE; storage key + data model PENDING the
    scheduled deep audit (features section intentionally blank).

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
                        (window.orosAlarms), files-disk slice
                        §9f, i18n, ICONS map, APP_VERSION
                        (SINGLE SOURCE OF TRUTH)
  style.css             shell stylesheet — skin palettes are
                        the CANONICAL palette vocabulary source
  sync.js               orOS sync engine v0.9.1
  fs.js                 OrosFS v0.1.0 — virtual disk (OPFS
                        primary, IDB "oros-ofs" fallback);
                        loads BETWEEN sync.js and shell.js
  translations.js       EN/EL shell strings (window.t);
                        alarm.* keys migrated here (R9)
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
    prompter/ storage/ habits/ files/ characters/
                        one dir per app: index.html +
                        <app>.css + <app>.js (time/ also has
                        astro.js)
  .github/workflows/bump-version.yml   release pipeline (v3)
  CHANGELOG.md          THIS FILE

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
    oros-ofs-dirty           OrosFS dirty flag (swept by
                             factory reset oros- prefix)
  IndexedDB:
    "oros-vault" store "keys"     vault decryption key
    "oros-fs"    store "handles"  FileSystemDirectoryHandle
    "oros-ofs"   OrosFS fallback backend (OPFS primary —
                 invisible to the localStorage sweep; wiped
                 via wipeOrosFS() in factory reset)
  App data (synced): see §4 registry
  App device-local: oros-notes-prefs, oros-mood-seen,
    oros-weatherapp-cache (MAX 6 cities, NEVER synced),
    oros-storage-data-broken, oros-habits-data-broken
    (corrupt-data rescue backups), oros-habits-view,
    oros-habits-range (view prefs — never in the slice)
  DEVICE-LOCAL WHITELIST (intentionally excluded from sync):
    oros-wx-cache, oros-auto-snapshots, oros-fs-*,
    oros-files-disk-pending, all *-prefs/*-cache/*-seen keys.
    (NOTE: oros-files-disk-CACHE is the slice body — it IS
    synced content, not a whitelist member.)

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
  SliceSet merge rule (#38 fix): after a merge that includes
    LOCAL contributions, compare the applied state against the
    incoming payload — if different, markSyncDirty() so the
    merged result propagates back to the cloud (pure pulls
    skip the push-back).

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
  · Columns: {id,label,bi?,mtime,pos}, deterministic seeds,
    renames kill bi, deletes tombstoned, dedupeCols() at merge
    (normLabel = trim+lowercase+collapse-space, mtime winner,
    symmetric remap of entry references).
  · Entry order = DESC ts (derived at sort time, not pos).
  · sm = state mtime, om = order mtime (position donation in
    merge: om-larger side wins).
  · Migration wave-1 booleans: true→"yes", false→null.

TIME (DATA_VER 1) · CALENDAR (DATA_VER 1) · QUOTE · PROMPTER
  · Time: scalar prefs LWW via smtime, zones entity-union +
    tombstones; runtime states (timer/stopwatch/pomodoro)
    deliberately NOT synced. Alarms are SHELL-SLICE synced
    (see §8) — the RINGING INTENT is synced; the engine lives
    in the shell and survives iframe close.
  · Calendar: events {id,mtime,...} + tombstones in
    state.deleted; edit-after-delete cancels the tombstone.
  · Quote: quotes/clients/templates/payMethods entity
    collections + shared tombstone map. Computed totals are
    PURE functions (never stored → no arithmetic merge
    conflicts). Numbering OFF-YYYY-NNN recovery-based max
    scan — no synced counters. sliceGet strips activeQuoteId.
  · Prompter: 100 built-in prompts embedded (10 categories,
    EN/EL handwritten); customs ride the slice as entities;
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

HABITS (DATA_VER 1, key oros-habits-data, v0.3.0)
  { ver, habits:[], comps:[] }
  · habit: { id, name≤200, icon (16 SVG set), color (shared
    LABEL_COLORS 8), days:[0..6] MONDAY-first, mtime, del }
  · comp: { id:"<habitId>|<YYYY-MM-DD>", habitId, date, mtime,
    del } — toggle-off = tombstone, re-toggle = resurrect
    (R17), LWW merge by id.
  · days semantics: 7 items = Daily · empty = Flexible ·
    subset = N/wk. (Replaced beta's broken tri-modal model.)
  · View prefs oros-habits-view / oros-habits-range:
    DEVICE-LOCAL, deliberately OUTSIDE the slice.
  · Three views: List / Calendar / Stats — one data path
    (toggleComp), two completion presentations; Stats is
    read-only, range 30d/90d/all-time.

FILES (view prefs + transport blob)
  · oros-files-data: VIEW prefs only (expanded-tree keys etc.)
    — never user file content in localStorage.
  · "files-disk" slice body: JSON snapshot of the whole
    /internal disk {kind:"oros-files-disk", ...} staged in
    oros-files-disk-cache. BLOB MODEL — known limits: quota
    on very large disks (cache write keeps previous on
    failure), conflicts surface at app open / boot-flush,
    not mid-session. Per-entry model = documented future
    upgrade.
  · Content I/O: window.parent.orosFS only (OPFS + IDB
    fallback — see fs.js API in §15 OrosFS entry).

CHARACTERS — model PENDING deep audit (registry: non-merge
  LWW + divergence guard; key TBD).

════════════════════════════════════════════════════════════
7. SYNC ARCHITECTURE — sync.js v0.9.1 (ZK Sync v0.9.1)
════════════════════════════════════════════════════════════
SECURITY MODEL
  · Zero-knowledge: passphrase NEVER leaves the client.
  · E2EE: AES-GCM + PBKDF2 (100k rounds) client-side; Dropbox
    tokens used ONLY for file I/O (PKCE flow).
  · Vault: oros-vault-data (sealed passphrase) + IndexedDB
    NON-EXTRACTABLE key (store "keys"), opt-in per device.
  · All synced third-party-cloud data MUST be E2EE — never
    plaintext files (standing requirement for any future
    provider: Google Drive, OneDrive, Box…).

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

ZK v0.9/v0.9.1 HARDENING
  · changePassphrase(oldPw,newPw,remember): typed old-pass
    verification, re-encrypts cloud, dirty flag survives,
    pwEpoch increment, vault epoch update.
  · ensureCloudReadable(): PUSH GUARD on ALL push paths —
    never overwrite a cloud blob the current passphrase
    cannot decrypt (Trust window: lastSuccessfulPullAt <30s
    skips redundant verification).
  · contentDownload 409 contract (v0.9.1 CRITICAL): 409 =
    empty cloud (path/not_found) RETURNS the response — every
    caller (pull, ensureCloudReadable, changePassphrase)
    branches on res.status===409 itself. Genuine network
    TypeErrors are wrapped; intentional status errors pass
    through so errorKey() maps auth failures correctly.
  · errorKey() maps OperationError + wrong-passphrase →
    sync.err.passphrase (never "check your connection").
  · Dead code REMOVED: detectPwEpochMismatch()/setPWEpoch()
    (audit #12). Kept: getWVEpoch(), payload.meta.pwEpoch.
    Proactive pwEpoch detection remains backlog.

BASELINE CONTRACT (#S2 — patch delivered, application pending,
  see §13): push() records per-slice baselines from the
  PAYLOAD COLLECTED AT PUSH START, never from a re-read of
  live state. An edit landing mid-push would otherwise be
  falsely stamped "synced" while the cloud holds the older
  payload — defeating the divergence guard on the next pull.

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

SHELL SLICE (synced): { lang, theme, skin, wallpaper,
  syncInterval, autoexport, weather, alarms } — getter reads
  live state; setter applies pulled values, NEVER marks
  dirty (anti-loop contract). Alarms: sanitize on pull
  (past/duplicate "once" items dropped), wholesale replace.
  
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

§9e ALARMS               window.orosAlarms — shell-owned engine.
    Firing survives iframe close + page reloads; fully closed
    browser = nothing rings (honest limit). Daily repeat
    advances to NEXT future firing (catch-up loop, no
    notification storms). Snooze +9min button on the shell
    alarm toast (one-shot, additive). Notification spam cap
    30s. Alarms are SYNCED (slice in shell slice) since
    v0.32.00. i18n keys: alarm.title / alarm.snooze ({n}) /
    alarm.dismiss (EL+EN, migrated from hardcoded ternaries).

§9f FILES-DISK SLICE     (added v0.34.07) — transport-only
    JSON snapshot of /internal OPFS. NOT a sync.js change:
    shell owns the slice, files.js mutates → __orosFilesDiskTouched,
    cache refresh 1s debounced, remote while app closed
    stages + pending flag, consumes at boot with conflict
    handling. Divergence guard: unpushed local work parks
    remote in carry; local pushes as truth; remote flushes
    at next live merge-capable registration. Pill state
    follows engine cycles (idle → markClean).

INFO MODAL: version pill (reads shell.js APP_VERSION at boot),
    tagline "A static operating system in your browser",
    capabilities, shortcuts table (derives from SC_DEFS),
    repo link (clickable koulaxizis/oros), credits LINKED to
    koulaxizis.gr, external-services disclosure (Open-Meteo).

TASKBAR: 24h clock. #bar-time opens Time, #bar-date opens
    Calendar (single click, no desktop hop; menu fallback if
    stale apps.json; legacy #bar-clock fallback). Version
    badge lives in the info modal, NOT the taskbar.

MENUS: app menu doesn't close on every click. "Install orOS" /
    "Update orOS" separate from skin/theme settings.
    Restore Last Snapshot themed dialog (R14 compliant,
    replaces native confirm — shell.js audit #1).

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

LABEL_COLORS (8-color, shared Notes/To-Do/Mood/Habits):
  #e06c75 #ecc75f #87cf3e #4fc4cf #6d4aff #e09ecf #f28c5a #9aa4b0

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

FILES APP COLORS: inherits system --accent. No custom palette
  override (uses shared LABEL_COLORS for any tagging).

HABITS APP ICONS (16 SVG): check, star, heart, fire, book,
  music, bulb, target, sun, moon, trophy, leaf, coffee,
  dumbbell, bed, run. Colors: LABEL_COLORS 8.

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
                      (MANUAL bumps, see R20 revision —
                      CI now stamps these automatically)
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
  app-local refs auto-stamped too (R20 revised workflow v3).

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
  time #tmain, calendar #cmain, habits, files, storage.
  (DONE — backlog complete.)

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

FILES APP SPECIFIC: breadcrumb navigation + parent-up button,
  mobile slide-out tree drawer (<640px), status bar (item
  count, current path). Recursive delete confirmation via
  themed dialog (R14). Empty-folder ghost fallback to
  /internal root. Tree expansion state persisted in prefs
  (device-local, never in slice).

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
  COVERED BY ACTION: CACHE_VERSION, manifest, ALL ?v= refs.
  MANUAL BY DESIGN: shell.js APP_VERSION only.

CHECKLIST A — VERSION BUMP (every release)
  1. shell.js: APP_VERSION (+ banner text, same commit).
  2. Push to main. CI stamps everything else.
  3. Verify on BOTH devices (Info modal + boot marker).
  NOTE: app-local ?v= in <app>/index.html = AUTO-STAMPED
    now (workflow v3 revised R20 rule — old "manual" was
    pre-v3, RETIRED).

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
13. AUDIT LEDGER & OPEN ITEMS (READ THIS SECTION FIRST)
════════════════════════════════════════════════════════════
This is the ACTIVE working ledger. It contains EVERY finding
from the core and app audits, their status, and the EXACT
patches/decisions waiting for you. Before starting new work:

A. CORE AUDIT FINDINGS (#1–#16) — ALL CLOSED
┌─────┬──────────────────────────────────────────────────────┐
│ #   │ STATUS                                               │
├─────┼──────────────────────────────────────────────────────┤
│ 1   │ ✓ CLOSED — restoreLastSnapshot() R14 patch applied   │
│ 2   │ ✓ CLOSED — alarm i18n migration                      │
│ 3   │ ✓ CLOSED — translations.js header aligned            │
│ 4   │ ✓ CLOSED — registerShellSlice verified (3-arg ok)    │
│ 5   │ ✓ CLOSED — apps.json fetch caching documented        │
│ 6   │ ✓ CLOSED — sw.js header v0.27→v0.34.02 aligned       │
│ 7–10│ ✓ CLOSED — i18n key validation (shell.js audit)      │
│ 11  │ ✓ CLOSED — sync.js 409 empty-cloud fix (v0.9.1)      │
│ 12  │ ✓ CLOSED — dead code remove (detectPwEpochMismatch) │
│ 13  │ ✓ CLOSED — app.quote translation defensive keys     │
│ 14  │ ✓ CLOSED — sw.js precache 12/12 verified             │
│ 15  │ ✓ CLOSED — cross-check apps.json ↔ sw.js             │
│ 16  │ ⚠ OPEN — characters app registry status (Bible lag?) │
└─────┴──────────────────────────────────────────────────────┘

B. TO-DO APP AUDIT (#17–#25) — ALL CLOSED
┌─────┬──────────────────────────────────────────────────────┐
│ #17 │ ✓ R14 breach: 3 confirm() → themed dialog            │
│ #18 │ ✓ Merge safety: deleteLabel touch()s items + undo    │
│ #20 │ ✓ Rollover: visibilitychange midnight guard          │
│ #23 │ ✓ Palette: SWATCH_COLORS → LABEL_COLORS              │
│ #25 │ ✓ Boot marker + lang attr added                      │
│ #19 │ △ DEFERRED — undo-across-sync merge semantics        │
│ #21 │ ⊗ DECISION — priority keywords ('Σημαντικό'/       │
│     │   'Επείγον'): implement or strike from Bible?       │
└─────┴──────────────────────────────────────────────────────┘

C. KANBAN APP AUDIT (#26–#35) — 2 OPEN
┌─────┬──────────────────────────────────────────────────────┐
│ #26 │ ✓ R14 breach: 4 confirm() → themed dialog            │
│ #27 │ ✓ Undo consistency: deleteLabel got undo             │
│ #28 │ ✓ Palette: SWATCH_COLORS → LABEL_COLORS              │
│ #29 │ ✓ Dead code: boardTombstoneOf() removed              │
│ #30 │ ✓ Mojibake: 7 stray chars cleaned                    │
│ #31 │ ✓ Boot marker added                                  │
│ #32 │ ✓ duplicateBoard() calls renderManageList()          │
│ #33 │ ✓ createBoard() resets searchQuery+filters           │
│ #34 │ ⊗ DECISION — index.html ?v=0.34.03 vs batch 0.34.02: │
│     │   (a) CI post-push, (b) manual edit (R20 violation), │
│     │   or (c) separate workflow?                         │
│ #35 │ ⊗ DECISION — dead keys + "live editing" comment     │
└─────┴──────────────────────────────────────────────────────┘

D. NOTES APP AUDIT (#36–#44) — 2 OPEN
┌─────┬──────────────────────────────────────────────────────┐
│ #38 │ ✓ CRITICAL: sliceSet markSyncDirty() after merge     │
│ #42 │ ✓ Boot marker added                                  │
│ #41 │ ⊗ DECISION — 3 native confirm() R14 patches: approve?│
│ #44 │ ⊗ DECISION — ?v=0.34.03 discrepancy (same as #34)     │
└─────┴──────────────────────────────────────────────────────┘

E. SECOND-PASS SHELL + SYNC AUDIT (#S1–#S5) — PENDING APPLICATION
┌─────┬──────────────────────────────────────────────────────┐
│ #S1 │ ✓ CRITICAL: ICONS missing comma (habits/files) fixed │
│     │   — verification pending (paste back for confirm)   │
│ #S2 │ △ DELIVERED — baselines from PAYLOAD (not re-read)  │
│     │   — PATCH NOT YET APPLIED to your files            │
│ #S3 │ △ DELIVERED — wxPushToApp() now called after pull   │
│     │   — PATCH NOT YET APPLIED                         │
│ #S4 │ ✓ Cosmetic: applyPayload merged flag accurate      │
│ #S5 │ ⊗ DECISION — aurora wallpaper label "Αυγόρα"→      │
│     │   Σέλας/Αυγή? (looks like "Αγορά")                 │
└─────┴──────────────────────────────────────────────────────┘

F. QUEUED APP AUDITS (NEXT PHASE — NOT YET STARTED)
┌─────────────┬──────────────────────────────────────────────┐
│ App         │ Priority (recommendation)                   │
├─────────────┼──────────────────────────────────────────────┤
│ Weather     │ High — taskbar widget + app sync coupling   │
│ Mood        │ High — deepest data model, stats engine     │
│ Time        │ Medium — multiple views (analog/digital)    │
│ Calendar    │ Medium — event CRUD + tombs                 │
│ Quote       │ Medium — computed totals, numbering logic   │
│ Storage     │ Medium — cascade tombstones, corrupt rescue │
│ Prompter    │ Low — built-in prompts + customs            │
│ Characters  │ Low — registry pending audit                │
│ Habits      │ Medium — 3-view app, streak logic           │
│ Files       | High — OrosFS glue, blob sync limits        │
└─────────────┴──────────────────────────────────────────────┘

G. OPEN DECISION SUMMARY (USER RESPONSE NEEDED)
────────────────────────────────────────────────────────────
⊗ #21 (To-Do) — Priority keywords ('Σημαντικό'/'Επείγον' →
    red/orange/green chips). Options:
    (a) Implement as mini-wave (quick R14 + keyword parser),
    (b) Strike from Bible entirely,
    (c) Defer to future To-Do audit wave.

⊗ #34 / #44 (Kanban/Notes) — ?v=0.34.03 discrepancy. Need
    clarification: Did you manually edit the index.html
    (R20 violation), or was this CI-stamped post-push?

⊗ #41 (Notes) — Approve 3 confirm() → themed dialog patches?

⊗ #35 (Kanban) — Clean up unused keys + inaccurate comment?

⊗ #S5 (Shell) — Aurora wallpaper label replacement:
    "Σέλας" (Aurora) or "Αυγή" (Dawn)?

△ #19 (To-Do) — Undo-across-sync merge semantics. The
    proposal is in Bible §19 trade-offs. Do you want to
    tackle this now or defer indefinitely?

△ #S2 / #S3 — Sync engine critical patches (#S2 baselines,
    #S3 wxPushToApp) are DELIVERED but NOT yet applied to
    your live files. Confirm you've applied them, or request
    the exact OLD/NEW blocks again.

H. VERSION LEDGER RECONCILIATION NEEDED (§3)
────────────────────────────────────────────────────────────
Recent entries used MIXED labels:
  - Habits waves tagged 0.34.00 / 0.35.00
  - Files sync glue 0.34.07
  - Files app launch 0.35.00
  - Delivered shell.js reads 0.34.08

These appear to be AUDIT-CYCLE labels rather than a clean
APP_VERSION sequence. ACTION NEEDED: Run `git log` review
to establish the ACTUAL APP_VERSION sequence and re-anchor
the changelog. Should I prepare a git-log analysis snippet?

I. BACKLOG MIGRATION CHECK
────────────────────────────────────────────────────────────
All deferred/open items from audits have been moved to §13.
Backlog section (§14 below) now contains ONLY long-term
ideas, not active decisions. Review before proceeding.

════════════════════════════════════════════════════════════
14. BACKLOG (long-term ideas — not scheduled)
════════════════════════════════════════════════════════════
CORE / SYNC
  · Unified shell-level toast API (orosToast) — cross-app.
  · Hierarchical key rotation (transitional windows).
  · Cross-device notification for passphrase changes.
  · PW epoch PROACTIVE detection (eliminate OperationError).
  · Additional cloud providers (Google Drive, OneDrive,
    pDrive, Box) — E2EE mandatory.
  · Synced alarms with proper merge semantics (optional).
  · Per-entry file sync for OrosFS (replace blob model).
  · Navigation network-first timeout race (~4s to fallback).

APPS
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
  · Habits Wave 4: per-habit weekly targets (model change →
    migration plan required); week-row calendar variant;
    PDF stats export.
  · Files Wave 2: Drag-drop import, batch operations,
    Dropbox-mount sync for file content; file previews
    (text/images); advanced editor integration; search.

NEW APPS (planned, not started)
  · Pad (Notepad++-style: Python grammar, diff viewer).
  · Pagination/typesetting app (Scribus/InDesign/Affinity).
  · Public Domain Calculator (country presets, GR default,
    Wikipedia/web lookup for unknown publication dates).
  · Character app (deep audit pending) — already in apps.json.
  · Desk suite (linux-OS-style desktop: icons, custom
    shortcuts, full export-import) — experimental.
  · Native Windows/Android conversion of selected apps
    (decision pending flawless PWA validation).

════════════════════════════════════════════════════════════
15. RELEASE HISTORY (condensed — newest first)
════════════════════════════════════════════════════════════
## [Wave 1 — OrosFS: Internal Virtual Disk] v0.34.03

### New Module: OrosFS (window.orosFS) v0.1.0
Virtual file system with OPFS backend (IndexedDB fallback), zero-contact
with existing storage (no localStorage key collisions, no IDB collisions).

### API
- `read/write/readText/writeText/ls/mkdir/rm/mv/stat/usage`
- `exportDisk()` — Portable JSON export with base64 payloads, cross-backend compatible
- `importDisk(payload, {wipe})` — Merge by default, destructive with wipe:true
- `isDirty()/clearDirty()` — Sync groundwork (Wave 2)
- `wipe()` — Called by factory reset (OPFS invisible to localStorage sweep)

### Integration
- index.html — fs.js script tag (between sync.js and shell.js)
- sw.js — "./fs.js" in PRECACHE_URLS
- shell.js — wipeOrosFS() in factory reset + "oros-ofs" in IDB stage-2 list
- GitHub Action — Verified: regex directory-scan stamps ?v= automatically

### FIXED (hotfixes applied during deployment)
- dispatch() argument order: drivers take segments FIRST
- opfsCollect() now returns the collected array (was returning undefined)
- exportDisk(): empty OPFS disk yields empty export, not NotFoundError

### Verification (all passed)
- Write/read/rm round-trip on single file
- Nested directory creation and recursive rm
- mv() between paths (tested opfsCopyTree integrity)
- Export with nested structure (5 entries: dirs + files)
- Dirty flag triggers after mutation
- Selftest: write/read/ls/stat/rm/usage — all PASS

### Zero-Contact Guarantee (maintained)
- No existing localStorage keys touched
- No IDB collision: new "oros-ofs" (existing: "oros-vault", "oros-fs")
- No sync.js changes, no data migration, no app modifications

---

## v0.34.08 — Core audit wave 2 (S1–S5)
- Critical #S1: Missing comma in shell.js ICONS (habits/files)
  — SyntaxError, shell failed to parse.
- Critical #S2: push() baselines now from PAYLOAD snapshot
  (not live re-read — divergence guard fix).
- Critical #S3: wxPushToApp() now called after pull (stale
  weather prefs reach running app).
- Cosmetic #S4: applyPayload merged flag accurate.
- Decision #S5 pending: aurora wallpaper label "Αυγόρα".
- All patches delivered; S2/S3 application pending.

---

## [Files App] v0.35.00 — Wave 1 Launch
New application `files/` — Virtual file manager running on
top of OrosFS (v0.34.03):
- Browse internal disk (`/internal` root)
- Create folders and empty text files
- Rename entries (validates reserved names + forbidden chars)
- Delete entries (recursive for folders)
- Folder tree (lazy-expand, persisted state)
- Breadcrumb navigation + parent-up button
- Mobile slide-out tree drawer (<640px)
- Status bar (item count, current path)
- Dark-mode-only, bilingual EN/EL, inherits theme palette

Architecture: All file I/O via window.parent.orosFS.
Integration: apps.json (Productivity), SW precached (3 files).

---

## [Sync Engine] v0.9.1 — Critical 409 Empty-Cloud Fix
- FIXED (#11): contentDownload threw on non-ok status, making
  409 branches unreachable (empty cloud = generic error).
  409 now returns response; callers handle it.
- FIXED: Outer .catch wrapping fixed — genuine TypeErrors
  wrapped; intentional status errors pass through.
- REMOVED (#12): detectPwEpochMismatch() + setPWEpoch()
  (dead code; pwEpoch machinery runs inline).
- Header aligned: v0.8.1 → v0.9.1.

---

## [Notes App] v0.34.04 — Critical Sync Fix
- FIXED (#38): sliceSet never propagated merged results back
  to cloud — merged state stayed in memory only. Now marks
  dirty after merge (pure pulls skip push-back).
- ADDED (#42): Boot marker added.
- OPEN (#41): 3 confirm() remain — R14 patch proposed.
- OPEN (#44): ?v=0.34.03 discrepancy.

---

## [Kanban App] v0.34.02/0.34.03 — Audit Batch
- FIXED #26–#33 (R14, undo, palette, dead code, mojibake,
  boot marker, consistency fixes).
- OPEN #34: Version discrepancy (?v=0.34.03).
- OPEN #35: Unused keys + inaccurate comment.

---

## [To-Do App] v0.34.02 — Audit Batch
- FIXED #17–#20, #23, #25 (R14, merge safety, rollover,
  palette, boot marker).
- DEFERRED #19: Undo-across-sync merge semantics.
- OPEN #21: Priority keywords decision pending.

---

## [Versioning] v0.34.02 — R20 Automation Revision
- DECIDED: ?v= stamping is FULLY AUTOMATED end-to-end.
  Workflow v3 directory-scans EVERY index.html (root + apps).
  Manual app-local ?v= bumps RETIRED (old R20 described
  pre-v3 workflow).
- Bible patched: R20 rewritten, Checklist B aligned.

---

## [Habits App] v0.35.00 — Wave 3 Complete (Stats View)
Third view "Stats" (segmented: List/Calendar/Stats).
- Overview cards (check-offs, active habits, avg/week,
  perfect days), per-habit rows (rate bar, streaks),
  natural-language insights.
- Range selector 30d/90d/All-time (device-local, never synced).
- Completed cells take HABIT'S color inline (identity color).
- FIXED: List week dots now use habit.color inline (anchor
  corrected against verbatim file).
- REMOVED: Dead Wave 2 calView/setCalView block.

---

## [Habits App] v0.34.00 — Wave 2 (Calendar View)
Month × habits grid with sticky gutter, day-number header,
today accent; month navigation ±1, "today" snap button.
- View switcher (List/Calendar) — pref device-local
  oros-habits-view (OUTSIDE sync slice).
- Future days locked; unscheduled cells hollow.
- FIX: Remove duplicate calView/setCalView block.

---

## [Habits App] v0.34.00 — Wave 1 (List View)
Clean-room port of beta habit tracker:
- Data model: habits[] + comps[] (toggle-off = tombstone)
- Days semantics: 7=Daily, empty=Flexible, subset=N/wk
- 16 SVG icons, LABEL_COLORS palette
- Sync: registerSlice("habits"), tombstone prune >30d
- Under consideration: Calendar view, Stats view, Mood bridge,
  weekly targets, seeded starter habits.

---

## v0.32.00 — Alarms synced + merge hardening
Alarms ride the shell slice (sanitization + markDirty).
Kanban archived/color fields survive merge.
Application sync audits (8 apps verified, registry aligned).

---

## [Storage App] v0.1.2 — Palette Live-Watch
inheritPalette rewritten (data-theme mirror + setProperty
per var; cssText+= bug eliminated); watchPalette observer.
Verified: live skin switch repaint, standalone fallback intact.

---

## [Storage App] v0.1.0 – v0.1.1 — Post-audit Wave 1
15 findings closed: split-view grid, .ico sizing, strict
merge, sanitizeNav climb, :root fallback, corrupt-data
rescue, qty floor, scroll reset, debounce resize, themed
dialog, dead code sweep.

---

## v0.31.00 — Time & Calendar apps
Time: digital/analog/binary + flip/neon faces, world clock,
alarm engine, timer/stopwatch/pomodoro, astronomy module.
Calendar: Monday-first grid, event CRUD with tombstones.
Both self-register slices with deterministic merges.

---

## v0.30.03 — Zero-Knowledge Sync v0.9
Push guard (ensureCloudReadable on ALL push paths),
changePassphrase with typed old-password verification,
recovery dialogs, pwEpoch tracking, trust window (<30s),
errorKey OperationError→passphrase mapping.

---

## Earlier Milestones (condensed)
v0.27.04 — cache strategy + splash
v0.27.00 — Mood deep-review cleanup
v0.26.0 — Mood Wave 5 + versioning overhaul
v0.25.0 — Mood tabs + intelligence
v0.24.0 — Mood filters + trends engine
v0.21.x — sync messaging honesty + Weather fixes
v0.19–v0.22 — Weather app waves
v0.18.x — Contract Β shortcuts + sync dot + weather widget
v0.13–v0.17 — Notes app era (birth → labels → exports → search → wiki-links)

════════════════════════════════════════════════════════════
16. SESSION HANDOFF TEMPLATE (copy into new chat)
════════════════════════════════════════════════════════════
Continuing orOS work. Read CHANGELOG.md §1–§15 before
touching anything.

Current state: v0.34.08 (shell.js). Sync engine: v0.9.1
(patches #S2/#S3 delivered, application pending).
Files app: v0.1.x (blob sync model, limits documented).

Active open items (USER DECISION REQUIRED):
  · #21 To-Do priority keywords: implement/strike/defer?
  · #34/#44 Kanban/Notes ?v=0.34.03: CI or manual edit?
  · #41 Notes confirm() R14: approve patches?
  · #35 Kanban unused keys: clean up?
  · #S5 Aurora label: Σέλας or Αυγή?
  · #S2/#S3 sync patches: confirm applied or re-deliver?

Next task: [Specify — e.g. "Deep audit Weather app"].
Apps involved: [e.g. weather/, shell.js, sync.js].
I will paste any file you explicitly request — the
changelog registries (§4–§13) contain the contracts;
request files only when the LIVE code state of a specific
function matters.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
*Designed by Christos Koulaxizis — koulaxizis.gr*
*orOS — A static operating system in your browser*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 0.34.08 — Files: full audit fixes (29 items)

### Critical
- files.js: fixed fatal SyntaxError at end of boot() (stray brace,
  orphaned ensure* calls) — app now parses and boots.
- files.js: importFile() — stat() ENOENT treated as the NORMAL
  new-file path (was: always skipped); "keep both" now uniques
  against the real destination listing (was: silent overwrite).
- files.js: tree drop move executes (removed false
  "dstPath === cwd" precondition).
- files.js: recents section DOM is JS-injected (ensureRecentsSection)
  — #recents-section existed nowhere; recents no longer crash.
- files.js: search bar + import (file picker) button now injected
  (ensureToolbarExtras) — Wave 2 search/picker were unreachable.
- files.js: sync pill attaches to the real footer (#status, not the
  nonexistent .status-bar class) — pill now renders.
- files.js/files.css: list grid is 4 tracks (icon|name|size|date)
  matching the column header; ext badge removed from desktop rows.

### Serious
- files.js: "Take cloud version" (conflict dialog) now wipes first
  (importDisk {wipe:true}) — remote deletions survive a merge-only
  restore otherwise. Only destructive after explicit user choice.
- files.js: downloadEntry() is binary-faithful (FS().read + MIME
  map) — images/binaries no longer corrupt; text still readText.
- files.js: context menu auto-height (was fixed ~300px); SVG icons
  in menu items (DL/MV/CP earn their keep now).
- files.js: ghost-folder fallback no longer resets sort prefs.
- i18n: EN dictionary deduplicated (sort/storage/col/ui.hint/sync
  were defined TWICE, first with Greek values; "just now" was Greek
  in EN); EL dictionary gained the full sort/storage/col/sync set;
  humanWhen() localized (ago.minutes/hours/days); act.import added.
- files.js: pending-remote consumption moved to END of boot (after
  cwd/refresh) — restore renders against the real current folder.
- Versioning: files.js APP_VER aligned to the URL-parameter scheme.

### Minor / cleanup
- fs.js: mkdir() now marks dirty (consistency with write/rm/mv).
- fs.js: idbLs() dead ternary removed; parsePath comment corrected;
  usage() null-backend safe before backendReady().
- Dead code removed: performMove "srcDir", writeFileDst base64,
  orosFilesDisk onSyncStart/onSyncDone/registerWith ceremony.
- Search: 250ms debounce + render-token check inside the recursive
  walker (no per-keystroke full walks, no races).
- CSS: dead selectors removed (.crumb.max-width typo,
  .status-bar.warning, .actions .danger-arm), duplicate .entry rules
  consolidated, toast moved top-right (orOS notification convention),
  storage bar hidden on phones.