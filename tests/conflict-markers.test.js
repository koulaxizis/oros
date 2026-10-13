// No merge-conflict markers in any shipped text file (1.57.00 shipped the
// shell index.html with them, so every shell script loaded twice).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const EXT = /\.(html|js|css|json|txt|md|webmanifest|toml|yml)$/;
const SKIP = new Set([".git", "node_modules"]);

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}

test("no merge-conflict markers in shipped files", () => {
  const bad = [];
  for (const f of walk(ROOT, [])) {
    if (f === __filename) continue;
    const lines = fs.readFileSync(f, "utf8").split("\n");
    lines.forEach((l, i) => {
      if (/^(<{7}( |$)|>{7}( |$)|={7}$)/.test(l)) bad.push(path.relative(ROOT, f) + ":" + (i + 1));
    });
  }
  assert.deepStrictEqual(bad, []);
});
