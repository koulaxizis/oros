# orOS Changelog

Static OS shell living in the browser. Hosted at https://useoros.com
Repo: github.com/koulaxizis/oros — single "dev" channel, kept always stable.
Dark theme default, light toggle. EN default, EL secondary. 24h clock.

## v0 — Core shell (current)

### Architecture decisions (locked)
- GNOME-style persistent top bar (menu button left, lang/theme toggles + clock right).
  Bar stays visible in ALL views, including running apps (~40px).
- Apps open via fullscreen takeover (iframe) below the bar — no windows in v0.
  Esc or menu button returns to desktop. Windowed mode = possible future opt-in only.
- External apps (type: "external") open in a new browser tab, not takeover.
- Installed apps declared in `apps.json` (fetch at runtime). Install = one JSON entry.
  Schema: id, name, category, icon, url, type ("internal"|"external").
  Graceful fallback: failed fetch → empty state, never a crash.
- Storage: localStorage only (`oros-lang`, `oros-theme`, `oros-skin`). Sync/PWA = future.
- Single channel workflow: one permanent "dev" branch kept stable. No beta repo yet.

### Files
- `index.html` — markup only. data-theme="dark" + data-skin="adwaita" on <html>.
- `style.css` — all styling. Sections 1–6 + 5bis (skin picker).
- `shell.js` — all shell logic. SKINS registry: add skin = 1 JS entry + 1 CSS palette.
- `translations.js` — OROS_TRANSLATIONS (EN/EL) + t() with fallback chain (active → en → key).
- `apps.json` — empty apps array. Shows "No applications installed" empty state.

