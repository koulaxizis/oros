// Atelier Design from a description and Magic animate
// (magicdesign.js): which templates fit, the photo words, the
// animation rules; and the wiring.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MD = require("../atelier/magicdesign.js");
const TPL = require("../atelier/templates.js");
global.ATELIER_TEMPLATES = TPL;
require("../atelier/templates-more.js");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("guessCats: the kind of design, in English and Greek", () => {
  assert.deepEqual(MD.guessCats("An Instagram post for a bakery"), ["social"]);
  assert.deepEqual(MD.guessCats("Αφίσα για συναυλία"), ["poster"]);
  assert.deepEqual(MD.guessCats("πρόσκληση γάμου"), ["invite"]);
  assert.deepEqual(MD.guessCats("μενού για ταβέρνα"), ["menu"]);
  assert.deepEqual(MD.guessCats("story για εκπτώσεις"), ["story"]);
  assert.deepEqual(MD.guessCats("birthday card"), ["invite"]);
  assert.deepEqual(MD.guessCats("επαγγελματική κάρτα"), ["biz"]);
  assert.deepEqual(MD.guessCats("something nice"), []);
});

test("pickTemplates: three different ones, the named kind first", () => {
  const list = TPL.list;
  assert.ok(list.length > 20);
  const menu = MD.pickTemplates("μενού για ταβέρνα στη Νάξο", list, 3);
  assert.equal(menu.length, 3);
  assert.equal(new Set(menu.map((x) => x.id)).size, 3);
  assert.equal(menu[0].cat, "menu");
  const poster = MD.pickTemplates("A poster for a jazz concert", list, 3);
  assert.equal(poster[0].cat, "poster");
  const any = MD.pickTemplates("hello", list, 3);
  assert.equal(any.length, 3);
  assert.equal(any[0].cat, "social");
});

test("photoWords: short, clean search words", () => {
  assert.equal(MD.photoWords({ photo: "fresh bread, bakery <b>window</b> sunrise morning light" }), "fresh bread bakery b window");
  assert.equal(MD.photoWords({}), "");
  assert.equal(MD.photoWords(null), "");
});

test("animPlan: headline rises, texts fade, small things pop, backgrounds stay", () => {
  const doc = { setup: { w: 1920, h: 1080 }, items: [
    { id: "bg1", pg: "p1", w: 1920, h: 1080, ax: { k: "shape", bg: 1 } },
    { id: "big", pg: "p1", w: 1600, h: 900, y: 0, ax: { k: "shape" } },
    { id: "h", pg: "p1", w: 1000, h: 100, y: 100, ax: { k: "text", tx: "Grand opening this Saturday", size: 96 } },
    { id: "b", pg: "p1", w: 1000, h: 100, y: 300, ax: { k: "text", tx: "Fresh bread and coffee from seven in the morning", size: 36 } },
    { id: "l", pg: "p1", w: 200, h: 40, y: 500, ax: { k: "text", tx: "Book now", size: 30 } },
    { id: "i", pg: "p1", w: 80, h: 80, ax: { k: "icon" } },
    { id: "ph", pg: "p1", w: 400, h: 300, ax: { k: "photo", a: "x" } },
    { id: "full", pg: "p1", w: 1920, h: 1080, ax: { k: "photo", a: "y" } },
    { id: "c", pg: "p2", w: 800, h: 500, ax: { k: "chart" } },
    { id: "bg2", pg: "p2", w: 1920, h: 1080, ax: { k: "shape", bg: 1 } }
  ] };
  const plan = MD.animPlan(doc, [{ id: "p1" }, { id: "p2" }]);
  assert.deepEqual(plan.an, { big: "", h: "rise", b: "fade", l: "pop", i: "pop", ph: "fade", full: "", c: "wipe" });
  assert.equal(plan.an.bg1, undefined);
  assert.equal(plan.pages.p1.ptr, "");
  assert.equal(plan.pages.p2.ptr, "push");
  assert.ok(plan.pages.p1.dur >= 4 && plan.pages.p1.dur <= 12);
  assert.equal(plan.pages.p2.dur, 4);
  const one = MD.animPlan({ setup: { w: 1080, h: 1080 }, items: [] }, [{ id: "a" }, { id: "b" }]);
  assert.equal(one.pages.b.ptr, "fade");
});

test("wiring: home bar, Animate panel, index, precache, help", () => {
  const ih = read("atelier/index.html");
  assert.ok(ih.includes('id="home-magic"'));
  assert.ok(ih.indexOf("magicdesign.js") > ih.indexOf("magicai.js"));
  assert.ok(read("sw.js").includes('"atelier/magicdesign.js"'));
  assert.ok(read("atelier/motion.js").includes("AT.magicDesign.section(body)"));
  const ai = read("atelier/ai.js");
  assert.ok(ai.includes("need: need, ask: ask, errText: errText"));
  assert.ok(read("atelier/help.en.txt").includes("`Design from a description`"));
  assert.ok(read("atelier/help.el.txt").includes("`Μαγική κίνηση`"));
});
