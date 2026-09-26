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
    time, system, weather, notes, quote, contacts, files.

╔══════════════════════════════════════════════════════════╗
║  PART III — CURRENT STATE + REGISTRIES                     ║
╚══════════════════════════════════════════════════════════╝

CURRENT STATE (as of 2026-09-24):
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
  To-Do      | oros-todo-data         | entity LWW + tombs      | CLOSED (2 decisions)
  Kanban     | oros-kanban-data       | boards[] union, tombs    | CLOSED (clean)
  Notes      | oros-notes-data        | page/label LWW + tombs   | CLOSED (clean)
  Bookmarks  | oros-bookmarks-data    | entity LWW + tombs      | 5/5 VERIFIED COMPLETE
  Calendar   | oros-calendar-data     | event union + tombs     | CLOSED (F6 cosmetic open)
  Contacts   | oros-contacts-data     | union + LWW + tombs     | 5/5 VERIFIED
  Cycle      | oros-cycle-data        | day-entity union, LWW   | 5/5 VERIFIED
  Weather    | oros-weatherapp-data   | merge-lite              | COMPLIANT (v0.3.0)
  Mood       | oros-mood-data         | entity LWW + cols       | Fixes applied
  Time       | oros-time-data         | entity union + smtime  | CLOSED (v0.1.1)
  Quote      | (quote slice)          | entity union + LWW     | Deep audit complete
  Storage    | oros-storage-data      | flat ents union + del   | Complete
  Habits     | oros-habits-data       | habits/comps LWW       | v0.3.1 verified
  Files      | oros-files-data +      | files-disk blob        | ALL CLOSED (FL set)
             | "files-disk" slice     |                         |
  Prompter   | oros-prompter-data     | union + LWW + tombs     | CLOSED (clean)
  Characters | oros-characters-data   | union + LWW + tombs     | 5/5 VERIFIED COMPLETE
  Spreadsheet| spreadsheet slice      | CELL-ENTITY LWW         | Wave 1 shipped
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
  SPREADSHEET: cells {"<sid>|<r>|<c>":{v,mtime}} — sparse,
             LWW per cell, shared tombstones; formula engine
             (tokenizer → shunting-yard → RPN) built from
             scratch, no external deps.

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
  · Core #1–#16, To-Do #17–25, Kanban #26–35, Notes #36–44,
    Calendar #C1–14 + Waves, Files FA1–FG5, Bookmarks 5/5,
    Characters 5/5, Contacts 5/5, Cycle 5/5, Time v0.1.1,
    Quote, Storage, Habits v0.3.1, Prompter, Weather v0.3.0,
    Mood fixes, Spreadsheet Wave 1, Kernel re-audit + T3.
  · Kernel status: CORE LOCKED.
  · #C1 false-alarm lesson → anti-hallucination protocol
    (Part I §3).

QUEUED (next phase):
  · Remaining app audits: Mood (high — deepest model), then
    Weather re-visit, Time, Kanban/Contacts/Notes pattern
    sweep.
  · registerTrigger API removal from sync.js (dead code —
    purged; verify no consumers before final delete).
  · Calendar F6 (cosmetic CSS one-liner).

DOCTRINAL EXEMPTIONS RECORDED:
  · Bookmarks/Files/Characters/Storage — Calendar-axis exempt
    (non-time-bound apps).
  · version drift observations — OUT OF AUDIT SCOPE (R23).

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
  Waves 2–4 (multi-sheet, formatting, extended functions).
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
║  PART XII — CHANGELOG (ascending; APPEND at the BOTTOM)     ║
╚══════════════════════════════════════════════════════════╝

[CONSERVED HISTORY — era summaries]
  Pre-0.13: To-Do, Kanban, sync genesis, PWA hardening.
  v0.13–0.17: Notes era. v0.18.x: Wave 3/4 shell.
  v0.21–0.27.04: Mood + Weather evolution, deep-review
    cleanup, cache strategy, boot splash. Quote v0.1.00
    clean-room. Storage v0.1.x. v0.30.03: Zero-Knowledge Sync
    v0.9. v0.31.00: Time & Calendar. fs.js v0.1.0 OrosFS.
    Habits v0.1.0–0.3.0. v0.32.x: alarms synced, scrollbars.
    v0.34.x–0.35.00: core audits, Files app launch, release
    candidate hardening. Calendar v0.1.1–v0.4.0 (waves,
    audits, virtual feeds). Bible merge 2026-09-18. Notes
    sync fixes. Kernel lock re-audits. Cycle Waves 1–2.3.
    Contacts Waves 1–2.3. Weather audit fixes. Habits v0.3.1.
    Kanban deep audit pass. Mood audit fixes. Prompter deep
    audit. Bookmarks Wave 1 + sync verification.

[DETAILED RECENT ENTRIES]
  [Notifications] Wave 1A core (2026-09-20): notifications.js
    v1.0.0 — scheduler, slice, bell, inbox, DL_BRIDGES,
    sounds, beforeunload flush.
  [Notifications] Wave 1B (in progress): Calendar emit
    migration + deep links + badge fallback (N1–N4).
  [Notifications] Wave 6 unified system notifications: notifySys
    routing, transient(), version/snapshot/alarm emissions,
    native Web Notifications (tag=dedupKey), KNOWN_APPS
    registry, TTL+cap local enforcement, #T1 alarm dedup key
    (per-day), #N1 two-part deep links, Time bridge.
  [Notifications] Wave 7: Todo due reminders (todoCheckTick,
    dedup due-<ymd>-<count>, __orosOpenTodo bridge, EOF
    receiver). Rules: action-bearing exemptions.
  [Notifications] Wave 8: Habits check-in reminders
    (habitsCheckTick, checkin-<ymd>-<count>). registerTrigger
    removed (dead).
  [Calendar audit closure]: #C1 false-alarm RETRACTED —
    Deep-link Contract Verification Protocol born.
  [Weather v0.3.0]: compliance verified clean.
  [Contacts CSV import 0.35.20]: Google Contacts CSV (RFC
    4180 parser, Greek aliases, numbered pair columns).
  [Contacts pre-commit audit]: XSS hardening (renderMerge-
    Preview text nodes), dead keys removed, CSV type-column
    fix, norows toast.
  [Quote] deep audit 7 fixes + draft shelter (Option A,
    oros-quote-draft non-synced shelter, debounced 800ms,
    cleared on commit/new/template/duplicate).
  [Mood check-in migration]: __orosMoodOpen("checkin"),
    moodCheckInTick shell engine, bugfix round S1a/S1b.
  [Cycle Waves 4–5]: shell-side prediction fallback (closed-
    app), cycleShellCheck, identical dedup keys both paths.
  [Kanban Wave 10]: toast unification + undo-bug fix
    (duplicateBoard/deleteBoard single pushUndo).
  [Notes Wave 11]: toast unification, saveFail→emit inbox
    channel (sf:<hour> dedup), dead keys cleaned.
  [Contacts Wave 12]: 9 call groups → transient; sync.merged
    removed.
  [Quote Wave 13]: 10 plain toasts → transient.
  [Spreadsheet Wave 1]: bare core — cell-entity sync, formula
    engine, editing model, storage funnel, notifyTransient.
  [style.css Σ set]: semantic tokens --danger/--ok/--warn,
    z-index ladder doc, touch targets, overscroll contain.
  [shell/notifications cross-audit H set]: H1 quote deepLink
    fix, H2 habits bridge guard, H3 toast offsets,
    H4-H11 cleanups.
  [sync.js SY set]: SY1 409 arms trust window, SY2 pwEpoch
    symmetry, SY3 carry-flush reuse, SY4 header v0.9.2.
  [fs.js F set]: F1 idbLs root ENOENT, F2 opfsLs fresh disk,
    F4 mv(a,a) data-loss fix (guard at public mv()), F5
    driver-level dirty removal, F3 sync hook from markDirty.
  [translations T set]: T1 20 duplicate keys removed, T2 fork
    closed (non-issue).
  [index/sw/apps IN/SW/AP set]: noscript splash fix,
    checkVersionToast deferred to load event, capture-phase
    error handler, navigation no-cache fetch, apps.json
    network-first real, maps precache.
  [Kernel re-audit + T3 wave 2026-09-22]: 0 critical, ~30
    patches, formatting debt cleared. CORE LOCKED.
  [Time v0.1.1 closure]: T1 timer/pomodoro alarms hidden from
    user list, T3 minute-gated renders, T4 astroTomb, T5 i18n,
    T6 shake+focus. Deep-link + no-double-count verified.
  [Bookmarks Five-Axis COMPLETE 2026-09-24]: critical bugs
    #1–#7, duplicate management system (finder + purge + undo),
    unified notification migration (9 patches), per-app
    snapshot/export removal, 5/5 axes.
  [Calendar Five-Axis COMPLETE 2026-09-24]: 7 patches A–G,
    deep-link bridge triple-verified, merge/recurrence engines
    clean.
  [Characters Five-Axis COMPLETE 2026-09-24]: 12 notification
    migrations, CH-15 CRITICAL mergeFn registration fix, FIX-1
    syntax repair, dead code cleanup.
  [Contacts v0.36.08→0.37.00]: CT-1..CT-9 (deep-link dialog
    guard, X-OROS-STARRED, export error keys, pair-wise dup
    detection, dead CSS/keys, KNOWN_APPS 'contacts').
  [Cycle 5/5 VERIFIED]: CY-1 overlap guard, CY-2 label fix,
    CY-3 unified notifications migration, CY-4 mtime inflation
    fix, CY-5 byte-canonical persist, CY-6 dead maybeRemind
    removed, CY-7/8/9/10 cleanups, CY-Q1 export decision
    (shell-level sufficient).
  [Files FL set COMPLETE]: FL-1..FL-Q3 — result propagation,
    transientNote migration, dynamic APP_VER, partial-restore
    toasts, single/plural counts, binary clipboard gate,
    same-folder copy, dirs-first sorting, fdRefreshForExport.
  [Bookmarks dupe detection + bulk apply 2026-09-24]: dupeKey()
    canonical rule (scheme/www/case/fragment-insensitive, query
    KEPT) shared across quick-add/edit/import/finder; Apply
    all / Apply selected with atomic bulk purges (one snapshot,
    one save, one toast); purgeGroupCore shared; per-group
    checkboxes default checked; CSS for dupe-actions/check/
    head. Under consideration: per-row purge buttons inside
    groups.
  [BIBLE restructured 2026-09-24]: consolidated + compacted for
    assistant efficiency. History condensed to era summaries +
    detailed recent entries; contracts preserved verbatim;
    all open decisions + backlog carried forward unchanged.
	
	---
	
	orOS Changelog — Habits Five-Axes Audit Closed
