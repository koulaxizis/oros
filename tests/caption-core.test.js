// Image descriptions (caption/core.js, CAPTION v1): Florence-2's
// picture → tensor step, the greedy step, ids → text and tidy().
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../caption/core.js");

test("prompts: Florence's fixed task ids, <s> first and </s> last", () => {
  // Made once with the model's BART tokenizer (vocab.json + merges.txt of
  // onnx-community/Florence-2-base-ft): "What does the image describe?"
  assert.deepEqual(Array.from(C.PROMPTS.short), [0, 2264, 473, 5, 2274, 6190, 116, 2]);
  assert.deepEqual(Array.from(C.PROMPTS.detail), [0, 47066, 21700, 11, 4617, 99, 16, 2343, 11, 5, 2274, 4, 2]);
  assert.ok(C.MAX_NEW.short > 10 && C.MAX_NEW.detail > C.MAX_NEW.short);
});

test("pixels: CHW planes with ImageNet mean and std", () => {
  const rgba = new Uint8ClampedArray([255, 0, 128, 255, 0, 255, 0, 255]);
  const px = C.pixels(rgba, 2, 1);
  assert.equal(px.length, 6);
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, a + " vs " + b);
  near(px[0], (1 - 0.485) / 0.229);            // R of pixel 0
  near(px[1], (0 - 0.485) / 0.229);            // R of pixel 1
  near(px[2], (0 - 0.456) / 0.224);            // G of pixel 0
  near(px[5], (0 - 0.406) / 0.225);            // B of pixel 1
});

test("pick: the first token is forced to <s>, then the best one", () => {
  const lg = new Float32Array([0, 0, 0, 0, 5, 1]);
  assert.equal(C.pick(lg, [2], 0), 0);
  assert.equal(C.pick(lg, [2, 0], 1), 4);
});

test("pick: a token that repeats a 3-gram is skipped (no_repeat_ngram_size 3)", () => {
  const lg = new Float32Array([0, 0, 0, 0, 9, 8, 1]);
  // gen ends with 5, 6; "5 6 4" was already said, so 4 is out.
  const gen = [2, 0, 5, 6, 4, 5, 6];
  assert.deepEqual(Object.keys(C.banned(gen)), ["4"]);
  assert.equal(C.pick(lg, gen, 7), 5);
});

test("decoder: byte-level BPE back to text, special and task tokens left out", () => {
  // "Ġ" is GPT-2's byte table for a space; "Ã©" is the two UTF-8 bytes of "é".
  const vocab = { "<s>": 0, "<pad>": 1, "</s>": 2, "<unk>": 3, "A": 10, "Ġcaf": 11, "Ã©": 12, "Ġon": 13, "Ġthe": 14, "Ġbeach": 15, ".": 16, "<loc_1>": 17 };
  const d = C.decoder(vocab);
  assert.equal(d.text([2, 0, 10, 11, 12, 17, 13, 14, 15, 16, 2]), "A café on the beach.");
});

test("tidy: Florence's openings cut, capital first, full stop last", () => {
  assert.equal(C.tidy("In this image we can see a dog on the grass"), "A dog on the grass.");
  assert.equal(C.tidy("The image shows two people , smiling"), "Two people, smiling.");
  assert.equal(C.tidy("  A colorful image of a house and a sun.  "), "A colorful image of a house and a sun.");
  assert.equal(C.tidy("ένα σκυλί στην παραλία"), "Ένα σκυλί στην παραλία.");
  assert.equal(C.tidy(""), "");
  assert.equal(C.tidy("In this image"), "In this image.");
});
