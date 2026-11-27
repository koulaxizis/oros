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
  assert.match(sh, /return !!\(md && typeof md\.getDisplayMedia === "function" && window\.MediaRecorder && hasApp\("capture"\)\) \|\| recPhone\(\);/, "hidden where the screen cannot be shared (a phone's browser)");
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

test("Android: the orOS app records the phone's screen (consent, foreground service, Movies › orOS)", () => {
  const sh = read("shell.js"), ph = read("phone.js");
  assert.match(sh, /if \(recPhone\(\)\) \{ window\.orosPhone\.rec\(recPrefs\(\)\.mic === true\); return; \}/);
  assert.match(sh, /if \(md && typeof md\.getDisplayMedia === "function"\) return false;/, "a browser that can share the screen records in the page");
  assert.match(ph, /rec: typeof m\.rec === "boolean" \? m\.rec : null,/);
  assert.match(ph, /"intent:\/\/start" \+ \(mic \? "\?mic=1" : ""\) \+ "#Intent;scheme=oros-rec;package=online\.useoros\.twa;end"/);
  const act = read("android/app/src/main/java/online/useoros/twa/ScreenRecordActivity.java");
  assert.match(act, /if \(!PhoneBridge\.FULL\) \{ finish\(\); return; \}/);
  assert.match(act, /if \(ScreenRecordService\.running\(\) \|\| "stop"\.equals\(what\)\)/, "the same button stops it");
  assert.match(act, /pm\.createScreenCaptureIntent\(\)/, "Android's own consent every time");
  const svc = read("android/app/src/main/java/online/useoros/twa/ScreenRecordService.java");
  assert.match(svc, /startForeground\(NOTE_REC, n, type\);[\s\S]*pm\.getMediaProjection\(/, "foreground before the projection (Android 14)");
  assert.match(svc, /RELATIVE_PATH, Environment\.DIRECTORY_MOVIES \+ "\/orOS"/);
  assert.match(svc, /IS_PENDING, 1/);
  assert.doesNotMatch(svc, /HttpURLConnection|java\.net\.URL/, "nothing leaves the phone");
  assert.match(read("android/app/src/main/java/online/useoros/twa/PhoneBridge.java"), /o\.put\("rec", ScreenRecordService\.running\(\)\);/);
  const gen = require("../android/tools/gen.js");
  for (const n of [["activity", ".ScreenRecordActivity"], ["service", ".ScreenRecordService"]]) {
    assert.ok(gen.REMOVE_NODES.some((x) => x[0] === n[0] && x[1] === n[1]), n[1] + " only in the orOS app");
  }
  const g = read("android/tools/gen.js");
  assert.match(g, /android:foregroundServiceType="mediaProjection\|microphone"/);
  assert.match(g, /<data android:scheme="oros-rec" \/>/);
  for (const d of ["values", "values-el", "values-de"]) {
    const s = read("android/app/src/main/res/" + d + "/strings.xml");
    for (const k of ["channel_screenrec", "rec_running", "rec_running_text", "rec_stop", "rec_saved", "rec_saved_text"]) assert.ok(s.includes('name="' + k + '"'), d + " " + k);
  }
});