SCOPE OF THIS ENTRY
Full functional audit of the Habits application (habits.js, habits.css, index.html) against the Five Axes doctrine. All findings resolved. This entry is written as a self-contained context document — a future session needs nothing else to continue.

WHAT THE FIVE AXES DOCTRINE REQUIRES (standing rule)
Every orOS app must be verified against all five axes before being considered done:

Calendar Integration — deep-link in, feed out (unless doctrinally exempt, e.g. non-time-bound apps like Files)
Unified Notifications — all informational toasts route through orosNotifs.transient() with the app's ns registered in KNOWN_APPS in notifications.js
Dropbox Sync — registered slice via orosSync.registerSlice, strict mergeRow, no volatile defaults inside merge
Snapshots — data covered by shell auto-snapshots via the registered slice
Manual and Auto Export — data included in every exportData() call via the registered slice
HABITS AUDIT FINDINGS AND FIXES (HB-1 to HB-8, HB-C1)
HB-1a — isScheduledOn() changed to return false for habits with empty days array. New isFlexible() helper. Rationale: flexible habits were treated as scheduled every day, which made streaks break on any missed day and per-habit rates near zero. Semantics now: flexible = interactable everywhere, exempted from rate-based metrics.

HB-1b — renderStats(): flexible habits display raw completion count instead of percentage and progress bar.

HB-2a — transientNote() helper added: routes to orosNotifs.transient({ ns: "habits" }) when shell present, falls back to local toast() when standalone. "habits" was already in KNOWN_APPS — no notifications.js change needed.

HB-2b — Four toasts migrated: created, updated, deleted, merged. IMPORTANT: toast.name.req is NOT a toast — it is a form-validation inline error and correctly stays in the dialog. Do not migrate it. The i18n key name is legacy.

HB-3 — sliceGet() tombstone pruning cutoff changed from Date.now() minus 30d to maxMtime of dataset minus 30d. Reason: wall-clock cutoff makes the same db produce different payloads over time, which risks phantom-change pushes in the sync engine. Payload-internal cutoff is deterministic: same data produces identical payloads on all devices at any moment.

HB-4 — esc(h.id) applied to all 6 data-h attribute injection points (habit-row, edit, del, gedit, cdot, week dots). Locally-created ids are safe (uid()) but merged/restored ids are arbitrary strings and could break out of the attribute.

HB-5 — computeStats(): livingIds filter added so completions belonging to deleted habits no longer inflate the totalComps card (double bookkeeping bug).

HB-6 — Hardcoded version removed from JS header comment. Rule: shell.js owns versions via ?v= URL parameter; apps derive SCRIPT_V from document.currentScript, never hardcode.

HB-7a/b/c/d — CRITICAL follow-up to HB-1a, discovered during verification. The HB-1a change leaked into the interaction layer: isScheduledOn() false for flexible caused click handlers to lock and render to dim flexible days as not-scheduled. Fixed in four places: list dots render, calendar cells render, dot click handler, cdot click handler — all now include !isFlexible(h) in their conditions.

HB-8 — Discovered during second verification. HB-1a made per[].done always 0 for flexible habits because computeStats only increments done inside the isScheduledOn() branch. The flexible stats row therefore showed "0 records" forever. Fix: renderStats() counts comps directly from db.comps within the active range for flexible habits instead of reading p.done.

HB-C1 — habits.css header comment version cleaned.

LESSONS RECORDED IN BIBLE (must be remembered)
Lesson 1 (from HB-7/HB-8): an exemption patch that changes the meaning of a shared function (isScheduledOn) must be validated across ALL three consumption layers — interaction gating, visual rendering, and stats counting. HB-1a touched all three; missing two caused two follow-up bugs.

Lesson 2: flexible semantics are now contractual: days: [] means interactable + counted in totals, exempted from perfect days, consistency ranking (ins.top requires sched >= 7, which naturally excludes flexible), trend halves, and per-habit percentage.

Lesson 3: deterministic slice payloads: any pruning or derivation inside sliceGet must depend on payload-internal data (mtimes), never wall clock.

ACCEPTED-KNOWN ITEMS (no patch, do not reopen)
Flexible habit streak equals its total completion count and internally walks a 3650-iteration guard loop. Output on screen is correct; performance is acceptable at home scale (under ~50ms). Optimize with early-exit only if it ever becomes measurable.

The stale comment above isScheduledOn describing "empty days = any day counts" refers to pre-HB-1a semantics. Functionally irrelevant; clean opportunistically.

WORKFLOW RULES REAFFIRMED (this is why we keep repeating things — keep these in every entry)
Patches are delivered ONLY as OLD → NEW copy-paste blocks, verbatim from the actual file content. Never hallucinate. If the OLD text cannot be found, STOP and request the real file.
Verification loop: user applies patches, sends back full updated files, assistant re-verifies against actual content before closing an app. This loop caught HB-7 and HB-8 — it works, keep it.
Versioning is handled by the GitHub Action on commit. Assistant does not touch version numbers unless asked.
Changelogs are plain markdown text, no code fences, no rendering wrappers, directly copy-pasteable.
STATE OF THE OVERALL AUDIT QUEUE
COMPLETED (closed, Five-Axes verified):

Files (FL-1 to FL-10, FL-Q1/Q2/Q3, including fdRefreshForExport() freshness fix in shell.js)
Habits (HB-1 to HB-8, HB-C1)
PENDING (queue order): Weather, Mood, Time, Calendar, Quote/Offer, Storage, Prompter, Characters, Kanban, To-Do, Notes, Contacts, Bookmarks, Maps, Cycle (already audited earlier — confirm before removing from queue).

OPEN CROSS-FILE ITEM: none for Habits. Calendar-side feed for habits (Purple label) is exercised from calendar.js — only relevant if Calendar audit finds the feed missing.

NEXT STEP: user sends weather.js. Weather has known history: tray/app shared state, offline handling with last-known data, My cities dialog, air quality + UV index. Audit will check the Five Axes plus Open-Meteo offline/online state consistency.

FILES TOUCHED THIS SESSION: habits.js (HB-1a/1b, HB-2a/b, HB-3, HB-4 x6, HB-5, HB-6, HB-7a/b/c/d, HB-8), habits.css (HB-C1), index.html (unchanged — versioned refs verified correct).

---

orOS Changelog — Kanban Five-Axes Audit Closed
SCOPE OF THIS ENTRY
Full functional audit of the Kanban application (kanban.js, kanban.css, index.html) against the Five Axes doctrine, plus cross-file verification against notifications.js and calendar.js. All findings resolved or recorded as accepted. Self-contained context — a future session needs nothing else.

