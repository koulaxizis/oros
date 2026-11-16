// Studio wave A4: studio/mp4.js, the M4B audiobook writer. The file is
// walked box by box here (sizes, offsets, sample tables, edit list,
// chapters in both forms, iTunes tags, cover) and read by ffprobe and
// ffmpeg where they are installed.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");
const A = require(path.join(__dirname, "..", "studio/aac.js"));
const M = require(path.join(__dirname, "..", "studio/mp4.js"));

const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "udta", "ilst", "tref", "gmhd"]);
function walk(b, a, e, out, pathTo) {
  while (a < e) {
    let size = b.readUInt32BE(a), type = b.toString("latin1", a + 4, a + 8), head = 8;
    if (size === 1) { size = Number(b.readBigUInt64BE(a + 8)); head = 16; }
    assert.ok(size >= head && a + size <= e, "box " + type + " fits");
    const p = pathTo + "/" + type, node = { type, a, size, head, body: a + head, end: a + size };
    (out[p] = out[p] || []).push(node);
    if (CONTAINERS.has(type) || /^©|^(aART|desc|cprt|stik|covr)$/.test(type)) walk(b, a + head, a + size, out, p);
    if (type === "meta") walk(b, a + head + 4, a + size, out, p);
    a += size;
  }
  assert.equal(a, e, "boxes end where their parent ends");
}
const one = (t, p) => { assert.ok(t[p], "missing " + p); return t[p]; };

function book() {
  const rate = 44100, s = new A.Stream(1, rate, 48), chapters = []; let at = 0;
  for (const [title, sec, f] of [["Opening credits", 1.2, 300], ["Κεφάλαιο 1 — Η αρχή", 2.7, 440], ["Closing", 0.9, 520]]) {
    chapters.push({ at: at / rate, title });
    const n = Math.round(sec * rate), x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 0.3 * Math.sin(2 * Math.PI * f * i / rate);
    s.push([x]); at += n;
  }
  s.end();
  const cover = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const out = M.audiobook({ asc: s.asc(), rate, ch: 1, delay: 1024, samples: s.n, units: s.units(), chapters,
    tags: { title: "Το βιβλίο", artist: "Χ. Κ.", album: "Το βιβλίο", composer: "Αφηγητής Α.", year: "2026", genre: "Audiobook", desc: "A test" },
    cover: { bytes: cover } });
  return { s, out, chapters, rate, samples: at, cover, file: Buffer.from(M.join(out)) };
}

test("the boxes nest and the sample tables point at every access unit", () => {
  const { s, out, file, rate, samples } = book(), t = {};
  assert.equal(file.length, out.size);
  walk(file, 0, file.length, t, "");
  const ftyp = one(t, "/ftyp")[0];
  assert.equal(file.toString("latin1", ftyp.body, ftyp.body + 4), "M4B ");
  assert.ok(one(t, "/moov")[0].a < one(t, "/mdat")[0].a, "moov before mdat");
  const traks = one(t, "/moov/trak");
  assert.equal(traks.length, 2);
  const mvhd = one(t, "/moov/mvhd")[0];
  assert.equal(file.readUInt32BE(mvhd.body + 12), 1000);
  assert.equal(file.readUInt32BE(mvhd.body + 16), Math.round(samples / rate * 1000));
  // audio: stsz sizes = the units, stco/stsc reach them in order
  const stbl = "/moov/trak/mdia/minf/stbl";
  const stsz = one(t, stbl + "/stsz")[0], n = file.readUInt32BE(stsz.body + 8), units = s.units();
  assert.equal(n, units.length);
  const stco = one(t, stbl + "/stco")[0], stsc = one(t, stbl + "/stsc")[0];
  const chunks = []; for (let i = 0; i < file.readUInt32BE(stco.body + 4); i++) chunks.push(file.readUInt32BE(stco.body + 8 + 4 * i));
  const runs = []; for (let i = 0; i < file.readUInt32BE(stsc.body + 4); i++) runs.push([file.readUInt32BE(stsc.body + 8 + 12 * i), file.readUInt32BE(stsc.body + 12 + 12 * i)]);
  let k = 0;
  for (let c = 0; c < chunks.length && k < n; c++) {
    let per = 0; runs.forEach((r) => { if (r[0] <= c + 1) per = r[1]; });
    let at = chunks[c];
    for (let j = 0; j < per && k < n; j++, k++) {
      const size = file.readUInt32BE(stsz.body + 12 + 4 * k);
      assert.equal(size, units[k].length);
      assert.ok(file.subarray(at, at + size).equals(Buffer.from(units[k])), "unit " + k + " in place");
      at += size;
    }
  }
  assert.equal(k, n, "every unit is in a chunk");
  // the edit list skips the priming frame and ends with the book
  const elst = one(t, "/moov/trak/edts/elst")[0];
  assert.equal(file.readUInt32BE(elst.body + 4), 1);
  assert.equal(file.readUInt32BE(elst.body + 8), Math.round(samples / rate * 1000));
  assert.equal(file.readUInt32BE(elst.body + 12), 1024);
  // esds carries the AudioSpecificConfig
  const stsd = one(t, stbl + "/stsd")[0];
  assert.ok(file.subarray(stsd.body, stsd.end).includes(Buffer.from([0x05, 0x80, 0x80, 0x80, 0x02, ...s.asc()])));
});

