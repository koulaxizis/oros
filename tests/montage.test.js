// Pure logic of Montage (montage/core.js): projects, the magnetic main
// track, transitions, what is on screen and heard at a time, the edits
// (split, trim, move, duplicate, detach sound) and the merge of the
// sync slice "montage" (symmetric, idempotent, tombstones).
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "montage/core.js"));

const T0 = 1760000000000;
const H = (c) => c.repeat(64);
const VID = H("a") + ".mp4", VID2 = H("b") + ".webm", PIC = H("c") + ".jpg", SND = H("d") + ".mp3";
const empty = () => C.merge(null, null);
const proj = (d, id) => d.projects[id || "p1"];
const J = (x) => JSON.stringify(x);

function base() {
  let d = C.newProject(empty(), { name: "Holiday", ar: "9:16" }, T0, "p1");
  d = C.addItem(d, "p1", { id: "v1", k: "video", tr: "main", src: VID, len: 20, in: 2, out: 12 }, T0 + 1);
  d = C.addItem(d, "p1", { id: "i1", k: "image", tr: "main", src: PIC, d: 4 }, T0 + 2);
  d = C.addItem(d, "p1", { id: "v2", k: "video", tr: "main", src: VID2, len: 8, in: 0, out: 8, sp: 2 }, T0 + 3);
  return d;
}

test("new project: defaults, canonical, ratio sizes", () => {
  const d = C.newProject(empty(), { name: "  Trip\n2026 ", ar: "4:5", fps: 60 }, T0, "p1");
  const p = proj(d);
  assert.equal(p.name, "Trip 2026");
  assert.equal(p.ar, "4:5"); assert.equal(p.fps, 60); assert.equal(p.bg, "#000000"); assert.equal(p.vs, false);
  assert.equal(p.m, T0);
  assert.equal(J(C.merge(d, d)), J(d));
  assert.deepEqual(C.outputSize("16:9", 1080), { w: 1920, h: 1080 });
  assert.deepEqual(C.outputSize("9:16", 1080), { w: 1080, h: 1920 });
  assert.deepEqual(C.outputSize("4:5", 1080), { w: 1080, h: 1350 });
  assert.deepEqual(C.outputSize("1:1", 720), { w: 720, h: 720 });
  assert.deepEqual(C.outputSize("16:9", 2160), { w: 3840, h: 2160 });
  // bad input changes nothing
  assert.equal(J(C.newProject(d, {}, T0, "p1")), J(d));
  assert.equal(J(C.newProject(d, {}, T0, "BAD ID")), J(d));
});

test("items: strict normalizer drops bad rows, clamps values", () => {
  const n = (o) => C.normItem(Object.assign({ id: "x1" }, o), "x1");
  assert.equal(n({ k: "video", tr: "main", src: "evil.js", in: 0, out: 5 }), null);
  assert.equal(n({ k: "video", tr: "a1", src: VID, in: 0, out: 5 }), null);         // wrong track for the kind
  assert.equal(n({ k: "audio", tr: "main", src: SND, in: 0, out: 5 }), null);
  assert.equal(n({ k: "video", tr: "main", src: VID, in: 3, out: 3 }), null);       // empty
  assert.equal(n({ k: "image", tr: "main", src: H("c") + ".svg" }), null);
  assert.equal(C.normItem({ id: "x2", k: "title", tr: "tt" }, "x1"), null);          // id must match the key
  const v = n({ k: "video", tr: "main", src: VID, len: 10, in: 4, out: 99, sp: 9, vol: 900, op: -5, rot: 45, flt: "x", tx: { k: "fade", d: 9 } });
  assert.equal(v.out, 10); assert.equal(v.sp, 4); assert.equal(v.vol, 200); assert.equal(v.op, 0);
  assert.equal(v.rot, 0); assert.equal(v.flt, "none"); assert.deepEqual(v.tx, { k: "fade", d: 2 });
  const t = n({ k: "title", tr: "tt", text: { t: "Hi\r\nthere", col: "red", al: "z", an: "pop", f: "noto<script>" } });
  assert.equal(t.text.t, "Hi\nthere"); assert.equal(t.text.col, "#ffffff"); assert.equal(t.text.al, "c");
  assert.equal(t.text.an, "pop"); assert.equal(t.text.f, "notoscript");
  assert.deepEqual(t.box, { x: 0.05, y: 0.72, w: 0.9, h: 0.2 });
  const a = n({ k: "audio", tr: "a1", src: VID, in: 0, out: 5, at: -3 });           // sound taken from a video file
  assert.equal(a.at, 0); assert.equal(a.src, VID);
});

test("main track is magnetic: clips follow each other, speed changes length", () => {
  const p = proj(base());
  const seq = C.mainSeq(p).map((s) => [s.it.id, s.start, s.end]);
  assert.deepEqual(seq, [["v1", 0, 10], ["i1", 10, 14], ["v2", 14, 18]]);
  assert.equal(C.duration(p), 18);
  // deleting the middle clip closes the gap
  const d2 = C.delItem(base(), "p1", "i1", T0 + 10);
  assert.deepEqual(C.mainSeq(proj(d2)).map((s) => [s.it.id, s.start]), [["v1", 0], ["v2", 10]]);
  assert.ok(proj(d2).tombs.i1 >= T0 + 10);
});

