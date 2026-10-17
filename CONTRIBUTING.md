# Contributing to orOS

Thank you for wanting to help. orOS is built in the open, under the MIT
licence, by Christos Koulaxizis. Claude audits the code and writes pull
requests, and Christos reviews and merges every one.

## Who decides

**Christos decides what goes into orOS.** A pull request can be declined
even when it works. The reason may be scope, overlap with an existing app,
upkeep, or simply direction. To avoid wasted work, **open an issue first**
with the idea (what it does, who it is for, what it needs online) and wait for
a yes before you build.

## The rules every contribution follows

- **Free forever.** Everything in orOS stays free and MIT licensed. No
  paywalls, licence keys, ads, trackers or nag messages. By sending a pull
  request, you agree to license your work under the [MIT licence](LICENSE).
- **No Google dependencies,** no analytics, no third-party scripts at run
  time. Libraries are copied into `vendor/` with their licence.
- **Offline first and private.** Data stays on the device. Online features are
  used only when the user asks, with the user's own account or key.
- **No code from elsewhere.** orOS never loads or runs code from a URL or
  from an imported file. New apps join only as code in this repository,
  through a reviewed pull request. There is no plugin store and there will
  not be one.
- **English and Greek.** Every visible string, and the help page, exist in
  both languages. If you do not write Greek, say so and ask for help. Do not
  leave it out.
- **From 360 px up.** It works on a phone and on a desktop, with touch and
  with a keyboard.
- **Sync never loses data.** Follow the merge rules in the app contract.
- **Credits** for anything you did not write: `CREDITS.md`, the in-app credits
  and the Bible.

## Building an app

Follow the [orOS App Kit](docs/app-kit/README.md). It has the app contract, a
template app, and a script that checks your app the way CI does:

```sh
node .github/app-kit/new-app.js <id> "<English name>" "<Greek name>"
node .github/app-kit/check-app.js <id>
```

## Fixes and other changes

- Read [`OROS_BIBLE.md`](OROS_BIBLE.md) for the area you touch. It is the
  project's source of truth.
- Keep a pull request to one change. Plain JavaScript, no build step, no new
  dependencies.
- Run the tests: `node --test tests/*.test.js` (Node 22, nothing to install).
- Do not change `APP_VERSION`, the changelog or `sw.js` `CACHE_VERSION`. The
  maintainer adds them when merging.
- In the pull request, say what you tested by hand and what you could not test
  (a real phone, Safari, sync between two devices).

## Reporting a bug

Open an issue with the orOS version (menu, then Info), the device and browser,
the steps that cause the bug, and what you expected to happen. Never paste a
sync passphrase, an access token or private data.
