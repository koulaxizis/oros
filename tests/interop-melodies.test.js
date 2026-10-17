// App links wave 5: Ringtone Composer melodies as the sound of every
// notification (Settings › Notifications) and of Time's timers.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const src = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const CC = require("../time/clock-core.js");

test("the shell shares the melodies (stickies/host.js window.orosMelodies)", () => {
  const s = src("stickies/host.js");
  assert.match(s, /root\.orosMelodies = \{/);
  assert.match(s, /list: melodies/);
  assert.match(s, /stop: stopMelody/);
  // a gone melody calls the caller's fallback, never the Stickies bell for others
  assert.match(s, /if \(typeof fb === "function"\) fb\(\); else play\("bell"\)/);
});

test("a notification plays the chosen melody, at most 8 s", () => {
  const s = src("notifications.js");
  assert.match(s, /\/\^rt:\[A-Za-z0-9_-\]\{1,64\}\$\/\.test\(soundType\) && window\.orosMelodies/);
  assert.match(s, /window\.orosMelodies\.play\(soundType\.slice\(3\), function \(\) \{ playTone\(SOUNDS\.chime, 'sine', 0\.2\); \}, 8\)/);
  const set = src("settings/settings.js");
  assert.match(set, /p\.orosMelodies\.list\(\)/);
  assert.match(set, /value: "rt:" \+ m\.id/);
  const core = src("settings/core.js");
  assert.equal((core.match(/"n\.sound\.rt"/g) || []).length, 2);
  assert.equal((core.match(/"n\.sound\.gone"/g) || []).length, 2);
});

test("Time's timers keep a melody, the shell rings it", () => {
  const t = CC.timerNorm([{ id: "abcd1", dur: 60000, sound: "rt:r123abc" }, { id: "abcd2", dur: 60000, sound: "rt:<x>" }]);
  assert.equal(t[0].sound, "rt:r123abc");
  assert.equal(t[1].sound, "beep");
  assert.equal(CC.timerNew("abcd3", "x", 1000, "rt:r123abc").sound, "rt:r123abc");
  assert.equal(CC.timerNew("abcd3", "x", 1000, "rt:").sound, "beep");
  const tm = src("time/time.js");
  assert.match(tm, /window\.parent\.orosMelodies/);
  assert.equal((tm.match(/"snd\.melodies":/g) || []).length, 2);
  const sh = src("shell.js");
  assert.match(sh, /var ALARM_RT = \/\^rt:/);
  assert.match(sh, /window\.orosMelodies\.play\(name\.slice\(3\), function \(\) \{ alarmPip\("beep"\); \}, 15\)/);
  assert.match(sh, /window\.orosMelodies\.stop\(\)/);
});
