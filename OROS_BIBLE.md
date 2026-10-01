═══════════════════════════════════════════════════════════
orOS BIBLE — CONDENSED (Assistant Reference Edition)
═══════════════════════════════════════════════════════════
Live   : https://useoros.online
Repo   : github.com/koulaxizis/oros
Author : Designed by Christos Koulaxizis · koulaxizis.gr
Tagline: "A static operating system in your browser"

Document map:
  Part I   — MANTRA + STANDING PROCESS RULES (R1–R25)
  Part II  — CORE SYSTEM ARCHITECTURE
  Part III — APP REGISTRY (status, keys, sync types)
  Part IV  — DATA MODELS (core contracts)
  Part V   — CANONICAL PATTERNS (verbatim contracts)
  Part VI  — UI STANDARDS
  Part VII — RELEASE PIPELINE + CHECKLISTS
  Part VIII— OPEN DECISIONS & EXEMPTIONS
  Part IX  — TROUBLESHOOTING FLAGS
  Part X   — SESSION HANDOFF PROMPT
  Part XI  — CHANGELOG INDEX (entries live in CHANGELOG.md)


╔══════════════════════════════════════════════════════════╗
║  PART I — MANTRA + STANDING PROCESS RULES                ║
╚══════════════════════════════════════════════════════════╝

1. MANTRA (design contract — never violate)
  Offline first · Mobile first · No external dependencies ·
  Full project manual export · Full project automatic export ·
  Full project snapshots · Full project auto-merge sync ·
  No guessing: if unsure, ASK; if a file is missing, REQUEST
  it; never guess or assume.

2. STANDING PROCESS RULES

DELIVERY & PATCHING
  R1  NO WHOLESALE REGENERATION for fixes. Surgical patches
      (OLD block + NEW block + exact anchor). EXCEPTION:
      LARGE multi-edit changes or user-requested restructures
      ship as FULL corrected files in numbered "doses" with
      continuation markers verbatim to prevent truncation.
  R3  VERIFY THE RUNNING VERSION FIRST (Info modal + boot
      marker in console) on BOTH devices before diagnosing.
  R4  Before chaining a patch ON TOP of a previous patch,
      CONFIRM the previous one was applied. Never assume.
  R11 Deliver patches against the USER'S CURRENT FILES, not
      remembered intermediate states.
  R19 VALIDATION: user pastes delivered code back for
      explicit correctness confirmation before committing.
  R21 CHANGELOG DISCIPLINE: after EVERY significant change,
      APPEND an entry to CHANGELOG.md in the SAME response.
  R22 BIBLE CURRENCY: after every significant PROJECT
      DECISION, update the affected registry parts in the
      SAME response. Unlogged decision = did not happen.
  R23 VERSIONING IS USER-OWNED: version numbers, cache-
      busters (?v= refs), CACHE_VERSION stamps and
      APP_VERSION bumps are the USER'S sole responsibility.
      Audits NEVER propose, apply or "fix" versions.

MERGE & SYNC DOCTRINE
  R5  MERGES ARE SYMMETRIC: merge(A,B) === merge(B,A).
      Tie-breaks: mtime → lexicographic JSON/id — NEVER
      "local wins" (flip-flops between devices).
  R6  Pull-fed slice setters NEVER call markDirty.
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
  R10 Floating/transient views are SESSION-ONLY (no prefs,
      no storage keys).
  R12 SHORTCUTS: final contract Ctrl+Alt+Shift+letter, matched
      via e.code (physical key, layout-agnostic). Alt+Shift and
      Ctrl+Shift+* are DEAD (Windows/browser eat them).
      SC_DEFS in shell.js is the single source.
  R14 NATIVE DIALOGS RETIRED: no alert()/confirm()/prompt().
      Themed custom dialogs + undo-toasts instead.
  R15 BILINGUAL SEEDS: factory presets store bi {en, el};
      display uses the ACTIVE language. Hand-rename KILLS bi.
  R16 DETERMINISTIC SEED IDS: two fresh installs that sync
      must NOT union into duplicate seeds.

QUALITY GATES
  R18 PRE-COMPLETION CHECKLIST per app: perfect sync, full
      local export zero-loss, offline-first, mobile-first —
      ALL four before the app is "done".
  R20 VERSION REFS FULLY AUTOMATED: every relative .css/.js
      ref in EVERY index.html stamped ?v=<APP_VERSION> by the
      CI bot. APP_VERSION (shell.js) is the only manual version.

NOTIFICATION SYSTEM CONTRACT
  R24 All app triggers MUST route through emit() bridge in
      notifications.js. Legacy app-specific alerts remain as
      fallback for stale caches. Deep links follow
      "ns:type:id" format and register in DL_BRIDGES.
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

  Standing rule: "Ποτέ συμπεράσματα για το εσωτερικό ενός
  αρχείου που δεν είναι στο τραπέζι."

  PATCH DELIVERY FORMAT — MANDATORY RULE:
  All code corrections must be delivered as precise,
  find-and-receive patches. Each patch: header line
  "PATCH X/N — description + location hint (file +
  function/section)". The OLD block: exact code currently in
  the user's file, verbatim, byte-exact, uniquely findable via
  simple text search (exactly one match). The NEW block:
  replacement code in a SEPARATE fenced block immediately
  after. Never mix OLD and NEW in one block. Never deliver
  indented code as unfenced plaintext. Verification before
  delivery: confirm every OLD block exists in the current
  file state; if not, STOP and request the source file.
  Apply patches in numbered order (1 → N). Large file
  deliveries (new files, rewrites) are exempt — full files
  split into numbered sequential parts to prevent truncation.


╔══════════════════════════════════════════════════════════╗
║  PART II — CORE SYSTEM ARCHITECTURE                      ║
╚══════════════════════════════════════════════════════════╝

