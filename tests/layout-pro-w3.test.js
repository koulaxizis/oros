// Layout pro (LY-PRO wave W3, Chris's spec v2 items 3-4): sections
// with their own numbering (arabic, roman, letters, prefix, restart or
// go on) that page-number fields, the contents, the read-back and the
// PDF follow; pages moved and copied by range; masters by range and
// masters based on masters (no loops); the commands for Claude.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "designkit/model.js"));
const T = require(path.join(ROOT, "designkit/text.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const PRO = require(path.join(ROOT, "layout/pro.js"));
const CMD = require(path.join(ROOT, "layout/commands.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

let IDN = 0;
function idf() { const k = (++IDN).toString(36); let n = 0; return (p) => p + "-w" + k + "x" + (++n); }
function steps(list) { const c = CMD.check(list); assert.ok(c.ok, c.err); return c.steps; }
function run(d, list, env) { return steps(list).reduce((n, st) => n + CMD.apply(d, st, Object.assign({ now: 50, idf: idf() }, env || {})), 0); }
function book(n) {
  const s = steps([{ op: "create", title: "Βιβλίο", w: 140, h: 210, n: n || 12 }]);
  return PRO.makeDoc(s[0], 10);
}
const labels = (d) => M.pageLabels(d).map((x) => x.label);

test("numbers: roman and letters", () => {
  assert.deepEqual([1, 4, 9, 14, 40, 1999].map((n) => M.numFmt(n, "i")), ["i", "iv", "ix", "xiv", "xl", "mcmxcix"]);
  assert.equal(M.numFmt(12, "I"), "XII");
  assert.deepEqual([1, 26, 27, 52].map((n) => M.numFmt(n, "a")), ["a", "z", "aa", "az"]);
  assert.equal(M.numFmt(3, "A"), "C");
  assert.equal(M.numFmt(0, "i"), "0", "no roman zero");
});

test("sections: front matter in roman, the body from 1, an appendix with a prefix", () => {
  const d = book(12);
  assert.deepEqual(labels(d).slice(0, 3), ["1", "2", "3"], "no section: as before");
  assert.equal(run(d, [{ op: "section", page: 1, start: 1, numstyle: "i" }, { op: "section", page: 5, start: 1 }, { op: "section", page: 11, start: 1, numstyle: "A", prefix: "Π-" }]), 3);
  assert.deepEqual(labels(d), ["i", "ii", "iii", "iv", "1", "2", "3", "4", "5", "6", "Π-A", "Π-B"]);
  // a section that goes on keeps counting, in its own style
  run(d, [{ op: "section", page: 11, start: -1, numstyle: "1", prefix: "" }]);
  assert.deepEqual(labels(d).slice(9), ["6", "7", "8"]);
  assert.equal(run(d, [{ op: "section", page: 11, start: -1, numstyle: "1", prefix: "" }]), 0, "nothing differs");
  run(d, [{ op: "section", page: 11, off: true }]);
  assert.ok(!M.pagesInOrder(d)[10].ext, "off removes it");
  assert.match(CMD.check([{ op: "section", page: 1, numstyle: "x" }]).err, /numstyle/);
});

test("sections: page-number fields and the read-back follow", () => {
  const d = book(6);
  run(d, [{ op: "section", page: 1, start: 1, numstyle: "i" }, { op: "section", page: 3, start: 1 }]);
  const pg = M.pagesInOrder(d)[0];
  d.stories.push({ id: "st-pn", m: 1, h: [], paras: [{ ps: "ps-base", runs: [{ t: "σ. " }, { f: "pn" }] }] });
  d.items.push({ id: "it-pn", m: 1, t: "text", pg: pg.id, story: "st-pn", x: 40, y: 40, w: 200, h: 40, z: 1, cols: 1, gut: 0, ins: 0, va: "t", sw: 0 });
  const L = R.computeLayout(d);
  assert.deepEqual(L.labels.map((x) => x.label), ["i", "ii", "1", "2", "3", "4"]);
  const runs = L.frames["it-pn"].lines[0].runs.map((r) => r.t).join("");
  assert.match(runs, /^σ\.\s*i$/);
  const o = CMD.outline(d, null, {});
  assert.equal(o.page_list[2].number, "1");
  assert.deepEqual(o.page_list[0].section, { start: 1, numstyle: "i", prefix: "" });
  assert.match(read("designkit/pdf.js"), /L\.labels && L\.labels\[L\.pageOf\[p\.id\]\]/, "the PDF's page information line uses the labels");
  assert.match(read("layout/autolay.js"), /no: labels \? labels\[at\[k\]\]\.label/, "the contents use the labels");
});

test("movepages and duppages: by range, in order, text copied", () => {
  const d = book(6);
  const ids = M.pagesInOrder(d).map((p) => p.id);
  assert.equal(run(d, [{ op: "movepages", pages: "5-6", before: 2 }]), 2);
  assert.deepEqual(M.pagesInOrder(d).map((p) => ids.indexOf(p.id) + 1), [1, 5, 6, 2, 3, 4]);
  assert.equal(run(d, [{ op: "movepages", pages: "1", before: 0 }]), 1);
  assert.deepEqual(M.pagesInOrder(d).map((p) => ids.indexOf(p.id) + 1), [5, 6, 2, 3, 4, 1]);
  assert.equal(run(d, [{ op: "movepages", pages: "1-6", before: 0 }]), 0, "all pages: nothing to move");
  assert.equal(run(d, [{ op: "movepages", pages: "2", before: 2 }]), 0, "already there");
  run(d, [{ op: "frame", page: 3, lines: ["κείμενο"] }]);
  const before = d.stories.length;
  assert.equal(run(d, [{ op: "duppages", pages: "3-4" }]), 2);
  const order = M.pagesInOrder(d);
  assert.equal(order.length, 8);
  const copy = d.items.filter((it) => it.pg === order[4].id && it.t === "text")[0];
  const orig = d.items.filter((it) => it.pg === order[2].id && it.t === "text")[0];
  assert.ok(copy && copy.story !== orig.story, "its own story");
  assert.equal(d.stories.length, before + 1);
  assert.deepEqual(M.find(d.stories, copy.story).paras, M.find(d.stories, orig.story).paras);
  assert.deepEqual(order.map((p) => p.pos), order.map((p, i) => (i + 1) * 1024));
});

test("masters: by range, based on another master, never a loop", () => {
  const d = book(8);
  assert.equal(run(d, [{ op: "defmaster", name: "Κεφάλαιο", prefix: "K" }, { op: "defmaster", name: "Άνοιγμα", base: "Κεφάλαιο" }]), 2);
  const ch = PRO.styleNamed(d.masters, "Κεφάλαιο"), op = PRO.styleNamed(d.masters, "Άνοιγμα");
  assert.equal(ch.pre, "K");
  assert.equal(op.ext.base, ch.id);
  d.items.push({ id: "it-mk", m: 1, t: "rect", pg: ch.id, x: 0, y: 0, w: 10, h: 10, z: 1 });
  d.items.push({ id: "it-mo", m: 1, t: "rect", pg: op.id, x: 20, y: 0, w: 10, h: 10, z: 1 });
  assert.equal(run(d, [{ op: "masterpages", pages: "3-5", master: "Άνοιγμα" }]), 3);
  const p3 = M.pagesInOrder(d)[2];
  assert.deepEqual(M.masterItems(d, p3, "R").map((it) => it.id), ["it-mk", "it-mo"], "the base's objects first, under this one's");
  // a loop is refused: Κεφάλαιο may not be based on Άνοιγμα
  assert.equal(run(d, [{ op: "defmaster", name: "Κεφάλαιο", base: "Άνοιγμα" }]), 0);
  ch.ext = { base: op.id };   // made by hand anyway: drawing stops
  assert.equal(M.masterItems(d, p3, "R").length, 2);
  delete ch.ext;
  assert.equal(run(d, [{ op: "defmaster", name: "Άνοιγμα", base: "none" }]), 1);
  assert.ok(!PRO.styleNamed(d.masters, "Άνοιγμα").ext);
  const notes = [];
  assert.equal(run(d, [{ op: "masterpages", pages: "all", master: "Δεν υπάρχει" }], { notes }), 0);
  assert.deepEqual(notes, ["noMaster"]);
  assert.equal(run(d, [{ op: "masterpages", pages: "odd", master: "" }]), 4, "\"\" = no master");
  assert.equal(CMD.outline(d, null, {}).master_list.filter((m) => m.name === "Κεφάλαιο")[0].prefix, "K");
});

test("the UI and the Assistant: section dialog, base master, card words", () => {
  const p = read("layout/panels.js"), a = read("assistant/assistant.js");
  assert.match(p, /function sectionDlg\(pgId\)/);
  assert.match(p, /function baseDlg\(msId\)/);
  assert.match(p, /labels\[n - 1\]\.label/);
  ["section", "movepages", "duppages", "masterpages", "defmaster"].forEach((op) => {
    assert.match(CMD.GUIDE, new RegExp("\\b" + op + ":"));
    assert.ok(CMD.ORDER.indexOf(op) > 0, op);
  });
  assert.match(a, /"ed\.op\.section": "Section with its own page numbers"/);
});
