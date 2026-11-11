// New users, wave 3: "Show me an example" (EXAMPLE-1, emptykit.js 1.1.0
// + emptykit-ex.js): a read-only preview of made-up rows inside the
// friendly empty screen. Nothing of the app is read or written.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const K = require(path.join(ROOT, "emptykit.js"));
const X = require(path.join(ROOT, "emptykit-ex.js"));

test("example: the kit and the examples name the same apps, all of them dressed apps", () => {
  assert.deepEqual(K.EX_APPS.slice().sort(), X.APPS.slice().sort());
  assert.deepEqual(X.APPS.slice().sort(), ["bookmarks", "budget", "contacts", "invoices", "kanban", "meals", "notes", "todo"]);
  for (const a of X.APPS) {
    assert.match(read(a + "/" + a + ".js"), new RegExp('window\\.orosEmpty\\.dress\\([^\\n]*\\{ app: "' + a + '"'), a + " dresses its empty screen");
  }
});

test("example: every app has 3 to 6 rows in EN, EL and DE, same shape in each language", () => {
  for (const a of X.APPS) {
    const en = X.get(a, "en").rows;
    assert.ok(en.length >= 3 && en.length <= 6, a);
    for (const l of ["el", "de"]) {
      const rows = X.get(a, l).rows;
      assert.equal(rows.length, en.length, a + " " + l);
      rows.forEach((r, i) => {
        assert.ok(typeof r.t === "string" && r.t.length > 1 && r.t.length <= 80, a + " " + l + " t");
        assert.ok(typeof r.m === "string" && r.m.length > 1 && r.m.length <= 120, a + " " + l + " m");
        assert.equal(!!r.g, !!en[i].g, a + " " + l + " group");
        assert.notEqual(r.t, en[i].t, a + " " + l + " translated");
      });
    }
  }
  assert.deepEqual(X.get("todo", "fr"), X.get("todo", "en"), "another language reads English");
  assert.equal(X.get("passwords", "en"), null);
  assert.equal(X.get("__proto__", "en"), null);
});

test("example: get() is pure, a fresh copy each time", () => {
  const a = X.get("kanban", "en");
  a.rows[0].t = "changed";
  a.rows.pop();
  const b = X.get("kanban", "en");
  assert.notEqual(b.rows[0].t, "changed");
  assert.equal(b.rows.length, 4);
});

test("example: made up only; no real names, addresses or links", () => {
  const src = read("emptykit-ex.js");
  assert.doesNotMatch(src, /https?:|@[a-z]|localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|postMessage|innerHTML/);
  for (const a of X.APPS) for (const l of ["en", "el", "de"]) {
    for (const r of X.get(a, l).rows) assert.doesNotMatch(r.t + r.m, /[<>]/);
  }
});

test("example: the kit paints it through textContent, stores nothing, never calls the app but for Start my own", () => {
  const src = read("emptykit.js");
  assert.deepEqual(src.match(/innerHTML = [a-z]+/g), ["innerHTML = svg"]);
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|postMessage/);
  const open = src.slice(src.indexOf("  function exampleOpen("), src.indexOf("  var api = "));
  assert.doesNotMatch(open, /state|save|sync|orosSync|parent\./, "no app state, no save, no sync");
  assert.equal((open.match(/el\.__ekRun\(\)/g) || []).length, 1, "only Start my own runs the app's main action");
  assert.match(open, /t\.textContent = String\(r\.t\);/);
  assert.match(open, /m\.textContent = String\(r\.m \|\| ""\);/);
  assert.match(src, /s\.src\.replace\(\/emptykit\\\.js\(\?=\\\?\|#\|\$\)\/, "emptykit-ex\.js"\)/, "loaded from next to the kit, only on the first tap");
  assert.match(src, /if \(el\.classList\.contains\("ek-ex-on"\) && !el\.querySelector\(":scope > \.ek-ex"\)\) el\.classList\.remove\("ek-ex-on"\);/);
});

test("example: strings EN, EL, DE; styles; precached", () => {
  for (const l of ["en", "el", "de"]) {
    for (const k of ["show", "note", "mine", "close", "label"]) assert.ok(K.STR[l][k] && K.STR[l][k].length > 2, l + " " + k);
  }
  assert.match(K.STR.en.note, /Nothing is saved/);
  const css = read("emptykit.css");
  assert.match(css, /\.ek \.ek-act\.ek-alt \{/);
  assert.match(css, /\.ek\.ek-ex-on > \.ek-acts \{ display: none; \}/);
  assert.match(css, /html\[data-oros-contrast="high"\] \.ek > \.ek-ex \{/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.ek > \.ek-ex \{ animation: none; \} \}/);
  assert.match(read("sw.js"), /"emptykit\.css",\n  "emptykit-ex\.js",/);
});