shell.js (single source of truth):
  · IIFE encapsulation with "use strict" — every JS file.
  · APP_VERSION in shell.js (manual only; CI bot stamps ?v=).
  · Anti-loop sync contract: pull-fed setters never dirty.
  · Offline honesty: never fake data when offline.
  · Battery efficiency: no idle timers; all throttled engine
    ticks piggyback on renderClock (1s tick). A throw in ANY
    unguarded callee kills the entire chain — new ticks MUST
    guard missing modules (window.t, window.orosNotifs,
    window.orosSync) per existing patterns.
  · SUBSYSTEMS: scToast (§9), sync dot (§9b), SC_DEFS (§9c),
    weather widget (§9d, Open-Meteo), alarms (§9e,
    window.orosAlarms — survive iframe close), calendar
    reminder engine (§9e2), notification engine (§9e3,
    notifications.js), files-disk slice glue (§9f), radio
    deep-link bridge + tray tick (§9i), screen pet (§9h:
    pet.js root-level component, window.orosPet, #pet-layer
    overlay, progressive guard).
  · REQUEST shell.js when a fix needs the exact current
    function — never quote from memory.

sw.js (Service Worker):
  · Precache-all: per-URL, exact URL matching, no globbing.
    PRECACHE_URLS must list every app file (G2 guard).
  · CACHE_VERSION busts everything; ?v= stamped by CI.
  · Navigations fetch(request, {cache:"no-cache"}); only
    response.ok cached; OAuth ?code= never cached.
  · apps.json network-first {cache:"no-store"} + fallback.

sync.js v0.9.2:
  · Deterministic, symmetric merges (R5). LWW by mtime,
    lexicographic tie-breaks, tombstones max-ts union,
    delete-wins-ties, newer-edit resurrection (R17).
  · registerSlice(name, get, set, storageKey?, mergeFn?) —
    5 args. WITHOUT mergeFn the slice is MERGELESS →
    divergence guard parks remote (concurrent two-device
    edits lose one side) — ALWAYS register mergeFn.
  · Zero-knowledge passphrase; AES-GCM E2EE; PKCE OAuth.
  · collectPayload()/applyPayload() = unified funnel for
    cloud sync, manual export, auto-snapshots — one funnel.
  · reconcile(reason) triggers: boot/interval/visible/online/
    register/debounce (push-on-change).
  · contentDownload 409 = empty cloud — callers branch on
    res.status===409 themselves.
  · ACCEPTED LIMIT: two offline devices with apps closed
    converge only via a live open.
  · LESSON (closed incident): mergeless slices without
    baselines must never push empty payloads — empty-blob
    guard in collectPayload() blocks it.

fs.js (orOSFS):
  · window.orosFS, one mount (/internal). OPFS primary,
    IndexedDB "oros-ofs" fallback, identical promise API.
  · importDisk merge by default; {wipe:true} destructive only.
  · fs.js must be in the manual commit (bot never stages
    untracked files).

notifications.js:
  · emit() is the single bridge for all triggers.
  · oros-notifs slice: 7-day TTL, 300-item cap, LWW
    per-field merge (readAt non-null beats null, firedAt
    max, createdAt min).
  · notifySys routing (shell): dim → transient(); ok/err →
    emit(). Stale-bundle fallback → scToast()/local toast()
    (NEVER delete the old path while stale caches can exist).
  · transient() bypasses app toggles by design; supports
    action: {label, fn} for Undo-bearing toasts (never
    serialized, in-memory closure, same-origin only).
  · Deep links "ns:type:id" via DL_BRIDGES (typeof-guarded).
  · KNOWN_APPS = single source of toggle list: calendar,
    cycle, mood, todo, habits, time, system, weather, notes,
    quote, contacts, files, kanban, prompter, storage,
    spreadsheet, dice, minimalism.
  · Sounds: WebAudio oscillator presets — zero external assets.

translations.js:
  · Must stay synchronous top-level (script order:
    translations.js → sync.js → fs.js → shell.js →
    notifications.js; classic scripts, guaranteed order).
  · No version number in the file — version lives ONLY in
    shell.js. Contains ONLY shell-consumed keys (app.<id>,
    category.*); app strings live in each app's inline
    STRINGS object.

CSS RULES:
  · [hidden] { display: none !important; } at end of EVERY
    app stylesheet.
  · Per-element display rules guarded with :not([hidden]).
  · Single OS Skin rule: shell CSS variables are the ONLY
    styling truth (inheritPalette + watchPalette, G3 guard).
  · LABEL_PALETTE (8 fixed colors) is DATA, not skin.

I18N RULES:
  · EN/EL only, EN default. Locale el-GR / en-GB.
  · Greek dates: NO comma after the day; EL dates dd/mm/yyyy.

DATA RULES:
  · Additive-only migrations. Idempotent normalizeState() on
    load AND merge results. Corrupt-data rescue backup
    BEFORE reseeding. Device-local whitelist NEVER synced.


╔══════════════════════════════════════════════════════════╗
║  PART III — APP REGISTRY                                  ║
╚══════════════════════════════════════════════════════════╝

CURRENT STATE: kernel LOCKED (full re-audit passed, zero
critical findings). Static GitHub Pages PWA (useoros.online
only). EN default, EL secondary. Dark default, light optional.
24h clock. Nunito woff2 vendored.

  App        | Storage key           | Merge type            | Status
  ------------|-----------------------|-----------------------|--------
  To-Do       | oros-todo-data        | entity LWW + tombs    | CLOSED (TD set)
  Kanban      | oros-kanban-data      | boards[] union, tombs | CLOSED (KN set)
  Notes       | oros-notes-data       | page/label LWW + tombs| CLOSED (NT set)
  Bookmarks   | oros-bookmarks-data   | entity LWW + tombs    | 5/5 VERIFIED
  Calendar    | oros-calendar-data    | event union + tombs   | CLOSED (F6 cosmetic)
  Contacts    | oros-contacts-data    | union + LWW + tombs   | 5/5 VERIFIED
  Cycle       | oros-cycle-data       | day-entity union, LWW | 5/5 VERIFIED
  Weather     | oros-weatherapp-data  | merge-lite            | 5/5 VERIFIED
  Mood        | oros-mood-data        | entity LWW + cols     | Fixes applied
  Time        | oros-time-data        | entity union + smtime | 5/5 VERIFIED
  Quote       | oros-quote-data       | entity union + LWW    | 5/5 VERIFIED
  Storage     | oros-storage-data     | flat ents union + del | 5/5 VERIFIED
  Habits      | oros-habits-data      | habits/comps LWW      | 5/5 VERIFIED
  Files       | oros-files-data + "files-disk" | files-disk blob | ALL CLOSED
  Prompter    | oros-prompter-data    | union + LWW + tombs   | 5/5 VERIFIED
  Characters  | oros-characters-data  | union + LWW + tombs   | 5/5 VERIFIED
  Spreadsheet | oros-spreadsheet-data | CELL-ENTITY LWW + cw  | 5/5 VERIFIED
  Dice        | oros-dice-data        | union + LWW + tombs   | 5/5 VERIFIED
  Notifications| oros-notifs         | per-field LWW         | Wave 1A core done
  Screen Pet  | oros-pet-data         | identity field-LWW    | Integrated, smoke test pending
  Radio       | oros-radio-data       | stationuuid union    | Wave 3 done, hotfixes applied
  Minimalism  | minimalism slice      | day-entity union      | Wave 1-2 done, content expanding

  REFERENCE APP (canonical template): mood.js — every contract
  in Part V is extracted from it. Tie-breaker: "what does
  mood.js do?"

