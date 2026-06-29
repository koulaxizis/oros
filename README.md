# orOS — Artist's Operating System

> **No Cookies · No Tracking · No Ads · Open Source · Privacy First · Minimal Design**

A privacy-respecting tool suite for creators by **Christos Koulaxizis**. Each application works fully offline and can be installed as a standalone Progressive Web App.

---

## Philosophy

- Everything stays local unless you choose otherwise
- No analytics, no telemetry, no profiling
- Open source from day one (MIT)
- Minimum viable design — no visual noise
- Offline-first architecture via Service Worker
- Zero dependencies outside web standards

## Live

<https://koulaxizis.github.io/oros>

## Available Tools

| Tool | Description | Status |
|------|-------------|--------|
| ✏️ Writer | Markdown text editor with autosave | ✅ Available |

_More tools coming soon._

## Tech Stack

- Vanilla HTML / CSS / JS — zero frameworks
- Service Worker for offline caching
- Web App Manifest for PWA installation
- JSON-based internationalization (i18n)
- CSS custom properties for theming (light/dark)

## Project Structure

    oros/
    ├── index.html                  Landing page with tool grid
    ├── editor.html                 Writer app
    ├── manifest.json               PWA manifest
    ├── service-worker.js           Offline caching
    ├── favicon.svg                 App icon (mountain motif)
    ├── LICENSE                     MIT license
    ├── README.md                   You are here
    └── assets/
        ├── css/
        │   └── style.css           Shared stylesheet (all apps)
        └── js/
            ├── main.js             Theme, language, back-to-top
            ├── editor.js           Writer logic
            └── translations.json   i18n strings (EN/EL)

## Usage

Visit the live site, pick a tool, and start creating. To install any tool as an app:

- **Desktop (Chrome/Edge):** Click the install icon in the address bar
- **Android:** "Add to Home Screen" from browser menu
- **iOS:** Share → "Add to Home Screen"

Everything works offline after the first visit.

## Self-Hosting

    git clone https://github.com/koulaxizis/oros.git
    cd oros
    python3 -m http.server 8000

Then open `http://localhost:8000` in your browser.

## Adding New Tools

1. Create a new HTML file in the root (e.g. `palette.html`)
2. Link shared styles and scripts:

       <link rel="stylesheet" href="assets/css/style.css">
       <script src="assets/js/main.js"></script>

3. Use the same header / footer / back-to-top markup
4. Add an entry card in `index.html`
5. Add new cache entries in `service-worker.js`
6. Add translation keys in `assets/js/translations.json`

## Translations

All strings live in `assets/js/translations.json`. To add a language:

1. Add a new locale object (e.g. `"de": { ... }`) with translated keys
2. Ensure every `data-i18n-*` attribute has a matching key
3. Add the new option in the language selector inside `main.js`

Currently supported: 🇬🇷 Greek (el), 🇺🇸 English (en)

## Browser Support

Works on all modern browsers with:

- Service Workers
- CSS Custom Properties (variables)
- localStorage API

Tested on: Chrome, Firefox, Safari, Edge (recent versions).

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-tool`)
3. Commit changes (`git commit -m 'Add my-tool'`)
4. Push to the branch (`git push origin feat/my-tool`)
5. Open a Pull Request

Please respect the core philosophy: no tracking, no external dependencies, no frameworks.

## License

MIT © 2026 Christos Koulaxizis

---

*Tools should serve artists — not collect them.*