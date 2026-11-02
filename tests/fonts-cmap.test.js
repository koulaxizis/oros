// FONTS-CMAP: the vendored Nunito woff2 files in fonts/ must cover the text
// the shell actually draws. Until 5.04.04 the five files held only a
// Latin-extended subset (314 code points from U+0041, then U+00C1): no
// basic a-z, no digits, so every page fell back to the system font while
// DESIGN.md said Nunito. This test reads each file's cmap straight from the
// woff2 (Brotli stream, no dependencies) and checks the coverage and the
// weight each @font-face rule in fonts.css promises (style.css until
// 5.04.05).
// Nunito upstream has no Greek, so Greek comes from M PLUS Rounded 1c
// files declared under the same family with a Greek unicode-range; they
// are checked here too. See DESIGN.md › Typography.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(ROOT, "fonts.css"), "utf8");

// WOFF2 known-table indices used here (spec §5.1 table of known tags).
const T_CMAP = 0, T_OS2 = 6, T_GLYF = 10, T_LOCA = 11;

function base128(buf, pos) {
  let v = 0;
  for (let i = 0; i < 5; i++) {
    const b = buf[pos.p++];
    v = v * 128 + (b & 0x7f);
    if (!(b & 0x80)) return v;
  }
  throw new Error("bad UIntBase128");
}

// Returns { cmap: Buffer, os2: Buffer } from a woff2 file.
function woff2Tables(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.toString("latin1", 0, 4), "wOF2", file + " is not woff2");
  const numTables = buf.readUInt16BE(12);
  const compLen = buf.readUInt32BE(20);
  const pos = { p: 48 };
  const dir = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[pos.p++];
    const idx = flags & 0x3f;
    let tag = null;
    if (idx === 63) { tag = buf.toString("latin1", pos.p, pos.p + 4); pos.p += 4; }
    const ver = (flags >> 6) & 3;
    const orig = base128(buf, pos);
    const transformed = idx === T_GLYF || idx === T_LOCA ? ver === 0 : ver !== 0;
    const len = transformed ? base128(buf, pos) : orig;
    dir.push({ idx, tag, len });
  }
  const data = zlib.brotliDecompressSync(buf.subarray(pos.p, pos.p + compLen));
  const out = {};
  let off = 0;
  for (const t of dir) {
    if (t.idx === T_CMAP) out.cmap = data.subarray(off, off + t.len);
    if (t.idx === T_OS2) out.os2 = data.subarray(off, off + t.len);
    off += t.len;
  }
  return out;
}

// Code points of the best Unicode subtable (format 12, else format 4).
function cmapCodepoints(cmap) {
  const n = cmap.readUInt16BE(2);
  let f4 = -1, f12 = -1;
  for (let i = 0; i < n; i++) {
    const pid = cmap.readUInt16BE(4 + i * 8), eid = cmap.readUInt16BE(6 + i * 8);
    const o = cmap.readUInt32BE(8 + i * 8);
    const fmt = cmap.readUInt16BE(o);
    if (fmt === 12 && (pid === 0 || (pid === 3 && eid === 10))) f12 = o;
    if (fmt === 4 && (pid === 0 || (pid === 3 && eid === 1))) f4 = o;
  }
  const set = new Set();
  if (f12 >= 0) {
    const groups = cmap.readUInt32BE(f12 + 12);
    for (let g = 0; g < groups; g++) {
      const b = f12 + 16 + g * 12;
      const s = cmap.readUInt32BE(b), e = cmap.readUInt32BE(b + 4);
      for (let c = s; c <= e; c++) set.add(c);
    }
    return set;
  }
  assert.ok(f4 >= 0, "no Unicode cmap subtable");
  const segX2 = cmap.readUInt16BE(f4 + 6);
  const ends = f4 + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
  for (let s = 0; s < segX2 / 2; s++) {
    const end = cmap.readUInt16BE(ends + s * 2), start = cmap.readUInt16BE(starts + s * 2);
    const delta = cmap.readInt16BE(deltas + s * 2), ro = cmap.readUInt16BE(ranges + s * 2);
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let gid;
      if (ro === 0) gid = (c + delta) & 0xffff;
      else {
        const g = cmap.readUInt16BE(ranges + s * 2 + ro + (c - start) * 2);
        gid = g === 0 ? 0 : (g + delta) & 0xffff;
      }
      if (gid !== 0) set.add(c);
    }
  }
  return set;
}

