// Family Tree core (familytree/ft-core.js): dates, normalizers,
// the sync merge (slice "familytree"), the strict JSON import
// (hostile files), the layout (no overlapping cards), the SVG
// export (no injectable markup) and the read-only Contacts bridge.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const F = require(path.join(__dirname, "..", "familytree/ft-core.js"));

const T = "tree1";
function tree(id, m, name) { return { id: id || T, m: m || 1, name: name || "Family", home: "" }; }
function person(id, m, extra) {
  return Object.assign({ id, m: m || 1, tree: T, given: id, family: "Doe", parents: [] }, extra || {});
}
function union(id, a, b, extra) { return Object.assign({ id, m: 1, tree: T, a, b, kind: "married" }, extra || {}); }
function kid(id, u, extra) { return person(id, 1, Object.assign({ parents: [{ u, kind: "birth" }] }, extra || {})); }
function data(people, unions, trees, tombs) {
  return F.merge({ trees: trees || [tree()], people: people || [], unions: unions || [], tombs: tombs || {} }, {});
}
let seq = 0;
function newId() { return "n" + (++seq).toString(36).padStart(4, "0"); }

// A family: grandparents gp1+gp2 → dad; dad+mom → me, sis; me+wife → son, daughter;
// mom's parents gm1+gm2.
function family() {
  return data(
    [person("gp1", 1, { sex: "m" }), person("gp2", 1, { sex: "f" }), person("gm1"), person("gm2"),
     kid("dad", "u0", { sex: "m" }), kid("mom", "u1", { sex: "f" }),
     kid("me", "u2", { birth: { d: "1980" } }), kid("sis", "u2", { birth: { d: "1978" } }),
     person("wife"), kid("son", "u3"), kid("daughter", "u3")],
    [union("u0", "gp1", "gp2"), union("u1", "gm1", "gm2"), union("u2", "dad", "mom"), union("u3", "me", "wife")]);
}

// ---------- dates ----------
test("dates: partial forms, real days, typed input", () => {
  ["1890", "1890-03", "1890-03-15", "2000-02-29", "0001"].forEach((d) => assert.ok(F.validD(d), d));
  ["1900-02-29", "1890-13", "1890-00", "0000", "2201", "1890-3", "90", "1890-03-32", "", null, 1890]
    .forEach((d) => assert.ok(!F.validD(d), String(d)));
  assert.equal(F.parseDateInput("15/3/1890"), "1890-03-15");
  assert.equal(F.parseDateInput("15.03.1890"), "1890-03-15");
  assert.equal(F.parseDateInput("3/1890"), "1890-03");
  assert.equal(F.parseDateInput(" 1890 "), "1890");
  assert.equal(F.parseDateInput("1890-3-5"), "1890-03-05");
  assert.equal(F.parseDateInput(""), "");
  assert.equal(F.parseDateInput("31/2/1890"), null);
  assert.equal(F.parseDateInput("yesterday"), null);
  assert.equal(F.fmtDate({ d: "1890-03-15", q: "" }, "el"), "15/03/1890");
  assert.equal(F.fmtDate({ d: "1890", q: "abt" }, "el"), "περ. 1890");
  assert.equal(F.fmtDate({ d: "1890-03", q: "bef" }, "en"), "before 03/1890");
  assert.equal(F.lifeSpan(F.normPerson(person("a", 1, { birth: { d: "1920" }, death: { d: "1995-01-02" } })), "en"), "1920–1995");
  assert.equal(F.lifeSpan(F.normPerson(person("a", 1, { birth: { d: "1990", q: "abt" } })), "el"), "γ. περ.1990");
  assert.equal(F.lifeSpan(F.normPerson(person("a", 1, { dead: true })), "en"), "†");
});

