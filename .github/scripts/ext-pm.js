#!/usr/bin/env node
// Copies the Passwords vault code into the browser add-on (PW-AF1):
// extension/pm/ holds byte-for-byte copies of passwords/pmcrypto.js,
// pmcore.js, pmkinds.js and the vendored hash-wasm Argon2 (+ LICENSE),
// so the add-on opens the vault exactly as orOS does.
// tests/extension-pm.test.js fails when a copy differs: run this after
// changing any of those files.   node .github/scripts/ext-pm.js
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const FILES = [
  ["passwords/pmcrypto.js", "extension/pm/pmcrypto.js"],
  ["passwords/pmcore.js", "extension/pm/pmcore.js"],
  ["passwords/pmkinds.js", "extension/pm/pmkinds.js"],
  ["vendor/hash-wasm/argon2.umd.min.js", "extension/pm/argon2.umd.min.js"],
  ["vendor/hash-wasm/LICENSE", "extension/pm/LICENSE-hash-wasm"]
];
fs.mkdirSync(path.join(ROOT, "extension/pm"), { recursive: true });
for (const [from, to] of FILES) {
  fs.copyFileSync(path.join(ROOT, from), path.join(ROOT, to));
  console.log(from, "→", to);
}
