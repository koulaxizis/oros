"use strict";
// Atelier wave B1: element links (ax.js normLink / setLink, item
// ext.lnk) and the web page export (atelier/webout.js), plus the
// links in the PDF (atelier/pdfout.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const AX = require(path.join(ROOT, "atelier/ax.js"));
const W = require(path.join(ROOT, "atelier/webout.js"));
const PDF = require(path.join(ROOT, "atelier/pdfout.js"));
T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

function design() {
  const d = AX.newDesign({ name: "Summer <sale> & co", w: 1080, h: 1080, pages: 2 }, 1000);
  const [p1, p2] = M.pagesInOrder(d).map((p) => p.id);
  AX.addItem(d, p1, { k: "text", tx: "Summer sale 2026, every shop in town", size: 60, x: 40, y: 40, w: 600, fc: "#FF0000" }, 1000);
  AX.addItem(d, p1, { k: "text", tx: "Glow", size: 50, x: 40, y: 600, w: 400, tfx: { type: "neon" } }, 1000);
  AX.addItem(d, p1, { k: "shape", shp: "star", g: { a: "#ff0000", b: "#0000ff", ang: 45 }, x: 10, y: 10, w: 80, h: 80, rot: 20 }, 1000);
  AX.addItem(d, p1, { k: "photo", shp: "circle", a: "a".repeat(64) + ".jpg", iw: 10, ih: 10, x: 0, y: 500, w: 200, h: 200 }, 1000);
  AX.addItem(d, p1, { k: "icon", ico: "star", sc: "#333333", x: 500, y: 500, w: 60, h: 60 }, 1000);
  AX.addItem(d, p2, { k: "text", tx: "<script>alert(1)</script>", size: 30, x: 40, y: 40, w: 900 }, 1000);
  return { d: M.normDoc(d), p1, p2 };
}
const html = (r) => Buffer.from(r.files.find((f) => f.name === "index.html").data).toString("utf8");
const file = (r, n) => r.files.find((f) => f.name === n);
function withLink(d, pred, l) {
  const it = d.items.find(pred);
  assert.ok(AX.setLink(it, l));
  return M.normDoc(d);
}

