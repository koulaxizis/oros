// ============================================================
// orOS Scanner & PDF — wave 4: reading text (OCR), the invisible
// text layer, the search list and its provider.
// Tesseract itself runs only in the browser (checked in Chromium);
// these tests feed ocr.js what Tesseract returns.
// ============================================================
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const C = require(path.join(ROOT, "scanpdf/core.js"));
const O = require(path.join(ROOT, "scanpdf/ocr.js"));
const OPS = require(path.join(ROOT, "scanpdf/pdfops.js"));
const PROVIDER = require(path.join(ROOT, "scanpdf/search.js"));
const L = require(path.join(ROOT, "vendor/pdf-lib/pdf-lib.min.js"));
const fontkit = require(path.join(ROOT, "vendor/pdf-lib/fontkit.umd.min.js"));
const FONT = { fontkit, bytes: new Uint8Array(fs.readFileSync(path.join(ROOT, "vendor/noto/NotoSans-Regular.ttf"))) };
const JPG = new Uint8Array(fs.readFileSync(path.join(ROOT, "tests/fixtures/scanpdf/plain.jpg")));

async function streams(bytes) {
  const d = await L.PDFDocument.load(bytes);
  return d.getPages().map((p) => {
    const s = d.context.lookup(p.node.Contents());
    const arr = s instanceof L.PDFArray ? s.asArray().map((r) => d.context.lookup(r)) : [s];
    return arr.map((st) => {
      let b = Buffer.from(st.getContents ? st.getContents() : st.contents);
      try { b = zlib.inflateSync(b); } catch (e) { /* not compressed */ }
      return b.toString("latin1");
    }).join("\n");
  });
}
const count = (s, re) => (s.match(re) || []).length;
// a Tesseract-like result: one block, given paragraphs of lines of [text, conf, x0, y0, x1, y1]
function tess(paras, baseline) {
  return { blocks: [{ paragraphs: paras.map((lines) => ({ lines: lines.map((ws) => ({
    baseline: baseline || null,
    words: ws.map(([text, confidence, x0, y0, x1, y1]) => ({ text, confidence, bbox: { x0, y0, x1, y1 } }))
  })) })) }] };
}
// The centre of a placed word, back from its baseline start.
function centreOf(w, rec, S) {
  const a = w.A * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), bS = rec.words[0].b * S;
  return [w.x + (w.w / 2) * c - bS * s, w.y + (w.w / 2) * s + bS * c];
}

test("fixText: Greek mu instead of the micro sign, no control characters, NFC", () => {
  assert.equal(O.fixText("προτίµηση"), "προτίμηση");
  assert.equal(O.fixText("5µm"), "5µm", "a Latin micro sign stays");
  assert.equal(O.fixText(" a\u0000b  "), "ab");
  assert.equal(O.fixText("ά"), "ά");
  assert.equal(O.fixText(null), "");
});

test("wordsFrom: fractions of the picture, sure words only, lines and paragraphs, baseline", () => {
  const data = tess([
    [[["Invoice", 92, 100, 100, 300, 140], ["2026", 90, 320, 100, 420, 140]], [["Total", 91, 100, 200, 220, 236], ["%$#", 12, 240, 200, 260, 236]]],
    [[["Thanks", 88, 100, 400, 260, 440]]]
  ], { x0: 100, y0: 132, x1: 420, y1: 132 });
  const r = O.wordsFrom(data, 1000, 2000);
  assert.equal(r.text, "Invoice 2026\nTotal\n\nThanks");
  assert.equal(r.words.length, 4, "the unsure word is left out");
  assert.deepEqual(r.words[0], { t: "Invoice", x: 0.1, y: 0.05, w: 0.2, h: 0.02, b: 0.066, s: 0.02 });
  assert.equal(r.words[2].b, 0.118, "a baseline far off the word (above Total) falls back to its foot");
  assert.deepEqual(O.wordsFrom(null, 10, 10), { words: [], text: "" });
});

test("record + place: a word read on a page turned 0/90/180/270 lands where it was seen", () => {
  const W = 300, H = 500, S = Math.min(W, H);
  const box = { left: 0, top: 0, w: W, h: H };
  [0, 90, 180, 270].forEach((R) => {
    const found = { words: [{ t: "Hi", x: 0.2, y: 0.1, w: 0.3, h: 0.04, b: 0.132, s: 0.04 }], text: "Hi" };
    const rec = O.record(found, R, W, H, "ell+eng");
    assert.equal(rec.A, R);
    const g = { W, H, R, bx: 0, by: 0 }, D = C.dispSize(W, H, R);
    // on the page with /Rotate R
    const w = O.place(rec, box, g, false)[0];
    assert.equal(w.A, R);
    const c = centreOf(w, rec, S), v = C.toDisp(c[0], H - c[1], W, H, R);
    assert.ok(Math.abs(v[0] / D[0] - 0.35) < 1e-3 && Math.abs(v[1] / D[1] - 0.12) < 1e-3, "R " + R + ": " + v);
    assert.ok(Math.abs(w.w - 0.3 * D[0]) < 0.02, "it fills the width it covered");
    // drawn upright (Compress)
    const u = O.place(rec, box, g, true)[0], cu = centreOf(u, rec, S);
    assert.equal(u.A, 0);
    assert.ok(Math.abs(cu[0] / D[0] - 0.35) < 1e-3 && Math.abs((D[1] - cu[1]) / D[1] - 0.12) < 1e-3, "upright R " + R);
    assert.ok(u.y < cu[1], "the baseline is below the centre");
  });
  assert.deepEqual(O.place(null, box, { W, H, R: 0, bx: 0, by: 0 }, false), []);
});

