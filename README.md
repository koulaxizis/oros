# orOS Writer
A privacy-first, offline-capable rich text editor for writers, bloggers, and journalists. No accounts, no tracking, no server — your words never leave your device.
## Table of Contents
- [Features](#features)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Internationalization](#internationalization)
- [Appearance](#appearance)
- [Privacy](#privacy)
- [Installation](#installation)
- [File Structure](#file-structure)
- [Browser Compatibility](#browser-compatibility)
- [Beta Channel](#beta-channel)
- [License](#license)

## Features

### Editor

- Rich text editing with smart paste (strips disallowed HTML, preserves safe formatting)
- Quick format toolbar: Bold, Italic, Underline, Headings (H1–H3), Bullet & Numbered lists
- Context menu (Alt + Right-click) with extended formatting: Strikethrough, Undo/Redo
- Smart typography: smart quotes ('' ""), em dashes (—), ellipsis (…), ©, ®, ™
- Automatic content saving via localStorage (survives refresh or crash)
- Reading progress bar (scroll-position based)
- Spell check disabled by design (custom implementation planned for future version)

### Document Management

- **Import:** TXT, MD, Markdown — with automatic YAML frontmatter parsing that populates metadata fields
- **Export:** Markdown (with frontmatter), Plain Text (.txt), RTF, Microsoft Word (.doc), PDF (via print dialog)
- **Document Metadata:** Title, Author, Tags, Category with auto-created/modified timestamps
- **Frontmatter Support:** Automatic YAML frontmatter generation on MD export, automatic parsing on MD import

### Analysis Tools

- **Statistics:** Words, characters (with/without spaces), sentences, reading time, speaking time — expandable detail view via click
- **Word Frequency:** Top 20 words with bar visualization, vocabulary diversity score (%), overused word highlighting
- **Document Outline:** Auto-generated navigation from H1–H3 headings, click to jump with flash animation
- **Writing Goal Tracker:** Set targets by words, characters, or paragraphs — optional write-lock when target reached, live progress percentage

### Workspace

- **Focus Mode:** Spotlight effect dimming everything except selected text (toggle via Settings)
- **Zen Mode:** Distraction-free fullscreen writing (press F9 or click 🧘)
- **Find & Replace:** In-document search with match counting, single and bulk replace
- **Customizable Interface:** Show/hide toolbar, stats, and individual tool buttons (Goal, Outline, Metadata, Find, Word Frequency) — all via Settings

### Settings — Writer Tab

All toggles persist across sessions via localStorage:

- Quick Format Toolbar visibility
- Statistics overlay visibility
- Focus Mode on/off
- Reading Progress bar on/off
- Smart Typography on/off
- Hide/show Goal button
- Hide/show Outline button
- Hide/show Metadata button
- Hide/show Find button
- Hide/show Word Frequency button

### Settings — Global Tab

- Zen Mode toggle
- PWA install button (when supported by browser)
- Beta Channel section with links to beta repository and live site
- Global keyboard shortcut reference

## Keyboard Shortcuts

| Action | Shortcut |
|---|---|
| Zen Mode | F9 |
| Exit Zen / Close panels | ESC |
| Save | Ctrl+S |
| Find & Replace | Ctrl+F |
| Writing Goal | Ctrl+G |
| Context Menu | Alt + Right-click |
| Bold | Ctrl+B |
| Italic | Ctrl+I |
| Underline | Ctrl+U |
| Undo | Ctrl+Z |
| Redo | Ctrl+Y |

## Internationalization

Six fully-supported languages with automatic system language detection:

- English (EN)
- Greek (EL)
- Spanish (ES)
- Italian (IT)
- French (FR)
- German (DE)

Manual override via the language selector in the header. All UI strings, tooltips, placeholders, and toast messages are localized.

## Appearance

- Light and Dark themes with automatic system preference detection
- Nunito typeface (regular, medium, semibold, bold, extrabold) — bundled locally for offline use
- Accent color: champagne gold (#c8a96e light / #daba83 dark)

## Privacy

- **Zero-knowledge:** All processing happens client-side. No data is transmitted to any server.
- **No tracking:** No analytics, no cookies, no telemetry.
- **No accounts:** No sign-up or login required.
- **Offline-first:** Fully functional without internet connection. Content persists in browser localStorage.
- **Open source:** MIT licensed. Audit the code yourself.

## Installation

orOS Writer is an installable PWA (Progressive Web App):

1. Open the app in a supported browser (Chrome, Edge, or other Chromium-based browser)
2. Open Settings (⚙️ in the header)
3. Click the "Install App" button in the Global tab
4. Confirm the browser install prompt

Once installed, the app runs in its own window and works fully offline.

## File Structure

    oros/
    ├── index.html                  # Landing page
    ├── editor.html                 # Rich text editor page
    ├── favicon.svg                 # Global SVG favicon
    ├── manifest.json               # PWA manifest
    ├── service-worker.js           # Service worker (offline caching)
    ├── README.md                   # This file
    ├── assets/
    │   ├── css/
    │   │   └── style.css            # All styles (themes, editor, panels, responsive, print)
    │   ├── fonts/
    │   │   ├── nunito-regular.woff2
    │   │   ├── nunito-medium.woff2
    │   │   ├── nunito-semibold.woff2
    │   │   ├── nunito-bold.woff2
    │   │   └── nunito-extrabold.woff2
    │   └── js/
    │       ├── main.js              # Core: theme, language, zen, settings modal
    │       ├── editor.js            # Editor: editing, stats, goals, panels, export
    │       ├── translations.json     # i18n strings (EN, EL, ES, IT, FR, DE)
    │       └── components/
    │           ├── header.js        # Global header (logo, version, controls)
    │           └── footer.js        # Global footer (credits, back-to-top)

## Browser Compatibility

Tested on modern browsers supporting:

- contentEditable API
- localStorage API
- Service Workers & PWA installation
- CSS custom properties (variables)
- color-mix() CSS function

Recommended: Chrome 90+, Firefox 89+, Safari 14+, Edge 90+

## Beta Channel

A separate beta repository is maintained for testing new features before they reach production:

- **Repository:** https://github.com/koulaxizis/oros-beta
- **Live site:** https://koulaxizis.github.io/oros-beta/

The beta channel uses a separate service worker cache to avoid conflicts with the production app. Access the beta links from Settings → Global tab → Beta Channel section.

> ⚠️ The beta channel is for testing purposes. Features may be incomplete or unstable.

## License

MIT License — see LICENSE file for details.

Copyright © 2026 Christos Koulaxizis

## Credits

Designed and developed by [Christos Koulaxizis](https://koulaxizis.gr)

Built with ♥ for artists and writers.