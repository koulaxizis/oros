// PL-AI (Chris 2026-11-22 «δώσε στο Photolab πλήρη δυνατότητες χρήσης
// AI … και τα AI που χρησιμοποιεί και το Atelier»): Photo Lab's AI
// commands for the Assistant and Claude (photolab/commands.js kind
// "ai", photolab/aiedit.js), ComfyUI and WebUI upscale in
// assistant/imgai.js, the relay's photolab_import, and the wiring.
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const CMD = require("../photolab/commands.js");
const IA = require("../assistant/imgai.js");

const doc = () => ({ id: "pabcdef1", name: "Cover", w: 1000, h: 800, layers: [
  { id: "l1", k: "raster", name: "Photo", vis: 1, op: 100, x: 0, y: 0 },
  { id: "l2", k: "text", name: "Title", vis: 1, op: 100, x: 10, y: 10, tx: { s: "Πλανόδιο", f: "sans", z: 72 } },
  { id: "l3", k: "raster", name: "Locked", vis: 1, op: 100, lock: 1, x: 0, y: 0 }] });

test("the AI commands are checked like the others", () => {
  assert.ok(CMD.check([{ op: "generate", prompt: "a street musician at dusk", style: "photo", prov: "comfyui" }]).ok);
  assert.match(CMD.check([{ op: "generate" }]).err, /prompt is missing/);
  assert.match(CMD.check([{ op: "generate", prompt: "x", prov: "google" }]).err, /prov "google" is not allowed/);
  assert.ok(CMD.check([{ op: "fill", prompt: "an accordion", x: 10, y: 10, w: 200, h: 200 }]).ok);
  assert.match(CMD.check([{ op: "fill", prompt: "x", x: 1, y: 1 }]).err, /w is missing/);
  assert.match(CMD.check([{ op: "expand" }]).err, /give ratio, or w and h/);
  assert.ok(CMD.check([{ op: "expand", ratio: "9:16", pos: "b", prompt: "a sandy beach" }]).ok);
  assert.ok(CMD.check([{ op: "upscale", f: "4" }]).ok);
  assert.match(CMD.check([{ op: "upscale", f: "8" }]).err, /not allowed/);
  assert.match(CMD.check([{ op: "nobg", what: "text" }]).err, /only photo layers/);
  assert.ok(CMD.check([{ op: "image", path: "/internal/Claude/Planodio/cover.png", fit: "cover" }]).ok);
  ["/internal/.trash/a.png", "/internal/a/../b.png", "/internal/a//b.png", "/etc/a.png", "/internal/a/b.exe"].forEach((p) => {
    assert.match(CMD.check([{ op: "image", path: p }]).err, /path must be/, p);
    assert.match(CMD.check([{ op: "create", from: p }]).err, /from must be/, p);
  });
  assert.ok(CMD.check([{ op: "create", from: "/internal/Claude/Planodio/cover.jpg", title: "Πλανόδιο" }]).ok);
  assert.match(CMD.check([{ op: "create", from: "/internal/Claude/a.jpg" }, { op: "gray" }]).err, /create is the only command/);
  // the provider list is imgai's, the styles too
  assert.deepEqual(CMD.PROVS.slice(1), IA.IDS);
  assert.deepEqual(CMD.AI_STYLES, IA.STYLE_IDS);
  CMD.ORDER.forEach((op) => assert.ok(CMD.GUIDE.indexOf(op + ":") >= 0, op));
});

test("they count on copies: a layer each, nobg the photo layers, expand and upscale the size", () => {
  const n = [];
  let d = doc();
  assert.equal(CMD.apply(d, CMD.check([{ op: "generate", prompt: "x" }]).steps[0], { notes: n }), 1);
  assert.equal(CMD.apply(d, CMD.check([{ op: "nobg" }]).steps[0], { notes: n }), 1, "the free photo layer only");
  assert.equal(CMD.apply(d, CMD.check([{ op: "nobg", ids: "l3" }]).steps[0], { notes: n }), 0, "a locked layer's pixels never change");
  assert.ok(n.indexOf("noPhoto") >= 0);
  assert.equal(CMD.apply(d, CMD.check([{ op: "expand", ratio: "9:16" }]).steps[0], {}), 1);
  assert.deepEqual([d.w, d.h], [1000, 1778]);
  assert.equal(CMD.apply(d, CMD.check([{ op: "upscale", f: "4" }]).steps[0], {}), 1);
  assert.deepEqual([d.w, d.h], [4000, 7112]);
  d = doc();
  assert.equal(CMD.apply(d, CMD.check([{ op: "expand", w: 900, h: 700 }]).steps[0], {}), 0, "never smaller");
  assert.deepEqual(CMD.aiSize({ w: 1000, h: 1000 }, { op: "expand", ratio: "16:9" }), { w: 1778, h: 1000 });
  assert.equal(CMD.aiSize({ w: 8192, h: 100 }, { op: "upscale", f: "2" }), null, "at the limit already");
  // a new picture from a file: made, nothing else counted
  const pv = CMD.preview({ docs: [] }, [""], CMD.check([{ op: "create", from: "/internal/Claude/a.png" }]).steps);
  assert.equal(pv.made, 1);
  const pv2 = CMD.preview({ docs: [doc()] }, ["pabcdef1"], CMD.check([{ op: "generate", prompt: "x" }, { op: "export", fmt: "png", out: "Claude/Out" }]).steps);
  assert.deepEqual([pv2.n, pv2.d, pv2.files], [1, 1, 1]);
});