// ---------- normalizers ----------
test("normalizers: allow-list only, caps, enums, no prototype keys", () => {
  const p = F.normPerson(Object.assign(person("p1"), {
    given: "  Anna \n\t Maria‮ ", family: "x".repeat(300), sex: "alien", evil: "<script>",
    birth: { d: "1890-02-30", q: "abt", place: "Athens" }, death: { place: "Volos" },
    photo: "data:image/svg+xml;base64,PHN2Zz4=", contact: "../../etc",
    parents: [{ u: "u1", kind: "birth" }, { u: "u1", kind: "step" }, { u: "u2", kind: "weird" }, { u: "u3" }, { u: "u4" }, { u: "u5" }],
    note: "line1\r\nline2\u0007"
  }));
  assert.equal(p.given, "Anna Maria");
  assert.equal(p.family.length, F.NAME_LEN);
  assert.equal(p.sex, "u");
  assert.ok(!("evil" in p));
  assert.deepEqual(p.birth, { d: "", q: "", place: "Athens" });
  assert.equal(p.dead, true, "a death place means deceased");
  assert.equal(p.photo, "");
  assert.equal(p.contact, "");
  assert.deepEqual(p.parents.map((r) => r.u + ":" + r.kind), ["u1:birth", "u2:birth", "u3:birth", "u4:birth"]);
  assert.equal(p.note, "line1\nline2");
  assert.deepEqual(Object.keys(p), ["id", "m", "tree", "given", "family", "birthName", "sex", "birth", "death",
                                     "dead", "note", "photo", "contact", "parents"]);
  ["__proto__", "_x", "", "a/b", "x".repeat(41), 5, null].forEach((id) =>
    assert.equal(F.normPerson(person(id)), null, String(id)));
  assert.equal(F.normPerson(Object.assign(person("ok"), { m: -1 })), null);
  assert.equal(F.normPerson(Object.assign(person("ok"), { m: 1.5 })), null);
  assert.equal(F.normTree({ id: "t", m: 1, name: "   " }), null);
  const u = F.normUnion({ id: "u", m: 1, tree: T, a: "", b: "p2", kind: "nope" });
  assert.deepEqual([u.a, u.b, u.kind], ["p2", "", "unknown"]);
  assert.equal(F.normUnion({ id: "u", m: 1, tree: T, a: "p", b: "p" }).b, "");
  const ok = "data:image/jpeg;base64," + "A".repeat(100);
  assert.ok(F.validPhoto(ok));
  assert.ok(!F.validPhoto(ok + "\"onload=alert(1)"));
  assert.ok(!F.validPhoto("data:image/jpeg;base64," + "A".repeat(F.PHOTO_MAX)));
  assert.ok(!F.validPhoto("javascript:alert(1)"));
});

// ---------- merge ----------
test("merge: LWW per entity, symmetric, idempotent, canonical (R5, R26)", () => {
  const A = data([person("p1", 5, { given: "Old" }), person("p2", 3)], [union("u1", "p1", "p2")]);
  const B = data([person("p1", 9, { given: "New" }), person("p3", 4)], []);
  const ab = F.merge(A, B), ba = F.merge(B, A);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba));
  assert.equal(JSON.stringify(F.merge(ab, ab)), JSON.stringify(ab));
  assert.deepEqual(ab.people.map((p) => p.id + ":" + p.given), ["p1:New", "p2:p2", "p3:p3"]);
  // equal m: larger canonical JSON wins on both sides
  const X = data([person("p1", 5, { given: "Alpha" })]), Y = data([person("p1", 5, { given: "Beta" })]);
  assert.equal(F.merge(X, Y).people[0].given, "Beta");
  assert.equal(F.merge(Y, X).people[0].given, "Beta");
});

test("merge: tombstones delete, delete wins ties, newer edit resurrects (R17)", () => {
  const A = data([person("p1", 5)]);
  assert.equal(F.merge(A, { tombs: { p1: 5 } }).people.length, 0);
  assert.equal(F.merge(A, { tombs: { p1: 4 } }).people.length, 1);
  assert.equal(F.merge(data([person("p1", 6)]), { tombs: { p1: 5 } }).people.length, 1);
  assert.deepEqual(F.merge({ tombs: { a: 3, "__proto__": 9, "bad id": 1 } }, { tombs: { a: 7 } }).tombs, { a: 7 });
});

