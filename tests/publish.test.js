// Publishing: the data model's sync rules (OROS_BIBLE.md Part I,
// R5/R17/R26), ISBN math, the register and the barcode.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../publish/core.js");
const P = require("../publish/search.js");

const BLK = { id: "b1", p: "978-618-5321" };
function base() {
  let d = C.put(C.empty(), "blocks", BLK, 100);
  d = C.put(d, "titles", { id: "t1", t: "First", ppl: [{ r: "a", n: "Ann" }], fmts: [{ id: "f1", k: "pb", isbn: "9786185321000", price: 14.9 }] }, 110);
  d = C.put(d, "titles", { id: "t2", t: "Second", fmts: [{ id: "f2", k: "eb", isbn: "978-618-5321-01-7" }] }, 120);
  return d;
}

test("ISBN-13 and ISBN-10 check digits", () => {
  assert.equal(C.check13("978030640615"), "7");
  assert.equal(C.check10("030640615"), "2");
  assert.equal(C.check10("080442957"), "X");
  assert.deepEqual(C.parseIsbn("978-0-306-40615-7"), { ok: true, isbn: "9780306406157", why: "" });
  assert.deepEqual(C.parseIsbn("ISBN 0-306-40615-2"), { ok: true, isbn: "9780306406157", why: "" });
  assert.equal(C.parseIsbn("9780306406158").why, "check");
  assert.equal(C.parseIsbn("97803064061").why, "len");
  assert.equal(C.parseIsbn("1234567890128").why, "prefix");
  assert.equal(C.isbn10("9780306406157"), "0306406152");
  assert.equal(C.isbn10("9791234567896"), "");
});

test("a block gives its numbers in order and the register skips used ones", () => {
  assert.equal(C.parseBlock("978 618 5321").p, "978-618-5321");
  assert.equal(C.parseBlock("9786185321"), null, "no groups: the hyphens are needed");
  assert.equal(C.parseBlock("978-618-53"), null, "too short");
  assert.equal(C.parseBlock("978-618-532112"), null, "too long");
  assert.equal(C.parseBlock("977-618-5321"), null, "not 978/979");
  assert.equal(C.parseBlock("978-618-5321").size, 100);
  assert.equal(C.blockIsbn(BLK, 0), "9786185321000");
  assert.equal(C.blockIsbn(BLK, 100), "");
  const d = base();
  assert.equal(C.nextFree(d, "b1"), "9786185321024");
  assert.equal(C.nextFree(d, "b1", ["9786185321024"]), "9786185321031");
  const x = C.put(d, "isbnx", { id: "9786185321024", note: "old" }, 130);
  assert.equal(C.nextFree(x, "b1"), "9786185321031");
  const u = C.blockUsage(x, "b1");
  assert.equal(u.used, 3);
  assert.equal(u.free, 97);
  assert.equal(C.hyphen("9786185321017", d.blocks), "978-618-5321-01-7");
  assert.equal(C.hyphen("9780306406157", d.blocks), "9780306406157");
});

test("a full block offers nothing", () => {
  let d = C.put(C.empty(), "blocks", { id: "b", p: "978-618-53210" }, 1);
  for (let i = 0; i < 10; i++) d = C.put(d, "isbnx", { id: C.blockIsbn({ p: "978-618-53210" }, i) }, 2 + i);
  assert.equal(C.nextFree(d, "b"), "");
});

test("a number on two formats is a clash", () => {
  let d = base();
  assert.deepEqual(C.clashes(d), []);
  d = C.put(d, "titles", { id: "t3", t: "Third", fmts: [{ id: "f3", isbn: "9786185321000" }] }, 200);
  const c = C.clashes(d);
  assert.equal(c.length, 1);
  assert.equal(c[0].isbn, "9786185321000");
  assert.deepEqual(c[0].uses.map((u) => u.title).sort(), ["t1", "t3"]);
});

test("merge is symmetric and settles at once", () => {
  const a = base();
  const b = C.remove(C.put(base(), "titles", { id: "t1", t: "First, revised", fmts: [] }, 300), "titles", "t2", 310);
  const ab = C.serialize(C.merge(a, b)), ba = C.serialize(C.merge(b, a));
  assert.equal(ab, ba);
  assert.equal(C.serialize(C.merge(JSON.parse(ab), b)), ab);
  assert.equal(C.serialize(C.merge(b, b)), C.serialize(b));
  const m = JSON.parse(ab);
  assert.deepEqual(m.titles.map((x) => x.t), ["First, revised"]);
});

test("a delete wins over an older edit, a newer edit brings the title back", () => {
  const del = C.remove(base(), "titles", "t1", 400);
  assert.deepEqual(C.merge(base(), del).titles.map((x) => x.id), ["t2"]);
  const edited = C.put(base(), "titles", { id: "t1", t: "Back", fmts: [] }, 500);
  assert.ok(C.merge(del, edited).titles.some((x) => x.t === "Back"));
});

