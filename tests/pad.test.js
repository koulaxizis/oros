// Pad (text and code editor): the pure helpers in pad/core.js and the
// EEL2 stream mode in pad/eel2.js, plus the app's contracts that a
// browser test would only catch late (never runs a file, no sync
// slice, every CodeMirror file it may load is precached).
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../pad/core.js");
const EEL = require("../pad/eel2.js");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("every encoding round-trips Greek text exactly", () => {
  const s = "Καλημέρα κόσμε! Άλφα ΐ ΰ ς\nline two\ttab";
  for (const enc of ["utf-8", "utf-8-bom", "utf-16le", "utf-16be", "windows-1253", "iso-8859-7"]) {
    const r = C.encode(s, enc);
    assert.ok(r.bytes, enc);
    assert.equal(C.decode(r.bytes, enc), s, enc);
  }
});

test("the BOM is written once and read back once", () => {
  const r = C.encode("abc", "utf-8-bom");
  assert.deepEqual([...r.bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF]);
  assert.equal(C.detectEncoding(r.bytes, "windows-1253"), "utf-8-bom");
  assert.equal(C.decode(r.bytes, "utf-8-bom"), "abc");
  assert.equal(C.decode(r.bytes, "utf-8"), "abc");
  const u = C.encode("Ωmega", "utf-16le");
  assert.equal(C.detectEncoding(u.bytes, ""), "utf-16le");
  assert.equal(C.detectEncoding(C.encode("Ωmega", "utf-16be").bytes, ""), "utf-16be");
});

test("an old Greek file is not valid UTF-8: the fallback encoding decides", () => {
  const b = C.encode("Ελληνικά", "windows-1253").bytes;
  assert.equal(C.detectEncoding(b, "windows-1253"), "windows-1253");
  assert.equal(C.detectEncoding(b, "iso-8859-7"), "iso-8859-7");
  assert.equal(C.detectEncoding(b, ""), "windows-1252");
  assert.equal(C.detectEncoding(new TextEncoder().encode("Ελληνικά"), "windows-1253"), "utf-8");
});

test("a character with no byte in the encoding is reported, never replaced", () => {
  assert.deepEqual(C.encode("ok\nab☃", "windows-1253").bad, { ch: "☃", line: 2, col: 3 });
  // Browsers read "ISO-8859-1" as Windows-1252 (WHATWG), so € fits both.
  assert.deepEqual(C.encode("€😀", "iso-8859-1").bad, { ch: "😀", line: 1, col: 2 });
  assert.deepEqual(C.encode("x😀", "windows-1252").bad, { ch: "😀", line: 1, col: 2 });
  assert.ok(C.encode("€", "windows-1252").bytes);
});

test("line endings: detected, kept on save, mixed reported", () => {
  assert.deepEqual(C.detectEol("a\r\nb\r\n"), { eol: "crlf", mixed: false });
  assert.deepEqual(C.detectEol("a\nb\r\nc\n"), { eol: "lf", mixed: true });
  assert.deepEqual(C.detectEol("a\rb\r"), { eol: "cr", mixed: false });
  assert.deepEqual(C.detectEol("no newline"), { eol: "lf", mixed: false });
  const lf = C.toLf("a\r\nb\rc\n");
  assert.equal(lf, "a\nb\nc\n");
  assert.equal(C.withEol(lf, "crlf"), "a\r\nb\r\nc\r\n");
  assert.equal(C.withEol(lf, "cr"), "a\rb\rc\r");
  assert.equal(C.withEol("a\r\nb", "lf"), "a\nb");
});

test("indentation is guessed from the text", () => {
  assert.deepEqual(C.detectIndent("a\n\tb\n\t\tc\n"), { tabs: true, size: 4 });
  assert.deepEqual(C.detectIndent("a\n  b\n    c\n  d\n"), { tabs: false, size: 2 });
  assert.deepEqual(C.detectIndent("a\n    b\n        c\n"), { tabs: false, size: 4 });
  assert.equal(C.detectIndent("flat\ntext\n"), null);
});

