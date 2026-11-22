// MK-G (8.46.00): Mockups in the Assistant's and the Gate's
// edit_in_app / read_in_app (mockups/commands.js, mockups/assist.js).
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
require(path.join(ROOT, "recipes/core.js"));
const M = require(path.join(ROOT, "mockups/core.js"));
const K = require(path.join(ROOT, "mockups/commands.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

function store(n) {
  const prj = [];
  for (let i = 0; i < n; i++) { const p = M.blank("kmk" + String(1000 + i), 10 + i); p.nm = "Βιβλίο " + i; prj.push(p); }
  return { ver: 1, prj, tombs: {} };
}
function env(map) {
  const notes = [];
  return { notes, asset: (p) => (map && map[p]) || "" };
}

test("check: create only first, picture paths only in Claude's folders, book sizes", () => {
  assert.ok(K.check([{ op: "create", title: "Πλανόδιο" }, { op: "show", show_as: "ebook", device: "phone", screen: "/internal/Claude/planodio.jpg" }]).ok);
  assert.match(K.check([{ op: "rename", title: "a" }, { op: "create" }]).err, /only the first/);
  assert.match(K.check([{ op: "cover", front: "/internal/.trash/x.png" }]).err, /\/internal\/ path/);
  assert.match(K.check([{ op: "cover", front: "/internal/Claude/../x.png" }]).err, /\/internal\/ path/);
  assert.match(K.check([{ op: "cover", front: "C:/x.png" }]).err, /\/internal\/ path/);
  assert.match(K.check([{ op: "cover", front: "/internal/Claude/x.txt" }]).err, /\/internal\/ path/);
  assert.match(K.check([{ op: "book", w: 140 }]).err, /both w and h/);
  assert.match(K.check([{ op: "book", trim: "a5", w: 140, h: 200 }]).err, /not both/);
  assert.match(K.check([{ op: "scene" }]).err, /at least one field/);
  assert.match(K.check([{ op: "scene", angle: "sideways" }]).err, /not allowed/);
  assert.match(K.check([{ op: "show", screen: "/internal/x.png", colour: "red" }]).err, /not a field/);
  assert.match(K.check([{ op: "rename" }]).err, /title is missing/);
  assert.ok(K.check([{ op: "export" }]).ok);
});

test("apply: the e-book on a phone screen, angle and background", () => {
  const p = M.blank("kmk2000", 1);
  const e = env({ "/internal/Claude/planodio.jpg": "a".repeat(64) + ".jpg" });
  const st = K.check([{ op: "show", show_as: "ebook", device: "phone", dcolor: "black", screen: "/internal/Claude/planodio.jpg" },
    { op: "scene", angle: "right", bg: "solid", c1: "#223344" }]).steps;
  let n = 0;
  st.forEach((s) => { n += K.apply(p, s, e); });
  assert.ok(n >= 5);
  assert.strictEqual(p.show, "ebook");
  assert.strictEqual(p.ins.dev, "phone");
  assert.strictEqual(p.ins.scr, "a".repeat(64) + ".jpg");
  assert.deepStrictEqual([p.sc.cam.th, p.sc.cam.ph], K.ANGLES.right.slice(0, 2));
  assert.strictEqual(p.sc.bg.k, "solid");
  // the project stays valid for the store (M.parse keeps it)
  const back = M.parse(JSON.stringify({ ver: 1, prj: [p], tombs: {} }));
  assert.strictEqual(back.prj[0].ins.scr, p.ins.scr);
  // a picture that could not be copied changes nothing and leaves a note
  const q = M.blank("kmk2001", 1), e2 = env({});
  assert.strictEqual(K.apply(q, K.check([{ op: "cover", front: "/internal/Claude/none.png" }]).steps[0], e2), 0);
  assert.deepStrictEqual(e2.notes, ["noPicture"]);
});

test("apply: book sizes, pages even, wrap cover, rename", () => {
  const p = M.blank("kmk2002", 1), e = env({ "/internal/Claude/wrap.png": "b".repeat(64) + ".png" });
  K.check([{ op: "book", trim: "b", npages: 151, bind: "hc", paper: "cream", finish: "gloss" }, { op: "cover", wrap: "/internal/Claude/wrap.png" }, { op: "rename", title: "Νέο" }])
    .steps.forEach((s) => K.apply(p, s, e));
  assert.deepStrictEqual([p.bk.w, p.bk.h, p.bk.trim, p.bk.pages, p.bk.bind, p.bk.paper, p.bk.fin], [129, 198, "b", 152, "hc", "cream", "gloss"]);
  assert.deepStrictEqual([p.art.mode, p.art.wrap], ["wrap", "b".repeat(64) + ".png"]);
  assert.strictEqual(p.nm, "Νέο");
  assert.deepStrictEqual(K.picPaths(K.check([{ op: "cover", front: "/internal/a.png", back: "/internal/a.png" }, { op: "show", screen: "/internal/b.jpg" }]).steps), ["/internal/a.png", "/internal/b.jpg"]);
});

test("view, targets, preview and outline for the Assistant", () => {
  const v = K.view(store(3));
  assert.strictEqual(v.docs.length, 3);
  assert.deepStrictEqual(K.targets(v, null, "kmk1001", "open").docs.map((d) => d.id), ["kmk1001"]);
  assert.match(K.targets(v, null, "", "open").err, /no mockup is open/);
  assert.deepStrictEqual(K.targets(v, null, "", "named", "βιβλίο 2").docs.map((d) => d.id), ["kmk1002"]);
  assert.strictEqual(K.targets(v, null, "", "all").docs.length, 3);
  assert.strictEqual(K.targets(v, null, "", "new", "X").fresh, 1);
  assert.match(K.targets(v, null, "", "folder", "X").err, /no folders/);
  assert.match(K.targets(K.view(null), null, "", "open").err, /no book mockups yet/);
  const steps = K.check([{ op: "create", title: "Πλανόδιο" }, { op: "show", show_as: "ebook", device: "phone", screen: "/internal/Claude/p.jpg" }, { op: "export", out: "/internal/Claude/out" }]).steps;
  const pv = K.preview(K.view(null), [], steps);
  assert.strictEqual(pv.made, 1);
  assert.ok(pv.n >= 3);
  assert.strictEqual(pv.files, 1);
  const pv2 = K.preview(v, ["kmk1000", "kmk1001"], K.check([{ op: "scene", angle: "top" }]).steps);
  assert.strictEqual(pv2.d, 2);
  const o = K.outline(v.docs[0]);
  assert.strictEqual(o.product, "book");
  assert.ok(o.book.spine_mm > 0);
  assert.strictEqual(K.outline({}), null);
});

test("wiring: Assistant, Gate, card strings, precache", () => {
  const as = read("assistant/assistant.js"), core = read("assistant/core.js"), gate = read("gate/gate.js"), sw = read("sw.js"), de = read("i18n/de/assistant.js");
  assert.match(as, /mockups: \{ mod: "MockupsCommands", data: "oros-mockups-data", prefs: "oros-mockups-prefs", open: "cur", view: 1 \}/);
  assert.match(as, /mockups: \["\.\.\/mockups\/core\.js", "\.\.\/mockups\/commands\.js"\]/);
  assert.match(core, /mockups: \{ what: "mockups", noun: "mockup" \}/);
  assert.match(gate, /var DOCS = \[[^\]]*"mockups"/);
  assert.ok(sw.includes('"mockups/commands.js"') && sw.includes('"mockups/assist.js"'));
  // every command and field reads in words on the card (EN, EL twice in assistant.js; DE once)
  const has = (src, k, n) => src.split('"' + k + '":').length - 1 >= n;
  const keys = [];
  Object.keys(K.CATALOG).forEach((op) => {
    keys.push(has(as, "ed.op." + op + ".mockups", 2) ? "ed.op." + op + ".mockups" : "ed.op." + op);
    Object.keys(K.CATALOG[op].args).forEach((f) => keys.push(has(as, "ed.f." + f + ".mockups", 2) ? "ed.f." + f + ".mockups" : "ed.f." + f));
  });
  ["ed.will.mockups", "ed.did.mockups", "ed.willMake.mockups", "ed.madeDone.mockups", "ed.note.picOutside", "ed.note.picMissing", "ed.note.noPicture"].forEach((k) => keys.push(k));
  [["bind", M.BINDS], ["finish", M.FINISH], ["show_as", M.SHOWS], ["device", M.DEVICES], ["dcolor", M.DCOLS], ["angle", Object.keys(K.ANGLES)], ["place", M.PLACES], ["bg", ["none", "solid", "grad"]], ["surf", M.SURFS]]
    .forEach(([f, vs]) => vs.forEach((v) => keys.push("ed.v.mk." + f + "." + v)));
  M.PAPERS.filter((x) => x.k !== "custom").forEach((x) => keys.push("ed.v.mk.paper." + x.k));
  const missing = keys.filter((k) => !has(as, k, 2) || !has(de, k, 1));
  assert.deepStrictEqual(missing, []);
  // Mockups' host for the commands
  const mk = read("mockups/mockups.js");
  assert.match(mk, /window\.MockupsAssistHost = /);
  assert.match(mk, /window\.__orosOpenAt = openTargetAll/);
});