test("merge: two devices add a child to the same couple, both survive", () => {
  const base = data([person("dad"), person("mom")], [union("u", "dad", "mom")]);
  const d1 = F.merge(base, { trees: [tree()], people: [kid("c1", "u")] });
  const d2 = F.merge(base, { trees: [tree()], people: [kid("c2", "u")] });
  const m = F.merge(d1, d2);
  const ix = F.index(m, T);
  assert.deepEqual(ix.kids.u.map((p) => p.id), ["c1", "c2"]);
});

test("merge: deleting a tree drops its people everywhere, deterministically", () => {
  const d = data([person("p1")], [union("u1", "p1", "")], [tree(), tree("t2", 1, "Other")]);
  const gone = F.merge(d, { tombs: { [T]: 10 } });
  assert.deepEqual(gone.trees.map((t) => t.id), ["t2"]);
  assert.equal(gone.people.length + gone.unions.length, 0);
  // another device added a person to the deleted tree meanwhile
  const late = F.merge(gone, data([person("p9", 20)]));
  assert.equal(late.people.length, 0);
});

// ---------- relationships ----------
test("cycle guard: nobody becomes their own ancestor", () => {
  const ix = F.index(family(), T);
  assert.equal(F.wouldCycle(ix, "gp1", "u3"), true, "grandfather under grandson's family");
  assert.equal(F.wouldCycle(ix, "me", "u3"), true, "child of own union");
  assert.equal(F.wouldCycle(ix, "wife", "u2"), false);
  assert.equal(F.primaryUnion(ix, "me").id, "u2");
  const step = F.index(data([person("a"), person("b"), person("c"),
    person("k", 1, { parents: [{ u: "us", kind: "step" }, { u: "ub", kind: "birth" }] })],
    [union("us", "a", ""), union("ub", "b", "c")]), T);
  assert.equal(F.primaryUnion(step, "k").id, "ub", "birth family first");
});

// ---------- import ----------
function file(obj) { return JSON.stringify(Object.assign({ app: "familytree", format: 1, trees: [], people: [], unions: [] }, obj)); }

test("import: rejects non-files, wrong app, oversize, broken JSON", () => {
  assert.equal(F.parseImport("{", null).err, "json");
  assert.equal(F.parseImport("[]", null).err, "format");
  assert.equal(F.parseImport(JSON.stringify({ app: "contacts", format: 1, trees: [], people: [], unions: [] })).err, "format");
  assert.equal(F.parseImport(file({ format: 2 })).err, "format");
  assert.equal(F.parseImport(" ".repeat(F.IMPORT_MAX + 1)).err, "size");
  assert.equal(F.parseImport(file({ people: new Array(F.MAX_PEOPLE + 1).fill(0) })).err, "toolarge");
  assert.equal(F.parseImport(42).err, "format");
});

