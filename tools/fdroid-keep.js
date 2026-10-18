#!/usr/bin/env node
// Keeps the APKs of earlier F-Droid publishes downloadable for a while
// (FDROID-1). A phone downloads an update with the index it fetched last,
// which can be hours old (F-Droid refreshes on Wi-Fi only by default);
// each publish renames every APK (<package>_<versionCode>_<sha256 8>.apk),
// so without this the file that index names is gone and the download
// fails with 404. Kept files are not in the index, only on the site.
// .github/workflows/fdroid.yml runs it before pushing the new site:
//   node tools/fdroid-keep.js <published checkout> <new site dir>
// <checkout>/kept-apks.json and <site>/kept-apks.json: file name → when it
// left the index (ms). A file is kept KEEP_MS after that, and the oldest
// go first when the kept files pass MAX_BYTES (GitHub Pages sites stop
// at 1 GB).
"use strict";
const fs = require("fs");
const path = require("path");

const KEEP_MS = 3 * 24 * 3600 * 1000;
const MAX_BYTES = 500 * 1024 * 1024;

// prev: { name: retiredAt } from the published site; files: [{ name, size }]
// of the published repo/; current: Set of names in the new index.
// Returns { name: retiredAt } of the files to keep.
function plan(prev, files, current, now) {
  const cands = files
    .filter((f) => f.name.endsWith(".apk") && !current.has(f.name))
    .map((f) => ({ name: f.name, size: f.size, at: typeof prev[f.name] === "number" ? prev[f.name] : now }))
    .filter((f) => now - f.at < KEEP_MS)
    .sort((a, b) => b.at - a.at || (a.name < b.name ? -1 : 1));
  const out = {};
  let total = 0;
  for (const f of cands) {
    if (total + f.size > MAX_BYTES) break;
    total += f.size;
    out[f.name] = f.at;
  }
  return out;
}

function main(pubDir, siteDir) {
  const read = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return {}; } };
  const prev = read(path.join(pubDir, "kept-apks.json"));
  const pubRepo = path.join(pubDir, "repo");
  const siteRepo = path.join(siteDir, "repo");
  const files = fs.existsSync(pubRepo)
    ? fs.readdirSync(pubRepo).map((name) => ({ name, size: fs.statSync(path.join(pubRepo, name)).size }))
    : [];
  const current = new Set(fs.readdirSync(siteRepo));
  const keep = plan(prev, files, current, Date.now());
  for (const name of Object.keys(keep)) fs.copyFileSync(path.join(pubRepo, name), path.join(siteRepo, name));
  fs.writeFileSync(path.join(siteDir, "kept-apks.json"), JSON.stringify(keep, null, 2) + "\n");
  console.log(Object.keys(keep).length + " earlier APKs kept");
}

if (require.main === module) main(process.argv[2], process.argv[3]);
module.exports = { plan, KEEP_MS, MAX_BYTES };
