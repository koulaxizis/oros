// VIZ-HIDDEN (Chris 2026-11-28): with orOS behind another window, a song
// that starts there must still load readable, so the wallpaper keeps
// listening while the desktop is covered; it draws nothing meanwhile.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SHELL = fs.readFileSync(path.join(ROOT, "shell.js"), "utf8");
function cut(src, name) {
  const i = src.indexOf("  function " + name + "(");
  if (i < 0) throw new Error("missing function " + name);
  let depth = 0, j = src.indexOf("{", i);
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) break;
  }
  return src.slice(i, j + 1);
}
// The shell's tick and listen, run against a fake Music host.
function rig() {
  const calls = [];
  const mu = { playing: false, viz(on, who) { calls.push([on, who]); }, vizFrame() { return { live: true }; }, getState() { return { playing: this.playing }; } };
  const env = { covered: false, wakes: 0 };
  const fn = new Function("env", "mu", `
    var wpVizCtl = { src: null, playing: false, wasCovered: false, calm: false, v: { wake: function () { env.wakes++; } } };
    var window = { __orosMusicHost: { api: mu } };
    function wpVizCovered() { return env.covered; }
    function hostApi(h) { return h && h.api && typeof h.api.getState === "function" ? h.api : h; }
    ${cut(SHELL, "wpVizPlaying")}
    ${cut(SHELL, "wpVizListen")}
    ${cut(SHELL, "wpVizTick")}
    return { tick: wpVizTick, C: function () { return wpVizCtl; } };`);
  return Object.assign(fn(env, mu), { env, mu, calls });
}

test("covered (another window, hidden tab, an app open): the wallpaper keeps listening to the song that plays", () => {
  const r = rig();
  r.mu.playing = true;
  r.tick();
  assert.deepEqual(r.calls, [[true, "wall"]]);
  r.env.covered = true;
  r.tick(); r.tick();
  assert.deepEqual(r.calls, [[true, "wall"]], "never lets go while covered");
  assert.equal(r.C().src.id, "music");
  assert.equal(r.C().playing, false, "covered: no frames");
  const w = r.env.wakes;
  r.env.covered = false;
  r.tick();
  assert.equal(r.env.wakes, w + 1, "back in front: the light wakes at once");
  assert.deepEqual(r.calls, [[true, "wall"]]);
});

test("covered with nothing playing: it still listens to Music, so the next song loads readable", () => {
  const r = rig();
  r.env.covered = true;
  r.tick();
  assert.deepEqual(r.calls, [[true, "wall"]]);
  r.mu.playing = true;
  r.tick();
  assert.deepEqual(r.calls, [[true, "wall"]]);
});