test("links: only web, e-mail, phone and page links get through", () => {
  const ok = {
    "example.com": "https://example.com/", " https://a.gr/x?y=1#z ": "https://a.gr/x?y=1#z", "http://a.gr": "http://a.gr/",
    "#p2": "#p2", "MAILTO:me@a.gr": "mailto:me@a.gr", "tel:+30 210 123 4567": "tel:+302101234567"
  };
  Object.keys(ok).forEach((v) => assert.equal(AX.normLink(v), ok[v], v));
  ["javascript:alert(1)", "JaVaScRiPt:x", " javascript:x", "data:text/html,<b>", "file:///etc/passwd", "ftp://a.gr", "//evil.com",
    "https://u:p@a.gr", "#p0", "#top", "mailto:<x>", "tel:abc", "a b.gr", "vbscript:x", "https://", 5, null].forEach((v) => assert.equal(AX.normLink(v), "", String(v)));
  assert.ok(!/"/.test(AX.normLink('https://a.gr/"><x')));
});

test("links: kept in the item's ext (R39), removed cleanly, survive a sync", () => {
  const { d } = design();
  const it = d.items.find((i) => i.ax.k === "icon");
  assert.equal(AX.setLink(it, "javascript:x"), false);
  assert.equal(it.ext, undefined);
  assert.ok(AX.setLink(it, "example.com"));
  assert.deepEqual(it.ext, { lnk: "https://example.com/" });
  assert.equal(AX.linkOf(M.normItem(it)), "https://example.com/");      // kept by normItem
  it.ext.other = 1;
  assert.ok(AX.setLink(it, ""));
  assert.deepEqual(it.ext, { other: 1 });                                // other keys stay
  assert.ok(AX.setLink(it, ""));
  delete it.ext.other; AX.setLink(it, "");
  assert.equal(it.ext, undefined);
  // a hand-made bad link in synced data is never used
  it.ext = { lnk: "javascript:alert(1)" };
  assert.equal(AX.linkOf(M.normItem(it)), "");
});

test("web page: the files, no script, a strict CSP, title and description", () => {
  const { d } = design();
  const r = W.build(d, { title: d.name, lang: "el", credits: ["Photo: A <b> by B"] }, {});
  const names = r.files.map((f) => f.name);
  ["index.html", "style.css", "fonts/sans-r.ttf", "fonts/README.txt"].forEach((n) => assert.ok(names.includes(n), n));
  const h = html(r);
  assert.ok(!/<script/i.test(h), "no script tag");
  assert.ok(!/\son[a-z]+=/i.test(h), "no event handlers");
  assert.ok(!/\sstyle=/i.test(h), "no inline styles (CSP)");
  assert.match(h, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; font-src 'self'; style-src 'self'/);
  assert.match(h, /<html lang="el">/);
  assert.match(h, /<title>Summer &lt;sale&gt; &amp; co<\/title>/);
  assert.match(h, /<meta name="description" content="Summer sale 2026, every shop in town Glow/);
  assert.match(h, /<p>Photo: A &lt;b&gt; by B<\/p>/);
  assert.ok(!h.includes("<script>alert(1)"));
  assert.ok(h.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.equal((h.match(/<section class="pg"/g) || []).length, 2);
  assert.equal((h.match(/<g\b/g) || []).length, (h.match(/<\/g>/g) || []).length);
  assert.equal((h.match(/<text\b/g) || []).length, (h.match(/<\/text>/g) || []).length);
  const css = Buffer.from(file(r, "style.css").data).toString();
  assert.match(css, /@font-face\{font-family:"f-sans-r";src:url\("fonts\/sans-r\.ttf"\)/);
  assert.ok(Buffer.from(file(r, "fonts/sans-r.ttf").data).equals(fs.readFileSync(path.join(ROOT, "vendor/noto/NotoSans-Regular.ttf"))));
});

test("web page: texts are real text with their spaces; effect copies are hidden from readers", () => {
  const { d } = design();
  const h = html(W.build(d, {}, {}));
  // the words of the first text, read in order, spaces included
  const first = h.match(/<text font-family="[^"]*" font-size="60" fill="#ff0000">(.*?)<\/text>/)[1];
  assert.equal(first.replace(/<[^>]+>/g, ""), "Summer sale 2026, every shop in town");
  // neon: two blurred passes (picture) + one sharp readable copy
  const glow = h.match(/<text[^>]*font-size="50"[^>]*>.*?<\/text>/g);
  assert.equal(glow.length, 1);
  assert.ok(!/aria-hidden/.test(glow[0]));
  assert.equal(W.plan(d, M.pagesInOrder(d).map((p) => p.id)).find((p) => p.kind === "textfx") !== undefined, true);
  // an outline effect: the outline copy is aria-hidden, the fill is not
  const d2 = JSON.parse(JSON.stringify(d));
  d2.items.find((i) => i.ax.tx === "Glow").ax.tfx = { type: "outline" };
  const h2 = html(W.build(M.normDoc(d2), {}, {}));
  const copies = h2.match(/<text[^>]*font-size="50"[^>]*>/g);
  assert.equal(copies.length, 2);
  assert.match(copies[0], /aria-hidden="true"/);
  assert.ok(!/aria-hidden/.test(copies[1]));
});

test("web page: vectors, pictures cut to their shape, gradients", () => {
  const { d, p1, p2 } = design();
  const P = W.plan(d, [p1, p2]);
  const photo = P.find((p) => p.kind === "photo");
  assert.ok(photo && W.needsPicture(photo));
  const pics = {};
  pics[photo.id] = { data: new Uint8Array([1, 2, 3]), fmt: "JPEG", x: 0, y: 0, w: 200, h: 200 };
  const glow = P.find((p) => p.kind === "textfx");
  pics[glow.id] = { data: new Uint8Array([4, 5]), fmt: "PNG", x: -glow.pad, y: -glow.pad, w: 10, h: 10 };
  const r = W.build(d, {}, { plan: P, pictures: pics });
  assert.equal(r.pictures, 2);
  const h = html(r);
  const jpg = r.files.find((f) => /^img\/\d+\.jpg$/.test(f.name));
  assert.deepEqual([...jpg.data], [1, 2, 3]);
  assert.match(h, new RegExp('<image href="' + jpg.name.replace(".", "\\.") + '"[^>]* clip-path="url\\(#c1-\\d+\\)"'));
  assert.match(h, /<clipPath id="c1-\d+"><path d="M/);
  assert.match(h, /<linearGradient id="g1-\d+" gradientUnits="userSpaceOnUse"/);
  assert.match(h, /fill="url\(#g1-\d+\)"/);
  assert.match(h, /transform="rotate\(20 50 50\) translate\(10 10\)"/);
  // icons are paths from the library, drawn with their stroke colour
  assert.match(h, /stroke="#333333" stroke-width="2"/);
});

test("web page: links wrap their element; page links only to pages in the file", () => {
  let { d, p1 } = design();
  d = withLink(d, (i) => i.ax.k === "icon", "#p2");
  d = withLink(d, (i) => i.ax.tx && i.ax.tx.indexOf("Summer") === 0, "shop.example.com/sale?a=1&b=2");
  let h = html(W.build(d, {}, {}));
  assert.match(h, /<a href="#p2"><g transform="translate\(500 500\)">/);
  assert.match(h, /<a href="https:\/\/shop\.example\.com\/sale\?a=1&amp;b=2" rel="noopener"><g/);
  assert.match(h, /<section class="pg" id="p2">/);
  // only page 1 in the file: the page link is left out, the web link stays
  h = html(W.build(d, { pages: [p1] }, {}));
  assert.ok(!h.includes('href="#p2"'));
  assert.ok(h.includes('href="https://shop.example.com/sale?a=1&amp;b=2"'));
  // a bad link in the data is never written
  const bad = JSON.parse(JSON.stringify(d));
  bad.items.find((i) => i.ax.k === "icon").ext = { lnk: "javascript:alert(1)" };
  assert.ok(!html(W.build(M.normDoc(bad), {}, {})).includes("javascript"));
});

test("PDF: an element's link is a clickable area; page links go to that page", () => {
  let { d, p1, p2 } = design();
  d = withLink(d, (i) => i.ax.k === "icon", "#p2");
  d = withLink(d, (i) => i.ax.tx && i.ax.tx.indexOf("Summer") === 0, "https://example.com/x");
  const { jsPDF } = require(path.join(ROOT, "vendor/jspdf.umd.min.js"));
  const png = fs.readFileSync(path.join(ROOT, "icons/icon-192.png"));
  const plan = PDF.plan(d, [p1, p2]), pics = {};
  plan.filter(PDF.needsPicture).forEach((p) => { pics[p.id] = { data: new Uint8Array(png), fmt: "PNG", x: -p.pad, y: -p.pad, w: 10, h: 10 }; });
  const out = PDF.build(d, { pages: [p1, p2] }, { jsPDF, pictures: pics, plan }).output();
  assert.match(out, /\/URI \(https:\/\/example\.com\/x\)/);
  assert.match(out, /\/Subtype \/Link/);
  assert.ok((out.match(/\/Subtype \/Link/g) || []).length >= 2);
  // the box around a turned element
  const b = PDF.linkBox({ t: "rect", x: 0, y: 0, w: 100, h: 0.5, rot: 90 });
  assert.ok(Math.abs(b.w - 0.5) < 1e-6 && Math.abs(b.h - 100) < 1e-6 && Math.abs(b.x - 49.75) < 1e-6);
});
