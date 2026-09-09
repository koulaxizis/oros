# orOS Changelog

Static OS shell living in the browser. Hosted at https://useoros.online
(GitHub Pages via custom domain; repo: github.com/koulaxizis/oros).
Single permanent "dev" channel, always stable. Dark theme default with
light toggle in Appearance. EN default, EL secondary. 24h clock.
Privacy-first: no cookies, no tracking, no ads. MIT.

---

## CURRENT STATE (read after registries — updated every wave)

- **VERIFIED 2026-09-09: cross-device merge works end-to-end** (To-Do).
  Both devices converge to identical state; merges render live
  (no refresh needed); same-task LWW and edit-vs-delete-resurrection
  behave as designed. Merge era LIVE.
- **LIVE: sync.js v0.7.1 + todo.js v0.4 + 6 point patches** (5 tie-break
  symmetry fixes + hide-completed checkbox sync in renderAll()).
- **NEXT: Kanban merge port** — same slice contract ported to
  kanban/ (cards/columns/labels as entities, tombstones, om/pos for
  column order AND card order per column, DATA_VER 3→4). Need
  kanban.js + kanban/index.html supplied in chat before starting.
- **Merge-era lessons (apply to EVERY future port — none negotiable):**
  1. Tie-breaks MUST be symmetric. `(a) >= (b) ? a : b` favors the
     LOCAL side (merge is always called merge(local, remote)) — two
     devices with equal stamps then diverge and ping-pong. On ties:
     lexicographic compare (of scalars, or of id-sequences for
     ordering refs) decides IDENTICALLY on both sides. Helper shape:
     pickRef(aArr, bArr, aOm, bOm).
  2. Every DOM control bound to state (checkboxes etc.) must be
     re-synced inside renderAll() — a merged state change otherwise
     leaves stale DOM visuals.
  3. Opening an app must reconcile on register (sync.js
     registerSlice tail, reason "register") — otherwise device B only
     learns remote changes at the next interval tick.
  4. BEFORE any multi-device test: verify BOTH devices actually run
     the new code (version badge, console markers, data ver). The
     2026-09-09 debug session burned on symptoms caused by one device
     serving stale cache-first assets — infrastructure was fine.
- **Deferred/under consideration:** realtime-sync settings toggle
  (debounce on/off, default on); per-field task text merge (whole-task
  LWW suffices so far); merge-capable closed apps (mergeFn as data —
  deliberately out).

---

## RELEASE RITUAL (locked)

1. Change whatever (shell.js, sync.js, translations.js, style.css, apps/…).
2. Bump `APP_VERSION = "X.Y.Z"` in shell.js — the SINGLE release key.
3. GitHub Action (.github/workflows/bump-version.yml) auto-stamps
   sw.js CACHE_VERSION="oros-v<X.Y.Z>", manifest "version" AND `?v=`
   on every relative .css/.js ref (root + app index.html) on push to
   main (fails loudly if lines missing; idempotent otherwise).
4. CHANGELOG entry per change (English, "why" included).
5. Multi-device features: verify BOTH devices run the new code
   BEFORE interpreting test results (lesson 4 above).

LESSON (never repeat): deploys that change assets without a version
bump silently strand mobile on stale cache-first assets. Desktop looks
fine only because hard refreshes bypass the SW.

---

## REFERENCE REGISTRIES (kept current — read this first in a new chat)

### File tree (repo root)
- index.html — markup + INLINE update broker script (must stay inline!)
- style.css — shell styling
- shell.js — shell logic, APP_VERSION constant on top
- translations.js — OROS_TRANSLATIONS (EN/EL) + window.t() fallback
  chain (active → en → key)
- sync.js — window.orosSync v0.7.1 (loaded BEFORE shell.js)
- apps.json — installed apps registry
- sw.js — CACHE_VERSION bump per deploy
- manifest.webmanifest
- icon.svg + icons/ (4 PNGs: any+maskable 192/512, maskable scale 62%)
- todo/ — To-Do app (index.html, todo.css, todo.js v0.4 — MERGED)
- kanban/ — Kanban app (index.html, kanban.css, kanban.js — merge PENDING)
- fonts/ — local Nunito woff2 (5 weights, Greek subset required)
- .github/workflows/bump-version.yml

