// DICT-2: dictation helpers (montage/listen.js) and the Whisper loop guard (asr.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../montage/listen.js");
const A = require("../montage/asr.js");

test("Resampler: 48 kHz → 16 kHz, block by block, no drift", () => {
  const r = new L.Resampler(48000);
  let n = 0;
  for (let b = 0; b < 100; b++) {
    const x = new Float32Array(4096).fill(0.5);
    const y = r.push(x);
    y.forEach((v) => assert.ok(Math.abs(v - 0.5) < 1e-6));
    n += y.length;
  }
  assert.ok(Math.abs(n - 409600 / 3) <= 1, String(n));
  // 44.1 kHz: a fractional step
  const r2 = new L.Resampler(44100);
  let m = 0;
  for (let b = 0; b < 50; b++) m += r2.push(new Float32Array(4410)).length;
  assert.ok(Math.abs(m - 80000) <= 1, String(m));
});

test("joinText: one space between phrases, none after an opening mark", () => {
  assert.equal(L.joinText("", "Γεια"), "Γεια");
  assert.equal(L.joinText("Γεια.", " σου "), "Γεια. σου");
  assert.equal(L.joinText("«", "Γεια"), "«Γεια");
  assert.equal(L.joinText("a", ""), "a");
});

test("loopAt: a stuck decoder is cut after the first copy", () => {
  assert.equal(A.loopAt([1, 2, 3]), -1);
  assert.equal(A.loopAt([5, 7, 7, 7]), -1);           // a word three times can be real
  assert.equal(A.loopAt([5, 7, 7, 7, 7]), 2);         // four times is not
  assert.equal(A.loopAt([1, 8, 9, 8, 9, 8, 9]), 3);   // "πως πως πως" as two tokens each
  assert.equal(A.loopAt([1, 2, 3, 4, 2, 3, 4, 2, 3, 4]), 4);
  assert.equal(A.loopAt([1, 2, 3, 4, 2, 3, 4]), -1);
});
