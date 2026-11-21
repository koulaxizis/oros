// orOS Atelier — Canva's animations, videos, sounds and moving GIFs
// (wave CV-A): anim.js effects (ext.anim on an element, ext.pan on the
// page background), the moving-GIF reader (gifdec.js) and what the
// PowerPoint import brings over from Canva (videos, slide sound,
// moving GIFs, transitions, timings).
// Run: node --test tests/atelier-anim.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const zlib = require("node:zlib");

const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "designkit/model.js"));
const AX = require(path.join(ROOT, "atelier/ax.js"));
const Anim = require(path.join(ROOT, "atelier/anim.js"));
const Gif = require(path.join(ROOT, "atelier/gif.js"));
const G = require(path.join(ROOT, "atelier/gifdec.js"));
const CL = require(path.join(ROOT, "atelier/clips.js"));
const Z = require(path.join(ROOT, "atelier/zip.js"));
const P = require(path.join(ROOT, "atelier/pptx.js"));

const H = "a".repeat(64);
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, (msg || "") + " " + a + " ≈ " + b);

function design(extra) {
  const d = AX.newDesign({ name: "Anim", w: 1080, h: 1080, unit: "px" }, 9);
  const pg = d.pages[0].id;
  AX.addItem(d, pg, Object.assign({ k: "text", tx: "Hello big world", size: 40, x: 100, y: 100, w: 600 }, extra || {}), 9);
  AX.addItem(d, pg, { k: "shape", shp: "rect", fc: "#ff0000", x: 100, y: 400, w: 200, h: 200 }, 9);
  return { d, pg };
}
const byKind = (d, k) => d.items.find((i) => i.ax && i.ax.k === k && !i.ax.bg);

test("anim: ext.anim is kept to known effects and ranges", () => {
  assert.equal(Anim.norm(null), null);
  assert.equal(Anim.norm({ in: { e: "spin" } }), null);
  assert.deepEqual(Anim.norm({ in: { e: "rise", d: "l", sp: 1, by: "el" }, out: { e: "pan", d: "x", sp: 9 }, em: { e: "pulse", d: "l", by: "word" }, t0: 1.23, t1: 0.5 }),
    { in: { e: "rise", d: "l" }, out: { e: "pan", sp: 4 }, em: { e: "pulse" }, t0: 1.2 });
  assert.deepEqual(Anim.norm({ in: { e: "fade" }, t0: 1, t1: 3 }), { in: { e: "fade" }, t0: 1, t1: 3 });
  // every effect has a nearest older entrance for older copies
  Anim.EFFECT_IDS.forEach((id) => assert.ok(["fade", "rise", "pop", "wipe", "type"].includes(Anim.legacy({ in: { e: id } })), id));
  assert.equal(Anim.EFFECT_IDS.length, 28);
  assert.deepEqual(Anim.EMPHASIS_IDS, ["pulse", "wiggle", "flicker", "rotate"]);
});

test("anim: an element's own animation wins, then ax.an, then the page animation", () => {
  const { d, pg } = design();
  const tx = byKind(d, "text"), sh = byKind(d, "shape"), bg = AX.background(d, pg);
  assert.equal(Anim.specOf(tx, null), null);
  sh.ax.an = "type";
  assert.deepEqual(Anim.specOf(sh, null), { in: { e: "typewriter" } });
  tx.ext = { anim: { in: { e: "neon" } } };
  assert.deepEqual(Anim.specOf(tx, { e: "fade" }), { in: { e: "neon" } });
  delete sh.ax.an;
  bg.ext = { pan: { e: "drift", d: "r" } };
  assert.deepEqual(Anim.pageAnim(d, pg), { e: "drift", d: "r" });
  assert.deepEqual(Anim.specOf(sh, Anim.pageAnim(d, pg)), { in: { e: "drift", d: "r" } });
  // only an exit of its own: still enters with the page animation
  sh.ext = { anim: { out: { e: "fade" } } };
  assert.deepEqual(Anim.specOf(sh, { e: "pop" }), { out: { e: "fade" }, in: { e: "pop" } });
  // the page background never animates
  assert.equal(Anim.specOf(bg, { e: "pop" }), null);
});

