// Layout book cover (designkit/cover.js, publisher wave P3): spine
// math, panel geometry, the vector barcode and the built document.
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../designkit/model.js");
const CV = require("../designkit/cover.js");

const MM = 72 / 25.4;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, (msg || "") + " " + a + " ≈ " + b);

test("the spine grows with pages and paper, the printer's figure wins", () => {
  assert.equal(CV.spineMm(240, 0.1), 12.5);
  assert.equal(CV.spineMm(241, 0.1), 12.6);
  assert.equal(CV.spineMm(0, 0.1), 0);
  assert.equal(CV.spineMm("abc", 0.1), 0);
  assert.equal(CV.paper("u80"), 0.1);
  assert.equal(CV.paper("nope"), 0);
  const d = CV.build({ w: 140, h: 210, pages: 240, sheet: 0.1, spine: "14" }, { now: 5 });
  near(d.setup.w, (280 + 14) * MM, "printer spine");
  assert.equal(d.setup.ext.cover.spine, 14);
});

test("panels sit side by side: flap, back, spine, front, flap", () => {
  const g = CV.geometry({ w: 140, h: 210, spine: 12, flap: 80, bleed: 3 });
  near(g.W, (2 * 140 + 12 + 160) * MM);
  near(g.back.x, 80 * MM);
  near(g.sp.x, 220 * MM);
  near(g.front.x, 232 * MM);
  near(g.flapR.x, 372 * MM);
  assert.equal(g.folds.length, 4);
  const plain = CV.geometry({ w: 140, h: 210, spine: 0, bleed: 3 });
  assert.equal(plain.flapL, null);
  assert.equal(plain.folds.length, 1, "no spine: one fold, no zero-width duplicate");
});

test("the barcode is the right EAN-13 and a valid path", () => {
  assert.equal(CV.isbn13("ISBN 0-306-40615-2"), "9780306406157");
  assert.equal(CV.isbn13("978-0-306-40615-7"), "9780306406157");
  assert.equal(CV.isbn13("9780306406158"), "");
  const bars = CV.ean13("9780306406157");
  assert.equal(bars.length, 95);
  const d = CV.barsPath("9780306406157", 0.9);
  // every run of 1s becomes one rectangle
  const runs = bars.match(/1+/g).length;
  assert.ok((d.match(/M/g) || []).length >= runs);
  assert.ok(d.indexOf(" 1L") > 0 && d.indexOf("0.9") > 0, "guards full height, others short");
  assert.equal(CV.barsPath("123"), "");
});

test("a cover is one page of normal items that survive normDoc", () => {
  const spec = {
    name: "Cover", w: 140, h: 210, pages: 240, sheet: 0.1, bleed: 3,
    title: "Άνθρωποι που αξίζει να περιμένεις", author: "Βασίλης Τσεβάς", sub: "Μυθιστόρημα",
    blurb: "Line one\nLine two", imprint: "Press", isbn: "978-0-306-40615-7", price: "€14,90",
    img: { a: "a".repeat(64) + ".jpg", iw: 1600, ih: 2400, nm: "front.jpg" }
  };
  const d = CV.build(spec, { now: 7, lang: "el" });
  assert.deepEqual(M.normDoc(JSON.parse(JSON.stringify(d))), d, "already canonical");
  assert.equal(d.pages.length, 1);
  assert.equal(d.pages[0].ms, "", "no master items on a cover");
  near(d.setup.w, (280 + 12.5) * MM);
  near(d.setup.h, 210 * MM);
  const types = d.items.map((i) => i.t);
  assert.equal(types.filter((t) => t === "img").length, 1);
  assert.equal(types.filter((t) => t === "path").length, 1);
  const pic = d.items.find((i) => i.t === "img");
  assert.equal(pic.a, spec.img.a);
  near(pic.x, 152.5 * MM, "picture starts at the front panel");
  const spine = d.items.find((i) => i.rot === 90);
  assert.ok(spine, "spine text turned");
  near(spine.x + spine.w / 2, (140 + 6.25) * MM, "spine text centred on the spine");
  const grp = d.items.find((i) => i.t === "path").grp;
  assert.ok(grp && d.items.filter((i) => i.grp === grp).length === 4, "barcode is one group");
  const texts = d.stories.map((s) => s.paras.map((p) => p.runs.map((r) => r.t).join("")).join("|")).join("\n");
  assert.match(texts, /ISBN 978-030640615-7/);
  assert.match(texts, /€14,90/);
  assert.match(texts, /9 {2}780306 {2}406157/);
  assert.match(texts, /Line one\|Line two/);
  assert.equal(d.guides.length, 2, "two fold guides: the spine edges");
  assert.ok(d.pstyles.some((p) => p.id === "ps-ctitle" && p.name.el === "Τίτλος εξωφύλλου"));
  assert.ok(d.swatches.some((s) => s.id === "sw-cover"));
});

test("a thin book gets no spine text, bad input never throws", () => {
  const d = CV.build({ w: 140, h: 210, pages: 24, sheet: 0.09, title: "Slim" }, { now: 1 });
  assert.ok(!d.items.some((i) => i.rot === 90));
  assert.ok(!d.items.some((i) => i.t === "path"), "no ISBN, no barcode");
  const z = CV.build({ w: "x", h: null, title: 5, img: { a: "../evil.jpg" }, isbn: "<b>" }, {});
  assert.equal(z.items.find((i) => i.t === "img").a, "");
  near(z.setup.w, 280 * MM);
});

test("the publisher's logo sits on the back cover and at the foot of the spine", () => {
  const logo = { a: "b".repeat(64) + ".png", iw: 500, ih: 500, nm: "logo.png" };
  const d = CV.build({ w: 140, h: 210, pages: 240, sheet: 0.1, title: "T", author: "A", imprint: "Press", logo }, { now: 3 });
  const logos = d.items.filter((i) => i.t === "img" && i.a === logo.a);
  assert.equal(logos.length, 2);
  assert.ok(logos.every((i) => i.fit === "fit"));
  const onSpine = logos.find((i) => i.x > 140 * MM && i.x < 152.5 * MM);
  assert.ok(onSpine, "one on the spine");
  const spineText = d.items.find((i) => i.rot === 90);
  assert.ok(spineText.y + spineText.h / 2 + spineText.w / 2 <= onSpine.y + 0.01, "spine text ends above the logo");
  const thin = CV.build({ w: 140, h: 210, pages: 60, sheet: 0.1, title: "T", logo }, { now: 3 });
  assert.equal(thin.items.filter((i) => i.a === logo.a).length, 1, "thin spine: back cover only");
});
