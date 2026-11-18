// App lock (APPLOCK-1, lock.js orosLock.apps, Settings › Screen lock ›
// App lock): the pure core (list, open set, scope), and the places that
// must ask it (shell, search, Today, notifications, the Assistant and
// orOS Gate). The behaviour in the real shell is checked with
// Playwright (changelog).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const L = require("../lock.js");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("the list is read defensively: none = nothing locked, a broken one locks every app but Settings", () => {
  assert.deepEqual(L.parseApps(null), { apps: {}, broken: false });
  assert.deepEqual(L.parseApps(""), { apps: {}, broken: false });
  const ok = L.parseApps(JSON.stringify({ v: 1, apps: { diary: "lock", health: "hide", x: "open", "Bad Id": "lock", settings: "lock" } }));
  assert.deepEqual(ok, { apps: { diary: "lock", health: "hide" }, broken: false }, "odd values, odd ids and Settings are dropped");
  for (const bad of ["not json", JSON.stringify({ v: 2, apps: {} }), JSON.stringify({ v: 1, apps: [] }), JSON.stringify([1])]) {
    const b = L.parseApps(bad);
    assert.equal(b.broken, true, bad);
    assert.equal(L.appState(b, "diary"), "lock", "fail closed");
    assert.equal(L.appState(b, "settings"), "", "Settings stays open so the list can be fixed");
  }
  assert.equal(L.appState(ok, "diary"), "lock");
  assert.equal(L.appState(ok, "health"), "hide");
  assert.equal(L.appState(ok, "todo"), "");
});

test("an unlocked app locks again a minute after it was left; the one in front stays open", () => {
  const now = 1000000;
  const o = L.parseOpen(JSON.stringify({ diary: 0, health: now - 30000, cycle: now - L.RELOCK_MS, mood: now + 60000, "Bad": 0, x: "1" }), now);
  assert.deepEqual(o, { diary: 0, health: now - 30000 });
  assert.deepEqual(L.parseOpen("nope", now), {});
  assert.equal(L.RELOCK_MS, 60000, "Chris 2026-11-17: one minute after you leave it");
});

test("scope: a lock from before covers all of orOS; Sensitive work never leaves it at only the apps", () => {
  const base = { v: 1, kind: "pin", salt: "c2FsdA==", hash: "aGFzaA==", i: 600000, idle: 5, hidden: false };
  assert.equal(L.parseCfg(JSON.stringify(base)).scope, "all");
  const apps = L.parseCfg(JSON.stringify(Object.assign({}, base, { scope: "apps" })));
  assert.equal(apps.scope, "apps");
  assert.equal(L.clampCfg(apps, "on").scope, "all");
  assert.equal(L.clampCfg(apps, "hard").scope, "all");
  assert.equal(L.loosens("on", "scope", "apps"), true);
  assert.equal(L.loosens("on", "scope", "all"), false);
  assert.equal(L.loosens("off", "scope", "apps"), false);
});

