# orOS Changelog

Static OS shell living in the browser. Hosted at https://useoros.online
(GitHub Pages via custom domain; repo: github.com/koulaxizis/oros).
Single permanent "dev" channel, always stable. Dark theme default with
light toggle in Appearance. EN default, EL secondary. 24h clock.
Privacy-first: no cookies, no tracking, no ads. MIT.

---

## RELEASE RITUAL (locked)

1. Change whatever (shell.js, sync.js, translations.js, style.css, apps/…).
2. Bump `APP_VERSION = "X.Y.Z"` in shell.js — the SINGLE release key.
3. GitHub Action (.github/workflows/bump-version.yml) auto-stamps
   sw.js CACHE_VERSION="oros-v<X.Y.Z>" and manifest "version" on push
   to main (fails loudly if lines missing; idempotent otherwise).
   If Action not yet active: bump CACHE_VERSION manually, same number.
4. CHANGELOG entry per change (English, "why" included).

LESSON (never repeat): deploys that change assets without a version
bump silently strand mobile on stale cache-first assets. Desktop looks
fine only because hard refreshes bypass the SW.

---

## REFERENCE REGISTRIES (kept current — read this first in a new chat)

### File tree (repo root)
- index.html — markup + INLINE update broker script (must stay inline!)
- style.css — shell styling (sections 1-10: skins, reset, bar, desktop,
  menu, running, appearance, wallpaper picker, sync, toasts)
- shell.js — shell logic, sections 1-12, APP_VERSION constant on top
- translations.js — OROS_TRANSLATIONS (EN/EL) + window.t() fallback
  chain (active → en → key)
- sync.js — window.orosSync (loaded BEFORE shell.js)
- apps.json — installed apps registry
- sw.js — CACHE_VERSION bump per deploy
- manifest.webmanifest
- icon.svg + icons/ (4 PNGs: any+maskable 192/512, maskable scale 62%)
- todo/ — first internal app (todo.html, todo.css, todo.js)
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
- oros-todo-data                — To-Do app data (synced via "todo" slice)

### Locked API surfaces
- window.t(key) — i18n, fallback chain active → en → key.
- window.orosSync: connect/disconnect/isConnected/getUserInfo/pull/push/
  setPassphrase(pw, remember)/hasPassphrase/forgetPassphrase/clearDevice/
  hasDeviceVault/registerSlice/markDirty/isDirty/getIntervalMinutes/
  setIntervalMinutes/onAutoSync/kickAutoEngine/vaultUnlocked/
  redirectHandled/errorKey/exportData/importData.
- (deprecated in v0.6.2) orosActivateUpdate / __orosUpdateReady / oros-update-ready — removed).
- orosSync.registerSlice(name, get, set, storageKey?) — payload:
  { shell: {...}, apps: { <name>: ... }, meta }. Manual Export/Import
  includes ALL registered slices automatically.
- App convention: same-origin iframe; app reads oros-lang from shared
  localStorage; inherits shell palette via computed vars + MutationObserver
  on parent data-skin/data-theme; sync via parent.orosSync.registerSlice.
- Sync-loop rule: pull-fed setters NEVER markDirty. User-action
  handlers DO (noteLocalChange() / __orosSyncApi.dirty()).

### Registries (shell.js)
- SKINS (10): adwaita #3584e4 (GNOME default look), lumo #6d4aff,
  oros #d4af37/#b8860b (BRAND DEFAULT), ubuntu #e95420, fedora #51a2da,
  mint #87cf3e, arch #1793d1, debian #d70a53, elementary #8c5ec7,
  tux #c9c9c9. All ship full 12-var palettes × dark/light in style.css.
- WALLPAPERS (10, JS registry — gradients as inline styles, thumbs and
  desktop from the same string): dusk, midnight(pair:arch), plum(ubuntu),
  forest(mint), ember(debian), nordic(fedora), aurora(elementary),
  sand(pair:oros), mono(pair:tux), clear(none). DEFAULT_WALLPAPER="sand".
