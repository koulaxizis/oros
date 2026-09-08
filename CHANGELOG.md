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
- window.orosActivateUpdate() — SKIP_WAITING via inline broker.
- window.__orosUpdateReady + CustomEvent "oros-update-ready".
- orosSync.registerSlice(name, get, set) — payload:
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
- ForkAwesome vendoring for app icons.
- Windowed mode = future opt-in only.
- Menu badge for open todo count (proposal F — needs postMessage bridge).
- Extra skins (Nord/Dracula test), About surface (credits + privacy),
  sandbox attributes, external/untrusted app isolation.
- GitHub Action: verify first runs green in Actions tab, then forget it.
</arg_value>`
