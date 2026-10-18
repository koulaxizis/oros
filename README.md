# orOS

**A static operating system in your browser.** Live at
[useoros.online](https://useoros.online). Every way to get it is on
[useoros.online/download](https://useoros.online/download/).

orOS is a desktop in a web page: a menu, a taskbar, notifications, a
universal search (`Ctrl+K`) and 132 apps, from notes, calendar, writer,
spreadsheet and mail to maps, music, a DAW, business tools and 37 games.
It installs as an app (PWA), works offline, and keeps your data on your
device. If you want your data on more than one device, it syncs through your
own Dropbox or WebDAV / Nextcloud server, encrypted before it leaves the
browser.

## Get orOS

All of it is free (see [Free forever](#free-forever)), and none of it goes
through an app store.

- **In the browser:** open [useoros.online](https://useoros.online). Chrome,
  Edge and Brave can install it as an app with its own window.
- **Windows and Linux installers** (v0.2.0): a Windows setup
  (`orOS-Setup-<version>.exe`), an AppImage and a `.deb`, plus Scoop (`scoop bucket add oros https://github.com/koulaxizis/oros-portable`,
  then `scoop install oros`) and winget. Installed copies update themselves.
  See [koulaxizis/oros-portable](https://github.com/koulaxizis/oros-portable).
- **orOS Portable** (v0.1.0): run orOS from a USB stick on any Windows or
  Linux PC, with or without internet; the data stays on the stick. Same repo.
- **Bootable USB** (beta): start a PC straight into orOS,
  [koulaxizis/oros-usb](https://github.com/koulaxizis/oros-usb).
- **Android:** orOS and single apps as APKs from the download page, with
  updates through the orOS repository for F-Droid, Droid-ify and Obtainium.
- **Single apps:** many apps install on their own, with their own icon,
  sharing data with orOS on the same device.
- **orOS Drive** (v0.2.0): a native app for Windows, Linux and Android that
  mirrors chosen folders both ways into the encrypted orOS disk in your
  Dropbox, and can show the whole disk as a folder (Windows Explorer, Linux,
  the Android Files app).
  [koulaxizis/oros-drive](https://github.com/koulaxizis/oros-drive).

## Principles

- **Offline first.** Every app works without a connection. A service worker
  keeps the whole system on the device; online features (weather, maps,
  radio, TV, media search) say so and degrade gracefully.
- **Your data stays yours.** Data lives in the browser (localStorage /
  IndexedDB / OPFS). Optional sync goes to *your* Dropbox app folder or
  *your* WebDAV server (Nextcloud, ownCloud, Synology and others), end-to-end
  encrypted (AES-GCM, key from your passphrase via PBKDF2, 600,000 rounds).
  Neither the provider nor anyone else can read it. You can move between
  providers and restore any of the last cloud backups from Settings.
- **Sync that never loses data.** Each app merges changes from all devices
  (per-item last-writer-wins with tombstones), so editing on two devices
  never silently overwrites one of them.
- **No cookies, no tracking, no analytics, no ads.** No third-party scripts
  are loaded; every library is bundled in the repository. orOS depends on
  no Google service: fonts are bundled, there is no speech recognition that
  sends audio away, and read-aloud uses only voices on the device.
- **Safe with untrusted content.** Imported files, mail and anything from an
  online service are treated as hostile: sanitised in inert documents, shown
  as text, never executed. Every page has a Content-Security-Policy.
- **Languages.** English and Greek throughout; German as a third language
  (translator packs in [`i18n/`](i18n/), needs native review). New languages
  are welcome, see [`docs/translate/`](docs/translate/).
- **Phone to desktop.** Layouts work from 360 px wide up to large screens,
  with keyboard shortcuts on desktop (`Ctrl+Alt+Shift+I` shows them all).

## Apps

All 132 apps, by menu category:

| Category | Apps |
|---|---|
| Accessories | Weather, Time, Moon & Sky, Files, Calculator, Text Tools, Unit Converter, Sticky Notes, Case Converter |
| Office | To-Do, Kanban, Mind Map, Whiteboard, Notes, Wiki, Calendar, Contacts, Storage, Spreadsheet, Writer, Layout, Slides, Public Domain Calculator, QR Generator, orOS Converter, Scanner & PDF |
| Lifestyle | Minimalism, Split, Travel, Chore Wheel, Meal Planner |
| Learning | Flashcards |
| Business | Quote, Timesheet, CRM, Stock, Invoices, Newsletter, Email Signature, Certificates |
| Creativity | Prompter, Typewriter, Label Maker, Characters, Name Generator, Atelier, Mockups |
| Image | Photo Lab, Screen Capture, Pixel Avatar, Wallpaper Generator, Tree Sketcher, Aura Painter |
| Personal | Mood, One-Sentence Diary, Habits, Micro-Zen, Health, Budget, Water, Workouts, Cycle, Pet Health Book, Baby, Family Tree, Garage, Plant Care, Media Shelf, Library |
| Internet | Bookmarks, Maps, Reader, One-Minute Museum, Mail |
| Fun | Dice & Coin, Wheel of Fate, Oracle, Netizen ID, Pet World, Score Keeper |
| Sound | Radio, Podcasts, Music, Sound Mixer, Ringtone Composer, Studio |
| Video | Television, Montage |
| Games | Memory, Connect 4, Dots & Boxes, Tic-Tac-Toe, Simon Says, Number Slider, Lights Out, Whack-a-Mole, Snake, 2048, Wordle, Spot the Difference, Hexagon Puzzle, Chess, Sudoku, Tetris, Minesweeper, Mahjong, Gomoku, Bubble Shooter, Checkers, Mastermind, Battleship, Rock Paper Scissors, Hangman, Flow Free, Nonogram, Breakout, Reversi, Mancala, Pong, Backgammon, Word Search, Solitaire, Jigsaw, Crossword, Xeri, Game Center |
| Security | Passwords |
| System | Device Info, Assistant, Help, Today, Settings |

Apps talk to each other (send a note to Writer, a contact to Mail, an
invoice to Budget), open files by type, and share one encrypted disk in
Files. Many open and save open formats (ODF, ICS, vCard, CSV, PDF and the
documented [orOS bundle format](docs/oros-bundle.md)). The games and several
apps are full rewrites of [tablogames.online](https://tablogames.online) and
[soffitta.site](https://soffitta.site).

## Run it yourself

orOS is plain HTML, CSS and JavaScript with **no build step and no
dependencies to install**. Serve the repository root with any static web
server, for example:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

- Service workers need `https://` or `localhost`.
- Dropbox sync uses the orOS Dropbox app key in `sync.js` and redirects back
  to the page that started it. To self-host sync on another domain, create
  your own Dropbox app (scoped, App folder access, PKCE) and put its key in
  `DROPBOX_APP_KEY`.
- Mail (IMAP/SMTP), notifications while orOS is closed (Web Push), share
  links and WebDAV servers without CORS go through a small stateless relay;
  its code and deploy steps are in [`relay/`](relay/README.md). You can run
  your own on Cloudflare Workers.

## Development

- **Layout:** the shell lives at the root (`index.html`, `shell.js`,
  `sync.js`, `notifications.js`, `fs.js`, `vault.js`, `dialogs.js`,
  `pet.js`, `search.js`, `i18n.js`, `sw.js`, `style.css`, `translations.js`);
  each app is a folder with its own `index.html`, loaded in a frame.
  `apps.json` is the app list. `android/` is the Android app, `extension/`
  the "Send to orOS" browser add-on.
- **Tests:** `node --test tests/*.test.js` (Node 22, no packages). They run
  in GitHub Actions on pull requests that touch tested code.
- **Versions:** `APP_VERSION` in `shell.js` is the only version set by hand.
  A GitHub Actions workflow stamps the service worker cache, the manifest
  and every asset's `?v=` from it, and checks offline coverage and the app
  list.
- **Project memory:** [`OROS_BIBLE.md`](OROS_BIBLE.md) holds the
  architecture, rules, data models, decisions, open items and the
  changelog. Read it before changing anything.
- **Credits:** every library, font, icon set, data set and online service
  is listed in [`CREDITS.md`](CREDITS.md) and in the app (Info →
  Credits & licences). A change that adds one updates both.

## Contributing

Fixes and new apps are welcome as pull requests; Christos decides what goes
in, so open an issue with the idea first. See [`CONTRIBUTING.md`](CONTRIBUTING.md).
To build an app, the [orOS App Kit](docs/app-kit/README.md) has the app
contract, a template and a local check that runs the same guards as CI.

## How orOS is made

For full transparency:

- **Christos Koulaxizis** designs orOS, decides what it does and how it
  looks, tests it on real devices and reviews and merges every change.
- **[Lumo](https://lumo.proton.me/)** (Proton's AI assistant) helped write
  and shape the code of orOS.
- **[Claude](https://claude.ai/)** (Anthropic's AI assistant) audits the
  code and, since October 2026, writes many of the new apps, fixes and tests
  as pull requests, under Christos's direction. Nothing reaches `main`
  without his review.

Designed with <3 by [Christos Koulaxizis](https://koulaxizis.gr).
Assisted by [Lumo](https://lumo.proton.me/). Audited by [Claude](https://claude.ai/).

## Free forever

orOS is free and open source (MIT), and it stays that way: no app or feature
that has been released for free will ever be moved behind a paywall, and there
are no license keys, ads or nags inside orOS.

## Support

If orOS helps you, you can
[buy Christos a coffee on Ko-fi](https://ko-fi.com/koulaxizis), or
[become a monthly supporter](https://ko-fi.com/koulaxizis/tiers). The same
Ko-fi page supports all of Christos's open-source projects
([noxpress](https://noxpress.tech), [NULL JSFX](https://nulljsfx.tech) and orOS).

Need a hand? You can
[book a service on Ko-fi](https://ko-fi.com/koulaxizis/commissions): orOS set up
on your own domain with your own sync, your logo and app list, or a custom app.

## Licence

orOS is released under the [MIT License](LICENSE), © 2026 Christos
Koulaxizis. Bundled third-party libraries, fonts, icons and data keep their
own licences, listed in [`CREDITS.md`](CREDITS.md).