test("anim: an entrance moves from its side, then the element is as it is", () => {
  const { d, pg } = design();
  const sh = byKind(d, "shape");
  sh.ext = { anim: { in: { e: "pan", d: "l" } } };
  const pc = Anim.pageCtx(d, pg), sc = Anim.schedule([sh], pc.pan);
  assert.equal(sc[sh.id], 0.2);
  assert.deepEqual(Anim.stateAt(sh, sc[sh.id], 0.1, 1080, pc), { a: 0 });
  const mid = Anim.stateAt(sh, 0.2, 0.4, 1080, pc);
  assert.ok(mid.a > 0 && mid.a < 1);
  assert.ok(mid.dx < 0, "comes from the left");
  close(mid.dy || 0, 0);
  assert.equal(Anim.stateAt(sh, 0.2, 2, 1080, pc), null);
  // wipe from the right, a tumble turns, a blur blurs, spread is wide
  sh.ext.anim = { in: { e: "wipe", d: "r" } };
  assert.deepEqual(Object.keys(Anim.stateAt(sh, 0, 0.2, 1080, pc)).sort(), ["cd", "clip"]);
  assert.equal(Anim.stateAt(sh, 0, 0.2, 1080, pc).cd, "r");
  sh.ext.anim = { in: { e: "tumble" } };
  assert.ok(Anim.stateAt(sh, 0, 0.1, 1080, pc).rot < 0);
  sh.ext.anim = { in: { e: "blur" } };
  assert.ok(Anim.stateAt(sh, 0, 0.1, 1080, pc).blur > 0);
  sh.ext.anim = { in: { e: "flow" } };
  assert.equal(Anim.stateAt(sh, 0, 0.1, 1080, pc).box, 1);
  // speed ×2 takes half the time
  sh.ext.anim = { in: { e: "rise", sp: 2 } };
  close(Anim.partLen(sh, Anim.specOf(sh).in), 0.35);
});

test("anim: exits leave before the page ends or at their own time; emphasis keeps moving", () => {
  const { d, pg } = design();
  const sh = byKind(d, "shape"), bg = AX.background(d, pg);
  bg.ax.dur = 6;
  sh.ext = { anim: { out: { e: "fade" } } };
  const pc = Anim.pageCtx(d, pg);
  assert.equal(pc.dur, 6);
  assert.equal(Anim.stateAt(sh, 0, 3, 1080, pc), null);
  const q = Anim.stateAt(sh, 0, 6 - 0.35, 1080, pc);
  assert.ok(q.a > 0 && q.a < 1, "fading out");
  sh.ext.anim = { in: { e: "fade" }, t0: 1, t1: 3 };
  assert.deepEqual(Anim.stateAt(sh, 1, 0.5, 1080, pc), { a: 0 }, "not yet on the page");
  assert.deepEqual(Anim.stateAt(sh, 1, 3.2, 1080, pc), { a: 0 }, "gone at its end time");
  assert.equal(Anim.schedule([sh])[sh.id], 1);
  sh.ext.anim = { em: { e: "pulse" } };
  const s1 = Anim.stateAt(sh, 0, 0.35, 1080, pc), s2 = Anim.stateAt(sh, 0, 1.05, 1080, pc);
  assert.ok(s1.s > 1 && s2.s < 1, "pulses");
  sh.ext.anim = { em: { e: "rotate", sp: 2 } };
  close(Anim.stateAt(sh, 0, 1, 1080, pc).rot, 180);
  // the page lasts for its entrances and one round of an emphasis
  sh.ext.anim = { in: { e: "rise" }, em: { e: "wiggle" } };
  close(Anim.introLen([sh]), 0.2 + 0.7 + 0.8);
});

test("anim: text comes in by word and by letter; a typewriter types", () => {
  const { d, pg } = design();
  const tx = byKind(d, "text"), pc = Anim.pageCtx(d, pg);
  assert.deepEqual(Anim.units(tx, "word"), [5, 9, 15]);
  assert.deepEqual(Anim.units(tx, "char").length, 13);
  tx.ext = { anim: { in: { e: "ascend", by: "word" } } };
  const L = Anim.partLen(tx, Anim.specOf(tx).in);
  assert.ok(L > Anim.EFFECTS.ascend[0], "longer than one piece");
  assert.equal(Anim.stateAt(tx, 0, L * 0.1, 1080, pc).chars, 5);
  assert.equal(Anim.stateAt(tx, 0, L * 0.5, 1080, pc).chars, 9);
  tx.ext = { anim: { in: { e: "typewriter" } } };
  assert.equal(Anim.stateAt(tx, 0, 0, 1080, pc).chars, 0);
  assert.equal(Anim.stateAt(tx, 0, 2, 1080, pc), null);
});

