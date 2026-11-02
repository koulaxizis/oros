#!/usr/bin/env node
// Builds the Firefox form of the orOS browser add-on (Bible Part IV
// "Browser add-on"). extension/manifest.json is the Chrome/Edge/Brave
// form: a Manifest V3 service worker only, because Chromium warns
// "'background.scripts' requires manifest version of 2 or lower" when
// both keys are present. Firefox runs MV3 background code as event pages
// and needs background.scripts, so this copies extension/ to OUT_DIR and
// writes background.scripts there instead of background.service_worker.
// The script list is read from the importScripts(...) line of
// background.js, so the two forms always load the same files.
//   node .github/scripts/ext-firefox.js OUT_DIR
"use strict";
const fs = require("fs");
const path = require("path");
const SRC = path.join(__dirname, "..", "..", "extension");

function backgroundScripts(bg) {
  const m = /importScripts\(([^)]*)\)/.exec(bg);
  if (!m) throw new Error("background.js: no importScripts(...) line");
  const list = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  if (!list.length) throw new Error("background.js: importScripts(...) names no file");
  return list.concat("background.js");
}

function firefoxManifest(manifest, bg) {
  const m = JSON.parse(JSON.stringify(manifest));
  if (!m.background || m.background.service_worker !== "background.js") {
    throw new Error("manifest.json: background.service_worker must be background.js");
  }
  m.background = { scripts: backgroundScripts(bg) };
  return m;
}

function build(out) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(SRC, out, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
  const bg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
  const m = firefoxManifest(manifest, bg);
  m.background.scripts.forEach((f) => {
    if (!fs.existsSync(path.join(out, f))) throw new Error("missing " + f);
  });
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(m, null, 2) + "\n");
  return m;
}

module.exports = { backgroundScripts, firefoxManifest, build };

if (require.main === module) {
  const out = process.argv[2];
  if (!out) { console.error("usage: node .github/scripts/ext-firefox.js OUT_DIR"); process.exit(2); }
  const m = build(path.resolve(out));
  console.log("Firefox add-on " + m.version + " → " + out);
}
