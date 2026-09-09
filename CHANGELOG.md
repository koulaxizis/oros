- Migrations in BOTH `load()` and `sliceSet` (via migrate()). Missing
  stamps default to 0 = "oldest" (real remote data always wins).
- Mutations: content edits `touch(entity)` (mtime); reorders stamp
  collection `om` + rewrite `pos` (content mtimes untouched);
  deleteList cascades tombstones to items; undo does stampAll().
- Search/filter are SESSION-ONLY (never persisted — a pull must not
  resurrect a stale view).
- Toast keys exist: "toast.merged" = "Synced changes from another
  device" / «Συγχρονίστηκαν αλλαγές από άλλη συσκευή».

### Locked API surfaces
- window.t(key) — i18n, fallback chain active → en → key.
- window.orosSync: connect/disconnect/isConnected/getUserInfo/pull/
  push/reconcile/setPassphrase(pw, remember)/hasPassphrase/
  forgetPassphrase/clearDevice/hasDeviceVault/registerSlice/markDirty/
  isDirty/getIntervalMinutes/setIntervalMinutes/onAutoSync/
  kickAutoEngine/vaultUnlocked/redirectHandled/errorKey/exportData/
  importData.
- registerSlice(name, get, set, storageKey?, mergeFn?) — see Sync
  architecture above. Manual Export/Import includes ALL registered
  slices; import passes through mergeFn when present.
- App convention: same-origin iframe; app reads oros-lang from shared
  localStorage; inherits shell palette via computed vars +
  MutationObserver on parent data-skin/data-theme; sync via
  parent.orosSync.registerSlice.
- Sync-loop rule: pull-fed setters NEVER markDirty. User-action
  handlers DO (__orosSyncApi.dirty() — bridge created
  unconditionally, standalone-open safe).

### Registries (shell.js)
- SKINS (10): adwaita #3584e4, lumo #6d4aff,
  oros #d4af37/#b8860b (BRAND DEFAULT), ubuntu #e95420, fedora #51a2da,
  mint #87cf3e, arch #1793d1, debian #d70a53, elementary #8c5ec7,
  tux #c9c9c9. All ship full 12-var palettes × dark/light in style.css.
- WALLPAPERS (10, JS registry — gradients as inline styles): dusk,
  midnight(arch), plum(ubuntu), forest(mint), ember(debian),
  nordic(fedora), aurora(elementary), sand(oros), mono(tux), clear(none).
  DEFAULT_WALLPAPER="sand".
- Defaults (v0.4.3): skin oros, wallpaper sand, theme dark, lang en.
- Pair suggestion fires ONLY when user is on the default wallpaper and
  ONLY on user skin clicks — never on pulls.

---

## v0 — Core shell
- GNOME-style persistent top bar (40px): menu left; lang + clock right.
  Bar visible in all views.
- Fullscreen app takeover (iframe) below the bar; Esc or menu button
  returns to desktop. External apps (type: "external") open a new tab.
- apps.json fetch with graceful fallback to empty state; schema:
  id, name, category, icon, url, type ("internal"|"external").
- Dark default + light toggle (Appearance). 24h clock, comma stripped.
- translations.js: OROS_TRANSLATIONS (EN/EL) + t() fallback chain.
- Post-v0 polish: clock comma strip, SVG glyph for empty state,
  skin.title key, EN/EL short lang codes, theme toggle in Appearance
  (moon/sun inline SVGs), tofu-prone unicode → inline SVGs, desktop
  footer removed.

## v0.1 — Offline-first + mobile + install
- sw.js: precache shell, network-first navigations, cache-first assets,
  runtime cache for apps. manifest.webmanifest: standalone, icons.
- style.css: mobile-first pass — 100dvh, safe-area insets, 44px touch
  targets, full-width menu sheet ≤480px, -webkit-backdrop-filter.
- Install flow: beforeinstallprompt captured with preventDefault +
  EXPLICIT prompt() on our own Install button (never silent banners).
- Manifest icon purposes un-swapped; maskable inner scale → 62%.

## v0.2 — Dropbox sync
- sync.js: window.orosSync — PKCE OAuth (S256), refresh with 5-min
  early renewal, app-folder blob /orOS-data.json, AES-GCM + PBKDF2
  (100k), versioned blob (ver: 1), slice architecture, push with
  automatic remote backup (max 5), pull/apply, ?code= redirect handled,
  errorKey() → sync.err.* i18n keys. Redirect URI must match exactly
  incl. trailing "/" (learned the hard way).
- Boot dependency order: translations → sync → shell.
- style.css section 9 (sync UI). shell.js renderSyncSection: three
  states, status dot + email, messages survive re-renders.

## v0.2.1 — User-controlled updates
- sw.js: no skipWaiting on install; "SKIP_WAITING" message channel.
- shell.js: update detection + floating toast.

### v0.2.2 — UX fixes
- Menu stays open on internal clicks (stopPropagation on #app-menu;
  re-render detaches click target → containment check misfires).
- Passphrase show/hide eye. Install row in its own section.