test("anim: the animation survives normDoc, and older entrances still play", () => {
  const { d, pg } = design();
  const tx = byKind(d, "text");
  tx.ext = { anim: { in: { e: "stomp" }, out: { e: "pan", d: "r" } } };
  tx.ax.an = Anim.legacy(tx.ext.anim);
  AX.background(d, pg).ext = { pan: { e: "fade" } };
  const n = M.normDoc(d);
  const t2 = n.items.find((i) => i.id === tx.id);
  assert.deepEqual(t2.ext.anim, { in: { e: "stomp" }, out: { d: "r", e: "pan" } });
  assert.equal(t2.ax.an, "pop");
  assert.deepEqual(AX.background(n, pg).ext.pan, { e: "fade" });
  assert.equal(JSON.stringify(M.normDoc(n)), JSON.stringify(n));
  // the film is as long as its entrances need (old timeline API)
  const tl = Anim.timeline(n, M.pagesInOrder(n));
  assert.equal(tl.pages.length, 1);
  assert.equal(tl.total, Anim.DUR_DEF);
});

// ---- moving GIFs ----
function gifOf(w, h, frames) {
  return Gif.encode({ w, h, frames: frames.map((c) => ({ idx: new Uint8Array(w * h).fill(c), delay: 20 })) });
}
test("gif: frames, delays and the frame of a moment", () => {
  const b = gifOf(4, 3, [0, 215, 0]);
  assert.equal(G.isGif(b), true);
  assert.equal(G.frameCount(b), 3);
  const g = G.decode(b);
  assert.deepEqual([g.w, g.h, g.fw, g.fh, g.frames.length, g.dur], [4, 3, 4, 3, 3, 0.6]);
  assert.deepEqual(Array.from(g.frames[1].rgba.slice(0, 4)), [Gif.PALETTE[215 * 3], Gif.PALETTE[215 * 3 + 1], Gif.PALETTE[215 * 3 + 2], 255]);
  assert.deepEqual([G.frameAt(g, 0), G.frameAt(g, 0.25), G.frameAt(g, 0.45), G.frameAt(g, 0.65)], [0, 1, 2, 0], "loops");
  assert.equal(G.frameCount(gifOf(2, 2, [5])), 1, "a still GIF is a picture");
  assert.throws(() => G.decode(new Uint8Array([1, 2, 3])), /gif/);
  assert.throws(() => G.decode(b.slice(0, 40)));
  assert.equal(G.frameCount(new Uint8Array(20)), 0);
});

test("gif: a long GIF is kept smaller, never more than the budget", () => {
  const b = gifOf(400, 400, Array.from({ length: 220 }, (_, i) => i % 200));
  const g = G.decode(b);
  assert.equal(g.frames.length, 220);
  assert.ok(g.fw < 400 && g.fw * g.fh * 220 <= 32 * 1024 * 1024 * 1.01);
  assert.equal(g.frames[0].rgba.length, g.fw * g.fh * 4);
});

test("clips: a moving GIF is a file id of its own, listed with the design's clips", () => {
  assert.equal(CL.isGif(H + ".gif"), true);
  assert.equal(CL.isGif(H + ".png"), false);
  assert.equal(CL.isVideo(H + ".gif"), false);
  assert.deepEqual(Object.keys(CL.idsIn("x " + H + ".gif y")), [H + ".gif"]);
  const { d, pg } = design();
  AX.addItem(d, pg, { k: "photo", a: "b".repeat(64) + ".png", iw: 10, ih: 10, x: 0, y: 0, w: 10, h: 10, ext: { gif: H + ".gif" } }, 9);
  assert.deepEqual(AX.clipIds(M.normDoc(d)), [H + ".gif"]);
});