- Defaults (v0.4.3): skin oros, wallpaper sand, theme dark, lang en.
- Pair suggestion fires ONLY when user is on the default wallpaper and
  ONLY on user skin clicks — never on pulls.

---

## v0 — Core shell
- GNOME-style persistent top bar (40px): menu left; lang + clock right
  (theme toggle lives in Appearance section). Bar visible in all views.
- Fullscreen app takeover (iframe) below the bar; Esc or menu button
  returns to desktop. External apps (type: "external") open a new tab.
- apps.json fetch with graceful fallback to empty state; schema:
  id, name, category, icon, url, type ("internal"|"external").
- Dark default + light toggle (Appearance). 24h clock, comma stripped.
- translations.js: OROS_TRANSLATIONS (EN/EL) + t() fallback chain.
- Footer credits removed (future "About" surface).
- Post-v0 polish: clock comma strip, SVG glyph for empty state, skin.title
  key, EN/EL short lang codes, theme toggle moved into menu Appearance
  section (moon/sun inline SVGs; taskbar right = lang + clock only),
  tofu-prone unicode icons replaced with inline SVGs (grid, moon, sun),
  desktop footer removed.

## v0.1 — Offline-first + mobile + install
- sw.js: precache shell, network-first navigations, cache-first assets,
  runtime cache for future apps. manifest.webmanifest: standalone,
  brand mountain icons any+maskable 192/512.
- PWA metas in index.html (viewport-fit=cover, iOS standalone, noscript).
- style.css: mobile-first pass — 100dvh, safe-area insets, 44px touch
  targets, full-width menu sheet ≤480px, -webkit-backdrop-filter.
- Install flow: beforeinstallprompt captured with preventDefault +
  EXPLICIT prompt() on our own Install button (never silent banners).
- Manifest icon purposes un-swapped (any/maskable were inverted);
  maskable inner scale 78% → 70% → 62% (Android safe zone circle).

## v0.2 — Dropbox sync
- sync.js: window.orosSync — PKCE OAuth (S256), refresh with 5-min
  early renewal, app-folder blob /orOS-data.json, AES-GCM + PBKDF2
  (100k) encryption, versioned blob (ver: 1), slice architecture
  (registerSlice; payload { shell, apps: {...}, meta }), push with
  automatic remote backup (max 5), pull/apply, ?code= redirect handled,
  errorKey() → sync.err.* i18n keys. Redirect URI must match exactly
  incl. trailing "/" (learned the hard way).
- Boot dependency order: translations → sync → shell.
- style.css section 9 (sync UI). shell.js renderSyncSection: three
  states (connect / unlock / unlocked actions), status dot + email,
  messages survive re-renders.

## v0.2.1 — User-controlled updates
- sw.js: no skipWaiting on install; "SKIP_WAITING" message channel.
- shell.js: update detection + floating toast; tap → SKIP_WAITING.
- translations.js: update.available, update.reload.

### v0.2.2 — UX fixes
- Menu stays open on internal clicks (stopPropagation on #app-menu;
  root cause: re-render detaches click target → containment check
  misfires).
- Passphrase show/hide eye (direct input mutation, no re-render).
- Install row in its own accent-bordered section.

## v0.3 — Trusted device vault + auto-sync
- sync.js: IndexedDB vault with NON-EXTRACTABLE AES-GCM device key;
  passphrase sealed to localStorage, opt-in auto-unlock on boot.
- Persistent dirty flag; auto engine: boot reconcile (pull → push-if-
  dirty), interval pushes, push-on-visibilitychange-hidden. Online gate,
  pushInFlight guard. onAutoSync() subscription.
- shell.js: remember checkbox (pre-checked if vault exists), kickAutoEngine
  after unlock; visible unlock flow: pull → (push if dirty). Dot pulse
  feedback. clearDevice vs forgetPassphrase split (device-aware labels).

