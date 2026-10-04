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

---

orOS Changelog — To-Do → Calendar feed
Change
Added a read-only To-Do feed to the Calendar app (calendar.js). Tasks with a due date now appear as all-day red rows on their due day, with their own filterable feed label chip.

What was added
New feed label: lbl-feed-todo — red (#e06c75), named "To-Do" (EN) / "Εργασίες" (EL). Registered in FEED_LABELS, so it automatically appears in:
the month/day label filter chips row (renderChips),
the label manager's read-only "App feeds" section (immutable, 🔒 — born from FEED_LABELS, never from state.labels).
New feed reader: todoFeedOn(dateStr) in calendar.js — reads oros-todo-data (written by todo.js via shared same-origin localStorage), surfaces every uncompleted task whose due equals the cell date as an all-day event. Row title = task text (≤60 chars), note = task notes (≤500 chars). Completed tasks are deliberately skipped — a handled due date is not calendar noise.
Micro-cache (todoCache, ~1s refresh) — same pattern as the Contacts/Habits/Cycle/Mood/Kanban/Pet feeds, to avoid JSON.parse storms during month renders (~31 cells × paint).
Click-through: clicking a To-Do row calls the shell bridge __orosOpenTodo(listId) — deep-links to the task's list in the To-Do app. The bridge already existed (Wave 7 deep-link receiver in todo.js), no todo.js changes needed.
Sync cache invalidation: todoCache reset in setFromSync alongside the other feed caches, so a pull that refreshes To-Do data repainting immediately.
Standing contract (unchanged, verified)
Feed rows carry _feed: true and per-render keys (tdo-<itemId>-<date>): never stored in state.events, never synced, never exported in the .ics.
Corrupt/absent oros-todo-data yields no rows — standalone Calendar load unaffected.
No changes to todo.js; no changes to the synced blob schema; ver stays 1.
labelVisible("lbl-feed-todo") respected — the chip toggles the feed on/off like every other feed.
Patches applied
8 patches in calendar.js, strict OLD → NEW find-and-replace format: 1–2. i18n EN/EL — lbl.feed.todo string. 3. FEED_LABELS — new entry (red, between Kanban and Screen Pet). 4. feedLabelName() — new id branch. 5. Feed block (TODO_DATA_KEY, todoCache, todoRaw(), todoFeedOn()) inserted after kanbanFeedOn, before the Screen Pet feed comment. 6. eventsOn() — .concat(todoFeedOn(dateStr)) between Kanban and Pet. 7. openFeedRow() — new ev._todo branch routing to __orosOpenTodo(ev._todo.listId). 8. setFromSync — todoCache reset added.

Verification checklist (before stable)
 Month grid: task with due today shows a red dot on today's cell; day panel shows the all-day "Εργασίες" row.
 Completing the task removes the row within ~1s (micro-cache).
 Feed chip toggle hides/shows To-Do rows without affecting other feeds.
 Click on a To-Do row opens the To-Do app on the correct list.
 Recurring task shows only on its current due date (re-check re-dates it).
 .ics export contains no tdo- rows.
 Console: calendar.js v<x> boot clean, no new warnings.
Future work (under consideration)
Option to also show completed tasks on their due day (dimmed), if requested.
Cross-list source chip on the row (like To-Do's own search view) — deferred, keeps title clean for now.

---

orOS Changelog — Notifications Toast Stack (GNOME-style)
Feature
Toasts no longer overlap each other. The unified notification system now renders toasts in a vertical stack (GNOME-style): the newest notification slides in at the top and pushes older ones down, each toast keeps its own dismissal state, and a visibility limit keeps the stack on screen.

Files changed
notifications.js — all logic (stack container, stack-aware emitter, queue cleanup).
style.css — appended #oros-toast-stack / .oros-toast base rules at the bottom of the file.
Architecture
Single stack container: #oros-toast-stack, fixed top-right (calc(58px + safe-area-inset-top), right 20px), created lazily by ensureToastStack() on module init. Column flex, 8px gap, pointerEvents: none on the container (clicks pass through empty areas); individual toasts re-enable pointerEvents: auto.
Per-toast independence: every fireToast() creates its own DOM node, its own auto-remove timer, its own MutationObserver. No single-slot wipe anywhere — concurrent notifications (e.g. a mood check-in plus a Minimalism prompt) coexist visibly.
Newest-first ordering: insertBefore(toast, toastStack.firstChild) + toastQueue.unshift(toast).
Visibility limit — max 5: applyStackLimits() walks toastQueue; toasts at index ≥ 5 get opacity: 0, pointerEvents: 'none', and stay mounted (their timers keep running; they expire normally). Promotions run on BOTH membership changes: insertion (end of fireToast) and removal (observer callback) — see Bug 3.
Position setting retired by design: the stack is pinned top-right per the orOS toast doctrine («top-right, below the clock»). The position setting value persists in existing slices but is inert.
Bugs found during self-review (post-first-implementation audit)
The first pass (patches 1–5 in chat) worked for the basic case but verification against the actual file caught five defects, all fixed before release:

Dead double-mount: legacy document.body.appendChild(toast) survived alongside the stack insert (functionally harmless — insertBefore relocated the node — but dead and misleading). Removed together with the orphaned requestAnimationFrame opacity flip.
Visibility limit broken by the rAF flip: the async requestAnimationFrame set opacity: '1' AFTER the enforcement loop dimmed excess toasts, resurrecting toast #6+. Fixed by folding the opacity 0→1 flip into applyStackLimits() itself.
Queue never shrank — observer watched the wrong parent: the cleanup MutationObserver observed document.body while toasts lived in #oros-toast-stack; childList mutations on body never fired, so removed toasts stayed in toastQueue as detached nodes forever, corrupting the visibility-index math. Fixed: observer attaches to toastStack, removal splices the queue and calls applyStackLimits().
Z-index ladder violation: stack shipped at 9999 (same tier as the boot splash) violating the documented ladder rule «toasts must never fall behind the splash». Fixed to 10000.
No promotion on removal (introduced by my own Patch 3 of the fix round): hidden toasts (index ≥ 5) never reappeared when their seniors closed, because the limit loop only ran on insertion. Fixed by extracting applyStackLimits() and calling it from the observer's removal path too.
Behaviors preserved (verified, unchanged)
Inbox/badge/sync contracts: toasts are visual only; emitCandidate, transientToast, notifSliceSet, markAsRead, dedup, quiet hours, app toggles, 24h badge-fallback rule — untouched.
Undo-bearing toasts keep their extended window (≥ 8s).
Deep-link router and per-app bridges unchanged.
Native Web Notifications logic unchanged (in-tab toasts unaffected).
Per-app timers survive unrelated dismissals (each toast cleans up only its own timer via its observer).
Known trade-offs / open items
Insertion animation: a brand-new toast may appear without a slide-in (insertion and opacity:'1' land in the same frame); older toasts still shift smoothly. Optional fix on the table: call applyStackLimits() inside requestAnimationFrame at the end of fireToast.
Dead code awaiting deletion (needs owner approval before removing): TOAST_POSITIONS constant, getPositionStyles() function, and the unused const position = getSetting('position', ...) inside fireToast. Legacy slices carrying a position value are harmless; do NOT migrate or strip the key — LWW settings merge tolerates it.
Excess (>5) toasts are invisible-but-mounted rather than summarized («+N more» counter considered, deferred — no UI surface designed yet).
Testing checklist
 Two simultaneous notifications → both visible, stacked, no overlap.
 Newer notification appears above; older slides down smoothly.
 Six+ simultaneous → exactly 5 visible; closing one reveals the next.
 Dismiss (✕), click-through (deep link), timeout — only the targeted toast disappears.
 Undo-action toasts keep ~8s window in a full stack.
 Toasts render above the boot splash layer if ever co-present (z-index 10000).
 Mobile (≤ 480px): stack fits width (maxWidth: 90vw), safe-area respected.
 No console errors; [orOS][notifs] Module v1.0.0 initialized still boots clean.
 Console check after >6 fires then removals: toastQueue length shrinks (no detached-node buildup).
Bible rules to record
Toast layer = GNOME stack semantics: newest on top, max 5 visible, promote-on-removal. Container pointerEvents: none, children auto.
Z-index ladder addition: #oros-toast-stack = 10000 (above splash 9999, below inbox panel 10001).
Stack observers MUST observe the element that actually parents the observed node (toastStack, not document.body) — a generic-body observer is the canonical trap this feature nearly shipped with.

---

CHANGELOG — orOS Calculator v1.3.0
Calculator — Keyboard reliability (v1.3.0)

Fixed: number row and numpad now work even when focus is on the shell. Root cause: the calculator runs inside an iframe and browsers deliver keydown events only to the focused browsing context; until the user clicked inside the window, no keys reached the app. Added wireParentKeyRouting(): a same-origin keydown listener on the parent document forwards unmodified key events into onKey, with guards for stale listeners (window closed, root not connected) and for shell input fields/modals (input, textarea, select, contenteditable). Since browsers dispatch keys only to the focused context, this never double-handles events when the iframe itself has focus.

Fixed: numpad now works with NumLock OFF. e.key on numpad keys in that state is "End", "PageUp", etc., so the old onKey ignored them. onKey now maps physical e.code values (Numpad0-9, NumpadAdd/Subtract/Multiply/Divide/Decimal/Enter) to their NumLock glyphs; with NumLock ON behavior is unchanged.

Fixed: after clicking a keypad button, Enter and Space re-triggered the focused button (double evaluation on =, stuck repeats). The delegated pad click handler now calls btn.blur() after each action.

Shell contracts unchanged: modifier combos (Ctrl/Cmd/Alt) are still excluded from forwarding, Contract B shortcut forwarding is untouched, modifier keys remain reserved for the shell.

Verification steps: open Calculator from the orOS menu without clicking inside the window, then type on the number row and numpad (both NumLock states) — digits, + − × ÷, Enter/=, Backspace, ESC, %, Delete, Ans must all respond immediately. Then click any keypad button and press Enter — the action must fire exactly once.

---

Weather tray — fetch throttle hardened (shell.js, wxBusy) Fixed the intermittent "Athens — waiting…" chip state on boot. Root cause: the shell stamped the 30-minute throttle (oros-wx-last) BEFORE starting the fetch — a killed in-flight request (tab close / PWA controllerchange auto-reload) left the stamp armed, the cache empty, and the catch-path rewind unreachable, locking the chip for up to 30 minutes. Open-Meteo replies carrying an HTTP error/rate-limit JSON body took the same silent-lockout path. Changes: (1) new wxBusy in-flight guard prevents stacked parallel fetches (boot tick + boot call no longer double-fire); (2) the 30-min throttle is now bought ONLY by a successful fetch, written in the success branch; (3) a response without a usable payload rewinds to the 2-minute retry window; (4) the catch path also releases wxBusy. weather.js verified compatible — no changes required; its app-cache shape (per-city current.temp/current.code) and the 0.15° mirror into oros-wx-cache match the shell's adoption path. One-time cleanup for devices already carrying the bad state: remove oros-wx-last once or wait out the stale window.

---

CHANGELOG — orOS Radio / Core Integration
v0.2 (Hotfix — Tray Host Registration)
Fixed
RF-1: Radio tray chip never appeared in the taskbar (shell ⇄ radio host bridge)

Symptom: With the Radio app playing, no playback chip appeared in the orOS taskbar. Console check on the top frame (typeof window.__orosRadioHost) returned undefined indefinitely.
Root cause: ensureHost() in radio.js built the shell-hosted audio host correctly (audio element appended to the parent document, Media Session wiring, listeners, full API) and returned it into the module's local closure variable — but never attached it to the shell window. The shell's radioTrayTick() (runs every second from the taskbar clock tick) requires window.__orosRadioHost on the parent window with api.getState exposing current.name; since the host lived only in the iframe closure, the tray check found undefined and silently skipped chip creation every tick. By design there was no console error to surface it.
Fix: One guarded assignment at the end of ensureHost() in radio.js, before return host:
if(!w.__orosRadioHost) w.__orosRadioHost = host;
Location: immediately after the Media Session try/catch block.
Safety analysis:
The early-return check at the top of ensureHost() (if(w.__orosRadioHost && w.__orosRadioHost.audio && w.__orosRadioHost.audio.isConnected)) now finds the existing host on app reopen and reuses it — consistent with the FIX-RX-5 duplicate-audio-element prevention model.
Shell-surviving playback on app close remains intact: audio, host, and now the host reference all live on the parent window.
No changes to playback logic, sync slices, favorites, or Media Session handling — visibility of the host to the shell only.
Verification steps performed
Confirmed host contract at top frame: window.__orosRadioHost → "object"; window.__orosRadioHost.api.getState().current.name → active station name.
Chip appears within ~1 second of playback start (tick cycle of radioTrayTick()).
Confirmed host survives app close (audio keeps playing, chip persists) and host reuse on app reopen (no duplicate audio[data-oros-radio] elements in the shell DOM).
Unchanged / notes for future sessions
The state shape expected by the shell (getState() → { current: { name, ... }, paused, playing, flags: { buffering, error }, sleepUntil }) was already correct — only the registration line was missing.
Tray icon registration via shell.orosTray.register("radio", ...) in registerTrayIcon() is a separate mechanism from the shell's radioTrayTick() chip; both now operate on the same exposed host.
Pending Radio items from earlier waves (per project tracker, not addressed here): favorites/recents sync-on-new-device verification, genre filter sanity check (already addressed via /json/tags?order=stationcount in W3 diagnostics).

---

Date: 2026-10-02 Scope: Contacts, Notifications (notifications.js), Bookmarks (bookmarks.css)

CONTACTS — Share button on contact view card
Added a Share button next to Edit in the read-only contact view card (#ct-view):

Desktop (no navigator.share): copies a full plain-text dump of the contact to the clipboard (name, nickname, org, job title, phones, emails, addresses, websites, IM, events, relations, note — one line per field, typed). Toast confirms success or failure.
Mobile (navigator.share present): opens the native share sheet with the same text as payload.
Clipboard path: async Clipboard API first, execCommand textarea fallback for non-secure contexts / older browsers (legacyCopy).
New i18n keys (en + el): ct.share, ct.share.done, ct.share.fail.
New .ct-view-share CSS class (secondary style: transparent bg, border, dim text; hover lifts to primary text color) in the injected view-card stylesheet — Edit keeps the accent as primary action.
Plain text only by design: nothing new is stored, nothing synced, no privacy surface added. Possible future work: .vcf payload in the mobile share sheet (deferred).
NOTIFICATIONS — toast position setting was never applied (FIXED)
Bug: changing the toast position in settings had no effect — the stack stayed top-right regardless of selection.

Root cause:

fireToast() read the 'position' setting but never used it (dead local variable).
ensureToastStack() hardcoded top-right placement and ran only once — the persisted container was never repositioned.
getPositionStyles() (the full 8-position map) was dead code, called nowhere.
Fix (4 patches to notifications.js):

New applyStackPosition(): moves the LIVE stack container per the persisted setting. Clears all placement keys (top/bottom/left/ right/transform) before writing the new ones, so switching positions never stacks conflicting values.
setSetting('position') now calls applyStackPosition() — position changes apply immediately while the shell is running.
init() applies the persisted position right after ensureToastStack().
fireToast() lazy-creation path also calls applyStackPosition() if the stack was just built.
Behavior detail: bottom-edge positions (bottom, bottom-left, bottom-right) flip the stack to column-reverse so newest toasts appear lowest (GNOME shell convention). DOM order, MutationObservers and applyStackLimits() queue discipline are untouched.

Known limitation (accepted for now): a position change arriving via sync pull (notifSliceSet) is NOT applied live — it takes effect on next boot. Optional PATCH-5 (applyStackPosition() at the end of notifSliceSet) drafted, not applied.

BOOKMARKS — dead/incorrect CSS cleanup for the three-button rows
Context: each bookmark row now carries three action buttons (Favorite star, Edit pencil, Open). Follow-up corrections to bookmarks.css:

Removed .item .open-btn:last-child { margin-left: auto } and the .item .open-btn[title*="remove"] svg rule (the latter broke in Greek locale — "remove" does not match localized titles; the fill is now handled inline by the JS patch, so the CSS hook was redundant).
Row gap tightened 10px -> 8px in #items li.item (three buttons need breathing room).
The previously added ".item { gap: 8px }" block after .host-text was DEAD (lost specificity vs #items li.item — ID beats class) and was replaced by a properly specific mobile block: #items li.item padding/gap + .item .open-btn 28px on max-width 480px.
Removed the dead ".item.open-btn { display: none; }" rule and duplicated padding from the Section 11 mobile media query — it never matched anything (it targeted an element carrying BOTH classes; the button only has .open-btn).
Net effect: the three row buttons (star/pencil/open) render correctly on desktop and mobile, with the star filling via JS inline fill when favorited.

Standing rules reaffirmed this session
Patches are delivered as exact OLD -> NEW copy-paste blocks with searchable OLD text and precise location instructions; no guessing, no hallucinated segments — missing files are requested explicitly.
All changes verified against the actual file contents provided in the session before any patch was proposed.
No user data shapes were altered: Contacts and Notifications schema/slice contracts untouched (no migration needed, no sync version bump required).

---

## RULE — All popups render centered on screen

Every dialog and popup panel in every orOS application must appear
vertically AND horizontally centered on the screen. This is not
per-element discretion; it is a system-wide convention.

Implementation requirements:
1. Native `<dialog>` elements MUST declare `margin: auto` explicitly.
   Reason: every orOS app stylesheet contains `* { margin: 0 }`,
   which overrides the user-agent default `margin: auto` on dialog
   and silently breaks native centering (dialog docks top-left).
   Recommended: `margin: auto; max-height: calc(100vh - 32px);`.
2. Overlay panels (non-<dialog> popups) MUST use
   `position: absolute; top: 50%; left: 50%;
   transform: translate(-50%, -50%)` inside a fixed full-inset
   overlay (`position: fixed; inset: 0`). Panels must NOT set
   inline style.top/style.left from JS anchor math — that defeats
   the CSS centering.
3. Long content inside a centered popup scrolls within the popup
   (overflow-y: auto + max-height), never pushes it off-center.
4. EXCEPTION — context menus (right-click / long-press, e.g.
   #ctx-menu) are anchored at the pointer/touch position BY DESIGN.
   They are excluded from this rule; centering them would defeat
   their purpose. Only modal dialogs and overlay panels center.
5. Existing apps must be retro-fitted (audit checklist item),
   new apps must comply from the first commit.
   
   ---
   
   CHANGELOG — orOS Session 2026-10-02
Contacts — View card now vertically & horizontally centered
Bug: The read-only contact view card (#ct-view) opened aligned to the top of the screen (flex align-items: flex-start) instead of being vertically centered.

Fix: Applied margin:auto to .ct-view-card and removed align-items:flex-start from #ct-view. Result: card centers on both axes while remaining fully scrollable when content exceeds viewport height. Mobile sheet mode (≤520px) unaffected (full-screen via min-height:100%).

Bible note added: Flex overlays MUST use margin:auto on the panel (not align-items:center on the container) to avoid flexbox overflow clipping where top content becomes unreachable by scroll.

Contacts — Share button added (desktop + mobile)
New button next to Edit in the view card footer (Share / Κοινοποίηση).
Desktop: copies full plain-text contact dump to clipboard (name, nickname, org, job title, phones, emails, addresses, websites, IM, events, relations, note) → toast on success/failure.
Mobile: opens native Web Share sheet (navigator.share detection + UA sniffing for Windows/macOS exclusions).
Clipboard path: async Clipboard API with execCommand fallback (legacyCopy).
New i18n keys: ct.share, ct.share.done, ct.share.fail (en + el).
CSS class .ct-view-share (secondary style: transparent bg, border, dim text; hover lifts to primary).
No data stored, no sync impact.
Bookmarks — Three-button rows (favorite, edit, open)
Each bookmark row now carries three action buttons:

★ Favorite (fills when active)
✏️ Edit (opens dialog without opening link)
↗ Open (increments visit count)
CSS cleanup: Removed dead .item .open-btn:last-child margin rule and locale-sensitive [title*="remove"] selector (JS inline fill handles star state). Tightened row gap 10px → 8px for three-button breathing room. Mobile overrides properly specific (#items li.item not .item).

Bookmarks — All dialogs & panels now centered
Native <dialog> elements: explicit margin:auto added (contacts.css follows bookmarks.css pattern) + overflow-y: auto guard for long content.
Tags panel (#tags-panel) & Duplicates panel (#dupes-panel): top:50% left:50% transform:translate(-50%,-50%).
Inline anchoring JS removed from showTagsPanel() and showDupesPanel() (panels inherit centering from CSS overlay).
Context menu (#ctx-menu) remains pointer-anchored (explicit exception in Bible).
Notifications — Toast position setting now applied live
Bug: Changing toast position in settings had no effect — stack stayed top-right regardless of selection.

Root cause: fireToast() read 'position' but never used it; ensureToastStack() ran once with hard-coded placement; getPositionStyles() (8-position map) was dead code.

Fix:

New applyStackPosition(): moves LIVE stack per persisted setting, clears conflicting placement keys before writing new ones.
setSetting('position') calls applyStackPosition() — immediate application.
init() applies position after ensureToastStack().
Lazy creation path in fireToast() also calls applyStackPosition().
Bottom-edge positions use column-reverse (GNOME shell convention: newest toast lowest).
Known limitation: Position change via sync pull (notifSliceSet) takes effect on next boot (optional PATCH-5 drafted but not applied).

Standby rules reaffirmed
Patches delivered as exact OLD → NEW copy-paste blocks with searchable text.
All changes verified against actual file contents before proposal.
No user data shapes altered (schema/slice contracts untouched — no migration needed, no sync version bump).

---

6. IMPLEMENTATION NOTE — flex overlays: center the panel with
   `margin: auto` ON THE PANEL, never `align-items: center` on the
   flex container. Reason: with `align-items: center`, a panel taller
   than the viewport gets its TOP clipped and unscrollable (classic
   flexbox overflow-clipping bug — the classic safe-crossing pattern
   is to stay at flex-start and let auto margins absorb free space).
   `margin: auto` centers when there is free space and yields to
   scrolling when there is not. Reference implementation:
   contacts.js view card (#ct-view + .ct-view-card). The same
   technique is what native <dialog> uses internally (margin: auto
   against its inset:0 box), which is why FIX-1 in bookmarks.css
   restores exactly that.
   
   Wave: Contacts Round 3 — Backup/Restore & Fixes (contacts.js)

Verified against contacts (4).js. Applied: PATCH-1..5.

Share gate (Wave 1 carry-over, VERIFIED): shareContact() now uses shareOnMobile() — desktop (Windows NT / Macintosh / X11 / CrOS UA) always copies to clipboard with legacyCopy fallback; Android/iOS get the native share sheet. Toast via unified notifications (notifyTransient) with local toast fallback.
Debounced search (VERIFIED): 250 ms closure-captured value (var v) — no this.value inside setTimeout bug.
Quick filter tabs (VERIFIED): "All" / "★ Favorites" chips via quickFilter state, i18n keys ct.filter.all / ct.filter.starred (EN + EL), injected .chip.qf CSS (no contacts.css dependency). Exclusive from label VISIBILITY toggles (labelVis).
Keyboard shortcuts (VERIFIED): Ctrl/Cmd+F focuses search, Alt+N opens new-contact dialog (Ctrl+N is browser-reserved), Escape closes view card → ct-dlg → del-dlg → merge-dlg → lbl-dlg in priority order.
JSON export (VERIFIED): exportJson() dumps { app, ver, labels, contacts, deleted } — full DB incl. tombstones (zero-loss backup per project mantra). Button injected next to Export vCF, inherits className.
NEW — JSON import/restore (PATCH-1/2/3): "Import JSON" button (injected, self-contained hidden file input). Validates shape (app === "contacts", contacts array), then merges via the SAME mergeContacts union-by-id/bigger-mtime/tombstone contract used by cloud sync, landing through setFromSync. Restore == cloud pull: never overwrites newer local edits, never resurrects phantom deletes, persists + marks dirty (propagates to cloud). Hoisting note: mergeContacts/setFromSync are function declarations → callable from the earlier wiring.
FIX — label popover listener leak (PATCH-4/5): renderLblList() previously added one document "click" listener per render (unbounded accumulation). Now a single delegated closer (module-scope lblPop/lblPopOwner/closeLblPop, registered once). Behavior preserved: toggle same dot, switch on different dot, close on outside click.
Wave 2 verification CLOSED: calendar.js feed contract (day "MM-DD", type whitelist, optional label ≤40, year 1850–2200|null) matches contacts sanitizers byte-for-byte. Birthday feed green #9ece6a, anniversary pink #f28fb6, custom brown #c8a96e — full loop operational.
Known cosmetic notes (NOT fixed, deliberate): renderMergePreview uses innerHTML with trusted i18n strings only; stray 4-space indent on calendar.js eventsOn. Zero functional impact.
Standing rules reconfirmed: full manual export must be restorable (now true for JSON export/import); restore paths reuse the sync merge contract (never blind overwrite); all UI strings bilingual EN/EL via i18n keys; no dependencies on unseen CSS/HTML files — new UI is JS-injected.

---

Wave: Contacts Round 4 — vCard round-trip & shortcut guards (contacts.js)

Verified against contacts (5).js + index (2).html + contacts (2).css. Applied: PATCH 1–7.

FIX — custom events vCard round-trip (PATCH 1): parseVcardBlock now parses our own X-EVENT;TYPE=CUSTOM;X-LABEL= export form (full date, compact legacy date, and yearless "--MM-DD" variants). The X-LABEL param is extracted with escaped-atom tolerance (params re-joined before regex, THEN vcfUnesc) because vcfEsc escapes ";" and "," inside labels. Custom events (namedays etc.) no longer silently vanish when our own .vcf export is re-imported or opened on Android/Google.
FIX — dedup nameKey accent folding (PATCH 2): nameKey now uses greekFold (lowercase + diacritics strip + final sigma fold), so Greek names differing only in accents collapse to one duplicate key.
FIX — importParsed fill coverage (PATCH 3a/3b): the update-in-place path now also fills photo on empty, and union-merges addresses (by street+city+zip), websites, and IM handles exactly like phones/emails — re-importing a fuller vCard over an existing contact no longer drops those fields.
FIX — Alt+N shortcut guard (PATCH 4): Alt+N for "new contact" is ignored while any dialog (ct-dlg/del-dlg/merge-dlg/lbl-dlg) or the view card is open — an accidental keypress can no longer silently discard typed edits.
FIX — Ctrl+F shortcut guard (PATCH 5): Ctrl/Cmd+F focus-search is skipped while a dialog or view card is open, so the focus never jumps out of an open modal's inputs.
FIX — injected button order (PATCH 6): the Import JSON button is now anchored after the Export JSON button. Toolbar order: [Export] [Export JSON] [Import JSON].
FIX — dedup member rows keyboard access (PATCH 7): duplicate-group members are real button elements (Enter/Space open the merge dialog), matching the main contact list's keyboard behavior.
Verified COMPLETE (no action): previous wave's patches all present byte-for-byte (share mobile-gate, debounced search, quick filter tabs, keyboard shortcuts, JSON export/import via mergeContacts+setFromSync, shared label-popover closer — zero document-listener leaks).
Deliberate non-fixes (recorded): renderMergePreview innerHTML uses trusted i18n strings only; static page title consistent with suite; calendar.js eventsOn indentation is in another file, cosmetic only.
Rules reconfirmed: imports never overwrite user-curated values (fill-empty + union-by-key only); restore paths reuse the sync merge contract; every fix is self-contained in contacts.js (no HTML/CSS edits needed this round); patch format stays strict OLD→NEW with searchable anchors.

---

Kanban — Import from other apps (Kanri / Trello)

Feature: Users can migrate data from other Kanban applications via JSON file import.

What was added:

Import button (upload icon) in the board header actions, between New board and Manage
"Import from other apps" entry in the board dropdown
Import dialog with file picker (.json), automatic source detection (KanriData vs Trello board export), dry-run stats preview (boards/cards/labels counts) and a two-button footer (Cancel/Import)
Import adapters: Kanri (boards/columns/cards, globalTags + per-card tags to labels, card color mapped to a color label via Tailwind-class table, description to notes, tasks to subtasks) and Trello (lists to columns, cards, desc to notes, due to card.due — feeds Calendar via existing due pipeline, labels mapped to closest swatch colors, closed lists/cards skipped)
Full i18n support (English + Greek) for all import strings
Architecture decisions (standing rules):

Imported boards are NEW entities following the duplicateBoard pattern: fresh mtime/om so they win LWW merge battles; existing boards are NEVER touched
All imported ids carry prefixes ("imp-k-" Kanri, "imp-t-" Trello) to prevent uid() collisions; re-importing the same file replaces the same board ids (idempotent, zero duplicates) and stays consistent with union-by-id sync merge on a second device
Import pushes a REAL undo snapshot before mutation (pushUndo) — Ctrl/toast Undo restores the full pre-import state; no second toast kills the Undo button
Dialogs are built dynamically by kanban.js (manage-dialog pattern); index.html is untouched; the dialog inherits the global dialog CSS so it is automatically theme/skin-safe
Card search/filter state is reset via resetSessionView() on import (the search must not hide the freshly imported cards)
Files changed: kanban.js (i18n strings, board header button, dropdown entry, section 9b import engine), kanban.css (.board-import, .imp-hint / .imp-file / .imp-preview, disabled-state for dialog footer buttons). index.html unchanged.

Known notes:

Kanri subtask completion flag is read from st.done (defensive fallback to unchecked if the field name differs in a future export — data-safe either way)
Trello checklists: real Trello exports keep checklists top-level (data.checklists + idChecklists); fixed via checkByCard precompute — pending application of FIX-1a/1b if not yet applied
Under consideration (need real export samples before implementation, per the "No guessing" rule): Brisqi (CSV), KanbanFlow (JSON/CSV/XML), Taiga (project JSON dump)
Testing checklist:

Open board dropdown — Import entry below "New board"; icon button in header between New and Manage
Import button opens dialog with file picker
Select the Kanri export JSON — preview shows "Detected source: Kanri" with stats; Import button enables
Import creates the new boards (e.g. "Βιβλία", "Μουσική") with all columns/cards/labels/subtasks and switches to the first one
Re-import the same file — boards are replaced, not duplicated
Undo (toast button) — full pre-import state restored, win in next sync merge
Unknown file — "no Kanban data found" message, Import stays disabled

---

CHANGELOG — v0.38.25
(orOS core — Retirement of the localStorage snapshot subsystem)

REMOVED

Entire localStorage-based "local snapshots" feature: SNAPSHOTS_KEY, SNAPSHOT_MAX, getSnapshotBody, readSnapshots, writeSnapshots, restoreLastSnapshot and all snapshot UI in renderSyncSection. The "storage is full" warning (sync.err.snapshot.quota toast path) is gone by design: the storage that filled up no longer exists.
Shortcut scSnapshot's old behavior (restore last snapshot). The combo Ctrl+Alt+Shift+S now triggers a LIVE folder export instead.
CHANGED

writeSnapshotFile(body, manual) now accepts a full data payload. Auto exports capture the database at dispatch time via exportBodyNow() (fresh orosSync.exportData() call, never a stored list read). The manual path (Choose/Reconnect buttons) captures the body NOW for instant proof of function.
The auto-backup scheduler (maybeAutoExport) is retained: daily/weekly/monthly cadence, boot check, tab-visible check, zero background timers. "Off" keeps its zero-footprint contract.
chooseBackupFolder warns honestly when the auto-backup mode is off (sync.fsfolder.enablefirst) instead of failing silently.
scSnapshot (Ctrl+Alt+Shift+S): honest error when auto-backup is off; otherwise dispatches an immediate live folder export. Confirmation ("sync.ok.fsfolder.saved") fires only when the file actually landed in the folder.
Info modal capability line (sc.info.cap) and sync.fsfolder.enablefirst copy updated to reflect the new architecture: "Auto backup to folder", backups written straight to the user-chosen folder.
FIXED

translations.js: restored the corrupted notifs.on key (the earlier patch had mistaken the primary definition for the duplicate); removed the genuine duplicate entries (sc.desc.reconnect, notifs.on). All keys referenced by shell.js verified present in both EN and EL.
ARCHITECTURE NOTES

Auto-export to local folder (File System Access API, Chromium desktop) remains the ONLY snapshot mechanism: progressive enhancement, permission-lapse detection with one-click Reconnect, folder-mirror files (orOS-snapshot-*.json) wiped by factory reset.
state.autoexport continues to travel in the shell slice (pull-fed sets never mark dirty — anti-loop contract preserved).
Old localStorage snapshot keys on upgraded devices are inert leftovers; factory reset removes them via the oros- prefix sweep.
UNDER CONSIDERATION

Retitle sc.desc.snapshot from "Take database snapshot now" to "Export backup to folder now" (terminology alignment).
Delete orphaned translation keys sync.ok.snapshot.saved and sync.err.snapshot.quota.
Wrap exportBodyNow()'s JSON.parse in try/catch inside maybeAutoExport.

---

Weather tray — boot "Athens - waiting..." fix
Problem: On boot, the tray chip showed Athens - waiting... indefinitely. Opening the Weather app "fixed" it.

Root cause: wxAdoptAppCache() adopted the Weather app's city cache unconditionally on every 60s tick, regardless of freshness. A stale app entry (e.g. 7h old, from the app not being opened all day) was copied over the tray's freshly fetched cache. Result: chip paints from stale cache (>3h → "waiting") while WX_LAST was stamped by the successful fetch, arming the 30-min throttle — nothing retried, nothing recovered until the app itself refreshed. Diagnostic confirmed: cache age 420 min vs. last-fetch age 8 min.

Fixes (shell.js):

Freshness guard in wxAdoptAppCache — the app cache is now adopted only when it is strictly newer than the current tray cache (p.at <= cur.at → skip). "Newer wins" replaces "app wins": the two sources can no longer overwrite each other's fresh data.
Stale-cache throttle bypass in wxFetch — when the 30-min throttle is armed but the cache is older than the throttle period itself (the "successful fetch, waiting chip" contradiction), the fetch proceeds instead of returning. Self-heals the stuck state at the next tick instead of holding it for up to 30 min.
Notes:

Behavior during genuine network outage is unchanged apart from retry cadence in the pathological stale-cache case (~60s via the clock-tick retry instead of 2-min); failure-notification dedup (one inbox line per day) still applies.
wxAdoptAppCache remains the single nearest-city source of truth (~15km, WX_NEAR_DEG) for both the tray chip and the morning briefing — no change to that contract.
Project mantra intact: offline-first (offline never paints a fake temperature), no external deps beyond Open-Meteo, no user data touched.
Files changed: shell.js (two patches, wxAdoptAppCache + wxFetch).

Under consideration: none.

---

## v0.38.26 — 02 Oct 2026

### REMOVED
- Translation keys `sync.ok.snapshot.saved` and `sync.err.snapshot.quota` (EN and EL) — unused since the snapshot subsystem retirement.
- All legacy references to the deprecated localStorage-based snapshot system.

### CHANGED
- Terminology alignment throughout UI and codebase: `snapshot` → `backup` / `αντίγραφο`:
  - Button label `sc.desc.snapshot` updated to "Export backup to folder now" / "Εξαγωγή αντιγράφου σε φάκελο τώρα"
  - Translation `sync.ok.fsfolder.saved` updated to "Backup written to folder"
  - Reset hint `sc.reset.hint` updated to mention "folder backups" instead of "snapshots"
- Auto-export function renamed internally: `writeSnapshotFile()` → `writeBackupFile()`
- Manual export shortcut callback renamed: `scSnapshot()` → `scBackupNow()`
- Backup file naming convention updated: `orOS-snapshot-YYYY-MM-DD.json` → `orOS-backup-YYYY-MM-DD.json`
- Factory reset description clarified to distinguish between cloud sync, folder backups, and local settings

### IMPROVED
- `maybeAutoExport()` now wraps `exportBodyNow()` in try/catch — an engine hiccup during `JSON.parse(window.orosSync.exportData())` degrades to a silent skip instead of an uncaught async error on boot or visibility-change path
- Legacy cleanup routine (`wipeFolderMirror`) retains compatibility with older `orOS-snapshot-*.json` files from previous versions while targeting new `orOS-backup-*.json` files

### NOTES
- The translation key name `sc.desc.snapshot` was intentionally retained (only its displayed text changed) to avoid cached shell.js / new translations.js mismatch that would briefly show raw key names
- Dropbox Sync, manual database export, and auto folder export remain fully functional and independent
- No user data affected by this change; existing snapshots/backups remain valid

New core module ritual:
1. Create the file (IIFE, boot log, zero dependencies).
2. index.html: <script src="module.js?v=CURRENT"> — BEFORE shell.js if the shell
   or apps consume it at boot; AFTER shell.js if it depends on the shell.
3. sw.js PRECACHE_URLS: add "./module.js" next to its siblings in boot order.
   ⚠ G2 does NOT check root files — this step is manual and easy to forget.
4. bump-version.yml: no change (generic stamping).

---

dialogs.js — Wave 2: App Migration (orOS v0.38.x)
Scope: Bookmarks migrated to window.parent.orosDialog (first app in the Wave 2 sequence). Writer remains last by explicit decision.

Changed — bookmarks.js
Export (Netscape HTML) now routes through orosDialog.saveFile: native save picker on Chromium desktop, standard download everywhere else (Firefox, Safari, mobile). Cancel = silent exit, no success toast. Anchor-download path retained ONLY as standalone fallback (app running without the shell).
Import now routes through orosDialog.openFile with accept ".html,.htm,text/html". Cancel = silent exit. The old hidden #import-in input mechanism is now dead code in bookmarks.html (safe, unused); removal pending a separate HTML pass.
Added dialogHost() helper (parent lookup, cross-origin guarded, null in standalone mode) and localPickFile() helper (standalone one-shot hidden-input picker). Pattern identical to syncHost() resolution order.
Zero changes to merge/sync/render/state logic. All patches verified against actual file contents before delivery.
New standing rule (recorded for OROS_BIBLE.md)
Rule — Unified File Dialogs:

Every application that performs ANY file save or file open operation — old apps being migrated and every NEW app from this point forward — MUST route through window.parent.orosDialog (dialogHost() parent lookup, cross-origin guarded) with a local standalone fallback. Direct calls to showSaveFilePicker / showOpenFilePicker / ad-hoc anchor-downloads in app code are PROHIBITED.
The only sanctioned exceptions: (a) the orosDialog module itself, which owns the fallbacks; (b) app-local standalone fallbacks when no shell is present (must be visually and functionally equivalent patterns).
Recommended per-app helper trio: dialogHost(), and a local picker fallback — copy the exact Bookmarks implementation as reference implementation.
Convention: user-cancel (ok:false / null) is a SILENT exit — no toast, no error.
UI text is i18n-aware (EN default, EL) for any dialog-related strings introduced by an app.
Pending
Wave 2 order: files.js → notes.js → writer.js (LAST). Each file audited in full BEFORE proposing patches; patches only where direct FSA/API calls or ad-hoc download patterns exist.
bookmarks.html: remove dead #import-in element (separate pass).
Wave 3 (approved, optional): info-modal mode line in shell.js ("Native file dialogs" / "Standard downloads").

---

dialogs.js — Wave 2: App Migration (orOS v0.38.x) — update
Scope: Calendar migrated to window.parent.orosDialog. Third app completed in the Wave 2 sequence (after Bookmarks, Calculator). Writer remains last by explicit decision.

Changed — calendar.js
ICS export now routes through orosDialog.saveFile: native save picker on Chromium desktop, standard download everywhere else. Cancel = silent exit, no success toast. Anchor-download path retained ONLY as standalone fallback (no shell present).
Added dialogHost() helper (parent lookup, cross-origin guarded, null in standalone mode), placed immediately after the __orosSyncApi markDirty() bridge. Pattern identical to Bookmarks/Calculator reference implementations.
Zero changes to recurrence engine, ICS serialization (icsEsc/icsDt/RRULE), feeds, merge logic, dialogs. Patches verified against actual file content before delivery.
Read-only app feeds (Contacts/Habits/Cycle/Mood/Kanban/To-Do/Pet) untouched — they read localStorage, not the filesystem.
Wave 2 progress
✅ bookmarks.js (3 patches: dialogHost + localPickFile, export, import)
✅ calculator.js (2 patches: dialogHost, CSV export)
✅ calendar.js (2 patches: dialogHost, ICS export)
⏳ Remaining apps: files.js, notes.js → then writer.js (LAST, by explicit decision)
New standing rule (recorded for OROS_BIBLE.md)
Rule — Unified File Dialogs, part 2 (retroactive coverage):

The Unified File Dialogs rule (recorded earlier in this Wave) is hereby EXTENDED: any dialog that arises from FUTURE upgrades, new features, or refactors in ANY application — including the apps already migrated and verified (Bookmarks, Calculator, Calendar) — MUST route through window.parent.orosDialog with the established helper trio pattern. This applies to file pickers, save dialogs, and any new export/import channel introduced later.
There is no "legacy exemption" for migrated apps: once an app passes Wave 2 verification, every subsequent feature touching files reuses the same dialogHost() resolution — no fresh ad-hoc anchor-downloads, hidden inputs, or FSA calls may reappear in later waves.
Per-app helper additions stay minimal: add localPickFile() only when the app actually imports files; dialogHost() alone is sufficient for export-only apps.
Pending
Wave 2 continues: files.js → notes.js → writer.js (LAST).
bookmarks.html: remove dead #import-in element (separate pass).
Wave 3 (approved, optional): info-modal mode line in shell.js ("Native file dialogs" / "Standard downloads").

---

MAPS
Added
"Send to Calendar" button in the route bar (JS-appended, no HTML changes needed): opens a date-picker dialog (native date input, defaults to today) and sends the active route as a prefilled Calendar event draft
Prefill payload: title "Route to {destination}" / "Διαδρομή προς {προορισμός}", location = destination name, start = current time, note = distance · duration · transport mode
Calendar receiver accepts a note field (CW-7) and standalone deep-link /calendar/?new={json} (CW-8)
i18n keys cal.send / cal.sent / cal.date / cal.confirm / cal.cancel (EN/EL)
Technical Notes
Works with restored (offline) routes too — condition is routeTo && lastSteps.length
Graceful degradation: no shell bridge → new tab with URL-param payload; no shell at all → same fallback
Shell-mode live push pending SH-1 (requires shell.js)

---

# orOS CHANGELOG
## v0.38.27 → v0.38.28 (Wave 8 prep)

### Added
- SH-1: `__orosOpenCalendarNew` shell bridge for Maps → Calendar "Send to Calendar" flow
  - Payload: `{ date, title?, location?, start?, note? }`
  - Live push when Calendar running; stages to `sessionStorage["oros-cal-new"]` when closed
  - Follows identical pattern to `__orosOpenMapsQuery` (no assumptions, verified against existing bridges)

### Pending
- MW-1a/b: maps.js i18n keys `cal.send`/`cal.sent`/`cal.date`/`cal.confirm`/`cal.cancel`
- MW-2: maps.js route Cal payload builder + date picker dialog
- MW-3: maps.js "Send to Calendar" button appended to route bar (JS-only, no HTML changes)
- CW-7: calendar.js receiver accepts `note` field (extends CW-6a)
- CW-8: calendar.js standalone deep-link `/calendar/?new={json}` support

---

Wave 8 — Calendar ↔ Maps bidirectional integration

RULES (binding, forward-looking):

BR-W8-1: Bridge contract — Maps sends "Send to Calendar" payloads via window.parent.__orosOpenCalendarNew({ date, title?, location?, start?, note? }) when running inside the shell. date is mandatory "YYYY-MM-DD" (strict regex guard in shell.js); start is 24h "HH:MM". Everything else optional strings, truncated defensively by the receiver (location 150, note 500 chars).
BR-W8-2: Staging key — sessionStorage "oros-cal-new" (NOT "oros-cal-pending", which is reserved for event deep-links calendar:{evId}:{ymd}). Device-local, swept by the factory reset (oros- prefix swept separately; this key lacks the prefix — NOTE: it is manually cleared by the receiver one-shot take, see BR-W8-4), never synced, never part of the export database.
BR-W8-3: Receiver ownership — window.__orosCalendarNew is defined INSIDE calendar.js and consumed in exactly two ways: live push from the shell iframe dispatcher (state.running === "calendar") and boot-time consumption of the staged sessionStorage payload (setTimeout 250ms, DOM-readiness delay). Any new entry path MUST go through this single receiver — no second door.
BR-W8-4: One-shot take — the staged payload is cleared immediately upon consumption (read-then-remove). If the receiver is missing from a stale app bundle, the pending payload is silently ignored — nothing breaks (same doctrine as oros-*-open keys).
BR-W8-5: Standalone fallback — /calendar/?new={urlencoded JSON} is the no-shell deep-link path (Maps opened Calendar as a new tab). Consumed at boot (400ms delay). Any future app that wants to hand off a "new entry" payload to Calendar standalone MUST reuse this param, not invent a new one.
BR-W8-6: Draft semantics — a bridged payload is a PREFILL, not data. Nothing is persisted to the calendar slice (no markDirty, no sync traffic) until the user explicitly saves in the New Event dialog. This distinction is mandatory for any future bridge of the same shape.
BR-W8-7: Reverse direction — Calendar event locations are clickable in ALL views (Day via .ev-loc, Week via .wk-ev-loc, Search via .res-loc). All use evt.stopPropagation() to prevent the event dialog from opening, and funnel through the single openInMaps() wrapper → window.parent.__orosOpenMapsQuery(query, label). Never add a fourth ad-hoc path for a new view; extend openInMaps().
BR-W8-8: "Send to Calendar" availability — gated by routeTo && lastSteps.length, so restored offline routes also qualify. The route bar button is JS-appended at wire() time; maps/index.html and maps.css are deliberately untouched.
BR-W8-9: Route payload composition — title "Route to {dest}" / "Διαδρομή προς {προορισμός}" (maps.js internal LANG, not window.t), location = destination name, start = current local time, note = distance · duration · transport mode. The note field lands in the event note input via the extended receiver (CW-7).
Known coupling (maintenance hazard):

The i18n keys cal.send / cal.sent / cal.date / cal.confirm / cal.cancel live INLINE in maps.js (both EN and EL dictionaries), NOT in translations.js. If maps.js i18n is ever migrated to translations.js, move them there and delete the inline copies.
calendar.js must expose 
(
"
e
v
−
n
o
t
e
"
)
a
n
d
("ev-location") before the receiver can prefill them; the 250ms/400ms boot delays exist to guarantee DOM readiness. If the boot sequence changes, re-verify these delays.

---

Changelog — Wave 2: Unified Dialogs Migration (orOS v0.38.x)

Completed Migrations
bookmarks.js (3 patches)
Added dialogHost() + localPickFile() helpers (parent lookup with standalone fallback)
Export (Netscape HTML): routed through orosDialog.saveFile; native picker on Chromium, standard download elsewhere
Import: routed through orosDialog.openFile; native picker first, legacy hidden input as fallback
Zero changes to merge/sync/render/state logic
calculator.js (2 patches)
Added dialogHost() helper (parent lookup, cross-origin guarded)
Export (CSV history): routed through orosDialog.saveFile; native save picker on Chromium, classic download as fallback
No localPickFile added — app has no file import, per minimal-change doctrine
calendar.js (2 patches)
Added dialogHost() helper (placed after __orosSyncApi markDirty bridge)
Export (ICS): routed through orosDialog.saveFile; native save picker on Chromium, standard download elsewhere
Read-only feeds (Contacts/Habits/Cycle/Mood/Kanban/To-Do/Pet) untouched — localStorage-only
characters.js (4 patches)
Added dialogHost() helper (placed after syncApi markDirty bridge)
Refactored downloadBlob() helper to accept mime/types and route through orosDialog.saveFile
exportMD: updated call to downloadBlob() with mime="text/markdown" and types metadata
exportJSON: updated call to downloadBlob() with mime="application/json" and types metadata
Single helper change covers both exports; toast fires only on ok:true
contacts.js (6 patches)
Added dialogHost() helper (placed after __orosSyncApi markDirty bridge)
vCard/CSV import: refactored reader into importFileText(); now routes through orosDialog.openFile with fallback to legacy #vcard-file input
Avatar upload: routed through orosDialog.openFile; standalone falls back to #ct-avatar-input synthetic click
vCard export: routed through orosDialog.saveFile; classic download as standalone fallback
JSON export: routed through orosDialog.saveFile; classic download as standalone fallback
JSON restore import: routed through orosDialog.openFile; fallback to hidden input mechanism
No localPickFile added — existing hidden inputs serve as standalone fallbacks
cycle.js (2 patches)
Added dialogHost() helper (placed before factory-reset comment block)
Export (PDF Doctor Report): replaced jsPDF's doc.save() with blob output routed through orosDialog.saveFile; standalone fallback uses classic anchor-download
Zero changes to merge engine, timeline, day editor, insights, mood cross-read, sync slice
dice.js (2 patches)
Added dialogHost() helper (placed in state+persistence section, before scheduleRender)
Export (TXT history): routed through orosDialog.saveFile; native save picker on Chromium, classic download as fallback
Cancel = silent exit, no toast (consistent convention across all migrated apps)
files.js (3 patches)
Added dialogHost() helper (placed in Section 15 Toast, after showToast())
Download (downloadEntry): refactored to route through orosDialog.saveFile; ES5-compliant dynamic key construction; standalone fallback uses classic anchor-download
Import (openFilePicker): routed through orosDialog.openFile; fallback to legacy hidden input for standalone mode
No localPickFile added — hidden input already serves as fallback; minimal-change principle
habits.js (0 patches — zero-touch)
Full audit confirmed ZERO file I/O operations in entire codebase
No FSA calls, no ad-hoc downloads, no hidden inputs, no FileReader usage
Data persists exclusively via localStorage + sync slices; no user-file channels exist
Per retroactive rule: dialogHost() to be added only IF future Waves introduce file export/import features
Bookmarks/Calendar pattern applies — no unnecessary code injection
Standing Rule (OROS_BIBLE.md — Section XI)
Unified File Dialogs, Extended Retroactively:

All file save/open operations in existing migrated apps AND ALL new apps from this point forward MUST route through window.parent.orosDialog via dialogHost() helper with parent lookup and standalone null fallback.
Direct FSA API calls (showSaveFilePicker/showOpenFilePicker) or ad-hoc anchor-downloads in app code are PROHIBITED.
Exceptions: (a) orosDialog module itself owns the fallbacks; (b) app-local standalone fallbacks when shell is absent (must be functionally identical patterns).
Helper trio: dialogHost() + optional localPickFile() (only if app imports files) — copy Bookmarks reference implementation exactly.
Convention: user cancel (ok:false/null) = SILENT exit — no toast, no error notification.
i18n awareness: all dialog-related strings use STRINGS[LANG] (EN default, EL) for new UI text.
ES5 compliance: dynamic object keys use bracket assignment (accept[m] = [...]) — NO computed literal syntax ([key]: value) as apps declare ES5+promises coding style.
Progress Table (Wave 2 Order)
#	App	Patches	Status
1	bookmarks.js	3	✅ Complete
2	calculator.js	2	✅ Complete
3	calendar.js	2	✅ Complete
4	characters.js	4	✅ Complete
5	contacts.js	6	✅ Complete
6	cycle.js	2	✅ Complete
7	dice.js	2	✅ Complete
8	files.js	3	✅ Complete
9	habits.js	0	✅ Complete (zero file I/O)
10	notes.js	pending	⏳ Next
11	writer.js	pending	🔚 LAST
Pending
notes.js → full audit (awaiting source file)
writer.js → full audit (deferred until end, by explicit decision)
bookmarks.html: remove dead #import-in element (separate pass, not blocking)
Wave 3 (optional): info-modal mode line in shell.js ("Native file dialogs" / "Standard downloads")

---

dialogs.js — Wave 2: App Migration (orOS v0.38.x)
Scope: Unified file dialog migration across all orOS applications. Every file save/open operation routes through window.parent.orosDialog (dialogHost() parent lookup) with standalone fallbacks. Writer remains last by explicit decision.

Standing rules (recorded earlier in this Wave, apply throughout):

Rule — Unified File Dialogs: All file save/open operations in existing migrated apps AND all new apps MUST route through window.parent.orosDialog via dialogHost() helper (parent lookup, cross-origin guarded, null in standalone mode) with local fallbacks. Direct FSA calls (showSaveFilePicker/showOpenFilePicker) and ad-hoc anchor-downloads/hidden-input patterns in app code are PROHIBITED. Exceptions: (a) the orosDialog module itself; (b) app-local standalone fallbacks when no shell is present.
Rule — Unified File Dialogs, part 2 (retroactive): Any dialog arising from FUTURE upgrades, new features, or refactors in ANY application — including apps already migrated and verified — MUST route through orosDialog with the established helper pattern. No "legacy exemption" for migrated apps: every subsequent feature touching files reuses dialogHost() resolution. Helper additions stay minimal: localPickFile() only when the app actually imports files; dialogHost() alone is sufficient for export-only apps.
Convention: user-cancel (ok:false / null) = SILENT exit — no toast, no error notification.
Convention: success toast fires only on ok:true (or standalone fallback completion).
ES5 compliance: dynamic object keys use bracket assignment (accept[m] = [...]) — NO computed literal syntax; apps declare ES5+promises coding style.
i18n: any new dialog-related strings use STRINGS[LANG] (EN default, EL).
Completed Migrations
bookmarks.js (3 patches)
Added dialogHost() + localPickFile() helpers (parent lookup, standalone fallback)
Export (Netscape HTML): routed through orosDialog.saveFile; native picker on Chromium, standard download elsewhere
Import: routed through orosDialog.openFile (accept ".html,.htm,text/html"); legacy hidden #import-in input retained as standalone fallback
Zero changes to merge/sync/render/state logic
calculator.js (2 patches)
Added dialogHost() helper
Export (CSV history): routed through orosDialog.saveFile; classic anchor-download retained only as standalone fallback
calendar.js (2 patches)
Added dialogHost() helper (after __orosSyncApi markDirty bridge)
Export (ICS): routed through orosDialog.saveFile; classic anchor-download as standalone fallback
characters.js (4 patches)
Added dialogHost() helper (after syncApi markDirty bridge)
downloadBlob() refactored to accept mime/types and route through orosDialog.saveFile — single funnel covers both exports
exportMD: call enriched with mime="text/markdown" + types metadata
exportJSON: call enriched with mime="application/json" + types metadata
contacts.js (6 patches)
Added dialogHost() helper (after __orosSyncApi markDirty bridge)
vCard/CSV import: reader extracted into importFileText(); orosDialog.openFile first, legacy #vcard-file hidden input as standalone fallback
Avatar upload: orosDialog.openFile; standalone falls back to #ct-avatar-input synthetic click
vCard export: orosDialog.saveFile with standalone anchor-download fallback
JSON export: orosDialog.saveFile with standalone anchor-download fallback
JSON restore import: orosDialog.openFile with hidden-input fallback
cycle.js (2 patches)
Added dialogHost() helper (before factory-reset comment block)
Export (PDF Doctor Report): jsPDF doc.save() retired, replaced with doc.output("blob") → orosDialog.saveFile; standalone fallback uses classic anchor-download
Zero changes to PDF generation (fonts, pagination, disclaimer, footer)
dice.js (2 patches)
Added dialogHost() helper (in state+persistence section)
Export (TXT history): routed through orosDialog.saveFile with standalone fallback
files.js (3 patches)
Added dialogHost() helper (Section 15 Toast)
Download (downloadEntry): orosDialog.saveFile first, ES5-compliant dynamic accept key via bracket assignment; types omitted entirely when the file has no real extension; standalone fallback uses classic anchor-download
Import (openFilePicker): orosDialog.openFile first; legacy hidden input as standalone fallback
Note: Patch 2 initially shipped with an invalid ES6 computed-key literal ({(mime||...): [...]}) — syntax error detected and corrected to ES5 bracket-assignment construction before delivery
habits.js (0 patches — zero-touch)
Full audit: ZERO file I/O operations in the entire codebase. No FSA calls, no anchor-downloads, no hidden inputs, no FileReader, no Blob exports
Data persists exclusively via localStorage + sync slices
dialogHost() forbidden here per "no dead code" rule; to be added only if a future Wave introduces file I/O features
kanban.js (2 patches)
Added dialogHost() helper (after save()/__orosSyncApi bridge)
Import (Kanri/Trello): click-interception pattern on the visible file input — orosDialog.openFile (native picker on Chromium) first; the input remains as standalone fallback (shell mode suppresses it via preventDefault)
Reader logic extracted into readImportFile(); both paths converge there (byte-for-byte the old logic)
Bonus fix: file.value = "" reset — without it, re-picking the SAME file never fired change (input value unchanged); same "allow re-import of same file" pattern as Contacts
No export functionality exists (no dead code added)
maps.js (0 patches — zero-touch)
Full audit: ZERO user-file I/O operations. Photon/OSRM fetch calls are network calls, not file dialogs; tile cache uses Cache Storage API, not user files
Future candidates (GPX/KML export, GeoJSON import) fall under the retroactive rule when implemented
minimalism.js (0 patches — zero-touch)
Full audit: ZERO user-file I/O operations. content.js payload is a script-loaded static resource, not a user-picked file; persistence via localStorage + sync slice only
All UI dialogs are custom in-app <dialog> elements, not file dialogs — outside the rule's scope
mood.js (2 patches)
Added dialogHost() helper (after save()/__orosSyncApi bridge)
Export (PDF insights): jsPDF doc.save() retired, replaced with doc.output("blob") → orosDialog.saveFile; standalone fallback uses classic anchor-download
Zero changes to NFC funnel (pdfClean), font loading, pagination, sections, dates
notes.js (4 patches)
Added dialogHost() helper (after markSyncDirty bridge)
downloadBlob() refactored to accept mime/types and route through orosDialog.saveFile — single funnel covers both exports
exportPageTxt: call enriched with mime="text/plain" + types metadata
exportNotebookZip: call enriched with mime="application/zip" + types metadata
Preserved app's silent-by-design export UX: no success toast existed before, none added; cancel = silent exit
ZIP writer (store-method, CRC32, DOS dates) and branding footer funnel untouched
No file import exists — localPickFile() not added (no dead code rule)

#	App	Patches	Status
1	bookmarks.js	3	✅ Complete
2	calculator.js	2	✅ Complete
3	calendar.js	2	✅ Complete
4	characters.js	4	✅ Complete
5	contacts.js	6	✅ Complete
6	cycle.js	2	✅ Complete
7	dice.js	2	✅ Complete
8	files.js	3	✅ Complete
9	habits.js	0	✅ Complete (zero file I/O)
10	kanban.js	2	✅ Complete
11	maps.js	0	✅ Complete (zero file I/O)
12	minimalism.js	0	✅ Complete (zero file I/O)
13	mood.js	2	✅ Complete
14	notes.js	4	✅ Complete
15	writer.js	pending	🔚 LAST
Pending
writer.js → full audit (deferred until end, by explicit decision)
bookmarks.html: remove dead #import-in element (separate pass, not blocking)
Wave 3 (approved, optional): info-modal mode line in shell.js ("Native file dialogs" / "Standard downloads")

---Changelog — Wave 2: Unified Dialogs Migration (orOS v0.38.x) — Update
Σε plain Markdown για ευθεία αντιγραφή στο CHANGELOG.md:

Completed Migrations — Continued
storage.js (0 patches — zero-touch)
Full audit: ZERO file I/O operations in the entire codebase
No FSA calls, no anchor-downloads, no hidden inputs, no FileReader, no Blob exports
Data persists exclusively via localStorage + sync slice (registerSlice/mergeTime)
All entity hierarchy (Space → Room → Furniture → Position → Item) lives in { ver, ents } slice
dialogHost() forbidden per "no dead code" rule; to be added only if future Waves introduce file I/O features
time.js (0 patches — zero-touch)
Full audit: ZERO file I/O operations in the entire codebase (both IIFEs: main app + deep-link receiver)
Alarms engine: window.parent.orosAlarms + localStorage fallback (rd/wr) — data channel, not filesystem
Sounds: Web Audio API synthesis (createOscillator/createGain) — no audio files, no fetch
Zone/alarm/dialog UI: Custom in-app <dialog> elements — UI dialogs, not file dialogs
Data persistence: localStorage (DATA_KEY) + sync slice (mergeTime/setFromSync)
dialogHost() forbidden per "no dead code" rule
astro.js (0 patches — zero-touch)
Full audit: ZERO file I/O operations (NOAA solar equations, moon phase rendering, location dialog)
Location input: Manual coordinate entry (text fields) OR Weather app localStorage fallback (oros-weather) OR session-only GPS fix
No FileReader, no hidden inputs, no drag-drop, no Blob exports
Dialog UI: Custom in-app <dialog> for coordinates — not a file picker
Data persistence: localStorage + markDirty() sync bridge
dialogHost() forbidden per "no dead code" rule
Progress Table (Wave 2 Order) — Updated
#	App	Patches	Status
1	bookmarks.js	3	✅ Complete
2	calculator.js	2	✅ Complete
3	calendar.js	2	✅ Complete
4	characters.js	4	✅ Complete
5	contacts.js	6	✅ Complete
6	cycle.js	2	✅ Complete
7	dice.js	2	✅ Complete
8	files.js	3	✅ Complete
9	habits.js	0	✅ Zero file I/O
10	kanban.js	2	✅ Complete
11	maps.js	0	✅ Zero file I/O
12	minimalism.js	0	✅ Zero file I/O
13	mood.js	2	✅ Complete
14	notes.js	4	✅ Complete
15	prompter.js	0	✅ Zero file I/O
16	quote.js	2	✅ Complete
17	radio.js	0	✅ Zero file I/O
18	spreadsheet.js	5	✅ Complete
19	storage.js	0	✅ Zero file I/O
20	time.js	0	✅ Zero file I/O
21	astro.js	0	✅ Zero file I/O
22	writer.js	pending	🔚 LAST
Pending
writer.js → full audit (deferred until end, by explicit decision; will be delivered in sequential doses due to volume of I/O points: TXT/MD/HTML/DOCX/RTF/OROSDOC/JSON/PDF exports + ODT/DOCX/RTF/HTML/TXT imports + drag & drop)
bookmarks.html: remove dead #import-in element (separate pass, not blocking)
Wave 3 (optional): info-modal mode line in shell.js ("Native file dialogs" / "Standard downloads")

---

# OROS_BIBLE.md — delta for the Maps Dose 1 delivery

Paste each block into the named Part. Nothing here proposes a version (R23).

## Part III — App registry (add row)

| **Maps** | oros-maps-data | place union by id + LWW + tombs, canonical (R26) | Audit Dose 1 delivered → deploy + 2-device smoke test pending |

- `apps.json` lists **23** apps (maps was missing from the count).
- File tree: add `maps/` to the app folders and `vendor/leaflet.js`, `vendor/leaflet.css` to `vendor/`.

## Part III — Device-local keys (add)

- **Maps:** oros-maps-route (last-known route snapshot), oros-maps-rescue (copy of unreadable oros-maps-data), oros-maps-open (staging). Cache Storage `oros-map-tiles` is device-local and is NOT swept by the factory reset (open item below).

## Part IV — Data models (add)

**Maps** — `oros-maps-data`:
`{ ver: 1, places: [{ id, name, sub, lat, lon, mtime }], deleted: { <id>: <ts> } }`

- `id` is deterministic: `"p" + lat.toFixed(6) + "," + lon.toFixed(6)` (the same place starred on two devices is one entity). Legacy random ids are re-derived by `normalize()` on load; duplicates collapse to the newer mtime.
- `normalize()` is the single funnel (load, save, merge output, sliceGet, sliceSet): places sorted by id, tombstone keys sorted, fixed field order.
- Merge: union by id, LWW by mtime (tie: lexicographic JSON); tombstones max-ts union; a place survives only if `mtime > tombstone` (delete wins ties, newer star resurrects).
- No tombstone pruning (tiny `{id: ts}` entries; avoids any R26 risk).
- Fresh install persists nothing until the first real change. Unreadable data is copied to `oros-maps-rescue`, never overwritten silently.

## Part II — `sw.js` (replace the tile notes / add)

- **Map tiles:** `TILE_HOSTS` + length-derived suffix match (exact host or any subdomain). Cache-first in `oros-map-tiles` (outside CACHE_VERSION). **Only `response.ok` is stored**; opaque responses are never stored. A legacy opaque hit is treated as a miss for non-`no-cors` requests. Trim to `TILE_MAX` every 100 puts AND once per activation.
- maps.js requests tiles with `crossOrigin: "anonymous"` — the two changes ship together.

## Part IX — Decisions (add, newest first)

- **2026-10-04 · Maps (Christos sent sync.js + mood.js = slice approved)**
  - Saved places sync through a `maps` slice (5-arg `registerSlice`). The last-known route and the tile cache stay device-local.
  - Deterministic place ids from coordinates (assistant decision; reason: R16 spirit — no duplicate entities across devices, and legacy never-synced data dedupes on first sync).
  - Places list keeps its visible order (oldest first) although storage is id-sorted (assistant decision; reason: no visible change for the user).
  - Photon: the UI language is sent as `lang`; on HTTP 400 the query is retried once without it and the session stops sending it (assistant decision; reason: works whether or not the public instance offers `el`, no guessing).
  - Route bar: two rows, centred under the search bar on desktop, docked at the bottom on mobile. BR-W8-8 changes: the Send-to-Calendar button is still JS-appended, but now has id `route-cal`, is inserted before `#nav-start`, and is styled by maps.css.
- **OPEN (Christos):** Bike / Walk routing server. `ROUTER_BASE` in maps.js holds one endpoint per profile; all three still point at the OSRM demo server.

## Part IX — Doctrinal exemptions (add)

- **Maps — "No external dependencies" exemption:** tiles (OSM / HOT / Esri), geocoding (Photon) and routing (OSRM) are online services by nature. Offline scope = cached tiles + last-known route + saved places.

## Part X — Open items (add)

- **Maps audit, remaining:** findings 14–22 (stale origin, deep-link vs restore order, star label, stale end-marker popup, heavy route snapshot, wake lock) and the usability list; 26 (factory reset does not delete Cache Storage `oros-map-tiles` — shell.js); 27 (navigation dies silently when the frame is replaced).
- **Maps, unverified externally:** OSRM demo Bike/Walk profiles; Photon `lang=el`; CORS headers of the three tile hosts (post-deploy check).

## Part XII — Changelog (append at the END)

### 2026-10-04 — Maps — audit Dose 1 (full-file delivery: maps.js, maps.css, sw.js)

- **Fixes (navigation):**
  - Fork direction: any left-ish modifier keeps left (was "keep right" for `slight left`).
  - Maneuver text: modifiers with spaces resolve (`slight right`, `sharp left`), `uturn` handled, missing space before the street name, `end of road` / `rotary` / `exit roundabout` / `roundabout turn` / `new name` / `notification` handled; `$` in street names is safe.
  - Maneuver icons follow the direction (11-icon table `MVN_ICON`).
  - Route matching is point-to-segment and forward-only (`matchRoute`, `buildRouteIndex`, `stepIndexAt`): no false re-routes on straight roads, the step counter cannot strand after a GPS gap, out-and-back routes stay on the right leg.
  - Arrival is judged along the route (within 25 m of its end), not only against the requested point.
  - The user marker follows the position during navigation (`moveUser`).
  - A re-route during navigation no longer zooms out to the whole route.
- **Fixes (routing / search):**
  - `routeSeq` token: stale or cancelled OSRM responses are dropped (no ghost polyline after Clear).
  - `photonGet`: 400 → retry without `lang`.
  - `restoreRoute` no longer throws on a snapshot without `geometry`.
- **Fixes (layout):** route bar no longer overflows or covers the search bar / Leaflet controls; `#nav-start` is styled; search dropdown paints above the route bar; mobile controls lift only while a route is shown (`body.has-route`).
- **Fixes (sw.js):** tile host match (default and HOT layers were never cached); only real 200s are cached; trim also runs on activation.
- **Schema:** `oros-maps-data` gains `deleted{}`; ids become deterministic (see Part IV).
- **Changes:** `maps` sync slice (saved places in sync, export, snapshots); quota failure surfaces a toast (R30); rescue copy for unreadable data.
- **Files:** maps/maps.js, maps/maps.css, sw.js. `maps/index.html` untouched.
- **Verification:** Chromium harness with the real maps.js + real sync.js, Leaflet stubbed, Photon/OSRM/GPS faked. Two-device test: union, delete, resurrection — exports equal, `applied == 0` from round 2. Merge fuzz (20,000 triples): symmetric, idempotent, associative, 0 violations. sw.js tile branch: mock-based unit test in node, not a real Service Worker run.
- **Next:** Dose 2 (findings 14–22, 26, 27), Dose 3 (usability). Bike/Walk server decision.

---

# OROS_BIBLE.md — delta for the Maps Dose 1 delivery

Paste each block into the named Part. Nothing here proposes a version (R23).

## Part III — App registry (add row)

| **Maps** | oros-maps-data | place union by id + LWW + tombs, canonical (R26) | Audit Dose 1 delivered → deploy + 2-device smoke test pending |

- `apps.json` lists **23** apps (maps was missing from the count).
- File tree: add `maps/` to the app folders and `vendor/leaflet.js`, `vendor/leaflet.css` to `vendor/`.

## Part III — Device-local keys (add)

- **Maps:** oros-maps-route (last-known route snapshot), oros-maps-rescue (copy of unreadable oros-maps-data), oros-maps-open (staging). Cache Storage `oros-map-tiles` is device-local and is NOT swept by the factory reset (open item below).

## Part IV — Data models (add)

**Maps** — `oros-maps-data`:
`{ ver: 1, places: [{ id, name, sub, lat, lon, mtime }], deleted: { <id>: <ts> } }`

- `id` is deterministic: `"p" + lat.toFixed(6) + "," + lon.toFixed(6)` (the same place starred on two devices is one entity). Legacy random ids are re-derived by `normalize()` on load; duplicates collapse to the newer mtime.
- `normalize()` is the single funnel (load, save, merge output, sliceGet, sliceSet): places sorted by id, tombstone keys sorted, fixed field order.
- Merge: union by id, LWW by mtime (tie: lexicographic JSON); tombstones max-ts union; a place survives only if `mtime > tombstone` (delete wins ties, newer star resurrects).
- No tombstone pruning (tiny `{id: ts}` entries; avoids any R26 risk).
- Fresh install persists nothing until the first real change. Unreadable data is copied to `oros-maps-rescue`, never overwritten silently.

## Part II — `sw.js` (replace the tile notes / add)

- **Map tiles:** `TILE_HOSTS` + length-derived suffix match (exact host or any subdomain). Cache-first in `oros-map-tiles` (outside CACHE_VERSION). **Only `response.ok` is stored**; opaque responses are never stored. A legacy opaque hit is treated as a miss for non-`no-cors` requests. Trim to `TILE_MAX` every 100 puts AND once per activation.
- maps.js requests tiles with `crossOrigin: "anonymous"` — the two changes ship together.

## Part IX — Decisions (add, newest first)

- **2026-10-04 · Maps (Christos sent sync.js + mood.js = slice approved)**
  - Saved places sync through a `maps` slice (5-arg `registerSlice`). The last-known route and the tile cache stay device-local.
  - Deterministic place ids from coordinates (assistant decision; reason: R16 spirit — no duplicate entities across devices, and legacy never-synced data dedupes on first sync).
  - Places list keeps its visible order (oldest first) although storage is id-sorted (assistant decision; reason: no visible change for the user).
  - Photon: the UI language is sent as `lang`; on HTTP 400 the query is retried once without it and the session stops sending it (assistant decision; reason: works whether or not the public instance offers `el`, no guessing).
  - Route bar: two rows, centred under the search bar on desktop, docked at the bottom on mobile. BR-W8-8 changes: the Send-to-Calendar button is still JS-appended, but now has id `route-cal`, is inserted before `#nav-start`, and is styled by maps.css.
- **2026-10-04 · Maps (Christos): Bike / Walk change server.** `ROUTER_BASE` in maps.js: car stays on `router.project-osrm.org`; bike → `routing.openstreetmap.de/routed-bike/route/v1/driving/`, foot → `routing.openstreetmap.de/routed-foot/route/v1/driving/` (FOSSGIS; the demo server ignores the profile segment and always routes cars). Same OSRM API and response shape. Fair use: about 1 request/second, non-commercial.

## Part IX — Doctrinal exemptions (add)

- **Maps — "No external dependencies" exemption:** tiles (OSM / HOT / Esri), geocoding (Photon) and routing (OSRM) are online services by nature. Offline scope = cached tiles + last-known route + saved places.

## Part X — Open items (add)

- **Maps audit, remaining:** findings 14–22 (stale origin, deep-link vs restore order, star label, stale end-marker popup, heavy route snapshot, wake lock) and the usability list; 26 (factory reset does not delete Cache Storage `oros-map-tiles` — shell.js); 27 (navigation dies silently when the frame is replaced).
- **Maps, unverified externally:** FOSSGIS Bike/Walk endpoints from the app (URL layout confirmed from documentation only); Photon `lang=el`; CORS headers of the three tile hosts (post-deploy check).

## Part XII — Changelog (append at the END)

### 2026-10-04 — Maps — audit Dose 1 (full-file delivery: maps.js, maps.css, sw.js)

- **Fixes (navigation):**
  - Fork direction: any left-ish modifier keeps left (was "keep right" for `slight left`).
  - Maneuver text: modifiers with spaces resolve (`slight right`, `sharp left`), `uturn` handled, missing space before the street name, `end of road` / `rotary` / `exit roundabout` / `roundabout turn` / `new name` / `notification` handled; `$` in street names is safe.
  - Maneuver icons follow the direction (11-icon table `MVN_ICON`).
  - Route matching is point-to-segment and forward-only (`matchRoute`, `buildRouteIndex`, `stepIndexAt`): no false re-routes on straight roads, the step counter cannot strand after a GPS gap, out-and-back routes stay on the right leg.
  - Arrival is judged along the route (within 25 m of its end), not only against the requested point.
  - The user marker follows the position during navigation (`moveUser`).
  - A re-route during navigation no longer zooms out to the whole route.
- **Fixes (routing / search):**
  - `routeSeq` token: stale or cancelled OSRM responses are dropped (no ghost polyline after Clear).
  - `photonGet`: 400 → retry without `lang`.
  - `restoreRoute` no longer throws on a snapshot without `geometry`.
- **Fixes (layout):** route bar no longer overflows or covers the search bar / Leaflet controls; `#nav-start` is styled; search dropdown paints above the route bar; mobile controls lift only while a route is shown (`body.has-route`).
- **Fixes (sw.js):** tile host match (default and HOT layers were never cached); only real 200s are cached; trim also runs on activation.
- **Schema:** `oros-maps-data` gains `deleted{}`; ids become deterministic (see Part IV).
- **Changes:** `maps` sync slice (saved places in sync, export, snapshots); quota failure surfaces a toast (R30); rescue copy for unreadable data.
- **Files:** maps/maps.js, maps/maps.css, sw.js. `maps/index.html` untouched.
- **Verification:** Chromium harness with the real maps.js + real sync.js, Leaflet stubbed, Photon/OSRM/GPS faked. Two-device test: union, delete, resurrection — exports equal, `applied == 0` from round 2. Merge fuzz (20,000 triples): symmetric, idempotent, associative, 0 violations. sw.js tile branch: mock-based unit test in node, not a real Service Worker run.
- **Changes (routing):** Bike / Walk moved to the FOSSGIS OSRM instances (`ROUTER_BASE`).
- **Next:** Dose 2 (findings 14–22, 26, 27), Dose 3 (usability).

---

# OROS_BIBLE.md — delta for the Maps Dose 1 delivery

Paste each block into the named Part. Nothing here proposes a version (R23).

## Part III — App registry (add row)

| **Maps** | oros-maps-data | place union by id + LWW + tombs, canonical (R26) | Audit Dose 1 delivered → deploy + 2-device smoke test pending |

- `apps.json` lists **23** apps (maps was missing from the count).
- File tree: add `maps/` to the app folders and `vendor/leaflet.js`, `vendor/leaflet.css` to `vendor/`.

## Part III — Device-local keys (add)

- **Maps:** oros-maps-route (last-known route snapshot), oros-maps-rescue (copy of unreadable oros-maps-data), oros-maps-open (staging). Cache Storage `oros-map-tiles` is device-local and is NOT swept by the factory reset (open item below).

## Part IV — Data models (add)

**Maps** — `oros-maps-data`:
`{ ver: 1, places: [{ id, name, sub, lat, lon, mtime }], deleted: { <id>: <ts> } }`

- `id` is deterministic: `"p" + lat.toFixed(6) + "," + lon.toFixed(6)` (the same place starred on two devices is one entity). Legacy random ids are re-derived by `normalize()` on load; duplicates collapse to the newer mtime.
- `normalize()` is the single funnel (load, save, merge output, sliceGet, sliceSet): places sorted by id, tombstone keys sorted, fixed field order.
- Merge: union by id, LWW by mtime (tie: lexicographic JSON); tombstones max-ts union; a place survives only if `mtime > tombstone` (delete wins ties, newer star resurrects).
- No tombstone pruning (tiny `{id: ts}` entries; avoids any R26 risk).
- Fresh install persists nothing until the first real change. Unreadable data is copied to `oros-maps-rescue`, never overwritten silently.

## Part II — `sw.js` (replace the tile notes / add)

- **Map tiles:** `TILE_HOSTS` + length-derived suffix match (exact host or any subdomain). Cache-first in `oros-map-tiles` (outside CACHE_VERSION). **Only `response.ok` is stored**; opaque responses are never stored. A legacy opaque hit is treated as a miss for non-`no-cors` requests. Trim to `TILE_MAX` every 100 puts AND once per activation.
- maps.js requests tiles with `crossOrigin: "anonymous"` — the two changes ship together.

## Part IX — Decisions (add, newest first)

- **2026-10-04 · Maps (Christos sent sync.js + mood.js = slice approved)**
  - Saved places sync through a `maps` slice (5-arg `registerSlice`). The last-known route and the tile cache stay device-local.
  - Deterministic place ids from coordinates (assistant decision; reason: R16 spirit — no duplicate entities across devices, and legacy never-synced data dedupes on first sync).
  - Places list keeps its visible order (oldest first) although storage is id-sorted (assistant decision; reason: no visible change for the user).
  - Photon: the UI language is sent as `lang`; on HTTP 400 the query is retried once without it and the session stops sending it (assistant decision; reason: works whether or not the public instance offers `el`, no guessing).
  - Route bar: two rows, centred under the search bar on desktop, docked at the bottom on mobile. BR-W8-8 changes: the Send-to-Calendar button is still JS-appended, but now has id `route-cal`, is inserted before `#nav-start`, and is styled by maps.css.
- **2026-10-04 · Maps (Christos): Bike / Walk change server.** `ROUTER_BASE` in maps.js: car stays on `router.project-osrm.org`; bike → `routing.openstreetmap.de/routed-bike/route/v1/driving/`, foot → `routing.openstreetmap.de/routed-foot/route/v1/driving/` (FOSSGIS; the demo server ignores the profile segment and always routes cars). Same OSRM API and response shape. Fair use: about 1 request/second, non-commercial.

## Part IX — Doctrinal exemptions (add)

- **Maps — "No external dependencies" exemption:** tiles (OSM / HOT / Esri), geocoding (Photon) and routing (OSRM) are online services by nature. Offline scope = cached tiles + last-known route + saved places.

## Part X — Open items (add)

- **Maps audit, remaining:** findings 14–22 (stale origin, deep-link vs restore order, star label, stale end-marker popup, heavy route snapshot, wake lock) and the usability list; 26 (factory reset does not delete Cache Storage `oros-map-tiles` — shell.js); 27 (navigation dies silently when the frame is replaced).
- **Maps, unverified externally:** FOSSGIS Bike/Walk endpoints from the app (URL layout confirmed from documentation only); Photon `lang=el`; CORS headers of the three tile hosts (post-deploy check).

## Part XII — Changelog (append at the END)

### 2026-10-04 — Maps — audit Dose 1 (full-file delivery: maps.js, maps.css, sw.js)

- **Fixes (navigation):**
  - Fork direction: any left-ish modifier keeps left (was "keep right" for `slight left`).
  - Maneuver text: modifiers with spaces resolve (`slight right`, `sharp left`), `uturn` handled, missing space before the street name, `end of road` / `rotary` / `exit roundabout` / `roundabout turn` / `new name` / `notification` handled; `$` in street names is safe.
  - Maneuver icons follow the direction (11-icon table `MVN_ICON`).
  - Route matching is point-to-segment and forward-only (`matchRoute`, `buildRouteIndex`, `stepIndexAt`): no false re-routes on straight roads, the step counter cannot strand after a GPS gap, out-and-back routes stay on the right leg.
  - Arrival is judged along the route (within 25 m of its end), not only against the requested point.
  - The user marker follows the position during navigation (`moveUser`).
  - A re-route during navigation no longer zooms out to the whole route.
- **Fixes (routing / search):**
  - `routeSeq` token: stale or cancelled OSRM responses are dropped (no ghost polyline after Clear).
  - `photonGet`: 400 → retry without `lang`.
  - `restoreRoute` no longer throws on a snapshot without `geometry`.
- **Fixes (layout):** route bar no longer overflows or covers the search bar / Leaflet controls; `#nav-start` is styled; search dropdown paints above the route bar; mobile controls lift only while a route is shown (`body.has-route`).
- **Fixes (sw.js):** tile host match (default and HOT layers were never cached); only real 200s are cached; trim also runs on activation.
- **Schema:** `oros-maps-data` gains `deleted{}`; ids become deterministic (see Part IV).
- **Changes:** `maps` sync slice (saved places in sync, export, snapshots); quota failure surfaces a toast (R30); rescue copy for unreadable data.
- **Files:** maps/maps.js, maps/maps.css, sw.js. `maps/index.html` untouched.
- **Verification:** Chromium harness with the real maps.js + real sync.js, Leaflet stubbed, Photon/OSRM/GPS faked. Two-device test: union, delete, resurrection — exports equal, `applied == 0` from round 2. Merge fuzz (20,000 triples): symmetric, idempotent, associative, 0 violations. sw.js tile branch: mock-based unit test in node, not a real Service Worker run.
- **Changes (routing):** Bike / Walk moved to the FOSSGIS OSRM instances (`ROUTER_BASE`).
- **Next:** Dose 2 (findings 14–22, 26, 27), Dose 3 (usability).

---

# Dose 2 delta (2026-10-04)

## Part III — Device-local keys (add to the Maps line)

- sessionStorage `oros-maps-nav` (timestamp of a running navigation; refreshed every 30 s; removed on exit / arrival / clear route).

## Part IV — Maps (add)

- `oros-maps-route` snapshot: steps are stored slim — `{ maneuver: { type, modifier, exit?, location? }, name, ref?, distance, duration }`. OSRM per-step `geometry` and `intersections` are never stored. Cap: 600,000 characters; over the cap (or on quota failure) the key is REMOVED, with one toast per session.

## Part V / shell.js §factory reset (add)

- Factory reset also deletes Cache Storage `oros-map-tiles` (`wipeMapTiles()`, 3s cap, best-effort). The name must match `sw.js` `TILE_CACHE`.

## Part IX — Decisions (add, newest first)

- **2026-10-04 · Maps Dose 2 (assistant decisions inside an approved dose; each is one small block to revert)**
  - A position counts as fresh for 2 minutes (`POS_FRESH_MS`); `getCurrentPosition` uses `maximumAge` 60 s. Reason: a route origin must be where the user is now.
  - Origin fallback chain: fresh fix → last known position (toast `route.fromLast`) → map centre (toast `route.fromCenter`).
  - Navigation resumes when Maps boots in the same tab within 30 minutes of the last GPS tick (the single app frame is replaced by Calendar hand-off, taskbar buttons, language toggle). A deep-link boot never resumes. Reason: the alternative is a navigation that dies without a word.
  - A deep-link boot paints the last-known route but leaves the view and the toast to the deep link.
  - Star button labels are verbs (`places.save` / `places.remove`); the status strings stay for toasts.

## Part X — Open items (replace the Maps lines)

- **Maps audit, remaining:** Dose 3 (usability list). "Sent to Calendar" toast is unseen in shell mode (the frame is replaced) — needs the shell transient; `notifications.js` must be on the table first.
- **Maps, unverified externally:** FOSSGIS Bike/Walk endpoints from the app; Photon `lang=el`; CORS headers of the three tile hosts; Screen Wake Lock and auto-resume on a real phone.

## Part XII — Changelog (append at the END, after the Dose 1 entry)

### 2026-10-04 — Maps — audit Dose 2 (maps.js full file; shell.js 2 patches)

- **Fixes:**
  - Route origin / navigation start use a fresh position (2 min); stale fix is re-measured, with an honest fallback toast.
  - Deep link with coordinates is no longer overridden by the restored route (`restoreRoute(quiet)`, restore runs before the deep link).
  - Star button label was inverted (showed the toast strings).
  - Destination marker popup (title + star target) follows the current destination.
  - Route snapshot is slim and capped; a failed save removes the older snapshot instead of leaving it to be restored.
  - Factory reset deletes the Maps tile cache (shell.js).
- **Changes:** Screen Wake Lock during navigation (re-acquired on `visibilitychange`); navigation session marker + auto-resume.
- **Schema:** `oros-maps-route` steps slimmed (see Part IV). Old fat snapshots still restore; they are rewritten slim on the next route.
- **Files:** maps/maps.js (full), shell.js (PATCH 1/2, 2/2).
- **Verification:** Chromium harness (real maps.js, Leaflet stubbed, network/GPS/Wake Lock faked): all Dose 2 scenarios pass; Dose 1 suite re-run (maneuver texts, layout, 7 navigation scenarios, two-device sync with the real sync.js, click sweep EN/EL × desktop/mobile) with zero page errors. `wipeMapTiles` executed in Chromium against real Cache Storage. shell.js patches applied to a copy, `node --check` OK; the full reset flow was not run.
- **Next:** Dose 3 (usability). Needs `notifications.js`.

---

CHANGELOG — orOS Wave 2: Unified File Dialogs
Scope
Systematic migration of ALL file save/open operations across the orOS app suite to the centralized window.parent.orosDialog interface (dialogs.js — the shell module, single point of truth). Strategy: every user-facing file write goes through dialogHost() → orosDialog.saveFile, every file read through dialogHost() → orosDialog.openFile, with standalone fallbacks preserved. The Writer app (writer.js) was deliberately processed LAST.

dialogs.js contract (reference — verified 2026-10)
orosDialog.saveFile({ blob | text, filename, mime, types? }) → Promise<{ ok, mode }>
ok:true ONLY when bytes landed (native write completed / download dispatched). Cancel → ok:false.
Chromium: native save picker. All other browsers: <a download> fallback (late revoke, 1000ms).
Unexpected native failure (e.g. SecurityError from expired transient activation) auto-falls back to download.
orosDialog.openFile(accept) → Promise<File|null> (single), openFiles(accept) → Promise<File[]|null>
orosDialog.mode() → "native" | "download"
Consumed by the shell AND every same-origin iframe app via window.parent.orosDialog.
Standing rules (recorded for all future development)
Unified File Dialogs: No ad-hoc anchor-downloads, hidden file inputs, or direct File System Access API calls in apps. All file I/O routes through dialogHost() (checks window.orosDialog then window.parent.orosDialog, try/catch for standalone). Legacy mechanisms are retained ONLY as fallbacks when the app runs outside the shell.
Cancel convention: User cancellation is a silent exit (ok:false / null) — no toast, no error. Success toasts fire only on ok:true or successful fallback completion.
ES5 compliance: No computed object keys ({[key]: val}) — use bracket assignment (obj[key] = val). Dynamic MIME types objects for saveFile are built this way.
No dead code: If an app has no user-file I/O, it is "zero-touch" — no dialogHost() helper is injected (it would never be called). If a future wave adds export/import to a zero-touch app, the helper arrives as part of THAT work (Bookmarks is the reference implementation).
Standalone fallbacks stay: Every migrated app keeps its legacy mechanism (anchor download / hidden input) for shell-less operation. Fallbacks must match the same cancel-silent / success-toast contract.
Per-app results
#	App	Patches	Notes
1	bookmarks.js	3	Reference implementation: dialogHost() + localPickFile() + export/import wired. Netscape HTML round-trip intact.
2	calculator.js	2	
3	calendar.js	2	
4	characters.js	4	
5	contacts.js	6	Largest app batch so far
6	cycle.js	2	
7	dice.js	2	
8	files.js	3	Includes ES5 correction: dynamic MIME accept map built via bracket assignment, not computed keys
9	kanban.js	2	
10	mood.js	2	
11	notes.js	4	
12	quote.js	2	
13	spreadsheet.js	5	
14	shell.js	4	See below
Zero-touch (audited, no changes — no user file I/O): habits.js, maps.js, minimalism.js, prompter.js, radio.js, storage.js, time.js, astro.js, todo.js, weather.js, fs.js (data layer, no user-facing I/O), pet.js (shell component; localStorage + sync slices + Canvas only).

shell.js migration detail (4 patches)
PATCH 1: New section 5e — dialogHost() + shellSaveJson(filename, json) + shellPickJson() helpers, placed after fdRefreshForExport, before the v0.18.1 taskbar toast block. Legacy anchor-download / hidden-input preserved inside the helpers as stale-bundle fallbacks.
PATCH 2: renderSyncSection Export button → shellSaveJson(...) (was inline anchor download, after fdRefreshForExport() freshness check).
PATCH 3: scExportDb (Ctrl+Alt+Shift+X shortcut) → same helper; killed the copy-paste duplication with the menu button.
PATCH 4: renderSyncSection Import button → shellPickJson().then(...); the statically-created fileInput element and its wiring were removed; FileReader + orosSync.importData logic unchanged.
Deliberately NOT migrated: Section 5d (Backup folder: writeBackupFile, chooseBackupFolder, reconnectFolder, maybeAutoExport). Rationale: it uses a persistent File System Access folder handle with its own permission lifecycle (query/request permission, IndexedDB persistence, lapsed flag) — fundamentally incompatible with a save-as picker per write, and requestPermission is only legal from a click handler. That subsystem keeps its own validated contract.
Transient activation note: on the shortcut path (scExportDb), the async fdRefreshForExport() may expire the user-activation window before the native picker — covered by dialogs.js design (SecurityError → automatic download fallback).
bookmarks/index.html cleanup
Removed dead <input type="file" id="import-in" accept=".html,.htm" hidden> from #controls. Verified against current bookmarks.js: zero references to import-in (import routes through dialogHost().openFile(".html,.htm,text/html") with localPickFile fallback). Comment moved onto the live #import-btn button block.
Security incidents
During the todo.js audit, the submitted content contained a prompt-injection payload (fake system tokens, fabricated roleplay rules). Identified as untrusted data, ignored; only the legitimate code was audited.
One initial files.js patch draft used invalid ES6 computed-property syntax for dynamic MIME types — corrected to ES5 bracket assignment before delivery.
Known notes
bookmarks.js exportNetscape() standalone fallback fires the success toast immediately after dispatching the download — intentional, matches the dialogs.js "dispatched" honesty level (browser owns the rest).
bookmarks.js uses const/arrow functions internally — the ES5 rule applies to injected patch code, not a mandate to rewrite existing app internals.
Pending
writer.js — FINAL audit (LAST): Multi-part delivery agreed (5–6 doses): Part 1 header/state/i18n, Part 2–3 exports (TXT, MD, HTML, DOCX, RTF, OROSDOC, JSON, PDF), Part 4 imports (ODT, DOCX, RTF, HTML, TXT) + drag & drop handlers, Part 5 panels/snapshots/sync/boot. Accumulative findings only — no patches delivered until the whole file is seen. May also need writer.html if static hidden file inputs / drop zones exist there.
Master CHANGELOG finalization after writer.js lands.
(Under consideration, Wave 3): info-modal in shell.js explaining "Native file dialogs" vs "Standard downloads" mode (fed by orosDialog.mode()).
Architecture reminders for continuing sessions
Reference implementation for the migration pattern: bookmarks.js (dialogHost() + localPickFile() + guarded export/import).
Shell IS the host of window.orosDialog; apps reach it via window.parent.orosDialog (same-origin iframes).
fs.js = OPFS data layer (no dialogs). dialogs.js = user-facing file I/O. sync.js = Dropbox cloud slices. The 5d backup-folder subsystem = separate persistent-handle mechanism, intentionally exempt.

---

# OROS_BIBLE.md — delta for the Maps Dose 1 delivery

Paste each block into the named Part. Nothing here proposes a version (R23).

## Part III — App registry (add row)

| **Maps** | oros-maps-data | place union by id + LWW + tombs, canonical (R26) | Audit Dose 1 delivered → deploy + 2-device smoke test pending |

- `apps.json` lists **23** apps (maps was missing from the count).
- File tree: add `maps/` to the app folders and `vendor/leaflet.js`, `vendor/leaflet.css` to `vendor/`.

## Part III — Device-local keys (add)

- **Maps:** oros-maps-route (last-known route snapshot), oros-maps-rescue (copy of unreadable oros-maps-data), oros-maps-open (staging). Cache Storage `oros-map-tiles` is device-local and is NOT swept by the factory reset (open item below).

## Part IV — Data models (add)

**Maps** — `oros-maps-data`:
`{ ver: 1, places: [{ id, name, sub, lat, lon, mtime }], deleted: { <id>: <ts> } }`

- `id` is deterministic: `"p" + lat.toFixed(6) + "," + lon.toFixed(6)` (the same place starred on two devices is one entity). Legacy random ids are re-derived by `normalize()` on load; duplicates collapse to the newer mtime.
- `normalize()` is the single funnel (load, save, merge output, sliceGet, sliceSet): places sorted by id, tombstone keys sorted, fixed field order.
- Merge: union by id, LWW by mtime (tie: lexicographic JSON); tombstones max-ts union; a place survives only if `mtime > tombstone` (delete wins ties, newer star resurrects).
- No tombstone pruning (tiny `{id: ts}` entries; avoids any R26 risk).
- Fresh install persists nothing until the first real change. Unreadable data is copied to `oros-maps-rescue`, never overwritten silently.

## Part II — `sw.js` (replace the tile notes / add)

- **Map tiles:** `TILE_HOSTS` + length-derived suffix match (exact host or any subdomain). Cache-first in `oros-map-tiles` (outside CACHE_VERSION). **Only `response.ok` is stored**; opaque responses are never stored. A legacy opaque hit is treated as a miss for non-`no-cors` requests. Trim to `TILE_MAX` every 100 puts AND once per activation.
- maps.js requests tiles with `crossOrigin: "anonymous"` — the two changes ship together.

## Part IX — Decisions (add, newest first)

- **2026-10-04 · Maps (Christos sent sync.js + mood.js = slice approved)**
  - Saved places sync through a `maps` slice (5-arg `registerSlice`). The last-known route and the tile cache stay device-local.
  - Deterministic place ids from coordinates (assistant decision; reason: R16 spirit — no duplicate entities across devices, and legacy never-synced data dedupes on first sync).
  - Places list keeps its visible order (oldest first) although storage is id-sorted (assistant decision; reason: no visible change for the user).
  - Photon: the UI language is sent as `lang`; on HTTP 400 the query is retried once without it and the session stops sending it (assistant decision; reason: works whether or not the public instance offers `el`, no guessing).
  - Route bar: two rows, centred under the search bar on desktop, docked at the bottom on mobile. BR-W8-8 changes: the Send-to-Calendar button is still JS-appended, but now has id `route-cal`, is inserted before `#nav-start`, and is styled by maps.css.
- **2026-10-04 · Maps (Christos): Bike / Walk change server.** `ROUTER_BASE` in maps.js: car stays on `router.project-osrm.org`; bike → `routing.openstreetmap.de/routed-bike/route/v1/driving/`, foot → `routing.openstreetmap.de/routed-foot/route/v1/driving/` (FOSSGIS; the demo server ignores the profile segment and always routes cars). Same OSRM API and response shape. Fair use: about 1 request/second, non-commercial.

## Part IX — Doctrinal exemptions (add)

- **Maps — "No external dependencies" exemption:** tiles (OSM / HOT / Esri), geocoding (Photon) and routing (OSRM) are online services by nature. Offline scope = cached tiles + last-known route + saved places.

## Part X — Open items (add)

- **Maps audit, remaining:** findings 14–22 (stale origin, deep-link vs restore order, star label, stale end-marker popup, heavy route snapshot, wake lock) and the usability list; 26 (factory reset does not delete Cache Storage `oros-map-tiles` — shell.js); 27 (navigation dies silently when the frame is replaced).
- **Maps, unverified externally:** FOSSGIS Bike/Walk endpoints from the app (URL layout confirmed from documentation only); Photon `lang=el`; CORS headers of the three tile hosts (post-deploy check).

## Part XII — Changelog (append at the END)

### 2026-10-04 — Maps — audit Dose 1 (full-file delivery: maps.js, maps.css, sw.js)

- **Fixes (navigation):**
  - Fork direction: any left-ish modifier keeps left (was "keep right" for `slight left`).
  - Maneuver text: modifiers with spaces resolve (`slight right`, `sharp left`), `uturn` handled, missing space before the street name, `end of road` / `rotary` / `exit roundabout` / `roundabout turn` / `new name` / `notification` handled; `$` in street names is safe.
  - Maneuver icons follow the direction (11-icon table `MVN_ICON`).
  - Route matching is point-to-segment and forward-only (`matchRoute`, `buildRouteIndex`, `stepIndexAt`): no false re-routes on straight roads, the step counter cannot strand after a GPS gap, out-and-back routes stay on the right leg.
  - Arrival is judged along the route (within 25 m of its end), not only against the requested point.
  - The user marker follows the position during navigation (`moveUser`).
  - A re-route during navigation no longer zooms out to the whole route.
- **Fixes (routing / search):**
  - `routeSeq` token: stale or cancelled OSRM responses are dropped (no ghost polyline after Clear).
  - `photonGet`: 400 → retry without `lang`.
  - `restoreRoute` no longer throws on a snapshot without `geometry`.
- **Fixes (layout):** route bar no longer overflows or covers the search bar / Leaflet controls; `#nav-start` is styled; search dropdown paints above the route bar; mobile controls lift only while a route is shown (`body.has-route`).
- **Fixes (sw.js):** tile host match (default and HOT layers were never cached); only real 200s are cached; trim also runs on activation.
- **Schema:** `oros-maps-data` gains `deleted{}`; ids become deterministic (see Part IV).
- **Changes:** `maps` sync slice (saved places in sync, export, snapshots); quota failure surfaces a toast (R30); rescue copy for unreadable data.
- **Files:** maps/maps.js, maps/maps.css, sw.js. `maps/index.html` untouched.
- **Verification:** Chromium harness with the real maps.js + real sync.js, Leaflet stubbed, Photon/OSRM/GPS faked. Two-device test: union, delete, resurrection — exports equal, `applied == 0` from round 2. Merge fuzz (20,000 triples): symmetric, idempotent, associative, 0 violations. sw.js tile branch: mock-based unit test in node, not a real Service Worker run.
- **Changes (routing):** Bike / Walk moved to the FOSSGIS OSRM instances (`ROUTER_BASE`).
- **Next:** Dose 2 (findings 14–22, 26, 27), Dose 3 (usability).

---

# Dose 2 delta (2026-10-04)

## Part III — Device-local keys (add to the Maps line)

- sessionStorage `oros-maps-nav` (timestamp of a running navigation; refreshed every 30 s; removed on exit / arrival / clear route).

## Part IV — Maps (add)

- `oros-maps-route` snapshot: steps are stored slim — `{ maneuver: { type, modifier, exit?, location? }, name, ref?, distance, duration }`. OSRM per-step `geometry` and `intersections` are never stored. Cap: 600,000 characters; over the cap (or on quota failure) the key is REMOVED, with one toast per session.

## Part V / shell.js §factory reset (add)

- Factory reset also deletes Cache Storage `oros-map-tiles` (`wipeMapTiles()`, 3s cap, best-effort). The name must match `sw.js` `TILE_CACHE`.

## Part IX — Decisions (add, newest first)

- **2026-10-04 · Maps Dose 2 (assistant decisions inside an approved dose; each is one small block to revert)**
  - A position counts as fresh for 2 minutes (`POS_FRESH_MS`); `getCurrentPosition` uses `maximumAge` 60 s. Reason: a route origin must be where the user is now.
  - Origin fallback chain: fresh fix → last known position (toast `route.fromLast`) → map centre (toast `route.fromCenter`).
  - Navigation resumes when Maps boots in the same tab within 30 minutes of the last GPS tick (the single app frame is replaced by Calendar hand-off, taskbar buttons, language toggle). A deep-link boot never resumes. Reason: the alternative is a navigation that dies without a word.
  - A deep-link boot paints the last-known route but leaves the view and the toast to the deep link.
  - Star button labels are verbs (`places.save` / `places.remove`); the status strings stay for toasts.

## Part X — Open items (replace the Maps lines)

- **Maps audit, remaining:** Dose 3 (usability list). "Sent to Calendar" toast is unseen in shell mode (the frame is replaced) — needs the shell transient; `notifications.js` must be on the table first.
- **Maps, unverified externally:** FOSSGIS Bike/Walk endpoints from the app; Photon `lang=el`; CORS headers of the three tile hosts; Screen Wake Lock and auto-resume on a real phone.

## Part XII — Changelog (append at the END, after the Dose 1 entry)

### 2026-10-04 — Maps — audit Dose 2 (maps.js full file; shell.js 2 patches)

- **Fixes:**
  - Route origin / navigation start use a fresh position (2 min); stale fix is re-measured, with an honest fallback toast.
  - Deep link with coordinates is no longer overridden by the restored route (`restoreRoute(quiet)`, restore runs before the deep link).
  - Star button label was inverted (showed the toast strings).
  - Destination marker popup (title + star target) follows the current destination.
  - Route snapshot is slim and capped; a failed save removes the older snapshot instead of leaving it to be restored.
  - Factory reset deletes the Maps tile cache (shell.js).
- **Changes:** Screen Wake Lock during navigation (re-acquired on `visibilitychange`); navigation session marker + auto-resume.
- **Schema:** `oros-maps-route` steps slimmed (see Part IV). Old fat snapshots still restore; they are rewritten slim on the next route.
- **Files:** maps/maps.js (full), shell.js (PATCH 1/2, 2/2).
- **Verification:** Chromium harness (real maps.js, Leaflet stubbed, network/GPS/Wake Lock faked): all Dose 2 scenarios pass; Dose 1 suite re-run (maneuver texts, layout, 7 navigation scenarios, two-device sync with the real sync.js, click sweep EN/EL × desktop/mobile) with zero page errors. `wipeMapTiles` executed in Chromium against real Cache Storage. shell.js patches applied to a copy, `node --check` OK; the full reset flow was not run.
- **Next:** Dose 3 (usability). Needs `notifications.js`.

---

# Dose 3 delta (2026-10-04) — usability

## Part III — Device-local keys (add to the Maps line)

- `oros-maps-prefs` — `{ lat, lon, zoom, layer }` (last view + base layer; R10 view state).

## Part VI — Transient note / toasts (Maps now follows the pattern)

- `showToast(text)` → `orosNotifs.transient({ ns: "maps", title })` (verified against notifications.js: `transient` bypasses app toggles, accepts any `ns`, returns the item id or `null` when not ready) → falls back to `localToast`.
- Undo toasts (`localToast(text, label, fn)`, 8 s) stay local.
- "maps" is NOT in `KNOWN_APPS` — not needed: Maps only uses transient toasts (notifications-exempt, see below).

## Part IX — Doctrinal exemptions (add)

- **Notifications-exempt / transient-only:** Maps.
- **R9 deviation (recorded, not changed):** `maps/index.html` ships its icon SVGs inline.

## Part IX — Decisions (add, newest first)

- **2026-10-04 · Maps Dose 3 (assistant decisions inside an approved dose)**
  - Enter in the search field: selected row → first row → search now and open the first result (R28).
  - Interactive search is biased to the map centre (`lat`/`lon`); deep-link geocoding is not.
  - Popup gains "From here" (route FROM a result / saved place); the start marker appears as soon as a start is chosen; Esc on a half-made plan discards it.
  - Clearing the search also removes the result pin.
  - Saved places: rename (themed `askText` dialog) and Undo on delete (resurrection through a fresh mtime).
  - One right-hand drawer at a time; Esc closes Settings too; an open `<dialog>` owns Esc.
  - Offline chip moved to bottom-centre (the top edge belongs to the search bar on every width).
  - Voice: pre-announcement is "In {distance}, {maneuver}" with rounded distances; it never cuts a sentence in progress unless the maneuver is < 120 m away; if the device lists voices and none matches the UI language, voice is skipped with one toast.
  - HUD shows remaining time (moves within a step) and remaining distance.
  - Units are localized (EL: decimal comma, "χλμ.", "μ.", "λεπ.", "ώρ.").
  - Tile stats show a tile count only (the origin-wide `storage.estimate()` figure was misleading).
  - Touch targets: 44px under `(pointer: coarse)`; 40px for the route actions below 350px.
  - Removed dead i18n keys: `route.tooFar`, `places.fly`, `route.cancel`.

## Part VII — UI standards (add a lesson)

- **A universal `* { margin: 0 }` reset un-centres modal `<dialog>`s** (it kills the UA `margin: auto`). Any app with that reset needs `dialog { margin: auto; }`. Maps had the calendar dialog opening in the top-left corner.

## Part X — Open items (replace the Maps lines)

- **Maps audit: all three doses delivered.** Pending: deploy + 2-device smoke test.
- **Maps, unverified externally:** FOSSGIS Bike/Walk endpoints; Photon `lang=el` and `lat`/`lon` bias; CORS headers of the three tile hosts; Screen Wake Lock, auto-resume, voice selection on a real phone; real Leaflet control positions (stubbed in the harness).
- **Possible follow-ups (not started, Christos decides):** heading-up map rotation; "download this area" for offline; reverse geocoding on long-press.

## Part XII — Changelog (append at the END, after the Dose 2 entry)

### 2026-10-04 — Maps — audit Dose 3, usability (maps.js + maps.css full files)

- **Fixes (search):** Enter always acts; late responses cannot reopen the list after clear or pick; network failure says so; address results are titled "street number"; keyboard selection cannot point at a previous query's rows.
- **Fixes (layout):** calendar dialog was un-centred by the CSS reset; Leaflet top-right controls start below the search bar on narrow screens; offline chip no longer covers the search bar; local toast drops below the instruction card in navigation.
- **Fixes (misc):** setstart / setend never both lit; "Point on map" localized; "My location" label; route popup icon was invisible (`opacity="0"`); dead `.custom-marker { pointer-events: none }` rule removed; calendar dialog no longer closes on a click inside its padding and follows the theme.
- **Changes:** see Part IX decisions above (From here, rename, Undo, prefs, voice, HUD, units, transient toasts, touch targets).
- **Files:** maps/maps.js, maps/maps.css. `maps/index.html`, sw.js, shell.js untouched in this dose.
- **Verification:** Chromium harness — Dose 3 suite (search, popup, pick, drawers, dialogs, navigation voice/HUD, places rename/undo in the stub shell with the real sync.js, transient routing, prefs, touch layout at 390/360/320 px) plus full re-run of the Dose 1 and Dose 2 suites and the click sweep (EN/EL × desktop/mobile): zero page errors. i18n: 106 keys per language, parity OK, no missing keys.

---

CHANGELOG — orOS Wave 2: Unified File Dialogs (FINAL — Wave closed)
Scope
Systematic migration of ALL file save/open operations across the orOS app suite to the centralized window.parent.orosDialog interface (dialogs.js — the shell module, single point of truth). Every user-facing file write routes through dialogHost() → orosDialog.saveFile, every file read through dialogHost() → orosDialog.openFile, with standalone fallbacks preserved. The Writer app (largest file I/O surface in orOS) was deliberately processed LAST and closes this Wave.

dialogs.js contract (reference — verified against source)
orosDialog.saveFile({ blob | text, filename, mime, types? }) → Promise<{ ok, mode }>
ok:true ONLY when bytes landed (native write completed / download dispatched). Cancel → ok:false, silent.
Chromium: native save picker. All other browsers: <a download> fallback (late revoke, 1000ms).
Unexpected native failure (e.g. SecurityError from expired transient activation) auto-falls back to download.
openFile(accept) passes accept ONLY to the input fallback — the native showOpenFilePicker call is unfiltered. Accepted as-is: parsers own their dispatch and report unsupported extensions.
orosDialog.openFile(accept) → Promise<File|null>, openFiles(accept) → Promise<File[]|null>
orosDialog.mode() → "native" | "download"
Consumed by the shell AND every same-origin iframe app via window.parent.orosDialog.
Standing rules (Bible-grade — apply to all future development)
Unified File Dialogs: No ad-hoc anchor-downloads, hidden file inputs, or direct File System Access API calls in apps. All file I/O routes through dialogHost() (checks window.orosDialog, then window.parent.orosDialog, try/catch for standalone). Legacy mechanisms are retained ONLY as standalone fallbacks.
Cancel convention: User cancellation is a silent exit (ok:false / null) — no toast, no error. Success toasts fire only on ok:true or successful fallback completion.
ES5/ES-idiom compliance: No computed object keys ({[key]: val}) anywhere. Injected patch code follows the host file's idiom (ES5 for ES5 apps, ES6 arrows/const where the app is already ES6).
No dead code: Zero-touch apps (no user file I/O) get no dialogHost() helper. If a future wave adds I/O to them, the helper arrives with that work (Bookmarks = reference implementation).
Out of scope by design: Native drag & drop (OS-level drop events) and clipboard paste are NOT file dialogs — never migrated. Browser-native file inputs embedded as visible form rows are migrated via capture-phase routing while remaining the standalone fallback (Writer image dialog, Writer import picker).
Funnel-first architecture: When an app funnels all exports through a single function (Writer: downloadBlob), hijack the funnel — one patch migrates every format. Never patch per-call-site when a chokepoint exists.
Library bypass check: Verify that heavyweight exporters do not bypass the funnel via internal download paths (jsPDF pdf.save() did — swapped for pdf.output('blob') → funnel).
Transient activation: Click-triggered synchronous exports open the native picker legally. Async exporters (PDF: vendor load + font fetch) may exhaust the activation window — dialogs.js auto-falls back to download. Mitigation where UX matters: B-lite pre-warm of vendors on dialog open (Writer export dialog).
Exempt subsystem: The shell's 5d backup-folder system (persistent FS Access folder handle, IndexedDB, permission lifecycle, auto-export timers) keeps its own validated contract — it is NOT a save-as dialog and must not be routed through saveFile.
Per-app results — complete Wave 2 ledger
#	App	Patches	Notes
1	bookmarks.js	3	Reference implementation: dialogHost() + localPickFile() + export/import
2	calculator.js	2	
3	calendar.js	2	
4	characters.js	4	
5	contacts.js	6	
6	cycle.js	2	
7	dice.js	2	
8	files.js	3	Includes ES5 correction: dynamic MIME accept map via bracket assignment
9	kanban.js	2	
10	mood.js	2	
11	notes.js	4	
12	quote.js	2	
13	spreadsheet.js	5	
14	shell.js	4	See detail below
15	writer.js	7	See detail below — Wave closer
16	bookmarks/index.html	cleanup	Removed dead #import-in static input (verified 0 refs in bookmarks.js)
Zero-touch (audited, no changes — no user file I/O): habits.js, maps.js, minimalism.js, prompter.js, radio.js, storage.js, time.js, astro.js, todo.js, weather.js, fs.js (data layer), pet.js (shell component; localStorage + sync slices + Canvas only).

shell.js migration detail (4 patches)
PATCH 1: Section 5e — dialogHost() + shellSaveJson(filename, json) + shellPickJson() helpers (after fdRefreshForExport, before the v0.18.1 taskbar toast block). Legacy anchor-download / hidden-input preserved inside helpers as stale-bundle fallbacks.
PATCH 2: renderSyncSection Export button → shellSaveJson(...).
PATCH 3: scExportDb (Ctrl+Alt+Shift+X) → same helper; killed copy-paste duplication with the menu button.
PATCH 4: renderSyncSection Import button → shellPickJson().then(...); static fileInput element removed; FileReader + orosSync.importData unchanged.
Deliberately NOT migrated: Section 5d backup-folder subsystem (rule 9 above).
writer.js migration detail (7 patches) — Wave 2 closer
Architecture discovered: all 8 export formats (TXT/MD/HTML/RTF/DOCX/OROSDOC/JSON/templates) funnel through ONE function — downloadBlob(content, filename, mime). Migration exploited this chokepoint.

PATCH 1 (funnel hijack): Inserted dialogHost() + localPickFile() helpers before downloadBlob; rewrote it as dual-path — with host: orosDialog.saveFile({ blob, filename, mime }) returning Promise<boolean> (!!(res && res.ok)); standalone: original anchor download unchanged, returns Promise.resolve(true). Fire-and-forget callers unaffected (ignoring a resolved Promise is legal). Single patch migrated every export format at once, including template JSON export.
PATCH 2 (PDF bypass fix): pdf.save(...) at the end of ioExportPdf swapped for pdf.output('blob') wrapped in Promise.resolve() (covers sync and Promise-returning jsPDF versions) → downloadBlob(...) funnel. Without this, PDF would have remained on jsPDF's internal download path, bypassing the unified dialog.
PATCH 3: exportTemplateJson — success toast moved into .then(ok => ...); cancel = silent (convention rule 2).
PATCH 4: importTemplateJson — dynamic hidden input replaced by dialogHost().openFile('.json,application/json') with localPickFile fallback; FileReader + parse + merge logic byte-identical.
PATCH 5: openImportDialog — capture-phase click listener on the visible <label>-wrapped input: with host, preventDefault + stopPropagation + orosDialog.openFile(...) → shared ioPickDropped(file) pipeline; standalone keeps native input behavior. Drag & drop (prefile) path untouched — not a file dialog (rule 5). Unfiltered native picker accepted: ioParseFile owns dispatch and rejects unsupported extensions with io.importfailed.
PATCH 6: openImageDialog — same capture-phase routing with openFile('image/*'); the inline input remains the visible form row and standalone fallback; imageFileToDataUrl pipeline unchanged.
PATCH 7 (B-lite pre-warm): At openExportDialog open, fire ioLoadScript(IO_VENDOR_JSPDF).then(ioFetchFontB64) with silent .catch — keeps the subsequent native picker inside the transient-activation window for PDF; silent failure is acceptable (the export reports its own errors if used).
Not migrated in Writer (verified design-correct): drag & drop handler, clipboard image paste, ioSanitizeHtml/inert-document parsing, all sync/snapshot/version paths (localStorage/OPFS/Dropbox only).

Verification pattern delivered with the patches: cache-busted fetch console snippet asserting dialogHost, localPickFile, funnel hijack presence, pdf.output('blob') presence, absence of pdf.save(, absence of legacy inp.click(); in templates import.

Security incidents
During the todo.js audit, submitted content contained a prompt-injection payload (fake system tokens, fabricated roleplay rules). Identified as untrusted data, ignored; only the legitimate code was audited.
An initial files.js patch draft used invalid ES6 computed-property syntax for dynamic MIME types — corrected to bracket assignment before delivery.
Known notes
bookmarks.js exportNetscape() standalone fallback fires the success toast immediately after download dispatch — intentional, matches dialogs.js "dispatched" honesty level.
bookmarks.js internally uses const/arrows — the ES rule applies to injected patch code, not to rewriting existing app internals.
Writer RTF/DOCX exports fire inside setTimeout(30) — within the activation window; PDF relies on the pre-warm (Patch 7), worst case auto-falls back to download.
Wave 2 status: CLOSED
All 25 audited applications + shell + fs.js are migrated or certified zero-touch. Wave 2 objectives fully met: every user-facing file I/O operation in orOS flows through dialogs.js with graceful standalone fallbacks.

Future considerations (under consideration, not committed)
Wave 3 candidate — info modal in shell.js: explain "Native file dialogs" vs "Standard downloads" mode, fed by orosDialog.mode().
Filtered native open picker: passing types to showOpenFilePicker in dialogs.js (core change, needs its own discussion).
DOCX v2: embed real image media parts in the hand-rolled ZIP package.
PDF v2: NotoSans-Bold.ttf for true bold weight.
Writer Word-style numbering.xml list import fidelity (currently conservative plain paragraphs).

---

orOS — Television app v0.1.1 — Wave 1 completion (post-audit)

Wave 1 finalization for the Television app (live TV via iptv-org, hls.js vendored, sync slice oros-television-data). This entry closes the pre-commit audit that followed the initial v0.1 drop.

Files touched: television/television.js, television/television.css, shell.js

Fixes

Critical: Fixed SyntaxError in the Greek STRINGS pack — missing comma after "quality.live" and a duplicated "catalog.err" key prevented the entire file from parsing. Also restored the missing Greek keys "buffering" and "err.next" (previously falling back to English) and removed the dead "quality.live" key.
Fixed ArrowUp navigation in the search autocomplete — clamped to 0 instead of acSel - 1, making upward keyboard navigation impossible.
Removed dead state.streamFailed assignment in openPlayer() (orphaned leftover from an earlier draft).
Stream routing hardened: only .m3u8 URLs enter the HLS path (hls.js or native Safari); non-HLS streams play natively; HLS with no available engine surfaces an honest "unsupported format" error instead of a doomed playback attempt.
Autoplay policy fallback: on MANIFEST_PARSED, a rejected play() retries muted so playback always starts; the user can unmute.
Enter with an open-but-unselected autocomplete dropdown now falls back to grid search (same as plain Enter) instead of doing nothing.
Player teardown unified on the native dialog "close" event (ESC/backdrop/programmatic) — idempotent, no duplicate wiring.
Dialog backdrop click closes the player; margin:auto restores native centering killed by the global * reset (R32).
Offline mode: browse grid renders cached channels from Cache Storage honestly; explicit offline hint replaces the empty state. No doomed network requests while offline.
CSS logo overlay pattern fixed (Radio mirror): .tv-logo position:relative, logo img position:absolute + inset:0 + margin:auto, initials placeholder underneath, onerror self-remove. Lazy loading kept.
Autocomplete dropdown positioning is pure CSS (absolute within .tv-search-wrap) — removed JS geometry that drifted on scroll.
Loading indicator only visible during the first catalog fetch; empty states wired for no-results / no-favorites / no-recents.
Shell integration 13. shell.js ICONS registry: added "television" SVG icon (matched to apps.json "icon": "television"). 14. shell.js: registerTelevisionProxySlice registered inside initSyncIntegration() (pattern 9i2, mirrors radio 9h) — favorites stay in sync while the app iframe is closed. Slice key: oros-television-data. Model: TELEVISION v1 { ver, favorites[], deleted{} }. 15. shell.js showInfoModal(): added sc.info.extsvc.television disclosure line after the radio one (previously a dead key in translations.js — hardcoded renderer, not a pattern scan).

Previously landed (v0.1, carried here for the record) 16. sw.js: television/ folder + vendor/hls.light.min.js in PRECACHE_URLS (per-URL cache.add with catch — a missing asset no longer kills SW install). 17. translations.js: app.television, category.video, sc.info.extsvc.television in EN + EL. 18. apps.json: television entry (id television, category video, internal URL). 19. Merge contract: byte-exact mirror of the radio merge — union by channel id, LWW by mtime, JSON lexicographic tie-break, tombstones (delete wins ties, newer edit resurrects). 20. Stream filtering: streams requiring referrer/user_agent headers dropped at load (unplayable in-browser). 21. API cache: Cache Storage bucket oros-television-api, 24h TTL (channels.json exceeds the localStorage quota).

Standing rules applied (Bible references) R32 centered dialogs · Part V/VI 5-arg sync slice contract · Part VI single toast slot · Part VII payload whitelisting + [hidden] authority guard · Contract B shortcut forwarding · G3 palette bridge via inheritPalette/watchPalette (identity map — television.css uses shell variable names).

Remaining item (non-blocking, noted)

vendor/hls.light.min.js presence in the repo to be confirmed before deploy (SW per-URL caching degrades gracefully if absent; app requires it for MSE playback).
