// The release guards of .github/workflows/bump-version.yml (G2-G5),
// run here on every PR in check mode (OROS_CHECK=1, nothing written).
// A guard that fails only after the merge stamps nothing: sw.js keeps
// its old CACHE_VERSION and installed apps stay on old code while the
// version toast says they updated (2.26.00-2.40.00, Bible Part X-B).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, ".github", "scripts", "stamp-assets.js");

function run(cwd, env) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd, encoding: "utf8",
    env: Object.assign({}, process.env, { OROS_VERSION: "" }, env)
  });
}

function fixture(apps) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oros-guards-"));
  const w = (f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); };
  w("shell.js", 'var APP_VERSION = "9.9.99";');
  w("sw.js", 'var PRECACHE_URLS = [\n  "./index.html",\n  "./shell.js",\n  "app/index.html",\n  "app/app.js"\n];');
  w("index.html", '<script src="shell.js?v=1"></script>');
  w("apps.json", JSON.stringify({ apps: apps.map(id => ({ id: id, url: id + "/" })) }));
  w("app/index.html", '<script src="app.js?v=1"></script>');
  w("app/app.js", "inheritPalette(); watchPalette();");
  // A standalone page with no shell scripts (like download/).
  w("page/index.html", "<!doctype html><title>Get orOS</title>");
  return dir;
}

test("the repository passes every release guard", () => {
  const r = run(ROOT, { OROS_CHECK: "1" });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test("check mode writes nothing", () => {
  const dir = fixture(["app"]);
  const before = fs.readFileSync(path.join(dir, "app/index.html"), "utf8");
  assert.strictEqual(run(dir, { OROS_CHECK: "1" }).status, 0);
  assert.strictEqual(fs.readFileSync(path.join(dir, "app/index.html"), "utf8"), before);
});

test("stamp mode writes ?v= to every page", () => {
  const dir = fixture(["app"]);
  assert.strictEqual(run(dir, { OROS_VERSION: "9.9.99" }).status, 0);
  assert.match(fs.readFileSync(path.join(dir, "app/index.html"), "utf8"), /app\.js\?v=9\.9\.99/);
});

test("stamp mode writes the precache content hashes into sw.js (SW-U1)", () => {
  const dir = fixture(["app"]);
  const sw = path.join(dir, "sw.js");
  fs.writeFileSync(sw, fs.readFileSync(sw, "utf8") + "\nvar PRECACHE_HASH = {};\n");
  assert.strictEqual(run(dir, { OROS_VERSION: "9.9.99" }).status, 0);
  const m = /^var PRECACHE_HASH = (\{.*\});$/m.exec(fs.readFileSync(sw, "utf8"));
  const h = JSON.parse(m[1]);
  const sha = (f) => require("crypto").createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex").slice(0, 16);
  // Hashes of the bytes that ship: app/index.html after its ?v= stamp.
  assert.strictEqual(h["app/index.html"], sha("app/index.html"));
  assert.strictEqual(h["app/app.js"], sha("app/app.js"));
  assert.strictEqual(h["./shell.js"], sha("shell.js"));
  // Check mode leaves the table alone.
  const before = fs.readFileSync(sw, "utf8");
  run(dir, { OROS_CHECK: "1" });
  assert.strictEqual(fs.readFileSync(sw, "utf8"), before);
});

test("the repository's sw.js has the PRECACHE_HASH line the stamp fills", () => {
  assert.match(fs.readFileSync(path.join(ROOT, "sw.js"), "utf8"), /^var PRECACHE_HASH = \{.*\};$/m);
});

test("G3: an unregistered standalone page does not block the stamp", () => {
  const r = run(fixture(["app"]), { OROS_CHECK: "1" });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test("G3: a registered app without the palette still fails", () => {
  const dir = fixture(["app", "page"]);
  // give page a precache line so G2 passes and G3 is what fails
  fs.writeFileSync(path.join(dir, "sw.js"), fs.readFileSync(path.join(dir, "sw.js"), "utf8").replace('"app/app.js"', '"app/app.js",\n  "page/index.html"'));
  const r = run(dir, { OROS_CHECK: "1" });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /page\/ does not inherit the shell palette/);
});
