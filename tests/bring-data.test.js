// New users, extra idea 2: bring your data (IMPORT-GUIDE-1). A guide in
// Help › Your data and files and a First steps line that opens it.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const PAGES = {
  "help/topics/data.en.txt": "## Bring your data from other apps",
  "help/topics/data.el.txt": "## Φέρε τα δεδομένα σου από άλλες εφαρμογές",
  "i18n/de/help/topics/data.txt": "## Bring deine Daten aus anderen Apps mit"
};

function section(txt, head) {
  const i = txt.indexOf(head);
  assert.ok(i >= 0, head);
  const j = txt.indexOf("\n## ", i + head.length);
  return txt.slice(i, j < 0 ? undefined : j);
}

test("guide: the same section in EN, EL and DE, linking only to real apps", () => {
  const ids = new Set(JSON.parse(read("apps.json")).apps.map((a) => a.id));
  let want = null;
  for (const [p, head] of Object.entries(PAGES)) {
    const sec = section(read(p), head);
    const links = [...sec.matchAll(/\]\(app:([a-z0-9-]+)\)/g)].map((m) => m[1]);
    assert.ok(links.length >= 8, p);
    for (const id of links) assert.ok(ids.has(id), p + " app:" + id);
    if (want) assert.deepEqual(links, want, p + ": same apps in the same order");
    else want = links;
  }
  for (const id of want) assert.ok(fs.existsSync(path.join(ROOT, id)), id + " folder");
});

test("guide: every app it names has an import", () => {
  const has = (id) => fs.readdirSync(path.join(ROOT, id)).some((f) => /\.js$/.test(f) && /import|\.vcf|\.ics|VCALENDAR|vCard/i.test(read(id + "/" + f)));
  for (const id of ["contacts", "calendar", "notes", "todo", "kanban", "bookmarks", "passwords", "budget", "meals"]) assert.ok(has(id), id);
});

test("First steps: the Bring your data line, in EN, EL and DE", () => {
  const tr = read("translations.js");
  const en = tr.slice(0, tr.indexOf("\n  el: {")), el = tr.slice(tr.indexOf("\n  el: {"));
  assert.ok(en.includes('"wg.start.import":') && el.includes('"wg.start.import":') && read("i18n/de/shell.js").includes('"wg.start.import":'));
  assert.match(read("widgets.js"), /import: "wg\.start\.import"/);
});

test("First steps: the line opens the guide at its section, in each language", () => {
  const fold = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/ς/g, "σ");
  const slug = (s) => fold(s).replace(/[^a-z0-9α-ω]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  const tr = read("translations.js");
  const en = tr.slice(0, tr.indexOf("\n  el: {")), el = tr.slice(tr.indexOf("\n  el: {"));
  const sec = (src) => /"wg\.start\.import\.sec":\s*"([^"]+)"/.exec(src)[1];
  const heads = Object.values(PAGES).map((h) => slug(h.slice(3)));
  assert.deepEqual([sec(en), sec(el), sec(read("i18n/de/shell.js"))], heads);
  assert.match(read("help/help.js"), /function slugify\(s\) \{\n    return fold\(s\)\.replace\(\/\[\^a-z0-9α-ω\]\+\/g, "-"\)\.replace\(\/\^-\+\|-\+\$\/g, ""\)\.slice\(0, 60\);/, "same slug rule as Help");
});
