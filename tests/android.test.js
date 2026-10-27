// Android app project (android/, BR-PHONE): the generated manifest and
// resources follow manifest.webmanifest, and the phone bridge pieces
// the page relies on are declared.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { build } = require(path.join(ROOT, "android", "tools", "gen.js"));
const web = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8"));
const out = build(web);
const xml = out["AndroidManifest.xml"];

test("android: manifest carries the web app's file handlers, share target and shortcuts", () => {
  const handlers = (web.file_handlers || []).length;
  assert.equal((xml.match(/FileHandlingActivity/g) || []).length >= handlers, true);
  if (web.share_target) assert.match(xml, /SHARE_TARGET/);
  const shortcuts = (web.shortcuts || []).length;
  assert.equal((out["res/xml/shortcuts.xml"].match(/<shortcut /g) || []).length, Math.min(shortcuts, 4));
  assert.match(out["res/values/web_manifest.xml"], /<resources>/);
});

test("android: phone bridge pieces are declared", () => {
  for (const s of ["android.permission.READ_CONTACTS", "android.permission.WRITE_CONTACTS",
    "android.permission.READ_CALENDAR", "android.permission.WRITE_CALENDAR",
    "androidx.browser.customtabs.PostMessageService", ".PermissionActivity", "${permissionScheme}",
    ".AuthenticatorService", ".ContactsSyncService", ".CalendarSyncService"]) {
    assert.ok(xml.includes(s), s);
  }
  const app = path.join(ROOT, "android", "app", "src", "main");
  for (const f of ["res/xml/authenticator.xml", "res/xml/sync_contacts.xml", "res/xml/sync_calendar.xml", "res/xml/contacts.xml"]) {
    assert.ok(fs.existsSync(path.join(app, f)), f);
  }
});

test("android: the page asks for permission with the scheme the release build declares", () => {
  const phone = fs.readFileSync(path.join(ROOT, "phone.js"), "utf8");
  const gradle = fs.readFileSync(path.join(ROOT, "android", "app", "build.gradle"), "utf8");
  const scheme = /release \{\s*resValue[\s\S]*?permissionScheme: '([^']+)'/.exec(gradle)[1];
  const id = /applicationId '([^']+)'/.exec(gradle)[1];
  assert.ok(phone.includes("scheme=" + scheme + ";package=" + id + ";end"), scheme);
});

test("android: single-app flavours (wave 7) keep orOS untouched and drop the phone bridge", () => {
  const { buildSolo, soloApps, REMOVE_NODES } = require(path.join(ROOT, "android", "tools", "gen.js"));
  const S = require(path.join(ROOT, "solo.js"));
  const apps = soloApps();
  const pkgs = Object.values(apps);
  assert.equal(new Set(pkgs).size, pkgs.length);
  assert.ok(!pkgs.includes("online.useoros.twa"));
  const gradle = fs.readFileSync(path.join(ROOT, "android", "app", "build.gradle"), "utf8");
  assert.match(gradle, /oros \{\s*dimension 'app'\s*\}/);   // orOS keeps defaultConfig's package
  const links = JSON.parse(fs.readFileSync(path.join(ROOT, ".well-known", "assetlinks.json"), "utf8"));
  // FDROID-1: the start address carries the versionCode build.gradle derives from APP_VERSION
  const v = /APP_VERSION\s*=\s*"(\d+)\.(\d+)\.(\d+)"/.exec(fs.readFileSync(path.join(ROOT, "shell.js"), "utf8"));
  const code = Number(v[1]) * 1000000 + Number(v[2]) * 1000 + Number(v[3]);
  assert.ok(build(web)["res/values/web_manifest.xml"].includes(`<string name="launchUrl">https://useoros.online/?source=pwa&amp;apk=${code}</string>`));
  for (const [id, pkg] of Object.entries(apps)) {
    assert.ok(S.has(id), id);
    assert.ok(links.some((s) => s.target.package_name === pkg && s.relation.includes("delegate_permission/common.use_as_origin")), pkg);
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, id, "manifest.webmanifest"), "utf8"));
    const o = buildSolo(id, pkg, m, web);
    const x = o["AndroidManifest.xml"];
    for (const p of ["READ_CONTACTS", "WRITE_CALENDAR", "health.READ_STEPS", "SCHEDULE_EXACT_ALARM"]) {
      assert.match(x, new RegExp('android\\.permission\\.' + p.replace(".", "\\.") + '" tools:node="remove"'), id + " " + p);
    }
    REMOVE_NODES.forEach(([tag, name]) => assert.ok(x.includes(`<${tag} android:name="${name}" tools:node="remove" />`), id + " " + name));
    (web.file_handlers || []).forEach((h, i) => assert.ok(x.includes(`android:name="FileHandlingActivity${i}" tools:node="remove"`)));
    assert.match(x, /<activity android:name="\.LauncherActivity"\n\s+tools:node="replace"/);
    assert.ok(x.includes(`android:pathPrefix="/${id}/"`), id + " links");
    assert.ok(o["res/values/web_manifest.xml"].includes(`<string name="launchUrl">https://useoros.online/${id}/solo.html?apk=${code}</string>`));
    assert.equal((o["res/xml/shortcuts.xml"].match(/targetPackage="([^"]+)"/g) || []).every((t) => t.includes(pkg)), true);
    assert.ok(!/online\.useoros\.twa"/.test(o["res/xml/shortcuts.xml"]));
    assert.ok(fs.existsSync(path.join(ROOT, "icons", "solo", id + "-192.png")));
    // Wave 7b: the app's own widget, its shortcuts as buttons (EN + EL).
    assert.ok(x.includes('<receiver android:name=".SoloWidget"'), id + " widget");
    const words = (S.APPS[id].shortcuts || []).slice(0, 3).map((s) => s.do);
    words.forEach((w) => assert.ok(o["res/values/solo_widget.xml"].includes(`<item>${w}</item>`), id + " " + w));
    assert.equal((o["res/values-el/solo_widget.xml"].match(/<item>/g) || []).length, words.length);
  }
});

