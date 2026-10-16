// orOS Drive on the phone (DRIVE-A): the orOS Android app mirrors
// phone folders with the Go core of koulaxizis/oros-drive. The Java
// side builds only in CI (android.yml), so these checks pin the wiring
// that a broken build would not show: routes, state, strings, pin.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const JAVA = ["android", "app", "src", "oros", "java", "online", "useoros", "twa"];
const MAIN = ["android", "app", "src", "main", "java", "online", "useoros", "twa"];

test("DriveActivity is declared in the orOS flavour only, not exported", () => {
  const m = read("android", "app", "src", "oros", "AndroidManifest.xml");
  assert.match(m, /<activity android:name="\.DriveActivity"\s+android:exported="false"/);
  assert.ok(fs.existsSync(path.join(ROOT, ...JAVA, "DriveActivity.java")));
  assert.doesNotMatch(read("android", "tools", "gen.js"), /DriveActivity/);
  const g = read("android", "app", "build.gradle");
  assert.match(g, /orosImplementation files\('libs\/orosdrive\.aar'\)/);
  assert.match(g, /orosImplementation 'androidx\.work:work-runtime:/);
});

test("the page opens it through PermissionActivity by class name", () => {
  const p = read(...MAIN, "PermissionActivity.java");
  assert.match(p, /"drive"\.equals\(kind\)/);
  assert.doesNotMatch(p, /DriveActivity\.class/); // other flavours have no such class
  const b = read(...MAIN, "PhoneBridge.java");
  assert.match(b, /DRIVE_ACTIVITY = "online\.useoros\.twa\.DriveActivity"/);
  assert.match(b, /o\.put\("drive", hasDrive\(app\)\)/);
});

test("phone.js: drive link and state flag", () => {
  const src = read("phone.js");
  assert.match(src, /drive: "intent:\/\/drive#Intent;scheme=oros-permission;package=online\.useoros\.twa;end"/);
  assert.match(src, /drive: m\.drive === true/);
});

test("Files › orOS Drive: phone folders button, EN + EL", () => {
  const d = read("files", "drive.js");
  assert.match(d, /askPermission\("drive"\)/);
  assert.equal((d.match(/"phone":\s+"/g) || []).length, 2);
});

test("every drive string the Java uses exists in English and Greek", () => {
  const keys = (x) => new Set([...x.matchAll(/<string name="(drive_[a-z0-9_]+)"/g)].map((m) => m[1]));
  const en = keys(read("android", "app", "src", "oros", "res", "values", "drive_strings.xml"));
  const el = keys(read("android", "app", "src", "oros", "res", "values-el", "drive_strings.xml"));
  assert.deepEqual([...en].sort(), [...el].sort());
  const used = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, ...JAVA))) {
    for (const m of read(...JAVA, f).matchAll(/R\.string\.(drive_[a-z0-9_]+)/g)) used.add(m[1]);
  }
  used.add("drive_title"); // the manifest label
  for (const k of used) assert.ok(en.has(k), k + " missing");
});

test("android.yml builds the library from a pinned oros-drive commit", () => {
  const y = read(".github", "workflows", "android.yml");
  assert.match(y, /repository: koulaxizis\/oros-drive\n\s+ref: [0-9a-f]{40}\n/);
  assert.match(y, /gomobile bind -target=android -androidapi 24 -javapkg online\.useoros\.drive -o \.\.\/android\/app\/libs\/orosdrive\.aar \.\/mobile/);
  assert.match(read("android", ".gitignore"), /^app\/libs\/orosdrive\.aar$/m);
  const pg = read("android", "app", "proguard-rules.pro");
  assert.match(pg, /-keep class go\.\*\* \{ \*; \}/);
  assert.match(pg, /-keep class online\.useoros\.drive\.\*\* \{ \*; \}/);
});
