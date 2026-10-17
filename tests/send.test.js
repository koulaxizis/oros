// "Send to an app" (send/core.js, BR-SEND): the kind normalizers, which
// installed apps the sheet offers, the targets it hands to each app's
// own deep link, and the receiving apps' code that those targets rely on.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "send/core.js"));
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const ALL = C.ORDER.slice();

test("text: control characters out, CRLF → LF, title one line, empty text refused", () => {
  const d = C.norm("text", { title: "  My\n\tpage\u0000 ", text: "a\r\nb\u0007c\u2028d" });
  assert.deepEqual(d, { title: "My page", text: "a\nb c d" });
  assert.equal(C.norm("text", { title: "x", text: "   \n " }), null);
  assert.equal(C.norm("text", { text: 5 }), null);
  assert.equal(C.norm("text", null), null);
  assert.equal(C.norm("nope", { text: "x" }), null);
  assert.equal(C.norm("text", { text: "x".repeat(300000) }).text.length, 200000);
});

test("link: only http(s), capped", () => {
  assert.equal(C.norm("link", { url: "javascript:alert(1)" }), null);
  assert.equal(C.norm("link", { url: "data:text/html,x" }), null);
  assert.equal(C.norm("link", { url: "https://" }), null);
  const d = C.norm("link", { url: " https://example.org/a?b=1 ", title: "Ex", note: "n".repeat(2000) });
  assert.equal(d.url, "https://example.org/a?b=1");
  assert.equal(d.note.length, 1000);
});

test("items and table: caps, junk dropped, nothing usable → null", () => {
  const it = C.norm("items", { title: "Shop", items: [" milk ", { text: "" }, { text: "bread", note: "whole" }, 7, null] });
  assert.deepEqual(it, { title: "Shop", items: [{ text: "milk", note: "" }, { text: "bread", note: "whole" }] });
  assert.equal(C.norm("items", { items: ["", { text: " " }] }), null);
  assert.equal(C.norm("items", { items: Array(300).fill("x") }).items.length, 200);
  const tb = C.norm("table", { name: "T", rows: [["a", 1, NaN, { x: 1 }, "=SUM(A1)"], "bad", []], sum: [1, -1, 1.5, "2"] });
  assert.deepEqual(tb.rows, [["a", 1, "", "", "=SUM(A1)"], []]);
  assert.deepEqual(tb.sum, [1]);
  assert.equal(C.norm("table", { rows: [["", ""]] }), null);
  assert.equal(C.norm("table", { rows: Array(600).fill(["x"]) }).rows.length, 500);
  assert.equal(C.norm("table", { rows: [Array(100).fill(1)] }).rows[0].length, 64);
});

test("the sheet offers installed apps only, never the sender, in ORDER", () => {
  const text = { title: "T", text: "hello\nworld" };
  assert.deepEqual(C.appsFor("text", text, ALL, "notes"),
    ["todo", "writer", "mail", "kanban", "slides", "wiki", "mindmap", "prompter", "flashcards", "assistant", "texttools", "textcase"]);
  assert.deepEqual(C.appsFor("text", text, ["writer", "mail", "calculator"], ""), ["writer", "mail"]);
  assert.deepEqual(C.appsFor("link", { url: "https://a.b" }, ALL, "bookmarks"), ["notes", "todo", "writer", "mail", "kanban", "assistant"]);
  assert.deepEqual(C.appsFor("items", { items: ["a"] }, ALL, ""), ["notes", "todo", "writer", "mail", "kanban", "slides", "spreadsheet", "wiki", "mindmap", "flashcards", "texttools"]);
  assert.deepEqual(C.appsFor("table", { rows: [["a"]] }, ALL, ""), ["writer", "mail", "spreadsheet", "texttools"]);
  assert.deepEqual(C.appsFor("text", { text: "" }, ALL, ""), []);
});

test("Label Maker only for one short line", () => {
  assert.ok(C.appsFor("text", { text: "Pantry: rice" }, ALL, "").includes("labels"));
  assert.ok(!C.appsFor("text", { text: "two\nlines" }, ALL, "").includes("labels"));
  assert.ok(!C.appsFor("text", { text: "x".repeat(41) }, ALL, "").includes("labels"));
  assert.deepEqual(C.target("labels", "text", { text: "  Rice  " }), { text: "Rice" });
  assert.equal(C.target("labels", "text", { text: "a\nb" }), null);
});

