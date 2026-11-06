// MU-CHIP: the music tray chip shows only after a song played in this
// page. The song restored paused from last session must not put a music
// icon on an idle bar. Source checks on music/host.js (the browser run
// lives in the project's e2e-chip.js).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "music/host.js"), "utf8");

function body(name) {
  const i = src.indexOf("function " + name + "(");
  assert.ok(i >= 0, name + " exists");
  let d = 0, j = src.indexOf("{", i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") d++;
    else if (src[k] === "}" && --d === 0) return src.slice(j, k + 1);
  }
  throw new Error("unbalanced " + name);
}

test("MU-CHIP: chip needs a song that played in this page", () => {
  assert.match(body("chip"), /if \(!cur \|\| !live \|\| !bar\)/);
});
test("MU-CHIP: playing sets live, stop and end of list clear it", () => {
  assert.match(src, /on\("playing", function \(\) \{ live = true;/);
  assert.match(body("stop"), /live = false;/);
  assert.match(body("stopAtEnd"), /live = false;/);
});
test("MU-CHIP: restore loads paused and never sets live", () => {
  const i = src.indexOf("(function restore()");
  const r = src.slice(i, src.indexOf("})();", i));
  assert.match(r, /load\(q\.cur, local\.pos, false\)/);
  assert.doesNotMatch(r, /live\s*=/);
});
