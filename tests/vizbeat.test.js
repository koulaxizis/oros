// MU-VIZ-BEAT (Chris 2026-11-27: the Light show wallpaper "moves
// without coherence, it does not follow the rhythm and the energy of
// the music"). vizkit 1.4.0 finds beats in the bass and every style
// answers them; music/host.js 1.6.0 reads streams whose host allows
// CORS (captureStream copy, never routed, never restarted); Settings
// says when a song cannot be heard. The browser run lives in the
// project's viz-beat/tools/vizbeat.js.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const V = require(path.join(ROOT, "vizkit.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

function run(gen, ms) {
  let s = null; const beats = [];
  for (let t = 0; t < (ms || 20000); t += 33) { const r = V.beatStep(s, gen(t), t); s = r.s; if (r.beat) beats.push(t); }
  return beats;
}
// a deterministic jitter in 0..1
const jit = (t) => (Math.sin(t * 12.9898) * 43758.5453) % 1 * Math.sign(Math.sin(t * 12.9898)) * 0.5 + 0.5;

test("beatStep: a 120 bpm kick gives one beat per kick", () => {
  assert.equal(V.v, "1.4.0");
  const b = run((t) => (t % 500 < 80 ? 0.85 : 0.25) + jit(t) * 0.05);
  assert.ok(b.length >= 38 && b.length <= 40, "beats " + b.length);
  for (let i = 1; i < b.length; i++) assert.ok(Math.abs((b[i] - b[i - 1]) - 500) <= 40, "spacing " + (b[i] - b[i - 1]));
  const soft = run((t) => (t % 500 < 80 ? 0.45 : 0.3) + jit(t) * 0.03);
  assert.ok(soft.length >= 38, "a soft kick too: " + soft.length);
});

test("beatStep: no beats in steady noise, a slow swell or silence; at most one per 200 ms", () => {
  assert.equal(run((t) => 0.5 + jit(t) * 0.08).length, 0);
  assert.equal(run((t) => 0.3 + 0.3 * Math.sin(t / 2000)).length, 0);
  assert.equal(run(() => 0).length, 0);
  const fast = run((t) => (t % 99 < 33 ? 0.9 : 0.2));
  for (let i = 1; i < fast.length; i++) assert.ok(fast[i] - fast[i - 1] >= 200);
});

test("every style answers the beat; without sound no fake beat", () => {
  const src = read("vizkit.js");
  assert.match(src, /lv\.p = pulse; lv\.real = real;/);
  assert.match(src, /var ringNow = lv\.real \? !!lv\.beat :/, "rings start on beats with real sound");
  assert.match(src, /pp \* 0\.1\)/, "glow swells");
  assert.match(src, /\(1 \+ \(lv\.p \|\| 0\) \* \(i < n \/ 3 \? 0\.3 : 0\.12\)\)/, "bars jump");
  assert.match(src, /\(1 \+ \(li \? 0\.2 : 0\.5\) \* \(lv\.p \|\| 0\)\)/, "wave grows");
  assert.match(src, /if \(!real\) \{ pulse = 0; lv\.beat = false; bt = null; \}/);
});

test("Music host 1.6.0 reads streams that allow it, never restarts one", () => {
  const h = read("music/host.js");
  assert.match(h, /host\.js \(player \+ data owner, v1\.6\.0\)/);
  assert.match(h, /sourceFor\(item\)\.then\(vizPrep\), rgFor\(item\)\]\)\.then\(function \(r\) \{\n      if \(!nx/, "the next song is asked about too");
  assert.match(h, /sourceFor\(item\)\.then\(vizPrep\), rgFor\(item\)\]\)\.then\(function \(r\) \{\n      var src = r\[0\];/);
  assert.match(h, /w\.setTimeout\(fin, 1500\);/, "at most 1.5 s before the first song of a host");
  assert.match(h, /el\.captureStream\(\)\.getAudioTracks\(\)/);
  assert.doesNotMatch(h, /mozCaptureStream\(/, "never Firefox's mozCaptureStream (it takes the sound away)");
  assert.match(h, /el\.addEventListener\("error", function \(e\) \{ if \(vizPlainAgain\(el\)\)/, "a failed readable load plays plain at once");
  assert.match(h, /n\.connect\(viz\.an\);/, "the copy goes only into the analyser");
  assert.match(h, /smoothingTimeConstant = 0\.55;/);
});

test("the wallpaper listens before a song plays; Settings says when a song cannot be heard", () => {
  const sh = read("shell.js");
  assert.match(sh, /wpVizListen\(p \|\| pre\);/);
  assert.match(sh, /calm: !!\(wpVizCtl && wpVizCtl\.calm\)/);
  const st = read("settings/settings.js");
  assert.match(st, /else if \(s\.viz\.calm\) c3\.appendChild\(el\("p", "hint wp-still", t\("a\.wallpaper\.viz\.calm"\)\)\);/);
  const core = read("settings/core.js"), de = read("i18n/de/settings.js");
  assert.equal(core.split('"a.wallpaper.viz.calm"').length - 1, 2);
  assert.ok(de.includes('"a.wallpaper.viz.calm"'));
});
