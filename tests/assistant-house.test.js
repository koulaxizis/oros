// Assistant → Layout house style (AS-HS): learn_house_style,
// layout_book and add_house_rule, their cards and the report Layout
// sends back (numbers only, never the book's text).
// Run: node --test tests/assistant-house.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../assistant/core.js");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const FILES = [
  { id: "a9", name: "Manuscript.docx", type: "", size: 900000, kept: true },
  { id: "a8", name: "cover.jpg", type: "image/jpeg", size: 10, kept: true },
  { id: "a7", name: "old.odt", type: "", size: 10, kept: false }
];

test("offered with Layout; the prompt says when, and that words never change", () => {
  const names = (o) => C.toolsFor(o).map((t) => t.name);
  assert.deepEqual(names({ house: true }), ["learn_house_style", "layout_book", "add_house_rule"]);
  assert.ok(!names({}).includes("layout_book"));
  const book = C.toolsFor({ house: true })[1];
  assert.deepEqual(book.params.required, ["manuscript"]);
  assert.deepEqual(C.toolsFor({ house: true })[2].params.properties.does.enum, C.HS_DOES);
  const sp = C.systemPrompt({ lang: "en", now: Date.now(), apps: ["Layout (layout)"], house: true });
  assert.match(sp, /learn_house_style learns the series' house style .* layout_book lays out a new book .* add_house_rule/);
  assert.match(sp, /words are never changed/);
  assert.doesNotMatch(C.systemPrompt({ lang: "en", now: Date.now(), apps: [] }), /layout_book/);
});

test("learn_house_style: names, without doubles; none is a refusal", () => {
  const r = C.normHouse("learn_house_style", { documents: [" Book one ", "book ONE", "Book two"], name: "Series" }, []);
  assert.deepEqual(r, { ok: true, op: "learn", docs: ["Book one", "Book two"], name: "Series" });
  assert.match(C.normHouse("learn_house_style", { documents: [] }, []).err, /documents is empty/);
  assert.equal(C.normHouse("learn_house_style", { documents: new Array(60).fill(0).map((_, i) => "B" + i) }, []).docs.length, 40);
});

test("layout_book: the manuscript by name or disk path, the details kept, refusals the model can act on", () => {
  const r = C.normHouse("layout_book", { manuscript: "manuscript", house: "Series", title: " New book ", isbn: "978-618-00-0000-0", colour: "red", keep_front: true }, FILES);
  assert.deepEqual(r, { ok: true, op: "book", doc: { id: "a9", name: "Manuscript.docx" }, house: "Series", meta: { title: "New book", isbn: "978-618-00-0000-0" }, keepFront: true });
  assert.deepEqual(C.normHouse("layout_book", { manuscript: "/internal/Books/new.odt" }, []).doc, { path: "/internal/Books/new.odt", name: "new.odt" });
  assert.equal(C.normHouse("layout_book", { manuscript: "Manuscript.docx", keep_front: "yes" }, FILES).keepFront, false);
  assert.match(C.normHouse("layout_book", { manuscript: "cover.jpg" }, FILES).err, /is not a manuscript/);
  assert.match(C.normHouse("layout_book", { manuscript: "old.odt" }, FILES).err, /no longer available/);
  assert.match(C.normHouse("layout_book", {}, FILES).err, /manuscript is empty.*Attached: Manuscript\.docx/);
  assert.match(C.normHouse("layout_book", { manuscript: "/internal/a.pdf" }, []).err, /must be a manuscript/);
});

test("add_house_rule: the user's words, and what Layout applies only from the list", () => {
  assert.deepEqual(C.normHouse("add_house_rule", { rule: "Each story starts on an odd page", does: "titleOdd" }, []),
    { ok: true, op: "rule", text: "Each story starts on an odd page", does: "titleOdd", house: "" });
  assert.equal(C.normHouse("add_house_rule", { rule: "Poems in italics" }, []).does, "");
  assert.match(C.normHouse("add_house_rule", { rule: "x", does: "italic" }, []).err, /does must be one of titlePage/);
  assert.match(C.normHouse("add_house_rule", { rule: "  " }, []).err, /rule is empty/);
  assert.match(C.normHouse("nope", {}, []).err, /unknown tool/);
});

test("the report: counts only, never the book's text", () => {
  assert.deepEqual(C.houseReport("book", {
    pages: 96, body: 80, titles: 11, guessed: 2, dropped: 4, front: 1, fixes: { quotes: 8, dash: 30, ellipsis: 3, spaces: 1 },
    fields: 4, toc: 11, noStyle: { quote: 3, "a b": 1 }, pictures: 0, check: [{ page: 40, why: "overset", id: "it-x", text: "secret" }], doc: { name: "secret" }
  }), {
    pages: 96, bodyPages: 80, titles: 11, titlesGuessed: 2, emptyLinesDropped: 4, manuscriptFrontLeftOut: 1,
    fixes: { quotes: 8, dashes: 30, ellipses: 3, spaces: 1 }, fieldsFilled: 4, contentsEntries: 11, picturesLeftOut: 0,
    rolesWithoutStyle: ["quote"], pagesToCheck: [{ page: 40, why: "overset" }]
  });
  assert.equal(C.houseReport("book", { toc: -1, check: [] }).contentsEntries, null);
  assert.deepEqual(C.houseReport("learn", { works: 3, front: 4, back: 2, roles: 6, rules: 3, missing: ["Book four"], from: "secret" }),
    { works: 3, frontPages: 4, backPages: 2, roles: 6, rulesFromWorks: 3, missing: ["Book four"] });
  assert.deepEqual(C.houseReport("rule", { changes: 2 }), { added: true, changes: 2 });
  assert.deepEqual(C.houseReport("book", { failed: 1, why: "noHouse" }), { failed: true, why: "noHouse", missing: [] });
  assert.equal(C.houseReport("book", null), null);
});

test("the wiring: the card hands the request to Layout, which runs it and reports back", () => {
  const as = read("assistant/assistant.js");
  assert.match(as, /if \(\/\^\(learn_house_style\|layout_book\|add_house_rule\)\$\/\.test\(call\.name\)\) return Promise\.resolve\(proposeHouse\(c, call\.name, call\.args\)\);/);
  assert.match(as, /p\.__orosOpenAt\("layout", \{ house: rq \}\)/);
  assert.match(as, /r\.ui\.k === "house" && takeHouse\(r, chat\)/);
  assert.match(as, /if \(ui\.k === "house"\) \{ drawHouse\(host, r, c\); return; \}/);
  assert.match(as, /rebuild: rbOn, house: rbOn \}\)/);
  const ly = read("layout/layout.js");
  assert.match(ly, /if \(tg && tg\.house && typeof tg\.house === "object" && \/\^\(learn\|book\|rule\)\$\/\.test\(tg\.house\.op\)\)/);
  assert.match(ly, /LY\.house\.run\(rq, f, back\)/);
  const hu = read("layout/houseui.js");
  assert.match(hu, /LY\.house = \{ open: open, auto: function \(\) \{ autoDlg\(\); \}, hasToc: hasToc, updateToc: updateToc, run: run, hasSheet: hasSheet, sheet: sheetAgain \};/);
  // the reports lead back to the conversation the card came from
  assert.equal(hu.split("backBtn(act, chat, close);").length - 1, 2);
  // the details the Assistant left out come from the Publishing app's title
  assert.match(hu, /if \(pub\) \["subtitle", "author", "isbn", "year"\]\.forEach/);
  // the actions an own rule may take are the Assistant's list
  const acts = /var OWN_ACTS = \[([\s\S]*?)\];/.exec(hu)[1];
  assert.deepEqual([...acts.matchAll(/\["(\w+)"/g)].map((m) => m[1]), C.HS_DOES);
  // every new string in English, Greek and German
  const de = read("i18n/de/assistant.js");
  ["hs.head.learn", "hs.head.book", "hs.head.rule", "hs.docs", "hs.in", "hs.inOnly", "hs.hint.learn", "hs.hint.book", "hs.hint.rule",
   "hs.go.learn", "hs.go.book", "hs.go.rule", "hs.working", "hs.failed", "hs.noHouse", "hs.noDocs", "hs.missing", "hs.repLearn",
   "hs.repBook", "hs.repFixes", "hs.repRule", "hs.check", "hs.next"].forEach((k) => {
    assert.equal(as.split('"' + k + '":').length - 1, 2, k + " in EN and EL");
    assert.ok(de.includes('"' + k + '":'), k + " in DE");
  });
});