### localStorage keys (registry)
- oros-lang ("en"|"el")         — synced (shell slice)
- oros-theme ("dark"|"light")   — synced (shell slice)
- oros-skin                     — synced (shell slice)
- oros-wallpaper                — synced (shell slice)
- oros-sync-interval            — user-configurable, carried via slice
- oros-sync-dirty               — dirty flag (persisted)
- oros-vault-data               — sealed passphrase (trusted device)
- oros-last-version             — DEVICE-LOCAL, never synced (welcome toast)
- oros-slices                   — persisted slice registry (name→storageKey)
- oros-remote-carry             — carry mailbox for unknown remote slices
- oros-todo-data                — To-Do data (slice "todo", DATA_VER 3)
- oros-kanban-data               — Kanban data (slice "kanban", DATA_VER 3)

### Sync architecture (merge era, sync.js v0.7.1)
- Payload: `{ shell: {...}, apps: { <name>: ... }, meta }`. Blob
  `/orOS-data.json` AES-GCM + PBKDF2 100k, backups max 5 (pruned).
- **Slice contract:** `registerSlice(name, get, set, storageKey?,
  mergeFn?)` — mergeFn(local, remote) → merged state or null (null
  falls back to plain apply). Must be DETERMINISTIC + SYMMETRIC:
  merge(A,B) === merge(B,A) INCLUDING ties (see lesson 1 in CURRENT
  STATE). mergeFn throwing degrades that slice to LWW (sync never
  blocks).
- **Setter contract:** `set(data, info)` where `info.merged===true`
  means "came through merge" (apps use for a toast); legacy setters
  ignore the 2nd arg. Pull-fed setters NEVER markDirty (loop rule).
