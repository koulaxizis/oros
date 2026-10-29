// Writer commands for the Assistant (writer/commands.js, AS-EDIT,
// wave WR1): the catalog and its guide, checking, the html reader
// (what no command touches comes back byte for byte), picking
// paragraphs, every command on a real document, that the same list
// twice changes nothing more, which documents a request is for, the
// preview counts, the outline for the AI; and the wiring in Writer
// (assist.js) and the Assistant (source, card words in EN, EL and DE).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const CMD = require(path.join(ROOT, "writer/commands.js"));
const C = require(path.join(ROOT, "assistant/core.js"));
const J = (x) => JSON.stringify(x);
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// A document as the browser stores it: a title, a paragraph with bold
// inside a word, a list, a page break, a centred paragraph with a
// footnote, a tracked deletion and a table.
const HTML = '<h1>Report 2025</h1>' +
  '<p>First <b>para</b>graph about orOS &amp; more.</p>' +
  '<ul><li>one</li><li>two orOS</li></ul>' +
  '<div class="page-break-marker" contenteditable="false"></div>' +
  '<p style="text-align: center;">Cen<i>ter</i>ed orOS<sup class="fn-ref" data-fn="f1">1</sup></p>' +
  '<p>Kept <del class="tc" data-tc="t1" data-au="A" data-ts="1">orOS</del> text</p>' +
  '<table><tbody><tr><td>orOS cell</td></tr></tbody></table>';
function rec(over) {
  return Object.assign({ id: "d1", title: "Report", author: "", tags: [], category: "", html: HTML, footnotes: [{ id: "f1", text: "about orOS" }],
    comments: [], versions: [], pageSize: "a4", margins: { top: 25, bottom: 25, left: 25, right: 25 }, header: "orOS header", footer: "", mtime: 5, del: false }, over || {});
}
// Runs commands on a copy → { w, n, notes }
function run(steps, r) {
  const chk = CMD.check(steps);
  assert.ok(chk.ok, chk.err);
  const w = CMD.work(r || rec()), env = { notes: [] };
  let n = 0;
  chk.steps.forEach((st) => { n += CMD.apply(w, st, env); });
  return { w, n, notes: env.notes };
}

test("the guide names every command and field; the tool declares them with one type", () => {
  CMD.ORDER.forEach((op) => {
    assert.match(CMD.GUIDE, new RegExp("\\b" + op + ":"), op);
    Object.keys(CMD.CATALOG[op].args).forEach((k) => assert.match(CMD.GUIDE, new RegExp("\\b" + k + "\\b"), op + "." + k));
  });
  const tool = C.editTool({ writer: CMD });
  const props = tool.params.properties.steps.items.properties;
  CMD.ORDER.forEach((op) => Object.keys(CMD.CATALOG[op].args).forEach((k) => assert.ok(props[k], k)));
  assert.equal(props.paras.type, "string");
  assert.equal(props.para.type, "number");
  assert.match(tool.description, /In Writer paragraphs are picked with paras/);
  assert.ok(C.readAppTool(["writer"]).description.includes("for Writer a document"));
});

test("check: unknown commands, fields and values go back to the model; some commands need a pick", () => {
  assert.match(CMD.check([]).err, /empty/);
  assert.match(CMD.check([{ op: "zap" }]).err, /unknown command "zap"/);
  assert.match(CMD.check([{ op: "rename", title: "x", ids: "a" }]).err, /ids is not a field of rename/);
  assert.match(CMD.check([{ op: "remove" }]).err, /pick the paragraphs/);
  assert.match(CMD.check([{ op: "settext", text: "x" }]).err, /pick the paragraphs/);
  assert.match(CMD.check([{ op: "textstyle", what: "para" }]).err, /give bold/);
  assert.match(CMD.check([{ op: "textstyle", find: "a", bold: "off" }]).err, /only on works/);
  assert.match(CMD.check([{ op: "style", what: "para" }]).err, /give tag or brk/);
  assert.match(CMD.check([{ op: "add", text: "x", at: "after" }]).err, /needs para/);
  assert.match(CMD.check([{ op: "remove", paras: "two" }]).err, /not a paragraph list/);
  assert.match(CMD.check([{ op: "page", t: 101 }]).err, /t 101 is not allowed/);
  assert.match(CMD.check([{ op: "style", what: "para", tag: "h5" }]).err, /tag "h5" is not allowed/);
  assert.ok(CMD.check([{ op: "remove", what: "table" }]).ok);
  assert.equal(CMD.check(new Array(41).fill({ op: "rename", title: "x" })).err, "at most 40 commands");
});

