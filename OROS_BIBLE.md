# ══════════════════════════════════════════════════════════
# orOS — THE DEVELOPMENT BIBLE (Assistant-Optimized Edition)
# ══════════════════════════════════════════════════════════
#
# THE PRIMARY HANDOFF DOCUMENT FOR THE ASSISTANT.
# Read FULLY before touching any file. Dense on purpose —
# every rule exists because something broke once without it.
#
# Live     : https://useoros.online
# Repo     : github.com/koulaxizis/oros
# Author   : Designed by Christos Koulaxizis · koulaxizis.gr
# Tagline  : "A static operating system in your browser"
#
# Document map:
#   Part I   — MANTRA + STANDING PROCESS RULES (R1–R25)
#   Part II  — SYSTEM RULE REGISTRY (core + app rules)
#   Part III — CURRENT STATE + REGISTRIES (apps, files, keys)
#   Part IV  — DATA MODELS (per app)
#   Part V   — SYNC + DATA SAFETY ESSENTIALS
#   Part VI  — CANONICAL PATTERNS (verbatim contracts)
#   Part VII — UI STANDARDS
#   Part VIII— RELEASE PIPELINE + CHECKLISTS
#   Part IX  — AUDIT LEDGER & OPEN ITEMS ← READ BEFORE WORK
#   Part X   — BACKLOG
#   Part XI  — SESSION HANDOFF TEMPLATE
#   Part XII — CHANGELOG (ascending; append at BOTTOM)

╔══════════════════════════════════════════════════════════╗
║  PART I — MANTRA + STANDING PROCESS RULES                ║
╚══════════════════════════════════════════════════════════╝

1. MANTRA (design contract — never violate)
  Offline first · Mobile first · No external dependencies ·
  Full project manual export · Full project automatic export ·
  Full project snapshots · Full project auto-merge sync ·
  No guessing: if unsure, ASK; if a file is missing, REQUEST
  it; never guess or assume.

2. STANDING PROCESS RULES (R1–R25)

DELIVERY & PATCHING
  R1  NO WHOLESALE REGENERATION for fixes. Surgical patches
      (OLD block + NEW block + exact anchor). EXCEPTION:
      LARGE multi-edit changes or user-requested restructures
      ship as FULL corrected files. Code for large files may
      be delivered in numbered "doses" with continuation
      markers verbatim to prevent truncation.
  R2  RELEASE RITUAL IS MANDATORY (Part VIII Checklist D).
  R3  VERIFY THE RUNNING VERSION FIRST (Info modal
      Ctrl+Alt+Shift+I, boot marker in console) on BOTH
      devices before diagnosing.
  R4  Before chaining a patch ON TOP of a previous patch,
      CONFIRM the previous one was applied. Never assume.
  R11 Deliver patches against the USER'S CURRENT FILES, not
      remembered intermediate states.
  R13 Local/deployed desync: run git fetch && git log --oneline
      -5 origin/main and git pull --ff-only BEFORE diagnosing
      "version drift".
  R19 VALIDATION: user pastes delivered code back for explicit
      correctness confirmation before committing to production.
  R21 CHANGELOG DISCIPLINE: after EVERY significant change,
      APPEND an entry to Part XII (bottom of THIS file) in the
      SAME response that delivers the patch. No change ships
      undocumented.
  R22 BIBLE CURRENCY: after every significant PROJECT DECISION,
      update the affected registry parts in the SAME response.
      If a session ends with an unlogged decision, it did not
      happen.
  R23 VERSIONING IS USER-OWNED: version numbers, cache-busters
      (?v= refs), CACHE_VERSION stamps and APP_VERSION bumps
      are the USER'S sole responsibility. Audits NEVER propose,
      apply or "fix" versions. Version mismatches are EXPECTED
      mid-cycle and OUT OF AUDIT SCOPE by default.

MERGE & SYNC DOCTRINE
  R5  MERGES ARE SYMMETRIC: merge(A,B) === merge(B,A).
      Tie-breaks: mtime → lexicographic JSON/id — NEVER
      "local wins" (flip-flops between devices).
  R6  Pull-fed slice setters NEVER call markDirty (infinite
      pull→set→push loop otherwise). Echo suppression at the
      write point.
  R8  Apps resolve sync via syncApi() = (window.parent &&
      window.parent.orosSync) || window.orosSync.
  R17 TOMBSTONE CONTRACT: deletes write tombstones (max-ts
      union); delete wins ties; newer edits resurrect (fresh
      mtime beats tombstone); factory reset tombstones
      EVERYTHING that ever lived + rebirths seeds with fresh
      mtimes (merge-proof across devices).

UI & CODE CONVENTIONS
  R7  renderAll() re-syncs ALL DOM controls after state changes.
  R9  i18n keys must match data-i18n attributes EXACTLY; HTML
      ships icon buttons EMPTY, JS injects SVGs.
  R10 Floating/transient views are SESSION-ONLY (no prefs, no
      storage keys).
  R12 SHORTCUTS: final contract Ctrl+Alt+Shift+letter, matched
      via e.code (physical key, layout-agnostic). Alt+Shift and
      Ctrl+Shift+* are DEAD (Windows/browser eat them).
      SC_DEFS in shell.js §9c is the single source.
  R14 NATIVE DIALOGS RETIRED: no alert()/confirm()/prompt().
      Themed custom dialogs + undo-toasts instead.
  R15 BILINGUAL SEEDS: factory presets store bi {en, el};
      display uses the ACTIVE language. A hand-rename KILLS bi
      permanently.
  R16 DETERMINISTIC SEED IDS: two fresh installs that sync must
      NOT union into duplicate seeds ("seed-<col>-<i>" style).

QUALITY GATES
  R18 PRE-COMPLETION CHECKLIST per app: perfect sync, full
      local export zero-loss, offline-first, mobile-first —
      ALL four before the app is "done".
  R20 VERSION REFS FULLY AUTOMATED: every relative .css/.js ref
      in EVERY index.html stamped ?v=<APP_VERSION> by the CI
      bot. APP_VERSION (shell.js) is the only manual version.

NOTIFICATION SYSTEM CONTRACT
  R24 All app triggers MUST route through emit() bridge in
      notifications.js. Legacy app-specific alerts remain as
      fallback for stale caches. Deep links follow "ns:type:id"
      format and register in DL_BRIDGES.
  R25 Badge fallback rule: unread items >24h old fire badge-ONLY
      (no toast re-fire). Catch-up loop stamps firedAt.

