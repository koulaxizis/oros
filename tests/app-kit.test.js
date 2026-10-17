// orOS App Kit (docs/app-kit, .github/app-kit): the template passes the
// app contract once registered, new-app.js fills in id and names, the
// check finds the usual mistakes, every app on main passes it, and the
// guide keeps a chapter for every step of Bible Checklist B.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const KIT = path.join(ROOT, ".github", "app-kit");
const TPL = path.join(ROOT, "docs", "app-kit", "template");
const { checkApp } = require(path.join(KIT, "check-app.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// A tiny checkout with one other app, so a category exists.
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oros-kit-"));
  const w = (f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); };
  w("apps.json", JSON.stringify({ apps: [{ id: "notes", name: "Notes", category: "Office", icon: "notes", url: "notes/", type: "internal" }] }));
  w("shell.js", "  var ICONS = {\n    notes: '<svg></svg>',\n  };\n");
  w("translations.js", '  en: {\n    "app.notes": "Notes",\n  },\n  el: {\n    "app.notes": "Σημειώσεις",\n  },\n');
  w("sw.js", 'var PRECACHE_URLS = [\n  "./index.html",\n];\n');
  return dir;
}

function newApp(dir, id, en, el) {
  return spawnSync(process.execPath, [path.join(KIT, "new-app.js"), "--root", dir, id, en, el], { encoding: "utf8" });
}

// What a contributor adds by hand after new-app.js.
function register(dir, id, en, el) {
  const f = (p) => path.join(dir, p);
  const apps = JSON.parse(fs.readFileSync(f("apps.json"), "utf8"));
  apps.apps.push({ id, name: en, category: "Office", icon: id, url: id + "/", search: "search.js", type: "internal" });
  fs.writeFileSync(f("apps.json"), JSON.stringify(apps));
  fs.writeFileSync(f("shell.js"), fs.readFileSync(f("shell.js"), "utf8").replace("  };", "    " + id + ": '<svg></svg>',\n  };"));
  fs.writeFileSync(f("translations.js"), fs.readFileSync(f("translations.js"), "utf8")
    .replace('"Notes",', '"Notes",\n    "app.' + id + '": "' + en + '",')
    .replace('"Σημειώσεις",', '"Σημειώσεις",\n    "app.' + id + '": "' + el + '",'));
  const files = fs.readdirSync(f(id)).map((x) => '  "' + id + "/" + x + '",').join("\n");
  fs.writeFileSync(f("sw.js"), fs.readFileSync(f("sw.js"), "utf8").replace("];", '  "' + id + '/",\n' + files + "\n];"));
}

const errors = (res) => res.filter((r) => r.level === "error").map((r) => r.rule + ": " + r.msg);