test("the html reader gives back what it read, byte for byte", () => {
  [HTML, '<p>a<br>b&nbsp;c &lt;tag&gt; &quot;q&quot; &#8364; &unknown;</p>', '<!--StartFragment--><p data-x="a>b" class=\'c\'>x</p><img src="a.png" alt="&quot;"><hr/>text <b>loose</b>',
    ''].forEach((h) => assert.equal(CMD.ser(CMD.parse(h)), h));
  // a tag left open is closed where its parent closes (as a browser would)
  assert.equal(CMD.ser(CMD.parse("<p>unclosed <b>bold</p><p>next</p>")), "<p>unclosed <b>bold</b></p><p>next</p>");
});

test("picking: paragraphs by position, kind and words", () => {
  const doc = CMD.parse(HTML), bl = CMD.blocks(doc);
  assert.deepEqual(bl.map((b) => b.kind), ["heading", "para", "item", "item", "para", "para", "table"]);
  const p = (st) => CMD.pick(CMD.parse(HTML), Object.assign({ paras: "", what: "", has: "" }, st)).length;
  assert.equal(p({}), 7);
  assert.equal(p({ paras: "2-4,7" }), 4);
  assert.equal(p({ paras: "odd" }), 4);
  assert.equal(p({ paras: "last", what: "table" }), 1);
  assert.equal(p({ what: "h1" }), 1);
  assert.equal(p({ what: "h2" }), 0);
  assert.equal(p({ what: "item" }), 2);
  assert.equal(p({ has: "ORos" }), 4, "words in any case; a tracked deletion is not text");
  assert.equal(p({ has: "paragraph" }), 1, "words across formatting");
  // loose text at the top is one paragraph
  assert.equal(CMD.blocks(CMD.parse("text <b>loose</b><p>p</p>")).length, 2);
});

test("replace: in the text, across formatting, never in footnote numbers or tracked deletions; header, footer and footnotes when nothing is picked", () => {
  let r = run([{ op: "replace", find: "orOS", repl: "Oros" }]);
  assert.equal(r.n, 6, "3 in the text + 1 in a cell + header + footnote");
  assert.ok(r.w.html.includes('<del class="tc" data-tc="t1" data-au="A" data-ts="1">orOS</del>'));
  assert.ok(r.w.html.includes("Cen<i>ter</i>ed Oros<sup"));
  assert.equal(r.w.header, "Oros header");
  assert.equal(r.w.footnotes[0].text, "about Oros");
  r = run([{ op: "replace", find: "paragraph", repl: "text", what: "para" }]);
  assert.equal(r.n, 1);
  assert.ok(r.w.html.includes("<p>First <b>text</b> about orOS &amp; more.</p>"), "a match across formatting takes the first part's look");
  assert.equal(r.w.header, "orOS header", "a pick keeps it to the paragraphs");
  r = run([{ op: "replace", find: "OROS", repl: "x", cs: true }]);
  assert.equal(r.n, 0);
  r = run([{ op: "replace", find: "or", repl: "x", word: true }]);
  assert.equal(r.n, 0, "whole words only");
  r = run([{ op: "replace", find: "& more", repl: "< less" }]);
  assert.ok(r.w.html.includes("orOS &lt; less.</p>"), "text is written back escaped");
});

