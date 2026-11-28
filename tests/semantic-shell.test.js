// Search by meaning (MEANING-1) in the shell, Settings and the
// Assistant: wiring that must not drift. The engine itself is tested
// in semantic-core.test.js and modelfetch.test.js; the whole flow in
// Chromium (/mnt/project-files/meaning-search/tools/meaning-e2e.js).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const shell = R("shell.js"), index = R("index.html"), sem = R("semantic.js");

test("nothing of it loads at boot: semantic files are fetched by the shell on demand", () => {
  for (const f of ["semantic.js", "semantic-core.js", "semantic-worker.js", "modelfetch.js"]) {
    assert.ok(fs.existsSync(path.join(__dirname, "..", f)), f);
    assert.ok(!index.includes(f), "index.html must not load " + f);
  }
  assert.match(shell, /recScript\("modelfetch\.js"\)/);
  assert.match(shell, /recScript\("semantic-core\.js"\)/);
  assert.match(shell, /recScript\("semantic\.js"\)/);
  assert.match(sem, /new Worker\("semantic-worker\.js" \+ SELF_V\)/);
});

test("the switch is device-local and off by default; the factory reset deletes the index", () => {
  assert.match(sem, /PREFS_KEY = "oros-meaning-prefs"/);
  assert.ok(!/^oros-[a-z]{2,30}-data$/.test("oros-meaning-prefs"), "never a synced key");
  assert.match(shell, /"oros-meaning", "oros-time-stage"/);
  assert.match(sem, /DB_NAME = "oros-meaning"/);
});

test("the model is pinned: mirror URL, parts and SHA-256 from oros-models-vision index.json", () => {
  assert.match(sem, /koulaxizis\.github\.io\/oros-models-vision\/multilingual-e5-small\//);
  assert.match(sem, /f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193/);
  assert.match(sem, /5c0910dc67c8e11fd0b05f871a0b5050bf0520a038d48152ae489bbf8a1a02ba/);
  assert.match(sem, /2c4265ec38dbf2236e01747e2ececd67fad7e257e6474dc6b6b25cc63c1748c6/);
  assert.match(sem, /0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39/);
});

test("only the four meaning apps, same list in the shell and the engine; locked and switched-off apps are left out", () => {
  const a = /var MEANING_APPS = (\[[^\]]+\])/.exec(shell)[1];
  const b = /var APPS = (\[[^\]]+\])/.exec(sem)[1];
  assert.deepEqual(JSON.parse(a), ["notes", "mail", "files", "feeds"]);
  assert.deepEqual(JSON.parse(b), JSON.parse(a));
  const allowed = shell.slice(shell.indexOf("function meaningAllowed"), shell.indexOf("function meaningLists"));
  assert.match(allowed, /searchEnabled\(a\.id\)/);
  assert.match(allowed, /!appLockSet\(a\.id\)/);
});

test("results are drawn with textContent only, and the Assistant keeps its permissions", () => {
  const draw = shell.slice(shell.indexOf("function appendMeaning"), shell.indexOf("wrap.setAttribute(\"data-app\", \"meaning\")"));
  assert.ok(draw.length > 500);
  assert.ok(!/innerHTML/.test(draw));
  const asst = R("assistant/assistant.js");
  assert.match(asst, /orosAssistSearch\(String\(um\.text \|\| ""\)\.slice\(0, 500\), ids, \{ meaning: true \}\)/);
  assert.match(asst, /if \(q && !label && p && typeof p\.orosAssistSearch === "function"\)/);
  // the meaning groups come only from the ids the Assistant allowed
  assert.match(shell, /meaningFind\(q, Object\.keys\(allow\)\)/);
});

test("strings in English, Greek and German", () => {
  const tr = R("translations.js"), de = R("i18n/de/shell.js"), sc = R("settings/core.js"), sde = R("i18n/de/settings.js");
  assert.equal((tr.match(/"search\.meaning":/g) || []).length, 2);
  assert.match(de, /"search\.meaning":/);
  for (const k of ["mn.title", "mn.hint", "mn.switch", "mn.size", "mn.getting", "mn.cancel", "mn.count", "mn.remove", "mn.removeSure", "mn.err.download", "mn.err.hash", "mn.err.quota"]) {
    assert.equal((sc.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length, 2, k);
    assert.match(sde, new RegExp('"' + k.replace(/\./g, "\\.") + '":'), k);
  }
  for (const f of ["settings/help.en.txt", "settings/help.el.txt", "i18n/de/help/settings.txt"]) {
    assert.match(R(f), /multilingual-e5-small/, f);
  }
});
