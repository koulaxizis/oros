// BOOT-P1: the shell's <link rel="preload"> block (.github/scripts/preload.js).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const P = require("../.github/scripts/preload.js");

const ROOT = path.join(__dirname, "..");
const shell = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

test("index.html preloads every shell script, current and before the CSP meta", () => {
  assert.deepEqual(P.check(shell), []);
  const scripts = P.scriptsOf(shell);
  assert.ok(scripts.length > 20, "the shell scripts are listed");
  for (const s of scripts) assert.ok(shell.includes('<link rel="preload" as="script" href="' + s + '">'), s);
});

test("the block follows the page's scripts: order, ?v=, no remote or module script", () => {
  const page = '<head>\n  <meta charset="UTF-8">\n  <meta http-equiv="Content-Security-Policy" content="x">\n</head>\n' +
    '<script src="a.js?v=1"></script>\n<script src="https://x.example/b.js"></script>\n' +
    '<script type="module" src="m.js"></script>\n<script src="c/d.js?v=1" data-x="1"></script>\n';
  const once = P.apply(page);
  assert.deepEqual(P.check(once), []);
  assert.ok(once.indexOf("BOOT-P1") < once.indexOf("Content-Security-Policy"), "before the CSP meta");
  assert.match(once, /href="a\.js\?v=1">\n  <link rel="preload" as="script" href="c\/d\.js\?v=1">/);
  assert.ok(!/b\.js|m\.js"/.test(once.slice(0, once.indexOf("/BOOT-P1"))), "remote and module scripts left out");
  assert.equal(P.apply(once), once, "running it again changes nothing");
  const restamped = once.replace(/\?v=1"><\/script>/g, '?v=2"></script>');
  assert.equal(P.check(restamped).length, 1, "a new ?v= on the scripts makes the block stale");
  assert.deepEqual(P.check(P.apply(restamped)), []);
  assert.match(P.check(page)[0], /no BOOT-P1/);
});

test("the splash goes when the desktop is drawn and the page's scripts have run (BOOT-S1)", () => {
  assert.match(shell, /window\.__orosSplashDone = function \(\) \{ shellDrawn = true; early\(\); \};/);
  assert.match(shell, /DOMContentLoaded", function \(\) \{ parsed = true; early\(\); \}/);
  assert.match(shell, /setTimeout\(hide, 10000\);/, "fail-safe kept");
  const js = fs.readFileSync(path.join(ROOT, "shell.js"), "utf8");
  assert.equal((js.match(/renderMenu\(\);\n\s*splashDone\(\);/g) || []).length, 2, "both loadApps paths");
});