test("transitions overlap the clip before, at most half of either clip", () => {
  let d = C.setItem(base(), "p1", "i1", { tx: { k: "fade", d: 1 } }, T0 + 10);
  d = C.setItem(d, "p1", "v2", { tx: { k: "slide", d: 2 } }, T0 + 11);
  const seq = C.mainSeq(proj(d));
  assert.deepEqual(seq.map((s) => [s.it.id, s.start, s.end, s.tx]), [["v1", 0, 10, 0], ["i1", 9, 13, 1], ["v2", 11, 15, 2]]);
  // the first clip never has a transition in effect
  const d3 = C.setItem(base(), "p1", "v1", { tx: { k: "fade", d: 1 } }, T0 + 12);
  assert.equal(C.mainSeq(proj(d3))[0].start, 0);
  // fade: incoming alpha rises; slide: both move
  const pl = (t) => C.framePlan(proj(d), t);
  const mid = pl(9.5);
  assert.deepEqual(mid.map((l) => l.id), ["v1", "i1"]);
  assert.equal(mid[0].alpha, 1); assert.equal(mid[1].alpha, 0.5);
  const sl = pl(12);                                         // halfway through the slide into v2
  assert.equal(sl[0].id, "i1"); assert.equal(sl[0].dx, -0.5);
  assert.equal(sl[1].id, "v2"); assert.equal(sl[1].dx, 0.5);
  // black: out then in
  const d4 = C.setItem(base(), "p1", "i1", { tx: { k: "black", d: 2 } }, T0 + 13);
  const b = (t) => C.framePlan(proj(d4), t);
  assert.deepEqual(b(8.5).map((l) => [l.id, l.alpha, l.bri]), [["v1", 1, 0.5], ["i1", 0, 1]]);
  assert.deepEqual(b(9.5).map((l) => [l.id, l.alpha, l.bri]), [["v1", 0, 1], ["i1", 1, 0.5]]);
  // wipe reveals from the left
  const d5 = C.setItem(base(), "p1", "i1", { tx: { k: "wipe", d: 1 } }, T0 + 14);
  assert.deepEqual(C.framePlan(proj(d5), 9.25)[1].clip, [0, 0.25]);
});

test("framePlan: source time follows in point and speed; overlays and titles on top", () => {
  let d = base();
  d = C.addItem(d, "p1", { id: "o1", k: "image", tr: "ov", src: PIC, at: 1, d: 3 }, T0 + 5);
  d = C.addItem(d, "p1", { id: "t1", k: "title", tr: "tt", at: 0, d: 5, text: { t: "Hello" } }, T0 + 6);
  const L = C.framePlan(proj(d), 2);
  assert.deepEqual(L.map((l) => l.id), ["v1", "o1", "t1"]);
  assert.equal(L[0].st, 4);                                  // in 2 + 2 s
  assert.equal(L[2].text.t, "Hello");
  const L2 = C.framePlan(proj(d), 15);                       // v2 at speed 2
  assert.equal(L2[0].id, "v2"); assert.equal(L2[0].st, 2);
  assert.deepEqual(C.framePlan(proj(d), 30), []);
  // fade in multiplies opacity
  const d2 = C.setItem(d, "p1", "v1", { fi: 2, op: 50 }, T0 + 7);
  assert.equal(C.framePlan(proj(d2), 1)[0].alpha, 0.25);
});

test("soundPlan: muted clips are silent, transitions crossfade the sound", () => {
  let d = C.setItem(base(), "p1", "v2", { tx: { k: "fade", d: 1 } }, T0 + 10);
  d = C.addItem(d, "p1", { id: "m1", k: "audio", tr: "a1", src: SND, len: 60, in: 0, out: 60, at: 0, vol: 50, fo: 3 }, T0 + 11);
  let s = C.soundPlan(proj(d));
  assert.deepEqual(s.map((x) => [x.id, x.start, x.dur, x.fi, x.fo]), [["m1", 0, 60, 0, 3], ["v1", 0, 10, 0, 0], ["v2", 13, 4, 1, 0]]);
  assert.equal(C.gainAt(s[0], 58.5), 0.25);
  assert.equal(C.gainAt(s[2], 0.5), 0.5);
  d = C.setItem(d, "p1", "v1", { mu: true }, T0 + 12);
  assert.deepEqual(C.soundPlan(proj(d)).map((x) => x.id), ["m1", "v2"]);
});