test("textstyle: whole paragraphs on and off, only some words with find, alignment", () => {
  let r = run([{ op: "textstyle", what: "item", ital: "on", strike: "on" }]);
  assert.equal(r.n, 2);
  assert.ok(r.w.html.includes("<li><s>one</s></li>".replace("<s>one</s>", "<i><s>one</s></i>")) || r.w.html.includes("<li><s><i>one</i></s></li>"));
  r = run([{ op: "textstyle", paras: "2", bold: "off" }]);
  assert.ok(r.w.html.includes("<p>First paragraph about orOS &amp; more.</p>"));
  r = run([{ op: "textstyle", find: "oros", bold: "on" }]);
  assert.equal(r.n, 4, "the paragraphs holding the word");
  assert.ok(r.w.html.includes("<li>two <b>orOS</b></li>"));
  assert.ok(!r.w.html.includes("<h1><b>"), "a heading is bold already");
  r = run([{ op: "textstyle", find: "para", bold: "on" }]);
  assert.equal(r.n, 0, "already bold: nothing changes");
  r = run([{ op: "textstyle", paras: "1,2", align: "c" }, { op: "textstyle", paras: "5", align: "l" }]);
  assert.ok(r.w.html.startsWith('<h1 style="text-align: center;">Report 2025</h1><p style="text-align: center;">'));
  assert.ok(r.w.html.includes("<p>Cen<i>ter</i>ed"), "left is the default: the style goes");
  r = run([{ op: "textstyle", what: "para", bold: "off" }], rec({ html: '<p style="font-weight: bold; color: red;">a <strong>b</strong> <span style="font-weight: 700;">c</span></p>' }));
  assert.equal(r.w.html, '<p style="color: red;">a b <span>c</span></p>');
});

test("style: paragraph kinds, lists in and out, page breaks", () => {
  let r = run([{ op: "style", what: "h1", tag: "h2" }]);
  assert.ok(r.w.html.startsWith("<h2>Report 2025</h2>"));
  r = run([{ op: "style", paras: "2", tag: "bullet" }]);
  assert.ok(r.w.html.includes("<ul><li>First <b>para</b>graph about orOS &amp; more.</li><li>one</li><li>two orOS</li></ul>"), "joins the list after it");
  r = run([{ op: "style", what: "item", tag: "number" }]);
  assert.ok(r.w.html.includes("<ol><li>one</li><li>two orOS</li></ol>"));
  r = run([{ op: "style", paras: "3", tag: "p" }]);
  assert.ok(r.w.html.includes("</p><p>one</p><ul><li>two orOS</li></ul>"), "an item leaves its list");
  r = run([{ op: "style", what: "quote", tag: "p" }]);
  assert.equal(r.n, 0, "no match");
  assert.deepEqual(r.notes, ["noParas"]);
  r = run([{ op: "style", what: "table", tag: "h1" }]);
  assert.equal(r.n, 0, "a table keeps its kind");
  r = run([{ op: "style", paras: "2", brk: "on" }, { op: "style", paras: "5", brk: "off" }]);
  assert.equal(r.n, 2);
  assert.ok(r.w.html.startsWith('<h1>Report 2025</h1><div class="page-break-marker" contenteditable="false"></div><p>First'));
  assert.ok(r.w.html.includes("</ul><p style"), "the break before paragraph 5 went");
  r = run([{ op: "style", paras: "1", brk: "on" }]);
  assert.equal(r.n, 0, "nothing before the first paragraph");
});

test("add, remove and settext", () => {
  let r = run([{ op: "add", text: "Intro\n\nMore", at: "start" }, { op: "add", text: "The end", tag: "h3" }]);
  assert.equal(r.n, 3);
  assert.ok(r.w.html.startsWith("<p>Intro</p><p>More</p><h1>"));
  assert.ok(r.w.html.endsWith("</table><h3>The end</h3>"));
  r = run([{ op: "add", text: "a\nb", at: "after", para: 3, tag: "bullet" }]);
  assert.ok(r.w.html.includes("<ul><li>one</li><li>a</li><li>b</li><li>two orOS</li></ul>"), "items go into the list");
  r = run([{ op: "add", text: "<b>x</b>", at: "before", para: 2, tag: "quote" }]);
  assert.ok(r.w.html.includes("</h1><blockquote>&lt;b&gt;x&lt;/b&gt;</blockquote><p>First"), "text, never markup");
  r = run([{ op: "remove", what: "item" }]);
  assert.ok(!r.w.html.includes("<ul>"), "an empty list goes");
  r = run([{ op: "remove", has: "centered" }]);
  assert.equal(r.n, 1);
  assert.deepEqual(r.w.footnotes, [], "its footnote goes with it");
  r = run([{ op: "settext", paras: "2", text: "New one\nNew two" }]);
  assert.ok(r.w.html.includes("<p>New one</p><p>New two</p><ul>"));
  r = run([{ op: "settext", what: "h1", text: "Report 2025" }]);
  assert.equal(r.n, 0, "the same text changes nothing");
});

