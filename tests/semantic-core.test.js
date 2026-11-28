// semantic-core.js (search by meaning, MEANING-1): normalizing, the
// XLM-R Unigram tokenizer on a tiny vocab, pooling, packing, ranking.
// The real tokenizer.json was checked against Hugging Face tokenizers
// 0.23 on Greek, English, German, CJK and emoji texts (same ids; only
// trailing spaces differ, which orOS trims).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "semantic-core.js"));

const SP = "▁";
function tok(extra) {
  const vocab = [["<s>", 0], ["<pad>", 0], ["</s>", 0], ["<unk>", 0],
    [SP, -2], [SP + "κα", -3], ["λη", -3], ["μέρα", -4], [SP + "καλη", -3.5], [SP + "καλημέρα", -5],
    ["κ", -6], ["α", -6], ["λ", -6], ["η", -6], ["μ", -6], ["έ", -6], ["ρ", -6],
    [SP + "hello", -4], ["!", -3], ["<mask>", 0]].concat(extra || []);
  return C.makeTokenizer({
    model: { type: "Unigram", unk_id: 3, vocab },
    added_tokens: [["<s>", 0], ["<pad>", 1], ["</s>", 2], ["<unk>", 3], ["<mask>", vocab.length - 1 - (extra ? extra.length : 0)]]
      .map(([content, id]) => ({ content, id }))
  });
}

test("normalize: NFKC, no control characters, single spaces", () => {
  assert.equal(C.normalize("  ﬁ​ne\t\n ＡＢ  ①  "), "fine AB 1");
  assert.equal(C.normalize(null), "");
});

test("tokenizer: best Unigram split, <s> … </s>", () => {
  const T = tok();
  // ▁καλημέρα (-5) beats ▁καλη + μέρα (-7.5) and ▁κα + λη + μέρα (-10)
  assert.deepEqual(T.encode("καλημέρα"), [0, 9, 2]);
  assert.deepEqual(T.encode("hello!"), [0, 17, 18, 2]);
});

test("tokenizer: unknown characters are one fused <unk>; words split on spaces", () => {
  const T = tok();
  assert.deepEqual(T.encode("hello ΩΩ"), [0, 17, 4, 3, 2]);
  assert.deepEqual(T.encode(""), [0, 2]);
  const long = T.encode(Array(50).fill("hello").join(" "), 10);
  assert.equal(long.length, 10);
  assert.equal(long[0], 0);
  assert.equal(long[9], 2);
});

test("tokenizer refuses a file that is not a Unigram tokenizer", () => {
  assert.throws(() => C.makeTokenizer({ model: { type: "BPE" } }));
});

test("pool: mean over real tokens, unit length", () => {
  // 2 rows × 3 tokens × 2 dims; row 0 has 2 real tokens, row 1 has 3
  const h = new Float32Array([1, 0, 3, 0, 99, 99, 0, 2, 0, 2, 0, 2]);
  const v = C.pool(h, [2, 3], 2, 3, 2);
  assert.deepEqual(Array.from(v[0]), [1, 0]);
  assert.deepEqual(Array.from(v[1]), [0, 1]);
});

test("pack / score: int8 keeps the cosine", () => {
  const a = new Float32Array(384).map((_, i) => Math.sin(i));
  const n = Math.hypot(...a);
  const u = a.map((x) => x / n);
  const p = C.pack(u);
  assert.ok(p instanceof Int8Array && p.length === 384);
  assert.ok(Math.abs(C.score(u, p) - 1) < 0.005);
  assert.ok(Math.abs(C.unpack(p)[5] - u[5]) < 0.01);
});

test("passages: prefix, title first, at most 3 pieces cut at word ends", () => {
  assert.deepEqual(C.passages({ title: "ΔΕΗ", text: "Λογαριασμός ρεύματος" }), ["passage: ΔΕΗ. Λογαριασμός ρεύματος"]);
  const long = C.passages({ title: "T", text: Array(1200).fill("λέξη").join(" ") });
  assert.equal(long.length, 3);
  long.forEach((p) => { assert.ok(p.startsWith("passage: T. ")); assert.ok(!/ λέ$/.test(p)); });
  assert.deepEqual(C.passages({ title: "", text: "" }), []);
  assert.equal(C.query("  τι  ώρα "), "query: τι ώρα");
});

test("hash: stable, changes with the text", () => {
  assert.equal(C.hash("abc"), C.hash("abc"));
  assert.notEqual(C.hash("abc"), C.hash("abd"));
  assert.match(C.hash("x"), /^[0-9a-f]{8}$/);
});

test("rank: floor, best passage counts, within spread of the best", () => {
  const unit = (i) => { const v = new Float32Array(384); v[i] = 1; return v; };
  const mix = (a, b, w) => { const v = new Float32Array(384); v[a] = w; v[b] = Math.sqrt(1 - w * w); return v; };
  const q = unit(0);
  const entries = [
    { k: "notes\na", v: [C.pack(mix(0, 1, 0.95))] },
    { k: "notes\nb", v: [C.pack(unit(2)), C.pack(mix(0, 3, 0.93))] },   // second passage counts
    { k: "notes\nc", v: [C.pack(mix(0, 1, 0.85))] },                      // over the floor, outside the spread
    { k: "notes\nd", v: [C.pack(unit(4))] }                                // unrelated
  ];
  const r = C.rank(q, entries);
  assert.deepEqual(r.map((x) => x.k), ["notes\na", "notes\nb"]);
  assert.deepEqual(C.rank(q, entries, { spread: 1 }).map((x) => x.k), ["notes\na", "notes\nb", "notes\nc"]);
  assert.deepEqual(C.rank(unit(9), entries), []);
});

test("rank: with 20+ items a hit must stand out from the rest", () => {
  const q = new Float32Array(384); q[0] = 1;
  const at = (w) => { const v = new Float32Array(384); v[0] = w; v[1] = Math.sqrt(1 - w * w); return C.pack(v); };
  const entries = Array.from({ length: 30 }, (_, i) => ({ k: "n\n" + i, v: [at(0.8 + (i % 3) * 0.005)] }));
  assert.deepEqual(C.rank(q, entries), []);                // all alike: nothing stands out
  entries.push({ k: "n\nbest", v: [at(0.9)] });
  assert.deepEqual(C.rank(q, entries).map((x) => x.k), ["n\nbest"]);
});
