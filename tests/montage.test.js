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
