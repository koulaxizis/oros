# orOS App Kit

Build an app for [orOS](https://useoros.online) and send it as a pull request.

An orOS app is one folder of plain HTML, CSS and JavaScript. There is no
build step and nothing to install. The shell opens each app in an iframe and
gives it a few things: the colour theme, sync between devices, the menu search,
notifications and file dialogs. In return, every app follows the same short
contract, so it works offline, in English and Greek, from a 360 px phone up to
a desktop, and never loses data when two devices sync.

Before you start, read [CONTRIBUTING.md](../../CONTRIBUTING.md). Open an issue
with your idea first: the maintainer decides which apps join orOS.

## Quick start

You need Node 22 and a static web server (`python3 -m http.server` will do).

1. **Start from the template.**

   ```sh
   node .github/app-kit/new-app.js pocket "Pocket List" "Λίστα τσέπης"
   ```

   This copies [`template/`](template/) to `pocket/` and its test to
   `tests/pocket.test.js`, with the id and names filled in. The id is
   2-24 lowercase letters or digits. Both names are required, and the second
   one must be in Greek.

2. **Register the app.** The script prints four snippets. Add each one by hand
   to `apps.json`, `sw.js` (`PRECACHE_URLS`), `shell.js` (`ICONS`) and
   `translations.js` (once in `en`, once in `el`). Other people edit these
   files too, so the script never writes to them.

3. **Run it.** Serve the repository root and open
   `http://localhost:8000/?open=pocket`. The app opens inside the shell. A
   page opened as `pocket/?standalone` runs on its own, without the shell.

4. **Build your app.** Replace the template's list with your own idea. Keep
   the parts that every app needs (they are marked in the comments), and read
   the [contract](contract.md) when you add sync, search, files or links to
   other apps.

5. **Check it.**

   ```sh
   node .github/app-kit/check-app.js pocket
   ```

   This runs the same checks as CI, on your app only: the registration, the
   offline cache, the colour theme, help pages, sync, search, safety and
   privacy, then the release guards and the repo tests that cover every app.
   When the quality gate (`.github/qa/`) is in your checkout and Playwright is
   installed (`npm install --prefix .github/qa`), it also opens your app in
   Chromium at 360 and 1280 px, in English and Greek. Fix every `✗`. A `!` is
   a warning: read it and decide.

On every pull request that adds an app folder, CI runs the same check
(`check-app.js --added-since`) and opens the new app in Chromium. An app with
no entries in the quality gate's baseline must have no problems at all.

Then open a pull request. Say what the app does, what you tested by hand
(phone, desktop, offline, two devices syncing) and what you could not test.

## What the template shows

[`template/`](template/) is a small list app that already passes every check.

| File | What it shows |
|---|---|
| `index.html` | The direct-link snippet as the first script, `data-i18n` labels, no external files |
| `core.js` | A pure data model with a symmetric merge, tombstones and canonical output, which Node can test |
| `app.js` | The boot order, the language, local-first loading, `registerSlice` with five arguments, the colour theme and a deep-link receiver |
| `app.css` | Shell colours with a fallback, a layout that works from 360 px, 40 px touch targets |
| `search.js` | A read-only provider for the menu search |
| `help.en.txt`, `help.el.txt` | The app's page in the built-in guide, with the same headings in both languages |
| `myapp.test.js` | The sync rules as tests. It becomes `tests/<id>.test.js` |

## Where to read more

- [contract.md](contract.md): every rule, why it exists, and which check
  enforces it.
- [`OROS_BIBLE.md`](../../OROS_BIBLE.md): the project's full manual. Part VI
  has the canonical code patterns, and Part VIII has the release checklists
  the contract comes from.
- Look at an existing app close to yours. `characters/`, `diary/` and
  `todo/` are good examples of synced data. `dice/` and `wheel/` are small
  apps with no synced data.
