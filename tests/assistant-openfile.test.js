// Assistant → Writer with the formatting (WR-FMT): open_file (an attached
// file opened as it is in Writer's Open), propose_entry document in
// Markdown, the honest note for a file that is gone, and the files kept
// in the shell's memory (AS-ATT-MEM).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../assistant/core.js");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const FILES = [
  { id: "a2", name: "Συνέκδοση.pdf", type: "application/pdf", size: 10, kept: true },
  { id: "a1", name: "Contract.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 10, kept: false },
  { id: "a0", name: "photo.jpg", type: "image/jpeg", size: 10, kept: true }
];

test("open_file: the tool is offered only with Writer, and the prompt says when to use it", () => {
  const names = (o) => C.toolsFor(o).map((t) => t.name);
  assert.ok(names({ entries: true, openFile: true }).includes("open_file"));
  assert.ok(!names({ entries: true }).includes("open_file"));
  const tool = C.toolsFor({ openFile: true }).find((t) => t.name === "open_file");
  assert.deepEqual(tool.params.required, ["file"]);
  assert.deepEqual(tool.params.properties.app.enum, ["writer"]);
  const sp = C.systemPrompt({ lang: "en", now: Date.now(), apps: ["Writer (writer)"], entries: ["document"], files: "pdf", openFile: true });
  assert.match(sp, /call open_file with its name/);
  assert.match(sp, /Never retype an attached document/);
  assert.match(sp, /say so in the first sentence of your reply/);
  assert.doesNotMatch(C.systemPrompt({ lang: "en", now: Date.now(), apps: [], files: "pdf" }), /open_file/);
});

test("open_file: the file by name, newest first; types Writer opens; a file that is gone", () => {
  assert.deepEqual(C.normOpenFile({ file: "συνέκδοση.pdf", app: "writer" }, FILES), { ok: true, app: "writer", id: "a2", name: "Συνέκδοση.pdf" });
  assert.equal(C.normOpenFile({ file: "Συνέκδοση" }, FILES).id, "a2", "part of the name, app defaults to Writer");
  const gone = C.normOpenFile({ file: "Contract.docx" }, FILES);
  assert.equal(gone.ok, false);
  assert.match(gone.err, /no longer available.*attach it again/);
  assert.match(C.normOpenFile({ file: "photo.jpg" }, FILES).err, /Writer opens PDF, DOCX/);
  assert.match(C.normOpenFile({ file: "x.pdf" }, FILES).err, /Attached: Συνέκδοση\.pdf, Contract\.docx, photo\.jpg/);
  assert.match(C.normOpenFile({ file: "x.pdf" }, []).err, /attached no file/);
  assert.match(C.normOpenFile({ file: "a.pdf", app: "notes" }, FILES).err, /only Writer/);
  assert.match(C.normOpenFile({}, FILES).err, /file is empty/);
});

test("propose_entry document: Markdown to Writer, the card shows words without marks", () => {
  const text = "# Contract {.center}\n\nThe **parties** agree. {.justify}\n\n1. First\n2. Second";
  const e = C.normEntry({ kind: "document", title: "Contract", text: text }, { has: () => true });
  assert.equal(e.ok, true);
  assert.deepEqual(e.call.args, ["writer", { newDoc: { title: "Contract", text: text, md: true } }]);
  assert.deepEqual(e.view.list, ["Contract", "The parties agree.", "1. First", "2. Second"]);
  const desc = C.toolsFor({ entries: true }).find((t) => t.name === "propose_entry").description;
  assert.match(desc, /document \(title, text: a Writer document you write, in Markdown/);
  assert.match(desc, /\{\.center\}, \{\.right\} or \{\.justify\}/);
  assert.match(desc, /use open_file instead/);
});

test("the files live in the shell's memory, never in storage; Writer reads Markdown and takes files", () => {
  const sh = read("shell.js");
  assert.match(sh, /window\.orosAssistAtt = \{ mem: \{\}, text: \{\}, pages: \{\}, blob: \{\}, rb: \{\} \};/);
  const as = read("assistant/assistant.js");
  assert.match(as, /var attMem = attStore\.mem;/);
  assert.match(as, /var attText = attStore\.text;/);
  assert.match(as, /var attPages = attStore\.pages;/);
  // nothing of a file goes to storage
  assert.doesNotMatch(as, /(localStorage|indexedDB|sessionStorage)[^\n]*(attMem|attBlob)/);
  assert.match(as, /var attBlob = attStore\.blob \|\| \(attStore\.blob = \{\}\);/);
  assert.match(as, /return attMem\[id\] \? new File\(\[b64Bytes\(attMem\[id\]\)\], String\(name \|\| "file"\)\) : null;/);
  assert.match(as, /p\.orosFileOpen\.openIn\(ui\.app, f\)/);
  assert.match(read("fileopen.js"), /openIn: function \(app, file\) \{/);
  const w = read("writer/writer.js");
  assert.match(w, /if \(t\.newDoc\.md === true\) \{\n\s+const md = WriterIO\.parseTextOf\(text, 'md'\);/);
  // every new string in English, Greek and German
  const de = read("i18n/de/assistant.js");
  ["file.head", "file.hint", "file.gone"].forEach((k) => {
    assert.ok(as.split('"' + k + '":').length === 3, k + " in EN and EL");
    assert.ok(de.indexOf('"' + k + '":') > 0, k + " in DE");
  });
});
