// Screen recording from Quick settings (QS-REC-1, Chris 2026-11-23):
// a pill next to Screenshot; the shell records (screenrec.js), so the
// recording goes on while apps open and close, and saves the clip in
// Files › Videos.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const SR = require("../screenrec.js");
const C = require("../capture/core.js");
const QS = require("../qsettings.js");

test("which sound goes in: the screen's, the microphone's, both mixed", () => {
  assert.deepEqual(SR.recSources(0, false), { sys: false, mic: false, mix: false });
  assert.deepEqual(SR.recSources(1, false), { sys: true, mic: false, mix: false });
  assert.deepEqual(SR.recSources(0, true), { sys: false, mic: true, mix: false });
  assert.deepEqual(SR.recSources(2, true), { sys: true, mic: true, mix: true });
});

test("the clip goes to Files › Videos, never over another file", () => {
  const at = new Date(2026, 10, 27, 22, 5, 9);
  assert.equal(SR.saveName(C, "Screen recording", at, "video/mp4", 1), "/internal/Videos/Screen recording 2026-11-27 22-05-09.mp4");
  assert.equal(SR.saveName(C, "Εγγραφή οθόνης", at, "video/webm;codecs=vp9,opus", 2), "/internal/Videos/Εγγραφή οθόνης 2026-11-27 22-05-09 (2).webm");
  const src = read("screenrec.js");
  assert.match(src, /F\.stat\(path\)\.then\(function \(\) \{ n\+\+; if \(n < 100\) tryName\(\); else saveFailed\(blob, at\); \}, function \(\) \{\s+F\.write\(path, blob\)/);
  assert.match(src, /\}, function \(\) \{ saveFailed\(blob, at\); \}\);/, "a refused write downloads the clip instead");
});

test("the recorder: Screen Capture's options, a 1 GB stop, the browser's Stop sharing, one at a time", () => {
  const src = read("screenrec.js");
  assert.match(src, /var p = C\.prefs\(raw\);/);
  assert.match(src, /micStream\(p\.mic\)/, "the microphone only when on in Screen Capture (off by default)");
  assert.equal(C.prefs(null).mic, false);
  assert.match(src, /if \(r\.bytes >= C\.MAX_BYTES && cur === r\) \{ host\.toast\("err", t\("qs\.rec\.limit"\)\); stop\(\); \}/);
  assert.match(src, /video\.addEventListener\("ended", function \(\) \{ if \(cur === r\) stop\(\); \}\);/);
  assert.match(src, /if \(!host \|\| !C \|\| !stream \|\| cur \|\| call\(function \(\) \{ return host\.busy\(\); \}\)\) \{ stopTracks\(stream\); return false; \}/);
  assert.match(src, /host\.bar\(r\.handle\);/);
  assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|innerHTML/, "nothing leaves the device; no markup from data");
});

test("the shell asks on the tap, loads the recorder on demand, wires Quick settings", () => {
  const sh = read("shell.js");
  const sec = sh.slice(sh.indexOf("  function recTake() {"), sh.indexOf("  window.__orosTakeShot = function"));
  assert.match(sec, /if \(!recOk\(\) \|\| recLive\(\) \|\| \(window\.orosScreenRec && window\.orosScreenRec\.running\(\)\)\) return;/);
  assert.match(sec, /navigator\.mediaDevices\.getDisplayMedia\(o\)/);
  assert.match(sec, /recLoad\(\)\.then\(function \(api\) \{ api\.start\(st, raw\); \}/);
  assert.match(sh, /recScript\("capture\/core\.js"\)/);
  assert.match(sh, /recScript\("screenrec\.js"\)/);
  assert.match(sh, /return !!\(md && typeof md\.getDisplayMedia === "function" && window\.MediaRecorder && hasApp\("capture"\)\);/, "hidden where the screen cannot be shared (phones)");
  assert.match(sh, /rec: SOLO \? null : \{\s+can: recOk,/);
  assert.match(read("smartbar.js"), /recNow: function \(\) \{ return recLive; \},/);
  assert.match(read("smartbar-live.js"), /if \(typeof h\.go !== "function"\) call\(function \(\) \{ host\(\)\.open\("capture"\); \}\);/);
  assert.ok(!/<script src="screenrec\.js/.test(read("index.html")), "not a start-up script");
});

test("Quick settings: the pill next to Screenshot, the time while it runs, its strings in EN/EL/DE", () => {
  const qs = read("qsettings.js");
  assert.match(qs, /parts\.emoji, parts\.shot, parts\.rec\]\.forEach/);
  assert.match(qs, /parts\.rec\.box\.hidden = !canRec;/);
  assert.match(qs, /then\(function \(\) \{ host\.rec\.settings\(\); \}\), t\("qs\.rec\.more"\)\);/);
  const t = (k) => ({ "qs.rec.paused": "Paused {t}" })[k];
  assert.equal(QS.recSub(null, t), "");
  assert.equal(QS.recSub({ ms: 65000, paused: false }, t), "1:05");
  assert.equal(QS.recSub({ ms: 3725000, paused: true }, t), "Paused 1:02:05");
  const tr = read("translations.js"), de = read("i18n/de/shell.js");
  for (const k of ["qs.rec", "qs.rec.stop", "qs.rec.more", "qs.rec.paused", "qs.rec.file", "qs.rec.saved",
                   "qs.rec.fail", "qs.rec.nomic", "qs.rec.limit", "qs.rec.nosave"]) {
    assert.equal(tr.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.includes('"' + k + '":'), k + " DE");
  }
  assert.match(read("capture/app.js"), /target\.rec === "settings"/);
  assert.match(read("capture/help.en.txt"), /Screen recording records a video/);
  assert.match(read("capture/help.el.txt"), /η Εγγραφή οθόνης γράφει βίντεο/);
  assert.match(read("i18n/de/help/capture.txt"), /Bildschirmaufnahme ein Video auf/);
});
