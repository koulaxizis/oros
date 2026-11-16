// PICK-1: themed pickers (pickers.js + pickers.css, Bible Part VII).
// Pure helpers of the list, and the page contract: every page the
// release stamp reaches loads pickers.js with the right relative path,
// so no app falls back to the browser's grey list.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const P = require(path.join(ROOT, "pickers.js"));

test("fold drops case and accents, Greek final sigma too", () => {
  assert.equal(P.fold("Ελλάδα"), "ελλαδα");
  assert.equal(P.fold("ΪΣΟΣ"), "ισοσ");
  assert.equal(P.fold("Café"), "cafe");
  assert.equal(P.fold(null), "");
});

test("matches needs every word, in any order", () => {
  assert.ok(P.matches("Ηνωμένο Βασίλειο", "βασιλ ηνωμ"));
  assert.ok(P.matches("Anything", ""));
  assert.ok(!P.matches("Γαλλία", "ισπ"));
  assert.ok(P.matches("Ισπανία", "ισπ"));
});

test("nextIndex skips disabled rows and stays inside the list", () => {
  const rows = [{ disabled: true }, {}, { disabled: true }, {}, {}];
  assert.equal(P.nextIndex(rows, -1, 1), 1);
  assert.equal(P.nextIndex(rows, 1, 1), 3);
  assert.equal(P.nextIndex(rows, 3, -1), 1);
  assert.equal(P.nextIndex(rows, 1, -1), 1, "first pickable row stays put");
  assert.equal(P.nextIndex(rows, 4, 1), 4);
  assert.equal(P.nextIndex(rows, 1, 8), 4, "page down clamps to the last row");
  assert.equal(P.nextIndex(rows, rows.length, -1), 4, "End");
  assert.equal(P.nextIndex([{ disabled: true }], -1, 1), -1);
  assert.equal(P.nextIndex([], -1, 1), -1);
});

test("jumpIndex finds the next row by its first letters, wrapping", () => {
  const rows = [{ label: "Άλφα" }, { label: "Βήτα" }, { label: "Αλάτι", disabled: true }, { label: "αλεύρι" }];
  assert.equal(P.jumpIndex(rows, 0, "α"), 3);
  assert.equal(P.jumpIndex(rows, 3, "α"), 0);
  assert.equal(P.jumpIndex(rows, 0, "αλε"), 3);
  assert.equal(P.jumpIndex(rows, 0, "ω"), -1);
  assert.equal(P.jumpIndex(rows, 0, ""), -1);
});

test("strings in English, Greek and German, English for the rest", () => {
  for (const code of ["en", "el", "de"]) {
    const s = P.strings(code);
    for (const k of ["search", "none", "close", "list"]) assert.ok(s[k] && s[k].length, code + "." + k);
  }
  assert.equal(P.strings("fr"), P.STR.en);
});

// The same page list as .github/scripts/stamp-assets.js (minus the shell,
// which draws no <select>).
function pages() {
  const SKIP = new Set(["icons", "fonts", "vendor"]);
  const out = [];
  for (const d of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!d.isDirectory() || SKIP.has(d.name) || d.name.startsWith(".")) continue;
    if (fs.existsSync(path.join(ROOT, d.name, "index.html"))) out.push(d.name + "/index.html");
  }
  for (const f of ["forms/f/index.html", "calendar/rsvp.html"]) if (fs.existsSync(path.join(ROOT, f))) out.push(f);
  return out;
}

test("every page loads pickers.js from the root, deferred, after its own scripts", () => {
  const list = pages();
  assert.ok(list.length > 100, "page scan found " + list.length);
  const bad = [];
  for (const f of list) {
    const html = fs.readFileSync(path.join(ROOT, f), "utf8");
    // A forward-only page (an alias folder) loads no script at all.
    if (!/<script src="(?![^"]*pickers\.js)/.test(html)) { assert.ok(!html.includes("<select"), f + " has a <select> but no scripts"); continue; }
    const pre = "../".repeat(f.split("/").length - 1);
    const re = new RegExp('<script src="' + pre.replace(/\./g, "\\.") + 'pickers\\.js(\\?v=[^"]*)?" defer></script>');
    const m = re.exec(html);
    // Last line of <body>: after i18n.js and every script of the app.
    if (!m || !/^\s*<\/body>/.test(html.slice(m.index + m[0].length))) bad.push(f);
  }
  assert.deepEqual(bad, [], "add <script src=\"../pickers.js\" defer></script> as the last line of <body>");
});

test("the app-kit template and check-app carry the line", () => {
  const tpl = fs.readFileSync(path.join(ROOT, "docs/app-kit/template/index.html"), "utf8");
  assert.ok(tpl.includes('<script src="../pickers.js" defer></script>'));
  const chk = fs.readFileSync(path.join(ROOT, ".github/app-kit/check-app.js"), "utf8");
  assert.ok(chk.includes('"pickers"'));
});

test("pickers.css keeps the browser list shut only under html.opk-on, and lets data-native through", () => {
  const css = fs.readFileSync(path.join(ROOT, "pickers.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = css.match(/([^{}]+)\{\s*pointer-events:\s*none;\s*\}/);
  assert.ok(rule, "pointer-events rule");
  for (const sel of rule[1].split(",")) {
    assert.match(sel.trim(), /^html\.opk-on select/);
    assert.match(sel, /:not\(\[multiple\]\)/);
    assert.match(sel, /:not\(\[data-native\]\)/);
  }
  assert.match(css, /html\.opk-on \[data-native\] select \{ pointer-events: auto; \}/);
  for (const v of ["--panel-bg", "--text", "--accent", "--border"]) assert.ok(css.includes("var(" + v), v);
});

test("pickers.js writes no page data as HTML", () => {
  const js = fs.readFileSync(path.join(ROOT, "pickers.js"), "utf8");
  const html = [...js.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
  for (const h of html) assert.match(h, /^'<svg [^']*'$/, "innerHTML only for fixed icons: " + h);
});