test("split: one clip becomes two, same picture, no transition or fade at the cut", () => {
  let d = C.setItem(base(), "p1", "v1", { fi: 1, fo: 1 }, T0 + 9);
  d = C.split(d, "p1", "v1", 4, T0 + 10, "v1b");
  const p = proj(d);
  assert.deepEqual([p.items.v1.in, p.items.v1.out, p.items.v1.fo], [2, 6, 0]);
  assert.deepEqual([p.items.v1b.in, p.items.v1b.out, p.items.v1b.fi, p.items.v1b.fo], [6, 12, 0, 1]);
  assert.deepEqual(C.mainSeq(p).map((s) => s.it.id), ["v1", "v1b", "i1", "v2"]);
  assert.equal(C.duration(p), 18);
  // a still splits by length; too close to an edge does nothing
  const d2 = C.split(base(), "p1", "i1", 11, T0 + 10, "i1b");
  assert.deepEqual([proj(d2).items.i1.d, proj(d2).items.i1b.d], [1, 3]);
  assert.equal(J(C.split(base(), "p1", "i1", 10.05, T0 + 10, "zz")), J(base()));
  // overlays split in place
  let d3 = C.addItem(base(), "p1", { id: "o1", k: "video", tr: "ov", src: VID, len: 20, in: 0, out: 10, at: 5, sp: 2 }, T0 + 5);
  d3 = C.split(d3, "p1", "o1", 7, T0 + 6, "o2");
  assert.deepEqual([proj(d3).items.o1.out, proj(d3).items.o2.in, proj(d3).items.o2.at], [4, 4, 7]);
});

test("move, duplicate, detach sound, change track", () => {
  let d = C.moveMain(base(), "p1", "v2", null, T0 + 10);
  assert.deepEqual(C.mainSeq(proj(d)).map((s) => s.it.id), ["v2", "v1", "i1"]);
  d = C.moveMain(d, "p1", "v2", "v1", T0 + 11);
  assert.deepEqual(C.mainSeq(proj(d)).map((s) => s.it.id), ["v1", "v2", "i1"]);
  d = C.duplicate(d, "p1", "v1", T0 + 12, "v1c");
  assert.deepEqual(C.mainSeq(proj(d)).map((s) => s.it.id), ["v1", "v1c", "v2", "i1"]);
  d = C.detachSound(d, "p1", "v1c", T0 + 13, "s1", "a2");
  const p = proj(d);
  assert.equal(p.items.v1c.mu, true);
  assert.deepEqual([p.items.s1.tr, p.items.s1.at, p.items.s1.in, p.items.s1.out], ["a2", 10, 2, 12]);
  // a main clip moved to the overlay track keeps its place in time
  d = C.setItem(d, "p1", "v2", { tr: "ov" }, T0 + 14);
  assert.equal(proj(d).items.v2.at, 20); assert.equal(proj(d).items.v2.tx, undefined);
  // many inserts at the same spot keep a strict order (renumbering)
  let e = base();
  for (let i = 0; i < 60; i++) e = C.addItem(e, "p1", { id: "n" + (100 + i), k: "image", tr: "main", src: PIC, d: 1 }, T0 + 20 + i, { after: "v1" });
  const ids = C.mainSeq(proj(e)).map((s) => s.it.id);
  assert.equal(ids.length, 63);
  assert.equal(ids[0], "v1"); assert.equal(ids[1], "n159"); assert.equal(ids[60], "n100"); assert.equal(ids[61], "i1");
});

test("edits stamp mtime only on a real change (R27)", () => {
  const d = base();
  assert.equal(J(C.setItem(d, "p1", "v1", { vol: 100 }, T0 + 50)), J(d));
  assert.equal(J(C.setProject(d, "p1", { name: "Holiday" }, T0 + 50)), J(d));
  const d2 = C.setProject(d, "p1", { name: "Summer", vs: true }, T0 + 50);
  assert.equal(proj(d2).m, T0 + 50); assert.equal(proj(d2).vs, true);
  // a clock behind the last edit still moves forward
  const d3 = C.setItem(d, "p1", "v1", { vol: 80 }, T0 - 1000);
  assert.ok(proj(d3).items.v1.m > proj(d).items.v1.m);
});

test("merge: symmetric, idempotent, per item last writer wins", () => {
  const d = base();
  const a = C.setItem(d, "p1", "v1", { vol: 50 }, T0 + 100);
  const b = C.setItem(C.setProject(d, "p1", { name: "B" }, T0 + 90), "p1", "i1", { d: 6 }, T0 + 110);
  const ab = C.merge(a, b), ba = C.merge(b, a);
  assert.equal(J(ab), J(ba));
  assert.equal(J(C.merge(ab, ab)), J(ab));
  assert.equal(proj(ab).name, "B");
  assert.equal(proj(ab).items.v1.vol, 50);
  assert.equal(proj(ab).items.i1.d, 6);
  // same mtime: deterministic pick
  const x = C.setItem(d, "p1", "v1", { vol: 10 }, T0 + 200), y = C.setItem(d, "p1", "v1", { vol: 20 }, T0 + 200);
  assert.equal(J(C.merge(x, y)), J(C.merge(y, x)));
});

