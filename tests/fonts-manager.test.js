// orOS Settings › Fonts (FM-1) and what designkit/fonts.js 1.1.0 adds
// for it: WOFF2 unpacking (checked glyph by glyph against the TTF the
// fixtures were made from), letter coverage, the licence a file names,
// the library with PostScript-outline files, removal to the Trash, the
// Fontsource catalog fields, and the Settings wiring (section, search
// rows, strings in every language, lazy loading).
// Fixtures: tests/fixtures/fonts/make.py (Noto Serif subset, SIL OFL).
// Run: node --test tests/fonts-manager.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const F = require(path.join(ROOT, "designkit/fonts.js"));
const FC = require(path.join(ROOT, "files/files-core.js"));
const C = require(path.join(ROOT, "settings/core.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
function ab(p) {
  const b = fs.readFileSync(path.join(ROOT, p));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
const FIX = "tests/fixtures/fonts/";
const REF = ab(FIX + "noto-serif-sub.ttf");

// ---- a small TrueType reader for the checks (independent of fonts.js) ----
function tablesOf(buf) {
  const dv = new DataView(buf), n = dv.getUint16(4), out = {};
  for (let t = 0; t < n; t++) {
    const o = 12 + t * 16, tag = String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
    out[tag] = { off: dv.getUint32(o + 8), len: dv.getUint32(o + 12), sum: dv.getUint32(o + 4) };
  }
  return out;
}
function bytes(buf, tb) { return Buffer.from(new Uint8Array(buf, tb.off, tb.len)); }
// glyph id → { n contours, ends, points [[x, y, on]], comp bytes } (simple glyphs decoded)
function glyphs(buf) {
  const dv = new DataView(buf), tb = tablesOf(buf);
  const nG = dv.getUint16(tb.maxp.off + 4), long = dv.getInt16(tb.head.off + 50) === 1, out = [];
  const loca = (g) => long ? dv.getUint32(tb.loca.off + g * 4) : dv.getUint16(tb.loca.off + g * 2) * 2;
  for (let g = 0; g < nG; g++) {
    const a = loca(g), b = loca(g + 1);
    if (a === b) { out.push(null); continue; }
    let p = tb.glyf.off + a;
    const nc = dv.getInt16(p), box = [dv.getInt16(p + 2), dv.getInt16(p + 4), dv.getInt16(p + 6), dv.getInt16(p + 8)];
    p += 10;
    if (nc < 0) { out.push({ nc, box, comp: Buffer.from(new Uint8Array(buf, p, tb.glyf.off + b - p)).toString("hex").replace(/(00)+$/, "") }); continue; }
    const ends = [];
    for (let c = 0; c < nc; c++) { ends.push(dv.getUint16(p)); p += 2; }
    const il = dv.getUint16(p); p += 2;
    const ins = Buffer.from(new Uint8Array(buf, p, il)).toString("hex"); p += il;
    const np = ends[nc - 1] + 1, fl = [];
    while (fl.length < np) {
      const f = dv.getUint8(p++); fl.push(f);
      if (f & 8) { const r = dv.getUint8(p++); for (let k = 0; k < r; k++) fl.push(f); }
    }
    const xs = [], ys = [];
    let x = 0, y = 0;
    for (let i = 0; i < np; i++) {
      const f = fl[i];
      if (f & 2) { const d = dv.getUint8(p++); x += f & 16 ? d : -d; } else if (!(f & 16)) { x += dv.getInt16(p); p += 2; }
      xs.push(x);
    }
    for (let i = 0; i < np; i++) {
      const f = fl[i];
      if (f & 4) { const d = dv.getUint8(p++); y += f & 32 ? d : -d; } else if (!(f & 32)) { y += dv.getInt16(p); p += 2; }
      ys.push(y);
    }
    out.push({ nc, box, ends, ins, pts: xs.map((v, i) => [v, ys[i], fl[i] & 1, fl[i] & 0x40 ? 1 : 0]) });
  }
  return out;
}
function checksum(u8) {
  let s = 0;
  for (let i = 0; i < u8.length; i += 4) s = (s + (((u8[i] << 24) | ((u8[i + 1] || 0) << 16) | ((u8[i + 2] || 0) << 8) | (u8[i + 3] || 0)) >>> 0)) >>> 0;
  return s;
}

// ---------- WOFF2 ----------
for (const kind of ["hmtx", "null"]) {
  test(`woff2 (${kind === "hmtx" ? "glyf, loca and hmtx transformed" : "null transform"}): the same font as the TTF it came from`, async () => {
    const out = await F.unwoff(ab(FIX + `noto-serif-sub-${kind}.woff2`));
    assert.ok(out && out.byteLength > 1000);
    const a = tablesOf(REF), b = tablesOf(out);
    assert.deepEqual(Object.keys(b).sort(), Object.keys(a).sort(), "same tables");
    for (const tag of Object.keys(a)) {
      if (tag === "glyf" || tag === "loca" || tag === "head") continue;
      assert.ok(bytes(out, b[tag]).equals(bytes(REF, a[tag])), tag + " byte for byte");
    }
    const ga = glyphs(REF), gb = glyphs(out);
    assert.equal(gb.length, ga.length);
    assert.ok(ga.some((g) => g && g.nc < 0), "the fixture has composite glyphs");
    assert.deepEqual(gb, ga, "every glyph: contours, points, on/off curve, overlap flag, instructions, composites");
    // tables sorted, checksums right, whole-font checksum = B1B0AFBA
    const tags = Object.keys(b);
    assert.deepEqual(tags, tags.slice().sort());
    for (const tag of tags) {
      const u = new Uint8Array(out, b[tag].off, b[tag].len).slice();
      if (tag === "head") u.set([0, 0, 0, 0], 8);
      assert.equal(b[tag].sum, checksum(u), tag + " checksum");
    }
    assert.equal(checksum(new Uint8Array(out)), 0xB1B0AFBA);
    assert.equal(F.check(out).ok, true);
    const m1 = T.parseTTF(REF), m2 = T.parseTTF(out);
    assert.deepEqual(m2.map, m1.map);
    assert.deepEqual(Array.from(m2.adv), Array.from(m1.adv));
  });
}

test("woff2: the files orOS ships unpack and keep their family", async () => {
  for (const f of ["nunito-regular", "nunito-bold", "mplusrounded-greek-regular"]) {
    const out = await F.unwoff(ab("fonts/" + f + ".woff2"));
    const c = F.check(out);
    assert.equal(c.ok, true, f);
    assert.match(c.info.family, /Nunito|Mplus|M PLUS/i);
  }
});

test("woff2: damaged, cut or collection files give null, never an exception", async () => {
  const good = new Uint8Array(ab(FIX + "noto-serif-sub-hmtx.woff2"));
  const cut = good.slice(0, 200).buffer;
  const junk = good.slice(); for (let i = 60; i < junk.length; i++) junk[i] ^= 0x5A;
  const ttc = good.slice(); ttc.set([0x74, 0x74, 0x63, 0x66], 4);
  const tiny = good.slice(0, 20).buffer;
  for (const b of [cut, junk.buffer, ttc.buffer]) assert.equal(await F.unwoff(b), null);
  assert.ok(await F.unwoff(tiny) !== null, "under 48 bytes it is not taken for a WOFF2 (check() refuses it later)");
  assert.equal(F.check(tiny).ok, false);
  assert.throws(() => F.woff2(ttc.buffer, () => new Uint8Array(0)), /collection/);
  assert.throws(() => F.woff2(good.buffer, () => new Uint8Array(10)), /woff2/);
});

test("woff2: TTF and WOFF 1.0 still go through as before", async () => {
  assert.equal(await F.unwoff(REF), REF);
});

// ---------- Coverage ----------
test("coverage: Noto Serif has every Greek, polytonic and Latin letter, no Cyrillic", () => {
  const c = F.coverage(ab("vendor/noto/NotoSerif-Regular.ttf"));
  assert.deepEqual(Object.keys(c), F.SET_KEYS);
  assert.deepEqual([c.greek.have, c.greek.total], [70, 70]);
  assert.equal(c.poly.have, c.poly.total);
  assert.equal(c.poly.total, 217);
  assert.equal(c.latin.total, 95);
  assert.equal(c.cyr.have, 0);
  assert.equal(c.cyr.missing.length, 66);
  assert.equal(F.level(c.greek), "full");
  assert.equal(F.level(c.cyr), "none");
});

test("coverage: a subset lists the letters it lacks, in order, at most 80", () => {
  const c = F.coverage(REF);
  assert.ok(c.greek.have > 10 && c.greek.have < 70);
  assert.ok(c.greek.missing.indexOf("Δ") >= 0 && c.greek.missing.indexOf("Α") < 0);
  assert.equal(c.poly.have, 0);
  assert.ok(c.latinExt.missing.length <= 80);
  assert.equal(F.level({ have: 70, total: 70 }), "full");
  assert.equal(F.level({ have: 67, total: 70 }), "most");
  assert.equal(F.level({ have: 30, total: 70 }), "some");
  assert.equal(F.level({ have: 5, total: 70 }), "few");
  assert.equal(F.level({ have: 0, total: 70 }), "none");
  // a code point map works as well as a file
  assert.equal(F.coverage({ map: { 0x391: 1 } }).greek.have, 1);
  assert.deepEqual(F.subsetLevels(["latin", "greek-ext"]), { greek: "none", poly: "full", latin: "full", latinExt: "none", cyr: "none" });
});

// ---------- Licence ----------
test("licence: OFL from the file's own name table, embedding in plain words", () => {
  const l = F.licence(ab("vendor/noto/NotoSerif-Regular.ttf"));
  assert.equal(l.kind, "ofl");
  assert.equal(l.open, true);
  assert.equal(l.embed, "installable");
  assert.equal(l.url, "https://openfontlicense.org");
  assert.match(l.copyright, /Noto Project Authors/);
});

test("licence: Apache text, an address that is not a web page is dropped, fsType bits", () => {
  const l = F.licence(ab(FIX + "noto-serif-sub-apache.ttf"));
  assert.equal(l.kind, "apache");
  assert.equal(l.open, true);
  assert.equal(l.url, "", "javascript: never becomes a link");
  assert.equal(l.embed, "editable");
  assert.equal(l.noSubset, true);
  // the least restrictive bit wins; no bit = installable
  const base = new Uint8Array(REF);
  const os = tablesOf(REF)["OS/2"].off;
  const withFs = (v) => { const u = base.slice(); u[os + 8] = v >> 8; u[os + 9] = v & 255; return F.licence(u.buffer); };
  assert.equal(withFs(0x0002).embed, "restricted");
  assert.equal(withFs(0x0004).embed, "print");
  assert.equal(withFs(0x0006).embed, "print");
  assert.equal(withFs(0x000C).embed, "editable");
  assert.equal(withFs(0x0200).bitmapOnly, true);
  assert.equal(withFs(0x0002).kind, "ofl", "the licence text does not depend on fsType");
});

test("inspect: a font gives info, coverage, licence, outlines; anything else null", () => {
  const r = F.inspect(REF);
  assert.equal(r.cff, false);
  assert.equal(r.info.family.length > 0, true);
  assert.ok(r.glyphs > 10 && r.map[0x41]);
  const cff = F.inspect(ab(FIX + "oros-test-cff.otf"));
  assert.equal(cff.cff, true);
  assert.equal(cff.info.family, "Oros Test CFF");
  assert.equal(F.inspect(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).buffer), null);
});

// ---------- The disk: library, import, remove (browser half in a fake window) ----------
function fakeWindow() {
  const files = new Map();
  const blob = (b) => b instanceof Blob ? b : new Blob([b]);
  const orosFS = {
    ls: async (dir) => [...files.keys()].filter((p) => p.startsWith(dir + "/") && p.slice(dir.length + 1).indexOf("/") < 0).map((p) => ({ name: p.slice(dir.length + 1) })),
    read: async (p) => { if (!files.has(p)) throw new Error("nf"); return files.get(p); },
    write: async (p, b) => { files.set(p, blob(b)); },
    writeText: async (p, s) => { files.set(p, new Blob([s])); },
    stat: async (p) => { if (!files.has(p)) throw new Error("nf"); return { size: files.get(p).size }; },
    mkdir: async () => {},
    mv: async (a, b) => { if (!files.has(a)) throw new Error("nf"); files.set(b, files.get(a)); files.delete(a); },
    rm: async (p) => { files.delete(p); }
  };
  const win = { orosFS, orosDK: { text: T }, OrosFilesCore: FC, crypto: globalThis.crypto, Blob, Response, DecompressionStream, Promise, Uint8Array, DataView, ArrayBuffer, Math, Date, JSON, String, Object, Array, Error, RegExp };
  win.window = win; win.parent = win;
  win.orosBrotli = (require(path.join(ROOT, "vendor/brotli/brotli.min.js")), globalThis.orosBrotli);
  vm.runInNewContext(read("designkit/fonts.js"), win);
  return { win, files, DK: win.orosDK.fonts };
}
const j = (x) => JSON.parse(JSON.stringify(x));   // values from the fake window's realm
function fileOf(p, name) {
  const b = fs.readFileSync(path.join(ROOT, p));
  return { name, size: b.length, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
}

test("disk: a WOFF2 is kept as the TTF it packs; PostScript fonts only with cff, listed only with all", async () => {
  const { DK, files } = fakeWindow();
  const r1 = await DK.importFile(fileOf("fonts/nunito-regular.woff2", "n.woff2"), { cff: true });
  assert.equal(r1.family, "Nunito");
  assert.match(r1.file, /^[0-9a-f]{64}\.ttf$/);
  assert.deepEqual(j(Object.keys(r1).sort()), ["b", "family", "fb", "file", "i", "sub"], "1.0 callers get the same record");
  assert.equal((await DK.importFile(fileOf(FIX + "oros-test-cff.otf", "c.otf"))).err, "outlines", "Layout's import is unchanged");
  const r2 = await DK.importFile(fileOf(FIX + "oros-test-cff.otf", "c.otf"), { cff: true });
  assert.equal(r2.family, "Oros Test CFF");
  assert.equal(files.size, 2);
  const tt = await DK.library(), all = await DK.library({ all: true });
  assert.deepEqual(j(tt.map((x) => x.family)), ["Nunito"], "Layout's library stays TrueType only");
  assert.deepEqual(j(all.map((x) => [x.family, x.cff])), [["Nunito", false], ["Oros Test CFF", true]]);
  assert.ok(all[0].size > 1000);
  assert.deepEqual(j(DK.families(tt).map((x) => x.name)), ["Nunito"]);
  // the same file again writes nothing new
  await DK.importFile(fileOf("fonts/nunito-regular.woff2", "again.woff2"), { cff: true });
  assert.equal(files.size, 2);
});

test("disk: remove() moves the file to the orOS Trash with its record; a failed move leaves no record", async () => {
  const { DK, files, win } = fakeWindow();
  const r = await DK.importFile(fileOf(FIX + "noto-serif-sub.ttf", "s.ttf"));
  await DK.remove(r.file);
  const paths = [...files.keys()];
  assert.ok(!paths.some((p) => p.startsWith("/internal/Fonts/")), "gone from Fonts");
  const meta = paths.find((p) => /^\/internal\/\.trash\/[^/]+\.json$/.test(p));
  const item = paths.find((p) => /^\/internal\/\.trash\/[^/]+\/[0-9a-f]{64}\.ttf$/.test(p));
  assert.ok(meta && item);
  const m = JSON.parse(await files.get(meta).text());
  assert.equal(m.path, "/internal/Fonts/" + r.file);
  assert.deepEqual(j(await DK.library({ all: true })), []);
  await assert.rejects(DK.remove("../../etc"), /badid/);
  // a move that fails takes its record back
  const r2 = await DK.importFile(fileOf(FIX + "noto-serif-sub.ttf", "s.ttf"));
  win.orosFS.mv = async () => { throw new Error("busy"); };
  const before = files.size;
  await assert.rejects(DK.remove(r2.file), /busy/);
  assert.equal(files.size, before);
});

test("catalog: Fontsource entries say polytonic, licence and the variants there are", async () => {
  const saved = global.fetch;
  global.fetch = async () => new Response(JSON.stringify([
    { id: "noto-serif", family: "Noto Serif", subsets: ["latin", "greek", "greek-ext", "cyrillic"], weights: [400, 700], styles: ["normal", "italic"], category: "serif", license: "OFL-1.1" },
    { id: "abel", family: "Abel", subsets: ["latin"], weights: [400], styles: ["normal"], category: "sans-serif", license: "OFL-1.1" },
    { id: "only-it", family: "Only It", subsets: ["latin"], weights: [700], styles: ["italic"], category: "serif" },
    { id: "bad id!", family: "Bad" }
  ]), { status: 200 });
  try {
    const list = await F.catalog();
    assert.deepEqual(list.map((x) => x.id), ["fs_noto_serif", "fs_abel", "fs_only_it"]);
    assert.deepEqual([list[0].greek, list[0].poly, list[0].cyr, list[0].lic], [true, true, true, "OFL-1.1"]);
    assert.deepEqual(list[0].vars, ["r", "i", "b", "bi"]);
    assert.deepEqual(list[1].vars, ["r"]);
    assert.deepEqual(list[2].vars, ["bi"]);
    assert.equal(list[1].poly, false);
    assert.equal(list[2].lic, "");
  } finally { global.fetch = saved; }
});

// ---------- Settings wiring ----------
test("settings: Fonts is a section right after Appearance, with search rows and words in every language", () => {
  assert.equal(C.SECTIONS[1], "fonts");
  assert.equal(C.sectionOf({ section: "fonts" }), "fonts");
  const rows = C.FIND.filter((r) => r[1] === "fonts").map((r) => r[0]);
  assert.deepEqual(rows, ["fm-mine", "fm-install", "fm-free", "fm-cols"]);
  const de = read("i18n/de/settings.js");
  for (const k of ["s.fonts", "d.fonts", "fm.mine", "fm.install", "fm.tab.free", "fm.loading", "fm.loadFail", "w.fm-mine", "w.fm-install", "w.fm-free", "fm.tab.cols", "w.fm-cols"]) {
    assert.ok(C.STRINGS.en[k] && C.STRINGS.el[k], k + " in en and el");
    assert.ok(de.indexOf('"' + k + '"') >= 0, k + " in de");
  }
});

test("settings: the Fonts page's own strings exist in English, Greek and German", () => {
  const src = read("settings/fonts.js");
  const win = { document: { createElement: () => ({ classList: { add() {} }, appendChild() {}, setAttribute() {}, addEventListener() {}, style: {} }) }, localStorage: { getItem: () => null, setItem() {} }, orosDK: { fonts: F } };
  win.window = win;
  vm.runInNewContext(src.replace("var STRINGS = {", "var STRINGS = window.__S = {"), win);
  const S = win.__S, en = Object.keys(S.en).sort();
  assert.deepEqual(Object.keys(S.el).sort(), en);
  const de = read("i18n/de/settings.js");
  const missing = en.filter((k) => de.indexOf('"' + k + '"') < 0);
  assert.deepEqual(missing, []);
  // every t("fm…") the page asks for is defined here or in core.js
  const used = new Set([...src.matchAll(/t\("(fm\.[a-zA-Z.]+)"/g)].map((m) => m[1]).filter((k) => !k.endsWith(".")));
  ["fm.st.r", "fm.st.b", "fm.st.i", "fm.st.bi", "fm.p.greek", "fm.p.poly", "fm.p.latin", "fm.p.nums", "fm.p.own",
    "fm.e.installable", "fm.e.editable", "fm.e.print", "fm.e.restricted", "fm.open.ofl", "fm.open.apache"].forEach((k) => used.add(k));
  F.SET_KEYS.forEach((k) => used.add("fm.c." + k));
  for (const k of used) assert.ok(S.en[k] || C.STRINGS.en[k], k);
});

test("settings: the Fonts page and its libraries load only when the section opens", () => {
  const html = read("settings/index.html"), js = read("settings/settings.js");
  for (const f of ['src="fonts.js', 'href="fonts.css', "designkit/", "files-core.js", "brotli"]) assert.ok(html.indexOf(f) < 0, f + " not on the page at start");
  assert.match(js, /loadScript\("\.\.\/designkit\/text\.js"\)/);
  assert.match(js, /loadScript\("\.\.\/designkit\/fonts\.js"\)/);
  assert.match(js, /loadScript\("\.\.\/files\/files-core\.js"\)/);
  assert.match(js, /loadScript\("fonts\.js"\)/);
  assert.match(js, /fonts: secFonts/);
  // a file's own text never becomes markup
  const page = read("settings/fonts.js");
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(page));
  assert.match(page, /\^https\?:\\\/\\\/\[\^\\s<>"\]\+\$/, "links only for http(s) addresses");
});