test("page, meta and rename", () => {
  const r = run([{ op: "page", paper: "letter", t: 30, l: 20.4, header: " ", footer: "Page" }, { op: "meta", author: "Chris", tags: "a, b, a", category: "Work", lang: "el" }, { op: "rename", title: "  Final   report " }]);
  assert.equal(r.n, 10);
  assert.equal(r.w.pageSize, "letter");
  assert.deepEqual(r.w.margins, { top: 30, bottom: 25, left: 20, right: 25 });
  assert.equal(r.w.header, "", "a space clears it");
  assert.equal(r.w.footer, "Page");
  assert.deepEqual(r.w.tags, ["a", "b"]);
  assert.equal(r.w.lang, "el");
  assert.equal(r.w.title, "Final report");
  assert.equal(run([{ op: "meta", lang: "auto" }], rec({ lang: "el" })).w.lang, "");
});

test("the same list twice changes nothing more", () => {
  const steps = [{ op: "replace", find: "orOS", repl: "Oros" }, { op: "textstyle", find: "Oros", bold: "on", ital: "on" }, { op: "style", what: "h1", tag: "h2", brk: "on" },
    { op: "style", paras: "2", tag: "number", brk: "on" }, { op: "textstyle", what: "item", under: "on", align: "j" }, { op: "page", paper: "a5", r: 10 }, { op: "meta", tags: "x" }, { op: "rename", title: "R" }];
  const once = run(steps), twice = run(steps, Object.assign(rec(), { html: once.w.html, pageSize: once.w.pageSize, margins: once.w.margins, tags: once.w.tags, title: once.w.title, header: once.w.header, footnotes: once.w.footnotes }));
  assert.ok(once.n > 8);
  assert.equal(twice.n, 0);
  assert.equal(twice.w.html, once.w.html);
});

test("view, targets, preview and the outline for the AI", () => {
  const data = { docs: [rec(), rec({ id: "d2", title: "", html: "<p>Shopping list for Monday</p>", header: "", footnotes: [] }), rec({ id: "d3", title: "Report draft" }), rec({ id: "d4", del: true, title: "Gone" })] };
  const v = CMD.view(data);
  assert.deepEqual(v.docs.map((d) => d.name), ["Report", "Shopping list for Monday", "Report draft"], "an untitled document is named by its first words; deleted ones are left out");
  assert.ok(!J(v.docs).includes("html"), "the record is not copied");
  assert.deepEqual(CMD.targets(v, null, "d2", "open", "").docs, [{ id: "d2", name: "Shopping list for Monday" }]);
  assert.match(CMD.targets(v, null, "", "open", "").err, /no document is open/);
  assert.deepEqual(CMD.targets(v, null, "", "named", "report").docs.map((d) => d.id), ["d1"], "the whole title wins");
  assert.match(CMD.targets(v, null, "", "named", "repo").err, /several documents match/);
  assert.match(CMD.targets(v, null, "", "folder", "x").err, /no folders/);
  assert.match(CMD.targets(v, null, "", "new", "").err, /propose_entry kind document/);
  assert.equal(CMD.targets(v, null, "", "all", "").docs.length, 3);
  const pv = CMD.preview(v, ["d1", "d2"], CMD.check([{ op: "replace", find: "orOS", repl: "x" }, { op: "style", what: "quote", tag: "p" }]).steps);
  assert.deepEqual(pv, { n: 6, d: 1, per: [{ id: "d1", name: "Report", n: 6 }], cut: 0, notes: ["noParas"] });
  assert.equal(data.docs[0].html, HTML, "preview works on copies");
  const o = CMD.outline(v.docs[0]);
  assert.equal(o.paragraphs.length, 7);
  assert.deepEqual(o.paragraphs[0], { n: 1, kind: "h1", text: "Report 2025" });
  assert.deepEqual(o.paragraphs[2], { n: 3, kind: "item", list: "bullet", text: "one" });
  assert.deepEqual(o.paragraphs[4], { n: 5, kind: "para", align: "c", brk: true, text: "Centered orOS" });
  assert.equal(o.paragraphs[5].text, "Kept  text", "a tracked deletion is not text");
  assert.equal(o.words, 16);
  assert.deepEqual(o.footnotes, [{ n: 1, text: "about orOS" }]);
  assert.equal(o.lang, "auto");
});

