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

// AS-SYSAI 2: an address synced from another computer that does not
// answer here gives way to this computer's own local AI, unsaved.
const SYS = { state: "ready", url: "http://127.0.0.1:11434", models: ["qwen3:1.7b", "qwen3:8b"] };
const LAN = { m: 1, base: "http://192.168.1.20:11434/v1", model: "llama3:8b", kit: "ollama", fast: 1 };

test("sysai 2: the settings for this computer's own local AI", () => {
  const a = C.sysAIConf(LAN, SYS);
  assert.deepEqual(a, { base: C.LOCAL_KITS.ollama, model: "qwen3:8b", kit: "ollama", fast: 1, vis: 0, nt: 0, tm: "" });
  // A model installed here too stays.
  assert.equal(C.sysAIConf(Object.assign({}, LAN, { model: "qwen3:1.7b" }), SYS).model, "qwen3:1.7b");
  // "No tools" and its tool model (AS-GREEK 2) only with the same model, the tool model installed here.
  const gr = { base: LAN.base, model: "krikri-el", nt: 1, tm: "qwen3:8b" };
  const both = { state: "ready", url: "http://127.0.0.1:11434", models: ["krikri-el", "qwen3:8b"] };
  assert.deepEqual([C.sysAIConf(gr, both).nt, C.sysAIConf(gr, both).tm], [1, "qwen3:8b"]);
  assert.deepEqual([C.sysAIConf(gr, SYS).model, C.sysAIConf(gr, SYS).nt, C.sysAIConf(gr, SYS).tm], ["qwen3:8b", 0, ""]);
  const noTm = { state: "ready", url: "http://127.0.0.1:11434", models: ["krikri-el"] };
  assert.deepEqual([C.sysAIConf(gr, noTm).nt, C.sysAIConf(gr, noTm).tm], [1, ""]);
  // Nothing when it is not ready, or the address already is this computer's.
  assert.equal(C.sysAIConf(LAN, { state: "off", url: "", models: [] }), null);
  assert.equal(C.sysAIConf(LAN, null), null);
  assert.equal(C.sysAIConf({ base: "http://localhost:11434/v1" }, SYS), null);
  assert.equal(C.sysAIConf({ base: "http://127.0.0.1:11434" }, SYS), null);
  assert.equal(C.sysAIConf({ base: "" }, SYS), null);
});

function fakeFetch(up) {
  const calls = [];
  global.fetch = (url, o) => {
    calls.push({ url: url, auth: (o.headers || {}).Authorization || (o.headers || {}).authorization || "" });
    return up.some((u) => url.indexOf(u) === 0) ? Promise.resolve({ ok: true, status: 200 }) : Promise.reject(new TypeError("Failed to fetch"));
  };
  return calls;
}

test("sysai 2: a synced address that does not answer gives way, with no key", async () => {
  C.probeSet("");
  const calls = fakeFetch(["http://localhost:11434"]);
  const ok = await C.probeLocal("local", LAN, () => Promise.resolve("secret"), SYS);
  assert.equal(ok, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /^http:\/\/192\.168\.1\.20:11434\/v1\//);
  assert.match(calls[1].url, /^http:\/\/localhost:11434\/v1\//);
  assert.equal(calls[1].auth, "");
  const use = C.localUse("local", LAN);
  assert.equal(use.base, C.LOCAL_KITS.ollama);
  assert.equal(use.model, "qwen3:8b");
  assert.equal(use.sys, 1);
  // The synced settings are not touched.
  assert.equal(LAN.base, "http://192.168.1.20:11434/v1");
  // Another service is never redirected.
  assert.equal(C.localUse("groq", { model: "m" }).sys, undefined);
  // Both checks are kept: the next turn waits for neither.
  const again = await C.probeLocal("local", LAN, null, SYS);
  assert.equal(again, true);
  assert.equal(calls.length, 2);
  C.probeSet("");
  assert.equal(C.localUse("local", LAN).sys, undefined);
});

test("sysai 2: the synced address wins whenever it answers", async () => {
  C.probeSet("");
  const calls = fakeFetch(["http://192.168.1.20:11434", "http://localhost:11434"]);
  assert.equal(await C.probeLocal("local", LAN, null, SYS), true);
  assert.equal(calls.length, 1);
  assert.equal(C.localUse("local", LAN).base, LAN.base);
  // Neither answers: down, and nothing stands in.
  C.probeSet("");
  fakeFetch([]);
  assert.equal(await C.probeLocal("local", LAN, null, SYS), false);
  assert.equal(C.localUse("local", LAN).sys, undefined);
  // No local AI on this computer: only the synced address is checked.
  C.probeSet("");
  const c2 = fakeFetch([]);
  assert.equal(await C.probeLocal("local", LAN, null, null), false);
  assert.equal(c2.length, 1);
});

test("sysai 2: the order of use takes the local service through it", async () => {
  C.probeSet("");
  fakeFetch(["http://localhost:11434"]);
  const d = data({ prov: "local" }, { local: LAN });
  const r = await C.pickChain(d, { readKey: () => Promise.resolve(""), sys: SYS });
  assert.equal(r.pid, "local");
  assert.equal(C.localUse("local", d.provs.local).sys, 1);
  C.probeSet("");
  // Feeds, Atelier and the Assistant all call with it.
  for (const f of ["feeds/ai.js", "atelier/ai.js"]) assert.match(read(f), /localUse\(pid/, f);
  assert.match(read("assistant/assistant.js"), /useConf\(pid\)/);
  for (const f of ["assistant/assistant.js", "i18n/de/assistant.js"]) assert.match(read(f), /"set\.chain\.sys"/, f);
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
