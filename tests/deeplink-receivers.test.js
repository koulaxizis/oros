// Every app has at most ONE window.__orosOpenAt receiver: a second
// assignment silently replaces the first, so one deep-link contract
// (for example BR-S1 newSheet vs universal search) stops working
// while the app is open. Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

test("deep links: at most one window.__orosOpenAt receiver per app file", () => {
  const bad = [];
  for (const dir of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!dir.isDirectory() || /^(\.|node_modules|tests|vendor)/.test(dir.name)) continue;
    for (const f of fs.readdirSync(path.join(ROOT, dir.name))) {
      if (!f.endsWith(".js")) continue;
      const src = fs.readFileSync(path.join(ROOT, dir.name, f), "utf8");
      const n = (src.match(/window\.__orosOpenAt\s*=(?!=)/g) || []).length;
      if (n > 1) bad.push(dir.name + "/" + f + " (" + n + ")");
    }
  }
  assert.deepEqual(bad, []);
});

test("Spreadsheet: one receiver takes both newSheet (BR-S1) and search targets", () => {
  const src = fs.readFileSync(path.join(ROOT, "spreadsheet/spreadsheet.js"), "utf8");
  assert.ok(src.includes("window.__orosOpenAt = openTarget;"));
  assert.ok(/if \(tg\.newSheet\) sheetFromTable\(tg\.newSheet\);\s*else openSearchTarget\(tg\);/.test(src));
});
