// BOOT-L1: the late bundle. App files the shell needs only in the
// background sit in index.html inside <template data-oros-late>, and
// shell.js adds them once the desktop is drawn.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const P = require("../.github/scripts/preload.js");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const page = read("index.html");
const shell = read("shell.js");

function lateScripts(html) {
  const out = [];
  for (const t of html.matchAll(/<template data-oros-late>([\s\S]*?)<\/template>/g))
    for (const m of t[1].matchAll(/<script src="([^"]+)"><\/script>/g)) out.push(m[1]);
  return out;
}

test("the late bundle holds the background app files, and only script tags", () => {
  const late = lateScripts(page);
  assert.ok(late.length >= 60, "the app cores and hosts are late (" + late.length + ")");
  for (const t of page.matchAll(/<template data-oros-late>([\s\S]*?)<\/template>/g))
    assert.equal(t[1].replace(/\s*<script src="[a-z]+\/[a-z0-9-]+\.js\?v=[^"]+"><\/script>/g, "").trim(), "", "nothing else in a late template");
  for (const s of late) assert.ok(fs.existsSync(path.join(ROOT, s.split("?")[0])), s + " exists");
  const sw = read("sw.js");
  for (const s of late) assert.ok(sw.includes('"./' + s.split("?")[0] + '"') || sw.includes('"' + s.split("?")[0] + '"'), s + " is precached");
});

test("what the first screen needs stays in the start-up path", () => {
  const early = P.scriptsOf(page);
  for (const s of ["trees/core.js", "wallpaper/art.js", "share/out.js", "shell.js", "phone.js", "webpush.js", "widgets.js"])
    assert.ok(early.some((x) => x.split("?")[0] === s), s + " loads at start-up");
  const late = lateScripts(page).map((s) => s.split("?")[0]);
  for (const s of early) assert.ok(!late.includes(s.split("?")[0]), s + " is not loaded twice");
});

test("the preload block leaves the late bundle out", () => {
  const preloads = [...page.matchAll(/<link rel="preload" as="script" href="([^"]+)">/g)].map((m) => m[1]);
  for (const s of lateScripts(page)) assert.ok(!preloads.includes(s), s + " is not preloaded");
  const html = '<head>\n  <meta http-equiv="Content-Security-Policy" content="x">\n</head>\n<script src="a.js?v=1"></script>\n' +
    '<template data-oros-late>\n  <script src="b/c.js?v=1"></script>\n</template>\n<script src="d.js?v=1"></script>\n';
  assert.deepEqual(P.scriptsOf(html), ["a.js?v=1", "d.js?v=1"]);
});

test("shell.js loads the bundle after the desktop is drawn, in order, with a fail-safe", () => {
  assert.match(shell, /window\.__orosSplashDone\(\); \} catch \(e\) \{\}\n\s*setTimeout\(lateStart, 0\);/);
  assert.match(shell, /querySelectorAll\("template\[data-oros-late\]"\)/);
  assert.match(shell, /s\.async = false;\n\s*s\.onload = s\.onerror = settle;/);
  assert.match(shell, /setTimeout\(lateFinish, LATE_MAX_MS\)/);
  assert.match(shell, /document\.readyState === "loading"/, "waits for the last template to be parsed");
  assert.match(shell, /if \(!left\) return lateFinish\(\);/, "no template (older index.html) = done at once");
});

test("engines, app opens, Android and Web Push wait for the bundle", () => {
  assert.match(shell, /function enginesMayRun\(\) \{[\s\S]{0,400}if \(!late\.done && \(Date\.now\(\) - shellBootAt\) <= LATE_GRACE_MS\) return false;/);
  assert.match(shell, /function openApp\(app, at\) \{[\s\S]{0,400}if \(!late\.done && app && app\.type === "internal"\) \{/);
  const phone = read("phone.js");
  for (const fn of ["push(kind, force)", "pushHealth(force)", "pushToday(force)", "pushAgenda(force)", "pushReminders(force)"])
    assert.ok(phone.includes("function " + fn + " {\n    if (!lateOk()) return;"), fn + " waits");
  assert.match(phone, /addEventListener\("oros:late-ready", function \(\) \{ pushAll\(false\); \}\)/);
  assert.ok(!/var OCC = /.test(phone), "calendar/occur.js is looked up on use, not at load");
  const wp = read("webpush.js");
  assert.match(wp, /if \(root\.orosLate && !root\.orosLate\.done\) return Promise\.resolve\(false\);/);
  assert.match(wp, /addEventListener\("oros:late-ready"/);
});

