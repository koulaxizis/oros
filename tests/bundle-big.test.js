// The open orOS file format, big projects (bundle.js, OBF-6): media
// Blobs that never sit in memory whole, SHA-256 a piece at a time, and
// ZIP64 for files past 4 GB (checked with lowered thresholds and by
// Python's zipfile when it is installed).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));

const MP4 = (() => {                         // "ftyp" at 4: video/mp4 by its bytes
  const b = new Uint8Array(300000);
  b.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  for (let i = 12; i < b.length; i++) b[i] = (i * 7919) & 255;
  return b;
})();
const hex = (b) => crypto.createHash("sha256").update(b).digest("hex");

function opts(media) {
  return {
    mime: "application/x-oros-montage", app: "montage", schema: "montage/1",
    content: { kind: "oros-montage-package", ver: 1, clip: Object.keys(media)[0] },
    meta: { title: "Ταινία", modified: Date.UTC(2026, 9, 15) },
    media
  };
}

test("digest streams a big Blob and agrees with crypto", async () => {
  const big = new Uint8Array(70 * 1024 * 1024 + 123);   // above SMALL: streamed
  for (let i = 0; i < big.length; i += 4096) big[i] = i & 255;
  let seen = 0;
  const d = await B.digest(new Blob([big]), (n) => { seen += n; });
  assert.equal(d.sha, hex(big));
  assert.equal(d.size, big.length);
  assert.equal(d.bytes, undefined);
  assert.equal(seen, big.length);
  assert.equal(d.crc, (await B.digest(big)).crc);
});

test("writeBlob keeps media Blobs as they are; read(Blob, {big}) gives them back as Blobs", async () => {
  const key = hex(MP4) + ".mp4";
  const blob = await B.writeBlob(opts({ [key]: new Blob([MP4]) }));
  assert.ok(blob instanceof Blob);
  assert.equal(blob.type, "application/x-oros-montage");
  // the same bytes as write()
  const bytes = await B.write(opts({ [key]: MP4 }));
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
  let last = null;
  const r = await B.read(blob, { mime: "application/x-oros-montage", big: true, onProgress: (d, t) => { last = [d, t]; } });
  const m = r.media[key];
  assert.equal(m.type, "video/mp4");
  assert.equal(m.sha, hex(MP4));
  assert.equal(m.size, MP4.length);
  assert.ok(m.blob instanceof Blob);
  assert.deepEqual(new Uint8Array(await m.blob.arrayBuffer()), MP4);
  assert.deepEqual(last, [MP4.length, MP4.length]);
  assert.deepEqual(r.changed, []);
  // without big: bytes, as before
  const r2 = await B.read(blob, { mime: "application/x-oros-montage" });
  assert.deepEqual(r2.media[key].bytes, MP4);
  assert.equal(r2.media[key].blob, undefined);
});

test("media over the normal cap need { big: true }", async () => {
  const key = hex(MP4) + ".mp4";
  const blob = await B.writeBlob(opts({ [key]: new Blob([MP4]) }));
  await assert.rejects(B.read(blob, { limits: { entry: 100000 } }), { code: "toobig" });
  const r = await B.read(blob, { big: true, limits: { entry: 100000 } });
  assert.equal(r.media[key].size, MP4.length);
});

test("ZIP64: written past the threshold, read back, and readable by other tools", async (t) => {
  const key = hex(MP4) + ".mp4";
  B._z64(1000, 3);                    // every bigger entry and offset becomes ZIP64
  let bytes;
  try { bytes = await B.write(opts({ [key]: MP4 })); } finally { B._z64(); }
  // ZIP64 end record and locator are there
  const tail = Buffer.from(bytes.subarray(bytes.length - 98));
  assert.ok(tail.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06])));
  assert.ok(tail.includes(Buffer.from([0x50, 0x4b, 0x06, 0x07])));
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-montage");
  for (const input of [bytes, new Blob([bytes])]) {
    const r = await B.read(input, { mime: "application/x-oros-montage", big: true });
    assert.equal(r.media[key].sha, hex(MP4));
    assert.equal(r.content.clip, key);
    assert.deepEqual(r.changed, []);
  }
  // Python's zipfile (if there) agrees
  let py = null;
  try { execFileSync("python3", ["-c", "1"], { stdio: "ignore" }); py = "python3"; } catch (e) {}
  if (!py) { t.diagnostic("python3 not found: external check skipped"); return; }
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "obf-")), "z64.orosmontage");
  fs.writeFileSync(f, bytes);
  const out = execFileSync(py, ["-I", "-c",
    "import sys,zipfile,hashlib;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;" +
    "print(z.namelist()[0]);print(hashlib.sha256(z.read('media/'+sys.argv[2])).hexdigest())", f, key]).toString().trim().split("\n");
  assert.equal(out[0], "mimetype");
  assert.equal(out[1], hex(MP4));
});

test("a lying stored size or a ZIP64 record pointing nowhere is refused", async () => {
  const key = hex(MP4) + ".mp4";
  const good = await B.write(opts({ [key]: MP4 }));
  // stored entry whose sizes disagree in the central directory
  const bad = good.slice();
  const cd = Buffer.from(bad).lastIndexOf(Buffer.from("media/"));
  const hdr = cd - 46;
  assert.equal(new DataView(bad.buffer).getUint32(hdr, true), 0x02014b50);
  new DataView(bad.buffer).setUint32(hdr + 24, MP4.length - 5, true);
  await assert.rejects(B.read(bad), { code: "notzip" });
  // end record says ZIP64, but there is no locator
  const z = good.slice(), e = z.length - 22;
  new DataView(z.buffer).setUint32(e + 16, 0xFFFFFFFF, true);
  await assert.rejects(B.read(z), { code: "notzip" });
});