test("imgai: ComfyUI graphs (text to picture, inpaint with uploads), WebUI upscale", () => {
  assert.ok(IA.IDS.indexOf("comfyui") >= 0);
  const cf = IA.conf({ prov: "comfyui" });
  assert.equal(cf.base, "http://127.0.0.1:8188");
  assert.equal(cf.model, "sd_xl_base_1.0.safetensors");
  const g = IA.buildGenerate(cf, "", { prompt: "a street musician", w: 1600, h: 900, seed: 7 });
  assert.equal(g.url, "http://127.0.0.1:8188/prompt");
  assert.equal(g.reply, "comfy");
  const flow = g.json.prompt;
  assert.equal(flow["4"].inputs.ckpt_name, "sd_xl_base_1.0.safetensors");
  assert.equal(flow["6"].inputs.text, "a street musician");
  assert.deepEqual([flow["5"].class_type, flow["5"].inputs.width, flow["5"].inputs.height], ["EmptyLatentImage", 1024, 576]);
  assert.equal(flow["3"].inputs.seed, 7);
  assert.equal(flow["9"].class_type, "SaveImage");
  const e = IA.buildEdit(cf, "", { prompt: "an accordion", image: "IMG", mask: "MASK" });
  assert.equal(e.json.prompt["5"].class_type, "VAEEncodeForInpaint");
  assert.equal(e.json.prompt["10"].inputs.image, "@image");
  assert.deepEqual(e.json.prompt["11"].inputs, { image: "@mask", channel: "alpha" });
  assert.deepEqual(e.uploads.map((u) => [u[0], u[1].blob]), [["@image", "IMG"], ["@mask", "MASK"]]);
  assert.equal(IA.buildExpand(cf, "", { prompt: "", image: 1, mask: 2 }).reply, "comfy", "expand fills the border like an edit");
  assert.match(IA.buildTest(cf, "").url, /\/system_stats$/);
  const up = IA.buildUpscale(IA.conf({ prov: "sdwebui" }), { b64: "data:image/png;base64,AA", f: 3 });
  assert.equal(up.url, "http://127.0.0.1:7860/sdapi/v1/extra-single-image");
  assert.equal(up.json.upscaling_resize, 3);
  assert.equal(IA.buildUpscale(IA.conf({ prov: "openai" }), { f: 2 }), null);
  assert.ok(IA.PROVIDERS.sdwebui.upscale && !IA.PROVIDERS.comfyui.upscale);
});

