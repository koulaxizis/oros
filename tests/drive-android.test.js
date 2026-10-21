// orOS Drive on the phone: until wave 5 the orOS Android app held it
// (DRIVE-A); since then it is the orOS Drive app (DRIVE-APP,
// online.useoros.drive, koulaxizis/oros-drive android/), built and
// signed by android.yml and published in the F-Droid repository. The
// Java side builds only in CI, so these checks pin the wiring a broken
// build would not show: routes, state, strings, pin.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const MAIN = ["android", "app", "src", "main", "java", "online", "useoros", "twa"];

test("wave 5: the orOS app no longer embeds orOS Drive", () => {
  assert.ok(!fs.existsSync(path.join(ROOT, "android", "app", "src", "drive")));
  const g = read("android", "app", "build.gradle");
  assert.doesNotMatch(g, /orosdrive|driveLib|work-runtime/);
  assert.doesNotMatch(read("android", "app", "proguard-rules.pro"), /online\.useoros\.drive/);
  // Its old downloaded copies go; settings and the phone-file Trash stay.
  const app = read(...MAIN, "OrosApp.java");
  assert.match(app, /new java\.io\.File\(new java\.io\.File\(getFilesDir\(\), "drive"\), "cache"\)/);
  assert.doesNotMatch(app, /"Trash"/);
});

test("the page opens the orOS Drive app, or its download", () => {
  const p = read(...MAIN, "PermissionActivity.java");
  assert.match(p, /"drive"\.equals\(kind\)/);
  assert.match(p, /getLaunchIntentForPackage\(PhoneBridge\.DRIVE_APP\)/);
  assert.match(p, /"https:\/\/useoros\.online\/download\/" \+ \(el \? "\?lang=el#drive-el" : "#drive"\)/);
  const b = read(...MAIN, "PhoneBridge.java");
  assert.match(b, /DRIVE_APP = "online\.useoros\.drive"/);
  assert.match(b, /getPackageInfo\(DRIVE_APP, 0\)/);
  assert.match(b, /o\.put\("drive", hasDrive\(app\)\)/);
  // Android 11+ shows the package only when named
  assert.match(read("android", "tools", "gen.js"), /<package android:name="online\.useoros\.drive" \/>/);
  const page = read("download", "index.html");
  assert.match(page, /<section class="card" id="drive">/);
  assert.match(page, /<section class="card" id="drive-el">/);
  assert.equal((page.match(/android-apks\/oros-drive\.apk/g) || []).length, 2);
});

test("phone.js: drive link and state flag", () => {
  const src = read("phone.js");
  assert.match(src, /drive: "intent:\/\/drive#Intent;scheme=oros-permission;package=online\.useoros\.twa;end"/);
  assert.match(src, /drive: m\.drive === true/);
});

test("Files › orOS Drive: phone button opens or gets orOS Drive, EN + EL + DE", () => {
  const d = read("files", "drive.js");
  assert.match(d, /askPermission\("drive"\)/);
  assert.match(d, /t\(p\.state\(\)\.drive \? "phone" : "phoneGet"\)/);
  assert.equal((d.match(/"phone":\s+"/g) || []).length, 2);
  assert.equal((d.match(/"phoneGet":\s+"/g) || []).length, 2);
  const de = read("i18n", "de", "files.js");
  assert.match(de, /"phone": "/);
  assert.match(de, /"phoneGet": "/);
});

test("android.yml builds orOS Drive from a pinned oros-drive commit", () => {
  const y = read(".github", "workflows", "android.yml");
  const env = read(".github", "oros-drive.env");
  assert.match(env, /^commit=[0-9a-f]{40}$/m);
  assert.match(env, /^version=\d+\.\d+\.\d+$/m);
  assert.match(y, /grep -E '\^\(commit\|version\)=' \.github\/oros-drive\.env >> "\$GITHUB_OUTPUT"/);
  assert.match(y, /repository: koulaxizis\/oros-drive\n\s+ref: \$\{\{ steps\.drive\.outputs\.commit \}\}\n/);
  assert.match(y, /gomobile bind -target=android\/arm64,android\/arm,android\/amd64 -androidapi 24 -javapkg online\.useoros\.drive -o android\/app\/libs\/orosdrive\.aar \.\/mobile/);
  assert.match(y, /test -s android\/app\/libs\/orosdrive\.aar/);
  assert.match(y, /DRIVE_VERSION: \$\{\{ steps\.drive\.outputs\.version \}\}/);
  assert.match(y, /apk\/drive\/release\/app-drive-release\.apk/);
});

test("DRIVE-DL: an empty Drive links to orOS Drive on the download page, EN + EL + DE", () => {
  const d = read("files", "drive.js");
  assert.match(d, /showMsg\(t\("intro\.title"\), t\("intro\.body"\), getDrive\(\)\)/);
  assert.match(d, /a\.href = "\/download\/" \+ \(LANG === "el" \? "\?lang=el" : ""\);/);
  assert.match(d, /a\.rel = "noopener";/);
  assert.equal((d.match(/"intro\.get":\s+"/g) || []).length, 2);
  assert.match(read("i18n", "de", "files.js"), /"intro\.get": "/);
  const page = read("download", "index.html");
  assert.match(page, /<h2>orOS Drive \(your folders in the Vault\)<\/h2>/);
  assert.match(page, /<h2>orOS Drive \(οι φάκελοί σου στο Vault\)<\/h2>/);
});