test("bad rows are dropped, never repaired with a fresh id or time", () => {
  const d = C.normalize({
    titles: [{ t: "no id" }, { id: "x", t: "" }, { id: "ok", t: "Fine", m: "y", st: "bad", rel: "2026-02-30",
      fmts: [{ id: "a", isbn: "123" }, { id: "a", isbn: "9780306406157" }, null], ppl: [{ n: "" }, { r: "zz", n: "Z" }], cov: "../../x.jpg" }],
    blocks: [{ id: "b", p: "nope" }], isbnx: [{ id: "9780306406158" }], tombs: { z: "bad" }
  });
  assert.equal(d.titles.length, 1);
  const tt = d.titles[0];
  assert.equal(tt.m, 0);
  assert.equal(tt.st, "idea");
  assert.equal(tt.rel, "");
  assert.equal(tt.cov, "");
  assert.deepEqual(tt.fmts.map((f) => [f.id, f.isbn]), [["a", ""]]);
  assert.deepEqual(tt.ppl, [{ r: "a", n: "Z" }]);
  assert.deepEqual(d.blocks, []);
  assert.deepEqual(d.isbnx, []);
  assert.deepEqual(d.tombs, {});
});

test("lists and fields of a later version ride along and merge", () => {
  const newer = JSON.parse(C.serialize(base()));
  newer.tasks = [{ id: "k1", m: 10, ttl: "t1", what: "proofs" }];
  newer.titles[0].shop = { id: 55 };
  const old = C.normalize(newer);
  assert.deepEqual(old.tasks, [{ id: "k1", m: 10, ttl: "t1", what: "proofs" }]);
  assert.deepEqual(old.titles[0].shop, { id: 55 });
  const later = JSON.parse(JSON.stringify(newer));
  later.tasks[0] = { id: "k1", m: 20, ttl: "t1", what: "print" };
  assert.equal(C.merge(old, later).tasks[0].what, "print");
  assert.equal(C.serialize(C.merge(old, later)), C.serialize(C.merge(later, old)));
  const gone = C.normalize(Object.assign({}, newer, { tombs: { k1: 30 } }));
  assert.deepEqual(gone.tasks, []);
});

test("list, search order and what is missing", () => {
  let d = base();
  d = C.put(d, "titles", { id: "t1", t: "First", rel: "2026-03-01", ppl: [{ r: "a", n: "Ánn Ölsen" }], fmts: [{ id: "f1", isbn: "9786185321000" }] }, 600);
  assert.deepEqual(C.list(d, { q: "ann" }).map((x) => x.id), ["t1"]);
  assert.deepEqual(C.list(d, { q: "978-618-5321-01-7" }).map((x) => x.id), ["t2"]);
  assert.deepEqual(C.list(d, { q: "6185321009" }).map((x) => x.id), ["t1"]);
  assert.deepEqual(C.list(d, {}, "rel").map((x) => x.id), ["t1", "t2"]);
  const g = C.gaps(C.find(d, "titles", "t2"));
  assert.ok(g.indexOf("author") >= 0 && g.indexOf("price") >= 0 && g.indexOf("cov") >= 0 && g.indexOf("isbn") < 0);
});

test("the barcode encodes the right bars and only digits reach the SVG", () => {
  const bars = C.ean13("9780306406157");
  assert.equal(bars.length, 95);
  assert.ok(bars.startsWith("101") && bars.endsWith("101"));
  assert.equal(bars.slice(45, 50), "01010");
  assert.equal(C.ean13("9780306406158"), null);
  const svg = C.barcodeSvg("9780306406157", [{ p: "978-0-30640" }]);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="37\.29mm"/);
  assert.match(svg, />ISBN 978-0-30640-615-7</);
  assert.equal(C.barcodeSvg("not a number"), "");
  assert.equal(C.barcodeSvg("9780306406157", [{ p: "978-0-306\"><script>" }]).indexOf("<script"), -1);
});

test("a prefill from another app keeps only cleaned, known fields", () => {
  const t = C.fromPrefill({ title: "From chat", author: "Bo", isbn: "0-306-40615-2", price: "12,50", evil: "<x>", id: "hack", m: 9e15 }, "n1", 700, "f1");
  assert.equal(t.id, "n1");
  assert.equal(t.m, 700);
  assert.equal(t.t, "From chat");
  assert.deepEqual(t.ppl, [{ r: "a", n: "Bo" }]);
  assert.equal(t.fmts[0].isbn, "9780306406157");
  assert.equal(t.fmts[0].price, 12.5);
  assert.equal(t.evil, undefined);
  assert.equal(C.fromPrefill({}, "n2", 1, "f"), null);
});

test("the search provider finds by words and ISBN, skips deleted titles", () => {
  const d = JSON.parse(C.serialize(C.remove(base(), "titles", "t2", 900)));
  const hits = P.search({ q: "first", readJSON: () => d });
  assert.deepEqual(hits.map((h) => h.target.title), ["t1"]);
  assert.match(hits[0].text, /978-618-5321-00-0/);
  assert.match(hits[0].text, /6185321009/);
});

test("settings keep the publisher name and fields of a later version", () => {
  let d = C.setSet(C.empty(), { imp: "  Gull Press\n" }, 10);
  assert.equal(d.set.imp, "Gull Press");
  assert.equal(d.set.cur, "EUR");
  d = C.setCur(d, "USD", 20);
  assert.deepEqual([d.set.cur, d.set.imp], ["USD", "Gull Press"]);
  const later = JSON.parse(C.serialize(d));
  later.set.logo = "x.png";
  later.set.m = 30;
  const old = C.normalize(later);
  assert.equal(old.set.logo, "x.png");
  assert.equal(C.setSet(old, { imp: "New" }, 40).set.logo, "x.png");
  assert.equal(C.serialize(C.merge(d, later)), C.serialize(C.merge(later, d)));
});