### v0.3.1 — Sync refinements
- Interval select Off/1/3/5/15 (applied immediately, never silent-kick).
- Menu: "Update orOS" replaces "Install orOS" while a version waits.

### v0.3.2 — Local backup (export/import)
- sync.js exportData/importData: full plaintext payload, offline, no
  passphrase; import marks dirty. Download: orOS-backup-YYYY-MM-DD.json.

### v0.3.3/0.3.4 — Update detection + toast polish
- watchWorker() covers already-installing workers (boot race); update()
  at boot + hourly; 500ms grace, 0.35s fade, toastQueued dedupe.

### v0.3.5 — Update broker (ROOT-CAUSE fix for cached shells)
- Update machinery moved INLINE into index.html (network-first HTML =
  always fresh) — a cached shell could never deliver its own update
  (chicken-and-egg). Broker owns full lifecycle; shell.js mirrors via
  oros-update-ready event / __orosUpdateReady flag.

### v0.3.6 — Final cluster (4 entries merged)
- **Synced auto-sync interval:** part of shell slice (syncInterval
  field); pull-fed via setIntervalMinutes (no dirty mark); local changes
  mark dirty. Backward-compatible.
- **Silent-update welcome toast:** APP_VERSION + checkVersionToast();
  bottom-center "updated to vX" auto-dismiss 4s; first visit silent;
  device-local (oros-last-version).
- **Stale asset hotfix:** see ritual above (root cause of mobile
  strandedness).
- **Tooling:** GitHub Action single-source stamping (APP_VERSION →
  sw.js CACHE_VERSION + manifest version). Idempotent, fails loudly.

## v0.4 — Skins & Wallpapers
- v0.4.0: +7 Linux skins (Ubuntu/Fedora/Mint/Arch/Debian/elementary/Tux,
  total 10). Wallpaper system: 10 pure-CSS gradients, zero images;
  WYSIWYG picker in new Wallpaper menu section; choice synced via shell
  slice; pair suggestion only from default wallpaper.
- v0.4.1: ROOT CAUSE (wallpapers never applied): #oros-desktop ID
  selector outranked .wp-* classes → gradients moved to shell registry
  as INLINE STYLES (thumbs + desktop from same string). Swatches 2×5
  grid. Taskbar label "Applications" → "orOS".
- v0.4.2: full 12-var palettes (dark+light) for the 7 new skins —
  they previously shipped accent-only vars and fell back to defaults.
  Dead .wp-* CSS removed. Light accents darkened for contrast.
- v0.4.3: defaults = oros skin + Desert Sand wallpaper; index.html
  pre-JS data-skin updated; EN confirmed default.

## v0.5.0 — First app: To-Do (current)
- apps.json first entry (To-Do, Productivity, url "todo/", internal).
- todo/ app: tabbed lists (rename via dblclick or ⋮; add/delete lists),
  items with due date + notes; quick-add with natural date parsing
  ("tomorrow"/"friday", Greek words with accent-stripping: "αύριο",
  "παρασκευή"); item-level recurrence (checking re-opens with NEXT
  occurrence anchored to now; weekly honors weekday anchor) + list-level
  cycles (auto-clear all checks on cycle end; fast-forwards missed
  cycles at boot); overdue badge chips in tabs; hide-completed toggle;
  clear-completed; pointer-based drag reorder (touch-action: none on
  handle only); undo toast (5s snapshot) for deletes/clears/list del;
  confirm dialogs before deletes.
- Sync: registerSlice("todo") → travels in Dropbox blob AND manual
  Export/Import; sliceSet suppresses dirty-marking (_suppress bridge
  on window.__orosSyncApi) → pull never re-pushes (loop-proof).
- Live palette + language inheritance from shell (shared oros-lang +
  MutationObserver on data-skin/data-theme of parent <html>).
