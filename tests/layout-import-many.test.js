// Layout: many packages at once (layout/io.js importMany / importDisk,
// layout/zipin.js): several .oroslayout files or a .zip of them from
// Home › Open › A file, every package in a folder of the orOS disk from
// Home › Open › A folder in Files; Home stays open, one toast at the
// end, and the first document that does not fit in storage stops the
// batch. The zip reader is tested here on real zips (stored, deflated,
// a subfolder, the size cap, bad input); the wiring by reading.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const io = read("layout/io.js"), ly = read("layout/layout.js"), de = read("i18n/de/layout.js");
const Z = require(path.join(ROOT, "layout/zipin.js"));

// a minimal zip writer: [{ name, data: Buffer, deflate }]
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function makeZip(files) {
  const locals = [], central = [];
  let off = 0;
  files.forEach((f) => {
    const name = Buffer.from(f.name, "utf8");
    const body = f.deflate ? zlib.deflateRawSync(f.data) : f.data;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6);
    lh.writeUInt16LE(f.deflate ? 8 : 0, 8); lh.writeUInt32LE(crc32(f.data), 14);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8);
    ch.writeUInt16LE(f.deflate ? 8 : 0, 10); ch.writeUInt32LE(crc32(f.data), 16);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(off, 42);
    locals.push(lh, name, body);
    central.push(ch, name);
    off += 30 + name.length + body.length;
  });
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return new Blob([Buffer.concat(locals), cd, end]);
}
const text = (b) => b.text();

test("zipin: stored and deflated entries, a subfolder, folders left out", async () => {
  const a = Buffer.from(JSON.stringify({ kind: "a", pad: "x".repeat(5000) }));
  const b = Buffer.from("second package");
  const zip = makeZip([
    { name: "books/", data: Buffer.alloc(0) },
    { name: "books/one.oroslayout", data: a, deflate: true },
    { name: "two.oroslayout", data: b },
  ]);
  const list = await Z.list(zip);
  assert.deepEqual(list.map((e) => e.name), ["books/one.oroslayout", "two.oroslayout"]);
  assert.equal(list[0].size, a.length);
  assert.equal(await text(await list[0].get(1e6)), a.toString());
  assert.equal(await text(await list[1].get(1e6)), "second package");
});

test("zipin: the size cap holds for stored and deflated entries", async () => {
  const big = Buffer.from("y".repeat(200000));
  const zip = makeZip([{ name: "s.oroslayout", data: big }, { name: "d.oroslayout", data: big, deflate: true }]);
  const [s, d] = await Z.list(zip);
  await assert.rejects(s.get(1000), /toobig/);
  // the deflated entry is tiny on disk; the cap counts what comes out
  await assert.rejects(d.get(1000), /toobig/);
  assert.equal((await d.get(200000)).size, 200000);
});

test("zipin: not a zip, a cut zip and an empty Blob are refused", async () => {
  await assert.rejects(Z.list(new Blob(["just some text, no zip here at all"])), /zip/);
  await assert.rejects(Z.list(new Blob([])), /zip/);
  const whole = Buffer.from(await makeZip([{ name: "a.oroslayout", data: Buffer.from("abc") }]).arrayBuffer());
  // the central directory points past the end once the front is cut off
  await assert.rejects(Z.list(new Blob([whole.subarray(10)])), /zip/);
  await assert.rejects(Z.list(null), /zip/);
});

test("Open › A file takes several packages or a .zip; A folder in Files is on the menu", () => {
  assert.match(io, /var OPEN_ACCEPT = "\.oroslayout,\.zip,application\/zip,/);
  assert.match(io, /if \(files\.every\(isPkgOrZip\) && \(files\.length > 1 \|\| isZip\(files\[0\]\)\)\) return importMany\(files\);/);
  assert.match(ly, /\{ label: t\("imp\.disk"\), fn: function \(\) \{ LY\.io\.importDisk\(\); \} \}/);
  assert.match(io, /importMany: importMany, importDisk: importDisk, packagesIn: packagesIn/);
  assert.match(read("layout/index.html"), /<script src="zipin\.js\?v=[\d.]+"><\/script>/);
  assert.ok(read("sw.js").includes('"layout/zipin.js"'), "zipin.js is precached");
});

test("in a batch no document opens, only the last toast shows, and a full storage stops it", () => {
  assert.match(io, /function say\(msg\) \{ if \(!batch\) LY\.toast\(msg\); \}/);
  assert.match(io, /if \(batch\) \{ batch\.add\(doc, failed, fontsFailed\); return; \}/);
  const paths = io.slice(io.indexOf("function openFile"), io.indexOf("// ---------- Many packages at once"));
  assert.equal((paths.match(/LY\.toast\(/g) || []).length, 1, "only the single-file success toast; failures use say()");
  assert.match(io, /if \(!LY\.addDocQuiet\(doc\)\) \{ res\.full = 1; return; \}/);
  // addDocQuiet: the document is taken back when it does not fit
  assert.match(ly, /function addDocQuiet\(d\) \{[\s\S]*?localStorage\.setItem\(STORAGE_KEY[\s\S]*?catch \(e\) \{\s*data\.docs = data\.docs\.filter\([\s\S]*?return false;/);
  assert.match(ly, /LY\.addDocQuiet = addDocQuiet/);
});

test("limits: files per batch, folder depth; only packages from a zip or a folder; Trash skipped", () => {
  assert.match(io, /BATCH_MAX = 500, DEPTH_MAX = 4, PKG_RE = \/\\\.oroslayout\$\/i/);
  assert.match(io, /__MACOSX/);
  assert.match(io, /e\.get\(PKG_MAX\)/);
  // Files picked through the shell's orosDialog come from another window:
  // instanceof Blob is false there, so a file is told by its methods
  assert.match(io, /typeof f\.arrayBuffer === "function" \? f : f\.get\(\)/);
  assert.doesNotMatch(io, /instanceof (Blob|File)\b/);
  assert.match(io, /q !== ROOT \+ "\/Trash"/);
});

test("strings EN/EL/DE", () => {
  ["imp.disk", "imp.diskTitle", "imp.diskUp", "imp.diskGo", "imp.diskLooking", "imp.diskFound", "imp.diskNone", "imp.manyWorking", "imp.many", "imp.manyBad", "imp.full"].forEach((k) => {
    assert.equal(ly.split('"' + k + '"').length - 1, 2 + (k === "imp.disk" ? 1 : 0), "EN+EL " + k);
    assert.ok(de.includes('"' + k + '"'), "DE " + k);
  });
});
