// Files › Duplicates (files/dupes-core.js, DUPES-1 wave K1): exact
// duplicates only. Size, then the first bytes, then the whole file's
// SHA-256 (or the vault's hash for a cloud-only file), big files byte
// by byte; one copy of every group always stays.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const D = require("../files/dupes-core.js");

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

// A fake disk: path → Buffer, with counters for what was read.
function disk(files) {
  const reads = { head: 0, hash: 0, read: 0 };
  const io = {
    head: (f) => { reads.head++; return Promise.resolve(sha(files[f.p].subarray(0, D.HEAD))); },
    hash: (f) => { reads.hash++; return files[f.p] ? Promise.resolve(sha(files[f.p])) : Promise.reject(new Error("gone")); },
    read: (f, off, n) => { reads.read++; return Promise.resolve(new Uint8Array(files[f.p].subarray(off, off + n))); },
    tick: () => {}
  };
  const list = Object.keys(files).map((p, i) => ({ p, s: files[p].length, m: 1000 + i }));
  return { io, reads, list };
}

test("skipDir and wanted: Trash, dot folders, empty files and other places stay out", () => {
  assert.equal(D.skipDir("/internal/.trash"), true);
  assert.equal(D.skipDir("/internal/.trash/x"), true);
  assert.equal(D.skipDir("/internal/.docs/text"), true);
  assert.equal(D.skipDir("/internal/Pictures"), false);
  assert.equal(D.wanted("/internal/a.txt", 3), true);
  assert.equal(D.wanted("/internal/a.txt", 0), false);
  assert.equal(D.wanted("/internal/.hidden", 4), false);
  assert.equal(D.wanted("/internal/.docs/t.txt", 4), false);
  assert.equal(D.wanted("/internal/Work/a.txt", 4, "/internal/Work"), true);
  assert.equal(D.wanted("/internal/Workshop/a.txt", 4, "/internal/Work"), false);
  assert.equal(D.wanted("/computer/home/a.txt", 4), false);
  assert.equal(D.wanted(null, 4), false);
});

test("names never count: same bytes under other names are one group, same name with other bytes is not", async () => {
  const f = {
    "/internal/a/report.pdf": Buffer.from("same bytes here"),
    "/internal/b/copy of report.pdf": Buffer.from("same bytes here"),
    "/internal/c/report.pdf": Buffer.from("SAME bytes here"),   // same size, same name, other bytes
    "/internal/d/other.txt": Buffer.from("x")
  };
  const { io, list } = disk(f);
  const g = await D.find(list, io);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].items.map((x) => x.p).sort(), ["/internal/a/report.pdf", "/internal/b/copy of report.pdf"]);
  assert.equal(g[0].k, sha(f["/internal/a/report.pdf"]));
  assert.equal(g[0].waste, 15);
});

test("a lone size is never read; the head step spares the full read of files that differ early", async () => {
  const big = (c, tail) => Buffer.concat([Buffer.alloc(D.HEAD, c), Buffer.from(tail)]);
  const f = {
    "/internal/x1.bin": big(1, "end"),
    "/internal/x2.bin": big(2, "end"),     // same size, other start: dropped at the head step
    "/internal/x3.bin": big(1, "end"),     // the duplicate of x1
    "/internal/x4.bin": big(1, "END"),     // same head as x1, other end: full hash tells
    "/internal/lone.bin": Buffer.alloc(10)
  };
  const { io, reads, list } = disk(f);
  const g = await D.find(list, io);
  assert.equal(reads.head, 4);
  assert.equal(reads.hash, 3);           // x1, x3, x4; not x2, not lone
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].items.map((x) => x.p).sort(), ["/internal/x1.bin", "/internal/x3.bin"]);
});

test("cloud-only files compare by the vault's hash, unread; without a hash they stay out", async () => {
  const body = Buffer.from("photo bytes");
  const f = { "/internal/Pictures/p.jpg": body };
  const { io, reads, list } = disk(f);
  list.push({ p: "/internal/Drive/p.jpg", s: body.length, m: 5, h: sha(body), cloud: true });
  list.push({ p: "/internal/Drive/q.jpg", s: body.length, m: 6, cloud: true });          // no hash
  list.push({ p: "/internal/Drive/r.jpg", s: body.length, m: 7, h: "f".repeat(64), cloud: true });
  const g = await D.find(list, io);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].items.map((x) => x.p), ["/internal/Pictures/p.jpg", "/internal/Drive/p.jpg"]);   // the local copy stays
  assert.equal(reads.read, 0);
});

