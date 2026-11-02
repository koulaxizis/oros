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

test("choice: normalised, device-local, AI Horde by default", () => {
  assert.deepEqual(IA.normPref({ prov: "google", base: "javascript:x", model: 5 }), { prov: "", base: "", model: "" });
  const ls = memLS();
  assert.equal(IA.readPref(ls).prov, "");
  assert.ok(IA.writePref({ prov: "sdwebui", base: "http://127.0.0.1:7860/", model: "sdxl" }, ls));
  assert.deepEqual(IA.readPref(ls), { prov: "sdwebui", base: "http://127.0.0.1:7860", model: "sdxl" });
  assert.equal(IA.conf({ prov: "sdwebui" }).base, "http://127.0.0.1:7860");
  assert.equal(IA.conf({}), null);
  assert.equal(IA.use({}).pid, "horde");
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
  // AI Horde: free, no account; the anonymous key when none is saved
  const ho = IA.buildGenerate(IA.use({}), "", { prompt: "a red apple", w: 2, h: 1, n: 9 });
  assert.equal(ho.url, "https://aihorde.net/api/v2/generate/async");
  assert.equal(ho.method, "POST");
  assert.equal(ho.headers.apikey, "0000000000");
  assert.match(ho.headers["Client-Agent"], /^orOS:/);
  assert.equal(ho.json.prompt, "a red apple");
  assert.deepEqual([ho.json.params.width, ho.json.params.height, ho.json.params.n], [1024, 512, 2]);
  assert.equal(ho.json.nsfw, false);
  assert.equal(ho.json.r2, false);
  assert.deepEqual(ho.json.models, ["AlbedoBase XL (SDXL)"]);
  assert.equal(ho.reply, "horde");
  assert.equal(IA.buildGenerate(IA.use({}), "own", { prompt: "p", w: 1, h: 1 }).headers.apikey, "own");
  assert.equal(IA.PROVIDERS.horde.key, "opt");
  // Pollinations needs a secret key now (no free plan, no keyless host)
  assert.equal(IA.PROVIDERS.pollinations.key, "yes");
  assert.ok(!IA.PROVIDERS.pollinations.free);
  assert.equal(IA.PROVIDERS.pollinations.freeBase, undefined);
  const pol = IA.buildGenerate(IA.conf({ prov: "pollinations" }), "sk_x", { prompt: "a red apple", w: 1, h: 1, seed: 7 });
  assert.equal(pol.method, "GET");
  assert.ok(pol.url.startsWith("https://gen.pollinations.ai/image/a%20red%20apple?"));
  assert.match(pol.url, /width=1024&height=1024/);
  assert.match(pol.url, /seed=7/);
  assert.equal(pol.headers.Authorization, "Bearer sk_x");
  const slash = IA.buildGenerate(IA.conf({ prov: "pollinations" }), "sk_x", { prompt: "x/y", w: 1, h: 1 });
  assert.ok(slash.url.startsWith("https://gen.pollinations.ai/image/x%2Fy?"));
  assert.ok(!/image\.pollinations\.ai/.test(read("assistant/imgai.js")));

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
  assert.equal(IA.buildTest(IA.conf({ prov: "pollinations" }), "sk"), null);
  const ht = IA.buildTest(IA.use({}), "");
  assert.equal(ht.url, "https://aihorde.net/api/v2/find_user");
  assert.equal(ht.headers.apikey, "0000000000");
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
  assert.ok(read("translations.js").includes("Image AI you choose"));   // the credits line (shell.js cr.* key)
});

test("AI Horde: waits for the volunteers, then returns the pictures", async () => {
  const calls = [];
  let checks = 0;
  global.fetch = async (url, init) => {
    calls.push([init && init.method || "GET", url]);
    if (url.endsWith("/generate/async")) return { ok: true, json: async () => ({ id: "abc-123" }) };
    if (url.includes("/generate/check/abc-123")) { checks++; return { ok: true, json: async () => ({ done: checks >= 2, is_possible: true }) }; }
    if (url.includes("/generate/status/abc-123")) return { ok: true, json: async () => ({ generations: [{ img: "AAAA" }, { img: "BBBB", censored: true }] }) };
    throw new Error("unexpected " + url);
  };
  try {
    const req = IA.buildGenerate(IA.use({}), "", { prompt: "p", w: 1, h: 1 });
    const pics = await IA.run(req, null, { sleep: async () => {}, now: () => 0 });
    assert.equal(pics.length, 1);                         // the censored one is left out
    assert.equal(pics[0].type, "image/webp");
    assert.equal(checks, 2);
    assert.deepEqual(calls.map((c) => c[0]), ["POST", "GET", "GET", "GET"]);
    // no worker for the model: the job is cancelled and the error says so
    checks = 0;
    global.fetch = async (url, init) => {
      calls.push([init && init.method || "GET", url]);
      if (url.endsWith("/generate/async")) return { ok: true, json: async () => ({ id: "abc-123" }) };
      if (url.includes("/generate/check/")) return { ok: true, json: async () => ({ done: false, is_possible: false }) };
      return { ok: true, json: async () => ({}) };
    };
    await assert.rejects(IA.run(req, null, { sleep: async () => {}, now: () => 0 }), (e) => e.code === "http" && /no worker/.test(e.msg));
    assert.ok(calls.some((c) => c[0] === "DELETE"));
    // a bad job id is never put into a URL
    await assert.rejects(IA.hordeWait(req, { id: "../x" }, null), (e) => e.code === "bad");
  } finally { delete global.fetch; }
});
