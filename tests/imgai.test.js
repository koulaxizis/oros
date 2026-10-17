// Image AI providers (assistant/imgai.js): the device-local choice,
// sizes and the requests each service gets; and the wiring in the
// Assistant (Settings › Pictures) and Atelier (Image from text).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const IA = require("../assistant/imgai.js");
const C = require("../assistant/core.js");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

function memLS() { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; }

test("choice: normalised, device-local, Pollinations by default", () => {
  assert.deepEqual(IA.normPref({ prov: "google", base: "javascript:x", model: 5 }), { prov: "", base: "", model: "" });
  const ls = memLS();
  assert.equal(IA.readPref(ls).prov, "");
  assert.ok(IA.writePref({ prov: "sdwebui", base: "http://127.0.0.1:7860/", model: "sdxl" }, ls));
  assert.deepEqual(IA.readPref(ls), { prov: "sdwebui", base: "http://127.0.0.1:7860", model: "sdxl" });
  assert.equal(IA.conf({ prov: "sdwebui" }).base, "http://127.0.0.1:7860");
  assert.equal(IA.conf({}), null);
  assert.equal(IA.use({}).pid, "pollinations");
  assert.equal(IA.use({ prov: "openai" }).model, "gpt-image-1");
});

test("no Google service; key ids are the Assistant's", () => {
  IA.IDS.forEach((id) => {
    const p = IA.PROVIDERS[id];
    assert.ok(!/google|gemini|imagen/i.test(JSON.stringify(p)), id);
    if (p.keyId) assert.ok(C.KEY_IDS.includes(p.keyId), p.keyId);
  });
  IA.KEY_EXTRA.forEach((k) => assert.ok(C.KEY_IDS.includes(k), k));
});

test("sizeFor: page shape → service sizes", () => {
  assert.equal(IA.sizeFor("openai", 1920, 1080), "1536x1024");
  assert.equal(IA.sizeFor("openai", 1080, 1920), "1024x1536");
  assert.equal(IA.sizeFor("openai", 1, 1), "1024x1024");
  assert.equal(IA.sizeFor("stability", 1920, 1080), "16:9");
  assert.equal(IA.sizeFor("stability", 1080, 1350), "4:5");
  assert.equal(IA.sizeFor("pollinations", 2, 1), "1024x512");
  assert.equal(IA.sizeFor("sdwebui", 1, 2), "512x1024");
});

test("styled: a style word added to the description", () => {
  assert.equal(IA.styled("  a cat ", ""), "a cat");
  assert.match(IA.styled("a cat", "pixel"), /^a cat, pixel art/);
  assert.equal(IA.styled("", "photo"), "");
});

test("buildGenerate: each service's request", () => {
  const free = IA.buildGenerate(IA.use({}), "", { prompt: "a red apple", w: 1, h: 1, seed: 7 });
  assert.equal(free.method, "GET");
  assert.ok(free.url.startsWith("https://image.pollinations.ai/prompt/a%20red%20apple?"));
  assert.match(free.url, /width=1024&height=1024/);
  assert.match(free.url, /seed=7/);
  assert.deepEqual(free.headers, {});
  const keyed = IA.buildGenerate(IA.use({}), "pk", { prompt: "x/y", w: 1, h: 1 });
  assert.ok(keyed.url.startsWith("https://gen.pollinations.ai/image/x%2Fy?"));
  assert.equal(keyed.headers.Authorization, "Bearer pk");

  const hf = IA.buildGenerate(IA.conf({ prov: "huggingface" }), "hk", { prompt: "p", w: 1, h: 1 });
  assert.equal(hf.url, "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell");
  assert.equal(hf.json.inputs, "p");
  assert.equal(hf.reply, "image");

  const oa = IA.buildGenerate(IA.conf({ prov: "openai" }), "ok", { prompt: "p", w: 3, h: 2, n: 9 });
  assert.equal(oa.url, "https://api.openai.com/v1/images/generations");
  assert.deepEqual(oa.json, { model: "gpt-image-1", prompt: "p", n: 4, size: "1536x1024" });
  assert.equal(oa.reply, "json-b64");

  const st = IA.buildGenerate(IA.conf({ prov: "stability" }), "sk", { prompt: "p", w: 1, h: 1 });
  assert.equal(st.url, "https://api.stability.ai/v2beta/stable-image/generate/core");
  assert.equal(st.headers.Accept, "image/*");
  assert.deepEqual(st.form.find((f) => f[0] === "aspect_ratio"), ["aspect_ratio", "1:1"]);

  const sd = IA.buildGenerate(IA.conf({ prov: "sdwebui", base: "http://192.168.1.5:7860" }), "", { prompt: "p", w: 1, h: 1, n: 2 });
  assert.equal(sd.url, "http://192.168.1.5:7860/sdapi/v1/txt2img");
  assert.equal(sd.json.batch_size, 2);
  assert.equal(sd.headers.Authorization, undefined);
});

