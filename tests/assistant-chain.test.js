// AS-CHAIN: the order of use (local first, then the browser, then free
// online services, then paid ones), picked per message on each device.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "assistant/core.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const data = (set, provs) => C.mergeAssist({ set: Object.assign({ m: 2 }, set), provs: provs || {} }, null);

test("chain: tiers put local first, then the browser, then free, then paid", () => {
  assert.equal(C.provTier("local"), 0);
  assert.equal(C.provTier("webllm"), 1);
  assert.equal(C.provTier("browser"), 2);
  assert.equal(C.provTier("groq"), 3);
  assert.equal(C.provTier("mistral"), 3);
  assert.equal(C.provTier("anthropic"), 4);
  assert.equal(C.provTier("openrouter"), 4);
  assert.equal(C.provTier("openrouter", { free: 1 }), 3);
  assert.equal(C.provTier("nope"), 9);
  assert.equal(C.isOnline("groq"), true);
  assert.equal(C.isOnline("local"), false);
  assert.equal(C.isOnline(""), false);
});

test("chain: off keeps a chosen online service alone", () => {
  assert.deepEqual(C.chainOrder(data({ prov: "anthropic" })), ["anthropic"]);
  assert.deepEqual(C.chainOrder(data({ prov: "groq" })), ["groq"]);
  assert.deepEqual(C.chainOrder(data({ prov: "" })), []);
});

test("chain: off, a local or in-browser model is never a dead end (AS-CHAIN 2)", () => {
  const o = C.chainOrder(data({ prov: "local", fb: "openai" }));
  assert.deepEqual(o.slice(0, 2), ["local", "openai"], "the chosen one, then its stand-in");
  assert.equal(new Set(o).size, o.length, "no service twice");
  const rest = o.slice(2).map((p) => C.provTier(p));
  assert.deepEqual(rest, rest.slice().sort((a, b) => a - b), "then the rest by tier");
  const w = C.chainOrder(data({ prov: "webllm", skip: ["groq"] }));
  assert.equal(w[0], "webllm");
  assert.ok(w.indexOf("groq") < 0, "left-out services stay out");
  assert.ok(w.indexOf("cerebras") > 0);
});

test("chain: phone with the computer's server away and a free key here → the free one answers", async () => {
  const realFetch = globalThis.fetch;
  const d = data({ prov: "local" }, { local: { m: 1, base: "http://192.168.1.20:11434/v1", model: "qwen3:8b" },
    groq: { m: 1, model: "llama-3.3-70b-versatile" } });
  try {
    globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
    C.probeSet("");
    assert.deepEqual(await C.pickChain(d, { readKey: (p) => Promise.resolve(p === "groq" ? "gsk" : "") }), { pid: "groq", fb: 1 });
    C.probeSet("");
    assert.deepEqual(await C.pickChain(d, { readKey: () => Promise.resolve("") }), { pid: "local", fb: 0 }, "nothing else here");
  } finally {
    globalThis.fetch = realFetch;
    C.probeSet("");
  }
});

test("chain: on orders every service by tier, the chosen one first in its tier, skips left out", () => {
  const order = C.chainOrder(data({ prov: "openai", auto: 1, skip: ["gemini"] }));
  assert.equal(order[0], "local");
  assert.ok(order.indexOf("gemini") < 0);
  const tiers = order.map((p) => C.provTier(p));
  assert.deepEqual(tiers, tiers.slice().sort((a, b) => a - b), "tiers never go down");
  const paid = order.filter((p) => C.provTier(p) === 4);
  assert.equal(paid[0], "openai", "the chosen one leads its tier");
  const o2 = C.chainOrder(data({ prov: "cohere", auto: 1 }));
  assert.equal(o2.filter((p) => C.provTier(p) === 3)[0], "cohere");
});

test("chain: settings sync, bad skips are dropped", () => {
  const d = data({ prov: "groq", auto: "yes", skip: ["groq", "groq", "nope", 5] });
  assert.equal(d.set.auto, 1);
  assert.deepEqual(d.set.skip, ["groq"]);
  assert.deepEqual(data({ prov: "groq" }).set.skip, []);
});