DEVICE-LOCAL (never synced): oros-last-version, oros-wx-cache,
  oros-wx-last, oros-auto-snapshots, oros-fs-*, oros-pet-enabled,
  oros-pet-pos, oros-pet-events, oros-pet-calendar-sync,
  oros-radio-recents, oros-radio-cache:*, oros-cal-reminders-fired,
  oros-cal-pending, oros-*-open staging keys, all *-prefs/
  *-cache/*-seen keys, oros-sync-* engine keys,
  oros-menu-cat-collapsed.

FILE TREE: index.html, shell.js, notifications.js, sync.js,
  fs.js, style.css, pet.css, pet.js, translations.js,
  apps.json, sw.js, manifest.webmanifest, vendor/ (jspdf,
  NotoSans, xlsx), fonts/ (Nunito), one dir per app (todo,
  kanban, notes, bookmarks, weather, mood, time, calendar,
  quote, prompter, storage, habits, files, contacts, cycle,
  characters, spreadsheet, dice, radio, minimalism,
  writer-staging), .github/workflows/bump-version.yml,
  OROS_BIBLE.md, CHANGELOG.md.


╔══════════════════════════════════════════════════════════╗
║  PART IV — DATA MODELS                                     ║
╚══════════════════════════════════════════════════════════╝

COMMON CONTRACTS (all apps):
  · Entities: { id, mtime, ... } — union by id, LWW by mtime,
    tie → lexicographic JSON/id.
  · ids: uid() = Date.now().toString(36) +
    Math.random().toString(36).slice(2,7). Seeds deterministic
    (R16) — nb-default / tdl-general / kb-seed-main style.
  · Day keys: LOCAL calendar getFullYear()+"-"+pad(m+1)+"-"+
    pad(d) — no ISO/timezone bugs. DST-safe walking via
    Date.setDate(+1), never += 86400000.
  · Timestamp discipline: time-of-day & day boundaries DERIVE
    from entry ts at render time — never stored.
  · uid()/Date.now() inside merge = non-determinism bug —
    strict merge sanitizers DROP invalid rows instead.

PER-APP SCHEMAS (key shape):
  NOTES v2:  { ver, pages[], labels[], tombs{} } — wiki-links
             [[Title]] zero-storage regex-derived; pinned notes.
  KANBAN v5: { ver, boards[{id,name,columns,labels,tombs,
             mtime,color?,archived?}], boardDeleted{},
             activeBoardId (device-local) }.
  MOOD v3:   { ver, sm, om, entries[{id,ts,mtime,emotions[],
             loc,person,trig,habits,note}], cols, deleted{} } —
             9 fixed emotions, order DESC ts derived at sort.
  TIME v1:   zones entities {tz,mtime} + scalar prefs LWW via
             smtime; alarms travel IN the shell slice.
  CALENDAR:  { ver, events[{id,title,date,start,end,location,
             labelId,recur{freq,interval,until,exdates},
             remindMin,mtime}], labels[], deleted{} } — fixed
             key order for deterministic merge tie-break.
  QUOTE:     entities + shared tombstone map; computed totals
             PURE (never stored); numbering OFF-YYYY-NNN.
  STORAGE v1:{ ver, ents[{id,type,name|bi,parentId,pos,qty?,
             note?,mtime,del}] } — cascade delete tombstones
             every descendant with fresh mtime.
  HABITS v1: { ver, habits[{id,name,icon,color,days[0..6
             MONDAY-first,mtime,del}], comps[{id:"<habitId>|
             <YYYY-MM-DD>",...}] } — toggle-off = tombstone.
  WEATHER v1:{ ver, sm, om, active, deleted{}, cities[],
             shellWx, units } — units RENDER ONLY, slice
             ALWAYS metric.
  FILES:     view prefs in oros-files-data (device-local);
             "files-disk" slice = JSON snapshot of /internal
             (BLOB MODEL; per-entry model = backlog upgrade).
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
             visited,lastVisited,mtime,fav?}}, folders{id:{
             name,pos,mtime}}, deleted{}, settings{} } — root
             folder "unsorted" permanent; dedup via shared
             dupeKey() canonical rule (scheme/www/case/
             fragment-insensitive, query string KEPT).
  DICE v2:  { ver, sm, deleted{}, history[{id,kind,ts,mtime,
             ...}], presets[] } — kind∈{dice,coin}; tombstones
             prune on max-mtime - 30d; presets union-by-name.
  PET v1:    { ver, pet{id,name,palette,birthTs,fm{field:
             mtime}}, lastFed, lastPetted, wokeAt/awakeE?,
             asleepSince/asleepE?, tombs{} } — stats NEVER
             stored: DERIVED at render from anchors (relaxed
             decay: food →0 in 24h, happy 36h, energy 10h
             awake / +8 per min asleep; auto-sleep <8,
             auto-wake ≥95, retroactive cycle resolution).
             Identity = per-field LWW via fm; temporal anchors
             = max-value merge; anchor pairs travel together;
             delete = tombstone (no death mechanic).
  NOTIFICATIONS v1: { ver, settings{position,style,sound,
             volume}, appToggles{}, items[{id,ns,key,deepLink,
             createdAt,firedAt,readAt,sound?,ttl?}], meta{} }.
  SPREADSHEET: cells {"<sid>|<r>|<c>":{v,mtime,f?}} — sparse,
             LWW per cell, shared tombstones; f sub-object
             {b,i,u,al,co,nf} rides whole-cell LWW; sheets
             {id,pos,cw{colIdx:px}} — column widths ride sheet
             LWW. Formula engine: tokenizer → shunting-yard →
             RPN, built from scratch, no external deps.
  RADIO v1:  { ver, favorites[{stationuuid,...,mtime}],
             deleted{} } — union by stationuuid, Dice pattern.
  MINIMALISM: day records + prefs{remindHour} in slice;
             reminder logic lives SHELL-SIDE
             (minimalismCheckTick detector reads the slice
             directly — works even when the app is closed).


╔══════════════════════════════════════════════════════════╗
║  PART V — SYNC + DATA SAFETY ESSENTIALS                   ║
╚══════════════════════════════════════════════════════════╝

SECURITY MODEL (ABSOLUTE):
  · Zero user tracking. Zero-knowledge passphrase (AES-GCM +
    PBKDF2 100k rounds client-side; Dropbox tokens only for
    file I/O via PKCE). Vault: sealed passphrase + IndexedDB
    NON-EXTRACTABLE key, opt-in per device.
  · ALL synced third-party-cloud data MUST be E2EE — never
    plaintext files (standing requirement for ANY future
    provider).

DATA SAFETY SUPREMACY (zero-loss guarantee — every change):
  · SYNC: bidirectional push-pull with deterministic merge.
  · SNAPSHOTS: rolling 5 full-DB auto-snapshots (FIFO on
    oros-auto-snapshots); Restore = picker dialog listing
    ALL snapshots (newest pre-selected).
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
  guarantees live OPFS snapshot before manual exports.


╔══════════════════════════════════════════════════════════╗
║  PART VI — CANONICAL PATTERNS (verbatim contracts)        ║
╚══════════════════════════════════════════════════════════╝

BOOT SEQUENCE (order matters):
  load() → applyI18n() → paintStaticAria/icons → wire() →
  registerSync() → inheritPalette() → watchPalette() → reset
  initial view state → first renders (SINGLE PASS) → consume
  staged deep-link AFTER first paint.

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
  (sync feedback = taskbar dot).

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
  function transientNote(text, actionLabel, actionFn) {
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
  en-fallback. Escape user text via esc() before innerHTML;
  escAttr() for attribute contexts (esc() does NOT neutralize
  quotes — XSS lesson from Writer audit).

DIALOGS: native <dialog>, createElement, showModal(), close
  on outside click + Esc. "close" listeners null-guarded;
  remove the dialog node on close (DOM leak lesson).

TOAST: lazy-created singleton on document.body, top-right,
  text node first, action button second, 5s auto-hide (8s
  minimum when action-bearing/Undo).

FORM REBUILD DISCIPLINE (buildCapture pattern): read previous
  input values + scrollTop BEFORE innerHTML="", rebuild,
  restore — mid-form re-renders never lose drafts.

LABEL_COLORS (8, shared): #e06c75 #ecc75f #87cf3e #4fc4cf
  #6d4aff #e09ecf #f28c5a #9aa4b0


╔══════════════════════════════════════════════════════════╗
║  PART VII — UI STANDARDS                                   ║
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
    right-click context menus; touch targets ≥44px; safe-area
    insets (env()); media queries 480/420/360px.
  DESKTOP: ≥1024px split views allowed.
  AUTOSAVE: debounce, no explicit Save buttons for settings.
  VERSION BADGE: shell version lives in Info modal only.
  BUTTONS: deleting = danger styling; undo via toast action
  (R17 resurrection contract) preferred over confirmations.


╔══════════════════════════════════════════════════════════╗
║  PART VIII — RELEASE PIPELINE + CHECKLISTS                ║
╚══════════════════════════════════════════════════════════╝

PIPELINE (.github/workflows/bump-version.yml v3):
  Triggers on EVERY push to main. Reads APP_VERSION from
  shell.js, stamps sw.js CACHE_VERSION + manifest + ?v= on
  every relative .css/.js in EVERY index.html (directory
  scan — new apps need ZERO config). G2 guard (app folders in
  PRECACHE_URLS), G3 guard (inheritPalette + watchPalette),
  G4 guard (apps.json ↔ app folders). Bot never stages
  untracked files — NEW files must be in the manual commit.

CHECKLIST A — VERSION BUMP: shell.js APP_VERSION (user-owned,
  never assistant-proposed) → push → verify on BOTH devices →
  changelog entry (R21) + Bible registry sync (R22).

CHECKLIST B — NEW APP INTEGRATION (10 items):
  1. <app>/ folder (index.html + css + js)
  2. apps.json entry (+icon key, category)
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
  JS; JSON validation; boot marker matches ?v=; shortcuts
  smoke test in EACH app; notification smoke test (emit →
  toast + badge + inbox; click-through live AND cold start);
  deploy + version check on BOTH devices; PWA update path
  verified on desktop AND mobile; changelog (R21); Bible (R22).

CHECKLIST E — PRE-COMPLETION (per app/wave, R18):
  ☐ Perfect sync: push-pull both directions, no data loss
  ☐ Tombstone resurrection after multi-device delete
  ☐ Offline edits survive reconnect
  ☐ Full local export zero-loss (manual + auto + snapshot)
  ☐ Offline-first verified · ☐ Mobile-first verified
  ☐ Notifications: emit() dedupe across devices; read state
    converges; badge fallback honored

FIVE-AXES COMPLIANCE (application audit doctrine — every app):
  ① Calendar Integration (or documented exemption)
  ② Unified Notifications (transientNote informational;
     emit() reminders; Undo-bearing local)
  ③ Dropbox Sync (5-arg registerSlice + deterministic mergeFn)
  ④ Snapshots (global shell system; no per-app code)
  ⑤ Manual & Auto Export (shell DB export via slice; app-level
     only if an interop format exists, e.g. ICS/vCard/PDF)


╔══════════════════════════════════════════════════════════╗
║  PART IX — AUDIT LEDGER & OPEN ITEMS                      ║
╚══════════════════════════════════════════════════════════╝

OPEN DECISIONS (user response needed):
  ⊗ #21 (To-Do) — priority keywords: implement/strike/defer?
  ⊗ #35 (Kanban) — clean up unused keys + stale comment?
  ⊗ #S5 (Shell) — aurora label: Σέλας or Αυγή?
  ⊗ #19 (To-Do) — undo-across-sync: tackle now or defer?
  ⊗ Radio — DNS/blocking diagnosis pending (fetch de1
    mirror from app console; retry in incognito without
    extensions — de1 opens in a tab but fails from page
    context → suspected adblocker/extension).
  ⊗ Radio — RX-N1..N5 deferred cleanup candidates (favicon
    preloading, shadowing isFavorite, unused wasOffline,
    asymmetric polling, stop/kill switch).

QUEUED (next phase):
  · Screen Pet smoke test (retroactive energy after simulated
    2-day absence; identity merge rename A→B; drag vs click
    threshold; EL/EN speech + HUD; modifier guards).
  · Remaining app audits: Mood (high — deepest model), then
    Weather re-visit, Kanban/Contacts/Notes pattern sweep.
  · Minimalism content expansion: Days 56–105 (Phase 3
    "Depth"), then 106–365 in review batches.
  · Calendar F6 (cosmetic CSS one-liner).
  · Quote Calendar feed (due dates + status changes —
    following Contacts/Cycle pattern).
  · Spreadsheet Wave 4 backlog (extended functions:
    VLOOKUP/INDEX/MATCH/SUMIF/COUNTIF, date/time, text,
    financial; conditional formatting, charts, iterative
    calculation, PDF export, mobile range selection).
  · Cycle cleanup pass (inert .cal-cell/.cal-grid/.cal-wk
    CSS rules; index.html comment "month calendar").
  · registerTrigger API removal from sync.js (dead code —
    verify no consumers before final delete).

CLOSED INCIDENTS (lessons, do not re-chase):
  · Duplicate seeds on new device (Notes/To-Do/Kanban) —
    deterministic seed IDs fixed (R16).
  · Calendar feed blackout on new device — feed cache
    invalidation in setFromSync() fixed.
  · Contacts wipe — empty-blob guard in collectPayload()
    fixed; recovered from .vcf backup.
  · window.t is not a function shell crash — transient
    partial-bundle boot; TP-guards in applyLang/setSyncDot/
    autoSyncDot make it non-fatal. Tripwire snippet
    (Object.defineProperty on window.t) recorded.
  · "Banner not shown: beforeinstallpromptevent.
    preventDefault() called" — expected by design (shell
    keeps deferredPrompt for the menu Install button).
  · Kanban legacy board mumfy266amf80 — pre-patch duplicate,
    requires manual deletion to propagate tombstone.
  · Radio FIX-RX series — applyMediaSession undefined
    (playback blocker), honest catalog banner (showCatalog/
    hideCatalog in rbRequest), dead state.offline flag
    removed (permanently poisoned future API calls).
  · Fix diagnostic gotcha: [id*="sync-dot"] matched the parent
    button, not the child span #sync-dot.

DOCTRINAL EXEMPTIONS RECORDED:
  · Bookmarks/Files/Characters/Storage/Spreadsheet/Dice/
    Screen Pet/Minimalism — Calendar-axis exempt
    (non-time-bound apps).
  · Dice & Coin, Screen Pet, Minimalism — Notifications-exempt
    or shell-side detectors (no app-frame emitters).
  · Screen Pet — NOT an apps.json app: root-level shell
    component; menu toggle device-local (oros-pet-enabled).
  · Radio — Calendar-exempt (non-time-bound); Notifications-
    exempt (transient feedback only — Dice pattern).
  · version drift observations — OUT OF AUDIT SCOPE (R23).
  · Kanban KN-Q1 — wall-clock tombstone pruning accepted as
    known deviation (revisit only if phantom-push appears).
  · Storage/Quote — deterministic sliceGet pruning mandatory
    (both adopted).

BACKLOG (long-term, not scheduled):
  CORE/SYNC: unified shell toast API absorption ·
    hierarchical key rotation · cross-device passphrase-change
    notification · additional cloud providers (E2EE
    mandatory) · per-entry file sync for OrosFS.
  NOTIFICATIONS: quiet hours UI · alarms presentation
    routing · Todo/Habits/Kanban calendar feeds.
  APPS: Kanban board color headers; Notes fuzzy backlinks;
    Weather radar/per-hour graph; Quote CSV export; Prompter
    sprint timer; Storage Restock Center; Habits weekly
    targets; Files drag-drop import + batch ops; Contacts
    X-RELATED export; Cycle symptom trends; Bookmarks link
    health checker + fuzzy dupe matching + bulk tag ops;
    Spreadsheet Wave 4 items; Minimalism Calendar feed
    visualization + Revisit mode.
  NEW APPS: Pad (Notepad++-style) · Pagination/typesetting ·
    Public Domain Calculator · Desk suite · native
    Windows/Android conversions (decision pending flawless
    PWA validation).


╔══════════════════════════════════════════════════════════╗
║  PART X — SESSION HANDOFF TEMPLATE                        ║
╚══════════════════════════════════════════════════════════╝

Copy into a new chat's first message:

  "Continuing orOS work. OROS_BIBLE.md is the SINGLE SOURCE
   OF TRUTH. Read Parts I–X fully before touching anything —
   Part IX has the open items. Current state: kernel LOCKED;
   app audits five-axes doctrine active. Next task: <task>.
   Apps involved: <dirs>. I will paste any file you
   explicitly request — request files only when the LIVE code
   state of a specific function matters."


╔══════════════════════════════════════════════════════════╗
║  PART XI — CHANGELOG                                       ║
╚══════════════════════════════════════════════════════════╝

Full changelog history lives in CHANGELOG.md (ascending,
newest at bottom). This file records INDEX ENTRIES ONLY:

  2025-08 → 2026-09: kernel lock, sync v0.9.2, FS, unified
    notifications, 20 apps audited/verified (see CHANGELOG.md).
  2026-09-27: Spreadsheet Waves 1–3 + Five-Axes verified.
  2026-09-29: Dice & Coin v0.4 (first Soffitta port).
  2026-09-30: Screen Pet v0.1–v0.3.1 (second Soffitta port,
    shell component). Writer Wave 5 I/O complete + audit
    fixes. Cycle Timeline rewrite + DST hardening + unified
    notification migration. Radio Waves 1–3 (shell-hosted
    audio, discovery, mirror fallback) + FIX-RX hotfix
    series. Minimalism Wave 1–2 + content Days 1–55.
    Dice v0.38.00 feature wave. Screen Pet calendar feed.
    Cycle v0.37.05 (back-to-today, date picker sync,
    insights trend strip).

═══════════════════════════════════════════════════════════

Screen Pet — HUD minimize toggle (collapse to name-only view)
Context: User requested the ability to minimize the pet's control panel (HUD) to free up screen space. The pet's HUD contains stats bars (food, happy, energy), palette picker, and action buttons (feed, sleep, new pet, catch, activity log). In collapsed/minimized mode, only the name row (name + rename button) remains visible, reducing the HUD footprint significantly.

Changes:

Minimize button: Added ◀ ▶ toggle button to the left of the pet's name in the HUD row. Button text flips based on state (◀ = collapse, ▶ = expand). Tooltip shows "Ελαχιστοποίηση"/"Minimize" or "Ανάπτυξη"/"Expand" depending on current state.
Collapsed state persistence: Device-local localStorage key oros-pet-minimized stores the user's preference (never synced across devices). On petEnable(), the class pet-hud-collapsed is reapplied if the flag was set.
DOM hide/show logic: Inside refreshHUD(), the collapsed state determines visibility of dependent sections: age line, palette swatches, all three stat bars (food/happy/energy), and all action button groups. All are display: none when collapsed; shown normally when expanded.
CSS scoping: New .pet-hud-collapsed class added with child selectors targeting the specific sections to hide (#pet-hud-age, #pet-palettes, .pet-stat, .pet-hud-actions). Smooth transition on height/padding for visual polish.
Touch interaction guard: Minimize button click routes through touchInteraction() (breaks contemplation, resets the 5-minute idle clock).
Verified against delivered code: All 5 patches delivered as plain fenced blocks (no OLD/NEW markers inside), copy-paste ready. Implementation follows Bible Part VI patterns (localStorage for device-local prefs, refreshHUD() as single source of truth for UI state).

Next steps: Pending Screen Pet smoke test (collapsing, persisting state across refresh, correct button icon flip). No version bump (versioning user-owned per R23).

---

pet.js — Event log full sync (ακολούθημα Wave 5b)

New sync slice "petEvents" (key oros-pet-events, merge = union by id + clearedAt wipe propagation). The pet entity slice ("pet") was already synced — only the log was device-local. calendar.js untouched: it reads the same key.
logEvent marks the slice dirty via the existing __orosPetSyncApi funnel (debounced push ~5s).
Birthday events use a deterministic id (bday-<petId>-<ymd>), so two devices logging the same anniversary collapse to one row in log and calendar feed.
window.orosPet.clearLog now writes a {clearedAt} wipe tombstone instead of removing the key; the wipe propagates to all devices through the merge.
Manual export/import: both pet slices ride orosSync.exportData()/importData() — no shell change needed for manual flows.
Mixed versions: older pet.js installs relay the unknown "petEvents" slice via the carry mailbox (sync.js v0.9.2) — no data loss.
No schema change (ver stays 1); existing local logs merge on first push. No manual version bump (GitHub Action owns versions).

---

2026-09-30 — Calculator v0.1.0 (third Soffitta port; inverted concept: standard calculator + optional Troll mode)

Ported the Soffitta Prank Calculator to orOS as a fully standard calculator with an optional troll mode (toggle in-app). Changes:

New app folder calculator/ (index.html, calculator.css, calculator.js) following orOS boot pattern (IIFE, SCRIPT_V boot marker, single-pass first render, wireUI before any apply*).
Class namespace: all Soffitta classes renamed calc-* (calc-pad, calc-display, calc-face, calc-switch, calc-knob, calc-skin-dot, calc-hist-*) to avoid collisions with shell/other apps.
Schema: oros-calculator-data = { ver:1, hist[{id,e,v,f,mtime}], tombs{}, skin, troll, sound, sm{skin,troll,sound} }. Per user decision ALL state syncs (hist + skin + troll + sound). Scalar prefs merge via per-field LWW with sm timestamps (Screen Pet fm pattern); lexicographic value tie-break (R5).
Hist entities carry id/mtime; mergeFn = symmetric union by id, mtime → lexicographic JSON tie-break; tombstones max-ts union, delete-wins-ties (R17). HIST_MAX=20 enforced with tombstoned trims (no resurrection). Strict sanitizer drops invalid rows.
sliceSet suppresses dirty (R6); registerSync() actually invoked in load() (was defined-but-never-called in first draft — caught in re-audit).
Language and theme are shell-owned: applyTheme() deleted, langBtn/themeBtn removed from UI, applyLang reads oros.lang and listens to storage events instead of writing them. skin-dark adapts to shell theme via --bg luminance sniff.
R14: resetAll() uses themed <dialog> with outside-click + Esc close and node removal (native confirm() removed). Reset history uses tombstones (R17).
CSV export of history (interop format per Five-Axes axis 5); download via Blob + revokeObjectURL.
Kept: 5 skins (neko/dog/alien/robot/duck) with full WebAudio voices (no stubs), typewriter quips, truth-reveal 1/15, share-prank clipboard with fallback, reduced-motion support, scrollbar + hidden-guard CSS rules, mobile breakpoints 480/420/360.
Deleted dead code: PREFS_KEY (state now single synced slice), evalCache, unused var in flashToast.
Exemptions recorded: Calendar-axis (non-time-bound), unified Notifications (Dice pattern — transient feedback only), palette G3 (independent playful skins by design).
Next: registry integration (apps.json, shell.js ICONS + SC_DEFS Ctrl+Alt+Shift+C, translations.js app.calculator + category strings, sw.js PRECACHE_URLS — G2/G4 will validate), then pre-flight Checklist D on both devices. No version bump (R23).

📖 Bible registry update (για προσάρτηση στο Part III table + Part VIII exemptions)
Row for Part III table:

Calculator | oros-calculator-data | entity LWW (hist) + sm field-LWW (prefs) + tombs | Ported, pending registry + pre-flight

Part VIII exemptions:

Calculator — Calendar-axis exempt (non-time-bound); Notifications-exempt (transient feedback only, Dice pattern); G3 palette exemption (independent playful skins by design, Screen Pet precedent).

---

## v0.38.10 — 30 Sep 2026

### Fixes
- **Radio sync (shell-side proxy)**: Added `radio` slice registration to `orOS.sync` engine in `shell.js`. Favorites now synchronize across devices even when the Radio iframe is closed. The proxy uses `oros-radio-data` localStorage key and mirrors the same contract as `files-disk` and `shell` slices.

### Architecture
- New `radioProxySliceGet()` and `radioProxySliceSet()` functions in `shell.js`
- New `registerRadioProxySlice()` called from `initSyncIntegration()`
- Radio iframe's live registration overrides the proxy when open (merge-capable); proxy re-activates when iframe closes (LWW semantics)

### Files Modified
- `shell.js`: Added radio proxy slice (lines ~1798–1840)

---

pet.js — Full sync completion wave (v0.3.2 final)

SUMMARY The Screen Pet now syncs completely across devices. Three synced slices carry everything that travels; device-local ergonomics stay local. Auto snapshots, manual export/import, and cloud push/pull all cover the pet (verified: all channels enumerate registered slices via orosSync.collectPayload/applyPayload).

SYNCED SLICES

"pet" (oros-pet-data) — entity: name, palette, birthTs, temporal stats, energy anchors. Merge: per-field LWW (temporal fields are their own clocks; anchor pairs travel together; fm map for name/palette; tombstones).
"petEvents" (oros-pet-events) — event log. Merge: union by event id, deterministic sort by (ts, id), rolling trim to 100. Birthday events use a deterministic id (bday-<petId>-<ymd>) so two devices logging the same anniversary collapse to one row. clearLog writes a {clearedAt} tombstone — the wipe propagates deterministically to all devices.
"petSettings" (oros-pet-settings) — calendar feed toggle. Merge: per-field LWW via calFeedTs.
BUGS FIXED THIS WAVE

setCalendarFeed did not mark the slice dirty (settingsSliceSet suppresses dirty during its own write) — the toggle could travel only with the next unrelated write, or never. Now armed explicitly after the write.
Legacy migration ran before registerSync(), so a migrated pre-0.3.2 opt-out was never pushed. bootLegacyDirty now arms the first push right after registerSync().
settingsSliceSet now maintains a legacy mirror key (oros-pet-calendar-sync) in lock-step with oros-pet-settings, because unmodified calendar.js still reads the legacy key at render time. oros-pet-settings remains the single source of truth; the legacy key is a derived read-only view.
LEGACY MIGRATION

One-time at boot: if oros-pet-settings is absent and the legacy key exists, the legacy value migrates in (calFeedTs=1 — beats epoch-0 default, loses to any real write). The legacy key is NOT deleted; it survives as the mirror.
Old event log data (v0.3 device-local format) merges on first push — no data loss, no schema bump (ver stays 1).
DEVICE-LOCAL (by design, never synced, not exported to cloud)

oros-pet-enabled (presence per device)
oros-pet-minimized (HUD collapse per device)
oros-pet-pos (normalized screen position)
runtime choreography (position, facing, frame, walk decisions, ball, contemplation)
MIXED VERSIONS

Older pet.js installs relay the unknown "petEvents"/"petSettings" slices via the sync.js carry mailbox (requires sync.js >= 0.9.2). No data loss, no shell.js change.
FILES TOUCHED

pet.js only. calendar.js untouched (reads the same keys as before). shell.js untouched (export/push channels enumerate slices generically).
KNOWN COSMETICS (deferred, no functional weight)

Section 2b-3 functions sit at zero indentation.
Header Wave 5b comment lost the word "Calendar" before "deep-link" (fix available, one line).

---

orOS Calculator — Changelog
v1.1.0 — Feature wave 1 (Troll mode, history sync, extras)
Application: Calculator (full rewrite from scratch, replaces broken v1.0.0 that failed CI on missing theme inheritance).

Architecture
Full rewrite: calculator.html, calculator.css, calculator.js. Version string: CALC_VER "1.1.0".
Palette bridge: canonical mood.js pattern — inheritPalette() copies shell CSS variables (--bg, --text, --accent, ...) from parent documentElement before first paint; watchPalette() MutationObserver re-applies on skin/theme change. CI requirement satisfied.
Sync slice: registered as "calculator" via parent orosSync.registerSlice(get, set, LS_KEY) with cache key oros-calculator-data. Zero shell-side changes (export funnel consumes the slice).
Shortcut forwarding (Contract B): Ctrl+Alt+Shift combos forwarded to parent orosShortcuts.handle() in capture phase.
i18n: EN/EL lazy packs (normal + separate troll string pack). Language resolution: localStorage["oros-lang"] first (shell doctrine for iframe apps — initPrefs writes it on boot and toggle; shell reopens iframe on language change), parent window.orosLang as same-origin fallback, "en" default.
Features
Troll mode: teasing language ALWAYS (snark even when the result is correct); plausible lies sized by intensity, never two consecutive lies.
Troll intensity, 3 levels: Subtle ~16%, Balanced ~34% (default), Rampant ~66% lie probability. Persisted in slice (trollIntensity).
Intensity controls: right-click (contextmenu) on the Troll toggle cycles levels; touch devices use long-press (500ms, touchmove cancels; trailing click swallowed; mobile contextmenu double-fire guarded by touchActive). Visible feedback: dots ●○○ / ●●○ / ●●● next to the toggle (shown only while troll is on) + toast with level name.
Synchronized history: cap 50 entries, LWW merge per entry by timestamp, tombstone map (deleted id → ts) survives merge and travels via sync. Clear = tombstone all.
History reuse: click an entry loads its result (fresh replace, not append).
Copy-to-clipboard: click the result display; clipboard API with legacy execCommand fallback.
Ans key: recalls last valid answer (key A). Skips "Error" results — lastAnswer never holds "Error".
Single-level undo: Ctrl+Z. Snapshot before every mutating press; no-op presses drop the snapshot.
Negative-result feedback: history entries with negative results get danger tint (.neg class).
Drag-resizable history panel on ≥880px: side-docked, 200–500px, width persisted in slice (panelWidth). Handle hit-test by distance from panel edge (::before sits outside border box).
Full-width desktop layout; mobile-first stacked layout below 880px.
Full keyboard support: digits, . / , → decimal, + − * /, Enter/=, Backspace, Escape/Delete → AC, %, A → Ans, Ctrl+Z → undo.
Unified notifications: transientNote() routes to parent orosNotifs.transient (ns "calculator") with console fallback standalone. No inbox entries — no reminders in this app.
Bugs fixed (vs. v1.0.0 draft)
renderError() was called but never defined (latent ReferenceError on chained divide-by-zero) — now defined: surfaces "Error" cleanly, resets engine state.
pressAns() set fresh=false → recalling Ans then typing a digit appended to it (Ans 42 then 5 → "425"). Fixed: fresh=true (same semantics as reuseHistory).
pressEq() wrote "Error" into lastAnswer — Ans could then recall the literal string "Error" as an operand. Fixed: lastAnswer only updates on non-error results.
lang() read window.orosLang which never exists in the iframe context (shell writes it on its own window). Fixed per shell doctrine: read localStorage["oros-lang"].
Removed dead code: stagePendingRemote()/takePendingRemote()/REMOTE_PENDING_KEY — no callers existed; remote arrivals arrive via the registered slice, never the hack key.
EL pack: "calc.key.back" mistranslated as "Πάτημα" — now "Διαγραφή".
Back button (⌫) carried data-i18n, which overwrote the glyph with the word "Backspace"/"Διαραφή". Fixed: glyph stays on screen, label provided via translated aria-label.
Known non-issues (left as-is)
state.lang field is dead (t() reads lang() live) — harmless, kept.
Indentation drift on pressAns declaration (4 spaces) — cosmetic only.
Features under consideration for future waves: CSV export of history, memory keys (M+, MR), scientific functions.
Pre-deploy checklist (unchanged, for reference)
Files: calculator.html (this repo: index for the app folder), calculator.css, calculator.js.
No shell.js / manifest / service-worker changes required — app integrates via slice registration, palette bridge, and existing export funnel.
Verify boot log: [calc] calculator v1.1.0 booted — troll:off intensity:1 history:N
Verify EL: header/buttons render Greek when shell language is EL.

---

orOS Calculator — Changelog
v1.1.0 — Feature wave 1 (Troll mode, history sync, extras)
Full rewrite from scratch, replacing the broken v1.0.0 that failed CI on missing theme inheritance.

Architecture
Files: index.html (app), calculator.css, calculator.js. Version string: CALC_VER "1.1.0". Assets served cache-busted (?v=0.38.x) by the standard GitHub Action pipeline.
Palette bridge: canonical mood.js pattern — inheritPalette() copies shell CSS variables (--bg, --text, --accent, ...) from the parent documentElement before first paint; watchPalette() MutationObserver re-applies on skin/theme change. CI requirement satisfied.
Sync slice: registered as "calculator" via parent orosSync.registerSlice(get, set, LS_KEY) with cache key oros-calculator-data. Zero shell-side changes — the export funnel consumes the slice.
Shortcut forwarding (Contract B): Ctrl+Alt+Shift combos forwarded to parent orosShortcuts.handle() in capture phase.
i18n: EN/EL lazy packs (normal + separate troll string pack). Language resolution per shell doctrine: localStorage["oros-lang"] first (initPrefs writes it on boot and toggle; shell reopens the iframe on language change), parent window.orosLang as same-origin fallback, "en" default.
Features
Troll mode: teasing language ALWAYS (snark even when the result is correct); plausible lies sized by intensity, never two consecutive lies.
Troll intensity, 3 levels: Subtle ~16%, Balanced ~34% (default), Rampant ~66% lie probability. Persisted in the slice (trollIntensity).
Intensity controls: right-click (contextmenu) on the Troll toggle cycles levels on desktop; touch devices use long-press (500ms) — touchmove cancels the hold, the trailing click is swallowed so the toggle does not also flip, and mobile contextmenu double-fire is guarded by a touchActive flag.
Visible intensity indicator: dots ●○○ / ●●○ / ●●● inside the toggle (shown only while troll is on) + toast with the level name.
Synchronized history: cap 50 entries, LWW merge per entry by timestamp, tombstone map (deleted id → ts) survives merge and travels via sync. Clear = tombstone all.
History reuse: clicking an entry loads its result (fresh replace, not append).
Copy-to-clipboard: click the result display; clipboard API with legacy execCommand fallback.
Ans key: recalls last valid answer (key A). Never holds "Error".
Single-level undo: Ctrl+Z. Snapshot before every mutating press; no-op presses drop the snapshot.
Negative-result feedback: history entries with negative results get a danger tint (.neg class).
Drag-resizable history panel on ≥880px: side-docked, 200–500px, width persisted in the slice (panelWidth). Handle hit-test by distance from the panel edge.
Full-width desktop layout; mobile-first stacked layout below 880px.
Full keyboard support: digits, . / , → decimal, + − * /, Enter/=, Backspace, Escape/Delete → AC, %, A → Ans, Ctrl+Z → undo.
Bugs fixed (vs. the v1.0.0 draft)
renderError() was called but never defined (latent ReferenceError on chained divide-by-zero) — now defined; surfaces "Error" cleanly and resets engine state.
pressAns() set fresh=false → recalling Ans then typing a digit appended to it (Ans 42 then 5 → "425"). Fixed: fresh=true, same semantics as reuseHistory().
pressEq() wrote "Error" into lastAnswer — Ans could then recall the literal string "Error" as an operand. Fixed: lastAnswer only updates on non-error results.
lang() read window.orosLang, which never exists inside the iframe (the shell writes it on its own window). Fixed per shell doctrine: read localStorage["oros-lang"].
Dead code removed: stagePendingRemote() / takePendingRemote() / REMOTE_PENDING_KEY — no callers existed; remote arrivals travel via the registered slice.
EL pack: "calc.key.back" mistranslated as "Πάτημα" → now "Διαγραφή".
Back button (⌫) carried data-i18n, which replaced the glyph with the word "Backspace"/"Διαγραφή". Fixed: glyph stays on screen; label provided via a translated aria-label set in wireUI().
Duplicate aria-label assignment for the ⌫ key (artifact of the wave patches) — deduplicated to a single occurrence.
Known non-issues (left as-is)
state.lang field is dead (t() reads lang() live) — harmless, kept.
Indentation drift on the pressAns declaration (4 spaces) — cosmetic only.
Under consideration for future waves
CSV export of history.
Memory keys (M+, MR).
Scientific functions.
Pre-deploy checklist
No shell.js / manifest / service-worker changes required — the app integrates via slice registration, palette bridge, and the existing export funnel.
Verify boot log: [calc] calculator v1.1.0 booted — troll:off intensity:1 history:N
Verify EL mode: header, buttons and toggle render Greek when the shell language is EL.
Verify desktop: right-click on the Troll toggle cycles intensity; dots update.
Verify mobile: long-press (500ms) on the toggle cycles intensity without flipping On/Off.