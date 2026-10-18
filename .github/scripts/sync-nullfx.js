#!/usr/bin/env node
// Copies the web version of NULL JSFX (koulaxizis/null-jsfx, web/) into
// studio/nullfx/ and rewrites the studio/nullfx block of sw.js PRECACHE_URLS
// so every effect stays available offline.
//
//   node .github/scripts/sync-nullfx.js <path to a null-jsfx checkout>
//
// Only generated files are copied: web/runtime/*.js, web/fx/*.js and
// web/fx/index.json, for the effects and the instruments ("instruments"
// in index.json, played by MIDI on instrument tracks). A plugin that left
// index.json is removed. Prints a summary line per added, changed and
// removed file; exits 1 on bad input.
// Used by .github/workflows/sync-nullfx.yml.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const DEST = path.join(ROOT, "studio", "nullfx");
const ID_RE = /^[a-z0-9_]{1,40}$/;

function fail(msg) { console.error("sync-nullfx: " + msg); process.exit(1); }

const src = process.argv[2];
if (!src) fail("usage: sync-nullfx.js <null-jsfx checkout>");
const web = path.join(path.resolve(src), "web");
let index;
try { index = JSON.parse(fs.readFileSync(path.join(web, "fx", "index.json"), "utf8")); }
catch (e) { fail("cannot read web/fx/index.json: " + e.message); }
if (!index || !Array.isArray(index.effects) || !index.effects.length) fail("index.json has no effects");
if (index.instruments != null && !Array.isArray(index.instruments)) fail("index.json instruments is not a list");
const ids = index.effects.concat(index.instruments || []).map((e) => e && e.id);
ids.forEach((id) => { if (typeof id !== "string" || !ID_RE.test(id)) fail("bad effect id " + JSON.stringify(id)); });
if (new Set(ids).size !== ids.length) fail("duplicate plugin ids");

const runtime = fs.readdirSync(path.join(web, "runtime")).filter((f) => /^[a-z0-9-]+\.js$/.test(f)).sort();
if (runtime.indexOf("null-worklet.js") < 0 || runtime.indexOf("eel-rt.js") < 0) fail("web/runtime is incomplete");

// Wanted files, relative to studio/nullfx/, in the order sw.js lists them.
const wanted = runtime.map((f) => "runtime/" + f)
  .concat(ids.slice().sort().map((id) => "fx/" + id + ".js"))
  .concat(["fx/index.json"]);

const log = [];
wanted.forEach((rel) => {
  const from = path.join(web, rel), to = path.join(DEST, rel);
  if (!fs.existsSync(from)) fail("missing " + rel);
  const data = fs.readFileSync(from);
  const old = fs.existsSync(to) ? fs.readFileSync(to) : null;
  if (old && old.equals(data)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, data);
  log.push((old ? "changed " : "added   ") + rel);
});
["runtime", "fx"].forEach((dir) => {
  const abs = path.join(DEST, dir);
  if (!fs.existsSync(abs)) return;
  fs.readdirSync(abs).forEach((f) => {
    const rel = dir + "/" + f;
    if (wanted.indexOf(rel) < 0 && /\.(js|json)$/.test(f)) { fs.unlinkSync(path.join(abs, f)); log.push("removed " + rel); }
  });
});

// sw.js: replace the contiguous run of "studio/nullfx/..." precache lines.
const swPath = path.join(ROOT, "sw.js");
const lines = fs.readFileSync(swPath, "utf8").split("\n");
const isFx = (l) => /^\s*"studio\/nullfx\//.test(l);
const first = lines.findIndex(isFx);
if (first < 0) fail("sw.js has no studio/nullfx precache lines");
let last = first;
while (last + 1 < lines.length && isFx(lines[last + 1])) last++;
if (lines.slice(last + 1).some(isFx)) fail("sw.js studio/nullfx lines are not contiguous");
const indent = lines[first].match(/^\s*/)[0];
const block = wanted.map((rel) => indent + '"studio/nullfx/' + rel + '",');
const before = lines.slice(first, last + 1).join("\n");
if (before !== block.join("\n")) {
  lines.splice(first, last - first + 1, ...block);
  fs.writeFileSync(swPath, lines.join("\n"));
  log.push("changed sw.js precache (" + block.length + " studio/nullfx files)");
}

console.log(log.length ? log.join("\n") : "studio/nullfx is up to date");
console.log("effects: " + index.effects.length + ", instruments: " + (index.instruments || []).length);
