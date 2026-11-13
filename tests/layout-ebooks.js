// Synthetic e-books for the EPUB export (LY-EPUB, wave L7 E2): used by
// tests/layout-epub.test.js and by the CI job that runs the official
// EPUBCheck (.github/scripts/epub-samples.js). Made-up text only: the
// books of the corpus never go into the repository.
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const O = require(path.join(ROOT, "layout/outprof.js"));
const E = require(path.join(ROOT, "layout/epub.js"));
const Z = require(path.join(ROOT, "atelier/zip.js"));

let fontsReady = false;
function fonts() {
  if (fontsReady) return;
  T.allKeys().forEach((k) => {
    const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
    T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  });
  fontsReady = true;
}

// A small solid PNG (w × h, one colour), made here so no picture file is needed.
function png(w, h, rgb) {
  const crcT = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let x = 0xFFFFFFFF; for (const v of b) x = crcT[(x ^ v) & 0xFF] ^ (x >>> 8); return (x ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

const PB = "9786185321000", EB = "9786185321017";
function pubData() {
  return { titles: [{ id: "t1", m: 5, t: "Η θάλασσα του Βορρά", sub: "Μυθιστόρημα", ser: "Βόρειες ιστορίες", sn: 2, lang: "Ελληνικά", rel: "2026-11-13",
    ppl: [{ r: "a", n: "Άννα Παπαδοπούλου" }, { r: "t", n: "Νίκος Γεωργίου" }, { r: "i", n: "Ελένη Δήμου" }],
    blurb: "Ένα καλοκαίρι στο νησί, μια βάρκα & ένα μυστικό <παλιό>.", kw: "θάλασσα, νησί, καλοκαίρι",
    fmts: [{ id: "f-pb", k: "pb", isbn: PB, price: 14 }, { id: "f-eb", k: "eb", isbn: EB, price: 6.99 }] }],
    set: { cur: "EUR", imp: "Εκδόσεις Δοκιμής" }, tombs: {} };
}

// A novel: colophon, contents, a part, three chapters (one runs over
// three pages through two threaded frames), a picture with alt text
// and a caption, a decorative ornament, a list, a note mark, a
// character style, a page-number field on the master, an empty page.
function novel(opts) {
  fonts();
  opts = opts || {};
  const d = M.newDoc({ name: "Η θάλασσα", w: 400, h: 600, pages: 9, facing: 1 }, 1);
  const pg = M.pagesInOrder(d);
  d.setup.ext = Object.assign({ pub: "t1", lang: "el" }, opts.ext || {});
  d.pstyles.push({ id: "ps-hspart", m: 1, name: "Part", base: "ps-base", size: 20, align: "c", ext: { brk: "odd" } });
  d.pstyles.push({ id: "ps-chap", m: 1, name: "Chapter", base: "ps-base", size: 16, b: 1, sa: 12, ext: { sec: 1, brk: "page", kwn: 1 } });
  d.pstyles.push({ id: "ps-sub", m: 1, name: "Section", base: "ps-base", size: 12, i: 1, ext: { lvl: 3 } });
  d.pstyles.push({ id: "ps-txt", m: 1, name: "Text", base: "ps-base", size: 11, align: "j", fi: 12, ext: { hyph: 1 } });
  d.pstyles.push({ id: "ps-li", m: 1, name: "List", base: "ps-txt", bul: 1, li: 14, fi: 0 });
  d.pstyles.push({ id: "ps-pcap", m: 1, name: "Picture caption", base: "ps-base", size: 9, i: 1, align: "c" });
  d.cstyles.push({ id: "cs-name", m: 1, name: "Name", caps: 1, track: 50 });
  d.swatches.push({ id: "sw-sea", m: 1, name: "Sea", mode: "rgb", v: [20, 80, 140] });
  d.cstyles.push({ id: "cs-sea", m: 1, name: "Sea", color: "sw-sea" });
  let z = 1;
  const frame = (i, id, story, extra) => d.items.push(Object.assign({ id: "it-" + id, m: 1, t: "text", pg: pg[i].id, x: 40, y: 40, w: 320, h: 500, story, seq: 1, z: z++ }, extra || {}));
  const story = (id, paras, ext) => d.stories.push(Object.assign({ id: "st-" + id, m: 1, paras }, ext ? { ext } : {}));
  story("col", [{ ps: "ps-base", runs: [{ t: "© 2026 Εκδόσεις Δοκιμής" }] }, { ps: "ps-base", runs: [{ t: "ISBN 978-618-5321-00-0" }] }]);
  frame(0, "col", "st-col");
  story("toc", [{ ps: "ps-base", runs: [{ t: "Μέρος πρώτο\t3" }] }, { ps: "ps-base", runs: [{ t: "Η αρχή\t4" }] }], { hs: "toc" });
  frame(1, "toc", "st-toc");
  story("part", [{ ps: "ps-hspart", runs: [{ t: "Μέρος πρώτο" }] }]);
  frame(2, "part", "st-part");
  const long = "Η θάλασσα ήταν ήσυχη εκείνο το πρωί, και η βάρκα περίμενε στο μόλο. ".repeat(40);
  story("c1", [
    { ps: "ps-chap", runs: [{ t: "Η αρχή" }] },
    { ps: "ps-txt", runs: [{ t: "Η " }, { t: "Μαρία", cs: "cs-name" }, { t: " κοίταξε τη " }, { t: "θάλασσα", cs: "cs-sea" }, { t: " και χαμογέλασε" }, { t: "1", ext: { sup: 1 } }, { t: ". " + long }] },
    { ps: "ps-sub", runs: [{ t: "Το λιμάνι" }] },
    { ps: "ps-txt", runs: [{ t: "Στο λιμάνι είχε ", i: 1 }, { t: "πολύ", b: 1 }, { t: " κόσμο & φασαρία <όπως πάντα>.\nΜια νέα γραμμή." }] },
    { ps: "ps-li", runs: [{ t: "ψωμί" }] },
    { ps: "ps-li", runs: [{ t: "ελιές" }] },
    { ps: "ps-txt", runs: [{ t: long }] }
  ]);
  frame(3, "c1a", "st-c1", { seq: 1 });
  frame(4, "c1b", "st-c1", { seq: 2 });
  frame(5, "c1c", "st-c1", { seq: 3 });
  // a picture with alt text and its caption on page 7, an ornament
  d.items.push({ id: "it-pic", m: 1, t: "img", pg: pg[6].id, x: 40, y: 200, w: 320, h: 240, a: "a".repeat(64) + ".png", iw: 40, ih: 30, z: z++, ext: { alt: "Μια βάρκα στο μόλο, το πρωί." } });
  story("cap", [{ ps: "ps-pcap", runs: [{ t: "Η βάρκα του παππού." }] }]);
  frame(6, "cap", "st-cap", { y: 446, h: 30 });
  d.items.push({ id: "it-orn", m: 1, t: "img", pg: pg[6].id, x: 180, y: 500, w: 40, h: 20, a: "b".repeat(64) + ".png", iw: 40, ih: 20, z: z++, ext: { deco: 1 } });
  story("c2", [{ ps: "ps-chap", runs: [{ t: "Το νησί" }] }, { ps: "ps-txt", runs: [{ t: "Το νησί φάνηκε στον ορίζοντα." }] }]);
  frame(6, "c2", "st-c2", { h: 150 });
  story("c3", [{ ps: "ps-chap", runs: [{ t: "Το τέλος" }] }, { ps: "ps-txt", runs: [{ t: "Και έτσι τελείωσε το καλοκαίρι." }] }]);
  frame(7, "c3", "st-c3");
  // page 9 stays empty; a page number on the master; a shape
  if (d.masters[0]) {
    d.stories.push({ id: "st-pn", m: 1, paras: [{ ps: "ps-base", runs: [{ f: "pn" }] }] });
    d.items.push({ id: "it-pn", m: 1, t: "text", pg: d.masters[0].id, x: 180, y: 560, w: 40, h: 20, story: "st-pn", seq: 1, z: z++ });
  }
  d.items.push({ id: "it-box", m: 1, t: "rect", pg: pg[2].id, x: 10, y: 10, w: 20, h: 20, z: z++ });
  return M.normDoc(d);
}

function images() {
  return {
    "it-pic": { data: png(40, 30, [20, 80, 140]), type: "image/png", w: 40, h: 30 },
    "it-orn": { data: png(40, 20, [200, 160, 40]), type: "image/png", w: 40, h: 20 }
  };
}

function fontFiles(key) {
  const parts = T.faceParts(key);
  return parts.length ? parts.map((p) => ({ data: p.bytes(), range: p.range })) : null;
}
function sha1(b) { return Promise.resolve(new Uint8Array(crypto.createHash("sha1").update(Buffer.from(b)).digest())); }

// The EPUB of a document, as the Layout export makes it.
function epub(doc, opts) {
  opts = opts || {};
  const data = opts.data === undefined ? pubData() : opts.data;
  const prof = Object.assign({ id: "op-epub", k: "epub", fmt: "", blank: 1, toc: 1, q: "screen" }, opts.prof || {});
  const ed = O.edition(doc, prof, data), d = ed.doc;
  const L = R.computeLayout(d), pub = ed.pub;
  const meta = pub ? { title: pub.t, sub: pub.sub, ser: pub.ser, sn: pub.sn, lang: O.lang(d, pub), ppl: pub.ppl, isbn: ed.isbn, printIsbn: ed.printIsbn,
    publisher: data && data.set && data.set.imp, date: pub.rel, desc: pub.blurb, kw: pub.kw } : { title: d.name, lang: O.lang(d, null) };
  const pages = O.pagesFor(d, prof);
  if (prof.fx) {
    // fixed layout: a plain picture stands for each page's render
    const backgrounds = {};
    pages.forEach((id) => { backgrounds[id] = { data: png(Math.round(d.setup.w / 2), Math.round(d.setup.h / 2), [250, 250, 245]), type: "image/png" }; });
    return E.buildFixed(d, {
      L, pages, meta, modified: "2026-11-13T08:00:00Z", mode: prof.fx === 2 ? "image" : "text", backgrounds,
      cover: opts.cover === undefined ? null : opts.cover,
      fontFiles: prof.nf ? null : (opts.fontFiles || fontFiles), zip: Z, sha1
    });
  }
  return E.build(d, {
    L, pages, meta, modified: "2026-11-13T08:00:00Z",
    images: opts.images === undefined ? images() : opts.images,
    cover: opts.cover === undefined ? { data: png(160, 256, [240, 240, 230]), type: "image/png", w: 160, h: 256 } : opts.cover,
    fontFiles: prof.nf ? null : (opts.fontFiles || fontFiles), pageList: !prof.npl, zip: Z, sha1
  });
}

module.exports = { novel, images, pubData, png, epub, fontFiles, sha1, PB, EB };
