// Synthetic books for the house style and automatic layout tests
// (layout/house.js, layout/autolay.js): Greek-looking filler text,
// nothing from a real book.
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
T.allKeys().forEach((k) => {
  if (T.isLoaded(k)) return;
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

const WORDS = "η θάλασσα ήταν ήσυχη εκείνο το βράδυ και οι γλάροι κοιμόνταν πάνω στην παλιά προβλήτα".split(" ");
function words(n, k) { const a = []; for (let i = 0; i < n; i++) a.push(WORDS[(i * 7 + k) % WORDS.length]); return a.join(" ") + "."; }

// A book: one title page, then chapters, each on a new odd page with
// its title at the top, a first paragraph without an indent and body
// paragraphs; a centred scene break; a small note at the end.
function book(name, chapters, bodySize, opt) {
  opt = opt || {};
  const d = M.newDoc({ name, pages: 1 }, 1);
  d.setup.w = 140 * 72 / 25.4; d.setup.h = 210 * 72 / 25.4; d.setup.facing = 1;
  d.setup.mt = d.setup.mb = d.setup.mi = d.setup.mo = 18 * 72 / 25.4;
  d.pstyles.push(
    { id: "ps-tb", m: 1, name: "Text", base: "ps-base", font: "serif", size: bodySize, lead: bodySize * 1.6, align: "j", fi: 12 },
    { id: "ps-tf", m: 1, name: "Text first", base: "ps-tb", fi: 0 },
    { id: "ps-tt", m: 1, name: "Story title", base: "ps-base", font: "serif", size: 18, lead: 22, align: "c", sa: 20 },
    { id: "ps-sc", m: 1, name: "Scene", base: "ps-tb", align: "c", fi: 0 },
    { id: "ps-nt", m: 1, name: "Small", base: "ps-tb", size: 8, lead: 10, fi: 0 },
    { id: "ps-bt", m: 1, name: "Book title", base: "ps-base", font: "serif", size: 24, lead: 28, align: "c" }
  );
  const mg = M.margins(d, "R"), mb = { x: mg.l, y: mg.t, w: d.setup.w - mg.l - mg.r, h: d.setup.h - mg.t - mg.b };
  const pages = [M.pagesInOrder(d)[0]];
  function page() { const p = { id: M.newId("pg"), m: 1, pos: pages[0].pos + pages.length * 1024, ms: pages[0].ms }; pages.push(p); d.pages.push(p); return p; }
  function frame(p, sid, seq) { d.items.push({ id: M.newId("it"), m: 1, t: "text", pg: p.id, x: mb.x, y: mb.y, w: mb.w, h: mb.h, story: sid, seq, z: 1 }); }
  d.stories.push({ id: "st-front", m: 1, paras: [{ ps: "ps-bt", runs: [{ t: name }] }] });
  frame(pages[0], "st-front", 1);
  if (opt.isbn) {
    // page 2: the copyright page, with the ISBN
    d.stories.push({ id: "st-copy", m: 1, paras: [{ ps: "ps-nt", runs: [{ t: "© " + name }] }, { ps: "ps-nt", runs: [{ t: "ISBN 978-618-00-0000-" + chapters }] }] });
    frame(page(), "st-copy", 1);
  } else page();   // a blank page 2
  if (opt.toc) {
    // page 3: the contents
    const toc = [{ ps: "ps-tt", runs: [{ t: "Contents" }] }];
    for (let c = 0; c < chapters; c++) toc.push({ ps: "ps-tb", runs: [{ t: "Chapter " + (c + 1) + "\t" + (5 + c * 4) }] });
    d.stories.push({ id: "st-toc", m: 1, paras: toc });
    frame(page(), "st-toc", 1);
  }
  for (let c = 0; c < chapters; c++) {
    if (pages.length % 2 === 1) page();   // the next page is odd
    const sid = "st-c" + c;
    const paras = [{ ps: "ps-tt", runs: [{ t: "Chapter " + (c + 1) }] }, { ps: "ps-tf", runs: [{ t: words(60, c) }] }];
    for (let k = 0; k < 8; k++) paras.push({ ps: "ps-tb", runs: [{ t: words(70, c + k) }] });
    paras.push({ ps: "ps-sc", runs: [{ t: "* * *" }] });
    paras.push({ ps: "ps-tb", runs: [{ t: words(50, c + 3) }] });
    if (c === chapters - 1) paras.push({ ps: "ps-nt", runs: [{ t: "A small note." }] });
    d.stories.push({ id: sid, m: 1, paras });
    for (let k = 0; k < 3; k++) frame(page(), sid, k + 1);
  }
  page();   // a colophon page at the back
  d.stories.push({ id: "st-back", m: 1, paras: [{ ps: "ps-nt", runs: [{ t: "Printed somewhere." }] }] });
  frame(pages[pages.length - 1], "st-back", 1);
  return M.normDoc(d);
}

module.exports = { book, words, WORDS };