test("language from the name, then the first line", () => {
  assert.equal(C.guessLang("app.js"), "javascript");
  assert.equal(C.guessLang("x.TSX"), "tsx");
  assert.equal(C.guessLang("/internal/a/b.jsfx-inc"), "eel2");
  assert.equal(C.guessLang("Dockerfile"), "dockerfile");
  assert.equal(C.guessLang("C:\\work\\.gitignore"), "ini");
  assert.equal(C.guessLang("run", "#!/usr/bin/env python3"), "python");
  assert.equal(C.guessLang("run", "#!/bin/bash"), "shell");
  assert.equal(C.guessLang("NULL Gate", "desc:NULL Gate"), "eel2");
  assert.equal(C.guessLang("page", "<!DOCTYPE html>"), "html");
  assert.equal(C.guessLang("notes"), "text");
  for (const l of C.LANGS) assert.equal(C.langInfo(l.id).id, l.id);
  assert.equal(C.langInfo("nope").id, "text");
});

test("names: safe file names and copies next to the original", () => {
  assert.equal(C.safeName("a/b:c?.txt"), "a_b_c_.txt");
  assert.equal(C.safeName("  ..  "), "untitled.txt");
  assert.equal(C.copyName("a.txt", ["a.txt"]), "a (2).txt");
  assert.equal(C.copyName("a.txt", ["A.TXT", "a (2).txt"]), "a (3).txt");
  assert.equal(C.copyName("a (2).txt", ["a (2).txt"]), "a (3).txt");
  assert.equal(C.copyName("Makefile", ["Makefile"]), "Makefile (2)");
  assert.equal(C.untitledName("Untitled", ["Untitled.txt"]), "Untitled 2.txt");
});

test("binary files are spotted, UTF-16 is not binary", () => {
  assert.equal(C.looksBinary(new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 13])), true);
  assert.equal(C.looksBinary(C.encode("hello world, this is text", "utf-16le").bytes), false);
  assert.equal(C.looksBinary(new TextEncoder().encode("plain")), false);
});

test("a stored session is cleaned, never trusted", () => {
  const tab = C.cleanTab({ id: "tabc123", name: "../x", text: "hi", lang: "evil", enc: "koi8", eol: "zz", dirty: 1,
    loc: { kind: "disk", path: "/internal/../etc" }, sel: { a: -5, h: "7" } });
  assert.deepEqual(tab, { id: "tabc123", name: "_x", text: "hi", lang: "text", enc: "utf-8", eol: "lf", dirty: false,
    loc: null, sel: { a: 0, h: 7 }, top: 0, mtime: 0 });
  assert.equal(C.cleanTab({ id: "bad id" }), null);
  const disk = C.cleanLoc({ kind: "disk", path: "/internal/Documents/a.txt", mtime: 5, size: 2, h: "abc:2" });
  assert.deepEqual(disk, { kind: "disk", path: "/internal/Documents/a.txt", mtime: 5, size: 2, h: "abc:2" });
  assert.equal(C.cleanLoc({ kind: "http", path: "https://x" }), null);
  const s = C.cleanSession({ order: ["tabc123", "tabc123", "nope", 4], active: "zzz", recent: [{ kind: "device" }, disk] });
  assert.deepEqual(s, { order: ["tabc123"], active: "tabc123", recent: [disk] });
});

test("the change check: same bytes give the same hash, any change another", () => {
  const a = C.hashBytes(new TextEncoder().encode("one"));
  assert.equal(a, C.hashBytes(new TextEncoder().encode("one")));
  assert.notEqual(a, C.hashBytes(new TextEncoder().encode("onf")));
  assert.notEqual(C.hash("x"), C.hash("y"));
});

// A tiny stand-in for CodeMirror's StringStream, enough for the mode.
function tokens(src) {
  const st = EEL.startState(), out = [];
  for (const line of src.split("\n")) {
    let pos = 0;
    const s = {
      string: line,
      get pos() { return pos; }, set pos(v) { pos = v; },
      start: 0,
      sol() { return pos === 0; },
      eol() { return pos >= line.length; },
      peek() { return line.charAt(pos) || undefined; },
      next() { return pos < line.length ? line.charAt(pos++) : undefined; },
      eatSpace() { const p = pos; while (/\s/.test(line.charAt(pos)) && pos < line.length) pos++; return pos > p; },
      skipToEnd() { pos = line.length; },
      current() { return line.slice(this.start, pos); },
      match(p) {
        if (typeof p === "string") { if (line.startsWith(p, pos)) { pos += p.length; return true; } return false; }
        const m = p.exec(line.slice(pos));
        if (m && m.index === 0) { pos += m[0].length; return m; }
        return null;
      }
    };
    while (pos < line.length) {
      s.start = pos;
      const ty = EEL.token(s, st);
      if (pos === s.start) pos++;
      if (ty) out.push([line.slice(s.start, pos), ty]);
    }
  }
  return out;
}

