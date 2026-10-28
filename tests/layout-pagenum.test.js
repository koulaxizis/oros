// Layout: the first page number (LY-PN, setup.ext.pnStart): page-number
// fields show it plus the page's position; 1 when unset or out of range;
// a client without it shows 1, 2, 3 (ext is kept verbatim). Synthetic
// documents only.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

function doc(ext) {
  const d = M.newDoc({ name: "N", w: 300, h: 400, pages: 3, facing: 1 }, 1);
  if (ext) d.setup.ext = ext;
  M.pagesInOrder(d).forEach((p, i) => {
    d.stories.push({ id: "st-n" + i, m: 1, paras: [{ ps: "ps-body", runs: [{ f: "pn" }, { t: " / " }, { f: "pc" }] }] });
    d.items.push({ id: "it-n" + i, m: 1, t: "text", pg: p.id, x: 20, y: 360, w: 100, h: 20, story: "st-n" + i, seq: 1, z: 1 });
  });
  return M.normDoc(d);
}
function labels(d) {
  const L = R.computeLayout(d);
  return [0, 1, 2].map((i) => L.frames["it-n" + i].lines[0].runs.map((r) => r.t).join(" ").replace(/\s+/g, " ").trim());
}

test("page-number fields count from the first page number", () => {
  assert.deepEqual(labels(doc()), ["1 / 3", "2 / 3", "3 / 3"]);
  assert.deepEqual(labels(doc({ pnStart: 5 })), ["5 / 3", "6 / 3", "7 / 3"]);
  assert.deepEqual(labels(doc({ pnStart: 0 })), ["0 / 3", "1 / 3", "2 / 3"]);
  assert.equal(M.firstNumber(doc({ pnStart: 5 })), 5);
  assert.equal(M.firstNumber(doc({ pnStart: -2 })), 1);
  assert.equal(M.firstNumber(doc({ pnStart: 10000 })), 1);
  assert.equal(M.firstNumber(doc({ pnStart: "x" })), 1);
  assert.equal(M.firstNumber({}), 1);
  // kept through normalizing, as every ext field
  assert.equal(M.normDoc(JSON.parse(JSON.stringify(doc({ pnStart: 5 })))).setup.ext.pnStart, 5);
});
