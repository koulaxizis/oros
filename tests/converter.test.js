// orOS Converter (converter/): the registry (which app converts
// what), recognising a file (extension + first bytes), output names,
// folder names, prefs, deep-link targets; that the registry matches
// each app's convert.js once it exists; the app page wiring (DL-1,
// palette, deep link, [hidden] last, R33) and the Files entry.
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const exists = (f) => fs.existsSync(path.join(ROOT, f));
const R = require(path.join(ROOT, "converter/registry.js"));
const C = require(path.join(ROOT, "converter/core.js"));

test("registry: Writer, Spreadsheet and Flashcards, no extension claimed twice", () => {
  const list = R.list();
  assert.deepEqual(list.map((c) => c.app), ["writer", "spreadsheet", "flashcards"]);
  list.forEach((c) => {
    assert.equal(c.script, c.app + "/convert.js");
    assert.ok(/^\.oros[a-z]+$/.test(c.to), c.to);
    c.from.forEach((x) => assert.ok(/^\.[a-z0-9]+$/.test(x), x));
  });
  const all = list.flatMap((c) => c.from);
  assert.equal(new Set(all).size, all.length, "an extension in two converters");
  assert.deepEqual(R.extensions(), all);
  list[0].from.push(".evil");
  assert.equal(R.forName("a.evil"), null, "list() is a copy");
});

test("registry: a file name or an extension → its converter", () => {
  assert.equal(R.forName("Report.DOCX").app, "writer");
  assert.equal(R.forName("notes.md").to, ".orosdoc");
  assert.equal(R.forName("Budget 2026.xlsx").app, "spreadsheet");
  assert.equal(R.forName("data.csv").to, ".orossheet");
  assert.equal(R.forName(".ods").app, "spreadsheet");
  assert.equal(R.forName("photo.jpg"), null);
  assert.equal(R.forName("Report.orosdoc"), null, "already an orOS file");
  assert.equal(R.forName("README"), null);
  assert.equal(R.forName(""), null);
  assert.equal(R.byApp("writer").to, ".orosdoc");
  assert.equal(R.byApp("nope"), null);
});

// Each app's own module (written by its app) must agree with the
// registry: same target, same extensions, deps that exist.
R.list().forEach((c) => {
  test(`registry matches ${c.script} (when it exists)`, { skip: !exists(c.script) && `${c.script} not there yet` }, () => {
    const src = read(c.script);
    assert.ok(!/localStorage|sessionStorage|indexedDB|registerSlice|orosSync/.test(src.replace(/\/\/.*$/gm, "")),
      c.script + ": a converter never touches storage or sync");
    let mod = null;
    try { mod = require(path.join(ROOT, c.script)); } catch (e) { mod = null; }
    if (!mod || !mod.from) return;     // needs a browser to load: the text checks above are all we can do
    assert.equal(mod.app, c.app);
    assert.equal(mod.to, c.to);
    assert.deepEqual([...mod.from].sort(), [...c.from].sort());
    assert.equal(typeof mod.convert, "function");
    (mod.deps || []).forEach((d) => assert.ok(exists(d), `${c.script}: dep ${d} missing`));
  });
});

test("checkHead: ZIP formats must be ZIPs; RTF must say {\\rtf; orOS bundles are spotted", () => {
  const pk = [0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0];
  assert.equal(C.checkHead(".docx", Uint8Array.from(pk)), "");
  assert.equal(C.checkHead(".xlsx", Uint8Array.from(pk)), "");
  assert.equal(C.checkHead(".docx", Buffer.from("Hello, I am text")), "bad");
  assert.equal(C.checkHead(".ods", new Uint8Array(0)), "bad");
  assert.equal(C.checkHead(".rtf", Buffer.from("{\\rtf1\\ansi hello")), "");
  assert.equal(C.checkHead(".rtf", Buffer.from("﻿{\\rtf1")), "");
  assert.equal(C.checkHead(".rtf", Buffer.from("plain words")), "bad");
  assert.equal(C.checkHead(".txt", Buffer.from("anything")), "");
  assert.equal(C.checkHead(".xls", Uint8Array.from(pk)), "", ".xlsx renamed .xls is read too");
  // a real orOS bundle head: stored "mimetype" first
  const mt = Buffer.from("application/x-oros-doc");
  const head = Buffer.alloc(30 + 8 + mt.length);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(0, 8);
  head.writeUInt32LE(mt.length, 18);
  head.writeUInt16LE(8, 26);
  head.write("mimetype", 30, "ascii");
  mt.copy(head, 38);
  assert.equal(C.checkHead(".docx", head), "oros");
});