// @font-face rules for "Nunito" in fonts.css: file -> weight.
const FACES = [];
const GREEK = [];
for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
  const body = m[1];
  if (!/font-family:\s*"Nunito"/.test(body)) continue;
  const src = /url\("([^"]+)"\)/.exec(body)[1];
  const weight = Number(/font-weight:\s*(\d+)/.exec(body)[1]);
  const range = /unicode-range:\s*([^;]+);/.exec(body);
  (range ? GREEK : FACES).push({ src, weight, range: range && range[1].trim() });
}

const MUST = [];
for (let c = 0x20; c <= 0x7e; c++) MUST.push(c);          // basic Latin, digits, punctuation
for (let c = 0xc0; c <= 0xff; c++) if (c !== 0xd7 && c !== 0xf7) MUST.push(c); // Latin-1 letters
for (const ch of "ĂăĞğİıŁłŐőŚśŠšŰűŻżŽžđČčĆćŘřĚěŮů") MUST.push(ch.codePointAt(0)); // Latin Extended-A
for (const ch of "€–—‘’“”„…•«»·©®™°±×÷") MUST.push(ch.codePointAt(0)); // UI punctuation and symbols
for (const ch of "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЬЮЯабвгдежзийклмнопрстуфхцчшщьюяЁё") MUST.push(ch.codePointAt(0)); // Cyrillic

test("fonts.css declares the five Nunito weights 400-800, each from fonts/", () => {
  assert.deepEqual(FACES.map((f) => f.weight).sort(), [400, 500, 600, 700, 800]);
  for (const f of FACES) assert.match(f.src, /^fonts\/nunito-[a-z]+\.woff2$/);
});

for (const face of FACES) {
  test("fonts cmap: " + face.src + " covers Latin, Latin-ext, digits and Cyrillic", () => {
    const t = woff2Tables(path.join(ROOT, face.src));
    assert.ok(t.cmap && t.os2, face.src + ": cmap or OS/2 missing");
    const cps = cmapCodepoints(t.cmap);
    const missing = MUST.filter((c) => !cps.has(c));
    assert.equal(
      missing.length, 0,
      face.src + " lacks " + missing.length + " code points, e.g. " +
        missing.slice(0, 12).map((c) => "U+" + c.toString(16).toUpperCase().padStart(4, "0") + " " + String.fromCodePoint(c)).join(", ")
    );
  });

  test("fonts weight: " + face.src + " is really weight " + face.weight, () => {
    const t = woff2Tables(path.join(ROOT, face.src));
    assert.equal(t.os2.readUInt16BE(4), face.weight, "OS/2 usWeightClass");
  });
}

// Monotonic and polytonic Greek, Greek question mark and ano teleia.
const GREEK_MUST = [];
for (const ch of "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρσςτυφχψωάέήίόύώΆΈΉΊΌΎΏϊϋΐΰΪΫ\u037e\u0387ἀἁὰᾶῆῶᾳῳ") GREEK_MUST.push(ch.codePointAt(0));

// Each Greek face carries exactly one weight that a Nunito face also has,
// so every weight the shell uses finds Greek in the same family.
test("fonts.css declares the Greek companion at exactly the five Nunito weights", () => {
  assert.deepEqual(GREEK.map((f) => f.weight).sort(), [400, 500, 600, 700, 800]);
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    if (/font-family:\s*"Nunito"/.test(m[1])) assert.match(m[1], /font-weight:\s*\d+;/, "Nunito faces use single weights, no ranges");
  }
  for (const f of GREEK) {
    assert.match(f.src, /^fonts\/mplusrounded-greek-[a-z]+\.woff2$/);
    assert.equal(f.range, "U+0370-03FF, U+1F00-1FFF");
  }
});

