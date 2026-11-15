// orOS Writer: a document's own fonts (FM-4). writer/fonts.js keeps
// the choice in the synced "fonts" slice (docs["writer:<id>"]), writes
// the editor's CSS, and gives the PDF each face's TrueType files; a
// face the family does not have is left to the regular one.
// writer.js: the Page settings selects, the cheap check before the
// lazy load, headings marked for the PDF, strings in every language.
// Fixture: tests/fixtures/fonts/noto-serif-sub.ttf.
// Run: node --test tests/fonts-writer.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const T = require(path.join(ROOT, "designkit/text.js"));
const F = require(path.join(ROOT, "designkit/fonts.js"));
const FILE = "a".repeat(64) + ".ttf";
const FIX = fs.readFileSync(path.join(ROOT, "tests/fixtures/fonts/noto-serif-sub.ttf"));

function boot(init) {
  const store = Object.assign({}, init), styles = [];
  const urls = [];
  const fakeF = Object.assign({}, F, {
    library: () => Promise.resolve([{ file: FILE, family: "Noto Serif", sub: "Regular", b: false, i: false, fb: "serif" }]),
    fetcher: (u) => { urls.push(u); return Promise.resolve(u === "asset:" + FILE ? FIX.buffer.slice(FIX.byteOffset, FIX.byteOffset + FIX.byteLength) : null); }
  });
  const W = {
    orosDK: { text: T, fonts: fakeF },
    WriterFontsHost: { t: (k) => k, activeId: () => "d1" },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    addEventListener() {}
  };
  W.parent = W;
  const D = {
    head: { appendChild: (el) => { styles.push(el); } },
    createElement: () => ({ textContent: "" })
  };
  vm.runInNewContext(read("writer/fonts.js"), { window: W, document: D });
  return { W: W.WriterFonts, store, styles, urls };
}
// objects made in the vm context: compare their JSON
const j = (x) => JSON.parse(JSON.stringify(x));
const FAM = { id: "uf_" + "a".repeat(16), name: "Noto Serif", fb: "serif" };

test("get / set keep the choice in the fonts slice under writer:<id>", () => {
  const { W, store } = boot();
  assert.deepEqual(j(W.get("d1")), { body: null, head: null });
  assert.equal(W.set("d1", "body", FAM), true);
  let d = JSON.parse(store[F.cols.KEY]);
  assert.deepEqual(d.docs["writer:d1"].body, FAM);
  assert.equal(d.docs["writer:d1"].head, null);
  W.set("d1", "head", FAM);
  assert.deepEqual(j(W.get("d1")), { body: FAM, head: FAM });
  W.set("d1", "body", null);                       // back to Writer's font
  d = JSON.parse(store[F.cols.KEY]);
  assert.equal(d.docs["writer:d1"].body, null);
  assert.deepEqual(d.docs["writer:d1"].head, FAM);
  assert.equal(W.set("d1", "side", FAM), false);   // only body and head
  assert.equal(W.set("", "body", FAM), false);
});

test("apply: the editor's CSS names the family for text and headings, nothing when none", async () => {
  const { W, styles } = boot();
  await W.apply("d1");
  assert.equal(styles[0].textContent, "");
  W.set("d1", "body", FAM);
  assert.match(styles[0].textContent, /^\.rich-editor\{font-family:"wf-uf_a{16}",var\(--font-stack\)\}$/);
  W.set("d1", "head", FAM);
  assert.match(styles[0].textContent, /\.rich-editor h1,.*\.rich-editor h6\{font-family:"wf-uf_a{16}"/);
  assert.equal(styles.length, 1);                  // one style element, rewritten
});

test("pdf: the regular face's files with their letters; a missing bold is left to it", async () => {
  const { W, urls } = boot();
  W.set("d1", "body", FAM);
  W.set("d1", "head", FAM);
  const r = await W.pdf("d1");
  assert.ok(r.body && r.body.normal && r.body.normal.length === 1);
  assert.equal(r.body.bold, undefined);
  assert.equal(r.body.italic, undefined);
  assert.equal(r.head, r.body);                    // the same family is embedded once
  const p = r.body.normal[0];
  assert.equal(Buffer.from(p.b64, "base64").length, FIX.length);
  const α = "α".codePointAt(0);
  assert.ok(p.map[α] > 0);
  assert.ok(urls.every((u) => u === "asset:" + FILE));
});

test("pdf: no fonts, or a family whose file is not on this device, gives nothing", async () => {
  const { W } = boot();
  assert.deepEqual(j(await W.pdf("d1")), { body: null, head: null });
  W.set("d1", "body", { id: "uf_" + "b".repeat(16), name: "Elsewhere", fb: "sans" });
  assert.deepEqual(j(await W.pdf("d1")), { body: null, head: null });
});

test("choices: the collections by name, then the families on this device", async () => {
  let d = F.cols.normalize(null);
  const z = F.cols.add(d, "Zeta", 10, 0.1, "en"); d = z.d;
  d = F.cols.add(d, "Alpha", 20, 0.2, "en").d;
  d = F.cols.set(d, z.id, { id: "fs_lora", name: "Lora", fb: "serif" }, true, 30);
  const { W } = boot({ [F.cols.KEY]: JSON.stringify(d) });
  const g = await W.choices("en");
  assert.deepEqual(j(g.map((x) => x.name)), ["Zeta", "page.fontMine"]);   // Alpha is empty: left out
  assert.deepEqual(j(g[0].fams), [{ id: "fs_lora", name: "Lora", fb: "serif" }]);
  assert.deepEqual(j(g[1].fams), [FAM]);
});

test("writer.js: lazy load after a cheap check, selects, headings marked for the PDF", () => {
  const src = read("writer/writer.js");
  assert.match(src, /const WF_KEYS = \['oros-fonts-data', 'oros-remote-carry'\];/);
  assert.equal(F.cols.KEY, "oros-fonts-data");
  assert.match(src, /load\('\.\.\/designkit\/text\.js'\)/);
  assert.match(src, /load\('\.\.\/designkit\/fonts\.js'\)/);
  assert.match(src, /wfAfterRender\(\);\s+\/\/ the document's own fonts/);
  assert.match(src, /id="page-font-body"/);
  assert.match(src, /id="page-font-head"/);
  assert.match(src, /runsOf\(ch, \{ b: true, h: true \}\)/);
  assert.match(src, /const w = wfPick\(r, text\);/);
  // nothing of it at boot
  assert.doesNotMatch(read("writer/index.html"), /designkit\/|writer\/fonts\.js|"fonts\.js/);
});

test("strings: every page.font key in EN, EL and DE", () => {
  const src = read("writer/writer.js"), de = read("i18n/de/writer.js");
  const keys = ["page.fontBody", "page.fontHead", "page.fontDefault", "page.fontMine", "page.fontLoading", "page.fontHint"];
  keys.forEach((k) => {
    const n = src.split("'" + k + "':").length - 1;
    assert.equal(n, 2, k + " in EN and EL");
    assert.ok(de.indexOf('"' + k + '":') >= 0, k + " in DE");
  });
  ["writer/help.en.txt", "writer/help.el.txt", "i18n/de/help/writer.txt"].forEach((p) => {
    assert.match(read(p), /\(help:a\/settings\)/, p);
  });
});
