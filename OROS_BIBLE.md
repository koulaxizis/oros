# orOS BIBLE — Assistant Reference Edition

> Single source of truth for the orOS project. Maintained by the assistant (owner-approved: "this file is yours").
>
> - **Live:** https://useoros.online · **Repo:** github.com/koulaxizis/oros
> - **Author:** Christos Koulaxizis · koulaxizis.gr
> - **Tagline:** "A static operating system in your browser"
> - **Last full revision:** 2026-10-01. Files re-read for this revision: `shell.js` (APP_VERSION 0.38.12 era), `sync.js` v0.9.2, `notifications.js`, `sw.js`, `apps.json`, `writer/*`. Everything else is carried forward from earlier revisions and marked as such where it matters.
> - **This file also IS the project changelog** (Part XII). `CHANGELOG.md` was retired and consolidated here.

## Map

| Part | Content |
|---|---|
| 0 | Working agreement + session-start protocol (read first) |
| I | Mantra + standing rules R1–R30 |
| II | Core architecture (verified facts) |
| III | App registry (status, keys, merge types) + device-local keys + file tree |
| IV | Data models |
| V | Sync & data-safety essentials |
| VI | Canonical code patterns (verbatim contracts) |
| VII | UI standards |
| VIII | Release pipeline, checklists, runtime test harness |
| IX | Decisions log + doctrinal exemptions |
| X | Open items, audit queue, lessons (closed incidents) |
| XI | Session handoff template |
| XII | Changelog (the only one — `CHANGELOG.md` is retired) |

---

## Part 0 — Working agreement (read first, every session)

### How we work

- **Christos owns the product.** He decides features and priorities. When he says "αποφάσισε εσύ" (you decide), I decide, implement, and **log the decision with its reason in Part IX in the same response**.
- **Language.** Christos writes Greek → I answer in Greek. Code, comments and this Bible (changelog included) stay in English. EL UI strings are natural Greek, never word-for-word.
- **Delivery mode.**
  - Default: surgical patches in the mandatory format (Part I §3).
  - Full files when Christos asks, or when a fix set is large (rule of thumb: ≥10 patch blocks or many functions). He prefers full files for big audits.
  - Preserve the original line endings of every file (the Writer files are CRLF).
- **Every delivery ends with:**
  1. what changed and why;
  2. how it was verified, with honest counts;
  3. post-deploy checks for BOTH devices;
  4. a changelog entry appended to Part XII (R21);
  5. the Bible delta (R22).
- **Honesty about state.** Always separate *verified in a browser* / *verified by reading* / *assumed*. Never call untested behavior "tested". If I run out of room or tools mid-task, say exactly what is done and what is not, and do not hand over half-verified files as final.
- **Missing file → ask.** Never reason about the inside of a file that is not on the table (Part I §3).
- **Versions are his** (R23). I never propose, bump or "fix" version numbers, `?v=` stamps or CACHE_VERSION.

### Session-start protocol

1. Read Part 0, Part I and Part X (open items).
2. List the files the task touches and **request their CURRENT versions** (R11). Remembered intermediate states are stale by definition.
3. Before patching, check the relevant contracts in Parts II and VI against the actual files. The Bible has been wrong before; see the `__orosNotify` incident in Part X.
4. For anything non-trivial, rebuild the runtime harness (Part VIII §F) and run it before delivering.

---

## Part I — Mantra + standing rules

### 1. Mantra (design contract — never violate)

Offline first · Mobile first · No external dependencies · Full project manual export · Full project automatic export · Full project snapshots · Full project auto-merge sync · **No guessing:** if unsure, ASK; if a file is missing, REQUEST it.

### 2. Standing rules

Rule numbers are stable; R2 and R13 are retired (never reuse numbers).

**Delivery & patching**

| # | Rule |
|---|---|
| R1 | No wholesale regeneration for fixes. Surgical patches (OLD + NEW + anchor). Exception: large multi-edit sets or user-requested restructures ship as FULL files (numbered parts if needed to avoid truncation). |
| R3 | Verify the running version first (Info modal + boot marker in console) on BOTH devices before diagnosing. |
| R4 | Before chaining a patch on top of a previous one, confirm the previous one was applied. |
| R11 | Patch against the user's CURRENT files, never against remembered states. |
| R19 | Validation: the user may paste delivered code back for confirmation before committing. |
| R21 | Changelog discipline: every significant change appends an entry at the END of Part XII of this Bible in the SAME response (format rules at the top of Part XII). There is no separate CHANGELOG.md. |
| R22 | Bible currency: every significant decision updates the affected Bible parts in the SAME response. An unlogged decision did not happen. |
| R23 | Versioning is user-owned (`APP_VERSION`, `?v=`, `CACHE_VERSION`, manifest). Audits never propose or "fix" versions. |

**Merge & sync doctrine**

