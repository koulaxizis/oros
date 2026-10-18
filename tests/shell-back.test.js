// BK-1: the phone's Back key returns to the desktop and never walks an
// app frame back into an app that was closed. Static checks on shell.js
// (the behaviour itself needs a browser; see OROS_BIBLE.md "Back key").
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const shell = fs.readFileSync(path.join(root, "shell.js"), "utf8");

test("app frames are navigated only through frameGo (no history entries)", () => {
  assert.match(shell, /function frameGo\(el, url\) \{\n\s+try \{ el\.contentWindow\.location\.replace\(/);
  const bad = shell.split("\n").filter((l) => /\b(el|front|f|back\.el|r\.el)\.src\s*=|getElementById\("app-frame"\)\.src\s*=/.test(l) && !/^\s*el\.src = url;$/.test(l));
  assert.deepStrictEqual(bad, []);
});

test("Back pops the shell's own history entry and returns home", () => {
  assert.match(shell, /pushState\(\{ orosApp: 1 \}/);
  assert.match(shell, /if \(appAway\(\)\) backArm\(\);/);
  assert.match(shell, /addEventListener\("popstate", function \(e\) \{\n\s+if \(e\.state && e\.state\.orosApp\) return;[^\n]*\n\s+if \(appAway\(\)\) returnToDesktop\(\);/);
});

test("with multitasking a frame keeps one app: new apps get a new, named frame", () => {
  assert.match(shell, /f\.name = "oros-app-" \+ \(\+\+mtFrameSeq\)/);
  assert.match(shell, /if \(front\) mtDrop\(front\);\n\s+front = mtNewFrame\(\);\n\s+frameGo\(front,/);
});

test("code that rewrites the shell's address keeps the history state", () => {
  for (const f of ["remote-play.js", "slides/remote.js", "time/stage-link.js", "studio/remote.js"]) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    assert.doesNotMatch(src, /parent\.history\.replaceState\(null/, f);
  }
});