- NOTE: two STRINGS keys must exist in app STRINGS (both langs):
  "recur.list.next" ("Next reset:" / "Επόμενο reset:") and
  "drag.reorder" ("Reorder"/"Αναδιάταξη").
- Architecture: app i18n is INLINE per app (self-containment over DRY;
  ~10 shared words duplicated; revisit fallback window.parent.t only
  if maintenance pain grows).
  
### v0.5.1 — To-Do 404 fix
- ROOT CAUSE: app entry points to "todo/" but the folder had
  todo/todo.html — directory URLs serve index.html, hence 404.
  Renamed todo/todo.html → todo/index.html (todo.css/js unchanged).
- Locked convention for all future apps: <app>/index.html as entry,
  referenced in apps.json as "<app>/".
  
### v0.5.2 — Typography + app icons
- Typography: local Nunito (5 weights: regular/medium/semibold/bold/
  extrabold) vendored at fonts/, @font-face in style.css, Nunito-first
  stack everywhere (shell + To-Do). Zero external requests — fully
  offline. Existing font-weight usages map to real weights now.
- ForkAwesome PERMANENTLY rejected from roadmap — SVG-only icon
  strategy. ICONS registry in shell.js; app entries render icon
  (accent-colored) + name; apps.json "icon" key is now live.