test("lock.js: device-local, never synced; start, idle and hidden lock only the apps in scope \"apps\"", () => {
  const src = read("lock.js");
  assert.match(src, /var APPS_KEY = "oros-applock";/);
  assert.ok(!read("sync.js").includes("oros-applock"), "sync.js never names the list");
  assert.match(src, /if \(cfg\.scope === "apps" && reason !== "now" && reason !== "remote" && reason !== "owner"\) \{\n\s+appsRelock\(true\);\n\s+return false;/);
  assert.match(src, /appsRelock\(false\);\s+\/\/ apps left in the background lock again/);
  assert.match(src, /appsWrite\(null\);\s+\/\/ APPLOCK-1: no lock, no locked apps/, "turning the lock off clears the list");
  // the app's box uses the same checks as the lock screen
  assert.match(src, /function appTry\(secret\)[\s\S]+?secretVerdict\(secret\)[\s\S]+?if \(ok === "duress"\) \{ duressGo\(\); return; \}[\s\S]+?failOnce\(\);/);
  assert.match(src, /function appTryBio\(\)[\s\S]+?bioAttempt\(\)/);
  // opening an app up needs the PIN, locking one does not
  assert.match(src, /if \(!l\.broken && rank\[value\] >= rank\[was\]\) return Promise\.resolve\(write\(\)\);\n\s+return run\(checkCurrent\(current\)/);
  assert.match(src, /e\.key !== APPS_KEY/, "another tab's change is read again");
});

test("shell: a locked app never loads before the PIN, from any way in", () => {
  const src = read("shell.js");
  const open = src.indexOf("function openApp(app, at) {");
  const guard = src.indexOf("if (app && app.type === \"internal\" && !appLockOk(app.id)) { appLockAsk(app, function () { openApp(app, at); }); return; }", open);
  const frame = src.indexOf("frameGo(document.getElementById(\"app-frame\"), app.url + (at || \"\"))", open);
  assert.ok(open > 0 && guard > open && frame > guard, "the check comes before the frame loads");
  assert.match(src, /if \(!appLockOk\(appId\)\) \{ appLockAsk\(app, function \(\) \{ window\.__orosOpenAt\(appId, target\); \}\); return; \}/, "deep links and live apps too");
  assert.match(src, /appLockFront\(prev, app\);/);
  assert.match(src, /appLockFront\(prev, null\);/);
  assert.match(src, /window\.orosLock\.onChange\(function \(\) \{\n\s+appLockCover\(\);/, "an app in front that locks again is covered");
  assert.match(src, /cancel: !\(SOLO && app\.id === SOLO\)/, "a single app has no way past its own box");
});

test("search, Today, notifications, the Assistant and orOS Gate leave a locked app out", () => {
  assert.match(read("search.js"), /\(!opts\.enabled \|\| opts\.enabled\(p\.id\)\) && !lockHides\(p\.id\)/);
  const agg = read("today/agg.js");
  assert.match(agg, /if \(lockSkip\(p\.id, opts\.lockSet\)\) return;/);
  assert.match(agg, /if \(lockSkip\(p\.id, lockSet\)\) return;/);
  const host = read("today/host.js");
  assert.match(host, /building = build\(true\)/, "the daily notice (it syncs) never names a locked app");
  assert.match(host, /A\.run\(\[p\], ctx, \{ lockSet: true \}\)/, "the Assistant's agenda");
  const n = read("notifications.js");
  assert.match(n, /new Notification\('orOS — ' \+ shownTitle\(item, true\), \{\n\s+body: shownBody\(item, true\),/);
  assert.match(n, /escapeHtml\(shownTitle\(item\)\)/);
  assert.ok(!/escapeHtml\(item\.title\)/.test(n), "no notice shows its raw title");
  assert.match(n, /lockHidesNs\(item\.ns, true\) \? lockNotice\(\)/, "automation rules never read a locked app's text");
  const sh = read("shell.js");
  assert.match(sh, /return searchApps\(\)\.filter\(function \(a\) \{ return !appLockSet\(a\.id\); \}\)/);
  assert.match(sh, /if \(!appLockSet\(String\(id\)\)\) allow\[String\(id\)\] = true;/);
  const g = read("gate/gate.js");
  assert.match(g, /function barred\(id\) \{ return NEVER\.indexOf\(id\) >= 0 \|\| lockedHere\(id\); \}/);
  assert.match(g, /return a && !barred\(a\.id\) && \(l\[a\.id\] === "read"/);
  assert.match(g, /writable\(id\) && !barred\(id\)/);
});

test("strings EN / EL / DE", () => {
  const tr = read("translations.js"), de = read("i18n/de/shell.js");
  for (const k of ["lock.app.title", "lock.app.titleAny", "lock.app.open", "lock.app.cancel", "applock.cover", "applock.unlock", "applock.notice"]) {
    const n = tr.split('"' + k + '":').length - 1;
    assert.equal(n, 2, k + " in EN and EL");
    assert.ok(de.includes('"' + k + '":'), k + " in DE");
  }
  const sc = read("settings/core.js"), sd = read("i18n/de/settings.js");
  for (const k of ["l.apps", "l.apps.hint", "l.scope", "l.scope.all", "l.scope.apps", "l.scope.apps.hint", "l.apps.broken", "l.apps.remove", "l.apps.askPin", "l.apps.locked", "l.apps.now", "l.apps.honest", "w.lock-apps"]) {
    assert.equal(sc.split('"' + k + '":').length - 1, 2, k + " in EN and EL");
    assert.ok(sd.includes('"' + k + '":'), k + " in DE");
  }
  assert.match(read("settings/help.en.txt"), /### App lock/);
  assert.match(read("settings/help.el.txt"), /### Κλείδωμα εφαρμογών/);
});

test("W2 hidden apps: out of every list until the PIN shows them for a minute", () => {
  const sh = read("shell.js");
  assert.match(sh, /function appHiddenNow\(id\) \{\n\s+var A = appLockApi\(\);\n\s+try \{ return !!\(A && A\.state\(id\) === "hide" && !A\.allowed\(id\)\); \} catch \(e\) \{ return true; \}/);
  assert.match(sh, /if \(appHiddenNow\(app\.id\)\) return;\s+\/\/ APPLOCK-1 W2: a hidden app is not even found/);
  for (const re of [/apps: function \(\) \{ return shownApps\(\); \},\s+\/\/ APPLOCK-1 W2: no hidden app on the desktop or the Dock/,
                    /function cmdApps\(\) \{\n\s+return shownApps\(\)/, /window\.orosTodayEnv = \{\n\s+apps: function \(\) \{\n\s+return shownApps\(\)/]) assert.match(sh, re);
  assert.match(sh, /LA\.reveal\(\)\.then\(function \(ok\) \{ if \(ok\) renderMenu\(\); \}\)/);
  assert.match(sh, /name: hid \? "" : appLockName\(app\)/, "a hidden app is never named in its box");
  const src = read("lock.js");
  assert.match(src, /if \(l\.apps\[k\] === "hide" && !Object\.prototype\.hasOwnProperty\.call\(o, k\)\) o\[k\] = now;/, "the row shows them as just left: one minute");
  assert.match(src, /if \(!opts\.reveal && appAllowed\(id\)\) return Promise\.resolve\(true\);/);
  assert.match(read("notifications.js"), /if \(window\.orosLock\.apps\.state\(ns\) === 'hide'\) return 'orOS';/);
  const tr = read("translations.js"), de = read("i18n/de/shell.js");
  for (const k of ["applock.coverAny", "applock.hiddenRow", "lock.app.reveal"]) {
    assert.equal(tr.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.includes('"' + k + '":'), k + " DE");
  }
  const sc = read("settings/core.js"), sd = read("i18n/de/settings.js");
  for (const k of ["l.apps.isLocked", "l.apps.isHidden", "l.apps.hide", "l.apps.unhide", "l.apps.hidden", "l.apps.askShow", "l.apps.shown"]) {
    assert.equal(sc.split('"' + k + '":').length - 1, 2, k);
    assert.ok(sd.includes('"' + k + '":'), k + " DE");
  }
});
