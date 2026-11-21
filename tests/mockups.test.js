// Mockups (mockups/core.js): book measures (spine from pages and
// paper), the cover's cross-section and its printed panels, the
// project model and its merge (sync slice "mockups"), cover deep
// links from Atelier, the search provider, the Atelier side of the
// bridges (atelier/editpic.js plan / parseNew) and the app's wiring.
// Wave 2: sets of books (volume, setList), background photo credits,
// turntable plan and sizes, all angles.
// Wave 3: the cover sheet for the printer (template, wrapMap,
// normTpl, MockPrint.spans), the Atelier newTemplate receiver
// (parseTpl) and the wrap's trim size coming back (parseCover ww/wh).
// Wave 4: the open book (normIns, openCurve) and the e-book (device,
// containIn), kept in the project and its assets, and the wiring.
// v2 wave 1: more bindings (saddle-stitched, spiral, board book,
// lay-flat) and sizes: measures, cover sheets, wrap maps, the coil,
// the flat spread, the print guides and the wiring.
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "mockups/core.js"));
const P = require(path.join(ROOT, "mockups/search.js"));
const EP = require(path.join(ROOT, "atelier/editpic.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const ID = "kabc123def";
const A1 = "a".repeat(64) + ".png";
const A2 = "b".repeat(64) + ".jpg";
function prj(over) {
  return C.normProject(Object.assign({ id: ID, m: 1000, nm: "My book", bk: {}, art: {}, sc: {}, out: {} }, over || {}));
}

test("normBook: limits, presets, even pages, colours and unknown keys", () => {
  const b = C.normBook({ w: 5, h: 9999, pages: 241, paper: "nope", bind: "x", fin: "chrome", edge: "gold",
                        bandC: "red", flaps: "yes", evil: 1, trim: "a5" });
  assert.equal(b.w, 40);
  assert.equal(b.h, 600);
  assert.equal(b.pages, 242);
  assert.equal(b.paper, "white");
  assert.equal(b.bind, "pb");
  assert.equal(b.fin, "matte");
  assert.equal(b.edge, "white");
  assert.equal(b.bandC, "#b0302a");
  assert.equal(b.flaps, 0);
  assert.equal(b.trim, "custom", "a5 with other measures is custom");
  assert.ok(!("evil" in b));
  assert.equal(C.normBook({ trim: "a5", w: 148, h: 210 }).trim, "a5");
  assert.equal(C.normBook({ pages: 1 }).pages, 4);
  assert.equal(C.normBook({ spine: 0.4 }).spine, 1);
});

test("spine: pages × one page, by hand, and the hardcover adds its boards", () => {
  assert.equal(C.blockMm({ pages: 200, paper: "white" }), +(200 * 0.0572).toFixed(2));
  assert.equal(C.blockMm({ pages: 200, paper: "cream" }), +(200 * 0.0635).toFixed(2));
  assert.equal(C.blockMm({ pages: 300, paper: "custom", cal: 0.1 }), 30);
  assert.equal(C.blockMm({ pages: 300, spine: 22.5 }), 22.5);
  assert.equal(C.blockMm({ pages: 4 }), 1, "never thinner than 1 mm");
  const pb = C.dims({ pages: 200 }), hc = C.dims({ pages: 200, bind: "hc" });
  assert.equal(pb.spineMm, +(pb.T + 0.7).toFixed(1));
  assert.ok(hc.spineMm > pb.spineMm + 4);
  assert.equal(hc.Hc, hc.H + 6, "boards overhang top and bottom");
  assert.equal(pb.Hc, pb.H);
});

test("profile: one continuous cover line whose printed panels match the book", () => {
  for (const bk of [{}, { bind: "hc" }, { bind: "hc", round: 1 }, { flaps: 1 }, { bind: "hc", flaps: 1, round: 1 }]) {
    const pr = C.profile(bk), d = pr.d, pn = pr.panels;
    // pieces join: back ends where spine starts, spine ends where front starts
    assert.deepEqual(pr.print.back.pts.at(-1), pr.print.spine.pts[0]);
    assert.deepEqual(pr.print.spine.pts.at(-1), pr.print.front.pts[0]);
    // arc length grows and ends at total
    const us = [].concat(pr.print.back.u, pr.print.spine.u, pr.print.front.u);
    for (let i = 1; i < us.length; i++) assert.ok(us[i] >= us[i - 1] - 1e-9);
    assert.equal(pr.print.front.u.at(-1), pr.total);
    // panels are in order and cover [0, total]
    const order = ["flapB", "back", "spine", "front", "flapF"];
    assert.equal(pn.flapB[0], 0);
    for (let i = 1; i < order.length; i++) assert.equal(pn[order[i]][0], pn[order[i - 1]][1]);
    assert.equal(pn.flapF[1], pr.total);
    // the front and back panels are as wide as the cover face
    const face = d.xE - d.xS;
    assert.ok(Math.abs((pn.front[1] - pn.front[0]) - face) < 1.5, JSON.stringify(bk) + " front " + (pn.front[1] - pn.front[0]) + " vs " + face);
    assert.ok(Math.abs((pn.back[1] - pn.back[0]) - face) < 1.5);
    // the spine panel is about the cover's spine width
    assert.ok(Math.abs((pn.spine[1] - pn.spine[0]) - 2 * d.zF) < (d.round ? 2 * d.zF : 1.5));
    // flaps only when asked, and about their width
    if (d.flaps) assert.ok((pn.flapF[1] - pn.flapF[0]) > d.flapW && (pn.flapF[1] - pn.flapF[0]) < d.flapW + 8);
    else assert.equal(pn.flapF[1] - pn.flapF[0], 0);
    // hardcover with flaps = dust jacket over a cloth case
    assert.equal(!!pr.caseP, !!(d.hc && d.flaps));
    // thickness is positive everywhere and normals are unit vectors
    for (const k of ["back", "spine", "front"]) {
      pr.print[k].th.forEach((t) => assert.ok(t > 0));
      pr.print[k].nrm.forEach((n) => assert.ok(Math.abs(Math.hypot(n[0], n[1]) - 1) < 1e-6));
    }
  }
});

test("profile: outward normals point away from the pages", () => {
  const pr = C.profile({ pages: 300 });
  const f = pr.print.front, b = pr.print.back;
  assert.ok(f.nrm[Math.floor(f.nrm.length / 2)][1] > 0.99, "front faces +z");
  assert.ok(b.nrm[0][1] < -0.99, "back faces -z");
  const s = pr.print.spine, mid = s.nrm[Math.floor(s.nrm.length / 2)];
  assert.ok(mid[0] < -0.99, "spine faces -x");
});

test("flaps: the page block makes room, the flap lies inside the cover", () => {
  const pb = C.dims({ pages: 300, flaps: 1 });
  assert.ok(pb.block.z < pb.T / 2);
  const pr = C.profile({ pages: 300, flaps: 1 });
  const tip = pr.print.front.pts.at(-1);
  assert.ok(tip[1] < pr.d.zF && tip[1] > pb.block.z, "flap between cover and pages");
  assert.ok(Math.abs(tip[0] - (pr.d.xE - pr.d.flapW)) < 0.01);
});

test("layout: panels in print order with widths, total and height", () => {
  const L = C.layout({ pages: 240, flaps: 1, flapW: 90 });
  assert.deepEqual(L.panels.map((p) => p.k), ["flapB", "back", "spine", "front", "flapF"]);
  const sum = L.panels.reduce((a, p) => a + p.w, 0);
  assert.ok(Math.abs(sum - L.total) < 0.01);
  assert.equal(L.h, 210);
  assert.deepEqual(C.layout({}).panels.map((p) => p.k), ["back", "spine", "front"]);
});

test("normProject: ids, scene and output limits, pictures are asset ids only", () => {
  assert.equal(C.normProject({ id: "bad", m: 1 }), null);
  assert.equal(C.normProject({ id: ID, m: 0 }), null);
  const p = prj({ nm: "  A\u0000  B  ", art: { front: A1, back: "../../etc/passwd", wrap: "http://x/y.png", mode: "zip" },
                  sc: { place: "fly", open: 999, cam: { fov: 1, zoom: 99, ph: -90 }, bg: { k: "video", img: A2 } },
                  out: { ratio: "7:3", size: 999999, fmt: "gif" } });
  assert.equal(p.nm, "A B");
  assert.equal(p.art.front, A1);
  assert.equal(p.art.back, "");
  assert.equal(p.art.wrap, "");
  assert.equal(p.art.mode, "parts");
  assert.equal(p.sc.place, "stand");
  assert.equal(p.sc.open, 160);
  assert.equal(p.sc.cam.fov, 8);
  assert.equal(p.sc.cam.zoom, 3);
  assert.equal(p.sc.cam.ph, -10);
  assert.equal(p.sc.bg.k, "grad");
  assert.equal(p.sc.bg.img, A2);
  assert.deepEqual(p.out, { ratio: "4:5", size: 2048, fmt: "png", mo: { k: "spin", sec: 6, size: 1080, fmt: "video" } });
  assert.deepEqual(C.assetsOf(p).sort(), [A1, A2].sort());
  assert.equal(C.normProject(p).nm, p.nm, "idempotent");
  assert.equal(C.canon(C.normProject(JSON.parse(JSON.stringify(p)))), C.canon(p));
});

test("outSize: ratio and long side", () => {
  assert.deepEqual(C.outSize({ ratio: "4:5", size: 2048 }), { w: 1638, h: 2048 });
  assert.deepEqual(C.outSize({ ratio: "16:9", size: 1024 }), { w: 1024, h: 576 });
  assert.deepEqual(C.outSize({ ratio: "1:1", size: 4096 }), { w: 4096, h: 4096 });
});

test("merge: LWW by m, ties by canonical JSON, tombstones, symmetric and canonical", () => {
  const a = { prj: [prj({ m: 10, nm: "A" })], tombs: {} };
  const b = { prj: [prj({ m: 20, nm: "B" })], tombs: {} };
  assert.equal(C.merge(a, b).prj[0].nm, "B");
  assert.deepEqual(C.merge(a, b), C.merge(b, a));
  const t1 = { prj: [prj({ m: 10, nm: "Z" })] }, t2 = { prj: [prj({ m: 10, nm: "Y" })] };
  assert.deepEqual(C.merge(t1, t2), C.merge(t2, t1));
  // delete wins ties, a newer edit comes back
  const del = { prj: [], tombs: { [ID]: 20 } };
  assert.equal(C.merge(b, del).prj.length, 0);
  assert.equal(C.merge({ prj: [prj({ m: 21 })] }, del).prj.length, 1);
  // hostile input
  const h = C.merge({ prj: [null, 5, { id: "x" }, prj()], tombs: { bad: 5, [ID]: -1, kzzzzzzzz: 1.5 } }, "nope");
  assert.equal(h.prj.length, 1);
  assert.deepEqual(h.tombs, {});
  // idempotent + canonical: merging twice changes nothing
  const m1 = C.merge(a, b);
  assert.deepEqual(C.merge(m1, null), m1);
  assert.deepEqual(C.parse(JSON.stringify(m1)), m1);
  assert.deepEqual(C.parse("{oops"), C.empty());
});

test("put / remove: a change always wins, delete leaves a tombstone, limit", () => {
  let d = C.empty();
  const p = C.blank(ID, 100);
  let r = C.put(d, p, 100);
  assert.ok(r.ok);
  d = r.data;
  d = C.remove(d, ID, 200);
  assert.equal(d.prj.length, 0);
  assert.equal(d.tombs[ID], 200);
  r = C.put(d, p, 150);           // clock behind the tombstone
  assert.ok(r.ok && r.prj.m > 200);
  let big = C.empty();
  for (let i = 0; i < C.MAX_PRJ; i++) big = C.put(big, C.blank("k" + String(i).padStart(8, "0"), 1), 1).data;
  assert.equal(C.put(big, C.blank("kzzzzzzzz", 1), 1).why, "full");
});

test("parseCover: Atelier's cover deep link is cleaned", () => {
  assert.equal(C.parseCover(null), null);
  assert.equal(C.parseCover({ front: "nope" }), null);
  assert.deepEqual(C.parseCover({ front: A1, back: A2, spine: "x", name: " Big\u0007 book ", w: 152.44, h: 228.6 }),
    { front: A1, back: A2, spine: "", wrap: "", name: "Big book", w: 152.4, h: 228.6 });
  assert.ok(!("w" in C.parseCover({ wrap: A1, w: 2, h: 3 })));
});

test("Atelier bridge: which page is which, and the newPicture target", () => {
  assert.deepEqual(EP.plan(1, 100, 150), { front: 0 });
  assert.deepEqual(EP.plan(1, 300, 150), { wrap: 0 });
  assert.deepEqual(EP.plan(2, 100, 150), { front: 0, back: 1 });
  assert.deepEqual(EP.plan(5, 100, 150), { front: 0, back: 1, spine: 2 });
  assert.equal(EP.plan(0, 1, 1), null);
  assert.deepEqual(EP.parseNew({ path: "/internal/Assets/" + A1, w: 1638.2, h: 2048, name: "x\u0000y" }),
    { asset: A1, w: 1638, h: 2048, name: "x y" });
  assert.equal(EP.parseNew({ path: "/internal/Assets/../../x.png" }), null);
  assert.equal(EP.parseNew({ path: "https://evil/" + A1 }), null);
});

test("search provider: one hit per live mockup, opens by id", () => {
  const live = prj({ nm: "", art: { spT: "THE ROAD" }, bk: { pages: 300, bind: "hc" } });
  const gone = prj({ id: "kgone12345", m: 5 });
  const store = { "oros-mockups-data": { prj: [live, gone, { id: "../x" }], tombs: { kgone12345: 9 } } };
  const ctx = { lang: "el", readJSON: (k) => store[k] };
  const hits = P.search(ctx);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].title, "Μακέτα βιβλίου");
  assert.match(hits[0].text, /300 σελίδες/);
  assert.match(hits[0].text, /Σκληρόδετο/);
  assert.match(hits[0].text, /THE ROAD/);
  assert.deepEqual(hits[0].target, { id: ID });
  let opened = null;
  P.open({ id: ID }, { __orosOpenAt: (a, t) => { opened = [a, t]; } });
  assert.deepEqual(opened, ["mockups", { id: ID }]);
});

