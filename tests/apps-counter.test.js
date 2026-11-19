// APPS-DL: the download counter Worker (tools/apps-counter/worker.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "tools", "apps-counter", "worker.js"), "utf8");
const mod = {};
new Function("exports", SRC.replace(/^export default /m, "exports.default = ").replace(/^export function (\w+)/gm, "exports.$1 = function $1"))(mod);

test("channels come only from the user agent", () => {
  assert.equal(mod.channel("KoulaxizisApps/1"), "manager");
  assert.equal(mod.channel("F-Droid 1.21.1"), "fdroid");
  assert.equal(mod.channel("Droid-ify/0.6.3"), "droidify");
  assert.equal(mod.channel("com.looker.droidify/0.6"), "droidify");
  assert.equal(mod.channel("Obtainium/1.1"), "obtainium");
  assert.equal(mod.channel("Mozilla/5.0"), "other");
  assert.equal(mod.channel(""), "other");
  assert.equal(mod.channel("xKoulaxizisApps/1"), "other");
});

test("only repository APK file names count, with their package", () => {
  assert.equal(mod.apkPackage("repo/tech.nulljsfx.remote.daws_40100_db128791.apk"), "tech.nulljsfx.remote.daws");
  assert.equal(mod.apkPackage("repo/net.glarolykoi.android_1000000_ca7191a5.apk"), "net.glarolykoi.android");
  assert.equal(mod.apkPackage("repo/online.useoros.twa_7780000.apk"), "online.useoros.twa");
  assert.equal(mod.apkPackage("repo/index-v2.json"), null);
  assert.equal(mod.apkPackage("repo/x.apk"), null);
  assert.equal(mod.apkPackage("repo/a.b_1_zzzzzzzz.apk"), null);
  assert.equal(mod.apkPackage("site/a.b_1.apk"), null);
});

test("paths stay inside the repository", () => {
  assert.ok(mod.safePath("repo/entry.jar"));
  assert.ok(mod.safePath("repo/icons/a.b.png"));
  assert.ok(!mod.safePath("repo/../x"));
  assert.ok(!mod.safePath("../x"));
  assert.ok(!mod.safePath("repo//x"));
  assert.ok(!mod.safePath("repo/a?b"));
  assert.ok(!mod.safePath("repo/%2e%2e/x"));
});

test("a download counts once, resumed parts do not", () => {
  assert.ok(mod.counts("GET", 200, null));
  assert.ok(mod.counts("GET", 206, "bytes=0-"));
  assert.ok(!mod.counts("GET", 206, "bytes=1000-"));
  assert.ok(!mod.counts("HEAD", 200, null));
  assert.ok(!mod.counts("GET", 304, null));
  assert.ok(!mod.counts("GET", 404, null));
});

test("the asset map names a package for every orOS APK", () => {
  const a = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "tools", "apps-counter", "assets.json"), "utf8"));
  assert.equal(a["koulaxizis/oros"]["android-apks"]["oros.apk"], "online.useoros.twa");
  assert.equal(a["koulaxizis/oros"]["koulaxizis-apps"]["koulaxizis-apps.apk"], "gr.koulaxizis.apps");
  assert.equal(a["koulaxizis/oros"]["android-apks"]["oros-glarolykoi.apk"], "net.glarolykoi.android");
});