test("android: SoloWidget only opens the app's own page with a shortcut word", () => {
  const j = fs.readFileSync(path.join(ROOT, "android", "app", "src", "main", "java", "online", "useoros", "twa", "SoloWidget.java"), "utf8");
  assert.match(j, /getString\(R\.string\.launchUrl\)/);
  assert.match(j, /appendQueryParameter\("do", word\)/);
  const main = build(web)["AndroidManifest.xml"];
  assert.ok(!main.includes("SoloWidget"));   // the orOS app keeps its own widgets only
});

test("orOS account: Contacts and Calendar sync have their switch and last-synced time in Settings", () => {
  const dir = path.join(ROOT, "android", "app", "src", "main");
  for (const f of ["sync_contacts.xml", "sync_calendar.xml"]) {
    assert.match(fs.readFileSync(path.join(dir, "res", "xml", f), "utf8"), /android:userVisible="true"/, f);
  }
  const twa = path.join(dir, "java", "online", "useoros", "twa");
  const acc = fs.readFileSync(path.join(twa, "OrosAccount.java"), "utf8");
  // Switched on once, never forced off again (the person's choice wins).
  assert.doesNotMatch(acc, /setSyncAutomatically\([^)]*false\)/);
  assert.match(acc, /SYNC_ON_SET/);
  const bridge = fs.readFileSync(path.join(twa, "PhoneBridge.java"), "utf8");
  assert.match(bridge, /if \(!OrosAccount\.syncOn\(app, authority\)\) throw/);
  assert.match(bridge, /OrosAccount\.synced\(app, authority\)/);
  assert.match(bridge, /if \(!OrosAccount\.syncOn\(app, contacts \?/);
});

test("android: the Assistant tile and widget button open #quick-ask (AS-OUT)", () => {
  assert.match(xml, /<service android:name="\.AskTile" android:exported="true"[^>]*android:permission="android\.permission\.BIND_QUICK_SETTINGS_TILE"/);
  assert.ok(xml.includes("android.service.quicksettings.action.QS_TILE"));
  const { REMOVE_NODES } = require(path.join(ROOT, "android", "tools", "gen.js"));
  assert.ok(REMOVE_NODES.some(([t, n]) => t === "service" && n === ".AskTile"));    // single apps leave it out
  const main = path.join(ROOT, "android", "app", "src", "main");
  const java = (f) => fs.readFileSync(path.join(main, "java", "online", "useoros", "twa", f), "utf8");
  assert.match(java("Widgets.java"), /\.fragment\("quick-ask"\)/);
  assert.match(java("AskTile.java"), /Widgets\.ask\(this\)/);
  for (const l of ["widget_quick.xml", "widget_today.xml"]) {
    assert.ok(fs.readFileSync(path.join(main, "res", "layout", l), "utf8").includes('android:id="@+id/w_ask"'), l);
  }
  for (const v of ["values", "values-el"]) {
    const s = fs.readFileSync(path.join(main, "res", v, "strings.xml"), "utf8");
    assert.ok(s.includes('name="widget_ask"') && s.includes('name="tile_ask"'), v);
  }
  const first = (web.shortcuts || []).slice(0, 4).map((s) => s.url);
  assert.ok(first.includes("/#quick-ask"), "the Ask shortcut reaches Android's four");
  assert.ok(out["res/xml/shortcuts.xml"].includes('android:data="https://useoros.online/#quick-ask"'));
});

test("android: Calendar and To-Do widgets (BR-PHONE v7) are the orOS app's own, home screen only", () => {
  const main = path.join(ROOT, "android", "app", "src", "main");
  const res = (f) => fs.readFileSync(path.join(main, "res", f), "utf8");
  const java = (f) => fs.readFileSync(path.join(main, "java", "online", "useoros", "twa", f), "utf8");
  for (const w of ["CalendarWidget", "TodoWidget"]) {
    assert.match(xml, new RegExp('<receiver android:name="\\.' + w + '" android:exported="false"'), w + " not exported");
  }
  const { REMOVE_NODES } = require(path.join(ROOT, "android", "tools", "gen.js"));
  for (const w of [".CalendarWidget", ".TodoWidget"]) assert.ok(REMOVE_NODES.some(([t, n]) => t === "receiver" && n === w), w + " not in single apps");
  for (const k of ["calendar", "todo"]) {
    const info = res("xml/widget_" + k + "_info.xml");
    assert.match(info, /android:widgetCategory="home_screen"/, "nothing on the lock screen");
    assert.ok(!/keyguard/.test(info));
  }
  // Every widget string in English, Greek and German.
  const names = (s) => (s.match(/name="(widget_[a-z_]+)"/g) || []).sort();
  const en = names(res("values/strings.xml"));
  for (const v of ["values-el", "values-de"]) assert.deepEqual(names(res(v + "/strings.xml")), en, v);
  // The tick goes only through the app's own broadcast; a repeating task opens To-Do.
  const ag = java("AgendaWidgets.java");
  assert.match(ag, /new Intent\(c, TodoWidget\.class\)\.setAction\(ACTION_TICK\)/);
  assert.match(ag, /"phone-done"/);
  assert.match(java("PhoneBridge.java"), /AgendaWidgets\.taken\(app, refs\)/);
});