test("app wiring: palette, sync slice, deep link, local three.js, no CDN, DL-1, help", () => {
  const js = read("mockups/mockups.js"), html = read("mockups/index.html"), sc = read("mockups/scene.js");
  assert.match(js, /function inheritPalette/);
  assert.match(js, /function watchPalette/);
  assert.match(js, /registerSlice\("mockups", sliceGet, sliceSet, C\.DATA_KEY, C\.merge\)/);
  assert.match(js, /window\.__orosOpenAt = openTarget/);
  assert.match(js, /__orosTakeTarget\("mockups"\)/);
  assert.match(sc, /from "\.\.\/vendor\/three\/three\.module\.min\.js"/);
  assert.ok(!/https?:\/\//.test(sc.replace(/\/\/[^\n]*/g, "")), "scene.js loads nothing from the network");
  assert.ok(fs.existsSync(path.join(ROOT, "vendor/three/three.core.min.js")));
  assert.match(read("vendor/three/LICENSE"), /MIT License/);
  assert.match(read("vendor/three/three.module.min.js"), /from"\.\/three\.core\.min\.js"/);
  assert.match(html, /\?open=mockups/);
  assert.ok(fs.existsSync(path.join(ROOT, "mockups/help.en.txt")) && fs.existsSync(path.join(ROOT, "mockups/help.el.txt")));
  // the CSS ends with the [hidden] rule
  assert.match(read("mockups/mockups.css").trim(), /\[hidden\] \{ display: none !important; \}$/);
  // every data-i18n key exists in both languages
  const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
  for (const k of keys) {
    assert.ok(js.includes('"' + k + '":'), "missing string " + k);
    assert.equal(js.split('"' + k + '":').length - 1, 2, "EN + EL for " + k);
  }
  // Atelier side of the bridges
  assert.match(read("atelier/core.js"), /tg\.newPicture/);
  assert.match(read("atelier/io.js"), /more\.mockup/);
  assert.match(read("atelier/editpic.js"), /__orosOpenAt\("mockups", \{ cover: cover \}\)/);
});

test("sets: kinds, counts, limits, volumes and unknown keys", () => {
  const p = prj({ set: { k: "shelf", n: 99, gap: -5, evil: 1,
    vols: [{ front: A1, pages: 101, c: "#FF0000", spT: "Vol\u00002", x: 1 }, { wrap: A2 }, {}, {}, {}, {}, {}] } });
  assert.equal(p.set.k, "shelf");
  assert.equal(p.set.n, 6);
  assert.equal(p.set.gap, 0);
  assert.equal(p.set.vols.length, 5, "at most five other books");
  assert.deepEqual(p.set.vols[0], { front: A1, back: "", spine: "", wrap: "", c: "#ff0000", spT: "Vol 2", pages: 102 });
  assert.equal(prj({ set: { k: "pyramid" } }).set.k, "one");
  assert.equal(prj({}).set.gap, 0);
  assert.equal(C.normSet({ k: "pair" }).gap, C.GAP_DEF.pair);
  assert.equal(C.count(prj({})), 1);
  assert.equal(C.count(prj({ set: { k: "pair", n: 5 } })), 2);
  assert.equal(C.count(prj({ set: { k: "stack", n: 4 } })), 4);
  // canonical: normalizing twice changes nothing (R26)
  assert.equal(C.canon(C.normProject(p)), C.canon(p));
});

test("volume: the other books take their own pages and pictures, else the first one's", () => {
  const p = prj({ bk: { pages: 300, spine: 20 }, art: { front: A1, spT: "SAGA", c: "#123456" },
    set: { k: "row", n: 3, vols: [{ front: A2, pages: 120, spT: "SAGA II" }, { wrap: A2 }] } });
  const v0 = C.volume(p, 0), v1 = C.volume(p, 1), v2 = C.volume(p, 2);
  assert.equal(v0.bk.pages, 300);
  assert.equal(v0.bk.spine, 20);
  assert.equal(v1.bk.pages, 120);
  assert.equal(v1.bk.spine, 0, "own pages: the spine comes from them");
  assert.equal(v1.art.front, A2);
  assert.equal(v1.art.spT, "SAGA II");
  assert.equal(v1.art.c, "#123456");
  assert.equal(v2.art.mode, "wrap", "a wrap picture makes that book a wrap");
  assert.equal(v2.art.wrap, A2);
  assert.equal(v2.bk.pages, 300);
  // a pair is the same book twice, whatever vols say
  const pair = prj({ art: { front: A1 }, set: { k: "pair", vols: [{ front: A2 }] } });
  assert.equal(C.volume(pair, 1).art.front, A1);
  // project fields are not changed
  assert.equal(p.bk.pages, 300);
  assert.equal(p.art.front, A1);
});

test("setList: how each book stands", () => {
  const one = C.setList(prj({ sc: { place: "lean" } }));
  assert.deepEqual(one, [{ i: 0, back: false, yaw: 0, place: "lean", dx: 0 }]);
  const pair = C.setList(prj({ set: { k: "pair" } }));
  assert.equal(pair.length, 2);
  assert.equal(pair[0].back, false);
  assert.equal(pair[1].back, true, "the second shows its back");
  assert.ok(pair[0].yaw > 0 && pair[1].yaw < 0, "turned towards each other");
  const shelf = C.setList(prj({ sc: { place: "lie" }, set: { k: "shelf", n: 4 } }));
  assert.equal(shelf.length, 4);
  assert.ok(shelf.every((b) => b.yaw === 90 && b.place === "stand"), "spines to the camera, standing");
  const stack = C.setList(prj({ set: { k: "stack", n: 3 } }));
  assert.ok(stack.every((b) => b.place === "lie"));
  assert.deepEqual(stack.map((b) => b.i), [0, 1, 2]);
  const row = C.setList(prj({ sc: { place: "lean" }, set: { k: "row", n: 2 } }));
  assert.ok(row.every((b) => b.place === "lean" && b.yaw === 0));
});

test("background photo credit: only from open libraries, clipped, https only, kept with its photo", () => {
  const cr = { src: "openverse", id: "openverse:abc", kind: "photo", title: "Desk\u0000 at dawn", author: "Ann",
               authorUrl: "javascript:alert(1)", page: "https://Openverse.org/image/abc", lic: "by", licVer: "4.0",
               licUrl: "http://creativecommons.org/", evil: "x" };
  const p = prj({ sc: { bg: { k: "photo", img: A2, cr: cr } } });
  assert.deepEqual(p.sc.bg.cr, { src: "openverse", id: "openverse:abc", kind: "photo", title: "Desk at dawn", author: "Ann",
    authorUrl: "", page: "https://openverse.org/image/abc", lic: "by", licVer: "4.0", licUrl: "" });
  assert.equal(prj({ sc: { bg: { k: "photo", cr: cr } } }).sc.bg.cr, null, "no photo, no credit");
  assert.equal(C.normCr(Object.assign({}, cr, { src: "evil" })), null);
  assert.equal(C.normCr(Object.assign({}, cr, { id: "commons:abc" })), null, "id must match the source");
  assert.equal(C.normCr(Object.assign({}, cr, { lic: "" })), null);
  // the credit survives a merge unchanged
  const m = C.merge({ prj: [p] }, null);
  assert.deepEqual(m.prj[0].sc.bg.cr, p.sc.bg.cr);
});

test("turntable: plan, sizes, GIF limits, motion settings", () => {
  const o = C.normOut({ ratio: "4:5", mo: { k: "swing", sec: 8, size: 720, fmt: "video" } });
  assert.deepEqual(o.mo, { k: "swing", sec: 8, size: 720, fmt: "video" });
  assert.deepEqual(C.normOut({ mo: { k: "fly", sec: 99, size: 4000, fmt: "avi" } }).mo, { k: "spin", sec: 6, size: 1080, fmt: "video" });
  assert.deepEqual(C.motionSize(o), { w: 576, h: 720 });
  const odd = C.motionSize({ ratio: "3:2", mo: { size: 1080 } });
  assert.equal(odd.w % 2, 0); assert.equal(odd.h % 2, 0);
  assert.deepEqual(C.motionSize({ ratio: "16:9", mo: { fmt: "gif" } }), { w: 480, h: 270 });
  const spin = C.motionPlan({ mo: { k: "spin", sec: 4, fmt: "video" } });
  assert.equal(spin.fps, 30);
  assert.equal(spin.n, 120);
  assert.equal(spin.turn(0), 0);
  assert.equal(spin.turn(60), 180);
  assert.ok(spin.turn(119) < 360, "the last frame stops one step short, so it loops");
  const sw = C.motionPlan({ mo: { k: "swing", sec: 4, fmt: "video" } });
  assert.equal(sw.turn(0), 0);
  assert.equal(sw.turn(30), 35);
  assert.equal(sw.turn(90), -35);
  const gif = C.motionPlan({ mo: { sec: 12, fmt: "gif" } });
  assert.equal(gif.fps, 15);
  assert.equal(gif.n, 120, "a GIF is at most 8 seconds");
});

test("assetsOf: pictures of the other books are in use too", () => {
  const p = prj({ art: { front: A1 }, sc: { bg: { img: A2 } }, set: { k: "row", n: 3, vols: [{ front: A2, back: A1 }, { spine: "c".repeat(64) + ".png" }] } });
  assert.deepEqual(C.assetsOf(p).sort(), [A1, A2, "c".repeat(64) + ".png"].sort());
});

test("wave 2 wiring: libraries load only when asked for, from orOS itself", () => {
  const js = read("mockups/mockups.js"), html = read("mockups/index.html");
  assert.match(js, /loadScript\("\.\.\/vendor\/mediabunny\.min\.js"\)/);
  assert.match(js, /loadScript\("\.\.\/atelier\/gif\.js"\)/);
  assert.match(js, /loadScript\("\.\.\/atelier\/zip\.js"\)/);
  assert.ok(!/mediabunny/.test(html), "the video library is not loaded with the page");
  assert.match(html, /\.\.\/designkit\/media\.js\?v=/);
  assert.match(js, /MEDIA\.normCredit\(it\)/);
  assert.match(js, /referrerPolicy = "no-referrer"/);
  // placeholders have both languages
  for (const m of html.matchAll(/data-i18n-ph="([^"]+)"/g)) assert.equal(js.split('"' + m[1] + '":').length - 1, 2, m[1]);
  // every file the page loads is in the service worker's precache
  const sw = read("sw.js");
  ["mockups/core.js", "mockups/scene.js", "mockups/mockups.js", "designkit/media.js", "designkit/assets.js",
   "vendor/mediabunny.min.js", "atelier/gif.js", "atelier/zip.js"].forEach((f) => assert.ok(sw.includes('"' + f + '"'), f));
});

const MP = (require(path.join(ROOT, "mockups/print.js")), globalThis.MockPrint);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= (eps || 0.01), (msg || "") + " " + a + " ≈ " + b);

