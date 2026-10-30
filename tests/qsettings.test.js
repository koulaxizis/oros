// Quick settings (qsettings.js): Do Not Disturb times, labels, the
// battery rule, and the wiring in the shell, notifications.js, the
// page, the precache and the strings.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const Q = require(path.join(ROOT, "qsettings.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("Do Not Disturb: one hour, 8 in the morning, until turned off", () => {
  const now = new Date(2026, 9, 30, 17, 20, 0).getTime();
  assert.equal(Q.dndUntil("hour", now), now + 3600000);
  assert.equal(Q.dndUntil("morning", now), new Date(2026, 9, 31, 8, 0, 0).getTime());
  const early = new Date(2026, 9, 30, 6, 0, 0).getTime();
  assert.equal(Q.dndUntil("morning", early), new Date(2026, 9, 30, 8, 0, 0).getTime());
  assert.equal(Q.dndUntil("on", now), "on");
});

test("Do Not Disturb: the second line of its button", () => {
  const t = (k) => ({ "qs.dnd.until": "Until {t}", "qs.dnd.untiltomorrow": "Until tomorrow {t}",
    "qs.dnd.untiloff": "Until you turn it off" })[k];
  const fmt = (d) => String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  const now = new Date(2026, 9, 30, 17, 20, 0).getTime();
  assert.equal(Q.dndSub({ on: false, until: 0 }, now, fmt, t), "");
  assert.equal(Q.dndSub(null, now, fmt, t), "");
  assert.equal(Q.dndSub({ on: true, until: 0 }, now, fmt, t), "Until you turn it off");
  assert.equal(Q.dndSub({ on: true, until: now + 3600000 }, now, fmt, t), "Until 18:20");
  assert.equal(Q.dndSub({ on: true, until: new Date(2026, 9, 31, 8, 0).getTime() }, now, fmt, t), "Until tomorrow 08:00");
});

test("sync states map to their labels; unknown reads as off", () => {
  assert.equal(Q.syncKey("idle"), "qs.sync.idle");
  assert.equal(Q.syncKey("synced"), "qs.sync.idle");
  assert.equal(Q.syncKey("dirty"), "qs.sync.dirty");
  assert.equal(Q.syncKey("err"), "qs.sync.error");
  assert.equal(Q.syncKey("locked"), "qs.sync.locked");
  assert.equal(Q.syncKey("weird"), "qs.sync.off");
});

test("battery shows only when the device runs on it or is not full", () => {
  assert.equal(Q.batteryShown(null), false);
  assert.equal(Q.batteryShown({ level: 1, charging: true }), false);   // desktop
  assert.equal(Q.batteryShown({ level: 0.8, charging: true }), true);
  assert.equal(Q.batteryShown({ level: 1, charging: false }), true);
  assert.equal(Q.batteryShown({ level: NaN, charging: false }), false);
  assert.equal(Q.batteryPct({ level: 0.456 }), 46);
  assert.equal(Q.bigOn(100), false);
  assert.equal(Q.bigOn(115), false);
  assert.equal(Q.bigOn(130), true);
  assert.equal(Q.bigOn(150), true);
});

test("notifications.js: DND is device-local and silences toasts like quiet hours", () => {
  const n = read("notifications.js");
  assert.match(n, /const DND_KEY = 'oros-dnd';/);
  assert.match(n, /function isQuietHour\(now\) \{\n    if \(getDnd\(now\)\.on\) return true;/);
  assert.match(n, /dnd: \(\) => getDnd\(Date\.now\(\)\),\n    setDnd,/);
});

test("wiring: page, precache, shell attach, shortcut, bar fit", () => {
  const html = read("index.html");
  const i = html.indexOf('src="qsettings.js?v='), s = html.indexOf('src="shell.js?v=');
  assert.ok(i > 0 && i < s, "qsettings.js loads before shell.js");
  assert.match(read("sw.js"), /"\.\/osk\.js",\n  "\.\/qsettings\.js",/);
  const sh = read("shell.js");
  assert.match(sh, /window\.orosQS\.attach\(\{/);
  assert.match(sh, /if \(window\.orosQS\) window\.orosQS\.refresh\(\);/);
  assert.match(sh, /\{ key: "m", label: "sc\.desc\.qs",/);
  assert.match(sh, /bar\.classList\.toggle\("bar-nolang", lvl >= 7\);/);
  assert.match(read("style.css"), /#oros-bar\.bar-nolang #btn-lang \{ display: none; \}/);
});

test("strings: every qs.* key the component uses exists in EN, EL and DE", () => {
  const src = read("qsettings.js") + read("shell.js");
  const keys = new Set((src.match(/"qs\.[a-z.]+"/g) || []).map((k) => k.slice(1, -1)));
  keys.add("sc.desc.qs");
  const tr = read("translations.js");
  const el = tr.slice(tr.indexOf("\n  el: {"));
  const en = tr.slice(0, tr.indexOf("\n  el: {"));
  const de = read("i18n/de/shell.js");
  for (const k of keys) {
    if (k.endsWith(".")) continue;
    assert.ok(en.includes('"' + k + '":'), "EN " + k);
    assert.ok(el.includes('"' + k + '":'), "EL " + k);
    assert.ok(de.includes('"' + k + '":'), "DE " + k);
  }
});

test("battery from orOS USB's extension attribute", () => {
  assert.deepEqual(Q.batteryAttr("81:0"), { level: 0.81, charging: false });
  assert.deepEqual(Q.batteryAttr("100:1"), { level: 1, charging: true });
  assert.equal(Q.batteryAttr(""), null);
  assert.equal(Q.batteryAttr(null), null);
  assert.equal(Q.batteryAttr("81"), null);
  assert.equal(Q.batteryAttr("<b>:1"), null);
});

test("text on the accent: black or white, whichever reads better", () => {
  assert.equal(Q.onAccent("#d4af37"), "#000");    // orOS gold (dark)
  assert.equal(Q.onAccent("#b8860b"), "#000");
  assert.equal(Q.onAccent("#6d4aff"), "#fff");
  assert.equal(Q.onAccent(" #fff"), "#000");
  assert.equal(Q.onAccent("rgb(16, 133, 128)"), "#000");
  assert.equal(Q.onAccent("rgb(20, 20, 60)"), "#fff");
  assert.equal(Q.onAccent("red"), "");
});
