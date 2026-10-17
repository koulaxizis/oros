// "Send to someone", kind "album" (share wave 4): the list normalizer,
// the photo sniffing, the relay's flag-2 item (JSON + photo bytes), the
// pure parts of share/album.js and the places that send an album.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const K = require(path.join(ROOT, "share/kinds.js"));
const R = require(path.join(ROOT, "share/relay.js"));
const A = require(path.join(ROOT, "share/album.js"));
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const JPEG = (n) => { const b = new Uint8Array(n); b.set([0xff, 0xd8, 0xff, 0xe0]); return b; };

test("album: the list is cleaned and capped", () => {
  const d = K.norm("album", { t: " Trip\u0000 to Crete ", p: [
    { o: 0, n: 100, m: "image/jpeg", w: 2048, h: 1536, c: " Beach\nat dawn " },
    { o: 100, n: 50, m: "image/svg+xml" },
    { o: 150, n: 0, m: "image/png" },
    { o: -1, n: 10, m: "image/png" },
    { o: 160, n: 10.5, m: "image/png" },
    { o: 170, n: 20, m: "image/webp", w: 0, h: 10 },
    "junk"
  ] });
  assert.equal(d.t, "Trip to Crete");
  assert.deepEqual(d.p, [{ o: 0, n: 100, m: "image/jpeg", w: 2048, h: 1536, c: "Beach at dawn" }, { o: 170, n: 20, m: "image/webp" }]);
  assert.equal(K.norm("album", { t: "x", p: [] }), null);
  const many = K.norm("album", { p: Array.from({ length: 300 }, (_, i) => ({ o: i * 10, n: 10, m: "image/jpeg" })) });
  assert.equal(many.p.length, 200);
  const huge = K.norm("album", { p: [{ o: 0, n: 9000000, m: "image/jpeg" }, { o: 0, n: 8000000, m: "image/jpeg" },
    { o: 0, n: 8000000, m: "image/jpeg" }, { o: 0, n: 8000000, m: "image/jpeg" }, { o: 0, n: 8000000, m: "image/jpeg" }] });
  assert.equal(huge.p.length, 3, "one photo ≤ 8 MiB, all ≤ 25 MiB");
});

