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