// Files › Photos (files/photos-core.js): EXIF date / GPS / camera from
// JPEG, PNG and WebP, MP4 / MOV creation time, duration and place,
// dates from file names, the timeline, which paths are listed, near-
// duplicate hashes. Fixtures in tests/fixtures/photos were written by
// Pillow 12 and FFmpeg; clip.mp4 also has the ©xyz place box Android
// cameras write (ffprobe reads it back as "location").
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../files/photos-core.js");

const fx = (n) => new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", "photos", n)));
const wall = (y, m, d, h, mi, s) => Date.UTC(y, m - 1, d, h, mi, s);

test("kinds by extension", () => {
  assert.equal(C.kindOf("a.JPG"), "image");
  assert.equal(C.kindOf("b.heic"), "image");
  assert.equal(C.kindOf("c.webp"), "image");
  assert.equal(C.kindOf("d.MOV"), "video");
  assert.equal(C.kindOf("e.mp4"), "video");
  assert.equal(C.kindOf("f.pdf"), null);
  assert.equal(C.kindOf("jpg"), null);
});

test("JPEG EXIF: date, offset, camera, orientation, GPS north-east", () => {
  const e = C.readExif(fx("gps.jpg"));
  assert.equal(e.date, "2026:08:14 18:42:07");
  assert.equal(e.offset, "+03:00");
  assert.equal(e.make, "Google");
  assert.equal(e.model, "Pixel 8");
  assert.equal(e.orientation, 6);
  assert.equal(e.lat, 37.975);
  assert.equal(e.lon, 23.72);
  assert.equal(C.exifDate(e.date), wall(2026, 8, 14, 18, 42, 7));
});

test("PNG eXIf and WebP EXIF chunks; south and west are negative", () => {
  for (const f of ["sw.png", "sw.webp"]) {
    const e = C.readExif(fx(f));
    assert.equal(e.date, "2025:01:02 03:04:05", f);
    assert.equal(e.lat, -33.866667, f);
    assert.equal(e.lon, -70.666667, f);
  }
});

