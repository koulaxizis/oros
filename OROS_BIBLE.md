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
    engine §9e3 (notifications.js), files-disk slice §9f.
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
  Notifications| oros-notifs          | per-field LWW           | Wave 1A core done

  REFERENCE APP (canonical template): mood.js — every contract
  in Part V is extracted VERBATIM from it. Tie-breaker: "what
  does mood.js do?"

LOCALSTORAGE KEYS (synced): oros-lang, oros-theme, oros-skin,
  oros-wallpaper, oros-sync-interval, oros-autoexport,
  oros-weather, oros-alarms (shell slice), oros-notifs, all
  oros-*-data app keys.
DEVICE-LOCAL (never synced): oros-last-version, oros-wx-cache,
  oros-wx-last, oros-auto-snapshots, oros-fs-*, oros-cal-
  reminders-fired, oros-cal-pending, oros-*-open staging keys,
  all *-prefs/*-cache/*-seen keys, oros-sync-* engine keys.
IndexedDB: "oros-vault" (keys), "oros-fs" (handles), "oros-ofs"
  (OrosFS fallback — wiped via wipeOrosFS()).

FILE TREE: index.html, shell.js, notifications.js, sync.js,
  fs.js, style.css, translations.js, apps.json, sw.js,
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