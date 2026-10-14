// Assistant phase 5 wave 3: more services with a free plan (Groq,
// Cerebras, GitHub Models, Cohere, Hugging Face, SambaNova,
// Pollinations) and OpenRouter's free models.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const C = require(path.join(__dirname, "..", "assistant/core.js"));

const FREE = ["groq", "cerebras", "github", "cohere", "huggingface", "sambanova", "pollinations"];
const hist = [{ r: "user", text: "hi" }];

test("freeprov: every new service is listed, free, https, OpenAI format, needs a key", () => {
  FREE.forEach((pid) => {
    const p = C.PROVIDERS[pid];
    assert.ok(C.PROV_IDS.includes(pid), pid);
    assert.equal(p.kind, "openai", pid);
    assert.equal(p.key, "yes", pid);
    assert.equal(p.free, 1, pid);
    assert.match(p.base, /^https:\/\//, pid);
    assert.match(p.keyUrl, /^https:\/\//, pid);
    assert.ok(p.model, pid);
    assert.ok(!/google/i.test(p.base + (p.modelsUrl || "")), pid);
  });
  // local and browser stay last
  assert.deepEqual(C.PROV_IDS.slice(-2), ["local", "browser"]);
});

test("freeprov: chat requests go to each service's OpenAI endpoint with a Bearer key", () => {
  const want = {
    groq: "https://api.groq.com/openai/v1/chat/completions",
    cerebras: "https://api.cerebras.ai/v1/chat/completions",
    github: "https://models.github.ai/inference/chat/completions",
    cohere: "https://api.cohere.ai/compatibility/v1/chat/completions",
    huggingface: "https://router.huggingface.co/v1/chat/completions",
    sambanova: "https://api.sambanova.ai/v1/chat/completions",
    pollinations: "https://gen.pollinations.ai/v1/chat/completions"
  };
  FREE.forEach((pid) => {
    const r = C.buildRequest(pid, { key: "sk", model: "m" }, hist, { tools: [{ name: "t", description: "d", params: { type: "object" } }] });
    assert.equal(r.url, want[pid]);
    assert.equal(r.headers.authorization, "Bearer sk");
    assert.equal(r.body.stream, true);
    assert.equal(r.body.stream_options, undefined, pid + ": no usage option they may refuse");
    assert.equal(r.body.tools[0].type, "function");
  });
});

test("freeprov: model lists (GitHub catalog, Cohere's own list, the rest /models)", () => {
  assert.equal(C.modelsRequest("github", { key: "g" }).url, "https://models.github.ai/catalog/models");
  assert.equal(C.modelsRequest("github", { key: "g" }).headers.authorization, "Bearer g");
  assert.equal(C.modelsRequest("cohere", { key: "c" }).url, "https://api.cohere.com/v1/models?endpoint=chat&page_size=100");
  assert.equal(C.modelsRequest("groq", { key: "q" }).url, "https://api.groq.com/openai/v1/models");
  assert.equal(C.modelsRequest("sambanova", { key: "s" }).url, "https://api.sambanova.ai/v1/models");

  const gh = C.parseModels("github", [
    { id: "openai/gpt-4.1-mini", name: "OpenAI GPT-4.1-mini", supported_output_modalities: ["text"] },
    { id: "openai/text-embedding-3-small", name: "Embedding", supported_output_modalities: ["embeddings"] },
    { id: "meta/llama-4", name: "Llama 4" }
  ]);
  assert.deepEqual(gh.map((m) => m.id), ["meta/llama-4", "openai/gpt-4.1-mini"]);
  assert.deepEqual(C.parseModels("github", { data: [] }), []);

  const co = C.parseModels("cohere", { models: [
    { name: "command-a-03-2025", endpoints: ["chat", "generate"] },
    { name: "embed-v4.0", endpoints: ["embed"] },
    { name: "rerank-v3.5", endpoints: ["rerank"] }
  ] });
  assert.deepEqual(co.map((m) => m.id), ["command-a-03-2025"]);

  const gq = C.parseModels("groq", { data: [
    { id: "llama-3.3-70b-versatile" }, { id: "whisper-large-v3" }, { id: "meta-llama/llama-guard-4-12b" },
    { id: "playai-tts" }, { id: "qwen/qwen3-32b" }
  ] });
  assert.deepEqual(gq.map((m) => m.id), ["llama-3.3-70b-versatile", "qwen/qwen3-32b"]);
});

test("freeprov: OpenRouter marks the models that cost nothing", () => {
  const list = C.parseModels("openrouter", { data: [
    { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B (free)", pricing: { prompt: "0", completion: "0" } },
    { id: "openai/gpt-5", name: "GPT-5", pricing: { prompt: "0.00000125", completion: "0.00001" } },
    { id: "z/zero", name: "Zero", pricing: { prompt: "0", completion: "0" } },
    { id: "x/odd", name: "Odd", pricing: { prompt: "", completion: "" } },
    { id: "y/none", name: "None" }
  ] });
  const free = list.filter((m) => m.free).map((m) => m.id).sort();
  assert.deepEqual(free, ["meta-llama/llama-3.3-70b-instruct:free", "z/zero"]);
  assert.equal(list.length, 5);
});

test("freeprov: the free-only choice is synced per provider and merges both ways", () => {
  const a = { provs: { openrouter: { m: 5, base: "", model: "x:free", free: 1 } } };
  const b = { provs: { openrouter: { m: 3, base: "", model: "y", free: 0 } } };
  assert.equal(C.mergeAssist(a, b).provs.openrouter.free, 1);
  assert.deepEqual(C.mergeAssist(a, b), C.mergeAssist(b, a));
  assert.equal(C.mergeAssist({ provs: { groq: { m: 1, model: "q", free: "yes" } } }, null).provs.groq.free, 1);
  assert.equal(C.mergeAssist({ provs: { groq: { m: 1, model: "q" } } }, null).provs.groq.free, 0);
});

test("freeprov: keys for the new services are kept and synced like the others", () => {
  FREE.forEach((pid) => assert.ok(C.KEY_IDS.includes(pid), pid));
  const keys = {};
  C.KEY_IDS.forEach((k, i) => { keys[k] = { m: i + 1, d: 0, s: { iv: "a", ct: "b" } }; });
  const out = C.mergeAssist({ keys }, null).keys;
  FREE.forEach((pid) => assert.ok(out[pid], pid));
});

test("freeprov: files go to the new services as text read on the device", () => {
  const PDF = { id: "apdf0001", name: "a.pdf", type: "application/pdf", size: 3, data: "QUJD", text: "Rent 500" };
  const IMG = { id: "aimg0001", name: "b.png", type: "image/png", size: 3, data: "QUJD", text: "TOTAL 9" };
  FREE.forEach((pid) => {
    assert.deepEqual(C.attCaps(pid), { img: false, pdf: false }, pid);
    assert.equal(C.checkAtt(pid, [], { type: "application/pdf", size: 10 }), "");
    const r = C.buildRequest(pid, { key: "k", model: "m" }, [{ r: "user", text: "read", att: [PDF, IMG] }], {});
    const c = r.body.messages[0].content;
    const s = typeof c === "string" ? c : JSON.stringify(c);
    assert.ok(s.includes("Rent 500") && s.includes("TOTAL 9"), pid);
    assert.ok(!s.includes("QUJD"), pid + ": no file bytes");
  });
});
