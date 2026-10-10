// Atelier video and sound (wave 3C): clip ids and types, timing of
// video elements and page sounds (atelier/clips.js) and the fields
// atelier/ax.js keeps for them.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CL = require(path.join(ROOT, "atelier/clips.js"));
const AX = require(path.join(ROOT, "atelier/ax.js"));
const M = require(path.join(ROOT, "designkit/model.js"));

const H = "ab".repeat(32);
const bytes = (...p) => { const b = new Uint8Array(16); let i = 0; p.forEach((x) => { (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : x).forEach((v) => { b[i++] = v; }); }); return b; };

test("clips: type from the first bytes, never the name", () => {
  assert.equal(CL.sniff(bytes([0x1a, 0x45, 0xdf, 0xa3])), "webm");
  assert.equal(CL.sniff(bytes([0, 0, 0, 0x20], "ftypisom")), "mp4");
  assert.equal(CL.sniff(bytes("OggS")), "ogg");
  assert.equal(CL.sniff(bytes("RIFF", [0, 0, 0, 0], "WAVE")), "wav");
  assert.equal(CL.sniff(bytes("ID3")), "mp3");
  assert.equal(CL.sniff(bytes([0xff, 0xfb, 0x90])), "mp3");
  assert.equal(CL.sniff(bytes("<html><script>")), "");
  assert.equal(CL.sniff(bytes([0x89], "PNG")), "");
  assert.equal(CL.sniff(new Uint8Array(4)), "");
  assert.equal(CL.extFor("webm", true), "webm");
  assert.equal(CL.extFor("webm", false), "weba");
  assert.equal(CL.extFor("mp4", false), "m4a");
  assert.equal(CL.extFor("mp3", true), "");                 // a picture in an MP3 is not a video
  assert.ok(CL.isVideo(H + ".mp4") && !CL.isVideo(H + ".mp3") && !CL.isVideo("../" + H + ".mp4"));
  assert.ok(CL.isSound(H + ".weba") && !CL.isSound(H + ".webm") && !CL.isSound(H.toUpperCase() + ".mp3"));
  const real = path.join(ROOT, "vendor");                     // no media in the repo: just make sure nothing throws on fonts
  if (fs.existsSync(real)) assert.equal(CL.sniff(new Uint8Array(fs.readFileSync(path.join(real, "noto", "NotoSans-Regular.ttf")).slice(0, 16))), "");
});

test("clips: where a video element is", () => {
  assert.equal(CL.videoTime({}, 3, 10), 3);
  assert.equal(CL.videoTime({}, 13, 10), 3);                  // loops
  assert.equal(CL.videoTime({ vs: 2, ve: 4 }, 3, 10), 3);       // 2 + (3 % 2)
  assert.ok(Math.abs(CL.videoTime({ vs: 2, ve: 4, nl: 1 }, 9, 10) - 3.98) < 1e-9);   // holds the last frame
  assert.equal(CL.videoTime({ vs: 20 }, 1, 10) < 10, true);    // trim past the end is clamped
  assert.equal(CL.videoTime({}, 2.5, 0), 2.5);                 // length unknown: runs on
});

test("clips: page sounds continue across pages that share them", () => {
  const a = H + ".mp3", b = "cd".repeat(32) + ".ogg";
  const plan = CL.soundPlan([{ au: a, dur: 5, ao: 2 }, { au: a, dur: 3, ao: 9 }, { dur: 4 }, { au: a, dur: 2 }, { au: b, av: 40, dur: 2 }]);
  assert.deepEqual(plan.map((p) => p && p.from), [2, 7, null, 0, 0]);
  assert.equal(plan[4].vol, 40);
  assert.equal(CL.soundTime(2, 9, 10), 1);
  assert.equal(CL.soundTime(0, 3, 0), 3);
});

test("ax: video and sound fields are kept canonical, junk is dropped", () => {
  const v = AX.normAx({ k: "photo", vid: H + ".webm", vs: 1.234, ve: 1.3, mu: true, vol: 100, nl: 0, au: H + ".mp3" }, { t: "img" });
  assert.deepEqual(v, { k: "photo", vid: H + ".webm", vs: 1.23, mu: 1 });     // ve too close to vs, vol default, au only on a background
  assert.deepEqual(AX.normAx({ k: "photo", vid: "javascript:alert(1)", vs: 3 }, { t: "img" }), { k: "photo" });
  assert.deepEqual(AX.normAx({ k: "shape", vid: H + ".mp4" }, { t: "rect" }), { k: "shape", shp: "rect" });
  const bg = AX.normAx({ k: "shape", bg: 1, au: H + ".m4a", av: 55.4, ao: 12.345 }, { t: "rect" });
  assert.equal(bg.au, H + ".m4a"); assert.equal(bg.av, 55); assert.equal(bg.ao, 12.35);
  assert.equal(AX.normAx({ k: "shape", bg: 1, au: H + ".mp4" }, { t: "rect" }).au, undefined);   // a video is not a page sound
});

test("ax: clipIds lists a design's videos and sounds", () => {
  const d = AX.newDesign({ name: "Clips", w: 1000, h: 500 }, 1000);
  const pg = d.pages[0].id;
  AX.addItem(d, pg, { k: "photo", a: "ef".repeat(32) + ".jpg", iw: 640, ih: 360, vid: H + ".webm", w: 640, h: 360 }, 1001);
  AX.background(d, pg).ax.au = "cd".repeat(32) + ".mp3";
  const n = M.normDoc(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(AX.clipIds(n), [H + ".webm", "cd".repeat(32) + ".mp3"]);
  assert.deepEqual(AX.assetIds(n), ["ef".repeat(32) + ".jpg"]);
});

test("clips: idsIn finds every file id a saved text names (delete check)", () => {
  const saved = JSON.stringify({ docs: [{ items: [{ a: "ef".repeat(32) + ".jpg", ax: { vid: H + ".webm" } }] }], x: "cd".repeat(32) + ".mp3" });
  const used = CL.idsIn(saved, CL.idsIn("logo " + "ab".repeat(32) + ".png"));
  assert.deepEqual(Object.keys(used).sort(), ["ab".repeat(32) + ".png", "cd".repeat(32) + ".mp3", H + ".webm", "ef".repeat(32) + ".jpg"].sort());
  assert.deepEqual(CL.idsIn(null), {});
  assert.deepEqual(CL.idsIn(H + ".txt " + H.slice(1) + ".png"), {});
  assert.equal(CL.isFileId(H + ".png"), true);
  assert.equal(CL.isFileId(H + ".m4a"), true);
  assert.equal(CL.isFileId(H + ".gif"), false);
  assert.equal(CL.isFileId("x" + H + ".png"), false);
});
