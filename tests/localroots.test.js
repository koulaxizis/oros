// Local folders for Claude (LOCAL-1, temporary bridge until after Cyber
// Monday): the pure parts of localroots.js (paths inside a root, free
// names, picture sizes) and the local: paths the Gate tools accept.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const L = require(path.join(ROOT, "localroots.js"));
const C = require(path.join(ROOT, "assistant/core.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const ROOTS = [
  { id: "a", name: "Vythos", label: "C:\\Users\\Chris\\Books\\Vythos", mode: "r" },
  { id: "b", name: "Export", label: "D:\\Export", mode: "w" },
  { id: "c", name: "Vythos photos", label: "", mode: "r" }
];

test("parse: a root by name or by its full path, segments kept", () => {
  assert.deepEqual(L.parse("local:Vythos/photos/01.jpg", ROOTS).rel, ["photos", "01.jpg"]);
  assert.equal(L.parse("local:Vythos/photos/01.jpg", ROOTS).root.id, "a");
  const w = L.parse("local:c:\\users\\chris\\books\\vythos\\photos\\01.jpg", ROOTS);
  assert.equal(w.root.id, "a");
  assert.deepEqual(w.rel, ["photos", "01.jpg"]);
  assert.deepEqual(L.parse("local:Vythos", ROOTS).rel, []);
  // The longest whole-segment prefix wins; "Vythos photos" is its own root.
  assert.equal(L.parse("local:Vythos photos/x.jpg", ROOTS).root.id, "c");
  assert.equal(L.parse("local:Vythosx/a.jpg", ROOTS).err, "notAllowedRoot");
});

test("parse: outside a root, .. and odd names are refused", () => {
  assert.equal(L.parse("/internal/Pictures", ROOTS).err, "notLocal");
  assert.equal(L.parse("local:Other/a.jpg", ROOTS).err, "notAllowedRoot");
  assert.equal(L.parse("local:Vythos/../secret.txt", ROOTS).err, "notAllowedRoot");
  assert.equal(L.parse("local:Vythos/photos/..", ROOTS).err, "notAllowedRoot");
  assert.equal(L.parse("local:C:\\Users\\Chris\\Books\\Vythos\\..\\..\\x", ROOTS).err, "notAllowedRoot");
  assert.equal(L.parse("local:Vythos/./a.jpg", ROOTS).err, "badPath");
  assert.equal(L.parse("local:Vythos/a\u0000b", ROOTS).err, "badPath");
  // A read root is not a write root and the other way round.
  assert.equal(L.parse("local:Vythos/out", ROOTS, "w").err, "notAllowedRoot");
  assert.equal(L.parse("local:Export/proofs", ROOTS, "w").root.id, "b");
  assert.equal(L.parse("local:Export", ROOTS, "r").err, "notAllowedRoot");
});

test("segOk and isLocal", () => {
  assert.equal(L.segOk("01.jpg"), true);
  assert.equal(L.segOk(".."), false);
  assert.equal(L.segOk("."), false);
  assert.equal(L.segOk(" a"), false);
  assert.equal(L.segOk(""), false);
  assert.equal(L.isLocal(" LOCAL:Vythos"), true);
  assert.equal(L.isLocal("/internal/x"), false);
});

test("freeName never overwrites: -2, -3 …", () => {
  assert.equal(L.freeName("Στην καρδιά του βυθού - print.pdf", []), "Στην καρδιά του βυθού - print.pdf");
  assert.equal(L.freeName("a.pdf", ["A.pdf"]), "a-2.pdf");
  assert.equal(L.freeName("a.pdf", ["A.pdf", "a-2.pdf"]), "a-3.pdf");
  assert.equal(L.freeName("notes", ["notes"]), "notes-2");
});

test("rootName and shown", () => {
  assert.equal(L.rootName("Vythos", [{ name: "Vythos" }]), "Vythos-2");
  assert.equal(L.rootName("a:b/c", []), "a b c");
  const now = Date.UTC(2026, 10, 18);
  const s = L.shown({ id: "a", name: "V", mode: "r", exp: now + 2 * 86400000, h: {} }, now);
  assert.equal(s.expired, false);
  assert.equal(s.soon, true);
  assert.equal("h" in s, false);
  assert.equal(L.shown({ id: "a", name: "V", mode: "r", exp: now - 1 }, now).expired, true);
  assert.equal(L.DEF_DAYS, 30);
});

function jpeg(w, h, density) {
  const app0 = [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, density >> 8, density & 255, density >> 8, density & 255, 0, 0];
  const sof = [0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return Uint8Array.from([0xff, 0xd8].concat(app0, sof, [0xff, 0xd9]));
}
function jpegExif(w, h, xres) {
  // Big-endian TIFF: IFD with XResolution (0x011a, RATIONAL) and ResolutionUnit 2.
  const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 2,
    0x01, 0x1a, 0, 5, 0, 0, 0, 1, 0, 0, 0, 38,
    0x01, 0x28, 0, 3, 0, 0, 0, 1, 0, 2, 0, 0,
    0, 0, 0, 0,
    0, 0, xres >> 8, xres & 255, 0, 0, 0, 1];
  const len = 2 + 6 + tiff.length;
  const app1 = [0xff, 0xe1, len >> 8, len & 255, 0x45, 0x78, 0x69, 0x66, 0, 0].concat(tiff);
  const sof = [0xff, 0xc2, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0];
  return Uint8Array.from([0xff, 0xd8].concat(app1, sof));
}
function png(w, h, ppm) {
  const u32 = (n) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  const chunk = (t, d) => u32(d.length).concat([...t].map((c) => c.charCodeAt(0)), d, [0, 0, 0, 0]);
  const ihdr = chunk("IHDR", u32(w).concat(u32(h), [8, 2, 0, 0, 0]));
  const phys = ppm ? chunk("pHYs", u32(ppm).concat(u32(ppm), [1])) : [];
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].concat(ihdr, phys, chunk("IDAT", [0])));
}

