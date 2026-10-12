// Atelier AI: aitext.js (prompts, answers, ideas, palette) and
// cutout.js (the pure steps of background removal).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const AIT = require("../atelier/aitext.js");
const CUT = require("../atelier/cutout.js");

// ---------- aitext: prompts ----------
test("rewrite: every kind builds a prompt that carries the text", () => {
  AIT.KINDS.forEach((k) => {
    const q = AIT.rewrite(k, "Summer sale", { ask: "a summer sale" });
    assert.ok(q.system.length > 20);
    assert.ok(q.user.includes(k === "write" ? "a summer sale" : "Summer sale"), k);
  });
  assert.throws(() => AIT.rewrite("nope", "x"));
});

test("rewrite: keeps the language of the text, translate flips it", () => {
  assert.match(AIT.rewrite("shorter", "Καλοκαιρινές εκπτώσεις").user, /in Greek/);
  assert.match(AIT.rewrite("shorter", "Summer sale").user, /in English/);
  assert.match(AIT.rewrite("translate", "Καλοκαιρινές εκπτώσεις").user, /into English/);
  assert.match(AIT.rewrite("translate", "Summer sale").user, /into Greek/);
  // an empty box follows the app's language
  assert.match(AIT.rewrite("write", "", { ask: "", lang: "el" }).user, /in Greek/);
  // a Greek request is answered in Greek
  assert.match(AIT.rewrite("write", "", { ask: "εκπτώσεις 20%" }).user, /in Greek/);
});

test("clean: plain text out of a chatty answer", () => {
  assert.equal(AIT.clean('"Summer sale"'), "Summer sale");
  assert.equal(AIT.clean("«Μεγάλες εκπτώσεις»"), "Μεγάλες εκπτώσεις");
  assert.equal(AIT.clean("```\nHello\nworld\n```"), "Hello\nworld");
  assert.equal(AIT.clean("Here is a shorter version:\nBig sale"), "Big sale");
  assert.equal(AIT.clean("Ορίστε:\nΜεγάλη έκπτωση"), "Μεγάλη έκπτωση");
  assert.equal(AIT.clean("## **Big** sale"), "Big sale");
  assert.equal(AIT.clean('He said "hi" and "bye"'), 'He said "hi" and "bye"');   // inner quotes stay
  assert.equal(AIT.clean("a\n\n\n\nb"), "a\n\nb");
  assert.equal(AIT.clean("x".repeat(6000)).length, 5000);
  assert.equal(AIT.clean(null), "");
});

// ---------- aitext: ideas ----------
function doc() {
  const it = (id, pg, k, extra) => Object.assign({ id, pg, x: 0, y: 0, w: 100, h: 20, ax: Object.assign({ k }, extra) }, {});
  return {
    items: [
      it("i-bg", "p-1", "shape", { bg: 1, fc: "#ffffff" }),
      it("i-sub", "p-1", "text", { tx: "Fresh bread daily", size: 30, fc: "#333333" }),
      it("i-head", "p-1", "text", { tx: "Bakery", size: 80, fc: "#111111" }),
      it("i-small", "p-1", "text", { tx: "Open 8-20", size: 12, fc: "#333333" }),
      it("i-bar", "p-1", "shape", { fc: "#cc3300", g: { a: "#cc3300", b: "#ffcc00", ang: 90 } }),
      it("i-lock", "p-1", "text", { tx: "Locked", size: 200, fc: "#000000" }),
      it("i-other", "p-2", "text", { tx: "Other page", size: 90, fc: "#111111" })
    ]
  };
}
doc.locked = (d) => { d.items.find((x) => x.id === "i-lock").lock = 1; return d; };

test("slotsOf: text boxes of one page, biggest first, locked and empty left out", () => {
  const d = doc.locked(doc());
  d.items.push({ id: "i-empty", pg: "p-1", x: 0, y: 0, w: 10, h: 10, ax: { k: "text", tx: "  ", size: 50 } });
  const s = AIT.slotsOf(d, "p-1");
  assert.deepEqual(s.map((x) => x.id), ["i-head", "i-sub", "i-small"]);
  assert.deepEqual(s.map((x) => x.role), ["headline", "text", "small print"]);
  assert.equal(s[0].tx, "Bakery");
});

test("ideas: asks for JSON with one text per box (and colours when asked)", () => {
  const slots = AIT.slotsOf(doc.locked(doc()), "p-1");
  const q = AIT.ideas("bakery opening", slots, { colors: true });
  assert.match(q.system, /JSON only/);
  assert.match(q.system, /colors/);
  assert.match(q.user, /exactly 3 texts/);
  assert.ok(q.user.includes('"Fresh bread daily"'));
  assert.doesNotMatch(AIT.ideas("x", slots, { colors: false }).system, /colors/);
});

