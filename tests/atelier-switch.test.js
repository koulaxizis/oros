// Atelier wave CV-2b: Magic Switch — Resize and translate. The text
// lines of a design go to the shared Translate panel and come back into
// copies in each size (atelier/relayout.js textSegments / translated,
// atelier/io.js switchCopies).
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const RL = require("../atelier/relayout.js");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

function design() {
  return {
    setup: { w: 1080, h: 1080 },
    items: [
      { id: "t1", t: "text", x: 100, y: 100, w: 880, h: 120, ax: { k: "text", tx: "Summer sale\n\n  Everything must go ", size: 48 }, ext: { runs: [{ n: 11 }, { n: 22 }], kern: 1 } },
      { id: "s1", t: "rect", x: 0, y: 0, w: 1080, h: 80, ax: { k: "shape" } },
      { id: "t2", t: "text", x: 100, y: 900, w: 400, h: 60, ax: { k: "text", tx: "www.example.org" } }
    ]
  };
}

test("textSegments lists the non-empty lines of the texts, in order", () => {
  const s = RL.textSegments(design());
  assert.deepEqual(s.segs, ["Summer sale", "Everything must go", "www.example.org"]);
  assert.deepEqual(s.map, [{ id: "t1", line: 0 }, { id: "t1", line: 2 }, { id: "t2", line: 0 }]);
  assert.deepEqual(RL.textSegments({ items: [{ id: "x", ax: { k: "shape" } }] }).segs, []);
});

test("translated puts each line back, keeps spacing, drops runs that no longer fit, leaves the original alone", () => {
  const d = design(), s = RL.textSegments(d);
  const c = RL.translated(d, s.map, ["Καλοκαιρινές\nεκπτώσεις", "Όλα πρέπει να φύγουν", ""]);
  const t1 = c.items.find((i) => i.id === "t1"), t2 = c.items.find((i) => i.id === "t2");
  assert.equal(t1.ax.tx, "Καλοκαιρινές εκπτώσεις\n\n  Όλα πρέπει να φύγουν ");
  assert.equal(t1.ext.runs, undefined);
  assert.equal(t1.ext.kern, 1);
  assert.equal(t2.ax.tx, "www.example.org", "an empty answer keeps the line");
  assert.equal(d.items[0].ax.tx, "Summer sale\n\n  Everything must go ");
  assert.ok(d.items[0].ext.runs, "the original keeps its runs");
});

test("a translated copy relays into each size with its text re-measured", () => {
  const d = design(), s = RL.textSegments(d);
  const c = RL.translated(d, s.map, ["A", "B", "C"]);
  let measured = 0;
  const r = RL.relayout(c, 1080, 1920, { unit: "px", textHeight: (it) => { measured++; return it.ax.tx.split("\n").length * 10; } });
  assert.equal(r.setup.h, 1920);
  assert.ok(measured >= 2);
  assert.equal(r.items.find((i) => i.ax.k === "text" && /A/.test(i.ax.tx)).h, 30);
});

test("wiring: the Resize dialog's translate option, the shared panel, strings EN, EL, DE", () => {
  const IO = read("atelier/io.js"), P = read("translate/panel.js"), C = read("atelier/core.js"), DE = read("i18n/de/atelier.js");
  ["function switchCopies(sizes)", "RL.textSegments(src)", "RL.translated(cur, tx.map, res.segments || [])", '"../translate/panel.js"',
   "if (tr && copies) { close(); switchCopies(s); return; }", 't("resize.translate")'].forEach((s) => assert.ok(IO.includes(s), s));
  assert.ok(P.includes("a.run(segs ? { segments: r.segments, to: to } : { text: r.text, to: to });"));
  ["resize.translate", "resize.goTr", "resize.trMake", "resize.copyLang", "resize.same", "resize.noText", "resize.trFail"].forEach((k) => {
    assert.equal(C.split('"' + k + '"').length - 1, 2, k + " EN + EL");
    assert.ok(DE.includes('"' + k + '"'), k + " DE");
  });
});