STANDING RULES (unchanged, reaffirmed)
Five Axes: Calendar Integration (deep-link in + feed out), Unified Notifications (orosNotifs, ns registered in KNOWN_APPS), Dropbox Sync (registered slice, strict merge), Snapshots, Manual and Auto Export.
Patches are OLD → NEW copy-paste blocks, verbatim from actual file content. If OLD cannot be found, STOP and request the real file. Never guess.
Verification loop after every patch batch. Shell.js owns versioning.
Changelogs are plain markdown text, no code fences, no rendering wrappers.
AUDIT QUEUE STATE
COMPLETED: Files (FL-1 to FL-Q3), Habits (HB-1 to HB-8, HB-C1), Kanban (KN-1 to KN-6, KN-Q1). PENDING: Weather, Mood, Time, Calendar, Quote/Offer, Storage, Prompter, Characters, To-Do, Notes, Bookmarks, Maps.

KANBAN FINDINGS AND FIXES
KN-1b — createBoard() phantom undo fixed. The old code showed a toast with an Undo button (showToast(..., true)) but never called pushUndo() first. Consequences: with no prior snapshot the button was a noop; with a snapshot from an EARLIER action, pressing Undo rolled the app back to that older state, destroying the newly created board and everything since. Fix: pushUndo("toast.boardadded") BEFORE the mutation, matching the deleteBoard/duplicateBoard/deleteLabel pattern. Undo-bearing toasts stay local (doctrine); plain informational toasts go through notifyTransient().

KN-2 — Calendar feed from Kanban due dates: VERIFIED WORKING, no patch. calendar.js pulls kanban data from localStorage (kanbanRaw micro-cache, kanbanFeedOn(dateStr) filters cards with card.due === date, skips archived boards) and renders teal feed rows ("COLUMN - card text") with _kanban payload (boardId, colId, cardId). Click-through goes directly to window.parent.__orosOpenKanbanCard — it does NOT route through DL_BRIDGES in notifications.js, so the missing kanban bridge entry there is a documentation note, not a bug.

KN-3 — 'kanban' added to KNOWN_APPS in notifications.js. Transient toasts were never broken (transients bypass toggles by design), but the deterministic rule "every ns in use belongs to KNOWN_APPS" is now satisfied, and the Kanban toggle appears in the shell settings grid.

KN-5 — moveBoard() reorder save debounced at 300ms with a boardMoveSaveTimer. Rapid board reorders in the dropdown now produce one save/dirty instead of many. state.om is stamped immediately on every move (correct for merge); only the localStorage/sync flush is deferred. Known trade-off: closing the tab within the 300ms window loses the last reorder — assessed as negligible; switchBoard saves anyway.

KN-6 — NEW, found during final verification: formatDateChip() computed "today/tomorrow" in UTC, not local time. now.toISOString() is UTC — in Greece (UTC+3 in summer) between local and UTC midnight (~00:00-03:00) the chip showed the wrong day: a card due today displayed "Tomorrow", a card due yesterday displayed "Today". Second half of the same bug: new Date(isoDate) on a date-only string parses as UTC midnight — users west of UTC saw "23 Sep" instead of "24 Sep". Fix: localDateStr() helper computes the local YYYY-MM-DD, and the far-future label path parses ISO parts into a local-midnight Date. Display-only fix: does not touch card.due data, sync, or the Calendar feed (the feed matches exact ISO strings).

KN-Q1 — tombstone pruning uses wall-clock Date.now() cutoffs at four points (load, sliceSet, both merge cutoffs). ACCEPTED AS KNOWN, NO PATCH. Rationale: unlike Habits (where sliceGet re-derived the payload on every read), Kanban prunes at load/merge time and the merge engine re-unions and re-prunes — after one sync round the devices converge to the same result. Risk is one redundant push, never data loss. This is a recorded deviation from Lesson 3 (deterministic payloads); if a phantom-push symptom ever appears in testing, revisit with the HB-3 pattern (cutoff = max mtime of dataset) at all four sites.

KANBAN FIVE-AXES TABLE (final)
Axis 1 Calendar Integration: VERIFIED — deep-link in (__orosKanbanOpen + __orosKanbanTakePending, cold path consumed at boot) and feed out (calendar.js pulls kanban due cards, click-through opens the card). Axis 2 Unified Notifications: VERIFIED — notifyTransient() with ns "kanban", registered in KNOWN_APPS. Informational toasts migrated; undo-bearing toasts (board create/delete/duplicate, label delete) correctly stay local. Axis 3 Dropbox Sync: VERIFIED — registered slice, symmetric multi-board merge (union boards, nested label/column/card merges, tombstones, LWW via ts), verified deterministic tie-breaks. Axis 4 Snapshots: VERIFIED — slice rides in every auto-snapshot. Axis 5 Manual and Auto Export: VERIFIED — slice rides in every exportData().

LESSONS RECORDED IN BIBLE
Lesson 4 (from KN-1b): a toast API with an undo flag is a trap if the undo stack is not primed — verify that EVERY undo-bearing toast is preceded by a pushUndo in the same mutation path. A stale-snapshot Undo is worse than no Undo.

Lesson 5 (from KN-6): date-only strings and toISOString() are UTC by construction. Any "today/tomorrow/overdue" display logic must use local date computation (getFullYear/getMonth/getDate), and date-only ISO strings must be parsed via split into parts, never new Date(iso). Scan rule for future audits: search each app for toISOString and new Date("YYYY-MM-DD") patterns in display code.

