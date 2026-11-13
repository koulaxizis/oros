// Writer book translation, machine suggestions (writer/catmt.js, WR-CAT
// T5) with a fake OrosTranslate: the open segment and the next empty
// ones in one call, the cache, glossary terms sent along, fill drafts,
// cancel, the AI path, errors.
// Run: node --test tests/

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const MT = require("../writer/catmt.js");
const C = require("../writer/catcore.js");
const QA = require("../writer/catqa.js");

function fake(opts) {
  opts = opts || {};
  const calls = [];
  return {
    calls,
    ai: { on: () => !!opts.ai },
    status: (from, to) => Promise.resolve(opts.noModel ? { ok: false, legs: null, need: [], mb: 0 } : { ok: !opts.need, legs: [from + "-" + to], need: opts.need ? [from + "-" + to, "runtime"] : [], mb: opts.need ? 18 : 0 }),
    translateMany(list, o) {
      calls.push({ list: list.slice(), o });
      if (opts.fail) return Promise.reject(Object.assign(new Error("x"), { code: "not-installed" }));
      if (o.cancelled && o.cancelled()) return Promise.reject(Object.assign(new Error("c"), { code: "cancelled" }));
      return Promise.resolve(list.map(s => ({ text: "EL:" + s, engine: opts.ai ? "ai" : "bergamot", tagsOk: !/⟦2/.test(s), via: opts.ai ? "Claude" : undefined })));
    }
  };
}
const src = C.extract({ html: "<p>The <b>sea</b> was calm. The old man slept.</p><p>Santiago dreamt.</p><p>Lions on the beach.</p><p>1, 2.</p>" }, "en");

test("mt: the open segment and the next empty ones go together; the cache answers after", async () => {
  const e = fake(), ctl = new MT.Ctl(e, "en", "el");
  const terms = new QA.Terms([{ [QA.keyOf("en", "el", "sea")]: ["sea", "θάλασσα", "", "", 1, 0] }], "en", "el");
  const rows = { 2: ["Ο Σαντιάγο ονειρευόταν.", 2, 1] };
  const r = await ctl.suggest(src, rows, 0, terms);
  assert.deepEqual(r, { text: "EL:The ⟦1⟧sea⟦/1⟧ was calm.", engine: "bergamot", tagsOk: true });
  assert.equal(e.calls.length, 1);
  assert.deepEqual(e.calls[0].list, ["The ⟦1⟧sea⟦/1⟧ was calm.", "The old man slept.", "Lions on the beach.", "1, 2."]);   // 2 is done
  assert.deepEqual(e.calls[0].o.terms, [{ src: "sea", tgt: "θάλασσα" }]);
  assert.equal(e.calls[0].o.engine, "auto");
  assert.equal((await ctl.suggest(src, rows, 1, terms)).text, "EL:The old man slept.");
  assert.equal(e.calls.length, 1);                       // from the cache
  assert.equal(ctl.cached(src, 3).text, "EL:Lions on the beach.");
  // two asks at once share one call
  const ctl2 = new MT.Ctl(fake(), "en", "el");
  const [a, b] = await Promise.all([ctl2.suggest(src, {}, 0), ctl2.suggest(src, {}, 0)]);
  assert.equal(a, b);
});

test("mt: status, the AI path, a failure is passed on and not cached", async () => {
  assert.deepEqual(await new MT.Ctl(fake({ need: true }), "en", "el").status(), { ok: false, legs: ["en-el"], need: ["en-el", "runtime"], mb: 18, ai: false });
  assert.equal((await new MT.Ctl(fake({ noModel: true }), "en", "xx").status()).ok, false);
  assert.equal((await new MT.Ctl(fake({ noModel: true, ai: true }), "en", "xx").status()).ok, true);
  const ai = await new MT.Ctl(fake({ ai: true }), "en", "el").suggest(src, {}, 0);
  assert.deepEqual([ai.engine, ai.via], ["ai", "Claude"]);
  const bad = new MT.Ctl(fake({ fail: true }), "en", "el");
  await assert.rejects(bad.suggest(src, {}, 0), e => e.code === "not-installed");
  assert.equal(bad.cached(src, 0), null);
  assert.throws(() => new MT.Ctl(null, "en", "el"), /engine/);
});

test("mt: fill writes only empty segments with words, in batches, and stops when asked", async () => {
  const e = fake(), ctl = new MT.Ctl(e, "en", "el");
  const rows = { 1: ["Ο γέρος κοιμόταν.", 1, 1], 2: ["", 2, 1] };     // a draft, a join
  assert.equal(ctl.count(src, rows), 2);                // "1, 2." has no words
  const seen = [];
  const out = await ctl.fill(src, rows, { progress: (d, n) => seen.push([d, n]) });
  assert.deepEqual(out, { 0: "EL:The ⟦1⟧sea⟦/1⟧ was calm.", 3: "EL:Lions on the beach." });
  assert.deepEqual(seen, [[2, 2]]);
  let stop = false;
  const ctl2 = new MT.Ctl(fake(), "en", "el");
  stop = true;
  await assert.rejects(ctl2.fill(src, {}, { cancelled: () => stop }), e => e.code === "cancelled");
});