## v0.3 — Trusted device vault + auto-sync
- sync.js: IndexedDB vault with NON-EXTRACTABLE AES-GCM device key;
  passphrase sealed to localStorage, opt-in auto-unlock on boot.
- Persistent dirty flag; auto engine: boot reconcile, interval pushes,
  push-on-visibilitychange-hidden. onAutoSync() subscription.
- shell.js: remember checkbox, kickAutoEngine after unlock, visible
  unlock flow. clearDevice vs forgetPassphrase split.

### v0.3.1 — Sync refinements
- Interval select Off/1/3/5/15 (applied immediately).
- Menu: "Update orOS" replaces "Install orOS" while a version waits.

### v0.3.2 — Local backup (export/import)
- exportData/importData: full plaintext payload, offline, no
  passphrase; import marks dirty. Download: orOS-backup-YYYY-MM-DD.json.

### v0.3.3/0.3.4 — Update detection + toast polish
- watchWorker() covers already-installing workers (boot race);
  update() at boot + hourly; 500ms grace, 0.35s fade, toastQueued dedupe.

### v0.3.5 — Update broker (ROOT-CAUSE fix for cached shells)
- Update machinery moved INLINE into index.html (network-first HTML =
  always fresh) — a cached shell could never deliver its own update
  (chicken-and-egg). Broker owns full lifecycle.

### v0.3.6 — Final cluster
- Synced auto-sync interval (shell slice field). Silent-update welcome
  toast (APP_VERSION + checkVersionToast; device-local). Stale asset
  hotfix lesson (see ritual). Tooling: single-source version stamping.

## v0.4 — Skins & Wallpapers
- v0.4.0: +7 Linux skins (total 10). Wallpaper system: 10 pure-CSS
  gradients; choice synced via shell slice.
- v0.4.1: ROOT CAUSE (wallpapers never applied): #oros-desktop
  selector outranked .wp-* classes → gradients as INLINE STYLES.
- v0.4.2: full 12-var palettes (dark+light) for the 7 new skins.
- v0.4.3: defaults = oros skin + Desert Sand wallpaper; EN default.

## v0.5.0 — First app: To-Do
- apps.json first entry. Tabbed lists, items with due + notes, quick-
  add natural date parsing ("tomorrow"/"friday", Greek with accent
  stripping), item-level recurrence + list-level cycles, overdue
  badges, hide/clear-completed, pointer drag reorder, undo toast,
  confirm dialogs.
- registerSlice("todo"); _suppress bridge (pull never re-pushes).
- Live palette + language inheritance. Inline app i18n (self-containment
  over DRY).

### v0.5.1 — To-Do 404 fix
- ROOT CAUSE: entry "todo/" needed todo/index.html (directory URLs
  serve index.html). Locked convention: <app>/index.html, referenced
  as "<app>/".

### v0.5.2 — Typography + app icons
- Local Nunito (5 weights) vendored at fonts/. Zero external requests.
  ForkAwesome PERMANENTLY rejected — SVG-only icon strategy. ICONS
  registry; apps.json "icon" live. sw.js precaches todo/ + fonts/.
  REMINDER: woff2 must include the Greek subset.

### v0.5.3 — Category translation
- Categories translated via dynamic keys (category.<lowercase>,
  EN/EL), graceful fallback to capitalized raw value.

## v0.6.0 — Sync engine: persisted slices + carry-forward
- ROOT CAUSE (To-Do data loss while export worked): slice registry was
  in-memory only — closed-app pushes omitted app slices AND silently
  overwrote the cloud blob.
- registerSlice gains storageKey; registrations persist
  (oros-slices). Boot hydrates proxies for closed apps.
- Carry-forward mailbox — a device can never wipe unknown app data.
- Recovery note: remote orOS-backup-*.json files may hold the latest
  todo-inclusive payload.

## v0.6.2 — Cleanup wave: zero-gate updates + syntax repairs
- FIX (critical): renderInstallRow orphaned body killed ALL of
  shell.js (SyntaxError). FIX (critical): renderWallpaperSection
  self-append → HierarchyRequestError on every renderMenu().
- Zero-gate updates: sw.js skipWaiting() on install; broker forces
  byte-check every load + hourly, auto-reload on controllerchange.
  Version toast = sole confirmation (user gate retired — v0.6.0 sat
  installed-waiting while v0.5.0 caches served).
- Dead code purge (sw.js, style.css, shell.js, translations.js).
- Manifest "version" key added (greps succeed loudly).
- To-Do fixes: "Γενικά", "Ψώνια", dead ternary, repeat icon SVG.
- beforeunload dirty-guard. sw.js icons precache.

## v0.6.3 — Polish wave
- Themed slim scrollbars (browser default ate ~15px menu width).
- Menu 300→320px, nowrap+ellipsis labels (Greek sync labels wrapped).
- Version badge next to orOS button (reads APP_VERSION) — permanent
  visual update confirmation; mobile update verification was our
  recurring blind spot.
- To-Do standalone-open guard: __orosSyncApi bridge created
  unconditionally.

## v0.7.0 — Second app: Kanban (core v0.1)
- One board, columns add/rename/delete+undo, cards quick-add, edit
  dialog, counters, pointer drag within + across columns.