test("big files are compared chunk by chunk, never hashed", async () => {
  const n = 3 * D.CHUNK + 5;
  const a = Buffer.alloc(n, 7), b = Buffer.alloc(n, 7), c = Buffer.alloc(n, 7);
  c[n - 1] = 8;                                                    // differs in the last byte
  const f = { "/internal/v/a.mkv": a, "/internal/v/b.mkv": b, "/internal/v/c.mkv": c };
  const { io, reads, list } = disk(f);
  const g = await D.find(list, io, { hashMax: D.CHUNK });
  assert.equal(reads.hash, 0);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].items.map((x) => x.p), ["/internal/v/a.mkv", "/internal/v/b.mkv"]);
  assert.ok(g[0].k.startsWith("b:"));
});

test("a file that cannot be read drops out, the rest still groups", async () => {
  const f = { "/internal/a": Buffer.from("abc"), "/internal/b": Buffer.from("abc"), "/internal/c": Buffer.from("abc") };
  const { io, list } = disk(f);
  delete f["/internal/c"];
  const g = await D.find(list, io);
  assert.equal(g.length, 1);
  assert.equal(g[0].items.length, 2);
});

test("stopping (live false) gives null", async () => {
  const f = { "/internal/a": Buffer.from("abc"), "/internal/b": Buffer.from("abc") };
  const { io, list } = disk(f);
  io.live = () => false;
  assert.equal(await D.find(list, io), null);
});

test("keepOrder: marked first, then on this device, then oldest, then shortest path", () => {
  const s = (xs) => xs.slice().sort(D.keepOrder).map((x) => x.p);
  assert.deepEqual(s([{ p: "/internal/a/b/c", m: 1 }, { p: "/internal/x", m: 9, imp: true }]), ["/internal/x", "/internal/a/b/c"]);
  assert.deepEqual(s([{ p: "/internal/a", m: 1, cloud: true }, { p: "/internal/b", m: 9 }]), ["/internal/b", "/internal/a"]);
  assert.deepEqual(s([{ p: "/internal/a", m: 9 }, { p: "/internal/bbbb", m: 2 }]), ["/internal/bbbb", "/internal/a"]);
  assert.deepEqual(s([{ p: "/internal/a", m: 0 }, { p: "/internal/bbbb", m: 2 }]), ["/internal/bbbb", "/internal/a"]);   // unknown time last
  assert.deepEqual(s([{ p: "/internal/bb", m: 2 }, { p: "/internal/a", m: 2 }]), ["/internal/a", "/internal/bb"]);
  assert.deepEqual(s([{ p: "/internal/b", m: 2 }, { p: "/internal/a", m: 2 }]), ["/internal/a", "/internal/b"]);
});

test("one copy always stays: default picks, canPick, plan", () => {
  const g = D.groups([
    { p: "/internal/a", s: 10, m: 1, k: "h1" }, { p: "/internal/b", s: 10, m: 2, k: "h1" }, { p: "/internal/c", s: 10, m: 3, k: "h1" },
    { p: "/internal/d", s: 4, m: 1, k: "h2" }, { p: "/internal/e", s: 4, m: 2, k: "h2" }
  ]);
  assert.equal(g[0].k, "h1");                     // most space first
  assert.equal(g[0].waste, 20);
  const picked = D.defaultPicks(g);
  assert.deepEqual(Object.keys(picked).sort(), ["/internal/b", "/internal/c", "/internal/e"]);
  assert.equal(D.canPick(g[0], picked, "/internal/a"), false);   // the last copy left
  assert.equal(D.canPick(g[1], {}, "/internal/d"), true);
  const pl = D.plan(g, picked);
  assert.deepEqual(pl.map((x) => [x.p, x.keep]), [["/internal/b", "/internal/a"], ["/internal/c", "/internal/a"], ["/internal/e", "/internal/d"]]);
  // A hand-made pick of every copy removes nothing from that group.
  const all = { "/internal/d": true, "/internal/e": true };
  assert.deepEqual(D.plan(g, all), []);
  const t = D.totals(g, picked);
  assert.deepEqual(t, { groups: 2, copies: 5, waste: 24, picked: 3, bytes: 24 });
  const left = D.without(g, { "/internal/b": true, "/internal/e": true });
  assert.equal(left.length, 1);
  assert.equal(left[0].waste, 10);
});