### Skins system (added in v0)
- Two orthogonal axes: data-skin (palette) × data-theme (dark/light).
- Palettes: `adwaita` (GNOME blue, DEFAULT), `lumo` (house purple #6d4aff),
  `oros` (brand gold #d4af37 dark / #b8860b light, warm cream light bg).
- Skin picker: round swatches at bottom of app menu. localStorage `oros-skin`,
  URL param `?skin=` (same pattern as `?lang=`). Invalid values → adwaita fallback.
- New accent var: `--accent-soft` for hovers (was hardcoded purple rgba).
- Taskbar shadow added: `box-shadow: 0 2px 8px var(--shadow)` — separates bar from body.

### Removed
- Desktop footer with credits (designedBy / noCookies keys removed from both languages).
  Credits will move to a future "About" surface.

### Known TODO (next steps)
- `sw.js` + web manifest for offline PWA installability.
- ForkAwesome local vendoring for app icons.
- First real app installed in apps.json.
- Icon glyphs currently unicode (⊞, ◐) — will become ForkAwesome icons.
- App iframe has no sandbox attribute (intentional: internal apps need full
  localStorage). Revisit when external/untrusted apps are iframed.
  
  ### Fixes & polish (post-v0)
- Removed comma artifact in English clock/date (locale-safe strip).
- Replaced tofu-prone "□" empty-state glyph with inline SVG app-grid icon.
- Added missing `skin.title` translation (Appearance / Εμφάνιση);
  removed footer i18n keys (footer was deleted).
- Language button now shows "EN"/"EL" short code instead of full words.
- Moved dark/light theme toggle from top bar into the app menu:
  Appearance section now holds swatches + vertical divider + theme toggle.
  Top bar right side = language + clock only.
- applyTheme() simplified; theme button is rebuilt on each renderMenu().
  Old #btn-theme wiring REMOVED (would throw on boot if left in).
- Theme toggle icons (☾/☀) rendered as dots/tofu on some platforms;
  replaced with inline SVG moon/sun using currentColor.
- Swatch CSS rules (.skin-swatch) were accidentally dropped during the
  Appearance-section restructure — swatches rendered as dots. Restored
  (26px circles + padding:0 + flex-shrink:0).
- Skin swatch circles reduced from 26px to 18px to visually match
  the theme toggle icon size.
- PWA icon = existing brand logo (gold mountain, #c8a96e on #1b1a18). Kept as-is.
- Browser-based offline icon generator provided (4 PNGs: any/maskable × 192/512,
  maskable with 78% safe zone). manifest theme_color aligned to #1b1a18.
- index.html: PWA meta (manifest link, theme-color, apple-touch-icon,
  iOS standalone tags, black-translucent status bar, viewport-fit=cover,
  noscript fallback). data-skin="adwaita" default on <html> pre-JS.
- style.css: mobile-first + PWA safe-area pass. 100dvh shell height,
  env(safe-area-inset-*) on top bar / running view / menu max-height,
  -webkit-backdrop-filter for iOS, tap-highlight removed, touch-action
  optimizations, 44px min touch targets on menu items, full-width menu
  sheet ≤480px, landscape-notch handling. All skin palettes intact.
  
  ## v0.1 — Offline-first + mobile + install (current)

- sw.js: precache shell, network-first navigations (updates reach users),
  cache-first assets, runtime cache for future internal apps (survives
  shell updates). Update release = bump CACHE_VERSION.
- manifest.webmanifest: standalone, theme/background #1b1a18/#131820,
  icons any+maskable 192/512 (brand mountain logo kept as-is).
- index.html: PWA meta, viewport-fit=cover, apple-touch-icon,
  iOS standalone tags, noscript fallback, data-skin default on <html>.
- style.css: mobile-first — 100dvh, safe-area insets everywhere,
  44px touch targets, full-width menu sheet ≤480px, landscape notch
  handling, -webkit-backdrop-filter, tap-highlight/touch-action fixes.
- shell.js: SW registration (fail-safe), beforeinstallprompt captured
  with preventDefault + EXPLICIT prompt() on our own Install button in
  the menu (never silent banners), appinstalled cleanup, install row
  with SVG download icon. Clock comma fix, EN/EL lang button, SVG icons
  throughout (moon/sun/grid). Install row highlighted via --accent.
- New i18n key: install.trigger (EN/EL).
- Repo now: index.html, style.css, shell.js, translations.js, apps.json,
  sw.js, manifest.webmanifest, icon.svg, icons/ (4 PNGs).
- Fixed swapped icon purposes in manifest: icon-192/512.png now "any",
  icon-maskable-192/512.png now "maskable" (was inverted — Android picked
  the full-bleed icon for circular masking, cropping the logo).
- Maskable icons regenerated at 70% inner scale (was 78%) —
  adaptive-icon safe zone is a 61% circle; mountain corners were
  grazing the mask boundary. Any-purpose icons unchanged.
- Maskable inner scale tightened 70% → 62% (Android safe zone is a
  66/108 circle; base corners sat at ~99% radius, diagonally clipped
  on circular launchers). Now fully safe on all mask shapes.
  
  ## v0.2 — Dropbox sync (core module, part 1 of 4)

- sync.js: window.orosSync — shared sync framework.
  - PKCE OAuth (S256, no client secret), token_access_type=offline,
    refresh flow with 5-min early renewal, tokens in localStorage.
  - App-folder scoped: blob at /orOS-data.json inside /Apps/orOS/.
  - AES-GCM + PBKDF2 (100k rounds) client-side encryption;
    passphrase memory-only, never persisted. Blob versioned (ver: 1).
  - Slice architecture: registerSlice(name, get, set) — shell registers
    "shell", future apps register their own. Payload:
    { shell, apps: { <name>: ... }, meta }.
  - push(): backup remote (copy_v2) -> upload; keeps last 5 backups.
  - pull(): download -> decrypt -> apply to registered slices.
  - redirect return (?code=) handled at boot, URL cleaned afterwards.
  - errorKey() maps failures to i18n keys (sync.err.*).
- index.html: sync.js loaded before shell.js (correct boot dependency
  order: translations → sync → shell).
  - translations.js: sync UI strings (EN/EL) — connect/disconnect, pull/push,
  passphrase unlock/forget, status, success/error messages (incl. sync.err.*
  mapped by orosSync.errorKey()).
- style.css: new section 9 — Sync (status dot + email, actions row,
  passphrase input with hint, message colors). Compact 38px action buttons.
- sw.js: sync.js added to PRECACHE_URLS; CACHE_VERSION bumped to oros-v0.2.
  Dropbox origins never hit the SW (cross-origin skip).
- shell.js: full sync integration (final part of v0.2).
  - renderSyncSection in app menu: status dot + account email,
    three states (disconnected → connect; connected w/o passphrase →
    unlock input + first-time hint; unlocked → pull/push + forget
    passphrase + disconnect).
  - Shell slice registered via orosSync.registerSlice("shell", get, set):
    lang/theme/skin sync across devices; setter validates all values
    before applying (no dirty payloads from bad syncs).
  - Status messages (ok/err/dim) survive menu re-renders.
  - OAuth redirect return triggers menu refresh once tokens land.
  - Account email escaped via escapeHtml; async-loaded, non-blocking.
  
  ## v0.2.1 — User-controlled updates
- sw.js: install no longer skipWaiting — new worker waits. Message
  channel "SKIP_WAITING" for shell-triggered activation.
- shell.js: registerServiceWorker rewritten — updatefound/statechange
  detection, floating toast (update.available / update.reload, EN/EL),
  tap → SKIP_WAITING → controllerchange → auto reload.
- translations.js: 2 new keys (update.available, update.reload).

### UX fixes (v0.2.2)
- Menu no longer closes on internal clicks: delegated stopPropagation
  on #app-menu (root cause: re-render detaches the click target before
  the outside-close containment check).
- Passphrase input gains show/hide toggle (eye icon, EN/EL tooltip);
  toggle mutates the input directly — no re-render, no text loss.
- Install row moved to its own visually separated, accent-bordered
  section (was visually merging into the Appearance section).
  
  ## v0.3 — Trusted device vault + auto-sync (part 1 of 2)

- sync.js: IndexedDB vault — non-extractable AES-GCM device key;
  passphrase sealed to localStorage, auto-unlock on boot (opt-in via
  remember checkbox in UI, part 2).
- Dirty flag persisted (oros-sync-dirty): markDirty() API for shell
  and future apps; cleared only on successful push.
- Auto engine: boot reconcile (pull → push-if-dirty), 3-min interval
  push when dirty, visibilitychange(hidden) push. navigator.onLine
  gate, pushInFlight race guard, .finally cleanup.
- onAutoSync(event) subscription for subtle UI feedback.
- setPassphrase(pw, remember) extended; forgetPassphrase (session-only)
  vs clearDevice (wipes vault) split.
  
  ### v0.3 — Trusted device vault + auto-sync (part 2 of 2)
- shell.js: unlock UI extended — "Remember on this device" checkbox
  (pre-checked if device vault exists), passed to setPassphrase(pw,
  remember); kickAutoEngine() after manual unlock for immediate
  silent reconcile.
- noteLocalChange() wired to lang/theme/skin user handlers only —
  shellSliceSet (pull-fed) deliberately clean to prevent sync loops.
- Auto-sync feedback: status dot pulses during engine push/done.
- Forget split: clearDevice() (wipes vault + IndexedDB key) shown as
  "Forget on this device" when vault exists; session-only otherwise.
- translations.js: sync.pass.remember, sync.pass.device,
  sync.ok.unlocked (EN/EL). style.css: remember-row + dot pulse.
  
  ### v0.3.1 — Sync refinements
- Auto-sync interval is user-configurable per device (Off/1/3/5/15 min,
  select in Sync section, persisted oros-sync-interval). Push-on-hide
  remains always active. Applied immediately via setIntervalMinutes().
- Unlock flow now auto-pulls visibly ("Syncing… → pulled → pushed if
  dirty") instead of silent kickAutoEngine — fixes invisible first sync
  and stale-module TypeError (getIntervalMinutes guarded in shell).
- Menu: "Update orOS" replaces "Install orOS" in its section whenever a
  new service worker version is waiting; update toast kept as passive
  notifier; both trigger SKIP_WAITING → auto reload.
  
  ### v0.3.2 — Local backup (export/import)
- sync.js: exportData() — full plaintext payload (shell + app slices,
  meta.exportedAt) as pretty JSON; importData(json) — validates,
  applies via applyPayload, marks dirty (auto-uploads to cloud on
  next sync). Both work offline, no passphrase, no Dropbox.
- shell.js: Export/Import row in Sync section (all connection states)
  + unencrypted-storage hint. Download: orOS-backup-YYYY-MM-DD.json.
- translations.js: sync.export/import/ok.export/ok.import/backup.hint
  (EN/EL). style.css: .sync-hint.
  
  ### v0.3.3 — Update detection at boot
- shell.js: registerServiceWorker hardened — watchWorker() covers
  workers already installing at page load (race condition: update
  download starts before the updatefound listener attaches), plus
  direct state re-check, explicit registration.update() at boot, and
  hourly re-check for long sessions. Update now surfaces on first
  visit after a deploy, not the second.
  
  ### v0.3.4 — Update toast polish
- Update toast and menu "Update orOS" now appear after a 500ms grace
  period (lands on a settled shell, not over boot), with a 0.35s
  fade/slide-in transition. toastQueued guard prevents duplicate
  toasts when boot-check and watcher fire near-simultaneously.
  
  ### v0.3.5 — Update broker (fixes updates never reaching cached shells)
- ROOT CAUSE: update machinery lived in shell.js, which the old SW
  serves cache-first — a stuck old shell could never deliver its own
  update (chicken-and-egg). Hard refresh worked because Shift+Reload
  bypasses the SW entirely.
- index.html: inline update broker (network-first HTML = always
  fresh). Owns the full lifecycle: waiting/installing detection
  (boot race covered), force r.update() on every load + hourly,
  self-styled toast (no cached CSS/JS dependency), SKIP_WAITING on
  tap, controllerchange → reload. Dedupes against legacy shells.
- shell.js: registerServiceWorker slimmed to mirror broker state
  (oros-update-ready event / __orosUpdateReady flag) into the menu
  button; update button delegates to window.orosActivateUpdate().
- sw.js: CACHE_VERSION bumped to oros-v0.3.5 (was stale at v0.2).

### v0.3.6 — Synced auto-sync interval
- Auto-sync interval is now part of the shell slice (syncInterval field):
  user changes on one device propagate to all others on next sync.
  Applied via setIntervalMinutes (pull-fed, never marks dirty →
  no sync loop). Backward-compatible with older shells (field ignored).
- Local interval change now marks dirty (travels with shell data).

### v0.3.6 — Silent-update welcome toast
- APP_VERSION constant in shell.js (bump per deploy).
- checkVersionToast() on boot: if last seen version differs (and
  exists), shows bottom-center "orOS was updated to vX" toast,
  auto-dismisses after 4s (click = early dismiss). First visit is
  silent (remember only). Device-local (oros-last-version), never
  synced. Positioned apart from the update toast (no overlap).
- translations.js: update.done (EN/EL). style.css: #version-toast.

### v0.3.6 (hotfix) — Stale asset cache
- ROOT CAUSE of sync features not reaching mobile: several deploys
  shipped asset changes without bumping sw.js CACHE_VERSION; the SW
  kept serving the old precached shell.js/sync.js (cache-first).
  Desktop appeared fine only because of hard refreshes (SW bypass).
- sw.js: CACHE_VERSION bumped to oros-v0.3.6; new deploy ritual:
  every asset-changing deploy bumps CACHE_VERSION (and APP_VERSION
  for the welcome toast). CI auto-bump proposed as follow-up.