test("merge: tombstones; a newer edit resurrects (R17)", () => {
  const d = base();
  const del = C.delItem(d, "p1", "v1", T0 + 100);
  const edOld = C.setItem(d, "p1", "v1", { vol: 70 }, T0 + 50);
  assert.equal(proj(C.merge(del, edOld)).items.v1, undefined);
  const edNew = C.setItem(d, "p1", "v1", { vol: 70 }, T0 + 150);
  assert.equal(proj(C.merge(del, edNew)).items.v1.vol, 70);
  // whole project
  const gone = C.delProject(d, "p1", T0 + 100);
  assert.equal(gone.projects.p1, undefined);
  assert.ok(gone.tombs.p1 > 0);
  assert.equal(C.merge(gone, d).projects.p1, undefined);
  const later = C.setItem(d, "p1", "i1", { d: 9 }, T0 + 500);
  assert.equal(C.merge(gone, later).projects.p1.items.i1.d, 9);
  // tombstones survive the round trip
  assert.equal(J(C.merge(C.merge(gone, d), gone)), J(C.merge(gone, d)));
});

test("merge: garbage in is dropped, never thrown", () => {
  const junk = { ver: 9, projects: { "p1": { items: { "x": 1, "v9": { id: "v9", k: "video", tr: "main", src: VID, in: 0, out: "5" } }, tombs: { a: "x" } }, "BAD": {}, "p2": 7 }, tombs: { "zz": -1 } };
  const m = C.merge(junk, null);
  assert.deepEqual(Object.keys(m.projects), ["p1"]);
  assert.deepEqual(m.projects.p1.items, {});
  assert.deepEqual(m.tombs, {});
  assert.equal(J(C.merge(m, m)), J(m));
});

test("helpers: media list, project order, times, file names", () => {
  const d = base();
  assert.deepEqual(C.mediaOf(proj(d)), [VID, VID2, PIC].sort());
  let e = C.newProject(d, { name: "Second" }, T0 + 1000, "p2");
  assert.deepEqual(C.projectList(e).map((p) => p.id), ["p2", "p1"]);
  e = C.setItem(e, "p1", "v1", { vol: 1 }, T0 + 2000);
  assert.deepEqual(C.projectList(e).map((p) => p.id), ["p1", "p2"]);
  assert.equal(C.fmtTime(75.5), "1:15");
  assert.equal(C.fmtTime(3725, true, 30), "1:02:05.00");
  assert.equal(C.fmtTime(1.5, true, 30), "0:01.15");
  assert.equal(C.exportName("My: trip/2026", "mp4"), "My trip 2026.mp4");
  assert.equal(C.exportName("", "webm"), "montage.webm");
  assert.equal(C.exportName("Trip 0-04", "png"), "Trip 0-04.png");
});

test("compositor helpers: contain / cover placement, title entrance", () => {
  const G = require(path.join(__dirname, "..", "montage/gl.js"));
  const full = { x: 0, y: 0, w: 1, h: 1 };
  // a 4:3 picture in a 16:9 frame: contain = pillar box, cover = cropped
  const fit = G.placeIn(full, 1440, 1080, 1920, 1080, false);
  assert.deepEqual([fit.x, fit.y, fit.w, fit.h], [0.125, 0, 0.75, 1]);
  const fill = G.placeIn(full, 1440, 1080, 1920, 1080, true);
  assert.equal(fill.w, 1); assert.ok(Math.abs(fill.h - 4 / 3) < 1e-9); assert.ok(Math.abs(fill.y + 1 / 6) < 1e-9);
  assert.deepEqual(G.titleAnim("none", 0), { a: 1, dy: 0, s: 1 });
  assert.equal(G.titleAnim("fade", 0).a, 0);
  assert.equal(G.titleAnim("rise", 1).dy, 0);
  assert.ok(G.titleAnim("rise", 0.1).dy > 0);
  // every filter the model accepts, the compositor draws
  assert.deepEqual(G.FILTERS.slice().sort(), C.FILTERS.slice().sort());
});

test("undo: restoring an earlier copy is a fresh edit that survives sync", () => {
  const before = base();
  const snap = JSON.parse(JSON.stringify(proj(before)));
  let d = C.split(before, "p1", "v1", 4, T0 + 10, "v1b");
  d = C.delItem(d, "p1", "i1", T0 + 11);
  d = C.setProject(d, "p1", { name: "Changed" }, T0 + 12);
  const r = C.restoreProject(d, "p1", snap, T0 + 20);
  const p = proj(r);
  assert.equal(p.name, "Holiday");
  assert.deepEqual(C.mainSeq(p).map((s) => s.it.id), ["v1", "i1", "v2"]);
  assert.equal(p.items.v1.out, 12);
  assert.ok(p.items.i1.m > proj(d).tombs.i1);                    // back, newer than its tombstone
  assert.ok(p.tombs.v1b >= T0 + 20);
  // the other device that still has the split copy converges on the restore
  assert.deepEqual(C.mainSeq(proj(C.merge(d, r))).map((s) => s.it.id), ["v1", "i1", "v2"]);
  // unchanged items keep their stamp
  assert.equal(p.items.v2.m, proj(before).items.v2.m);
});

