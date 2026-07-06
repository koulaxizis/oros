# orOS — Artist's Operating System

> **No Cookies · No Tracking · No Ads · Open Source · Privacy First · Minimal Design**

A privacy-respecting tool suite for creators by **Christos Koulaxizis**. Each application works fully offline and can be installed as a standalone Progressive Web App.

Live at **[useoros.com](https://useoros.com)**

---

## Philosophy

- Everything stays local unless you choose otherwise
- No analytics, no telemetry, no profiling
- Open source from day one (MIT)
- Minimum viable design — no visual noise
- Offline-first architecture via Service Worker
- Zero dependencies outside web standards

---

## Available Tools

| Tool | Description | Status |
|------|-------------|--------|
| ✏️ Writer | Dual-mode text editor (Markdown + Rich Text) with autosave | ✅ Available |

_More tools coming soon._

---

## Writer — Features

### Dual-Mode Editing

Switch between Markdown and Rich Text modes with a single toggle.

- **Markdown mode** — Plain text with live syntax
- **Rich Text mode** — WYSIWYG editing with inline formatting

### Export Formats

| Format | Extension | Notes |
|--------|-----------|-------|
| Markdown | .md | Raw markdown source |
| TXT | .txt | Stripped plain text |
| RTF | .rtf | Unicode-aware (Greek supported) |
| PDF | .pdf | Print dialog (browser native) |
| DOC | .doc | MS Word compatible HTML |

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Save | Ctrl+S |
| Bold | Ctrl+B |
| Italic | Ctrl+I |
| Undo | Ctrl+Z |
| Redo | Ctrl+Y |
| Format menu | Alt + Right-click |
| Zen Mode | F9 |
| Exit Zen | ESC |

### File Import

Supports opening `.txt`, `.md`, `.markdown`, and `.text` files directly in the editor.

---

## Internationalization

All strings live in `assets/js/translations.json`. Currently supported:

- 🇬🇷 Greek (el)
- 🇺🇸 English (en)

To add a language, add a new locale object with translated keys and register it in the language selector.

---

## Tech Stack

- Vanilla HTML / CSS / JS — zero frameworks
- Service Worker for offline caching (cache-first strategy)
- Web App Manifest for PWA installation
- JSON-based internationalization (i18n)
- CSS custom properties for theming (light/dark)
- Local Storage for autosave and user preferences
- Self-hosted Nunito font (OFL, woff2)

---

## Project Structure

    oros/
    ├── index.html                  Landing page with tool grid
    ├── editor.html                 Writer app
    ├── manifest.json               PWA manifest
    ├── service-worker.js           Offline caching (oros-v4)
    ├── favicon.svg                 App icon (mountain motif)
    ├── LICENSE                     MIT license
    ├── README.md
    └── assets/
        ├── css/
        │   └── style.css           Shared stylesheet (all apps)
        ├── fonts/
        │   ├── nunito-regular.woff2
        │   ├── nunito-medium.woff2
        │   ├── nunito-semibold.woff2
        │   ├── nunito-bold.woff2
        │   └── nunito-extrabold.woff2
        └── js/
            ├── main.js             Core: theme, language, zen, settings
            ├── editor.js           Writer logic
            ├── translations.json   i18n strings (EN/EL)
            └── components/
                ├── header.js       Global header (shared)
                └── footer.js       Global footer (shared)

---

## Usage

Visit [useoros.com](https://useoros.com), pick a tool, and start creating.

To install as a PWA:

- **Desktop (Chrome/Edge):** Click the install icon in the address bar, or use the Install button in Settings
- **Android:** "Add to Home Screen" from browser menu
- **iOS:** Share → "Add to Home Screen"

Everything works offline after the first visit.

---

## Self-Hosting

    git clone https://github.com/koulaxizis/oros.git
    cd oros
    python3 -m http.server 8000

Then open `http://localhost:8000` in your browser.

Any static file server works (Caddy, nginx, `npx serve`, etc.).

---

## Adding New Tools

1. Create a new HTML file in the root (e.g. `palette.html`)
2. Link shared styles and scripts:

       <link rel="stylesheet" href="assets/css/style.css">
       <script src="assets/js/components/header.js"></script>
       <script src="assets/js/components/footer.js"></script>
       <script src="assets/js/main.js"></script>

3. Use `<div id="oros-header"></div>` and `<div id="oros-footer"></div>` mount points
4. Add an entry card in `index.html`
5. Add new cache entries in `service-worker.js`
6. Add translation keys in `assets/js/translations.json`

---

## Browser Support

Works on all modern browsers with:

- Service Workers
- CSS Custom Properties
- localStorage API
- `color-mix()` CSS function (for header backdrop)

Tested on: Chrome, Firefox, Safari, Edge (recent versions).

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-tool`)
3. Commit changes (`git commit -m 'Add my-tool'`)
4. Push to the branch (`git push origin feat/my-tool`)
5. Open a Pull Request

Please respect the core philosophy: no tracking, no external dependencies, no frameworks.

---

## License

MIT © 2026 Christos Koulaxizis

---

## Links

- **Live:** [useoros.com](https://useoros.com)
- **Author:** [koulaxizis.gr](https://koulaxizis.gr)
- **Source:** [github.com/koulaxizis/oros](https://github.com/koulaxizis/oros)
- **Issues:** [github.com/koulaxizis/oros/issues](https://github.com/koulaxizis/oros/issues)
- **Beta repo:** [github.com/koulaxizis/oros-beta](https://github.com/koulaxizis/oros-beta)
- **Beta live:** [koulaxizis.github.io/oros-beta/](https://koulaxizis.github.io/oros-beta/)

---

*Tools should serve artists — not collect them.*