test("targets are each app's own deep-link shapes", () => {
  const text = { title: "Plan", text: "- buy milk\n2. call Anna\n\n[x] pay rent" };
  assert.deepEqual(C.target("notes", "text", text), { add: { title: "Plan", text: text.text } });
  assert.deepEqual(C.target("writer", "text", text), { newDoc: { title: "Plan", text: text.text } });
  assert.deepEqual(C.target("todo", "text", text, "Notes"), { addItems: { from: "Notes",
    items: [{ text: "buy milk", note: "" }, { text: "call Anna", note: "" }, { text: "pay rent", note: "" }] } });
  assert.deepEqual(C.target("mail", "text", text), { compose: { subject: "Plan", body: text.text } });
  assert.deepEqual(C.target("assistant", "text", text), { ask: text.text });
  assert.deepEqual(C.target("wiki", "text", text), { addArticle: { t: "Plan", x: text.text } });
  assert.deepEqual(C.target("texttools", "text", text), { text: text.text });
  assert.deepEqual(C.target("textcase", "text", text), { text: text.text });
  assert.equal(C.target("bookmarks", "text", text), null);
  assert.equal(C.target("spreadsheet", "text", text), null);

  const link = { url: "https://ex.org", title: "Ex", note: "why" };
  assert.deepEqual(C.target("bookmarks", "link", link), { add: { url: "https://ex.org", title: "Ex" } });
  assert.deepEqual(C.target("notes", "link", link), { add: { title: "Ex", text: "Ex\nhttps://ex.org\n\nwhy" } });
  assert.deepEqual(C.target("todo", "link", link, "Feeds"), { addItems: { from: "Feeds", items: [{ text: "Ex", note: "https://ex.org\nwhy" }] } });

  const items = { title: "Groceries", items: [{ text: "milk", note: "2 l" }, "bread"] };
  assert.deepEqual(C.target("todo", "items", items, "Meals"), { addItems: { from: "Meals", newList: "Groceries",
    items: [{ text: "milk", note: "2 l" }, { text: "bread", note: "" }] } });
  assert.deepEqual(C.target("spreadsheet", "items", items), { newSheet: { name: "Groceries", rows: [["milk", "2 l"], ["bread"]] } });
  assert.deepEqual(C.target("notes", "items", items).add.text, "- milk (2 l)\n- bread");

  const table = { name: "Hours", rows: [["Day", "h"], ["Mon", 3]], sum: [1] };
  assert.deepEqual(C.target("spreadsheet", "table", table), { newSheet: { name: "Hours", rows: [["Day", "h"], ["Mon", 3]], sum: [1] } });
  assert.deepEqual(C.target("writer", "table", table), { newDoc: { title: "Hours", rows: [["Day", "h"], ["Mon", 3]] } });
});

test("caps follow each receiver's own limit", () => {
  const big = { title: "B", text: "y".repeat(150000) };
  assert.equal(C.target("notes", "text", big).add.text.length, 20000);
  assert.equal(C.target("mail", "text", big).compose.body.length, 20000);
  assert.equal(C.target("assistant", "text", big).ask.length, 20000);
  assert.equal(C.target("writer", "text", big).newDoc.text.length, 150000);
});

test("summary line in both languages", () => {
  assert.equal(C.summary("items", { title: "Shop", items: ["a", "b"] }, "en"), "List · Shop · 2 items");
  assert.equal(C.summary("items", { title: "Shop", items: ["a", "b"] }, "el"), "Λίστα · Shop · 2 στοιχεία");
  assert.equal(C.summary("link", { url: "https://a.b" }, "en"), "Link · https://a.b");
  assert.equal(C.summary("text", { text: "" }, "en"), "");
});

