// App interop wave 3 (BR-SEND-7): the office apps hand things to each
// other through "Send to an app" — Slides outlines, Mind map pastes,
// Kanban cards, Prompter prompts and Writer tables, plus the senders
// in Spreadsheet, Slides, Mind map and Kanban.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "send/core.js"));
const KT = require(path.join(ROOT, "kanban/tools.js"));
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("Slides: Markdown headings start slides, other lines become bullets", () => {
  const t = C.target("slides", "text", { title: "Doc", text: "Intro line\n\n# Part A\n- one\n* two\n    deeper\n# Part B\n1. plain" });
  assert.equal(t.title, "Doc");
  assert.equal(t.outline, "# Doc\n- Intro line\n\n# Part A\n- one\n- two\n    - deeper\n\n# Part B\n- plain\n");
  // a text that starts with its own heading gets no extra title slide
  assert.equal(C.target("slides", "text", { title: "Doc", text: "# Doc\nhi" }).outline, "# Doc\n- hi\n");
});

test("Slides: a list without headings, long runs continue on a new slide", () => {
  const items = Array.from({ length: 10 }, (_, i) => "item " + (i + 1));
  const o = C.target("slides", "items", { title: "List", items }).outline;
  const heads = o.split("\n").filter((l) => l.startsWith("# "));
  assert.deepEqual(heads, ["# List", "# List"]);
  assert.equal(o.split("\n").filter((l) => l.startsWith("- ")).length, 10);
  // a heading-less text is headed by its first line when there is no title
  assert.match(C.target("slides", "text", { text: "first\nsecond" }).outline, /^# first\n- first\n- second\n$/);
});

test("Slides: never more than 300 slides, the outline parses in Slides", () => {
  const text = Array.from({ length: 400 }, (_, i) => "# S" + i).join("\n");
  const o = C.target("slides", "text", { text }).outline;
  assert.equal(o.split("\n").filter((l) => l.startsWith("# ")).length, 300);
});

test("Mind map: the paste dialog gets the text, with a root when it has no heading", () => {
  assert.deepEqual(C.target("mindmap", "text", { title: "Plan", text: "- a\n  - b" }), { pasteText: { text: "# Plan\n- a\n  - b" } });
  assert.deepEqual(C.target("mindmap", "text", { title: "Plan", text: "# Root\n- a" }), { pasteText: { text: "# Root\n- a" } });
  assert.deepEqual(C.target("mindmap", "items", { title: "L", items: ["x", "y"] }), { pasteText: { text: "# L\n- x\n- y" } });
  assert.ok(C.target("mindmap", "text", { text: "z".repeat(30000) }).pasteText.text.length <= 20000);
});

test("Kanban: one card per line or item, ≤ 100, then cleaned again by the app", () => {
  const t = C.target("kanban", "items", { title: "Sprint", items: [{ text: "Fix login", note: "see mail" }, "Ship"] });
  assert.deepEqual(t, { addCards: { title: "Sprint", cards: [{ title: "Fix login", notes: "see mail" }, { title: "Ship", notes: "" }] } });
  const many = C.target("kanban", "text", { text: Array.from({ length: 150 }, (_, i) => "- c" + i).join("\n") });
  assert.equal(many.addCards.cards.length, 100);
  assert.equal(C.target("kanban", "link", { url: "https://a.b/x", title: "Read" }).addCards.cards[0].title, "Read");
  assert.equal(C.target("kanban", "table", { rows: [["a"]] }), null);
  // the app's own cleaner
  assert.deepEqual(KT.asCards({ title: "T", cards: [{ title: " a\u0001\nb ", notes: "n\r\nm\u0002" }, { title: "" }, null, "x"] }),
    { title: "T", cards: [{ title: "a b", notes: "n\nm" }] });
  assert.equal(KT.asCards({ cards: [] }), null);
  assert.equal(KT.asCards({ cards: Array.from({ length: 150 }, () => ({ title: "x" })) }).cards.length, KT.ADD_MAX);
});

test("Prompter takes a text as a new prompt; Writer takes a table; Mail takes a table", () => {
  assert.deepEqual(C.target("prompter", "text", { text: "  Write a poem about {topic}  " }), { newPrompt: { text: "Write a poem about {topic}" } });
  assert.equal(C.target("prompter", "items", { items: ["a"] }), null);
  assert.deepEqual(C.target("writer", "table", { name: "Hours", rows: [["Day", "h"], ["Mon", 3]] }),
    { newDoc: { title: "Hours", rows: [["Day", "h"], ["Mon", 3]] } });
  assert.deepEqual(C.target("mail", "table", { name: "Hours", rows: [["Day", "h"], ["Mon", 3]] }),
    { compose: { subject: "Hours", body: "Day\th\nMon\t3" } });
});

test("receivers: dialogs and editors only, cells escaped, no innerHTML from data", () => {
  const kb = src("kanban/kanban.js");
  const add = kb.slice(kb.indexOf("function addCardsDialog"), kb.indexOf("function sendApi"));
  assert.doesNotMatch(add, /innerHTML/);
  assert.match(add, /pushUndo\("toast\.added"\)/);
  assert.match(add, /form\.addEventListener\("submit"/);
  const wr = src("writer/writer.js");
  const tbl = wr.slice(wr.indexOf("function tableDocHtml"), wr.indexOf("function openSearchTarget"));
  assert.match(tbl, /esc\(v\)/);
  const pr = src("prompter/prompter.js");
  assert.match(pr, /openCustomEditor\(null, \{ text: txt \}\)/);
});

test("senders: what each office app hands over", () => {
  const ss = src("spreadsheet/spreadsheet.js");
  assert.match(ss, /kind: "table", data: \{ name: displayName\(sh\), rows: rows \}/);
  assert.match(ss, /item\(t\("menu\.sendApp"\), sendSelection\)/);
  assert.match(src("slides/editor.js"), /kind: "text", data: \{ title: String\(dk\.t \|\| ""\), text: text \}/);
  assert.match(src("mindmap/mindmap.js"), /M\.toOutline\(subR\(id\)\)/);
  const kb = src("kanban/kanban.js");
  assert.match(kb, /kind: "items", data: \{ title: col\.name, items: col\.cards\.map\(cardItem\) \}/);
  const html = src("kanban/index.html");
  assert.match(html, /id="c-send" hidden/);
  assert.match(html, /id="col-send" hidden/);
  for (const [fs2, k] of [[["spreadsheet/spreadsheet.js"], "menu.sendApp"], [["slides/app.js", "slides/editor.js"], "more.sendApp"],
    [["mindmap/mindmap.js"], "ctx.sendApp"], [["kanban/kanban.js", "kanban/index.html"], "col.send"]]) {
    const all = fs2.map(src).join("\n");
    assert.ok(all.split('"' + k + '"').length - 1 >= 3, fs2[0] + " has " + k + " in EN and EL, and uses it");
  }
});
