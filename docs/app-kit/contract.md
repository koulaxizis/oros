# The orOS app contract

Every orOS app follows these rules. Each one gives the rule, the reason for it,
and the check that enforces it. `check-app` means
`node .github/app-kit/check-app.js <id>`. The rules come from Checklist B in
[`OROS_BIBLE.md`](../../OROS_BIBLE.md) Part VIII. When that checklist changes,
this page changes in the same pull request (`tests/app-kit.test.js` fails
otherwise).

## 1. One folder, no build (Checklist B 1)

- Everything lives in `<id>/`: `index.html`, your scripts and styles, the
  help pages, and optionally `search.js`.
- Wrap each script in an IIFE (`(function () { … })();`) and add no globals,
  except the hooks named in this document.
- Log a boot marker (`<id>/app.js v<version> boot`) so a bug report shows
  which code ran. The template does this.
- Call `boot()` at the end of the IIFE, after every declaration.
- Never add a `?v=` to script or style links. A workflow stamps them on every
  release.

**Check:** `check-app` (folder), release guards G4.

## 2. Registration (Checklist B 2, 4, 5)

- `apps.json`: `id`, `name` (English), an existing `category`, `icon`,
  `url: "<id>/"`, `type: "internal"`, and `"search": "search.js"` if you have
  a provider. A new category needs the maintainer's agreement.
- `shell.js` `ICONS`: a 24×24 SVG drawn with `currentColor`.
- `translations.js`: `"app.<id>"` once in the `en` table and once in the `el`
  table.

**Check:** `check-app` (apps.json, icon, name), release guards G4.

## 3. Offline (Checklist B 3)

orOS works with no connection because a service worker keeps every file on the
device. Add `"<id>/"`, `"<id>/index.html"` and every file your page loads to
`PRECACHE_URLS` in `sw.js`, with no query strings. That includes files you
load later from code. Files fetched only online, on demand (a large model or a
data pack), may stay out. Say so in a comment.

**Check:** `check-app` (precache), release guard G2.

## 4. Colours follow the shell (Checklist B 7)

Copy `inheritPalette()` and `watchPalette()` from the template. They copy the
shell's CSS variables (`--bg`, `--text`, `--accent`, …) into your page, and
follow theme and skin changes. Use those variables in your CSS, with
fallback values for `?standalone`.

**Check:** `check-app` (G3), release guard G3.

## 5. Data and sync (Checklist B 6)

Your data lives in `localStorage` under one key (`oros-<id>-data`) or in
IndexedDB. To sync it, register a slice:

```js
api.registerSlice("<id>", sliceGet, sliceSet, STORAGE_KEY, mergeFn);   // 5 args, always
```

- **Local first.** Load your data before you register. Registering an empty
  state would push an empty slice to the cloud.
- **The merge is the fifth argument.** Without it, the engine picks local or
  remote by itself, and one device's edits can be lost.
- **Symmetric:** `merge(a, b)` and `merge(b, a)` give the same result. Merge
  by id, and let the newer `mtime` win. Settle a tie by comparing the JSON,
  never with "local wins".
- **Settles at once:** `merge(a, a)` gives back `a`. If it does not, every
  sync cycle uploads again, forever.
- **Tombstones:** a delete writes `tombs[id] = time`. A tombstone at least as
  new as the item removes it. A newer edit brings the item back.
- **Pure:** never call `uid()`, `Date.now()` or `Math.random()` inside the
  merge. Drop invalid rows rather than repair them.
- **Canonical getter:** `sliceGet()` returns a copy of the data that travels:
  arrays sorted by id, nothing device-local (positions on screen, caches,
  timers).
- **Pulled data never marks the app dirty:** `sliceSet()` merges, writes,
  repaints and shows no toast. Only the user's own edits call `markDirty()`.
- **Pruning:** if you drop old entries by the clock, apply the same rule
  inside the merge. Otherwise the pruned entries come back with every pull.

Keep the model in a separate file (`core.js`) with no DOM, and test it in
`tests/<id>.test.js` as the template does.

**Check:** `check-app` (sync), your own tests. The quality gate adds a
two-device test in a browser.

## 6. Inside the frame

Your page runs in an iframe, so `window` has none of the shell's objects.
Read every shell API from `window.parent`, inside a `try`, and keep working
when it is missing (`?standalone`):

```js
function syncApi() {
  try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
  catch (e) { return window.orosSync || null; }
}
```

The language is in `localStorage["oros-lang"]` (`"en"` or `"el"`). When the
user switches language, the shell reopens your app.

**Check:** the quality gate (`?standalone` and inside the shell).

## 7. English and Greek

Every string a user can see exists in both languages, in a table like
`{ en: { … }, el: { … } }` with the same keys. A Greek value is a real
translation, never a copy of the English. If you do not write Greek, say so in
the pull request and ask for help with the Greek text. Do not leave it out.

**Check:** `tests/i18n.test.js` (run by `check-app`). The quality gate also
looks for English left on the Greek screen.

## 8. Help pages (Checklist B 14)

`help.en.txt` and `help.el.txt` are the app's page in the built-in guide. They
use a small text format: `# Title`, `## Section`, `- list`, `` `button` ``,
`[[Ctrl+Alt+Shift+K]]` for keys, `[Text](app:settings)` for links. Both pages
need the same headings, and neither may contain HTML. Both go in the
precache.

