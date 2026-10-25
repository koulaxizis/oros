// Atelier release kit (atelier/kit.js, publisher wave P9): five
// ordinary designs from a book's details, cover kept at its shape,
// text colour readable on the background, nothing without a title.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const K = require(path.join(__dirname, "..", "atelier/kit.js"));
const M = require(path.join(__dirname, "..", "designkit/model.js"));

const SPEC = { title: "Sea Wolves", sub: "A novel", author: "Anna Writer", line: "Out 15 November", price: "€16.00",
               imprint: "Small Press", quote: "Wonderful.", bg: "#1F3A5F" };
const IMG = { a: "a".repeat(64) + ".jpg", iw: 1400, ih: 2100, nm: "cover.jpg" };

test("five designs, the right sizes, every one valid and named", () => {
  const docs = K.build(SPEC, IMG, 1000, { post: "Post" });
  assert.equal(docs.length, 5);
  assert.deepEqual(docs.map((d) => [Math.round(d.setup.w), Math.round(d.setup.h)]),
    [[1080, 1080], [1080, 1920], [1920, 600], [142, 510], [842, 1191]]);
  assert.equal(docs[0].name, "Sea Wolves · Post");
  assert.equal(docs[1].name, "Sea Wolves · story");
  docs.forEach((d) => assert.deepEqual(M.normDoc(d), d));
});

test("the cover keeps its shape and stays on the page; texts carry the details", () => {
  const docs = K.build(SPEC, IMG, 1000, {});
  docs.forEach((d) => {
    const pic = d.items.filter((i) => i.ax && i.ax.k === "photo")[0];
    assert.ok(pic, d.name + ": cover");
    assert.equal(pic.a, IMG.a);
    assert.ok(Math.abs(pic.w / pic.h - 2 / 3) < 0.01, d.name + ": shape");
    assert.ok(pic.x >= 0 && pic.y >= 0 && pic.x + pic.w <= d.setup.w + 0.5 && pic.y + pic.h <= d.setup.h + 0.5, d.name + ": inside");
    const texts = d.items.filter((i) => i.ax && i.ax.k === "text").map((i) => i.ax.tx).join(" | ");
    assert.match(texts, /Sea Wolves/);
    assert.match(texts, /Anna Writer/);
  });
  assert.match(docs[3].items.map((i) => (i.ax && i.ax.tx) || "").join(" "), /“Wonderful\.”/);
});

test("no picture: a panel in its place; no title: nothing", () => {
  const docs = K.build(SPEC, null, 1000, {});
  assert.ok(docs.every((d) => !d.items.some((i) => i.ax && i.ax.k === "photo")));
  assert.equal(K.build({ author: "X" }, IMG, 1000, {}).length, 0);
});

test("text colour follows the background", () => {
  assert.equal(K.inkFor("#1f3a5f"), "#ffffff");
  assert.equal(K.inkFor("#f5efe6"), "#111111");
  const light = K.build(Object.assign({}, SPEC, { bg: "#f5efe6" }), IMG, 1000, {});
  const t = light[0].items.filter((i) => i.ax && i.ax.k === "text" && i.ax.tx === "Sea Wolves")[0];
  assert.equal(t.ax.fc, "#111111");
  assert.equal(K.norm(Object.assign({}, SPEC, { bg: "red" })).bg, "#1f3a5f");
});

test("Atelier opens { releaseKit } and Publishing sends it", () => {
  const core = fs.readFileSync(path.join(__dirname, "..", "atelier/core.js"), "utf8");
  assert.match(core, /tg && tg\.releaseKit/);
  const html = fs.readFileSync(path.join(__dirname, "..", "atelier/index.html"), "utf8");
  assert.match(html, /<script src="kit\.js/);
  const app = fs.readFileSync(path.join(__dirname, "..", "publish/app.js"), "utf8");
  assert.match(app, /openAt\("atelier", \{ releaseKit:/);
});