test("import: hostile content is dropped or neutralized, never executed", () => {
  const evil = file({
    trees: [tree(), { id: "constructor", m: 1, name: "x" }, { id: "__proto__", m: 1, name: "pwn" }],
    people: [
      person("p1", 1, { given: "<img src=x onerror=alert(1)>", family: "<script>alert(1)</script>",
                        photo: "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+", contact: "javascript:alert(1)" }),
      person("p2", 1, { tree: "nope" }),
      person("p3", 1, { photo: "javascript:alert(1)", note: "‮evil" }),
      { id: "p4", m: "1", tree: T },
      "string row", null, 7
    ],
    unions: [union("u1", "p1", "ghost"), union("u2", "p1", "p3", { tree: "nope" })],
    tombs: { "__proto__": 1, p9: "x" }
  });
  const r = F.parseImport(evil, null);
  assert.ok(r.ok);
  assert.equal(Object.getPrototypeOf({}).pwn, undefined);
  assert.equal(({}).polluted, undefined);
  const p1 = r.data.people.find((p) => p.id === "p1");
  assert.equal(p1.given, "<img src=x onerror=alert(1)>", "kept as plain text");
  assert.equal(p1.photo, "");
  assert.equal(p1.contact, "");
  assert.equal(r.data.people.find((p) => p.id === "p3").note, "evil");
  assert.deepEqual(r.data.people.map((p) => p.id), ["p1", "p3"]);
  assert.equal(r.data.unions.find((u) => u.id === "u1").b, "", "missing partner removed");
  assert.deepEqual(r.data.tombs, {});
  assert.ok(r.stats.dropped >= 6);
  assert.equal(r.stats.refs, 1);
  // the SVG of that person carries no markup
  const lay = F.layout(r.data, T, "p1", {});
  const svg = F.toSvg(F.scene(lay, r.data, T, { lang: "en", photos: true }), { title: "<t>" });
  assert.ok(!/<script|onerror=|<img|javascript:/i.test(svg.replace(/&lt;img src=x onerror=alert\(1\)&gt;|&lt;script&gt;alert\(1\)&lt;\/script&gt;/g, "")));
  assert.ok(svg.includes("&lt;img src=x"), "shown as text");
});

test("import: references are checked against the file and this device", () => {
  const local = data([person("dad"), person("mom")], [union("u", "dad", "mom")]);
  const r = F.parseImport(file({
    people: [kid("c1", "u"), kid("c2", "nowhere"), person("c3", 1, { parents: [{ u: "u3" }] })],
    unions: [union("u3", "c3", "")]
  }), local);
  assert.ok(r.ok);
  const by = Object.fromEntries(r.data.people.map((p) => [p.id, p]));
  assert.deepEqual(by.c1.parents, [{ u: "u", kind: "birth" }], "local union resolves");
  assert.deepEqual(by.c2.parents, []);
  assert.deepEqual(by.c3.parents, [], "a partner cannot be the child of the same union");
  assert.equal(r.stats.refs, 2);
});

test("import: loops are cut, the rest kept", () => {
  // a is b's parent and b is a's parent (via unions ua, ub)
  const r = F.parseImport(file({
    trees: [tree()],
    people: [person("a", 1, { parents: [{ u: "ub" }] }), person("b", 1, { parents: [{ u: "ua" }] }), kid("c", "ua")],
    unions: [union("ua", "a", ""), union("ub", "b", "")]
  }), null);
  assert.equal(r.stats.cycles, 1);
  const ix = F.index(r.data, T);
  Object.keys(ix.P).forEach((id) => {
    ix.P[id].parents.forEach((l) => {
      const tmp = Object.assign({}, ix.P[id], { parents: ix.P[id].parents.filter((x) => x !== l) });
      const ix2 = F.index(Object.assign({}, r.data, { people: r.data.people.map((p) => (p.id === id ? tmp : p)) }), T);
      assert.equal(F.wouldCycle(ix2, id, l.u), false, id);
    });
  });
  assert.deepEqual(ix.kids.ua.map((p) => p.id), ["c"], "b's link would close the loop");
  assert.deepEqual(ix.kids.ub.map((p) => p.id), ["a"]);
});

test("import: export → import round-trip; a restore is a merge (no overwrite, no resurrection)", () => {
  const d = family();
  const txt = F.exportData(d, null, "2026-10-08T00:00:00Z");
  const r = F.parseImport(txt, null);
  assert.ok(r.ok);
  assert.equal(JSON.stringify(F.merge(r.data, r.data)), JSON.stringify(d));
  // the device has a newer edit and a deletion since the backup
  const now = F.merge(d, { people: [person("me", 50, { given: "Newer" })], tombs: { son: 60 } });
  const restored = F.merge(now, F.parseImport(txt, now).data);
  assert.equal(restored.people.find((p) => p.id === "me").given, "Newer");
  assert.equal(restored.people.find((p) => p.id === "son"), undefined);
  // import twice = once
  assert.equal(JSON.stringify(F.merge(restored, r.data)), JSON.stringify(restored));
  // one-tree export carries only that tree
  const two = F.merge(d, { trees: [tree("t2", 1, "B")], people: [person("x", 1, { tree: "t2" })] });
  const one = JSON.parse(F.exportData(two, "t2", ""));
  assert.deepEqual([one.trees.length, one.people.length, one.unions.length], [1, 1, 0]);
});

