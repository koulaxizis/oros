// APPS-DL: the download counter Worker (tools/apps-counter/worker.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "tools", "apps-counter");
const SRC = fs.readFileSync(path.join(DIR, "worker.js"), "utf8")
  .replace("/*ASSETS*/ {}", fs.readFileSync(path.join(DIR, "assets.json"), "utf8"));
const mod = {};
const NAMES = [...SRC.matchAll(/^export function (\w+)/gm)].map((m) => m[1]);
new Function("exports", SRC.replace(/^export default /m, "exports.default = ").replace(/^export function /gm, "function ")
  + "\n" + NAMES.map((n) => "exports." + n + " = " + n + ";").join("\n"))(mod);

test("channels come only from the user agent", () => {
  assert.equal(mod.channel("KoulaxizisApps/1"), "manager");
  assert.equal(mod.channel("KoulaxizisApps/1 (test)"), null);
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

test("the worker passes files through and counts one APK download per channel", async () => {
  const rows = new Map();
  const db = {
    prepare(sql) {
      const st = { sql, args: [], bind(...a) { st.args = a; return st; },
        async run() {
          if (/INSERT INTO dl/.test(sql)) { const k = st.args.join("|"); rows.set(k, (rows.get(k) || 0) + 1); }
          return {};
        },
        async first() { return null; } };
      return st;
    },
    async batch(list) {
      return list.map((st) => ({ results: /FROM dl/.test(st.sql) ? [...rows].map(([k, n]) => ({ pkg: k.split("|")[0], ch: k.split("|")[1], n })) : [] }));
    },
  };
  const seen = [];
  global.fetch = async (u, o) => { seen.push([String(u), o.headers.get("user-agent")]); return new Response("APK", { status: 200, headers: { "content-type": "application/vnd.android.package-archive", "set-cookie": "x=1" } }); };
  global.caches = { default: { async match() { return undefined; }, async put() {} } };
  const waits = [];
  const ctx = { waitUntil(p) { waits.push(p); } };
  const w = mod.default;
  const get = (p, ua, extra) => w.fetch(new Request("https://apps.koulaxizis.workers.dev" + p, { headers: { "user-agent": ua, ...(extra || {}) } }), { DB: db }, ctx);
  let r = await get("/noxpress-fdroid/repo/tech.noxpress.sitebridge_13_dbf06e85.apk", "KoulaxizisApps/1");
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "APK");
  assert.equal(r.headers.get("set-cookie"), null);
  assert.equal(seen[0][0], "https://koulaxizis.github.io/noxpress-fdroid/repo/tech.noxpress.sitebridge_13_dbf06e85.apk");
  assert.equal(seen[0][1], "koulaxizis-apps-counter");
  await get("/noxpress-fdroid/repo/tech.noxpress.sitebridge_13_dbf06e85.apk", "Droid-ify/0.6");
  await get("/noxpress-fdroid/repo/index-v2.json", "F-Droid 1.21");
  await Promise.all(waits);
  assert.deepEqual([...rows], [["tech.noxpress.sitebridge|manager", 1], ["tech.noxpress.sitebridge|droidify", 1]]);
  assert.equal((await get("/elsewhere/repo/a.apk", "x")).status, 404);
  assert.equal((await w.fetch(new Request("https://apps.koulaxizis.workers.dev/oros-fdroid/repo/x", { method: "POST", body: "x" }), { DB: db }, ctx)).status, 405);
  const s = await (await get("/stats.json", "x")).json();
  assert.equal(s.apps["tech.noxpress.sitebridge"].manager, 1);
  assert.equal(s.apps["tech.noxpress.sitebridge"].droidify, 1);
  assert.equal(s.files["koulaxizis/noxpress/site-bridge.apk"], "tech.noxpress.sitebridge");
  assert.equal(s.files["koulaxizis/oros/koulaxizis-apps.apk"], "gr.koulaxizis.apps");
  assert.equal(s.files["koulaxizis/oros/oros-feeds.apk"], "online.useoros.reader");
});