test("sameFiles and sameBytes", async () => {
  const f = { "/internal/a": Buffer.from("hello"), "/internal/b": Buffer.from("hello"), "/internal/c": Buffer.from("hellO") };
  const { io } = disk(f);
  const r = (p) => ({ p, s: 5 });
  assert.equal(await D.sameFiles(r("/internal/a"), r("/internal/b"), io.read), true);
  assert.equal(await D.sameFiles(r("/internal/a"), r("/internal/c"), io.read), false);
  assert.equal(await D.sameFiles(r("/internal/a"), { p: "/internal/b", s: 4 }, io.read), false);
  assert.equal(await D.sameFiles(r("/internal/a"), r("/internal/b"), () => Promise.reject(new Error("x"))), false);
  assert.equal(D.sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2])), true);
  assert.equal(D.sameBytes(new Uint8Array([1, 2]), new Uint8Array([1])), false);
});

test("cacheOk: a stored hash is reused only for the same path, size and time", () => {
  const f = { p: "/internal/a", s: 3, m: 10 };
  assert.equal(D.cacheOk({ p: "/internal/a", s: 3, m: 10, h: "x" }, f), true);
  assert.equal(D.cacheOk({ p: "/internal/a", s: 3, m: 11 }, f), false);
  assert.equal(D.cacheOk({ p: "/internal/a", s: 4, m: 10 }, f), false);
  assert.equal(D.cacheOk({ p: "/internal/a", s: 3, m: 0 }, { p: "/internal/a", s: 3, m: 0 }), false);
  assert.equal(D.hex(new Uint8Array([0, 15, 255]).buffer), "000fff");
});

// ---------- K2 ----------
const C = require("../files/clean-core.js");

// A tiny JPEG: SOI, optional APP1 Exif / COM, then SOS + "image" + EOI.
function jpeg(extra) {
  const parts = [Buffer.from([0xff, 0xd8])];
  if (extra === "exif") {
    const body = Buffer.concat([Buffer.from("Exif\0\0"), Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0])]);
    const len = body.length + 2;
    parts.push(Buffer.from([0xff, 0xe1, len >> 8, len & 255]), body);
  }
  if (extra === "com") parts.push(Buffer.from([0xff, 0xfe, 0, 7]), Buffer.from("hello"));
  parts.push(Buffer.from([0xff, 0xda, 0, 4, 1, 2]), Buffer.from("pixels-pixels-pixels"), Buffer.from([0xff, 0xd9]));
  return new Uint8Array(Buffer.concat(parts));
}

test("metaKind and jpegScanLen: the scan length is the same with other details", () => {
  assert.equal(D.metaKind("/a/B.JPG"), "jpeg");
  assert.equal(D.metaKind("/a/b.mp3"), "mp3");
  assert.equal(D.metaKind("/a/b.txt"), "");
  const a = jpeg(), b = jpeg("exif"), c = jpeg("com");
  assert.notEqual(a.length, b.length);
  assert.equal(D.jpegScanLen(a, a.length), D.jpegScanLen(b, b.length));
  assert.equal(D.jpegScanLen(a, a.length), D.jpegScanLen(c, c.length));
  assert.equal(D.jpegScanLen(new Uint8Array([1, 2, 3, 4]), 4), -1);
  assert.equal(D.jpegScanLen(a.subarray(0, 3), a.length), -1);
});

