// Quality gate Q6: every orOS page carries a Content-Security-Policy
// meta whose script-src allows only 'self' and the hashes of that
// page's own inline scripts (.github/scripts/csp.js writes it; the
// quality gate's smoke run fails on any securitypolicyviolation).
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const CSP = require("../.github/scripts/csp.js");

const ROOT = path.join(__dirname, "..");

test("every page has a current CSP meta before its first script", () => {
  const r = CSP.run(true);
  assert.deepEqual(r.bad, [], "run: node .github/scripts/csp.js");
  assert.ok(CSP.listDocs().length > 150, "the pages are found");
});

test("script-src never allows inline code, eval or another origin by default", () => {
  for (const f of CSP.listDocs()) {
    const html = fs.readFileSync(path.join(ROOT, f), "utf8");
    const m = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html);
    const script = (/script-src[^;]*/.exec(m[1]) || [""])[0];
    assert.doesNotMatch(script, /'unsafe-(inline|eval)'|\*|https:(?!\/\/apis\.google\.com)/, f);
    assert.match(m[1], /object-src 'none'/, f);
    assert.match(m[1], /base-uri '(self|none)'/, f);
  }
});

test("a changed inline script needs a new hash; the writer adds and refreshes the meta", () => {
  const page = '<!doctype html>\n<html><head>\n  <meta charset="utf-8">\n  <script>go(1)</script>\n</head></html>\n';
  assert.deepEqual(CSP.check(page), ["no CSP meta"]);
  const done = CSP.withPolicy(page);
  assert.deepEqual(CSP.check(done), []);
  assert.ok(done.indexOf("Content-Security-Policy") < done.indexOf("<script>"), "the meta comes first");
  const edited = done.replace("go(1)", "go(2)");
  assert.deepEqual(CSP.check(edited), ["CSP out of date (an inline script changed?)"]);
  assert.deepEqual(CSP.check(CSP.withPolicy(edited)), []);
  assert.equal(CSP.withPolicy(CSP.withPolicy(edited)), CSP.withPolicy(edited), "idempotent");
});

test("the Google Picker host is allowed only on pages that load gmedia.js", () => {
  const p = (body) => CSP.policyFor("<head></head><body>" + body + "</body>");
  assert.match(p('<script src="gmedia.js"></script>'), /script-src [^;]*https:\/\/apis\.google\.com/);
  assert.doesNotMatch(p('<script src="app.js"></script>'), /apis\.google\.com/);
});

test("no inline event handler is left in markup that apps build", () => {
  for (const f of ["radio/radio.js", "television/television.js"]) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.doesNotMatch(src, /onerror="/, f);
  }
});