**Check:** `check-app` (R38), `tests/help.test.js`, release guards.

## 9. Direct links (Checklist B 15)

A link to `useoros.online/<id>/` must open orOS with your app inside it, not
the bare page. Copy the template's first `<script>` into your `<head>`, right
after `<meta charset>` and the CSP `<meta>`, and change the id. No other
script may come before it.

**Check:** `check-app` (DL-1), `tests/direct-link.test.js`.

The Content-Security-Policy `<meta>` sits between `<meta charset>` and that
script and allows only your own files plus the hash of each inline script.
After changing the id (or any inline script) run `node .github/scripts/csp.js`
to refresh it. No inline `on…=` handlers and no scripts from other origins:
the quality gate fails on any CSP violation.

**Check:** `check-app` (CSP), `tests/csp.test.js`.

## 10. Menu search (Checklist B 13)

If your app holds the user's text, ship `search.js` so the menu search finds
it (see the template, and the Bible's Part VI, "Universal search provider").

- It is read only: no `setItem`, no `innerHTML`, no network access. It skips
  deleted, archived and hidden items.
- `search(ctx)` returns `{ id, title, text, when, target }`. The shell ranks
  and draws the results.
- Opening a result calls `window.__orosOpenAt(target)` in your app. If your
  app was closed, it picks up the target at boot with
  `window.parent.__orosTakeTarget("<id>")`. Ignore unknown ids.
- If the data is sensitive (health, money, secrets), set `"searchOff": true`
  in `apps.json`. Search for that app then starts switched off.

**Check:** `check-app` (search), `tests/search*.test.js`.

## 11. Links to other apps

Apps hand work to each other through the shell, never by touching another
app's storage:

- `window.parent.__orosOpenAt("<app>", target)` opens another app at a
  target it understands. For example, `__orosOpenAt("notes", { add: { … } })`
  opens a new note, and `__orosOpenAt("todo", { addItems: { … } })` adds
  To-Do items.
- Named bridges (send to Budget, Calendar, Quote, …) are listed in the
  Bible: Part II ("Deep-link bridges") and Part VI ("Cross-app … bridge").
  Each one has an exact payload. Use it as written.
- Your own receiver is `window.__orosOpenAt = function (target) { … }`. Do
  nothing while one of your dialogs has unsaved edits.

**Check:** `tests/deeplink-receivers.test.js` (run by `check-app`).

## 12. Files, dialogs, notifications and keys (Checklist B 8, 9, 10)

- **Files:** open and save through `window.parent.orosDialog`
  (`openFile`, `openFiles`, `saveFile`), with a local fallback only for
  `?standalone`. Never trust an imported file: parse it as data and show it
  as text.
- **Dialogs:** modal dialogs and panels sit in the centre of the screen.
  Context menus are the only exception.
- **Online services:** if the app goes online, say which service and why in
  the app. Give it a line in the shell's Info window (`sc.info.extsvc.<id>`
  in `translations.js`).
- **Notifications:** use `window.parent.orosNotifs.emit({ ns, key, title,
  body, deepLink })` for alerts and `transient(…)` for short messages (see
  the Bible's Part VI). Registering a toggle for your app in Settings
  (`KNOWN_APPS`) is a maintainer step. Ask in the pull request.
- **Keys:** Ctrl+Alt+Shift belongs to the shell. Forward it with the
  "Contract Β" listener from the Bible's Part VI. App shortcuts match
  `e.code` (`KeyS`), never `e.key`.

## 13. Layout, from 360 px

- No sideways scroll at 360 px. Use `min-width: 0` on flex children, and
  `overflow-wrap: anywhere` for user text.
- Touch targets are at least 40 px. Everything also works with a keyboard,
  with a visible focus ring.
- No action fails silently. With nothing selected, a button is disabled with
  a hint, or it explains itself.
- Respect `prefers-reduced-motion`.

**Check:** the quality gate (360/1280 px, horizontal scroll, console errors).

## 14. Safety

- User and imported text goes in with `textContent`. Use `innerHTML` only
  for fixed markup you wrote (icons).
- No `eval`, no `new Function`, no `document.write`, and no code loaded from
  a URL. No script, style or font from a CDN or another site.
- A library is copied into `vendor/` with its licence, and loaded from
  there.
- An app is never loaded at run time from somewhere else. Apps join orOS only
  as code in this repository, through a reviewed pull request.

**Check:** `check-app` (safety).

## 15. Privacy

- No Google services, no analytics, no trackers, no ads. orOS has no Google
  dependencies, and there is no speech recognition, because it sends audio to
  Google.
- An online service is used only when the user asks, with the user's own
  account or key where one is needed. Keys stay on the device.

**Check:** `check-app` (privacy).

## 16. Credits (Checklist B 12)

Anything you did not write yourself needs a credit: a library, font, icon set,
data set, sound or online service. Add an entry to `CREDITS.md`, to
`CREDIT_GROUPS` in `shell.js` (EN + EL), and to the Credits register in the
Bible, in the same pull request. Ship the licence text when the licence asks
for it. Use only licences compatible with MIT.

## 17. What the maintainer adds (Checklist B 11)

Leave these out of your pull request. The maintainer adds them when merging,
because many pull requests are open at the same time:

- `APP_VERSION` in `shell.js`, the `CACHE_VERSION` and `?v=` stamps;
- the changelog entry (Bible Part XII) and the Bible's app registry;
- the release order in the merge queue.
