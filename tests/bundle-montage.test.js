// Montage .orosmontage bundle (montage/package.js build / parse /
// mediaOk, written by bundle.js writeBlob and read back with
// { big: true }): one project with every clip, track, effect, title
// and caption, its media in media/ under the app's own
// "<sha256>.<ext>" ids, opened again as a NEW project with fresh ids.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const B = require(path.join(__dirname, "..", "bundle.js"));
const C = require(path.join(__dirname, "..", "montage/core.js"));
const P = require(path.join(__dirname, "..", "montage/package.js"));

const NOW = new Date(2026, 9, 15, 10, 0, 0).getTime();
const MIME = "application/x-oros-montage";

// Tiny stand-ins with the right first bytes (MontageMedia.sniff rules)
const MP4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 1, 2, 3, 4, 5, 6, 7, 8]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 9, 9, 9, 9]);
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 0, 0, 7, 7, 7]);
// the same sniff MontageMedia uses (montage/media.js), enough for these
function sniff(b) {
  const at = (i, s) => [...s].every((ch, j) => b[i + j] === ch.charCodeAt(0));
  if (!b || b.length < 12) return "";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b[0] === 0x89 && at(1, "PNG")) return "png";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
  if (at(4, "ftyp") || at(4, "moov") || at(4, "mdat")) return "mp4";
  if (at(0, "OggS")) return "ogg";
  if (at(0, "RIFF") && at(8, "WAVE")) return "wav";
  if (at(0, "ID3")) return "mp3";
  return "";
}

async function ids() {
  return {
    vid: (await B.sha256(MP4)) + ".mp4",
    pic: (await B.sha256(PNG)) + ".png",
    snd: (await B.sha256(MP3)) + ".mp3"
  };
}
function project(k) {
  return {
    id: "p1", name: "Καλοκαίρι / summer", ar: "9:16", fps: 60, bg: "#102030", vs: true, dk: 60, m: NOW - 9,
    tombs: { gone1: NOW - 100 },
    items: {
      v1: { id: "v1", k: "video", tr: "main", src: k.vid, len: 12, in: 1, out: 9, sp: 1.5, vol: 80, o: 1, m: 5,
        flt: "warm", lk: { b: 10, c: -5, s: 0, t: 3 }, tx: null, kf: [{ t: 0, x: 0.1 }, { t: 2, x: 0.3 }],
        sr: [{ s: 1, v: 1 }, { s: 5, v: 2 }], ck: { col: "#00ff00", sim: 40, sm: 10 }, fc: [{ t: 0, x: 0.4, y: 0.5 }] },
      i1: { id: "i1", k: "image", tr: "main", src: k.pic, d: 3, o: 2, m: 6, tx: { k: "fade", d: 0.5 }, lut: k.pic },
      t1: { id: "t1", k: "title", tr: "main", d: 2, o: 3, m: 7, bg: "#000000", text: { t: "Τέλος", f: "serif", sz: 10, col: "#ffffff", al: "c", an: "pop" } },
      s1: { id: "s1", k: "shape", tr: "ov", at: 0.5, d: 2, m: 8, sh: { k: "star", col: "#f8d14a" } },
      c1: { id: "c1", k: "title", tr: "tt", at: 1, d: 2, m: 9, box: C.SUB_BOX, text: { t: "Γεια σου\nκόσμε", f: "sans", sz: 5.5, col: "#ffffff", ol: "#000000" } },
      a1: { id: "a1", k: "audio", tr: "a1", src: k.snd, len: 30, in: 0, out: 20, at: 0, m: 10, vol: 60, fi: 1, fo: 2 }
    }
  };
}
async function pack(p) {
  const k = await ids();
  const b = P.build(p);
  const disk = { [k.vid]: new Blob([MP4]), [k.pic]: new Blob([PNG]), [k.snd]: new Blob([MP3]) };
  const media = {};
  b.media.forEach((id) => { if (disk[id]) media[id] = disk[id]; });
  return B.writeBlob({
    mime: MIME, app: "montage", schema: "montage/1", content: b.content,
    meta: { title: b.title, modified: NOW, id: p.id, language: "el", generator: "orOS Montage" },
    media, preview: b.preview, thumbnail: PNG, date: new Date(NOW)
  });
}

