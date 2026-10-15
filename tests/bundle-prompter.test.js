// The .orosscript file (Prompter): pack a
// custom prompt with bundle.js, read it back as a NEW item
// through the app's own rules, and the app wiring (save, open,
// unzipped folder, "Open with").
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const P = require(path.join(ROOT, "prompter/io.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const names = (bytes) => {
  // the central directory names, in order
  const out = [], s = Buffer.from(bytes);
  for (let i = 0; i < s.length - 4; i++) if (s.readUInt32LE(i) === 0x02014b50) out.push(s.slice(i + 46, i + 46 + s.readUInt16LE(i + 28)).toString());
  return out;
};

const custom = { id: "cabc12345", cat: "haiku", en: "Write about rain.", el: "Γράψε για τη βροχή.",
  var_en: "In five words.", var_el: "Σε πέντε λέξεις.", tags: ["rain", "nature"], mtime: 1700000000000, pos: 3 };
test("prompter: a custom prompt round-trips as a new prompt", async () => {
  const st = { favorites: { cabc12345: 1700000000500 }, completed: { cabc12345: 1700000000600 } };
  const opts = P.bundleOpts(custom, st, { lang: "el", date: new Date(2026, 0, 2) });
  const bytes = await B.write(opts);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-script");
  const list = names(bytes);
  ["content.json", "meta.xml", "preview/script.txt", "README.txt"].forEach((n) => assert.ok(list.includes(n), n));
  const r = await B.read(bytes, { mime: P.MIME });
  assert.equal(r.app, "prompter");
  assert.equal(r.meta.title, "Γράψε για τη βροχή.");
  assert.deepEqual(r.content.prompt, custom);                       // every detail kept
  assert.equal(r.content.kind, "oros-prompter-package");
  const got = P.fromContent(r.content, { id: "cnew", now: 1800000000000, pos: 9 });
  assert.deepEqual(got.prompt, Object.assign({}, custom, { id: "cnew", mtime: 1800000000000, pos: 9 }));
  assert.equal(got.favorite, true);
  assert.equal(got.completed, 1700000000600);
  assert.match(P.scriptText(custom), /^Write about rain\.\r\n\+ In five words\.\r\n\r\nΓράψε/);
  assert.equal(P.fileName("Γράψε για: τη/βροχή.", "orosscript"), "Γράψε-για-τηβροχή.orosscript");
  assert.equal(P.fileName("...", "orosscript"), "prompt.orosscript");
});

test("prompter: the editor's rules on a hostile or partial file", () => {
  assert.equal(P.fromContent(null, {}), null);
  assert.equal(P.fromContent({ kind: "other", prompt: custom }, {}), null);
  assert.equal(P.fromContent({ kind: P.KIND, prompt: { en: "  ", el: 3 } }, {}), null);
  const g = P.fromContent({ kind: P.KIND, prompt: { cat: "__proto__", en: " Only English\u0000 ", tags: ["A ", "a", 5, "x,y", ""], var_en: {} },
    favorite: null, completed: 9e15 }, { id: "c1", now: 5 });
  assert.equal(g.prompt.cat, "micro");
  assert.equal(g.prompt.en, "Only English");
  assert.equal(g.prompt.el, "Only English");                        // both languages are required
  assert.deepEqual(g.prompt.tags, ["a", "xy"]);
  assert.equal(g.prompt.var_en, "");
  assert.equal(g.favorite, false);
  assert.equal(g.completed, null);                                  // never a done mark from the future
  assert.equal(P.fromContent({ kind: P.KIND, prompt: { en: "x".repeat(9000) } }, {}).prompt.en.length, 4000);
});

test("wiring: bundle.js before the app, save / open / folder / Open with", () => {
  const ph = read("prompter/index.html"), pj = read("prompter/prompter.js");
  assert.ok(ph.indexOf("../bundle.js") > 0 && ph.indexOf("../bundle.js") < ph.indexOf("io.js") && ph.indexOf("io.js") < ph.indexOf("prompter.js"));
  ["saveScript", "pickScript", "pickScriptFolder", "B.pickFolder", "readFolder", "__orosTakeFile(", '__orosTakeTarget("prompter")', '"newer"'].forEach((k) => assert.ok(pj.includes(k), k));
  for (const app of ["prompter"]) {
    const en = read(app + "/help.en.txt"), el = read(app + "/help.el.txt");
    const x = app === "prompter" ? ".orosscript" : ".orostone";
    assert.ok(en.includes(x) && el.includes(x), app);
  }
});
