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

// MU-PANEL: the chip opens a control panel instead of toggling playback.
test("MU-PANEL: chip click opens the panel, never plays or pauses", () => {
  const c = body("chip");
  assert.match(c, /addEventListener\("click", function \(e\) \{ e\.stopPropagation\(\); popToggle\(\); \}\)/);
  assert.doesNotMatch(c, /audio\.paused\) play\(\); else pause\(\)/);
  assert.match(c, /popClose\(\); return; \}/);    // no chip, no panel
});
test("MU-PANEL: panel has the song, seek, prev/play/next/stop/open, volume and mute", () => {
  const p = body("popToggle");
  for (const cls of ["mu-p-t", "mu-p-a", "mu-p-seek", "prv", "pp", "nxt", "stp", "opn", "mut", "mu-p-vol"]) {
    assert.ok(p.includes('"' + cls + '"'), cls);
  }
  assert.match(p, /__orosOpenApp\("music"\)/);
  assert.match(p, /host\.api\.setVolume\(0\)/);
});
test("MU-PANEL: song text goes in as text only", () => {
  const p = body("popPaint");
  assert.match(p, /t\.textContent = tt/);
  assert.match(p, /a\.textContent = aa/);
  assert.doesNotMatch(p, /innerHTML/);
});
test("MU-PANEL: every label in EN, EL and the German pack", () => {
  const de = fs.readFileSync(path.join(__dirname, "..", "i18n/de/music.js"), "utf8");
  for (const k of ["host.now", "host.paused", "host.panel", "host.prev", "host.next", "host.playBtn", "host.pauseBtn",
    "host.stop", "host.open", "host.seek", "host.volume", "host.mute", "host.unmute", "host.like", "host.unlike"]) {
    assert.equal(src.split('"' + k + '"').length - 1, 3, k + " in en + el + use");
    assert.ok(de.includes('"' + k + '"'), k + " in de");
  }
});
// MU-FAV: the panel's heart likes the playing song through the synced slice.
test("MU-FAV: heart in the panel uses the app's like (setLike via mutate)", () => {
  const p = body("popToggle");
  assert.ok(p.includes('"fav"'), "fav button");
  assert.match(p, /mutate\(function \(d, now\) \{ return C\.setLike\(d, ref, on, now\); \}\)/);
  const q = body("popPaint");
  assert.match(q, /C\.isLiked\(data, ref\.k\)/);
  assert.match(q, /aria-pressed/);
  assert.match(q, /fv\.disabled = !ref/);
});