test("parseIdeas: reads fenced or bare JSON, fills gaps, checks colours", () => {
  const slots = AIT.slotsOf(doc.locked(doc()), "p-1");
  const ans = 'Sure!\n```json\n{"ideas":[' +
    '{"name":"Warm","texts":["Fresh Start","Baked at dawn",""],"colors":["#2B1B10","#fff","nope","#E07A2F"]},' +
    '{"name":"Same","texts":["Bakery","Fresh bread daily","Open 8-20"]},' +
    '{"texts":["A","B","C","D"],"colors":["#000000","#ffffff"]},' +
    '{"texts":["four"]},{"texts":["five"]}]}\n```';
  const out = AIT.parseIdeas(ans, slots);
  assert.equal(out.length, 3, "an idea that changes nothing is dropped, at most 3");
  assert.deepEqual(out[2].texts, ["four", "Fresh bread daily", "Open 8-20"]);
  assert.deepEqual(out[0].texts, ["Fresh Start", "Baked at dawn", "Open 8-20"]);
  assert.deepEqual(out[0].colors, ["#2b1b10", "#ffffff", "#e07a2f"]);
  assert.equal(out[0].name, "Warm");
  assert.deepEqual(out[1].texts, ["A", "B", "C"]);
  assert.deepEqual(AIT.parseIdeas("no json here", slots), []);
  assert.deepEqual(AIT.parseIdeas('{"ideas": [ {"texts": ["x"', slots), []);
  // a single idea object is accepted too
  assert.equal(AIT.parseIdeas('{"texts":["New","Words","Here"]}', slots).length, 1);
});

test("firstJson: skips braces inside strings and broken objects", () => {
  assert.deepEqual(AIT.firstJson('x {bad} {"a":"}{","b":1} y'), { a: "}{", b: 1 });
  assert.equal(AIT.firstJson("nothing"), null);
});

// ---------- aitext: palette ----------
test("colorMap: dark stays dark, light stays light", () => {
  const m = AIT.colorMap(["#ffffff", "#111111", "#cc3300"], ["#fdf6e3", "#1a1a2e", "#e94560", "#0f3460", "#f5d6ba"]);
  assert.ok(AIT.lum(m["#111111"]) < 0.05);
  assert.ok(AIT.lum(m["#ffffff"]) > 0.8);
  assert.ok(AIT.lum(m["#111111"]) < AIT.lum(m["#cc3300"]) && AIT.lum(m["#cc3300"]) < AIT.lum(m["#ffffff"]));
  assert.deepEqual(AIT.colorMap([], ["#000000"]), {});
  // one colour: light → the lightest, dark → the darkest
  assert.equal(AIT.colorMap(["#fafafa"], ["#000000", "#eeeeee"])["#fafafa"], "#eeeeee");
  assert.equal(AIT.colorMap(["#050505"], ["#000000", "#eeeeee"])["#050505"], "#000000");
});

test("recolor: only this page, never locked items, gradients and text effects too", () => {
  const d = doc.locked(doc());
  d.items.find((x) => x.id === "i-head").ax.tfx = { t: "shadow", color: "#cc3300" };
  const n = AIT.recolor(d, "p-1", ["#101820", "#fee715", "#ffffff"]);
  assert.ok(n >= 4);
  const by = (id) => d.items.find((x) => x.id === id).ax;
  assert.equal(by("i-bg").fc, "#ffffff");
  assert.equal(by("i-head").fc, "#101820");
  assert.equal(by("i-lock").fc, "#000000", "locked item untouched");
  assert.equal(by("i-other").fc, "#111111", "other page untouched");
  assert.equal(by("i-bar").g.a, by("i-bar").fc);
  assert.equal(by("i-head").tfx.color, by("i-bar").fc);
  d.items.find((x) => x.id === "i-bg").lock = 1;
  AIT.recolor(d, "p-1", ["#222222", "#eeeeee"]);
  assert.equal(by("i-bg").fc, "#eeeeee", "the page background follows, locked or not");
});

// ---------- cutout: pure steps ----------
test("prep: CHW tensor of the model's size, ImageNet-normalized", () => {
  const w = 4, h = 2, rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i * 4] = 255; rgba[i * 4 + 1] = 0; rgba[i * 4 + 2] = 0; rgba[i * 4 + 3] = 255; }
  const t = CUT.prep(rgba, w, h, 8);
  assert.equal(t.length, 3 * 8 * 8);
  assert.ok(Math.abs(t[0] - (1 - 0.485) / 0.229) < 1e-5, "red plane");
  assert.ok(Math.abs(t[64] - (0 - 0.456) / 0.224) < 1e-5, "green plane");
  assert.equal(CUT.prep(rgba, w, h).length, 3 * CUT.S * CUT.S);
});

