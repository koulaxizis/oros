// Passwords: secrets copied through the Android app, marked sensitive
// (PW-CLIP, BR-PHONE v14). phone.js runs in a VM with a fake app port:
// a secret goes to the app only when the app says it knows how, the
// answer is matched by seq, no answer falls back; solo.js relays clip
// for orOS Passwords; pmapp.js / passwords.js use it for secrets only;
// the Android side marks the copy sensitive, clears it itself and never
// logs the text.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const JAVA = ["android", "app", "src", "main", "java", "online", "useoros", "twa"];

function boot() {
  const handlers = {}, timers = [];
  const store = {};
  const root = {
    document: { hidden: false, addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, documentElement: { lang: "en" } },
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    location: { origin: "https://useoros.online", href: "" },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    crypto: require("crypto").webcrypto,
    console: { warn() {}, log() {} },
    setInterval: () => 0, clearInterval() {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (i) => { if (timers[i - 1]) timers[i - 1].fn = null; },
    JSON, Math, Date, Promise, Array, Object, String, Number, RegExp, Error, Intl, Uint8Array
  };
  root.window = root;
  root.parent = root;
  const ctx = vm.createContext(root);
  // as a browser loads it: no module, the IIFE gets window
  vm.runInContext(read("phone.js"), ctx, { filename: "phone.js" });
  const sent = [];
  const port = { postMessage: (s) => sent.push(JSON.parse(s)), close() {}, onmessage: null };
  handlers.message.forEach((fn) => fn({ ports: [port], source: null, origin: "https://useoros.online" }));
  const fromApp = (m) => port.onmessage({ data: JSON.stringify(m) });
  return { P: root.orosPhone, sent, fromApp, timers };
}

test("PW-CLIP phone.js: nothing goes to an app that never said clip:true", async () => {
  const { P, sent, fromApp } = boot();
  assert.equal(P.clipAvailable(), false);
  assert.equal(await P.clip("hunter2-secret", 30000), false);
  fromApp({ t: "state", contacts: "ask", calendar: "ask" });      // an older app
  assert.equal(P.clipAvailable(), false);
  assert.equal(await P.clip("hunter2-secret", 30000), false);
  assert.ok(!sent.some((m) => m.t === "clip"), "the secret never left the page");
});

test("PW-CLIP phone.js: the app copies it; the answer is matched by seq; clear", async () => {
  const { P, sent, fromApp } = boot();
  fromApp({ t: "state", contacts: "ask", calendar: "ask", clip: true });
  assert.equal(P.clipAvailable(), true);
  const done = P.clip("hunter2-secret", 30000);
  const m = sent.filter((x) => x.t === "clip").pop();
  assert.deepEqual(Object.keys(m).sort(), ["ms", "op", "seq", "t", "text"]);
  assert.equal(m.op, "set"); assert.equal(m.text, "hunter2-secret"); assert.equal(m.ms, 30000);
  fromApp({ t: "done", what: "clip", seq: m.seq + 1, op: "set" });    // another request's answer
  fromApp({ t: "done", what: "clip", seq: m.seq, op: "set" });
  assert.equal(await done, true);
  const err = P.clip("other-secret", 30000);
  const m2 = sent.filter((x) => x.t === "clip").pop();
  fromApp({ t: "error", what: "clip", seq: m2.seq, msg: "SecurityException" });
  assert.equal(await err, false, "an error falls back to the web copy");
  assert.ok(P.clipClear());
  assert.deepEqual((({ t, op }) => ({ t, op }))(sent.pop()), { t: "clip", op: "clear" });
  // empty or huge text never goes
  assert.equal(await P.clip("", 30000), false);
  assert.equal(await P.clip("x".repeat(100001), 30000), false);
});

test("PW-CLIP phone.js: no answer within 3 s falls back", async () => {
  const { P, fromApp, timers } = boot();
  fromApp({ t: "af-state", af: {}, pkg: "online.useoros.passwords", clip: true });
  const p = P.clip("hunter2-secret", 30000);
  const t = timers.filter((x) => x.fn && x.ms === 3000).pop();
  t.fn();
  assert.equal(await p, false);
});

test("PW-CLIP pages: Passwords and the generator copy secrets through the app, usernames the web way", () => {
  const pm = read("passwords", "pmapp.js");
  assert.match(pm, /var p = secret \? clipApp\(\) : null;/, "only secrets go to the app");
  assert.match(pm, /p\.clip\(text, CLIP_MS\)/);
  assert.match(pm, /return writeClip\(text\)\.then/, "fallback: the web copy");
  assert.match(pm, /if \(clip\.app\) \{[\s\S]*?p\.clipClear\(\)/, "Lock clears the app's copy");
  const gen = read("passwords", "passwords.js");
  assert.match(gen, /p\.clip\(value, prefs\.clear \? CLEAR_MS : 0\)/);
  for (const f of ["help.en.txt", "help.el.txt"]) assert.match(read("passwords", f), /Android/, f);
});

test("PW-CLIP solo.js: orOS Passwords relays clip both ways, nothing more", () => {
  const so = read("solo.js");
  assert.match(so, /var TO_APP = \{ "pw-bio": 1, "af-keys": 1, "af-index": 1, "af-state": 1, "clip": 1 \};/);
  assert.match(so, /var TO_PAGE = \{ "pw-bio": 1, "af-keys": 1, "af-state": 1, "af-save": 1 \};/, "no plain clip to the page");
  assert.match(so, /\(\(m\.t === "done" \|\| m\.t === "error"\) && m\.what === "clip"\)/);
});

test("PW-CLIP Android: sensitive flag, own clear, never logs the text", () => {
  const clip = read(...JAVA, "Clip.java");
  assert.match(clip, /ClipDescription\.EXTRA_IS_SENSITIVE/);
  assert.match(clip, /"android\.content\.extra\.IS_SENSITIVE"/, "older Android: the same key by name");
  assert.match(clip, /cd\.getDescription\(\)\.setExtras\(ex\)/);
  assert.match(clip, /cm\.clearPrimaryClip\(\)/);
  assert.match(clip, /if \(gen == my\) clear\(app\)/, "only the latest copy's timer clears");
  assert.ok(!/Log\.|diag\(/.test(clip), "Clip never logs");
  const br = read(...JAVA, "PhoneBridge.java");
  const takes = /static boolean soloTakes\(String t, JSONObject m\) \{([\s\S]*?)\n    \}/.exec(br)[1];
  assert.match(takes, /"clip"\.equals\(t\)/, "orOS Passwords takes clip");
  const c = /case "clip": \{([\s\S]*?)\n                \}/.exec(br)[1];
  assert.match(c, /Clip\.set\(app, text, ms\)/);
  assert.match(c, /text\.length\(\) > Clip\.MAX_CHARS/);
  assert.ok(!/diag\([^;]*text\b[^;]*\);/.test(c.replace(/never the text/, "")), "diag never gets the text");
  assert.equal((br.match(/o\.put\("clip", true\)/g) || []).length, 2, "state and af-state announce it");
});
