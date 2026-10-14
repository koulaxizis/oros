// Photo Lab camera RAW files: photolab/raw.js, the pure container
// parser (embedded JPEG previews, orientation) and the LibRaw output
// conversion. LibRaw itself (vendor/libraw/) runs in the real-shell
// check; here only its files and licence are checked.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const R = require("../photolab/raw.js");

const ROOT = path.join(__dirname, "..");

// ---------- Builders ----------
// A small JPEG: SOI, optional Exif APP1 (orientation), SOFn, SOS,
// entropy bytes (with a stuffed 0xFF00 and a restart marker), EOI.
function jpeg(w, h, o) {
  o = o || {};
  const parts = [Buffer.from([0xFF, 0xD8])];
  if (o.orient) {
    const tiff = Buffer.alloc(8 + 2 + 12 + 4);
    tiff.write("II", 0); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
    tiff.writeUInt16LE(1, 8);
    tiff.writeUInt16LE(0x112, 10); tiff.writeUInt16LE(3, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt16LE(o.orient, 18);
    const body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
    const len = Buffer.alloc(2); len.writeUInt16BE(body.length + 2);
    parts.push(Buffer.from([0xFF, 0xE1]), len, body);
  }
  const sof = Buffer.from([0xFF, o.sof || 0xC0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  const sos = Buffer.from([0xFF, 0xDA, 0x00, 0x0C, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]);
  const data = Buffer.from([0x12, 0x34, 0xFF, 0x00, 0x56, 0xFF, 0xD0, 0x78, 0x9A].concat(Array(o.pad || 40).fill(0x55)));
  parts.push(sof, sos, data, Buffer.from([0xFF, 0xD9]));
  return Buffer.concat(parts);
}

// A TIFF-like RAW: IFD0 (orientation, Make, a small strip JPEG, a
// SubIFD) → SubIFD (JPEGInterchangeFormat = the big preview), and
// raw "sensor data" that is a lossless JPEG (SOF3) in the chain's
// second IFD. le: little-endian; magic: 42 | "RO" (ORF) | 0x55 (RW2).
function tiffRaw(o) {
  o = o || {};
  const le = o.le !== false;
  const big = jpeg(o.bigW || 640, o.bigH || 480, { pad: 300 });
  const small = jpeg(160, 120);
  const lossless = jpeg(1200, 800, { sof: 0xC3, pad: 200 });
  const u16 = (v) => { const b = Buffer.alloc(2); le ? b.writeUInt16LE(v) : b.writeUInt16BE(v); return b; };
  const u32 = (v) => { const b = Buffer.alloc(4); le ? b.writeUInt32LE(v) : b.writeUInt32BE(v); return b; };
  const entry = (tag, type, count, val) => Buffer.concat([u16(tag), u16(type), u32(count), val.length === 4 ? val : Buffer.concat([val, Buffer.alloc(4 - val.length)])]);
  const short = (v) => Buffer.concat([u16(v), Buffer.alloc(2)]);
  // layout: header 8 | IFD0 @8 (6 entries) | IFD1 @… | SubIFD | make | data
  const ifd0At = 8, ifd0Len = 2 + 6 * 12 + 4;
  const ifd1At = ifd0At + ifd0Len, ifd1Len = 2 + 3 * 12 + 4;
  const subAt = ifd1At + ifd1Len, subLen = 2 + 2 * 12 + 4;
  const makeAt = subAt + subLen, make = Buffer.from("TESTCAM\0", "latin1");
  const smallAt = makeAt + make.length, bigAt = smallAt + small.length + 16, rawAt = bigAt + big.length + 8;
  const ifd0 = Buffer.concat([u16(6),
    entry(0x10F, 2, make.length, u32(makeAt)),
    entry(0x112, 3, 1, short(o.orient || 1)),
    entry(0x103, 3, 1, short(6)),
    entry(0x111, 4, 1, u32(smallAt)),
    entry(0x117, 4, 1, u32(small.length)),
    entry(0x14A, 4, 1, u32(subAt)),
    u32(ifd1At)]);
  const ifd1 = Buffer.concat([u16(3),
    entry(0x103, 3, 1, short(7)),
    entry(0x111, 4, 1, u32(rawAt)),
    entry(0x117, 4, 1, u32(lossless.length)),
    u32(0)]);
  const sub = Buffer.concat([u16(2),
    entry(0x201, 4, 1, u32(bigAt)),
    entry(0x202, 4, 1, u32(big.length)),
    u32(0)]);
  let head;
  if (o.magic === "RO") head = Buffer.from(le ? "IIRO" : "MMOR", "latin1");
  else if (o.magic === 0x55) head = Buffer.concat([Buffer.from("II", "latin1"), u16(0x55)]);
  else head = Buffer.concat([Buffer.from(le ? "II" : "MM", "latin1"), u16(42)]);
  return Buffer.concat([head, u32(ifd0At), ifd0, ifd1, sub, make, small, Buffer.alloc(16), big, Buffer.alloc(8), lossless, Buffer.alloc(32)]);
}

// ---------- Names and kinds ----------
test("isRaw: the camera RAW extensions, any case; not ordinary pictures", () => {
  ["a.dng", "b.CR2", "c.cr3", "d.nef", "e.ARW", "f.orf", "g.raf", "h.rw2", "i.pef", "j.srw", "k.x3f", "l.3fr", "m.iiq", "n.erf", "o.crw", "p.nrw", "q.rwl"]
    .forEach((n) => assert.ok(R.isRaw(n), n));
  ["a.jpg", "b.png", "c.tif", "d.psd", "e", "raw", ".dng.txt"].forEach((n) => assert.ok(!R.isRaw(n), n));
});

test("sniff: container kinds from the first bytes", () => {
  assert.equal(R.sniff(new Uint8Array(tiffRaw())), "tiff");
  assert.equal(R.sniff(new Uint8Array(tiffRaw({ le: false }))), "tiff");
  assert.equal(R.sniff(new Uint8Array(tiffRaw({ magic: "RO" }))), "orf");
  assert.equal(R.sniff(new Uint8Array(tiffRaw({ magic: 0x55 }))), "rw2");
  const raf = Buffer.alloc(200); raf.write("FUJIFILMCCD-RAW 0201", 0, "latin1");
  assert.equal(R.sniff(new Uint8Array(raf)), "raf");
  const cr3 = Buffer.alloc(64); cr3.writeUInt32BE(24, 0); cr3.write("ftypcrx ", 4, "latin1");
  assert.equal(R.sniff(new Uint8Array(cr3)), "cr3");
  assert.equal(R.sniff(new Uint8Array(Buffer.from("just some text, not a photo"))), "");
  assert.equal(R.sniff(new Uint8Array(4)), "");
});

// ---------- JPEG ----------
test("jpegInfo: size, frame kind and own orientation; stuffing and restarts skipped", () => {
  const j = jpeg(1620, 1080, { orient: 6 });
  const info = R.jpegInfo(new Uint8Array(j), 0, 0);
  assert.deepEqual([info.w, info.h, info.sof, info.orient, info.len], [1620, 1080, 0xC0, 6, j.length]);
  // inside a bigger file, at an offset, with the container's length
  const f = new Uint8Array(Buffer.concat([Buffer.alloc(33), j, Buffer.alloc(9)]));
  assert.equal(R.jpegInfo(f, 33, j.length).len, j.length);
  assert.equal(R.jpegInfo(f, 33, 0).len, j.length);
  // progressive is fine, lossless is reported (previews() drops it)
  assert.equal(R.jpegInfo(new Uint8Array(jpeg(10, 10, { sof: 0xC2 })), 0).sof, 0xC2);
  assert.equal(R.jpegInfo(new Uint8Array(jpeg(10, 10, { sof: 0xC3 })), 0).sof, 0xC3);
});

test("jpegInfo: rejects what is not a whole JPEG", () => {
  const j = jpeg(100, 80);
  assert.equal(R.jpegInfo(new Uint8Array(j.subarray(0, j.length - 30)), 0, 0), null, "cut short, no end");
  assert.equal(R.jpegInfo(new Uint8Array(j), 1, 0), null, "not at a start of image");
  assert.equal(R.jpegInfo(new Uint8Array(j), -5, 0), null);
  assert.equal(R.jpegInfo(new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]), 0, 0), null, "no frame");
  const bad = Buffer.from(j); bad[3] = 0xD8;                    // SOI again where a marker should be
  assert.equal(R.jpegInfo(new Uint8Array(bad), 0, 0), null);
  const zero = Buffer.from(jpeg(0, 0));
  assert.equal(R.jpegInfo(new Uint8Array(zero), 0, 0), null, "0 × 0 frame");
  const longSeg = Buffer.from(j); longSeg.writeUInt16BE(0xFFF0, 4);   // segment past the end
  assert.equal(R.jpegInfo(new Uint8Array(longSeg), 0, 0), null);
});

// ---------- TIFF containers ----------
test("tiffInfo: orientation, make, every JPEG candidate (strips, SubIFDs, JPEGInterchangeFormat)", () => {
  for (const le of [true, false]) {
    const ti = R.tiffInfo(new Uint8Array(tiffRaw({ le, orient: 8 })));
    assert.equal(ti.orient, 8);
    assert.equal(ti.make, "TESTCAM");
    assert.equal(ti.cands.length, 3, le ? "LE" : "BE");
  }
  assert.equal(R.tiffInfo(new Uint8Array(Buffer.from("not a tiff at all, sorry"))), null);
});

test("previews: the biggest decodable JPEG first; the lossless raw data and thumbnails ranked or dropped", () => {
  const b = new Uint8Array(tiffRaw({ bigW: 6000, bigH: 4000, orient: 6 }));
  const list = R.previews(b);
  assert.deepEqual(list.map((p) => [p.w, p.h]), [[6000, 4000], [160, 120]]);
  assert.equal(list[0].orient, 6, "no Exif of its own: the RAW's orientation");
  const j = R.jpegInfo(b, list[0].off, list[0].len);
  assert.equal(j.w, 6000);
  for (const magic of ["RO", 0x55]) assert.equal(R.previews(new Uint8Array(tiffRaw({ magic, bigW: 900, bigH: 600 })))[0].w, 900);
});

test("previews: Fuji RAF header, and a scan for JPEGs in any other container (CR3, X3F…)", () => {
  const big = jpeg(1920, 1280, { orient: 1, pad: 100 });
  const raf = Buffer.alloc(100 + big.length);
  raf.write("FUJIFILMCCD-RAW 0201FF383501", 0, "latin1");
  raf.writeUInt32BE(100, 84); raf.writeUInt32BE(big.length, 88);
  big.copy(raf, 100);
  const pr = R.previews(new Uint8Array(raf));
  assert.equal(pr.length, 1);
  assert.deepEqual([pr[0].w, pr[0].h, pr[0].off], [1920, 1280, 100]);

  // CR3-like: boxes with a thumbnail and a preview inside, and
  // random "sensor" bytes that happen to contain FF D8 FF
  const thumb = jpeg(160, 120), prvw = jpeg(1620, 1080, { orient: 3 });
  const noise = Buffer.from([0x00, 0xFF, 0xD8, 0xFF, 0x13, 0x00, 0x22]);
  const cr3 = Buffer.concat([Buffer.from("\0\0\0\x18ftypcrx \0\0\0\x01crx isom", "latin1"), noise, thumb, Buffer.alloc(20), prvw, noise, Buffer.alloc(50)]);
  const list = R.previews(new Uint8Array(cr3));
  assert.deepEqual(list.map((p) => p.w), [1620, 160]);
  assert.equal(list[0].orient, 1, "its own Exif orientation: the browser turns it");
});

test("previews: a nested Exif thumbnail is not listed twice; junk gives nothing", () => {
  const inner = jpeg(160, 120);
  const outer = jpeg(800, 600, { pad: 10 });
  // put a whole JPEG inside an APPn segment of the outer one
  const app = Buffer.concat([Buffer.from([0xFF, 0xE2]), Buffer.from([(inner.length + 2) >> 8, (inner.length + 2) & 255]), inner]);
  const nested = Buffer.concat([outer.subarray(0, 2), app, outer.subarray(2)]);
  const list = R.previews(new Uint8Array(nested));
  assert.deepEqual(list.map((p) => p.w), [800]);
  assert.deepEqual(R.previews(new Uint8Array(crypto.randomBytes(4096))).filter((p) => p.w * p.h > 1e6), []);
  assert.deepEqual(R.previews(new Uint8Array(0)), []);
  assert.deepEqual(R.previews(null), []);
});

test("tiffInfo: loops and wild offsets are cut, never followed", () => {
  const b = Buffer.from(tiffRaw());
  // IFD1's next pointer back to IFD0, SubIFD pointing past the end
  const ifd0At = 8, ifd1At = 8 + 2 + 6 * 12 + 4, subAt = ifd1At + 2 + 3 * 12 + 4;
  b.writeUInt32LE(ifd0At, ifd1At + 2 + 3 * 12);
  b.writeUInt32LE(0x7FFFFFF0, subAt + 2 + 8);
  const ti = R.tiffInfo(new Uint8Array(b));
  assert.ok(ti && ti.cands.length >= 2);
  assert.ok(Array.isArray(R.previews(new Uint8Array(b))));
  // an entry count that runs past the end
  const c = Buffer.from(tiffRaw()); c.writeUInt16LE(60000, 8);
  assert.deepEqual(R.tiffInfo(new Uint8Array(c)).cands, []);
});

test("orientFor / orientedSize", () => {
  assert.equal(R.orientFor({ orient: 6 }, 8), 1);
  assert.equal(R.orientFor({ orient: 0 }, 8), 8);
  assert.equal(R.orientFor({ orient: 0 }, 0), 1);
  assert.equal(R.orientFor({ orient: 0 }, 12), 1);
  assert.deepEqual(R.orientedSize(600, 400, 6), { w: 400, h: 600 });
  assert.deepEqual(R.orientedSize(600, 400, 3), { w: 600, h: 400 });
});

test("rgbToRgba: LibRaw's 8-bit RGB, 16-bit RGB and grey", () => {
  assert.deepEqual([...R.rgbToRgba(new Uint8Array([1, 2, 3, 4, 5, 6]), 2, 1, 8, 3)], [1, 2, 3, 255, 4, 5, 6, 255]);
  assert.deepEqual([...R.rgbToRgba(new Uint16Array([65535, 256, 0]), 1, 1, 16, 3)], [255, 1, 0, 255]);
  assert.deepEqual([...R.rgbToRgba(new Uint8Array([9, 7]), 2, 1, 8, 1)], [9, 9, 9, 255, 7, 7, 7, 255]);
});

test("vendor/libraw: the unmodified libraw-wasm 1.6.0 files and their licences", () => {
  const dir = path.join(ROOT, "vendor/libraw");
  const lic = fs.readFileSync(path.join(dir, "LICENSE"), "utf8");
  for (const f of ["index.js", "worker.js", "libraw.js", "libraw.wasm"]) {
    const h = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex");
    assert.ok(lic.includes(h), f + " is the file the LICENSE names (unmodified)");
  }
  assert.ok(fs.existsSync(path.join(dir, "LICENSE.LGPL")) && fs.existsSync(path.join(dir, "LICENSE.CDDL")));
  assert.match(lic, /LibRaw 0\.22\.1/);
  // loaded only when a RAW file is opened: not from any page, not precached
  const html = fs.readFileSync(path.join(ROOT, "photolab/index.html"), "utf8");
  assert.doesNotMatch(html, /vendor\/libraw/);
  assert.match(fs.readFileSync(path.join(ROOT, "photolab/raw.js"), "utf8"), /import\(new URL\(LIBRAW/);
});