test("build: the whole project in MontageCore's model, no tombstones, every media id", async () => {
  const k = await ids();
  const p = project(k);
  const b = P.build(p);
  assert.equal(b.content.kind, "oros-montage-package");
  assert.equal(b.content.ver, 1);
  assert.equal(b.content.project.tombs, undefined);
  assert.equal(b.title, "Καλοκαίρι / summer");
  assert.deepEqual(b.media, [k.vid, k.pic, k.snd].sort());
  const v = b.content.project.items.v1;
  assert.equal(v.flt, "warm");
  assert.equal(v.sr.length, 2);
  assert.ok(v.ck && v.kf && v.fc);
  assert.equal(b.content.project.items.i1.lut, k.pic);
  assert.equal(b.content.project.dk, 60);
  assert.ok(p.tombs.gone1, "the source is untouched");
  const tl = b.preview.find((x) => x.name === "timeline.txt").data;
  assert.match(tl, /## Main/);
  assert.match(tl, new RegExp("media/" + k.vid));
  const srt = b.preview.find((x) => x.name === "captions.srt").data;
  assert.match(srt, /00:00:01,000 --> 00:00:03,000\nΓεια σου\nκόσμε/);
});

test("writeBlob → read { big }: a NEW project, fresh ids, every detail kept, media by id", async () => {
  const k = await ids();
  const p = project(k);
  const blob = await pack(p);
  assert.equal(B.sniff(new Uint8Array(await blob.slice(0, 128).arrayBuffer())), MIME);
  const r = await B.read(blob, { mime: MIME, big: true });
  assert.deepEqual(r.changed, []);
  assert.deepEqual(Object.keys(r.media).sort(), [k.vid, k.pic, k.snd].sort());
  for (const id of Object.keys(r.media)) {
    const head = new Uint8Array(await r.media[id].blob.slice(0, 16).arrayBuffer());
    assert.ok(P.mediaOk(id, head, sniff), id);
  }
  let n = 0;
  const q = P.parse(r.content, { uid: () => "n" + (++n), now: NOW });
  assert.equal(q.id, "n1");
  assert.equal(q.name, p.name);
  assert.equal(q.ar, "9:16"); assert.equal(q.fps, 60); assert.equal(q.bg, "#102030"); assert.equal(q.vs, true); assert.equal(q.dk, 60);
  assert.deepEqual(q.tombs, {});
  assert.equal(Object.keys(q.items).length, 6);
  Object.keys(q.items).forEach((id) => { assert.ok(!p.items[id], "fresh id " + id); assert.equal(q.items[id].m, NOW); });
  // the same timeline: strip ids and stamps and compare clip by clip
  const norm = (pp) => {
    const w = C.merge({ projects: { [pp.id]: pp } }, null).projects[pp.id];
    return Object.keys(w.items).map((x) => { const it = Object.assign({}, w.items[x]); delete it.id; delete it.m; return JSON.stringify(it); }).sort();
  };
  assert.deepEqual(norm(q), norm(p));
  assert.equal(C.duration(q), C.duration(C.merge({ projects: { p1: p } }, null).projects.p1));
  assert.ok(r.thumbnail && r.thumbnail.length === PNG.length);
});

test("an unzipped folder (readFolder) opens the same way", async () => {
  const k = await ids();
  const zipBytes = new Uint8Array(await (await pack(project(k))).arrayBuffer());
  // unzip with bundle.js itself: read gives the parts; rebuild the folder list
  const r0 = await B.read(zipBytes, { mime: MIME });
  const list = [
    { path: "x/mimetype", bytes: new TextEncoder().encode(MIME) },
    { path: "x/content.json", bytes: new TextEncoder().encode(JSON.stringify(r0.content)) }
  ];
  Object.keys(r0.media).forEach((id) => list.push({ path: "x/media/" + id, bytes: r0.media[id].bytes }));
  const r = await B.readFolder(list, { mime: MIME, big: true });
  const q = P.parse(r.content, { now: NOW });
  assert.equal(Object.keys(q.items).length, 6);
  assert.ok(r.media[k.vid].blob);
});

test("media that changed outside orOS gets its real hash, and the clips follow", async () => {
  const k = await ids();
  const p = project(k);
  const b = P.build(p);
  const other = new Uint8Array(MP4); other[19] = 42;
  const blob = await B.writeBlob({ mime: MIME, app: "montage", content: b.content, media: { [k.vid]: new Blob([other]), [k.pic]: PNG, [k.snd]: MP3 } });
  // tamper: the manifest still says the old hash under the old name, the
  // bytes are new. writeBlob hashes the bytes it was given, so build a
  // folder whose media/<old id> holds the new bytes instead.
  const r0 = await B.read(blob, { mime: MIME });
  const list = [{ path: "mimetype", bytes: new TextEncoder().encode(MIME) },
    { path: "content.json", bytes: new TextEncoder().encode(JSON.stringify(r0.content)) },
    { path: "media/" + k.vid, bytes: other }, { path: "media/" + k.pic, bytes: PNG }, { path: "media/" + k.snd, bytes: MP3 }];
  const r = await B.readFolder(list, { mime: MIME, big: true });
  const nk = Object.keys(r.rekeyed);
  assert.equal(nk.length, 1);
  const q = P.parse(r.content, { now: NOW });
  const v = Object.keys(q.items).map((x) => q.items[x]).find((it) => it.k === "video");
  assert.equal(v.src, r.rekeyed[k.vid]);
  assert.ok(r.media[v.src]);
});

test("parse refuses what is not a Montage package; bad clips are dropped", () => {
  assert.throws(() => P.parse(null), /notpackage/);
  assert.throws(() => P.parse({ kind: "oros-kanban-package", ver: 1, board: {} }), /notpackage/);
  assert.throws(() => P.parse({ kind: "oros-montage-package", ver: 1 }), /notpackage/);
  const q = P.parse({ kind: "oros-montage-package", ver: 1, project: { name: "", ar: "7:3", fps: 24, items: {
    ok: { id: "ok", k: "title", tr: "tt", at: 0, d: 2, text: { t: "hi" } },
    bad: { id: "bad", k: "video", tr: "main", src: "../../etc/passwd", len: 3, in: 0, out: 2 },
    evil: { id: "evil", k: "image", tr: "main", src: "javascript:alert(1)", d: 2 },
    junk: "x"
  } } }, { now: NOW, name: "From file" });
  assert.equal(q.name, "From file");
  assert.equal(q.ar, "16:9");
  assert.equal(q.fps, 30);
  assert.equal(Object.keys(q.items).length, 1);
});

test("mediaOk: the id must be an app id and its bytes must match the extension", async () => {
  const k = await ids();
  assert.equal(P.mediaOk(k.vid, MP4, sniff), true);
  assert.equal(P.mediaOk(k.vid, PNG, sniff), false);
  assert.equal(P.mediaOk(k.pic.replace(".png", ".jpg"), PNG, sniff), false);
  assert.equal(P.mediaOk((await B.sha256(MP4)) + ".m4a", MP4, sniff), true);
  assert.equal(P.mediaOk("notes.txt", MP4, sniff), false);
  assert.equal(P.mediaOk(k.snd, MP3, sniff), true);
});
