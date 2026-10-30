// Atelier: many files at once (atelier/io.js importMany / importDisk,
// AC5): several files or a .zip of packages from Home › Import, every
// package in a folder of the orOS disk; Home stays open (addDoc stay),
// one toast at the end. The browser run (real packages, a zip with a
// subfolder and a stray file, a folder with a subfolder in Files, one
// file still opening the design) is in the PR; here the wiring.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const io = read("atelier/io.js"), core = read("atelier/core.js"), de = read("i18n/de/atelier.js");

test("Import takes several files and a .zip; the Files folder is on the menu", () => {
  assert.match(io, /function importAny\(\) \{\s*pickFiles\([^)]*\.zip[^)]*\)\s*\.then\(importMany\)/);
  assert.match(io, /inp\.multiple = true/);
  assert.match(io, /dlg\.openFiles\(accept\)/);
  assert.match(core, /\{ label: t\("imp\.disk"\), fn: AT\.io\.importDisk \}/);
  assert.match(io, /importDisk: importDisk, importMany: importMany/);
});

test("in a batch no design opens and no toast but the last one", () => {
  assert.match(core, /function addDoc\(d, stay\) \{[\s\S]*?if \(!stay\) openDoc\(d\.id\);/);
  // every import path adds without opening while batching and speaks through say()
  const adds = io.split("\n").filter((l) => l.includes("AT.addDoc("));
  assert.equal(adds.length, 3);
  adds.forEach((l) => assert.match(l, /, batching\);$/));
  assert.match(io, /function bundleFail\(e\) \{ say\(/);
  const paths = io.slice(io.indexOf("function importPackageObj"), io.indexOf("function importFail"));
  assert.equal((paths.match(/AT\.toast\(/g) || []).length, 0, "import paths use say()");
  assert.match(io, /function say\(msg\) \{ if \(!batching\) AT\.toast\(msg\); \}/);
});

test("limits: zip size, files per batch, folder depth; only packages from a zip or a folder; Trash skipped", () => {
  assert.match(io, /ZIP_MAX = 1024 \* 1024 \* 1024, BATCH_MAX = 500, DEPTH_MAX = 4/);
  assert.match(io, /PKG_RE = \/\\\.\(orosdesign\|pptx\)\$\/i/);
  assert.match(io, /__MACOSX/);
  assert.match(io, /q !== ROOT \+ "\/Trash"/);
});

test("strings EN/EL/DE", () => {
  ["imp.disk", "imp.diskTitle", "imp.diskUp", "imp.diskGo", "imp.diskLooking", "imp.diskFound", "imp.diskNone", "imp.many", "imp.manyBad"].forEach((k) => {
    assert.equal(core.split('"' + k + '"').length - 1, 2 + (k === "imp.disk" ? 1 : 0), "EN+EL " + k);
    assert.ok(de.includes('"' + k + '"'), "DE " + k);
  });
});

test("files picked through the shell's dialog (another window's File) are files, not disk entries", () => {
  // dialogs.js runs in the shell window: its File objects fail this
  // frame's "instanceof Blob", which once sent every picked file to
  // f.get() and ended the batch with "can't be opened" (4.55.00 fix)
  const many = io.slice(io.indexOf("// ---------- Many files at once"), io.indexOf("// Home › Import › From a folder in Files"));
  assert.doesNotMatch(many, /instanceof (Blob|File)/);
  assert.match(many, /function isFile\(f\) \{ return !!f && typeof f\.arrayBuffer === "function" && typeof f\.slice === "function"; \}/);
  assert.match(many, /files\.length === 1 && isFile\(files\[0\]\)/);
  // a sync throw from get() stays inside the per-file catch
  assert.match(many, /return Promise\.resolve\(\)\.then\(function \(\) \{ return isFile\(f\) \? f : f\.get\(\); \}\)/);
});
