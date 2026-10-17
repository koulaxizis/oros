// Writes /<id>/manifest.webmanifest and /<id>/solo.html for every
// single app (solo.js): the manifest from solo.js manifestFor() + the
// file types in fileopen.js, the page from solo.js pageFor(). The files
// are committed; tests/solo.test.js fails when one is stale.
// Run after changing solo.js or fileopen.js:  node tools/solo-manifests.js
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SOLO = require(path.join(ROOT, "solo.js"));
const CSP = require(path.join(ROOT, ".github", "scripts", "csp.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const base = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8"));

for (const id of SOLO.ids()) {
  const m = SOLO.manifestFor(id, F.table(), base);
  fs.writeFileSync(path.join(ROOT, id, "manifest.webmanifest"), JSON.stringify(m, null, 2) + "\n");
  fs.writeFileSync(path.join(ROOT, id, "solo.html"), CSP.withPolicy(SOLO.pageFor(id, base)));   // Q6
  console.log("single app:", id);
}

