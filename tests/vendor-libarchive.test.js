// vendor/libarchive: the files are the ones THIRD-PARTY.txt names (sha256),
// built with libarchive 3.8.11 (security fixes over the 3.7.2 that
// libarchive.js 2.0.2 shipped), and the rebuild is written down.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const DIR = path.join(__dirname, "..", "vendor", "libarchive");

test("vendor/libarchive: files match THIRD-PARTY.txt, libarchive 3.8.11, no OpenSSL", () => {
  const notes = fs.readFileSync(path.join(DIR, "THIRD-PARTY.txt"), "utf8");
  for (const f of ["libarchive.js", "worker-bundle.js", "libarchive.wasm"]) {
    const h = crypto.createHash("sha256").update(fs.readFileSync(path.join(DIR, f))).digest("hex");
    assert.ok(notes.includes(h), f + " is the file THIRD-PARTY.txt names");
  }
  assert.match(notes, /libarchive 3\.8\.11/);
  assert.doesNotMatch(notes, /OpenSSL/);
  assert.ok(fs.existsSync(path.join(DIR, "build", "build.sh")));
  assert.ok(fs.existsSync(path.join(DIR, "LICENSE")));
  // The wasm carries the library's own version string.
  const wasm = fs.readFileSync(path.join(DIR, "libarchive.wasm")).toString("latin1");
  assert.ok(wasm.includes("libarchive 3.8.11"), "wasm reports libarchive 3.8.11");
  assert.ok(!wasm.includes("libarchive 3.7.2"));
});
