// AS-FB: an online service answers while the local server can't be
// reached (another device, server off), and the Assistant goes back
// to the local model as soon as it answers again.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "assistant/core.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("fallback: only online providers can stand in", () => {
  ["anthropic", "openai", "groq", "openrouter", "mistral"].forEach((p) => assert.equal(C.fbOk(p), true, p));
  ["local", "webllm", "browser", "nope", "", undefined].forEach((p) => assert.equal(C.fbOk(p), false, String(p)));
});

test("fallback: used only when the chosen provider is a local server", () => {
  assert.equal(C.fbFor({ prov: "local", fb: "groq" }), "groq");
  assert.equal(C.fbFor({ prov: "local", fb: "" }), "");
  assert.equal(C.fbFor({ prov: "openai", fb: "groq" }), "");
  assert.equal(C.fbFor({ prov: "webllm", fb: "groq" }), "");
  assert.equal(C.fbFor({ prov: "local", fb: "webllm" }), "");
  assert.equal(C.fbFor(null), "");
});

test("fallback: the choice syncs, bad values are dropped, merge is symmetric", () => {
  assert.equal(C.emptyData().set.fb, "");
  assert.equal(C.mergeAssist({ set: { m: 2, prov: "local", fb: "anthropic" } }, null).set.fb, "anthropic");
  assert.equal(C.mergeAssist({ set: { m: 2, prov: "local", fb: "local" } }, null).set.fb, "");
  assert.equal(C.mergeAssist({ set: { m: 2, prov: "local", fb: "<x>" } }, null).set.fb, "");
  const a = { set: { m: 5, prov: "local", fb: "groq" } }, b = { set: { m: 4, prov: "local", fb: "openai" } };
  assert.deepEqual(C.mergeAssist(a, b), C.mergeAssist(b, a));
  assert.equal(C.mergeAssist(a, b).set.fb, "groq");
});

test("fallback: a probe result is kept a short while, longer when it answered", () => {
  const base = "http://localhost:11434/v1";
  assert.equal(C.probeFresh(null, base, 1000), null);
  assert.equal(C.probeFresh({ base: base, ok: true, at: 1000 }, base, 1000 + C.PROBE_UP - 1), true);
  assert.equal(C.probeFresh({ base: base, ok: true, at: 1000 }, base, 1000 + C.PROBE_UP), null);
  assert.equal(C.probeFresh({ base: base, ok: false, at: 1000 }, base, 1000 + C.PROBE_DOWN - 1), false);
  assert.equal(C.probeFresh({ base: base, ok: false, at: 1000 }, base, 1000 + C.PROBE_DOWN), null);
  assert.equal(C.probeFresh({ base: "http://localhost:1234/v1", ok: true, at: 1000 }, base, 1001), null);
  assert.ok(C.PROBE_DOWN < C.PROBE_UP && C.PROBE_MS <= 2000);
});

test("fallback: strings in EN, EL and DE, and help in EN and EL", () => {
  const js = read("assistant/assistant.js"), de = read("i18n/de/assistant.js");
  ["set.fb", "set.fbOff", "set.fbHint", "set.fbNoKey", "note.fb", "note.fbBack"].forEach((k) => {
    assert.equal(js.split('"' + k + '":').length - 1, 2, k + ": EN + EL");
    assert.equal(de.split('"' + k + '":').length - 1, 1, k + ": DE");
  });
  assert.match(read("assistant/help.en.txt"), /If the local model can't be reached, use/);
  assert.match(read("assistant/help.el.txt"), /Αν δεν βρεθεί το τοπικό μοντέλο, χρησιμοποίησε/);
});

test("fallback: an online stand-in asks first even for apps set to Always", () => {
  const js = read("assistant/assistant.js");
  assert.match(js, /if \(standIn\(\) && a\.perm === "always"\) a\.perm = "ask";/);
  assert.match(js, /function standIn\(\) \{ return !!fbUse && C\.isOnline\(fbUse\) && !C\.isOnline\(data\.set\.prov\); \}/);
  assert.match(js, /function curProv\(\) \{ return fbUse \|\| data\.set\.prov; \}/);
});

test("fallback: pickProv uses the stand-in only while the local server doesn't answer", async () => {
  const realFetch = globalThis.fetch;
  const d = C.mergeAssist({ set: { m: 2, prov: "local", fb: "openai" },
    provs: { local: { m: 1, base: "http://localhost:11434/v1", model: "qwen3:8b" }, openai: { m: 1, model: "gpt-4.1-mini" } } }, null);
  const keys = { openai: "sk-x" };
  const readKey = (p) => Promise.resolve(keys[p] || "");
  let calls = 0;
  try {
    globalThis.fetch = () => { calls++; return Promise.reject(new TypeError("Failed to fetch")); };
    C.probeSet("");
    assert.deepEqual(await C.pickProv(d, readKey), { pid: "openai", fb: 1 });
    assert.deepEqual(await C.pickProv(d, readKey), { pid: "openai", fb: 1 });
    assert.equal(calls, 1, "the result is kept");
    delete keys.openai;
    assert.deepEqual(await C.pickProv(d, readKey), { pid: "local", fb: 0 }, "no key here: the local one");
    keys.openai = "sk-x";
    globalThis.fetch = () => Promise.resolve({ ok: false, status: 404 });
    C.probeSet("");
    assert.deepEqual(await C.pickProv(d, readKey), { pid: "local", fb: 0 }, "any answer counts");
    const off = C.mergeAssist({ set: { m: 2, prov: "local", fb: "" }, provs: { local: { m: 1, model: "x" } } }, null);
    assert.deepEqual(await C.pickProv(off, readKey), { pid: "local", fb: 0 });
    const noModel = C.mergeAssist({ set: { m: 2, prov: "local", fb: "openai" }, provs: { local: { m: 1, model: "x" } } }, null);
    C.probeSet("");
    globalThis.fetch = () => Promise.reject(new TypeError("x"));
    assert.deepEqual(await C.pickProv(noModel, readKey), { pid: "local", fb: 0 }, "a stand-in without a model can't answer");
  } finally {
    globalThis.fetch = realFetch;
    C.probeSet("");
  }
});

test("fallback: Feeds and Atelier take the stand-in too", () => {
  ["feeds/ai.js", "atelier/ai.js"].forEach((f) => {
    const js = read(f);
    assert.match(js, /pickChain\(/, f);
    assert.match(js, /probeSet\(cf\.base, false\)/, f);
    assert.match(js, /coolFor\(e\)/, f);
  });
});
