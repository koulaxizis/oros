// Assistant phase 5 wave 4: open-source models on the user's own
// computer (ready-made server settings) and in the browser (WebLLM).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "assistant/core.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("local: every server kit has a local /v1 address and a CORS line in EN and EL", () => {
  const js = read("assistant/assistant.js");
  assert.deepEqual(C.KIT_IDS.slice().sort(), Object.keys(C.LOCAL_KITS).sort());
  C.KIT_IDS.forEach((k) => {
    assert.match(C.LOCAL_KITS[k], /^http:\/\/localhost:\d+\/v1$/, k);
    assert.equal(C.normBase(C.LOCAL_KITS[k]), C.LOCAL_KITS[k], k);
    assert.equal(js.split('"kit.' + k + '":').length - 1, 2, k + ": EN + EL");
    assert.equal(js.split('"kit.name.' + k + '":').length - 1, 2, k + ": name EN + EL");
  });
  assert.equal(C.LOCAL_KITS.ollama, "http://localhost:11434/v1");
  assert.equal(C.LOCAL_KITS.lmstudio, "http://localhost:1234/v1");
});

test("local: the chosen kit is synced and only known kits survive", () => {
  const d = C.mergeAssist({ provs: { local: { m: 2, base: "http://localhost:1234/v1", model: "x", kit: "lmstudio" } } }, null);
  assert.equal(d.provs.local.kit, "lmstudio");
  assert.equal(C.mergeAssist({ provs: { local: { m: 2, kit: "evil" } } }, null).provs.local.kit, "");
  const a = { provs: { local: { m: 5, kit: "ollama" } } }, b = { provs: { local: { m: 4, kit: "jan" } } };
  assert.deepEqual(C.mergeAssist(a, b), C.mergeAssist(b, a));
});

test("webllm: an on-device provider with no key, no tools, no web search", () => {
  const p = C.PROVIDERS.webllm;
  assert.equal(p.kind, "webllm");
  assert.equal(p.key, "no");
  assert.equal(p.device, true);
  assert.equal(C.PROVIDERS.browser.device, true);
  assert.ok(C.PROV_IDS.includes("webllm"));
  assert.equal(C.webAny("webllm"), false);
  assert.equal(C.webAny("browser"), false);
  assert.ok(C.webllmModel(p.model), "default model is in the list");
  assert.deepEqual(C.attCaps("webllm"), { img: false, pdf: false });
});

test("webllm: every offered model is in the vendored library's prebuilt list, none from Google", () => {
  const lib = read("vendor/webllm/web-llm-0.2.86.js");
  assert.ok(lib.includes('modelVersion = "v0_2_86'));
  assert.ok(C.WEBLLM_MODELS.length >= 6);
  C.WEBLLM_MODELS.forEach((m) => {
    assert.ok(lib.includes('model_id: "' + m.id + '"'), m.id);
    assert.ok(!/gemma|gemini/i.test(m.id), m.id);
    assert.ok(m.mb > 0 && m.mb < 8000, m.id);
  });
  const sizes = C.WEBLLM_MODELS.map((m) => m.mb);
  assert.deepEqual(sizes, sizes.slice().sort((a, b) => a - b), "smallest first");
});

test("webllm: messages fit the small window, newest user message kept", () => {
  const msgs = [];
  for (let i = 0; i < 20; i++) {
    msgs.push({ r: "user", text: "question " + i + " " + "x".repeat(800) });
    msgs.push({ r: "asst", text: "answer " + i + " " + "y".repeat(800) });
  }
  msgs.push({ r: "user", text: "last question" });
  const out = C.webllmMessages(msgs, "SYS", 7000);
  assert.equal(out[0].role, "system");
  assert.equal(out[1].role, "user");
  assert.equal(out[out.length - 1].content, "last question");
  const total = out.reduce((n, m) => n + m.content.length, 0);
  assert.ok(total <= 7000, total);
  assert.ok(out.length > 3 && out.length < 15);
  // one huge message is cut from the front, never dropped
  const big = C.webllmMessages([{ r: "user", text: "A".repeat(20000) + "END" }], "", 7000);
  assert.equal(big.length, 1);
  assert.ok(big[0].content.endsWith("END") && big[0].content.length <= 7010);
  // tool turns and notes never reach it
  const mixed = C.webllmMessages([{ r: "user", text: "hi" }, { r: "note", text: "n" }, { r: "asst", text: "hello" }, { r: "user", text: "and?" }], "");
  assert.deepEqual(mixed.map((m) => m.role), ["user", "assistant", "user"]);
});

test("webllm: files go as the text read on the device", () => {
  const out = C.webllmMessages([{ r: "user", text: "what is it?", att: [{ id: "apdf0001", name: "a.pdf", type: "application/pdf", size: 3, data: "QUJD", text: "Rent 500" }] }], "");
  assert.ok(out[0].content.includes("Rent 500"));
  assert.ok(!out[0].content.includes("QUJD"));
});

test("webllm: the worker loads the vendored library and sw.js keeps the model caches", () => {
  assert.match(read("assistant/webllm-worker.js"), /from "\.\.\/vendor\/webllm\/web-llm-0\.2\.86\.js"/);
  assert.match(read("assistant/assistant.js"), /"\.\.\/vendor\/webllm\/web-llm-0\.2\.86\.js"/);
  const sw = read("sw.js");
  assert.ok(sw.includes('name.indexOf("webllm/") === 0'));
  assert.ok(sw.includes('var WEBLLM_CACHE = "oros-webllm"'));
  assert.ok(fs.existsSync(path.join(ROOT, "vendor/webllm/LICENSE")));
});