test("hash: streaming SHA-256 equals the standard one at every boundary", () => {
  const Hh = require(path.join(__dirname, "..", "montage/hash.js"));
  const crypto = require("crypto");
  for (const n of [0, 1, 55, 56, 63, 64, 65, 127, 128, 1000, 70001]) {
    const b = crypto.randomBytes(n), h = Hh.create();
    for (let i = 0; i < n; i += 37) h.update(b.subarray(i, Math.min(n, i + 37)));
    assert.equal(h.hex(), crypto.createHash("sha256").update(b).digest("hex"), "size " + n);
  }
});

test("relink with another file: clips switch to it, points clamp to its length", () => {
  const NEW = H("e") + ".mp4";
  const d = C.replaceSrc(base(), "p1", VID, NEW, 9, T0 + 30);
  const v = proj(d).items.v1;
  assert.equal(v.src, NEW); assert.equal(v.len, 9); assert.equal(v.out, 9); assert.equal(v.in, 2);
  assert.ok(v.m >= T0 + 30);
  assert.equal(proj(d).items.v2.src, VID2);
});

test("undo a project delete: it comes back whole and beats the tombstone on every device", () => {
  const before = base();
  const del = C.delProject(before, "p1", T0 + 50);
  assert.equal(proj(del), undefined);
  const back = C.undeleteProject(del, proj(before), T0 + 51);
  const p = proj(back);
  assert.deepEqual(C.mainSeq(p).map((s) => s.it.id), ["v1", "i1", "v2"]);
  assert.equal(p.name, "Holiday");
  // a device that only saw the delete takes the return
  assert.ok(proj(C.merge(del, back)));
  assert.equal(J(C.merge(del, back)), J(C.merge(back, del)));
  // undeleting a project that exists does nothing
  assert.equal(J(C.undeleteProject(before, proj(before), T0 + 60)), J(before));
});

test("search provider: one hit per project with its text clips, read-only, safe on junk", () => {
  const P = require(path.join(__dirname, "..", "montage/search.js"));
  let d = base();
  d = C.addItem(d, "p1", { id: "t1", k: "title", tr: "tt", at: 1, d: 3, text: { t: "Summer\nin Crete" } }, T0 + 9);
  d = C.newProject(d, { name: "" }, T0 + 10, "p2");
  const raw = JSON.stringify(d);
  const hits = P.search({ readJSON: () => JSON.parse(raw), lang: "el" });
  assert.equal(P.id, "montage"); assert.deepEqual(P.keys, ["oros-montage"]);
  const h1 = hits.find((h) => h.id === "p:p1"), h2 = hits.find((h) => h.id === "p:p2");
  assert.equal(h1.title, "Holiday"); assert.equal(h1.text, "Summer in Crete");
  assert.deepEqual(h1.target, { project: "p1" });
  assert.equal(h2.title, "Untitled");                            // the core names an empty project
  for (const junk of [null, 5, "x", [], { projects: [] }, { projects: { "BAD ID": {} , p3: 7 } }]) {
    assert.deepEqual(P.search({ readJSON: () => junk, lang: "en" }), []);
  }
});

test("subtitles: SRT and WebVTT in, markup dropped, SRT out in time order", () => {
  const cues = C.parseSrt("\uFEFF1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i>\r\nworld\r\n\r\n" +
    "WEBVTT\n\n00:03.2 --> 00:04.000 align:start\n{\\an8}Bye &amp; thanks\n\n" +
    "3\n00:00:09,000 --> 00:00:08,000\nbackwards\n\n4\n00:00:05,000 --> 00:00:06,000\n<script>x</script>\n");
  assert.deepEqual(cues, [
    { start: 1, end: 2.5, text: "Hello\nworld" },
    { start: 3.2, end: 4, text: "Bye & thanks" },
    { start: 5, end: 6, text: "x" }
  ]);
  assert.deepEqual(C.parseSrt(""), []);
  assert.deepEqual(C.parseSrt(null), []);
  let d = C.addSubtitles(base(), "p1", cues, T0 + 10, ["s1", "s2", "s3"]);
  const s1 = proj(d).items.s1;
  assert.equal(s1.tr, "tt"); assert.equal(s1.k, "title"); assert.equal(s1.at, 1); assert.equal(s1.d, 1.5);
  assert.deepEqual(s1.box, C.SUB_BOX); assert.equal(s1.text.ol, "#000000"); assert.equal(s1.text.an, "none");
  assert.equal(J(C.merge(d, d)), J(d));
  assert.equal(C.toSrt(proj(d)),
    "1\n00:00:01,000 --> 00:00:02,500\nHello\nworld\n\n2\n00:00:03,200 --> 00:00:04,000\nBye & thanks\n\n3\n00:00:05,000 --> 00:00:06,000\nx\n");
  assert.deepEqual(C.parseSrt(C.toSrt(proj(d))), cues);
  assert.equal(C.toSrt(proj(base())), "");
  assert.equal(C.exportName("Trip", "srt"), "Trip.srt");
  assert.equal(C.exportName("Trip", "m4a"), "Trip.m4a");
  assert.equal(C.exportName("Trip", "exe"), "Trip.mp4");
});

