// AS-SYSAI: the local AI that orOS USB installs (System › Local AI) is
// found on the shell's page and used with no setting; quick answers.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "assistant/core.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const doc = (attrs) => ({ documentElement: { getAttribute: (k) => (k in attrs ? attrs[k] : null) } });
const data = (set, provs) => C.mergeAssist({ set: Object.assign({ m: 2 }, set), provs: provs || {} }, null);

test("sysai: reads the extension's attributes, strictly", () => {
  assert.equal(C.sysAIRead(doc({})), null);
  assert.equal(C.sysAIRead(null), null);
  assert.equal(C.sysAIRead(doc({ "data-oros-sys-ai": "weird" })), null);
  assert.deepEqual(C.sysAIRead(doc({ "data-oros-sys-ai": "none" })), { state: "none", url: "", models: [] });
  assert.deepEqual(C.sysAIRead(doc({ "data-oros-sys-ai": "ready", "data-oros-sys-ai-url": "http://127.0.0.1:11434",
    "data-oros-sys-ai-models": "qwen3:8b  qwen3:1.7b" })), { state: "ready", url: "http://127.0.0.1:11434", models: ["qwen3:8b", "qwen3:1.7b"] });
  // Anything but this computer's Ollama, or no model, is not "ready".
  assert.equal(C.sysAIRead(doc({ "data-oros-sys-ai": "ready", "data-oros-sys-ai-url": "https://evil.example",
    "data-oros-sys-ai-models": "qwen3:8b" })).state, "off");
  assert.equal(C.sysAIRead(doc({ "data-oros-sys-ai": "ready", "data-oros-sys-ai-url": "http://127.0.0.1:11434",
    "data-oros-sys-ai-models": "<img>" })).state, "off");
});

test("sysai: the biggest model wins", () => {
  assert.equal(C.sysAIModel(["qwen3:1.7b", "qwen3:8b", "qwen3:4b"]), "qwen3:8b");
  assert.equal(C.sysAIModel(["qwen3:1.7b"]), "qwen3:1.7b");
  assert.equal(C.sysAIModel([]), "");
});

test("sysai: a fresh assistant takes it with no setting, with quick answers", () => {
  const sys = { state: "ready", url: "http://127.0.0.1:11434", models: ["qwen3:4b"] };
  const a = C.sysAIAdopt(data({}), sys);
  assert.deepEqual(a.prov, { base: C.LOCAL_KITS.ollama, model: "qwen3:4b", kit: "ollama", fast: 1 });
  assert.deepEqual(a.set, { prov: "local" });
  // Nothing when it is not ready.
  assert.deepEqual(C.sysAIAdopt(data({}), { state: "none", url: "", models: [] }), { prov: null, set: null });
});

test("sysai: the person's own choices stay", () => {
  const sys = { state: "ready", url: "http://127.0.0.1:11434", models: ["qwen3:4b", "qwen3:8b"] };
  // Another assistant chosen: only the local service is pointed at it.
  let a = C.sysAIAdopt(data({ prov: "anthropic" }), sys);
  assert.equal(a.set, null);
  assert.equal(a.prov.model, "qwen3:8b");
  // Already set up, model still there: nothing changes (quick answers too).
  const set = data({ prov: "local" }, { local: { m: 1, base: C.LOCAL_KITS.ollama, model: "qwen3:4b", kit: "ollama", fast: 0 } });
  assert.deepEqual(C.sysAIAdopt(set, sys), { prov: null, set: null });
  // Set up for another server on the computer (LM Studio): left alone.
  const lm = data({ prov: "local" }, { local: { m: 1, base: "http://localhost:1234/v1", model: "x", kit: "lmstudio" } });
  assert.deepEqual(C.sysAIAdopt(lm, sys), { prov: null, set: null });
  // Its model removed: the biggest one left.
  const gone = data({ prov: "local" }, { local: { m: 1, base: "http://127.0.0.1:11434/v1", model: "qwen3:1.7b" } });
  a = C.sysAIAdopt(gone, sys);
  assert.equal(a.prov.model, "qwen3:8b");
  assert.equal(a.prov.fast, undefined);
});

test("sysai: quick answers send reasoning_effort none, only to a local server", () => {
  const msgs = [{ r: "user", text: "Hi" }];
  let req = C.buildRequest("local", { base: C.LOCAL_KITS.ollama, model: "qwen3:4b", fast: 1 }, msgs, {});
  assert.equal(req.body.reasoning_effort, "none");
  req = C.buildRequest("local", { base: C.LOCAL_KITS.ollama, model: "qwen3:4b" }, msgs, {});
  assert.equal("reasoning_effort" in req.body, false);
  req = C.buildRequest("groq", { key: "k", model: "m", fast: 1 }, msgs, {});
  assert.equal("reasoning_effort" in req.body, false);
  // The flag syncs.
  const m = C.mergeAssist({ provs: { local: { m: 3, base: C.LOCAL_KITS.ollama, model: "q", fast: 1 } } }, null);
  assert.equal(m.provs.local.fast, 1);
});

test("sysai: the Assistant watches the page and offers the install", () => {
  const js = read("assistant/assistant.js");
  assert.match(js, /attributeFilter: \["data-oros-sys-ai"/);
  assert.match(js, /sysAIAsk\("install"\)/);
  assert.match(read("assistant/index.html"), /id="wel-local"/);
  for (const k of ["wel.sys", "sys.title", "sys.install", "sys.none", "sys.ready", "sys.use", "sys.used", "sys.off", "sys.manage", "set.fast", "set.fastHint"]) {
    assert.match(read("i18n/de/assistant.js"), new RegExp('"' + k.replace(".", "\\.") + '"'), k);
  }
});
