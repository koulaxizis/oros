// orOS Settings › Fonts: where a font is used (FM-6). designkit/fonts.js
// 1.4.0 uses(): Layout and Atelier packages that name the family (its
// quoted id, as ext.fam or setup.ext.fonts write it), Writer documents
// whose fonts in the fonts slice name it (deleted ones left out), and
// the font of orOS. Settings looks only on request, and by itself on
// the first press of Remove.
// Run: node --test tests/fonts-where.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const F = require(path.join(ROOT, "designkit/fonts.js"));
const ID = "uf_" + "a".repeat(16);
const pkg = (kind, id, name, extra) => ({ text: JSON.stringify({ kind, ver: 1, doc: Object.assign({ id, name }, extra) }) });

test("uses: Layout and Atelier packages that name the family, by name", () => {
  const src = {
    layout: [
      pkg("oros-layout-package", "ly-2", "Zeta", { pstyles: [{ ext: { fam: ID } }] }),
      pkg("oros-layout-package", "ly-1", "Alpha", { setup: { ext: { fonts: [{ id: ID, name: "X", fb: "serif" }] } } }),
      pkg("oros-layout-package", "ly-3", "Other", { setup: { ext: { fonts: [{ id: ID + "b" }] } } }),   // a longer id: not this one
      { text: "not json " + JSON.stringify(ID) },
      null
    ],
    atelier: [pkg("oros-atelier-package", "at-1", "Poster", { items: [{ ext: { fam: ID } }] })]
  };
  assert.deepEqual(F.uses(ID, src), [
    { app: "layout", doc: "ly-1", name: "Alpha" },
    { app: "layout", doc: "ly-2", name: "Zeta" },
    { app: "atelier", doc: "at-1", name: "Poster" }
  ]);
});

test("uses: Writer documents from the fonts slice (titles from Writer, deleted ones left out) and the font of orOS", () => {
  const cols = F.cols.normalize({
    docs: {
      "writer:d1": { body: { id: ID, name: "A", fb: "serif" }, head: null, m: 5 },
      "writer:d2": { body: null, head: { id: ID, name: "A", fb: "serif" }, m: 6 },
      "writer:d3": { body: { id: ID, name: "A", fb: "serif" }, head: null, m: 7 },
      "writer:d4": { body: { id: "fs_lora", name: "Lora", fb: "serif" }, head: null, m: 8 },
      "layout:x1": { body: { id: ID, name: "A", fb: "serif" }, head: null, m: 9 }
    }
  });
  const writer = { docs: [{ id: "d1", title: "Chapter 1" }, { id: "d2", title: "" }, { id: "d3", del: true }] };
  assert.deepEqual(F.uses(ID, { cols, writer, ui: { id: ID } }), [
    { app: "writer", doc: "d1", name: "Chapter 1" },
    { app: "writer", doc: "d2", name: "" },
    { app: "oros", doc: "", name: "" }
  ]);
  // Writer's data not on this device: the documents are still found
  assert.equal(F.uses(ID, { cols }).length, 3);
  assert.deepEqual(F.uses("fs_lora", { cols, ui: { id: ID } }), [{ app: "writer", doc: "d4", name: "" }]);
});

test("uses: nothing for a bad id or no sources; names are cleaned", () => {
  assert.deepEqual(F.uses("nope", { layout: [pkg("k", "ly-1", "A", { x: "nope" })] }), []);
  assert.deepEqual(F.uses(ID, null), []);
  assert.deepEqual(F.uses(ID, {}), []);
  const r = F.uses(ID, { layout: [pkg("k", "ly-9", "Bad\u0007name", { f: ID })] });
  assert.equal(r[0].name, "Bad name");
});

test("Settings: on request, by itself before a removal, strings in every language", () => {
  const fjs = read("settings/fonts.js"), de = read("i18n/de/settings.js");
  assert.match(fjs, /rootEl\.appendChild\(whereCard\(ufOf\(f\), S\.armed\)\);/);
  assert.match(fjs, /rootEl\.appendChild\(whereCard\(f\.id, false\)\);/);
  assert.match(fjs, /DK\.uses\(id, src\)/);
  assert.match(fjs, /__orosOpenAt\(r\.app, \{ doc: r\.doc \}\)/);
  assert.match(fjs, /indexOf\("\(conflict"\) < 0/);
  ["fm.where", "fm.where.find", "fm.where.again", "fm.where.looking", "fm.where.none", "fm.where.n1", "fm.where.n", "fm.where.fail",
   "fm.where.layout", "fm.where.atelier", "fm.where.writer", "fm.where.oros", "fm.where.untitled", "fm.where.open", "fm.where.hint"].forEach((k) => {
    assert.equal(fjs.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.indexOf('"' + k + '":') >= 0, k + " DE");
  });
});