test("ducking: music drops under the voice with short ramps; off by default and absent from the data", () => {
  let d = base();
  assert.equal("dk" in proj(d), false);
  d = C.addItem(d, "p1", { id: "m1", k: "audio", tr: "a1", src: SND, len: 60, in: 0, out: 30, at: 0 }, T0 + 5);
  d = C.addItem(d, "p1", { id: "vo", k: "audio", tr: "a2", src: SND, len: 60, in: 0, out: 4, at: 10 }, T0 + 6);
  const seg = (dd) => C.soundPlan(proj(dd)).find((s) => s.id === "m1");
  assert.equal(seg(d).duck, undefined);
  assert.equal(C.gainAt(seg(d), 12), 1);
  d = C.setProject(d, "p1", { dk: 60 }, T0 + 7);
  assert.equal(proj(d).dk, 60);
  const s = seg(d);
  assert.deepEqual(s.duck, [[10, 14]]);
  assert.ok(Math.abs(C.gainAt(s, 12) - 0.4) < 1e-9);
  assert.equal(C.gainAt(s, 5), 1);
  assert.ok(Math.abs(C.gainAt(s, 10 - C.DUCK_RAMP / 2) - 0.7) < 1e-9);
  assert.ok(Math.abs(C.gainAt(s, 14 + C.DUCK_RAMP / 2) - 0.7) < 1e-9);
  assert.equal(C.soundPlan(proj(d)).find((x) => x.id === "vo").duck, undefined);   // the voice itself never ducks
  // a muted voice does not duck
  const muted = C.setItem(d, "p1", "vo", { mu: true }, T0 + 8);
  assert.equal(seg(muted).duck, undefined);
  // off again: the field leaves the data, so older copies read the same project
  const off = C.setProject(d, "p1", { dk: 0 }, T0 + 9);
  assert.equal("dk" in proj(off), false);
  assert.equal(J(C.merge(off, off)), J(off));
  // undo brings the setting back and forth
  const back = C.restoreProject(off, "p1", proj(d), T0 + 10);
  assert.equal(proj(back).dk, 60);
  assert.equal("dk" in proj(C.restoreProject(d, "p1", proj(off), T0 + 11)), false);
  assert.equal(proj(C.merge({ projects: { p1: Object.assign({}, proj(d), { dk: 500 }) } }, null)).dk, 90);
});

test("freeze frame: the still sits between the two halves of the clip", () => {
  const d0 = base(), STILL = H("e") + ".png";
  const d = C.freezeAt(d0, "p1", "v1", 4, STILL, 2, T0 + 10, { tail: "v1b", still: "fz" });
  const seq = C.mainSeq(proj(d)).map((s) => s.it.id);
  assert.deepEqual(seq, ["v1", "fz", "v1b", "i1", "v2"]);
  assert.equal(proj(d).items.fz.k, "image"); assert.equal(proj(d).items.fz.d, 2);
  assert.equal(proj(d).items.v1.out, 6); assert.equal(proj(d).items.v1b.in, 6);
  assert.equal(C.duration(proj(d)), C.duration(proj(d0)) + 2);
  // at the very start: the still goes before the clip, nothing is split
  const d2 = C.freezeAt(d0, "p1", "i1", 10, STILL, 2, T0 + 10, { tail: "x", still: "fz" });
  assert.equal(J(d2), J(d0));                                   // pictures do not freeze
  const d3 = C.freezeAt(d0, "p1", "v2", 14, STILL, 2, T0 + 10, { tail: "x", still: "fz" });
  assert.deepEqual(C.mainSeq(proj(d3)).map((s) => s.it.id), ["v1", "i1", "fz", "v2"]);
  assert.equal(J(C.freezeAt(d0, "p1", "v1", 4, "bad.png", 2, T0, { tail: "a", still: "b" })), J(d0));
});

test("new transitions: push, zoom and circle shape the incoming clip", () => {
  let d = C.setItem(base(), "p1", "i1", { tx: { k: "zoom", d: 1 } }, T0 + 10);
  const at = (dd, t, id) => C.framePlan(proj(dd), t).find((L) => L.id === id);
  const pl = C.placeOf(proj(d), "i1");
  const z = at(d, pl.start + 0.5, "i1");
  assert.ok(z.sc > 1 && z.sc < 1.3); assert.ok(z.alpha > 0 && z.alpha < 1);
  d = C.setItem(d, "p1", "i1", { tx: { k: "circle", d: 1 } }, T0 + 11);
  assert.ok(Math.abs(at(d, pl.start + 0.25, "i1").iris - 0.25) < 1e-9);
  assert.equal(at(d, pl.start + 2, "i1").iris, -1);
  d = C.setItem(d, "p1", "i1", { tx: { k: "push", d: 1 } }, T0 + 12);
  assert.ok(Math.abs(at(d, pl.start + 0.25, "i1").dy - 0.75) < 1e-9);
  assert.ok(Math.abs(at(d, pl.start + 0.25, "v1").dy + 0.25) < 1e-9);
  assert.equal(proj(C.setItem(d, "p1", "i1", { flt: "golden" }, T0 + 13)).items.i1.flt, "golden");
});