test("chain: a message needs tools for actions, web look-ups when search is on, or after a tool turn", () => {
  assert.equal(C.needsTools("What is the capital of France?", {}), false);
  assert.equal(C.needsTools("Add milk to my shopping list", {}), true);
  assert.equal(C.needsTools("Πρόσθεσε γάλα στη λίστα", {}), true);
  assert.equal(C.needsTools("Θύμισέ μου αύριο το ραντεβού", {}), true);
  assert.equal(C.needsTools("Erstelle einen Termin", {}), true);
  assert.equal(C.needsTools("What's the weather today?", {}), false);
  assert.equal(C.needsTools("What's the weather today?", { web: true }), true);
  assert.equal(C.needsTools("ok, and the second one?", { prev: true }), true);
  assert.equal(C.needsTools("Add milk", { brief: true }), false, "a Briefing never needs tools");
});

test("chain: errors that pass a service over for a while", () => {
  assert.equal(C.coolFor(new C.ProviderError("rate")), C.COOL.rate);
  assert.equal(C.coolFor(new C.ProviderError("net")), C.COOL.net);
  assert.equal(C.coolFor(new C.ProviderError("credit")), C.COOL.credit);
  assert.equal(C.coolFor(new C.ProviderError("model")), C.COOL.model, "a server without the model");
  assert.equal(C.coolFor(new C.ProviderError("bad")), 0, "a bad request goes nowhere else");
  assert.equal(C.coolFor(new Error("x")), 0);
});

test("chain: pickChain takes the first service there on this device", async () => {
  const realFetch = globalThis.fetch;
  const provs = {
    local: { m: 1, base: "http://localhost:11434/v1", model: "qwen3:8b" },
    webllm: { m: 1, model: "Llama-3.2-3B-Instruct-q4f16_1-MLC" },
    groq: { m: 1, model: "llama-3.3-70b-versatile" },
    anthropic: { m: 1, model: "claude-x" }
  };
  const keys = { groq: "gsk", anthropic: "sk-ant" };
  const readKey = (p) => Promise.resolve(keys[p] || "");
  const d = data({ prov: "anthropic", auto: 1 }, provs);
  const device = (p) => p === "webllm";
  try {
    globalThis.fetch = () => Promise.resolve({ ok: true, status: 200 });
    C.probeSet("");
    assert.deepEqual(await C.pickChain(d, { readKey, device }), { pid: "local", fb: 1 }, "the computer first");

    globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
    C.probeSet("");
    assert.deepEqual(await C.pickChain(d, { readKey, device }), { pid: "webllm", fb: 1 }, "then the browser");
    assert.deepEqual(await C.pickChain(d, { readKey, device, tools: true }), { pid: "groq", fb: 1 }, "tools skip models without them");
    const cool = { groq: Date.now() + 60000 };
    assert.deepEqual(await C.pickChain(d, { readKey, device, tools: true, cool }), { pid: "anthropic", fb: 0 }, "a cooled service is passed over");
    delete keys.groq; delete keys.anthropic;
    assert.deepEqual(await C.pickChain(d, { readKey, device, tools: true }), { pid: "webllm", fb: 1 },
      "nothing with tools here: the best without them still answers");
    assert.deepEqual(await C.pickChain(d, { readKey, device: () => false }), { pid: "local", fb: 1 },
      "nothing at all: the first in the order (its error shows)");
    const skipped = data({ prov: "anthropic", auto: 1, skip: ["local", "webllm"] }, provs);
    keys.groq = "gsk";
    assert.deepEqual(await C.pickChain(skipped, { readKey, device }), { pid: "groq", fb: 1 });
  } finally {
    globalThis.fetch = realFetch;
    C.probeSet("");
  }
});

test("chain: the Assistant picks per turn, retries the next on a cooling error, and says who answers", () => {
  const js = read("assistant/assistant.js");
  assert.match(js, /C\.pickChain\(data, \{ readKey: readKey, device: onDevice, tools: turnTools\(c\), cool: cool \}\)/);
  assert.match(js, /C\.coolFor\(e\) && again \+ 1 < C\.chainOrder\(data\)\.length/);
  assert.match(js, /cool\[pid\] = Date\.now\(\) \+ C\.coolFor\(e\);/);
  assert.match(js, /id = "as-auto"|"as-auto"/);
  assert.match(js, /if \(failed && curProv\(\) === failed\.pid\)/);
  ["note.via", "note.noNext", "set.chain", "set.auto", "set.autoHint", "set.tier0", "set.tier1", "set.tier3", "set.tier4",
   "set.chain.ok", "set.chain.off", "set.chain.down", "set.fbAuto"].forEach((k) => {
    const n = js.split('"' + k + '":').length - 1;
    assert.equal(n, 2, k + " in EN and EL");
    assert.ok(read("i18n/de/assistant.js").indexOf('"' + k + '":') >= 0, k + " in DE");
  });
});