| # | Rule |
|---|---|
| R5 | Merges are symmetric: `merge(A,B) === merge(B,A)`. Tie-break: mtime → lexicographic JSON/id. Never "local wins" or "remote wins". |
| R6 | Pull-fed slice setters never call `markDirty` (the user's own pending edits may still be pushed through the normal save path). |
| R8 | **Iframe context.** An app frame's own `window` has NO shell globals. Read every shell API from the parent, guarded: `orosSync`, `orosNotifs`, `orosShortcuts`, `orosAlarms`. Language: `localStorage["oros-lang"]` (written by the shell on boot and toggle) or `window.parent.orosLang`; the shell reopens apps on language change. Calculator and Writer both shipped with this bug. |
| R17 | Tombstones: max-ts union; delete wins ties; a newer edit resurrects (fresh mtime beats tombstone). Factory reset tombstones everything that ever lived and rebirths seeds with fresh mtimes. |
| R26 | **Canonical slices.** The engine compares `JSON.stringify` strings. `get()` must be canonical and idempotent: `JSON(merge(get(), get())) === JSON(get())`, and after `set(merged)`, `get() === merged`. Sort entity arrays by id; dedupe and sort tombstones; never put device-varying data in a synced slice. Violating this causes endless set+push ping-pong between devices (Writer, 2026-10-01). |
| R27 | **mtime moves only on a real change.** Never stamp mtime inside a generic save/flush. Stamp at the mutation site (`markDoc(doc)` pattern). Flush-stamping lets a stale copy win LWW over another device's real edit. |

**UI & code conventions**

| # | Rule |
|---|---|
| R7 | `renderAll()` re-syncs ALL DOM controls after state changes. |
| R9 | i18n keys match `data-i18n` attributes exactly. HTML ships icon buttons EMPTY; JS injects SVGs. |
| R10 | Floating/transient views are session-only. Exception: per-device view state such as open tabs may live in a `*-prefs` device-local key. |
| R12 | Shortcuts: Ctrl+Alt+Shift+letter, matched via `e.code` (layout-agnostic; `e.key` is "σ" under the Greek layout). Alt+Shift and Ctrl+Shift+* are dead. `SC_DEFS` in `shell.js` is the single source. |
| R14 | Native dialogs retired: no `alert`/`confirm`/`prompt`. Use themed dialogs (`wConfirm`/`wPrompt` pattern) and Undo toasts. |
| R15 | Bilingual seeds store `{en, el}`; display uses the active language; a hand-rename kills bilinguality. |
| R16 | Deterministic seed ids: two fresh installs must not union into duplicate seeds. Lazy materialization (create on first real use) is the alternative when no seed is needed. |
| R28 | **No silent no-ops.** A user action never silently returns (no open entity, no selection, blank state). Either materialize lazily (`ensureDoc()` pattern) or explain via toast or disabled control + hint. |

**Quality gates**

| # | Rule |
|---|---|
| R18 | Pre-completion per app: perfect sync, zero-loss export, offline-first, mobile-first. All four before "done". |
| R20 | `?v=` refs are fully automated by the CI bot from `APP_VERSION`. |
| R29 | **Runtime-verified delivery.** Non-trivial deliveries are exercised in a real browser before handoff (Part VIII §F), including the REAL `sync.js` and a two-context convergence test. Static review alone missed 7 Writer bugs that the harness caught. |
| R30 | **Shared quota.** All apps share ONE origin `localStorage` (~5 MB). Bound blob-like data (images downscaled; version history budgeted). Never swallow a failed write: surface it once with a toast. |

**Notification system**

| # | Rule |
|---|---|
| R24 | Reminders route through `window.parent.orosNotifs.emit(cand)`. Informational feedback uses `.transient(cand)`. Deep links use `"ns:payload"` and resolve via `DL_BRIDGES` → shell `window.__orosOpen<App>`. Keep the legacy local-alert fallback while stale caches can exist. |
| R25 | Badge fallback: unread items >24h old fire badge-only (no toast re-fire); the catch-up loop stamps `firedAt`. |

### 3. Anti-hallucination protocol (mandatory)

- **Standing rule:** «Ποτέ συμπεράσματα για το εσωτερικό ενός αρχείου που δεν είναι στο τραπέζι.»
- **Deep-link mismatches:** read the receiver function IN FULL in the app file AND the bridge IN FULL in `shell.js`/`notifications.js` before diagnosing.
- **Contracts quoted in this Bible are claims, not facts,** until checked against the current file. Part VI marks what was re-verified.
- **Patch delivery format:**
  - Header line: `PATCH X/N — description + location (file + function/section)`.
  - OLD block: byte-exact current code, findable with exactly ONE match.
  - NEW block: in a SEPARATE fenced block right after. Never mix OLD and NEW in one block; never deliver unfenced code.
  - Verify every OLD block exists in the current file before delivery; if one doesn't, STOP and request the file.
  - Apply in order 1 → N. The assistant's harness can check uniqueness and apply all patches to a copy, then run `node --check`; do it.

---

## Part II — Core architecture (verified 2026-10-01 unless noted)

### Script order (shell `index.html`, classic scripts)

`translations.js` → `sync.js` → `fs.js` → `shell.js` → `notifications.js`. `translations.js` stays synchronous at top level and contains ONLY shell-consumed keys (`app.<id>`, `category.*`). App strings live in each app's inline `STRINGS`.

### Shell-window globals (an app reads them via `window.parent`, R8)

| Global | Source | Notes |
|---|---|---|
| `orosSync` | sync.js | `registerSlice`, `markDirty`, `exportData`, `importData`, `reconcile`, `pull`, `push`, `isDirty`, `onAutoSync`, `kickAutoEngine`, passphrase/vault API |
| `orosNotifs` | notifications.js | `emit`, `transient`, `getAppToggle`/`setAppToggle`, `getKnownApps`, `markAsRead`, `updateBadge`, `openNotificationPanel` |
| `orosShortcuts` | shell.js | `handle(e)` → boolean; yields when the target is contentEditable/input |
| `orosLang` | shell.js | shell window ONLY; also mirrored to `localStorage["oros-lang"]` |
| `orosAlarms` | shell.js | alarms survive iframe close |
| `orosFS` | fs.js | `/internal` mount; OPFS primary, IndexedDB "oros-ofs" fallback |
| `orosPet` | pet.js | screen pet component |
| `__orosOpen<App>` | shell.js | deep-link bridges (`__orosOpenContact`, `…Cycle`, `…Mood`, `…Calendar`, `…Time`, `…Todo`, `…Habits`, `…Weather`, `…Quote`, `…Minimalism`) |

**There is NO `window.__orosNotify`** in shell.js or notifications.js (0.38.12). Older Bible text used it; see the Part X audit item.

### `shell.js`

- IIFE + `"use strict"` in every JS file. `APP_VERSION` lives here only (manual, user-owned).
- **Offline honesty:** never fake data when offline (say it, show cached-with-age, or show nothing).
- **Battery:** no idle timers. Throttled engine ticks piggyback on `renderClock` (1s). An unguarded throw in any callee kills the chain, so new ticks MUST guard missing modules (`window.t`, `orosNotifs`, `orosSync`).
- **Subsystems:**
  - toasts and sync dot: `scToast` §9, sync dot §9b;
  - `SC_DEFS` §9c;
  - weather widget §9d (Open-Meteo);
  - alarms §9e, calendar reminder engine §9e2, notification engine §9e3;
  - files-disk glue §9f;
  - screen pet §9h;
  - radio bridge + tray tick §9i.
- **Shell-side proxy slices:** `shell`, `files-disk`, `radio` (`registerRadioProxySlice`, v0.38.10 — favorites sync while Radio is closed; the live iframe registration overrides it while open).
- **`notifySys(kind, text, ident)`:** `dim` → `transient({ns:"system"})`; `ok`/`err` → `emit({ns:"system", type:"sys"})`.
- REQUEST `shell.js` whenever a fix needs an exact current function.

### `sync.js` v0.9.2

- Deterministic symmetric merges (R5), tombstones (R17). Zero-knowledge passphrase, AES-GCM E2EE, PKCE OAuth (Dropbox).
- **`registerSlice(name, get, set, storageKey?, mergeFn?)`:**
  - The `name → storageKey` registry persists in `oros-slices`. Future boots hydrate **mergeless proxies** that read/write the storage key while the app is closed.
  - **WITHOUT `mergeFn` a slice is mergeless:** the divergence guard parks remote data, and concurrent two-device edits lose one side. Always pass `mergeFn`.
- **`applySlice`:** `merged = merge(clone(local), clone(remote))`.
  - `changed = JSON(merged) !== JSON(local)` → `set(merged, {merged:true})`.
  - `cloudStale = JSON(merged) !== JSON(remote)` → `markDirty` → push.
  - Hence R26.
- **Carry mailbox:** unknown remote slices are held and pushed forward, so a device never wipes data of an app it doesn't know.
- **`collectPayload()` / `applyPayload()`** is the single funnel for cloud sync, manual export (`exportData`), import (`importData`, merge-aware) and auto-snapshots.
- **`reconcile(reason)` triggers:** boot / interval / visible / online / register / debounce.
- **Empty cloud:** `contentDownload` 409 means "empty cloud"; callers branch on `res.status === 409`.
- **Accepted limit:** two offline devices with apps closed converge only via a live open.

### `notifications.js`

- **`emit(cand)`:**
  - Fields: `ns`, `title` (required), `body`, `key` (stable dedupe: `ns:key`), `type` (default `reminder`), `deepLink`, `ttlDays` (default 7).
  - Returns `null` when not ready, disabled, or the app toggle is off.
  - **No `sound` field** in the 0.38.12 code.
- **`transient(cand)`:** `title` required; bypasses app toggles; optional `action:{label, fn}` (in-memory closure, never serialized).
- **`getAppToggle(ns)` defaults to `true`** for unknown namespaces. Apps not in `KNOWN_APPS` can emit but have no toggle in the settings UI.
- **`KNOWN_APPS` (verified 0.38.12):** calendar, cycle, mood, todo, habits, time, system, weather, notes, quote, contacts, files, kanban, prompter, storage, spreadsheet, minimalism. (The previous Bible also listed dice — not in the code.)
- **`DL_BRIDGES` keys:** contacts, cycle, mood, calendar (`evId, ymd`), time (pane), todo (listId), habits (offset), weather, quote, minimalism (ymd). All `typeof`-guarded.
- **Slice `oros-notifs`:** 7-day TTL, 300-item cap, per-field LWW (`readAt` non-null beats null, `firedAt` max, `createdAt` min). Quiet hours = inbox + badge, no toast. Sounds: WebAudio presets, zero assets.

### `sw.js`

- Per-URL precache (`cache.add` per URL; a miss degrades one asset instead of aborting the install). Exact-URL cache-first for sub-resources; offline fallback uses `ignoreSearch`.
- Navigations use `fetch(…, {cache:"no-cache"})`; only `response.ok` is cached; OAuth `?code=` is never cached.
- `apps.json` is network-first with `{cache:"no-store"}` plus a cache fallback.
- **Dynamically loaded assets must be requested WITHOUT a query string** or they miss the precache offline (Writer PDF lesson).
- **Vendor precache (verified):** `vendor/jspdf.umd.min.js`, `vendor/NotoSans-Regular.ttf`. `vendor/xlsx` is NOT precached (see Part X).
- `skipWaiting` on install; the page broker reloads on `controllerchange`.

### `fs.js` (orOSFS)

One mount (`/internal`). OPFS primary, IndexedDB fallback, identical promise API. `importDisk` merges by default; `{wipe:true}` is destructive. New files must be in the manual commit (the bot never stages untracked files).

### Rules for every app

- **CSS:** `[hidden]{display:none!important}` is the LAST rule of every app stylesheet. Per-element display rules are guarded with `:not([hidden])`. Shell CSS variables are the only styling truth (`inheritPalette` + `watchPalette`, G3). `LABEL_PALETTE` is data, not skin.
- **i18n:** EN/EL only, EN default. Locales el-GR / en-GB. Greek dates: dd/mm/yyyy, no comma after the day.
- **Data:** additive-only migrations; idempotent normalize on load AND on merge results; rescue backup before any reseed; the device-local whitelist is never synced.

---

## Part III — App registry

**State:** kernel LOCKED. Static GitHub Pages PWA (useoros.online). EN default, EL secondary. Dark default. 24h clock. Nunito woff2 vendored.
**Reference app (canonical template):** `mood.js`. Tie-breaker for any pattern question: "what does mood.js do?"

| App | Storage key | Merge type | Status |
|---|---|---|---|
| To-Do | oros-todo-data | entity LWW + tombs | CLOSED (TD set) |
| Kanban | oros-kanban-data | boards[] union, tombs | CLOSED (KN set) |
| Notes | oros-notes-data | page/label LWW + tombs | CLOSED (NT set) |
| Bookmarks | oros-bookmarks-data | entity LWW + tombs | 5/5 VERIFIED |
| Calendar | oros-calendar-data | event union + tombs | CLOSED (F6 cosmetic open) |
| Contacts | oros-contacts-data | union + LWW + tombs | 5/5 VERIFIED |
| Cycle | oros-cycle-data | day-entity union, LWW | 5/5 VERIFIED |
| Weather | oros-weatherapp-data | merge-lite | 5/5 VERIFIED |
| Mood | oros-mood-data | entity LWW + cols | Fixes applied (deep audit queued) |
| Time | oros-time-data | entity union + smtime | 5/5 VERIFIED |
| Quote | oros-quote-data | entity union + LWW | 5/5 VERIFIED |
| Storage | oros-storage-data | flat ents union + del | 5/5 VERIFIED |
| Habits | oros-habits-data | habits/comps LWW | 5/5 VERIFIED |
| Files | oros-files-data + "files-disk" | files-disk blob | ALL CLOSED |
| Prompter | oros-prompter-data | union + LWW + tombs | 5/5 VERIFIED |
| Characters | oros-characters-data | union + LWW + tombs | 5/5 VERIFIED |
| Spreadsheet | oros-spreadsheet-data | cell-entity LWW + cw | 5/5 VERIFIED |
| Dice & Coin | oros-dice-data | union + LWW + tombs | 5/5 VERIFIED |
| Radio | oros-radio-data | stationuuid union + shell proxy slice | Wave 3 + hotfixes; proxy v0.38.10 |
| Minimalism | (minimalism slice) | day-entity union | Waves 1–2, content Days 1–55 |
| **Writer** | oros-writer-data | doc LWW + tpl tombs, canonical (R26) | Doses 1–3 delivered 2026-10-01 → deploy + 2-device smoke test pending |
| **Calculator** | oros-calculator-data | hist union + tombs; scalars ⚠ | v1.2.0 shipped; ⚠ sync audit pending (Part X) |
| Notifications (shell) | oros-notifs | per-field LWW | Core done |
| Screen Pet (shell) | oros-pet-data / oros-pet-events / oros-pet-settings | field-LWW / union by id + clearedAt / field-LWW | v0.3.2 full sync; smoke test pending |

`apps.json` (verified) lists 22 apps: weather, time, files, calculator, todo, kanban, notes, calendar, quote, minimalism, contacts, storage, spreadsheet, writer, prompter, characters, mood, habits, cycle, bookmarks, dice, radio. Screen Pet and Notifications are shell components, not `apps.json` apps.

### Device-local keys (never synced)

- **Shell:** oros-last-version, oros-auto-snapshots, oros-sync-* engine keys, oros-slices (registry), oros-menu-cat-collapsed, oros-lang (shell-written mirror).
- **Weather:** oros-wx-cache, oros-wx-last.
- **FS:** oros-fs-*.
- **Pet:** oros-pet-enabled, oros-pet-pos, oros-pet-minimized, oros-pet-calendar-sync (read-only legacy mirror of oros-pet-settings).
- **Radio:** oros-radio-recents, oros-radio-cache:*.
- **Calendar:** oros-cal-reminders-fired, oros-cal-pending.
- **Writer:** oros-writer-prefs (`{open[], active, seen{}}`).
- **Generic:** oros-*-open staging keys, and all *-prefs / *-cache / *-seen keys.
- **Correction vs older Bible:** oros-pet-events is SYNCED now (petEvents slice).

### File tree

- **Root:** `index.html`, `shell.js`, `notifications.js`, `sync.js`, `fs.js`, `style.css`, `pet.css`, `pet.js`, `translations.js`, `apps.json`, `sw.js`, `manifest.webmanifest`, `icon.svg`, `icons/`, `vendor/` (jspdf, NotoSans-Regular, xlsx), `fonts/` (Nunito ×5), `.github/workflows/bump-version.yml`, `OROS_BIBLE.md` (Bible + changelog; `CHANGELOG.md` retired).
- **One folder per app:** todo, kanban, notes, bookmarks, weather, mood, time (+`astro.js`), calendar, quote, prompter, storage, habits, files, contacts, cycle, characters, spreadsheet, dice, radio, minimalism (+`content.js`), **writer** (no longer `writer-staging`), calculator.

---

## Part IV — Data models

### Common contracts

- **Entities:** `{ id, mtime, … }` — union by id, LWW by mtime, tie → lexicographic JSON/id.
- **ids:** `uid() = Date.now().toString(36) + Math.random().toString(36).slice(2,7)`. Seeds are deterministic (R16).
- **Day keys:** local calendar `YYYY-MM-DD` built from `getFullYear/getMonth/getDate` (no ISO/timezone bugs). DST-safe walking via `setDate(+1)`.
- **Timestamp discipline:** time-of-day and day boundaries are DERIVED from entry ts at render time, never stored.
- **Merge purity:** `uid()`/`Date.now()` inside a merge is a non-determinism bug. Strict sanitizers DROP invalid rows instead.

### Per-app schemas

- **NOTES v2:** `{ ver, pages[], labels[], tombs{} }`. Wiki-links `[[Title]]` are regex-derived (zero storage); pinned notes.
- **KANBAN v5:** `{ ver, boards[{id,name,columns,labels,tombs,mtime,color?,archived?}], boardDeleted{}, activeBoardId (device-local) }`.
- **MOOD v3:** `{ ver, sm, om, entries[{id,ts,mtime,emotions[],loc,person,trig,habits,note}], cols, deleted{} }`. 9 fixed emotions; order is ts DESC, derived at sort.
- **TIME v1:** zone entities `{tz,mtime}` plus scalar prefs LWW via smtime. Alarms travel IN the shell slice.
- **CALENDAR:** `{ ver, events[{id,title,date,start,end,location,labelId,recur{freq,interval,until,exdates},remindMin,mtime}], labels[], deleted{} }`. Fixed key order for deterministic tie-breaks.
- **QUOTE:** entities + shared tombstone map. Computed totals are PURE (never stored). Numbering OFF-YYYY-NNN.
- **STORAGE v1:** `{ ver, ents[{id,type,name|bi,parentId,pos,qty?,note?,mtime,del}] }`. Cascade delete tombstones every descendant with a fresh mtime.
- **HABITS v1:**
  - `{ ver, habits[{id,name,icon,color,days[0..6 Monday-first],mtime,del}], comps[{id:"<habitId>|<YYYY-MM-DD>",…}] }`.
  - Toggle-off = tombstone.
- **WEATHER v1:** `{ ver, sm, om, active, deleted{}, cities[], shellWx, units }`. Units are RENDER ONLY; the slice is always metric.
- **FILES:** view prefs in oros-files-data (device-local). The "files-disk" slice is a JSON snapshot of `/internal` (blob model; per-entry model is backlog).
- **CONTACTS:**
  - `{ ver, contacts[{id,name{},phones[],emails[],addresses[],web[],im[],events[],notes,photo,relations[{with,type}],starred,labelIds[],mtime,del}], cols{}, deleted{} }`.
  - Relations are stored on the initiator; the inverse is computed at render.
- **CYCLE v1:**
  - `{ ver, periods[{id,start,end|null,flow?,mtime,del}], days{d-YYYY-MM-DD:{sym[],meds[],note?,mtime}}, cols{}, prefs{remind}, deleted{} }`.
  - Whole-day LWW; absence is never imputed; prefs edits stamp BOTH sm and om.
- **BOOKMARKS v1:**
  - `{ ver, items{id:{url,title,folderId,tags[],visited,lastVisited,mtime,fav?}}, folders{id:{name,pos,mtime}}, deleted{}, settings{} }`.
  - Root folder "unsorted" is permanent.
  - Dedupe via the shared `dupeKey()` (scheme/www/case/fragment-insensitive; query string kept).
- **DICE v2:**
  - `{ ver, sm, deleted{}, history[{id,kind,ts,mtime,…}], presets[] }`, kind ∈ {dice, coin}.
  - Tombstones prune at max-mtime − 30d; presets union by name.
- **PET v1 — three synced slices:**
  - `pet` (oros-pet-data): `{ ver, pet{id,name,palette,birthTs,fm{field:mtime}}, lastFed, lastPetted, wokeAt/awakeE?, asleepSince/asleepE?, tombs{} }`.
    - Stats are DERIVED from anchors at render time, never stored.
    - Identity merges per field via `fm`. Temporal anchors use max-value merge, and anchor pairs travel together.
  - `petEvents` (oros-pet-events):
    - Union by event id, sorted by (ts, id), rolling trim to 100.
    - Birthday ids are deterministic: `bday-<petId>-<ymd>`.
    - `clearLog` writes a `{clearedAt}` wipe tombstone.
  - `petSettings` (oros-pet-settings): calendar-feed toggle, per-field LWW via `calFeedTs`. The legacy key oros-pet-calendar-sync is kept in lock-step as a read-only mirror for `calendar.js`.
- **NOTIFICATIONS v1:** `{ ver, settings{position,style,sound,volume}, appToggles{}, items[{id,dedupKey,ns,type,title,body,deepLink,createdAt,firedAt,readAt,expiresAt}], meta{} }`.
- **SPREADSHEET:**
  - Cells: `{"<sid>|<r>|<c>":{v,mtime,f?}}`, sparse, LWW per cell, shared tombstones. `f{b,i,u,al,co,nf}` rides whole-cell LWW.
  - Sheets: `{id,pos,cw{colIdx:px}}`.
  - Formula engine: tokenizer → shunting-yard → RPN, built from scratch.
- **RADIO v1:** `{ ver, favorites[{stationuuid,…,mtime}], deleted{} }` — union by stationuuid (Dice pattern).
- **MINIMALISM:** day records + `prefs{remindHour}`. Reminder logic is shell-side (`minimalismCheckTick` reads the slice directly, so it works with the app closed).

**WRITER v1** (verified 2026-10-01):

```
{ ver:1,
  docs[ { id, title, author, tags[], category, html,
          footnotes[{id,text}], comments[{id,quote,text,ts}],
          versions[{ts,html,manual,footnotes?,comments?}],
          pageSize, margins{top,bottom,left,right}, header, footer,
          goal{type,target,lock,startTs,startWords}|null,
          mtime, del } ],                 // SORTED BY id (R26)
  tabOrder[],      // COMPAT ONLY = alive doc ids sorted; NOT the open tabs
  settings{smartTypography,_mtime}, autocorrect{rules[{find,repl,def}],mtime}|null,
  templates[{id,name,desc,html,mtime}] (sorted, tombstoned ones filtered),
  tplTombs[{id,ts}] (deduped max-ts, sorted), seeded }
```

- **Device-local** `oros-writer-prefs = { open[], active, seen{} }`. Docs never seen on this device auto-open once. At boot with no open tab, the most recent doc opens.
- **Merge:** per-doc LWW (`wNewer`: mtime → lexicographic JSON); template LWW vs tombstones; settings LWW on `_mtime`; autocorrect LWW on `mtime`.
- **mtime (R27):** moves only when the editor html changes (`flushSave`) or through `markDoc(doc)` for field edits (meta, page, footnotes, comments, goal, versions).
- **Versions:**
  - Auto: at most 1 per 5 minutes, riding the save pipeline (no timers); keeps the newest 8 within 400k chars per doc.
  - Manual: never dropped.
  - Restore brings back footnotes and comments when the version carries them.
- **Delete:** tombstone with content stripped + 8s Undo (fresh mtime resurrects).
- **DB import (.json):** MERGES and restamps the imported entities "now". Backup tombstones are ignored.

**CALCULATOR** (from Part XII changelog entries — NOT verified against code; schema drifted between v0.1.0 and v1.2.0):

```
{ ver:1, hist[{id,e,v,f,mtime}] (cap 50), deleted/tombs{}, skin, troll,
  trollIntensity, sound, panelWidth, mem (number|null), sciOn, sm{} }
```

The v1.1.0 entry describes `registerSlice(get, set, LS_KEY)` WITHOUT `mergeFn`, and "remote wins when present" for scalars. Both contradict R5 and the sync doctrine. Audit queued (Part X).

---

## Part V — Sync + data-safety essentials

### Security model (absolute)

- Zero tracking. Zero-knowledge passphrase (AES-GCM + PBKDF2 100k, client-side).
- Dropbox tokens are used only for file I/O (PKCE). Vault: sealed passphrase + IndexedDB NON-EXTRACTABLE key, opt-in per device.
- All third-party-cloud data MUST be E2EE, for any future provider too.
- App frames are same-origin with the shell. **XSS in any app = full access to tokens and data.** Treat every import as hostile:
  - Sanitize in an INERT document (`document.implementation.createHTMLDocument`). `innerHTML` on a live-document element fires `<img onerror>` even when detached.
  - `esc()` does not escape quotes; use `escAttr()` in attributes and quote-escape URL captures.

### Data-safety supremacy (zero-loss guarantee)

- **Sync:** bidirectional push-pull, deterministic merges.
- **Snapshots:** rolling 5 full-DB auto-snapshots (FIFO, oros-auto-snapshots); Restore = picker with newest preselected.
- **Manual export:** full DB, every parameter; import restores zero-loss (through `applyPayload`, merge-aware).
- **Auto export:** optional periodic export to a folder + on-close sync safety net + `beforeunload` warning when dirty and online.
- **Factory reset:** double confirm → cloud → folder → localStorage prefix sweep → OrosFS wipe → reload. Everything is tombstoned and seeds are reborn.
- **Corruption:** rescue backup before any reseed. **Compatibility:** additive migrations; unknown fields carried forward.
- **Quota (R30):** one shared ~5 MB `localStorage`. A failed `setItem` means edits will not survive a reload, so warn the user.

### Files-disk glue (`shell.js` §9f)

- `files.js` mutates → `__orosFilesDiskTouched()` (engine dirty + 1s-debounced cache refresh).
- Remote data while the app is closed sets a pending flag, consumed at the next open.
- `fdSliceGet` is PURE. `fdRefreshForExport()` guarantees a live snapshot before manual exports.

---

## Part VI — Canonical patterns (verbatim contracts)

Status per pattern: **[re-verified 2026-10-01]**, or **[carried]** (from earlier revisions, check against the file before relying on it).

### Boot sequence [carried]

`load()` → `applyI18n()` → paint static aria/icons → `wire()` → `registerSync()` → `inheritPalette()` → `watchPalette()` → reset view state → first render (single pass) → consume staged deep link AFTER first paint.

**Invoke `boot()` at the END of the IIFE** (after every `let`/`const`): a boot triggered early hits TDZ errors on later declarations.

### Boot marker [re-verified in Writer]

```js
var SCRIPT_V = "";
(function () {
  var m = (document.currentScript && document.currentScript.src || "").match(/[?&]v=([^&#]+)/);
  SCRIPT_V = m ? m[1] : "";
  console.log("<app>.js v" + (SCRIPT_V || "?") + " boot");
})();
```

### Shell API + language resolution in an app frame (R8) [re-verified]

```js
function syncApi() {
  try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
  catch (e) { return window.orosSync || null; }
}
// Language: shell writes localStorage "oros-lang" and reopens apps on toggle.
function appLang() {
  try {
    var l = localStorage.getItem("oros-lang") ||
            (window.parent && window.parent.orosLang) || "en";
    return l === "el" ? "el" : "en";
  } catch (e) { return "en"; }
}
```

### Sync registration + dirty funnel [carried; canonical rule re-verified]

```js
function registerSync() {
  // LOCAL FIRST: load() MUST have run before this (boot order). Live
  // registration does NOT hydrate the app — registering an empty state
  // lets the first get()/save() persist and push an empty slice.
  var api = syncApi();
  window.__orosSyncApi = { _suppress:false, dirty:function(){
    if (this._suppress) return;
    if (api && typeof api.markDirty === "function") api.markDirty(); } };
  if (!api || typeof api.registerSlice !== "function") return;
  api.registerSlice("<id>", sliceGet, sliceSet, STORAGE_KEY, mergeFn);   // 5 args, always
}
```

- `save()`: `localStorage.setItem` + `__orosSyncApi.dirty()`.
- `sliceSet(data, info)`:
  - if the user has pending edits, fold them in first (`mergeFn(serialize(), data)`);
  - write + persist the storage key, with NO `markDirty` (R6);
  - normalize, sanitize view state, re-render (keep the caret when the content is unchanged);
  - no toast (sync feedback is the taskbar dot).
- `serialize()` must be canonical (R26): arrays sorted by id, tombstones canonical, no device-local fields.

### Notification trigger [re-verified against notifications.js 0.38.12]

```js
function notifyDue(key, title, body, deepLink) {
  var n = null;
  try { n = window.parent && window.parent.orosNotifs; } catch (e) {}
  if (n && typeof n.emit === "function") {
    return n.emit({ ns: "<appid>", key: key, title: title, body: body,
                    deepLink: deepLink /* "<appid>:<payload>" */ }) !== null;
  }
  return false;   // caller falls back to its legacy local alert
}
```

### Transient note / toasts [re-verified]

```js
function showToast(msg) {            // informational → shell transient
  try {
    var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
    if (n && typeof n.transient === "function" &&
        n.transient({ ns: "<appid>", title: String(msg) })) return;
  } catch (e) {}
  localToast(msg);                   // stale bundle / standalone fallback
}
```

- **Undo-bearing toasts stay LOCAL** (closure never leaves the frame), 8s.
- **A modal `<dialog>` makes the rest of the page inert:** host the local toast inside the top-most `dialog[open]`, and move it back to `<body>` when that dialog closes.

### Deep-link receiver [carried]

```js
window.__oros<App>Open = function (id, ymd) { /* navigate; guard deleted ids */ };
// Boot: read sessionStorage "oros-<app>-open", remove it, invoke the receiver.
```

### Shortcut forwarding (Contract Β, capture phase) [re-verified]

```js
document.addEventListener("keydown", function (e) {
  if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
  var p = null; try { p = window.parent; } catch (err) { return; }
  if (!(p && p !== window && p.orosShortcuts &&
        typeof p.orosShortcuts.handle === "function")) return;
  if (p.orosShortcuts.handle(e)) e.stopPropagation();
}, true);
```

App-local shortcuts match `e.code` (`KeyS`, `KeyF`, …), never `e.key`, and skip Ctrl+Alt+Shift (shell territory).

### Merge engine shape [re-verified in Writer]

```js
function newer(a, b, key) {              // symmetric pick (R5)
  var k = key || "mtime";
  var ma = (a && Number(a[k])) || 0, mb = (b && Number(b[k])) || 0;
  if (ma !== mb) return ma > mb ? a : b;
  return String(JSON.stringify(a)) >= String(JSON.stringify(b)) ? a : b;
}
```

- Union by id with sorted output.
- Tombstones: max-ts union, deduped and sorted.
- An entity is alive if its mtime > the tombstone ts.
- Column/order values: the side with the larger om donates positions.
- Strict normalizers DROP invalid rows.

### Lazy entity materialization (R28) [Writer]

```js
function ensureDoc() {
  var cur = activeDoc();
  if (cur && !cur.del) return cur;
  var d = createDoc({ silent: true, keepEditor: true });  // no re-render, caret kept
  dirty = true; flushSave();                              // capture what is on the page
  return d;
}
```

### mtime discipline (R27) [Writer]

```js
// flushSave(): stamp ONLY if the content really changed
var html = editorHTMLForSave();
if (html !== doc.html) { doc.html = html; doc.mtime = Date.now(); }
// field edits stamp at the mutation site:
function markDoc(doc) { if (doc) doc.mtime = Date.now(); scheduleSave(); }
```

### Import sanitizer (inert document) [Writer]

Allow-list thinking; remove these elements:

- `script`, `style`, `iframe`, `frame`, `frameset`, `object`, `embed`
- `noscript`, `link`, `meta`, `base`, `template`
- `form`, `input`, `button`, `textarea`, `select`
- `svg`, `math`

Remove these attributes:

- every `on*` handler, plus `srcdoc` and `formaction`;
- `href`/`src`/`action`/`data` whose control-char-stripped value starts with `javascript:`, `vbscript:` or `data:text/html`.

Parse with `document.implementation.createHTMLDocument('')`; never with a live element.

### Dismissable menus (per-instance listeners)

- Never leave `{once:true}` document listeners behind for a reusable menu: a stale one closes the NEXT menu instantly ("works every other time").
- Use one `AbortController` per menu instance; `close()` calls `abort()`.

### Dialogs [carried + Writer]

- Native `<dialog>` + `showModal()`; outside-click + Esc; null-guarded `close` listeners; remove the node on close.
- Themed confirm/prompt return Promises (`wConfirm(msg, {danger, ok})`, `wPrompt(title, value)`).
- A zero-edit close must not stamp mtime.

### i18n in an app [carried + Writer]

```js
const STRINGS = { en: { ... }, el: { ... } };          // same key set in both packs
function t(key) { return (STRINGS[appLang()] || STRINGS.en)[key] || STRINGS.en[key] || key; }
```

Escape user text with `esc()` before `innerHTML`, and use `escAttr()` in attributes. Keep key parity EN↔EL; a quick script that diffs the key sets and greps `t('…')` / `data-i18n` usages catches missing keys (Writer had one).

### Form rebuild discipline (buildCapture) [carried]

Read input values + scrollTop BEFORE `innerHTML=""`, rebuild, then restore.

### `LABEL_COLORS` (shared, 8)

`#e06c75 #ecc75f #87cf3e #4fc4cf #6d4aff #e09ecf #f28c5a #9aa4b0`

---

## Part VII — UI standards

- **Scrollbars:** 10px, transparent track, pill thumb (999px radius, 2px border `var(--bg)`), hover `var(--accent)`; Firefox `scrollbar-width:thin`. `overscroll-behavior:contain` on main panes.
- **Hidden guard:** `[hidden]{display:none!important}` is the LAST rule of every app stylesheet.
- **Icons:** inline SVG with viewBox + explicit size (Fork Awesome abandoned).
- **Toasts:** top-right, below clock/taskbar, lazy singleton; text first, action second.
- **NOTIFICATIONS ≠ TOASTS:** cross-session/event reminders → `emit()` (inbox + badge + history); in-context feedback → transient/local toast.
- **Mobile:**
  - single-thumb reach; touch targets ≥44px; safe-area `env()` insets; breakpoints 480/420/360;
  - long-press 450ms as the touch twin of right-click menus (every right-click/Alt-click feature needs a touch path).
  - **Toolbars wider than a phone scroll horizontally** (single strip, hidden scrollbar), never clip.
- **Desktop:** ≥1024px split views allowed.
- **Editor toolbars:** formatting buttons `preventDefault()` on `mousedown` so the editor keeps focus and selection (touch collapsed it).
- **DOM stability:** don't rebuild a container on click when a dblclick may follow (the 2nd click lands on a new node → no dblclick). Update classes in place.
- **Interactive containers:** no `<input>` inside a `<button>`. Use `div[role=tab][tabindex=0]` with Enter/Space/F2 handlers.
- **Find/highlight:** never move the document selection while the user types in a search field (Chrome moves focus → keystrokes overwrite the match). After unwrapping highlight marks, `normalize()` the parents.
- **Autosave:** debounce, no Save buttons for settings; flush on `visibilitychange→hidden` and `pagehide`.
- **Deleting:** danger styling; Undo toast (R17 resurrection) preferred over confirmations.
- **Language:** EN/EL only; EL dates ηη/μμ/εεεε, no comma after the day.
- **Version badge:** shell Info modal only.

---

## Part VIII — Release pipeline, checklists, test harness

### Pipeline (`.github/workflows/bump-version.yml` v3)

- Runs on every push to main. Reads `APP_VERSION` from `shell.js`.
- Stamps `sw.js` CACHE_VERSION, the manifest, and `?v=` on every relative .css/.js in every `index.html` (directory scan; new apps need zero config).
- Guards: G2 (app folders in `PRECACHE_URLS`), G3 (`inheritPalette` + `watchPalette`), G4 (`apps.json` ↔ folders).
- The bot never stages untracked files: NEW files must be in the manual commit.

### Checklist A — Version bump (user-owned)

`APP_VERSION` → push → verify on BOTH devices → changelog (R21) + Bible (R22).

### Checklist B — New app integration

1. `<app>/` folder (index.html + css + js; boot marker; IIFE).
2. `apps.json` entry (icon key; category in the same case as existing ones).
3. `sw.js` `PRECACHE_URLS` (G2), including dynamically loaded assets WITHOUT query strings.
4. `shell.js` ICONS entry (inline SVG, currentColor).
5. `translations.js`: `app.<id>` + category strings (en + el).
6. Self-registration (5-arg `registerSlice`, local-first load, canonical `serialize`).
7. Palette: `inheritPalette` + `watchPalette` (G3).
8. Shortcut forwarding (Contract Β) + `SC_DEFS` entry if the app gets a global shortcut.
9. Notifications: `emit()` + `KNOWN_APPS`/appToggles + `__orosOpen<App>` + `DL_BRIDGES` + staging key — or a documented exemption.
10. Part XII changelog entry + Bible registry, same response.

### Checklist D — Release pre-flight

- `node --check` on every touched JS; JSON validation.
- Boot marker matches `?v=`.
- Shortcuts smoke test per app.
- Notification smoke test (emit → toast + badge + inbox; click-through live AND cold).
- Deploy + version check on BOTH devices.
- PWA update path on desktop AND mobile.
- R21 + R22.

### Checklist E — Pre-completion (R18)

- ☐ Perfect sync both directions
- ☐ Tombstone resurrection across devices
- ☐ Offline edits survive reconnect
- ☐ Zero-loss export (manual + auto + snapshot)
- ☐ Offline-first
- ☐ Mobile-first
- ☐ Notifications converge
- ☐ **Blank-state sweep:** every toolbar action with no entity/selection (R28)
- ☐ **Two-device convergence:** applied==0 from round 2 (R26)

### Five-axes compliance (audit doctrine, every app)

1. Calendar integration (or a documented exemption).
2. Unified notifications (transient for info; `emit()` for reminders; local for Undo).
3. Dropbox sync (5-arg `registerSlice` + deterministic, canonical `mergeFn`).
4. Snapshots (global; no per-app code).
5. Manual & auto export (shell DB export via the slice; app-level only for interop formats).

### §F — Assistant runtime test harness (R29)

Rebuild this in any session where code is delivered.

**Browser.**

- Python Playwright + Chromium in the sandbox. Path seen: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- If it moved: `find / -name chrome -path "*chrome-linux*"`. `jsdom` is NOT available, and there is no network.

**Site** (`/tmp/site`):

- `<app>/` holds the app files under test.
- `sync.js` is the REAL file.
- `vendor/` gets stubs as needed.
- `shell.html` is a stub shell:
  - defines `window.orosLang` from `?lang=`;
  - logs `orosNotifs = {transient, emit}`;
  - provides `orosShortcuts.handle`;
  - loads `sync.js`, then `<iframe src="<app>/index.html?v=test">`;
  - needs `<meta name="viewport">` for mobile runs.

**Server.** `cd /tmp/site && nohup setsid python3 -m http.server 8765 >/tmp/srv.log 2>&1 </dev/null &` (plain `&` jobs die between calls).

**Sweeps.** Click every toolbar button; open every dialog; operate every control; export every format and re-import each; run EN + EL × desktop + mobile (`is_mobile`, `has_touch`, 390px); assert `pageerror` is empty.

**Two-device test.**

- Use two browser contexts (separate storage).
- Repeat: `A.exportData()` → `B.importData()` → `B.exportData()` → `A.importData()`.
- PASS = exports equal AND `applied == 0` from round 2 on.

**Gotchas.**

- Playwright downloads have no extension: `save_as("x.ext")` before re-importing.
- Read storage ≥650ms after an action (500ms save debounce).
- A right-click outside the selection collapses it.
- `dblclick` tests catch DOM-rebuild bugs.

**Format oracles.**

- LibreOffice via `/mnt/skills/public/pptx/scripts/office/soffice.py` (convert DOCX/RTF/ODT).
- `python-docx` to parse DOCX and to generate list/heading fixtures.

---

## Part IX — Decisions log + doctrinal exemptions

### Decisions (newest first)

- **2026-10-01 · Writer (delegated, "αποφάσισε εσύ")**
  - Open tabs are a device-local view (`oros-writer-prefs`). Docs never seen on a device auto-open once. The slice's `tabOrder` is a compatibility field only.
  - Documents manager (folder icon in the tab bar): search, open closed docs, delete with Undo. Closing a tab never deletes.
  - A blank page acts as a document; doc-level actions materialize one lazily (R28). Boot opens the most recent doc.
  - Auto versions ride the save pipeline (≤1 per 5 min, newest 8 within 400k chars per doc). Manual snapshots are never dropped.
  - DB backup import MERGES (restamped "now"); backup tombstones are ignored.
  - Images are downscaled on insert/paste (≤1600px JPEG 0.85; ≤300KB kept as-is).
  - Goal button always opens the dialog; the lock can be armed before the goal is reached.
  - Notifications-exempt (transient only); Calendar-exempt.
- **2026-09-30 · Calculator:** ALL state syncs (history + skin + troll + sound + panel width + memory + sci row). Language and theme are shell-owned.
- **2026-09-30 · Screen Pet:** event log and calendar-feed setting sync. Presence, position and HUD collapse stay device-local.
- **2026-09-30 · Radio:** shell-side proxy slice so favorites sync while the app is closed.

### Doctrinal exemptions

- **Calendar-axis exempt** (non-time-bound): Bookmarks, Files, Characters, Storage, Spreadsheet, Dice, Screen Pet, Minimalism, Radio, Calculator, Writer.
- **Notifications-exempt / transient-only** (Dice pattern): Dice & Coin, Screen Pet, Minimalism (shell-side detector), Radio, Calculator, Writer.
- **Palette G3 exemption:** Calculator (independent playful skins; Screen Pet precedent).
- **Screen Pet** is not an `apps.json` app (shell component; device-local toggle oros-pet-enabled).
- **Version drift observations** are out of audit scope (R23).
- **Kanban KN-Q1:** wall-clock tombstone pruning accepted as a known deviation (revisit only if phantom pushes appear).
- **Storage / Quote:** deterministic `sliceGet` pruning is mandatory (both adopted).

---

## Part X — Open items, audit queue, lessons

### Open decisions (Christos)

- ⊗ #21 (To-Do) priority keywords: implement / strike / defer?
- ⊗ #35 (Kanban) clean up unused keys + stale comment?
- ⊗ #S5 (Shell) aurora label: Σέλας or Αυγή?
- ⊗ #19 (To-Do) undo-across-sync: now or defer?
- ⊗ Radio DNS/blocking diagnosis: de1 mirror opens in a tab but fails from page context (suspected adblocker). Retest in incognito without extensions.
- ⊗ Radio RX-N1..N5 cleanup candidates (favicon preloading, shadowing `isFavorite`, unused `wasOffline`, asymmetric polling, stop/kill switch).

### Audit queue (assistant-raised; verify, then fix)

- **A1 · `__orosNotify` sweep (HIGH).**
  - The previous Bible's canonical notification trigger called `window.parent.__orosNotify.emit`, which does not exist in shell.js or notifications.js (0.38.12).
  - Any app that copied that template emits nothing and silently falls back to legacy alerts.
  - Action: grep every app for `__orosNotify`; migrate to `orosNotifs.emit` (Part VI).
- **A2 · Calculator sync.**
  - The v1.1.0 changelog entry (Part XII) says `registerSlice(get, set, LS_KEY)` without `mergeFn` (→ mergeless, divergence guard parks remote data) and "remote wins when present" for scalars (violates R5).
  - Also check R26 canonical output, R8 language (said fixed), and `SC_DEFS` Ctrl+Alt+Shift+C (listed as "next" on 2026-09-30).
- **A3 · `apps.json` categories.** "lifestyle" (minimalism) and "sound" (radio) are lowercase while all others are Capitalized. Check `translations.js` `category.*` keys and the menu grouping.
- **A4 · `vendor/xlsx` not precached in `sw.js`.** If Spreadsheet loads it, offline import/export breaks. Verify usage and the load URL (no query string).
- **A5 · R26 sweep.** Run the two-device convergence test on every app with a `mergeFn` (unsorted arrays or device-local fields cause silent endless pushes).
- **A6 · R8 sweep.** grep apps for `window.orosLang`, `window.orosSync`, `window.orosNotifs` read from the app's own window.
- **A7 · KNOWN_APPS gaps.** Apps that emit but are not listed get no settings toggle (`getAppToggle` defaults true). Confirm which apps emit; exempt apps are fine.

### Writer (post-Dose 3)

- **Deploy + check:**
  - boot marker on both devices;
  - registry `JSON.parse(localStorage['oros-slices']).writer === 'oros-writer-data'`;
  - sync dot settles;
  - close all tabs → Metadata works;
  - reload opens the most recent doc.
- **Mobile gap:** link/image/table insert exists only in Quick Format (Alt+right-click). Add a touch path (long-press 450ms or a toolbar button).
- **Known limits:**
  - RTF import is text-only.
  - PDF bold/italic needs NotoSans Bold/Italic vendored + precached.
  - Find-and-replace edits are outside the native undo stack.
  - Ctrl+Alt+W/T app shortcuts coincide with AltGr on Windows layouts (consider moving).

### Queued (next phase)

- Screen Pet smoke test (retroactive energy after a simulated 2-day absence, identity merge rename, drag-vs-click threshold, EL/EN speech + HUD, HUD minimize persistence).
- Mood deep audit (highest priority — deepest model), then Weather revisit, then a Kanban/Contacts/Notes pattern sweep (use A5/A6).
- Minimalism content Days 56–105 (Phase 3 "Depth"), then 106–365 in review batches.
- Calendar F6 (cosmetic CSS one-liner).
- Quote calendar feed (due dates + status changes; Contacts/Cycle pattern).
- Spreadsheet Wave 4 (VLOOKUP/INDEX/MATCH/SUMIF/COUNTIF, date/time/text/financial, conditional formatting, charts, iterative calc, PDF export, mobile range selection).
- Cycle cleanup (inert `.cal-*` CSS; stale "month calendar" comment).
- `registerTrigger` API removal from `sync.js` (verify there are no consumers first).
- Pet cosmetics: zero-indented Section 2b-3; Wave 5b header comment missing "Calendar".

### Backlog (long-term)

- **Core/sync:** unified shell toast API absorption · hierarchical key rotation · cross-device passphrase-change notice · more cloud providers (E2EE mandatory) · per-entry file sync for OrosFS.
- **Notifications:** quiet-hours UI · alarms presentation routing · Todo/Habits/Kanban calendar feeds.
- **Apps:**
  - Kanban board color headers
  - Notes fuzzy backlinks
  - Weather radar / hourly graph
  - Quote CSV export
  - Prompter sprint timer
  - Storage Restock Center
  - Habits weekly targets
  - Files drag-drop import + batch ops
  - Contacts X-RELATED export
  - Cycle symptom trends
  - Bookmarks link health + fuzzy dupes + bulk tags
  - Minimalism feed visualization + Revisit mode
  - Calculator memory/sci shortcuts (M, R)
- **New apps:** Pad (Notepad++-style) · Pagination/typesetting · Public Domain Calculator · Desk suite · native Windows/Android conversions (pending flawless PWA validation).

### Lessons — closed incidents (do not re-chase)

**Kernel / earlier:**

- Duplicate seeds on a new device (Notes/To-Do/Kanban) → R16.
- Calendar feed blackout on a new device → feed cache invalidation in `setFromSync()`.
- Contacts wipe → empty-blob guard in `collectPayload()`; recovered from .vcf.
- `window.t is not a function` → transient partial-bundle boot; TP-guards make it non-fatal.
- "Banner not shown: beforeinstallprompt preventDefault()" → expected (menu Install button keeps `deferredPrompt`).
- Kanban legacy board mumfy266amf80 → pre-patch duplicate; manual delete propagates the tombstone.
- Radio FIX-RX: `applyMediaSession` undefined; honest catalog banner; a dead `state.offline` flag poisoned API calls.
- Diagnostic gotcha: `[id*="sync-dot"]` matched the parent button, not `#sync-dot`.

**Writer audit 2026-10-01** (each now a rule or pattern):

- **Never synced, from day one:**
  - `window.orosSync` read inside the iframe → Writer was absent from cloud sync, DB export and snapshots (R8).
  - Fixing only that would have pushed an empty slice, because live registration does not hydrate (local-first pattern).
- **Sync ping-pong:** a device-local `tabOrder` and unsorted docs inside the slice → two devices pushed forever (R26).
- **Silent no-ops:** five doc dialogs did nothing with no open tab (R28).
- **Data loss:**
  - deleting a comment removed the commented TEXT (unwrap instead);
  - text typed with no tab, or within 500ms before "+", was discarded;
  - version restore was a no-op (debounce re-read the old editor);
  - flush-stamped mtime let stale copies win (R27).
- **Find typing overwrote matches:** selection moved into the editor (Part VII).
- **Quick Format "every other time":** stale `{once}` listeners (AbortController pattern).
- **Tab rename never worked:** DOM rebuilt between the two clicks.
- **RTF import always empty:** a 34-char look-ahead at the root `{` skipped the whole document.
- **XSS:** MD attribute breakout + unsanitized `.orosdoc`/`.json` imports (inert sanitizer).
- **Exports:**
  - Chrome `<div>` lines split into paragraphs and lost formatting (normalize to `<p>`);
  - indented lists (`ul > ul`) dropped;
  - RTF `\pard` without `\plain` leaked bold.
- **Offline:** dynamic vendor loads with `?t=` cache-busters missed the precache.
- **Quota:** raw data-URL photos could exceed the shared quota while `localPersist` swallowed the error (R30).

---

## Part XI — Session handoff template

Paste as the first message of a new chat:

```
Continuing orOS work. OROS_BIBLE.md is the SINGLE SOURCE OF TRUTH — read
Part 0 (working agreement), Part I (rules R1–R30) and Part X (open items)
before touching anything. Kernel LOCKED; five-axes audit doctrine active.
Next task: <task>. Apps involved: <dirs>.
I will paste any file you request — ask for CURRENT versions of every file
you will patch. Answer me in Greek; code and docs in English.
```

---

## Part XII — Changelog

`CHANGELOG.md` was retired; this Part IS the project changelog.

**Format rules (R21):**
- Ascending order: oldest first, the newest entry at the BOTTOM. New entries are appended at the end of this Part in the same response as the change.
- Heading: `### YYYY-MM-DD — <component> <version/wave> — <title>`. Undated legacy entries keep an approximate date marked "≈".
- Bullets, grouped as needed: **Changes** · **Fixes** · **Schema** · **Decisions** · **Files** · **Next**. Every fact that matters for future work stays (bugs fixed, schema fields, merge rules, decisions); prose is trimmed.
- Version numbers appear only as historical records (R23: never proposed by the assistant).

### Condensed history (before detailed entries were kept here)

- **2025-08 → 2026-09:** kernel lock, sync v0.9.2, OrosFS, unified notifications, 20 apps audited/verified.
- **2026-09-27:** Spreadsheet Waves 1–3 + Five-Axes verified.
- **2026-09-29:** Dice & Coin v0.4 (first Soffitta port).
- **2026-09-30 (summary-only items):**
  - Screen Pet v0.1–v0.3.1 (second Soffitta port, shell component) + calendar feed.
  - Writer Wave 5 I/O complete + audit fixes.
  - Cycle Timeline rewrite + DST hardening + unified-notification migration; Cycle v0.37.05 (back-to-today, date-picker sync, insights trend strip).
  - Radio Waves 1–3 (shell-hosted audio, discovery, mirror fallback) + FIX-RX hotfix series.
  - Minimalism Waves 1–2 + content Days 1–55.
  - Dice v0.38.00 feature wave.

### ≈2026-09-30 — Screen Pet — HUD minimize toggle

- **Changes:**
  - A ◀/▶ button left of the pet's name collapses the HUD to the name row only. The tooltip shows Ελαχιστοποίηση/Minimize or Ανάπτυξη/Expand.
  - When collapsed, these are hidden: age line, palette swatches, the three stat bars and all action groups.
  - Implemented via the `.pet-hud-collapsed` class (`#pet-hud-age`, `#pet-palettes`, `.pet-stat`, `.pet-hud-actions`), with a height/padding transition.
  - `refreshHUD()` is the single source of truth for HUD state.
- **Persistence:** device-local `oros-pet-minimized`, reapplied in `petEnable()`.
- **Guard:** clicks route through `touchInteraction()` (breaks contemplation, resets the 5-min idle clock).
- **Next:** smoke test (collapse, persistence across refresh, icon flip).

### ≈2026-09-30 — Screen Pet — event log full sync (Wave 5b follow-up)

- **Changes:**
  - New synced slice `petEvents` (`oros-pet-events`), merged as a union by id plus `{clearedAt}` wipe propagation. The `pet` entity slice was already synced; only the log had been device-local.
  - `logEvent` marks dirty through the existing `__orosPetSyncApi` funnel (~5s debounced push).
  - Birthday events use a deterministic id `bday-<petId>-<ymd>`: two devices logging the same anniversary collapse into one row (log + calendar feed).
  - `window.orosPet.clearLog` writes a `{clearedAt}` tombstone instead of removing the key, so the wipe reaches every device.
- **Export/import:** both pet slices ride `orosSync.exportData()`/`importData()`; no shell change needed.
- **Mixed versions:** older `pet.js` relays the unknown slice via the carry mailbox (sync.js ≥ 0.9.2).
- **Schema:** unchanged (ver 1); existing local logs merge on the first push. `calendar.js` untouched (reads the same key).

### 2026-09-30 — Calculator v0.1.0 — third Soffitta port

- **Concept:** a standard calculator with an optional Troll mode (in-app toggle).
- **Structure:**
  - New `calculator/` folder (index.html, calculator.css, calculator.js) on the orOS boot pattern: IIFE, `SCRIPT_V` marker, single-pass first render, `wireUI` before any `apply*`.
  - Classes namespaced `calc-*` (pad, display, face, switch, knob, skin-dot, hist-*).
- **Schema:** `oros-calculator-data = { ver:1, hist[{id,e,v,f,mtime}], tombs{}, skin, troll, sound, sm{skin,troll,sound} }`. Decision: ALL state syncs.
- **Merge:**
  - Scalars: per-field LWW via `sm` (Pet `fm` pattern), lexicographic tie-break (R5).
  - History: symmetric union by id (mtime → JSON tie-break); tombstones max-ts, delete wins ties (R17).
  - `HIST_MAX` 20, enforced with tombstoned trims. A strict sanitizer drops invalid rows.
- **Fixes:**
  - `sliceSet` suppresses dirty (R6).
  - `registerSync()` is now actually called in `load()` (it was defined but never called).
- **Shell ownership:**
  - Language and theme are shell-owned: `applyTheme()` deleted, lang/theme buttons removed, language read from `oros.lang` + storage events.
  - `skin-dark` sniffs `--bg` luminance.
- **R14:**
  - `resetAll()` uses a themed `<dialog>` (outside-click + Esc, node removal).
  - Reset history writes tombstones.
- **Features kept:**
  - CSV history export (Five-Axes ⑤).
  - Five skins with WebAudio voices; typewriter quips; truth reveal 1/15.
  - Share-prank clipboard with fallback; reduced motion; scrollbar + hidden-guard CSS; breakpoints 480/420/360.
- **Dead code removed:** `PREFS_KEY`, `evalCache`, an unused var in `flashToast`.
- **Exemptions:** Calendar axis, unified Notifications (Dice pattern), palette G3 (playful skins, Screen Pet precedent).
- **Next:** registry integration (apps.json, shell ICONS, `SC_DEFS` Ctrl+Alt+Shift+C, `translations.js` `app.calculator` + category, sw.js precache), then Checklist D on both devices.

### 2026-09-30 — Shell v0.38.10 — Radio proxy slice

- **Fix:** Radio favorites sync across devices even while the Radio iframe is closed.
- **How:**
  - `radio` slice registered shell-side: `radioProxySliceGet()` / `radioProxySliceSet()` / `registerRadioProxySlice()`, called from `initSyncIntegration()`.
  - It uses `oros-radio-data`, the same contract as the `files-disk` and `shell` proxies.
  - The live iframe registration (merge-capable) overrides the proxy while open; the proxy re-activates on close (LWW).
- **Files:** `shell.js` (~lines 1798–1840 at the time).

### ≈2026-09-30 — Screen Pet v0.3.2 — full sync completion

- **Synced slices:**
  1. `pet` (`oros-pet-data`): per-field LWW. Temporal fields are their own clocks, anchor pairs travel together, `fm` covers name/palette, plus tombstones.
  2. `petEvents` (`oros-pet-events`): union by id, deterministic sort (ts, id), rolling trim 100, deterministic birthday ids, `clearedAt` wipe.
  3. `petSettings` (`oros-pet-settings`): calendar-feed toggle, per-field LWW via `calFeedTs`.
- **Fixes:**
  - `setCalendarFeed` never marked dirty (the settings setter suppresses dirty during its own write) → now armed explicitly after the write.
  - Legacy migration ran before `registerSync()`, so a migrated opt-out was never pushed → `bootLegacyDirty` arms the first push right after `registerSync()`.
  - `settingsSliceSet` keeps the legacy mirror key `oros-pet-calendar-sync` in lock-step, because unmodified `calendar.js` still reads it. `oros-pet-settings` stays the source of truth.
- **Migration:**
  - One-time: if `oros-pet-settings` is absent and the legacy key exists, it migrates in with `calFeedTs = 1` (beats the epoch-0 default, loses to any real write). The legacy key is kept as the mirror.
  - Old v0.3 logs merge on the first push; ver stays 1.
- **Device-local:** `oros-pet-enabled`, `oros-pet-minimized`, `oros-pet-pos`, runtime choreography.
- **Coverage:** auto snapshots, manual export/import and cloud push/pull cover all three slices (they enumerate registered slices).
- **Mixed versions:** carry mailbox (sync.js ≥ 0.9.2).
- **Files:** `pet.js` only.
- **Known cosmetics:** Section 2b-3 at zero indentation; the Wave 5b header comment lost the word "Calendar".

### ≈2026-09-30 — Calculator v1.1.0 — feature wave 1 (full rewrite)

- **Why a rewrite:** it replaces a broken v1.0.0 that failed CI on missing theme inheritance (v1.0.0 has no entry of its own). `CALC_VER` "1.1.0".
- **Architecture:**
  - Palette bridge on the mood.js pattern (`inheritPalette` before first paint + `watchPalette` MutationObserver).
  - Shortcut forwarding (Contract Β).
  - Sync slice "calculator" registered as `registerSlice(get, set, LS_KEY)` with key `oros-calculator-data`. ⚠ No `mergeFn` → see audit A2.
  - EN/EL lazy packs plus a separate troll pack. Language: `localStorage["oros-lang"]` first, then `parent.orosLang`, then "en".
- **Troll mode:**
  - Teasing language always; plausible lies sized by intensity, never two lies in a row.
  - Three intensities (Subtle ~16% / Balanced ~34% default / Rampant ~66%), persisted as `trollIntensity`.
  - Controls: right-click cycles the level on desktop. Touch uses a 500ms long-press: `touchmove` cancels, the trailing click is swallowed, and the mobile `contextmenu` double-fire is guarded by `touchActive`.
  - Indicator: dots ●○○/●●○/●●● plus a toast.
- **History:**
  - Synced, cap 50, LWW per entry by timestamp, tombstone map (id → ts); Clear = tombstone all.
  - Clicking an entry reuses it (fresh replace).
- **Other features:**
  - Copy result (clipboard API + `execCommand` fallback).
  - Ans key A (never holds "Error").
  - Single-level undo Ctrl+Z (snapshot before mutating presses; no-op presses drop it).
  - Negative results tinted (`.neg`).
  - History panel drag-resizable ≥880px (200–500px, `panelWidth` persisted).
  - Full keyboard support.
  - Unified notifications: `transientNote()` → `parent.orosNotifs.transient` (ns "calculator").
- **Fixes:**
  - `renderError()` was missing (ReferenceError on chained divide-by-zero).
  - `pressAns()` set `fresh=false` (Ans 42 then 5 → "425").
  - `pressEq()` stored "Error" in `lastAnswer`.
  - `lang()` read `window.orosLang` inside the iframe (R8).
  - Dead `stagePendingRemote`/`takePendingRemote`/`REMOTE_PENDING_KEY` removed.
  - EL "calc.key.back" mistranslation → «Διαγραφή».
  - The ⌫ key's `data-i18n` overwrote the glyph (now a translated `aria-label`); a duplicate `aria-label` assignment was deduplicated.
- **Known non-issues:** dead `state.lang` field; `pressAns` indentation drift.
- **Checks:** boot log `[calc] calculator v1.1.0 booted — troll:off intensity:1 history:N`; EL rendering; desktop right-click cycling; mobile long-press without flipping On/Off.

### ≈2026-09-30 — Calculator v1.2.0 — feature wave 2 (memory, scientific row, CSV)

- **Features:**
  - **Memory:** MC/MR/M+ as a half-height row above the keypad. Single value `mem` (null = empty), synced. M+ accumulates; MR recalls with fresh-replace semantics and resets the pending operator; MC clears with a toast.
  - **Scientific row:** an `fx` toggle shows √ (Error on negative), x², 1/x (Error on zero) and ± (the engine function existed since v1.0.0 but had no button). Visibility persisted as `sciOn`. All unary ops join single-level undo, including on the Error path.
  - **CSV export:** button next to Clear. Rows oldest-first (ISO timestamp, expression, result), RFC-4180 quoting, UTF-8 BOM (Greek-safe in Excel), CRLF, `oros-calculator-history.csv`. Empty history → toast, no file.
- **Fixes:**
  - `hydrate()` read the tombstone map AFTER filtering history, so entries deleted on another device resurrected on every reload (locally only) → tombstones now hydrate first.
  - `applyRemote()` normalizes a local payload lacking `deleted` before the merge loop (was a TypeError).
- **Schema:**
  - Added `mem` (number|null) and `sciOn` (boolean). Backward compatible.
  - ⚠ Merge rule "remote wins when present, else local" — contradicts R5; see audit A2.
- **Next:** keyboard shortcuts for memory deferred (A = Ans collision; candidates M = M+, R = MR).

### 2026-10-01 — Writer — audit Dose 1 + Dose 2 (full-file delivery)

- **Sync:**
  - `syncApi()` (R8): Writer was never registered from its iframe, so it was absent from cloud sync, DB export and snapshots.
  - Local-first hydrate before registration.
  - `sliceSet` folds in-flight keystrokes, persists, shows no toast, and keeps the caret.
  - `mergeSlices` made symmetric (R5).
- **Tabs and documents:** open tabs are device-local (`oros-writer-prefs`) with a one-time migration. New Documents manager (open, search, delete with Undo, tombstone R17).
- **Data-loss fixes:**
  - Typing with no open tab.
  - Typing within the debounce before "+".
  - Comment delete removed the commented text.
  - Version restore was a no-op.
  - Find focus jump overwrote matches.
- **Security:** MD attribute breakout; every import sanitized in an inert document.
- **UI and platform:** R14 themed dialogs; Contract Β + `e.code` shortcuts; language mirror (EL now works).
- **Versions:** auto on save (≤1 per 5 min, newest 8); versions carry footnotes and comments.
- **Goal:** fires once per goal (transient); the lock can be armed early; toolbar/paste are guarded; no document clone per keystroke. Notifications-exempt.
- **Export:**
  - `div`/inline lines normalized to `<p>`; nested lists in every format.
  - RTF `\plain` reset; localized appendix.
  - Comments stay private in HTML export.
  - PDF loads vendor files from `../vendor/` without a query string (works offline).
- **Import:** DB backup MERGES (restamped "now"); DOCX lists/ins/sdt; ODT nested lists.
- **CSS:** horizontally scrollable toolbar on mobile, docs manager, Undo toast, `[hidden]` at EOF.

### 2026-10-01 — Writer — Dose 3 (deep functional sweep)

- **No-doc state:**
  - Meta, page, versions, goal and export silently returned when no tab was open → `ensureDoc()` (lazy, R16-safe).
  - Boot opens the most recent doc.
  - Export always opens (DB export only on a blank page, with a hint).
- **Sync:**
  - Canonical `serialize`/`merge`: docs, templates and tombstones sorted; `tabOrder` = alive ids.
  - The device-local `tabOrder` inside the slice had caused an endless set+push ping-pong (proved with the real sync.js: never converged before, converges in 1 round after).
- **Import:**
  - RTF: the parser skipped the whole file (a 34-char look-ahead at the root `{`) → fixed, plus `\ansicpg` decoding.
  - ODT: automatic styles (b/i/u/s/sup) and sections.
- **UI:**
  - Quick Format stale `{once}` listeners ("every other time") → `AbortController`.
  - Tab rename: dblclick never fired → `div[role=tab]`, F2, no double rename.
  - Whole-word search on split text nodes → `normalize()`.
  - Goal button always opens the dialog.
  - Toolbar keeps the editor selection on touch.
  - Link dialog prefills from the remembered selection.
- **Storage:** images downscaled (≤1600px JPEG) on insert and paste; a quota failure warns instead of failing silently; auto versions size-budgeted per doc.
- **Verification (Chromium + real sync.js):**
  - Full sweep: 77/77 EN, 77/77 EL, 75/75 mobile ×2.
  - Second sweep: 24/24.
  - Two-device convergence: stable.

### 2026-10-01 — OROS_BIBLE.md — full revision + changelog consolidation

- **Structure:** restructured into Parts 0–XII. Added:
  - Part 0 (working agreement + session-start protocol);
  - Part IX decisions log;
  - Part X audit queue A1–A7;
  - Part VIII §F runtime test harness.
- **Rules:** new R26 (canonical slices), R27 (mtime only on real change), R28 (no silent no-ops), R29 (runtime-verified delivery), R30 (shared localStorage quota). R8 widened to all shell APIs + language resolution.
- **Corrections from re-reading the code:**
  - The notification trigger is `window.parent.orosNotifs.emit`; no `__orosNotify` global exists.
  - `KNOWN_APPS` has no dice; `emit()` has no `sound` field.
  - `oros-pet-events` is synced.
  - The Writer folder is `writer/`.
  - `vendor/xlsx` is not precached.
- **Changelog:** `CHANGELOG.md` is retired; the changelog lives in this Part. The raw entries that sat at the end of the old Bible were normalized into the format above with every substantive fact kept; the duplicate Calculator v1.1.0 entry was merged into one.