- **App merge schema (To-Do v0.4 shape — canonical template for
  every port):** entities carry `mtime` (content version);
  collections carry `om` (ordering version) + per-item `pos`;
  root scalar prefs LWW by `sm`. Deletions = tombstones in
  `state.deleted = {id: ts}`, pruned after 30 days. Delete beats older
  edits; edit newer than tombstone resurrects. Parent-child containers
  merge STRUCTURALLY (header LWW by mtime; children merge
  independently; ordering of children governed by container's om).
- **Engine triggers:** boot / interval / tab-VISIBLE / debounce(5s
  after last edit, armed inside markDirty) / app-register → full
  RECONCILE (pull → merge → push if dirty). Tab-HIDE → push-only
  (zero-loss at close). Guards: reconcileInFlight/pushInFlight;
  navigator.onLine gates all; DEBOUNCE_MS = 5000.
- **Convergence rule:** merge result ≠ remote ⇒ cloudStale ⇒ markDirty
  ⇒ next push uploads it. Deterministic merges make both devices push
  IDENTICAL payloads — ping-pong self-extinguishes.
- **Closed apps:** hydrated proxies (no mergeFn — app code can't run)
  sync LWW. Merge exists only while the app is open. Known trade-off.
- **Carry-forward:** remote slices unknown on a device park in
  oros-remote-carry and relay forward — a device can never wipe app
  data it doesn't know about.

### To-Do data model (todo.js v0.4, DATA_VER 3) — troubleshooting refstate = { ver: 3, sm: <settings mtime>, om: <list-order version>, activeList: <id>, hideCompleted: bool, deleted: { <entityId>: <tombstone ts> }, labels: [{ id, name, color, mtime, pos }], lists: [{ id, name, mtime, om, pos, recurrence: null | {every, unit, weekday}, lastReset: iso, nextReset: iso, items: [{ id, text, done, due, notes, labels: [<label id>], info: [{ id, label, value }], recurrence: null | {every, unit, weekday}, mtime, om, pos }] }] }
- Migrations in BOTH `load()` and `sliceSet` (via migrate()). Missing
  stamps default to 0 = "oldest" (real remote data always wins).
- Mutations: content edits `touch(entity)` (mtime); reorders stamp
  collection `om` + rewrite `pos` (content mtimes untouched);
  deleteList cascades tombstones to items; undo does stampAll().
- renderAll() re-syncs the hide-completed checkbox (lesson 2).
- Search/filter are SESSION-ONLY (never persisted — a pull must not
  resurrect a stale view).
- Toast keys: "toast.merged" = "Synced changes from another device" /
  «Συγχρονίστηκαν αλλαγές από άλλη συσκευή».

### Kanban data model (kanban.js, DATA_VER 3 — PRE-merge, ref for port)
- Single board. Columns: add/rename(dblclick+pencil)/delete+undo,
  drag reorder. Cards: quick-add per column, edit dialog (text,
  notes, subtasks [{id,text,completed}], info [{id,label,value}],
  labels []), duplicate, drag within + across columns, counters,
  board-wide label store, live search + filter by label.
- Slice "kanban", STORAGE_KEY "oros-kanban-data", unconditional
  __orosSyncApi bridge (standalone-open safe). NO mtime/tombstones
  yet — that is exactly what the port adds.

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
- Fullscreen app takeover (iframe) below the bar; Esc or menu button
  returns to desktop. External apps (type: "external") open a new tab.
- apps.json fetch with graceful fallback to empty state; schema:
  id, name, category, icon, url, type ("internal"|"external").
- Dark default + light toggle (Appearance). 24h clock, comma stripped.
- translations.js + t() fallback chain. Inline SVGs everywhere (no
  ForkAwesome — permanently rejected). Desktop footer removed.

## v0.1 — Offline-first + mobile + install
- sw.js: precache shell, network-first navigations, cache-first
  assets. manifest.webmanifest: standalone, icons.
- Mobile-first CSS: 100dvh, safe-area insets, 44px touch targets.
- Install flow: beforeinstallprompt captured + EXPLICIT prompt() on
  our own Install button. Maskable inner scale → 62%.

## v0.2 — Dropbox sync
- sync.js: PKCE OAuth (S256), refresh with 5-min early renewal,
  app-folder blob /orOS-data.json, AES-GCM + PBKDF2 (100k), versioned
  blob, slice architecture, push with automatic remote backup (max 5),
  pull/apply, ?code= redirect handled, errorKey() → sync.err.* i18n
  keys. Redirect URI must match exactly incl. trailing "/"
  (learned the hard way).
- Boot dependency order: translations → sync → shell.

### v0.2.1–v0.2.2 — Updates + UX fixes
- SKIP_WAITING channel (later retired in v0.6.2). Menu stays open on
  internal clicks (stopPropagation — re-render detaches click target).
  Passphrase show/hide eye. Install row in own section.

## v0.3 — Trusted device vault + auto-sync
- IndexedDB vault with NON-EXTRACTABLE AES-GCM device key; passphrase
  sealed to localStorage, opt-in auto-unlock on boot.
- Persistent dirty flag; auto engine: boot reconcile, interval
  pushes, push-on-visibilitychange-hidden. clearDevice vs
  forgetPassphrase split.
- v0.3.1 interval select Off/1/3/5/15. v0.3.2 local plaintext
  export/import. v0.3.3/4 update-detection polish. v0.3.5 update
  broker INLINE in index.html (root-cause fix — a cached shell could
  never deliver its own update). v0.3.6 final cluster (synced
  interval, silent-update welcome toast, single-source version
  stamping).

## v0.4 — Skins & Wallpapers
- 10 Linux skins total; wallpaper system: 10 pure-CSS gradients as
  INLINE STYLES (root-cause fix of #oros-desktop outranking .wp-*),
  full 12-var palettes × dark/light. Defaults (v0.4.3): oros skin +
  sand wallpaper, dark, EN.

## v0.5.0 — First app: To-Do
- Tabbed lists, items with due + notes, quick-add natural date
  parsing (EN/EL with accent-stripping), item-level recurrence +
  list-level cycles, overdue badges, hide/clear-completed, pointer
  drag reorder, undo toast, confirm dialogs.
- registerSlice("todo"); _suppress bridge (pull never re-pushes).
- v0.5.1: 404 fix — <app>/index.html convention locked. v0.5.2: local
  Nunito (5 weights, Greek subset required), ICONS registry, SVG-only
  strategy. v0.5.3: category translation via dynamic keys.

## v0.6.0 — Sync engine: persisted slices + carry-forward
- ROOT CAUSE (To-Do data loss): slice registry in-memory only —
  closed-app pushes omitted app slices AND overwrote the cloud blob.
  registerSlice gains storageKey; boot hydrates proxies for closed
  apps; carry-forward mailbox (a device can never wipe unknown data).
- v0.6.2 cleanup wave: orphaned renderInstallRow SyntaxError +
  renderWallpaperSection self-append HierarchyRequestError (both
  killed the shell entirely). Zero-gate updates (skipWaiting on
  install, broker byte-checks + auto-reload). Dead code purge.
  beforeunload dirty-guard. Icons precache.
- v0.6.3 polish: themed slim scrollbars, menu 320px nowrap, version
  badge next to orOS button, standalone-open guard for __orosSyncApi.

## v0.7.0 — Second app: Kanban (core v0.1)
- One board, columns add/rename/delete+undo, cards quick-add, edit
  dialog, counters, pointer drag within + across columns.
  Threshold-gated drags; touch-action: pan-y. Sync from line one
  (slice "kanban"). Minimal-core rule: everything else parked.
- v0.7.1 Kanban Wave 1 (2026-09-09): subtasks + progress, extra info
  key-value, duplicate card, live-editing dialog. DATA_VER 1→2.
- v0.7.2 Kanban Wave 2 (2026-09-09): board-wide labels (8 swatches),
  live search (text/notes/info/label names), filter popover (OR
  within labels, AND with search), delete-label global cleanup.
  DATA_VER 2→3. Mobile: title hidden <480px, 16px search (no iOS zoom).
- v0.8.0 Kanban Wave 3 + automated cache-busting (2026-09-09):
  column drag reorder (horizontal bias), always-visible rename pencil;
  `?v=` cache-busting Action (stale-asset class of bug now impossible).

## v0.9.0 — To-Do: Kanban-pattern port (2026-09-09)
- Sibling apps share interaction DNA. Ported: labels, filter by label,
  global search (all lists, flattened, source chip), extra info
  key-value, tab drag reorder, tab rename pencil. DATA_VER 1→2
  additive (in load() AND sliceSet). Session-only search/filter.
  Deliberately NOT ported: subtasks (backlog).

## v0.10.0 — Sync Merge Wave (2026-09-09) — SHIPPED & VERIFIED

**Status: verified 2026-09-09** — both devices converge to identical
state; test ritual passed (convergence equality, same-task LWW,
edit-vs-delete resurrection).

**Why:** two devices with the same app open must converge instead of
last-write-wins wiping one side. Aggressive sync schedules (debounce)
are only SAFE on top of merge — this wave built that foundation, then
enabled sync-on-change.

### Core (sync.js v0.7)
- Slice merge API: `registerSlice(..., mergeFn)` — opt-in 5th
  argument; legacy registrations LWW as before.
- Full reconcile (pull → merge → push if dirty) on boot, interval,
  tab-VISIBLE, debounce. Tab-hide stays push-only (zero-loss at
  close). Merge convergence marks dirty → converged state reaches the
  cloud on the next push.
- mergeFn throw degrades slice to LWW — sync never blocks.
- importData passes through merges — an old local backup can no
  longer clobber newer work on merge-capable apps.
- Known limit: closed apps (proxies) have no mergeFn → LWW while
  closed. Documented trade-off.

### Sync-on-change (sync.js v0.7.1)
- markDirty arms a 5s debounce → reconcile("debounce") (FULL
  reconcile, not bare push — pushing stale state wastes round-trips).
  Bursts coalesce into one; no-ops when already clean.
  Why merge-first matters here: with the old overwrite model, faster
  pushes would have meant MORE chances to clobber, not fewer.

### To-Do (v0.4)
- DATA_VER 3 — mtime/om/pos/deleted/sm stamps, additive migration in
  load() AND sliceSet (missing stamps = 0 = oldest → remote wins).
- Tombstones: soft deletes pruned after 30 days; delete beats older
  edits, newer edit resurrects.
- mergeTodoStates: deterministic + symmetric (scalars by sm, content
  by mtime, ties by lexicographic JSON — see v0.10.1 fixes, ordering
  by larger om, unknown entities append). Lists merge structurally —
  header edits never clobber item edits from the other side.
- Undo stampAll() (restored snapshot wins the next merge and
  propagates). List-cycle rollovers stamp. Merge toast only when a
  pull actually changed something.
- Fixes: stray l-cancel listener (broke entire wiring), item delete
  removes locally too, default lists distinct ids.

## v0.10.1 — Merge stabilization + on-open reconcile (2026-09-09)

Found during first live two-device testing (test flow caught them —
this is why the ritual exists).

- **Symmetric tie-breaks (todo.js, 5 patches):** original tie-breaks
  (`(a.x||0) >= (b.x||0) ? a : b`) favored the LOCAL side on equal
  stamps — migrated data has sm/om = 0 on both sides, so both devices
  kept their own state and ping-ponged (felt like "one edit is lost").
  Fixed: scalars tie → lexicographic compare of the scalar pair;
  ordering refs tie → lexicographic compare of id-sequences via
  new pickRef() helper. Now merge(A,B) === merge(B,A) including ties.
  (Lesson 1 — mandatory for the Kanban port.)
- **hide-completed checkbox sync (todo.js):** renderAll() now
  re-syncs the DOM checkbox from state — merges changed the state but
  left the visual stale. (Lesson 2.)
- **Reconcile-on-register (sync.js, registerSlice tail):** opening an
  app now fires reconcile("register") after ~100ms — previously
  opening an app was a silent no-sync event; device B learned remote
  changes only at the next interval tick, which felt like "needs
  refresh". (Lesson 3.)
- **Process lesson (Lesson 4, ritual step 5):** part of the reported
  symptoms during testing were one device serving stale cache-first
  assets — infrastructure was healthy. Always verify BOTH devices run
  the new code (version badge + data ver) before diagnosing merge.

---

## Known TODO / backlog
- **Kanban merge port** (in progress — see CURRENT STATE).
- To-Do subtasks (Kanban port).
- Sandbox attribute for external/untrusted app iframes.
- Windowed mode = future opt-in only.
- Menu badge for open todo count (needs postMessage bridge).
- Extra skins (Nord/Dracula test), About surface (credits + privacy).
- Realtime-sync settings toggle (debounce on/off — default on).

## v0.11.0 — Kanban merge port (2026-09-09)

**Why:** Kanban was the last merge-incapable app — two devices editing
the same board converged by last-write-wins, silently discarding one
side. Ports the verified To-Do v0.4 merge contract so both boards now
converge deterministically instead of racing.

### Kanban (v0.5)
- DATA_VER 3 → 4 additive migration (load() AND sliceSet; missing
  stamps = 0 = oldest → real remote data always wins).
- Stamps: root om = column order; column om = card order within the
  column; card mtime = content INCLUDING column placement —
  cross-column drags touch the card, so moves win merges.
- mergeKanbanStates: cards flattened globally by id, winner side
  dictates placement (ties → lexicographic JSON, symmetric — lesson 1);
  columns merge structurally (header edits never clobber card edits);
  ordering by om with pickRef ties; unknown entities append.
- Orphan rule: a card whose placement column died stays dead —
  cascade tombstones on column delete, no hidden reattachment.
- Delete-label touches every card that wore it (removal is real
  content). Undo = stampAll() including ordering stamps. Duplicate =
  fresh ids + now mtimes. Merge toast; filter popover + badge
  re-synced in renderAll (lesson 2). Subtasks/info stay whole-card
  LWW (per-field merge = backlog, same trade-off as To-Do).
  
  ## v0.11.0 — Kanban merge port + offline sync-loss fix (2026-09-09)

**Why:** Two bugs, one root: (a) Kanban was the last merge-incapable
app — concurrent edits converged LWW, silently discarding one side;
(b) an entry made OFFLINE in a closed app was destroyed by the first
online pull — the mergeless proxy applied the cloud blob wholesale
over localStorage and the follow-up push uploaded the wipe.

### Kanban (v0.5) — merge port
- DATA_VER 3 → 4 additive migration (load() AND sliceSet; missing
  stamps = 0 = oldest → real remote data always wins).
- Stamps: root om = column order; column om = card order; card mtime
  = content INCLUDING placement — cross-column drags touch the card,
  so moves win merges. Symmetric tie-breaks everywhere (lesson 1).
- Orphan rule: cascade tombstones on column delete; a card whose
  placement column died stays dead — no hidden reattachment.
- Delete-label touches every card that wore it. Undo = stampAll()
  including ordering stamps. Merge toast; filter popover re-synced
  in renderAll (lesson 2). Subtasks/info = whole-card LWW (backlog:
  per-field merge).

### sync (v0.8) — divergence guard (offline proxy wipe fix)
- ROOT CAUSE (reported live): an offline edit in a CLOSED app was
  destroyed by the first online pull — mergeless proxy applied the
  remote blob over localStorage, then the follow-up push uploaded
  the wipe. Why it went unnoticed: the global dirty flag existed,
  but the apply path never consulted it.
- Per-slice baselines (oros-sync-baselines): hash of last-synced
  content per slice, recorded on every successful push and clean
  apply. Missing baseline = clean (bootstrap; pre-v0.8 was LWW).
- Guard: a mergeless slice with DIVERGED local (unpushed work)
  never accepts a remote overwrite — remote parks in the carry
  mailbox, local is flagged dirty and pushed as the new truth.
  Unpushed local work is now structurally indestructible.
- Parked remotes flush at live registration: mergeFn unions both
  sides' work; mergeless slices apply parked data only onto an
  empty local (restore case), otherwise drop (by construction
  older than this device's last push).
- collectPayload no longer drops carry entries for known slices.
- "online" event listener: reconcile fires the moment connectivity
  returns (was: interval/tab-visible only).
- ACCEPTED LIMIT: two devices offline-editing the same CLOSED app
  converge when one of them opens it live (merge needs app code);
  nothing unpushed is ever destroyed — the losing side's work
  re-emerges through the parked snapshot at the next live merge.
- Under consideration (backlog): schema-aware generic union for
  mergeless closed apps; zombie slice references after app-close
  noted as accepted.
  
### sync v0.8.1 — divergence guard bootstrap fix
- FAILURE (reported live): the v0.8 guard was BLIND for the exact
  scenario it meant to fix. ROOT CAUSE: bootstrap "missing baseline
  = clean" — the test device had an unpushed edit but no baseline,
  so the guard read "clean" and allowed wholesale LWW. Why: baselines
  accumulate from the FIRST sync, but the dirty flag existed only in
  memory — apply never consulted it.
- FIX: unpushed discriminator is now (dirty flag) OR (baseline
  mismatch). Structural invariant: an armed dirty flag can NEVER
  accept a remote overwrite — regardless of baseline state.
- ACCEPTED: post-patch baseline refresh for previously blind slices
  happens on first clean apply/push.
- RECOVERY: the lost entry was never pushed; Dropbox holds the
  pre-wipe state only if a backup-blob predates the wipe push
  (MAX_BACKUPS=5) — recovery not possible for content that never
  left the device. Accepted lesson: local rescue backups are the
  lifeline for offline sessions.
  
  ## v0.12.0 — Appearance expansion + Auto-backup (2026-09-09)

### Appearance
- 6 new Linux skins (16 total, swatch grid re-flowed to 2×8):
  Manjaro #35bf5c, openSUSE #73ba25, NixOS #5277c3, Gentoo #7d5ba6,
  Pop!_OS #ff7043, Zorin #15a6a0 — full dark+light palettes each.
- 5 new composite CSS wallpapers (15 total, grid now exactly 3 rows
  of 5), each paired to a skin (suggestive, from-default only):
  · Nebula → lumo (deep violet nebula)
  · Nordic Aurora (id: borealis) → manjaro (green aurora glow)
  · Hex Grid → arch (pseudo-crystal repeating-linear lattice)
  · Obsidian Veil → tux (near-black with hidden purple veil)
  · Retro Terrazzo → zorin (multi-color speckles on dark base)
- New skin display names render correctly (Pop!_OS, openSUSE, NixOS).

### Auto-backup (new — sync section, works offline & disconnected)
- Setting: Off (default) / Daily / Weekly / Monthly. Travels in the
  shell slice (autoexport field) like syncInterval — syncs across
  devices, but snapshot storage itself is device-local.
- Check happens at boot (+2s delay) and on every tab-visible event.
  NO background timers.
- On-change-only: full unencrypted DB compared (meta.exportedAt
  stripped) against newest snapshot; unchanged content never
  duplicates an entry.
- Rolling window: last 5 snapshots in localStorage
  ("oros-auto-snapshots"), FIFO, quota-safe (oldest dropped first).
- "Restore last snapshot" button in sync section: replays newest
  snapshot through orosSync.importData (guarded/merge-aware path),
  confirm dialog first, result marked dirty → reaches cloud on next
  push. Disabled (greyed) until a snapshot exists.
- Off = zero footprint going forward; existing snapshots kept.

### Internal
- state.autoexport + AUTOEXPORT_PREF/AUTOEXPORT_LAST/SNAPSHOTS_KEY
  ("oros-autoexport", "oros-autoexport-last", "oros-auto-snapshots").
- initSyncIntegration hooks visibilitychange (visible) → maybeAutoExport.
- i18n: +9 keys per language (sync.autoexport.*, sync.restore,
  sync.restore.confirm, sync.ok.snapshot.saved/restored).

### Under consideration (backlog, not implemented)
- Dedicated history/rewind SVG icon for the Restore button
  (currently EYE_OFF_SVG placeholder).
- Snapshot compression (bodies can be large; 5× full DB in
  localStorage is the practical ceiling).
- sync.js v0.8.1 cleanup re-audit + zombie-slice-registry note
  (deferred to a dedicated non-feature wave, per ritual).