test("names: clean, the target extension, unique within a set", () => {
  assert.equal(C.cleanName(' a/b\\c:d*e?"f<g>h|i\u0001 '), "a_b_c_d_e__f_g_h_i");
  assert.equal(C.cleanName("..."), "");
  const long = C.cleanName("x".repeat(300) + ".orosdoc");
  assert.equal(long.length, 120);
  assert.ok(long.endsWith(".orosdoc"));
  assert.equal(C.outName("Report.orosdoc", "Report.docx", ".orosdoc"), "Report.orosdoc");
  assert.equal(C.outName("", "Q3 sales.xlsx", ".orossheet"), "Q3 sales.orossheet");
  assert.equal(C.outName("evil/../x.html", "Report.docx", ".orosdoc"), "Report.orosdoc", "a name with the wrong extension is not used");
  assert.equal(C.outName("Report.OROSDOC", "r.docx", ".orosdoc"), "Report.OROSDOC");
  assert.equal(C.outName(null, ".docx", ".orosdoc"), "Untitled.orosdoc");
  const taken = {};
  assert.equal(C.uniqueName("A.orosdoc", taken), "A.orosdoc");
  assert.equal(C.uniqueName("a.orosdoc", taken), "a (2).orosdoc");
  assert.equal(C.uniqueName("A.orosdoc", taken), "A (3).orosdoc");
  assert.equal(C.uniqueName("dir/A.orosdoc", taken), "dir/A.orosdoc");
});

test("folders: relative sub-folder, skipped junk, disk folder and zip name", () => {
  assert.equal(C.relDir("Docs/2024/a.docx"), "Docs/2024");
  assert.equal(C.relDir("a.docx"), "");
  assert.equal(C.relDir("Docs/../x/./a.docx"), "Docs/x");
  assert.equal(C.relDir("A:B/c.docx"), "A_B");
  assert.ok(C.skipInFolder("~$Report.docx"));
  assert.ok(C.skipInFolder(".DS_Store"));
  assert.ok(!C.skipInFolder("Report.docx"));
  const d = new Date(2026, 9, 5, 23, 59);
  assert.equal(C.dateStamp(d), "2026-10-05");
  assert.equal(C.diskDir(d), "/internal/Converted/2026-10-05");
  assert.equal(C.zipName(d, "en"), "orOS converted 2026-10-05.zip");
  assert.equal(C.zipName(d, "el"), "orOS μετατροπές 2026-10-05.zip");
});

test("sizes, prefs, error codes, summary", () => {
  assert.equal(C.fmtSize(512, "en"), "512 B");
  assert.equal(C.fmtSize(1536, "en"), "1.5 KB");
  assert.equal(C.fmtSize(1536, "el"), "1,5 KB");
  assert.equal(C.fmtSize(250 * 1024 * 1024, "en"), "250 MB");
  assert.deepEqual(C.readPrefs(null), { out: "zip" });
  assert.deepEqual(C.readPrefs({ out: "folder", junk: 1 }), { out: "folder" });
  assert.deepEqual(C.readPrefs({ out: "cloud" }), { out: "zip" });
  const e = (code) => Object.assign(new Error("x"), { code });
  assert.equal(C.errorCode(e("bad")), "bad");
  assert.equal(C.errorCode(e("toobig")), "toobig");
  assert.equal(C.errorCode(e("unsupported")), "unsupported");
  assert.equal(C.errorCode(e("EIO")), "failed");
  assert.equal(C.errorCode(null), "failed");
  const s = C.summary([
    { target: {}, status: "waiting" }, { target: {}, status: "done" }, { target: {}, status: "error" },
    { target: {}, status: "converting" }, { target: null, status: "waiting" }
  ]);
  assert.deepEqual(s, { total: 5, can: 4, waiting: 1, done: 1, error: 1, busy: 1, unsupported: 1 });
});

