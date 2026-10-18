// Recipes wave A3 (recipes/share.js, assistant propose_automation):
// automations travel as data only. The catalog copies match the apps',
// a .orosrecipe file is checked when it is read, drafts open in the
// editor with what passes, and the Assistant's tool names every field.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const R = require("../recipes/core.js");
const SH = require("../recipes/share.js");
const A = require("../assistant/core.js");

const REAL = {
  atelier: require("../atelier/recipesteps.js").CATALOG,
  layout: require("../layout/recipesteps.js").CATALOG,
  photolab: require("../photolab/recipesteps.js").CATALOG
};
const plainJSON = (x) => JSON.parse(JSON.stringify(x));
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

test("the catalog copies are the apps' catalogs, and the guide names every step and field", () => {
  assert.deepEqual(SH.APPS, Object.keys(REAL));
  for (const app of SH.APPS) {
    assert.deepEqual(plainJSON(SH.CATALOGS[app]), plainJSON(REAL[app]), app);
    const ops = SH.GUIDE[app].ops;
    assert.deepEqual(Object.keys(ops).sort(), Object.keys(REAL[app]).sort(), app + " ops");
    for (const op of Object.keys(REAL[app])) {
      for (const k of Object.keys(REAL[app][op].args || {})) {
        assert.ok(new RegExp("\\b" + k + "\\b").test(ops[op]), app + "." + op + " names " + k);
      }
    }
  }
  const text = SH.forModel(["layout"]);
  assert.ok(/^layout: /.test(text) && !/atelier:/.test(text));
});

test("a file: round trip, newer steps kept, everything else refused", () => {
  const rec = { id: "rc-abcdef123456", m: 5, app: "photolab", nm: "Web: photos/2026", pos: 3,
    steps: [{ op: "resize", mode: "long", v: 1080, up: 0 }, { op: "frame", width: 9 }] };
  const text = SH.pack(rec);
  const o = JSON.parse(text);
  assert.deepEqual(Object.keys(o), ["format", "ver", "app", "name", "steps"], "no id, stamp or place travels");
  const back = SH.unpack(text);
  assert.ok(back.ok);
  assert.deepEqual(back.draft, { app: "photolab", nm: "Web: photos/2026", steps: [{ mode: "long", op: "resize", up: 0, v: 1080 }, { op: "frame", width: 9 }] });
  assert.equal(R.check(back.draft, REAL.photolab).skipped, 1, "the step of a newer orOS is kept and skipped");
  assert.equal(SH.fileName(rec.nm), "Web photos 2026.orosrecipe");
  assert.equal(SH.fileName("  "), "automation.orosrecipe");

  assert.deepEqual(SH.unpack("x".repeat(SH.MAX_FILE + 1)), { ok: false, err: "big" });
  assert.deepEqual(SH.unpack("{not json"), { ok: false, err: "json" });
  assert.deepEqual(SH.unpack(JSON.stringify({ app: "photolab", steps: [] })), { ok: false, err: "format" });
  assert.deepEqual(SH.unpack(JSON.stringify({ format: "orosrecipe", ver: 1, app: "music", name: "x", steps: [{ op: "a" }] })), { ok: false, err: "app", app: "music" });
  assert.deepEqual(SH.unpack(JSON.stringify({ format: "orosrecipe", ver: 1, app: "layout", name: "x", steps: [{ nope: 1 }, "rm -rf"] })), { ok: false, err: "empty" });
  // a step can only carry plain data: odd keys or a too deep value drop it
  const odd = SH.unpack('{"format":"orosrecipe","ver":1,"app":"layout","steps":[{"op":"text","find":"a","__proto__":{"x":1}},{"op":"text","find":"b"}]}');
  assert.ok(odd.ok);
  assert.deepEqual(odd.draft.steps, [{ find: "b", op: "text" }]);
  assert.equal(SH.unpack("﻿" + text).ok, true, "a byte order mark is fine");
});

