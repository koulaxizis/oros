// Mockups (mockups/core.js): book measures (spine from pages and
// paper), the cover's cross-section and its printed panels, the
// project model and its merge (sync slice "mockups"), cover deep
// links from Atelier, the search provider, the Atelier side of the
// bridges (atelier/editpic.js plan / parseNew) and the app's wiring.
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
  assert.deepEqual(p.out, { ratio: "4:5", size: 2048, fmt: "png" });
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