test("EEL2 mode: header, sections, comments, numbers, keywords", () => {
  const tk = tokens('desc:NULL Gate\nslider1:0<-60,0,1>Threshold\n@init\nfunction f(x) local(y) ( y = $pi * 0x1F; );\n/* block\n still */ spl0 = sin(spl0); // gain\n"str"');
  const find = (text) => tk.find((x) => x[0].trim() === text);
  assert.equal(find("desc:")[1], "meta");
  assert.equal(find("slider1:")[1], "meta");
  assert.equal(find("@init")[1], "heading");
  assert.equal(find("function")[1], "keyword");
  assert.equal(find("local")[1], "keyword");
  assert.equal(find("$pi")[1], "variableName.special");
  assert.equal(find("0x1F")[1], "number");
  assert.equal(find("spl0")[1], "variableName.special");
  assert.equal(find("sin")[1], "variableName.function");
  assert.equal(find("// gain")[1], "comment");
  assert.equal(find('"str"')[1], "string");
  assert.ok(tk.some((x) => x[0] === "/* block" && x[1] === "comment"));
  assert.ok(tk.some((x) => x[0].indexOf("still */") === 1 && x[1] === "comment"));
  // After a section, "slider1:" is code, not a header line.
  const t2 = tokens("@slider\nslider1 = 2;");
  assert.equal(t2.find((x) => x[0] === "slider1")[1], "variableName.special");
});

test("Pad never runs a file and registers no sync slice", () => {
  const src = read("pad/app.js");
  assert.ok(!/registerSlice\s*\(/.test(src), "documents are disk files; tabs stay on the device");
  assert.ok(!/\beval\s*\(|new Function|srcdoc|document\.write/.test(src));
  // innerHTML only ever takes the fixed ICO markup.
  for (const m of src.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)) {
    assert.match(m[1].trim(), /^(ICO[.[]|ICO\b|en\.dir \? ICO|it\.on \? ICO|r\.ico|ICO\[)/, m[1]);
  }
});

test("every CodeMirror file Pad can load is in vendor/ and in the precache", () => {
  const sw = read("sw.js");
  const bundles = new Set(C.LANGS.map((l) => l.bundle).filter(Boolean));
  bundles.add("core");
  for (const b of bundles) {
    const f = "vendor/codemirror/cm-" + b + ".min.js";
    assert.ok(fs.existsSync(path.join(ROOT, f)), f);
    assert.ok(sw.includes('"' + f + '"'), f + " precached");
  }
  for (const f of ["pad/", "pad/index.html", "pad/app.css", "pad/core.js", "pad/eel2.js", "pad/app.js", "pad/help.en.txt", "pad/help.el.txt"]) {
    assert.ok(sw.includes('"' + f + '"'), f + " precached");
  }
  assert.ok(fs.existsSync(path.join(ROOT, "vendor/codemirror/LICENSE")));
  assert.ok(read("CREDITS.md").includes("vendor/codemirror/LICENSE"));
});

test("each language bundle registers the ids core.js routes to it", () => {
  const byBundle = {};
  for (const l of C.LANGS) if (l.bundle) (byBundle[l.bundle] = byBundle[l.bundle] || []).push(l.id);
  for (const [b, ids] of Object.entries(byBundle)) {
    const src = read("vendor/codemirror/build/src/" + b + ".js");
    for (const id of ids) assert.match(src, new RegExp("\\.lang\\." + id + "\\b|\\bL\\." + id + "\\b"), b + ": " + id);
  }
});

test("the factory reset deletes Pad's tab store", () => {
  assert.match(read("shell.js"), /"oros-pad", "oros-assistant", "oros-legacy"\]\.forEach/);
});