test("imgai: a ComfyUI run uploads, queues, waits and fetches", async () => {
  const calls = [];
  let hist = 0;
  const ok = (body, type) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), blob: async () => ({ type: type || "image/png", size: 3 }) });
  global.fetch = async (url, init) => {
    calls.push([url, init && init.method || "GET", init && init.body]);
    if (/\/upload\/image$/.test(url)) return ok({ name: calls.length === 1 ? "oros-image.png" : "oros-mask (1).png", subfolder: "" });
    if (/\/prompt$/.test(url)) return ok({ prompt_id: "abc-123" });
    if (/\/history\/abc-123$/.test(url)) { hist++; return ok(hist < 2 ? {} : { "abc-123": { status: { status_str: "success" }, outputs: { "9": { images: [{ filename: "orOS_0001_.png", subfolder: "", type: "output" }] } } } }); }
    if (/\/view\?/.test(url)) return ok(null, "image/png");
    throw new Error("unexpected " + url);
  };
  global.FormData = class { constructor() { this.f = []; } append(k, v, n) { this.f.push([k, v, n]); } };
  try {
    const req = IA.buildEdit(IA.conf({ prov: "comfyui" }), "", { prompt: "p", image: "IMG", mask: "MASK" });
    const out = await IA.run(req, null, { sleep: async () => {}, now: () => 0 });
    assert.equal(out.length, 1);
    assert.deepEqual(calls.map((c) => c[0].replace("http://127.0.0.1:8188", "")).slice(0, 3), ["/upload/image", "/upload/image", "/prompt"]);
    const sent = JSON.parse(calls[2][2]).prompt;
    assert.equal(sent["10"].inputs.image, "oros-image.png", "the uploaded names replace the placeholders");
    assert.equal(sent["11"].inputs.image, "oros-mask (1).png");
    assert.equal(req.json.prompt["10"].inputs.image, "@image", "the request itself is left as it was");
    assert.match(calls[calls.length - 1][0], /\/view\?filename=orOS_0001_\.png&subfolder=&type=output$/);
  } finally { delete global.fetch; delete global.FormData; }
});

test("the relay's photolab_import is edit_in_app's create, pictures in Claude's folders only", async () => {
  const R = await import("../relay/gate.js");
  assert.ok(R.TOOLS.some((t) => t.name === "photolab_import"));
  assert.deepEqual(R.importCall({ name: "photolab_import", arguments: { path: "/internal/Claude/Planodio/cover.PNG", title: "Πλανόδιο" } }),
    { name: "edit_in_app", arguments: { app: "photolab", designs: "new", steps: [{ op: "create", from: "/internal/Claude/Planodio/cover.PNG", title: "Πλανόδιο" }] } });
  ["/internal/Claude/a.orosstudio", "/internal/.trash/a.png", "/internal/a/../b.png", "Claude/a.png"].forEach((p) => {
    assert.match(R.importCall({ name: "photolab_import", arguments: { path: p } }).err, /needs path/, p);
  });
});

test("wiring: Photo Lab loads aiedit.js, runs kind ai through it, subject.auto, strings in EN, EL and DE", () => {
  assert.match(read("photolab/app.js"), /load\("commands\.js"\)\.then\(function \(\) \{ return load\("aiedit\.js"\); \}\)/);
  const as = read("photolab/assist.js");
  assert.match(as, /if \(kind === "ai"\) return PL\.aiedit \? PL\.aiedit\.run\(s, notes\)/);
  assert.match(as, /chk\.steps\[0\]\.op === "create"\) \{ create\(key, chk\.steps\[0\]\)/);
  assert.match(read("photolab/subject.js"), /PL\.subject = \{ run: run, selOf: selOf, auto: auto \}/);
  const ai = read("photolab/aiedit.js");
  assert.match(ai, /function inFolders\(path\)/, "files only from Claude's folders");
  assert.ok(read("sw.js").indexOf('"photolab/aiedit.js"') > 0);
  global.window = {};
  require(path.join(ROOT, "photolab/strings.js"));
  const S = global.window.PL_STRINGS, pde = read("i18n/de/photolab.js");
  (ai.match(/t\("ai\.[a-zA-Z]+"/g) || []).map((x) => x.slice(3, -1)).concat(["ai.made"]).forEach((k) => {
    assert.ok(S.en[k] && S.el[k], k + " in EN and EL");
    assert.ok(pde.indexOf('"' + k + '":') > 0, k + " in DE");
  });
  delete global.window;
  const asst = read("assistant/assistant.js"), de = read("i18n/de/assistant.js");
  const notes = (ai.match(/note: "ai[A-Za-z]+"/g) || []).map((x) => x.slice(7, -1)).concat(["aiFail", "aiLittle", "aiErr.key", "aiErr.limit", "aiErr.net", "aiErr.http", "aiErr.bad", "aiErr.unsupported"]);
  ["generate", "nobg", "fill", "expand", "upscale", "image"].map((o) => "ed.op." + o).concat(["ed.op.create.photolab", "ed.f.prompt", "ed.f.prov", "ed.f.f", "ed.f.path.photolab", "ed.v.fit.contain", "ed.v.fit.cover", "img.opt.comfyui", "img.steps.comfyui"])
    .concat(notes.map((k) => "ed.note." + k)).forEach((k) => {
      assert.equal(asst.split('"' + k + '":').length - 1, 2, k + " in EN and EL");
      assert.ok(de.indexOf('"' + k + '":') > 0, k + " in DE");
    });
});