test("place: on a picture page the words follow the picture, not the margins", () => {
  const img = { bytes: JPG, type: "jpg", w: 800, h: 600 };
  const srcs = { s: { kind: "image", img } }, prefs = { size: "a4", margin: "normal" };
  const p = { key: "a", src: "s", idx: 0, rot: 0 };
  const rec = O.record({ words: [{ t: "Mid", x: 0.45, y: 0.48, w: 0.1, h: 0.04, b: 0.515, s: 0.04 }] }, 0, 800, 600, "eng");
  const g = OPS.geom(L, srcs, p, prefs), w = OPS.wordsFor(L, srcs, p, prefs, rec, false)[0];
  const r = C.fitRect(800, 600, g.W, g.H, "normal"), c = centreOf(w, rec, Math.min(r.w, r.h));
  assert.ok(Math.abs(c[0] - g.W / 2) < 0.5 && Math.abs(c[1] - g.H / 2) < 0.5, "the picture's centre is the page's: " + c);
});

test("build: an invisible text layer under scanned and turned pages, Noto embedded", async () => {
  const img = { bytes: JPG, type: "jpg", w: 600, h: 800 };
  const srcs = { s: { kind: "image", img, scan: true } };
  const pages = [{ key: "a", src: "s", idx: 0, rot: 0 }, { key: "b", src: "s", idx: 0, rot: 90 }];
  const words = [{ t: "Τιμολόγιο", x: 0.1, y: 0.1, w: 0.4, h: 0.03, b: 0.125, s: 0.03 },
                 { t: "2026", x: 0.55, y: 0.1, w: 0.15, h: 0.03, b: 0.125, s: 0.03 }];
  const ocr = { "s:0": O.record({ words }, 0, 600, 800, "ell+eng") };
  await assert.rejects(OPS.build(L, srcs, pages, {}, { ocr }), (e) => e.code === "font");
  const out = await OPS.build(L, srcs, pages, {}, { ocr, font: FONT });
  const st = await streams(out);
  st.forEach((s, i) => {
    assert.equal(count(s, /\b3 Tr\b/g), 1, "render mode invisible, page " + (i + 1));
    assert.equal(count(s, /\bTj\b/g), 2, "one string per word");
    assert.equal(count(s, /\bTz\b/g), 2, "each word stretched to its width");
  });
  const tm = (s) => s.split("\n").filter((l) => / Tm$/.test(l));
  assert.ok(/^1 0 -?0 1 /.test(tm(st[0])[0]), "upright on the page it was read on");
  assert.deepEqual(tm(st[1]), tm(st[0]), "turned after reading: the words stay on the same spot of the unturned page, and /Rotate turns them with it");
  // read while turned: the words are drawn turned in the unturned page
  const turned = await streams(await OPS.build(L, srcs, pages.slice(1), {}, { ocr: { "s:0": O.record({ words }, 90, 600, 800, "ell+eng") }, font: FONT }));
  const m = tm(turned[0])[0].split(" ").map(Number);
  assert.ok(Math.abs(m[0]) < 1e-9 && m[1] === 1 && m[2] === -1 && Math.abs(m[3]) < 1e-9, "Tm turned 90: " + m);
  const d = await L.PDFDocument.load(out);
  assert.ok(d.context.enumerateIndirectObjects().some(([, o]) => o instanceof L.PDFDict && String(o.get(L.PDFName.of("BaseFont")) || "").includes("NotoSans")));
  // without text read, no layer and no font
  const plain = await streams(await OPS.build(L, srcs, pages.slice(0, 1), {}, {}));
  assert.equal(count(plain[0], /\bTr\b/g), 0);
});

test("fromImages: Compress keeps the text layer on the upright pictures", async () => {
  const rec = O.record({ words: [{ t: "Kept", x: 0.1, y: 0.1, w: 0.2, h: 0.03, b: 0.125, s: 0.03 }] }, 90, 400, 300, "eng");
  const srcs = { s: { kind: "image", img: { bytes: JPG, type: "jpg", w: 400, h: 300 }, scan: true } };
  const p = { key: "a", src: "s", idx: 0, rot: 90 };
  const g = OPS.geom(L, srcs, p, {}), D = C.dispSize(g.W, g.H, g.R);
  const words = OPS.wordsFor(L, srcs, p, {}, rec, true);
  assert.equal(words[0].A, 0);
  await assert.rejects(OPS.fromImages(L, [{ bytes: JPG, w: D[0], h: D[1], words }], {}), (e) => e.code === "font");
  const st = await streams(await OPS.fromImages(L, [{ bytes: JPG, w: D[0], h: D[1], words }, { bytes: JPG, w: 100, h: 100 }], { font: FONT }));
  assert.equal(count(st[0], /\b3 Tr\b/g), 1);
  assert.equal(count(st[1], /\bTr\b/g), 0, "a page without words has no layer");
});

