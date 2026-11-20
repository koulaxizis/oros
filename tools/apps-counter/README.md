# APK download counter (APPS-DL)

Chris 2026-11-19 (card «Μετρητής Cloudflare»): every APK download is counted
per app and per channel, and the sites show the numbers. Only numbers are kept:
no IP address, no device, no time per download.

- `worker.js`: the Cloudflare Worker `apps` (https://apps.koulaxizis.workers.dev).
  It serves our three F-Droid repositories from GitHub Pages and counts full APK
  downloads by User-Agent (Koulaxizis Apps `KoulaxizisApps/1`, F-Droid, Droid-ify,
  Obtainium, other). A cron (every hour; orOS re-uploads its APKs on every build, which resets their GitHub count) adds the public GitHub release download
  counts (site buttons, Obtainium on GitHub releases) to a ledger by asset id that
  never goes down. `/stats.json` (CORS *, 5 min cache) gives
  `{v, at, github_at, apps: {package: {github, manager, fdroid, droidify, obtainium, other, <manual channel>: {n, at}}}, files: {"owner/repo/asset name": package}}`
  (`files` lets a page match its GitHub download buttons to packages).
  The sites read it with `dl-counts.js` (one copy per site, same code).
- `schema.sql`: D1 database `apps-counter` (tables dl, gh_asset, man, meta).
- `assets.js` → `assets.json`: release asset name → package, injected into
  `worker.js` at `/*ASSETS*/` on deploy. Run it again when an APK is added.
- Hand-recorded counts (anything that cannot be read automatically, such as
  the old Glarolykoi app's Play Store count `play_appilix`, and the
  `estimate` baseline of downloads before 19/11) live in table `man`
  (pkg, ch, n, at), e.g.
  `INSERT INTO man VALUES ('net.glarolykoi.android','play_appilix',10,'2026-11-19') ON CONFLICT (pkg, ch) DO UPDATE SET n = excluded.n, at = excluded.at`.
  There is no f-droid.org listing (Chris 2026-11-19): only our own repos count.

Deploy (Cloudflare API, account of the relay): create D1 `apps-counter`, run
`schema.sql`, upload `worker.js` (module, ASSETS injected) with binding `DB`,
cron `17 * * * *`, and the workers.dev subdomain on.
Tests: `tests/apps-counter.test.js`.