test("a zero EXIF date is no date; a JPEG without EXIF gives null", () => {
  assert.equal(C.readExif(fx("zero-date.jpg")).date, "");
  assert.equal(C.readExif(new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", "scanpdf", "plain.jpg")))), null);
  assert.equal(C.readExif(new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", "scanpdf", "exif6.jpg")))).orientation, 6);
});

test("damaged and hostile bytes never throw and give no metadata", () => {
  const good = fx("gps.jpg");
  assert.equal(C.readExif(null), null);
  assert.equal(C.readExif(new Uint8Array(3)), null);
  // Every truncation of a real file.
  for (let n = 0; n < good.length; n += 7) {
    const r = C.readExif(good.subarray(0, n));
    assert.ok(r === null || typeof r === "object");
  }
  // Random flips in the EXIF part.
  let seed = 7;
  for (let k = 0; k < 300; k++) {
    const b = new Uint8Array(good);
    for (let j = 0; j < 6; j++) {
      seed = (seed * 16807) % 2147483647;
      b[2 + (seed % 400)] = seed & 255;
    }
    const r = C.readExif(b);
    if (r && r.lat !== null) assert.ok(C.validGps(r.lat, r.lon));
  }
  // A TIFF whose IFD points at itself / far away.
  const t = new Uint8Array([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0xff, 0xff, 0, 0]);
  assert.equal(C.readExif(t), null);
  const t2 = new Uint8Array([0x49, 0x49, 42, 0, 0xff, 0xff, 0xff, 0x7f, 0, 0, 0, 0]);
  assert.equal(C.readExif(t2), null);
});

test("MP4: creation time (UTC), duration, place from the ©xyz box", () => {
  const v = C.mp4Scan(fx("clip.mp4"), 0);
  assert.equal(v.created, Date.UTC(2026, 6, 1, 9, 15, 30));
  assert.equal(v.duration, 2000);
  assert.equal(v.lat, 37.9838);
  assert.equal(v.lon, 23.7275);
  const f = C.mp4Scan(fx("fast.mp4"), 0);         // moov first (faststart)
  assert.equal(f.created, Date.UTC(2026, 6, 1, 9, 15, 30));
  assert.equal(f.lat, null);
  const q = C.mp4Scan(fx("clip.mov"), 0);         // QuickTime
  assert.equal(q.created, Date.UTC(2024, 1, 29, 23, 59, 0));
});

test("MP4 with moov at the end: the head says where to read, the tail parses", () => {
  const all = fx("clip.mp4");
  const head = C.mp4Scan(all.subarray(0, 60), 0);
  assert.ok(head && head.next > 60);
  const tail = C.mp4Scan(all.subarray(head.next), head.next);
  assert.equal(tail.duration, 2000);
  // A tail piece that holds only part of moov asks for moov's start.
  const part = C.mp4Scan(all.subarray(head.next, head.next + 40), head.next);
  assert.equal(part, null);
  assert.equal(C.mp4Scan(fx("gps.jpg"), 0), null);
  for (let n = 0; n < all.length; n += 13) {
    const r = C.mp4Scan(all.subarray(0, n), 0);
    assert.ok(r === null || typeof r === "object");
  }
});

test("ISO 6709 places", () => {
  assert.deepEqual(C.iso6709("+37.9838+023.7275+012.000/"), { lat: 37.9838, lon: 23.7275 });
  assert.deepEqual(C.iso6709("-33.8667-070.6667/"), { lat: -33.8667, lon: -70.6667 });
  assert.equal(C.iso6709("+00.0000+000.0000/"), null);
  assert.equal(C.iso6709("+95.0+10.0/"), null);
  assert.equal(C.iso6709("nowhere"), null);
});

test("dates from file names", () => {
  assert.equal(C.dateFromName("IMG_20261112_143015.jpg"), wall(2026, 11, 12, 14, 30, 15));
  assert.equal(C.dateFromName("PXL_20261112_143015123.jpg"), wall(2026, 11, 12, 14, 30, 15));
  assert.equal(C.dateFromName("VID_20260701_091530.mp4"), wall(2026, 7, 1, 9, 15, 30));
  assert.equal(C.dateFromName("Screenshot_20261112-143015.png"), wall(2026, 11, 12, 14, 30, 15));
  assert.equal(C.dateFromName("2026-11-12 14.30.15.jpg"), wall(2026, 11, 12, 14, 30, 15));
  assert.equal(C.dateFromName("signal-2026-11-12-143015.jpg"), wall(2026, 11, 12, 14, 30, 15));
  assert.equal(C.dateFromName("IMG-20261112-WA0001.jpg"), wall(2026, 11, 12, 12, 0, 0));
  assert.equal(C.dateFromName("IMG_20260231_101010.jpg"), 0);   // 31 Feb
  assert.equal(C.dateFromName("holiday.jpg"), 0);
  assert.equal(C.dateFromName("IMG_1234.JPG"), 0);
});

test("the best date: EXIF, then video, then the name, then the file", () => {
  const tz = -120;   // Athens in winter: getTimezoneOffset() = -120
  assert.deepEqual(C.pickDate({ exif: { date: "2026:08:14 18:42:07" }, name: "IMG_20200101_000000.jpg", mtime: 1 }),
    { t: wall(2026, 8, 14, 18, 42, 7), src: "exif" });
  assert.deepEqual(C.pickDate({ video: { created: Date.UTC(2026, 0, 5, 10, 0, 0) }, tz }),
    { t: wall(2026, 1, 5, 12, 0, 0), src: "video" });
  assert.deepEqual(C.pickDate({ exif: { date: "" }, name: "IMG_20261112_143015.jpg", mtime: 5 }),
    { t: wall(2026, 11, 12, 14, 30, 15), src: "name" });
  assert.deepEqual(C.pickDate({ name: "x.jpg", mtime: Date.UTC(2026, 10, 12, 22, 30, 0), tz }),
    { t: wall(2026, 11, 13, 0, 30, 0), src: "file" });
  assert.equal(C.pickDate({}).t, 0);
});

test("timeline: months and days, newest first, same time sorted by path", () => {
  const items = [
    { path: "/internal/b.jpg", t: wall(2026, 11, 12, 10, 0, 0) },
    { path: "/internal/a.jpg", t: wall(2026, 11, 12, 10, 0, 0) },
    { path: "/internal/c.jpg", t: wall(2026, 11, 3, 9, 0, 0) },
    { path: "/internal/d.jpg", t: wall(2026, 10, 31, 23, 59, 0) },
    { path: "/internal/e.jpg", t: 0 },
    null
  ];
  const tl = C.timeline(items);
  assert.deepEqual(tl.map((m) => [m.key, m.count]), [["2026-11", 3], ["2026-10", 1], ["0000-00", 1]]);
  assert.deepEqual(tl[0].days.map((d) => d.key), ["2026-11-12", "2026-11-03"]);
  assert.deepEqual(tl[0].days[0].items.map((x) => x.path), ["/internal/a.jpg", "/internal/b.jpg"]);
  assert.deepEqual(C.timeline([]), []);
});

test("which paths the view lists", () => {
  assert.equal(C.indexable("/internal/Pictures/a.jpg"), true);
  assert.equal(C.indexable("/internal/Drive/Pixel/Camera backup/IMG_1.jpg"), true);
  assert.equal(C.indexable("/internal/a.mp4"), true);
  assert.equal(C.indexable("/internal/notes.txt"), false);
  assert.equal(C.indexable("/internal/.trash/x/a.jpg"), false);
  assert.equal(C.indexable("/internal/Pictures/.thumbs/a.jpg"), false);
  assert.equal(C.indexable("/internal/Documents/2026/scan.jpg"), false);
  assert.equal(C.indexable("/internal/Invoices/logo.png"), false);
  assert.equal(C.indexable("/internal/Health/x.jpg"), false);
  assert.equal(C.indexable("/computer/home/a.jpg"), false);
  assert.equal(C.indexable("/internal//a.jpg"), false);
  // The person's own choices: a skipped folder they want, or fewer skips.
  assert.equal(C.indexable("/internal/Atelier/Trip/a.jpg", { extra: ["/internal/Atelier/Trip"] }), true);
  assert.equal(C.indexable("/internal/Invoices/logo.png", { skip: [] }), true);
  assert.equal(C.indexable("/internal/Documents/a.jpg", { skip: [], extra: ["/internal/Documents"] }), false);
});

test("which folders a walk enters", () => {
  assert.equal(C.dirWanted("/internal"), true);
  assert.equal(C.dirWanted("/internal/Pictures/2026"), true);
  assert.equal(C.dirWanted("/internal/.trash"), false);
  assert.equal(C.dirWanted("/internal/Pictures/.thumbs"), false);
  assert.equal(C.dirWanted("/internal/Documents"), false);
  assert.equal(C.dirWanted("/internal/Invoices"), false);
  assert.equal(C.dirWanted("/internal/Atelier", { extra: ["/internal/Atelier/Trip"] }), true);
  assert.equal(C.dirWanted("/internal/Atelier/Other", { extra: ["/internal/Atelier/Trip"] }), false);
  assert.equal(C.dirWanted("/internal/Atelier/Trip/day1", { extra: ["/internal/Atelier/Trip"] }), true);
  assert.equal(C.dirWanted("/computer/home"), false);
});

test("near-duplicate hashes", () => {
  const g = [];
  for (let i = 0; i < 72; i++) g.push((i * 37) % 255);
  const h = C.dHash(g);
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.equal(C.hamming(h, h), 0);
  const g2 = g.slice(); g2[0] = 255; g2[10] = 0;
  assert.ok(C.hamming(h, C.dHash(g2)) <= 3);
  assert.equal(C.hamming("0000000000000000", "ffffffffffffffff"), 64);
  assert.equal(C.hamming("bad", h), 64);
  assert.equal(C.dHash([1, 2]), "");
});

test("map: points group per cell, newest first, stable; bounds of the placed records", () => {
  const pts = [
    { x: 10, y: 10, t: 5, k: "/internal/a.jpg" },
    { x: 20, y: 30, t: 9, k: "/internal/b.jpg" },
    { x: 70, y: 10, t: 1, k: "/internal/c.jpg" },
    { x: 20, y: 30, t: 9, k: "/internal/a2.jpg" },
    { x: NaN, y: 1, t: 1, k: "/internal/bad.jpg" }
  ];
  const g = C.cluster(pts, 64);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0].items.map((p) => p.k), ["/internal/a2.jpg", "/internal/b.jpg", "/internal/a.jpg"]);
  assert.equal(g[0].x, 20);
  assert.deepEqual(g[1].items.map((p) => p.k), ["/internal/c.jpg"]);
  assert.deepEqual(C.cluster(pts.slice().reverse(), 64).map((x) => x.items.map((p) => p.k)), g.map((x) => x.items.map((p) => p.k)));
  assert.deepEqual(C.cluster([], 64), []);
  assert.deepEqual(C.geoBounds([{ lat: 35.3, lon: 25.1 }, { lat: 37.9, lon: 23.7 }, { lat: 0, lon: 0 }, { lat: 99, lon: 1 }, {}]), [[35.3, 23.7], [37.9, 25.1]]);
  assert.equal(C.geoBounds([{}]), null);
});
