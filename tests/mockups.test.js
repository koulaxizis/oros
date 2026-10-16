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