test("new-app.js copies the template with the id and names filled in", () => {
  const dir = fixture();
  const r = newApp(dir, "pocket", "Pocket List", "Λίστα τσέπης");
  assert.equal(r.status, 0, r.stderr);
  const files = fs.readdirSync(path.join(dir, "pocket")).sort();
  assert.deepEqual(files, fs.readdirSync(TPL).filter((f) => f !== "myapp.test.js").sort());
  for (const f of files.concat(["../tests/pocket.test.js"])) {
    const s = fs.readFileSync(path.join(dir, "pocket", f), "utf8");
    assert.ok(!/myapp|MyApp|My App|Η εφαρμογή μου/.test(s), f + " still has a template name");
  }
  assert.match(fs.readFileSync(path.join(dir, "pocket/index.html"), "utf8"), /"\.\.\/\?open=pocket"/);
  assert.match(fs.readFileSync(path.join(dir, "pocket/help.el.txt"), "utf8"), /^# Λίστα τσέπης/);
  assert.match(r.stdout, /"app\.pocket": "Λίστα τσέπης"/);
  assert.notEqual(newApp(dir, "pocket", "Pocket List", "Λίστα τσέπης").status, 0, "an existing folder is never overwritten");
  assert.notEqual(newApp(dir, "Bad-Id", "X", "Χ").status, 0);
  assert.notEqual(newApp(dir, "other", "X", "No Greek").status, 0);
});

test("the template, registered, follows the whole contract and its own tests pass", () => {
  const dir = fixture();
  assert.equal(newApp(dir, "pocket", "Pocket List", "Λίστα τσέπης").status, 0);
  register(dir, "pocket", "Pocket List", "Λίστα τσέπης");
  const res = checkApp(dir, "pocket");
  assert.deepEqual(errors(res), []);
  assert.deepEqual(res.filter((r) => r.level === "warn").map((r) => r.msg), []);
  const t = spawnSync(process.execPath, ["--test", path.join(dir, "tests", "pocket.test.js")], { encoding: "utf8" });
  assert.equal(t.status, 0, t.stdout + t.stderr);
});

test("the check names the usual mistakes", () => {
  const dir = fixture();
  assert.equal(newApp(dir, "pocket", "Pocket List", "Λίστα τσέπης").status, 0);
  assert.ok(errors(checkApp(dir, "pocket")).some((e) => e.startsWith("apps.json:")), "unregistered app");
  register(dir, "pocket", "Pocket List", "Λίστα τσέπης");
  const p = (f) => path.join(dir, "pocket", f);
  const edit = (f, a, b) => fs.writeFileSync(p(f), fs.readFileSync(p(f), "utf8").replace(a, b));
  edit("app.js", "STORAGE_KEY, C.merge);", "STORAGE_KEY);");
  edit("app.js", /watchPalette/g, "watchPal");
  edit("app.js", '"use strict";', '"use strict";\n  eval("1");\n  fetch("https://www.googleapis.com/x");');
  edit("index.html", '<link rel="stylesheet" href="app.css">', '<link rel="stylesheet" href="app.css">\n  <script src="https://cdn.example.com/lib.js"></script>');
  edit("help.el.txt", "## Ξεκίνημα", "Ξεκίνημα");
  fs.writeFileSync(p("extra.js"), "");
  const e = errors(checkApp(dir, "pocket")).join("\n");
  for (const rule of ["sync:", "G3:", "safety: pocket/app.js: eval", "privacy: pocket/app.js", "loads https://cdn.example.com/lib.js", "R38:"]) {
    assert.ok(e.includes(rule), "missing " + rule + " in\n" + e);
  }
  edit("index.html", "open=pocket", "open=notes");
  assert.ok(errors(checkApp(dir, "pocket")).some((x) => x.startsWith("DL-1:")));
  assert.ok(checkApp(dir, "pocket").some((r) => r.level === "warn" && r.msg.includes("pocket/extra.js")));
});

test("every app on main passes the kit's static check", () => {
  const apps = JSON.parse(read("apps.json")).apps.filter((a) => a.type === "internal");
  const bad = [];
  for (const a of apps) errors(checkApp(ROOT, a.id)).forEach((e) => bad.push(a.id + " " + e));
  assert.deepEqual(bad, []);
});

test("the contract has a chapter for every step of Bible Checklist B", () => {
  const bible = read("OROS_BIBLE.md");
  const b = bible.slice(bible.indexOf("### Checklist B"), bible.indexOf("### Credits register"));
  const steps = (b.match(/^\d+\. /gm) || []).length;
  assert.ok(steps >= 15, "Checklist B steps: " + steps);
  const contract = read("docs/app-kit/contract.md");
  const covered = new Set([...contract.matchAll(/Checklist B (\d+(?:[,-] ?\d+)*)/g)]
    .flatMap((m) => m[1].split(/, ?/).flatMap((x) => {
      const [lo, hi] = x.split("-").map(Number);
      return hi ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) : [lo];
    })));
  const missing = [];
  for (let i = 1; i <= steps; i++) if (!covered.has(i)) missing.push(i);
  assert.deepEqual(missing, [], "add these Checklist B steps to docs/app-kit/contract.md");
  assert.ok(fs.existsSync(path.join(ROOT, "CONTRIBUTING.md")));
});
