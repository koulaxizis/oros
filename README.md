# orOS

**A static operating system in your browser.** Live at
[useoros.online](https://useoros.online).

orOS is a desktop in a web page: a menu, a taskbar, notifications and a
growing set of apps (notes, calendar, to-do, writer, spreadsheet, maps,
weather, radio, games and more). It installs as an app (PWA), works offline,
and keeps your data on your device. If you want your data on more than one
device, it syncs through your own Dropbox, encrypted before it leaves the
browser.

## Principles

- **Offline first.** Every app works without a connection. A service worker
  keeps the whole system on the device; online features (weather, maps,
  radio, TV, media search) say so and degrade gracefully.
- **Your data stays yours.** Data lives in the browser (localStorage /
  IndexedDB). Optional sync goes to *your* Dropbox app folder, end-to-end
  encrypted (AES-GCM, key from your passphrase via PBKDF2, 600,000 rounds).
  Neither Dropbox nor anyone else can read it.
- **Sync that never loses data.** Each app merges changes from all devices
  (per-item last-writer-wins with tombstones), so editing on two devices
  never silently overwrites one of them.
- **No cookies, no tracking, no analytics, no ads.** No third-party scripts
  are loaded; every library is bundled in the repository.
- **Safe with untrusted content.** Imported files, mail and anything from an
  online service are treated as hostile: sanitised in inert documents, shown
  as text, never executed.
- **Bilingual.** English and Greek throughout.
- **Phone to desktop.** Layouts work from 360 px wide up to large screens,
  with keyboard shortcuts on desktop (`Ctrl+Alt+Shift+I` shows them all).

## Apps

Released apps, by menu category:

| Category | Apps |
|---|---|
| Accessories | Weather, Time, Files, Calculator |
| Office | To-Do, Kanban, Notes, Calendar, Quote, Contacts, Storage, Spreadsheet, Writer |
| Lifestyle | Minimalism |
| Creativity | Prompter, Characters, Name Generator, Wallpaper Generator |
| Personal | Mood, Habits, Micro-Zen, Cycle |
| Internet | Bookmarks, Maps |
| Fun | Dice & Coin, Wheel of Fate, Netizen ID, Pet World |
| Sound | Radio, Sound Mixer |
| Video | Television |
| Games | Memory, Connect 4, Dots & Boxes, Tic-Tac-Toe, Simon Says, Number Slider, Lights Out, Whack-a-Mole, Snake, 2048, Wordle |
| Security | Password Generator |

More apps are already in the repository and are released one at a time
(budget, chores, QR codes, public domain calculator, plants, water,
travel, meals, family tree, media shelf, workouts, mail, the design studio
and 21 more games). The games and several apps are full rewrites of
[tablogames.online](https://tablogames.online) and
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
- The Mail app talks IMAP through a small stateless relay; its code and
  deploy steps are in [`relay/`](relay/README.md). You can run your own on
  Cloudflare Workers.

## Development

- **Layout:** the shell lives at the root (`index.html`, `shell.js`,
  `sync.js`, `notifications.js`, `fs.js`, `vault.js`, `dialogs.js`,
  `pet.js`, `sw.js`, `style.css`, `translations.js`); each app is a folder
  with its own `index.html`, loaded in a frame. `apps.json` is the app list.
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

## Support

orOS is free. If it helps you, you can
[buy Christos a coffee on Ko-fi](https://ko-fi.com/koulaxizis).

## Licence

orOS is released under the [MIT License](LICENSE), © 2026 Christos
Koulaxizis. Bundled third-party libraries, fonts, icons and data keep their
own licences, listed in [`CREDITS.md`](CREDITS.md).