// ---------- layout ----------
function overlaps(lay) {
  const bad = [];
  for (let i = 0; i < lay.nodes.length; i++) {
    for (let j = i + 1; j < lay.nodes.length; j++) {
      const a = lay.nodes[i], b = lay.nodes[j];
      if (a.x < b.x + F.CW && b.x < a.x + F.CW && a.y < b.y + F.CH && b.y < a.y + F.CH) bad.push(a.pid + "/" + b.pid);
    }
  }
  return bad;
}

test("layout: hourglass places everyone once, rows by generation, no overlaps", () => {
  const d = family();
  const lay = F.layout(d, T, "me", { up: 3, down: 3 });
  const ids = lay.nodes.map((n) => n.pid).sort();
  assert.deepEqual(ids, ["dad", "daughter", "gm1", "gm2", "gp1", "gp2", "me", "mom", "sis", "son", "wife"]);
  assert.deepEqual(overlaps(lay), []);
  const y = Object.fromEntries(lay.nodes.map((n) => [n.pid, n.y]));
  assert.ok(y.gp1 < y.dad && y.dad < y.me && y.me < y.son);
  assert.equal(y.me, y.sis);
  assert.equal(y.me, y.wife);
  assert.ok(lay.nodes.every((n) => n.x >= 0 && n.y >= 0 && n.x + F.CW <= lay.w && n.y + F.CH <= lay.h));
  assert.equal(lay.nodes.filter((n) => n.focus).length, 1);
  // depth limits and modes
  assert.deepEqual(F.layout(d, T, "me", { up: 1, down: 0 }).nodes.map((n) => n.pid).sort(), ["dad", "me", "mom", "sis", "wife"]);
  assert.ok(!F.layout(d, T, "me", { up: 0, down: 3, siblings: false }).nodes.some((n) => n.pid === "sis"));
  assert.deepEqual(F.layout(d, T, "missing", {}).nodes, []);
});

test("layout: many marriages, single parents, unknown parents, wide families", () => {
  const people = [person("p"), person("w1"), person("w2"), person("w3")];
  const unions = [union("a1", "p", "w1"), union("a2", "p", "w2", { kind: "divorced" }), union("a3", "p", "w3"), union("solo", "p", "")];
  for (let i = 0; i < 6; i++) people.push(kid("k1" + i, "a1"), kid("k2" + i, "a2"));
  people.push(kid("k3", "a3"), kid("ks", "solo"));
  for (let i = 0; i < 4; i++) people.push(kid("g" + i, "kfam"));
  unions.push(union("kfam", "k10", "w9"));
  people.push(person("w9"));
  people.push(kid("sib1", "none"), kid("sib2", "none"));
  people.find((x) => x.id === "p").parents = [{ u: "none", kind: "birth" }];
  unions.push(union("none", "", ""));
  const d = data(people, unions);
  const lay = F.layout(d, T, "p", { up: 3, down: 3 });
  assert.deepEqual(overlaps(lay), []);
  assert.equal(lay.nodes.length, new Set(lay.nodes.map((n) => n.pid)).size);
  assert.ok(lay.links.some((l) => l.cls === "ft-div"));
  assert.ok(lay.nodes.some((n) => n.pid === "sib1"));
});