test("prepare: numbers written as text, half-right steps keep what passes, unknown steps stay", () => {
  const cat = SH.CATALOGS.photolab;
  const base = (op) => Object.assign({ op }, op === "watermark" ? { text: "", size: 5, c: "", pos: "br", opacity: 60 } : {});
  const pr = SH.prepare([
    { op: "export", fmt: "jpg", q: "85" },
    { op: "watermark", size: "12", pos: "nowhere" },
    { op: "noise", amt: 20, mono: "false" },
    { op: "laser", power: 9 }
  ], cat, base);
  assert.equal(pr.bad, 1);
  assert.equal(pr.newer, 1);
  assert.deepEqual(pr.steps[0], { op: "export", fmt: "jpg", q: 85 });
  assert.deepEqual(pr.steps[1], { op: "watermark", text: "", size: 12, c: "", pos: "br", opacity: 60 }, "the editor marks it: text is missing");
  assert.equal(R.normStep(pr.steps[1], cat), null);
  assert.deepEqual(pr.steps[2], { op: "noise", amt: 20, mono: 0 });
  assert.deepEqual(pr.steps[3], { op: "laser", power: 9 });
  const at = SH.prepare([{ op: "color", from: "FFF", to: "#00AA00" }, { op: "export", fmt: "png", scale: "2" },
    { op: "resize", sizes: [{ w: "1080", h: 1350 }] }], SH.CATALOGS.atelier, null);
  assert.equal(at.bad, 0);
  assert.deepEqual(at.steps[0], { op: "color", from: "#ffffff", to: "#00aa00" });
  assert.equal(at.steps[1].scale, 2);
  assert.deepEqual(at.steps[2].sizes, [{ w: 1080, h: 1350, u: "px", p: "" }]);
});

test("problems: what the model has to fix, in plain English", () => {
  assert.deepEqual(SH.problems("layout", [{ op: "export", q: "screen" }]), []);
  const p = SH.problems("layout", [{ op: "margins", t: 10 }, { op: "blur" }, null]);
  assert.match(p[0], /^step 1 \(margins\): b must be a number 0-500\.$/);
  assert.match(p[3], /^step 2: layout has no step "blur"; its steps are text, pstyle/);
  assert.match(p[4], /^step 3 is not an object\.$/);
  assert.deepEqual(SH.problems("music", []), ["app must be one of: atelier, layout, photolab."]);
  assert.deepEqual(SH.problems("atelier", []), ["steps is empty: give at least one step."]);
});

test("every step reads in plain words, in English and Greek", () => {
  for (const app of SH.APPS) {
    for (const op of Object.keys(REAL[app])) {
      const def = REAL[app][op], st = { op };
      for (const k of Object.keys(def.args || {})) {
        const a = def.args[k];
        st[k] = a.t === "list" ? [{ w: 100, h: 50, u: "px", p: "" }] : a.def !== undefined ? a.def : a.t === "color" ? "#123456" : a.t === "font" ? "fs_open_sans" : a.t === "num" ? a.lo : a.t === "bool" ? 1 : "Word";
      }
      const c = R.normStep(st, REAL[app]);
      assert.ok(c, app + "." + op);
      const w = SH.words(app, c);
      assert.ok(w.name && !/^sh\./.test(w.name), app + "." + op + " has a name");
      assert.ok(!/sh\.|undefined|NaN/.test(w.detail), app + "." + op + ": " + w.detail);
    }
  }
  assert.equal(SH.words("atelier", { op: "font", from: "", to: "fs_open_sans" }).detail, "any font → Open Sans");
  assert.equal(SH.words("layout", { op: "text", find: "2025", repl: "", cs: 0, word: 0 }).detail, "remove “2025”");
  assert.equal(SH.words("photolab", { op: "laser" }).name, "A step this orOS does not know (skipped)");
  // Greek: every English key has a Greek one
  global.window = { orosI18n: { table: (t) => { assert.deepEqual(Object.keys(t.el).sort(), Object.keys(t.en).sort()); return t.el; } } };
  try {
    delete require.cache[require.resolve("../recipes/share.js")];
    const G = require("../recipes/share.js");
    assert.equal(G.words("photolab", { op: "watermark", text: "©", size: 5, c: "", pos: "br", opacity: 60 }).detail, "“©” · κάτω δεξιά");
    assert.equal(G.appName("layout"), "Σελιδοποίηση");
  } finally { delete global.window; delete require.cache[require.resolve("../recipes/share.js")]; }
});