test("imageInfo: pixels and ppi from the first bytes", () => {
  assert.deepEqual(L.imageInfo(jpeg(2126, 2953, 300)), { w: 2126, h: 2953, ppi: 300 });
  assert.deepEqual(L.imageInfo(jpegExif(2126, 2953, 300)), { w: 2126, h: 2953, ppi: 300 });
  assert.deepEqual(L.imageInfo(png(800, 600, 11811)), { w: 800, h: 600, ppi: 300 });
  assert.deepEqual(L.imageInfo(png(800, 600, 0)), { w: 800, h: 600, ppi: 0 });
  assert.equal(L.imageInfo(Uint8Array.from([1, 2, 3])), null);
  assert.equal(L.imageInfo(new Uint8Array(40)), null);
});

test("Gate tools take local: paths and refuse the rest", () => {
  assert.equal(C.normPdf({ document: "Β", out: "local:Export" }).out, "local:Export");
  assert.equal(C.normPdf({ document: "Β" }).out, "");
  assert.equal(C.normPdf({ document: "Β", out: "/internal/Layout" }).ok, false);
  assert.equal(C.normPdf({ document: "Β", out: "local:Export/../x" }).ok, false);
  const r = C.normRebuild({ pdf: "/internal/Books/a.pdf", folder: "local:Vythos/photos/" }, []);
  assert.equal(r.ok, true);
  assert.equal(r.folder, "local:Vythos/photos");
  assert.equal(C.normRebuild({ pdf: "/internal/Books/a.pdf", folder: "local:Vythos/../x" }, []).ok, false);
  const rep = C.pdfReport({ doc: "Β", preset: "print", local: "local:Export/Β - print.pdf", localWhy: "nameTaken" });
  assert.equal(rep.local_copy, "local:Export/Β - print.pdf");
  assert.equal(rep.local_copy_failed, "nameTaken");
  assert.equal(C.pdfReport({ doc: "Β", local: "/internal/x.pdf" }).local_copy, undefined);
});

test("wired in: late bundle, offline cache, Gate log, strings in three languages", () => {
  assert.match(read("index.html"), /<script src="localroots\.js\?v=/);
  assert.match(read("sw.js"), /"\.\/localroots\.js"/);
  assert.match(read("gate/gate.js"), /localLog/);
  for (const f of ["translations.js", "i18n/de/shell.js"]) for (const k of ["loc.used", "loc.barOn", "loc.barPaused", "loc.reconnect"]) assert.ok(read(f).includes('"' + k + '"'), f + " " + k);
  for (const f of ["settings/core.js", "i18n/de/settings.js"]) for (const k of ["gt.loc.title", "gt.loc.addRead", "gt.loc.addWrite", "gt.loc.copyIn", "gt.loc.proofs"]) assert.ok(read(f).includes('"' + k + '"'), f + " " + k);
  // The source folder is never written: only write roots take writes.
  const src = read("localroots.js");
  assert.match(src, /function write\(dirPath[\s\S]{0,400}"w"/);
});