test("layout: cousin marriage and loops draw a dashed copy, never recurse forever", () => {
  // gp → c1, c2 (siblings); c1 → x; c2 → y; x + y married → z
  const d = data(
    [person("gp"), kid("c1", "g"), kid("c2", "g"), person("s1"), person("s2"),
     kid("x", "f1"), kid("y", "f2"), kid("z", "xy")],
    [union("g", "gp", ""), union("f1", "c1", "s1"), union("f2", "c2", "s2"), union("xy", "x", "y")]);
  const lay = F.layout(d, T, "gp", { up: 0, down: 5 });
  assert.deepEqual(overlaps(lay), []);
  assert.ok(lay.nodes.some((n) => n.dup), "one person appears twice, the second dashed");
  const up = F.layout(d, T, "z", { up: 5, down: 0 });
  assert.deepEqual(overlaps(up), []);
  assert.ok(up.nodes.filter((n) => n.pid === "gp").length >= 1);
  assert.ok(up.nodes.some((n) => n.dup), "pedigree collapse marked");
  // a loop that slipped in through sync
  const loop = data([person("a", 1, { parents: [{ u: "ub" }] }), person("b", 1, { parents: [{ u: "ua" }] })],
                    [union("ua", "a", ""), union("ub", "b", "")]);
  const l2 = F.layout(loop, T, "a", { up: 10, down: 10 });
  assert.ok(l2.nodes.length <= 4);
});

test("layout: a big tree stays overlap-free", () => {
  const people = [], unions = [];
  let n = 0;
  function grow(pid, depth) {
    if (!depth) return;
    const sp = "s" + (++n), u = "u" + n;
    people.push(person(sp));
    unions.push(union(u, pid, sp));
    for (let i = 0; i < 3; i++) {
      const c = "c" + (++n);
      people.push(kid(c, u));
      grow(c, depth - 1);
    }
  }
  people.push(person("root"));
  grow("root", 4);
  const d = data(people, unions);
  const lay = F.layout(d, T, "root", { up: 0, down: 4 });
  assert.equal(lay.nodes.length, people.length);
  assert.deepEqual(overlaps(lay), []);
  const mid = F.layout(d, T, "c3", { up: 3, down: 3 });
  assert.deepEqual(overlaps(mid), []);
});

// ---------- SVG ----------
test("svg: well-formed, themed, only known tags/attrs, hide living", () => {
  const d = F.merge(family(), { people: [person("gp1", 9, { sex: "m", dead: true, birth: { d: "1900" }, death: { d: "1970" } }),
                                         person("me", 9, { parents: [{ u: "u2" }], birth: { d: "1980" }, photo: "data:image/png;base64,iVBORw0KGgo=" })] });
  const lay = F.layout(d, T, "me", {});
  const sc = F.scene(lay, d, T, { lang: "en", photos: true });
  const svg = F.toSvg(sc, { theme: "dark", title: 'A & "B"' });
  assert.ok(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.includes("<title>A &amp; &quot;B&quot;</title>"));
  assert.ok(svg.includes("1900–1970"));
  assert.ok(svg.includes("b. 1980"));
  assert.ok(svg.includes('href="data:image/png;base64,iVBORw0KGgo="'));
  assert.ok(!/data-pid|<script|<foreignObject|\son[a-z]+=/i.test(svg));
  // every tag is in the allow-list
  const tags = new Set([...svg.matchAll(/<([a-zA-Z]+)/g)].map((m) => m[1]));
  tags.forEach((tg) => assert.ok(tg === "svg" || F.TAGS[tg], tg));
  // balanced tags
  const open = (svg.match(/<(g|text|title|clipPath)[\s>]/g) || []).length;
  const close = (svg.match(/<\/(g|text|title|clipPath)>/g) || []).length;
  assert.equal(open, close);
  const hidden = F.toSvg(F.scene(lay, d, T, { lang: "en", photos: true, hideLiving: true }), {});
  assert.ok(!hidden.includes("b. 1980"));
  assert.ok(!hidden.includes("<image"));
  assert.ok(hidden.includes("1900–1970"), "the dead keep their dates");
});