test("deep-link target: disk paths are checked, tokens are kept short", () => {
  const t = C.parseTarget({ paths: ["/internal/Docs/a.docx", "/internal/Docs/a.docx", "/internal/../etc/x", "/etc/passwd",
    "/internal/.trash/1/a.docx", "/internal/x//y.docx", 42, "/internal/b.xlsx"], openFile: { token: "abc" } });
  assert.deepEqual(t.paths, ["/internal/Docs/a.docx", "/internal/b.xlsx"]);
  assert.equal(t.token, "abc");
  assert.deepEqual(C.parseTarget(null), { paths: [], token: "" });
  assert.deepEqual(C.parseTarget({ paths: "x" }), { paths: [], token: "" });
  const many = Array.from({ length: C.MAX_FILES + 50 }, (_, i) => "/internal/f" + i + ".docx");
  assert.equal(C.parseTarget({ paths: many }).paths.length, C.MAX_FILES);
});

test("app page: DL-1 first, scripts in order, palette, deep link, [hidden] last, prefs device-local", () => {
  const html = read("converter/index.html");
  const first = html.indexOf("<script");
  assert.ok(html.slice(first).startsWith('<script>if (window.top === window.self'), "DL-1 must be the first script");
  assert.ok(html.includes('"../?open=converter"'));
  const order = ["registry.js", "core.js", "../bundle.js", "converter.js"].map((s) => html.indexOf('src="' + s + "?v="));
  order.forEach((i) => assert.ok(i > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  const js = read("converter/converter.js");
  ["inheritPalette", "watchPalette", "__orosTakeTarget(\"converter\")", "window.__orosOpenAt", "orosShortcuts.handle"]
    .forEach((s) => assert.ok(js.includes(s), s));
  assert.ok(!/registerSlice/.test(js), "no synced slice: device-local prefs only");
  assert.ok(!/showSaveFilePicker|showOpenFilePicker/.test(js), "R33: file pickers only through orosDialog");
  assert.ok(js.includes("dlg.saveFile(") && js.includes("dlg.openFiles("));
  assert.equal(C.PREFS_KEY, "oros-converter-prefs");
  const css = read("converter/converter.css").trim();
  assert.ok(css.endsWith("[hidden] { display: none !important; }"));
  ["converter/help.en.txt", "converter/help.el.txt"].forEach((f) => assert.ok(exists(f), f));
  assert.ok(/[α-ω]{4}/.test(read("converter/help.el.txt")), "the Greek page is in Greek");
});

test("app strings: every key in English is in Greek, Greek is Greek", () => {
  const js = read("converter/converter.js");
  const block = (lang) => {
    const a = js.indexOf("\n    " + lang + ": {"), b = js.indexOf("\n    }", a);
    return js.slice(a, b);
  };
  const keys = (s) => [...s.matchAll(/"([a-z][a-zA-Z.]+)":/g)].map((m) => m[1]).sort();
  const en = keys(block("en")), el = keys(block("el"));
  assert.ok(en.length > 40);
  assert.deepEqual(el, en);
  assert.ok(/Μετατροπέας orOS/.test(block("el")));
});

test("Files: Convert to orOS for convertible selections, through the shell deep link", () => {
  const js = read("files/files.js");
  assert.ok(js.includes('"menu.convert":  "Convert to orOS"'));
  assert.ok(js.includes('"menu.convert":  "Μετατροπή σε orOS"'));
  assert.ok(/__orosOpenAt\("converter", \{ paths: paths \}\)/.test(js));
  assert.ok(js.includes("OrosConvertRegistry"));
  const html = read("files/index.html");
  assert.ok(html.indexOf("../converter/registry.js?v=") > 0 && html.indexOf("../converter/registry.js") < html.indexOf('src="files.js'));
  assert.ok(read("files/help.en.txt").includes("`Convert to orOS`"));
  assert.ok(read("files/help.el.txt").includes("`Μετατροπή σε orOS`"));
});
