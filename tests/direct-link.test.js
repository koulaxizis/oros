// Direct app links (DL-1): useoros.online/<app>/ opened in the top
// window replaces itself with the shell, which opens that app and
// hands it the original ?query#hash (shell.js launchAppSuffix).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const APPS = JSON.parse(read("apps.json")).apps.filter((a) => a.type === "internal");
const SNIP_RE = /<script>(if \(window\.top === window\.self[^<]*)<\/script>/;

function runSnippet(code, opts) {
  const calls = [];
  const win = {};
  win.self = win;
  win.top = opts.framed ? {} : win;
  const location = {
    search: opts.search || "",
    hash: opts.hash || "",
    replace: (u) => calls.push(u),
  };
  const store = opts.lock ? { "oros-lock": "{}" } : {};
  const localStorage = { getItem: (k) => (k in store ? store[k] : null) };
  vm.runInNewContext(code, { window: win, location, encodeURIComponent, localStorage });
  return calls;
}

test("every registered app page carries the DL-1 snippet for its own id, before any other script", () => {
  assert.ok(APPS.length > 50);
  APPS.forEach((a) => {
    const html = read(a.url + "index.html");
    const m = SNIP_RE.exec(html);
    assert.ok(m, a.id + ": DL-1 snippet missing");
    assert.ok(m[1].includes('"../?open=' + a.id + '"'), a.id + ": snippet names another app");
    const firstScript = html.indexOf("<script");
    assert.equal(firstScript, m.index, a.id + ": DL-1 must be the first script");
    assert.ok(m.index < html.indexOf("</head>"), a.id + ": DL-1 must sit in <head>");
  });
});

test("top window → shell with the app id; query and hash travel in app-at", () => {
  const code = SNIP_RE.exec(read("maps/index.html"))[1];
  assert.deepEqual(runSnippet(code, {}), ["../?open=maps"]);
  assert.deepEqual(runSnippet(code, { search: "?q=Athens&x=1" }),
    ["../?open=maps&app-at=" + encodeURIComponent("?q=Athens&x=1")]);
  assert.deepEqual(runSnippet(code, { hash: "#c=abc" }),
    ["../?open=maps&app-at=" + encodeURIComponent("#c=abc")]);
});

test("inside the shell frame, or with ?standalone, the page stays put", () => {
  const code = SNIP_RE.exec(read("notes/index.html"))[1];
  assert.deepEqual(runSnippet(code, { framed: true, search: "?q=1" }), []);
  assert.deepEqual(runSnippet(code, { search: "?standalone" }), []);
  assert.deepEqual(runSnippet(code, { search: "?a=1&standalone=1" }), []);
  assert.equal(runSnippet(code, { search: "?standalonex" }).length, 1);
});

test("shell accepts only a query/fragment as app-at", () => {
  const src = read("shell.js");
  const m = /function launchAppSuffix\(v\) \{[\s\S]*?\n  \}/.exec(src);
  assert.ok(m, "launchAppSuffix not found");
  const f = vm.runInNewContext("(" + m[0] + ")");
  assert.equal(f("?q=Athens"), "?q=Athens");
  assert.equal(f("#c=abc"), "#c=abc");
  assert.equal(f("?new=%7B%7D#x"), "?new=%7B%7D#x");
  assert.equal(f(""), "");
  assert.equal(f(null), "");
  assert.equal(f("../mail/"), "");
  assert.equal(f("javascript:alert(1)"), "");
  assert.equal(f("//evil.example/"), "");
  assert.equal(f("?a\nb"), "");
  assert.equal(f("?" + "x".repeat(9000)), "");
  // the shell strips app-at and only uses it next to ?open=
  assert.match(src, /params\.delete\("app-at"\)/);
  assert.match(src, /frameGo\(document\.getElementById\("app-frame"\), app\.url \+ \(at \|\| ""\)\)/);
});

test("service worker does not cache one shell copy per direct link", () => {
  assert.match(read("sw.js"), /url\.search\.indexOf\("app-at="\) === -1/);
});

test("with the screen lock on, ?standalone no longer opens the bare page", () => {
  const code = SNIP_RE.exec(read("notes/index.html"))[1];
  assert.deepEqual(runSnippet(code, { search: "?standalone", lock: true }),
    ["../?open=notes&app-at=" + encodeURIComponent("?standalone")]);
  assert.deepEqual(runSnippet(code, { framed: true, search: "?standalone", lock: true }), []);
  assert.deepEqual(runSnippet(code, { search: "?standalone" }), []);
});