test("stripped: JPEG without its details is the same bytes; MP3 without ID3", () => {
  const a = jpeg(), b = jpeg("exif"), c = jpeg("com");
  const h = (u) => sha(Buffer.from(u));
  assert.equal(h(D.stripped("jpeg", b, C)), h(D.stripped("jpeg", a, C)));
  assert.equal(h(D.stripped("jpeg", c, C)), h(D.stripped("jpeg", a, C)));
  const sound = Buffer.from("frames-of-sound");
  const id3 = Buffer.concat([Buffer.from("ID3"), Buffer.from([3, 0, 0, 0, 0, 0, 5]), Buffer.from("TIT2x")]);
  const v1 = Buffer.concat([Buffer.from("TAG"), Buffer.alloc(125, 65)]);
  const m1 = new Uint8Array(Buffer.concat([id3, sound, v1])), m2 = new Uint8Array(sound);
  assert.equal(h(D.stripped("mp3", m1, C)), h(D.stripped("mp3", m2, C)));
  assert.deepEqual(D.mp3Range(m1.subarray(0, 10), m1.subarray(m1.length - 128), m1.length), [15, 15 + sound.length]);
  assert.equal(D.stripped("jpeg", new Uint8Array([0xff, 0xd8, 0x00, 0x01, 2, 3]), C), null);
});

test("metaGroups: same stripped content, more than one exact copy set, never pre-ticked", () => {
  const c = "c".repeat(64), d = "d".repeat(64);
  const files = [
    { p: "/internal/a.jpg", s: 100, m: 1, kind: "jpeg", c, k: "k1" },
    { p: "/internal/b.jpg", s: 120, m: 2, kind: "jpeg", c, k: "k2" },
    { p: "/internal/b2.jpg", s: 120, m: 3, kind: "jpeg", c, k: "k2" },   // exact twin of b: one row
    { p: "/internal/x.jpg", s: 50, m: 1, kind: "jpeg", c: d, k: "k3" },
    { p: "/internal/y.jpg", s: 50, m: 2, kind: "jpeg", c: d, k: "k3" }    // only an exact pair: not meta
  ];
  const g = D.metaGroups(files);
  assert.equal(g.length, 1);
  assert.equal(g[0].kind, "meta");
  assert.deepEqual(g[0].items.map((x) => x.p), ["/internal/a.jpg", "/internal/b.jpg"]);
  assert.equal(g[0].waste, 100);
  assert.deepEqual(D.defaultPicks(g), {});
  assert.deepEqual(D.plan(g, { "/internal/b.jpg": true }).map((x) => [x.p, x.keep]), [["/internal/b.jpg", "/internal/a.jpg"]]);
});

test("folderTwins: whole folders with the same content, outermost only; one unique file spoils a folder", () => {
  const f = (p, k, s, m) => ({ p, k, s: s || 10, m: m || 1 });
  const files = [
    f("/internal/Trip/a.jpg", "h1", 10, 1), f("/internal/Trip/sub/b.jpg", "h2", 20, 1),
    f("/internal/Copy of Trip/a.jpg", "h1", 10, 5), f("/internal/Copy of Trip/sub/b.jpg", "h2", 20, 5),
    f("/internal/Other/a.jpg", "h1"), f("/internal/Other/extra.txt", undefined),       // unique file
    f("/internal/X/one.txt", "h3"), f("/internal/Y/one.txt", "h3"), f("/internal/Y/two.txt", "h3")   // other content
  ];
  const g = D.folderTwins(files, "/internal");
  assert.equal(g.length, 1);
  assert.equal(g[0].kind, "dir");
  assert.deepEqual(g[0].items.map((x) => x.p), ["/internal/Trip", "/internal/Copy of Trip"]);   // older first
  assert.equal(g[0].items[0].n, 2);
  assert.equal(g[0].waste, 30);
  // The sub folders are twins too, but go with their parents.
  assert.ok(!g.some((x) => x.items.some((i) => /sub$/.test(i.p))));
  // A search inside Trip's parent only: base itself is never a member.
  assert.deepEqual(D.folderTwins(files, "/internal/Trip"), []);
  // File groups lose the copies inside the folder that goes.
  const fg = [{ kind: "same", k: "h1", s: 10, items: [files[0], files[2], files[4]], waste: 20 }, { kind: "same", k: "h2", s: 20, items: [files[1], files[3]], waste: 20 }];
  const left = D.outsideFolders(fg, g);
  assert.equal(left.length, 1);
  assert.deepEqual(left[0].items.map((x) => x.p), ["/internal/Trip/a.jpg", "/internal/Other/a.jpg"]);
  // A folder moved to the Trash takes its copies out of every group.
  const after = D.without(fg, { "/internal/Copy of Trip": true });
  assert.equal(after.length, 1);
  assert.equal(after[0].items.length, 2);
});