test("search list: Files paths only, newest first, no doubles, capped", () => {
  let list = O.addToIndex(null, { p: "/internal/PDF/a.pdf", n: "a", t: "  hello\n world ", k: 2 }, 1000);
  assert.deepEqual(list, [{ p: "/internal/PDF/a.pdf", n: "a", t: "hello world", d: 1000, k: 2 }]);
  list = O.addToIndex(list, { p: "/internal/PDF/b.pdf", n: "b", t: "" }, 2000);
  list = O.addToIndex(list, { p: "/internal/PDF/a.pdf", n: "a2", t: "again" }, 3000);
  assert.deepEqual(list.map((e) => e.n), ["a2", "b"]);
  assert.deepEqual(O.addToIndex(list, { p: "https://x/y.pdf" }, 1), list, "only the orOS disk");
  for (let i = 0; i < 130; i++) list = O.addToIndex(list, { p: "/internal/PDF/" + i + ".pdf", n: String(i), t: "x".repeat(5000) }, i);
  assert.equal(list.length, O.INDEX_MAX > 300000 / 4100 ? Math.floor(300000 / 4100) : O.INDEX_MAX);
  assert.ok(JSON.stringify(list).length <= O.INDEX_BYTES);
  assert.equal(list[0].t.length, O.INDEX_TEXT);
  assert.deepEqual(O.cleanIndex([{ p: "/internal/x" }, { p: "/internal/x" }, null, { p: 5 }]).length, 1);
});

test("search provider: name and text, opens the PDF, leaves out what is gone from Files", async () => {
  const store = [{ p: "/internal/PDF/Invoice.pdf", n: "Invoice", t: "total 1.240,00", d: 5 },
                 { p: "/internal/PDF/Gone.pdf", n: "Gone", t: "", d: 4 }, { p: "/etc/x.pdf", n: "bad" }];
  const ctx = { q: "invoice", lang: "en", readJSON: (k) => (k === "oros-scanpdf-index" ? store : null) };
  assert.equal(PROVIDER.id, "scanpdf");
  assert.deepEqual(PROVIDER.keys, ["oros-scanpdf-index"]);
  const all = await PROVIDER.search(ctx);
  assert.deepEqual(all.map((h) => h.title), ["Invoice", "Gone"], "without Files: every listed PDF");
  assert.deepEqual(all[0], { id: "/internal/PDF/Invoice.pdf", title: "Invoice", text: "total 1.240,00", when: 5,
                             target: { paths: ["/internal/PDF/Invoice.pdf"] } });
  globalThis.orosFS = { stat: (p) => Promise.resolve(p.includes("Gone") ? null : { size: 1 }) };
  try {
    assert.deepEqual((await PROVIDER.search(ctx)).map((h) => h.title), ["Invoice"]);
  } finally { delete globalThis.orosFS; }
  assert.deepEqual(await PROVIDER.search({ readJSON: () => "junk" }), []);
});

test("wiring: ocr.js loaded in order and precached, Tesseract from orOS's own folder, Stop, strings, no Greek in code", () => {
  const html = read("scanpdf/index.html");
  const at = (s) => html.indexOf(s);
  assert.ok(at('src="scan.js') < at('src="ocr.js') && at('src="ocr.js') < at('src="pdfops.js'));
  assert.ok(html.includes('id="text-btn"') && html.includes('id="busy-stop"'));
  assert.ok(read("sw.js").includes('"scanpdf/ocr.js",'));
  const js = read("scanpdf/scanpdf.js");
  ['var OCR_BASE = "../vendor/tesseract/"', "workerBlobURL: false", "w.terminate()", '"pagehide", dropWorker',
   "send.open({ kind: \"text\"", "O.INDEX_KEY"].forEach((s) => assert.ok(js.includes(s), s));
  assert.ok(!/https?:\/\/[^"']*tesseract|cdn\.jsdelivr|unpkg/.test(js), "no outside server");
  const block = js.slice(js.indexOf("var STRINGS = ") + 14, js.indexOf("\n  };\n", js.indexOf("var STRINGS = ")) + 4);
  const T = new Function("return " + block)();
  ["btn.read", "ocr.title", "ocr.hint", "ocr.dl", "ocr.stop", "ocr.load", "ocr.page", "txt.title", "txt.copy", "txt.send",
   "save.read", "save.readHint", "idx.title", "idx.hint", "idx.forget"].forEach((k) => {
    assert.ok(T.en[k] && T.el[k], k);
  });
  ["scanpdf/ocr.js", "scanpdf/search.js"].forEach((f) => assert.ok(!/[Ͱ-Ͽἀ-῿]/.test(read(f)), f + " has no Greek"));
});
