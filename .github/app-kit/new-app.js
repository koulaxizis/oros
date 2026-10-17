#!/usr/bin/env node
// orOS App Kit: start a new app from docs/app-kit/template.
//   node .github/app-kit/new-app.js <id> "<English name>" "<Greek name>"
// Copies the template to <id>/ and its test to tests/<id>.test.js,
// with the id and names filled in. The shared files (apps.json,
// sw.js, shell.js, translations.js) are left alone: other PRs edit
// them too, so the script prints the lines to add by hand.
// --root <dir> works on another checkout (the kit's own test).
"use strict";

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
let root = path.join(__dirname, "..", "..");
const ri = args.indexOf("--root");
if (ri >= 0) { root = path.resolve(args[ri + 1] || "."); args.splice(ri, 2); }
const [id, en, el] = args;

function fail(msg) { console.error("✗ " + msg); process.exit(1); }

if (!id || !en || !el) {
  fail('usage: node .github/app-kit/new-app.js <id> "<English name>" "<Greek name>"');
}
if (!/^[a-z][a-z0-9]{1,23}$/.test(id)) fail("the id is 2-24 lowercase letters or digits, starting with a letter: " + id);
if (!/[Ͱ-Ͽ]/.test(el)) fail("the Greek name has no Greek letters: " + el);
if (/[<>"`\\]/.test(en + el)) fail("names cannot contain < > \" ` or \\");

const TPL = path.join(__dirname, "..", "..", "docs", "app-kit", "template");
const dir = path.join(root, id);
const testFile = path.join(root, "tests", id + ".test.js");
if (fs.existsSync(dir)) fail(id + "/ already exists");
if (fs.existsSync(testFile)) fail("tests/" + id + ".test.js already exists");
try {
  const apps = JSON.parse(fs.readFileSync(path.join(root, "apps.json"), "utf8")).apps || [];
  if (apps.some((a) => a.id === id)) fail(id + " is already in apps.json");
} catch (e) { if (e.code !== "ENOENT") throw e; }

const pascal = id.charAt(0).toUpperCase() + id.slice(1);
const fill = (s) => s
  .replace(/MyAppCore/g, pascal + "Core")
  .replace(/Η εφαρμογή μου/g, el)
  .replace(/My App/g, en)
  .replace(/myapp/g, id);

fs.mkdirSync(dir);
const files = [];
for (const f of fs.readdirSync(TPL).sort()) {
  const src = fs.readFileSync(path.join(TPL, f), "utf8");
  if (f === "myapp.test.js") {
    fs.mkdirSync(path.dirname(testFile), { recursive: true });
    fs.writeFileSync(testFile, fill(src));
  } else {
    fs.writeFileSync(path.join(dir, f), fill(src));
    files.push(f);
  }
}

const q = (s) => JSON.stringify(s);
console.log(`✓ ${id}/ created (${files.join(", ")})`);
console.log(`✓ tests/${id}.test.js created`);
console.log(`
Now add the app to the shared files by hand (keep the order and style
of the lines around them):

1. apps.json, in "apps" (pick an existing category):
    {
      "id": ${q(id)},
      "name": ${q(en)},
      "category": "Accessories",
      "icon": ${q(id)},
      "url": ${q(id + "/")},
      "search": "search.js",
      "type": "internal"
    },

2. sw.js, in PRECACHE_URLS (no ?v=, no query strings):
${[id + "/", id + "/index.html"].concat(files.filter((f) => f !== "index.html").map((f) => id + "/" + f)).map((f) => "    " + q(f) + ",").join("\n")}

3. shell.js, in ICONS (a 24x24 SVG drawn with currentColor):
    ${id}: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">…</svg>',

4. translations.js, once in the "en" table and once in "el":
    ${q("app." + id)}: ${q(en)},
    ${q("app." + id)}: ${q(el)},

Then check it:
    node .github/app-kit/check-app.js ${id}
`);