// The receivers really read these shapes (a renamed key would silently
// make the sheet open an app that does nothing).
test("every receiver's app code takes the target it is sent", () => {
  const need = {
    notes: ["notes/notes.js", ["t.add", "t.add.title", "t.add.text"]],
    writer: ["writer/writer.js", ["t.newDoc", "t.newDoc.text", "t.newDoc.title", "t.newDoc.rows"]],
    todo: ["todo/todo.js", ["addItems"]],
    mail: ["mail/mail.js", ["target.compose", "c.subject", "c.body"]],
    assistant: ["assistant/assistant.js", ["tg.ask"]],
    bookmarks: ["bookmarks/bookmarks.js", ["t.add"]],
    wiki: ["wiki/wiki.js", ["target.addArticle", "o.t", "o.x"]],
    spreadsheet: ["spreadsheet/spreadsheet.js", ["tg.newSheet", "p.rows", "p.sum"]],
    texttools: ["texttools/texttools.js", ["tg.text"]],
    textcase: ["textcase/textcase.js", ["target.text"]],
    labels: ["labels/labels.js", ["target.text"]],
    slides: ["slides/app.js", ["tg.outline", "tg.title"]],
    mindmap: ["mindmap/mindmap.js", ["t.pasteText", "t.pasteText.text"]],
    kanban: ["kanban/kanban.js", ["tg.addCards", "T.asCards"]],
    prompter: ["prompter/prompter.js", ["tg.newPrompt", "tg.newPrompt.text"]],
    layout: ["layout/layout.js", ["placeImage"]],
    flashcards: ["flashcards/app.js", ["target.make", "FlashcardsMake"]]
  };
  assert.deepEqual(Object.keys(need).sort(), Object.keys(C.RECEIVERS).sort());
  for (const app of Object.keys(need)) {
    const [file, keys] = need[app];
    const s = src(file);
    assert.match(s, /window\.__orosOpenAt\s*=/, app + " has a live deep-link receiver");
    assert.match(s, new RegExp("__orosTakeTarget\\(\\s*['\"]" + app + "['\"]"), app + " takes a staged target at boot");
    for (const k of keys) assert.ok(s.includes(k), app + " reads " + k);
  }
});

test("shell and sheet: loaded on demand, no innerHTML from data", () => {
  const shell = src("shell.js");
  assert.match(shell, /window\.orosSend = \{/);
  assert.match(shell, /load\("send\/core\.js"\)/);
  assert.match(shell, /load\("send\/sheet\.js"\)/);
  assert.doesNotMatch(src("index.html"), /send\/(core|sheet)\.js/);
  const sheet = src("send/sheet.js");
  assert.doesNotMatch(sheet, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.doesNotMatch(src("send/core.js"), /innerHTML|localStorage|sessionStorage|fetch\(/);
});

test("senders: Writer, Notes, Wiki, Mail, Bookmarks, Feeds and the office apps call orosSend", () => {
  for (const f of ["writer/writer.js", "notes/notes.js", "wiki/wiki.js", "mail/mail.js", "bookmarks/bookmarks.js", "feeds/feeds.js",
    "spreadsheet/spreadsheet.js", "slides/editor.js", "mindmap/mindmap.js", "kanban/kanban.js",
    "pixel/pixel.js", "photolab/io.js", "atelier/io.js"]) {
    assert.match(src(f), /orosSend/, f);
  }
});

test("Flashcards takes text, lists, articles and two-column tables (Flashcards wave 4)", () => {
  assert.deepEqual(C.target("flashcards", "text", { title: "Spanish", text: "hola :: hello" }), { make: { title: "Spanish", text: "hola :: hello" } });
  assert.deepEqual(C.target("flashcards", "items", { title: "L", items: [{ text: "perro", note: "dog\nanimal" }, "gato"] }),
    { make: { title: "L", text: "perro :: dog animal\ngato" } });
  // An article from Reader: its text rides in the note; a bare link has nothing to learn.
  assert.deepEqual(C.target("flashcards", "link", { url: "https://a.b", title: "News", note: "The ==sun== is a star." }),
    { make: { title: "News", text: "The ==sun== is a star." } });
  assert.equal(C.target("flashcards", "link", { url: "https://a.b", title: "News" }), null);
  // A table: row 1 is the heading row; at least one later row needs two cells.
  assert.deepEqual(C.target("flashcards", "table", { name: "W", rows: [["Word", "Meaning"], ["perro", "dog"]] }),
    { make: { title: "W", rows: [["Word", "Meaning"], ["perro", "dog"]] } });
  assert.equal(C.target("flashcards", "table", { rows: [["Word", "Meaning"], ["perro", ""]] }), null);
  assert.ok(C.appsFor("table", { rows: [["a", "b"]] }, ALL, "").includes("flashcards"));
});

test("Layout takes one picture from the disk (wave 5)", () => {
  const one = { items: [{ path: "/internal/Pictures/cat.png", name: "cat.png" }] };
  assert.deepEqual(C.appsFor("files", one, ALL, ""), ["mail", "layout"]);
  assert.deepEqual(C.target("layout", "files", one), { placeImage: { path: "/internal/Pictures/cat.png", name: "cat.png" } });
  assert.equal(C.target("layout", "files", { items: [{ path: "/internal/Docs/a.pdf", name: "a.pdf" }] }), null);
  assert.equal(C.target("layout", "files", { items: [one.items[0], { path: "/internal/Pictures/b.jpg", name: "b.jpg" }] }), null);
});