test("toMask + alphaFor + applyAlpha: subject kept, background gone, soft edge", () => {
  const S = 4;
  const pred = new Float32Array([0, 0, 0, 0, 0, 5, 5, 0, 0, 5, 5, 0, 0, 0, 0, 0].map((v) => v - 1));
  const mask = CUT.toMask(pred, S);
  assert.equal(mask[0], 0);
  assert.equal(mask[5], 255);
  const a = CUT.alphaFor(mask, S, 8, 8);
  assert.equal(a.length, 64);
  assert.equal(a[0], 0, "corner gone");
  assert.equal(a[3 * 8 + 3], 255, "centre kept");
  assert.ok([...a].some((v) => v > 0 && v < 255), "a ramp between");
  // a looser edge keeps more
  const loose = CUT.alphaFor(mask, S, 8, 8, 0, 0.5), tight = CUT.alphaFor(mask, S, 8, 8, 0.5, 1);
  const sum = (x) => x.reduce((p, v) => p + v, 0);
  assert.ok(sum(loose) > sum(tight));
  const rgba = new Uint8ClampedArray(64 * 4).fill(200);
  const kept = CUT.applyAlpha(rgba, a);
  assert.equal(rgba[3], 0);
  assert.equal(rgba[(3 * 8 + 3) * 4 + 3], 200, "multiplied with the picture's own alpha");
  assert.ok(kept > 0.1 && kept < 0.9);
  // a flat prediction does not divide by zero
  assert.equal(CUT.toMask(new Float32Array(16), 4)[0], 0);
});

// ---------- wiring ----------
test("the tool files exist, ship with their licences and are not precached", () => {
  Object.values(CUT.FILES).forEach((rel) => {
    const p = path.join(ROOT, "atelier", rel);
    assert.ok(fs.existsSync(p), rel);
  });
  assert.ok(fs.existsSync(path.join(ROOT, "vendor/ort/LICENSE")));
  assert.ok(fs.existsSync(path.join(ROOT, "vendor/u2netp/LICENSE")));
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  assert.doesNotMatch(sw, /"vendor\/(ort|u2netp)\//, "16 MB stays out of the precache");
  ["atelier/aitext.js", "atelier/cutout.js", "atelier/ai.js"].forEach((f) => assert.ok(sw.includes('"' + f + '"'), f));
  const html = fs.readFileSync(path.join(ROOT, "atelier/index.html"), "utf8");
  ["../assistant/core.js", "aitext.js", "cutout.js", "ai.js"].forEach((f) => assert.ok(html.includes('src="' + f), f));
  assert.ok(html.indexOf('src="ai.js') < html.indexOf('src="io.js'));
});

test("ai.js only reads the Assistant's settings and keys, never writes them", () => {
  const s = fs.readFileSync(path.join(ROOT, "atelier/ai.js"), "utf8");
  assert.doesNotMatch(s, /setItem\(\s*ASSIST_DATA/);
  assert.doesNotMatch(s, /localStorage\.setItem/);
  assert.match(s, /indexedDB\.open\(ASSIST_DB\)/, "opened without a version: never upgrades it");
  assert.match(s, /onupgradeneeded = function \(\) \{ try \{ req\.transaction\.abort\(\)/, "a missing database is not created");
  assert.match(s, /transaction\(\["creds", "keys"\], "readonly"\)/);
  // strings: same keys in both languages
  const i = s.indexOf("  var STR = {"), j = s.indexOf("\n  };\n", i);
  const STR = new Function("return " + s.slice(i + "  var STR = ".length, j + 4).replace(/;\s*$/, ""))();
  assert.deepEqual(Object.keys(STR.el).sort(), Object.keys(STR.en).sort());
  const used = [...s.matchAll(/\bt\("([a-zA-Z0-9.]+)"/g)].map((m) => m[1]);
  const core = fs.readFileSync(path.join(ROOT, "atelier/core.js"), "utf8");
  AIT.KINDS.forEach((k) => assert.ok("ai.k." + k in STR.en, k));
  used.filter((k) => !k.endsWith(".")).forEach((k) => assert.ok(k in STR.en || core.includes('"' + k + '":'), k));
});

// ---------- editpic: the Photo Lab bridge (BR-PL-EDIT) ----------
test("editpic.parse: only well-formed keys and asset paths", () => {
  const EP = require("../atelier/editpic.js");
  const sha = "a".repeat(64);
  assert.equal(EP.keyOf("d-abc", "i-xyz"), "d-abc:i-xyz");
  assert.deepEqual(EP.parse({ key: "d-abc:i-xyz", path: "/internal/Assets/" + sha + ".png", w: 800.4, h: 600 }),
    { doc: "d-abc", item: "i-xyz", asset: sha + ".png", w: 800, h: 600 });
  assert.equal(EP.parse({ key: "d-abc:i-xyz", path: "/internal/Assets/../x.png" }), null);
  assert.equal(EP.parse({ key: "d-abc:i-xyz", path: "/internal/Assets/" + sha + ".gif" }), null);
  assert.equal(EP.parse({ key: "d-abc", path: "/internal/Assets/" + sha + ".png" }), null);
  assert.equal(EP.parse({ key: "D-ABC:i-xyz", path: "/internal/Assets/" + sha + ".png" }), null);
  assert.equal(EP.parse(null), null);
  assert.equal(EP.parse({ key: "d-abc:i-xyz", path: "/internal/Assets/" + sha + ".jpg", w: -1, h: "x" }).w, 0);
  const core = fs.readFileSync(path.join(ROOT, "atelier/core.js"), "utf8");
  assert.match(core, /tg\.editedPicture[\s\S]{0,80}AT\.editPic\.back\(tg\.editedPicture\)/);
});
