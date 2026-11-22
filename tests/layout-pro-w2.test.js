// Layout pro (LY-PRO wave W2, Chris's spec v2 2026-11-18): nested
// styles (a play's speaker up to ":"), styles made by name, the play's
// style set, text frames with "[Style]" and "{Char|words}" marks, a
// picture page retypeset as live text, a story's new text, the house's
// front and back pages scaled and filled, the book padded to 40 pages,
// and the commands for Claude (edit_in_app) that run all of it.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "designkit/model.js"));
const T = require(path.join(ROOT, "designkit/text.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const PRO = require(path.join(ROOT, "layout/pro.js"));
const CMD = require(path.join(ROOT, "layout/commands.js"));
const AUTO = require(path.join(ROOT, "layout/autolay.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const MM = 72 / 25.4;
const near = (a, b, e) => Math.abs(a - b) <= (e || 0.05);

T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

let IDN = 0;
function idf() { const k = (++IDN).toString(36); let n = 0; return (p) => p + "-t" + k + "x" + (++n); }
function steps(list) { const c = CMD.check(list); assert.ok(c.ok, c.err); return c.steps; }
function book(extra) {
  const s = steps([{ op: "create", title: "Στην καρδιά του βυθού", w: 180, h: 250, mm: 3 }].concat(extra || []));
  const d = PRO.makeDoc(s[0], 10);
  s.slice(1).forEach((st) => CMD.apply(d, st, { now: 11, idf: idf() }));
  return d;
}
function pics(n) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push({ a: (i.toString(16).padStart(2, "0")).repeat(32) + ".jpg", iw: 2126, ih: 2953, nm: i + ".jpg" });
  return out;
}
function runsOf(L, frameId) { return L.frames[frameId].lines.reduce((a, l) => a.concat(l.runs), []); }

test("nested styles: the speaker up to the colon takes the character style, the rest stays", () => {
  const nest = [{ cs: "cs-sp", to: ":" }];
  assert.deepEqual(T.nestRuns([{ t: "ΝΙΚΟΣ: Καλημέρα." }], nest), [{ t: "ΝΙΚΟΣ:", cs: "cs-sp" }, { t: " Καλημέρα." }]);
  assert.deepEqual(T.nestRuns([{ t: "Χωρίς διπλή τελεία" }], nest), [{ t: "Χωρίς διπλή τελεία" }], "not found: nothing applies");
  // a run with its own character style keeps it; the cut crosses runs
  assert.deepEqual(T.nestRuns([{ t: "ΝΙ" }, { t: "ΚΟΣ", cs: "cs-own" }, { t: ": ναι" }], nest), [{ t: "ΝΙ", cs: "cs-sp" }, { t: "ΚΟΣ", cs: "cs-own" }, { t: ":", cs: "cs-sp" }, { t: " ναι" }]);
  // two in a row: through ":" then through "."
  assert.deepEqual(T.nestRuns([{ t: "Α: β. γ" }], [{ cs: "x", to: ":" }, { cs: "y", to: "." }]), [{ t: "Α:", cs: "x" }, { t: " β.", cs: "y" }, { t: " γ" }]);
  const ps = T.resolvePs({ "ps-a": { id: "ps-a", ext: { nest: [{ cs: "c", to: ":" }, { cs: "", to: "." }, { cs: "d", to: "toolong" }, 5] } } }, "ps-a");
  assert.deepEqual(ps.nest, [{ cs: "c", to: ":" }], "only valid entries");
});

test("play styles: the set, and dialogue laid out with the speaker in bold capitals", () => {
  const d = book([{ op: "styleset", set: "play", lang: "el" }, { op: "frame", page: 1, lines: ["[Διάλογος] Νίκος: Καλημέρα.", "[Σκηνική οδηγία] (Μπαίνει.)"] }]);
  ["Ομιλητής"].forEach((n) => assert.ok(PRO.styleNamed(d.cstyles, n), n));
  ["Πρόσωπα (τίτλος)", "Πρόσωπα", "Πράξη", "Σκηνή", "Διάλογος", "Σκηνική οδηγία", "Τραγούδι"].forEach((n) => assert.ok(PRO.styleNamed(d.pstyles, n), n));
  assert.equal(PRO.styleNamed(d.pstyles, "Πράξη").ext.brk, "page");
  assert.equal(PRO.playStyles(d, "el", 12), 0, "a second time makes nothing");
  // sizes and spaces to the nearest 0.5 pt (Chris 2026-11-18)
  d.pstyles.filter((p) => /^ps-play/.test(p.id)).forEach((p) => ["size", "sb", "sa", "li"].forEach((k) => { if (p[k] !== undefined) assert.equal(p[k] * 2, Math.round(p[k] * 2), p.name + " " + k + " " + p[k]); }));
  const fr = d.items.filter((it) => it.t === "text")[0];
  const runs = runsOf(R.computeLayout(d), fr.id);
  assert.equal(runs[0].t, "ΝΙΚΟΣ:");
  assert.equal(runs[0].key, "serif-b");
  assert.ok(runs.some((r) => r.t === "Καλημέρα." && r.key === "serif-r"));
  assert.ok(runs.some((r) => r.key === "serif-i"), "the stage direction in italics");
  assert.equal(PRO.styleNamed(d.pstyles, "Dialogue"), null, "Greek names in a Greek book");
  const e = book([{ op: "styleset", set: "play", lang: "en" }]);
  assert.ok(PRO.styleNamed(e.pstyles, "Stage direction"));
});

test("defstyle: made and changed by name, nested by names, a colour becomes a swatch", () => {
  const d = book();
  const s = steps([
    { op: "defstyle", kind: "char", name: "Ρόλος", bold: "on", caps: "on", color: "#1a6fb0" },
    { op: "defstyle", name: "Λόγια", base: "Basic paragraph", size: 11, lead: 14.5, fi: 0, sa: 3, nest_cs: "ρόλος", nest_to: ":", keep: "on", hyph: "off" }
  ]);
  assert.equal(CMD.apply(d, s[0], { now: 20 }), 1);
  assert.equal(CMD.apply(d, s[1], { now: 20 }), 1);
  const cs = PRO.styleNamed(d.cstyles, "Ρόλος"), ps = PRO.styleNamed(d.pstyles, "Λόγια");
  assert.deepEqual([cs.b, cs.caps], [1, 1]);
  assert.equal(M.find(d.swatches, cs.color).name, "#1a6fb0");
  assert.deepEqual([ps.base, ps.size, ps.lead, ps.fi, ps.sa], ["ps-base", 11, 14.5, 0, 3]);
  assert.deepEqual(ps.ext.nest, [{ cs: cs.id, to: ":" }]);
  assert.deepEqual([ps.ext.kwn, ps.ext.hyph], [1, 0]);
  assert.equal(CMD.apply(d, s[1], { now: 21 }), 0, "nothing differs: nothing changes");
  const off = steps([{ op: "defstyle", name: "Λόγια", nest_cs: "none", size: 0, sb: -1 }])[0];
  assert.equal(CMD.apply(d, off, { now: 22 }), 1);
  assert.ok(!PRO.styleNamed(d.pstyles, "Λόγια").ext.nest);
  assert.equal(PRO.styleNamed(d.pstyles, "Λόγια").size, 11, "0 leaves the size as it is");
  assert.equal(d.pstyles.filter((p) => p.name === "Λόγια").length, 1);
});

test("frame: the margins by default, a box in mm, marks for styles; clear retypesets a picture page", () => {
  const d = book([{ op: "styleset", set: "play" }]);
  PRO.placePictures(d, pics(4), { fit: "trim", at: "end", side: "right" }, 12, idf());
  const order = M.pagesInOrder(d), pg2 = order[1], pic = d.items.filter((it) => it.pg === pg2.id)[0];
  assert.equal(pic.t, "img");
  const [st] = steps([{ op: "frame", page: 2, clear: true, style: "Διάλογος", lines: ["[Σκηνή] ΣΚΗΝΗ ΠΡΩΤΗ", "ΜΑΡΙΑ: Πού είσαι; {Ομιλητής|ΝΙΚΟΣ} δεν απαντά.", "[Άγνωστο] μένει ως κείμενο"] }]);
  assert.equal(CMD.apply(d, st, { now: 30, idf: idf() }), 1);
  const on = d.items.filter((it) => it.pg === pg2.id);
  assert.equal(on.length, 1);
  assert.equal(on[0].t, "text");
  assert.ok(d.tombs[pic.id] >= 30, "the picture goes with a tombstone, so it syncs");
  const mg = M.margins(d, M.sideOf(d, 1));
  assert.ok(near(on[0].x, mg.l) && near(on[0].y, mg.t) && near(on[0].w, d.setup.w - mg.l - mg.r));
  const story = M.find(d.stories, on[0].story);
  assert.deepEqual(story.paras.map((p) => p.ps), ["ps-playscene", "ps-playline", "ps-playline"]);
  assert.deepEqual(story.paras[1].runs, [{ t: "ΜΑΡΙΑ: Πού είσαι; " }, { t: "ΝΙΚΟΣ", cs: "cs-playspeaker" }, { t: " δεν απαντά." }]);
  assert.equal(story.paras[2].runs[0].t, "[Άγνωστο] μένει ως κείμενο", "an unknown style stays text");
  const [box] = steps([{ op: "frame", page: 3, x: 20, y: 30, w: 100, h: 40, ncol: 2, gut: 4, fill: "#ffffff", opacity: 80, lines: ["Λεζάντα"] }]);
  CMD.apply(d, box, { now: 31 });
  const fr = d.items.filter((it) => it.pg === order[2].id && it.t === "text")[0];
  assert.ok(near(fr.x, 20 * MM) && near(fr.y, 30 * MM) && near(fr.w, 100 * MM) && near(fr.h, 40 * MM));
  assert.deepEqual([fr.cols, fr.op], [2, 80]);
  assert.ok(near(fr.gut, 4 * MM));
  assert.ok(fr.z > Math.max.apply(null, d.items.filter((it) => it.pg === order[2].id && it.t === "img").map((it) => it.z)), "above the picture");
  assert.equal(CMD.apply(d, steps([{ op: "frame", page: 99, lines: ["x"] }])[0], { now: 32 }), 0, "no such page");
});

test("retext: a story's paragraphs by its frame's id", () => {
  const d = book([{ op: "frame", page: 1, lines: ["παλιό"] }]);
  const fr = d.items.filter((it) => it.t === "text")[0];
  assert.match(CMD.check([{ op: "retext", lines: ["x"] }]).err, /retext needs frame or story/);
  assert.equal(CMD.apply(d, steps([{ op: "retext", frame: fr.id, lines: ["νέο", "δεύτερο"] }])[0], { now: 40 }), 1);
  assert.deepEqual(M.find(d.stories, fr.story).paras.map((p) => p.runs[0].t), ["νέο", "δεύτερο"]);
  assert.equal(CMD.apply(d, steps([{ op: "retext", story: "st-none", lines: ["x"] }])[0], { now: 41 }), 0);
});

// A house style document (LY-HS) at 140×210 mm: two front pages (title
// with fields), the body page, one back page.
function house(more) {
  const s = steps([{ op: "create", title: "Οίκος Γλαρόλυκοι", w: 140, h: 210, n: 4 + (more || 0) * 2, mm: 3 }]);
  const h = PRO.makeDoc(s[0], 5);
  h.setup.ext = Object.assign({}, h.setup.ext, { house: { rules: [], roles: {} } });
  const order = M.pagesInOrder(h);
  order[2].ext = { hs: "body" };
  h.pstyles.push({ id: "ps-hstitle", m: 5, name: "Τίτλος οίκου", base: "ps-base", size: 24, color: "sw-hs" });
  h.swatches.push({ id: "sw-hs", m: 5, name: "Οίκος", mode: "rgb", v: [20, 40, 80] });
  const add = (pg, text, ps) => {
    const sid = "st-h" + h.stories.length;
    h.stories.push({ id: sid, m: 5, h: [], paras: [{ ps: ps || "ps-base", runs: [{ t: text }] }] });
    h.items.push({ id: "it-h" + h.items.length, m: 5, t: "text", pg: pg.id, story: sid, x: 20 * MM, y: 30 * MM, w: 100 * MM, h: 20 * MM, z: 1 });
  };
  add(order[0], "{title}", "ps-hstitle");
  add(order[1], "© {year} {author} · ISBN {isbn}");
  add(order[2], "body sample");
  add(order[3], "Ευχαριστίες");
  // more: one more front page (a half title) and one more back page each
  for (let i = 0; i < (more || 0); i++) {
    const o = M.pagesInOrder(h);
    add(o[4 + i * 2], "Μισός τίτλος " + i);
    add(o[5 + i * 2], "Συντελεστές " + i);
  }
  if (more) {
    // the extra pages: half titles to the front, credits to the back
    const o = M.pagesInOrder(h), fr = o.slice(4).filter((p, i) => i % 2 === 0), bk = o.slice(4).filter((p, i) => i % 2 === 1);
    [].concat(fr, o.slice(0, 4), bk).forEach((p, i) => { p.pos = (i + 1) * 1024; });
  }
  h.items.push({ id: "it-hlogo", m: 5, t: "rect", pg: order[3].id, x: 50 * MM, y: 150 * MM, w: 40 * MM, h: 40 * MM, z: 2, fill: "sw-hs" });
  return h;
}

test("house_pages: front and back pages scaled to the book, fields filled, padded to a multiple", () => {
  const d = book();
  PRO.placePictures(d, pics(28), { fit: "trim", at: "end", side: "right" }, 12, idf());
  const h = house();
  const before = M.pagesInOrder(d).length;
  const [st] = steps([{ op: "house_pages", where: "both", pad: 8, author: "Χ. Κουλαξίζης", year: "2026" }]);
  const meta = { title: "Στην καρδιά του βυθού", isbn: "" };
  const n = CMD.apply(d, st, { now: 50, idf: idf(), docs: [d, h], meta, fill: AUTO.fillFields });
  const order = M.pagesInOrder(d);
  assert.equal(order.length % 8, 0, "a multiple of 8");
  assert.equal(n, order.length - before);
  const first = d.items.filter((it) => it.pg === order[0].id)[0];
  assert.equal(M.find(d.stories, first.story).paras[0].runs[0].t, "Στην καρδιά του βυθού", "{title} from the book");
  assert.equal(M.find(d.stories, d.items.filter((it) => it.pg === order[1].id)[0].story).paras[0].runs[0].t, "© 2026 Χ. Κουλαξίζης · ISBN {isbn}", "an empty ISBN stays a field (preflight shows it)");
  // the house's title frame follows the book's text area (LY-W8): its place and width in it, not the page's proportions
  const RT = require(path.join(ROOT, "layout/retrim.js")), h0 = h.items.filter((it) => it.pg === M.pagesInOrder(h)[0].id)[0];
  const want = RT.mapRect(h0, RT.pageOf(h.setup, "R"), RT.pageOf(d.setup, "R"), "stretch");
  assert.ok(near(first.w, want.w) && near(first.x, want.x), "scaled to the book's trim");
  const inner = RT.pageOf(d.setup, "R");
  assert.ok(first.x >= inner.ml - 0.01 && first.x + first.w <= d.setup.w - inner.mr + 0.01, "inside the book's text area");
  assert.ok(M.find(d.pstyles, "ps-hstitle") && M.find(d.swatches, "sw-hs"), "the styles and swatches they need come too");
  const last = order[order.length - 1], logo = d.items.filter((it) => it.pg === last.id && it.t === "rect")[0];
  assert.ok(logo && near(logo.w, logo.h), "a shape keeps its proportions");
  assert.ok(!d.items.some((it) => it.t === "text" && /body sample/.test(JSON.stringify(M.find(d.stories, it.story)))), "the body page is not copied");
  // two front pages (even): the first picture stays on a right-hand page
  const firstPic = order.findIndex((p) => d.items.some((it) => it.pg === p.id && it.t === "img"));
  assert.equal(M.sideOf(d, firstPic), "R");
  assert.deepEqual(order.map((p) => p.pos), order.map((p, i) => (i + 1) * 1024));
});

test("house_pages: an odd front keeps the first picture's side; no house is a note; preview counts", () => {
  const d = book();
  PRO.placePictures(d, pics(4), { fit: "trim", at: "end", side: "right" }, 12, idf());
  const h = house();
  M.pagesInOrder(h)[1].ext = { hs: "body" };   // one front page
  const [st] = steps([{ op: "house_pages", where: "front", keep_side: true }]);
  CMD.apply(d, st, { now: 50, idf: idf(), docs: [h] });
  const order = M.pagesInOrder(d);
  const firstPic = order.findIndex((p) => d.items.some((it) => it.pg === p.id && it.t === "img"));
  assert.equal(M.sideOf(d, firstPic), "R");
  const notes = [];
  assert.equal(CMD.apply(book(), st, { now: 1, notes, docs: [] }), 0);
  assert.deepEqual(notes, ["noHouse"]);
  assert.equal(CMD.houseIn([h, house()], "", ""), null, "two houses and no name: none");
  assert.ok(CMD.houseIn([h, Object.assign(house(), { id: "x", name: "Άλλος" })], "οίκος", ""));
  const pv = CMD.preview({ docs: [d, h] }, [d.id], steps([{ op: "house_pages", where: "none", pad: 16 }]));
  assert.equal(pv.n, 16 - order.length % 16);
});

test("acceptance in the model: 28 pictures, 3 pages of live text, house pages, 40 pages", () => {
  const d = book([{ op: "styleset", set: "play" }]);
  PRO.placePictures(d, pics(28), { fit: "trim", at: "end", side: "right" }, 12, idf());
  [10, 11, 12].forEach((p) => CMD.apply(d, steps([{ op: "frame", page: p, clear: true, style: "Διάλογος", lines: ["[Σκηνή] ΣΚΗΝΗ " + p, "ΑΝΝΑ: Ακούς τη θάλασσα;", "[Σκηνική οδηγία] (Σιωπή.)"] }])[0], { now: 60 }));
  const h = house(1);   // three front pages, two back pages
  CMD.apply(d, steps([{ op: "house_pages", where: "both", pad: 8 }])[0], { now: 61, docs: [h], meta: { title: "Στην καρδιά του βυθού" }, fill: AUTO.fillFields });
  const order = M.pagesInOrder(d);
  assert.equal(order.length, 40);
  assert.equal(d.items.filter((it) => it.t === "img").length, 25);
  const L = R.computeLayout(d);
  assert.equal(L.overset.length || Object.keys(L.overset || {}).length, 0, "nothing overset");
  const live = d.items.filter((it) => it.t === "text" && /ΑΝΝΑ/.test(JSON.stringify(M.find(d.stories, it.story))));
  assert.equal(live.length, 3);
  live.forEach((fr) => assert.ok(runsOf(L, fr.id).some((r) => r.t === "ΑΝΝΑ:" && r.key === "serif-b")));
});

test("the commands reach Claude: the guide, the card's words, the house and book details in Layout", () => {
  ["defstyle", "styleset", "frame", "retext", "house_pages"].forEach((op) => assert.match(CMD.GUIDE, new RegExp("\\b" + op + ":")));
  const as = read("layout/assist.js"), pa = read("layout/proassist.js"), a = read("assistant/assistant.js");
  assert.match(as, /e\.docs = LY\.data\(\)\.docs/);
  assert.match(as, /LY\.pro\.metaFor\(cur\)/);
  assert.match(as, /window\.LY_AUTO\.fillFields/);
  assert.match(pa, /function metaFor\(doc\)/);
  assert.match(a, /"ed\.op\.frame\.layout": "New text frame"/);
  assert.match(a, /"ed\.nLines": "\{n\} paragraphs"/);
});
