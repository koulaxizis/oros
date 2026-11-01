"use strict";
// Tests that pin a fixed timestamp (NOW = 1800000000000 is 2027-01-15) must
// not depend on today's date: they run again here with the clock ten years
// ahead. The quote "Open as copy" test once compared a stamp clamped to the
// fixed NOW with the real clock and would have turned red on 2027-01-15.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const DIR = __dirname;
const FIXED = /\b1[89]\d{11}\b/;

test("tests with a fixed timestamp pass with the clock ten years ahead", () => {
  const files = fs.readdirSync(DIR)
    .filter((f) => f.endsWith(".test.js") && f !== path.basename(__filename))
    .filter((f) => FIXED.test(fs.readFileSync(path.join(DIR, f), "utf8")))
    .sort();
  assert.ok(files.length > 10, "the fixed-timestamp tests are found");
  // NODE_TEST_CONTEXT would make the child report to this runner, not exit.
  const env = Object.assign({}, process.env, { CLOCK_SHIFT_DAYS: "3650" });
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ["--require", path.join(DIR, "clock-shift.js"), "--test", "--test-reporter=tap"].concat(files.map((f) => path.join(DIR, f))), {
    env, encoding: "utf8", timeout: 120000
  });
  const failed = (r.stdout || "").split("\n").filter((l) => /^\s*not ok /.test(l));
  assert.equal(r.status, 0, "failing with the clock ahead:\n" + failed.join("\n") + "\n" + (r.stderr || "").slice(0, 2000));
});
