// The .orosmeals file (Meal Planner): recipes, the plan, shopping ticks
// and own items, the pantry and the "always at home" choices through
// the shared kit (recordpkg.js) and bundle.js; opening adds only what
// is missing, with its ids. "Open as copy" adds the recipes under
// fresh ids. Plus the app wiring (Save, Open, Open as copy, unzipped
// folder, "Open with").
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const C = require(path.join(ROOT, "meals/core.js")).OrosMealsCore;
const P = require(path.join(ROOT, "meals/package.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
// norm drops far-future days with the real clock, so the days here are real ones
const NOW = Date.now() - 60000;
const TODAY = C.localYmd(new Date());
const WK = C.weekStartOf(TODAY, 1);
const canon = (s) => C.mergeMeals(s, s);

function slice() {
  return canon({
    ver: 1,
    rc: [
      { id: "rsoup0001", m: NOW - 900, t: "Carrot soup", e: "🥕", sv: 2, ig: [{ q: 3, u: "", n: "carrots" }, { q: 1, u: "l", n: "water", g: "Broth" }],
        st: ["Boil", "Blend"], no: "Hot", src: "https://example.org/soup", dt: ["vegan"], tg: ["easy"] },
      { id: "rcmd00001", m: NOW - 800, t: "=cmd", sv: 4, ig: [], st: [] }
    ],
    pl: { [TODAY + "|d"]: { m: NOW - 700, it: [{ r: "rsoup0001", sv: 2 }, { t: "Bread" }] } },
    ck: { [WK + "|" + C.keyOf("carrots")]: { v: 1, m: NOW - 600 } },
    mn: [{ id: "n" + C.compactYmd(WK) + "-abcd1", m: NOW - 500, w: WK, t: "Napkins", d: 0 }],
    pa: [{ id: "pa-rice01", m: NOW - 400, n: "Rice", q: 500, u: "g", l: "cupboard", bb: "", bc: "" }],
    pn: { [C.keyOf("olive oil")]: { v: 1, m: NOW - 300, n: "olive oil" } },
    ai: { [C.keyOf("carrots")]: { a: "produce", m: NOW - 200 } },
    nu: { [C.keyOf("rice")]: { s: "tbl", t: "rice", m: NOW - 200 } },
    set: { m: NOW - 100, dt: ["veg"], sl: ["l", "d"], nm: {}, ws: 1 },
    tombs: { rgone0001: NOW - 50 }
  });
}
function otherDevice() {
  return canon({ ver: 1, rc: [{ id: "rpasta001", m: NOW - 40, t: "Pasta", sv: 2, ig: [], st: [] }],
    pl: { [TODAY + "|l"]: { m: NOW - 40, it: [{ t: "Salad" }] } }, ck: {}, mn: [], pa: [], pn: {}, ai: {}, nu: {},
    set: { m: NOW - 40, dt: [], sl: ["b", "l", "d"], nm: {}, ws: 0 }, tombs: {} });
}

test("meals: round trip through bundle.js; the file has no tombstones or settings", async () => {
  const o = K.pack(D, slice(), { title: "Meal Planner", lang: "en", now: NOW });
  assert.equal(o.mime, "application/x-oros-meals");
  assert.equal(o.generator, "orOS Meal Planner");
  assert.deepEqual(Object.keys(o.content.data).sort(), ["ck", "mn", "pa", "pl", "pn", "rc", "ver"]);
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-meals");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-meals-package");
  assert.deepEqual(r.content.data.rc, slice().rc);
  assert.deepEqual(r.content.data.pl, slice().pl);
  // previews: recipes.md (the app's text of each recipe), sorted by title
  const md = o.preview.find((p) => p.name === "recipes.md").data;
  assert.match(md, /^# Recipes\n\n## =cmd\n4 servings\n\nIngredients:\n\n## 🥕 Carrot soup\n2 servings\n\nIngredients:\n- 3 carrots\nBroth:\n- 1 l water\n\nSteps:\n1\. Boil\n2\. Blend\n\nHot\n\nSource: https:\/\/example\.org\/soup\n/);
  assert.ok(!o.preview.some((p) => p.name === "shopping.txt"));          // only with the app's formatter
  const el = K.pack(D, slice(), { lang: "el", now: NOW }).preview.find((p) => p.name === "recipes.md").data;
  assert.match(el, /^# Συνταγές\n\n## =cmd\n4 μερίδες/);
  // the app's formatters: its recipeText and shopAsText
  const fd = P.forLocal(() => null, { recipe: (x) => "T " + x.t + "\nbody", shop: () => "Shopping list\n\nMilk" });
  const o2 = K.pack(fd, slice(), { lang: "en", now: NOW });
  assert.match(o2.preview.find((p) => p.name === "recipes.md").data, /^# Recipes\n\n## T =cmd\nbody\n\n## T Carrot soup\nbody\n/);
  assert.equal(o2.preview.find((p) => p.name === "shopping.txt").data, "Shopping list\n\nMilk");

  // into a device with other data
  const res = K.open(D, otherDevice(), r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 7, skipped: 0, updated: 0 });   // 2 recipes, 1 cell, 1 tick, 1 item, 1 pantry, 1 staple
  assert.deepEqual(res.next.rc.map((x) => x.id).sort(), ["rcmd00001", "rpasta001", "rsoup0001"]);
  assert.deepEqual(Object.keys(res.next.pl).sort(), [TODAY + "|d", TODAY + "|l"]);
  assert.deepEqual(res.next.set, otherDevice().set);                     // settings stay
  assert.deepEqual(res.next.ai, {});
  assert.deepEqual(res.next.tombs, {});
  assert.equal(canon(res.next).rc.length, 3);                             // what commit() keeps
  const by = P.addedByColl(otherDevice(), canon(res.next), res.addedIds);
  assert.deepEqual(by.rc.sort(), ["rcmd00001", "rsoup0001"]);
  assert.deepEqual(by.pl, [TODAY + "|d"]);
  assert.equal(by.ck.length + by.mn.length + by.pa.length + by.pn.length, 4);
  // and again: nothing
  const again = K.open(D, res.next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.equal(again.report.skipped, 7);
  assert.deepEqual(again.next, res.next);
});

test("meals: a clash keeps the local record; deleted stays deleted; update takes newer", () => {
  const theirs = slice();
  const soup = theirs.rc.find((x) => x.id === "rsoup0001");
  soup.t = "Soup from file"; soup.m = NOW - 10;
  theirs.rc.push({ id: "rgone0001", m: NOW - 20, t: "Deleted here", sv: 2, ig: [], st: [], dt: [], tg: [], e: "", c: "", pt: 0, ct: 0, no: "", src: "", fv: 0 });
  theirs.pl[TODAY + "|d"] = { m: NOW - 10, it: [{ t: "Pizza" }] };
  theirs.pl[TODAY + "|b"] = { m: NOW - 10, it: [{ t: "Eggs" }] };
  theirs.tombs = {};
  const mine = slice();
  const c = K.pack(D, theirs, { now: NOW }).content;
  const res = K.open(D, mine, c, { now: NOW });
  assert.deepEqual(res.addedIds, [TODAY + "|b"]);
  assert.equal(res.next.rc.find((x) => x.id === "rsoup0001").t, "Carrot soup");   // kept as it is here
  assert.ok(!res.next.rc.some((x) => x.id === "rgone0001"));                       // deleted here: stays deleted
  assert.deepEqual(res.next.pl[TODAY + "|d"], mine.pl[TODAY + "|d"]);
  assert.deepEqual(res.next.tombs, mine.tombs);
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds.sort(), ["rsoup0001", TODAY + "|d"].sort());
  assert.equal(upd.next.rc.find((x) => x.id === "rsoup0001").t, "Soup from file");
  assert.deepEqual(upd.next.tombs, mine.tombs);
});

test("meals: Open as copy adds the recipes under fresh ids, even ones already here", async () => {
  const bytes = await B.write(K.pack(D, slice(), { now: NOW }));
  const r = await B.read(bytes, { mime: D.mime });
  const mine = slice();
  let n = 0;
  const cd = P.asCopy(() => mine, null, () => "rcopy" + String(++n).padStart(4, "0"));
  const res = K.open(cd, mine, r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 2, skipped: 0, updated: 0 });
  assert.deepEqual(res.addedIds.sort(), ["rcopy0001", "rcopy0002"]);
  assert.equal(res.next.rc.length, 4);
  const copy = res.next.rc.find((x) => x.id === "rcopy0002");
  assert.equal(copy.t, "Carrot soup");
  assert.ok(copy.m > NOW);                                                 // a new record
  assert.deepEqual(res.next.pl, mine.pl);                                  // recipes only
  assert.deepEqual(res.next.pa, mine.pa);
  assert.deepEqual(res.next.tombs, mine.tombs);
  // a taken or malformed id is never used
  const bad = P.asCopy(() => mine, null, () => "rsoup0001");
  assert.equal(K.open(bad, mine, r.content, { now: NOW }).report.added, 0);
  // the default ids fit core.js
  const def = K.open(P.asCopy(() => mine), mine, r.content, { now: NOW });
  assert.equal(def.report.added, 2);
  def.addedIds.forEach((id) => assert.match(id, C.ID_RE));
  // the copy's previews are the recipes as well
  assert.ok(K.pack(cd, slice(), { now: NOW }).preview.some((p) => p.name === "recipes.md"));
});

test("meals: hostile content is cut down", () => {
  const far = Date.now() + 365 * 864e5;
  const farDay = C.addDays(TODAY, P.FUTURE_DAYS + 30);
  const n = D.norm({
    rc: [
      { id: "revil0001", m: far, t: "a\u0000b <script>", sv: 999, ig: [{ q: -1, n: "x" }, "junk", { n: "" }], st: [5, "ok"], img: "javascript:alert(1)", onclick: "x" },
      { id: "BAD ID", m: 1, t: "x" }, { id: "rnotitle1", m: 1, t: "" }, { id: "__proto__", m: 1, t: "x" }
    ],
    pl: { [farDay + "|d"]: { m: 1, it: [{ t: "far" }] }, [TODAY + "|q"]: { m: 1, it: [] }, [TODAY + "|d"]: { m: far, it: [{ r: "../x" }, { t: "ok" }] } },
    ck: { [farDay + "|x"]: { v: 1, m: 1 } },
    mn: [{ id: "n" + C.compactYmd(farDay) + "-abcd1", m: 1, w: farDay, t: "far" }],
    pa: [{ id: "pa-evil01", m: 1, n: "x", l: "roof", bc: "<b>" }],
    pn: { "__proto__": { v: 1, m: 1 } },
    set: { m: far, dt: ["vegan"] }, ai: { x: { a: "produce", m: 1 } }, nu: { x: { s: "x", m: 1 } },
    tombs: { "bad key!": 5 }
  });
  assert.deepEqual(n.rc.map((x) => x.id), ["revil0001"]);
  const x = n.rc[0];
  assert.deepEqual([x.t, x.sv, x.ig.length, x.st, x.img, x.onclick], ["a b <script>", 50, 1, ["ok"], undefined, undefined]);
  assert.deepEqual(Object.keys(n.pl), [TODAY + "|d"]);                    // far-future day and bad slot dropped
  assert.deepEqual(n.pl[TODAY + "|d"].it, [{ t: "ok" }]);
  assert.deepEqual(n.ck, {});
  assert.deepEqual(n.mn, []);
  assert.deepEqual([n.pa[0].l, n.pa[0].bc], ["cupboard", ""]);
  assert.equal(n.set, undefined);
  assert.equal(n.ai, undefined);
  assert.deepEqual(Object.keys(n.pn), []);
  // stamps clamped by the kit
  const res = K.open(D, C.emptyData(), { kind: "oros-meals-package", ver: 1, data: { rc: [{ id: "revil0001", m: far, t: "x" }] } });
  assert.ok(res.next.rc[0].m <= Date.now() + K.FUTURE);
  // only as many new recipes as fit under the app's limit
  const full = C.emptyData();
  for (let i = 0; i < C.LIM.recipes - 1; i++) full.rc.push({ id: "rfull" + String(i).padStart(4, "0"), m: 1, t: "R" + i });
  const two = { kind: "oros-meals-package", ver: 1, data: { rc: [{ id: "rnew00001", m: 1, t: "a" }, { id: "rnew00002", m: 1, t: "b" }] } };
  assert.equal(K.open(P.forLocal(() => full), full, two).report.added, 1);
  assert.equal(K.open(P.asCopy(() => full), full, two).report.added, 1);
  assert.equal(D.norm("x"), null);
  assert.throws(() => K.open(D, slice(), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  assert.throws(() => K.open(D, slice(), { kind: "oros-meals-package", ver: 9, data: {} }), /newer/);
});

test("meals: wiring (scripts, buttons, Open with, help, file types)", () => {
  const html = read("meals/index.html");
  ["../bundle.js?v=", "../recordpkg.js?v=", "package.js?v=", "meals.js?v="].forEach((s) =>
    assert.ok(html.includes('src="' + s), s));
  assert.ok(html.indexOf('src="core.js') < html.indexOf('src="package.js'));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf('src="meals.js'));
  const js = read("meals/meals.js");
  assert.match(js, /RP\.ui\(MPK\.forLocal\(/);
  assert.match(js, /RP\.ui\(MPK\.asCopy\(/);
  ["s-osave", "s-oopen", "s-ocopy", "s-ofolder"].forEach((id) => assert.ok(js.includes('"' + id + '"'), id));
  assert.match(js, /if \(t && t\.openFile\) \{ if \(recFile\) recFile\.openTarget\(t\.openFile\); return; \}/);
  assert.match(js, /__orosTakeFile\(/);
  assert.equal((js.match(/window\.__orosOpenAt\s*=/g) || []).length, 1);
  assert.match(js, /__orosTakeTarget\("meals"\)/);
  for (const f of ["meals/help.en.txt", "meals/help.el.txt"]) assert.ok(read(f).includes(".orosmeals"), f);
  assert.deepEqual(F.appsFor(".orosmeals"), ["meals"]);
  assert.deepEqual(B.TYPES[".orosmeals"], { app: "meals", mime: "application/x-oros-meals" });
});