test("chapters: a text track the audio track points at, and Nero chpl", () => {
  const { file, chapters, rate, samples } = book(), t = {};
  walk(file, 0, file.length, t, "");
  const tref = one(t, "/moov/trak/tref")[0];
  assert.equal(file.toString("latin1", tref.body + 4, tref.body + 8), "chap");
  assert.equal(file.readUInt32BE(tref.body + 8), 2);
  const stts = one(t, "/moov/trak/mdia/minf/stbl/stts")[1];
  const durs = []; for (let i = 0; i < file.readUInt32BE(stts.body + 4); i++) durs.push(file.readUInt32BE(stts.body + 12 + 8 * i));
  assert.equal(durs.length, 3);
  assert.equal(durs.reduce((x, y) => x + y, 0), Math.round(samples / rate * 1000));
  const stco = one(t, "/moov/trak/mdia/minf/stbl/stco")[1];
  for (let i = 0; i < 3; i++) {
    const at = file.readUInt32BE(stco.body + 8 + 4 * i), len = file.readUInt16BE(at);
    assert.equal(file.toString("utf8", at + 2, at + 2 + len), chapters[i].title);
    assert.equal(file.toString("latin1", at + 2 + len + 4, at + 2 + len + 8), "encd");
  }
  const chpl = one(t, "/moov/udta/chpl")[0];
  assert.equal(file[chpl.body], 1, "version 1");
  assert.equal(file[chpl.body + 8], 3);
  let p = chpl.body + 9;
  for (let i = 0; i < 3; i++) {
    const start = Number(file.readBigUInt64BE(p)), len = file[p + 8];
    assert.ok(Math.abs(start / 1e7 - chapters[i].at) < 1e-6);
    assert.equal(file.toString("utf8", p + 9, p + 9 + len), chapters[i].title);
    p += 9 + len;
  }
});

test("iTunes tags, media kind audiobook and the cover", () => {
  const { file, cover } = book(), t = {};
  walk(file, 0, file.length, t, "");
  const data = (name) => { const d = one(t, "/moov/udta/meta/ilst/" + name + "/data")[0]; return { kind: file.readUInt32BE(d.body), v: file.subarray(d.body + 8, d.end) }; };
  assert.equal(data("©nam").v.toString("utf8"), "Το βιβλίο");
  assert.equal(data("©ART").v.toString("utf8"), "Χ. Κ.");
  assert.equal(data("aART").v.toString("utf8"), "Χ. Κ.");
  assert.equal(data("©wrt").v.toString("utf8"), "Αφηγητής Α.");
  assert.equal(data("©day").v.toString("utf8"), "2026");
  assert.deepEqual([...data("stik").v], [2]); assert.equal(data("stik").kind, 21);
  assert.equal(data("covr").kind, 13); assert.ok(data("covr").v.equals(cover));
});

test("chapter lists are cleaned and the input is checked", () => {
  const C = M._test.chapterList;
  assert.deepEqual(C([{ at: 3, title: "b" }, { at: 0.5, title: "a\u0001" }, { at: 99, title: "out" }, { at: -1, title: "x" }, { at: 3, title: "dup" }], 10),
    [{ at: 0, title: "a" }, { at: 3, title: "b" }]);
  assert.equal(C(Array.from({ length: 300 }, (_, i) => ({ at: i, title: "c" + i })), 1000).length, 255);
  assert.throws(() => M.audiobook({ units: [] }), /audio/);
  const s = A.encode([new Float32Array(5000)], 44100, 64);
  const plain = M.audiobook({ asc: s.asc(), rate: 44100, ch: 1, delay: 1024, samples: 5000, units: s.units() }), t = {};
  const f = Buffer.from(M.join(plain)); walk(f, 0, f.length, t, "");
  assert.equal(one(t, "/moov/trak").length, 1, "no chapter track without chapters");
  assert.ok(!t["/moov/udta/chpl"]);
});

test("ffprobe reads the chapters and tags and ffmpeg the exact length, where installed", (t) => {
  try { execFileSync("ffprobe", ["-version"], { stdio: "ignore" }); } catch (e) { t.skip("no ffprobe"); return; }
  const { file, chapters, samples } = book(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "m4b-")), f = path.join(dir, "t.m4b");
  fs.writeFileSync(f, file);
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_chapters", "-show_format", "-of", "json", f]).toString());
  assert.deepEqual(j.chapters.map((c) => c.tags.title), chapters.map((c) => c.title));
  assert.equal(j.format.tags.title, "Το βιβλίο");
  assert.equal(j.format.tags.composer, "Αφηγητής Α.");
  assert.equal(j.format.tags.media_type, "2");
  assert.ok(Math.abs(Number(j.format.duration) - samples / 44100) < 0.002);
  fs.rmSync(dir, { recursive: true, force: true });
});