test("template: paperback sheet = bleed · back · spine (pages × paper) · front · bleed", () => {
  // 6 × 9″, 240 white pages: print-on-demand formula 0.125 + 6 + 240 × 0.002252 + 6 + 0.125 inches
  const T = C.template({ trim: "us6x9", w: 152.4, h: 228.6, pages: 240, paper: "white" }, {});
  assert.equal(T.kind, "pb");
  assert.deepEqual(T.parts.map((p) => p.k), ["back", "spine", "front"]);
  near(T.spine, 240 * 0.0572);
  near(T.sheet.w / 25.4, 0.125 + 6 + 240 * 0.002252 + 6 + 0.125, 0.01, "sheet width in inches");
  near(T.sheet.h, 228.6 + 6.4);
  assert.equal(T.bleed, 3.2);
  assert.equal(T.parts[1].x, 152.4);
  assert.deepEqual(T.folds.map((f) => f.k), ["fold", "fold"]);
  // safe zones: 6.35 mm inside the trim and the folds, 1.6 mm each side of the spine
  const sf = T.safe.find((r) => r.k === "front");
  near(sf.x, 152.4 + T.spine + 6.35); near(sf.w, 152.4 - 12.7);
  const ss = T.safe.find((r) => r.k === "spine");
  near(ss.x, 152.4 + 1.6); near(ss.w, T.spine - 3.2);
  // barcode spot: bottom right of the back cover, inside the safe zone
  assert.deepEqual([T.bar.w, T.bar.h], [50.8, 30.5]);
  near(T.bar.x + T.bar.w, 152.4 - 6.35); near(T.bar.y + T.bar.h, 228.6 - 6.35);
  assert.deepEqual(T.warn, []);
  // the spine typed by hand is the printer's
  near(C.template({ w: 148, h: 210, spine: 17.5 }, {}).spine, 17.5);
  // own bleed (the cover's bleed field)
  assert.equal(C.template({ w: 148, h: 210 }, { bleed: 5 }).bleed, 5);
  assert.equal(C.template({ w: 148, h: 210 }, { bleed: 0 }).sheet.h, 210);
});

test("template: flaps, hardcover case, dust jacket, warnings", () => {
  const f = C.template({ w: 148, h: 210, pages: 200, flaps: 1, flapW: 90 }, {});
  assert.deepEqual(f.parts.map((p) => p.k + ":" + p.w), ["flapB:90", "back:148", "spine:" + f.spine, "front:148", "flapF:90"]);
  near(f.W, 90 * 2 + 148 * 2 + f.spine);
  const cs = C.template({ w: 148, h: 210, pages: 240, bind: "hc" }, {});
  assert.equal(cs.kind, "case");
  assert.deepEqual(cs.parts.map((p) => p.k), ["back", "hingeB", "spine", "hingeF", "front"]);
  assert.equal(cs.bleed, 15, "a case wraps 15 mm round the boards");
  assert.equal(cs.H, 216, "boards are 3 mm larger top and bottom");
  assert.equal(cs.spine, C.dims({ w: 148, h: 210, pages: 240, bind: "hc" }).spineMm);
  assert.deepEqual(cs.folds.map((f) => f.k), ["hinge", "hinge", "hinge", "hinge"]);
  assert.ok(!cs.safe.some((r) => /^hinge/.test(r.k)), "no safe zone on the hinges");
  const jk = C.template({ w: 148, h: 210, pages: 240, bind: "hc", flaps: 1 }, {});
  assert.equal(jk.kind, "jacket");
  assert.equal(jk.bleed, 3.2, "a dust jacket is a printed sheet with a normal bleed");
  assert.equal(C.dims({ bind: "hc", flaps: 1 }).bleed, 3.2);
  assert.equal(C.dims({ bind: "hc" }).bleed, 15);
  // thin spine, no barcode room, barcode off
  assert.deepEqual(C.template({ w: 148, h: 210, pages: 40 }, {}).warn, ["thin"]);
  const tiny = C.template({ w: 50, h: 70, pages: 40 }, {});
  assert.ok(tiny.warn.includes("nobar")); assert.equal(tiny.bar, null);
  assert.equal(C.template({ w: 148, h: 210 }, {}, { bar: 0 }).bar, null);
  assert.ok(!C.template({ w: 50, h: 70 }, {}, { bar: 0 }).warn.includes("nobar"));
});

test("wrapMap: each 3D panel takes its own part of the printer's sheet", () => {
  const bk = { w: 148, h: 210, pages: 240 }, T = C.template(bk, {}), m = C.wrapMap(bk, {});
  assert.deepEqual(m.panels.map((p) => p.k), ["back", "spine", "front"]);
  near(m.panels[0].x0, 3.2 / T.sheet.w, 1e-9); near(m.panels[2].x1, 1 - 3.2 / T.sheet.w, 1e-9);
  near(m.panels[1].x0, (3.2 + 148) / T.sheet.w, 1e-9);
  near(m.y0, 3.2 / T.sheet.h, 1e-9); near(m.y1, 1 - 3.2 / T.sheet.h, 1e-9);
  // a case: the hinges go with the boards
  const hc = { w: 148, h: 210, bind: "hc" }, Th = C.template(hc, {}), mh = C.wrapMap(hc, {});
  near(mh.panels[0].x1, (15 + 145 + 8) / Th.sheet.w, 1e-9);
  near(mh.panels[2].x0, (15 + 145 + 8 + Th.spine) / Th.sheet.w, 1e-9);
  // a wrap from Atelier has no bleed: the picture is the trim
  const m0 = C.wrapMap(bk, { bleed: 0 });
  assert.equal(m0.panels[0].x0, 0); assert.equal(m0.y0, 0); assert.equal(m0.y1, 1);
  // flaps map one to one
  assert.deepEqual(C.wrapMap({ flaps: 1 }, {}).panels.map((p) => p.k), ["flapB", "back", "spine", "front", "flapF"]);
});

test("normTpl: defaults on, clipped safe zone, kept in the project", () => {
  assert.deepEqual(C.normTpl(null), { safe: 6.35, bar: 1, gd: 1, art: 1 });
  assert.deepEqual(C.normTpl({ safe: 99, bar: 0, gd: false, art: "x", evil: 1 }), { safe: 20, bar: 0, gd: 0, art: 1 });
  assert.deepEqual(prj({ tpl: { safe: 3, art: 0 } }).tpl, { safe: 3, bar: 1, gd: 1, art: 0 });
  assert.deepEqual(prj({}).tpl, C.TPL_DEF);
  assert.equal(C.normPrefs({ tab: "print" }).tab, "print");
});

test("MockPrint.spans: pictures run into the bleed, hinges go with the boards", () => {
  const T = C.template({ w: 148, h: 210, pages: 240 }, {}), sp = MP.spans(T);
  assert.deepEqual(sp.back, [0, 3.2 + 148]);
  assert.deepEqual(sp.front, [3.2 + 148 + T.spine, T.sheet.w]);
  const Th = C.template({ w: 148, h: 210, bind: "hc" }, {}), sh = MP.spans(Th);
  assert.deepEqual(Object.keys(sh).sort(), ["back", "front", "spine"]);
  near(sh.back[1], 15 + 145 + 8);
  // dpi kept inside the canvas limits
  near(MP.ppmFor(T, 300), 300 / 25.4, 1e-9);
  const big = C.template({ w: 600, h: 600, pages: 2000, flaps: 1, flapW: 200 }, {});
  const k = MP.ppmFor(big, 300);
  assert.ok(big.sheet.w * k <= 16000 && big.sheet.w * k * big.sheet.h * k <= 60e6 + 1);
});

test("Atelier newTemplate receiver: parseTpl keeps disk pictures and sane mm only", () => {
  const g = "/internal/Assets/" + A1, a = "/internal/Assets/" + A2;
  assert.deepEqual(EP.parseTpl({ guides: g, art: a, w: 316.1304, h: 216.4, bleed: 3.2, name: "My\u0001 book" }),
                   { guides: A1, art: A2, w: 316.13, h: 216.4, bleed: 3.2, name: "My  book" });
  assert.equal(EP.parseTpl({ guides: g, art: "", w: 316, h: 216, bleed: 0 }).art, "");
  assert.equal(EP.parseTpl({ guides: "https://evil/" + A1, w: 316, h: 216, bleed: 3 }), null);
  assert.equal(EP.parseTpl({ guides: g, art: "/internal/Assets/../x.png", w: 316, h: 216, bleed: 3 }), null);
  assert.equal(EP.parseTpl({ guides: g, w: 316, h: 216, bleed: 40 }), null);
  assert.equal(EP.parseTpl({ guides: g, w: 5, h: 216, bleed: 3 }), null);
});

test("a full wrap from Atelier brings its trim size (ww, wh)", () => {
  const c = C.parseCover({ wrap: A1, ww: 309.7312, wh: 210, name: "B" });
  assert.equal(c.ww, 309.73); assert.equal(c.wh, 210);
  assert.equal(C.parseCover({ front: A1, ww: 300, wh: 200 }).ww, undefined, "only with a wrap");
  assert.equal(C.parseCover({ wrap: A1, ww: "300", wh: 200 }).ww, undefined);
});