3. ANTI-HALLUCINATION PROTOCOL (mandatory workflow)

  DEEP-LINK CONTRACT VERIFICATION PROTOCOL:
  Before diagnosing ANY deep-link/receiver mismatch:
  1. READ the receiver function IN FULL in the app file.
  2. READ the shell bridge body IN FULL in shell.js — never
     reason about a bridge's internals from memory of prior
     sessions.
  3. Only when BOTH sides are on the table may a mismatch be
     diagnosed and a patch proposed.

  TOLERANCE CONSISTENCY RULE:
  When multiple modules handle coord/quantity matching, VERIFY
  the tolerance value is IDENTICAL across all touchpoints.

  Standing rule: "Ποτέ συμπεράσματα για το εσωτερικό ενός
  αρχείου που δεν είναι στο τραπέζι."

  NEVER assign a dedup key without asking what the id
  STABLE-IDENTIFIES — a daily recurrence needs a per-day
  component (Wave 6 #T1 lesson).

  Emitter-toggle correspondence: NEVER add a KNOWN_APPS
  notification toggle without a working emitter.

  Action-bearing toasts (Undo) NEVER migrate to transient() —
  no action button support.

╔══════════════════════════════════════════════════════════╗
║  PART II — SYSTEM RULE REGISTRY                            ║
╚══════════════════════════════════════════════════════════╝

CORE RULES (shell.js):
  · IIFE encapsulation with "use strict" — every JS file.
  · Anti-loop sync contract: pull-fed setters never dirty.
  · Single-source versioning: APP_VERSION in shell.js.
  · Offline honesty: never fake data when offline.
  · Battery efficiency: no idle timers; intervals sized to
    purpose (reminder scans piggyback on renderClock, 60s
    throttle — NO new setInterval).
  · Shell subsystems: scToast §9, sync dot §9b, SC_DEFS §9c,
    weather widget §9d, alarms §9e (window.orosAlarms, survive
    iframe close), calendar reminder engine §9e2, notification
    engine §9e3 (notifications.js), files-disk slice §9f,
    screen pet §9h (pet.js root-level component: window.orosPet,
    #pet-layer overlay, progressive guard — renders nothing on
    stale bundles without pet.js).
  · REQUEST shell.js when a fix needs the exact current
    function — never quote from memory.

SW RULES (sw.js):
  · Precache-all: per-URL, exact URL matching, no globbing.
    PRECACHE_URLS must list every app file (G2 guard).
  · CACHE_VERSION busts everything; ?v= stamped by CI.
  · Navigations fetch(request, {cache:"no-cache"}); navigation
    cache guarded (only response.ok; OAuth ?code= never cached).
  · apps.json network-first {cache:"no-store"} + runtime
    fallback.

SYNC RULES (sync.js v0.9.2):
  · Deterministic, symmetric merges (R5). LWW by mtime,
    lexicographic tie-breaks, tombstones max-ts union,
    delete-wins-ties, newer-edit resurrection (R17).
  · Carry-forward logic for unknown slices.
  · Zero-knowledge passphrase; AES-GCM E2EE; PKCE OAuth.
  · registerSlice(name, get, set, storageKey?, mergeFn?) — 5
    args. WITHOUT mergeFn the slice is MERGELESS → divergence
    guard parks remote and registerSlice flush DROPS parked
    data (concurrent two-device edits lose one side) —
    Characters CH-15 lesson: ALWAYS register mergeFn.
  · pushInFlight/pullInFlight/reconcileInFlight guards; SP1–SP6
    hardening (strict proxy writes, memoized token refresh,
    debounce re-arm, baselines-from-payload #S2).
  · contentDownload 409 = empty cloud — callers branch on
    res.status===409 themselves.
  · ACCEPTED LIMIT: two offline devices with apps closed
    converge only via a live open.

CSS RULES:
  · [hidden] { display: none !important; } at end of EVERY app
    stylesheet.
  · Per-element display rules guarded with :not([hidden]).
  · Scrollbar standard (Part VII). Skin palettes defined once in
    shell style.css. Semantic tokens --danger/--ok/--warn
    defined in :root (skin-neutral).
  · Single OS Skin rule: no per-app accent palettes — shell CSS
    variables are the ONLY styling truth. Historical exceptions
    (Notes gold, Weather custom accent) deprecated.
  · LABEL_PALETTE (8 fixed colors) is DATA, not skin.

I18N RULES:
  · EN/EL only, EN default. Keys match data-i18n exactly (R9).
  · Locale: el-GR / en-GB; Greek dates have NO comma after the
    day; EL dates dd/mm/yyyy.

DATA RULES:
  · Additive-only migrations. Idempotent normalizeState() on
    load AND merge results. Corrupt-data rescue backup BEFORE
    reseeding. Device-local whitelist (prefs/caches/seen) NEVER
    synced.

NOTIFICATION RULES:
  · emit() is the single bridge for all triggers.
  · oros-notifs slice: 7-day TTL, 300-item cap, LWW per-field
    merge (readAt non-null beats null, firedAt max, createdAt
    min; settings via settingsRev counter).
  · notifySys routing (shell): dim → transient(); ok/err →
    emit(). Stale-bundle fallback → scToast()/local toast()
    (NEVER delete the old path while stale caches can exist).
  · transient() bypasses app toggles by design; action-bearing
    (Undo) toasts stay in-app; toast.sync.merged / sliceSet
    merged toasts removed (sync feedback = taskbar dot).
  · Deep links "ns:type:id" via DL_BRIDGES (bridges typeof-
    guarded). KNOWN_APPS = single source of toggle list.
  · Sounds: WebAudio oscillator presets — zero external assets.
  · KNOWN_APPS (current): calendar, cycle, mood, todo, habits,
    time, system, weather, notes, quote, contacts, files,
    kanban, prompter, storage, spreadsheet.

╔══════════════════════════════════════════════════════════╗
║  PART III — CURRENT STATE + REGISTRIES                     ║
╚══════════════════════════════════════════════════════════╝

CURRENT STATE (as of 2026-09-27):
  Core kernel : LOCKED — full re-audit passed, zero critical
                findings. All contracts verified: sync v0.9.2,
                fs (OPFS+IDB), notifications (unified),
                translations parity, sw precache.
  Platform    : static GitHub Pages PWA (useoros.online only;
                start_url "/?source=pwa", standalone, maskable
                icons, theme #1b1a18, bg #14120d).
  Locale      : EN default, EL secondary. Dark default, light
                optional. 24h clock. Nunito woff2 vendored.
  Apps        : 18+ in apps.json — see registry below.
  Deprecated paths (do not chase): writer/ "Update orOS"
  button, manual version stamps.

APP REGISTRY
  App        | Slice / storage key    | Merge type              | Audit
  -----------|------------------------|-------------------------|--------
  To-Do      | oros-todo-data         | entity LWW + tombs      | CLOSED (TD series)
  Kanban     | oros-kanban-data       | boards[] union, tombs    | CLOSED (KN series)
  Notes      | oros-notes-data        | page/label LWW + tombs   | CLOSED (NT series)
  Bookmarks  | oros-bookmarks-data    | entity LWW + tombs      | 5/5 VERIFIED COMPLETE
  Calendar   | oros-calendar-data     | event union + tombs     | CLOSED (F6 cosmetic open)
  Contacts   | oros-contacts-data     | union + LWW + tombs     | 5/5 VERIFIED
  Cycle      | oros-cycle-data        | day-entity union, LWW   | 5/5 VERIFIED
  Weather    | oros-weatherapp-data   | merge-lite              | 5/5 VERIFIED (W series)
  Mood       | oros-mood-data         | entity LWW + cols       | Fixes applied
  Time       | oros-time-data         | entity union + smtime  | 5/5 VERIFIED (T series)
  Quote      | oros-quote-data        | entity union + LWW     | 5/5 VERIFIED (Q series)
  Storage    | oros-storage-data      | flat ents union + del   | 5/5 VERIFIED (ST series)
  Habits     | oros-habits-data       | habits/comps LWW       | 5/5 VERIFIED (HB series)
  Files      | oros-files-data +      | files-disk blob        | ALL CLOSED (FL set)
             | "files-disk" slice     |                         |
  Prompter   | oros-prompter-data     | union + LWW + tombs     | 5/5 VERIFIED (PR series)
  Characters | oros-characters-data   | union + LWW + tombs     | 5/5 VERIFIED COMPLETE
  Spreadsheet| oros-spreadsheet-data  | CELL-ENTITY LWW + f/cw  | 5/5 VERIFIED (Wave 3 + audit)
  Dice       | oros-dice-data         | union + LWW + tombstones | 5/5 VERIFIED (v0.4 merge-aware)
  Notifications| oros-notifs          | per-field LWW           | Wave 1A core done
  Screen Pet  | oros-pet-data        | identity field-LWW +    | Integrated — pending
             |                        | temporal anchors        | smoke test (PT series)

  REFERENCE APP (canonical template): mood.js — every contract
  in Part V is extracted VERBATIM from it. Tie-breaker: "what
  does mood.js do?"

LOCALSTORAGE KEYS (synced): oros-lang, oros-theme, oros-skin,
  oros-wallpaper, oros-sync-interval, oros-autoexport,
  oros-weather, oros-alarms (shell slice), oros-notifs,
  oros-pet-data, all oros-*-data app keys.
DEVICE-LOCAL (never synced): oros-last-version, oros-wx-cache,
  oros-pet-enabled (pet menu toggle — ergonomics),
  oros-wx-last, oros-auto-snapshots, oros-fs-*, oros-cal-
  reminders-fired, oros-cal-pending, oros-*-open staging keys,
  all *-prefs/*-cache/*-seen keys, oros-sync-* engine keys.
IndexedDB: "oros-vault" (keys), "oros-fs" (handles), "oros-ofs"
  (OrosFS fallback — wiped via wipeOrosFS()).

FILE TREE: index.html, shell.js, notifications.js, sync.js,
  fs.js, style.css, pet.css, pet.js, translations.js, apps.json,
  sw.js,
  manifest.webmanifest, vendor/ (jspdf + NotoSans), fonts/
  (Nunito), one dir per app (todo, kanban, notes, bookmarks,
  weather, mood, time, calendar, quote, prompter, storage,
  habits, files, contacts, cycle, characters, spreadsheet,
  writer-staging), .github/workflows/bump-version.yml,
  OROS_BIBLE.md (this file).

╔══════════════════════════════════════════════════════════╗
║  PART IV — DATA MODELS                                    ║
╚══════════════════════════════════════════════════════════╝

COMMON CONTRACTS (all apps):
  · Entities: { id, mtime, ... } — union by id, LWW by mtime,
    tie → lexicographic JSON/id.
  · ids: uid() = Date.now().toString(36) +
    Math.random().toString(36).slice(2,7). Seeds:
    deterministic (R16).
  · Day keys: LOCAL calendar d.getFullYear()+"-"+pad(m+1)+"-"+
    pad(d) — no ISO/timezone bugs.
  · Timestamp discipline: time-of-day & day boundaries DERIVE
    from entry ts at render time — never stored.
  · uid()/Date.now() inside merge = non-determinism bug
    (Storage #6 precedent) — strict merge sanitizers DROP
    invalid rows instead.

PER-APP MODELS (schemas):
  NOTES v2:  { ver, pages[], labels[], tombs{} } — wiki-links
             [[Title]] zero-storage regex-derived; pinned notes.
  KANBAN v5: { ver, boards[{id,name,columns,labels,tombs,mtime,
             color?,archived?}], boardDeleted{}, activeBoardId
             (device-local) }.
  MOOD v3:   { ver, sm, om, entries[{id,ts,mtime,emotions[],
             loc,person,trig,<21 triadic habits>,note}],
             cols{loc[],person[],trig[]}, deleted{} } — 9 fixed
             emotions; entry order DESC ts derived at sort.
  TIME v1:   zones entities {tz,mtime} + scalar prefs LWW via
             smtime; runtime states NOT synced; alarms travel
             IN the shell slice.
  CALENDAR:  { ver, events[{id,title,date,start,end,location,
             labelId,recur{freq,interval,until,exdates},
             remindMin,mtime}], labels[], deleted{} } — shared
             tombstone list; fixed key order for deterministic
             merge tie-break.
  QUOTE:     entities + shared tombstone map; computed totals
             PURE (never stored); numbering OFF-YYYY-NNN
             recovery-based max scan.
  STORAGE v1:{ ver, ents[{id,type,name|bi,parentId,pos,qty?,
             note?,mtime,del}] } — cascade delete tombstones
             every descendant with fresh mtime.
  HABITS v1: { ver, habits[{id,name,icon,color,days[0..6
             MONDAY-first,mtime,del}], comps[{id:"<habitId>|
             <YYYY-MM-DD>",...}] } — toggle-off = tombstone.
  WEATHER v1:{ ver, sm, om, active, deleted{}, cities[],
             shellWx, units } — units RENDER ONLY, cache +
             slice ALWAYS metric.
  FILES:     view prefs in oros-files-data (device-local);
             "files-disk" slice body = JSON snapshot of
             /internal staged in oros-files-disk-cache (BLOB
             MODEL; per-entry model = backlog upgrade).
  CONTACTS:  { ver, contacts[{id,name{},phones[],emails[],
             addresses[],web[],im[],events[],notes,photo,
             relations[{with,type}],starred,labelIds[],mtime,
             del}], cols{}, deleted{} } — relations stored on
             initiator, inverse computed at render.
  CYCLE v1:  { ver, periods[{id,start,end|null,flow?,mtime,
             del}], days{d-YYYY-MM-DD:{sym[],meds[],note?,
             mtime}}, cols{}, prefs{remind}, deleted{} } —
             whole-day LWW; absence never imputed; prefs edits
             stamp BOTH sm AND om.
  BOOKMARKS v1: { ver, items{id:{url,title,folderId,tags[],
             visited,lastVisited,mtime}}, folders{id:{name,
             pos,mtime}}, deleted{}, settings{} } — root folder
             "unsorted" permanent; dedup via shared dupeKey()
             canonical rule (scheme/www/case/fragment-
             insensitive, query string KEPT).
  DICE v1:   { ver, sm, deleted{}, history[{id,kind,ts,mtime,...}] } — kind∈{dice,coin};
             dice entries carry notation/total/rolls/kept/type/mod/mode/isCrit/isFumble;
             coin entries carry result; tombstones prune on max-mtime - 30d.
  PET v1:    { ver, pet{ id, name, palette, birthTs, fm{field:
             mtime} }, lastFed, lastPetted, wokeAt/awakeE?,
             asleepSince/asleepE?, tombs{} } — stats (food/happy/
             energy) NEVER stored: DERIVED at render from anchors
             (relaxed decay: food →0 in 24h, happy in 36h, energy
             in 10h awake / +8 per min asleep; auto-sleep <8,
             auto-wake ≥95, retroactive cycle resolution for long
             absences). Identity = per-field LWW via fm (R5
             symmetric); temporal anchors = max-value merge;
             anchor pairs (wokeAt/awakeE) travel together; delete
             = tombstone (no death mechanic; stats floor at 0).
  NOTIFICATIONS v1: { ver, settings{position,style,sound,
             volume}, appToggles{}, items[{id,ns,key,deepLink,
             createdAt,firedAt,readAt,sound?,ttl?}], meta{} }.
  SPREADSHEET: cells {"<sid>|<r>|<c>":{v,mtime,f?}} — sparse,
             LWW per cell, shared tombstones; f sub-object
             {b,i,u,al,co,nf} (bold/italic/underline/align/
             color/number-format) rides whole-cell LWW,
             f-only cells allowed on empty cells (sanitized
             on load); sheets {id,pos,cw{colIdx:px},bi{en,el}?}
             gain cw (column widths, riding sheet LWW).
             Formula engine (tokenizer → shunting-yard → RPN)
             built from scratch, no external deps.
			 
			 ╔══════════════════════════════════════════════════════════╗
║  PART V — SYNC + DATA SAFETY ESSENTIALS                    ║
╚══════════════════════════════════════════════════════════╝

SECURITY MODEL (ABSOLUTE):
  · Zero user tracking. Zero-knowledge passphrase (AES-GCM +
    PBKDF2 100k rounds client-side; Dropbox tokens only for
    file I/O via PKCE). Vault: sealed passphrase + IndexedDB
    NON-EXTRACTABLE key, opt-in per device.
  · ALL synced third-party-cloud data MUST be E2EE — never
    plaintext files (standing requirement for ANY future
    provider).

ENGINE CONTRACT:
  · registerSlice 5-arg; persisted registry (oros-slices)
    hydrates lightweight proxies at boot → app slices travel
    WHILE THE APP IS CLOSED.
  · Divergence guard (v0.8.1): mergeless slice with unpushed
    local work parks remote in oros-remote-carry carry
    mailbox; local pushes as new truth; parked remote flushes
    at next live merge-capable registration.
  · collectPayload()/applyPayload() = the unified funnel for
    cloud sync, manual export, auto-snapshots, folder
    mirroring — one funnel, zero divergence.
  · reconcile(reason) triggers: boot/interval/visible/online/
    register/debounce (DEBOUNCE_MS=5000, push-on-change).

DATA SAFETY SUPREMACY (zero-loss guarantee — every change):
  · SYNC: bidirectional push-pull with deterministic merge.
  · SNAPSHOTS: rolling 5 full-DB auto-snapshots (FIFO, FIFO on
    oros-auto-snapshots).
  · MANUAL EXPORT: full database export capturing EVERY
    parameter and state variation — import restores zero-loss.
  · AUTO EXPORT: optional periodic full unencrypted export to
    a preset folder + on-close auto-sync safety net +
    beforeunload warning when dirty and online.
  · FACTORY RESET: double confirmation → cloud → folder →
    localStorage prefix sweep → OrosFS wipe → reload;
    tombstones EVERYTHING + rebirths seeds (merge-proof).
  · CORRUPTION: rescue backup before any reseed.
  · BACKWARD COMPATIBILITY: updates NEVER lose user data;
    migrations additive-only; schemas carry forward unknown
    fields.

FILES-DISK GLUE (shell.js §9f): files.js mutates →
  __orosFilesDiskTouched() (engine dirty + 1s-debounced cache
  refresh). Remote while app closed → pending flag, consumed
  at next open. fdSliceGet is PURE. fdRefreshForExport()
  guarantees live OPFS snapshot before manual exports — without
  markDirty.

OROSFS (fs.js): window.orosFS, one mount (/internal). OPFS
  primary, IndexedDB "oros-ofs" fallback, identical promise
  API. importDisk merge by default; {wipe:true} destructive
  only. fs.js must be in the manual commit (bot never stages
  untracked files).

╔══════════════════════════════════════════════════════════╗
║  PART VI — CANONICAL PATTERNS (verbatim contracts)         ║
╚══════════════════════════════════════════════════════════╝

BOOT SEQUENCE (order matters):
  load() → applyI18n() → paintStaticAria/icons → wire() →
  registerSync() → inheritPalette() → watchPalette() →
  reset initial view state → first renders (SINGLE PASS) →
  consume staged deep-link AFTER first paint.

BOOT MARKER (stale-file detection):
  var SCRIPT_V = "";
  (function(){ var m=(document.currentScript &&
    document.currentScript.src||"").match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m?m[1]:"";
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
  sanitize view state → re-render → info.merged → NO toast
  (sync feedback = taskbar dot; Wave 10/11 doctrine).

NOTIFICATION TRIGGER (guarded emit):
  function notifyDue(remKey, title, body, evId, ymd) {
    if (window.parent && window.parent.__orosNotify) {
      window.parent.__orosNotify.emit({
        ns:"<appid>", key: remKey, title: title, body: body,
        deepLink: "<appid>:"+evId+":"+ymd, sound: "bell"
      });
      return true;
    }
    return false; // caller falls back to legacy local alert
  }

TRANSIENT NOTE (per-app helper pattern):
  function transientNote(text) {
    var n = (window.parent && window.parent.orosNotifs) ||
            window.orosNotifs;
    if (n && typeof n.transient === "function") { n.transient({
      ns: "<appid>", title: text }); return; }
    showToast(text); // stale-bundle fallback
  }

DEEP-LINK RECEIVER (shell owns staging; app owns landing):
  window.__oros<App>Open = function (id, ymd) {
    /* navigate to item; guard deleted ids */
  };
  Boot consumption: read sessionStorage "oros-<app>-open",
  remove, invoke receiver.

SHORTCUT FORWARDING (Contract Β — capture phase):
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
  (alive if mtime > tomb ts). Column/order values: om-larger
  side donates positions. Strict normalizers DROP invalid rows.

I18N: inline STRINGS = { en:{...}, el:{...} }; t(key) with
  en-fallback. Escape user text via esc() before innerHTML.

DIALOGS: native <dialog>, createElement, showModal(), close
  on outside click + Esc. "close" listeners null-guarded
  (async fires after button nulled the variable).

TOAST: lazy-created singleton on document.body, top-right
  (top: calc(12px + env(safe-area-inset-top))), text node
  first, action button second, 5s auto-hide, visibility:
  hidden at end.

FORM REBUILD DISCIPLINE (buildCapture pattern): read previous
  input values + scrollTop BEFORE innerHTML="", rebuild,
  restore — mid-form re-renders never lose drafts.

FRESHNESS/FILTER VIEW STATE: session-only variables — reset
  in factory reset (R10).

MOOD EMOTIONS (9, immutable): happy #87cf3e · calm #51a2da ·
  excited #8c5ec7 · sad #5277c3 · angry #e06c75 · anxious
  #e0a44c · tired #9aa0ae · stressed #ff7043 · numb #6d4aff

LABEL_COLORS (8, shared): #e06c75 #ecc75f #87cf3e #4fc4cf
  #6d4aff #e09ecf #f28c5a #9aa4b0

╔══════════════════════════════════════════════════════════╗
║  PART VII — UI STANDARDS (orOS-wide, permanent)           ║
╚══════════════════════════════════════════════════════════╝

  SCROLLBAR: 10px, transparent track, pill thumb 999px radius
  with 2px border var(--bg), hover var(--accent); Firefox
  scrollbar-width:thin + scrollbar-color.
  HIDDEN GUARD: [hidden]{display:none!important} at EOF of
  every app stylesheet.
  OVERSCROLL: overscroll-behavior:contain on main scroll panes.
  DIALOGS: no native alert/confirm/prompt (R14). Outside-click
  + Esc. Zero-edit close must NOT stamp mtime (no LWW locks).
  ICONS: inline SVG everywhere — Fork Awesome ABANDONED. SVGs
  carry viewBox + explicit sizing.
  TOASTS: top-right, below clock/taskbar, lazy singleton.
  NOTIFICATIONS ≠ TOASTS: cross-session/event reminders =
    emit() (inbox + badge + history); in-context feedback =
    local/transient toast.
  LANG: EN/EL only. EL dates ηη/μμ/εεεε, no comma after day.
  MOBILE: single-thumb reachability; long-press 450ms /
    right-click context menus with visible affordances; touch
    targets ≥44px; safe-area insets (env()); media queries
    480/420/360px.
  DESKTOP: ≥1024px split views allowed.
  AUTOSAVE: debounce, no explicit Save buttons for settings.
  VERSION BADGE: shell version lives in Info modal only.
  BUTTONS: deleting = danger styling; undo via toast action
  (R17 resurrection contract) preferred over confirmations.

╔══════════════════════════════════════════════════════════╗
║  PART VIII — RELEASE PIPELINE + CHECKLISTS                 ║
╚══════════════════════════════════════════════════════════╝

PIPELINE (.github/workflows/bump-version.yml v3):
  Triggers on EVERY push to main. Reads APP_VERSION from
  shell.js, stamps sw.js CACHE_VERSION + manifest + ?v= on
  every relative .css/.js in EVERY index.html (directory
  scan — new apps need ZERO config). G2 guard (app folders in
  PRECACHE_URLS), G3 guard (inheritPalette + watchPalette),
  G4 guard (apps.json entries ↔ app folders). Bot never
  stages untracked files — NEW files must be in the manual
  commit.

CHECKLIST A — VERSION BUMP: shell.js APP_VERSION (user-owned,
  never assistant-proposed) → push → verify on BOTH devices →
  changelog entry (R21) + Bible registry sync (R22).

CHECKLIST B — NEW APP INTEGRATION (10 items):
  1. <app>/ folder (index.html + css + js)
  2. apps.json entry (+icon key)
  3. sw.js PRECACHE_URLS (G2 fails until done)
  4. shell.js ICONS entry (inline SVG, currentColor)
  5. translations.js: app.<id> + category strings (en+el)
  6. Self-registration (registerSlice + markDirty)
  7. Palette: inheritPalette + watchPalette (G3)
  8. Shortcut forwarding listener (Contract Β)
  9. Notification integration: emit() triggers + appToggles
     default + __oros<App>Open receiver + DL_BRIDGES +
     staging key (R24)
  10. Changelog entry + registry update (same response)

CHECKLIST D — RELEASE PRE-FLIGHT: node --check every touched
  JS; JSON validation; no SyntaxError; boot marker matches
  ?v=; shortcuts smoke test in EACH app; notification smoke
  test (emit → toast + badge + inbox; click-through live AND
  cold start); deploy + version check on BOTH devices; PWA
  update path verified on desktop AND mobile; changelog (R21);
  Bible current (R22).

CHECKLIST E — PRE-COMPLETION (per app/wave, R18):
  ☐ Perfect sync: push-pull both directions, no data loss
  ☐ Tombstone resurrection after multi-device delete
  ☐ Offline edits survive reconnect
  ☐ Full local export zero-loss (manual + auto + snapshot)
  ☐ Offline-first verified · ☐ Mobile-first verified
  ☐ Notifications: emit() dedupe across devices; read state
    converges; badge fallback honored

CHECKLIST F — UNIVERSAL COMPLIANCE (every app, master audit):
  STRUCTURE: IIFE strict · storageKey "oros-<app>-data" synced ·
  prefs separate device-local · additive migrations ·
  idempotent normalizeState.
  I18N: app-local STRINGS · all strings via t() · data-i18n ·
  parent orosLang typeof-guarded.
  SYNC: __orosSyncApi wrapper + _suppress · deep-copy getters ·
  validating setters · deterministic merges · tombstones ·
  markDirty ONLY from user actions · mergeFn ALWAYS registered
  (5th arg).
  NOTIFICATIONS: emit() guarded + legacy fallback ·
  appToggles honored · deep link receiver guards deleted ids ·
  staging consumed after first paint (R24).
  UI: palette inherit + watch · toast standard · [hidden]
  guard · inline SVG only · <dialog> + outside/Esc ·
  Contract Β forwarding · no per-app sync indicator.
  DATA SAFETY: rolling 5 snapshots · full export · merge-aware
  import · factory reset full wipe + seed rebirth · corrupt
  rescue backup · unsaved-changes guard.
  MOBILE: touch targets · media queries · themed scrollbars ·
  safe-area insets · no hover-only features.
  OFFLINE: local cache · honest badge · never fake data ·
  throttled network.
  SECURITY: esc() on dynamic innerHTML · typeof guards ·
  payload whitelisting · permissions only in user gestures ·
  no eval.

FIVE-AXES COMPLIANCE (application audit doctrine — every app):
  ① Calendar Integration (or documented exemption if
     non-time-bound)
  ② Unified Notifications (transientNote for informational;
     emit() for reminders; Undo-bearing local)
  ③ Dropbox Sync (5-arg registerSlice + deterministic mergeFn)
  ④ Snapshots (global shell system; no per-app code)
  ⑤ Manual & Auto Export (shell DB export via slice; app-level
     only if an interop format exists, e.g. ICS/vCard/PDF)

╔══════════════════════════════════════════════════════════╗
║  PART IX — AUDIT LEDGER & OPEN ITEMS                       ║
║  (READ FIRST — exact decisions waiting for the user)      ║
╚══════════════════════════════════════════════════════════╝

OPEN DECISIONS (user response needed):
  ⊗ #21 (To-Do) — priority keywords: implement/strike/defer?
  ⊗ #35 (Kanban) — clean up unused keys + stale comment?
  ⊗ #S5 (Shell) — aurora label: Σέλας or Αυγή?
  ⊗ #16 (Core) — characters storage key/model: confirmed at
     scheduled characters audit.
  △ #19 (To-Do) — undo-across-sync: tackle now or defer?

CLOSED (reference):
  · Core #1–#16, To-Do #17–25 (TD set), Kanban #26–35 (KN
    set), Notes #36–44 (NT set), Calendar #C1–14 + Waves,
    Files FA1–FG5 + FL set, Bookmarks 5/5, Characters 5/5
    (CH set), Contacts 5/5 (CT set), Cycle 5/5 (CY set),
    Time v0.1.1 (T set), Quote (Q set), Storage (ST set),
    Habits v0.3.1 (HB set), Prompter (PR set), Weather
    v0.3.0+ (W set), Mood fixes (MD set), Spreadsheet
    Wave 1–3 + Five-Axes audit, Kernel re-audit + T3.
  · Kernel status: CORE LOCKED.
  · #C1 false-alarm lesson → anti-hallucination protocol
    (Part I §3).

QUEUED (next phase):
  · Screen Pet smoke test (PT checklist: retroactive energy after
    simulated 2-day absence; identity merge — rename on Device A
    → check Device B; drag vs click threshold; EL/EN speech +
    HUD; shortcut modifier guards).
  · Remaining app audits: Mood (high — deepest model), then
    Weather re-visit, Kanban/Contacts/Notes pattern sweep
    (light re-checks after pattern rule changes).
  · registerTrigger API removal from sync.js (dead code —
    purged; verify no consumers before final delete).
  · Calendar F6 (cosmetic CSS one-liner).
  · Quote Calendar feed (due dates + status changes —
    roadmapped candidate following the Contacts/Cycle
    pattern).
  · Spreadsheet Wave 4 (extended function library: text,
    date/time, VLOOKUP/INDEX/MATCH/SUMIF/COUNTIF, financial).

DOCTRINAL EXEMPTIONS RECORDED:
  · Bookmarks/Files/Characters/Storage/Spreadsheet — Calendar-
    axis exempt (non-time-bound apps; Spreadsheet: purely
    computational, no dated entities).
  · version drift observations — OUT OF AUDIT SCOPE (R23).
  · Kanban KN-Q1 — wall-clock tombstone pruning accepted as
    known deviation from Lesson 3 (prunes at load/merge time;
    engine re-prunes after one sync round; revisit only if
    phantom-push symptom appears — use HB-3 pattern).
  · Storage/Quote — deterministic sliceGet pruning mandatory
    (both adopted); deviating apps get the Q-1/ST-1 treatment.
  · Dice & Coin — Calendar exempt (non-time-bound, no dated entities),
    Notifications exempt (no reminders/emitters, transient feedback only via toasts).
  · Screen Pet — Calendar exempt (no dated entities; birthTs is
    display-only), Notifications exempt (speech bubbles are
    in-context transient feedback; no emitters, no KNOWN_APPS
    entry). NOT an apps.json app: root-level shell component
    (pet.js/pet.css, #pet-layer); menu toggle device-local
    (oros-pet-enabled, never synced, never marks dirty).

╔══════════════════════════════════════════════════════════╗
║  PART X — BACKLOG (long-term, not scheduled)               ║
╚══════════════════════════════════════════════════════════╝

CORE/SYNC: unified shell toast API absorption decision ·
  hierarchical key rotation · cross-device passphrase-change
  notification · additional cloud providers (E2EE mandatory) ·
  per-entry file sync for OrosFS (replace blob model) ·
  Notes gold + Weather custom accent → unify under Single OS
  Skin rule.
NOTIFICATIONS: quiet hours UI · alarms presentation routing ·
  translations.js promotion of inline nt() strings ·
  Todo/Habits/Kanban calendar feeds.
APPS (highlights): Kanban board color headers; Notes fuzzy
  backlinks; Weather radar/per-hour graph; Quote CSV export;
  Prompter sprint timer; Storage Restock Center; Habits
  per-habit weekly targets (model change → migration plan);
  Files drag-drop import + batch ops; Contacts X-RELATED
  export; Cycle symptom trends; Bookmarks link health checker
  (activate dormant "dead" status field), fuzzy dupe matching,
  bulk tag ops, edit-dialog URL dedup warning; Spreadsheet
  Wave 4 backlog (conditional formatting, charts, iterative
  calculation, cross-workbook refs, PDF export, mobile range
  selection).
NEW APPS (planned): Pad (Notepad++-style) · Pagination/
  typesetting · Public Domain Calculator · Desk suite ·
  native Windows/Android conversions (decision pending
  flawless PWA validation).

╔══════════════════════════════════════════════════════════╗
║  PART XI — SESSION HANDOFF TEMPLATE                        ║
╚══════════════════════════════════════════════════════════╝

Copy into a new chat's first message:

  "Continuing orOS work. OROS_BIBLE.md is the SINGLE SOURCE
   OF TRUTH. Read Parts I–XII fully before touching anything —
   Part IX has the open items, Part XII the changelog (newest
   at the bottom). Current state: kernel LOCKED; app audits
   five-axes doctrine active. Next task: <task>. Apps involved:
   <dirs>. I will paste any file you explicitly request —
   request files only when the LIVE code state of a specific
   function matters."
   
   ╔══════════════════════════════════════════════════════════╗
║  PART XII — CHANGELOG (ascending; newest at BOTTOM)       ║
╚══════════════════════════════════════════════════════════╝

2025-08-XX — [Core] Initial kernel lock, sync v0.9.2, FS(OPFS+IDB), unified notifications, translations parity, sw precache verified.

2025-09-14 — [Kernel Re-Audit T3] Shell style.css → removed dead skin palette rules (#2a, #4c), unified accent vars to single shell-wide definitions; app dirs restructured; manifest updated.

2025-09-18 — [Bookmarks 5/5 VERIFIED] Bookmarks app: entity LWW + tombstones, dedup via dupeKey(), folder tree, tags, visited tracking, full export/import; Calendar integration (exempt — non-time-bound).

2025-09-22 — [Characters 5/5 VERIFIED] Character design + relationship mapping; union+LWW+tombs; 5/5 axes closed.

2025-09-28 — [Contacts 5/5 VERIFIED] Full Google Contacts alternative: names/phones/emails/addresses/web/IM/events/notes/photo/relations/starred/labels; sync with Calendar birthdays (green label) + anniversaries (orange); merge duplicates; 5/5 verified.

2025-10-02 — [Cycle 5/5 VERIFIED] Menstrual tracker: periods + symptom days + meds + notes; Calendar feed (pink label); 5/5 axes closed.

2025-10-15 — [Time v0.1.1] World clocks (digital/analog/binary) + alarms + timer + stopwatch + sunrise/sunset + Pomodoro; time-zone entities + smtime scalar prefs; 5/5 verified.

2025-10-20 — [Quote/Offer v0.4.x] Line items + per-item VAT + discounts + totals; payments (bank/PayPal/iris) + installments; Calendar integration (due dates); notification system integrated; 5/5 verified.

2025-10-25 — [Storage v0.7.x] Warehouse inventory: entities + shared tombstones; deterministic prune (dataset maxTs, no wall-clock); full export; 5/5 verified.

2025-11-03 — [Habits v0.3.1] Daily habits + completions; triadic habit support; Calendar reminders; tombstone resurrection; 5/5 verified.

2025-11-10 — [Prompter v0.5.x] Writing prompts (100 bilingual) + techniques; union+LWW+tombs; 5/5 verified.

2025-11-18 — [Weather v0.3.0+] Multi-city + geolocation + 7-day forecast + air quality + UV index; Open-Meteo provider; 5/5 verified.

2025-11-25 — [Mood fixes MD series] Entry panel layout (Save button at bottom, status above); Greek typo fixes (καταγραφής); PDF Greek font rendering; Insights bar overflow fix; ritual field binary pairs; presets editable/deletable; 5/5 verified.

2025-12-01 — [Kernel Re-Audit] Core stability verified: shell.js/sync.js/fs.js/notifications.js/translations.js/sw.js — zero critical findings; Contracts A–F fully compliant.

2026-09-20 — [Spreadsheet Wave 1] Bare-minimum core: 100×26 grid, formula engine (lexer → shunting-yard → RPN), 10 functions (SUM/AVERAGE/MIN/MAX/COUNT/COUNTA/ROUND/ABS/IF/AND/OR/NOT/CONCAT), ranges, cross-sheet refs; fixed inheritPalette crash, syntax error in normalizeState(), grid not rendering.

2026-09-22 — [Spreadsheet Wave 2] Multi-sheet tabs (rename/double-tap, armed-delete, add sheet); cross-sheet refs (Φύλλο2!A1); CSV import (quoted-field parser) + export (BOM+CRLF); comparison operators (=,<>,<,>,<=,>=); error propagation (#CYC!, #REF!, #DIV/0!, etc.); cycle detection.

2026-09-24 — [Spreadsheet Wave 3] Cell formatting {b,i,u,al,co,nf} as sub-object f (rides whole-cell LWW, f-only cells on empty cells); number formats (gen/0/2/%/€); 8 text-color swatches; toolbar (B/I/U, align, NF dropdown, color, clear); range selection (Shift+arrows, Shift+click, drag); internal clipboard (copy/cut/paste) with ref-shifting (relative refs shift, cross-sheet refs static); undo/redo (op-based, device-local, cap 100, batch entries, fresh mtime); column resize (cw per sheet, mouse only); FIXED recalc bug (EVAL_CACHE cleared per-mutation-batch via EVAL_DIRTY); DATA_VER stays 2.

2026-09-27 — [Spreadsheet Five-Axes Verification] Bible compliance audit closure:
  · FIXED (CRITICAL): shiftFormula double-parenthesis (paste of formulas with functions → #ERROR!)
  · FIXED (CRITICAL): \u20AC literal in HTML (€ format never applied)
  · FIXED: mergeState wall-clock pruning (non-deterministic → dataset max mtime minus 30 days)
  · ADDED: sliceGet tombstone pruning (payload-only; local keeps all)
  · FIXED: non-deterministic sheet ordering (pos-sort → pos + id tie-break in mergeState + renderTabs)
  · MIGRATED: 6 informational toasts → notifyTransient() (transient bypasses toggles by design)
  · REGISTERED: "spreadsheet" in KNOWN_APPS (plus kanban/prompter/storage for consistency with live notifications.js)
  · MIGRATED: toolbar/tab/CSV icons (unicode glyphs → inline SVG per Bible R9)
  · RAISED: touch targets ≥44px (media query pointer:coarse)
  · REMOVED: dead code (computeCellValue, esc, "toast.updated", lastTh)
  · CLEANED: duplicate CSS rules
  · TRADE-OFFS recorded: whole-cell LWW concurrency; shiftFormula canonicalization; TRUE/FALSE→1/0 literals; mobile range deferred; column resize mouse-only
  · FIVE-AXES SCORECARD: Calendar=N/A(exempt), Notifications=PASS(transient ns:spreadsheet), Sync=PASS(deterministic merge+tombstones), Snapshots=PASS(full-DB), Export=PASS(full-DB)
  · BIBLE PATCHES: B-1 (Part III registry: Wave 1 shipped → Five-Axes Verified), B-2 (Part IV data model: f + cw), B-3 (Part IV exemptions: Spreadsheet joins Bookmarks/Files/Characters/Storage), B-4 (Part II KNOWN_APPS: +spreadsheet+kanban+prompter+storage)
  · SMOKE TEST (R19): recalc fix verified, formula paste with functions works, € format displays, SVGs load, touch targets ≥44px, CSV export via transient, Settings → Notifications shows Spreadsheet toggle

2026-09-27 — [Bible Update] OROS_BIBLE.md Parts I–XII consolidated: Spreadsheet entries incorporated (registry, data model, exemptions, KNOWN_APPS); stale app queues reconciled (Bookmarks/Characters/Contacts/Cycle/Time/Quote/Storage/Prompter/Spreadsheet → CLOSED); duplicate verbose blocks pruned (Workflow Reaffirmations removed from Part XII, live in Part I standing rules); three identical "Support section" changelog entries merged into one canonical reference.

---

orOS Sync Recovery & Kernel Hardening — Chat Session Changelog
Session scope: Final closure of the multi-device sync failure saga (duplicate seeds, calendar feed blackout, contacts wipe) and complete diagnosis + lockdown of the window.t is not a function shell crash. Files examined and verified: shell.js (0.36.15), translations.js, index.html.

Critical Incident — Full Root Cause Record (multi-session, closed here)
1. Duplicate seeds on new device login (Notes / To-Do / Kanban)

Cause: boot-phase default seeding used non-deterministic IDs (uid(), Date.now()) running before sync pull; merge engine unioned distinct IDs → parallel empty app instances.
Fix: deterministic seed IDs (nb-default, tdl-general, kb-seed-main, mtime: 0) in notes.js, todo.js, kanban.js. Remote version collapses to one; fresh install gets the same seed. Verified post-patch: single correct entries in oros-notes-data / oros-todo-data.
Status: CLOSED.
2. Calendar feed events (birthdays, anniversaries) not appearing on new device

Cause: calendar.js feed caches (contacts/habits, 1s micro-cache) served stale empty data when setFromSync() re-rendered immediately after pull.
Fix: explicit cache invalidation inside setFromSync() before renderAll().
Status: CLOSED.
3. Contacts wiped across ALL devices after new-device login

Cause: mergeless slice with no baseline pushed an empty local blob to cloud; divergence guard (local !== null) failed on null/empty stores → overwrite propagated everywhere.
Fix: empty-blob guard in sync.js collectPayload() — blocks pushes for unpushed slices lacking a baseline unless remote is confirmed empty.
Recovery: contacts restored from .vcf backup export.
Status: CLOSED. Lesson recorded: mergeless slices without baselines must never push empty payloads — candidate kernel rule.
Shell Crash — window.t is not a function
Diagnosis trail:

Crash site: shell.js — autoSyncDot (~line 2387) and renderClock tick chain.
Console diagnostics post-hard-refresh: typeof window.t === "function" ✓, correct source body, single translations script loaded, clean boot, no recurrence after reload.
translations.js audit: CLEAN — window.OROS_TRANSLATIONS and window.t defined top-level synchronously, no fetch/callback paths; fallback chain (active lang → en → key) means t() can never throw on its own.
index.html audit: CLEAN — script order correct: translations.js → sync.js → fs.js → shell.js → notifications.js, all classic scripts (guaranteed execution order).
Conclusion: the crash was a transient partial-bundle boot (Service Worker served shell.js while translations.js failed/delayed once). Guards now make this class of failure non-fatal.
Fixes verified present in shell.js (all three TP-guards, confirmed against actual file content):

applyLang() (Section 3): early-return guard when window.t is not yet a function, logs deferral, menu repaints on next paint cycle.
setSyncDot() (Section 9b): guarded tooltip lookup + conditional aria-label.
autoSyncDot() (Section 9b): guarded tooltip — the 1s clock tick chain (alarmTick, notifTick, weather chip, calendar/mood/cycle/todo/quote scans) can never be killed by a missing translation function again.
Status: CLOSED.

False Alarms Resolved (documented to avoid re-chasing)
Banner not shown: beforeinstallpromptevent.preventDefault() called — expected by design; the shell keeps deferredPrompt for the menu Install button. Not a bug.
Console dot state: null — was a faulty diagnostic selector ([id*="sync-dot"] matched the parent button #sync-dot-btn, which carries no data-state). The actual dot element is the child span #sync-dot.
Architectural Notes for Future Sessions
Shell's renderClock (1s tick) hosts ALL throttled engine ticks — a throw in ANY unguarded callee kills the entire chain. New ticks must guard against missing modules (window.t, window.orosNotifs, window.orosSync) per existing patterns.
Translations contract: translations.js must stay synchronous top-level, no version number in the file (version lives ONLY in shell.js — single source of truth, GitHub Action propagates).
Tripwire snippet available for future recurrence: Object.defineProperty setter on window.t logging overwrites with stack trace — use if the crash ever reappears with translations.js confirmed loaded.
Pending Work
Legacy Kanban board mumfy266amf80 — pre-patch duplicate, requires manual deletion on client to propagate tombstone via sync.
Final verification cycle — hard refresh + full sync on TWO devices (desktop + mobile PWA), confirming: no new duplicate seeds; calendar feeds render immediately after sync; contacts stable (no empty-blob overwrite); shell clock and notification ticks error-free.
Optional: consider promoting the empty-blob guard and TP-guard patterns into the project Bible (OROS_BIBLE.md) as standing kernel rules.
Workflow rules honoured this session: all patches verified against actual file content before delivery (no guesses); files requested one by one (translations.js → index.html → shell.js); OLD → NEW format for all patches; no version number changes made by the assistant (versioning stays owner-controlled / Action-automated).

---

orOS Session Changelog — Notifications UX, Snapshot Picker, Menu Compactness
Session scope: Follow-up to the sync-recovery session (kernel locked at 0.36.15/0.36.16). This session: closure of the window.t saga (verified, already applied), plus five user-reported UX/data-safety issues (#1–#5). Files examined and verified: shell (4).js (sections 5c, 9g, menu render), notifications.js (full file). All patches delivered in OLD → NEW copy-paste format after verification against actual file content.

Closed — window.t crash (verification complete)
Audited shell (4).js: all three TP-guards confirmed present and correct (applyLang §3, setSyncDot/autoSyncDot §9b). No further changes needed.
Earlier confusion resolved: patches had been renamed/re-numbered between messages; the user was searching for OLD code that had already been replaced. Diagnosis method documented: search typeof window.t === "function" to confirm guards exist.
Final root cause statement: transient partial-bundle boot (SW served shell.js while translations.js failed/delayed once). translations.js and index.html audited CLEAN (synchronous top-level definitions; correct script order). Guards make this failure class non-fatal. Recurrence would require translations.js load failure — covered by existing guards; tripwire snippet (Object.defineProperty on window.t) recorded for future one-shot diagnosis if ever needed.
False alarm closed: Banner not shown: beforeinstallpromptevent.preventDefault() — expected by design (shell holds deferredPrompt for the menu Install button). Not a bug.
Fixed — #1 Notification count badge clipped (top half invisible)
Root cause (notifications.js, updateBadge()): badge positioned top:-4px;right:-4px — floats OUTSIDE the 44×44 bell button. Any ancestor with overflow:hidden (taskbar/tray) clips the top half of the count.
Fix (Patch 1, DELIVERED): badge repositioned INSIDE the button bounds (top:2px;right:2px, slightly smaller metrics 14×14/font 9px) — unclippable in every browser/skin regardless of ancestor overflow. Alternative (keep floating badge + targeted overflow:visible in style.css) offered; user to choose. OWNER ACTION: apply patch, verify count fully visible with unread items (test emit: window.orosNotifs.emit({ns:"system", title:"Test", body:"Badge"})).
Also noted for future cleanup pass: defaultSettings() quietHours carries duplicate legacy keys (from/to AND quietHoursStart/quietHoursEnd); only Start/End are read by isQuietHour(). Harmless but should be trimmed in a later cleanup wave.
Diagnosed — #2 Local auto-export disappeared
Verified in shell (4).js: the entire auto-export block EXISTS and executes — renderSyncSection() builds the auto-backup selector (off/daily/weekly/monthly), Restore button, snapshots status line, folder-backup row, Export/Import rows. Per-app notification options render AFTER the sync section (user sees them) → the sync section completed without exception.
Leading hypotheses, ordered: (A) browser without File System Access API — the folder-backup row renders only if (fsSupported()), i.e. Chromium-only; Firefox (primary target) hides the row by design; localStorage snapshots continue regardless. (B) visual scroll/position — the auto-backup selector sits mid-section.
PENDING: user runs diagnostic snippet (menu open): dump sync-section labels + localStorage["oros-autoexport"] + snapshots count + typeof window.showDirectoryPicker === "function". If labels present → visibility issue; if absent → stale shell served by SW (check boot console shell.js?v=).
Fixed — #3 Snapshot restore now offers ALL snapshots (picker dialog)
Previous behavior: at 5 snapshots, oldest is overwritten (confirmed in maybeAutoExport: while (snaps.length > SNAPSHOT_MAX) snaps.shift();) and Restore offers ONLY the newest (snaps[snaps.length - 1]), no choice.
Fix (Patch 3, DELIVERED): restoreLastSnapshot() (§5c) rewritten — dialog now lists ALL snapshots (newest first, radio buttons, newest pre-selected, scrollable max-height 40vh). Submit reads the picked index and restores it through the SAME import path as before. Zero new i18n keys (reuses sync.restore, sync.restore.confirm, wx.cancel, sync.working). Retention policy unchanged: 5 auto snapshots, FIFO overwrite — the picker gives rollback control within that window. OWNER ACTION: apply patch, verify restore of a non-newest snapshot.
Fixed — #4 Per-app notification options: expandable + compact
Previous: one full remember-row per app (16 known apps) → huge settings footprint.
Fix (Patch 4, DELIVERED): block converted to native <details>/<summary> (zero JS open/close state) with compact wrapped checkbox chips inside (flex-wrap grid). Collapsed = one menu line. Data behavior unchanged: renders from window.orosNotifs.getKnownApps() (single source of truth), toggles via N.getAppToggle/N.setAppToggle. OWNER ACTION: apply patch, verify chips render and toggles persist.
Fixed — #5 Application categories collapsible (menu space reclaim)
Fix (Patches 5a/5b, DELIVERED): 5a adds helpers before renderMenu() — catCollapsedRead/Write keyed on localStorage["oros-menu-cat-collapsed"]; collapse state is DEVICE-LOCAL by design (menu ergonomics ≠ user data: never synced, never marks dirty). 5b rewrites the category loop in renderMenu(): h4 becomes clickable header with rotating chevron (inline SVG), app rows wrapped in a catList div hidden with display:none when collapsed. Translation behavior unchanged (category.* keys with prettified-raw fallback). OWNER ACTION: apply both patches, verify collapse/expand, reload persistence, translated names intact.
Pending / Next Steps
Apply Patch 1 (#1 badge), Patch 3 (#3 picker), Patch 4 (#4 expandable notifs), Patches 5a/5b (#5 categories) — all verified OLD text matches current repo state before delivery.
Run the #2 diagnostic snippet and report output; proceed per branch (visibility vs Firefox/fsSupported vs stale SW shell).
Verify after application: badge fully visible; snapshot picker lists all snapshots and restores the selected one; per-app chips toggleable; categories collapse/expand and survive reload; no console errors during any of the above.
From prior session, still open: manual deletion of legacy Kanban board mumfy266amf80 (tombstone propagation) and the final two-device verification cycle (no duplicate seeds, calendar feeds after sync, contacts stable, tick chain clean).
Workflow rules honoured: every OLD block verified against actual submitted file content before delivery (no guesses); user notified explicitly when patches remain to be applied vs already-present guards; patches delivered strictly in OLD → NEW searchable copy-paste format; no version number touched (owner-controlled / Action-automated); no unrelated code modified in any patch.

---

# Changelog — Spreadsheet Wave 3 Audit

## orOS Spreadsheet (v0.36.x, Wave 3) — Functional Audit & Bug Fixes

**Date:** 2026-09-29

---

### Summary of this session

Full functional audit (deep review) of the Spreadsheet application across three files:
`spreadsheet.js`, `index.html`, `spreadsheet.css`. Identified 10 findings + 1 hidden bug;
applied 11 patches (all delivered as OLD → NEW copy-paste blocks, one by one). No changes
to HTML or CSS — all findings concerned the JS. No manual version bumps — versioning is
handled by the GitHub Action.

---

### Fixes — applied and verified

**FIX-1 (F1 + #3) — Pointer/tap logic, cross-browser.**
The OLD click handler sniffed `e.pointerType === "mouse"` on the `click` event, which
does not exist on Firefox/Safari MouseEvents. On those browsers every single desktop
click opened the cell editor. On mobile, the first tap opened the editor instead of just
selecting. On Chrome, the first click after committing an edit only closed the editor
without selecting the target cell. Fix: flag-based structure in `wire()`:
- `ptrType` captured on a capture-phase `pointerdown` listener (works in every browser)
- `mdSelected = (ptrType === "mouse")` — mouse clicks are owned by the mousedown handler
- `tapWasSelected = (r === selR && c === selC && !editing)` — computed BEFORE
  commitEdit in the mousedown handler, so tapping an already-selected cell opens the
  editor
- mousedown now calls `commitEdit(0, 0)` and CONTINUES to select the target cell
  (no second click needed)

**FIX-2 (#2 + hidden bug) — Column resize listener leak + stale sheet entity.**
The OLD `initColResize()` attached a new mousemove/mouseup pair to `document` on EVERY
`buildGrid()` call (sheet switch, sync reshape, sheet deletion) — a permanent listener
leak with stale closures. Additionally, `var sheet = getActiveSheet()` stayed captured
in the old sheet: switching sheets mid-session → resize would write `cw` to the WRONG
sheet. Fix: module-level state (`rsDrag, rsStartX, rsStartW, rsCol`), per-header
handlers in `initColResize()` (the `<th>` elements are discarded on table rebuild — they
cannot leak), and a NEW `initResizeDocHandlers()` called ONCE from `wire()` with a
fresh `getActiveSheet()` lookup on every move.

**FIX-3 (#4) — Dead BOOL_LITERALS branch.**
The tokenizer checked `refMatch && BOOL_LITERALS.hasOwnProperty(...)` — but `refMatch`
requires digits (`/^([A-Z]+)(\d+)$/`), so TRUE/FALSE always fell through to TT_STR and
`=TRUE+1` produced #VALUE!. Fixed: the BOOL check now runs BEFORE refMatch and without
the `refMatch` precondition.

**FIX-4 + FIX-5 (#5) — Wrong message on empty-sheet export.**
`csvExport()` on an empty sheet showed "Corrupted data rescued" (err.corrupt) instead of
an empty-sheet notice. Added a new i18n key `csv.empty` (EN + EL) and the `maxR < 0`
branch now uses `notifyTransient(t("csv.empty"))` instead of `toast(t("err.corrupt"))`
— also switched to a transient notification for consistency with the unified
notification system.

**FIX-6 (#6) — CSV import with >64 columns.**
`csvImport()` accepted as many columns as the file contained, but `normalizeState`
clamps to 64 — cells beyond column 64 existed in the payload but were never rendered
after the next load/merge (silent data loss). Fixed: hard cap in `csvParse()` that
truncates `rows[r].length > COLS` before the sheet is created, so `normalizeState`
never has to clamp already-imported cells.

**FIX-7 (#7) — shiftFormula non-lossless round-trip.**
NOT patched — documented design trade-off. Rebuilding formulas from tokens on paste may
alter number trailing zeros (`2.50` → `2.5`), convert bare identifiers to quoted
strings, and drop whitespace. Recorded as "under consideration" for a future wave
(proper solution: tokenizer with raw positions/offsets).

**FIX-8 (#8) — dirtyFlag never reset.**
The asterisk in the status bar (`st-note`) stayed lit for the whole session after the
first markDirty. Fixed: `queueSave()` now sets `dirtyFlag = false` at the top — the
indicator clears on the scheduled save (400ms debounce) and lights up again on the next
edit.

**FIX-9 + FIX-9b (#9) — findSheetByName with Greek names.**
The `\w` regex is ASCII-only — it stripped Greek characters. `Φύλλο1` and `1` both
normalized to `"1"`, causing wrong sheet resolution in refs like `=Φύλλο1!A1`.
Two-part fix: the `nl` input-normalization line + the comparison line inside the loop.
**CORRECTION NOTE:** the first patch (9a) went in correctly, but the comparison line
inside the loop had been left with the old `/[^\w]/g` — the FIX-9b correction was
applied in a second pass. Both lines now use `/[^a-z0-9\u03b1-\u03c9]/g` (ASCII
lowercase + Greek lowercase range).

**FIX-10 (#10) — Range args in scalar functions.**
ROUND/ABS/IF/NOT read `args[0]` without flattening — a range (array) argument produced
#VALUE!. All four were fixed: they now take `var flat = flattenArgs(args);` and read
from the flattened array. SUM/MIN/MAX/COUNTA already behaved correctly.

---

### NOT fixed (recorded for future waves)

- **shiftFormula lossless rebuild** — design trade-off, documented in the Bible as
  "under consideration"
- **Dead code in `parse()`** — the redundant second LPAREN-pop in TT_RPAREN.
  Functionally harmless; cleanup deferred to a future refactor
- **`fmtNumFormat` dead branch** — `f.nf === nf` never fires (browsers do not emit
  `change` when the same value is re-selected). No functional impact
- **Race in `sanitizeF`** — returns null/undefined sanitized format; safe as is

---

### Practical notes (for future LLM/dev)

- DATA_VER did NOT change (stays 2) — all patches are backwards-compatible, zero risk
  of data loss
- HTML and CSS did NOT change — all IDs/classes were cross-validated (full list: grid,
  grid-wrap, stabs, st-sel, st-note, fx-ref, fx-input, swatches, tb-*,
  btn-csv-imp/exp, doc-title — all present in the HTML)
- The new `initResizeDocHandlers()` must exist BEFORE wire() — it runs exactly once per
  app lifetime
- The CSV >64 column cap MUST live in `csvParse()` (before sheet creation) so that
  `normalizeState` never clamps already-imported cells

---

### Testing checklist (manual verification required before stable)

- [ ] Desktop Chrome: click a cell → selected. Second click on the SAME cell → editor.
      Confirm the editor does NOT open on the first click
- [ ] Desktop Firefox: same test (the pointerType bug was visible there)
- [ ] Desktop Safari: same test
- [ ] Commit edit by clicking elsewhere → the target cell is selected with ONE click
      (not two)
- [ ] Mobile (Brave/Chrome Android): single tap on an unselected cell → selection only.
      Second tap on the same cell → editor
- [ ] Column resize on a DIFFERENT sheet than the one where the drag started
- [ ] Multiple buildGrid calls (switch sheets ×10) → resize → fires only once per drag
      (no stacked applications) — console:
      `getEventListeners(document).mousemove.length === 1`
- [ ] `=TRUE+1` → must return 1 (not #VALUE!)
- [ ] `=FALSE+5` → 5
- [ ] Export CSV on a completely empty sheet → "Cannot export an empty sheet" message
      (not "corrupted")
- [ ] Import CSV with >64 columns → no phantom cells beyond column 64
- [ ] Greek sheet names that collide numerically (e.g. "Φύλλο1" + a sheet named "1") →
      `=Φύλλο1!A1` resolves to the correct sheet
- [ ] Undo (Ctrl+Z) after resize, format change, cell edit — no crash
- [ ] Sync: edit on desktop → mobile → restore; verify col widths (cw) sync correctly
      after FIX-2 (fresh sheet entity)
- [ ] Status bar asterisk toggles correctly: make an edit → lights up → clears after
      ~400ms

---

**Status:** ALL patches applied and verified. Application READY for stable channel
deployment after the testing checklist is completed. On the sync/snapshot/export front:
no changes to the state shape or merge engine — zero risk of data loss.

Designed by Christos Koulaxizis · koulaxizis.gr

---

orOS Changelog — Desktop & Apps Wave (v0.36.x)
This entry documents the full "10-item UX/functionality wave" rolled out across the shell and six applications. All patches were delivered as verified OLD → NEW blocks against actual file contents. No version bumps were made manually — versioning remains GitHub Action territory (shell.js is the single source of truth).

Summary of the Wave
Ten user-reported issues / feature requests were implemented or diagnosed:

#	Area	Item	Status
1	shell.js	Expand/Collapse (all) menu buttons	Done
2	bookmarks.js	Favorites quick-launch strip	Done
3	contacts.js	Label colors aligned with Calendar	Done
4	contacts.js	Read-only contact card + Edit	Done
5	notes.js	Drag & drop notes into/out of parents	Done
6	shell.js	Weather tray retry tick (empty icon fix)	Done
7	time.js / astro.js	Astro panel integration + i18n	Done
8	calendar.js	Custom feed chip explained	No change needed
9	spreadsheet.js	Excel/Calc import & export	Done
10	cycle.js	Quick Log compact grid + toggle	Done
1. Menu: Expand / Collapse all (shell.js)
Two small icon buttons next to the "Applications" menu title. Expand clears the collapsed-categories map; Collapse marks every current category. State is device-local (MENU_CAT_KEY), never synced, never marks sync dirty. Tooltips are inline EN/EL literals (supT pattern) — no new translation keys needed. Both buttons operate on ALL categories, matching the "(all)" semantics.

2. Bookmarks: Favorites strip (bookmarks.js)
Browser quick-launch style grid rendered above the item list. Key architecture: a boolean fav: true field on each bookmark entity (added to sanitizeItem), so favorites sync through the existing whole-entity merge — no separate array that could break sync. Favoriting bumps modified, so newest-favorite sorts first. Strip is built entirely from JS (mount + injected <style>) to avoid depending on unseen bookmarks.css selectors. Hidden during search, tag filtering, and selection mode. Toggle lives in the item context menu (right-click / long-press). Tiles use favicon-style letter chips with host brand color.

Known limitation: Netscape HTML export/import does not carry the favorite flag (format has no concept of it). Possible future work: export favorites as a dedicated "Favorites" folder.

3. Contacts: label colors match Calendar (contacts.js)
Diagnosis: the Contacts LABEL_PALETTE was already identical to Calendar's; the mismatch was in seed mapping — lbl-work was seeded blue while Calendar's Work is red. Fix in two parts:

Seed color change for new installs: Work → red (palette[4]), Personal stays gold, Family stays green.
Migration for existing installs inside reseedSeedNames(): only touches seeds with mtime === 0 (never user-recolored), so user intent is never overridden.
Open follow-up: true single-source-of-truth recoloring (change color in Calendar → Contacts follow on all devices) requires a calendar.js side wiring — deferred.

4. Contacts: read card (contacts.js)
Clicking a contact now opens a read-only card instead of the edit dialog. Card shows avatar, name, sub-line, star, label chips, and grouped sections (phones/emails/addresses/websites/IM/events/relations/note). Phones are tel: links, emails mailto:, websites open in new tabs. Relations are clickable and navigate between cards within the same overlay. An Edit button closes the card and opens the existing edit dialog — zero changes to the save/delete/undo paths.

Also changed: the shell deep-link (__orosContactsOpen, e.g. from Calendar birthday events) now lands on the read card; a sync pull while the card is open closes it cleanly. Duplicate-merge integration was deliberately skipped this wave (dedup machinery already exists elsewhere).

5. Notes: drag & drop re-parenting (notes.js)
Desktop: HTML5 DnD delegated on the persistent #tree-root element (attached once, guarded flag). Rows became draggable. Dropping onto a row makes the note a child of that page (auto-expands it); dropping on empty tree area promotes to root; a top-level page dropped on root is a no-op (prevents surprise reordering). Dropping a page into its own subtree is blocked with a toast (validDropTarget walks ancestors).

Mobile: long-press → "Move to…" dialog lists all valid destinations (own subtree excluded) with depth indentation, "Top level" at the top.

Sync safety: moves only edit parent/pos and bump mtime, so the existing per-page LWW propagates them — no schema or merge changes.

6. Weather tray: retry tick (shell.js)
Root cause: the boot-time wxFetch could fail silently, and nothing retried until an online/visibilitychange event — the tray chip sat in its "waiting" paint indefinitely. Fix: wxFetchTickThrottled() piggybacked on the existing clock tick with a 60-second throttle. wxFetch keeps its own gates (30-min happy path, 2-min retry window), so the tick costs one localStorage read per minute and lets the tray self-heal within minutes without user interaction.

7. Time: Astro section (time.js / astro.js)
astro.js was already complete and functional. The Astro section turned out to be a permanently visible section in the app (not a tab), so earlier tab-integration patches were withdrawn. Final state: complete EN i18n key block added to astro.js (EL already existed), and render exposed defensively as window.__orosAstroRender for future deep-links. Astro refreshes on visibilitychange and on location changes (manual/GPS/weather-sourced).

8. Calendar: custom feed chip — diagnosis only (calendar.js)
No code changes. The "Custom Feed" chip surfaces Contacts events of type custom with a label (e.g. namedays, job milestones). It is brown (#c8a96e), deliberately outside LABEL_PALETTE so it cannot be deleted or recolored from the label manager; it lives in FEED_LABELS and never travels through the sync blob. Clicking deep-links to the contact. This is all by design and correct.

9. Spreadsheet: Excel / LibreOffice import & export (spreadsheet.js)
SheetJS (xlsx.full.min.js) vendored locally in vendor/ — lazy-loaded on first use with candidate paths, graceful toast degradation if the file is absent (same discipline as jspdf in cycle.js; no CDN ever).

Import: every worksheet becomes a NEW orOS sheet (never overwrites data, same contract as CSV import). Values, booleans, dates (as ISO-ish strings), and formulas ride through as raw "=..." strings — our evaluator computes what it knows; unknown functions show #NAME? locally but round-trip intact on export. Capped at 500 rows × 64 columns (normalizeState limits) with a truncation toast.
Export: ALL sheets → one workbook, .xlsx or .ods via a small menu. Sheet names sanitized to Excel rules (no []:*?/, ≤31 chars, deduplicated). Column widths ride along (cw → !cols). Numeric-looking strings become real numbers (no green Excel triangles), except leading-zero values like phone numbers, which stay text.
Buttons ("XLS" import, "XL" export with mini-menu) are JS-injected next to the CSV buttons — zero dependence on unseen spreadsheet.html markup. Export menu closes on outside click (swatch popover pattern).
Not exported (yet): cell formatting (bold/colors/number formats) — data, formulas, and column widths only; a future wave can map the f field to SheetJS cell styles.

10. Cycle: Quick Log grid (cycle.js)
The full calendar view is kept intact (it still feeds the orOS Calendar as agreed) but is no longer the default. New compact Quick Log grid (7×5, smaller cells with flow-color fills, prediction borders, tiny marks) renders first, with a header toggle chip switching between Quick Log and Full Calendar. Clicking a day opens the existing day editor flow unchanged. Month navigation (‹ › + Today) mirrors the existing calendar. Uses the same state.days/state.periods and merge engine — sync-compatible by construction. All UI is built with the existing cal-* classes plus an injected compact CSS block.

Standing rules reaffirmed this wave
All patches: verified OLD → NEW copy-paste blocks against actual file content. No hallucinated targets, no guesses.
Optional dependencies (SheetJS) are vendored, lazy-loaded, non-breaking when absent.
Every new feature must survive the pre-sync checklist: Calendar feed integration where relevant, unified notifications, Dropbox sync, snapshot coverage, full manual/auto export.
Core kernel is frozen during feature waves — only verified app-level files were touched.
Data safety: no migration in this wave can lose user data (all migrations guard on never-user-touched flags).
Pending / future work backlog
Bookmarks: favorites survival across Netscape HTML export/import (dedicated folder).
Contacts: true shared label palette with Calendar (needs calendar.js wiring).
Spreadsheet: cell formatting (bold/color/number format) export via SheetJS cell styles.
Cycle: optional quick-action buttons above the Quick Log grid (Start Period, Symptom, etc.).

---

Writer Wave 5 — I/O COMPLETE
Pre-fixes (7 patches, prerequisite bugs):

ICONS: added missing close/plus (tab bar and dialog close rendered "undefined")
paintIcons: extended map to cover all 31 toolbar buttons (footnotes, comments, toc, meta, page, templates, versions, goal, export, import, find, chars were invisible)
EN strings: fixed broken rtf keys (io.rtfdescr/io.rtfnote → io.rtf.desc/io.rtf.note)
EL strings: added missing io.impAppend
resetMargins: no longer calls nested updatePreview() — self-contained preview refresh (was ReferenceError on Reset click)
updatePreview: .paper-caption is a sibling, not a child of #preview-paper — fixed null crash
toggleTocPanel: headings now get stable ids before listing — TOC entries are clickable again
Exports (8 formats):

TXT: plain text, footnotes as [n], page breaks as blank separators
MD: full Markdown round-trip incl. pipe tables, nested lists, real [^n] footnotes with definitions
HTML: standalone document, metadata as meta tags, footnotes appendix in ref order
RTF: hand-rolled writer, \uXXXX escapes per UTF-16 unit (Greek-safe), page geometry from doc settings, metadata in \info
DOCX: 100% native OOXML builder — hand-rolled ZIP STORE with own CRC32, heading styles (Word navigation), tables, page breaks, metadata in docProps/core.xml (tags + category ride along). Images → [image: alt] placeholder (documented v1 limit)
PDF: lazy-loaded jsPDF + NotoSans-Regular.ttf (fixes historical Greek mojibake), word-flow renderer preserving bold/italic/underline/superscript across line breaks, header/footer + page numbers, footnote/comment appendix. Faux-bold only (single TTF) — swap in NotoSans-Bold.ttf later if wanted
OROSDOC: full round-trip archive (html, footnotes, comments, metadata, page setup)
JSON: entire slice (all tabs, settings, templates, autocorrect)
Imports (7 formats):

TXT/MD/HTML/RTF/OROSDOC/DOCX/ODT via unified dispatcher
HTML sanitizer strips scripts, iframes, on* handlers, javascript: URLs
DOCX/ODT: native ZIP reader (hand-parsed central directory + DecompressionStream deflate-raw), conservative formatting import (headings, bold/italic/underline/strike/superscript, tables, line breaks; Word list numbering → plain paragraphs for now)
Import modes: New tab (default) / Append to current / Replace current (duplicates current into Version History first)
Annotations always receive fresh ids on import — no clashes with existing doc state
JSON full-database import → hydrate() restore offer with confirm
Drag & drop:

Fullscreen overlay on the editor area (.rich-wrapper, the positioned ancestor), counter-guarded nested drags
Dropped file feeds the same parse → mode-selection flow as the import dialog
Architecture notes:

All exports are built from editorHTMLForSave() clones — live editor never touched
jsPDF loads ON DEMAND only (vendor/jspdf.umd.min.js + vendor/NotoSans-Regular.ttf relative to index.html — verify paths against your repo layout)
Zero new external dependencies: DOCX export/import fully native, ZIP CRC32 hand-rolled
Known v1 limits (deliberate, for future waves):

RTF lists literal markers (lossy, flagged in UI); images not carried in RTF
DOCX/RTF/PDF: images → placeholders
PDF: single font face (faux bold via same TTF)
DOCX import: w:b w:val="0" edge ignored; numbering.xml not processed
Dead code candidates: rtfInline/rtfFmt/rtfInlineOk (optional cleanup block provided)
Checklist after deploy (verify before stable):

Greek text → RTF/DOCX/PDF round-trip in Word + LibreOffice
Export JSON → wipe → import → verify all tabs/templates/autocorrect intact
Drag & drop a DOCX and an MD file → New/Append/Replace all behave
Confirm vendor paths resolve (404 in console = wrong location)

---

2026-09-29 — [Dice & Coin v0.4 5/5 VERIFIED] First orOS-native port from Soffitta:
  · BUILD: separated index.html/dice.css/dice.js (offline-first iframe pattern)
  · SYNC: union-by-id + LWW + tombstones with deterministic merge (max-mtime pruning + id tie-break)
  · MODES: Normal / Keep Highest / Keep Lowest / Drop Lowest (generalized for any count/type)
  · CRIT/FUMBLE: any die (single=max=crit, single=1=fumble; multi=all-max=crit)
  · COIN: 3D flip animation + persistent stats (derived from merged history, never stored)
  · HISTORY: 50-entry cap, tombstone resurrection, clipboard share
  · UX: Space=roll/C=coin (scoped + Contract Β forwarding), 5s toasts, touch targets ≥44px
  · SECURITY: esc() on share card, mtime field on entries for merge determinism
  · DOCTRINAL EXEMPTION: Calendar-exempt (non-time-bound), Notifications-exempt (no emitters)
  · FIVE-AXES: Calendar=N/A, Notifications=PASS(transient only), Sync=PASS, Snapshots=PASS(shell), Export=PASS(shell DB)
  · BIBLE PATCHES: B-1 (Part III registry: +Dice 5/5 verified), B-2 (Part IV data model: DICE v1 schema),
    B-3 (Part IX exemptions: Dice calendar/notifs exempt)
	
	---
	
	Writer Wave 5 — Post-Audit Corrections
=======================================

String fixes:
- EN+EL: added 'doc.saved' (Ctrl+S feedback now localized)
- EN+EL: added 'link.displayText' (fixed broken placeholder in
  Insert Link dialog that showed "Document renamed")
- EN+EL: added 'table.headerRow' (fixed broken checkbox label that
  showed "Whole word")
- EN+EL: added 'wx.done' + 'wx.cancel' (replaced wx.cancel hack
  with real keys across all dialogs)

Cache-buster fix:
- ioFetchFontB64 (PDF export): changed from
  ?v=encodedPath (wrong — not a real version, just the filename)
  to ?t=timestamp (forces reload when font file updates locally)

Dead code removal:
- Deleted rtfInline() + rtfFmt() — unused (only rtfInlineRe +
  rtfWrap are active in ioExportRtf)
- Deleted wireHeadingsForToc() — never called anywhere
- Removed unused saveLines shim in blockFromLines (md parser)

Duplicate removal:
- EL opt.format.* keys existed twice (before find.none AND before
  page.settings) — removed the second block, kept first intact

Deploy checklist:
1. Ctrl+S toast now bilingual ("Document saved" / "Το έγγραφο
   αποθηκεύτηκε")
2. Link dialog placeholder shows "Display text" / "Κείμενο
   εμφάνισης" instead of "Document renamed"
3. Table dialog checkbox shows "Header row" / "Γραμμή
   κεφαλίδας" instead of "Whole word"
4. PDF font loads fresh when vendor/NotoSans-Regular.ttf changes
5. Dialog close buttons use proper translation keys
6. No dead functions or duplicate strings remain

Wave 5 is now 100% complete. Next step: deep audit of the
next queued application (Bookmarks, Kanban, etc.).

---

Writer Wave 5 — Post-Audit Corrections (FINAL)
===============================================

Critical fixes:
- RTF EXPORT CRASH: B1 (dead code removal) was applied half-way —
  the old rtfFmt body got renamed to rtfInlineRe while the real
  rtfInlineRe already existed, and rtfWrap vanished from the file.
  Any RTF export threw "ReferenceError: rtfWrap is not defined".
  Fix: restored rtfWrap(text, fmt) as its own function; single
  rtfInlineRe walker remains (verified — no duplicate names now)

String / i18n cleanup:
- EL: removed the second opt.format.* block (duplicate entries
  after goal.unlockConfirm — first block before find.none kept)
- openCharsDialog / openLinkDialog: removed the
  t('wx.cancel') === 'wx.cancel' hack → real t('wx.cancel')
- openImageDialog / openTableDialog: '✕' → t('wx.cancel')

Already applied and verified in writer (6).js (no action needed):
- doc.saved (Ctrl+S toast localization), link.displayText,
  table.headerRow, wx.done/wx.cancel keys (EN+EL)
- ioFetchFontB64 cache-bust (?t=timestamp)
- wireHeadingsForToc removed, saveLines shim removed,
  openAcDialog uses t('wx.done')

Known-clean leftovers (documented, deliberate):
- state.settings.typewriterSound — dead setting, no consumer
- DOCX import: w:b w:val="0" ignored; numbering.xml lists →
  plain paragraphs (v1 conservative import)
- DOCX appendix dxRun({super:false}) — harmless dead key

Deploy checklist:
1. Export RTF succeeds and opens in Word/LibreOffice (Patch 1)
2. Language switch EL: no duplicate strings, all dialog buttons
   localized ("Ακύρωση" everywhere instead of ✕/Close)
3. Ctrl+Alt+T / Ctrl+Alt+W, Ctrl+S toast, Lorem button, Settings
   dialog (Smart Typography + Auto-correction entry) all intact
   
   ---
   
   Writer Wave 5 — Post-Audit Corrections (FINAL)
Critical fixes
GOALS SYNC DATA LOSS: serialize()/hydrate() now round-trip doc.goal (type/target/lock/startTs/startWords) — active goals no longer wiped on reload/sync.
DD-OVERLAY STICK BUG: .dd-overlay{display:flex} appeared after the global [hidden] guard at equal !important specificity — overlay stayed visible forever after first drag. Fixed with .dd-overlay[hidden]{display:none!important} (0-2-0 specificity).
BROWSER-RESERVED SHORTCUTS: Ctrl+T / Ctrl+W replaced by Ctrl+Alt+T (new doc tab) / Ctrl+Alt+W (close doc tab) — preventDefault is honored for these in all browsers.
RTF EXPORT CRASH: the B1 dead-code removal was applied half-way — the old rtfFmt body got renamed to rtfInlineRe while the real rtfInlineRe already existed, and rtfWrap vanished from the file. Any RTF export threw "ReferenceError: rtfWrap is not defined". Restored rtfWrap(text, fmt) as its own function; single rtfInlineRe walker remains (verified, no duplicate names).
Feature wiring (previously orphaned code)
TOC inline: generateTocHTML now assigns real ids to live headings before building the list — anchors resolve, links navigate. Removed dead wireHeadingsForToc() (never called anywhere).
Templates dialog: Export JSON button added (exportTemplateJson was unreachable — only Import had a button).
btn-lorem added to toolbar (dynamic injection in bindToolbar, R9 icon painting) — insertLorem() reachable at last; placed after btn-chars.
NEW app-scoped Settings dialog (btn-settings, dynamic injection, last toolbar slot): Smart Typography toggle (live-apply, _mtime drives settings LWW in mergeSlices) + Auto-Correction Rules entry (openAcDialog stacks on top of the settings modal) — smartTypography had no UI before, openAcDialog had no trigger.
String / i18n cleanup
EN+EL: added tt.settings, tt.lorem, doc.saved, link.displayText, table.headerRow, io.dbConfirm, io.naming, wx.done, wx.cancel.
EN+EL: Ctrl+S toast localized ('Saved' → doc.saved).
EL: 'char.symbols' was Spanish ('Símbola') → corrected to 'Σύμβολα'.
EL: added missing io.html.name / io.html.desc.
EL: removed the second opt.format.* block (duplicate entries after goal.unlockConfirm — the first block before find.none kept).
Dialog buttons: removed the t('wx.cancel') === 'wx.cancel' hack and hardcoded '✕'/'Close' labels across openAcDialog, openCharsDialog, openLinkDialog, openImageDialog, openTableDialog — all now use real t('wx.cancel') / t('wx.done') keys.
Insert Link dialog: broken placeholder that showed the unrelated "Document renamed" string → link.displayText.
Insert Table dialog: header-row checkbox label that showed the unrelated "Whole word" string → table.headerRow.
Other fixes
ioFetchFontB64 (PDF export): cache-buster was ?v=<font path itself> (static, wrong) → ?t=timestamp (forces reload when the local NotoSans-Regular.ttf changes).
Dead code removal
Deleted rtfInline() + rtfFmt() (unused; only rtfInlineRe + rtfWrap are active in ioExportRtf).
Deleted wireHeadingsForToc() (never called).
Removed unused saveLines shim in blockFromLines (markdown parser).
Known-clean leftovers (documented, deliberate)
state.settings.typewriterSound — dead setting, no consumer yet.
DOCX import: w:b w:val="0" ignored; numbering.xml lists → plain paragraphs (v1 conservative import).
DOCX exporter dxRun({super:false}) — harmless dead key, ignored.
Dialog DOM accumulation on many open/close cycles (minor leak).
Deploy checklist
Toolbar single row at 1920px with the 2 new buttons (31+2 total).
Lorem button inserts paragraph; Settings gear opens dialog; Smart Typography toggle persists across reload + sync; Auto-Correction rules dialog opens from Settings, add/delete/reset OK.
Ctrl+Alt+T / Ctrl+Alt+W behave; plain Ctrl+T/Ctrl+W go to the browser. Ctrl+S toast localized in both languages.
Drag & drop overlay hides after drop/leave (CSS guard).
Export RTF succeeds and opens in Word/LibreOffice.
Language switch EL: no duplicate strings, all dialog buttons show "Ακύρωση"/"Ολοκλήρωση" instead of ✕/Close/Cancel.
PDF export font loads fresh when the vendor font file changes.
Wave 5 (I/O) is now closed. Next in queue per roadmap: deep audit of the next application (as ordered in OROS_BIBLE).

---

Cycle — Timeline Rewrite (Wave: Quick Log → Timeline)
Summary
Replaced the month calendar view (both Full Calendar and Quick Log grid) with a single horizontal Gantt-style Timeline view. The orOS Calendar app is now the authoritative "month" view for cycle events; the Cycle app focuses on history, trends and day-entry.

Changes
View architecture
Removed renderCalendar() — the full month grid (JS + its renderCalendar-scoped UI: month nav, weekday header, day cells, reminder toggle).
Removed renderQuickLogGrid() and the Quick Log ↔ Full Calendar toggle (calCompact, ql.fullcal chip).
Added renderTimeline() — a Gantt strip rendering on the existing #calview host element (no HTML structural change needed):
One colored bar per period; fill opacity encodes flow intensity (per1/per2/per3, red family #e06c75).
Ongoing periods render up to today — the future is never painted as bleeding.
Prediction renders as a dashed bar (accent color), guarded by nextPrediction().
Vertical today-marker line.
Zoom controls: −/+ adjust visible range in 7-day steps (min 7, max 90 days); default 30 days.
Navigation: ‹ › scroll by half the visible window; "Today" button resets anchor to null (= today-centered).
Legend: three flow levels + prediction.
Click on a period bar → opens the day editor of that period's LAST day.
New view state (session-only, never persisted): timelineZoom, timelineAnchor ("YYYY-MM-DD" or null = today). Replaced dead vars calCompact, calMonth.
All "calendar" references migrated to "timeline"
viewMode default and all checks: "calendar" → "timeline" throughout applyView(), renderAll(), refreshInView(), sliceSet() (both the openDay-drop check and the syncing-in-editor check), wire(), fillDayRows() edit button, factoryReset() (resets timelineAnchor).
__orosCycleOpen() (deep-link receiver, shell-called):
Period uid payload → timeline anchored on that period's start date.
Prediction day key ("YYYY-MM-DD" from cycle:pred: notification deepLinks) → timeline anchored on that date so the dashed prediction bar is visible.
Shape collision impossible: period uids are base36, day keys contain dashes.
i18n
EN: "tab.cal" "Calendar" → "Timeline".
EL: "tab.cal" "Ημερολόγιο" → "Χρονογραμμή".
Strings ql.title, ql.fullcal, ql.quick, ql.flowonly remain in both dictionaries but are now orphaned (no code references) — candidates for a future cleanup pass.
Dead code removed
dayInPrediction(ts) — its only callers were the two deleted grids; the timeline uses the prediction bar via nextPrediction() range math instead.
Styling
ensureQlCss() (compact-grid CSS) replaced by ensureTlCss() — injects .tl-head, .tl-nav, .tl-bars, .tl-bar (.per1/.per2/.per3/.pred), .tl-today, .tl-legend, .leg-item, .leg-dot, .zoom-val via a one-shot <style> tag at boot.
cycle.css untouched — all timeline styling is JS-injected; the file's old .cal-cell, .cal-wk, .cal-grid rules are now inert (no matching DOM) and can be pruned in a future CSS cleanup.
Buttons reuse the existing .chip.ghost and .cal-today classes where possible for palette inheritance.
Preserved contracts (unchanged)
Data model, merge engine, tombstones, deterministic day ids — untouched.
Unified notifications (__orosCycleCheck, transientNote, boot-time staged deep-link take) — untouched.
Sync slice registration and unsaved-edit survival during remote pulls — untouched (only the viewMode literal changed).
Day editor, days list, insights, mood cross-app section, doctor report PDF, factory reset double-confirm — untouched.
periodCovering() and nextPrediction() logic unchanged; only consumption sites changed.
Known notes
index.html comment above #calview still says "month calendar" — cosmetic only, optional fix.
Verification checklist: (1) reload boots timeline with no console errors, (2) period bar click opens day editor of the period's last day, (3) Calendar feed row click anchors the timeline on the period, (4) notification deepLink cycle:pred: anchors on the prediction date, (5) Save day returns to the timeline (previously fixed: openDay = null before renderAll()).

---

2026-09-30 — [Screen Pet v0.1 Integration (Soffitta port)] Second orOS-native Soffitta port — first port as a SHELL COMPONENT (not an iframe app):
  · BUILD: root-level pet.js + pet.css, own overlay layer #pet-layer above taskbar; menu toggle via renderPetSection() (inline EN/EL literals per supT doctrine — zero translations.js changes); progressive guard (stale bundle without pet.js renders nothing)
  · MODEL: stats DERIVED never stored (relaxed decay: food 24h, happy 36h, energy 10h awake / +8min asleep; auto-sleep <8, auto-wake ≥95; retroactive energy cycle resolution keeps multi-day absences deterministic and identical across devices)
  · SYNC: oros-pet-data slice (5-arg registerSlice with mergeFn); identity per-field LWW via fm mtime map; temporal anchors max-value; anchor pairs travel together; tombstones prevent dead-pet resurrection (R17-conformant)
  · FEATURES: 16×16 sprite engine with corrected directional pupils + walk animation; drag (pointer capture, 8px threshold vs click); click-to-pet (hearts); click-to-walk (targeted movement); F=feed / S=sleep with strict modifier guards + input-field exclusion; HUD with dynamic bars; "New Pet" confirmation + tombstone; no death mechanic
  · INTEGRATION: index.html (pet.css link + pet.js after sync.js, before shell.js); shell.js (renderPetSection + renderMenu call, device-local toggle); sw.js already precached both files (no change)
  · BIBLE: registry + keys + file tree + subsystems + PET v1 schema + Part IX exemptions recorded
  · DEVICE-LOCAL: oros-pet-enabled (ergonomics, never synced)
  · EXEMPT: Calendar axis + Notifications axis (see Part IX doctrinal exemptions)
  · STATUS: integration complete — pending smoke test (QUEUED list)
  
  ---
  
  Wave 2 — Minimalism: Shell Integration (App #minimalism)
Goal: Embed the Minimalism app (Wave 1 bare core) into the orOS shell: menu presence, deep links, unified notifications, sync, offline precache. All patches additive — zero existing behavior touched.

Architecture decisions (locked):

Notification logic lives SHELL-SIDE (minimalismCheckTick detector in shell.js), scanning the app's localStorage slice directly. The app itself never emits reminders — works even when the app is closed (same contract as Mood/Cycle detectors).
Reminder fires once/day at/after prefs.remindHour (design default 10:00, user-adjustable in app Settings, travels in the sync slice). ANY entry for today (done OR skip) silences it — a skip is deliberate engagement, never punished.
Deep link format: minimalism:today:<ymd> → three parts → router passes bare ymd to __orosOpenMinimalism. Closed app = sessionStorage staging (one-shot take at app boot, device-local, never synced). Receiver validates ^\d{4}-\d{2}-\d{2}$.
Icon: circle with centered dot ("less is more") — feather glyph was taken by prompter, smile-circle by mood, rotation-arrows by cycle. No collisions.
Category: lifestyle (Lifestyle / Τρόπος Ζωής). New category.* keys required in translations.js if the category didn't exist yet.
Patches applied:

shell.js S1: ICONS.minimalism (circle + dot SVG, after dice:) — APPLIED
shell.js S5: bridges __orosOpenMinimalism + __orosMinimalismTakePending (after Quote bridge) — APPLIED
shell.js S2: minimalismCheckTickThrottled() call in renderClock (after quoteCheckTickThrottled) — DELIVERED, awaiting application confirmation
shell.js S3: detector block minimalismCheckTick (60s throttle, hour-gate from slice prefs, dedup key ritual-<ymd> via emit, ns "minimalism", inline minT i18n — mood/cycle pattern, zero new shell translation keys) — DELIVERED
shell.js S4: boot catch-up sweep at 5500ms (after cycle 5000ms) — DELIVERED
notifications.js N1: KNOWN_APPS += 'minimalism' (toggle auto-initializes true via loadSlice; Settings UI renders from getKnownApps single source) — DELIVERED
notifications.js N2: DL_BRIDGES.minimalism → __orosOpenMinimalism, guarded typeof (NOT-R2 pattern) — DELIVERED
apps.json AJ1: entry {id: "minimalism", icon, url: "minimalism/index.html", category: "lifestyle"} — DELIVERED
translations.js TR1/TR2: app.minimalism (EN "Minimalism" / EL "Μινιμαλισμός") + category.lifestyle if missing — DELIVERED
sw.js SW1: PRECACHE_URLS += minimalism/, index.html, css, js, content.js (per-URL add — one missing file degrades, never kills the precache) — 4 entries applied earlier; directory entry "minimalism/" added this pass
Free wins verified (no code needed): dedup is inbox-level (minimalism:ritual-<ymd>, 7-day TTL); catch-up <24h re-toasts on mobile wake; >24h badge-only; quiet hours suppress toast but keep inbox+badge; per-app toggle honored via emitCandidate; transient path never involved.

Verification checklist before shipping:

shell.js — confirm S2/S3/S4 applied and boot log shows no ReferenceError on minimalismCheckTickThrottled (stale-bundle proof: detector guards typeof emit).
Confirm sysYmd() and state.lang exist in shell.js scope as used by S3 (same identifiers the mood/cycle detectors use — quick console grep before release).
Menu → Lifestyle → Minimalism opens with correct icon + label in both languages.
Set remindHour to current hour (app History → daily reminder select), no entry today → toast within 60s; clicking the toast/inbox item opens the app on today's card.
Todo/Quote/Cycle apps unaffected (regression smoke).
Offline: disable network after install → Minimalism loads from precache.
Sync: complete entries on device A, cold-start device B → History view reflects merged days, no duplicates.
Next up: Content expansion — Days 6–365 of content.js in review batches (currently Days 1–5 placeholders; shorter arrays wrap via modulo, so partial batches never crash). Backlog (future waves): Calendar feed visualization for minimalism completions, Revisit mode for skipped items, year-end contribution graph widget.

---

# Writer — Wave 5 Audit Fixes (14 patches, post-Wave-5 stabilization pass)

## Context

Deep audit of the Writer app (wave 5 — I/O) after completion of the main
feature set. The audit surfaced 14 issues: functional bugs, localization
errors, an XSS vector, a DOM leak, dead code, and one missing CSS print rule.
All fixes were delivered as verified OLD -> NEW blocks and confirmed applied
against the live files (writer.js, writer.css, index.html).

## Fixes applied (writer.js)

1. Table dialog — the footer had two buttons but no Insert action. The
   secondary button was rebound to t('table.insert') triggering doInsertTable;
   the cancel button now uses t('wx.cancel'). New key: table.insert (EN/EL).
2. Auto-correction never fired — the rule check ran inside a setTimeout
   after the Space keypress, so the caret had already moved and the regex
   tail match failed. Converted to a direct synchronous call inside the
   keydown handler.
3. Auto-correction crash — state.autocorrect is null until the user first
   opens the AC dialog; deleting a rule on first use crashed. openAcDialog()
   now seeds state.autocorrect with a deep copy of AC_DEFAULTS before
   rendering.
4. Goal bar lock/clear buttons were empty (no icons). wireGoalBar() now
   injects ICONS.lock and ICONS.close. New ICONS.lock entry (SVG padlock).
5. Ten dialogs shipped hardcoded 'OK' / 'Close' labels: settings, metadata,
   page settings, link, image, TOC, templates, edit template, export, version
   history. All replaced with t('wx.done').
6. AC row delete tooltip incorrectly showed t('doc.deleted'). Now uses the
   dedicated key ac.del ("Delete rule" / "Διαγραφή κανόνα").
7. XSS-hardening: five input value attributes in metadata and page settings
   dialogs used esc(), which does not neutralize quotes — a crafted document
   title could break out of the attribute and inject markup. All five now
   use escAttr().
8. DOM leak: openDialog() appended <dialog> elements to the body on every
   open and never removed them. Added a close listener that removes the node
   (dlg.addEventListener('close', () => dlg.remove())).
9. (writer.css) The @media print block hid .tab-bar, .main-toolbar and
   .w-toast but not .find-bar — an open find bar printed as a black strip.
   .find-bar added to the hide list in the Wave 1 print block.
10. Dead code removal: empty beforeunload listener, empty Escape shortcut
    branch, and a redundant ternary in openExportDialog (both arms identical).
11. Emoji grid: characters were split by Array.from() such that the
    variation selector U+FE0F became a standalone cell. renderCharGrid() now
    merges a leading U+FE0F into the preceding character during reduce.
12. Import dialog primary button was disabled/no-op with no feedback. It now
    shows the toast io.pickFirst ("Pick a file first"). New key EN/EL.
13. Hydrate robustness: raw slices synced from older/parallel installs could
    miss the settings object entirely, wiping smartTypography. hydrate() now
    merges incoming settings over defaults (Object.assign) and re-guards
    smartTypography.
14. Invalid HTML: renderTabs() nested a <button> inside the tab <button>.
    The close control is now a <span role="button"> — .tab-close CSS is
    tag-agnostic, no stylesheet change needed.

## New i18n keys (EN/EL): table.insert, ac.del, io.pickFirst

## Verification checklist (all passed)

- writer.js boots clean (IIFE intact, boot marker logs)
- Table insert produces a table; AC rules fire on Space; AC delete works on
  first visit; goal bar shows lock/close icons
- EL mode shows zero raw keys (wx.done, table.insert, ac.del, io.pickFirst
  all present in both packs)
- Quote-containing titles no longer break dialog attributes
- Repeated dialog open/close leaves no orphan dialog nodes in the DOM
- Print preview hides find bar, panels, goal bar, dd overlay
- Emojis render whole in the chars grid (✍️, 📖, 🗓️ etc.)

## Status

Writer Wave 5 (I/O) is feature-complete and audit-clean. Next queued work:
final OROS_BIBLE integration for the full Wave 5 changelog entry (I/O
architecture notes: export chain, native ZIP DOCX, DecompressionStream
imports, lazy jsPDF+NotoSans), then proceed to the next application in the
audit queue.

---

Cycle — Changelog
Wave: Timeline Rewrite + Unified Notification Migration
Summary
Two major tracks landed together: (1) the Cycle app's month calendar view (Full Calendar + Quick Log grid) was replaced with a single horizontal Gantt-style Timeline view, making the orOS Calendar the authoritative "month" view for cycle events while Cycle itself now shows history and trend; (2) all remaining Cycle notifications — including the three undo-bearing toasts — were migrated to the shell's unified notification system, which gained first-class action-button support in transient toasts.

A. Timeline Rewrite (Cycle)
View architecture
Removed renderCalendar() — the full month grid, month navigation, weekday header, day cells, and its reminder toggle.
Removed renderQuickLogGrid() and the Quick Log / Full Calendar toggle chip (calCompact state).
Added renderTimeline() rendering onto the existing #calview host element (no HTML structural change):
One bar per period; fill opacity encodes flow intensity (per1/.45, per2/.7, per3/.95, red family #e06c75).
Ongoing periods render up to today only — the future is never painted as bleeding (same honesty rule as the old grid).
Prediction renders as a dashed bar guarded by nextPrediction().
Vertical today-marker line.
Day-record dots lane below the bars: logged days (even outside periods) are visible and each dot is a direct click-target into that day's editor.
"+ Log today" button in the timeline head — the primary entry into the day editor without needing an existing period.
Zoom controls: −/+ adjust visible range in 7-day steps (min 7, max 90); default 30 days.
Navigation: ‹ › scroll by half the visible window; "Today" button recenters.
Legend: three flow levels + prediction.
Click on a period bar → day editor of that period's last day.
New session-only view state: timelineZoom, timelineAnchor ("YYYY-MM-DD" or null = today-centered). Replaced calCompact and calMonth.
viewMode migration ("calendar" → "timeline")
All literal checks and assignments migrated in: applyView(), renderAll(), refreshInView(), wire(), fillDayRows() edit button, sliceSet() (both the openDay-drop check and the syncing-in-editor check), factoryReset() (now resets timelineAnchor).

Deep links
__orosCycleOpen() (shell bridge, called by Calendar feed rows and notification deepLinks):

Period uid payload → timeline anchored on that period's start date.
Prediction day key ("YYYY-MM-DD" from cycle:pred: notification deepLinks) → timeline anchored on that date so the dashed prediction bar is visible.
Shape collision impossible: period uids are base36, day keys contain dashes.
i18n
EN: tab.cal "Calendar" → "Timeline".
EL: tab.cal "Ημερολόγιο" → "Χρονογραμμή".
Added tl.log ("Log today" / "Καταγραφή σήμερα").
Strings ql.title, ql.fullcal, ql.quick, ql.flowonly remain in both dictionaries but are now orphaned (no code references) — candidates for a future cleanup pass.
Dead code removed
dayInPrediction(ts) — its only callers were the two deleted grids; the timeline uses nextPrediction() range math instead.
Styling
ensureQlCss() (compact-grid CSS) replaced by ensureTlCss() — injects .tl-head, .tl-nav, .tl-bars, .tl-bar (.per1/.per2/.per3/.pred), .tl-today, .tl-days, .tl-dot, .tl-legend, .leg-item, .leg-dot, .zoom-val via a one-shot <style> tag at boot.
cycle.css untouched — timeline styling is JS-injected; the file's old .cal-cell / .cal-wk / .cal-grid rules are inert (no matching DOM) and can be pruned in a future CSS cleanup.
B. Bug Fixes (Cycle)
Editor did not close after Save day
Root cause: applyView() was the sole owner of the hidden flags on #calview / #dayview, but renderAll() only repainted container contents. On Save: openDay was nulled and the timeline repainted — inside a still-hidden #calview, with the dead editor still visible in #dayview. Fix: renderAll() now simply calls applyView() — visibility flags and rendering are one operation. Every exit path (save, remove period, delete day, factory reset) funnels through applyView.

"Saved" toast fired before pressing Save day
Intermediate mutations were calling transientNote(t("saved.toast")) on every change. Removed the toast from takeMed(), endHere, extendHere, and startPeriodAt() — the visual result (chip list, editor chrome) is already immediate feedback; the single remaining "Saved" toast is the Save day button itself.

"No periods logged yet" via legacy toast
exportDoctorReport() guard used the local showToast() instead of transientNote(). Fixed earlier in this wave; retained.

C. Unified Notification Migration (Cycle → orosNotifs)
Remaining legacy toasts
Three undo-bearing toasts were the last Cycle notifications still on the local showToast() system: removePeriod(), deleteDay(), deleteColVal(). Root blocker: the shell's transient() payload was one-dimensional (ns/title/body only) with no action callback — the undo button had nowhere to attach.

Shell extension (notifications.js)
transientToast() now accepts action: { label, fn } (validated once, label must be non-empty string, fn must be function) and an optional deepLink. Transient items never enter state.slice.items, so a function reference in the payload is never serialized or synced — same-origin iframe closure, safe by construction.
fireToast() renders an action button (.notif-action, accent color, beside the ✕ dismiss) when the item carries a valid action.
Action click handler: stopPropagation(), runs fn inside try/catch (errors logged as [orOS][notifs] ERROR: Action callback failed), marks the item read, removes the toast — never triggers the deep link.
Undo-bearing toasts get an extended auto-remove window: Math.max(duration, 8000) — an undo that vanishes in 5s is a cruel joke.
Body clicks unaffected: dismiss click and action click are excluded from the deep-link handler.
Transient toasts remain exempt from sound (NOT-R4) and from OS-level native notifications (Wave 10).
App-side integration (cycle.js)
transientNote(text, actionLabel, actionFn) — same signature as the local showToast(), so migrating the three call sites was a one-word change. Falls back to showToast(text, actionLabel, actionFn) when the app runs standalone (no shell / no orosNotifs).
removePeriod(), deleteDay(), deleteColVal() now route through transientNote() with del.done / col.del.done titles and del.undo / col.del.undo action labels, restoring the pre-deletion state on undo (bump mtime, re-push record, clear tombstone, save, render).
Default position
First-boot (fresh installs) notification position default changed from top-right to bottom-right in defaultSettings(). Existing devices keep their persisted choice (LWW via settingsRev — unaffected).

D. Preserved Contracts (unchanged)
Data model, merge engine, tombstones, deterministic day ids.
Unified notification scheduling (__orosCycleCheck, boot sweep, quiet hours, app toggles) — untouched.
Sync slice registration and unsaved-edit survival during remote pulls — only the viewMode literal changed.
Day editor, days list, insights, mood cross-app section, doctor report PDF (vendored NotoSans), factory reset double-confirm.
periodCovering() and nextPrediction() logic unchanged; only consumption sites changed.
E. Verification Checklist
Reload → timeline renders with no console errors; toast position bottom-right on fresh installs.
Period bar click → day editor of the period's last day; day dot click → that day's editor; "+ Log today" → today's editor.
Save day → return to timeline, editor fully closed (no stale #dayview overlay).
Med chip / End here / Extend here / Start period → no premature "Saved" toast; only Save day fires it.
Delete period / day / custom value → toast with undo button (8s minimum window) → undo restores the record; console free of Action callback failed.
Calendar feed row click → timeline anchors on the period; cycle:pred: deepLink → anchors on the prediction date.
Standalone cycle.html (no shell) → local showToast() fallback with working undo.
F. Standing Rules (reaffirmed)
No guessing: patches are verified character-by-character against the actual submitted file before delivery; if a target segment cannot be located, the assistant stops and requests the real file.
All patches delivered as OLD → NEW copy-paste blocks with searchable OLD text and exact location instructions.
Transient items never enter the synced slice — closures remain in-memory, same-origin only.
Changelogs are plain Markdown, English, structured for assistant-facing continuity across chat sessions.
G. Under Consideration
Removing the orphaned i18n strings (ql.title, ql.fullcal, ql.quick, ql.flowonly) from both dictionaries.
Pruning inert .cal-cell / .cal-grid / .cal-wk rules from cycle.css.
Cosmetic comment fix in index.html above #calview ("month calendar" → "timeline").

---

2026-09-30 — Screen Pet v0.2 (Waves 2/3/4): energy-scaled wandering + mood-driven sprite expressions + enriched bilingual speech (5 phrases/category) + throttled hunger reaction (10 min); HUD palette picker + dblclick rename (both per-field LWW via fm) + age line from birthTs; device-local position memory (oros-pet-pos, normalized fractions); sync celebration hop via orosSync.onAutoSync (done-only, interval-excluded, 60s throttle); sliceSet live-refresh on remote merges; FIX-D1: vertical drag no longer snapped to floor every tick. DATA_VER stays 1 — no schema change. pet.css untouched (inline styles).

---

2026-09-30 — Screen Pet v0.2 (Waves 2/3/4 — behavior, identity, OS integration)

CONTEXT orOS Screen Pet is a SHELL component (pet.js/pet.css, root-level, not an iframe app), second Soffitta port. Entity identity (name/palette/timestamps) syncs via the "pet" slice on window.orosSync (registerSlice, 5-arg, mergeFn = mergePetStates); runtime position/frame/mode are per-device, never stored. Stats (food/happy/energy) are DERIVED from temporal anchors, never stored (DATA_VER stays 1 — no schema change). Relaxed pacing: food ~24h, happy ~36h, energy ~10h awake / ~5h asleep; auto-sleep <8, auto-wake >=95; no death mechanic (floor 0). Merge doctrine: temporal fields are their own clocks (max wins), anchor pairs (wokeAt/awakeE, asleepSince/asleepE) travel together, name/palette per-field LWW via fm mtime map (R5), tombstones prevent resurrection. Keys: oros-pet-data (synced), oros-pet-enabled (device-local toggle), oros-pet-pos (device-local position).

WAVE 2 — BEHAVIOR & LIFE

Energy-scaled wandering: walkParameters(stats) derives idle pauses (1.5–3.5s normal → 3–7s when energy <30) and walk range (100% → 30% of stage when energy <30) from derived stats. No new mechanism — tuning of the v0.1 wander loop.
Mood-driven sprite expressions: mood() derives sleep > tired (energy <25 or food <20) > happy (happy >60) > neutral from stats; drawSprite reshapes eyes/mouth accordingly (closed eyes asleep, half-lidded slits + slow blink when tired, wide eyes + shine + smile when happy). Pure rendering, zero storage.
Enriched bilingual speech: 5 phrases per category per language (hungry, bored, tired, happy, eat, wake, sleep), random pick via speakLine().
Hunger reaction: speech-bubble warning once per threshold crossing, throttled to one hungry phrase per 10 minutes (HUNGER_TALK_MS) while food <25; flags reset at food >=35.
WAVE 3 — IDENTITY & PRESENTATION

Palette picker in HUD: 5 swatches (bilingual tooltips), active ring follows synced choice; write via writePet + fm.palette (per-field LWW).
Rename via double-click on the HUD name: inline input, Enter commits / Escape-blur cancels, 16-char cap; write via fm.name. Input defends itself (stopPropagation) so S/F shortcuts stay out of the editor.
Position memory: oros-pet-pos device-local, saved on drag end and disable, stored as normalized fractions (fx/fy in [0,1]) and clamped on restore — survives window-size changes. Never synced, never dirty.
HUD age line: "N days with you" (singular/plural, EN/EL) — display-only math from birthTs (Part IX: never part of sync computation).
WAVE 4 — OS INTEGRATION

Sync celebration: orosSync.onAutoSync(kind, reason) listener — happy hop + heart on kind "done", excluded for reason "interval", 60s throttle (CELEBRATE_MIN_MS), never fires on sleeping/inactive pet. Progressive no-op if orosSync/onAutoSync missing (stale bundle safe).
sliceSet live refresh: remote merges (rename/palette/feed/new entity from another device) now reflect immediately on this device while the pet is active — stats recomputed, HUD redrawn, warn flags rearmed. Inactive → next petEnable() reads fresh state.
FIXES

FIX-D1 (found during v0.2 assembly): updateBehavior() no longer snaps y to the floor every tick while dragging — vertical drag now works (guard: if (runtime.mode !== "drag") runtime.y = Math.max(b.floorY, 60)).
shell.js pet section toggle label: was reusing wx.on/wx.off keys (which read "Weather tray on/off") — replaced with inline EN/EL literals ("On/Off", "Ενεργό/Ανενεργό") via the section-local petT() helper. renderPetSection untouched otherwise.
FILES

pet.js — rewritten (v0.2, sections 1–8). pet.css — UNTOUCHED (all new HUD elements use inline styles). shell.js — one-line toggle label fix in renderPetSection. sw.js/index.html/translations.js — no changes this wave (integration completed in v0.1 wave).
STATUS Integration complete, FIX-D1 applied, pet (3).js verified as final. PT smoke test PENDING (QUEUED in Bible Part IX): retroactive energy after simulated 2-day absence, identity merge rename A→B, drag vs click with vertical axis, position restore after reload, rename/palette sync A↔B, sync hop with throttle, EL/EN speech + HUD + tooltips, modifier guards. Bible updates (Parts III registry status → Done, IV PET v1 schema, IX exemptions, XII changelog) await smoke test closure — draft patches B-1 through B-8 already prepared in-session.




Cycle — Changelog
Wave: Timeline Orientation & Usability Recovery
Summary
The timeline rewrite shipped functional but temporally blind: bars, dots and the today-marker rendered with zero date anchoring, making the view unreadable — the user could not tell which day they were looking at, what the arrows did, or why elements moved. This wave gives the timeline its missing orientation layer, fixes bar-click semantics, restores a lost preference control, and cleans a variable shadowing trap. No data-model, merge, or sync changes — everything is render-side only.

Diagnosis driving the changes
No date information anywhere on the canvas: bars floated over a blank strip with no month axis, no day numbers, no range caption. The only visible cues were colored bars, dots, and a vertical line that shifted with panning — the "element that changes position".
Bar click opened the period's LAST day regardless of where the user clicked (openDay = last day of period), which reads as a random date.
Real regression found: the "Reminders on/off" toggle lived at the end of the deleted renderCalendar() and was never migrated — state.prefs.remind became unreachable from the UI (the __orosCycleCheck gate honors it, but no control could flip it).
Cleanliness: renderTimeline() declared var lg twice (the "Log today" head button and, later, the legend). Legal in strict mode and functionally harmless, but a hazard for future search-based patches.
Changes
Orientation layer (renderTimeline)
Range caption below the controls: "15 Sep – 15 Oct 2026"-style line (locale-aware, el-GR / en-GB), refreshed on every pan and zoom.
Month axis above the bars: one uppercase short-month marker per month boundary crossing the visible window (skipped when it would land past 99% to avoid clipping at the right edge).
Today marker gains a label chip: "Today · 30 Sep" in accent color, positioned right of the line; flips to the left side of the line when the marker sits past 78% of the strip width (flip class).
Period bar tooltips now carry the dates: "Period · Heavy · 3 Sep – 8 Sep" (ongoing periods show start only).
Day-record dot tooltips use the full local form "Mon 3 Sep" instead of the raw Y-M-D key.
Interaction fix
Bar click now opens the day UNDER THE FINGER, not the period's last day: click position fraction × visible window → day offset, clamped to the period's own span (start..effective end). A bar never opens a day outside itself.
Restored control
Reminder toggle returned to the timeline (below the legend), lifted verbatim from the old calendar footer: bell icon + "Reminders on/off", aria-pressed, routes through the om-donor merge rule (prefs edits bump both sm and om — same contract as before). This re-enables the only user control over __orosCycleCheck.
i18n
Added tl.back ("Earlier" / "Νωρίτερα") and tl.fwd ("Later" / "Αργότερα").
Arrow buttons now use these for aria-label AND title; previously they said "Previous month" / "Next month", which was wrong copy for a panning timeline.
Code cleanliness
The legend element renamed lg → legend, eliminating the double-var shadowing with the head's Log-today button.
CSS (ensureTlCss)
New rules injected: .tl-range (centered bold caption), .tl-axis (14px month strip), .tl-mk (positioned month marker, 10px, text-transform uppercase), .tl-today-lab (+ .flip variant for near-right placement).

What did NOT change
Data model, migrate(), merge engine, tombstones, sync slice — untouched.
Prediction math, cycle info strip, day editor, days list, insights, mood cross-app section, doctor report PDF.
Zoom limits (7–90, ±7 steps), pan distance (half the visible window), "+ Log today" entry point, day-dot click (still opens that exact day), __orosCycleOpen anchoring.
Day drafts surviving remote pulls, chip management, factory reset flow.
Application order note
Patches must be applied in numbered sequence — the range-caption patch defines the dstr helper (and the loc locale) used by the bar tooltip, today label, and dot tooltip patches that follow it inside renderTimeline.

Verification checklist
Reload → range caption and month axis visible under the controls; no console errors.
Click different spots along the same period bar → editor opens different days, always within that period's span; editor header shows the clicked day's full date.
Pan with ‹ › and zoom with −/+ → caption updates every time; arrows show the new "Earlier/Later" tooltips.
Today line carries its "Today · <date>" label, flipping sides near the right edge.
Reminder toggle visible below the legend; toggling flips the text/icon state and survives a reload.
Hovering bars and dots shows the new localized date tooltips.
Under consideration
Pruning orphaned i18n strings (ql.title, ql.fullcal, ql.quick, ql.flowonly) and inert .cal-cell / .cal-grid / .cal-wk rules from cycle.css.
index.html comment above #calview still says "month calendar" — cosmetic only.

---

---

2026-09-30 — [Radio Wave 1] Bare core implementation:
  · BUILD: radio/ folder (index.html, radio.css, radio.js v0.1.0)
  · DATA: RADIO v1 schema (favorites[] + deleted{}, stationuuid-based union)
  · SYNC: oros-radio-data slice (5-arg registerSlice with mergeFn: Dice pattern)
  · FEATURES: Countries/genres browse, search autocomplete (3-char trigger),
    favorites sync, recently played (device-local, 20-cap), mini player with
    buffer/error states, offline honesty banner
  · API: Radio Browser API (radio-browser.info) with mirror fallbacks, 30-min
    cache (localStorage), online/offline detection
  · INTEGRATION: apps.json entry (category: "sound"), sw.js precache URLs,
    translations.js keys (EN/EL), Contract Β shortcut forwarding
  · DESIGN: Single OS Skin (shell CSS vars), scrollbar standard, [hidden]
    guard EOF, touch targets ≥44px, safe-area insets, mobile-first grid
  · EXEMPTIONS: Calendar-exempt (non-time-bound), Notifications-exempt
    (transient feedback only — Dice pattern)
  · BIBLE PATCHES: B-1 (Part III registry: Radio v0.1.0), B-2 (Part IV:
    RADIO v1 schema), B-3 (Part IX: exemptions recorded)

Status: Wave 1 COMPLETE — ready for testing.

---

## Batch 1 — Content Expansion: Days 1–55

**Goal:** Replace placeholder Days 1–5 with full bilingual content (Days 1–55, both streams).

**Changes:**
- EN: Added 100 entries (55 physical + 55 digital)
- EL: Added 100 entries (55 physical + 55 digital), fully reviewed for translation quality
- Total content: 220 entries (55 days × 2 streams × 2 languages)

**Theme coverage:**
- Days 1–7: Awareness (observation/counting)
- Days 8–21: First Wins (low-risk removals)
- Days 22–30: Physical Depth (closets/cabinets/hobbies)
- Days 31–45: Subscriptions & Maintenance
- Days 46–55: Systems Building (reset rituals, "enough" definition)

**Difficulty distribution:** ~45% easy (1) / ~45% medium (2) / ~10% hard (3) — no 3 consecutive hard entries

**Quality notes:** Fixed typos from original Days 1–5 (d1/d4/d5). All Greek entries reviewed for natural phrasing and grammar — zero foreign language artifacts.

**Next:** Days 56–105 (Phase 3: "Depth" — advanced minimalism challenges).

---

Cycle — Wave: DST Hardening & Cleanup
Summary
The timeline received seasonal-hardening and cleanup: all date walking is now calendar-day based (immune to daylight-saving transitions), window edges snap to true local midnights, and four edge bugs around the exclusive right boundary were fixed. Dead i18n strings from the removed month calendar and never-implemented Quick Log view were purged from both locales, the empty-profile experience was reduced to a single welcoming call-to-action box, and the changelog now reflects implementation reality.

Fixes
DST-safe day walking: leftTs/rightTs snap to real local midnights via dayTsFromKey(dayKey(...)); the grid, axis and bar-click walks use Date.setDate(+1) instead of += 86400000, eliminating double lines or hour-skew at DST transitions (late March / late October, GR).
Weekend band closure: the last Saturday in view now closes its band correctly (wpos + DAY_MS >= rightTs, width Math.round) — previously depended on accidental DST drift.
Excluded-edge leaks: day dots and the today marker no longer paint at 100% width on the first day outside the window (>= rightTs guards).
Range caption: shows the last visible day (rightTs - DAY_MS), not the first excluded one.
Bar clicks across DST: clicking a period bar in a fallback window resolves the calendar day via a walked Date, never raw millisecond arithmetic.
Removed
Dead strings: cal.prev, cal.next, cal.empty (orphaned by the month-calendar removal) and ql.title, ql.fullcal, ql.quick, ql.flowonly (Quick Log never landed) — both en and el.
Duplicate .tl-dot:hover{opacity:1} rule from the injected timeline CSS (superseded by the scale-up hover rule). (pending — one-line deletion offered)
UX
Empty profile: with zero periods and zero day records, the timeline renders ONLY the welcome box (icon, title, subtitle, CTA button). Head controls, range caption, axis, bars strip, dots lane, legend and reminder toggle are all suppressed until first data exists.
Corrections to earlier changelog claims
Day numbers render on Mondays (week boundaries, Monday-first convention), not "every 7th day".
Grid lines are 1px at opacity .06 (.14 major), not "3px / 12%".
Tooltips are native title attributes (browser-default delay), not a custom 500ms timer.
Untouched
Data model, merge engine, tombstones, predictions, Doctor Report, mood cross-analysis, sync slice, notification check, deep links — no changes.

---


Wave 2 — Radio v0.2 (Shell-hosted audio)
Files touched: radio/radio.js (v0.2), radio/radio.css, radio/index.html, apps.json, sw.js, translations.js, shell.js, style.css

What shipped
Radio (Radio Browser API, online-only browsing by country/genre) upgraded from iframe-local audio to a shell-hosted audio element. The host lives on the shell window (window.__orosRadioHost), created lazily by radio.js on first app open — same doctrine as orosAlarms. Playback survives app close and surfaces as a tray chip in the taskbar. The shell never creates a host, only reads it (radioTrayTick inside renderClock, 1s tick, DOM touched only on state change). No slice access from the shell side.

Architecture rules (permanent)
Host contract: window.__orosRadioHost.api = { play, toggle, stop, getState, setSleep, cancelSleep, subscribe }. getState() returns { current, paused, playing, flags{buffering,error}, sleepUntil }. The shell tray chip reads getState ONLY.
Audio living in the shell document means Media Session API works with hardware keys / lock screen even while the app is closed.
Deep link bridge (shell section 9i): the shell stores a RAW uuid string (never a JSON object) under sessionStorage key "oros-radio-open". The app consumes it one-shot via window.__orosRadioTakePending(), with a fallback to direct sessionStorage read. One format, one source of truth: always a raw string.
Tray chip click: inside Radio → back to desktop. Inside any other app → straight to Radio (no desktop hop). From desktop → open Radio. Always single click.
Sync: slice "radio" (STORAGE_KEY oros-radio-data), 5-arg registerSlice, R5-symmetric merge (union by stationuuid, LWW by mtime, lexicographic JSON tie-break, tombstones: delete wins ties, newer edit resurrects). Model RADIO v1 { ver, favorites[], deleted{} }.
Recents (oros-radio-recents): device-local, cap 20, NEVER synced. Swept by factory reset as an oros- prefixed key.
Cache (oros-radio-cache:{key}): 30-minute TTL, browsing data only, offline-honest (offline banner, never fabricated fallback data).
i18n: ALL app strings live in the inline STRINGS object (Bible Part VI) — the app never depends on shell translations.js. translations.js keeps ONLY shell-consumed keys: app.radio, category.sound.
Fixes applied in this wave
FIX-RX-1 (fatal): a corrupted line in the Media Session play handler (double identifier) killed the entire radio.js parse. Fixed.
FIX-RX-2 (FIX-W2-0 regression): Part 2 had ended up outside the IIFE (references to state/host/t from a closed scope). Parts merged into one continuous IIFE. Lesson recorded: multi-part deliveries are appended into one scope, never assembled as separate scopes.
FIX-RX-3: two functions named toggleFavorite (core with station arg, player-bar without) caused infinite recursion on the heart button (hoisting kept the second one). Core renamed to favoriteToggle.
FIX-RX-4: missing i18n keys view.countries/view.genres/view.favorites/view.recents (en+el) added to STRINGS.
FIX-RX-5: the synchronous empty-state check in renderMain ran before async fetches resolved → "No stations found" flash that never re-hid. Sync empty state now covers favorites/recents only; async views own their banner inside fetch callbacks, after data lands.
FIX-APP-JSON (blocker): trailing comma after the Radio entry made apps.json invalid JSON — NO app loaded (note D1: one typo in one file takes down the whole system). Fixed.
Search stale-response guard: autocomplete responses paint only if the input still holds the query the response belongs to.
Shell integration (patches 1–4)
ICONS.radio: broadcast tower SVG (menu).
renderClock(): calls radioTrayTick() — cheap 1s tick.
Section 9i: radioTrayTick (chip paint, zero-DOM when idle), __orosOpenRadio (deep link bridge), __orosRadioTakePending (one-shot take).
style.css: #rx-tray-chip styling (parallel to #wx-chip), data-state driven.
Propagation checklist (must-touch files on every Radio change)
apps.json (entry), sw.js (precache: radio/, radio/index.html, radio/radio.css, radio/radio.js), translations.js (app.radio, category.sound ONLY), shell.js (ICONS + tick + section 9i), style.css (#rx-tray-chip). Version stamping by the GitHub Action — never a manual bump.

Deferred — candidates for Wave 3 (recorded, not implemented)
RX-N1: favicon preloading via new Image() per card (redundant network requests, no SW coverage).
RX-N2: the isFavorite parameter in createStationCard shadows the isFavorite() function.
RX-N3: unused wasOffline in updateOnlineState.
RX-N4: player/sleep chips update via host subscription, tray chip via its own 1s tick — asymmetric but harmless polling.
RX-N5: no stop-playback control in the UI (pause only) — possible kill switch in the player bar.