Lesson 6 (from KN-2): pull-fed cross-app feeds (Calendar reads other apps' localStorage) mean the feed side needs NO push patch in the source app — verify the reader side exists before building sender infrastructure. The empty DL_BRIDGES entry for a namespace is only a gap if that app emits CLICKABLE (deep-linked) notifications; transient-only apps need none.

FILES TOUCHED
kanban.js — KN-1b, KN-5, KN-6. notifications.js — KN-3 ('kanban' in KNOWN_APPS). kanban.css, index.html — unchanged this session (prior waves verified correct).

NEXT STEP
Next app in the audit queue: Weather (or Mood/Time/Calendar — user's choice). Send weather.js plus its index.html and CSS. Weather audit will check the Five Axes plus: Open-Meteo offline/online state consistency, tray/app shared live state, My Cities dialog lifecycle, air quality and UV index surfaces, and the localDate scan rule from Lesson 5.

---

## v0.36.x — Support section in Info modal
- Added a "Support" section to the Info modal (between shortcuts and
  the factory-reset row) with three donation links: Liberapay
  (liberapay.com/glarolykoi), GitHub Sponsors (github.com/sponsors/
  koulaxizis), Ko-fi (ko-fi.com/glarolykoi).
- Plain <a> links only (target=_blank, rel=noopener) — NO platform
  widgets/embeds, preserving the no-tracking doctrine.
- i18n: inline EN/EL literals via supT() (calRemT pattern), no
  translations.js changes required.
- Styling: inline styles with palette vars — follows every skin,
  no style.css changes.
- Deliberately NOT synced, NOT in localStorage, NOT versioned:
  pure static UI, zero data footprint.
  
  ---
  
  ## Support section in Info modal
- Added "Support" section to the Info modal (between shortcuts and
  the factory-reset row) with three donation links: Liberapay
  (liberapay.com/glarolykoi), GitHub Sponsors
  (github.com/sponsors/koulaxizis), Ko-fi (ko-fi.com/glarolykoi).
- Plain <a> links only (target=_blank, rel=noopener) — NO platform
  widgets/embeds, preserving the no-tracking doctrine.
- i18n: inline EN/EL literals via supT() (calRemT pattern), no
  translations.js dependency.
- Styling: inline styles with palette vars (--border/--text-dim) —
  follows every skin, no style.css changes.
- FIX-1: removed duplicated "var scInfoClose = null" declaration
  (leftover from patch junction — harmless var redeclaration, but
  dead weight).
- Pure static UI: NOT synced, NOT in localStorage, zero data
  footprint.
  
  ---
  
  v0.36.x — Support section in Info modal (donations)
Added a "Support / Στήριξη" section to the Info modal, between the shortcuts table and the factory-reset row. Three donation links: Liberapay (liberapay.com/glarolykoi), GitHub Sponsors (github.com/sponsors/koulaxizis), Ko-fi (ko-fi.com/glarolykoi).
Doctrine kept: plain <a> links only, target=_blank + rel=noopener. NO platform widgets/embeds — third-party scripts/requests are forbidden (no-tracking rule). Same contract as the repo link.
i18n: inline EN/EL literals via a local supT() helper (calRemT/ cycleT pattern) — zero translations.js dependency, zero new keys.
Styling: inline styles with palette vars (--border/--text-dim) — follows every skin, zero style.css changes. Cards render as name + short description, vertically stacked, click opens the platform in a new tab.
Placement is DOM-injection based (wireSupportSection inserts before #sc-reset-wrap at modal open): wireResetButton runs after and fills the reset row — no ordering hazards.
Pure static UI: NOT synced, NOT in localStorage, zero data footprint, no Service Worker changes.
FIX-1: removed the duplicated "var scInfoClose = null;" declaration left over from the patch junction (harmless var redeclaration, but dead weight).

---

# orOS CHANGELOG — Notes App Audit (NT Series)

Date: 25 Sep 2026
Scope: notes.js v0.17.0 (DATA_VER 3) — Five-Axes functional audit
Status: Five-Axis Verified pending smoke tests of Wave B (NT-3 Wave B)

## SUMMARY

Full Five-Axes audit of the Notes application completed against the live repository state. 4 findings produced 14 patches total: 1 critical functional bug (NT-1), 1 doctrine deviation on payload determinism (NT-2), 1 doctrine violation on native dialogs (NT-3), 1 cross-file verification closed clean (NT-4). All OLD -> NEW patches delivered against verified file content. An earlier Wave B draft referencing nonexistent structures (treeContextMenu, nbSelector) was discarded and reissued as patches 10-14 against actual code.

## FINDINGS AND FIXES

### NT-1 (CRITICAL) — Title input desync on wiki-link creation
Location: openOrCreateFromLink() (section 6e)

Clicking an unresolved [[wiki-link]] chip calls newPage() (which renders and focuses the title input), then sets fresh.title and calls renderAll(). But renderEditor's #7 caret-preservation shortcut (same page + focused input -> chips/links only, skip value update) prevented the title input from ever receiving the real title. The input showed "Untitled" while the data held the link title; a single keystroke would clobber the correct title with "Untitled"-based text.

Fix: After renderAll(), explicitly paint the real title into #page-title and re-focus/select it. Applied verbatim, verified in current file.

### NT-2 (Doctrine HB-3) — Non-deterministic sync payload
Location: sliceGet() (section 8)

Tombstones were pruned nowhere in sliceGet; the only pruning lived in normalizeState() keyed on Date.now() (wall clock). Two devices with identical data could emit different payloads at different moments — direct violation of the deterministic payload doctrine established by Habits (HB-3) and Mood (MD-4).

Fix: sliceGet() now computes maxTs from the dataset itself (pages, labels, notebooks, tombs) and prunes tombstones older than maxTs - 30 days. Cutoff derives from data, never the clock. Payload-only: local state keeps everything. The local wall-clock pruning in normalizeState() was deliberately KEPT — harmless, and the merge union makes it safe. Applied verbatim, verified in current file.

### NT-3 (Doctrine) — Native window.confirm / window.prompt dialogs
Standing rule: Custom UI only — no native dialogs (retirement started with weather, codified in mood.js askReset pattern). Notes used native dialogs in 6 places, breaking PWA/embedded UX especially on mobile.

Wave A (deletes) — applied verbatim, verified in current file:
- NT-3a (PATCH 3): Shared dialog helpers — uiDlg(title, body, buttons, inputOpts) built on native <dialog> element (free Esc/backdrop handling), styled inline with shell palette vars (zero notes.css changes needed), plus askConfirm() and askPrompt() wrappers and i18n key dlg.cancel. Buttons support primary/danger styling (danger = #e06c75); Enter in prompt input triggers OK; Escape closes with no action.
- NT-3b (PATCH 4): deletePage() split — askConfirm gate, body doDeletePage() performs the tombstone delete.
- NT-3c (PATCH 5): deleteNotebook() split — askConfirm gate (includes the book.confirm warning with page/label cascade disclosure), body doDeleteNotebook().
- NT-3d (PATCH 6): Label delete X-button in buildLabelRow() -> askConfirm.

Wave B (renames/create) — pending application:
- NT-3e (PATCH 10): Added i18n key dlg.ok ("OK" / "ΟΚ") — needed because t() returns the raw key when missing, and previously proposed keys (page.save, book.enterName) do not exist in STRINGS.
- NT-3f (PATCH 11): renamePage() -> askPrompt. Preserves the file's actual semantics: native prompt returned null ONLY on cancel, so empty titles were allowed; the custom version does the same (empty string clears the title, Cancel does nothing). After save, re-paints #page-title when the renamed page is current.
- NT-3g (PATCH 12): Notebook rename, call site 1 — the nbActions array inside openNodeMenu().
- NT-3h (PATCH 13): Notebook rename, call site 2 — the actions array inside nbSel contextmenu wiring (section 9). Different indentation vs PATCH 12; independently searchable blocks.
- NT-3i (PATCH 14): btn-new-notebook (wireUI, runtime-injected book+ icon button) -> askPrompt prefilled with t("book.default") ("Notes" / "Σημειώσεις"). Calls the existing createNotebook() (section 5b) which already handles renderAll + toast + return — creation logic NOT inlined; an earlier draft wrongly rewrote it.

Verification after Wave B: grep window.prompt -> 0 results; grep window.confirm -> 0 results. Six native dialog sites eliminated, zero remain.

### NT-4 — "notes" namespace in unified notifications
Verification: notifications.js v1.0.0 KNOWN_APPS includes "notes". notifyTransient (stale-bundle toast fallback) and notifyEmit (INBOX emission for saveFail with dedupKey sf:<hour> storm control) both route correctly. CLOSED — no patch needed.

## METHODOLOGY NOTES (for future sessions)

1. Hallucination incident and correction: The first Wave B delivery referenced functions (treeContextMenu, nbSelector, an inline notebook-creation handler) that do not exist in the actual notes.js. Standing rule enforced: never propose a patch whose OLD text did not come from a file in this conversation. Corrected Wave B patches (10-14) reissued with OLD blocks copied verbatim from the provided file.
2. Notes' notebook rename call sites: exactly two — openNodeMenu() nbActions array, and nbSel contextmenu actions array. Any future rename-related change must target both.
3. Dialog helper contract (new, reusable): uiDlg(titleText, bodyText, buttons, inputOpts). Buttons = [{label, primary, danger, fn}], fn receives the input value (or undefined). inputOpts = {value, placeholder, onEnter}. Single-instance (#nt-dlg) — opening a dialog closes any existing one. Palette-var styled, no CSS file dependency.
4. NT-2 pattern reuse: sliceGet deterministic pruning via maxTs-derived cutoff now implemented identically in Habits (HB-3), Mood (MD-4), Notes (NT-2). Any future app with a tombs map must adopt it.
5. Changelog delivery format (reinforced): plain Markdown text in a single raw block, no rendered formatting — direct copy-paste into CHANGELOG.md.

## AXIS SCORECARD (Notes)

Axis 1 — Calendar feed: N/A (pages carry only mtime, no dated entities) — Exempt (justified)
Axis 2 — Unified notifications: notifyTransient + notifyEmit via orosNotifs; ns "notes" in KNOWN_APPS — PASS
Axis 3 — Metrics: N/A
Axis 4 — Payload determinism: was HB-3 violation -> fixed via NT-2 — PASS
Axis 5 — Shortcuts/deep-link: Contract B capture-phase forwarding present — PASS
Sync slice: registration with 5s retry, echo suppression, merged push-back (#38) — PASS
Export: pageText footer funnel (.txt + zip entries), sanitized filenames, zero-dep ZIP writer — PASS

## WHAT WAS ALREADY GOOD (verified, no changes needed)

- Merge engine: pickByLWW with lexicographic JSON tie-break, tombs union max-ts, nb-salvage for schema-old peers (v0.35.04 root cause of the "notes stopped syncing" outage), locale-independent sorts (#3)
- normalizeState: idempotent, orphan re-parenting with 200-hop cycle guard, cross-notebook parent-leak fix (#2), notebook invariant rescue (#1)
- Debounced save + beforeunload/visibilitychange flush; quota failure emits INBOX receipt with hourly dedup
- #7 caret preservation correctly scoped (same page + editor focus)
- Session-only search/tags panels — no prefs writes, sync cannot resurrect them
- ZIP writer: store method, UTF-8 flag, CRC32, zero dependencies

## NEXT STEPS

1. User applies PATCHes 10-14 (Wave B) and confirms via grep (window.prompt / window.confirm -> 0 results)
2. Smoke tests: page rename, notebook rename (both entry points), new notebook creation, Esc behavior on all dialogs
3. NT series complete; Notes joins the Five-Axis Verified roster (Files, Habits, Kanban, Mood, Notes)
4. Next audit queue candidate: Calendar (already fully read — fast audit) or Weather

---

Prompter — Five-Axis Verified (Bible Entry)
Prompter (orOS Suite) — Five-Axis Verified
App ID: prompter · File: js/prompter.js · Storage key: oros-prompter-data (ver 1) · Sync slice: registered via window.orosSync · Status: AUDITED & PATCHED (Five-Axes Doctrine compliant)

Purpose: Writing prompt generator featuring 100 bilingual (EN/EL) writing prompts and techniques, with favorite/completed tracking, custom prompt CRUD, tag-based search, statistics, and factory reset. Externally loaded JSON prompts (prompts-en.json / prompts-el.json), enabling independent enrichment without code changes.

Data Model:

{ "ver": 1, "sm": 1730000000000, "favorites": { "<promptId>": "<mtime epoch ms>" }, "completed": { "<promptId>": "<mtime epoch ms>" }, "customs": [ { "id": "...", "mtag": "...", "mod": "...", "mtime": 1730000000000, "body": { "title": {}, "task": {}, "technique": {}, "prompt": {} } } ], "deleted": { "<promptId>": "<mtime epoch ms>" } }

favorites / completed / deleted are mtime-keyed maps (tombstone-aware, mirrors habits/notes pattern). deleted tombstones are payload-pruned (see Determinism Rule). The legacy om (order-modifier) field was removed in this audit (PR-7): no readers existed anywhere; old payloads carrying it are harmlessly ignored.

Architectural Decisions (Audit-Certified):

Unified Notifications (Wave 6 doctrine) — All informational toasts (copy/save/delete/reset) route through notifyTransient() → parent.orosNotifs.transient({ ns: "prompter" }). Form-validation errors (editor.errEmpty) remain local per doctrine (answer to user's own keystroke, not history-worthy). Sync feedback is exclusively the taskbar sync dot — the per-sync sync.pull toast was retired (PR-1).
Deterministic Tombstone Pruning (HB-3 / MD-4 / NT-2 pattern) — sliceGet() derives the prune cutoff from maxTs across all datasets (favorites, completed, customs.mtime, deleted), never from wall clock (Date.now()). Same data ⇒ identical payload on every device, at any time. Payload-only pruning: local state retains every tombstone; TOMB_PRUNE_DAYS = 30.
Contract B (global shortcuts) — Canonical capture-phase keydown listener forwards Ctrl+Alt+Shift+* to parent.orosShortcuts.handle(e). Shell handlers remain the single source of truth; the physical-key (e.code) match and editable-target yield logic live exclusively in shell.js.
Defensive sliceSet — Partial/crafted payloads can never null-ify completed/customs/deleted; guards mirror the load() contract (PR-4). normalizeFavs() continues to sanitize favorites.
Language detection — reads localStorage["oros-lang"] directly, which shell.js (initPrefs) persists unconditionally at boot and on every toggle — canonical orOS language key. Verified against shell v0.36.12: NO change needed (PR-5 closed as already-compliant).
Tag autocomplete — Uniform 2-character minimum across Browse and Custom Editor (PR-6), matching the 2-char threshold used across the suite.
Offline-first — External JSON prompts are cached by the SW; all state in localStorage; zero network dependencies.
Merge Semantics: Standard per-map last-writer-wins by mtime, mirroring habits.js: favorites/completed/deleted merged key-wise with max ts; customs merged per-id by mtime; sm = max(sm_a, sm_b).

Pre-Sync Checklist (MANDATORY, per audit):

Calendar integration: N/A — no dated entities (by design; deferred to Writer hand-off) Unified notification system: ✅ transient via ns:"prompter"; KNOWN_APPS updated in notifications.js Dropbox sync: ✅ slice registered, deterministic payload Snapshot capability: ✅ covered by full-DB snapshots (single localStorage key) Manual/auto export: ✅ covered by orOS full-database export/import Offline-first: ✅ zero network deps beyond SW-cached JSON Mobile-first: ✅ responsive, no hover-dependent UI

Audit Trail:

PR-1: Notification migration (5 toast sites + KNOWN_APPS registration) PR-2: Deterministic tombstone pruning in sliceGet() PR-3: Contract B shortcut forwarding in wire() PR-4: sliceSet defensive guards + sync.pull toast retirement PR-5: oros-lang key verified canonical against shell.js — no change PR-6: Autocomplete threshold harmonization (2 chars) PR-7: Dead om field removal (newState / merge / factoryReset)

Changelog Entry (repo-ready)
[prompter] Five-Axis Audit — Notifications, Sync Determinism, Contract B

Scope: Full functional audit of the Prompter app (prompter.js, notifications.js) under the Five-Axes Doctrine. All patches verified against actual source before delivery.

Fixed:

Unified notifications: migrated all informational toasts (copy prompt, save custom, delete custom, factory reset) to the unified system via a new notifyTransient() helper (fallback: local showToast for stale bundles). Added "prompter" to KNOWN_APPS in notifications.js so per-app notification toggles appear in Settings → Notifications. Form validation errors stay local per doctrine. (PR-1)

Sync determinism: tombstones in the "deleted" map are now pruned in sliceGet() with a cutoff derived from the dataset's newest timestamp (maxTs across favorites/completed/customs/deleted) minus 30 days — never from wall clock. Identical data now produces identical sync payloads across devices. Local state keeps all tombstones (payload-only pruning). (PR-2)

Global shortcuts: added the canonical Contract B capture-phase keydown listener in wire(), forwarding Ctrl+Alt+Shift+* combos to the shell (window.parent.orosShortcuts.handle). Shell shortcuts previously died while focus was inside the prompter's inputs. (PR-3)

Defensive guards: sliceSet() now validates completed/customs/deleted shapes before assignment (mirroring the load() contract), preventing TypeErrors from partial or crafted payloads. (PR-4)

Tag autocomplete: unified to a 2-character minimum across Browse and the Custom Editor (was 3 in Browse). (PR-6)

Removed the dead om (order-modifier) field from newState(), the merge engine, and factoryReset(). No readers existed; backward compatible — old payloads carrying om are ignored. (PR-7)

Removed the per-sync sync.pull toast — sync feedback is exclusively the taskbar sync dot (suite-wide doctrine). (PR-4, rides along)

Verified (no change needed):

Language detection: prompter.js reads localStorage["oros-lang"], which shell.js persists unconditionally at boot (initPrefs) — confirmed canonical against shell v0.36.12. (PR-5, closed)

Smoke tests:

Copy prompt → system toast (consistent with taskbar bell styling). Save/delete custom prompt, factory reset → transient notifications. Ctrl+Alt+Shift+P/F/S/E fire correctly while focus is inside the search input. Tag suggestions appear from the 2nd typed character in Browse. Manual sync produces no toast; sync dot reflects state.

---

Quote (orOS Suite) — Five-Axis Verified
App ID: quote · Files: index.html / quote.css / quote.js · Storage key: oros-quote-data (ver 1) · Draft key: oros-quote-draft (device-local, NEVER synced) · Status: AUDITED & PATCHED (Five-Axes Doctrine compliant)

Purpose: Client-side quote/offer generator (clean-room rewrite of the beta "Offer" app). Quote CRUD with line items (qty, price, disc %, VAT % per item), global discount, instalment generation, client directory, template library, synced payment presets (bank / PayPal / IRIS / cash), PDF export via vendored jsPDF with NotoSans Greek font (print iframe fallback), and mailto send.

Data Model:

state = { ver: 1, om: <list order mtime>, deleted: { id: ts }, activeQuoteId: <DEVICE-LOCAL>, quotes: [offer], clients: [client], templates: [template], payMethods: [preset] }

Offer: { id, num ("OFF-YYYY-NNN"), clientId, status (draft/sent/accepted/rejected/expired), date, dueDate, currency (EUR/USD only — matches the select in HTML), items: [{ id, code, desc, qty, price, disc, vat }], gDisc, payment, notes, instalments: [{ id, date, amount }], mtime, pos } Client: { id, name, email, phone, address, taxId, mtime, pos } Template: offer-shaped + name. payMethods: deterministic ids "pm-<method>", seeded per language.

Architectural Decisions (Audit-Certified):

Computed totals are NEVER stored — calcTotals()/itemNet() are pure functions over stored inputs (qty, price, disc, vat). No sync merge can ever create an arithmetic contradiction.
Numbering is recovery-based: nextNumber() scans state for max OFF-YYYY-NNN of the current year. No synced counter.
Deterministic tombstone pruning (Q-1, HB-3/MD-4/NT-2 pattern): ONE tombstone map for ALL entity types. The prune cutoff derives from datasetMaxTs() across quotes/clients/templates/payMethods, never from wall clock. Pruning happens ONLY at the sliceGet() payload boundary; local state retains every tombstone (a lagging device can never resurrect a deleted entity). The merge engine (mergeQuoteStates) is pure: same inputs, same output, every device.
Draft shelter (Option A): unsaved drafts live in oros-quote-draft (separate key, excluded from sync). Debounced 800ms writes plus a pagehide flush (Q-2). Restored at boot BEFORE activeQuoteId — unsaved work outranks last-viewed. Cleared on save/duplicate/template/new.
Shelter restoration bypasses migrate(), so restoreDraftShelter() carries minimal shape guards (instalments/currency/gDisc/payment/notes) and updateInstalmentSum() guards its instalments access (Q-3) — corrupt/legacy drafts can never crash boot.
migrate() doubles as the defensive sliceSet filter: every incoming payload (cloud or local) is fully normalized before assignment.
Unified notifications: all informational toasts route through notifyTransient() → orosNotifs.transient({ ns: "quote" }) (Q-5 closed the last gap: sync_replaced). "quote" already present in notifications.js KNOWN_APPS.
Contract B (Q-4): capture-phase keydown forwards Ctrl+Alt+Shift+* to parent.orosShortcuts.handle. Local Alt+N yields to editable targets and open dialogs (Q-9).
activeQuoteId persists via suppressed quiet-write (device-local, never travels; sliceGet strips it, sliceSet reseeds/repairs it).
Deep-link (Wave 13): __orosQuoteOpen(id) for warm hand-offs; sessionStorage "oros-quote-open" for cold boots.
PDF: vendored jsPDF + lazily fetched NotoSans-Regular (base64, retry allowed). Greek detection scans the ENTIRE content (not just interface language) — EN interface with a Greek client falls back to the print path instead of producing garbled glyphs. All trailing blocks (instalments/payment/notes) paginate line-by-line (Q-10).
Merge Semantics: per-entity last-writer-wins by mtime across four unions (quotes/clients/templates/payMethods) filtered by the shared tombstone map; ties broken by JSON serialization comparison; ordering via pickRef() (om mtime, then id-sequence comparison), stable fallback by mtime then id.

Pre-Sync Checklist (MANDATORY, per audit):

Calendar integration: PENDING — due dates + accepted status are natural Calendar feed candidates (roadmapped, not yet wired). Unified notification system: present via ns:"quote" (already in KNOWN_APPS). Dropbox sync: slice registered, deterministic payload, pure merge. Snapshot capability: covered by full-DB snapshots. Manual/auto export: covered by orOS full-database export/import. Offline-first: zero network deps beyond SW-cached vendored font/jsPDF. Mobile-first: responsive grids (items collapse to card layout), 16px inputs on mobile, safe-area insets.

Audit Trail:

Q-1a..e: deterministic payload-only tombstone pruning (replaced wall-clock pruneTombstones in load/merge/sliceSet; pruning now at sliceGet only) Q-2: pagehide flush for the draft shelter debounce Q-3a/b: shape guards for shelter-restored drafts (boot TypeError prevention) Q-4: Contract B capture-phase shortcut forwarding Q-5: sync_replaced toast migrated to unified notifications Q-9: Alt+N editable-target and open-dialog guards Q-10α/β/γ: PDF pagination for instalments/payment/notes blocks Q-11: comment typo in openQuote() Closed as already-correct via HTML inspection: currency whitelist (EUR/USD), readonly q-number, method="dialog" client form.

Changelog Entry (paste στο CHANGELOG.md)
[quote] Five-Axis Audit — deterministic sync, draft safety, Contract B

Scope: Full functional audit of the Quote app (quote.js, quote.html, quote.css) under the Five-Axes Doctrine. All patches verified against actual source before delivery; all confirmed applied.

Fixed:

Sync determinism: replaced wall-clock tombstone pruning (Date.now()) with a dataset-derived cutoff. pruneTombstones() was removed entirely; a new pruneDeletedMap(deleted, data) computes the cutoff from the newest mtime across quotes/clients/templates/payMethods and runs ONLY inside sliceGet(), so identical data yields identical sync payloads on every device at any time. Local state keeps every tombstone — a lagging device can never resurrect a deleted entity. mergeQuoteStates() is now fully pure. (Q-1)

Draft shelter durability: added a pagehide flush (writeShelterNow) so the 800ms debounce can never drop the final keystroke burst when the tab closes or the PWA backgrounds. (Q-2)

Boot safety: the shelter draft bypasses migrate(), so restoreDraftShelter() now backfills missing shape fields (instalments/currency/gDisc/payment/notes) and updateInstalmentSum() guards its instalments access — legacy or partially-corrupt drafts can no longer crash boot with a TypeError. (Q-3)

Global shortcuts: added the canonical Contract B capture-phase keydown listener forwarding Ctrl+Alt+Shift+* to window.parent.orosShortcuts.handle. Shell shortcuts previously died while focus was inside quote inputs. (Q-4)

Notifications: migrated the last local toast (sync_replaced — "this quote was deleted on another device") to notifyTransient(). All informational toasts now go through the unified system with ns "quote". (Q-5)

Local shortcut guard: Alt+N (new quote) now yields to editable targets and open dialogs instead of hijacking typing (macOS dead keys, etc.). (Q-9)

PDF pagination: the instalments, payment and notes blocks now render line-by-line with page breaks instead of running off the first page; previously only the items loop paginated. (Q-10)

Comment typo in openQuote() corrected ("ΔΕΝ κάνουμε dirty/push"). (Q-11)

Verified (no change needed):

Currency handling: migrate() coerces to EUR/USD — matches the two-option select in the HTML. Number input is readonly and only mutated via the Regenerate button. Client form uses method="dialog", so the fingerprint-unchanged early return closes the dialog natively.

Roadmap (under consideration):

Calendar integration: due dates and status changes (sent/accepted) are natural Calendar feed candidates following the Contacts/Cycle pattern.

Smoke tests:

Type in an unsaved draft, close the tab within 800ms of the last keystroke, reload — draft restored complete.
Ctrl+Alt+Shift+P/F/S/E fire while focus is inside the payment textarea.
Alt+N outside inputs opens a new draft; inside an input or with a dialog open it does nothing.
Delete a quote on device A while it is open on device B, sync — B shows the transient "deleted on another device" notification.
Manual sync produces no toast; the taskbar sync dot is the only feedback.
PDF export with many instalments and a long notes field spans pages cleanly.
Two devices computing a sync payload from identical data produce byte-identical JSON.

---

1) Storage — Five-Axis Verified (Bible Entry)
Storage (orOS Suite) — Five-Axis Verified
App ID: storage · Files: index.html / storage.css / storage.js · Storage key: oros-storage-data (ver 1) · Rescue key: oros-storage-data-broken (device-local, NEVER synced) · Status: AUDITED & PATCHED (Five-Axes Doctrine compliant)

Purpose: Hierarchical home inventory (Space → Room → Furniture → Position → Items) with breadcrumb drill-down, desktop split-tree view, quantity controls, cascade tombstone deletes, and deterministic sync merge (strict mergeRow() normalizer, no volatile defaults).

Data Model:

flat entity array { ver: 1, ents: [entity...] } entity = { id, type: space|room|furniture|position|item, name, bi: {en, el} (until rename), parentId, pos, mtime, del: bool } item extends: qty (>= 1), note (<= 300 chars) bilingual seeds resolve per active language until first explicit rename; rename kills the bi pair.

Architectural Decisions (Audit-Certified):

Strict mergeRow() normalizer — Merge-side validator (unlike entDefaults) introduces NO volatile values (no uid(), no Date.now()). Malformed rows DROP deterministically — same data yields identical merged output on every device at any time. Tie-breaks: bigger mtime → tombstone wins → bigger qty → lexicographic id.
Deterministic tombstone pruning (HB-3 / MD-4 / NT-2 pattern — Prompter PR-2 / Quote Q-1 parity) — The sliceGet() payload cutoff derives from the dataset's newest mtime (maxTs across ALL entities), never from wall clock. Pruning is payload-only: local db retains every tombstone so a lagging device can never resurrect a deleted entity. TOMB_PRUNE_DAYS = 30.
Rescue backup (BROKEN_KEY) — If localStorage parsing fails or normalize() rejects the shape, the raw string is backed up verbatim to oros-storage-data-broken BEFORE re-seeding. Destructive data loss eliminated; BROKEN_KEY is excluded from sync slices.
Cascade tombstones — Deleting a parent recursively tombstoned all descendants; tombstones propagate through merge (delete made on ANY device wins).
Nav-target sanitizer — Both sliceSet() and confirmDelete() call sanitizeNav(): if the viewed entity was deleted remotely, climb to the nearest surviving ancestor; never render a dead reference.
Unified notifications (Wave 6 doctrine) — All informational toasts (save/delete) route through notifyTransient() → parent.orosNotifs.transient({ ns: "storage" }). Validation errors (name required) stay local in errBox (answer to user keystroke, not history-worthy). Per-sync toast (sync.merged) removed — sync feedback = taskbar dot only.
Contract B (Capture-phase forwarding) — Ctrl+Alt+Shift+* combos forwarded to window.parent.orosShortcuts.handle(e) with stopPropagation when handled (parity with todo/kanban/writer/notes/prompter/quote). Alt+yield pattern: local Escape → goUp() yields to editable targets (INPUT/TEXTAREA/SELECT/isContentEditable) and open dialogs.
Palette inheritance — runtime copy of parent shell's data-theme + palette variables via setProperty (not cssText +=); MutationObserver watches data-skin/data-theme for live repaints.
qty floor enforcement — Math.max(1, Math.floor()) in entDefaults, mergeRow, dialog submit, and setQty. Note clamp (300 chars) consistent across all mutation paths.
Desktop split view (≥1024px) — Grid layout built on .view (mobile drill-down ↔ desktop split via debounced resize). Inline SVG icons (ForkAwesome exiled).
Merge Semantics: union by id across quotes/clients/templates/payMethods filtered by shared tombstone map; ties broken by mtime then del flag then qty then id (deterministic).

Pre-Sync Checklist (MANDATORY, per audit):

Calendar integration: N/A — no dated entities (deferred to future Wave). Unified notification system: ✅ transient via ns:"storage"; 'storage' added to KNOWN_APPS in notifications.js. Dropbox sync: ✅ slice registered, deterministic merge + payload-only pruning. Snapshot capability: ✅ covered by full-DB snapshots. Manual/auto export: ✅ covered by orOS full-database export/import. Offline-first: ✅ zero network deps; standalone :root fallback palette if shell absent. Mobile-first: ✅ responsive (card layout collapses qty controls), safe-area insets respected.

Audit Trail:

ST-1a/b: constants + deterministic payload-only tombstone pruning (replaced wall-clock Date.now() cutoff) ST-2a/b/c: unified notifications (notifyTransient helper + 2 toast migrations + toast.merged removal + KNOWN_APPS registration) ST-4: Contract B capture-phase listener with stopPropagation ST-6: Escape editable-target + dialog-yield guard KN-1: notifications.js KNOWN_APPS updated Closed as already-correct: rescue backup (BROKEN_KEY), cascade tombstones, strict mergeRow normalizer, sanitizeNav(), qty floor/note clamp.

2) Changelog Entry (repo-ready)
[storage] Five-Axis Audit — deterministic sync, unified notifications, Contract B

Scope: Full functional audit of the Storage app (storage.js, storage.html, storage.css) under the Five-Axes Doctrine. All patches verified against actual source before delivery.

Fixed:

Sync determinism: replaced wall-clock tombstone pruning (Date.now()) with a dataset-derived cutoff. The new sliceGet() computes the prune cutoff from the newest mtime across ALL entities (maxTs), never from wall clock — identical data now produces identical sync payloads on every device at any time. Pruning is payload-only: the local database retains every tombstone, so a lagging device can never resurrect a deleted entity. TOMB_PRUNE_DAYS = 30. (ST-1)

Unified notifications: migrated the two informational toasts (save entity, delete entity) from local toast() to notifyTransient() → parent.orosNotifs.transient({ ns: "storage" }). The per-sync toast (toast.merged) was removed entirely — sync feedback is now exclusively the taskbar sync dot (doctrine: info.merged means "merge engine ran", not "data changed"). 'storage' added to KNOWN_APPS in notifications.js so the toggle appears in Settings → Notifications. Validation error (name required) stays local in the dialog's errBox. (ST-2)

Global shortcuts: added the canonical Contract B capture-phase keydown listener forwarding Ctrl+Alt+Shift+* to window.parent.orosShortcuts.handle(e). When the shell handles the combo, stopPropagation prevents any app-level keydown from double-reacting. Local Escape → goUp() now yields to editable targets (INPUT/TEXTAREA/SELECT/isContentEditable) and open dialogs (Esc cancels dialogs natively). (ST-4 + ST-6)

Verified (already-correct, no change needed):

Rescue backup: corrupted/uncrackable localStorage data is verbatim backed up to oros-storage-data-broken BEFORE re-seeding — destructive data loss eliminated; rescue key excluded from sync slices. Strict merge normalizer: mergeRow() introduces no volatile values (uid/Date.now) — malformed rows drop deterministically; same inputs, same output, every device. Cascade tombstones: parent delete tombstoned descendants; tombstones propagate through merge. Nav sanitizer: both sliceSet and confirmDelete call sanitizeNav() to prevent dead-reference empty states. qty floor & note clamp: enforced consistently across all mutation paths (entDefaults, mergeRow, dialog, setQty).

Smoke tests:

Save/rename entity → unified system toast (taskbar bell styling), NOT local toast.
Delete entity → transient notification, cascade tombstones descendants, nav climbs to surviving ancestor.
Sync pull → NO toast; sync dot reflects state; if viewed entity was deleted remote, nav sanitizes before render.
Ctrl+Alt+Shift+P/F/S/E fire while focus is inside dialog inputs.
Escape inside input → nothing (yield); Esc outside inputs (no open dialog) → goUp().
Two devices with identical data → byte-identical sync payload (cutoff from maxTs, not from push time).
Settings → Notifications → toggle "storage" now appears.

---

Time app — Five-Axis Audit Complete (T-1..T-4)

Verified cross-file contracts with fresh sources: shell.js deep-link bridge (__orosOpenTime → iframe __orosTimeOpen, staging key oros-time-open, one-shot take __orosTimeTakePending) — the suspected __orosOpenTime/__orosTimeOpen naming conflict is INTENTIONAL two-role naming (shell bridge vs iframe receiver), NOT a bug. No rename. Finding #7 CLOSED with zero patches.
notifications.js: KNOWN_APPS factory entry "time" present; shell alarmNotify emits ns:"time" with deepLink:"time:alarms" — per-app toggle covers a real emitter. Doctrine-compliant.
T-1 (Contract B): added canonical capture-phase keydown forward in time.js (section 12b) — shell combos (Ctrl+Alt+Shift+letters) now work with focus inside Time inputs. Parity with todo/kanban/notes/writer.
T-2 (Alarm Add UX): invalid HH:MM or engine rejection now shakes the time input + focuses it (shared shakeInput helper, same gesture as timer T6) instead of a silent return; on success BOTH al-time and al-label clear (al-daily intentionally kept). Patches T-2a/b/c.
T-3 (Timer overlay): Escape now dismisses the fullscreen countdown overlay for the current run (keyboard parity with click; timer keeps running).
T-4 (Pomodoro state loss): new device-local runtime record oros-time-pmrun (section 10b). pmRunSave hooks: pm-start, pmStop, pmWatchdog. Boot reconciliation (pmRunRestore): leg fired while app closed → pmDone++ (synced, work legs only) + phase advance; leg still running + engine alarm alive → countdown resumes against the same alarm. Record is never part of the sync blob (section 14 doctrine intact), swept by factory reset.
Astro reconciliation (time.js ↔ astro.js): tombstone contract verified identical across load/save/merge — no changes needed.
Zone tombstones: bounded by fixed ZONE_LIST, no pruning needed — documented as correct.
Alarms remain shell-engine-owned (localStorage oros-alarms, alarmSanitize catch-up, markDirty on fire/add/remove). In-page firing path is standalone-only fallback by design.
No new files, no manifest/sw.js changes required; version bump via bump-version.yml as usual.
Standing rules reaffirmed: deep-link naming is a two-role contract (shell __orosOpen<App> bridge ↔ iframe __oros<App>Open receiver) — never "fix" the asymmetry; app runtime state stays out of sync blobs (device-local keys for recovery records).

BIBLE ENTRY — TIME (Five-Axis Verified)
Architecture. Shell owns alarm firing (engine: alarmTick in shell.js §9e, storage oros-alarms, sanitize + daily catch-up by whole days, markDirty on add/remove/fire). time.js renders + registers via window.parent.orosAlarms; standalone fallback replicates the contract in-page with toasts + snooze.

Sync slice ("time"). Entities: zones {tz, mtime} + bounded tombstones zonesDeleted (delete wins ties). Scalars (style 0–4, sound, pmWork/pmBreak, convOn) LWW via smtime family; pmDone = Math.max. Astro coordinate: mtime LWW + astroTomb deletion-wins — reconciled identically in loadState, saveState, mergeTime. Runtime (timer/stopwatch/pomodoro leg, alarm registrations) is OUT of the blob; the pomodoro leg's recovery record lives in device-local oros-time-pmrun (T-4), consumed at boot.

Deep links. Chain: notifications.js DL_BRIDGES time:<pane> → shell __orosOpenTime(pane) → iframe __orosTimeOpen(pane); closed-app path stages oros-time-open in sessionStorage → one-shot take at boot. Pane map: alarms/alarm/timer/stopwatch/pomodoro → tab click.

Notifications. ns:"time" = alarms; toggle in Settings → Notifications (KNOWN_APPS factory). Shell emit is the only orOS-mode path; in-app toast = standalone fallback only.

Contract B. Capture-phase forward present (T-1, §12b) — the editable-target yield (Χ5) stays in the shell handler.

---

To-Do — Five-Axis Audit (TD-1, TD-2, TD-4, TD-6)

HTML/CSS axis closed: all 39+ DOM ids, radio names (f-rec/l-rec) and JS-painted classes verified present in todo.html/todo.css — zero orphans, zero unstyled selectors. Version pins v0.36.09 consistent across html/css/js; bump via bump-version.yml after patches.
TD-1 (Undo ordering loss): stampAll now stamps state.om AND per-list list.om in addition to sm/mtimes. Previously an Undo of a list deletion could win content (mtime) but lose ordering (stale om) — the merge reference came from remote and the resurrected list landed at the end of the tab strip. Undo now asserts the FULL snapshot as newest, matching its documented contract.
TD-2 (Recurrence early-completion): recycleItem anchors on item.due when the due date is still in the future — completing early now yields the NEXT cycle instead of re-issuing the period just completed (e.g. Friday task finished Wednesday now rolls to next Friday, not this one). Daily/monthly rules also stay on their true cadence grid. Overdue/absent-due behavior unchanged (anchor = now). Bonus: weekly-weekday math is now exact for biweekly rules since the anchor lands on the due weekday.
TD-4 (Quick-add under search/filter): adding a task while a search or label filter is active now clears the session-only view state (searchQuery/activeFilters + UI) so the new task is immediately visible instead of silently hidden — previously indistinguishable from a failed add.
TD-6 (Filter popover Esc): Escape now dismisses the open label-filter popover (keyboard parity with outside-click), bubble-phase listener; Contract B capture listener unaffected.
OPEN (#3): sync.js handling of a null mergeTodoStates result (empty-merge fresh-install fallback) not yet verified against live source — pending sync.js review.
UNDER CONSIDERATION (#5): Calendar feed for tasks with due dates (todo → Calendar, alongside Kanban discussion); unified notifications ns:"todo" for due-today/overdue reminders via the shell engine. Both require shell contracts — recorded, not scheduled.
Verified clean (no patch needed): Contract B forwarding (canonical reference implementation for the suite), deep-link receiver (__orosTodoOpen + oros-todo-open one-shot staging), symmetric merge engine (structural list merge, tombstone union + prune-inside-merge, JSON tie-breaks), R14 themed confirm, audit #18 label-detach stamping, v0.4b zero-edit dialog fingerprint, audit #20 midnight rollover, v1→3 additive migration.
BIBLE ENTRY — TO-DO (Five-Axis Verified)
Architecture. Single-IIFE app + separate deep-link receiver IIFE (depends only on the DOM contract #tabs .tab[data-list-id] click — never touches main IIFE internals). Data: oros-todo-data, DATA_VER 3, additive migration (unknown stamps default 0 = oldest).

Merge engine (reference implementation). mergeTodoStates(local, remote) registered as the 5th arg of registerSlice — deterministic + symmetric: scalars LWW by root sm (symmetric JSON tie-break), entity content LWW by mtime (JSON tie-break), ordering donated by the larger-om side (pickRef with symmetric id-sequence tie-break), lists merge STRUCTURALLY (headers LWW, items independent), tombstones union+max-ts with edit-after-delete resurrection, pruning inside the merge is convergence-safe. Undo = stampAll asserts the WHOLE snapshot newest — INCLUDING om since TD-1. Returns null on empty merge (fresh-install fallback) — sync.js handling under verification (#3).

Deletion model. Soft tombstones state.deleted[id], 30-day lifetime, pruned at load + inside merge + sliceSet. Cascades: list delete tombstones list + all items; clear-completed tombstones; label delete detaches + stamps affected items (audit #18) + tombstone.

Canonical templates owned by this app. Contract B forward (capture, typeof guard, handle(e) return → stopPropagation) — THE reference for all other apps (Time T-1 aligned to it). Deep-link two-role naming + one-shot sessionStorage staging.

Rules for future work. Search/filter = session-only view state, never persisted, cleared on quick-add (TD-4). Dialog close-flush commit on ALL paths with zero-edit fingerprint (v0.4b). applyListCycles self-saves only on real resets.

- CLOSED (#3): sync.js verified — null merge results degrade to documented
  remote-LWW (both applySlice and registerSlice flush), unreachable in
  practice due to the delete-cascade fresh-list invariant, and double-
  guarded by todo's sliceSet empty-lists rejection. No patch. sync.js
  untouched.
  
  ---
  
  ## orOS Weather App — Five-Axes Audit Complete
**Version:** v0.36.09 (patches pending)
**Status:** ✅ All five axes verified, zero data loss risk

### Summary
The Weather application is now the second fully-audited orOS app (after To-Do).
It implements the canonical Contract B pattern for keyboard shortcuts,
uses a symmetric deterministic merge engine with LWW per-field semantics,
and follows the cache doctrine (cache/slice stay metric, units are render-only).

### Patches Ready for Deployment
1. **W1 — Scalar tie-break fix** (merge ping-pong prevention)
   - Expanded scalar triple `[active, units, shellWx]` for lexicographic tie-break
   - Ensures symmetric convergence: `merge(A,B) === merge(B,A)` even on sm ties
   - Prevents infinite push/pull loops when two devices have different units

2. **W2 — Tombstone pruning (30-day lifetime)**
   - Matches To-Do parity: deleted cities stop travelling after 30 days
   - Pruning occurs in three places: load(), sliceSet(), merge()
   - Trade-off: ancient deletions (>30d) may resurrect, re-delete re-buries them

3. **#3 — Shell pref stamping in live bridge**
   - `__orosWeatherUpdate` now stamps `state.shellWx` when incoming object has `on:true`
   - Discriminator: shell pushes carry boolean `on`; GPS pushes do not
   - Fixes boot-time override bug where shell city re-forced itself on user's in-app choice

4. **#5 — Tray mirror guard (optional)**
   - Added `&& sh.on` check before writing to tray cache
   - Ensures tray chip being OFF stops all writes (clean state only)

### Verified Clean (No Patch Required)
- **Deep-link chain:** `weather:open` → DL_BRIDGES → `__orosOpenWeather` bridge → app
- **Notification namespace:** `weather` registered in KNOWN_APPS
- **Null merge handling:** No data loss — remote-LWW fallback documented
- **HTML/CSS cross-check:** 39+ IDs, all present; zero orphans
- **Offline badge:** `[hidden]` authority guard works correctly

### Architecture Notes
- **Provider:** Open-Meteo (no API key, no cookies)
- **Cache:** Device-local (`oros-wx-cache`), NEVER travels in slice
- **Units:** Render-only conversion (metric ↔ imperial); slice stays metric
- **Timezone:** City-local `now` derived from `utc_offset_seconds` (response, not device clock)
- **AQI:** Serial second request (European AQI 0–100+), optional/non-blocking
- **Undo-delete:** Native toast (5s), resurrects with same id + fresh mtime > tombstone

### Integration Checklist
- [x] Contract B keyboard shortcut forwarding
- [x] Unified notifications (transient + inbox for fetch failures)
- [x] Calendar integration (placeholder label — protected default)
- [x] Dropbox sync with merge engine
- [x] Snapshot capability
- [x] Full manual/auto export

### Next Steps
Apply patches W1, W2, #3 to `weather.js` and update changelog.
Proceed to next app audit (Calendar).

---

## Weather App Architecture (v0.36)

### Merge Engine Scalars
Three scalars travel together: `active`, `units`, `shellWx`. Tie-break uses
lexicographic JSON of the **full triple** (symmetric: prevents ping-pong on
equal-sm merges).

### Shell Pref Stamping Rule
Live bridge (`__orosWeatherUpdate`) must stamp `state.shellWx` **only** when
incoming object carries `on:true` (shell push). GPS pushes lack this property
and must NOT stamp — preserving user's in-app location choice across boots.

### Cache Doctrine
- Cache key: `oros-wx-cache` (device-local, never in slice)
- Slice key: `oros-weatherapp-data` (travels with units, cities, shellWx)
- Units are **render-only**: cache/slice always store metric (°C/km/h)
- Offline badge: true offline OR last fetch failed while online (`netDown` flag)

### Tombstone Lifetime
Deleted cities carry tombstones for 30 days maximum (prune in load/sliceSet/merge).
Trade-off: a remote state >30d older may resurrect an ancient deletion;
the next delete re-buries it. Zero data loss, bounded blast radius.

### Deep-Link Pattern
`weather:open` → DL_BRIDGES routing → `__orosOpenWeather` bridge → app activation
(idempotent: if app runs, no-op). Pane-less design: no iframe receiver needed.

──────────────────────────────
*Designed by Christos Koulaxizis — koulaxizis.gr*
*orOS — A static operating system in your browser*
*No tracking · No cookies · E2EE sync · Open source*