- To-Do menu entry: check SVG icon. sw.js precaches todo/ + fonts.
- bump-version.yml paths now cover todo/** and fonts/**.
- REMINDER: woff2 files must include the Greek subset (mixed-font
  fallback on Greek text otherwise).
- Taskbar menu label "orOS" set to Nunito ExtraBold (800) with
  letter-spacing — brand-forward button.
  
### v0.5.3 — Category translation
- App categories (from apps.json data) are now translated via
  dynamic keys (category.<name-lowercase>, EN/EL), with graceful
  fallback to capitalized raw value for unknown future categories.
- translations.js: category.productivity (EN/EL).

---

## Known TODO / backlog
- Sandbox attribute for external/untrusted app iframes (revisit).
- Windowed mode = future opt-in only.
- Menu badge for open todo count (proposal F — needs postMessage bridge).
- Extra skins (Nord/Dracula test), About surface (credits + privacy),
  sandbox attributes, external/untrusted app isolation.
- GitHub Action: verify first runs green in Actions tab, then forget it.

## v0.6.0 — Sync engine: persisted slices + carry-forward
- ROOT CAUSE (To-Do data not syncing via Dropbox while export
  worked): slice registry was in-memory only — app slices existed
  solely while the app was open; pushes from closed-app sessions
  omitted them AND silently overwrote the cloud blob (data loss).
- registerSlice gains optional 4th arg storageKey; registrations
  persist to localStorage (oros-slices). Boot hydrates lightweight
  proxies for closed apps (direct localStorage get/set) — app
  slices now sync in every push/pull, open or closed.
- Carry-forward mailbox (oros-remote-carry): remote slices unknown
  on a device are relayed forward untouched on next push — a
  device can never wipe app data it doesn't know. Flush into the
  app's storage on first live registration.
- Recovery note: remote orOS-backup-*.json files in the Dropbox
  app folder may hold the latest todo-inclusive payload.
- todo.js: registerSlice call now passes "oros-todo-data".

## v0.6.2 — Cleanup wave: zero-gate updates + syntax repairs

- FIX (critical): renderInstallRow was orphaned — its header was
  deleted but the body remained at top level, referencing deleted
  globals (swUpdateReady, orosActivateUpdate) → SyntaxError killed
  the ENTIRE shell.js. Fully rebuilt (install-only; the update flow
  is now owned by the inline broker in index.html).
- FIX (critical): renderWallpaperSection self-appended the section
  node via a dead ternary → HierarchyRequestError on every
  renderMenu() (menu empty, clock frozen, sync UI dead).
- Zero-gate updates: sw.js calls skipWaiting() on install; the broker
  forces a byte-check on every load + hourly, and auto-reloads on
  controllerchange. Version toast in shell.js is the sole update
  confirmation. Why: v0.6.0 worker sat installed-waiting while v0.5.0
  caches served — the user gate was the culprit, now retired.
- Dead code purge across the stack: SKIP_WAITING message listener
  + stale header comment (sw.js), #update-toast +
  .install-row.update (style.css), PHOTO_ICON_SVG (shell.js),
  NodeList forEach hack (todo.js), update.available/reload/action +
  app.name/tagline, wallpaper.current, sync.ok.unlocked
  (translations.js).
- Manifest: "version" key added (Action stamped it silently before —
  now greps succeed loudly).
- To-Do fixes: "Γénéral"→"Γενικά", "Για ψώνια"→"Ψώνια", dead ternary
  in recycleItem cleaned, "⟳" glyph → inline SVG repeat icon.
- todo.css: #quick-add base styling (42px, panel bg, border).
- style.css: #btn-menu ExtraBold (800) restored.
- Desktop beforeunload dirty-guard (sync-pending warning).
- sw.js: icon.svg + 4 PNGs added to precache (fully offline PWA).

## v0.6.3 — Polish wave: scrollbars, menu width, version badge
- Themed slim scrollbars for menu + desktop (scrollbar-width/thin,
  webkit 8px, thumb = --border): the browser default ate ~15px of
  menu width and clashed with every non-default skin.
- Menu width 300px → 320px and menu-item labels now
  nowrap+ellipsis: Greek sync-button labels ("Λήψη από το cloud")
  were wrapping to a second line with the narrowed menu.
- Version badge next to the orOS button ("v0.6.3" pill, reads
  APP_VERSION — the single release key): permanent visual
  confirmation of the running version on every device, one glance
  instead of hunting for the toast. Why: mobile PWA update
  verification was our recurring blind spot.
- To-Do standalone-open guard: __orosSyncApi bridge is now created
  unconditionally in registerSync() — opening todo/index.html
  directly (no shell/sync.js) no longer TypeErrors in the list
  dialog's recycler. Inside the shell behaviour is identical.
- CHANGELOG registries scrubbed: removed the dead
  orosActivateUpdate/__orosUpdateReady API entries (retired in
  v0.6.2), storageKey added to the registerSlice signature,
  ForkAwesome backlog line deleted (permanently rejected in v0.5.2).
  Why: the reference registries are read-first in a new chat —
  stale entries there seed wrong assumptions.
  
## v0.7.0 — Second app: Kanban
- New app: kanban/ (core v0.1) — one board, columns with
  add/rename(dblclick)/delete(confirm)+undo, cards with quick-add
  per column (Enter + mouse-friendly + button), edit dialog
  (text + notes), card counters, pointer-based drag & drop within
  and ACROSS columns. EN/EL inline, oros-skin fallback palette,
  live palette/lang inheritance from the shell.
- Drag UX: threshold-gated (plain taps stay clicks → dialogs work),
  cards use touch-action: pan-y — vertical touch scroll passes
  through, horizontal touch moves become card drags.
- Sync from line one: registerSlice("kanban", …, "oros-kanban-data")
  + unconditional __orosSyncApi bridge (standalone-open safe);
  travels in Dropbox blob (open or closed app) and Export/Import.
- apps.json +2nd entry (Productivity); shell ICONS +"columns" SVG.
- sw.js precaches kanban/ (fully offline PWA).
- Why this shape: minimal-core rule — everything not essential
  (multi-board, labels, due dates, WIP limits, filters) parked
  until real usage demands it.
  
## v0.7.1 — Kanban Wave 1 (card content) — 2026-09-09

**Why:** Enrich cards so a board can carry real work, not just one line of text —
keeping the single-file, single-slice, offline-first architecture intact.

- **Subtasks** (#10 from legacy-feature audit): checkbox checklist inside the
  card dialog (add via input + button, editable text, per-item delete). Cards
  show a slim progress indicator (x/y + bar). WHY: subtasks turn a board into
  real project tracking without introducing labels/priorities yet.
- **Extra info fields** (#11, adapted): free custom key-value fields per card
  ("Deadline: 21/09", "Budget: 300€"). Shown dimly on the card face and indexed
  in future search/filter waves. Renamed from legacy "Assignments" because the
  key-value form is more general and fits the orOS minimalism better.
- **Duplicate card** (#13): clones a card (deep-clones subtasks/info, "(copy)"
  suffix) right after the original in the same column. WHY: one-tap template
  creation for repetitive work.
- Schema: `DATA_VER` 1 → **2**. Cards gain `subtasks: [{id, text, completed}]`
  and `info: [{id, label, value}]`. One-shot migration on load (missing fields
  initialized empty); legacy v1 data migrates in place with zero data loss.
  WHY: additive-only migration keeps Dropbox slices, old backups, and manual
  exports all forward-compatible.
- Card dialog is now **live-editing**: all changes persist instantly
  (autosave-on-change, matching the rest of orOS) — Save simply closes.
- i18n: all new strings inline EN/EL incl. `data-i18n-placeholder` support.

**Under consideration (backlog, no conflicts with orOS):**
multi-board (#1–5), priority levels (#6), due dates (#7), card colors (#8),
markdown preview (#12), created/modified timestamps (#14), archive (#17),
statistics (#18), CSV export (#19), add-column dashed placeholder (#23),
print styles (#34).

**Deferred by design (conflicts with orOS philosophy):**
UI-visibility toggles, Fork Awesome, `prompt()`-based CRUD, in-app theme toggle,
local File System Access sync — permanently out.

## v0.7.2 — Kanban Wave 2 (labels, search, filter) — 2026-09-09

**Why:** Boards grow past what one screen can hold — labels give cards a
second organizational axis, and search/filter let a growing board stay
usable. Both respect the offline-first, single-slice, zero-dependency rules.

- **Labels** (#9 from legacy-feature audit, minimal form): board-wide label
  store (`state.labels`, 8-color swatch palette, accent default). Managed
  entirely from the card dialog — attach/detach chips (click chip = detach),
  toggle picker, inline creation with color pick. No separate management
  modal, no `prompt()` dialogs. WHY: labels + filters were useless apart;
  together they unlock organized boards with one shared store.
- **Board search** (#15): live search in the board bar over card text,
  notes, extra-info labels AND values, and attached label names (per the
  feature-11 contract). Debounce-free: render is already requestAnimationFrame-
  batched, so typing is smooth even on large boards.
- **Filter by label** (#16): popover with checkboxes + color dots, count
  badge on the button, delete-label inline (with confirm + global cleanup
  from all cards and active filters — no orphan ids). OR within selected
  labels, AND with search. Column counters show VISIBLE cards.
- Schema: `DATA_VER` 2 → **3** (additive: `state.labels[]` + `card.labels[]`),
  same one-shot migration in `load()` AND `sliceSet` — old slices and
  backups migrate in place with zero data loss.
- Duplicate card now copies labels too (by reference id, shared store).
- Mobile (<480px): board title hidden to make room for search + filter;
  search input at 16px (no iOS focus-zoom).

**Under consideration (backlog, no conflicts with orOS):**
multi-board (#1–5), priority levels (#6), due dates (#7), card colors (#8),
markdown preview (#12), created/modified timestamps (#14), archive (#17),
statistics (#18), CSV export (#19), add-column dashed placeholder (#23),
print styles (#34).

**Deferred by design (conflicts with orOS philosophy):**
UI-visibility toggles, Fork Awesome, `prompt()`-based CRUD, in-app theme
toggle, local File System Access sync — permanently out.

## v0.8.0 — Kanban Wave 3 (column reorder + rename) & automated cache-busting — 2026-09-09

**Why:** Boards are personal — column order is workflow order. Wave 3 closes
the last two structural gaps (21, 22) from the legacy-feature audit, and the
repo now stamps asset URLs automatically so stale-cache deployments are
structurally impossible going forward.

- **Column drag reorder** (#21): pointer-based, threshold-gated drag on the
  column head (grab cursor). Insertion indicators show LEFT/RIGHT of the
  hovered target (half-column precision). Horizontal-bias detection keeps
  vertical gestures (scroll) native; single taps never start a drag, so
  dblclick-rename and the pencil keep working. Pencil button excluded from
  the drag handle (`closest('.col-rename')` guard). Same elementFromPoint +
  pointer-events-off trick as card drag — proven pattern, zero HTML5 DnD.
  WHY pointer-based: HTML5 dragstart is dead on touch; we already solved
  that for cards in v0.2 and reused the contract verbatim.
- **Column rename button** (#22): always-visible pencil in the column head
  (same dialog as dblclick — dblclick kept as power-user shortcut). WHY:
  dblclick alone was undiscoverable on mobile, where there is no hover hint.
- **Automated `?v=` cache-busting**: new GitHub Action step reads
  APP_VERSION from shell.js (single source of truth) and stamps/refreshes
  `?v=` on every relative .css/.js reference in the root index.html and all
  app folder index.html files. Replaces existing ?v= (no double suffixes);
  absolute URLs and sw.js registration untouched. WHY: v0.7.2 shipped
  stale assets (old CSS/JS served cache-first while index.html was fresh),
  which surfaced as raw i18n keys and dead buttons — this class of bug is
  now structurally impossible.

**Under consideration (backlog, no conflicts with orOS):**
multi-board (#1–5), priority levels (#6), due dates (#7), card colors (#8),
markdown preview (#12), created/modified timestamps (#14), archive (#17),
statistics (#18), CSV export (#19), add-column dashed placeholder (#23),
print styles (#34).

**Deferred by design (conflicts with orOS philosophy):**
UI-visibility toggles, Fork Awesome, `prompt()`-based CRUD, in-app theme
toggle, local File System Access sync — permanently out.

## v0.9.0 — To-Do: Kanban-pattern port

### Why
To-Do and Kanban are sibling apps in the orOS core — they must share
the same interaction DNA (GNOME-style app family). This wave ports the
six Kanban features the user approved, adapting them to To-Do's
list-centric model instead of blind copy-paste.

### Ported (Kanban feature # → To-Do equivalent)
1. **Labels** — board-wide `state.labels[]` store + `item.labels[]` ids,
   8-color swatch palette, managed from the item dialog (chips to
   detach, picker to attach, inline create with color pick).
   NOTE: labels are stored per app (not shared with Kanban) by design.
2. **Filter by label** — funnel-button popover in #controls with
   checkboxes, color dots, count badge. OR within selected labels,
   AND with the search box.
3. **Global search** — searches across ALL lists, flattened results
   with a source-list chip per row. Covers text, notes, extra info
   fields, and label names (agreed rule: custom fields participate
   in search everywhere).
4. **Extra info** — free key-value rows per task, no predefined keys
   (matching Kanban), `label: value · …` dim preview line, searched +
   draggable-included data synced via the existing slice.
5. **Tab drag reorder** — pointer-based, threshold-gated with
   horizontal bias (vertical gesture stays native scroll), left/right
   insertion indicators, pencil excluded from the gesture.
6. **Tab rename pencil** — per-tab pencil opening the same dialog as
   dblclick; hover-reveal on desktop, always visible on touch.

### Data
- DATA_VER 1 → 2, additive migration (`state.labels`, `item.labels`,
  `item.info`) applied in BOTH `load()` and `sliceSet` — older v1
  data upgrades in place with zero loss; search/filter state stays
  session-only (sync pulls must not resurrect a stale view).
- Sync slice name (`todo`) and STORAGE_KEY unchanged → existing
  Dropbox blobs migrate transparently.

### Deliberately NOT ported
- Card recurrences existed here already (kept To-Do's richer engine).
- Subtasks — logged as "under consideration" for a future wave.

### Why not
- No changes to shell contracts: filenames, slice name, storage key,
  sync bridge all identical; the `?v=` cache-bust Action covers the
  stamped assets automatically on the next version bump.
  
  ## [0.10.0] — Sync Merge Wave

Cross-device merging for orOS. Two devices with the same app open
simultaneously now converge instead of last-write-wins wiping one side.

  - Sync-on-change: edits trigger a debounced full reconcile (~5s
  after the last edit) in addition to interval/visible/hide triggers.
  Bursts coalesce into one round-trip; no-ops when already clean.

### Core (sync.js v0.7)

- **Slice merge API**: `registerSlice(name, get, set, storageKey, mergeFn)`
  — opt-in 5th argument. Apps with multi-entity data (To-Do, Kanban)
  supply a merge function so concurrent edits converge deterministically.
  Legacy 4-arg registrations behave exactly as before (LWW).
- **Full reconcile** (`pull → merge → push if dirty`) on: boot, periodic
  interval, and tab becoming VISIBLE (returning to a device catches up
  immediately). Tab-hide remains push-only (zero-loss guarantee at close,
  no pull round-trips while the tab may be dying).
- Merge convergence marks dirty → the converged state reaches the cloud
  on the very next push. Both devices compute the identical result
  (deterministic merge), stopping the classic two-devices ping-pong.
- A thrown error inside a mergeFn degrades that slice to LWW — a bad
  merge can never block syncing.
- Database import now passes through slice merges where available: an
  old local backup can no longer clobber newer cloud-side work on
  merge-capable apps.
- Known limit: hydrated proxies (app closed) have no mergeFn (app code
  cannot run) — closed apps sync LWW, merge resumes when the app opens.
  Documented trade-off; merge lives exactly where the two-open-devices
  scenario lives.

### To-Do (v0.4)

- **DATA_VER 3** — additive migration, older local data upgrades in
  place (missing stamps default to 0 = oldest, so real remote data wins).
- Every entity (list / task / label) carries `mtime` (content version);
  orderings carry `om`/`pos`. Every mutation stamps.
- **Tombstones**: deletions are soft (`state.deleted = {id: ts}`),
  pruned after 30 days. Deletion beats older edits; an edit newer than
  its tombstone resurrects the entity (edit-after-delete works).
- `mergeTodoStates`: deterministic + symmetric —
  scalars by root `sm`; entity content by larger mtime (tie →
  lexicographic JSON, decided identically on both sides); ordering by
  the side with the larger `om`; unknown entities append at the end.
- Lists merge structurally: headers LWW by mtime, but each list's items
  merge independently — renaming a list on one device never clobbers
  task edits made on the other.
- Undo asserts the whole restored snapshot as newest (stamp-all) —
  undo wins the next merge and propagates.
- List-cycle rollovers stamp fresh mtimes — both devices agree the
  cycle happened instead of re-fighting it.
- Search/filter remain session-only view state (never persisted, never
  resurrected by a pull from another device).
- Merge toast: "Synced changes from another device" appears when a
  pull actually changed something (silent otherwise).

### Fixes

- To-Do: stray `l-cancel` listener removed (missing element broke
  entire wiring on load).
- To-Do: item delete now removes the item locally as well as the
  tombstone (was visible until the next pull).
- To-Do: default lists get distinct ids/objects (shared-object bug).

### Under consideration

- Port the merge pattern to Kanban (same slice contract, tombstones
  for cards/columns/labels).
- Per-field merge granularity for task text (currently whole-task LWW
  by mtime) — likely unnecessary, revisit only if real conflicts bite.
- Merge-capable closed apps would require merge functions stored as
  data — deferred deliberately.
  