test("album: only JPEG, PNG and WebP bytes are photos", () => {
  assert.equal(K.photoType(JPEG(20)), "image/jpeg");
  assert.equal(K.photoType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), "image/png");
  assert.equal(K.photoType(new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ")), "image/webp");
  assert.equal(K.photoType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'>")), "");
  assert.equal(K.photoType(new TextEncoder().encode("<html><script>")), "");
  assert.equal(K.photoType(new Uint8Array(3)), "");
});

test("album: never a plain link; summary, text, no Add to my orOS", async () => {
  const env = K.pack("album", { t: "Crete", p: [{ o: 0, n: 10, m: "image/jpeg", c: "Beach" }, { o: 10, n: 10, m: "image/jpeg" }] });
  assert.deepEqual(K.RELAY_ONLY, ["album"]);
  await assert.rejects(K.encode(env), /big/);
  assert.equal(K.summary(env, "en"), "Album «Crete» · 2 photos");
  assert.equal(K.summary(env, "el"), "Άλμπουμ «Crete» · 2 φωτογραφίες");
  assert.equal(K.title(K.pack("album", { p: [{ o: 0, n: 1, m: "image/jpeg" }] }), "el"), "Φωτογραφίες");
  assert.match(K.text(env, "en"), /1\. Beach/);
  assert.equal(K.target(env, "en"), null);
});

test("relay: an album item carries its photo bytes beside the JSON (flag 2)", async () => {
  const bin = new Uint8Array(300000);
  for (let i = 0; i < bin.length; i++) bin[i] = (i * 7) & 255;
  bin.set([0xff, 0xd8, 0xff], 0);
  const env = K.pack("album", { t: "x", p: [{ o: 0, n: bin.length, m: "image/jpeg" }] });
  const plain = await R.pack(env, 123, bin);
  assert.equal(plain[0], 2);
  const back = await R.unpack(plain);
  assert.equal(back.x, 123);
  assert.deepEqual(back.e, env);
  assert.deepEqual(Buffer.from(back.bin), Buffer.from(bin));
  // A broken length is refused.
  const bad = plain.slice();
  new DataView(bad.buffer).setUint32(1, bad.length);
  await assert.rejects(R.unpack(bad), /bad/);
  await assert.rejects(R.unpack(Uint8Array.from([3, 0, 0])), /bad/);
  // Without photos nothing changes.
  const p0 = await R.pack(K.pack("note", { t: "a", x: "b" }), 5);
  assert.equal(p0[0], 1);
  assert.equal((await R.unpack(p0)).bin, undefined);
});

test("album.js: captions from names, what fits", () => {
  assert.equal(A.captionOf("Beach at sunset.jpg"), "Beach at sunset");
  assert.equal(A.captionOf("/internal/Pictures/Γιαγιά_και_εγγόνια.JPEG"), "Γιαγιά και εγγόνια");
  ["IMG_2034.JPG", "DSC01234.jpg", "PXL_20260801_101010.jpg", "20260801_101010.jpg", "Screenshot 2026-08-01 10-10-10.png", ".jpg"]
    .forEach((n) => assert.equal(A.captionOf(n), "", n));
  const pl = A.place([10, 20, 30], 35);
  assert.deepEqual(pl, { at: [0, 10], keep: 2, total: 30 });
  assert.equal(A.place(new Array(250).fill(1)).keep, 200);
  assert.equal(A.place([9000000]).keep, 0, "one photo over 8 MiB never goes");
  assert.equal(A.EDGE, 2048);
  assert.ok(A.BUDGET <= 25 * 1048576);
  // Every photo is drawn again as JPEG: the new file has no EXIF.
  const s = src("share/album.js");
  assert.match(s, /c\.toBlob\(function \(b\) \{ c\.width = c\.height = 0; ok\(b\); \}, "image\/jpeg", QUALITY\)/);
  assert.match(s, /imageOrientation: "from-image"/);
});

test("album: the page shows only sniffed photos from blob: URLs, text only", () => {
  const v = src("share/view.js");
  assert.match(v, /var type = bytes \? K\.photoType\(bytes\) : ""/);
  assert.match(v, /URL\.createObjectURL\(new Blob\(\[bytes\], \{ type: type \}\)\)/);
  assert.match(v, /render\(env, r\.bin \|\| null\)/);
  assert.doesNotMatch(v, /innerHTML/);
  const page = src("share/index.html");
  assert.match(page, /img-src 'self' data: blob:/);
});

test("album: Files and Photo Lab send it, the shell loads album.js, EN and EL", () => {
  const files = src("files/files.js");
  assert.match(files, /api\.open\(\{ kind: "album", data: \{ t: title \}, photos: photos \}\)/);
  assert.match(files, /opts\.share = \{ kind: "album", data: \{ t: "" \}, photos: pics \}/);
  ["menu.sendAlbum", "album.none"].forEach((k) => assert.equal(files.split('"' + k + '":').length - 1, 2, k));
  const pl = src("photolab/io.js"), pls = src("photolab/strings.js"), pp = src("photolab/panels.js");
  assert.match(pl, /api\.open\(\{ kind: "album", data: \{ t: name \}, photos: \[\{ blob: blob, name: fileName\("jpg"\), c: name \}\] \}\)/);
  assert.match(pp, /\{ id: "share", run: function \(\) \{ PL\.io\.sendToSomeone\(\); \}/);
  assert.equal(pls.split('"menu.share":').length - 1, 2);
  const shell = src("shell.js");
  assert.ok(shell.indexOf('load("share/album.js")') > shell.indexOf('load("share/relay.js")'));
  assert.ok(shell.indexOf('load("share/album.js")') < shell.indexOf('load("share/send.js")'));
  const send = src("share/send.js");
  ["preparing", "noPhotos", "albumWarn", "skipped", "cut"].forEach((k) => assert.equal(send.split(" " + k + ":").length - 1, 2, k));
  assert.match(send, /bin: bin \|\| undefined/);
});
