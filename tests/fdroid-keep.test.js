// tools/fdroid-keep.js: earlier APKs stay downloadable for a while after
// a publish, so a phone with an older index doesn't get a 404 (FDROID-1).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const K = require(path.join(ROOT, "tools", "fdroid-keep.js"));

const NOW = 1792330784000;
const MB = 1024 * 1024;

test("a file that just left the index is kept from now; files still in the index are not copied", () => {
  const out = K.plan({}, [{ name: "a_1_aaaa.apk", size: 10 }, { name: "a_2_bbbb.apk", size: 10 }, { name: "index-v2.json", size: 5 }],
    new Set(["a_2_bbbb.apk"]), NOW);
  assert.deepEqual(out, { "a_1_aaaa.apk": NOW });
});

test("kept files keep their first date and go after three days", () => {
  const prev = { "old.apk": NOW - K.KEEP_MS - 1, "recent.apk": NOW - 3600e3 };
  const out = K.plan(prev, [{ name: "old.apk", size: 1 }, { name: "recent.apk", size: 1 }], new Set(), NOW);
  assert.deepEqual(out, { "recent.apk": NOW - 3600e3 });
});

test("over the size cap the oldest kept files go first", () => {
  const files = [{ name: "new.apk", size: 300 * MB }, { name: "mid.apk", size: 150 * MB }, { name: "old.apk", size: 100 * MB }];
  const prev = { "mid.apk": NOW - 1000, "old.apk": NOW - 2000 };
  assert.deepEqual(Object.keys(K.plan(prev, files, new Set(), NOW)), ["new.apk", "mid.apk"]);
});

test("the script copies kept APKs into the new site and writes kept-apks.json", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fdkeep-"));
  const pub = path.join(tmp, "pub"), site = path.join(tmp, "site");
  fs.mkdirSync(path.join(pub, "repo"), { recursive: true });
  fs.mkdirSync(path.join(site, "repo"), { recursive: true });
  fs.writeFileSync(path.join(pub, "repo", "x_1_aaaa.apk"), "old build");
  fs.writeFileSync(path.join(pub, "repo", "x_0_cccc.apk"), "older build");
  fs.writeFileSync(path.join(pub, "kept-apks.json"), JSON.stringify({ "x_0_cccc.apk": 1 }));
  fs.writeFileSync(path.join(site, "repo", "x_2_bbbb.apk"), "new build");
  execFileSync(process.execPath, [path.join(ROOT, "tools", "fdroid-keep.js"), pub, site]);
  assert.deepEqual(fs.readdirSync(path.join(site, "repo")).sort(), ["x_1_aaaa.apk", "x_2_bbbb.apk"]);
  assert.equal(fs.readFileSync(path.join(site, "repo", "x_1_aaaa.apk"), "utf8"), "old build");
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(site, "kept-apks.json"), "utf8"))), ["x_1_aaaa.apk"]);
  fs.rmSync(tmp, { recursive: true });
});

test("the first publish (nothing published yet) keeps nothing", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fdkeep-"));
  fs.mkdirSync(path.join(tmp, "site", "repo"), { recursive: true });
  execFileSync(process.execPath, [path.join(ROOT, "tools", "fdroid-keep.js"), path.join(tmp, "none"), path.join(tmp, "site")]);
  assert.equal(fs.readFileSync(path.join(tmp, "site", "kept-apks.json"), "utf8"), "{}\n");
  fs.rmSync(tmp, { recursive: true });
});

test("fdroid.yml: the manifests' version line alone is no Android shell change", () => {
  const y = fs.readFileSync(path.join(ROOT, ".github", "workflows", "fdroid.yml"), "utf8");
  assert.match(y, /sed -E '\/\^\[\[:space:\]\]\*"version"\[\[:space:\]\]\*:\/d' "\$m"/);
  assert.match(y, /git diff --quiet -I '\^\[\[:space:\]\]\*"version"\[\[:space:\]\]\*:' "\$last" HEAD -- manifest\.webmanifest/);
  assert.match(y, /node tools\/fdroid-keep\.js "\$prev" "\$site"/);
});