// ---------- Contacts bridge ----------
function contacts() {
  // relation {with X, type T} on c = "X is c's T"
  return {
    ver: 1,
    contacts: [
      { id: "cme", given: "Chris", family: "K", mtime: 1, events: [{ type: "birthday", day: "05-04", year: 1980 }],
        relations: [{ with: "cdad", type: "parent" }, { with: "cmom", type: "parent" }, { with: "cwife", type: "spouse" },
                    { with: "cboss", type: "manager" }], photo: "data:image/jpeg;base64,AAAA" },
      { id: "cdad", given: "Nikos", family: "K", mtime: 1, relations: [{ with: "cmom", type: "spouse" }] },
      { id: "cmom", given: "Maria", family: "K", mtime: 1, relations: [] },
      { id: "cwife", given: "Eleni", family: "P", mtime: 1, relations: [] },
      { id: "cson", given: "Giorgos", middle: "A", family: "K", mtime: 1, relations: [{ with: "cme", type: "parent" }, { with: "cbro", type: "sibling" }] },
      { id: "cbro", given: "Petros", family: "K", mtime: 1, relations: [] },
      { id: "cboss", given: "Boss", mtime: 1, relations: [] },
      { id: "cgone", given: "Gone", mtime: 1, relations: [{ with: "cme", type: "sibling" }] }
    ],
    deleted: [{ id: "cgone", mtime: 5 }]
  };
}

test("contacts: plan follows family relations both ways, skips deleted and non-family", () => {
  const plan = F.planFromContacts(contacts(), "cme");
  assert.deepEqual(plan.map((x) => x.cid), ["cme", "cdad", "cmom", "cson", "cwife", "cbro"]);
  assert.equal(plan[0].name, "Chris K");
  assert.equal(plan[0].birth, "1980-05-04");
  assert.deepEqual(F.planFromContacts(contacts(), "nobody"), []);
  assert.deepEqual(F.planFromContacts(null, "cme"), []);
});

test("contacts: build makes people, couples and families; re-run is idempotent", () => {
  seq = 0;
  const ct = contacts();
  const ids = F.planFromContacts(ct, "cme").map((x) => x.cid);
  let d = data([], []);
  const r = F.buildFromContacts(ct, ids, d, T, 100, newId);
  d = F.merge(d, { people: r.people, unions: r.unions });
  const ix = F.index(d, T);
  const by = (cid) => ix.P[r.map[cid]];
  assert.equal(Object.keys(ix.P).length, 6);
  assert.equal(by("cson").given, "Giorgos A");
  assert.equal(by("cme").birth.d, "1980-05-04");
  assert.equal(by("cme").contact, "cme");
  const meU = F.primaryUnion(ix, by("cme").id);
  assert.deepEqual([meU.a, meU.b].sort(), [by("cdad").id, by("cmom").id].sort());
  assert.equal(meU.kind, "married");
  const sonU = F.primaryUnion(ix, by("cson").id);
  assert.ok(sonU.a === by("cme").id && sonU.b === "", "one known parent");
  assert.equal(F.primaryUnion(ix, by("cbro").id).id, sonU.id, "sibling joins the same family");
  assert.ok(F.findUnion(ix, by("cme").id, by("cwife").id), "couple without listed children");
  assert.ok(r.photos[by("cme").id]);
  // second run: nothing new
  const again = F.buildFromContacts(ct, ids, d, T, 200, newId);
  assert.equal(again.people.length, 0);
  assert.equal(again.unions.length, 0);
  // an existing person with parents is never rewired
  const lay = F.layout(d, T, by("cme").id, {});
  assert.deepEqual(overlaps(lay), []);
});

test("contacts: contradictory relations cannot create a loop", () => {
  seq = 100;
  const ct = { contacts: [
    { id: "ca", given: "A", mtime: 1, relations: [{ with: "cb", type: "parent" }] },
    { id: "cb", given: "B", mtime: 1, relations: [{ with: "ca", type: "parent" }] }
  ], deleted: [] };
  const r = F.buildFromContacts(ct, ["ca", "cb"], data(), T, 1, newId);
  const d = F.merge(data(), { people: r.people, unions: r.unions });
  const linked = d.people.filter((p) => p.parents.length).length;
  assert.equal(linked, 1);
});