test("wave 3 wiring: Print tab, flat preview, PDF, Atelier guides never export", () => {
  const js = read("mockups/mockups.js"), html = read("mockups/index.html");
  assert.match(html, /id="tab-print"/); assert.match(html, /id="pane-print"/); assert.match(html, /id="flat"/);
  assert.match(html, /src="print\.js\?v=/);
  ["tpl-png", "tpl-pdf", "tpl-pics", "tpl-atelier", "f-tbleed", "f-safe", "f-tbar", "f-tart", "f-tgd"].forEach((id) => {
    assert.match(html, new RegExp('id="' + id + '"'), id);
    assert.ok(js.includes('"' + id + '"'), id);
  });
  assert.match(js, /loadScript\("\.\.\/vendor\/jspdf\.umd\.min\.js"\)/);
  assert.match(js, /newTemplate: \{/);
  assert.ok(read("sw.js").includes('"vendor/jspdf.umd.min.js"'));
  // Atelier: the guides are a photo with ax.tg, kept by the normalizer, skipped by exports and clicks
  assert.match(read("atelier/ax.js"), /k === "photo" && bit\(a\.tg\)\) o\.tg = 1/);
  assert.match(read("atelier/draw.js"), /opts\.clean && it\.ax && it\.ax\.tg\) return/);
  assert.match(read("atelier/pdfout.js"), /!it\.ax\.tg/);
  assert.match(read("atelier/pptxout.js"), /!it\.ax\.tg/);
  assert.match(read("atelier/editor.js"), /isBg\(it\) \|\| \(it\.ax && it\.ax\.tg\)\) continue/);
  assert.match(read("atelier/core.js"), /tg\.newTemplate/);
  // both languages for the new strings
  ["tab.print", "tpl.hint", "tpl.kind.case", "slot.hingeB", "warn.thin", "btn.tplAtelier", "toast.wrapBook"].forEach((k) =>
    assert.equal(js.split('"' + k + '":').length - 1, 2, k));
  // help has a section for the printer in both languages
  assert.match(read("mockups/help.en.txt"), /^## For the printer$/m);
  assert.match(read("mockups/help.el.txt"), /^## Για το τυπογραφείο$/m);
});

test("normIns: inside pages, curve, device, PDF page with safe defaults", () => {
  const d = C.normIns(null);
  assert.deepEqual(d, { l: "", r: "", scr: "", curl: 0.5, dev: "tablet", dc: "black", pdfp: 1, rule: "none" });
  const o = C.normIns({ l: A1, r: A2, scr: "../x.png", curl: 7, dev: "laptop", dc: "silver", pdfp: 12.7 });
  assert.equal(o.l, A1); assert.equal(o.r, A2); assert.equal(o.scr, "");
  assert.equal(o.curl, 1); assert.equal(o.dev, "tablet"); assert.equal(o.dc, "silver");
  assert.ok(Number.isInteger(o.pdfp) && o.pdfp >= 1);
  assert.equal(C.normIns({ curl: -3 }).curl, 0);
  assert.equal(C.normIns({ pdfp: -5 }).pdfp, 1);
  ["tablet", "phone", "reader"].forEach((k) => assert.equal(C.normIns({ dev: k }).dev, k));
});

test("openCurve: pages rise from the gutter, arch, and end at the fore-edge", () => {
  const bk = { trim: "a5", pages: 240 };
  const pts = C.openCurve(bk, 0.5, 32), b = C.normBook(bk), t = C.blockMm(b) / 2;
  assert.equal(pts.length, 33);
  assert.equal(pts[0][0], 0);
  assert.ok(pts[0][1] < t * 0.2, "starts low in the gutter");
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i][0] > pts[i - 1][0], "x grows");
  const last = pts[pts.length - 1];
  assert.ok(last[0] <= b.w && last[0] > b.w * 0.95, "ends near the page width");
  const top = Math.max(...pts.map((p) => p[1]));
  assert.ok(top > t, "the page arches above the block");
  // a flat curve (0) stays at the block height, a full one rises more
  const flat = Math.max(...C.openCurve(bk, 0, 32).map((p) => p[1]));
  const full = Math.max(...C.openCurve(bk, 1, 32).map((p) => p[1]));
  assert.ok(flat <= t * 1.001 && full > top);
  // a thicker book stands higher
  const thick = Math.max(...C.openCurve({ trim: "a5", pages: 600 }, 0.5, 32).map((p) => p[1]));
  assert.ok(thick > top);
});

test("device + containIn: real sizes, the screen inside the body, page fitted", () => {
  ["tablet", "phone", "reader"].forEach((k) => {
    const d = C.device(k);
    assert.equal(d.k, k);
    assert.ok(d.sw < d.w && d.sh + d.sy < d.h && d.d > 4 && d.d < 10, k);
  });
  assert.equal(C.device("nope").k, "tablet");
  assert.equal(C.device("reader").ink, 1);
  assert.equal(C.device("phone").ink, 0);
  const f = C.containIn(300, 450, 163, 228);
  assert.ok(Math.abs(f.h - 228) < 0.01 && f.w < 163 && Math.abs(f.x * 2 + f.w - 163) < 0.01 && f.y === 0);
  const g = C.containIn(800, 400, 100, 100);
  assert.ok(g.w === 100 && g.h === 50 && g.y === 25);
  assert.deepEqual(C.containIn(0, 0, 10, 20), { x: 0, y: 0, w: 10, h: 20 });
});

test("project keeps show + ins; their pictures count as assets; merge keeps them", () => {
  const p = prj({ show: "open", ins: { l: A1, r: A2, curl: 0.8 } });
  assert.equal(p.show, "open");
  assert.equal(p.ins.l, A1);
  assert.equal(prj({ show: "movie" }).show, "book");
  assert.equal(prj().show, "book");
  const as = C.assetsOf(prj({ show: "ebook", ins: { scr: A1, l: A2 } }));
  assert.ok(as.includes(A1) && as.includes(A2));
  const m = C.merge({ prj: [p] }, null);
  const q = m.prj.find((x) => x.id === ID);
  assert.equal(q.show, "open"); assert.equal(q.ins.r, A2); assert.equal(q.ins.curl, 0.8);
});