test("the Assistant's tool: every field of every step is declared, apps are the installed ones", () => {
  const t = A.toolsFor({ recipes: ["photolab", "atelier"] }).find((x) => x.name === "propose_automation");
  assert.ok(t);
  assert.deepEqual(t.params.properties.app.enum, ["photolab", "atelier"]);
  const props = t.params.properties.steps.items.properties;
  for (const app of SH.APPS) for (const op of Object.keys(REAL[app])) {
    for (const k of Object.keys(REAL[app][op].args || {})) assert.ok(props[k], k + " is declared");
  }
  for (const k of Object.keys(props)) assert.ok(props[k].type, k + " has a type (Gemini)");
  assert.ok(t.description.includes("photolab: ") && t.description.includes("atelier: ") && !t.description.includes("layout: "));
  assert.ok(!A.toolsFor({}).some((x) => x.name === "propose_automation"));
  assert.ok(!A.toolsFor({ recipes: [] }).some((x) => x.name === "propose_automation"));
  // Gemini keeps the schema (it has properties)
  const req = A.buildRequest("gemini", { key: "k", model: "gemini-2.5-flash" }, [{ r: "user", text: "hi" }], { tools: [t] });
  assert.ok(JSON.stringify(req.body || req).includes("propose_automation"));
  const sys = A.systemPrompt({ recipes: ["Photo Lab (photolab)"], entries: [] });
  assert.match(sys, /propose_automation/);
  assert.ok(!/propose_automation/.test(A.systemPrompt({ builtin: true, recipes: ["Photo Lab (photolab)"] })));
});

test("normAutomation: the card's steps, refusals the model can act on", () => {
  const has = (id) => id !== "layout";
  const ok = A.normAutomation({ app: "photolab", name: "  Web   photos ", steps: [
    { op: "resize", mode: "long", v: "1080" }, { op: "watermark", text: "© Chris", pos: "br" }, { op: "export", fmt: "jpg", q: 85 }] }, has);
  assert.ok(ok.ok);
  assert.equal(ok.nm, "Web photos");
  assert.equal(ok.steps.length, 3);
  assert.deepEqual(R.check(ok, REAL.photolab), { steps: ok.steps.map((s) => R.normStep(s, REAL.photolab)), skipped: 0 });
  assert.deepEqual(ok.view.map((w) => w.name), ["Resize", "Watermark", "Export to Pictures"]);
  assert.equal(ok.view[0].detail, "long side 1080 px");
  assert.match(A.normAutomation({ app: "layout", name: "x", steps: [{ op: "export" }] }, has).err, /not installed/);
  assert.match(A.normAutomation({ app: "photolab", name: "x", steps: [{ op: "export", fmt: "gif" }] }, has).err, /^step 1 \(export\): fmt must be one of jpg\|png\|webp\./);
  assert.match(A.normAutomation({ app: "photolab", steps: "all" }, has).err, /steps is empty/);
  assert.match(A.normAutomation(null).err, /app must be/);
});

test("wiring: pages load share.js after core.js, the apps take { newRecipe }, nothing writes HTML", () => {
  for (const p of ["atelier/index.html", "layout/index.html", "photolab/index.html", "assistant/index.html"]) {
    const s = read(p), a = s.indexOf("recipes/core.js"), b = s.indexOf("recipes/share.js");
    assert.ok(a > 0 && b > a, p);
    assert.match(s, /data-app="[^"]*\brecipes\b/, p + " loads the recipes pack");
  }
  assert.ok(read("assistant/index.html").indexOf("recipes/share.js") < read("assistant/index.html").indexOf('src="core.js'));
  assert.match(read("atelier/core.js"), /tg\.newRecipe[\s\S]{0,120}AT\.recipes\.draft\(tg\.newRecipe\)/);
  assert.match(read("layout/layout.js"), /tg\.newRecipe[\s\S]{0,120}LY\.recipes\.draft\(tg\.newRecipe\)/);
  assert.match(read("photolab/app.js"), /target\.newRecipe[\s\S]{0,120}PL\.recipes\.draft\(target\.newRecipe\)/);
  assert.match(read("photolab/recipes.js"), /draft: panel\.draft/);
  assert.match(read("sw.js"), /"recipes\/share\.js"/);
  for (const p of ["recipes/share.js", "recipes/ui.js", "atelier/recipes.js"]) assert.ok(!/innerHTML|eval\(|new Function/.test(read(p)), p);
  // the card is drawn with textContent only
  const as = read("assistant/assistant.js"), card = as.slice(as.indexOf("function drawRecipe"), as.indexOf("function saveRecipeFile"));
  assert.ok(card.length > 200 && !/innerHTML/.test(card));
});