test("keyframes: normalized, even pace between keys, applied to picture and sound, kept across a split", () => {
  let d = base();
  const it0 = proj(d).items.v1;
  // garbage is dropped, values clamp, one key per time, sorted; absent when empty
  d = C.setItem(d, "p1", "v1", { kf: [{ t: 4, x: 9, s: 0.5, v: 300 }, { t: 0 }, { t: "x" }, null, { t: 4, o: 50 }] }, T0 + 10);
  let v1 = proj(d).items.v1;
  assert.deepEqual(v1.kf, [{ t: 0, x: 0, y: 0, s: 1, o: 100, v: 100 }, { t: 4, x: 0, y: 0, s: 1, o: 50, v: 100 }]);
  assert.equal("kf" in it0, false);
  assert.equal("kf" in proj(C.setItem(d, "p1", "v1", { kf: [] }, T0 + 11)).items.v1, false);
  assert.equal(J(C.merge(d, d)), J(d));
  // an even pace between keys, held outside them
  assert.equal(C.kfAt(v1, 2).o, 75);
  assert.equal(C.kfAt(v1, 1).o, 87.5);
  assert.equal(C.kfAt(v1, 9).o, 50);
  // set a key: scale + move the picture; sound keys on a sound clip only
  d = C.setItem(d, "p1", "v1", { kf: C.kfSet(v1, 4, { s: 2, x: 0.1 }) }, T0 + 12);
  v1 = proj(d).items.v1;
  assert.deepEqual(v1.kf[1], { t: 4, x: 0.1, y: 0, s: 2, o: 50, v: 100 });
  const L = C.framePlan(proj(d), 4.5).find((x) => x.id === "v1");
  assert.deepEqual(L.box, { x: -0.4, y: -0.5, w: 2, h: 2 });
  assert.equal(L.alpha, 0.5);
  assert.deepEqual(C.kfSet(v1, 4, null).map((k) => k.t), [0]);
  // volume keys reach the sound plan and gainAt
  d = C.setItem(d, "p1", "v1", { kf: C.kfSet(v1, 0, { v: 0 }) }, T0 + 13);
  const seg = C.soundPlan(proj(d)).find((x) => x.id === "v1");
  assert.deepEqual(seg.kv, [[0, 0], [4, 1]]);
  assert.equal(C.gainAt(seg, 0), 0);
  assert.equal(C.gainAt(seg, 2), 0.5);
  assert.equal(C.gainAt(seg, 6), 1);
  const music = C.addItem(d, "p1", { id: "m1", k: "audio", tr: "a1", src: SND, len: 9, in: 0, out: 9, at: 0, kf: [{ t: 1, x: 1, v: 50 }] }, T0 + 14);
  assert.deepEqual(proj(music).items.m1.kf, [{ t: 1, v: 50 }]);
  // split: both halves move exactly as before
  const before = [1, 3, 5, 7].map((t) => C.framePlan(proj(d), t).find((x) => x.id === "v1"));
  const ds = C.split(d, "p1", "v1", 3, T0 + 15, "v1b");
  [1, 3, 5, 7].forEach((t, i) => {
    const L2 = C.framePlan(proj(ds), t).find((x) => x.id === (t < 3 ? "v1" : "v1b"));
    assert.ok(Math.abs(L2.alpha - before[i].alpha) < 1e-9, "alpha at " + t);
    assert.deepEqual(L2.box, before[i].box);
  });
  assert.equal(proj(ds).items.v1b.kf[0].t, 0);
  // overlay box moves around its own place
  let o = C.addItem(base(), "p1", { id: "ov1", k: "image", tr: "ov", src: PIC, d: 4, at: 0, kf: [{ t: 0, y: 0.1 }] }, T0 + 16);
  const Lo = C.framePlan(proj(o), 1).find((x) => x.id === "ov1");
  assert.ok(Math.abs(Lo.box.y - 0.16) < 1e-9 && Lo.box.x === 0.6);
});