- Threshold-gated drags (plain taps stay clicks); touch-action: pan-y.
- Sync from line one (slice "kanban" + unconditional bridge).
- Minimal-core rule: everything else parked until usage demands.

## v0.7.1 — Kanban Wave 1 (card content) — 2026-09-09
- Subtasks (checklist + progress), extra info (free key-value),
  duplicate card. DATA_VER 1→2, additive migration. Live-editing
  dialog (Save just closes).
- Backlog: multi-board, priorities, due dates, card colors, markdown,
  timestamps, archive, stats, CSV export, dashed add-column, print.
  Out: UI toggles, ForkAwesome, prompt() CRUD, in-app theme toggle,
  local FS sync.

## v0.7.2 — Kanban Wave 2 (labels, search, filter) — 2026-09-09
- Board-wide labels (8 swatches, chip picker in card dialog), live
  search (text/notes/info/labels), filter popover (OR within labels,
  AND with search), delete-label with global cleanup. DATA_VER 2→3.
- Mobile: title hidden <480px, 16px search input (no iOS zoom).

## v0.8.0 — Kanban Wave 3 (column reorder + rename) & automated cache-busting — 2026-09-09
- Column drag reorder (horizontal bias, pencils excluded from grab),
  always-visible rename pencil. Automated `?v=` cache-busting Action
  (reads APP_VERSION, stamps all relative refs in root + app
  index.html — stale-asset class of bug now impossible).

## v0.9.0 — To-Do: Kanban-pattern port — 2026-09-09

**Why:** sibling apps share the same interaction DNA. Six Kanban
features ported to To-Do's list-centric model.

- Labels (board-wide store + item ids), filter by label (popover),
  global search (ALL lists, flattened, source chip per row — covers
  text/notes/info/label names), extra info (free key-value, dim
  preview), tab drag reorder (horizontal bias), tab rename pencil.
- DATA_VER 1→2 additive (in load() AND sliceSet). Slice name
  "todo" + STORAGE_KEY unchanged — blobs migrated transparently.
- Search/filter session-only. Deliberately NOT ported: subtasks
  (backlog for a future wave).

## v0.10.0 — Sync Merge Wave — 2026-09-09

**Status: deployed, test ritual pending (see CURRENT STATE).**

**Why:** two devices with the same app open simultaneously must
converge instead of last-write-wins wiping one side. Aggressive sync
schedules (debounce!) are only SAFE on top of merge — this wave builds
that foundation, then enables sync-on-change.

### Core (sync.js v0.7)
- **Slice merge API**: `registerSlice(..., mergeFn)` — opt-in 5th
  argument; legacy registrations LWW as before.
- **Full reconcile** (pull → merge → push if dirty) on boot, interval,
  tab-VISIBLE, debounce. Tab-hide stays push-only.
- Merge convergence marks dirty → converged state reaches the cloud on
  the next push. Deterministic merges stop the two-devices ping-pong.
- mergeFn throw degrades slice to LWW — sync never blocks.
- importData passes through merges — an old backup can no longer
  clobber newer work on merge-capable apps.
- Known limit: closed apps (proxies) have no mergeFn → LWW while
  closed. Documented trade-off.

### Sync-on-change (sync.js v0.7.1)
- markDirty arms a 5s debounce → reconcile("debounce") (FULL
  reconcile, not bare push — pushing stale state wastes round-trips).
  Burst edits coalesce into one; no-ops when already clean; guarded
  by the same in-flight flags. Why merge-first matters here: with the
  old overwrite model, faster pushes would have meant MORE chances
  to clobber, not fewer.

### To-Do (v0.4)
- **DATA_VER 3** — mtime/om/pos/deleted/sm stamps, additive migration
  (missing stamps = 0 = oldest → real remote data wins).
- Tombstones: soft deletes, pruned after 30 days; delete beats older
  edits, newer edit resurrects (edit-after-delete works).
- mergeTodoStates: deterministic + symmetric (scalars by sm, content
  by mtime, ties by lexicographic JSON, ordering by larger om,
  unknown entities append). Lists merge structurally — header edits
  never clobber item edits from the other side.
- Undo stampAll() (restored snapshot wins the next merge and
  propagates). List-cycle rollovers stamp (both devices agree the
  cycle happened).
- Merge toast appears only when a pull actually changed something.
- Fixes: stray l-cancel listener (broke entire wiring), item delete
  removes locally too, default lists distinct ids (shared-object bug).
- todo/index.html audited against the full v0.4 ID inventory — all
  present, no changes needed.

### Under consideration
- Kanban merge port (same contract, tombstones for cards/columns/
  labels) — next wave after the test ritual passes.
- Realtime-sync settings toggle (debounce on/off) — default is on.
- Per-field merge granularity for task text — unnecessary now,
  revisit only if real conflicts bite.

---

## Known TODO / backlog
- Sandbox attribute for external/untrusted app iframes (revisit).
- Windowed mode = future opt-in only.
- Menu badge for open todo count (needs postMessage bridge).
- Extra skins (Nord/Dracula test), About surface (credits + privacy).
- To-Do subtasks (Kanban port), Kanban merge port.