test("buildEdit / buildExpand / buildTest", () => {
  const img = { size: 1 }, mask = { size: 2 }, bw = { size: 3 };
  const oe = IA.buildEdit(IA.conf({ prov: "openai" }), "k", { prompt: "p", image: img, mask: mask });
  assert.equal(oe.url, "https://api.openai.com/v1/images/edits");
  assert.equal(oe.form.find((f) => f[0] === "mask")[1].blob, mask);
  const se = IA.buildEdit(IA.conf({ prov: "stability" }), "k", { prompt: "p", image: img, maskBw: bw });
  assert.match(se.url, /edit\/inpaint$/);
  assert.equal(se.form.find((f) => f[0] === "mask")[1].blob, bw);
  assert.equal(IA.buildEdit(IA.use({}), "", { prompt: "p" }), null);
  const so = IA.buildExpand(IA.conf({ prov: "stability" }), "k", { original: img, pad: { left: 100, down: 3000 } });
  assert.match(so.url, /edit\/outpaint$/);
  assert.deepEqual(so.form.filter((f) => ["left", "down", "right"].includes(f[0])), [["left", "100"], ["down", "2000"]]);
  assert.equal(IA.buildTest(IA.use({}), ""), null);
  assert.match(IA.buildTest(IA.conf({ prov: "stability" }), "k").url, /\/v1\/user\/balance$/);
  assert.match(IA.buildTest(IA.conf({ prov: "sdwebui" }), "").url, /\/sdapi\/v1\/sd-models$/);
});

test("wiring: Assistant settings, Atelier, precache, help, credits", () => {
  const ah = read("assistant/index.html"), ih = read("atelier/index.html"), sw = read("sw.js");
  assert.ok(ah.indexOf("imgai.js") > ah.indexOf("core.js") && ah.indexOf("imgai.js") < ah.indexOf("assistant.js"));
  assert.ok(ih.indexOf("../assistant/imgai.js") > 0 && ih.indexOf("imagine.js") > ih.indexOf("\"ai.js"));
  assert.ok(sw.includes('"assistant/imgai.js"') && sw.includes('"atelier/imagine.js"'));
  const as = read("assistant/assistant.js");
  assert.ok(as.includes('section(body, t("set.img"))'));
  IA.IDS.forEach((id) => {
    assert.ok(as.includes('"img.steps.' + id + '"'), id);
    assert.equal(as.split('"img.steps.' + id + '"').length, 3, id + " in EN and EL");
  });
  assert.ok(read("atelier/ai.js").includes("AT.imagine.section(body)"));
  assert.ok(read("assistant/help.en.txt").includes("## Pictures"));
  assert.ok(read("assistant/help.el.txt").includes("## Εικόνες"));
  assert.ok(read("atelier/help.en.txt").includes("`Image from text`"));
  assert.ok(read("CREDITS.md").includes("Image AI you choose"));
  assert.ok(read("shell.js").includes("Image AI you choose"));
});