for (const face of GREEK) {
  test("fonts cmap: " + face.src + " covers monotonic and polytonic Greek", () => {
    const t = woff2Tables(path.join(ROOT, face.src));
    const cps = cmapCodepoints(t.cmap);
    const missing = GREEK_MUST.filter((c) => !cps.has(c));
    assert.equal(missing.length, 0, face.src + " lacks " + missing.map((c) => String.fromCodePoint(c)).join(""));
    for (const c of cps) assert.ok((c >= 0x370 && c <= 0x3ff) || (c >= 0x1f00 && c <= 0x1fff), face.src + " has U+" + c.toString(16) + " outside its unicode-range");
  });

  test("fonts weight: " + face.src + " at " + face.weight + " is the nearest file", () => {
    // M PLUS Rounded 1c has no 600: the Bold file stands in for semibold.
    const t = woff2Tables(path.join(ROOT, face.src));
    assert.equal(t.os2.readUInt16BE(4), face.weight === 600 ? 700 : face.weight, "OS/2 usWeightClass");
  });
}

test("sw.js precaches fonts.css and every font file it uses", () => {
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  assert.ok(sw.includes('"./fonts.css"'), "./fonts.css missing from PRECACHE_URLS");
  for (const f of FACES.concat(GREEK)) assert.ok(sw.includes('"' + f.src + '"'), f.src + " missing from PRECACHE_URLS");
});

test("fonts/OFL-MPLUSRounded1c.txt ships beside the Greek files", () => {
  const ofl = fs.readFileSync(path.join(ROOT, "fonts", "OFL-MPLUSRounded1c.txt"), "utf8");
  assert.match(ofl, /Rounded M\+ Project Authors/);
  assert.match(ofl, /SIL OPEN FONT LICENSE Version 1\.1/i);
});

test("fonts/OFL.txt ships beside the Nunito files", () => {
  const ofl = fs.readFileSync(path.join(ROOT, "fonts", "OFL.txt"), "utf8");
  assert.match(ofl, /Nunito Project Authors/);
  assert.match(ofl, /SIL OPEN FONT LICENSE Version 1\.1/i);
});

// FONTS-APPS (5.04.05): an app frame is its own document and never sees
// the shell's @font-face rules, so until 5.04.05 every app that asks for
// "Nunito" drew in the system font. fonts.css is the one place that
// declares the faces; the shell and every page that asks for Nunito (in
// its own markup or in a stylesheet it links) link it.
const SKIP = new Set(["vendor", "node_modules"]);
function pages(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) pages(p, out);
    else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}
const linkedCss = (html) => [...html.matchAll(/<link[^>]*\bhref="([^"#?]+\.css)(?:\?[^"]*)?"/g)].map((m) => m[1]).filter((h) => !/^(?:https?:)?\/\//.test(h));

test("fonts.css is the only file with @font-face rules for Nunito", () => {
  const style = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");
  assert.doesNotMatch(style, /@font-face/, "style.css declares @font-face again; keep the rules in fonts.css");
  const shell = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const order = linkedCss(shell);
  assert.ok(order.indexOf("fonts.css") >= 0, "index.html does not link fonts.css");
  assert.ok(order.indexOf("fonts.css") < order.indexOf("style.css"), "index.html links fonts.css after style.css");
});

test("every page that asks for Nunito links the root fonts.css", () => {
  const TEMPLATE = path.join("docs", "app-kit", "template") + path.sep;
  const missing = [];
  let checked = 0;
  for (const file of pages(ROOT, [])) {
    const rel = path.relative(ROOT, file);
    if (rel === "index.html") continue;
    const html = fs.readFileSync(file, "utf8");
    const links = linkedCss(html);
    // The app-kit template is copied to <id>/ by new-app.js.
    const base = rel.startsWith(TEMPLATE) ? path.join(ROOT, "myapp") : path.dirname(file);
    let text = html;
    for (const h of links) { try { text += fs.readFileSync(path.resolve(path.dirname(file), h), "utf8"); } catch (e) { /* a missing stylesheet is another test's business */ } }
    if (!/Nunito/.test(text)) continue;
    checked++;
    if (!links.some((h) => path.resolve(base, h) === path.join(ROOT, "fonts.css"))) missing.push(rel);
  }
  assert.ok(checked > 100, "expected the app pages, found " + checked);
  assert.deepEqual(missing, [], "pages ask for Nunito without linking fonts.css");
});
