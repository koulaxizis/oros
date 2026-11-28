// AS-GREEK: the Greek local AI pair for Ollama (krikri-el chats,
// qwen3:8b takes the turns that need tools) and its one-button setup.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "assistant/core.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("greek: Ollama's API root from the Assistant's address", () => {
  assert.equal(C.ollamaRoot("http://localhost:11434/v1"), "http://localhost:11434");
  assert.equal(C.ollamaRoot("http://192.168.1.20:11434/v1/"), "http://192.168.1.20:11434");
  assert.equal(C.ollamaRoot("http://localhost:11434"), "http://localhost:11434");
  assert.equal(C.ollamaRoot("http://localhost:11434/api"), "");
  assert.equal(C.ollamaRoot("javascript:alert(1)"), "");
  assert.equal(C.ollamaRoot(""), "");
  assert.equal(C.ollamaRoot("http://user@evil/v1"), "");
});

test("greek: three steps on the same server, the official ILSP model", () => {
  const s = C.greekSteps("http://localhost:11434");
  assert.deepEqual(s.map((x) => x.id), ["tools", "base", "chat"]);
  s.forEach((x) => assert.ok(x.url.startsWith("http://localhost:11434/api/"), x.url));
  assert.equal(s[0].body.model, "qwen3:8b");
  assert.equal(s[1].body.model, "hf.co/ilsp/Llama-Krikri-8B-Instruct-GGUF:Q4_K_M");
  assert.equal(s[2].url, "http://localhost:11434/api/create");
  assert.equal(s[2].body.model, "krikri-el");
  assert.equal(s[2].body.from, s[1].body.model);
  assert.equal(s[2].body.parameters.num_ctx, 16384);
  assert.ok(s[2].body.template.includes("{{ .System }}"));
  assert.ok(s[2].body.template.includes("ΚΑΝΟΝΑΣ ΓΛΩΣΣΑΣ"), "Greek rule also after the Assistant's own system prompt");
  assert.ok(s[2].body.template.includes("{{- if .Tools }}"));
  // the shared preset is never changed by a step
  s[2].body.parameters.num_ctx = 1;
  assert.equal(C.GREEK_AI.parameters.num_ctx, 16384);
  assert.deepEqual(C.greekSteps(""), []);
});

test("greek: Ollama's progress lines", () => {
  assert.deepEqual(C.ollamaProgress('{"status":"pulling abc","total":200,"completed":50}'), { status: "pulling abc", pct: 25, done: false, error: "" });
  assert.equal(C.ollamaProgress('{"status":"success"}').done, true);
  assert.equal(C.ollamaProgress('{"error":"pull model manifest: file does not exist"}').error, "pull model manifest: file does not exist");
  assert.equal(C.ollamaProgress("not json"), null);
  assert.equal(C.ollamaProgress(""), null);
  assert.equal(C.ollamaProgress('{"status":"x","total":10,"completed":30}').pct, 100);
});

test("greek: known local models bring their own ticks", () => {
  assert.deepEqual(C.localTraits("krikri-el"), { nt: 1, vis: 0 });
  assert.deepEqual(C.localTraits("krikri-el:latest"), { nt: 1, vis: 0 });
  assert.deepEqual(C.localTraits("hf.co/ilsp/Llama-Krikri-8B-Instruct-GGUF:Q4_K_M"), { nt: 1, vis: 0 });
  assert.deepEqual(C.localTraits("qwen3:8b"), { nt: 0, vis: 0 });
  assert.equal(C.localTraits("llava"), null);
  assert.equal(C.localTraits("qwen2.5-vl"), null);
  assert.equal(C.localTraits(""), null);
});

test("greek: the model for actions takes only turns that need tools", () => {
  const pc = { model: "krikri-el", nt: 1, tm: "qwen3:8b" };
  assert.equal(C.toolModel(pc, true), "qwen3:8b");
  assert.equal(C.toolModel(pc, false), "");
  assert.equal(C.toolModel({ model: "krikri-el", nt: 0, tm: "qwen3:8b" }, true), "", "a model with tools keeps its turns");
  assert.equal(C.toolModel({ model: "qwen3:8b", nt: 1, tm: "qwen3:8b" }, true), "");
  assert.equal(C.toolModel({ model: "krikri-el", nt: 1 }, true), "");
  assert.equal(C.toolModel(null, true), "");
});

test("greek: the model for actions syncs, merges and is cut to size", () => {
  const d = C.mergeAssist({ provs: { local: { m: 2, base: "http://localhost:11434/v1", model: "krikri-el", nt: 1, tm: " qwen3:8b " } } }, null);
  assert.equal(d.provs.local.tm, "qwen3:8b");
  assert.equal(C.mergeAssist({ provs: { local: { m: 2, tm: 5 } } }, null).provs.local.tm, "");
  assert.equal(C.mergeAssist({ provs: { local: { m: 2, tm: "x".repeat(500) } } }, null).provs.local.tm.length, 200);
  const a = { provs: { local: { m: 5, nt: 1, tm: "qwen3:8b" } } }, b = { provs: { local: { m: 4, nt: 1, tm: "other" } } };
  assert.deepEqual(C.mergeAssist(a, b), C.mergeAssist(b, a));
});

test("greek: a turn that needs tools stays on the local server with a model for actions", async () => {
  const data = {
    set: { m: 1, prov: "local", auto: 1 },
    provs: { local: { m: 1, base: "http://localhost:11434/v1", model: "krikri-el", nt: 1, tm: "qwen3:8b" },
             openai: { m: 1, model: "gpt-4.1-mini" } }
  };
  const d = C.mergeAssist(data, null);
  C.probeSet("");
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: "krikri-el" }, { id: "qwen3:8b" }] }), text: async () => "" });
  try {
    const r = await C.pickChain(d, { readKey: () => "k", tools: true });
    assert.equal(r.pid, "local");
    d.provs.local.tm = "";
    C.probeSet("");
    const r2 = await C.pickChain(d, { readKey: () => "k", tools: true });
    assert.notEqual(r2.pid, "local", "without a model for actions, another service takes the turn");
    C.probeSet("");
    const r3 = await C.pickChain(d, { readKey: () => "k", tools: false });
    assert.equal(r3.pid, "local", "a plain question stays with krikri-el");
  } finally {
    global.fetch = realFetch;
    C.probeSet("");
  }
});

test("greek: the setup and the model for actions are wired in the Assistant, in EN, EL and DE", () => {
  const js = read("assistant/assistant.js");
  ["set.tm", "set.tmHint", "greek.hint", "greek.get", "greek.step", "greek.net", "greek.cut", "greek.done", "greek.fail"].forEach((k) => {
    assert.equal(js.split('"' + k + '":').length - 1, 2, k + ": EN + EL");
    assert.ok(read("i18n/de/assistant.js").includes('"' + k + '":'), k + ": DE");
  });
  assert.ok(js.includes("C.greekSteps("));
  assert.ok(js.includes("C.localTraits("));
  assert.ok(js.includes("tm: C.GREEK_AI.tools"));
  assert.match(js, /model: tm \|\| (pc\.model \|\| )?modelOf\(pid\)/);
});

test("greek: Krikri and Qwen3 are credited", () => {
  assert.match(read("CREDITS.md"), /Llama-Krikri/);
  assert.match(read("shell.js"), /Llama-Krikri/);
});
