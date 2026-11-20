// Idle and tower defense games: Start over / Reset progress really start
// again, and How to play can be opened again (Chris 2026-11-20).
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const IDLE = ["hive", "lighthouse", "starchart"];
const TD = ["ridge", "maze", "caravan"];

function body(src, name) {
  const i = src.indexOf("  function " + name + "(");
  assert.ok(i >= 0, name + " exists");
  return src.slice(i, src.indexOf("\n  }\n", i));
}

for (const id of IDLE) {
  test(id + ": Start over has no Undo (the Undo sat over the toolbar and brought the old game back)", () => {
    const s = read(id + "/" + id + ".js"), so = body(s, "startOver");
    assert.ok(/undo = null;/.test(so), "the last Undo is dropped");
    assert.ok(!/kind: "start"/.test(s), "no Undo snapshot of the old game");
    assert.ok(/showToast\(t\("toast\.start"\)\);/.test(so), "a plain message, without the Undo button");
    assert.ok(/savePrefs\(\)/.test(so), "the away card starts from the new game");
    assert.ok(/br = Math\.max\(nowMs\(\), saved\.br \+ 1\)/.test(so), "a new reset stamp wins on every device");
  });
  test(id + ": a ? button in the toolbar opens How to play again", () => {
    const h = read(id + "/index.html"), s = read(id + "/" + id + ".js");
    assert.ok(/<button type="button" class="icon-btn" id="help-btn"><\/button>/.test(h));
    assert.ok(/\$\("help-btn"\)\.addEventListener\("click", tourDialog\)/.test(s));
    assert.ok(/ev\.key === "\?"\) \{ tourDialog\(\)/.test(s), "the ? key too");
    for (const k of ["btn.help", "tour.again"]) {
      assert.equal((s.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k + " in EN and EL");
      assert.ok(read("i18n/de/" + id + ".js").includes('"' + k + '":'), k + " in DE");
    }
    const css = read(id + "/" + id + ".css");
    assert.ok(/\.tb-title \{ flex: 100 1 0; max-width: max-content; \}/.test(css), "the name gives way before a button wraps at 360px");
    assert.ok(/#toast \{ left: 8px; right: 8px;/.test(css), "a full-width toast on phones");
  });
}

test("starchart: How to play explains drawing in numbered steps", () => {
  const s = read("starchart/starchart.js"), de = read("i18n/de/starchart.js");
  assert.ok(/el\("ol", "tour-steps"\)/.test(s));
  for (const k of ["tour.goal", "tour.s1", "tour.s2", "tour.s3", "tour.s4", "tour.rules", "tour.season"]) {
    assert.equal((s.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k + " in EN and EL");
    assert.ok(de.includes('"' + k + '":'), k + " in DE");
  }
  assert.ok(!/"tour\.2":/.test(s) && !/"tour\.2":/.test(de), "the old one-paragraph drawing text is gone");
});

for (const id of TD) {
  test(id + ": Reset progress also ends the game in progress", () => {
    const s = read(id + "/" + id + ".js"), rp = body(s, "resetProgress");
    assert.ok(/if \(sess && !sess\.counted\) \{ sess\.counted = true; paused = true; saveSession\(\); \}/.test(rp));
    assert.ok(/ends too\./.test(s), "the question says so");
  });
}
