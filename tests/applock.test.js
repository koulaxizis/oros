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
  // NOTIF-OS: both computer paths (the tray, the browser's own) take osText
  assert.match(n, /if \(lockHidesNs\(item\.ns, true\)\) return true;/);
  assert.match(n, /return \{ title: shownTitle\(item, true\), body: shownBody\(item, true\) \};/);
  assert.match(n, /new Notification\('orOS — ' \+ tx\.title, \{\n\s+body: tx\.body,/);
  assert.match(n, /var osTx = osText\(item\);/);
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

test("W3: Calendar, Mood, the switcher and reminders that leave the screen leave a locked app out", () => {
  const cal = read("calendar/calendar.js");
  assert.match(cal, /function feedsOn\(dateStr\) \{\n\s+return feedLockFilter\(feedsAll\(dateStr\)\);/);
  // every feed label of an app names that app; only app-less feeds stay unnamed
  const labels = cal.slice(cal.indexOf("var FEED_LABELS"), cal.indexOf("];", cal.indexOf("var FEED_LABELS"))).match(/"lbl-feed-[a-z]+"/g);
  const mapSrc = cal.slice(cal.indexOf("var FEED_APP = {"), cal.indexOf("};", cal.indexOf("var FEED_APP = {")) + 2);
  const filterSrc = cal.slice(cal.indexOf("function feedLockFilter(rows)"), cal.indexOf("function feedsOn(dateStr)"));
  const MAP = new Function(mapSrc + " return FEED_APP;")();
  for (const l of labels) {
    const id = JSON.parse(l);
    if (["lbl-feed-pet", "lbl-feed-hol", "lbl-feed-obs"].includes(id)) assert.ok(!MAP[id], id + " has no app");
    else assert.ok(MAP[id], id + " names its app");
  }
  assert.equal(MAP["lbl-feed-sky"], "sky");
  assert.equal(MAP["lbl-feed-meds"], "health");
  const run = (allowed, rows) => new Function("window", mapSrc + filterSrc + " return feedLockFilter;")(
    { parent: allowed ? { orosLock: { apps: { allowed } } } : null })(rows);
  const rows = [{ labelId: "lbl-feed-meds" }, { labelId: "lbl-feed-hol" }, { labelId: "lbl-feed-budget" }, { labelId: "work" }];
  assert.deepEqual(run((id) => id !== "health", rows).map((r) => r.labelId), ["lbl-feed-hol", "lbl-feed-budget", "work"]);
  assert.equal(run(null, rows).length, 4, "standalone Calendar: no shell, nothing to ask");
  assert.deepEqual(run(() => { throw new Error("x"); }, rows).map((r) => r.labelId), ["lbl-feed-hol", "work"], "fails closed");
  assert.match(read("mood/mood.js"), /var craw = cycleShown\(\) \? localStorage\.getItem\("oros-cycle-data"\) : null;/);
  const sh = read("shell.js");
  assert.match(sh, /if \(appHiddenNow\(r\.app\.id\)\) return;\s+\/\/ APPLOCK-1 W3/);
  assert.match(sh, /window\.__orosLockMask = function \(r\) \{/);
  assert.match(read("phone.js"), /items = items\.map\(root\.__orosLockMask\);/);
  const wp = read("webpush.js");
  assert.match(wp, /function payload\(r\) \{\n\s+\/\/ APPLOCK-1 W3[^\n]*\n\s+try \{ if \(root && typeof root\.__orosLockMask === "function"\) r = root\.__orosLockMask\(r\); \} catch \(e\) \{\}/);
  assert.match(wp, /APPLOCK-1: locking an app sends again/);
});

test("W4 lock-screen info: off by default, hidden under Sensitive work and on a till, time only", () => {
  assert.deepEqual(L.parseInfo(undefined), { ev: false, mu: false, nc: false });
  assert.deepEqual(L.parseInfo({ ev: true, mu: 1, nc: "yes", x: true }), { ev: true, mu: false, nc: false }, "only true counts");
  assert.deepEqual(L.parseInfo([true]), { ev: false, mu: false, nc: false });
  const good = { v: 1, kind: "pin", salt: "c2FsdA==", hash: "aGFzaA==", i: 600000, idle: 10 };
  assert.deepEqual(L.parseCfg(JSON.stringify(good)).info, { ev: false, mu: false, nc: false }, "a lock from before shows nothing");
  const on = L.parseCfg(JSON.stringify(Object.assign({ info: { ev: true, nc: true } }, good)));
  assert.deepEqual(L.infoShown(on, "off", false), { ev: true, mu: false, nc: true });
  assert.equal(L.infoShown(on, "on", false), null, "Sensitive work");
  assert.equal(L.infoShown(on, "hard", false), null, "Hardcore");
  assert.equal(L.infoShown(on, "off", true), null, "a till");
  assert.equal(L.infoShown(L.parseCfg(JSON.stringify(good)), "off", false), null, "nothing switched on");
  assert.deepEqual(L.clampCfg(on, "on").info, on.info, "Sensitive work keeps the choice, it only hides it");
  // The next event: real timed events only, today from now on, then tomorrow.
  const rows = [
    { id: "ev:a:2026-11-18", due: "2026-11-18", time: "08:00" },
    { id: "hol:x", due: "2026-11-18", time: "10:00" },
    { id: "ev:b", due: "2026-11-18" },
    { id: "ev:c", due: "2026-11-19", time: "09:00" },
    { id: "ev:d", due: "2026-11-18", time: "14:30" },
    { id: "ev:e", due: "2026-11-20", time: "07:00" }
  ];
  assert.deepEqual(L.nextEvent(rows, "2026-11-18", "2026-11-19", "09:15"), { day: 0, time: "14:30" });
  assert.deepEqual(L.nextEvent(rows, "2026-11-18", "2026-11-19", "15:00"), { day: 1, time: "09:00" });
  assert.equal(L.nextEvent(rows.slice(0, 3), "2026-11-18", "2026-11-19", "15:00"), null);
  assert.equal(L.nextEvent(null, "2026-11-18", "2026-11-19", "15:00"), null);
});

test("W4 wiring: the shell gives lock.js times and counts, never titles; Settings has three switches", () => {
  const lk = read("lock.js");
  assert.match(lk, /function paintInfo\(\) \{\n\s+if \(!ui \|\| !ui\.info\) return;\n\s+var I = ui\.info, on = infoShown\(cfg, strictLevel\(\), tillOn\(\)\)/);
  assert.match(lk, /clockTimer = setInterval\(function \(\) \{ paintClock\(\); paintInfo\(\); \}, 15000\);/);
  assert.match(lk, /else if \(name === "info" && value && typeof value === "object"\)/);
  const sh = read("shell.js");
  const api = sh.slice(sh.indexOf("window.__orosLockInfo = {"), sh.indexOf("// SB2: the Automations step"));
  assert.match(api, /appLockSet\("calendar"\)\) return Promise\.resolve\(\[\]\)/);
  assert.match(api, /return \{ id: String\(r\.id \|\| ""\)\.slice\(0, 3\), due: r\.due, time: r\.time \};/, "only id prefix, day and time leave the shell");
  assert.ok(!/title|name|text/.test(api.replace(/\/\/[^\n]*/g, "")), "no title, name or text in the lock-screen API");
  assert.match(api, /qsMedia\(\)\.filter\(function \(m\) \{ return !appLockSet\(m\.id\); \}\)/);
  assert.match(read("notifications.js"), /unread: \(\) => \(state\.slice && Array\.isArray\(state\.slice\.items\)/);
  const st = read("settings/settings.js");
  assert.match(st, /if \(k\.info\) secLockInfo\(host, L, k, strict\);/);
  assert.match(st, /\[\["ev", "l\.info\.ev"\], \["mu", "l\.info\.mu"\], \["nc", "l\.info\.nc"\]\]/);
  const tr = read("translations.js"), de = read("i18n/de/shell.js");
  for (const k of ["today", "tomorrow", "one", "many", "music", "play", "pause", "next", "prev"]) {
    assert.equal(tr.split('"lock.info.' + k + '":').length - 1, 2, k);
    assert.ok(de.includes('"lock.info.' + k + '":'), k + " DE");
  }
  const sc = read("settings/core.js"), sd = read("i18n/de/settings.js");
  for (const k of ["l.info", "l.info.hint", "l.info.ev", "l.info.mu", "l.info.nc", "l.info.strict", "w.lock-info"]) {
    assert.equal(sc.split('"' + k + '":').length - 1, 2, k);
    assert.ok(sd.includes('"' + k + '":'), k + " DE");
  }
});
