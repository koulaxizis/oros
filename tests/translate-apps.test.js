// TRANSLATE wave T3: the Translate panel (translate/panel.js) that Mail,
// Reader, Notes and Montage open, Montage's one-edit subtitle texts and
// do_action translate (the Assistant and the gate, GATE-PAR).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
global.window = global.window || {};
require("../translate/panel.js");
const P = global.window.OrosTranslatePanel;
const C = require("../assistant/core.js");
const M = require("../montage/core.js");

test("the panel has every string in English, Greek and German", () => {
  const en = Object.keys(P.STR.en).sort();
  ["el", "de"].forEach((l) => assert.deepEqual(Object.keys(P.STR[l]).sort(), en, l));
  ["unsupported", "download", "hash", "quota", "pair", "cancelled", "engine", "ai-off", "ai-none", "ai"].forEach((c) =>
    assert.ok(P.STR.en["err." + c], "err." + c));
});

test("the panel loads the engine next to itself and shows text only as text", () => {
  const src = read("translate/panel.js");
  assert.match(src, /BASE\.dir \+ "engine\.js" \+ BASE\.q/);
  assert.doesNotMatch(src, /innerHTML/);
  assert.ok(read("sw.js").includes('"translate/panel.js"'), "precached");
});

test("Mail, Reader, Notes and Montage load the panel on first use", () => {
  [["mail/mail.js", "translateMsg"], ["feeds/feeds.js", "translateArticle"], ["notes/notes.js", "translatePage"],
   ["montage/montage.js", "translateSubtitles"]].forEach(([f, fn]) => {
    const s = read(f);
    assert.ok(s.includes("function " + fn + "("), f);
    assert.ok(s.includes('"../translate/panel.js"'), f + " loads the panel");
    assert.ok(!read(path.dirname(f) + "/index.html").includes("translate/"), f + ": not at start (first-open budget)");
  });
});

test("Montage setTexts: new texts in one edit, timings and styles kept", () => {
  const now = 1700000000000;
  let d = { projects: { p1: { id: "p1", items: {
    a: { id: "a", k: "title", tr: "tt", at: 1, d: 2, m: 5, box: M.SUB_BOX, text: { t: "Hello\nthere", sz: 5.5, col: "#ffffff" } },
    b: { id: "b", k: "title", tr: "tt", at: 4, d: 1, m: 5, box: M.SUB_BOX, text: { t: "Bye", sz: 5.5, col: "#ffffff" } } }, tombs: {} } } };
  d = M.merge(d, null);
  const before = JSON.parse(JSON.stringify(d));
  const out = M.setTexts(d, "p1", { a: "Γεια\nσου", b: "  ", zz: "x" }, now);
  const a0 = before.projects.p1.items.a, a1 = out.projects.p1.items.a;
  assert.equal(a1.text.t, "Γεια\nσου");
  assert.equal(a1.at, a0.at);
  assert.equal(a1.d, a0.d);
  assert.equal(a1.text.col, a0.text.col);
  assert.ok(a1.m > a0.m);
  assert.deepEqual(out.projects.p1.items.b, before.projects.p1.items.b, "an empty text changes nothing");
  assert.deepEqual(d, before, "the input is not changed");
});

test("do_action translate opens Text Tools with the text and the languages", () => {
  const act = (a, has) => C.normAction(a, { has: has || (() => true) });
  const r = act({ kind: "translate", text: "Guten Morgen\nWie geht's?", into: "EL" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.call, { fn: "openAt", args: ["texttools", { group: "translate", text: "Guten Morgen\nWie geht's?", tr: { from: "auto", to: "el" } }] });
  assert.equal(r.view.title, "Guten Morgen");
  assert.deepEqual(r.view.fields, [["into", "el"]]);
  assert.deepEqual(act({ kind: "translate", text: "Hi", from: "en", into: "de" }).view.fields, [["from", "en"], ["into", "de"]]);
  assert.match(act({ kind: "translate", text: " ", into: "de" }).err, /needs text/);
  assert.match(act({ kind: "translate", text: "x".repeat(20001), into: "de" }).err, /20000/);
  assert.match(act({ kind: "translate", text: "Hi", into: "German" }).err, /language code/);
  assert.match(act({ kind: "translate", text: "Hi", from: "de", into: "de" }).err, /same language/);
  assert.match(act({ kind: "translate", text: "Hi", into: "de" }, (id) => id !== "texttools").err, /Text Tools/);
  const tool = C.toolsFor({ actions: ["translate", "open"] }).find((t) => t.name === "do_action");
  assert.ok(tool.params.properties.kind.enum.includes("translate"));
  assert.ok(tool.params.properties.into && tool.params.properties.text);
});

test("Text Tools takes the languages from the target, and the Assistant offers translate only with Text Tools", () => {
  const tt = read("texttools/texttools.js");
  assert.match(tt, /tg\.tr && typeof tg\.tr === "object" && TR/);
  assert.match(read("assistant/assistant.js"), /if \(have\.texttools\) out\.push\("translate"\)/);
});