// ---- PowerPoint from Canva: videos, sound, GIFs, transitions ----
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function makeZip(files) {
  const locals = [], centrals = [];
  let off = 0;
  Object.keys(files).forEach((name) => {
    const raw = Buffer.isBuffer(files[name]) ? files[name] : Buffer.from(files[name], "utf8");
    const nm = Buffer.from(name, "utf8");
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4);
    lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(raw.length, 18); lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nm.length, 26);
    locals.push(lh, nm, raw);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt32LE(crc32(raw), 16); ch.writeUInt32LE(raw.length, 20); ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    centrals.push(ch, nm);
    off += 30 + nm.length + raw.length;
  });
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  void zlib;
  return new Uint8Array(Buffer.concat(locals.concat([cd, end])));
}
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const E = (pt) => Math.round(pt * 12700);
const xfrm = (x, y, w, h) => `<a:xfrm><a:off x="${E(x)}" y="${E(y)}"/><a:ext cx="${E(w)}" cy="${E(h)}"/></a:xfrm>`;
const rels = (list) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((r) => `<Relationship Id="${r[0]}" Type="http://x/${r[1]}" Target="${r[2]}"/>`).join("")}</Relationships>`;
// as Canva writes them: a video with its poster and trim, a sound with
// a speaker icon, a GIF, a push transition with a slide time
function canvaDeck() {
  const media = (id, kind, tag, extra) => `<p:pic><p:nvPicPr><p:cNvPr name="Picture ${id}" id="${id}"><a:hlinkClick action="ppaction://media"/></p:cNvPr><p:cNvPicPr/><p:nvPr><a:${tag} r:link="rIdL${id}"/><p:extLst><p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}"><p14:media r:embed="rIdM${id}" xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">${extra || ""}</p14:media></p:ext></p:extLst></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="rIdP"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(60, 60, 600, 400)}<a:prstGeom prst="rect"/></p:spPr></p:pic>`;
  const gif = `<p:pic><p:nvPicPr><p:cNvPr name="g" id="9"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdG"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(500, 500, 200, 200)}</p:spPr></p:pic>`;
  const slide = (body, tr) => `<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${body}</p:spTree></p:cSld>${tr || ""}<p:timing><p:tnLst/></p:timing></p:sld>`;
  const files = {
    "ppt/presentation.xml": `<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="${E(810)}" cy="${E(810)}"/></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": rels([["rId1", "slide", "slides/slide1.xml"], ["rId2", "slide", "slides/slide2.xml"]]),
    "ppt/slides/slide1.xml": slide(media(2, "video", "videoFile", '<p14:trim st="1500.0000" end="2000.0000"/>') + gif + media(13, "sound", "audioFile", '<p14:fade out="1500"/>')),
    "ppt/slides/slide2.xml": slide("", '<p:transition spd="slow" advTm="7000"><p:push dir="l"/></p:transition>'),
    "ppt/media/poster.jpeg": Buffer.from([255, 216, 255]),
    "ppt/media/clip.mp4": Buffer.from("video"),
    "ppt/media/song.m4a": Buffer.from("sound"),
    "ppt/media/anim.gif": Buffer.from(gifOf(2, 2, [1, 2]))
  };
  const r1 = [["rIdP", "image", "../media/poster.jpeg"], ["rIdG", "image", "../media/anim.gif"],
    ["rIdL2", "video", "../media/clip.mp4"], ["rIdM2", "media", "../media/clip.mp4"],
    ["rIdL13", "audio", "../media/song.m4a"], ["rIdM13", "media", "../media/song.m4a"]];
  files["ppt/slides/_rels/slide1.xml.rels"] = rels(r1);
  files["ppt/slides/_rels/slide2.xml.rels"] = rels([]);
  return makeZip(files);
}

test("pptx: Canva's videos, slide sound, GIFs and transitions come over", async () => {
  const plan = await P.parse(Z.open(canvaDeck()), "Reel");
  assert.deepEqual(Object.keys(plan.clips).sort(), ["ppt/media/clip.mp4", "ppt/media/song.m4a"]);
  assert.ok(plan.media["ppt/media/anim.gif"] && plan.media["ppt/media/poster.jpeg"]);
  const [p1, p2] = plan.pages;
  assert.equal(p1.sound, "ppt/media/song.m4a");
  assert.equal(p1.items.length, 2, "the speaker icon stays out");
  const v = p1.items.find((i) => i.clip);
  assert.deepEqual([v.clip, v.vs, v.trimEnd, v.img], ["ppt/media/clip.mp4", 1.5, 2, "ppt/media/poster.jpeg"]);
  assert.deepEqual([p2.ptr, p2.dur], ["push", 7]);
  assert.equal(p1.ptr, undefined);

  const assets = {
    "ppt/media/poster.jpeg": { id: "c".repeat(64) + ".jpg", w: 1280, h: 720 },
    "ppt/media/anim.gif": { id: "d".repeat(64) + ".png", w: 2, h: 2, gif: "e".repeat(64) + ".gif" },
    "ppt/media/clip.mp4": { clip: "f".repeat(64) + ".mp4", dur: 12 },
    "ppt/media/song.m4a": { clip: "9".repeat(64) + ".m4a", dur: 60 }
  };
  const { doc } = P.build(plan, assets, 9, {});
  const pages = M.pagesInOrder(doc);
  const vid = doc.items.find((i) => i.ax && i.ax.vid);
  assert.deepEqual([vid.ax.vid, vid.ax.vs, vid.ax.ve], ["f".repeat(64) + ".mp4", 1.5, 10]);
  const g = doc.items.find((i) => i.ext && i.ext.gif);
  assert.equal(g.ext.gif, "e".repeat(64) + ".gif");
  assert.equal(AX.background(doc, pages[0].id).ax.au, "9".repeat(64) + ".m4a");
  const bg2 = AX.background(doc, pages[1].id);
  assert.deepEqual([bg2.ax.ptr, bg2.ax.dur], ["push", 7]);
  assert.deepEqual(AX.clipIds(doc), ["9".repeat(64) + ".m4a", "e".repeat(64) + ".gif", "f".repeat(64) + ".mp4"]);
  // the 810 pt slide is 1080 px again (CV-0)
  assert.deepEqual([doc.setup.w, doc.setup.h], [1080, 1080]);
  // without the clips (no orOS disk) the poster still shows
  const { doc: d2 } = P.build(plan, { "ppt/media/poster.jpeg": assets["ppt/media/poster.jpeg"] }, 9, {});
  assert.ok(d2.items.some((i) => i.ax && i.ax.k === "photo" && !i.ax.vid));
});

test("CV-A: wired into Atelier, strings in EN, EL and DE", () => {
  const html = fs.readFileSync(path.join(ROOT, "atelier/index.html"), "utf8");
  assert.ok(html.indexOf('src="gif.js') < html.indexOf('src="gifdec.js') && html.indexOf('src="gifdec.js') < html.indexOf('src="video.js'));
  const motion = fs.readFileSync(path.join(ROOT, "atelier/motion.js"), "utf8");
  assert.match(motion, /writeAnim/);
  assert.match(fs.readFileSync(path.join(ROOT, "atelier/draw.js"), "utf8"), /Anim\.pageCtx/);
  const core = fs.readFileSync(path.join(ROOT, "atelier/core.js"), "utf8");
  const de = fs.readFileSync(path.join(ROOT, "i18n/de/atelier.js"), "utf8");
  const keys = Anim.EFFECT_IDS.map((e) => "an.e." + e).concat(Anim.EMPHASIS_IDS.map((e) => "an.m." + e),
    ["an.tab.in", "an.tab.out", "an.tab.em", "an.dir", "an.speed", "an.by", "an.t0", "an.t1", "an.pageAnim", "an.pageAnimHint", "fm.gif"],
    Anim.DIRS.map((d) => "an.dir." + d), Anim.BYS.map((b) => "an.by." + b));
  keys.forEach((k) => {
    assert.equal(core.split('"' + k + '"').length - 1, 2, k + " in EN and EL");
    assert.ok(de.includes('"' + k + '"'), k + " in DE");
  });
});

test("pptx: a design Canva shrank past 56 in gets its own size back from its PDF", () => {
  // a 11520 × 3456 px banner: Canva's PDF is 8640 × 2592 pt, its slide
  // is cut to 4025 pt wide with the design scaled into it, centred
  const k = 4025 / 8640, by = (2592 - 2592 * k) / 2;
  const plan = { w: 4025, h: 2592, cap: { w: 4025, h: 2592 }, name: "Banner", media: {}, clips: {}, svgs: {}, fonts: [], skipped: 0, approx: 0,
    pages: [{ bg: null, items: [{ k: "shape", shp: "rect", fc: "#ff0000", x: 2012.5 - 100 * k, y: by + 1296 * k - 50 * k, w: 200 * k, h: 100 * k, rot: 0 }] }] };
  const { doc } = P.build(plan, {}, 9, {}, { real: { w: 8640, h: 2592 } });
  assert.deepEqual([doc.setup.w, doc.setup.h], [11520, 3456]);
  const sh = doc.items.find((i) => i.ax && i.ax.k === "shape" && !i.ax.bg);
  // centred as in the PDF, at 4/3 px per pt
  close(Math.round(sh.x + sh.w / 2), 5760); close(Math.round(sh.y + sh.h / 2), 1728);
  close(Math.round(sh.w), 267); close(Math.round(sh.h), 133);
  // without the PDF it stays as the slide (nothing guessed)
  assert.equal(P.rebox({ cap: null }, { w: 1, h: 1 }), 0);
});