test("wave 4 wiring: what to show, inside pages, PDF pages, devices, help", () => {
  const js = read("mockups/mockups.js"), html = read("mockups/index.html"), sc = read("mockups/scene.js");
  ["showk", "dev-box", "devk", "dck", "set-grp", "place-grp", "open-box", "ins-box", "ins-slots", "pdf-pick", "f-pdfp", "pdf-info", "curl-box", "f-curl", "pdf-in"].forEach((id) => {
    assert.match(html, new RegExp('id="' + id + '"'), id);
    assert.ok(js.includes('"' + id + '"'), id);
  });
  // PDF.js is an ES module (as in Layout) and already precached
  assert.match(js, /n\.type = "module"; n\.src = "\.\.\/vendor\/pdfjs\/pdf\.min\.js"/);
  assert.match(js, /isEvalSupported: false/);
  assert.ok(read("sw.js").includes('"vendor/pdfjs/pdf.min.js"') && read("sw.js").includes('"vendor/pdfjs/pdf.worker.min.js"'));
  assert.match(sc, /function makeOpen\(/); assert.match(sc, /function makeDevice\(/);
  ["f.show", "show.open", "show.ebook", "dev.reader", "dc.silver", "sec.ins", "slot.scr", "btn.pdf", "f.curl", "pdf.fail", "toast.pdfPages"].forEach((k) =>
    assert.equal(js.split('"' + k + '":').length - 1, 2, k));
  assert.match(read("mockups/help.en.txt"), /^## Open book and e-book$/m);
  assert.match(read("mockups/help.el.txt"), /^## Ανοιχτό βιβλίο και e-book$/m);
});

// ---------- v2 wave 1: bindings and sizes ----------

test("bindings: unknown ones fall back, wire colours, board paper and new sizes", () => {
  assert.deepEqual(C.BINDS, ["pb", "hc", "ss", "sp", "bb", "lf"]);
  for (const b of C.BINDS) assert.equal(C.normBook({ bind: b }).bind, b);
  assert.equal(C.normBook({ bind: "glued" }).bind, "pb");
  assert.equal(C.normBook({}).wire, "black");
  assert.equal(C.normBook({ wire: "gold" }).wire, "gold");
  assert.equal(C.normBook({ wire: "pink" }).wire, "black");
  assert.equal(C.paperOf("board").c, 0.75);
  assert.equal(C.PAPERS[C.PAPERS.length - 1].k, "custom");
  const keys = C.TRIMS.map((x) => x.k);
  assert.equal(new Set(keys).size, keys.length);
  for (const k of ["us525x8", "us7x10", "us8x10", "comic", "b6", "b5", "a5l", "sq20", "sq25"]) assert.ok(C.trimOf(k), k);
  assert.equal(C.normBook({ trim: "b5", w: 176, h: 250 }).trim, "b5");
  assert.equal(C.normBook({ trim: "a5l", w: 210, h: 148 }).trim, "a5l");
});

test("dims per binding: flaps only on paperback and hardcover, spines, the coil", () => {
  for (const b of ["ss", "sp", "bb", "lf"]) assert.equal(C.dims({ bind: b, flaps: 1 }).flaps, false, b);
  assert.equal(C.dims({ bind: "pb", flaps: 1 }).flaps, true);
  const lf = C.dims({ bind: "lf", pages: 200, round: 1 }), hc = C.dims({ bind: "hc", pages: 200 });
  assert.equal(lf.hc, true); assert.equal(lf.round, false); assert.equal(lf.spineMm, hc.spineMm);
  const ss = C.dims({ bind: "ss", pages: 32 });
  assert.equal(ss.spineMm, 0); assert.ok(ss.bulge > 0 && ss.bulge === ss.zF);
  const sp = C.dims({ bind: "sp", pages: 100 });
  assert.equal(sp.spineMm, 0); assert.ok(sp.coil && sp.coil.r > sp.zF);
  // the loop passes through the holes on both covers
  const dx = sp.xH - sp.coil.x;
  assert.ok(Math.abs(Math.hypot(dx, sp.zF) - sp.coil.r) < 0.01);
  const bb = C.dims({ bind: "bb", pages: 20, paper: "board" });
  assert.equal(bb.T, 15); assert.equal(bb.c, 1.6); assert.equal(bb.spineMm, 18.2);
  // a thick spiral book gets the wider 2:1 pitch
  assert.equal(C.dims({ bind: "sp", pages: 40 }).coil.pitch, 8.47);
  assert.equal(C.dims({ bind: "sp", pages: 300 }).coil.pitch, 12.7);
  const loops = C.coilLoops({ bind: "sp", h: 210, pages: 100 });
  assert.equal(loops.length, Math.floor((210 - 10) / 8.47) + 1);
  assert.ok(Math.abs(loops[0] + loops[loops.length - 1]) < 0.01);
  assert.deepEqual(C.coilLoops({ bind: "pb" }), []);
  // every binding has a cross-section the 3D view can lay the cover along
  for (const b of C.BINDS) {
    const pr = C.profile({ bind: b, pages: b === "ss" ? 32 : 120 });
    assert.ok(pr.total > 0 && pr.print.back.pts.length >= 2 && pr.print.front.pts.length >= 2, b);
    for (const k of ["back", "spine", "front"]) pr.print[k].u.forEach((u, i, a) => assert.ok(i === 0 || u >= a[i - 1], b + " " + k));
  }
});

test("template per binding: saddle stitch, spiral, board book, lay-flat", () => {
  const ss = C.template({ w: 148, h: 210, pages: 32, bind: "ss" }, {});
  assert.equal(ss.kind, "ss"); assert.equal(ss.spine, 0);
  assert.deepEqual(ss.parts.map((p) => p.k), ["back", "front"]);
  assert.equal(ss.W, 296); assert.deepEqual(ss.folds, [{ x: 148, k: "fold" }]);
  assert.deepEqual(ss.warn, []);
  assert.deepEqual(C.template({ bind: "ss", pages: 34 }, {}).warn, ["ss4"]);
  assert.ok(C.template({ bind: "ss", pages: 120 }, {}).warn.includes("ssMax"));
  const sp = C.template({ w: 148, h: 210, pages: 100, bind: "sp" }, {});
  assert.equal(sp.kind, "sp"); assert.equal(sp.folds.length, 0);
  assert.deepEqual(sp.parts.map((p) => [p.k, p.x, p.w]), [["back", 0, 148], ["gap", 148, 6.4], ["front", 154.4, 148]]);
  assert.deepEqual(sp.trims, [{ x: 0, w: 148 }, { x: 154.4, w: 148 }]);
  assert.equal(sp.punch.length, 2);
  assert.equal(sp.punch[0].x + sp.punch[0].w, 148); assert.equal(sp.punch[1].x, 154.4);
  // the barcode and the safe zones keep clear of the holes
  assert.ok(sp.bar.x + sp.bar.w <= 148 - C.PUNCH);
  const sb = sp.safe.find((r) => r.k === "back"), sf = sp.safe.find((r) => r.k === "front");
  assert.ok(sb.x + sb.w <= 148 - C.PUNCH && sf.x >= 154.4 + C.PUNCH);
  assert.equal(C.template({ bind: "sp" }, { bleed: 5 }).parts[1].w, 10);
  const bb = C.template({ w: 200, h: 200, pages: 20, paper: "board", bind: "bb" }, {});
  assert.equal(bb.kind, "bb"); assert.deepEqual(bb.parts.map((p) => p.k), ["back", "spine", "front"]);
  assert.equal(bb.spine, 18.2);
  const lf = C.template({ w: 148, h: 210, pages: 240, bind: "lf" }, {}), cs = C.template({ w: 148, h: 210, pages: 240, bind: "hc" }, {});
  assert.equal(lf.kind, "case"); assert.deepEqual(lf.parts, cs.parts);
  // old kinds keep their numbers
  assert.deepEqual(C.template({ w: 148, h: 210, pages: 240 }, {}).trims, [{ x: 0, w: C.template({ w: 148, h: 210, pages: 240 }, {}).W }]);
});

test("wrapMap per binding: the fold of a booklet, the two spiral covers", () => {
  const ss = C.wrapMap({ w: 148, h: 210, pages: 32, bind: "ss" }, {});
  const k = ss.panels.map((p) => p.k);
  assert.deepEqual(k, ["back", "spine", "front"]);
  ss.panels.forEach((p, i, a) => { assert.ok(p.x1 > p.x0); if (i) assert.ok(Math.abs(p.x0 - a[i - 1].x1) < 1e-9); });
  const mid = (ss.panels[1].x0 + ss.panels[1].x1) / 2;
  assert.ok(Math.abs(mid - 0.5) < 0.002);
  const sp = C.wrapMap({ w: 148, h: 210, pages: 100, bind: "sp" }, {});
  assert.deepEqual(sp.panels.map((p) => p.k), ["back", "front"]);
  const T = C.template({ w: 148, h: 210, pages: 100, bind: "sp" }, {});
  assert.ok(Math.abs(sp.panels[0].x1 - (T.bleed + 148) / T.sheet.w) < 1e-9);
  assert.ok(Math.abs(sp.panels[1].x0 - (T.bleed + 154.4) / T.sheet.w) < 1e-9);
});

test("MockPrint: spiral covers share the gap, no gap label", () => {
  const T = C.template({ w: 148, h: 210, pages: 100, bind: "sp" }, {}), sp = MP.spans(T);
  assert.deepEqual(Object.keys(sp).sort(), ["back", "front"]);
  assert.equal(sp.back[0], 0); assert.equal(sp.front[1], T.sheet.w);
  assert.ok(Math.abs(sp.back[1] - (T.bleed * 2 + 148)) < 1e-9 && sp.back[1] === sp.front[0]);
  assert.equal(MP.VERSION, "1.4.0");
});

test("openCurve: lay-flat, spiral and board pages lie flat at the gutter", () => {
  for (const b of ["lf", "sp", "bb"]) {
    const c = C.openCurve({ bind: b, pages: 100 }, 0.5);
    const t = C.dims({ bind: b, pages: 100 }).T / 2;
    assert.ok(c[0][1] >= t - 0.01, b);
  }
  const pb = C.openCurve({ pages: 100 }, 0.5);
  assert.ok(pb[0][1] < C.dims({ pages: 100 }).T / 2 * 0.2);
  const bb = C.openCurve({ bind: "bb", pages: 20, paper: "board" }, 1);
  assert.ok(bb.every((p) => Math.abs(p[1] - bb[0][1]) < 0.01));
});

test("v2 wave 1 wiring: binding buttons, wire colour, strings in en, el and de, help, search", () => {
  const js = read("mockups/mockups.js"), html = read("mockups/index.html"), de = read("i18n/de/mockups.js"), sc = read("mockups/scene.js");
  for (const b of C.BINDS) assert.match(html, new RegExp('data-v="' + b + '" data-i18n="bind\\.' + b + '"'), b);
  ["bind-hint", "wire-box", "f-wire", "flaps-row", "round-row"].forEach((id) => {
    assert.match(html, new RegExp('id="' + id + '"'), id);
    assert.ok(js.includes('"' + id + '"'), id);
  });
  const keys = ["bind.ss", "bind.sp", "bind.bb", "bind.lf", "hint.ss", "hint.sp", "hint.bb", "hint.lf", "f.wire", "wire.gold", "paper.board",
    "tpl.kind.ss", "tpl.kind.sp", "tpl.kind.bb", "tpl.spineSs", "tpl.spineSp", "tpl.spineBb", "warn.ss4", "warn.ssMax", "lg.punch", "slot.gap", "spine.none"];
  keys.forEach((k) => {
    assert.equal(js.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.includes('"' + k + '":'), "de " + k);
  });
  assert.match(sc, /C\.coilLoops\(bk\)/);
  assert.match(read("mockups/help.en.txt"), /`Saddle-stitched`/);
  assert.match(read("mockups/help.el.txt"), /`Καρφίτσα`/);
  const ctx = { lang: "el", readJSON: () => ({ prj: [{ id: ID, m: 1, bk: { w: 148, h: 210, pages: 32, bind: "ss" } }] }) };
  assert.match(P.search(ctx)[0].text, /Καρφίτσα/);
});

test("finishes: foil, embossing, material, band, slipcase, sticker, elastic with safe defaults", () => {
  const d = C.normBook({});
  assert.deepEqual([d.foilK, d.embK, d.tex, d.corners, d.deckle, d.belly, d.slip, d.stick, d.elastic], ["gold", "emboss", "paper", 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([d.bellyH, d.bellyC, d.slipC, d.stickK, d.stickD, d.stickX, d.stickY, d.elasticC], [60, "#e8d9b0", "#2a2f38", "round", 38, 0.78, 0.18, "#1f1f22"]);
  const b = C.normBook({ foilK: "holo", embK: "deboss", tex: "linen", corners: true, deckle: 1, belly: 1, bellyH: 999, bellyC: "#ABCDEF",
    slip: 1, stick: 1, stickK: "square", stickD: 5, stickX: 7, stickY: -1, elastic: 1, elasticC: "red" });
  assert.deepEqual([b.foilK, b.embK, b.tex, b.corners, b.deckle, b.belly, b.bellyH, b.bellyC], ["holo", "deboss", "linen", 1, 1, 1, 150, "#abcdef"]);
  assert.deepEqual([b.stickK, b.stickD, b.stickX, b.stickY, b.elasticC], ["square", 15, 1, 0, "#1f1f22"]);
  assert.equal(C.normBook({ foilK: "platinum", tex: "velvet", embK: "x" }).foilK, "gold");
  assert.equal(C.normBook({ tex: "velvet" }).tex, "paper");
  for (const k of ["foil", "uv", "emb", "edgeP", "belly", "slip", "stick"]) assert.ok(C.SLOTS.includes(k), k);
  assert.ok(C.EDGES.includes("print"));
  assert.ok(C.SETS.includes("box"));
  // canonical (R26)
  assert.equal(C.canon(C.normBook(b)), C.canon(b));
});

test("canHave: no band or slipcase on a booklet or spiral, no deckle on board or booklet", () => {
  assert.equal(C.canHave({ bind: "pb" }, "belly"), true);
  assert.equal(C.canHave({ bind: "ss" }, "belly"), false);
  assert.equal(C.canHave({ bind: "sp" }, "slip"), false);
  assert.equal(C.canHave({ bind: "hc" }, "slip"), true);
  assert.equal(C.canHave({ bind: "bb" }, "deckle"), false);
  assert.equal(C.canHave({ bind: "ss" }, "deckle"), false);
  assert.equal(C.canHave({ bind: "lf" }, "deckle"), true);
  assert.equal(C.canHave({ bind: "sp" }, "corners"), true);
});

test("stickerBox stays on the front cover; slipcase wraps the book", () => {
  const s = C.stickerBox({ w: 148, h: 210, stickD: 40, stickX: 1, stickY: 0, stickK: "square" });
  assert.deepEqual(s, { x: 108, y: 0, w: 40, h: 40, round: false });
  const r = C.stickerBox({ w: 148, h: 210 });
  assert.equal(r.round, true);
  assert.ok(r.x >= 0 && r.x + r.w <= 148 && r.y >= 0 && r.y + r.h <= 210);
  for (const bind of ["pb", "hc", "bb", "lf"]) {
    const bk = { w: 148, h: 210, pages: 300, bind }, dd = C.dims(bk), sc = C.slipcase(bk);
    assert.ok(sc.x0 <= dd.xS && sc.x1 > dd.xE, bind + " x");
    assert.ok(sc.y > dd.Hc / 2 && sc.z > dd.zF, bind + " y/z");
    assert.equal(sc.t, 2);
  }
});

test("box set: books stand like a shelf; finish pictures are assets in use", () => {
  const p = prj({ set: { k: "box", n: 3 }, art: { foil: A1, slip: A2 } });
  assert.equal(p.set.k, "box");
  assert.equal(C.count(p), 3);
  C.setList(p).forEach((s) => { assert.equal(s.place, "stand"); assert.equal(s.yaw, 90); });
  assert.deepEqual(C.assetsOf(p).sort(), [A1, A2].sort());
  assert.equal(C.normIns({}).rule, "none");
  assert.equal(C.normIns({ rule: "dotted" }).rule, "dotted");
  assert.equal(C.normIns({ rule: "wavy" }).rule, "none");
});

test("v2 wave 2 wiring: finish controls, notebook preset, strings in en, el and de, help", () => {
  const js = read("mockups/mockups.js"), html = read("mockups/index.html"), de = read("i18n/de/mockups.js");
  ["f-tex", "f-corners", "f-deckle", "f-belly", "f-bellyC", "f-bellyH", "f-slip", "f-slipC", "f-elastic", "f-elasticC", "nb-btn",
    "f-foilK", "f-embK", "f-stick", "f-stickD", "f-stickX", "f-stickY", "f-rule", "edgep-slot"].forEach((id) => {
    assert.match(html, new RegExp('id="' + id + '"'), id);
    assert.ok(js.includes('"' + id + '"'), id);
  });
  const keys = ["edge.print", "slot.edgeP", "sec.finish", "f.tex", "tex.linen", "f.corners", "f.deckle", "f.belly", "f.bellyH", "f.slip", "f.elastic",
    "btn.notebook", "toast.notebook", "sec.fx", "fx.hint", "slot.foil", "slot.uv", "slot.emb", "foil.holo", "emb.deboss", "f.stick", "stick.square",
    "f.rule", "rule.dotted", "set.box"];
  keys.forEach((k) => {
    assert.equal(js.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.includes('"' + k + '":'), "de " + k);
  });
  assert.match(read("mockups/help.en.txt"), /## Finishes and extras/);
  assert.match(read("mockups/help.el.txt"), /## Φινιρίσματα και πρόσθετα/);
});

// ---------- v2 wave 3: products (CD, DVD / Blu-ray) ----------
const GM = require(path.join(ROOT, "mockups/goods/media.js"));
const GA = require(path.join(ROOT, "mockups/goods/analog.js"));
const GS = require(path.join(ROOT, "mockups/goods/small.js"));
const GH = require(path.join(ROOT, "mockups/goods/home.js"));
const GC = require(path.join(ROOT, "mockups/goods/cloth.js"));
function good(over) {
  return C.normGoodProject(Object.assign({ id: ID, m: 1000, nm: "Album", kind: "cd", g: {}, art: {}, sc: {}, out: {}, tpl: { safe: 3 } }, over || {}));
}

test("products: registry, defaults, unknown values fall back, canonical", () => {
  assert.deepEqual(C.goodKinds(), ["cd", "dvd", "tape", "vhs", "vinyl", "badge", "sticker", "keychain", "pin", "magnet", "mug", "poster", "card", "tshirt", "tote", "hoodie", "socks", "cap"]);
  const cd = good();
  assert.deepEqual(cd.g, { pack: "jewel", tray: "black", disc: "silver", hub: 22, beside: 0 });
  const odd = good({ g: { pack: "tin", tray: "pink", disc: "gold", hub: 99, beside: true, x: 1 } });
  assert.deepEqual(odd.g, { pack: "jewel", tray: "black", disc: "silver", hub: 22, beside: 1 });
  const dvd = good({ kind: "dvd", g: { fmt: "bd" } });
  assert.equal(dvd.g.col, "blue", "a Blu-ray case is blue by default");
  assert.equal(good({ kind: "dvd" }).g.col, "black");
  // book-only parts never travel with a product; its own slots do
  const p = good({ art: { front: A1, disc: A2, foil: A1, flapF: A1, inside: A2 }, bk: { pages: 300 }, set: { k: "row" } });
  assert.equal(p.art.disc, A2); assert.equal(p.art.inside, A2);
  assert.ok(!("foil" in p.art) && !("flapF" in p.art));
  assert.ok(!("bk" in p) && !("set" in p) && !("show" in p));
  assert.deepEqual(C.assetsOf(p).sort(), [A1, A2].sort());
  assert.equal(C.canon(C.normGoodProject(p)), C.canon(p));
  assert.equal(C.normGoodProject({ id: ID, m: 1, kind: "book" }), null, "books never go in the products store");
  assert.equal(C.normGoodProject({ id: ID, m: 1, kind: "../x" }), null);
  assert.ok(C.known(p) && C.isGood(p) && !C.isGood(prj({})));
});

test("products store: own key, LWW and tombstones, a newer product kept as it came", () => {
  assert.equal(C.GOODS_KEY, "oros-mockups-goods");
  assert.notEqual(C.GOODS_KEY, C.DATA_KEY);
  const future = { id: "kfuture123", m: 50, kind: "lamp", g: { oz: 11 }, art: { wrap: A1 } };
  let d = C.mergeGoods({ prj: [good(), future, { id: "kbook12345", m: 3, kind: "book" }] }, null);
  assert.deepEqual(d.prj.map((x) => x.id), [ID, "kfuture123"]);
  assert.deepEqual(C.byId(d, "kfuture123"), future, "unknown product kept verbatim");
  assert.equal(C.known(C.byId(d, "kfuture123")), false, "and not shown");
  const huge = { id: "khuge12345", m: 9, kind: "lamp", junk: "x".repeat(70000) };
  assert.equal(C.mergeGoods({ prj: [huge] }, null).prj.length, 0);
  const r = C.putGood(d, Object.assign({}, good(), { nm: "New" }), 2000);
  assert.ok(r.ok);
  assert.equal(C.byId(r.data, ID).nm, "New");
  const gone = C.removeGood(r.data, ID, 3000);
  assert.equal(C.byId(gone, ID), null);
  assert.equal(C.mergeGoods(gone, r.data).prj.length, 1, "the tombstone wins over the older copy");
  // the books store never takes a product as a book (old devices never see them)
  assert.equal(C.merge({ prj: [] }, null).prj.length, 0);
  assert.equal(C.blankGood("cd", ID, 5).tpl.safe, 3);
  assert.equal(C.blankGood("tin", ID, 5), null);
});

test("CD sheets: booklet, tray card with spines, digipak, sleeve, disc label", () => {
  assert.deepEqual(C.sheetsOf(good()), ["booklet", "inlay", "disc"]);
  assert.deepEqual(C.sheetsOf(good({ g: { pack: "slim" } })), ["booklet", "disc"]);
  assert.deepEqual(C.sheetsOf(good({ g: { pack: "digi" } })), ["digi", "digiIn", "disc"]);
  assert.deepEqual(C.sheetsOf(good({ g: { pack: "sleeve" } })), ["sleeve", "disc"]);
  const b = C.templateOf(good(), "booklet");
  assert.equal(b.W, 240); assert.equal(b.H, 120); assert.equal(b.bleed, 3);
  assert.deepEqual(b.sheet, { w: 246, h: 126 });
  assert.deepEqual(b.folds, [{ x: 120, k: "fold" }]);
  const i = C.templateOf(good(), "inlay");
  assert.equal(i.W, 151); assert.equal(i.H, 118);
  assert.deepEqual(i.parts.map((p) => [p.k, p.a, p.w]), [["spineL", "spine", 6.5], ["back", "back", 138], ["spineR", "spine", 6.5]]);
  assert.deepEqual(i.safe.map((s) => s.k), ["back"], "no safe box on the narrow spines");
  const d = C.templateOf(good({ g: { hub: 36 } }), "disc");
  assert.equal(d.circle.print, 118); assert.equal(d.circle.hole, 15); assert.equal(d.circle.hub, 36);
  assert.deepEqual(d.sheet, { w: 120, h: 120 });
  assert.equal(C.templateOf(good(), "nope").kind, "booklet", "an unknown sheet gives the first");
  assert.equal(C.templateOf(good({ art: { bleed: 5 } }), "inlay").bleed, 5);
  const dg = C.templateOf(good({ g: { pack: "digi" } }), "digi");
  assert.deepEqual(dg.parts.map((p) => p.k), ["back", "spine", "front"]);
  assert.equal(GM.cdDims({ pack: "slim" }).d, 5.2);
});

test("DVD sheets: sleeve 273 × 183 with a 14 mm spine, slim and Blu-ray", () => {
  const T = C.templateOf(good({ kind: "dvd" }), "sleeve");
  assert.equal(T.W, 273); assert.equal(T.H, 183); assert.equal(T.parts[1].w, 14);
  assert.equal(C.templateOf(good({ kind: "dvd", g: { cs: "slim" } }), "sleeve").parts[1].w, 7);
  const bd = C.templateOf(good({ kind: "dvd", g: { fmt: "bd" } }), "sleeve");
  assert.equal(bd.H, 148);
  assert.equal(GM.dvdDims({ fmt: "bd" }).h, 171.5);
  assert.equal(C.good("dvd").wrap, true);
  assert.equal(C.good("cd").wrap, false);
});

test("MockPrint: a part takes another slot's picture, every txt part gets the spine text", () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (o, k) => k in o ? o[k] : (...a) => { calls.push([k, a]); return { width: 10 }; }, set: (o, k, v) => { o[k] = v; return true; } });
  const T = C.templateOf(good({ art: { spT: "ALBUM" } }), "inlay");
  MP.drawArt(ctx, T, C.normArt({ spT: "ALBUM" }), {}, 1);
  assert.equal(calls.filter((c) => c[0] === "fillText").length, 2, "both spines");
  const pic = { width: 100, height: 100 };
  calls.length = 0;
  MP.drawArt(ctx, T, C.normArt({}), { spine: pic }, 1);
  assert.equal(calls.filter((c) => c[0] === "drawImage").length, 2, "the spine picture on both spines");
});

test("v2 wave 3 wiring: gallery, product form, two sync slices, strings, search, help", () => {
  const js = read("mockups/mockups.js"), html = read("mockups/index.html"), de = read("i18n/de/mockups.js"), sc = read("mockups/scene.js");
  assert.match(html, /<script src="goods\/media\.js\?v=/);
  assert.match(sc, /from "\.\/goods\/media3d\.js"/);
  assert.match(js, /registerSlice\("mockups-goods", gSliceGet, gSliceSet, C\.GOODS_KEY, C\.mergeGoods\)/);
  ["make", "make-groups", "good-form", "book-form", "cdpack", "trayk", "dvdfmt", "dvdcs", "dvdcol", "disck", "f-hub", "f-beside",
    "f-sheet", "sheet-box", "good-pics", "show-grp", "mode-grp", "tbar-row", "open-lbl"].forEach((id) => {
    assert.match(html, new RegExp('id="' + id + '"'), id);
  });
  const keys = ["tab.item", "tab.pics", "make.title", "make.g.books", "make.g.music", "kind.cd", "kind.cd.d", "kind.dvd", "kind.notebook",
    "f.cdpack", "cdpack.digi", "f.disck", "f.hub", "f.beside.cd", "slot.disc", "slot.cd.front", "tpl.kind.inlay", "tpl.kind.disc", "tpl.discInfo",
    "tpl.goodNote.inlay", "lg.noprint", "f.openCase", "f.openSlide.cd", "f.sheet", "sub.cd", "sub.dvd", "untitled.cd"];
  keys.forEach((k) => {
    assert.equal(js.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.includes('"' + k + '":'), "de " + k);
  });
  // every sheet kind and part has a name
  for (const kind of C.goodKinds()) for (const pack of ["jewel", "slim", "digi", "sleeve"]) {
    const p = good({ kind, g: { pack } });
    for (const s of C.sheetsOf(p)) {
      const T = C.templateOf(p, s);
      assert.ok(js.includes('"tpl.kind.' + T.kind + '":'), T.kind);
      T.parts.forEach((q) => assert.ok(js.includes('"slot.' + q.k + '":'), q.k));
    }
  }
  const ctx = { lang: "en", readJSON: (k) => (k === C.GOODS_KEY ? { prj: [good({ nm: "" })] } : null) };
  assert.equal(P.search(ctx)[0].title, "Mockup CD");
  assert.match(read("mockups/help.en.txt"), /## CD, DVD and Blu-ray/);
  assert.match(read("mockups/help.el.txt"), /## CD, DVD και Blu-ray/);
});

test("cassette: defaults, J-card 101.6 mm with 3 to 5 panels, O-card, tape labels", () => {
  const t = good({ kind: "tape" });
  assert.deepEqual(t.g, { pack: "norelco", shell: "clear", jp: 3, beside: 0 });
  assert.deepEqual(good({ kind: "tape", g: { pack: "tin", shell: "gold", jp: 9 } }).g, t.g);
  assert.deepEqual(C.sheetsOf(t), ["jcard", "tlabel"]);
  assert.deepEqual(C.sheetsOf(good({ kind: "tape", g: { pack: "ocard" } })), ["ocard", "tlabel"]);
  assert.deepEqual(C.sheetsOf(good({ kind: "tape", g: { pack: "none" } })), ["tlabel"]);
  const j = C.templateOf(t, "jcard");
  assert.equal(j.H, 101.6); assert.equal(j.W, 92.7);
  assert.deepEqual(j.parts.map((p) => [p.k, p.a, p.txt]), [["front", "front", 0], ["spine", "spine", 1], ["flap", "back", 0]]);
  const j5 = C.templateOf(good({ kind: "tape", g: { jp: 5 } }), "jcard");
  assert.deepEqual(j5.parts.map((p) => p.k), ["front", "spine", "flap", "in1", "in2"]);
  assert.equal(j5.parts[3].a, "inside"); assert.equal(j5.W, 222.7);
  const l = C.templateOf(t, "tlabel");
  assert.deepEqual(l.parts.map((p) => [p.k, p.w]), [["sideA", 89], ["sideB", 89]]);
  assert.equal(l.H, 51);
  const o = C.templateOf(good({ kind: "tape", g: { pack: "ocard" } }), "ocard");
  assert.equal(o.W, 175); assert.equal(o.H, 110.5);
  assert.deepEqual(GA.tapeDims({}).j, { front: 65, spine: 12.7, flap: 15, h: 101.6 });
  assert.equal(C.good("tape").wrap, false);
});

test("VHS: card sleeve 105 × 192 with a 27 mm spine and glue flap, clamshell, labels", () => {
  const v = good({ kind: "vhs" });
  assert.deepEqual(v.g, { pack: "slip", col: "black", beside: 0 });
  assert.deepEqual(C.sheetsOf(v), ["vslip", "vface", "vspine"]);
  assert.deepEqual(C.sheetsOf(good({ kind: "vhs", g: { pack: "clam" } })), ["vclam", "vface", "vspine"]);
  assert.deepEqual(C.sheetsOf(good({ kind: "vhs", g: { pack: "none" } })), ["vface", "vspine"]);
  const s = C.templateOf(v, "vslip");
  assert.deepEqual(s.parts.map((p) => [p.k, p.w]), [["back", 105], ["spine", 27], ["front", 105], ["side", 27], ["glue", 10]]);
  assert.equal(s.H, 192); assert.equal(s.W, 274);
  assert.equal(C.templateOf(good({ kind: "vhs", g: { pack: "clam" } }), "vclam").W, 288);
  assert.deepEqual([C.templateOf(v, "vface").W, C.templateOf(v, "vface").H], [78, 46]);
  assert.equal(C.templateOf(v, "vspine").parts[0].a, "spine", "the spine label takes the spine picture");
  assert.equal(GA.vhsDims({ pack: "clam" }).d, 32);
});

test("vinyl: LP and 7-inch jackets, gatefold, inner sleeve, round labels with the hole", () => {
  const r = good({ kind: "vinyl" });
  assert.deepEqual(r.g, { size: "lp", jk: "single", rc: "black", inner: "white", big: 0, beside: 0 });
  assert.deepEqual(C.sheetsOf(r), ["jacket", "labelA", "labelB"]);
  assert.deepEqual(C.sheetsOf(good({ kind: "vinyl", g: { jk: "gatefold", inner: "printed" } })), ["gatefold", "inner", "labelA", "labelB"]);
  const j = C.templateOf(r, "jacket");
  assert.equal(j.W, 632); assert.equal(j.H, 314);
  assert.equal(C.templateOf(good({ kind: "vinyl", g: { jk: "gatefold" } }), "gatefold").parts[1].w, 6);
  const a = C.templateOf(r, "labelA");
  assert.equal(a.circle.print, 100); assert.equal(a.circle.hole, 7.24); assert.equal(a.parts[0].a, "labelA");
  const s7 = C.templateOf(good({ kind: "vinyl", g: { size: "7in", big: 1 } }), "labelB");
  assert.equal(s7.circle.print, 84); assert.equal(s7.circle.hole, 38.2);
  assert.equal(C.templateOf(good({ kind: "vinyl", g: { size: "7in" } }), "jacket").H, 184);
  const p = good({ kind: "vinyl", art: { labelA: A1, innerF: A2, disc: A1 } });
  assert.equal(p.art.labelA, A1); assert.equal(p.art.innerF, A2);
  assert.ok(!("disc" in p.art), "a CD slot never travels with a record");
  assert.equal(C.good("vinyl").wrap, true);
  assert.equal(GA.vinylDims({ size: "7in" }).rec, 175);
});

test("v2 wave 4 wiring: cassette, VHS and vinyl forms, gallery, strings, search, help", () => {
  const js = read("mockups/mockups.js"), html = read("mockups/index.html"), de = read("i18n/de/mockups.js"), sc = read("mockups/scene.js");
  assert.match(html, /<script src="goods\/analog\.js\?v=/);
  assert.match(sc, /from "\.\/goods\/analog3d\.js"/);
  ["tape-form", "tpack", "shellk", "f-jp", "vhs-form", "vpack", "vcolk", "vinyl-form", "rsizek", "vjkk", "innerk", "f-rc", "f-big", "beside-lbl"].forEach((id) => {
    assert.match(html, new RegExp('id="' + id + '"'), id);
  });
  const keys = ["kind.tape", "kind.vhs", "kind.vinyl", "kind.vinyl.d", "tpack.ocard", "f.shell", "f.jp", "vpack.clam", "f.rsize", "rsize.7in",
    "f.vjk", "vjk.gatefold", "f.inner", "inner.printed", "f.rc", "f.big", "f.beside.vinyl", "f.openSlide.vinyl", "sub.tape", "untitled.vhs",
    "pics.hint.vinyl", "tpl.kind.jcard", "tpl.kind.vslip", "tpl.goodNote.jcard"];
  keys.forEach((k) => {
    assert.equal(js.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.includes('"' + k + '":'), "de " + k);
  });
  const variants = { tape: [{ pack: "norelco", jp: 5 }, { pack: "ocard" }, { pack: "none" }], vhs: [{ pack: "slip" }, { pack: "clam" }, { pack: "none" }],
    vinyl: [{ jk: "single" }, { jk: "gatefold", inner: "printed" }] };
  for (const kind of Object.keys(variants)) for (const g of variants[kind]) {
    const p = good({ kind, g });
    for (const s of C.sheetsOf(p)) {
      const T = C.templateOf(p, s);
      assert.ok(js.includes('"tpl.kind.' + T.kind + '":'), T.kind);
      T.parts.forEach((q) => assert.ok(js.includes('"slot.' + q.k + '":'), q.k));
    }
  }
  for (const kind of ["tape", "vhs", "vinyl"]) {
    const ctx = { lang: "el", readJSON: (k) => (k === C.GOODS_KEY ? { prj: [good({ kind, nm: "" })] } : null) };
    assert.equal(P.search(ctx).length, 1, kind);
  }
  assert.match(read("mockups/help.en.txt"), /## Cassette, VHS and vinyl/);
  assert.match(read("mockups/help.el.txt"), /## Κασέτα, VHS και βινύλιο/);
});

test("die line: the outline of the see-through edge, grown, holes filled, the biggest piece", () => {
  const w = 60, h = 40, a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (Math.hypot(x - 15, y - 20) < 10 || Math.hypot(x - 45, y - 20) < 8 || (x >= 20 && x <= 40 && y >= 18 && y <= 22)) a[y * w + x] = 255;
  }
  assert.deepEqual(GS.alphaBox(a, w, h), { x0: 6, y0: 11, x1: 52, y1: 29 });
  assert.equal(GS.alphaBox(new Uint8Array(4), 2, 2), null);
  const r0 = GS.dieOutline(a, w, h, 0), xs = r0.path.map((p) => p[0]), ys = r0.path.map((p) => p[1]);
  assert.equal(r0.parts, 1);
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [6, 52, 11, 29]);
  const r3 = GS.dieOutline(a, w, h, 3), x3 = r3.path.map((p) => p[0]);
  assert.ok(Math.min(...x3) <= 3 && Math.max(...x3) >= 55, "grown by the white edge");
  // two pieces: the bigger one, and the count
  const b = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (Math.hypot(x - 12, y - 20) < 8) b[y * w + x] = 255; if (Math.hypot(x - 48, y - 20) < 5) b[y * w + x] = 255; }
  const rb = GS.dieOutline(b, w, h, 1);
  assert.equal(rb.parts, 2); assert.ok(Math.max(...rb.path.map((p) => p[0])) < 30);
  // a ring: one outline, the hole filled
  const c = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const d = Math.hypot(x - 30, y - 20); if (d < 15 && d > 8) c[y * w + x] = 255; }
  const rc = GS.dieOutline(c, w, h, 0);
  assert.equal(rc.parts, 1);
  assert.ok(Math.abs(GS.topAt(rc.path, 30) - 6) <= 1);
  assert.equal(GS.dieOutline(new Uint8Array(w * h), w, h, 2), null);
  assert.equal(GS.circlePath(10, 10, 5, 8).length, 8);
  assert.equal(GS.rectPath(0, 0, 10, 10, 0).length, 4);
});

test("badge: button sizes, the cut circle, face and fold", () => {
  const p = good({ kind: "badge" });
  assert.deepEqual(p.g, { d: 38, fin: "gloss", back: "pin", beside: 0 });
  assert.equal(good({ kind: "badge", g: { d: 39 } }).g.d, 38);
  const T = C.templateOf(p, "badge");
  assert.equal(T.W, 50); assert.equal(T.circle.fold, 38); assert.equal(T.circle.hole, 0); assert.equal(T.circle.safeOut, 34);
  assert.equal(C.templateOf(good({ kind: "badge", g: { d: 25 } }), "badge").W, 35);
  assert.equal(C.blankGood("badge", ID, 5).sc.place, "lie", "small things lie flat");
  assert.equal(C.blankGood("cd", ID, 5).sc.place, "stand");
});

test("sticker, keychain, pin and magnet: cut sheets, holes, backs", () => {
  const s = good({ kind: "sticker" });
  assert.deepEqual(s.g, { shape: "die", size: 75, fin: "gloss", edge: 2 });
  const T = C.templateOf(s, "sticker");
  assert.equal(T.W, 75); assert.equal(T.bleed, 2); assert.deepEqual(T.cut, { shape: "die", r: 0, off: 2, edge: "#ffffff" });
  assert.equal(C.templateOf(good({ kind: "sticker", g: { fin: "clear" } }), "sticker").cut.edge, null, "a clear sticker has no white");
  assert.equal(C.templateOf(good({ kind: "sticker", g: { shape: "rounded" } }), "sticker").cut.r, 6);
  const k = good({ kind: "keychain", g: { two: 1 } });
  assert.deepEqual(C.sheetsOf(k), ["kfront", "kback"]);
  const kb = C.templateOf(k, "kback");
  assert.equal(kb.parts[0].a, "back"); assert.equal(kb.cut.from, "front"); assert.equal(kb.cut.mirror, 1);
  assert.equal(kb.holes[0].tab, 9);
  assert.equal(C.templateOf(good({ kind: "keychain", g: { shape: "round" } }), "kfront").holes[0].y, 4.5);
  assert.equal(GS.keyDims({ mat: "rubber" }).d, 4);
  const pn = good({ kind: "pin", g: { card: 1 } });
  assert.deepEqual(C.sheetsOf(pn), ["pin", "pcard"]);
  assert.equal(C.templateOf(pn, "pin").bleed, 0, "pin artwork has no bleed");
  assert.deepEqual([C.templateOf(pn, "pcard").W, C.templateOf(pn, "pcard").H], [51, 76]);
  const m = good({ kind: "magnet" });
  assert.deepEqual([C.templateOf(m, "magnet").W, C.templateOf(m, "magnet").H], [76, 51]);
  assert.deepEqual([GS.magDims({ shape: "round", size: "102x76" }).w, GS.magDims({ shape: "round" }).h], [76, 51]);
  // every product of the group describes its options; values parse back
  for (const kind of ["badge", "sticker", "keychain", "pin", "magnet"]) {
    const def = C.good(kind);
    assert.equal(def.group, "merch"); assert.ok(def.noOpen);
    def.opts.forEach((o) => { if (o.t !== "chk") assert.ok(o.v.indexOf(good({ kind }).g[o.k]) >= 0, kind + " " + o.k); });
    assert.ok(def.shown(good({ kind }).g).every((x) => C.goodSlots(kind).indexOf(x) >= 0));
  }
});

test("v2 wave 5 wiring: merch gallery, generated form, cut sheets in print, strings, search, help", () => {
  const js = read("mockups/mockups.js"), html = read("mockups/index.html"), de = read("i18n/de/mockups.js"), sc = read("mockups/scene.js"), pr = read("mockups/print.js");
  assert.match(html, /<script src="goods\/small\.js\?v=/);
  assert.match(html, /id="gen-form"/);
  assert.match(sc, /from "\.\/goods\/small3d\.js"/);
  assert.match(pr, /function cutOf/); assert.match(pr, /doc\.lines\(/);
  const keys = ["make.g.merch", "f.gsize", "f.shape", "f.wedge", "f.bback", "f.kmat", "f.ring", "f.metal", "f.enamel", "f.two", "f.card", "good.size2",
    "tpl.badgeInfo", "tpl.cutInfo", "lg.cutLine", "warn.dieOpaque", "warn.dieParts", "warn.dieNoPic"];
  for (const kind of ["badge", "sticker", "keychain", "pin", "magnet"]) {
    keys.push("kind." + kind, "kind." + kind + ".d", "untitled." + kind, "pics.hint." + kind);
    const def = C.good(kind);
    def.opts.forEach((o) => { keys.push(o.l); if (o.p) o.v.forEach((v) => keys.push(o.p + v)); });
    for (const g of [{}, { two: 1, card: 1 }]) {
      const p = good({ kind, g });
      for (const s of C.sheetsOf(p)) keys.push("tpl.kind." + C.templateOf(p, s).kind);
      def.shown(p.g).forEach((x) => keys.push("slot." + kind + "." + x));
    }
  }
  [...new Set(keys)].forEach((k) => {
    assert.equal(js.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.includes('"' + k + '":'), "de " + k);
  });
  const ctx = { lang: "en", readJSON: (k) => (k === C.GOODS_KEY ? { prj: [good({ kind: "pin", nm: "" })] } : null) };
  assert.equal(P.search(ctx)[0].title, "Mockup Enamel pin");
  assert.match(read("mockups/help.en.txt"), /## Badges, stickers and other small things/);
  assert.match(read("mockups/help.el.txt"), /## Κονκάρδες, αυτοκόλλητα και άλλα μικρά/);
});

test("mug, framed poster and card: sizes, sheets, frames, folds", () => {
  const m = good({ kind: "mug" });
  assert.deepEqual(m.g, { oz: 11, inner: "white", handle: "white", fin: "gloss" });
  const T = C.templateOf(m, "mugwrap");
  assert.deepEqual([T.W, T.H, T.parts[0].a], [216, 89, "wrap"]);
  assert.equal(C.templateOf(good({ kind: "mug", g: { oz: 15 } }), "mugwrap").H, 100);
  assert.equal(GH.mugDims({ oz: 15 }).h, 117);
  const p = good({ kind: "poster" });
  assert.deepEqual(p.g, { size: "a3", orient: "portrait", frame: "black", mat: 0, wall: "light" });
  assert.deepEqual([C.templateOf(p, "poster").W, C.templateOf(p, "poster").H], [297, 420]);
  const land = good({ kind: "poster", g: { size: "50x70", orient: "landscape", mat: 1 } });
  assert.deepEqual([C.templateOf(land, "poster").W, C.templateOf(land, "poster").H], [700, 500]);
  const D = GH.posterDims(land.g);
  assert.equal(D.mat, 60); assert.equal(D.w, 700 + 120 + 2 * D.bar);
  assert.equal(C.templateOf(good({ kind: "poster", g: { frame: "none" } }), "poster").hidden, 0);
  const c = good({ kind: "card" });
  assert.deepEqual(C.sheetsOf(c), ["pcfront", "pcback"]);
  assert.equal(C.blankGood("card", ID, 5).sc.place, "lean");
  const f = good({ kind: "card", g: { ck: "folded", size: "sq", env: "kraft" } });
  assert.deepEqual(C.sheetsOf(f), ["gcout", "gcin"]);
  const o = C.templateOf(f, "gcout"), i = C.templateOf(f, "gcin");
  assert.deepEqual(o.parts.map((q) => q.k), ["back", "front"]); assert.equal(o.W, 296); assert.deepEqual(o.folds, [{ x: 148, k: "fold" }]);
  assert.deepEqual(i.parts.map((q) => q.a), ["inside", "inside2"]);
  assert.equal(C.good("card").noOpen(c.g), true); assert.equal(C.good("card").noOpen(f.g), false);
  assert.deepEqual(C.good("card").shown(f.g), ["front", "back", "inside", "inside2"]);
  assert.equal(good({ kind: "card", art: { inside2: A1 } }).art.inside2, A1);
});

test("v2 wave 6 wiring: home gallery, strings, search, help", () => {
  const js = read("mockups/mockups.js"), html = read("mockups/index.html"), de = read("i18n/de/mockups.js"), sc = read("mockups/scene.js");
  assert.match(html, /<script src="goods\/home\.js\?v=/);
  assert.match(sc, /from "\.\/goods\/home3d\.js"/);
  const keys = ["make.g.home", "f.openCard"];
  for (const kind of ["mug", "poster", "card"]) {
    keys.push("kind." + kind, "kind." + kind + ".d", "untitled." + kind, "pics.hint." + kind);
    const def = C.good(kind);
    def.opts.forEach((o) => { keys.push(o.l); if (o.p) o.v.forEach((v) => keys.push(o.p + v)); });
    for (const g of [{}, { ck: "folded" }]) {
      const p = good({ kind, g });
      for (const s of C.sheetsOf(p)) keys.push("tpl.kind." + C.templateOf(p, s).kind);
      def.shown(p.g).forEach((x) => keys.push("slot." + kind + "." + x));
    }
  }
  [...new Set(keys)].forEach((k) => {
    assert.equal(js.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.includes('"' + k + '":'), "de " + k);
  });
  const ctx = { lang: "el", readJSON: (k) => (k === C.GOODS_KEY ? { prj: [good({ kind: "mug", nm: "" })] } : null) };
  assert.equal(P.search(ctx)[0].title, "Μακέτα Κούπα");
  assert.match(read("mockups/help.en.txt"), /## Mug, poster and cards/);
  assert.match(read("mockups/help.el.txt"), /## Κούπα, αφίσα και κάρτες/);
});

// ---------- v2 wave 7: T-shirt and tote bag ----------
test("T-shirt and tote bag: options, print areas, garment-ink sheets", () => {
  const t = good({ kind: "tshirt" });
  assert.deepEqual(t.g, { col: "white", area: "front", back: 0 });
  assert.deepEqual(good({ kind: "tshirt", g: { col: "pink", area: "sleeve", back: true } }).g, { col: "white", area: "front", back: 1 });
  assert.deepEqual(C.sheetsOf(t), ["teefront"]);
  const T = C.templateOf(t, "teefront");
  assert.deepEqual([T.W, T.H, T.bleed, T.ink, T.parts[0].k], [300, 400, 0, 1, "front"]);
  const chest = good({ kind: "tshirt", g: { area: "chest", back: 1 } });
  assert.deepEqual(C.sheetsOf(chest), ["teefront", "teeback"]);
  assert.deepEqual([C.templateOf(chest, "teefront").W, C.templateOf(chest, "teefront").H], [95, 95]);
  assert.deepEqual([C.templateOf(chest, "teeback").W, C.templateOf(chest, "teeback").parts[0].k], [300, "back"]);
  assert.deepEqual(C.good("tshirt").shown(chest.g), ["front", "back"]);
  const b = good({ kind: "tote", g: { handles: "short", back: 1 } });
  assert.deepEqual(b.g, { col: "natural", handles: "short", back: 1 });
  assert.deepEqual(C.sheetsOf(b), ["totefront", "toteback"]);
  assert.deepEqual([C.templateOf(b, "toteback").W, C.templateOf(b, "toteback").H], [280, 300]);
  assert.equal(GC.toteDims(b.g).handle, 150);
  const blank = C.blankGood("tote", ID, 5);
  assert.equal(blank.sc.place, "lie");
  assert.equal(C.good("tote").model, "tote");
  // every print area lies inside its model's outline
  for (const name of ["tshirt", "tote"]) {
    const M = GC.MODELS[name];
    assert.match(M.sha256, /^[0-9a-f]{64}$/); assert.ok(M.bytes > 1000);
    for (const r of Object.values(M.print)) {
      assert.ok(r.x >= -M.w / 2 && r.x + r.w <= M.w / 2 && r.y <= M.h / 2 && r.y - r.h >= -M.h / 2, name);
    }
  }
  assert.equal(GC.urlOf("tote"), "https://koulaxizis.github.io/oros-models/mockups/tote.glb?v=1");
});

test("cloth models: only the exact file is kept", async () => {
  await assert.rejects(GC.check("tote", new ArrayBuffer(10)), (e) => e.code === "hash");
  await assert.rejects(GC.check("tote", new ArrayBuffer(GC.MODELS.tote.bytes)), (e) => e.code === "hash");
  assert.equal(GC.buffer("tote"), null);
  assert.equal(await GC.cached("tote"), false);          // no Cache Storage here: nothing, no network
  await assert.rejects(GC.load("lamp"), (e) => e.code === "unknown");
});

test("cloth3d: reads the GLB layout make.py writes", async () => {
  const { parseGLB } = await import(path.join(ROOT, "mockups/goods/cloth3d.js"));
  // one triangle: POSITION (metres), NORMAL, uint32 indices
  const pos = new Float32Array([0, 0, 0, 0.1, 0, 0, 0, 0.2, 0.01]), nrm = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), idx = new Uint32Array([0, 1, 2]);
  const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(nrm.buffer), Buffer.from(idx.buffer)]);
  const js = { asset: { version: "2.0" }, meshes: [{ name: "shirt", primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }, { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" }, { bufferView: 2, componentType: 5125, count: 3, type: "SCALAR" }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 36 }, { buffer: 0, byteOffset: 72, byteLength: 12 }], buffers: [{ byteLength: 84 }] };
  let j = Buffer.from(JSON.stringify(js)); while (j.length % 4) j = Buffer.concat([j, Buffer.from(" ")]);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + bin.length, 8);
  const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  const glb = Buffer.concat([head, ch(j.length, 0x4E4F534A), j, ch(bin.length, 0x004E4942), bin]);
  const m = parseGLB(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.length)).shirt;
  assert.deepEqual([...m.idx], [0, 1, 2]);
  assert.ok(Math.abs(m.pos[3] - 100) < 1e-4 && Math.abs(m.pos[7] - 200) < 1e-4);    // mm
  assert.throws(() => parseGLB(new ArrayBuffer(24)));
});

test("v2 wave 7 wiring: wear gallery, strings, search, help", () => {
  const js = read("mockups/mockups.js"), html = read("mockups/index.html"), de = read("i18n/de/mockups.js"), sc = read("mockups/scene.js");
  assert.match(html, /<script src="goods\/cloth\.js\?v=/);
  assert.match(html, /id="model-get"/);
  assert.match(sc, /from "\.\/goods\/cloth3d\.js"/);
  const keys = ["make.g.wear", "tpl.inkInfo", "model.get", "model.need", "model.busy", "model.ready", "model.remove", "model.err.net", "model.err.hash"];
  for (const kind of ["tshirt", "tote", "hoodie", "socks", "cap"]) {
    keys.push("kind." + kind, "kind." + kind + ".d", "untitled." + kind, "pics.hint." + kind);
    const def = C.good(kind);
    def.opts.forEach((o) => { keys.push(o.l); if (o.p) o.v.forEach((v) => keys.push(o.p + v)); });
    const p = good({ kind, g: { back: 1, style: "trucker" } });
    for (const s of C.sheetsOf(p)) keys.push("tpl.kind." + C.templateOf(p, s).kind, "tpl.goodNote." + s);
    def.shown(p.g).forEach((x) => keys.push("slot." + kind + "." + x));
  }
  [...new Set(keys)].forEach((k) => {
    assert.equal(js.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.includes('"' + k + '":'), "de " + k);
  });
  const ctx = { lang: "en", readJSON: (k) => (k === C.GOODS_KEY ? { prj: [good({ kind: "tote", nm: "" })] } : null) };
  assert.equal(P.search(ctx)[0].title, "Mockup Tote bag");
  assert.match(read("mockups/help.en.txt"), /## Clothes, bags and caps/);
  assert.match(read("mockups/help.el.txt"), /## Ρούχα, τσάντες και καπέλα/);
});

// ---------- v2 wave 8: hoodie, socks, cap ----------
test("hoodie, socks and cap: options, print areas, what goes where", () => {
  const h = good({ kind: "hoodie", g: { area: "chest", back: 1 } });
  assert.deepEqual(h.g, { col: "heather", area: "chest", back: 1 });
  assert.deepEqual(C.sheetsOf(h), ["hoodfront", "hoodback"]);
  assert.deepEqual([C.templateOf(h, "hoodback").W, C.templateOf(h, "hoodback").H, C.templateOf(h, "hoodback").ink], [300, 400, 1]);
  assert.deepEqual(GC.prints("hoodie", h.g).map((q) => [q.sheet, q.side, q.area.w]), [["hoodfront", 1, 95], ["hoodback", -1, 300]]);
  const so = good({ kind: "socks", g: { col: "navy" } });
  assert.deepEqual(so.g, { col: "white" });
  assert.deepEqual([C.templateOf(so, "sockleg").W, C.templateOf(so, "sockleg").H], [90, 250]);
  assert.deepEqual(GC.prints("socks", so.g).map((q) => q.mesh), ["sock_0", "sock_1"]);
  const c = good({ kind: "cap" });
  assert.deepEqual(c.g, { style: "dad", col: "black", fin: "embroidery", wfront: 0 });
  assert.equal(C.good("cap").model, undefined);              // built in code: nothing to download
  assert.equal(C.blankGood("cap", ID, 5).sc.place, "stand");
  assert.equal(C.good("cap").opts.find((o) => o.k === "wfront").when(c.g), false);
  assert.deepEqual([C.templateOf(c, "capfront").W, C.templateOf(c, "capfront").H], [110, 55]);
  assert.equal(GC.capDims({ style: "trucker" }).h, 122);
  for (const name of ["hoodie", "socks"]) {
    const M = GC.MODELS[name];
    assert.match(M.sha256, /^[0-9a-f]{64}$/); assert.equal(C.good(name).model, name);
  }
});