test("reverse: frames run backwards from the out point, without sound; split keeps the order", () => {
  let d = C.setItem(base(), "p1", "v1", { rv: true }, T0 + 10);
  const at = (dd, t, id) => C.framePlan(proj(dd), t).find((L) => L.id === id);
  assert.equal(proj(d).items.v1.rv, true);
  assert.ok(Math.abs(at(d, 0, "v1").st - 12) < 0.01);
  assert.ok(Math.abs(at(d, 4, "v1").st - 8) < 0.01);
  assert.equal(C.soundPlan(proj(d)).some((s) => s.id === "v1"), false);
  const ds = C.split(d, "p1", "v1", 4, T0 + 11, "v1b");
  assert.equal(proj(ds).items.v1.in, 8); assert.equal(proj(ds).items.v1.out, 12);
  assert.equal(proj(ds).items.v1b.in, 2); assert.equal(proj(ds).items.v1b.out, 8);
  [1, 3, 5, 9].forEach((t) => assert.ok(Math.abs(at(ds, t, t < 4 ? "v1" : "v1b").st - at(d, t, "v1").st) < 1e-6, "st at " + t));
  assert.equal("rv" in proj(C.setItem(d, "p1", "v1", { rv: false }, T0 + 12)).items.v1, false);
  assert.equal("rv" in proj(C.setItem(base(), "p1", "i1", { rv: true }, T0 + 12)).items.i1, false);   // pictures do not reverse
});

test("colour looks: .cube parsing, the table picture, media list and relink", () => {
  const cube = "# test\nTITLE \"x\"\nLUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n" +
    "0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n";
  const lut = C.parseCube(cube);
  assert.equal(lut.n, 2); assert.equal(lut.data.length, 24);
  const px = C.lutPixels(lut);
  assert.equal(px.w, 4); assert.equal(px.h, 2);
  // blue slice 1, red 1, green 0 → x = 1·2 + 1 = 3, y = 0: white minus green = magenta
  assert.deepEqual([...px.data.slice(12, 16)], [255, 0, 255, 255]);
  assert.equal(C.parseCube("LUT_1D_SIZE 4\n0 0 0"), null);
  assert.equal(C.parseCube("LUT_3D_SIZE 2\n0 0 0\n"), null);
  assert.equal(C.parseCube("LUT_3D_SIZE 65\n"), null);
  assert.equal(C.parseCube("<script>"), null);
  const LUT = H("f") + ".png", LUT2 = H("9") + ".png";
  let d = C.setItem(base(), "p1", "v1", { lut: LUT }, T0 + 10);
  assert.equal(proj(d).items.v1.lut, LUT);
  assert.equal(C.framePlan(proj(d), 1).find((L) => L.id === "v1").lut, LUT);
  assert.ok(C.mediaOf(proj(d)).includes(LUT));
  assert.equal(proj(C.setItem(d, "p1", "v1", { lut: "x.exe" }, T0 + 11)).items.v1.lut, undefined);
  d = C.replaceSrc(d, "p1", LUT, LUT2, 0, T0 + 12);
  assert.equal(proj(d).items.v1.lut, LUT2);
});

test("GIF writer: header, a palette per frame, loop, trailer", async () => {
  const vm = require("vm"), fs = require("fs");
  const ctx = { performance, setTimeout, Blob, Map, Uint8Array, Uint16Array, Uint32Array, Int16Array, Float32Array, Math };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "montage/export.js"), "utf8"), ctx);
  const g = new ctx.MontageExport.GifWriter(8, 4, 8), px = new Uint8ClampedArray(8 * 4 * 4);
  for (let i = 0; i < 32; i++) { px[i * 4] = i * 8; px[i * 4 + 3] = 255; }
  g.frame(px); g.frame(px);
  const b = new Uint8Array(await g.finish().arrayBuffer());
  assert.equal(Buffer.from(b.slice(0, 6)).toString(), "GIF89a");
  assert.equal(b[6] | (b[7] << 8), 8); assert.equal(b[8] | (b[9] << 8), 4);
  assert.ok(Buffer.from(b).includes(Buffer.from("NETSCAPE2.0")));
  assert.equal(b[b.length - 1], 0x3b);
  assert.equal(C.exportName("Loop", "gif"), "Loop.gif");
});

test("app strings: English and Greek have the same keys; help pages share their outline", () => {
  const fs = require("fs");
  const src = fs.readFileSync(path.join(__dirname, "..", "montage/montage.js"), "utf8");
  const block = src.slice(src.indexOf("var STRINGS = {"), src.indexOf("\n  };", src.indexOf("var STRINGS = {")));
  const en = block.slice(block.indexOf("en: {"), block.indexOf("el: {")), el = block.slice(block.indexOf("el: {"));
  const keys = (s) => [...s.matchAll(/"([a-zA-Z0-9.:]+)":/g)].map((m) => m[1]).sort();
  assert.ok(keys(en).length > 100);
  assert.deepEqual(keys(el), keys(en));
  // every t("key") used in the app exists
  const used = new Set([...src.matchAll(/\bt\("([a-zA-Z0-9.:]+)"/g)].map((m) => m[1]));
  for (const k of used) if (!k.endsWith(".")) assert.ok(keys(en).includes(k), "missing string " + k);
  const outline = (f) => fs.readFileSync(path.join(__dirname, "..", "montage", f), "utf8").split("\n").filter((l) => /^#{1,3} /.test(l)).map((l) => l.match(/^#+/)[0]);
  assert.deepEqual(outline("help.el.txt"), outline("help.en.txt"));
});