test("wiring: Writer loads the catalog on the first request and saves through its own pipeline", () => {
  const app = read("writer/writer.js");
  assert.match(app, /t\.edit && typeof t\.edit === 'object'/);
  assert.match(app, /t\.editUndo && typeof t\.editUndo === 'object'/);
  assert.match(app, /load\('commands\.js'\)\)\.then\(\(\) => load\('assist\.js'\)\)/);
  assert.match(app, /window\.WriterAssistHost = \{/);
  const as = read("writer/assist.js");
  assert.match(as, /K\.check\(rq && rq\.steps\)/, "Writer checks the commands again");
  assert.match(as, /H\.sanitize\(w\.html\)/, "the new text goes through Writer's sanitizer");
  assert.match(as, /fp\(stateOf\(d\)\) !== s\.fp/, "a changed document is not undone");
  assert.match(as, /H\.stampDoc\(d, g\)/, "the clocks of the changed groups are stamped");
  const sw = read("sw.js");
  ["writer/commands.js", "writer/assist.js"].forEach((f) => assert.ok(sw.includes('"' + f + '"'), f));
  assert.ok(!read("writer/index.html").includes("commands.js"), "loaded on first use");
  const de = read("i18n/de/writer.js");
  ["as.done", "as.done1", "as.done0", "as.bad", "as.undone", "as.changed", "as.gone"].forEach((k) => {
    assert.equal((app.match(new RegExp("'" + k.replace(".", "\\.") + "':", "g")) || []).length, 2, k);
    assert.ok(de.includes('"' + k + '":'), k);
  });
});

test("wiring: the Assistant reads Writer, and the card speaks of documents and paragraphs in EN, EL and DE", () => {
  assert.ok(!read("assistant/index.html").includes("../writer/"), "loaded on first use");
  const as = read("assistant/assistant.js");
  assert.match(as, /writer: \["\.\.\/writer\/commands\.js"\]/);
  assert.match(as, /writer: \{ mod: "WriterCommands", data: "oros-writer-data", prefs: "oros-writer-prefs", open: "active", view: 1 \}/);
  assert.equal(C.EDIT_APP.writer.noun, "document");
  const de = read("i18n/de/assistant.js");
  const has = (k) => (as.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length === 2;
  const keys = ["ed.will.writer", "ed.did.writer", "ed.sureDel.writer", "ed.note.noParas", "ed.note.untracked"];
  CMD.ORDER.forEach((op) => keys.push(has("ed.op." + op + ".writer") ? "ed.op." + op + ".writer" : "ed.op." + op));
  CMD.ORDER.forEach((op) => Object.keys(CMD.CATALOG[op].args).forEach((k) => keys.push(has("ed.f." + k + ".writer") ? "ed.f." + k + ".writer" : "ed.f." + k)));
  ["what", "tag", "paper", "lang", "strike", "brk", "at", "align", "bold"].forEach((k) => {
    const spec = Object.values(CMD.CATALOG).map((c) => c.args[k]).filter(Boolean)[0];
    spec.v.filter(Boolean).forEach((v) => keys.push("ed.v." + k + "." + v));
  });
  keys.forEach((k) => {
    assert.ok(has(k), "EN + EL " + k);
    assert.ok(de.includes('"' + k + '":'), "DE " + k);
  });
});

test("the catalog runs where the Assistant loads it (browser globals, no Node)", () => {
  const ctx = { window: {}, console };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  ["recipes/core.js", "writer/commands.js"].forEach((f) => vm.runInContext(read(f), ctx, { filename: f }));
  const K = ctx.window.WriterCommands;
  assert.ok(K && typeof K.preview === "function");
  const v = K.view({ docs: [rec()] });
  assert.equal(K.preview(v, ["d1"], K.check([{ op: "page", paper: "a5" }]).steps).n, 1);
});
